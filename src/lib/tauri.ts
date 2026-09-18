import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { WallpaperEntry, AppConfig } from '../types';

export { convertFileSrc };

export async function scanWallpapers(): Promise<WallpaperEntry[]> {
  return invoke<WallpaperEntry[]>('scan_wallpapers');
}

export async function setWallpaper(path: string): Promise<void> {
  return invoke('set_wallpaper', { path });
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
  autostart: boolean
): Promise<void> {
  return invoke('save_settings', { shortcut, directory, autostart });
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

