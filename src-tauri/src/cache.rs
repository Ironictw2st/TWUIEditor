//! The app's on-disk cache directory (decoded DDS textures, decompressed RPFM schemas).
//!
//! This used to be `std::env::temp_dir()/twui-editor-cache`. On Windows `%TEMP%` is
//! per-user so that was fine; on Linux `/tmp` is shared between users, so the
//! content-addressed files one user creates are unwritable by the next. Both entries
//! here are pure caches — relocating them costs at most one re-decode.

use std::path::PathBuf;
use std::sync::OnceLock;

/// Per-user cache directory, created on first use. `~/.cache/twui-editor` on Linux,
/// `%LOCALAPPDATA%\twui\twui-editor\cache` on Windows. Falls back to the old temp-dir
/// location if the platform gives us no home directory.
pub fn cache_dir() -> &'static PathBuf {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let dir = directories::ProjectDirs::from("com", "twui", "twui-editor")
            .map(|d| d.cache_dir().to_path_buf())
            .unwrap_or_else(|| std::env::temp_dir().join("twui-editor-cache"));
        // Best effort: a cache that can't be created just means every lookup misses.
        let _ = std::fs::create_dir_all(&dir);
        dir
    })
}
