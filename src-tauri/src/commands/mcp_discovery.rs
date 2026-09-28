use serde::Serialize;
use serde_json::{json, Value};
use std::env;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};
use tokio::time::timeout;

const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(12);
const MAX_PROTOCOL_LINE_BYTES: usize = 1024 * 1024;
const MAX_PROTOCOL_LINES: usize = 64;
const MAX_TOOLS: usize = 128;

fn node_program() -> std::ffi::OsString {
    // Desktop shells launched from Finder/Start Menu often have a reduced PATH.
    // Prefer an explicit runtime path supplied by the host when it is present,
    // then keep the normal PATH lookup for installed Node.js distributions.
    for variable in ["SEOMI_NODE_PATH", "CODEX_MCP_NODE_PATH", "NODE"] {
        if let Some(candidate) = env::var_os(variable) {
            let path = Path::new(&candidate);
            if path.is_absolute() && path.is_file() {
                return candidate;
            }
        }
    }
    "node".into()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredMcpTool {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDiscoveryResult {
    pub server_name: String,
    pub server_version: String,
    pub tools: Vec<DiscoveredMcpTool>,
}

fn validate_server_path(value: &str) -> Result<String, String> {
    let path = Path::new(value.trim());
    if !path.is_absolute() {
        return Err("Choose an absolute path to a trusted MCP server JavaScript file.".into());
    }
    if !path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("js"))
    {
        return Err("The MCP server path must point to a .js file.".into());
    }
    let canonical = path.canonicalize().map_err(|_| {
        "The selected MCP server file does not exist or cannot be read.".to_string()
    })?;
    if !canonical.is_file() {
        return Err("The selected MCP server path is not a file.".into());
    }
    Ok(canonical.to_string_lossy().into_owned())
}

fn receive_response(
    stdout: &Receiver<Vec<u8>>,
    expected_id: u64,
    deadline: Instant,
    total_bytes: &mut usize,
    total_lines: &mut usize,
) -> Result<Value, String> {
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("MCP server did not answer within the discovery timeout.".into());
        }
        let line = stdout
            .recv_timeout(remaining)
            .map_err(|_| "MCP server did not answer within the discovery timeout.".to_string())?;
        *total_lines = total_lines.saturating_add(1);
        *total_bytes = total_bytes.saturating_add(line.len());
        if *total_lines > MAX_PROTOCOL_LINES {
            return Err("MCP server exceeded the discovery protocol message limit.".into());
        }
        if line.len() > MAX_PROTOCOL_LINE_BYTES || *total_bytes > MAX_PROTOCOL_LINE_BYTES {
            return Err("MCP server response exceeded the 1 MiB discovery limit.".into());
        }
        let message: Value = serde_json::from_slice(&line)
            .map_err(|_| "MCP server wrote non-JSON data to its protocol output.".to_string())?;
        if message.get("id").and_then(Value::as_u64) != Some(expected_id) {
            continue;
        }
        if let Some(error) = message.get("error") {
            let description = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("MCP protocol request failed.");
            return Err(description.chars().take(500).collect());
        }
        return message
            .get("result")
            .cloned()
            .ok_or_else(|| "MCP server response did not include a result.".into());
    }
}

fn discover_from_process_blocking(path: String) -> Result<McpDiscoveryResult, String> {
    let mut child = Command::new(node_program())
        .arg(path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| {
            "Node.js was not found on PATH. Install Node.js and restart the desktop app."
                .to_string()
        })?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open MCP server input.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not open MCP server output.".to_string())?;
    let (line_sender, line_receiver) = mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = Vec::new();
            match reader.read_until(b'\n', &mut line) {
                Ok(0) => break,
                Ok(_) => {
                    if line_sender.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let requests = [
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": { "name": "SEOmi", "version": env!("CARGO_PKG_VERSION") }
            }
        }),
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }),
    ];
    for request in requests {
        let mut line = serde_json::to_vec(&request)
            .map_err(|_| "Could not encode MCP request.".to_string())?;
        line.push(b'\n');
        stdin
            .write_all(&line)
            .map_err(|_| "Could not write to the MCP server process.".to_string())?;
    }
    stdin
        .flush()
        .map_err(|_| "Could not flush the MCP server request.".to_string())?;
    drop(stdin);

    let deadline = Instant::now() + DISCOVERY_TIMEOUT;
    let mut total_bytes = 0usize;
    let mut total_lines = 0usize;
    let initialized = receive_response(
        &line_receiver,
        1,
        deadline,
        &mut total_bytes,
        &mut total_lines,
    )?;
    let listing = receive_response(
        &line_receiver,
        2,
        deadline,
        &mut total_bytes,
        &mut total_lines,
    )?;
    let _ = child.kill();
    let _ = child.wait();
    let server_info = initialized
        .get("serverInfo")
        .ok_or_else(|| "MCP initialize response did not identify the server.".to_string())?;
    let server_name = server_info
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| "MCP initialize response contained no server name.".to_string())?
        .chars()
        .take(128)
        .collect::<String>();
    let server_version = server_info
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .chars()
        .take(64)
        .collect::<String>();

    let tools = parse_tools(&listing)?;
    Ok(McpDiscoveryResult {
        server_name,
        server_version,
        tools,
    })
}

