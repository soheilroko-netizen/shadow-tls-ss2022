import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

let connected = false;
let connectStart = 0;
let timerInterval: number | null = null;
let trafficInterval: number | null = null;
let pingInterval: number | null = null;
let pingHistory: number[] = [];
const MAX_PING_POINTS = 100;

const $ = (id: string) => document.getElementById(id)!;

// ── Settings window control ──────────────────────────────────────────
async function openSettings(tab: string = 'profile') {
  try {
    await invoke('open_settings', { tab });
  } catch (e: any) {
    console.error('Failed to open settings:', e);
  }
}

// ── Split tunnel toggle ──────────────────────────────────────────────
async function toggleSplit() {
  try {
    const current = await invoke<boolean>('get_split_enabled');
    await invoke('set_split_enabled', { enabled: !current });
    updateSplitIndicator();
    addLog(`Split tunnel ${!current ? 'enabled' : 'disabled'}`);
  } catch (e: any) {
    addLog('Toggle split failed: ' + String(e));
  }
}

function updateSplitIndicator() {
  invoke<boolean>('get_split_enabled').then(enabled => {
    const el = $('split-indicator');
    if (el) {
      if (enabled) el.classList.add('active');
      else el.classList.remove('active');
    }
  }).catch(() => {});
}

// ── View visibility ───────────────────────────────────────────────
function hideAllSettings() {
  // Close settings window
  const settingsWindow = getCurrentWindow();
  settingsWindow.hide().catch(() => {});
}

$(document).querySelector('.menu-btn')?.addEventListener('click', async () => {
  await openSettings();
});

// ── Profile Selector ───────────────────────────────────────────────
$('profile-selector')?.addEventListener('click', () => {
  const dropdown = $('profile-dropdown');
  dropdown.classList.toggle('show');
});

document.addEventListener('click', (e) => {
  const sel = $('profile-selector');
  const dd = $('profile-dropdown');
  if (sel && dd && !sel.contains(e.target as Node) && !dd.contains(e.target as Node)) {
    dd.classList.remove('show');
  }
});

async function loadProfilesDropdown() {
  try {
    const store = await invoke<ProfileStoreData>('get_profiles');
    const dd = $('profile-dropdown');
    if (!dd) return;
    dd.innerHTML = store.profiles.map(p =>
      `<div class="dropdown-item" data-profile="${p.name}">${p.name}</div>`
    ).join('');
    $('active-profile-name').textContent = store.active_profile;
    dd.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', async () => {
        const name = item.getAttribute('data-profile') || '';
        try {
          await invoke('switch_profile', { name });
          $('active-profile-name').textContent = name;
          dd.classList.remove('show');
          addLog('Switched to: ' + name);
          loadConfig();
          loadProfilesDropdown();
        } catch (e: any) {
          addLog('Switch failed: ' + String(e));
        }
      });
    });
    // Initialize split indicator state
    updateSplitIndicator();
  } catch { /* ignore */ }
}

interface ProfileStoreData {
  profiles: { name: string; config: Config }[];
  active_profile: string;
}
interface Config {
  server_address: string;
  ss_port: number;
  ss_password: string;
  stls_port: number;
  stls_password: string;
  stls_sni: string;
  socks5_port: number;
  mtu: number | null;
  encryption_method: string;
  split_mode: string;
  split_processes: string[];
  split_domains: string[];
}

// ─── Connect / Disconnect ─────────────────────────────────────────
$('btn-connect')?.addEventListener('click', async () => {
  if (!connected) {
    try {
      await invoke('start_proxy');
      connected = true;
      updateConnectionUI();
      startTimers();
      addLog('Connected');
    } catch (e: any) {
      addLog('Connection failed: ' + String(e));
    }
  } else {
    try {
      await invoke('stop_proxy');
      connected = false;
      updateConnectionUI();
      stopTimers();
      addLog('Disconnected');
    } catch (e: any) {
      addLog('Disconnect failed: ' + String(e));
    }
  }
});

