use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Mutex,
    },
};

use anyhow::{Context, Result};
use tauri::{AppHandle, Manager, Runtime};

/// Files passed via CLI args / `RunEvent::Opened` before the main window finished bootstrap.
pub struct PendingLaunchFiles(pub Mutex<Vec<String>>);

/// Mapping window label -> resolved markdown file path.
pub struct WindowSessions(pub Mutex<HashMap<String, String>>);

/// Mapping window label -> draft asset directory used for unsaved-doc paste images.
pub struct DraftSessions(pub Mutex<HashMap<String, String>>);

/// Monotonic counter to mint child window labels (`editor-N`).
pub struct WindowCounter(pub AtomicUsize);

/// Latch flipped to true once the main window has resolved its initial file (or determined it's blank).
pub struct MainWindowBootstrapComplete(pub AtomicBool);

pub fn normalize_file_path(path: impl AsRef<Path>) -> Option<String> {
    let path = path.as_ref();
    if !path.is_file() {
        return None;
    }

    fs::canonicalize(path)
        .ok()
        .map(|value| value.to_string_lossy().into_owned())
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
    app.state::<WindowSessions>()
        .0
        .lock()
        .unwrap()
        .insert(label.to_string(), path);
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

pub fn is_main_bootstrap_complete<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.state::<MainWindowBootstrapComplete>()
        .0
        .load(Ordering::Acquire)
}

pub fn ensure_draft_session_dir<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<PathBuf> {
    if let Some(path) = app
        .state::<DraftSessions>()
        .0
        .lock()
        .unwrap()
        .get(label)
        .cloned()
    {
        return Ok(PathBuf::from(path));
    }

    let dir = env::temp_dir()
        .join("nyamark-drafts")
        .join(std::process::id().to_string())
        .join(label);
    fs::create_dir_all(&dir)
        .with_context(|| format!("Failed to create draft session directory: {dir:?}"))?;

    app.state::<DraftSessions>()
        .0
        .lock()
        .unwrap()
        .insert(label.to_string(), dir.to_string_lossy().into_owned());

    Ok(dir)
}

pub fn take_draft_session_dir<R: Runtime>(app: &AppHandle<R>, label: &str) -> Option<PathBuf> {
    app.state::<DraftSessions>()
        .0
        .lock()
        .unwrap()
        .remove(label)
        .map(PathBuf::from)
}

pub fn current_draft_session_dir<R: Runtime>(app: &AppHandle<R>, label: &str) -> Option<PathBuf> {
    app.state::<DraftSessions>()
        .0
        .lock()
        .unwrap()
        .get(label)
        .cloned()
        .map(PathBuf::from)
}
