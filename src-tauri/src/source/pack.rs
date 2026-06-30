//! Read-only `DataSource` over Total War `.pack` archives, backed by `rpfm_lib`. rpfm handles every
//! PFH version plus transparent decompression/decryption (the old hand-rolled PFH5 reader refused
//! compressed/encrypted packs). We keep [`ordered_packs`] to choose + order which packs load
//! (vanilla vs +mods), then hand them to rpfm to merge.

use super::DataSource;
use rpfm_lib::files::pack::Pack;
use rpfm_lib::files::Container;
use rpfm_lib::games::supported_games::SupportedGames;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// CA pack file type (low nibble of the PFH header bitmask). Higher loads later; 3 = Mod.
const PFH_TYPE_MOD: u32 = 3;

/// A merged, lazily-loaded rpfm `Pack`. Behind a `Mutex` because the `Container` accessors borrow
/// the pack; reads clone the (still-lazy) `RFile` out under the lock and load its bytes off-lock,
/// so nothing is retained in the pack and disk I/O never blocks other readers.
pub struct PackSource {
    pack: Mutex<Pack>,
    /// Number of files in the merged pack (0 = nothing readable).
    count: usize,
}

/// Normalize a relative path for lookup (pack paths use `/`; rpfm matches case-insensitively).
fn norm(rel: &str) -> String {
    rel.replace('\\', "/").trim_start_matches('/').to_string()
}

fn le_u32(buf: &[u8], at: usize) -> Option<u32> {
    buf.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

/// Read just the PFH header to get the pack file type (`bitmask & 0xF`), so [`ordered_packs`] can
/// filter/sort cheaply without decoding the pack. Any `PFHx` magic is accepted (rpfm decodes them).
fn read_file_type(path: &Path) -> Result<u32, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut head = [0u8; 8];
    file.read_exact(&mut head).map_err(|e| e.to_string())?;
    if &head[0..3] != b"PFH" {
        return Err(format!("not a pack (magic '{}')", String::from_utf8_lossy(&head[0..4])));
    }
    le_u32(&head, 4).ok_or_else(|| "short header".to_string()).map(|b| b & 0xF)
}

/// The `.pack` files in `game_dir` filtered + ordered for load (later wins on collision): by file
/// type (Boot < Release < Patch < Mod < Movie), then name. When `include_mods` is false, `Mod`-type
/// packs are excluded (vanilla only).
pub fn ordered_packs(game_dir: &Path, include_mods: bool) -> Result<Vec<PathBuf>, String> {
    let entries = std::fs::read_dir(game_dir)
        .map_err(|e| format!("cannot read '{}': {e}", game_dir.display()))?;
    let mut metas: Vec<(PathBuf, u32)> = Vec::new();
    for e in entries.flatten() {
        let p = e.path();
        let is_pack = p
            .extension()
            .and_then(|x| x.to_str())
            .map(|x| x.eq_ignore_ascii_case("pack"))
            == Some(true);
        if !is_pack {
            continue;
        }
        match read_file_type(&p) {
            Ok(ft) if include_mods || ft != PFH_TYPE_MOD => metas.push((p, ft)),
            Ok(_) => {} // mod pack excluded in vanilla-only mode
            Err(e) => eprintln!("pack: skipping '{}': {e}", p.display()),
        }
    }
    if metas.is_empty() {
        return Err(format!("no usable .pack files found in '{}'", game_dir.display()));
    }
    metas.sort_by(|a, b| {
        (a.1, a.0.file_name().map(|n| n.to_ascii_lowercase()))
            .cmp(&(b.1, b.0.file_name().map(|n| n.to_ascii_lowercase())))
    });
    Ok(metas.into_iter().map(|(p, _)| p).collect())
}

/// The rpfm game key for our game folder name (`3K`, `WH3`); defaults to Three Kingdoms.
pub fn rpfm_game_key(name: &str) -> &'static str {
    match name.to_ascii_uppercase().as_str() {
        "WH3" | "WARHAMMER_3" | "WARHAMMER3" => "warhammer_3",
        _ => "three_kingdoms",
    }
}

