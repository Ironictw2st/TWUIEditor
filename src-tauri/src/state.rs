//! Shared application state: the active data source (loose folder or `.pack`
//! archives) + a decoded-image cache.

use crate::schema::Schema;
use crate::source::{
    build_index, ordered_packs, DataSource, FolderSource, OverlaySource, PackCache,
};
use lru::LruCache;
use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub inner: Mutex<Inner>,
}

pub struct Inner {
    /// Display/label path: the folder root (folder mode) or game dir (pack mode).
    pub data_root: Option<PathBuf>,
    /// True when reading from `.pack` archives rather than a loose folder.
    pub pack_mode: bool,
    /// The active reader (the overlay when one is set, else the base).
    pub source: Option<Arc<dyn DataSource>>,
    /// The base reader (folder or merged packs), kept so an overlay can be cleared.
    pub base: Option<Arc<dyn DataSource>>,
    /// The pack a single-pack overlay is reading from, if any.
    pub overlay_pack: Option<PathBuf>,
    /// Parsed pack indexes, reused across source switches (vanilla/mod, overlay).
    pub pack_cache: PackCache,
    /// Path to the user's RPFM `.ron` schema (decodes binary db tables in packs).
    pub schema_path: Option<PathBuf>,
    /// Parsed schema cache (rebuilt when `schema_path` changes).
    pub schema: Option<Arc<Schema>>,
    /// Full-key localised-string map for the active source (binary `.loc` + TSV),
    /// cached so the db + loc consumers don't each re-scan. Cleared on source change.
    pub loc_cache: Option<Arc<HashMap<String, String>>>,
    pub image_cache: LruCache<String, Vec<u8>>,
}

impl AppState {
    pub fn new() -> Self {
        let root = guess_data_root();
        let base: Option<Arc<dyn DataSource>> = root
            .clone()
            .map(|r| Arc::new(FolderSource::new(r)) as Arc<dyn DataSource>);
        AppState {
            inner: Mutex::new(Inner {
                data_root: root,
                pack_mode: false,
                source: base.clone(),
                base,
                overlay_pack: None,
                pack_cache: PackCache::new(),
                schema_path: default_schema_path(),
                schema: None,
                loc_cache: None,
                image_cache: LruCache::new(NonZeroUsize::new(512).unwrap()),
            }),
        }
    }

    /// The label path (folder root, or game dir in pack mode).
    pub fn data_root(&self) -> Option<PathBuf> {
        self.inner.lock().unwrap().data_root.clone()
    }

    pub fn pack_mode(&self) -> bool {
        self.inner.lock().unwrap().pack_mode
    }

    pub fn has_source(&self) -> bool {
        self.inner.lock().unwrap().source.is_some()
    }

    /// The active single-pack overlay path, if any.
    pub fn overlay_pack(&self) -> Option<PathBuf> {
        self.inner.lock().unwrap().overlay_pack.clone()
    }

    /// Switch to loose-folder mode rooted at `p` (clears any overlay).
    pub fn set_data_root(&self, p: PathBuf) {
        let src = Arc::new(FolderSource::new(p.clone())) as Arc<dyn DataSource>;
        let mut g = self.inner.lock().unwrap();
        g.data_root = Some(p);
        g.pack_mode = false;
        g.base = Some(src.clone());
        g.source = Some(src);
        g.overlay_pack = None;
        g.loc_cache = None;
        g.image_cache.clear();
    }

    /// Switch to pack mode, reading the `.pack` files under `game_dir`. When
    /// `include_mods` is false, only vanilla (non-Mod-type) packs are loaded.
    /// Clears any overlay; reuses cached pack indexes.
    pub fn set_pack_source(&self, game_dir: PathBuf, include_mods: bool) -> Result<(), String> {
        let paths = ordered_packs(&game_dir, include_mods)?;
        // Parse the pack indexes OUTSIDE the lock (cold-cache is ~1.3 s for a full
        // install) so the image handler / reads aren't blocked. Borrow the cache
        // out, build, then put it back warmed.
        let mut cache = std::mem::take(&mut self.inner.lock().unwrap().pack_cache);
        let src = build_index(&paths, &mut cache);
        let empty = src.is_empty();
        let arc = Arc::new(src) as Arc<dyn DataSource>;
        let mut g = self.inner.lock().unwrap();
        g.pack_cache = cache;
        if empty {
            return Err("no readable .pack files (all unsupported/encrypted)".into());
        }
        g.data_root = Some(game_dir);
        g.pack_mode = true;
        g.base = Some(arc.clone());
        g.source = Some(arc);
        g.overlay_pack = None;
        g.loc_cache = None;
        g.image_cache.clear();
        Ok(())
    }

    /// Overlay a single `.pack` over the current base: reads resolve from it
    /// first, then fall back to the base. Requires a base source already set.
    pub fn set_overlay_pack(&self, pack: PathBuf) -> Result<(), String> {
        let Some(base) = self.inner.lock().unwrap().base.clone() else {
            return Err("no base source to overlay onto".into());
        };
        // Parse outside the lock (see set_pack_source).
        let mut cache = std::mem::take(&mut self.inner.lock().unwrap().pack_cache);
        let top = build_index(std::slice::from_ref(&pack), &mut cache);
        let empty = top.is_empty();
        let mut g = self.inner.lock().unwrap();
        g.pack_cache = cache;
        if empty {
            return Err(format!("'{}' is not a readable pack", pack.display()));
        }
        let overlay = Arc::new(OverlaySource::new(Arc::new(top), base)) as Arc<dyn DataSource>;
        g.source = Some(overlay);
        g.overlay_pack = Some(pack);
        g.loc_cache = None;
        g.image_cache.clear();
        Ok(())
    }

