//! Binary UIC (UI Component) layout codec for pre-3K Total War titles.
//!
//! Games before Three Kingdoms ship UI layouts as extensionless binary files
//! under `ui/` whose first 10 bytes are an ASCII `VersionNNN` magic (Attila:
//! Version077-097). This module decodes them into the same fidelity-preserving
//! [`Document`] tree the text `.twui.xml` pipeline uses, and re-encodes them
//! byte-identically. See `dialect.rs` for the decoded-XML representation.
//!
//! The codec is a line-by-line port of taw's etwng UI converter
//! (https://github.com/taw/etwng, MIT License), which proved 100%
//! byte-identical round-trip on the Attila corpus.
//!
//! Safety model: [`decode_verified`] re-encodes immediately after decoding and
//! refuses to hand out a Document that would not re-encode byte-identically,
//! so an unedited save can never corrupt a file the codec does not fully
//! understand.

pub mod decode;
pub mod dialect;
pub mod encode;
pub mod reader;
pub mod writer;

use crate::model::Document;

/// `Some(version)` when the bytes begin with the ASCII `VersionNNN` magic.
pub fn sniff_version(bytes: &[u8]) -> Option<u32> {
    if bytes.len() < 10 || &bytes[0..7] != b"Version" {
        return None;
    }
    let digits = &bytes[7..10];
    if !digits.iter().all(|b| b.is_ascii_digit()) {
        return None;
    }
    std::str::from_utf8(digits).ok()?.parse().ok()
}

/// True when this Document came from a binary UIC file (root `<ui>`).
pub fn is_uic_doc(doc: &Document) -> bool {
    doc.root.tag == "ui"
}

/// Path-shape test for binary UIC candidates: an extensionless file under a
/// `ui/` tree. Exact for the pre-3K games (their only extensionless ui files
/// are layouts) and inert for 3K/WH3 (no extensionless ui files at all);
/// callers confirm candidates by sniffing the bytes.
pub fn is_uic_candidate_path(rel: &str) -> bool {
    let norm = rel.replace('\\', "/");
    if !(norm.starts_with("ui/") || norm.contains("/ui/")) {
        return false;
    }
    let base = norm.rsplit('/').next().unwrap_or("");
    !base.is_empty() && !base.contains('.')
}

/// True when the bytes are a binary UIC layout of a version this codec handles.
pub fn sniff_supported(bytes: &[u8]) -> bool {
    sniff_version(bytes).map(decode::supported_version).unwrap_or(false)
}

/// Decode binary UIC bytes into a Document (no round-trip check).
pub fn decode(bytes: &[u8]) -> Result<Document, String> {
    decode::decode(bytes)
}

/// Encode a decoded-dialect Document back to binary UIC bytes.
pub fn encode(doc: &Document) -> Result<Vec<u8>, String> {
    encode::encode(doc)
}

/// Decode + immediately re-encode + byte-compare. This is the open-time guard:
/// a file that would not survive the round trip refuses to open instead of
/// silently corrupting on a later save.
pub fn decode_verified(bytes: &[u8]) -> Result<Document, String> {
    let doc = decode(bytes)?;
    let back = encode(&doc)?;
    if back != bytes {
        return Err(format!(
            "binary UI layout failed round-trip verification; refusing to open \
             (would corrupt on save). {}",
            first_byte_difference(bytes, &back)
        ));
    }
    Ok(doc)
}

/// Human-readable first-difference report between two byte streams.
pub fn first_byte_difference(a: &[u8], b: &[u8]) -> String {
    let mut i = 0;
    while i < a.len() && i < b.len() && a[i] == b[i] {
        i += 1;
    }
    let s = i.saturating_sub(16);
    let hex = |x: &[u8]| {
        x.iter()
            .map(|c| format!("{c:02x}"))
            .collect::<Vec<_>>()
            .join(" ")
    };
    format!(
        "first difference at byte {i} (original {} bytes, re-encoded {} bytes)\n\
         original:   ...{}\n\
         re-encoded: ...{}",
        a.len(),
        b.len(),
        hex(&a[s..(i + 16).min(a.len())]),
        hex(&b[s..(i + 16).min(b.len())])
    )
}

