//! The native side of the AI assistant: requests to the services a user
//! connects and the keys for them, signing in with ChatGPT, web search, the
//! notes it may work on, its conversations and the MCP servers it calls.

pub mod chatgpt;
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
pub(crate) async fn blocking<T, E>(
    work: impl FnOnce() -> Result<T, E> + Send + 'static,
) -> Result<T, E>
where
    T: Send + 'static,
    E: From<tauri::Error> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work).await?
}
