import * as THREE from 'three'

export type BeltStyle = 'procedural' | 'perforated' | 'mylar' | 'streaked' | 'plastic' | 'rubber' | 'dimpled' | 'fabric'
export const BELT_STYLES: BeltStyle[] = ['procedural', 'perforated', 'mylar', 'streaked', 'plastic', 'rubber', 'dimpled', 'fabric']

export interface BeltTextureSet {
  map: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
  roughnessMap?: THREE.CanvasTexture
  color: number
  roughness: number
  metalness: number
  normalScale: number
  repeatScale: number // physical units per tile
}

// ---------------- belt ----------------
export function makeBeltTextureSet(style: BeltStyle): BeltTextureSet {
  switch (style) {
    case 'perforated': return perforated()
    case 'mylar':      return mylar()
    case 'streaked':   return streaked()
    case 'plastic':    return plastic()
    case 'rubber':     return rubber()
    case 'dimpled':    return dimpled()
    case 'fabric':     return fabric()
    // procedural is rendered as a ShaderMaterial — caller handles it separately,
    // but we return a plastic-ish set as a fallback if anyone calls this for it.
    case 'procedural': return plastic()
  }
}

function newCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  return { canvas, ctx }
}

function flatNormalCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = newCanvas(w, h)
  c.ctx.fillStyle = 'rgb(128,128,255)'
  c.ctx.fillRect(0, 0, w, h)
  return c
}

function tex(canvas: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}

// ---------------- perforated white plastic ----------------
// uniform base + seamless hex grid (rows/cols divide canvas evenly,
// rows is even so stagger wraps, holes drawn at all 9 wrap positions).
function perforated(): BeltTextureSet {
  return hexHoleBelt({
    cols: 12,
    holeRatio: 0.36,
    base: '#f2ecdb',
    holeRimDark: 'rgba(0,0,0,0.5)',
    holeRimLight: 'rgba(255,255,255,0.55)',
    holeFill: ['#3a3a3c', '#1a1a1c', '#0a0a0c'],
    color: 0xf2ede2,
    roughness: 0.78,
    metalness: 0.05,
    normalScale: 0.6,
    repeatScale: 0.5,
    grime: true,
  })
}

interface HexBeltOpts {
  cols: number
  holeRatio: number
  base: string
  holeRimDark: string
  holeRimLight: string
  holeFill: [string, string, string]
  color: number
  roughness: number
  metalness: number
  normalScale: number
  repeatScale: number
  grime: boolean
}

