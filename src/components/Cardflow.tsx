import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  openSettingsWindow,
  logImageSwitch,
  logFrontend,
  isSamePath,
  pillResolution,
  pillTag,
} from '../lib/tauri';
import type { WallpaperEntry, BlurMode, BlurSource } from '../types';
import ColorFilterBar from './ColorFilterBar';
import './Cardflow.css';

interface CardflowProps {
  images: WallpaperEntry[];
  onSetWallpaper: (entry: WallpaperEntry) => void;
  onRefresh?: () => Promise<WallpaperEntry[] | null> | Promise<void> | void;
  blurBackground?: boolean;
  blurMode?: BlurMode;
  blurSource?: BlurSource;
  backdropImage?: string | null;
  lastWallpaper?: string | null;
  selectedColor?: string | null;
  onSelectColor?: (color: string | null) => void;
}

const VISIBLE_RADIUS = 4;
const LRU_CAPACITY = 8;

export default function Cardflow({
  images,
  onSetWallpaper,
  onRefresh,
  blurBackground = false,
  blurMode = 'fullscreen',
  blurSource = 'wallpaper',
  backdropImage = null,
  lastWallpaper = null,
  selectedColor = null,
  onSelectColor,
}: CardflowProps) {
  const findWallpaperIndex = useCallback(
    (targetPath?: string | null) => {
      if (!targetPath || images.length === 0) return 0;
      const idx = images.findIndex((img) => isSamePath(img.path, targetPath));
      return idx !== -1 ? idx : 0;
    },
    [images]
  );

  const [virtualIndex, setVirtualIndex] = useState(() => findWallpaperIndex(lastWallpaper));
  const [loadedHighResMap, setLoadedHighResMap] = useState<Record<string, boolean>>({});

  const count = images.length;

  // Initial sync if lastWallpaper or images become available after mount
  const initialSyncDoneRef = useRef(Boolean(lastWallpaper && images.length > 0));
  useEffect(() => {
    if (!initialSyncDoneRef.current && images.length > 0 && lastWallpaper) {
      const targetIdx = findWallpaperIndex(lastWallpaper);
      if (targetIdx !== 0) {
        setVirtualIndex(targetIdx);
      }
      initialSyncDoneRef.current = true;
    }
  }, [images, lastWallpaper, findWallpaperIndex]);

  // Re-sync when window is reopened / reset requested
  useEffect(() => {
    const handleReset = (e: Event) => {
      const customEvent = e as CustomEvent<{ lastWallpaper?: string | null }>;
      const targetPath = customEvent.detail?.lastWallpaper ?? lastWallpaper;
      const targetIdx = findWallpaperIndex(targetPath);
      switchStartRef.current = performance.now();
      setVirtualIndex(targetIdx);
    };

    window.addEventListener('reset-to-last-wallpaper', handleReset);
    return () => window.removeEventListener('reset-to-last-wallpaper', handleReset);
  }, [findWallpaperIndex, lastWallpaper]);

  useEffect(() => {
    logFrontend('INFO', `[Cardflow] Rendered with ${count} images`);
  }, [count]);

  // When color filter changes, reset to virtualIndex 0 cleanly
  const prevColorRef = useRef(selectedColor);
  useEffect(() => {
    if (prevColorRef.current !== selectedColor) {
      prevColorRef.current = selectedColor;
      setVirtualIndex(0);
    }
  }, [selectedColor]);

  // Actual index in images array
  const activeActualIndex = count > 0 ? ((virtualIndex % count) + count) % count : 0;

  // Timing and logging refs
  const switchStartRef = useRef<number>(performance.now());
  const prevIndexRef = useRef<number>(activeActualIndex);
  const preloadedUrls = useRef<Set<string>>(new Set());

  // Debounce high-res loading by 60ms to eliminate lag during rapid navigation
  const [debouncedIndex, setDebouncedIndex] = useState(activeActualIndex);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedIndex(activeActualIndex);
    }, 60);
    return () => clearTimeout(timer);
  }, [activeActualIndex]);

  // Retain decoded textures in an LRU keep-alive cache so Chromium doesn't purge GPU textures
  const [retainedPaths, setRetainedPaths] = useState<string[]>([]);
  useEffect(() => {
    if (count === 0) return;
    const activeImg = images[debouncedIndex];
    if (!activeImg) return;
    setRetainedPaths((prev) => {
      const filtered = prev.filter((p) => p !== activeImg.path);
      const next = [activeImg.path, ...filtered];
      return next.length > LRU_CAPACITY ? next.slice(0, LRU_CAPACITY) : next;
    });
  }, [debouncedIndex, images, count]);

  // Log image switch latency
  useEffect(() => {
    const prevIdx = prevIndexRef.current;
    if (count > 0 && prevIdx !== activeActualIndex) {
      const latency = performance.now() - switchStartRef.current;
      const prevImg = images[prevIdx];
      const currImg = images[activeActualIndex];

      if (prevImg && currImg) {
        console.log(
          `[Card Switch] "${prevImg.filename}" -> "${currImg.filename}" (${latency.toFixed(1)}ms) | ${currImg.width}x${currImg.height} | ${(currImg.file_size / (1024 * 1024)).toFixed(2)} MB`
        );
        logImageSwitch(
          prevImg.filename,
          currImg.filename,
          latency,
          currImg.width,
          currImg.height,
          currImg.file_size
        ).catch(() => {});
      }
      prevIndexRef.current = activeActualIndex;
    }
  }, [activeActualIndex, count, images]);

  // Preload adjacent high-res images (±1, ±2) off-thread
  useEffect(() => {
    if (count === 0) return;
    const offsets = [1, -1, 2, -2];
    offsets.forEach((offset) => {
      const idx = ((activeActualIndex + offset) % count + count) % count;
      const target = images[idx];
      if (target && !preloadedUrls.current.has(target.path)) {
        preloadedUrls.current.add(target.path);
        const img = new Image();
        img.decoding = 'async';
        img.src = convertFileSrc(target.path);
      }
    });
  }, [activeActualIndex, count, images]);

  const handleHighResLoaded = useCallback((path: string, filename?: string) => {
    setLoadedHighResMap((prev) => (prev[path] ? prev : { ...prev, [path]: true }));
    if (filename) {
      console.log(`[Asset] High-res rendered: ${filename}`);
    }
  }, []);

  const [refreshNotification, setRefreshNotification] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (!onRefresh || isRefreshing) return;
    setIsRefreshing(true);
    setRefreshNotification('Checking for new images…');
    try {
      const activePath = images[activeActualIndex]?.path;
      const result = await onRefresh();
      if (Array.isArray(result)) {
        if (activePath) {
          const newIdx = images.findIndex((item) => isSamePath(item.path, activePath));
          if (newIdx !== -1) {
            setVirtualIndex(newIdx);
          }
        }
        setRefreshNotification(`Library updated · ${result.length} wallpapers`);
      } else {
        setRefreshNotification('Library updated');
      }
    } catch {
      setRefreshNotification('Failed to check for new images');
    } finally {
      setIsRefreshing(false);
      setTimeout(() => {
        setRefreshNotification(null);
      }, 2000);
    }
  }, [onRefresh, isRefreshing, images, activeActualIndex]);

  const triggerNavigation = useCallback((direction: 1 | -1) => {
    if (count === 0) return;
    switchStartRef.current = performance.now();
    setVirtualIndex((prev) => prev + direction);
  }, [count]);

  const nextSlide = useCallback(() => triggerNavigation(1), [triggerNavigation]);
  const prevSlide = useCallback(() => triggerNavigation(-1), [triggerNavigation]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'l') {
        e.preventDefault();
        nextSlide();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'h') {
        e.preventDefault();
        prevSlide();
      } else if (e.key === 'Home') {
        e.preventDefault();
        if (count > 0) {
          switchStartRef.current = performance.now();
          setVirtualIndex(0);
        }
      } else if (e.key === 'End') {
        e.preventDefault();
        if (count > 0) {
          switchStartRef.current = performance.now();
          setVirtualIndex(count - 1);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        getCurrentWindow().hide();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (images[activeActualIndex]) {
          onSetWallpaper(images[activeActualIndex]);
        }
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleRefresh();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        getCurrentWindow().hide();
        openSettingsWindow();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextSlide, prevSlide, handleRefresh, count, images, activeActualIndex, onSetWallpaper]);

  const lastWheelTimeRef = useRef<number>(0);

  // Mouse wheel navigation with 120ms throttle guard
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const now = performance.now();
    if (now - lastWheelTimeRef.current < 120) {
      return;
    }

    if (Math.abs(e.deltaX) > 20) {
      lastWheelTimeRef.current = now;
      if (e.deltaX > 0) nextSlide();
      else prevSlide();
    } else if (Math.abs(e.deltaY) > 30) {
      lastWheelTimeRef.current = now;
      if (e.deltaY > 0) nextSlide();
      else prevSlide();
    }
  }, [nextSlide, prevSlide]);

  // Enter key trigger from global listener
  useEffect(() => {
    const handleSetActive = () => {
      if (images[activeActualIndex]) {
        onSetWallpaper(images[activeActualIndex]);
      }
    };
    window.addEventListener('set-active-wallpaper', handleSetActive);
    return () => window.removeEventListener('set-active-wallpaper', handleSetActive);
  }, [activeActualIndex, images, onSetWallpaper]);

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const blurClass = blurBackground
    ? blurMode === 'window'
      ? 'blur-window'
      : 'blur-fullscreen'
    : '';

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && blurBackground && blurMode === 'fullscreen') {
      getCurrentWindow().hide();
    }
  };

  if (count === 0) {
    if (selectedColor && onSelectColor) {
      return (
        <div
          className={`card-viewport ${blurClass}`}
          onClick={handleBackdropClick}
        >
          {blurBackground && (
            blurSource === 'screen' && backdropImage ? (
              <img
                src={`data:image/jpeg;base64,${backdropImage}`}
                alt=""
                className="desktop-backdrop"
                draggable={false}
              />
            ) : null
          )}
          <ColorFilterBar
            selectedColor={selectedColor}
            onSelectColor={onSelectColor}
            curved={true}
          />
          {refreshNotification && (
            <div className="card-toast">
              <span className="card-toast-dot" />
              <span>{refreshNotification}</span>
            </div>
          )}
          <div className="card-empty color-empty">
            <p>No wallpapers match this color</p>
            <button
              type="button"
              className="card-show-all-btn"
              onClick={() => onSelectColor(null)}
            >
              Show All
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="card-empty">
        <p>No wallpapers found in the selected directory.</p>
        <button className="card-settings-link" onClick={() => openSettingsWindow()}>
          Open Settings
        </button>
      </div>
    );
  }

  // Generate virtual slots around virtualIndex
  const radius = Math.min(VISIBLE_RADIUS, count <= 1 ? 0 : VISIBLE_RADIUS);
  const slots = [];
  for (let offset = -radius; offset <= radius; offset++) {
    const vIndex = virtualIndex + offset;
    const actualIdx = ((vIndex % count) + count) % count;
    const img = images[actualIdx];

    const isRetained = retainedPaths.includes(img.path);

    slots.push({
      vIndex,
      actualIdx,
      offset,
      img,
      isActive: offset === 0,
      shouldLoadHighRes: offset === 0 && (isRetained || debouncedIndex === actualIdx),
    });
  }

  return (
    <div
      className={`card-viewport ${blurClass}`}
      onWheel={handleWheel}
      onClick={handleBackdropClick}
    >
      {blurBackground && (
        blurSource === 'wallpaper' ? (
          images[activeActualIndex] && (
            <div className="wallpaper-backdrop-container">
              <img
                src={convertFileSrc(images[activeActualIndex].thumbnail)}
                alt=""
                className="desktop-backdrop wallpaper-backdrop"
                draggable={false}
              />
              {loadedHighResMap[images[activeActualIndex].path] && (
                <img
                  src={convertFileSrc(images[activeActualIndex].path)}
                  alt=""
                  className="desktop-backdrop wallpaper-backdrop high-res"
                  draggable={false}
                />
              )}
            </div>
          )
        ) : (
          backdropImage && (
            <img
              src={`data:image/jpeg;base64,${backdropImage}`}
              alt=""
              className="desktop-backdrop"
              draggable={false}
            />
          )
        )
      )}
      {onSelectColor && (
        <ColorFilterBar
          selectedColor={selectedColor}
          onSelectColor={onSelectColor}
          curved={true}
        />
      )}
      {refreshNotification && (
        <div className="card-toast">
          <span className="card-toast-dot" />
          <span>{refreshNotification}</span>
        </div>
      )}
      <div className="card-stage" onClick={handleBackdropClick}>
        {slots.map((slot) => {
          const fileExt = pillTag(slot.img);
          const isHighResReady = loadedHighResMap[slot.img.path];

          // Compute offset class name
          let offsetClass = 'offset-0';
          if (slot.offset === -1) offsetClass = 'offset-neg-1';
          else if (slot.offset === 1) offsetClass = 'offset-pos-1';
          else if (slot.offset === -2) offsetClass = 'offset-neg-2';
          else if (slot.offset === 2) offsetClass = 'offset-pos-2';
          else if (slot.offset === -3) offsetClass = 'offset-neg-3';
          else if (slot.offset === 3) offsetClass = 'offset-pos-3';
          else if (slot.offset < -3) offsetClass = 'offset-hidden-left';
          else if (slot.offset > 3) offsetClass = 'offset-hidden-right';

          return (
            <div
              key={slot.vIndex}
              className={`card-slot ${slot.isActive ? 'active' : 'inactive'} ${offsetClass}`}
              onClick={() => {
                if (!slot.isActive) {
                  switchStartRef.current = performance.now();
                  setVirtualIndex(slot.vIndex);
                }
              }}
              onDoubleClick={() => onSetWallpaper(slot.img)}
            >
              {/* Layer 1: Instant RAM thumbnail */}
              <img
                src={convertFileSrc(slot.img.thumbnail)}
                alt={slot.img.filename}
                className="card-image thumb-layer"
                draggable={false}
              />

              {/* Layer 2: High-res image loaded smoothly on top */}
              {slot.shouldLoadHighRes && (
                <img
                  src={convertFileSrc(slot.img.path)}
                  alt={slot.img.filename}
                  className={`card-image full-layer ${isHighResReady ? 'is-loaded' : ''}`}
                  draggable={false}
                  decoding="async"
                  onLoad={() => handleHighResLoaded(slot.img.path, slot.img.filename)}
                />
              )}

              {/* Active Card Pill: Dimensions, File Size, Filename */}
              {slot.isActive && (
                <div className="card-pill">
                  <div className="card-pill-top">
                    <span className="card-pill-resolution">
                      {pillResolution(slot.img)}
                    </span>
                    {!slot.img.project && (
                      <span className="card-pill-filesize">
                        {formatFileSize(slot.img.file_size)}
                      </span>
                    )}
                  </div>
                  <div className="card-pill-bottom">
                    <span className="card-pill-name" title={slot.img.filename}>
                      {slot.img.filename}
                    </span>
                    <span className="card-pill-tag">{fileExt}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Offscreen Keep-Alive: Retains decoded GPU textures */}
      <div
        className="texture-keepalive"
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '1px',
          height: '1px',
          opacity: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
          zIndex: -1,
        }}
      >
        {retainedPaths.map((path) => (
          <img
            key={path}
            src={convertFileSrc(path)}
            alt=""
            decoding="async"
            onLoad={() => handleHighResLoaded(path)}
          />
        ))}
      </div>
    </div>
  );
}
