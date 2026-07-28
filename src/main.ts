import { invoke } from '@tauri-apps/api/core';

interface Config {
  server_address: string;
  ss_port: number;
  ss_password: string;
  stls_port: number;
  stls_password: string;
  stls_sni: string;
  socks5_port: number;
  mtu: number | null;
  auto_connect: boolean;
  encryption_method: string;
  split_mode: string;
  split_processes: string[];
  split_domains: string[];
}

interface TrafficData { up: number; down: number; }
interface ProfileData { name: string; config: Config; }
interface ProfileStoreData { profiles: ProfileData[]; active_profile: string; }

let connected = false;
let connectStart = 0;
let timerInterval: number | null = null;
let trafficInterval: number | null = null;
let pingInterval: number | null = null;
let pingHistory: number[] = [];
let lastTraffic: TrafficData | null = null;
let firstCumulative: TrafficData | null = null;
const MAX_PING_POINTS = 40;
let logBuffer: string[] = [];
let switching = false;

const $ = (id: string) => document.getElementById(id)!;

// ── View switching ─────────────────────────────────────────
function showView(viewName: string) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const view = document.getElementById('view-' + viewName);
  if (view) view.classList.add('active');
  const navItem = document.getElementById('nav-' + viewName);
  if (navItem) navItem.classList.add('active');
  if (viewName === 'profile-settings') loadProfilesList();
}

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    const view = el.getAttribute('data-view');
    if (view) showView(view);
  });
});

document.querySelectorAll('.btn-back').forEach(el => {
  el.addEventListener('click', () => showView('dashboard'));
});

// ── Profile Selector ─────────────────────────────────────────
$('profile-selector')?.addEventListener('click', () => {
  $('profile-dropdown').classList.toggle('show');
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
      `<div class="dd-item" data-profile="${p.name}">${p.name}</div>`
    ).join('');
    $('active-profile-name').textContent = store.active_profile;
    $('profile-avatar').textContent = store.active_profile.charAt(0);
    dd.querySelectorAll('.dd-item').forEach(item => {
      item.addEventListener('click', async () => {
        const name = item.getAttribute('data-profile') || '';
        await switchAndConnect(name);
        dd.classList.remove('show');
      });
    });
  } catch { /* ignore */ }
}

async function switchAndConnect(name: string) {
  if (switching) return;
  switching = true;
  try {
    if (connected) {
      await invoke('stop_proxy');
      connected = false;
      updateConnectionUI();
      stopTimers();
    }
    await invoke('switch_profile', { name });
    $('active-profile-name').textContent = name;
    $('profile-avatar').textContent = name.charAt(0);
    addLog('Switched to: ' + name);
    loadConfig();
    loadProfilesList();
    setTimeout(async () => {
      try {
        await invoke('start_proxy');
        connected = true;
        updateConnectionUI();
        startTimers();
        addLog('Auto-connected: ' + name);
      } catch (e: any) {
        addLog('Auto-connect failed: ' + String(e));
      }
      switching = false;
    }, 300);
  } catch (e: any) {
    addLog('Switch failed: ' + String(e));
    switching = false;
  }
}

// ── Connect / Disconnect ─────────────────────────────────────
$('btn-connect')?.addEventListener('click', async () => {
  if (switching) return;
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
  const main = document.querySelector('#main')!;
  main.classList.toggle('connected', connected);
  $('status-text').textContent = connected ? 'CONNECTED' : 'DISCONNECTED';
}

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
  $('info-time').textContent = '00:00:00';
  $('timer').textContent = '00:00:00';
  pingHistory = [];
  lastTraffic = null;
  firstCumulative = null;
  drawPingGraph();
  $('usage-live').textContent = '↑ 0 B · ↓ 0 B';
  $('usage-total').textContent = '↑ 0 B · ↓ 0 B';
}

function updateTimer() {
  if (!connectStart) return;
  const elapsed = Math.floor((Date.now() - connectStart) / 1000);
  const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  $('timer').textContent = `${h}:${m}:${s}`;
  $('info-time').textContent = `${h}:${m}:${s}`;
}

