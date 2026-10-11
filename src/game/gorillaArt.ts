import { facingBasis, facingDir } from './stalkerArt'
import { PLAYER_COLOR, UNIT_STATS, type Unit } from './types'

/**
 * Original Gorilla art: a heavy four-leg walker with one hull cannon.
 * The hull is light gray. Team color replaces the orange bands. Sprites are cached.
 * The gun is bolted along the hull and recoils after a shot.
 */

const SIZE = 112
const OX = 56
const OY = 80
export const GORILLA_OX = OX
export const GORILLA_OY = OY

const INK = '#2a3036'
const HULL = '#e6e8ec'
const HULL_SHADE = '#b7bec6'
const MECH = '#4a525b'
const MECH_DARK = '#2a3036'
const JOINT = '#6a737c'

const RECOIL_HOLD = 0.3
const FLASH_HOLD = 0.12
const BODY = 16

const sprites = new Map<string, HTMLCanvasElement>()
const portraits = new Map<number, string>()

type Pt = { x: number; y: number }

const LEGS = [
  { hipF: 2.4, hipS: 7.4, footF: 9.2, footS: 13.2 },
  { hipF: 2.4, hipS: -7.4, footF: 9.2, footS: -13.2 },
  { hipF: -6.2, hipS: 6.6, footF: -13.4, footS: 12.2 },
  { hipF: -6.2, hipS: -6.6, footF: -13.4, footS: -12.2 },
]

function teamColor(owner: number): string {
  return PLAYER_COLOR[owner] ?? PLAYER_COLOR[0] ?? '#5ec8ff'
}

export function gorillaSprite(unit: Unit): HTMLCanvasElement {
  const moving = unit.goalX != null
  const frame = moving ? (Math.floor(unit.anim) % 2) + 1 : 0
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
  ctx.translate(20, 28)
  ctx.scale(0.5, 0.5)
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
  const basis = facingBasis(dir)
  const at = (forward: number, side: number, lift = BODY): Pt => ({
    x: basis.fx * forward + basis.sx * side,
    y: basis.fy * forward + basis.sy * side - lift,
  })
  const posed = LEGS.map((leg, index) => poseLeg(leg, index, frame, at)).sort((a, b) => a.depth - b.depth)
  for (const leg of posed) {
    if (leg.depth <= 1) paintLeg(ctx, leg, accent)
  }
  paintHull(ctx, at, accent)
  paintCannon(ctx, at, firing, flash, accent)
  paintAntenna(ctx, at, accent)
  for (const leg of posed) {
    if (leg.depth > 1) paintLeg(ctx, leg, accent)
  }
}

function poseLeg(
  leg: (typeof LEGS)[number],
  index: number,
  frame: number,
  at: (forward: number, side: number, lift?: number) => Pt,
): { hip: Pt; knee: Pt; foot: Pt; depth: number } {
  const reachF = leg.footF - leg.hipF
  const reachS = leg.footS - leg.hipS
  const reach = Math.hypot(reachF, reachS) || 1
  const step = legSwing(index, frame)
  const along = (step * 3.4) / reach
  const planted = step > 0 ? 2.4 : 0
  const footF = leg.footF + reachF * along
  const footS = leg.footS + reachS * along
  return {
    hip: at(leg.hipF, leg.hipS, 11),
    knee: at(leg.hipF + reachF * 0.45, leg.hipS + reachS * 0.55, 5 + planted),
    foot: at(footF, footS, planted * 0.4),
    depth: at(footF, footS, 0).y,
  }
}

function legSwing(index: number, frame: number): number {
  if (frame === 0) return 0
  const lead = index === 0 || index === 3
  const phase = frame === 1 ? 1 : -1
  return lead ? phase : -phase
}

