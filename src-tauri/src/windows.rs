use anyhow::{Context, Result};
use tauri::utils::config::WindowConfig;
use tauri::{AppHandle, Manager, Runtime, WebviewWindowBuilder, Window};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::sessions;

fn base_window_config<R: Runtime>(app: &AppHandle<R>) -> Result<WindowConfig> {
    // Tauri auto-merges `tauri.<platform>.conf.json` into the main config, so the
    // first window template here already carries platform-specific decorations,
    // titleBarStyle, trafficLightPosition etc. We deliberately do NOT re-apply
    // them via cfg(target_os = "macos") builder calls — the conf.json is the
    // single source of truth for window chrome.
    app.config()
        .app
        .windows
        .first()
        .cloned()
        .context("Missing window configuration template")
}

/// Build the configured webview window and reveal it.
///
/// This MUST run off the calling command/event-handler thread on Windows.
/// `WebviewWindowBuilder::build` deadlocks WebView2 initialization when it is
/// invoked from a synchronous Tauri command or event handler — the OS window
/// frame appears but the webview content never loads (renders blank). The main
/// window dodges this only because it is built during `setup`, not from a
/// command. See the `WebviewWindowBuilder` documentation ("On Windows, this
/// function deadlocks when used in a synchronous command and event handlers").
fn build_window<R: Runtime>(app: &AppHandle<R>, config: &WindowConfig) -> Result<()> {
    let builder = WebviewWindowBuilder::from_config(app, config)?
        .on_navigation(is_app_navigation)
        // `platform/detect.ts` reads this; the webview's user agent is a guess.
        .initialization_script(format!(
            "window.__NYAMARK_PLATFORM__ = {:?};",
            std::env::consts::OS
        ));
    // macOS: shown once it has a backdrop, in the theme its page opens in.
    // The window is transparent so that it can be frosted, and till its page
    // was drawn it was its traffic lights alone, floating over what lay
    // behind.
    #[cfg(target_os = "macos")]
    let (frosted, theme) = saved_look(app);
    #[cfg(target_os = "macos")]
    let builder = builder.visible(false).theme(theme);
    let window = builder.build()?;
    #[cfg(target_os = "macos")]
    let _ = set_background_blur(&window.as_ref().window(), frosted);
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

/// Keep the webview on the app's own origin. Markdown that reaches the editor
/// can carry raw HTML; a link that slipped past the click handlers must not be
/// able to navigate the privileged window to an external site (which would
/// also sever the IPC bridge). The frontend opens links through the opener
/// plugin instead.
fn is_app_navigation(url: &tauri::Url) -> bool {
    match url.scheme() {
        // Production on macOS / Linux.
        "tauri" => true,
        // Production on Windows (`tauri.localhost`) and the Vite dev server.
        "http" | "https" => matches!(url.host_str(), Some("localhost" | "tauri.localhost")),
        _ => false,
    }
}

/// The main window is declared with `create: false` in `tauri.conf.json` so it
/// goes through the same builder (and navigation guard) as every other window.
pub fn create_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let config = base_window_config(app)?;
    build_window(app, &config)
}

/// Open a new editor window bound to an existing markdown file on disk. A file
/// some window already edits brings that window forward: two windows on one
/// file saved over each other's changes.
///
/// Builds on the calling thread, so it may only run from an async command (see
/// `build_window`). Synchronous callers use `spawn_editor_window`.
pub fn open_editor_window<R: Runtime>(app: &AppHandle<R>, path: String) -> Result<()> {
    let normalized_path = sessions::normalize_file_path(&path)
        .with_context(|| format!("Invalid markdown file path: {path}"))?;
    let mut config = base_window_config(app)?;
    let label = sessions::next_window_label(app);
    config.label = label.clone();

    // Bind the file before the window builds so the child's
    // `resolve_current_window_file` lookup cannot race ahead of it.
    if let Some(holder) = sessions::claim_window_file(app, &label, normalized_path) {
        if let Some(window) = app.get_webview_window(&holder) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        return Ok(());
    }

    build_window(app, &config).inspect_err(|_| sessions::forget_window_file(app, &label))
}

/// Open a blank editor window not yet bound to any file on disk. Same thread
/// rule as `open_editor_window`.
pub fn open_blank_editor_window<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let mut config = base_window_config(app)?;
    config.label = sessions::next_window_label(app);
    build_window(app, &config)
}

