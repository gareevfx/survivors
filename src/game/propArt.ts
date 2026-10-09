import { hash2 } from './rng'
import { TILE } from './types'

/**
 * Cached painterly props. Dumps, crags, and trees are drawn once at full
 * resolution with soft gradients and anti-aliased edges, then reused.
 * Nothing here moves, blinks, or depends on match time.
 */

const ROCK_SPRITES = 4
const ROCK_STAGES = 4
const TREE_SPRITES = 5
const ORE_SPRITES = 4
const ORE_LEVELS = 4

/** Yellow-green scrap, readable on dirt and distinct from tree green. */
export const DUMPS_COLOR = '#c6dc4a'

type Pt = [number, number]

let rocks: HTMLCanvasElement[][] | null = null
let trees: HTMLCanvasElement[] | null = null
let ore: HTMLCanvasElement[][] | null = null
let dumpsPortrait: string | null = null

function poly(ctx: CanvasRenderingContext2D, points: Pt[]): void {
  ctx.beginPath()
  const first = points[0]
  if (!first) return
  ctx.moveTo(first[0], first[1])
  for (let i = 1; i < points.length; i++) {
    const point = points[i]
    if (point) ctx.lineTo(point[0], point[1])
  }
  ctx.closePath()
}

function bounds(pts: Pt[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of pts) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return { x0, y0, x1, y1 }
}

