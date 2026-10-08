use super::{query_crux_record, query_crux_request, run_pagespeed_insights, run_pagespeed_request};

#[tokio::test]
async fn performance_commands_reject_invalid_project_before_secret_or_network() {
    let error = run_pagespeed_insights(
        "project/escape".into(),
        "https://example.com/".into(),
        "mobile".into(),
    )
    .await
    .unwrap_err();
    assert_eq!(
        error,
        "Invalid project identifier for Google performance request."
    );

    let error = query_crux_record(
        "project/escape".into(),
        "https://example.com/".into(),
        "PHONE".into(),
        false,
    )
    .await
    .unwrap_err();
    assert_eq!(
        error,
        "Invalid project identifier for Google performance request."
    );
}

#[tokio::test]
async fn provider_status_errors_are_redacted_for_pagespeed_and_crux() {
    let (endpoint, request) = super::local_reply(
        "403 Forbidden",
        r#"{"error":{"message":"fixture-provider-secret"}}"#,
    )
    .await;
    let error = run_pagespeed_request(
        "https://example.com/",
        "mobile",
        &endpoint,
        "fixture-key",
        &super::client(),
    )
    .await
    .unwrap_err();
    assert!(error.contains("403"));
    assert!(!error.contains("fixture-provider-secret"));
    assert!(
        request.await.is_ok(),
        "PageSpeed request should reach the provider fixture before redaction"
    );

    let (endpoint, request) = super::local_reply(
        "403 Forbidden",
        r#"{"error":{"message":"fixture-provider-secret"}}"#,
    )
    .await;
    let error = query_crux_request(
        "https://example.com/",
        "PHONE",
        false,
        &endpoint,
        "fixture-key",
        &super::client(),
    )
    .await
    .unwrap_err();
    assert!(error.contains("403"));
    assert!(!error.contains("fixture-provider-secret"));
    assert!(
        request.await.is_ok(),
        "CrUX request should reach the provider fixture before redaction"
    );
}
