//! Headless round-trip verifier for binary UIC layouts.
//!
//! Usage: cargo run --example uic_roundtrip -- <dir>
//!
//! Walks <dir> recursively, sniffs every file for the VersionNNN magic, and
//! reports per-file and per-version results of encode(decode(bytes)) == bytes.
//! Exit code is non-zero when any supported file fails.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use twui_editor_lib::uic;

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            walk(&p, out);
        } else {
            out.push(p);
        }
    }
}

fn main() {
    let dir = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!("usage: uic_roundtrip <dir>");
        std::process::exit(2);
    });
    let mut files = Vec::new();
    walk(Path::new(&dir), &mut files);

    let mut ok: BTreeMap<u32, u32> = BTreeMap::new();
    let mut skipped: BTreeMap<u32, u32> = BTreeMap::new();
    let mut failures = 0u32;
    for path in &files {
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        let Some(version) = uic::sniff_version(&bytes) else {
            continue;
        };
        match uic::decode(&bytes).and_then(|doc| uic::encode(&doc)) {
            Ok(back) if back == bytes => {
                *ok.entry(version).or_default() += 1;
            }
            Ok(back) => {
                failures += 1;
                println!(
                    "MISMATCH  {} (Version{version:03})\n  {}",
                    path.display(),
                    uic::first_byte_difference(&bytes, &back).replace('\n', "\n  ")
                );
            }
            Err(e) if e.contains("is not supported") => {
                *skipped.entry(version).or_default() += 1;
            }
            Err(e) => {
                failures += 1;
                println!("ERROR     {} (Version{version:03}): {e}", path.display());
            }
        }
    }

    let total: u32 = ok.values().sum();
    println!("\n{total} files byte-identical; {failures} failures");
    for (v, n) in &ok {
        println!("  Version{v:03}: {n}");
    }
    if !skipped.is_empty() {
        println!("skipped unsupported:");
        for (v, n) in &skipped {
            println!("  Version{v:03}: {n}");
        }
    }
    if failures > 0 {
        std::process::exit(1);
    }
}
