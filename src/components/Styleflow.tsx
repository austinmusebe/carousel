import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  openSettingsWindow,
  logFrontend,
  isSamePath,
  pillResolution,
  pillTag,
} from '../lib/tauri';
import {
  buildGrid,
  computePoses,
  gridNeighbor,
  isGridMode,
  sandyHero,
} from '../lib/styleLayouts';
import type { LayoutOptions } from '../lib/styleLayouts';
import type {
  WallpaperEntry,
  BlurMode,
  BlurSource,
  StyleflowMode,
  GeometricTile,
  GeometricCurve,
  WallLayout,
} from '../types';
import ColorFilterBar from './ColorFilterBar';
import './Shardflow.css';
import './Styleflow.css';

interface StyleflowProps {
  mode: StyleflowMode;
  geometricTile: GeometricTile;
  geometricCurve: GeometricCurve;
  wallLayout: WallLayout;
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

const GRAIN_SIZE = 8; // px
const GRAIN_LIFETIME = 0.7; // seconds
const GRAIN_SWEEP = 0.45; // seconds for the wind to cross the image
const GRAVITY = 380; // px/s²

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(
    img,
    (img.naturalWidth - sw) / 2,
    (img.naturalHeight - sh) / 2,
    sw,
    sh,
    0,
    0,
    w,
    h
  );
}

// Grains only ever copy pixels between canvases, so asset images never need to be readable.
function blowAway(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  hero: { x: number; y: number; w: number; h: number }
): () => void {
  const ctx = canvas.getContext('2d');
  const snapshot = document.createElement('canvas');
  snapshot.width = hero.w;
  snapshot.height = hero.h;
  const snapshotCtx = snapshot.getContext('2d');
  if (!ctx || !snapshotCtx || !image.naturalWidth) return () => {};
  drawCover(snapshotCtx, image, hero.w, hero.h);

  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.scale(dpr, dpr);

  const cols = Math.ceil(hero.w / GRAIN_SIZE);
  const rows = Math.ceil(hero.h / GRAIN_SIZE);
  const grains = Array.from({ length: cols * rows }, (_, i) => {
    const sx = (i % cols) * GRAIN_SIZE;
    const sy = Math.floor(i / cols) * GRAIN_SIZE;
    return {
      sx,
      sy,
      delay: (sx / hero.w) * GRAIN_SWEEP + Math.random() * 0.2,
      vx: 60 + Math.random() * 220,
      vy: -40 + Math.random() * 120,
    };
  });

  const startedAt = performance.now();
  let frame = 0;
  const draw = (now: number) => {
    const elapsed = (now - startedAt) / 1000;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    let alive = false;
    for (const grain of grains) {
      const t = elapsed - grain.delay;
      if (t > GRAIN_LIFETIME) continue;
      alive = true;
      const moving = Math.max(0, t);
      ctx.globalAlpha = 1 - moving / GRAIN_LIFETIME;
      ctx.drawImage(
        snapshot,
        grain.sx,
        grain.sy,
        GRAIN_SIZE,
        GRAIN_SIZE,
        hero.x + grain.sx + grain.vx * moving,
        hero.y + grain.sy + grain.vy * moving + (GRAVITY * moving * moving) / 2,
        GRAIN_SIZE,
        GRAIN_SIZE
      );
    }
    if (alive) frame = requestAnimationFrame(draw);
  };

  frame = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(frame);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  };
}

