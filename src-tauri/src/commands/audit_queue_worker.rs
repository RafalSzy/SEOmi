//! Headless execution for a persisted CSV/page-audit queue.
//!
//! The foreground queue remains the source of truth for user-visible state.
//! When the desktop process is closed, the OS wake-up starts this worker. It
//! resumes only a stale run, updates the durable queue after every URL, and
//! stores each successful page audit as an individually acknowledgeable
//! result so a large queue cannot be lost in one oversized handoff file.

use super::{audit_queue, crawl_storage, scheduler, seo_audit};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::io::ErrorKind;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use tauri::AppHandle;

const MAX_QUEUE_ITEMS: usize = 50_000;
const QUEUE_STALE_AFTER: ChronoDuration = ChronoDuration::minutes(5);
const LOCK_STALE_AFTER: Duration = Duration::from_secs(2 * 60 * 60);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueueItem {
    id: String,
    url: String,
    status: String,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    attempts: Option<u32>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueueRun {
    id: String,
    status: String,
    started_at: String,
    updated_at: String,
    #[serde(default)]
    active_item_id: Option<String>,
    #[serde(default)]
    last_error: Option<String>,
    #[serde(default)]
    stop_requested: bool,
    #[serde(default)]
    user_agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueueSnapshot {
    items: Vec<QueueItem>,
    #[serde(default)]
    run: Option<QueueRun>,
}

struct QueueLock {
    _file: File,
    path: PathBuf,
}

impl Drop for QueueLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn parse_snapshot(value: Value) -> Result<QueueSnapshot, String> {
    let snapshot: QueueSnapshot = serde_json::from_value(value)
        .map_err(|error| format!("Saved audit queue is invalid: {error}"))?;
    if snapshot.items.len() > MAX_QUEUE_ITEMS {
        return Err("Saved audit queue exceeds the item safety limit.".into());
    }
    if snapshot.items.iter().any(|item| {
        !valid_identifier(&item.id)
            || item.url.trim().is_empty()
            || !matches!(
                item.status.as_str(),
                "queued" | "running" | "interrupted" | "completed" | "failed"
            )
    }) {
        return Err("Saved audit queue contains an invalid item.".into());
    }
    if let Some(run) = &snapshot.run {
        if !valid_identifier(&run.id)
            || !matches!(
                run.status.as_str(),
                "running" | "interrupted" | "stopped" | "completed"
            )
        {
            return Err("Saved audit queue contains an invalid run.".into());
        }
        DateTime::parse_from_rfc3339(&run.updated_at)
            .map_err(|_| "Saved audit queue run has an invalid update timestamp.")?;
    }
    Ok(snapshot)
}

fn acquire_lock(path: &std::path::Path) -> Result<Option<QueueLock>, String> {
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(file) => Ok(Some(QueueLock {
            _file: file,
            path: path.to_path_buf(),
        })),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            let stale = fs::metadata(path)
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| SystemTime::now().duration_since(modified).ok())
                .is_some_and(|age| age > LOCK_STALE_AFTER);
            if stale {
                let _ = fs::remove_file(path);
                return acquire_lock(path);
            }
            Ok(None)
        }
        Err(error) => Err(format!("Unable to acquire audit queue lock: {error}")),
    }
}

fn queue_is_stale(run: &QueueRun, now: DateTime<Utc>) -> Result<bool, String> {
    let updated = DateTime::parse_from_rfc3339(&run.updated_at)
        .map_err(|_| "Saved audit queue run has an invalid update timestamp.")?
        .with_timezone(&Utc);
    Ok(updated <= now - QUEUE_STALE_AFTER)
}

fn queue_has_pending_items(items: &[QueueItem]) -> bool {
    items.iter().any(|item| {
        matches!(
            item.status.as_str(),
            "queued" | "running" | "interrupted" | "failed"
        )
    })
}

fn stop_requested_for_run(snapshot: &QueueSnapshot, run_id: &str) -> bool {
    snapshot
        .run
        .as_ref()
        .is_some_and(|run| run.id == run_id && run.stop_requested)
}

fn queue_value(snapshot: &QueueSnapshot) -> Result<Value, String> {
    serde_json::to_value(snapshot)
        .map_err(|error| format!("Unable to serialize audit queue: {error}"))
}

