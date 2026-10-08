use super::*;

fn redirects(markup: &str) -> Vec<CrawledClientRedirect> {
    let document = Html::parse_document(markup);
    extract_javascript_redirects(
        &document,
        &url::Url::parse("https://example.test/section/page").unwrap(),
    )
}

#[test]
fn javascript_redirects_cover_all_supported_location_owners_and_event_attributes() {
    let result = redirects(
        r#"
        <script>
          location = " /plain "; window.location.href='//cdn.example.test/a';
          parent.location.replace('/replace'); globalThis.location.assign('/assign');
          self.location='/self'; top.location.href='/top'; document.location='/document';
        </script>
        <button onload="location.href='/load'" onbeforeunload="location='/before'"
          onunload="location='/unload'" onpageshow="location='/show'" onpopstate="location='/pop'">Go</button>
    "#,
    );
    assert_eq!(result.len(), 12);
    assert_eq!(
        result
            .iter()
            .filter(|item| item.source == "javascript")
            .count(),
        7
    );
    assert_eq!(
        result
            .iter()
            .filter(|item| item.source == "javascript-inline")
            .count(),
        5
    );
    assert!(result
        .iter()
        .any(|item| item.target_url.as_deref() == Some("https://example.test/plain")));
    assert!(result
        .iter()
        .any(|item| item.target_url.as_deref() == Some("https://cdn.example.test/a")));
}

#[test]
fn javascript_redirects_skip_dynamic_templates_unsupported_script_types_and_bad_targets() {
    let result = redirects(
        r#"
        <script type="text/plain">location='/ignored-plain'</script>
        <script type="application/json">location='/ignored-json'</script>
        <script type="application/ecmascript">location='/ecma'</script>
        <script>location = `/${dynamic}`; location.href='https://['; location.replace('data:text/plain,x');</script>
        <script src="/external.js">location='/ignored-src'</script>
        <div onmouseover="location='/ignored-event'" onclick="location.href='https://example.test/click'"></div>
    "#,
    );
    assert_eq!(result.len(), 4);
    assert!(result
        .iter()
        .any(|item| item.target_url.as_deref() == Some("https://example.test/ecma")));
    assert!(result.iter().any(|item| item.target_url.is_none()));
    assert!(result.iter().any(|item| item.source == "javascript-inline"));
    assert!(result
        .iter()
        .all(|item| !item.declaration.contains("ignored")));
}
