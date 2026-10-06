//! Sign in with ChatGPT: a service that signs in with a ChatGPT account uses
//! the user's ChatGPT plan in place of an API key.
//!
//! Each service holds a registration of its own: the client id OpenAI issued
//! when the user first approved NyaMark for that account, and the tokens of
//! the last sign-in. They are kept in the credential store beside the keys,
//! and like the keys never reach the webview: a request through `http.rs`
//! gets the access token here, renewed as it runs out.
//!
//! The flow is the one OpenAI describes for open-source apps
//! (developers.openai.com/siwc): OAuth with PKCE in the system browser, which
//! comes back to a listener on 127.0.0.1, then the ID token checked against
//! OpenAI's published keys.

use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    convert::Infallible,
    future::Future,
    net::Ipv4Addr,
    pin::Pin,
    str::FromStr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, PoisonError,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

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
use jsonwebtoken::{jwk::JwkSet, Algorithm, DecodingKey, Validation};
use oauth2::{
    basic::{
        BasicErrorResponse, BasicRevocationErrorResponse, BasicTokenIntrospectionResponse,
        BasicTokenType,
    },
    AuthUrl, AuthorizationCode, ClientId, CsrfToken, EndpointMaybeSet, EndpointNotSet, EndpointSet,
    ExtraTokenFields, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, RefreshToken,
    RequestTokenError, RevocationUrl, Scope, StandardRevocableToken, StandardTokenResponse,
    TokenResponse, TokenUrl,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
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
pub const ISSUER: &str = "https://auth.openai.com";
/// The API the tokens are for, and the only place they are sent.
pub const RESOURCE: &str = "https://api.openai.com/v1";
/// The client id a first sign-in to an account registers through. OpenAI
/// answers it with the id issued to NyaMark for that account.
const DYNAMIC_CLIENT: &str = "dynamic_agent_client";
/// The name OpenAI shows the user for NyaMark, which they may change.
const AGENT_NAME: &str = "NyaMark";
/// Granted when the user lets NyaMark use their ChatGPT plan.
const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
const SCOPES: [&str; 6] = [
    "openid",
    "profile",
    "email",
    "offline_access",
    "resource.invoke",
    PLAN_SCOPE,
];
const CALLBACK_PATH: &str = "/auth/callback";
/// How long the browser may take to come back.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(600);
/// An access token this close to its end is renewed before it is sent.
const REFRESH_MARGIN: u64 = 120;
/// Clock difference allowed when checking an ID token's times.
const LEEWAY: u64 = 5;
/// Tries at ending a session at OpenAI before signing out without it.
const REVOKE_TRIES: u32 = 4;
/// Refresh errors after which the refresh token is no use: the user has to
/// sign in again.
const ENDED: [&str; 6] = [
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
];
/// The store account holding the id of this install, which OpenAI asks for
/// with every sign-in. A profile id has no dot, so no service's account
/// can take this name.
const HOST_ACCOUNT: &str = "chatgpt.host";
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
    /// Signed in without letting NyaMark use the ChatGPT plan.
    PlanDisabled,
    /// The user declined in the browser.
    AccessDenied,
    /// Another sign-in started in the window, or it was stopped.
    Cancelled,
    TimedOut,
    /// The browser signed in to another account than the service's.
    AccountMismatch,
    /// A first sign-in came back without the client id OpenAI issues.
    RegistrationIncomplete,
    /// The ID token did not hold up.
    IdToken {
        message: String,
    },
    /// OpenAI answered with an OAuth error.
    #[serde(rename = "oauth")]
    OAuth {
        code: String,
        message: Option<String>,
    },
    /// OpenAI's sign-in configuration could not be read.
    Discovery {
        message: String,
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

fn network(error: &reqwest::Error) -> ChatGptError {
    ChatGptError::Network {
        message: http::describe(error),
    }
}

/// What a service keeps of its ChatGPT account. A registration outlives
/// signing out; only its tokens go.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(Debug))]
struct Credentials {
    issuer: String,
    /// Issued by OpenAI for this account on its first sign-in.
    client_id: String,
    /// The account, from the first verified ID token.
    #[serde(default)]
    subject: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    name: Option<String>,
    /// The last ID token, which tells OpenAI the account on the next
    /// sign-in. Dropped on signing out.
    #[serde(default)]
    id_token: Option<String>,
    #[serde(default)]
    session: Option<Session>,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(Debug))]
struct Session {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    /// Unix seconds.
    #[serde(default)]
    expires_at: Option<u64>,
    #[serde(default)]
    scopes: Vec<String>,
}

impl Session {
    fn plan_enabled(&self) -> bool {
        self.scopes.iter().any(|scope| scope == PLAN_SCOPE)
    }
}

/// What the settings show of a service's ChatGPT account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptStatus {
    /// Approved for an account once, so signing in again skips that step.
    pub registered: bool,
    pub signed_in: bool,
    pub plan_enabled: bool,
    pub email: Option<String>,
    pub name: Option<String>,
}

fn status_of(credentials: Option<&Credentials>) -> ChatGptStatus {
    let session = credentials.and_then(|credentials| credentials.session.as_ref());
    ChatGptStatus {
        registered: credentials.is_some(),
        signed_in: session.is_some(),
        plan_enabled: session.is_some_and(Session::plan_enabled),
        email: credentials.and_then(|credentials| credentials.email.clone()),
        name: credentials.and_then(|credentials| credentials.name.clone()),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptSignIn {
    pub status: ChatGptStatus,
    /// A first sign-in that may use the plan, which the page welcomes.
    pub welcome: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptSignOut {
    /// OpenAI confirmed the session ended. When it did not, the user can
    /// still disconnect NyaMark in ChatGPT's settings.
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

/// OpenAI's published sign-in configuration.
#[derive(Debug, Deserialize)]
struct Discovery {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default)]
    revocation_endpoint: Option<String>,
    jwks_uri: String,
    #[serde(default)]
    id_token_signing_alg_values_supported: Vec<String>,
}

/// One service's credentials, read once and then kept here. Its lock also
/// keeps two refreshes from racing: each one spends the refresh token.
#[derive(Default)]
struct Slot {
    read: bool,
    credentials: Option<Credentials>,
}

type SlotLock = Arc<tokio::sync::Mutex<Slot>>;

/// Sign-in state shared by the windows.
#[derive(Default)]
pub struct ChatGpt {
    discovery: tokio::sync::Mutex<Option<Arc<Discovery>>>,
    keys: tokio::sync::Mutex<Option<Arc<JwkSet>>>,
    host: tokio::sync::Mutex<Option<String>>,
    profiles: Mutex<HashMap<String, SlotLock>>,
    /// The sign-in each window is waiting on, so a new one or a closed
    /// window stops it.
    pending: Mutex<HashMap<String, (u64, CancellationToken)>>,
    attempts: AtomicU64,
    /// Services that signed in from a settings dialog not yet confirmed, by
    /// window: cancelling the dialog signs them out again.
    unconfirmed: Mutex<HashSet<(String, String)>>,
}

/// The maps here are replaced an entry at a time, so one a panic left
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
    issuer: String,
}

impl Shelf {
    /// The service's credentials from this issuer, read from the store the
    /// first time.
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
        Ok(slot
            .credentials
            .clone()
            .filter(|credentials| credentials.issuer == self.issuer))
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
                issuer: ISSUER.into(),
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

    /// This install's id, made on first use and kept from then on.
    async fn host_id(&self) -> Result<String, ChatGptError> {
        let mut host = self.state.host.lock().await;
        if let Some(id) = host.as_ref() {
            return Ok(id.clone());
        }
        let store = self.shelf.store.clone();
        let id = blocking(move || {
            let saved = store
                .get(HOST_ACCOUNT)?
                .and_then(|stored| secrets::decode_record::<String>(&stored).ok());
            if let Some(id) = saved {
                return Ok(id);
            }
            let id = format!("urn:uuid:{}", uuid::Uuid::new_v4());
            store.set(HOST_ACCOUNT, &secrets::encode_record(&id)?)?;
            Ok::<_, ChatGptError>(id)
        })
        .await?;
        *host = Some(id.clone());
        Ok(id)
    }
}

/// The ID token, which the token endpoint returns beside the OAuth fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct IdTokenField {
    #[serde(default)]
    id_token: Option<String>,
}

