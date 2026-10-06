//! Web search and page fetches for the assistant.
//!
//! Search reads the result pages a browser would get, since the engines that
//! need no key have no API. Those pages change and sometimes turn into a
//! captcha, so auto mode tries the next engine when one fails and starts with
//! the one that worked last.
//!
//! A fetch follows the address the model chose, so it keeps to the public
//! internet: an address on this machine or the local network is refused, on
//! the first request and on every redirect, unless the user allowed that
//! host.

use std::{
    collections::HashSet,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::{Arc, Mutex, OnceLock, PoisonError},
    time::Duration,
};

use base64::Engine as _;
use dom_query::{Document, Selection};
use reqwest::header::{ACCEPT, ACCEPT_LANGUAGE, CONTENT_TYPE, LOCATION, USER_AGENT};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use url::Url;

use super::http::{self, ProxySetting};

/// Each engine gets this long before the next one is tried.
const ENGINE_TIMEOUT: Duration = Duration::from_secs(6);
/// A whole fetch, redirects and body included.
const FETCH_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_REDIRECTS: usize = 5;
/// The most of a page a fetch returns; the rest is cut off.
const MAX_PAGE_BYTES: usize = 5 * 1024 * 1024;
/// A result page is far smaller; more than this is not one.
const MAX_RESULTS_PAGE_BYTES: usize = 4 * 1024 * 1024;
const DEFAULT_LIMIT: u32 = 8;
const MAX_LIMIT: u32 = 20;
const DEFAULT_ACCEPT_LANGUAGE: &str = "zh-CN,zh;q=0.9,en;q=0.8";

/// Engines answer a desktop browser; an unknown client gets a captcha or a
/// stripped page.
#[cfg(target_os = "macos")]
const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
#[cfg(windows)]
const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
#[cfg(not(any(target_os = "macos", windows)))]
const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const HTML_ACCEPT: &str = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchEngine {
    #[default]
    Auto,
    Bing,
    Duckduckgo,
    Searxng,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub query: String,
    #[serde(default)]
    pub engine: SearchEngine,
    #[serde(default)]
    pub searxng_url: Option<String>,
    #[serde(default)]
    pub proxy: ProxySetting,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    /// The engine that answered.
    pub engine: String,
    pub results: Vec<SearchResult>,
}

/// Why a search or a fetch failed, as the page reads it: `{ kind, … }`.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum WebError {
    EmptyQuery,
    /// Search is set to SearXNG with no address for it.
    NoSearxngUrl,
    AllEnginesFailed {
        failures: Vec<EngineFailure>,
    },
    BadUrl {
        message: String,
    },
    UnsupportedScheme {
        scheme: String,
    },
    /// The address is on this machine or the local network.
    PrivateAddress {
        host: String,
    },
    BadRedirect {
        message: String,
    },
    TooManyRedirects,
    UnsupportedContentType {
        content_type: String,
    },
    Timeout,
    BadProxy {
        message: String,
    },
    Network {
        message: String,
    },
}

/// One engine that did not answer, and why, in words for the reader.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct EngineFailure {
    pub engine: &'static str,
    pub reason: String,
}

impl From<http::ClientError> for WebError {
    fn from(error: http::ClientError) -> Self {
        match error {
            http::ClientError::BadProxy { message } => Self::BadProxy { message },
            http::ClientError::Build { message } => Self::Network { message },
        }
    }
}

/// One way of getting results; DuckDuckGo has two pages, and the second
/// often still answers when the first sends a captcha.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Backend {
    Bing,
    DuckDuckGo,
    DuckDuckGoLite,
    Searxng,
}

impl Backend {
    fn name(self) -> &'static str {
        match self {
            Self::Bing => "bing",
            Self::DuckDuckGo => "duckduckgo",
            Self::DuckDuckGoLite => "duckduckgo-lite",
            Self::Searxng => "searxng",
        }
    }
}

/// The engine that answered last in auto mode, tried first next time.
#[derive(Default)]
pub struct LastSearchEngine(Mutex<Option<Backend>>);

/// Auto mode's order: the one that worked last, then the rest as listed.
fn auto_order(last: Option<Backend>) -> Vec<Backend> {
    let mut order = vec![Backend::Bing, Backend::DuckDuckGo, Backend::DuckDuckGoLite];
    if let Some(last) = last {
        if let Some(index) = order.iter().position(|backend| *backend == last) {
            let backend = order.remove(index);
            order.insert(0, backend);
        }
    }
    order
}

struct Query<'a> {
    text: &'a str,
    limit: usize,
    /// Set whenever SearXNG is among the engines tried.
    searxng_url: &'a str,
    accept_language: &'a str,
}

/// Search the web with the engine the user picked, or in auto mode with
/// whichever answers.
#[tauri::command]
pub async fn web_search(
    app: AppHandle,
    request: SearchRequest,
) -> Result<SearchResponse, WebError> {
    let client = http::search_client(&app, &request.proxy)?;
    let last = app
        .state::<LastSearchEngine>()
        .0
        .lock()
        .map(|last| *last)
        .unwrap_or(None);
    let backends = match request.engine {
        SearchEngine::Auto => auto_order(last),
        SearchEngine::Bing => vec![Backend::Bing],
        SearchEngine::Duckduckgo => vec![Backend::DuckDuckGo, Backend::DuckDuckGoLite],
        SearchEngine::Searxng => vec![Backend::Searxng],
    };
    let response = search(&client, &request, &backends).await?;
    if request.engine == SearchEngine::Auto {
        if let Some(backend) = backends.iter().find(|b| b.name() == response.engine) {
            if let Ok(mut last) = app.state::<LastSearchEngine>().0.lock() {
                *last = Some(*backend);
            }
        }
    }
    Ok(response)
}

async fn search(
    client: &reqwest::Client,
    request: &SearchRequest,
    backends: &[Backend],
) -> Result<SearchResponse, WebError> {
    let text = request.query.trim();
    if text.is_empty() {
        return Err(WebError::EmptyQuery);
    }
    let searxng_url = request
        .searxng_url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty());
    if searxng_url.is_none() && backends.contains(&Backend::Searxng) {
        return Err(WebError::NoSearxngUrl);
    }
    let query = Query {
        text,
        limit: request.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT) as usize,
        searxng_url: searxng_url.unwrap_or_default(),
        accept_language: accept_language_header(),
    };
    let mut failures = Vec::new();
    for backend in backends {
        match run(client, *backend, &query).await {
            Ok(results) => {
                return Ok(SearchResponse {
                    engine: backend.name().into(),
                    results,
                })
            }
            Err(reason) => failures.push(EngineFailure {
                engine: backend.name(),
                reason,
            }),
        }
    }
    Err(WebError::AllEnginesFailed { failures })
}

