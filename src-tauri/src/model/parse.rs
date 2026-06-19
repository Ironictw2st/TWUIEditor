//! Parse `.twui.xml` into the fidelity-preserving [`Document`] tree.

use super::{Document, Element, Node};
use quick_xml::events::{BytesDecl, BytesStart, Event};
use quick_xml::reader::Reader;

pub fn parse(content: &str) -> Result<Document, String> {
    let mut reader = Reader::from_str(content);
    {
        let cfg = reader.config_mut();
        cfg.expand_empty_elements = false;
        cfg.check_end_names = true;
    }

    let mut prolog: Vec<String> = Vec::new();
    let mut stack: Vec<Element> = Vec::new();
    let mut root: Option<Element> = None;
    let mut seen_root = false;

    loop {
        match reader.read_event().map_err(|e| {
            format!("XML parse error at byte {}: {}", reader.buffer_position(), e)
        })? {
            Event::Decl(e) => {
                if !seen_root {
                    prolog.push(reconstruct_decl(&e));
                }
            }
            Event::Comment(e) => {
                let inner = String::from_utf8_lossy(e.as_ref()).into_owned();
                if !seen_root {
                    prolog.push(format!("<!--{}-->", inner));
                } else if let Some(parent) = stack.last_mut() {
                    parent.children.push(Node::Comment { text: inner });
                }
            }
            Event::Start(e) => {
                seen_root = true;
                stack.push(Element {
                    tag: tag_name(&e)?,
                    attrs: attrs_of(&e)?,
                    children: Vec::new(),
                    self_closing: false,
                });
            }
            Event::Empty(e) => {
                seen_root = true;
                let el = Element {
                    tag: tag_name(&e)?,
                    attrs: attrs_of(&e)?,
                    children: Vec::new(),
                    self_closing: true,
                };
                attach(&mut stack, &mut root, el);
            }
            Event::End(_) => {
                if let Some(el) = stack.pop() {
                    attach(&mut stack, &mut root, el);
                }
            }
            Event::Text(_) | Event::CData(_) => {
                // Whitespace/formatting only in twui.xml; regenerated on save.
            }
            Event::Eof => break,
            _ => {}
        }
    }

    let root = root.ok_or_else(|| "No root <layout> element found".to_string())?;
    Ok(Document { prolog, root })
}

fn attach(stack: &mut [Element], root: &mut Option<Element>, el: Element) {
    if let Some(parent) = stack.last_mut() {
        parent.children.push(Node::Element(el));
    } else {
        *root = Some(el);
    }
}

fn tag_name(e: &BytesStart) -> Result<String, String> {
    String::from_utf8(e.name().as_ref().to_vec()).map_err(|e| format!("invalid tag name: {e}"))
}

fn attrs_of(e: &BytesStart) -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    for a in e.attributes().with_checks(false) {
        let a = a.map_err(|e| format!("invalid attribute: {e}"))?;
        let key = String::from_utf8(a.key.as_ref().to_vec())
            .map_err(|e| format!("invalid attribute name: {e}"))?;
        // a.value is the RAW (escaped) value exactly as written in the source.
        let val = String::from_utf8(a.value.as_ref().to_vec())
            .map_err(|e| format!("invalid attribute value: {e}"))?;
        out.push((key, val));
    }
    Ok(out)
}

fn reconstruct_decl(e: &BytesDecl) -> String {
    let mut s = String::from("<?xml");
    if let Ok(v) = e.version() {
        s.push_str(&format!(" version=\"{}\"", String::from_utf8_lossy(&v)));
    }
    if let Some(Ok(enc)) = e.encoding() {
        s.push_str(&format!(" encoding=\"{}\"", String::from_utf8_lossy(&enc)));
    }
    if let Some(Ok(sa)) = e.standalone() {
        s.push_str(&format!(" standalone=\"{}\"", String::from_utf8_lossy(&sa)));
    }
    s.push_str("?>");
    s
}
