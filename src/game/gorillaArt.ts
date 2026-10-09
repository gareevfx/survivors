import { facingBasis, facingDir } from './stalkerArt'
import { PLAYER_COLOR, UNIT_STATS, type Unit } from './types'

/**
 * Original Gorilla art: a tracked tank with a fixed turret.
 * The hull stays gray-olive. Team color is trim only. Sprites are cached.
 * The gun is bolted to the hull facing and recoils after a shot.
 */

const SIZE = 72
const OX = 36
const OY = 38

const INK = '#14110e'
const HULL = '#6d7264'
const HULL_DARK = '#4c5148'
const TRACK = '#2a2c28'
const TRACK_SHOE = '#3c4038'
const METAL = '#2e3330'

const RECOIL_HOLD = 0.3
const FLASH_HOLD = 0.12

const sprites = new Map<string, HTMLCanvasElement>()
const portraits = new Map<number, string>()

function teamColor(owner: number): string {
  return PLAYER_COLOR[owner] ?? PLAYER_COLOR[0] ?? '#5ec8ff'
}

export function gorillaSprite(unit: Unit): HTMLCanvasElement {
  const moving = unit.goalX != null
  const frame = moving ? Math.floor(unit.anim) % 2 : 0
  const cool = UNIT_STATS.howler.cooldown
  const firing = unit.attackCd > cool - RECOIL_HOLD
  const flash = unit.attackCd > cool - FLASH_HOLD
  return gorillaFrame(unit.owner, facingDir(unit.facing), frame, firing, flash)
}

export function gorillaFrame(
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
  paintGorilla(ctx, dir, frame, firing, flash, teamColor(owner))
  sprites.set(key, canvas)
  return canvas
}

/** Bust used on the Factory train button and the selection panel. */
export function gorillaPortraitUrl(owner: number): string {
  if (typeof document === 'undefined') return ''
  const cached = portraits.get(owner)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 40
  canvas.height = 40
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.translate(20, 22)
  ctx.scale(0.72, 0.72)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  paintGorilla(ctx, 1, 0, false, false, teamColor(owner))
  const url = canvas.toDataURL()
  portraits.set(owner, url)
  return url
}