async fn run(
    client: &reqwest::Client,
    backend: Backend,
    query: &Query<'_>,
) -> Result<Vec<SearchResult>, String> {
    let form = |text: &str| {
        url::form_urlencoded::Serializer::new(String::new())
            .append_pair("q", text)
            .finish()
    };
    let (html, results) = match backend {
        Backend::Bing => {
            let mut url = Url::parse("https://www.bing.com/search").map_err(|e| e.to_string())?;
            url.query_pairs_mut().append_pair("q", query.text);
            let html = results_page(client.get(url), query).await?;
            let results = parse_bing(&html);
            (html, results)
        }
        // A plain GET gets the anomaly page far more often than the form's
        // own POST.
        Backend::DuckDuckGo => {
            let request = client
                .post("https://html.duckduckgo.com/html/")
                .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
                .body(form(query.text));
            let html = results_page(request, query).await?;
            let results = parse_duckduckgo(&html);
            (html, results)
        }
        Backend::DuckDuckGoLite => {
            let request = client
                .post("https://lite.duckduckgo.com/lite/")
                .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
                .body(form(query.text));
            let html = results_page(request, query).await?;
            let results = parse_duckduckgo_lite(&html);
            (html, results)
        }
        Backend::Searxng => return searxng(client, query).await,
    };
    finish(results, query.limit, &html)
}

/// The results kept: real links only, each once, as many as asked for. None
/// at all is a failure, so auto mode moves on.
fn finish(
    results: Vec<SearchResult>,
    limit: usize,
    html: &str,
) -> Result<Vec<SearchResult>, String> {
    let results = tidy(results, limit);
    if !results.is_empty() {
        Ok(results)
    } else if looks_blocked(html) {
        Err("captcha".into())
    } else {
        Err("no results".into())
    }
}

fn tidy(results: Vec<SearchResult>, limit: usize) -> Vec<SearchResult> {
    let mut seen = HashSet::new();
    results
        .into_iter()
        .filter(|result| {
            !result.title.is_empty()
                && (result.url.starts_with("https://") || result.url.starts_with("http://"))
                && !is_ad(&result.url)
        })
        .filter(|result| seen.insert(result.url.trim_end_matches('/').to_string()))
        .take(limit)
        .collect()
}

fn is_ad(url: &str) -> bool {
    let Ok(url) = Url::parse(url) else {
        return false;
    };
    let host = url.host_str().unwrap_or_default();
    (host.ends_with("duckduckgo.com") && url.path() == "/y.js")
        || (host.ends_with("bing.com") && url.path().starts_with("/aclick"))
}

fn looks_blocked(html: &str) -> bool {
    let html = html.to_ascii_lowercase();
    ["captcha", "anomaly-modal", "/turing/"]
        .iter()
        .any(|marker| html.contains(marker))
}

async fn results_page(
    request: reqwest::RequestBuilder,
    query: &Query<'_>,
) -> Result<String, String> {
    let response = request
        .header(USER_AGENT, BROWSER_USER_AGENT)
        .header(ACCEPT, HTML_ACCEPT)
        .header(ACCEPT_LANGUAGE, query.accept_language)
        .timeout(ENGINE_TIMEOUT)
        .send()
        .await
        .map_err(|error| reason(&error))?;
    let status = response.status().as_u16();
    // DuckDuckGo answers a suspected bot with 202 and a captcha; others
    // with 403 or 429.
    if matches!(status, 202 | 403 | 429) {
        return Err(format!("blocked (HTTP {status})"));
    }
    if !response.status().is_success() {
        return Err(format!("HTTP {status}"));
    }
    let content_type = header_text(&response, CONTENT_TYPE);
    let (bytes, _) = read_capped(response, MAX_RESULTS_PAGE_BYTES)
        .await
        .map_err(|error| reason(&error))?;
    Ok(decode_text(&bytes, content_type.as_deref()))
}

fn reason(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "timeout".into()
    } else {
        http::describe(error)
    }
}

fn header_text(response: &reqwest::Response, name: reqwest::header::HeaderName) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

/// The body up to `limit` bytes, and whether there was more.
async fn read_capped(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<(Vec<u8>, bool), reqwest::Error> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        let room = limit - body.len();
        if chunk.len() > room {
            body.extend_from_slice(&chunk[..room]);
            return Ok((body, true));
        }
        body.extend_from_slice(&chunk);
    }
    Ok((body, false))
}

/// A selector that matches nothing rather than panicking when it cannot be
/// parsed; the ones here are fixed, and the tests run each of them.
fn select<'a>(scope: &Selection<'a>, selector: &str) -> Selection<'a> {
    scope.try_select(selector).unwrap_or_default()
}

fn select_in<'a>(document: &'a Document, selector: &str) -> Selection<'a> {
    document.try_select(selector).unwrap_or_default()
}