function paintShard(ctx: CanvasRenderingContext2D, pts: Pt[], lit: string, body: string, shade: string): void {
  const box = bounds(pts)
  ctx.fillStyle = 'rgba(18, 12, 8, 0.3)'
  ctx.beginPath()
  const first = pts[0]
  if (!first) return
  ctx.moveTo(first[0] + 2, first[1] + 3)
  for (let i = 1; i < pts.length; i++) {
    const point = pts[i]
    if (point) ctx.lineTo(point[0] + 2, point[1] + 3)
  }
  ctx.closePath()
  ctx.fill()

  const g = ctx.createLinearGradient(box.x0, box.y0, box.x1, box.y1)
  g.addColorStop(0, lit)
  g.addColorStop(0.4, body)
  g.addColorStop(1, shade)
  ctx.fillStyle = g
  poly(ctx, pts)
  ctx.fill()

  ctx.save()
  poly(ctx, pts)
  ctx.clip()
  const face = ctx.createLinearGradient(box.x0, box.y0, box.x1, box.y1)
  face.addColorStop(0, 'rgba(255, 244, 220, 0.28)')
  face.addColorStop(0.38, 'rgba(255, 244, 220, 0)')
  face.addColorStop(1, 'rgba(22, 14, 8, 0.42)')
  ctx.fillStyle = face
  ctx.fillRect(box.x0 - 1, box.y0 - 1, box.x1 - box.x0 + 2, box.y1 - box.y0 + 2)
  ctx.fillStyle = 'rgba(90, 72, 54, 0.18)'
  for (let i = 0; i < 5; i++) {
    const px = box.x0 + ((i * 17) % 11) + 2
    const py = box.y0 + ((i * 9) % 7) + 3
    ctx.beginPath()
    ctx.ellipse(px, py, 1.1, 0.6, i * 0.4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = 'rgba(255, 248, 230, 0.4)'
  ctx.beginPath()
  ctx.ellipse(box.x0 + (box.x1 - box.x0) * 0.28, box.y0 + (box.y1 - box.y0) * 0.24, 3.1, 1.5, -0.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.strokeStyle = 'rgba(32, 22, 14, 0.78)'
  ctx.lineWidth = 1
  poly(ctx, pts)
  ctx.stroke()
}

function soilSkirt(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(48, 34, 20, 0.42)'
  ctx.beginPath()
  ctx.ellipse(28, 29, 18, 3.6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(108, 82, 52, 0.5)'
  ctx.beginPath()
  ctx.ellipse(27, 28, 13, 2.2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#6d5e4c'
  for (const [px, py, r] of [
    [11, 28, 1.3],
    [42, 29, 1.1],
    [18, 30, 0.8],
    [48, 27.5, 1.2],
    [34, 30, 0.7],
  ] as Array<[number, number, number]>) {
    ctx.beginPath()
    ctx.ellipse(px, py, r, r * 0.62, 0.2, 0, Math.PI * 2)
    ctx.fill()
  }
}

function cracks(ctx: CanvasRenderingContext2D, stage: number, shift: number): void {
  if (stage <= 0) return
  const lines: Pt[][] = [
    [[16, 16], [22, 22], [20, 27]],
    [[30, 13], [34, 19], [31, 25]],
    [[12, 21], [18, 24], [17, 28]],
    [[36, 17], [41, 22], [39, 27]],
    [[24, 15], [21, 21], [18, 26]],
    [[28, 18], [33, 23], [36, 26]],
  ]
  ctx.strokeStyle = 'rgba(28, 18, 12, 0.82)'
  ctx.lineWidth = 1
  ctx.lineCap = 'round'
  const count = stage === 1 ? 2 : stage === 2 ? 4 : 6
  for (let i = 0; i < count; i++) {
    const line = lines[(i + shift) % lines.length]
    if (!line) continue
    ctx.beginPath()
    line.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point[0], point[1])
      else ctx.lineTo(point[0], point[1])
    })
    ctx.stroke()
  }
  if (stage >= 3) {
    ctx.fillStyle = 'rgba(36, 24, 16, 0.38)'
    ctx.beginPath()
    ctx.ellipse(27, 22, 6.5, 3.2, 0.35, 0, Math.PI * 2)
    ctx.fill()
  }
}

const CRAGS: Pt[][][] = [
  [
    [[8, 26], [14, 16], [24, 12], [32, 18], [28, 28], [14, 30]],
    [[30, 24], [36, 14], [48, 16], [46, 27], [34, 29]],
  ],
  [
    [[6, 25], [12, 15], [20, 17], [18, 28], [8, 29]],
    [[16, 26], [22, 12], [34, 11], [36, 22], [28, 28]],
    [[34, 23], [42, 14], [52, 18], [48, 28], [36, 28]],
  ],
  [
    [[10, 27], [18, 18], [40, 16], [48, 22], [42, 30], [16, 31]],
    [[22, 20], [28, 9], [36, 14], [33, 23]],
    [[6, 22], [12, 14], [18, 20], [14, 28]],
  ],
  [
    [[7, 25], [13, 16], [21, 18], [17, 29]],
    [[16, 24], [24, 10], [33, 14], [29, 26]],
    [[31, 22], [40, 12], [51, 17], [46, 28], [34, 28]],
    [[20, 27], [26, 20], [34, 22], [30, 31], [21, 31]],
  ],
]

function rockSprites(): HTMLCanvasElement[][] {
  if (rocks) return rocks
  const palettes = [
    ['#c2b6a6', '#7a7064', '#3e362e'],
    ['#b7aa98', '#6e655b', '#3a332c'],
    ['#cec2b0', '#847868', '#463e34'],
    ['#b3a898', '#72685e', '#342e28'],
  ]
  rocks = CRAGS.map((shards, variant) => {
    const palette = palettes[variant] ?? palettes[0]
    const lit = palette?.[0] ?? '#c2b6a6'
    const body = palette?.[1] ?? '#7a7064'
    const shade = palette?.[2] ?? '#3e362e'
    return Array.from({ length: ROCK_STAGES }, (_, stage) => {
      const canvas = document.createElement('canvas')
      canvas.width = 56
      canvas.height = 34
      const ctx = canvas.getContext('2d')
      if (!ctx) return canvas
      soilSkirt(ctx)
      for (const shard of shards) paintShard(ctx, shard, lit, body, shade)
      cracks(ctx, stage, variant)
      return canvas
    })
  })
  return rocks
}

function leaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  light: string,
  mid: string,
  dark: string,
): void {
  ctx.fillStyle = 'rgba(16, 28, 12, 0.28)'
  ctx.beginPath()
  ctx.ellipse(x + 2.2, y + 3.2, rx * 0.92, ry * 0.78, 0, 0, Math.PI * 2)
  ctx.fill()
  const g = ctx.createRadialGradient(x - rx * 0.35, y - ry * 0.45, rx * 0.08, x + rx * 0.1, y + ry * 0.15, Math.max(rx, ry))
  g.addColorStop(0, light)
  g.addColorStop(0.5, mid)
  g.addColorStop(1, dark)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
}

function bark(ctx: CanvasRenderingContext2D, x: number, top: number, w: number, h: number, birch: boolean): void {
  ctx.fillStyle = birch ? '#c8c2b4' : '#4a301c'
  ctx.beginPath()
  ctx.moveTo(x + 1, top)
  ctx.lineTo(x + w - 1, top)
  ctx.lineTo(x + w + 5, top + h)
  ctx.quadraticCurveTo(x + w / 2, top + h + 4, x - 6, top + h)
  ctx.closePath()
  ctx.fill()
  const g = ctx.createLinearGradient(x - 4, top, x + w + 4, top)
  if (birch) {
    g.addColorStop(0, '#f4f1e8')
    g.addColorStop(0.45, '#e4dfd2')
    g.addColorStop(1, '#b7b1a4')
  } else {
    g.addColorStop(0, '#8a6240')
    g.addColorStop(0.42, '#5c3c24')
    g.addColorStop(1, '#3a2416')
  }
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(x, top)
  ctx.lineTo(x + w, top)
  ctx.lineTo(x + w + 4, top + h)
  ctx.quadraticCurveTo(x + w / 2, top + h + 3, x - 5, top + h)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = birch ? 'rgba(42, 36, 30, 0.72)' : 'rgba(28, 16, 8, 0.45)'
  ctx.lineWidth = birch ? 1.3 : 0.8
  for (let i = 0; i < (birch ? 6 : 4); i++) {
    const y = top + 4 + i * (h / (birch ? 6.4 : 4.6))
    ctx.beginPath()
    if (birch) {
      ctx.moveTo(x + 1, y)
      ctx.quadraticCurveTo(x + w * 0.5, y + 1.4, x + w - 1, y - 0.4)
    } else {
      ctx.moveTo(x + 2, y)
      ctx.lineTo(x + 2, y + h * 0.18)
    }
    ctx.stroke()
  }
  ctx.strokeStyle = birch ? '#6a624e' : '#3a2414'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(x - 2, top + h - 2)
  ctx.quadraticCurveTo(x - 10, top + h + 2, x - 14, top + h + 1)
  ctx.moveTo(x + w + 2, top + h - 1)
  ctx.quadraticCurveTo(x + w + 10, top + h + 3, x + w + 14, top + h)
  ctx.stroke()
}

function groundShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number): void {
  ctx.fillStyle = 'rgba(16, 12, 8, 0.32)'
  ctx.beginPath()
  ctx.ellipse(x, y, rx, 4.4, 0, 0, Math.PI * 2)
  ctx.fill()
}

