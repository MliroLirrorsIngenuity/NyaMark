//! Sign in with ChatGPT: a service signed in to a ChatGPT account sends its
//! requests to OpenAI's Codex backend, paid for by the user's ChatGPT plan
//! in place of an API key.
//!
//! The sign-in is the one the Codex CLI makes, as Cherry Studio and other
//! open-source apps make it: OpenAI's own Codex client, which a workspace
//! that keeps third-party apps out still lets in. OAuth with PKCE in the
//! system browser comes back to a listener on 127.0.0.1, at a port OpenAI
//! registered for that client.
//!
//! The tokens are kept in the credential store beside the keys, and like the
//! keys never reach the webview: a request through `http.rs` gets them here,
//! renewed as they run out, and they go to the Codex backend alone.

use std::{
    borrow::Cow,
    collections::HashSet,
    convert::Infallible,
    future::Future,
    io::ErrorKind,
    net::Ipv4Addr,
    pin::Pin,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, PoisonError,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use bytes::Bytes;
use http_body_util::Full;
use hyper::{
    body::Incoming,
    header::{HeaderValue, CACHE_CONTROL, CONTENT_TYPE, REFERRER_POLICY},
    server::conn::http1,
    service::service_fn,
    Method, Request, Response, StatusCode,
};
use hyper_util::rt::{TokioIo, TokioTimer};
use oauth2::{
    basic::{
        BasicErrorResponse, BasicRevocationErrorResponse, BasicTokenIntrospectionResponse,
        BasicTokenType,
    },
    AccessToken, AuthUrl, AuthorizationCode, ClientId, CsrfToken, EndpointNotSet, EndpointSet,
    PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, RefreshToken, RequestTokenError, Scope,
    StandardRevocableToken, TokenResponse, TokenUrl,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, Window};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::{mpsc, oneshot, OwnedMutexGuard};
use tokio_util::sync::{CancellationToken, DropGuard};

use super::{
    blocking,
    http::{self, ClientError, FetchError, ProxySetting},
    secrets::{self, AuthScheme, SecretError, SecretStore},
};

/// OpenAI's sign-in service.
const ISSUER: &str = "https://auth.openai.com";
/// The Codex CLI's client.
const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
/// Where a signed-in service's requests go, and the only place its tokens
/// are sent.
pub const BACKEND: &str = "https://chatgpt.com/backend-api/codex";
const SCOPES: [&str; 4] = ["openid", "profile", "email", "offline_access"];
/// The ports OpenAI takes the Codex client's callbacks on: Codex's own, then
/// the one Codex falls back to while another program holds it.
const PORTS: [u16; 2] = [1455, 1457];
const CALLBACK_PATH: &str = "/auth/callback";
/// Tries at a port, a moment apart: a sign-in just stopped lets go of it
/// once its listener winds down.
const BIND_TRIES: u32 = 5;
/// How each client of the backend names itself to it; Codex is
/// `codex_cli_rs`.
const ORIGINATOR: &str = "nyamark";
/// Headers this module sets on a request to the backend, which the page's
/// may not stand in for.
const BACKEND_HEADERS: [&str; 4] = [
    "authorization",
    "chatgpt-account-id",
    "originator",
    "x-openai-fedramp",
];
/// How long the browser may take to come back.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(600);
/// An access token this close to its end is renewed before it is sent, as
/// Codex does.
const REFRESH_MARGIN: u64 = 300;
/// Tries at ending a session at OpenAI before signing out without it, each
/// given as long as Codex gives its one.
const REVOKE_TRIES: u32 = 4;
const REVOKE_TIMEOUT: Duration = Duration::from_secs(10);
/// Refresh errors after which the refresh token is no use, as Codex reads
/// them: the user has to sign in again. So does a 401.
const ENDED: [&str; 4] = [
    "invalid_grant",
    "refresh_token_expired",
    "refresh_token_reused",
    "refresh_token_invalidated",
];
const PROFILE_ACCOUNT: &str = "chatgpt-";

/// Why signing in or getting a token failed, as the page reads it:
/// `{ kind, … }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ChatGptError {
    BadProfile,
    /// The service has not signed in, or signed out.
    SignedOut,
    /// The sign-in ended at OpenAI (the refresh token no longer works).
    SignInAgain,
    /// The user declined in the browser.
    AccessDenied,
    /// The account's workspace has not let its members use Codex.
    NoCodex,
    /// Another sign-in started, or it was stopped.
    Cancelled,
    TimedOut,
    /// Other programs hold every port OpenAI comes back to: a sign-in to
    /// Codex itself, say.
    PortsBusy,
    /// OpenAI answered with an OAuth error.
    #[serde(rename = "oauth")]
    OAuth {
        code: String,
        message: Option<String>,
    },
    Network {
        message: String,
    },
    Store {
        message: String,
    },
    BadProxy {
        message: String,
    },
    /// The browser could not be opened.
    Browser {
        message: String,
    },
}

impl From<SecretError> for ChatGptError {
    fn from(error: SecretError) -> Self {
        match error {
            SecretError::BadProfile => Self::BadProfile,
            SecretError::Store { message } => Self::Store { message },
            // Only the store's own failures reach here.
            other => Self::Store {
                message: format!("{other:?}"),
            },
        }
    }
}

impl From<ClientError> for ChatGptError {
    fn from(error: ClientError) -> Self {
        match error {
            ClientError::BadProxy { message } => Self::BadProxy { message },
            ClientError::Build { message } => Self::Network { message },
        }
    }
}

// Only reads and writes of the credential store run on a thread of their own.
impl From<tauri::Error> for ChatGptError {
    fn from(error: tauri::Error) -> Self {
        Self::Store {
            message: error.to_string(),
        }
    }
}

/// What a service keeps of its ChatGPT sign-in.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(Debug))]
struct Credentials {
    /// The ChatGPT account the tokens act for, a workspace or the user's
    /// own, which the backend is told with each request.
    #[serde(default)]
    account_id: Option<String>,
    /// The account is on ChatGPT's FedRAMP service, which the backend is
    /// told as well.
    #[serde(default)]
    fedramp: bool,
    #[serde(default)]
    email: Option<String>,
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    /// Unix seconds.
    #[serde(default)]
    expires_at: Option<u64>,
}

/// What the settings show of a service's ChatGPT sign-in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptStatus {
    pub signed_in: bool,
    pub email: Option<String>,
}

fn status_of(credentials: Option<&Credentials>) -> ChatGptStatus {
    ChatGptStatus {
        signed_in: credentials.is_some(),
        email: credentials.and_then(|credentials| credentials.email.clone()),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptSignOut {
    /// OpenAI confirmed the session ended. When it did not, the user can
    /// still sign out of their devices in ChatGPT's settings.
    pub revoked: bool,
    pub status: ChatGptStatus,
}

/// What the browser shows on coming back, in the user's language.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallbackPage {
    pub signed_in: String,
    pub failed: String,
}

impl CallbackPage {
    fn html(&self, ok: bool) -> String {
        let text = escape_html(if ok { &self.signed_in } else { &self.failed });
        format!(
            "<!doctype html><html><head><meta charset=\"utf-8\">\
             <meta name=\"color-scheme\" content=\"light dark\"><title>NyaMark</title></head>\
             <body style=\"font:15px/1.5 system-ui,sans-serif;max-width:28rem;margin:5rem auto;padding:0 1rem;text-align:center\">\
             <p>{text}</p></body></html>"
        )
    }
}

fn escape_html(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            c => escaped.push(c),
        }
    }
    escaped
}

/// The claims of OpenAI's tokens NyaMark reads.
#[derive(Debug, Default, Deserialize)]
struct Claims {
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    exp: Option<u64>,
    #[serde(rename = "https://api.openai.com/profile", default)]
    profile: Option<ProfileClaims>,
    #[serde(rename = "https://api.openai.com/auth", default)]
    auth: Option<AuthClaims>,
}

