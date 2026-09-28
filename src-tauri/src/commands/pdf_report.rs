use base64::Engine;
use serde_json::Value;

fn ascii_pdf_text(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            'ą' | 'Ą' => 'a',
            'ć' | 'Ć' => 'c',
            'ę' | 'Ę' => 'e',
            'ł' | 'Ł' => 'l',
            'ń' | 'Ń' => 'n',
            'ó' | 'Ó' => 'o',
            'ś' | 'Ś' => 's',
            'ż' | 'Ż' | 'ź' | 'Ź' => 'z',
            '\\' => '\\',
            '(' => '(',
            ')' => ')',
            character if character.is_ascii_graphic() || character == ' ' => character,
            _ => '?',
        })
        .collect()
}

fn pdf_literal(value: &str) -> String {
    ascii_pdf_text(value)
        .replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
}

fn wrapped_lines(value: &str, width: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in value.split_whitespace() {
        if !current.is_empty() && current.len() + word.len() + 1 > width {
            lines.push(current);
            current = String::new();
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }
    if !current.is_empty() {
        lines.push(current);
    }
    if lines.is_empty() {
        lines.push("-".into());
    }
    lines
}

fn audit_text_lines(audit: &Value) -> Vec<String> {
    let read = |pointer: &str| {
        audit
            .pointer(pointer)
            .and_then(Value::as_str)
            .unwrap_or("-")
            .to_string()
    };
    let number = |pointer: &str| {
        audit
            .pointer(pointer)
            .and_then(Value::as_i64)
            .map(|value| value.to_string())
            .unwrap_or_else(|| "-".into())
    };
    let mut lines = vec![
        "SEOmi - audit report".into(),
        format!("Audited URL: {}", read("/final_url")),
        format!("Audited at: {}", read("/timestamp")),
        format!("HTTP status: {}", number("/http_status")),
        format!("Response time: {} ms", number("/response_time_ms")),
        format!("Health score: {} / 100", number("/health_score")),
        format!("Title: {}", read("/meta_tags/title")),
        format!("Meta description: {}", read("/meta_tags/description")),
        format!("Canonical: {}", read("/meta_tags/canonical")),
        format!("H1 count: {}", number("/headings/h1_count")),
        format!(
            "Images: {} | Links: {}",
            audit
                .get("images")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0),
            number("/links/total_links")
        ),
        "".into(),
        "Issues detected by local audit rules:".into(),
    ];
    let issues = audit
        .get("issues")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if issues.is_empty() {
        lines.push("No issues were reported by this audit.".into());
    } else {
        for issue in issues {
            let severity = issue
                .get("severity")
                .and_then(Value::as_str)
                .unwrap_or("Info");
            let category = issue
                .get("category")
                .and_then(Value::as_str)
                .unwrap_or("Technical");
            let message = issue.get("message").and_then(Value::as_str).unwrap_or("-");
            lines.push(format!("[{severity}] {category}: {message}"));
        }
    }
    lines.push("".into());
    lines.push(
        "Method: local HTTP and HTML analysis. This report is not a Google indexation verdict."
            .into(),
    );
    lines
}

