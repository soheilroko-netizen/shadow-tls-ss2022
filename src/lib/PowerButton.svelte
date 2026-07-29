<script lang="ts">
  let { connected, onClick }: {
    connected: boolean
    onClick: () => void
  } = $props()
</script>

<button class="power-wrap" class:connected onclick={onClick}>
  <div class="ring-outer">
    <div class="ring-segment s1"></div>
    <div class="ring-segment s2"></div>
    <div class="ring-segment s3"></div>
    <div class="ring-segment s4"></div>
  </div>
  <div class="ring-inner"></div>
  <div class="power-btn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="26" height="26">
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 4v8"/>
    </svg>
  </div>
  <div class="glow-layer"></div>
</button>

<style>
  /* ── Pure CSS animations (GPU, no JS RAF) ── */
  @keyframes ring-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes glow-pulse {
    0%, 100% { transform: scale(1); opacity: 0.6; }
    50% { transform: scale(1.05); opacity: 1; }
  }
  @keyframes btn-breathe {
    0%, 100% { box-shadow: 0 4px 20px rgba(0,0,0,0.4); }
    50% { box-shadow: 0 4px 28px rgba(245,158,11,0.12); }
  }

  .power-wrap {
    position: relative;
    width: 150px;
    height: 150px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    margin: 8px 0 0;
    transition: transform 0.15s ease-out;
    will-change: transform;
  }
  .power-wrap:hover {
    transform: scale(1.02);
  }
  .ring-outer {
    position: absolute;
    width: 130px;
    height: 130px;
    border-radius: 50%;
    pointer-events: none;
    will-change: transform;
  }
  .connected .ring-outer {
    animation: ring-spin 6s linear infinite;
  }
  .ring-segment {
    position: absolute;
    border-radius: 50%;
    border: 2px solid transparent;
  }
  .s1, .s2, .s3, .s4 { inset: 0; }
  .s1 {
    border-top-color: rgba(255,255,255,0.08);
    border-right: none; border-bottom: none; border-left: none;
  }
  .s2 {
    border-right-color: rgba(255,255,255,0.06);
    border-top: none; border-bottom: none; border-left: none;
  }
  .s3 {
    border-bottom-color: rgba(255,255,255,0.05);
    border-top: none; border-right: none; border-left: none;
  }
  .s4 {
    border-left-color: rgba(255,255,255,0.04);
    border-top: none; border-right: none; border-bottom: none;
  }
  .connected .s1 { border-top-color: rgba(245, 158, 11, 0.55); }
  .connected .s2 { border-right-color: rgba(245, 158, 11, 0.40); }
  .connected .s3 { border-bottom-color: rgba(245, 158, 11, 0.30); }
  .connected .s4 { border-left-color: rgba(245, 158, 11, 0.20); }
  .connected .ring-outer {
    box-shadow: 0 0 35px rgba(245, 158, 11, 0.10);
    filter: drop-shadow(0 0 8px rgba(245,158,11,0.15));
  }
  .ring-inner {
    position: absolute;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.06);
    pointer-events: none;
    transition: all 0.3s;
  }
  .connected .ring-inner {
    border-color: rgba(245, 158, 11, 0.30);
    box-shadow: 0 0 25px rgba(245, 158, 11, 0.10);
    animation: ring-spin 4s linear infinite reverse;
  }
  .power-btn {
    position: relative;
    z-index: 3;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: none;
    background: linear-gradient(145deg, #14141a, #0e0e14);
    color: rgba(255,255,255,0.20);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.25s;
    box-shadow: 0 4px 15px rgba(0,0,0,0.4);
  }
  .power-wrap:hover .power-btn {
    color: rgba(245, 158, 11, 0.7);
    box-shadow: 0 4px 20px rgba(245, 158, 11, 0.08);
  }
  .connected .power-btn {
    color: #f59e0b;
    text-shadow: 0 0 20px rgba(245, 158, 11, 0.25);
    animation: btn-breathe 2s ease-in-out infinite;
  }
  .glow-layer {
    position: absolute;
    width: 100px;
    height: 100px;
    border-radius: 50%;
    pointer-events: none;
    opacity: 0;
    background: radial-gradient(circle, rgba(245, 158, 11, 0.08) 0%, transparent 70%);
    transition: opacity 0.4s;
  }
  .connected .glow-layer {
    opacity: 1;
    animation: glow-pulse 2.5s ease-in-out infinite;
  }
</style>
