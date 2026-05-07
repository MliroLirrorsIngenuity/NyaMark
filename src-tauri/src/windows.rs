use anyhow::{Context, Result};
use tauri::utils::config::WindowConfig;
use tauri::{AppHandle, Runtime, WebviewWindowBuilder};

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

    if let Err(error) = builder.build() {
        sessions::forget_window_file(app, &label);
        return Err(anyhow::Error::from(error));
    }

    Ok(())
}

/// Open a blank editor window not yet bound to any file on disk.
pub fn open_blank_editor_window<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let mut config = base_window_config(app)?;
    config.label = sessions::next_window_label(app);
    let builder = WebviewWindowBuilder::from_config(app, &config)?;

    builder.build().map(|_| ()).map_err(Into::into)
}
