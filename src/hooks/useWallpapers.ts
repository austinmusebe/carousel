import { useState, useEffect, useCallback, useRef } from 'react';
import { scanWallpapers, logFrontend } from '../lib/tauri';
import type { WallpaperEntry } from '../types';

export interface UseWallpapersOptions {
  autoScan?: boolean;
}

export function useWallpapers(autoScanOrOptions: boolean | UseWallpapersOptions = false) {
  const autoScan =
    typeof autoScanOrOptions === 'boolean'
      ? autoScanOrOptions
      : Boolean(autoScanOrOptions?.autoScan);

  const [images, setImages] = useState<WallpaperEntry[]>([]);
  const [loading, setLoading] = useState(autoScan);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const inFlightScanRef = useRef<Promise<WallpaperEntry[] | null> | null>(null);

  const refresh = useCallback(async (silent = false): Promise<WallpaperEntry[] | null> => {
    if (inFlightScanRef.current) {
      logFrontend('INFO', '[useWallpapers] Scan already in-flight, returning existing promise');
      return inFlightScanRef.current;
    }

    logFrontend('INFO', `[useWallpapers] refresh() called (silent=${silent})`);
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    const scanPromise = (async () => {
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
        setHasScanned(true);
        inFlightScanRef.current = null;
      }
    })();

    inFlightScanRef.current = scanPromise;
    return scanPromise;
  }, []);

  useEffect(() => {
    if (autoScan) {
      refresh();
    }
  }, [autoScan, refresh]);

  return { images, loading, refreshing, error, refresh, hasScanned };
}