// ── Traffic ──────────────────────────────────────────────────
async function startTrafficPolling() {
  lastTraffic = null;
  firstCumulative = null;
  if (trafficInterval) clearInterval(trafficInterval);
  trafficInterval = window.setInterval(pollTrafficAll, 2000);
  await pollTrafficAll();
}

async function pollTrafficAll() {
  if (!connected) return;
  try {
    const raw = await invoke<string>('get_total_traffic');
    const data = JSON.parse(raw) as TrafficData;

    if (!firstCumulative) firstCumulative = { up: data.up, down: data.down };
    const totalUp = Math.max(0, data.up - firstCumulative.up);
    const totalDown = Math.max(0, data.down - firstCumulative.down);
    $('usage-total').textContent = `↑ ${fmt(totalUp)} · ↓ ${fmt(totalDown)}`;

    if (lastTraffic) {
      const upDelta = Math.max(0, data.up - lastTraffic.up);
      const downDelta = Math.max(0, data.down - lastTraffic.down);
      $('usage-live').textContent = `↑ ${fmt(Math.round(upDelta/2))} · ↓ ${fmt(Math.round(downDelta/2))}`;
    }
    lastTraffic = data;
  } catch { /* ignore */ }
}

function fmt(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b/1048576).toFixed(1) + ' MB';
  return (b/1073741824).toFixed(2) + ' GB';
}

// ── Ping ──────────────────────────────────────────────────────
async function startPingPolling() {
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = window.setInterval(pollPing, 2000);
  await pollPing();
}

