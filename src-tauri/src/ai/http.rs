//! AI requests leave the app here.
//!
//! The page may not reach the network itself (its content security policy
//! allows IPC only), and should not hold the keys. So the page builds a
//! request the way the service's own SDK would, with a stand-in for the key,
//! and hands it over: this side puts the saved key in, sends it, and streams
//! the answer back as it arrives.
//!
//! A key goes only to the address it was saved for. A page that asked to send
//! a request somewhere else would get an error, whatever it put in the
//! request.

use std::{collections::HashMap, sync::Mutex, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle, Manager, Runtime, Window};
use tokio_util::sync::CancellationToken;

use super::secrets::{self, AuthScheme, SecretRecord};

/// How requests reach the internet: the system's proxy settings (and the
/// `HTTPS_PROXY` family), none, or one the user entered.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum ProxySetting {
    #[default]
    System,
    None,
    Manual {
        url: String,
    },
}

/// The clients last built, kept for their pooled connections: one for
/// requests that carry a key, one for web search.
#[derive(Default)]
pub struct HttpClients {
    keyed: Mutex<Option<(ProxySetting, reqwest::Client)>>,
    search: Mutex<Option<(ProxySetting, reqwest::Client)>>,
}

/// Redirects followed before giving up, as reqwest does by default.
const MAX_REDIRECTS: usize = 10;

/// Requests on their way, by the id the page gave them, so it can stop one.
#[derive(Default)]
pub struct InFlight(Mutex<HashMap<String, CancellationToken>>);

/// rustls needs a crypto provider before the first client is built, or it
/// panics, and a panic ends the app. The updater installs the same one, but
/// only once it first checks.
pub fn install_crypto_provider() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

/// The client for requests that carry a key. It follows a redirect only
/// within the origin the key was saved for; one elsewhere comes back to the
/// page as it is.
pub fn build_client(proxy: &ProxySetting) -> Result<reqwest::Client, String> {
    install_crypto_provider();
    let builder = reqwest::Client::builder()
        .redirect(same_origin_redirects())
        .connect_timeout(Duration::from_secs(15))
        // A reasoning model may think for minutes before its first word.
        .read_timeout(Duration::from_secs(300));
    apply_proxy(builder, proxy)?
        .build()
        .map_err(|error| error.to_string())
}

/// The client for web search, which carries no key and follows redirects
/// anywhere: a search engine may send a reader to its regional site.
pub fn build_search_client(proxy: &ProxySetting) -> Result<reqwest::Client, String> {
    install_crypto_provider();
    let builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(300));
    apply_proxy(builder, proxy)?
        .build()
        .map_err(|error| error.to_string())
}

/// Follows a redirect only to the scheme, host and port the redirecting
/// request went to. Any other comes back to the caller as the 3xx it is, so
/// what a request carries (a key, a body) never reaches another server.
pub fn same_origin_redirects() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        // `previous` starts with the first request; its last entry is the
        // one that was answered with this redirect.
        let from = attempt.previous().last();
        if attempt.previous().len() > MAX_REDIRECTS {
            attempt.error("too-many-redirects")
        } else if from.is_some_and(|from| same_origin(from, attempt.url())) {
            attempt.follow()
        } else {
            attempt.stop()
        }
    })
}

fn same_origin(a: &url::Url, b: &url::Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}

/// Routes a client through the proxy setting, for clients built elsewhere
/// with settings of their own.
pub fn apply_proxy(
    builder: reqwest::ClientBuilder,
    proxy: &ProxySetting,
) -> Result<reqwest::ClientBuilder, String> {
    Ok(match proxy {
        ProxySetting::System => builder,
        ProxySetting::None => builder.no_proxy(),
        ProxySetting::Manual { url } => builder
            .proxy(reqwest::Proxy::all(url.trim()).map_err(|error| format!("{url}: {error}"))?),
    })
}

