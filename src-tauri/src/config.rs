// config.rs - 4 hardcoded profiles (no management UI)
use anyhow::Result;
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub server_address: String,
    pub ss_port: u16,
    pub ss_password: String,
    pub stls_port: u16,
    pub stls_password: String,
    pub stls_sni: String,
    pub socks5_port: u16,
    pub mtu: Option<u32>,
    #[serde(default)]
    pub split_mode: String, // "full", "iran", "custom"
    #[serde(default)]
    pub split_rules: Vec<SplitRule>,

    pub mode: String,

    // Hysteria2 fields
    pub h2_port: u16,
    pub h2_password: String,
    pub h2_sni: String,
    pub h2_insecure: bool,
    pub h2_obfs: String,
    pub h2_obfs_password: String,
    pub h2_mport: String,
    #[serde(default = "h2_mbps_up_default")]
    pub h2_up_mbps: u32,
    #[serde(default = "h2_mbps_down_default")]
    pub h2_down_mbps: u32,
    #[serde(default = "h2_auto_default")]
    pub h2_auto: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SplitRule {
    pub pattern: String,
    #[serde(default)]
    pub process_names: Vec<String>,
    #[serde(default)]
    pub folder_paths: Vec<String>,
}

/// Get config directory path
pub fn config_dir() -> Result<PathBuf> {
    let proj_dirs = ProjectDirs::from("com", "stls", "stls")
        .ok_or_else(|| anyhow::anyhow!("Could not determine config directory"))?;
    Ok(proj_dirs.config_dir().to_path_buf())
}

/// Get config file path
pub fn config_path() -> Result<PathBuf> {
    let config_dir = config_dir()?;
    fs::create_dir_all(&config_dir)?;
    Ok(config_dir.join("config.json"))
}

/// Load active profile name from config.json (default "germany-1-stls")
pub fn load_profile() -> String {
    match config_path() {
        Ok(path) if path.exists() => {
            let content = fs::read_to_string(&path).unwrap_or_default();
            let result = serde_json::from_str::<serde_json::Value>(&content)
                .ok()
                .and_then(|v| v["profile"].as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "germany-1-stls".to_string());
            eprintln!("[stls] load_profile: '{}' from {}", result, path.display());
            result
        }
        _ => {
            eprintln!("[stls] load_profile: no config file, defaulting to germany-1-stls");
            "germany-1-stls".to_string()
        }
    }
}

