//! Tauri command surface exposed to the frontend.

use crate::character::{self, CharacterDb};
use crate::cco_docs::{self, CcoDocs};
use crate::cco_shorthand::{self, CcoShorthand};
use crate::db::{self, ContextDb};
use crate::image::{self, ImageStatus};
use crate::loc;
use crate::model::{parse, serialize, Document, Element};
use crate::script::{self, ScriptHit};
use crate::state::AppState;
use tauri::State;

/// Serialize a single component/hierarchy element to UIEd-style XML text
/// (reuses the document serializer at depth 0; output matches Save).
#[tauri::command]
pub fn serialize_element(element: Element) -> String {
    serialize::serialize(&Document {
        prolog: Vec::new(),
        root: element,
    })
}

/// Parse a single `<tag …>…</tag>` fragment back into an element.
#[tauri::command]
pub fn parse_element(text: String) -> Result<Element, String> {
    parse::parse(&text).map(|d| d.root)
}

/// List selectable background images under `<data_root>/background`.
#[tauri::command]
pub fn list_backgrounds(state: State<AppState>) -> Vec<String> {
    let Some(root) = state.data_root() else {
        return Vec::new();
    };
    let dir = root.join("background");
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
            if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "dds") {
                out.push(format!("background/{name}"));
            }
        }
    }
    out.sort();
    out
}

#[tauri::command]
pub fn load_context_db(state: State<AppState>) -> ContextDb {
    db::load(state.inner())
}

/// Load the character generation templates and their resolved portrait folders,
/// for the Characters panel (assigning characters to a screen's roles).
#[tauri::command]
pub fn load_character_db(state: State<AppState>) -> CharacterDb {
    character::load(state.inner())
}

/// Parse the CCO symbol table from the game's UI documentation (Inspector hints).
#[tauri::command]
pub fn load_cco_docs(state: State<AppState>) -> CcoDocs {
    cco_docs::load(state.inner())
}

/// Load the content-defined CCO shorthand macros (`ui/cco/*.json`) — named
/// expressions components reference by name in `context_function_id`.
#[tauri::command]
pub fn load_cco_shorthand(state: State<AppState>) -> CcoShorthand {
    cco_shorthand::load(state.inner())
}

/// Load localised UI strings (campaign_localised_strings) keyed by bare record
/// key — used to show real text where the `.twui.xml` only has a loc label.
#[tauri::command]
pub fn load_loc(state: State<AppState>) -> std::collections::HashMap<String, String> {
    loc::load(state.inner())
}

/// Locate the Lua script backing a panel's `script_id` (the file that calls
/// `set_context_value("<id>", …)`). Returns its data-root-relative path + text.
#[tauri::command]
pub fn find_script(state: State<AppState>, script_id: String) -> Option<ScriptHit> {
    script::find_by_id(state.inner(), &script_id)
}

/// Read a `.lua` script file (sandboxed to the data root) for manual connection.
#[tauri::command]
pub fn read_script(state: State<AppState>, path: String) -> Result<String, String> {
    script::read_file(state.inner(), &path)
}

/// Read and parse template layouts referenced by `template_id`, keyed by id.
/// Resolves `<data_root>/ui/templates/<id>.twui.xml`; missing/unparseable ids
/// are silently skipped.
#[tauri::command]
pub fn load_templates(
    state: State<AppState>,
    ids: Vec<String>,
) -> std::collections::HashMap<String, Document> {
    let mut out = std::collections::HashMap::new();
    let Some(root) = state.data_root() else {
        return out;
    };
    for id in ids {
        // template_id should be a bare name; guard against path escapes.
        if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
            continue;
        }
        let path = root.join("ui").join("templates").join(format!("{id}.twui.xml"));
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(doc) = parse::parse(&content) {
                out.insert(id, doc);
            }
        }
    }
    out
}