fn cached(
    slot: &Mutex<Option<(ProxySetting, reqwest::Client)>>,
    proxy: &ProxySetting,
    build: fn(&ProxySetting) -> Result<reqwest::Client, String>,
) -> Result<reqwest::Client, String> {
    let mut cached = slot.lock().map_err(|error| error.to_string())?;
    if let Some((setting, client)) = cached.as_ref() {
        if setting == proxy {
            return Ok(client.clone());
        }
    }
    let client = build(proxy)?;
    *cached = Some((proxy.clone(), client.clone()));
    Ok(client)
}

/// The client for requests that carry a key; see [`build_client`].
pub fn client<R: Runtime>(
    app: &AppHandle<R>,
    proxy: &ProxySetting,
) -> Result<reqwest::Client, String> {
    cached(&app.state::<HttpClients>().keyed, proxy, build_client)
}

/// The client for web search; see [`build_search_client`].
pub fn search_client<R: Runtime>(
    app: &AppHandle<R>,
    proxy: &ProxySetting,
) -> Result<reqwest::Client, String> {
    cached(
        &app.state::<HttpClients>().search,
        proxy,
        build_search_client,
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchRequest {
    /// Names the request for `ai_fetch_abort`.
    pub id: String,
    /// The connected service whose key and address apply.
    pub profile: String,
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    #[serde(default)]
    pub proxy: ProxySetting,
}

/// The status and headers, returned once they arrived; the body follows on
/// the channel.
#[derive(Debug, Serialize)]
pub struct FetchHead {
    pub status: u16,
    pub headers: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FetchEvent {
    Chunk { text: String },
    End,
    Error { message: String },
}

/// Headers that carry a key, whatever the page put in them.
const KEY_HEADERS: [&str; 4] = ["authorization", "x-api-key", "x-goog-api-key", "api-key"];

/// Headers the connection itself sets.
const CONNECTION_HEADERS: [&str; 4] = ["host", "content-length", "connection", "transfer-encoding"];

/// The headers to send: the page's, with any key it put in taken out and the
/// saved one put in, or an error when the address is not the one saved.
pub fn authorize(
    url: &str,
    headers: Vec<(String, String)>,
    record: Option<&SecretRecord>,
) -> Result<Vec<(String, String)>, String> {
    let record = record.ok_or_else(|| "not-connected".to_string())?;
    let origin = secrets::origin_of(url)?;
    if origin != record.origin {
        return Err(format!(
            "This service is set up for {}, and the request went to {origin}",
            record.origin
        ));
    }
    let mut headers: Vec<(String, String)> = headers
        .into_iter()
        .filter(|(name, _)| {
            let name = name.to_ascii_lowercase();
            !KEY_HEADERS.contains(&name.as_str()) && !CONNECTION_HEADERS.contains(&name.as_str())
        })
        .collect();
    if let Some(key) = &record.key {
        headers.push(match record.auth {
            AuthScheme::Bearer => ("authorization".into(), format!("Bearer {key}")),
            AuthScheme::XApiKey => ("x-api-key".into(), key.clone()),
            AuthScheme::XGoogApiKey => ("x-goog-api-key".into(), key.clone()),
            AuthScheme::ApiKey => ("api-key".into(), key.clone()),
        });
    }
    Ok(headers)
}

pub async fn send(
    client: &reqwest::Client,
    method: &str,
    url: &str,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<reqwest::Response, String> {
    let method =
        reqwest::Method::from_bytes(method.as_bytes()).map_err(|error| error.to_string())?;
    let mut request = client.request(method, url);
    for (name, value) in headers {
        request = request.header(name, value);
    }
    if let Some(body) = body {
        request = request.body(body);
    }
    request.send().await.map_err(|error| describe(&error))
}

/// A reqwest error with its causes, which name what actually failed (a
/// refused connection, a certificate, a proxy).
pub fn describe(error: &reqwest::Error) -> String {
    let mut message = error.to_string();
    let mut source = std::error::Error::source(error);
    while let Some(cause) = source {
        message.push_str(": ");
        message.push_str(&cause.to_string());
        source = cause.source();
    }
    message
}

/// The response headers the page gets. The body is passed on as received,
/// so headers about its transfer no longer apply to it.
pub fn head_of(response: &reqwest::Response) -> FetchHead {
    FetchHead {
        status: response.status().as_u16(),
        headers: response
            .headers()
            .iter()
            .filter(|(name, _)| {
                !matches!(
                    name.as_str(),
                    "content-encoding" | "content-length" | "transfer-encoding"
                )
            })
            .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_string())))
            .collect(),
    }
}

/// UTF-8 decoded across chunk boundaries: a character split between two
/// chunks waits for its second half.
#[derive(Default)]
pub struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut text = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(valid) => {
                    text.push_str(valid);
                    self.pending.clear();
                    return text;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    text.push_str(std::str::from_utf8(&self.pending[..valid]).unwrap_or_default());
                    match error.error_len() {
                        None => {
                            self.pending.drain(..valid);
                            return text;
                        }
                        Some(len) => {
                            text.push('\u{FFFD}');
                            self.pending.drain(..valid + len);
                        }
                    }
                }
            }
        }
    }

    pub fn finish(&mut self) -> String {
        let rest = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        rest
    }
}

