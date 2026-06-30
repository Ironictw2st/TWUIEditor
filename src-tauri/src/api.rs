//! Backend command logic, shared by two front-ends:
//!  - the Tauri `#[command]` shims in `commands.rs` (desktop webview), and
//!  - the experimental web server's HTTP dispatcher in `web/` (remote browser).
//!
//! Every function that needs application state takes `&AppState`, which both
//! callers can produce: a Tauri `State<AppState>` derefs to `&AppState`, and the
//! web server gets one via `AppHandle::state::<AppState>()`. Keeping the logic
//! here (rather than in the command bodies) means there is exactly ONE
//! implementation of each operation — in particular one `save_layout`, so the
//! byte-identical round-trip guarantee can't drift between the two transports.

use crate::character::{self, CharacterDb};
use crate::cco_docs::{self, CcoDocs};
use crate::cco_shorthand::{self, CcoShorthand};
use crate::db::{self, ContextDb};
use crate::image::{self, ImageStatus};
use crate::loc;
use crate::model::{parse, serialize, Document, Element};
use crate::script::{self, ScriptHit};
use crate::state::AppState;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

// --- Layout / element ------------------------------------------------------

/// Serialize a single component/hierarchy element to UIEd-style XML text.
pub fn serialize_element(element: Element) -> String {
    serialize::serialize(&Document {
        prolog: Vec::new(),
        root: element,
    })
}

/// Parse a single `<tag …>…</tag>` fragment back into an element.
pub fn parse_element(text: &str) -> Result<Element, String> {
    parse::parse(text).map(|d| d.root)
}

/// Read+parse a layout by source-relative path (open from the pack browser).
pub fn read_layout_rel(state: &AppState, rel: &str) -> Result<Document, String> {
    let content = state
        .read_text(rel)
        .ok_or_else(|| format!("Failed to read {rel} from data source"))?;
    parse::parse(&content)
}

/// Read+parse a layout from an absolute host path (folder-mode open).
pub fn read_layout(path: &str) -> Result<Document, String> {
    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read {path}: {e}"))?;
    parse::parse(&content)
}

/// Serialize `doc` and write it to an absolute host path. This is the only
/// write path; its output is what the byte-identical guarantee protects.
pub fn save_layout(path: &str, doc: Document) -> Result<(), String> {
    let text = serialize::serialize(&doc);
    std::fs::write(path, text).map_err(|e| format!("Failed to write {path}: {e}"))
}

