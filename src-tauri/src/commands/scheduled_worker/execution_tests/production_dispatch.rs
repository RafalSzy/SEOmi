use super::super::execute_task;
use super::{fixture, read_task, store, task};

#[tokio::test]
async fn actual_page_audit_dispatch_rejects_private_url_without_network() {
    let app = fixture();
    let mut manifest = task("page-audit");
    manifest.url = "http://127.0.0.1/private".into();
    let error = execute_task(&app.handle(), "project-1", &manifest)
        .await
        .unwrap_err();
    assert!(error.starts_with("URL validation failed:"));
}

#[tokio::test]
async fn actual_crawl_dispatch_rejects_private_url_without_network() {
    let app = fixture();
    let mut manifest = task("site-crawl");
    manifest.url = "http://127.0.0.1/private".into();
    let error = execute_task(&app.handle(), "project-1", &manifest)
        .await
        .unwrap_err();
    assert_eq!(
        error,
        "Access to local/private IP addresses is blocked for security (SSRF prevention)"
    );
}

#[tokio::test]
async fn actual_dispatch_rejects_browser_mode_and_unknown_tasks() {
    let app = fixture();
    let mut manifest = task("site-crawl");
    manifest.crawl_config =
        Some(serde_json::from_value(serde_json::json!({"crawlMode":"browser-rendered"})).unwrap());
    let error = execute_task(&app.handle(), "project-1", &manifest)
        .await
        .unwrap_err();
    assert!(error.contains("interactive desktop WebView"));
    manifest.task_type = "unsupported".into();
    assert_eq!(
        execute_task(&app.handle(), "project-1", &manifest)
            .await
            .unwrap_err(),
        "Unsupported scheduled task type."
    );
}

#[tokio::test]
async fn actual_worker_keeps_future_manifest_unchanged_and_creates_no_handoff() {
    let app = fixture();
    let mut manifest = task("page-audit");
    manifest.next_run_at = "2999-09-25T01:00:00Z".into();
    store(&app, &manifest);
    super::super::run_scheduled_task(app.handle(), "project-1".into(), "schedule-1".into())
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(read_task(&app, "schedule-1")).unwrap(),
        serde_json::to_value(manifest).unwrap()
    );
    let handoff =
        super::super::super::storage::execution_path(&app.handle(), "project-1", "schedule-1")
            .unwrap();
    assert!(!handoff.exists());
}

#[tokio::test]
async fn actual_worker_rejects_unsafe_identity_before_storage_or_scheduler() {
    let app = fixture();
    let error =
        super::super::run_scheduled_task(app.handle(), "../outside".into(), "schedule-1".into())
            .await
            .unwrap_err();
    assert!(error.contains("Invalid project"), "{error}");
}
