//! An EDITABLE `.pack` opened as a workspace (distinct from the read-only dependency packs). Backed
//! by a mutable rpfm `Pack`: TWUI files can be inserted / removed and the whole pack re-encoded to
//! disk. It also implements [`DataSource`] (reads reflect in-memory edits immediately) so it can be
//! overlaid on top of the dependency stack for live preview.

use super::DataSource;
use rpfm_lib::files::pack::Pack;
use rpfm_lib::files::{Container, ContainerPath, FileType, RFile};
use rpfm_lib::games::pfh_file_type::PFHFileType;
use rpfm_lib::games::supported_games::SupportedGames;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// Normalize a relative path the way pack paths are stored (forward slashes, no leading slash).
fn norm(rel: &str) -> String {
    rel.replace('\\', "/").trim_start_matches('/').to_string()
}

/// Resolve the rpfm GameInfo for a key (falling back to 3K) and run `f` with it. `SupportedGames` is
/// rebuilt per call (only used on open/save, which are infrequent).
fn with_game<T>(game_key: &str, f: impl FnOnce(&rpfm_lib::games::GameInfo) -> T) -> Result<T, String> {
    let games = SupportedGames::default();
    let game = games
        .game(game_key)
        .or_else(|| games.game("three_kingdoms"))
        .ok_or("unknown rpfm game")?;
    Ok(f(game))
}

pub struct WorkspacePack {
    pack: Mutex<Pack>,
    path: PathBuf,
    game_key: String,
    /// True when there are in-memory edits not yet written to disk.
    dirty: AtomicBool,
}

impl WorkspacePack {
    /// Open an existing `.pack` for editing.
    pub fn open(path: &Path, game_key: &str) -> Result<Self, String> {
        let pack = with_game(game_key, |game| {
            Pack::read_and_merge(&[path.to_path_buf()], game, true, false, true)
        })?
        .map_err(|e| format!("open pack: {e}"))?;
        Ok(Self {
            pack: Mutex::new(pack),
            path: path.to_path_buf(),
            game_key: game_key.to_string(),
            dirty: AtomicBool::new(false),
        })
    }

    /// Create a brand-new empty Mod pack and write it to disk.
    pub fn create(path: &Path, game_key: &str) -> Result<Self, String> {
        let mut pack = with_game(game_key, |game| {
            let mut p = Pack::default();
            p.set_pfh_file_type(PFHFileType::Mod);
            p.set_pfh_version(game.pfh_version_by_file_type(PFHFileType::Mod));
            p
        })?;
        with_game(game_key, |game| pack.save(Some(path), game, &None))?
            .map_err(|e| format!("create pack: {e}"))?;
        Ok(Self {
            pack: Mutex::new(pack),
            path: path.to_path_buf(),
            game_key: game_key.to_string(),
            dirty: AtomicBool::new(false),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty.load(Ordering::Relaxed)
    }

    /// Insert (or replace) a file's raw bytes. Stored as `Cached`, so it reads back immediately and
    /// is written verbatim on save.
    pub fn insert_file(&self, rel: &str, bytes: &[u8]) -> Result<(), String> {
        let rel = norm(rel);
        let rfile = RFile::new_from_vec(bytes, FileType::Text, 0, &rel);
        let mut pack = self.pack.lock().map_err(|_| "workspace lock poisoned")?;
        pack.insert(rfile).map_err(|e| format!("insert {rel}: {e}"))?;
        drop(pack);
        self.dirty.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// Remove a file. No-op if absent.
    pub fn remove_file(&self, rel: &str) -> Result<(), String> {
        let rel = norm(rel);
        let mut pack = self.pack.lock().map_err(|_| "workspace lock poisoned")?;
        pack.remove(&ContainerPath::File(rel));
        drop(pack);
        self.dirty.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// Re-encode the whole pack to its file on disk and clear the dirty flag.
    pub fn save_to_disk(&self) -> Result<(), String> {
        let mut pack = self.pack.lock().map_err(|_| "workspace lock poisoned")?;
        let path = self.path.clone();
        with_game(&self.game_key, |game| pack.save(Some(&path), game, &None))?
            .map_err(|e| format!("save pack: {e}"))?;
        drop(pack);
        self.dirty.store(false, Ordering::Relaxed);
        Ok(())
    }
}

impl DataSource for WorkspacePack {
    fn read(&self, rel: &str) -> Option<Vec<u8>> {
        let rel = norm(rel);
        // Clone the RFile out under the lock, then load off-lock (edited files are already Cached).
        let mut rfile = {
            let pack = self.pack.lock().ok()?;
            pack.file(&rel, true)?.clone()
        };
        rfile.load().ok()?;
        rfile.cached().ok().map(|b| b.to_vec())
    }

    fn exists(&self, rel: &str) -> bool {
        let rel = norm(rel);
        self.pack
            .lock()
            .ok()
            .map(|p| p.file(&rel, true).is_some())
            .unwrap_or(false)
    }

    fn list(&self, pred: &dyn Fn(&str) -> bool) -> Vec<String> {
        let pack = match self.pack.lock() {
            Ok(p) => p,
            Err(_) => return Vec::new(),
        };
        let mut out: Vec<String> = pack
            .paths_raw()
            .into_iter()
            .map(|p| p.replace('\\', "/"))
            .filter(|p| pred(p))
            .collect();
        out.sort();
        out.dedup();
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create an empty pack, insert a layout, save, reopen, and confirm the bytes round-trip exactly.
    #[test]
    fn create_insert_save_reopen_roundtrips() {
        let dir = std::env::temp_dir().join("twui-editor-test-workspace");
        let _ = std::fs::create_dir_all(&dir);
        let pack_path = dir.join("test_mod.pack");
        let _ = std::fs::remove_file(&pack_path);

        let body = b"<layout>\r\n\t<components/>\r\n</layout>\r\n".to_vec();
        {
            let ws = WorkspacePack::create(&pack_path, "three_kingdoms").expect("create pack");
            ws.insert_file("ui/test/foo.twui.xml", &body).expect("insert");
            ws.save_to_disk().expect("save");
        }
        // Reopen and verify.
        let ws = WorkspacePack::open(&pack_path, "three_kingdoms").expect("reopen pack");
        let layouts = ws.list(&|p| p.ends_with(".twui.xml"));
        assert_eq!(layouts, vec!["ui/test/foo.twui.xml".to_string()]);
        let read = ws.read("ui/test/foo.twui.xml").expect("read back");
        assert_eq!(read, body, "inserted layout must round-trip byte-identically");

        // Delete it and confirm it's gone after save+reopen.
        ws.remove_file("ui/test/foo.twui.xml").expect("remove");
        ws.save_to_disk().expect("save after remove");
        let ws2 = WorkspacePack::open(&pack_path, "three_kingdoms").expect("reopen 2");
        assert!(ws2.list(&|p| p.ends_with(".twui.xml")).is_empty(), "deleted file should be gone");

        let _ = std::fs::remove_file(&pack_path);
    }
}
