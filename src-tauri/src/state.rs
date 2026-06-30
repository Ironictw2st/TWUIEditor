//! Shared application state: the active data source (loose folder or `.pack`
//! archives) + a decoded-image cache.

use crate::source::{
    build_pack_source, ordered_packs, rpfm_game_key, DataSource, FolderSource, OverlaySource,
    PackSource,
};
use lru::LruCache;
use rpfm_lib::schema::Schema;
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
    /// The current rpfm game key (`three_kingdoms` / `warhammer_3`) — selects the GameInfo for pack
    /// reading and the bundled schema. Set via the game switch.
    pub game_key: String,
    /// Cached merged base pack, keyed by `(game_key, include_mods)`, so the vanilla/mods and overlay
    /// toggles don't re-read the index.
    pub base_pack: Option<(String, bool, Arc<PackSource>)>,
    /// Path to a user-chosen RPFM `.ron` schema override (else the bundled schema is used).
    pub schema_path: Option<PathBuf>,
    /// Parsed schema cache (rebuilt when the schema source or game changes).
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
        let game_key = "three_kingdoms".to_string();
        AppState {
            inner: Mutex::new(Inner {
                data_root: root,
                pack_mode: false,
                source: base.clone(),
                base,
                overlay_pack: None,
                schema_path: None,
                game_key,
                base_pack: None,
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
        // Reuse a cached base pack for the same (game, include_mods); else build it OUTSIDE the lock
        // (a cold full-install merge takes ~1 s) so the image handler / reads aren't blocked.
        let (game_key, cached) = {
            let g = self.inner.lock().unwrap();
            let hit = match &g.base_pack {
                Some((gk, im, arc)) if *gk == g.game_key && *im == include_mods => Some(arc.clone()),
                _ => None,
            };
            (g.game_key.clone(), hit)
        };
        let pack: Arc<PackSource> = match cached {
            Some(a) => a,
            None => {
                let paths = ordered_packs(&game_dir, include_mods)?;
                let src = build_pack_source(&paths, &game_key)?;
                if src.is_empty() {
                    return Err("no readable .pack files (all unsupported)".into());
                }
                Arc::new(src)
            }
        };
        let base = pack.clone() as Arc<dyn DataSource>;
        let mut g = self.inner.lock().unwrap();
        g.base_pack = Some((game_key, include_mods, pack));
        g.data_root = Some(game_dir);
        g.pack_mode = true;
        g.base = Some(base.clone());
        g.source = Some(base);
        g.overlay_pack = None;
        g.loc_cache = None;
        g.image_cache.clear();
        Ok(())
    }

    /// Overlay a single `.pack` over the current base: reads resolve from it
    /// first, then fall back to the base. Requires a base source already set.
    pub fn set_overlay_pack(&self, pack: PathBuf) -> Result<(), String> {
        let (base, game_key) = {
            let g = self.inner.lock().unwrap();
            (g.base.clone(), g.game_key.clone())
        };
        let Some(base) = base else {
            return Err("no base source to overlay onto".into());
        };
        // Build outside the lock (see set_pack_source).
        let top = build_pack_source(std::slice::from_ref(&pack), &game_key)?;
        if top.is_empty() {
            return Err(format!("'{}' is not a readable pack", pack.display()));
        }
        let overlay = Arc::new(OverlaySource::new(Arc::new(top), base)) as Arc<dyn DataSource>;
        let mut g = self.inner.lock().unwrap();
        g.source = Some(overlay);
        g.overlay_pack = Some(pack);
        g.loc_cache = None;
        g.image_cache.clear();
        Ok(())
    }

    /// Set the active game (by our folder name, e.g. `3K`/`WH3`): updates the rpfm game key, drops
    /// the cached base pack + parsed schema (both game-specific), and re-points the schema override
    /// at the new game's local RPFM schema if one is installed (else the bundled schema is used).
    pub fn set_game_key(&self, name: &str) {
        let key = rpfm_game_key(name).to_string();
        let mut g = self.inner.lock().unwrap();
        if g.game_key == key {
            return;
        }
        // The cached pack, parsed schema, and any override are all game-specific; drop them so the
        // new game's bundled schema + packs are used.
        g.schema_path = None;
        g.game_key = key;
        g.base_pack = None;
        g.schema = None;
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

    /// The parsed schema (lazily read + cached). Prefers the user's `schema_path` override; otherwise
    /// uses the bundled schema for the active game. `None` if neither is available or it won't parse.
    pub fn schema(&self) -> Option<Arc<Schema>> {
        {
            let g = self.inner.lock().unwrap();
            if let Some(s) = &g.schema {
                return Some(s.clone());
            }
        }
        let (path_override, game_key) = {
            let g = self.inner.lock().unwrap();
            (g.schema_path.clone(), g.game_key.clone())
        };
        // Prefer the user's explicit override, then the bundled schema. The bundled one is guaranteed
        // to match the linked rpfm_lib version; an old-format local schema (RPFM pre-v5 `.ron`) would
        // fail to parse, so we fall back to the bundle instead of giving up.
        let parsed = path_override
            .and_then(|p| load_schema(&p))
            .or_else(|| crate::schema_embed::embedded_schema_path(&game_key).and_then(|p| load_schema(&p)))?;
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

/// Parse an RPFM `.ron` schema file into the cache shape. `None` (with a logged reason) if it can't
/// be read or is an incompatible format for the linked rpfm_lib version.
fn load_schema(path: &Path) -> Option<Arc<Schema>> {
    match Schema::load(path, None) {
        Ok(s) => Some(Arc::new(s)),
        Err(e) => {
            eprintln!("schema {}: {e}", path.display());
            None
        }
    }
}
