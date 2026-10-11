import { CASTLE_YARD, pickFfa10Sites, pickFfaSites, pickKeepSites } from './map'
import { hash2 } from './rng'
import { BUILDING_STATS, TILE, type MatchMode } from './types'

/**
 * Original procedural ground and props. Everything is drawn in code and cached:
 * the battlefield is one offscreen canvas, and rocks, trees, dumps, and fog
 * edges are small sprites reused every frame.
 */

const ROCK_SPRITES = 4
const TREE_SPRITES = 4
const ORE_SPRITES = 3
const FOG_FADE = 16

type Rgb = [number, number, number]

let yardKey = ''
let yardMask: Uint8Array | null = null
let rocks: HTMLCanvasElement[] | null = null
let trees: HTMLCanvasElement[] | null = null
let ore: HTMLCanvasElement[] | null = null
const fogCache = new Map<string, HTMLCanvasElement>()

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = smooth(x - x0)
  const fy = smooth(y - y0)
  const a = hash2(x0, y0, seed)
  const b = hash2(x0 + 1, y0, seed)
  const c = hash2(x0, y0 + 1, seed)
  const d = hash2(x0 + 1, y0 + 1, seed)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

function fbm(x: number, y: number, seed: number): number {
  return valueNoise(x, y, seed) * 0.68 + valueNoise(x * 2.15 + 5, y * 2.15 - 3, seed + 11) * 0.32
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function span(n: number): number {
  return Math.min(1, Math.max(0, (n - 0.28) / 0.52))
}

/** Meadow greens with lighter and darker patches, and a few dirt clearings. */
export function terrainRgb(tx: number, ty: number, seed: number): Rgb {
  const n = span(fbm(tx * 0.14, ty * 0.14, seed))
  const fine = span(fbm(tx * 0.33 + 2, ty * 0.29 - 1, seed + 41))
  const deep: Rgb = [42, 92, 30]
  const mid: Rgb = [74, 138, 44]
  const light: Rgb = [128, 174, 60]
  const sun: Rgb = [176, 198, 84]
  let color = n < 0.5 ? mix(deep, mid, n / 0.5) : mix(mid, light, (n - 0.5) / 0.5)
  if (fine > 0.62) color = mix(color, sun, ((fine - 0.62) / 0.38) * 0.7)
  else if (fine < 0.28) color = mix(color, deep, ((0.28 - fine) / 0.28) * 0.55)
  const patch = hash2((tx / 5) | 0, (ty / 5) | 0, seed + 23)
  if (patch < 0.1) {
    const soil: Rgb = [112, 82, 48]
    const dirt: Rgb = [162, 124, 70]
    const edge = hash2(tx, ty, seed + 31)
    color = mix(color, edge < 0.45 ? soil : dirt, patch < 0.045 ? 0.86 : 0.42 + edge * 0.28)
  }
  return color
}

/** Tile color for the minimap. Sampled at the tile center, with the Silo yard mixed in. */
export function terrainCss(tx: number, ty: number, seed: number, mapW: number, mapH: number, mode: MatchMode = 'duel'): string {
  let [r, g, b] = terrainRgb(tx + 0.5, ty + 0.5, seed)
  if (yardAt(seed, mapW, mapH, tx, ty, mode)) {
    r = r * 0.62 + 168 * 0.38
    g = g * 0.62 + 142 * 0.38
    b = b * 0.62 + 96 * 0.38
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`
}

function yardAt(seed: number, mapW: number, mapH: number, tx: number, ty: number, mode: MatchMode): boolean {
  const yards = yardsFor(seed, mapW, mapH, mode)
  if (tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) return false
  return yards[ty * mapW + tx] === 1
}

function yardsFor(seed: number, mapW: number, mapH: number, mode: MatchMode): Uint8Array {
  const key = `${seed}:${mapW}x${mapH}:${mode}`
  if (yardMask && yardKey === key) return yardMask
  const mask = new Uint8Array(mapW * mapH)
  const placed = pickKeepSites(seed, mapW, mapH)
  const sites =
    mode === 'ffa10' ? pickFfa10Sites(seed, mapW, mapH) : mode === 'ffa' ? pickFfaSites(seed, mapW, mapH) : [placed.player, placed.enemy]
  const footprintW = BUILDING_STATS.keep.w
  const footprintH = BUILDING_STATS.keep.h
  for (const site of sites) {
    for (let ty = site.ty - CASTLE_YARD; ty <= site.ty + footprintH - 1 + CASTLE_YARD; ty++) {
      for (let tx = site.tx - CASTLE_YARD; tx <= site.tx + footprintW - 1 + CASTLE_YARD; tx++) {
        if (tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) continue
        mask[ty * mapW + tx] = 1
      }
    }
  }
  yardKey = key
  yardMask = mask
  return mask
}

/** Paint the whole field once. The caller keeps this canvas for the match. */
export function paintTerrain(ctx: CanvasRenderingContext2D, seed: number, mapW: number, mapH: number, mode: MatchMode = 'duel'): void {
  const width = mapW * TILE
  const height = mapH * TILE
  const yards = yardsFor(seed, mapW, mapH, mode)
  const tileR = new Float32Array(mapW * mapH)
  const tileG = new Float32Array(mapW * mapH)
  const tileB = new Float32Array(mapW * mapH)
  for (let ty = 0; ty < mapH; ty++) {
    for (let tx = 0; tx < mapW; tx++) {
      const i = ty * mapW + tx
      let [r, g, b] = terrainRgb(tx + 0.5, ty + 0.5, seed)
      if (yards[i]) {
        r = r * 0.55 + 176 * 0.45
        g = g * 0.55 + 148 * 0.45
        b = b * 0.55 + 98 * 0.45
      }
      tileR[i] = r
      tileG[i] = g
      tileB[i] = b
    }
  }

  const image = ctx.createImageData(width, height)
  const data = image.data
  const seedBits = seed | 0
  for (let y = 0; y < height; y++) {
    const ty = (y / TILE) | 0
    const fy = smooth((y - ty * TILE) / TILE)
    const row = ty * mapW
    const row2 = Math.min(mapH - 1, ty + 1) * mapW
    const rowBase = y * width
    for (let x = 0; x < width; x++) {
      const tx = (x / TILE) | 0
      const fx = smooth((x - tx * TILE) / TILE)
      const tx2 = Math.min(mapW - 1, tx + 1)
      const i00 = row + tx
      const i10 = row + tx2
      const i01 = row2 + tx
      const i11 = row2 + tx2
      const r0 = tileR[i00] + (tileR[i10] - tileR[i00]) * fx
      const r1 = tileR[i01] + (tileR[i11] - tileR[i01]) * fx
      let r = r0 + (r1 - r0) * fy
      const g0 = tileG[i00] + (tileG[i10] - tileG[i00]) * fx
      const g1 = tileG[i01] + (tileG[i11] - tileG[i01]) * fx
      let g = g0 + (g1 - g0) * fy
      const b0 = tileB[i00] + (tileB[i10] - tileB[i00]) * fx
      const b1 = tileB[i01] + (tileB[i11] - tileB[i01]) * fx
      let b = b0 + (b1 - b0) * fy
      let grit = ((Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seedBits) >>> 0)
      grit = Math.imul(grit ^ (grit >>> 13), 1274126177) >>> 0
      const grain = ((grit >>> 16) & 31) - 15
      const packed = yards[ty * mapW + tx] === 1
      const speck = packed ? grain * 0.35 : grain
      const u = (x - tx * TILE) / TILE
      const v = (y - ty * TILE) / TILE
      const light = (packed ? 1.02 : 1.05) - u * 0.07 - v * 0.06
      r = (r + speck) * light
      g = (g + speck) * light
      b = (b + speck * 0.85) * light
      const p = (rowBase + x) * 4
      data[p] = r < 0 ? 0 : r > 255 ? 255 : r
      data[p + 1] = g < 0 ? 0 : g > 255 ? 255 : g
      data[p + 2] = b < 0 ? 0 : b > 255 ? 255 : b
      data[p + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)

  const wash = ctx.createLinearGradient(0, 0, width, height)
  wash.addColorStop(0, 'rgba(255, 246, 210, 0.07)')
  wash.addColorStop(0.55, 'rgba(0, 0, 0, 0)')
  wash.addColorStop(1, 'rgba(18, 36, 14, 0.12)')
  ctx.fillStyle = wash
  ctx.fillRect(0, 0, width, height)

  ctx.lineCap = 'round'
  for (let ty = 0; ty < mapH; ty++) {
    for (let tx = 0; tx < mapW; tx++) {
      const packed = yards[ty * mapW + tx] === 1
      const roll = hash2(tx + 3, ty + 9, seed + 17)
      const x = tx * TILE
      const y = ty * TILE
      const [tr, tg] = terrainRgb(tx + 0.5, ty + 0.5, seed)
      const dirt = tr > tg + 6
      if (packed) {
        if (roll > 0.7 && roll < 0.82) {
          ctx.strokeStyle = 'rgba(70, 110, 42, 0.35)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(x + 6, y + 20)
          ctx.lineTo(x + 10, y + 14)
          ctx.moveTo(x + 16, y + 22)
          ctx.lineTo(x + 18, y + 15)
          ctx.stroke()
        }
        continue
      }
      if (dirt) {
        if (roll > 0.55) {
          const px = x + 8 + hash2(tx, ty + 1, seed) * 16
          const py = y + 8 + hash2(tx + 2, ty, seed) * 14
          ctx.fillStyle = 'rgba(92, 70, 46, 0.55)'
          ctx.beginPath()
          ctx.ellipse(px, py, 2.1, 1.3, 0.4, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = 'rgba(214, 190, 150, 0.35)'
          ctx.fillRect(px - 1, py - 1, 1, 1)
        }
        continue
      }
      const sway = hash2(tx + 1, ty + 4, seed) * 6 - 3
      ctx.strokeStyle = roll > 0.5 ? 'rgba(64, 112, 40, 0.55)' : 'rgba(150, 186, 78, 0.45)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x + 8, y + 22)
      ctx.lineTo(x + 8 + sway, y + 14)
      ctx.moveTo(x + 18, y + 24)
      ctx.lineTo(x + 20 + sway * 0.4, y + 15)
      if (roll > 0.4) {
        ctx.moveTo(x + 13, y + 20)
        ctx.lineTo(x + 12 + sway * 0.3, y + 12)
      }
      ctx.stroke()
      if (roll > 0.28 && roll < 0.4) {
        ctx.fillStyle = 'rgba(48, 96, 36, 0.28)'
        ctx.beginPath()
        ctx.ellipse(x + 12 + sway, y + 16, 8, 3.4, 0.3, 0, Math.PI * 2)
        ctx.fill()
      } else if (roll > 0.84 && roll < 0.93) {
        ctx.fillStyle = 'rgba(186, 210, 96, 0.38)'
        ctx.beginPath()
        ctx.ellipse(x + 18, y + 12, 7, 3, -0.2, 0, Math.PI * 2)
        ctx.fill()
      }
      if (roll > 0.96) {
        const fx = x + 10 + hash2(tx + 6, ty, seed) * 12
        const fy = y + 10 + hash2(tx, ty + 6, seed) * 12
        ctx.fillStyle = hash2(tx + 8, ty + 2, seed) > 0.5 ? '#f2e27a' : '#f7f4ea'
        ctx.beginPath()
        ctx.arc(fx, fy, 1.35, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  ctx.strokeStyle = 'rgba(28, 20, 12, 0.65)'
  ctx.lineWidth = 4
  ctx.strokeRect(2, 2, width - 4, height - 4)
}

function poly(ctx: CanvasRenderingContext2D, points: Array<[number, number]>): void {
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

function rockSprites(): HTMLCanvasElement[] {
  if (rocks) return rocks
  const shapes: Array<Array<[number, number]>> = [
    [[10, 28], [14, 14], [22, 9], [33, 16], [31, 30], [18, 34]],
    [[8, 26], [16, 11], [27, 8], [35, 18], [28, 33], [12, 32]],
    [[12, 30], [11, 16], [20, 8], [31, 12], [34, 26], [22, 34]],
    [[9, 24], [15, 12], [26, 10], [34, 20], [30, 32], [14, 33]],
  ]
  const tops: Array<Array<[number, number]>> = [
    [[14, 16], [22, 11], [30, 17], [24, 22], [16, 22]],
    [[16, 14], [26, 10], [32, 18], [22, 20]],
    [[14, 18], [20, 11], [30, 14], [26, 22], [16, 24]],
    [[15, 15], [24, 12], [32, 20], [20, 22]],
  ]
  rocks = shapes.map((shape, variant) => {
    const canvas = document.createElement('canvas')
    canvas.width = 44
    canvas.height = 44
    const ctx = canvas.getContext('2d')
    if (!ctx) return canvas
    ctx.fillStyle = 'rgba(24, 32, 18, 0.32)'
    ctx.beginPath()
    ctx.ellipse(23, 35, 13, 4.2, 0.1, 0, Math.PI * 2)
    ctx.fill()
    const body = ctx.createLinearGradient(10, 8, 32, 34)
    body.addColorStop(0, variant % 2 === 0 ? '#d2c4b0' : '#c8bba6')
    body.addColorStop(0.42, variant === 2 ? '#8d7b68' : '#7e7266')
    body.addColorStop(1, '#4a4036')
    ctx.fillStyle = body
    poly(ctx, shape)
    ctx.fill()
    ctx.save()
    poly(ctx, shape)
    ctx.clip()
    ctx.fillStyle = 'rgba(62, 48, 36, 0.45)'
    ctx.fillRect(8, 24, 28, 14)
    ctx.restore()
    const cap = tops[variant] ?? tops[0]
    if (cap) {
      ctx.fillStyle = variant === 1 ? '#b7aa9a' : '#cfc3b2'
      poly(ctx, cap)
      ctx.fill()
      ctx.fillStyle = 'rgba(255, 248, 232, 0.55)'
      ctx.beginPath()
      ctx.ellipse(cap[0]?.[0] ?? 16, (cap[0]?.[1] ?? 14) + 1, 3.4, 1.7, -0.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.strokeStyle = 'rgba(42, 34, 28, 0.72)'
    ctx.lineWidth = 1
    poly(ctx, shape)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(58, 46, 36, 0.65)'
    ctx.beginPath()
    ctx.moveTo(16, 18)
    ctx.lineTo(22, 24)
    ctx.lineTo(19, 29)
    ctx.stroke()
    if (variant === 1 || variant === 3) {
      ctx.beginPath()
      ctx.moveTo(25, 15)
      ctx.lineTo(28, 22)
      ctx.stroke()
    }
    return canvas
  })
  return rocks
}

function leafClump(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
}

function paintBirch(ctx: CanvasRenderingContext2D, variant: number): void {
  ctx.fillStyle = 'rgba(28, 48, 22, 0.3)'
  ctx.beginPath()
  ctx.ellipse(26, 51, 15, 4.2, 0.05, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#cfc8b6'
  ctx.fillRect(21, 26, 6, 23)
  ctx.fillStyle = '#f3efe4'
  ctx.fillRect(21, 26, 2.4, 23)
  ctx.fillStyle = '#2c2c28'
  for (const mark of [30, 36, 41, 46]) ctx.fillRect(21, mark, 6, 1.15)
  const dark = variant === 0 ? '#2c6230' : '#347238'
  const mid = variant === 0 ? '#4c923f' : '#5aa348'
  const lit = variant === 0 ? '#8ec45c' : '#a4d46e'
  leafClump(ctx, 31, 24, 11, 9, dark)
  leafClump(ctx, 15, 23, 9, 8, '#214e28')
  leafClump(ctx, 23, 16, 12, 10, mid)
  leafClump(ctx, 14, 15, 7, 6, lit)
  leafClump(ctx, 28, 12, 6.5, 5, '#d4e89a')
  leafClump(ctx, 18, 11, 3.2, 2.4, 'rgba(244, 250, 214, 0.8)')
}

function paintWillow(ctx: CanvasRenderingContext2D, variant: number): void {
  ctx.fillStyle = 'rgba(28, 48, 22, 0.32)'
  ctx.beginPath()
  ctx.ellipse(24, 51, 16, 4.4, -0.1, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#6a5434'
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(24, 48)
  ctx.quadraticCurveTo(22, 36, variant === 2 ? 20 : 26, 26)
  ctx.stroke()
  ctx.strokeStyle = '#c4b496'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(23, 46)
  ctx.quadraticCurveTo(21, 36, variant === 2 ? 19 : 25, 28)
  ctx.stroke()
  const hang = variant === 2 ? 2 : -1
  leafClump(ctx, 16 + hang, 28, 10, 8, '#24562c')
  leafClump(ctx, 30 + hang, 26, 11, 8, '#2f6a34')
  leafClump(ctx, 22 + hang, 18, 12, 9, '#4e9442')
  leafClump(ctx, 12 + hang, 20, 7, 6, '#6aaa4e')
  leafClump(ctx, 32 + hang, 16, 7, 6, '#7eb856')
  leafClump(ctx, 20 + hang, 12, 6, 4.5, '#c6e08a')
  ctx.strokeStyle = 'rgba(46, 92, 40, 0.85)'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(16 + hang, 20)
  ctx.quadraticCurveTo(14 + hang, 30, 12 + hang, 36)
  ctx.moveTo(30 + hang, 18)
  ctx.quadraticCurveTo(33 + hang, 28, 34 + hang, 34)
  ctx.stroke()
}

function treeSprites(): HTMLCanvasElement[] {
  if (trees) return trees
  trees = []
  for (let variant = 0; variant < TREE_SPRITES; variant++) {
    const canvas = document.createElement('canvas')
    canvas.width = 48
    canvas.height = 58
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      trees.push(canvas)
      continue
    }
    if (variant < 2) paintBirch(ctx, variant)
    else paintWillow(ctx, variant)
    trees.push(canvas)
  }
  return trees
}

const ORE_SRC_W = 100
const ORE_SRC_H = 88
const ORE_DRAW_W = 50
const ORE_DRAW_H = 44

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function place(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rot: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  draw(ctx)
  ctx.restore()
}

function paintGear(ctx: CanvasRenderingContext2D, outer: number, teeth: number, rot: number): void {
  const root = outer * 0.72
  ctx.beginPath()
  for (let i = 0; i < teeth; i++) {
    const a = rot + (i / teeth) * Math.PI * 2
    const step = (Math.PI * 2) / teeth
    const bite = step * 0.46
    const pts: Array<[number, number]> = [
      [Math.cos(a) * root, Math.sin(a) * root],
      [Math.cos(a + bite * 0.18) * outer, Math.sin(a + bite * 0.18) * outer],
      [Math.cos(a + bite) * outer, Math.sin(a + bite) * outer],
      [Math.cos(a + step * 0.64) * root, Math.sin(a + step * 0.64) * root],
    ]
    for (let p = 0; p < pts.length; p++) {
      const point = pts[p]
      if (!point) continue
      if (i === 0 && p === 0) ctx.moveTo(point[0], point[1])
      else ctx.lineTo(point[0], point[1])
    }
  }
  ctx.closePath()
  const metal = ctx.createRadialGradient(-outer * 0.28, -outer * 0.32, outer * 0.1, 0, 0, outer)
  metal.addColorStop(0, '#e7eef6')
  metal.addColorStop(0.42, '#8d9bab')
  metal.addColorStop(1, '#3a4450')
  ctx.fillStyle = metal
  ctx.fill()
  ctx.strokeStyle = 'rgba(22, 26, 32, 0.55)'
  ctx.lineWidth = 1.4
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, 0, outer * 0.28, 0, Math.PI * 2)
  ctx.fillStyle = '#22282e'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(-outer * 0.08, -outer * 0.1, outer * 0.1, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
  ctx.fill()
}

/** Upright drum. The lid sits on the local +Y top. */
function paintBarrel(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cap = Math.max(5, h * 0.18)
  const rx = w / 2
  const body = ctx.createLinearGradient(-rx, 0, rx, 0)
  body.addColorStop(0, '#5a2812')
  body.addColorStop(0.32, '#e8924e')
  body.addColorStop(0.62, '#a34e24')
  body.addColorStop(1, '#3c1a0e')
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.moveTo(-rx, -h / 2 + cap)
  ctx.lineTo(-rx, h / 2 - cap)
  ctx.ellipse(0, h / 2 - cap, rx, cap, 0, Math.PI, 0, true)
  ctx.lineTo(rx, -h / 2 + cap)
  ctx.ellipse(0, -h / 2 + cap, rx, cap, 0, 0, Math.PI, true)
  ctx.closePath()
  ctx.fill()
  const lid = ctx.createLinearGradient(-rx, -h / 2, rx, -h / 2 + cap * 2)
  lid.addColorStop(0, '#f2c088')
  lid.addColorStop(0.55, '#c4622c')
  lid.addColorStop(1, '#6a3016')
  ctx.fillStyle = lid
  ctx.beginPath()
  ctx.ellipse(0, -h / 2 + cap, rx, cap, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(48, 22, 10, 0.75)'
  ctx.fillRect(-rx + 1, -h * 0.12, w - 2, 3.4)
  ctx.fillRect(-rx + 1, h * 0.16, w - 2, 3.4)
  ctx.strokeStyle = 'rgba(255, 226, 190, 0.4)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(-rx * 0.55, -h / 2 + cap + 2)
  ctx.lineTo(-rx * 0.55, h / 2 - cap)
  ctx.stroke()
  ctx.fillStyle = 'rgba(80, 32, 14, 0.42)'
  ctx.beginPath()
  ctx.ellipse(rx * 0.28, h * 0.02, rx * 0.32, h * 0.16, 0.4, 0, Math.PI * 2)
  ctx.fill()
}

function paintTire(ctx: CanvasRenderingContext2D, rx: number, ry: number): void {
  const rubber = ctx.createRadialGradient(-rx * 0.2, -ry * 0.28, rx * 0.2, 0, 0, rx)
  rubber.addColorStop(0, '#4c545e')
  rubber.addColorStop(0.55, '#1e2228')
  rubber.addColorStop(1, '#0c0e12')
  ctx.fillStyle = rubber
  ctx.beginPath()
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(150, 158, 168, 0.35)'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.ellipse(0, 0, rx * 0.8, ry * 0.8, 0, 0, Math.PI * 2)
  ctx.stroke()
  const rim = ctx.createRadialGradient(-rx * 0.12, -ry * 0.16, 1, 0, 0, rx * 0.48)
  rim.addColorStop(0, '#e4ecf4')
  rim.addColorStop(0.5, '#7c8896')
  rim.addColorStop(1, '#2a323a')
  ctx.fillStyle = rim
  ctx.beginPath()
  ctx.ellipse(0, 0, rx * 0.46, ry * 0.46, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(28, 32, 38, 0.7)'
  ctx.lineWidth = 1.3
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * rx * 0.16, Math.sin(a) * ry * 0.16)
    ctx.lineTo(Math.cos(a) * rx * 0.4, Math.sin(a) * ry * 0.4)
    ctx.stroke()
  }
  ctx.fillStyle = '#14181c'
  ctx.beginPath()
  ctx.ellipse(0, 0, rx * 0.14, ry * 0.14, 0, 0, Math.PI * 2)
  ctx.fill()
}

function paintPanel(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const metal = ctx.createLinearGradient(0, 0, w, h)
  metal.addColorStop(0, '#e8eef4')
  metal.addColorStop(0.38, '#9aa6b4')
  metal.addColorStop(1, '#46505c')
  ctx.fillStyle = metal
  rounded(ctx, -w / 2, -h / 2, w, h, 3)
  ctx.fill()
  ctx.strokeStyle = 'rgba(24, 28, 34, 0.4)'
  ctx.lineWidth = 1.3
  ctx.stroke()
  ctx.fillStyle = 'rgba(32, 38, 46, 0.4)'
  ctx.beginPath()
  ctx.ellipse(w * 0.12, h * 0.08, w * 0.22, h * 0.28, 0.45, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(-w / 2 + 4, -h / 2 + 2.5)
  ctx.lineTo(w / 2 - 6, -h / 2 + 2.5)
  ctx.stroke()
  ctx.fillStyle = '#f7fafc'
  for (const [px, py] of [
    [-w / 2 + 4, -h / 2 + 4],
    [w / 2 - 4, -h / 2 + 4],
    [-w / 2 + 4, h / 2 - 4],
    [w / 2 - 4, h / 2 - 4],
  ] as const) {
    ctx.beginPath()
    ctx.arc(px, py, 1.7, 0, Math.PI * 2)
    ctx.fill()
  }
}

function paintBoard(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const pcb = ctx.createLinearGradient(0, -h / 2, 0, h / 2)
  pcb.addColorStop(0, '#5aaa6c')
  pcb.addColorStop(1, '#1a4e30')
  ctx.fillStyle = pcb
  rounded(ctx, -w / 2, -h / 2, w, h, 2.5)
  ctx.fill()
  ctx.strokeStyle = '#e6c56e'
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(-w / 2 + 4, -h / 2 + 6)
  ctx.lineTo(-w * 0.05, -h / 2 + 6)
  ctx.lineTo(-w * 0.05, h * 0.05)
  ctx.lineTo(w / 2 - 4, h * 0.05)
  ctx.moveTo(-w / 2 + 5, h / 2 - 5)
  ctx.lineTo(w * 0.12, h / 2 - 5)
  ctx.lineTo(w * 0.12, h * 0.12)
  ctx.stroke()
  ctx.fillStyle = '#23282e'
  ctx.fillRect(-w * 0.18, -h * 0.12, w * 0.42, h * 0.32)
  ctx.fillStyle = 'rgba(198, 208, 216, 0.9)'
  ctx.fillRect(-w * 0.14, -h * 0.08, w * 0.34, 2.2)
  ctx.fillStyle = '#f0d48a'
  ctx.beginPath()
  ctx.arc(-w / 2 + 5, 0, 1.8, 0, Math.PI * 2)
  ctx.arc(w / 2 - 5, -h / 2 + 7, 1.8, 0, Math.PI * 2)
  ctx.fill()
}

function paintPipe(ctx: CanvasRenderingContext2D, len: number, r: number, rust = false): void {
  const metal = ctx.createLinearGradient(0, -r, 0, r)
  if (rust) {
    metal.addColorStop(0, '#f2c498')
    metal.addColorStop(0.42, '#c4622c')
    metal.addColorStop(1, '#4e2010')
  } else {
    metal.addColorStop(0, '#f4f8fc')
    metal.addColorStop(0.4, '#8e9bab')
    metal.addColorStop(1, '#323a44')
  }
  ctx.fillStyle = metal
  ctx.beginPath()
  ctx.arc(0, 0, r, Math.PI / 2, Math.PI * 1.5)
  ctx.arc(len, 0, r, Math.PI * 1.5, Math.PI / 2)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = rust ? '#6a3018' : '#5c6874'
  ctx.fillRect(len * 0.46, -r, 4.5, r * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
  ctx.fillRect(2, -r + 1.4, len - 4, 1.8)
}

function paintCable(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, width: number, stripe: string): void {
  const start = pts[0]
  if (!start || pts.length < 2) return
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(start[0], start[1])
  for (let i = 1; i < pts.length; i++) {
    const point = pts[i]
    if (point) ctx.lineTo(point[0], point[1])
  }
  ctx.strokeStyle = '#16181c'
  ctx.lineWidth = width
  ctx.stroke()
  ctx.strokeStyle = stripe
  ctx.lineWidth = Math.max(1.4, width * 0.28)
  ctx.stroke()
  ctx.restore()
}

function paintHousing(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const metal = ctx.createLinearGradient(0, 0, w, h)
  metal.addColorStop(0, '#d7e0ea')
  metal.addColorStop(0.55, '#7a8796')
  metal.addColorStop(1, '#36404a')
  ctx.fillStyle = metal
  poly(ctx, [
    [1, h * 0.22],
    [w * 0.7, 0],
    [w, h * 0.36],
    [w * 0.78, h],
    [0, h * 0.74],
  ])
  ctx.fill()
  ctx.fillStyle = '#171c22'
  poly(ctx, [
    [w * 0.26, h * 0.32],
    [w * 0.68, h * 0.22],
    [w * 0.6, h * 0.64],
    [w * 0.2, h * 0.58],
  ])
  ctx.fill()
  ctx.strokeStyle = '#e09048'
  ctx.lineWidth = 1.6
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(w * 0.32, h * 0.46)
  ctx.quadraticCurveTo(w * 0.48, h * 0.34, w * 0.56, h * 0.52)
  ctx.stroke()
}

function paintScrap(ctx: CanvasRenderingContext2D): void {
  const metal = ctx.createLinearGradient(-14, -8, 16, 10)
  metal.addColorStop(0, '#f6f9fc')
  metal.addColorStop(0.4, '#8d9aaa')
  metal.addColorStop(1, '#3c4652')
  ctx.fillStyle = metal
  poly(ctx, [
    [-14, -1],
    [-5, -10],
    [12, -6],
    [16, 5],
    [3, 11],
    [-10, 6],
  ])
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(-8, -3)
  ctx.lineTo(7, -1)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(90, 42, 22, 0.55)'
  ctx.beginPath()
  ctx.moveTo(1, -5)
  ctx.lineTo(8, 7)
  ctx.stroke()
}

function paintSpring(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = '#c5d0dc'
  ctx.lineWidth = 2.2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, 0)
  for (let i = 0; i < 5; i++) ctx.lineTo(i % 2 === 0 ? 9 : 0, (i + 1) * 3.4)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
  ctx.lineWidth = 0.8
  ctx.stroke()
}

function paintBolt(ctx: CanvasRenderingContext2D): void {
  const head = ctx.createRadialGradient(-1, -1, 0.4, 0, 0, 3.4)
  head.addColorStop(0, '#f4f7fb')
  head.addColorStop(1, '#6a7684')
  ctx.fillStyle = head
  ctx.beginPath()
  ctx.arc(0, 0, 3.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#2c343c'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(-1.8, 0)
  ctx.lineTo(1.8, 0)
  ctx.moveTo(0, -1.8)
  ctx.lineTo(0, 1.8)
  ctx.stroke()
}

function pileBarrelTire(ctx: CanvasRenderingContext2D): void {
  paintCable(ctx, [[16, 32], [32, 24], [50, 28], [68, 22], [84, 30]], 4.4, '#e2a43a')
  place(ctx, 22, 34, -0.5, (c) => paintBoard(c, 24, 30))
  place(ctx, 50, 30, -0.16, (c) => paintPanel(c, 42, 18))
  place(ctx, 76, 32, 0.35, (c) => paintHousing(c, 22, 16))
  place(ctx, 20, 46, 0.28, (c) => paintPipe(c, 40, 4.4, true))
  place(ctx, 58, 44, 0.2, (c) => paintGear(c, 12, 9, 0.35))
  place(ctx, 36, 58, Math.PI / 2 + 0.28, (c) => paintBarrel(c, 18, 36))
  place(ctx, 74, 56, -0.18, (c) => paintTire(c, 16, 13))
  place(ctx, 24, 68, 0.55, (c) => paintScrap(c))
  paintCable(ctx, [[42, 60], [34, 70], [50, 76], [66, 68], [76, 74]], 4.2, '#d0d6de')
  place(ctx, 84, 66, 0.5, (c) => paintSpring(c))
  place(ctx, 60, 64, 0, (c) => paintBolt(c))
}

function pilePanelGear(ctx: CanvasRenderingContext2D): void {
  place(ctx, 32, 28, 0.5, (c) => paintPipe(c, 34, 4.2))
  place(ctx, 60, 26, 2.1, (c) => paintPipe(c, 28, 3.8, true))
  place(ctx, 72, 42, 0.05, (c) => paintBarrel(c, 24, 36))
  place(ctx, 42, 44, -0.14, (c) => paintPanel(c, 46, 22))
  place(ctx, 26, 40, -0.4, (c) => paintBoard(c, 22, 18))
  place(ctx, 50, 48, -0.1, (c) => paintGear(c, 14, 10, 0.45))
  place(ctx, 22, 64, 0.12, (c) => paintTire(c, 16, 12))
  place(ctx, 80, 60, 0.4, (c) => paintHousing(c, 20, 14))
  paintCable(ctx, [[16, 54], [28, 66], [22, 76], [40, 72], [36, 62]], 4.6, '#d4542c')
  place(ctx, 58, 68, -0.35, (c) => paintScrap(c))
  place(ctx, 70, 70, 1.05, (c) => paintSpring(c))
  place(ctx, 40, 62, 0.2, (c) => paintBolt(c))
}

function pilePipeBoard(ctx: CanvasRenderingContext2D): void {
  place(ctx, 30, 40, 0.04, (c) => paintTire(c, 15, 17))
  place(ctx, 52, 32, -0.25, (c) => paintPanel(c, 36, 16))
  place(ctx, 70, 40, -0.7, (c) => paintBoard(c, 20, 26))
  place(ctx, 18, 50, 0.1, (c) => paintPipe(c, 48, 5))
  place(ctx, 30, 58, 0.72, (c) => paintPipe(c, 34, 4.2, true))
  place(ctx, 48, 52, 0.15, (c) => paintGear(c, 13, 8, 0.9))
  place(ctx, 68, 62, Math.PI / 2 + 0.22, (c) => paintBarrel(c, 17, 32))
  place(ctx, 28, 66, -0.35, (c) => paintHousing(c, 20, 14))
  paintCable(ctx, [[22, 36], [38, 34], [46, 48], [40, 60], [56, 68], [74, 62]], 4.6, '#e2a43a')
  place(ctx, 18, 70, 0.7, (c) => paintScrap(c))
  place(ctx, 84, 68, -0.2, (c) => paintSpring(c))
  place(ctx, 58, 70, 0.1, (c) => paintBolt(c))
}

function paintJunkPile(ctx: CanvasRenderingContext2D, variant: number): void {
  ctx.fillStyle = 'rgba(14, 10, 8, 0.42)'
  ctx.beginPath()
  ctx.ellipse(50, 74, 36, 10, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(72, 54, 36, 0.28)'
  ctx.beginPath()
  ctx.ellipse(50, 70, 24, 6, 0, 0, Math.PI * 2)
  ctx.fill()
  if (variant === 0) pileBarrelTire(ctx)
  else if (variant === 1) pilePanelGear(ctx)
  else pilePipeBoard(ctx)
}

function oreSprites(): HTMLCanvasElement[] {
  if (ore) return ore
  ore = [0, 1, 2].map((variant) => {
    const canvas = document.createElement('canvas')
    canvas.width = ORE_SRC_W
    canvas.height = ORE_SRC_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return canvas
    paintJunkPile(ctx, variant)
    return canvas
  })
  return ore
}

export function drawRockSprite(ctx: CanvasRenderingContext2D, tx: number, ty: number, seed: number): void {
  const sheet = rockSprites()
  const index = Math.floor(hash2(tx + 3, ty + 9, seed) * ROCK_SPRITES) % ROCK_SPRITES
  const sprite = sheet[index]
  if (!sprite) return
  ctx.drawImage(sprite, tx * TILE - 6, ty * TILE - 6)
}

export function drawTreeSprite(ctx: CanvasRenderingContext2D, tx: number, ty: number, seed: number): void {
  const sheet = treeSprites()
  const index = Math.floor(hash2(tx + 11, ty + 4, seed) * TREE_SPRITES) % TREE_SPRITES
  const sprite = sheet[index]
  if (!sprite) return
  ctx.drawImage(sprite, tx * TILE - 8, ty * TILE - 22)
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
    ctx.ellipse(x, y + 6, 18, 10, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  const sheet = oreSprites()
  const index = Math.floor(hash2(tx + 5, ty + 2, seed + 3) * ORE_SPRITES) % ORE_SPRITES
  const sprite = sheet[index]
  if (!sprite) return
  const ratio = full > 0 ? Math.max(0.15, Math.min(1, amount / full)) : 1
  const scale = 0.68 + 0.32 * ratio
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(sprite, -ORE_DRAW_W / 2, -32, ORE_DRAW_W, ORE_DRAW_H)
  ctx.restore()
}

function fade(dist: number): number {
  const t = Math.min(1, Math.max(0, dist / FOG_FADE))
  return t * t * (3 - 2 * t)
}

/** Soft fog tile. Sides are 0 same, 1 shroud, 2 clear. The map rim uses 0 so the edge stays solid. */
export function fogSprite(base: 'black' | 'shroud', n: number, e: number, s: number, w: number): HTMLCanvasElement {
  const key = `${base}:${n}${e}${s}${w}`
  const cached = fogCache.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = TILE
  canvas.height = TILE
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const image = ctx.createImageData(TILE, TILE)
  const data = image.data
  const selfAlpha = base === 'black' ? 255 : 148
  const sideAlpha = (side: number) => (side === 2 ? 0 : side === 1 ? 148 : selfAlpha)
  const north = sideAlpha(n)
  const east = sideAlpha(e)
  const south = sideAlpha(s)
  const west = sideAlpha(w)
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let alpha = selfAlpha
      if (n > 0) alpha = Math.min(alpha, north + (selfAlpha - north) * fade(y))
      if (e > 0) alpha = Math.min(alpha, east + (selfAlpha - east) * fade(TILE - 1 - x))
      if (s > 0) alpha = Math.min(alpha, south + (selfAlpha - south) * fade(TILE - 1 - y))
      if (w > 0) alpha = Math.min(alpha, west + (selfAlpha - west) * fade(x))
      const p = (y * TILE + x) * 4
      data[p] = 7
      data[p + 1] = 8
      data[p + 2] = 6
      data[p + 3] = alpha
    }
  }
  ctx.putImageData(image, 0, 0)
  fogCache.set(key, canvas)
  return canvas
}
