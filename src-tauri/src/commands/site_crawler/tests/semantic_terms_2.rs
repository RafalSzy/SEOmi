use super::*;

#[test]
fn semantic_term_key_matches_the_semantic_map_rules() {
    // Same fixtures as tests/semanticText.test.ts: both sides must agree.
    let key = semantic_term_key("szkolenie", Some("pl"));
    for form in [
        "szkolenia",
        "szkoleń",
        "szkoleniach",
        "szkoleniem",
        "szkoleniami",
    ] {
        assert_eq!(semantic_term_key(form, Some("pl")), key, "{form}");
    }
    assert_eq!(
        semantic_term_key("firmie", Some("pl-PL")),
        semantic_term_key("firmy", Some("pl"))
    );
    assert_eq!(
        semantic_term_key("klientów", Some("pl")),
        semantic_term_key("klientom", Some("pl"))
    );
    assert_eq!(
        semantic_term_key("navigatora", Some("pl")),
        semantic_term_key("navigator", Some("pl"))
    );
    assert_eq!(semantic_term_key("rola", Some("pl")), "rola");
    assert_eq!(
        semantic_term_key("companies", Some("en")),
        semantic_term_key("company", Some("en"))
    );
    assert_eq!(
        semantic_term_key("accounts", Some("en-GB")),
        semantic_term_key("account", Some("en"))
    );
    assert_eq!(semantic_term_key("sales", Some("en")), "sales");
    assert_eq!(semantic_term_key("business", Some("en")), "business");
    assert_eq!(semantic_term_key("Szkolenia", None), "szkolenia");
    assert_eq!(semantic_term_key("Żółć", None), "zolc");
}

#[test]
fn semantic_terms_are_only_extracted_for_successful_or_unknown_status() {
    for status in [0, 200, 203, 299] {
        assert!(semantic_status_is_topical(status), "{status}");
    }
    for status in [100, 301, 304, 404, 410, 500, 503] {
        assert!(!semantic_status_is_topical(status), "{status}");
    }
}

#[test]
fn shared_stopword_list_keeps_every_word_the_crawler_filtered_before() {
    const PREVIOUS: &[&str] = &[
        "the", "and", "for", "with", "from", "that", "this", "your", "you", "are", "was", "have",
        "has", "will", "into", "about", "our", "their", "they", "what", "when", "where", "which",
        "who", "how", "can", "not", "but", "all", "one", "more", "use", "now", "get", "theirs",
        "www", "http", "https", "oraz", "jest", "się", "dla", "nie", "jak", "który", "która",
        "które", "przez", "aby", "ten", "tej", "jego", "jej", "czy", "lub", "bez", "nad", "pod",
        "przy", "tym", "także", "może", "mogą",
    ];
    for word in PREVIOUS {
        assert!(semantic_noise_token(&fold_semantic_text(word)), "{word}");
    }
}