/// Execute one stale queue run. The OS scheduler supplies only opaque IDs;
/// all URLs and state are loaded from the project-scoped native snapshot.
pub async fn run_audit_queue(
    app: AppHandle,
    project_id: String,
    run_id: String,
) -> Result<(), String> {
    if !valid_identifier(&project_id) || !valid_identifier(&run_id) {
        return Err("Invalid project or queue run identifier.".into());
    }
    let Some(raw_snapshot) = audit_queue::read_queue_snapshot(&app, &project_id)? else {
        return Ok(());
    };
    let mut snapshot = parse_snapshot(raw_snapshot)?;
    let Some(mut run) = snapshot.run.clone() else {
        return Ok(());
    };
    if run.id != run_id || matches!(run.status.as_str(), "completed" | "stopped") {
        return Ok(());
    }
    if run.stop_requested || !queue_is_stale(&run, Utc::now())? {
        return Ok(());
    }

    let project_dir = crawl_storage::project_directory(&app, &project_id)?;
    fs::create_dir_all(&project_dir)
        .map_err(|error| format!("Unable to create audit queue directory: {error}"))?;
    let lock_path = project_dir.join(format!("audit_queue_execution_{run_id}.lock"));
    let Some(_lock) = acquire_lock(&lock_path)? else {
        return Ok(());
    };

    let started_at = Utc::now();
    run.status = "running".into();
    run.updated_at = started_at.to_rfc3339();
    run.stop_requested = false;
    snapshot.run = Some(run.clone());
    audit_queue::write_queue_snapshot(&app, &project_id, &queue_value(&snapshot)?)?;

    let mut first_error: Option<String> = None;
    for item_index in 0..snapshot.items.len() {
        // The foreground UI can request a stop while this process is working
        // on a URL. Re-read the durable snapshot before starting the next
        // item so the headless worker honours that request instead of
        // consuming the entire queue after the user has stopped it.
        if let Some(raw_snapshot) = audit_queue::read_queue_snapshot(&app, &project_id)? {
            let current_snapshot = parse_snapshot(raw_snapshot)?;
            if stop_requested_for_run(&current_snapshot, &run_id) {
                snapshot = current_snapshot;
                let stopped_at = Utc::now().to_rfc3339();
                for item in &mut snapshot.items {
                    if item.status == "running" {
                        item.status = "interrupted".into();
                        item.updated_at = Some(stopped_at.clone());
                    }
                }
                run.status = "stopped".into();
                run.active_item_id = None;
                run.stop_requested = true;
                run.updated_at = stopped_at.clone();
                snapshot.run = Some(run.clone());
                audit_queue::write_queue_snapshot(&app, &project_id, &queue_value(&snapshot)?)?;
                let execution = json!({
                    "projectId": project_id,
                    "runId": run_id,
                    "completedAt": stopped_at,
                    "succeeded": first_error.is_none(),
                    "stopped": true,
                    "error": first_error,
                });
                audit_queue::write_queue_execution(&app, &project_id, &run.id, &execution)?;
                let _ = scheduler::unregister_audit_queue_wakeup(project_id, run.id);
                return Ok(());
            }
        }
        if !matches!(
            snapshot.items[item_index].status.as_str(),
            "queued" | "running" | "interrupted" | "failed"
        ) {
            continue;
        }
        let item_id = snapshot.items[item_index].id.clone();
        let url = snapshot.items[item_index].url.clone();
        let now = Utc::now().to_rfc3339();
        snapshot.items[item_index].status = "running".into();
        snapshot.items[item_index].attempts =
            Some(snapshot.items[item_index].attempts.unwrap_or(0) + 1);
        snapshot.items[item_index].updated_at = Some(now.clone());
        snapshot.items[item_index].error = None;
        run.active_item_id = Some(item_id.clone());
        run.updated_at = now;
        snapshot.run = Some(run.clone());
        audit_queue::write_queue_snapshot(&app, &project_id, &queue_value(&snapshot)?)?;

        match seo_audit::inspect_url_headless(&url, run.user_agent.as_deref(), 15).await {
            Ok(audit) => {
                let result = json!({
                    "runId": run_id,
                    "itemId": item_id,
                    "audit": audit,
                });
                if let Err(error) =
                    audit_queue::write_queue_result(&app, &project_id, &run_id, &item_id, &result)
                {
                    first_error.get_or_insert(error.clone());
                    snapshot.items[item_index].status = "failed".into();
                    snapshot.items[item_index].error = Some(error);
                } else {
                    snapshot.items[item_index].status = "completed".into();
                    snapshot.items[item_index].completed_at = Some(Utc::now().to_rfc3339());
                    snapshot.items[item_index].error = None;
                }
            }
            Err(error) => {
                first_error.get_or_insert(error.clone());
                snapshot.items[item_index].status = "failed".into();
                snapshot.items[item_index].error = Some(error.chars().take(500).collect());
            }
        }
        snapshot.items[item_index].updated_at = Some(Utc::now().to_rfc3339());
        run.active_item_id = None;
        run.updated_at = Utc::now().to_rfc3339();
        run.last_error = first_error.clone();
        snapshot.run = Some(run.clone());
        audit_queue::write_queue_snapshot(&app, &project_id, &queue_value(&snapshot)?)?;
    }

    let completed_at = Utc::now();
    let has_pending = queue_has_pending_items(&snapshot.items);
    run.status = if has_pending { "stopped" } else { "completed" }.into();
    run.active_item_id = None;
    run.updated_at = completed_at.to_rfc3339();
    run.last_error = first_error.clone();
    snapshot.run = Some(run.clone());
    audit_queue::write_queue_snapshot(&app, &project_id, &queue_value(&snapshot)?)?;
    let execution = json!({
        "projectId": project_id,
        "runId": run_id,
        "startedAt": started_at.to_rfc3339(),
        "completedAt": completed_at.to_rfc3339(),
        "succeeded": first_error.is_none(),
        "error": first_error,
    });
    audit_queue::write_queue_execution(&app, &project_id, &run.id, &execution)?;
    let _ = scheduler::unregister_audit_queue_wakeup(project_id, run.id);
    Ok(())
}

