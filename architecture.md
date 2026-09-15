# Architecture notes

## Proposed structure

```
wallpaper-coverflow/
├── AGENTS.md
├── README.md
├── docs/
│   └── architecture.md          # this file
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/                         # React frontend
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── Coverflow.tsx
│   │   └── Coverflow.css
│   ├── hooks/
│   │   ├── useWallpapers.ts     # scan + selection state
│   │   └── useGlobalHotkeys.ts  # Esc handling, Enter-to-apply
│   ├── lib/
│   │   └── tauri.ts             # thin wrappers over invoke()/convertFileSrc
│   └── types.ts
└── src-tauri/                   # Rust backend
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/
    │   └── default.json
    ├── icons/
    └── src/
        ├── main.rs
        ├── lib.rs                # plugin registration, window event wiring
        ├── wallpaper.rs           # SystemParametersInfoW wrapper
        ├── scanner.rs             # directory scan + thumbnail generation
        └── config.rs              # user config: shortcut binding, wallpaper dir
```

## Why asset protocol for the centered image, not IPC

The scan command already returns small thumbnails as encoded bytes for the strip —
that's fine, they're small and there are many of them, so one batched response is
efficient. The centered slide is different: it's one image at a time, but potentially a
multi-megabyte source file (wallhaven-grade wallpapers routinely run 5-15MB), and it
changes every time the user moves the selection. Piping that through `invoke()` means
JSON/base64 serialization overhead on both sides, every keystroke. The asset protocol
sidesteps this entirely — the WebView requests the file directly through Tauri's
protocol handler and uses its own native image decoding and cache, the same as it would
for any other `<img src>`. Scope it tightly to the configured wallpaper directory in
`tauri.conf.json`, not a wildcard — the point of the v2 permission model is that a
compromised or buggy frontend can't read arbitrary files off the disk, and a wide-open
asset scope defeats that.

## The Windows decorations/title-bar issue

As of early 2026, `tauri-apps/tauri` issue #14859 reports that on Windows,
`decorations: false` combined with `shadow: false` leaves the native title bar visible,
and that explicit `set_decorations(false)`/`set_shadow(false)` calls after window
creation don't fix it either. This directly threatens the core visual requirement — the
reference image is a completely chromeless overlay, and a stray title bar would break
that immediately and be an easy thing to not notice in a quick dev-mode check (title bar
grief tends to show up more/less depending on Windows theme and DPI settings).

Check the issue's current state before writing the window config. If still unresolved,
fall back to a native fix: `window.hwnd()` gives the raw `HWND`, and from there
`GetWindowLongPtrW(hwnd, GWL_STYLE)` / `SetWindowLongPtrW` with `WS_CAPTION` and
`WS_SYSMENU` masked out removes the title bar and system menu directly at the Win32
level, bypassing whatever Tauri's own decoration handling is or isn't doing. This uses
the same `windows-sys` dependency already required for the wallpaper call, so it's not a
new dependency — just a second use of the one already there.

## Global shortcut: config, not constant

Alt+W specifically is arbitrary — it's not unlikely to collide with something else on a
given machine (another launcher, a DE-level binding, etc.). Store the binding in a small
user config file (JSON or TOML, in the app's config directory) that's read at startup and
can be changed without a rebuild, shipping Alt+W as the default. Re-registering on config
change is a nice-to-have, not required for v1 — restart-to-apply is an acceptable
compromise for a first version.

## Coverflow tuning

Swiper's `EffectCoverflow` defaults (`rotate: 50, stretch: 0, depth: 100, modifier: 1`)
produce a noticeably looser, more spread-out stack than the reference image, which shows
side covers overlapping tightly with only a sliver of separation. Getting close to the
reference is a matter of pushing `stretch` negative (pulls slides toward center) and
keeping `depth` and `slidesPerView` tuned together — this is eyeball-and-adjust work
against a real running instance, not something to get right from the config alone on
the first pass. Budget for an iteration loop here rather than expecting the first
numbers to match the screenshot.

## Known unknowns worth resolving early, not late

- Multi-monitor behavior: `SystemParametersInfoW` sets the wallpaper for the whole
  desktop, not a specific monitor. If per-monitor wallpapers matter later, that's a
  different, more involved API path (`IDesktopWallpaper` COM interface) — not in scope
  for v1, but worth knowing now so it's not a surprise later.
- Large source directories: no pagination or virtualization has been specified for the
  directory scanner. Fine for a personal wallpaper folder in the hundreds; would need
  addressing before pointing it at something with thousands of images.
