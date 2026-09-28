use crate::models::audit_data::{Issue, IssueCategory, IssueSeverity, SecurityHeaders};
use std::collections::HashMap;

pub struct SecurityAuditResult {
    pub headers: SecurityHeaders,
    pub issues: Vec<Issue>,
}

/// Evaluates HTTP security headers and produces a security score and actionable issues
pub fn evaluate_security_headers(headers: &HashMap<String, String>) -> SecurityAuditResult {
    let mut issues = Vec::new();
    let mut score: u8 = 100;

    let hsts = headers.get("strict-transport-security").cloned();
    let csp = headers.get("content-security-policy").cloned();
    let x_frame = headers.get("x-frame-options").cloned();
    let x_content_type = headers.get("x-content-type-options").cloned();
    let referrer = headers.get("referrer-policy").cloned();
    let permissions = headers
        .get("permissions-policy")
        .or_else(|| headers.get("feature-policy"))
        .cloned();
    let coop = headers.get("cross-origin-opener-policy").cloned();
    let corp = headers.get("cross-origin-resource-policy").cloned();
    let server = headers.get("server").cloned();
    let x_powered_by = headers.get("x-powered-by").cloned();

    // 1. Audit HSTS
    if let Some(ref val) = hsts {
        let val_lower = val.to_lowercase();
        if !val_lower.contains("max-age=") {
            score = score.saturating_sub(10);
            issues.push(Issue {
                severity: IssueSeverity::Warning,
                category: IssueCategory::Security,
                code: Some("security_hsts_invalid".into()),
                params: None,
                message: "HSTS header is missing 'max-age'".to_string(),
                recommendation: Some("Specify 'max-age=31536000; includeSubDomains; preload' in Strict-Transport-Security".to_string()),
            });
        }
    } else {
        score = score.saturating_sub(25);
        issues.push(Issue {
            severity: IssueSeverity::Critical,
            category: IssueCategory::Security,
            code: Some("security_hsts_missing".into()),
            params: None,
            message: "Missing Strict-Transport-Security (HSTS) header".to_string(),
            recommendation: Some(
                "Enable HSTS to prevent man-in-the-middle attacks and cookie hijacking".to_string(),
            ),
        });
    }

    // 2. Audit Content-Security-Policy (CSP)
    if let Some(ref val) = csp {
        let val_lower = val.to_lowercase();
        if val_lower.contains("'unsafe-inline'") || val_lower.contains("'unsafe-eval'") {
            score = score.saturating_sub(10);
            issues.push(Issue {
                severity: IssueSeverity::Warning,
                category: IssueCategory::Security,
                code: Some("security_csp_unsafe".into()),
                params: None,
                message: "Content-Security-Policy allows 'unsafe-inline' or 'unsafe-eval'".to_string(),
                recommendation: Some("Avoid unsafe directives in CSP to strictly mitigate Cross-Site Scripting (XSS)".to_string()),
            });
        }
    } else {
        score = score.saturating_sub(25);
        issues.push(Issue {
            severity: IssueSeverity::Warning,
            category: IssueCategory::Security,
            code: Some("security_csp_missing".into()),
            params: None,
            message: "Missing Content-Security-Policy (CSP) header".to_string(),
            recommendation: Some("Implement a strict Content-Security-Policy to protect against XSS and data injection".to_string()),
        });
    }

    // 3. Audit X-Frame-Options
    if let Some(ref val) = x_frame {
        let val_upper = val.to_uppercase();
        if !val_upper.contains("DENY") && !val_upper.contains("SAMEORIGIN") {
            score = score.saturating_sub(10);
            issues.push(Issue {
                severity: IssueSeverity::Warning,
                category: IssueCategory::Security,
                code: Some("security_xframe_invalid".into()),
                params: Some(std::collections::BTreeMap::from([(
                    "value".into(),
                    val.clone(),
                )])),
                message: format!("X-Frame-Options value '{}' is non-standard", val),
                recommendation: Some(
                    "Set X-Frame-Options to DENY or SAMEORIGIN to prevent Clickjacking".to_string(),
                ),
            });
        }
    } else {
        score = score.saturating_sub(15);
        issues.push(Issue {
            severity: IssueSeverity::Warning,
            category: IssueCategory::Security,
            code: Some("security_xframe_missing".into()),
            params: None,
            message: "Missing X-Frame-Options header (Clickjacking vulnerability)".to_string(),
            recommendation: Some("Set X-Frame-Options to DENY or SAMEORIGIN".to_string()),
        });
    }

    // 4. Audit X-Content-Type-Options
    if let Some(ref val) = x_content_type {
        if !val.to_lowercase().contains("nosniff") {
            score = score.saturating_sub(10);
            issues.push(Issue {
                severity: IssueSeverity::Warning,
                category: IssueCategory::Security,
                code: Some("security_xcontent_invalid".into()),
                params: None,
                message: "X-Content-Type-Options is not set to 'nosniff'".to_string(),
                recommendation: Some(
                    "Set X-Content-Type-Options to 'nosniff' to prevent MIME sniffing attacks"
                        .to_string(),
                ),
            });
        }
    } else {
        score = score.saturating_sub(15);
        issues.push(Issue {
            severity: IssueSeverity::Warning,
            category: IssueCategory::Security,
            code: Some("security_xcontent_missing".into()),
            params: None,
            message: "Missing X-Content-Type-Options header".to_string(),
            recommendation: Some("Add 'X-Content-Type-Options: nosniff' header".to_string()),
        });
    }

    // 5. Audit Referrer-Policy
    if referrer.is_none() {
        score = score.saturating_sub(5);
        issues.push(Issue {
            severity: IssueSeverity::Info,
            category: IssueCategory::Security,
            code: Some("security_referrer_missing".into()),
            params: None,
            message: "Missing Referrer-Policy header".to_string(),
            recommendation: Some(
                "Set Referrer-Policy to 'strict-origin-when-cross-origin'".to_string(),
            ),
        });
    }

    // 6. Audit Permissions-Policy
    if permissions.is_none() {
        score = score.saturating_sub(5);
        issues.push(Issue {
            severity: IssueSeverity::Info,
            category: IssueCategory::Security,
            code: Some("security_permissions_missing".into()),
            params: None,
            message: "Missing Permissions-Policy header".to_string(),
            recommendation: Some(
                "Define Permissions-Policy to restrict camera, microphone, geolocation access"
                    .to_string(),
            ),
        });
    }

    // 7. Audit Information Disclosure: Server version and X-Powered-By
    if let Some(ref srv) = server {
        let has_version = srv
            .split('/')
            .nth(1)
            .is_some_and(|part| part.chars().any(|c| c.is_ascii_digit()));
        if has_version {
            issues.push(Issue {
                severity: IssueSeverity::Warning,
                category: IssueCategory::Security,
                code: Some("security_server_version".into()),
                params: Some(std::collections::BTreeMap::from([("value".into(), srv.clone())])),
                message: format!("Server header leaks software version ('{}')", srv),
                recommendation: Some("Configure web server to suppress banner/version tokens (e.g. ServerTokens Prod in Apache or server_tokens off in nginx)".to_string()),
            });
        }
    }

    if let Some(ref powered) = x_powered_by {
        issues.push(Issue {
            severity: IssueSeverity::Warning,
            category: IssueCategory::Security,
            code: Some("security_powered_by".into()),
            params: Some(std::collections::BTreeMap::from([("value".into(), powered.clone())])),
            message: format!("X-Powered-By header discloses technology stack ('{}')", powered),
            recommendation: Some("Disable X-Powered-By in your server or framework configuration to reduce information leakage".to_string()),
        });
    }

    // 8. Audit COOP / CORP
    if let Some(ref val) = coop {
        let val_lower = val.to_lowercase();
        if !val_lower.contains("same-origin") {
            issues.push(Issue {
                severity: IssueSeverity::Info,
                category: IssueCategory::Security,
                code: Some("security_coop_relaxed".into()),
                params: Some(std::collections::BTreeMap::from([(
                    "value".into(),
                    val.clone(),
                )])),
                message: format!("Cross-Origin-Opener-Policy has relaxed setting ('{}')", val),
                recommendation: Some(
                    "Set 'Cross-Origin-Opener-Policy: same-origin' to protect against XS-Leaks"
                        .to_string(),
                ),
            });
        }
    }

    SecurityAuditResult {
        headers: SecurityHeaders {
            strict_transport_security: hsts,
            content_security_policy: csp,
            x_frame_options: x_frame,
            x_content_type_options: x_content_type,
            referrer_policy: referrer,
            permissions_policy: permissions,
            cross_origin_opener_policy: coop,
            cross_origin_resource_policy: corp,
            server,
            x_powered_by,
            score,
        },
        issues,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_perfect_security_headers() {
        let mut map = HashMap::new();
        map.insert(
            "strict-transport-security".to_string(),
            "max-age=31536000; includeSubDomains; preload".to_string(),
        );
        map.insert(
            "content-security-policy".to_string(),
            "default-src 'self'".to_string(),
        );
        map.insert("x-frame-options".to_string(), "DENY".to_string());
        map.insert("x-content-type-options".to_string(), "nosniff".to_string());
        map.insert(
            "referrer-policy".to_string(),
            "strict-origin-when-cross-origin".to_string(),
        );
        map.insert(
            "permissions-policy".to_string(),
            "camera=(), microphone=()".to_string(),
        );

        let res = evaluate_security_headers(&map);
        assert_eq!(res.headers.score, 100);
        assert!(res.issues.is_empty());
    }

    #[test]
    fn test_missing_all_security_headers() {
        let map = HashMap::new();
        let res = evaluate_security_headers(&map);

        assert!(res.headers.score < 50);
        assert!(res.issues.iter().any(|i| i.message.contains("HSTS")));
        assert!(res
            .issues
            .iter()
            .any(|i| i.message.contains("Content-Security-Policy")));
        assert!(res
            .issues
            .iter()
            .any(|i| i.message.contains("X-Frame-Options")));
    }

    #[test]
    fn test_hsts_missing_max_age() {
        let mut map = HashMap::new();
        map.insert(
            "strict-transport-security".to_string(),
            "includeSubDomains".to_string(),
        );

        let res = evaluate_security_headers(&map);
        assert!(res
            .issues
            .iter()
            .any(|i| i.message.contains("missing 'max-age'")));
    }

    #[test]
    fn test_csp_with_unsafe_inline() {
        let mut map = HashMap::new();
        map.insert(
            "content-security-policy".to_string(),
            "script-src 'self' 'unsafe-inline'".to_string(),
        );

        let res = evaluate_security_headers(&map);
        assert!(res
            .issues
            .iter()
            .any(|i| i.message.contains("unsafe-inline")));
    }

    #[test]
    fn test_invalid_x_frame_options() {
        let mut map = HashMap::new();
        map.insert("x-frame-options".to_string(), "ALLOWALL".to_string());

        let res = evaluate_security_headers(&map);
        assert!(res
            .issues
            .iter()
            .any(|i| i.message.contains("non-standard")));
    }
}
