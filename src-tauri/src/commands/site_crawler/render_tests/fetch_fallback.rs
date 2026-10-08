use super::*;

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
