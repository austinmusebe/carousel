use image::codecs::gif::GifDecoder;
use image::{AnimationDecoder, DynamicImage, ImageReader};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufReader, Cursor};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::SystemTime;

const THUMB_WIDTH: u32 = 360;
const THUMB_HEIGHT: u32 = 225;
const SUPPORTED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp"];
/// Average 0-255 brightness below which a GIF frame counts as a blank fade-in
const MIN_FRAME_LUMA: f64 = 12.0;
/// Bump when GIF frame selection changes, so cached GIF thumbnails are rebuilt
const GIF_THUMBNAIL_VERSION: u8 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorScore {
    pub color: String,   // e.g. "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "white", "gray", "black", "brown"
    pub percentage: f32, // 0.0 to 1.0 (fraction of sampled pixels)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WallpaperEntry {
    pub filename: String,
    pub path: String,
    /// Absolute path to cached thumbnail JPEG file
    pub thumbnail: String,
    pub width: u32,
    pub height: u32,
    pub file_size: u64, // bytes
    pub primary_color: Option<String>,
    pub colors: Vec<ColorScore>,
    /// Absolute path to project.json for Wallpaper Engine entries; `path` is then its preview
    pub project: Option<String>,
    /// Wallpaper Engine project type, e.g. "scene", "video", "web"
    pub project_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailMeta {
    pub width: u32,
    pub height: u32,
    pub primary_color: Option<String>,
    pub colors: Vec<ColorScore>,
}

struct GeneratedThumbnail {
    bytes: Vec<u8>,
    width: u32,
    height: u32,
    primary_color: Option<String>,
    colors: Vec<ColorScore>,
}

pub fn clean_path(path: &Path) -> Option<String> {
    let abs_path = fs::canonicalize(path).ok()?;
    let s = abs_path.to_string_lossy();
    Some(s.strip_prefix(r"\\?\").unwrap_or(&s).to_string())
}

fn is_gif(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("gif"))
}

fn average_luma(img: &DynamicImage) -> f64 {
    let luma = img.to_luma8();
    let total: u64 = luma.as_raw().iter().map(|value| *value as u64).sum();
    total as f64 / luma.as_raw().len().max(1) as f64
}

/// The first frame with visible content, or the brightest one if none qualifies.
/// Many animated previews open on a black fade-in frame.
fn representative_gif_frame(path: &Path) -> Result<DynamicImage, String> {
    let file = fs::File::open(path).map_err(|e| format!("Failed to open image: {}", e))?;
    let decoder = GifDecoder::new(BufReader::new(file))
        .map_err(|e| format!("Failed to read GIF: {}", e))?;

    let mut brightest: Option<(f64, DynamicImage)> = None;
    for frame in decoder.into_frames() {
        let frame = frame.map_err(|e| format!("Failed to decode GIF frame: {}", e))?;
        let img = DynamicImage::ImageRgba8(frame.into_buffer());
        let luma = average_luma(&img);
        if luma >= MIN_FRAME_LUMA {
            return Ok(img);
        }
        if brightest.as_ref().is_none_or(|(best, _)| luma > *best) {
            brightest = Some((luma, img));
        }
    }

    brightest
        .map(|(_, img)| img)
        .ok_or_else(|| "GIF has no frames".to_string())
}

fn cache_key(path: &Path, mtime: SystemTime) -> String {
    let mut hasher = DefaultHasher::new();
    path.to_string_lossy().hash(&mut hasher);
    if is_gif(path) {
        GIF_THUMBNAIL_VERSION.hash(&mut hasher);
    }
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

fn classify_pixel(r: u8, g: u8, b: u8) -> &'static str {
    let rf = r as f32 / 255.0;
    let gf = g as f32 / 255.0;
    let bf = b as f32 / 255.0;

    let cmax = rf.max(gf).max(bf);
    let cmin = rf.min(gf).min(bf);
    let delta = cmax - cmin;

    let v = cmax;
    let s = if cmax > 0.0 { delta / cmax } else { 0.0 };

    // 1. Low brightness (< 0.13): "black"
    if v < 0.13 {
        return "black";
    }

    // 2. High brightness (> 0.85) and low saturation (< 0.18): "white"
    if v > 0.85 && s < 0.18 {
        return "white";
    }

    // 3. Low saturation (< 0.16): "gray"
    if s < 0.16 {
        return "gray";
    }

    // Calculate hue in degrees [0, 360)
    let h = if delta <= f32::EPSILON {
        0.0
    } else if (cmax - rf).abs() <= f32::EPSILON {
        60.0 * (((gf - bf) / delta).rem_euclid(6.0))
    } else if (cmax - gf).abs() <= f32::EPSILON {
        60.0 * (((bf - rf) / delta) + 2.0)
    } else {
        60.0 * (((rf - gf) / delta) + 4.0)
    };

    // 4. Low-medium brightness (< 0.45) with warm hues (15..45) and medium saturation: "brown"
    if (15.0..45.0).contains(&h) && v < 0.45 {
        return "brown";
    }

    // 5. Hues (0..360)
    if (0.0..15.0).contains(&h) || (345.0..=360.0).contains(&h) {
        "red"
    } else if (15.0..45.0).contains(&h) {
        "orange"
    } else if (45.0..70.0).contains(&h) {
        "yellow"
    } else if (70.0..165.0).contains(&h) {
        "green"
    } else if (165.0..200.0).contains(&h) {
        "teal"
    } else if (200.0..260.0).contains(&h) {
        "blue"
    } else if (260.0..305.0).contains(&h) {
        "purple"
    } else if (305.0..345.0).contains(&h) {
        "pink"
    } else {
        "red"
    }
}

fn is_neutral_color(c: &str) -> bool {
    matches!(c, "black" | "white" | "gray")
}

pub fn analyze_image_colors(img: &image::DynamicImage) -> (Option<String>, Vec<ColorScore>) {
    let rgb = img.to_rgb8();
    let width = rgb.width();
    let height = rgb.height();
    if width == 0 || height == 0 {
        return (None, Vec::new());
    }

    let mut counts: HashMap<&'static str, usize> = HashMap::new();
    let mut total_samples = 0usize;

    // Sample across thumbnail stepping by 2 pixels for sub-millisecond execution
    for y in (0..height).step_by(2) {
        for x in (0..width).step_by(2) {
            let p = rgb.get_pixel(x, y);
            let color = classify_pixel(p[0], p[1], p[2]);
            *counts.entry(color).or_insert(0) += 1;
            total_samples += 1;
        }
    }

    if total_samples == 0 {
        return (None, Vec::new());
    }

    let mut raw_scores: Vec<ColorScore> = counts
        .into_iter()
        .map(|(color, count)| ColorScore {
            color: color.to_string(),
            percentage: ((count as f32 / total_samples as f32) * 1000.0).round() / 1000.0,
        })
        .collect();

    // Sort by percentage descending
    raw_scores.sort_by(|a, b| {
        b.percentage
            .partial_cmp(&a.percentage)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Filter out buckets below 8% (0.08) so only genuine colors are returned
    let mut colors: Vec<ColorScore> = raw_scores
        .iter()
        .filter(|c| c.percentage >= 0.08)
        .cloned()
        .collect();

    if colors.is_empty() {
        if let Some(top) = raw_scores.first() {
            colors.push(top.clone());
        }
    }

    // primary_color is the top non-neutral color (or top color if mostly black/white/gray)
    let primary_color = colors
        .iter()
        .find(|c| !is_neutral_color(&c.color))
        .or_else(|| colors.first())
        .map(|c| c.color.clone());

    (primary_color, colors)
}

pub fn scan_directory(dir_path: &str, cache_dir: &Path) -> Result<Vec<WallpaperEntry>, String> {
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

    scan_files(&files, cache_dir)
}

pub fn scan_files(files: &[PathBuf], cache_dir: &Path) -> Result<Vec<WallpaperEntry>, String> {
    let scan_start = std::time::Instant::now();

    if !cache_dir.is_dir() {
        fs::create_dir_all(cache_dir)
            .map_err(|e| format!("Failed to create cache directory: {}", e))?;
    }

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

            let abs_path = clean_path(path)?;

            let metadata = match fs::metadata(path) {
                Ok(m) => m,
                Err(_) => return None,
            };

            let file_size = metadata.len();
            let mtime = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);

            let cache_filename = cache_key(Path::new(&abs_path), mtime);
            let cache_path = cache_dir.join(cache_filename);
            let meta_path = cache_path.with_extension("meta");

            let is_cached = cache_path.is_file()
                && fs::metadata(&cache_path).map(|m| m.len() > 0).unwrap_or(false);

            let (width, height, primary_color, colors) = if is_cached {
                // Check if .meta exists and can be parsed directly
                let cached_meta = if meta_path.is_file() {
                    fs::read_to_string(&meta_path)
                        .ok()
                        .and_then(|s| serde_json::from_str::<ThumbnailMeta>(&s).ok())
                } else {
                    None
                };

                if let Some(meta) = cached_meta {
                    cache_hits.fetch_add(1, Ordering::Relaxed);
                    (meta.width, meta.height, meta.primary_color, meta.colors)
                } else {
                    // .meta doesn't exist: open cached thumbnail .jpg, analyze colors, write .meta
                    match image::open(&cache_path) {
                        Ok(cached_thumb) => {
                            cache_hits.fetch_add(1, Ordering::Relaxed);
                            let (prim, cols) = analyze_image_colors(&cached_thumb);
                            let (w, h) = get_image_dimensions(path)
                                .unwrap_or((cached_thumb.width(), cached_thumb.height()));
                            let meta = ThumbnailMeta {
                                width: w,
                                height: h,
                                primary_color: prim.clone(),
                                colors: cols.clone(),
                            };
                            if let Ok(json) = serde_json::to_string(&meta) {
                                let _ = fs::write(&meta_path, json);
                            }
                            (w, h, prim, cols)
                        }
                        Err(_) => {
                            // Thumbnail could not be opened, regenerate
                            cache_misses.fetch_add(1, Ordering::Relaxed);
                            let gen = match generate_thumbnail(path) {
                                Ok(t) => t,
                                Err(e) => {
                                    eprintln!("Failed to generate thumbnail for {}: {}", filename, e);
                                    return None;
                                }
                            };
                            if let Err(e) = fs::write(&cache_path, &gen.bytes) {
                                eprintln!("Failed to write thumbnail cache for {}: {}", filename, e);
                                return None;
                            }
                            let meta = ThumbnailMeta {
                                width: gen.width,
                                height: gen.height,
                                primary_color: gen.primary_color.clone(),
                                colors: gen.colors.clone(),
                            };
                            if let Ok(json) = serde_json::to_string(&meta) {
                                let _ = fs::write(&meta_path, json);
                            }
                            (gen.width, gen.height, gen.primary_color, gen.colors)
                        }
                    }
                }
            } else {
                cache_misses.fetch_add(1, Ordering::Relaxed);
                let gen = match generate_thumbnail(path) {
                    Ok(t) => t,
                    Err(e) => {
                        eprintln!("Failed to generate thumbnail for {}: {}", filename, e);
                        return None;
                    }
                };

                if let Err(e) = fs::write(&cache_path, &gen.bytes) {
                    eprintln!("Failed to write thumbnail cache for {}: {}", filename, e);
                    return None;
                }

                let meta = ThumbnailMeta {
                    width: gen.width,
                    height: gen.height,
                    primary_color: gen.primary_color.clone(),
                    colors: gen.colors.clone(),
                };
                if let Ok(json) = serde_json::to_string(&meta) {
                    let _ = fs::write(&meta_path, json);
                }

                (gen.width, gen.height, gen.primary_color, gen.colors)
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
                primary_color,
                colors,
                project: None,
                project_type: None,
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

fn generate_thumbnail(path: &Path) -> Result<GeneratedThumbnail, String> {
    let img = if is_gif(path) {
        representative_gif_frame(path)?
    } else {
        ImageReader::open(path)
            .map_err(|e| format!("Failed to open image: {}", e))?
            .with_guessed_format()
            .map_err(|e| format!("Failed to guess image format: {}", e))?
            .decode()
            .map_err(|e| format!("Failed to decode image: {}", e))?
    };

    let width = img.width();
    let height = img.height();

    let thumb = img.thumbnail(THUMB_WIDTH, THUMB_HEIGHT);
    let (primary_color, colors) = analyze_image_colors(&thumb);

    let mut buf = Cursor::new(Vec::new());
    // Use JPEG with quality 80 for fast encoding and compact disk size
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 80);
    encoder
        .encode_image(&thumb)
        .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

    Ok(GeneratedThumbnail {
        bytes: buf.into_inner(),
        width,
        height,
        primary_color,
        colors,
    })
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

    fn write_gif(path: &Path, frames: &[[u8; 4]]) {
        use image::codecs::gif::GifEncoder;
        use image::{Frame, RgbaImage};

        let file = fs::File::create(path).unwrap();
        let mut encoder = GifEncoder::new(file);
        for color in frames {
            let buffer = RgbaImage::from_pixel(16, 16, image::Rgba(*color));
            encoder.encode_frame(Frame::new(buffer)).unwrap();
        }
    }

    fn temp_gif(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "carousel_gif_test_{}_{}",
            name,
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir.join("preview.gif")
    }

    #[test]
    fn test_gif_thumbnail_skips_black_first_frame() {
        let path = temp_gif("fade");
        write_gif(&path, &[[0, 0, 0, 255], [200, 30, 30, 255], [30, 30, 200, 255]]);

        let frame = representative_gif_frame(&path).unwrap();
        assert!(average_luma(&frame) >= MIN_FRAME_LUMA);
        assert_eq!(generate_thumbnail(&path).unwrap().primary_color, Some("red".to_string()));

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn test_gif_thumbnail_uses_brightest_frame_when_all_are_dark() {
        let path = temp_gif("dark");
        write_gif(&path, &[[0, 0, 0, 255], [8, 8, 8, 255], [3, 3, 3, 255]]);

        let frame = representative_gif_frame(&path).unwrap();
        assert!(average_luma(&frame) > 5.0);

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn test_gif_cache_key_differs_from_unversioned_key() {
        let mtime = SystemTime::UNIX_EPOCH + Duration::from_secs(1000);
        let gif = cache_key(Path::new("C:\\walls\\preview.gif"), mtime);

        let mut hasher = DefaultHasher::new();
        "C:\\walls\\preview.gif".to_string().hash(&mut hasher);
        let unversioned = format!("{:016x}_1000.jpg", hasher.finish());

        assert_ne!(gif, unversioned);
    }

    #[test]
    fn test_scan_directory_cache_hit_and_miss_with_meta() {
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

        // Create a test PNG image (100x80 pure red rectangle)
        let img = image::RgbImage::from_fn(100, 80, |_x, _y| image::Rgb([255, 0, 0]));
        let img_path = wall_dir.join("test_wallpaper.png");
        img.save(&img_path).unwrap();

        // Scan 1: Cache miss (generates .jpg and .meta)
        let res1 = scan_directory(wall_dir.to_str().unwrap(), &cache_dir).expect("scan 1 failed");
        assert_eq!(res1.len(), 1);
        assert_eq!(res1[0].filename, "test_wallpaper.png");
        assert_eq!(res1[0].width, 100);
        assert_eq!(res1[0].height, 80);
        assert_eq!(res1[0].primary_color, Some("red".to_string()));
        assert!(!res1[0].colors.is_empty());
        assert_eq!(res1[0].colors[0].color, "red");
        assert!((res1[0].colors[0].percentage - 1.0).abs() < 0.05);

        let thumb_path = PathBuf::from(&res1[0].thumbnail);
        assert!(thumb_path.exists());
        assert!(thumb_path.is_file());
        assert!(fs::metadata(&thumb_path).unwrap().len() > 0);

        let meta_path = thumb_path.with_extension("meta");
        assert!(meta_path.exists());
        assert!(meta_path.is_file());

        // Verify the cached image can be decoded and dimensions fit within 360x225
        let cached_img = image::open(&thumb_path).expect("failed to open cached thumbnail");
        assert!(cached_img.width() <= THUMB_WIDTH);
        assert!(cached_img.height() <= THUMB_HEIGHT);

        // Scan 2: Cache hit via .meta (zero image decoding)
        let res2 = scan_directory(wall_dir.to_str().unwrap(), &cache_dir).expect("scan 2 failed");
        assert_eq!(res2.len(), 1);
        assert_eq!(res2[0].thumbnail, res1[0].thumbnail);
        assert_eq!(res2[0].width, 100);
        assert_eq!(res2[0].height, 80);
        assert_eq!(res2[0].primary_color, Some("red".to_string()));
        assert_eq!(res2[0].colors[0].color, "red");

        // Scan 3: Cache hit without .meta (simulating upgrade: .meta deleted, .jpg exists)
        fs::remove_file(&meta_path).unwrap();
        assert!(!meta_path.exists());

        let res3 = scan_directory(wall_dir.to_str().unwrap(), &cache_dir).expect("scan 3 failed");
        assert_eq!(res3.len(), 1);
        assert_eq!(res3[0].thumbnail, res1[0].thumbnail);
        assert_eq!(res3[0].width, 100);
        assert_eq!(res3[0].height, 80);
        assert_eq!(res3[0].primary_color, Some("red".to_string()));
        assert_eq!(res3[0].colors[0].color, "red");
        // Verify .meta was written again
        assert!(meta_path.exists());

        // Clean up
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_color_classification_categories() {
        // Test all 12 categories
        assert_eq!(classify_pixel(0, 0, 0), "black");
        assert_eq!(classify_pixel(20, 20, 20), "black");
        assert_eq!(classify_pixel(255, 255, 255), "white");
        assert_eq!(classify_pixel(240, 240, 240), "white");
        assert_eq!(classify_pixel(128, 128, 128), "gray");
        assert_eq!(classify_pixel(60, 60, 60), "gray");

        // Warm brown: low-medium brightness (< 0.45) with warm hues (15..45)
        assert_eq!(classify_pixel(100, 50, 20), "brown");

        // Hues
        assert_eq!(classify_pixel(255, 0, 0), "red");
        assert_eq!(classify_pixel(255, 140, 0), "orange");
        assert_eq!(classify_pixel(255, 255, 0), "yellow");
        assert_eq!(classify_pixel(0, 255, 0), "green");
        assert_eq!(classify_pixel(0, 200, 200), "teal");
        assert_eq!(classify_pixel(0, 100, 255), "blue");
        assert_eq!(classify_pixel(150, 0, 200), "purple");
        assert_eq!(classify_pixel(255, 105, 180), "pink");
    }

    #[test]
    fn test_analyze_image_colors_priority() {
        // Image with 80% black and 20% blue
        // Expected: primary_color is "blue" (top non-neutral color)
        let img = image::DynamicImage::ImageRgb8(image::RgbImage::from_fn(100, 100, |x, _y| {
            if x < 80 {
                image::Rgb([10, 10, 10]) // black
            } else {
                image::Rgb([0, 100, 255]) // blue
            }
        }));

        let (primary, colors) = analyze_image_colors(&img);
        assert_eq!(primary, Some("blue".to_string()));
        assert!(colors.iter().any(|c| c.color == "black"));
        assert!(colors.iter().any(|c| c.color == "blue"));

        // Image with 70% black and 30% gray (monochrome)
        // Expected: primary_color is "black" (top neutral color since no non-neutral color exists)
        let mono_img = image::DynamicImage::ImageRgb8(image::RgbImage::from_fn(100, 100, |x, _y| {
            if x < 70 {
                image::Rgb([10, 10, 10]) // black
            } else {
                image::Rgb([128, 128, 128]) // gray
            }
        }));

        let (mono_primary, mono_colors) = analyze_image_colors(&mono_img);
        assert_eq!(mono_primary, Some("black".to_string()));
        assert_eq!(mono_colors[0].color, "black");
    }
}