function hexHoleBelt(opts: HexBeltOpts): BeltTextureSet {
  const W = 2048
  const cellW = W / opts.cols
  // hex aspect: sqrt(3)/2 ≈ 0.866
  let rows = Math.round(W / (cellW * 0.866))
  if (rows % 2) rows++ // even ensures stagger wraps
  const H = Math.round(rows * cellW * 0.866 / 2) * 2 // even & integer
  const cellH = H / rows
  const radius = cellW * opts.holeRatio

  const { canvas: cAlb, ctx } = newCanvas(W, H)
  ctx.fillStyle = opts.base
  ctx.fillRect(0, 0, W, H)

  // fine surface speckle for plastic look
  const id0 = ctx.getImageData(0, 0, W, H)
  for (let i = 0; i < id0.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 12
    id0.data[i] = clamp255(id0.data[i] + n)
    id0.data[i + 1] = clamp255(id0.data[i + 1] + n)
    id0.data[i + 2] = clamp255(id0.data[i + 2] + n)
  }
  ctx.putImageData(id0, 0, 0)

  // grime stains, wrap-drawn
  if (opts.grime) {
    for (let i = 0; i < 140; i++) {
      const x = Math.random() * W
      const y = Math.random() * H
      const r = 12 + Math.random() * 90
      const a = 0.03 + Math.random() * 0.12
      const tone = Math.random() < 0.7 ? '80,60,40' : '60,40,25'
      drawWrapped(W, H, x, y, r, (sx, sy) => {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
        g.addColorStop(0, `rgba(${tone},${a})`)
        g.addColorStop(1, `rgba(${tone},0)`)
        ctx.fillStyle = g
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2)
      })
    }
    // long thin scratches
    ctx.globalAlpha = 0.12
    ctx.strokeStyle = '#3a2f25'
    ctx.lineWidth = 1
    for (let i = 0; i < 50; i++) {
      const y = Math.random() * H
      const x = Math.random() * W
      const len = 80 + Math.random() * 350
      const dy = (Math.random() - 0.5) * 8
      for (const dx of [-W, 0, W]) {
        if (x + dx + len < 0 || x + dx > W) continue
        ctx.beginPath()
        ctx.moveTo(x + dx, y)
        ctx.lineTo(x + dx + len, y + dy)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }

  // ambient occlusion ring around each hole — adds depth
  for (let row = 0; row < rows; row++) {
    const stagger = row % 2 === 0 ? 0 : cellW * 0.5
    for (let col = 0; col < opts.cols; col++) {
      const cx = col * cellW + stagger + cellW * 0.5
      const cy = row * cellH + cellH * 0.5
      drawWrapped(W, H, cx, cy, radius * 1.7, (sx, sy) => {
        const ao = ctx.createRadialGradient(sx, sy, radius * 0.95, sx, sy, radius * 1.6)
        ao.addColorStop(0, 'rgba(40,30,20,0.28)')
        ao.addColorStop(1, 'rgba(40,30,20,0)')
        ctx.fillStyle = ao
        ctx.fillRect(sx - radius * 1.7, sy - radius * 1.7, radius * 3.4, radius * 3.4)
      })
    }
  }

  // holes
  for (let row = 0; row < rows; row++) {
    const stagger = row % 2 === 0 ? 0 : cellW * 0.5
    for (let col = 0; col < opts.cols; col++) {
      const cx = col * cellW + stagger + cellW * 0.5
      const cy = row * cellH + cellH * 0.5
      drawWrapped(W, H, cx, cy, radius + 4, (sx, sy) => {
        drawHoleAt(ctx, sx, sy, radius, opts.holeFill, opts.holeRimLight, opts.holeRimDark)
      })
    }
  }

  // normal map — bevel around each hole
  const { canvas: cNorm, ctx: nctx } = flatNormalCanvas(W, H)
  for (let row = 0; row < rows; row++) {
    const stagger = row % 2 === 0 ? 0 : cellW * 0.5
    for (let col = 0; col < opts.cols; col++) {
      const cx = col * cellW + stagger + cellW * 0.5
      const cy = row * cellH + cellH * 0.5
      drawWrapped(W, H, cx, cy, radius + 6, (sx, sy) => {
        nctx.strokeStyle = 'rgb(60,60,200)'
        nctx.lineWidth = 5
        nctx.beginPath()
        nctx.arc(sx, sy, radius + 1, Math.PI * 0.9, Math.PI * 1.6)
        nctx.stroke()
        nctx.strokeStyle = 'rgb(200,200,200)'
        nctx.beginPath()
        nctx.arc(sx, sy, radius + 1, -Math.PI * 0.1, Math.PI * 0.6)
        nctx.stroke()
      })
    }
  }

  // roughness map: holes (and dirt) = high rough; surface = medium
  const { canvas: cRough, ctx: rctx } = newCanvas(W, H)
  rctx.fillStyle = '#cccccc' // ~0.8 roughness
  rctx.fillRect(0, 0, W, H)
  for (let row = 0; row < rows; row++) {
    const stagger = row % 2 === 0 ? 0 : cellW * 0.5
    for (let col = 0; col < opts.cols; col++) {
      const cx = col * cellW + stagger + cellW * 0.5
      const cy = row * cellH + cellH * 0.5
      drawWrapped(W, H, cx, cy, radius + 1, (sx, sy) => {
        rctx.fillStyle = '#ffffff' // 1.0 inside holes
        rctx.beginPath()
        rctx.arc(sx, sy, radius, 0, Math.PI * 2)
        rctx.fill()
      })
    }
  }

  return {
    map: tex(cAlb),
    normalMap: tex(cNorm, false),
    roughnessMap: tex(cRough, false),
    color: opts.color,
    roughness: opts.roughness,
    metalness: opts.metalness,
    normalScale: opts.normalScale,
    repeatScale: opts.repeatScale,
  }
}

// invoke fn at primary + 8 wrapped positions (only when within reach of edge)
function drawWrapped(W: number, H: number, x: number, y: number, r: number, fn: (sx: number, sy: number) => void): void {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const sx = x + dx * W
      const sy = y + dy * H
      if (sx + r < 0 || sx - r > W || sy + r < 0 || sy - r > H) continue
      fn(sx, sy)
    }
  }
}

function drawHoleAt(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fill: [string, string, string],
  rimLight: string,
  rimDark: string,
): void {
  const g = ctx.createRadialGradient(cx, cy - r * 0.2, r * 0.2, cx, cy, r)
  g.addColorStop(0, fill[0])
  g.addColorStop(0.6, fill[1])
  g.addColorStop(1, fill[2])
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = rimLight
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(cx, cy, r + 0.5, Math.PI * 0.9, Math.PI * 1.6)
  ctx.stroke()
  ctx.strokeStyle = rimDark
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(cx, cy, r + 0.5, -Math.PI * 0.1, Math.PI * 0.6)
  ctx.stroke()
}

