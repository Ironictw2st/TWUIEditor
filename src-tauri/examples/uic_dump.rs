//! Dump a binary UIC layout as the decoded-dialect JSON the frontend receives.
//!
//! Usage: cargo run --example uic_dump -- <file> [depth]

use twui_editor_lib::model::{Element, Node};
use twui_editor_lib::uic;

fn show(el: &Element, depth: usize, max_depth: usize) {
    let attrs: Vec<String> = el.attrs.iter().map(|(k, v)| format!("{k}={v:?}")).collect();
    println!("{}<{}> {}", "  ".repeat(depth), el.tag, attrs.join(" "));
    if depth >= max_depth {
        let n = el.children.len();
        if n > 0 {
            println!("{}  ... {n} children", "  ".repeat(depth));
        }
        return;
    }
    for c in &el.children {
        if let Node::Element(e) = c {
            show(e, depth + 1, max_depth);
        }
    }
}

fn main() {
    let path = std::env::args().nth(1).expect("usage: uic_dump <file> [depth]");
    let max_depth: usize = std::env::args()
        .nth(2)
        .and_then(|d| d.parse().ok())
        .unwrap_or(3);
    let bytes = std::fs::read(&path).expect("read file");
    let doc = uic::decode(&bytes).expect("decode");
    show(&doc.root, 0, max_depth);
}