fn crawl_text_lines(run: &Value) -> Vec<String> {
    let read = |value: &Value, key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or("-")
            .to_string()
    };
    let number = |value: &Value, key: &str| {
        value
            .get(key)
            .and_then(Value::as_i64)
            .map(|item| item.to_string())
            .unwrap_or_else(|| "-".into())
    };
    let result = run.get("result").unwrap_or(&Value::Null);
    let selected_sections = run
        .get("report_template_sections")
        .and_then(Value::as_array)
        .map(|sections| {
            sections
                .iter()
                .filter_map(Value::as_str)
                .collect::<std::collections::HashSet<_>>()
        });
    let has_section = |section: &str| {
        selected_sections
            .as_ref()
            .map(|sections| sections.contains(section))
            .unwrap_or(true)
    };
    let pages = result
        .get("pages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let resources = result
        .get("resources")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let mut lines = vec![
        "SEOmi - site crawl report".into(),
        format!("Run ID: {}", read(run, "id")),
        format!("Completed at: {}", read(run, "completed_at")),
        format!("Scope start URL: {}", read(run, "scope_start_url")),
        format!("Pages crawled: {}", number(result, "pages_crawled")),
        format!("Health score: {} / 100", number(result, "health_score")),
        format!(
            "Critical issues: {} | Warnings: {}",
            number(result, "critical_count"),
            number(result, "warning_count")
        ),
        format!(
            "Duration: {} ms | Resources: {resources}",
            number(result, "duration_ms")
        ),
        "".into(),
    ];

    if let Some(reasons) = result.get("limit_reasons").and_then(Value::as_array) {
        let labels = reasons.iter().filter_map(Value::as_str).collect::<Vec<_>>();
        if !labels.is_empty() {
            lines.push(format!("Limits observed: {}", labels.join(", ")));
        }
    }
    if result
        .get("discovery_provenance_truncated")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        lines.push("Discovery provenance: partial at the configured safety cap.".into());
    }

    if has_section("configuration") {
        lines.insert(
            4,
            format!(
                "Configuration: {}",
                run.get("configuration")
                    .map(Value::to_string)
                    .unwrap_or_else(|| "-".into())
            ),
        );
    }

    if has_section("pages") {
        lines.push("Pages from the saved crawl result:".into());
    }

    if has_section("pages") && pages.is_empty() {
        lines.push("No page records were present in this crawl run.".into());
    }
    if has_section("pages") {
        for page in &pages {
            let title = read(page, "title");
            let url = read(page, "url");
            let status = number(page, "http_status");
            let indexability = read(page, "indexability_status");
            lines.push(format!("{status} | {title} | {url}"));
            lines.push(format!(
                "Depth: {} | Response: {} ms | Indexability: {indexability} | Words: {}",
                number(page, "depth"),
                number(page, "response_time_ms"),
                number(page, "word_count")
            ));
            if let Some(verdict) = page.get("indexability_verdict") {
                let status = verdict
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                let reasons = verdict
                    .get("reasons")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join(", ")
                    })
                    .unwrap_or_default();
                lines.push(format!(
                    "Indexability verdict: {status}{}",
                    if reasons.is_empty() {
                        String::new()
                    } else {
                        format!(" ({reasons})")
                    }
                ));
            }
            let redirect_stop_reason = read(page, "redirect_stop_reason");
            if !redirect_stop_reason.is_empty() {
                lines.push(format!("Redirect stop reason: {redirect_stop_reason}"));
            }
            let issues = page
                .get("issues")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if issues.is_empty() {
                lines.push("Issues: none reported by local crawl rules.".into());
            } else {
                for issue in issues {
                    lines.push(format!(
                        "[{}] {}",
                        issue
                            .get("severity")
                            .and_then(Value::as_str)
                            .unwrap_or("Info"),
                        issue.get("message").and_then(Value::as_str).unwrap_or("-")
                    ));
                }
            }
            lines.push("".into());
        }
    }

    // Keep the PDF useful as a self-contained hand-off artifact. The compact
    // summary above is followed by deterministic tables built exclusively from
    // the selected snapshot; no URL is fetched again while generating a PDF.
    if has_section("pages") {
        lines.push("Pages table (all saved pages):".into());
        lines.push(
            "URL | Final URL | HTTP | Depth | Response ms | Indexability | Redirect stop reason | Words | Issues".into(),
        );
        for page in &pages {
            lines.push(format!(
                "{} | {} | {} | {} | {} | {} | {} | {} | {}",
                read(page, "url"),
                read(page, "final_url"),
                number(page, "http_status"),
                number(page, "depth"),
                number(page, "response_time_ms"),
                read(page, "indexability_status"),
                read(page, "redirect_stop_reason"),
                number(page, "word_count"),
                page.get("issues")
                    .and_then(Value::as_array)
                    .map(Vec::len)
                    .unwrap_or(0),
            ));
        }
    }

    if has_section("issues") {
        lines.push("Issues table (all saved findings):".into());
        lines.push("Page URL | Severity | Message".into());
        for page in &pages {
            if let Some(issues) = page.get("issues").and_then(Value::as_array) {
                for issue in issues {
                    lines.push(format!(
                        "{} | {} | {}",
                        read(page, "url"),
                        issue
                            .get("severity")
                            .and_then(Value::as_str)
                            .unwrap_or("Info"),
                        issue.get("message").and_then(Value::as_str).unwrap_or("-"),
                    ));
                }
            }
        }
    }

    if has_section("links") {
        lines.push("Links table (all saved page links):".into());
        lines.push("Source URL | Target URL | HTTP | Anchor | Rel | Internal".into());
        for page in &pages {
            if let Some(links) = page.get("links").and_then(Value::as_array) {
                for link in links {
                    let target_status = link
                        .get("target_http_status")
                        .and_then(Value::as_i64)
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "-".into());
                    let internal = link
                        .get("is_internal")
                        .and_then(Value::as_bool)
                        .map(|value| if value { "yes" } else { "no" })
                        .unwrap_or("-");
                    lines.push(format!(
                        "{} | {} | {} | {} | {} | {}",
                        read(page, "url"),
                        link.get("target_url")
                            .and_then(Value::as_str)
                            .unwrap_or("-"),
                        target_status,
                        link.get("anchor_text")
                            .and_then(Value::as_str)
                            .unwrap_or("-"),
                        link.get("rel").and_then(Value::as_str).unwrap_or("-"),
                        internal,
                    ));
                }
            }
        }
    }

    if has_section("images") {
        lines.push("Images table (all saved page images):".into());
        lines.push("Page URL | Image source | ALT | HTTP | Bytes | Format | Lazy".into());
        for page in &pages {
            if let Some(images) = page.get("images").and_then(Value::as_array) {
                for image in images {
                    let lazy = image
                        .get("lazy_loaded")
                        .and_then(Value::as_bool)
                        .map(|value| if value { "yes" } else { "no" })
                        .unwrap_or("-");
                    let number_or_dash = |key: &str| {
                        image
                            .get(key)
                            .and_then(Value::as_i64)
                            .map(|value| value.to_string())
                            .unwrap_or_else(|| "-".into())
                    };
                    lines.push(format!(
                        "{} | {} | {} | {} | {} | {} | {}",
                        read(page, "url"),
                        image.get("src").and_then(Value::as_str).unwrap_or("-"),
                        image.get("alt").and_then(Value::as_str).unwrap_or("-"),
                        number_or_dash("http_status"),
                        number_or_dash("content_length"),
                        image.get("format").and_then(Value::as_str).unwrap_or("-"),
                        lazy,
                    ));
                }
            }
        }
    }

    if has_section("resources") {
        if let Some(resources) = result.get("resources").and_then(Value::as_array) {
            lines.push("Resources table (all saved resources):".into());
            lines.push("Resource URL | Type | HTTP | Content-Type | Bytes | Error".into());
            for resource in resources {
                let resource_number = |key: &str| {
                    resource
                        .get(key)
                        .and_then(Value::as_i64)
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "-".into())
                };
                lines.push(format!(
                    "{} | {} | {} | {} | {} | {}",
                    resource.get("url").and_then(Value::as_str).unwrap_or("-"),
                    resource
                        .get("resource_type")
                        .and_then(Value::as_str)
                        .unwrap_or("-"),
                    resource_number("http_status"),
                    resource
                        .get("content_type")
                        .and_then(Value::as_str)
                        .unwrap_or("-"),
                    resource_number("content_length"),
                    resource
                        .get("request_error_kind")
                        .and_then(Value::as_str)
                        .unwrap_or("-"),
                ));
            }
        }
    }

    lines.push("Method: local HTTP and HTML crawl. Only data stored in the selected run is included; no pages are fetched again for this report.".into());
    lines
}

