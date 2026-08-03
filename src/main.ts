// ══════════════════════════════════════════════════════════
// AMAMEBORNE VPN - Main TypeScript
// ══════════════════════════════════════════════════════════

import './styles.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// ── Types ────────────────────────────────────────────────
interface FullStatus {
  running: boolean;
  profile: string;
  server_address: string;
  uptime_secs: number;
  traffic_up: number;
  traffic_down: number;
  ping_ms: number;
  log_lines: string;
}

interface Config {
  server_address: string;
  ss_port: number;
  ss_password: string;
  stls_port: number;
  stls_password: string;
  stls_sni: string;
  socks5_port: number;
  mtu?: number;
  split_mode: string;
  split_rules?: string[];
  h2_preset?: string;
  h2_up_mbps?: number;
  h2_down_mbps?: number;
}

// ── DOM Elements ─────────────────────────────────────────
// Header
const splitIndicator = document.getElementById('split-indicator')!;
const menuToggle = document.getElementById('menu-toggle')!;

// Toggle card
const toggleSwitch = document.getElementById('toggle-switch')!;
const toggleTrack = toggleSwitch.querySelector('.toggle-track')!;
const toggleCard = document.querySelector('.toggle-card')!;
const toggleStatus = document.getElementById('toggle-status')!;
const toggleUptime = document.getElementById('toggle-uptime')!;

// Server bar
const serverText = document.getElementById('server-text')!;
const protocolTabs = document.querySelectorAll('.protocol-tab');

// Flag buttons
const flagButtons = document.querySelectorAll('.flag-btn');

// H2 preset
const h2PresetSection = document.getElementById('h2-preset')!;
const h2PresetSelect = document.getElementById('h2-preset-select') as HTMLSelectElement;
const speedUpBadge = document.getElementById('speed-up')!;
const speedDownBadge = document.getElementById('speed-down')!;

// Metrics
const metricUp = document.getElementById('metric-up')!;
const metricDown = document.getElementById('metric-down')!;
const metricPing = document.getElementById('metric-ping')!;
const graphUp = document.getElementById('graph-up') as HTMLCanvasElement;
const graphDown = document.getElementById('graph-down') as HTMLCanvasElement;

// Footer
const btnSettings = document.getElementById('btn-settings')!;
const btnLogs = document.getElementById('btn-logs')!;

// DNS
const btnDnsGermany = document.getElementById('btn-dns-germany')!;
const btnDnsFinland = document.getElementById('btn-dns-finland')!;
const btnDnsReset = document.getElementById('btn-dns-reset')!;
const dnsStatus = document.getElementById('dns-status')!;

// Panels
const settingsPanel = document.getElementById('settings-panel')!;
const logsPanel = document.getElementById('logs-panel')!;
const panelCloses = document.querySelectorAll('.panel-close');

// Settings
const settingSplitMode = document.getElementById('setting-split-mode') as HTMLSelectElement;
const settingSplitRules = document.getElementById('setting-split-rules') as HTMLTextAreaElement;
const settingMtu = document.getElementById('setting-mtu') as HTMLInputElement;
const customRulesGroup = document.getElementById('custom-rules-group')!;
const btnSaveSettings = document.getElementById('btn-save-settings')!;
const btnUpdateGeofiles = document.getElementById('btn-update-geofiles')!;

// Logs
const logContent = document.getElementById('log-content')!;
const btnRefreshLogs = document.getElementById('btn-refresh-logs')!;

// Toast
const messageToast = document.getElementById('message-toast')!;

// ── State ────────────────────────────────────────────────
let currentServer = 'germany-1';
let currentProtocol: 'h2' | 'stls' = 'h2';
let isConnected = false;
let uptimeStartSecs = 0;
let uptimeInterval: ReturnType<typeof setInterval> | null = null;

// Sparkline data
const SPARKLINE_POINTS = 30;
const upHistory: number[] = [];
const downHistory: number[] = [];