function branch(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, width: number): void {
  ctx.strokeStyle = '#4a301c'
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.quadraticCurveTo(x1, y1, x2, y2)
  ctx.stroke()
}

function paintOak(ctx: CanvasRenderingContext2D): void {
  groundShadow(ctx, 40, 80, 22)
  bark(ctx, 34, 46, 8, 30, false)
  branch(ctx, 36, 52, 22, 40, 16, 28, 2.2)
  branch(ctx, 40, 50, 54, 36, 60, 26, 2.2)
  branch(ctx, 38, 48, 30, 30, 24, 18, 1.6)
  branch(ctx, 40, 46, 48, 28, 54, 16, 1.6)
  const clumps: Array<[number, number, number, number]> = [
    [22, 34, 13, 10],
    [40, 26, 15, 12],
    [56, 32, 12, 9],
    [30, 20, 11, 9],
    [48, 18, 10, 8],
    [18, 24, 8, 7],
    [62, 24, 7, 6],
    [36, 14, 8, 6],
  ]
  for (const [x, y, rx, ry] of clumps) leaf(ctx, x, y, rx, ry, '#8fbf62', '#3f7a34', '#1d4422')
  leaf(ctx, 28, 16, 6, 4.5, '#d7e6a4', '#7aaa4e', '#2f6230')
}

function paintPine(ctx: CanvasRenderingContext2D): void {
  groundShadow(ctx, 34, 84, 16)
  bark(ctx, 30, 62, 7, 18, false)
  const tiers: Array<[number, number, number, number]> = [
    [34, 70, 20, 8],
    [34, 58, 17, 8],
    [34, 46, 13, 7],
    [34, 34, 9, 6],
    [34, 22, 5, 5],
  ]
  for (const [x, y, rx, ry] of tiers) {
    leaf(ctx, x + 1, y + 2, rx, ry, '#2a5830', '#1a3c22', '#102616')
    leaf(ctx, x, y, rx * 0.92, ry * 0.9, '#6a9a48', '#2f6840', '#173424')
  }
  leaf(ctx, 30, 18, 3.2, 2.4, '#d4e2a8', '#7aaa52', '#2c5c34')
}

function paintBirch(ctx: CanvasRenderingContext2D): void {
  groundShadow(ctx, 34, 82, 16)
  bark(ctx, 30, 40, 6, 38, true)
  branch(ctx, 32, 48, 20, 40, 16, 30, 1.5)
  branch(ctx, 34, 46, 48, 36, 54, 28, 1.5)
  const clumps: Array<[number, number, number, number]> = [
    [20, 28, 10, 8],
    [34, 22, 12, 10],
    [50, 28, 9, 7],
    [28, 16, 8, 6],
    [42, 14, 7, 6],
  ]
  for (const [x, y, rx, ry] of clumps) leaf(ctx, x, y, rx, ry, '#c6d98a', '#7aa64c', '#3d6a30')
}