impl ExtraTokenFields for IdTokenField {}

type TokenReply = StandardTokenResponse<IdTokenField, BasicTokenType>;

type OAuthClient = oauth2::Client<
    BasicErrorResponse,
    TokenReply,
    BasicTokenIntrospectionResponse,
    StandardRevocableToken,
    BasicRevocationErrorResponse,
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointMaybeSet,
    EndpointSet,
>;

fn oauth_client(discovery: &Discovery, client_id: &str) -> Result<OAuthClient, ChatGptError> {
    let bad = |error: oauth2::url::ParseError| ChatGptError::Discovery {
        message: error.to_string(),
    };
    let revocation = discovery
        .revocation_endpoint
        .clone()
        .map(RevocationUrl::new)
        .transpose()
        .map_err(bad)?;
    Ok(oauth2::Client::new(ClientId::new(client_id.into()))
        .set_auth_uri(AuthUrl::new(discovery.authorization_endpoint.clone()).map_err(bad)?)
        .set_token_uri(TokenUrl::new(discovery.token_endpoint.clone()).map_err(bad)?)
        .set_revocation_url_option(revocation))
}

/// Why a request to the sign-in service failed before OpenAI could answer
/// it: it did not get there, or a server error stood in for the answer.
#[derive(Debug)]
enum HttpFailure {
    Network(String),
    Status(u16),
}

impl std::fmt::Display for HttpFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Network(message) => f.write_str(message),
            Self::Status(status) => write!(f, "HTTP {status}"),
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
    let mut reply = oauth2::HttpResponse::new(body.to_vec());
    *reply.status_mut() = status;
    *reply.headers_mut() = headers;
    Ok(reply)
}

/// OpenAI's own error shape, which some of its sign-in errors take in place
/// of OAuth's.
#[derive(Deserialize)]
struct OpenAiError {
    error: OpenAiErrorBody,
}

#[derive(Deserialize)]
struct OpenAiErrorBody {
    #[serde(default)]
    code: Option<String>,
    #[serde(default, rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

fn oauth_failure(error: RequestTokenError<HttpFailure, BasicErrorResponse>) -> ChatGptError {
    let invalid = |message: Option<String>| ChatGptError::OAuth {
        code: "invalid_response".into(),
        message,
    };
    match error {
        RequestTokenError::Request(failure) => ChatGptError::Network {
            message: failure.to_string(),
        },
        RequestTokenError::ServerResponse(response) => ChatGptError::OAuth {
            code: response.error().as_ref().to_string(),
            message: response.error_description().cloned(),
        },
        RequestTokenError::Parse(_, body) => match serde_json::from_slice::<OpenAiError>(&body) {
            Ok(OpenAiError { error }) => match error.code.or(error.kind) {
                Some(code) => ChatGptError::OAuth {
                    code,
                    message: error.message,
                },
                None => invalid(error.message),
            },
            Err(_) => invalid(None),
        },
        RequestTokenError::Other(message) => invalid(Some(message)),
    }
}

/// The claims of an ID token NyaMark reads.
#[derive(Debug, Deserialize)]
struct IdClaims {
    sub: String,
    #[serde(default)]
    nonce: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    name: Option<String>,
    iat: u64,
}

#[derive(Debug, PartialEq, Eq)]
enum Rejected {
    /// Signed with a key not among those fetched: OpenAI may have rotated
    /// its keys since.
    UnknownKey,
    Invalid(String),
}

fn verify_id_token(
    token: &str,
    discovery: &Discovery,
    keys: &JwkSet,
    client_id: &str,
    nonce: &str,
) -> Result<IdClaims, Rejected> {
    let invalid = |error: jsonwebtoken::errors::Error| Rejected::Invalid(error.to_string());
    let header = jsonwebtoken::decode_header(token).map_err(invalid)?;
    let allowed: Vec<&str> = if discovery.id_token_signing_alg_values_supported.is_empty() {
        vec!["RS256"]
    } else {
        discovery
            .id_token_signing_alg_values_supported
            .iter()
            .map(String::as_str)
            .collect()
    };
    // A shared-secret algorithm would need a secret, which NyaMark, a
    // public client, does not have.
    let permitted = allowed
        .iter()
        .filter_map(|name| Algorithm::from_str(name).ok())
        .filter(|algorithm| {
            !matches!(
                algorithm,
                Algorithm::HS256 | Algorithm::HS384 | Algorithm::HS512
            )
        })
        .any(|algorithm| algorithm == header.alg);
    if !permitted {
        return Err(Rejected::Invalid(format!(
            "algorithm {:?} not allowed",
            header.alg
        )));
    }
    let jwk = match &header.kid {
        Some(kid) => keys.find(kid).ok_or(Rejected::UnknownKey)?,
        None => match keys.keys.as_slice() {
            [only] => only,
            _ => return Err(Rejected::UnknownKey),
        },
    };
    if let Some(algorithm) = &jwk.common.key_algorithm {
        if Algorithm::from_str(&algorithm.to_string()).ok() != Some(header.alg) {
            return Err(Rejected::Invalid(format!(
                "key is for {algorithm}, token uses {:?}",
                header.alg
            )));
        }
    }
    let key = DecodingKey::from_jwk(jwk).map_err(invalid)?;
    let mut validation = Validation::new(header.alg);
    validation.set_issuer(&[&discovery.issuer]);
    validation.set_audience(&[client_id]);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    validation.leeway = LEEWAY;
    let claims = jsonwebtoken::decode::<IdClaims>(token, &key, &validation)
        .map_err(invalid)?
        .claims;
    if claims.iat > now() + LEEWAY {
        return Err(Rejected::Invalid("issued in the future".into()));
    }
    let nonce_matches = claims
        .nonce
        .as_ref()
        .is_some_and(|claimed| CsrfToken::new(claimed.clone()) == CsrfToken::new(nonce.into()));
    if !nonce_matches {
        return Err(Rejected::Invalid("nonce does not match".into()));
    }
    Ok(claims)
}

/// One trip through the browser.
struct Attempt {
    url: oauth2::url::Url,
    state: CsrfToken,
    nonce: String,
    verifier: String,
    redirect: RedirectUrl,
    /// The issued client id it signs in with; none for a first sign-in,
    /// whose id comes back with the browser.
    client_id: Option<String>,
}

/// A callback that belongs to the attempt.
struct Accepted {
    code: String,
    client_id: String,
    /// The callback issued the client id: a first sign-in.
    registered_now: bool,
    scope: Option<String>,
}

impl Attempt {
    fn new(
        discovery: &Discovery,
        registration: Option<&Credentials>,
        host: &str,
        consent: bool,
        port: u16,
    ) -> Result<Self, ChatGptError> {
        let client_id = registration.map(|registration| registration.client_id.clone());
        let client = oauth_client(discovery, client_id.as_deref().unwrap_or(DYNAMIC_CLIENT))?;
        // Only the port may change between sign-ins; OpenAI holds to the
        // rest, `127.0.0.1` included.
        let redirect = RedirectUrl::new(format!("http://127.0.0.1:{port}{CALLBACK_PATH}"))
            .map_err(|error| ChatGptError::Network {
                message: error.to_string(),
            })?;
        let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        let nonce = CsrfToken::new_random().secret().clone();
        let mut request = client
            .authorize_url(CsrfToken::new_random)
            .add_scopes(SCOPES.iter().map(|scope| Scope::new((*scope).into())))
            .set_pkce_challenge(challenge)
            .set_redirect_uri(Cow::Borrowed(&redirect))
            .add_extra_param("resource", RESOURCE)
            .add_extra_param("nonce", nonce.clone())
            .add_extra_param("ext_agent_host_id", host.to_string());
        match registration {
            None => request = request.add_extra_param("agent_name_hint", AGENT_NAME),
            Some(registration) => {
                if let Some(hint) = &registration.id_token {
                    request = request.add_extra_param("id_token_hint", hint.clone());
                }
                if let Some(email) = &registration.email {
                    request = request.add_extra_param("login_hint", email.clone());
                }
            }
        }
        // Asks again for what the user declined before, instead of passing
        // straight back as an approved sign-in does.
        if consent {
            request = request.add_extra_param("prompt", "consent");
        }
        let (url, state) = request.url();
        Ok(Self {
            url,
            state,
            nonce,
            verifier: verifier.secret().clone(),
            redirect,
            client_id,
        })
    }

