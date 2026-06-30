//! axum router for the web access point: the JSON command bridge (`/api/invoke`),
//! the image route (`/img`), password login (`/login`, `/api/login`), and the
//! embedded SPA (everything else). All routes share one `ApiState` carrying the
//! Tauri `AppHandle` (so handlers reach the same `AppState` as the desktop) and
//! the auth secret.

use axum::{
    body::Body,
    extract::{Path as AxPath, State},
    http::{header, StatusCode, Uri},
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tower_http::catch_panic::CatchPanicLayer;

use crate::api;
use crate::image;
use crate::state::AppState;

use super::auth::{self, AuthState};

#[derive(Clone)]
pub struct ApiState {
    pub app: AppHandle,
    pub auth: AuthState,
}

/// The built frontend, baked into the binary in release; read from `../dist`
/// at runtime in debug builds (so a rebuild is picked up without recompiling).
#[derive(rust_embed::RustEmbed)]
#[folder = "../dist"]
struct Assets;

const CSP: &str = "default-src 'self'; img-src 'self' data:; \
    style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'";

pub fn build_router(app: AppHandle, password: String) -> Router {
    let state = ApiState {
        app,
        auth: AuthState::new(password),
    };
    Router::new()
        .route("/api/invoke/:cmd", post(invoke_handler))
        .route("/api/login", post(auth::login))
        .route("/login", get(auth::login_page))
        .route("/img/*rel", get(img_handler))
        .fallback(spa_handler)
        // Inner: password gate over every route (incl. fallback). Outer: contain
        // any per-request panic as a 500 instead of killing a worker thread.
        .layer(middleware::from_fn_with_state(state.clone(), auth::guard))
        .layer(CatchPanicLayer::new())
        .with_state(state)
}

/// `POST /api/invoke/{cmd}` — the browser-mode equivalent of Tauri `invoke`.
/// Body is the args object (camelCase, as the TS wrappers send). Errors come
/// back as a 400 with the message as the body, matching Tauri's bare-string
/// rejection so existing UI error handling is unchanged.
async fn invoke_handler(
    State(st): State<ApiState>,
    AxPath(cmd): AxPath<String>,
    body: Option<Json<Value>>,
) -> Response {
    let args = body
        .map(|Json(v)| v)
        .unwrap_or_else(|| Value::Object(Default::default()));
    let app_state = st.app.state::<AppState>();
    match api::dispatch(app_state.inner(), &cmd, args) {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

/// `GET /img/{rel}` — resolve a TWUI imagepath to PNG bytes (PNG passthrough,
/// DDS decode), mirroring the desktop `twuiimg://` scheme. Path is read from the
/// raw URI and percent-decoded exactly once (like the desktop handler).
async fn img_handler(State(st): State<ApiState>, uri: Uri) -> Response {
    let rel_enc = uri.path().strip_prefix("/img/").unwrap_or("");
    let rel = percent_encoding::percent_decode_str(rel_enc)
        .decode_utf8_lossy()
        .into_owned();
    let app_state = st.app.state::<AppState>();
    // Never let a decode panic unwind out of the handler (CatchPanicLayer would
    // turn it into a 500, but a missing/odd image should just be a quiet 404).
    let resolved = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        image::resolve_png(app_state.inner(), &rel)
    }))
    .unwrap_or(Err(image::ResolveError::Decode("panic".into())));
    match resolved {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "image/png")
            .header(header::CACHE_CONTROL, "max-age=3600")
            .body(Body::from(bytes))
            .unwrap(),
        Err(e) => {
            if let image::ResolveError::Decode(msg) = &e {
                eprintln!("/img: decode failed for {rel}: {msg}");
            }
            (StatusCode::NOT_FOUND, "").into_response()
        }
    }
}

/// Serve an embedded asset by path, falling back to `index.html` for SPA routes.
async fn spa_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let candidate = if path.is_empty() { "index.html" } else { path };

    if let Some(file) = Assets::get(candidate) {
        return asset_response(candidate, file.data.into_owned());
    }
    // Unknown path with no extension -> SPA deep link: serve the shell.
    if let Some(index) = Assets::get("index.html") {
        return asset_response("index.html", index.data.into_owned());
    }
    (StatusCode::NOT_FOUND, "frontend not built").into_response()
}

fn asset_response(path: &str, data: Vec<u8>) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let is_html = mime.type_() == mime_guess::mime::TEXT && mime.subtype() == mime_guess::mime::HTML;
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime.as_ref());
    if is_html {
        builder = builder.header("Content-Security-Policy", CSP);
    }
    builder.body(Body::from(data)).unwrap()
}
