//! Locate and read the Lua script that backs a TWUI panel.
//!
//! A panel links to its data source with a `ContextInitScriptObject` callback
//! carrying `script_id="<id>"`. The backing `.lua` publishes the panel's data
//! via `effect.set_context_value("<id>", <table>)`, so we find the script by
//! searching `<root>/script` for that call. There is no manifest.

use crate::state::AppState;
use std::path::Path;

#[derive(serde::Serialize)]
pub struct ScriptHit {
    /// Path relative to the data root, forward-slashed.
    pub path: String,
    pub text: String,
}

/// Find the first `.lua` under `script/` whose contents call
/// `set_context_value("<script_id>"` — the script that publishes the panel data.
pub fn find_by_id(state: &AppState, script_id: &str) -> Option<ScriptHit> {
    let needle = format!("set_context_value(\"{script_id}\"");
    let candidates =
        state.list(&|p| p.starts_with("script/") && p.ends_with(".lua"));
    for rel in candidates {
        if let Some(text) = state.read_text(&rel) {
            if text.contains(&needle) {
                return Some(ScriptHit { path: rel, text });
            }
        }
    }
    None
}

/// Read a `.lua` file. In pack mode the path is a source-relative path read
/// straight from the pack. In folder mode it accepts an absolute path (from the
/// file dialog) under the root, or a root-relative path, with sandboxing.
pub fn read_file(state: &AppState, path: &str) -> Result<String, String> {
    if state.pack_mode() {
        if path.to_ascii_lowercase().ends_with(".lua") {
            return state
                .read_text(path)
                .ok_or_else(|| format!("cannot read {path} from pack"));
        }
        return Err("not a .lua file".into());
    }
    let root = state.data_root().ok_or("3K data root not set")?;
    let candidate = {
        let p = Path::new(path);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            root.join(path)
        }
    };
    // Canonicalize and confirm the target stays inside the data root.
    let canon = candidate
        .canonicalize()
        .map_err(|e| format!("cannot open {path}: {e}"))?;
    let root_canon = root.canonicalize().map_err(|e| e.to_string())?;
    if !canon.starts_with(&root_canon) {
        return Err("path is outside the data root".into());
    }
    if canon.extension().and_then(|e| e.to_str()) != Some("lua") {
        return Err("not a .lua file".into());
    }
    std::fs::read_to_string(&canon).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;

    #[test]
    fn finds_ambition_script_by_id() {
        let state = AppState::new();
        assert!(state.data_root().is_some(), "3K data root not found for test");
        let hit = find_by_id(&state, "dlc07_liu_yan_features").expect("script located");
        assert!(hit.path.ends_with("dlc07_faction_liu_yan_resource_manager.lua"), "got {}", hit.path);
        assert!(hit.text.contains("ambition_panel_data_pack"));
    }
}