    /// What a callback brought, if it carries this attempt's `state`.
    fn accept(&self, query: &[(String, String)]) -> Option<Result<Accepted, ChatGptError>> {
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
            return Some(Err(if error == "access_denied" {
                ChatGptError::AccessDenied
            } else {
                ChatGptError::OAuth {
                    code: error.into(),
                    message: get("error_description").map(Into::into),
                }
            }));
        }
        let Some(code) = get("code") else {
            return Some(Err(ChatGptError::OAuth {
                code: "invalid_response".into(),
                message: None,
            }));
        };
        let issued = get("client_id").filter(|id| !id.is_empty());
        let (client_id, registered_now) = match (&self.client_id, issued) {
            (None, Some(id)) if id != DYNAMIC_CLIENT => (id.to_string(), true),
            (None, _) => return Some(Err(ChatGptError::RegistrationIncomplete)),
            // The browser went through another registration than the one
            // asked for; it may not replace this one.
            (Some(ours), Some(id)) if id != ours.as_str() => {
                return Some(Err(ChatGptError::AccountMismatch))
            }
            (Some(ours), _) => (ours.clone(), false),
        };
        Some(Ok(Accepted {
            code: code.into(),
            client_id,
            registered_now,
            scope: get("scope").map(Into::into),
        }))
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
    ) -> Result<(Accepted, oneshot::Sender<String>), ChatGptError> {
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
                Some(Ok(accepted)) => return Ok((accepted, arrival.reply)),
            }
        }
    }
}

async fn listen() -> Result<Callbacks, ChatGptError> {
    let failed = |error: std::io::Error| ChatGptError::Network {
        message: error.to_string(),
    };
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(failed)?;
    let port = listener.local_addr().map_err(failed)?.port();
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
    Ok(Callbacks {
        port,
        arrivals,
        _stop: stop.drop_guard(),
    })
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

/// Signing in, and the tokens it yields, for one proxy setting.
pub struct Service<'a> {
    vault: Vault<'a>,
    http: reqwest::Client,
}

impl<'a> Service<'a> {
    pub fn of<R: Runtime>(
        app: &'a AppHandle<R>,
        proxy: &ProxySetting,
    ) -> Result<Self, ChatGptError> {
        Ok(Self {
            vault: Vault::of(app)?,
            http: http::oauth_client(app, proxy)?,
        })
    }

