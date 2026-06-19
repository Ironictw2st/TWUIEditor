//! Reads localised UI strings from `<data_root>/text/db/campaign_localised_strings__.loc.tsv`.
//!
//! Format: header row `key<TAB>text<TAB>tooltip`, then a `#Loc;…` metadata line
//! to skip, then rows. The `key` column is `campaign_localised_strings_string_<record_key>`;
//! we strip that table/field prefix so callers can look strings up by the bare
//! record key used in scripts and `.twui.xml` (e.g.
//! `3k_dlc07_liu_yan_ambition_task_own_regions_title`).

use crate::state::AppState;
use std::collections::HashMap;

const PREFIX: &str = "campaign_localised_strings_string_";

pub fn load(state: &AppState) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Some(root) = state.data_root() else {
        return out;
    };
    let path = root
        .join("text")
        .join("db")
        .join("campaign_localised_strings__.loc.tsv");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return out;
    };

    let mut lines = text.lines();
    lines.next(); // header row
    for line in lines {
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        let mut cols = line.split('\t');
        let (Some(key), Some(value)) = (cols.next(), cols.next()) else {
            continue;
        };
        let key = key.strip_prefix(PREFIX).unwrap_or(key);
        out.insert(key.to_string(), value.to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;

    #[test]
    fn resolves_ambition_task_titles() {
        let state = AppState::new();
        assert!(state.data_root().is_some(), "3K data root not found for test");
        let loc = load(&state);
        assert!(!loc.is_empty(), "expected localised strings");
        // Bare record key (table/field prefix stripped) resolves to real text.
        assert_eq!(
            loc.get("3k_dlc07_liu_yan_ambition_task_full_stack_armies_title").map(String::as_str),
            Some("Stern Defence & Cutting Attack")
        );
    }
}
