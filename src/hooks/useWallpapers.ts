import { useState, useEffect, useCallback } from 'react';
import { scanWallpapers } from '../lib/tauri';
import type { WallpaperEntry } from '../types';

export function useWallpapers() {
  const [images, setImages] = useState<WallpaperEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await scanWallpapers();
      setImages(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { images, loading, error, refresh };
}
