use anyhow::{Context, Result};
use tauri::utils::config::WindowConfig;
use tauri::{AppHandle, Runtime, WebviewWindowBuilder, Window};

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
    let window = WebviewWindowBuilder::from_config(app, config)?.build()?;
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

/// Open a new editor window bound to an existing markdown file on disk.
pub fn open_editor_window<R: Runtime>(app: &AppHandle<R>, path: String) -> Result<()> {
    let normalized_path = sessions::normalize_file_path(&path)
        .with_context(|| format!("Invalid markdown file path: {path}"))?;
    let mut config = base_window_config(app)?;
    let label = sessions::next_window_label(app);
    config.label = label.clone();

    // Remember the file binding before the window builds so the child's
    // `resolve_current_window_file` lookup cannot race ahead of it.
    sessions::remember_window_file(app, &label, normalized_path);

    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = build_window(&app, &config) {
            sessions::forget_window_file(&app, &label);
            eprintln!("Failed to open editor window: {error}");
        }
    });

    Ok(())
}

/// Open a blank editor window not yet bound to any file on disk.
pub fn open_blank_editor_window<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let mut config = base_window_config(app)?;
    config.label = sessions::next_window_label(app);

    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = build_window(&app, &config) {
            eprintln!("Failed to open blank editor window: {error}");
        }
    });

    Ok(())
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
