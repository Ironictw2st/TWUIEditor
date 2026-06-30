mod api;
mod bin;
mod bug_report;
mod cco_docs;
mod cco_shorthand;
mod character;
mod commands;
mod db;
mod image;
mod loc;
mod model;
mod schema_embed;
mod script;
mod source;
mod state;
mod update;
mod web;

use state::AppState;
use std::borrow::Cow;
use tauri::http::{header, Response, StatusCode};
use tauri::Manager;

/// Decode the relative image path out of a `twuiimg://localhost/<enc-path>` URI.
fn rel_from_uri(uri: &tauri::http::Uri) -> String {
    let path = uri.path().trim_start_matches('/');
    percent_encoding::percent_decode_str(path)
        .decode_utf8_lossy()
        .into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .manage(web::WebServer::default())
        .register_uri_scheme_protocol("twuiimg", |ctx, request| {
            let app = ctx.app_handle();
            let state = app.state::<AppState>();
            let rel = rel_from_uri(request.uri());
            // Backstop: never let a decode panic unwind across the wry FFI
            // boundary (that aborts the process). Treat any panic as a 404.
            let resolved = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                image::resolve_png(&state, &rel)
            }))
            .unwrap_or(Err(image::ResolveError::Decode("panic".into())));
            match resolved {
                Ok(bytes) => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "image/png")
                    .header(header::CACHE_CONTROL, "max-age=3600")
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(Cow::Owned(bytes))
                    .unwrap(),
                Err(e) => {
                    // Missing/unsafe paths are silent (layouts reference many images that may
                    // not exist), but a real decode failure is rare and worth surfacing.
                    if let image::ResolveError::Decode(msg) = &e {
                        eprintln!("twuiimg: decode failed for {rel}: {msg}");
                    }
                    Response::builder()
                        .status(StatusCode::NOT_FOUND)
                        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .body(Cow::Owned(Vec::<u8>::new()))
                        .unwrap()
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_data_root,
            commands::set_data_root,
            commands::list_games,
            commands::current_game,
            commands::set_game,
            commands::set_pack_source,
            commands::is_pack_mode,
            commands::list_layouts,
            commands::list_images,
            commands::set_overlay_pack,
            commands::clear_overlay_pack,
            commands::get_overlay_pack,
            commands::get_schema_path,
            commands::set_schema_path,
            commands::read_layout_rel,
            commands::read_layout,
            commands::save_layout,
            commands::roundtrip_check,
            commands::image_status,
            commands::load_context_db,
            commands::load_character_db,
            commands::load_cco_docs,
            commands::load_cco_shorthand,
            commands::load_loc,
            commands::find_script,
            commands::read_script,
            commands::load_templates,
            commands::load_layouts,
            commands::serialize_element,
            commands::parse_element,
            commands::list_backgrounds,
            commands::host_list_dir,
            commands::host_default_paths,
            web::start_web_server,
            web::stop_web_server,
            web::web_server_status,
            update::check_update,
            update::install_update,
            bug_report::capture_app_window,
            bug_report::submit_bug_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
