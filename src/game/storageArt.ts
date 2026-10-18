import { BUILDING_STATS, PLAYER_COLOR, SUPPLY_MAX } from './types'

/**
 * Storage is three standing cylinders on a 2×2 pad. The shells are drawn live
 * so the contents can rise and drain. Player color marks the rim and the hoop.
 * Empty tanks stay hollow. One tank fills at 250 stored dumps, two at 500, all
 * three at 750. Cells capacity is a separate meter: see storageFill.
 */

const W = 64

interface Tank {
  cx: number
  rx: number
}

const TANKS: Tank[] = [
  { cx: 12, rx: 8 },
  { cx: 32, rx: 8 },
  { cx: 52, rx: 8 },
]
const TOP = 16
const BOTTOM = 48
const RY = 3.6
/** One filled cylinder per this many stored dumps. */
const CYLINDER_DUMPS = 250
/** Seconds for a tank to fill or drain when the stock crosses a step. */
const FILL_SECONDS = 1

const portraits = new Map<number, string>()

/**
 * 0 when Cells are at or below a Silo plus one Storage. 1 at the Cells maximum.
 * The first finished Storage is an empty warehouse; later capacity fills it.
 */
export function storageFill(cap: number): number {
  const emptyAt = BUILDING_STATS.keep.supply + BUILDING_STATS.silo.supply
  const span = SUPPLY_MAX - emptyAt
  if (span <= 0 || cap <= emptyAt) return 0
  return Math.max(0, Math.min(1, (cap - emptyAt) / span))
}

/** How many of the three tanks read as full. None below 250, all three at 750. */
export function storageCylinderCount(stock: number): number {
  if (stock <= 0) return 0
  return Math.min(TANKS.length, Math.floor(stock / CYLINDER_DUMPS))
}

export function storageDamageStage(hp: number, full: number): number {
  const ratio = full > 0 ? hp / full : 1
  if (ratio > 0.75) return 0
  if (ratio > 0.5) return 1
  if (ratio > 0.25) return 2
  return 3
}

interface TankAnim {
  levels: number[]
  time: number
}

const tankAnims = new Map<number, TankAnim>()

function tankLevels(stock: number, anim?: { id: number; time: number }): number[] {
  const count = storageCylinderCount(stock)
  const target = TANKS.map((_, index) => (index < count ? 1 : 0))
  if (!anim || !Number.isFinite(anim.time)) return target
  let state = tankAnims.get(anim.id)
  if (!state) {
    state = { levels: target.slice(), time: anim.time }
    tankAnims.set(anim.id, state)
    return state.levels
  }
  const dt = anim.time - state.time
  state.time = anim.time
  if (dt < -0.001 || dt > 3) {
    for (let i = 0; i < target.length; i++) state.levels[i] = target[i] ?? 0
    return state.levels
  }
  if (dt <= 0) return state.levels
  const step = dt / FILL_SECONDS
  for (let i = 0; i < target.length; i++) {
    const goal = target[i] ?? 0
    const cur = state.levels[i] ?? 0
    if (cur < goal) state.levels[i] = Math.min(goal, cur + step)
    else if (cur > goal) state.levels[i] = Math.max(goal, cur - step)
  }
  return state.levels
}

