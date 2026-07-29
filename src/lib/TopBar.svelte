<script lang="ts">
  let { splitActive, onToggle, onSettings }: {
    splitActive: boolean
    onToggle: () => void
    onSettings: () => void
  } = $props()

  let splitHover = $state(false)
</script>

<header class="top-bar">
  <button class="split-btn {splitActive ? 'active' : ''}" onclick={onToggle}
    onmouseenter={() => splitHover = true}
    onmouseleave={() => splitHover = false}
    title="Split tunnel toggle">
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18">
      <path d="M2 10h5l2-3 2 6 2-3 5 0"/>
      <path d="M2 10a8 8 0 1116 0 8 8 0 01-16 0z" stroke-width="1.2"/>
    </svg>
    {#if splitActive}
      <span class="split-indicator"></span>
    {/if}
  </button>

  <span class="app-title">dakal-tls</span>

  <button class="menu-btn" onclick={onSettings} title="Settings">
    <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
      <path d="M3 5h14M3 10h14M3 15h14"/>
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
    padding: 8px 12px;
    flex-shrink: 0;
    background: rgba(10, 10, 15, 0.6);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(245, 158, 11, 0.08);
  }
  .app-title {
    font-size: 16px;
    font-weight: 700;
    color: #f59e0b;
    letter-spacing: 1px;
    text-shadow: 0 0 20px rgba(245, 158, 11, 0.15);
  }
  .split-btn, .menu-btn {
    width: 34px;
    height: 34px;
    border: 1px solid rgba(245, 158, 11, 0.12);
    border-radius: 8px;
    background: rgba(245, 158, 11, 0.04);
    color: rgba(245, 158, 11, 0.35);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    position: relative;
  }
  .split-btn:hover, .menu-btn:hover {
    background: rgba(245, 158, 11, 0.1);
    color: rgba(245, 158, 11, 0.7);
    border-color: rgba(245, 158, 11, 0.25);
    box-shadow: 0 0 12px rgba(245, 158, 11, 0.06);
  }
  .split-btn.active {
    color: #f59e0b;
    border-color: rgba(245, 158, 11, 0.3);
    background: rgba(245, 158, 11, 0.08);
    box-shadow: 0 0 12px rgba(245, 158, 11, 0.1);
  }
  .split-indicator {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #f59e0b;
    box-shadow: 0 0 6px rgba(245, 158, 11, 0.6);
  }
</style>
