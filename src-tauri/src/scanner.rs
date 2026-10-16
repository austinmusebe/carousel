use base64::Engine;
use image::ImageReader;
use rayon::prelude::*;
use serde::Serialize;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

const THUMB_WIDTH: u32 = 720;
const THUMB_HEIGHT: u32 = 450;
const SUPPORTED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp"];

#[derive(Debug, Clone, Serialize)]
pub struct WallpaperEntry {
    pub filename: String,
    pub path: String,
    pub thumbnail: String, // base64-encoded JPEG
    pub width: u32,
    pub height: u32,
    pub file_size: u64, // bytes
}

pub fn scan_directory(dir_path: &str) -> Result<Vec<WallpaperEntry>, String> {
    let scan_start = std::time::Instant::now();
    let dir = Path::new(dir_path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", dir_path));
    }

    let read_dir = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    // Collect valid image file paths first
    let files: Vec<PathBuf> = read_dir
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }

            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())?;

            if SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
                Some(path)
            } else {
                None
            }
        })
        .collect();

    // Process thumbnails in parallel using rayon
    let mut wallpapers: Vec<WallpaperEntry> = files
        .par_iter()
        .filter_map(|path| {
            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();

            let abs_path = match std::fs::canonicalize(path) {
                Ok(p) => {
                    let s = p.to_string_lossy().to_string();
                    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
                }
                Err(_) => return None,
            };

            let (thumbnail, width, height) = match generate_thumbnail(path) {
                Ok(t) => t,
                Err(e) => {
                    eprintln!("Failed to generate thumbnail for {}: {}", filename, e);
                    return None;
                }
            };

            let file_size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

            Some(WallpaperEntry {
                filename,
                path: abs_path,
                thumbnail,
                width,
                height,
                file_size,
            })
        })
        .collect();

    // Sort by filename for consistent ordering
    wallpapers.sort_by_key(|a| a.filename.to_lowercase());

    println!(
        "[Scanner] Scanned {} images in {:?} (parallel thumbnails generated)",
        wallpapers.len(),
        scan_start.elapsed()
    );

    Ok(wallpapers)
}

fn generate_thumbnail(path: &Path) -> Result<(String, u32, u32), String> {
    let reader = ImageReader::open(path)
        .map_err(|e| format!("Failed to open image: {}", e))?
        .with_guessed_format()
        .map_err(|e| format!("Failed to guess image format: {}", e))?;

    let img = reader
        .decode()
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    let width = img.width();
    let height = img.height();

    let thumb = img.thumbnail(THUMB_WIDTH, THUMB_HEIGHT);

    let mut buf = Cursor::new(Vec::new());
    // Use JPEG with quality 80 for fast encoding and compact base64 size
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 80);
    encoder
        .encode_image(&thumb)
        .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

    Ok((base64::engine::general_purpose::STANDARD.encode(buf.into_inner()), width, height))
}
