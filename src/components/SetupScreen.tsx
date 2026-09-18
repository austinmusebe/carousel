import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { setWallpaperDirectory, setAutostart, setPreventHide } from '../lib/tauri';
import './SetupScreen.css';

interface SetupScreenProps {
  onDirectorySet: () => void;
}

export default function SetupScreen({ onDirectorySet }: SetupScreenProps) {
  const [step, setStep] = useState<'folder' | 'autostart'>('folder');
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
        setStep('autostart');
      } else {
        await setPreventHide(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await setPreventHide(false);
    } finally {
      setLoading(false);
    }
  };

  const handleAutostartChoice = async (enable: boolean) => {
    setLoading(true);
    setError(null);
    try {
      await setAutostart(enable);
      await setPreventHide(false);
      onDirectorySet();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  };

  if (step === 'autostart') {
    return (
      <div className="setup-screen">
        <div className="setup-card">
          <div className="setup-icon">🚀</div>
          <h1 className="setup-title">Start with Windows?</h1>
          <p className="setup-description">
            Launch Carousel Wallpaper Changer automatically when Windows boots.
            It sits quietly in your system tray so you can press <strong>Alt+W</strong> anytime.
          </p>
          <div className="setup-actions">
            <button
              className="setup-button setup-button-primary"
              onClick={() => handleAutostartChoice(true)}
              disabled={loading}
              autoFocus
            >
              {loading ? 'Saving…' : 'Yes, start with Windows'}
            </button>
            <button
              className="setup-button setup-button-secondary"
              onClick={() => handleAutostartChoice(false)}
              disabled={loading}
            >
              No, maybe later
            </button>
          </div>
          <p className="setup-hint">You can change this anytime from Settings.</p>
          {error && <p className="setup-error">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-icon">🖼️</div>
        <h1 className="setup-title">Carousel Wallpaper Changer</h1>
        <p className="setup-description">
          Select a folder containing your wallpaper images to get started.
        </p>
        <button
          className="setup-button setup-button-primary"
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
