use std::{collections::HashMap, sync::Arc, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{oneshot, Mutex},
    task::JoinHandle,
    time::{sleep_until, timeout, Instant},
};

use super::rendered_crawler::{RenderOptions, RenderedCrawlerSession, RenderedPageSnapshot};
use crate::utils::url_validator::validate_and_normalize_url;

/// Protocol version is deliberately explicit so a future desktop release
/// cannot silently accept a request built for an incompatible worker.
pub const RENDER_WORKER_VERSION: &str = "1";
const WORKER_TTL: Duration = Duration::from_secs(90);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(75);
const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_BODY_BYTES: usize = 64 * 1024;
const MAX_REQUEST_BYTES: usize = MAX_HEADER_BYTES + MAX_BODY_BYTES;
const MAX_SCOPE_PATH_CHARS: usize = 2_048;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderWorkerLease {
    pub base_url: String,
    pub token: String,
    pub version: String,
    pub expires_at: String,
    pub one_shot: bool,
}

#[derive(Debug, Default)]
pub struct RenderWorkerState {
    active: Mutex<Option<WorkerHandle>>,
}

#[derive(Debug)]
struct WorkerHandle {
    shutdown: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
}

#[derive(Debug, Clone)]
struct WorkerShared {
    app: AppHandle,
    token: Arc<Mutex<Option<String>>>,
    expires_at: Instant,
    expires_at_text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RenderWorkerRequest {
    url: String,
    #[serde(default)]
    allow_subdomains: bool,
    scope_path: Option<String>,
    wait_for_selector: Option<String>,
    #[serde(default)]
    wait_delay_ms: u64,
    #[serde(default)]
    lazy_scroll_cycles: usize,
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

#[tauri::command]
pub async fn start_render_worker(
    app: AppHandle,
    state: State<'_, RenderWorkerState>,
) -> Result<RenderWorkerLease, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| format!("Unable to bind the local render worker: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("Unable to read the local render worker address: {error}"))?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    let expires_at = Instant::now() + WORKER_TTL;
    let (shutdown_sender, shutdown_receiver) = oneshot::channel();
    let expires_at_text = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::from_std(WORKER_TTL).expect("fixed duration"))
        .expect("worker expiry is representable")
        .to_rfc3339();
    let shared = WorkerShared {
        app,
        token: Arc::new(Mutex::new(Some(token.clone()))),
        expires_at,
        expires_at_text: expires_at_text.clone(),
    };
    let task = tokio::spawn(run_worker(listener, shared, shutdown_receiver));

    let mut active = state.active.lock().await;
    if let Some(previous) = active.take() {
        let _ = previous.shutdown.map(|sender| sender.send(()));
        previous.task.abort();
    }
    *active = Some(WorkerHandle {
        shutdown: Some(shutdown_sender),
        task,
    });

    Ok(RenderWorkerLease {
        base_url: format!("http://127.0.0.1:{}", address.port()),
        token,
        version: RENDER_WORKER_VERSION.to_string(),
        expires_at: expires_at_text,
        one_shot: true,
    })
}

#[tauri::command]
pub async fn stop_render_worker(state: State<'_, RenderWorkerState>) -> Result<(), String> {
    let mut active = state.active.lock().await;
    if let Some(handle) = active.take() {
        let _ = handle.shutdown.map(|sender| sender.send(()));
        handle.task.abort();
    }
    Ok(())
}

#[tauri::command]
pub async fn render_worker_status(state: State<'_, RenderWorkerState>) -> Result<bool, String> {
    let mut active = state.active.lock().await;
    if active
        .as_ref()
        .is_some_and(|handle| handle.task.is_finished())
    {
        active.take();
    }
    Ok(active.is_some())
}

async fn run_worker(
    listener: TcpListener,
    shared: WorkerShared,
    mut shutdown: oneshot::Receiver<()>,
) {
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            _ = sleep_until(shared.expires_at) => break,
            accepted = listener.accept() => {
                let Ok((stream, peer)) = accepted else { break; };
                if !peer.ip().is_loopback() {
                    continue;
                }
                let connection_shared = shared.clone();
                tokio::spawn(async move {
                    let _ = timeout(REQUEST_TIMEOUT, handle_connection(stream, connection_shared)).await;
                });
            }
        }
    }
}

