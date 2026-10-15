import { BUILDING_STATS, PLAYER_COLOR, TILE } from './types'

const plainUrl = new URL('../assets/silo-plain.png', import.meta.url).href
const cryoUrl = new URL('../assets/silo-cryo.png', import.meta.url).href

/**
 * The Silo is the photographed bunker, scaled to the 3×3 footprint.
 * A plain sprite is the normal look. Once Cryo is installed the wider
 * sprite adds the four glass vessels. Empty slots are painted over.
 */

const FOOT = 96
/** Plain cutout height. Cryo uses this same scale, not its own width. */
const SPRITE_H = 684
const DRAW_H = 118
const SCALE = DRAW_H / SPRITE_H

/** Door center in each cutout, so the two bunkers sit on the same tiles. */
const PLAIN_DOOR = { x: 0.477, y: 0.8278 }
const CRYO_DOOR = { x: 0.5108, y: 0.8253 }
/** Door anchor inside the footprint. The dish overflows above the tile. */
const DOOR_OX = 48
const DOOR_OY = 78

/** Front pair fills first, then the back pair. Boxes are fractions of the cryo cutout. */
const VESSELS: Array<{ x: number; y: number; w: number; h: number }> = [
  { x: 0.0504, y: 0.5827, w: 0.0998, h: 0.3704 },
  { x: 0.8094, y: 0.5944, w: 0.1304, h: 0.2694 },
  { x: 0.0647, y: 0.2152, w: 0.1034, h: 0.328 },
  { x: 0.8067, y: 0.2225, w: 0.1394, h: 0.3177 },
]

const WINDOW_COUNT = 8

export interface KeepLook {
  color: string
  /** 0 closed, 1 fully open. The photographed door does not animate. */
  open: number
  /** How many side windows would glow. The photograph has its own lights. */
  lit: number
  /** 0 clean through 3 damaged. 4 is a ruin. */
  stage: number
  dish: number
  /** Training progress 0–1. Negative hides the lamps. */
  progress: number
  smoke: number
  /** Cryo vessels are installed and the Silo is not a ruin. */
  cryo?: boolean
  /** Frozen Stalkers. Empty slots past this count are clear glass. */
  held?: number
}

const portraits = new Map<number, string>()

function loadSprite(url: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null
  const img = new Image()
  img.src = url
  return img
}

const plainImg = loadSprite(plainUrl)
const cryoImg = loadSprite(cryoUrl)

function ready(img: HTMLImageElement | null): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0
}

/** Walkable point just outside the south door. Rally and new units use this. */
export function keepEntrance(building: { tx: number; ty: number }): { x: number; y: number } {
  const stats = BUILDING_STATS.keep
  return {
    x: (building.tx + stats.w / 2) * TILE,
    y: (building.ty + stats.h) * TILE + 16,
  }
}

/** Lit side windows for a dumps stockpile. Eight windows, sixty dumps each. */
export function keepWindowCount(oreHeld: number): number {
  if (oreHeld <= 0) return 0
  return Math.min(WINDOW_COUNT, Math.ceil(oreHeld / 60))
}

export function keepDamageStage(hp: number, full: number): number {
  const ratio = full > 0 ? hp / full : 1
  if (ratio > 0.75) return 0
  if (ratio > 0.5) return 1
  if (ratio > 0.25) return 2
  return 3
}

function roundPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function paintEmptyGlass(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  dw: number,
  dh: number,
  box: { x: number; y: number; w: number; h: number },
): void {
  const bw = box.w * dw
  const bh = box.h * dh
  const x = ox + box.x * dw + bw * 0.16
  const y = oy + box.y * dh + bh * 0.14
  const w = bw * 0.68
  const h = bh * 0.74
  ctx.save()
  roundPath(ctx, x, y, w, h, bw * 0.28)
  ctx.fillStyle = 'rgba(186, 226, 246, 0.94)'
  ctx.fill()
  ctx.clip()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
  roundPath(ctx, x + w * 0.16, y + h * 0.08, w * 0.14, h * 0.46, w * 0.07)
  ctx.fill()
  ctx.fillStyle = 'rgba(232, 244, 252, 0.7)'
  ctx.fillRect(x, y + h * 0.84, w, h * 0.16)
  ctx.restore()
}

function paintEmptyVessels(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  dw: number,
  dh: number,
  held: number,
): void {
  for (let i = held; i < VESSELS.length; i++) {
    const box = VESSELS[i]
    if (box) paintEmptyGlass(ctx, left, top, dw, dh, box)
  }
}

let scratch: HTMLCanvasElement | null = null

