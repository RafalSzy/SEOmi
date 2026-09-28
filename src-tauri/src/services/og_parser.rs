use crate::models::audit_data::{MetaTag, OpenGraphData, TwitterCardData};
use scraper::{Html, Selector};
use url::Url;

pub struct SocialTagsResult {
    pub open_graph: OpenGraphData,
    pub twitter_card: TwitterCardData,
}

/// Extracts Open Graph and Twitter Card tags with fallback logic
pub fn parse_social_tags(
    html_str: &str,
    base_url: &str,
    page_title: Option<&str>,
    page_description: Option<&str>,
) -> SocialTagsResult {
    let document = Html::parse_document(html_str);
    let parsed_base = Url::parse(base_url).ok();

    let mut og_tags = Vec::new();
    let mut twitter_tags = Vec::new();

    let mut og_title = None;
    let mut og_description = None;
    let mut og_image = None;
    let mut og_image_width = None;
    let mut og_image_height = None;
    let mut og_url = None;
    let mut og_type = None;
    let mut og_site_name = None;
    let mut og_locale = None;

    let mut twitter_card = None;
    let mut twitter_site = None;
    let mut twitter_creator = None;
    let mut twitter_title = None;
    let mut twitter_description = None;
    let mut twitter_image = None;

    let meta_selector = Selector::parse("meta").unwrap();

    for el in document.select(&meta_selector) {
        let property = el.value().attr("property").map(|s| s.trim().to_string());
        let name = el.value().attr("name").map(|s| s.trim().to_string());
        let content = el.value().attr("content").unwrap_or("").trim().to_string();

        if content.is_empty() && property.is_none() && name.is_none() {
            continue;
        }

        // Open Graph extraction (usually under 'property', sometimes 'name')
        let prop_lower = property.as_deref().unwrap_or("").to_lowercase();
        let name_lower = name.as_deref().unwrap_or("").to_lowercase();

        let key = if prop_lower.starts_with("og:") {
            prop_lower.as_str()
        } else if name_lower.starts_with("og:") {
            name_lower.as_str()
        } else {
            ""
        };

        if !key.is_empty() {
            og_tags.push(MetaTag {
                name: name.clone(),
                property: property.clone(),
                content: content.clone(),
            });

            match key {
                "og:title" => og_title = Some(content.clone()),
                "og:description" => og_description = Some(content.clone()),
                "og:image" | "og:image:url" => {
                    if og_image.is_none() {
                        og_image = Some(resolve_url(&content, parsed_base.as_ref()));
                    }
                }
                "og:image:width" => og_image_width = Some(content.clone()),
                "og:image:height" => og_image_height = Some(content.clone()),
                "og:url" => og_url = Some(resolve_url(&content, parsed_base.as_ref())),
                "og:type" => og_type = Some(content.clone()),
                "og:site_name" => og_site_name = Some(content.clone()),
                "og:locale" => og_locale = Some(content.clone()),
                _ => {}
            }
        }

        // Twitter Cards extraction (usually under 'name', sometimes 'property')
        let tw_key = if name_lower.starts_with("twitter:") {
            name_lower.as_str()
        } else if prop_lower.starts_with("twitter:") {
            prop_lower.as_str()
        } else {
            ""
        };

        if !tw_key.is_empty() {
            twitter_tags.push(MetaTag {
                name: name.clone(),
                property: property.clone(),
                content: content.clone(),
            });

            match tw_key {
                "twitter:card" => twitter_card = Some(content.clone()),
                "twitter:site" => twitter_site = Some(content.clone()),
                "twitter:creator" => twitter_creator = Some(content.clone()),
                "twitter:title" => twitter_title = Some(content.clone()),
                "twitter:description" => twitter_description = Some(content.clone()),
                "twitter:image" | "twitter:image:src" if twitter_image.is_none() => {
                    twitter_image = Some(resolve_url(&content, parsed_base.as_ref()));
                }
                _ => {}
            }
        }
    }

    // Apply smart fallbacks
    let final_og_title = og_title.or_else(|| page_title.map(|s| s.to_string()));
    let final_og_desc = og_description.or_else(|| page_description.map(|s| s.to_string()));

    let final_tw_title = twitter_title
        .or_else(|| final_og_title.clone())
        .or_else(|| page_title.map(|s| s.to_string()));
    let final_tw_desc = twitter_description
        .or_else(|| final_og_desc.clone())
        .or_else(|| page_description.map(|s| s.to_string()));
    let final_tw_image = twitter_image.or_else(|| og_image.clone());

    SocialTagsResult {
        open_graph: OpenGraphData {
            og_title: final_og_title,
            og_description: final_og_desc,
            og_image,
            og_image_width,
            og_image_height,
            og_url,
            og_type,
            og_site_name,
            og_locale,
            all_tags: og_tags,
        },
        twitter_card: TwitterCardData {
            twitter_card,
            twitter_site,
            twitter_creator,
            twitter_title: final_tw_title,
            twitter_description: final_tw_desc,
            twitter_image: final_tw_image,
            all_tags: twitter_tags,
        },
    }
}

