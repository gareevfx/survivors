import { BUILDING_STATS, PLAYER_COLOR, TILE } from './types'

/**
 * The Silo is a square concrete block on a 3×3 footprint.
 * The shell is cached. The door, roof dish, stock paint, and Cryo pods are drawn live.
 * Blue reference parts (hazard stripes, emblem, pod trim) use the owner's color.
 * The 3×3 roof is centered on the block. The door is a slim strip on the front rim.
 */

const OX = 22
const OY = 16
const BODY_W = 148
const BODY_H = 128

const BLOCK = { x: 10, y: 8, w: 76, h: 82, r: 8 }
const ROOF_CELL = 18
const ROOF_GAP = 2
const ROOF_SPAN = ROOF_CELL * 3 + ROOF_GAP * 2
const ROOF = {
  x: BLOCK.x + (BLOCK.w - ROOF_SPAN) / 2,
  y: BLOCK.y + (BLOCK.h - ROOF_SPAN) / 2,
  cell: ROOF_CELL,
  gap: ROOF_GAP,
}
const DOOR_W = 30
const DOOR_H = 8
const DOOR = {
  x: BLOCK.x + (BLOCK.w - DOOR_W) / 2,
  y: BLOCK.y + BLOCK.h - DOOR_H,
  w: DOOR_W,
  h: DOOR_H,
}
const PODS: Array<[number, number]> = [
  [-2, 16],
  [-2, 42],
  [82, 16],
  [82, 42],
]
const POD_W = 16
const POD_H = 22

/**
 * Roof cells around the center dish, corners first, then opposite edges.
 * Two, four, six, and eight painted cells stay balanced around the radar.
 */
const CELLS: Array<[number, number]> = [
  [0, 0],
  [2, 0],
  [0, 2],
  [2, 2],
  [1, 0],
  [1, 2],
  [0, 1],
  [2, 1],
]
/** One painted cell per this many stored dumps. Eight cells fill a 3000 Silo. */
const CELL_DUMPS = 375
/** Seconds for one cell of paint to fill or drain. */
const FILL_EASE = 0.2

