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
  project?: string | null; // project.json for Wallpaper Engine entries; path is then its preview
  project_type?: string | null;
}

export type DisplayMode = 'carousel' | 'shard' | 'card';
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
  wallpaper_engine_enabled?: boolean;
  wallpaper_engine_directory?: string;
}

