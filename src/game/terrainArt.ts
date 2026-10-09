import { CASTLE_YARD, pickFfaSites, pickKeepSites } from './map'
import { hash2 } from './rng'
import { BUILDING_STATS, FFA_MAP_H, FFA_MAP_W, TILE } from './types'

/**
 * Original procedural ground and props. Everything is drawn in code and cached:
 * the battlefield is one offscreen canvas, and rocks, trees, dumps, and fog
 * edges are small sprites reused every frame. Props are painted once on a
 * low-resolution canvas, outlined, and scaled with nearest-neighbor.
 */

const ROCK_SPRITES = 4
const TREE_SPRITES = 5
const ORE_SPRITES = 4
const ORE_LEVELS = 4
const PIXEL = 2
const FOG_FADE = 16

/** Minimap and HUD color for a scrap heap. */
export const DUMPS_COLOR = '#c6dc4a'

type Rgb = [number, number, number]

let yardKey = ''
let yardMask: Uint8Array | null = null
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

/** Large dirt, dry soil, gravel, and dark blotches. Sampled at tile centers for the minimap. */
export function terrainRgb(tx: number, ty: number, seed: number): Rgb {
  const n = fbm(tx * 0.17, ty * 0.17, seed)
  const blot = fbm(tx * 0.055 + 9, ty * 0.055 - 4, seed + 5)
  const dry: Rgb = [138, 108, 64]
  const dirt: Rgb = [112, 82, 46]
  const soil: Rgb = [96, 70, 40]
  const gravel: Rgb = [150, 136, 114]
  const dark: Rgb = [68, 52, 36]
  let color: Rgb
  if (n < 0.33) color = mix(soil, dry, n / 0.33)
  else if (n < 0.58) color = mix(dry, dirt, (n - 0.33) / 0.25)
  else if (n < 0.8) color = mix(dirt, gravel, (n - 0.58) / 0.22)
  else color = mix(gravel, soil, (n - 0.8) / 0.2)
  if (blot < 0.34) color = mix(color, dark, ((0.34 - blot) / 0.34) * 0.72)
  return color
}

