//! Shared application state: the configured 3K data root + a decoded-image cache.

use lru::LruCache;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct AppState {
    pub inner: Mutex<Inner>,
}

pub struct Inner {
    pub data_root: Option<PathBuf>,
    pub image_cache: LruCache<String, Vec<u8>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            inner: Mutex::new(Inner {
                data_root: guess_data_root(),
                image_cache: LruCache::new(NonZeroUsize::new(512).unwrap()),
            }),
        }
    }

    pub fn data_root(&self) -> Option<PathBuf> {
        self.inner.lock().unwrap().data_root.clone()
    }

    pub fn set_data_root(&self, p: PathBuf) {
        let mut g = self.inner.lock().unwrap();
        g.data_root = Some(p);
        g.image_cache.clear();
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