pub fn headless_launch_context() -> Option<(String, String)> {
    let args = std::env::args().collect::<Vec<_>>();
    if !args
        .iter()
        .any(|value| value == "--seomi-audit-queue-headless")
    {
        return None;
    }
    let value_after = |flag: &str| {
        args.windows(2)
            .find(|pair| pair[0] == flag)
            .map(|pair| pair[1].clone())
            .filter(|value| valid_identifier(value))
    };
    Some((
        value_after("--seomi-scheduled-project")?,
        value_after("--seomi-scheduled-id")?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_malformed_queue_items() {
        let value = json!({
            "items": [{ "id": "item-1", "url": "", "status": "queued" }],
            "run": null
        });
        assert!(parse_snapshot(value).is_err());
    }

    #[test]
    fn only_stale_runs_are_eligible_for_headless_resume() {
        let now = Utc::now();
        let run = QueueRun {
            id: "run-1".into(),
            status: "running".into(),
            started_at: now.to_rfc3339(),
            updated_at: (now - ChronoDuration::minutes(6)).to_rfc3339(),
            active_item_id: None,
            last_error: None,
            stop_requested: false,
            user_agent: None,
        };
        assert!(queue_is_stale(&run, now).unwrap());
    }

    #[test]
    fn completed_items_are_not_pending() {
        let items = vec![QueueItem {
            id: "item-1".into(),
            url: "https://example.test".into(),
            status: "completed".into(),
            error: None,
            attempts: Some(1),
            updated_at: None,
            completed_at: None,
        }];
        assert!(!queue_has_pending_items(&items));
    }

    #[test]
    fn detects_stop_request_only_for_matching_run() {
        let snapshot = QueueSnapshot {
            items: Vec::new(),
            run: Some(QueueRun {
                id: "run-1".into(),
                status: "running".into(),
                started_at: "2026-01-01T00:00:00Z".into(),
                updated_at: "2026-01-01T00:00:00Z".into(),
                active_item_id: None,
                last_error: None,
                stop_requested: true,
                user_agent: None,
            }),
        };
        assert!(stop_requested_for_run(&snapshot, "run-1"));
        assert!(!stop_requested_for_run(&snapshot, "run-2"));
    }
}