    async fn get_json<T: DeserializeOwned>(&self, url: &str) -> Result<T, ChatGptError> {
        let response = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|error| network(&error))?;
        let status = response.status();
        let body = response.bytes().await.map_err(|error| network(&error))?;
        if !status.is_success() {
            return Err(ChatGptError::Discovery {
                message: format!("{url}: HTTP {status}"),
            });
        }
        serde_json::from_slice(&body).map_err(|error| ChatGptError::Discovery {
            message: format!("{url}: {error}"),
        })
    }

    async fn discovery(&self) -> Result<Arc<Discovery>, ChatGptError> {
        let mut cached = self.vault.state.discovery.lock().await;
        if let Some(discovery) = cached.as_ref() {
            return Ok(discovery.clone());
        }
        let issuer = &self.vault.shelf.issuer;
        let discovery: Discovery = self
            .get_json(&format!("{issuer}/.well-known/openid-configuration"))
            .await?;
        if &discovery.issuer != issuer {
            return Err(ChatGptError::Discovery {
                message: format!("issuer {} is not {issuer}", discovery.issuer),
            });
        }
        let discovery = Arc::new(discovery);
        *cached = Some(discovery.clone());
        Ok(discovery)
    }

    /// OpenAI's signing keys; `fresh` fetches them again.
    async fn keys(&self, discovery: &Discovery, fresh: bool) -> Result<Arc<JwkSet>, ChatGptError> {
        let mut cached = self.vault.state.keys.lock().await;
        if let Some(keys) = cached.as_ref().filter(|_| !fresh) {
            return Ok(keys.clone());
        }
        let keys = Arc::new(self.get_json::<JwkSet>(&discovery.jwks_uri).await?);
        *cached = Some(keys.clone());
        Ok(keys)
    }

    async fn verify(
        &self,
        discovery: &Discovery,
        token: &str,
        client_id: &str,
        nonce: &str,
    ) -> Result<IdClaims, ChatGptError> {
        let keys = self.keys(discovery, false).await?;
        let verified = match verify_id_token(token, discovery, &keys, client_id, nonce) {
            Err(Rejected::UnknownKey) => {
                let keys = self.keys(discovery, true).await?;
                verify_id_token(token, discovery, &keys, client_id, nonce)
            }
            verified => verified,
        };
        verified.map_err(|rejected| ChatGptError::IdToken {
            message: match rejected {
                Rejected::UnknownKey => "signed with an unknown key".into(),
                Rejected::Invalid(message) => message,
            },
        })
    }

    /// The access token for a request of the service, renewed first when it
    /// is about to run out, or when `rejected` names it: the API turned it
    /// down.
    pub async fn access_token(
        &self,
        profile: &str,
        rejected: Option<&str>,
    ) -> Result<String, ChatGptError> {
        let mut slot = self.vault.slot(profile)?.lock_owned().await;
        let credentials = self
            .vault
            .shelf
            .load(profile, &mut slot)
            .await?
            .ok_or(ChatGptError::SignedOut)?;
        let session = credentials
            .session
            .as_ref()
            .ok_or(ChatGptError::SignedOut)?;
        if !session.plan_enabled() {
            return Err(ChatGptError::PlanDisabled);
        }
        let due = session
            .expires_at
            .is_some_and(|at| at <= now() + REFRESH_MARGIN)
            || rejected == Some(session.access_token.as_str());
        if !due {
            return Ok(session.access_token.clone());
        }
        let discovery = self.discovery().await?;
        // OpenAI spends the refresh token as it answers, so the answer is
        // kept even when the request that asked for it is stopped.
        tauri::async_runtime::spawn(refresh(
            self.vault.shelf.clone(),
            self.http.clone(),
            discovery,
            profile.to_string(),
            slot,
            credentials,
        ))
        .await?
    }

    /// Signs the service in through the browser `open` shows the address
    /// in. `fresh` registers another account in place of the one the
    /// service signed in with before; `consent` asks again for what the
    /// user declined.
    pub async fn sign_in(
        &self,
        profile: &str,
        fresh: bool,
        consent: bool,
        page: &CallbackPage,
        cancel: &CancellationToken,
        open: impl FnOnce(&str) -> Result<(), ChatGptError>,
    ) -> Result<ChatGptSignIn, ChatGptError> {
        let host = self.vault.host_id().await?;
        let discovery = self.discovery().await?;
        let previous = {
            let slot = self.vault.slot(profile)?;
            let mut slot = slot.lock().await;
            self.vault.shelf.load(profile, &mut slot).await?
        };
        // Another account only replaces one that is signed out, so no
        // live session is left behind.
        let registration = previous
            .as_ref()
            .filter(|previous| !fresh || previous.session.is_some());
        let mut callbacks = listen().await?;
        let attempt = Attempt::new(&discovery, registration, &host, consent, callbacks.port)?;
        open(attempt.url.as_str())?;
        let waited = cancel
            .run_until_cancelled(tokio::time::timeout(
                SIGN_IN_TIMEOUT,
                callbacks.wait(&attempt, page),
            ))
            .await;
        let (accepted, reply) = match waited {
            None => return Err(ChatGptError::Cancelled),
            Some(Err(_)) => return Err(ChatGptError::TimedOut),
            Some(Ok(arrived)) => arrived?,
        };
        let finished = self.finish(profile, &discovery, &attempt, accepted).await;
        let _ = reply.send(page.html(finished.is_ok()));
        finished
    }

    async fn finish(
        &self,
        profile: &str,
        discovery: &Discovery,
        attempt: &Attempt,
        accepted: Accepted,
    ) -> Result<ChatGptSignIn, ChatGptError> {
        let slot = self.vault.slot(profile)?;
        let mut slot = slot.lock().await;
        let current = self.vault.shelf.load(profile, &mut slot).await?;
        let base = if accepted.registered_now {
            let registration = Credentials {
                issuer: self.vault.shelf.issuer.clone(),
                client_id: accepted.client_id.clone(),
                subject: None,
                email: None,
                name: None,
                id_token: None,
                session: None,
            };
            // Kept before the exchange: should it fail, signing in again
            // goes through this registration instead of making another.
            self.vault
                .shelf
                .save(profile, &mut slot, registration.clone())
                .await?;
            registration
        } else {
            match current {
                Some(current) if current.client_id == accepted.client_id => current,
                // Another sign-in replaced the registration meanwhile.
                _ => return Err(ChatGptError::Cancelled),
            }
        };
        let client = oauth_client(discovery, &accepted.client_id)?;
        let send = OAuthHttp(self.http.clone());
        let reply = client
            .exchange_code(AuthorizationCode::new(accepted.code))
            .set_pkce_verifier(PkceCodeVerifier::new(attempt.verifier.clone()))
            .set_redirect_uri(Cow::Borrowed(&attempt.redirect))
            .add_extra_param("resource", RESOURCE)
            .request_async(&send)
            .await
            .map_err(oauth_failure)?;
        let id_token =
            reply
                .extra_fields()
                .id_token
                .clone()
                .ok_or_else(|| ChatGptError::IdToken {
                    message: "missing".into(),
                })?;
        let claims = self
            .verify(discovery, &id_token, &accepted.client_id, &attempt.nonce)
            .await?;
        if base
            .subject
            .as_ref()
            .is_some_and(|subject| subject != &claims.sub)
        {
            return Err(ChatGptError::AccountMismatch);
        }
        let scopes = match (reply.scopes(), &accepted.scope) {
            (Some(scopes), _) => scopes.iter().map(|scope| scope.to_string()).collect(),
            (None, Some(scope)) => scope.split_whitespace().map(Into::into).collect(),
            // Granted as asked, as OAuth reads a reply without a scope.
            (None, None) => SCOPES.iter().map(|scope| (*scope).into()).collect(),
        };
        let session = Session {
            access_token: reply.access_token().secret().clone(),
            refresh_token: reply.refresh_token().map(|token| token.secret().clone()),
            expires_at: reply.expires_in().map(|left| now() + left.as_secs()),
            scopes,
        };
        let welcome = accepted.registered_now && session.plan_enabled();
        let credentials = Credentials {
            subject: Some(claims.sub),
            email: claims.email.or(base.email),
            name: claims.name.or(base.name),
            id_token: Some(id_token),
            session: Some(session),
            ..base
        };
        self.vault
            .shelf
            .save(profile, &mut slot, credentials.clone())
            .await?;
        Ok(ChatGptSignIn {
            status: status_of(Some(&credentials)),
            welcome,
        })
    }

    /// Ends the session at OpenAI, retrying a failed connection or a server
    /// error with backoff. True once OpenAI confirmed it.
    async fn revoke(&self, client_id: &str, refresh_token: &str) -> bool {
        for attempt in 0..REVOKE_TRIES {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_secs(1 << (attempt - 1))).await;
            }
            let discovery = match self.discovery().await {
                Ok(discovery) => discovery,
                Err(ChatGptError::Network { .. }) => continue,
                Err(_) => return false,
            };
            let Ok(client) = oauth_client(&discovery, client_id) else {
                return false;
            };
            let token =
                StandardRevocableToken::RefreshToken(RefreshToken::new(refresh_token.into()));
            // No revocation endpoint, or not over https.
            let Ok(request) = client.revoke_token(token) else {
                return false;
            };
            let send = OAuthHttp(self.http.clone());
            match request.request_async(&send).await {
                Ok(()) => return true,
                Err(RequestTokenError::Request(_)) => continue,
                Err(_) => return false,
            }
        }
        false
    }

    /// Signs the service out: the session ends, its tokens and ID token go,
    /// the registration stays for signing in again.
    pub async fn sign_out(&self, profile: &str) -> Result<ChatGptSignOut, ChatGptError> {
        let slot = self.vault.slot(profile)?;
        let mut slot = slot.lock().await;
        let Some(credentials) = self.vault.shelf.load(profile, &mut slot).await? else {
            return Ok(ChatGptSignOut {
                revoked: true,
                status: status_of(None),
            });
        };
        let refresh_token = credentials
            .session
            .as_ref()
            .and_then(|session| session.refresh_token.clone());
        let revoked = match refresh_token {
            Some(token) => self.revoke(&credentials.client_id, &token).await,
            // Nothing at OpenAI outlives the access token.
            None => true,
        };
        let credentials = Credentials {
            id_token: None,
            session: None,
            ..credentials
        };
        self.vault
            .shelf
            .save(profile, &mut slot, credentials.clone())
            .await?;
        Ok(ChatGptSignOut {
            revoked,
            status: status_of(Some(&credentials)),
        })
    }

    /// Signs out as far as OpenAI answers and forgets the registration: the
    /// service no longer signs in with ChatGPT.
    pub async fn forget(&self, profile: &str) -> Result<(), ChatGptError> {
        let slot = self.vault.slot(profile)?;
        let mut slot = slot.lock().await;
        let credentials = self
            .vault
            .shelf
            .load(profile, &mut slot)
            .await
            .ok()
            .flatten();
        if let Some(credentials) = credentials {
            if let Some(token) = credentials
                .session
                .as_ref()
                .and_then(|session| session.refresh_token.as_ref())
            {
                self.revoke(&credentials.client_id, token).await;
            }
        }
        self.vault.shelf.delete(profile, &mut slot).await
    }
}

