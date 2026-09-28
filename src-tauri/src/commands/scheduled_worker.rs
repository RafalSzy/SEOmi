//! Headless desktop execution for OS-triggered project schedules.
//!
//! The WebView is intentionally not part of this path.  The foreground SPA
//! persists a bounded, secret-free task manifest through `save_scheduled_task`;
//! launchd/Task Scheduler starts the same signed binary with only the project
//! and schedule identifiers.  The worker reads the manifest, runs the native
//! audit/crawler, stores a result handoff, and exits.

use super::{crawl_storage, scheduler, seo_audit, site_crawler};
use crate::utils::url_validator::validate_and_normalize_url;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, File, OpenOptions};
use std::io::ErrorKind;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use tauri::AppHandle;

const MAX_IDENTIFIER_LENGTH: usize = 80;
const MAX_RESULT_BYTES: usize = 256 * 1024 * 1024;
const MAX_EXECUTION_BYTES: usize = 256 * 1024;
const SCHEDULE_GRACE_SECONDS: i64 = 90;
const STALE_LOCK_AFTER: Duration = Duration::from_secs(2 * 60 * 60);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskManifest {
    pub schedule_id: String,
    pub url: String,
    pub task_type: String,
    #[serde(default)]
    pub crawl_limit: Option<usize>,
    #[serde(default)]
    pub crawl_config: Option<site_crawler::CrawlConfig>,
    pub interval_hours: u32,
    pub enabled: bool,
    pub status: String,
    pub created_at: String,
    pub next_run_at: String,
    #[serde(default)]
    pub last_started_at: Option<String>,
    #[serde(default)]
    pub last_run_at: Option<String>,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub run_history: Vec<ScheduledTaskExecution>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskExecution {
    pub started_at: String,
    pub completed_at: String,
    pub succeeded: bool,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledExecutionHandoff {
    pub project_id: String,
    pub schedule_id: String,
    pub task_type: String,
    pub started_at: String,
    pub completed_at: String,
    pub succeeded: bool,
    pub next_run_at: String,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub scheduler_error: Option<String>,
    #[serde(default)]
    pub result: Option<Value>,
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_IDENTIFIER_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn validate_project_and_schedule(project_id: &str, schedule_id: &str) -> Result<(), String> {
    if !valid_identifier(project_id) || !valid_identifier(schedule_id) {
        return Err("Invalid project or schedule identifier.".into());
    }
    Ok(())
}

fn validate_manifest(project_id: &str, task: &ScheduledTaskManifest) -> Result<(), String> {
    validate_project_and_schedule(project_id, &task.schedule_id)?;
    if !matches!(task.task_type.as_str(), "page-audit" | "site-crawl") {
        return Err("Unsupported scheduled task type.".into());
    }
    if !matches!(task.interval_hours, 6 | 12 | 24 | 168) {
        return Err("Unsupported scheduled task interval.".into());
    }
    if !matches!(
        task.status.as_str(),
        "scheduled" | "running" | "completed" | "failed" | "paused"
    ) {
        return Err("Unsupported scheduled task status.".into());
    }
    let normalized_url = validate_and_normalize_url(&task.url)
        .map_err(|error| format!("Invalid scheduled URL: {error}"))?;
    if normalized_url.username() != "" || normalized_url.password().is_some() {
        return Err("Scheduled URL cannot contain credentials.".into());
    }
    if task.task_type == "site-crawl" {
        let limit = task.crawl_limit.unwrap_or(25);
        if !(1..=500).contains(&limit) {
            return Err("Scheduled crawl limit must be between 1 and 500 pages.".into());
        }
    }
    DateTime::parse_from_rfc3339(&task.next_run_at)
        .map_err(|_| "Scheduled task next run must be an RFC3339 timestamp.".to_string())?;
    DateTime::parse_from_rfc3339(&task.created_at)
        .map_err(|_| "Scheduled task creation time must be an RFC3339 timestamp.".to_string())?;
    for value in [task.last_started_at.as_deref(), task.last_run_at.as_deref()]
        .into_iter()
        .flatten()
    {
        DateTime::parse_from_rfc3339(value)
            .map_err(|_| "Scheduled task history time must be an RFC3339 timestamp.")?;
    }
    if task.run_history.len() > 20 {
        return Err("Scheduled task history exceeds the safety limit.".into());
    }
    if task.run_history.iter().any(|entry| {
        DateTime::parse_from_rfc3339(&entry.started_at).is_err()
            || DateTime::parse_from_rfc3339(&entry.completed_at).is_err()
            || entry
                .error
                .as_deref()
                .is_some_and(|error| error.len() > 500)
    }) {
        return Err("Scheduled task history contains an invalid entry.".into());
    }
    Ok(())
}

fn task_path(app: &AppHandle, project_id: &str, schedule_id: &str) -> Result<PathBuf, String> {
    validate_project_and_schedule(project_id, schedule_id)?;
    Ok(crawl_storage::project_directory(app, project_id)?
        .join(format!("scheduled_task_{schedule_id}.json")))
}

fn execution_path(app: &AppHandle, project_id: &str, schedule_id: &str) -> Result<PathBuf, String> {
    validate_project_and_schedule(project_id, schedule_id)?;
    Ok(crawl_storage::project_directory(app, project_id)?
        .join(format!("scheduled_execution_{schedule_id}.json")))
}

fn result_path(app: &AppHandle, project_id: &str, schedule_id: &str) -> Result<PathBuf, String> {
    validate_project_and_schedule(project_id, schedule_id)?;
    Ok(crawl_storage::project_directory(app, project_id)?
        .join(format!("scheduled_result_{schedule_id}.json")))
}

fn write_json_atomic(
    path: &std::path::Path,
    value: &Value,
    max_bytes: usize,
) -> Result<(), String> {
    let bytes = serde_json::to_vec(value)
        .map_err(|error| format!("Unable to serialize scheduled data: {error}"))?;
    if bytes.len() > max_bytes {
        return Err(format!(
            "Scheduled data exceeds the {max_bytes}-byte safety limit."
        ));
    }
    let directory = path
        .parent()
        .ok_or_else(|| "Scheduled data path has no parent directory.".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Unable to create scheduled task directory: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    if let Err(error) = fs::write(&temporary, bytes) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Unable to write scheduled data: {error}"));
    }
    if let Err(error) = crawl_storage::replace_file(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Unable to finalize scheduled data: {error}"));
    }
    Ok(())
}

fn read_json<T: for<'de> Deserialize<'de>>(
    path: &PathBuf,
    max_bytes: usize,
) -> Result<Option<T>, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Unable to read scheduled data: {error}")),
    };
    if bytes.len() > max_bytes {
        return Err("Scheduled data exceeds the safety limit.".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| format!("Scheduled data is invalid: {error}"))
}

/// Persist a task before registering its OS wake-up. The manifest never
/// contains credentials; request-profile values remain in the system store.
#[tauri::command]
pub fn save_scheduled_task(
    app: AppHandle,
    project_id: String,
    task: ScheduledTaskManifest,
) -> Result<(), String> {
    validate_manifest(&project_id, &task)?;
    let path = task_path(&app, &project_id, &task.schedule_id)?;
    write_json_atomic(
        &path,
        &serde_json::to_value(task).map_err(|error| error.to_string())?,
        MAX_EXECUTION_BYTES,
    )
}

#[tauri::command]
pub fn delete_scheduled_task(
    app: AppHandle,
    project_id: String,
    schedule_id: String,
) -> Result<(), String> {
    let task = task_path(&app, &project_id, &schedule_id)?;
    let execution = execution_path(&app, &project_id, &schedule_id)?;
    let result = result_path(&app, &project_id, &schedule_id)?;
    for path in [task, execution, result] {
        if let Err(error) = fs::remove_file(path) {
            if error.kind() != ErrorKind::NotFound {
                return Err(format!("Unable to remove scheduled task data: {error}"));
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn load_scheduled_execution(
    app: AppHandle,
    project_id: String,
    schedule_id: String,
) -> Result<Option<ScheduledExecutionHandoff>, String> {
    let metadata_path = execution_path(&app, &project_id, &schedule_id)?;
    let Some(mut handoff) =
        read_json::<ScheduledExecutionHandoff>(&metadata_path, MAX_EXECUTION_BYTES)?
    else {
        return Ok(None);
    };
    let result_file = result_path(&app, &project_id, &schedule_id)?;
    if handoff.succeeded {
        handoff.result = read_json::<Value>(&result_file, MAX_RESULT_BYTES)?;
    }
    Ok(Some(handoff))
}

#[tauri::command]
pub fn list_scheduled_executions(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<ScheduledExecutionHandoff>, String> {
    if !valid_identifier(&project_id) {
        return Err("Invalid project identifier.".into());
    }
    let directory = crawl_storage::project_directory(&app, &project_id)?;
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Unable to list scheduled executions: {error}")),
    };
    let mut handoffs = Vec::new();
    for entry in entries {
        let path = entry
            .map_err(|error| format!("Unable to read scheduled execution entry: {error}"))?
            .path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with("scheduled_execution_") || !name.ends_with(".json") {
            continue;
        }
        if let Some(mut handoff) =
            read_json::<ScheduledExecutionHandoff>(&path, MAX_EXECUTION_BYTES)?
        {
            let result_file = result_path(&app, &project_id, &handoff.schedule_id)?;
            if handoff.succeeded {
                handoff.result = read_json::<Value>(&result_file, MAX_RESULT_BYTES)?;
            }
            handoffs.push(handoff);
        }
    }
    handoffs.sort_by(|left, right| right.completed_at.cmp(&left.completed_at));
    handoffs.truncate(20);
    Ok(handoffs)
}

#[tauri::command]
pub fn acknowledge_scheduled_execution(
    app: AppHandle,
    project_id: String,
    schedule_id: String,
) -> Result<(), String> {
    let metadata_path = execution_path(&app, &project_id, &schedule_id)?;
    let result_file = result_path(&app, &project_id, &schedule_id)?;
    for path in [metadata_path, result_file] {
        if let Err(error) = fs::remove_file(path) {
            if error.kind() != ErrorKind::NotFound {
                return Err(format!(
                    "Unable to acknowledge scheduled execution: {error}"
                ));
            }
        }
    }
    Ok(())
}

fn now_is_due(next_run_at: &str, now: DateTime<Utc>) -> Result<bool, String> {
    let next = DateTime::parse_from_rfc3339(next_run_at)
        .map_err(|_| "Scheduled task next run must be an RFC3339 timestamp.".to_string())?
        .with_timezone(&Utc);
    Ok(next <= now + ChronoDuration::seconds(SCHEDULE_GRACE_SECONDS))
}

fn append_execution(task: &mut ScheduledTaskManifest, execution: &ScheduledTaskExecution) {
    task.run_history.push(execution.clone());
    if task.run_history.len() > 20 {
        let remove = task.run_history.len() - 20;
        task.run_history.drain(0..remove);
    }
}

/// Apply the outcome to the most recent persisted manifest. Keeping this
/// transition in one place is important because the foreground UI may pause
/// or edit a schedule while the headless worker is still fetching its URL.
fn finalize_task(
    task: &mut ScheduledTaskManifest,
    execution: ScheduledTaskExecution,
    succeeded: bool,
) -> Result<String, String> {
    let completed_at = DateTime::parse_from_rfc3339(&execution.completed_at)
        .map_err(|_| "Scheduled task completion time must be an RFC3339 timestamp.")?
        .with_timezone(&Utc);
    let next_run_at =
        (completed_at + ChronoDuration::hours(i64::from(task.interval_hours))).to_rfc3339();
    task.status = if task.enabled {
        if succeeded {
            "completed"
        } else {
            "failed"
        }
    } else {
        "paused"
    }
    .into();
    task.last_run_at = Some(execution.completed_at.clone());
    task.next_run_at = next_run_at.clone();
    task.last_error = execution.error.clone();
    append_execution(task, &execution);
    Ok(next_run_at)
}

fn acquire_scheduled_lock(path: &std::path::Path) -> Result<Option<ScheduledLock>, String> {
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(file) => Ok(Some(ScheduledLock {
            _file: file,
            path: path.to_path_buf(),
        })),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            let stale = fs::metadata(path)
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| SystemTime::now().duration_since(modified).ok())
                .is_some_and(|age| age > STALE_LOCK_AFTER);
            if stale {
                let _ = fs::remove_file(path);
                return acquire_scheduled_lock(path);
            }
            Ok(None)
        }
        Err(error) => Err(format!("Unable to acquire scheduled task lock: {error}")),
    }
}

async fn execute_task(
    app: &AppHandle,
    project_id: &str,
    task: &ScheduledTaskManifest,
) -> Result<Value, String> {
    match task.task_type.as_str() {
        "page-audit" => {
            let result = seo_audit::inspect_url_headless(&task.url, None, 15).await?;
            serde_json::to_value(result)
                .map_err(|error| format!("Unable to serialize page audit: {error}"))
        }
        "site-crawl" => {
            let config = task.crawl_config.clone();
            if config
                .as_ref()
                .is_some_and(|value| value.crawl_mode == "browser-rendered")
            {
                return Err("Scheduled browser-rendered crawls require an interactive desktop WebView; use HTTP mode for headless execution.".into());
            }
            let control = site_crawler::CrawlControl::new();
            let run_id = format!("scheduled-{}", task.schedule_id);
            let result = site_crawler::crawl_site_with_control(
                app.clone(),
                &control,
                task.url.clone(),
                Some(task.crawl_limit.unwrap_or(25)),
                config.as_ref().and_then(|value| value.user_agent.clone()),
                Some(run_id),
                Some(project_id.to_string()),
                config,
            )
            .await?;
            serde_json::to_value(result)
                .map_err(|error| format!("Unable to serialize site crawl: {error}"))
        }
        _ => Err("Unsupported scheduled task type.".into()),
    }
}

/// Run one OS-triggered task and leave a durable handoff for the next SPA
/// hydration. The caller owns application lifetime and exits the process after
/// this future resolves.
pub async fn run_scheduled_task(
    app: AppHandle,
    project_id: String,
    schedule_id: String,
) -> Result<(), String> {
    let path = task_path(&app, &project_id, &schedule_id)?;
    let Some(mut task) = read_json::<ScheduledTaskManifest>(&path, MAX_EXECUTION_BYTES)? else {
        // A deleted schedule can leave a one-shot OS registration behind if
        // the app is closed between the two native calls. Clean it up here so
        // the registration cannot keep launching a no-longer-existing task.
        let _ = scheduler::unregister_audit_wakeup(project_id, schedule_id);
        return Err("Scheduled task manifest was not found.".into());
    };
    validate_manifest(&project_id, &task)?;
    if !task.enabled {
        let _ = scheduler::unregister_audit_wakeup(project_id, schedule_id);
        return Ok(());
    }
    if !now_is_due(&task.next_run_at, Utc::now())? {
        return Ok(());
    }
    // Keep the lock alive for the entire run. It is intentionally represented
    // by an open file plus a Drop guard so a second launch cannot duplicate a
    // paid crawl while this process is still active.
    let project_dir = crawl_storage::project_directory(&app, &project_id)?;
    let lock_path = project_dir.join(format!("scheduled_execution_{schedule_id}.lock"));
    fs::create_dir_all(&project_dir)
        .map_err(|error| format!("Unable to create scheduled task directory: {error}"))?;
    let Some(_lock_guard) = acquire_scheduled_lock(&lock_path)? else {
        return Ok(());
    };

    let started_at = Utc::now();
    task.status = "running".into();
    task.last_started_at = Some(started_at.to_rfc3339());
    task.last_error = None;
    write_json_atomic(
        &path,
        &serde_json::to_value(&task).map_err(|error| error.to_string())?,
        MAX_EXECUTION_BYTES,
    )?;

    let outcome = execute_task(&app, &project_id, &task).await;
    let completed_at = Utc::now();
    let succeeded = outcome.is_ok();
    let error = outcome
        .as_ref()
        .err()
        .map(|value| value.chars().take(500).collect::<String>());
    let execution = ScheduledTaskExecution {
        started_at: started_at.to_rfc3339(),
        completed_at: completed_at.to_rfc3339(),
        succeeded,
        error: error.clone(),
    };
    // Re-read before committing the outcome. A pause, delete, or edit from
    // the foreground may have happened while the network request was active.
    // Never resurrect a deleted manifest or overwrite newer scheduling data.
    let Some(mut latest_task) = read_json::<ScheduledTaskManifest>(&path, MAX_EXECUTION_BYTES)?
    else {
        let _ = scheduler::unregister_audit_wakeup(project_id, schedule_id);
        return Err("Scheduled task manifest was removed while it was running.".into());
    };
    validate_manifest(&project_id, &latest_task)?;
    let next_run_at = finalize_task(&mut latest_task, execution.clone(), succeeded)?;
    write_json_atomic(
        &path,
        &serde_json::to_value(&latest_task).map_err(|value| value.to_string())?,
        MAX_EXECUTION_BYTES,
    )?;

    // OS registrations are intentionally one-shot so a stale task cannot
    // replay forever. Re-arm the next exact deadline before the worker exits.
    // The audit result remains valid even if the platform rejects the
    // re-registration; the error is handed to the SPA for visible recovery.
    let scheduler_error = if latest_task.enabled {
        scheduler::register_audit_wakeup(
            project_id.clone(),
            schedule_id.clone(),
            next_run_at.clone(),
            latest_task.interval_hours,
        )
        .err()
    } else {
        // A pause that happened during the run must remove the one-shot
        // registration instead of scheduling another execution.
        scheduler::unregister_audit_wakeup(project_id.clone(), schedule_id.clone()).err()
    };

    let handoff = ScheduledExecutionHandoff {
        project_id,
        schedule_id,
        task_type: task.task_type,
        started_at: execution.started_at,
        completed_at: execution.completed_at,
        succeeded,
        next_run_at,
        error,
        scheduler_error,
        result: None,
    };
    let metadata_path = execution_path(&app, &handoff.project_id, &handoff.schedule_id)?;
    let result_path = result_path(&app, &handoff.project_id, &handoff.schedule_id)?;
    if let Ok(result) = outcome {
        write_json_atomic(&result_path, &result, MAX_RESULT_BYTES)?;
    } else {
        let _ = fs::remove_file(&result_path);
    }
    write_json_atomic(
        &metadata_path,
        &serde_json::to_value(handoff).map_err(|value| value.to_string())?,
        MAX_EXECUTION_BYTES,
    )
}

struct ScheduledLock {
    _file: File,
    path: PathBuf,
}

impl Drop for ScheduledLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

pub fn headless_launch_context() -> Option<(String, String)> {
    let args = std::env::args().collect::<Vec<_>>();
    if !args
        .iter()
        .any(|value| value == "--seomi-scheduled-headless")
    {
        return None;
    }
    let value_after = |flag: &str| {
        args.windows(2)
            .find(|pair| pair[0] == flag)
            .map(|pair| pair[1].clone())
            .filter(|value| valid_identifier(value))
    };
    let project_id = value_after("--seomi-scheduled-project")?;
    let schedule_id = value_after("--seomi-scheduled-id")?;
    Some((project_id, schedule_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> ScheduledTaskManifest {
        ScheduledTaskManifest {
            schedule_id: "schedule-1".into(),
            url: "https://example.test".into(),
            task_type: "page-audit".into(),
            crawl_limit: None,
            crawl_config: None,
            interval_hours: 24,
            enabled: true,
            status: "scheduled".into(),
            created_at: "2026-09-25T00:00:00Z".into(),
            next_run_at: "2026-09-25T01:00:00Z".into(),
            last_started_at: None,
            last_run_at: None,
            last_error: None,
            run_history: Vec::new(),
        }
    }

    #[test]
    fn manifest_rejects_credentials_and_invalid_intervals() {
        let mut value = manifest();
        value.url = "https://user:pass@example.test".into();
        assert!(validate_manifest("project-1", &value).is_err());
        value.url = "https://example.test".into();
        value.interval_hours = 1;
        assert!(validate_manifest("project-1", &value).is_err());
    }

    #[test]
    fn manifest_rejects_invalid_execution_timestamps_and_unbounded_errors() {
        let mut value = manifest();
        value.created_at = "not-a-date".into();
        assert!(validate_manifest("project-1", &value).is_err());

        value = manifest();
        value.run_history.push(ScheduledTaskExecution {
            started_at: "2026-09-25T00:00:00Z".into(),
            completed_at: "not-a-date".into(),
            succeeded: false,
            error: Some("x".repeat(501)),
        });
        assert!(validate_manifest("project-1", &value).is_err());
    }

    #[test]
    fn manifest_uses_camel_case_for_frontend_handoff() {
        let value = serde_json::to_value(manifest()).expect("manifest should serialize");
        assert!(value.get("scheduleId").is_some());
        assert!(value.get("nextRunAt").is_some());
        assert!(value.get("schedule_id").is_none());
    }

    #[test]
    fn due_guard_allows_small_scheduler_early_wakeup_only() {
        let now = Utc::now();
        assert!(now_is_due(&(now + ChronoDuration::seconds(30)).to_rfc3339(), now).unwrap());
        assert!(!now_is_due(&(now + ChronoDuration::seconds(91)).to_rfc3339(), now).unwrap());
    }

    #[test]
    fn finalizing_enabled_task_uses_its_current_interval_and_records_history() {
        let mut value = manifest();
        value.interval_hours = 6;
        let execution = ScheduledTaskExecution {
            started_at: "2026-09-25T02:00:00Z".into(),
            completed_at: "2026-09-25T03:00:00Z".into(),
            succeeded: true,
            error: None,
        };

        let next = finalize_task(&mut value, execution, true).expect("valid test timestamp");

        assert_eq!(value.status, "completed");
        assert_eq!(next, "2026-09-25T09:00:00+00:00");
        assert_eq!(value.next_run_at, next);
        assert_eq!(value.run_history.len(), 1);
        assert!(value.last_error.is_none());
    }

    #[test]
    fn finalizing_paused_task_never_rearms_it_as_completed() {
        let mut value = manifest();
        value.enabled = false;
        value.status = "paused".into();
        let execution = ScheduledTaskExecution {
            started_at: "2026-09-25T02:00:00Z".into(),
            completed_at: "2026-09-25T03:00:00Z".into(),
            succeeded: true,
            error: None,
        };

        finalize_task(&mut value, execution, true).expect("valid test timestamp");

        assert_eq!(value.status, "paused");
        assert!(!value.enabled);
        assert_eq!(value.run_history.len(), 1);
    }
}
