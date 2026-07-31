#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! dakal-tls v6 — single-file Tauri backend

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::net::ToSocketAddrs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

// ── Windows helpers ──────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn check_single_instance() {
    use std::ffi::CString;
    use std::ptr;
    extern "system" {
        fn CreateMutexA(_: *mut core::ffi::c_void, _: i32, _: *const i8) -> *mut core::ffi::c_void;
        fn GetLastError() -> u32;
    }
    let name = CString::new("Local\\dakal-tls-mutex").unwrap();
    let h = unsafe { CreateMutexA(ptr::null_mut(), 0, name.as_ptr()) };
    if !h.is_null() && unsafe { GetLastError() } == 183 {
        std::process::exit(0);
    }
}
#[cfg(not(target_os = "windows"))]
fn check_single_instance() {}

#[cfg(target_os = "windows")]
fn no_window(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000)
}
#[cfg(not(target_os = "windows"))]
fn no_window(cmd: &mut Command) -> &mut Command {
    cmd
}

// ── Config ───────────────────────────────────────────────────────────

fn app_config_dir() -> Result<PathBuf> {
    let d = directories::ProjectDirs::from("com", "dakal-tls", "dakal-tls")
        .ok_or_else(|| anyhow::anyhow!("no config dir"))?
        .config_dir()
        .to_path_buf();
    fs::create_dir_all(&d)?;
    Ok(d)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct Config {
    server_address: String,
    ss_port: u16,
    ss_password: String,
    stls_port: u16,
    stls_password: String,
    stls_sni: String,
    socks5_port: u16,
    mtu: Option<u32>,
    split_rules: Vec<SplitRule>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server_address: "ns.baft.uk".into(),
            ss_port: 8380,
            ss_password: "tE+3/qlN/orCZRVUutWouysZ8BQs4RWzq46WK6CDGG4=".into(),
            stls_port: 8553,
            stls_password: "y2lachetore".into(),
            stls_sni: "dl.google.com".into(),
            socks5_port: 1080,
            mtu: None,
            split_rules: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SplitRule {
    pattern: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Profile {
    name: String,
    config: Config,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct ProfileStore {
    profiles: Vec<Profile>,
    active_profile: String,
}

impl Default for ProfileStore {
    fn default() -> Self {
        Self {
            profiles: vec![Profile {
                name: "Default".into(),
                config: Config::default(),
            }],
            active_profile: "Default".into(),
        }
    }
}

impl ProfileStore {
    fn path() -> Result<PathBuf> {
        Ok(app_config_dir()?.join("profiles.json"))
    }
    fn load() -> Result<Self> {
        let p = Self::path()?;
        if !p.exists() {
            return Ok(Self::default());
        }
        Ok(serde_json::from_str(&fs::read_to_string(&p)?).unwrap_or_default())
    }
    fn save(&self) -> Result<()> {
        fs::write(Self::path()?, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }
    fn active_config(&self) -> Result<Config> {
        self.profiles
            .iter()
            .find(|p| p.name == self.active_profile)
            .map(|p| p.config.clone())
            .ok_or_else(|| anyhow::anyhow!("active profile not found"))
    }
}

// ── DNS (Windows netsh) ─────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn dns_interfaces() -> Vec<String> {
    let Ok(out) = no_window(
        Command::new("netsh")
            .args(["interface", "ip", "show", "interfaces"]),
    )
    .output()
    else {
        return vec!["Local Area Connection".into()];
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut v = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        if t.contains("connected") && !t.contains("Loopback") {
            let after = t.trim_start_matches(|c: char| c.is_ascii_digit() || c.is_whitespace());
            let name = after
                .split("connected")
                .next()
                .unwrap_or("")
                .trim()
                .trim_end_matches(|c: c == ' ' || c == '\t' || c == '.');
            if !name.is_empty() {
                v.push(name.to_string());
            }
        }
    }
    if v.is_empty() {
        v.push("Local Area Connection".into());
    }
    v
}
#[cfg(not(target_os = "windows"))]
fn dns_interfaces() -> Vec<String> {
    vec![]
}

#[cfg(target_os = "windows")]
fn set_dns_all(dns: &str) {
    for name in dns_interfaces() {
        let _ = no_window(
            Command::new("netsh").args([
                "interface", "ip", "set", "dns", &name, "static", dns,
            ]),
        )
        .status();
    }
}
#[cfg(not(target_os = "windows"))]
fn set_dns_all(_: &str) {}

#[cfg(target_os = "windows")]
fn restore_dns_all() {
    for name in dns_interfaces() {
        let _ = no_window(
            Command::new("netsh").args(["interface", "ip", "set", "dns", &name, "dhcp"]),
        )
        .status();
    }
}
#[cfg(not(target_os = "windows"))]
fn restore_dns_all() {}

// ── Traffic cache + background poller ────────────────────────────────

#[derive(Debug, Clone, Default)]
struct TrafficCache {
    up: u64,
    down: u64,
    speed_up: u64,
    speed_down: u64,
}

fn fetch_connections(client: &reqwest::blocking::Client) -> Result<(u64, u64)> {
    let r = client
        .get("http://127.0.0.1:9097/connections")
        .header("Authorization", "Bearer dakal")
        .send()
        .context("Clash API connect")?;
    let v: serde_json::Value = r.json().context("Clash API parse")?;
    Ok((
        v["upload_total"].as_u64().unwrap_or(0),
        v["download_total"].as_u64().unwrap_or(0),
    ))
}

fn traffic_poller(cache: Arc<Mutex<TrafficCache>>, active: Arc<AtomicBool>) {
    let Ok(client) = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    else {
        return;
    };

    let mut prev_up = 0u64;
    let mut prev_down = 0u64;
    let mut prev_time = Instant::now();
    let mut was_up = false;

    while active.load(Ordering::Relaxed) {
        match fetch_connections(&client) {
            Ok((up, down)) => {
                let now = Instant::now();
                let dt = now.duration_since(prev_time).as_secs_f64();
                let (su, sd) = if was_up && dt > 0.5 {
                    (
                        ((up as f64 - prev_up as f64) / dt) as u64,
                        ((down as f64 - prev_down as f64) / dt) as u64,
                    )
                } else {
                    (0, 0)
                };
                prev_up = up;
                prev_down = down;
                prev_time = now;
                was_up = true;
                let mut c = cache.lock().unwrap();
                *c = TrafficCache { up, down, speed_up: su, speed_down: sd };
            }
            Err(_) => {
                was_up = false;
                prev_up = 0;
                prev_down = 0;
                let mut c = cache.lock().unwrap();
                *c = TrafficCache::default();
            }
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}

// ── sing-box config builder ──────────────────────────────────────────

fn resolve_host(host: &str) -> Vec<String> {
    format!("{host}:0")
        .to_socket_addrs()
        .map(|a| {
            let mut v = Vec::new();
            for addr in a {
                let ip = addr.ip().to_string();
                if !v.contains(&ip) {
                    v.push(ip);
                }
            }
            v
        })
        .unwrap_or_default()
}

fn build_singbox_config(c: &Config) -> Result<serde_json::Value> {
    let ips = resolve_host(&c.server_address);
    let ip = ips
        .first()
        .cloned()
        .unwrap_or_else(|| "198.18.0.0".into());
    let bypass: Vec<String> = if ips.is_empty() {
        vec!["198.18.0.0/15".into()]
    } else {
        ips.iter().map(|i| format!("{i}/32")).collect()
    };

    let mut rules = vec![
        serde_json::json!({"action": "sniff"}),
        serde_json::json!({"action": "hijack-dns", "protocol": "dns"}),
        serde_json::json!({"ip_cidr": bypass, "outbound": "direct"}),
    ];
    for r in &c.split_rules {
        if let Some(sfx) = r.pattern.strip_prefix("*.") {
            rules.push(serde_json::json!({"domain_suffix": [sfx], "outbound": "direct"}));
        } else if r.pattern.contains('*') {
            rules.push(serde_json::json!({"domain_keyword": [r.pattern.replace('*', "")], "outbound": "direct"}));
        } else {
            rules.push(serde_json::json!({"domain": [&r.pattern], "outbound": "direct"}));
        }
    }

    let mut inbound = serde_json::json!({
        "type": "tun", "tag": "tun-in",
        "address": ["172.19.0.1/30"],
        "auto_route": true, "strict_route": true, "stack": "system"
    });
    if let Some(mtu) = c.mtu {
        inbound["mtu"] = serde_json::json!(mtu);
    }

    Ok(serde_json::json!({
        "log": {"disabled": false, "level": "info", "timestamp": true},
        "experimental": {"clash_api": {"external_controller": "127.0.0.1:9097", "secret": "dakal", "default_mode": "rule"}},
        "dns": {
            "servers": [
                {"type": "https", "tag": "remote-doh", "server": "1.1.1.1", "detour": "ss-out"},
                {"type": "https", "tag": "google-doh", "server": "8.8.8.8", "detour": "ss-out"}
            ],
            "final": "remote-doh"
        },
        "inbounds": [inbound],
        "outbounds": [
            {
                "type": "shadowsocks", "tag": "ss-out",
                "server": ip, "server_port": c.ss_port,
                "method": "2022-blake3-chacha20-poly1305",
                "password": c.ss_password, "detour": "shadowtls-out",
                "udp_over_tcp": {"enabled": true}
            },
            {
                "type": "shadowtls", "tag": "shadowtls-out",
                "server": ip, "server_port": c.stls_port, "version": 3,
                "password": c.stls_password,
                "tls": {"enabled": true, "server_name": c.stls_sni}
            },
            {"type": "direct", "tag": "direct"}
        ],
        "route": {
            "rules": rules, "final": "ss-out",
            "auto_detect_interface": true,
            "default_domain_resolver": "remote-doh",
            "find_process": true
        }
    }))
}

// ── ProxyManager ─────────────────────────────────────────────────────

struct ProxyManager {
    child: Option<Child>,
    config_dir: PathBuf,
    log_path: PathBuf,
}

impl ProxyManager {
    fn new() -> Result<Self> {
        let d = app_config_dir()?;
        Ok(Self {
            child: None,
            log_path: d.join("sing-box.log"),
            config_dir: d,
        })
    }

    fn is_running(&mut self) -> bool {
        if let Some(ref mut c) = self.child {
            match c.try_wait() {
                Ok(Some(_)) => {
                    self.child = None;
                    false
                }
                Ok(None) => true,
                Err(_) => {
                    self.child = None;
                    false
                }
            }
        } else {
            false
        }
    }

    fn start(&mut self, config: &Config) -> Result<String> {
        if self.is_running() {
            bail!("Already running");
        }

        #[cfg(target_os = "windows")]
        {
            extern "system" {
                fn IsUserAnAdmin() -> i32;
            }
            if unsafe { IsUserAnAdmin() == 0 } {
                bail!("Admin required. Right-click → Run as administrator.");
            }
        }

        let exe = self.find_or_download()?;
        let cfg = build_singbox_config(config)?;
        let json = serde_json::to_string_pretty(&cfg)?;
        let cfg_path = self.config_dir.join("config.json");

        if fs::read_to_string(&cfg_path).ok().as_deref() != Some(&json) {
            fs::write(&cfg_path, &json)?;
        }

        let chk = no_window(Command::new(&exe).args(["check", "-c", cfg_path.to_str().unwrap()]))
            .output()
            .context("sing-box check")?;
        if !chk.status.success() {
            let e = String::from_utf8_lossy(&chk.stderr);
            bail!("Config invalid:\n{}", e.trim());
        }

        let lf = fs::File::create(&self.log_path)?;
        let child = no_window(Command::new(&exe).args(["run", "-c", cfg_path.to_str().unwrap()]))
            .stdout(Stdio::from(lf.try_clone()?))
            .stderr(Stdio::from(lf))
            .spawn()
            .context("spawn sing-box")?;
        self.child = Some(child);

        std::thread::sleep(Duration::from_millis(500));
        if let Some(ref mut c) = self.child {
            if let Ok(Some(st)) = c.try_wait() {
                self.child = None;
                let log = fs::read_to_string(&self.log_path).unwrap_or_default();
                bail!("sing-box exited ({}):\n{}", st.code().unwrap_or(-1), log.trim());
            }
        }

        set_dns_all("8.8.8.8");
        Ok("Connected".into())
    }

    fn stop(&mut self) -> Result<String> {
        let was = self.child.is_some();
        if let Some(mut c) = self.child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        if !was {
            bail!("Not running");
        }
        restore_dns_all();
        Ok("Disconnected".into())
    }

    fn find_or_download(&self) -> Result<PathBuf> {
        let candidates = [
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("sing-box.exe"))),
            std::env::current_exe().ok().and_then(|p| {
                p.parent()
                    .map(|d| d.join("resources").join("sing-box.exe"))
            }),
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("bin").join("sing-box.exe"))),
            Some(PathBuf::from("bin/sing-box.exe")),
            Some(PathBuf::from("sing-box.exe")),
            Some(self.config_dir.join("sing-box.exe")),
        ];
        for p in candidates.iter().flatten() {
            if p.exists() {
                return Ok(p.clone());
            }
        }
        self.download()
    }

    fn download(&self) -> Result<PathBuf> {
        let exe = self.config_dir.join("sing-box.exe");
        if exe.exists() {
            return Ok(exe);
        }
        let client = reqwest::blocking::Client::builder()
            .user_agent("dakal-tls")
            .build()?;
        let rel: serde_json::Value = client
            .get("https://api.github.com/repos/SagerNet/sing-box/releases/latest")
            .send()?
            .json()?;
        let tag = rel["tag_name"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("no tag"))?;
        let ver = tag.trim_start_matches('v');
        let url = format!(
            "https://github.com/SagerNet/sing-box/releases/download/{tag}/sing-box-{ver}-windows-amd64.zip"
        );
        let bytes = client.get(&url).send()?.error_for_status()?.bytes()?;
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))?;
        for i in 0..archive.len() {
            let mut f = archive.by_index(i)?;
            if f.name().ends_with("sing-box.exe") {
                let mut buf = Vec::new();
                f.read_to_end(&mut buf)?;
                fs::write(&exe, &buf)?;
                return Ok(exe);
            }
        }
        bail!("sing-box.exe not found in release")
    }
}

