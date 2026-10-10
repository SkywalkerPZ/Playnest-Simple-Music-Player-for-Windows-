//! A tiny local HTTP relay for audio.
//!
//! YouTube's stream URLs don't send CORS headers, so the webview may play
//! them but isn't allowed to *read* the audio. That blocks the visualizer,
//! the equalizer and volume levelling, which all need the Web Audio API.
//! Routing playback through this relay (same bytes, plus CORS headers) lifts
//! that restriction.
//!
//! Safety: it listens on 127.0.0.1 only, on a random port, and it is not an
//! open proxy. It only serves sources Playnest itself registered, each under
//! a random 128-bit token, so nothing else on the machine or on a web page
//! can use it to fetch arbitrary URLs or read arbitrary files.

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, Request, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use rand::RngCore;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;
use tower_http::services::ServeFile;

#[derive(Clone, Debug)]
pub enum Source {
    Remote(String),
    Local(PathBuf),
}

/// Enough for a long queue plus crossfades; old tokens are dropped first.
const MAX_SOURCES: usize = 64;

#[derive(Default)]
struct Registry {
    map: HashMap<String, Source>,
    order: VecDeque<String>,
}

#[derive(Clone)]
pub struct Relay {
    port: u16,
    registry: Arc<Mutex<Registry>>,
    client: reqwest::Client,
}

impl Relay {
    /// Bind to a random loopback port and start serving in the background.
    pub fn start() -> std::io::Result<Relay> {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();

        let relay = Relay {
            port,
            registry: Arc::new(Mutex::new(Registry::default())),
            client: reqwest::Client::builder()
                .build()
                .map_err(|e| std::io::Error::other(e.to_string()))?,
        };

        let app = Router::new()
            .route("/s/{token}", get(serve).options(preflight))
            .with_state(relay.clone());

        tauri::async_runtime::spawn(async move {
            match tokio::net::TcpListener::from_std(listener) {
                Ok(listener) => {
                    if let Err(err) = axum::serve(listener, app).await {
                        eprintln!("audio relay stopped: {err}");
                    }
                }
                Err(err) => eprintln!("audio relay couldn't start: {err}"),
            }
        });

        Ok(relay)
    }

    /// Register a source and return the loopback URL that serves it.
    pub fn register(&self, source: Source) -> String {
        let mut bytes = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut bytes);
        let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();

        let mut registry = self.registry.lock().expect("relay registry poisoned");
        registry.map.insert(token.clone(), source);
        registry.order.push_back(token.clone());
        while registry.order.len() > MAX_SOURCES {
            if let Some(old) = registry.order.pop_front() {
                registry.map.remove(&old);
            }
        }

        format!("http://127.0.0.1:{}/s/{token}", self.port)
    }

    #[cfg(test)]
    pub fn port(&self) -> u16 {
        self.port
    }
}

fn with_cors(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("Content-Length, Content-Range, Accept-Ranges"),
    );
    headers.insert("Cross-Origin-Resource-Policy", HeaderValue::from_static("cross-origin"));
    response
}

async fn preflight() -> Response {
    let mut response = StatusCode::NO_CONTENT.into_response();
    let headers = response.headers_mut();
    headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, HEAD, OPTIONS"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("Range"));
    with_cors(response)
}

async fn serve(
    State(relay): State<Relay>,
    Path(token): Path<String>,
    request: Request<Body>,
) -> Response {
    let source = relay
        .registry
        .lock()
        .expect("relay registry poisoned")
        .map
        .get(&token)
        .cloned();

    let response = match source {
        None => StatusCode::NOT_FOUND.into_response(),
        Some(Source::Local(path)) => match ServeFile::new(path).oneshot(request).await {
            Ok(response) => response.map(Body::new),
            Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response(),
        },
        Some(Source::Remote(url)) => proxy(&relay.client, &url, request.headers()).await,
    };
    with_cors(response)
}

