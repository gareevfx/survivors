import { CASTLE_YARD, pickFfaSites, pickKeepSites } from './map'
import { hash2 } from './rng'
import { BUILDING_STATS, FFA_MAP_H, FFA_MAP_W, TILE } from './types'

/**
 * Original procedural ground and props. Everything is drawn in code and cached:
 * the battlefield is one offscreen canvas, and rocks, trees, dumps, and fog
 * edges are small sprites reused every frame. Props are painted on a
 * low-resolution canvas and scaled with nearest-neighbor.
 */

const ROCK_SPRITES = 3
const TREE_SPRITES = 4
const ORE_SPRITES = 4
const ORE_LEVELS = 4
const PIXEL = 2
const FOG_FADE = 16

/** Minimap and HUD color for a scrap heap. Bright on dirt, distinct from trees. */
export const DUMPS_COLOR = '#c6e24a'

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

type Led = { x: number; y: number; color: string; phase: number }
type ScrapSprite = { canvas: HTMLCanvasElement; leds: Led[] }

const INK = '#1a1410'
const STONE_L = '#b0a698'
const STONE_M = '#7a7268'
const STONE_D = '#4a433c'
const SOIL = '#7a5834'
const SOIL_D = '#4e3824'
const MOSS = '#6e8f48'
const LEAF_L = '#8fbc58'
const LEAF_M = '#3f7a3c'
const LEAF_D = '#1e4c28'
const PINE_L = '#6a9a58'
const PINE_M = '#2f6238'
const PINE_D = '#163820'
const BARK_L = '#8a6244'
const BARK_M = '#5a3c28'
const BARK_D = '#3a2618'
const DRY = '#a09068'

const SCRAP: Record<string, string> = {
  G: '#2f7a38',
  g: '#4e9a48',
  a: '#e2c15a',
  M: '#8e969e',
  m: '#4a5158',
  L: '#d5dbe2',
  S: '#102028',
  s: '#49d0c0',
  K: '#2c2e32',
  k: '#6a6e74',
  C: '#c24a32',
  c: '#f0e2c0',
  T: '#d4c078',
  t: '#8a7040',
  W: '#1c1a18',
}
const LED_DIM: Record<string, string> = { R: '#7a2820', E: '#1a5a28', '*': '#8a6a20' }
const LED_ON: Record<string, string> = { R: '#ff5544', E: '#7dff6a', '*': '#ffe56a' }

let rockCache: HTMLCanvasElement[][] | null = null
let treeCache: HTMLCanvasElement[] | null = null
let oreCache: ScrapSprite[][] | null = null
let dumpsIcon = ''
const glyphCache = new Map<string, { canvas: HTMLCanvasElement; leds: Array<{ x: number; y: number; color: string }> }>()

function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color
  ctx.fillRect(x, y, 1, 1)
}

function blob(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string): void {
  const x0 = Math.floor(cx - rx)
  const x1 = Math.ceil(cx + rx)
  const y0 = Math.floor(cy - ry)
  const y1 = Math.ceil(cy + ry)
  ctx.fillStyle = color
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x + 0.5 - cx) / rx
      const ny = (y + 0.5 - cy) / ry
      if (nx * nx + ny * ny <= 1) ctx.fillRect(x, y, 1, 1)
    }
  }
}

function outline(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const image = ctx.getImageData(0, 0, w, h)
  const src = new Uint8ClampedArray(image.data)
  const ink = 0x1a
  const inkG = 0x14
  const inkB = 0x10
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      if ((src[p + 3] ?? 0) > 20) continue
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
        const np = (ny * w + nx) * 4
        if ((src[np + 3] ?? 0) > 220) {
          touch = true
          break
        }
      }
      if (!touch) continue
      image.data[p] = ink
      image.data[p + 1] = inkG
      image.data[p + 2] = inkB
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

function shadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  blob(ctx, cx, cy, rx, ry, 'rgba(18, 12, 8, 0.4)')
}

type Peak = { x: number; top: number; bot: number; half: number; flat: boolean }

const CRAGS: Array<{ w: number; h: number; peaks: Peak[] }> = [
  { w: 16, h: 20, peaks: [{ x: 8, top: 1, bot: 14, half: 5, flat: false }] },
  {
    w: 18,
    h: 18,
    peaks: [
      { x: 5, top: 3, bot: 12, half: 3, flat: false },
      { x: 12, top: 1, bot: 12, half: 3.4, flat: false },
    ],
  },
  { w: 18, h: 16, peaks: [{ x: 9, top: 3, bot: 10, half: 7, flat: true }] },
]

