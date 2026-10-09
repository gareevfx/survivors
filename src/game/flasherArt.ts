import { facingBasis, facingDir } from './stalkerArt'
import { PLAYER_COLOR, UNIT_STATS, type Unit } from './types'

/**
 * Original Flasher art: a two-wheel canopy bike.
 * Body panels use the owner's color. Sprites are cached.
 * The gun stays out for a short time after a shot, then retracts.
 */

const SIZE = 64
const OX = 32
const OY = 34

const INK = '#14110e'
const RUBBER = '#161616'
const METAL = '#2c333b'
const PACK = '#3a342e'

/** Gun stays deployed this long after the cooldown is set by a shot. */
const GUN_HOLD = 0.3
const FLASH_HOLD = 0.1

const sprites = new Map<string, HTMLCanvasElement>()
const portraits = new Map<number, string>()

function teamColor(owner: number): string {
  return PLAYER_COLOR[owner] ?? PLAYER_COLOR[0] ?? '#5ec8ff'
}

function shade(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  const channel = (shift: number) => {
    const raw = (value >> shift) & 255
    return Math.max(0, Math.min(255, raw + amount))
  }
  const r = channel(16)
  const g = channel(8)
  const b = channel(0)
  return `rgb(${r}, ${g}, ${b})`
}

export function flasherSprite(unit: Unit): HTMLCanvasElement {
  const moving = unit.goalX != null
  const frame = moving ? Math.floor(unit.anim) % 2 : 0
  const cool = UNIT_STATS.pike.cooldown
  const firing = unit.attackCd > cool - GUN_HOLD
  const flash = unit.attackCd > cool - FLASH_HOLD
  return flasherFrame(unit.owner, facingDir(unit.facing), frame, firing, flash)
}

export function flasherFrame(
  owner: number,
  dir: number,
  frame: number,
  firing: boolean,
  flash: boolean,
): HTMLCanvasElement {
  const key = `${owner}:${dir}:${frame}:${firing ? 1 : 0}:${flash ? 1 : 0}`
  const cached = sprites.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.translate(OX, OY)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  paintFlasher(ctx, dir, frame, firing, flash, teamColor(owner))
  sprites.set(key, canvas)
  return canvas
}

/** Bust used on the Factory train button and the selection panel. */
export function flasherPortraitUrl(owner: number): string {
  if (typeof document === 'undefined') return ''
  const cached = portraits.get(owner)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 40
  canvas.height = 40
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.translate(20, 22)
  ctx.scale(0.92, 0.92)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  paintFlasher(ctx, 1, 0, false, false, teamColor(owner))
  const url = canvas.toDataURL()
  portraits.set(owner, url)
  return url
}

/** Directions across, idle and firing down, on a plain ground. */
export function paintFlasherSheet(canvas: HTMLCanvasElement): void {
  const cell = 68
  const cols = 8
  const rows: Array<{ owner: number; frame: number; firing: boolean; flash: boolean }> = [
    { owner: 0, frame: 0, firing: false, flash: false },
    { owner: 0, frame: 1, firing: false, flash: false },
    { owner: 1, frame: 0, firing: true, flash: false },
    { owner: 1, frame: 1, firing: true, flash: true },
    { owner: 2, frame: 0, firing: false, flash: false },
    { owner: 3, frame: 1, firing: true, flash: true },
  ]
  canvas.width = cols * cell
  canvas.height = rows.length * cell
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#e7e0d2'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.font = '10px sans-serif'
  ctx.fillStyle = '#5c564c'
  ctx.strokeStyle = 'rgba(40, 32, 24, 0.12)'
  const names = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']
  for (let col = 0; col < cols; col++) {
    ctx.fillText(names[col] ?? '', col * cell + 4, 12)
    for (let row = 0; row < rows.length; row++) {
      const pose = rows[row]
      if (!pose) continue
      const sprite = flasherFrame(pose.owner, col, pose.frame, pose.firing, pose.flash)
      ctx.drawImage(sprite, col * cell + (cell - SIZE) / 2, row * cell + 10)
      ctx.strokeRect(col * cell + 0.5, row * cell + 0.5, cell - 1, cell - 1)
    }
  }
}

