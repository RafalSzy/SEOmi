use super::*;

#[test]
fn fragment_html_reports_accessibility_metadata_with_fallback_source_evidence() {
    let markup = "<body>fragment content</body>";
    let document = Html::parse_document(markup);
    let base = url::Url::parse("https://example.test/page").unwrap();
    let (findings, truncated) = validate_crawl_html_with_charset(&document, markup, &base, None);

    assert!(!truncated);
    for code in ["html-lang-missing", "html-meta-charset-missing"] {
        let finding = findings
            .iter()
            .find(|item| item.code == code)
            .expect("accessibility metadata finding");
        assert_eq!(finding.line, Some(1));
        assert!(finding
            .source_excerpt
            .as_deref()
            .unwrap()
            .contains("<body>"));
    }
}

#[test]
fn html_attribute_findings_remain_valid_without_matching_source_text() {
    let markup = r#"<div id="same"></div><div id="same"></div><a href="/bad%ZZ">bad</a>"#;
    let document = Html::parse_document(markup);
    let mut findings = Vec::new();
    let mut truncated = false;
    validate_element_attributes(
        &document,
        "different source",
        "different source",
        &url::Url::parse("https://example.test/page").unwrap(),
        &mut findings,
        &mut truncated,
    );

    assert!(!truncated);
    assert!(findings
        .iter()
        .filter(|item| item.code == "html-duplicate-id" || item.code == "html-uri-invalid")
        .all(|item| item.line.is_none() && item.source_excerpt.is_none()));
}

#[test]
fn html_attribute_validation_stops_after_the_uri_safety_budget() {
    let markup = (0..20_001)
        .map(|index| format!("<a href=\"/asset-{index}\">x</a>"))
        .collect::<String>();
    let document = Html::parse_document(&markup);
    let mut findings = Vec::new();
    let mut truncated = false;
    validate_element_attributes(
        &document,
        &markup,
        &markup.to_ascii_lowercase(),
        &url::Url::parse("https://example.test/page").unwrap(),
        &mut findings,
        &mut truncated,
    );

    assert!(truncated);
    assert!(findings.is_empty());
}