function paintRock(variant: number, stage: number): HTMLCanvasElement {
  const spec = CRAGS[variant] ?? CRAGS[0]
  if (!spec) return bake(8, 8, () => undefined)
  const { w, h, peaks } = spec
  return bake(w, h, (ctx) => {
    const bot = peaks[0]?.bot ?? h - 5
    shadow(ctx, w / 2 + 0.5, bot + 2.2, w / 2 - 2, 1.5)
    for (const peak of peaks) {
      const span = Math.max(1, peak.bot - peak.top)
      for (let y = peak.top; y <= peak.bot; y++) {
        const t = (y - peak.top) / span
        const shelf = !peak.flat && ((t > 0.38 && t < 0.5) || (t > 0.66 && t < 0.78)) ? 1.7 : 0
        const wide = peak.flat
          ? t < 0.42
            ? peak.half
            : peak.half * (1 - (t - 0.42) * 0.15)
          : peak.half * (0.32 + t * 0.78) + shelf
        const jag = peak.flat ? (y % 5 === 0 ? 1 : 0) : y % 3 === 0 ? -1 : y % 3 === 1 ? 1 : 0
        const left = Math.round(peak.x - wide + jag)
        const right = Math.round(peak.x + wide)
        for (let x = left; x <= right; x++) {
          if (x < 1 || x >= w - 1) continue
          const u = (x - left) / Math.max(1, right - left)
          const litTop = y <= peak.top + 1 && u < 0.8
          const color = litTop || u < 0.34 ? STONE_L : u < 0.68 ? STONE_M : STONE_D
          px(ctx, x, y, color)
        }
      }
    }
    const lip = bot
    for (let x = 1; x < w - 1; x++) {
      const climb = 2 + ((x * 3 + variant * 2) % 3)
      for (let y = lip - climb; y <= lip + 1; y++) {
        const flank = x < 3 || x > w - 4
        if (y < lip - 1 && !flank) continue
        px(ctx, x, y, y >= lip ? SOIL_D : SOIL)
      }
    }
    for (const x of [2, 5, w - 5, w - 3]) {
      px(ctx, x, lip + 2, STONE_D)
      px(ctx, x + 1, lip + 2, STONE_M)
    }
    const tall = peaks.reduce((best, peak) => (peak.top < best.top ? peak : best), peaks[0] ?? { x: 4, top: 2, bot, half: 3, flat: false })
    if (stage >= 1) {
      const steps = 2 + stage * 2
      for (let i = 0; i < steps; i++) {
        const x = tall.x - 1 + (i % 2)
        const y = tall.top + 3 + i
        if (y < lip - 1) px(ctx, x, y, INK)
        if (stage >= 2 && i % 3 === 2 && y < lip - 1) px(ctx, x + 2, y, INK)
      }
    }
    if (stage >= 3) {
      for (let i = 0; i < 4; i++) px(ctx, tall.x + 2, tall.top + 5 + i, INK)
    }
    outline(ctx, w, h)
    px(ctx, tall.x - 2, lip - 3, MOSS)
    px(ctx, tall.x - 1, lip - 4, MOSS)
    px(ctx, 3, lip, MOSS)
    px(ctx, w - 5, lip, MOSS)
  })
}

function rockSheet(): HTMLCanvasElement[][] {
  if (rockCache) return rockCache
  rockCache = []
  for (let variant = 0; variant < ROCK_SPRITES; variant++) {
    const row: HTMLCanvasElement[] = []
    for (let stage = 0; stage < 4; stage++) row.push(paintRock(variant, stage))
    rockCache.push(row)
  }
  return rockCache
}

export function rockProp(variant: number, stage: number): HTMLCanvasElement {
  const row = rockSheet()[variant % ROCK_SPRITES]
  return row?.[Math.max(0, Math.min(3, stage))] ?? paintRock(0, 0)
}

function trunk(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    px(ctx, x, y, y % 3 === 0 ? BARK_D : BARK_L)
    px(ctx, x + 1, y, y % 2 === 0 ? BARK_M : BARK_L)
    px(ctx, x + 2, y, BARK_D)
  }
}

function roots(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  px(ctx, x - 1, y, BARK_M)
  px(ctx, x - 2, y + 1, BARK_D)
  px(ctx, x - 3, y + 1, BARK_D)
  px(ctx, x + 3, y, BARK_M)
  px(ctx, x + 4, y + 1, BARK_D)
  px(ctx, x + 5, y + 1, BARK_D)
}

