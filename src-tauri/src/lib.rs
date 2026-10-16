mod config;
mod logger;
mod scanner;
mod wallpaper;

use config::AppConfig;
use logger::{app_error, app_info, app_warn};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::Manager;

fn apply_window_blur_and_size(window: &tauri::WebviewWindow, config: &AppConfig) {
    if config.blur_background {
        if config.blur_mode == "fullscreen" {
            if let Ok(Some(monitor)) = window.current_monitor() {
                let size = monitor.size();
                let pos = monitor.position();
                let _ = window.set_size(tauri::Size::Physical(*size));
                let _ = window.set_position(tauri::Position::Physical(*pos));
            }
        } else {
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(1200.0, 700.0)));
            let _ = window.center();
        }

        let _ = window.set_effects(
            EffectsBuilder::new()
                .effects(vec![Effect::Acrylic, Effect::Blur])
                .state(EffectState::Active)
                .build(),
        );
    } else {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(1200.0, 700.0)));
        let _ = window.center();
        let _ = window.set_effects(None);
    }
}

// App state to hold the config and dialog open state
pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub prevent_hide: AtomicBool,
    pub last_shown: Mutex<std::time::Instant>,
}

#[cfg(target_os = "windows")]
fn strip_main_window_decorations(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_STYLE, WS_CAPTION, WS_SYSMENU,
    };
    if let Ok(hwnd) = window.hwnd() {
        let hwnd_raw = hwnd.0 as windows_sys::Win32::Foundation::HWND;
        unsafe {
            let style = GetWindowLongPtrW(hwnd_raw, GWL_STYLE);
            let new_style = style & !(WS_CAPTION as isize) & !(WS_SYSMENU as isize);
            let res = SetWindowLongPtrW(hwnd_raw, GWL_STYLE, new_style);
            app_info!("[Decorations] Stripped WS_CAPTION/WS_SYSMENU from HWND={:?}, prev_style={:#x}, new_style={:#x}, res={}", hwnd.0, style, new_style, res);
        }
    } else {
        app_warn!("[Decorations] Could not get HWND for stripping decorations");
    }
}

fn toggle_main_window_internal(app: &tauri::AppHandle) {
    app_info!("[Toggle] toggle_main_window_internal called");
    if let Some(window) = app.get_webview_window("main") {
        let is_vis = match window.is_visible() {
            Ok(v) => {
                app_info!("[Toggle] Main window is_visible: {}", v);
                v
            }
            Err(e) => {
                app_error!("[Toggle] Failed to check is_visible: {}", e);
                false
            }
        };

        if is_vis {
            app_info!("[Toggle] Main window is currently visible -> hiding");
            if let Err(e) = window.hide() {
                app_error!("[Toggle] Failed window.hide(): {}", e);
            } else {
                app_info!("[Toggle] window.hide() called successfully");
            }
        } else {
            app_info!("[Toggle] Main window is currently hidden -> showing");
            let state = app.state::<AppState>();
            *state.last_shown.lock().unwrap() = std::time::Instant::now();
            let config = state.config.lock().unwrap().clone();
            apply_window_blur_and_size(&window, &config);

            if let Err(e) = window.show() {
                app_error!("[Toggle] Failed window.show(): {}", e);
            } else {
                app_info!("[Toggle] window.show() called successfully");
            }
            if let Err(e) = window.unminimize() {
                app_warn!("[Toggle] Failed window.unminimize(): {}", e);
            }
            if !(config.blur_background && config.blur_mode == "fullscreen") {
                if let Err(e) = window.center() {
                    app_warn!("[Toggle] Failed window.center(): {}", e);
                }
            }
            if let Err(e) = window.set_focus() {
                app_warn!("[Toggle] Failed window.set_focus(): {}", e);
            } else {
                app_info!("[Toggle] window.set_focus() called successfully");
            }

            #[cfg(target_os = "windows")]
            {
                strip_main_window_decorations(&window);
                if let Ok(hwnd) = window.hwnd() {
                    use windows_sys::Win32::UI::WindowsAndMessaging::{
                        BringWindowToTop, SetForegroundWindow,
                    };
                    unsafe {
                        let b_res = BringWindowToTop(hwnd.0 as _);
                        let s_res = SetForegroundWindow(hwnd.0 as _);
                        app_info!(
                            "[Toggle] Win32 BringWindowToTop={:?}, SetForegroundWindow={:?}",
                            b_res != 0,
                            s_res != 0
                        );
                    }
                }
            }
        }
    } else {
        app_error!("[Toggle] 'main' window not found!");
    }
}