// ── App state ────────────────────────────────────────────────────────

struct AppState {
    proxy: Mutex<ProxyManager>,
    started_at: Mutex<Option<Instant>>,
    traffic: Arc<Mutex<TrafficCache>>,
    store: Mutex<ProfileStore>,
    poller_alive: Arc<AtomicBool>,
}

#[derive(Serialize)]
struct Stats {
    running: bool,
    up: u64,
    down: u64,
    speed_up: u64,
    speed_down: u64,
    uptime: u64,
    profile: String,
    server: String,
}

// ── Tauri commands ───────────────────────────────────────────────────

#[tauri::command]
fn get_stats(state: State<AppState>) -> Result<Stats, String> {
    let running = state.proxy.lock().unwrap().is_running();
    let t = state.traffic.lock().unwrap().clone();
    let uptime = state
        .started_at
        .lock()
        .unwrap()
        .map(|s| s.elapsed().as_secs())
        .unwrap_or(0);
    let store = state.store.lock().unwrap();
    let profile = store.active_profile.clone();
    let server = store
        .active_config()
        .map(|c| format!("{}:{}", c.server_address, c.stls_port))
        .unwrap_or_default();
    Ok(Stats { running, up: t.up, down: t.down, speed_up: t.speed_up, speed_down: t.speed_down, uptime, profile, server })
}

