<script lang="ts">
  let { splitActive, onToggle, onSettings }: {
    splitActive: boolean
    onToggle: () => void
    onSettings: () => void
  } = $props()
</script>

<header class="top-bar">
  <button class="split-btn {splitActive ? 'active' : ''}" onclick={onToggle}
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
    padding: 8px 12px;
    flex-shrink: 0;
    background: rgba(10, 10, 15, 0.9);
    border-bottom: 1px solid rgba(245, 158, 11, 0.1);
  }
  .app-title {
    font-size: 16px;
    font-weight: 700;
    color: #f59e0b;
    letter-spacing: 1px;
    text-shadow: 0 0 20px rgba(245, 158, 11, 0.2);
  }
  .split-btn, .menu-btn {
    width: 36px;
    height: 36px;
    border: 1px solid rgba(245, 158, 11, 0.18);
    border-radius: 8px;
    background: rgba(245, 158, 11, 0.06);
    color: rgba(245, 158, 11, 0.5);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    position: relative;
  }
  .split-btn:hover, .menu-btn:hover {
    background: rgba(245, 158, 11, 0.12);
    color: rgba(245, 158, 11, 0.85);
    border-color: rgba(245, 158, 11, 0.3);
    box-shadow: 0 0 16px rgba(245, 158, 11, 0.08);
  }
  .split-btn.active {
    color: #f59e0b;
    border-color: rgba(245, 158, 11, 0.4);
    background: rgba(245, 158, 11, 0.1);
    box-shadow: 0 0 16px rgba(245, 158, 11, 0.12);
  }
  .split-indicator {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #f59e0b;
    box-shadow: 0 0 8px rgba(245, 158, 11, 0.7);
  }
</style>
