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
import type {
  DisplayMode,
  BlurMode,
  BlurSource,
  GeometricTile,
  GeometricCurve,
  StyleflowMode,
  WallLayout,
  PlayerSkin,
  VinylSpeed,
  AnimationStyle,
} from '../types';
import './SettingsScreen.css';

const SHORTCUT_PRESETS = [
  'Alt+W',
  'Ctrl+Alt+W',
  'Alt+Space',
  'Ctrl+Shift+W',
];

const STYLE_OPTIONS: {
  mode: StyleflowMode | 'random';
  title: string;
  badge: string;
  desc: string;
}[] = [
  { mode: 'depth', title: 'Depth', badge: '3D', desc: 'Cards recede into the distance behind the chosen one.' },
  { mode: 'geometric', title: 'Geometric', badge: 'Tiles', desc: 'A field of shaped tiles you can bend into curves.' },
  { mode: 'wall', title: 'Wall', badge: 'Grid', desc: 'Browse everything at once in a scrolling wall.' },
  { mode: 'sandy', title: 'Sandy', badge: 'Particles', desc: 'A large preview that blows away as sand when you switch.' },
  { mode: 'hand', title: 'Card Hand', badge: 'Arc', desc: 'Upright cards held in a wide arc, like a hand of cards.' },
  { mode: 'collection', title: 'Collection', badge: 'Stacks', desc: 'One large card between two tilted piles.' },
  { mode: 'duel', title: 'Duel', badge: 'Slant', desc: 'A slanted row whose cards narrow with distance.' },
  { mode: 'random', title: 'Random', badge: 'Surprise', desc: 'A different style every time you open the gallery.' },
];

const TILE_OPTIONS: { value: GeometricTile; label: string }[] = [
  { value: 'hexagon', label: 'Hexagon' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'rhombus', label: 'Rhombus' },
];

const CURVE_OPTIONS: { value: GeometricCurve; label: string }[] = [
  { value: 'flat', label: 'Plane' },
  { value: 'arc', label: 'Bow' },
  { value: 'wave', label: 'Ribbon' },
  { value: 's', label: 'S sweep' },
  { value: 'cylinder', label: 'Cylinder' },
];

const WALL_OPTIONS: { value: WallLayout; label: string }[] = [
  { value: 'uniform', label: 'Uniform' },
  { value: 'brick', label: 'Brick' },
  { value: 'masonry', label: 'Masonry' },
  { value: 'justified', label: 'Justified' },
  { value: 'editorial', label: 'Editorial' },
  { value: 'cylinder', label: 'Cylinder' },
];

const ANIMATION_OPTIONS: {
  value: AnimationStyle;
  title: string;
  badge: string;
  desc: string;
}[] = [
  {
    value: 'classic',
    title: 'Classic Slide',
    badge: 'Default',
    desc: 'Instant, responsive high-speed cubic-bezier glide with zero latency.',
  },
  {
    value: 'zoom-depth',
    title: 'Zoom & Depth',
    badge: '3D Scale',
    desc: 'Center wallpaper expands forward while side cards plunge into deep Z-space.',
  },
  {
    value: 'spring',
    title: 'Spring Bounce',
    badge: 'Elastic',
    desc: 'Tactile physical momentum with subtle overshoot on switch.',
  },
  {
    value: 'flip',
    title: '3D Flip',
    badge: 'Perspective',
    desc: 'Dynamic 3D rotational flip with perspective depth on transition.',
  },
  {
    value: 'fade',
    title: 'Crossfade Glide',
    badge: 'Smooth',
    desc: 'Cinematic ambient crossfade with soft gliding focus on transition.',
  },
  {
    value: 'cube',
    title: '3D Cube Rotate',
    badge: 'Prism',
    desc: 'Revolves cards like facets around a deep 3D rotating prism drum.',
  },
];

