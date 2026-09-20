import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { convertFileSrc, openSettingsWindow, logImageSwitch, logFrontend } from '../lib/tauri';
import type { WallpaperEntry } from '../types';
import './Coverflow.css';

interface CoverflowProps {
  images: WallpaperEntry[];
  onSetWallpaper: (entry: WallpaperEntry) => void;
  onRefresh?: () => Promise<WallpaperEntry[] | null> | Promise<void> | void;
}

const VISIBLE_RADIUS = 6;
const STRIP_WIDTH = 64; // px
const GAP = 10; // px

export default function Coverflow({ images, onSetWallpaper, onRefresh }: CoverflowProps) {
  const [virtualIndex, setVirtualIndex] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [loadedHighResMap, setLoadedHighResMap] = useState<Record<string, boolean>>({});

  const count = images.length;

  useEffect(() => {
    logFrontend('INFO', `[Coverflow] Rendered with ${count} images`);
  }, [count]);

  // Track window resize to ensure exact pixel centering
  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Compute active card width: ~58% of viewport, clamped between 520px and 780px
  const centerWidth = useMemo(() => {
    return Math.min(Math.max(viewportWidth * 0.58, 520), 780);
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

  // Log image-to-image switch latency
  useEffect(() => {
    const prevIdx = prevIndexRef.current;
    if (count > 0 && prevIdx !== activeActualIndex) {
      const latency = performance.now() - switchStartRef.current;
      const prevImg = images[prevIdx];
      const currImg = images[activeActualIndex];

      if (prevImg && currImg) {
        console.log(
          `[Switch] "${prevImg.filename}" -> "${currImg.filename}" (${latency.toFixed(1)}ms) | ${currImg.width}x${currImg.height} | ${(currImg.file_size / (1024 * 1024)).toFixed(2)} MB`
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

  const handleHighResLoaded = useCallback((path: string, filename: string) => {
    setLoadedHighResMap((prev) => (prev[path] ? prev : { ...prev, [path]: true }));
    console.log(`[Asset] High-res rendered: ${filename}`);
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
      <div className="gallery-empty">
        <p>No wallpapers found in the selected directory.</p>
        <button className="gallery-settings-link" onClick={() => openSettingsWindow()}>
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
    let cardWidth = STRIP_WIDTH;

    if (offset === 0) {
      xOffset = 0;
      cardWidth = centerWidth;
    } else if (offset > 0) {
      xOffset = centerWidth / 2 + GAP + (offset - 1) * (STRIP_WIDTH + GAP) + STRIP_WIDTH / 2;
    } else {
      const absOffset = Math.abs(offset);
      xOffset = -(centerWidth / 2 + GAP + (absOffset - 1) * (STRIP_WIDTH + GAP) + STRIP_WIDTH / 2);
    }

    slots.push({
      vIndex,
      actualIdx,
      offset,
      img,
      xOffset,
      cardWidth,
      isActive: offset === 0,
      shouldLoadHighRes: offset === 0 && debouncedIndex === actualIdx,
    });
  }

  return (
    <div className="gallery-viewport" onWheel={handleWheel}>
      {refreshNotification && (
        <div className="gallery-toast">
          <span className="gallery-toast-dot" />
          <span>{refreshNotification}</span>
        </div>
      )}
      <div className="gallery-stage">
        {slots.map((slot) => {
          const fileExt = slot.img.filename.split('.').pop()?.toUpperCase() || 'IMG';
          const isHighResReady = loadedHighResMap[slot.img.path];

          return (
            <div
              key={slot.vIndex}
              className={`gallery-slot ${slot.isActive ? 'active' : 'inactive'}`}
              style={{
                width: `${slot.cardWidth}px`,
                transform: `translate3d(calc(-50% + ${slot.xOffset}px), -50%, 0)`,
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
                src={`data:image/jpeg;base64,${slot.img.thumbnail}`}
                alt={slot.img.filename}
                className="gallery-image thumb-layer"
                draggable={false}
              />

              {/* Layer 2: High-res image (debounced off-thread load, overlays smoothly) */}
              {slot.shouldLoadHighRes && (
                <img
                  src={convertFileSrc(slot.img.path)}
                  alt={slot.img.filename}
                  className={`gallery-image full-layer ${isHighResReady ? 'is-loaded' : ''}`}
                  draggable={false}
                  decoding="async"
                  onLoad={() => handleHighResLoaded(slot.img.path, slot.img.filename)}
                />
              )}

              {/* Bottom-left Pill: Filename, Resolution & File Size */}
              {slot.isActive && (
                <div className="gallery-pill">
                  <div className="pill-top">
                    <span className="pill-resolution">
                      {slot.img.width > 0 && slot.img.height > 0
                        ? `${slot.img.width} × ${slot.img.height}`
                        : 'Image'}
                    </span>
                    <span className="pill-filesize">
                      {formatFileSize(slot.img.file_size)}
                    </span>
                  </div>
                  <div className="pill-bottom">
                    <span className="pill-name" title={slot.img.filename}>
                      {slot.img.filename}
                    </span>
                    <span className="pill-tag">{fileExt}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
