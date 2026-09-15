import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { getConfig, saveSettings, toggleMainWindow, quitApp } from '../lib/tauri';
import './SettingsScreen.css';

const SHORTCUT_PRESETS = [
  'Alt+W',
  'Ctrl+Alt+W',
  'Win+W',
  'Alt+Space',
  'Ctrl+Shift+W',
];

export default function SettingsScreen() {
  const [directory, setDirectory] = useState('');
  const [shortcut, setShortcut] = useState('Alt+W');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        setDirectory(cfg.wallpaper_directory || '');
        setShortcut(cfg.shortcut || 'Alt+W');
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
      await saveSettings(shortcut, directory);
      setStatusMessage('Settings saved and shortcut re-registered!');
      setIsError(false);
    } catch (err) {
      setStatusMessage(`Error saving settings: ${err}`);
      setIsError(true);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-loading">
        <div className="settings-spinner" />
      </div>
    );
  }

  return (
    <div className="settings-container">
      <header className="settings-header">
        <h1>Carousel Settings</h1>
        <p className="settings-subtitle">Manage wallpaper folder & global shortcut</p>
      </header>

      <div className="settings-section">
        <label className="settings-label">Wallpaper Directory</label>
        <div className="settings-input-group">
          <input
            type="text"
            className="settings-input"
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            placeholder="e.g. C:\Users\YourName\Pictures\Wallpapers"
          />
          <button className="settings-btn" onClick={handleBrowseFolder}>
            Browse...
          </button>
        </div>
      </div>

      <div className="settings-section">
        <label className="settings-label">Global Shortcut</label>
        <input
          type="text"
          className="settings-input shortcut-field"
          value={shortcut}
          onChange={(e) => setShortcut(e.target.value)}
          placeholder="e.g. Alt+W"
        />
        <div className="preset-group">
          <span className="preset-label">Presets:</span>
          {SHORTCUT_PRESETS.map((preset) => (
            <button
              key={preset}
              className={`preset-btn ${shortcut.toLowerCase() === preset.toLowerCase() ? 'active' : ''}`}
              onClick={() => setShortcut(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {statusMessage && (
        <div className={`settings-status ${isError ? 'error' : 'success'}`}>
          {statusMessage}
        </div>
      )}

      <div className="settings-actions">
        <button
          className="settings-btn primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save & Apply'}
        </button>

        <button
          className="settings-btn secondary"
          onClick={() => toggleMainWindow()}
        >
          Launch Picker
        </button>

        <button
          className="settings-btn danger"
          onClick={() => quitApp()}
        >
          Quit App
        </button>
      </div>
    </div>
  );
}
