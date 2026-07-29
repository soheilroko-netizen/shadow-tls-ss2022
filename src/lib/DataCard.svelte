<script lang="ts">
  let { upBytes, downBytes }: {
    upBytes: number
    downBytes: number
  } = $props()

  function fmt(b: number): string {
    if (b < 1024) return b + ' B'
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB'
    return (b / 1073741824).toFixed(2) + ' GB'
  }
</script>

<div class="data-card">
  <div class="card-label">DATA USAGE</div>
  <div class="data-body">
    <div class="data-row">
      <span class="arrow up">↑</span>
      <span class="val">{fmt(upBytes)}</span>
    </div>
    <div class="data-row">
      <span class="arrow down">↓</span>
      <span class="val">{fmt(downBytes)}</span>
    </div>
  </div>
</div>

<style>
  .data-card {
    flex: 1;
    background: rgba(20, 20, 30, 0.6);
    border: 1px solid rgba(245, 158, 11, 0.1);
    border-radius: 12px;
    padding: 12px 14px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.2);
  }
  .card-label {
    font-size: 10px;
    font-weight: 700;
    color: #fbbf24;
    letter-spacing: 1.5px;
    margin-bottom: 8px;
    opacity: 0.9;
  }
  .data-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .data-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .arrow {
    font-size: 14px;
    font-weight: 700;
    width: 18px;
    text-align: center;
  }
  .arrow.up { color: #f59e0b; }
  .arrow.down { color: #fbbf24; }
  .val {
    font-size: 18px;
    font-weight: 400;
    color: rgba(255,255,255,0.9);
    font-variant-numeric: tabular-nums;
  }
</style>