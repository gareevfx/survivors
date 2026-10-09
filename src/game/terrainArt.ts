import { CASTLE_YARD, pickFfaSites, pickKeepSites } from './map'
import { hash2 } from './rng'
import { BUILDING_STATS, FFA_MAP_H, FFA_MAP_W, TILE } from './types'

export {
  DUMPS_COLOR,
  drawOreSprite,
  drawRockSprite,
  drawTreeSprite,
  dumpsPortraitUrl,
  oreProp,
  rockProp,
  treeProp,
} from './propArt'

/**
 * Original procedural ground. The battlefield is one offscreen canvas.
 * Rocks, trees, and dumps are cached painterly sprites in propArt.
 */

const FOG_FADE = 16

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
