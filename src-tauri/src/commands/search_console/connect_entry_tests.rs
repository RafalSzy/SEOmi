use super::connect::oauth_request;
use std::collections::HashMap;

#[test]
fn oauth_request_contains_pkce_and_local_callback_contract() {
    let (redirect_uri, state, verifier, url) =
        oauth_request("fixture.apps.googleusercontent.com", 43127).unwrap();
    assert_eq!(redirect_uri, "http://127.0.0.1:43127/oauth2callback");
    assert_eq!(state.len(), 32);
    assert_eq!(verifier.len(), 64);
    let query = url.query_pairs().into_owned().collect::<HashMap<_, _>>();
    assert_eq!(query["client_id"], "fixture.apps.googleusercontent.com");
    assert_eq!(query["redirect_uri"], redirect_uri);
    assert_eq!(query["response_type"], "code");
    assert_eq!(
        query["scope"],
        "https://www.googleapis.com/auth/webmasters.readonly"
    );
    assert_eq!(query["state"], state);
    assert_eq!(query["code_challenge_method"], "S256");
    assert_eq!(query["access_type"], "offline");
    assert_eq!(query["prompt"], "consent");
    assert_eq!(query["code_challenge"].len(), 43);
}
