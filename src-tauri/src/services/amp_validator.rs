use crate::models::audit_data::{AmpAudit, AmpFinding};
use scraper::{Html, Selector};
use url::Url;

const MAX_AMPHTML_TARGETS: usize = 32;
const MAX_FINDINGS: usize = 100;
const AMP_CUSTOM_CSS_LIMIT_BYTES: usize = 75_000;
const MAX_COMPONENTS: usize = 64;

/// Runs a bounded, deterministic subset of AMP HTML checks on the document already fetched.
/// It deliberately does not fetch alternate URLs or claim official validator parity.
pub fn audit_amp(html: &str, page_url: &str) -> AmpAudit {
    let document = Html::parse_document(html);
    let root = Selector::parse("html").expect("static html selector is valid");
    let head = Selector::parse("head").expect("static head selector is valid");
    let canonical_selector =
        Selector::parse("link[rel~='canonical']").expect("static canonical selector is valid");
    let amphtml_selector =
        Selector::parse("link[rel~='amphtml'][href]").expect("static amphtml selector is valid");
    let charset_selector =
        Selector::parse("meta[charset]").expect("static charset selector is valid");
    let viewport_selector = Selector::parse("meta[name='viewport'][content]")
        .expect("static viewport selector is valid");
    let script_selector = Selector::parse("script").expect("static script selector is valid");
    let runtime_selector =
        Selector::parse("script[src]").expect("static runtime selector is valid");
    let boilerplate_selector = Selector::parse("style[amp-boilerplate]")
        .expect("static AMP boilerplate selector is valid");
    let custom_css_selector =
        Selector::parse("style[amp-custom]").expect("static AMP custom CSS selector is valid");
    let forbidden_element_selector =
        Selector::parse("img,iframe,frame,frameset,object,embed,video,audio")
            .expect("static forbidden AMP element selector is valid");
    let inline_handler_selector = Selector::parse("*[onload],*[onclick],*[onerror],*[onchange],*[onsubmit],*[oninput],*[onfocus],*[onblur],*[onmouseover],*[onkeydown],*[onkeyup],*[onkeypress]")
        .expect("static inline handler selector is valid");
    let all_elements_selector =
        Selector::parse("*").expect("static all-elements selector is valid");

    let root_element = document.select(&root).next();
    let is_amp_document = root_element.is_some_and(|element| {
        element.value().attr("amp").is_some() || element.value().attr("⚡").is_some()
    });

    let parsed_base = Url::parse(page_url).ok();
    let mut amphtml_urls = Vec::new();
    let mut findings = Vec::new();
    for link in document
        .select(&amphtml_selector)
        .take(MAX_AMPHTML_TARGETS + 1)
    {
        let Some(href) = link.value().attr("href").map(str::trim) else {
            continue;
        };
        if href.is_empty() {
            add_finding(
                &mut findings,
                "amphtml-href-empty",
                "warning",
                "A rel=amphtml link has an empty href.".into(),
                "link[rel~=amphtml] has no usable href".into(),
                "Provide one absolute or resolvable HTTP(S) AMP URL.",
            );
            continue;
        }
        let target = parsed_base
            .as_ref()
            .and_then(|base| base.join(href).ok())
            .map(|url| url.to_string())
            .unwrap_or_else(|| href.to_string());
        if amphtml_urls.len() < MAX_AMPHTML_TARGETS {
            amphtml_urls.push(target.clone());
        }
        let valid_http_target = Url::parse(&target).ok().is_some_and(|url| {
            matches!(url.scheme(), "http" | "https") && url.host_str().is_some()
        });
        if !valid_http_target {
            add_finding(
                &mut findings,
                "amphtml-target-invalid",
                "warning",
                "The declared AMP alternate does not resolve to an HTTP(S) URL.".into(),
                target,
                "Use a valid HTTP(S) URL for the AMP alternate.",
            );
        }
    }
    if document.select(&amphtml_selector).count() > MAX_AMPHTML_TARGETS {
        add_finding(
            &mut findings,
            "amphtml-target-limit",
            "info",
            "AMP alternate extraction reached its safety limit.".into(),
            format!("At most {MAX_AMPHTML_TARGETS} rel=amphtml targets are retained."),
            "Review the document manually; additional AMP alternate declarations were not inspected.",
        );
    }
    amphtml_urls.sort();
    amphtml_urls.dedup();
    if amphtml_urls.len() > 1 {
        add_finding(
            &mut findings,
            "amphtml-multiple-targets",
            "warning",
            "The document declares more than one distinct AMP alternate.".into(),
            amphtml_urls.join(" | "),
            "Keep one intended AMP alternate for this canonical page.",
        );
    }

    let canonical_declarations = document
        .select(&canonical_selector)
        .map(|element| element.value().attr("href").map(str::trim))
        .collect::<Vec<_>>();
    let canonical_url = canonical_declarations
        .iter()
        .flatten()
        .copied()
        .find(|href| !href.is_empty())
        .map(|href| {
            parsed_base
                .as_ref()
                .and_then(|base| base.join(href).ok())
                .map(|url| url.to_string())
                .unwrap_or_else(|| href.to_string())
        });

    let detected = is_amp_document || !amphtml_urls.is_empty();
    if is_amp_document {
        if canonical_declarations.is_empty() {
            add_finding(
                &mut findings,
                "amp-canonical-missing",
                "error",
                "AMP document does not declare a canonical URL.".into(),
                "No link[rel~=canonical][href] was found.".into(),
                "Add a canonical link to the preferred non-AMP URL (or to itself only when it is the canonical document).",
            );
        } else {
            let has_empty_canonical = canonical_declarations
                .iter()
                .any(|href| href.map(|value| value.is_empty()).unwrap_or(true));
            if canonical_url.is_none() || has_empty_canonical {
                add_finding(
                    &mut findings,
                    "amp-canonical-href-empty",
                    "error",
                    "AMP document declares a canonical link without a usable href.".into(),
                    "link[rel~=canonical] has no non-empty href.".into(),
                    "Provide one non-empty absolute or resolvable HTTP(S) canonical URL.",
                );
            }
            if canonical_declarations.len() > 1 {
                add_finding(
                    &mut findings,
                    "amp-canonical-multiple",
                    "warning",
                    "AMP document declares more than one canonical link.".into(),
                    format!(
                        "Found {} link[rel~=canonical] declarations.",
                        canonical_declarations.len()
                    ),
                    "Keep one canonical declaration for the AMP document.",
                );
            }
            if let Some(canonical) = canonical_url.as_deref() {
                let valid_http_target = Url::parse(canonical).ok().is_some_and(|url| {
                    matches!(url.scheme(), "http" | "https") && url.host_str().is_some()
                });
                if !valid_http_target {
                    add_finding(
                        &mut findings,
                        "amp-canonical-target-invalid",
                        "error",
                        "AMP canonical does not resolve to an HTTP(S) URL.".into(),
                        canonical.to_string(),
                        "Use a valid absolute or resolvable HTTP(S) canonical URL.",
                    );
                }
            }
        }

        let has_utf8_charset = document.select(&charset_selector).any(|element| {
            element
                .value()
                .attr("charset")
                .is_some_and(|value| value.trim().eq_ignore_ascii_case("utf-8"))
        });
        if !has_utf8_charset {
            add_finding(
                &mut findings,
                "amp-charset-missing",
                "error",
                "AMP document is missing a UTF-8 charset declaration.".into(),
                "No meta[charset=utf-8] was found.".into(),
                "Declare <meta charset=\"utf-8\"> near the start of head; the official validator also checks its byte position.",
            );
        } else if let Some(head) = document.select(&head).next() {
            let head_markup = head.html();
            let charset_position = head_markup.to_ascii_lowercase().find("charset");
            if charset_position.is_some_and(|position| position > 1024) {
                add_finding(
                    &mut findings,
                    "amp-charset-position",
                    "warning",
                    "The UTF-8 charset declaration appears after the first 1024 bytes of head markup.".into(),
                    format!("charset starts at byte {} of serialized head", charset_position.unwrap_or_default()),
                    "Move the charset declaration close to the beginning of head; exact byte validation is not guaranteed by this parser.",
                );
            }
        }

        let has_viewport = document.select(&viewport_selector).any(|element| {
            element
                .value()
                .attr("content")
                .is_some_and(|content| content.to_ascii_lowercase().contains("width=device-width"))
        });
        if !has_viewport {
            add_finding(
                &mut findings,
                "amp-viewport-missing",
                "error",
                "AMP document is missing a viewport declaration with width=device-width.".into(),
                "No matching meta[name=viewport] was found.".into(),
                "Add a viewport meta tag containing width=device-width.",
            );
        }

        let runtime = document.select(&runtime_selector).find(|script| {
            script.value().attr("src").is_some_and(|src| {
                src.trim().trim_end_matches('/') == "https://cdn.ampproject.org/v0.js"
            })
        });
        let has_runtime = runtime.is_some();
        if !has_runtime {
            add_finding(
                &mut findings,
                "amp-runtime-missing",
                "error",
                "AMP runtime script was not found.".into(),
                "Missing script[src=https://cdn.ampproject.org/v0.js].".into(),
                "Include the official AMP runtime script with the async attribute.",
            );
        } else if runtime.is_some_and(|script| script.value().attr("async").is_none()) {
            add_finding(
                &mut findings,
                "amp-runtime-async-missing",
                "error",
                "The AMP runtime script is missing the async attribute.".into(),
                "Found https://cdn.ampproject.org/v0.js without async.".into(),
                "Add the async attribute to the AMP runtime script.",
            );
        }

        if document.select(&boilerplate_selector).next().is_none() {
            add_finding(
                &mut findings,
                "amp-boilerplate-missing",
                "error",
                "AMP boilerplate style was not found.".into(),
                "Missing style[amp-boilerplate].".into(),
                "Include the exact AMP boilerplate required by the official validator.",
            );
        }
        if !has_amp_noscript_boilerplate(html) {
            add_finding(
                &mut findings,
                "amp-noscript-boilerplate-missing",
                "error",
                "AMP noscript boilerplate was not found.".into(),
                "Missing noscript > style[amp-boilerplate].".into(),
                "Include the official noscript AMP boilerplate fallback.",
            );
        }

        let custom_css_styles = document.select(&custom_css_selector).collect::<Vec<_>>();
        if custom_css_styles.len() > 1 {
            add_finding(
                &mut findings,
                "amp-custom-css-multiple",
                "error",
                "The AMP document declares more than one amp-custom style block.".into(),
                format!(
                    "Found {} style[amp-custom] declarations.",
                    custom_css_styles.len()
                ),
                "Combine custom CSS into one style[amp-custom] block.",
            );
        }
        let custom_css_bytes = custom_css_styles
            .iter()
            .map(|style| style.text().collect::<String>().len())
            .sum::<usize>();
        if custom_css_bytes > AMP_CUSTOM_CSS_LIMIT_BYTES {
            add_finding(
                &mut findings,
                "amp-custom-css-over-budget",
                "error",
                "The combined amp-custom CSS exceeds the common 75 KB limit.".into(),
                format!("Measured {custom_css_bytes} UTF-8 bytes; limit {AMP_CUSTOM_CSS_LIMIT_BYTES} bytes."),
                "Reduce amp-custom CSS and confirm the exact limit with the official AMP validator version used by deployment.",
            );
        }

        if custom_css_styles.iter().any(|style| {
            style
                .text()
                .collect::<String>()
                .to_ascii_lowercase()
                .contains("@import")
        }) {
            add_finding(
                &mut findings,
                "amp-custom-css-import",
                "error",
                "The amp-custom CSS contains an @import rule.".into(),
                "style[amp-custom] contains @import".into(),
                "Inline the imported rules in the bounded amp-custom stylesheet.",
            );
        }

        for element in document
            .select(&forbidden_element_selector)
            .take(MAX_COMPONENTS + 1)
        {
            let tag = element.value().name().to_ascii_lowercase();
            add_finding(
                &mut findings,
                "amp-element-not-allowed",
                "error",
                format!("The AMP document uses the HTML element <{tag}>, which requires an AMP component replacement."),
                format!("<{tag}>"),
                match tag.as_str() {
                    "img" => "Use <amp-img> with its required layout and dimensions.",
                    "iframe" => "Use <amp-iframe> and load its extension script.",
                    "video" => "Use <amp-video> with the AMP video component.",
                    "audio" => "Use <amp-audio> with the AMP audio component.",
                    _ => "Replace the element with an AMP-supported component.",
                },
            );
        }
        if document.select(&forbidden_element_selector).count() > MAX_COMPONENTS {
            add_finding(
                &mut findings,
                "amp-component-limit",
                "info",
                "AMP element validation reached its safety limit.".into(),
                format!("At most {MAX_COMPONENTS} forbidden element instances are retained."),
                "Review additional elements manually with the official AMP validator.",
            );
        }

        for element in document
            .select(&inline_handler_selector)
            .take(MAX_COMPONENTS + 1)
        {
            let tag = element.value().name();
            let handler = element
                .value()
                .attrs()
                .find(|(name, _)| name.to_ascii_lowercase().starts_with("on"))
                .map(|(name, _)| name)
                .unwrap_or("on*");
            add_finding(
                &mut findings,
                "amp-inline-event-handler",
                "error",
                "The AMP document contains an inline event-handler attribute.".into(),
                format!("<{tag} {handler}=…>"),
                "Move interaction to an AMP action/event declaration or an allowed AMP component.",
            );
        }

        let mut component_names = Vec::new();
        for element in document.select(&all_elements_selector) {
            let tag = element.value().name();
            if tag.starts_with("amp-") && !component_names.iter().any(|name| name == tag) {
                component_names.push(tag.to_string());
                if component_names.len() >= MAX_COMPONENTS {
                    break;
                }
            }
        }
        for component in component_names {
            let extension_src = format!("https://cdn.ampproject.org/v0/{component}.js");
            let loaded = document.select(&runtime_selector).any(|script| {
                script
                    .value()
                    .attr("src")
                    .is_some_and(|src| src.trim().trim_end_matches('/') == extension_src)
            });
            if !loaded {
                add_finding(
                    &mut findings,
                    "amp-component-script-missing",
                    "warning",
                    format!("The AMP component <{component}> has no recognized extension script."),
                    format!("Expected script[src={extension_src}]"),
                    "Load the matching AMP component extension before using the element.",
                );
            }
        }

        for script in document.select(&script_selector) {
            let value = script.value();
            let src = value.attr("src").map(str::trim).unwrap_or_default();
            let script_type = value
                .attr("type")
                .map(str::trim)
                .unwrap_or_default()
                .to_ascii_lowercase();
            let extension_script =
                src.starts_with("https://cdn.ampproject.org/v0/amp-") && src.ends_with(".js");
            let runtime_script = src.trim_end_matches('/') == "https://cdn.ampproject.org/v0.js";
            let data_script = matches!(
                script_type.as_str(),
                "application/ld+json" | "application/json"
            );
            if !runtime_script && !extension_script && !data_script {
                add_finding(
                    &mut findings,
                    "amp-script-not-allowlisted",
                    "warning",
                    "A script element was found outside the locally recognized AMP runtime/component or data-script patterns.".into(),
                    if src.is_empty() { format!("inline script type={script_type:?}") } else { format!("script src={src}") },
                    "Verify this script against the official AMP validator; ordinary custom JavaScript is not allowed in AMP HTML.",
                );
            }
        }
    }

    AmpAudit {
        detected,
        is_amp_document,
        amphtml_urls,
        canonical_url,
        coverage: "partial-local-rules".to_string(),
        findings,
        unchecked: vec![
            "Official AMP validator rule set and version".into(),
            "Network status, redirects, canonical alignment, and content of declared AMP targets"
                .into(),
            "Complete AMP component, CSS, attribute, and structured-data validation".into(),
        ],
    }
}

