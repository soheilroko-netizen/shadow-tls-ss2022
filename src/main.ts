import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './styles.css';

// ── Types ────────────────────────────────────────────────────
interface FullStatus {
  running: boolean;
  profile: string;
  server: string | null;
  uptime_secs: number;
  pid: number | null;
  traffic_up: number;
  traffic_down: number;
  total_up: number;
  total_down: number;
  log_lines: string[];
}

// ── Elements ─────────────────────────────────────────────────
const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const statusAddress = document.getElementById('status-address')!;
const pingValue = document.getElementById('ping-value')!;
const uptimeValue = document.getElementById('uptime-value')!;
const trafficValue = document.getElementById('traffic-value')!;
const totalTrafficValue = document.getElementById('total-traffic-value')!;
const message = document.getElementById('message')!;
const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const btnSettings = document.getElementById('btn-main-settings')!;
const btnLog = document.getElementById('btn-main-log')!;
const mainProfileSelect = document.getElementById('main-profile-select') as HTMLSelectElement;
const logContent = document.getElementById('log-content')!;
const btnRefreshLog = document.getElementById('btn-refresh-log')!;
const btnBackFromLog = document.getElementById('btn-back-from-log')!;
const mainView = document.getElementById('main-view')!;
const logView = document.getElementById('log-view')!;

// ── Helpers ──────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

function formatUptime(secs: number): string {
  if (!secs || secs < 1) return '-';
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

function showMessage(msg: string, isError = false) {
  message.textContent = msg;
  message.className = `message ${isError ? 'error' : 'success'}`;
}

function clearMessage() {
  message.textContent = '';
  message.className = 'message';
}

function showView(view: 'main' | 'log') {
  mainView.style.display = view === 'main' ? 'block' : 'none';
  logView.style.display = view === 'log' ? 'block' : 'none';
  if (view === 'log') refreshLog();
}

// ── Uptime local tracking (fixes jump race) ──────────────────
let localUptime = 0;
let uptimeTimer: ReturnType<typeof setInterval> | null = null;
let lastServerUptime = 0;

function startUptimeTimer(baseSecs: number) {
  stopUptimeTimer();
  localUptime = baseSecs;
  uptimeValue.textContent = formatUptime(localUptime);
  uptimeTimer = setInterval(() => {
    localUptime++;
    uptimeValue.textContent = formatUptime(localUptime);
  }, 1000);
}

function stopUptimeTimer() {
  if (uptimeTimer) clearInterval(uptimeTimer);
  uptimeTimer = null;
}

function syncUptime(serverSecs: number) {
  // Only correct if drift > 2s (prevents visual jumps from latency)
  if (Math.abs(serverSecs - localUptime) > 2) {
    localUptime = serverSecs;
    uptimeValue.textContent = formatUptime(localUptime);
  }
  lastServerUptime = serverSecs;
}

// ── Traffic local tracking (smoother display) ────────────────
let lastTraffic = { up: 0, down: 0, totalUp: 0, totalDown: 0, time: Date.now() };

function calcSpeeds(curUp: number, curDown: number, curTotalUp: number, curTotalDown: number) {
  const now = Date.now();
  const elapsed = (now - lastTraffic.time) / 1000;
  if (elapsed < 0.5) {
    // Too soon, keep previous display
    return { upSpeed: 0, downSpeed: 0, showTotal: false };
  }
  const upDelta = curUp - lastTraffic.up;
  const downDelta = curDown - lastTraffic.down;
  lastTraffic = { up: curUp, down: curDown, totalUp: curTotalUp, totalDown: curTotalDown, time: now };
  return {
    upSpeed: upDelta / elapsed,
    downSpeed: downDelta / elapsed,
    showTotal: true,
  };
}

// ── Auto-ping ────────────────────────────────────────────────
let pingTimer: ReturnType<typeof setInterval> | null = null;

async function doPing() {
  try {
    const result = await invoke<string>('real_ping');
    pingValue.textContent = result;
  } catch {
    pingValue.textContent = '-';
  }
}

function startPingLoop() {
  stopPingLoop();
  doPing();
  pingTimer = setInterval(doPing, 2000);
}

function stopPingLoop() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
}

// ── Status update (every 1s) ─────────────────────────────────
let lastPid: number | null = null;

