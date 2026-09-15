use base64::Engine;
use image::ImageReader;
use serde::Serialize;
use std::fs;
use std::io::Cursor;
use std::path::Path;

const THUMB_WIDTH: u32 = 300;
const THUMB_HEIGHT: u32 = 200;
const SUPPORTED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp"];

#[derive(Debug, Clone, Serialize)]
pub struct WallpaperEntry {
    pub filename: String,
    pub path: String,
    pub thumbnail: String, // base64-encoded PNG
}

pub fn scan_directory(dir_path: &str) -> Result<Vec<WallpaperEntry>, String> {
    let dir = Path::new(dir_path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", dir_path));
    }

    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut wallpapers: Vec<WallpaperEntry> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase());

        let is_supported = extension
            .as_deref()
            .map(|e| SUPPORTED_EXTENSIONS.contains(&e))
            .unwrap_or(false);
        if !is_supported {
            continue;
        }

        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let abs_path = match std::fs::canonicalize(&path) {
            Ok(p) => {
                let s = p.to_string_lossy().to_string();
                // Strip \\?\ prefix from canonicalize on Windows
                s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
            }
            Err(_) => continue,
        };

        // Generate thumbnail
        let thumbnail = match generate_thumbnail(&path) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("Failed to generate thumbnail for {}: {}", filename, e);
                continue;
            }
        };

        wallpapers.push(WallpaperEntry {
            filename,
            path: abs_path,
            thumbnail,
        });
    }

    // Sort by filename for consistent ordering
    wallpapers.sort_by_key(|a| a.filename.to_lowercase());

    Ok(wallpapers)
}

fn generate_thumbnail(path: &Path) -> Result<String, String> {
    let reader = ImageReader::open(path)
        .map_err(|e| format!("Failed to open image: {}", e))?
        .with_guessed_format()
        .map_err(|e| format!("Failed to guess image format: {}", e))?;

    let img = reader
        .decode()
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    let thumb = img.thumbnail(THUMB_WIDTH, THUMB_HEIGHT);

    let mut buf = Cursor::new(Vec::new());
    thumb
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

    Ok(base64::engine::general_purpose::STANDARD.encode(buf.into_inner()))
}