function damagedSheet(
  img: HTMLImageElement,
  dw: number,
  dh: number,
  stage: number,
  cryo: boolean,
  held: number,
): HTMLCanvasElement {
  const w = Math.max(1, Math.ceil(dw))
  const h = Math.max(1, Math.ceil(dh))
  if (!scratch) scratch = document.createElement('canvas')
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w
    scratch.height = h
  }
  const ctx = scratch.getContext('2d')
  if (!ctx) return scratch
  ctx.clearRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(img, 0, 0, dw, dh)
  if (cryo) paintEmptyVessels(ctx, 0, 0, dw, dh, held)
  ctx.globalCompositeOperation = 'source-atop'
  ctx.fillStyle = stage >= 4 ? 'rgba(20, 16, 12, 0.45)' : `rgba(40, 24, 16, ${0.12 * stage})`
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'source-over'
  return scratch
}

function paintTeamLight(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, scale = 1): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.fillStyle = color
  ctx.globalAlpha = 0.42
  ctx.beginPath()
  ctx.ellipse(0, 0, 26, 8, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = color
  ctx.lineWidth = 2.25
  ctx.beginPath()
  ctx.ellipse(0, 0, 22, 6.5, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function paintSmoke(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, heavy: boolean): void {
  const drift = Math.sin(time * 1.7) * 4
  ctx.fillStyle = heavy ? 'rgba(28, 24, 20, 0.55)' : 'rgba(70, 66, 60, 0.28)'
  ctx.beginPath()
  ctx.ellipse(x + drift, y, heavy ? 16 : 8, heavy ? 6 : 3.2, 0, 0, Math.PI * 2)
  ctx.ellipse(x + 20 - drift, y + 5, heavy ? 11 : 6, heavy ? 4.2 : 2.6, 0, 0, Math.PI * 2)
  ctx.fill()
}

export function drawKeepSprite(ctx: CanvasRenderingContext2D, x: number, y: number, look: KeepLook): void {
  const cryo = !!look.cryo && look.stage < 4
  const img = cryo ? cryoImg : plainImg
  if (!ready(img)) return
  const door = cryo ? CRYO_DOOR : PLAIN_DOOR
  const dw = img.naturalWidth * SCALE
  const dh = img.naturalHeight * SCALE
  const ax = x + DOOR_OX
  const ay = y + DOOR_OY
  const left = ax - door.x * dw
  const top = ay - door.y * dh
  const held = Math.max(0, Math.min(VESSELS.length, look.held ?? 0))
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (look.stage <= 0) {
    ctx.drawImage(img, left, top, dw, dh)
    if (cryo) paintEmptyVessels(ctx, left, top, dw, dh, held)
  } else if (typeof document !== 'undefined') {
    ctx.drawImage(damagedSheet(img, dw, dh, look.stage, cryo, held), left, top)
  } else {
    ctx.drawImage(img, left, top, dw, dh)
  }
  paintTeamLight(ctx, ax, ay + 12, look.color)
  if (look.stage >= 4) paintSmoke(ctx, ax, top + 6, look.smoke, true)
  else if (look.stage > 0) paintSmoke(ctx, ax, top + 8, look.smoke, false)
  ctx.restore()
}

function portraitUrl(owner: number, ruined: boolean): string {
  if (typeof document === 'undefined') return ''
  if (!ready(plainImg)) return ''
  const key = ruined ? -1 : owner
  const cached = portraits.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 72
  canvas.height = 72
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = ruined ? '#3a342c' : '#1c2420'
  ctx.fillRect(0, 0, 72, 72)
  const max = 64
  const scale = Math.min(max / plainImg.naturalWidth, max / plainImg.naturalHeight)
  const dw = plainImg.naturalWidth * scale
  const dh = plainImg.naturalHeight * scale
  const left = (72 - dw) / 2
  const top = (72 - dh) / 2
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(plainImg, left, top, dw, dh)
  if (ruined) {
    ctx.fillStyle = 'rgba(20, 16, 12, 0.45)'
    ctx.fillRect(left, top, dw, dh)
  }
  const color = ruined ? '#6a645c' : (PLAYER_COLOR[owner] ?? PLAYER_COLOR[0] ?? '#5ec8ff')
  paintTeamLight(ctx, left + PLAIN_DOOR.x * dw, top + PLAIN_DOOR.y * dh + 2, color, 0.4)
  const url = canvas.toDataURL()
  portraits.set(key, url)
  return url
}

/** Selection portrait for a wreck. Empty until the photograph has loaded. */
export function ruinedSiloPortraitUrl(): string {
  return portraitUrl(0, true)
}

/** Selection portrait. Empty until the photograph has loaded, and in node. */
export function siloPortraitUrl(owner: number): string {
  return portraitUrl(owner, false)
}

export const KEEP_FOOT = FOOT
