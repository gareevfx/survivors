import { PLAYER_COLOR } from './types'

/**
 * The Silo sprite is the reference render, keyed and cropped.
 * An affine fit aims the base ring's left and right corners at the 3×3
 * diamond's horizontal axis and the front lip at the bottom corner, then
 * scales uniformly so the outer lip touches the diamond and does not cross it.
 * Dome and antennas may sit above the diamond. Orange trim is hue-mapped.
 * Cyan glass is left alone. The drop shadow is drawn by the renderer.
 */

const SRC = '/assets/silo.png'
/** Footprint center inside the fitted canvas. */
const ANCHOR_X = 60
const ANCHOR_Y = 36
const FIT_W = 120
const FIT_H = 68
/**
 * x' = a x + b y + c, y' = d x + e y + f, origin at the footprint center.
 * Measured from the ring corners (0.7, 102.5), (193.3, 103.9) and (94.8, 194.6)
 * on the 195×197 sprite, then scaled by 0.581 so the front lip stays inside.
 */
const FIT_A = 0.5791033734978706
const FIT_B = 0.013687495584019474
const FIT_C = -57.58663552508788
const FIT_D = -0.002218143895503083
const FIT_E = 0.3054235125211147
const FIT_F = -31.314587408524677
/** Hex gate on the unfitted sprite. */
const GATE_SRC = { x: 99, y: 123 }

type Anchor = { canvas: HTMLCanvasElement; ax: number; ay: number }

let photo: HTMLImageElement | null = null
let ready = false
const tints = new Map<string, Anchor>()
let ruin: Anchor | null = null
const portraits = new Map<string, string>()

export function preloadSiloImage(): void {
  if (ready || photo || typeof Image === 'undefined') return
  const image = new Image()
  image.decoding = 'async'
  image.onload = () => {
    ready = true
    for (const color of PLAYER_COLOR) siloPhotoSprite(color, false)
    if (photo) ruinSprite(photo)
  }
  image.src = SRC
  photo = image
}

preloadSiloImage()

export function siloImageReady(): boolean {
  return ready
}

function fitPoint(x: number, y: number): { x: number; y: number } {
  return { x: FIT_A * x + FIT_B * y + FIT_C, y: FIT_D * x + FIT_E * y + FIT_F }
}

/** Gate position relative to the footprint center, in sprite pixels. */
export function siloGateOffset(): { x: number; y: number } {
  return fitPoint(GATE_SRC.x, GATE_SRC.y)
}

/** True when the fitted ring corners sit inside the 3×3 diamond, level at the sides. */
export function siloRingInsideDiamond(): boolean {
  const left = fitPoint(0.68, 102.53)
  const right = fitPoint(193.32, 103.93)
  const bottom = fitPoint(94.84, 194.55)
  const inside = (point: { x: number; y: number }) => Math.abs(point.x) / 96 + Math.abs(point.y) / 48 <= 1.01
  return Math.abs(left.y) < 0.8 && Math.abs(right.y) < 0.8 && inside(left) && inside(right) && inside(bottom) && bottom.y > 0
}

export function siloPhotoSprite(color: string, ruined: boolean): Anchor | null {
  if (!ready || !photo) return null
  if (ruined) return ruinSprite(photo)
  const cached = tints.get(color)
  if (cached) return cached
  const made = tintSprite(photo, color)
  tints.set(color, made)
  return made
}

export function siloPhotoPortrait(owner: number): string {
  if (typeof document === 'undefined' || !ready) return ''
  const color = PLAYER_COLOR[owner] ?? '#5ec8ff'
  const key = `live:${color}`
  const cached = portraits.get(key)
  if (cached) return cached
  const sprite = siloPhotoSprite(color, false)
  if (!sprite) return ''
  const url = portraitUrl(sprite.canvas, '#243024')
  portraits.set(key, url)
  return url
}

export function siloPhotoRuinPortrait(): string {
  if (typeof document === 'undefined' || !ready || !photo) return ''
  const cached = portraits.get('ruin')
  if (cached) return cached
  const sprite = ruinSprite(photo)
  const url = portraitUrl(sprite.canvas, '#2a2824')
  portraits.set('ruin', url)
  return url
}

function portraitUrl(sprite: HTMLCanvasElement, backdrop: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = backdrop
  ctx.fillRect(0, 0, 64, 64)
  const scale = Math.min(58 / sprite.width, 58 / sprite.height)
  const w = sprite.width * scale
  const h = sprite.height * scale
  ctx.drawImage(sprite, (64 - w) / 2, (64 - h) / 2 + 1, w, h)
  return canvas.toDataURL()
}

function fittedCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = FIT_W
  canvas.height = FIT_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.setTransform(FIT_A, FIT_D, FIT_B, FIT_E, ANCHOR_X + FIT_C, ANCHOR_Y + FIT_F)
  ctx.drawImage(image, 0, 0)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return canvas
}

function tintSprite(image: HTMLImageElement, color: string): Anchor {
  const canvas = fittedCanvas(image)
  const ctx = canvas.getContext('2d')
  if (!ctx) return { canvas, ax: ANCHOR_X, ay: ANCHOR_Y }
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
  recolorTrim(frame.data, color)
  ctx.putImageData(frame, 0, 0)
  return { canvas, ax: ANCHOR_X, ay: ANCHOR_Y }
}

