use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageAuditData {
    pub url: String,
    pub final_url: String,
    pub timestamp: DateTime<Utc>,
    pub http_status: u16,
    pub response_time_ms: u64,
    pub redirect_chain: Vec<RedirectHop>,
    pub meta_tags: MetaTags,
    pub open_graph: OpenGraphData,
    pub twitter_card: TwitterCardData,
    pub headings: HeadingsStructure,
    pub images: Vec<ImageData>,
    pub links: LinksAnalysis,
    pub security_headers: SecurityHeaders,
    pub structured_data: Vec<StructuredData>,
    pub technical: TechnicalData,
    pub health_score: u8,
    pub issues: Vec<Issue>,
    pub content_stats: ContentStats,
    #[serde(default)]
    pub indexability: IndexabilityAssessment,
    #[serde(default)]
    pub accessibility: AccessibilityAudit,
    #[serde(default)]
    pub amp: AmpAudit,
    #[serde(default)]
    pub http_performance: Option<HttpPerformanceMeasurement>,
    #[serde(default)]
    pub transport_security: Option<TransportSecurityAudit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HttpPerformanceMeasurement {
    pub measured_at: DateTime<Utc>,
    pub method: String,
    /// Client elapsed time from request dispatch until final response headers; includes redirects.
    pub response_headers_ms: u64,
    /// Time spent reading the decoded response body after response headers arrived.
    pub body_read_ms: u64,
    /// Client elapsed time to response headers plus response body read.
    pub total_request_ms: u64,
    pub decoded_body_bytes: u64,
    /// Server-declared Content-Length; it may represent compressed bytes and is not a wire capture.
    pub content_length_header_bytes: Option<u64>,
    pub redirect_hops: usize,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct AmpAudit {
    /// True when this page declares AMP markup or a rel=amphtml alternate.
    pub detected: bool,
    pub is_amp_document: bool,
    pub amphtml_urls: Vec<String>,
    pub canonical_url: Option<String>,
    /// This is a deterministic local subset, not the official AMP validator.
    pub coverage: String,
    pub findings: Vec<AmpFinding>,
    pub unchecked: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AmpFinding {
    pub code: String,
    pub severity: String,
    pub message: String,
    pub evidence: String,
    pub recommendation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RedirectHop {
    pub url: String,
    pub status_code: u16,
    pub location: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MetaTags {
    pub title: Option<String>,
    pub title_length: usize,
    pub description: Option<String>,
    pub description_length: usize,
    pub keywords: Option<String>,
    pub robots: Option<String>,
    pub canonical: Option<String>,
    pub viewport: Option<String>,
    pub charset: Option<String>,
    pub author: Option<String>,
    pub generator: Option<String>,
    pub theme_color: Option<String>,
    pub other_tags: Vec<MetaTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MetaTag {
    pub name: Option<String>,
    pub property: Option<String>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OpenGraphData {
    pub og_title: Option<String>,
    pub og_description: Option<String>,
    pub og_image: Option<String>,
    pub og_image_width: Option<String>,
    pub og_image_height: Option<String>,
    pub og_url: Option<String>,
    pub og_type: Option<String>,
    pub og_site_name: Option<String>,
    pub og_locale: Option<String>,
    pub all_tags: Vec<MetaTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TwitterCardData {
    pub twitter_card: Option<String>,
    pub twitter_site: Option<String>,
    pub twitter_creator: Option<String>,
    pub twitter_title: Option<String>,
    pub twitter_description: Option<String>,
    pub twitter_image: Option<String>,
    pub all_tags: Vec<MetaTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HeadingsStructure {
    pub h1_count: usize,
    pub h1_texts: Vec<String>,
    pub hierarchy: Vec<HeadingNode>,
    pub has_valid_hierarchy: bool,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadingNode {
    pub level: u8,
    pub text: String,
    pub children: Vec<HeadingNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImageData {
    pub src: String,
    pub alt: Option<String>,
    pub width: Option<String>,
    pub height: Option<String>,
    pub loading: Option<String>,
    pub srcset: Option<String>,
    pub has_alt: bool,
    #[serde(default)]
    pub format: Option<String>,
    /// Explains whether dimensions came from markup attributes or a locally
    /// decoded data URI. Missing means legacy snapshot/unknown source.
    #[serde(default)]
    pub dimensions_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LinksAnalysis {
    pub total_links: usize,
    pub internal_links: usize,
    pub external_links: usize,
    pub nofollow_links: usize,
    pub links: Vec<LinkData>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkData {
    pub href: String,
    pub text: String,
    pub is_internal: bool,
    pub rel: Option<String>,
    pub target: Option<String>,
    #[serde(default)]
    pub is_insecure: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SecurityHeaders {
    pub strict_transport_security: Option<String>,
    pub content_security_policy: Option<String>,
    pub x_frame_options: Option<String>,
    pub x_content_type_options: Option<String>,
    pub referrer_policy: Option<String>,
    pub permissions_policy: Option<String>,
    pub cross_origin_opener_policy: Option<String>,
    pub cross_origin_resource_policy: Option<String>,
    pub server: Option<String>,
    pub x_powered_by: Option<String>,
    pub score: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct TransportSecurityAudit {
    pub scheme: String,
    pub https: bool,
    /// Only insecure resources referenced by HTML attributes are listed; CSS/JS runtime fetches are not rendered here.
    pub mixed_content_urls: Vec<String>,
    /// Cookie values are never retained; only names and security attributes are reported.
    pub cookies: Vec<CookieSecurityFinding>,
    pub tls_coverage: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CookieSecurityFinding {
    pub name: String,
    pub secure: bool,
    pub http_only: bool,
    pub same_site: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructuredData {
    pub data_type: String,
    pub format: String, // JSON-LD, Microdata, RDFa
    pub content: serde_json::Value,
    #[serde(default)]
    pub validation_issues: Vec<StructuredDataValidationIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StructuredDataValidationIssue {
    pub code: String,
    /// `error`, `warning`, or `info` from the deterministic local rule set.
    pub severity: String,
    pub message: String,
    pub path: Option<String>,
    pub recommendation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TechnicalData {
    pub content_type: Option<String>,
    pub server: Option<String>,
    pub favicon: Option<String>,
    #[serde(default)]
    pub favicons: Vec<FaviconData>,
    pub robots_txt_url: Option<String>,
    pub sitemap_url: Option<String>,
    pub hreflang_tags: Vec<HreflangTag>,
    #[serde(default)]
    pub technology_signals: Vec<TechnologySignal>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FaviconData {
    pub href: String,
    pub rel: String,
    pub declared_type: Option<String>,
    pub declared_sizes: Option<String>,
    pub inferred_format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TechnologySignal {
    pub name: String,
    pub category: String,
    pub evidence: String,
    /// `confirmed` means an explicit page/header signal; `heuristic` means an identifying asset pattern.
    pub confidence: String,
    /// Present only when a recognized, explicit declaration exposes a version.
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HreflangTag {
    pub hreflang: String,
    pub href: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContentStats {
    pub word_count: usize,
    pub reading_time_minutes: usize,
    pub text_ratio_percent: f32,
    pub top_keywords: Vec<KeywordStat>,
    /// Deterministic text-complexity indicators; this is not a language model
    /// score and must not be presented as a readability-standard result.
    #[serde(default)]
    pub sentence_count: usize,
    #[serde(default)]
    pub average_words_per_sentence: f32,
    #[serde(default)]
    pub average_characters_per_word: f32,
    #[serde(default)]
    pub complexity_score: u8,
    #[serde(default)]
    pub complexity_label: String,
    /// Deterministic readability heuristic selected from the document language.
    #[serde(default)]
    pub readability_ease_score: f32,
    #[serde(default)]
    pub readability_grade: f32,
    /// Identifier of the deterministic readability formula used for this document.
    /// Older audit records omit this value and deserialize to `unavailable`.
    #[serde(default = "default_readability_method")]
    pub readability_method: String,
    #[serde(default)]
    pub readability_label: String,
    /// Normalized visible body text used for deterministic, local keyphrase analysis.
    /// Kept deliberately separate from source HTML so reports do not retain scripts or markup.
    #[serde(default)]
    pub body_text: String,
    /// True when `body_text` was capped to protect local project storage.
    #[serde(default)]
    pub body_text_truncated: bool,
}

fn default_readability_method() -> String {
    "unavailable".to_string()
}

impl Default for ContentStats {
    fn default() -> Self {
        Self {
            word_count: 0,
            reading_time_minutes: 0,
            text_ratio_percent: 0.0,
            top_keywords: Vec::new(),
            sentence_count: 0,
            average_words_per_sentence: 0.0,
            average_characters_per_word: 0.0,
            complexity_score: 0,
            complexity_label: "unavailable".to_string(),
            readability_ease_score: 0.0,
            readability_grade: 0.0,
            readability_method: "unavailable".to_string(),
            readability_label: "unavailable".to_string(),
            body_text: String::new(),
            body_text_truncated: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KeywordStat {
    pub keyword: String,
    pub count: usize,
    /// Share of normalized body-word tokens, rounded to two decimal places.
    #[serde(default)]
    pub density_percent: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IndexabilityAssessment {
    /// `indexable`, `blocked`, or `uncertain`; this is a deterministic local assessment.
    pub status: String,
    pub reasons: Vec<String>,
    pub meta_robots: Option<String>,
    pub x_robots_tag: Option<String>,
    pub canonical: Option<String>,
    pub canonical_matches_final_url: Option<bool>,
    #[serde(default)]
    pub canonical_target_checked: bool,
    #[serde(default)]
    pub canonical_target_status: Option<u16>,
    #[serde(default)]
    pub canonical_target_check_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct AccessibilityAudit {
    pub document_language: Option<String>,
    pub landmarks: Vec<AccessibilityLandmark>,
    pub aria_attribute_count: usize,
    pub form_control_count: usize,
    pub unlabeled_form_control_count: usize,
    #[serde(default)]
    pub hidden_form_control_count: usize,
    #[serde(default)]
    pub hidden_form_controls: Vec<AccessibilityElementEvidence>,
    /// Explicitly marked text honeypots are not user-facing form controls and must retain `type=text`.
    #[serde(default)]
    pub anti_spam_text_control_count: usize,
    #[serde(default)]
    pub anti_spam_text_controls: Vec<AccessibilityElementEvidence>,
    #[serde(default)]
    pub findings: Vec<AccessibilityFinding>,
    /// Checks that need a rendered browser and are deliberately not inferred from static HTML.
    pub manual_review_items: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccessibilityFinding {
    pub code: String,
    pub severity: String,
    pub message: String,
    pub evidence: String,
    pub recommendation: String,
    #[serde(default)]
    pub elements: Vec<AccessibilityElementEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccessibilityElementEvidence {
    /// One-based position among the nodes returned by the finding's selector.
    pub dom_position: usize,
    /// Browser-console locator for a DOM matching the audited source snapshot.
    pub dom_query: String,
    /// Sanitized outer HTML with value and unapproved attributes omitted.
    pub html_snippet: String,
    /// One-based source position when the control can be matched in the fetched HTML.
    #[serde(default)]
    pub line: Option<usize>,
    #[serde(default)]
    pub column: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccessibilityLandmark {
    pub name: String,
    pub count: usize,
}

impl Default for IndexabilityAssessment {
    fn default() -> Self {
        Self {
            status: "uncertain".to_string(),
            reasons: Vec::new(),
            meta_robots: None,
            x_robots_tag: None,
            canonical: None,
            canonical_matches_final_url: None,
            canonical_target_checked: false,
            canonical_target_status: None,
            canonical_target_check_error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Issue {
    pub severity: IssueSeverity,
    pub category: IssueCategory,
    /// Stable identifier used by the desktop UI to localize persisted findings.
    /// Older audit records omit this field and are rendered from their legacy
    /// message/recommendation values.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// Interpolation values for the localized message/recommendation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<BTreeMap<String, String>>,
    pub message: String,
    pub recommendation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum IssueSeverity {
    Critical,
    Warning,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum IssueCategory {
    MetaTags,
    OpenGraph,
    TwitterCard,
    Headings,
    Images,
    Links,
    Security,
    Performance,
    Technical,
    StructuredData,
}
