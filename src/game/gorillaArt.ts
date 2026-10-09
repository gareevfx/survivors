import { facingBasis, facingDir } from './stalkerArt'
import { PLAYER_COLOR, UNIT_STATS, type Unit } from './types'

/**
 * Original Gorilla art: a square tracked tank with a fixed turret.
 * The hull is off-white. Team color is the secondary panels. Sprites are cached.
 * The gun is bolted to the hull facing and recoils after a shot.
 */

const SIZE = 56
const OX = 28
const OY = 30

const INK = '#2c3036'
const WHITE = '#f4f1e8'
const SHADE = '#d7d3c8'
const TRACK = '#2a2c2a'
const TRACK_SHOE = '#3a3e3a'

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
  ctx.scale(1.15, 1.15)
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

  const half = 6.8
  const hull = [at(-half, -half), at(half, -half), at(half, half), at(-half, half)]
  trace(ctx, hull)
  ctx.fillStyle = WHITE
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = INK
  ctx.stroke()

  const shade = [at(-half, 0), at(half, 0), at(half, half), at(-half, half)]
  trace(ctx, shade)
  ctx.fillStyle = SHADE
  ctx.fill()

  paintTrack(ctx, at, half - 1.2, frame, ang, half * 2 - 1.4)
  paintTrack(ctx, at, -(half - 1.2), frame, ang, half * 2 - 1.4)
  trace(ctx, hull)
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.5
  ctx.stroke()

  ctx.beginPath()
  const seamA = at(-half * 0.55, 0)
  const seamB = at(half * 0.55, 0)
  ctx.moveTo(seamA.x, seamA.y)
  ctx.lineTo(seamB.x, seamB.y)
  ctx.strokeStyle = '#5c6168'
  ctx.lineWidth = 0.9
  ctx.stroke()

  plate(ctx, at(0, half - 2.55), half * 1.7, 1.65, ang, accent)
  plate(ctx, at(0, -(half - 2.55)), half * 1.7, 1.65, ang, accent)
  plate(ctx, at(half - 1.2, 0), 2.15, half * 1.15, ang, accent)
  plate(ctx, at(-half + 2.3, 0), 2.4, 2.4, ang, accent)

  const turret = 3.15
  const top = [at(-turret, -turret), at(turret, -turret), at(turret, turret), at(-turret, turret)]
  trace(ctx, top)
  ctx.fillStyle = WHITE
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.35
  ctx.stroke()
  plate(ctx, at(0.15, 0), 1.55, turret * 2 - 0.4, ang, accent)
  const hatch = at(-0.7, 0)
  ctx.beginPath()
  ctx.arc(hatch.x, hatch.y - 0.4, 1.15, 0, Math.PI * 2)
  ctx.fillStyle = SHADE
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.stroke()

  const recoil = firing ? -1.8 : 0
  const breech = at(2.6 + recoil, 0)
  const muzzle = at(10.4 + recoil, 0)
  ctx.beginPath()
  ctx.moveTo(breech.x, breech.y)
  ctx.lineTo(muzzle.x, muzzle.y)
  ctx.strokeStyle = '#2a2e32'
  ctx.lineWidth = 2.8
  ctx.stroke()
  ctx.strokeStyle = INK
  ctx.lineWidth = 0.9
  ctx.stroke()
  const brakeA = at(9.2 + recoil, -1.15)
  const brakeB = at(9.2 + recoil, 1.15)
  ctx.beginPath()
  ctx.moveTo(brakeA.x, brakeA.y)
  ctx.lineTo(brakeB.x, brakeB.y)
  ctx.strokeStyle = '#24282c'
  ctx.lineWidth = 2.2
  ctx.stroke()
  if (flash) {
    const burst = at(11.2 + recoil, 0)
    ctx.beginPath()
    ctx.arc(burst.x, burst.y, 2.15, 0, Math.PI * 2)
    ctx.fillStyle = '#fff6d0'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(burst.x + fx * 2, burst.y + fy * 2, 1.3, 0, Math.PI * 2)
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
  length: number,
): void {
  plate(ctx, at(0, side), length, 2.7, ang, TRACK)
  plate(ctx, at(0, side), length - 1.2, 1.55, ang, TRACK_SHOE)
  const shift = frame ? 1.45 : 0
  const start = -length / 2 + 1.5
  for (let i = 0; i < 4; i++) {
    const link = at(start + i * 3.15 + shift, side)
    ctx.beginPath()
    ctx.arc(link.x, link.y, 0.75, 0, Math.PI * 2)
    ctx.fillStyle = '#141614'
    ctx.fill()
  }
  for (const forward of [-4.2, 0, 4.2]) {
    const wheel = at(forward, side)
    ctx.beginPath()
    ctx.arc(wheel.x, wheel.y, 1.15, 0, Math.PI * 2)
    ctx.fillStyle = '#8d918a'
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.9
    ctx.stroke()
  }
}

function paintAntenna(
  ctx: CanvasRenderingContext2D,
  at: (forward: number, side: number) => { x: number; y: number },
  frame: number,
  accent: string,
): void {
  const sway = frame ? 1.6 : 0
  const base = at(-3.4, 0.8)
  const mid = at(-6.4, sway * 0.5)
  const tip = at(-9.2, sway)
  mid.y -= 2.4
  tip.y -= 5.2
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
  ctx.fillStyle = '#4a4e54'
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