/// Forward a request to the real stream, passing through the Range header
/// (so seeking works) and the webview's own User-Agent, and stream the
/// body back without buffering it.
async fn proxy(client: &reqwest::Client, url: &str, incoming: &HeaderMap) -> Response {
    let mut request = client.get(url);
    for name in [header::RANGE, header::USER_AGENT] {
        if let Some(value) = incoming.get(&name) {
            request = request.header(name, value.clone());
        }
    }

    let upstream = match request.send().await {
        Ok(upstream) => upstream,
        Err(err) => return (StatusCode::BAD_GATEWAY, err.to_string()).into_response(),
    };

    let mut builder = Response::builder().status(upstream.status().as_u16());
    for name in [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
        header::LAST_MODIFIED,
        header::ETAG,
    ] {
        if let Some(value) = upstream.headers().get(&name) {
            builder = builder.header(name, value.clone());
        }
    }

    builder
        .body(Body::from_stream(upstream.bytes_stream()))
        .unwrap_or_else(|err| (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    fn raw_get(port: u16, path: &str, extra_headers: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(stream, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{extra_headers}Connection: close\r\n\r\n").unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    #[tokio::test]
    async fn serves_registered_files_with_cors_and_ranges() {
        let dir = std::env::temp_dir().join(format!("playnest-relay-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("track.m4a");
        std::fs::write(&file, b"0123456789").unwrap();

        let relay = Relay::start().unwrap();
        let url = relay.register(Source::Local(file.clone()));
        let path = url.split_once(&format!(":{}", relay.port())).unwrap().1.to_string();
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let port = relay.port();
        let (full, ranged, unknown) = tokio::task::spawn_blocking(move || {
            (
                raw_get(port, &path, ""),
                raw_get(port, &path, "Range: bytes=2-5\r\n"),
                raw_get(port, "/s/00000000000000000000000000000000", ""),
            )
        })
        .await
        .unwrap();

        assert!(full.starts_with("HTTP/1.1 200"), "{full}");
        assert!(full.to_lowercase().contains("access-control-allow-origin: *"), "{full}");
        assert!(full.ends_with("0123456789"), "{full}");

        assert!(ranged.starts_with("HTTP/1.1 206"), "{ranged}");
        assert!(ranged.ends_with("2345"), "{ranged}");

        assert!(unknown.starts_with("HTTP/1.1 404"), "{unknown}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn proxies_remote_streams_with_ranges() {
        // A second relay stands in for YouTube's CDN: a plain HTTP server
        // that supports ranges but (unlike ours) we reach "remotely".
        let dir = std::env::temp_dir().join(format!("playnest-relay-remote-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("remote.webm");
        std::fs::write(&file, b"abcdefghijklmnop").unwrap();
        let upstream = Relay::start().unwrap();
        let upstream_url = upstream.register(Source::Local(file));

        let relay = Relay::start().unwrap();
        let url = relay.register(Source::Remote(upstream_url));
        let path = url.split_once(&format!(":{}", relay.port())).unwrap().1.to_string();
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let port = relay.port();
        let ranged = tokio::task::spawn_blocking(move || raw_get(port, &path, "Range: bytes=4-7\r\n"))
            .await
            .unwrap();
        assert!(ranged.starts_with("HTTP/1.1 206"), "{ranged}");
        assert!(ranged.to_lowercase().contains("content-range: bytes 4-7/16"), "{ranged}");
        assert!(ranged.to_lowercase().contains("access-control-allow-origin: *"), "{ranged}");
        assert!(ranged.ends_with("efgh"), "{ranged}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn tokens_are_unique_and_old_ones_expire() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let _guard = rt.enter();
        let relay = Relay::start().unwrap();
        let first = relay.register(Source::Remote("https://example.com/a".into()));
        let second = relay.register(Source::Remote("https://example.com/b".into()));
        assert_ne!(first, second);
        for i in 0..MAX_SOURCES {
            relay.register(Source::Remote(format!("https://example.com/{i}")));
        }
        let token = first.rsplit('/').next().unwrap();
        assert!(!relay.registry.lock().unwrap().map.contains_key(token));
    }
}