/// Round-trip a file in memory and report whether serialize(parse(x)) == x.
pub fn roundtrip_check(path: &str) -> Result<RoundtripReport, String> {
    let original =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read {path}: {e}"))?;
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

// --- Listing / discovery ---------------------------------------------------

/// List selectable background images under `background/`.
pub fn list_backgrounds(state: &AppState) -> Vec<String> {
    state.list(&|p| {
        p.starts_with("background/")
            && matches!(
                p.rsplit('.').next().unwrap_or(""),
                "png" | "jpg" | "jpeg" | "dds"
            )
    })
}

/// Every `.twui.xml` reachable from the active source.
pub fn list_layouts(state: &AppState) -> Vec<String> {
    state.list(&|p| p.ends_with(".twui.xml"))
}

/// Every image (png/dds/tga/jpg) reachable from the active source.
pub fn list_images(state: &AppState) -> Vec<String> {
    state.list(&|p| {
        matches!(
            p.rsplit('.').next().unwrap_or(""),
            "png" | "dds" | "tga" | "jpg" | "jpeg"
        )
    })
}

// --- Game data loaders (all already take &AppState) ------------------------

pub fn load_context_db(state: &AppState) -> ContextDb {
    db::load(state)
}

pub fn load_character_db(state: &AppState) -> CharacterDb {
    character::load(state)
}

pub fn load_cco_docs(state: &AppState) -> CcoDocs {
    cco_docs::load(state)
}

pub fn load_cco_shorthand(state: &AppState) -> CcoShorthand {
    cco_shorthand::load(state)
}

pub fn load_loc(state: &AppState) -> HashMap<String, String> {
    loc::load(state)
}

pub fn find_script(state: &AppState, script_id: &str) -> Option<ScriptHit> {
    script::find_by_id(state, script_id)
}

pub fn read_script(state: &AppState, path: &str) -> Result<String, String> {
    script::read_file(state, path)
}

/// Read+parse `ui/templates/<id>.twui.xml` for each id; skip missing/unsafe ids.
pub fn load_templates(state: &AppState, ids: Vec<String>) -> HashMap<String, Document> {
    let mut out = HashMap::new();
    for id in ids {
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

/// Read+parse layouts referenced by ComponentCreator; skip missing/escaping paths.
pub fn load_layouts(state: &AppState, paths: Vec<String>) -> HashMap<String, Document> {
    let mut out = HashMap::new();
    for rel in paths {
        if rel.is_empty() || rel.contains("..") || Path::new(&rel).is_absolute() {
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

pub fn image_status(state: &AppState, image_path: &str) -> ImageStatus {
    image::status(state, image_path)
}

// --- Data root / game / source selection -----------------------------------

pub fn get_data_root(state: &AppState) -> Option<String> {
    state.data_root().map(|p| p.to_string_lossy().into_owned())
}

pub fn list_games() -> Vec<String> {
    crate::state::games_dir()
        .map(|d| crate::state::list_games_in(&d))
        .unwrap_or_default()
}

pub fn current_game(state: &AppState) -> Option<String> {
    let root = state.data_root()?;
    let gd = crate::state::games_dir()?;
    if root.parent() == Some(gd.as_path()) {
        root.file_name().and_then(|n| n.to_str()).map(String::from)
    } else {
        None
    }
}

pub fn set_game(state: &AppState, name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("invalid game name '{name}'"));
    }
    let dir = crate::state::games_dir().ok_or("no 'games' directory found")?;
    let p = dir.join(name);
    if !p.join("ui").is_dir() {
        return Err(format!("'{name}' is not a game (no 'ui' subfolder)"));
    }
    // Record the rpfm game (selects the pack GameInfo + bundled schema) before swapping the source.
    state.set_game_key(name);
    state.set_data_root(p);
    Ok(())
}

pub fn set_data_root(state: &AppState, path: &str) -> Result<(), String> {
    let p = PathBuf::from(path);
    if !p.join("ui").is_dir() {
        return Err(format!(
            "'{path}' does not look like a game data root (no 'ui' subfolder)"
        ));
    }
    state.set_data_root(p);
    Ok(())
}

pub fn set_pack_source(state: &AppState, game_dir: &str, include_mods: bool) -> Result<(), String> {
    state.set_pack_source(PathBuf::from(game_dir), include_mods)
}

pub fn is_pack_mode(state: &AppState) -> bool {
    state.pack_mode()
}

pub fn set_overlay_pack(state: &AppState, path: &str) -> Result<(), String> {
    state.set_overlay_pack(PathBuf::from(path))
}

pub fn clear_overlay_pack(state: &AppState) {
    state.clear_overlay_pack();
}

pub fn get_overlay_pack(state: &AppState) -> Option<String> {
    state.overlay_pack().map(|p| p.to_string_lossy().into_owned())
}

pub fn get_schema_path(state: &AppState) -> Option<String> {
    state.schema_path().map(|p| p.to_string_lossy().into_owned())
}

pub fn set_schema_path(state: &AppState, path: &str) -> Result<(), String> {
    let p = PathBuf::from(path);
    if !p.is_file() {
        return Err(format!("'{path}' is not a file"));
    }
    state.set_schema_path(p);
    Ok(())
}

// --- Host file browser (web mode) ------------------------------------------
//
// A remote browser has no native file dialog, so it picks host paths through
// these. They only LIST directories (never return file contents) and are not
// sandboxed to the data root — choosing a game folder / `.pack` / save target
// requires browsing the host freely. Access is gated by the server's password.

#[derive(serde::Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(serde::Serialize)]
pub struct DirListing {
    /// The directory listed, or `None` for the drive/root list.
    pub path: Option<String>,
    /// The parent directory (to navigate "up"), or `None` at a drive root.
    pub parent: Option<String>,
    pub entries: Vec<DirEntry>,
}

#[derive(serde::Serialize)]
pub struct HostPaths {
    pub data_root: Option<String>,
    pub games_dir: Option<String>,
}

/// List directory contents on the host. `None`/empty lists filesystem roots
/// (Windows drive letters, or `/` on Unix); otherwise lists `path`'s children.
pub fn host_list_dir(path: Option<&str>) -> Result<DirListing, String> {
    let path = path.filter(|p| !p.is_empty());
    let Some(dir) = path else {
        return Ok(DirListing {
            path: None,
            parent: None,
            entries: filesystem_roots(),
        });
    };

    let dir_path = PathBuf::from(dir);
    let read = std::fs::read_dir(&dir_path).map_err(|e| format!("Cannot open {dir}: {e}"))?;
    let mut entries: Vec<DirEntry> = Vec::new();
    for e in read.flatten() {
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let name = e.file_name().to_string_lossy().into_owned();
        let full = e.path().to_string_lossy().into_owned();
        entries.push(DirEntry {
            name,
            path: full,
            is_dir,
        });
    }
    // Directories first, then files; case-insensitive by name within each group.
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(DirListing {
        path: Some(dir_path.to_string_lossy().into_owned()),
        parent: dir_path
            .parent()
            .map(|p| p.to_string_lossy().into_owned()),
        entries,
    })
}

/// Suggested starting points for the host file browser.
pub fn host_default_paths(state: &AppState) -> HostPaths {
    HostPaths {
        data_root: state.data_root().map(|p| p.to_string_lossy().into_owned()),
        games_dir: crate::state::games_dir().map(|p| p.to_string_lossy().into_owned()),
    }
}

#[cfg(windows)]
fn filesystem_roots() -> Vec<DirEntry> {
    let mut out = Vec::new();
    for letter in b'A'..=b'Z' {
        let root = format!("{}:\\", letter as char);
        if Path::new(&root).is_dir() {
            out.push(DirEntry {
                name: root.clone(),
                path: root,
                is_dir: true,
            });
        }
    }
    out
}

#[cfg(not(windows))]
fn filesystem_roots() -> Vec<DirEntry> {
    vec![DirEntry {
        name: "/".into(),
        path: "/".into(),
        is_dir: true,
    }]
}

// --- HTTP dispatch ---------------------------------------------------------
//
// Maps a command name + JSON args (camelCase, exactly as the TS wrappers send
// them) to the matching function above. Returns the JSON-encoded result, or an
// error string (surfaced as an HTTP 400 with the message as the body, so the
// browser-side `invoke` rejects with the same bare string Tauri would).

fn de<T: DeserializeOwned>(args: Value) -> Result<T, String> {
    serde_json::from_value(args).map_err(|e| format!("invalid arguments: {e}"))
}

fn ok<T: serde::Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| format!("failed to encode result: {e}"))
}

pub fn dispatch(state: &AppState, cmd: &str, args: Value) -> Result<Value, String> {
    use serde::Deserialize;
    match cmd {
        // --- no-arg / state-only ---
        "get_data_root" => ok(get_data_root(state)),
        "list_games" => ok(list_games()),
        "current_game" => ok(current_game(state)),
        "is_pack_mode" => ok(is_pack_mode(state)),
        "list_layouts" => ok(list_layouts(state)),
        "list_images" => ok(list_images(state)),
        "list_backgrounds" => ok(list_backgrounds(state)),
        "get_overlay_pack" => ok(get_overlay_pack(state)),
        "clear_overlay_pack" => ok(clear_overlay_pack(state)),
        "get_schema_path" => ok(get_schema_path(state)),
        "load_context_db" => ok(load_context_db(state)),
        "load_character_db" => ok(load_character_db(state)),
        "load_cco_docs" => ok(load_cco_docs(state)),
        "load_cco_shorthand" => ok(load_cco_shorthand(state)),
        "load_loc" => ok(load_loc(state)),
        "host_default_paths" => ok(host_default_paths(state)),

        // --- with args ---
        "set_data_root" => {
            #[derive(Deserialize)]
            struct A {
                path: String,
            }
            let a: A = de(args)?;
            ok(set_data_root(state, &a.path)?)
        }
        "set_game" => {
            #[derive(Deserialize)]
            struct A {
                name: String,
            }
            let a: A = de(args)?;
            ok(set_game(state, &a.name)?)
        }
        "set_pack_source" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct A {
                game_dir: String,
                include_mods: bool,
            }
            let a: A = de(args)?;
            ok(set_pack_source(state, &a.game_dir, a.include_mods)?)
        }
        "set_overlay_pack" => {
            #[derive(Deserialize)]
            struct A {
                path: String,
            }
            let a: A = de(args)?;
            ok(set_overlay_pack(state, &a.path)?)
        }
        "set_schema_path" => {
            #[derive(Deserialize)]
            struct A {
                path: String,
            }
            let a: A = de(args)?;
            ok(set_schema_path(state, &a.path)?)
        }
        "read_layout_rel" => {
            #[derive(Deserialize)]
            struct A {
                rel: String,
            }
            let a: A = de(args)?;
            ok(read_layout_rel(state, &a.rel)?)
        }
        "read_layout" => {
            #[derive(Deserialize)]
            struct A {
                path: String,
            }
            let a: A = de(args)?;
            ok(read_layout(&a.path)?)
        }
        "save_layout" => {
            #[derive(Deserialize)]
            struct A {
                path: String,
                doc: Document,
            }
            let a: A = de(args)?;
            ok(save_layout(&a.path, a.doc)?)
        }
        "roundtrip_check" => {
            #[derive(Deserialize)]
            struct A {
                path: String,
            }
            let a: A = de(args)?;
            ok(roundtrip_check(&a.path)?)
        }
        "image_status" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct A {
                image_path: String,
            }
            let a: A = de(args)?;
            ok(image_status(state, &a.image_path))
        }
        "find_script" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct A {
                script_id: String,
            }
            let a: A = de(args)?;
            ok(find_script(state, &a.script_id))
        }
        "read_script" => {
            #[derive(Deserialize)]
            struct A {
                path: String,
            }
            let a: A = de(args)?;
            ok(read_script(state, &a.path)?)
        }
        "load_templates" => {
            #[derive(Deserialize)]
            struct A {
                ids: Vec<String>,
            }
            let a: A = de(args)?;
            ok(load_templates(state, a.ids))
        }
        "load_layouts" => {
            #[derive(Deserialize)]
            struct A {
                paths: Vec<String>,
            }
            let a: A = de(args)?;
            ok(load_layouts(state, a.paths))
        }
        "serialize_element" => {
            #[derive(Deserialize)]
            struct A {
                element: Element,
            }
            let a: A = de(args)?;
            ok(serialize_element(a.element))
        }
        "parse_element" => {
            #[derive(Deserialize)]
            struct A {
                text: String,
            }
            let a: A = de(args)?;
            ok(parse_element(&a.text)?)
        }
        "host_list_dir" => {
            #[derive(Deserialize)]
            struct A {
                path: Option<String>,
            }
            let a: A = de(args)?;
            ok(host_list_dir(a.path.as_deref())?)
        }

        // Desktop/native-only commands have no web equivalent.
        "capture_app_window" | "submit_bug_report" | "check_update" | "install_update" => {
            Err(format!("'{cmd}' is not available over web access"))
        }
        other => Err(format!("unknown command '{other}'")),
    }
}

