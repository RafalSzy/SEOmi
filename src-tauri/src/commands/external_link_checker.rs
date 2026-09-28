use crate::utils::url_validator::{is_public_ip, validate_and_normalize_url};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, LOCATION, RANGE, USER_AGENT};
use serde::Serialize;
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::task::JoinSet;
use url::Url;

const MAX_EXTERNAL_LINKS_PER_RUN: usize = 1_000;
const DEFAULT_EXTERNAL_LINK_LIMIT: usize = 250;
const MAX_CONCURRENT_EXTERNAL_LINKS: usize = 4;
const DNS_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLinkCheck {
    pub url: String,
    pub http_status: Option<u16>,
    pub response_time_ms: Option<u64>,
    pub redirect_url: Option<String>,
    pub request_error_kind: Option<String>,
    pub checked_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLinkCheckBatch {
    pub requested: usize,
    pub checked: usize,
    pub omitted: usize,
    pub results: Vec<ExternalLinkCheck>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLinkCheckProgress {
    pub request_id: String,
    pub completed: usize,
    pub total: usize,
    pub current_url: String,
    pub http_status: Option<u16>,
    pub request_error_kind: Option<String>,
}

fn error_kind(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        return "timeout".into();
    }
    if error.is_connect() {
        let message = error.to_string().to_ascii_lowercase();
        if message.contains("dns") || message.contains("resolve") || message.contains("lookup") {
            return "dns".into();
        }
        if message.contains("tls")
            || message.contains("certificate")
            || message.contains("handshake")
        {
            return "tls".into();
        }
        return "connect".into();
    }
    "network".into()
}

fn rejected(url: String, kind: impl Into<String>) -> ExternalLinkCheck {
    ExternalLinkCheck {
        url,
        http_status: None,
        response_time_ms: None,
        redirect_url: None,
        request_error_kind: Some(kind.into()),
        checked_at: chrono::Utc::now().to_rfc3339(),
    }
}

fn normalize_external_url(input: &str) -> Result<Url, String> {
    let url = validate_and_normalize_url(input).map_err(|error| error.to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URLs containing embedded credentials are not allowed".into());
    }
    let mut url = url;
    url.set_fragment(None);
    Ok(url)
}

async fn checked_public_addresses(url: &Url) -> Result<Vec<SocketAddr>, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "URL has no host".to_string())?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "URL has no HTTP port".to_string())?;
    let lookup = tokio::time::timeout(DNS_TIMEOUT, tokio::net::lookup_host((host, port)))
        .await
        .map_err(|_| "DNS lookup timed out".to_string())?
        .map_err(|error| format!("DNS lookup failed: {error}"))?;
    let addresses = lookup.collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err("DNS returned no addresses".into());
    }
    if addresses.iter().any(|address| !is_public_ip(&address.ip())) {
        return Err("DNS resolved to a private or reserved address; request blocked".into());
    }
    Ok(addresses)
}

fn client_for_url(url: &Url, addresses: &[SocketAddr]) -> Result<reqwest::Client, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "URL has no host".to_string())?;
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("SEOmi-LinkChecker/1.0 (+desktop SEO audit)"),
    );
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
    reqwest::Client::builder()
        .default_headers(headers)
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .resolve_to_addrs(host, addresses)
        .build()
        .map_err(|error| error.to_string())
}

async fn check_one(input: String) -> ExternalLinkCheck {
    let url = match normalize_external_url(&input) {
        Ok(url) => url,
        Err(error) => {
            let kind = if error.contains("local/private") || error.contains("local network") {
                "blocked"
            } else {
                "invalid"
            };
            return rejected(input, kind);
        }
    };
    let normalized = url.to_string();
    let addresses = match checked_public_addresses(&url).await {
        Ok(addresses) => addresses,
        Err(error) if error.starts_with("DNS lookup failed") => return rejected(normalized, "dns"),
        Err(error) if error.contains("timed out") => return rejected(normalized, "timeout"),
        Err(_) => return rejected(normalized, "blocked"),
    };
    let client = match client_for_url(&url, &addresses) {
        Ok(client) => client,
        Err(_) => return rejected(normalized, "network"),
    };

    let started = Instant::now();
    let response = match client.head(url.clone()).send().await {
        Ok(response) if response.status().as_u16() == 405 || response.status().as_u16() == 501 => {
            let request = client.get(url.clone()).header(RANGE, "bytes=0-0");
            // The body is never read; dropping the bounded range response closes the stream.
            match request.send().await {
                Ok(response) => response,
                Err(error) => return rejected(normalized, error_kind(&error)),
            }
        }
        Ok(response) => response,
        Err(error) => return rejected(normalized, error_kind(&error)),
    };
    let elapsed = started.elapsed().as_millis() as u64;
    let status = response.status().as_u16();
    let redirect_url = response
        .headers()
        .get(LOCATION)
        .and_then(|location| location.to_str().ok())
        .and_then(|location| url.join(location).ok())
        .map(|target| target.to_string());
    ExternalLinkCheck {
        url: normalized,
        http_status: Some(status),
        response_time_ms: Some(elapsed),
        redirect_url,
        request_error_kind: None,
        checked_at: chrono::Utc::now().to_rfc3339(),
    }
}