fn add_finding(
    findings: &mut Vec<AmpFinding>,
    code: &str,
    severity: &str,
    message: String,
    evidence: String,
    recommendation: &str,
) {
    if findings.len() < MAX_FINDINGS {
        findings.push(AmpFinding {
            code: code.to_string(),
            severity: severity.to_string(),
            message,
            evidence,
            recommendation: recommendation.to_string(),
        });
    }
}

fn has_amp_noscript_boilerplate(html: &str) -> bool {
    let lower = html.to_ascii_lowercase();
    let mut remainder = lower.as_str();
    while let Some(start) = remainder.find("<noscript") {
        let block = &remainder[start..];
        let end = block.find("</noscript>").unwrap_or(block.len());
        if block[..end].contains("<style") && block[..end].contains("amp-boilerplate") {
            return true;
        }
        if end == block.len() {
            break;
        }
        remainder = &block[end + "</noscript>".len()..];
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_regular_page_without_amp_signals_unclassified() {
        let report = audit_amp(
            "<html><head><title>Page</title></head><body>Text</body></html>",
            "https://example.test/",
        );
        assert!(!report.detected);
        assert!(!report.is_amp_document);
        assert!(report.amphtml_urls.is_empty());
        assert!(
            report.findings.is_empty(),
            "unexpected findings: {:?}",
            report.findings
        );
        assert_eq!(report.coverage, "partial-local-rules");
    }

    #[test]
    fn resolves_amphtml_and_canonical_targets_without_fetching_them() {
        let report = audit_amp(
            "<html><head><link rel='canonical' href='/article'><link rel='amphtml' href='/article/amp'></head><body></body></html>",
            "https://example.test/article",
        );
        assert!(report.detected);
        assert!(!report.is_amp_document);
        assert_eq!(
            report.amphtml_urls,
            vec!["https://example.test/article/amp"]
        );
        assert_eq!(
            report.canonical_url.as_deref(),
            Some("https://example.test/article")
        );
        assert!(report
            .unchecked
            .iter()
            .any(|item| item.contains("Network status")));
    }

    #[test]
    fn reports_required_amp_document_markers_and_non_allowlisted_scripts() {
        let report = audit_amp(
            "<html amp><head><script src='https://example.test/app.js'></script></head><body></body></html>",
            "https://example.test/article/amp",
        );
        assert!(report.is_amp_document);
        let codes = report
            .findings
            .iter()
            .map(|item| item.code.as_str())
            .collect::<Vec<_>>();
        for expected in [
            "amp-canonical-missing",
            "amp-charset-missing",
            "amp-viewport-missing",
            "amp-runtime-missing",
            "amp-boilerplate-missing",
            "amp-noscript-boilerplate-missing",
            "amp-script-not-allowlisted",
        ] {
            assert!(codes.contains(&expected), "missing finding {expected}");
        }
        assert!(report.findings.iter().all(|item| {
            !item.message.is_empty() && !item.evidence.is_empty() && !item.recommendation.is_empty()
        }));
    }

    #[test]
    fn validates_amp_canonical_declarations_without_fetching_the_target() {
        let report = audit_amp(
            "<html amp><head><link rel='canonical'><link rel='canonical' href='javascript:alert(1)'></head><body></body></html>",
            "https://example.test/article/amp",
        );
        let codes = report
            .findings
            .iter()
            .map(|item| item.code.as_str())
            .collect::<Vec<_>>();
        assert!(codes.contains(&"amp-canonical-multiple"));
        assert!(codes.contains(&"amp-canonical-target-invalid"));
        assert_eq!(report.canonical_url.as_deref(), Some("javascript:alert(1)"));
        assert!(report.findings.iter().all(|item| {
            !item.message.is_empty() && !item.evidence.is_empty() && !item.recommendation.is_empty()
        }));
    }

    #[test]
    fn deduplicates_and_bounds_amphtml_targets() {
        let report = audit_amp(
            "<html><head><link rel='amphtml' href='/amp'><link rel='alternate amphtml' href='/amp'><link rel='amphtml' href='/other'></head><body></body></html>",
            "https://example.test/",
        );
        assert_eq!(
            report.amphtml_urls,
            vec!["https://example.test/amp", "https://example.test/other"]
        );
        assert!(report
            .findings
            .iter()
            .any(|item| item.code == "amphtml-multiple-targets"));
    }

    #[test]
    fn recognizes_common_amp_document_requirements_without_claiming_full_validity() {
        let report = audit_amp(
            r#"<!doctype html><html amp><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,minimum-scale=1,initial-scale=1"><link rel="canonical" href="https://example.test/article"><script async src="https://cdn.ampproject.org/v0.js"></script><style amp-boilerplate>body{visibility:hidden}</style><noscript><style amp-boilerplate>body{visibility:visible}</style></noscript></head><body><h1>AMP page</h1></body></html>"#,
            "https://example.test/article/amp",
        );
        assert!(report.is_amp_document);
        assert!(
            report.findings.is_empty(),
            "unexpected findings: {:?}",
            report.findings
        );
        assert_eq!(
            report.canonical_url.as_deref(),
            Some("https://example.test/article")
        );
        assert_eq!(report.coverage, "partial-local-rules");
        assert!(!report.unchecked.is_empty());
    }

    #[test]
    fn reports_inline_scripts_forbidden_elements_and_missing_component_extensions() {
        let report = audit_amp(
            r#"<html amp><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.test/article"><script async src="https://cdn.ampproject.org/v0.js"></script><style amp-boilerplate>body{visibility:hidden}</style><noscript><style amp-boilerplate>body{visibility:visible}</style></noscript></head><body><img src="photo.jpg" onclick="track()"><amp-img src="photo.jpg"></amp-img><script>window.bad=true</script></body></html>"#,
            "https://example.test/article/amp",
        );
        let codes = report
            .findings
            .iter()
            .map(|item| item.code.as_str())
            .collect::<Vec<_>>();
        assert!(codes.contains(&"amp-element-not-allowed"));
        assert!(codes.contains(&"amp-inline-event-handler"));
        assert!(codes.contains(&"amp-component-script-missing"));
        assert!(codes.contains(&"amp-script-not-allowlisted"));
    }

    #[test]
    fn validates_amp_custom_css_cardinality_and_imports() {
        let report = audit_amp(
            r#"<html amp><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.test/article"><script async src="https://cdn.ampproject.org/v0.js"></script><style amp-boilerplate>body{visibility:hidden}</style><noscript><style amp-boilerplate>body{visibility:visible}</style></noscript><style amp-custom>@import url('theme.css');</style><style amp-custom>body{color:red}</style></head><body></body></html>"#,
            "https://example.test/article/amp",
        );
        let codes = report
            .findings
            .iter()
            .map(|item| item.code.as_str())
            .collect::<Vec<_>>();
        assert!(codes.contains(&"amp-custom-css-multiple"));
        assert!(codes.contains(&"amp-custom-css-import"));
    }

    #[test]
    fn accepts_amp_component_when_extension_is_loaded() {
        let report = audit_amp(
            r#"<html amp><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.test/article"><script async src="https://cdn.ampproject.org/v0.js"></script><script async custom-element="amp-img" src="https://cdn.ampproject.org/v0/amp-img.js"></script><style amp-boilerplate>body{visibility:hidden}</style><noscript><style amp-boilerplate>body{visibility:visible}</style></noscript></head><body><amp-img src="photo.jpg"></amp-img></body></html>"#,
            "https://example.test/article/amp",
        );
        assert!(!report
            .findings
            .iter()
            .any(|item| item.code == "amp-component-script-missing"));
    }
}