export function terrainCss(tx: number, ty: number, seed: number, mapW: number, mapH: number): string {
  let [r, g, b] = terrainRgb(tx + 0.5, ty + 0.5, seed)
  if (yardAt(seed, mapW, mapH, tx, ty)) {
    r = r * 0.62 + 168 * 0.38
    g = g * 0.62 + 142 * 0.38
    b = b * 0.62 + 96 * 0.38
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`
}

function yardAt(seed: number, mapW: number, mapH: number, tx: number, ty: number): boolean {
  const yards = yardsFor(seed, mapW, mapH)
  if (tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) return false
  return yards[ty * mapW + tx] === 1
}

function yardsFor(seed: number, mapW: number, mapH: number): Uint8Array {
  const key = `${seed}:${mapW}x${mapH}`
  if (yardMask && yardKey === key) return yardMask
  const mask = new Uint8Array(mapW * mapH)
  const sites =
    mapW === FFA_MAP_W && mapH === FFA_MAP_H
      ? pickFfaSites(seed)
      : [pickKeepSites(seed).player, pickKeepSites(seed).enemy]
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
export function paintTerrain(ctx: CanvasRenderingContext2D, seed: number, mapW: number, mapH: number): void {
  const width = mapW * TILE
  const height = mapH * TILE
  const yards = yardsFor(seed, mapW, mapH)
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
  wash.addColorStop(0, 'rgba(255, 228, 186, 0.07)')
  wash.addColorStop(0.55, 'rgba(0, 0, 0, 0)')
  wash.addColorStop(1, 'rgba(28, 16, 8, 0.14)')
  ctx.fillStyle = wash
  ctx.fillRect(0, 0, width, height)

  for (let ty = 0; ty < mapH; ty++) {
    for (let tx = 0; tx < mapW; tx++) {
      const packed = yards[ty * mapW + tx] === 1
      const roll = hash2(tx + 3, ty + 9, seed + 17)
      const x = tx * TILE
      const y = ty * TILE
      if (packed) {
        if (roll > 0.72 && roll < 0.8) {
          ctx.fillStyle = 'rgba(90, 68, 40, 0.22)'
          ctx.fillRect(x + 4, y + 18, 18, 2)
        }
        continue
      }
      if (roll > 0.9) {
        const px = x + 6 + hash2(tx, ty + 1, seed) * 18
        const py = y + 8 + hash2(tx + 2, ty, seed) * 14
        ctx.fillStyle = 'rgba(62, 48, 34, 0.7)'
        ctx.beginPath()
        ctx.ellipse(px, py, 1.7, 1.15, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(220, 200, 160, 0.35)'
        ctx.fillRect(px - 1, py - 1, 1, 1)
      } else if (roll < 0.04) {
        ctx.strokeStyle = 'rgba(48, 34, 22, 0.55)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x + 5, y + 22)
        ctx.lineTo(x + 13, y + 17)
        ctx.lineTo(x + 24, y + 23)
        ctx.stroke()
      } else if (roll > 0.62 && roll < 0.66) {
        ctx.fillStyle = 'rgba(40, 28, 18, 0.18)'
        ctx.beginPath()
        ctx.ellipse(x + 16, y + 20, 7, 2.2, 0.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  ctx.strokeStyle = 'rgba(28, 20, 12, 0.65)'
  ctx.lineWidth = 4
  ctx.strokeRect(2, 2, width - 4, height - 4)
}

const INK = '#1a1410'
const STONE_L = '#b3a99c'
const STONE_M = '#7a7268'
const STONE_D = '#463f38'
const SOIL = '#6b4e30'
const SOIL_D = '#3e2c1a'
const BARK_L = '#8d623c'
const BARK_M = '#5c3d26'
const BARK_D = '#3a2618'
const BIRCH_L = '#efe4cc'
const BIRCH_M = '#d2c6aa'
const BIRCH_D = '#2c261c'
const OAK_L = '#9cbe58'
const OAK_M = '#3d7836'
const OAK_D = '#1b4622'
const PINE_L = '#6d9850'
const PINE_M = '#2d5c34'
const PINE_D = '#14301c'
const BIRCH_LEAF_L = '#c5d46e'
const BIRCH_LEAF_M = '#7c9844'
const BIRCH_LEAF_D = '#3c5a28'
const DRY = '#a08c64'

const SCRAP: Record<string, string> = {
  G: '#2e7634',
  a: '#d4b44a',
  M: '#8c949c',
  m: '#4c545c',
  L: '#c6ccd2',
  S: '#142028',
  s: '#3a6866',
  K: '#2a2c30',
  k: '#686c72',
  C: '#b44836',
  c: '#e4d6b4',
  T: '#c8ae68',
  t: '#7a663c',
  W: '#1c1a16',
}

let rockCache: HTMLCanvasElement[][] | null = null
let treeCache: HTMLCanvasElement[] | null = null
let oreCache: HTMLCanvasElement[][] | null = null
let dumpsIcon = ''
const glyphCache = new Map<string, HTMLCanvasElement>()

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color
  ctx.fillRect(x, y, 1, 1)
}

function insideTri(px: number, py: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): boolean {
  const a = (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0)
  const b = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)
  const c = (x0 - x2) * (py - y2) - (y0 - y2) * (px - x2)
  return (a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0)
}

/** One angular shard. The left side is lit and the right side is in shade. */
function shard(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): void {
  const minX = Math.floor(Math.min(x0, x1, x2))
  const maxX = Math.ceil(Math.max(x0, x1, x2))
  const minY = Math.floor(Math.min(y0, y1, y2))
  const maxY = Math.ceil(Math.max(y0, y1, y2))
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!insideTri(x + 0.5, y + 0.5, x0, y0, x1, y1, x2, y2)) continue
      const u = (x - minX) / Math.max(1, maxX - minX)
      const top = y <= minY + 1 && u < 0.72
      dot(ctx, x, y, top || u < 0.36 ? STONE_L : u < 0.68 ? STONE_M : STONE_D)
    }
  }
}

function skirt(ctx: CanvasRenderingContext2D, w: number, ground: number): void {
  for (let x = 1; x < w - 1; x++) {
    const rise = (x * 5) % 3
    for (let y = ground - rise; y <= ground + 1; y++) {
      if (y < ground - 1 && (x < 3 || x > w - 4)) continue
      if (y < ground && x > 2 && x < w - 3 && rise === 0) continue
      dot(ctx, x, y, y >= ground ? SOIL_D : SOIL)
    }
  }
  for (const x of [2, 6, w - 4]) {
    dot(ctx, x, ground + 2, STONE_D)
    dot(ctx, x + 1, ground + 2, STONE_M)
  }
}

function crack(ctx: CanvasRenderingContext2D, x: number, y: number, stage: number): void {
  const steps = 2 + stage
  for (let i = 0; i < steps; i++) {
    dot(ctx, x + (i % 2), y + i, INK)
    if (stage >= 2 && i % 2 === 1) dot(ctx, x + 2, y + i, INK)
  }
}

function outline(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const image = ctx.getImageData(0, 0, w, h)
  const src = new Uint8ClampedArray(image.data)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      if ((src[p + 3] ?? 0) > 24) continue
      let touch = false
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        if ((src[(ny * w + nx) * 4 + 3] ?? 0) > 220) {
          touch = true
          break
        }
      }
      if (!touch) continue
      image.data[p] = 0x1a
      image.data[p + 1] = 0x14
      image.data[p + 2] = 0x10
      image.data[p + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
}

function bake(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const low = document.createElement('canvas')
  low.width = w
  low.height = h
  const src = low.getContext('2d')
  if (!src) return low
  paint(src)
  const out = document.createElement('canvas')
  out.width = w * PIXEL
  out.height = h * PIXEL
  const ctx = out.getContext('2d')
  if (!ctx) return out
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(low, 0, 0, out.width, out.height)
  return out
}

function shadeOval(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  ctx.fillStyle = 'rgba(16, 12, 8, 0.38)'
  const x0 = Math.floor(cx - rx)
  const x1 = Math.ceil(cx + rx)
  const y0 = Math.floor(cy - ry)
  const y1 = Math.ceil(cy + ry)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x + 0.5 - cx) / rx
      const ny = (y + 0.5 - cy) / ry
      if (nx * nx + ny * ny <= 1) ctx.fillRect(x, y, 1, 1)
    }
  }
}

type Shard = [number, number, number, number, number, number]

const CLUSTERS: Shard[][] = [
  [
    [2, 8, 5, 4, 8, 8],
    [7, 8, 10, 3, 14, 8],
    [13, 8, 15, 5, 17, 8],
  ],
  [
    [1, 8, 3, 5, 5, 8],
    [4, 8, 7, 3, 9, 8],
    [8, 8, 11, 5, 13, 8],
    [12, 8, 15, 4, 17, 8],
  ],
  [
    [2, 8, 6, 3, 10, 8],
    [9, 8, 13, 2, 17, 8],
  ],
  [
    [2, 8, 5, 5, 8, 8],
    [6, 8, 9, 6, 12, 8],
    [11, 8, 14, 3, 17, 8],
  ],
]

function paintCrag(variant: number, stage: number): HTMLCanvasElement {
  const parts = CLUSTERS[variant] ?? CLUSTERS[0] ?? []
  const w = 18
  const h = 13
  return bake(w, h, (ctx) => {
    shadeOval(ctx, 9, 10, 6, 1.4)
    for (const part of parts) shard(ctx, part[0], part[1], part[2], part[3], part[4], part[5])
    const tall = parts.reduce((best, part) => (part[3] < best[3] ? part : best), parts[0] ?? [8, 8, 9, 4, 10, 8])
    crack(ctx, tall[2], tall[3] + 1, stage)
    if (stage >= 2 && parts.length > 1) {
      const other = parts[0] === tall ? parts[1] : parts[0]
      if (other) crack(ctx, other[2], other[3] + 1, stage - 2)
    }
    skirt(ctx, w, 8)
    outline(ctx, w, h)
  })
}

function cragSheet(): HTMLCanvasElement[][] {
  if (rockCache) return rockCache
  rockCache = []
  for (let variant = 0; variant < ROCK_SPRITES; variant++) {
    const row: HTMLCanvasElement[] = []
    for (let stage = 0; stage < 4; stage++) row.push(paintCrag(variant, stage))
    rockCache.push(row)
  }
  return rockCache
}

export function rockProp(variant: number, stage: number): HTMLCanvasElement {
  const row = cragSheet()[variant % ROCK_SPRITES]
  return row?.[Math.max(0, Math.min(3, stage))] ?? paintCrag(0, 0)
}

function clump(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const d = Math.abs(x - cx) + Math.abs(y - cy)
      if (d <= r || (d === r + 1 && ((x + y) & 1) === 0)) dot(ctx, x, y, color)
    }
  }
}

function twig(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps
    dot(ctx, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), color)
  }
}

function bole(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number, birch: boolean): void {
  for (let y = y0; y <= y1; y++) {
    if (birch) {
      const mark = y % 4 === 0
      dot(ctx, x, y, mark ? BIRCH_D : BIRCH_L)
      dot(ctx, x + 1, y, mark ? BIRCH_D : BIRCH_M)
    } else {
      dot(ctx, x, y, y % 2 === 0 ? BARK_L : BARK_M)
      dot(ctx, x + 1, y, BARK_M)
      dot(ctx, x + 2, y, y % 3 === 0 ? BARK_D : BARK_M)
    }
  }
  const foot = birch ? x : x
  dot(ctx, foot - 1, y1, birch ? BIRCH_M : BARK_D)
  dot(ctx, foot - 2, y1 + 1, birch ? BIRCH_D : BARK_D)
  dot(ctx, foot + (birch ? 2 : 3), y1, birch ? BIRCH_M : BARK_M)
  dot(ctx, foot + (birch ? 3 : 4), y1 + 1, birch ? BIRCH_D : BARK_D)
}

function clumps(ctx: CanvasRenderingContext2D, spots: Array<[number, number, number]>, color: string): void {
  for (const [x, y, r] of spots) clump(ctx, x, y, r, color)
}

function paintOak(ctx: CanvasRenderingContext2D): void {
  shadeOval(ctx, 15, 31, 10, 2)
  twig(ctx, 15, 22, 5, 14, BARK_D)
  twig(ctx, 16, 21, 25, 13, BARK_D)
  twig(ctx, 15, 18, 8, 10, BARK_M)
  twig(ctx, 16, 19, 22, 11, BARK_M)
  twig(ctx, 5, 14, 4, 17, BARK_D)
  twig(ctx, 25, 13, 26, 16, BARK_D)
  bole(ctx, 14, 20, 29, false)
  clumps(ctx, [
    [8, 16, 3], [15, 15, 4], [22, 16, 3], [11, 18, 3], [19, 18, 3], [6, 14, 2], [24, 14, 2], [15, 20, 2],
  ], OAK_D)
  clumps(ctx, [
    [9, 12, 3], [15, 10, 4], [21, 12, 3], [6, 13, 2], [24, 12, 2], [12, 15, 3], [18, 14, 3], [15, 17, 2],
  ], OAK_M)
  clumps(ctx, [
    [11, 8, 2], [16, 7, 2], [8, 10, 2], [20, 9, 2], [14, 12, 2],
  ], OAK_L)
  twig(ctx, 7, 16, 3, 20, BARK_D)
  twig(ctx, 23, 15, 27, 19, BARK_M)
  twig(ctx, 15, 18, 18, 22, BARK_D)
}

function paintPine(ctx: CanvasRenderingContext2D): void {
  shadeOval(ctx, 13, 31, 8, 1.8)
  bole(ctx, 12, 16, 29, false)
  const layer = (apex: number, rows: number, half: number) => {
    for (let row = 0; row < rows; row++) {
      const y = apex + row
      const wide = Math.max(1, Math.round((half * (row + 1)) / rows))
      for (let x = 13 - wide; x <= 13 + wide; x++) {
        dot(ctx, x, y, x < 12 ? PINE_L : x < 15 ? PINE_M : PINE_D)
      }
    }
  }
  layer(2, 6, 4)
  layer(9, 7, 6)
  layer(17, 8, 8)
  dot(ctx, 8, 22, PINE_D)
  dot(ctx, 19, 21, PINE_M)
  dot(ctx, 19, 22, PINE_D)
}

function paintBirch(ctx: CanvasRenderingContext2D): void {
  shadeOval(ctx, 13, 31, 7, 1.7)
  twig(ctx, 13, 18, 6, 12, BIRCH_D)
  twig(ctx, 14, 17, 20, 11, BIRCH_D)
  twig(ctx, 6, 12, 5, 15, BIRCH_D)
  twig(ctx, 20, 11, 21, 14, BIRCH_D)
  bole(ctx, 12, 16, 29, true)
  clumps(ctx, [
    [8, 13, 2], [13, 12, 3], [18, 13, 2], [13, 16, 2],
  ], BIRCH_LEAF_D)
  clumps(ctx, [
    [9, 10, 2], [13, 8, 3], [17, 10, 2], [7, 12, 2], [19, 11, 2],
  ], BIRCH_LEAF_M)
  clumps(ctx, [
    [11, 7, 2], [15, 6, 2], [9, 9, 1],
  ], BIRCH_LEAF_L)
}

function paintDead(ctx: CanvasRenderingContext2D): void {
  shadeOval(ctx, 14, 29, 7, 1.6)
  bole(ctx, 13, 12, 27, false)
  twig(ctx, 14, 14, 4, 6, BARK_M)
  twig(ctx, 15, 13, 24, 5, BARK_D)
  twig(ctx, 14, 18, 6, 13, BARK_D)
  twig(ctx, 15, 17, 23, 11, BARK_M)
  twig(ctx, 14, 10, 9, 6, BARK_D)
  twig(ctx, 4, 6, 3, 4, BARK_D)
  twig(ctx, 24, 5, 26, 3, BARK_M)
  dot(ctx, 3, 3, DRY)
  dot(ctx, 26, 2, DRY)
  dot(ctx, 6, 12, DRY)
  dot(ctx, 23, 10, DRY)
}

function paintBush(ctx: CanvasRenderingContext2D): void {
  shadeOval(ctx, 13, 17, 8, 1.6)
  twig(ctx, 12, 12, 6, 9, BARK_D)
  twig(ctx, 14, 12, 20, 9, BARK_D)
  bole(ctx, 12, 12, 15, false)
  clumps(ctx, [
    [7, 12, 2], [13, 11, 3], [19, 12, 2], [10, 13, 2], [16, 13, 2],
  ], OAK_D)
  clumps(ctx, [
    [8, 9, 2], [13, 8, 3], [18, 9, 2], [5, 11, 2], [21, 11, 2],
  ], OAK_M)
  clumps(ctx, [
    [10, 7, 2], [15, 6, 2], [7, 8, 1],
  ], OAK_L)
}

function treeSheet(): HTMLCanvasElement[] {
  if (treeCache) return treeCache
  const jobs: Array<{ w: number; h: number; paint: (ctx: CanvasRenderingContext2D) => void }> = [
    { w: 30, h: 34, paint: paintOak },
    { w: 28, h: 34, paint: paintPine },
    { w: 26, h: 34, paint: paintBirch },
    { w: 30, h: 32, paint: paintDead },
    { w: 26, h: 20, paint: paintBush },
  ]
  treeCache = jobs.map((job) =>
    bake(job.w, job.h, (ctx) => {
      job.paint(ctx)
      outline(ctx, job.w, job.h)
    }),
  )
  return treeCache
}

export function treeProp(variant: number): HTMLCanvasElement {
  const sheet = treeSheet()
  return sheet[variant % TREE_SPRITES] ?? bake(8, 8, () => undefined)
}

function glyph(rows: string[]): HTMLCanvasElement {
  const key = rows.join('|')
  const cached = glyphCache.get(key)
  if (cached) return cached
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0) + 2
  const height = rows.length + 2
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx) {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y] ?? ''
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]
        if (!ch || ch === ' ') continue
        const color = SCRAP[ch]
        if (color) dot(ctx, x + 1, y + 1, color)
      }
    }
    outline(ctx, width, height)
  }
  glyphCache.set(key, canvas)
  return canvas
}

const PARTS: Record<string, string[]> = {
  pcb: ['GGGGGG', 'GaaaGG', 'GGGGGG'],
  crt: ['SSSSS', 'SsssS', 'SsssS', 'MMMMM'],
  lcd: ['ssss', 'sSSs', 'MMMM'],
  keys: ['kkkkkk', 'KKKKKK'],
  hdd: ['MMMM', 'MmmM'],
  fan: [' MMM ', 'M m M', 'MmmMM', 'M m M', ' MMM '],
  can: ['TTT', 'TtT', 'TtT', 'TTT'],
  cap: ['cc', 'CC', 'CC'],
  wire: ['WW ', ' WW', 'W W'],
  box: ['LLLL', 'LmmL', 'LLLL'],
  bit: ['GG', 'Ga'],
}

type Pile = { id: string; x: number; y: number; level: number }

const PILES: Pile[][] = [
  [
    { id: 'wire', x: 1, y: 12, level: 1 },
    { id: 'can', x: 16, y: 11, level: 1 },
    { id: 'cap', x: 6, y: 13, level: 1 },
    { id: 'bit', x: 19, y: 13, level: 1 },
    { id: 'keys', x: 7, y: 9, level: 2 },
    { id: 'hdd', x: 14, y: 10, level: 2 },
    { id: 'crt', x: 3, y: 5, level: 3 },
    { id: 'pcb', x: 11, y: 7, level: 3 },
    { id: 'fan', x: 8, y: 1, level: 4 },
    { id: 'box', x: 16, y: 3, level: 4 },
  ],
  [
    { id: 'wire', x: 2, y: 13, level: 1 },
    { id: 'can', x: 15, y: 12, level: 1 },
    { id: 'bit', x: 1, y: 11, level: 1 },
    { id: 'keys', x: 5, y: 10, level: 2 },
    { id: 'box', x: 13, y: 9, level: 2 },
    { id: 'lcd', x: 4, y: 6, level: 3 },
    { id: 'hdd', x: 12, y: 7, level: 3 },
    { id: 'crt', x: 7, y: 2, level: 4 },
    { id: 'pcb', x: 15, y: 4, level: 4 },
  ],
  [
    { id: 'cap', x: 2, y: 12, level: 1 },
    { id: 'wire', x: 8, y: 13, level: 1 },
    { id: 'can', x: 16, y: 12, level: 1 },
    { id: 'hdd', x: 4, y: 9, level: 2 },
    { id: 'keys', x: 11, y: 10, level: 2 },
    { id: 'fan', x: 6, y: 4, level: 3 },
    { id: 'pcb', x: 13, y: 6, level: 3 },
    { id: 'lcd', x: 3, y: 2, level: 4 },
    { id: 'box', x: 14, y: 2, level: 4 },
  ],
  [
    { id: 'wire', x: 1, y: 11, level: 1 },
    { id: 'can', x: 6, y: 12, level: 1 },
    { id: 'can', x: 16, y: 12, level: 1 },
    { id: 'cap', x: 12, y: 13, level: 1 },
    { id: 'bit', x: 19, y: 11, level: 1 },
    { id: 'box', x: 8, y: 9, level: 2 },
    { id: 'hdd', x: 3, y: 8, level: 2 },
    { id: 'crt', x: 5, y: 4, level: 3 },
    { id: 'keys', x: 13, y: 7, level: 3 },
    { id: 'pcb', x: 12, y: 1, level: 4 },
    { id: 'fan', x: 4, y: 1, level: 4 },
  ],
]

function paintPile(variant: number, level: number): HTMLCanvasElement {
  const places = PILES[variant] ?? PILES[0] ?? []
  return bake(24, 18, (ctx) => {
    shadeOval(ctx, 12, 15, 8, 1.8)
    for (let y = 12; y <= 15; y++) {
      const inset = y === 12 ? 6 : y === 13 ? 4 : 2
      for (let x = inset; x < 24 - inset; x++) dot(ctx, x, y, y > 13 ? '#22241e' : '#34382f')
    }
    outline(ctx, 24, 18)
    for (const place of places) {
      if (place.level > level) continue
      const rows = PARTS[place.id]
      if (!rows) continue
      ctx.drawImage(glyph(rows), place.x, place.y)
    }
  })
}

function pileSheet(): HTMLCanvasElement[][] {
  if (oreCache) return oreCache
  oreCache = []
  for (let variant = 0; variant < ORE_SPRITES; variant++) {
    const row: HTMLCanvasElement[] = []
    for (let level = 1; level <= ORE_LEVELS; level++) row.push(paintPile(variant, level))
    oreCache.push(row)
  }
  return oreCache
}

export function oreProp(variant: number, level: number): HTMLCanvasElement {
  const row = pileSheet()[variant % ORE_SPRITES]
  const index = Math.max(1, Math.min(ORE_LEVELS, level)) - 1
  return row?.[index] ?? paintPile(0, 4)
}

/** Static portrait for the Dumps selection panel. */
export function dumpsPortraitUrl(): string {
  if (typeof document === 'undefined') return ''
  if (dumpsIcon) return dumpsIcon
  const sprite = oreProp(0, 4)
  const out = document.createElement('canvas')
  out.width = 40
  out.height = 40
  const ctx = out.getContext('2d')
  if (!ctx) return ''
  ctx.imageSmoothingEnabled = false
  const scale = Math.min(36 / sprite.width, 36 / sprite.height)
  const dw = Math.round(sprite.width * scale)
  const dh = Math.round(sprite.height * scale)
  ctx.drawImage(sprite, (40 - dw) / 2, (40 - dh) / 2 + 1, dw, dh)
  dumpsIcon = out.toDataURL()
  return dumpsIcon
}

function crackStage(ratio: number): number {
  if (ratio > 0.82) return 0
  if (ratio > 0.55) return 1
  if (ratio > 0.3) return 2
  return 3
}

function pileLevel(amount: number, full: number): number {
  const ratio = full > 0 ? amount / full : 1
  if (ratio > 0.72) return 4
  if (ratio > 0.48) return 3
  if (ratio > 0.22) return 2
  return 1
}

export function drawRockSprite(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  seed: number,
  hpRatio = 1,
): void {
  const index = Math.floor(hash2(tx + 3, ty + 9, seed) * ROCK_SPRITES) % ROCK_SPRITES
  const sprite = rockProp(index, crackStage(hpRatio))
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(sprite, tx * TILE + (TILE - sprite.width) / 2, ty * TILE + TILE - sprite.height + 2)
}

export function drawTreeSprite(ctx: CanvasRenderingContext2D, tx: number, ty: number, seed: number): void {
  const index = Math.floor(hash2(tx + 11, ty + 4, seed) * TREE_SPRITES) % TREE_SPRITES
  const sprite = treeProp(index)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(sprite, tx * TILE + (TILE - sprite.width) / 2, ty * TILE + TILE - sprite.height + 8)
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
  const sprite = oreProp(index, pileLevel(amount, full))
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(sprite, x - sprite.width / 2, y - sprite.height / 2 + 6)
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
