import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  setWallpaperDirectory,
  enableWallpaperEngine,
  setAutostart,
  setPreventHide,
} from "../lib/tauri";
import "./SetupScreen.css";

interface SetupScreenProps {
  onDirectorySet: () => void;
}

export default function SetupScreen({ onDirectorySet }: SetupScreenProps) {
  const [step, setStep] = useState<"folder" | "autostart">("folder");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectFolder = async () => {
    try {
      await setPreventHide(true);
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Wallpaper Directory",
      });

      if (selected && typeof selected === "string") {
        setLoading(true);
        setError(null);
        await setWallpaperDirectory(selected);
        setStep("autostart");
      } else {
        await setPreventHide(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await setPreventHide(false);
    } finally {
      setLoading(false);
    }
  };

  const handleUseWallpaperEngine = async () => {
    setLoading(true);
    setError(null);
    try {
      await setPreventHide(true);
      await enableWallpaperEngine();
      setStep("autostart");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await setPreventHide(false);
    } finally {
      setLoading(false);
    }
  };

  const handleAutostartChoice = async (enable: boolean) => {
    setLoading(true);
    setError(null);
    try {
      await setAutostart(enable);
      await setPreventHide(false);
      onDirectorySet();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  };

  useEffect(() => {
    if (step !== "autostart") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleAutostartChoice(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [step]);

  if (step === "autostart") {
    return (
      <div className="setup-screen">
        <div className="setup-card">
          <div className="setup-icon">🚀</div>
          <h1 className="setup-title">Start with Windows?</h1>
          <p className="setup-description">
            Launch carousel automatically when Windows boots. It sits quietly in
            your system tray so you can press <strong>Alt+W</strong> anytime.
          </p>
          <div className="setup-actions">
            <button
              className="setup-button setup-button-primary"
              onClick={() => handleAutostartChoice(true)}
              disabled={loading}
              autoFocus
            >
              {loading ? "Saving…" : "Yes, start with Windows"}
            </button>
            <button
              className="setup-button setup-button-secondary"
              onClick={() => handleAutostartChoice(false)}
              disabled={loading}
            >
              No, maybe later
            </button>
          </div>
          <p className="setup-hint">
            You can change this anytime from Settings.
          </p>
          {error && <p className="setup-error">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-icon">🖼️</div>
        <h1 className="setup-title">carousel</h1>
        <p className="setup-description">
          Select a folder containing your wallpaper images, or use your
          Wallpaper Engine library, to get started.
        </p>
        <div className="setup-actions">
          <button
            className="setup-button setup-button-primary"
            onClick={handleSelectFolder}
            disabled={loading}
            autoFocus
          >
            {loading ? "Setting up..." : "Choose Wallpaper Folder"}
          </button>
          <button
            className="setup-button setup-button-secondary"
            onClick={handleUseWallpaperEngine}
            disabled={loading}
          >
            Use Wallpaper Engine
          </button>
        </div>
        {error && <p className="setup-error">{error}</p>}
        <div className="setup-tip-box">
          <span className="setup-tip-badge">Tip</span>
          <span className="setup-tip-text">
            While the carousel is open, press <kbd className="setup-kbd">R</kbd>{" "}
            to reload images or <kbd className="setup-kbd">S</kbd> to open
            settings.
          </span>
        </div>
      </div>
    </div>
  );
}