// ---------------- mylar (shiny silver) ----------------
function mylar(): BeltTextureSet {
  const W = 1536, H = 1536
  const { canvas: cAlb, ctx } = newCanvas(W, H)

  // base brushed silver gradient
  const grad = ctx.createLinearGradient(0, 0, W, 0)
  grad.addColorStop(0, '#c8cdd4')
  grad.addColorStop(0.5, '#dde2e8')
  grad.addColorStop(1, '#b8bdc4')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // horizontal scratches (wrap horizontally so seams don't cut them)
  ctx.globalAlpha = 0.18
  for (let i = 0; i < 800; i++) {
    const y = Math.random() * H
    const x = Math.random() * W
    const len = 30 + Math.random() * 200
    const jitter = (Math.random() - 0.5) * 1.5
    ctx.strokeStyle = Math.random() < 0.5 ? '#9aa0a8' : '#eef2f5'
    ctx.lineWidth = 0.5 + Math.random() * 0.6
    for (const dx of [-W, 0, W]) {
      if (x + dx + len < 0 || x + dx > W) continue
      ctx.beginPath()
      ctx.moveTo(x + dx, y)
      ctx.lineTo(x + dx + len, y + jitter)
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1

  // smudges
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const r = 40 + Math.random() * 120
    const a = 0.05 + Math.random() * 0.08
    drawWrapped(W, H, x, y, r, (sx, sy) => {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
      g.addColorStop(0, `rgba(80,90,100,${a})`)
      g.addColorStop(1, 'rgba(80,90,100,0)')
      ctx.fillStyle = g
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2)
    })
  }

  // normal: faint horizontal scratch bumps (wrap)
  const { canvas: cNorm, ctx: nctx } = flatNormalCanvas(W, H)
  for (let i = 0; i < 600; i++) {
    const y = Math.random() * H
    const x = Math.random() * W
    const len = 20 + Math.random() * 150
    nctx.strokeStyle = Math.random() < 0.5 ? 'rgb(110,128,255)' : 'rgb(146,128,255)'
    nctx.lineWidth = 0.5 + Math.random() * 0.5
    nctx.globalAlpha = 0.5 + Math.random() * 0.4
    for (const dx of [-W, 0, W]) {
      if (x + dx + len < 0 || x + dx > W) continue
      nctx.beginPath()
      nctx.moveTo(x + dx, y)
      nctx.lineTo(x + dx + len, y)
      nctx.stroke()
    }
  }
  nctx.globalAlpha = 1

  return {
    map: tex(cAlb),
    normalMap: tex(cNorm, false),
    color: 0xffffff,
    roughness: 0.32,
    metalness: 0.85,
    normalScale: 0.25,
    repeatScale: 1.2,
  }
}

// ---------------- vertical streaks (industrial belt) ----------------
function streaked(): BeltTextureSet {
  const W = 1024, H = 2048
  const { canvas: cAlb, ctx } = newCanvas(W, H)

  ctx.fillStyle = '#3b3a36'
  ctx.fillRect(0, 0, W, H)

  // vertical streaks
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * W
    const w = 2 + Math.random() * 24
    ctx.globalAlpha = 0.25 + Math.random() * 0.5
    ctx.fillStyle = Math.random() < 0.5 ? '#1f1e1c' : '#5a574e'
    ctx.fillRect(x, 0, w, H)
  }
  ctx.globalAlpha = 1

  // grime patches (wrap)
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const r = 30 + Math.random() * 100
    const a = 0.2 + Math.random() * 0.2
    drawWrapped(W, H, x, y, r, (sx, sy) => {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
      g.addColorStop(0, `rgba(20,15,10,${a})`)
      g.addColorStop(1, 'rgba(20,15,10,0)')
      ctx.fillStyle = g
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2)
    })
  }

  // noise
  const id = ctx.getImageData(0, 0, W, H)
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22
    id.data[i] = clamp255(id.data[i] + n)
    id.data[i + 1] = clamp255(id.data[i + 1] + n)
    id.data[i + 2] = clamp255(id.data[i + 2] + n)
  }
  ctx.putImageData(id, 0, 0)

  // normal: derive vertical streak bumps
  const { canvas: cNorm, ctx: nctx } = flatNormalCanvas(W, H)
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * W
    const w = 1 + Math.random() * 6
    const isLeft = Math.random() < 0.5
    nctx.fillStyle = isLeft ? 'rgb(80,128,240)' : 'rgb(176,128,240)'
    nctx.globalAlpha = 0.5 + Math.random() * 0.4
    nctx.fillRect(x, 0, w, H)
  }
  nctx.globalAlpha = 1

  return {
    map: tex(cAlb),
    normalMap: tex(cNorm, false),
    color: 0xffffff,
    roughness: 0.7,
    metalness: 0.4,
    normalScale: 0.6,
    repeatScale: 0.6,
  }
}

// ---------------- smooth white plastic ----------------
function plastic(): BeltTextureSet {
  const W = 1024, H = 1024
  const { canvas: cAlb, ctx } = newCanvas(W, H)
  ctx.fillStyle = '#f0ebde'
  ctx.fillRect(0, 0, W, H)

  // very subtle mottling (wrap)
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const r = 60 + Math.random() * 180
    const a = 0.03 + Math.random() * 0.05
    drawWrapped(W, H, x, y, r, (sx, sy) => {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
      g.addColorStop(0, `rgba(180,170,150,${a})`)
      g.addColorStop(1, 'rgba(180,170,150,0)')
      ctx.fillStyle = g
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2)
    })
  }

  // light grain noise
  const id = ctx.getImageData(0, 0, W, H)
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 8
    id.data[i] = clamp255(id.data[i] + n)
    id.data[i + 1] = clamp255(id.data[i + 1] + n)
    id.data[i + 2] = clamp255(id.data[i + 2] + n)
  }
  ctx.putImageData(id, 0, 0)

  const { canvas: cNorm } = flatNormalCanvas(W, H)
  return {
    map: tex(cAlb),
    normalMap: tex(cNorm, false),
    color: 0xffffff,
    roughness: 0.55,
    metalness: 0.0,
    normalScale: 0.05,
    repeatScale: 1.0,
  }
}

