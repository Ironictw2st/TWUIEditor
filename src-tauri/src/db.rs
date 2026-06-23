//! Reads the RPFM-style TSV exports under `<data_root>/DB` for the faction /
//! culture / subculture pickers and the perspective filter.
//!
//! Each `*_tables/data__.tsv` is: a header row of column names, then a second
//! line beginning with `#` (table metadata) to skip, then tab-separated rows.

use crate::state::AppState;
use std::path::Path;

#[derive(serde::Serialize, Default)]
pub struct ContextDb {
    pub factions: Vec<Faction>,
    /// subculture -> culture
    pub subcultures: Vec<Subculture>,
    pub cultures: Vec<String>,
    /// campaign/start-pos keys, the primary `_main_` campaign first.
    pub campaigns: Vec<String>,
    /// campaign key -> faction keys playable in it.
    pub campaign_factions: std::collections::HashMap<String, Vec<String>>,
    /// Court-office title variants (one per cultural row), resolved to display text.
    pub ministerial_positions: Vec<MinisterialPosition>,
}

/// One cultural variant of a court office: which post it is, the context it applies
/// to, and its resolved on-screen title. The frontend picks the best-matching variant
/// for the selected perspective (see src/twui/posts.ts).
#[derive(serde::Serialize, Default, Clone)]
pub struct MinisterialPosition {
    pub position_key: String,
    pub culture: String,
    pub faction: String,
    pub subculture: String,
    pub campaign: String,
    pub title: String,
}

#[derive(serde::Serialize)]
pub struct Faction {
    pub key: String,
    pub screen_name: String,
    pub subculture: String,
    pub flags_path: String,
}

#[derive(serde::Serialize)]
pub struct Subculture {
    pub subculture: String,
    pub culture: String,
}

/// Parse a `data__.tsv`: returns (header columns, data rows as Vec<Vec<String>>).
fn read_tsv(path: &Path) -> Option<(Vec<String>, Vec<Vec<String>>)> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut lines = text.lines();
    let header: Vec<String> = lines.next()?.split('\t').map(|s| s.to_string()).collect();
    let mut rows = Vec::new();
    for line in lines {
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        rows.push(line.split('\t').map(|s| s.to_string()).collect::<Vec<_>>());
    }
    Some((header, rows))
}

fn col_index(header: &[String], name: &str) -> Option<usize> {
    header.iter().position(|h| h == name)
}

fn get<'a>(row: &'a [String], idx: Option<usize>) -> &'a str {
    idx.and_then(|i| row.get(i)).map(|s| s.as_str()).unwrap_or("")
}

pub fn load(state: &AppState) -> ContextDb {
    let Some(root) = state.data_root() else {
        return ContextDb::default();
    };
    let db = root.join("DB");

    let mut out = ContextDb::default();

    // factions
    if let Some((h, rows)) = read_tsv(&db.join("factions_tables").join("data__.tsv")) {
        let (k, sc, sn, fp) = (
            col_index(&h, "key"),
            col_index(&h, "subculture"),
            col_index(&h, "screen_name"),
            col_index(&h, "flags_path"),
        );
        for r in &rows {
            let key = get(r, k).to_string();
            if key.is_empty() {
                continue;
            }
            out.factions.push(Faction {
                screen_name: {
                    let n = get(r, sn);
                    if n.is_empty() { key.clone() } else { n.to_string() }
                },
                subculture: get(r, sc).to_string(),
                flags_path: get(r, fp).to_string(),
                key,
            });
        }
        out.factions.sort_by(|a, b| a.screen_name.to_lowercase().cmp(&b.screen_name.to_lowercase()));
    }

    // subcultures -> culture
    if let Some((h, rows)) = read_tsv(&db.join("cultures_subcultures_tables").join("data__.tsv")) {
        let (sc, cu) = (col_index(&h, "subculture"), col_index(&h, "culture"));
        for r in &rows {
            let subculture = get(r, sc).to_string();
            if subculture.is_empty() {
                continue;
            }
            out.subcultures.push(Subculture {
                culture: get(r, cu).to_string(),
                subculture,
            });
        }
        out.subcultures.sort_by(|a, b| a.subculture.cmp(&b.subculture));
    }

    // cultures
    if let Some((h, rows)) = read_tsv(&db.join("cultures_tables").join("data__.tsv")) {
        let k = col_index(&h, "key");
        for r in &rows {
            let key = get(r, k).to_string();
            if !key.is_empty() {
                out.cultures.push(key);
            }
        }
        out.cultures.sort();
    }

    // campaigns + which factions are playable per campaign (frontend leaders table).
    if let Some((h, rows)) = read_tsv(
        &db.join("frontend_faction_to_frontend_faction_leaders_tables")
            .join("data__.tsv"),
    ) {
        let (ck, ff) = (col_index(&h, "campaign_key"), col_index(&h, "frontend_faction"));
        for r in &rows {
            let campaign = get(r, ck).to_string();
            let faction = get(r, ff).to_string();
            if campaign.is_empty() || faction.is_empty() {
                continue;
            }
            let list = out.campaign_factions.entry(campaign).or_default();
            if !list.contains(&faction) {
                list.push(faction);
            }
        }
        for list in out.campaign_factions.values_mut() {
            list.sort();
        }
        // Campaign list, alphabetical, but with the title's primary "main" campaign first.
        // TW games name it `<game>_main_*` (3k_main_campaign_map, wh3_main_*, ...), so we
        // promote the first `_main_` key generically rather than naming a specific game.
        let mut campaigns: Vec<String> = out.campaign_factions.keys().cloned().collect();
        campaigns.sort();
        if let Some(pos) = campaigns.iter().position(|c| c.contains("_main_")) {
            let main = campaigns.remove(pos);
            campaigns.insert(0, main);
        }
        out.campaigns = campaigns;
    }

    // Court-office titles. The culture-details table maps each post (ministerial_position_key)
    // + its context (culture/faction/subculture/campaign) to a localised_string_key; the
    // on-screen title is `ministerial_positions_strings_on_screen_<localised_string_key>` in
    // the loc table. We resolve the title per row here so the frontend just picks a variant.
    {
        let titles = read_on_screen_titles(&root);
        if let Some((h, rows)) = read_tsv(
            &db.join("ministerial_positions_culture_details_tables").join("data__.tsv"),
        ) {
            let (pk, cu, fa, sub, cam, ls) = (
                col_index(&h, "ministerial_position_key"),
                col_index(&h, "culture_key"),
                col_index(&h, "faction_key"),
                col_index(&h, "subculture_key"),
                col_index(&h, "campaign_key"),
                col_index(&h, "localised_string_key"),
            );
            for r in &rows {
                let position_key = get(r, pk).to_string();
                let ls_key = get(r, ls);
                if position_key.is_empty() || ls_key.is_empty() {
                    continue;
                }
                let title = match titles
                    .get(&format!("ministerial_positions_strings_on_screen_{ls_key}"))
                {
                    Some(t) if !t.is_empty() => t.clone(),
                    _ => continue,
                };
                out.ministerial_positions.push(MinisterialPosition {
                    position_key,
                    culture: get(r, cu).to_string(),
                    faction: get(r, fa).to_string(),
                    subculture: get(r, sub).to_string(),
                    campaign: get(r, cam).to_string(),
                    title,
                });
            }
        }
    }

    out
}

