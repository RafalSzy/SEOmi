use super::{query_crux_record, run_pagespeed_insights};

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
