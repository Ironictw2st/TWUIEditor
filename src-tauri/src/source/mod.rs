//! A read abstraction over game data so the rest of the backend doesn't care
//! whether files come from a loose extracted folder or directly from `.pack`
//! archives. All relative paths are forward-slashed (e.g.
//! `ui/templates/foo.twui.xml`); implementations normalize separators/case as
//! needed for their backing store.

mod folder;
mod overlay;
mod pack;
mod workspace;

pub use folder::FolderSource;
pub use overlay::OverlaySource;
pub use pack::{build_pack_source, ordered_packs, rpfm_game_key, PackSource};
pub use workspace::WorkspacePack;

pub trait DataSource: Send + Sync {
    /// Raw bytes for a relative path, or `None` if absent.
    fn read(&self, rel: &str) -> Option<Vec<u8>>;

    /// Relative paths (forward-slashed) for which `pred` returns true.
    fn list(&self, pred: &dyn Fn(&str) -> bool) -> Vec<String>;

    /// Cheap existence check (implementations should avoid reading bytes).
    fn exists(&self, rel: &str) -> bool {
        self.read(rel).is_some()
    }

    /// UTF-8 (lossy) text for a relative path.
    fn read_text(&self, rel: &str) -> Option<String> {
        self.read(rel).map(|b| String::from_utf8_lossy(&b).into_owned())
    }
}
