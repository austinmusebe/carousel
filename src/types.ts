export interface ColorScore {
  color: string;
  percentage: number;
}

export interface WallpaperEntry {
  filename: string;
  path: string;
  thumbnail: string; // absolute file path to cached JPEG on disk
  width: number;
  height: number;
  file_size: number; // bytes
  primary_color?: string | null;
  colors?: ColorScore[];
}

export type DisplayMode = 'carousel' | 'shard';
export type BlurMode = 'fullscreen' | 'window';
export type BlurSource = 'screen' | 'wallpaper';

export interface AppConfig {
  shortcut: string;
  wallpaper_directory: string;
  autostart?: boolean;
  autostart_prompted?: boolean;
  display_mode?: DisplayMode;
  blur_background?: boolean;
  blur_mode?: BlurMode;
  blur_source?: BlurSource;
  last_wallpaper?: string | null;
}

