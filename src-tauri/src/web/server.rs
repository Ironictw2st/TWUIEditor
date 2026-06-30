//! Lifecycle for the experimental web access server: bind synchronously (so
//! errors surface to the caller), then run axum on a dedicated thread with its
//! own tokio runtime and a graceful-shutdown channel.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, UdpSocket};
use std::sync::Mutex;
use std::thread::JoinHandle;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::sync::oneshot;

use super::routes;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BindKind {
    /// 127.0.0.1 — only this machine.
    Loopback,
    /// 0.0.0.0 — every interface (LAN, Tailscale, …).
    Lan,
    /// A specific interface IP entered by the user.
    Custom,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebOpts {
    pub bind: BindKind,
    pub port: u16,
    #[serde(default)]
    pub custom_ip: Option<String>,
    pub password: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebInfo {
    /// A URL the user can open/share (best-effort host for LAN binds).
    pub url: String,
    pub bind: BindKind,
    pub host: String,
    pub port: u16,
}

struct RunningServer {
    shutdown: Option<oneshot::Sender<()>>,
    thread: Option<JoinHandle<()>>,
    info: WebInfo,
}

#[derive(Default)]
pub struct WebServer {
    running: Mutex<Option<RunningServer>>,
}

impl WebServer {
    /// Currently-running server info, or `None` when stopped.
    pub fn status(&self) -> Option<WebInfo> {
        self.running.lock().unwrap().as_ref().map(|r| r.info.clone())
    }

    pub fn start(&self, app: AppHandle, opts: WebOpts) -> Result<WebInfo, String> {
        if self.running.lock().unwrap().is_some() {
            return Err("web server is already running".into());
        }
        if opts.password.trim().is_empty() {
            return Err("set a password before enabling web access".into());
        }

        let ip: IpAddr = match opts.bind {
            BindKind::Loopback => IpAddr::V4(Ipv4Addr::LOCALHOST),
            BindKind::Lan => IpAddr::V4(Ipv4Addr::UNSPECIFIED), // 0.0.0.0
            BindKind::Custom => opts
                .custom_ip
                .as_deref()
                .unwrap_or("")
                .trim()
                .parse()
                .map_err(|_| "invalid custom IP address".to_string())?,
        };
        let addr = SocketAddr::new(ip, opts.port);

        // Bind synchronously so "address in use" / "permission denied" is
        // reported to the UI immediately instead of dying on the server thread.
        let listener = TcpListener::bind(addr).map_err(|e| format!("cannot bind {addr}: {e}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("cannot configure listener: {e}"))?;
        let local = listener.local_addr().unwrap_or(addr);

        // The host to show in the share URL. A 0.0.0.0 bind isn't a connectable
        // address, so for LAN we guess the primary interface IP (the user can
        // substitute their Tailscale IP); loopback/custom use the bind IP.
        let host = match opts.bind {
            BindKind::Lan => primary_local_ip()
                .map(|ip| ip.to_string())
                .unwrap_or_else(|| "<this-machine-ip>".into()),
            _ => local.ip().to_string(),
        };
        let info = WebInfo {
            url: format!("http://{host}:{}", local.port()),
            bind: opts.bind,
            host,
            port: local.port(),
        };

        let router = routes::build_router(app, opts.password);
        let (tx, rx) = oneshot::channel::<()>();

        let thread = std::thread::Builder::new()
            .name("twui-web".into())
            .spawn(move || {
                let rt = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
                    Ok(rt) => rt,
                    Err(e) => {
                        eprintln!("web: failed to build runtime: {e}");
                        return;
                    }
                };
                rt.block_on(async move {
                    let listener = match tokio::net::TcpListener::from_std(listener) {
                        Ok(l) => l,
                        Err(e) => {
                            eprintln!("web: from_std failed: {e}");
                            return;
                        }
                    };
                    let served = axum::serve(listener, router)
                        .with_graceful_shutdown(async move {
                            let _ = rx.await;
                        });
                    if let Err(e) = served.await {
                        eprintln!("web: server error: {e}");
                    }
                });
            })
            .map_err(|e| format!("cannot spawn web thread: {e}"))?;

        *self.running.lock().unwrap() = Some(RunningServer {
            shutdown: Some(tx),
            thread: Some(thread),
            info: info.clone(),
        });
        Ok(info)
    }

    pub fn stop(&self) -> Result<(), String> {
        let Some(mut server) = self.running.lock().unwrap().take() else {
            return Ok(());
        };
        if let Some(tx) = server.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(thread) = server.thread.take() {
            let _ = thread.join();
        }
        Ok(())
    }
}

/// Best-effort primary LAN IP: open a UDP socket "to" a public address (no
/// packets are sent) and read back the local address the OS would route from.
fn primary_local_ip() -> Option<IpAddr> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    sock.local_addr().ok().map(|a| a.ip())
}