export interface KeepLook {
  color: string
  /** 0 closed, 1 the striped panel is fully slid open. */
  open: number
  /**
   * Paint level in roof cells. 4.5 fills four cells and the bottom half of the next.
   * Whole numbers match one cell per 375 dumps.
   */
  lit: number
  /** 0 clean through 3 ruined. */
  stage: number
  dish: number
  /** Training progress 0–1. Negative hides the lamps. */
  progress: number
  smoke: number
  /** Building id so the paint eases toward the stock. Omit to draw it already settled. */
  id?: number
  /** Cryo pads are mounted on the sides. */
  cryo: boolean
  /** Filled pods, left then right, top then bottom. */
  held: number
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

/** How far the roof paint has climbed, in cells. 1700 dumps is four full cells plus a partial. */
export function keepFillLevel(stored: number): number {
  if (stored <= 0) return 0
  return Math.min(CELLS.length, stored / CELL_DUMPS)
}

/** Full painted roof cells for a Silo's own stock. None at 0, one per 375 dumps, eight at 3000. */
export function keepWindowCount(stored: number): number {
  return Math.floor(keepFillLevel(stored))
}

export function keepDamageStage(hp: number, full: number): number {
  const ratio = full > 0 ? hp / full : 1
  if (ratio > 0.75) return 0
  if (ratio > 0.5) return 1
  if (ratio > 0.25) return 2
  return 3
}

/**
 * A hatch pulse starts at 0.7 and falls toward 0.
 * The panel slides open through the first part of that pulse, then slides shut.
 */
export function keepDoorSlide(hatch: number): number {
  const t = Math.max(0, Math.min(1, hatch / 0.7))
  if (t === 0) return 0
  if (t > 0.62) return (1 - t) / 0.38
  return t / 0.62
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

function panelOrigin(col: number, row: number): [number, number] {
  return [ROOF.x + col * (ROOF.cell + ROOF.gap), ROOF.y + row * (ROOF.cell + ROOF.gap)]
}

function paintBody(ctx: CanvasRenderingContext2D, stage: number): void {
  const { x, y, w, h, r } = BLOCK
  const pad = ctx.createLinearGradient(x, y, x + w, y + h)
  pad.addColorStop(0, '#f6f2ea')
  pad.addColorStop(0.45, '#e6dfd2')
  pad.addColorStop(1, '#cfc6b6')
  ctx.fillStyle = pad
  roundPath(ctx, x, y, w, h, r)
  ctx.fill()
  ctx.strokeStyle = '#8d8476'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255, 252, 246, 0.7)'
  ctx.lineWidth = 1
  roundPath(ctx, x + 2, y + 2, w - 4, h - 4, r - 2)
  ctx.stroke()

  ctx.fillStyle = 'rgba(90, 78, 62, 0.08)'
  for (let i = 0; i < 10; i++) {
    ctx.fillRect(x + 6 + ((i * 17) % (w - 16)), y + 8 + ((i * 13) % (h - 20)), 2, 1)
  }

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const [px, py] = panelOrigin(col, row)
      const tone = (col + row) % 2 === 0 ? '#f7f4ee' : '#ebe4d8'
      const shade = ctx.createLinearGradient(px, py, px, py + ROOF.cell)
      shade.addColorStop(0, '#fbf9f4')
      shade.addColorStop(1, tone)
      ctx.fillStyle = shade
      ctx.fillRect(px, py, ROOF.cell, ROOF.cell)
      ctx.strokeStyle = '#b7aea0'
      ctx.lineWidth = 1
      ctx.strokeRect(px + 0.5, py + 0.5, ROOF.cell - 1, ROOF.cell - 1)
    }
  }

  const rimTop = ROOF.y + ROOF_SPAN
  ctx.save()
  roundPath(ctx, x, y, w, h, r)
  ctx.clip()
  const front = ctx.createLinearGradient(x, rimTop, x, y + h)
  front.addColorStop(0, '#ddd4c6')
  front.addColorStop(1, '#b7ad9e')
  ctx.fillStyle = front
  ctx.fillRect(x, rimTop, w, y + h - rimTop)
  ctx.fillStyle = '#12110f'
  roundPath(ctx, DOOR.x, DOOR.y, DOOR.w, DOOR.h, 2)
  ctx.fill()
  ctx.restore()

  if (stage >= 4) {
    ctx.fillStyle = 'rgba(18, 14, 10, 0.55)'
    roundPath(ctx, x, y, w, h, r)
    ctx.fill()
  }
  if (stage > 0) paintDamage(ctx, stage)
}

function paintDamage(ctx: CanvasRenderingContext2D, stage: number): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(36, 28, 20, 0.75)'
  ctx.lineWidth = 1.1
  ctx.lineCap = 'round'
  const cracks = [
    [22, 22, 36, 34, 30, 48],
    [70, 20, 62, 36, 74, 50],
    [28, 74, 42, 80, 38, 86],
    [58, 42, 70, 50],
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
  ctx.fillStyle = stage >= 3 ? 'rgba(28, 24, 20, 0.38)' : 'rgba(40, 34, 28, 0.16)'
  ctx.beginPath()
  ctx.ellipse(40, 36, 14, 7, 0.2, 0, Math.PI * 2)
  if (stage >= 2) ctx.ellipse(66, 52, 9, 4, -0.4, 0, Math.PI * 2)
  ctx.fill()
  if (stage >= 3) {
    ctx.fillStyle = '#5c564c'
    ctx.beginPath()
    ctx.moveTo(74, 16)
    ctx.lineTo(82, 20)
    ctx.lineTo(76, 30)
    ctx.closePath()
    ctx.fill()
  }
  if (stage >= 4) {
    ctx.fillStyle = '#2a241e'
    ctx.beginPath()
    ctx.moveTo(18, 20)
    ctx.lineTo(52, 30)
    ctx.lineTo(46, 58)
    ctx.lineTo(14, 46)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#1a1612'
    ctx.fillRect(30, 36, 20, 14)
  }
  ctx.restore()
}

function bodySprite(stage: number): HTMLCanvasElement {
  const key = String(stage)
  const cached = bodies.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = BODY_W
  canvas.height = BODY_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.translate(OX, OY)
  paintBody(ctx, stage)
  bodies.set(key, canvas)
  return canvas
}