/// Save profile name to config.json
pub fn save_profile(profile: &str) -> Result<()> {
    let path = config_path()?;
    let mut existing = if path.exists() {
        serde_json::from_str::<serde_json::Value>(&fs::read_to_string(&path)?)
            .unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    existing["profile"] = serde_json::Value::String(profile.to_string());
    fs::write(&path, serde_json::to_string_pretty(&existing)?)?;
    eprintln!("[stls] save_profile: wrote '{}' to {}", profile, path.display());
    Ok(())
}

/// Save Hysteria2 speed test results to config.json
pub fn save_h2_speeds(up_mbps: u32, down_mbps: u32) -> Result<()> {
    let path = config_path()?;
    let mut existing = if path.exists() {
        serde_json::from_str::<serde_json::Value>(&fs::read_to_string(&path)?)
            .unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    existing["h2_up_mbps"] = serde_json::json!(up_mbps);
    existing["h2_down_mbps"] = serde_json::json!(down_mbps);
    fs::write(&path, serde_json::to_string_pretty(&existing)?)?;
    Ok(())
}

/// Load Hysteria2 speed test results from config.json
pub fn load_h2_speeds() -> (u32, u32) {
    match config_path() {
        Ok(path) if path.exists() => {
            let content = fs::read_to_string(&path).unwrap_or_default();
            let v: serde_json::Value = serde_json::from_str(&content).unwrap_or(serde_json::json!({}));
            let up = v["h2_up_mbps"].as_u64().unwrap_or(h2_mbps_up_default() as u64) as u32;
            let down = v["h2_down_mbps"].as_u64().unwrap_or(h2_mbps_down_default() as u64) as u32;
            (up, down)
        }
        _ => (h2_mbps_up_default(), h2_mbps_down_default()),
    }
}

/// Default Hysteria2 upload bandwidth in MBps
pub fn h2_mbps_up_default() -> u32 { 40 }

/// Default Hysteria2 download bandwidth in MBps
pub fn h2_mbps_down_default() -> u32 { 80 }

/// Auto-tune flag default
pub fn h2_auto_default() -> bool { false }

/// Get config for a specific profile
pub fn get_profile_config(profile: &str) -> Config {
    let (up, down) = load_h2_speeds();
    
    // Load saved settings from config.json
    let path = config_path().ok();
    let saved_settings = path.and_then(|p| {
        if p.exists() {
            fs::read_to_string(&p).ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        } else {
            None
        }
    });
    
    let saved_mtu = saved_settings.as_ref().and_then(|v| v["mtu"].as_u64()).map(|m| m as u32);
    let saved_split_mode = saved_settings.as_ref().and_then(|v| v["split_mode"].as_str()).map(|s| s.to_string());
    let saved_split_rules = saved_settings.as_ref().and_then(|v| {
        v["split_rules"].as_array().map(|arr| {
            arr.iter().filter_map(|r| r["pattern"].as_str().map(|p| SplitRule { pattern: p.to_string(), process_names: vec![], folder_paths: vec![] })).collect()
        })
    });
    
    let base_config = match profile {
        "germany-1-stls" => Config {
            server_address: "ns.baft.uk".to_string(),
            ss_port: 8380,
            ss_password: "tE+3/qlN/orCZRVUutWouysZ8BQs4RWzq46WK6CDGG4=".to_string(),
            stls_port: 8553,
            stls_password: "y2lachetore".to_string(),
            stls_sni: "dl.google.com".to_string(),
            socks5_port: 1080,
            mtu: saved_mtu,
            split_mode: saved_split_mode.unwrap_or_else(|| "full".to_string()),
            split_rules: saved_split_rules.unwrap_or_default(),
            mode: "shadowtls".to_string(),
            h2_port: 40001,
            h2_password: "".to_string(),
            h2_sni: "".to_string(),
            h2_insecure: false,
            h2_obfs: "".to_string(),
            h2_obfs_password: "".to_string(),
            h2_mport: "".to_string(),
            h2_up_mbps: up,
            h2_down_mbps: down,
            h2_auto: false,
        },
        "germany-1-h2" => Config {
            server_address: "ns.baft.uk".to_string(),
            ss_port: 8380,
            ss_password: "".to_string(),
            stls_port: 8553,
            stls_password: "".to_string(),
            stls_sni: "".to_string(),
            socks5_port: 1080,
            mtu: saved_mtu,
            split_mode: saved_split_mode.unwrap_or_else(|| "full".to_string()),
            split_rules: saved_split_rules.unwrap_or_default(),
            mode: "hysteria2".to_string(),
            h2_port: 40001,
            h2_password: "testpass1".to_string(),
            h2_sni: "ns.baft.uk".to_string(),
            h2_insecure: false,
            h2_obfs: "salamander".to_string(),
            h2_obfs_password: "testobfspass".to_string(),
            h2_mport: "40001-45000".to_string(),
            h2_up_mbps: up,
            h2_down_mbps: down,
            h2_auto: false,
        },
        "finland-1-stls" => Config {
            server_address: "fn.baft.uk".to_string(),
            ss_port: 8380,
            ss_password: "tE+3/qlN/orCZRVUutWouysZ8BQs4RWzq46WK6CDGG4=".to_string(),
            stls_port: 8553,
            stls_password: "y2lachetore".to_string(),
            stls_sni: "dl.google.com".to_string(),
            socks5_port: 1080,
            mtu: saved_mtu,
            split_mode: saved_split_mode.unwrap_or_else(|| "full".to_string()),
            split_rules: saved_split_rules.unwrap_or_default(),
            mode: "shadowtls".to_string(),
            h2_port: 40001,
            h2_password: "".to_string(),
            h2_sni: "".to_string(),
            h2_insecure: false,
            h2_obfs: "".to_string(),
            h2_obfs_password: "".to_string(),
            h2_mport: "".to_string(),
            h2_up_mbps: up,
            h2_down_mbps: down,
            h2_auto: false,
        },
        "finland-1-h2" => Config {
            server_address: "fn.baft.uk".to_string(),
            ss_port: 8380,
            ss_password: "".to_string(),
            stls_port: 8553,
            stls_password: "".to_string(),
            stls_sni: "".to_string(),
            socks5_port: 1080,
            mtu: saved_mtu,
            split_mode: saved_split_mode.unwrap_or_else(|| "full".to_string()),
            split_rules: saved_split_rules.unwrap_or_default(),
            mode: "hysteria2".to_string(),
            h2_port: 40001,
            h2_password: "testpass1".to_string(),
            h2_sni: "fn.baft.uk".to_string(),
            h2_insecure: false,
            h2_obfs: "salamander".to_string(),
            h2_obfs_password: "testobfspass".to_string(),
            h2_mport: "40001-45000".to_string(),
            h2_up_mbps: up,
            h2_down_mbps: down,
            h2_auto: false,
        },
        _ => get_profile_config("germany-1-stls"), // fallback
    };
    
    base_config
}

/// Get config for active profile
pub fn get_active_config() -> Config {
    let profile = load_profile();
    get_profile_config(&profile)
}

/// Legacy: load mode from active profile
pub fn load_mode() -> String {
    let profile = load_profile();
    let cfg = get_profile_config(&profile);
    cfg.mode
}

/// Save mode (maps to profile switch)
pub fn save_mode(mode: &str) -> Result<()> {
    // When switching mode, keep current server
    let current = load_profile();
    let server = if current.starts_with("germany") { "germany" } else { "finland" };
    let new_profile = match mode {
        "shadowtls" => format!("{}-1-stls", server),
        "hysteria2" => format!("{}-1-h2", server),
        _ => "germany-1-stls".to_string(),
    };
    save_profile(&new_profile)
}

/// Save settings (MTU, split mode, split rules) to config.json
pub fn save_settings(mtu: Option<u32>, split_mode: String, split_rules: Vec<String>) -> Result<()> {
    let path = config_path()?;
    let mut existing = if path.exists() {
        serde_json::from_str::<serde_json::Value>(&fs::read_to_string(&path)?)
            .unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    
    if let Some(m) = mtu {
        existing["mtu"] = serde_json::json!(m);
    } else {
        existing["mtu"] = serde_json::Value::Null;
    }
    
    existing["split_mode"] = serde_json::json!(split_mode);
    existing["split_rules"] = serde_json::json!(split_rules.iter().map(|p| serde_json::json!({ "pattern": p })).collect::<Vec<_>>());
    
    fs::write(&path, serde_json::to_string_pretty(&existing)?)?;
    Ok(())
}
