//! The native side of the AI assistant: requests to the services a user
//! connects and the keys for them, web search, the notes it may work on,
//! its conversations and the MCP servers it calls.

pub mod history;
pub mod http;
pub mod images;
pub mod mcp;
pub mod secrets;
pub mod web;
pub mod workspace;

/// Runs file work on a thread meant for blocking, so a slow disk or a
/// network volume holds up only this command and not the async threads every
/// other command and stream shares.
pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("io: {error}"))?
}