interface FillAnim {
  level: number
  time: number
}

const fillAnims = new Map<number, FillAnim>()

/** Ease the painted level toward the stock so a delivery climbs instead of popping. */
function easedFill(id: number | undefined, time: number, target: number): number {
  const goal = Math.max(0, Math.min(CELLS.length, target))
  if (id == null || !Number.isFinite(time)) return goal
  let anim = fillAnims.get(id)
  if (!anim) {
    anim = { level: goal, time }
    fillAnims.set(id, anim)
    return goal
  }
  const dt = time - anim.time
  anim.time = time
  if (dt < -0.001 || dt > 2) {
    anim.level = goal
    return goal
  }
  if (dt <= 0) return anim.level
  const step = dt / FILL_EASE
  if (anim.level < goal) anim.level = Math.min(goal, anim.level + step)
  else if (anim.level > goal) anim.level = Math.max(goal, anim.level - step)
  return anim.level
}

/** Dumps gold, the same amber as the Dumps readout. The cell fills from its bottom edge. */
function paintCell(ctx: CanvasRenderingContext2D, col: number, row: number, amount: number): void {
  if (amount <= 0.004) return
  const [px, py] = panelOrigin(col, row)
  const t = Math.max(0, Math.min(1, amount))
  const h = ROOF.cell * t
  const top = py + ROOF.cell - h
  ctx.save()
  ctx.beginPath()
  ctx.rect(px, py, ROOF.cell, ROOF.cell)
  ctx.clip()
  const paint = ctx.createLinearGradient(px, top, px, py + ROOF.cell)
  paint.addColorStop(0, '#f4d78a')
  paint.addColorStop(0.4, '#e6c15a')
  paint.addColorStop(1, '#c4923c')
  ctx.fillStyle = paint
  ctx.fillRect(px, top, ROOF.cell, h + 0.4)
  if (t < 0.985) {
    ctx.fillStyle = 'rgba(255, 246, 220, 0.92)'
    ctx.fillRect(px, top, ROOF.cell, 1.15)
  }
  ctx.restore()
}

function paintRoofFill(ctx: CanvasRenderingContext2D, lit: number, id: number | undefined, time: number): void {
  const level = easedFill(id, time, lit)
  const full = Math.floor(level)
  const partial = level - full
  for (let i = 0; i < CELLS.length; i++) {
    const spot = CELLS[i]
    if (!spot) continue
    const amount = i < full ? 1 : i === full ? partial : 0
    if (amount <= 0.004) continue
    paintCell(ctx, spot[0], spot[1], amount)
  }
}

function paintDoor(ctx: CanvasRenderingContext2D, open: number, color: string, time: number, progress: number): void {
  const { x, y, w, h } = DOOR
  const slide = Math.max(0, Math.min(1, open)) * (h + 2)
  ctx.save()
  roundPath(ctx, x, y, w, h, 2)
  ctx.clip()
  ctx.save()
  ctx.translate(0, -slide)
  const stripes = Math.ceil((w + h) / 4) + 2
  for (let i = -2; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? color : '#2a261f'
    ctx.beginPath()
    ctx.moveTo(x + i * 4, y - 2)
    ctx.lineTo(x + i * 4 + 5, y - 2)
    ctx.lineTo(x + i * 4 + 5 - h, y + h + 2)
    ctx.lineTo(x + i * 4 - h, y + h + 2)
    ctx.closePath()
    ctx.fill()
  }
  if (open < 0.04) {
    const sheen = x + ((Math.sin(time * 0.55) + 1) / 2) * (w - 4)
    ctx.fillStyle = 'rgba(255, 252, 244, 0.22)'
    ctx.fillRect(sheen, y, 3, h)
  }
  const cx = x + w / 2
  const cy = y + h / 2
  const mark = Math.min(2.6, h * 0.34)
  ctx.beginPath()
  ctx.arc(cx, cy, mark, 0, Math.PI * 2)
  ctx.fillStyle = '#f7f4ee'
  ctx.fill()
  ctx.lineWidth = 1.2
  ctx.strokeStyle = color
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, mark * 0.42, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
  ctx.restore()

  if (progress < 0) return
  const lamps = 5
  const lit = Math.max(0, Math.min(lamps, Math.round(progress * lamps)))
  const step = (w - 4) / lamps
  for (let i = 0; i < lamps; i++) {
    ctx.fillStyle = i < lit ? '#f3e4a4' : '#3a342c'
    ctx.fillRect(x + 2 + i * step, y - 3.1, Math.max(2, step - 1.3), 1.8)
  }
}