function paintDead(ctx: CanvasRenderingContext2D): void {
  groundShadow(ctx, 36, 76, 16)
  bark(ctx, 32, 36, 7, 36, false)
  branch(ctx, 34, 42, 18, 28, 12, 16, 2.4)
  branch(ctx, 36, 40, 52, 24, 62, 14, 2.2)
  branch(ctx, 35, 48, 22, 36, 14, 28, 1.6)
  branch(ctx, 37, 34, 48, 18, 58, 8, 1.5)
  branch(ctx, 34, 30, 28, 16, 22, 8, 1.3)
  leaf(ctx, 14, 16, 4, 3, '#8a7048', '#6a5434', '#3e301c')
  leaf(ctx, 60, 14, 3.4, 2.6, '#7a6240', '#5c442c', '#3a2c1c')
}

function paintBush(ctx: CanvasRenderingContext2D): void {
  groundShadow(ctx, 36, 46, 20)
  branch(ctx, 28, 40, 22, 34, 18, 30, 1.3)
  branch(ctx, 40, 40, 50, 34, 54, 30, 1.3)
  const clumps: Array<[number, number, number, number]> = [
    [18, 32, 9, 6],
    [32, 28, 11, 7],
    [48, 32, 10, 6],
    [24, 24, 7, 5],
    [42, 22, 8, 5],
    [56, 26, 6, 4],
  ]
  for (const [x, y, rx, ry] of clumps) leaf(ctx, x, y, rx, ry, '#9cc868', '#4e8438', '#245028')
}

function treeSprites(): HTMLCanvasElement[] {
  if (trees) return trees
  const specs: Array<{ w: number; h: number; paint: (ctx: CanvasRenderingContext2D) => void }> = [
    { w: 76, h: 88, paint: paintOak },
    { w: 68, h: 92, paint: paintPine },
    { w: 68, h: 90, paint: paintBirch },
    { w: 74, h: 84, paint: paintDead },
    { w: 72, h: 56, paint: paintBush },
  ]
  trees = specs.map((spec) => {
    const canvas = document.createElement('canvas')
    canvas.width = spec.w
    canvas.height = spec.h
    const ctx = canvas.getContext('2d')
    if (ctx) spec.paint(ctx)
    return canvas
  })
  return trees
}

interface Scrap {
  kind: 'pcb' | 'crt' | 'lcd' | 'keys' | 'hdd' | 'cable' | 'cap' | 'fan' | 'case' | 'can' | 'bit'
  x: number
  y: number
  w: number
  h: number
  rot: number
  tier: number
}

function paintPcb(ctx: CanvasRenderingContext2D, piece: Scrap): void {
  ctx.save()
  ctx.translate(piece.x, piece.y)
  ctx.rotate(piece.rot)
  const w = piece.w
  const h = piece.h
  ctx.fillStyle = 'rgba(10, 16, 8, 0.35)'
  ctx.fillRect(-w / 2 + 1.5, -h / 2 + 2, w, h)
  const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2)
  g.addColorStop(0, '#7eae56')
  g.addColorStop(0.55, '#3f6c34')
  g.addColorStop(1, '#274824')
  ctx.fillStyle = g
  ctx.fillRect(-w / 2, -h / 2, w, h)
  ctx.strokeStyle = 'rgba(214, 176, 72, 0.9)'
  ctx.lineWidth = 0.7
  ctx.beginPath()
  ctx.moveTo(-w / 2 + 2, -h * 0.2)
  ctx.lineTo(w * 0.1, -h * 0.2)
  ctx.lineTo(w * 0.1, h * 0.25)
  ctx.lineTo(w / 2 - 2, h * 0.25)
  ctx.moveTo(-w * 0.15, -h / 2 + 2)
  ctx.lineTo(-w * 0.15, h / 2 - 2)
  ctx.stroke()
  ctx.fillStyle = '#1a1e18'
  ctx.fillRect(-w * 0.18, -h * 0.22, w * 0.36, h * 0.42)
  ctx.fillStyle = '#9aa0a4'
  ctx.fillRect(-w * 0.16, -h * 0.2, w * 0.32, 1.4)
  ctx.restore()
}

