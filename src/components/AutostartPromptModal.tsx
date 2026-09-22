import { useState, useEffect } from "react";
import { setAutostart, setPreventHide } from "../lib/tauri";
import "./AutostartPromptModal.css";

interface AutostartPromptModalProps {
  onDone: () => void;
}

export default function AutostartPromptModal({
  onDone,
}: AutostartPromptModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Keep overlay from hiding on accidental click-out during prompt
    setPreventHide(true).catch(console.error);
    return () => {
      setPreventHide(false).catch(console.error);
    };
  }, []);

  const handleChoice = async (enable: boolean) => {
    setLoading(true);
    setError(null);
    try {
      await setAutostart(enable);
      await setPreventHide(false);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  };

  return (
    <div className="autostart-modal-overlay">
      <div className="autostart-modal-card">
        <div className="autostart-modal-icon">🚀</div>
        <h2 className="autostart-modal-title">Start with Windows?</h2>
        <p className="autostart-modal-desc">
          Launch carousel automatically when you log into Windows. It sits
          quietly in your system tray so your wallpaper switcher is always ready
          at <strong>Alt+W</strong>.
        </p>
        <div className="autostart-modal-actions">
          <button
            className="autostart-btn autostart-btn-primary"
            onClick={() => handleChoice(true)}
            disabled={loading}
            autoFocus
          >
            {loading ? "Saving…" : "Yes, start with Windows"}
          </button>
          <button
            className="autostart-btn autostart-btn-secondary"
            onClick={() => handleChoice(false)}
            disabled={loading}
          >
            No, maybe later
          </button>
        </div>
        <p className="autostart-modal-hint">
          You can change this preference anytime in Settings.
        </p>
        {error && <p className="autostart-modal-error">{error}</p>}
      </div>
    </div>
  );
}
