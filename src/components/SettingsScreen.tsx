import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  getConfig,
  saveSettings,
  isAutostartEnabled,
  toggleMainWindow,
  quitApp,
  logFrontend,
} from '../lib/tauri';
import type { DisplayMode, BlurMode, BlurSource } from '../types';
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
  const [displayMode, setDisplayMode] = useState<DisplayMode>('shard');
  const [blurBackground, setBlurBackground] = useState(false);
  const [blurMode, setBlurMode] = useState<BlurMode>('fullscreen');
  const [blurSource, setBlurSource] = useState<BlurSource>('wallpaper');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    getConfig()
      .then(async (cfg) => {
        setDirectory(cfg.wallpaper_directory || '');
        setShortcut(cfg.shortcut || 'Alt+W');
        setDisplayMode(cfg.display_mode || 'shard');
        setBlurBackground(cfg.blur_background ?? false);
        setBlurMode(cfg.blur_mode || 'fullscreen');
        setBlurSource(cfg.blur_source || 'wallpaper');
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
      await saveSettings(
        shortcut,
        directory,
        autostart,
        displayMode,
        blurBackground,
        blurMode,
        blurSource
      );
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

  const handleToggleCarousel = async () => {
    logFrontend('INFO', '[Settings] "Toggle Carousel" button clicked');
    try {
      await toggleMainWindow();
      logFrontend('INFO', '[Settings] toggleMainWindow() succeeded');
    } catch (err) {
      logFrontend('ERROR', `[Settings] toggleMainWindow() failed: ${err}`);
    }
  };

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

        {/* Section: Display Options */}
        <section className="settings-section">
          <div className="section-meta">
            <label className="section-label">Display Options</label>
            <p className="section-hint">Choose the visual layout for previewing and selecting wallpapers.</p>
          </div>
          <div className="display-options-grid">
            <button
              type="button"
              className={`display-option-card ${displayMode === 'carousel' ? 'active' : ''}`}
              onClick={() => setDisplayMode('carousel')}
            >
              <div className="display-option-preview">
                <div className="preview-card-carousel side" />
                <div className="preview-card-carousel center" />
                <div className="preview-card-carousel side" />
              </div>
              <div className="display-option-info">
                <div className="display-option-header">
                  <span className="display-option-title">Carousel</span>
                  <span className="display-option-badge">Classic</span>
                </div>
                <p className="display-option-desc">
                  Classic horizontal card stack with center focus.
                </p>
              </div>
            </button>

            <button
              type="button"
              className={`display-option-card ${displayMode === 'shard' ? 'active' : ''}`}
              onClick={() => setDisplayMode('shard')}
            >
              <div className="display-option-preview">
                <div className="preview-card-shard side" />
                <div className="preview-card-shard center" />
                <div className="preview-card-shard side" />
              </div>
              <div className="display-option-info">
                <div className="display-option-header">
                  <span className="display-option-title">Shard Display</span>
                  <span className="display-option-badge">Default</span>
                </div>
                <p className="display-option-desc">
                  Modern angled parallelogram shards cut at a dynamic slant.
                </p>
              </div>
            </button>

            <button
              type="button"
              className={`display-option-card ${displayMode === 'card' ? 'active' : ''}`}
              onClick={() => setDisplayMode('card')}
            >
              <div className="display-option-preview">
                <div className="preview-card-cardflow left" />
                <div className="preview-card-cardflow center" />
                <div className="preview-card-cardflow right" />
              </div>
              <div className="display-option-info">
                <div className="display-option-header">
                  <span className="display-option-title">Cardflow</span>
                  <span className="display-option-badge">Fan</span>
                </div>
                <p className="display-option-desc">
                  Fanned rounded cards with soft rotation and depth.
                </p>
              </div>
            </button>
          </div>
        </section>

        {/* Section: Background Blur */}
        <section className="settings-section">
          <div className="section-meta">
            <label className="section-label">Background Blur</label>
            <p className="section-hint">
              Blur everything behind the switcher when open.
            </p>
          </div>

          <label className="switch-row">
            <div className="switch-wrapper">
              <input
                type="checkbox"
                className="switch-input"
                id="blur-toggle"
                checked={blurBackground}
                onChange={(e) => setBlurBackground(e.target.checked)}
              />
              <span className="switch-track" />
            </div>
            <span className="switch-label-text">
              {blurBackground ? 'Background blur (enabled)' : 'Background blur (disabled)'}
            </span>
          </label>

          {blurBackground && (
            <>
              <div className="settings-subsection-header">
                <span className="settings-subsection-title">Blur Source</span>
                <span className="settings-subsection-hint">Choose what is blurred behind the carousel</span>
              </div>
              <div className="display-options-grid blur-options-grid">
                <button
                  type="button"
                  className={`display-option-card ${blurSource === 'screen' ? 'active' : ''}`}
                  onClick={() => setBlurSource('screen')}
                >
                  <div className="display-option-preview">
                    <div className="preview-blur-screen">
                      <div className="preview-blur-desktop-dots">
                        <span className="preview-dot" />
                        <span className="preview-dot" />
                        <span className="preview-dot" />
                      </div>
                      <div className="preview-blur-center-box" />
                    </div>
                  </div>
                  <div className="display-option-info">
                    <div className="display-option-header">
                      <span className="display-option-title">Current Screen</span>
                      <span className="display-option-badge">Desktop</span>
                    </div>
                    <p className="display-option-desc">
                      Captures and blurs your active desktop and open windows.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  className={`display-option-card ${blurSource === 'wallpaper' ? 'active' : ''}`}
                  onClick={() => setBlurSource('wallpaper')}
                >
                  <div className="display-option-preview">
                    <div className="preview-blur-wallpaper">
                      <div className="preview-blur-ambient-glow" />
                      <div className="preview-blur-center-box" />
                    </div>
                  </div>
                  <div className="display-option-info">
                    <div className="display-option-header">
                      <span className="display-option-title">Selected Background</span>
                      <span className="display-option-badge">Ambient</span>
                    </div>
                    <p className="display-option-desc">
                      Dynamic ambient blur matching the currently highlighted wallpaper.
                    </p>
                  </div>
                </button>
              </div>

              <div className="settings-subsection-header" style={{ marginTop: '16px' }}>
                <span className="settings-subsection-title">Blur Area</span>
                <span className="settings-subsection-hint">Choose display coverage for the blur effect</span>
              </div>
              <div className="display-options-grid blur-options-grid">
                <button
                  type="button"
                  className={`display-option-card ${blurMode === 'fullscreen' ? 'active' : ''}`}
                  onClick={() => setBlurMode('fullscreen')}
                >
                  <div className="display-option-preview">
                    <div className="preview-blur-screen">
                      <div className="preview-blur-center-box" />
                    </div>
                  </div>
                  <div className="display-option-info">
                    <div className="display-option-header">
                      <span className="display-option-title">Fullscreen</span>
                      <span className="display-option-badge">Full Screen</span>
                    </div>
                    <p className="display-option-desc">
                      Blurs your entire display, desktop icons, and background apps.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  className={`display-option-card ${blurMode === 'window' ? 'active' : ''}`}
                  onClick={() => setBlurMode('window')}
                >
                  <div className="display-option-preview">
                    <div className="preview-blur-window-box" />
                  </div>
                  <div className="display-option-info">
                    <div className="display-option-header">
                      <span className="display-option-title">Window Only</span>
                      <span className="display-option-badge">1200×700</span>
                    </div>
                    <p className="display-option-desc">
                      Blurs only the rectangular window region directly behind the carousel.
                    </p>
                  </div>
                </button>
              </div>
            </>
          )}
        </section>

        {/* Section: In-Gallery Shortcuts (Non-modifiable) */}
        <section className="settings-section">
          <div className="section-meta">
            <label className="section-label">In-Gallery Shortcuts</label>
            <p className="section-hint">
              Quick keyboard actions available while the wallpaper picker is open.
            </p>
          </div>
          <div className="readonly-shortcuts-list">
            <div className="readonly-shortcut-row">
              <kbd className="readonly-kbd">R</kbd>
              <span className="readonly-shortcut-label">Reload wallpapers from directory</span>
            </div>
            <div className="readonly-shortcut-row">
              <kbd className="readonly-kbd">S</kbd>
              <span className="readonly-shortcut-label">Open settings</span>
            </div>
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
          <button className="btn btn-outline" onClick={handleToggleCarousel}>
            Toggle Carousel
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
