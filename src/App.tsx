import { useState, useEffect, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import SetupScreen from './components/SetupScreen';
import SettingsScreen from './components/SettingsScreen';
import AutostartPromptModal from './components/AutostartPromptModal';
import Coverflow from './components/Coverflow';
import Shardflow from './components/Shardflow';
import { useWallpapers } from './hooks/useWallpapers';
import { useKeyboardActions } from './hooks/useKeyboardActions';
import { getConfig, setWallpaper, logFrontend } from './lib/tauri';
import type { WallpaperEntry, DisplayMode, BlurMode } from './types';
import './App.css';

export default function App() {
  if (window.location.hash === '#settings') {
    return <SettingsScreen />;
  }

  const [hasDirectory, setHasDirectory] = useState<boolean | null>(null);
  const [showAutostartPrompt, setShowAutostartPrompt] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('carousel');
  const [blurBackground, setBlurBackground] = useState<boolean>(false);
  const [blurMode, setBlurMode] = useState<BlurMode>('fullscreen');
  const { images, loading, error, refresh } = useWallpapers();

  // Check config on mount
  useEffect(() => {
    logFrontend('INFO', `[App] Mounted. hash='${window.location.hash}'`);
    getConfig()
      .then((config) => {
        logFrontend(
          'INFO',
          `[App] Loaded config: dir='${config.wallpaper_directory}', shortcut='${config.shortcut}', display_mode='${config.display_mode}', blur_background=${config.blur_background}, blur_mode='${config.blur_mode}', autostart_prompted=${config.autostart_prompted}`
        );
        const valid =
          config.wallpaper_directory !== '' &&
          config.wallpaper_directory !== null;
        setHasDirectory(valid);
        if (config.display_mode === 'shard') {
          setDisplayMode('shard');
        } else {
          setDisplayMode('carousel');
        }
        if (typeof config.blur_background === 'boolean') {
          setBlurBackground(config.blur_background);
        }
        if (config.blur_mode) {
          setBlurMode(config.blur_mode);
        }
        if (valid && !config.autostart_prompted) {
          setShowAutostartPrompt(true);
        }
      })
      .catch((e) => {
        logFrontend('ERROR', `[App] Failed to load config: ${e}`);
        setHasDirectory(false);
      });
  }, []);

  // Update display mode and settings on window focus
  useEffect(() => {
    const handleFocus = () => {
      getConfig()
        .then((config) => {
          if (config.display_mode) {
            setDisplayMode(config.display_mode === 'shard' ? 'shard' : 'carousel');
          }
          if (typeof config.blur_background === 'boolean') {
            setBlurBackground(config.blur_background);
          }
          if (config.blur_mode) {
            setBlurMode(config.blur_mode);
          }
        })
        .catch(() => {});
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const handleDirectorySet = useCallback(() => {
    setHasDirectory(true);
    refresh();
  }, [refresh]);

  const handleSetWallpaper = useCallback(async (entry: WallpaperEntry) => {
    try {
      await setWallpaper(entry.path);
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
  if (loading) {
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
      {displayMode === 'shard' ? (
        <Shardflow
          images={images}
          onSetWallpaper={handleSetWallpaper}
          onRefresh={handleRefresh}
          blurBackground={blurBackground}
          blurMode={blurMode}
        />
      ) : (
        <Coverflow
          images={images}
          onSetWallpaper={handleSetWallpaper}
          onRefresh={handleRefresh}
          blurBackground={blurBackground}
          blurMode={blurMode}
        />
      )}
    </>
  );
}
