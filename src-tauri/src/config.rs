use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn default_display_mode() -> String {
    "carousel".to_string()
}

fn default_blur_mode() -> String {
    "fullscreen".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub shortcut: String,
    pub wallpaper_directory: String,
    #[serde(default)]
    pub autostart: bool,
    #[serde(default)]
    pub autostart_prompted: bool,
    #[serde(default = "default_display_mode")]
    pub display_mode: String,
    #[serde(default)]
    pub blur_background: bool,
    #[serde(default = "default_blur_mode")]
    pub blur_mode: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            shortcut: "Alt+W".to_string(),
            wallpaper_directory: String::new(),
            autostart: false,
            autostart_prompted: false,
            display_mode: default_display_mode(),
            blur_background: false,
            blur_mode: default_blur_mode(),
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
        } else if let Some(appdata) = path.parent().and_then(|p| p.parent()) {
            // Migration fallback: check legacy folder from before rebranding to "carousel"
            let legacy_path = appdata
                .join("com.carousel-wallpaper-changer.app")
                .join("config.json");
            if legacy_path.exists() {
                if let Ok(content) = fs::read_to_string(&legacy_path) {
                    if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                        eprintln!("[Config] Migrated legacy config from {:?}", legacy_path);
                        config.save(app);
                        return config;
                    }
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