async fn handle_connection(mut stream: TcpStream, shared: WorkerShared) -> Result<(), String> {
    let request = match read_request(&mut stream).await {
        Ok(request) => request,
        Err(error) => {
            return write_response(&mut stream, 400, "application/json", &json_error(&error)).await;
        }
    };
    let (status, content_type, body) = match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/health") => {
            let expired = Instant::now() >= shared.expires_at;
            let body = serde_json::json!({
                "ok": !expired,
                "version": RENDER_WORKER_VERSION,
                "renderer": crate::commands::rendered_artifacts::renderer_platform(),
                "expiresAt": shared.expires_at_text,
                "expiresInSeconds": shared.expires_at.saturating_duration_since(Instant::now()).as_secs(),
            });
            (
                if expired { 410 } else { 200 },
                "application/json",
                serde_json::to_vec(&body).map_err(|error| error.to_string())?,
            )
        }
        ("POST", "/v1/render") => {
            if Instant::now() >= shared.expires_at {
                return write_response(
                    &mut stream,
                    410,
                    "application/json",
                    &json_error("Worker lease has expired."),
                )
                .await;
            }
            let version = request
                .headers
                .get("x-seomi-worker-version")
                .map(String::as_str);
            if version != Some(RENDER_WORKER_VERSION) {
                return write_response(
                    &mut stream,
                    426,
                    "application/json",
                    &json_error("Worker protocol version is not supported."),
                )
                .await;
            }
            let authorization = request.headers.get("authorization").map(String::as_str);
            if !bearer_matches(authorization, &shared.token).await {
                return write_response(
                    &mut stream,
                    401,
                    "application/json",
                    &json_error("Worker token is invalid or already used."),
                )
                .await;
            }
            let content_type = request.headers.get("content-type").map(String::as_str);
            if !content_type.is_some_and(|value| value.eq_ignore_ascii_case("application/json")) {
                return write_response(
                    &mut stream,
                    415,
                    "application/json",
                    &json_error("Worker requests must use Content-Type: application/json."),
                )
                .await;
            }
            let payload: RenderWorkerRequest = match serde_json::from_slice(&request.body) {
                Ok(payload) => payload,
                Err(error) => {
                    return write_response(
                        &mut stream,
                        400,
                        "application/json",
                        &json_error(&format!("Invalid render request: {error}")),
                    )
                    .await
                }
            };
            let result = render_request(&shared.app, payload).await;
            match result {
                Ok(snapshot) => {
                    let body = serde_json::to_vec(&snapshot).map_err(|error| error.to_string())?;
                    if body.len() > 8 * 1024 * 1024 {
                        (
                            413,
                            "application/json",
                            json_error("Rendered snapshot exceeds the response safety limit."),
                        )
                    } else {
                        (200, "application/json", body)
                    }
                }
                Err(error) => (422, "application/json", json_error(&error)),
            }
        }
        _ => (
            404,
            "application/json",
            json_error("Worker route not found."),
        ),
    };
    write_response(&mut stream, status, content_type, &body).await
}

async fn render_request(
    app: &AppHandle,
    request: RenderWorkerRequest,
) -> Result<RenderedPageSnapshot, String> {
    let target = validate_and_normalize_url(&request.url).map_err(|error| error.to_string())?;
    let base_host = target
        .host_str()
        .ok_or_else(|| "Rendered URL has no hostname.".to_string())?
        .to_ascii_lowercase();
    let scope_path = normalize_scope_path(request.scope_path.as_deref())?;
    let wait_for_selector = request
        .wait_for_selector
        .as_deref()
        .map(|value| normalize_bounded_text(value, "waitForSelector", 512))
        .transpose()?;
    let options = RenderOptions {
        user_agent: None,
        cookie: None,
        wait_for_selector,
        wait_delay_ms: request.wait_delay_ms.min(10_000),
        lazy_scroll_cycles: request.lazy_scroll_cycles.min(40),
    };
    let mut session = RenderedCrawlerSession::open(
        app,
        target.as_str(),
        &base_host,
        request.allow_subdomains,
        scope_path.as_deref(),
        options,
    )
    .await?;
    let result = session.capture(target.as_str()).await;
    session.close();
    result
}

fn normalize_scope_path(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let value = normalize_bounded_text(value, "scopePath", MAX_SCOPE_PATH_CHARS)?;
    if !value.starts_with('/') || value.contains("\0") {
        return Err("scopePath must be an absolute URL path without null characters.".into());
    }
    Ok(Some(value.trim_end_matches('/').to_string()))
}

fn normalize_bounded_text(value: &str, field: &str, max_chars: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{field} cannot be empty."));
    }
    if value.chars().count() > max_chars {
        return Err(format!(
            "{field} exceeds the {max_chars}-character safety limit."
        ));
    }
    if value.chars().any(|character| character == '\0') {
        return Err(format!("{field} contains an invalid null character."));
    }
    Ok(value.to_string())
}

