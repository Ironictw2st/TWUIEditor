//! Loads the content-defined CCO "shorthand" macros under
//! `<data_root>/ui/cco/*.json`. Each file is named after a CCO type (its stem,
//! e.g. `ccocampaigncharacter`) and defines named expressions that components
//! reference by name in `context_function_id` (e.g. `ExCanHaveTitle`).
//!
//! These are distinct from the documented engine built-ins in `cco_docs` (CA's
//! HTML symbol table): these are macros authored in game content. Per-game;
//! missing directory -> empty (e.g. WH3 ships no `ui/cco`).
//!
//! Schema per entry:
//!   "Name": { "name": "Name", "return": "<expr>" }                       (simple)
//!   "Name": { "name": "Name", "select": [ {"if":"<cond>","return":"<expr>"},
//!                                          … , {"return":"<default>"} ] }  (conditional)

use crate::state::AppState;
use std::collections::HashMap;

#[derive(serde::Serialize, Default)]
pub struct CcoShorthand {
    /// cco type (lowercased file stem) -> (macro name -> definition)
    pub objects: HashMap<String, HashMap<String, ShorthandDef>>,
}

#[derive(serde::Serialize)]
pub struct ShorthandDef {
    pub name: String,
    /// Direct return expression (the simple form); `None` for a `select` macro.
    pub ret: Option<String>,
    /// Conditional clauses (the `select` form); a clause with no `cond` is the default.
    pub select: Vec<ShorthandClause>,
}

#[derive(serde::Serialize)]
pub struct ShorthandClause {
    pub cond: Option<String>,
    pub ret: String,
}

fn parse_def(name: &str, v: &serde_json::Value) -> ShorthandDef {
    let ret = v.get("return").and_then(|x| x.as_str()).map(String::from);
    let mut select = Vec::new();
    if let Some(arr) = v.get("select").and_then(|x| x.as_array()) {
        for clause in arr {
            select.push(ShorthandClause {
                cond: clause.get("if").and_then(|x| x.as_str()).map(String::from),
                ret: clause
                    .get("return")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string(),
            });
        }
    }
    ShorthandDef {
        name: name.to_string(),
        ret,
        select,
    }
}

pub fn load(state: &AppState) -> CcoShorthand {
    let mut out = CcoShorthand::default();
    let Some(root) = state.data_root() else {
        return out;
    };
    let dir = root.join("ui").join("cco");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return out;
    };
    for e in entries.flatten() {
        let path = e.path();
        if path.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let Some(obj) = json.as_object() else {
            continue;
        };
        let mut table = HashMap::new();
        for (name, v) in obj {
            table.insert(name.clone(), parse_def(name, v));
        }
        if !table.is_empty() {
            out.objects.insert(stem.to_ascii_lowercase(), table);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;

    #[test]
    fn parses_cco_shorthand() {
        let state = AppState::new();
        assert!(state.data_root().is_some(), "3K data root not found for test");
        let sh = load(&state);
        assert!(
            sh.objects.len() >= 10,
            "expected the cco macro files, got {}",
            sh.objects.len()
        );

        // Simple `return` form.
        let chr = sh
            .objects
            .get("ccocampaigncharacter")
            .expect("ccocampaigncharacter present");
        let m = chr.get("ExCanHaveTitle").expect("ExCanHaveTitle present");
        assert!(
            m.ret.as_deref().unwrap_or("").contains("IsFactionLeader"),
            "ExCanHaveTitle return references IsFactionLeader"
        );

        // Conditional `select` form with a default clause.
        let fac = sh
            .objects
            .get("ccocampaignfaction")
            .expect("ccocampaignfaction present");
        let sel = fac
            .get("SpecialPooledResourceBar")
            .expect("SpecialPooledResourceBar present");
        assert!(!sel.select.is_empty(), "select-form macro parsed");
        assert!(
            sel.select.iter().any(|c| c.cond.is_none()),
            "select macro has a default clause"
        );
    }
}
