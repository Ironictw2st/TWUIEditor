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
    /// campaign/start-pos keys, `3k_main_campaign_map` first.
    pub campaigns: Vec<String>,
    /// campaign key -> faction keys playable in it.
    pub campaign_factions: std::collections::HashMap<String, Vec<String>>,
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
        // Campaign list with the main map first, then the rest alphabetically.
        let mut campaigns: Vec<String> = out.campaign_factions.keys().cloned().collect();
        campaigns.sort();
        const MAIN: &str = "3k_main_campaign_map";
        if let Some(pos) = campaigns.iter().position(|c| c == MAIN) {
            campaigns.remove(pos);
            campaigns.insert(0, MAIN.to_string());
        }
        out.campaigns = campaigns;
    }

    out
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
}
