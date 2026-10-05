//! Saved assistant conversations, kept per document.
//!
//! Each document gets a folder named by a hash of its path, so a path never
//! has to be made safe as a file name, with a note of the path for anyone
//! looking. A window with no saved document yet keeps its drafts in a folder
//! of its own under `unsaved`, so a first save takes along that window's
//! conversations and no other's. Images in a conversation sit beside it,
//! named by their content, so the conversation itself stays small JSON.

use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::Engine as _;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime, Window};

use super::{
    blocking,
    images::{self, MAX_IMAGE_BYTES},
};
use crate::document::write_atomically;

/// Keeps a move or a clear from crossing a write, and knows each window's
/// drafts folder.
#[derive(Default)]
pub struct HistoryLock(Mutex<Drafts>);

/// Which drafts folder belongs to which window.
#[derive(Default)]
pub struct Drafts {
    /// Set at first use, so this run's folders never meet an earlier run's.
    run: Option<String>,
    next: u64,
    windows: HashMap<String, String>,
    /// Whether the drafts left by earlier runs are gone.
    swept: bool,
}

impl Drafts {
    /// The window's drafts folder name, made at its first use.
    fn of(&mut self, window: &str) -> String {
        if let Some(draft) = self.windows.get(window) {
            return draft.clone();
        }
        let run = self
            .run
            .get_or_insert_with(|| {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|age| age.as_millis())
                    .unwrap_or_default();
                format!("{now:x}")
            })
            .clone();
        self.next += 1;
        let draft = format!("{run}-{}", self.next);
        self.windows.insert(window.to_string(), draft.clone());
        draft
    }
}

/// Whose conversations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Owner<'a> {
    /// A saved document, by its path.
    Document(&'a str),
    /// A window with no saved document, by its drafts folder name.
    Draft(&'a str),
}

/// The folder of drafts for windows with no saved document yet.
const UNSAVED: &str = "unsaved";
const DOCUMENT_NOTE: &str = "document.txt";
const IMAGE_TYPES: [(&str, &str); 5] = [
    ("image/png", "png"),
    ("image/jpeg", "jpg"),
    ("image/gif", "gif"),
    ("image/webp", "webp"),
    ("image/bmp", "bmp"),
];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub updated_at: u64,
    pub message_count: u32,
}

/// Names that stay one plain path component on every system.
pub fn check_id(id: &str) -> Result<(), String> {
    let valid = (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if valid {
        Ok(())
    } else {
        Err("bad-id".into())
    }
}

/// A document's folder name: hex, so never `unsaved`.
pub fn folder_name(document: &str) -> String {
    let digest = Sha256::digest(document.as_bytes());
    digest
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn folder(base: &Path, owner: Owner) -> Result<PathBuf, String> {
    match owner {
        Owner::Document(path) => Ok(base.join(folder_name(path))),
        Owner::Draft(draft) => {
            check_id(draft)?;
            Ok(base.join(UNSAVED).join(draft))
        }
    }
}

fn conversation_file(base: &Path, owner: Owner, id: &str) -> Result<PathBuf, String> {
    check_id(id)?;
    Ok(folder(base, owner)?.join(format!("{id}.json")))
}

/// Where a conversation's images go.
fn files_folder(base: &Path, owner: Owner, id: &str) -> Result<PathBuf, String> {
    check_id(id)?;
    Ok(folder(base, owner)?.join(format!("{id}.files")))
}

fn io_error(error: io::Error) -> String {
    if error.kind() == io::ErrorKind::NotFound {
        "not-found".into()
    } else {
        format!("io: {error}")
    }
}

fn remove_folder(folder: &Path) -> Result<(), String> {
    match fs::remove_dir_all(folder) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(error)),
    }
}

