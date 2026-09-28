use std::io;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{lookup_host, TcpListener, TcpStream};
use tokio::sync::{watch, Semaphore};
use tokio::task::JoinHandle;
use tokio::time::timeout;
use url::Url;

use crate::utils::url_validator::is_public_ip;

const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_REQUEST_BODY_BYTES: usize = 1024 * 1024;
const MAX_CONCURRENT_CONNECTIONS: usize = 32;
const ALLOWED_HTTP_PORTS: [u16; 2] = [80, 8080];
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(45);
const TUNNEL_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// Short-lived loopback proxy for the isolated rendered-page webview.
/// It never resolves a destination and then reconnects by hostname: outbound
/// sockets use one of the already-validated public IPs returned by DNS.
pub struct BrowserRequestProxy {
    address: SocketAddr,
    shutdown: Option<watch::Sender<bool>>,
    task: Option<JoinHandle<()>>,
}

impl BrowserRequestProxy {
    pub async fn start() -> io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let address = listener.local_addr()?;
        let (shutdown, mut shutdown_rx) = watch::channel(false);
        let task = tokio::spawn(async move {
            let permits = Arc::new(Semaphore::new(MAX_CONCURRENT_CONNECTIONS));
            loop {
                tokio::select! {
                    changed = shutdown_rx.changed() => {
                        if changed.is_err() || *shutdown_rx.borrow() { break; }
                    }
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else { break; };
                        let Ok(permit) = permits.clone().try_acquire_owned() else {
                            reject(stream, 503, "Proxy connection limit reached").await;
                            continue;
                        };
                        let mut connection_shutdown = shutdown_rx.clone();
                        tokio::spawn(async move {
                            tokio::select! {
                                _ = serve_connection(stream) => {},
                                _ = connection_shutdown.changed() => {},
                            }
                            drop(permit);
                        });
                    }
                }
            }
        });
        Ok(Self {
            address,
            shutdown: Some(shutdown),
            task: Some(task),
        })
    }

    pub fn url(&self) -> Url {
        Url::parse(&format!(
            "http://{}:{}",
            self.address.ip(),
            self.address.port()
        ))
        .expect("loopback proxy address is a valid URL")
    }

    pub async fn stop(mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(true);
        }
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }
    }
}

impl Drop for BrowserRequestProxy {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(true);
        }
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

enum ProxyTarget {
    Connect {
        host: String,
        port: u16,
    },
    Http {
        method: String,
        url: Url,
        headers: Vec<(String, String)>,
    },
}

async fn serve_connection(mut client: TcpStream) {
    let request = match timeout(REQUEST_TIMEOUT, read_request(&mut client)).await {
        Ok(Ok(request)) => request,
        Ok(Err(status)) => {
            reject(client, status, "Invalid or unsupported proxy request").await;
            return;
        }
        Err(_) => {
            reject(client, 408, "Proxy request timed out").await;
            return;
        }
    };

    match request.target {
        ProxyTarget::Connect { host, port } => {
            if !matches!(port, 443 | 8443) {
                reject(client, 403, "Only public HTTPS tunnels are allowed").await;
                return;
            }
            let mut upstream = match connect_to_public_host(&host, port).await {
                Ok(stream) => stream,
                Err(_) => {
                    reject(client, 403, "Destination is not a verified public host").await;
                    return;
                }
            };
            if client
                .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                .await
                .is_err()
            {
                return;
            }
            let _ = timeout(
                TUNNEL_TIMEOUT,
                tokio::io::copy_bidirectional(&mut client, &mut upstream),
            )
            .await;
        }
        ProxyTarget::Http {
            method,
            url,
            headers,
        } => {
            let port = url.port_or_known_default().unwrap_or(80);
            if !is_allowed_plain_http_port(port) {
                reject(client, 403, "Only public web ports are allowed").await;
                return;
            }
            let host = url.host_str().unwrap_or_default().to_string();
            let mut upstream = match connect_to_public_host(&host, port).await {
                Ok(stream) => stream,
                Err(_) => {
                    reject(client, 403, "Destination is not a verified public host").await;
                    return;
                }
            };
            let mut outbound = format!("{method} {} HTTP/1.1\r\n", request_target(&url));
            for (name, value) in headers {
                let normalized = name.to_ascii_lowercase();
                if matches!(
                    normalized.as_str(),
                    "proxy-connection" | "proxy-authorization" | "connection" | "host"
                ) {
                    continue;
                }
                outbound.push_str(&name);
                outbound.push_str(": ");
                outbound.push_str(&value);
                outbound.push_str("\r\n");
            }
            outbound.push_str("Host: ");
            outbound.push_str(&authority_for(&url));
            outbound.push_str("\r\nConnection: close\r\n\r\n");
            if upstream.write_all(outbound.as_bytes()).await.is_err()
                || (!request.body.is_empty() && upstream.write_all(&request.body).await.is_err())
            {
                reject(client, 502, "Could not forward the public HTTP request").await;
                return;
            }
            let _ = timeout(REQUEST_TIMEOUT, tokio::io::copy(&mut upstream, &mut client)).await;
        }
    }
}