function paintOak(ctx: CanvasRenderingContext2D): void {
  shadow(ctx, 12, 25, 8, 2.1)
  blob(ctx, 14, 12, 6.2, 4.4, LEAF_D)
  blob(ctx, 8, 13, 4.4, 3.4, LEAF_D)
  blob(ctx, 11, 10, 6.4, 4.6, LEAF_M)
  blob(ctx, 7, 11, 3.6, 2.8, LEAF_M)
  blob(ctx, 15, 10, 3.2, 2.6, LEAF_M)
  blob(ctx, 9, 8, 3.6, 2.6, LEAF_L)
  blob(ctx, 6, 9, 2, 1.6, LEAF_L)
  blob(ctx, 13, 7, 2.2, 1.6, LEAF_L)
  px(ctx, 17, 15, LEAF_D)
  px(ctx, 17, 16, LEAF_M)
  px(ctx, 18, 16, LEAF_D)
  px(ctx, 4, 14, LEAF_D)
  px(ctx, 4, 15, LEAF_M)
  trunk(ctx, 10, 15, 22)
  roots(ctx, 10, 22)
}

function paintPine(ctx: CanvasRenderingContext2D): void {
  shadow(ctx, 12, 26, 7, 1.8)
  const layer = (apex: number, rows: number, half: number) => {
    for (let row = 0; row < rows; row++) {
      const y = apex + row
      const wide = Math.max(1, Math.round((half * (row + 1)) / rows))
      for (let x = 11 - wide; x <= 11 + wide; x++) {
        const color = x < 10 ? PINE_L : x < 12 ? PINE_M : PINE_D
        px(ctx, x, y, color)
      }
    }
  }
  layer(2, 6, 3)
  layer(6, 7, 5)
  layer(11, 8, 7)
  px(ctx, 8, 18, PINE_D)
  px(ctx, 15, 17, PINE_M)
  px(ctx, 15, 18, PINE_D)
  trunk(ctx, 10, 18, 23)
  roots(ctx, 10, 23)
}

function paintDead(ctx: CanvasRenderingContext2D): void {
  shadow(ctx, 12, 25, 6, 1.6)
  const branch = (x0: number, y0: number, x1: number, y1: number) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps
      px(ctx, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), i % 2 === 0 ? BARK_M : BARK_D)
    }
  }
  trunk(ctx, 10, 10, 22)
  branch(11, 12, 4, 5)
  branch(12, 11, 18, 4)
  branch(11, 15, 6, 11)
  branch(12, 14, 17, 9)
  branch(11, 8, 8, 4)
  px(ctx, 4, 4, DRY)
  px(ctx, 18, 3, DRY)
  px(ctx, 17, 4, DRY)
  px(ctx, 6, 10, DRY)
  roots(ctx, 10, 22)
}

function paintBush(ctx: CanvasRenderingContext2D): void {
  shadow(ctx, 12, 20, 8, 1.8)
  blob(ctx, 13, 13, 7, 3.6, LEAF_D)
  blob(ctx, 8, 13, 4, 2.8, LEAF_D)
  blob(ctx, 11, 11, 7, 3.4, LEAF_M)
  blob(ctx, 16, 12, 3.2, 2.4, LEAF_M)
  blob(ctx, 8, 10, 3.4, 2.2, LEAF_L)
  blob(ctx, 13, 9, 2.8, 1.8, LEAF_L)
  px(ctx, 18, 14, LEAF_D)
  px(ctx, 5, 13, LEAF_M)
  trunk(ctx, 10, 14, 17)
  roots(ctx, 10, 17)
}

function treeSheet(): HTMLCanvasElement[] {
  if (treeCache) return treeCache
  const painters = [paintOak, paintPine, paintDead, paintBush]
  const sizes = [
    [24, 28],
    [24, 28],
    [24, 28],
    [24, 22],
  ]
  treeCache = painters.map((paint, index) => {
    const size = sizes[index] ?? [24, 28]
    return bake(size[0] ?? 24, size[1] ?? 28, (ctx) => {
      paint(ctx)
      outline(ctx, size[0] ?? 24, size[1] ?? 28)
    })
  })
  return treeCache
}

export function treeProp(variant: number): HTMLCanvasElement {
  const sheet = treeSheet()
  return sheet[variant % TREE_SPRITES] ?? bake(8, 8, () => undefined)
}

