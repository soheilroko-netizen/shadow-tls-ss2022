// main.rs - Tauri app entry with commands (v9)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use std::time::Instant;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State, WebviewUrl, WebviewWindowBuilder,
};

// ── Single-instance guard via named mutex (Windows) ──────────────────
#[cfg(target_os = "windows")]
fn check_single_instance() {
    use std::ffi::CString;
    use std::ptr;
    extern "system" {
        fn CreateMutexA(
            lpMutexAttributes: *mut std::ffi::c_void,
            bInitialOwner: i32,
            lpName: *const i8,
        ) -> *mut std::ffi::c_void;
        fn GetLastError() -> u32;
    }
    let name = CString::new("Local\\\\stls-single-instance-mutex").unwrap();
    let handle = unsafe { CreateMutexA(ptr::null_mut(), 0, name.as_ptr()) };
    if handle.is_null() {
        eprintln!("[stls] CreateMutexA failed");
        return;
    }
    const ERROR_ALREADY_EXISTS: u32 = 183;
    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        println!("[stls] Another instance is already running — exiting.");
        std::process::exit(0);
    }
}

#[cfg(not(target_os = "windows"))]
fn check_single_instance() {}

// ── Modules ──────────────────────────────────────────────────────────
mod config;
mod proxy;
mod sysdns;
use config::ProfileStore;
use proxy::ProxyManager;

// ── App State ────────────────────────────────────────────────────────
struct AppState {
    proxy: Mutex<ProxyManager>,
    started_at: Mutex<Option<Instant>>,
    split_enabled: Mutex<bool>,
    // Store menu item handles for dynamic enable/disable
    connect_item: Mutex<Option<tauri::menu::MenuItem>>,
    disconnect_item: Mutex<Option<tauri::menu::MenuItem>>,
}

// ── Settings Window ─────────────────────────────────────────────────
fn open_settings_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let builder = WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::App("settings.html".into()),
    )
    .title("dakal-tls Settings")
    .inner_size(720.0, 500.0)
    .resizable(true)
    .center();

    #[cfg(target_os = "windows")]
    let builder = builder.decorations(true);

    if let Err(e) = builder.build() {
        eprintln!("[stls] Failed to create settings window: {e}");
    }
}

#[tauri::command]
fn show_settings(app: tauri::AppHandle) -> Result<String, String> {
    open_settings_window(&app);
    Ok("Opening settings".into())
}

// ── Tray State Update ───────────────────────────────────────────────
fn update_tray_state(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let running = state.proxy.lock().unwrap().is_running();
    
    // Use stored handles for enable/disable
    if let Some(connect_item) = state.connect_item.lock().unwrap().as_ref() {
        let _ = connect_item.set_enabled(!running);
    }
    if let Some(disconnect_item) = state.disconnect_item.lock().unwrap().as_ref() {
        let _ = disconnect_item.set_enabled(running);
    }
}

