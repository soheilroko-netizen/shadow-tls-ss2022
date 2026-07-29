<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import { getCurrentWindow } from '@tauri-apps/api/window'

  interface Config {
    server_address: string
    ss_port: number
    ss_password: string
    stls_port: number
    stls_password: string
    stls_sni: string
    socks5_port: number
    mtu: number | null
    auto_connect: boolean
    encryption_method: string
    split_mode: string
    split_processes: string[]
    split_domains: string[]
  }

  let activeTab = $state<'profile' | 'app' | 'split'>('profile')

  // Profile config
  let config = $state<Config>({
    server_address: '', ss_port: 8380, ss_password: '',
    stls_port: 8553, stls_password: '', stls_sni: 'dl.google.com',
    socks5_port: 1080, mtu: null, auto_connect: false,
    encryption_method: 'chacha20-ietf-poly1305',
    split_mode: 'exclude', split_processes: [], split_domains: [],
  })
  let profileName = $state('')
  let statusMsg = $state('')

  // App settings
  let language = $state('en')
  let autoStart = $state(false)
  let minimizeTray = $state(true)
  let notifyConnect = $state(true)
  let pingInterval = $state(1)

  // Split tunnel
  let splitMode = $state('exclude')
  let splitProcesses = $state('')
  let splitDomains = $state('')

  async function loadAll() {
    try {
      const store = await invoke<{ profiles: { name: string }[], active_profile: string }>('get_profiles')
      profileName = store.active_profile
      const cfg = await invoke<Config>('get_config')
      config = cfg
      splitMode = cfg.split_mode
      splitProcesses = (cfg.split_processes || []).join('\n')
      splitDomains = (cfg.split_domains || []).join('\n')
    } catch (e: any) {
      statusMsg = 'Load failed: ' + e
    }

    try {
      const raw = await invoke<string>('load_app_settings')
      const s = JSON.parse(raw)
      language = s.language || 'en'
      autoStart = s.auto_start || false
      minimizeTray = s.minimize_tray !== false
      notifyConnect = s.notify_connect !== false
      pingInterval = s.ping_interval || 1
    } catch {}
  }

  loadAll()

  async function saveProfile() {
    try {
      await invoke('save_config', { config })
      statusMsg = 'Profile saved'
    } catch (e: any) {
      statusMsg = 'Save failed: ' + e
    }
  }

  async function saveApp() {
    try {
      await invoke('save_app_settings', {
        language, autoStart, minimizeTray, notifyConnect, pingInterval,
      })
      statusMsg = 'App settings saved'
    } catch (e: any) {
      statusMsg = 'Save failed: ' + e
    }
  }

  async function saveSplit() {
    try {
      await invoke('save_split_rules', {
        mode: splitMode,
        processes: splitProcesses.split('\n').map(s => s.trim()).filter(Boolean),
        domains: splitDomains.split('\n').map(s => s.trim()).filter(Boolean),
      })
      statusMsg = 'Split rules saved'
    } catch (e: any) {
      statusMsg = 'Save failed: ' + e
    }
  }

  function closeWindow() {
    getCurrentWindow().close()
  }
</script>

