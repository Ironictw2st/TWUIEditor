use std::path::Path;

/// Inject the bug-report Discord webhook into the build so `option_env!("TWUI_BUG_WEBHOOK")`
/// in bug_report.rs can see it. Cargo does not read `.env` files itself, so we parse
/// `src-tauri/.env` here and forward the value via `cargo:rustc-env`. A real environment
/// variable (e.g. set in CI) takes precedence over the file.
fn main() {
    load_bug_webhook();
    tauri_build::build()
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
