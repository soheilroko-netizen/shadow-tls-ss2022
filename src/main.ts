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
  auto_connect: boolean;
  split_mode: string;
  split_processes: string[];
  split_domains: string[];
}

interface TrafficData {
  up: number;
  down: number;
}

let connected = false;
let connectStart = 0;
let timerInterval: number | null = null;
let trafficInterval: number | null = null;
let pingInterval: number | null = null;
let pingHistory: number[] = [];
const MAX_PING_POINTS = 30;
let logBuffer: string[] = [];

const $ = (id: string) => document.getElementById(id)!;

// ── View switching ────────────────────────────────────────────
function showView(viewName: string) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const view = document.getElementById('view-' + viewName);
  if (view) view.classList.add('active');
  const navItem = document.getElementById('nav-' + viewName);
  if (navItem) navItem.classList.add('active');
}

// ── Window controls ───────────────────────────────────────────
function setupWindowControls() {
  const win = getCurrentWindow();
  $('win-min')?.addEventListener('click', () => win.minimize());
  $('win-max')?.addEventListener('click', () => win.toggleMaximize());
  $('win-close')?.addEventListener('click', () => win.close());
}

// ── Navigation ────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    const view = el.getAttribute('data-view');
    if (view) showView(view);
  });
});

document.querySelectorAll('.back-btn').forEach(el => {
  el.addEventListener('click', () => showView('dashboard'));
});

// ── Profile Selector (top-left card) ──────────────────────────
$('profile-selector')?.addEventListener('click', () => {
  const dropdown = $('profile-dropdown');
  dropdown.classList.toggle('show');
});

$('profile-dropdown')?.addEventListener('click', (e) => {
  const item = (e.target as HTMLElement).closest('.dropdown-item');
  if (!item) return;
  const name = item.getAttribute('data-profile') || '';
  $('active-profile-name').textContent = name;
  $('profile-dropdown').classList.remove('show');
  addLog('Switched profile: ' + name);
});

// Close dropdown on click outside
document.addEventListener('click', (e) => {
  const sel = $('profile-selector');
  const dd = $('profile-dropdown');
  if (sel && dd && !sel.contains(e.target as Node) && !dd.contains(e.target as Node)) {
    dd.classList.remove('show');
  }
});

// ── Connect / Disconnect ──────────────────────────────────────
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
  const main = document.querySelector('#main')!;
  main.classList.toggle('connected', connected);
  $('status-text').textContent = connected ? 'CONNECTED' : 'Disconnected';
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
  $('timer').textContent = time;
  $('stat-time').textContent = time;
}

// ── Traffic polling (1s) ──────────────────────────────────────
async function startTrafficPolling() {
  await pollTraffic();
  if (trafficInterval) clearInterval(trafficInterval);
  trafficInterval = window.setInterval(pollTraffic, 1000);
}

async function pollTraffic() {
  if (!connected) return;
  try {
    const data = await invoke<TrafficData>('get_total_traffic');
    const upFmt = formatBytes(data.up);
    const downFmt = formatBytes(data.down);
    $('stat-traffic').textContent = `↑ ${upFmt} · ↓ ${downFmt}`;
  } catch { /* ignore */ }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

// ── Ping polling (1s, requested) ──────────────────────────────
async function startPingPolling() {
  await pollPing();
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = window.setInterval(pollPing, 1000);
}

async function pollPing() {
  if (!connected) return;
  try {
    const ping = await invoke<number>('get_ping');
    pingHistory.push(ping);
    if (pingHistory.length > MAX_PING_POINTS) pingHistory.shift();
    // Show latest ping, not average
    const latest = pingHistory[pingHistory.length - 1];
    $('ping-value').textContent = Math.round(latest) + ' ms';
    drawPingGraph();
  } catch { /* ignore */ }
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
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';

  pingHistory.forEach((val, i) => {
    const x = (i / (MAX_PING_POINTS - 1)) * w;
    const y = h - (val / max) * (h - 4) - 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(34, 211, 238, 0.15)');
  grad.addColorStop(1, 'rgba(34, 211, 238, 0)');
  ctx.fillStyle = grad;
  ctx.fill();
}

// ── Log ───────────────────────────────────────────────────────
function addLog(msg: string) {
  const ts = new Date().toLocaleTimeString();
  logBuffer.push(`[${ts}] ${msg}`);
  renderLog();
}

function renderLog() {
  const container = $('log-container');
  if (!container) return;
  if (logBuffer.length === 0) {
    container.innerHTML = '<div class="log-placeholder">No events yet.</div>';
    return;
  }
  container.innerHTML = logBuffer.map(l => `<div class="log-entry">${escapeHtml(l)}</div>`).join('');
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

$('btn-clear-log')?.addEventListener('click', () => {
  logBuffer = [];
  renderLog();
});

// ── Load config ───────────────────────────────────────────────
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
      if (config.auto_connect !== undefined) ($('auto-connect') as HTMLSelectElement).value = String(config.auto_connect);
      $('server-location').textContent = config.server_address || '—';
      $('stat-server').textContent = config.server_address || '—';
    }
  } catch { /* config not available */ }
}

// ── Save Profile ──────────────────────────────────────────────
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
    auto_connect: ($('auto-connect') as HTMLSelectElement).value === 'true',
    split_mode: 'exclude',
    split_processes: [],
    split_domains: [],
  };
  try {
    await invoke('save_config', { config });
    addLog('Profile saved');
  } catch (e: any) {
    addLog('Save failed: ' + String(e));
  }
});

// ── Save App Settings ─────────────────────────────────────────
$('btn-save-app')?.addEventListener('click', async () => {
  try {
    await invoke('save_app_settings', {
      language: ($('language') as HTMLSelectElement).value,
      autoStart: ($('auto-start') as HTMLSelectElement).value === 'true',
      minimizeTray: ($('minimize-tray') as HTMLSelectElement).value === 'true',
      notifyConnect: ($('notif-connect') as HTMLSelectElement).value === 'true',
      pingInterval: parseInt(($('ping-interval') as HTMLInputElement).value) || 1,
    });
    addLog('App settings saved');
  } catch (e: any) {
    addLog('Save failed: ' + String(e));
  }
});

// ── Save Split Tunnel ─────────────────────────────────────────
$('btn-save-split')?.addEventListener('click', async () => {
  const processes = ($('split-processes') as HTMLTextAreaElement).value
    .split('\n').map(s => s.trim()).filter(s => s.length > 0);
  const domains = ($('split-domains') as HTMLTextAreaElement).value
    .split('\n').map(s => s.trim()).filter(s => s.length > 0);
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

// ── Init ───────────────────────────────────────────────────────
setupWindowControls();
loadConfig();
addLog('Application started');