struct PdfChartBar {
    label: String,
    value: u64,
    scale: u64,
}

fn crawl_chart(run: &Value) -> Option<Vec<PdfChartBar>> {
    let result = run.get("result")?;
    let pages = result.get("pages").and_then(Value::as_array);
    let page_count = result
        .get("pages_crawled")
        .and_then(Value::as_u64)
        .or_else(|| pages.map(|items| items.len() as u64));
    let critical = result.get("critical_count").and_then(Value::as_u64);
    let warnings = result.get("warning_count").and_then(Value::as_u64);
    let health = result.get("health_score").and_then(Value::as_u64);
    let status_2xx = pages.map(|items| {
        items
            .iter()
            .filter(|page| {
                page.get("http_status")
                    .and_then(Value::as_u64)
                    .is_some_and(|status| (200..300).contains(&status))
            })
            .count() as u64
    });
    let status_errors = pages.map(|items| {
        items
            .iter()
            .filter(|page| {
                page.get("http_status")
                    .and_then(Value::as_u64)
                    .is_some_and(|status| status >= 400)
            })
            .count() as u64
    });

    let mut bars = Vec::new();
    if let Some(value) = health {
        bars.push(PdfChartBar {
            label: "Health score".into(),
            value: value.min(100),
            scale: 100,
        });
    }
    if let Some(value) = page_count {
        bars.push(PdfChartBar {
            label: "Pages crawled".into(),
            value,
            scale: value.max(1),
        });
    }
    if let Some(value) = critical {
        bars.push(PdfChartBar {
            label: "Critical issues".into(),
            value,
            scale: value.max(1),
        });
    }
    if let Some(value) = warnings {
        bars.push(PdfChartBar {
            label: "Warnings".into(),
            value,
            scale: value.max(1),
        });
    }
    if let Some(value) = status_2xx {
        bars.push(PdfChartBar {
            label: "HTTP 2xx".into(),
            value,
            scale: value.max(1),
        });
    }
    if let Some(value) = status_errors {
        bars.push(PdfChartBar {
            label: "HTTP 4xx/5xx".into(),
            value,
            scale: value.max(1),
        });
    }
    (!bars.is_empty()).then_some(bars)
}

