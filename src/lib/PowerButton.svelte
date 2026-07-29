<script lang="ts">
  let { connected, onClick }: { connected: boolean; onClick: () => void } = $props()
</script>
<button class="pw" class:on={connected} onclick={onClick}>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="28" height="28">
    <circle cx="12" cy="12" r="9"/><path d="M12 4v8"/>
  </svg>
</button>
<style>
  .pw{width:120px;height:120px;border-radius:50%;border:2px solid rgba(255,255,255,0.1);background:linear-gradient(145deg,#14141a,#0e0e14);color:rgba(255,255,255,0.2);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.3s;margin:20px auto}
  .pw:hover{color:#f59e0b;border-color:rgba(245,158,11,0.3);box-shadow:0 0 30px rgba(245,158,11,0.08)}
  .on{color:#f59e0b;border-color:rgba(245,158,11,0.5);box-shadow:0 0 40px rgba(245,158,11,0.15)}
  svg{display:block}
</style>