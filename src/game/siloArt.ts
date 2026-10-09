import { BUILDING_STATS, PLAYER_COLOR, TILE } from './types'

/**
 * The Silo is a square concrete shelter on the surface. The body is cached.
 * The door, dump windows, and roof dish are drawn when the building is shown.
 */

const FOOT = 96
const OX = 18
const OY = 14
const BODY_W = 132
const BODY_H = 128

const WINDOWS: Array<[number, number]> = [
  [15, 24],
  [15, 36],
  [15, 48],
  [15, 60],
  [74, 24],
  [74, 36],
  [74, 48],
  [74, 60],
]
const WINDOW_W = 7
const WINDOW_H = 5
const DOOR = { x: 34, y: 70, w: 28, h: 16 }
const SCRAP = '#c6dc4a'

export interface KeepLook {
  color: string
  /** 0 closed, 1 fully open. */
  open: number
  /** How many side windows glow. */
  lit: number
  /** 0 clean through 3 ruined. */
  stage: number
  dish: number
  /** Training progress 0–1. Negative hides the lamps. */
  progress: number
  smoke: number
}

const bodies = new Map<string, HTMLCanvasElement>()
const portraits = new Map<number, string>()

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
  return Math.min(WINDOWS.length, Math.ceil(oreHeld / 60))
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