#[derive(Debug, Default, Deserialize)]
struct ProfileClaims {
    #[serde(default)]
    email: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct AuthClaims {
    #[serde(default)]
    chatgpt_account_id: Option<String>,
    #[serde(default)]
    chatgpt_account_is_fedramp: bool,
}

/// The claims of a token, unverified: it came straight from OpenAI's token
/// endpoint over TLS, which OpenID Connect lets stand in for checking its
/// signature (Core 3.1.3.7). None for one that does not read as a JWT.
fn claims_of(token: &str) -> Option<Claims> {
    let payload = token.split('.').nth(1)?;
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()
}

impl Claims {
    fn account_id(&self) -> Option<String> {
        self.auth
            .as_ref()
            .and_then(|auth| auth.chatgpt_account_id.clone())
            .filter(|id| !id.is_empty())
    }

    fn fedramp(&self) -> bool {
        self.auth
            .as_ref()
            .is_some_and(|auth| auth.chatgpt_account_is_fedramp)
    }

    fn email(&self) -> Option<String> {
        self.email.clone().or_else(|| {
            self.profile
                .as_ref()
                .and_then(|profile| profile.email.clone())
        })
    }
}

/// One service's credentials, read once and then kept here. Its lock also
/// keeps two refreshes from racing: each one spends the refresh token.
#[derive(Default)]
struct Slot {
    read: bool,
    credentials: Option<Credentials>,
}

type SlotLock = Arc<tokio::sync::Mutex<Slot>>;

/// The sign-in a window is waiting on.
struct Pending {
    window: String,
    id: u64,
    cancel: CancellationToken,
}

/// Sign-in state shared by the windows.
#[derive(Default)]
pub struct ChatGpt {
    profiles: Mutex<std::collections::HashMap<String, SlotLock>>,
    /// The sign-in under way. The browser comes back to one port, so there
    /// is only ever one: a new one, or its window closing, stops it.
    pending: Mutex<Option<Pending>>,
    attempts: AtomicU64,
    /// Services that signed in from a settings dialog not yet confirmed, by
    /// window: cancelling the dialog signs them out again.
    unconfirmed: Mutex<HashSet<(String, String)>>,
}

/// The state here is replaced a value at a time, so state a panic left
/// poisoned is still sound.
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs())
}

/// Where the credentials are kept, for a task of its own: a refresh runs on
/// after the request that asked for it is gone.
#[derive(Clone)]
struct Shelf {
    store: Arc<dyn SecretStore>,
}

impl Shelf {
    /// The service's credentials, read from the store the first time.
    async fn load(
        &self,
        profile: &str,
        slot: &mut Slot,
    ) -> Result<Option<Credentials>, ChatGptError> {
        if !slot.read {
            let store = self.store.clone();
            let account = format!("{PROFILE_ACCOUNT}{profile}");
            let stored = blocking(move || store.get(&account).map_err(ChatGptError::from)).await?;
            // An item that does not read back is as good as none: the next
            // sign-in writes over it.
            slot.credentials = stored.and_then(|stored| secrets::decode_record(&stored).ok());
            slot.read = true;
        }
        Ok(slot.credentials.clone())
    }

    async fn save(
        &self,
        profile: &str,
        slot: &mut Slot,
        credentials: Credentials,
    ) -> Result<(), ChatGptError> {
        let value = secrets::encode_record(&credentials)?;
        let store = self.store.clone();
        let account = format!("{PROFILE_ACCOUNT}{profile}");
        blocking(move || store.set(&account, &value).map_err(ChatGptError::from)).await?;
        slot.credentials = Some(credentials);
        slot.read = true;
        Ok(())
    }

    async fn delete(&self, profile: &str, slot: &mut Slot) -> Result<(), ChatGptError> {
        let store = self.store.clone();
        let account = format!("{PROFILE_ACCOUNT}{profile}");
        blocking(move || store.delete(&account).map_err(ChatGptError::from)).await?;
        slot.credentials = None;
        slot.read = true;
        Ok(())
    }
}

/// The credentials and the state the windows share.
struct Vault<'a> {
    state: &'a ChatGpt,
    shelf: Shelf,
}

impl<'a> Vault<'a> {
    fn of<R: Runtime>(app: &'a AppHandle<R>) -> Result<Self, ChatGptError> {
        let (store, _) = secrets::store(app)?;
        Ok(Self {
            state: app.state::<ChatGpt>().inner(),
            shelf: Shelf {
                store: Arc::from(store),
            },
        })
    }

    fn slot(&self, profile: &str) -> Result<SlotLock, ChatGptError> {
        secrets::account_for(profile)?;
        Ok(lock(&self.state.profiles)
            .entry(profile.to_string())
            .or_default()
            .clone())
    }

    async fn status(&self, profile: &str) -> Result<ChatGptStatus, ChatGptError> {
        let slot = self.slot(profile)?;
        let mut slot = slot.lock().await;
        Ok(status_of(
            self.shelf.load(profile, &mut slot).await?.as_ref(),
        ))
    }
}

/// What the token endpoint answers. Codex reads no `token_type`, and
/// OpenAI's tokens are bearer tokens, so an answer without one still counts.
#[derive(Debug, Serialize, Deserialize)]
struct TokenReply {
    access_token: AccessToken,
    #[serde(skip, default = "bearer")]
    token_type: BasicTokenType,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    refresh_token: Option<RefreshToken>,
    #[serde(default)]
    id_token: Option<String>,
}

fn bearer() -> BasicTokenType {
    BasicTokenType::Bearer
}

impl TokenResponse for TokenReply {
    type TokenType = BasicTokenType;

    fn access_token(&self) -> &AccessToken {
        &self.access_token
    }

    fn token_type(&self) -> &BasicTokenType {
        &self.token_type
    }

    fn expires_in(&self) -> Option<Duration> {
        self.expires_in.map(Duration::from_secs)
    }

    fn refresh_token(&self) -> Option<&RefreshToken> {
        self.refresh_token.as_ref()
    }

    fn scopes(&self) -> Option<&Vec<Scope>> {
        None
    }
}

impl TokenReply {
    /// When the access token runs out: as the answer says, else as the
    /// token itself says.
    fn expires_at(&self) -> Option<u64> {
        self.expires_in
            .map(|left| now() + left)
            .or_else(|| claims_of(self.access_token.secret()).and_then(|claims| claims.exp))
    }
}

type OAuthClient = oauth2::Client<
    BasicErrorResponse,
    TokenReply,
    BasicTokenIntrospectionResponse,
    StandardRevocableToken,
    BasicRevocationErrorResponse,
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointSet,
>;

fn oauth_client(issuer: &str) -> Result<OAuthClient, ChatGptError> {
    let bad = |error: oauth2::url::ParseError| ChatGptError::Network {
        message: error.to_string(),
    };
    Ok(oauth2::Client::new(ClientId::new(CLIENT_ID.into()))
        .set_auth_uri(AuthUrl::new(format!("{issuer}/oauth/authorize")).map_err(bad)?)
        .set_token_uri(TokenUrl::new(format!("{issuer}/oauth/token")).map_err(bad)?))
}

/// Why a request to the sign-in service failed before OpenAI could answer
/// it: it did not get there, or a server error stood in for the answer.
#[derive(Debug)]
enum HttpFailure {
    Network(String),
    Status(u16),
    /// A 401, with its body: whatever it says, the tokens or the client
    /// are no longer let in.
    Unauthorized(Vec<u8>),
}

impl std::fmt::Display for HttpFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Network(message) => f.write_str(message),
            Self::Status(status) => write!(f, "HTTP {status}"),
            Self::Unauthorized(_) => f.write_str("HTTP 401"),
        }
    }
}

impl std::error::Error for HttpFailure {}

/// The sign-in client, as the OAuth library sends through it.
struct OAuthHttp(reqwest::Client);

impl<'c> oauth2::AsyncHttpClient<'c> for OAuthHttp {
    type Error = HttpFailure;
    type Future = Pin<Box<dyn Future<Output = Result<oauth2::HttpResponse, HttpFailure>> + Send>>;

    fn call(&'c self, request: oauth2::HttpRequest) -> Self::Future {
        let client = self.0.clone();
        Box::pin(async move { send_oauth(&client, request).await })
    }
}

