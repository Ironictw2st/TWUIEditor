//! Read-only `DataSource` over Total War `.pack` archives (PFH5 / 3K, WH3 mod
//! packs). Only the file index is held in memory; file bytes are read lazily by
//! seeking into the owning pack. Encrypted / compressed / big-header packs are
//! refused rather than mis-parsed.
//!
//! PFH5 layout (verified against a real 3K pack):
//!   header (28 bytes): magic("PFH5") bitmask dep_count dep_index_size
//!                      file_count file_index_size timestamp
//!   bitmask & 0xF = pfh file type; high-bit flags below.
//!   dependency index: `dep_index_size` bytes of null-terminated pack names.
//!   file index: per entry -> size:u32 [+ timestamp:u32 if HAS_TS] + sep:u8 +
//!               null-terminated path (backslash-separated).
//!   data: files concatenated in index order, right after the file index.

use super::DataSource;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const HEADER_SIZE: u64 = 28;
const FLAG_BIG_HEADER: u32 = 0x0100_0000;
const FLAG_ENCRYPTED_INDEX: u32 = 0x0080_0000;
const FLAG_INDEX_TIMESTAMPS: u32 = 0x0040_0000;
const FLAG_ENCRYPTED_CONTENT: u32 = 0x0020_0000;

struct Entry {
    pack_idx: usize,
    offset: u64,
    size: u32,
}

/// A single pack's parsed file index, cached so re-merging (vanilla/mod toggle,
/// overlay) doesn't re-read it from disk. `len` is the pack file's byte length,
/// a cheap staleness guard.
pub struct CachedPack {
    /// Pack file byte length — a cheap staleness guard for the cache.
    pub len: u64,
    /// (normalized key, data offset, byte size) per file.
    entries: Vec<(String, u64, u32)>,
}

/// In-memory cache of parsed pack indexes, keyed by pack path. Lives in AppState.
pub type PackCache = HashMap<PathBuf, Arc<CachedPack>>;

pub struct PackSource {
    packs: Vec<PathBuf>,
    index: HashMap<String, Entry>,
}

/// Normalize a relative path for case-insensitive, separator-insensitive lookup
/// (pack paths use `\` and arbitrary case).
fn norm(rel: &str) -> String {
    rel.replace('\\', "/")
        .trim_start_matches('/')
        .to_ascii_lowercase()
}

