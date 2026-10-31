use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn default_display_mode() -> String {
    "shard".to_string()
}

pub const DISPLAY_MODES: &[&str] = &[
    "carousel",
    "shard",
    "card",
    "depth",
    "geometric",
    "wall",
    "sandy",
    "hand",
    "collection",
    "duel",
    "random",
];
pub const GEOMETRIC_TILES: &[&str] = &["hexagon", "triangle", "diamond", "rhombus"];
pub const GEOMETRIC_CURVES: &[&str] = &["flat", "arc", "wave", "s", "cylinder"];
pub const WALL_LAYOUTS: &[&str] = &[
    "uniform",
    "brick",
    "masonry",
    "justified",
    "editorial",
    "cylinder",
];

/// Returns `value` when it is one of `allowed`, otherwise the first allowed value.
pub fn pick_option(value: &str, allowed: &[&str]) -> String {
    let picked = allowed.iter().find(|option| **option == value);
    picked.unwrap_or(&allowed[0]).to_string()
}

fn default_geometric_tile() -> String {
    GEOMETRIC_TILES[0].to_string()
}

fn default_geometric_curve() -> String {
    GEOMETRIC_CURVES[0].to_string()
}

fn default_wall_layout() -> String {
    WALL_LAYOUTS[0].to_string()
}

fn default_blur_mode() -> String {
    "fullscreen".to_string()
}

fn default_blur_source() -> String {
    "wallpaper".to_string()
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
    #[serde(default = "default_geometric_tile")]
    pub geometric_tile: String,
    #[serde(default = "default_geometric_curve")]
    pub geometric_curve: String,
    #[serde(default = "default_wall_layout")]
    pub wall_layout: String,
    #[serde(default)]
    pub blur_background: bool,
    #[serde(default = "default_blur_mode")]
    pub blur_mode: String,
    #[serde(default = "default_blur_source")]
    pub blur_source: String,
    #[serde(default)]
    pub last_wallpaper: Option<String>,
    #[serde(default)]
    pub wallpaper_engine_enabled: bool,
    /// Wallpaper Engine install folder; empty means auto-detect through Steam
    #[serde(default)]
    pub wallpaper_engine_directory: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            shortcut: "Alt+W".to_string(),
            wallpaper_directory: String::new(),
            autostart: false,
            autostart_prompted: false,
            display_mode: default_display_mode(),
            geometric_tile: default_geometric_tile(),
            geometric_curve: default_geometric_curve(),
            wall_layout: default_wall_layout(),
            blur_background: false,
            blur_mode: default_blur_mode(),
            blur_source: default_blur_source(),
            last_wallpaper: None,
            wallpaper_engine_enabled: false,
            wallpaper_engine_directory: String::new(),
        }
    }
}

impl AppConfig {
    pub fn config_path(app: &AppHandle) -> PathBuf {
        let config_dir = app
            .path()
            .app_config_dir()
            .expect("failed to get app config dir");
        config_dir.join("carousel.json")
    }

    pub fn legacy_config_path(app: &AppHandle) -> PathBuf {
        let config_dir = app
            .path()
            .app_config_dir()
            .expect("failed to get app config dir");
        config_dir.join("config.json")
    }

