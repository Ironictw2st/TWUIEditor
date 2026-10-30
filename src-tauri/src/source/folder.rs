//! `DataSource` over a loose extracted data-root folder (the original behavior).

use super::DataSource;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub struct FolderSource {
    root: PathBuf,
    /// `root` with symlinks resolved, for the containment check. Computed once.
    root_canon: OnceLock<Option<PathBuf>>,
    /// Lowercased relative path -> the real on-disk relative path. Built lazily on
    /// the first lookup that misses, so a correctly-cased read never pays for it.
    ci_index: OnceLock<HashMap<String, String>>,
}

/// Forward-slash a relative path and drop redundant leading separators.
fn norm(rel: &str) -> String {
    rel.replace('\\', "/").trim_start_matches('/').to_string()
}

impl FolderSource {
    pub fn new(root: PathBuf) -> Self {
        FolderSource { root, root_canon: OnceLock::new(), ci_index: OnceLock::new() }
    }

    /// Join a forward-slashed relative path onto the root, rejecting `..` traversal
    /// and absolute/drive-letter escapes. Purely syntactic — no filesystem access.
    fn join_checked(&self, rel: &str) -> Option<PathBuf> {
        let rel = norm(rel);
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

    fn root_canon(&self) -> Option<&PathBuf> {
        self.root_canon.get_or_init(|| self.root.canonicalize().ok()).as_ref()
    }

    /// Confirm the candidate exists and, with symlinks resolved, still lives under the
    /// data root. `..` is already blocked syntactically; this closes the symlink hole
    /// (same check `script::find_script` applies to `.lua` reads).
    fn verify(&self, p: PathBuf) -> Option<PathBuf> {
        let canon = p.canonicalize().ok()?;
        match self.root_canon() {
            Some(root) => canon.starts_with(root).then_some(p),
            // The root itself can't be canonicalized; fall back to the syntactic guard
            // alone rather than refusing every read.
            None => Some(p),
        }
    }

    /// Resolve a forward-slashed relative path to an existing on-disk path, sandboxed
    /// under the data root. Falls back to a case-insensitive match so this source
    /// behaves like `PackSource` (which gets case-folding from rpfm) on a
    /// case-sensitive filesystem.
    fn resolve(&self, rel: &str) -> Option<PathBuf> {
        if let Some(p) = self.join_checked(rel).and_then(|p| self.verify(p)) {
            return Some(p);
        }
        let real = self.ci_index().get(&norm(rel).to_lowercase())?;
        self.join_checked(real).and_then(|p| self.verify(p))
    }

    fn ci_index(&self) -> &HashMap<String, String> {
        self.ci_index.get_or_init(|| {
            let mut files = self.walk();
            // Deterministic winner when two files differ only in case (possible on a
            // case-sensitive filesystem); an exact-case hit never reaches this map.
            files.sort();
            let mut map = HashMap::with_capacity(files.len());
            for f in files {
                map.entry(f.to_lowercase()).or_insert(f);
            }
            map
        })
    }

    /// Recursively collect every file under the root as a forward-slashed
    /// relative path. Symlinked directories are followed at most once, so a
    /// self-referential link can't spin here forever.
    fn walk(&self) -> Vec<String> {
        let mut out = Vec::new();
        let mut seen: HashSet<PathBuf> = HashSet::new();
        let mut stack = vec![self.root.clone()];
        while let Some(dir) = stack.pop() {
            if !mark_visited(&dir, &mut seen) {
                continue;
            }
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

/// Record `dir` (symlinks resolved) as visited; `false` if it was already walked.
fn mark_visited(dir: &Path, seen: &mut HashSet<PathBuf>) -> bool {
    let key = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    seen.insert(key)
}

impl DataSource for FolderSource {
    fn read(&self, rel: &str) -> Option<Vec<u8>> {
        let path = self.resolve(rel)?;
        std::fs::read(path).ok()
    }

    fn exists(&self, rel: &str) -> bool {
        self.resolve(rel).is_some()
    }

    fn list(&self, pred: &dyn Fn(&str) -> bool) -> Vec<String> {
        let mut out: Vec<String> = self.walk().into_iter().filter(|p| pred(p)).collect();
        out.sort();
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, rel: &str, body: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    #[test]
    fn resolves_a_differently_cased_path() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "db/factions_tables/data__.tsv", "rows");
        let src = FolderSource::new(tmp.path().to_path_buf());

        // Exact case works, and so does the casing `db.rs` actually asks for. On NTFS
        // the fast path would answer both, so assert the index itself resolved it.
        assert_eq!(src.read("db/factions_tables/data__.tsv").unwrap(), b"rows");
        assert_eq!(
            src.ci_index().get("db/factions_tables/data__.tsv").map(String::as_str),
            Some("db/factions_tables/data__.tsv")
        );
        assert_eq!(src.read("DB/factions_tables/data__.tsv").unwrap(), b"rows");
        assert!(src.exists("DB/Factions_Tables/DATA__.TSV"));
    }

    #[test]
    fn backslashes_and_missing_files() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "ui/ink/ink_hud.dds", "dds");
        let src = FolderSource::new(tmp.path().to_path_buf());

        assert!(src.read(r"ui\Ink\ink_hud.dds").is_some());
        assert!(!src.exists("ui/ink/nope.dds"));
        assert!(src.read("../outside.txt").is_none());
        assert!(src.read("/etc/passwd").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_contained_and_cycles_terminate() {
        use std::os::unix::fs::symlink;
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "no").unwrap();

        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "ui/real.txt", "yes");
        symlink(outside.path().join("secret.txt"), tmp.path().join("ui/escape.txt")).unwrap();
        symlink(tmp.path(), tmp.path().join("ui/loop")).unwrap();

        let src = FolderSource::new(tmp.path().to_path_buf());
        assert_eq!(src.read("ui/real.txt").unwrap(), b"yes");
        assert!(src.read("ui/escape.txt").is_none(), "symlink out of the root must be refused");
        // Terminates rather than spinning on the self-referential link.
        assert!(!src.list(&|p| p.ends_with("real.txt")).is_empty());
    }
}