function paintBody(ctx: CanvasRenderingContext2D, color: string, stage: number): void {
  ctx.fillStyle = 'rgba(16, 12, 8, 0.3)'
  ctx.beginPath()
  ctx.ellipse(50, 100, 48, 9, 0, 0, Math.PI * 2)
  ctx.fill()

  const pad = ctx.createLinearGradient(-10, -6, 106, 112)
  pad.addColorStop(0, '#ddd6c8')
  pad.addColorStop(0.45, '#b7b1a4')
  pad.addColorStop(1, '#8b8578')
  ctx.fillStyle = pad
  roundPath(ctx, -10, -4, 116, 112, 4)
  ctx.fill()
  ctx.strokeStyle = 'rgba(60, 50, 38, 0.28)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = 'rgba(70, 58, 42, 0.14)'
  for (let i = 0; i < 12; i++) {
    ctx.fillRect(-4 + ((i * 19) % 104), 4 + ((i * 11) % 96), 2.2, 1.1)
  }

  const worn = ctx.createRadialGradient(48, 102, 2, 48, 104, 30)
  worn.addColorStop(0, 'rgba(42, 30, 18, 0.5)')
  worn.addColorStop(1, 'rgba(42, 30, 18, 0)')
  ctx.fillStyle = worn
  ctx.beginPath()
  ctx.ellipse(48, 104, 28, 11, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#7a7468'
  ctx.fillRect(6, 8, 84, 82)
  const wall = ctx.createLinearGradient(6, 8, 90, 90)
  wall.addColorStop(0, '#c9c3b4')
  wall.addColorStop(0.5, '#aaa498')
  wall.addColorStop(1, '#6e6860')
  ctx.fillStyle = wall
  ctx.fillRect(8, 10, 80, 78)

  const roof = ctx.createLinearGradient(11, 12, 85, 72)
  roof.addColorStop(0, '#ece6da')
  roof.addColorStop(0.42, '#d0c9bb')
  roof.addColorStop(1, '#a39c90')
  ctx.fillStyle = roof
  ctx.fillRect(11, 12, 74, 56)
  ctx.fillStyle = 'rgba(255, 250, 240, 0.42)'
  ctx.fillRect(11, 12, 74, 2)
  ctx.fillStyle = 'rgba(36, 30, 24, 0.38)'
  ctx.fillRect(11, 66, 74, 2)
  ctx.strokeStyle = 'rgba(58, 48, 38, 0.32)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(11, 30)
  ctx.lineTo(85, 30)
  ctx.moveTo(11, 48)
  ctx.lineTo(85, 48)
  ctx.moveTo(36, 12)
  ctx.lineTo(36, 68)
  ctx.moveTo(60, 12)
  ctx.lineTo(60, 68)
  ctx.stroke()
  ctx.fillStyle = 'rgba(92, 72, 48, 0.16)'
  ctx.beginPath()
  ctx.ellipse(26, 22, 9, 4, 0.4, 0, Math.PI * 2)
  ctx.ellipse(70, 42, 11, 4.2, -0.35, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#6a6660'
  ctx.fillRect(18, 16, 11, 5)
  ctx.fillRect(66, 16, 11, 5)
  ctx.fillStyle = '#242220'
  ctx.fillRect(19, 18, 9, 1.5)
  ctx.fillRect(67, 18, 9, 1.5)

  ctx.fillStyle = color
  for (const [cx, cy] of [
    [12, 13],
    [79, 13],
    [12, 62],
    [79, 62],
  ] as Array<[number, number]>) {
    ctx.fillRect(cx, cy, 5, 5)
  }

  const front = ctx.createLinearGradient(8, 68, 88, 90)
  front.addColorStop(0, '#bdb7aa')
  front.addColorStop(1, '#6a645c')
  ctx.fillStyle = front
  ctx.fillRect(8, 68, 80, 20)

  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#e2b23c' : '#2a2824'
    ctx.fillRect(30 + i * 4.5, 67, 4.5, 3)
  }

  for (const [wx, wy] of WINDOWS) {
    ctx.fillStyle = '#3c3832'
    ctx.fillRect(wx - 1, wy - 1, WINDOW_W + 2, WINDOW_H + 2)
    ctx.fillStyle = '#17191c'
    ctx.fillRect(wx, wy, WINDOW_W, WINDOW_H)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.fillRect(wx, wy, WINDOW_W, 1)
    ctx.fillStyle = color
    ctx.fillRect(wx - 1, wy + WINDOW_H, WINDOW_W + 2, 1.7)
  }

  ctx.fillStyle = '#4a463f'
  ctx.fillRect(DOOR.x - 3, DOOR.y - 2, DOOR.w + 6, DOOR.h + 5)
  ctx.fillStyle = color
  ctx.fillRect(DOOR.x - 3, DOOR.y - 2, DOOR.w + 6, 2.4)
  paintClosedDoor(ctx)

  ctx.fillStyle = '#9c968a'
  ctx.beginPath()
  ctx.moveTo(DOOR.x + 1, DOOR.y + DOOR.h + 3)
  ctx.lineTo(DOOR.x + DOOR.w - 1, DOOR.y + DOOR.h + 3)
  ctx.lineTo(DOOR.x + DOOR.w + 8, 106)
  ctx.lineTo(DOOR.x - 8, 106)
  ctx.closePath()
  ctx.fill()
  const ramp = ctx.createLinearGradient(DOOR.x, 90, DOOR.x, 106)
  ramp.addColorStop(0, '#c8c2b4')
  ramp.addColorStop(1, '#8a8478')
  ctx.fillStyle = ramp
  ctx.beginPath()
  ctx.moveTo(DOOR.x + 3, DOOR.y + DOOR.h + 3)
  ctx.lineTo(DOOR.x + DOOR.w - 3, DOOR.y + DOOR.h + 3)
  ctx.lineTo(DOOR.x + DOOR.w + 4, 104)
  ctx.lineTo(DOOR.x - 4, 104)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(48, 40, 32, 0.4)'
  ctx.beginPath()
  ctx.moveTo(DOOR.x - 1, 94)
  ctx.lineTo(DOOR.x + DOOR.w + 1, 94)
  ctx.moveTo(DOOR.x + 1, 99)
  ctx.lineTo(DOOR.x + DOOR.w - 1, 99)
  ctx.stroke()

  if (stage > 0) paintDamage(ctx, stage)
}

function paintClosedDoor(ctx: CanvasRenderingContext2D): void {
  const { x, y, w, h } = DOOR
  const metal = ctx.createLinearGradient(x, y, x + w, y + h)
  metal.addColorStop(0, '#9aa0a6')
  metal.addColorStop(0.45, '#6c7278')
  metal.addColorStop(1, '#3e444a')
  ctx.fillStyle = metal
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = 'rgba(24, 26, 28, 0.65)'
  ctx.beginPath()
  ctx.moveTo(x + w / 2, y)
  ctx.lineTo(x + w / 2, y + h)
  ctx.moveTo(x + 3, y + h / 2)
  ctx.lineTo(x + w - 3, y + h / 2)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
  ctx.fillRect(x + 2, y + 2, 3, h - 4)
}

function paintDamage(ctx: CanvasRenderingContext2D, stage: number): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(36, 28, 20, 0.75)'
  ctx.lineWidth = 1.1
  ctx.lineCap = 'round'
  const cracks = [
    [18, 20, 32, 34, 28, 48],
    [70, 18, 62, 36, 74, 52],
    [24, 72, 40, 80, 36, 88],
    [58, 40, 70, 48],
  ]
  const count = stage === 1 ? 1 : stage === 2 ? 3 : 4
  for (let i = 0; i < count; i++) {
    const line = cracks[i]
    if (!line) continue
    ctx.beginPath()
    ctx.moveTo(line[0] ?? 0, line[1] ?? 0)
    for (let p = 2; p < line.length; p += 2) ctx.lineTo(line[p] ?? 0, line[p + 1] ?? 0)
    ctx.stroke()
  }
  ctx.fillStyle = stage >= 3 ? 'rgba(28, 24, 20, 0.38)' : 'rgba(40, 34, 28, 0.18)'
  ctx.beginPath()
  ctx.ellipse(40, 36, 16, 8, 0.2, 0, Math.PI * 2)
  if (stage >= 2) ctx.ellipse(68, 58, 10, 5, -0.4, 0, Math.PI * 2)
  ctx.fill()
  if (stage >= 3) {
    ctx.fillStyle = '#5c564c'
    ctx.beginPath()
    ctx.moveTo(78, 14)
    ctx.lineTo(86, 18)
    ctx.lineTo(80, 28)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

function bodySprite(color: string, stage: number): HTMLCanvasElement {
  const key = `${color}:${stage}`
  const cached = bodies.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = BODY_W
  canvas.height = BODY_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.translate(OX, OY)
  paintBody(ctx, color, stage)
  bodies.set(key, canvas)
  return canvas
}

function paintWindows(ctx: CanvasRenderingContext2D, lit: number): void {
  const count = Math.max(0, Math.min(WINDOWS.length, lit))
  for (let i = 0; i < count; i++) {
    const spot = WINDOWS[i]
    if (!spot) continue
    const [wx, wy] = spot
    const glow = ctx.createLinearGradient(wx, wy, wx, wy + WINDOW_H)
    glow.addColorStop(0, '#f4f8c8')
    glow.addColorStop(0.55, SCRAP)
    glow.addColorStop(1, '#7a9428')
    ctx.fillStyle = glow
    ctx.fillRect(wx, wy, WINDOW_W, WINDOW_H)
    ctx.fillStyle = 'rgba(255, 255, 240, 0.35)'
    ctx.fillRect(wx, wy, WINDOW_W, 1.2)
  }
}

function paintDoor(ctx: CanvasRenderingContext2D, open: number, progress: number): void {
  const { x, y, w, h } = DOOR
  if (open > 0.02) {
    ctx.fillStyle = '#100e0c'
    ctx.fillRect(x, y, w, h)
    const glow = ctx.createRadialGradient(x + w / 2, y + h, 2, x + w / 2, y + h * 0.35, w * 0.8)
    glow.addColorStop(0, `rgba(255, 168, 84, ${0.25 + open * 0.55})`)
    glow.addColorStop(1, 'rgba(40, 16, 8, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(x, y, w, h)
    const slide = open * 12
    const metal = ctx.createLinearGradient(0, y, 0, y + h)
    metal.addColorStop(0, '#a4aab0')
    metal.addColorStop(1, '#4a5056')
    ctx.fillStyle = metal
    ctx.fillRect(x - slide, y, w / 2 - 1, h)
    ctx.fillRect(x + w / 2 + 1 + slide, y, w / 2 - 1, h)
  }
  if (progress < 0) return
  const lamps = 5
  const lit = Math.max(0, Math.min(lamps, Math.round(progress * lamps)))
  for (let i = 0; i < lamps; i++) {
    ctx.fillStyle = i < lit ? '#f3e4a4' : '#3a342c'
    ctx.fillRect(x + 1 + i * 5.2, y - 6, 3.4, 2.3)
  }
}

function paintDish(ctx: CanvasRenderingContext2D, angle: number, color: string): void {
  const x = 48
  const y = 34
  ctx.fillStyle = '#5e5a52'
  ctx.fillRect(x - 2, y, 4, 8)
  ctx.fillStyle = '#8e8a80'
  ctx.beginPath()
  ctx.ellipse(x, y + 7, 5.5, 2.1, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.strokeStyle = '#32302c'
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(12, 0)
  ctx.stroke()
  const bowl = ctx.createLinearGradient(-2, -4, 10, 4)
  bowl.addColorStop(0, '#f4f2ec')
  bowl.addColorStop(0.5, '#b8babf')
  bowl.addColorStop(1, '#64686e')
  ctx.fillStyle = bowl
  ctx.beginPath()
  ctx.ellipse(9, 0, 8.5, 3.8, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.3
  ctx.stroke()
  ctx.fillStyle = '#2a2e32'
  ctx.fillRect(13, -1.2, 3.4, 2.4)
  ctx.fillStyle = '#ddd8ce'
  ctx.fillRect(15.2, -0.6, 1.3, 1.2)
  ctx.restore()
}

function paintSmoke(ctx: CanvasRenderingContext2D, time: number, stage: number): void {
  if (stage < 2) return
  const drift = Math.sin(time * 1.3) * 2.2
  ctx.fillStyle = stage >= 3 ? 'rgba(54, 50, 46, 0.38)' : 'rgba(70, 66, 60, 0.22)'
  ctx.beginPath()
  ctx.ellipse(24 + drift, 6, 7, 3.4, 0, 0, Math.PI * 2)
  ctx.ellipse(72 - drift * 0.6, 4, 5.5, 2.8, 0, 0, Math.PI * 2)
  ctx.fill()
}

export function drawKeepSprite(ctx: CanvasRenderingContext2D, x: number, y: number, look: KeepLook): void {
  const body = bodySprite(look.color, look.stage)
  ctx.drawImage(body, x - OX, y - OY)
  ctx.save()
  ctx.translate(x, y)
  paintWindows(ctx, look.lit)
  paintDoor(ctx, look.open, look.progress)
  paintDish(ctx, look.dish, look.color)
  paintSmoke(ctx, look.smoke, look.stage)
  ctx.restore()
}

/** Selection portrait. Empty when there is no document, so smoke can call it. */
export function siloPortraitUrl(owner: number): string {
  if (typeof document === 'undefined') return ''
  const cached = portraits.get(owner)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 72
  canvas.height = 72
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#8d6b45'
  ctx.fillRect(0, 0, 72, 72)
  ctx.save()
  ctx.translate(6, 4)
  ctx.scale(0.58, 0.58)
  drawKeepSprite(ctx, 0, 0, {
    color: PLAYER_COLOR[owner] ?? '#5ec8ff',
    open: 0,
    lit: 4,
    stage: 0,
    dish: 0.7,
    progress: -1,
    smoke: 0,
  })
  ctx.restore()
  const url = canvas.toDataURL()
  portraits.set(owner, url)
  return url
}

export const KEEP_FOOT = FOOT
