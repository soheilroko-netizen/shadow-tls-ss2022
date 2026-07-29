<script lang="ts">
  import PowerButton from './lib/PowerButton.svelte'
  import { onMount } from 'svelte'
  let connected = $state(false)
  async function toggle() {
    try {
      const { invoke } = window.__TAURI__ ? window.__TAURI__ : await import('@tauri-apps/api/core')
      if (connected) await invoke('stop_proxy')
      else await invoke('start_proxy')
      connected = !connected
    } catch(e) { console.error(e) }
  }
  onMount(async () => {
    try {
      const { invoke } = window.__TAURI__ ? window.__TAURI__ : await import('@tauri-apps/api/core')
      connected = await invoke('get_status')
    } catch(e) {}
  })
</script>
<div id="app-root">
  <h1>dakal-tls</h1>
  <PowerButton {connected} onClick={toggle} />
  <p>Status: {connected ? 'Connected' : 'Disconnected'}</p>
</div>
<style>
  :global(body){margin:0;background:#0a0a0f;color:#e4e4ec;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}
  #app-root{text-align:center}
  h1{font-size:18px;font-weight:700;color:#fbbf24;letter-spacing:1px;margin-bottom:20px}
  p{font-size:13px;color:rgba(255,255,255,0.45);margin-top:12px}
</style>