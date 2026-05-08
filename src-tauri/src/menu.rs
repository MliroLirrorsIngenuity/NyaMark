#![cfg(target_os = "macos")]

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::sessions;

pub const APP_MENU_ACTION_EVENT: &str = "nyamark://menu-action";

const MENU_NEW_ID: &str = "file_new";
const MENU_OPEN_ID: &str = "file_open";
const MENU_SAVE_ID: &str = "file_save";
const MENU_SAVE_AS_ID: &str = "file_save_as";
const MENU_SETTINGS_ID: &str = "app_settings";

pub fn build_macos_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let settings_item = MenuItem::with_id(
        app,
        MENU_SETTINGS_ID,
        "Preferences…",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let app_menu = Submenu::with_items(
        app,
        app.package_info().name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &settings_item,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let new_item = MenuItem::with_id(app, MENU_NEW_ID, "New", true, Some("CmdOrCtrl+N"))?;
    let open_item = MenuItem::with_id(app, MENU_OPEN_ID, "Open...", true, Some("CmdOrCtrl+O"))?;
    let save_item = MenuItem::with_id(app, MENU_SAVE_ID, "Save", true, Some("CmdOrCtrl+S"))?;
    let save_as_item = MenuItem::with_id(
        app,
        MENU_SAVE_AS_ID,
        "Save As...",
        true,
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new_item,
            &open_item,
            &save_item,
            &save_as_item,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    Menu::with_items(
        app,
        &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu],
    )
}

pub fn handle_macos_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let action = if event.id() == MENU_NEW_ID {
        Some("new-file")
    } else if event.id() == MENU_OPEN_ID {
        Some("open-file")
    } else if event.id() == MENU_SAVE_ID {
        Some("save-file")
    } else if event.id() == MENU_SAVE_AS_ID {
        Some("save-file-as")
    } else if event.id() == MENU_SETTINGS_ID {
        Some("open-settings")
    } else {
        None
    };

    if let Some(action) = action {
        if let Some(window) = app
            .webview_windows()
            .values()
            .find(|window| window.is_focused().unwrap_or(false))
        {
            let _ = app.emit_to(window.label(), APP_MENU_ACTION_EVENT, action);
            return;
        }

        if let Some(label) = sessions::last_focused_window(app) {
            if app.get_webview_window(&label).is_some() {
                let _ = app.emit_to(label, APP_MENU_ACTION_EVENT, action);
                return;
            }
        }

        if let Some(window) = app.webview_windows().values().next() {
            let _ = app.emit_to(window.label(), APP_MENU_ACTION_EVENT, action);
        }
    }
}