#[cfg(test)]
mod corpus_tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};

    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                walk(&p, out);
            } else {
                out.push(p);
            }
        }
    }

    /// Every supported binary layout in the Attila dump must round-trip
    /// byte-identically: encode(decode(bytes)) == bytes.
    #[test]
    fn attila_corpus_roundtrip() {
        let root = format!("{}/../games/Atilla/ui", env!("CARGO_MANIFEST_DIR"));
        let root = Path::new(&root);
        assert!(
            root.is_dir(),
            "games/Atilla/ui not found next to the repo; corpus test needs the Attila dump"
        );
        let mut files = Vec::new();
        walk(root, &mut files);

        let mut tally: BTreeMap<u32, u32> = BTreeMap::new();
        let mut skipped: BTreeMap<u32, u32> = BTreeMap::new();
        let mut checked = 0u32;
        for path in &files {
            let Ok(bytes) = std::fs::read(path) else {
                continue;
            };
            let Some(version) = sniff_version(&bytes) else {
                continue;
            };
            if !decode::supported_version(version) {
                *skipped.entry(version).or_default() += 1;
                continue;
            }
            let doc = decode(&bytes).unwrap_or_else(|e| {
                panic!("decode failed for {}: {e}", path.display())
            });
            let back = encode(&doc).unwrap_or_else(|e| {
                panic!("re-encode failed for {}: {e}", path.display())
            });
            assert!(
                back == bytes,
                "round-trip differs for {}\n{}",
                path.display(),
                first_byte_difference(&bytes, &back)
            );
            *tally.entry(version).or_default() += 1;
            checked += 1;
        }
        println!("uic corpus: {checked} files byte-identical, per version: {tally:?}");
        if !skipped.is_empty() {
            println!("uic corpus: skipped unsupported versions: {skipped:?}");
        }
        assert!(
            checked >= 180,
            "expected at least 180 supported Attila layouts, found {checked}"
        );
    }

    /// The web access point ships Documents through serde_json; a Value
    /// round-trip must not perturb the decoded tree (mirrors the model's
    /// json_transport_preserves_document test).
    #[test]
    fn json_transport_preserves_uic_document() {
        let root = format!("{}/../games/Atilla/ui", env!("CARGO_MANIFEST_DIR"));
        let mut files = Vec::new();
        walk(Path::new(&root), &mut files);
        let sample = files
            .iter()
            .find(|p| {
                std::fs::read(p)
                    .ok()
                    .and_then(|b| sniff_version(&b))
                    .map(decode::supported_version)
                    .unwrap_or(false)
            })
            .expect("no supported Attila layout found for the transport test");
        let bytes = std::fs::read(sample).unwrap();
        let doc = decode(&bytes).unwrap();
        let value = serde_json::to_value(&doc).expect("to_value");
        let doc_json: Document = serde_json::from_value(value).expect("from_value");
        assert!(
            encode(&doc_json).unwrap() == bytes,
            "serde_json transport perturbed the uic document for {}",
            sample.display()
        );
    }

    /// An attribute edit (the editor's editAttr path) must re-encode cleanly
    /// and survive a decode round: change the root uientry x offset, encode,
    /// decode again, and read the new value back.
    #[test]
    fn attribute_edit_survives_encode_cycle() {
        let root = format!("{}/../games/Atilla/ui", env!("CARGO_MANIFEST_DIR"));
        let mut files = Vec::new();
        walk(Path::new(&root), &mut files);
        let sample = files
            .iter()
            .find(|p| {
                std::fs::read(p)
                    .ok()
                    .map(|b| sniff_supported(&b))
                    .unwrap_or(false)
            })
            .expect("no supported Attila layout found");
        let bytes = std::fs::read(sample).unwrap();
        let mut doc = decode(&bytes).unwrap();

        let crate::model::Node::Element(entry) = &mut doc.root.children[0] else {
            panic!("root uientry missing");
        };
        let x = entry
            .attrs
            .iter_mut()
            .find(|(k, _)| k == "x")
            .expect("uientry has an x attribute");
        x.1 = "1234".to_string();

        let edited = encode(&doc).unwrap_or_else(|e| panic!("edited encode failed: {e}"));
        assert_ne!(edited, bytes, "edit must change the binary");
        let back = decode(&edited).unwrap();
        let crate::model::Node::Element(entry) = &back.root.children[0] else {
            panic!("re-decoded root uientry missing");
        };
        let x = entry.attrs.iter().find(|(k, _)| k == "x").unwrap();
        assert_eq!(x.1, "1234");
    }

    #[test]
    fn sniff_rejects_text_and_short_input() {
        assert_eq!(sniff_version(b"<layout version=\"129\">"), None);
        assert_eq!(sniff_version(b"Version"), None);
        assert_eq!(sniff_version(b"Version09"), None);
        assert_eq!(sniff_version(b"VersionABC"), None);
        assert_eq!(sniff_version(b"Version096\xb0\xb0"), Some(96));
        assert_eq!(sniff_version(b"Version002"), Some(2));
    }
}
