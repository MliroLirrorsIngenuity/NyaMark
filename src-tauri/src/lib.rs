pub mod commands;
pub mod file;
#[cfg(target_os = "macos")]
pub mod menu;
pub mod sessions;
pub mod settings;
pub mod windows;

use std::{
    collections::HashMap,
    fs,
    sync::{
        atomic::{AtomicBool, AtomicUsize},
        Mutex,
    },
};

use tauri::{AppHandle, Window};

use crate::sessions::{
    DraftSessions, MainWindowBootstrapComplete, PendingLaunchFiles, WindowCounter, WindowSessions,
};

#[tauri::command]
fn resolve_current_window_file(window: Window, app: AppHandle) -> Result<Option<String>, String> {
    let label = window.label().to_string();

    if let Some(path) = sessions::assigned_window_file(&app, &label) {
        if label == "main" {
            sessions::mark_main_bootstrap_complete(&app);
        }
        return Ok(Some(path));
    }

    if label != "main" {
        return Ok(None);
    }

    let pending_files = sessions::take_pending_launch_files(&app);
    let Some((first, rest)) = pending_files.split_first() else {
        sessions::mark_main_bootstrap_complete(&app);
        return Ok(None);
    };

    sessions::remember_window_file(&app, &label, first.clone());

    for path in rest {
        if let Err(error) = windows::open_editor_window(&app, path.clone()) {
            eprintln!("Failed to open startup window for {:?}: {error}", path);
        }
    }

    sessions::mark_main_bootstrap_complete(&app);

    Ok(Some(first.clone()))
}

#[tauri::command]
fn open_markdown_in_new_window(app: AppHandle, path: String) -> Result<(), String> {
    windows::open_editor_window(&app, path).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_new_window(app: AppHandle) -> Result<(), String> {
    windows::open_blank_editor_window(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn materialize_draft_attachment(
    window: Window,
    app: AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<file::StoredAttachment, String> {
    let draft_dir = sessions::ensure_draft_session_dir(&app, window.label())
        .map_err(|error| error.to_string())?;
    file::materialize_draft_attachment(&draft_dir, &file_name, &bytes)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_markdown(
    window: Window,
    app: AppHandle,
    path: String,
    content: String,
) -> Result<String, String> {
    let label = window.label().to_string();
    let draft_dir = sessions::current_draft_session_dir(&app, &label);
    let final_content = match draft_dir.as_ref() {
        Some(draft_dir) => file::persist_draft_attachments(&path, &content, draft_dir)
            .map_err(|error| error.to_string())?,
        None => content,
    };

    file::save_file_content(&path, &final_content).map_err(|error| error.to_string())?;

    if let Some(draft_dir) = draft_dir {
        let _ = fs::remove_dir_all(&draft_dir);
        let _ = sessions::take_draft_session_dir(&app, &label);
    }

    Ok(final_content)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(PendingLaunchFiles(Mutex::new(
            sessions::collect_launch_files(),
        )))
        .manage(WindowSessions(Mutex::new(HashMap::new())))
        .manage(DraftSessions(Mutex::new(HashMap::new())))
        .manage(WindowCounter(AtomicUsize::new(1)))
        .manage(MainWindowBootstrapComplete(AtomicBool::new(false)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_markdown,
            commands::load_settings,
            commands::save_settings,
            save_markdown,
            commands::materialize_attachment,
            commands::store_attachment_in_directory,
            commands::copy_local_attachment,
            commands::resolve_document_asset_path,
            commands::format_markdown_reference,
            resolve_current_window_file,
            open_new_window,
            open_markdown_in_new_window,
            materialize_draft_attachment
        ]);

    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(menu::build_macos_menu)
        .on_menu_event(menu::handle_macos_menu_event);

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            handle_run_event(_app, _event);
        });
}

#[cfg(target_os = "macos")]
fn handle_run_event(app: &AppHandle, event: tauri::RunEvent) {
    let tauri::RunEvent::Opened { urls } = event else {
        return;
    };

    let paths = normalize_opened_paths(&urls);
    if paths.is_empty() {
        return;
    }

    if sessions::is_main_bootstrap_complete(app) {
        for path in paths {
            if let Err(error) = windows::open_editor_window(app, path.clone()) {
                eprintln!("Failed to open runtime window for {:?}: {error}", path);
            }
        }
        return;
    }

    sessions::extend_pending_launch_files(app, paths);
}

#[cfg(target_os = "macos")]
fn normalize_opened_paths(urls: &[tauri::Url]) -> Vec<String> {
    urls.iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter_map(sessions::normalize_file_path)
        .collect()
}
