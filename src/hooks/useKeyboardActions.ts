import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function useKeyboardActions(onEnter: () => void) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        getCurrentWindow().hide();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onEnter();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onEnter]);
}
