import { useCallback, useRef, useEffect } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { EffectCoverflow, Keyboard } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';
import { convertFileSrc, openSettingsWindow } from '../lib/tauri';
import type { WallpaperEntry } from '../types';

import 'swiper/css';
import 'swiper/css/effect-coverflow';
import './Coverflow.css';

interface CoverflowProps {
  images: WallpaperEntry[];
  onSetWallpaper: (entry: WallpaperEntry) => void;
}

export default function Coverflow({ images, onSetWallpaper }: CoverflowProps) {
  const swiperRef = useRef<SwiperType | null>(null);

  const handleDoubleClick = useCallback(() => {
    if (swiperRef.current) {
      const realIndex = swiperRef.current.realIndex;
      onSetWallpaper(images[realIndex]);
    }
  }, [images, onSetWallpaper]);

  const getCurrentEntry = useCallback((): WallpaperEntry | null => {
    if (swiperRef.current && images.length > 0) {
      return images[swiperRef.current.realIndex];
    }
    return null;
  }, [images]);

  // Listen for Enter key event from App
  useEffect(() => {
    const handleSetActive = () => {
      const entry = getCurrentEntry();
      if (entry) {
        onSetWallpaper(entry);
      }
    };
    window.addEventListener('set-active-wallpaper', handleSetActive);
    return () => window.removeEventListener('set-active-wallpaper', handleSetActive);
  }, [getCurrentEntry, onSetWallpaper]);

  if (images.length === 0) {
    return (
      <div className="coverflow-empty">
        <p>No wallpapers found in the selected directory.</p>
      </div>
    );
  }

  return (
    <div className="coverflow-container">
      <button
        className="coverflow-settings-btn"
        title="Settings"
        onClick={() => openSettingsWindow()}
      >
        ⚙️
      </button>
      <Swiper
        modules={[EffectCoverflow, Keyboard]}
        effect="coverflow"
        centeredSlides={true}
        slidesPerView="auto"
        loop={images.length > 2}
        keyboard={{ enabled: true }}
        coverflowEffect={{
          rotate: 35,
          stretch: -60,
          depth: 250,
          modifier: 1,
          slideShadows: false,
        }}
        onSwiper={(swiper) => {
          swiperRef.current = swiper;
        }}
        onDoubleClick={handleDoubleClick}
        className="coverflow-swiper"
      >
        {images.map((img) => (
          <SwiperSlide key={img.path} className="coverflow-slide">
            {({ isActive }) => (
              <div className="slide-content">
                <img
                  src={
                    isActive
                      ? convertFileSrc(img.path)
                      : `data:image/png;base64,${img.thumbnail}`
                  }
                  alt={img.filename}
                  className={`slide-image ${isActive ? 'active' : 'inactive'}`}
                  draggable={false}
                />
                {isActive && (
                  <div className="filename-pill">
                    {img.filename}
                  </div>
                )}
              </div>
            )}
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
}
