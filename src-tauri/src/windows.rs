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

/// Open a new editor window bound to an existing markdown file on disk.
pub fn open_editor_window<R: Runtime>(app: &AppHandle<R>, path: String) -> Result<()> {
    let normalized_path = sessions::normalize_file_path(&path)
        .with_context(|| format!("Invalid markdown file path: {path}"))?;
    let mut config = base_window_config(app)?;
    let label = sessions::next_window_label(app);
    config.label = label.clone();

    sessions::remember_window_file(app, &label, normalized_path);

    let builder = WebviewWindowBuilder::from_config(app, &config)?;

    let window = builder.build().map_err(|error| {
        sessions::forget_window_file(app, &label);
        anyhow::Error::from(error)
    })?;

    let _ = window.show();
    let _ = window.set_focus();

    Ok(())
}

/// Open a blank editor window not yet bound to any file on disk.
pub fn open_blank_editor_window<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let mut config = base_window_config(app)?;
    config.label = sessions::next_window_label(app);
    let builder = WebviewWindowBuilder::from_config(app, &config)?;

    builder.build().map(|_| ()).map_err(Into::into)
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
