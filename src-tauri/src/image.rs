//! Resolve a TWUI `imagepath` against the 3K data root, with path sandboxing
//! and an LRU byte cache. PNG is the critical path (every layout references
//! `.png`); `.dds` decode is feature-gated since no layout references it.

use crate::state::AppState;

#[derive(Debug)]
pub enum ResolveError {
    NoDataRoot,
    Unsafe,
    NotFound,
    /// A `.dds` decode failed; the message is logged once at the protocol handler.
    Decode(String),
}

#[derive(serde::Serialize)]
pub struct ImageStatus {
    pub resolved: bool,
    pub absolute: bool,
    pub exists: bool,
    pub kind: String, // "png" | "dds" | "other"
}

fn ext_of(rel: &str) -> String {
    rel.rsplit('.')
        .next()
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default()
}

pub fn is_absolute_path(rel: &str) -> bool {
    rel.starts_with('/')
        || rel.contains('\\')
        || (rel.len() >= 2 && rel.as_bytes()[1] == b':')
}

pub fn status(state: &AppState, rel: &str) -> ImageStatus {
    let kind = match ext_of(rel).as_str() {
        "png" => "png",
        "dds" => "dds",
        _ => "other",
    }
    .to_string();
    let absolute = is_absolute_path(rel);
    let exists = !absolute && state.exists(rel);
    ImageStatus {
        resolved: !absolute,
        absolute,
        exists,
        kind,
    }
}

/// Resolve to PNG bytes via the active data source. `.png` is passed through;
/// `.dds` is decoded if the `dds` feature is enabled.
pub fn resolve_png(state: &AppState, rel: &str) -> Result<Vec<u8>, ResolveError> {
    if !state.has_source() {
        return Err(ResolveError::NoDataRoot);
    }
    if is_absolute_path(rel) {
        return Err(ResolveError::Unsafe);
    }

    // Cache hit?
    {
        let mut g = state.inner.lock().unwrap();
        if let Some(bytes) = g.image_cache.get(rel) {
            return Ok(bytes.clone());
        }
    }

    let raw = state.read(rel).ok_or(ResolveError::NotFound)?;
    let ext = ext_of(rel);

    let bytes = if ext == "png" {
        raw
    } else if ext == "dds" {
        decode_dds_cached(&raw)?
    } else {
        return Err(ResolveError::NotFound);
    };

    state
        .inner
        .lock()
        .unwrap()
        .image_cache
        .put(rel.to_string(), bytes.clone());
    Ok(bytes)
}

/// Decode DDS to PNG with a persistent, content-addressed disk cache: the same
/// DDS bytes always hash to the same file, so the expensive decode runs once and
/// survives restarts. The in-memory LRU stays the hot layer above this.
fn decode_dds_cached(raw: &[u8]) -> Result<Vec<u8>, ResolveError> {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    raw.hash(&mut h);
    let dir = std::env::temp_dir().join("twui-editor-cache");
    let file = dir.join(format!("{:016x}.png", h.finish()));
    if let Ok(bytes) = std::fs::read(&file) {
        return Ok(bytes);
    }
    // Some DDS variants make the decoder panic; contain it so one bad texture
    // returns an error (404) instead of aborting the whole process (the
    // twuiimg:// handler runs across an FFI boundary where an unwind is fatal).
    let bytes = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| decode_dds(raw)))
        .map_err(|_| ResolveError::Decode("dds decode panicked".into()))??;
    // Best-effort write; a cache miss next time is harmless.
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&file, &bytes);
    Ok(bytes)
}

#[cfg(feature = "dds")]
fn decode_dds(raw: &[u8]) -> Result<Vec<u8>, ResolveError> {
    let dds = ddsfile::Dds::read(&mut std::io::Cursor::new(raw))
        .map_err(|e| ResolveError::Decode(e.to_string()))?;
    // image_dds decodes BC1-7 / DX10 formats to RGBA8.
    let img = image_dds::image_from_dds(&dds, 0).map_err(|e| ResolveError::Decode(e.to_string()))?;
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| ResolveError::Decode(e.to_string()))?;
    Ok(out.into_inner())
}

#[cfg(not(feature = "dds"))]
fn decode_dds(_raw: &[u8]) -> Result<Vec<u8>, ResolveError> {
    Err(ResolveError::Decode(
        "DDS decoding not enabled (build with --features dds)".to_string(),
    ))
}

#[cfg(all(test, feature = "dds"))]
mod tests {
    use crate::state::AppState;

    #[test]
    fn decodes_ink_dds_to_png() {
        let state = AppState::new();
        assert!(state.data_root().is_some(), "3K data root not found");
        let bytes = super::resolve_png(&state, "ui/Ink/ink_hud_top_left.dds")
            .expect("decode ink dds");
        // PNG signature.
        assert_eq!(&bytes[0..4], &[0x89, b'P', b'N', b'G'], "expected PNG output");
        assert!(bytes.len() > 1000);
    }
}
