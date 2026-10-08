use super::*;
use crate::models::config::AppConfig;
use crate::utils::test_app::StorageApp;
use tauri::test::mock_builder;

#[tokio::test]
async fn get_and_save_config_commands_round_trip() {
    let fixture = StorageApp::new(mock_builder());
    let handle = fixture.handle();

    let initial = get_config(handle.clone()).await.unwrap();
    assert_eq!(initial.theme, "dark");
    assert_eq!(initial.language, "en");

    let mut updated = initial.clone();
    updated.theme = "light".into();
    updated.language = "pl".into();
    updated.request_timeout_secs = 30;

    save_config(handle.clone(), updated).await.unwrap();

    let reloaded = get_config(handle.clone()).await.unwrap();
    assert_eq!(reloaded.theme, "light");
    assert_eq!(reloaded.language, "pl");
    assert_eq!(reloaded.request_timeout_secs, 30);
}

#[tokio::test]
async fn save_config_command_validates_before_persisting() {
    let fixture = StorageApp::new(mock_builder());
    let handle = fixture.handle();

    let invalid = AppConfig {
        theme: "unsupported".into(),
        ..AppConfig::default()
    };
    let err = save_config(handle.clone(), invalid).await.unwrap_err();
    assert_eq!(err, "Unsupported configuration theme.");

    let current = get_config(handle).await.unwrap();
    assert_eq!(current.theme, "dark");
}
