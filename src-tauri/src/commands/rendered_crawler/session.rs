use tauri::Runtime;
use tokio::sync::mpsc;

use super::models::CaptureEvent;
use crate::services::browser_proxy::BrowserRequestProxy;

pub struct RenderedCrawlerSession<R: Runtime = tauri::Wry> {
    pub(crate) window: tauri::WebviewWindow<R>,
    pub(crate) proxy: Option<BrowserRequestProxy>,
    pub(crate) receiver: mpsc::Receiver<CaptureEvent>,
    pub(crate) nonce: String,
    pub(crate) requested_url: String,
    pub(crate) base_host: String,
    pub(crate) allow_subdomains: bool,
    pub(crate) scope_path: Option<String>,
}
