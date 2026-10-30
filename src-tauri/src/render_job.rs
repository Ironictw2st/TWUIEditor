//! Headless render job: `twui-editor.exe --render <layout> --out <png> [...]`.
//!
//! The desktop app has no separate renderer (the scene is drawn by the React Visualizer on an
//! HTML canvas), so a headless render is the normal app started with a job: the main window is
//! hidden in `lib.rs::run` (setup), the frontend bootstrap (`src/render/headless.ts`) reads the
//! job through `get_render_job`, opens the layout, applies the preset, waits for the images,
//! captures the canvas at native resolution, saves the PNG (`save_png`) and calls `exit_app`.
//!
//! Options:
//!   --render <abs layout.twui.xml>   the layout to draw (loose file; images resolve from the data root)
//!   --out <abs .png>                 where to write the capture (on failure `<out>.err.txt` is written)
//!   --data-root <dir>                a folder with a `ui/` subfolder (default: the auto-detected one)
//!   --game <key>                     game key, e.g. 3K (default: the remembered / detected game)
//!   --overlay <file.pack>            a mod pack laid over the base (mod images win)
//!   --preset <file.json>             { "dataPack": {...}, "hide": [ids], "show": [ids], "emptyLists": true,
//!                                      "background": "<name>|null" }
//!   --timeout <seconds>              give up waiting for images after this long (default 20)
//!   --show                           keep the window on screen (debugging; default: parked off screen)

use serde::Serialize;

#[derive(Clone, Serialize, Debug)]
pub struct RenderJob {
    pub layout: String,
    pub out: String,
    pub data_root: Option<String>,
    pub game: Option<String>,
    pub overlay: Option<String>,
    /// The preset file's CONTENTS (JSON text), read here so the webview needs no file access.
    pub preset: Option<String>,
    pub timeout: u64,
    /// `--show`: keep the window on screen (debugging); default moves it off screen.
    pub show: bool,
}

/// Managed state: `Some` when the process was started with `--render`.
pub struct RenderJobState(pub Option<RenderJob>);

/// Parse the process arguments. Any argument error is reported through the job itself: the
/// frontend surfaces it in `<out>.err.txt` (or, with no `--out`, on stderr) and exits 1.
pub fn parse() -> RenderJobState {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.iter().any(|a| a == "--render") {
        return RenderJobState(None);
    }
    let mut job = RenderJob {
        layout: String::new(),
        out: String::new(),
        data_root: None,
        game: None,
        overlay: None,
        preset: None,
        timeout: 20,
        show: false,
    };
    let mut i = 0;
    while i < args.len() {
        let key = args[i].as_str();
        let val = args.get(i + 1).cloned();
        match key {
            "--render" => job.layout = val.unwrap_or_default(),
            "--out" => job.out = val.unwrap_or_default(),
            "--data-root" => job.data_root = val,
            "--game" => job.game = val,
            "--overlay" => job.overlay = val,
            "--preset" => {
                job.preset = val.as_deref().map(|p| match std::fs::read_to_string(p) {
                    Ok(text) => text,
                    Err(e) => format!("{{\"error\":\"cannot read preset {}: {}\"}}", p.replace('"', "'"), e),
                });
            }
            "--timeout" => job.timeout = val.and_then(|v| v.parse().ok()).unwrap_or(20),
            "--show" => {
                job.show = true;
                i += 1;
                continue;
            }
            _ => {
                i += 1;
                continue;
            }
        }
        i += 2;
    }
    RenderJobState(Some(job))
}

/// Append a line to `<out>.log.txt` (no-op without a job): the bootstrap's trace, also usable from Rust.
pub fn trace(job: &Option<RenderJob>, line: &str) {
    if let Some(j) = job {
        if j.out.is_empty() {
            return;
        }
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(format!("{}.log.txt", j.out)) {
            let _ = writeln!(f, "{line}");
        }
    }
}

/// The render job this process was started with, or None for a normal GUI session.
#[tauri::command]
pub fn get_render_job(job: tauri::State<RenderJobState>) -> Option<RenderJob> {
    trace(&job.0, "rust: get_render_job");
    job.0.clone()
}

/// Frontend trace line into `<out>.log.txt`.
#[tauri::command]
pub fn render_log(job: tauri::State<RenderJobState>, text: String) {
    trace(&job.0, &text);
}

/// Write a small text file (the headless bootstrap's error report).
#[tauri::command]
pub fn write_text_file(path: String, text: String) -> Result<(), String> {
    std::fs::write(&path, text).map_err(|e| format!("Failed to write {path}: {e}"))
}

/// End the process with the given exit code (headless render done / failed).
#[tauri::command]
pub fn exit_app(app: tauri::AppHandle, code: i32) {
    app.exit(code);
}