fn text_of(selection: &Selection) -> String {
    collapse(&selection.text())
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_bing(html: &str) -> Vec<SearchResult> {
    let document = Document::from(html);
    select_in(&document, ".b_ad").remove();
    select_in(&document, "#b_results > li.b_algo")
        .iter()
        .filter_map(|item| {
            let link = select(&item, "h2 a").first();
            let href = link.attr("href")?;
            let snippet = select(
                &item,
                ".b_caption p, p.b_lineclamp2, p.b_lineclamp3, p.b_algoSlug",
            )
            .first();
            Some(SearchResult {
                title: text_of(&link),
                url: unwrap_bing(&href),
                snippet: text_of(&snippet),
            })
        })
        .collect()
}

/// Bing sends some clicks through a tracking page that names the target as
/// `u=a1` and the address in unpadded URL-safe base64.
fn unwrap_bing(href: &str) -> String {
    let Some(url) = absolute("https://www.bing.com/", href) else {
        return href.to_string();
    };
    if url
        .host_str()
        .is_some_and(|host| host.ends_with("bing.com"))
        && url.path() == "/ck/a"
    {
        let target = url
            .query_pairs()
            .find(|(name, _)| name == "u")
            .and_then(|(_, value)| {
                let encoded = value.strip_prefix("a1")?.trim_end_matches('=').to_string();
                let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
                    .decode(encoded)
                    .ok()?;
                String::from_utf8(bytes).ok()
            });
        if let Some(target) = target {
            return target;
        }
    }
    url.to_string()
}

fn parse_duckduckgo(html: &str) -> Vec<SearchResult> {
    let document = Document::from(html);
    select_in(&document, ".result--ad").remove();
    select_in(&document, "div.result")
        .iter()
        .filter_map(|item| {
            let link = select(&item, "a.result__a").first();
            let href = link.attr("href")?;
            Some(SearchResult {
                title: text_of(&link),
                url: unwrap_duckduckgo(&href),
                snippet: text_of(&select(&item, ".result__snippet").first()),
            })
        })
        .collect()
}

/// DuckDuckGo sends clicks through `/l/?uddg=<address>`.
fn unwrap_duckduckgo(href: &str) -> String {
    let Some(url) = absolute("https://duckduckgo.com/", href) else {
        return href.to_string();
    };
    if url
        .host_str()
        .is_some_and(|host| host.ends_with("duckduckgo.com"))
        && url.path() == "/l/"
    {
        if let Some((_, target)) = url.query_pairs().find(|(name, _)| name == "uddg") {
            return target.into_owned();
        }
    }
    url.to_string()
}

fn absolute(base: &str, href: &str) -> Option<Url> {
    Url::parse(base).ok()?.join(href.trim()).ok()
}

/// The lite page is a table: a row with the link, then a row with its
/// snippet. Both come in page order, and each snippet follows its link.
fn parse_duckduckgo_lite(html: &str) -> Vec<SearchResult> {
    let document = Document::from(html);
    select_in(&document, "tr.result-sponsored").remove();
    let mut results: Vec<SearchResult> = Vec::new();
    for node in select_in(&document, "a.result-link, td.result-snippet").iter() {
        if node.is("a") {
            if let Some(href) = node.attr("href") {
                results.push(SearchResult {
                    title: text_of(&node),
                    url: unwrap_duckduckgo(&href),
                    snippet: String::new(),
                });
            }
        } else if let Some(last) = results.last_mut() {
            if last.snippet.is_empty() {
                last.snippet = text_of(&node);
            }
        }
    }
    results
}

/// SearXNG answers JSON when the instance allows it; most public ones turn
/// that off, so the HTML page is read instead.
async fn searxng(client: &reqwest::Client, query: &Query<'_>) -> Result<Vec<SearchResult>, String> {
    let base = query.searxng_url.trim_end_matches('/');
    let base = base.strip_suffix("/search").unwrap_or(base);
    let page = Url::parse(&format!("{base}/search")).map_err(|error| format!("{base}: {error}"))?;

    let mut json_url = page.clone();
    json_url
        .query_pairs_mut()
        .append_pair("q", query.text)
        .append_pair("format", "json");
    // Many instances turn the JSON format off; their pages still work.
    let json_failure = match results_page(client.get(json_url), query).await {
        Ok(body) => match parse_searxng_json(&body) {
            Some(results) => return finish(results, query.limit, ""),
            None => "not JSON".to_string(),
        },
        Err(error) => error,
    };

    let mut html_url = page;
    html_url.query_pairs_mut().append_pair("q", query.text);
    let html = results_page(client.get(html_url), query)
        .await
        .map_err(|error| format!("{error} (JSON: {json_failure})"))?;
    finish(parse_searxng_html(&html), query.limit, &html)
}

fn parse_searxng_json(body: &str) -> Option<Vec<SearchResult>> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let results = value.get("results")?.as_array()?;
    Some(
        results
            .iter()
            .filter_map(|result| {
                Some(SearchResult {
                    title: collapse(result.get("title")?.as_str()?),
                    url: result.get("url")?.as_str()?.to_string(),
                    snippet: collapse(
                        result
                            .get("content")
                            .and_then(|content| content.as_str())
                            .unwrap_or_default(),
                    ),
                })
            })
            .collect(),
    )
}

fn parse_searxng_html(html: &str) -> Vec<SearchResult> {
    let document = Document::from(html);
    select_in(&document, "article.result")
        .iter()
        .filter_map(|item| {
            let link = select(&item, "h3 a").first();
            let href = link.attr("href")?;
            Some(SearchResult {
                title: text_of(&link),
                url: href.to_string(),
                snippet: text_of(&select(&item, "p.content").first()),
            })
        })
        .collect()
}

/// The languages the user reads, for results in them: the system's list,
/// once per run.
fn accept_language_header() -> &'static str {
    static HEADER: OnceLock<String> = OnceLock::new();
    HEADER.get_or_init(|| accept_language(&system_languages()))
}

#[cfg(target_os = "macos")]
fn system_languages() -> Vec<String> {
    let languages: Vec<String> = objc2_foundation::NSLocale::preferredLanguages()
        .iter()
        .map(|language| language.to_string())
        .collect();
    if languages.is_empty() {
        environment_languages()
    } else {
        languages
    }
}

#[cfg(not(target_os = "macos"))]
fn system_languages() -> Vec<String> {
    environment_languages()
}

fn environment_languages() -> Vec<String> {
    let mut languages = Vec::new();
    if let Ok(list) = std::env::var("LANGUAGE") {
        languages.extend(list.split(':').map(str::to_string));
    }
    for name in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(value) = std::env::var(name) {
            if !value.is_empty() {
                languages.push(value);
                break;
            }
        }
    }
    languages
}

/// An `Accept-Language` value from locale names such as `zh-Hans-CN`,
/// `en_US.UTF-8` or `C`: each language with its region, then without,
/// in falling order.
fn accept_language(locales: &[String]) -> String {
    let mut tags: Vec<String> = Vec::new();
    for locale in locales {
        let Some(tag) = language_tag(locale) else {
            continue;
        };
        let primary = tag.split('-').next().unwrap_or_default().to_string();
        for candidate in [tag, primary] {
            if !tags
                .iter()
                .any(|seen| seen.eq_ignore_ascii_case(&candidate))
            {
                tags.push(candidate);
            }
        }
    }
    if tags.is_empty() {
        return DEFAULT_ACCEPT_LANGUAGE.into();
    }
    tags.truncate(6);
    tags.iter()
        .enumerate()
        .map(|(index, tag)| match index {
            0 => tag.clone(),
            _ => format!("{tag};q=0.{}", 10 - index),
        })
        .collect::<Vec<_>>()
        .join(",")
}