async function pollPing() {
  if (!connected) return;
  try {
    const ping = await invoke<number>('get_ping');
    pingHistory.push(ping);
    if (pingHistory.length > MAX_PING_POINTS) pingHistory.shift();
    $('ping-value').textContent = Math.round(ping) + ' ms';
    drawPingGraph();
  } catch { /* keep trying */ }
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
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  pingHistory.forEach((v, i) => {
    const x = (i / (MAX_PING_POINTS - 1)) * w;
    const y = h - (v / max) * (h - 4) - 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(34,211,238,0.08)');
  g.addColorStop(1, 'rgba(34,211,238,0)');
  ctx.fillStyle = g;
  ctx.fill();
}

// ── Log ──────────────────────────────────────────────────────
function addLog(msg: string) {
  const ts = new Date().toLocaleTimeString();
  logBuffer.push(`${ts} ${msg}`);
  renderLog();
}

function renderLog() {
  const c = $('log-container');
  if (!c) return;
  if (logBuffer.length === 0) {
    c.innerHTML = '<div class="log-empty">No events yet.</div>';
    return;
  }
  c.innerHTML = logBuffer.map(l => `<div class="log-entry">${esc(l)}</div>`).join('');
  c.scrollTop = c.scrollHeight;
}

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

$('btn-clear-log')?.addEventListener('click', () => { logBuffer = []; renderLog(); });

// ── Config ───────────────────────────────────────────────────
async function loadConfig() {
  try {
    const config = await invoke<Config>('get_config');
    if (!config) return;
    if (config.server_address) ($('server-address') as HTMLInputElement).value = config.server_address;
    ($('ss-port') as HTMLInputElement).value = String(config.ss_port || 8380);
    if (config.ss_password) ($('ss-password') as HTMLInputElement).value = config.ss_password;
    ($('stls-port') as HTMLInputElement).value = String(config.stls_port || 8553);
    if (config.stls_password) ($('stls-password') as HTMLInputElement).value = config.stls_password;
    if (config.stls_sni) $('stls-sni').value = config.stls_sni;
    ($('socks5-port') as HTMLInputElement).value = String(config.socks5_port || 1080);
    if (config.mtu) ($('mtu') as HTMLInputElement).value = String(config.mtu);
    if (config.auto_connect !== undefined) ($('auto-connect') as HTMLSelectElement).value = String(config.auto_connect);
    if (config.encryption_method) ($('encryption-method') as HTMLSelectElement).value = config.encryption_method;
    $('server-location').textContent = config.server_address || '—';
    $('info-server').textContent = config.server_address || '—';
  } catch { /* ignore */ }
}

$('btn-save-profile')?.addEventListener('click', async () => {
  const cfg: Config = {
    server_address: ($('server-address') as HTMLInputElement).value || 'ns.baft.uk',
    ss_port: parseInt(($('ss-port') as HTMLInputElement).value) || 8380,
    ss_password: ($('ss-password') as HTMLInputElement).value || '',
    stls_port: parseInt(($('stls-port') as HTMLInputElement).value) || 8553,
    stls_password: ($('stls-password') as HTMLInputElement).value || '',
    stls_sni: ($('stls-sni') as HTMLInputElement).value || 'dl.google.com',
    socks5_port: parseInt(($('socks5-port') as HTMLInputElement).value) || 1080,
    mtu: parseInt(($('mtu') as HTMLInputElement).value) || null,
    auto_connect: ($('auto-connect') as HTMLSelectElement).value === 'true',
    encryption_method: ($('encryption-method') as HTMLSelectElement).value || 'chacha20-ietf-poly1305',
    split_mode: 'exclude', split_processes: [], split_domains: [],
  };
  try {
    await invoke('save_config', { config: cfg });
    addLog('Profile saved');
    loadProfilesDropdown();
  } catch (e: any) { addLog('Save failed: ' + String(e)); }
});

$('btn-add-profile')?.addEventListener('click', async () => {
  const name = ($('profile-name-input') as HTMLInputElement).value.trim();
  if (!name) { addLog('Enter a profile name first'); return; }
  const cfg: Config = {
    server_address: ($('server-address') as HTMLInputElement).value || 'ns.baft.uk',
    ss_port: parseInt(($('ss-port') as HTMLInputElement).value) || 8380,
    ss_password: ($('ss-password') as HTMLInputElement).value || '',
    stls_port: parseInt(($('stls-port') as HTMLInputElement).value) || 8553,
    stls_password: ($('stls-password') as HTMLInputElement).value || '',
    stls_sni: ($('stls-sni') as HTMLInputElement).value || 'dl.google.com',
    socks5_port: parseInt(($('socks5-port') as HTMLInputElement).value) || 1080,
    mtu: parseInt(($('mtu') as HTMLInputElement).value) || null,
    auto_connect: ($('auto-connect') as HTMLSelectElement).value === 'true',
    encryption_method: ($('encryption-method') as HTMLSelectElement).value || 'chacha20-ietf-poly1305',
    split_mode: 'exclude', split_processes: [], split_domains: [],
  };
  try {
    await invoke('add_profile', { name, config: cfg });
    addLog('Profile created: ' + name);
    loadProfilesDropdown();
    loadProfilesList();
  } catch (e: any) { addLog('Create failed: ' + String(e)); }
});

$('btn-delete-profile')?.addEventListener('click', async () => {
  const name = ($('profile-name-input') as HTMLInputElement).value.trim();
  if (!name) { addLog('No profile name to delete'); return; }
  try {
    await invoke('delete_profile', { name });
    addLog('Deleted: ' + name);
    loadProfilesDropdown();
    loadProfilesList();
  } catch (e: any) { addLog('Delete failed: ' + String(e)); }
});

async function loadProfilesList() {
  try {
    const store = await invoke<ProfileStoreData>('get_profiles');
    ($('profile-name-input') as HTMLInputElement).value = store.active_profile;
  } catch { /* ignore */ }
}

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
  } catch (e: any) { addLog('Save failed: ' + String(e)); }
});

$('btn-save-split')?.addEventListener('click', async () => {
  const processes = ($('split-processes') as HTMLTextAreaElement).value
    .split('\n').map(s => s.trim()).filter(s => s.length > 0);
  const domains = ($('split-domains') as HTMLTextAreaElement).value
    .split('\n').map(s => s.trim()).filter(s => s.length > 0);
  try {
    await invoke('save_split_rules', { mode: ($('split-mode') as HTMLSelectElement).value, processes, domains });
    addLog('Split rules saved');
  } catch (e: any) { addLog('Save failed: ' + String(e)); }
});

// ── Init ─────────────────────────────────────────────────────
loadConfig();
loadProfilesDropdown();
addLog('Application started');