async fn discover_from_process(path: String) -> Result<McpDiscoveryResult, String> {
    tokio::task::spawn_blocking(move || discover_from_process_blocking(path))
        .await
        .map_err(|_| "MCP discovery worker stopped unexpectedly.".to_string())?
}

fn parse_tools(result: &Value) -> Result<Vec<DiscoveredMcpTool>, String> {
    let entries = result
        .get("tools")
        .and_then(Value::as_array)
        .ok_or_else(|| "MCP tools/list response did not contain a tools array.".to_string())?;
    if entries.len() > MAX_TOOLS {
        return Err(format!(
            "MCP server returned more than {MAX_TOOLS} tools; discovery was stopped."
        ));
    }
    let mut tools = Vec::with_capacity(entries.len());
    for entry in entries {
        let name = entry
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| !name.trim().is_empty() && name.len() <= 128)
            .ok_or_else(|| "MCP server returned a tool with an invalid name.".to_string())?;
        let input_schema = entry
            .get("inputSchema")
            .filter(|schema| schema.is_object())
            .cloned()
            .ok_or_else(|| format!("MCP tool {name} did not provide a JSON Schema object."))?;
        tools.push(DiscoveredMcpTool {
            name: name.to_string(),
            description: entry
                .get("description")
                .and_then(Value::as_str)
                .map(|description| description.chars().take(2000).collect()),
            input_schema,
        });
    }
    Ok(tools)
}

#[tauri::command]
pub async fn discover_mcp_tools(server_path: String) -> Result<McpDiscoveryResult, String> {
    let path = validate_server_path(&server_path)?;
    timeout(DISCOVERY_TIMEOUT, discover_from_process(path))
        .await
        .map_err(|_| "MCP discovery timed out after 12 seconds.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::{discover_from_process, parse_tools, validate_server_path};
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn parses_server_discovered_tool_schemas() {
        let tools = parse_tools(&json!({
            "tools": [{
                "name": "seomi_audit_url",
                "description": "Audit one public URL.",
                "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } } }
            }]
        }))
        .unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "seomi_audit_url");
        assert_eq!(tools[0].input_schema["properties"]["url"]["type"], "string");
    }

    #[test]
    fn rejects_invalid_or_excessive_tool_catalogs() {
        assert!(parse_tools(&json!({ "tools": [{ "name": "missing-schema" }] })).is_err());
        let too_many = (0..129)
            .map(|index| json!({ "name": format!("tool-{index}"), "inputSchema": { "type": "object" } }))
            .collect::<Vec<_>>();
        assert!(parse_tools(&json!({ "tools": too_many })).is_err());
    }

    #[test]
    fn validates_explicit_absolute_javascript_server_path() {
        assert!(validate_server_path("relative/server.js").is_err());
        assert!(validate_server_path("/definitely/not/a/server.ts").is_err());
    }

    #[tokio::test]
    async fn discovers_tools_from_the_built_seomi_server_when_available() {
        let server_path =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../mcp-server/dist/index.js");
        if !server_path.is_file() {
            return;
        }
        let discovery = discover_from_process(server_path.to_string_lossy().into_owned())
            .await
            .unwrap();
        assert_eq!(discovery.server_name, "seomi-mcp-server");
        assert_eq!(discovery.tools.len(), 18);
        assert!(discovery
            .tools
            .iter()
            .any(|tool| tool.name == "seomi_audit_url"));
        assert!(discovery
            .tools
            .iter()
            .any(|tool| tool.name == "seomi_crawl_site"));
        assert!(discovery
            .tools
            .iter()
            .any(|tool| tool.name == "seomi_research_backlink_anchors"));
        assert!(discovery
            .tools
            .iter()
            .any(|tool| tool.name == "seomi_research_backlink_pages"));
        assert!(discovery
            .tools
            .iter()
            .any(|tool| tool.name == "seomi_research_backlink_gap"));
        assert!(discovery
            .tools
            .iter()
            .any(|tool| tool.name == "seomi_research_ranked_keywords"));
        assert!(discovery
            .tools
            .iter()
            .any(|tool| tool.name == "seomi_pagespeed_insights"));
        assert!(discovery.tools.iter().any(|tool| tool.name == "seomi_crux"));
    }
}
