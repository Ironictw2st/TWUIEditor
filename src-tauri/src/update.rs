// Portable self-replacing updater (RPFM-style): check the latest GitHub release and, on
// request, download the portable exe, swap the running binary in place, and relaunch.
// No installer and no signature step — trust is HTTPS + GitHub release authenticity.

use serde::Serialize;
use std::io::Write;
use tauri::{AppHandle, Emitter};

const OWNER: &str = "Ironictw2st";
const REPO: &str = "TWUIEditor";
/// The portable executable asset published on each release (see the release workflow).
const ASSET_NAME: &str = "TWUI-Editor-x64.exe";
const USER_AGENT: &str = "TWUI-Editor-Updater";

#[derive(Serialize, Clone)]
pub struct UpdateMeta {
    version: String,
    notes: String,
    /// Direct download URL for the portable exe asset.
    #[serde(rename = "assetUrl")]
    asset_url: String,
}

/// Query the latest GitHub release and pull out the version, notes, and portable asset URL.
async fn fetch_latest() -> Result<UpdateMeta, String> {
    let url = format!("https://api.github.com/repos/{OWNER}/{REPO}/releases/latest");
    let resp = reqwest::Client::new()
        .get(&url)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub API returned {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| format!("bad response: {e}"))?;
    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("bad response JSON: {e}"))?;

    let version = json["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    if version.is_empty() {
        return Err("latest release has no tag_name".into());
    }
    let notes = json["body"].as_str().unwrap_or("").to_string();
    let asset_url = json["assets"]
        .as_array()
        .and_then(|arr| arr.iter().find(|a| a["name"].as_str() == Some(ASSET_NAME)))
        .and_then(|a| a["browser_download_url"].as_str())
        .ok_or_else(|| format!("release has no asset named {ASSET_NAME}"))?
        .to_string();
    Ok(UpdateMeta { version, notes, asset_url })
}

/// Return update info when the latest release is newer than the running version, else None.
/// Debug builds never report an update (so dev never self-replaces its own exe).
#[tauri::command]
pub async fn check_update() -> Result<Option<UpdateMeta>, String> {
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    let latest = fetch_latest().await?;
    let current = semver::Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|e| format!("bad current version: {e}"))?;
    let remote = semver::Version::parse(&latest.version)
        .map_err(|e| format!("bad release version '{}': {e}", latest.version))?;
    Ok(if remote > current { Some(latest) } else { None })
}

/// Download the portable exe (emitting `update-progress` 0..1), replace the running binary in
/// place, then relaunch into the new version. Does not return on success (the app restarts).
#[tauri::command]
pub async fn install_update(app: AppHandle, asset_url: String) -> Result<(), String> {
    let mut resp = reqwest::Client::new()
        .get(&asset_url)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download returned {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let tmp = std::env::temp_dir().join("twui-editor-update.exe");
    let mut file =
        std::fs::File::create(&tmp).map_err(|e| format!("cannot create temp file: {e}"))?;
    let mut downloaded: u64 = 0;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("download error: {e}"))? {
        file.write_all(&chunk).map_err(|e| format!("write error: {e}"))?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let frac = (downloaded as f64 / total as f64).min(1.0);
            let _ = app.emit("update-progress", frac);
        }
    }
    file.flush().map_err(|e| format!("flush error: {e}"))?;
    drop(file);

    // Swap the new exe over the currently running one (handles the Windows running-exe rename).
    self_replace::self_replace(&tmp).map_err(|e| format!("could not replace executable: {e}"))?;
    let _ = std::fs::remove_file(&tmp);
    app.restart()
}
