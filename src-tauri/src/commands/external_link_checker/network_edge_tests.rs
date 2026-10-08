use super::{checked_public_addresses, normalize_external_url};
use std::net::IpAddr;
use url::Url;

#[tokio::test]
async fn dns_failures_are_reported_without_fabricating_addresses() {
    let url = Url::parse("https://seomi-invalid-host.invalid/").unwrap();
    let error = checked_public_addresses(&url).await.unwrap_err();
    assert!(
        error.starts_with("DNS lookup failed:") || error == "DNS returned no addresses",
        "unexpected DNS result: {error}"
    );
}

#[test]
fn normalization_removes_fragments_and_keeps_public_ip_literals() {
    let url = normalize_external_url("https://8.8.8.8/path#private-fragment").unwrap();
    assert_eq!(url.fragment(), None);
    assert_eq!(
        url.host(),
        Some(url::Host::Ipv4("8.8.8.8".parse().unwrap()))
    );
    assert!(matches!(url.host(), Some(url::Host::Ipv4(ip)) if IpAddr::V4(ip).is_ipv4()));
}