function paintCrt(ctx: CanvasRenderingContext2D, piece: Scrap): void {
  ctx.save()
  ctx.translate(piece.x, piece.y)
  ctx.rotate(piece.rot)
  const w = piece.w
  const h = piece.h
  ctx.fillStyle = 'rgba(8, 10, 12, 0.35)'
  ctx.fillRect(-w / 2 + 2, -h / 2 + 2.5, w, h)
  const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2)
  g.addColorStop(0, '#a2a8b0')
  g.addColorStop(0.45, '#6a727a')
  g.addColorStop(1, '#3a4046')
  ctx.fillStyle = g
  ctx.fillRect(-w / 2, -h / 2, w, h)
  ctx.fillStyle = '#14201c'
  ctx.fillRect(-w / 2 + 2, -h / 2 + 2, w - 6, h - 5)
  const sheen = ctx.createLinearGradient(-w / 2, -h / 2, 0, 0)
  sheen.addColorStop(0, 'rgba(190, 214, 196, 0.16)')
  sheen.addColorStop(1, 'rgba(190, 214, 196, 0)')
  ctx.fillStyle = sheen
  ctx.fillRect(-w / 2 + 2, -h / 2 + 2, w * 0.4, h * 0.45)
  ctx.restore()
}

function paintLcd(ctx: CanvasRenderingContext2D, piece: Scrap): void {
  ctx.save()
  ctx.translate(piece.x, piece.y)
  ctx.rotate(piece.rot)
  const w = piece.w
  const h = piece.h
  ctx.fillStyle = 'rgba(10, 12, 14, 0.3)'
  ctx.fillRect(-w / 2 + 1, -h / 2 + 2, w, h)
  ctx.fillStyle = '#4e565e'
  ctx.fillRect(-w / 2, -h / 2, w, h)
  ctx.fillStyle = '#1c2830'
  ctx.fillRect(-w / 2 + 1.2, -h / 2 + 1.2, w - 2.4, h - 3)
  ctx.fillStyle = '#8d98a0'
  ctx.fillRect(-w / 2, h / 2 - 1.6, w, 1.6)
  ctx.restore()
}

function paintKeys(ctx: CanvasRenderingContext2D, piece: Scrap): void {
  ctx.save()
  ctx.translate(piece.x, piece.y)
  ctx.rotate(piece.rot)
  const w = piece.w
  const h = piece.h
  ctx.fillStyle = 'rgba(12, 12, 14, 0.32)'
  ctx.fillRect(-w / 2 + 1, -h / 2 + 2, w, h)
  ctx.fillStyle = '#3a3e44'
  ctx.fillRect(-w / 2, -h / 2, w, h)
  ctx.fillStyle = '#c8ccd0'
  const cols = 5
  const rows = 2
  const kw = (w - 4) / cols - 0.6
  const kh = (h - 3) / rows - 0.5
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      ctx.fillRect(-w / 2 + 1.4 + col * (kw + 0.6), -h / 2 + 1.2 + row * (kh + 0.5), kw, kh)
    }
  }
  ctx.restore()
}

function paintHdd(ctx: CanvasRenderingContext2D, piece: Scrap): void {
  ctx.save()
  ctx.translate(piece.x, piece.y)
  ctx.rotate(piece.rot)
  const w = piece.w
  const h = piece.h
  ctx.fillStyle = 'rgba(12, 14, 16, 0.32)'
  ctx.fillRect(-w / 2 + 1.5, -h / 2 + 2, w, h)
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0)
  g.addColorStop(0, '#d5d8dc')
  g.addColorStop(0.5, '#8e969e')
  g.addColorStop(1, '#5c646c')
  ctx.fillStyle = g
  ctx.fillRect(-w / 2, -h / 2, w, h)
  ctx.strokeStyle = 'rgba(40, 44, 48, 0.7)'
  ctx.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1)
  ctx.fillStyle = '#2a3036'
  ctx.beginPath()
  ctx.arc(w * 0.12, 0, Math.min(w, h) * 0.28, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function paintCable(ctx: CanvasRenderingContext2D, piece: Scrap): void {
  ctx.save()
  ctx.translate(piece.x, piece.y)
  ctx.strokeStyle = piece.tier % 2 === 0 ? '#2c3034' : '#6a6840'
  ctx.lineWidth = 1.6
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(-piece.w / 2, 0)
  ctx.bezierCurveTo(-piece.w * 0.2, -piece.h, piece.w * 0.2, piece.h, piece.w / 2, 0)
  ctx.stroke()
  ctx.restore()
}

function paintCap(ctx: CanvasRenderingContext2D, piece: Scrap): void {
  ctx.save()
  ctx.translate(piece.x, piece.y)
  ctx.fillStyle = 'rgba(12, 14, 16, 0.3)'
  ctx.fillRect(-piece.w / 2 + 1, -piece.h / 2 + 2, piece.w, piece.h)
  const g = ctx.createLinearGradient(-piece.w / 2, 0, piece.w / 2, 0)
  g.addColorStop(0, '#9aa4ae')
  g.addColorStop(0.4, '#e4e8ec')
  g.addColorStop(1, '#5e686e')
  ctx.fillStyle = g
  ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h)
  ctx.fillStyle = '#c45a3a'
  ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, 1.6)
  ctx.restore()
}