function paintTank(ctx: CanvasRenderingContext2D, tank: Tank, color: string, level: number, stage: number): void {
  const { cx, rx } = tank
  const wall = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0)
  wall.addColorStop(0, '#5c656e')
  wall.addColorStop(0.32, '#d7dde3')
  wall.addColorStop(0.68, '#8e979f')
  wall.addColorStop(1, '#3e464e')
  ctx.fillStyle = wall
  ctx.beginPath()
  ctx.moveTo(cx - rx, TOP)
  ctx.lineTo(cx - rx, BOTTOM)
  ctx.bezierCurveTo(cx - rx, BOTTOM + RY, cx + rx, BOTTOM + RY, cx + rx, BOTTOM)
  ctx.lineTo(cx + rx, TOP)
  ctx.bezierCurveTo(cx + rx, TOP - RY, cx - rx, TOP - RY, cx - rx, TOP)
  ctx.closePath()
  ctx.fill()

  const irx = rx - 1.7
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(cx - irx, TOP + 0.5)
  ctx.lineTo(cx - irx, BOTTOM - 1)
  ctx.bezierCurveTo(cx - irx, BOTTOM + RY - 1.2, cx + irx, BOTTOM + RY - 1.2, cx + irx, BOTTOM - 1)
  ctx.lineTo(cx + irx, TOP + 0.5)
  ctx.bezierCurveTo(cx + irx, TOP - RY + 1.4, cx - irx, TOP - RY + 1.4, cx - irx, TOP + 0.5)
  ctx.closePath()
  ctx.clip()
  ctx.fillStyle = '#12161b'
  ctx.fillRect(cx - rx, TOP - RY, rx * 2, BOTTOM - TOP + RY * 2 + 4)
  if (level > 0.004) {
    const surface = BOTTOM - (BOTTOM - TOP) * Math.max(0, Math.min(1, level))
    const liquid = ctx.createLinearGradient(cx - irx, 0, cx + irx, 0)
    liquid.addColorStop(0, '#8a5a22')
    liquid.addColorStop(0.42, '#e2b15a')
    liquid.addColorStop(1, '#6b4218')
    ctx.fillStyle = liquid
    ctx.fillRect(cx - rx, surface, rx * 2, BOTTOM - surface + RY + 4)
    ctx.fillStyle = level > 0.92 ? '#f3d7a0' : '#f0c98a'
    ctx.beginPath()
    ctx.ellipse(cx, surface, irx * 0.92, RY * 0.62, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)'
  ctx.fillRect(cx - rx + 1.4, TOP + 2, 1.3, BOTTOM - TOP - 4)

  ctx.strokeStyle = '#e7ebef'
  ctx.lineWidth = 1.15
  ctx.beginPath()
  ctx.ellipse(cx, TOP, rx * 0.92, RY * 0.85, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.7
  ctx.beginPath()
  ctx.ellipse(cx, TOP, rx, RY, 0, 0, Math.PI * 2)
  ctx.stroke()

  const hoopY = TOP + (BOTTOM - TOP) * 0.58
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx - rx + 0.4, hoopY)
  ctx.bezierCurveTo(cx - rx, hoopY + RY * 0.85, cx + rx, hoopY + RY * 0.85, cx + rx - 0.4, hoopY)
  ctx.stroke()

  if (stage >= 1) {
    ctx.strokeStyle = 'rgba(36, 30, 26, 0.7)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx - rx * 0.2, TOP + 6)
    ctx.lineTo(cx + rx * 0.15, (TOP + BOTTOM) / 2)
    ctx.lineTo(cx - rx * 0.05, BOTTOM - 4)
    ctx.stroke()
  }
  if (stage >= 2) {
    ctx.fillStyle = 'rgba(28, 24, 20, 0.38)'
    ctx.beginPath()
    ctx.ellipse(cx + rx * 0.2, (TOP + BOTTOM) / 2 + 2, rx * 0.45, 4, 0.2, 0, Math.PI * 2)
    ctx.fill()
  }
}

function paintStorage(ctx: CanvasRenderingContext2D, color: string, levels: number[], stage: number): void {
  ctx.fillStyle = 'rgba(16, 12, 8, 0.28)'
  ctx.beginPath()
  ctx.ellipse(W / 2 + 1, 60, 28, 6, 0, 0, Math.PI * 2)
  ctx.fill()

  const pad = ctx.createLinearGradient(4, 44, 60, 62)
  pad.addColorStop(0, '#e4ddd0')
  pad.addColorStop(1, '#9a9386')
  ctx.fillStyle = pad
  ctx.beginPath()
  ctx.moveTo(6, 46)
  ctx.lineTo(58, 46)
  ctx.quadraticCurveTo(62, 46, 62, 52)
  ctx.lineTo(62, 56)
  ctx.quadraticCurveTo(62, 62, 56, 62)
  ctx.lineTo(8, 62)
  ctx.quadraticCurveTo(2, 62, 2, 56)
  ctx.lineTo(2, 52)
  ctx.quadraticCurveTo(2, 46, 6, 46)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#7d766c'
  ctx.lineWidth = 1
  ctx.stroke()

  for (let i = 0; i < TANKS.length; i++) {
    const tank = TANKS[i]
    if (!tank) continue
    paintTank(ctx, tank, color, levels[i] ?? 0, stage)
  }

  if (stage >= 3) {
    ctx.fillStyle = 'rgba(20, 18, 16, 0.42)'
    ctx.beginPath()
    ctx.ellipse(18, 40, 7, 3, -0.2, 0, Math.PI * 2)
    ctx.ellipse(46, 36, 6, 2.6, 0.3, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function drawStorageSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  stock: number,
  stage: number,
  anim?: { id: number; time: number },
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  paintStorage(ctx, color, tankLevels(stock, anim), stage)
  ctx.restore()
}

/** Selection portrait and build-menu icon. Empty when there is no document, so smoke can call it. */
export function storagePortraitUrl(owner: number): string {
  if (typeof document === 'undefined') return ''
  const cached = portraits.get(owner)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 72
  canvas.height = 72
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#6d6248'
  ctx.fillRect(0, 0, 72, 72)
  ctx.save()
  ctx.translate(6, 6)
  ctx.scale(0.9, 0.9)
  drawStorageSprite(ctx, 0, 0, PLAYER_COLOR[owner] ?? '#5ec8ff', 500, 0)
  ctx.restore()
  const url = canvas.toDataURL()
  portraits.set(owner, url)
  return url
}
