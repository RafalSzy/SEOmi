use super::*;

#[test]
fn listing_sorts_truncates_and_ignores_unrelated_files() {
    let app = fixture();
    assert!(list_scheduled_executions(app.handle(), "project-1".into())
        .unwrap()
        .is_empty());
    for index in 0..25 {
        let mut value = handoff(&format!("job-{index}"), false);
        value.completed_at = format!("2026-09-25T03:{index:02}:00Z");
        store(&app, &value);
    }
    let directory = app.project("project-1");
    for name in ["unrelated.json", "scheduled_execution_ignore.txt"] {
        fs::write(directory.join(name), b"not json").unwrap();
    }
    let values = list_scheduled_executions(app.handle(), "project-1".into()).unwrap();
    assert_eq!(values.len(), 20);
    assert_eq!(values.first().unwrap().schedule_id, "job-24");
    assert_eq!(values.last().unwrap().schedule_id, "job-5");
    assert!(values.iter().all(|value| value.result.is_none()));
}

#[test]
fn listing_attaches_success_results_and_rejects_corrupt_metadata() {
    let app = fixture();
    store(&app, &handoff("job", true));
    let result = result_path(&app.handle(), "project-1", "job").unwrap();
    fs::write(result, br#"{"pages":3}"#).unwrap();
    let values = list_scheduled_executions(app.handle(), "project-1".into()).unwrap();
    assert_eq!(values.len(), 1);
    assert_eq!(values[0].result, Some(json!({"pages":3})));
    let metadata = execution_path(&app.handle(), "project-1", "job").unwrap();
    fs::write(metadata, b"not json").unwrap();
    assert!(list_scheduled_executions(app.handle(), "project-1".into())
        .unwrap_err()
        .contains("invalid"));
    assert!(list_scheduled_executions(app.handle(), "../escape".into()).is_err());
}
