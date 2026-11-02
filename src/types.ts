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

export type StyleflowMode =
  | 'depth'
  | 'geometric'
  | 'wall'
  | 'sandy'
  | 'hand'
  | 'collection'
  | 'duel';
export type RollableMode = 'carousel' | 'shard' | 'card' | StyleflowMode;
export type DisplayMode = RollableMode | 'random';
export type GeometricTile = 'hexagon' | 'triangle' | 'diamond' | 'rhombus';
export type GeometricCurve = 'flat' | 'arc' | 'wave' | 's' | 'cylinder';
export type WallLayout = 'uniform' | 'brick' | 'masonry' | 'justified' | 'editorial' | 'cylinder';
export type BlurMode = 'fullscreen' | 'window';
export type BlurSource = 'screen' | 'wallpaper';

export interface AppConfig {
  shortcut: string;
  wallpaper_directory: string;
  autostart?: boolean;
  autostart_prompted?: boolean;
  display_mode?: DisplayMode;
  geometric_tile?: GeometricTile;
  geometric_curve?: GeometricCurve;
  wall_layout?: WallLayout;
  blur_background?: boolean;
  blur_mode?: BlurMode;
  blur_source?: BlurSource;
  last_wallpaper?: string | null;
  wallpaper_engine_enabled?: boolean;
  wallpaper_engine_directory?: string;
}

