import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { WallpaperEntry, AppConfig } from '../types';

export { convertFileSrc };

export function isSamePath(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const normalize = (p: string) => p.replace(/\\/g, '/').toLowerCase();
  return normalize(a) === normalize(b);
}

export async function scanWallpapers(): Promise<WallpaperEntry[]> {
  return invoke<WallpaperEntry[]>('scan_wallpapers');
}

export function hasWallpaperSource(config: AppConfig): boolean {
  return Boolean(config.wallpaper_directory) || Boolean(config.wallpaper_engine_enabled);
}

export function wallpaperSourceKey(config: AppConfig): string {
  return [
    config.wallpaper_directory,
    config.wallpaper_engine_enabled,
    config.wallpaper_engine_directory,
  ].join('|');
}

export function pillResolution(entry: WallpaperEntry): string {
  if (entry.project) return 'Wallpaper Engine';
  return entry.width > 0 && entry.height > 0 ? `${entry.width} × ${entry.height}` : 'Image';
}

export function pillTag(entry: WallpaperEntry): string {
  if (entry.project) return entry.project_type?.toUpperCase() || 'LIVE';
  return entry.filename.split('.').pop()?.toUpperCase() || 'IMG';
}

export async function setWallpaper(entry: WallpaperEntry): Promise<void> {
  return invoke('set_wallpaper', { path: entry.path, project: entry.project ?? null });
}

export async function enableWallpaperEngine(): Promise<void> {
  return invoke('enable_wallpaper_engine');
}

export async function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>('get_config');
}

export async function setWallpaperDirectory(directory: string): Promise<void> {
  return invoke('set_wallpaper_directory', { directory });
}

export async function setPreventHide(prevent: boolean): Promise<void> {
  return invoke('set_prevent_hide', { prevent });
}

export async function saveSettings(
  shortcut: string,
  directory: string,
  autostart: boolean,
  displayMode: string = 'shard',
  blurBackground: boolean = false,
  blurMode: string = 'fullscreen',
  blurSource: string = 'wallpaper',
  wallpaperEngineEnabled: boolean = false,
  wallpaperEngineDirectory: string = '',
  geometricTile: string = 'hexagon',
  geometricCurve: string = 'flat',
  wallLayout: string = 'uniform'
): Promise<void> {
  return invoke('save_settings', {
    shortcut,
    directory,
    autostart,
    displayMode,
    blurBackground,
    blurMode,
    blurSource,
    wallpaperEngineEnabled,
    wallpaperEngineDirectory,
    geometricTile,
    geometricCurve,
    wallLayout,
  });
}

export async function isAutostartEnabled(): Promise<boolean> {
  return invoke<boolean>('is_autostart_enabled');
}

export async function setAutostart(enabled: boolean): Promise<void> {
  return invoke('set_autostart', { enabled });
}

export async function toggleMainWindow(): Promise<void> {
  return invoke('toggle_main_window');
}

export async function openSettingsWindow(): Promise<void> {
  return invoke('open_settings_window');
}

export async function getBackdrop(): Promise<string | null> {
  return invoke<string | null>('get_backdrop');
}

export async function quitApp(): Promise<void> {
  return invoke('quit_app');
}

export async function logImageSwitch(
  from: string,
  to: string,
  switchMs: number,
  width: number,
  height: number,
  fileSize: number
): Promise<void> {
  return invoke('log_image_switch', {
    from,
    to,
    switchMs,
    width,
    height,
    fileSize,
  });
}

export async function logFrontend(
  level: 'INFO' | 'WARN' | 'ERROR',
  message: string
): Promise<void> {
  console.log(`[${level}] ${message}`);
  try {
    await invoke('log_frontend', { level, message });
  } catch {
    // Ignore logging errors if backend is not ready
  }
}

