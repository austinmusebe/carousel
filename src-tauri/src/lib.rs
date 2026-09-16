mod config;
mod scanner;
mod wallpaper;

use config::AppConfig;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

// App state to hold the config and dialog open state
pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub prevent_hide: AtomicBool,
    pub last_shown: Mutex<std::time::Instant>,
}

fn toggle_main_window_internal(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let is_vis = window.is_visible().unwrap_or(false);
        if is_vis {
            let _ = window.hide();
        } else {
            let state = app.state::<AppState>();
            *state.last_shown.lock().unwrap() = std::time::Instant::now();
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.center();
            let _ = window.set_focus();

            #[cfg(target_os = "windows")]
            {
                if let Ok(hwnd) = window.hwnd() {
                    use windows_sys::Win32::UI::WindowsAndMessaging::{
                        BringWindowToTop, SetForegroundWindow,
                    };
                    unsafe {
                        BringWindowToTop(hwnd.0 as _);
                        SetForegroundWindow(hwnd.0 as _);
                    }
                }
            }
        }
    }
}

fn open_settings_window_internal(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.center();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn scan_wallpapers(state: tauri::State<'_, AppState>) -> Result<Vec<scanner::WallpaperEntry>, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    if !config.has_valid_directory() {
        return Err("No valid wallpaper directory configured".to_string());
    }
    scanner::scan_directory(&config.wallpaper_directory)
}

#[tauri::command]
fn set_wallpaper(path: String) -> Result<(), String> {
    wallpaper::set_wallpaper(&path)
}

#[tauri::command]
fn get_config(state: tauri::State<'_, AppState>) -> Result<AppConfig, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    Ok(config.clone())
}

#[tauri::command]
fn set_wallpaper_directory(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    directory: String,
) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    config.wallpaper_directory = directory.clone();
    config.save(&app);

    // Extend asset protocol scope to new directory
    let scope = app.asset_protocol_scope();
    let dir_path = std::path::Path::new(&directory);
    if dir_path.is_dir() {
        let _ = scope.allow_directory(dir_path, false);
    }

    Ok(())
}

#[tauri::command]
fn save_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    shortcut: String,
    directory: String,
) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    config.shortcut = shortcut.trim().to_string();
    config.wallpaper_directory = directory.clone();
    config.save(&app);

    // Extend asset protocol scope
    let scope = app.asset_protocol_scope();
    let dir_path = std::path::Path::new(&directory);
    if dir_path.is_dir() {
        let _ = scope.allow_directory(dir_path, false);
    }

    // Re-register global shortcut
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        let _ = app.global_shortcut().unregister_all();
        if !config.shortcut.is_empty() {
            if let Err(e) = app.global_shortcut().register(config.shortcut.as_str()) {
                eprintln!("[Carousel] Failed to re-register shortcut '{}': {}", config.shortcut, e);
                return Err(format!("Invalid shortcut '{}': {}", config.shortcut, e));
            } else {
                eprintln!("[Carousel] Re-registered shortcut: {}", config.shortcut);
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn toggle_main_window(app: tauri::AppHandle) {
    toggle_main_window_internal(&app);
}

#[tauri::command]
fn open_settings_window(app: tauri::AppHandle) {
    open_settings_window_internal(&app);
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn set_prevent_hide(state: tauri::State<'_, AppState>, prevent: bool) {
    state.prevent_hide.store(prevent, Ordering::SeqCst);
}

#[tauri::command]
fn log_image_switch(from: String, to: String, switch_ms: f64, width: u32, height: u32, file_size: u64) {
    let mb = file_size as f64 / (1024.0 * 1024.0);
    println!(
        "[Switch] \"{}\" -> \"{}\" | latency: {:.1}ms | res: {}x{} | size: {:.2} MB",
        from, to, switch_ms, width, height, mb
    );
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app_handle, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        toggle_main_window_internal(app_handle);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Load config
            let config = AppConfig::load(app.handle());
            let shortcut_str = config.shortcut.clone();
            let wallpaper_dir = config.wallpaper_directory.clone();
            let has_valid_dir = config.has_valid_directory();

            // Store config in app state
            app.manage(AppState {
                config: Mutex::new(config),
                prevent_hide: AtomicBool::new(false),
                last_shown: Mutex::new(std::time::Instant::now()),
            });

            // Extend asset protocol scope for the wallpaper directory
            if !wallpaper_dir.is_empty() {
                let dir_path = std::path::Path::new(&wallpaper_dir);
                if dir_path.is_dir() {
                    let scope = app.asset_protocol_scope();
                    let _ = scope.allow_directory(dir_path, false);
                }
            }

            // If no valid directory configured, show window immediately for first-run setup
            if !has_valid_dir {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.center();
                    let _ = window.set_focus();
                }
            }

            // --- Win32: Strip title bar on main overlay window ---
            #[cfg(target_os = "windows")]
            {
                use windows_sys::Win32::UI::WindowsAndMessaging::{
                    GetWindowLongPtrW, SetWindowLongPtrW, GWL_STYLE, WS_CAPTION, WS_SYSMENU,
                };

                let window = app.get_webview_window("main").expect("main window not found");
                let hwnd = window.hwnd().expect("failed to get HWND");
                let hwnd_raw = hwnd.0 as windows_sys::Win32::Foundation::HWND;

                unsafe {
                    let style = GetWindowLongPtrW(hwnd_raw, GWL_STYLE);
                    let new_style = style & !(WS_CAPTION as isize) & !(WS_SYSMENU as isize);
                    SetWindowLongPtrW(hwnd_raw, GWL_STYLE, new_style);
                }
            }

            // --- System Tray ---
            let toggle_i = MenuItemBuilder::new("Toggle Carousel").id("toggle").build(app)?;
            let settings_i = MenuItemBuilder::new("Settings...").id("settings").build(app)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItemBuilder::new("Quit").id("quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&toggle_i)
                .item(&settings_i)
                .item(&separator)
                .item(&quit_i)
                .build()?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event {
                        toggle_main_window_internal(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "toggle" => toggle_main_window_internal(app),
                        "settings" => open_settings_window_internal(app),
                        "quit" => app.exit(0),
                        _ => {}
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder.build(app)?;

            // --- Global shortcut registration ---
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;

                let shortcut_to_register = if shortcut_str.is_empty() {
                    "Alt+W"
                } else {
                    shortcut_str.as_str()
                };

                match app.global_shortcut().register(shortcut_to_register) {
                    Ok(_) => eprintln!("[Carousel] Registered global shortcut: {}", shortcut_to_register),
                    Err(e) => eprintln!("[Carousel] Failed to register global shortcut '{}': {}", shortcut_to_register, e),
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::Focused(false) = event {
                    let state = window.state::<AppState>();
                    if !state.prevent_hide.load(Ordering::SeqCst) {
                        let elapsed = state.last_shown.lock().unwrap().elapsed();
                        if elapsed > std::time::Duration::from_millis(400) {
                            let _ = window.hide();
                        }
                    }
                }
            } else if window.label() == "settings" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            scan_wallpapers,
            set_wallpaper,
            get_config,
            set_wallpaper_directory,
            save_settings,
            toggle_main_window,
            open_settings_window,
            quit_app,
            set_prevent_hide,
            log_image_switch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
