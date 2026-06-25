//! Resolves character-portrait art for the Characters panel.
//!
//! Chain (per character generation template):
//!   character_generation_templates_tables.art_set_override
//!     -> campaign_character_arts_tables row whose `art_set_id` matches
//!     -> its `portrait` column (a folder prefix under `ui/characters/`) and
//!        `card` column (the unitcard image name: `<portrait>stills/unitcards/<card>.png`).
//!
//! Each `*_tables/data__.tsv` is: a header row, a `#` metadata line to skip,
//! then tab-separated rows (same format `db.rs` reads).

use crate::db::read_db_table;
use crate::state::AppState;
use std::collections::HashMap;

#[derive(serde::Serialize, Default)]
pub struct CharacterDb {
    /// Every generation template the user can assign to a role, with its
    /// resolved adult portrait folder (empty when unresolvable).
    pub templates: Vec<CharacterTemplate>,
}

#[derive(serde::Serialize)]
pub struct CharacterTemplate {
    pub key: String,
    /// Portrait folder prefix, e.g. `3k_dlc06_hero_special_king_wutugu/` (may be empty).
    pub portrait: String,
    /// Unitcard image name (the arts `card` column), e.g. `3k_dlc06_hero_special_king_wutugu`.
    pub card: String,
}

fn col_index(header: &[String], name: &str) -> Option<usize> {
    header.iter().position(|h| h == name)
}

fn get<'a>(row: &'a [String], idx: Option<usize>) -> &'a str {
    idx.and_then(|i| row.get(i)).map(|s| s.as_str()).unwrap_or("")
}

/// art_set_id -> the adult (portrait folder, card). When an art set has several
/// rows (baby / child / adult), prefer the one that has come of age (the adult),
/// else the highest age, else the first seen.
fn art_set_art(state: &AppState) -> HashMap<String, (String, String)> {
    let mut out: HashMap<String, (String, String)> = HashMap::new();
    let Some((h, rows)) = read_db_table(state, "campaign_character_arts_tables") else {
        return out;
    };
    let (set, port, card, age, coa) = (
        col_index(&h, "art_set_id"),
        col_index(&h, "portrait"),
        col_index(&h, "card"),
        col_index(&h, "age"),
        col_index(&h, "has_come_of_age"),
    );
    // Track the score of the row currently stored per art set.
    let mut best: HashMap<String, (i32, i32)> = HashMap::new(); // set -> (come_of_age, age)
    for r in &rows {
        let set_id = get(r, set);
        let portrait = get(r, port);
        if set_id.is_empty() || portrait.is_empty() {
            continue;
        }
        let coa_score = if get(r, coa) == "true" { 1 } else { 0 };
        let age_score = get(r, age).parse::<i32>().unwrap_or(0);
        let score = (coa_score, age_score);
        match best.get(set_id) {
            Some(prev) if *prev >= score => {}
            _ => {
                best.insert(set_id.to_string(), score);
                out.insert(set_id.to_string(), (portrait.to_string(), get(r, card).to_string()));
            }
        }
    }
    out
}

pub fn load(state: &AppState) -> CharacterDb {
    let art = art_set_art(state);

    let mut out = CharacterDb::default();
    if let Some((h, rows)) = read_db_table(state, "character_generation_templates_tables") {
        let (k, ov) = (col_index(&h, "key"), col_index(&h, "art_set_override"));
        for r in &rows {
            let key = get(r, k).to_string();
            if key.is_empty() {
                continue;
            }
            let (portrait, card) = art.get(get(r, ov)).cloned().unwrap_or_default();
            out.templates.push(CharacterTemplate { key, portrait, card });
        }
        out.templates.sort_by(|a, b| a.key.cmp(&b.key));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;

    #[test]
    fn resolves_template_to_adult_portrait() {
        let state = AppState::new();
        assert!(state.data_root().is_some(), "3K data root not found for test");
        let db = load(&state);
        assert!(db.templates.len() > 100, "expected many templates, got {}", db.templates.len());

        let wutugu = db
            .templates
            .iter()
            .find(|t| t.key == "3k_dlc06_template_historical_king_wutugu_hero_nanman")
            .expect("wutugu template present");
        // Adult portrait + card, NOT the baby/child rows of the same art set.
        assert_eq!(wutugu.portrait, "3k_dlc06_hero_special_king_wutugu/");
        assert_eq!(wutugu.card, "3k_dlc06_hero_special_king_wutugu");

        let root = state.data_root().unwrap();
        // The composite the Character2DDisplayCreator would draw exists on disk.
        let composite = root
            .join("ui/characters/3k_dlc06_hero_special_king_wutugu/composites/large_panel/norm/norm.png");
        assert!(composite.is_file(), "expected composite at {}", composite.display());
        // The unitcard `<portrait>stills/unitcards/<card>.png` exists too.
        let unitcard = root.join(format!(
            "ui/characters/{}stills/unitcards/{}.png",
            wutugu.portrait, wutugu.card
        ));
        assert!(unitcard.is_file(), "expected unitcard at {}", unitcard.display());
    }
}
