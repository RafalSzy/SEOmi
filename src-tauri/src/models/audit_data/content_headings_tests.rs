use super::*;

#[test]
fn omitted_readability_method_defaults_to_unavailable() {
    let value = serde_json::json!({
        "word_count": 12,
        "reading_time_minutes": 1,
        "text_ratio_percent": 42.5,
        "top_keywords": []
    });
    let stats: ContentStats = serde_json::from_value(value).unwrap();

    assert_eq!(stats.readability_method, "unavailable");
}
