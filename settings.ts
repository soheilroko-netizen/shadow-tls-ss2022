import { getCurrentWindow } from '@tauri-apps/api/window';

let currentTab = 'profile';

const $ = (id: string) => document.getElementById(id)!;

// ─── Tab Navigation ──────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = (btn as HTMLButtonElement).dataset.tab;
    if (tab) showTab(tab);
  });
});

function showTab(tab: string) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  currentTab = tab;
}

// ─── Save Profile ─────────────────────────────────────────────
$('btn-save-profile')?.addEventListener('click', async () => {
  const config = {
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
    await window.__TAURI__.invoke('save_config', { config });
    alert('Profile saved');
    closeSettings();
    window.location.hash = tab;
  } catch (e: any) {
    alert('Save failed: ' + String(e));
  }
});

// ─── Add / Delete Profile ─────────────────────────────────────
$('btn-add-profile')?.addEventListener('click', async () => {
  const name = ($('profile-name-input') as HTMLInputElement).value.trim();
  if (!name) { alert('Enter a profile name'); return; }

  const config = {
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
    await window.__TAURI__.invoke('add_profile', { name, config });
    alert('Profile created: ' + name);
    closeSettings();
    window.location.hash = tab;
  } catch (e: any) {
    alert('Create failed: ' + String(e));
  }
});

$('btn-delete-profile')?.addEventListener('click', async () => {
  const name = ($('profile-name-input') as HTMLInputElement).value.trim();
  if (!name) { alert('Enter a profile name to delete'); return; }

  if (!confirm(`Delete profile '${name}'?`)) return;

  try {
    await window.__TAURI__.invoke('delete_profile', { name });
    alert('Deleted: ' + name);
    closeSettings();
    window.location.hash = tab;
  } catch (e: any) {
    alert('Delete failed: ' + String(e));
  }
});

// ─── Save App Settings ─────────────────────────────────────
$('btn-save-app')?.addEventListener('click', async () => {
  try {
    await window.__TAURI__.invoke('save_app_settings', {
      language: ($('language') as HTMLSelectElement).value,
      auto_start: ($('auto-start') as HTMLSelectElement).value === 'true',
      minimize_tray: ($('minimize-tray') as HTMLSelectElement).value === 'true',
      notify_connect: ($('notif-connect') as HTMLSelectElement).value === 'true',
      ping_interval: parseInt(($('ping-interval') as HTMLInputElement).value) || 1,
    });
    alert('App settings saved');
    closeSettings();
    window.location.hash = tab;
  } catch (e: any) {
    alert('Save failed: ' + String(e));
  }
});

// ─── Save Split Rules ─────────────────────────────────────────
$('btn-save-split')?.addEventListener('click', async () => {
  const processes = ($('split-processes') as HTMLTextAreaElement).value
    .split('\\n').map(s => s.trim()).filter(s => s.length > 0);
  const domains = ($('split-domains') as HTMLTextAreaElement).value
    .split('\\n').map(s => s.trim()).filter(s => s.length > 0);

  try {
    await window.__TAURI__.invoke('save_split_rules', {
      mode: ($('split-mode') as HTMLSelectElement).value,
      processes,
      domains,
    });
    alert('Split rules saved');
    closeSettings();
    window.location.hash = tab;
  } catch (e: any) {
    alert('Save failed: ' + String(e));
  }
});

// ─── Close Settings ─────────────────────────────────────────
async function closeSettings() {
  const win = getCurrentWindow();
  await win.hide();
}

$('close-settings')?.addEventListener('click', closeSettings);

// ─── Open correct tab from hash ─────────────────────────────────
function openTabFromHash() {
  const hash = window.location.hash.replace('#', '') || 'profile';
  if (['profile', 'app', 'split'].includes(hash)) {
    showTab(hash);
  }
}
openTabFromHash();

// Listen for hash changes (reactive tab switching)
window.addEventListener('hashchange', openTabFromHash);