for (let i = 0; i < SPARKLINE_POINTS; i++) {
  upHistory.push(0);
  downHistory.push(0);
}

// ── Helper Functions ─────────────────────────────────────
function getProfileName(): string {
  return `${currentServer}-${currentProtocol}`;
}

function showMessage(msg: string) {
  messageToast.textContent = msg;
  messageToast.classList.add('show');
  setTimeout(() => messageToast.classList.remove('show'), 3000);
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
}

function formatUptime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function drawSparkline(canvas: HTMLCanvasElement, data: number[], color: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const max = Math.max(...data, 1);

  ctx.clearRect(0, 0, width, height);
  
  // Draw gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'transparent');
  
  ctx.beginPath();
  ctx.moveTo(0, height);
  
  data.forEach((value, i) => {
    const x = (i / (SPARKLINE_POINTS - 1)) * width;
    const y = height - (value / max) * height;
    ctx.lineTo(x, y);
  });
  
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.globalAlpha = 0.3;
  ctx.fill();
  
  // Draw line
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  
  data.forEach((value, i) => {
    const x = (i / (SPARKLINE_POINTS - 1)) * width;
    const y = height - (value / max) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  
  ctx.stroke();
}

function updateSparklines(upSpeed: number, downSpeed: number) {
  upHistory.shift();
  upHistory.push(upSpeed);
  downHistory.shift();
  downHistory.push(downSpeed);

  drawSparkline(graphUp, upHistory, '#10b981');
  drawSparkline(graphDown, downHistory, '#60a5fa');
}

function updateProtocolTabs(protocol: 'h2' | 'stls') {
  protocolTabs.forEach(tab => {
    const tabProtocol = (tab as HTMLElement).dataset.protocol;
    tab.classList.toggle('active', tabProtocol === protocol);
  });
}

function updateServerButtons(server: string) {
  flagButtons.forEach(btn => {
    const btnServer = (btn as HTMLElement).dataset.server;
    btn.classList.toggle('active', btnServer === server);
  });
}

function updateH2PresetVisibility(protocol: 'h2' | 'stls') {
  h2PresetSection.style.display = protocol === 'h2' ? 'flex' : 'none';
}

function updateSplitIndicator(splitMode: string) {
  const isSplit = splitMode === 'iran' || splitMode === 'custom';
  splitIndicator.classList.toggle('active', isSplit);
  
  const tooltips: Record<string, string> = {
    full: 'Full tunnel',
    iran: 'Iran Direct (split)',
    custom: 'Custom rules (split)',
  };
  splitIndicator.setAttribute('title', tooltips[splitMode] || 'Unknown');
}

function getServerDisplay(profile: string): string {
  if (profile.startsWith('germany')) return 'de.dakalvpn.eu';
  if (profile.startsWith('finland')) return 'ns.baft.uk';
  return '--';
}

// ── Status Polling ───────────────────────────────────────
async function pollStatus() {
  try {
    const s = await invoke<FullStatus>('get_full_status');

    isConnected = s.running;
    toggleTrack.classList.toggle('on', s.running);
    toggleCard.classList.toggle('connected', s.running);
    toggleStatus.textContent = s.running ? 'Connected' : 'Disconnected';

    if (s.running) {
      if (!uptimeInterval) {
        uptimeStartSecs = s.uptime_secs;
        uptimeInterval = setInterval(() => {
          uptimeStartSecs++;
          toggleUptime.textContent = formatUptime(uptimeStartSecs);
        }, 1000);
      }

      metricUp.textContent = formatSpeed(s.traffic_up);
      metricDown.textContent = formatSpeed(s.traffic_down);
      metricPing.textContent = s.ping_ms > 0 ? `${s.ping_ms} ms` : '-- ms';

      updateSparklines(s.traffic_up, s.traffic_down);
    } else {
      if (uptimeInterval) {
        clearInterval(uptimeInterval);
        uptimeInterval = null;
      }
      toggleUptime.textContent = '--:--';
      metricUp.textContent = '0 B/s';
      metricDown.textContent = '0 B/s';
      metricPing.textContent = '-- ms';
    }

    serverText.textContent = getServerDisplay(s.profile);
  } catch (err) {
    console.error('Poll failed:', err);
  }
}

setInterval(pollStatus, 2000);

// ── Profile Management ───────────────────────────────────
async function loadProfile() {
  try {
    const profile = await invoke<string>('get_profile');
    
    if (profile.startsWith('germany')) currentServer = 'germany-1';
    else if (profile.startsWith('finland')) currentServer = 'finland-1';
    
    currentProtocol = profile.endsWith('-h2') ? 'h2' : 'stls';
    
    updateProtocolTabs(currentProtocol);
    updateServerButtons(currentServer);
    updateH2PresetVisibility(currentProtocol);
  } catch (err) {
    console.error('Load profile failed:', err);
  }
}

async function switchProfile(newServer: string, newProtocol: 'h2' | 'stls') {
  try {
    const newProfile = `${newServer}-${newProtocol}`;
    await invoke('set_profile', { profile: newProfile });
    
    currentServer = newServer;
    currentProtocol = newProtocol;
    
    updateProtocolTabs(newProtocol);
    updateServerButtons(newServer);
    updateH2PresetVisibility(newProtocol);
    
    showMessage(`Switched to ${newServer} (${newProtocol.toUpperCase()})`);
    
    // Auto-reconnect if connected
    if (isConnected) {
      await invoke('stop_proxy');
      setTimeout(async () => {
        try {
          await invoke('start_proxy');
        } catch (e: any) {
          showMessage(`Start failed: ${e}`);
        }
      }, 500);
    }
  } catch (err: any) {
    showMessage(`Switch failed: ${err}`);
  }
}

// ── Toggle Connect/Disconnect ────────────────────────────
toggleSwitch.addEventListener('click', async () => {
  if (isConnected) {
    try {
      await invoke('stop_proxy');
      showMessage('Disconnected');
    } catch (err: any) {
      showMessage(`Stop failed: ${err}`);
    }
  } else {
    try {
      await invoke('start_proxy');
      showMessage('Connecting...');
    } catch (err: any) {
      showMessage(`Start failed: ${err}`);
    }
  }
});

// ── Protocol Tab Click ───────────────────────────────────
protocolTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const protocol = (tab as HTMLElement).dataset.protocol as 'h2' | 'stls';
    if (protocol !== currentProtocol) {
      switchProfile(currentServer, protocol);
    }
  });
});