async fn send_oauth(
    client: &reqwest::Client,
    request: oauth2::HttpRequest,
) -> Result<oauth2::HttpResponse, HttpFailure> {
    let failed = |error: reqwest::Error| HttpFailure::Network(http::describe(&error));
    let request = reqwest::Request::try_from(request).map_err(failed)?;
    let response = client.execute(request).await.map_err(failed)?;
    let status = response.status();
    // Temporary, unlike an OAuth error: the credentials are kept.
    if status.is_server_error() {
        return Err(HttpFailure::Status(status.as_u16()));
    }
    let headers = response.headers().clone();
    let body = response.bytes().await.map_err(failed)?;
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(HttpFailure::Unauthorized(body.to_vec()));
    }
    let mut reply = oauth2::HttpResponse::new(body.to_vec());
    *reply.status_mut() = status;
    *reply.headers_mut() = headers;
    Ok(reply)
}

/// The code and message of an error the sign-in service answered with, in
/// the shapes it takes besides OAuth's: OpenAI's own, or a bare code.
fn error_detail(body: &[u8]) -> Option<(String, Option<String>)> {
    let json: Value = serde_json::from_slice(body).ok()?;
    let text = |value: Option<&Value>| {
        value
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(String::from)
    };
    let code = text(json.get("error"))
        .or_else(|| text(json.pointer("/error/code")))
        .or_else(|| text(json.get("code")))?;
    let message =
        text(json.get("error_description")).or_else(|| text(json.pointer("/error/message")));
    Some((code, message))
}

type TokenError = RequestTokenError<HttpFailure, BasicErrorResponse>;

fn oauth_failure(error: TokenError) -> ChatGptError {
    let invalid = |message: Option<String>| ChatGptError::OAuth {
        code: "invalid_response".into(),
        message,
    };
    match error {
        RequestTokenError::Request(HttpFailure::Unauthorized(body)) => {
            let (code, message) =
                error_detail(&body).unwrap_or_else(|| ("unauthorized".into(), None));
            ChatGptError::OAuth { code, message }
        }
        RequestTokenError::Request(failure) => ChatGptError::Network {
            message: failure.to_string(),
        },
        RequestTokenError::ServerResponse(response) => ChatGptError::OAuth {
            code: response.error().as_ref().to_string(),
            message: response.error_description().cloned(),
        },
        RequestTokenError::Parse(_, body) => match error_detail(&body) {
            Some((code, message)) => ChatGptError::OAuth { code, message },
            None => invalid(None),
        },
        RequestTokenError::Other(message) => invalid(Some(message)),
    }
}

/// Whether a refresh failed for good: the user has to sign in again.
fn ended(error: &TokenError) -> bool {
    match error {
        RequestTokenError::Request(HttpFailure::Unauthorized(_)) => true,
        RequestTokenError::ServerResponse(response) => ENDED.contains(&response.error().as_ref()),
        RequestTokenError::Parse(_, body) => {
            error_detail(body).is_some_and(|(code, _)| ENDED.contains(&code.as_str()))
        }
        _ => false,
    }
}

/// One trip through the browser.
struct Attempt {
    url: oauth2::url::Url,
    state: CsrfToken,
    verifier: String,
    redirect: RedirectUrl,
}

impl Attempt {
    /// `fresh` has the user sign in again, so they can pick another account
    /// than the one the browser is signed in to.
    fn new(issuer: &str, port: u16, fresh: bool) -> Result<Self, ChatGptError> {
        let client = oauth_client(issuer)?;
        // As the Codex CLI has it: OpenAI holds to the address exactly.
        let redirect = RedirectUrl::new(format!("http://127.0.0.1:{port}{CALLBACK_PATH}"))
            .map_err(|error| ChatGptError::Network {
                message: error.to_string(),
            })?;
        let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        let mut request = client
            .authorize_url(CsrfToken::new_random)
            .add_scopes(SCOPES.iter().map(|scope| Scope::new((*scope).into())))
            .set_pkce_challenge(challenge)
            .set_redirect_uri(Cow::Borrowed(&redirect))
            // The account's workspaces in the ID token, and the sign-in page
            // Codex gets.
            .add_extra_param("id_token_add_organizations", "true")
            .add_extra_param("codex_cli_simplified_flow", "true");
        if fresh {
            request = request.add_extra_param("prompt", "login");
        }
        let (url, state) = request.url();
        Ok(Self {
            url,
            state,
            verifier: verifier.secret().clone(),
            redirect,
        })
    }

    /// The code a callback brought, if it carries this attempt's `state`.
    fn accept(&self, query: &[(String, String)]) -> Option<Result<String, ChatGptError>> {
        let get = |name: &str| {
            query
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.as_str())
        };
        if CsrfToken::new(get("state")?.into()) != self.state {
            return None;
        }
        if let Some(error) = get("error") {
            let description = get("error_description");
            return Some(Err(match error {
                // OpenAI says so in the description alone, where Codex reads
                // it (`is_missing_codex_entitlement_error`).
                "access_denied"
                    if description.is_some_and(|description| {
                        description
                            .to_ascii_lowercase()
                            .contains("missing_codex_entitlement")
                    }) =>
                {
                    ChatGptError::NoCodex
                }
                "access_denied" => ChatGptError::AccessDenied,
                _ => ChatGptError::OAuth {
                    code: error.into(),
                    message: description.map(Into::into),
                },
            }));
        }
        Some(
            get("code")
                .filter(|code| !code.is_empty())
                .map(Into::into)
                .ok_or(ChatGptError::OAuth {
                    code: "invalid_response".into(),
                    message: None,
                }),
        )
    }
}

/// A request to the callback, which waits for the page to show.
struct Arrival {
    query: Vec<(String, String)>,
    reply: oneshot::Sender<String>,
}

/// The listener the browser comes back to. It stops when this is dropped.
struct Callbacks {
    port: u16,
    arrivals: mpsc::Receiver<Arrival>,
    _stop: DropGuard,
}

impl Callbacks {
    /// Waits for the callback of `attempt`. One that carries another
    /// `state` gets the failure page, and waiting goes on.
    async fn wait(
        &mut self,
        attempt: &Attempt,
        page: &CallbackPage,
    ) -> Result<(String, oneshot::Sender<String>), ChatGptError> {
        loop {
            let arrival = self.arrivals.recv().await.ok_or(ChatGptError::Cancelled)?;
            match attempt.accept(&arrival.query) {
                None => {
                    let _ = arrival.reply.send(page.html(false));
                }
                Some(Err(error)) => {
                    let _ = arrival.reply.send(page.html(false));
                    return Err(error);
                }
                Some(Ok(code)) => return Ok((code, arrival.reply)),
            }
        }
    }
}

/// Listens on the first of `ports` free on 127.0.0.1.
async fn listen(ports: &[u16]) -> Result<Callbacks, ChatGptError> {
    let failed = |error: std::io::Error| ChatGptError::Network {
        message: error.to_string(),
    };
    for &port in ports {
        for _ in 0..BIND_TRIES {
            match tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await {
                Ok(listener) => {
                    let port = listener.local_addr().map_err(failed)?.port();
                    return Ok(serve_callbacks(listener, port));
                }
                Err(error) if error.kind() == ErrorKind::AddrInUse => {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
                Err(error) => return Err(failed(error)),
            }
        }
    }
    Err(ChatGptError::PortsBusy)
}

fn serve_callbacks(listener: tokio::net::TcpListener, port: u16) -> Callbacks {
    let (arrive, arrivals) = mpsc::channel(8);
    let stop = CancellationToken::new();
    let running = stop.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match running.run_until_cancelled(listener.accept()).await {
                None => return,
                Some(Ok((stream, _))) => {
                    let arrive = arrive.clone();
                    // Left to finish when the listener stops, so the page
                    // being sent still arrives. One left waiting gets 410.
                    tauri::async_runtime::spawn(async move {
                        let connection = http1::Builder::new()
                            .keep_alive(false)
                            .timer(TokioTimer::new())
                            .header_read_timeout(Duration::from_secs(10))
                            .serve_connection(
                                TokioIo::new(stream),
                                service_fn(move |request| answer(request, arrive.clone())),
                            );
                        let _ = connection.await;
                    });
                }
                // Out of descriptors, say: the browser's next try may get in.
                Some(Err(_)) => tokio::time::sleep(Duration::from_millis(100)).await,
            }
        }
    });
    Callbacks {
        port,
        arrivals,
        _stop: stop.drop_guard(),
    }
}