function paintFlasher(
  ctx: CanvasRenderingContext2D,
  dir: number,
  frame: number,
  firing: boolean,
  flash: boolean,
  color: string,
): void {
  const { ang, fx, fy, sx, sy } = facingBasis(dir)
  const at = (forward: number, side: number) => ({
    x: fx * forward + sx * side,
    y: fy * forward + sy * side,
  })

  ctx.strokeStyle = INK
  ctx.lineWidth = 1.3

  wheel(ctx, at(-11.5, 0), frame)

  plate(ctx, at(-8.4, 0), 6.2, 4.6, ang, PACK)
  plate(ctx, at(-5.6, 5.4), 4.4, 3.2, ang, '#2a2e2c')
  plate(ctx, at(-5.6, -5.4), 4.4, 3.2, ang, '#2a2e2c')

  const hull = [
    at(-9.2, 3.3),
    at(0.5, 5.1),
    at(7.2, 2.7),
    at(11.4, 0.7),
    at(11.4, -0.7),
    at(7.2, -2.7),
    at(0.5, -5.1),
    at(-9.2, -3.3),
  ]
  trace(ctx, hull)
  ctx.fillStyle = color
  ctx.fill()
  ctx.stroke()

  const belly = [at(-7.2, 0.5), at(6.4, 0.2), at(8.6, 1.8), at(0.4, 3.5), at(-7.2, 2.5)]
  trace(ctx, belly)
  ctx.fillStyle = shade(color, -48)
  ctx.fill()

  const forkHub = at(11.2, 0)
  ctx.beginPath()
  ctx.moveTo(at(6.2, -1.5).x, at(6.2, -1.5).y)
  ctx.lineTo(forkHub.x, forkHub.y)
  ctx.moveTo(at(6.2, 1.5).x, at(6.2, 1.5).y)
  ctx.lineTo(forkHub.x, forkHub.y)
  ctx.strokeStyle = METAL
  ctx.lineWidth = 1.5
  ctx.stroke()

  wheel(ctx, forkHub, frame)

  const barA = at(13.1, -2.5)
  const barB = at(13.1, 2.5)
  ctx.beginPath()
  ctx.moveTo(barA.x, barA.y)
  ctx.lineTo(barB.x, barB.y)
  ctx.strokeStyle = '#1b2128'
  ctx.lineWidth = 2.3
  ctx.stroke()
  for (const side of [-1.7, 1.7]) {
    const lamp = at(13.4, side)
    ctx.beginPath()
    ctx.arc(lamp.x, lamp.y, 1.2, 0, Math.PI * 2)
    ctx.fillStyle = '#fff3c2'
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // Same overhead camera as the Stalker: the roof sits up the screen, and the nose still points with facing.
  const facing = fy
  const seat = at(0.4, 0)
  const lift = -6.2
  const bx = seat.x
  const by = seat.y + lift
  const canopyW = 4.6 + Math.abs(facing) * 2.1

  ctx.beginPath()
  ctx.ellipse(bx, by + 1.3, canopyW * 0.58, 2.15, 0, 0, Math.PI * 2)
  ctx.fillStyle = '#24282e'
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.15
  ctx.stroke()

  const hx = bx + fx * 0.7
  const hy = by - 2.3
  ctx.beginPath()
  ctx.arc(hx, hy, 2.45, 0, Math.PI * 2)
  ctx.fillStyle = '#17191d'
  ctx.fill()
  ctx.stroke()
  if (facing > -0.4) {
    ctx.beginPath()
    ctx.ellipse(hx + fx * 1.15, hy + 0.35, 1.65, 0.72, ang * 0.2, 0, Math.PI * 2)
    ctx.fillStyle = '#b7e4ff'
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.arc(hx - fx * 0.45, hy + 0.15, 1.25, 0, Math.PI * 2)
    ctx.fillStyle = '#2c3138'
    ctx.fill()
    ctx.stroke()
  }

  ctx.beginPath()
  ctx.ellipse(bx, by - 0.3, canopyW, 3.9, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(214, 236, 246, 0.2)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(236, 248, 255, 0.95)'
  ctx.lineWidth = 1.35
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(bx - 1.5, by - 2.5, Math.min(3.1, canopyW * 0.55), 1.05, -0.4, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.62)'
  ctx.fill()

  if (firing) {
    const pod = at(6.4, 2.3)
    const root = { x: pod.x, y: pod.y + lift * 0.45 }
    const tip = { x: root.x + fx * 9.2, y: root.y + fy * 9.2 }
    ctx.beginPath()
    ctx.moveTo(root.x, root.y)
    ctx.lineTo(tip.x, tip.y)
    ctx.strokeStyle = '#12161c'
    ctx.lineWidth = 2.8
    ctx.stroke()
    ctx.strokeStyle = INK
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(root.x, root.y, 1.85, 0, Math.PI * 2)
    ctx.fillStyle = '#2a313a'
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.15
    ctx.stroke()
    if (flash) {
      const burst = { x: tip.x + fx * 2.3, y: tip.y + fy * 2.3 }
      ctx.beginPath()
      ctx.arc(tip.x, tip.y, 2.2, 0, Math.PI * 2)
      ctx.fillStyle = '#fff6d2'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(burst.x, burst.y, 1.45, 0, Math.PI * 2)
      ctx.fillStyle = '#ffb45c'
      ctx.fill()
    }
  }
}

function wheel(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, frame: number): void {
  ctx.beginPath()
  ctx.arc(p.x, p.y, 4.7, 0, Math.PI * 2)
  ctx.fillStyle = RUBBER
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.35
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(p.x, p.y, 2.9, 0, Math.PI * 2)
  ctx.fillStyle = '#2a2a2a'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(p.x, p.y, 1.35, 0, Math.PI * 2)
  ctx.fillStyle = '#9aa3ac'
  ctx.fill()
  const spin = frame ? Math.PI / 2 : 0.18
  ctx.beginPath()
  ctx.moveTo(p.x + Math.cos(spin) * 3.3, p.y + Math.sin(spin) * 3.3)
  ctx.lineTo(p.x - Math.cos(spin) * 3.3, p.y - Math.sin(spin) * 3.3)
  ctx.moveTo(p.x - Math.sin(spin) * 3.3, p.y + Math.cos(spin) * 3.3)
  ctx.lineTo(p.x + Math.sin(spin) * 3.3, p.y - Math.cos(spin) * 3.3)
  ctx.strokeStyle = '#6a727b'
  ctx.lineWidth = 1
  ctx.stroke()
}

function plate(
  ctx: CanvasRenderingContext2D,
  p: { x: number; y: number },
  along: number,
  across: number,
  ang: number,
  fill: string,
): void {
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(ang)
  ctx.beginPath()
  ctx.rect(-along / 2, -across / 2, along, across)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.15
  ctx.stroke()
  ctx.restore()
}

function trace(ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>): void {
  ctx.beginPath()
  const first = points[0]
  if (!first) return
  ctx.moveTo(first.x, first.y)
  for (let i = 1; i < points.length; i++) {
    const point = points[i]
    if (point) ctx.lineTo(point.x, point.y)
  }
  ctx.closePath()
}