// ---------------- rubber (matte black) ----------------
function rubber(): BeltTextureSet {
  const W = 1024, H = 1024
  const { canvas: cAlb, ctx } = newCanvas(W, H)
  ctx.fillStyle = '#1c1c1e'
  ctx.fillRect(0, 0, W, H)

  // tiny grit speckles
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * W, y = Math.random() * H
    const v = 30 + Math.random() * 40
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.globalAlpha = 0.3 + Math.random() * 0.6
    ctx.fillRect(x, y, 1, 1)
  }
  ctx.globalAlpha = 1

  // dust stripes
  for (let i = 0; i < 10; i++) {
    const y = Math.random() * H, r = 60 + Math.random() * 200
    const g = ctx.createRadialGradient(W / 2, y, 0, W / 2, y, r)
    g.addColorStop(0, 'rgba(120,110,90,0.05)')
    g.addColorStop(1, 'rgba(120,110,90,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, y - r, W, r * 2)
  }

  // normal: tiny noise bumps
  const { canvas: cNorm, ctx: nctx } = flatNormalCanvas(W, H)
  const nid = nctx.getImageData(0, 0, W, H)
  for (let i = 0; i < nid.data.length; i += 4) {
    const dr = (Math.random() - 0.5) * 30
    const dg = (Math.random() - 0.5) * 30
    nid.data[i] = clamp255(128 + dr)
    nid.data[i + 1] = clamp255(128 + dg)
    nid.data[i + 2] = 255
  }
  nctx.putImageData(nid, 0, 0)

  return {
    map: tex(cAlb),
    normalMap: tex(cNorm, false),
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.0,
    normalScale: 0.4,
    repeatScale: 0.4,
  }
}