// ── Flag Button Click ────────────────────────────────────
flagButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const server = (btn as HTMLElement).dataset.server!;
    if (server !== currentServer) {
      switchProfile(server, currentProtocol);
    }
  });
});

// ── H2 Preset Change ─────────────────────────────────────
const H2_PRESETS: Record<string, [number, number]> = {
  adsl: [10, 20],
  '4g': [15, 30],
  '5g': [50, 100],
  max: [100, 200],
};

h2PresetSelect.addEventListener('change', async () => {
  const preset = h2PresetSelect.value;
  const [up, down] = H2_PRESETS[preset] || [15, 30];
  
  speedUpBadge.textContent = `↑${up}`;
  speedDownBadge.textContent = `↓${down}`;
  
  try {
    await invoke('set_h2_preset', { preset, upMbps: up, downMbps: down });
    showMessage(`Preset: ${preset.toUpperCase()}`);
  } catch (err: any) {
    showMessage(`Preset update failed: ${err}`);
  }
});

// ── Settings Panel ───────────────────────────────────────
async function loadSettings() {
  try {
    const cfg = await invoke<Config>('get_config');
    settingSplitMode.value = cfg.split_mode || 'full';
    settingSplitRules.value = (cfg.split_rules || []).join('\n');
    settingMtu.value = cfg.mtu?.toString() || '';
    
    customRulesGroup.style.display = cfg.split_mode === 'custom' ? 'block' : 'none';
    btnUpdateGeofiles.style.display = cfg.split_mode === 'iran' ? 'block' : 'none';
    
    updateSplitIndicator(cfg.split_mode || 'full');
  } catch (err) {
    console.error('Load settings failed:', err);
  }
}

