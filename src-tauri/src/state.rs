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

/// Try to locate the unpacked `3K` data folder relative to the working dir or
/// executable so images resolve out of the box during development.
fn guess_data_root() -> Option<PathBuf> {
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

fn is_data_root(p: &Path) -> bool {
    p.join("ui").is_dir()
}
