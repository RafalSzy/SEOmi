use super::check_link;

#[tokio::test]
async fn link_status_rejects_local_and_credential_urls_before_network() {
    for url in [
        "http://127.0.0.1/private",
        "https://user:password@example.com/secret",
        "file:///tmp/report.html",
    ] {
        let error = check_link(url.into(), Some(999)).await.unwrap_err();
        assert!(error.starts_with("Invalid link URL:"), "{error}");
    }
}
