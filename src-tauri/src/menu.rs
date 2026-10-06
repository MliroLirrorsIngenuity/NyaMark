#![cfg(target_os = "macos")]

use icu_locale::{LanguageIdentifier, LocaleExpander};
use serde::Deserialize;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::{quit, sessions};

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MenuTranslations {
    pub preferences: String,
    pub about: String,
    pub check_updates: String,
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
    pub ai_assistant: String,
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
const MENU_CHECK_UPDATES_ID: &str = "app_check_updates";
const MENU_TOGGLE_AI_ID: &str = "view_toggle_ai";
const MENU_QUIT_ID: &str = "app_quit";

pub fn build_macos_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    build_custom_macos_menu(app, &startup_translations())
}

/// The frontend's locale files; their `menu` sections are what the webview
/// sends through `update_macos_menu` once it has loaded.
const LOCALES: [(&str, &str); 3] = [
    ("en", include_str!("../../src/i18n/locales/en.json")),
    ("zh-CN", include_str!("../../src/i18n/locales/zh-CN.json")),
    ("zh-TW", include_str!("../../src/i18n/locales/zh-TW.json")),
];

#[derive(Deserialize)]
struct LocaleFile {
    menu: MenuTranslations,
}

/// The menu shown before the webview reports the user's language: the first
/// supported system language, as `systemLanguage` in `src/i18n` picks it.
fn startup_translations() -> MenuTranslations {
    let preferred: Vec<String> = objc2_foundation::NSLocale::preferredLanguages()
        .iter()
        .map(|language| language.to_string())
        .collect();
    let locale = match_language(preferred.iter().map(String::as_str)).unwrap_or("en");
    bundled_translations(locale)
}

/// The first of `languages` a bundled locale is in: the one of the same
/// language and script once CLDR's likely subtags fill in what a tag leaves
/// out, so `zh-MO` reads as Traditional Chinese.
fn match_language<'a>(languages: impl IntoIterator<Item = &'a str>) -> Option<&'static str> {
    let expander = LocaleExpander::new_extended();
    let likely = |tag: &str| {
        let mut language = LanguageIdentifier::try_from_str(tag).ok()?;
        expander.maximize(&mut language);
        Some((language.language, language.script))
    };
    languages.into_iter().filter_map(likely).find_map(|wanted| {
        LOCALES
            .iter()
            .map(|(locale, _)| *locale)
            .find(|locale| likely(locale) == Some(wanted))
    })
}

fn bundled_translations(locale: &str) -> MenuTranslations {
    let source = LOCALES
        .iter()
        .find(|(tag, _)| *tag == locale)
        .map_or(LOCALES[0].1, |(_, source)| source);
    // Bundled at build time and checked by `every_bundled_locale_has_a_menu`.
    #[allow(clippy::expect_used)]
    let file = serde_json::from_str::<LocaleFile>(source)
        .expect("bundled locale files carry a complete menu section");
    file.menu
}

pub fn build_custom_macos_menu<R: Runtime>(
    app: &AppHandle<R>,
    t: &MenuTranslations,
) -> tauri::Result<Menu<R>> {
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
            &MenuItem::with_id(
                app,
                MENU_CHECK_UPDATES_ID,
                &t.check_updates,
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &settings_item,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some(&t.services))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(&t.hide))?,
            &PredefinedMenuItem::hide_others(app, Some(&t.hide_others))?,
            &PredefinedMenuItem::separator(app)?,
            // A custom item instead of `PredefinedMenuItem::quit`: the predefined
            // one sends `terminate:` straight to NSApp, skipping the unsaved-changes
            // prompt. This one goes through `quit::request_quit`.
            &MenuItem::with_id(app, MENU_QUIT_ID, &t.quit, true, Some("CmdOrCtrl+Q"))?,
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
        &[
            // No accelerator: the webview binds Cmd+Shift+L itself, and a
            // menu's would toggle the panel a second time.
            &MenuItem::with_id(app, MENU_TOGGLE_AI_ID, &t.ai_assistant, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, Some(&t.fullscreen))?,
        ],
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
pub fn update_macos_menu<R: Runtime>(
    app: AppHandle<R>,
    translations: MenuTranslations,
) -> Result<(), String> {
    let menu = build_custom_macos_menu(&app, &translations).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn handle_macos_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if event.id() == MENU_QUIT_ID {
        quit::request_quit(app);
        return;
    }

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
    } else if event.id() == MENU_CHECK_UPDATES_ID {
        Some("check-updates")
    } else if event.id() == MENU_TOGGLE_AI_ID {
        Some("toggle-ai")
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_bundled_locale_has_a_menu() {
        for (locale, _) in LOCALES {
            assert!(!bundled_translations(locale).file.is_empty(), "{locale}");
        }
    }

    #[test]
    fn system_languages_map_like_the_frontend() -> Result<(), serde_json::Error> {
        // The cases the frontend's `systemLanguage` is tested with too.
        let cases: Vec<(Vec<String>, Option<String>)> =
            serde_json::from_str(include_str!("../../tests/system-languages.json"))?;
        for (languages, locale) in cases {
            assert_eq!(
                match_language(languages.iter().map(String::as_str)),
                locale.as_deref(),
                "{languages:?}"
            );
        }
        Ok(())
    }
}