fn audit_chart(audit: &Value) -> Option<Vec<PdfChartBar>> {
    let mut bars = Vec::new();
    if let Some(value) = audit.get("health_score").and_then(Value::as_u64) {
        bars.push(PdfChartBar {
            label: "Health score".into(),
            value: value.min(100),
            scale: 100,
        });
    }
    if let Some(value) = audit
        .pointer("/security_headers/score")
        .and_then(Value::as_u64)
    {
        bars.push(PdfChartBar {
            label: "Security score".into(),
            value: value.min(100),
            scale: 100,
        });
    }
    if let Some(value) = audit.pointer("/headings/h1_count").and_then(Value::as_u64) {
        bars.push(PdfChartBar {
            label: "H1 count".into(),
            value,
            scale: value.max(1),
        });
    }
    if let Some(value) = audit.get("images").and_then(Value::as_array) {
        let count = value.len() as u64;
        bars.push(PdfChartBar {
            label: "Images".into(),
            value: count,
            scale: count.max(1),
        });
    }
    if let Some(value) = audit.pointer("/links/total_links").and_then(Value::as_u64) {
        bars.push(PdfChartBar {
            label: "Links".into(),
            value,
            scale: value.max(1),
        });
    }
    (!bars.is_empty()).then_some(bars)
}