function paintFan(ctx: CanvasRenderingContext2D, piece: Scrap): void {
  ctx.save()
  ctx.translate(piece.x, piece.y)
  const r = piece.w / 2
  ctx.fillStyle = 'rgba(10, 12, 14, 0.3)'
  ctx.beginPath()
  ctx.arc(1.2, 2, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#3c444c'
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#22282e'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = '#8e98a0'
  ctx.lineWidth = 1.4
  for (let i = 0; i < 4; i++) {
    const a = piece.rot + (i * Math.PI) / 2
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2)
    ctx.lineTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7)
    ctx.stroke()
  }
  ctx.fillStyle = '#d0d6dc'
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function paintCase(ctx: CanvasRenderingContext2D, piece: Scrap): void {
  ctx.save()
  ctx.translate(piece.x, piece.y)
  ctx.rotate(piece.rot)
  const w = piece.w
  const h = piece.h
  ctx.fillStyle = 'rgba(12, 14, 16, 0.34)'
  ctx.beginPath()
  ctx.moveTo(-w / 2 + 2, -h / 2 + 3)
  ctx.lineTo(w / 2 + 2, -h / 2 + 3)
  ctx.lineTo(w / 2 - 2, h / 2 + 2)
  ctx.lineTo(-w / 2 - 1, h / 2 + 2)
  ctx.closePath()
  ctx.fill()
  const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2)
  g.addColorStop(0, '#d2d0c8')
  g.addColorStop(0.5, '#8a8c86')
  g.addColorStop(1, '#4e524c')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(-w / 2, -h / 2)
  ctx.lineTo(w / 2, -h / 2 + 2)
  ctx.lineTo(w / 2 - 4, h / 2)
  ctx.lineTo(-w / 2 - 2, h / 2 - 2)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(40, 36, 30, 0.55)'
  ctx.stroke()
  ctx.restore()
}

function paintCan(ctx: CanvasRenderingContext2D, piece: Scrap): void {
  ctx.save()
  ctx.translate(piece.x, piece.y)
  ctx.rotate(piece.rot * 0.2)
  const w = piece.w
  const h = piece.h
  ctx.fillStyle = 'rgba(20, 16, 10, 0.3)'
  ctx.fillRect(-w / 2 + 1, -h / 2 + 2, w, h)
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0)
  g.addColorStop(0, '#8a6840')
  g.addColorStop(0.35, '#e4d2a8')
  g.addColorStop(0.7, '#a68458')
  g.addColorStop(1, '#5c4630')
  ctx.fillStyle = g
  ctx.fillRect(-w / 2, -h / 2, w, h)
  ctx.fillStyle = '#6a5034'
  ctx.beginPath()
  ctx.ellipse(0, -h / 2, w / 2, 1.6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 244, 220, 0.35)'
  ctx.fillRect(-w * 0.15, -h / 2 + 1, 1.2, h - 2)
  ctx.restore()
}