function SandHero({
  entry,
  hero,
  onApply,
}: {
  entry: WallpaperEntry;
  hero: { x: number; y: number; w: number; h: number };
  onApply: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shownRef = useRef<HTMLImageElement | null>(null);
  const src = convertFileSrc(entry.path);

  useEffect(() => {
    const canvas = canvasRef.current;
    const previous = shownRef.current;
    const stop = canvas && previous ? blowAway(canvas, previous, hero) : () => {};

    const next = new Image();
    next.onload = () => {
      shownRef.current = next;
    };
    next.src = src;
    return stop;
    // A resize keeps the running animation; only a new wallpaper restarts it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return (
    <>
      <div
        className="sand-hero"
        style={{ left: hero.x, top: hero.y, width: hero.w, height: hero.h }}
        onDoubleClick={onApply}
      >
        <img src={convertFileSrc(entry.thumbnail)} alt="" draggable={false} />
        <img src={src} alt={entry.filename} draggable={false} decoding="async" />
      </div>
      <canvas ref={canvasRef} className="sand-canvas" />
    </>
  );
}

export default function Styleflow({
  mode,
  geometricTile,
  geometricCurve,
  wallLayout,
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
}: StyleflowProps) {
  const findWallpaperIndex = useCallback(
    (targetPath?: string | null) => {
      if (!targetPath) return 0;
      const idx = images.findIndex((img) => isSamePath(img.path, targetPath));
      return idx !== -1 ? idx : 0;
    },
    [images]
  );

  const [virtualIndex, setVirtualIndex] = useState(() => findWallpaperIndex(lastWallpaper));
  const [viewport, setViewport] = useState({ vw: window.innerWidth, vh: window.innerHeight });
  const [refreshNotification, setRefreshNotification] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const count = images.length;
  const activeIndex = count > 0 ? ((virtualIndex % count) + count) % count : 0;
  const activeEntry: WallpaperEntry | undefined = images[activeIndex];

  const options: LayoutOptions = useMemo(
    () => ({ ...viewport, tile: geometricTile, curve: geometricCurve, wall: wallLayout }),
    [viewport, geometricTile, geometricCurve, wallLayout]
  );
  const cells = useMemo(() => buildGrid(mode, images, options), [mode, images, options]);
  const poses = useMemo(
    () => computePoses(mode, virtualIndex, count, cells, options),
    [mode, virtualIndex, count, cells, options]
  );

  useEffect(() => {
    logFrontend('INFO', `[Styleflow] Rendered '${mode}' with ${count} images`);
  }, [mode, count]);

  const initialSyncDoneRef = useRef(Boolean(lastWallpaper && count > 0));
  useEffect(() => {
    if (!initialSyncDoneRef.current && count > 0 && lastWallpaper) {
      setVirtualIndex(findWallpaperIndex(lastWallpaper));
      initialSyncDoneRef.current = true;
    }
  }, [count, lastWallpaper, findWallpaperIndex]);

  useEffect(() => {
    const handleReset = (e: Event) => {
      const { detail } = e as CustomEvent<{ lastWallpaper?: string | null }>;
      setVirtualIndex(findWallpaperIndex(detail?.lastWallpaper ?? lastWallpaper));
    };
    window.addEventListener('reset-to-last-wallpaper', handleReset);
    return () => window.removeEventListener('reset-to-last-wallpaper', handleReset);
  }, [findWallpaperIndex, lastWallpaper]);

  useEffect(() => {
    const handleResize = () =>
      setViewport({ vw: window.innerWidth, vh: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const prevColorRef = useRef(selectedColor);
  useEffect(() => {
    if (prevColorRef.current !== selectedColor) {
      prevColorRef.current = selectedColor;
      setVirtualIndex(0);
    }
  }, [selectedColor]);

  // Preload adjacent high-res images off-thread
  useEffect(() => {
    if (count === 0) return;
    [1, -1].forEach((offset) => {
      const target = images[(activeIndex + offset + count) % count];
      if (target) new Image().src = convertFileSrc(target.path);
    });
  }, [activeIndex, count, images]);

  const handleRefresh = useCallback(async () => {
    if (!onRefresh || isRefreshing) return;
    setIsRefreshing(true);
    setRefreshNotification('Checking for new images…');
    try {
      const result = await onRefresh();
      setRefreshNotification(
        Array.isArray(result) ? `Library updated · ${result.length} wallpapers` : 'Library updated'
      );
    } catch {
      setRefreshNotification('Failed to check for new images');
    } finally {
      setIsRefreshing(false);
      setTimeout(() => setRefreshNotification(null), 2000);
    }
  }, [onRefresh, isRefreshing]);

  const move = useCallback(
    (dx: number, dy: number) => {
      if (count === 0) return;
      if (isGridMode(mode)) {
        setVirtualIndex(gridNeighbor(cells, activeIndex, dx, dy));
      } else {
        setVirtualIndex((prev) => prev + (dx || dy));
      }
    },
    [count, mode, cells, activeIndex]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'l') {
        e.preventDefault();
        move(1, 0);
      } else if (e.key === 'ArrowLeft' || e.key === 'h') {
        e.preventDefault();
        move(-1, 0);
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        move(0, 1);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        move(0, -1);
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
  }, [move, handleRefresh]);

  const lastWheelTimeRef = useRef(0);
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const now = performance.now();
    const delta = Math.abs(e.deltaX) > 20 ? e.deltaX : e.deltaY;
    if (now - lastWheelTimeRef.current < 120 || Math.abs(delta) <= 20) return;
    lastWheelTimeRef.current = now;
    setVirtualIndex((prev) => prev + Math.sign(delta));
  }, []);

  useEffect(() => {
    const handleSetActive = () => {
      if (activeEntry) onSetWallpaper(activeEntry);
    };
    window.addEventListener('set-active-wallpaper', handleSetActive);
    return () => window.removeEventListener('set-active-wallpaper', handleSetActive);
  }, [activeEntry, onSetWallpaper]);

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

  const toast = refreshNotification && (
    <div className="shard-toast">
      <span className="shard-toast-dot" />
      <span>{refreshNotification}</span>
    </div>
  );

  const colorBar = onSelectColor && (
    <ColorFilterBar selectedColor={selectedColor} onSelectColor={onSelectColor} />
  );

  if (!activeEntry) {
    if (selectedColor && onSelectColor) {
      return (
        <div className={`shard-viewport ${blurClass}`} onClick={handleBackdropClick}>
          {colorBar}
          {toast}
          <div className="shard-empty color-empty">
            <p>No wallpapers match this color</p>
            <button
              type="button"
              className="shard-show-all-btn"
              onClick={() => onSelectColor(null)}
            >
              Show All
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="shard-empty">
        <p>No wallpapers found in the selected directory.</p>
        <button className="shard-settings-link" onClick={() => openSettingsWindow()}>
          Open Settings
        </button>
      </div>
    );
  }

  return (
    <div
      className={`shard-viewport style-viewport style-${mode} ${blurClass}`}
      onWheel={handleWheel}
      onClick={handleBackdropClick}
    >
      {blurBackground &&
        (blurSource === 'wallpaper' ? (
          <div className="wallpaper-backdrop-container">
            <img
              src={convertFileSrc(activeEntry.thumbnail)}
              alt=""
              className="desktop-backdrop wallpaper-backdrop"
              draggable={false}
            />
          </div>
        ) : (
          backdropImage && (
            <img
              src={`data:image/jpeg;base64,${backdropImage}`}
              alt=""
              className="desktop-backdrop"
              draggable={false}
            />
          )
        ))}
      {colorBar}
      {toast}
      <div className="style-stage" onClick={handleBackdropClick}>
        {mode === 'sandy' && (
          <SandHero
            entry={activeEntry}
            hero={sandyHero(viewport)}
            onApply={() => onSetWallpaper(activeEntry)}
          />
        )}
        {poses.map((pose) => {
          const entry = images[pose.index];
          const showFull = pose.isActive && mode !== 'sandy';
          return (
            <div
              key={pose.key}
              className={`style-card ${pose.isActive ? 'active' : 'inactive'} ${pose.clip ? 'clipped' : ''}`}
              style={{
                width: pose.w,
                height: pose.h,
                opacity: pose.opacity,
                zIndex: pose.zIndex,
                borderRadius: pose.radius,
                clipPath: pose.clip,
                pointerEvents: pose.opacity === 0 ? 'none' : undefined,
                transform:
                  `translate(-50%, -50%) translate3d(${pose.x}px, ${pose.y}px, ${pose.z}px) ` +
                  `rotateY(${pose.rotateY}deg) rotate(${pose.rotate}deg) skewX(${pose.skew}deg)`,
                ['--unskew' as string]: `${-pose.skew}deg`,
              }}
              onClick={() => {
                if (!pose.isActive) setVirtualIndex(pose.index);
              }}
              onDoubleClick={() => onSetWallpaper(entry)}
            >
              <img
                src={convertFileSrc(entry.thumbnail)}
                alt={entry.filename}
                className={`style-image ${pose.skew ? 'skewed' : ''}`}
                draggable={false}
              />
              {showFull && (
                <img
                  src={convertFileSrc(entry.path)}
                  alt=""
                  className={`style-image ${pose.skew ? 'skewed' : ''}`}
                  draggable={false}
                  decoding="async"
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="style-pill">
        <span className="shard-pill-resolution">{pillResolution(activeEntry)}</span>
        <div className="shard-pill-bottom">
          <span className="shard-pill-name" title={activeEntry.filename}>
            {activeEntry.filename}
          </span>
          <span className="shard-pill-tag">{pillTag(activeEntry)}</span>
        </div>
      </div>
    </div>
  );
}