settingSplitMode.addEventListener('change', () => {
  const mode = settingSplitMode.value;
  customRulesGroup.style.display = mode === 'custom' ? 'block' : 'none';
  btnUpdateGeofiles.style.display = mode === 'iran' ? 'block' : 'none';
});

btnSaveSettings.addEventListener('click', async () => {
  try {
    const rules = settingSplitRules.value
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
    
    const mtu = settingMtu.value ? parseInt(settingMtu.value) : undefined;
    
    await invoke('update_config', {
      splitMode: settingSplitMode.value,
      splitRules: rules.length > 0 ? rules : undefined,
      mtu,
    });
    
    updateSplitIndicator(settingSplitMode.value);
    showMessage('Settings saved');
  } catch (err: any) {
    showMessage(`Save failed: ${err}`);
  }
});

btnUpdateGeofiles.addEventListener('click', async () => {
  try {
    await invoke('update_geofiles');
    showMessage('Geofiles updated');
  } catch (err: any) {
    showMessage(`Update failed: ${err}`);
  }
});

// ── Logs Panel ───────────────────────────────────────────
async function refreshLogs() {
  try {
    const s = await invoke<FullStatus>('get_full_status');
    logContent.textContent = s.log_lines || 'No logs available';
    logContent.scrollTop = logContent.scrollHeight;
  } catch (err) {
    logContent.textContent = 'Failed to load logs';
  }
}

btnRefreshLogs.addEventListener('click', refreshLogs);

// ── Panel Navigation ─────────────────────────────────────
btnSettings.addEventListener('click', () => {
  settingsPanel.classList.add('open');
  loadSettings();
});

btnLogs.addEventListener('click', () => {
  logsPanel.classList.add('open');
  refreshLogs();
});

panelCloses.forEach(btn => {
  btn.addEventListener('click', () => {
    const panelId = (btn as HTMLElement).dataset.panel;
    const panel = document.getElementById(panelId!);
    if (panel) panel.classList.remove('open');
  });
});

// ── DNS Controls ─────────────────────────────────────────
async function applyDns(profile: string) {
  try {
    dnsStatus.textContent = 'DNS: Applying...';
    await invoke('apply_dns', { profile });
    await updateDnsStatus();
    showMessage(`DNS applied: ${profile}`);
  } catch (err: any) {
    showMessage(`DNS failed: ${err}`);
    dnsStatus.textContent = 'DNS: Error';
  }
}

async function updateDnsStatus() {
  try {
    const status = await invoke<string>('get_current_dns');
    dnsStatus.textContent = `DNS: ${status}`;
  } catch (err) {
    dnsStatus.textContent = 'DNS: Unknown';
  }
}

btnDnsGermany.addEventListener('click', () => applyDns('germany'));
btnDnsFinland.addEventListener('click', () => applyDns('finland'));
btnDnsReset.addEventListener('click', () => applyDns('reset'));

// ── Event Listeners ──────────────────────────────────────
listen('proxy-log', (event: { payload: string }) => {
  if (logsPanel.classList.contains('open')) {
    logContent.textContent += `\n${event.payload}`;
    logContent.scrollTop = logContent.scrollHeight;
  }
});

// ── Initialize ───────────────────────────────────────────
(async () => {
  await loadProfile();
  await pollStatus();
  await updateDnsStatus();
  
  // Load H2 preset from config
  try {
    const cfg = await invoke<Config>('get_config');
    if (cfg.h2_preset) {
      h2PresetSelect.value = cfg.h2_preset;
      const [up, down] = H2_PRESETS[cfg.h2_preset] || [15, 30];
      speedUpBadge.textContent = `↑${up}`;
      speedDownBadge.textContent = `↓${down}`;
    }
  } catch (err) {
    console.error('Failed to load H2 preset:', err);
  }
})();