/// Renews a service's access token with its refresh token, holding its
/// slot throughout so no other refresh spends the same token.
async fn refresh(
    shelf: Shelf,
    http: reqwest::Client,
    discovery: Arc<Discovery>,
    profile: String,
    mut slot: OwnedMutexGuard<Slot>,
    credentials: Credentials,
) -> Result<String, ChatGptError> {
    let Some(session) = credentials.session.clone() else {
        return Err(ChatGptError::SignedOut);
    };
    // The session ended at OpenAI: its tokens go, the registration and the
    // ID token stay for signing in again.
    let ended = |credentials: Credentials| Credentials {
        session: None,
        ..credentials
    };
    let Some(refresh_token) = session.refresh_token.clone() else {
        shelf.save(&profile, &mut slot, ended(credentials)).await?;
        return Err(ChatGptError::SignInAgain);
    };
    let client = oauth_client(&discovery, &credentials.client_id)?;
    let send = OAuthHttp(http);
    let refresh_token = RefreshToken::new(refresh_token);
    // No scope: the grant stays as it was.
    let reply = client
        .exchange_refresh_token(&refresh_token)
        .add_extra_param("resource", RESOURCE)
        .request_async(&send)
        .await;
    let reply = match reply.map_err(oauth_failure) {
        Ok(reply) => reply,
        Err(ChatGptError::OAuth { code, .. }) if ENDED.contains(&code.as_str()) => {
            shelf.save(&profile, &mut slot, ended(credentials)).await?;
            return Err(ChatGptError::SignInAgain);
        }
        Err(error) => return Err(error),
    };
    let next = Session {
        access_token: reply.access_token().secret().clone(),
        // A refresh token is spent once used; one not replaced stays.
        refresh_token: reply
            .refresh_token()
            .map(|token| token.secret().clone())
            .or(session.refresh_token),
        expires_at: reply.expires_in().map(|left| now() + left.as_secs()),
        scopes: reply
            .scopes()
            .map(|scopes| scopes.iter().map(|scope| scope.to_string()).collect())
            .unwrap_or(session.scopes),
    };
    let plan_enabled = next.plan_enabled();
    let token = next.access_token.clone();
    let credentials = Credentials {
        session: Some(next),
        ..credentials
    };
    shelf.save(&profile, &mut slot, credentials).await?;
    if plan_enabled {
        Ok(token)
    } else {
        Err(ChatGptError::PlanDisabled)
    }
}