/// `open_editor_window` for event handlers and synchronous commands: builds on
/// a fresh thread and, with no caller left to return the error to, reports a
/// failure in a native dialog.
pub fn spawn_editor_window<R: Runtime>(app: &AppHandle<R>, path: String) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = open_editor_window(&app, path.clone()) {
            eprintln!("Failed to open editor window for {path:?}: {error:#}");
            app.dialog()
                .message(format!("Could not open {path}\n\n{error:#}"))
                .kind(MessageDialogKind::Error)
                .show(|_| {});
        }
    });
}

#[cfg(target_os = "windows")]
pub fn set_native_backdrop<R: Runtime>(window: &Window<R>, enabled: bool) -> Result<()> {
    use ::windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMSBT_NONE, DWMSBT_TRANSIENTWINDOW, DWMWA_SYSTEMBACKDROP_TYPE,
    };

    let hwnd = window
        .hwnd()
        .context("Failed to get native window handle")?;
    let backdrop = if enabled {
        DWMSBT_TRANSIENTWINDOW
    } else {
        DWMSBT_NONE
    };

    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE,
            &backdrop as *const _ as *const core::ffi::c_void,
            std::mem::size_of_val(&backdrop) as u32,
        )
        .context("Failed to set native DWM backdrop")?;
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn set_native_backdrop<R: Runtime>(_window: &Window<R>, _enabled: bool) -> Result<()> {
    Ok(())
}

/// How far the frosted window blurs what lies behind it, in points.
#[cfg(target_os = "macos")]
const GLASS_BLUR_RADIUS: i32 = 16;

/// macOS: blurs what lies behind the transparent window, or stops blurring
/// it. The system's vibrancy blurs at a width of its own, so wide that nothing
/// behind the window could be made out but the edges of other windows; the
/// window server blurs at the width it is given, as it does for iTerm2, kitty
/// and Ghostty.
///
/// Unblurred, the window takes the colour of its page, which shows before
/// the page is drawn and wherever it lags behind a resize.
#[cfg(target_os = "macos")]
pub fn set_background_blur<R: Runtime>(window: &Window<R>, enabled: bool) -> Result<()> {
    use objc2_app_kit::{NSColor, NSWindow};

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGSMainConnectionID() -> i32;
        fn CGSSetWindowBackgroundBlurRadius(connection: i32, window: i32, radius: i32) -> i32;
    }

    let radius = if enabled { GLASS_BLUR_RADIUS } else { 0 };
    let ns_window = window
        .ns_window()
        .context("Failed to get native window handle")? as usize;
    window
        .run_on_main_thread(move || {
            // SAFETY: the pointer is the window's live NSWindow, and AppKit is
            // only touched here on the main thread.
            let ns_window = unsafe { &*(ns_window as *const NSWindow) };
            let number = ns_window.windowNumber() as i32;
            // SAFETY: plain values, for a window of this process's own
            // connection to the window server.
            unsafe {
                CGSSetWindowBackgroundBlurRadius(CGSMainConnectionID(), number, radius);
            }
            let color = if enabled {
                NSColor::clearColor()
            } else {
                page_color()
            };
            ns_window.setBackgroundColor(Some(&color));
        })
        .context("Failed to reach the main thread")?;
    Ok(())
}

/// The colour the page opens on, `--ny-app-bg-start` in `shell.css`, in the
/// appearance the window is drawn in: it follows the theme as it changes.
#[cfg(target_os = "macos")]
fn page_color() -> objc2::rc::Retained<objc2_app_kit::NSColor> {
    use objc2_app_kit::{NSAppearance, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSColor};
    use objc2_foundation::NSArray;
    use std::ptr::NonNull;

    let light = NSColor::colorWithSRGBRed_green_blue_alpha(1.0, 254.0 / 255.0, 251.0 / 255.0, 1.0);
    let dark =
        NSColor::colorWithSRGBRed_green_blue_alpha(16.0 / 255.0, 21.0 / 255.0, 27.0 / 255.0, 1.0);
    let provider = block2::RcBlock::new(move |appearance: NonNull<NSAppearance>| {
        // SAFETY: AppKit hands the provider a live appearance, and the names
        // are its own constants.
        let (appearance, aqua, dark_aqua) = unsafe {
            (
                appearance.as_ref(),
                NSAppearanceNameAqua,
                NSAppearanceNameDarkAqua,
            )
        };
        let is_dark = appearance
            .bestMatchFromAppearancesWithNames(&NSArray::from_slice(&[aqua, dark_aqua]))
            .is_some_and(|name| name.isEqualToString(dark_aqua));
        NonNull::from(if is_dark { &*dark } else { &*light })
    });
    // SAFETY: the provider returns one of the colours it holds, which live
    // as long as it does.
    unsafe { NSColor::colorWithName_dynamicProvider(None, &provider) }
}

