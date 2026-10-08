use super::{capture_window_artifact, native_webview_runtime, renderer_platform};
use crate::commands::rendered_crawler::RenderedArtifactKind;
use crate::utils::test_app::StorageApp;
use tauri::{test::mock_builder, WebviewWindowBuilder};

#[test]
fn renderer_platform_identifies_current_target() {
    let platform = renderer_platform();
    assert!(!platform.is_empty());
    #[cfg(target_os = "macos")]
    assert_eq!(platform, "macos-wkwebview");
    #[cfg(target_os = "windows")]
    assert_eq!(platform, "windows-webview2");
}

#[test]
fn native_webview_runtime_distinguishes_wry_and_mock() {
    assert!(native_webview_runtime::<tauri::Wry>());
    assert!(!native_webview_runtime::<tauri::test::MockRuntime>());
}

#[tokio::test]
async fn capture_window_artifact_rejects_mock_runtime_for_all_kinds() {
    let app = StorageApp::new(mock_builder());
    let window = WebviewWindowBuilder::new(&app.app, "artifact-mock", Default::default())
        .build()
        .unwrap();

    let screenshot_err = capture_window_artifact(&window, RenderedArtifactKind::Screenshot)
        .await
        .unwrap_err();
    assert_eq!(
        screenshot_err,
        "Rendered artifact capture requires the native Wry runtime."
    );

    let pdf_err = capture_window_artifact(&window, RenderedArtifactKind::Pdf)
        .await
        .unwrap_err();
    assert_eq!(
        pdf_err,
        "Rendered artifact capture requires the native Wry runtime."
    );
}

#[cfg(target_os = "macos")]
#[test]
fn macos_ns_data_bytes_converts_empty_and_populated_buffers() {
    use super::macos::ns_data_bytes;
    use objc2_foundation::NSData;

    let empty = NSData::new();
    assert!(ns_data_bytes(&empty).is_empty());

    let payload = b"hello rendered media";
    let data = NSData::with_bytes(payload);
    assert_eq!(ns_data_bytes(&data), payload);
}

#[cfg(target_os = "macos")]
#[tokio::test]
async fn macos_send_artifact_result_delivers_and_ignores_subsequent() {
    use super::macos::send_artifact_result;
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;

    let (sender, receiver) = oneshot::channel();
    let container = Arc::new(Mutex::new(Some(sender)));

    send_artifact_result(&container, Ok(vec![1, 2, 3]));
    let received = receiver.await.unwrap();
    assert_eq!(received.unwrap(), vec![1, 2, 3]);

    // Subsequent sends are safely ignored because the sender was consumed.
    send_artifact_result(&container, Err("late error".into()));

    // Sending into an already empty container does nothing.
    let empty_container = Arc::new(Mutex::new(None));
    send_artifact_result(&empty_container, Ok(vec![4]));
}