/// Sends a request of a service signed in with ChatGPT, with its access
/// token. A 401 renews the token and sends once more: OpenAI may have ended
/// it before its time.
pub async fn send(
    service: &Service<'_>,
    client: &reqwest::Client,
    profile: &str,
    method: &str,
    url: &str,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<reqwest::Response, FetchError> {
    let with_token = |token: &str| {
        let mut headers = headers.clone();
        headers.push(("authorization".into(), format!("Bearer {token}")));
        headers
    };
    let token = service.access_token(profile, None).await?;
    let response = http::send(client, method, url, with_token(&token), body.clone()).await?;
    if response.status() != reqwest::StatusCode::UNAUTHORIZED {
        return Ok(response);
    }
    match service.access_token(profile, Some(&token)).await {
        Ok(renewed) => http::send(client, method, url, with_token(&renewed), body).await,
        Err(error @ (ChatGptError::SignInAgain | ChatGptError::SignedOut)) => Err(error.into()),
        // Renewing failed for now; the page sees the 401 as it came.
        Err(_) => Ok(response),
    }
}

fn begin<R: Runtime>(app: &AppHandle<R>, window: &str) -> (u64, CancellationToken) {
    let state = app.state::<ChatGpt>();
    let id = state.attempts.fetch_add(1, Ordering::Relaxed);
    let cancel = CancellationToken::new();
    let earlier = lock(&state.pending).insert(window.to_string(), (id, cancel.clone()));
    if let Some((_, earlier)) = earlier {
        earlier.cancel();
    }
    (id, cancel)
}

fn end<R: Runtime>(app: &AppHandle<R>, window: &str, id: u64) {
    let state = app.state::<ChatGpt>();
    let mut pending = lock(&state.pending);
    if pending
        .get(window)
        .is_some_and(|(current, _)| *current == id)
    {
        pending.remove(window);
    }
}

fn cancel_window<R: Runtime>(app: &AppHandle<R>, window: &str) {
    if let Some((_, cancel)) = lock(&app.state::<ChatGpt>().pending).remove(window) {
        cancel.cancel();
    }
}

/// Sign a service in with ChatGPT in the system browser. A sign-in already
/// waiting in the window stops.
#[tauri::command]
pub async fn ai_chatgpt_sign_in(
    app: AppHandle,
    window: Window,
    profile: String,
    proxy: Option<ProxySetting>,
    fresh: bool,
    consent: bool,
    page: CallbackPage,
) -> Result<ChatGptSignIn, ChatGptError> {
    let (id, cancel) = begin(&app, window.label());
    let signed_in = async {
        let service = Service::of(&app, &proxy.unwrap_or_default())?;
        service
            .sign_in(&profile, fresh, consent, &page, &cancel, |url| {
                app.opener()
                    .open_url(url, None::<&str>)
                    .map_err(|error| ChatGptError::Browser {
                        message: error.to_string(),
                    })
            })
            .await
    }
    .await;
    end(&app, window.label(), id);
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

/// Forgets the registrations of `profiles` in the background.
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
        let _ = service.forget(&profile).await;
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

    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use http_body_util::BodyExt;
    use jsonwebtoken::{EncodingKey, Header};
    use ring::{
        rand::SystemRandom,
        signature::{EcdsaKeyPair, KeyPair, ECDSA_P256_SHA256_FIXED_SIGNING},
    };
    use serde_json::{json, Value};

    use super::*;
    use crate::ai::secrets::FileStore;

    struct Signer {
        kid: String,
        encoding: EncodingKey,
        jwk: Value,
    }

    fn signer(kid: &str) -> Signer {
        let random = SystemRandom::new();
        let pkcs8 =
            EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &random).unwrap();
        let pair =
            EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, pkcs8.as_ref(), &random)
                .unwrap();
        // Uncompressed: 0x04, then x and y.
        let point = pair.public_key().as_ref();
        Signer {
            kid: kid.into(),
            encoding: EncodingKey::from_ec_der(pkcs8.as_ref()),
            jwk: json!({
                "kty": "EC",
                "crv": "P-256",
                "kid": kid,
                "alg": "ES256",
                "use": "sig",
                "x": URL_SAFE_NO_PAD.encode(&point[1..33]),
                "y": URL_SAFE_NO_PAD.encode(&point[33..65]),
            }),
        }
    }

    impl Signer {
        fn sign(&self, claims: &Value) -> String {
            let mut header = Header::new(Algorithm::ES256);
            header.kid = Some(self.kid.clone());
            jsonwebtoken::encode(&header, claims, &self.encoding).unwrap()
        }
    }

    enum Reply {
        Tokens {
            sub: &'static str,
            scope: Option<&'static str>,
            refresh: Option<&'static str>,
            expires_in: u64,
        },
        Status(u16, &'static str),
    }

    fn tokens(sub: &'static str, refresh: &'static str) -> Reply {
        Reply::Tokens {
            sub,
            scope: None,
            refresh: Some(refresh),
            expires_in: 3600,
        }
    }

    /// A stand-in for OpenAI's sign-in service and API.
    struct Issuer {
        url: String,
        signer: Signer,
        replies: Mutex<VecDeque<Reply>>,
        forms: Mutex<Vec<Vec<(String, String)>>>,
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
        let url = &issuer.url;
        let path = request.uri().path().to_string();
        Ok(match path.as_str() {
            "/.well-known/openid-configuration" => json_response(
                200,
                json!({
                    "issuer": url,
                    "authorization_endpoint": format!("{url}/authorize"),
                    "token_endpoint": format!("{url}/token"),
                    "revocation_endpoint": format!("{url}/revoke"),
                    "jwks_uri": format!("{url}/jwks"),
                    "id_token_signing_alg_values_supported": ["ES256"],
                })
                .to_string(),
            ),
            "/jwks" => json_response(200, json!({ "keys": [issuer.signer.jwk] }).to_string()),
            "/token" => {
                let body = request.into_body().collect().await.unwrap().to_bytes();
                let form: Vec<(String, String)> =
                    url::form_urlencoded::parse(&body).into_owned().collect();
                lock(&issuer.forms).push(form.clone());
                let reply = lock(&issuer.replies)
                    .pop_front()
                    .unwrap_or(Reply::Status(500, ""));
                match reply {
                    Reply::Status(status, body) => json_response(status, body.into()),
                    Reply::Tokens {
                        sub,
                        scope,
                        refresh,
                        expires_in,
                    } => {
                        let n = issuer.issued.fetch_add(1, Ordering::SeqCst) + 1;
                        let mut reply = json!({
                            "access_token": format!("access-{n}"),
                            "token_type": "Bearer",
                            "expires_in": expires_in,
                        });
                        if let Some(refresh) = refresh {
                            reply["refresh_token"] = refresh.into();
                        }
                        if let Some(scope) = scope {
                            reply["scope"] = scope.into();
                        }
                        // The test browser hands the nonce over as the code.
                        if field(&form, "grant_type").as_deref() == Some("authorization_code") {
                            reply["id_token"] = issuer
                                .signer
                                .sign(&json!({
                                    "iss": url,
                                    "aud": field(&form, "client_id"),
                                    "sub": sub,
                                    "email": "cat@example.com",
                                    "name": "Cat",
                                    "nonce": field(&form, "code"),
                                    "iat": now(),
                                    "exp": now() + 3600,
                                }))
                                .into();
                        }
                        json_response(200, reply.to_string())
                    }
                }
            }
            // The API: turns the first access token down.
            "/v1/models" => {
                let bearer = request
                    .headers()
                    .get("authorization")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or_default()
                    .to_string();
                if bearer == "Bearer access-1" {
                    json_response(401, r#"{"detail":"expired"}"#.into())
                } else {
                    json_response(200, json!({ "bearer": bearer }).to_string())
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
            signer: signer("key-1"),
            replies: Mutex::default(),
            forms: Mutex::default(),
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
                    issuer: issuer.url.clone(),
                },
            },
            http: http::build_oauth_client(&ProxySetting::None).unwrap(),
        }
    }

    fn saved(dir: &Path, profile: &str) -> Option<Credentials> {
        FileStore::new(dir.join("keys.json"))
            .get(&format!("{PROFILE_ACCOUNT}{profile}"))
            .unwrap()
            .map(|stored| secrets::decode_record(&stored).unwrap())
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
        /// The client id the callback carries.
        client_id: Option<&'static str>,
        /// Comes back once with another `state` first.
        stray: bool,
        error: Option<&'static str>,
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
        consent: bool,
        browser: Browser,
    ) -> (Result<ChatGptSignIn, ChatGptError>, Visit) {
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
                None => pairs.push(("code", field(&query, "nonce").unwrap())),
            }
            if let Some(id) = browser.client_id {
                pairs.push(("client_id", id.into()));
            }
            pages.push(visit(pairs).await);
            Visit { query, pages }
        });
        let signed_in = service
            .sign_in(
                profile,
                fresh,
                consent,
                &page(),
                &CancellationToken::new(),
                |url| {
                    shown.send(url.into()).unwrap();
                    Ok(())
                },
            )
            .await;
        (signed_in, visit.await.unwrap())
    }

    fn first_browser() -> Browser {
        Browser {
            client_id: Some("oaiapp_1"),
            ..Browser::default()
        }
    }

    #[test]
    fn a_first_sign_in_registers_the_app_and_welcomes_the_user() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service = service(&issuer, dir.path());
        issuer.reply(tokens("user-1", "refresh-1"));
        let browser = Browser {
            stray: true,
            ..first_browser()
        };
        let (signed_in, visit) =
            tauri::async_runtime::block_on(sign_in(&service, "p1", false, false, browser));
        let signed_in = signed_in.unwrap();
        assert!(signed_in.welcome);
        assert_eq!(
            signed_in.status,
            ChatGptStatus {
                registered: true,
                signed_in: true,
                plan_enabled: true,
                email: Some("cat@example.com".into()),
                name: Some("Cat".into()),
            }
        );
        let query = &visit.query;
        let get = |name| field(query, name);
        assert_eq!(get("client_id").as_deref(), Some(DYNAMIC_CLIENT));
        assert_eq!(get("agent_name_hint").as_deref(), Some(AGENT_NAME));
        assert!(get("ext_agent_host_id").unwrap().starts_with("urn:uuid:"));
        assert_eq!(get("response_type").as_deref(), Some("code"));
        assert_eq!(get("resource").as_deref(), Some(RESOURCE));
        assert_eq!(get("code_challenge_method").as_deref(), Some("S256"));
        assert_eq!(get("scope"), Some(SCOPES.join(" ")));
        let redirect = get("redirect_uri").unwrap();
        assert!(redirect.starts_with("http://127.0.0.1:"));
        assert!(redirect.ends_with(CALLBACK_PATH));
        assert_eq!(get("id_token_hint"), None);
        assert_eq!(get("prompt"), None);
        // The stray callback was turned away and the real one taken.
        assert_eq!(visit.pages.len(), 2);
        assert!(visit.pages[0].contains("failed"));
        assert!(visit.pages[1].contains("signed in"));

        let forms = issuer.sent("authorization_code");
        let form = &forms[0];
        assert_eq!(field(form, "client_id").as_deref(), Some("oaiapp_1"));
        assert_eq!(field(form, "redirect_uri"), Some(redirect));
        assert_eq!(field(form, "resource").as_deref(), Some(RESOURCE));
        assert!(field(form, "code_verifier").is_some());

        let saved = saved(dir.path(), "p1").unwrap();
        assert_eq!(saved.client_id, "oaiapp_1");
        assert_eq!(saved.subject.as_deref(), Some("user-1"));
        let session = saved.session.unwrap();
        assert_eq!(session.refresh_token.as_deref(), Some("refresh-1"));
        assert!(session.plan_enabled());
        let token = tauri::async_runtime::block_on(service.access_token("p1", None));
        assert_eq!(token.as_deref(), Ok("access-1"));
    }

    #[test]
    fn signing_in_again_goes_through_the_same_registration() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service = service(&issuer, dir.path());
        issuer.reply(tokens("user-1", "refresh-1"));
        issuer.reply(tokens("user-1", "refresh-2"));
        issuer.reply(tokens("user-1", "refresh-3"));
        tauri::async_runtime::block_on(async {
            let (first, visit) = sign_in(&service, "p1", false, false, first_browser()).await;
            first.unwrap();
            let host = field(&visit.query, "ext_agent_host_id");

            // Signed in: the ID token names the account.
            let (again, visit) = sign_in(&service, "p1", false, true, Browser::default()).await;
            let again = again.unwrap();
            assert!(!again.welcome);
            let get = |name| field(&visit.query, name);
            assert_eq!(get("client_id").as_deref(), Some("oaiapp_1"));
            assert!(get("id_token_hint").is_some());
            assert_eq!(get("login_hint").as_deref(), Some("cat@example.com"));
            assert_eq!(get("agent_name_hint"), None);
            assert_eq!(get("prompt").as_deref(), Some("consent"));
            assert_eq!(get("ext_agent_host_id"), host);

            // Signed out: no ID token to hint with, the registration stays.
            let out = service.sign_out("p1").await.unwrap();
            // The test issuer is not on https, which revocation insists on.
            assert!(!out.revoked);
            assert!(out.status.registered);
            assert!(!out.status.signed_in);
            let saved = saved(dir.path(), "p1").unwrap();
            assert_eq!(saved.id_token, None);
            assert_eq!(saved.session, None);
            assert_eq!(
                service.access_token("p1", None).await,
                Err(ChatGptError::SignedOut)
            );

            let (back, visit) = sign_in(&service, "p1", false, false, Browser::default()).await;
            back.unwrap();
            let get = |name| field(&visit.query, name);
            assert_eq!(get("client_id").as_deref(), Some("oaiapp_1"));
            assert_eq!(get("id_token_hint"), None);
            assert_eq!(get("login_hint").as_deref(), Some("cat@example.com"));
        });
    }

    #[test]
    fn another_account_does_not_replace_the_one_signed_in() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service = service(&issuer, dir.path());
        issuer.reply(tokens("user-1", "refresh-1"));
        issuer.reply(tokens("user-2", "refresh-2"));
        tauri::async_runtime::block_on(async {
            sign_in(&service, "p1", false, false, first_browser())
                .await
                .0
                .unwrap();
            let (other, visit) = sign_in(&service, "p1", false, false, Browser::default()).await;
            assert_eq!(other, Err(ChatGptError::AccountMismatch));
            assert!(visit.pages[0].contains("failed"));
            assert_eq!(
                service.access_token("p1", None).await.as_deref(),
                Ok("access-1")
            );
        });
    }

    #[test]
    fn a_first_sign_in_needs_the_issued_client_id() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service = service(&issuer, dir.path());
        let (signed_in, visit) = tauri::async_runtime::block_on(sign_in(
            &service,
            "p1",
            false,
            false,
            Browser::default(),
        ));
        assert_eq!(signed_in, Err(ChatGptError::RegistrationIncomplete));
        assert!(visit.pages[0].contains("failed"));
        assert!(saved(dir.path(), "p1").is_none());
    }

    #[test]
    fn declining_in_the_browser_stops_the_sign_in() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service = service(&issuer, dir.path());
        let browser = Browser {
            error: Some("access_denied"),
            ..first_browser()
        };
        let (signed_in, _) =
            tauri::async_runtime::block_on(sign_in(&service, "p1", false, false, browser));
        assert_eq!(signed_in, Err(ChatGptError::AccessDenied));
        assert!(issuer.sent("authorization_code").is_empty());
    }

    #[test]
    fn a_stopped_sign_in_ends_at_once() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service = service(&issuer, dir.path());
        let cancel = CancellationToken::new();
        let signed_in = tauri::async_runtime::block_on(service.sign_in(
            "p1",
            false,
            false,
            &page(),
            &cancel,
            |_| {
                cancel.cancel();
                Ok(())
            },
        ));
        assert_eq!(signed_in, Err(ChatGptError::Cancelled));
    }

    #[test]
    fn a_sign_in_without_the_plan_is_kept_but_not_used() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service = service(&issuer, dir.path());
        issuer.reply(Reply::Tokens {
            sub: "user-1",
            scope: Some("openid profile email offline_access resource.invoke"),
            refresh: Some("refresh-1"),
            expires_in: 3600,
        });
        tauri::async_runtime::block_on(async {
            let signed_in = sign_in(&service, "p1", false, false, first_browser())
                .await
                .0
                .unwrap();
            assert!(!signed_in.welcome);
            assert!(signed_in.status.signed_in);
            assert!(!signed_in.status.plan_enabled);
            assert_eq!(
                service.access_token("p1", None).await,
                Err(ChatGptError::PlanDisabled)
            );
        });
    }

    #[test]
    fn a_refresh_replaces_both_tokens() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service = service(&issuer, dir.path());
        // Runs out within the margin, so the first request renews it.
        issuer.reply(Reply::Tokens {
            sub: "user-1",
            scope: None,
            refresh: Some("refresh-1"),
            expires_in: 60,
        });
        issuer.reply(tokens("user-1", "refresh-2"));
        tauri::async_runtime::block_on(async {
            sign_in(&service, "p1", false, false, first_browser())
                .await
                .0
                .unwrap();
            assert_eq!(
                service.access_token("p1", None).await.as_deref(),
                Ok("access-2")
            );
        });
        let forms = issuer.sent("refresh_token");
        assert_eq!(forms.len(), 1);
        let form = &forms[0];
        assert_eq!(field(form, "refresh_token").as_deref(), Some("refresh-1"));
        assert_eq!(field(form, "client_id").as_deref(), Some("oaiapp_1"));
        assert_eq!(field(form, "resource").as_deref(), Some(RESOURCE));
        assert_eq!(field(form, "scope"), None);
        let session = saved(dir.path(), "p1").unwrap().session.unwrap();
        assert_eq!(session.refresh_token.as_deref(), Some("refresh-2"));
        assert!(session.plan_enabled());
    }

    #[test]
    fn requests_turned_down_together_refresh_once() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service: &'static Service<'static> = Box::leak(Box::new(service(&issuer, dir.path())));
        issuer.reply(tokens("user-1", "refresh-1"));
        issuer.reply(tokens("user-1", "refresh-2"));
        tauri::async_runtime::block_on(async {
            sign_in(service, "p1", false, false, first_browser())
                .await
                .0
                .unwrap();
            let renew =
                || tauri::async_runtime::spawn(service.access_token("p1", Some("access-1")));
            let (first, second) = (renew(), renew());
            assert_eq!(first.await.unwrap().as_deref(), Ok("access-2"));
            assert_eq!(second.await.unwrap().as_deref(), Ok("access-2"));
        });
        assert_eq!(issuer.sent("refresh_token").len(), 1);
    }

    #[test]
    fn a_refresh_token_that_no_longer_works_asks_to_sign_in_again() {
        for body in [
            r#"{"error":"invalid_grant","error_description":"expired"}"#,
            r#"{"error":{"code":"refresh_token_reused","message":"used","type":"invalid_request_error"}}"#,
        ] {
            let (issuer, _stop) = issuer();
            let dir = tempfile::tempdir().unwrap();
            let service = service(&issuer, dir.path());
            issuer.reply(tokens("user-1", "refresh-1"));
            issuer.reply(Reply::Status(400, body));
            tauri::async_runtime::block_on(async {
                sign_in(&service, "p1", false, false, first_browser())
                    .await
                    .0
                    .unwrap();
                assert_eq!(
                    service.access_token("p1", Some("access-1")).await,
                    Err(ChatGptError::SignInAgain)
                );
                assert_eq!(
                    service.access_token("p1", None).await,
                    Err(ChatGptError::SignedOut)
                );
            });
            let saved = saved(dir.path(), "p1").unwrap();
            assert_eq!(saved.client_id, "oaiapp_1");
            assert!(saved.id_token.is_some());
            assert_eq!(saved.session, None);
        }
    }

    #[test]
    fn a_server_error_keeps_the_sign_in() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service = service(&issuer, dir.path());
        issuer.reply(tokens("user-1", "refresh-1"));
        issuer.reply(Reply::Status(503, ""));
        tauri::async_runtime::block_on(async {
            sign_in(&service, "p1", false, false, first_browser())
                .await
                .0
                .unwrap();
            let renewed = service.access_token("p1", Some("access-1")).await;
            assert!(matches!(renewed, Err(ChatGptError::Network { .. })));
            assert!(service.vault.status("p1").await.unwrap().signed_in);
        });
    }

    #[test]
    fn a_turned_down_request_is_sent_again_with_a_new_token() {
        let (issuer, _stop) = issuer();
        let dir = tempfile::tempdir().unwrap();
        let service = service(&issuer, dir.path());
        issuer.reply(tokens("user-1", "refresh-1"));
        issuer.reply(tokens("user-1", "refresh-2"));
        let body = tauri::async_runtime::block_on(async {
            sign_in(&service, "p1", false, false, first_browser())
                .await
                .0
                .unwrap();
            let client = http::build_client(&ProxySetting::None).unwrap();
            let url = format!("{}/v1/models", issuer.url);
            let response = send(&service, &client, "p1", "GET", &url, Vec::new(), None)
                .await
                .unwrap();
            assert_eq!(response.status(), reqwest::StatusCode::OK);
            response.text().await.unwrap()
        });
        assert!(body.contains("Bearer access-2"));
    }

    fn discovery(issuer: &str) -> Discovery {
        Discovery {
            issuer: issuer.into(),
            authorization_endpoint: format!("{issuer}/authorize"),
            token_endpoint: format!("{issuer}/token"),
            revocation_endpoint: Some(format!("{issuer}/revoke")),
            jwks_uri: format!("{issuer}/jwks"),
            id_token_signing_alg_values_supported: vec!["ES256".into()],
        }
    }

    fn registration(client_id: &str) -> Credentials {
        Credentials {
            issuer: ISSUER.into(),
            client_id: client_id.into(),
            subject: Some("user-1".into()),
            email: Some("cat@example.com".into()),
            name: None,
            id_token: Some("hint".into()),
            session: None,
        }
    }

    fn callback(attempt: &Attempt, pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        let mut query = vec![("state".to_string(), attempt.state.secret().clone())];
        query.extend(pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())));
        query
    }

    #[test]
    fn a_callback_is_read_only_for_its_own_attempt() {
        let discovery = discovery(ISSUER);
        let first = Attempt::new(&discovery, None, "urn:uuid:host", false, 4000).unwrap();
        let ours = registration("oaiapp_1");
        let again = Attempt::new(&discovery, Some(&ours), "urn:uuid:host", false, 4000).unwrap();

        let stray = vec![
            ("state".to_string(), "other".to_string()),
            ("code".to_string(), "c".to_string()),
        ];
        assert!(first.accept(&stray).is_none());
        assert!(first.accept(&[]).is_none());
        assert!(matches!(
            first.accept(&callback(&first, &[("error", "access_denied")])),
            Some(Err(ChatGptError::AccessDenied))
        ));
        assert!(matches!(
            first.accept(&callback(&first, &[("error", "server_error")])),
            Some(Err(ChatGptError::OAuth { code, .. })) if code == "server_error"
        ));
        assert!(matches!(
            first.accept(&callback(&first, &[("client_id", "oaiapp_1")])),
            Some(Err(ChatGptError::OAuth { code, .. })) if code == "invalid_response"
        ));
        assert!(matches!(
            first.accept(&callback(&first, &[("code", "c")])),
            Some(Err(ChatGptError::RegistrationIncomplete))
        ));
        assert!(matches!(
            first.accept(&callback(
                &first,
                &[("code", "c"), ("client_id", DYNAMIC_CLIENT)]
            )),
            Some(Err(ChatGptError::RegistrationIncomplete))
        ));
        let Some(Ok(accepted)) = first.accept(&callback(
            &first,
            &[("code", "c"), ("client_id", "oaiapp_1")],
        )) else {
            panic!("a first sign-in with its client id is accepted");
        };
        assert!(accepted.registered_now);
        assert_eq!(accepted.client_id, "oaiapp_1");

        assert!(matches!(
            again.accept(&callback(
                &again,
                &[("code", "c"), ("client_id", "oaiapp_2")]
            )),
            Some(Err(ChatGptError::AccountMismatch))
        ));
        let Some(Ok(accepted)) = again.accept(&callback(&again, &[("code", "c")])) else {
            panic!("signing in again needs no client id back");
        };
        assert!(!accepted.registered_now);
        assert_eq!(accepted.client_id, "oaiapp_1");
    }

    #[test]
    fn id_tokens_that_do_not_hold_up_are_turned_away() {
        let issuer = "https://auth.example";
        let discovery = discovery(issuer);
        let key = signer("key-1");
        let keys: JwkSet = serde_json::from_value(json!({ "keys": [key.jwk] })).unwrap();
        let claims = |change: &dyn Fn(&mut Value)| {
            let mut claims = json!({
                "iss": issuer,
                "aud": "oaiapp_1",
                "sub": "user-1",
                "nonce": "n-1",
                "iat": now(),
                "exp": now() + 600,
            });
            change(&mut claims);
            claims
        };
        let check = |token: &str| verify_id_token(token, &discovery, &keys, "oaiapp_1", "n-1");

        let good = check(&key.sign(&claims(&|_| {}))).unwrap();
        assert_eq!(good.sub, "user-1");
        let changes: [fn(&mut Value); 6] = [
            |c: &mut Value| c["aud"] = "oaiapp_2".into(),
            |c: &mut Value| c["iss"] = "https://elsewhere.example".into(),
            |c: &mut Value| c["nonce"] = "n-2".into(),
            |c: &mut Value| {
                c.as_object_mut().unwrap().remove("nonce");
            },
            |c: &mut Value| c["exp"] = (now() - 600).into(),
            |c: &mut Value| c["iat"] = (now() + 600).into(),
        ];
        for change in changes {
            assert!(matches!(
                check(&key.sign(&claims(&change))),
                Err(Rejected::Invalid(_))
            ));
        }

        let rotated = signer("key-2");
        assert_eq!(
            check(&rotated.sign(&claims(&|_| {}))).err(),
            Some(Rejected::UnknownKey)
        );

        // A shared-secret token, which anyone with the client id could make.
        let mut header = Header::new(Algorithm::HS256);
        header.kid = Some("key-1".into());
        let forged = jsonwebtoken::encode(
            &header,
            &claims(&|_| {}),
            &EncodingKey::from_secret(b"oaiapp_1"),
        )
        .unwrap();
        assert!(matches!(check(&forged), Err(Rejected::Invalid(_))));
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
            serde_json::to_value(ChatGptError::OAuth {
                code: "invalid_client".into(),
                message: None
            })
            .unwrap(),
            json!({ "kind": "oauth", "code": "invalid_client", "message": null })
        );
    }
}
