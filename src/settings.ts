import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import './styles.css';

// ── Types ────────────────────────────────────────────────────
interface Profile {
  name: string;
  is_active: boolean;
  config?: {
    server_address?: string;
    stls_port?: number;
    stls_password?: string;
    stls_sni?: string;
    ss_port?: number;
    ss_password?: string;
    socks5_port?: number;
    mtu?: number;
    split_rules?: { pattern: string }[];
    split_enabled?: boolean;
  };
}

interface Config {
  server_address: string;
  stls_port: number;
  stls_password: string;
  stls_sni: string;
  ss_port: number;
  ss_password: string;
  socks5_port: number;
  mtu?: number;
  split_rules?: { pattern: string }[];
  split_enabled?: boolean;
}

interface ProfilesStore {
  profiles: Profile[];
  active_profile: string;
}

// ── State ────────────────────────────────────────────────────
let profilesData: Profile[] = [];
let activeProfile = 'Default';
let currentTab = 'app';

// ── DOM Elements ─────────────────────────────────────────────
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
const profileSelect = document.getElementById('cfg-profile-select') as HTMLSelectElement;
const settingsMessage = document.getElementById('settings-message')!;
const splitMessage = document.getElementById('split-message')!;

// ── Tab switching ────────────────────────────────────────────
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab!;
    switchTab(tab);
  });
});

function switchTab(tab: string) {
  currentTab = tab;
  tabButtons.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  tabPanels.forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
}

// ── Message helpers ──────────────────────────────────────────
function showMsg(el: HTMLElement, msg: string, isError = false) {
  el.textContent = msg;
  el.className = `message ${isError ? 'error' : 'success'}`;
  setTimeout(() => { el.textContent = ''; el.className = 'message'; }, 3000);
}

// ── Load profiles ────────────────────────────────────────────
async function loadProfiles() {
  try {
    const store = await invoke<ProfilesStore>('get_profiles');
    profilesData = store.profiles;
    activeProfile = store.active_profile;

    profileSelect.innerHTML = '';
    store.profiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      if (p.name === store.active_profile) opt.selected = true;
      profileSelect.appendChild(opt);
    });

    await loadProfileConfig(activeProfile);
  } catch (e) {
    showMsg(settingsMessage, `Failed: ${e}`, true);
  }
}

async function loadProfileConfig(name: string) {
  try {
    const config = await invoke<Config>('get_config');
    (document.getElementById('cfg-server-address') as HTMLInputElement).value = config.server_address || '';
    (document.getElementById('cfg-stls-port') as HTMLInputElement).value = String(config.stls_port || 8553);
    (document.getElementById('cfg-stls-password') as HTMLInputElement).value = config.stls_password || '';
    (document.getElementById('cfg-stls-sni') as HTMLInputElement).value = config.stls_sni || '';
    (document.getElementById('cfg-ss-port') as HTMLInputElement).value = String(config.ss_port || 8380);
    (document.getElementById('cfg-ss-password') as HTMLInputElement).value = config.ss_password || '';
    (document.getElementById('cfg-socks5-port') as HTMLInputElement).value = String(config.socks5_port || 1080);
    const rules = (config.split_rules || []).map(r => r.pattern).join('\n');
    (document.getElementById('cfg-split-domains') as HTMLTextAreaElement).value = rules;
    (document.getElementById('cfg-split-enabled') as HTMLInputElement).checked = config.split_enabled || false;
  } catch (e) {
    showMsg(settingsMessage, `Failed to load config: ${e}`, true);
  }
}

// ── Profile select change ────────────────────────────────────
profileSelect.addEventListener('change', async () => {
  activeProfile = profileSelect.value;
  await loadProfileConfig(activeProfile);
});

// ── Save profile config ──────────────────────────────────────
document.getElementById('btn-save-config')?.addEventListener('click', async () => {
  try {
    const config: Config = {
      server_address: (document.getElementById('cfg-server-address') as HTMLInputElement).value,
      stls_port: parseInt((document.getElementById('cfg-stls-port') as HTMLInputElement).value) || 8553,
      stls_password: (document.getElementById('cfg-stls-password') as HTMLInputElement).value,
      stls_sni: (document.getElementById('cfg-stls-sni') as HTMLInputElement).value,
      ss_port: parseInt((document.getElementById('cfg-ss-port') as HTMLInputElement).value) || 8380,
      ss_password: (document.getElementById('cfg-ss-password') as HTMLInputElement).value,
      socks5_port: parseInt((document.getElementById('cfg-socks5-port') as HTMLInputElement).value) || 1080,
      split_rules: (document.getElementById('cfg-split-domains') as HTMLTextAreaElement).value
        .split('\n')
        .filter(l => l.trim())
        .map(l => ({ pattern: l.trim() })),
      split_enabled: (document.getElementById('cfg-split-enabled') as HTMLInputElement).checked,
    };
    await invoke('save_config', { config });
    showMsg(settingsMessage, 'Saved');
  } catch (e) {
    showMsg(settingsMessage, `Failed: ${e}`, true);
  }
});

// ── New profile ──────────────────────────────────────────────
document.getElementById('cfg-new-profile')?.addEventListener('click', async () => {
  const name = prompt('New profile name:');
  if (!name) return;
  try {
    await invoke('create_profile', { name });
    await loadProfiles();
    showMsg(settingsMessage, `Created ${name}`);
  } catch (e) {
    showMsg(settingsMessage, `Failed: ${e}`, true);
  }
});

// ── Delete profile ───────────────────────────────────────────
document.getElementById('cfg-delete-profile')?.addEventListener('click', async () => {
  if (profilesData.length <= 1) {
    showMsg(settingsMessage, 'Cannot delete last profile', true);
    return;
  }
  if (!confirm(`Delete profile "${activeProfile}"?`)) return;
  try {
    await invoke('delete_profile', { name: activeProfile });
    await loadProfiles();
    showMsg(settingsMessage, 'Deleted');
  } catch (e) {
    showMsg(settingsMessage, `Failed: ${e}`, true);
  }
});

// ── Save split rules ─────────────────────────────────────────
document.getElementById('btn-save-split')?.addEventListener('click', async () => {
  try {
    const rules = (document.getElementById('cfg-split-domains') as HTMLTextAreaElement).value
      .split('\n')
      .filter(l => l.trim())
      .map(l => ({ pattern: l.trim() }));
    const split_enabled = (document.getElementById('cfg-split-enabled') as HTMLInputElement).checked;
    // Save via save_config which includes split_rules and split_enabled
    const config = await invoke<Config>('get_config');
    config.split_rules = rules;
    config.split_enabled = split_enabled;
    await invoke('save_config', { config });
    showMsg(splitMessage, 'Saved');
  } catch (e) {
    showMsg(splitMessage, `Failed: ${e}`, true);
  }
});

// ── Init ─────────────────────────────────────────────────────
(async () => {
  await loadProfiles();
})();

// Listen for profile switches from main window
listen('profile-switched', (event: { payload: string }) => {
  activeProfile = event.payload;
  loadProfiles();
});