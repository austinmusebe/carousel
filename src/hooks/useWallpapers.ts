import { useState, useEffect, useCallback } from 'react';
import { scanWallpapers, logFrontend } from '../lib/tauri';
import type { WallpaperEntry } from '../types';

export function useWallpapers() {
  const [images, setImages] = useState<WallpaperEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false): Promise<WallpaperEntry[] | null> => {
    logFrontend('INFO', `[useWallpapers] refresh() called (silent=${silent})`);
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const result = await scanWallpapers();
      logFrontend('INFO', `[useWallpapers] scanWallpapers returned ${result.length} wallpapers`);
      setImages(result);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logFrontend('ERROR', `[useWallpapers] scanWallpapers failed: ${msg}`);
      setError(msg);
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { images, loading, refreshing, error, refresh };
}