async fn answer(
    request: Request<Incoming>,
    arrive: mpsc::Sender<Arrival>,
) -> Result<Response<Full<Bytes>>, Infallible> {
    if request.method() != Method::GET || request.uri().path() != CALLBACK_PATH {
        return Ok(page_response(StatusCode::NOT_FOUND, String::new()));
    }
    let query = url::form_urlencoded::parse(request.uri().query().unwrap_or_default().as_bytes())
        .into_owned()
        .collect();
    let (reply, page) = oneshot::channel();
    if arrive.send(Arrival { query, reply }).await.is_err() {
        return Ok(page_response(StatusCode::GONE, String::new()));
    }
    Ok(match page.await {
        Ok(html) => page_response(StatusCode::OK, html),
        Err(_) => page_response(StatusCode::GONE, String::new()),
    })
}

fn page_response(status: StatusCode, html: String) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(Bytes::from(html)));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    // The address holds the authorization code.
    headers.insert(REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    response
}

/// What a request to the backend is sent with.
struct Grant {
    access_token: String,
    account_id: Option<String>,
    fedramp: bool,
}

impl From<&Credentials> for Grant {
    fn from(credentials: &Credentials) -> Self {
        Self {
            access_token: credentials.access_token.clone(),
            account_id: credentials.account_id.clone(),
            fedramp: credentials.fedramp,
        }
    }
}

/// Signing in, and the tokens it yields, for one proxy setting.
pub struct Service<'a> {
    vault: Vault<'a>,
    http: reqwest::Client,
    issuer: String,
    backend: String,
    ports: Vec<u16>,
}

impl<'a> Service<'a> {
    pub fn of<R: Runtime>(
        app: &'a AppHandle<R>,
        proxy: &ProxySetting,
    ) -> Result<Self, ChatGptError> {
        Ok(Self {
            vault: Vault::of(app)?,
            http: http::oauth_client(app, proxy)?,
            issuer: ISSUER.into(),
            backend: BACKEND.into(),
            ports: PORTS.to_vec(),
        })
    }

    /// The tokens for a request of the service, renewed first when they are
    /// about to run out, or when `rejected` names the access token: the
    /// backend turned it down.
    async fn grant(&self, profile: &str, rejected: Option<&str>) -> Result<Grant, ChatGptError> {
        let mut slot = self.vault.slot(profile)?.lock_owned().await;
        let credentials = self
            .vault
            .shelf
            .load(profile, &mut slot)
            .await?
            .ok_or(ChatGptError::SignedOut)?;
        let due = credentials
            .expires_at
            .is_some_and(|at| at <= now() + REFRESH_MARGIN)
            || rejected == Some(credentials.access_token.as_str());
        if !due {
            return Ok(Grant::from(&credentials));
        }
        // OpenAI spends the refresh token as it answers, so the answer is
        // kept even when the request that asked for it is stopped.
        tauri::async_runtime::spawn(refresh(
            self.vault.shelf.clone(),
            self.http.clone(),
            self.issuer.clone(),
            profile.to_string(),
            slot,
            credentials,
        ))
        .await?
    }

    /// Signs the service in through the browser `open` shows the address
    /// in. `fresh` asks the user to sign in again, for another account.
    pub async fn sign_in(
        &self,
        profile: &str,
        fresh: bool,
        page: &CallbackPage,
        cancel: &CancellationToken,
        open: impl FnOnce(&str) -> Result<(), ChatGptError>,
    ) -> Result<ChatGptStatus, ChatGptError> {
        let mut callbacks = cancel
            .run_until_cancelled(listen(&self.ports))
            .await
            .ok_or(ChatGptError::Cancelled)??;
        let attempt = Attempt::new(&self.issuer, callbacks.port, fresh)?;
        open(attempt.url.as_str())?;
        let waited = cancel
            .run_until_cancelled(tokio::time::timeout(
                SIGN_IN_TIMEOUT,
                callbacks.wait(&attempt, page),
            ))
            .await;
        let (code, reply) = match waited {
            None => return Err(ChatGptError::Cancelled),
            Some(Err(_)) => return Err(ChatGptError::TimedOut),
            Some(Ok(arrived)) => arrived?,
        };
        let finished = self.finish(profile, &attempt, code).await;
        let _ = reply.send(page.html(finished.is_ok()));
        finished
    }

    async fn finish(
        &self,
        profile: &str,
        attempt: &Attempt,
        code: String,
    ) -> Result<ChatGptStatus, ChatGptError> {
        let reply = oauth_client(&self.issuer)?
            .exchange_code(AuthorizationCode::new(code))
            .set_pkce_verifier(PkceCodeVerifier::new(attempt.verifier.clone()))
            .set_redirect_uri(Cow::Borrowed(&attempt.redirect))
            .request_async(&OAuthHttp(self.http.clone()))
            .await
            .map_err(oauth_failure)?;
        let id = reply
            .id_token
            .as_deref()
            .and_then(claims_of)
            .unwrap_or_default();
        let access = claims_of(reply.access_token.secret()).unwrap_or_default();
        let credentials = Credentials {
            account_id: id.account_id().or_else(|| access.account_id()),
            fedramp: id.fedramp() || access.fedramp(),
            email: id.email().or_else(|| access.email()),
            expires_at: reply.expires_at(),
            access_token: reply.access_token.secret().clone(),
            refresh_token: reply.refresh_token.map(|token| token.secret().clone()),
        };
        let slot = self.vault.slot(profile)?;
        let mut slot = slot.lock().await;
        let earlier = self.vault.shelf.load(profile, &mut slot).await?;
        self.vault
            .shelf
            .save(profile, &mut slot, credentials.clone())
            .await?;
        // The sign-in it replaces ends at OpenAI too, as Codex ends it.
        if let Some(earlier) = earlier {
            let (http, issuer) = (self.http.clone(), self.issuer.clone());
            tauri::async_runtime::spawn(async move { revoke(&http, &issuer, &earlier).await });
        }
        Ok(status_of(Some(&credentials)))
    }

    /// Signs the service out: the session ends at OpenAI as far as it
    /// answers, and the tokens go.
    pub async fn sign_out(&self, profile: &str) -> Result<ChatGptSignOut, ChatGptError> {
        let slot = self.vault.slot(profile)?;
        let mut slot = slot.lock().await;
        let revoked = match self.vault.shelf.load(profile, &mut slot).await? {
            Some(credentials) => revoke(&self.http, &self.issuer, &credentials).await,
            None => true,
        };
        self.vault.shelf.delete(profile, &mut slot).await?;
        Ok(ChatGptSignOut {
            revoked,
            status: status_of(None),
        })
    }
}

/// Ends a session at OpenAI as Codex does (`login/src/auth/revoke.rs`):
/// the refresh token, else the access token. A failed connection or a server
/// error is tried again with backoff. True once OpenAI confirmed it.
async fn revoke(http: &reqwest::Client, issuer: &str, credentials: &Credentials) -> bool {
    let body = match &credentials.refresh_token {
        Some(token) => serde_json::json!({
            "token": token,
            "token_type_hint": "refresh_token",
            "client_id": CLIENT_ID,
        }),
        None => serde_json::json!({
            "token": credentials.access_token,
            "token_type_hint": "access_token",
        }),
    };
    for attempt in 0..REVOKE_TRIES {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_secs(1 << (attempt - 1))).await;
        }
        let sent = http
            .post(format!("{issuer}/oauth/revoke"))
            .header(CONTENT_TYPE, "application/json")
            .timeout(REVOKE_TIMEOUT)
            .body(body.to_string())
            .send()
            .await;
        match sent {
            Ok(response) if response.status().is_success() => return true,
            Ok(response) if !response.status().is_server_error() => return false,
            _ => {}
        }
    }
    false
}

