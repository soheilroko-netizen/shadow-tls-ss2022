import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

const $ = (s) => document.querySelector(s);

// ── Helpers ──────────────────────────────────────────────────────

function fmtBytes(b) {
  if (b === 0) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

function fmtSpeed(b) {
  if (b === 0) return '0 B/s';
  if (b < 1024) return `${b} B/s`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB/s`;
  return `${(b / 1048576).toFixed(1)} MB/s`;
}

function fmtUptime(s) {
  if (!s) return '-';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

function show(el, text, type) {
  el.textContent = text;
  el.className = 'msg ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; el.className = 'msg'; }, 4000);
}

// ── View switching ───────────────────────────────────────────────

const SIZES = { main: [500, 560], settings: [500, 600], log: [500, 480] };
const VIEWS  = { main: 'v-main', settings: 'v-settings', log: 'v-log' };

async function showView(name) {
  for (const [k, id] of Object.entries(VIEWS))
    $(`#${id}`).classList.toggle('active', k === name);
  const [w, h] = SIZES[name];
  try { await getCurrentWindow().setSize({ type: 'Logical', width: w, height: h }); } catch {}
  if (name === 'main') refreshMain();
  if (name === 'settings') loadSettings();
  if (name === 'log') refreshLog();
}

// ── Main view ────────────────────────────────────────────────────

let profilesLoaded = false;
let wasRunning = false;

async function refreshMain() {
  try {
    const s = await invoke('get_stats');

    const running = s.running;
    $('#dot').classList.toggle('on', running);
    $('#status-text').textContent = running ? 'Connected' : 'Disconnected';
    $('#btn-connect').disabled = running;
    $('#btn-disconnect').disabled = !running;

    $('#i-server').textContent = s.server || '-';
    $('#i-uptime').textContent = fmtUptime(s.uptime);

    if (running) {
      $('#i-speed-up').textContent = fmtSpeed(s.speed_up);
      $('#i-speed-down').textContent = fmtSpeed(s.speed_down);
      $('#i-total-up').textContent = fmtBytes(s.total_up);
      $('#i-total-down').textContent = fmtBytes(s.total_down);
      $('#i-session-up').textContent = fmtBytes(s.up);
      $('#i-session-down').textContent = fmtBytes(s.down);
    } else {
      $('#i-speed-up').textContent = '0 B/s';
      $('#i-speed-down').textContent = '0 B/s';
      $('#i-total-up').textContent = '0 B';
      $('#i-total-down').textContent = '0 B';
      $('#i-session-up').textContent = '0 B';
      $('#i-session-down').textContent = '0 B';
    }

    if (running && !wasRunning) startPing();
    if (!running && wasRunning) stopPing();
    wasRunning = running;

    if (!profilesLoaded) {
      const ps = await invoke('get_profiles');
      const sel = $('#main-profile');
      sel.innerHTML = '';
      ps.profiles.forEach(p => {
        const o = document.createElement('option');
        o.value = p.name;
        o.textContent = p.name;
        sel.appendChild(o);
      });
      sel.value = ps.active_profile;
      profilesLoaded = true;
    }
  } catch (e) {
    console.error('stats:', e);
  }
}

// ── Connect / Disconnect ─────────────────────────────────────────

async function doConnect() {
  try { show($('#msg'), await invoke('connect'), 'ok'); }
  catch (e) { show($('#msg'), '' + e, 'err'); }
}

async function doDisconnect() {
  try { show($('#msg'), await invoke('disconnect'), 'ok'); }
  catch (e) { show($('#msg'), '' + e, 'err'); }
}

// ── Real-time Ping (2s) ──────────────────────────────────────────

let pingTimer = null;
let pingInFlight = false;

async function doPing() {
  if (pingInFlight) return;
  const el = $('#i-ping');
  el.textContent = '...';
  pingInFlight = true;
  try { el.textContent = await invoke('ping'); }
  catch { el.textContent = 'TIMEOUT'; }
  pingInFlight = false;
}

function startPing() {
  if (pingTimer) return;
  doPing();
  pingTimer = setInterval(doPing, 2000);
}

function stopPing() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  $('#i-ping').textContent = '-';
}

// ── Settings ─────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const ps = await invoke('get_profiles');
    const sel = $('#settings-profile');
    sel.innerHTML = '';
    ps.profiles.forEach(p => {
      const o = document.createElement('option');
      o.value = p.name;
      o.textContent = p.name;
      o.selected = p.name === ps.active_profile;
      sel.appendChild(o);
    });
    await fillForm();
  } catch (e) { show($('#settings-msg'), '' + e, 'err'); }
}

