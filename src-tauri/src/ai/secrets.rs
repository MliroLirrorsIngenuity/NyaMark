//! The keys of the AI services a user connects.
//!
//! A key is kept in the system's credential store, together with the address
//! it was given for, and never goes back to the webview: requests are sent
//! from here (see `http.rs`), and the key goes only to that address.
//!
//! On macOS the item is written and read through `/usr/bin/security`. The
//! keychain lets the program that wrote an item read it again without asking;
//! NyaMark is signed ad hoc, so every update is another program to it and the
//! keychain asked for the login password once per key after each update.
//! `security` stays the same program. On Windows and Linux there is no such
//! check, and the `keyring` crate talks to the store directly.
//!
//! Where the store cannot be used (a Linux desktop with no Secret Service
//! running) the keys go to a file only the user can read, and the settings
//! say so.

use std::{
    collections::HashMap,
    fmt::Display,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, PoisonError},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, Window};

use super::{chatgpt, http::ProxySetting};

/// How a service expects its key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuthScheme {
    /// `Authorization: Bearer <key>`: OpenAI and the services built like it.
    Bearer,
    /// `x-api-key`: Anthropic.
    XApiKey,
    /// `x-goog-api-key`: Gemini.
    XGoogApiKey,
    /// `api-key`: Azure OpenAI.
    ApiKey,
    /// No key: the user signed in with ChatGPT, and the token comes from
    /// that sign-in (see `chatgpt.rs`).
    Chatgpt,
}

/// What is kept for one connected service.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretRecord {
    /// `scheme://host[:port]` the key may be sent to.
    pub origin: String,
    pub auth: AuthScheme,
    /// None for a service that needs no key, such as Ollama.
    pub key: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Storage {
    Keychain,
    File,
}

/// What the settings show of a saved key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub saved: bool,
    pub has_key: bool,
    pub origin: Option<String>,
    pub auth: Option<AuthScheme>,
    /// The last four characters of the key.
    pub hint: Option<String>,
    pub storage: Storage,
}

/// Why a key could not be saved or read, as the page reads it:
/// `{ kind, … }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SecretError {
    /// Not a profile id the page makes.
    BadProfile,
    /// The service's address is not an http or https one.
    BadUrl { url: String },
    /// The address moved to another site, and the saved key stays with the
    /// old one: it has to be entered again.
    KeyNeeded,
    /// The credential store, or the file standing in for it, failed.
    Store { message: String },
}

fn store_error(error: impl Display) -> SecretError {
    SecretError::Store {
        message: error.to_string(),
    }
}

/// A place secrets are kept under an account name.
pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, SecretError>;
    fn set(&self, account: &str, value: &str) -> Result<(), SecretError>;
    fn delete(&self, account: &str) -> Result<(), SecretError>;
}

/// The keys read since launch, so a request does not start a process.
#[derive(Default)]
pub struct SecretCache(pub Mutex<HashMap<String, Option<SecretRecord>>>);

/// Changes a settings dialog made and has not confirmed, by window and
/// account: that window's requests use them, so a key can be tried before
/// it is kept, and the store gets them only on confirming.
#[derive(Default)]
pub struct StagedSecrets(pub Mutex<Staged>);

const PREFIX: &str = "nyamark-b64:";

/// A record as stored: base64 behind a prefix, so the store holds plain
/// ASCII that `security` prints back as it was given.
pub fn encode_record<T: Serialize>(record: &T) -> Result<String, SecretError> {
    let json = serde_json::to_vec(record).map_err(store_error)?;
    Ok(format!("{PREFIX}{}", STANDARD.encode(json)))
}

pub fn decode_record<T: DeserializeOwned>(stored: &str) -> Result<T, SecretError> {
    let encoded = stored
        .trim()
        .strip_prefix(PREFIX)
        .ok_or_else(|| store_error("The saved key is not one NyaMark wrote"))?;
    let json = STANDARD.decode(encoded).map_err(store_error)?;
    serde_json::from_slice(&json).map_err(store_error)
}