// ---------------- dimpled (white plastic raised bumps, seamless hex grid) ----------------
function dimpled(): BeltTextureSet {
  const W = 1024
  const cols = 10
  const cellW = W / cols
  let rows = Math.round(W / (cellW * 0.866))
  if (rows % 2) rows++
  const H = Math.round(rows * cellW * 0.866 / 2) * 2
  const cellH = H / rows
  const radius = cellW * 0.32

  const { canvas: cAlb, ctx } = newCanvas(W, H)
  ctx.fillStyle = '#ece4d2'
  ctx.fillRect(0, 0, W, H)

  for (let row = 0; row < rows; row++) {
    const stagger = row % 2 === 0 ? 0 : cellW * 0.5
    for (let col = 0; col < cols; col++) {
      const cx = col * cellW + stagger + cellW * 0.5
      const cy = row * cellH + cellH * 0.5
      drawWrapped(W, H, cx, cy, radius + 2, (sx, sy) => {
        const g = ctx.createRadialGradient(sx - radius * 0.3, sy - radius * 0.3, radius * 0.1, sx, sy, radius)
        g.addColorStop(0, 'rgba(255,250,240,0.9)')
        g.addColorStop(0.7, 'rgba(180,170,150,0.2)')
        g.addColorStop(1, 'rgba(60,50,40,0.4)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(sx, sy, radius, 0, Math.PI * 2)
        ctx.fill()
      })
    }
  }

  const { canvas: cNorm, ctx: nctx } = flatNormalCanvas(W, H)
  for (let row = 0; row < rows; row++) {
    const stagger = row % 2 === 0 ? 0 : cellW * 0.5
    for (let col = 0; col < cols; col++) {
      const cx = col * cellW + stagger + cellW * 0.5
      const cy = row * cellH + cellH * 0.5
      drawWrapped(W, H, cx, cy, radius + 4, (sx, sy) => {
        nctx.strokeStyle = 'rgb(200,200,255)'
        nctx.lineWidth = 4
        nctx.beginPath()
        nctx.arc(sx, sy, radius, Math.PI * 0.9, Math.PI * 1.6)
        nctx.stroke()
        nctx.strokeStyle = 'rgb(60,60,255)'
        nctx.beginPath()
        nctx.arc(sx, sy, radius, -Math.PI * 0.1, Math.PI * 0.6)
        nctx.stroke()
      })
    }
  }

  return {
    map: tex(cAlb),
    normalMap: tex(cNorm, false),
    color: 0xfff8e8,
    roughness: 0.6,
    metalness: 0.05,
    normalScale: 0.55,
    repeatScale: 0.5,
  }
}

// ---------------- fabric (fine off-white woven belt) ----------------
function fabric(): BeltTextureSet {
  const W = 1024, H = 1024
  const period = 4 // tight weave
  const { canvas: cAlb, ctx } = newCanvas(W, H)

  // off-white base matching perforated belt tone
  ctx.fillStyle = '#ede4d0'
  ctx.fillRect(0, 0, W, H)

  // weave cells — each cell is one thread crossing
  for (let y = 0; y < H; y += period) {
    for (let x = 0; x < W; x += period) {
      const overUnder = (((x / period) | 0) + ((y / period) | 0)) & 1
      const horizFront = overUnder === 0
      const v = 0.92 + Math.random() * 0.08
      // base cell shade (recessed thread)
      ctx.fillStyle = `rgba(214,200,176,${0.6 * v})`
      ctx.fillRect(x, y, period, period)

      // the "on top" thread: brighter rounded gradient
      if (horizFront) {
        const g = ctx.createLinearGradient(x, y, x, y + period)
        g.addColorStop(0,   '#c8baa0')
        g.addColorStop(0.5, '#f5ecd6')
        g.addColorStop(1,   '#c8baa0')
        ctx.fillStyle = g
        ctx.fillRect(x, y, period, period)
      } else {
        const g = ctx.createLinearGradient(x, y, x + period, y)
        g.addColorStop(0,   '#c8baa0')
        g.addColorStop(0.5, '#f5ecd6')
        g.addColorStop(1,   '#c8baa0')
        ctx.fillStyle = g
        ctx.fillRect(x, y, period, period)
      }
    }
  }

  // light grime — sparse, soft, off-white drift
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const r = 30 + Math.random() * 120
    const a = 0.03 + Math.random() * 0.08
    drawWrapped(W, H, x, y, r, (sx, sy) => {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
      g.addColorStop(0, `rgba(140,110,70,${a})`)
      g.addColorStop(1, 'rgba(140,110,70,0)')
      ctx.fillStyle = g
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2)
    })
  }

  // very fine lint specks
  for (let i = 0; i < 600; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    ctx.fillStyle = `rgba(245,238,222,${0.25 + Math.random() * 0.3})`
    ctx.fillRect(x, y, 1, 1)
  }

  // gentle noise
  const id = ctx.getImageData(0, 0, W, H)
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 6
    id.data[i] = clamp255(id.data[i] + n)
    id.data[i + 1] = clamp255(id.data[i + 1] + n)
    id.data[i + 2] = clamp255(id.data[i + 2] + n)
  }
  ctx.putImageData(id, 0, 0)

  // normal map: per-cell directional bump along the thread direction
  const { canvas: cNorm, ctx: nctx } = flatNormalCanvas(W, H)
  for (let y = 0; y < H; y += period) {
    for (let x = 0; x < W; x += period) {
      const overUnder = (((x / period) | 0) + ((y / period) | 0)) & 1
      const horizFront = overUnder === 0
      if (horizFront) {
        const g = nctx.createLinearGradient(x, y, x, y + period)
        g.addColorStop(0,   'rgb(128, 70, 240)')
        g.addColorStop(0.5, 'rgb(128, 128, 255)')
        g.addColorStop(1,   'rgb(128, 186, 240)')
        nctx.fillStyle = g
        nctx.fillRect(x, y, period, period)
      } else {
        const g = nctx.createLinearGradient(x, y, x + period, y)
        g.addColorStop(0,   'rgb(70, 128, 240)')
        g.addColorStop(0.5, 'rgb(128, 128, 255)')
        g.addColorStop(1,   'rgb(186, 128, 240)')
        nctx.fillStyle = g
        nctx.fillRect(x, y, period, period)
      }
    }
  }

  // roughness map: weave is fairly rough, grime spots even rougher
  const { canvas: cRough, ctx: rctx } = newCanvas(W, H)
  rctx.fillStyle = '#c8c8c8'
  rctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const r = 30 + Math.random() * 120
    drawWrapped(W, H, x, y, r, (sx, sy) => {
      const g = rctx.createRadialGradient(sx, sy, 0, sx, sy, r)
      g.addColorStop(0, 'rgba(255,255,255,0.4)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      rctx.fillStyle = g
      rctx.fillRect(sx - r, sy - r, r * 2, r * 2)
    })
  }

  return {
    map: tex(cAlb),
    normalMap: tex(cNorm, false),
    roughnessMap: tex(cRough, false),
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.0,
    normalScale: 0.45,
    repeatScale: 0.25,
  }
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, v))
}

// ---------------- walls ----------------
export type WallStyle =
  | 'galvanized'
  | 'smooth-plastic'
  | 'ribbed-plastic'
  | 'brushed-metal'
  | 'painted-metal'
export const WALL_STYLES: WallStyle[] = [
  'galvanized',
  'smooth-plastic',
  'ribbed-plastic',
  'brushed-metal',
  'painted-metal',
]

export interface WallTextureSet {
  map: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
  roughnessMap?: THREE.CanvasTexture
  color: number
  roughness: number
  metalness: number
  normalScale: number
  repeatScale: number
}

export function makeWallTextureSet(style: WallStyle): WallTextureSet {
  switch (style) {
    case 'galvanized':     return galvanized()
    case 'smooth-plastic': return smoothPlasticWall()
    case 'ribbed-plastic': return ribbedPlasticWall()
    case 'brushed-metal':  return brushedMetalWall()
    case 'painted-metal':  return paintedMetalWall()
  }
}