function paintBit(ctx: CanvasRenderingContext2D, piece: Scrap): void {
  ctx.save()
  ctx.translate(piece.x, piece.y)
  ctx.rotate(piece.rot)
  ctx.fillStyle = 'rgba(20, 16, 10, 0.28)'
  ctx.beginPath()
  ctx.ellipse(1, 1.5, piece.w / 2, piece.h / 2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = piece.tier % 2 === 0 ? '#6e7a48' : '#8a8478'
  ctx.beginPath()
  ctx.ellipse(0, 0, piece.w / 2, piece.h / 2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

const PAINTERS: Record<Scrap['kind'], (ctx: CanvasRenderingContext2D, piece: Scrap) => void> = {
  pcb: paintPcb,
  crt: paintCrt,
  lcd: paintLcd,
  keys: paintKeys,
  hdd: paintHdd,
  cable: paintCable,
  cap: paintCap,
  fan: paintFan,
  case: paintCase,
  can: paintCan,
  bit: paintBit,
}

const HEAPS: Scrap[][] = [
  [
    { kind: 'case', x: 22, y: 28, w: 18, h: 10, rot: -0.15, tier: 2 },
    { kind: 'crt', x: 36, y: 22, w: 16, h: 12, rot: 0.08, tier: 3 },
    { kind: 'pcb', x: 18, y: 18, w: 16, h: 10, rot: -0.4, tier: 2 },
    { kind: 'keys', x: 40, y: 30, w: 14, h: 7, rot: 0.2, tier: 1 },
    { kind: 'hdd', x: 28, y: 16, w: 12, h: 7, rot: 0.1, tier: 3 },
    { kind: 'fan', x: 46, y: 18, w: 9, h: 9, rot: 0.4, tier: 2 },
    { kind: 'cable', x: 16, y: 32, w: 14, h: 4, rot: 0, tier: 0 },
    { kind: 'cap', x: 12, y: 24, w: 4, h: 7, rot: 0, tier: 1 },
    { kind: 'can', x: 48, y: 30, w: 6, h: 9, rot: 0.3, tier: 1 },
    { kind: 'lcd', x: 30, y: 26, w: 12, h: 7, rot: -0.2, tier: 2 },
    { kind: 'bit', x: 10, y: 34, w: 4, h: 2.4, rot: 0.5, tier: 0 },
    { kind: 'bit', x: 50, y: 36, w: 3.4, h: 2, rot: 1, tier: 0 },
    { kind: 'bit', x: 24, y: 36, w: 3, h: 2, rot: 0.2, tier: 0 },
  ],
  [
    { kind: 'pcb', x: 20, y: 26, w: 18, h: 11, rot: 0.25, tier: 2 },
    { kind: 'lcd', x: 38, y: 20, w: 16, h: 9, rot: -0.12, tier: 3 },
    { kind: 'can', x: 14, y: 20, w: 7, h: 10, rot: -0.4, tier: 1 },
    { kind: 'keys', x: 30, y: 30, w: 15, h: 7, rot: 0.05, tier: 1 },
    { kind: 'case', x: 44, y: 28, w: 12, h: 8, rot: 0.35, tier: 2 },
    { kind: 'cable', x: 34, y: 34, w: 16, h: 5, rot: 0, tier: 0 },
    { kind: 'cap', x: 48, y: 18, w: 3.6, h: 6, rot: 0, tier: 1 },
    { kind: 'fan', x: 24, y: 16, w: 8, h: 8, rot: 0.8, tier: 3 },
    { kind: 'hdd', x: 16, y: 32, w: 11, h: 6, rot: -0.2, tier: 2 },
    { kind: 'bit', x: 8, y: 34, w: 3.2, h: 2, rot: 0.4, tier: 0 },
    { kind: 'bit', x: 52, y: 34, w: 3.6, h: 2.2, rot: 1.1, tier: 0 },
  ],
  [
    { kind: 'crt', x: 24, y: 24, w: 15, h: 12, rot: -0.18, tier: 3 },
    { kind: 'pcb', x: 40, y: 22, w: 14, h: 9, rot: 0.5, tier: 2 },
    { kind: 'hdd', x: 16, y: 30, w: 12, h: 7, rot: 0.15, tier: 1 },
    { kind: 'can', x: 46, y: 30, w: 6, h: 8, rot: 0.6, tier: 1 },
    { kind: 'keys', x: 32, y: 32, w: 13, h: 6, rot: -0.1, tier: 2 },
    { kind: 'cable', x: 22, y: 36, w: 18, h: 4, rot: 0, tier: 0 },
    { kind: 'cap', x: 10, y: 26, w: 3.5, h: 6, rot: 0, tier: 0 },
    { kind: 'fan', x: 36, y: 14, w: 8, h: 8, rot: 0.2, tier: 3 },
    { kind: 'case', x: 48, y: 18, w: 10, h: 7, rot: -0.3, tier: 2 },
    { kind: 'bit', x: 12, y: 36, w: 3, h: 2, rot: 0.7, tier: 0 },
    { kind: 'bit', x: 42, y: 36, w: 4, h: 2.2, rot: 0.1, tier: 0 },
  ],
  [
    { kind: 'lcd', x: 28, y: 20, w: 15, h: 8, rot: 0.12, tier: 3 },
    { kind: 'case', x: 18, y: 28, w: 14, h: 9, rot: -0.25, tier: 2 },
    { kind: 'pcb', x: 40, y: 28, w: 16, h: 10, rot: 0.35, tier: 2 },
    { kind: 'crt', x: 44, y: 16, w: 12, h: 10, rot: 0.05, tier: 3 },
    { kind: 'keys', x: 26, y: 32, w: 14, h: 6, rot: -0.05, tier: 1 },
    { kind: 'cable', x: 36, y: 36, w: 14, h: 4, rot: 0, tier: 0 },
    { kind: 'can', x: 12, y: 22, w: 6, h: 8, rot: -0.5, tier: 1 },
    { kind: 'cap', x: 50, y: 26, w: 3.4, h: 6, rot: 0, tier: 0 },
    { kind: 'fan', x: 20, y: 16, w: 8, h: 8, rot: 1.1, tier: 2 },
    { kind: 'hdd', x: 34, y: 24, w: 10, h: 6, rot: -0.4, tier: 1 },
    { kind: 'bit', x: 8, y: 34, w: 3.2, h: 2, rot: 0.3, tier: 0 },
    { kind: 'bit', x: 52, y: 34, w: 3, h: 1.8, rot: 0.9, tier: 0 },
  ],
]

function paintHeap(ctx: CanvasRenderingContext2D, pieces: Scrap[], level: number): void {
  ctx.fillStyle = 'rgba(16, 14, 10, 0.34)'
  ctx.beginPath()
  ctx.ellipse(29, 38, 20, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  const shown = pieces.filter((piece) => piece.tier <= level).slice().sort((a, b) => a.y - b.y)
  for (const piece of shown) PAINTERS[piece.kind](ctx, piece)
}

function oreSprites(): HTMLCanvasElement[][] {
  if (ore) return ore
  ore = HEAPS.map((pieces) =>
    Array.from({ length: ORE_LEVELS }, (_, level) => {
      const canvas = document.createElement('canvas')
      canvas.width = 58
      canvas.height = 48
      const ctx = canvas.getContext('2d')
      if (ctx) paintHeap(ctx, pieces, level)
      return canvas
    }),
  )
  return ore
}

export function rockProp(variant: number, stage: number): HTMLCanvasElement | null {
  return rockSprites()[variant]?.[stage] ?? null
}

export function treeProp(variant: number): HTMLCanvasElement | null {
  return treeSprites()[variant] ?? null
}

export function oreProp(variant: number, level: number): HTMLCanvasElement | null {
  return oreSprites()[variant]?.[level] ?? null
}

export function dumpsPortraitUrl(): string {
  if (typeof document === 'undefined') return ''
  if (dumpsPortrait != null) return dumpsPortrait
  const canvas = document.createElement('canvas')
  canvas.width = 68
  canvas.height = 68
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#8d6b45'
  ctx.fillRect(0, 0, 68, 68)
  const sprite = oreProp(0, 3)
  if (sprite) ctx.drawImage(sprite, 5, 12)
  dumpsPortrait = canvas.toDataURL()
  return dumpsPortrait
}

function rockStage(hpRatio: number): number {
  if (hpRatio > 0.82) return 0
  if (hpRatio > 0.55) return 1
  if (hpRatio > 0.3) return 2
  return 3
}

function oreLevel(amount: number, full: number): number {
  const ratio = full > 0 ? Math.max(0, Math.min(1, amount / full)) : 1
  if (ratio > 0.72) return 3
  if (ratio > 0.48) return 2
  if (ratio > 0.22) return 1
  return 0
}

export function drawRockSprite(ctx: CanvasRenderingContext2D, tx: number, ty: number, seed: number, hpRatio = 1): void {
  const variant = Math.floor(hash2(tx + 3, ty + 9, seed) * ROCK_SPRITES) % ROCK_SPRITES
  const stage = rockStage(hpRatio)
  const sprite = rockSprites()[variant]?.[stage]
  if (!sprite) return
  ctx.drawImage(sprite, tx * TILE + (TILE - sprite.width) / 2, ty * TILE + TILE - sprite.height + 2)
}

export function drawTreeSprite(ctx: CanvasRenderingContext2D, tx: number, ty: number, seed: number): void {
  const index = Math.floor(hash2(tx + 11, ty + 4, seed) * TREE_SPRITES) % TREE_SPRITES
  const sprite = treeSprites()[index]
  if (!sprite) return
  ctx.drawImage(sprite, tx * TILE + (TILE - sprite.width) / 2, ty * TILE + TILE - sprite.height + 2)
}

export function drawOreSprite(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  seed: number,
  selected: boolean,
  amount: number,
  full: number,
): void {
  const x = (tx + 0.5) * TILE
  const y = (ty + 0.5) * TILE
  if (selected) {
    ctx.save()
    ctx.strokeStyle = 'rgba(244, 241, 196, 0.95)'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.ellipse(x, y + 4, 16, 9, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  const index = Math.floor(hash2(tx + 5, ty + 2, seed + 3) * ORE_SPRITES) % ORE_SPRITES
  const sprite = oreSprites()[index]?.[oreLevel(amount, full)]
  if (!sprite) return
  ctx.drawImage(sprite, x - sprite.width / 2, y - sprite.height / 2 + 4)
}