const PROFILE_ACCOUNT: &str = "profile-";

/// A profile id names a keychain item, so it is kept to plain characters.
pub fn account_for(profile: &str) -> Result<String, SecretError> {
    let plain = !profile.is_empty()
        && profile.len() <= 64
        && profile
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if plain {
        Ok(format!("{PROFILE_ACCOUNT}{profile}"))
    } else {
        Err(SecretError::BadProfile)
    }
}

/// `scheme://host[:port]` of an address, the form a key is saved for; none
/// for what is not an http or https address.
pub fn origin_of(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let web = matches!(parsed.scheme(), "http" | "https") && parsed.host_str().is_some();
    web.then(|| parsed.origin().ascii_serialization())
}

/// Keys in a JSON file in the app's data folder, readable by the user only.
pub struct FileStore {
    path: PathBuf,
}

impl FileStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn load(&self) -> Result<HashMap<String, String>, SecretError> {
        match fs::read(&self.path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(store_error),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
            Err(error) => Err(store_error(error)),
        }
    }

    fn save(&self, entries: &HashMap<String, String>) -> Result<(), SecretError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(store_error)?;
        }
        let bytes = serde_json::to_vec_pretty(entries).map_err(store_error)?;
        crate::document::write_atomically(&self.path, &bytes).map_err(store_error)?;
        restrict_to_owner(&self.path)
    }
}

#[cfg(unix)]
fn restrict_to_owner(path: &Path) -> Result<(), SecretError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(store_error)
}

#[cfg(not(unix))]
fn restrict_to_owner(_path: &Path) -> Result<(), SecretError> {
    Ok(())
}

impl SecretStore for FileStore {
    fn get(&self, account: &str) -> Result<Option<String>, SecretError> {
        Ok(self.load()?.remove(account))
    }

    fn set(&self, account: &str, value: &str) -> Result<(), SecretError> {
        let mut entries = self.load()?;
        entries.insert(account.to_string(), value.to_string());
        self.save(&entries)
    }

