import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { openSettingsWindow, logImageSwitch, logFrontend, isSamePath, pillResolution, pillTag } from '../lib/tauri';
import type { WallpaperEntry, BlurMode, BlurSource, PlayerSkin, VinylSpeed } from '../types';
import ColorFilterBar from './ColorFilterBar';
import './Vinylflow.css';

interface VinylflowProps {
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
  skin?: PlayerSkin;
  rotation?: boolean;
  speed?: VinylSpeed;
  armTracking?: boolean;
}

const LRU_CAPACITY = 8;

/**
 * Smoothly interpolates an animation's playbackRate using requestAnimationFrame.
 * Avoids periodic keyframe pulsing by maintaining linear steady-state rotation.
 */
function rampPlaybackRate(
  anim: Animation,
  targetRate: number,
  durationMs: number,
  onComplete?: () => void
): () => void {
  const startRate = anim.playbackRate;
  if (Math.abs(startRate - targetRate) < 0.01) {
    anim.playbackRate = targetRate;
    if (targetRate === 0 && anim.playState !== 'paused') {
      anim.pause();
    }
    onComplete?.();
    return () => {};
  }

  if (targetRate > 0 && anim.playState === 'paused') {
    anim.play();
  }

  const startTime = performance.now();
  let rafId: number;

  const tick = (now: number) => {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / Math.max(1, durationMs));
    // Smooth cubic ease-out
    const eased = 1 - Math.pow(1 - progress, 3);
    const newRate = startRate + (targetRate - startRate) * eased;
    anim.playbackRate = Math.max(0, newRate);

    if (progress < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      anim.playbackRate = targetRate;
      if (targetRate === 0 && anim.playState !== 'paused') {
        anim.pause();
      }
      onComplete?.();
    }
  };

  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * Synthesizes an authentic analog needle-drop sound using Web Audio API.
 * Uses low-frequency stylus flex pop, mechanical diamond tick, and groove crackle.
 */
function playNeedleDropAudio() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // 1. Stylus contact thump (punchy sub-bass pop)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const startTime = ctx.currentTime + 0.005;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(85, startTime);
    osc.frequency.exponentialRampToValueAtTime(30, startTime + 0.08);

    gain.gain.setValueAtTime(0.35, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + 0.08);

    // 2. Micro needle contact tick / click
    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(850, startTime);
    clickOsc.frequency.exponentialRampToValueAtTime(140, startTime + 0.02);

    clickGain.gain.setValueAtTime(0.20, startTime);
    clickGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.02);

    clickOsc.connect(clickGain);
    clickGain.connect(ctx.destination);

    clickOsc.start(startTime);
    clickOsc.stop(startTime + 0.02);

    // 3. Subtle vinyl surface crackle
    const bufferSize = Math.floor(ctx.sampleRate * 0.06);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(2200, startTime);
    noiseFilter.Q.setValueAtTime(2.0, startTime);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.12, startTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.06);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    noise.start(startTime + 0.005);
    noise.stop(startTime + 0.065);
  } catch {
    // AudioContext blocked
  }
}

