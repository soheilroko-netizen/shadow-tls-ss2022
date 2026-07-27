// main.rs - Tauri app entry with commands
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use std::time::Instant;

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

mod config;
mod proxy;
mod tun;
mod packet;
mod socks5;
mod forwarder;

use config::Config;
use config::ProfileStore;
use proxy::ProxyManager;
use tun::{TunConfig, TunManager};

struct AppState {
    proxy: Mutex<ProxyManager>,
    tun: Mutex<TunManager>,
    started_at: Mutex<Option<Instant>>,
}

#[tauri::command]
fn get_status(state: State<AppState>) -> Result<bool, String> {
    let proxy = state.proxy.lock().unwrap();
    Ok(proxy.is_running())
}

#[tauri::command]
fn start_proxy(state: State<AppState>) -> Result<String, String> {
    let mut proxy = state.proxy.lock().unwrap();
    let result = proxy.start().map_err(|e| e.to_string())?;
    *state.started_at.lock().unwrap() = Some(Instant::now());
    Ok(result)
}

#[tauri::command]
fn stop_proxy(state: State<AppState>) -> Result<String, String> {
    let mut proxy = state.proxy.lock().unwrap();
    let result = proxy.stop().map_err(|e| e.to_string())?;
    *state.started_at.lock().unwrap() = None;
    Ok(result)
}

#[tauri::command]
fn get_config() -> Result<Config, String> {
    Config::load().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(config: Config) -> Result<String, String> {
    config.save().map_err(|e| e.to_string())?;
    Ok("Configuration saved".to_string())
}

#[tauri::command]
fn get_profiles() -> Result<ProfileStore, String> {
    ProfileStore::load().map_err(|e| e.to_string())
}

#[tauri::command]
fn add_profile(name: String, config: Config) -> Result<String, String> {
    let mut store = ProfileStore::load().map_err(|e| e.to_string())?;
    store.add_profile(name.clone(), config).map_err(|e| e.to_string())?;
    Ok(format!("Profile '{}' added", name))
}

#[tauri::command]
fn delete_profile(name: String) -> Result<String, String> {
    let mut store = ProfileStore::load().map_err(|e| e.to_string())?;
    store.delete_profile(&name).map_err(|e| e.to_string())?;
    Ok(format!("Profile '{}' deleted", name))
}

#[tauri::command]
fn switch_profile(name: String) -> Result<String, String> {
    let mut store = ProfileStore::load().map_err(|e| e.to_string())?;
    store.switch_profile(&name).map_err(|e| e.to_string())?;
    Ok(format!("Switched to profile '{}'", name))
}

#[tauri::command]
fn get_tun_status(state: State<AppState>) -> Result<bool, String> {
    let tun = state.tun.lock().unwrap();
    Ok(tun.is_running())
}

#[tauri::command]
fn start_tun(state: State<AppState>) -> Result<String, String> {
    let mut tun = state.tun.lock().unwrap();
    tun.start().map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_tun(state: State<AppState>) -> Result<String, String> {
    let mut tun = state.tun.lock().unwrap();
    tun.stop().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_traffic() -> Result<String, String> {
    use std::io::Read;
    use std::net::TcpStream;
    use std::time::{Duration, Instant};

    let mut stream = TcpStream::connect_timeout(
        &"127.0.0.1:9097".parse().map_err(|e| format!("addr: {e}"))?,
        Duration::from_secs(2),
    )
    .map_err(|e| format!("connect: {e}"))?;

    stream
        .set_read_timeout(Some(Duration::from_millis(800)))
        .map_err(|e| format!("set_read_timeout: {e}"))?;

    let req = "GET /traffic HTTP/1.1\r\nHost: 127.0.0.1:9097\r\nAuthorization: Bearer dakal\r\n\r\n";
    use std::io::Write;
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("write: {e}"))?;

    // Read stream for up to 1.5s, collect last valid JSON line
    let deadline = Instant::now() + Duration::from_millis(1500);
    let mut all_data = String::new();
    let mut buf = [0u8; 2048];

    while Instant::now() < deadline {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                all_data.push_str(&String::from_utf8_lossy(&buf[..n]));
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                continue;
            }
            Err(e) => return Err(format!("read: {e}")),
        }
    }

    // Find last line that looks like {"up":N,"down":N}
    let mut last_json: Option<(u64, u64)> = None;
    for line in all_data.lines() {
        let line = line.trim();
        if line.starts_with('{') && line.contains("\"up\"") {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                let up = v["up"].as_u64().unwrap_or(0);
                let down = v["down"].as_u64().unwrap_or(0);
                last_json = Some((up, down));
            }
        }
    }

    let (up, down) = last_json.unwrap_or((0, 0));
    Ok(format!(r#"{{"up":{},"down":{}}}"#, up, down))
}

#[tauri::command]
fn get_active_profile_name() -> Result<String, String> {
    let store = ProfileStore::load().map_err(|e| e.to_string())?;
    Ok(store.active_profile)
}

/// Update tray tooltip with profile name + connection status
fn update_tray(app: &tauri::AppHandle, connected: bool) {
    let store = ProfileStore::load().ok();
    let profile = store.as_ref().map(|s| s.active_profile.as_str()).unwrap_or("Default");
    let tip = if connected {
        format!("dakal-tls VPN - {} (Connected)", profile)
    } else {
        format!("dakal-tls VPN ({})", profile)
    };
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_tooltip(&tip).ok();
    }
}

