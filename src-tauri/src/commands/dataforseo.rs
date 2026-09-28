use serde_json::Value;

use crate::commands::settings::dataforseo_credentials;

const API_BASE: &str = "https://api.dataforseo.com";

fn allowed_path(path: &str) -> bool {
    matches!(
        path,
        "/v3/appendix/user_data"
            | "/v3/backlinks/summary/live"
            | "/v3/backlinks/anchors/live"
            | "/v3/backlinks/backlinks/live"
            | "/v3/backlinks/domain_intersection/live"
            | "/v3/serp/google/organic/live/regular"
            | "/v3/keywords_data/google_ads/search_volume/live"
            | "/v3/keywords_data/google_ads/keywords_for_keywords/live"
            | "/v3/dataforseo_labs/google/domain_rank_overview/live"
            | "/v3/dataforseo_labs/google/ranked_keywords/live"
            | "/v3/dataforseo_labs/google/relevant_pages/live"
            | "/v3/dataforseo_labs/google/competitors_domain/live"
    )
}

#[tauri::command]
pub async fn dataforseo_request(
    project_id: String,
    path: String,
    payload: Option<Value>,
) -> Result<Value, String> {
    if !allowed_path(&path) {
        return Err("Unsupported DataForSEO endpoint.".into());
    }
    let (login, password) = dataforseo_credentials(&project_id)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Unable to create DataForSEO client: {error}"))?;
    let request = client
        .request(
            if path == "/v3/appendix/user_data" {
                reqwest::Method::GET
            } else {
                reqwest::Method::POST
            },
            format!("{API_BASE}{path}"),
        )
        .basic_auth(login, Some(password));
    let response = match payload {
        Some(payload) if path != "/v3/appendix/user_data" => request.json(&payload).send().await,
        _ => request.send().await,
    }
    .map_err(|error| format!("DataForSEO request failed: {error}"))?;
    let status = response.status();
    let body = response
        .json::<Value>()
        .await
        .map_err(|error| format!("DataForSEO returned an invalid JSON response: {error}"))?;
    if !status.is_success() {
        let message = body
            .get("status_message")
            .and_then(Value::as_str)
            .unwrap_or("unknown error");
        return Err(format!("DataForSEO HTTP {status}: {message}"));
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::allowed_path;

    #[test]
    fn only_explicit_dataforseo_endpoints_are_allowed() {
        assert!(allowed_path("/v3/serp/google/organic/live/regular"));
        assert!(allowed_path(
            "/v3/keywords_data/google_ads/keywords_for_keywords/live"
        ));
        assert!(allowed_path(
            "/v3/dataforseo_labs/google/relevant_pages/live"
        ));
        assert!(allowed_path("/v3/backlinks/domain_intersection/live"));
        assert!(!allowed_path("/v3/users/billing"));
        assert!(!allowed_path("https://attacker.invalid"));
    }
}