#[cfg(test)]
mod tests {
    use super::dispatch;
    use crate::state::AppState;
    use serde_json::json;

    #[test]
    fn unknown_command_is_rejected() {
        let st = AppState::new();
        let err = dispatch(&st, "definitely_not_a_command", json!({})).unwrap_err();
        assert!(err.contains("unknown command"), "got: {err}");
    }

    #[test]
    fn desktop_only_commands_are_rejected() {
        let st = AppState::new();
        for cmd in ["capture_app_window", "submit_bug_report", "check_update", "install_update"] {
            let err = dispatch(&st, cmd, json!({})).unwrap_err();
            assert!(err.contains("not available over web"), "{cmd} -> {err}");
        }
    }

    #[test]
    fn camelcase_args_deserialize() {
        // set_pack_source takes camelCase {gameDir, includeMods}. With a bogus dir it
        // must fail in set_pack_source (not at argument parsing) — proving the
        // camelCase rename matched the TS wrapper's payload shape.
        let st = AppState::new();
        let err = dispatch(
            &st,
            "set_pack_source",
            json!({ "gameDir": "/no/such/dir/twui-test", "includeMods": false }),
        )
        .unwrap_err();
        assert!(!err.contains("invalid arguments"), "args failed to parse: {err}");
    }

    #[test]
    fn host_list_dir_lists_roots() {
        let st = AppState::new();
        let v = dispatch(&st, "host_list_dir", json!({ "path": null })).unwrap();
        assert!(v.get("entries").and_then(|e| e.as_array()).is_some());
    }
}
