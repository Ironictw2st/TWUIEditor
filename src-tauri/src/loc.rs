//! Reads localised UI strings from `<data_root>/text/db/*.loc.tsv`.
//!
//! Format: header row `key<TAB>text<TAB>tooltip`, then a `#Loc;…` metadata line
//! to skip, then rows. Two ways strings enter the map:
//! - **Campaign strings** keyed by the BARE record key (table/field prefix
//!   stripped) — what `Loc(...)` / `this.title` look up (e.g. task titles).
//! - **DB-record tables** (effect bundles, pooled resources, ceo sets, effects)
//!   kept by their FULL key (e.g. `effect_bundles_localised_title_<k>`) so the
//!   record-context resolver can build `<prefix><record_key>`. Title and
//!   description share a record key, so these must stay full-keyed.

use crate::state::AppState;
use std::collections::HashMap;
use std::path::Path;

/// Merge a `.loc.tsv` into `out`. With `Some(prefix)` only rows starting with it
/// are kept, stripped to the bare key. With `None` all rows are kept full-keyed.
fn merge_loc(out: &mut HashMap<String, String>, path: &Path, prefix: Option<&str>) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
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
        let bare = match prefix {
            Some(p) => match key.strip_prefix(p) {
                Some(k) => k,
                None => continue,
            },
            None => key,
        };
        out.insert(bare.to_string(), value.to_string());
    }
}

/// Merge only rows whose full key starts with one of `prefixes`, keeping the
/// FULL key (for record tables where several fields share a record key).
fn merge_loc_fields(out: &mut HashMap<String, String>, path: &Path, prefixes: &[&str]) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
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
        if prefixes.iter().any(|p| key.starts_with(p)) {
            out.insert(key.to_string(), value.to_string());
        }
    }
}

pub fn load(state: &AppState) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Some(root) = state.data_root() else {
        return out;
    };
    let db = root.join("text").join("db");

    // UI text, looked up bare by `Loc(...)` / `this.title`.
    merge_loc(
        &mut out,
        &db.join("campaign_localised_strings__.loc.tsv"),
        Some("campaign_localised_strings_string_"),
    );

    // DB-record display text, kept full-keyed for the record-context resolver.
    merge_loc_fields(
        &mut out,
        &db.join("effect_bundles__.loc.tsv"),
        &["effect_bundles_localised_title_", "effect_bundles_localised_description_"],
    );
    merge_loc_fields(
        &mut out,
        &db.join("pooled_resources__.loc.tsv"),
        &["pooled_resources_display_name_"],
    );
    merge_loc_fields(
        &mut out,
        &db.join("ceo_equipped_set_bonuses__.loc.tsv"),
        &["ceo_equipped_set_bonuses_title_", "ceo_equipped_set_bonuses_description_"],
    );
    merge_loc_fields(&mut out, &db.join("effects__.loc.tsv"), &["effects_description_"]);

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
        // Bare campaign string (Loc / this.title path).
        assert_eq!(
            loc.get("3k_dlc07_liu_yan_ambition_task_full_stack_armies_title").map(String::as_str),
            Some("Stern Defence & Cutting Attack")
        );
        // Full-keyed record tables (the record-context resolver builds these keys).
        assert_eq!(
            loc.get("effect_bundles_localised_title_3k_dlc07_effect_bundle_liu_yan_ambition_reward_gdp_buff")
                .map(String::as_str),
            Some("Economic Stimulus")
        );
        assert_eq!(
            loc.get("effect_bundles_localised_description_3k_dlc07_effect_bundle_liu_yan_ambition_reward_gdp_buff")
                .map(String::as_str),
            Some("Invest in your industry and commerce, increasing your GDP in turn.")
        );
        assert_eq!(
            loc.get("pooled_resources_display_name_3k_dlc07_pooled_resource_ambition").map(String::as_str),
            Some("Aspiration")
        );
    }
}
