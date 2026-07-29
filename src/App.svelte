<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import TopBar from './lib/TopBar.svelte'
  import PowerButton from './lib/PowerButton.svelte'
  import ProfileSelector from './lib/ProfileSelector.svelte'
  import DataCard from './lib/DataCard.svelte'
  import PingCard from './lib/PingCard.svelte'
  import LogPanel from './lib/LogPanel.svelte'

  let connected = $state(false)
  let profileName = $state('Germany 1')
  let sessionTime = $state('00:00:00')
  let connectStart = $state<number>(0)
  let logLines = $state<string[]>([])
  let upBytes = $state(0)
  let downBytes = $state(0)
  let pingMs = $state<number | null>(null)
  let splitActive = $state(false)

  let timerInterval: ReturnType<typeof setInterval> | null = null
  let trafficInterval: ReturnType<typeof setInterval> | null = null
  let pingInterval: ReturnType<typeof setInterval> | null = null

  async function loadInit() {
    try {
      const split = await invoke<boolean>('get_split_state')
      splitActive = split
    } catch {}
    try {
      const store = await invoke<{ profiles: { name: string }[], active_profile: string }>('get_profiles')
      profileName = store.active_profile
    } catch {}
  }
  loadInit()

  async function handleConnect() {
    if (!connected) {
      try {
        await invoke('start_proxy')
        connected = true
        connectStart = Date.now()
        startTimers()
        addLog('Connected')
      } catch (e: any) {
        addLog('Connect failed: ' + String(e))
      }
    } else {
      try {
        await invoke('stop_proxy')
        connected = false
        connectStart = 0
        stopTimers()
        addLog('Disconnected')
      } catch (e: any) {
        addLog('Disconnect failed: ' + String(e))
      }
    }
  }

  function startTimers() {
    stopTimers()
    timerInterval = setInterval(updateTimer, 1000)
    trafficInterval = setInterval(pollTraffic, 1000)
    pingInterval = setInterval(pollPing, 1000)
    updateTimer()
    pollTraffic()
    pollPing()
  }

  function stopTimers() {
    if (timerInterval) clearInterval(timerInterval)
    if (trafficInterval) clearInterval(trafficInterval)
    if (pingInterval) clearInterval(pingInterval)
    timerInterval = trafficInterval = pingInterval = null
    sessionTime = '00:00:00'
  }

  function updateTimer() {
    if (!connectStart) return
    const elapsed = Math.floor((Date.now() - connectStart) / 1000)
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0')
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')
    const s = String(elapsed % 60).padStart(2, '0')
    sessionTime = `${h}:${m}:${s}`
  }

  async function pollTraffic() {
    if (!connected) return
    try {
      const raw = await invoke<string>('get_total_traffic')
      const data = JSON.parse(raw)
      upBytes = data.up || 0
      downBytes = data.down || 0
    } catch {}
  }

  async function pollPing() {
    if (!connected) return
    try {
      const raw = await invoke<string>('real_ping')
      const ms = parseInt(raw)
      if (!isNaN(ms)) pingMs = ms
    } catch {}
  }

  async function handleSplitToggle() {
    splitActive = !splitActive
    try {
      await invoke('set_split_state', { enabled: splitActive })
      addLog(splitActive ? 'Split tunnel ON' : 'Split tunnel OFF')
    } catch (e: any) {
      splitActive = !splitActive
      addLog('Split toggle failed: ' + String(e))
    }
  }

  async function handleOpenSettings() {
    try {
      await invoke('show_settings')
    } catch (e: any) {
      addLog('Settings failed: ' + String(e))
    }
  }

  async function handleProfileSwitch(name: string) {
    try {
      await invoke('switch_profile_stop', { name })
      profileName = name
      connected = false
      connectStart = 0
      stopTimers()
      addLog('Switched to: ' + name)
    } catch (e: any) {
      addLog('Switch failed: ' + String(e))
    }
  }

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString()
    logLines = [...logLines, `${ts} ${msg}`]
  }

  function clearLog() {
    logLines = []
  }
</script>

<div class="app {connected ? 'connected' : ''}">
  <div class="bg"></div>
  <TopBar {splitActive} onToggle={handleSplitToggle} onSettings={handleOpenSettings} />
  <main class="dashboard">
    <PowerButton {connected} onClick={handleConnect} />
    <div class="status-line">
      <span class="status-dot"></span>
      <span class="status-text">{connected ? 'CONNECTED' : 'Disconnected'}</span>
      <span class="session-time">{sessionTime}</span>
    </div>
    <ProfileSelector {profileName} onSwitch={handleProfileSwitch} />
    <div class="cards-row">
      <DataCard upBytes={upBytes} downBytes={downBytes} />
      <PingCard pingMs={pingMs} />
    </div>
    <div class="future-area"></div>
    <LogPanel lines={logLines} onClear={clearLog} />
  </main>
</div>

<style>
  .app {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
  }
  .bg {
    position: fixed;
    inset: 0;
    z-index: 0;
    background: #0a0a0f;
  }
  .bg::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at 50% 30%, rgba(245, 158, 11, 0.04) 0%, transparent 70%);
    pointer-events: none;
  }
  .dashboard {
    position: relative;
    z-index: 1;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 16px 0;
    gap: 8px;
    overflow-y: auto;
  }
  .status-line {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 400;
    color: rgba(255,255,255,0.55);
    letter-spacing: 1px;
    margin-top: -4px;
  }
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgba(255,255,255,0.15);
    transition: all 0.3s;
  }
  .connected .status-dot {
    background: #f59e0b;
    box-shadow: 0 0 12px rgba(245, 158, 11, 0.5);
  }
  .status-text {
    text-transform: uppercase;
    font-weight: 500;
    transition: color 0.3s;
  }
  .connected .status-text {
    color: #f59e0b;
  }
  .session-time {
    font-size: 13px;
    font-weight: 300;
    color: rgba(255,255,255,0.4);
    font-variant-numeric: tabular-nums;
    letter-spacing: 1px;
  }
  .cards-row {
    display: flex;
    gap: 10px;
    width: 100%;
    max-width: 400px;
    margin-top: 4px;
  }
  .future-area {
    flex: 1;
    min-height: 60px;
    width: 100%;
    max-width: 400px;
  }
</style>