/// Renews a service's access token with its refresh token, holding its
/// slot throughout so no other refresh spends the same token.
async fn refresh(
    shelf: Shelf,
    http: reqwest::Client,
    issuer: String,
    profile: String,
    mut slot: OwnedMutexGuard<Slot>,
    credentials: Credentials,
) -> Result<Grant, ChatGptError> {
    let Some(refresh_token) = credentials.refresh_token.clone() else {
        shelf.delete(&profile, &mut slot).await?;
        return Err(ChatGptError::SignInAgain);
    };
    let reply = oauth_client(&issuer)?
        .exchange_refresh_token(&RefreshToken::new(refresh_token))
        .request_async(&OAuthHttp(http))
        .await;
    let reply = match reply {
        Ok(reply) => reply,
        // The session ended at OpenAI: its tokens are no use.
        Err(error) if ended(&error) => {
            shelf.delete(&profile, &mut slot).await?;
            return Err(ChatGptError::SignInAgain);
        }
        Err(error) => return Err(oauth_failure(error)),
    };
    let id = reply.id_token.as_deref().and_then(claims_of);
    let next = Credentials {
        account_id: id
            .as_ref()
            .and_then(Claims::account_id)
            .or(credentials.account_id),
        fedramp: id.as_ref().map_or(credentials.fedramp, Claims::fedramp),
        email: id.as_ref().and_then(Claims::email).or(credentials.email),
        expires_at: reply.expires_at(),
        access_token: reply.access_token.secret().clone(),
        // A refresh token is spent once used; one not replaced stays.
        refresh_token: reply
            .refresh_token
            .map(|token| token.secret().clone())
            .or(credentials.refresh_token),
    };
    let grant = Grant::from(&next);
    shelf.save(&profile, &mut slot, next).await?;
    Ok(grant)
}

/// The address a request of a signed-in service goes to, read as reqwest
/// will send it, so long as it is within the backend: its tokens open the
/// whole ChatGPT account, which the rest of chatgpt.com serves.
fn backend_url(backend: &str, url: &str) -> Option<String> {
    let url = url::Url::parse(url).ok()?;
    url.as_str()
        .starts_with(&format!("{backend}/"))
        .then(|| url.into())
}

/// Sends a request of a service signed in with ChatGPT, with its tokens. A
/// 401 renews them and sends once more: OpenAI may have ended them before
/// their time.
pub async fn send(
    service: &Service<'_>,
    client: &reqwest::Client,
    profile: &str,
    method: &str,
    url: &str,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<reqwest::Response, FetchError> {
    let url = backend_url(&service.backend, url).ok_or_else(|| FetchError::BadUrl {
        url: url.to_string(),
    })?;
    let headers: Vec<(String, String)> = headers
        .into_iter()
        .filter(|(name, _)| !BACKEND_HEADERS.contains(&name.to_ascii_lowercase().as_str()))
        .collect();
    let with_grant = |grant: &Grant| {
        let mut headers = headers.clone();
        headers.push((
            "authorization".into(),
            format!("Bearer {}", grant.access_token),
        ));
        if let Some(account) = &grant.account_id {
            headers.push(("chatgpt-account-id".into(), account.clone()));
        }
        if grant.fedramp {
            headers.push(("x-openai-fedramp".into(), "true".into()));
        }
        headers.push(("originator".into(), ORIGINATOR.into()));
        headers
    };
    let grant = service.grant(profile, None).await?;
    let response = http::send(client, method, &url, with_grant(&grant), body.clone()).await?;
    if response.status() != reqwest::StatusCode::UNAUTHORIZED {
        return Ok(response);
    }
    match service.grant(profile, Some(&grant.access_token)).await {
        Ok(renewed) => http::send(client, method, &url, with_grant(&renewed), body).await,
        Err(error @ (ChatGptError::SignInAgain | ChatGptError::SignedOut)) => Err(error.into()),
        // Renewing failed for now; the page sees the 401 as it came.
        Err(_) => Ok(response),
    }
}

/// Starts the window's sign-in. Any other under way stops: the browser comes
/// back to the one port both would listen on.
fn begin<R: Runtime>(app: &AppHandle<R>, window: &str) -> (u64, CancellationToken) {
    let state = app.state::<ChatGpt>();
    let id = state.attempts.fetch_add(1, Ordering::Relaxed);
    let cancel = CancellationToken::new();
    let earlier = lock(&state.pending).replace(Pending {
        window: window.to_string(),
        id,
        cancel: cancel.clone(),
    });
    if let Some(earlier) = earlier {
        earlier.cancel.cancel();
    }
    (id, cancel)
}

fn end<R: Runtime>(app: &AppHandle<R>, id: u64) {
    let state = app.state::<ChatGpt>();
    let mut pending = lock(&state.pending);
    if pending.as_ref().is_some_and(|pending| pending.id == id) {
        *pending = None;
    }
}

fn cancel_window<R: Runtime>(app: &AppHandle<R>, window: &str) {
    let state = app.state::<ChatGpt>();
    let mut pending = lock(&state.pending);
    if pending
        .as_ref()
        .is_some_and(|pending| pending.window == window)
    {
        if let Some(pending) = pending.take() {
            pending.cancel.cancel();
        }
    }
}

/// Sign a service in with ChatGPT in the system browser. A sign-in already
/// under way stops.
#[tauri::command]
pub async fn ai_chatgpt_sign_in(
    app: AppHandle,
    window: Window,
    profile: String,
    proxy: Option<ProxySetting>,
    fresh: bool,
    page: CallbackPage,
) -> Result<ChatGptStatus, ChatGptError> {
    let (id, cancel) = begin(&app, window.label());
    let signed_in = async {
        let service = Service::of(&app, &proxy.unwrap_or_default())?;
        service
            .sign_in(&profile, fresh, &page, &cancel, |url| {
                app.opener()
                    .open_url(url, None::<&str>)
                    .map_err(|error| ChatGptError::Browser {
                        message: error.to_string(),
                    })
            })
            .await
    }
    .await;
    end(&app, id);
    if signed_in.is_ok() {
        lock(&app.state::<ChatGpt>().unconfirmed).insert((window.label().into(), profile));
    }
    signed_in
}

/// Stop the sign-in the window is waiting on.
#[tauri::command]
pub fn ai_chatgpt_cancel(app: AppHandle, window: Window) {
    cancel_window(&app, window.label());
}

#[tauri::command]
pub async fn ai_chatgpt_status(
    app: AppHandle,
    profile: String,
) -> Result<ChatGptStatus, ChatGptError> {
    Vault::of(&app)?.status(&profile).await
}

#[tauri::command]
pub async fn ai_chatgpt_sign_out(
    app: AppHandle,
    profile: String,
    proxy: Option<ProxySetting>,
) -> Result<ChatGptSignOut, ChatGptError> {
    Service::of(&app, &proxy.unwrap_or_default())?
        .sign_out(&profile)
        .await
}

/// The services that signed in from the window's settings dialog since it
/// opened, now that it is confirmed or cancelled.
pub fn take_unconfirmed<R: Runtime>(app: &AppHandle<R>, window: &str) -> Vec<String> {
    let state = app.state::<ChatGpt>();
    let mut unconfirmed = lock(&state.unconfirmed);
    let taken: Vec<(String, String)> = unconfirmed
        .iter()
        .filter(|(label, _)| label == window)
        .cloned()
        .collect();
    taken
        .into_iter()
        .filter_map(|key| unconfirmed.take(&key).map(|(_, profile)| profile))
        .collect()
}

/// Signs `profiles` out in the background.
pub fn forget_later<R: Runtime>(app: &AppHandle<R>, profiles: Vec<String>, proxy: ProxySetting) {
    if profiles.is_empty() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move { forget_all(&app, profiles, &proxy).await });
}

async fn forget_all<R: Runtime>(app: &AppHandle<R>, profiles: Vec<String>, proxy: &ProxySetting) {
    // A proxy setting that no longer builds is no reason to keep tokens.
    let service = Service::of(app, proxy).or_else(|_| Service::of(app, &ProxySetting::System));
    let Ok(service) = service else {
        return;
    };
    for profile in profiles {
        let _ = service.sign_out(&profile).await;
    }
}