function updateConnectionUI() {
  const ring = $('power-ring');
  const status = $('status-text');
  const dot = $('status-dot');
  if (ring) ring.classList.toggle('active', connected);
  if (status) status.textContent = connected ? 'CONNECTED' : 'Disconnected';
}

// ─── Timers ────────────────────────────────────────────────────────
function startTimers() {
  connectStart = Date.now();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = window.setInterval(updateTimer, 1000);
  updateTimer();
  startTrafficPolling();
  startPingPolling();
}

function stopTimers() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (trafficInterval) { clearInterval(trafficInterval); trafficInterval = null; }
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  $('stat-time').textContent = '00:00:00';
  $('timer').textContent = '00:00:00';
  pingHistory = [];
  drawPingGraph();
}

function updateTimer() {
  if (!connectStart) return;
  const elapsed = Math.floor((Date.now() - connectStart) / 1000);
  const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  const time = `${h}:${m}:${s}`;
  $('stat-time').textContent = time;
  $('timer').textContent = time;
}

// ─── Traffic polling ───────────────────────────────────────────────
async function startTrafficPolling() {
  const start = Date.now();
  await pollTraffic();
  if (trafficInterval) clearInterval(trafficInterval);
  trafficInterval = window.setInterval(pollTraffic, 1000);
  console.log(`[dakal-tls] traffic poll interval active (started in ${Date.now() - start}ms)`);
}

