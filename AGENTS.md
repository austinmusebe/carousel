# AGENTS.md

Persistent rules for this repo. Antigravity's context resets between sessions — read
this file first, every session.

## What this is

A Windows-only, frameless overlay app: global-shortcut-triggered Cover Flow wallpaper
picker, Tauri v2 + React/TypeScript frontend, Rust backend calling the Win32 API
directly. Not cross-platform. Not a background daemon beyond the hidden window sitting
ready for the shortcut.

## Non-negotiables

1. **No PowerShell subprocesses, no registry writes** for setting the wallpaper. It's
   `SystemParametersInfoW` via `windows-sys`, full stop. Wallpaper Engine entries are the
   one exception: they go through its own `-control` CLI, run directly with no shell.
2. **The window hides, it never closes**, on Esc or focus loss. The process stays
   resident so the global shortcut keeps working.
3. **Don't pipe full-resolution images through Tauri IPC.** Thumbnails: small encoded
   bytes returned from the scan command. Full centered image: asset protocol +
   `convertFileSrc`, scoped to the configured wallpaper directory only — not `**/*`.
   Wallpaper Engine previews are allowed file by file, never by directory.
4. **The global shortcut is user-configurable**, not hardcoded to Alt+W in source. Read
   it from a config file with Alt+W as the shipped default.
5. **Absolute paths only** for anything crossing into the wallpaper-setting command.
   Resolve on the Rust side; don't trust a path the frontend sent verbatim.

## Before touching window config

Tauri v2 on Windows has had an open issue where `decorations: false` + `shadow: false`
doesn't fully suppress the native title bar (github.com/tauri-apps/tauri/issues/14859).
Check its current status before assuming the declarative config alone will work. If
it's unresolved, the fallback is a direct `windows-sys` call against the window's HWND
(`GetWindowLongPtrW`/`SetWindowLongPtrW` to strip `WS_CAPTION`/`WS_SYSMENU`) — same crate
we're already linking for the wallpaper call, so it's not a new dependency, just more of
the one we have.

## Capabilities

v2's permission system denies everything not explicitly granted, and a missing
permission fails silently on the frontend rather than throwing a clear error — check
`src-tauri/capabilities/*.json` first when something "does nothing." Known permissions
this app needs: `global-shortcut:allow-register`, `global-shortcut:allow-unregister`,
`global-shortcut:allow-is-registered`, plus whatever the asset protocol and window-hide
paths turn out to require — confirm current identifiers against the docs rather than
copying last session's list forward blind.

## Code organization

- `src/` — React frontend. Coverflow component isolated from data-fetching; the
  directory scan and wallpaper-set calls live in a small hooks/service layer, not
  scattered through the component.
- `src-tauri/src/` — one module for the wallpaper Win32 call, one for directory
  scanning/thumbnailing, `lib.rs`/`main.rs` just wiring plugins and commands together.
- Config (shortcut binding, wallpaper directory) in a small JSON/TOML file next to the
  binary or in the app config dir — not hardcoded, not in `tauri.conf.json` (that file is
  build-time config, not user-runtime config).

## Definition of done

1. Builds clean, `cargo clippy` has nothing outstanding
2. Alt+W (or configured shortcut) shows/hides the window from any app, including when
   nothing Tauri-related has focus
3. Esc and focus-loss both hide correctly; process is still alive and the shortcut still
   works afterward
4. Wallpaper actually changes on Enter/double-click, verified against a real desktop,
   not just "the command returned Ok"
5. No visible title bar/border on Windows, one way or another

## Ask before deciding alone

- Any additional runtime dependency beyond what's in the initial plan
- Changing the asset protocol scope to anything broader than the wallpaper directory
- Anything that would require admin/elevated privileges
- Making a git commit: never commit automatically; always propose the message and wait for explicit user approval

