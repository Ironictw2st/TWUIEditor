//! Parses CA's official "UI Symbols Documentation"
//! (`<data_root>/documentation/ui/documentation/documentation.html`) into a CCO
//! symbol table: each `Cco*` object → its functions (return type / args / desc).
//! Drives the Inspector's binding hints. Per-game; missing doc → empty.
//!
//! Structure: `<a id ="CcoFoo"><h3>CcoFoo</h3>… <table>` of rows
//! `<tr><td>Name</td><td>ReturnType<small>…</small></td><td>Args</td><td>Description</td></tr>`.

use crate::state::AppState;
use std::collections::HashMap;

#[derive(serde::Serialize, Default)]
pub struct CcoDocs {
    /// object name -> (function name -> definition)
    pub objects: HashMap<String, HashMap<String, CcoFunc>>,
}

#[derive(serde::Serialize)]
pub struct CcoFunc {
    pub ret: String,
    pub args: String,
    pub desc: String,
}

/// Remove `<...>` tags and trim/collapse the remaining text.
fn strip_tags(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The `<td>` cell contents of one table row (split on `<td>`/`</td>`).
fn cells(row: &str) -> Vec<&str> {
    row.split("<td>")
        .skip(1)
        .map(|p| p.split("</td>").next().unwrap_or(p))
        .collect()
}

fn parse_functions(section: &str) -> HashMap<String, CcoFunc> {
    let mut out = HashMap::new();
    for row in section.split("<tr>").skip(1) {
        let row = row.split("</tr>").next().unwrap_or(row);
        if row.contains("<th>") {
            continue; // column-header row
        }
        let c = cells(row);
        if c.len() < 4 {
            continue;
        }
        let name = strip_tags(c[0]);
        if name.is_empty() {
            continue;
        }
        let ret: String = strip_tags(c[1]).chars().take_while(|ch| ch.is_alphanumeric()).collect();
        out.insert(
            name,
            CcoFunc {
                ret,
                args: strip_tags(c[2]),
                desc: strip_tags(c[3]),
            },
        );
    }
    out
}

pub fn load(state: &AppState) -> CcoDocs {
    let mut out = CcoDocs::default();
    let Some(html) =
        state.read_text("documentation/ui/documentation/documentation.html")
    else {
        return out;
    };

    // Locate each object section by its `<a id ="Cco…">` anchor.
    const MARK: &str = "<a id =\"Cco";
    let mut anchors: Vec<(String, usize)> = Vec::new();
    let mut at = 0usize;
    while let Some(rel) = html[at..].find(MARK) {
        let i = at + rel;
        let id_start = i + "<a id =\"".len();
        let Some(qrel) = html[id_start..].find('"') else {
            break;
        };
        anchors.push((html[id_start..id_start + qrel].to_string(), i));
        at = id_start + qrel;
    }

    for k in 0..anchors.len() {
        let start = anchors[k].1;
        let end = anchors.get(k + 1).map(|a| a.1).unwrap_or(html.len());
        let funcs = parse_functions(&html[start..end]);
        if !funcs.is_empty() {
            out.objects.insert(anchors[k].0.clone(), funcs);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;

    #[test]
    fn parses_cco_symbol_table() {
        let state = AppState::new();
        assert!(state.data_root().is_some(), "3K data root not found for test");
        let docs = load(&state);
        assert!(docs.objects.len() > 90, "expected many objects, got {}", docs.objects.len());

        let chr = docs.objects.get("CcoCampaignCharacter").expect("CcoCampaignCharacter present");
        let isfl = chr.get("IsFactionLeader").expect("IsFactionLeader present");
        assert_eq!(isfl.ret, "Bool");
        assert!(!isfl.desc.is_empty(), "expected a description");
        assert!(chr.contains_key("IsHeir"), "IsHeir function present");

        // `IconPath` is documented on some object (e.g. CcoCampaignAncillary).
        assert!(
            docs.objects.values().any(|fns| fns.contains_key("IconPath")),
            "IconPath documented somewhere"
        );
    }
}