pub fn list(base: &Path, owner: Owner) -> Result<Vec<ConversationSummary>, String> {
    let entries = match fs::read_dir(folder(base, owner)?) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(io_error(error)),
    };
    let mut summaries: Vec<ConversationSummary> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let id = name.strip_suffix(".json")?;
            check_id(id).ok()?;
            let text = fs::read_to_string(entry.path()).ok()?;
            let conversation: Value = serde_json::from_str(&text).ok()?;
            let modified = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|age| u64::try_from(age.as_millis()).unwrap_or(u64::MAX))
                .unwrap_or_default();
            Some(ConversationSummary {
                id: id.to_string(),
                title: conversation["title"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                updated_at: conversation["updatedAt"]
                    .as_u64()
                    .or_else(|| conversation["updatedAt"].as_f64().map(|at| at as u64))
                    .unwrap_or(modified),
                message_count: conversation["messages"]
                    .as_array()
                    .map(|messages| u32::try_from(messages.len()).unwrap_or(u32::MAX))
                    .unwrap_or_default(),
            })
        })
        .collect();
    summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.id.cmp(&b.id)));
    Ok(summaries)
}

pub fn read(base: &Path, owner: Owner, id: &str) -> Result<Value, String> {
    let text = fs::read_to_string(conversation_file(base, owner, id)?).map_err(io_error)?;
    serde_json::from_str(&text).map_err(|error| format!("corrupt: {error}"))
}

pub fn write(base: &Path, owner: Owner, id: &str, conversation: &Value) -> Result<(), String> {
    let file = conversation_file(base, owner, id)?;
    ensure_folder(base, owner)?;
    let json = serde_json::to_vec(conversation).map_err(|error| error.to_string())?;
    write_atomically(&file, &json).map_err(io_error)
}

/// Makes the owner's folder, with the note of whose it is for a document.
fn ensure_folder(base: &Path, owner: Owner) -> Result<PathBuf, String> {
    let folder = folder(base, owner)?;
    fs::create_dir_all(&folder).map_err(io_error)?;
    if let Owner::Document(document) = owner {
        let note = folder.join(DOCUMENT_NOTE);
        if fs::read_to_string(&note).ok().as_deref() != Some(document) {
            write_atomically(&note, document.as_bytes()).map_err(io_error)?;
        }
    }
    Ok(folder)
}

/// Deleting what is already gone succeeds.
pub fn delete(base: &Path, owner: Owner, id: &str) -> Result<(), String> {
    let file = conversation_file(base, owner, id)?;
    match fs::remove_file(file) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(io_error(error)),
    }
    remove_folder(&files_folder(base, owner, id)?)
}

/// Conversations follow a document that was renamed, moved or first saved.
/// Into a folder that already has some, they are added; a conversation of
/// the same id is replaced by the one moved.
pub fn move_conversations(base: &Path, from: Owner, to: Owner) -> Result<(), String> {
    let source = folder(base, from)?;
    if source == folder(base, to)? {
        if matches!(to, Owner::Document(_)) {
            ensure_folder(base, to)?;
        }
        return Ok(());
    }
    let entries = match fs::read_dir(&source) {
        Ok(entries) => entries.collect::<Result<Vec<_>, _>>().map_err(io_error)?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io_error(error)),
    };
    let target = ensure_folder(base, to)?;
    for entry in entries {
        let name = entry.file_name();
        if name == DOCUMENT_NOTE {
            continue;
        }
        let destination = target.join(&name);
        if destination.is_dir() {
            fs::remove_dir_all(&destination).map_err(io_error)?;
        }
        fs::rename(entry.path(), destination).map_err(io_error)?;
    }
    fs::remove_dir_all(&source).map_err(io_error)
}

pub fn clear(base: &Path) -> Result<(), String> {
    remove_folder(base)
}

/// Keeps an image of a conversation and returns its id, the same for the
/// same bytes.
pub fn save_image(
    base: &Path,
    owner: Owner,
    id: &str,
    bytes: &[u8],
    mime: &str,
) -> Result<String, String> {
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("too-large".into());
    }
    // The bytes decide which type; the page's label only has to agree that
    // it is an image.
    if !mime.trim().to_ascii_lowercase().starts_with("image/") {
        return Err("not-an-image".into());
    }
    let kind = images::image_kind(bytes).ok_or_else(|| "not-an-image".to_string())?;
    let extension = IMAGE_TYPES
        .iter()
        .find(|(name, _)| *name == kind)
        .map(|(_, extension)| *extension)
        .ok_or_else(|| "not-an-image".to_string())?;
    let folder = files_folder(base, owner, id)?;
    ensure_folder(base, owner)?;
    fs::create_dir_all(&folder).map_err(io_error)?;
    let digest = Sha256::digest(bytes);
    let image: String = digest
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let file = folder.join(format!("{image}.{extension}"));
    if !file.is_file() {
        write_atomically(&file, bytes).map_err(io_error)?;
    }
    Ok(image)
}

