//! `DataSource` over a loose extracted data-root folder (the original behavior).

use super::DataSource;
use std::path::PathBuf;

pub struct FolderSource {
    root: PathBuf,
}

impl FolderSource {
    pub fn new(root: PathBuf) -> Self {
        FolderSource { root }
    }

    /// Resolve a forward-slashed relative path to an on-disk path, rejecting
    /// `..` traversal and absolute/drive-letter escapes (keeps reads sandboxed
    /// under the data root, as the old `image::resolved_path` did).
    fn resolve(&self, rel: &str) -> Option<PathBuf> {
        let rel = rel.replace('\\', "/");
        if rel.starts_with('/') || (rel.len() >= 2 && rel.as_bytes()[1] == b':') {
            return None;
        }
        let mut p = self.root.clone();
        for seg in rel.split('/') {
            if seg.is_empty() || seg == "." {
                continue;
            }
            if seg == ".." {
                return None;
            }
            p.push(seg);
        }
        Some(p)
    }

    /// Recursively collect every file under the root as a forward-slashed
    /// relative path.
    fn walk(&self) -> Vec<String> {
        let mut out = Vec::new();
        let mut stack = vec![self.root.clone()];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for e in entries.flatten() {
                let path = e.path();
                if path.is_dir() {
                    stack.push(path);
                } else if let Ok(rel) = path.strip_prefix(&self.root) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
        out
    }
}

impl DataSource for FolderSource {
    fn read(&self, rel: &str) -> Option<Vec<u8>> {
        let path = self.resolve(rel)?;
        std::fs::read(path).ok()
    }

    fn exists(&self, rel: &str) -> bool {
        self.resolve(rel).map(|p| p.exists()).unwrap_or(false)
    }

    fn list(&self, pred: &dyn Fn(&str) -> bool) -> Vec<String> {
        let mut out: Vec<String> = self.walk().into_iter().filter(|p| pred(p)).collect();
        out.sort();
        out
    }
}
