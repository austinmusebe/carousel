use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub shortcut: String,
    pub wallpaper_directory: String,
    #[serde(default)]
    pub autostart: bool,
    #[serde(default)]
    pub autostart_prompted: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            shortcut: "Alt+W".to_string(),
            wallpaper_directory: String::new(),
            autostart: false,
            autostart_prompted: false,
        }
    }
}

impl AppConfig {
    pub fn config_path(app: &AppHandle) -> PathBuf {
        let config_dir = app
            .path()
            .app_config_dir()
            .expect("failed to get app config dir");
        config_dir.join("config.json")
    }

    pub fn load(app: &AppHandle) -> Self {
        let path = Self::config_path(app);
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str::<AppConfig>(&content) {
                    Ok(config) => return config,
                    Err(e) => {
                        eprintln!("Failed to parse config: {e}, using defaults");
                    }
                },
                Err(e) => {
                    eprintln!("Failed to read config: {e}, using defaults");
                }
            }
        }
        let config = Self::default();
        config.save(app);
        config
    }

    pub fn save(&self, app: &AppHandle) {
        let path = Self::config_path(app);
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        match serde_json::to_string_pretty(self) {
            Ok(json) => {
                if let Err(e) = fs::write(&path, json) {
                    eprintln!("Failed to write config: {e}");
                }
            }
            Err(e) => {
                eprintln!("Failed to serialize config: {e}");
            }
        }
    }

    pub fn has_valid_directory(&self) -> bool {
        if self.wallpaper_directory.is_empty() {
            return false;
        }
        std::path::Path::new(&self.wallpaper_directory).is_dir()
    }
}
