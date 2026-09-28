//! Project-scoped persistence for the multi-page audit queue.
//!
//! The foreground SPA still mirrors the queue to Web Storage for backwards
//! compatibility, but the desktop snapshot lives beside the other project
//! data. This keeps a large URL queue resumable when a WebView evicts or
//! refuses localStorage.

use super::crawl_storage;
use serde_json::Value;
use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use tauri::AppHandle;

const MAX_QUEUE_BYTES: usize = 16 * 1024 * 1024;
const MAX_QUEUE_EXECUTION_BYTES: usize = 64 * 1024 * 1024;
const MAX_QUEUE_RESULT_BYTES: usize = 8 * 1024 * 1024;

pub(crate) fn queue_path(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    Ok(crawl_storage::project_directory(app, project_id)?.join("audit_queue.json"))
}

pub(crate) fn queue_execution_path(
    app: &AppHandle,
    project_id: &str,
    run_id: &str,
) -> Result<PathBuf, String> {
    if run_id.is_empty()
        || run_id.len() > 80
        || !run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("Invalid audit queue run identifier.".into());
    }
    Ok(crawl_storage::project_directory(app, project_id)?
        .join(format!("audit_queue_execution_{run_id}.json")))
}

pub(crate) fn queue_result_path(
    app: &AppHandle,
    project_id: &str,
    run_id: &str,
    item_id: &str,
) -> Result<PathBuf, String> {
    for value in [run_id, item_id] {
        if value.is_empty()
            || value.len() > 80
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        {
            return Err("Invalid audit queue result identifier.".into());
        }
    }
    Ok(crawl_storage::project_directory(app, project_id)?
        .join(format!("audit_queue_result_{run_id}_{item_id}.json")))
}

fn write_atomic(path: &std::path::Path, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(value)
        .map_err(|error| format!("Unable to serialize audit queue: {error}"))?;
    if bytes.len() > MAX_QUEUE_BYTES {
        return Err("Audit queue exceeds the safety limit.".into());
    }
    let directory = path
        .parent()
        .ok_or_else(|| "Audit queue path has no parent directory.".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Unable to create audit queue directory: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    if let Err(error) = fs::write(&temporary, bytes) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Unable to write audit queue: {error}"));
    }
    if let Err(error) = crawl_storage::replace_file(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Unable to finalize audit queue: {error}"));
    }
    Ok(())
}

#[tauri::command]
pub fn load_project_audit_queue(app: AppHandle, project_id: String) -> Result<Value, String> {
    let path = queue_path(&app, &project_id)?;
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Value::Null),
        Err(error) => return Err(format!("Unable to read audit queue: {error}")),
    };
    if bytes.len() > MAX_QUEUE_BYTES {
        return Err("Saved audit queue exceeds the safety limit.".into());
    }
    serde_json::from_slice(&bytes).map_err(|error| format!("Saved audit queue is invalid: {error}"))
}

pub(crate) fn read_queue_snapshot(
    app: &AppHandle,
    project_id: &str,
) -> Result<Option<Value>, String> {
    let path = queue_path(app, project_id)?;
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Unable to read audit queue: {error}")),
    };
    if bytes.len() > MAX_QUEUE_BYTES {
        return Err("Saved audit queue exceeds the safety limit.".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| format!("Saved audit queue is invalid: {error}"))
}

pub(crate) fn write_queue_snapshot(
    app: &AppHandle,
    project_id: &str,
    snapshot: &Value,
) -> Result<(), String> {
    if !snapshot.is_object() {
        return Err("Audit queue storage expects a JSON object.".into());
    }
    write_atomic(&queue_path(app, project_id)?, snapshot)
}

pub(crate) fn write_queue_execution(
    app: &AppHandle,
    project_id: &str,
    run_id: &str,
    execution: &Value,
) -> Result<(), String> {
    let bytes = serde_json::to_vec(execution)
        .map_err(|error| format!("Unable to serialize audit queue execution: {error}"))?;
    if bytes.len() > MAX_QUEUE_EXECUTION_BYTES {
        return Err("Audit queue execution exceeds the safety limit.".into());
    }
    write_atomic(&queue_execution_path(app, project_id, run_id)?, execution)
}