function ruinSprite(image: HTMLImageElement): Anchor {
  if (ruin) return ruin
  const canvas = fittedCanvas(image)
  const ctx = canvas.getContext('2d')
  if (!ctx) return { canvas, ax: ANCHOR_X, ay: ANCHOR_Y }
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
  scorch(frame.data, canvas.width, canvas.height)
  ctx.putImageData(frame, 0, 0)
  paintWreck(ctx, canvas.width, canvas.height)
  ruin = { canvas, ax: ANCHOR_X, ay: ANCHOR_Y }
  return ruin
}

/** Swap the orange/yellow trim hue. Cyan glass and gray steel stay. */
function recolorTrim(data: Uint8ClampedArray, color: string): void {
  const team = rgbOf(color)
  const target = rgbToHsv(team.r, team.g, team.b)
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] ?? 0
    if (alpha < 8) continue
    const r = data[i] ?? 0
    const g = data[i + 1] ?? 0
    const b = data[i + 2] ?? 0
    const hsv = rgbToHsv(r, g, b)
    if (hsv.h < 12 || hsv.h > 58 || hsv.s < 0.32 || hsv.v < 0.22) continue
    if (target.s < 0.18) {
      const scale = hsv.v / Math.max(0.25, target.v)
      data[i] = clampByte(team.r * scale)
      data[i + 1] = clampByte(team.g * scale)
      data[i + 2] = clampByte(team.b * scale)
      continue
    }
    const sat = Math.min(0.95, Math.max(0.4, hsv.s * 0.75 + target.s * 0.35))
    const next = hsvToRgb(target.h, sat, hsv.v)
    data[i] = next.r
    data[i + 1] = next.g
    data[i + 2] = next.b
  }
}

function scorch(data: Uint8ClampedArray, width: number, height: number): void {
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] ?? 0
    if (alpha < 8) continue
    const r = data[i] ?? 0
    const g = data[i + 1] ?? 0
    const b = data[i + 2] ?? 0
    const y = r * 0.3 + g * 0.59 + b * 0.11
    const pixel = i / 4
    const py = Math.floor(pixel / width) / height
    const burn = py < 0.42 ? 0.34 : 0.46
    const tone = y * burn + 16
    data[i] = clampByte(tone * 0.92)
    data[i + 1] = clampByte(tone * 0.86)
    data[i + 2] = clampByte(tone * 0.78)
  }
}

function paintWreck(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const x = (frac: number) => width * frac
  const y = (frac: number) => height * frac
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(18, 14, 12, 0.9)'
  const mark = width / 195
  ctx.lineWidth = 1.4 * mark
  const cracks = [
    [0.42, 0.18, 0.48, 0.28, 0.4, 0.36],
    [0.58, 0.16, 0.52, 0.3, 0.6, 0.4],
    [0.36, 0.48, 0.46, 0.58, 0.4, 0.66],
    [0.62, 0.5, 0.55, 0.62, 0.66, 0.7],
  ]
  for (const crack of cracks) {
    ctx.beginPath()
    ctx.moveTo(x(crack[0] ?? 0), y(crack[1] ?? 0))
    ctx.lineTo(x(crack[2] ?? 0), y(crack[3] ?? 0))
    ctx.lineTo(x(crack[4] ?? 0), y(crack[5] ?? 0))
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(10, 8, 6, 0.38)'
  ctx.beginPath()
  ctx.ellipse(x(0.34), y(0.46), 22 * mark, 14 * mark, -0.4, 0, Math.PI * 2)
  ctx.ellipse(x(0.68), y(0.4), 18 * mark, 12 * mark, 0.3, 0, Math.PI * 2)
  ctx.fill()
  // Dome collapsed into a dark slab.
  ctx.fillStyle = 'rgba(28, 24, 20, 0.72)'
  ctx.beginPath()
  ctx.moveTo(x(0.4), y(0.14))
  ctx.lineTo(x(0.62), y(0.1))
  ctx.lineTo(x(0.7), y(0.24))
  ctx.lineTo(x(0.46), y(0.3))
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(70, 62, 54, 0.8)'
  ctx.stroke()
  // Rubble along the front lip.
  ctx.fillStyle = '#3e3a34'
  const rubble = [
    [0.32, 0.84, 16, 7],
    [0.48, 0.88, 22, 8],
    [0.66, 0.84, 14, 6],
    [0.4, 0.78, 10, 5],
  ] as const
  for (const [fx, fy, rw, rh] of rubble) {
    ctx.beginPath()
    ctx.ellipse(x(fx), y(fy), rw * mark, rh * mark, 0.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(12, 10, 8, 0.7)'
    ctx.stroke()
  }
  ctx.fillStyle = '#6a6258'
  ctx.fillRect(x(0.44), y(0.8), 18 * mark, 6 * mark)
  ctx.restore()
}

function rgbOf(color: string): { r: number; g: number; b: number } {
  const value = Number.parseInt(color.slice(1), 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d > 1e-6) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    if (h < 0) h += 6
  }
  return { h: (h / 6) * 360, s: max <= 0 ? 0 : d / max, v: max }
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hh = ((((h % 360) + 360) % 360) / 360) * 6
  const i = Math.floor(hh) % 6
  const f = hh - Math.floor(hh)
  const p = v * (1 - s)
  const q = v * (1 - s * f)
  const t = v * (1 - s * (1 - f))
  const table = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ]
  const row = table[i] ?? table[0] ?? [v, v, v]
  return { r: clampByte((row[0] ?? 0) * 255), g: clampByte((row[1] ?? 0) * 255), b: clampByte((row[2] ?? 0) * 255) }
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}