fn le_u32(buf: &[u8], at: usize) -> Option<u32> {
    buf.get(at..at + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

/// CA pack file type (low nibble of the header bitmask). Higher loads later.
const PFH_TYPE_MOD: u32 = 3;

impl PackSource {
    /// Build a source from the `.pack` files in `game_dir`, merged in load order.
    /// Convenience wrapper around [`ordered_packs`] + [`build_index`] with a
    /// throwaway cache (used by tests; the app passes its own cache).
    #[cfg(test)]
    pub fn new(game_dir: &Path, include_mods: bool) -> Result<Self, String> {
        let paths = ordered_packs(game_dir, include_mods)?;
        let mut cache = PackCache::new();
        let src = build_index(&paths, &mut cache);
        if src.packs.is_empty() {
            return Err("no readable .pack files (all unsupported/encrypted)".into());
        }
        Ok(src)
    }
}

/// The `.pack` files in `game_dir` filtered + ordered for load (later wins on
/// collision): by file type (Boot < Release < Patch < Mod < Movie), then name.
/// When `include_mods` is false, `Mod`-type packs are excluded (vanilla only).
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

/// Merge `paths` (already ordered; later wins) into a `PackSource`, parsing each
/// pack's index only on a cache miss. Packs that fail to parse are skipped+logged.
pub fn build_index(paths: &[PathBuf], cache: &mut PackCache) -> PackSource {
    let mut index: HashMap<String, Entry> = HashMap::new();
    let mut packs: Vec<PathBuf> = Vec::new();
    for path in paths {
        let len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let cached = match cache.get(path) {
            Some(c) if c.len == len => Some(c.clone()),
            _ => match parse_cached_pack(path) {
                Ok(cp) => {
                    let arc = Arc::new(cp);
                    cache.insert(path.clone(), arc.clone());
                    Some(arc)
                }
                Err(e) => {
                    eprintln!("pack: skipping '{}': {e}", path.display());
                    None
                }
            },
        };
        let Some(cp) = cached else { continue };
        let pack_idx = packs.len();
        for (key, offset, size) in &cp.entries {
            index.insert(
                key.clone(),
                Entry {
                    pack_idx,
                    offset: *offset,
                    size: *size,
                },
            );
        }
        packs.push(path.clone());
    }
    PackSource { packs, index }
}

/// Read just the PFH5 header to get the pack file type (`bitmask & 0xF`).
fn read_file_type(path: &Path) -> Result<u32, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut head = [0u8; 8];
    file.read_exact(&mut head).map_err(|e| e.to_string())?;
    if &head[0..4] != b"PFH5" {
        return Err(format!(
            "unsupported pack format '{}' (only PFH5 is read)",
            String::from_utf8_lossy(&head[0..4])
        ));
    }
    Ok(le_u32(&head, 4).ok_or("short header")? & 0xF)
}

/// Parse a pack's header + file index into a `CachedPack`. Validates that the
/// index parses to exactly `file_count` entries and is fully consumed, so packs
/// with a different layout (e.g. boot/shaders) are rejected rather than indexed
/// as garbage.
fn parse_cached_pack(path: &Path) -> Result<CachedPack, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut header = [0u8; HEADER_SIZE as usize];
    file.read_exact(&mut header).map_err(|e| e.to_string())?;

    if &header[0..4] != b"PFH5" {
        return Err(format!(
            "unsupported pack format '{}' (only PFH5 is read)",
            String::from_utf8_lossy(&header[0..4])
        ));
    }
    let bitmask = le_u32(&header, 4).ok_or("short header")?;
    if bitmask & FLAG_ENCRYPTED_INDEX != 0
        || bitmask & FLAG_ENCRYPTED_CONTENT != 0
        || bitmask & FLAG_BIG_HEADER != 0
    {
        return Err("unsupported pack (encrypted or big-header)".into());
    }
    let has_ts = bitmask & FLAG_INDEX_TIMESTAMPS != 0;
    let file_count = le_u32(&header, 16).ok_or("short header")? as usize;
    let dep_index_size = le_u32(&header, 12).ok_or("short header")? as u64;
    let file_index_size = le_u32(&header, 20).ok_or("short header")? as u64;

    // The header sizes are untrusted; reject anything that can't fit in the file
    // before allocating (a corrupt header could otherwise request up to 4 GiB).
    if HEADER_SIZE + dep_index_size + file_index_size > len {
        return Err("pack header sizes exceed file length".into());
    }

    // Read the file index region (skip the dependency index that precedes it).
    file.seek(SeekFrom::Start(HEADER_SIZE + dep_index_size))
        .map_err(|e| e.to_string())?;
    let mut idx = vec![0u8; file_index_size as usize];
    file.read_exact(&mut idx).map_err(|e| e.to_string())?;

    let data_start = HEADER_SIZE + dep_index_size + file_index_size;
    let mut entries: Vec<(String, u64, u32)> = Vec::new();
    let mut cur = 0usize; // cursor into the index buffer
    let mut data_off = data_start; // running data offset
    let mut parsed = 0usize; // every entry seen (incl. any we skip)

    while cur < idx.len() && parsed < file_count {
        let size = le_u32(&idx, cur).ok_or("truncated index entry")?;
        cur += 4;
        if has_ts {
            cur += 4; // skip per-entry timestamp
        }
        // One separator byte (0 = uncompressed); nonzero -> we can't decode it.
        let sep = *idx.get(cur).ok_or("truncated index entry")?;
        cur += 1;
        // Null-terminated path.
        let end = idx[cur..]
            .iter()
            .position(|&b| b == 0)
            .map(|p| cur + p)
            .ok_or("unterminated path in index")?;
        let raw = &idx[cur..end];
        cur = end + 1;
        parsed += 1;

        if sep == 0 {
            entries.push((norm(&String::from_utf8_lossy(raw)), data_off, size));
        }
        data_off += size as u64;
    }

    // The index must account for exactly `file_count` entries and consume the
    // whole index region. A mismatch means a layout we don't understand.
    if parsed != file_count || cur != idx.len() {
        return Err(format!(
            "index layout mismatch (parsed {parsed}/{file_count}, {} bytes leftover)",
            idx.len() as isize - cur as isize
        ));
    }
    Ok(CachedPack { len, entries })
}

impl PackSource {
    /// True when no readable pack contributed any entries.
    pub fn is_empty(&self) -> bool {
        self.packs.is_empty()
    }
}

impl DataSource for PackSource {
    fn read(&self, rel: &str) -> Option<Vec<u8>> {
        let entry = self.index.get(&norm(rel))?;
        let mut file = std::fs::File::open(self.packs.get(entry.pack_idx)?).ok()?;
        file.seek(SeekFrom::Start(entry.offset)).ok()?;
        let mut buf = vec![0u8; entry.size as usize];
        file.read_exact(&mut buf).ok()?;
        Some(buf)
    }

    fn exists(&self, rel: &str) -> bool {
        self.index.contains_key(&norm(rel))
    }

    fn list(&self, pred: &dyn Fn(&str) -> bool) -> Vec<String> {
        let mut out: Vec<String> = self
            .index
            .keys()
            .filter(|k| pred(k))
            .cloned()
            .collect();
        out.sort();
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
        assert_eq!(
            src.read(&first.replace('/', "\\").to_uppercase()).is_some(),
            true,
            "lookup should be case/separator-insensitive"
        );
    }

    /// Against a real install (if present): merges the whole `data` folder,
    /// skips the malformed boot/shaders packs, and resolves vanilla `ui` layouts.
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
