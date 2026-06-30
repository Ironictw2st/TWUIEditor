use std::path::Path;

/// Inject the bug-report Discord webhook into the build so `option_env!("TWUI_BUG_WEBHOOK")`
/// in bug_report.rs can see it. Cargo does not read `.env` files itself, so we parse
/// `src-tauri/.env` here and forward the value via `cargo:rustc-env`. A real environment
/// variable (e.g. set in CI) takes precedence over the file.
fn main() {
    load_bug_webhook();
    compress_schemas();
    tauri_build::build()
}

/// Compress the bundled RPFM `.ron` schemas (from the `vendor/rpfm-schemas` submodule) into
/// `OUT_DIR` with zstd. They are ~20 MB of repetitive RON text; zstd shrinks them ~10x so the
/// auto-updated portable binary stays small. `schema_embed.rs` includes + decompresses them.
fn compress_schemas() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into());
    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR set by cargo");
    for (src_name, out_name) in [
        ("schema_3k.ron", "schema_3k.ron.zst"),
        ("schema_wh3.ron", "schema_wh3.ron.zst"),
    ] {
        let src = Path::new(&manifest)
            .join("..")
            .join("vendor")
            .join("rpfm-schemas")
            .join(src_name);
        println!("cargo:rerun-if-changed={}", src.display());
        let data = std::fs::read(&src).unwrap_or_else(|e| {
            panic!(
                "RPFM schema '{}' missing ({e}). Initialize the submodule: \
                 git submodule update --init --depth 1 vendor/rpfm-schemas",
                src.display()
            )
        });
        let compressed = zstd::encode_all(&data[..], 19).expect("zstd-compress schema");
        std::fs::write(Path::new(&out_dir).join(out_name), compressed)
            .expect("write compressed schema to OUT_DIR");
    }
}

fn load_bug_webhook() {
    const KEY: &str = "TWUI_BUG_WEBHOOK";
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into());
    let env_path = Path::new(&manifest).join(".env");

    // Rebuild when the file or the ambient variable changes.
    println!("cargo:rerun-if-changed={}", env_path.display());
    println!("cargo:rerun-if-env-changed={KEY}");

    // An explicit environment variable wins over the .env file.
    if let Ok(val) = std::env::var(KEY) {
        if !val.trim().is_empty() {
            println!("cargo:rustc-env={KEY}={}", val.trim());
            return;
        }
    }

    // Otherwise read the value out of src-tauri/.env (KEY=VALUE, optional quotes/#comments).
    if let Ok(contents) = std::fs::read_to_string(&env_path) {
        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let Some((k, v)) = line.split_once('=') else { continue };
            if k.trim() != KEY {
                continue;
            }
            let v = v.trim().trim_matches('"').trim_matches('\'').trim();
            if !v.is_empty() {
                println!("cargo:rustc-env={KEY}={v}");
            }
            return;
        }
    }
    // Not configured: leave the var unset so option_env! returns None and the command reports
    // a friendly "not configured" error at runtime.
}
