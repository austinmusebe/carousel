import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { setWallpaperDirectory, setPreventHide } from '../lib/tauri';
import './SetupScreen.css';

interface SetupScreenProps {
  onDirectorySet: () => void;
}

export default function SetupScreen({ onDirectorySet }: SetupScreenProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectFolder = async () => {
    try {
      await setPreventHide(true);
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Wallpaper Directory',
      });

      if (selected && typeof selected === 'string') {
        setLoading(true);
        setError(null);
        await setWallpaperDirectory(selected);
        onDirectorySet();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      await setPreventHide(false);
      setLoading(false);
    }
  };

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-icon">🖼️</div>
        <h1 className="setup-title">Carousel Wallpaper Changer</h1>
        <p className="setup-description">
          Select a folder containing your wallpaper images to get started.
        </p>
        <button
          className="setup-button"
          onClick={handleSelectFolder}
          disabled={loading}
          autoFocus
        >
          {loading ? 'Setting up...' : 'Choose Wallpaper Folder'}
        </button>
        {error && <p className="setup-error">{error}</p>}
      </div>
    </div>
  );
}
