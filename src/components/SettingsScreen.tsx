import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { getConfig, saveSettings, isAutostartEnabled, toggleMainWindow, quitApp } from '../lib/tauri';
import './SettingsScreen.css';

const SHORTCUT_PRESETS = [
  'Alt+W',
  'Ctrl+Alt+W',
  'Alt+Space',
  'Ctrl+Shift+W',
];

export default function SettingsScreen() {
  const [directory, setDirectory] = useState('');
  const [shortcut, setShortcut] = useState('Alt+W');
  const [autostart, setAutostart] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    getConfig()
      .then(async (cfg) => {
        setDirectory(cfg.wallpaper_directory || '');
        setShortcut(cfg.shortcut || 'Alt+W');
        try {
          const enabled = await isAutostartEnabled();
          setAutostart(enabled);
        } catch {
          setAutostart(cfg.autostart ?? false);
        }
      })
      .catch((err) => {
        setStatusMessage(`Failed to load config: ${err}`);
        setIsError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleBrowseFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Wallpaper Directory',
        defaultPath: directory || undefined,
      });
      if (selected && typeof selected === 'string') {
        setDirectory(selected);
      }
    } catch (err) {
      setStatusMessage(`Failed to browse folder: ${err}`);
      setIsError(true);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMessage(null);
    setIsError(false);
    try {
      await saveSettings(shortcut, directory, autostart);
      setStatusMessage('Settings saved successfully');
      setIsError(false);
      setTimeout(() => {
        setStatusMessage(null);
      }, 3000);
    } catch (err) {
      setStatusMessage(`${err}`);
      setIsError(true);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-page">
        <div className="settings-spinner-box">
          <div className="settings-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      {/* ShadCN Floating Toast */}
      {statusMessage && (
        <div className={`settings-toast ${isError ? 'toast-error' : 'toast-success'}`}>
          <div className="toast-indicator" />
          <span>{statusMessage}</span>
        </div>
      )}

      <div className="settings-content">
        {/* Header */}
        <header className="settings-header">
          <h1 className="settings-title">Settings</h1>
          <p className="settings-description">
            Manage your wallpaper directory and global activation shortcut.
          </p>
        </header>

        <div className="settings-divider" />

        {/* Section: Directory */}
        <section className="settings-section">
          <div className="section-meta">
            <label className="section-label">Wallpaper Directory</label>
            <p className="section-hint">Choose the folder that contains your desktop backgrounds.</p>
          </div>
          <div className="input-group">
            <input
              type="text"
              className="text-input"
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              placeholder="No directory selected..."
              spellCheck={false}
            />
            <button className="btn btn-outline" onClick={handleBrowseFolder}>
              Browse
            </button>
          </div>
        </section>

        {/* Section: Shortcut */}
        <section className="settings-section">
          <div className="section-meta">
            <label className="section-label">Global Shortcut</label>
            <p className="section-hint">The keyboard shortcut to toggle the wallpaper picker overlay.</p>
          </div>
          <input
            type="text"
            className="text-input shortcut-input"
            value={shortcut}
            onChange={(e) => setShortcut(e.target.value)}
            placeholder="e.g. Alt+W"
            spellCheck={false}
          />
          <div className="presets-row">
            <span className="presets-caption">Presets:</span>
            {SHORTCUT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`preset-chip ${shortcut.toLowerCase() === preset.toLowerCase() ? 'active' : ''}`}
                onClick={() => setShortcut(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        </section>

        {/* Section: Startup */}
        <section className="settings-section">
          <div className="section-meta">
            <label className="section-label">Start with Windows</label>
            <p className="section-hint">
              Automatically launch Carousel in the background when you log into Windows.
            </p>
          </div>
          <label className="switch-row">
            <div className="switch-wrapper">
              <input
                type="checkbox"
                className="switch-input"
                id="autostart-toggle"
                checked={autostart}
                onChange={(e) => setAutostart(e.target.checked)}
              />
              <span className="switch-track" />
            </div>
            <span className="switch-label-text">
              {autostart ? 'Launch on startup (enabled)' : 'Launch on startup (disabled)'}
            </span>
          </label>
        </section>
      </div>

      {/* Footer */}
      <footer className="settings-footer">
        <button className="btn btn-ghost btn-danger" onClick={() => quitApp()}>
          Quit App
        </button>

        <div className="footer-actions">
          <button className="btn btn-outline" onClick={() => toggleMainWindow()}>
            Open Picker
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </footer>
    </div>
  );
}
