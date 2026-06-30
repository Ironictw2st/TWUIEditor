//! Experimental web access point. When enabled from Settings, the running
//! desktop app starts an HTTP server (see `server.rs`) that serves the same
//! frontend (`routes.rs`) and proxies the editor's commands, so the editor can
//! be reached from a browser on the LAN / Tailscale and operate on the host's
//! pack files. Access is gated by a user-set password (`auth.rs`).

mod auth;
mod routes;
mod server;

pub use server::{WebInfo, WebOpts, WebServer};

use tauri::{AppHandle, State};

/// Start the web server with the given bind/port/password options. Returns the
/// share URL on success; errors (e.g. port in use) surface synchronously.
#[tauri::command]
pub fn start_web_server(
    app: AppHandle,
    server: State<WebServer>,
    opts: WebOpts,
) -> Result<WebInfo, String> {
    server.start(app, opts)
}

/// Stop the web server (no-op if not running).
#[tauri::command]
pub fn stop_web_server(server: State<WebServer>) -> Result<(), String> {
    server.stop()
}

/// Current server info, or `null` when stopped.
#[tauri::command]
pub fn web_server_status(server: State<WebServer>) -> Option<WebInfo> {
    server.status()
}