function ChipRow<T extends string>({
  caption,
  options,
  value,
  onChange,
}: {
  caption: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="presets-row">
      <span className="presets-caption">{caption}:</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`preset-chip ${value === option.value ? 'active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type SettingsTab = 'general' | 'display' | 'animation';

export default function SettingsScreen() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [directory, setDirectory] = useState('');
  const [wallpaperEngineEnabled, setWallpaperEngineEnabled] = useState(false);
  const [wallpaperEngineDirectory, setWallpaperEngineDirectory] = useState('');
  const [shortcut, setShortcut] = useState('Alt+W');
  const [autostart, setAutostart] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('shard');
  const [geometricTile, setGeometricTile] = useState<GeometricTile>('hexagon');
  const [geometricCurve, setGeometricCurve] = useState<GeometricCurve>('flat');
  const [wallLayout, setWallLayout] = useState<WallLayout>('uniform');
  const [vinylSkin, setVinylSkin] = useState<PlayerSkin>('wood');
  const [vinylRotation, setVinylRotation] = useState<boolean>(true);
  const [vinylSpeed, setVinylSpeed] = useState<VinylSpeed>('33');
  const [vinylArmTracking, setVinylArmTracking] = useState<boolean>(true);
  const [blurBackground, setBlurBackground] = useState(false);
  const [blurMode, setBlurMode] = useState<BlurMode>('fullscreen');
  const [blurSource, setBlurSource] = useState<BlurSource>('wallpaper');
  const [animationStyle, setAnimationStyle] = useState<AnimationStyle>('classic');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    getConfig()
      .then(async (cfg) => {
        setDirectory(cfg.wallpaper_directory || '');
        setWallpaperEngineEnabled(cfg.wallpaper_engine_enabled ?? false);
        setWallpaperEngineDirectory(cfg.wallpaper_engine_directory || '');
        setShortcut(cfg.shortcut || 'Alt+W');
        setDisplayMode(cfg.display_mode || 'shard');
        setGeometricTile(cfg.geometric_tile || 'hexagon');
        setGeometricCurve(cfg.geometric_curve || 'flat');
        setWallLayout(cfg.wall_layout || 'uniform');
        if (cfg.animation_style) setAnimationStyle(cfg.animation_style);
        if (cfg.vinyl_skin) setVinylSkin(cfg.vinyl_skin);
        if (typeof cfg.vinyl_rotation === 'boolean') setVinylRotation(cfg.vinyl_rotation);
        if (cfg.vinyl_speed) setVinylSpeed(cfg.vinyl_speed);
        if (typeof cfg.vinyl_arm_tracking === 'boolean') setVinylArmTracking(cfg.vinyl_arm_tracking);
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

  const handleBrowseWallpaperEngine = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Wallpaper Engine Folder',
        defaultPath: wallpaperEngineDirectory || undefined,
      });
      if (selected && typeof selected === 'string') {
        setWallpaperEngineDirectory(selected);
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
        blurSource,
        wallpaperEngineEnabled,
        wallpaperEngineDirectory,
        geometricTile,
        geometricCurve,
        wallLayout,
        vinylSkin,
        vinylRotation,
        vinylSpeed,
        vinylArmTracking,
        animationStyle
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

      <div className="settings-layout">
        {/* Sidebar */}
        <aside className="settings-sidebar">
          <div className="settings-nav-list">
            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'general' ? 'active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              General
            </button>
            <div className="settings-nav-separator" />
            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'display' ? 'active' : ''}`}
              onClick={() => setActiveTab('display')}
            >
              Display
            </button>
            <div className="settings-nav-separator" />
            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'animation' ? 'active' : ''}`}
              onClick={() => setActiveTab('animation')}
            >
              Animation
            </button>
          </div>

          <div className="settings-sidebar-footer">
            <button className="btn sidebar-quit-btn" onClick={() => quitApp()}>
              Quit App
            </button>
          </div>
        </aside>

        {/* Crisp Vertical Divider */}
        <div className="settings-vertical-divider" />

        {/* Main Content Pane */}
        <main className="settings-main-pane">
          <div className="settings-tab-content">
            {activeTab === 'general' && (
              <>
                <header className="settings-header">
                  <h1 className="settings-title">General</h1>
                  <p className="settings-description">
                    Manage your wallpaper directory, shortcuts, and startup preferences.
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

                {/* Section: Wallpaper Engine */}
                <section className="settings-section">
                  <div className="section-meta">
                    <label className="section-label">Wallpaper Engine</label>
                    <p className="section-hint">
                      Show your subscribed Workshop wallpapers in the picker alongside your folder.
                    </p>
                  </div>
                  <label className="switch-row">
                    <div className="switch-wrapper">
                      <input
                        type="checkbox"
                        className="switch-input"
                        id="wallpaper-engine-toggle"
                        checked={wallpaperEngineEnabled}
                        onChange={(e) => setWallpaperEngineEnabled(e.target.checked)}
                      />
                      <span className="switch-track" />
                    </div>
                    <span className="switch-label-text">
                      {wallpaperEngineEnabled ? 'Wallpaper Engine (enabled)' : 'Wallpaper Engine (disabled)'}
                    </span>
                  </label>
                  {wallpaperEngineEnabled && (
                    <div className="input-group">
                      <input
                        type="text"
                        className="text-input"
                        value={wallpaperEngineDirectory}
                        onChange={(e) => setWallpaperEngineDirectory(e.target.value)}
                        placeholder="Detected automatically through Steam"
                        spellCheck={false}
                      />
                      <button className="btn btn-outline" onClick={handleBrowseWallpaperEngine}>
                        Browse
                      </button>
                    </div>
                  )}
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
              </>
            )}

            {activeTab === 'display' && (
              <>
                <header className="settings-header">
                  <h1 className="settings-title">Display</h1>
                  <p className="settings-description">
                    Customize gallery display themes, geometric curves, and background blur effects.
                  </p>
                </header>

                <div className="settings-divider" />

                {/* Section: Display Options */}
                <section className="settings-section">
                  <div className="section-meta">
                    <label className="section-label">Display Mode</label>
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

                    <button
                      type="button"
                      className={`display-option-card ${displayMode === 'vinyl' ? 'active' : ''}`}
                      onClick={() => setDisplayMode('vinyl')}
                    >
                      <div className="display-option-preview">
                        <div className="preview-card-vinyl left" />
                        <div className="preview-card-vinyl center" />
                        <div className="preview-card-vinyl right" />
                      </div>
                      <div className="display-option-info">
                        <div className="display-option-header">
                          <span className="display-option-title">Vinyl-flow</span>
                          <span className="display-option-badge">Turntable</span>
                        </div>
                        <p className="display-option-desc">
                          Analog turntable player with rotating vinyl and sleeve covers.
                        </p>
                      </div>
                    </button>

                    {STYLE_OPTIONS.map((option) => (
                      <button
                        key={option.mode}
                        type="button"
                        className={`display-option-card ${displayMode === option.mode ? 'active' : ''}`}
                        onClick={() => setDisplayMode(option.mode)}
                      >
                        <div className={`display-option-preview preview-style preview-style-${option.mode}`}>
                          <span />
                          <span />
                          <span />
                          <span />
                        </div>
                        <div className="display-option-info">
                          <div className="display-option-header">
                            <span className="display-option-title">{option.title}</span>
                            <span className="display-option-badge">{option.badge}</span>
                          </div>
                          <p className="display-option-desc">{option.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>

                  {displayMode === 'geometric' && (
                    <>
                      <ChipRow
                        caption="Tile"
                        options={TILE_OPTIONS}
                        value={geometricTile}
                        onChange={setGeometricTile}
                      />
                      <ChipRow
                        caption="Shape"
                        options={CURVE_OPTIONS}
                        value={geometricCurve}
                        onChange={setGeometricCurve}
                      />
                    </>
                  )}

                  {displayMode === 'wall' && (
                    <ChipRow
                      caption="Layout"
                      options={WALL_OPTIONS}
                      value={wallLayout}
                      onChange={setWallLayout}
                    />
                  )}
                </section>

                {/* Section: Turntable Preferences (when Vinyl is active) */}
                {displayMode === 'vinyl' && (
                  <section className="settings-section">
                    <div className="section-meta">
                      <label className="section-label">Turntable Preferences</label>
                      <p className="section-hint">Customize player appearance, rotation, and playback speed.</p>
                    </div>

                    <div className="settings-subsection-header">
                      <span className="settings-subsection-title">Player Skin</span>
                    </div>
                    <div className="display-options-grid skin-options-grid">
                      <button
                        type="button"
                        className={`display-option-card ${vinylSkin === 'wood' ? 'active' : ''}`}
                        onClick={() => setVinylSkin('wood')}
                      >
                        <div className="display-option-info">
                          <div className="display-option-header">
                            <span className="display-option-title">Walnut Wood</span>
                            <span className="display-option-badge">Brass</span>
                          </div>
                          <p className="display-option-desc">
                            Warm mid-tone walnut plinth with polished brass platter rim.
                          </p>
                        </div>
                      </button>
                      <button
                        type="button"
                        className={`display-option-card ${vinylSkin === 'modern-black' ? 'active' : ''}`}
                        onClick={() => setVinylSkin('modern-black')}
                      >
                        <div className="display-option-info">
                          <div className="display-option-header">
                            <span className="display-option-title">Modern Black</span>
                            <span className="display-option-badge">Aluminum</span>
                          </div>
                          <p className="display-option-desc">
                            Matte obsidian plinth with machined silver aluminum platter rim.
                          </p>
                        </div>
                      </button>
                    </div>

                    <div className="settings-subsection-header" style={{ marginTop: '16px' }}>
                      <span className="settings-subsection-title">Platter Rotation</span>
                    </div>
                    <label className="switch-row">
                      <div className="switch-wrapper">
                        <input
                          type="checkbox"
                          className="switch-input"
                          checked={vinylRotation}
                          onChange={(e) => setVinylRotation(e.target.checked)}
                        />
                        <span className="switch-track" />
                      </div>
                      <span className="switch-label-text">
                        {vinylRotation ? 'Record rotation enabled' : 'Record rotation paused (static)'}
                      </span>
                    </label>

                    {vinylRotation && (
                      <>
                        <div className="settings-subsection-header" style={{ marginTop: '16px' }}>
                          <span className="settings-subsection-title">Rotation Speed</span>
                        </div>
                        <div className="display-options-grid speed-options-grid">
                          <button
                            type="button"
                            className={`display-option-card ${vinylSpeed === '33' ? 'active' : ''}`}
                            onClick={() => setVinylSpeed('33')}
                          >
                            <div className="display-option-info">
                              <div className="display-option-header">
                                <span className="display-option-title">33⅓ RPM</span>
                                <span className="display-option-badge">Standard</span>
                              </div>
                              <p className="display-option-desc">
                                Classic 1.8 seconds per revolution LP speed.
                              </p>
                            </div>
                          </button>
                          <button
                            type="button"
                            className={`display-option-card ${vinylSpeed === '45' ? 'active' : ''}`}
                            onClick={() => setVinylSpeed('45')}
                          >
                            <div className="display-option-info">
                              <div className="display-option-header">
                                <span className="display-option-title">45 RPM</span>
                                <span className="display-option-badge">Fast</span>
                              </div>
                              <p className="display-option-desc">
                                Brisk 1.33 seconds per revolution single speed.
                              </p>
                            </div>
                          </button>
                        </div>
                      </>
                    )}

                    <div className="settings-subsection-header" style={{ marginTop: '16px' }}>
                      <span className="settings-subsection-title">Tonearm Track Progress</span>
                    </div>
                    <label className="switch-row">
                      <div className="switch-wrapper">
                        <input
                          type="checkbox"
                          className="switch-input"
                          checked={vinylArmTracking}
                          onChange={(e) => setVinylArmTracking(e.target.checked)}
                        />
                        <span className="switch-track" />
                      </div>
                      <span className="switch-label-text">
                        {vinylArmTracking ? 'Tonearm position reflects collection index' : 'Fixed tonearm rest angle'}
                      </span>
                    </label>
                  </section>
                )}

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
              </>
            )}

            {activeTab === 'animation' && (
              <>
                <header className="settings-header">
                  <h1 className="settings-title">Animation</h1>
                  <p className="settings-description">
                    Choose the motion dynamic and physics used when transitioning between wallpapers.
                  </p>
                </header>

                <div className="settings-divider" />

                {/* Section: Animation Style */}
                <section className="settings-section">
                  <div className="section-meta">
                    <label className="section-label">Transition Dynamic</label>
                    <p className="section-hint">
                      Applied across Carousel, Shard Display, Cardflow, Depth, Hand, Collection, and Duel.
                    </p>
                  </div>
                  <div className="display-options-grid">
                    {ANIMATION_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`display-option-card ${animationStyle === option.value ? 'active' : ''}`}
                        onClick={() => setAnimationStyle(option.value)}
                      >
                        <div className={`display-option-preview preview-anim preview-anim-${option.value}`}>
                          <div className="preview-card-carousel side" />
                          <div className="preview-card-carousel center" />
                          <div className="preview-card-carousel side" />
                        </div>
                        <div className="display-option-info">
                          <div className="display-option-header">
                            <span className="display-option-title">{option.title}</span>
                            <span className="display-option-badge">{option.badge}</span>
                          </div>
                          <p className="display-option-desc">{option.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>

          {/* Footer inside main pane */}
          <footer className="settings-footer">
            <div className="footer-actions-left">
              <button className="btn btn-outline" onClick={handleToggleCarousel}>
                Toggle Carousel
              </button>
            </div>
            <div className="footer-actions">
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