/// `zh-Hans-CN` becomes `zh-CN`, `en_US.UTF-8@euro` becomes `en-US`; the
/// POSIX locale names no language.
fn language_tag(locale: &str) -> Option<String> {
    let locale = locale.split(['.', '@']).next().unwrap_or_default().trim();
    if locale.is_empty() || locale.eq_ignore_ascii_case("c") || locale.eq_ignore_ascii_case("posix")
    {
        return None;
    }
    let mut parts = locale.split(['-', '_']).filter(|part| !part.is_empty());
    let language = parts.next()?.to_ascii_lowercase();
    if !language.chars().all(|c| c.is_ascii_alphabetic()) || !(2..=3).contains(&language.len()) {
        return None;
    }
    // A four-letter part is a script, which servers seldom match on.
    let region = parts.find(|part| part.len() != 4);
    Some(match region {
        Some(region) if region.chars().all(|c| c.is_ascii_alphanumeric()) => {
            format!("{language}-{}", region.to_ascii_uppercase())
        }
        _ => language,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRequest {
    pub url: String,
    #[serde(default)]
    pub proxy: ProxySetting,
    /// Hosts on this machine or the local network the user let the fetch
    /// reach, as a URL writes them (`[::1]` for IPv6).
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
}

impl PageRequest {
    fn allows(&self, host: &str) -> bool {
        self.allowed_hosts
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(host))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    /// Where the page was found, after redirects.
    pub url: String,
    pub status: u16,
    pub content_type: String,
    pub text: String,
    /// The page was longer than the cap and is cut off.
    pub truncated: bool,
}

/// Fetch a page as text.
#[tauri::command]
pub async fn web_fetch(request: PageRequest) -> Result<Page, WebError> {
    tokio::time::timeout(FETCH_TIMEOUT, fetch(&request, MAX_PAGE_BYTES))
        .await
        .map_err(|_| WebError::Timeout)?
}

async fn fetch(request: &PageRequest, limit: usize) -> Result<Page, WebError> {
    let mut url = Url::parse(request.url.trim()).map_err(|error| WebError::BadUrl {
        message: error.to_string(),
    })?;
    ensure_web_scheme(&url)?;
    let guarded = Arc::new(Mutex::new(HashSet::new()));
    let client = fetch_client(&request.proxy, guarded.clone())?;
    for _ in 0..=MAX_REDIRECTS {
        let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
        if !request.allows(&host) {
            ensure_public_host(&url).await?;
            guarded
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .insert(host);
        }
        let response = client
            .get(url.clone())
            .header(
                ACCEPT,
                "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
            )
            .header(ACCEPT_LANGUAGE, accept_language_header())
            .send()
            .await
            .map_err(|error| send_error(&error))?;
        if response.status().is_redirection() {
            if let Some(location) = header_text(&response, LOCATION) {
                url = url
                    .join(location.trim())
                    .map_err(|error| WebError::BadRedirect {
                        message: error.to_string(),
                    })?;
                ensure_web_scheme(&url)?;
                continue;
            }
        }
        return read_page(url, response, limit).await;
    }
    Err(WebError::TooManyRedirects)
}

/// A request that failed: refused by [`PublicOnly`] when that is among its
/// causes, else as reqwest tells it.
fn send_error(error: &reqwest::Error) -> WebError {
    let mut source = std::error::Error::source(error);
    while let Some(cause) = source {
        if let Some(PrivateHost(host)) = cause.downcast_ref::<PrivateHost>() {
            return WebError::PrivateAddress { host: host.clone() };
        }
        source = cause.source();
    }
    if error.is_timeout() {
        WebError::Timeout
    } else {
        WebError::Network {
            message: http::describe(error),
        }
    }
}

fn no_host() -> WebError {
    WebError::BadUrl {
        message: "no host".into(),
    }
}

fn ensure_web_scheme(url: &Url) -> Result<(), WebError> {
    match url.scheme() {
        "http" | "https" if url.host_str().is_some() => Ok(()),
        "http" | "https" => Err(no_host()),
        scheme => Err(WebError::UnsupportedScheme {
            scheme: scheme.into(),
        }),
    }
}

/// Redirects are followed here, one at a time, so each new address is
/// checked before anything is sent to it.
fn fetch_client(
    proxy: &ProxySetting,
    guarded: Arc<Mutex<HashSet<String>>>,
) -> Result<reqwest::Client, WebError> {
    http::install_crypto_provider();
    let builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .user_agent(BROWSER_USER_AGENT)
        .dns_resolver(PublicOnly { guarded });
    Ok(http::finish_client(builder, proxy)?)
}

/// Resolves the hosts a fetch checked and refuses private answers, so a name
/// cannot pass the check and then resolve somewhere else for the connection.
/// Other names (an allowed host's, a proxy's) resolve as usual.
struct PublicOnly {
    guarded: Arc<Mutex<HashSet<String>>>,
}

impl reqwest::dns::Resolve for PublicOnly {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_ascii_lowercase();
        let guarded = self
            .guarded
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(&host);
        Box::pin(resolve(host, guarded))
    }
}

async fn resolve(
    host: String,
    guarded: bool,
) -> Result<reqwest::dns::Addrs, Box<dyn std::error::Error + Send + Sync>> {
    let addresses: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
    if guarded && addresses.iter().any(|address| !is_public(address.ip())) {
        return Err(Box::new(PrivateHost(host)));
    }
    Ok(Box::new(addresses.into_iter()))
}

/// What [`PublicOnly`] answers for a guarded host with a private address.
#[derive(Debug)]
struct PrivateHost(String);

impl std::fmt::Display for PrivateHost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} resolves to a private address", self.0)
    }
}

impl std::error::Error for PrivateHost {}

/// Refuses an address on this machine or the local network, on every hop
/// and whether or not a proxy is set: an IP address as written, a name by
/// every address it resolves to here. Behind a proxy the proxy resolves the
/// name and picks where to connect, so a name that does not resolve here is
/// let through to it.
async fn ensure_public_host(url: &Url) -> Result<(), WebError> {
    let private = match url.host() {
        Some(url::Host::Ipv4(ip)) => !is_public(IpAddr::V4(ip)),
        Some(url::Host::Ipv6(ip)) => !is_public(IpAddr::V6(ip)),
        Some(url::Host::Domain(name)) => {
            let port = url.port_or_known_default().unwrap_or(80);
            match tokio::net::lookup_host((name, port)).await {
                Ok(mut addresses) => addresses.any(|address| !is_public(address.ip())),
                Err(_) => false,
            }
        }
        None => return Err(no_host()),
    };
    if private {
        return Err(WebError::PrivateAddress {
            host: url.host_str().unwrap_or_default().into(),
        });
    }
    Ok(())
}