struct ParsedRequest {
    target: ProxyTarget,
    body: Vec<u8>,
}

async fn read_request(client: &mut TcpStream) -> Result<ParsedRequest, u16> {
    let mut bytes = Vec::with_capacity(8 * 1024);
    let header_end = loop {
        if let Some(index) = find_header_end(&bytes) {
            break index;
        }
        if bytes.len() >= MAX_HEADER_BYTES {
            return Err(431);
        }
        let mut chunk = [0_u8; 4096];
        let read = client.read(&mut chunk).await.map_err(|_| 400_u16)?;
        if read == 0 {
            return Err(400);
        }
        bytes.extend_from_slice(&chunk[..read]);
    };
    let header = std::str::from_utf8(&bytes[..header_end]).map_err(|_| 400_u16)?;
    let parsed_head = parse_request_head(header)?;
    let RequestHead {
        method,
        target,
        headers,
        content_length,
    } = parsed_head;
    let body_start = header_end + 4;
    let mut body = bytes[body_start..].to_vec();
    if body.len() > content_length {
        return Err(400);
    }
    while body.len() < content_length {
        let remaining = content_length - body.len();
        let mut chunk = vec![0_u8; remaining.min(16 * 1024)];
        let read = client.read(&mut chunk).await.map_err(|_| 400_u16)?;
        if read == 0 {
            return Err(400);
        }
        body.extend_from_slice(&chunk[..read]);
    }

    let parsed_target = parse_proxy_target(method, target, headers, content_length, &body)?;
    Ok(ParsedRequest {
        target: parsed_target,
        body,
    })
}

#[derive(Debug)]
struct RequestHead {
    method: String,
    target: String,
    headers: Vec<(String, String)>,
    content_length: usize,
}

fn parse_request_head(header: &str) -> Result<RequestHead, u16> {
    let mut lines = header.split("\r\n");
    let request_line = lines.next().ok_or(400_u16)?;
    let mut request_parts = request_line.split_ascii_whitespace();
    let method = request_parts.next().ok_or(400_u16)?;
    let target = request_parts.next().ok_or(400_u16)?;
    let version = request_parts.next().ok_or(400_u16)?;
    if request_parts.next().is_some()
        || !matches!(version, "HTTP/1.0" | "HTTP/1.1")
        || !method.bytes().all(is_http_token_byte)
        || target
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == b' ')
    {
        return Err(400);
    }
    if !method.eq_ignore_ascii_case("GET")
        && !method.eq_ignore_ascii_case("HEAD")
        && !method.eq_ignore_ascii_case("CONNECT")
    {
        return Err(405);
    }

    let mut headers = Vec::new();
    let mut content_length = None;
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let (name, value) = line.split_once(':').ok_or(400_u16)?;
        if name.is_empty()
            || !name.bytes().all(is_http_token_byte)
            || value
                .bytes()
                .any(|byte| (byte < b' ' && byte != b'\t') || byte == 0x7f)
        {
            return Err(400);
        }
        let name = name.trim();
        let value = value.trim();
        match name.to_ascii_lowercase().as_str() {
            "transfer-encoding" | "expect" => return Err(400),
            "content-length" => {
                if content_length.is_some() {
                    return Err(400);
                }
                content_length = Some(value.parse::<usize>().map_err(|_| 400_u16)?);
            }
            _ => {}
        }
        headers.push((name.to_owned(), value.to_owned()));
    }
    let content_length = content_length.unwrap_or(0);
    if content_length > MAX_REQUEST_BODY_BYTES {
        return Err(413);
    }
    Ok(RequestHead {
        method: method.to_owned(),
        target: target.to_owned(),
        headers,
        content_length,
    })
}