/// The window's look as the settings last saved it: whether it is frosted
/// (`appearance.windowTransparency`) and the theme chosen over the system's
/// (`appearance.theme`), from the store of `bridge/ipc/settings.ts`. Till the
/// page set its theme, a window of a light page opened dark on a dark system.
#[cfg(target_os = "macos")]
fn saved_look<R: Runtime>(app: &AppHandle<R>) -> (bool, Option<tauri::Theme>) {
    use serde_json::Value;

    let appearance = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|dir| std::fs::read_to_string(dir.join("preferences.json")).ok())
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|store| store.pointer("/settings/appearance").cloned())
        .unwrap_or(Value::Null);
    let frosted = appearance["windowTransparency"].as_bool().unwrap_or(false);
    let theme = match appearance["theme"].as_str() {
        Some("light") => Some(tauri::Theme::Light),
        Some("dark") => Some(tauri::Theme::Dark),
        _ => None,
    };
    (frosted, theme)
}

#[cfg(not(target_os = "macos"))]
pub fn set_background_blur<R: Runtime>(_window: &Window<R>, _enabled: bool) -> Result<()> {
    Ok(())
}

/// Mirrors unsaved changes into the native window: on macOS the close button
/// shows its dot and the title bar's document icon dims.
#[cfg(target_os = "macos")]
pub fn set_document_edited<R: Runtime>(window: &Window<R>, edited: bool) -> Result<()> {
    use objc2_app_kit::NSWindow;

    let ns_window = window
        .ns_window()
        .context("Failed to get native window handle")? as usize;
    window
        .run_on_main_thread(move || {
            // SAFETY: the pointer is the window's live NSWindow, and AppKit is
            // only touched here on the main thread.
            let ns_window = unsafe { &*(ns_window as *const NSWindow) };
            ns_window.setDocumentEdited(edited);
            restore_traffic_lights(ns_window);
        })
        .context("Failed to reach the main thread")?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_document_edited<R: Runtime>(_window: &Window<R>, _edited: bool) -> Result<()> {
    Ok(())
}

/// Names the window after its document. The title is set on the main thread
/// on macOS, where the traffic lights are put back in place right after.
#[cfg(target_os = "macos")]
pub fn set_title<R: Runtime>(window: &Window<R>, title: &str) -> Result<()> {
    use objc2_app_kit::NSWindow;
    use objc2_foundation::NSString;

    let title = title.to_owned();
    let ns_window = window
        .ns_window()
        .context("Failed to get native window handle")? as usize;
    window
        .run_on_main_thread(move || {
            // SAFETY: the pointer is the window's live NSWindow, and AppKit is
            // only touched here on the main thread.
            let ns_window = unsafe { &*(ns_window as *const NSWindow) };
            ns_window.setTitle(&NSString::from_str(&title));
            restore_traffic_lights(ns_window);
        })
        .context("Failed to reach the main thread")?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_title<R: Runtime>(window: &Window<R>, title: &str) -> Result<()> {
    window
        .set_title(title)
        .context("Failed to set the window title")
}

/// macOS: a new title or edited state has AppKit lay the title bar out again,
/// which moves the traffic lights back to their default place until the
/// window next resizes. The webview's parent view (wry) puts them at
/// `trafficLightPosition` each time it draws, so it is drawn again, after
/// that layout.
#[cfg(target_os = "macos")]
fn restore_traffic_lights(ns_window: &objc2_app_kit::NSWindow) {
    if let Some(view) = ns_window.contentView() {
        view.setNeedsDisplay(true);
    }
}