fn chart_stream(bars: &[PdfChartBar]) -> String {
    let mut stream = String::from("BT\n/F1 16 Tf\n50 780 Td\n(Crawl metrics - saved run) Tj\nET\n");
    for (index, bar) in bars.iter().enumerate() {
        let y = 690_i32 - (index as i32 * 82);
        let width = 360_u64.saturating_mul(bar.value.min(bar.scale)) / bar.scale.max(1);
        let text_y = y + 30;
        stream.push_str(&format!(
            "BT\n/F1 10 Tf\n50 {text_y} Td\n({}: {}) Tj\nET\n",
            pdf_literal(&bar.label),
            bar.value
        ));
        stream.push_str("0.10 0.65 0.43 rg\n");
        stream.push_str(&format!("190 {y} {width} 24 re f\n"));
        stream.push_str("0.35 0.40 0.47 RG\n1 w\n190 ");
        stream.push_str(&format!("{y} 360 24 re S\n"));
    }
    stream
}

fn pdf_bytes(lines: Vec<String>, chart: Option<Vec<PdfChartBar>>) -> Vec<u8> {
    let mut visual_lines = Vec::new();
    for line in lines {
        visual_lines.extend(wrapped_lines(&line, 96));
    }
    let page_chunks = visual_lines.chunks(48).collect::<Vec<_>>();
    let text_page_count = page_chunks.len().max(1);
    let chart_page_count = usize::from(chart.is_some());
    let page_count = text_page_count + chart_page_count;
    let mut objects = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        format!(
            "<< /Type /Pages /Kids [{}] /Count {page_count} >>",
            (0..page_count)
                .map(|index| format!("{} 0 R", 4 + index * 2))
                .collect::<Vec<_>>()
                .join(" ")
        ),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
    ];
    for chunk in page_chunks {
        let mut stream = String::from("BT\n/F1 10 Tf\n50 792 Td\n");
        for (index, line) in chunk.iter().enumerate() {
            if index > 0 {
                stream.push_str("0 -15 Td\n");
            }
            stream.push_str(&format!("({}) Tj\n", pdf_literal(line)));
        }
        stream.push_str("ET\n");
        let content_id = objects.len() + 2;
        objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>"));
        objects.push(format!(
            "<< /Length {} >>\nstream\n{}endstream",
            stream.len(),
            stream
        ));
    }
    if let Some(bars) = chart.as_deref() {
        let stream = chart_stream(bars);
        let content_id = objects.len() + 2;
        objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>"));
        objects.push(format!(
            "<< /Length {} >>\nstream\n{}endstream",
            stream.len(),
            stream
        ));
    }
    let mut bytes = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = vec![0usize];
    for (index, object) in objects.iter().enumerate() {
        offsets.push(bytes.len());
        bytes.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", index + 1, object).as_bytes());
    }
    let xref_offset = bytes.len();
    bytes.extend_from_slice(
        format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
    );
    for offset in offsets.iter().skip(1) {
        bytes.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    bytes.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    bytes
}

#[tauri::command]
pub fn generate_audit_pdf(audit: Value) -> Result<String, String> {
    let final_url = audit
        .get("final_url")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if final_url.is_empty() {
        return Err("The audit has no final URL to report.".into());
    }
    Ok(base64::engine::general_purpose::STANDARD
        .encode(pdf_bytes(audit_text_lines(&audit), audit_chart(&audit))))
}

#[tauri::command]
pub fn generate_crawl_pdf(run: Value) -> Result<String, String> {
    let start_url = run
        .pointer("/scope_start_url")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if start_url.is_empty() {
        return Err("The crawl run has no scope URL to report.".into());
    }
    Ok(base64::engine::general_purpose::STANDARD
        .encode(pdf_bytes(crawl_text_lines(&run), crawl_chart(&run))))
}

#[cfg(test)]
mod tests {
    use super::{generate_audit_pdf, generate_crawl_pdf};
    use base64::Engine;