/// Whether an address is on the public internet; the ranges that lead to
/// this machine or a local network are the ones that are not. 198.18.0.0/15
/// counts as public: proxies in fake-IP mode answer every name with an
/// address from it and pick the real destination themselves, as for any
/// proxied request.
fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_v4(ip),
        IpAddr::V6(ip) => match embedded_v4(ip) {
            Some(v4) => is_public_v4(v4),
            None => {
                let segments = ip.segments();
                let first = segments[0];
                !(ip.is_unspecified()
                    || ip.is_loopback()
                    || segments[..3] == [0x64, 0xff9b, 1] // local-use NAT64, 64:ff9b:1::/48
                    || first & 0xfe00 == 0xfc00 // unique local, fc00::/7
                    || first & 0xffc0 == 0xfe80 // link-local, fe80::/10
                    || first & 0xffc0 == 0xfec0 // site-local, fec0::/10
                    || first & 0xff00 == 0xff00) // multicast, ff00::/8
            }
        },
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0 // this network, unspecified
        || a == 10
        || a == 127
        || (a == 169 && b == 254) // link-local
        || (a == 172 && b & 0xf0 == 16)
        || (a == 192 && b == 168)
        || (a == 192 && b == 0 && c == 0) // protocol assignments, 192.0.0.0/24
        || (a == 100 && b & 0xc0 == 64) // carrier-grade NAT, 100.64.0.0/10
        || a >= 224) // multicast, reserved, broadcast
}

/// The IPv4 address an IPv6 one stands for: mapped (`::ffff:a.b.c.d`),
/// translated (`::ffff:0:a.b.c.d`), compatible (`::a.b.c.d`), NAT64
/// (`64:ff9b::a.b.c.d`) or 6to4 (`2002:aabb:ccdd::`, for `a.b.c.d` written
/// in hex).
fn embedded_v4(ip: Ipv6Addr) -> Option<Ipv4Addr> {
    let segments = ip.segments();
    let pair = |high: u16, low: u16| Ipv4Addr::from(u32::from(high) << 16 | u32::from(low));
    if segments[0] == 0x2002 {
        return Some(pair(segments[1], segments[2]));
    }
    let mapped = segments[..5] == [0; 5] && segments[5] == 0xffff;
    let translated = segments[..4] == [0; 4] && segments[4] == 0xffff && segments[5] == 0;
    let compatible = segments[..6] == [0; 6];
    let nat64 = segments[0] == 0x64 && segments[1] == 0xff9b && segments[2..6] == [0; 4];
    (mapped || translated || compatible || nat64).then_some(pair(segments[6], segments[7]))
}

async fn read_page(url: Url, response: reqwest::Response, limit: usize) -> Result<Page, WebError> {
    let status = response.status();
    let declared = header_text(&response, CONTENT_TYPE);
    let (bytes, truncated) = read_capped(response, limit)
        .await
        .map_err(|error| send_error(&error))?;
    let content_type = match &declared {
        Some(declared) => declared.clone(),
        // No type given: text unless it looks binary.
        None if !bytes[..bytes.len().min(1024)].contains(&0) => "text/plain".into(),
        None => String::new(),
    };
    let text = if is_text_type(&content_type) {
        decode_text(&bytes, Some(&content_type))
    } else if status.is_success() {
        let shown = if content_type.is_empty() {
            "unknown"
        } else {
            content_type.as_str()
        };
        return Err(WebError::UnsupportedContentType {
            content_type: shown.into(),
        });
    } else {
        // An error page in a type that is not text: the status says enough.
        String::new()
    };
    Ok(Page {
        url: url.to_string(),
        status: status.as_u16(),
        content_type,
        text,
        truncated,
    })
}

fn is_text_type(content_type: &str) -> bool {
    let essence = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let Some((kind, subtype)) = essence.split_once('/') else {
        return false;
    };
    kind == "text"
        || subtype.ends_with("+xml")
        || (kind == "application"
            && (matches!(subtype, "xhtml+xml" | "json" | "xml") || subtype.ends_with("+json")))
}

/// Text in the encoding the bytes declare: a byte order mark, then the
/// Content-Type charset, then a `<meta>` or XML declaration near the top,
/// else UTF-8 with bad bytes replaced.
fn decode_text(bytes: &[u8], content_type: Option<&str>) -> String {
    if let Some((encoding, bom)) = encoding_rs::Encoding::for_bom(bytes) {
        return encoding
            .decode_without_bom_handling(&bytes[bom..])
            .0
            .into_owned();
    }
    let declared = content_type
        .and_then(charset_parameter)
        .and_then(|label| encoding_rs::Encoding::for_label(label.as_bytes()));
    // A page that claims UTF-16 in its markup is ASCII-compatible, or it
    // could not have said so; browsers read it as UTF-8.
    let sniffed = || {
        sniff_charset(&bytes[..bytes.len().min(2048)])
            .and_then(|label| encoding_rs::Encoding::for_label(label.as_bytes()))
            .map(|encoding| encoding.output_encoding())
    };
    let encoding = declared.or_else(sniffed).unwrap_or(encoding_rs::UTF_8);
    encoding.decode_without_bom_handling(bytes).0.into_owned()
}

fn charset_parameter(content_type: &str) -> Option<String> {
    content_type.split(';').skip(1).find_map(|parameter| {
        let (name, value) = parameter.split_once('=')?;
        name.trim()
            .eq_ignore_ascii_case("charset")
            .then(|| value.trim().trim_matches(['"', '\'']).to_string())
            .filter(|value| !value.is_empty())
    })
}

fn sniff_charset(head: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(head).to_ascii_lowercase();
    if let Some(prolog) = text.trim_start().strip_prefix("<?xml") {
        let prolog = &prolog[..prolog.find("?>").unwrap_or(prolog.len())];
        if let Some(value) = value_after(prolog, "encoding") {
            return Some(value);
        }
    }
    let mut rest = text.as_str();
    while let Some(start) = rest.find("<meta") {
        let tag = &rest[start..];
        let tag = &tag[..tag.find('>').unwrap_or(tag.len())];
        if let Some(value) = value_after(tag, "charset") {
            return Some(value);
        }
        rest = &rest[start + "<meta".len()..];
    }
    None
}

