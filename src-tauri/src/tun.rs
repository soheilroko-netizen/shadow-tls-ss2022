// tun.rs - WinTun TUN device management for full VPN
// Captures all system traffic and routes through SOCKS5 proxy

use anyhow::{bail, Context, Result};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

#[cfg(target_os = "windows")]
use wintun::Session;

/// TUN adapter configuration
#[derive(Clone, Debug)]
pub struct TunConfig {
    /// TUN interface name (e.g., "stls0")
    pub interface_name: String,
    /// IPv4 address with CIDR (e.g., "10.0.0.1/24")
    pub address: String,
    /// SOCKS5 proxy address (e.g., "127.0.0.1")
    pub socks5_addr: String,
    /// SOCKS5 proxy port (e.g., 1080)
    pub socks5_port: u16,
}

impl Default for TunConfig {
    fn default() -> Self {
        TunConfig {
            interface_name: "stls0".into(),
            address: "10.0.0.1/24".into(),
            socks5_addr: "127.0.0.1".into(),
            socks5_port: 1080,
        }
    }
}

/// WinTun TUN device manager
pub struct TunManager {
    config: TunConfig,
    running: Arc<AtomicBool>,
    #[cfg(target_os = "windows")]
    session: Option<Arc<Session>>,
    #[cfg(target_os = "windows")]
    adapter: Option<Arc<wintun::Adapter>>,
    worker_handle: Option<JoinHandle<Result<()>>>,
}

impl TunManager {
    /// Create a new TUN manager with the given configuration
    pub fn new(config: TunConfig) -> Self {
        TunManager {
            config,
            running: Arc::new(AtomicBool::new(false)),
            #[cfg(target_os = "windows")]
            session: None,
            #[cfg(target_os = "windows")]
            adapter: None,
            worker_handle: None,
        }
    }

    /// Check if the TUN device is currently running
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    /// Start the TUN device and begin routing traffic
    #[cfg(target_os = "windows")]
    pub fn start(&mut self) -> Result<String> {
        if self.is_running() {
            bail!("TUN already running");
        }

        // Load wintun.dll — search common Tauri resource locations
        let wintun_path = {
            let mut candidates: Vec<std::path::PathBuf> = vec![];
            // exe directory (dev mode + some install layouts)
            if let Ok(exe) = std::env::current_exe() {
                if let Some(dir) = exe.parent() {
                    candidates.push(dir.join("wintun.dll"));
                    candidates.push(dir.join("bin").join("wintun.dll"));
                }
            }
            // Tauri resource dir for different install types
            if let Ok(local) = std::env::var("LOCALAPPDATA") {
                let base = std::path::PathBuf::from(local).join("stls");
                candidates.push(base.join("wintun.dll"));
                candidates.push(base.join("bin").join("wintun.dll"));
                let base2 = std::path::PathBuf::from(local).join("com.stls.app");
                candidates.push(base2.join("wintun.dll"));
                candidates.push(base2.join("bin").join("wintun.dll"));
            }
            if let Ok(roaming) = std::env::var("APPDATA") {
                let base = std::path::PathBuf::from(roaming).join("stls");
                candidates.push(base.join("wintun.dll"));
                candidates.push(base.join("bin").join("wintun.dll"));
                let base2 = std::path::PathBuf::from(roaming).join("com.stls.app");
                candidates.push(base2.join("wintun.dll"));
                candidates.push(base2.join("bin").join("wintun.dll"));
            }
            // Program Files (MSI install)
            if let Ok(pf) = std::env::var("ProgramFiles") {
                let base = std::path::PathBuf::from(pf).join("stls");
                candidates.push(base.join("wintun.dll"));
                candidates.push(base.join("bin").join("wintun.dll"));
            }
            candidates
                .into_iter()
                .find(|p| p.exists())
                .unwrap_or_else(|| {
                    std::env::current_exe()
                        .unwrap()
                        .parent()
                        .unwrap()
                        .join("wintun.dll")
                })
        };
        if !wintun_path.exists() {
            bail!(
                "wintun.dll not found. Place wintun.dll next to stls.exe or in %APPDATA%\\stls\\. Download from https://www.wintun.net/"
            );
        }

        // Load wintun library
        let wintun = unsafe {
            wintun::load_from_path(&wintun_path)
                .context("Failed to load wintun.dll")?
        };

        // Create or open the adapter
        let adapter = wintun::Adapter::create(
            &wintun,
            &self.config.interface_name,
            "stls-tun",
            None,
        ).context("Failed to create TUN adapter")?;

        // Set adapter address
        let address_parts: Vec<&str> = self.config.address.split('/').collect();
        let ip = address_parts.get(0).context("Invalid address format")?;
        let mask = address_parts.get(1).and_then(|m| m.parse::<u8>().ok()).unwrap_or(24);
        
        set_adapter_address(&adapter, ip, mask)?;

        // Start the session
        let session = adapter.start_session(wintun::MAX_RING_CAPACITY)
            .context("Failed to start TUN session")?;
        let session = Arc::new(session);
        
        // Store adapter and session
        self.adapter = Some(adapter);
        self.session = Some(session.clone());

        // Start packet processing worker
        self.running.store(true, Ordering::Relaxed);
        let running = self.running.clone();
        let socks5_addr = self.config.socks5_addr.clone();
        let socks5_port = self.config.socks5_port;

        let handle = thread::spawn(move || {
            packet_worker(session, running, socks5_addr, socks5_port)
        });

        self.worker_handle = Some(handle);

        Ok(format!(
            "TUN started: {} ({})",
            self.config.interface_name,
            self.config.address
        ))
    }

    /// Stop the TUN device
    pub fn stop(&mut self) -> Result<String> {
        if !self.is_running() {
            bail!("TUN not running");
        }

        self.running.store(false, Ordering::Relaxed);
        
        if let Some(handle) = self.worker_handle.take() {
            let _ = handle.join();
        }

        #[cfg(target_os = "windows")]
        {
            self.session = None;
            self.adapter = None;
        }

        Ok("TUN stopped".into())
    }
}

/// Set IP address on the TUN adapter (Windows-specific)
#[cfg(target_os = "windows")]
fn set_adapter_address(adapter: &Arc<wintun::Adapter>, ip: &str, prefix_len: u8) -> Result<()> {
    use std::process::Command;
    
    // Use netsh to configure the interface
    let if_name = adapter.get_name().context("Failed to get adapter name")?;
    
    let output = Command::new("netsh")
        .args(&[
            "interface", "ip", "set", "address",
            &if_name, "static", ip, &format!("255.255.255.{}", 256 - (1 << (32 - prefix_len)))
        ])
        .output()
        .context("Failed to run netsh")?;
    
    if !output.status.success() {
        bail!(
            "Failed to set IP address: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    
    Ok(())
}

/// Packet processing worker thread
#[cfg(target_os = "windows")]
fn packet_worker(
    session: Arc<Session>,
    running: Arc<AtomicBool>,
    socks5_addr: String,
    socks5_port: u16,
) -> Result<()> {
    crate::forwarder::run(session, running, socks5_addr, socks5_port)
}

#[cfg(not(target_os = "windows"))]
impl TunManager {
    pub fn start(&mut self) -> Result<String> {
        bail!("TUN mode only supported on Windows")
    }
}