pub(crate) fn write_queue_result(
    app: &AppHandle,
    project_id: &str,
    run_id: &str,
    item_id: &str,
    result: &Value,
) -> Result<(), String> {
    let bytes = serde_json::to_vec(result)
        .map_err(|error| format!("Unable to serialize audit queue result: {error}"))?;
    if bytes.len() > MAX_QUEUE_RESULT_BYTES {
        return Err("Audit queue result exceeds the safety limit.".into());
    }
    write_atomic(
        &queue_result_path(app, project_id, run_id, item_id)?,
        result,
    )
}

#[tauri::command]
pub fn save_project_audit_queue(
    app: AppHandle,
    project_id: String,
    snapshot: Value,
) -> Result<(), String> {
    write_queue_snapshot(&app, &project_id, &snapshot)
}

#[tauri::command]
pub fn delete_project_audit_queue(app: AppHandle, project_id: String) -> Result<(), String> {
    let path = queue_path(&app, &project_id)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Unable to remove audit queue: {error}")),
    }?;
    let directory = crawl_storage::project_directory(&app, &project_id)?;
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Unable to inspect audit queue files: {error}")),
    };
    for entry in entries {
        let path = entry
            .map_err(|error| format!("Unable to inspect audit queue file: {error}"))?
            .path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name.starts_with("audit_queue_execution_")
            || name.starts_with("audit_queue_result_")
            || name.starts_with("audit_queue_execution_") && name.ends_with(".lock")
        {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_project_audit_queue_executions(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<Value>, String> {
    let directory = crawl_storage::project_directory(&app, &project_id)?;
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Unable to list audit queue executions: {error}")),
    };
    let mut executions = Vec::new();
    for entry in entries {
        let path = entry
            .map_err(|error| format!("Unable to read audit queue execution entry: {error}"))?
            .path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with("audit_queue_execution_") || !name.ends_with(".json") {
            continue;
        }
        let bytes = fs::read(&path)
            .map_err(|error| format!("Unable to read audit queue execution: {error}"))?;
        if bytes.len() > MAX_QUEUE_EXECUTION_BYTES {
            return Err("Saved audit queue execution exceeds the safety limit.".into());
        }
        executions.push(
            serde_json::from_slice(&bytes)
                .map_err(|error| format!("Saved audit queue execution is invalid: {error}"))?,
        );
        if executions.len() >= 100 {
            break;
        }
    }
    Ok(executions)
}

#[tauri::command]
pub fn list_project_audit_queue_results(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<Value>, String> {
    let directory = crawl_storage::project_directory(&app, &project_id)?;
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Unable to list audit queue results: {error}")),
    };
    let mut results = Vec::new();
    for entry in entries {
        let path = entry
            .map_err(|error| format!("Unable to read audit queue result entry: {error}"))?
            .path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with("audit_queue_result_") || !name.ends_with(".json") {
            continue;
        }
        let bytes = fs::read(&path)
            .map_err(|error| format!("Unable to read audit queue result: {error}"))?;
        if bytes.len() > MAX_QUEUE_RESULT_BYTES {
            return Err("Saved audit queue result exceeds the safety limit.".into());
        }
        results.push(
            serde_json::from_slice(&bytes)
                .map_err(|error| format!("Saved audit queue result is invalid: {error}"))?,
        );
        if results.len() >= 50_000 {
            break;
        }
    }
    Ok(results)
}

#[tauri::command]
pub fn acknowledge_project_audit_queue_result(
    app: AppHandle,
    project_id: String,
    run_id: String,
    item_id: String,
) -> Result<(), String> {
    let path = queue_result_path(&app, &project_id, &run_id, &item_id)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Unable to acknowledge audit queue result: {error}")),
    }
}

#[tauri::command]
pub fn acknowledge_project_audit_queue_execution(
    app: AppHandle,
    project_id: String,
    run_id: String,
) -> Result<(), String> {
    let path = queue_execution_path(&app, &project_id, &run_id)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Unable to acknowledge audit queue execution: {error}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn queue_snapshot_is_an_object() {
        assert!(json!({ "items": [], "run": null }).is_object());
        assert!(!json!([]).is_object());
    }
}
