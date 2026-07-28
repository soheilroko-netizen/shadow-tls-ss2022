import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface Config {
  server_address: string;
  ss_port: number;
  ss_password: string;
  stls_port: number;
  stls_password: string;
  stls_sni: string;
  socks5_port: number;
  mtu: number | null;
  split_rules: SplitRule[];
}
interface SplitRule { pattern: string; }
interface Profile { name: string; config: Config; }
interface ProfileStore { profiles: Profile[]; active_profile: string; }

const WIN_MAIN = { w: 800, h: 500 };
const WIN_SETTINGS = { w: 600, h: 750 };

async function setSize(w: number, h: number) {
  try { await getCurrentWindow().setSize({ type: 'Logical', width: w, height: h }); } catch {}
}

let currentView = 'main';

function showView(name: string) {
  document.querySelectorAll('.view').forEach(v => (v as HTMLElement).style.display = 'none');
  const el = document.getElementById('view-' + name);
  if (el) {
    el.style.display = 'flex';
    (el as HTMLElement).classList.add('active');
  }
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navBtn = document.querySelector('.nav-item[data-view="' + name + '"]');
  if (navBtn) navBtn.classList.add('active');
  currentView = name;
  if (name === 'main') setSize(WIN_MAIN.w, WIN_MAIN.h);
  else setSize(WIN_SETTINGS.w, WIN_SETTINGS.h);
}

// ── Connection ───────────────────────────────────────────

let connected = false;

async function updateStatus() {
  try {
    const running = await invoke<boolean>('get_status');
    connected = running;
    const badge = document.getElementById('status-badge')!;
    const txt = document.getElementById('status-text')!;
    const planet = document.getElementById('planet-icon')!;
    if (running) {
      badge.className = 'status-badge connected';
      txt.textContent = 'Connected';
      planet.classList.add('connected');
    } else {
      badge.className = 'status-badge disconnected';
      txt.textContent = 'Disconnected';
      planet.classList.remove('connected');
    }
  } catch {}
}

async function toggleConnect() {
  if (connected) {
    try { await invoke('stop_proxy'); } catch {}
  } else {
    try { await invoke('start_proxy'); } catch {}
  }
  await updateStatus();
  if (connected) setTimeout(doPing, 1500);
}

// ── Ping ─────────────────────────────────────────────────

async function doPing() {
  try {
    const el = document.getElementById('ping-value')!;
    el.textContent = '...';
    const ms = await invoke<string>('real_ping');
    el.textContent = ms;
  } catch {
    document.getElementById('ping-value')!.textContent = 'TIMEOUT';
  }
}

// ── Server info ──────────────────────────────────────────

async function updateServerInfo() {
  try {
    const config = await invoke<Config>('get_config');
    const name = config.server_address + ':' + config.stls_port;
    document.getElementById('server-name')!.textContent = name;
    document.getElementById('bottom-server')!.textContent = name;
  } catch {}
}

function formatBytes(b: number): string {
  if (b === 0) return '0';
  if (b < 1024) return b + ' B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
  if (b < 1024*1024*1024) return (b/(1024*1024)).toFixed(1) + ' MB';
  return (b/(1024*1024*1024)).toFixed(2) + ' GB';
}

async function updateTraffic() {
  try {
    const raw = await invoke<string>('get_traffic');
    const v = JSON.parse(raw);
    document.getElementById('bottom-traffic')!.textContent = '\u2191 ' + formatBytes(v.up) + '  \u2193 ' + formatBytes(v.down);
  } catch {}
}

function pad(n: number) { return n.toString().padStart(2, '0'); }

async function updateUptime() {
  try {
    const secs = await invoke<number>('get_uptime');
    const el = document.getElementById('timer')!;
    const bottomEl = document.getElementById('bottom-uptime')!;
    if (secs === 0) {
      el.textContent = '00:00';
      bottomEl.textContent = '00:00';
      return;
    }
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const t = h > 0 ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
    el.textContent = t;
    bottomEl.textContent = t;
  } catch {}
}

// ── Profile management ───────────────────────────────────

async function loadProfiles() {
  try {
    const store = await invoke<ProfileStore>('get_profiles');
    const selects = ['sidebar-profile-select', 'server-profile-select', 'settings-profile-select'];
    selects.forEach(id => {
      const sel = document.getElementById(id) as HTMLSelectElement;
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = '';
      store.profiles.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
      });
      if (cur && store.profiles.some(p => p.name === cur)) sel.value = cur;
    });
  } catch {}
}

async function profileChanged(id: string) {
  const sel = document.getElementById(id) as HTMLSelectElement;
  const name = sel.value;
  if (!name) return;
  try {
    await invoke('switch_profile_stop', { name });
    // sync all selects
    const others = ['sidebar-profile-select', 'server-profile-select', 'settings-profile-select'].filter(x => x !== id);
    others.forEach(oid => {
      const osel = document.getElementById(oid) as HTMLSelectElement;
      if (osel) osel.value = name;
    });
    updateServerInfo();
    updateStatus();
  } catch {}
}

// ── Settings ─────────────────────────────────────────────

