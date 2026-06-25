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

/// Parse a `.loc.tsv` body (header + `#`-comment + `key<TAB>text<TAB>tooltip`
/// rows) into `out`, full-keyed.
fn parse_loc_tsv(text: &str, out: &mut HashMap<String, String>) {
    let mut lines = text.lines();
    lines.next(); // header row
    for line in lines {
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        let mut cols = line.split('\t');
        if let (Some(key), Some(value)) = (cols.next(), cols.next()) {
            out.insert(key.to_string(), value.to_string());
        }
    }
}

/// Every localised string in the active source, full-keyed. Scans binary `.loc`
/// (inside packs) and `.loc.tsv` (loose folder) wherever they live, so mods and
/// non-`text/db` locations are covered. Later sources override earlier.
pub fn load_all(state: &AppState) -> HashMap<String, String> {
    let mut all = HashMap::new();
    // One combined walk over both binary `.loc` and TSV `.loc.tsv` (a source is one
    // or the other, so a single pass covers it).
    for rel in state.list(&|p| p.ends_with(".loc") || p.ends_with(".loc.tsv")) {
        if rel.ends_with(".loc.tsv") {
            if let Some(text) = state.read_text(&rel) {
                parse_loc_tsv(&text, &mut all);
            }
        } else if let Some(bytes) = state.read(&rel) {
            crate::bin::decode_loc(&bytes, &mut all);
        }
    }
    all
}

pub fn load(state: &AppState) -> HashMap<String, String> {
    let all = state.loc_all(); // cached full-key map (shared with db court titles)
    let mut out = HashMap::new();

    // UI text, looked up bare by `Loc(...)` / `this.title`.
    const CAMPAIGN: &str = "campaign_localised_strings_string_";
    // DB-record display text, kept full-keyed for the record-context resolver.
    const RECORD_PREFIXES: &[&str] = &[
        "effect_bundles_localised_title_",
        "effect_bundles_localised_description_",
        "pooled_resources_display_name_",
        "ceo_equipped_set_bonuses_title_",
        "ceo_equipped_set_bonuses_description_",
        "effects_description_",
    ];

    for (key, value) in all.iter() {
        if let Some(bare) = key.strip_prefix(CAMPAIGN) {
            out.insert(bare.to_string(), value.clone());
        } else if RECORD_PREFIXES.iter().any(|p| key.starts_with(p)) {
            out.insert(key.clone(), value.clone());
        }
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
