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
  <div class="data-row">
    <span class="data-arrow up">↑</span>
    <span class="data-val">{fmt(upBytes)}</span>
  </div>
  <div class="data-row">
    <span class="data-arrow down">↓</span>
    <span class="data-val">{fmt(downBytes)}</span>
  </div>
</div>

<style>
  .data-card {
    flex: 1;
    background: rgba(20, 20, 28, 0.85);
    border: 1px solid rgba(245, 158, 11, 0.15);
    border-radius: 12px;
    padding: 12px 14px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.2);
    transition: all 0.2s;
  }
  .data-card:hover {
    border-color: rgba(245, 158, 11, 0.25);
  }
  .card-label {
    font-size: 9px;
    font-weight: 600;
    color: #f59e0b;
    letter-spacing: 1.5px;
    margin-bottom: 6px;
  }
  .data-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }
  .data-arrow {
    font-size: 12px;
    font-weight: 700;
    width: 16px;
    text-align: center;
  }
  .data-arrow.up { color: #f59e0b; }
  .data-arrow.down { color: #d97706; }
  .data-val {
    font-size: 16px;
    font-weight: 400;
    color: rgba(255,255,255,0.95);
    font-variant-numeric: tabular-nums;
  }
</style>
