import { useState, useEffect, useRef, useCallback } from 'react';
import { convertFileSrc, openSettingsWindow } from '../lib/tauri';
import type { WallpaperEntry } from '../types';
import './Coverflow.css';

interface CoverflowProps {
  images: WallpaperEntry[];
  onSetWallpaper: (entry: WallpaperEntry) => void;
}

export default function Coverflow({ images, onSetWallpaper }: CoverflowProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const count = images.length;

  // Safe navigation
  const nextSlide = useCallback(() => {
    if (count === 0) return;
    setActiveIndex((prev) => (prev + 1) % count);
  }, [count]);

  const prevSlide = useCallback(() => {
    if (count === 0) return;
    setActiveIndex((prev) => (prev - 1 + count) % count);
  }, [count]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'l') {
        e.preventDefault();
        nextSlide();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'h') {
        e.preventDefault();
        prevSlide();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextSlide, prevSlide]);

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

  // Listen for Enter key dispatched from App
  useEffect(() => {
    const handleSetActive = () => {
      if (images[activeIndex]) {
        onSetWallpaper(images[activeIndex]);
      }
    };
    window.addEventListener('set-active-wallpaper', handleSetActive);
    return () => window.removeEventListener('set-active-wallpaper', handleSetActive);
  }, [activeIndex, images, onSetWallpaper]);

  // Center active item in viewport
  useEffect(() => {
    const activeEl = itemRefs.current[activeIndex];
    const trackEl = trackRef.current;
    if (activeEl && trackEl) {
      // Calculate how much we need to offset the track so activeEl center matches window center
      const activeCenter = activeEl.offsetLeft + activeEl.offsetWidth / 2;
      const viewportCenter = window.innerWidth / 2;
      const targetTranslate = viewportCenter - activeCenter;
      trackEl.style.transform = `translateX(${targetTranslate}px)`;
    }
  }, [activeIndex, images]);

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

  const activeImage = images[activeIndex];
  const fileExt = activeImage.filename.split('.').pop()?.toUpperCase() || 'IMG';

  return (
    <div className="gallery-viewport" onWheel={handleWheel}>
      <button
        className="gallery-settings-btn"
        title="Settings"
        onClick={() => openSettingsWindow()}
      >
        ⚙️
      </button>

      <div className="gallery-track" ref={trackRef}>
        {images.map((img, idx) => {
          const isActive = idx === activeIndex;

          return (
            <div
              key={img.path}
              ref={(el) => { itemRefs.current[idx] = el; }}
              className={`gallery-card ${isActive ? 'active' : 'inactive'}`}
              onClick={() => setActiveIndex(idx)}
              onDoubleClick={() => onSetWallpaper(img)}
            >
              <img
                src={
                  isActive
                    ? convertFileSrc(img.path)
                    : `data:image/png;base64,${img.thumbnail}`
                }
                alt={img.filename}
                className="gallery-image"
                draggable={false}
              />

              {isActive && (
                <div className="gallery-pill">
                  <span className="pill-name">{img.filename}</span>
                  <span className="pill-tag">{fileExt}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
