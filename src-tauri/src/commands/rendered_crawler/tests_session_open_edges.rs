use super::{
    models::RenderOptions,
    preview::{normalize_preview_value, open_rendered_element_preview},
    session::RenderedCrawlerSession,
};
use crate::utils::test_app::StorageApp;
use tauri::test::mock_builder;

#[tokio::test]
async fn session_open_with_user_agent_cookie_and_options() {
    let app = StorageApp::new(mock_builder());
    let options = RenderOptions {
        user_agent: Some("CustomAgent/1.0".into()),
        cookie: Some("auth=xyz".into()),
        allowed_hosts: vec!["cdn.example.test".into()],
        ..Default::default()
    };
    let session = RenderedCrawlerSession::open(
        &app.handle(),
        "https://example.test/",
        "example.test",
        true,
        Some("/docs"),
        options,
    )
    .await
    .unwrap();
    assert!(session.allow_subdomains);
    assert_eq!(session.scope_path.as_deref(), Some("/docs"));
    assert_eq!(session.allowed_hosts, vec!["cdn.example.test"]);
    session.close();
}

#[tokio::test]
async fn session_open_and_preview_validation_edges() {
    let app = StorageApp::new(mock_builder());
    let res = RenderedCrawlerSession::open(
        &app.handle(),
        "://broken",
        "example.test",
        false,
        None,
        Default::default(),
    )
    .await;
    assert!(res.is_err());

    assert_eq!(
        normalize_preview_value("", "field", 10).unwrap_err(),
        "field cannot be empty."
    );
    assert_eq!(
        normalize_preview_value("toolong", "field", 3).unwrap_err(),
        "field exceeds the 3-character safety limit."
    );
    assert_eq!(
        normalize_preview_value("a\0b", "field", 10).unwrap_err(),
        "field contains an invalid null character."
    );

    let preview = open_rendered_element_preview(
        app.handle(),
        "https://example.test/".into(),
        "div.main".into(),
        Some("target".into()),
        Some(0),
        "Preview Window".into(),
        "Not Found".into(),
    )
    .await;
    assert!(preview.is_ok());
}
