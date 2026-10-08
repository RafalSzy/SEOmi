use super::session::{receive_code, CredentialReadError, CredentialStore, NativeCredentialStore};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::{timeout, Duration},
};

#[test]
fn native_store_rejects_unsupported_names_before_keyring_io() {
    let store = NativeCredentialStore;
    assert!(matches!(
        store.read("unsupported-search-console-key"),
        Err(CredentialReadError::Store(_))
    ));
    assert!(store
        .write("unsupported-search-console-key", "synthetic-token")
        .is_err());
}

#[tokio::test]
async fn receive_code_wrapper_returns_verified_callback_code() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let callback = tokio::spawn(async move { receive_code(listener, "state-fixture").await });
    let mut stream = TcpStream::connect(address).await.unwrap();
    stream
        .write_all(
            b"GET /oauth2callback?state=state-fixture&code=fixture-code HTTP/1.1\r\nHost: localhost\r\n\r\n",
        )
        .await
        .unwrap();
    let mut response = Vec::new();
    timeout(Duration::from_secs(1), stream.read_to_end(&mut response))
        .await
        .unwrap()
        .unwrap();
    assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 200 OK"));
    assert_eq!(callback.await.unwrap().unwrap(), "fixture-code");
}