function galvanized(): WallTextureSet {
  const W = 1024, H = 1024
  const { canvas, ctx } = newCanvas(W, H)
  ctx.fillStyle = '#b8bcc2'
  ctx.fillRect(0, 0, W, H)

  // spangled crystalline pattern (galvanized "spangles")
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const r = 30 + Math.random() * 80
    drawWrapped(W, H, x, y, r, (sx, sy) => {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
      const tone = 0.65 + Math.random() * 0.35
      g.addColorStop(0,   `rgba(200,210,220,${0.18 * tone})`)
      g.addColorStop(0.6, `rgba(80,85,92,${0.08 * tone})`)
      g.addColorStop(1,   'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2)
    })
  }

  // streaks of tarnish & scratches
  ctx.globalAlpha = 0.18
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * W
    ctx.fillStyle = Math.random() < 0.5 ? '#3a3d42' : '#cbd0d6'
    ctx.fillRect(x, 0, 1 + Math.random() * 3, H)
  }
  ctx.globalAlpha = 1

  // rust spots
  for (let i = 0; i < 25; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const r = 4 + Math.random() * 22
    drawWrapped(W, H, x, y, r, (sx, sy) => {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
      g.addColorStop(0, `rgba(120,60,20,${0.35 + Math.random() * 0.3})`)
      g.addColorStop(1, 'rgba(120,60,20,0)')
      ctx.fillStyle = g
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2)
    })
  }

  // pixel noise
  const id = ctx.getImageData(0, 0, W, H)
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22
    id.data[i] = clamp255(id.data[i] + n)
    id.data[i + 1] = clamp255(id.data[i + 1] + n)
    id.data[i + 2] = clamp255(id.data[i + 2] + n)
  }
  ctx.putImageData(id, 0, 0)

  // normal: faint vertical streak bumps
  const { canvas: cNorm, ctx: nctx } = flatNormalCanvas(W, H)
  nctx.globalAlpha = 0.5
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * W
    nctx.fillStyle = Math.random() < 0.5 ? 'rgb(80,128,255)' : 'rgb(176,128,255)'
    nctx.fillRect(x, 0, 1 + Math.random() * 3, H)
  }
  nctx.globalAlpha = 1

  return {
    map: tex(canvas),
    normalMap: tex(cNorm, false),
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0.45,
    normalScale: 0.25,
    repeatScale: 0.5,
  }
}

function smoothPlasticWall(): WallTextureSet {
  const W = 1024, H = 1024
  const { canvas, ctx } = newCanvas(W, H)
  ctx.fillStyle = '#ededee'
  ctx.fillRect(0, 0, W, H)
  // soft mottling
  for (let i = 0; i < 24; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const r = 80 + Math.random() * 220
    const a = 0.03 + Math.random() * 0.06
    drawWrapped(W, H, x, y, r, (sx, sy) => {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
      g.addColorStop(0, `rgba(160,160,170,${a})`)
      g.addColorStop(1, 'rgba(160,160,170,0)')
      ctx.fillStyle = g
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2)
    })
  }
  // dust streaks
  ctx.globalAlpha = 0.06
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * W
    ctx.fillStyle = '#888'
    ctx.fillRect(x, 0, 1 + Math.random() * 2, H)
  }
  ctx.globalAlpha = 1
  // pixel noise
  const id = ctx.getImageData(0, 0, W, H)
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 8
    id.data[i] = clamp255(id.data[i] + n)
    id.data[i + 1] = clamp255(id.data[i + 1] + n)
    id.data[i + 2] = clamp255(id.data[i + 2] + n)
  }
  ctx.putImageData(id, 0, 0)
  const { canvas: cNorm } = flatNormalCanvas(W, H)
  return {
    map: tex(canvas),
    normalMap: tex(cNorm, false),
    color: 0xffffff,
    roughness: 0.45,
    metalness: 0.0,
    normalScale: 0.05,
    repeatScale: 1.0,
  }
}

function ribbedPlasticWall(): WallTextureSet {
  const W = 512, H = 1024
  // vertical ribs: period chosen so pattern wraps both axes
  const ribCount = 16
  const period = W / ribCount
  const { canvas, ctx } = newCanvas(W, H)

  // base
  ctx.fillStyle = '#dedfe1'
  ctx.fillRect(0, 0, W, H)

  // each rib: rounded gradient (light center, dark edges)
  for (let i = 0; i < ribCount; i++) {
    const x0 = i * period
    const g = ctx.createLinearGradient(x0, 0, x0 + period, 0)
    g.addColorStop(0,   '#9fa1a4')
    g.addColorStop(0.15, '#cdd0d4')
    g.addColorStop(0.5, '#eef0f3')
    g.addColorStop(0.85, '#cdd0d4')
    g.addColorStop(1,   '#9fa1a4')
    ctx.fillStyle = g
    ctx.fillRect(x0, 0, period, H)
  }

  // grime running down ribs
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const len = 30 + Math.random() * 200
    ctx.globalAlpha = 0.04 + Math.random() * 0.08
    ctx.fillStyle = '#3a2f25'
    ctx.fillRect(x, y, 1, len)
  }
  ctx.globalAlpha = 1

  // light pixel noise
  const id = ctx.getImageData(0, 0, W, H)
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10
    id.data[i] = clamp255(id.data[i] + n)
    id.data[i + 1] = clamp255(id.data[i + 1] + n)
    id.data[i + 2] = clamp255(id.data[i + 2] + n)
  }
  ctx.putImageData(id, 0, 0)

  // normal: per-rib bump (round profile in x)
  const { canvas: cNorm, ctx: nctx } = flatNormalCanvas(W, H)
  for (let i = 0; i < ribCount; i++) {
    const x0 = i * period
    const g = nctx.createLinearGradient(x0, 0, x0 + period, 0)
    g.addColorStop(0,   'rgb(40,128,240)')
    g.addColorStop(0.5, 'rgb(128,128,255)')
    g.addColorStop(1,   'rgb(216,128,240)')
    nctx.fillStyle = g
    nctx.fillRect(x0, 0, period, H)
  }
  return {
    map: tex(canvas),
    normalMap: tex(cNorm, false),
    color: 0xffffff,
    roughness: 0.4,
    metalness: 0.0,
    normalScale: 0.9,
    repeatScale: 0.3,
  }
}