/// The value after `name=` in a tag, quoted or not.
fn value_after(tag: &str, name: &str) -> Option<String> {
    let at = tag.find(name)? + name.len();
    let rest = tag[at..].trim_start().strip_prefix('=')?.trim_start();
    let value: String = rest
        .trim_start_matches(['"', '\''])
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
        .collect();
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    use super::*;

    const BING: &str = include_str!("fixtures/bing.html");
    const DUCKDUCKGO: &str = include_str!("fixtures/duckduckgo.html");
    const DUCKDUCKGO_LITE: &str = include_str!("fixtures/duckduckgo-lite.html");
    const DUCKDUCKGO_CAPTCHA: &str = include_str!("fixtures/duckduckgo-captcha.html");

    fn urls(results: &[SearchResult]) -> Vec<&str> {
        results.iter().map(|result| result.url.as_str()).collect()
    }

    #[test]
    fn bing_results_come_with_their_real_addresses_and_without_ads() {
        let results = tidy(parse_bing(BING), 20);
        assert_eq!(
            urls(&results),
            [
                "https://rust-lang.org/",
                "https://rust.facepunch.com/",
                "https://rust-lang.org/tools/install/",
                "https://store.steampowered.com/app/252490/Rust/",
            ]
        );
        assert!(results[0].title.contains("Rust"), "{:?}", results[0]);
        assert!(!results[0].snippet.is_empty());
        assert!(results
            .iter()
            .all(|result| !result.title.contains("Sponsored")));
        assert!(results
            .iter()
            .all(|result| !result.title.contains("  ") && !result.snippet.contains('\n')));
    }

    #[test]
    fn duckduckgo_results_lose_the_redirect_and_the_ads() {
        let results = tidy(parse_duckduckgo(DUCKDUCKGO), 20);
        assert_eq!(
            urls(&results),
            [
                "https://github.com/danmugh/rust-tauri-markdown-editor",
                "https://dev.to/ukash/i-built-a-markdown-editor-with-tauri-heres-what-i-learned-4f5l",
                "https://github.com/kelvink96/markora",
                "https://tauri.app/",
            ]
        );
        assert_eq!(
            results[1].title,
            "I built a Markdown editor with Tauri — here's what I learned"
        );
        assert!(results.iter().all(|result| !result.snippet.is_empty()));
    }

    #[test]
    fn duckduckgo_lite_rows_pair_each_link_with_its_snippet() {
        let results = tidy(parse_duckduckgo_lite(DUCKDUCKGO_LITE), 20);
        assert_eq!(results.len(), 4);
        assert_eq!(
            results[0].url,
            "https://github.com/danmugh/rust-tauri-markdown-editor"
        );
        assert!(results[0]
            .snippet
            .starts_with("A Markdown Editor App made in Rust"));
        assert!(results[1].title.contains("用 Rust + Tauri"));
        assert!(results
            .iter()
            .all(|result| !result.title.contains("Sponsored")));
        assert!(results.iter().all(|result| !result.snippet.is_empty()));
    }

    #[test]
    fn a_captcha_page_is_a_failure_that_says_so() {
        assert!(parse_duckduckgo_lite(DUCKDUCKGO_CAPTCHA).is_empty());
        assert!(parse_duckduckgo(DUCKDUCKGO_CAPTCHA).is_empty());
        assert_eq!(finish(vec![], 8, DUCKDUCKGO_CAPTCHA), Err("captcha".into()));
        let bing = "<html><body><div id=\"b_captcha\"></div></body></html>";
        assert_eq!(finish(parse_bing(bing), 8, bing), Err("captcha".into()));
        assert_eq!(
            finish(vec![], 8, "<html><body>nothing</body></html>"),
            Err("no results".into())
        );
    }

    #[test]
    fn results_are_kept_once_and_up_to_the_limit() {
        let result = |url: &str| SearchResult {
            title: "t".into(),
            url: url.into(),
            snippet: String::new(),
        };
        let results = tidy(
            vec![
                result("https://a.example/"),
                result("https://a.example"),
                result("javascript:alert(1)"),
                result("https://www.bing.com/aclick?ld=x"),
                result("https://b.example/"),
                result("https://c.example/"),
            ],
            2,
        );
        assert_eq!(urls(&results), ["https://a.example/", "https://b.example/"]);
    }

    #[test]
    fn tracking_links_are_unwrapped() {
        assert_eq!(
            unwrap_bing(
                "https://www.bing.com/ck/a?!&&p=abc&u=a1aHR0cHM6Ly9ydXN0LWxhbmcub3JnLw&ntb=1"
            ),
            "https://rust-lang.org/"
        );
        assert_eq!(
            unwrap_bing("https://example.com/x"),
            "https://example.com/x"
        );
        assert_eq!(
            unwrap_duckduckgo("//duckduckgo.com/l/?uddg=https%3A%2F%2Ftauri.app%2F&rut=1"),
            "https://tauri.app/"
        );
    }

    #[test]
    fn searxng_answers_in_json_or_html() {
        let json = r#"{"results":[{"url":"https://a.example/","title":" A \n title ","content":"one"},{"title":"no url"}]}"#;
        let results = parse_searxng_json(json).unwrap();
        assert_eq!(
            results,
            vec![SearchResult {
                title: "A title".into(),
                url: "https://a.example/".into(),
                snippet: "one".into(),
            }]
        );
        assert!(parse_searxng_json("<html>").is_none());
        let html = r#"<main><article class="result"><h3><a href="https://b.example/">B</a></h3><p class="content">two</p></article></main>"#;
        assert_eq!(urls(&parse_searxng_html(html)), ["https://b.example/"]);
    }

    #[test]
    fn auto_mode_starts_with_the_engine_that_answered_last() {
        assert_eq!(
            auto_order(None),
            [Backend::Bing, Backend::DuckDuckGo, Backend::DuckDuckGoLite]
        );
        assert_eq!(
            auto_order(Some(Backend::DuckDuckGoLite)),
            [Backend::DuckDuckGoLite, Backend::Bing, Backend::DuckDuckGo]
        );
    }

    #[test]
    fn the_language_header_follows_the_system_locales() {
        assert_eq!(
            accept_language(&["zh-Hans-CN".into(), "en-CN".into()]),
            "zh-CN,zh;q=0.9,en-CN;q=0.8,en;q=0.7"
        );
        assert_eq!(accept_language(&["en_US.UTF-8".into()]), "en-US,en;q=0.9");
        assert_eq!(accept_language(&["ja".into()]), "ja");
        assert_eq!(accept_language(&["C".into()]), DEFAULT_ACCEPT_LANGUAGE);
        assert_eq!(accept_language(&[]), DEFAULT_ACCEPT_LANGUAGE);
    }

    #[test]
    fn private_addresses_are_refused() {
        for address in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "100.127.255.255",
            "0.0.0.0",
            "224.0.0.1",
            "255.255.255.255",
            "::",
            "::1",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "ff02::1",
            "::ffff:127.0.0.1",
            "::ffff:192.168.0.1",
            "::127.0.0.1",
            "64:ff9b::10.0.0.1",
            "64:ff9b:1::8.8.8.8",
            "64:ff9b:1:abcd::1",
            "2002:7f00:1::1",
            "2002:c0a8:101::",
            "::ffff:0:127.0.0.1",
            "::ffff:0:10.0.0.1",
            "192.0.0.1",
            "192.0.0.170",
        ] {
            let ip: IpAddr = address.parse().unwrap();
            assert!(!is_public(ip), "{address}");
        }
        for address in [
            "1.1.1.1",
            "8.8.8.8",
            "172.32.0.1",
            "100.128.0.1",
            "198.18.0.5",
            "2606:4700::1111",
            "::ffff:8.8.8.8",
            "2002:808:808::1",
            "::ffff:0:8.8.8.8",
            "64:ff9b::8.8.8.8",
            "192.0.2.1",
            "192.1.0.1",
        ] {
            let ip: IpAddr = address.parse().unwrap();
            assert!(is_public(ip), "{address}");
        }
    }

    #[test]
    fn only_text_comes_back() {
        for kind in [
            "text/html; charset=utf-8",
            "text/plain",
            "application/xhtml+xml",
            "application/json",
            "application/xml",
            "application/ld+json",
            "application/rss+xml",
            "image/svg+xml",
            "TEXT/Markdown",
        ] {
            assert!(is_text_type(kind), "{kind}");
        }
        for kind in [
            "application/pdf",
            "image/png",
            "application/octet-stream",
            "",
            "text",
        ] {
            assert!(!is_text_type(kind), "{kind}");
        }
    }

    /// 中文 in GBK.
    const GBK_TEXT: &[u8] = &[0xD6, 0xD0, 0xCE, 0xC4];

    #[test]
    fn a_page_is_decoded_by_the_charset_it_declares() {
        assert_eq!(
            decode_text(GBK_TEXT, Some("text/plain; charset=GBK")),
            "中文"
        );
        assert_eq!(
            decode_text(GBK_TEXT, Some("text/plain; charset=\"gb2312\"")),
            "中文"
        );
        let mut html = b"<html><head><meta http-equiv=\"Content-Type\" content=\"text/html; charset=gbk\"></head><body>".to_vec();
        html.extend_from_slice(GBK_TEXT);
        assert!(decode_text(&html, Some("text/html")).ends_with("<body>中文"));
        let mut xml = b"<?xml version=\"1.0\" encoding=\"GB18030\"?><a>".to_vec();
        xml.extend_from_slice(GBK_TEXT);
        assert!(decode_text(&xml, None).ends_with("<a>中文"));
        assert_eq!(decode_text("中文".as_bytes(), None), "中文");
        assert_eq!(decode_text(b"a\xFFb", None), "a\u{FFFD}b");
        assert_eq!(
            decode_text(b"\xEF\xBB\xBFhi", Some("text/plain; charset=gbk")),
            "hi"
        );
    }

    /// Serves each canned response on its own connection, in order.
    fn serve(responses: Vec<Vec<u8>>) -> String {
        serve_on(TcpListener::bind("127.0.0.1:0").unwrap(), responses)
    }

    fn serve_on(listener: TcpListener, responses: Vec<Vec<u8>>) -> String {
        let address = format!("http://{}", listener.local_addr().unwrap());
        thread::spawn(move || {
            for response in responses {
                let (mut socket, _) = listener.accept().unwrap();
                let mut request = Vec::new();
                let mut buffer = [0u8; 4096];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    let read = socket.read(&mut buffer).unwrap();
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..read]);
                }
                socket.write_all(&response).unwrap();
            }
        });
        address
    }

    fn page_request(url: &str, allowed_hosts: &[&str]) -> PageRequest {
        PageRequest {
            url: url.into(),
            proxy: ProxySetting::None,
            allowed_hosts: allowed_hosts.iter().map(|host| host.to_string()).collect(),
        }
    }

    const LOCAL: &[&str] = &["127.0.0.1"];

    #[test]
    fn a_page_is_fetched_across_a_redirect_and_decoded() {
        let mut page =
            b"HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=gbk\r\nconnection: close\r\ncontent-length: 4\r\n\r\n"
                .to_vec();
        page.extend_from_slice(GBK_TEXT);
        let address = serve(vec![
            b"HTTP/1.1 302 Found\r\nlocation: /final\r\nconnection: close\r\ncontent-length: 0\r\n\r\n"
                .to_vec(),
            page,
        ]);
        let page = tauri::async_runtime::block_on(fetch(
            &page_request(&format!("{address}/start"), LOCAL),
            MAX_PAGE_BYTES,
        ))
        .unwrap();
        assert_eq!(page.url, format!("{address}/final"));
        assert_eq!(page.status, 200);
        assert_eq!(page.content_type, "text/html; charset=gbk");
        assert_eq!(page.text, "中文");
        assert!(!page.truncated);
    }

    #[test]
    fn a_long_page_is_cut_off_and_an_error_page_still_comes_back() {
        let address = serve(vec![
            b"HTTP/1.1 404 Not Found\r\ncontent-type: text/plain\r\nconnection: close\r\ncontent-length: 10\r\n\r\n0123456789"
                .to_vec(),
        ]);
        let page =
            tauri::async_runtime::block_on(fetch(&page_request(&address, LOCAL), 4)).unwrap();
        assert_eq!(page.status, 404);
        assert_eq!(page.text, "0123");
        assert!(page.truncated);
    }

    #[test]
    fn a_binary_page_is_refused() {
        let address = serve(vec![
            b"HTTP/1.1 200 OK\r\ncontent-type: application/pdf\r\nconnection: close\r\ncontent-length: 4\r\n\r\n%PDF"
                .to_vec(),
        ]);
        let error =
            tauri::async_runtime::block_on(fetch(&page_request(&address, LOCAL), 100)).unwrap_err();
        assert_eq!(
            error,
            WebError::UnsupportedContentType {
                content_type: "application/pdf".into()
            }
        );
    }

    #[test]
    fn this_machine_is_out_of_reach_unless_allowed() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        for (url, host) in [
            (address.as_str(), "127.0.0.1"),
            ("http://localhost:1/", "localhost"),
            ("http://[::1]:1/", "[::1]"),
            ("http://[::ffff:7f00:1]:1/", "[::ffff:7f00:1]"),
            ("http://0x7f.1:1/", "127.0.0.1"),
        ] {
            let error =
                tauri::async_runtime::block_on(fetch(&page_request(url, &[]), 100)).unwrap_err();
            assert_eq!(
                error,
                WebError::PrivateAddress { host: host.into() },
                "{url}"
            );
        }
        let error =
            tauri::async_runtime::block_on(fetch(&page_request("file:///etc/passwd", &[]), 100))
                .unwrap_err();
        assert_eq!(
            error,
            WebError::UnsupportedScheme {
                scheme: "file".into()
            }
        );
    }

    #[test]
    fn a_local_address_is_refused_behind_a_proxy_too() {
        // The proxy here leads nowhere; the address is refused before it is
        // ever asked.
        for (url, host) in [
            ("http://localhost/", "localhost"),
            ("http://127.0.0.1/", "127.0.0.1"),
            (
                "http://169.254.169.254/latest/meta-data/",
                "169.254.169.254",
            ),
        ] {
            let request = PageRequest {
                proxy: ProxySetting::Manual {
                    url: "http://127.0.0.1:1".into(),
                },
                ..page_request(url, &[])
            };
            let error = tauri::async_runtime::block_on(fetch(&request, 100)).unwrap_err();
            assert_eq!(
                error,
                WebError::PrivateAddress { host: host.into() },
                "{url}"
            );
        }
    }

    #[test]
    fn a_redirect_to_another_private_host_needs_that_host_allowed() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let redirect = format!(
            "HTTP/1.1 302 Found\r\nlocation: http://localhost:{port}/final\r\nconnection: close\r\ncontent-length: 0\r\n\r\n"
        )
        .into_bytes();
        let address = serve_on(
            listener,
            vec![
                redirect.clone(),
                redirect,
                b"HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\nconnection: close\r\ncontent-length: 2\r\n\r\nok"
                    .to_vec(),
            ],
        );
        let start = format!("{address}/start");
        let error =
            tauri::async_runtime::block_on(fetch(&page_request(&start, LOCAL), 100)).unwrap_err();
        assert_eq!(
            error,
            WebError::PrivateAddress {
                host: "localhost".into()
            }
        );
        let page = tauri::async_runtime::block_on(fetch(
            &page_request(&start, &["127.0.0.1", "LocalHost"]),
            100,
        ))
        .unwrap();
        assert_eq!(page.url, format!("http://localhost:{port}/final"));
        assert_eq!(page.text, "ok");
    }

    #[test]
    fn each_hop_is_checked_before_it_is_requested() {
        // What a redirect to the cloud metadata address would meet; the first
        // hop of a real redirect cannot be a local test server.
        let url = Url::parse("http://169.254.169.254/latest/meta-data/").unwrap();
        let error = tauri::async_runtime::block_on(ensure_public_host(&url)).unwrap_err();
        assert_eq!(
            error,
            WebError::PrivateAddress {
                host: "169.254.169.254".into()
            }
        );
        let guarded = Arc::new(Mutex::new(HashSet::new()));
        assert!(fetch_client(&ProxySetting::None, guarded).is_ok());
    }

    #[test]
    fn a_name_that_resolves_privately_at_connection_is_refused() {
        // A name that passed the check and then resolves to this machine
        // when connected to, as DNS rebinding would have it.
        let guarded = Arc::new(Mutex::new(HashSet::from(["localhost".to_string()])));
        let client = fetch_client(&ProxySetting::None, guarded).unwrap();
        let error =
            tauri::async_runtime::block_on(client.get("http://localhost:1/").send()).unwrap_err();
        assert_eq!(
            send_error(&error),
            WebError::PrivateAddress {
                host: "localhost".into()
            }
        );
    }

    #[test]
    fn a_failure_reaches_the_page_by_kind() {
        let json = |error: WebError| serde_json::to_value(error).unwrap();
        assert_eq!(
            json(WebError::UnsupportedContentType {
                content_type: "application/pdf".into()
            }),
            serde_json::json!({ "kind": "unsupported-content-type", "contentType": "application/pdf" })
        );
        assert_eq!(
            json(WebError::AllEnginesFailed {
                failures: vec![EngineFailure {
                    engine: "bing",
                    reason: "captcha".into()
                }]
            }),
            serde_json::json!({
                "kind": "all-engines-failed",
                "failures": [{ "engine": "bing", "reason": "captcha" }]
            })
        );
        assert_eq!(
            json(WebError::TooManyRedirects),
            serde_json::json!({ "kind": "too-many-redirects" })
        );
    }

    #[test]
    fn a_searxng_instance_without_json_is_read_as_html() {
        let html = r#"<html><body><article class="result"><h3><a href="https://c.example/">C</a></h3><p class="content">three</p></article></body></html>"#;
        let address = serve(vec![
            b"HTTP/1.1 403 Forbidden\r\nconnection: close\r\ncontent-length: 0\r\n\r\n".to_vec(),
            format!(
                "HTTP/1.1 200 OK\r\ncontent-type: text/html\r\nconnection: close\r\ncontent-length: {}\r\n\r\n{html}",
                html.len()
            )
            .into_bytes(),
        ]);
        let client = http::build_search_client(&ProxySetting::None).unwrap();
        let request = SearchRequest {
            query: "c".into(),
            engine: SearchEngine::Searxng,
            searxng_url: Some(format!("{address}/")),
            proxy: ProxySetting::None,
            limit: None,
        };
        let response =
            tauri::async_runtime::block_on(search(&client, &request, &[Backend::Searxng])).unwrap();
        assert_eq!(response.engine, "searxng");
        assert_eq!(urls(&response.results), ["https://c.example/"]);
    }

    #[test]
    fn every_failure_is_named_when_no_engine_answers() {
        let address = serve(vec![
            b"HTTP/1.1 429 Too Many Requests\r\nconnection: close\r\ncontent-length: 0\r\n\r\n"
                .to_vec(),
            b"HTTP/1.1 500 Oops\r\nconnection: close\r\ncontent-length: 0\r\n\r\n".to_vec(),
        ]);
        let client = http::build_search_client(&ProxySetting::None).unwrap();
        let request = SearchRequest {
            query: "c".into(),
            engine: SearchEngine::Searxng,
            searxng_url: Some(address),
            proxy: ProxySetting::None,
            limit: None,
        };
        let error = tauri::async_runtime::block_on(search(&client, &request, &[Backend::Searxng]))
            .unwrap_err();
        assert_eq!(
            error,
            WebError::AllEnginesFailed {
                failures: vec![EngineFailure {
                    engine: "searxng",
                    reason: "HTTP 500 (JSON: blocked (HTTP 429))".into()
                }]
            }
        );
        let request = SearchRequest {
            searxng_url: None,
            ..request
        };
        let error = tauri::async_runtime::block_on(search(&client, &request, &[Backend::Searxng]))
            .unwrap_err();
        assert_eq!(error, WebError::NoSearxngUrl);
    }
}