pub fn read_image(base: &Path, owner: Owner, id: &str, image: &str) -> Result<Vec<u8>, String> {
    check_id(image)?;
    let folder = files_folder(base, owner, id)?;
    IMAGE_TYPES
        .iter()
        .map(|(_, extension)| folder.join(format!("{image}.{extension}")))
        .find(|file| file.is_file())
        .ok_or_else(|| "not-found".to_string())
        .and_then(|file| fs::read(file).map_err(io_error))
}

fn base<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("ai")
        .join("conversations"))
}

/// Runs `action` alone. The first call of a run first drops the drafts of
/// windows from earlier runs: no window owns them now, and they must not go
/// along with the next document saved.
fn locked<R: Runtime, T>(
    app: &AppHandle<R>,
    action: impl FnOnce(&Path, &mut Drafts) -> Result<T, String>,
) -> Result<T, String> {
    let lock = app.state::<HistoryLock>();
    let mut drafts = lock
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let base = base(app)?;
    if !drafts.swept {
        drafts.swept = true;
        let _ = remove_folder(&base.join(UNSAVED));
    }
    action(&base, &mut drafts)
}

/// A saved document by its path, or else the window's drafts.
fn owner<'a>(document: Option<&'a str>, draft: &'a str) -> Owner<'a> {
    match document {
        Some(path) => Owner::Document(path),
        None => Owner::Draft(draft),
    }
}

/// Runs `action` for the document, or for the window's drafts when there is
/// none, off the async threads.
async fn with_owner<T: Send + 'static>(
    app: AppHandle,
    window: Window,
    document: Option<String>,
    action: impl FnOnce(&Path, Owner) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let label = window.label().to_string();
    blocking(move || {
        locked(&app, |base, drafts| match document.as_deref() {
            Some(path) => action(base, Owner::Document(path)),
            None => action(base, Owner::Draft(&drafts.of(&label))),
        })
    })
    .await
}

/// Drops a closed window's drafts; nothing can reach them any more.
pub fn forget_window<R: Runtime>(app: &AppHandle<R>, window: &str) {
    let app = app.clone();
    let window = window.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = locked(&app, |base, drafts| match drafts.windows.remove(&window) {
            Some(draft) => remove_folder(&folder(base, Owner::Draft(&draft))?),
            None => Ok(()),
        });
    });
}

/// A document's conversations, newest first; with no document, the
/// window's drafts.
#[tauri::command]
pub async fn history_list(
    app: AppHandle,
    window: Window,
    document: Option<String>,
) -> Result<Vec<ConversationSummary>, String> {
    with_owner(app, window, document, list).await
}

#[tauri::command]
pub async fn history_read(
    app: AppHandle,
    window: Window,
    document: Option<String>,
    id: String,
) -> Result<Value, String> {
    with_owner(app, window, document, move |base, owner| {
        read(base, owner, &id)
    })
    .await
}

#[tauri::command]
pub async fn history_write(
    app: AppHandle,
    window: Window,
    document: Option<String>,
    id: String,
    conversation: Value,
) -> Result<(), String> {
    with_owner(app, window, document, move |base, owner| {
        write(base, owner, &id, &conversation)
    })
    .await
}

#[tauri::command]
pub async fn history_delete(
    app: AppHandle,
    window: Window,
    document: Option<String>,
    id: String,
) -> Result<(), String> {
    with_owner(app, window, document, move |base, owner| {
        delete(base, owner, &id)
    })
    .await
}

/// Conversations follow the window's document to a new path; with no
/// `from`, the window's drafts go.
#[tauri::command]
pub async fn history_move(
    app: AppHandle,
    window: Window,
    from: Option<String>,
    to: Option<String>,
) -> Result<(), String> {
    let label = window.label().to_string();
    blocking(move || {
        locked(&app, |base, drafts| {
            let draft = drafts.of(&label);
            move_conversations(
                base,
                owner(from.as_deref(), &draft),
                owner(to.as_deref(), &draft),
            )
        })
    })
    .await
}