async function pollTraffic() {
  if (!connected) return;
  try {
    const raw = await invoke<string>('get_total_traffic');
    const data = JSON.parse(raw) as { up: number; down: number };
    const upFmt = formatBytes(data.up);
    const downFmt = formatBytes(data.down);
    $('stat-traffic').textContent = `↻ ${upFmt} · ${downFmt}`;
  } catch (e) {
    // Ignore traffic errors
    const el = $('stat-traffic');
    if (el && !el.textContent.includes('—')) {
      el.textContent = '↻ Reconnecting...';
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

// ─── Ping polling ───────────────────────────────────────────────────
async function startPingPolling() {
  const start = Date.now();
  await pollPing();
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = window.setInterval(pollPing, 1000);
  console.log(`[dakal-tls] ping poll interval active (started in ${Date.now() - start}ms)`);
}

async function pollPing() {
  if (!connected) {
    $('ping-value').textContent = '— ms';
    return;
  }
  try {
    const ping = await invoke<number>('get_ping');
    pingHistory.push(ping);
    if (pingHistory.length > MAX_PING_POINTS) pingHistory.shift();
    const latest = pingHistory[pingHistory.length - 1];
    $('ping-value').textContent = Math.round(latest) + ' ms';
    drawPingGraph();
  } catch (e: any) {
    $('ping-value').textContent = '— ms';
  }
}

function drawPingGraph() {
  const canvas = $('ping-graph') as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (pingHistory.length < 2) return;

  const max = Math.max(...pingHistory, 1);
  ctx.beginPath();
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';

  pingHistory.forEach((val, i) => {
    const x = (i / (MAX_PING_POINTS - 1)) * w;
    const y = h - (val / max) * (h - 4) - 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// �─ Log ───────────────────────────────────────────────────────────
function addLog(msg: string) {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${msg}`);
}

// ─── Load & Save Config ────────────────────────────────────────────
async function loadConfig() {
  try {
    const config = await invoke<Config>('get_config');
    if (config) {
      if (config.server_address) $('server-address').value = config.server_address;
      ($('ss-port') as HTMLInputElement).value = String(config.ss_port || 8380);
      if (config.ss_password) ($('ss-password') as HTMLInputElement).value = config.ss_password;
      ($('stls-port') as HTMLInputElement).value = String(config.stls_port || 8553);
      if (config.stls_password) ($('stls-password') as HTMLInputElement).value = config.stls_password;
      if (config.stls_sni) $('stls-sni').value = config.stls_sni;
      ($('socks5-port') as HTMLInputElement).value = String(config.socks5_port || 1080);
      if (config.mtu) ($('mtu') as HTMLInputElement).value = String(config.mtu);
      if (config.encryption_method) ($('encryption-method') as HTMLSelectElement).value = config.encryption_method;
      $('server-location').textContent = config.server_address || '—';
    }
  } catch { /* ignore */ }
}

$('btn-save-profile')?.addEventListener('click', async () => {
  const config: Config = {
    server_address: ($('server-address') as HTMLInputElement).value || 'ns.baft.uk',
    ss_port: parseInt(($('ss-port') as HTMLInputElement).value) || 8380,
    ss_password: ($('ss-password') as HTMLInputElement).value || '',
    stls_port: parseInt(($('stls-port') as HTMLInputElement).value) || 8553,
    stls_password: ($('stls-password') as HTMLInputElement).value || '',
    stls_sni: ($('stls-sni') as HTMLInputElement).value || 'dl.google.com',
    socks5_port: parseInt(($('socks5-port') as HTMLInputElement).value) || 1080,
    mtu: parseInt(($('mtu') as HTMLInputElement).value) || null,
    encryption_method: ($('encryption-method') as HTMLSelectElement).value || 'chacha20-ietf-poly1305',
    split_mode: 'exclude',
    split_processes: [],
    split_domains: [],
  };
  try {
    await invoke('save_config', { config });
    addLog('Profile saved');
    loadProfilesDropdown();
  } catch (e: any) {
    addLog('Save failed: ' + String(e));
  }
});

// Add / Delete Profile
$('btn-add-profile')?.addEventListener('click', async () => {
  const nameInput = $('profile-name-input') as HTMLInputElement;
  const name = nameInput.value.trim();
  if (!name) { addLog('Enter a profile name first'); return; }
  try {
    await invoke('add_profile', { name, config });
    addLog('Profile created: ' + name);
    loadProfilesDropdown();
  } catch (e: any) {
    addLog('Create failed: ' + String(e));
  }
});

$('btn-delete-profile')?.addEventListener('click', async () => {
  const name = ($('profile-name-input') as HTMLInputElement).value.trim();
  if (!name) { addLog('No profile name to delete'); return; }
  try {
    await invoke('delete_profile', { name });
    addLog('Deleted: ' + name);
    loadProfilesDropdown();
  } catch (e: any) {
    addLog('Delete failed: ' + String(e));
  }
});

async function loadProfilesList() {
  try {
    const store = await invoke<ProfileStoreData>('get_profiles');
    $('profile-name-input').value = store.active_profile;
  } catch { /* ignore */ }
}

// Save App Settings
$('btn-save-app')?.addEventListener('click', async () => {
  try {
    await invoke('save_app_settings', {
      language: ($('language') as HTMLSelectElement).value,
      auto_start: ($('auto-start') as HTMLSelectElement).value === 'true',
      minimize_tray: ($('minimize-tray') as HTMLSelectElement).value === 'true',
      notify_connect: ($('notif-connect') as HTMLSelectElement).value === 'true',
      ping_interval: parseInt(($('ping-interval') as HTMLInputElement).value) || 1,
    });
    addLog('App settings saved');
  } catch (e: any) {
    addLog('Save failed: ' + String(e));
  }
});

// Save Split Tunnel
$('btn-save-split')?.addEventListener('click', async () => {
  const processes = ($('split-processes') as HTMLTextAreaElement).value
    .split('\\n').map(s => s.trim()).filter(s => s.length > 0);
  const domains = ($('split-domains') as HTMLTextAreaElement).value
    .split('\\n').map(s => s.trim()).filter(s => s.length > 0);
  try {
    await invoke('save_split_rules', {
      mode: ($('split-mode') as HTMLSelectElement).value,
      processes,
      domains,
    });
    addLog('Split rules saved');
  } catch (e: any) {
    addLog('Save failed: ' + String(e));
  }
});

// Fix for select color contrast
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('select').forEach(sel => {
    sel.style.color = '#fff';
  });
});

// Initialize
loadConfig();
loadProfilesDropdown();
addLog('Application started');