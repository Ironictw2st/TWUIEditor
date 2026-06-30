//! The RPFM `.ron` schemas, bundled with the app so binary db decode works without a local
//! RPFM install. The source files live in the `vendor/rpfm-schemas` git submodule (MIT); `build.rs`
//! zstd-compresses them into `OUT_DIR` (they are ~20 MB of RON text), and we decompress the one for
//! the active game to a temp file on first use so `rpfm_lib::schema::Schema::load` (which takes a
//! path) can read it. Only the games the editor supports (3K, WH3) are embedded.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;

const SCHEMA_3K_ZST: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/schema_3k.ron.zst"));
const SCHEMA_WH3_ZST: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/schema_wh3.ron.zst"));

/// The compressed embedded schema for an rpfm game key, if one is bundled.
fn embedded_zst(game_key: &str) -> Option<&'static [u8]> {
    match game_key {
        "warhammer_3" => Some(SCHEMA_WH3_ZST),
        "three_kingdoms" => Some(SCHEMA_3K_ZST),
        _ => None,
    }
}

/// Decompress the bundled schema for `game_key` to a content-addressed temp file (written once)
/// and return its path, for `Schema::load`. `None` if no schema is bundled for the game.
pub fn embedded_schema_path(game_key: &str) -> Option<PathBuf> {
    let zst = embedded_zst(game_key)?;
    // Content-address by the compressed bytes so a schema update lands on a fresh file and a stale
    // one is never reused (mirrors the image cache).
    let mut h = DefaultHasher::new();
    zst.hash(&mut h);
    let dir = std::env::temp_dir().join("twui-editor-cache");
    let out = dir.join(format!("schema_{game_key}_{:x}.ron", h.finish()));
    if std::fs::metadata(&out).map(|m| m.len() > 0).unwrap_or(false) {
        return Some(out);
    }
    let data = zstd::decode_all(zst).ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    // Write to a temp sibling then rename so a concurrent reader never sees a half-written file.
    let tmp = dir.join(format!("schema_{game_key}_{:x}.ron.tmp", h.finish()));
    std::fs::write(&tmp, &data).ok()?;
    std::fs::rename(&tmp, &out).ok()?;
    Some(out)
}