fn is_http_token_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte)
}

fn parse_proxy_target(
    method: String,
    target: String,
    headers: Vec<(String, String)>,
    content_length: usize,
    body: &[u8],
) -> Result<ProxyTarget, u16> {
    if method.eq_ignore_ascii_case("CONNECT") {
        let parsed = Url::parse(&format!("https://{target}/")).map_err(|_| 400_u16)?;
        let host = parsed.host_str().ok_or(400_u16)?.to_ascii_lowercase();
        let port = parsed.port().unwrap_or(443);
        if parsed.path() != "/"
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || target.contains('@')
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || content_length != 0
            || !body.is_empty()
        {
            return Err(400);
        }
        Ok(ProxyTarget::Connect { host, port })
    } else {
        if !method.eq_ignore_ascii_case("GET") && !method.eq_ignore_ascii_case("HEAD") {
            return Err(405);
        }
        let url = Url::parse(&target).map_err(|_| 400_u16)?;
        if url.scheme() != "http"
            || !url.username().is_empty()
            || url.password().is_some()
            || authority_contains_userinfo(&target)
            || content_length != 0
            || !body.is_empty()
        {
            return Err(400);
        }
        Ok(ProxyTarget::Http {
            method: method.to_ascii_uppercase(),
            url,
            headers,
        })
    }
}

fn authority_contains_userinfo(target: &str) -> bool {
    let Some((_, remainder)) = target.split_once("://") else {
        return false;
    };
    remainder
        .split(['/', '?', '#'])
        .next()
        .is_some_and(|authority| authority.contains('@'))
}

fn is_allowed_plain_http_port(port: u16) -> bool {
    ALLOWED_HTTP_PORTS.contains(&port)
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

async fn connect_to_public_host(host: &str, port: u16) -> io::Result<TcpStream> {
    let normalized_host = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    if is_local_hostname(normalized_host) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "local hostname blocked",
        ));
    }
    let destinations = if let Ok(ip) = normalized_host.parse::<IpAddr>() {
        vec![SocketAddr::new(ip, port)]
    } else {
        lookup_host((normalized_host, port))
            .await?
            .collect::<Vec<_>>()
    };
    let public = destinations
        .into_iter()
        .find(|address| is_public_ip(&address.ip()))
        .ok_or_else(|| io::Error::new(io::ErrorKind::PermissionDenied, "no public DNS result"))?;
    timeout(CONNECT_TIMEOUT, TcpStream::connect(public))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "upstream connect timed out"))?
}

fn is_local_hostname(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".lan")
        || host == "metadata.google.internal"
}

fn request_target(url: &Url) -> String {
    let mut target = url.path().to_owned();
    if target.is_empty() {
        target.push('/');
    }
    if let Some(query) = url.query() {
        target.push('?');
        target.push_str(query);
    }
    target
}

fn authority_for(url: &Url) -> String {
    match url.port() {
        Some(port) => format!("{}:{port}", url.host_str().unwrap_or_default()),
        None => url.host_str().unwrap_or_default().to_owned(),
    }
}