function glyph(rows: string[]): { canvas: HTMLCanvasElement; leds: Array<{ x: number; y: number; color: string }> } {
  const key = rows.join('|')
  const cached = glyphCache.get(key)
  if (cached) return cached
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0) + 2
  const height = rows.length + 2
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const leds: Array<{ x: number; y: number; color: string }> = []
  if (ctx) {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y] ?? ''
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]
        if (!ch || ch === ' ' || ch === '.') continue
        const led = LED_ON[ch]
        if (led) {
          px(ctx, x + 1, y + 1, LED_DIM[ch] ?? INK)
          leds.push({ x: x + 1, y: y + 1, color: led })
          continue
        }
        const color = SCRAP[ch]
        if (color) px(ctx, x + 1, y + 1, color)
      }
    }
    outline(ctx, width, height)
  }
  const baked = { canvas, leds }
  glyphCache.set(key, baked)
  return baked
}

const GADGETS: Record<string, string[]> = {
  pcb: ['GGGGGG', 'GaGaGa', 'GGGGGE'],
  crt: ['SSSSS', 'SsssS', 'SssRS', 'MMMMM'],
  lcd: ['ssss', 'sSSs', 'MMMM'],
  keys: ['kkkkkk', 'KKKKKK'],
  hdd: ['MMMM', 'MMmM'],
  fan: [' MMM ', 'M M M', 'Mm*mM', 'M M M', ' MMM '],
  can: ['TTT', 'TtT', 'TtT', 'TTT'],
  cap: ['cc', 'CC', 'CC', 'CC'],
  wire: ['WW  ', ' WW ', '  WW'],
  box: ['LLLL', 'LmmL', 'LmmL'],
  bit: ['GG', 'Ga'],
}

type Place = { id: string; x: number; y: number; level: number }

const HEAPS: Place[][] = [
  [
    { id: 'wire', x: 1, y: 13, level: 1 },
    { id: 'can', x: 16, y: 12, level: 1 },
    { id: 'cap', x: 5, y: 14, level: 1 },
    { id: 'bit', x: 19, y: 14, level: 1 },
    { id: 'keys', x: 6, y: 10, level: 2 },
    { id: 'hdd', x: 14, y: 11, level: 2 },
    { id: 'crt', x: 3, y: 6, level: 3 },
    { id: 'pcb', x: 10, y: 8, level: 3 },
    { id: 'fan', x: 7, y: 1, level: 4 },
    { id: 'lcd', x: 15, y: 3, level: 4 },
  ],
  [
    { id: 'wire', x: 2, y: 14, level: 1 },
    { id: 'wire', x: 15, y: 14, level: 1 },
    { id: 'cap', x: 18, y: 12, level: 1 },
    { id: 'bit', x: 1, y: 12, level: 1 },
    { id: 'box', x: 8, y: 10, level: 2 },
    { id: 'can', x: 15, y: 10, level: 2 },
    { id: 'lcd', x: 4, y: 7, level: 3 },
    { id: 'hdd', x: 12, y: 8, level: 3 },
    { id: 'crt', x: 6, y: 2, level: 4 },
    { id: 'pcb', x: 14, y: 4, level: 4 },
  ],
  [
    { id: 'can', x: 2, y: 13, level: 1 },
    { id: 'cap', x: 16, y: 13, level: 1 },
    { id: 'wire', x: 8, y: 15, level: 1 },
    { id: 'keys', x: 4, y: 10, level: 2 },
    { id: 'box', x: 12, y: 10, level: 2 },
    { id: 'fan', x: 7, y: 5, level: 3 },
    { id: 'hdd', x: 14, y: 7, level: 3 },
    { id: 'pcb', x: 3, y: 3, level: 4 },
    { id: 'lcd', x: 12, y: 2, level: 4 },
  ],
  [
    { id: 'wire', x: 1, y: 12, level: 1 },
    { id: 'can', x: 6, y: 13, level: 1 },
    { id: 'can', x: 15, y: 13, level: 1 },
    { id: 'cap', x: 12, y: 14, level: 1 },
    { id: 'bit', x: 19, y: 12, level: 1 },
    { id: 'hdd', x: 4, y: 9, level: 2 },
    { id: 'keys', x: 10, y: 10, level: 2 },
    { id: 'box', x: 8, y: 6, level: 3 },
    { id: 'crt', x: 3, y: 4, level: 3 },
    { id: 'pcb', x: 13, y: 2, level: 4 },
    { id: 'fan', x: 6, y: 1, level: 4 },
  ],
]

