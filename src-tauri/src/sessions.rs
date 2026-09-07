use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Mutex,
    },
};

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_fs::FsExt;

/// Files passed via CLI args / `RunEvent::Opened` before the main window finished bootstrap.
pub struct PendingLaunchFiles(pub Mutex<Vec<String>>);

/// Mapping window label -> resolved markdown file path.
pub struct WindowSessions(pub Mutex<HashMap<String, String>>);

/// Monotonic counter to mint child window labels (`editor-N`).
pub struct WindowCounter(pub AtomicUsize);

/// Latch flipped to true once the main window has resolved its initial file (or determined it's blank).
pub struct MainWindowBootstrapComplete(pub AtomicBool);

/// Last editor window that held focus, used to target app-menu actions.
pub struct LastFocusedWindow(pub Mutex<Option<String>>);

pub fn normalize_file_path(path: impl AsRef<Path>) -> Option<String> {
    let path = path.as_ref();
    if !path.is_file() {
        return None;
    }

    fs::canonicalize(path).ok().map(strip_verbatim_prefix)
}

pub fn collect_launch_files() -> Vec<String> {
    env::args_os()
        .skip(1)
        .filter_map(|arg| normalize_file_path(PathBuf::from(arg)))
        .collect()
}

pub fn next_window_label<R: Runtime>(app: &AppHandle<R>) -> String {
    let id = app
        .state::<WindowCounter>()
        .0
        .fetch_add(1, Ordering::Relaxed);
    format!("editor-{id}")
}

pub fn remember_window_file<R: Runtime>(app: &AppHandle<R>, label: &str, path: String) {
    allow_document_scope(app, &path);
    app.state::<WindowSessions>()
        .0
        .lock()
        .unwrap()
        .insert(label.to_string(), path);
}

/// Grant the webview filesystem access to a document and the directory around it.
///
/// The static `fs:scope` in the capability only covers `$HOME` and the app
/// directories. Files opened through file associations, CLI arguments or
/// `RunEvent::Opened` can live anywhere (external volumes, network shares,
/// `/tmp`), so every path that becomes a window's document is added to the
/// runtime scope here. The parent directory is allowed recursively because
/// attachment folders (`./assets`, `${filename}.assets`, a frontmatter
/// `typora-copy-images-to`) resolve relative to the document. A filesystem
/// root is never allowed wholesale.
pub fn allow_document_scope<R: Runtime>(app: &AppHandle<R>, path: &str) {
    let scope = app.fs_scope();
    let file = Path::new(path);
    if let Err(error) = scope.allow_file(file) {
        eprintln!("Failed to allow fs scope for {path}: {error}");
    }

    let Some(parent) = file.parent() else {
        return;
    };
    if parent.parent().is_none() {
        return;
    }
    if let Err(error) = scope.allow_directory(parent, true) {
        eprintln!(
            "Failed to allow fs scope for {}: {error}",
            parent.display()
        );
    }
}

/// Create an attachment directory and grant the webview access to it.
///
/// Both the path as given and its canonical form are allowed: the scope check
/// canonicalizes the target, while the frontend keeps building paths from the
/// document path it was handed, which may still contain a symlinked component
/// (`/tmp` vs `/private/tmp` on macOS).
pub fn ensure_attachment_directory<R: Runtime>(
    app: &AppHandle<R>,
    path: &str,
) -> Result<String, String> {
    let dir = Path::new(path);
    fs::create_dir_all(dir).map_err(|error| format!("Failed to create {path}: {error}"))?;
    let canonical =
        fs::canonicalize(dir).map_err(|error| format!("Failed to resolve {path}: {error}"))?;
    if !canonical.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let scope = app.fs_scope();
    scope
        .allow_directory(dir, true)
        .map_err(|error| error.to_string())?;
    scope
        .allow_directory(&canonical, true)
        .map_err(|error| error.to_string())?;

    Ok(strip_verbatim_prefix(canonical))
}

fn strip_verbatim_prefix(path: PathBuf) -> String {
    let s = path.to_string_lossy().into_owned();
    #[cfg(windows)]
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        return stripped.to_string();
    }
    s
}

pub fn forget_window_file<R: Runtime>(app: &AppHandle<R>, label: &str) {
    app.state::<WindowSessions>()
        .0
        .lock()
        .unwrap()
        .remove(label);
}

pub fn assigned_window_file<R: Runtime>(app: &AppHandle<R>, label: &str) -> Option<String> {
    app.state::<WindowSessions>()
        .0
        .lock()
        .unwrap()
        .get(label)
        .cloned()
}

pub fn take_pending_launch_files<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    let state = app.state::<PendingLaunchFiles>();
    let mut pending = state.0.lock().unwrap();
    std::mem::take(&mut *pending)
}

pub fn extend_pending_launch_files<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>) {
    app.state::<PendingLaunchFiles>()
        .0
        .lock()
        .unwrap()
        .extend(paths);
}

pub fn mark_main_bootstrap_complete<R: Runtime>(app: &AppHandle<R>) {
    app.state::<MainWindowBootstrapComplete>()
        .0
        .store(true, Ordering::Release);
}

pub fn remember_last_focused_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    app.state::<LastFocusedWindow>()
        .0
        .lock()
        .unwrap()
        .replace(label.to_string());
}

pub fn last_focused_window<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.state::<LastFocusedWindow>().0.lock().unwrap().clone()
}

pub fn clear_last_focused_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    let state = app.state::<LastFocusedWindow>();
    let mut current = state.0.lock().unwrap();
    if current.as_deref() == Some(label) {
        current.take();
    }
}

pub fn is_main_bootstrap_complete<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.state::<MainWindowBootstrapComplete>()
        .0
        .load(Ordering::Acquire)
}