async fn reject(mut stream: TcpStream, status: u16, message: &str) {
    let body = message.as_bytes();
    let response = format!(
        "HTTP/1.1 {status} {}\r\nConnection: close\r\nContent-Length: {}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n",
        reason_phrase(status),
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.write_all(body).await;
    let _ = stream.shutdown().await;
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        400 => "Bad Request",
        403 => "Forbidden",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        413 => "Payload Too Large",
        431 => "Request Header Fields Too Large",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "Error",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_and_metadata_names_are_rejected_before_dns() {
        for host in [
            "localhost",
            "router.local",
            "service.internal",
            "db.lan",
            "metadata.google.internal",
        ] {
            assert!(is_local_hostname(host), "{host} should be blocked");
        }
        assert!(!is_local_hostname("example.com"));
    }

    #[test]
    fn request_parser_accepts_only_unambiguous_bounded_headers() {
        let parsed = parse_request_head(
            "GET http://example.com/a?q=1 HTTP/1.1\r\nHost: example.com\r\nContent-Length: 0",
        )
        .unwrap();
        assert_eq!(parsed.method, "GET");
        assert_eq!(parsed.content_length, 0);

        for malformed in [
            "GET http://example.com/ HTTP/1.1\r\nContent-Length: 0\r\nContent-Length: 0",
            "GET http://example.com/ HTTP/1.1\r\nTransfer-Encoding: chunked",
            "GET http://example.com/ HTTP/1.1\r\nExpect: 100-continue",
            "GET http://example.com/ HTTP/1.1\r\nBad Header: value",
            "GET http://example.com/ HTTP/1.1\r\nX-Test: ok\u{007f}bad",
            "GET http://example.com/ HTTP/1.1\r\nContent-Length: 1048577",
            "GET http://example.com/ HTTP/1.1 EXTRA",
            "GE\u{0001}T http://example.com/ HTTP/1.1",
        ] {
            assert!(
                parse_request_head(malformed).is_err(),
                "accepted {malformed:?}"
            );
        }
        assert_eq!(
            parse_request_head("POST http://example.com/ HTTP/1.1").unwrap_err(),
            405
        );
    }

    #[test]
    fn proxy_targets_reject_credentials_schemes_and_bodies() {
        let valid = parse_proxy_target(
            "GET".into(),
            "http://example.com/a?q=1".into(),
            Vec::new(),
            0,
            &[],
        )
        .unwrap();
        match valid {
            ProxyTarget::Http { url, .. } => assert_eq!(request_target(&url), "/a?q=1"),
            ProxyTarget::Connect { .. } => panic!("expected HTTP request"),
        }

        for target in [
            "file:///etc/passwd",
            "http://user:secret@example.com/",
            "http://@example.com/",
        ] {
            assert!(parse_proxy_target("GET".into(), target.into(), Vec::new(), 0, &[]).is_err());
        }
        assert!(parse_proxy_target(
            "GET".into(),
            "http://example.com/".into(),
            Vec::new(),
            1,
            b"x",
        )
        .is_err());
        assert!(parse_proxy_target(
            "CONNECT".into(),
            "@example.com:443".into(),
            Vec::new(),
            0,
            &[],
        )
        .is_err());
    }

    #[test]
    fn only_common_web_ports_are_allowed_for_plain_http() {
        assert!(is_allowed_plain_http_port(80));
        assert!(is_allowed_plain_http_port(8080));
        for denied in [22, 443, 2375, 3000, 8443] {
            assert!(
                !is_allowed_plain_http_port(denied),
                "port {denied} must be denied"
            );
        }
    }

    #[test]
    fn request_header_terminator_is_detected_without_accepting_partial_headers() {
        assert_eq!(
            find_header_end(b"GET http://example.com/ HTTP/1.1\r\n"),
            None
        );
        assert!(find_header_end(b"GET http://example.com/ HTTP/1.1\r\n\r\n").is_some());
    }
}
