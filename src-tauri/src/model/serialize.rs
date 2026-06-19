//! Serialize a [`Document`] back to UIEd-style `.twui.xml`.
//!
//! Formatting rules (reverse-engineered from the game's files, verified by
//! byte-diff): CRLF line endings, tab indentation, the prolog emitted verbatim,
//! 0 or 1 attribute kept on the tag's line, 2+ attributes each on their own
//! line indented one tab deeper, and self-closing empties (`<foo/>`).

use super::{Document, Element, Node};
use std::fmt::Write;

const NL: &str = "\r\n";

pub fn serialize(doc: &Document) -> String {
    let mut out = String::new();
    for line in &doc.prolog {
        out.push_str(line);
        out.push_str(NL);
    }
    write_element(&mut out, &doc.root, 0);
    out
}

fn indent(out: &mut String, depth: usize) {
    for _ in 0..depth {
        out.push('\t');
    }
}

fn write_node(out: &mut String, node: &Node, depth: usize) {
    match node {
        Node::Element(el) => write_element(out, el, depth),
        Node::Comment { text } => {
            indent(out, depth);
            out.push_str("<!--");
            out.push_str(text);
            out.push_str("-->");
            out.push_str(NL);
        }
    }
}

fn write_element(out: &mut String, el: &Element, depth: usize) {
    indent(out, depth);

    if el.attrs.len() <= 1 {
        // Tag and its (optional) single attribute on one line.
        out.push('<');
        out.push_str(&el.tag);
        for (k, v) in &el.attrs {
            let _ = write!(out, " {}=\"{}\"", k, v);
        }
        if el.self_closing {
            out.push_str("/>");
            out.push_str(NL);
            return;
        }
        out.push('>');
        out.push_str(NL);
    } else {
        // Tag name alone, then one attribute per line one tab deeper.
        out.push('<');
        out.push_str(&el.tag);
        out.push_str(NL);
        let last = el.attrs.len() - 1;
        for (i, (k, v)) in el.attrs.iter().enumerate() {
            indent(out, depth + 1);
            let _ = write!(out, "{}=\"{}\"", k, v);
            if i == last {
                out.push_str(if el.self_closing { "/>" } else { ">" });
            }
            out.push_str(NL);
        }
        if el.self_closing {
            return;
        }
    }

    for child in &el.children {
        write_node(out, child, depth + 1);
    }

    indent(out, depth);
    out.push_str("</");
    out.push_str(&el.tag);
    out.push('>');
    out.push_str(NL);
}
