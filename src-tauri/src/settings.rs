use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AppearanceSettings {
    pub font_size: u32,
    pub line_height: f64,
    pub readable_max_width: u32,
    pub window_opacity: u32,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            font_size: 14,
            line_height: 1.52,
            readable_max_width: 720,
            window_opacity: 92,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettings {
    pub auto_save: bool,
    pub auto_save_interval_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentSettings {
    pub insert_policy: String,
    pub pasted_image_policy: Option<String>,
    pub prefer_relative_path: bool,
    pub ensure_dot_slash: bool,
    pub escape_path: bool,
    pub custom_copy_directory: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub general: GeneralSettings,
    pub appearance: AppearanceSettings,
    pub save: SaveSettings,
    pub attachments: AttachmentSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            general: GeneralSettings {
                language: "en".to_string(),
            },
            appearance: AppearanceSettings::default(),
            save: SaveSettings {
                auto_save: false,
                auto_save_interval_ms: 4000,
            },
            attachments: AttachmentSettings {
                insert_policy: "use-path".to_string(),
                pasted_image_policy: None,
                prefer_relative_path: true,
                ensure_dot_slash: false,
                escape_path: false,
                custom_copy_directory: None,
            },
        }
    }
}

pub fn load_settings(app: &AppHandle) -> Result<Settings> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(Settings::default());
    }

    let raw = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read settings file: {path:?}"))?;
    let settings = serde_json::from_str::<Settings>(&raw)
        .with_context(|| format!("Failed to parse settings file: {path:?}"))?;
    Ok(settings)
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> Result<()> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create settings directory: {parent:?}"))?;
    }

    let raw = serde_json::to_string_pretty(settings)?;
    fs::write(&path, raw).with_context(|| format!("Failed to write settings file: {path:?}"))?;
    Ok(())
}

fn settings_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .with_context(|| "Failed to resolve app config directory")?;
    Ok(dir.join("settings.json"))
}
