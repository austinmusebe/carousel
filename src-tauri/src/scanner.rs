use image::ImageReader;
use rayon::prelude::*;
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::SystemTime;

const THUMB_WIDTH: u32 = 360;
const THUMB_HEIGHT: u32 = 225;
const SUPPORTED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp"];

#[derive(Debug, Clone, Serialize)]
pub struct WallpaperEntry {
    pub filename: String,
    pub path: String,
    /// Absolute path to cached thumbnail JPEG file
    pub thumbnail: String,
    pub width: u32,
    pub height: u32,
    pub file_size: u64, // bytes
}

fn cache_key(path: &Path, mtime: SystemTime) -> String {
    let mut hasher = DefaultHasher::new();
    path.to_string_lossy().hash(&mut hasher);
    let hash = hasher.finish();
    let secs = mtime
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{:016x}_{}.jpg", hash, secs)
}

fn get_image_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let reader = ImageReader::open(path)
        .map_err(|e| format!("Failed to open image: {}", e))?
        .with_guessed_format()
        .map_err(|e| format!("Failed to guess image format: {}", e))?;

    reader
        .into_dimensions()
        .map_err(|e| format!("Failed to read image dimensions: {}", e))
}

pub fn scan_directory(dir_path: &str, cache_dir: &Path) -> Result<Vec<WallpaperEntry>, String> {
    let scan_start = std::time::Instant::now();
    let dir = Path::new(dir_path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", dir_path));
    }

    if !cache_dir.is_dir() {
        fs::create_dir_all(cache_dir)
            .map_err(|e| format!("Failed to create cache directory: {}", e))?;
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

    let cache_hits = AtomicUsize::new(0);
    let cache_misses = AtomicUsize::new(0);

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

            let metadata = match fs::metadata(path) {
                Ok(m) => m,
                Err(_) => return None,
            };

            let file_size = metadata.len();
            let mtime = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);

            let cache_filename = cache_key(Path::new(&abs_path), mtime);
            let cache_path = cache_dir.join(cache_filename);

            let is_cached = cache_path.is_file()
                && fs::metadata(&cache_path).map(|m| m.len() > 0).unwrap_or(false);

            let (width, height) = if is_cached {
                match get_image_dimensions(path) {
                    Ok(dims) => {
                        cache_hits.fetch_add(1, Ordering::Relaxed);
                        dims
                    }
                    Err(_) => {
                        // Fallback to regenerating thumbnail if reading dimensions failed
                        cache_misses.fetch_add(1, Ordering::Relaxed);
                        let (bytes, width, height) = match generate_thumbnail(path) {
                            Ok(t) => t,
                            Err(e) => {
                                eprintln!("Failed to generate thumbnail for {}: {}", filename, e);
                                return None;
                            }
                        };
                        if let Err(e) = fs::write(&cache_path, &bytes) {
                            eprintln!("Failed to write thumbnail cache for {}: {}", filename, e);
                            return None;
                        }
                        (width, height)
                    }
                }
            } else {
                cache_misses.fetch_add(1, Ordering::Relaxed);
                let (bytes, width, height) = match generate_thumbnail(path) {
                    Ok(t) => t,
                    Err(e) => {
                        eprintln!("Failed to generate thumbnail for {}: {}", filename, e);
                        return None;
                    }
                };

                if let Err(e) = fs::write(&cache_path, &bytes) {
                    eprintln!("Failed to write thumbnail cache for {}: {}", filename, e);
                    return None;
                }

                (width, height)
            };

            let thumb_str = cache_path.to_string_lossy().to_string();
            let thumbnail = thumb_str.strip_prefix(r"\\?\").unwrap_or(&thumb_str).to_string();

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
        "[Scanner] Scanned {} images in {:?} ({} cache hits, {} generated)",
        wallpapers.len(),
        scan_start.elapsed(),
        cache_hits.load(Ordering::Relaxed),
        cache_misses.load(Ordering::Relaxed)
    );

    Ok(wallpapers)
}

fn generate_thumbnail(path: &Path) -> Result<(Vec<u8>, u32, u32), String> {
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
    // Use JPEG with quality 80 for fast encoding and compact disk size
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 80);
    encoder
        .encode_image(&thumb)
        .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

    Ok((buf.into_inner(), width, height))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_cache_key_generation() {
        let path = Path::new("C:\\Users\\test\\image.jpg");
        let mtime1 = SystemTime::UNIX_EPOCH + Duration::from_secs(1000);
        let mtime2 = SystemTime::UNIX_EPOCH + Duration::from_secs(2000);

        let key1 = cache_key(path, mtime1);
        let key2 = cache_key(path, mtime1);
        let key3 = cache_key(path, mtime2);

        assert_eq!(key1, key2);
        assert_ne!(key1, key3);
        assert!(key1.ends_with("_1000.jpg"));
        assert!(key3.ends_with("_2000.jpg"));
    }

    #[test]
    fn test_scan_directory_cache_hit_and_miss() {
        let temp_dir = std::env::temp_dir().join(format!(
            "carousel_test_{}",
            std::time::SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let wall_dir = temp_dir.join("wallpapers");
        let cache_dir = temp_dir.join("cache");
        fs::create_dir_all(&wall_dir).unwrap();
        fs::create_dir_all(&cache_dir).unwrap();

        // Create a test PNG image (100x80 red rectangle)
        let img = image::RgbImage::from_fn(100, 80, |_x, _y| image::Rgb([255, 0, 0]));
        let img_path = wall_dir.join("test_wallpaper.png");
        img.save(&img_path).unwrap();

        // Scan 1: Cache miss
        let res1 = scan_directory(wall_dir.to_str().unwrap(), &cache_dir).expect("scan 1 failed");
        assert_eq!(res1.len(), 1);
        assert_eq!(res1[0].filename, "test_wallpaper.png");
        assert_eq!(res1[0].width, 100);
        assert_eq!(res1[0].height, 80);
        let thumb_path = PathBuf::from(&res1[0].thumbnail);
        assert!(thumb_path.exists());
        assert!(thumb_path.is_file());
        assert!(fs::metadata(&thumb_path).unwrap().len() > 0);

        // Verify the cached image can be decoded and dimensions fit within 360x225
        let cached_img = image::open(&thumb_path).expect("failed to open cached thumbnail");
        assert!(cached_img.width() <= THUMB_WIDTH);
        assert!(cached_img.height() <= THUMB_HEIGHT);

        // Scan 2: Cache hit
        let res2 = scan_directory(wall_dir.to_str().unwrap(), &cache_dir).expect("scan 2 failed");
        assert_eq!(res2.len(), 1);
        assert_eq!(res2[0].thumbnail, res1[0].thumbnail);
        assert_eq!(res2[0].width, 100);
        assert_eq!(res2[0].height, 80);

        // Clean up
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