/// The window's settings dialog was cancelled: services it signed in that
/// were not signing in with ChatGPT before sign out again.
pub fn abandon<R: Runtime>(app: &AppHandle<R>, window: &str, proxy: ProxySetting) {
    let profiles = take_unconfirmed(app, window);
    if profiles.is_empty() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let reader = app.clone();
        // The saved records come from the credential store, which may ask
        // the user, so they are read off the async threads.
        let leaving = blocking(move || {
            Ok::<_, ChatGptError>(
                profiles
                    .into_iter()
                    .filter(|profile| {
                        secrets::saved_auth(&reader, profile) != Some(AuthScheme::Chatgpt)
                    })
                    .collect::<Vec<_>>(),
            )
        })
        .await;
        if let Ok(leaving) = leaving {
            forget_all(&app, leaving, &proxy).await;
        }
    });
}

/// A closed window stops its sign-in, and its dialog can no longer be
/// confirmed.
pub fn forget_window<R: Runtime>(app: &AppHandle<R>, window: &str) {
    cancel_window(app, window);
    abandon(app, window, ProxySetting::default());
}

#[cfg(test)]
mod tests {
    use std::{collections::VecDeque, path::Path, sync::atomic::AtomicUsize};

    use http_body_util::BodyExt;
    use serde_json::json;

    use super::*;
    use crate::ai::secrets::FileStore;

    /// A token as OpenAI's read, unsigned: nothing here checks a signature.
    fn jwt(claims: &Value) -> String {
        format!("e30.{}.sig", URL_SAFE_NO_PAD.encode(claims.to_string()))
    }

    fn identity(account: &str) -> Value {
        json!({
            "email": "cat@example.com",
            AUTH_CLAIM: { "chatgpt_account_id": account },
        })
    }

    const AUTH_CLAIM: &str = "https://api.openai.com/auth";

    enum Reply {
        Tokens {
            refresh: Option<&'static str>,
            expires_in: u64,
            id: Option<Value>,
        },
        Status(u16, &'static str),
    }

    fn tokens(refresh: &'static str) -> Reply {
        Reply::Tokens {
            refresh: Some(refresh),
            expires_in: 3600,
            id: Some(identity("account-1")),
        }
    }

    /// A stand-in for OpenAI's sign-in service and the Codex backend.
    struct Issuer {
        url: String,
        replies: Mutex<VecDeque<Reply>>,
        forms: Mutex<Vec<Vec<(String, String)>>>,
        revokes: Mutex<VecDeque<u16>>,
        revoked: Mutex<Vec<Value>>,
        issued: AtomicUsize,
    }

    impl Issuer {
        fn reply(&self, reply: Reply) {
            lock(&self.replies).push_back(reply);
        }

        /// The token requests of a grant type, in order.
        fn sent(&self, grant: &str) -> Vec<Vec<(String, String)>> {
            lock(&self.forms)
                .iter()
                .filter(|form| field(form, "grant_type").as_deref() == Some(grant))
                .cloned()
                .collect()
        }

        /// The revocations asked for, once `count` have come.
        async fn revoked(&self, count: usize) -> Vec<Value> {
            for _ in 0..100 {
                let revoked = lock(&self.revoked).clone();
                if revoked.len() >= count {
                    return revoked;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            lock(&self.revoked).clone()
        }
    }

    fn field(pairs: &[(String, String)], name: &str) -> Option<String> {
        pairs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    }

    fn json_response(status: u16, body: String) -> Response<Full<Bytes>> {
        let mut response = Response::new(Full::new(Bytes::from(body)));
        *response.status_mut() = StatusCode::from_u16(status).unwrap();
        response
            .headers_mut()
            .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        response
    }

    async fn serve(
        issuer: Arc<Issuer>,
        request: Request<Incoming>,
    ) -> Result<Response<Full<Bytes>>, Infallible> {
        let path = request.uri().path().to_string();
        let header = |name: &str| {
            request
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(String::from)
        };
        Ok(match path.as_str() {
            "/oauth/token" => {
                let body = request.into_body().collect().await.unwrap().to_bytes();
                let form: Vec<(String, String)> =
                    url::form_urlencoded::parse(&body).into_owned().collect();
                lock(&issuer.forms).push(form);
                let reply = lock(&issuer.replies)
                    .pop_front()
                    .unwrap_or(Reply::Status(500, ""));
                match reply {
                    Reply::Status(status, body) => json_response(status, body.into()),
                    Reply::Tokens {
                        refresh,
                        expires_in,
                        id,
                    } => {
                        let n = issuer.issued.fetch_add(1, Ordering::SeqCst) + 1;
                        // No `token_type`, as Codex does without one.
                        let mut reply = json!({
                            "access_token": format!("access-{n}"),
                            "expires_in": expires_in,
                        });
                        if let Some(refresh) = refresh {
                            reply["refresh_token"] = refresh.into();
                        }
                        if let Some(id) = id {
                            reply["id_token"] = jwt(&id).into();
                        }
                        json_response(200, reply.to_string())
                    }
                }
            }
            "/oauth/revoke" => {
                let content_type = header("content-type");
                let body = request.into_body().collect().await.unwrap().to_bytes();
                assert_eq!(content_type.as_deref(), Some("application/json"));
                lock(&issuer.revoked).push(serde_json::from_slice(&body).unwrap());
                let status = lock(&issuer.revokes).pop_front().unwrap_or(200);
                json_response(status, "{}".into())
            }
            // The backend: turns the first access token down.
            "/codex/models" => {
                let bearer = header("authorization").unwrap_or_default();
                if bearer == "Bearer access-1" {
                    json_response(401, r#"{"detail":"expired"}"#.into())
                } else {
                    json_response(
                        200,
                        json!({
                            "bearer": bearer,
                            "account": header("chatgpt-account-id"),
                            "originator": header("originator"),
                            "fedramp": header("x-openai-fedramp"),
                            "page": header("x-page"),
                        })
                        .to_string(),
                    )
                }
            }
            _ => json_response(404, String::new()),
        })
    }

    fn issuer() -> (Arc<Issuer>, DropGuard) {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let issuer = Arc::new(Issuer {
            url: format!("http://127.0.0.1:{port}"),
            replies: Mutex::default(),
            forms: Mutex::default(),
            revokes: Mutex::default(),
            revoked: Mutex::default(),
            issued: AtomicUsize::new(0),
        });
        let stop = CancellationToken::new();
        let running = stop.clone();
        let serving = issuer.clone();
        tauri::async_runtime::spawn(async move {
            let listener = tokio::net::TcpListener::from_std(listener).unwrap();
            while let Some(Ok((stream, _))) = running.run_until_cancelled(listener.accept()).await {
                let issuer = serving.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = http1::Builder::new()
                        .keep_alive(false)
                        .serve_connection(
                            TokioIo::new(stream),
                            service_fn(move |request| serve(issuer.clone(), request)),
                        )
                        .await;
                });
            }
        });
        (issuer, stop.drop_guard())
    }

    fn service(issuer: &Issuer, dir: &Path) -> Service<'static> {
        let state: &'static ChatGpt = Box::leak(Box::default());
        Service {
            vault: Vault {
                state,
                shelf: Shelf {
                    store: Arc::new(FileStore::new(dir.join("keys.json"))),
                },
            },
            http: http::build_oauth_client(&ProxySetting::None).unwrap(),
            issuer: issuer.url.clone(),
            backend: format!("{}/codex", issuer.url),
            // Any free port: the test browser goes where it is sent.
            ports: vec![0],
        }
    }

    fn saved(dir: &Path, profile: &str) -> Option<Credentials> {
        FileStore::new(dir.join("keys.json"))
            .get(&format!("{PROFILE_ACCOUNT}{profile}"))
            .unwrap()
            .map(|stored| secrets::decode_record(&stored).unwrap())
    }

    async fn token(
        service: &Service<'_>,
        profile: &str,
        rejected: Option<&str>,
    ) -> Result<String, ChatGptError> {
        Ok(service.grant(profile, rejected).await?.access_token)
    }

    fn page() -> CallbackPage {
        CallbackPage {
            signed_in: "signed in".into(),
            failed: "failed".into(),
        }
    }

    /// What the test browser does with the address it is shown.
    #[derive(Default)]
    struct Browser {
        /// Comes back once with another `state` first.
        stray: bool,
        error: Option<&'static str>,
        description: Option<&'static str>,
    }