async function fillForm() {
  try {
    const c = await invoke('get_config');
    $('#f-server').value = c.server_address;
    $('#f-ss-port').value = c.ss_port;
    $('#f-ss-pass').value = c.ss_password;
    $('#f-stls-port').value = c.stls_port;
    $('#f-stls-pass').value = c.stls_password;
    $('#f-stls-sni').value = c.stls_sni;
    $('#f-socks5').value = c.socks5_port;
    $('#f-mtu').value = c.mtu ?? '';
    $('#f-split').value = c.split_rules.map(r => r.pattern).join('\n');
  } catch (e) { show($('#settings-msg'), '' + e, 'err'); }
}

function readForm() {
  const split = $('#f-split').value.split('\n').map(s => s.trim()).filter(Boolean).map(s => ({ pattern: s }));
  return {
    server_address: $('#f-server').value,
    ss_port: parseInt($('#f-ss-port').value) || 8380,
    ss_password: $('#f-ss-pass').value,
    stls_port: parseInt($('#f-stls-port').value) || 8553,
    stls_password: $('#f-stls-pass').value,
    stls_sni: $('#f-stls-sni').value,
    socks5_port: parseInt($('#f-socks5').value) || 1080,
    mtu: $('#f-mtu').value ? parseInt($('#f-mtu').value) : null,
    split_rules: split,
  };
}

async function doSave(e) {
  e.preventDefault();
  try {
    await invoke('save_config', { config: readForm() });
    show($('#settings-msg'), 'Saved', 'ok');
    profilesLoaded = false;
    setTimeout(() => showView('main'), 800);
  } catch (err) { show($('#settings-msg'), '' + err, 'err'); }
}

async function doSwitchProfile() {
  const name = $('#settings-profile').value;
  try {
    await invoke('switch_profile', { name });
    await fillForm();
    profilesLoaded = false;
    show($('#settings-msg'), `Switched to ${name}`, 'ok');
  } catch (e) { show($('#settings-msg'), '' + e, 'err'); }
}

async function doNewProfile() {
  const name = prompt('Profile name:');
  if (!name?.trim()) return;
  try {
    await invoke('add_profile', { name: name.trim(), config: readForm() });
    profilesLoaded = false;
    await loadSettings();
    show($('#settings-msg'), 'Created', 'ok');
  } catch (e) { show($('#settings-msg'), '' + e, 'err'); }
}

async function doDeleteProfile() {
  const name = $('#settings-profile').value;
  if (name === 'Default') return show($('#settings-msg'), "Can't delete Default", 'err');
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    await invoke('delete_profile', { name });
    profilesLoaded = false;
    await loadSettings();
    show($('#settings-msg'), 'Deleted', 'ok');
  } catch (e) { show($('#settings-msg'), '' + e, 'err'); }
}

// ── Log ──────────────────────────────────────────────────────────

async function refreshLog() {
  try { $('#log-content').textContent = await invoke('get_log'); }
  catch (e) { $('#log-content').textContent = '' + e; }
}

// ── Polling (1s) ─────────────────────────────────────────────────

let pollTimer = null;

function startPoll() {
  if (pollTimer) return;
  pollTimer = setInterval(refreshMain, 1000);
}

// ── Init ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  $('#btn-settings').onclick = () => showView('settings');
  $('#btn-log').onclick = () => showView('log');
  $('#back-settings').onclick = () => showView('main');
  $('#back-log').onclick = () => showView('main');

  $('#btn-connect').onclick = doConnect;
  $('#btn-disconnect').onclick = doDisconnect;

  $('#settings-form').onsubmit = doSave;
  $('#settings-profile').onchange = doSwitchProfile;
  $('#btn-new').onclick = doNewProfile;
  $('#btn-del').onclick = doDeleteProfile;
  $('#btn-refresh').onclick = refreshLog;

  $('#main-profile').onchange = async () => {
    const name = $('#main-profile').value;
    if (!name) return;
    try {
      await invoke('switch_profile_stop', { name });
      profilesLoaded = false;
      refreshMain();
      show($('#msg'), `Switched to ${name}`, 'ok');
    } catch (e) { show($('#msg'), '' + e, 'err'); }
  };

  refreshMain();
  startPoll();
});
