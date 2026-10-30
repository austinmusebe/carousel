import { useState, useEffect, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import SetupScreen from './components/SetupScreen';
import SettingsScreen from './components/SettingsScreen';
import AutostartPromptModal from './components/AutostartPromptModal';
import Coverflow from './components/Coverflow';
import Shardflow from './components/Shardflow';
import { useWallpapers } from './hooks/useWallpapers';
import { useKeyboardActions } from './hooks/useKeyboardActions';
import { getConfig, setWallpaper, logFrontend, getBackdrop } from './lib/tauri';
import type { WallpaperEntry, DisplayMode, BlurMode, BlurSource } from './types';
import './App.css';

export default function App() {
  if (window.location.hash === '#settings') {
    return <SettingsScreen />;
  }

  const [hasDirectory, setHasDirectory] = useState<boolean | null>(null);
  const [showAutostartPrompt, setShowAutostartPrompt] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('shard');
  const [blurBackground, setBlurBackground] = useState<boolean>(false);
  const [blurMode, setBlurMode] = useState<BlurMode>('fullscreen');
  const [blurSource, setBlurSource] = useState<BlurSource>('wallpaper');
  const [backdropImage, setBackdropImage] = useState<string | null>(null);
  const [lastWallpaper, setLastWallpaper] = useState<string | null>(null);
  const { images, loading, error, refresh } = useWallpapers();

  // Listen for backdrop updates from backend
  useEffect(() => {
    const unlistenPromise = listen('backdrop-updated', () => {
      getBackdrop()
        .then((img) => {
          if (img) setBackdropImage(img);
        })
        .catch(() => {});
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
        const valid =
          config.wallpaper_directory !== '' &&
          config.wallpaper_directory !== null;
        setHasDirectory(valid);
        if (config.display_mode === 'carousel') {
          setDisplayMode('carousel');
        } else {
          setDisplayMode('shard');
        }
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
      })
      .catch((e) => {
        logFrontend('ERROR', `[App] Failed to load config: ${e}`);
        setHasDirectory(false);
      });
  }, []);

  // Update display mode, backdrop, and reset to last wallpaper on window focus / show
  useEffect(() => {
    const handleReopen = () => {
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
          if (config.display_mode) {
            setDisplayMode(config.display_mode === 'shard' ? 'shard' : 'carousel');
          }
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
        })
        .catch(() => {});
    };

    window.addEventListener('focus', handleReopen);
    const unlistenPromise = listen('window-shown', handleReopen);

    return () => {
      window.removeEventListener('focus', handleReopen);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const handleDirectorySet = useCallback(() => {
    setHasDirectory(true);
    refresh();
  }, [refresh]);

  const handleSetWallpaper = useCallback(async (entry: WallpaperEntry) => {
    try {
      await setWallpaper(entry.path);
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
          blurSource={blurSource}
          backdropImage={backdropImage}
          lastWallpaper={lastWallpaper}
        />
      ) : (
        <Coverflow
          images={images}
          onSetWallpaper={handleSetWallpaper}
          onRefresh={handleRefresh}
          blurBackground={blurBackground}
          blurMode={blurMode}
          blurSource={blurSource}
          backdropImage={backdropImage}
          lastWallpaper={lastWallpaper}
        />
      )}
    </>
  );
}
