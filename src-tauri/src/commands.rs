//! Tauri command surface exposed to the desktop webview. Each command is a thin
//! shim over `crate::api`, which holds the actual logic and is shared with the
//! experimental web server (see `web/`). Keep behavior changes in `api.rs`.

use crate::api::{self, RoundtripReport};
use crate::character::CharacterDb;
use crate::cco_docs::CcoDocs;
use crate::cco_shorthand::CcoShorthand;
use crate::db::ContextDb;
use crate::image::ImageStatus;
use crate::model::{Document, Element};
use crate::script::ScriptHit;
use crate::state::AppState;
use tauri::State;

/// Serialize a single component/hierarchy element to UIEd-style XML text
/// (reuses the document serializer at depth 0; output matches Save).
#[tauri::command]
pub fn serialize_element(element: Element) -> String {
    api::serialize_element(element)
}

/// Parse a single `<tag …>…</tag>` fragment back into an element.
#[tauri::command]
pub fn parse_element(text: String) -> Result<Element, String> {
    api::parse_element(&text)
}

/// List selectable background images under `background/`.
#[tauri::command]
pub fn list_backgrounds(state: State<AppState>) -> Vec<String> {
    api::list_backgrounds(&state)
}

#[tauri::command]
pub fn load_context_db(state: State<AppState>) -> ContextDb {
    api::load_context_db(&state)
}

/// Load the character generation templates and their resolved portrait folders,
/// for the Characters panel (assigning characters to a screen's roles).
#[tauri::command]
pub fn load_character_db(state: State<AppState>) -> CharacterDb {
    api::load_character_db(&state)
}

/// Parse the CCO symbol table from the game's UI documentation (Inspector hints).
#[tauri::command]
pub fn load_cco_docs(state: State<AppState>) -> CcoDocs {
    api::load_cco_docs(&state)
}

/// Load the content-defined CCO shorthand macros (`ui/cco/*.json`) — named
/// expressions components reference by name in `context_function_id`.
#[tauri::command]
pub fn load_cco_shorthand(state: State<AppState>) -> CcoShorthand {
    api::load_cco_shorthand(&state)
}

/// Load localised UI strings (campaign_localised_strings) keyed by bare record
/// key — used to show real text where the `.twui.xml` only has a loc label.
#[tauri::command]
pub fn load_loc(state: State<AppState>) -> std::collections::HashMap<String, String> {
    api::load_loc(&state)
}

/// Locate the Lua script backing a panel's `script_id` (the file that calls
/// `set_context_value("<id>", …)`). Returns its data-root-relative path + text.
#[tauri::command]
pub fn find_script(state: State<AppState>, script_id: String) -> Option<ScriptHit> {
    api::find_script(&state, &script_id)
}

/// Read a `.lua` script file (sandboxed to the data root) for manual connection.
#[tauri::command]
pub fn read_script(state: State<AppState>, path: String) -> Result<String, String> {
    api::read_script(&state, &path)
}

/// Read a DB table (header + stringified rows) for the preview-binding feature.
/// Missing/undecodable table -> empty header+rows.
#[tauri::command]
pub fn read_db_table(state: State<AppState>, table: String) -> api::DbTable {
    api::read_db_table(&state, &table)
}

/// Read and parse template layouts referenced by `template_id`, keyed by id.
#[tauri::command]
pub fn load_templates(
    state: State<AppState>,
    ids: Vec<String>,
) -> std::collections::HashMap<String, Document> {
    api::load_templates(&state, ids)
}

/// Read and parse layouts referenced by `ComponentCreator` (arbitrary paths under
/// the data root), keyed by the given path.
#[tauri::command]
pub fn load_layouts(
    state: State<AppState>,
    paths: Vec<String>,
) -> std::collections::HashMap<String, Document> {
    api::load_layouts(&state, paths)
}

#[tauri::command]
pub fn get_data_root(state: State<AppState>) -> Option<String> {
    api::get_data_root(&state)
}

/// Names of the games available under the `games/` directory (3K, WH3, …).
#[tauri::command]
pub fn list_games() -> Vec<String> {
    api::list_games()
}

/// The currently-selected game name (the data root's folder, when it's a game
/// under `games/`); None for a custom/legacy data root.
#[tauri::command]
pub fn current_game(state: State<AppState>) -> Option<String> {
    api::current_game(&state)
}

/// Switch the active game by name (a subfolder of `games/`).
#[tauri::command]
pub fn set_game(state: State<AppState>, name: String) -> Result<(), String> {
    api::set_game(&state, &name)
}

/// Update the active rpfm game key + drop game-specific caches, without re-pointing the data root.
#[tauri::command]
pub fn set_game_key(state: State<AppState>, name: String) -> Result<(), String> {
    api::set_game_key(&state, &name)
}

#[tauri::command]
pub fn set_data_root(state: State<AppState>, path: String) -> Result<(), String> {
    api::set_data_root(&state, &path)
}

/// Switch to pack mode: read the `.pack` files under `game_dir` (read-only).
/// `include_mods=false` loads only vanilla (non-Mod-type) packs.
#[tauri::command]
pub fn set_pack_source(
    state: State<AppState>,
    game_dir: String,
    include_mods: bool,
) -> Result<(), String> {
    api::set_pack_source(&state, &game_dir, include_mods)
}

