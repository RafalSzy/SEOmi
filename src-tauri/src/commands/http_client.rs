use crate::services::http_client::check_url_status;
use crate::utils::url_validator::validate_and_normalize_url;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct LinkStatusResult {
    pub url: String,
    pub status: u16,
    pub response_time_ms: u64,
    pub is_broken: bool,
}

#[tauri::command]
pub async fn check_link(
    url: String,
    timeout_secs: Option<u64>,
) -> Result<LinkStatusResult, String> {
    let validated =
        validate_and_normalize_url(&url).map_err(|e| format!("Invalid link URL: {}", e))?;

    let timeout = timeout_secs.unwrap_or(5).clamp(1, 15);
    match check_url_status(validated.as_str(), timeout).await {
        Ok((status, time_ms)) => Ok(LinkStatusResult {
            url,
            status,
            response_time_ms: time_ms,
            is_broken: status >= 400,
        }),
        Err(_e) => Ok(LinkStatusResult {
            url,
            status: 0,
            response_time_ms: 0,
            is_broken: true,
        }),
    }
}

#[cfg(test)]
#[path = "http_client_tests.rs"]
mod tests;
