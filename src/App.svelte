<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import TopBar from './lib/TopBar.svelte'
  import PowerButton from './lib/PowerButton.svelte'
  import ProfileSelector from './lib/ProfileSelector.svelte'
  import DataCard from './lib/DataCard.svelte'
  import PingCard from './lib/PingCard.svelte'
  import LogPanel from './lib/LogPanel.svelte'

  let connected = $state(false)
  let profileName = $state('Germany 1')
  let sessionTime = $state('00:00:00')
  let connectTime = $state(0)
  let logLines = $state<string[]>([])
  let upBytes = $state(0)
  let downBytes = $state(0)
  let pingMs = $state<number | null>(null)
  let splitActive = $state(false)

  let timerHandle: ReturnType<typeof setInterval> | null = null
  let trafficHandle: ReturnType<typeof setInterval> | null = null
  let pingHandle: ReturnType<typeof setInterval> | null = null

  async function loadInit() {
    try {
      const split = await invoke<boolean>('get_split_state')
      splitActive = split
    } catch (e) { console.error('split init', e) }
    try {
      const store = await invoke<{ profiles: { name: string }[], active_profile: string }>('get_profiles')
      profileName = store.active_profile
    } catch (e) { console.error('profile init', e) }
  }
  loadInit()

  // ── Poll initial status ──
  (async () => {
    try {
      const alive = await invoke<boolean>('get_status')
      if (alive) {
        connected = true
        connectTime = Date.now()
        startTimers()
        addLog('Already connected')
      }
    } catch {}
  })()

  async function handleConnect() {
    if (connected) {
      // DISCONNECT
      try {
        await invoke('stop_proxy')
        connected = false
        connectTime = 0
        sessionTime = '00:00:00'
        stopTimers()
        addLog('Disconnected')
        pingMs = null
        upBytes = 0
        downBytes = 0
      } catch (e: any) {
        addLog('Disconnect failed: ' + String(e))
      }
    } else {
      // CONNECT
      try {
        await invoke('start_proxy')
        connected = true
        connectTime = Date.now()
        startTimers()
        addLog('Connected')
        // Immediate polls
        pollTraffic()
        pollPing()
      } catch (e: any) {
        addLog('Connect failed: ' + String(e))
      }
    }
  }

  function startTimers() {
    stopTimers()
    timerHandle = setInterval(updateTimer, 1000)
    trafficHandle = setInterval(pollTraffic, 1000)
    pingHandle = setInterval(pollPing, 1000)
    updateTimer()
  }

  function stopTimers() {
    if (timerHandle !== null) { clearInterval(timerHandle); timerHandle = null }
    if (trafficHandle !== null) { clearInterval(trafficHandle); trafficHandle = null }
    if (pingHandle !== null) { clearInterval(pingHandle); pingHandle = null }
  }

  function updateTimer() {
    if (!connectTime) return
    const elapsed = Math.floor((Date.now() - connectTime) / 1000)
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0')
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')
    const s = String(elapsed % 60).padStart(2, '0')
    sessionTime = `${h}:${m}:${s}`
  }

  async function pollTraffic() {
    if (!connected) return
    try {
      // Try total (connections API) first
      const raw = await invoke<string>('get_total_traffic')
      const d = JSON.parse(raw)
      if (d.up !== undefined) {
        upBytes = d.up
        downBytes = d.down
      }
    } catch {
      // Fallback: live traffic API
      try {
        const raw2 = await invoke<string>('get_traffic')
        const d2 = JSON.parse(raw2)
        if (d2.up !== undefined) {
          upBytes = d2.up
          downBytes = d2.down
        }
      } catch {}
    }
  }

  async function pollPing() {
    if (!connected) return
    try {
      const raw = await invoke<string>('real_ping')
      const val = parseInt(raw)
      if (!isNaN(val)) pingMs = val
    } catch {}
  }

  function handleSplitToggle() {
    splitActive = !splitActive
    invoke('set_split_state', { enabled: splitActive }).catch((e: any) => {
      splitActive = !splitActive
      addLog('Split toggle failed: ' + String(e))
    })
    addLog(splitActive ? 'Split ON' : 'Split OFF')
  }

  async function handleOpenSettings() {
    try {
      await invoke('show_settings')
    } catch (e: any) {
      addLog('Settings error: ' + String(e))
    }
  }

  async function handleProfileSwitch(name: string) {
    const wasConnected = connected
    try {
      await invoke('switch_profile_stop', { name })
      profileName = name
      if (wasConnected) {
        connected = false
        connectTime = 0
        sessionTime = '00:00:00'
        stopTimers()
        pingMs = null
        upBytes = 0
        downBytes = 0
      }
      addLog('Profile: ' + name)
    } catch (e: any) {
      addLog('Switch failed: ' + String(e))
    }
  }

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString()
    logLines = [...logLines.slice(-200), `${ts} ${msg}`]
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
      {#if connected}
        <span class="session-time">{sessionTime}</span>
      {/if}
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
    background: #0a0a0f;
  }
  .bg {
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }
  .bg::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at 50% 30%, rgba(245, 158, 11, 0.07) 0%, transparent 70%);
  }
  .dashboard {
    position: relative;
    z-index: 1;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px 16px 0;
    gap: 10px;
    overflow-y: auto;
  }
  .status-line {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 500;
    color: rgba(255,255,255,0.6);
    letter-spacing: 0.5px;
    margin-top: 2px;
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(255,255,255,0.2);
    transition: all 0.3s;
  }
  .connected .status-dot {
    background: #f59e0b;
    box-shadow: 0 0 14px rgba(245, 158, 11, 0.7);
  }
  .status-text {
    text-transform: uppercase;
    font-weight: 600;
    transition: color 0.3s;
  }
  .connected .status-text {
    color: #fbbf24;
    text-shadow: 0 0 8px rgba(245,158,11,0.15);
  }
  .session-time {
    font-size: 13px;
    font-weight: 400;
    color: rgba(255,255,255,0.5);
    font-variant-numeric: tabular-nums;
    letter-spacing: 1px;
    margin-left: 4px;
  }
  .cards-row {
    display: flex;
    gap: 10px;
    width: 100%;
    max-width: 400px;
  }
  .future-area {
    flex: 1;
    min-height: 60px;
    width: 100%;
    max-width: 400px;
  }
</style>