// ── Main ────────────────────────────────────────────────────────────
fn main() {
    check_single_instance();

    let panic_log = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("stls-panic.log");
    std::fs::write(&panic_log, "stls starting...\n").ok();
    let pl = panic_log.clone();
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!("PANIC: {}\n", info);
        std::fs::write(&pl, &msg).ok();
    }));

    let proxy_manager = ProxyManager::new().expect("Failed to init proxy manager");

    let initial_split = ProfileStore::load()
        .ok()
        .and_then(|s| s.get_active_config().ok())
        .map(|c| c.split_mode == "exclude")
        .unwrap_or(false);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            proxy: Mutex::new(proxy_manager),
            started_at: Mutex::new(None),
            split_enabled: Mutex::new(initial_split),
        })
        .setup(|app| {
            let show_item = MenuItemBuilder::with_id("show", "Show").build(app)?;
            let hide_item = MenuItemBuilder::with_id("hide", "Hide").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let profile_name_startup = ProfileStore::load()
                .map(|s| s.active_profile)
                .unwrap_or_else(|_| "dakal-tls".to_string());
            let profile_item = MenuItemBuilder::with_id("profile", &profile_name_startup)
                .enabled(false)
                .build(app)?;
            let connect_item = MenuItemBuilder::with_id("connect", "Connect").build(app)?;
            let disconnect_item = MenuItemBuilder::with_id("disconnect", "Disconnect")
                .enabled(false)
                .build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&profile_item)
                .item(&connect_item)
                .item(&disconnect_item)
                .separator()
                .item(&show_item)
                .item(&hide_item)
                .separator()
                .item(&quit_item)
                .build()?;

            // Store menu item handles for dynamic enable/disable
            *state.connect_item.lock().unwrap() = Some(connect_item.clone());
            *state.disconnect_item.lock().unwrap() = Some(disconnect_item.clone());

            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("dakal-tls VPN")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                window.show().ok();
                                window.set_focus().ok();
                            }
                        }
                        "hide" => {
                            if let Some(window) = app.get_webview_window("main") {
                                window.hide().ok();
                            }
                        }
                        "connect" => {
                            let state = app.state::<AppState>();
                            let mut proxy = state.proxy.lock().unwrap();
                            if !proxy.is_running() {
                                let _ = proxy.start();
                                *state.started_at.lock().unwrap() = Some(Instant::now());
                            }
                            drop(proxy);
                            update_tray_state(app);
                        }
                        "disconnect" => {
                            let state = app.state::<AppState>();
                            let mut proxy = state.proxy.lock().unwrap();
                            if proxy.is_running() {
                                let _ = proxy.stop();
                                *state.started_at.lock().unwrap() = None;
                            }
                            drop(proxy);
                            update_tray_state(app);
                        }
                        "quit" => {
                            let state = app.state::<AppState>();
                            let mut proxy = state.proxy.lock().unwrap();
                            if proxy.is_running() {
                                let _ = proxy.stop();
                            }
                            drop(proxy);
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().ok().unwrap_or(false) {
                                window.hide().ok();
                            } else {
                                window.show().ok();
                                window.set_focus().ok();
                            }
                        }
                    }
                })
                .build(app)?;

            // Initial tray state
            update_tray_state(&app.handle());

            // Show the main window (created from tauri.conf.json)
            if let Some(window) = app.get_webview_window("main") {
                window.show().ok();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    window.hide().ok();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            start_proxy,
            stop_proxy,
            get_config,
            save_config,
            get_profiles,
            add_profile,
            delete_profile,
            switch_profile,
            switch_profile_stop,
            real_ping,
            get_traffic,
            get_total_traffic,
            get_uptime,
            get_log,
            save_app_settings,
            load_app_settings,
            save_split_rules,
            get_split_state,
            set_split_state,
            show_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri app");
}

// ── Command Handlers ────────────────────────────────────────────────
#[tauri::command]
fn get_status(state: State<AppState>) -> Result<String, String> {
    let proxy = state.proxy.lock().unwrap();
    let running = proxy.is_running();
    let split = *state.split_enabled.lock().unwrap();
    Ok(serde_json::json!({
        "running": running,
        "split": split,
    }).to_string())
}

#[tauri::command]
async fn start_proxy(state: State<'_, AppState>) -> Result<String, String> {
    let mut proxy = state.proxy.lock().unwrap();
    if !proxy.is_running() {
        proxy.start().map_err(|e| e.to_string())?;
        *state.started_at.lock().unwrap() = Some(Instant::now());
    }
    Ok("Started".into())
}

#[tauri::command]
async fn stop_proxy(state: State<'_, AppState>) -> Result<String, String> {
    let mut proxy = state.proxy.lock().unwrap();
    if proxy.is_running() {
        proxy.stop().map_err(|e| e.to_string())?;
        *state.started_at.lock().unwrap() = None;
    }
    Ok("Stopped".into())
}

#[tauri::command]
fn get_config() -> Result<String, String> {
    let store = ProfileStore::load().map_err(|e| e.to_string())?;
    let config = store.get_active_config().map_err(|e| e.to_string())?;
    Ok(serde_json::to_string(&config).unwrap())
}

#[tauri::command]
fn save_config(config: String) -> Result<String, String> {
    let mut store = ProfileStore::load().map_err(|e| e.to_string())?;
    let cfg: config::Config = serde_json::from_str(&config).map_err(|e| e.to_string())?;
    store.update_active_config(cfg).map_err(|e| e.to_string())?;
    Ok("Saved".into())
}

#[tauri::command]
fn get_profiles() -> Result<String, String> {
    let store = ProfileStore::load().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "profiles": store.profiles,
        "active_profile": store.active_profile,
    }).to_string())
}

#[tauri::command]
fn add_profile(name: String, config: String) -> Result<String, String> {
    let mut store = ProfileStore::load().map_err(|e| e.to_string())?;
    let cfg: config::Config = serde_json::from_str(&config).map_err(|e| e.to_string())?;
    store.add_profile(name, cfg).map_err(|e| e.to_string())?;
    Ok("Profile added".into())
}

#[tauri::command]
fn delete_profile(name: String) -> Result<String, String> {
    let mut store = ProfileStore::load().map_err(|e| e.to_string())?;
    store.delete_profile(&name).map_err(|e| e.to_string())?;
    Ok("Deleted".into())
}