function paintLeg(
  ctx: CanvasRenderingContext2D,
  leg: { hip: Pt; knee: Pt; foot: Pt },
  accent: string,
): void {
  ctx.strokeStyle = MECH_DARK
  ctx.lineWidth = 5.2
  ctx.beginPath()
  ctx.moveTo(leg.hip.x, leg.hip.y)
  ctx.lineTo(leg.knee.x, leg.knee.y)
  ctx.lineTo(leg.foot.x, leg.foot.y)
  ctx.stroke()
  ctx.strokeStyle = MECH
  ctx.lineWidth = 2.2
  ctx.stroke()
  ctx.fillStyle = JOINT
  for (const joint of [leg.hip, leg.knee]) {
    ctx.beginPath()
    ctx.arc(joint.x, joint.y, 2.3, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = accent
  ctx.fillRect(leg.foot.x - 3.2, leg.foot.y - 2.2, 6.4, 2.4)
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.strokeRect(leg.foot.x - 3.2, leg.foot.y - 2.2, 6.4, 2.4)
}

function paintHull(ctx: CanvasRenderingContext2D, at: (forward: number, side: number, lift?: number) => Pt, accent: string): void {
  const hull = [at(-10, 6.2), at(4, 7.4), at(12, 4.2), at(12, -4.2), at(4, -7.4), at(-10, -6.2)]
  trace(ctx, hull)
  ctx.fillStyle = HULL
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.3
  ctx.stroke()
  const shade = [at(-8, 2), at(8, 2.4), at(10, 5.6), at(-6, 5.2)]
  trace(ctx, shade)
  ctx.fillStyle = HULL_SHADE
  ctx.fill()
  const bandA = at(-2, -6.4)
  const bandB = at(-2, 6.4)
  ctx.strokeStyle = accent
  ctx.lineWidth = 2.4
  ctx.beginPath()
  ctx.moveTo(bandA.x, bandA.y)
  ctx.lineTo(bandB.x, bandB.y)
  ctx.stroke()
  const plate = at(3.2, 4.6)
  ctx.fillStyle = '#d5d9df'
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(plate.x - 4.5, plate.y - 3.2, 9, 6.2, 1)
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = accent
  ctx.lineWidth = 1.1
  ctx.beginPath()
  ctx.moveTo(plate.x - 2.4, plate.y + 0.8)
  ctx.lineTo(plate.x, plate.y - 1.4)
  ctx.lineTo(plate.x + 2.4, plate.y + 0.8)
  ctx.moveTo(plate.x - 2, plate.y + 1.6)
  ctx.lineTo(plate.x + 2, plate.y + 1.6)
  ctx.stroke()
}

function paintCannon(
  ctx: CanvasRenderingContext2D,
  at: (forward: number, side: number, lift?: number) => Pt,
  firing: boolean,
  flash: boolean,
  accent: string,
): void {
  const recoil = firing ? -3.2 : 0
  const breech = at(-2, 0, BODY + 4)
  const muzzle = at(24 + recoil, 0, BODY + 5)
  ctx.strokeStyle = MECH_DARK
  ctx.lineWidth = 5.5
  ctx.beginPath()
  ctx.moveTo(breech.x, breech.y)
  ctx.lineTo(muzzle.x, muzzle.y)
  ctx.stroke()
  ctx.strokeStyle = '#8e98a2'
  ctx.lineWidth = 2.2
  ctx.stroke()
  const band = at(6 + recoil * 0.3, 0, BODY + 5)
  ctx.strokeStyle = accent
  ctx.lineWidth = 2.6
  ctx.beginPath()
  ctx.moveTo(band.x - 2, band.y - 2)
  ctx.lineTo(band.x + 2, band.y + 2)
  ctx.stroke()
  ctx.fillStyle = MECH
  ctx.beginPath()
  ctx.arc(breech.x, breech.y, 4.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.stroke()
  if (!flash) return
  const flare = at(27 + recoil, 0, BODY + 5)
  ctx.fillStyle = '#fff1c4'
  ctx.beginPath()
  ctx.arc(flare.x, flare.y, 4.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ff9a3c'
  ctx.beginPath()
  ctx.arc(flare.x + (muzzle.x - breech.x) * 0.12, flare.y + (muzzle.y - breech.y) * 0.12, 2.2, 0, Math.PI * 2)
  ctx.fill()
}

function paintAntenna(ctx: CanvasRenderingContext2D, at: (forward: number, side: number, lift?: number) => Pt, accent: string): void {
  ctx.strokeStyle = MECH_DARK
  ctx.lineWidth = 1.2
  for (const side of [-3.4, 4.2]) {
    const root = at(-7.5, side, BODY + 2)
    const tip = at(-8.2, side * 1.15, BODY + 12)
    ctx.beginPath()
    ctx.moveTo(root.x, root.y)
    ctx.lineTo(tip.x, tip.y)
    ctx.stroke()
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.arc(tip.x, tip.y, 1.3, 0, Math.PI * 2)
    ctx.fill()
  }
}

function trace(ctx: CanvasRenderingContext2D, points: Pt[]): void {
  const first = points[0]
  if (!first) return
  ctx.beginPath()
  ctx.moveTo(first.x, first.y)
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y)
  ctx.closePath()
}