#[tauri::command]
pub async fn history_clear(app: AppHandle) -> Result<(), String> {
    blocking(move || locked(&app, |base, _| clear(base))).await
}

/// Keep an image the page has as base64, and return the id to read it by.
#[tauri::command]
pub async fn history_save_image(
    app: AppHandle,
    window: Window,
    document: Option<String>,
    id: String,
    bytes: String,
    mime: String,
) -> Result<String, String> {
    let bytes = blocking(move || {
        base64::engine::general_purpose::STANDARD
            .decode(bytes.trim())
            .map_err(|error| format!("bad-image: {error}"))
    })
    .await?;
    with_owner(app, window, document, move |base, owner| {
        save_image(base, owner, &id, &bytes, &mime)
    })
    .await
}

#[tauri::command]
pub async fn history_read_image(
    app: AppHandle,
    window: Window,
    document: Option<String>,
    id: String,
    image: String,
) -> Result<tauri::ipc::Response, String> {
    with_owner(app, window, document, move |base, owner| {
        read_image(base, owner, &id, &image)
    })
    .await
    .map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
    const A: Owner<'static> = Owner::Document("/notes/a.md");
    const B: Owner<'static> = Owner::Document("/notes/b.md");
    const DRAFT: Owner<'static> = Owner::Draft("run-1");

    fn conversation(title: &str, updated_at: u64, messages: usize) -> Value {
        json!({
            "title": title,
            "updatedAt": updated_at,
            "messages": vec![json!({"role": "user", "content": "hi"}); messages],
        })
    }

    fn titles(base: &Path, owner: Owner) -> Vec<String> {
        list(base, owner)
            .unwrap()
            .into_iter()
            .map(|summary| summary.title)
            .collect()
    }

    #[test]
    fn ids_stay_plain_names() {
        for id in ["a", "conv_1-2", &"x".repeat(64)] {
            assert_eq!(check_id(id), Ok(()), "{id}");
        }
        for id in ["", "../x", "a/b", "a.json", "名", " a", &"x".repeat(65)] {
            assert_eq!(check_id(id), Err("bad-id".into()), "{id}");
        }
        let base = Path::new("/base");
        assert_eq!(folder(base, Owner::Draft("../x")), Err("bad-id".into()));
    }

    #[test]
    fn each_document_and_window_gets_its_own_folder() {
        let a = folder_name("/notes/a.md");
        assert_eq!(a.len(), 32);
        assert!(a.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(a, folder_name("/notes/b.md"));
        let base = Path::new("/base");
        assert_eq!(folder(base, A), Ok(base.join(a)));
        assert_eq!(folder(base, DRAFT), Ok(base.join(UNSAVED).join("run-1")));
    }

    #[test]
    fn each_window_has_drafts_of_its_own() {
        let mut drafts = Drafts::default();
        let first = drafts.of("editor-1");
        let second = drafts.of("editor-2");
        assert_ne!(first, second);
        assert_eq!(drafts.of("editor-1"), first);
        assert_eq!(check_id(&first), Ok(()));
        assert_eq!(check_id(&second), Ok(()));
    }

    #[test]
    fn conversations_are_listed_newest_first() {
        let base = tempfile::tempdir().unwrap();
        let base = base.path();
        assert!(list(base, A).unwrap().is_empty());
        write(base, A, "old", &conversation("Old", 1, 2)).unwrap();
        write(base, A, "new", &conversation("New", 5, 3)).unwrap();
        write(base, B, "other", &conversation("Other", 9, 1)).unwrap();
        fs::write(folder(base, A).unwrap().join("junk.json"), "{").unwrap();
        let summaries = list(base, A).unwrap();
        assert_eq!(
            summaries,
            vec![
                ConversationSummary {
                    id: "new".into(),
                    title: "New".into(),
                    updated_at: 5,
                    message_count: 3,
                },
                ConversationSummary {
                    id: "old".into(),
                    title: "Old".into(),
                    updated_at: 1,
                    message_count: 2,
                },
            ]
        );
        assert_eq!(
            fs::read_to_string(folder(base, A).unwrap().join(DOCUMENT_NOTE)).unwrap(),
            "/notes/a.md"
        );
        assert_eq!(read(base, A, "new").unwrap(), conversation("New", 5, 3));
        assert_eq!(read(base, A, "gone"), Err("not-found".into()));
        assert_eq!(read(base, A, "../x"), Err("bad-id".into()));
    }

    #[test]
    fn a_deleted_conversation_takes_its_images_along() {
        let base = tempfile::tempdir().unwrap();
        let base = base.path();
        write(base, DRAFT, "c", &conversation("C", 1, 1)).unwrap();
        let image = save_image(base, DRAFT, "c", PNG, "image/png").unwrap();
        assert_eq!(read_image(base, DRAFT, "c", &image).unwrap(), PNG);
        delete(base, DRAFT, "c").unwrap();
        assert_eq!(read(base, DRAFT, "c"), Err("not-found".into()));
        assert_eq!(
            read_image(base, DRAFT, "c", &image),
            Err("not-found".into())
        );
        assert_eq!(delete(base, DRAFT, "c"), Ok(()));
    }

    #[test]
    fn an_image_is_kept_once_and_must_be_an_image() {
        let base = tempfile::tempdir().unwrap();
        let base = base.path();
        let first = save_image(base, DRAFT, "c", PNG, "image/png").unwrap();
        let again = save_image(base, DRAFT, "c", PNG, "image/jpeg").unwrap();
        assert_eq!(first, again);
        assert_eq!(
            fs::read_dir(files_folder(base, DRAFT, "c").unwrap())
                .unwrap()
                .count(),
            1
        );
        assert_eq!(
            save_image(base, DRAFT, "c", b"<svg/>", "image/svg+xml"),
            Err("not-an-image".into())
        );
        assert_eq!(
            save_image(base, DRAFT, "c", PNG, "text/plain"),
            Err("not-an-image".into())
        );
        assert_eq!(
            read_image(base, DRAFT, "c", "../../x"),
            Err("bad-id".into())
        );
    }

    #[test]
    fn conversations_follow_a_renamed_document_and_merge() {
        let base = tempfile::tempdir().unwrap();
        let base = base.path();
        write(base, DRAFT, "draft", &conversation("Draft", 1, 1)).unwrap();
        save_image(base, DRAFT, "draft", PNG, "image/png").unwrap();
        move_conversations(base, DRAFT, A).unwrap();
        assert!(!folder(base, DRAFT).unwrap().exists());
        assert_eq!(list(base, A).unwrap().len(), 1);

        write(base, B, "kept", &conversation("Kept", 2, 1)).unwrap();
        write(base, B, "draft", &conversation("Older", 0, 1)).unwrap();
        move_conversations(base, A, B).unwrap();
        assert_eq!(titles(base, B), ["Kept", "Draft"]);
        assert_eq!(
            fs::read_to_string(folder(base, B).unwrap().join(DOCUMENT_NOTE)).unwrap(),
            "/notes/b.md"
        );
        assert!(files_folder(base, B, "draft").unwrap().is_dir());
        assert_eq!(
            move_conversations(base, Owner::Document("/nowhere.md"), A),
            Ok(())
        );
        assert_eq!(move_conversations(base, B, B), Ok(()));
        assert_eq!(list(base, B).unwrap().len(), 2);
    }

    #[test]
    fn a_first_save_takes_only_its_own_windows_drafts() {
        let base = tempfile::tempdir().unwrap();
        let base = base.path();
        let other = Owner::Draft("run-2");
        write(base, DRAFT, "mine", &conversation("Mine", 1, 1)).unwrap();
        write(base, other, "theirs", &conversation("Theirs", 1, 1)).unwrap();
        // Left directly under `unsaved` by an older version.
        fs::write(base.join(UNSAVED).join("stale.json"), "{}").unwrap();
        move_conversations(base, DRAFT, A).unwrap();
        assert_eq!(titles(base, A), ["Mine"]);
        assert_eq!(titles(base, other), ["Theirs"]);
        assert!(base.join(UNSAVED).join("stale.json").is_file());
        assert!(list(base, DRAFT).unwrap().is_empty());
    }

    #[test]
    fn clearing_removes_every_conversation() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("conversations");
        write(&root, A, "x", &conversation("X", 1, 1)).unwrap();
        clear(&root).unwrap();
        assert!(!root.exists());
        assert_eq!(clear(&root), Ok(()));
    }
}
