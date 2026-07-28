import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

// ── Types ─────────────────────────────────────────────────────
interface Profile {
  name: string;
  server_address: string;
  tun_name: string;
  mtu: number | null;
  auto_connect: boolean;
}

interface Config {
  server_address: string;
  tun_name: string;
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

// ── State ──────────────────────────────────────────────────────
let connected = false;
let connectStart = 0;
let timerInterval: number | null = null;
let trafficInterval: number | null = null;
let pingInterval: number | null = null;
let pingHistory: number[] = [];
const MAX_PING_POINTS = 30;
let logBuffer: string[] = [];

// ── DOM refs ───────────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id)!;

// ── View switching ─────────────────────────────────────────────
function showView(viewName: string) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const view = document.getElementById('view-' + viewName);
  if (view) view.classList.add('active');
  const navItem = document.getElementById('nav-' + viewName);
  if (navItem) navItem.classList.add('active');
}

// ── Window controls ────────────────────────────────────────────
function setupWindowControls() {
  const win = getCurrentWindow();
  $('win-min')?.addEventListener('click', () => win.minimize());
  $('win-max')?.addEventListener('click', () => win.toggleMaximize());
  $('win-close')?.addEventListener('click', () => win.close());
}

// ── Navigation ─────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    const view = el.getAttribute('data-view');
    if (view) showView(view);
  });
});

document.querySelectorAll('.back-btn').forEach(el => {
  el.addEventListener('click', () => showView('dashboard'));
});

// ── Server select ──────────────────────────────────────────────
$('server-select')?.addEventListener('click', async () => {
  try {
    const serversStr = await invoke<string>('get_servers');
    const servers: string[] = JSON.parse(serversStr);
    // Simple cycle through servers for now
    const current = $('server-name').textContent;
    const idx = servers.indexOf(current || '');
    const next = idx >= 0 && idx < servers.length - 1 ? servers[idx + 1] : servers[0];
    if (next) {
      $('server-name').textContent = next;
      await invoke('set_server', { server: next });
    }
  } catch { /* no server list available */ }
});

// ── Profile card ───────────────────────────────────────────────
$('sidebar-profile')?.addEventListener('click', () => showView('profile-settings'));

// ── Settings quick button ──────────────────────────────────────
$('btn-settings-quick')?.addEventListener('click', () => showView('app-settings'));

// ── Connect / Disconnect ───────────────────────────────────────
$('btn-connect')?.addEventListener('click', async () => {
  if (!connected) {
    try {
      await invoke('connect');
      connected = true;
      updateConnectionUI();
      startTimers();
      addLog('Connected to server');
    } catch (e: any) {
      addLog('Connection failed: ' + String(e));
    }
  } else {
    try {
      await invoke('disconnect');
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
  $('status-dot').style.background = connected ? 'var(--green)' : 'var(--text-dim)';
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

// ── Traffic polling ────────────────────────────────────────────
async function startTrafficPolling() {
  await pollTraffic();
  if (trafficInterval) clearInterval(trafficInterval);
  trafficInterval = window.setInterval(pollTraffic, 3000);
}

async function pollTraffic() {
  if (!connected) return;
  try {
    const data = await invoke<TrafficData>('get_total_traffic');
    const upFmt = formatBytes(data.up);
    const downFmt = formatBytes(data.down);
    $('stat-traffic').textContent = `↑ ${upFmt} · ↓ ${downFmt}`;
  } catch { /* ignore polling errors */ }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

// ── Ping polling ───────────────────────────────────────────────
async function startPingPolling() {
  await pollPing();
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = window.setInterval(pollPing, 5000);
}

async function pollPing() {
  if (!connected) return;
  try {
    const ping = await invoke<number>('get_ping');
    pingHistory.push(ping);
    if (pingHistory.length > MAX_PING_POINTS) pingHistory.shift();
    const avg = pingHistory.reduce((a, b) => a + b, 0) / pingHistory.length;
    $('ping-value').textContent = Math.round(avg) + ' ms';
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

  // Fill below line
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(34, 211, 238, 0.2)');
  grad.addColorStop(1, 'rgba(34, 211, 238, 0)');
  ctx.fillStyle = grad;
  ctx.fill();
}

// ── Log ────────────────────────────────────────────────────────
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

// ── Load config on startup ─────────────────────────────────────
async function loadConfig() {
  try {
    const config = await invoke<Config>('get_config');
    if (config) {
      if (config.server_address) $('server-address').value = config.server_address;
      if (config.tun_name) $('tun-name').value = config.tun_name;
      if (config.mtu) ($('mtu') as HTMLInputElement).value = String(config.mtu);
      if (config.auto_connect !== undefined) ($('auto-connect') as HTMLSelectElement).value = String(config.auto_connect);
      if (config.split_mode) ($('split-mode') as HTMLSelectElement).value = config.split_mode;
      if (config.split_processes) ($('split-processes') as HTMLTextAreaElement).value = config.split_processes.join('\n');
      if (config.split_domains) ($('split-domains') as HTMLTextAreaElement).value = config.split_domains.join('\n');
      // Show server in top bar
      const addr = config.server_address || '';
      const parts = addr.split(':');
      $('server-name').textContent = parts.length > 1 ? `Server :${parts[1]}` : addr || 'Germany - Frankfurt';
      $('server-location').textContent = config.server_address || '\u2014';
      $('stat-server').textContent = config.server_address || '\u2014';
    }
  } catch { /* config not available */ }
}

// ── Save Profile ───────────────────────────────────────────────
$('btn-save-profile')?.addEventListener('click', async () => {
  const profile: Config = {
    server_address: ($('server-address') as HTMLInputElement).value || '127.0.0.1:9092',
    tun_name: ($('tun-name') as HTMLInputElement).value || 'stls-tun',
    mtu: parseInt(($('mtu') as HTMLInputElement).value) || null,
    auto_connect: ($('auto-connect') as HTMLSelectElement).value === 'true',
    split_mode: 'exclude',
    split_processes: [],
    split_domains: [],
  };
  try {
    await invoke('save_config', { config: profile });
    addLog('Profile saved');
  } catch (e: any) {
    addLog('Save failed: ' + String(e));
  }
});

// ── Save App Settings ──────────────────────────────────────────
$('btn-save-app')?.addEventListener('click', async () => {
  try {
    await invoke('save_app_settings', {
      language: ($('language') as HTMLSelectElement).value,
      autoStart: ($('auto-start') as HTMLSelectElement).value === 'true',
      minimizeTray: ($('minimize-tray') as HTMLSelectElement).value === 'true',
      notifyConnect: ($('notif-connect') as HTMLSelectElement).value === 'true',
      pingInterval: parseInt(($('ping-interval') as HTMLInputElement).value) || 5,
    });
    addLog('App settings saved');
  } catch (e: any) {
    addLog('Save failed: ' + String(e));
  }
});

// ── Save Split Tunnel ──────────────────────────────────────────
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
