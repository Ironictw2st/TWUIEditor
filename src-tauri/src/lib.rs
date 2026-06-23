mod cco_docs;
mod cco_shorthand;
mod character;
mod commands;
mod db;
mod image;
mod loc;
mod model;
mod script;
mod state;

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new())
        .register_uri_scheme_protocol("twuiimg", |ctx, request| {
            let app = ctx.app_handle();
            let state = app.state::<AppState>();
            let rel = rel_from_uri(request.uri());
            match image::resolve_png(&state, &rel) {
                Ok(bytes) => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "image/png")
                    .header(header::CACHE_CONTROL, "max-age=3600")
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(Cow::Owned(bytes))
                    .unwrap(),
                Err(_) => Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(Cow::Owned(Vec::<u8>::new()))
                    .unwrap(),
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_data_root,
            commands::set_data_root,
            commands::list_games,
            commands::current_game,
            commands::set_game,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
