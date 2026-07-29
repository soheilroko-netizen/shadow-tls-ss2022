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

  function handleBlur() {
    setTimeout(() => open = false, 150)
  }
</script>

<div class="profile-wrap" onblur={handleBlur}>
  <button class="profile-selector" onclick={toggle} class:open>
    <div class="avatar">{(profileName[0] || '?').toUpperCase()}</div>
    <span class="pname">{profileName}</span>
    <svg class="arrow" viewBox="0 0 10 6" fill="currentColor" width="10" height="6">
      <path d="M1 1l4 4 4-4"/>
    </svg>
  </button>
  {#if open}
    <div class="dropdown" transition:slide>
      {#each profiles as p}
        <button class="dropdown-item" class:active={p.name === profileName} onclick={() => select(p.name)}>
          {p.name}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .profile-wrap {
    position: relative;
    width: 100%;
    max-width: 280px;
    z-index: 5;
  }
  .profile-selector {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(20, 20, 30, 0.6);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(245, 158, 11, 0.1);
    border-radius: 10px;
    color: rgba(255,255,255,0.8);
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    transition: all 0.2s;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  }
  .profile-selector:hover, .profile-selector.open {
    border-color: rgba(245, 158, 11, 0.25);
    background: rgba(20, 20, 30, 0.8);
  }
  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: linear-gradient(135deg, #f59e0b, #d97706);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 12px;
    color: #0a0a0f;
    flex-shrink: 0;
  }
  .pname {
    flex: 1;
    text-align: left;
    font-weight: 500;
  }
  .arrow {
    color: rgba(245, 158, 11, 0.3);
    transition: transform 0.2s;
  }
  .open .arrow {
    transform: rotate(180deg);
  }
  .dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: rgba(15, 15, 22, 0.95);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(245, 158, 11, 0.1);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 8px 30px rgba(0,0,0,0.4);
  }
  .dropdown-item {
    width: 100%;
    padding: 10px 14px;
    text-align: left;
    background: none;
    border: none;
    color: rgba(255,255,255,0.65);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.1s;
  }
  .dropdown-item:hover {
    background: rgba(245, 158, 11, 0.08);
    color: #f59e0b;
  }
  .dropdown-item.active {
    color: #f59e0b;
    font-weight: 500;
    background: rgba(245, 158, 11, 0.05);
  }
</style>