    struct Visit {
        /// The authorization request's parameters.
        query: Vec<(String, String)>,
        /// What the callback pages said.
        pages: Vec<String>,
    }

    async fn sign_in(
        service: &Service<'_>,
        profile: &str,
        fresh: bool,
        browser: Browser,
    ) -> (Result<ChatGptStatus, ChatGptError>, Visit) {
        let (shown, opened) = oneshot::channel::<String>();
        let visit = tauri::async_runtime::spawn(async move {
            let address = opened.await.unwrap();
            let query: Vec<(String, String)> = url::Url::parse(&address)
                .unwrap()
                .query_pairs()
                .into_owned()
                .collect();
            let redirect = field(&query, "redirect_uri").unwrap();
            let state = field(&query, "state").unwrap();
            let http = http::build_oauth_client(&ProxySetting::None).unwrap();
            let mut pages = Vec::new();
            let visit = |pairs: Vec<(&str, String)>| {
                let mut back = url::Url::parse(&redirect).unwrap();
                back.query_pairs_mut().extend_pairs(pairs);
                let http = http.clone();
                async move { http.get(back).send().await.unwrap().text().await.unwrap() }
            };
            if browser.stray {
                let page = visit(vec![("code", "stray".into()), ("state", "other".into())]);
                pages.push(page.await);
            }
            let mut pairs = vec![("state", state)];
            match browser.error {
                Some(error) => pairs.push(("error", error.into())),
                None => pairs.push(("code", "code-1".into())),
            }
            if let Some(description) = browser.description {
                pairs.push(("error_description", description.into()));
            }
            pages.push(visit(pairs).await);
            Visit { query, pages }
        });
        let signed_in = service
            .sign_in(profile, fresh, &page(), &CancellationToken::new(), |url| {
                shown.send(url.into()).unwrap();
                Ok(())
            })
            .await;
        (signed_in, visit.await.unwrap())
    }

    #[test]
    fn signing_in_goes_the_way_codex_does() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service = service(&issuer, dir.path());
        issuer.reply(tokens("refresh-1"));
        let browser = Browser {
            stray: true,
            ..Browser::default()
        };
        let (signed_in, visit) =
            tauri::async_runtime::block_on(sign_in(&service, "p1", false, browser));
        assert_eq!(
            signed_in,
            Ok(ChatGptStatus {
                signed_in: true,
                email: Some("cat@example.com".into()),
            })
        );
        assert_eq!(visit.pages, [page().html(false), page().html(true)]);

        let query = &visit.query;
        assert_eq!(field(query, "client_id").as_deref(), Some(CLIENT_ID));
        assert_eq!(field(query, "response_type").as_deref(), Some("code"));
        assert_eq!(
            field(query, "scope").as_deref(),
            Some("openid profile email offline_access")
        );
        assert_eq!(
            field(query, "code_challenge_method").as_deref(),
            Some("S256")
        );
        assert_eq!(
            field(query, "id_token_add_organizations").as_deref(),
            Some("true")
        );
        assert_eq!(
            field(query, "codex_cli_simplified_flow").as_deref(),
            Some("true")
        );
        assert_eq!(field(query, "prompt"), None);
        let redirect = field(query, "redirect_uri").unwrap();
        assert!(redirect.starts_with("http://127.0.0.1:"));
        assert!(redirect.ends_with(CALLBACK_PATH));

        let forms = issuer.sent("authorization_code");
        assert_eq!(forms.len(), 1);
        let form = &forms[0];
        assert_eq!(field(form, "code").as_deref(), Some("code-1"));
        assert_eq!(field(form, "client_id").as_deref(), Some(CLIENT_ID));
        assert_eq!(field(form, "redirect_uri"), Some(redirect));
        assert!(field(form, "code_verifier").is_some());

        let saved = saved(dir.path(), "p1").unwrap();
        assert_eq!(saved.account_id.as_deref(), Some("account-1"));
        assert_eq!(saved.refresh_token.as_deref(), Some("refresh-1"));
        assert!(saved.expires_at.is_some_and(|at| at > now() + 3000));
        assert_eq!(
            tauri::async_runtime::block_on(token(&service, "p1", None)).as_deref(),
            Ok("access-1")
        );
    }

