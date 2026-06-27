//! Generic, fidelity-preserving XML document model for `.twui.xml` files.
//!
//! The canonical representation is a raw element tree that keeps attributes in
//! their original order and with their original (escaped) values. Both the
//! `<hierarchy>` and `<components>` sections are just subtrees of this one tree.
//! The serializer reproduces the exact UIEd formatting (CRLF, tabs, one
//! attribute per line when 2+, self-closing empties) so an unedited
//! load -> save is byte-identical.

pub mod guid;
pub mod parse;
pub mod serialize;

use serde::{Deserialize, Serialize};

/// A node in the document tree: either an XML element or a comment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Node {
    Element(Element),
    Comment { text: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Element {
    pub tag: String,
    /// Attributes in document order; values are RAW (escaped) as in the source.
    pub attrs: Vec<(String, String)>,
    pub children: Vec<Node>,
    /// True when the source used a self-closing tag (`<foo/>`).
    pub self_closing: bool,
}

/// A whole `.twui.xml` document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    /// Raw prolog lines emitted verbatim before the root (xml decl + comments).
    pub prolog: Vec<String>,
    /// The root `<layout>` element.
    pub root: Element,
}

#[cfg(test)]
mod roundtrip_tests {
    use super::{parse, serialize};

    fn check(rel: &str) {
        let path = format!("{}/../games/3K/{}", env!("CARGO_MANIFEST_DIR"), rel);
        let original = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read {path}: {e}"));
        let doc = parse::parse(&original).expect("parse");
        let out = serialize::serialize(&doc);
        if original != out {
            let ab = original.as_bytes();
            let bb = out.as_bytes();
            let mut i = 0;
            while i < ab.len() && i < bb.len() && ab[i] == bb[i] {
                i += 1;
            }
            let s = i.saturating_sub(60);
            panic!(
                "round-trip differs for {rel} at byte {i} (orig len {}, out len {})\n--- original ---\n{}\n--- output ---\n{}",
                ab.len(),
                bb.len(),
                String::from_utf8_lossy(&ab[s..(i + 60).min(ab.len())]),
                String::from_utf8_lossy(&bb[s..(i + 60).min(bb.len())]),
            );
        }
    }

    #[test]
    fn roundtrip_checkbox() {
        check("ui/templates/checkbox_with_label.twui.xml");
    }

    #[test]
    fn roundtrip_faction_list_item() {
        check("ui/templates/faction_list_item_template.twui.xml");
    }

    #[test]
    fn roundtrip_faction_header_primary_fixture() {
        check("ui/campaign ui/campaign_hud_faction_header.twui.xml");
    }
}
