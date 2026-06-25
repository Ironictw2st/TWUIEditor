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

/// List selectable background images under `background/`.
#[tauri::command]
pub fn list_backgrounds(state: State<AppState>) -> Vec<String> {
    state.list(&|p| {
        p.starts_with("background/")
            && matches!(
                p.rsplit('.').next().unwrap_or(""),
                "png" | "jpg" | "jpeg" | "dds"
            )
    })
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
    for id in ids {
        // template_id should be a bare name; guard against path escapes.
        if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
            continue;
        }
        let rel = format!("ui/templates/{id}.twui.xml");
        if let Some(content) = state.read_text(&rel) {
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
    for rel in paths {
        if rel.is_empty() || rel.contains("..") || std::path::Path::new(&rel).is_absolute() {
            continue;
        }
        if let Some(content) = state.read_text(&format!("{rel}.twui.xml")) {
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

/// Switch to pack mode: read the `.pack` files under `game_dir` (read-only).
/// `include_mods=false` loads only vanilla (non-Mod-type) packs.
#[tauri::command]
pub fn set_pack_source(
    state: State<AppState>,
    game_dir: String,
    include_mods: bool,
) -> Result<(), String> {
    state.set_pack_source(std::path::PathBuf::from(game_dir), include_mods)
}

/// True when the active source is `.pack` archives (vs a loose folder).
#[tauri::command]
pub fn is_pack_mode(state: State<AppState>) -> bool {
    state.pack_mode()
}

/// Every `.twui.xml` reachable from the active source, as relative paths —
/// backs the pack content browser (also works in folder mode).
#[tauri::command]
pub fn list_layouts(state: State<AppState>) -> Vec<String> {
    state.list(&|p| p.ends_with(".twui.xml"))
}

/// Every image (png/dds/tga/jpg) reachable from the active source — backs the
/// Pack Files panel's image finder.
#[tauri::command]
pub fn list_images(state: State<AppState>) -> Vec<String> {
    state.list(&|p| {
        matches!(
            p.rsplit('.').next().unwrap_or(""),
            "png" | "dds" | "tga" | "jpg" | "jpeg"
        )
    })
}

/// Overlay a single `.pack` over the active source (reads resolve from it first,
/// then fall back). The path is an absolute file path from the OS dialog.
#[tauri::command]
pub fn set_overlay_pack(state: State<AppState>, path: String) -> Result<(), String> {
    state.set_overlay_pack(std::path::PathBuf::from(path))
}

/// Remove the single-pack overlay, restoring the base source.
#[tauri::command]
pub fn clear_overlay_pack(state: State<AppState>) {
    state.clear_overlay_pack();
}

/// The active single-pack overlay path, or None.
#[tauri::command]
pub fn get_overlay_pack(state: State<AppState>) -> Option<String> {
    state.overlay_pack().map(|p| p.to_string_lossy().into_owned())
}

/// The configured RPFM `.ron` schema path (decodes binary db tables), or None.
#[tauri::command]
pub fn get_schema_path(state: State<AppState>) -> Option<String> {
    state.schema_path().map(|p| p.to_string_lossy().into_owned())
}

/// Point at the user's local RPFM `.ron` schema file (e.g. `schema_3k.ron`).
#[tauri::command]
pub fn set_schema_path(state: State<AppState>, path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.is_file() {
        return Err(format!("'{path}' is not a file"));
    }
    state.set_schema_path(p);
    Ok(())
}

/// Read+parse a layout by source-relative path (used to open files from the
/// pack content browser; folder mode resolves under the data root).
#[tauri::command]
pub fn read_layout_rel(state: State<AppState>, rel: String) -> Result<Document, String> {
    let content = state
        .read_text(&rel)
        .ok_or_else(|| format!("Failed to read {rel} from data source"))?;
    parse::parse(&content)
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