    pub fn load(app: &AppHandle) -> Self {
        let primary_path = Self::config_path(app);
        if primary_path.exists() {
            match fs::read_to_string(&primary_path) {
                Ok(content) => match serde_json::from_str::<AppConfig>(&content) {
                    Ok(config) => return config,
                    Err(e) => {
                        eprintln!("Failed to parse config at {:?}: {e}", primary_path);
                        return Self::default();
                    }
                },
                Err(e) => {
                    eprintln!("Failed to read config at {:?}: {e}", primary_path);
                    return Self::default();
                }
            }
        }

        let legacy_path = Self::legacy_config_path(app);
        if legacy_path.exists() {
            match fs::read_to_string(&legacy_path) {
                Ok(content) => match serde_json::from_str::<AppConfig>(&content) {
                    Ok(config) => {
                        eprintln!("[Config] Migrated config from {:?}", legacy_path);
                        config.save(app);
                        return config;
                    }
                    Err(e) => {
                        eprintln!("Failed to parse legacy config at {:?}: {e}", legacy_path);
                        return Self::default();
                    }
                },
                Err(e) => {
                    eprintln!("Failed to read legacy config at {:?}: {e}", legacy_path);
                    return Self::default();
                }
            }
        }

        if let Some(appdata) = primary_path.parent().and_then(|p| p.parent()) {
            // Migration fallback: check legacy folder from before rebranding to "carousel"
            let old_brand_path = appdata
                .join("com.carousel-wallpaper-changer.app")
                .join("config.json");
            if old_brand_path.exists() {
                if let Ok(content) = fs::read_to_string(&old_brand_path) {
                    if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                        eprintln!("[Config] Migrated old brand config from {:?}", old_brand_path);
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

    pub fn write_and_sync(path: &Path, content: &[u8]) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let tmp_path = path.with_extension("tmp");
        {
            let mut file = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&tmp_path)?;
            file.write_all(content)?;
            file.flush()?;
            file.sync_all()?;
        }

        if fs::rename(&tmp_path, path).is_err() {
            let mut file = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(path)?;
            file.write_all(content)?;
            file.flush()?;
            file.sync_all()?;
            let _ = fs::remove_file(&tmp_path);
        }
        Ok(())
    }

    pub fn save(&self, app: &AppHandle) {
        let primary_path = Self::config_path(app);
        let legacy_path = Self::legacy_config_path(app);

        match serde_json::to_string_pretty(self) {
            Ok(json) => {
                let bytes = json.as_bytes();
                if let Err(e) = Self::write_and_sync(&primary_path, bytes) {
                    eprintln!("Failed to write primary config to {:?}: {e}", primary_path);
                }
                if let Err(e) = Self::write_and_sync(&legacy_path, bytes) {
                    eprintln!("Failed to write legacy config to {:?}: {e}", legacy_path);
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

    pub fn has_valid_source(&self) -> bool {
        self.wallpaper_engine_enabled || self.has_valid_directory()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config_has_none_last_wallpaper() {
        let config = AppConfig::default();
        assert_eq!(config.last_wallpaper, None);
        assert_eq!(config.shortcut, "Alt+W");
        assert_eq!(config.display_mode, "shard");
    }

    #[test]
    fn test_deserialize_config_without_last_wallpaper() {
        let json = r#"{
            "shortcut": "Ctrl+Alt+W",
            "wallpaper_directory": "C:\\Wallpapers"
        }"#;
        let config: AppConfig = serde_json::from_str(json).expect("should parse");
        assert_eq!(config.shortcut, "Ctrl+Alt+W");
        assert_eq!(config.wallpaper_directory, "C:\\Wallpapers");
        assert_eq!(config.last_wallpaper, None);
        assert_eq!(config.display_mode, "shard");
    }

    #[test]
    fn test_deserialize_config_with_last_wallpaper() {
        let json = r#"{
            "shortcut": "Alt+W",
            "wallpaper_directory": "C:\\Wallpapers",
            "last_wallpaper": "C:\\Wallpapers\\photo.jpg"
        }"#;
        let config: AppConfig = serde_json::from_str(json).expect("should parse");
        assert_eq!(
            config.last_wallpaper,
            Some("C:\\Wallpapers\\photo.jpg".to_string())
        );
    }

    #[test]
    fn test_roundtrip_config_with_last_wallpaper() {
        let mut config = AppConfig::default();
        config.last_wallpaper = Some("C:\\Wallpapers\\nature.png".to_string());
        let json = serde_json::to_string(&config).expect("serialize");
        let parsed: AppConfig = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed.last_wallpaper, config.last_wallpaper);
    }

    #[test]
    fn test_card_display_mode_parsing() {
        let json = r#"{
            "shortcut": "Alt+W",
            "wallpaper_directory": "C:\\Wallpapers",
            "display_mode": "card"
        }"#;
        let config: AppConfig = serde_json::from_str(json).expect("should parse");
        assert_eq!(config.display_mode, "card");
    }

    #[test]
    fn test_pick_option_keeps_known_values_and_falls_back() {
        assert_eq!(pick_option("duel", DISPLAY_MODES), "duel");
        assert_eq!(pick_option("nonsense", DISPLAY_MODES), "carousel");
        assert_eq!(pick_option("masonry", WALL_LAYOUTS), "masonry");
        assert_eq!(pick_option("", GEOMETRIC_CURVES), "flat");
    }

    #[test]
    fn test_config_without_style_options_gets_defaults() {
        let json = r#"{"shortcut": "Alt+W", "wallpaper_directory": ""}"#;
        let config: AppConfig = serde_json::from_str(json).expect("should parse");
        assert_eq!(config.geometric_tile, "hexagon");
        assert_eq!(config.geometric_curve, "flat");
        assert_eq!(config.wall_layout, "uniform");
    }

    #[test]
    fn test_wallpaper_engine_alone_is_a_valid_source() {
        let mut config = AppConfig::default();
        assert!(!config.has_valid_source());
        config.wallpaper_engine_enabled = true;
        assert!(config.has_valid_source());
        assert!(!config.has_valid_directory());
    }

    #[test]
    fn test_write_and_sync_creates_and_overwrites() {
        let tmp_dir = std::env::temp_dir().join("carousel_test_config");
        let _ = fs::create_dir_all(&tmp_dir);
        let test_file = tmp_dir.join("test_carousel.json");

        let content1 = b"{\"wallpaper_directory\": \"C:\\\\Wallpapers\"}";
        AppConfig::write_and_sync(&test_file, content1).expect("write 1");
        assert_eq!(fs::read(&test_file).unwrap(), content1);

        let content2 = b"{\"wallpaper_directory\": \"C:\\\\NewWallpapers\"}";
        AppConfig::write_and_sync(&test_file, content2).expect("write 2");
        assert_eq!(fs::read(&test_file).unwrap(), content2);

        let _ = fs::remove_file(&test_file);
        let _ = fs::remove_dir(&tmp_dir);
    }
}
