//! Parses CA's official "UI Symbols Documentation"
//! (`<data_root>/documentation/ui/documentation/documentation.html`) into a CCO
//! symbol table, then overlays `<data_root>/ui/metadata.json` — CA's
//! machine-readable type registry — as the authority for symbol existence and
//! types. The HTML keeps the prose descriptions; the overlay matters because the
//! HTML shipped with 3K is actually Warhammer's export (see
//! reference/cco-schema-sources.md). Drives the Inspector's binding hints.
//! Per-game; missing doc and/or metadata → whatever the other provides.
//!
//! HTML structure: `<a id ="CcoFoo"><h3>CcoFoo</h3>… <table>` of rows
//! `<tr><td>Name</td><td>ReturnType<small>…</small></td><td>Args</td><td>Description</td></tr>`.
//! Metadata structure: `{ "CcoFoo": { …, "symbols": [ { "name", "return_type":
//! { "type", "is_container", "is_optional" }, "arguments"? } ] } }` (symbols on
//! 55 of 438 types for 3K — presence proves a property exists; absence proves nothing).

use crate::state::AppState;
use std::collections::HashMap;

#[derive(serde::Serialize, Default)]
pub struct CcoDocs {
    /// object name -> (function name -> definition)
    pub objects: HashMap<String, HashMap<String, CcoFunc>>,
    /// root accessor name (e.g. `PlayersFaction`) -> definition, from the
    /// "Global Functions" section. Seeds type-inference for autocomplete.
    pub globals: HashMap<String, CcoFunc>,
    /// Type names whose property set is verified by `ui/metadata.json` `symbols`.
    /// Only these can be *checked* against (the asymmetric proof rule); sorted.
    pub verified: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct CcoFunc {
    pub ret: String,
    /// True when the return type is a list (` (list)` in the return cell, or
    /// `is_container` in metadata).
    pub list: bool,
    pub args: String,
    pub desc: String,
    /// True when `ui/metadata.json` backs this symbol (existence-proof authority).
    pub meta: bool,
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
        // The return cell is `BaseType (list)` for list returns; capture the list
        // flag before truncating `ret` to the leading alphanumeric base type.
        let full = strip_tags(c[1]);
        let list = full.contains("(list)");
        let ret: String = full.chars().take_while(|ch| ch.is_alphanumeric()).collect();
        out.insert(
            name,
            CcoFunc {
                ret,
                list,
                args: strip_tags(c[2]),
                desc: strip_tags(c[3]),
                meta: false,
            },
        );
    }
    out
}

