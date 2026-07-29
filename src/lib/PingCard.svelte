<script lang="ts">
  let { pingMs }: { pingMs: number | null } = $props()

  let history = $state<number[]>([])
  const MAX = 60
  let canvasEl: HTMLCanvasElement
  let ctx: CanvasRenderingContext2D | null = null

  $effect(() => {
    if (pingMs !== null) {
      history = [...history, pingMs]
      if (history.length > MAX) history = history.slice(-MAX)
      draw()
    }
  })

  function draw() {
    const c = canvasEl?.getContext('2d')
    if (!c) return
    const w = canvasEl.width, h = canvasEl.height
    c.clearRect(0, 0, w, h)
    if (history.length < 2) return
    const max = Math.max(...history, 10)

    c.beginPath()
    c.strokeStyle = '#fbbf24'
    c.lineWidth = 1.8
    c.lineJoin = 'round'
    history.forEach((v, i) => {
      const x = (i / (MAX - 1)) * w
      const y = h - (v / max) * (h - 4) - 2
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)
    })
    c.stroke()

    c.lineTo(w, h)
    c.lineTo(0, h)
    c.closePath()
    const g = c.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, 'rgba(251,191,36,0.12)')
    g.addColorStop(1, 'rgba(251,191,36,0)')
    c.fillStyle = g
    c.fill()
  }
</script>

<div class="ping-card">
  <div class="card-label">PING</div>
  <div class="ping-value">{pingMs !== null ? `${pingMs} ms` : '—'}</div>
  <canvas bind:this={canvasEl} class="graph" width="140" height="36"></canvas>
</div>

<style>
  .ping-card {
    flex: 1;
    background: rgba(20, 20, 30, 0.6);
    backdrop-filter: blur(6px);
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
    margin-bottom: 4px;
    opacity: 0.9;
  }
  .ping-value {
    font-size: 22px;
    font-weight: 400;
    color: #fbbf24;
    font-variant-numeric: tabular-nums;
    margin-bottom: 4px;
    text-shadow: 0 0 6px rgba(251,191,36,0.1);
  }
  .graph {
    width: 100%;
    height: 36px;
    display: block;
    border-radius: 4px;
  }
</style>