<div class="settings">
  <div class="tab-bar">
    <button class="tab" class:active={activeTab === 'profile'} onclick={() => activeTab = 'profile'}>Profile</button>
    <button class="tab" class:active={activeTab === 'app'} onclick={() => activeTab = 'app'}>App</button>
    <button class="tab" class:active={activeTab === 'split'} onclick={() => activeTab = 'split'}>Split Tunnel</button>
  </div>

  {#if activeTab === 'profile'}
    <div class="tab-content">
      <h3>Profile: {profileName}</h3>
      <div class="form-row">
        <label>Server Address</label>
        <input bind:value={config.server_address} placeholder="ns.baft.uk" />
      </div>
      <div class="form-row">
        <label>SS Port</label>
        <input type="number" bind:value={config.ss_port} />
      </div>
      <div class="form-row">
        <label>SS Password</label>
        <input type="password" bind:value={config.ss_password} />
      </div>
      <div class="form-row">
        <label>STLS Port</label>
        <input type="number" bind:value={config.stls_port} />
      </div>
      <div class="form-row">
        <label>STLS Password</label>
        <input type="password" bind:value={config.stls_password} />
      </div>
      <div class="form-row">
        <label>STLS SNI</label>
        <input bind:value={config.stls_sni} />
      </div>
      <div class="form-row">
        <label>SOCKS5 Port</label>
        <input type="number" bind:value={config.socks5_port} />
      </div>
      <div class="form-row">
        <label>Encryption</label>
        <select bind:value={config.encryption_method}>
          <option value="aes-256-gcm">AES-256-GCM</option>
          <option value="chacha20-ietf-poly1305">ChaCha20-Poly1305</option>
          <option value="aes-128-gcm">AES-128-GCM</option>
          <option value="2022-blake3-aes-256-gcm">2022-Blake3-AES-256-GCM</option>
        </select>
      </div>
      <div class="form-row">
        <label>MTU</label>
        <input type="number" value={config.mtu ?? ''} oninput={e => config.mtu = parseInt((e.target as HTMLInputElement).value) || 0} placeholder="1500" />
      </div>
      <div class="form-row">
        <label>Auto Connect</label>
        <select bind:value={config.auto_connect}>
          <option value={true}>Enabled</option>
          <option value={false}>Disabled</option>
        </select>
      </div>
      <button class="save-btn" onclick={saveProfile}>Save Profile</button>
    </div>
  {/if}

  {#if activeTab === 'app'}
    <div class="tab-content">
      <h3>Application Settings</h3>
      <div class="form-row">
        <label>Language</label>
        <select bind:value={language}>
          <option value="en">English</option>
          <option value="fa">فارسی</option>
        </select>
      </div>
      <div class="form-row">
        <label>Auto-start on boot</label>
        <select bind:value={autoStart}>
          <option value={true}>Enabled</option>
          <option value={false}>Disabled</option>
        </select>
      </div>
      <div class="form-row">
        <label>Minimize to tray</label>
        <select bind:value={minimizeTray}>
          <option value={true}>Enabled</option>
          <option value={false}>Disabled</option>
        </select>
      </div>
      <div class="form-row">
        <label>Notify on connect</label>
        <select bind:value={notifyConnect}>
          <option value={true}>Enabled</option>
          <option value={false}>Disabled</option>
        </select>
      </div>
      <div class="form-row">
        <label>Ping interval (s)</label>
        <input type="number" bind:value={pingInterval} min="1" />
      </div>
      <button class="save-btn" onclick={saveApp}>Save App Settings</button>
    </div>
  {/if}

  {#if activeTab === 'split'}
    <div class="tab-content">
      <h3>Split Tunnel</h3>
      <div class="form-row">
        <label>Mode</label>
        <select bind:value={splitMode}>
          <option value="exclude">Exclude (bypass VPN)</option>
          <option value="include">Include (only VPN)</option>
          <option value="off">Off</option>
        </select>
      </div>
      <div class="form-row">
        <label>Process names (one per line)</label>
        <textarea bind:value={splitProcesses} rows="4" placeholder="chrome.exe"></textarea>
      </div>
      <div class="form-row">
        <label>Domain/IP rules (one per line)</label>
        <textarea bind:value={splitDomains} rows="4" placeholder="example.com"></textarea>
      </div>
      <button class="save-btn" onclick={saveSplit}>Save Split Rules</button>
    </div>
  {/if}

  {#if statusMsg}
    <div class="status">{statusMsg}</div>
  {/if}
</div>

<style>
  .settings {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #0a0a0f;
    color: rgba(255,255,255,0.85);
    font-family: 'Inter', sans-serif;
    overflow: hidden;
  }
  .tab-bar {
    display: flex;
    gap: 0;
    background: rgba(20, 20, 30, 0.4);
    border-bottom: 1px solid rgba(245, 158, 11, 0.08);
    flex-shrink: 0;
  }
  .tab {
    flex: 1;
    padding: 10px;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    background: none;
    border: none;
    color: rgba(255,255,255,0.3);
    cursor: pointer;
    transition: all 0.15s;
    border-bottom: 2px solid transparent;
  }
  .tab:hover { color: rgba(255,255,255,0.5); }
  .tab.active {
    color: #f59e0b;
    border-bottom-color: #f59e0b;
    background: rgba(245, 158, 11, 0.03);
  }
  .tab-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h3 {
    font-size: 14px;
    font-weight: 500;
    color: #f59e0b;
    margin: 0 0 4px;
  }
  .form-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .form-row label {
    font-size: 10px;
    font-weight: 500;
    color: rgba(255,255,255,0.35);
    letter-spacing: 0.3px;
  }
  .form-row input,
  .form-row select,
  .form-row textarea {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(245, 158, 11, 0.08);
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 12px;
    font-family: inherit;
    color: rgba(255,255,255,0.8);
    outline: none;
    transition: border-color 0.15s;
  }
  .form-row input:focus,
  .form-row select:focus,
  .form-row textarea:focus {
    border-color: rgba(245, 158, 11, 0.3);
  }
  .form-row textarea {
    resize: vertical;
    min-height: 50px;
  }
  .form-row select { cursor: pointer; }
  .save-btn {
    align-self: flex-start;
    background: linear-gradient(145deg, #f59e0b, #d97706);
    border: none;
    color: #0a0a0f;
    padding: 8px 22px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: opacity 0.15s;
    margin-top: 4px;
  }
  .save-btn:hover { opacity: 0.85; }
  .status {
    padding: 8px 16px;
    font-size: 11px;
    color: rgba(245, 158, 11, 0.5);
    background: rgba(245, 158, 11, 0.03);
    border-top: 1px solid rgba(245, 158, 11, 0.04);
    text-align: center;
    flex-shrink: 0;
  }
</style>