async function loadConfig() {
  try {
    const config = await invoke<Config>('get_config');
    (document.getElementById('server_address') as HTMLInputElement).value = config.server_address;
    (document.getElementById('ss_port') as HTMLInputElement).value = config.ss_port.toString();
    (document.getElementById('ss_password') as HTMLInputElement).value = config.ss_password;
    (document.getElementById('stls_port') as HTMLInputElement).value = config.stls_port.toString();
    (document.getElementById('stls_password') as HTMLInputElement).value = config.stls_password;
    (document.getElementById('stls_sni') as HTMLInputElement).value = config.stls_sni;
    (document.getElementById('socks5_port') as HTMLInputElement).value = config.socks5_port.toString();
    (document.getElementById('mtu') as HTMLInputElement).value = config.mtu ? config.mtu.toString() : '';
    (document.getElementById('split_rules_view') as HTMLTextAreaElement).value = config.split_rules.map(r => r.pattern).join('\\n');
  } catch {}
}

async function saveConfig(e: Event) {
  e.preventDefault();
  const mtuRaw = (document.getElementById('mtu') as HTMLInputElement).value;
  const config: Config = {
    server_address: (document.getElementById('server_address') as HTMLInputElement).value,
    ss_port: parseInt((document.getElementById('ss_port') as HTMLInputElement).value),
    ss_password: (document.getElementById('ss_password') as HTMLInputElement).value,
    stls_port: parseInt((document.getElementById('stls_port') as HTMLInputElement).value),
    stls_password: (document.getElementById('stls_password') as HTMLInputElement).value,
    stls_sni: (document.getElementById('stls_sni') as HTMLInputElement).value,
    socks5_port: parseInt((document.getElementById('socks5_port') as HTMLInputElement).value),
    mtu: mtuRaw ? parseInt(mtuRaw) : null,
    split_rules: [],
  };
  // Re-read split_rules from settings form if available
  const splitEl = document.getElementById('split_rules') as HTMLTextAreaElement;
  if (splitEl) {
    config.split_rules = splitEl.value.split('\\n').map(s => s.trim()).filter(s => s.length > 0).map(s => ({ pattern: s }));
  }
  try {
    await invoke('save_config', { config });
    showMsg('settings-message', 'Saved!', 'success');
    updateServerInfo();
  } catch (err) {
    showMsg('settings-message', 'Failed: ' + err, 'error');
  }
}

async function newProfile() {
  const name = prompt('Profile name:');
  if (!name || !name.trim()) return;
  try {
    await invoke('add_profile', { name: name.trim(), config: await invoke<Config>('get_config') });
    await loadProfiles();
    showMsg('settings-message', 'Created!', 'success');
  } catch (err) {
    showMsg('settings-message', 'Failed: ' + err, 'error');
  }
}

async function deleteProfile() {
  const sel = document.getElementById('settings-profile-select') as HTMLSelectElement;
  const name = sel.value;
  if (name === 'Default') { showMsg('settings-message', 'Cannot delete Default', 'error'); return; }
  if (!confirm('Delete "' + name + '"?')) return;
  try {
    await invoke('delete_profile', { name });
    await loadProfiles();
    showMsg('settings-message', 'Deleted', 'success');
  } catch (err) {
    showMsg('settings-message', 'Failed: ' + err, 'error');
  }
}

function showMsg(id: string, text: string, type: 'success' | 'error') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'msg ' + type;
  setTimeout(() => { el.textContent = ''; el.className = 'msg'; }, 3000);
}

// ── Log ──────────────────────────────────────────────────

async function refreshLog() {
  try {
    const log = await invoke<string>('get_log');
    document.getElementById('log-content')!.textContent = log;
  } catch (err) {
    document.getElementById('log-content')!.textContent = 'Error: ' + err;
  }
}

// ── Polling ──────────────────────────────────────────────

let polling = false;
async function startPolling() {
  if (polling) return;
  polling = true;
  while (polling) {
    try {
      if (await invoke<boolean>('get_status')) {
        await updateTraffic();
        await updateUptime();
      }
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
}

// ── DOM Ready ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => showView((el as HTMLElement).dataset.view!));
  });
  document.querySelectorAll('.back-btn').forEach(el => {
    el.addEventListener('click', () => showView((el as HTMLElement).dataset.view!));
  });

  // Connect
  document.getElementById('planet-icon')!.addEventListener('click', toggleConnect);

  // Profile selects
  ['sidebar-profile-select', 'server-profile-select'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => profileChanged(id));
  });
  document.getElementById('settings-profile-select')?.addEventListener('change', () => {
    loadConfig();
  });

  // Settings
  document.getElementById('settings-form')?.addEventListener('submit', saveConfig);
  document.getElementById('btn-new-profile')?.addEventListener('click', newProfile);
  document.getElementById('btn-delete-profile')?.addEventListener('click', deleteProfile);
  document.getElementById('btn-settings-quick')?.addEventListener('click', () => showView('settings'));
  document.getElementById('btn-refresh-log')?.addEventListener('click', refreshLog);

  // Split tunnel save
  document.getElementById('btn-split-save')?.addEventListener('click', async () => {
    const ta = document.getElementById('split_rules_view') as HTMLTextAreaElement;
    if (!ta) return;
    try {
      const config = await invoke<Config>('get_config');
      config.split_rules = ta.value.split('\\n').map(s => s.trim()).filter(s => s.length > 0).map(s => ({ pattern: s }));
      await invoke('save_config', { config });
      showMsg('split-msg', 'Split rules saved!', 'success');
    } catch (err) {
      showMsg('split-msg', 'Failed: ' + err, 'error');
    }
  });

  // Init
  updateServerInfo();
  loadProfiles();
  updateStatus();
  setInterval(updateStatus, 2000);
  startPolling();
});
