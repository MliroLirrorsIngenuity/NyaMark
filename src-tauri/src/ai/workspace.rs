//! The folders the assistant may read and write notes in.
//!
//! A window's workspace is the folder of its document plus any folder the
//! user picked for it. Every path the assistant names must first lie inside
//! one of them by name alone, before anything on disk is asked about it;
//! then it is resolved for real, symlinks included, and must still land
//! inside one of them on a note: a markdown or text file outside hidden
//! folders. Writes go through the same atomic, version-checked save the
//! editor uses, so a file changed since the assistant read it is left alone.

use std::{
    collections::{HashMap, HashSet},
    fs, io,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

use ignore::WalkBuilder;
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, Window};
use tauri_plugin_dialog::DialogExt;

use super::blocking;
use crate::{
    document::{self, DocumentError, DocumentFormat, MAX_DOCUMENT_BYTES},
    sessions,
};

const EXTENSIONS: [&str; 4] = ["md", "markdown", "mdx", "txt"];
const MAX_DEPTH: usize = 8;
/// Entries a listing or search looks at before it stops, so a workspace as
/// big as a home folder still answers quickly.
const MAX_VISITED: usize = 50_000;
const MAX_READ_BYTES: u64 = 5 * 1024 * 1024;
/// Search skips bigger files; they are seldom notes.
const MAX_SEARCH_BYTES: u64 = 2 * 1024 * 1024;
const EXCERPT_CHARS: usize = 300;

