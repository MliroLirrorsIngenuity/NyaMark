pub mod ai;
pub mod document;
#[cfg(target_os = "macos")]
pub mod menu;
pub mod quit;
pub mod sessions;
pub mod windows;

use std::{
    collections::HashMap,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicUsize},
        Mutex,
    },
};

use tauri::{AppHandle, Manager, Window};
use tauri_plugin_fs::FsExt;

use crate::{
    document::{DocumentError, DocumentFormat, MarkdownDocument},
    sessions::{
        LastFocusedWindow, MainWindowBootstrapComplete, PendingLaunchFiles, QuitPending,
        RestartPending, WindowCounter, WindowDirtyFlags, WindowSessions,
    },
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
        windows::spawn_editor_window(&app, path.clone());
    }

    sessions::mark_main_bootstrap_complete(&app);

    Ok(Some(first.clone()))
}

// Async so the window builds off the IPC thread (see `windows::build_window`)
// and a failure reaches the caller.
#[tauri::command]
async fn open_markdown_in_new_window(app: AppHandle, path: String) -> Result<(), String> {
    windows::open_editor_window(&app, path).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
async fn open_new_window(app: AppHandle) -> Result<(), String> {
    windows::open_blank_editor_window(&app).map_err(|error| format!("{error:#}"))
}

/// Bind a document the webview opened or saved on its own (dialog, save-as) to
/// this window, so the session map and the runtime fs scope follow the file.
/// Returns the canonical path the frontend should keep using.
#[tauri::command]
fn register_window_document(
    window: Window,
    app: AppHandle,
    path: String,
) -> Result<String, String> {
    let normalized = sessions::normalize_file_path(&path)
        .ok_or_else(|| format!("Not a readable file: {path}"))?;
    sessions::remember_window_file(&app, window.label(), normalized.clone());
    Ok(normalized)
}

/// Read the document body. Runs off the main thread so a slow volume never
/// freezes the UI. See `document.rs` for the encoding rules.
#[tauri::command(async)]
fn read_markdown_document(app: AppHandle, path: String) -> Result<MarkdownDocument, DocumentError> {
    document::read(&app, Path::new(&path))
}

/// Write the document body atomically, restoring the BOM and line endings
/// recorded when it was read, and return the version written. Given the
/// version the document was based on, a file changed since is left alone.
#[tauri::command(async)]
fn write_markdown_document(
    app: AppHandle,
    path: String,
    text: String,
    format: DocumentFormat,
    expected_version: Option<String>,
) -> Result<String, DocumentError> {
    document::write(
        &app,
        Path::new(&path),
        &text,
        format,
        expected_version.as_deref(),
    )
}

/// Open a local file or folder a document links to with its default app.
///
/// The opener plugin's own `open_path` has a static scope; this command uses
/// the runtime fs scope instead, so attachments next to a document on an
/// external volume open while everything outside the granted directories
/// stays closed to the webview.
#[tauri::command(async)]
fn open_document_resource(app: AppHandle, path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !app.fs_scope().is_allowed(target) {
        return Err(format!("Not allowed to open {path}"));
    }
    if !target.exists() {
        return Err(format!("No such file or directory: {path}"));
    }
    tauri_plugin_opener::open_path(target, None::<&str>).map_err(|error| error.to_string())
}

/// Create the directory attachments are copied into and allow it in the fs
/// scope. Needed for custom attachment folders outside `$HOME` that were
/// picked in an earlier session (the dialog's grant does not persist).
#[tauri::command]
fn ensure_attachment_directory(app: AppHandle, path: String) -> Result<String, String> {
    sessions::ensure_attachment_directory(&app, &path)
}

/// The webview reports its unsaved-changes state so quit paths that never touch
/// a single window (Cmd+Q, dock Quit, logout, updater restart) can prompt.
#[tauri::command]
fn set_window_dirty(window: Window, app: AppHandle, dirty: bool) {
    sessions::set_window_dirty(&app, window.label(), dirty);
    if let Err(error) = windows::set_document_edited(&window, dirty) {
        eprintln!("Failed to mark the window edited: {error:#}");
    }
}

/// Restart after an update was installed. Dirty windows get their prompt first;
/// the restart itself happens once the last of them closed (see `quit.rs`).
#[tauri::command]
fn request_app_restart(app: AppHandle) -> Result<(), String> {
    if sessions::any_window_dirty(&app) {
        sessions::set_restart_pending(&app, true);
        quit::close_dirty_windows(&app);
        return Ok(());
    }
    app.restart()
}

/// Whether any window holds unsaved changes, asked before the Windows
/// installer starts: it ends the app with no prompt.
#[tauri::command]
fn any_window_dirty(app: AppHandle) -> bool {
    sessions::any_window_dirty(&app)
}

/// The user cancelled an unsaved-changes prompt, so a pending quit or restart
/// is off.
#[tauri::command]
fn cancel_pending_quit(app: AppHandle) {
    sessions::set_restart_pending(&app, false);
    sessions::set_quit_pending(&app, false);
}

#[tauri::command]
fn set_window_title(window: Window, title: String) -> Result<(), String> {
    windows::set_title(&window, &title).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_windows_backdrop(window: Window, enabled: bool) -> Result<(), String> {
    windows::set_native_backdrop(&window, enabled).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_window_blur(window: Window, enabled: bool) -> Result<(), String> {
    windows::set_background_blur(&window, enabled).map_err(|error| error.to_string())
}

#[tauri::command]
fn print_current_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    ai::http::install_crypto_provider();
    let builder = tauri::Builder::default()
        .manage(PendingLaunchFiles(Mutex::new(
            sessions::collect_launch_files(),
        )))
        .manage(WindowSessions(Mutex::new(HashMap::new())))
        .manage(LastFocusedWindow(Mutex::new(None)))
        .manage(WindowCounter(AtomicUsize::new(1)))
        .manage(MainWindowBootstrapComplete(AtomicBool::new(false)))
        .manage(WindowDirtyFlags(Mutex::new(HashMap::new())))
        .manage(RestartPending(AtomicBool::new(false)))
        .manage(QuitPending(AtomicBool::new(false)))
        .manage(ai::http::HttpClients::default())
        .manage(ai::http::InFlight::default())
        .manage(ai::secrets::SecretCache::default())
        .manage(ai::secrets::StagedSecrets::default())
        .manage(ai::web::LastSearchEngine::default())
        .manage(ai::workspace::WorkspaceGrants::default())
        .manage(ai::history::HistoryLock::default())
        .manage(ai::mcp::McpServers::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            // A relative path names a file in the folder the second launch
            // ran from; this process may well sit in another.
            let paths: Vec<String> = args
                .iter()
                .skip(1)
                .filter_map(|arg| sessions::normalize_file_path(Path::new(&cwd).join(arg)))
                .collect();

            if paths.is_empty() {
                if let Some(label) = sessions::last_focused_window(app) {
                    if let Some(window) = app.get_webview_window(&label) {
                        let _ = window.set_focus();
                    }
                } else if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
                return;
            }

            if sessions::is_main_bootstrap_complete(app) {
                for path in paths {
                    windows::spawn_editor_window(app, path);
                }
            } else {
                sessions::extend_pending_launch_files(app, paths);
            }
        }))
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Focused(true) => {
                sessions::remember_last_focused_window(window.app_handle(), window.label());
            }
            tauri::WindowEvent::Destroyed => {
                let app = window.app_handle();
                sessions::forget_window_file(app, window.label());
                sessions::forget_window_dirty(app, window.label());
                sessions::clear_last_focused_window(app, window.label());
                ai::secrets::forget_window(app, window.label());
                ai::workspace::forget_window(app, window.label());
                ai::history::forget_window(app, window.label());
                quit::continue_pending_quit(app);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            resolve_current_window_file,
            register_window_document,
            read_markdown_document,
            write_markdown_document,
            open_document_resource,
            ensure_attachment_directory,
            open_new_window,
            open_markdown_in_new_window,
            set_window_dirty,
            any_window_dirty,
            request_app_restart,
            cancel_pending_quit,
            set_window_title,
            set_windows_backdrop,
            set_window_blur,
            print_current_window,
            ai::http::ai_fetch,
            ai::http::ai_fetch_abort,
            ai::secrets::ai_secret_set,
            ai::secrets::ai_secret_status,
            ai::secrets::ai_secret_delete,
            ai::secrets::ai_secrets_commit,
            ai::secrets::ai_secrets_discard,
            ai::web::web_search,
            ai::web::web_fetch,
            ai::web::web_address_is_public,
            ai::workspace::workspace_roots,
            ai::workspace::workspace_pick_root,
            ai::workspace::workspace_list,
            ai::workspace::workspace_read,
            ai::workspace::workspace_search,
            ai::workspace::workspace_write,
            ai::images::read_image_for_ai,
            ai::history::history_list,
            ai::history::history_read,
            ai::history::history_write,
            ai::history::history_delete,
            ai::history::history_move,
            ai::history::history_clear,
            ai::history::history_save_image,
            ai::history::history_read_image,
            ai::mcp::mcp_sync,
            ai::mcp::mcp_status,
            ai::mcp::mcp_call_tool,
            ai::mcp::mcp_restart,
            #[cfg(target_os = "macos")]
            menu::update_macos_menu,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            windows::create_main_window(app.handle())?;
            ai::mcp::tell_windows(app.handle());
            #[cfg(target_os = "macos")]
            quit::install_macos_terminate_hook(app.handle());
            Ok(())
        });

    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(menu::build_macos_menu)
        .on_menu_event(menu::handle_macos_menu_event);

    // Nothing is open yet, so there is nothing to lose.
    #[allow(clippy::expect_used)]
    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|app, event| match event {
        tauri::RunEvent::ExitRequested { code, api, .. } => {
            quit::handle_exit_requested(app, code, &api);
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => handle_opened_urls(app, &urls),
        tauri::RunEvent::Exit => ai::mcp::shutdown(app),
        _ => {}
    });
}

#[cfg(target_os = "macos")]
fn handle_opened_urls(app: &AppHandle, urls: &[tauri::Url]) {
    let paths = normalize_opened_paths(urls);
    if paths.is_empty() {
        return;
    }

    if sessions::is_main_bootstrap_complete(app) {
        for path in paths {
            windows::spawn_editor_window(app, path);
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
