//! Model Context Protocol servers the user adds: programs on this machine
//! spoken to over their stdin and stdout, or services reached over HTTP.
//!
//! The page owns the list and hands it over whole with `mcp_sync`; this
//! side starts what is new, stops what is gone and restarts what changed.
//! A server's tools are listed once it is ready and again whenever it says
//! they changed, so the page only reads statuses.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError, Weak},
    time::Duration,
};

use rmcp::{
    model::{
        CallToolRequest, CallToolRequestParams, CallToolResult, ClientCapabilities, ClientRequest,
        Implementation, InitializeRequestParams, JsonObject, ProtocolVersion, ServerResult, Tool,
    },
    service::{ClientInitializeError, NotificationContext, PeerRequestOptions, RunningService},
    transport::{
        streamable_http_client::{StreamableHttpClientTransportConfig, StreamableHttpError},
        StreamableHttpClientTransport, TokioChildProcess,
    },
    ClientHandler, Peer, RoleClient, ServiceError,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{async_runtime::JoinHandle, AppHandle, Manager, Runtime, Window};
use tokio::io::{AsyncBufReadExt, AsyncReadExt};

use super::{
    blocking,
    http::{self, AuthError, ClientError, ProxySetting},
    secrets::{self, SecretError},
};

/// npx may download the server first.
const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(30);
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
const STDERR_LINES: usize = 200;
const STDERR_LINE_BYTES: u64 = 2000;
/// How long quitting waits for servers to stop on their own.
const QUIT_TIMEOUT: Duration = Duration::from_millis(1500);
/// How long a stopped server gets to exit before it is killed; rmcp kills
/// a local one after three seconds of its own.
const STOP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(
    tag = "transport",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum McpServerConfig {
    Stdio {
        id: String,
        name: String,
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: Vec<[String; 2]>,
        #[serde(default)]
        cwd: Option<String>,
    },
    Http {
        id: String,
        name: String,
        url: String,
        #[serde(default)]
        headers: Vec<[String; 2]>,
        /// Send the key saved under the profile `mcp-<id>`.
        #[serde(default)]
        use_key: bool,
        /// The proxy setting `mcp_sync` was given, the same for every
        /// server; a change restarts them.
        #[serde(skip)]
        proxy: ProxySetting,
    },
}

impl McpServerConfig {
    fn id(&self) -> &str {
        match self {
            Self::Stdio { id, .. } | Self::Http { id, .. } => id,
        }
    }

    fn name(&self) -> &str {
        match self {
            Self::Stdio { name, .. } | Self::Http { name, .. } => name,
        }
    }

    fn with_proxy(mut self, setting: &ProxySetting) -> Self {
        if let Self::Http { proxy, .. } = &mut self {
            *proxy = setting.clone();
        }
        self
    }

    fn renamed(&self, to: &str) -> Self {
        let mut config = self.clone();
        match &mut config {
            Self::Stdio { name, .. } | Self::Http { name, .. } => *name = to.to_string(),
        }
        config
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum McpState {
    Starting,
    Ready,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub input_schema: Value,
}

impl From<&Tool> for McpTool {
    fn from(tool: &Tool) -> Self {
        Self {
            name: tool.name.to_string(),
            title: tool.title.clone().or_else(|| {
                tool.annotations
                    .as_ref()
                    .and_then(|annotations| annotations.title.clone())
            }),
            description: tool.description.as_ref().map(ToString::to_string),
            input_schema: Value::Object(tool.input_schema.as_ref().clone()),
        }
    }
}

/// Why a server failed to start or stopped, as the page reads it:
/// `{ kind, … }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum McpStartError {
    BadCwd {
        path: String,
    },
    CommandNotFound {
        command: String,
    },
    Spawn {
        message: String,
    },
    BadUrl {
        url: String,
    },
    UnsupportedScheme {
        scheme: String,
    },
    BadHeader {
        name: String,
    },
    /// One the transport sets itself, which rmcp refuses to send.
    ReservedHeader {
        name: String,
    },
    /// It is to send a key and none is saved for it.
    NotConnected,
    /// The key saved was for another address.
    KeyNeeded,
    BadProfile,
    BadProxy {
        message: String,
    },
    Store {
        message: String,
    },
    Timeout,
    Exited,
    /// The server answered with an error of its own.
    Server {
        message: String,
    },
    Connection {
        message: String,
    },
}

impl From<SecretError> for McpStartError {
    fn from(error: SecretError) -> Self {
        match error {
            SecretError::BadProfile => Self::BadProfile,
            SecretError::BadUrl { url } => Self::BadUrl { url },
            SecretError::KeyNeeded => Self::KeyNeeded,
            SecretError::Store { message } => Self::Store { message },
        }
    }
}

impl From<AuthError> for McpStartError {
    fn from(error: AuthError) -> Self {
        match error {
            AuthError::NotConnected => Self::NotConnected,
            AuthError::KeyNeeded => Self::KeyNeeded,
            AuthError::BadUrl { url } => Self::BadUrl { url },
        }
    }
}

impl From<ClientError> for McpStartError {
    fn from(error: ClientError) -> Self {
        match error {
            ClientError::BadProxy { message } => Self::BadProxy { message },
            ClientError::Build { message } => Self::Connection { message },
        }
    }
}

// Only the read from the credential store runs on a thread of its own.
impl From<tauri::Error> for McpStartError {
    fn from(error: tauri::Error) -> Self {
        Self::Store {
            message: error.to_string(),
        }
    }
}

impl From<ClientInitializeError> for McpStartError {
    fn from(error: ClientInitializeError) -> Self {
        if let ClientInitializeError::TransportError {
            error: transport, ..
        } = &error
        {
            if let Some(StreamableHttpError::ReservedHeaderConflict(name)) =
                transport
                    .error
                    .downcast_ref::<StreamableHttpError<reqwest::Error>>()
            {
                return Self::ReservedHeader { name: name.clone() };
            }
        }
        match error {
            ClientInitializeError::JsonRpcError(error) => Self::Server {
                message: error.message.into(),
            },
            ClientInitializeError::ConnectionClosed(_) => Self::Exited,
            other => Self::Connection {
                message: other.to_string(),
            },
        }
    }
}

impl From<ServiceError> for McpStartError {
    fn from(error: ServiceError) -> Self {
        match error {
            ServiceError::Timeout { .. } => Self::Timeout,
            ServiceError::TransportClosed => Self::Exited,
            ServiceError::McpError(error) => Self::Server {
                message: error.message.into(),
            },
            other => Self::Connection {
                message: other.to_string(),
            },
        }
    }
}

/// Why a tool could not be called, as the page reads it: `{ kind, … }`.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum McpCallError {
    /// No server by that id: it was turned off or removed.
    UnknownServer,
    /// Starting, or failed to start.
    NotReady,
    BadArguments,
    UnexpectedResponse,
    Timeout,
    Exited,
    Server {
        message: String,
    },
    Connection {
        message: String,
    },
}

impl From<ServiceError> for McpCallError {
    fn from(error: ServiceError) -> Self {
        match error {
            ServiceError::Timeout { .. } => Self::Timeout,
            ServiceError::TransportClosed => Self::Exited,
            ServiceError::McpError(error) => Self::Server {
                message: error.message.into(),
            },
            ServiceError::UnexpectedResponse => Self::UnexpectedResponse,
            other => Self::Connection {
                message: other.to_string(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub id: String,
    pub name: String,
    pub state: McpState,
    pub error: Option<McpStartError>,
    pub tools: Vec<McpTool>,
    /// What a local server last wrote to stderr, oldest first.
    pub stderr: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolResult {
    pub content: Vec<Value>,
    pub is_error: bool,
    pub structured_content: Option<Value>,
}

impl From<CallToolResult> for McpToolResult {
    fn from(result: CallToolResult) -> Self {
        Self {
            content: result
                .content
                .iter()
                .filter_map(|block| serde_json::to_value(block).ok())
                .collect(),
            is_error: result.is_error.unwrap_or(false),
            structured_content: result.structured_content,
        }
    }
}

/// The last lines a server wrote to stderr; its own error messages are the
/// only clue when it fails to start.
#[derive(Debug, Default)]
struct StderrRing(VecDeque<String>);

impl StderrRing {
    fn push(&mut self, line: &str) {
        if self.0.len() == STDERR_LINES {
            self.0.pop_front();
        }
        self.0
            .push_back(line.trim_end_matches(['\r', '\n']).to_string());
    }

    fn lines(&self) -> Vec<String> {
        self.0.iter().cloned().collect()
    }
}

/// The running servers, shared by every window.
#[derive(Default)]
pub struct McpServers(Arc<Registry>);

#[derive(Default)]
struct Registry(Mutex<Servers>);

#[derive(Default)]
struct Servers {
    /// Ids in the order the page listed them.
    order: Vec<String>,
    entries: HashMap<String, Entry>,
    /// Counts starts, so a start that was overtaken leaves no trace.
    generation: u64,
}

struct Entry {
    config: McpServerConfig,
    generation: u64,
    state: McpState,
    error: Option<McpStartError>,
    tools: Vec<McpTool>,
    stderr: Arc<Mutex<StderrRing>>,
    service: Option<RunningService<RoleClient, Watcher>>,
    /// Of a local server, whose process group is killed if it outlives the app.
    pid: Option<u32>,
    task: Option<JoinHandle<()>>,
}

/// What is left to stop of a server.
struct Running {
    service: Option<RunningService<RoleClient, Watcher>>,
    pid: Option<u32>,
    task: Option<JoinHandle<()>>,
}

impl Entry {
    fn new(config: McpServerConfig, generation: u64) -> Self {
        Self {
            config,
            generation,
            state: McpState::Starting,
            error: None,
            tools: Vec::new(),
            stderr: Arc::default(),
            service: None,
            pid: None,
            task: None,
        }
    }

    fn take_running(&mut self) -> Running {
        Running {
            service: self.service.take(),
            pid: self.pid.take(),
            task: self.task.take(),
        }
    }

    /// A server that exits on its own is failed from then on.
    fn notice_exit(&mut self) {
        let exited = self
            .service
            .as_ref()
            .is_some_and(|service| service.peer().is_transport_closed());
        if self.state == McpState::Ready && exited {
            self.state = McpState::Failed;
            self.error = Some(McpStartError::Exited);
        }
    }

    fn status(&mut self) -> McpStatus {
        self.notice_exit();
        McpStatus {
            id: self.config.id().to_string(),
            name: self.config.name().to_string(),
            state: self.state,
            error: self.error.clone(),
            tools: self.tools.clone(),
            stderr: lock(&self.stderr).lines(),
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Registry {
    fn servers(&self) -> MutexGuard<'_, Servers> {
        lock(&self.0)
    }

    fn statuses(&self) -> Vec<McpStatus> {
        let mut servers = self.servers();
        let Servers { order, entries, .. } = &mut *servers;
        order
            .iter()
            .filter_map(|id| entries.get_mut(id).map(Entry::status))
            .collect()
    }

    fn status(&self, id: &str) -> Option<McpStatus> {
        self.servers().entries.get_mut(id).map(Entry::status)
    }

    fn set_pid(&self, id: &str, generation: u64, pid: Option<u32>) {
        if let Some(entry) = self.servers().entries.get_mut(id) {
            if entry.generation == generation {
                entry.pid = pid;
            }
        }
    }

    fn set_tools(&self, id: &str, generation: u64, tools: &[Tool]) {
        if let Some(entry) = self.servers().entries.get_mut(id) {
            if entry.generation == generation {
                entry.tools = tools.iter().map(McpTool::from).collect();
            }
        }
    }

    /// Records how a start ended. One that was overtaken by a stop or a
    /// restart is closed again.
    fn finish(
        &self,
        id: &str,
        generation: u64,
        result: Result<(RunningService<RoleClient, Watcher>, Vec<Tool>), McpStartError>,
    ) {
        let mut servers = self.servers();
        let Some(entry) = servers
            .entries
            .get_mut(id)
            .filter(|entry| entry.generation == generation)
        else {
            drop(servers);
            if let Ok((service, _)) = result {
                close_later(service);
            }
            return;
        };
        entry.task = None;
        match result {
            Ok((service, tools)) => {
                entry.state = McpState::Ready;
                entry.error = None;
                entry.tools = tools.iter().map(McpTool::from).collect();
                entry.service = Some(service);
            }
            Err(error) => {
                entry.state = McpState::Failed;
                entry.error = Some(error);
            }
        }
    }

    fn peer(&self, id: &str) -> Result<Peer<RoleClient>, McpCallError> {
        let mut servers = self.servers();
        let entry = servers
            .entries
            .get_mut(id)
            .ok_or(McpCallError::UnknownServer)?;
        entry.notice_exit();
        match (&entry.service, entry.state) {
            (Some(service), McpState::Ready) => Ok(service.peer().clone()),
            _ => Err(McpCallError::NotReady),
        }
    }
}

/// Starts a server under the lock, so its start finds its entry in place.
fn start(
    registry: &Arc<Registry>,
    servers: &mut Servers,
    app: &AppHandle,
    window: &str,
    config: McpServerConfig,
) -> Running {
    servers.generation += 1;
    let generation = servers.generation;
    let id = config.id().to_string();
    let mut entry = Entry::new(config.clone(), generation);
    entry.task = Some(tauri::async_runtime::spawn(run(
        app.clone(),
        Arc::clone(registry),
        window.to_string(),
        config,
        generation,
        Arc::clone(&entry.stderr),
    )));
    match servers.entries.insert(id, entry) {
        Some(mut previous) => previous.take_running(),
        None => Running {
            service: None,
            pid: None,
            task: None,
        },
    }
}

async fn run(
    app: AppHandle,
    registry: Arc<Registry>,
    window: String,
    config: McpServerConfig,
    generation: u64,
    stderr: Arc<Mutex<StderrRing>>,
) {
    let id = config.id().to_string();
    let watcher = Watcher {
        registry: Arc::downgrade(&registry),
        id: id.clone(),
        generation,
    };
    let result = match &config {
        McpServerConfig::Stdio {
            command,
            args,
            env,
            cwd,
            ..
        } => match spawn_local(command, args, env, cwd.as_deref()).await {
            Ok((process, output)) => {
                registry.set_pid(&id, generation, process.id());
                if let Some(output) = output {
                    tauri::async_runtime::spawn(collect_stderr(output, stderr));
                }
                handshake(watcher, process).await
            }
            Err(error) => Err(error),
        },
        McpServerConfig::Http {
            url,
            headers,
            use_key,
            proxy,
            ..
        } => match remote(&app, &window, &id, url, headers, *use_key, proxy).await {
            Ok(transport) => handshake(watcher, transport).await,
            Err(error) => Err(error),
        },
    };
    registry.finish(&id, generation, result);
}

/// Initializes the connection and lists the tools.
async fn handshake<T, E, A>(
    watcher: Watcher,
    transport: T,
) -> Result<(RunningService<RoleClient, Watcher>, Vec<Tool>), McpStartError>
where
    T: rmcp::transport::IntoTransport<RoleClient, E, A>,
    E: std::error::Error + Send + Sync + 'static,
{
    let service = tokio::time::timeout(INITIALIZE_TIMEOUT, rmcp::serve_client(watcher, transport))
        .await
        .map_err(|_| McpStartError::Timeout)??;
    let tools = tokio::time::timeout(INITIALIZE_TIMEOUT, service.peer().list_all_tools())
        .await
        .map_err(|_| McpStartError::Timeout)??;
    Ok((service, tools))
}

/// Our side of the connection; it only listens for the tools changing.
struct Watcher {
    registry: Weak<Registry>,
    id: String,
    generation: u64,
}

impl ClientHandler for Watcher {
    fn get_info(&self) -> InitializeRequestParams {
        InitializeRequestParams::new(
            ClientCapabilities::default(),
            Implementation::new("NyaMark", env!("CARGO_PKG_VERSION")),
        )
        // The handshake every server so far speaks.
        .with_protocol_version(ProtocolVersion::LATEST_WITH_INITIALIZE)
    }

    async fn on_tool_list_changed(&self, context: NotificationContext<RoleClient>) {
        let registry = self.registry.clone();
        let id = self.id.clone();
        let generation = self.generation;
        // Listing is a request of its own, answered on the connection that
        // is delivering this notification; waiting for it here would stall.
        tauri::async_runtime::spawn(async move {
            let listed =
                tokio::time::timeout(INITIALIZE_TIMEOUT, context.peer.list_all_tools()).await;
            if let (Ok(Ok(tools)), Some(registry)) = (listed, registry.upgrade()) {
                registry.set_tools(&id, generation, &tools);
            }
        });
    }
}

async fn collect_stderr(output: impl tokio::io::AsyncRead + Unpin, ring: Arc<Mutex<StderrRing>>) {
    let mut reader = tokio::io::BufReader::new(output);
    let mut line = Vec::new();
    loop {
        line.clear();
        // A line is cut at a length, so one without an end cannot grow forever.
        match (&mut reader)
            .take(STDERR_LINE_BYTES)
            .read_until(b'\n', &mut line)
            .await
        {
            Ok(0) | Err(_) => break,
            Ok(_) => lock(&ring).push(&String::from_utf8_lossy(&line)),
        }
    }
}

fn expand_home(path: &str) -> PathBuf {
    match (path.strip_prefix("~/"), home_dir()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ if path == "~" => home_dir().unwrap_or_else(|| PathBuf::from(path)),
        _ => PathBuf::from(path),
    }
}

fn home_dir() -> Option<PathBuf> {
    let name = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(name)
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
}

fn is_path_variable(name: &str) -> bool {
    if cfg!(windows) {
        name.eq_ignore_ascii_case("PATH")
    } else {
        name == "PATH"
    }
}

async fn spawn_local(
    command: &str,
    args: &[String],
    env: &[[String; 2]],
    cwd: Option<&str>,
) -> Result<(TokioChildProcess, Option<tokio::process::ChildStderr>), McpStartError> {
    let cwd = cwd
        .map(str::trim)
        .filter(|cwd| !cwd.is_empty())
        .map(expand_home);
    if let Some(cwd) = &cwd {
        if !cwd.is_dir() {
            return Err(McpStartError::BadCwd {
                path: cwd.display().to_string(),
            });
        }
    }
    let path = match env.iter().find(|[name, _]| is_path_variable(name)) {
        Some([_, path]) => path.clone(),
        None => login_path().await,
    };
    let program =
        find_program(&expand_home(command.trim()), &path, cwd.as_deref()).ok_or_else(|| {
            McpStartError::CommandNotFound {
                command: command.to_string(),
            }
        })?;

    let mut process = tokio::process::Command::new(program);
    process.args(args).env("PATH", &path);
    for [name, value] in env {
        process.env(name, value);
    }
    if let Some(cwd) = cwd {
        process.current_dir(cwd);
    }
    let mut process = process_wrap::tokio::CommandWrap::from(process);
    process.wrap(process_wrap::tokio::KillOnDrop);
    // Its own process group, so what it starts in turn (npx starts node)
    // can be stopped with it.
    #[cfg(unix)]
    process.wrap(process_wrap::tokio::ProcessGroup::leader());
    #[cfg(windows)]
    {
        process.wrap(process_wrap::tokio::CreationFlags(
            windows_process::Win32::System::Threading::CREATE_NO_WINDOW,
        ));
        process.wrap(process_wrap::tokio::JobObject);
    }
    TokioChildProcess::builder(process)
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| McpStartError::Spawn {
            message: error.to_string(),
        })
}

/// Where a command runs from: a path as given, against the server's folder
/// when relative, or a bare name looked up in `path`.
fn find_program(command: &Path, path: &str, cwd: Option<&Path>) -> Option<PathBuf> {
    if command.as_os_str().is_empty() {
        return None;
    }
    if command.is_absolute() || command.components().count() > 1 {
        let full = match cwd {
            Some(cwd) if command.is_relative() => cwd.join(command),
            _ => command.to_path_buf(),
        };
        return runnable(&full);
    }
    std::env::split_paths(path).find_map(|folder| runnable(&folder.join(command)))
}

#[cfg(unix)]
fn runnable(candidate: &Path) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = std::fs::metadata(candidate).ok()?;
    (metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .then(|| candidate.to_path_buf())
}

/// `npx` is `npx.cmd` on Windows; the extensions come from PATHEXT.
#[cfg(windows)]
fn runnable(candidate: &Path) -> Option<PathBuf> {
    if candidate.extension().is_some() && candidate.is_file() {
        return Some(candidate.to_path_buf());
    }
    let extensions = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    extensions
        .split(';')
        .filter(|extension| !extension.is_empty())
        .find_map(|extension| {
            let mut name = candidate.as_os_str().to_os_string();
            name.push(extension);
            let file = PathBuf::from(name);
            file.is_file().then_some(file)
        })
}

/// The PATH a terminal would have. An app opened from the Dock or Finder
/// gets a bare one without Homebrew, nvm or cargo, where npx and uvx live.
async fn login_path() -> String {
    static LOGIN_PATH: OnceLock<String> = OnceLock::new();
    if let Some(path) = LOGIN_PATH.get() {
        return path.clone();
    }
    let path = tauri::async_runtime::spawn_blocking(read_login_path)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| std::env::var("PATH").unwrap_or_default());
    LOGIN_PATH
        .get_or_init(|| with_extra_dirs(&path, home_dir().as_deref()))
        .clone()
}

#[cfg(unix)]
fn read_login_path() -> Option<String> {
    use std::io::Read;
    const MARK: &str = "__NYAMARK_PATH__";
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|shell| !shell.is_empty())?;
    let mut child = std::process::Command::new(shell)
        .args(["-ilc", &format!("printf '{MARK}%s{MARK}' \"$PATH\"")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut output = Vec::new();
        let _ = stdout.read_to_end(&mut output);
        let _ = sender.send(output);
    });
    // A shell that waits for input or hangs in its startup files is given up on.
    let output = receiver.recv_timeout(Duration::from_secs(5));
    let _ = child.kill();
    let _ = child.wait();
    let output = String::from_utf8_lossy(&output.ok()?).into_owned();
    // Startup files may print greetings around it.
    let start = output.find(MARK)? + MARK.len();
    let end = start + output[start..].find(MARK)?;
    let path = output[start..end].trim();
    (!path.is_empty()).then(|| path.to_string())
}

#[cfg(not(unix))]
fn read_login_path() -> Option<String> {
    None
}

/// Adds the folders package managers install commands into, in case the
/// login shell could not be asked.
fn with_extra_dirs(path: &str, home: Option<&Path>) -> String {
    let mut folders: Vec<PathBuf> = std::env::split_paths(path).collect();
    if cfg!(unix) {
        let mut extra = vec![
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ];
        if let Some(home) = home {
            for folder in [".local/bin", ".cargo/bin", ".bun/bin", ".volta/bin"] {
                extra.push(home.join(folder));
            }
        }
        for folder in extra {
            if !folders.contains(&folder) {
                folders.push(folder);
            }
        }
    }
    std::env::join_paths(folders)
        .map(|joined| joined.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_string())
}

async fn remote(
    app: &AppHandle,
    window: &str,
    id: &str,
    url: &str,
    headers: &[[String; 2]],
    use_key: bool,
    proxy: &ProxySetting,
) -> Result<StreamableHttpClientTransport<reqwest::Client>, McpStartError> {
    let url = url.trim();
    let parsed = url::Url::parse(url).map_err(|_| McpStartError::BadUrl { url: url.into() })?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(McpStartError::UnsupportedScheme {
            scheme: parsed.scheme().into(),
        });
    }
    let mut headers: Vec<(String, String)> = headers
        .iter()
        .map(|[name, value]| (name.trim().to_string(), value.clone()))
        .filter(|(name, _)| !name.is_empty())
        .collect();
    if use_key {
        let app = app.clone();
        let window = window.to_string();
        let profile = format!("mcp-{id}");
        // The keychain may ask the user, so it is read off the async threads.
        let record =
            blocking(move || secrets::record(&app, &window, &profile).map_err(McpStartError::from))
                .await?;
        headers = http::authorize(parsed.as_str(), headers, record.as_ref())?;
    }
    http_transport(parsed.as_str(), headers, proxy)
}

/// The transport to an HTTP server, with the headers the user set. rmcp
/// refuses one it sets itself as it sends the first request.
fn http_transport(
    url: &str,
    headers: Vec<(String, String)>,
    proxy: &ProxySetting,
) -> Result<StreamableHttpClientTransport<reqwest::Client>, McpStartError> {
    let mut custom = HashMap::new();
    for (name, value) in headers {
        let bad = || McpStartError::BadHeader { name: name.clone() };
        let header = reqwest::header::HeaderName::from_bytes(name.as_bytes()).map_err(|_| bad())?;
        let value = reqwest::header::HeaderValue::from_str(value.trim()).map_err(|_| bad())?;
        custom.insert(header, value);
    }
    Ok(StreamableHttpClientTransport::with_client(
        http_client(proxy)?,
        StreamableHttpClientTransportConfig::with_uri(url).custom_headers(custom),
    ))
}

/// The client for an HTTP server: through the proxy the user set, as the
/// other AI requests go, and following redirects only within the server's
/// origin, so its key and headers stay with it. No read timeout: the event
/// stream may stay quiet for a long time.
fn http_client(proxy: &ProxySetting) -> Result<reqwest::Client, McpStartError> {
    http::install_crypto_provider();
    Ok(http::finish_client(
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .redirect(http::same_origin_redirects()),
        proxy,
    )?)
}

/// Lets a stopped server close in its own time.
fn close_later(mut service: RunningService<RoleClient, Watcher>) {
    tauri::async_runtime::spawn(async move {
        let _ = service.close_with_timeout(STOP_TIMEOUT).await;
    });
}

fn stop(running: Running) {
    if let Some(task) = running.task {
        task.abort();
    }
    if let Some(service) = running.service {
        close_later(service);
    }
}

#[derive(Debug, Default, PartialEq)]
struct Plan {
    order: Vec<String>,
    start: Vec<McpServerConfig>,
    restart: Vec<McpServerConfig>,
    rename: Vec<McpServerConfig>,
    stop: Vec<String>,
}

/// What it takes to go from the running servers to the wanted ones. A new
/// name alone changes nothing that runs; any other change restarts, and so
/// does a sync of a server that failed. The first of two equal ids wins.
fn plan(
    running: &HashMap<String, (McpServerConfig, McpState)>,
    wanted: Vec<McpServerConfig>,
) -> Plan {
    let mut plan = Plan::default();
    let mut seen = HashSet::new();
    for config in wanted {
        let id = config.id().to_string();
        if id.trim().is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        plan.order.push(id.clone());
        match running.get(&id) {
            None => plan.start.push(config),
            Some((current, state)) if current.renamed(config.name()) == config => {
                if matches!(state, McpState::Failed | McpState::Stopped) {
                    plan.restart.push(config);
                } else if current.name() != config.name() {
                    plan.rename.push(config);
                }
            }
            Some(_) => plan.restart.push(config),
        }
    }
    plan.stop = running
        .keys()
        .filter(|id| !seen.contains(*id))
        .cloned()
        .collect();
    plan.stop.sort();
    plan
}

/// Make the running servers the ones listed, and say how each one is. HTTP
/// servers are reached through `proxy`, the system's when it is left out.
#[tauri::command]
pub async fn mcp_sync(
    app: AppHandle,
    window: Window,
    servers: Vec<McpServerConfig>,
    proxy: Option<ProxySetting>,
) -> Vec<McpStatus> {
    let proxy = proxy.unwrap_or_default();
    let servers: Vec<McpServerConfig> = servers
        .into_iter()
        .map(|config| config.with_proxy(&proxy))
        .collect();
    let registry = Arc::clone(&app.state::<McpServers>().0);
    let mut stopping = Vec::new();
    {
        let mut state = registry.servers();
        let running = state
            .entries
            .iter()
            .map(|(id, entry)| (id.clone(), (entry.config.clone(), entry.state)))
            .collect();
        let plan = plan(&running, servers);
        for id in &plan.stop {
            if let Some(mut entry) = state.entries.remove(id) {
                stopping.push(entry.take_running());
            }
        }
        for config in plan.rename {
            if let Some(entry) = state.entries.get_mut(config.id()) {
                entry.config = config;
            }
        }
        for config in plan.start.into_iter().chain(plan.restart) {
            stopping.push(start(&registry, &mut state, &app, window.label(), config));
        }
        state.order = plan.order;
    }
    stopping.into_iter().for_each(stop);
    registry.statuses()
}

#[tauri::command]
pub fn mcp_status(app: AppHandle) -> Vec<McpStatus> {
    app.state::<McpServers>().0.statuses()
}

#[tauri::command]
pub async fn mcp_restart(
    app: AppHandle,
    window: Window,
    id: String,
) -> Result<McpStatus, McpCallError> {
    let registry = Arc::clone(&app.state::<McpServers>().0);
    let previous = {
        let mut state = registry.servers();
        let config = state
            .entries
            .get(&id)
            .map(|entry| entry.config.clone())
            .ok_or(McpCallError::UnknownServer)?;
        start(&registry, &mut state, &app, window.label(), config)
    };
    stop(previous);
    registry.status(&id).ok_or(McpCallError::UnknownServer)
}

#[tauri::command]
pub async fn mcp_call_tool(
    app: AppHandle,
    server: String,
    tool: String,
    arguments: Option<Value>,
) -> Result<McpToolResult, McpCallError> {
    let arguments = match arguments {
        None | Some(Value::Null) => None,
        Some(Value::Object(arguments)) => Some(arguments),
        Some(_) => return Err(McpCallError::BadArguments),
    };
    let peer = app.state::<McpServers>().0.peer(&server)?;
    call_tool(&peer, tool, arguments, CALL_TIMEOUT).await
}

/// Calls a tool. One that takes too long is cancelled on the server too.
async fn call_tool(
    peer: &Peer<RoleClient>,
    tool: String,
    arguments: Option<JsonObject>,
    timeout: Duration,
) -> Result<McpToolResult, McpCallError> {
    let mut params = CallToolRequestParams::new(tool);
    if let Some(arguments) = arguments {
        params = params.with_arguments(arguments);
    }
    let request = peer
        .send_cancellable_request(
            ClientRequest::CallToolRequest(CallToolRequest::new(params)),
            PeerRequestOptions::with_timeout(timeout),
        )
        .await?;
    match request.await_response().await? {
        ServerResult::CallToolResult(result) => Ok(result.into()),
        _ => Err(McpCallError::UnexpectedResponse),
    }
}

/// Stops every server as the app quits: each gets a moment to exit, and
/// what is left of a local one's process group is killed.
pub fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    let Some(servers) = app.try_state::<McpServers>() else {
        return;
    };
    let running: Vec<Running> = servers
        .0
        .servers()
        .entries
        .drain()
        .map(|(_, mut entry)| entry.take_running())
        .collect();
    if running.is_empty() {
        return;
    }
    let mut leftover = Vec::new();
    let mut closing = Vec::new();
    for running in running {
        if let Some(task) = running.task {
            task.abort();
            leftover.extend(running.pid);
        } else if let Some(mut service) = running.service {
            let closed = tauri::async_runtime::spawn(async move {
                matches!(service.close_with_timeout(QUIT_TIMEOUT).await, Ok(Some(_)))
            });
            closing.push((running.pid, closed));
        }
    }
    tauri::async_runtime::block_on(async {
        let deadline = tokio::time::Instant::now() + QUIT_TIMEOUT + Duration::from_millis(200);
        for (pid, closed) in closing {
            if !matches!(
                tokio::time::timeout_at(deadline, closed).await,
                Ok(Ok(true))
            ) {
                leftover.extend(pid);
            }
        }
    });
    #[cfg(unix)]
    for pid in leftover {
        if let Ok(group) = libc::pid_t::try_from(pid) {
            // SAFETY: killpg only sends a signal; the group is the one the
            // server was started in.
            unsafe {
                libc::killpg(group, libc::SIGKILL);
            }
        }
    }
    #[cfg(not(unix))]
    let _ = leftover;
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncWriteExt, DuplexStream};

    fn stdio(id: &str, name: &str, command: &str) -> McpServerConfig {
        McpServerConfig::Stdio {
            id: id.into(),
            name: name.into(),
            command: command.into(),
            args: Vec::new(),
            env: Vec::new(),
            cwd: None,
        }
    }

    #[test]
    fn configs_read_the_shape_the_page_sends() {
        let configs: Vec<McpServerConfig> = serde_json::from_value(json!([
            {"transport": "stdio", "id": "a", "name": "Files", "command": "npx",
             "args": ["-y", "server"], "env": [["TOKEN", "x"]], "cwd": "/tmp"},
            {"transport": "http", "id": "b", "name": "Web", "url": "https://example.com/mcp",
             "headers": [["X-Team", "1"]], "useKey": true},
            {"transport": "stdio", "id": "c", "name": "Bare", "command": "uvx"}
        ]))
        .unwrap();
        assert_eq!(
            configs[0],
            McpServerConfig::Stdio {
                id: "a".into(),
                name: "Files".into(),
                command: "npx".into(),
                args: vec!["-y".into(), "server".into()],
                env: vec![["TOKEN".into(), "x".into()]],
                cwd: Some("/tmp".into()),
            }
        );
        assert!(
            matches!(&configs[1], McpServerConfig::Http { use_key: true, headers, proxy, .. }
                if headers.len() == 1 && *proxy == ProxySetting::System)
        );
        assert_eq!(configs[2], stdio("c", "Bare", "uvx"));
    }

    #[test]
    fn a_sync_touches_only_what_changed() {
        let running: HashMap<String, (McpServerConfig, McpState)> = [
            ("same", stdio("same", "Same", "a"), McpState::Ready),
            ("renamed", stdio("renamed", "Old", "a"), McpState::Ready),
            (
                "changed",
                stdio("changed", "Changed", "a"),
                McpState::Starting,
            ),
            ("failed", stdio("failed", "Failed", "a"), McpState::Failed),
            ("gone", stdio("gone", "Gone", "a"), McpState::Ready),
        ]
        .into_iter()
        .map(|(id, config, state)| (id.to_string(), (config, state)))
        .collect();
        let plan = plan(
            &running,
            vec![
                stdio("new", "New", "a"),
                stdio("same", "Same", "a"),
                stdio("renamed", "New name", "a"),
                stdio("changed", "Changed", "b"),
                stdio("failed", "Failed", "a"),
                stdio("new", "Second with the same id", "c"),
                stdio(" ", "No id", "a"),
            ],
        );
        assert_eq!(
            plan,
            Plan {
                order: ["new", "same", "renamed", "changed", "failed"]
                    .map(String::from)
                    .to_vec(),
                start: vec![stdio("new", "New", "a")],
                restart: vec![
                    stdio("changed", "Changed", "b"),
                    stdio("failed", "Failed", "a")
                ],
                rename: vec![stdio("renamed", "New name", "a")],
                stop: vec!["gone".into()],
            }
        );
    }

    fn remote_server(id: &str) -> McpServerConfig {
        McpServerConfig::Http {
            id: id.into(),
            name: id.into(),
            url: "https://example.com/mcp".into(),
            headers: Vec::new(),
            use_key: false,
            proxy: ProxySetting::System,
        }
    }

    #[test]
    fn a_new_proxy_restarts_the_http_servers() {
        let manual = ProxySetting::Manual {
            url: "http://127.0.0.1:7890".into(),
        };
        let running: HashMap<String, (McpServerConfig, McpState)> = [
            ("web", remote_server("web")),
            ("local", stdio("local", "Local", "a")),
        ]
        .into_iter()
        .map(|(id, config)| (id.to_string(), (config, McpState::Ready)))
        .collect();
        let wanted = vec![
            remote_server("web").with_proxy(&manual),
            stdio("local", "Local", "a").with_proxy(&manual),
        ];
        let changed = plan(&running, wanted);
        assert_eq!(
            changed.restart,
            vec![remote_server("web").with_proxy(&manual)]
        );
        assert!(changed.start.is_empty() && changed.rename.is_empty() && changed.stop.is_empty());
        let unchanged = plan(
            &running,
            vec![remote_server("web"), stdio("local", "Local", "a")],
        );
        assert!(unchanged.restart.is_empty());
    }

    #[test]
    fn an_http_server_goes_through_the_proxy_set() {
        assert!(http_client(&ProxySetting::Manual { url: "::".into() }).is_err());
        assert!(http_client(&ProxySetting::Manual {
            url: "http://127.0.0.1:7890".into()
        })
        .is_ok());
        assert!(http_client(&ProxySetting::None).is_ok());
    }

    #[test]
    fn stderr_keeps_the_last_lines() {
        let mut ring = StderrRing::default();
        for index in 0..250 {
            ring.push(&format!("line {index}\r\n"));
        }
        let lines = ring.lines();
        assert_eq!(lines.len(), STDERR_LINES);
        assert_eq!(lines[0], "line 50");
        assert_eq!(lines[199], "line 249");
    }

    #[test]
    fn long_stderr_lines_are_cut() {
        let ring = Arc::new(Mutex::new(StderrRing::default()));
        let (mut writer, reader) = tokio::io::duplex(64 * 1024);
        tauri::async_runtime::block_on(async {
            let long = "x".repeat(4500);
            writer
                .write_all(format!("{long}\nshort\n").as_bytes())
                .await
                .unwrap();
            drop(writer);
            collect_stderr(reader, Arc::clone(&ring)).await;
        });
        let lines = lock(&ring).lines();
        let lengths: Vec<usize> = lines.iter().map(String::len).collect();
        assert_eq!(lengths, [2000, 2000, 500, 5]);
    }

    #[cfg(unix)]
    #[test]
    fn commands_are_found_on_the_path() {
        use std::os::unix::fs::PermissionsExt;
        let folder = tempfile::tempdir().unwrap();
        let bin = folder.path().join("bin");
        std::fs::create_dir(&bin).unwrap();
        let tool = bin.join("tool");
        std::fs::write(&tool, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(bin.join("plain"), "").unwrap();
        let path = format!("/nonexistent:{}", bin.display());
        assert_eq!(
            find_program(Path::new("tool"), &path, None),
            Some(tool.clone())
        );
        assert_eq!(find_program(Path::new("plain"), &path, None), None);
        assert_eq!(find_program(Path::new("missing"), &path, None), None);
        assert_eq!(
            find_program(Path::new("bin/tool"), "", Some(folder.path())),
            Some(tool.clone())
        );
        assert_eq!(find_program(&tool, "", None), Some(tool));
        assert_eq!(find_program(Path::new(""), &path, None), None);
    }

    #[cfg(unix)]
    #[test]
    fn package_manager_folders_join_the_path() {
        let path = with_extra_dirs("/usr/bin:/usr/local/bin", Some(Path::new("/Users/me")));
        assert_eq!(
            path,
            "/usr/bin:/usr/local/bin:/opt/homebrew/bin:/Users/me/.local/bin:\
             /Users/me/.cargo/bin:/Users/me/.bun/bin:/Users/me/.volta/bin"
        );
    }

    /// A server that speaks just enough MCP: two pages of tools, a tool
    /// that echoes, one that fails, one that never answers and one that
    /// adds a tool and says so.
    async fn fake_server(stream: DuplexStream) {
        let (read, mut write) = tokio::io::split(stream);
        let mut lines = tokio::io::BufReader::new(read).lines();
        let mut extra_tool = false;
        while let Ok(Some(line)) = lines.next_line().await {
            let message: Value = serde_json::from_str(&line).unwrap();
            let Some(id) = message.get("id").cloned() else {
                continue;
            };
            let params = &message["params"];
            let mut notify = None;
            let result = match message["method"].as_str().unwrap_or_default() {
                "initialize" => json!({
                    "protocolVersion": params["protocolVersion"],
                    "capabilities": {"tools": {"listChanged": true}},
                    "serverInfo": {"name": "fake", "version": "1.0.0"}
                }),
                "tools/list" => match params["cursor"].as_str() {
                    None => json!({
                        "tools": [{"name": "echo", "description": "Says it back",
                                   "inputSchema": {"type": "object"}}],
                        "nextCursor": "page-2"
                    }),
                    Some(_) => {
                        let mut tools = vec![json!({
                            "name": "fail", "title": "Always fails",
                            "inputSchema": {"type": "object"}
                        })];
                        if extra_tool {
                            tools.push(json!({"name": "added", "inputSchema": {"type": "object"}}));
                        }
                        json!({ "tools": tools })
                    }
                },
                "tools/call" => match params["name"].as_str().unwrap_or_default() {
                    "echo" => json!({
                        "content": [{"type": "text", "text": params["arguments"]["text"]}],
                        "structuredContent": {"echoed": params["arguments"]["text"]}
                    }),
                    "hang" => continue,
                    "change" => {
                        extra_tool = true;
                        notify = Some(json!({
                            "jsonrpc": "2.0", "method": "notifications/tools/list_changed"
                        }));
                        json!({"content": []})
                    }
                    _ => json!({"content": [{"type": "text", "text": "no"}], "isError": true}),
                },
                _ => continue,
            };
            let reply = json!({"jsonrpc": "2.0", "id": id, "result": result});
            write
                .write_all(format!("{reply}\n").as_bytes())
                .await
                .unwrap();
            if let Some(notify) = notify {
                write
                    .write_all(format!("{notify}\n").as_bytes())
                    .await
                    .unwrap();
            }
        }
    }

    fn tool_names(registry: &Registry) -> Vec<String> {
        registry
            .status("fake")
            .unwrap()
            .tools
            .into_iter()
            .map(|tool| tool.name)
            .collect()
    }

    #[test]
    fn a_server_is_listed_called_and_watched() {
        tauri::async_runtime::block_on(async {
            let (ours, theirs) = tokio::io::duplex(64 * 1024);
            tauri::async_runtime::spawn(fake_server(theirs));
            let registry = Arc::new(Registry::default());
            {
                let mut servers = registry.servers();
                servers.order.push("fake".into());
                servers
                    .entries
                    .insert("fake".into(), Entry::new(stdio("fake", "Fake", "x"), 1));
            }
            let watcher = Watcher {
                registry: Arc::downgrade(&registry),
                id: "fake".into(),
                generation: 1,
            };
            let result = handshake(watcher, ours).await;
            registry.finish("fake", 1, result);

            let status = registry.status("fake").unwrap();
            assert_eq!(status.state, McpState::Ready);
            assert_eq!(tool_names(&registry), ["echo", "fail"]);
            assert_eq!(status.tools[0].description.as_deref(), Some("Says it back"));
            assert_eq!(status.tools[1].title.as_deref(), Some("Always fails"));
            assert_eq!(status.tools[0].input_schema, json!({"type": "object"}));

            let peer = registry.peer("fake").unwrap();
            let arguments = json!({"text": "hi"}).as_object().cloned();
            let echoed = call_tool(&peer, "echo".into(), arguments, CALL_TIMEOUT)
                .await
                .unwrap();
            assert_eq!(echoed.content, [json!({"type": "text", "text": "hi"})]);
            assert_eq!(echoed.structured_content, Some(json!({"echoed": "hi"})));
            assert!(!echoed.is_error);

            let failed = call_tool(&peer, "fail".into(), None, CALL_TIMEOUT)
                .await
                .unwrap();
            assert!(failed.is_error);

            let hung = call_tool(&peer, "hang".into(), None, Duration::from_millis(100)).await;
            assert_eq!(hung.unwrap_err(), McpCallError::Timeout);

            call_tool(&peer, "change".into(), None, CALL_TIMEOUT)
                .await
                .unwrap();
            for _ in 0..100 {
                if tool_names(&registry).len() == 3 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            assert_eq!(tool_names(&registry), ["echo", "fail", "added"]);

            assert_eq!(
                registry.peer("other").unwrap_err(),
                McpCallError::UnknownServer
            );
            let running = registry
                .servers()
                .entries
                .get_mut("fake")
                .unwrap()
                .take_running();
            let mut service = running.service.unwrap();
            service
                .close_with_timeout(Duration::from_secs(1))
                .await
                .unwrap();
        });
    }

    #[test]
    fn a_start_that_was_overtaken_is_dropped() {
        tauri::async_runtime::block_on(async {
            let (ours, theirs) = tokio::io::duplex(64 * 1024);
            tauri::async_runtime::spawn(fake_server(theirs));
            let registry = Arc::new(Registry::default());
            registry
                .servers()
                .entries
                .insert("fake".into(), Entry::new(stdio("fake", "Fake", "x"), 2));
            let watcher = Watcher {
                registry: Arc::downgrade(&registry),
                id: "fake".into(),
                generation: 1,
            };
            let result = handshake(watcher, ours).await;
            assert!(result.is_ok());
            registry.finish("fake", 1, result);
            let status = registry.status("fake").unwrap();
            assert_eq!(status.state, McpState::Starting);
            assert!(status.tools.is_empty());
            assert_eq!(registry.peer("fake").unwrap_err(), McpCallError::NotReady);
        });
    }

    #[test]
    fn a_server_that_says_nothing_fails_to_start() {
        tauri::async_runtime::block_on(async {
            let (ours, theirs) = tokio::io::duplex(1024);
            drop(theirs);
            let watcher = Watcher {
                registry: Weak::new(),
                id: "fake".into(),
                generation: 1,
            };
            assert!(matches!(
                handshake(watcher, ours).await,
                Err(McpStartError::Connection { .. })
            ));
        });
    }

    #[test]
    fn a_header_the_transport_sets_is_refused_by_name() {
        tauri::async_runtime::block_on(async {
            // Refused before anything is sent: nothing listens there.
            let transport = http_transport(
                "http://127.0.0.1:9/mcp",
                vec![("Accept".into(), "text/plain".into())],
                &ProxySetting::default(),
            )
            .unwrap();
            let watcher = Watcher {
                registry: Weak::new(),
                id: "fake".into(),
                generation: 1,
            };
            assert_eq!(
                handshake(watcher, transport).await.err(),
                Some(McpStartError::ReservedHeader {
                    name: "accept".into()
                })
            );
        });
    }

    #[test]
    fn a_failure_reaches_the_page_by_kind() {
        let mut entry = Entry::new(stdio("fake", "Fake", "x"), 1);
        entry.state = McpState::Failed;
        entry.error = Some(McpStartError::CommandNotFound {
            command: "npx".into(),
        });
        assert_eq!(
            serde_json::to_value(entry.status()).unwrap()["error"],
            json!({"kind": "command-not-found", "command": "npx"})
        );
        assert_eq!(
            serde_json::to_value(McpCallError::Server {
                message: "no such tool".into()
            })
            .unwrap(),
            json!({"kind": "server", "message": "no such tool"})
        );
    }
}