    #[test]
    fn another_account_replaces_the_last_and_ends_it() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service = service(&issuer, dir.path());
        issuer.reply(tokens("refresh-1"));
        issuer.reply(Reply::Tokens {
            refresh: Some("refresh-2"),
            expires_in: 3600,
            id: Some(identity("account-2")),
        });
        tauri::async_runtime::block_on(async {
            sign_in(&service, "p1", false, Browser::default())
                .await
                .0
                .unwrap();
            let (signed_in, visit) = sign_in(&service, "p1", true, Browser::default()).await;
            assert!(signed_in.unwrap().signed_in);
            assert_eq!(field(&visit.query, "prompt").as_deref(), Some("login"));
            assert_eq!(
                issuer.revoked(1).await,
                [json!({
                    "token": "refresh-1",
                    "token_type_hint": "refresh_token",
                    "client_id": CLIENT_ID,
                })]
            );
        });
        assert_eq!(
            saved(dir.path(), "p1").unwrap().account_id.as_deref(),
            Some("account-2")
        );
    }

    #[test]
    fn declining_in_the_browser_stops_the_sign_in() {
        for (description, expected) in [
            (None, ChatGptError::AccessDenied),
            (
                Some("Missing_Codex_Entitlement: ask your admin"),
                ChatGptError::NoCodex,
            ),
        ] {
            let (issuer, _stop) = issuer();
            let dir = tempfile::tempdir().unwrap();
            let service = service(&issuer, dir.path());
            let browser = Browser {
                error: Some("access_denied"),
                description,
                ..Browser::default()
            };
            let (signed_in, visit) =
                tauri::async_runtime::block_on(sign_in(&service, "p1", false, browser));
            assert_eq!(signed_in, Err(expected));
            assert_eq!(visit.pages, [page().html(false)]);
            assert!(issuer.sent("authorization_code").is_empty());
        }
    }

    #[test]
    fn a_stopped_sign_in_ends_at_once() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service = service(&issuer, dir.path());
        let cancel = CancellationToken::new();
        let signed_in =
            tauri::async_runtime::block_on(service.sign_in("p1", false, &page(), &cancel, |_| {
                cancel.cancel();
                Ok(())
            }));
        assert_eq!(signed_in, Err(ChatGptError::Cancelled));
    }

    #[test]
    fn the_next_port_is_taken_while_one_is_held() {
        let held = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let busy = held.local_addr().unwrap().port();
        tauri::async_runtime::block_on(async {
            assert!(matches!(
                listen(&[busy]).await,
                Err(ChatGptError::PortsBusy)
            ));
            let callbacks = listen(&[busy, 0]).await.unwrap();
            assert_ne!(callbacks.port, busy);
        });
    }

    #[test]
    fn a_refresh_replaces_the_tokens_it_is_given() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service = service(&issuer, dir.path());
        // Runs out within the margin, so the first request renews it.
        issuer.reply(Reply::Tokens {
            refresh: Some("refresh-1"),
            expires_in: 60,
            id: Some(identity("account-1")),
        });
        issuer.reply(Reply::Tokens {
            refresh: Some("refresh-2"),
            expires_in: 3600,
            id: Some(identity("account-2")),
        });
        // A refresh token that is not replaced stays.
        issuer.reply(Reply::Tokens {
            refresh: None,
            expires_in: 3600,
            id: None,
        });
        tauri::async_runtime::block_on(async {
            sign_in(&service, "p1", false, Browser::default())
                .await
                .0
                .unwrap();
            assert_eq!(token(&service, "p1", None).await.as_deref(), Ok("access-2"));
            assert_eq!(
                token(&service, "p1", Some("access-2")).await.as_deref(),
                Ok("access-3")
            );
        });
        let forms = issuer.sent("refresh_token");
        assert_eq!(forms.len(), 2);
        let form = &forms[0];
        assert_eq!(field(form, "refresh_token").as_deref(), Some("refresh-1"));
        assert_eq!(field(form, "client_id").as_deref(), Some(CLIENT_ID));
        assert_eq!(field(form, "scope"), None);
        assert_eq!(
            field(&forms[1], "refresh_token").as_deref(),
            Some("refresh-2")
        );
        let saved = saved(dir.path(), "p1").unwrap();
        assert_eq!(saved.access_token, "access-3");
        assert_eq!(saved.refresh_token.as_deref(), Some("refresh-2"));
        assert_eq!(saved.account_id.as_deref(), Some("account-2"));
        assert_eq!(saved.email.as_deref(), Some("cat@example.com"));
    }

    #[test]
    fn requests_turned_down_together_refresh_once() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service: &'static Service<'static> = Box::leak(Box::new(service(&issuer, dir.path())));
        issuer.reply(tokens("refresh-1"));
        issuer.reply(tokens("refresh-2"));
        tauri::async_runtime::block_on(async {
            sign_in(service, "p1", false, Browser::default())
                .await
                .0
                .unwrap();
            let renew = || tauri::async_runtime::spawn(token(service, "p1", Some("access-1")));
            let (first, second) = (renew(), renew());
            assert_eq!(first.await.unwrap().as_deref(), Ok("access-2"));
            assert_eq!(second.await.unwrap().as_deref(), Ok("access-2"));
        });
        assert_eq!(issuer.sent("refresh_token").len(), 1);
    }

    #[test]
    fn a_refresh_token_that_no_longer_works_asks_to_sign_in_again() {
        for (status, body) in [
            (
                400,
                r#"{"error":"invalid_grant","error_description":"expired"}"#,
            ),
            (
                400,
                r#"{"error":{"code":"refresh_token_reused","message":"used"}}"#,
            ),
            (400, r#"{"code":"refresh_token_expired"}"#),
            (401, r#"{"error":"invalid_client"}"#),
            (401, ""),
        ] {
            let (issuer, _stop) = issuer();
            let dir = tempfile::tempdir().unwrap();
            let service = service(&issuer, dir.path());
            issuer.reply(tokens("refresh-1"));
            issuer.reply(Reply::Status(status, body));
            tauri::async_runtime::block_on(async {
                sign_in(&service, "p1", false, Browser::default())
                    .await
                    .0
                    .unwrap();
                assert_eq!(
                    token(&service, "p1", Some("access-1")).await,
                    Err(ChatGptError::SignInAgain),
                    "{body}"
                );
                assert_eq!(
                    token(&service, "p1", None).await,
                    Err(ChatGptError::SignedOut)
                );
            });
            assert_eq!(saved(dir.path(), "p1"), None);
        }
    }

    #[test]
    fn a_failure_for_now_keeps_the_sign_in() {
        for (status, body) in [(503, ""), (400, r#"{"error":"temporarily_unavailable"}"#)] {
            let (issuer, _stop) = issuer();
            let dir = tempfile::tempdir().unwrap();
            let service = service(&issuer, dir.path());
            issuer.reply(tokens("refresh-1"));
            issuer.reply(Reply::Status(status, body));
            tauri::async_runtime::block_on(async {
                sign_in(&service, "p1", false, Browser::default())
                    .await
                    .0
                    .unwrap();
                let renewed = token(&service, "p1", Some("access-1")).await;
                assert!(
                    matches!(
                        renewed,
                        Err(ChatGptError::Network { .. } | ChatGptError::OAuth { .. })
                    ),
                    "{renewed:?}"
                );
                assert!(service.vault.status("p1").await.unwrap().signed_in);
            });
        }
    }

    #[test]
    fn requests_reach_the_backend_alone_with_the_account() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service = service(&issuer, dir.path());
        let fedramp = || Reply::Tokens {
            refresh: Some("refresh-1"),
            expires_in: 3600,
            id: Some(json!({
                AUTH_CLAIM: {
                    "chatgpt_account_id": "account-1",
                    "chatgpt_account_is_fedramp": true,
                },
            })),
        };
        issuer.reply(fedramp());
        issuer.reply(fedramp());
        let client = http::build_client(&ProxySetting::None).unwrap();
        let headers = vec![
            ("Authorization".to_string(), "Bearer page".to_string()),
            ("originator".into(), "page".into()),
            ("ChatGPT-Account-Id".into(), "page".into()),
            ("x-page".into(), "1".into()),
        ];
        tauri::async_runtime::block_on(async {
            sign_in(&service, "p1", false, Browser::default())
                .await
                .0
                .unwrap();
            let url = format!("{}/codex/models", issuer.url);
            let response = send(&service, &client, "p1", "GET", &url, headers, None)
                .await
                .unwrap();
            assert_eq!(response.status(), reqwest::StatusCode::OK);
            let body: Value = response.json().await.unwrap();
            assert_eq!(
                body,
                json!({
                    "bearer": "Bearer access-2",
                    "account": "account-1",
                    "originator": ORIGINATOR,
                    "fedramp": "true",
                    "page": "1",
                })
            );
            for elsewhere in [
                format!("{}/oauth/token", issuer.url),
                format!("{}/codex/../oauth/token", issuer.url),
                format!("{}/codexes", issuer.url),
                "https://example.com/codex/models".into(),
            ] {
                let sent = send(&service, &client, "p1", "GET", &elsewhere, Vec::new(), None).await;
                assert!(
                    matches!(sent, Err(FetchError::BadUrl { .. })),
                    "{elsewhere}"
                );
            }
        });
    }

    #[test]
    fn signing_out_ends_the_session_at_openai() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service = service(&issuer, dir.path());
        issuer.reply(tokens("refresh-1"));
        issuer.reply(tokens("refresh-2"));
        // Turned down: signed out all the same.
        lock(&issuer.revokes).extend([200, 400]);
        tauri::async_runtime::block_on(async {
            sign_in(&service, "p1", false, Browser::default())
                .await
                .0
                .unwrap();
            let signed_out = service.sign_out("p1").await.unwrap();
            assert!(signed_out.revoked);
            assert!(!signed_out.status.signed_in);
            assert_eq!(saved(dir.path(), "p1"), None);

            sign_in(&service, "p1", false, Browser::default())
                .await
                .0
                .unwrap();
            assert!(!service.sign_out("p1").await.unwrap().revoked);
            assert_eq!(saved(dir.path(), "p1"), None);
        });
        let revoked = lock(&issuer.revoked).clone();
        assert_eq!(revoked.len(), 2);
        assert_eq!(revoked[0]["token"], "refresh-1");
        assert_eq!(revoked[1]["token"], "refresh-2");
    }

    #[test]
    fn claims_are_read_from_either_token() {
        let claims = claims_of(&jwt(&json!({
            "https://api.openai.com/profile": { "email": "cat@example.com" },
            AUTH_CLAIM: { "chatgpt_account_id": "account-1" },
            "exp": 42,
        })))
        .unwrap();
        assert_eq!(claims.email().as_deref(), Some("cat@example.com"));
        assert_eq!(claims.account_id().as_deref(), Some("account-1"));
        assert_eq!(claims.exp, Some(42));
        assert!(!claims.fedramp());
        assert!(claims_of("access-1").is_none());
        assert!(claims_of("a.not base64.c").is_none());
    }

    #[test]
    fn the_callback_page_escapes_its_text() {
        assert_eq!(
            escape_html(r#"<b>"Tom" & 'Jerry'</b>"#),
            "&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;"
        );
        let page = CallbackPage {
            signed_in: "<ok>".into(),
            failed: "no".into(),
        };
        assert!(page.html(true).contains("<p>&lt;ok&gt;</p>"));
    }

    #[test]
    fn errors_reach_the_page_by_kind() {
        assert_eq!(
            serde_json::to_value(ChatGptError::SignInAgain).unwrap(),
            json!({ "kind": "sign-in-again" })
        );
        assert_eq!(
            serde_json::to_value(ChatGptError::NoCodex).unwrap(),
            json!({ "kind": "no-codex" })
        );
        assert_eq!(
            serde_json::to_value(ChatGptError::PortsBusy).unwrap(),
            json!({ "kind": "ports-busy" })
        );
        assert_eq!(
            serde_json::to_value(ChatGptError::OAuth {
                code: "invalid_client".into(),
                message: None
            })
            .unwrap(),
            json!({ "kind": "oauth", "code": "invalid_client", "message": null })
        );
    }
}