#[tauri::command]
fn connect(app: tauri::AppHandle, state: State<AppState>) -> Result<String, String> {
    let mut proxy = state.proxy.lock().unwrap();
    let cfg = state.store.lock().unwrap().active_config().map_err(|e| e.to_string())?;
    let r = proxy.start(&cfg).map_err(|e| e.to_string())?;
    *state.started_at.lock().unwrap() = Some(Instant::now());
    drop(proxy);
    update_tray(&app);
    Ok(r)
}

#[tauri::command]
fn disconnect(app: tauri::AppHandle, state: State<AppState>) -> Result<String, String> {
    let mut proxy = state.proxy.lock().unwrap();
    let r = proxy.stop().map_err(|e| e.to_string())?;
    *state.started_at.lock().unwrap() = None;
    drop(proxy);
    update_tray(&app);
    Ok(r)
}

#[tauri::command]
fn get_config(state: State<AppState>) -> Result<Config, String> {
    state.store.lock().unwrap().active_config().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(config: Config, state: State<AppState>) -> Result<String, String> {
    let mut store = state.store.lock().unwrap();
    let p = store
        .profiles
        .iter_mut()
        .find(|p| p.name == store.active_profile)
        .ok_or("active profile not found")?;
    p.config = config;
    store.save().map_err(|e| e.to_string())?;
    Ok("Saved".into())
}

#[tauri::command]
fn get_profiles(state: State<AppState>) -> Result<ProfileStore, String> {
    Ok(state.store.lock().unwrap().clone())
}

#[tauri::command]
fn add_profile(name: String, config: Config, state: State<AppState>) -> Result<String, String> {
    let mut store = state.store.lock().unwrap();
    if store.profiles.iter().any(|p| p.name == name) {
        return Err(format!("'{name}' already exists"));
    }
    store.profiles.push(Profile { name: name.clone(), config });
    store.save().map_err(|e| e.to_string())?;
    Ok(format!("Created '{name}'"))
}

#[tauri::command]
fn delete_profile(name: String, state: State<AppState>) -> Result<String, String> {
    let mut store = state.store.lock().unwrap();
    if name == "Default" {
        return Err("Cannot delete Default".into());
    }
    if store.active_profile == name {
        return Err("Cannot delete active profile".into());
    }
    store.profiles.retain(|p| p.name != name);
    store.save().map_err(|e| e.to_string())?;
    Ok(format!("Deleted '{name}'"))
}

#[tauri::command]
fn switch_profile(name: String, state: State<AppState>) -> Result<String, String> {
    let mut store = state.store.lock().unwrap();
    if !store.profiles.iter().any(|p| p.name == name) {
        return Err(format!("'{name}' not found"));
    }
    store.active_profile = name.clone();
    store.save().map_err(|e| e.to_string())?;
    Ok(format!("Switched to '{name}'"))
}

#[tauri::command]
fn switch_profile_stop(
    name: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<String, String> {
    {
        let mut proxy = state.proxy.lock().unwrap();
        if proxy.is_running() {
            proxy.stop().map_err(|e| e.to_string())?;
            *state.started_at.lock().unwrap() = None;
        }
    }
    let mut store = state.store.lock().unwrap();
    if !store.profiles.iter().any(|p| p.name == name) {
        return Err(format!("'{name}' not found"));
    }
    store.active_profile = name.clone();
    store.save().map_err(|e| e.to_string())?;
    drop(store);
    update_tray(&app);
    Ok(format!("Switched to '{name}'"))
}

#[tauri::command]
fn ping() -> Result<String, String> {
    let c = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("client: {e}"))?;
    let _ = c.get("http://www.gstatic.com/generate_204").send();
    let t = Instant::now();
    let r = c
        .get("http://www.gstatic.com/generate_204")
        .send()
        .map_err(|e| format!("request: {e}"))?;
    if !r.status().is_success() && r.status().as_u16() != 204 {
        return Err(format!("status: {}", r.status()));
    }
    Ok(format!("{}ms", t.elapsed().as_millis()))
}

#[tauri::command]
fn get_log(state: State<AppState>) -> Result<String, String> {
    let proxy = state.proxy.lock().unwrap();
    fs::read_to_string(&proxy.log_path).map_err(|_| "No log".into())
}

// ── Tray ─────────────────────────────────────────────────────────────

fn update_tray(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let running = state.proxy.lock().unwrap().is_running();
    let profile = state.store.lock().unwrap().active_profile.clone();

    let tooltip = if running {
        format!("dakal-tls — {profile}")
    } else {
        "dakal-tls".into()
    };

    let mk = |id: &str, label: &str| MenuItemBuilder::with_id(id, label).build(app).unwrap();
    let show = mk("show", "Show");
    let hide = mk("hide", "Hide");
    let quit = mk("quit", "Quit");
    let prof = MenuItemBuilder::with_id("profile", &profile)
        .enabled(false)
        .build(app)
        .unwrap();

    let menu = if running {
        let disc = mk("disconnect", "Disconnect");
        MenuBuilder::new(app)
            .item(&prof)
            .item(&disc)
            .separator()
            .item(&show)
            .item(&hide)
            .separator()
            .item(&quit)
            .build()
            .unwrap()
    } else {
        let conn = mk("connect", "Connect");
        MenuBuilder::new(app)
            .item(&prof)
            .item(&conn)
            .separator()
            .item(&show)
            .item(&hide)
            .separator()
            .item(&quit)
            .build()
            .unwrap()
    };

    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(&tooltip));
        let _ = tray.set_menu(Some(menu));
    }
}

