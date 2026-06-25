// In-app bug reporting: collect a description plus screenshots and deliver them to the
// author's Discord channel via a webhook. Reuses the same reqwest stack as the updater.
//
// The webhook URL is kept out of the repository: it is injected at build time via the
// TWUI_BUG_WEBHOOK environment variable (or pasted into the const below for a local build).
// When it is empty the command returns a friendly "not configured" error.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Deserialize;
use tauri::Manager;

/// Discord webhook the reports are POSTed to. Set `TWUI_BUG_WEBHOOK` at build time, e.g.
/// `TWUI_BUG_WEBHOOK=https://discord.com/api/webhooks/... npm run tauri build`.
const WEBHOOK_URL: &str = match option_env!("TWUI_BUG_WEBHOOK") {
    Some(u) => u,
    None => "",
};
const USER_AGENT: &str = "TWUI-Editor-BugReport";

// Discord webhook limits (a single uploaded attachment / the whole request / file count).
const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 24 * 1024 * 1024;
const MAX_FILES: usize = 10;
// Discord embed field caps (description 4096, field value 1024) — leave headroom.
const MAX_DESC: usize = 4000;
const MAX_FIELD: usize = 1000;

/// An image captured in the webview (program shot, visualizer render) and passed inline.
/// `b64` may be a bare base64 string or a full `data:image/png;base64,...` data URL.
#[derive(Deserialize)]
struct InlineImage {
    name: String,
    b64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BugReport {
    description: String,
    contact: Option<String>,
    /// Arbitrary diagnostic key/values (app version, OS, game, file, resolution) built in JS.
    meta: serde_json::Value,
    inline_images: Vec<InlineImage>,
    /// Absolute paths to user-picked images, read here so the webview needn't load their bytes.
    file_paths: Vec<String>,
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Best-effort MIME from a filename extension so Discord renders images inline.
fn mime_for(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else {
        "application/octet-stream"
    }
}

/// Capture the app window and return it as a `data:image/png;base64,...` URL. Tries the exact
/// OS window first; if xcap can't enumerate it (flaky on some Windows setups), falls back to
/// capturing the monitor the window sits on and cropping to its bounds.
#[tauri::command]
pub fn capture_app_window(app: tauri::AppHandle) -> Result<String, String> {
    if let Some(img) = capture_own_window() {
        return encode_data_url(&img);
    }
    match capture_via_monitor(&app) {
        Ok(img) => encode_data_url(&img),
        Err(e) => Err(format!("could not capture the app window: {e} ({})", diagnostics())),
    }
}

/// The top-level OS window belongs to THIS process; pick our largest visible one. Returns None
/// if xcap can't enumerate windows or the capture fails (caller then tries the monitor path).
fn capture_own_window() -> Option<xcap::image::RgbaImage> {
    let pid = std::process::id();
    let windows = xcap::Window::all().ok()?;
    let mut best: Option<&xcap::Window> = None;
    let mut best_area = 0u64;
    for w in &windows {
        if w.process_id() != pid || w.is_minimized() {
            continue;
        }
        let area = w.width() as u64 * w.height() as u64;
        if area >= best_area {
            best_area = area;
            best = Some(w);
        }
    }
    best?.capture_image().ok()
}

/// Capture the monitor under the window's centre and crop to the window's bounds. When the
/// monitor reports a different size than its captured image (DPI scaling), the pixel mapping is
/// ambiguous, so we return the whole-monitor shot instead — it still shows the app and is
/// DPI-proof.
fn capture_via_monitor(app: &tauri::AppHandle) -> Result<xcap::image::RgbaImage, String> {
    let win = app.get_webview_window("main").ok_or("no main window")?;
    let pos = win.outer_position().map_err(|e| format!("window position: {e}"))?;
    let size = win.outer_size().map_err(|e| format!("window size: {e}"))?;
    let (wx, wy) = (pos.x, pos.y);
    let (ww, wh) = (size.width.max(1) as i32, size.height.max(1) as i32);
    let (cx, cy) = (wx + ww / 2, wy + wh / 2);

    let monitor = match xcap::Monitor::from_point(cx, cy) {
        Ok(m) => m,
        Err(_) => {
            let mut all = xcap::Monitor::all().map_err(|e| format!("monitors: {e}"))?;
            if all.is_empty() {
                return Err("no monitors found".into());
            }
            all.remove(0)
        }
    };

    let full = monitor
        .capture_image()
        .map_err(|e| format!("monitor capture failed: {e}"))?;

    // Only crop in the unambiguous 1:1 case (capture size == monitor size).
    let scaled = full.width() != monitor.width() || full.height() != monitor.height();
    if scaled {
        return Ok(full);
    }
    let lx = (wx - monitor.x()).max(0) as u32;
    let ly = (wy - monitor.y()).max(0) as u32;
    let cw = (ww as u32).min(full.width().saturating_sub(lx));
    let ch = (wh as u32).min(full.height().saturating_sub(ly));
    if cw == 0 || ch == 0 {
        return Ok(full);
    }
    Ok(crop_rgba(&full, lx, ly, cw, ch))
}

fn crop_rgba(img: &xcap::image::RgbaImage, x: u32, y: u32, w: u32, h: u32) -> xcap::image::RgbaImage {
    let mut out = xcap::image::RgbaImage::new(w, h);
    for row in 0..h {
        for col in 0..w {
            out.put_pixel(col, row, *img.get_pixel(x + col, y + row));
        }
    }
    out
}

fn encode_data_url(img: &xcap::image::RgbaImage) -> Result<String, String> {
    Ok(format!("data:image/png;base64,{}", BASE64.encode(encode_png(img)?)))
}

/// A short, log-friendly summary of what xcap can see (for capture-failure messages).
fn diagnostics() -> String {
    let pid = std::process::id();
    let windows = xcap::Window::all().map(|w| w.len()).unwrap_or(0);
    let monitors = xcap::Monitor::all().map(|m| m.len()).unwrap_or(0);
    format!("pid={pid}, xcap windows={windows}, monitors={monitors}")
}

/// PNG-encode a captured RGBA frame using the `png` crate (independent of the optional
/// `image`/`dds` feature, so capture works in every build configuration).
fn encode_png(img: &xcap::image::RgbaImage) -> Result<Vec<u8>, String> {
    let (w, h) = (img.width(), img.height());
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc
            .write_header()
            .map_err(|e| format!("png header: {e}"))?;
        writer
            .write_image_data(img.as_raw())
            .map_err(|e| format!("png encode: {e}"))?;
    }
    Ok(out)
}

/// Deliver a bug report (description + meta + images) to the configured Discord webhook.
#[tauri::command]
pub async fn submit_bug_report(report: BugReport) -> Result<(), String> {
    if WEBHOOK_URL.is_empty() {
        return Err("Bug reporting is not configured in this build.".into());
    }

    // Gather every image as (filename, bytes): inline (base64 from JS) then file uploads.
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    for img in &report.inline_images {
        let raw = img.b64.rsplit(',').next().unwrap_or("").trim();
        let bytes = BASE64
            .decode(raw)
            .map_err(|e| format!("bad image data for '{}': {e}", img.name))?;
        files.push((img.name.clone(), bytes));
    }
    for path in &report.file_paths {
        let bytes = std::fs::read(path).map_err(|e| format!("cannot read {path}: {e}"))?;
        let name = std::path::Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("upload")
            .to_string();
        files.push((name, bytes));
    }

    if files.len() > MAX_FILES {
        return Err(format!(
            "too many images ({}); Discord allows up to {MAX_FILES}.",
            files.len()
        ));
    }
    let mut total = 0usize;
    for (name, bytes) in &files {
        if bytes.len() > MAX_FILE_BYTES {
            return Err(format!(
                "image '{name}' is {} MB; the per-file limit is 8 MB.",
                bytes.len() / 1024 / 1024
            ));
        }
        total += bytes.len();
    }
    if total > MAX_TOTAL_BYTES {
        return Err("the images total over 24 MB; remove some and try again.".into());
    }

    // Build the embed: description + a field per diagnostic + optional contact.
    let mut fields: Vec<serde_json::Value> = Vec::new();
    if let Some(obj) = report.meta.as_object() {
        for (k, v) in obj {
            let val = match v {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Null => String::new(),
                other => other.to_string(),
            };
            if val.trim().is_empty() {
                continue;
            }
            fields.push(serde_json::json!({
                "name": k,
                "value": truncate(&val, MAX_FIELD),
                "inline": true,
            }));
        }
    }
    if let Some(contact) = report.contact.as_ref().map(|c| c.trim()).filter(|c| !c.is_empty()) {
        fields.push(serde_json::json!({
            "name": "Contact",
            "value": truncate(contact, MAX_FIELD),
            "inline": false,
        }));
    }
    let desc = report.description.trim();
    let desc = if desc.is_empty() { "(no description provided)" } else { desc };
    let payload = serde_json::json!({
        "embeds": [{
            "title": "New bug report",
            "description": truncate(desc, MAX_DESC),
            "fields": fields,
            "color": 15158332u32,
        }]
    });

    let mut form = reqwest::multipart::Form::new().text("payload_json", payload.to_string());
    for (i, (name, bytes)) in files.into_iter().enumerate() {
        let mime = mime_for(&name);
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(name)
            .mime_str(mime)
            .map_err(|e| format!("bad attachment: {e}"))?;
        form = form.part(format!("files[{i}]"), part);
    }

    let resp = reqwest::Client::new()
        .post(WEBHOOK_URL)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("the webhook returned {}", resp.status()));
    }
    Ok(())
}