function brushedMetalWall(): WallTextureSet {
  const W = 1024, H = 1024
  const { canvas, ctx } = newCanvas(W, H)

  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#c8ccd2')
  grad.addColorStop(0.5, '#d8dce2')
  grad.addColorStop(1, '#b0b4ba')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // horizontal brush scratches (wrap)
  ctx.globalAlpha = 0.18
  for (let i = 0; i < 1200; i++) {
    const y = Math.random() * H
    const x = Math.random() * W
    const len = 30 + Math.random() * 220
    const dy = (Math.random() - 0.5) * 1.2
    ctx.strokeStyle = Math.random() < 0.5 ? '#7a7e84' : '#dde1e6'
    ctx.lineWidth = 0.5 + Math.random() * 0.6
    for (const dx of [-W, 0, W]) {
      if (x + dx + len < 0 || x + dx > W) continue
      ctx.beginPath()
      ctx.moveTo(x + dx, y)
      ctx.lineTo(x + dx + len, y + dy)
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1

  // smudges
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const r = 40 + Math.random() * 130
    const a = 0.05 + Math.random() * 0.07
    drawWrapped(W, H, x, y, r, (sx, sy) => {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
      g.addColorStop(0, `rgba(60,70,80,${a})`)
      g.addColorStop(1, 'rgba(60,70,80,0)')
      ctx.fillStyle = g
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2)
    })
  }

  // normal: subtle horizontal scratch bumps
  const { canvas: cNorm, ctx: nctx } = flatNormalCanvas(W, H)
  for (let i = 0; i < 800; i++) {
    const y = Math.random() * H
    const x = Math.random() * W
    const len = 30 + Math.random() * 200
    nctx.strokeStyle = Math.random() < 0.5 ? 'rgb(120,120,255)' : 'rgb(140,140,255)'
    nctx.lineWidth = 0.5 + Math.random() * 0.4
    nctx.globalAlpha = 0.4 + Math.random() * 0.4
    for (const dx of [-W, 0, W]) {
      if (x + dx + len < 0 || x + dx > W) continue
      nctx.beginPath()
      nctx.moveTo(x + dx, y)
      nctx.lineTo(x + dx + len, y)
      nctx.stroke()
    }
  }
  nctx.globalAlpha = 1

  return {
    map: tex(canvas),
    normalMap: tex(cNorm, false),
    color: 0xffffff,
    roughness: 0.32,
    metalness: 0.6,
    normalScale: 0.2,
    repeatScale: 0.6,
  }
}

function paintedMetalWall(): WallTextureSet {
  const W = 1024, H = 1024
  const { canvas, ctx } = newCanvas(W, H)

  // base paint coat (tinted by material color)
  ctx.fillStyle = '#dadcde'
  ctx.fillRect(0, 0, W, H)

  // chips: irregular blobs revealing darker metal underneath
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const r = 4 + Math.random() * 30
    drawWrapped(W, H, x, y, r, (sx, sy) => {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
      g.addColorStop(0, 'rgba(58,58,62,0.85)')
      g.addColorStop(0.7, 'rgba(58,58,62,0.5)')
      g.addColorStop(1, 'rgba(58,58,62,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(sx, sy, r * 0.8 + Math.random() * r * 0.2, 0, Math.PI * 2)
      ctx.fill()
    })
  }

  // wear scratches around chips
  ctx.globalAlpha = 0.16
  ctx.strokeStyle = '#3a3a3e'
  ctx.lineWidth = 1
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const len = 8 + Math.random() * 50
    const ang = Math.random() * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // dust streaks
  ctx.globalAlpha = 0.05
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * W
    ctx.fillStyle = '#222'
    ctx.fillRect(x, 0, 1 + Math.random() * 3, H)
  }
  ctx.globalAlpha = 1

  // soft pixel noise
  const id = ctx.getImageData(0, 0, W, H)
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10
    id.data[i] = clamp255(id.data[i] + n)
    id.data[i + 1] = clamp255(id.data[i + 1] + n)
    id.data[i + 2] = clamp255(id.data[i + 2] + n)
  }
  ctx.putImageData(id, 0, 0)

  // roughness: chips rougher than paint (paint smoother → looks shinier)
  const { canvas: cRough, ctx: rctx } = newCanvas(W, H)
  rctx.fillStyle = '#999999' // ~0.6
  rctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const r = 4 + Math.random() * 30
    drawWrapped(W, H, x, y, r, (sx, sy) => {
      const g = rctx.createRadialGradient(sx, sy, 0, sx, sy, r)
      g.addColorStop(0, 'rgba(255,255,255,0.7)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      rctx.fillStyle = g
      rctx.fillRect(sx - r, sy - r, r * 2, r * 2)
    })
  }

  const { canvas: cNorm } = flatNormalCanvas(W, H)
  return {
    map: tex(canvas),
    normalMap: tex(cNorm, false),
    roughnessMap: tex(cRough, false),
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0.25,
    normalScale: 0.1,
    repeatScale: 0.7,
  }
}