fn resolve_url(href: &str, base: Option<&Url>) -> String {
    if let Some(base_url) = base {
        if let Ok(joined) = base_url.join(href) {
            return joined.to_string();
        }
    }
    href.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_SOCIAL_HTML: &str = r#"
    <!DOCTYPE html>
    <html>
      <head>
        <title>Default Page Title</title>
        <meta name="description" content="Default meta description">
        <meta property="og:title" content="Open Graph Title">
        <meta property="og:description" content="Open Graph Description">
        <meta property="og:image" content="/images/og-banner.png">
        <meta property="og:image:width" content="1200">
        <meta property="og:image:height" content="630">
        <meta property="og:type" content="website">
        <meta property="og:url" content="https://example.com/item">
        <meta property="og:site_name" content="ExampleSite">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:site" content="@example">
      </head>
      <body></body>
    </html>
    "#;

    #[test]
    fn test_og_tags_extraction() {
        let res = parse_social_tags(
            SAMPLE_SOCIAL_HTML,
            "https://example.com",
            Some("Default Page Title"),
            Some("Default meta description"),
        );

        assert_eq!(
            res.open_graph.og_title,
            Some("Open Graph Title".to_string())
        );
        assert_eq!(
            res.open_graph.og_description,
            Some("Open Graph Description".to_string())
        );
        assert_eq!(
            res.open_graph.og_image,
            Some("https://example.com/images/og-banner.png".to_string())
        );
        assert_eq!(res.open_graph.og_image_width, Some("1200".to_string()));
        assert_eq!(res.open_graph.og_image_height, Some("630".to_string()));
        assert_eq!(res.open_graph.og_type, Some("website".to_string()));
        assert_eq!(res.open_graph.og_site_name, Some("ExampleSite".to_string()));
    }

    #[test]
    fn test_twitter_card_extraction_and_fallback() {
        let res = parse_social_tags(
            SAMPLE_SOCIAL_HTML,
            "https://example.com",
            Some("Default Page Title"),
            Some("Default meta description"),
        );

        assert_eq!(
            res.twitter_card.twitter_card,
            Some("summary_large_image".to_string())
        );
        assert_eq!(res.twitter_card.twitter_site, Some("@example".to_string()));
        // Twitter title and desc should fallback to OG values when absent
        assert_eq!(
            res.twitter_card.twitter_title,
            Some("Open Graph Title".to_string())
        );
        assert_eq!(
            res.twitter_card.twitter_description,
            Some("Open Graph Description".to_string())
        );
        assert_eq!(
            res.twitter_card.twitter_image,
            Some("https://example.com/images/og-banner.png".to_string())
        );
    }

    #[test]
    fn test_social_fallback_to_page_meta_when_no_og() {
        let html_no_social = "<html><head><title>Fallback Title</title></head></html>";
        let res = parse_social_tags(
            html_no_social,
            "https://example.com",
            Some("Fallback Title"),
            Some("Fallback Description"),
        );

        assert_eq!(res.open_graph.og_title, Some("Fallback Title".to_string()));
        assert_eq!(
            res.open_graph.og_description,
            Some("Fallback Description".to_string())
        );
        assert_eq!(
            res.twitter_card.twitter_title,
            Some("Fallback Title".to_string())
        );
    }

    #[test]
    fn test_relative_og_url_resolution() {
        let html = r#"<meta property="og:url" content="/relative-path">"#;
        let res = parse_social_tags(html, "https://example.com/sub/", None, None);
        assert_eq!(
            res.open_graph.og_url,
            Some("https://example.com/relative-path".to_string())
        );
    }

    #[test]
    fn test_empty_social_tags_handled() {
        let html = "<html><body>No meta here</body></html>";
        let res = parse_social_tags(html, "https://example.com", None, None);
        assert!(res.open_graph.og_title.is_none());
        assert!(res.open_graph.all_tags.is_empty());
        assert!(res.twitter_card.all_tags.is_empty());
    }
}