/// True when the active source is `.pack` archives (vs a loose folder).
#[tauri::command]
pub fn is_pack_mode(state: State<AppState>) -> bool {
    api::is_pack_mode(&state)
}

/// Every `.twui.xml` reachable from the active source, as relative paths.
#[tauri::command]
pub fn list_layouts(state: State<AppState>) -> Vec<String> {
    api::list_layouts(&state)
}

/// Every image (png/dds/tga/jpg) reachable from the active source.
#[tauri::command]
pub fn list_images(state: State<AppState>) -> Vec<String> {
    api::list_images(&state)
}

/// Overlay a single `.pack` over the active source (reads resolve from it first,
/// then fall back). The path is an absolute file path from the OS dialog.
#[tauri::command]
pub fn set_overlay_pack(state: State<AppState>, path: String) -> Result<(), String> {
    api::set_overlay_pack(&state, &path)
}

/// Remove the single-pack overlay, restoring the base source.
#[tauri::command]
pub fn clear_overlay_pack(state: State<AppState>) {
    api::clear_overlay_pack(&state)
}

/// The active single-pack overlay path, or None.
#[tauri::command]
pub fn get_overlay_pack(state: State<AppState>) -> Option<String> {
    api::get_overlay_pack(&state)
}

/// The configured RPFM `.ron` schema path (decodes binary db tables), or None.
#[tauri::command]
pub fn get_schema_path(state: State<AppState>) -> Option<String> {
    api::get_schema_path(&state)
}

/// Point at the user's local RPFM `.ron` schema file (e.g. `schema_3k.ron`).
#[tauri::command]
pub fn set_schema_path(state: State<AppState>, path: String) -> Result<(), String> {
    api::set_schema_path(&state, &path)
}

/// Read+parse a layout by source-relative path (used to open files from the
/// pack content browser; folder mode resolves under the data root).
#[tauri::command]
pub fn read_layout_rel(state: State<AppState>, rel: String) -> Result<Document, String> {
    api::read_layout_rel(&state, &rel)
}

#[tauri::command]
pub fn read_layout(path: String) -> Result<Document, String> {
    api::read_layout(&path)
}

#[tauri::command]
pub fn save_layout(path: String, doc: Document) -> Result<(), String> {
    api::save_layout(&path, doc)
}

/// Write a PNG (base64 or `data:image/png;base64,...`) to an absolute host path.
#[tauri::command]
pub fn save_png(path: String, b64: String) -> Result<(), String> {
    api::save_png(&path, &b64)
}

// --- Editable pack workspace (the "Pack Editor") ---

/// Create a new empty Mod pack at `path` and open it as the editable workspace.
#[tauri::command]
pub fn new_pack_workspace(state: State<AppState>, path: String) -> Result<(), String> {
    api::new_pack_workspace(&state, &path)
}

/// Open an existing `.pack` as the editable workspace; returns its `.twui.xml` paths.
#[tauri::command]
pub fn open_pack_workspace(state: State<AppState>, path: String) -> Result<Vec<String>, String> {
    api::open_pack_workspace(&state, &path)
}

/// The `.twui.xml` paths in the open workspace pack.
#[tauri::command]
pub fn list_workspace_layouts(state: State<AppState>) -> Vec<String> {
    api::list_workspace_layouts(&state)
}

/// Read+parse a layout from the workspace pack.
#[tauri::command]
pub fn read_workspace_layout(state: State<AppState>, rel: String) -> Result<Document, String> {
    api::read_workspace_layout(&state, &rel)
}

/// Write `doc` into the workspace pack (create/replace `rel`) and persist the pack to disk.
#[tauri::command]
pub fn save_workspace_layout(
    state: State<AppState>,
    rel: String,
    doc: Document,
) -> Result<(), String> {
    api::save_workspace_layout(&state, &rel, doc)
}

/// Delete a layout from the workspace pack and persist.
#[tauri::command]
pub fn delete_workspace_layout(state: State<AppState>, rel: String) -> Result<(), String> {
    api::delete_workspace_layout(&state, &rel)
}

/// Close the editable workspace.
#[tauri::command]
pub fn close_pack_workspace(state: State<AppState>) {
    api::close_pack_workspace(&state)
}

/// The open workspace's path + dirty flag.
#[tauri::command]
pub fn pack_workspace_status(state: State<AppState>) -> api::WorkspaceStatus {
    api::pack_workspace_status(&state)
}

/// Round-trip a file in memory and report whether serialize(parse(x)) == x.
/// Useful as a fidelity self-check from the UI.
#[tauri::command]
pub fn roundtrip_check(path: String) -> Result<RoundtripReport, String> {
    api::roundtrip_check(&path)
}

#[tauri::command]
pub fn image_status(state: State<AppState>, image_path: String) -> ImageStatus {
    api::image_status(&state, &image_path)
}

// --- Host file browser (used by the web client in place of native dialogs) ---

/// List a host directory (or filesystem roots when `path` is omitted). Only
/// surfaced over the web access point, but registered for both transports.
#[tauri::command]
pub fn host_list_dir(path: Option<String>) -> Result<api::DirListing, String> {
    api::host_list_dir(path.as_deref())
}

/// Suggested starting directories for the host file browser.
#[tauri::command]
pub fn host_default_paths(state: State<AppState>) -> api::HostPaths {
    api::host_default_paths(&state)
}
