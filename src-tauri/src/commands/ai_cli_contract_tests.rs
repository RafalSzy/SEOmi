use super::detect_ai_clis_with;
use std::collections::HashMap;

#[tokio::test]
async fn detection_maps_each_provider_and_preserves_checker_results() {
    let mut calls = Vec::new();
    let results = detect_ai_clis_with(|provider, command| {
        calls.push((provider.to_string(), command.to_string()));
        let available = provider != "claude";
        let detail = format!("{provider}:{command}");
        async move { (available, detail) }
    })
    .await;

    assert_eq!(
        calls,
        vec![
            ("openai".into(), "codex".into()),
            ("claude".into(), "claude".into()),
            ("gemini".into(), "gemini".into()),
        ]
    );
    assert_eq!(results.len(), 3);
    let by_provider: HashMap<_, _> = results
        .into_iter()
        .map(|status| (status.provider.clone(), status))
        .collect();
    assert_eq!(by_provider["openai"].command, "codex");
    assert!(by_provider["openai"].available);
    assert_eq!(by_provider["openai"].detail, "openai:codex");
    assert_eq!(by_provider["claude"].command, "claude");
    assert!(!by_provider["claude"].available);
    assert_eq!(by_provider["claude"].detail, "claude:claude");
    assert!(by_provider["gemini"].available);
    assert_eq!(by_provider["gemini"].detail, "gemini:gemini");
}

#[tokio::test]
async fn detection_reports_all_failures_without_rewriting_diagnostics() {
    let diagnostics = [
        "",
        "Not logged in.\nSign in first.",
        "Błąd CLI: brak dostępu",
    ];
    let mut remaining = diagnostics.into_iter();
    let results = detect_ai_clis_with(|_, _| {
        let detail = remaining.next().unwrap().to_string();
        std::future::ready((false, detail))
    })
    .await;

    assert_eq!(results.len(), diagnostics.len());
    for (status, expected) in results.iter().zip(diagnostics) {
        assert!(!status.available);
        assert_eq!(status.detail, expected);
    }
    assert_eq!(remaining.next(), None);
}
