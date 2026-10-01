use anyhow::{Context, Result};
use tauri::utils::config::WindowConfig;
use tauri::{AppHandle, Runtime, WebviewWindowBuilder, Window};
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
    let window = WebviewWindowBuilder::from_config(app, config)?
        .on_navigation(is_app_navigation)
        // `platform/detect.ts` reads this; the webview's user agent is a guess.
        .initialization_script(format!(
            "window.__NYAMARK_PLATFORM__ = {:?};",
            std::env::consts::OS
        ))
        .build()?;
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

/// Open a new editor window bound to an existing markdown file on disk.
///
/// Builds on the calling thread, so it may only run from an async command (see
/// `build_window`). Synchronous callers use `spawn_editor_window`.
pub fn open_editor_window<R: Runtime>(app: &AppHandle<R>, path: String) -> Result<()> {
    let normalized_path = sessions::normalize_file_path(&path)
        .with_context(|| format!("Invalid markdown file path: {path}"))?;
    let mut config = base_window_config(app)?;
    let label = sessions::next_window_label(app);
    config.label = label.clone();

    // Remember the file binding before the window builds so the child's
    // `resolve_current_window_file` lookup cannot race ahead of it.
    sessions::remember_window_file(app, &label, normalized_path);

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
        })
        .context("Failed to reach the main thread")?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_document_edited<R: Runtime>(_window: &Window<R>, _edited: bool) -> Result<()> {
    Ok(())
}