    /// Remove the single-pack overlay, restoring the base source.
    pub fn clear_overlay_pack(&self) {
        let mut g = self.inner.lock().unwrap();
        g.source = g.base.clone();
        g.overlay_pack = None;
        g.loc_cache = None;
        g.image_cache.clear();
    }

    // --- RPFM schema (for decoding binary db tables in pack mode) ---

    pub fn schema_path(&self) -> Option<PathBuf> {
        self.inner.lock().unwrap().schema_path.clone()
    }

    /// Point at a new RPFM `.ron` schema file; clears the parsed cache.
    pub fn set_schema_path(&self, p: PathBuf) {
        let mut g = self.inner.lock().unwrap();
        g.schema_path = Some(p);
        g.schema = None;
    }

    /// The parsed schema (lazily read + cached). `None` if unset or unparseable.
    pub fn schema(&self) -> Option<Arc<Schema>> {
        {
            let g = self.inner.lock().unwrap();
            if let Some(s) = &g.schema {
                return Some(s.clone());
            }
        }
        let path = self.inner.lock().unwrap().schema_path.clone()?;
        let text = std::fs::read_to_string(&path).ok()?;
        let parsed = match Schema::parse(&text) {
            Ok(s) => Arc::new(s),
            Err(e) => {
                eprintln!("schema: {e}");
                return None;
            }
        };
        let mut g = self.inner.lock().unwrap();
        g.schema = Some(parsed.clone());
        Some(parsed)
    }

    /// The active source's full-key localised-string map (binary `.loc` + TSV),
    /// built once and cached until the source changes.
    pub fn loc_all(&self) -> Arc<HashMap<String, String>> {
        {
            let g = self.inner.lock().unwrap();
            if let Some(m) = &g.loc_cache {
                return m.clone();
            }
        }
        // Build outside the lock (scans + decodes), then cache.
        let map = Arc::new(crate::loc::load_all(self));
        let mut g = self.inner.lock().unwrap();
        g.loc_cache = Some(map.clone());
        map
    }

    // --- Source delegation (clone the Arc out, then call without the lock held) ---

    fn source(&self) -> Option<Arc<dyn DataSource>> {
        self.inner.lock().unwrap().source.clone()
    }

    pub fn read(&self, rel: &str) -> Option<Vec<u8>> {
        self.source()?.read(rel)
    }

    pub fn read_text(&self, rel: &str) -> Option<String> {
        self.source()?.read_text(rel)
    }

    pub fn exists(&self, rel: &str) -> bool {
        self.source().map(|s| s.exists(rel)).unwrap_or(false)
    }

    pub fn list(&self, pred: &dyn Fn(&str) -> bool) -> Vec<String> {
        self.source().map(|s| s.list(pred)).unwrap_or_default()
    }
}

/// Try to locate a game data folder out of the box: prefer a game under a
/// `games/` directory (3K first), else a legacy top-level `3K` (transitional).
fn guess_data_root() -> Option<PathBuf> {
    if let Some(gd) = games_dir() {
        let games = list_games_in(&gd);
        if let Some(g) = games.iter().find(|n| n.as_str() == "3K").or_else(|| games.first()) {
            return Some(gd.join(g));
        }
    }
    // Legacy fallback: a top-level `3K` (before it was moved under `games/`).
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("3K"));
        candidates.push(cwd.join("..").join("3K"));
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut p = exe.as_path();
        for _ in 0..6 {
            if let Some(parent) = p.parent() {
                candidates.push(parent.join("3K"));
                p = parent;
            }
        }
    }
    candidates.into_iter().find(|c| is_data_root(c))
}

/// Locate the `games/` directory (holding per-game data folders) relative to the
/// working dir or executable.
pub fn games_dir() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("games"));
        candidates.push(cwd.join("..").join("games"));
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut p = exe.as_path();
        for _ in 0..6 {
            if let Some(parent) = p.parent() {
                candidates.push(parent.join("games"));
                p = parent;
            }
        }
    }
    candidates.into_iter().find(|c| c.is_dir())
}

/// Names of the games under `dir` (subfolders that contain a `ui/`), sorted.
pub fn list_games_in(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            if is_data_root(&e.path()) {
                if let Some(name) = e.file_name().to_str() {
                    out.push(name.to_string());
                }
            }
        }
    }
    out.sort();
    out
}

fn is_data_root(p: &Path) -> bool {
    p.join("ui").is_dir()
}

/// Auto-detect the user's RPFM 3K schema in the standard config location so db
/// decode "just works" when RPFM is installed; overridable in Settings.
fn default_schema_path() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    let p = PathBuf::from(appdata)
        .join("rpfm")
        .join("config")
        .join("schemas")
        .join("schema_3k.ron");
    if p.is_file() {
        Some(p)
    } else {
        None
    }
}