function paintHeap(variant: number, level: number): ScrapSprite {
  const places = HEAPS[variant] ?? HEAPS[0] ?? []
  const leds: Led[] = []
  const canvas = bake(24, 20, (ctx) => {
    shadow(ctx, 12, 16, 8, 2)
    blob(ctx, 12, 14, 7.5, 3, '#2a2c28')
    blob(ctx, 12, 13, 5.5, 2, '#3c4038')
    outline(ctx, 24, 20)
    let phase = 0
    for (const place of places) {
      if (place.level > level) continue
      const rows = GADGETS[place.id]
      if (!rows) continue
      const icon = glyph(rows)
      ctx.drawImage(icon.canvas, place.x, place.y)
      for (const led of icon.leds) {
        leds.push({ x: place.x + led.x, y: place.y + led.y, color: led.color, phase })
        phase += 1
      }
    }
  })
  return {
    canvas,
    leds: leds.map((led) => ({ ...led, x: led.x * PIXEL, y: led.y * PIXEL })),
  }
}

function oreSheet(): ScrapSprite[][] {
  if (oreCache) return oreCache
  oreCache = []
  for (let variant = 0; variant < ORE_SPRITES; variant++) {
    const row: ScrapSprite[] = []
    for (let level = 1; level <= ORE_LEVELS; level++) row.push(paintHeap(variant, level))
    oreCache.push(row)
  }
  return oreCache
}

export function oreProp(variant: number, level: number): ScrapSprite {
  const row = oreSheet()[variant % ORE_SPRITES]
  const index = Math.max(0, Math.min(ORE_LEVELS, level)) - 1
  return row?.[index] ?? paintHeap(0, 4)
}

export function paintScrapLeds(ctx: CanvasRenderingContext2D, leds: Led[], dx: number, dy: number, time: number): void {
  for (const led of leds) {
    if (Math.floor(time * 3.5 + led.phase) % 2 !== 0) continue
    ctx.fillStyle = led.color
    ctx.fillRect(dx + led.x, dy + led.y, PIXEL, PIXEL)
  }
}

/** Bust for the Dumps selection panel. */
export function dumpsPortraitUrl(): string {
  if (typeof document === 'undefined') return ''
  if (dumpsIcon) return dumpsIcon
  const { canvas, leds } = oreProp(0, 4)
  const out = document.createElement('canvas')
  out.width = 40
  out.height = 40
  const ctx = out.getContext('2d')
  if (!ctx) return ''
  ctx.imageSmoothingEnabled = false
  const scale = Math.min(36 / canvas.width, 36 / canvas.height)
  const dw = Math.round(canvas.width * scale)
  const dh = Math.round(canvas.height * scale)
  const ox = (40 - dw) / 2
  const oy = (40 - dh) / 2 + 1
  ctx.drawImage(canvas, ox, oy, dw, dh)
  for (const led of leds) {
    ctx.fillStyle = led.color
    ctx.fillRect(ox + led.x * scale, oy + led.y * scale, Math.max(PIXEL, Math.round(PIXEL * scale)), Math.max(PIXEL, Math.round(PIXEL * scale)))
  }
  dumpsIcon = out.toDataURL()
  return dumpsIcon
}

function crackStage(ratio: number): number {
  if (ratio > 0.82) return 0
  if (ratio > 0.55) return 1
  if (ratio > 0.3) return 2
  return 3
}

function oreLevel(amount: number, full: number): number {
  const ratio = full > 0 ? amount / full : 1
  if (ratio > 0.75) return 4
  if (ratio > 0.5) return 3
  if (ratio > 0.25) return 2
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
  ctx.drawImage(sprite, tx * TILE + (TILE - sprite.width) / 2, ty * TILE + TILE - sprite.height + 4)
}

export function drawTreeSprite(ctx: CanvasRenderingContext2D, tx: number, ty: number, seed: number): void {
  const index = Math.floor(hash2(tx + 11, ty + 4, seed) * TREE_SPRITES) % TREE_SPRITES
  const sprite = treeProp(index)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(sprite, tx * TILE + (TILE - sprite.width) / 2, ty * TILE + TILE - sprite.height + 6)
}

export function drawOreSprite(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  seed: number,
  selected: boolean,
  amount: number,
  full: number,
  time = 0,
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
  const sprite = oreProp(index, oreLevel(amount, full))
  const dx = x - sprite.canvas.width / 2
  const dy = y - sprite.canvas.height / 2 + 4
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(sprite.canvas, dx, dy)
  paintScrapLeds(ctx, sprite.leds, dx, dy, time)
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
