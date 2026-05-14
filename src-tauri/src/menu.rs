#![cfg(target_os = "macos")]

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use serde::Deserialize;

use crate::sessions;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MenuTranslations {
    pub preferences: String,
    pub about: String,
    pub services: String,
    pub hide: String,
    pub hide_others: String,
    pub quit: String,
    pub new: String,
    pub open: String,
    pub save: String,
    pub save_as: String,
    pub export_pdf: String,
    pub file: String,
    pub close_window: String,
    pub edit: String,
    pub undo: String,
    pub redo: String,
    pub cut: String,
    pub copy: String,
    pub paste: String,
    pub select_all: String,
    pub view: String,
    pub fullscreen: String,
    pub window: String,
    pub minimize: String,
    pub maximize: String,
}

pub const APP_MENU_ACTION_EVENT: &str = "nyamark://menu-action";

const MENU_NEW_ID: &str = "file_new";
const MENU_OPEN_ID: &str = "file_open";
const MENU_SAVE_ID: &str = "file_save";
const MENU_SAVE_AS_ID: &str = "file_save_as";
const MENU_EXPORT_PDF_ID: &str = "file_export_pdf";
const MENU_SETTINGS_ID: &str = "app_settings";

pub fn build_macos_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let t = MenuTranslations {
        preferences: "Preferences…".to_string(),
        about: format!("About {}", app.package_info().name),
        services: "Services".to_string(),
        hide: format!("Hide {}", app.package_info().name),
        hide_others: "Hide Others".to_string(),
        quit: format!("Quit {}", app.package_info().name),
        new: "New".to_string(),
        open: "Open...".to_string(),
        save: "Save".to_string(),
        save_as: "Save As...".to_string(),
        export_pdf: "Export as PDF...".to_string(),
        file: "File".to_string(),
        close_window: "Close Window".to_string(),
        edit: "Edit".to_string(),
        undo: "Undo".to_string(),
        redo: "Redo".to_string(),
        cut: "Cut".to_string(),
        copy: "Copy".to_string(),
        paste: "Paste".to_string(),
        select_all: "Select All".to_string(),
        view: "View".to_string(),
        fullscreen: "Toggle Full Screen".to_string(),
        window: "Window".to_string(),
        minimize: "Minimize".to_string(),
        maximize: "Zoom".to_string(),
    };
    build_custom_macos_menu(app, &t)
}

pub fn build_custom_macos_menu<R: Runtime>(app: &AppHandle<R>, t: &MenuTranslations) -> tauri::Result<Menu<R>> {
    let settings_item = MenuItem::with_id(
        app,
        MENU_SETTINGS_ID,
        &t.preferences,
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let app_menu = Submenu::with_items(
        app,
        app.package_info().name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, Some(&t.about), None)?,
            &PredefinedMenuItem::separator(app)?,
            &settings_item,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some(&t.services))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(&t.hide))?,
            &PredefinedMenuItem::hide_others(app, Some(&t.hide_others))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some(&t.quit))?,
        ],
    )?;
    let new_item = MenuItem::with_id(app, MENU_NEW_ID, &t.new, true, Some("CmdOrCtrl+N"))?;
    let open_item = MenuItem::with_id(app, MENU_OPEN_ID, &t.open, true, Some("CmdOrCtrl+O"))?;
    let save_item = MenuItem::with_id(app, MENU_SAVE_ID, &t.save, true, Some("CmdOrCtrl+S"))?;
    let save_as_item = MenuItem::with_id(
        app,
        MENU_SAVE_AS_ID,
        &t.save_as,
        true,
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let export_pdf_item = MenuItem::with_id(
        app,
        MENU_EXPORT_PDF_ID,
        &t.export_pdf,
        true,
        Some("CmdOrCtrl+P"),
    )?;
    let file_menu = Submenu::with_items(
        app,
        &t.file,
        true,
        &[
            &new_item,
            &open_item,
            &save_item,
            &save_as_item,
            &export_pdf_item,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some(&t.close_window))?,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        app,
        &t.edit,
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(&t.undo))?,
            &PredefinedMenuItem::redo(app, Some(&t.redo))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(&t.cut))?,
            &PredefinedMenuItem::copy(app, Some(&t.copy))?,
            &PredefinedMenuItem::paste(app, Some(&t.paste))?,
            &PredefinedMenuItem::select_all(app, Some(&t.select_all))?,
        ],
    )?;
    let view_menu = Submenu::with_items(
        app,
        &t.view,
        true,
        &[&PredefinedMenuItem::fullscreen(app, Some(&t.fullscreen))?],
    )?;
    let window_menu = Submenu::with_items(
        app,
        &t.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(&t.minimize))?,
            &PredefinedMenuItem::maximize(app, Some(&t.maximize))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some(&t.close_window))?,
        ],
    )?;

    Menu::with_items(
        app,
        &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu],
    )
}

#[tauri::command]
pub fn update_macos_menu<R: Runtime>(app: AppHandle<R>, translations: MenuTranslations) -> Result<(), String> {
    let menu = build_custom_macos_menu(&app, &translations).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
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
    } else if event.id() == MENU_EXPORT_PDF_ID {
        Some("export-pdf")
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
