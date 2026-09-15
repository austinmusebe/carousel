export interface WallpaperEntry {
  filename: string;
  path: string;
  thumbnail: string; // base64-encoded PNG, no data: prefix
}

export interface AppConfig {
  shortcut: string;
  wallpaper_directory: string;
}
