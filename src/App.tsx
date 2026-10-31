import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import SetupScreen from './components/SetupScreen';
import SettingsScreen from './components/SettingsScreen';
import AutostartPromptModal from './components/AutostartPromptModal';
import Coverflow from './components/Coverflow';
import Shardflow from './components/Shardflow';
import Cardflow from './components/Cardflow';
import Styleflow from './components/Styleflow';
import { useWallpapers } from './hooks/useWallpapers';
import { useKeyboardActions } from './hooks/useKeyboardActions';
import {
  getConfig,
  setWallpaper,
  logFrontend,
  getBackdrop,
  hasWallpaperSource,
  wallpaperSourceKey,
} from './lib/tauri';
import { filterAndSortWallpapers } from './lib/colorFilter';
import { isStyleflowMode, parseDisplayMode, rollStyle } from './lib/styleLayouts';
import type { StyleRoll } from './lib/styleLayouts';
import type {
  AppConfig,
  WallpaperEntry,
  DisplayMode,
  BlurMode,
  BlurSource,
  GeometricTile,
  GeometricCurve,
  WallLayout,
} from './types';
import './App.css';

export default function App() {
  if (window.location.hash === '#settings') {
    return <SettingsScreen />;
  }

  const [hasDirectory, setHasDirectory] = useState<boolean | null>(null);
  const [showAutostartPrompt, setShowAutostartPrompt] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('shard');
  const [geometricTile, setGeometricTile] = useState<GeometricTile>('hexagon');
  const [geometricCurve, setGeometricCurve] = useState<GeometricCurve>('flat');
  const [wallLayout, setWallLayout] = useState<WallLayout>('uniform');
  const [blurBackground, setBlurBackground] = useState<boolean>(false);
  const [blurMode, setBlurMode] = useState<BlurMode>('fullscreen');
  const [blurSource, setBlurSource] = useState<BlurSource>('wallpaper');
  const [backdropImage, setBackdropImage] = useState<string | null>(null);
  const [lastWallpaper, setLastWallpaper] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const { images, loading, error, refresh, hasScanned } = useWallpapers(false);
  const hasTriggeredScanRef = useRef(false);
  const currentDirRef = useRef<string | null>(null);
  const errorRef = useRef<string | null>(null);
  errorRef.current = error;
  const imageCountRef = useRef(0);
  imageCountRef.current = images.length;

  const styleRollRef = useRef<StyleRoll | null>(null);

  const applyStyleConfig = useCallback((config: AppConfig, reroll = false) => {
    const mode = parseDisplayMode(config.display_mode);
    if (mode === 'random') {
      if (reroll || !styleRollRef.current) {
        styleRollRef.current = rollStyle(styleRollRef.current?.mode);
      }
      const roll = styleRollRef.current;
      logFrontend('INFO', `[App] Random style: ${roll.mode}`);
      setDisplayMode(roll.mode);
      setGeometricTile(roll.tile);
      setGeometricCurve(roll.curve);
      setWallLayout(roll.wall);
      return;
    }

    styleRollRef.current = null;
    setDisplayMode(mode);
    if (config.geometric_tile) setGeometricTile(config.geometric_tile);
    if (config.geometric_curve) setGeometricCurve(config.geometric_curve);
    if (config.wall_layout) setWallLayout(config.wall_layout);
  }, []);

  const filteredImages = useMemo(() => {
    return filterAndSortWallpapers(images, selectedColor);
  }, [images, selectedColor]);

  // Listen for backdrop updates from backend
  useEffect(() => {
    const unlistenPromise = listen<string>('backdrop-updated', (event) => {
      if (event.payload) {
        setBackdropImage(event.payload);
      } else {
        getBackdrop()
          .then((img) => {
            if (img) setBackdropImage(img);
          })
          .catch(() => {});
      }
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Check config and backdrop on mount
  useEffect(() => {
    logFrontend('INFO', `[App] Mounted. hash='${window.location.hash}'`);
    getBackdrop()
      .then((img) => {
        if (img) setBackdropImage(img);
      })
      .catch(() => {});

    getConfig()
      .then((config) => {
        logFrontend(
          'INFO',
          `[App] Loaded config: dir='${config.wallpaper_directory}', shortcut='${config.shortcut}', display_mode='${config.display_mode}', blur_background=${config.blur_background}, blur_mode='${config.blur_mode}', autostart_prompted=${config.autostart_prompted}`
        );
        const valid = hasWallpaperSource(config);
        setHasDirectory(valid);
        currentDirRef.current = wallpaperSourceKey(config);
        applyStyleConfig(config);
        if (typeof config.blur_background === 'boolean') {
          setBlurBackground(config.blur_background);
        }
        if (config.blur_mode) {
          setBlurMode(config.blur_mode);
        }
        if (config.blur_source) {
          setBlurSource(config.blur_source);
        }
        if (config.last_wallpaper) {
          setLastWallpaper(config.last_wallpaper);
        }
        if (valid && !config.autostart_prompted) {
          setShowAutostartPrompt(true);
        }

        // If the window was shown immediately on launch (missing directory or first-launch prompt),
        // trigger scan immediately. If !valid, SetupScreen handles it once directory is selected.
        const needsFirstLaunchPrompt = !config.autostart_prompted;
        if (valid && needsFirstLaunchPrompt && !hasTriggeredScanRef.current) {
          logFrontend('INFO', '[App] Window shown immediately on first launch, triggering initial scan');
          hasTriggeredScanRef.current = true;
          refresh();
        }
      })
      .catch((e) => {
        logFrontend('ERROR', `[App] Failed to load config: ${e}`);
        setHasDirectory(false);
      });
  }, [refresh, applyStyleConfig]);

  // Update display mode, backdrop, and reset to last wallpaper on window focus / show
  useEffect(() => {
    const handleReopen = (isShow: boolean) => {
      setSelectedColor(null);
      getBackdrop()
        .then((img) => {
          if (img) setBackdropImage(img);
        })
        .catch(() => {});

      getConfig()
        .then((config) => {
          if (config.last_wallpaper !== undefined) {
            setLastWallpaper(config.last_wallpaper);
          }
          applyStyleConfig(config, isShow);
          if (typeof config.blur_background === 'boolean') {
            setBlurBackground(config.blur_background);
          }
          if (config.blur_mode) {
            setBlurMode(config.blur_mode);
          }
          if (config.blur_source) {
            setBlurSource(config.blur_source);
          }
          window.dispatchEvent(
            new CustomEvent('reset-to-last-wallpaper', {
              detail: { lastWallpaper: config.last_wallpaper },
            })
          );

          const valid = hasWallpaperSource(config);
          const sourceKey = wallpaperSourceKey(config);

          const dirChanged =
            currentDirRef.current !== null &&
            sourceKey !== currentDirRef.current;
          currentDirRef.current = sourceKey;

          if (valid) {
            setHasDirectory(true);
            const shouldScan = !hasTriggeredScanRef.current || dirChanged || errorRef.current !== null;
            if (shouldScan) {
              logFrontend(
                'INFO',
                `[App] Window revealed / directory changed -> triggering wallpaper scan (triggered=${hasTriggeredScanRef.current}, dirChanged=${dirChanged}, hadError=${errorRef.current !== null})`
              );
              hasTriggeredScanRef.current = true;
              refresh();
            } else if (isShow) {
              // Picks up wallpapers added while hidden, such as new Workshop subscriptions
              const previousCount = imageCountRef.current;
              refresh(true).then((result) => {
                if (result && result.length !== previousCount) {
                  setTimeout(() => {
                    window.dispatchEvent(
                      new CustomEvent('reset-to-last-wallpaper', {
                        detail: { lastWallpaper: config.last_wallpaper },
                      })
                    );
                  }, 50);
                }
              });
            }
          }
        })
        .catch(() => {});
    };

    // Focus also fires while the gallery stays open, so only a real show re-rolls Random
    const handleFocus = () => handleReopen(false);
    window.addEventListener('focus', handleFocus);
    const unlistenPromise = listen('window-shown', () => handleReopen(true));

    return () => {
      window.removeEventListener('focus', handleFocus);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refresh, applyStyleConfig]);

  const handleDirectorySet = useCallback(() => {
    setHasDirectory(true);
    hasTriggeredScanRef.current = true;
    getConfig()
      .then((cfg) => {
        currentDirRef.current = wallpaperSourceKey(cfg);
      })
      .catch(() => {});
    refresh();
  }, [refresh]);

  const handleSetWallpaper = useCallback(async (entry: WallpaperEntry) => {
    try {
      await setWallpaper(entry);
      setLastWallpaper(entry.path);
      await getCurrentWindow().hide();
    } catch (e) {
      console.error('Failed to set wallpaper:', e);
    }
  }, []);

  // Get current active entry for Enter key
  const handleEnterKey = useCallback(() => {
    if (showAutostartPrompt) return;
    // We need the currently active swiper index. 
    // The Coverflow component manages this internally.
    // We'll use a ref approach — for now, the Enter key
    // triggers the wallpaper set for the active slide.
    // This is handled by dispatching a custom event that Coverflow listens to.
    window.dispatchEvent(new CustomEvent('set-active-wallpaper'));
  }, [showAutostartPrompt]);

  const handleRefresh = useCallback(() => {
    return refresh(true);
  }, [refresh]);

  useKeyboardActions(handleEnterKey);

  // Loading config check
  if (hasDirectory === null) {
    return <div className="app-loading" />;
  }

  // No directory configured — show setup screen
  if (!hasDirectory) {
    return <SetupScreen onDirectorySet={handleDirectorySet} />;
  }

  // Loading wallpapers
  if (loading || (!hasScanned && hasDirectory)) {
    return (
      <div className="app-loading">
        <div className="loading-spinner" />
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="app-error">
        <p>Error: {error}</p>
        <button onClick={() => refresh()}>Retry</button>
      </div>
    );
  }

  return (
    <>
      {showAutostartPrompt && (
        <AutostartPromptModal onDone={() => setShowAutostartPrompt(false)} />
      )}
      {isStyleflowMode(displayMode) ? (
        <Styleflow
          mode={displayMode}
          geometricTile={geometricTile}
          geometricCurve={geometricCurve}
          wallLayout={wallLayout}
          images={filteredImages}
          onSetWallpaper={handleSetWallpaper}
          onRefresh={handleRefresh}
          blurBackground={blurBackground}
          blurMode={blurMode}
          blurSource={blurSource}
          backdropImage={backdropImage}
          lastWallpaper={lastWallpaper}
          selectedColor={selectedColor}
          onSelectColor={setSelectedColor}
        />
      ) : displayMode === 'card' ? (
        <Cardflow
          images={filteredImages}
          onSetWallpaper={handleSetWallpaper}
          onRefresh={handleRefresh}
          blurBackground={blurBackground}
          blurMode={blurMode}
          blurSource={blurSource}
          backdropImage={backdropImage}
          lastWallpaper={lastWallpaper}
          selectedColor={selectedColor}
          onSelectColor={setSelectedColor}
        />
      ) : displayMode === 'shard' ? (
        <Shardflow
          images={filteredImages}
          onSetWallpaper={handleSetWallpaper}
          onRefresh={handleRefresh}
          blurBackground={blurBackground}
          blurMode={blurMode}
          blurSource={blurSource}
          backdropImage={backdropImage}
          lastWallpaper={lastWallpaper}
          selectedColor={selectedColor}
          onSelectColor={setSelectedColor}
        />
      ) : (
        <Coverflow
          images={filteredImages}
          onSetWallpaper={handleSetWallpaper}
          onRefresh={handleRefresh}
          blurBackground={blurBackground}
          blurMode={blurMode}
          blurSource={blurSource}
          backdropImage={backdropImage}
          lastWallpaper={lastWallpaper}
          selectedColor={selectedColor}
          onSelectColor={setSelectedColor}
        />
      )}
    </>
  );
}
