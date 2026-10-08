use super::history::read_crawl_history_file;
use super::{decode_crawl_runs, STORAGE_MAGIC};
use flate2::{write::GzEncoder, Compression};
use serde_json::json;
use std::{fs, io::Write};

fn directory() -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("seomi-history-edge-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn compressed_history_rejects_corrupt_gzip_payload() {
    let mut bytes = STORAGE_MAGIC.to_vec();
    bytes.extend_from_slice(b"not-gzip");
    assert!(decode_crawl_runs(&bytes)
        .unwrap_err()
        .contains("compressed crawl data is invalid"));
}

#[test]
fn compressed_history_rejects_valid_gzip_with_invalid_json() {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(b"not-json").unwrap();
    let mut bytes = STORAGE_MAGIC.to_vec();
    bytes.extend_from_slice(&encoder.finish().unwrap());
    assert!(decode_crawl_runs(&bytes)
        .unwrap_err()
        .contains("Saved crawl data is invalid"));
}

#[test]
fn history_reader_reports_a_directory_as_a_read_failure() {
    let directory = directory();
    let error = read_crawl_history_file(&directory).unwrap_err();
    assert!(error.contains("saved crawl runs"));
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn history_reader_keeps_json_arrays_as_the_storage_contract() {
    let directory = directory();
    let path = directory.join("history.json");
    fs::write(&path, serde_json::to_vec(&json!([])).unwrap()).unwrap();
    assert_eq!(read_crawl_history_file(&path).unwrap(), json!([]));
    fs::remove_dir_all(directory).unwrap();
}
