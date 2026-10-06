use super::*;
use crate::commands::site_crawler::fetch_types::{CrawlFetchFailure, FetchedResponse};
use crate::commands::site_crawler::models::CrawlConfig;
use crate::commands::site_crawler::render_fetch::fetch_rendered_page;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

/// Local origin answering each route with a fixed status, headers and body.
async fn origin(routes: Vec<(&'static str, u16, &'static str, &'static str)>) -> Origin {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let client = reqwest::Client::builder()
        .no_proxy()
        .resolve("example.test", address)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .unwrap();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let mut request = [0; 2048];
            let count = socket.read(&mut request).await.unwrap();
            let text = String::from_utf8_lossy(&request[..count]).into_owned();
            let path = text.split_whitespace().nth(1).unwrap_or_default();
            let (_, status, headers, body) = routes.iter().find(|route| route.0 == path).unwrap();
            let response = format!(
                "HTTP/1.1 {status} Fixture\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(response.as_bytes()).await;
        }
    });
    Origin {
        client,
        base: format!("http://example.test:{}", address.port()),
    }
}

struct Origin {
    client: reqwest::Client,
    base: String,
}

impl Origin {
    async fn fetch(
        &self,
        path: &str,
        renderer: &mut FakeRenderer,
    ) -> Result<FetchedResponse, CrawlFetchFailure> {
        let config: CrawlConfig = serde_json::from_value(serde_json::json!({})).unwrap();
        let (url, host) = (format!("{}{path}", self.base), "example.test");
        fetch_rendered_page(&self.client, &url, host, 5, &config, true, renderer).await
    }
}

async fn page(fetched: FetchedResponse) -> FetchedPageData {
    read_fetched_page_data(fetched.response, 5_000_000).await
}

#[tokio::test]
async fn http_supplies_hops_status_and_headers_while_the_browser_supplies_the_dom() {
    let origin = origin(vec![
        ("/start", 301, "Location: /app\r\n", ""),
        (
            "/app",
            200,
            "Content-Type: text/html; charset=utf-8\r\nX-Robots-Tag: noindex\r\n",
            "<div id=\"root\"></div>",
        ),
    ])
    .await;
    let browser_url = format!("{}/app#/home", origin.base);
    let mut renderer =
        FakeRenderer::returning(vec![Ok(snapshot(&browser_url, "<h1>Rendered</h1>"))]);

    let fetched = origin.fetch("/start", &mut renderer).await.ok().unwrap();

    // The browser is sent to the URL the HTTP redirects ended at.
    assert_eq!(renderer.rendered_urls, vec![format!("{}/app", origin.base)]);
    assert_eq!(fetched.final_url, browser_url);
    assert_eq!(fetched.redirect_chain.len(), 1);
    assert_eq!(fetched.redirect_chain[0].http_status, 301);
    let data = page(fetched).await;
    assert_eq!(data.status, 200);
    assert_eq!(data.body, b"<h1>Rendered</h1>");
    assert_eq!(data.x_robots_tag.as_deref(), Some("noindex"));
    assert_eq!(
        data.content_type.as_deref(),
        Some("text/html; charset=utf-8")
    );
    assert!(data.response_headers_available && data.rendered_diagnostics.is_some());
}

#[tokio::test]
async fn downloads_and_error_pages_never_reach_a_renderer_window() {
    let origin = origin(vec![
        ("/gone", 404, "Content-Type: text/html\r\n", "<h1>Gone</h1>"),
        ("/file.zip", 200, "Content-Type: application/zip\r\n", "PK"),
    ])
    .await;
    let mut renderer = FakeRenderer::returning(Vec::new());
    for (path, status, body) in [("/gone", 404, "<h1>Gone</h1>"), ("/file.zip", 200, "PK")] {
        let fetched = origin.fetch(path, &mut renderer).await.ok().unwrap();
        assert_eq!(fetched.final_url, format!("{}{path}", origin.base));
        let data = page(fetched).await;
        assert_eq!((data.status, &data.body[..]), (status, body.as_bytes()));
        assert!(data.render_fallback.is_none() && data.rendered_diagnostics.is_none());
    }
    assert!(renderer.rendered_urls.is_empty());
}

#[tokio::test]
async fn failed_render_keeps_the_http_page_and_a_failed_request_fails_the_page() {
    let origin = origin(vec![(
        "/slow",
        200,
        "Content-Type: text/html\r\n",
        "<p>raw</p>",
    )])
    .await;
    let mut renderer = FakeRenderer::returning(vec![Err("capture timed out".into())]);
    let fetched = origin.fetch("/slow", &mut renderer).await.ok().unwrap();
    let data = page(fetched).await;
    assert_eq!(data.body, b"<p>raw</p>");
    assert_eq!(data.render_fallback.as_deref(), Some("capture timed out"));

    let unreachable = Origin {
        client: reqwest::Client::builder().no_proxy().build().unwrap(),
        base: "ftp://example.test".into(),
    };
    let failure = unreachable.fetch("/file", &mut renderer).await;
    let failure = failure.err().unwrap();
    assert!(!failure.kind.is_empty() && !failure.message.is_empty());
    assert_eq!(renderer.rendered_urls.len(), 1);
}
