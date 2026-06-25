//! Decoders for CA binary formats read from packs: db tables (schema-driven) and
//! `.loc` strings (schema-free). Both yield the same shapes the TSV-based loaders
//! already consume, so `db.rs`/`character.rs`/`loc.rs` reuse their column logic.

use crate::schema::{FieldType, Schema};
use std::collections::HashMap;

const GUID_MARKER: [u8; 4] = [0xFD, 0xFE, 0xFC, 0xFF];
const VERSION_MARKER: [u8; 4] = [0xFC, 0xFD, 0xFE, 0xFF];

/// A bounds-checked little-endian cursor; every read returns `None` past the end.
struct Reader<'a> {
    b: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(b: &'a [u8]) -> Self {
        Reader { b, pos: 0 }
    }
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.pos.checked_add(n)?;
        let s = self.b.get(self.pos..end)?;
        self.pos = end;
        Some(s)
    }
    fn u8(&mut self) -> Option<u8> {
        self.take(1).map(|s| s[0])
    }
    fn u16(&mut self) -> Option<u16> {
        let s = self.take(2)?;
        Some(u16::from_le_bytes([s[0], s[1]]))
    }
    fn u32(&mut self) -> Option<u32> {
        let s = self.take(4)?;
        Some(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
    }
    fn i16(&mut self) -> Option<i16> {
        self.u16().map(|v| v as i16)
    }
    fn i32(&mut self) -> Option<i32> {
        self.u32().map(|v| v as i32)
    }
    fn i64(&mut self) -> Option<i64> {
        let s = self.take(8)?;
        Some(i64::from_le_bytes(s.try_into().ok()?))
    }
    fn f32(&mut self) -> Option<f32> {
        self.u32().map(f32::from_bits)
    }
    fn f64(&mut self) -> Option<f64> {
        let s = self.take(8)?;
        Some(f64::from_le_bytes(s.try_into().ok()?))
    }
    /// Length-prefixed (u16 byte length) UTF-8 string.
    fn string_u8(&mut self) -> Option<String> {
        let n = self.u16()? as usize;
        let s = self.take(n)?;
        Some(String::from_utf8_lossy(s).into_owned())
    }
    /// Length-prefixed (u16 char count) UTF-16LE string.
    fn string_u16(&mut self) -> Option<String> {
        let n = self.u16()? as usize;
        let s = self.take(n * 2)?;
        let u: Vec<u16> = s.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        Some(String::from_utf16_lossy(&u))
    }
    /// Consume a 4-byte marker if present at the cursor.
    fn eat_marker(&mut self, m: &[u8; 4]) -> bool {
        if self.b.get(self.pos..self.pos + 4) == Some(&m[..]) {
            self.pos += 4;
            true
        } else {
            false
        }
    }
}

fn decode_field(r: &mut Reader, t: &FieldType) -> Option<String> {
    Some(match t {
        FieldType::Boolean => {
            if r.u8()? != 0 { "true".to_string() } else { "false".to_string() }
        }
        FieldType::I16 => r.i16()?.to_string(),
        FieldType::I32 => r.i32()?.to_string(),
        FieldType::I64 => r.i64()?.to_string(),
        FieldType::F32 => r.f32()?.to_string(),
        FieldType::F64 => r.f64()?.to_string(),
        FieldType::ColourRGB => format!("{:06X}", r.u32()? & 0xFF_FFFF),
        FieldType::StringU8 => r.string_u8()?,
        FieldType::StringU16 => r.string_u16()?,
        FieldType::OptionalStringU8 => {
            if r.u8()? != 0 { r.string_u8()? } else { String::new() }
        }
        FieldType::OptionalStringU16 => {
            if r.u8()? != 0 { r.string_u16()? } else { String::new() }
        }
        // Field types we can't size/flatten (nested sub-tables, unknown unit
        // variants) -> bail the whole table so the caller falls back to TSV.
        FieldType::SequenceU16(_) | FieldType::SequenceU32(_) | FieldType::Unknown => {
            return None
        }
    })
}

/// Decode a binary db table to `(field names, rows of strings)` using the schema
/// definition matching the table's embedded version. Returns `None` on any
/// short/over-run or an unknown field type (caller falls back to TSV).
pub fn decode_db(
    bytes: &[u8],
    schema: &Schema,
    table: &str,
) -> Option<(Vec<String>, Vec<Vec<String>>)> {
    let mut r = Reader::new(bytes);
    if r.eat_marker(&GUID_MARKER) {
        r.string_u16()?; // skip the table GUID
    }
    let version = if r.eat_marker(&VERSION_MARKER) { r.i32()? } else { 0 };
    let _mysterious = r.u8()?;
    let count = r.u32()? as usize;

    let fields = schema.fields_for(table, version)?;
    let header: Vec<String> = fields.iter().map(|f| f.name.clone()).collect();

    let mut rows: Vec<Vec<String>> = Vec::with_capacity(count.min(100_000));
    for _ in 0..count {
        let before = r.pos;
        let mut row = Vec::with_capacity(fields.len());
        for f in fields {
            row.push(decode_field(&mut r, &f.field_type)?);
        }
        // A row that consumed no bytes (e.g. an empty field list) would loop
        // `count` times forever — guard against it.
        if r.pos == before {
            return None;
        }
        rows.push(row);
    }
    Some((header, rows))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::Schema;

    /// A table whose schema definition has zero fields + a huge record count must
    /// bail (return None) instead of looping billions of times.
    #[test]
    fn decode_db_empty_fields_does_not_hang() {
        let schema = Schema::parse(
            r#"(version:3, versioned_files:[ DB("t_tables",[(version:0, fields:[])]) ])"#,
        )
        .expect("schema parses");
        // No markers; mysterious byte 0x01; count = 0xFFFFFFFF.
        let bytes = [0x01u8, 0xFF, 0xFF, 0xFF, 0xFF];
        assert!(decode_db(&bytes, &schema, "t_tables").is_none());
    }
}

/// Decode a binary `.loc` into `out` (full key -> value). Schema-free; malformed
/// files are ignored (partial reads stop at the first bad entry).
pub fn decode_loc(bytes: &[u8], out: &mut HashMap<String, String>) {
    let mut r = Reader::new(bytes);
    if r.take(2) != Some(&[0xFF, 0xFE][..]) || r.take(3) != Some(&b"LOC"[..]) {
        return;
    }
    let _pad = r.u8();
    let _version = r.u32();
    let Some(count) = r.u32() else { return };
    for _ in 0..count {
        let (Some(key), Some(value)) = (r.string_u16(), r.string_u16()) else {
            break;
        };
        let _tooltip = r.u8();
        out.insert(key, value);
    }
}