/// Overlay `ui/metadata.json` symbols onto the HTML-derived table. Metadata wins
/// on `ret`/`list`/`args` (it is per-game truth); an HTML `desc` is kept where
/// the object+function names agree. Types whose metadata carries `symbols` are
/// recorded in `verified` so downstream checks know which types are provable.
fn merge_metadata(state: &AppState, out: &mut CcoDocs) {
    let Some(text) = state.read_text("ui/metadata.json") else {
        return;
    };
    let Ok(root) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    let Some(map) = root.as_object() else {
        return;
    };
    for (ty, rec) in map {
        let Some(symbols) = rec.get("symbols").and_then(|s| s.as_array()) else {
            continue;
        };
        // The `"global"` pseudo-type is the metadata counterpart of the HTML's
        // "Global Functions" section: root accessors, not a context type.
        let is_global = ty == "global";
        let entry = if is_global {
            &mut out.globals
        } else {
            out.objects.entry(ty.clone()).or_default()
        };
        for sym in symbols {
            let Some(name) = sym.get("name").and_then(|n| n.as_str()) else {
                continue;
            };
            let rt = sym.get("return_type");
            let ret = rt
                .and_then(|r| r.get("type"))
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();
            let list = rt
                .and_then(|r| r.get("is_container"))
                .and_then(|b| b.as_bool())
                .unwrap_or(false);
            // Mirror the HTML's Arguments column: "Void" for none, else the
            // argument types joined (optional args suffixed with `?`).
            let args = match sym.get("arguments").and_then(|a| a.as_array()) {
                Some(a) if !a.is_empty() => a
                    .iter()
                    .map(|arg| {
                        let t = arg.get("type").and_then(|t| t.as_str()).unwrap_or("?");
                        let opt = arg
                            .get("is_optional")
                            .and_then(|b| b.as_bool())
                            .unwrap_or(false);
                        if opt {
                            format!("{t}?")
                        } else {
                            t.to_string()
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(", "),
                _ => "Void".to_string(),
            };
            match entry.get_mut(name) {
                Some(f) => {
                    f.ret = ret;
                    f.list = list;
                    f.args = args;
                    f.meta = true;
                }
                None => {
                    entry.insert(
                        name.to_string(),
                        CcoFunc { ret, list, args, desc: String::new(), meta: true },
                    );
                }
            }
        }
        if !is_global {
            out.verified.push(ty.clone());
        }
    }
    out.verified.sort();
}

pub fn load(state: &AppState) -> CcoDocs {
    let mut out = CcoDocs::default();
    let Some(html) =
        state.read_text("documentation/ui/documentation/documentation.html")
    else {
        // No HTML doc — metadata alone still yields a (desc-less) symbol table.
        merge_metadata(state, &mut out);
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

    // The "Global Functions" section holds the root accessors (e.g. PlayersFaction).
    // Its rows use `<category><Name>` anchors, not `Cco*`, so parse the whole region.
    // Bound it: [ marker , first Cco anchor at/after it ) — the post-globals Front End /
    // Battle context types start at that Cco anchor and stay in `objects`.
    let gf = html.find("<a id =\"Global Functions\"");
    if let Some(g) = gf {
        let end = html[g..].find(MARK).map(|r| g + r).unwrap_or(html.len());
        out.globals = parse_functions(&html[g..end]);
    }

    for k in 0..anchors.len() {
        let start = anchors[k].1;
        let mut end = anchors.get(k + 1).map(|a| a.1).unwrap_or(html.len());
        // Clamp the last pre-globals type at the marker so it doesn't absorb the
        // Global Functions rows (whose next Cco anchor lies past the region).
        if let Some(g) = gf {
            if start < g {
                end = end.min(g);
            }
        }
        let funcs = parse_functions(&html[start..end]);
        if !funcs.is_empty() {
            out.objects.insert(anchors[k].0.clone(), funcs);
        }
    }
    merge_metadata(state, &mut out);
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

        // Global Functions section: root accessors with their return types.
        assert_eq!(
            docs.globals.get("PlayersFaction").map(|f| f.ret.as_str()),
            Some("CcoCampaignFaction"),
            "PlayersFaction global -> CcoCampaignFaction"
        );
        assert_eq!(
            docs.globals.get("CampaignRoot").map(|f| f.ret.as_str()),
            Some("CcoCampaignRoot")
        );
        assert_eq!(
            docs.globals.get("Component").map(|f| f.ret.as_str()),
            Some("CcoComponent")
        );

        // The `(list)` flag is preserved on at least one member somewhere.
        assert!(
            docs.objects.values().any(|fns| fns.values().any(|f| f.list)),
            "expected at least one list-returning member"
        );

        // The clamp: no global-accessor name leaked into any context type as a member.
        assert!(
            !docs.objects.values().any(|fns| fns.contains_key("PlayersFaction")),
            "PlayersFaction must not appear as a context member (clamp works)"
        );

        // Metadata overlay: a 3K-only type absent from the (Warhammer) HTML must be
        // present via ui/metadata.json, typed, list-flagged, and marked verified.
        // (The HTML-only asserts above pass against the WH doc too — this is the
        // assertion that actually pins the table to 3K's API.)
        let po = docs
            .objects
            .get("CcoCampaignProvincePublicOrder")
            .expect("CcoCampaignProvincePublicOrder from ui/metadata.json");
        let pt = po.get("PublicOrderText").expect("PublicOrderText symbol");
        assert_eq!(pt.ret, "UniString");
        assert!(pt.meta, "metadata-backed symbol carries meta=true");
        assert_eq!(pt.args, "Bool?", "optional Bool argument rendered as Bool?");
        assert!(
            po.get("PublicOrderEffectsList").expect("PublicOrderEffectsList").list,
            "is_container -> list flag"
        );
        assert!(
            docs.verified.iter().any(|t| t == "CcoCampaignProvincePublicOrder"),
            "type with symbols recorded in verified"
        );
        assert!(
            !docs.verified.iter().any(|t| t == "CcoCampaignProvince"),
            "symbol-less type must NOT be verified (asymmetric proof rule)"
        );
        // The `"global"` pseudo-type routes into globals (3K-only accessor as proof)
        // and never into objects/verified.
        assert!(
            docs.globals.contains_key("CaoCaoGetEligibleTargetsForScheme"),
            "3K-only global merged from metadata"
        );
        assert!(!docs.objects.contains_key("global"), "no 'global' context type");
        assert!(!docs.verified.iter().any(|t| t == "global"));
    }
}