async fn bearer_matches(authorization: Option<&str>, token: &Arc<Mutex<Option<String>>>) -> bool {
    let Some(authorization) = authorization else {
        return false;
    };
    let Some(candidate) = authorization.strip_prefix("Bearer ") else {
        return false;
    };
    let mut expected = token.lock().await;
    if expected.as_deref() != Some(candidate) {
        return false;
    }
    expected.take();
    true
}

async fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut bytes = Vec::with_capacity(8 * 1024);
    let header_end = loop {
        if let Some(index) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            break index;
        }
        if bytes.len() >= MAX_HEADER_BYTES {
            return Err("Worker request headers exceed the safety limit.".into());
        }
        let mut chunk = [0u8; 4096];
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("Worker request ended before headers were complete.".into());
        }
        bytes.extend_from_slice(&chunk[..read]);
    };
    let header_length = header_end + 4;
    let header_text = std::str::from_utf8(&bytes[..header_end])
        .map_err(|_| "Worker request headers are not UTF-8.".to_string())?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "Worker request line is missing.".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let path = request_parts.next().unwrap_or_default().to_string();
    if request_parts.next().is_none() || method.len() > 16 || path.len() > 2048 {
        return Err("Worker request line is invalid.".into());
    }
    let mut headers = HashMap::new();
    for line in lines {
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| "Worker request header is invalid.".to_string())?;
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim().to_string();
        if name.is_empty() || headers.insert(name.clone(), value).is_some() {
            return Err("Worker request contains duplicate or empty headers.".into());
        }
    }
    if headers.contains_key("transfer-encoding") {
        return Err("Chunked worker requests are not supported.".into());
    }
    let content_length = headers
        .get("content-length")
        .map(|value| {
            value
                .parse::<usize>()
                .map_err(|_| "Worker content-length is invalid.".to_string())
        })
        .transpose()?
        .unwrap_or(0);
    if content_length > MAX_BODY_BYTES || header_length + content_length > MAX_REQUEST_BYTES {
        return Err("Worker request body exceeds the safety limit.".into());
    }
    while bytes.len() < header_length + content_length {
        let mut chunk = [0u8; 4096];
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("Worker request ended before the body was complete.".into());
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
    Ok(HttpRequest {
        method,
        path,
        headers,
        body: bytes[header_length..header_length + content_length].to_vec(),
    })
}

fn json_error(message: &str) -> Vec<u8> {
    serde_json::to_vec(&ErrorResponse {
        error: message.to_string(),
    })
    .unwrap_or_else(|_| b"{\"error\":\"worker error\"}".to_vec())
}

async fn write_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        410 => "Gone",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        422 => "Unprocessable Entity",
        426 => "Upgrade Required",
        _ => "Error",
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(header.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    stream
        .write_all(body)
        .await
        .map_err(|error| error.to_string())?;
    let _ = stream.shutdown().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_path_requires_a_rooted_path_and_is_trimmed() {
        assert_eq!(
            normalize_scope_path(Some(" /docs/ ")).unwrap(),
            Some("/docs".into())
        );
        assert!(normalize_scope_path(Some("docs")).is_err());
        assert!(normalize_scope_path(Some("/docs\0evil")).is_err());
    }

    #[test]
    fn bounded_worker_text_rejects_empty_long_and_null_values() {
        assert!(normalize_bounded_text(" ", "selector", 10).is_err());
        assert!(normalize_bounded_text("123456", "selector", 5).is_err());
        assert!(normalize_bounded_text("ok\0", "selector", 10).is_err());
        assert_eq!(
            normalize_bounded_text(" h1 ", "selector", 10).unwrap(),
            "h1"
        );
    }

    #[test]
    fn worker_protocol_is_explicit_and_short_lived() {
        assert_eq!(RENDER_WORKER_VERSION, "1");
        assert!(WORKER_TTL <= Duration::from_secs(120));
        assert_eq!(MAX_BODY_BYTES, 64 * 1024);
    }

    #[test]
    fn render_request_schema_does_not_accept_transport_hooks() {
        let error = serde_json::from_str::<RenderWorkerRequest>(
            r#"{"url":"https://example.test","proxy":"http://127.0.0.1"}"#,
        )
        .unwrap_err();
        assert!(error.to_string().contains("unknown field"));
    }

    #[tokio::test]
    async fn bearer_token_is_consumed_after_the_first_valid_request() {
        let token = Arc::new(Mutex::new(Some("one-shot".to_string())));
        assert!(bearer_matches(Some("Bearer one-shot"), &token).await);
        assert!(!bearer_matches(Some("Bearer one-shot"), &token).await);
        assert!(!bearer_matches(Some("Bearer other"), &token).await);
    }
}
