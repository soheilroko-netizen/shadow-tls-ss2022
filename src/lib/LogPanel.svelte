<script lang="ts">
  let { lines, onClear }: {
    lines: string[]
    onClear: () => void
  } = $props()
</script>

<div class="log-panel">
  <div class="log-header">
    <span class="log-title">EVENT LOG</span>
    <button class="clear-btn" onclick={onClear}>Clear</button>
  </div>
  <div class="log-body">
    {#if lines.length === 0}
      <div class="empty">No events yet</div>
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
    background: rgba(15, 15, 22, 0.35);
    border: 1px solid rgba(245, 158, 11, 0.06);
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 8px;
  }
  .log-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid rgba(245, 158, 11, 0.06);
  }
  .log-title {
    font-size: 10px;
    font-weight: 700;
    color: #fbbf24;
    letter-spacing: 1.5px;
    opacity: 0.8;
  }
  .clear-btn {
    font-size: 10px;
    color: rgba(255,255,255,0.45);
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.1s;
  }
  .clear-btn:hover {
    color: rgba(255,255,255,0.7);
    border-color: rgba(255,255,255,0.15);
  }
  .log-body {
    padding: 6px 12px;
    max-height: 100px;
    overflow-y: auto;
    font-size: 11px;
    font-family: 'Consolas', 'Courier New', monospace;
    color: rgba(255,255,255,0.45);
    line-height: 1.7;
  }
  .log-line {
    border-bottom: 1px solid rgba(255,255,255,0.03);
    padding: 1px 0;
  }
  .empty {
    color: rgba(255,255,255,0.15);
    font-style: italic;
    font-family: inherit;
  }
  .log-body::-webkit-scrollbar { width: 2px; }
  .log-body::-webkit-scrollbar-track { background: transparent; }
  .log-body::-webkit-scrollbar-thumb { background: rgba(245,158,11,0.1); border-radius: 2px; }
</style>