/// Folders the user picked, per window.
#[derive(Default)]
pub struct WorkspaceGrants(Mutex<HashMap<String, Vec<PathBuf>>>);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WorkspaceFile {
    pub path: String,
    /// From the root it was found under, with `/` between parts.
    pub relative: String,
    pub size: u64,
    /// Milliseconds since the epoch.
    pub modified: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct FileList {
    pub files: Vec<WorkspaceFile>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct FileText {
    pub path: String,
    pub text: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SearchMatch {
    pub path: String,
    pub relative: String,
    /// Counted from 1.
    pub line: u32,
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct SearchMatches {
    pub matches: Vec<SearchMatch>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct Written {
    pub path: String,
    pub version: String,
}

/// The error codes the page shows for a failed read or write.
pub(crate) fn error_code(error: DocumentError) -> String {
    match error {
        DocumentError::NotUtf8 { .. } => "not-utf8".into(),
        DocumentError::Forbidden => "outside-workspace".into(),
        DocumentError::ReadOnly => "read-only".into(),
        DocumentError::TooLarge { .. } => "too-large".into(),
        DocumentError::Missing { .. } => "not-found".into(),
        DocumentError::Changed => "changed".into(),
        DocumentError::Io { message } => format!("io: {message}"),
    }
}

/// A filesystem root would put every file within reach.
fn usable_root(folder: &Path) -> bool {
    folder.parent().is_some() && folder.is_dir()
}

/// The window's workspace: its document's folder first, then what the user
/// picked.
pub fn roots<R: Runtime>(app: &AppHandle<R>, window: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let document_folder = sessions::assigned_window_file(app, window)
        .and_then(|file| Path::new(&file).parent().map(Path::to_path_buf))
        .and_then(|folder| fs::canonicalize(folder).ok())
        .filter(|folder| usable_root(folder));
    roots.extend(document_folder);
    if let Ok(grants) = app.state::<WorkspaceGrants>().0.lock() {
        for folder in grants.get(window).into_iter().flatten() {
            if !roots.contains(folder) {
                roots.push(folder.clone());
            }
        }
    }
    roots
}

pub fn forget_window<R: Runtime>(app: &AppHandle<R>, window: &str) {
    if let Ok(mut grants) = app.state::<WorkspaceGrants>().0.lock() {
        grants.remove(window);
    }
}

fn has_note_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
}

fn is_hidden(component: Component) -> bool {
    matches!(component, Component::Normal(name) if name.to_string_lossy().starts_with('.'))
}

/// Paths that reach another machine as soon as anything looks at them: a
/// share (`\\server\share`, `//server/share`) or the verbatim and device
/// forms (`\\?\UNC\…`, `\\.\…`, `\??\…`). Windows connects over SMB or
/// WebDAV on the first metadata call and offers the user's NTLM hash to
/// whoever answers, so these are refused by how they are written.
pub(crate) fn is_remote_or_device(path: &str) -> bool {
    let bytes = path.trim().as_bytes();
    let separator = |byte: Option<&u8>| matches!(byte, Some(b'/' | b'\\'));
    if separator(bytes.first()) && separator(bytes.get(1)) {
        return true;
    }
    if separator(bytes.first()) && bytes.get(1..3) == Some(b"??") && separator(bytes.get(3)) {
        return true;
    }
    #[cfg(windows)]
    if let Some(Component::Prefix(prefix)) = Path::new(path.trim()).components().next() {
        use std::path::Prefix;
        return matches!(
            prefix.kind(),
            Prefix::UNC(..) | Prefix::VerbatimUNC(..) | Prefix::DeviceNS(..) | Prefix::Verbatim(..)
        );
    }
    false
}

/// The path with `.` and `..` worked out by name, nothing on disk asked.
/// None when `..` climbs above the top.
pub(crate) fn normalize_lexically(path: &Path) -> Option<PathBuf> {
    let mut normal = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !matches!(normal.components().next_back(), Some(Component::Normal(_))) {
                    return None;
                }
                normal.pop();
            }
            other => normal.push(other.as_os_str()),
        }
    }
    Some(normal)
}

/// Whether `path` is `root` or below it by name. On Windows the case and the
/// `\\?\` a resolved root carries are ignored, since the assistant names
/// paths as they were shown to it.
#[cfg(windows)]
pub(crate) fn within_lexically(root: &Path, path: &Path) -> bool {
    let key = |path: &Path| {
        let text = path.to_string_lossy().replace('/', "\\");
        let text = match text.strip_prefix(r"\\?\UNC\") {
            Some(share) => format!(r"\\{share}"),
            None => text.strip_prefix(r"\\?\").unwrap_or(&text).to_string(),
        };
        text.trim_end_matches('\\').to_lowercase()
    };
    let (root, path) = (key(root), key(path));
    path == root
        || path
            .strip_prefix(&root)
            .is_some_and(|rest| rest.starts_with('\\'))
}

#[cfg(not(windows))]
pub(crate) fn within_lexically(root: &Path, path: &Path) -> bool {
    path.starts_with(root)
}

/// Where a path the assistant named lies by name alone: a relative one from
/// the first root. Refused unless that is inside a root, so nothing outside
/// the workspace is ever looked up.
fn lexical_candidate(roots: &[PathBuf], path: &str) -> Result<PathBuf, String> {
    let first = roots.first().ok_or_else(|| "no-workspace".to_string())?;
    let path = path.trim();
    if path.is_empty() {
        return Err("not-found".into());
    }
    if is_remote_or_device(path) {
        return Err("outside-workspace".into());
    }
    let path = Path::new(path);
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        first.join(path)
    };
    normalize_lexically(&joined)
        .filter(|candidate| roots.iter().any(|root| within_lexically(root, candidate)))
        .ok_or_else(|| "outside-workspace".to_string())
}

/// Where a path the assistant named really is, if that is a note inside the
/// workspace. A relative path starts at the first root. To create a file,
/// the folders it goes in are resolved instead, and those that do not exist
/// yet may only be named plainly.
pub fn resolve(roots: &[PathBuf], path: &str, create: bool) -> Result<PathBuf, String> {
    let candidate = lexical_candidate(roots, path)?;
    let resolved = match fs::canonicalize(&candidate) {
        Ok(resolved) => resolved,
        Err(error) if error.kind() == io::ErrorKind::NotFound && create => resolve_new(&candidate)?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Err("not-found".into()),
        Err(error) => return Err(format!("io: {error}")),
    };
    let root = roots
        .iter()
        .find(|root| resolved.starts_with(root))
        .ok_or_else(|| "outside-workspace".to_string())?;
    let inside = resolved
        .strip_prefix(root)
        .map_err(|_| "outside-workspace".to_string())?;
    // Hidden folders hold keys and settings (.ssh, .env, .git), not notes.
    if inside.components().any(is_hidden) {
        return Err("outside-workspace".into());
    }
    if !has_note_extension(&resolved) || resolved.is_dir() {
        return Err("not-markdown".into());
    }
    Ok(resolved)
}

fn resolve_new(candidate: &Path) -> Result<PathBuf, String> {
    let mut existing = candidate;
    let mut missing = Vec::new();
    loop {
        match fs::canonicalize(existing) {
            Ok(mut resolved) => {
                resolved.extend(missing.iter().rev());
                return Ok(resolved);
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                match existing.components().next_back() {
                    Some(Component::Normal(name)) => missing.push(name.to_os_string()),
                    _ => return Err("outside-workspace".into()),
                }
                existing = existing
                    .parent()
                    .ok_or_else(|| "outside-workspace".to_string())?;
            }
            Err(error) => return Err(format!("io: {error}")),
        }
    }
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Without the `\\?\` prefix Windows puts on a resolved path, so the page
/// shows the path the user knows.
fn display(path: &Path) -> String {
    sessions::strip_verbatim_prefix(path.to_path_buf())
}

/// Calls `visit` with each note in the workspace once, the roots in order
/// and names sorted, until it returns false. Skips what git ignores, hidden
/// files and folders, `node_modules` and symlinks. True when the cap on
/// entries looked at cut the walk short.
fn each_note(roots: &[PathBuf], mut visit: impl FnMut(&Path, String) -> bool) -> bool {
    let mut seen = HashSet::new();
    let mut visited = 0;
    for root in roots {
        let mut builder = WalkBuilder::new(root);
        builder
            .hidden(true)
            .ignore(true)
            .git_ignore(true)
            .git_exclude(true)
            .git_global(false)
            .require_git(false)
            .parents(true)
            .follow_links(false)
            .max_depth(Some(MAX_DEPTH))
            .sort_by_file_name(|a, b| a.cmp(b))
            .filter_entry(|entry| entry.file_name() != "node_modules");
        for entry in builder.build() {
            visited += 1;
            if visited > MAX_VISITED {
                return true;
            }
            let Ok(entry) = entry else {
                continue;
            };
            let path = entry.path();
            if !entry.file_type().is_some_and(|kind| kind.is_file())
                || !has_note_extension(path)
                || !seen.insert(path.to_path_buf())
            {
                continue;
            }
            if !visit(path, relative_path(root, path)) {
                return false;
            }
        }
    }
    false
}

fn modified_ms(metadata: &fs::Metadata) -> Option<u64> {
    let age = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    u64::try_from(age.as_millis()).ok()
}

pub fn list(roots: &[PathBuf], glob: Option<&str>, limit: Option<u32>) -> Result<FileList, String> {
    if roots.is_empty() {
        return Err("no-workspace".into());
    }
    let limit = limit.unwrap_or(500).clamp(1, 2000) as usize;
    let matcher = match glob.map(str::trim).filter(|glob| !glob.is_empty()) {
        Some(glob) => Some(
            globset::GlobBuilder::new(glob.trim_start_matches("./"))
                .case_insensitive(true)
                .build()
                .map_err(|error| format!("bad-glob: {error}"))?
                .compile_matcher(),
        ),
        None => None,
    };
    let mut files = Vec::new();
    let mut truncated = false;
    let capped = each_note(roots, |path, relative| {
        if matcher
            .as_ref()
            .is_some_and(|matcher| !matcher.is_match(&relative))
        {
            return true;
        }
        if files.len() == limit {
            truncated = true;
            return false;
        }
        let metadata = fs::metadata(path).ok();
        files.push(WorkspaceFile {
            path: display(path),
            relative,
            size: metadata.as_ref().map_or(0, fs::Metadata::len),
            modified: metadata.as_ref().and_then(modified_ms),
        });
        true
    });
    Ok(FileList {
        files,
        truncated: truncated || capped,
    })
}

pub fn read(roots: &[PathBuf], path: &str) -> Result<FileText, String> {
    let file = resolve(roots, path, false)?;
    let bytes = document::read_limited(&file, MAX_READ_BYTES).map_err(error_code)?;
    let note = document::decode(bytes).map_err(error_code)?;
    Ok(FileText {
        path: display(&file),
        text: note.text,
        version: note.version,
    })
}

pub fn search(
    roots: &[PathBuf],
    query: &str,
    regex: bool,
    case_sensitive: bool,
    limit: Option<u32>,
) -> Result<SearchMatches, String> {
    if roots.is_empty() {
        return Err("no-workspace".into());
    }
    if query.is_empty() {
        return Err("empty-query".into());
    }
    let pattern = if regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let matcher = regex::RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .size_limit(1 << 20)
        .build()
        .map_err(|error| format!("bad-regex: {error}"))?;
    let limit = limit.unwrap_or(100).clamp(1, 500) as usize;
    let mut matches = Vec::new();
    let mut truncated = false;
    let capped = each_note(roots, |path, relative| {
        if fs::metadata(path).map_or(true, |metadata| metadata.len() > MAX_SEARCH_BYTES) {
            return true;
        }
        let Ok(bytes) = fs::read(path) else {
            return true;
        };
        let text = String::from_utf8_lossy(&bytes);
        let text = text.strip_prefix('\u{FEFF}').unwrap_or(&text);
        for (index, line) in text.lines().enumerate() {
            let Some(found) = matcher.find(line) else {
                continue;
            };
            if matches.len() == limit {
                truncated = true;
                return false;
            }
            matches.push(SearchMatch {
                path: display(path),
                relative: relative.clone(),
                line: u32::try_from(index + 1).unwrap_or(u32::MAX),
                text: excerpt(line, found.start()),
            });
        }
        true
    });
    Ok(SearchMatches {
        matches,
        truncated: truncated || capped,
    })
}

/// The line, or for a long one the part around the match, marked with `…`
/// where it was cut; at most `EXCERPT_CHARS` characters either way.
fn excerpt(line: &str, at: usize) -> String {
    let total = line.chars().count();
    if total <= EXCERPT_CHARS {
        return line.to_string();
    }
    let before = line.get(..at).map_or(0, |head| head.chars().count());
    let start = before.saturating_sub(100).min(total - (EXCERPT_CHARS - 2));
    let mut text = String::new();
    if start > 0 {
        text.push('…');
    }
    text.extend(line.chars().skip(start).take(EXCERPT_CHARS - 2));
    if start + (EXCERPT_CHARS - 2) < total {
        text.push('…');
    }
    text
}

/// Writes a note. An existing one keeps its byte order mark and line
/// endings, and is written only against the version it was read at, so
/// the assistant cannot replace a note it never read or one changed since.
/// With `create` the note must not exist yet, and missing folders on its way
/// are made.
pub fn write(
    roots: &[PathBuf],
    path: &str,
    text: &str,
    expected_version: Option<&str>,
    create: bool,
) -> Result<Written, String> {
    let file = resolve(roots, path, create)?;
    let exists = fs::symlink_metadata(&file).is_ok();
    if create && exists {
        return Err("exists".into());
    }
    if !create && !exists {
        return Err("not-found".into());
    }
    if exists && expected_version.is_none() {
        return Err("version-needed".into());
    }
    let format = if exists {
        let bytes = document::read_limited(&file, MAX_DOCUMENT_BYTES).map_err(error_code)?;
        document::decode(bytes).map_err(error_code)?.format
    } else {
        DocumentFormat::default()
    };
    if create {
        if let Some(folder) = file.parent() {
            fs::create_dir_all(folder).map_err(|error| format!("io: {error}"))?;
        }
    }
    let expected_version = if create { None } else { expected_version };
    let version =
        document::write_document(&file, text, format, expected_version).map_err(error_code)?;
    Ok(Written {
        path: display(&file),
        version,
    })
}

/// Runs `work` on the window's workspace, off the async threads.
async fn in_workspace<T: Send + 'static>(
    app: AppHandle,
    window: Window,
    work: impl FnOnce(&[PathBuf]) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let label = window.label().to_string();
    blocking(move || work(&roots(&app, &label))).await
}

#[tauri::command]
pub async fn workspace_roots(app: AppHandle, window: Window) -> Result<Vec<String>, String> {
    in_workspace(app, window, |roots| {
        Ok(roots.iter().map(|root| display(root)).collect())
    })
    .await
}

/// Let the user pick another folder for this window's workspace. Only the
/// commands here reach it, and only for this window: the page's own file
/// access stays as it was.
#[tauri::command]
pub async fn workspace_pick_root(app: AppHandle, window: Window) -> Result<Option<String>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_parent(&window)
        .pick_folder(move |folder| {
            let _ = sender.send(folder);
        });
    let Some(folder) = receiver.await.map_err(|error| error.to_string())? else {
        return Ok(None);
    };
    let folder = folder.into_path().map_err(|error| error.to_string())?;
    let folder = blocking(move || {
        let folder = fs::canonicalize(folder).map_err(|error| format!("io: {error}"))?;
        if usable_root(&folder) {
            Ok(folder)
        } else {
            Err("outside-workspace".into())
        }
    })
    .await?;
    let state = app.state::<WorkspaceGrants>();
    let mut grants = state.0.lock().map_err(|error| error.to_string())?;
    let granted = grants.entry(window.label().to_string()).or_default();
    if !granted.contains(&folder) {
        granted.push(folder.clone());
    }
    Ok(Some(display(&folder)))
}

#[tauri::command]
pub async fn workspace_list(
    app: AppHandle,
    window: Window,
    glob: Option<String>,
    limit: Option<u32>,
) -> Result<FileList, String> {
    in_workspace(app, window, move |roots| {
        list(roots, glob.as_deref(), limit)
    })
    .await
}

#[tauri::command]
pub async fn workspace_read(
    app: AppHandle,
    window: Window,
    path: String,
) -> Result<FileText, String> {
    in_workspace(app, window, move |roots| read(roots, &path)).await
}

#[tauri::command]
pub async fn workspace_search(
    app: AppHandle,
    window: Window,
    query: String,
    regex: Option<bool>,
    case_sensitive: Option<bool>,
    limit: Option<u32>,
) -> Result<SearchMatches, String> {
    in_workspace(app, window, move |roots| {
        search(
            roots,
            &query,
            regex.unwrap_or(false),
            case_sensitive.unwrap_or(false),
            limit,
        )
    })
    .await
}

/// Write a note. An existing one needs the version it was read at.
#[tauri::command]
pub async fn workspace_write(
    app: AppHandle,
    window: Window,
    path: String,
    text: String,
    expected_version: Option<String>,
    create: Option<bool>,
) -> Result<Written, String> {
    in_workspace(app, window, move |roots| {
        write(
            roots,
            &path,
            &text,
            expected_version.as_deref(),
            create.unwrap_or(false),
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Workspace {
        _folder: tempfile::TempDir,
        root: PathBuf,
    }

    fn workspace(files: &[(&str, &str)]) -> Workspace {
        let folder = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(folder.path()).unwrap().join("notes");
        fs::create_dir_all(&root).unwrap();
        for (path, text) in files {
            let file = root.join(path);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, text).unwrap();
        }
        Workspace {
            _folder: folder,
            root,
        }
    }

    fn relatives(list: &FileList) -> Vec<&str> {
        list.files
            .iter()
            .map(|file| file.relative.as_str())
            .collect()
    }

    #[test]
    fn nothing_is_reachable_without_a_workspace() {
        assert_eq!(resolve(&[], "a.md", false), Err("no-workspace".into()));
        assert_eq!(list(&[], None, None).unwrap_err(), "no-workspace");
        assert_eq!(
            search(&[], "a", false, false, None).unwrap_err(),
            "no-workspace"
        );
    }

    #[test]
    fn paths_resolve_inside_the_workspace_only() {
        let space = workspace(&[
            ("a.md", "a"),
            ("sub/b.markdown", "b"),
            ("c.png", "c"),
            (".secret/d.md", "d"),
            ("../outside.md", "o"),
        ]);
        let roots = [space.root.clone()];
        assert_eq!(resolve(&roots, "a.md", false), Ok(space.root.join("a.md")));
        assert_eq!(
            resolve(&roots, &display(&space.root.join("sub/b.markdown")), false),
            Ok(space.root.join("sub/b.markdown"))
        );
        assert_eq!(
            resolve(&roots, "sub/../a.md", false),
            Ok(space.root.join("a.md"))
        );
        assert_eq!(
            resolve(&roots, "../outside.md", false),
            Err("outside-workspace".into())
        );
        assert_eq!(
            resolve(&roots, ".secret/d.md", false),
            Err("outside-workspace".into())
        );
        assert_eq!(resolve(&roots, "c.png", false), Err("not-markdown".into()));
        assert_eq!(
            resolve(&roots, "missing.md", false),
            Err("not-found".into())
        );
        assert_eq!(
            resolve(&roots, "new/deeper/e.md", true),
            Ok(space.root.join("new/deeper/e.md"))
        );
        assert_eq!(
            resolve(&roots, "../new.md", true),
            Err("outside-workspace".into())
        );
        assert_eq!(
            resolve(&roots, "new/../../x.md", true),
            Err("outside-workspace".into())
        );
    }

    #[test]
    fn shares_and_device_paths_are_refused_by_how_they_are_written() {
        for path in [
            r"\\evil\s\a.md",
            r"\\evil@80\x\a.png",
            r"\\?\UNC\evil\s\a.md",
            r"\\.\pipe\x",
            r"\??\UNC\evil\s\a.md",
            "/??/UNC/evil/s/a.md",
            "//evil/s/a.md",
            r"\/evil/s/a.md",
            r"/\evil\s\a.md",
            "  \\\\evil\\s\\a.md",
        ] {
            assert!(is_remote_or_device(path), "{path}");
        }
        for path in [
            "a.md",
            "sub/b.md",
            "/Users/me/a.md",
            r"C:\Users\me\a.md",
            r"\a.md",
        ] {
            assert!(!is_remote_or_device(path), "{path}");
        }
        let space = workspace(&[("a.md", "a")]);
        let roots = [space.root.clone()];
        for path in [r"\\evil\s\a.md", "//evil/s/a.md", r"\\?\UNC\evil\s\a.md"] {
            assert_eq!(
                resolve(&roots, path, false),
                Err("outside-workspace".into()),
                "{path}"
            );
            assert_eq!(
                write(&roots, path, "x", None, true).unwrap_err(),
                "outside-workspace",
                "{path}"
            );
        }
    }

    #[test]
    fn dots_are_worked_out_by_name() {
        assert_eq!(
            normalize_lexically(Path::new("/a/./b/../c.md")),
            Some(PathBuf::from("/a/c.md"))
        );
        assert_eq!(normalize_lexically(Path::new("/a/../..")), None);
        assert_eq!(normalize_lexically(Path::new("../a")), None);
    }

    /// Paths outside every root are refused before anything on disk is
    /// asked; these roots do not even exist.
    #[cfg(unix)]
    #[test]
    fn a_path_must_lie_in_a_root_by_name_first() {
        let roots = [PathBuf::from("/work/notes"), PathBuf::from("/work/more")];
        for path in [
            "/elsewhere/a.md",
            "/work/notesx/a.md",
            "/work/notes/../other/a.md",
            "../a.md",
            "sub/../../a.md",
            "/work/notes/../../../../a.md",
        ] {
            assert_eq!(
                lexical_candidate(&roots, path),
                Err("outside-workspace".into()),
                "{path}"
            );
        }
        assert_eq!(
            lexical_candidate(&roots, "sub/./b.md"),
            Ok(PathBuf::from("/work/notes/sub/b.md"))
        );
        assert_eq!(
            lexical_candidate(&roots, "/work/more/x/../a.md"),
            Ok(PathBuf::from("/work/more/a.md"))
        );
        assert_eq!(lexical_candidate(&roots, "  "), Err("not-found".into()));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_workspace_leads_nowhere() {
        let space = workspace(&[("../outside.md", "o"), ("../away/x.md", "x")]);
        let roots = [space.root.clone()];
        std::os::unix::fs::symlink(space.root.join("../outside.md"), space.root.join("link.md"))
            .unwrap();
        std::os::unix::fs::symlink(space.root.join("../away"), space.root.join("away")).unwrap();
        assert_eq!(
            resolve(&roots, "link.md", false),
            Err("outside-workspace".into())
        );
        assert_eq!(
            resolve(&roots, "away/x.md", false),
            Err("outside-workspace".into())
        );
        assert_eq!(
            resolve(&roots, "away/new.md", true),
            Err("outside-workspace".into())
        );
        assert!(relatives(&list(&roots, None, None).unwrap()).is_empty());
    }

    #[test]
    fn a_listing_skips_what_is_ignored_and_hidden() {
        let space = workspace(&[
            ("b.md", "b"),
            ("a.txt", "a"),
            ("sub/c.MD", "c"),
            ("sub/skip.md", "s"),
            ("image.png", "i"),
            (".hidden/h.md", "h"),
            ("node_modules/pkg/readme.md", "n"),
            (".gitignore", "sub/skip.md\n"),
            ("1/2/3/4/5/6/7/8/9/deep.md", "too deep"),
        ]);
        let roots = [space.root.clone()];
        let all = list(&roots, None, None).unwrap();
        assert_eq!(relatives(&all), ["a.txt", "b.md", "sub/c.MD"]);
        assert!(!all.truncated);
        assert_eq!(all.files[1].size, 1);
        assert!(all.files[1].modified.is_some());
        assert_eq!(all.files[1].path, display(&space.root.join("b.md")));

        let markdown = list(&roots, Some("*.md"), None).unwrap();
        assert_eq!(relatives(&markdown), ["b.md", "sub/c.MD"]);
        let first = list(&roots, None, Some(1)).unwrap();
        assert_eq!(relatives(&first), ["a.txt"]);
        assert!(first.truncated);
        assert!(list(&roots, Some("[unclosed"), None)
            .unwrap_err()
            .starts_with("bad-glob: "));
    }

    #[test]
    fn a_file_under_two_roots_is_listed_once() {
        let space = workspace(&[("a.md", "a"), ("sub/b.md", "b")]);
        let roots = [space.root.join("sub"), space.root.clone()];
        let all = list(&roots, None, None).unwrap();
        assert_eq!(relatives(&all), ["b.md", "a.md"]);
    }

    #[test]
    fn search_finds_lines_by_text_or_pattern() {
        let space = workspace(&[
            ("a.md", "\u{FEFF}first Cat\nsecond line\r\nthird cat\n"),
            ("b.md", "no match here\n"),
        ]);
        let roots = [space.root.clone()];
        let found = search(&roots, "cat", false, false, None).unwrap();
        let lines: Vec<(u32, &str)> = found
            .matches
            .iter()
            .map(|m| (m.line, m.text.as_str()))
            .collect();
        assert_eq!(lines, [(1, "first Cat"), (3, "third cat")]);
        assert_eq!(found.matches[0].relative, "a.md");

        let exact = search(&roots, "cat", false, true, None).unwrap();
        assert_eq!(exact.matches.len(), 1);
        let pattern = search(&roots, r"^s\w+", true, false, None).unwrap();
        assert_eq!(pattern.matches[0].text, "second line");
        let literal = search(&roots, "c.t", false, false, None).unwrap();
        assert!(literal.matches.is_empty());
        let limited = search(&roots, "cat", false, false, Some(1)).unwrap();
        assert_eq!(limited.matches.len(), 1);
        assert!(limited.truncated);
        assert!(search(&roots, "(", true, false, None)
            .unwrap_err()
            .starts_with("bad-regex: "));
    }

    #[test]
    fn a_long_line_is_cut_around_its_match() {
        let line = format!("{}needle{}", "a".repeat(500), "b".repeat(500));
        let text = excerpt(&line, 500);
        assert_eq!(text.chars().count(), EXCERPT_CHARS);
        assert!(text.starts_with('…') && text.ends_with('…'));
        assert!(text.contains("needle"));
        let end = format!("{}needle", "a".repeat(1000));
        let text = excerpt(&end, 1000);
        assert!(text.ends_with("needle") && text.chars().count() <= EXCERPT_CHARS);
        assert_eq!(excerpt("short", 0), "short");
    }

    #[test]
    fn a_note_is_read_with_its_version_and_written_back_against_it() {
        let space = workspace(&[("a.md", "one\r\ntwo\r\n"), ("big.md", "")]);
        let roots = [space.root.clone()];
        let note = read(&roots, "a.md").unwrap();
        assert_eq!(note.text, "one\ntwo\n");
        let written = write(&roots, "a.md", "one\nthree\n", Some(&note.version), false).unwrap();
        assert_eq!(
            fs::read(space.root.join("a.md")).unwrap(),
            b"one\r\nthree\r\n"
        );
        assert_eq!(
            write(&roots, "a.md", "stale", Some(&note.version), false).unwrap_err(),
            "changed"
        );
        assert_eq!(read(&roots, "a.md").unwrap().version, written.version);
        fs::File::create(space.root.join("big.md"))
            .unwrap()
            .set_len(MAX_READ_BYTES + 1)
            .unwrap();
        assert_eq!(read(&roots, "big.md").unwrap_err(), "too-large");
    }

    #[test]
    fn an_existing_note_is_written_only_against_a_version() {
        let space = workspace(&[("a.md", "one\n")]);
        let roots = [space.root.clone()];
        assert_eq!(
            write(&roots, "a.md", "two\n", None, false).unwrap_err(),
            "version-needed"
        );
        assert_eq!(fs::read(space.root.join("a.md")).unwrap(), b"one\n");
        let note = read(&roots, "a.md").unwrap();
        write(&roots, "a.md", "two\n", Some(&note.version), false).unwrap();
        assert_eq!(fs::read(space.root.join("a.md")).unwrap(), b"two\n");
    }

    #[test]
    fn a_new_note_is_created_once() {
        let space = workspace(&[]);
        let roots = [space.root.clone()];
        let written = write(&roots, "plans/new.md", "hello\n", None, true).unwrap();
        assert_eq!(written.path, display(&space.root.join("plans/new.md")));
        assert_eq!(read(&roots, "plans/new.md").unwrap().text, "hello\n");
        assert_eq!(
            write(&roots, "plans/new.md", "again", None, true).unwrap_err(),
            "exists"
        );
        assert_eq!(
            write(&roots, "other.md", "x", None, false).unwrap_err(),
            "not-found"
        );
        assert_eq!(
            write(&roots, "notes.json", "{}", None, true).unwrap_err(),
            "not-markdown"
        );
    }
}
