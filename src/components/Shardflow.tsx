import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { convertFileSrc } from '@tauri-apps/api/core';
import { openSettingsWindow, logImageSwitch, logFrontend } from '../lib/tauri';
import type { WallpaperEntry, BlurMode, BlurSource } from '../types';
import './Shardflow.css';

interface ShardflowProps {
  images: WallpaperEntry[];
  onSetWallpaper: (entry: WallpaperEntry) => void;
  onRefresh?: () => Promise<WallpaperEntry[] | null> | Promise<void> | void;
  blurBackground?: boolean;
  blurMode?: BlurMode;
  blurSource?: BlurSource;
  backdropImage?: string | null;
}

const VISIBLE_RADIUS = 6;
const SHARD_STRIP_WIDTH = 110; // px
const GAP = 28; // px
const LRU_CAPACITY = 8;

export default function Shardflow({
  images,
  onSetWallpaper,
  onRefresh,
  blurBackground = false,
  blurMode = 'fullscreen',
  blurSource = 'wallpaper',
  backdropImage = null,
}: ShardflowProps) {
  const [virtualIndex, setVirtualIndex] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [loadedHighResMap, setLoadedHighResMap] = useState<Record<string, boolean>>({});

  const count = images.length;

  useEffect(() => {
    logFrontend('INFO', `[Shardflow] Rendered with ${count} images`);
  }, [count]);

  // Track window resize to ensure exact pixel centering
  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Compute active card width: ~54% of viewport, clamped between 520px and 760px
  const centerWidth = useMemo(() => {
    return Math.min(Math.max(viewportWidth * 0.54, 520), 760);
  }, [viewportWidth]);

  // Actual index in images array
  const activeActualIndex = count > 0 ? ((virtualIndex % count) + count) % count : 0;

  // Timing and logging refs
  const switchStartRef = useRef<number>(performance.now());
  const prevIndexRef = useRef<number>(activeActualIndex);
  const preloadedUrls = useRef<Set<string>>(new Set());

  // Debounce high-res loading by 60ms to eliminate lag during rapid arrow / wheel scrolling
  const [debouncedIndex, setDebouncedIndex] = useState(activeActualIndex);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedIndex(activeActualIndex);
    }, 60);
    return () => clearTimeout(timer);
  }, [activeActualIndex]);

  // Retain decoded textures in an LRU keep-alive cache so Chromium doesn't purge GPU textures on navigation
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

  // Log image-to-image switch latency
  useEffect(() => {
    const prevIdx = prevIndexRef.current;
    if (count > 0 && prevIdx !== activeActualIndex) {
      const latency = performance.now() - switchStartRef.current;
      const prevImg = images[prevIdx];
      const currImg = images[activeActualIndex];

      if (prevImg && currImg) {
        console.log(
          `[Shard Switch] "${prevImg.filename}" -> "${currImg.filename}" (${latency.toFixed(1)}ms) | ${currImg.width}x${currImg.height} | ${(currImg.file_size / (1024 * 1024)).toFixed(2)} MB`
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
          const newIdx = result.findIndex((item) => item.path === activePath);
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
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleRefresh();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        openSettingsWindow();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextSlide, prevSlide, handleRefresh]);

  // Mouse wheel navigation
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) > 20) {
      if (e.deltaX > 0) nextSlide();
      else prevSlide();
    } else if (Math.abs(e.deltaY) > 30) {
      if (e.deltaY > 0) nextSlide();
      else prevSlide();
    }
  }, [nextSlide, prevSlide]);

  // Enter key trigger
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

  if (count === 0) {
    return (
      <div className="shard-empty">
        <p>No wallpapers found in the selected directory.</p>
        <button className="shard-settings-link" onClick={() => openSettingsWindow()}>
          Open Settings
        </button>
      </div>
    );
  }

  // Generate the window of virtual items around virtualIndex
  const slots = [];
  for (let offset = -VISIBLE_RADIUS; offset <= VISIBLE_RADIUS; offset++) {
    const vIndex = virtualIndex + offset;
    const actualIdx = ((vIndex % count) + count) % count;
    const img = images[actualIdx];

    let xOffset = 0;
    let cardWidth = SHARD_STRIP_WIDTH;

    if (offset === 0) {
      xOffset = 0;
      cardWidth = centerWidth;
    } else if (offset > 0) {
      xOffset = centerWidth / 2 + GAP + SHARD_STRIP_WIDTH / 2 + (offset - 1) * (SHARD_STRIP_WIDTH + GAP);
    } else {
      const absOffset = Math.abs(offset);
      xOffset = -(centerWidth / 2 + GAP + SHARD_STRIP_WIDTH / 2 + (absOffset - 1) * (SHARD_STRIP_WIDTH + GAP));
    }

    const isRetained = retainedPaths.includes(img.path);

    slots.push({
      vIndex,
      actualIdx,
      offset,
      img,
      xOffset,
      cardWidth,
      isActive: offset === 0,
      shouldLoadHighRes: offset === 0 && (isRetained || debouncedIndex === actualIdx),
    });
  }

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

  return (
    <div
      className={`shard-viewport ${blurClass}`}
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
      {refreshNotification && (
        <div className="shard-toast">
          <span className="shard-toast-dot" />
          <span>{refreshNotification}</span>
        </div>
      )}
      <div className="shard-stage" onClick={handleBackdropClick}>
        {slots.map((slot) => {
          const fileExt = slot.img.filename.split('.').pop()?.toUpperCase() || 'IMG';
          const isHighResReady = loadedHighResMap[slot.img.path];

          return (
            <div
              key={slot.vIndex}
              className={`shard-slot ${slot.isActive ? 'active' : 'inactive'}`}
              style={{
                width: `${slot.cardWidth}px`,
                transform: `translate3d(calc(-50% + ${slot.xOffset}px), -50%, 0) skewX(-20deg)`,
                zIndex: slot.isActive ? 30 : 20 - Math.abs(slot.offset),
              }}
              onClick={() => {
                if (!slot.isActive) {
                  switchStartRef.current = performance.now();
                  setVirtualIndex(slot.vIndex);
                }
              }}
              onDoubleClick={() => onSetWallpaper(slot.img)}
            >
              {/* Layer 1: Instant RAM thumbnail (always displayed, 0ms latency) */}
              <img
                src={convertFileSrc(slot.img.thumbnail)}
                alt={slot.img.filename}
                className="shard-image thumb-layer"
                draggable={false}
              />

              {/* Layer 2: High-res image (debounced off-thread load, overlays smoothly) */}
              {slot.shouldLoadHighRes && (
                <img
                  src={convertFileSrc(slot.img.path)}
                  alt={slot.img.filename}
                  className={`shard-image full-layer ${isHighResReady ? 'is-loaded' : ''}`}
                  draggable={false}
                  decoding="async"
                  onLoad={() => handleHighResLoaded(slot.img.path, slot.img.filename)}
                />
              )}

              {/* Bottom-left Pill: Filename, Resolution & File Size */}
              {slot.isActive && (
                <div className="shard-pill">
                  <div className="shard-pill-top">
                    <span className="shard-pill-resolution">
                      {slot.img.width > 0 && slot.img.height > 0
                        ? `${slot.img.width} × ${slot.img.height}`
                        : 'Image'}
                    </span>
                    <span className="shard-pill-filesize">
                      {formatFileSize(slot.img.file_size)}
                    </span>
                  </div>
                  <div className="shard-pill-bottom">
                    <span className="shard-pill-name" title={slot.img.filename}>
                      {slot.img.filename}
                    </span>
                    <span className="shard-pill-tag">{fileExt}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Offscreen Keep-Alive: Retains decoded GPU textures in DOM to eliminate re-decoding lag */}
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
