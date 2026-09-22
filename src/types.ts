export interface WallpaperEntry {
  filename: string;
  path: string;
  thumbnail: string; // base64-encoded JPEG, no data: prefix
  width: number;
  height: number;
  file_size: number; // bytes
}

export type DisplayMode = 'carousel' | 'shard';

export interface AppConfig {
  shortcut: string;
  wallpaper_directory: string;
  autostart?: boolean;
  autostart_prompted?: boolean;
  display_mode?: DisplayMode;
}

