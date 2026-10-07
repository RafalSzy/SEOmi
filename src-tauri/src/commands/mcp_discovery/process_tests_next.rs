use super::process::discover_from_process_blocking;
use std::{fs, path::PathBuf};

struct NodeFixture(PathBuf);

impl NodeFixture {
    fn new(script: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("seomi-mcp-next-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        fs::write(dir.join("server.js"), script).unwrap();
        Self(dir)
    }

    fn path(&self) -> String {
        self.0.join("server.js").to_string_lossy().into_owned()
    }
}

impl Drop for NodeFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn responding_fixture(server_info: &str) -> NodeFixture {
    let script = r#"
process.stdin.resume();
console.log(JSON.stringify({id:1,result:{serverInfo:__SERVER_INFO__}}));
console.log(JSON.stringify({id:2,result:{tools:[]}}));
setInterval(()=>{},1000);
"#
    .replace("__SERVER_INFO__", server_info);
    NodeFixture::new(&script)
}

#[test]
fn initialize_without_server_info_is_rejected() {
    let fixture = NodeFixture::new(
        r#"
process.stdin.resume();
console.log(JSON.stringify({id:1,result:{}}));
console.log(JSON.stringify({id:2,result:{tools:[]}}));
setInterval(()=>{},1000);
"#,
    );
    assert_eq!(
        discover_from_process_blocking(fixture.path()).unwrap_err(),
        "MCP initialize response did not identify the server."
    );
}

#[test]
fn initialize_with_blank_server_name_is_rejected() {
    let fixture = responding_fixture("{name:'   ',version:'1'}");
    assert_eq!(
        discover_from_process_blocking(fixture.path()).unwrap_err(),
        "MCP initialize response contained no server name."
    );
}

#[test]
fn missing_server_version_is_reported_as_unknown() {
    let fixture = responding_fixture("{name:'fixture'}");
    let result = discover_from_process_blocking(fixture.path()).unwrap();
    assert_eq!(result.server_name, "fixture");
    assert_eq!(result.server_version, "unknown");
    assert!(result.tools.is_empty());
}

#[test]
fn real_node_exit_without_a_response_returns_immediately() {
    let fixture = NodeFixture::new("process.stdin.destroy(); process.exit(0);");
    assert_eq!(
        discover_from_process_blocking(fixture.path()).unwrap_err(),
        "MCP server did not answer within the discovery timeout."
    );
}