/// Merge `paths` (already ordered; later wins) into a `PackSource` via rpfm for the given game key.
/// rpfm groups by pack type so mods override vanilla, and transparently handles compression/
/// encryption. Lazy: only the file index is read up front; bytes load on demand.
pub fn build_pack_source(paths: &[PathBuf], game_key: &str) -> Result<PackSource, String> {
    if paths.is_empty() {
        return Err("no .pack files to read".into());
    }
    let games = SupportedGames::default();
    let game = games
        .game(game_key)
        .or_else(|| games.game("three_kingdoms"))
        .ok_or("unknown rpfm game")?;
    // ignore_mods=false: `ordered_packs` already applied the vanilla/mods filter. keep_order=true:
    // preserve our ordering within a pack type.
    let pack = Pack::read_and_merge(paths, game, true, false, true)
        .map_err(|e| format!("read packs: {e}"))?;
    let count = pack.files().len();
    Ok(PackSource { pack: Mutex::new(pack), count })
}

impl PackSource {
    /// True when no readable pack contributed any files.
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// Build a source from the `.pack` files in `game_dir` (Three Kingdoms). Used by tests; the app
    /// builds via [`ordered_packs`] + [`build_pack_source`] with the active game key.
    #[cfg(test)]
    pub fn new(game_dir: &Path, include_mods: bool) -> Result<Self, String> {
        let paths = ordered_packs(game_dir, include_mods)?;
        let src = build_pack_source(&paths, "three_kingdoms")?;
        if src.is_empty() {
            return Err("no readable .pack files".into());
        }
        Ok(src)
    }
}

impl DataSource for PackSource {
    fn read(&self, rel: &str) -> Option<Vec<u8>> {
        let rel = norm(rel);
        // Clone the (lazy) RFile out under the lock, then load its bytes off-lock so the disk read
        // doesn't block other readers and nothing is cached back into the merged pack.
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

    /// Indexes the bundled sample 3K pack and reads a real layout out of it.
    /// Skipped (passes) when the sample isn't present.
    #[test]
    fn reads_sample_pack() {
        let dir = std::path::Path::new("../games/3K");
        if !dir.exists() {
            eprintln!("sample pack dir missing; skipping");
            return;
        }
        let src = PackSource::new(dir, true).expect("build pack source from games/3K");
        let layouts = src.list(&|p| p.ends_with(".twui.xml"));
        assert!(!layouts.is_empty(), "expected some .twui.xml in the pack");
        let first = &layouts[0];
        let bytes = src.read(first).expect("read a layout from the pack");
        assert!(!bytes.is_empty(), "layout {first} read empty");
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains('<'), "expected XML-ish content in {first}");

        // A known engine path resolves case-insensitively with either separator.
        assert!(src.exists(first), "exists() should find {first}");
        assert!(
            src.read(&first.replace('/', "\\").to_uppercase()).is_some(),
            "lookup should be case/separator-insensitive"
        );
    }

    /// Against a real install (if present): merges the whole `data` folder, transparently handling
    /// compression/encryption, and resolves vanilla `ui` layouts.
    #[test]
    fn reads_live_install() {
        let dir = std::path::Path::new(
            "C:/Program Files (x86)/Steam/steamapps/common/Total War THREE KINGDOMS/data",
        );
        if !dir.exists() {
            eprintln!("live install missing; skipping");
            return;
        }
        // Vanilla only: must still produce many ui layouts (from data.pack et al).
        let vanilla = PackSource::new(dir, false).expect("build vanilla pack source");
        let layouts = vanilla.list(&|p| p.ends_with(".twui.xml"));
        assert!(layouts.len() > 100, "expected many vanilla layouts, got {}", layouts.len());
        let bytes = vanilla.read(&layouts[0]).expect("read a vanilla layout");
        assert!(String::from_utf8_lossy(&bytes).contains('<'));

        // Including mods should only ever add coverage (>= vanilla count).
        let all = PackSource::new(dir, true).expect("build full pack source");
        let all_layouts = all.list(&|p| p.ends_with(".twui.xml"));
        assert!(all_layouts.len() >= layouts.len());
    }
}