    fn delete(&self, account: &str) -> Result<(), SecretError> {
        let mut entries = self.load()?;
        if entries.remove(account).is_some() {
            self.save(&entries)?;
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod keychain {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };

    use super::{store_error, SecretError, SecretStore};

    const SECURITY: &str = "/usr/bin/security";
    /// `security`'s exit status for an item that is not there.
    const NOT_FOUND: i32 = 44;

    pub struct Keychain {
        pub service: String,
    }

    /// The line `security -i` reads to save an item. The value goes as hex
    /// on standard input, out of the process list and of any quoting.
    pub fn add_command(service: &str, account: &str, value: &str) -> String {
        let hex: String = value.bytes().map(|byte| format!("{byte:02x}")).collect();
        format!("add-generic-password -U -s {service} -a {account} -l {service} -X {hex}\n")
    }

    impl SecretStore for Keychain {
        fn get(&self, account: &str) -> Result<Option<String>, SecretError> {
            let output = Command::new(SECURITY)
                .args([
                    "find-generic-password",
                    "-s",
                    &self.service,
                    "-a",
                    account,
                    "-w",
                ])
                .output()
                .map_err(store_error)?;
            if output.status.code() == Some(NOT_FOUND) {
                return Ok(None);
            }
            if !output.status.success() {
                return Err(store_error(String::from_utf8_lossy(&output.stderr).trim()));
            }
            Ok(Some(
                String::from_utf8_lossy(&output.stdout)
                    .trim_end()
                    .to_string(),
            ))
        }

        fn set(&self, account: &str, value: &str) -> Result<(), SecretError> {
            let mut child = Command::new(SECURITY)
                .arg("-i")
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(store_error)?;
            if let Some(mut stdin) = child.stdin.take() {
                stdin
                    .write_all(add_command(&self.service, account, value).as_bytes())
                    .map_err(store_error)?;
            }
            let output = child.wait_with_output().map_err(store_error)?;
            // `security -i` exits 0 when a command in it failed and tells
            // only on standard error.
            let errors = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if !output.status.success() || !errors.is_empty() {
                return Err(store_error(if errors.is_empty() {
                    format!("security exited with {}", output.status)
                } else {
                    errors
                }));
            }
            Ok(())
        }

        fn delete(&self, account: &str) -> Result<(), SecretError> {
            let output = Command::new(SECURITY)
                .args([
                    "delete-generic-password",
                    "-s",
                    &self.service,
                    "-a",
                    account,
                ])
                .output()
                .map_err(store_error)?;
            if output.status.success() || output.status.code() == Some(NOT_FOUND) {
                Ok(())
            } else {
                Err(store_error(String::from_utf8_lossy(&output.stderr).trim()))
            }
        }
    }
}

#[cfg(any(windows, target_os = "linux"))]
mod keychain {
    use super::{store_error, SecretError, SecretStore};

    pub struct Keychain {
        pub service: String,
    }

    impl Keychain {
        pub fn available() -> bool {
            keyring::Entry::store_status().is_ok()
        }

        fn entry(&self, account: &str) -> Result<keyring::Entry, SecretError> {
            keyring::Entry::new(&self.service, account).map_err(store_error)
        }
    }

    impl SecretStore for Keychain {
        fn get(&self, account: &str) -> Result<Option<String>, SecretError> {
            match self.entry(account)?.get_password() {
                Ok(value) => Ok(Some(value)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(store_error(error)),
            }
        }

        fn set(&self, account: &str, value: &str) -> Result<(), SecretError> {
            self.entry(account)?
                .set_password(value)
                .map_err(store_error)
        }

        fn delete(&self, account: &str) -> Result<(), SecretError> {
            match self.entry(account)?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(store_error(error)),
            }
        }
    }
}

/// The store this system offers, and which kind it is.
#[cfg(target_os = "macos")]
pub(crate) fn store<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(Box<dyn SecretStore>, Storage), SecretError> {
    let service = format!("{}.ai", app.config().identifier);
    Ok((Box::new(keychain::Keychain { service }), Storage::Keychain))
}

/// The store this system offers, and which kind it is.
#[cfg(not(target_os = "macos"))]
pub(crate) fn store<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(Box<dyn SecretStore>, Storage), SecretError> {
    #[cfg(any(windows, target_os = "linux"))]
    if keychain::Keychain::available() {
        let service = format!("{}.ai", app.config().identifier);
        return Ok((Box::new(keychain::Keychain { service }), Storage::Keychain));
    }
    let dir = app.path().app_data_dir().map_err(store_error)?;
    Ok((
        Box::new(FileStore::new(dir.join("ai").join("keys.json"))),
        Storage::File,
    ))
}

/// The record saved for a profile, read through the cache.
fn saved_record<R: Runtime>(
    app: &AppHandle<R>,
    account: &str,
) -> Result<Option<SecretRecord>, SecretError> {
    let cache = app.state::<SecretCache>();
    if let Some(cached) = lock(&cache.0).get(account) {
        return Ok(cached.clone());
    }
    let (store, _) = store(app)?;
    let record = store
        .get(account)?
        .map(|stored| decode_record(&stored))
        .transpose()?;
    lock(&cache.0).insert(account.to_string(), record.clone());
    Ok(record)
}

/// How a profile's saved record, confirmed in the settings, sends its
/// requests; none when nothing is saved or it cannot be read.
pub(crate) fn saved_auth<R: Runtime>(app: &AppHandle<R>, profile: &str) -> Option<AuthScheme> {
    let account = account_for(profile).ok()?;
    Some(saved_record(app, &account).ok()??.auth)
}

/// The maps here are replaced an entry at a time, so one a panic left
/// poisoned is still sound.
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The record a window's requests use for a profile: what its settings
/// dialog changed, while that is open, or else what is saved.
pub fn record<R: Runtime>(
    app: &AppHandle<R>,
    window: &str,
    profile: &str,
) -> Result<Option<SecretRecord>, SecretError> {
    let account = account_for(profile)?;
    let staged = lock(&app.state::<StagedSecrets>().0)
        .get(&(window.to_string(), account.clone()))
        .cloned();
    match staged {
        Some(staged) => Ok(staged),
        None => saved_record(app, &account),
    }
}

/// The record a save makes. A key left out keeps the one saved before, but
/// only for the same address: a key is never sent somewhere it was not
/// given for.
pub fn next_record(
    previous: Option<&SecretRecord>,
    origin: String,
    auth: AuthScheme,
    key: Option<String>,
    keep_key: bool,
) -> Result<SecretRecord, SecretError> {
    let key = match key {
        Some(key) => {
            let key = key.trim().to_string();
            (!key.is_empty()).then_some(key)
        }
        None if keep_key => match previous {
            Some(previous) if previous.key.is_some() && previous.origin != origin => {
                return Err(SecretError::KeyNeeded);
            }
            Some(previous) => previous.key.clone(),
            None => None,
        },
        None => None,
    };
    Ok(SecretRecord { origin, auth, key })
}

pub fn status_of(record: Option<&SecretRecord>, storage: Storage) -> SecretStatus {
    SecretStatus {
        saved: record.is_some(),
        has_key: record.is_some_and(|record| record.key.is_some()),
        origin: record.map(|record| record.origin.clone()),
        auth: record.map(|record| record.auth),
        hint: record.and_then(|record| record.key.as_deref()).map(|key| {
            let chars: Vec<char> = key.chars().collect();
            chars[chars.len().saturating_sub(4)..].iter().collect()
        }),
        storage,
    }
}

fn stage<R: Runtime>(
    app: &AppHandle<R>,
    window: &str,
    account: String,
    record: Option<SecretRecord>,
) {
    lock(&app.state::<StagedSecrets>().0).insert((window.to_string(), account), record);
}

/// Set where a profile's requests may go, and with which key, for the
/// window's settings dialog until it is confirmed or cancelled.
#[tauri::command(async)]
pub fn ai_secret_set(
    app: AppHandle,
    window: Window,
    profile: String,
    base_url: String,
    auth: AuthScheme,
    key: Option<String>,
    keep_key: bool,
) -> Result<SecretStatus, SecretError> {
    let account = account_for(&profile)?;
    let origin = origin_of(&base_url).ok_or_else(|| SecretError::BadUrl {
        url: base_url.clone(),
    })?;
    // A ChatGPT sign-in's tokens are for OpenAI's API alone, and it has no
    // key to keep.
    let chatgpt = auth == AuthScheme::Chatgpt;
    if chatgpt && origin_of(chatgpt::RESOURCE).as_ref() != Some(&origin) {
        return Err(SecretError::BadUrl { url: base_url });
    }
    let (key, keep_key) = if chatgpt {
        (None, false)
    } else {
        (key, keep_key)
    };
    let previous = record(&app, window.label(), &profile)?;
    let next = next_record(previous.as_ref(), origin, auth, key, keep_key)?;
    let (_, storage) = store(&app)?;
    let status = status_of(Some(&next), storage);
    stage(&app, window.label(), account, Some(next));
    Ok(status)
}

#[tauri::command(async)]
pub fn ai_secret_status(
    app: AppHandle,
    window: Window,
    profile: String,
) -> Result<SecretStatus, SecretError> {
    let (_, storage) = store(&app)?;
    Ok(status_of(
        record(&app, window.label(), &profile)?.as_ref(),
        storage,
    ))
}

/// Forget a profile's key, once the window's settings dialog is confirmed.
#[tauri::command(async)]
pub fn ai_secret_delete(
    app: AppHandle,
    window: Window,
    profile: String,
) -> Result<(), SecretError> {
    let account = account_for(&profile)?;
    stage(&app, window.label(), account, None);
    Ok(())
}

type Staged = HashMap<(String, String), Option<SecretRecord>>;

/// Takes out what one window staged, by account.
fn drain_window(staged: &mut Staged, window: &str) -> Vec<(String, Option<SecretRecord>)> {
    let keys: Vec<_> = staged
        .keys()
        .filter(|(label, _)| label == window)
        .cloned()
        .collect();
    keys.into_iter()
        .filter_map(|key| staged.remove(&key).map(|record| (key.1, record)))
        .collect()
}

fn take_staged<R: Runtime>(
    app: &AppHandle<R>,
    window: &str,
) -> Vec<(String, Option<SecretRecord>)> {
    drain_window(&mut lock(&app.state::<StagedSecrets>().0), window)
}

/// Keep what the window's settings dialog changed. A service that signed in
/// with ChatGPT and no longer does (removed, or switched to a key) signs
/// out and forgets its registration, through `proxy`.
#[tauri::command(async)]
pub fn ai_secrets_commit(
    app: AppHandle,
    window: Window,
    proxy: Option<ProxySetting>,
) -> Result<(), SecretError> {
    let (store, _) = store(&app)?;
    let signed_in = chatgpt::take_unconfirmed(&app, window.label());
    let staged = take_staged(&app, window.label());
    // Signed in, then left as it was saved: a service that does not sign in
    // with ChatGPT keeps no registration.
    let mut leaving: Vec<String> = signed_in
        .iter()
        .filter(|profile| {
            let account = format!("{PROFILE_ACCOUNT}{profile}");
            !staged.iter().any(|(staged, _)| staged == &account)
                && saved_auth(&app, profile) != Some(AuthScheme::Chatgpt)
        })
        .cloned()
        .collect();
    let mut failed = None;
    for (account, record) in staged {
        if let Some(profile) = account.strip_prefix(PROFILE_ACCOUNT) {
            let was = signed_in.iter().any(|signed| signed == profile)
                || saved_auth(&app, profile) == Some(AuthScheme::Chatgpt);
            let stays = record
                .as_ref()
                .is_some_and(|record| record.auth == AuthScheme::Chatgpt);
            if was && !stays {
                leaving.push(profile.to_string());
            }
        }
        let written = match &record {
            Some(record) => encode_record(record).and_then(|value| store.set(&account, &value)),
            None => store.delete(&account),
        };
        lock(&app.state::<SecretCache>().0).remove(&account);
        if let Err(error) = written {
            failed.get_or_insert(error);
        }
    }
    chatgpt::forget_later(&app, leaving, proxy.unwrap_or_default());
    failed.map_or(Ok(()), Err)
}

/// Drop what the window's settings dialog changed. A service it added and
/// signed in with ChatGPT signs out again, through `proxy`.
#[tauri::command(async)]
pub fn ai_secrets_discard(app: AppHandle, window: Window, proxy: Option<ProxySetting>) {
    take_staged(&app, window.label());
    chatgpt::abandon(&app, window.label(), proxy.unwrap_or_default());
}

/// A closed window's dialog can no longer be confirmed.
pub fn forget_window<R: Runtime>(app: &AppHandle<R>, window: &str) {
    take_staged(app, window);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(origin: &str, key: Option<&str>) -> SecretRecord {
        SecretRecord {
            origin: origin.to_string(),
            auth: AuthScheme::Bearer,
            key: key.map(str::to_string),
        }
    }

    #[test]
    fn a_record_reads_back_as_written() {
        let written = SecretRecord {
            origin: "https://api.example.com".into(),
            auth: AuthScheme::XApiKey,
            key: Some("sk-ä \"quoted\" \\ key".into()),
        };
        let stored = encode_record(&written).unwrap();
        assert!(stored.is_ascii());
        assert_eq!(decode_record(&format!("{stored}\n")), Ok(written));
        assert!(decode_record::<SecretRecord>("plain").is_err());
    }

    #[test]
    fn a_profile_id_names_an_account_only_when_plain() {
        assert_eq!(account_for("openai-1_a"), Ok("profile-openai-1_a".into()));
        assert!(account_for("").is_err());
        assert!(account_for("a b").is_err());
        assert!(account_for("a;rm").is_err());
        assert!(account_for(&"x".repeat(65)).is_err());
    }

    #[test]
    fn the_origin_leaves_the_path_out() {
        assert_eq!(
            origin_of("https://api.openai.com/v1/"),
            Some("https://api.openai.com".into())
        );
        assert_eq!(
            origin_of("http://127.0.0.1:11434/v1"),
            Some("http://127.0.0.1:11434".into())
        );
        assert_eq!(
            origin_of("https://example.com:443/x"),
            Some("https://example.com".into())
        );
        assert_eq!(origin_of("file:///etc/passwd"), None);
        assert_eq!(origin_of("not a url"), None);
    }

    #[test]
    fn a_kept_key_stays_with_its_address() {
        let previous = record("https://a.example", Some("k1"));
        let same = next_record(
            Some(&previous),
            "https://a.example".into(),
            AuthScheme::Bearer,
            None,
            true,
        );
        assert_eq!(same.map(|r| r.key), Ok(Some("k1".into())));
        let moved = next_record(
            Some(&previous),
            "https://b.example".into(),
            AuthScheme::Bearer,
            None,
            true,
        );
        assert_eq!(moved, Err(SecretError::KeyNeeded));
        let cleared = next_record(
            Some(&previous),
            "https://b.example".into(),
            AuthScheme::Bearer,
            None,
            false,
        );
        assert_eq!(cleared.map(|r| r.key), Ok(None));
        let typed = next_record(
            Some(&previous),
            "https://b.example".into(),
            AuthScheme::Bearer,
            Some("  k2 \n".into()),
            true,
        );
        assert_eq!(typed.map(|r| r.key), Ok(Some("k2".into())));
    }

    #[test]
    fn the_status_shows_only_the_end_of_a_key() {
        let status = status_of(
            Some(&record("https://a.example", Some("sk-123456"))),
            Storage::File,
        );
        assert_eq!(status.hint.as_deref(), Some("3456"));
        assert!(status.has_key);
        let short = status_of(
            Some(&record("https://a.example", Some("ab"))),
            Storage::File,
        );
        assert_eq!(short.hint.as_deref(), Some("ab"));
        let none = status_of(None, Storage::Keychain);
        assert!(!none.saved && !none.has_key && none.hint.is_none());
    }

    #[test]
    fn the_file_store_keeps_entries_apart() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileStore::new(dir.path().join("ai").join("keys.json"));
        assert_eq!(store.get("a"), Ok(None));
        assert_eq!(store.set("a", "1"), Ok(()));
        assert_eq!(store.set("b", "2"), Ok(()));
        assert_eq!(store.get("a"), Ok(Some("1".into())));
        assert_eq!(store.delete("a"), Ok(()));
        assert_eq!(store.delete("a"), Ok(()));
        assert_eq!(store.get("a"), Ok(None));
        assert_eq!(store.get("b"), Ok(Some("2".into())));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let meta = fs::metadata(dir.path().join("ai").join("keys.json")).unwrap();
            assert_eq!(meta.permissions().mode() & 0o777, 0o600);
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_keychain_command_carries_the_value_as_hex() {
        let line = keychain::add_command("svc.ai", "profile-a", "k \"1\"");
        assert_eq!(
            line,
            "add-generic-password -U -s svc.ai -a profile-a -l svc.ai -X 6b20223122\n"
        );
    }

    #[test]
    fn a_window_takes_out_only_what_it_staged() {
        let mut staged = Staged::new();
        let a = record("https://a.example", Some("k"));
        staged.insert(("main".into(), "profile-a".into()), Some(a.clone()));
        staged.insert(("main".into(), "profile-b".into()), None);
        staged.insert(("editor-2".into(), "profile-a".into()), None);
        let mut taken = drain_window(&mut staged, "main");
        taken.sort_by(|x, y| x.0.cmp(&y.0));
        assert_eq!(
            taken,
            vec![
                ("profile-a".to_string(), Some(a)),
                ("profile-b".to_string(), None)
            ]
        );
        assert_eq!(staged.len(), 1);
        assert!(drain_window(&mut staged, "main").is_empty());
    }
}
