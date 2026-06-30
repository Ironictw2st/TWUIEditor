//! Password gate. A single user-set password protects every route. On a correct
//! password we set an httpOnly cookie holding a random per-session secret; the
//! guard then checks that cookie on subsequent requests. There is NO TLS — run
//! this behind Tailscale/WireGuard or an SSH tunnel for an encrypted transport.

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, HeaderMap, StatusCode, Uri},
    middleware::Next,
    response::{Html, IntoResponse, Response},
    Form,
};
use serde::Deserialize;

use super::routes::ApiState;

const COOKIE: &str = "twui_auth";

#[derive(Clone)]
pub struct AuthState {
    password: Arc<String>,
    /// Random secret generated per server start; the cookie carries this value.
    secret: Arc<String>,
}

impl AuthState {
    pub fn new(password: String) -> Self {
        AuthState {
            password: Arc::new(password),
            secret: Arc::new(random_secret()),
        }
    }
}

fn random_secret() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Length-checked constant-time compare (don't leak the password via timing).
fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    let prefix = format!("{name}=");
    raw.split(';')
        .map(|p| p.trim())
        .find_map(|p| p.strip_prefix(&prefix).map(String::from))
}

/// Middleware over every route. `/login` + `/api/login` are always reachable;
/// otherwise a valid cookie is required (401 for API/image, redirect for pages).
pub async fn guard(State(st): State<ApiState>, req: Request, next: Next) -> Response {
    let path = req.uri().path();
    if path == "/login" || path == "/api/login" {
        return next.run(req).await;
    }
    let authed = cookie_value(req.headers(), COOKIE)
        .map(|c| ct_eq(&c, &st.auth.secret))
        .unwrap_or(false);
    if authed {
        return next.run(req).await;
    }
    if path.starts_with("/api/") || path.starts_with("/img/") {
        return (StatusCode::UNAUTHORIZED, "authentication required").into_response();
    }
    redirect("/login")
}

#[derive(Deserialize)]
pub struct LoginForm {
    password: String,
}

/// `POST /api/login` — set the auth cookie on a correct password.
pub async fn login(State(st): State<ApiState>, Form(form): Form<LoginForm>) -> Response {
    if ct_eq(&form.password, &st.auth.password) {
        let cookie = format!(
            "{COOKIE}={}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400",
            st.auth.secret
        );
        return Response::builder()
            .status(StatusCode::SEE_OTHER)
            .header(header::LOCATION, "/")
            .header(header::SET_COOKIE, cookie)
            .body(Body::empty())
            .unwrap();
    }
    redirect("/login?error=1")
}

/// `GET /login` — a minimal password form (matches the app's dark boot theme).
pub async fn login_page(uri: Uri) -> Response {
    let error = uri.query().map(|q| q.contains("error=1")).unwrap_or(false);
    Html(login_html(error)).into_response()
}

fn redirect(location: &str) -> Response {
    Response::builder()
        .status(StatusCode::SEE_OTHER)
        .header(header::LOCATION, location)
        .body(Body::empty())
        .unwrap()
}

fn login_html(error: bool) -> String {
    let err = if error {
        r#"<p class="err">Incorrect password.</p>"#
    } else {
        ""
    };
    format!(
        r#"<!doctype html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>TWUI Editor - Sign in</title>
<style>
  html, body {{ height: 100%; margin: 0; background: #15161c;
    font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif; color: #e6e6ec; }}
  .wrap {{ position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }}
  form {{ display: flex; flex-direction: column; gap: 12px; width: 280px;
    padding: 24px; background: #1c1e26; border: 1px solid #2a2d3a; border-radius: 10px; }}
  .name {{ font-size: 14px; font-weight: 600; color: #c9a227; letter-spacing: 0.04em; }}
  .sub {{ font-size: 12px; color: #6b7081; margin-bottom: 4px; }}
  input {{ padding: 9px 10px; border-radius: 6px; border: 1px solid #2a2d3a;
    background: #15161c; color: #e6e6ec; font-size: 13px; }}
  button {{ padding: 9px 10px; border: none; border-radius: 6px; background: #c9a227;
    color: #15161c; font-weight: 600; font-size: 13px; cursor: pointer; }}
  .err {{ color: #e06c75; font-size: 12px; margin: 0; }}
</style></head>
<body><div class="wrap">
  <form method="post" action="/api/login">
    <div class="name">TWUI Editor</div>
    <div class="sub">Enter the access password to continue.</div>
    {err}
    <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password" />
    <button type="submit">Sign in</button>
  </form>
</div></body></html>"#
    )
}
