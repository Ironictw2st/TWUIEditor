//! Resolve a TWUI `imagepath` against the 3K data root, with path sandboxing
//! and an LRU byte cache. PNG is the critical path (every layout references
//! `.png`); `.dds` decode is feature-gated since no layout references it.

use crate::state::AppState;
use std::path::PathBuf;

#[derive(Debug)]
pub enum ResolveError {
    NoDataRoot,
    Unsafe,
    NotFound,
    Io(String),
    Decode(String),
}

#[derive(serde::Serialize)]
pub struct ImageStatus {
    pub resolved: bool,
    pub absolute: bool,
    pub exists: bool,
    pub kind: String, // "png" | "dds" | "other"
}

/// Reject absolute paths, drive letters, backslashes and `..` traversal.
/// Returns the cleaned relative path components.
fn sanitize(rel: &str) -> Option<Vec<String>> {
    if rel.contains('\\') {
        return None;
    }
    // Drive-letter (e.g. "T:/...") or UNC -> absolute, reject.
    if rel.len() >= 2 && rel.as_bytes()[1] == b':' {
        return None;
    }
    if rel.starts_with('/') {
        return None;
    }
    let mut parts = Vec::new();
    for seg in rel.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return None;
        }
        parts.push(seg.to_string());
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts)
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
    let exists = resolved_path(state, rel).map(|p| p.exists()).unwrap_or(false);
    ImageStatus {
        resolved: !absolute,
        absolute,
        exists,
        kind,
    }
}

fn resolved_path(state: &AppState, rel: &str) -> Option<PathBuf> {
    let root = state.data_root()?;
    let parts = sanitize(rel)?;
    let mut p = root.clone();
    for seg in parts {
        p.push(seg);
    }
    // Ensure the resolved path stays under the data root.
    match (p.canonicalize(), root.canonicalize()) {
        (Ok(cp), Ok(cr)) if cp.starts_with(&cr) => Some(cp),
        // File may not exist yet -> fall back to the lexical join (already sandboxed).
        (Err(_), _) => Some(p),
        _ => None,
    }
}

/// Resolve to PNG bytes. `.png` is passed through; `.dds` is decoded if the
/// `dds` feature is enabled.
pub fn resolve_png(state: &AppState, rel: &str) -> Result<Vec<u8>, ResolveError> {
    if state.data_root().is_none() {
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

    let path = resolved_path(state, rel).ok_or(ResolveError::Unsafe)?;
    let ext = ext_of(rel);

    let bytes = if ext == "png" {
        if !path.exists() {
            return Err(ResolveError::NotFound);
        }
        std::fs::read(&path).map_err(|e| ResolveError::Io(e.to_string()))?
    } else if ext == "dds" {
        decode_dds(&path)?
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

#[cfg(feature = "dds")]
fn decode_dds(path: &std::path::Path) -> Result<Vec<u8>, ResolveError> {
    if !path.exists() {
        return Err(ResolveError::NotFound);
    }
    let mut file = std::fs::File::open(path).map_err(|e| ResolveError::Io(e.to_string()))?;
    let dds = ddsfile::Dds::read(&mut file).map_err(|e| ResolveError::Decode(e.to_string()))?;
    // image_dds decodes BC1-7 / DX10 formats to RGBA8.
    let img = image_dds::image_from_dds(&dds, 0).map_err(|e| ResolveError::Decode(e.to_string()))?;
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| ResolveError::Decode(e.to_string()))?;
    Ok(out.into_inner())
}

#[cfg(not(feature = "dds"))]
fn decode_dds(_path: &std::path::Path) -> Result<Vec<u8>, ResolveError> {
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
