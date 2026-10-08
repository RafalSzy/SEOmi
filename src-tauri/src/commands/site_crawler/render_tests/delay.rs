use super::*;
use crate::commands::site_crawler::control::CrawlControl;
use crate::commands::site_crawler::models::CrawlConfig;
use crate::commands::site_crawler::render_fetch::{fetch_rendered_page, RenderRequestScope};
use std::time::{Duration, Instant};

#[tokio::test]
async fn rendered_transport_waits_between_http_and_browser_requests() {
    let origin = super::fetch::origin(vec![(
        "/page",
        200,
        "Content-Type: text/html\r\n",
        "<p>rendered</p>",
    )])
    .await;
    let mut renderer = FakeRenderer::returning(vec![Ok(snapshot(
        &format!("{}/page", origin.base),
        "<p>rendered</p>",
    ))]);
    let config: CrawlConfig = serde_json::from_value(serde_json::json!({})).unwrap();
    let control = CrawlControl::new();
    let started = Instant::now();
    let delay = Duration::from_millis(30);
    let url = format!("{}/page", origin.base);
    let fetched = fetch_rendered_page(
        &origin.client,
        &url,
        RenderRequestScope::new("example.test", 5),
        &config,
        true,
        &mut renderer,
        Some((&control, "fixture-run", started, delay)),
    )
    .await
    .unwrap();
    assert!(started.elapsed() >= delay);
    assert_eq!(fetched.final_url, url);
    assert_eq!(renderer.rendered_urls.len(), 1);
}