fn create_main_window(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("dakal-tls v5")
        .inner_size(500.0, 400.0)
        .resizable(true)
        .build()?;
    Ok(())
}

fn main() {
    let proxy_manager = ProxyManager::new().expect("Failed to init proxy manager");
    let mut tun_config = TunConfig::default();
    if let Ok(cfg) = Config::load() {
        tun_config.server_address = cfg.server_address.clone();
    }
    let tun_manager = TunManager::new(tun_config);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            proxy: Mutex::new(proxy_manager),
            tun: Mutex::new(tun_manager),
            started_at: Mutex::new(None),
        })
        .setup(|app| {
            let connect_item = MenuItemBuilder::with_id("toggle", "Connect").build(app)?;
            let profile_item = MenuItemBuilder::with_id("profile", "Profile: Default").enabled(false).build(app)?;
            let show_item = MenuItemBuilder::with_id("show", "Show").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&profile_item)
                .separator()
                .item(&connect_item)
                .separator()
                .item(&show_item)
                .item(&quit_item)
                .build()?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("dakal-tls VPN")
                .menu(&menu)
                .on_menu_event({
                    let connect_item = connect_item.clone();
                    move |app, event| {
                    match event.id().as_ref() {
                        "toggle" => {
                            let state: State<AppState> = app.state();
                            let mut proxy = state.proxy.lock().unwrap();
                            if proxy.is_running() {
                                proxy.stop().ok();
                                *state.started_at.lock().unwrap() = None;
                                connect_item.set_text("Connect").ok();
                            } else {
                                proxy.start().ok();
                                *state.started_at.lock().unwrap() = Some(Instant::now());
                                connect_item.set_text("Disconnect").ok();
                            }
                            drop(proxy);
                            // Update tray tooltip
                            let store = ProfileStore::load().ok();
                            let profile = store.as_ref().map(|s| s.active_profile.as_str()).unwrap_or("Default");
                            let state2: State<AppState> = app.state();
                            let connected = state2.proxy.lock().unwrap().is_running();
                            let tip = if connected {
                                format!("dakal-tls VPN - {} (Connected)", profile)
                            } else {
                                format!("dakal-tls VPN ({})", profile)
                            };
                            if let Some(tray) = app.tray_by_id("main") {
                                tray.set_tooltip(&tip).ok();
                            }
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                window.show().ok();
                                window.set_focus().ok();
                            }
                        }
                        "quit" => {
                            // Stop proxy first
                            let state: State<AppState> = app.state();
                            state.proxy.lock().unwrap().stop().ok();
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

            create_main_window(&app.handle())?;
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
            get_tun_status,
            start_tun,
            stop_tun,
            get_traffic,
            get_active_profile_name,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri app");
}