#[tauri::command]
pub async fn check_external_crawl_links(
    app: AppHandle,
    request_id: String,
    urls: Vec<String>,
    max_urls: Option<usize>,
) -> Result<ExternalLinkCheckBatch, String> {
    if urls.len() > 20_000 {
        return Err("Too many external link targets were supplied (maximum input: 20,000)".into());
    }
    let limit = max_urls
        .unwrap_or(DEFAULT_EXTERNAL_LINK_LIMIT)
        .clamp(1, MAX_EXTERNAL_LINKS_PER_RUN);
    let mut unique = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for input in urls {
        match normalize_external_url(&input) {
            Ok(url) => {
                let normalized = url.to_string();
                if seen.insert(normalized.clone()) {
                    unique.push(normalized);
                }
            }
            Err(_) => {
                let normalized = input.trim().to_string();
                if !normalized.is_empty() && seen.insert(normalized.clone()) {
                    unique.push(normalized);
                }
            }
        }
    }
    let unique_count = unique.len();
    let selected = unique
        .into_iter()
        .take(limit.min(MAX_EXTERNAL_LINKS_PER_RUN))
        .collect::<Vec<_>>();
    let scheduled = selected.len();
    let mut tasks: JoinSet<ExternalLinkCheck> = JoinSet::new();
    let mut pending = selected.into_iter();
    let mut results = Vec::with_capacity(scheduled);
    for _ in 0..MAX_CONCURRENT_EXTERNAL_LINKS.min(scheduled) {
        if let Some(url) = pending.next() {
            tasks.spawn(check_one(url));
        }
    }
    while let Some(joined) = tasks.join_next().await {
        match joined {
            Ok(result) => {
                results.push(result);
                if let Some(current) = results.last() {
                    let _ = app.emit(
                        "crawl-external-link-progress",
                        ExternalLinkCheckProgress {
                            request_id: request_id.clone(),
                            completed: results.len(),
                            total: scheduled,
                            current_url: current.url.clone(),
                            http_status: current.http_status,
                            request_error_kind: current.request_error_kind.clone(),
                        },
                    );
                }
            }
            Err(_) => return Err("An external link check task failed unexpectedly".into()),
        }
        if let Some(url) = pending.next() {
            tasks.spawn(check_one(url));
        }
    }
    results.sort_by(|left, right| left.url.cmp(&right.url));
    Ok(ExternalLinkCheckBatch {
        requested: unique_count,
        checked: results.len(),
        omitted: unique_count.saturating_sub(results.len()),
        results,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_embedded_credentials_and_non_http_schemes() {
        assert!(normalize_external_url("https://user:pass@example.com/").is_err());
        assert!(normalize_external_url("file:///etc/passwd").is_err());
        assert!(normalize_external_url("http://127.0.0.1/").is_err());
    }

    #[test]
    fn normalizes_and_removes_fragments_before_deduplication() {
        let first = normalize_external_url("https://example.com/page#first").unwrap();
        let second = normalize_external_url("https://example.com/page#second").unwrap();
        assert_eq!(first, second);
        assert_eq!(first.as_str(), "https://example.com/page");
    }

    #[tokio::test]
    async fn resolves_all_public_addresses_and_blocks_localhost() {
        let local = Url::parse("http://127.0.0.1/").unwrap();
        assert!(checked_public_addresses(&local).await.is_err());
    }
}