export default function Vinylflow({
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
  skin = 'wood',
  rotation = true,
  speed = '33',
  armTracking = true,
}: VinylflowProps) {
  const findWallpaperIndex = useCallback(
    (targetPath?: string | null) => {
      if (!targetPath || images.length === 0) return 0;
      const idx = images.findIndex((img) => isSamePath(img.path, targetPath));
      return idx !== -1 ? idx : 0;
    },
    [images]
  );

  const [virtualIndex, setVirtualIndex] = useState(() => findWallpaperIndex(lastWallpaper));
  const [activeLastWallpaper, setActiveLastWallpaper] = useState<string | null>(lastWallpaper);
  const [loadedHighResMap, setLoadedHighResMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (lastWallpaper) {
      setActiveLastWallpaper(lastWallpaper);
    }
  }, [lastWallpaper]);

  // Dynamic user preferences with prop sync
  const [currentSkin, setCurrentSkin] = useState<PlayerSkin>(skin);
  const [currentRotation, setCurrentRotation] = useState<boolean>(rotation);
  const [currentSpeed, setCurrentSpeed] = useState<VinylSpeed>(speed);
  const [currentArmTracking, setCurrentArmTracking] = useState<boolean>(armTracking);

  useEffect(() => {
    setCurrentSkin(skin);
  }, [skin]);

  useEffect(() => {
    setCurrentRotation(rotation);
  }, [rotation]);

  useEffect(() => {
    setCurrentSpeed(speed);
  }, [speed]);

  useEffect(() => {
    setCurrentArmTracking(armTracking);
  }, [armTracking]);

  const count = images.length;

  // Actual index in images array
  const activeActualIndex = count > 0 ? ((virtualIndex % count) + count) % count : 0;
  const progressRatio = count > 1 ? activeActualIndex / (count - 1) : 0;
  const armTrackAngle = currentArmTracking ? progressRatio * 11 : 0;

  // Neighbor indices for left and right record sleeves
  const prevActualIndex = count > 1 ? ((activeActualIndex - 1 + count) % count) : null;
  const nextActualIndex = count > 1 ? ((activeActualIndex + 1) % count) : null;

  const currentWallpaper = images[activeActualIndex] || null;
  const prevWallpaper = prevActualIndex !== null ? images[prevActualIndex] : null;
  const nextWallpaper = nextActualIndex !== null ? images[nextActualIndex] : null;

  // Active status: ONLY spin when currently on the desktop wallpaper
  const isCurrentActive = Boolean(
    currentWallpaper &&
    activeLastWallpaper &&
    isSamePath(currentWallpaper.path, activeLastWallpaper)
  );

  // Window Visibility & Resource Saver State
  const [isWindowVisible, setIsWindowVisible] = useState(true);

  // Spacebar Lightbox Preview State
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Motion Choreography States
  const [isArmLifted, setIsArmLifted] = useState(false);
  const [isNeedleBumping, setIsNeedleBumping] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [swapDirection, setSwapDirection] = useState<'next' | 'prev'>('next');
  const [outgoingRecord, setOutgoingRecord] = useState<WallpaperEntry | null>(null);

  // References for Animation & Timers
  const rotatorRef = useRef<HTMLDivElement | null>(null);
  const spinAnimationRef = useRef<Animation | null>(null);
  const cancelRampRef = useRef<(() => void) | null>(null);
  const isSwappingRef = useRef(false);
  const swapTimerRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const isReducedMotionRef = useRef(false);

  // Evaluated spinning condition: MUST be currently active wallpaper!
  const shouldSpin = Boolean(
    isCurrentActive &&
    currentRotation &&
    !isReducedMotionRef.current &&
    isWindowVisible
  );
  const shouldSpinRef = useRef(shouldSpin);
  useEffect(() => {
    shouldSpinRef.current = shouldSpin;
  }, [shouldSpin]);

  // Reduced motion media query listener
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    isReducedMotionRef.current = mq.matches;
    const handler = (e: MediaQueryListEvent) => {
      isReducedMotionRef.current = e.matches;
      if (e.matches && spinAnimationRef.current) {
        spinAnimationRef.current.playbackRate = 0;
        spinAnimationRef.current.pause();
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Web Audio unlock on user interaction
  useEffect(() => {
    const unlockAudio = () => {
      const ctx = getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    };

    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);

  // Web Animations API: Initialize steady-state linear rotation on vinyl disc
  const createAnimation = useCallback(
    (el: HTMLDivElement) => {
      if (spinAnimationRef.current) {
        spinAnimationRef.current.cancel();
        spinAnimationRef.current = null;
      }

      // Duration: 1800ms for 33⅓ RPM (~1.8s/rev), 1333ms for 45 RPM (~1.333s/rev)
      const revDuration = currentSpeed === '45' ? 1333 : 1800;

      const anim = el.animate(
        [
          { transform: 'rotate(0deg)' },
          { transform: 'rotate(360deg)' },
        ],
        {
          duration: revDuration,
          iterations: Infinity,
          easing: 'linear',
        }
      );

      spinAnimationRef.current = anim;
      anim.playbackRate = 0;
      anim.pause();
      return anim;
    },
    [currentSpeed]
  );

  const setRotatorRef = useCallback(
    (node: HTMLDivElement | null) => {
      rotatorRef.current = node;
      if (node && !spinAnimationRef.current) {
        const anim = createAnimation(node);
        if (shouldSpinRef.current) {
          anim.play();
          rampPlaybackRate(anim, 1.0, 400);
        }
      }
    },
    [createAnimation]
  );

  // Sync rotation playbackRate with shouldSpin whenever state changes
  useEffect(() => {
    let anim = spinAnimationRef.current;
    if (!anim && rotatorRef.current) {
      anim = createAnimation(rotatorRef.current);
    }
    if (!anim) return;

    if (cancelRampRef.current) {
      cancelRampRef.current();
      cancelRampRef.current = null;
    }

    if (shouldSpin) {
      if (anim.playState === 'paused') {
        anim.play();
      }
      cancelRampRef.current = rampPlaybackRate(anim, 1.0, 350);
    } else {
      cancelRampRef.current = rampPlaybackRate(anim, 0.0, 250);
    }
  }, [shouldSpin, createAnimation]);

  // Window Visibility Listeners: 0% GPU load while window is hidden
  useEffect(() => {
    let isMounted = true;

    const handleHidden = () => {
      if (!isMounted) return;
      setIsWindowVisible(false);
      if (spinAnimationRef.current) {
        spinAnimationRef.current.pause();
      }
    };

    const handleShown = () => {
      if (!isMounted) return;
      setIsWindowVisible(true);
      if (spinAnimationRef.current && shouldSpinRef.current) {
        spinAnimationRef.current.play();
        if (cancelRampRef.current) cancelRampRef.current();
        cancelRampRef.current = rampPlaybackRate(spinAnimationRef.current, 1.0, 350);
      }
    };

    const unlistenHiddenPromise = listen('window-hidden', handleHidden);
    const unlistenShownPromise = listen('window-shown', handleShown);

    const handleBlur = () => {
      handleHidden();
      setIsPreviewOpen(false);
    };
    const handleFocus = () => handleShown();
    const handleVisibilityChange = () => {
      if (document.hidden) handleHidden();
      else handleShown();
    };

    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      unlistenHiddenPromise.then((fn) => fn());
      unlistenShownPromise.then((fn) => fn());
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Initial sync when wallpapers load
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

  // Re-sync when reset event fires
  useEffect(() => {
    const handleReset = (e: Event) => {
      const customEvent = e as CustomEvent<{ lastWallpaper?: string | null }>;
      const targetPath = customEvent.detail?.lastWallpaper ?? lastWallpaper;
      if (targetPath) {
        setActiveLastWallpaper(targetPath);
      }
      const targetIdx = findWallpaperIndex(targetPath);
      switchStartRef.current = performance.now();
      setVirtualIndex(targetIdx);
    };

    window.addEventListener('reset-to-last-wallpaper', handleReset);
    return () => window.removeEventListener('reset-to-last-wallpaper', handleReset);
  }, [findWallpaperIndex, lastWallpaper]);

  useEffect(() => {
    logFrontend('INFO', `[Vinylflow] Active | ${count} images | Skin: ${currentSkin} | Rotation: ${currentRotation} | Speed: ${currentSpeed}`);
  }, [count, currentSkin, currentRotation, currentSpeed]);

  // Reset to index 0 if color filter changes
  const prevColorRef = useRef(selectedColor);
  useEffect(() => {
    if (prevColorRef.current !== selectedColor) {
      prevColorRef.current = selectedColor;
      setVirtualIndex(0);
    }
  }, [selectedColor]);

  // Timing and logging refs
  const switchStartRef = useRef<number>(performance.now());
  const prevIndexRef = useRef<number>(activeActualIndex);

  // Debounce high-res loading to prevent asset bottleneck during rapid navigation
  const [debouncedIndex, setDebouncedIndex] = useState(activeActualIndex);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedIndex(activeActualIndex);
    }, 60);
    return () => clearTimeout(timer);
  }, [activeActualIndex]);

  // Texture keep-alive cache
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

  // Preload adjacent images
  useEffect(() => {
    if (count <= 1) return;
    const toPreload = [
      ((activeActualIndex + 1) % count),
      ((activeActualIndex - 1 + count) % count),
    ];
    toPreload.forEach((idx) => {
      const target = images[idx];
      if (target?.thumbnail) {
        const img = new Image();
        img.src = convertFileSrc(target.thumbnail);
      }
    });
  }, [activeActualIndex, count, images]);

  // Log image switch metrics
  useEffect(() => {
    const prevIdx = prevIndexRef.current;
    if (count > 0 && prevIdx !== activeActualIndex) {
      const latency = performance.now() - switchStartRef.current;
      const prevImg = images[prevIdx];
      const currImg = images[activeActualIndex];

      if (prevImg && currImg) {
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

  // Motion Choreography & Key-Repeat Guard: Overlapped timing under ~250ms total
  const triggerNavigation = useCallback(
    (direction: 1 | -1) => {
      if (count === 0) return;
      switchStartRef.current = performance.now();

      const targetDirection: 'next' | 'prev' = direction === 1 ? 'next' : 'prev';

      // Instant swap under reduced-motion preferences
      if (isReducedMotionRef.current) {
        setVirtualIndex((prev) => prev + direction);
        return;
      }

      const isRapid = isSwappingRef.current;

      if (isRapid) {
        // Rapid navigation / held key repeat: cancel running slide, snap, keep arm lifted
        if (swapTimerRef.current) window.clearTimeout(swapTimerRef.current);
        if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);

        setOutgoingRecord(null);
        setIsSwapping(false);
        setIsArmLifted(true);
      } else {
        // Single navigation: lift tonearm and begin record slide
        setIsArmLifted(true);
        setOutgoingRecord(images[activeActualIndex] || null);
        setSwapDirection(targetDirection);
        setIsSwapping(true);
        isSwappingRef.current = true;

        // Briefly ease spin rate down during record swap if currently spinning
        if (spinAnimationRef.current && shouldSpinRef.current) {
          if (cancelRampRef.current) cancelRampRef.current();
          cancelRampRef.current = rampPlaybackRate(spinAnimationRef.current, 0.25, 100);
        }

        // Slide duration completes in 200ms
        swapTimerRef.current = window.setTimeout(() => {
          setOutgoingRecord(null);
          setIsSwapping(false);
          isSwappingRef.current = false;
        }, 205);
      }

      // Update virtual index immediately so labels update instantly
      setVirtualIndex((prev) => prev + direction);

      // Settle timer: drop tonearm and ramp spin rate back up once rapid navigation stops
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => {
        setOutgoingRecord(null);
        setIsSwapping(false);
        isSwappingRef.current = false;
        setIsArmLifted(false);
        playNeedleDropAudio();

        // Resume full rotation rate only if currently active wallpaper
        if (spinAnimationRef.current && shouldSpinRef.current) {
          if (cancelRampRef.current) cancelRampRef.current();
          cancelRampRef.current = rampPlaybackRate(spinAnimationRef.current, 1.0, 260);
        } else if (spinAnimationRef.current) {
          if (cancelRampRef.current) cancelRampRef.current();
          cancelRampRef.current = rampPlaybackRate(spinAnimationRef.current, 0.0, 150);
        }
      }, 230);
    },
    [count, images, activeActualIndex]
  );

  const nextSlide = useCallback(() => triggerNavigation(1), [triggerNavigation]);
  const prevSlide = useCallback(() => triggerNavigation(-1), [triggerNavigation]);

  // Apply Wallpaper: NEVER BLOCKED by animation
  const handleApply = useCallback(() => {
    if (!currentWallpaper) return;
    setActiveLastWallpaper(currentWallpaper.path);

    // 1. Apply wallpaper first via Win32 API
    onSetWallpaper(currentWallpaper);

    // 2. Play cosmetic needle bump flourish & audio
    setIsNeedleBumping(true);
    playNeedleDropAudio();
    setTimeout(() => setIsNeedleBumping(false), 180);
  }, [currentWallpaper, onSetWallpaper]);

  // Keyboard navigation & Spacebar preview hold
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctx = getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) {
          setIsPreviewOpen(true);
        }
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'l') {
        e.preventDefault();
        nextSlide();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'h') {
        e.preventDefault();
        prevSlide();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleApply();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleRefresh();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        getCurrentWindow().hide();
        openSettingsWindow();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPreviewOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [nextSlide, prevSlide, handleApply, handleRefresh]);

  const lastWheelTimeRef = useRef<number>(0);

  // Mouse wheel navigation with 120ms cooldown guard
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
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
    },
    [nextSlide, prevSlide]
  );

  // Enter key trigger from global window event
  useEffect(() => {
    const handleSetActive = () => {
      handleApply();
    };
    window.addEventListener('set-active-wallpaper', handleSetActive);
    return () => window.removeEventListener('set-active-wallpaper', handleSetActive);
  }, [handleApply]);

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

  // Quick toolbar toggles for Stage 2 interactive verification
  const toggleSkin = () => {
    setCurrentSkin((prev) => (prev === 'wood' ? 'modern-black' : 'wood'));
  };

  const toggleRotation = () => {
    setCurrentRotation((prev) => !prev);
  };

  const toggleSpeed = () => {
    setCurrentSpeed((prev) => (prev === '33' ? '45' : '33'));
  };

  if (count === 0) {
    return (
      <div className={`vinyl-viewport ${blurClass}`} onClick={handleBackdropClick}>
        <div className="gallery-empty">
          <p>No wallpapers found in the selected directory.</p>
          <button className="gallery-settings-link" onClick={() => openSettingsWindow()}>
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  const fileExt = currentWallpaper ? pillTag(currentWallpaper) : 'IMG';
  const isHighResReady = currentWallpaper ? loadedHighResMap[currentWallpaper.path] : false;

  return (
    <div
      className={`vinyl-viewport ${blurClass}`}
      onWheel={handleWheel}
      onClick={handleBackdropClick}
    >
      {/* Background blur support */}
      {blurBackground && (
        blurSource === 'wallpaper' ? (
          currentWallpaper && (
            <div className="wallpaper-backdrop-container">
              <img
                src={convertFileSrc(currentWallpaper.thumbnail)}
                alt=""
                className="desktop-backdrop wallpaper-backdrop"
                draggable={false}
              />
              {isHighResReady && (
                <img
                  src={convertFileSrc(currentWallpaper.path)}
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

      {/* Color Filter Bar */}
      {onSelectColor && (
        <ColorFilterBar selectedColor={selectedColor} onSelectColor={onSelectColor} />
      )}

      {/* Stage 2 Quick Controls Bar (Skin, Rotation, Speed) */}
      <div className="vinyl-controls-bar">
        <button
          type="button"
          className="vinyl-control-btn"
          onClick={toggleSkin}
          title="Toggle player plinth skin"
        >
          Skin: {currentSkin === 'wood' ? 'Walnut Wood' : 'Modern Black'}
        </button>
        <button
          type="button"
          className={`vinyl-control-btn ${currentRotation ? 'is-active' : ''}`}
          onClick={toggleRotation}
          title="Toggle 33⅓/45 RPM record rotation"
        >
          Spin: {currentRotation ? 'ON' : 'OFF'}
        </button>
        <button
          type="button"
          className="vinyl-control-btn"
          onClick={toggleSpeed}
          title="Toggle platter rotation speed"
        >
          {currentSpeed === '33' ? '33⅓ RPM' : '45 RPM'}
        </button>
      </div>

      {/* Notification Toast */}
      {refreshNotification && (
        <div className="gallery-toast">
          <span className="gallery-toast-dot" />
          <span>{refreshNotification}</span>
        </div>
      )}

      <div className="vinyl-stage" onClick={handleBackdropClick}>
        {/* =================================================================
            Left Sleeve: Previous Wallpaper (-16° In-Plane Rotation)
            ================================================================= */}
        <div
          className={`sleeve-container sleeve-left ${isSwapping && swapDirection === 'next' ? 'is-receiving' : ''}`}
          onClick={prevSlide}
          title={prevWallpaper ? `Previous: ${prevWallpaper.filename}` : 'Previous'}
        >
          {prevWallpaper ? (
            <div className="sleeve-card">
              <img
                src={convertFileSrc(prevWallpaper.thumbnail)}
                alt={prevWallpaper.filename}
                className="sleeve-thumb"
                draggable={false}
              />
              <span className="sleeve-badge">Previous</span>
            </div>
          ) : (
            <div className="sleeve-card sleeve-empty">
              <div className="sleeve-empty-disc-icon">
                <div className="sleeve-empty-hole" />
              </div>
            </div>
          )}
        </div>

        {/* =================================================================
            Center Turntable: Plinth, Platter, Sliding Vinyl Discs & Tonearm
            ================================================================= */}
        <div className="turntable-container">
          <div className="turntable-plinth" data-skin={currentSkin}>
            {/* Platter with prominent rim highlight */}
            <div className="turntable-platter">
              <div className="vinyl-record-assembly">
                {/* Outgoing Disc during navigation transition */}
                {outgoingRecord && (
                  <div
                    className={`vinyl-disc-slot vinyl-slot-outgoing vinyl-swap-${swapDirection}`}
                    aria-hidden="true"
                  >
                    <div className="vinyl-disc-body">
                      <div className="vinyl-grooves" />
                      <div className="record-label">
                        <img
                          src={convertFileSrc(outgoingRecord.thumbnail)}
                          alt=""
                          className="record-label-thumb"
                          draggable={false}
                        />
                        <div className="spindle-hole" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Active / Incoming Disc */}
                {currentWallpaper && (
                  <div
                    className={`vinyl-disc-slot ${isSwapping ? `vinyl-slot-incoming vinyl-swap-${swapDirection}` : ''}`}
                    style={{ display: isWindowVisible ? 'flex' : 'none' }}
                  >
                    <div
                      ref={setRotatorRef}
                      className="vinyl-disc-body"
                      onDoubleClick={handleApply}
                      title="Double click or press Enter to set as wallpaper"
                    >
                      {/* Concentric sound grooves */}
                      <div className="vinyl-grooves" />

                      {/* Center Wallpaper Label (~48% of disc diameter) */}
                      <div className="record-label">
                        {/* Layer 1: Instant RAM/disk thumbnail */}
                        <img
                          src={convertFileSrc(currentWallpaper.thumbnail)}
                          alt={currentWallpaper.filename}
                          className="record-label-thumb"
                          draggable={false}
                        />

                        {/* Layer 2: Asynchronous High-Res image */}
                        <img
                          src={convertFileSrc(currentWallpaper.path)}
                          alt={currentWallpaper.filename}
                          className={`record-label-full ${isHighResReady ? 'is-loaded' : ''}`}
                          draggable={false}
                          decoding="async"
                          onLoad={() => handleHighResLoaded(currentWallpaper.path, currentWallpaper.filename)}
                        />

                        {/* Circular Rim Text following label curve */}
                        <svg className="record-label-rim-svg" viewBox="0 0 178 178" aria-hidden="true">
                          <defs>
                            <path
                              id="label-rim-path"
                              d="M 89, 89 m -74, 0 a 74,74 0 1,1 148,0 a 74,74 0 1,1 -148,0"
                            />
                          </defs>
                          <text className="record-label-rim-text">
                            <textPath href="#label-rim-path" startOffset="50%" textAnchor="middle">
                              {currentWallpaper.filename.replace(/\.[^/.]+$/, '').toUpperCase()}
                            </textPath>
                          </text>
                        </svg>

                        {/* Center Spindle Hole */}
                        <div className="spindle-hole" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Static specular highlight overlay (DOES NOT ROTATE) */}
                <div className="vinyl-specular" />
              </div>
            </div>

            {/* Tonearm Assembly (Pivoting from top-right) */}
            <div
              className={`tonearm-assembly ${isArmLifted ? 'is-lifted' : ''} ${isNeedleBumping ? 'is-bumping' : ''}`}
              style={{
                transform: isArmLifted
                  ? 'rotate(-10deg)'
                  : isNeedleBumping
                  ? `rotate(${armTrackAngle + 0.8}deg) translateY(2px)`
                  : `rotate(${armTrackAngle}deg)`,
              }}
            >
              <div className="tonearm-counterweight" />
              <div className="tonearm-gimbal" />
              <div className="tonearm-tube">
                <div className="tonearm-headshell" />
              </div>
            </div>

            {/* Tonearm Rest Post */}
            <div className="tonearm-rest" />
          </div>
        </div>

        {/* =================================================================
            Right Sleeve: Next Wallpaper (+16° In-Plane Rotation)
            ================================================================= */}
        <div
          className={`sleeve-container sleeve-right ${isSwapping && swapDirection === 'prev' ? 'is-receiving' : ''}`}
          onClick={nextSlide}
          title={nextWallpaper ? `Next: ${nextWallpaper.filename}` : 'Next'}
        >
          {nextWallpaper ? (
            <div className="sleeve-card">
              <img
                src={convertFileSrc(nextWallpaper.thumbnail)}
                alt={nextWallpaper.filename}
                className="sleeve-thumb"
                draggable={false}
              />
              <span className="sleeve-badge">Next</span>
            </div>
          ) : (
            <div className="sleeve-card sleeve-empty">
              <div className="sleeve-empty-disc-icon">
                <div className="sleeve-empty-hole" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Spacebar Hold Preview Lightbox (Un-cropped Full Resolution on Flat Dark Scrim) */}
      {isPreviewOpen && currentWallpaper && (
        <div
          className="vinyl-preview-backdrop"
          onClick={() => setIsPreviewOpen(false)}
        >
          <div
            className="vinyl-preview-card"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={handleApply}
            title="Double click or press Enter to set as wallpaper"
          >
            <img
              src={convertFileSrc(currentWallpaper.path)}
              alt={currentWallpaper.filename}
              className="vinyl-preview-image"
              draggable={false}
            />
            <div className="vinyl-preview-footer">
              <div className="vinyl-preview-meta">
                <span className="vinyl-preview-filename">{currentWallpaper.filename}</span>
                <span className="vinyl-preview-dims">
                  {pillResolution(currentWallpaper)}
                  {!currentWallpaper.project && (
                    <>
                      {' · '}
                      {formatFileSize(currentWallpaper.file_size)}
                    </>
                  )}
                </span>
              </div>
              <div className="vinyl-preview-hint">
                Press <kbd>Enter</kbd> to Apply · Release <kbd>Space</kbd> to Exit
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Metadata Pill */}
      {currentWallpaper && (
        <div className="vinyl-info-pill">
          {isCurrentActive && (
            <div className="vinyl-pill-playing-badge" title="Currently active desktop wallpaper">
              <span className="vinyl-pill-playing-dot" />
              NOW PLAYING
            </div>
          )}
          <span className="vinyl-pill-title" title={currentWallpaper.filename}>
            {currentWallpaper.filename}
          </span>
          <span className="vinyl-pill-meta">
            {pillResolution(currentWallpaper)}
            {!currentWallpaper.project && (
              <>
                {' · '}
                {formatFileSize(currentWallpaper.file_size)}
              </>
            )}
          </span>
          <span className="vinyl-pill-tag">{fileExt}</span>
          <button
            type="button"
            className="vinyl-pill-preview-btn"
            onClick={() => setIsPreviewOpen((prev) => !prev)}
            title="Hold Spacebar to preview full un-cropped wallpaper"
          >
            {isPreviewOpen ? 'Exit Preview' : 'Space Preview'}
          </button>
        </div>
      )}

      {/* Offscreen Keep-Alive: Retains decoded GPU textures in DOM */}
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