async function updateStatus() {
  try {
    const s = await invoke<FullStatus>('get_full_status');

    // Connection state
    statusText.textContent = s.running ? 'Connected' : 'Disconnected';
    statusDot.classList.toggle('connected', s.running);
    statusAddress.textContent = s.running && s.server ? s.server : '';

    // Uptime - sync with local timer
    if (s.running) {
      syncUptime(s.uptime_secs);
      if (!uptimeTimer) startUptimeTimer(s.uptime_secs);
    } else {
      stopUptimeTimer();
      uptimeValue.textContent = '-';
    }

    // Traffic speeds
    if (s.running) {
      const { upSpeed, downSpeed, showTotal } = calcSpeeds(s.traffic_up, s.traffic_down, s.total_up, s.total_down);
      if (showTotal) {
        trafficValue.textContent = `↑ ${formatSpeed(upSpeed)}  ↓ ${formatSpeed(downSpeed)}`;
        totalTrafficValue.textContent = `↑ ${formatBytes(s.total_up)}  ↓ ${formatBytes(s.total_down)}`;
      }
    } else {
      trafficValue.textContent = '↑ 0 B/s  ↓ 0 B/s';
      totalTrafficValue.textContent = '↑ 0 B  ↓ 0 B';
    }

    // Buttons
    btnStart.disabled = s.running;
    btnStop.disabled = !s.running;

    // Ping loop
    if (s.running && s.pid !== lastPid) {
      startPingLoop();
    } else if (!s.running) {
      stopPingLoop();
    }
    lastPid = s.pid ?? null;

    if (s.running) clearMessage();
  } catch { /* silent */ }
}

// ── Log ──────────────────────────────────────────────────────
async function refreshLog() {
  try {
    const s = await invoke<FullStatus>('get_full_status');
    logContent.textContent = s.log_lines.join('\n') || 'No log available';
    logContent.scrollTop = logContent.scrollHeight;
  } catch {
    logContent.textContent = 'Failed to load log.';
  }
}

// ── Open settings window ─────────────────────────────────────
async function openSettings() {
  try {
    await invoke('open_settings_window');
  } catch (e: any) {
    console.error('Failed to open settings:', e);
    showMessage('Failed to open settings', true);
  }
}

// ── Events ───────────────────────────────────────────────────
listen('proxy-log', (event: { payload: string }) => {
  if (logView.style.display !== 'none') {
    logContent.textContent += `\n${event.payload}`;
    logContent.scrollTop = logContent.scrollHeight;
  }
});

listen('profile-switched', async (event: { payload: string }) => {
  mainProfileSelect.value = event.payload;
  clearMessage();
});

// ── Button handlers ──────────────────────────────────────────
btnStart.addEventListener('click', async () => {
  clearMessage();
  showMessage('Starting...', false);
  try {
    await invoke('start_proxy', { profile: mainProfileSelect.value });
    showMessage('Started');
    lastPid = null;
  } catch (e: any) {
    showMessage(String(e), true);
  }
});

btnStop.addEventListener('click', async () => {
  clearMessage();
  try {
    await invoke('stop_proxy');
    showMessage('Stopped');
    stopPingLoop();
    stopUptimeTimer();
    lastPid = null;
    pingValue.textContent = '-';
    trafficValue.textContent = '↑ 0 B/s  ↓ 0 B/s';
    totalTrafficValue.textContent = '↑ 0 B  ↓ 0 B';
  } catch (e: any) {
    showMessage(String(e), true);
  }
});

btnSettings.addEventListener('click', openSettings);
btnLog.addEventListener('click', () => showView('log'));
btnBackFromLog.addEventListener('click', () => showView('main'));
btnRefreshLog.addEventListener('click', refreshLog);

mainProfileSelect.addEventListener('change', async () => {
  try {
    await invoke('switch_profile', { name: mainProfileSelect.value });
    clearMessage();
  } catch (e) {
    showMessage(`Failed: ${e}`, true);
  }
});

// ── Init ─────────────────────────────────────────────────────
async function loadProfiles() {
  try {
    const store = await invoke<{ profiles: { name: string; is_active: boolean }[]; active_profile: string }>('get_profiles');
    mainProfileSelect.innerHTML = '';
    store.profiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      if (p.name === store.active_profile) opt.selected = true;
      mainProfileSelect.appendChild(opt);
    });
  } catch (e) {
    console.error('Failed to load profiles:', e);
  }
}

(async () => {
  await loadProfiles();
  await updateStatus();
})();

setInterval(updateStatus, 1000);