/// Passes the body on until it ends, fails, is stopped, or the page is gone.
pub async fn pump(
    mut response: reqwest::Response,
    channel: &Channel<FetchEvent>,
    token: &CancellationToken,
) {
    let mut decoder = Utf8Stream::default();
    loop {
        match token.run_until_cancelled(response.chunk()).await {
            None => return,
            Some(Ok(Some(bytes))) => {
                let text = decoder.push(&bytes);
                if !text.is_empty() && channel.send(FetchEvent::Chunk { text }).is_err() {
                    return;
                }
            }
            Some(Ok(None)) => {
                let text = decoder.finish();
                if !text.is_empty() {
                    let _ = channel.send(FetchEvent::Chunk { text });
                }
                let _ = channel.send(FetchEvent::End);
                return;
            }
            Some(Err(error)) => {
                let _ = channel.send(FetchEvent::Error {
                    message: describe(&error),
                });
                return;
            }
        }
    }
}

fn track<R: Runtime>(app: &AppHandle<R>, id: &str, token: Option<CancellationToken>) {
    if let Ok(mut in_flight) = app.state::<InFlight>().0.lock() {
        match token {
            Some(token) => {
                in_flight.insert(id.to_string(), token);
            }
            None => {
                in_flight.remove(id);
            }
        }
    }
}

/// Send a request for the page, with the saved key of its service.
#[tauri::command]
pub async fn ai_fetch(
    app: AppHandle,
    window: Window,
    request: FetchRequest,
    on_event: Channel<FetchEvent>,
) -> Result<FetchHead, String> {
    let record = {
        let app = app.clone();
        let label = window.label().to_string();
        let profile = request.profile.clone();
        tauri::async_runtime::spawn_blocking(move || secrets::record(&app, &label, &profile))
            .await
            .map_err(|error| error.to_string())??
    };
    let headers = authorize(&request.url, request.headers, record.as_ref())?;
    let client = client(&app, &request.proxy)?;
    let token = CancellationToken::new();
    track(&app, &request.id, Some(token.clone()));
    let sent = token
        .run_until_cancelled(send(
            &client,
            &request.method,
            &request.url,
            headers,
            request.body,
        ))
        .await;
    let response = match sent {
        Some(Ok(response)) => response,
        Some(Err(error)) => {
            track(&app, &request.id, None);
            return Err(error);
        }
        None => {
            track(&app, &request.id, None);
            return Err("aborted".into());
        }
    };
    let head = head_of(&response);
    tauri::async_runtime::spawn(async move {
        pump(response, &on_event, &token).await;
        track(&app, &request.id, None);
    });
    Ok(head)
}