function paintGorilla(
  ctx: CanvasRenderingContext2D,
  dir: number,
  frame: number,
  firing: boolean,
  flash: boolean,
  accent: string,
): void {
  const { ang, fx, fy, sx, sy } = facingBasis(dir)
  const at = (forward: number, side: number) => ({
    x: fx * forward + sx * side,
    y: fy * forward + sy * side,
  })

  ctx.strokeStyle = INK
  ctx.lineWidth = 1.3

  if (fy > 0) paintAntenna(ctx, at, frame, accent)

  paintTrack(ctx, at, 6.4, frame, ang)
  paintTrack(ctx, at, -6.4, frame, ang)

  const hull = [
    at(-8.4, 4.6),
    at(5.6, 4.8),
    at(10.2, 2.1),
    at(10.2, -2.1),
    at(5.6, -4.8),
    at(-8.4, -4.6),
  ]
  trace(ctx, hull)
  ctx.fillStyle = HULL
  ctx.fill()
  ctx.stroke()

  const belly = [at(-6.2, 0.4), at(7.2, 0.2), at(8.4, 2.2), at(1.2, 3.4), at(-6.4, 2.6)]
  trace(ctx, belly)
  ctx.fillStyle = HULL_DARK
  ctx.fill()

  plate(ctx, at(-0.6, 5.15), 15.5, 1.55, ang, accent)
  plate(ctx, at(-0.6, -5.15), 15.5, 1.55, ang, accent)

  const stripeA = at(8.6, -2.4)
  const stripeB = at(8.6, 2.4)
  ctx.beginPath()
  ctx.moveTo(stripeA.x, stripeA.y)
  ctx.lineTo(stripeB.x, stripeB.y)
  ctx.strokeStyle = accent
  ctx.lineWidth = 2.2
  ctx.stroke()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.15
  ctx.stroke()

  plate(ctx, at(-5.8, 2.2), 3.4, 2.3, ang, accent)
  const mark = at(-5.8, 2.2)
  ctx.beginPath()
  ctx.moveTo(mark.x - fx * 0.8, mark.y - fy * 0.8)
  ctx.lineTo(mark.x + fx * 0.8, mark.y + fy * 0.8)
  ctx.strokeStyle = '#1c201c'
  ctx.lineWidth = 1
  ctx.stroke()

  const turret = [at(-3.4, 3.3), at(2.2, 3.5), at(4.4, 1.6), at(4.4, -1.6), at(2.2, -3.5), at(-3.4, -3.3)]
  trace(ctx, turret)
  ctx.fillStyle = '#5c6158'
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.3
  ctx.stroke()
  const hatch = at(-0.4, 0)
  ctx.beginPath()
  ctx.arc(hatch.x, hatch.y - 0.6, 1.7, 0, Math.PI * 2)
  ctx.fillStyle = '#3e433c'
  ctx.fill()
  ctx.stroke()

  const recoil = firing ? -2.6 : 0
  const breech = at(3.4 + recoil, 0)
  const muzzle = at(15.2 + recoil, 0)
  ctx.beginPath()
  ctx.moveTo(breech.x, breech.y)
  ctx.lineTo(muzzle.x, muzzle.y)
  ctx.strokeStyle = '#1c201c'
  ctx.lineWidth = 3.5
  ctx.stroke()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.stroke()
  const brakeA = at(13.4 + recoil, -1.45)
  const brakeB = at(13.4 + recoil, 1.45)
  ctx.beginPath()
  ctx.moveTo(brakeA.x, brakeA.y)
  ctx.lineTo(brakeB.x, brakeB.y)
  ctx.strokeStyle = '#141816'
  ctx.lineWidth = 2.6
  ctx.stroke()
  if (flash) {
    const burst = at(16.6 + recoil, 0)
    ctx.beginPath()
    ctx.arc(burst.x, burst.y, 2.6, 0, Math.PI * 2)
    ctx.fillStyle = '#fff6d0'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(burst.x + fx * 2.4, burst.y + fy * 2.4, 1.55, 0, Math.PI * 2)
    ctx.fillStyle = '#ffb45c'
    ctx.fill()
  }

  if (fy <= 0) paintAntenna(ctx, at, frame, accent)
}

function paintTrack(
  ctx: CanvasRenderingContext2D,
  at: (forward: number, side: number) => { x: number; y: number },
  side: number,
  frame: number,
  ang: number,
): void {
  plate(ctx, at(-0.2, side), 24.5, 5.5, ang, TRACK)
  plate(ctx, at(-0.2, side), 22.2, 3.5, ang, TRACK_SHOE)
  const shift = frame ? 2.05 : 0
  for (let i = 0; i < 5; i++) {
    const link = at(-8.2 + i * 4.15 + shift, side)
    ctx.beginPath()
    ctx.arc(link.x, link.y, 1.05, 0, Math.PI * 2)
    ctx.fillStyle = '#171917'
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.8
    ctx.stroke()
  }
  for (const forward of [-7.4, -2.4, 2.6, 7.4]) {
    const wheel = at(forward, side)
    ctx.beginPath()
    ctx.arc(wheel.x, wheel.y, 1.65, 0, Math.PI * 2)
    ctx.fillStyle = '#8a8e86'
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

function paintAntenna(
  ctx: CanvasRenderingContext2D,
  at: (forward: number, side: number) => { x: number; y: number },
  frame: number,
  accent: string,
): void {
  const sway = frame ? 2.1 : 0
  const base = at(-4.2, 1.1)
  const mid = at(-8.2, sway * 0.5)
  const tip = at(-11.6, sway)
  mid.y -= 3.1
  tip.y -= 6.6
  ctx.beginPath()
  ctx.moveTo(base.x, base.y)
  ctx.quadraticCurveTo(mid.x, mid.y, tip.x, tip.y)
  ctx.strokeStyle = '#1a1e24'
  ctx.lineWidth = 1.35
  ctx.stroke()
  ctx.strokeStyle = '#4a5560'
  ctx.lineWidth = 0.5
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(base.x, base.y, 1.05, 0, Math.PI * 2)
  ctx.fillStyle = METAL
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(tip.x, tip.y, 1.35, 0, Math.PI * 2)
  ctx.fillStyle = accent
  ctx.fill()
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
  ctx.lineWidth = 1.1
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
