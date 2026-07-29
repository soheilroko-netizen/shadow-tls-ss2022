<script lang="ts">
  let { lines, onClear }: {
    lines: string[]
    onClear: () => void
  } = $props()
</script>

<div class="log-panel">
  <div class="log-header">
    <span class="log-title">LOG</span>
    <button class="clear-btn" onclick={onClear}>Clear</button>
  </div>
  <div class="log-content">
    {#if lines.length === 0}
      <div class="log-empty">No events yet.</div>
    {:else}
      {#each lines as line}
        <div class="log-line">{line}</div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .log-panel {
    width: 100%;
    max-width: 400px;
    background: rgba(20, 20, 28, 0.8);
    border: 1px solid rgba(245, 158, 11, 0.12);
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 8px;
  }
  .log-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid rgba(245, 158, 11, 0.08);
  }
  .log-title {
    font-size: 9px;
    font-weight: 600;
    color: #f59e0b;
    letter-spacing: 1.5px;
  }
  .clear-btn {
    font-size: 9px;
    color: rgba(255,255,255,0.6);
    background: none;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.1s;
  }
  .clear-btn:hover {
    color: rgba(255,255,255,0.85);
    border-color: rgba(255,255,255,0.25);
  }
  .log-content {
    padding: 6px 12px;
    max-height: 100px;
    overflow-y: auto;
    font-size: 10px;
    font-family: 'Courier New', monospace;
    color: rgba(255,255,255,0.75);
    line-height: 1.6;
  }
  .log-empty {
    color: rgba(255,255,255,0.35);
    font-style: italic;
  }
  .log-line {
    border-bottom: 1px solid rgba(255,255,255,0.04);
    padding: 1px 0;
  }
  .log-content::-webkit-scrollbar { width: 2px; }
  .log-content::-webkit-scrollbar-track { background: transparent; }
  .log-content::-webkit-scrollbar-thumb { background: rgba(245,158,11,0.18); border-radius: 2px; }
</style>
