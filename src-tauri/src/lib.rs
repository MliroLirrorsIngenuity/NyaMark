#[cfg(target_os = "macos")]
pub mod menu;
pub mod sessions;
pub mod windows;

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicUsize},
        Mutex,
    },
};

use tauri::{AppHandle, Manager, Window};

use crate::sessions::{
    LastFocusedWindow, MainWindowBootstrapComplete, PendingLaunchFiles, WindowCounter,
    WindowSessions,
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
fn set_windows_backdrop(window: Window, enabled: bool) -> Result<(), String> {
    windows::set_native_backdrop(&window, enabled).map_err(|error| error.to_string())
}

#[tauri::command]
fn print_current_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(PendingLaunchFiles(Mutex::new(
            sessions::collect_launch_files(),
        )))
        .manage(WindowSessions(Mutex::new(HashMap::new())))
        .manage(LastFocusedWindow(Mutex::new(None)))
        .manage(WindowCounter(AtomicUsize::new(1)))
        .manage(MainWindowBootstrapComplete(AtomicBool::new(false)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let paths: Vec<String> = args
                .iter()
                .skip(1)
                .filter_map(|arg| sessions::normalize_file_path(arg))
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
                    if let Err(error) = windows::open_editor_window(app, path.clone()) {
                        eprintln!("Failed to open runtime window for {:?}: {error}", path);
                    }
                }
            } else {
                sessions::extend_pending_launch_files(app, paths);
            }
        }))
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Focused(true) => {
                sessions::remember_last_focused_window(&window.app_handle(), window.label());
            }
            tauri::WindowEvent::Destroyed => {
                let app = window.app_handle();
                sessions::forget_window_file(&app, window.label());
                sessions::clear_last_focused_window(&app, window.label());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            resolve_current_window_file,
            open_new_window,
            open_markdown_in_new_window,
            set_windows_backdrop,
            print_current_window,
            #[cfg(target_os = "macos")]
            menu::update_macos_menu,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        });

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
