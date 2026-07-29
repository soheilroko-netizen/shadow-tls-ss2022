<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'

  let { profileName, onSwitch }: {
    profileName: string
    onSwitch: (name: string) => void
  } = $props()

  let open = $state(false)
  let profiles = $state<{ name: string }[]>([])

  async function toggle() {
    if (!open) {
      try {
        const store = await invoke<{ profiles: { name: string }[], active_profile: string }>('get_profiles')
        profiles = store.profiles
      } catch {}
    }
    open = !open
  }

  function select(name: string) {
    open = false
    onSwitch(name)
  }
</script>

<div class="wrap">
  <button class="selector" onclick={toggle} class:open>
    <span class="avatar">{(profileName[0] || '?').toUpperCase()}</span>
    <span class="name">{profileName}</span>
    <svg class="caret" viewBox="0 0 10 6" fill="currentColor" width="10" height="6">
      <path d="M1 1l4 4 4-4"/>
    </svg>
  </button>
  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={() => open = false}></div>
    <div class="dropdown">
      {#each profiles as p}
        <button class="item" class:active={p.name === profileName} onclick={() => select(p.name)}>
          {p.name}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    width: 100%;
    max-width: 280px;
    z-index: 20;
  }
  .selector {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(20, 20, 30, 0.7);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(245, 158, 11, 0.12);
    border-radius: 10px;
    color: rgba(255,255,255,0.85);
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
    transition: all 0.2s;
    box-shadow: 0 2px 10px rgba(0,0,0,0.25);
  }
  .selector:hover, .selector.open {
    border-color: rgba(245, 158, 11, 0.25);
    background: rgba(25, 25, 35, 0.8);
  }
  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: linear-gradient(135deg, #f59e0b, #d97706);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 13px;
    color: #0a0a0f;
    flex-shrink: 0;
  }
  .name {
    flex: 1;
    text-align: left;
    font-weight: 500;
  }
  .caret {
    color: #fbbf24;
    opacity: 0.5;
    transition: transform 0.2s;
  }
  .open .caret { transform: rotate(180deg); }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 18;
    background: transparent;
  }
  .dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 19;
    background: rgba(10, 10, 15, 0.97);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(245, 158, 11, 0.12);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 8px 30px rgba(0,0,0,0.5);
  }
  .item {
    width: 100%;
    padding: 11px 14px;
    text-align: left;
    background: none;
    border: none;
    color: rgba(255,255,255,0.7);
    font-size: 14px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.1s;
  }
  .item:hover {
    background: rgba(245, 158, 11, 0.1);
    color: #fbbf24;
  }
  .item.active {
    color: #fbbf24;
    font-weight: 600;
    background: rgba(245, 158, 11, 0.06);
  }
</style>