function paintDish(ctx: CanvasRenderingContext2D, angle: number): void {
  const [px, py] = panelOrigin(1, 1)
  const x = px + ROOF.cell / 2
  const y = py + ROOF.cell / 2
  ctx.fillStyle = '#6a645c'
  ctx.beginPath()
  ctx.ellipse(x, y + 1, 3.2, 1.6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#4e4a44'
  ctx.fillRect(x - 1.1, y - 5, 2.2, 6)
  ctx.save()
  ctx.translate(x, y - 6)
  ctx.rotate(angle)
  ctx.strokeStyle = '#3a3632'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(9, 0)
  ctx.stroke()
  const bowl = ctx.createLinearGradient(2, -8, 20, 8)
  bowl.addColorStop(0, '#f7f4ee')
  bowl.addColorStop(0.4, '#d5d8de')
  bowl.addColorStop(1, '#5a6068')
  ctx.fillStyle = bowl
  ctx.beginPath()
  ctx.ellipse(13, 0, 11, 5.4, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#2a2e34'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(8, 0, 8.5, -1.05, 1.05)
  ctx.stroke()
  ctx.fillStyle = '#2c3138'
  ctx.beginPath()
  ctx.ellipse(16, 0, 2.2, 1.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function paintTinyStalker(ctx: CanvasRenderingContext2D, cx: number, foot: number, color: string): void {
  ctx.fillStyle = '#1c1c1c'
  ctx.fillRect(cx - 3.1, foot - 2, 2.2, 2)
  ctx.fillRect(cx + 0.9, foot - 2, 2.2, 2)
  ctx.fillStyle = '#8d9096'
  ctx.fillRect(cx - 2.6, foot - 7.2, 5.2, 5.4)
  ctx.fillStyle = color
  ctx.fillRect(cx - 2.6, foot - 6.2, 5.2, 1.3)
  ctx.beginPath()
  ctx.arc(cx, foot - 9.2, 2.3, 0, Math.PI * 2)
  ctx.fillStyle = '#e2ba9a'
  ctx.fill()
  ctx.fillStyle = '#555b63'
  ctx.beginPath()
  ctx.ellipse(cx, foot - 10, 2.5, 1.5, 0, Math.PI, 0, false)
  ctx.fill()
  ctx.fillStyle = '#172028'
  ctx.fillRect(cx - 1.6, foot - 9, 3.2, 1.1)
}

function paintPod(ctx: CanvasRenderingContext2D, x: number, y: number, filled: boolean, color: string): void {
  ctx.fillStyle = '#6a6458'
  roundPath(ctx, x - 1, y + POD_H - 3, POD_W + 2, 5, 2)
  ctx.fill()
  ctx.fillStyle = '#4a453e'
  ctx.fillRect(x + POD_W / 2 - 1, y + 2, 2, POD_H - 2)

  const shell = ctx.createLinearGradient(x, y, x + POD_W, y)
  shell.addColorStop(0, '#f7f4ee')
  shell.addColorStop(0.45, '#e7e1d6')
  shell.addColorStop(1, '#c9c1b4')
  ctx.fillStyle = shell
  roundPath(ctx, x, y, POD_W, POD_H, 6)
  ctx.fill()
  ctx.lineWidth = 1.6
  ctx.strokeStyle = color
  ctx.stroke()

  ctx.save()
  roundPath(ctx, x + 3, y + 3, POD_W - 6, POD_H - 6, 4)
  ctx.clip()
  ctx.fillStyle = filled ? '#1a242c' : '#101418'
  ctx.fillRect(x + 3, y + 3, POD_W - 6, POD_H - 6)
  if (filled) {
    paintTinyStalker(ctx, x + POD_W / 2, y + POD_H - 6, color)
    ctx.fillStyle = 'rgba(214, 240, 250, 0.28)'
    ctx.fillRect(x + 3, y + 3, POD_W - 6, POD_H - 6)
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
  ctx.fillRect(x + 4, y + 4, 2, 8)
  ctx.restore()
}

function paintCryo(ctx: CanvasRenderingContext2D, color: string, held: number): void {
  const pods = Math.max(0, Math.min(PODS.length, Math.floor(held)))
  ctx.fillStyle = '#5a544c'
  ctx.fillRect(4, 24, 3, 36)
  ctx.fillRect(89, 24, 3, 36)
  ctx.fillStyle = color
  ctx.fillRect(3, 22, 5, 2)
  ctx.fillRect(3, 58, 5, 2)
  ctx.fillRect(88, 22, 5, 2)
  ctx.fillRect(88, 58, 5, 2)
  PODS.forEach(([x, y], index) => {
    paintPod(ctx, x, y, index < pods, color)
  })
}

function paintSmoke(ctx: CanvasRenderingContext2D, time: number, stage: number): void {
  if (stage < 2) return
  const drift = Math.sin(time * 1.3) * 2.2
  ctx.fillStyle = stage >= 3 ? 'rgba(54, 50, 46, 0.38)' : 'rgba(70, 66, 60, 0.22)'
  ctx.beginPath()
  ctx.ellipse(28 + drift, 4, 7, 3.2, 0, 0, Math.PI * 2)
  ctx.ellipse(70 - drift * 0.6, 2, 5.5, 2.6, 0, 0, Math.PI * 2)
  ctx.fill()
}

function paintRuin(ctx: CanvasRenderingContext2D, time: number): void {
  paintSmoke(ctx, time, 4)
  const drift = Math.sin(time * 1.7) * 3
  ctx.fillStyle = 'rgba(28, 24, 20, 0.55)'
  ctx.beginPath()
  ctx.ellipse(42 + drift, 2, 14, 5, 0, 0, Math.PI * 2)
  ctx.ellipse(68 - drift, 8, 9, 4, 0, 0, Math.PI * 2)
  ctx.fill()
}

export function drawKeepSprite(ctx: CanvasRenderingContext2D, x: number, y: number, look: KeepLook): void {
  const body = bodySprite(look.stage)
  ctx.drawImage(body, x - OX, y - OY)
  ctx.save()
  ctx.translate(x, y)
  if (look.stage >= 4) paintRuin(ctx, look.smoke)
  else {
    if (look.cryo) paintCryo(ctx, look.color, look.held)
    paintRoofFill(ctx, look.lit, look.id, look.smoke)
    paintDoor(ctx, look.open, look.color, look.smoke, look.progress)
    paintDish(ctx, look.dish)
    paintSmoke(ctx, look.smoke, look.stage)
  }
  ctx.restore()
}

/** Selection portrait for a wreck. Empty when there is no document, so smoke can call it. */
export function ruinedSiloPortraitUrl(): string {
  if (typeof document === 'undefined') return ''
  const cached = portraits.get(-1)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 72
  canvas.height = 72
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#3a342c'
  ctx.fillRect(0, 0, 72, 72)
  ctx.save()
  ctx.translate(4, 2)
  ctx.scale(0.62, 0.62)
  drawKeepSprite(ctx, 0, 0, {
    color: '#6a645c',
    open: 0,
    lit: 0,
    stage: 4,
    dish: 0,
    progress: -1,
    smoke: 1.2,
    cryo: false,
    held: 0,
  })
  ctx.restore()
  const url = canvas.toDataURL()
  portraits.set(-1, url)
  return url
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
  ctx.translate(4, 2)
  ctx.scale(0.62, 0.62)
  drawKeepSprite(ctx, 0, 0, {
    color: PLAYER_COLOR[owner] ?? '#5ec8ff',
    open: 0,
    lit: 4,
    stage: 0,
    dish: 0.7,
    progress: -1,
    smoke: 0,
    cryo: false,
    held: 0,
  })
  ctx.restore()
  const url = canvas.toDataURL()
  portraits.set(owner, url)
  return url
}