// ---------------- egg shell variants ----------------
// generate N variants of subtle eggshell texture (speckles, mottling, optional grime).
// dirtyMin/Max: 0 = pristine, 1 = heavily soiled. variants linearly interpolated.
export function makeEggShellVariants(
  count = 8,
  size = 256,
  dirtyMin = 0,
  dirtyMax = 0,
): THREE.CanvasTexture[] {
  const out: THREE.CanvasTexture[] = []
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0
    const dirt = dirtyMin + (dirtyMax - dirtyMin) * t
    out.push(makeEggShell(size, i, dirt))
  }
  return out
}

function makeEggShell(size: number, seed: number, dirt = 0): THREE.CanvasTexture {
  const { canvas, ctx } = newCanvas(size, size)
  // base off-white
  const baseHues = ['#f6efe1', '#f2e8d4', '#fbf5e8', '#efe5d0', '#e8dec8', '#f4ebd8']
  ctx.fillStyle = baseHues[seed % baseHues.length]
  ctx.fillRect(0, 0, size, size)

  // soft mottling
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 20 + Math.random() * 60
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const tint = Math.random() < 0.5 ? '170,150,120' : '210,195,170'
    g.addColorStop(0, `rgba(${tint},${0.04 + Math.random() * 0.08})`)
    g.addColorStop(1, `rgba(${tint},0)`)
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  // tiny brown speckles
  const speckCount = 60 + Math.floor(Math.random() * 60)
  for (let i = 0; i < speckCount; i++) {
    const x = Math.random() * size, y = Math.random() * size
    const r = 0.5 + Math.random() * 1.4
    const a = 0.15 + Math.random() * 0.45
    ctx.fillStyle = `rgba(${90 + Math.random() * 40},${60 + Math.random() * 30},${40 + Math.random() * 20},${a})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // micro pores (very fine darker dots)
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * size, y = Math.random() * size
    ctx.fillStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.08})`
    ctx.fillRect(x, y, 1, 1)
  }

  // dirt overlay — mud blobs, smears, dark patches
  if (dirt > 0) {
    // soft brown mud patches
    const blobCount = Math.floor(3 + dirt * 14)
    for (let i = 0; i < blobCount; i++) {
      const x = Math.random() * size
      const y = Math.random() * size
      const r = (8 + Math.random() * 35) * (0.6 + dirt * 0.8)
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      const a = (0.18 + Math.random() * 0.35) * dirt
      const tone = Math.random() < 0.5 ? '70,48,28' : '95,70,45'
      g.addColorStop(0, `rgba(${tone},${a})`)
      g.addColorStop(0.7, `rgba(${tone},${a * 0.4})`)
      g.addColorStop(1, `rgba(${tone},0)`)
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    // streak smears (drag marks)
    const streakCount = Math.floor(dirt * 6)
    for (let i = 0; i < streakCount; i++) {
      const x = Math.random() * size
      const y = Math.random() * size
      const len = 20 + Math.random() * 70
      const ang = Math.random() * Math.PI * 2
      ctx.strokeStyle = `rgba(${60 + Math.random() * 30},${40 + Math.random() * 20},${20 + Math.random() * 15},${0.15 + Math.random() * 0.25 * dirt})`
      ctx.lineWidth = 2 + Math.random() * 4
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len)
      ctx.stroke()
    }
    // tiny dark crud specks
    const speckCount = Math.floor(dirt * 200)
    for (let i = 0; i < speckCount; i++) {
      const x = Math.random() * size
      const y = Math.random() * size
      const r = 0.7 + Math.random() * 1.6
      ctx.fillStyle = `rgba(${20 + Math.random() * 20},${15 + Math.random() * 15},${10 + Math.random() * 10},${0.3 + Math.random() * 0.5})`
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // very subtle pixel noise
  const id = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 5
    id.data[i] = clamp255(id.data[i] + n)
    id.data[i + 1] = clamp255(id.data[i + 1] + n)
    id.data[i + 2] = clamp255(id.data[i + 2] + n)
  }
  ctx.putImageData(id, 0, 0)

  const t = new THREE.CanvasTexture(canvas)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}
