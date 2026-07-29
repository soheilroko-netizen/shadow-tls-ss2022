// config.rs - App configuration management
use anyhow::Result;
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default = "default_server_address")]
    pub server_address: String,
    #[serde(default = "default_ss_port")]
    pub ss_port: u16,
    pub ss_password: String,
    #[serde(default = "default_stls_port")]
    pub stls_port: u16,
    pub stls_password: String,
    #[serde(default = "default_stls_sni")]
    pub stls_sni: String,
    #[serde(default = "default_socks5_port")]
    pub socks5_port: u16,
    #[serde(default)]
    pub mtu: Option<u32>,
    #[serde(default = "default_encryption_method")]
    pub encryption_method: String,
    #[serde(default)]
    pub split_mode: String,
    #[serde(default)]
    pub split_processes: Vec<String>,
    #[serde(default)]
    pub split_domains: Vec<String>,
    #[serde(default)]
    pub split_rules: Vec<SplitRule>,
    #[serde(default)]
    pub total_up: Option<u64>,
    #[serde(default)]
    pub total_down: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SplitRule {
    pub pattern: String,
    #[serde(default)]
    pub process_names: Vec<String>,
    #[serde(default)]
    pub folder_paths: Vec<String>,
}

fn default_server_address() -> String { "ns.baft.uk".to_string() }
fn default_ss_port() -> u16 { 8380 }
fn default_stls_port() -> u16 { 8553 }
fn default_stls_sni() -> String { "dl.google.com".to_string() }
fn default_socks5_port() -> u16 { 1080 }
fn default_encryption_method() -> String { "chacha20-ietf-poly1305".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub name: String,
    pub config: Config,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfileStore {
    pub profiles: Vec<Profile>,
    pub active_profile: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server_address: "ns.baft.uk".to_string(),
            ss_port: 8380,
            ss_password: "tE+3/qlN/orCZRVUutWouysZ8BQs4RWzq46WK6CDGG4=".to_string(),
            stls_port: 8553,
            stls_password: "y2lachetore".to_string(),
            stls_sni: "dl.google.com".to_string(),
            socks5_port: 1080,
            mtu: None,
            encryption_method: "chacha20-ietf-poly1305".to_string(),
            split_mode: "exclude".to_string(),
            split_processes: vec![],
            split_domains: vec![],
            split_rules: vec![],
        }
    }
}

impl Config {
    pub fn config_path() -> Result<PathBuf> {
        let proj_dirs = ProjectDirs::from("com", "stls", "stls")
            .ok_or_else(|| anyhow::anyhow!("Could not determine config directory"))?;
        let config_dir = proj_dirs.config_dir();
        fs::create_dir_all(config_dir)?;
        Ok(config_dir.join("config.json"))
    }

    pub fn load() -> Result<Self> {
        let path = Self::config_path()?;
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = fs::read_to_string(&path)?;
        match serde_json::from_str::<Config>(&content) {
            Ok(config) => Ok(config),
            Err(_) => {
                eprintln!("[stls] config parse failed, using defaults");
                Ok(Self::default())
            }
        }
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::config_path()?;
        let content = serde_json::to_string_pretty(self)?;
        fs::write(&path, content)?;
        Ok(())
    }
}

pub fn app_settings_path() -> Option<std::path::PathBuf> {
    let proj_dirs = directories::ProjectDirs::from("com", "stls", "dakal-tls")?;
    let config_dir = proj_dirs.config_dir();
    std::fs::create_dir_all(config_dir).ok()?;
    Some(config_dir.join("app_settings.json"))
}

impl ProfileStore {
    fn profiles_path() -> Result<PathBuf> {
        let proj_dirs = ProjectDirs::from("com", "stls", "stls")
            .ok_or_else(|| anyhow::anyhow!("Could not determine config directory"))?;
        let config_dir = proj_dirs.config_dir();
        fs::create_dir_all(config_dir)?;
        Ok(config_dir.join("profiles.json"))
    }

    pub fn load() -> Result<Self> {
        let path = Self::profiles_path()?;
        if !path.exists() {
            let default_config = Config::load().unwrap_or_default();
            return Ok(Self {
                profiles: vec![Profile {
                    name: "Germany 1".to_string(),
                    config: default_config.clone(),
                },
                Profile {
                    name: "Finland".to_string(),
                    config: Config {
                        server_address: "62.238.60.136".to_string(),
                        ..default_config
                    },
                }],
                active_profile: "Germany 1".to_string(),
            });
        }
        let content = fs::read_to_string(&path)?;
        let store: ProfileStore = serde_json::from_str(&content)?;
        Ok(store)
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::profiles_path()?;
        let content = serde_json::to_string_pretty(self)?;
        fs::write(&path, content)?;
        Ok(())
    }

    pub fn get_active_config(&self) -> Result<Config> {
        self.profiles
            .iter()
            .find(|p| p.name == self.active_profile)
            .map(|p| p.config.clone())
            .ok_or_else(|| anyhow::anyhow!("Active profile not found"))
    }

    pub fn add_profile(&mut self, name: String, config: Config) -> Result<()> {
        if self.profiles.iter().any(|p| p.name == name) {
            anyhow::bail!("Profile '{}' already exists", name);
        }
        self.profiles.push(Profile { name, config });
        self.save()
    }

    pub fn delete_profile(&mut self, name: &str) -> Result<()> {
        if name == "Default" {
            anyhow::bail!("Cannot delete Default profile");
        }
        if self.active_profile == name {
            anyhow::bail!("Cannot delete active profile");
        }
        self.profiles.retain(|p| p.name != name);
        self.save()
    }

    pub fn switch_profile(&mut self, name: &str) -> Result<()> {
        if !self.profiles.iter().any(|p| p.name == name) {
            anyhow::bail!("Profile '{}' not found", name);
        }
        self.active_profile = name.to_string();
        self.save()
    }

    pub fn update_active_config(&mut self, config: Config) -> Result<()> {
        if let Some(profile) = self.profiles.iter_mut().find(|p| p.name == self.active_profile) {
            profile.config = config;
            self.save()
        } else {
            anyhow::bail!("Active profile '{}' not found", self.active_profile);
        }
    }
}