// ── main ─────────────────────────────────────────────────────────────

fn main() {
    check_single_instance();

    let panic_log = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_default()
        .join("dakal-tls-panic.log");
    std::fs::write(&panic_log, "starting\n").ok();
    let pl = panic_log;
    std::panic::set_hook(Box::new(move |info| {
        std::fs::write(&pl, format!("PANIC: {info}\n")).ok();
    }));

    let proxy = ProxyManager::new().expect("init failed");
    let store = ProfileStore::load().unwrap_or_default();
    let traffic = Arc::new(Mutex::new(TrafficCache::default()));
    let poller_alive = Arc::new(AtomicBool::new(true));

    let tc = traffic.clone();
    let pa = poller_alive.clone();
    std::thread::spawn(move || traffic_poller(tc, pa));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            proxy: Mutex::new(proxy),
            started_at: Mutex::new(None),
            traffic,
            store: Mutex::new(store),
            poller_alive,
        })
        .setup(|app| {
            let mk = |id: &str, label: &str| MenuItemBuilder::with_id(id, label).build(app);
            let show = mk("show", "Show")?;
            let hide = mk("hide", "Hide")?;
            let quit = mk("quit", "Quit")?;
            let conn = mk("connect", "Connect")?;
            let disc = mk("disconnect", "Disconnect")?;
            let prof_name = app
                .state::<AppState>()
                .store
                .lock()
                .unwrap()
                .active_profile
                .clone();
            let prof = MenuItemBuilder::with_id("profile", &prof_name)
                .enabled(false)
                .build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&prof)
                .item(&conn)
                .item(&disc)
                .separator()
                .item(&show)
                .item(&hide)
                .separator()
                .item(&quit)
                .build()?;

            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("dakal-tls")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            w.show().ok();
                            w.set_focus().ok();
                        }
                    }
                    "hide" => {
                        if let Some(w) = app.get_webview_window("main") {
                            w.hide().ok();
                        }
                    }
                    "connect" => {
                        let s = app.state::<AppState>();
                        let mut px = s.proxy.lock().unwrap();
                        if !px.is_running() {
                            let cfg = s.store.lock().unwrap().active_config();
                            if let Ok(cfg) = cfg {
                                let _ = px.start(&cfg);
                                *s.started_at.lock().unwrap() = Some(Instant::now());
                            }
                        }
                        drop(px);
                        update_tray(app);
                    }
                    "disconnect" => {
                        let s = app.state::<AppState>();
                        let mut px = s.proxy.lock().unwrap();
                        if px.is_running() {
                            let _ = px.stop();
                            *s.started_at.lock().unwrap() = None;
                        }
                        drop(px);
                        update_tray(app);
                    }
                    "quit" => {
                        let s = app.state::<AppState>();
                        let mut px = s.proxy.lock().unwrap();
                        if px.is_running() {
                            let _ = px.stop();
                        }
                        drop(px);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().ok().unwrap_or(false) {
                                w.hide().ok();
                            } else {
                                w.show().ok();
                                w.set_focus().ok();
                            }
                        }
                    }
                })
                .build(app)?;

            update_tray(&app.handle());

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("dakal-tls")
                .inner_size(500.0, 480.0)
                .resizable(false)
                .build()?;

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
            get_stats, connect, disconnect, get_config, save_config,
            get_profiles, add_profile, delete_profile, switch_profile,
            switch_profile_stop, ping, get_log,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri app");
}
