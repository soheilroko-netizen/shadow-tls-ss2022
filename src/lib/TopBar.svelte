<script lang="ts">
  let { splitActive, onToggle, onSettings }: {
    splitActive: boolean
    onToggle: () => void
    onSettings: () => void
  } = $props()
</script>

<header class="top-bar">
  <button class="split-btn {splitActive ? 'active' : ''}" onclick={onToggle} title="Split tunnel">
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
      <path d="M2 9h4l2-3 2 6 2-3 4 0"/>
      <path d="M2 9a7 7 0 1114 0 7 7 0 01-14 0z" stroke-width="1"/>
    </svg>
    {#if splitActive}
      <span class="indicator"></span>
    {/if}
  </button>

  <span class="app-title">dakal-tls</span>

  <button class="hamburger" onclick={onSettings} title="Settings">
    <svg viewBox="0 0 20 16" fill="none" stroke="currentColor" stroke-width="2.2" width="20" height="16">
      <path d="M2 2h16M2 8h16M2 14h16"/>
    </svg>
  </button>
</header>

<style>
  .top-bar {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    flex-shrink: 0;
    background: rgba(10, 10, 15, 0.7);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid rgba(245, 158, 11, 0.1);
  }
  .app-title {
    font-size: 17px;
    font-weight: 800;
    color: #fbbf24;
    letter-spacing: 1.5px;
    text-shadow: 0 0 25px rgba(245, 158, 11, 0.12);
  }
  .split-btn, .hamburger {
    width: 34px;
    height: 34px;
    border: 1px solid rgba(245, 158, 11, 0.15);
    border-radius: 8px;
    background: rgba(245, 158, 11, 0.06);
    color: rgba(245, 158, 11, 0.55);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    position: relative;
  }
  .split-btn:hover, .hamburger:hover {
    background: rgba(245, 158, 11, 0.12);
    color: #fbbf24;
    border-color: rgba(245, 158, 11, 0.3);
    box-shadow: 0 0 15px rgba(245, 158, 11, 0.08);
  }
  .split-btn.active {
    color: #fbbf24;
    border-color: rgba(245, 158, 11, 0.3);
    background: rgba(245, 158, 11, 0.1);
  }
  .indicator {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #fbbf24;
    box-shadow: 0 0 8px rgba(245, 158, 11, 0.8);
  }
</style>