/// Stop a request the page no longer wants.
#[tauri::command]
pub fn ai_fetch_abort(app: AppHandle, id: String) {
    let token = app
        .state::<InFlight>()
        .0
        .lock()
        .ok()
        .and_then(|mut in_flight| in_flight.remove(&id));
    if let Some(token) = token {
        token.cancel();
    }
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::{Arc, Mutex},
        thread,
    };

    use tauri::ipc::InvokeResponseBody;

    use super::*;

    fn record(origin: &str, auth: AuthScheme, key: Option<&str>) -> SecretRecord {
        SecretRecord {
            origin: origin.into(),
            auth,
            key: key.map(str::to_string),
        }
    }

    fn header<'a>(headers: &'a [(String, String)], name: &str) -> Vec<&'a str> {
        headers
            .iter()
            .filter(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
            .collect()
    }

    #[test]
    fn the_saved_key_replaces_whatever_the_page_sent() {
        let sent = vec![
            ("Authorization".into(), "Bearer placeholder".into()),
            ("X-Api-Key".into(), "placeholder".into()),
            ("content-type".into(), "application/json".into()),
            ("Host".into(), "evil.example".into()),
        ];
        let headers = authorize(
            "https://api.example.com/v1/chat/completions",
            sent,
            Some(&record(
                "https://api.example.com",
                AuthScheme::Bearer,
                Some("sk-1"),
            )),
        )
        .unwrap();
        assert_eq!(header(&headers, "authorization"), ["Bearer sk-1"]);
        assert!(header(&headers, "x-api-key").is_empty());
        assert!(header(&headers, "host").is_empty());
        assert_eq!(header(&headers, "content-type"), ["application/json"]);
    }

    #[test]
    fn each_scheme_puts_the_key_where_its_service_reads_it() {
        for (auth, name) in [
            (AuthScheme::XApiKey, "x-api-key"),
            (AuthScheme::XGoogApiKey, "x-goog-api-key"),
            (AuthScheme::ApiKey, "api-key"),
        ] {
            let headers = authorize(
                "https://a.example/x",
                vec![],
                Some(&record("https://a.example", auth, Some("k"))),
            )
            .unwrap();
            assert_eq!(headers, vec![(name.to_string(), "k".to_string())]);
        }
    }

    #[test]
    fn a_key_goes_nowhere_else() {
        let saved = record("https://api.example.com", AuthScheme::Bearer, Some("sk-1"));
        for url in [
            "https://evil.example/v1",
            "http://api.example.com/v1",
            "https://api.example.com:8443/v1",
            "https://api.example.com.evil.example/v1",
            "file:///etc/passwd",
        ] {
            assert!(authorize(url, vec![], Some(&saved)).is_err(), "{url}");
        }
        assert_eq!(
            authorize("https://api.example.com/v1", vec![], None),
            Err("not-connected".into())
        );
    }

    #[test]
    fn a_service_without_a_key_gets_no_key_header() {
        let headers = authorize(
            "http://127.0.0.1:11434/v1/models",
            vec![("authorization".into(), "Bearer placeholder".into())],
            Some(&record("http://127.0.0.1:11434", AuthScheme::Bearer, None)),
        )
        .unwrap();
        assert!(headers.is_empty());
    }

    #[test]
    fn a_character_split_across_chunks_comes_out_whole() {
        let text = "猫 says ニャー";
        let bytes = text.as_bytes();
        for cut in 0..=bytes.len() {
            let mut stream = Utf8Stream::default();
            let mut out = stream.push(&bytes[..cut]);
            out.push_str(&stream.push(&bytes[cut..]));
            out.push_str(&stream.finish());
            assert_eq!(out, text, "cut at {cut}");
        }
        let mut stream = Utf8Stream::default();
        assert_eq!(stream.push(b"a\xFFb"), "a\u{FFFD}b");
        assert_eq!(stream.push(b"\xE7\x8C"), "");
        assert_eq!(stream.finish(), "\u{FFFD}");
    }

    /// Serves one canned response and keeps the request it read.
    fn serve_once(response: &'static str) -> (String, Arc<Mutex<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(String::new()));
        let kept = seen.clone();
        thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut buffer = vec![0u8; 65536];
            let mut request = Vec::new();
            loop {
                let read = socket.read(&mut buffer).unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                let text = String::from_utf8_lossy(&request).to_string();
                if let Some(end) = text.find("\r\n\r\n") {
                    let length = text[..end]
                        .lines()
                        .find_map(|line| {
                            let line = line.to_ascii_lowercase();
                            Some(
                                line.strip_prefix("content-length:")?
                                    .trim()
                                    .parse::<usize>()
                                    .unwrap(),
                            )
                        })
                        .unwrap_or(0);
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            *kept.lock().unwrap() = String::from_utf8_lossy(&request).to_string();
            socket.write_all(response.as_bytes()).unwrap();
        });
        (address, seen)
    }

    #[test]
    fn a_request_carries_the_key_and_streams_its_answer_back() {
        let (address, seen) = serve_once(
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\n\r\n\
             8\r\ndata: 1\n\r\n8\r\ndata: 2\n\r\n0\r\n\r\n",
        );
        let saved = record(&address, AuthScheme::Bearer, Some("sk-secret"));
        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let kept = events.clone();
        let channel = Channel::<FetchEvent>::new(move |body| {
            if let InvokeResponseBody::Json(json) = body {
                kept.lock().unwrap().push(json);
            }
            Ok(())
        });
        tauri::async_runtime::block_on(async {
            let client = build_client(&ProxySetting::None).unwrap();
            let headers = authorize(
                &format!("{address}/v1/chat/completions"),
                vec![("content-type".into(), "application/json".into())],
                Some(&saved),
            )
            .unwrap();
            let response = send(
                &client,
                "POST",
                &format!("{address}/v1/chat/completions"),
                headers,
                Some("{\"stream\":true}".into()),
            )
            .await
            .unwrap();
            let head = head_of(&response);
            assert_eq!(head.status, 200);
            assert!(head
                .headers
                .iter()
                .all(|(name, _)| name != "transfer-encoding"));
            pump(response, &channel, &CancellationToken::new()).await;
        });
        let request = seen.lock().unwrap().clone();
        assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: bearer sk-secret"));
        assert!(request.ends_with("{\"stream\":true}"));
        let events: Vec<serde_json::Value> = events
            .lock()
            .unwrap()
            .iter()
            .map(|json| serde_json::from_str(json).unwrap())
            .collect();
        let text: String = events
            .iter()
            .filter_map(|event| event["text"].as_str())
            .collect();
        assert_eq!(text, "data: 1\ndata: 2\n");
        assert_eq!(events.last().unwrap()["type"], "end");
    }

    #[test]
    fn a_stopped_request_sends_nothing_more() {
        let (address, _) = serve_once(
            "HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 100\r\n\r\npartial",
        );
        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let kept = events.clone();
        let channel = Channel::<FetchEvent>::new(move |body| {
            if let InvokeResponseBody::Json(json) = body {
                kept.lock().unwrap().push(json);
            }
            Ok(())
        });
        tauri::async_runtime::block_on(async {
            let client = build_client(&ProxySetting::None).unwrap();
            let response = send(&client, "GET", &address, vec![], None).await.unwrap();
            let token = CancellationToken::new();
            token.cancel();
            pump(response, &channel, &token).await;
        });
        assert!(events.lock().unwrap().is_empty());
    }

    #[test]
    fn a_refused_connection_says_why() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let error = tauri::async_runtime::block_on(async {
            let client = build_client(&ProxySetting::None).unwrap();
            send(&client, "GET", &address, vec![], None)
                .await
                .unwrap_err()
        });
        assert!(error.to_lowercase().contains("connect"), "{error}");
    }

    #[test]
    fn origins_are_scheme_host_and_port() {
        let url = |text: &str| url::Url::parse(text).unwrap();
        assert!(same_origin(
            &url("https://api.example.com/v1"),
            &url("https://api.example.com:443/v2?x")
        ));
        for other in [
            "http://api.example.com/v1",
            "https://api.example.com:8443/v1",
            "https://evil.example/v1",
            "https://sub.api.example.com/v1",
        ] {
            assert!(
                !same_origin(&url("https://api.example.com/v1"), &url(other)),
                "{other}"
            );
        }
    }

    /// Answers a POST to `/final` with 200 and any other request with a 307
    /// to `location`, for up to two requests; returns the requests read.
    fn serve_redirect(listener: TcpListener, location: String) -> Arc<Mutex<Vec<String>>> {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let kept = seen.clone();
        thread::spawn(move || {
            for _ in 0..2 {
                let Ok((mut socket, _)) = listener.accept() else {
                    return;
                };
                let mut buffer = vec![0u8; 65536];
                let mut request = Vec::new();
                loop {
                    let read = socket.read(&mut buffer).unwrap_or(0);
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..read]);
                    let text = String::from_utf8_lossy(&request);
                    if let Some(end) = text.find("\r\n\r\n") {
                        // The test bodies are two bytes long.
                        if request.len() >= end + 4 + 2 {
                            break;
                        }
                    }
                }
                let text = String::from_utf8_lossy(&request).to_string();
                let response = if text.starts_with("POST /final ") {
                    "HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok"
                        .to_string()
                } else {
                    format!(
                        "HTTP/1.1 307 Temporary Redirect\r\nlocation: {location}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
                    )
                };
                kept.lock().unwrap().push(text);
                let _ = socket.write_all(response.as_bytes());
            }
        });
        seen
    }

    #[test]
    fn a_keyed_request_is_not_redirected_to_another_server() {
        let elsewhere = TcpListener::bind("127.0.0.1:0").unwrap();
        elsewhere.set_nonblocking(true).unwrap();
        let target = format!("http://{}/steal", elsewhere.local_addr().unwrap());
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let seen = serve_redirect(listener, target);
        let response = tauri::async_runtime::block_on(async {
            let client = build_client(&ProxySetting::None).unwrap();
            send(
                &client,
                "POST",
                &format!("{address}/"),
                vec![("x-api-key".into(), "sk-secret".into())],
                Some("{}".into()),
            )
            .await
            .unwrap()
        });
        assert_eq!(response.status().as_u16(), 307);
        assert_eq!(seen.lock().unwrap().len(), 1);
        assert!(elsewhere.accept().is_err(), "the other server was reached");
    }

    #[test]
    fn a_redirect_within_the_origin_is_followed_with_its_key() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let seen = serve_redirect(listener, format!("{address}/final"));
        let response = tauri::async_runtime::block_on(async {
            let client = build_client(&ProxySetting::None).unwrap();
            send(
                &client,
                "POST",
                &format!("{address}/"),
                vec![("x-api-key".into(), "sk-secret".into())],
                Some("{}".into()),
            )
            .await
            .unwrap()
        });
        assert_eq!(response.status().as_u16(), 200);
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 2);
        assert!(seen[1].starts_with("POST /final "));
        assert!(seen[1]
            .to_ascii_lowercase()
            .contains("x-api-key: sk-secret"));
        assert!(seen[1].ends_with("{}"));
    }

    #[test]
    fn a_bad_manual_proxy_is_reported() {
        assert!(build_client(&ProxySetting::Manual { url: "::".into() }).is_err());
        assert!(build_client(&ProxySetting::Manual {
            url: "http://127.0.0.1:7890".into()
        })
        .is_ok());
    }
}
