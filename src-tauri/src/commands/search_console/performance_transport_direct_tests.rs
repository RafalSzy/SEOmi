use super::{
    models::GscPerformanceFilters,
    performance_transport::{dimensions, rows},
    rows_test_fixture::{client, fixture},
};
use serde_json::json;

#[tokio::test]
async fn rows_transport_uses_requested_dimension_and_bearer_token() {
    let (endpoint, server) = fixture(vec![(200, json!({"rows":[{"keys":["query"]}]}))]).await;
    let result = rows(
        &client(),
        "synthetic-token",
        Some(&endpoint),
        "https://fixture.test",
        "2026-01-01",
        "2026-01-02",
        Some("query"),
        &GscPerformanceFilters::default(),
    )
    .await
    .unwrap();
    assert_eq!(result.rows, vec![json!({"keys":["query"]})]);
    assert!(!result.may_be_truncated);
    let requests = server.await.unwrap();
    assert_eq!(requests[0]["dimensions"], json!(["query"]));
}

#[tokio::test]
async fn dimensions_transport_preserves_multiple_dimensions_and_provider_errors() {
    let (endpoint, server) = fixture(vec![(403, json!({"error":{"message":"private"}}))]).await;
    let error = dimensions(
        &client(),
        "synthetic-token",
        Some(&endpoint),
        "https://fixture.test",
        "2026-01-01",
        "2026-01-02",
        &["query", "page"],
        &GscPerformanceFilters::default(),
    )
    .await
    .err()
    .expect("provider failure must be returned");
    assert!(error.contains("403"));
    assert!(!error.contains("private"));
    let requests = server.await.unwrap();
    assert_eq!(requests[0]["dimensions"], json!(["query", "page"]));
}
