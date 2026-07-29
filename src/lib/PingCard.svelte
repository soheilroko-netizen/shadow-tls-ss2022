<script lang="ts">
  import { onMount } from 'svelte'

  let { pingMs }: { pingMs: number | null } = $props()

  let history = $state<number[]>([])
  const MAX = 60

  let canvas: HTMLCanvasElement
  let ctx: CanvasRenderingContext2D | null = null

  $effect(() => {
    if (pingMs !== null) {
      history = [...history, pingMs]
      if (history.length > MAX) history = history.slice(-MAX)
      draw()
    }
  })

  function draw() {
    if (!canvas || !ctx) return
    const w = canvas.width, h = canvas.height
    ctx.clearRect(0, 0, w, h)
    if (history.length < 2) return

    const max = Math.max(...history, 10)
    ctx.beginPath()
    ctx.strokeStyle = '#f59e0b'
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'

    history.forEach((val, i) => {
      const x = (i / (MAX - 1)) * w
      const y = h - (val / max) * (h - 4) - 2
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.stroke()

    ctx.lineTo(w, h)
    ctx.lineTo(0, h)
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgba(245, 158, 11, 0.15)')
    grad.addColorStop(1, 'rgba(245, 158, 11, 0)')
    ctx.fillStyle = grad
    ctx.fill()
  }

  onMount(() => {
    ctx = canvas?.getContext('2d') ?? null
    draw()
  })
</script>

<div class="ping-card">
  <div class="card-label">PING</div>
  <div class="ping-value">{pingMs !== null ? `${pingMs} ms` : '—'}</div>
  <canvas bind:this={canvas} class="ping-graph" width="140" height="36"></canvas>
</div>

<style>
  .ping-card {
    flex: 1;
    background: rgba(20, 20, 28, 0.85);
    border: 1px solid rgba(245, 158, 11, 0.15);
    border-radius: 12px;
    padding: 12px 14px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.2);
    transition: all 0.2s;
  }
  .ping-card:hover {
    border-color: rgba(245, 158, 11, 0.25);
  }
  .card-label {
    font-size: 9px;
    font-weight: 600;
    color: #f59e0b;
    letter-spacing: 1.5px;
    margin-bottom: 2px;
  }
  .ping-value {
    font-size: 22px;
    font-weight: 400;
    color: #f59e0b;
    font-variant-numeric: tabular-nums;
    margin-bottom: 4px;
  }
  .ping-graph {
    width: 100%;
    height: 36px;
    display: block;
    border-radius: 4px;
  }
</style>
