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

export type DisplayMode = 'carousel' | 'shard' | 'card' | 'vinyl';
export type BlurMode = 'fullscreen' | 'window';
export type BlurSource = 'screen' | 'wallpaper';
export type PlayerSkin = 'wood' | 'modern-black';
export type VinylSpeed = '33' | '45';

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
  vinyl_rotation?: boolean;
  vinyl_skin?: PlayerSkin;
  vinyl_speed?: VinylSpeed;
  vinyl_arm_tracking?: boolean;
}