fn open_settings_window_internal(app: &tauri::AppHandle) {
    app_info!("[Settings] open_settings_window_internal called");
    if let Some(window) = app.get_webview_window("settings") {
        if let Err(e) = window.show() {
            app_error!("[Settings] Failed window.show(): {}", e);
        }
        let _ = window.unminimize();
        let _ = window.center();
        let _ = window.set_focus();
        app_info!("[Settings] settings window shown and focused");
    } else {
        app_error!("[Settings] 'settings' window not found!");
    }
}

#[tauri::command]
fn log_frontend(level: String, message: String) {
    logger::log(&level, &format!("[Frontend] {}", message));
}

#[tauri::command]
fn scan_wallpapers(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<scanner::WallpaperEntry>, String> {
    app_info!("[Command] scan_wallpapers called");
    let config = state.config.lock().map_err(|e| e.to_string())?;
    if !config.has_valid_directory() {
        app_warn!(
            "[Command] scan_wallpapers: invalid directory '{}'",
            config.wallpaper_directory
        );
        return Err("No valid wallpaper directory configured".to_string());
    }
    app_info!(
        "[Command] scan_wallpapers scanning: '{}'",
        config.wallpaper_directory
    );
    let res = scanner::scan_directory(&config.wallpaper_directory);
    match &res {
        Ok(entries) => app_info!(
            "[Command] scan_wallpapers succeeded with {} images",
            entries.len()
        ),
        Err(e) => app_error!("[Command] scan_wallpapers failed: {}", e),
    }
    res
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
fn is_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_autostart(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    if enabled {
        app.autolaunch().enable().map_err(|e| {
            app_error!("[Autostart] Failed to enable: {}", e);
            e.to_string()
        })?;
        app_info!("[Autostart] Enabled successfully");
    } else if app.autolaunch().is_enabled().unwrap_or(false) {
        if let Err(e) = app.autolaunch().disable() {
            app_warn!("[Autostart] Failed to disable (ignoring if already not registered): {}", e);
        } else {
            app_info!("[Autostart] Disabled successfully");
        }
    } else {
        app_info!("[Autostart] Already disabled, skipping disable call");
    }
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    config.autostart = enabled;
    config.autostart_prompted = true;
    config.save(&app);
    Ok(())
}

#[tauri::command]
fn save_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    shortcut: String,
    directory: String,
    autostart: bool,
    display_mode: String,
    blur_background: bool,
    blur_mode: String,
) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    if autostart {
        if let Err(e) = app.autolaunch().enable() {
            app_warn!("[Autostart] Failed to enable: {}", e);
        }
    } else if app.autolaunch().is_enabled().unwrap_or(false) {
        if let Err(e) = app.autolaunch().disable() {
            app_warn!("[Autostart] Failed to disable: {}", e);
        }
    }

    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    config.shortcut = shortcut.trim().to_string();
    config.wallpaper_directory = directory.clone();
    config.autostart = autostart;
    config.autostart_prompted = true;
    config.display_mode = if display_mode == "shard" {
        "shard".to_string()
    } else {
        "carousel".to_string()
    };
    config.blur_background = blur_background;
    config.blur_mode = if blur_mode == "window" {
        "window".to_string()
    } else {
        "fullscreen".to_string()
    };
    config.save(&app);

    if let Some(window) = app.get_webview_window("main") {
        apply_window_blur_and_size(&window, &config);
    }

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
                eprintln!(
                    "[Carousel] Failed to re-register shortcut '{}': {}",
                    config.shortcut, e
                );
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

fn quit_app_internal(app: &tauri::AppHandle) {
    app_info!("[Quit] Graceful app exit initiated");
    for (_label, window) in app.webview_windows() {
        let _ = window.destroy();
    }
    app.exit(0);
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    quit_app_internal(&app);
}

#[tauri::command]
fn set_prevent_hide(state: tauri::State<'_, AppState>, prevent: bool) {
    state.prevent_hide.store(prevent, Ordering::SeqCst);
}

#[tauri::command]
fn log_image_switch(
    from: String,
    to: String,
    switch_ms: f64,
    width: u32,
    height: u32,
    file_size: u64,
) {
    let mb = file_size as f64 / (1024.0 * 1024.0);
    println!(
        "[Switch] \"{}\" -> \"{}\" | latency: {:.1}ms | res: {}x{} | size: {:.2} MB",
        from, to, switch_ms, width, height, mb
    );
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Suppress benign Chromium shutdown log spew (e.g. Failed to unregister class Chrome_WidgetWin_0. Error = 1412)
    #[cfg(target_os = "windows")]
    {
        let current_args =
            std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        if !current_args.contains("--log-level") {
            let new_args = if current_args.is_empty() {
                "--log-level=3".to_string()
            } else {
                format!("{} --log-level=3", current_args)
            };
            std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", new_args);
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app_handle, shortcut, event| {
                    app_info!("[Shortcut] Global shortcut event: {:?} for {:?}", event.state(), shortcut);
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        toggle_main_window_internal(app_handle);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let log_path = app
                .path()
                .app_config_dir()
                .expect("failed to get app config dir")
                .join("carousel.log");
            logger::init(log_path);

            app_info!("================================================");
            app_info!("carousel starting up");
            app_info!("================================================");

            // Load config
            let config = AppConfig::load(app.handle());
            let shortcut_str = config.shortcut.clone();
            let wallpaper_dir = config.wallpaper_directory.clone();
            let has_valid_dir = config.has_valid_directory();
            let needs_first_launch_prompt = !config.autostart_prompted;

            app_info!("Config loaded: shortcut='{}', dir='{}', autostart={}, prompted={}",
                shortcut_str, wallpaper_dir, config.autostart, config.autostart_prompted);
            app_info!("Directory valid: {}, first_launch_prompt: {}", has_valid_dir, needs_first_launch_prompt);

            // Store config in app state
            app.manage(AppState {
                config: Mutex::new(config.clone()),
                prevent_hide: AtomicBool::new(false),
                last_shown: Mutex::new(std::time::Instant::now()),
            });

            // Extend asset protocol scope for the wallpaper directory
            if !wallpaper_dir.is_empty() {
                let dir_path = std::path::Path::new(&wallpaper_dir);
                if dir_path.is_dir() {
                    let scope = app.asset_protocol_scope();
                    let res = scope.allow_directory(dir_path, false);
                    app_info!("Asset protocol scope extended to '{}': {:?}", wallpaper_dir, res);
                } else {
                    app_warn!("Wallpaper directory is not a valid directory: '{}'", wallpaper_dir);
                }
            }

            // If no valid directory configured or first launch, show window immediately
            if !has_valid_dir || needs_first_launch_prompt {
                app_info!("First launch or missing directory -> showing main window");
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.center();
                    let _ = window.set_focus();
                }
            } else {
                app_info!("Valid configuration present -> keeping main window hidden until triggered");
            }

            // --- Win32: Strip title bar on main overlay window ---
            #[cfg(target_os = "windows")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    strip_main_window_decorations(&window);
                    apply_window_blur_and_size(&window, &config);
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
                    app_info!("[TrayMenu] Clicked id: '{}'", event.id().as_ref());
                    match event.id().as_ref() {
                        "toggle" => toggle_main_window_internal(app),
                        "settings" => open_settings_window_internal(app),
                        "quit" => quit_app_internal(app),
                        _ => {}
                    }
                });

            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))
                .ok()
                .or_else(|| app.default_window_icon().cloned());
            if let Some(icon) = tray_icon {
                tray_builder = tray_builder.icon(icon);
            }

            let _tray = tray_builder.build(app)?;
            app_info!("System tray created successfully");

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
                    Ok(_) => {
                        eprintln!("[Carousel] Registered global shortcut: {}", shortcut_to_register);
                        app_info!("[Shortcut] Successfully registered global shortcut: {}", shortcut_to_register);
                    }
                    Err(e) => {
                        eprintln!("[Carousel] Failed to register global shortcut '{}': {}", shortcut_to_register, e);
                        app_error!("[Shortcut] FAILED to register global shortcut '{}': {}", shortcut_to_register, e);
                    }
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label();
            match event {
                tauri::WindowEvent::Focused(focused) => {
                    let state = window.state::<AppState>();
                    let elapsed = state.last_shown.lock().unwrap().elapsed();
                    let prevent = state.prevent_hide.load(Ordering::SeqCst);
                    app_info!("[WindowEvent] '{}' Focused({}) | elapsed: {:.1}ms | prevent_hide: {}",
                        label, focused, elapsed.as_secs_f64() * 1000.0, prevent);

                    if label == "main" && !*focused {
                        if !prevent {
                            if elapsed > std::time::Duration::from_millis(400) {
                                app_info!("[WindowEvent] 'main' lost focus after grace period ({:.1}ms) -> HIDING window", elapsed.as_secs_f64() * 1000.0);
                                let _ = window.hide();
                            } else {
                                app_info!("[WindowEvent] 'main' lost focus within grace period ({:.1}ms <= 400ms) -> IGNORING hide request", elapsed.as_secs_f64() * 1000.0);
                            }
                        } else {
                            app_info!("[WindowEvent] 'main' lost focus but prevent_hide is active -> NOT hiding");
                        }
                    }
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    app_info!("[WindowEvent] '{}' CloseRequested", label);
                    if label == "settings" {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    app_info!("[WindowEvent] '{}' Destroyed", label);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            scan_wallpapers,
            set_wallpaper,
            get_config,
            set_wallpaper_directory,
            save_settings,
            is_autostart_enabled,
            set_autostart,
            toggle_main_window,
            open_settings_window,
            quit_app,
            set_prevent_hide,
            log_image_switch,
            log_frontend,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