/// Read and parse layouts referenced by `ComponentCreator` (arbitrary paths under
/// the data root, e.g. `ui/campaign ui/court_screen_minister_slot`). Keyed by the
/// given path; missing/unparseable/escaping paths are skipped.
#[tauri::command]
pub fn load_layouts(
    state: State<AppState>,
    paths: Vec<String>,
) -> std::collections::HashMap<String, Document> {
    let mut out = std::collections::HashMap::new();
    let Some(root) = state.data_root() else {
        return out;
    };
    for rel in paths {
        if rel.is_empty() || rel.contains("..") || std::path::Path::new(&rel).is_absolute() {
            continue;
        }
        let path = root.join(format!("{rel}.twui.xml"));
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(doc) = parse::parse(&content) {
                out.insert(rel, doc);
            }
        }
    }
    out
}

#[tauri::command]
pub fn get_data_root(state: State<AppState>) -> Option<String> {
    state.data_root().map(|p| p.to_string_lossy().into_owned())
}

/// Names of the games available under the `games/` directory (3K, WH3, …).
#[tauri::command]
pub fn list_games() -> Vec<String> {
    crate::state::games_dir()
        .map(|d| crate::state::list_games_in(&d))
        .unwrap_or_default()
}

/// The currently-selected game name (the data root's folder, when it's a game
/// under `games/`); None for a custom/legacy data root.
#[tauri::command]
pub fn current_game(state: State<AppState>) -> Option<String> {
    let root = state.data_root()?;
    let gd = crate::state::games_dir()?;
    if root.parent() == Some(gd.as_path()) {
        root.file_name().and_then(|n| n.to_str()).map(String::from)
    } else {
        None
    }
}

/// Switch the active game by name (a subfolder of `games/`).
#[tauri::command]
pub fn set_game(state: State<AppState>, name: String) -> Result<(), String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("invalid game name '{name}'"));
    }
    let dir = crate::state::games_dir().ok_or("no 'games' directory found")?;
    let p = dir.join(&name);
    if !p.join("ui").is_dir() {
        return Err(format!("'{name}' is not a game (no 'ui' subfolder)"));
    }
    state.set_data_root(p);
    Ok(())
}

#[tauri::command]
pub fn set_data_root(state: State<AppState>, path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.join("ui").is_dir() {
        return Err(format!(
            "'{}' does not look like a game data root (no 'ui' subfolder)",
            path
        ));
    }
    state.set_data_root(p);
    Ok(())
}

#[tauri::command]
pub fn read_layout(path: String) -> Result<Document, String> {
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {path}: {e}"))?;
    parse::parse(&content)
}

#[tauri::command]
pub fn save_layout(path: String, doc: Document) -> Result<(), String> {
    let text = serialize::serialize(&doc);
    std::fs::write(&path, text).map_err(|e| format!("Failed to write {path}: {e}"))
}

/// Round-trip a file in memory and report whether serialize(parse(x)) == x.
/// Useful as a fidelity self-check from the UI.
#[tauri::command]
pub fn roundtrip_check(path: String) -> Result<RoundtripReport, String> {
    let original =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {path}: {e}"))?;
    let doc = parse::parse(&original)?;
    let reserialized = serialize::serialize(&doc);
    let identical = original == reserialized;
    let first_diff = if identical {
        None
    } else {
        Some(first_difference(&original, &reserialized))
    };
    Ok(RoundtripReport {
        identical,
        original_len: original.len(),
        output_len: reserialized.len(),
        first_diff,
    })
}

#[derive(serde::Serialize)]
pub struct RoundtripReport {
    pub identical: bool,
    pub original_len: usize,
    pub output_len: usize,
    pub first_diff: Option<DiffInfo>,
}

#[derive(serde::Serialize)]
pub struct DiffInfo {
    pub byte_offset: usize,
    pub original_excerpt: String,
    pub output_excerpt: String,
}

fn first_difference(a: &str, b: &str) -> DiffInfo {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    let mut i = 0;
    while i < ab.len() && i < bb.len() && ab[i] == bb[i] {
        i += 1;
    }
    let start = i.saturating_sub(40);
    DiffInfo {
        byte_offset: i,
        original_excerpt: String::from_utf8_lossy(&ab[start..(i + 40).min(ab.len())]).into_owned(),
        output_excerpt: String::from_utf8_lossy(&bb[start..(i + 40).min(bb.len())]).into_owned(),
    }
}

#[tauri::command]
pub fn image_status(state: State<AppState>, image_path: String) -> ImageStatus {
    image::status(state.inner(), &image_path)
}