#[tauri::command]
fn switch_profile(state: State<'_, AppState>, name: String) -> Result<String, String> {
    let mut store = ProfileStore::load().map_err(|e| e.to_string())?;
    store.switch_profile(&name).map_err(|e| e.to_string())?;
    let config = store.get_active_config().map_err(|e| e.to_string())?;
    
    let mut proxy = state.proxy.lock().unwrap();
    if proxy.is_running() {
        proxy.stop().ok();
        proxy.start().map_err(|e| e.to_string())?;
    }
    drop(proxy);
    
    *state.started_at.lock().unwrap() = Some(Instant::now());
    Ok("Switched".into())
}

#[tauri::command]
fn switch_profile_stop(state: State<'_, AppState>, name: String) -> Result<String, String> {
    let mut store = ProfileStore::load().map_err(|e| e.to_string())?;
    store.switch_profile(&name).map_err(|e| e.to_string())?;
    
    let mut proxy = state.proxy.lock().unwrap();
    if proxy.is_running() {
        proxy.stop().ok();
    }
    *state.started_at.lock().unwrap() = None;
    Ok("Switched (stopped)".into())
}

#[tauri::command]
fn real_ping(state: State<AppState>) -> Result<String, String> {
    let proxy = state.proxy.lock().unwrap();
    if !proxy.is_running() {
        return Err("Not connected".into());
    }
    let ms = proxy.ping().map_err(|e| e.to_string())?;
    Ok(format!("{}ms", ms))
}

#[tauri::command]
fn get_traffic(state: State<AppState>) -> Result<String, String> {
    let proxy = state.proxy.lock().unwrap();
    let (up, down) = proxy.get_traffic().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"up": up, "down": down}).to_string())
}

#[tauri::command]
fn get_total_traffic() -> Result<String, String> {
    let store = ProfileStore::load().map_err(|e| e.to_string())?;
    let config = store.get_active_config().map_err(|e| e.to_string())?;
    let up = config.total_up.unwrap_or(0);
    let down = config.total_down.unwrap_or(0);
    Ok(serde_json::json!({"up": up, "down": down}).to_string())
}

#[tauri::command]
fn get_uptime(state: State<AppState>) -> Result<String, String> {
    let started = *state.started_at.lock().unwrap();
    if let Some(start) = started {
        let elapsed = start.elapsed().as_secs();
        let h = elapsed / 3600;
        let m = (elapsed % 3600) / 60;
        let s = elapsed % 60;
        Ok(format!("{:02}:{:02}:{:02}", h, m, s))
    } else {
        Ok("00:00:00".into())
    }
}

#[tauri::command]
fn get_log() -> Result<String, String> {
    Ok("[]".into())
}

#[tauri::command]
fn save_app_settings(
    language: String,
    auto_start: bool,
    minimize_tray: bool,
    notify_connect: bool,
    ping_interval: u32,
) -> Result<String, String> {
    let settings = serde_json::json!({
        "language": language,
        "auto_start": auto_start,
        "minimize_tray": minimize_tray,
        "notify_connect": notify_connect,
        "ping_interval": ping_interval,
    });
    let path = config::app_settings_path();
    if let Some(p) = path {
        std::fs::write(p, serde_json::to_string_pretty(&settings).unwrap()).ok();
    }
    Ok("Settings saved".into())
}

#[tauri::command]
fn load_app_settings() -> Result<String, String> {
    let path = config::app_settings_path();
    if let Some(p) = path {
        if let Ok(content) = std::fs::read_to_string(&p) {
            return Ok(content);
        }
    }
    Ok(r#"{"language":"en","auto_start":false,"minimize_tray":true,"notify_connect":true,"ping_interval":1}"#.into())
}

#[tauri::command]
fn save_split_rules(
    mode: String,
    processes: Vec<String>,
    domains: Vec<String>,
) -> Result<String, String> {
    let mut store = ProfileStore::load().map_err(|e| e.to_string())?;
    let mut config = store.get_active_config().map_err(|e| e.to_string())?;
    config.split_mode = mode;
    config.split_processes = processes;
    config.split_domains = domains;
    store.update_active_config(config).map_err(|e| e.to_string())?;
    Ok("Split rules saved".into())
}

#[tauri::command]
fn get_split_state(state: State<AppState>) -> Result<bool, String> {
    Ok(*state.split_enabled.lock().unwrap())
}

#[tauri::command]
fn set_split_state(state: State<AppState>, enabled: bool) -> Result<bool, String> {
    let mut s = state.split_enabled.lock().unwrap();
    *s = enabled;
    if let Ok(mut store) = ProfileStore::load() {
        if let Ok(mut config) = store.get_active_config() {
            config.split_mode = if enabled { "exclude".into() } else { "off".into() };
            store.update_active_config(config).ok();
        }
    }
    Ok(enabled)
}