    #[test]
    fn creates_a_valid_pdf_payload_from_an_audit() {
        let encoded = generate_audit_pdf(serde_json::json!({ "final_url": "https://example.com", "health_score": 80, "issues": [{ "severity": "Warning", "category": "Technical", "message": "Missing title" }] })).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        assert!(bytes.starts_with(b"%PDF-1.4"));
        assert!(String::from_utf8_lossy(&bytes).contains("Missing title"));
        assert!(String::from_utf8_lossy(&bytes).contains("Crawl metrics - saved run"));
    }

    #[test]
    fn creates_a_crawl_pdf_from_the_saved_run_without_refetching_pages() {
        let encoded = generate_crawl_pdf(serde_json::json!({
            "id": "run-1",
            "completed_at": "2026-09-22T12:00:00Z",
            "scope_start_url": "https://example.com",
            "configuration": {"max_urls": 100},
            "result": {
                "pages_crawled": 1,
                "health_score": 80,
                "critical_count": 1,
                "warning_count": 0,
                "duration_ms": 123,
                "pages": [{"url": "https://example.com", "final_url": "https://example.com", "title": "Example", "http_status": 200, "depth": 0, "response_time_ms": 12, "indexability_status": "Eligible", "redirect_stop_reason": "redirect limit of 10 exceeded", "word_count": 42, "issues": [{"severity": "Critical", "message": "Missing canonical"}], "links": [{"target_url": "https://example.com/docs", "anchor_text": "Docs", "is_internal": true, "target_http_status": 200}], "images": [{"src": "https://example.com/logo.webp", "alt": "Logo", "format": "webp", "lazy_loaded": false, "http_status": 200, "content_length": 1234}]}],
                "resources": [{"url": "https://example.com/app.css", "resource_type": "stylesheet", "http_status": 200, "content_type": "text/css", "content_length": 88}]
            }
        })).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        let report = String::from_utf8_lossy(&bytes);
        assert!(bytes.starts_with(b"%PDF-1.4"));
        assert!(report.contains("Missing canonical"));
        assert!(report.contains("Pages table \\(all saved pages\\):"));
        assert!(report.contains("Redirect stop reason: redirect limit of 10 exceeded"));
        assert!(report.contains("Redirect stop reason"));
        assert!(report.contains("Links table \\(all saved page links\\):"));
        assert!(report.contains("Images table \\(all saved page images\\):"));
        assert!(report.contains("Resources table \\(all saved resources\\):"));
        assert!(report.contains("https://example.com/app.css"));
        assert!(report.contains("Configuration:"));
        assert!(report.contains("Crawl metrics - saved run"));
        assert!(report.contains("re f"));
    }

    #[test]
    fn applies_report_template_sections_to_the_pdf_tables() {
        let encoded = generate_crawl_pdf(serde_json::json!({
            "id": "run-template",
            "scope_start_url": "https://example.com",
            "configuration": {"max_urls": 1},
            "report_template_sections": ["summary", "issues"],
            "result": {
                "pages_crawled": 1,
                "health_score": 90,
                "critical_count": 0,
                "warning_count": 1,
                "duration_ms": 10,
                "pages": [{"url": "https://example.com", "final_url": "https://example.com", "title": "Example", "http_status": 200, "issues": [{"severity": "Warning", "message": "Missing description"}], "links": [{"target_url": "https://example.com/docs", "anchor_text": "Docs", "is_internal": true}], "images": [{"src": "https://example.com/logo.webp", "alt": "Logo"}]}]
            }
        })).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        let report = String::from_utf8_lossy(&bytes);
        assert!(report.contains("Issues table \\(all saved findings\\):"));
        assert!(!report.contains("Pages table \\(all saved pages\\):"));
        assert!(!report.contains("Links table \\(all saved page links\\):"));
        assert!(!report.contains("Images table \\(all saved page images\\):"));
    }

    #[test]
    fn rejects_crawl_pdf_without_scope_url() {
        assert!(generate_crawl_pdf(serde_json::json!({"result": {}})).is_err());
    }
}
