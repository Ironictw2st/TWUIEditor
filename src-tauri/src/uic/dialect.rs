//! The decoded-XML dialect shared by decode and encode.
//!
//! Binary UIC content is represented as an [`Element`] tree the rest of the app
//! already understands. Deciphered fields become attributes; undeciphered runs
//! stay positional typed children (`<i v=""/>`, `<flt v=""/>`, `<yes/>`, ...).
//! Values that cannot survive a text representation exactly (NaN-payload
//! floats, non-UTF-8 or control-character strings) fall back to a `hex`
//! attribute, which the encoder prefers when present.
//!
//! Ported from taw's etwng UI converter (https://github.com/taw/etwng), MIT License.

use crate::model::Element;

/// Non-self-closing element (container).
pub fn el(tag: &str) -> Element {
    Element {
        tag: tag.to_string(),
        attrs: Vec::new(),
        children: Vec::new(),
        self_closing: false,
    }
}

/// Self-closing element (leaf).
pub fn leaf(tag: &str) -> Element {
    Element {
        tag: tag.to_string(),
        attrs: Vec::new(),
        children: Vec::new(),
        self_closing: true,
    }
}

pub fn attr(el: &mut Element, key: &str, value: String) {
    el.attrs.push((key.to_string(), value));
}

/// Escape a string for storage as a RAW (escaped) attribute value, matching
/// what `model::parse` would hold for the same text.
pub fn escape_attr(s: &str) -> String {
    quick_xml::escape::escape(s).into_owned()
}

pub fn unescape_attr(s: &str) -> Result<String, String> {
    quick_xml::escape::unescape(s)
        .map(|c| c.into_owned())
        .map_err(|e| format!("bad escape in attribute value {s:?}: {e}"))
}

/// Space-separated lowercase hex pairs ("0a ff 00").
pub fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 3);
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        out.push_str(&format!("{b:02x}"));
    }
    out
}

pub fn from_hex(s: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    for tok in s.split_whitespace() {
        let mut chars = tok.as_bytes().chunks(2);
        // Allow both spaced pairs and contiguous runs.
        while let Some(pair) = chars.next() {
            let txt = std::str::from_utf8(pair).map_err(|_| format!("bad hex {tok:?}"))?;
            if txt.len() != 2 {
                return Err(format!("odd-length hex token {tok:?}"));
            }
            out.push(u8::from_str_radix(txt, 16).map_err(|_| format!("bad hex {tok:?}"))?);
        }
    }
    Ok(out)
}

/// True when the decoded text can be stored as a plain attribute value and
/// survive attribute-value normalization plus display: no control characters.
fn is_clean(s: &str) -> bool {
    !s.chars().any(|c| (c as u32) < 0x20)
}

/// Set `key` from a byte string: `key` when clean UTF-8, else `key_hex`.
pub fn attr_s(e: &mut Element, key: &str, bytes: &[u8]) {
    match std::str::from_utf8(bytes) {
        Ok(s) if is_clean(s) => attr(e, key, escape_attr(s)),
        _ => attr(e, &format!("{key}_hex"), to_hex(bytes)),
    }
}

/// Set `key` from UTF-16 code units: `key` when clean, else `key_hex` (LE byte stream).
pub fn attr_uni(e: &mut Element, key: &str, units: &[u16]) {
    match String::from_utf16(units) {
        Ok(s) if is_clean(s.as_str()) && s.encode_utf16().eq(units.iter().copied()) => {
            attr(e, key, escape_attr(&s))
        }
        _ => {
            let mut bytes = Vec::with_capacity(units.len() * 2);
            for u in units {
                bytes.extend_from_slice(&u.to_le_bytes());
            }
            attr(e, &format!("{key}_hex"), to_hex(&bytes));
        }
    }
}

/// Read a promoted string attribute back to bytes (prefers `key_hex`).
pub fn attr_s_bytes(e: &Element, key: &str, path: &str) -> Result<Vec<u8>, String> {
    if let Some(h) = get(e, &format!("{key}_hex")) {
        return from_hex(h);
    }
    match get(e, key) {
        Some(v) => Ok(unescape_attr(v)?.into_bytes()),
        None => Err(format!("{path}: missing attribute {key:?} on <{}>", e.tag)),
    }
}

/// Read a promoted unicode attribute back to UTF-16 code units (prefers `key_hex`).
pub fn attr_uni_units(e: &Element, key: &str, path: &str) -> Result<Vec<u16>, String> {
    if let Some(h) = get(e, &format!("{key}_hex")) {
        let bytes = from_hex(h)?;
        if bytes.len() % 2 != 0 {
            return Err(format!("{path}: odd byte count in {key}_hex"));
        }
        return Ok(bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect());
    }
    match get(e, key) {
        Some(v) => Ok(unescape_attr(v)?.encode_utf16().collect()),
        None => Err(format!("{path}: missing attribute {key:?} on <{}>", e.tag)),
    }
}

pub fn get<'a>(e: &'a Element, key: &str) -> Option<&'a str> {
    e.attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

pub fn req<'a>(e: &'a Element, key: &str, path: &str) -> Result<&'a str, String> {
    get(e, key).ok_or_else(|| format!("{path}: missing attribute {key:?} on <{}>", e.tag))
}

pub fn req_i(e: &Element, key: &str, path: &str) -> Result<i32, String> {
    let v = req(e, key, path)?;
    v.parse::<i32>()
        .map_err(|_| format!("{path}: attribute {key}={v:?} is not a valid integer"))
}

pub fn req_u(e: &Element, key: &str, path: &str) -> Result<u32, String> {
    let v = req(e, key, path)?;
    v.parse::<u32>()
        .map_err(|_| format!("{path}: attribute {key}={v:?} is not a valid unsigned integer"))
}

/// Format an f32 so it reparses to identical bits, else None (use hex fallback).
pub fn flt_repr(f: f32) -> Option<String> {
    if !f.is_finite() {
        return None;
    }
    let s = format!("{f}");
    match s.parse::<f32>() {
        Ok(back) if back.to_bits() == f.to_bits() => Some(s),
        _ => None,
    }
}

/// `<flt v="1.5"/>` or `<flt hex="7fc00001"/>` for exact-unrepresentable values.
pub fn flt_leaf(f: f32) -> Element {
    let mut e = leaf("flt");
    match flt_repr(f) {
        Some(s) => attr(&mut e, "v", s),
        None => attr(&mut e, "hex", format!("{:08x}", f.to_bits())),
    }
    e
}

pub fn flt_value(e: &Element, path: &str) -> Result<f32, String> {
    if let Some(h) = get(e, "hex") {
        let clean: String = h.chars().filter(|c| !c.is_whitespace()).collect();
        let bits = u32::from_str_radix(&clean, 16)
            .map_err(|_| format!("{path}: bad <flt> hex {h:?}"))?;
        return Ok(f32::from_bits(bits));
    }
    let v = req(e, "v", path)?;
    v.parse::<f32>().map_err(|_| format!("{path}: bad <flt> value {v:?}"))
}