/// The court-office on-screen title strings, keyed by their full loc key.
fn read_on_screen_titles(root: &Path) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let path = root
        .join("text")
        .join("db")
        .join("ministerial_positions_strings__.loc.tsv");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return map;
    };
    let mut lines = text.lines();
    lines.next(); // header
    for line in lines {
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        let mut cols = line.split('\t');
        if let (Some(key), Some(value)) = (cols.next(), cols.next()) {
            if key.starts_with("ministerial_positions_strings_on_screen_") {
                map.insert(key.to_string(), value.to_string());
            }
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;

    #[test]
    fn loads_factions_cultures_subcultures() {
        let state = AppState::new();
        // AppState::new() guesses the 3K root relative to cwd (src-tauri/../3K).
        assert!(state.data_root().is_some(), "3K data root not found for test");
        let db = load(&state);

        assert!(db.factions.len() > 100, "expected many factions, got {}", db.factions.len());
        let cao = db
            .factions
            .iter()
            .find(|f| f.key == "3k_main_faction_cao_cao")
            .expect("cao_cao faction present");
        assert_eq!(cao.subculture, "3k_main_chinese");

        let chinese = db
            .subcultures
            .iter()
            .find(|s| s.subculture == "3k_main_chinese")
            .expect("3k_main_chinese subculture present");
        assert_eq!(chinese.culture, "3k_main_chinese");

        assert!(db.cultures.iter().any(|c| c == "3k_main_chinese"));

        // Campaigns: main map present and first; 8p excludes Cao Cao.
        assert_eq!(db.campaigns.first().map(|s| s.as_str()), Some("3k_main_campaign_map"));
        assert!(db.campaigns.iter().any(|c| c == "8p_start_pos"));
        let main = db.campaign_factions.get("3k_main_campaign_map").expect("main campaign");
        assert!(main.iter().any(|f| f == "3k_main_faction_cao_cao"));
        let eight = db.campaign_factions.get("8p_start_pos").expect("8p campaign");
        assert!(!eight.iter().any(|f| f == "3k_main_faction_cao_cao"));
    }

    #[test]
    fn resolves_court_office_titles() {
        let state = AppState::new();
        assert!(state.data_root().is_some(), "3K data root not found for test");
        let db = load(&state);
        assert!(!db.ministerial_positions.is_empty(), "expected court office titles");

        // The generic Han variant (no faction, 3k_main_chinese subculture) of minister_earth
        // is "Chancellor"; the governor is "Administrator".
        let han = |pos: &str| {
            db.ministerial_positions
                .iter()
                .find(|p| {
                    p.position_key == pos
                        && p.faction.is_empty()
                        && p.subculture == "3k_main_chinese"
                })
                .map(|p| p.title.as_str())
        };
        assert_eq!(han("3k_main_court_offices_minister_earth"), Some("Chancellor"));
        assert_eq!(han("3k_main_court_offices_minister_fire"), Some("Grand Commandant"));
        assert_eq!(han("3k_main_court_offices_governor"), Some("Administrator"));
    }
}
