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

/// Find the first `.lua` under `<root>/script` whose contents call
/// `set_context_value("<script_id>"` — the script that publishes the panel data.
pub fn find_by_id(state: &AppState, script_id: &str) -> Option<ScriptHit> {
    let root = state.data_root()?;
    let needle = format!("set_context_value(\"{script_id}\"");
    let mut stack = vec![root.join("script")];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().and_then(|e| e.to_str()) == Some("lua") {
                if let Ok(text) = std::fs::read_to_string(&path) {
                    if text.contains(&needle) {
                        let rel = path
                            .strip_prefix(&root)
                            .unwrap_or(&path)
                            .to_string_lossy()
                            .replace('\\', "/");
                        return Some(ScriptHit { path: rel, text });
                    }
                }
            }
        }
    }
    None
}

/// Read a `.lua` file, sandboxed to the data root. Accepts an absolute path
/// (from the file dialog) that lies under the root, or a root-relative path.
pub fn read_file(state: &AppState, path: &str) -> Result<String, String> {
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
