import { facingBasis, facingDir } from './stalkerArt'
import { PLAYER_COLOR, UNIT_STATS, type Unit } from './types'

/**
 * Original Flasher art: a four-leg gun walker.
 * The hull is off-white. Team color is the trim. Sprites are cached per
 * facing, owner, walk frame, and muzzle flash. The twin guns stay mounted.
 */

const SIZE = 80
const OX = 40
const OY = 42

const INK = '#2c3238'
const HULL = '#f4f1e8'
const HULL_SHADE = '#ddd6c8'
const MECH = '#3c444d'
const MECH_DARK = '#242a30'
const MECH_LIGHT = '#8d959e'
const JOINT = '#4a535c'

const RECOIL_HOLD = 0.3
const FLASH_HOLD = 0.1

const sprites = new Map<string, HTMLCanvasElement>()
const portraits = new Map<number, string>()

type Pt = { x: number; y: number }
type Basis = { ang: number; fx: number; fy: number; sx: number; sy: number }

/** Idle stance. Front pair reaches forward-out; rear pair angles back-out. */
const LEGS = [
  { hipF: 3.2, hipS: 5.15, kneeF: 8.4, kneeS: 11.4, footF: 13.2, footS: 16.2 },
  { hipF: 3.2, hipS: -5.15, kneeF: 8.4, kneeS: -11.4, footF: 13.2, footS: -16.2 },
  { hipF: -4.8, hipS: 4.7, kneeF: -10.2, kneeS: 11.0, footF: -15.2, footS: 15.6 },
  { hipF: -4.8, hipS: -4.7, kneeF: -10.2, kneeS: -11.0, footF: -15.2, footS: -15.6 },
]

function teamColor(owner: number): string {
  return PLAYER_COLOR[owner] ?? PLAYER_COLOR[0] ?? '#5ec8ff'
}

export function flasherSprite(unit: Unit): HTMLCanvasElement {
  const moving = unit.goalX != null
  const frame = moving ? (Math.floor(unit.anim) % 2) + 1 : 0
  const cool = UNIT_STATS.pike.cooldown
  const firing = unit.attackCd > cool - RECOIL_HOLD
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
  ctx.translate(20, 18)
  ctx.scale(0.8, 0.8)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  paintFlasher(ctx, 1, 0, false, false, teamColor(owner))
  const url = canvas.toDataURL()
  portraits.set(owner, url)
  return url
}

/** Eight facings across. Rows are idle, the two walk steps, and a shot, in two team colors. */
export function paintFlasherSheet(canvas: HTMLCanvasElement): void {
  const gutter = 72
  const cell = 88
  const cols = 8
  const rows: Array<{ owner: number; frame: number; firing: boolean; flash: boolean; label: string }> = [
    { owner: 0, frame: 0, firing: false, flash: false, label: 'Idle' },
    { owner: 0, frame: 1, firing: false, flash: false, label: 'Walk' },
    { owner: 0, frame: 2, firing: false, flash: false, label: 'Walk' },
    { owner: 1, frame: 0, firing: true, flash: true, label: 'Fire' },
    { owner: 1, frame: 1, firing: true, flash: true, label: 'Fire' },
  ]
  canvas.width = gutter + cols * cell
  canvas.height = rows.length * cell
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#5c6848'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.font = '11px sans-serif'
  ctx.textBaseline = 'top'
  const names = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']
  for (let row = 0; row < rows.length; row++) {
    const pose = rows[row]
    if (!pose) continue
    ctx.fillStyle = '#e7efd8'
    ctx.fillText(pose.label, 8, row * cell + 8)
    ctx.fillStyle = pose.owner === 0 ? '#5ec8ff' : '#ff5d4e'
    ctx.fillText(pose.owner === 0 ? 'Blue' : 'Red', 8, row * cell + 24)
    for (let col = 0; col < cols; col++) {
      if (row === 0) {
        ctx.fillStyle = '#e7efd8'
        ctx.fillText(names[col] ?? '', gutter + col * cell + 6, 4)
      }
      const sprite = flasherFrame(pose.owner, col, pose.frame, pose.firing, pose.flash)
      ctx.drawImage(sprite, gutter + col * cell + (cell - SIZE) / 2, row * cell + (cell - SIZE) / 2 + 4)
    }
  }
}

function paintFlasher(
  ctx: CanvasRenderingContext2D,
  dir: number,
  frame: number,
  firing: boolean,
  flash: boolean,
  accent: string,
): void {
  const basis = facingBasis(dir)
  const { ang, fx, fy } = basis
  const at = (forward: number, side: number, lift = 0): Pt => ({
    x: basis.fx * forward + basis.sx * side,
    y: basis.fy * forward + basis.sy * side - lift,
  })

  const legs = LEGS.map((leg, index) => poseLeg(leg, index, frame, at)).sort((a, b) => a.depth - b.depth)
  for (const leg of legs) paintLimb(ctx, leg, basis, accent)

  paintChassis(ctx, at, ang)
  paintSensor(ctx, at, ang)
  paintHull(ctx, at, ang, accent)
  for (const leg of legs) paintHip(ctx, leg.hip)

  const stacks = [-2.35, 2.35]
    .map((side) => ({ side, y: at(-6.6, side).y }))
    .sort((a, b) => a.y - b.y)
  for (const stack of stacks) paintStack(ctx, at, stack.side, accent)

  const recoil = firing ? -1.8 : 0
  const pods = [-1, 1].map((side) => ({ side, y: at(0.6, side * 8.15).y })).sort((a, b) => a.y - b.y)
  const muzzles: Pt[] = []
  for (const pod of pods) paintPod(ctx, at, ang, pod.side, recoil, accent, muzzles)
  if (flash) {
    for (const muzzle of muzzles) paintMuzzle(ctx, muzzle, fx, fy)
  }
}

function poseLeg(
  leg: (typeof LEGS)[number],
  index: number,
  frame: number,
  at: (forward: number, side: number, lift?: number) => Pt,
): { hip: Pt; knee: Pt; foot: Pt; side: number; outward: number; depth: number } {
  const reachF = leg.footF - leg.hipF
  const reachS = leg.footS - leg.hipS
  const reach = Math.hypot(reachF, reachS) || 1
  const step = legSwing(index, frame)
  const along = (step * 5.4) / reach
  const lift = step > 0 ? 3.2 : 0
  const footF = leg.footF + reachF * along
  const footS = leg.footS + reachS * along
  return {
    hip: at(leg.hipF, leg.hipS),
    knee: at(leg.kneeF + reachF * along * 0.5, leg.kneeS + reachS * along * 0.5, lift),
    foot: at(footF, footS, lift * 0.45),
    side: leg.hipS,
    outward: Math.sign(leg.hipS) || 1,
    depth: at(footF, footS).y,
  }
}

/** Diagonal pairs trade steps. Frame 0 is the standing stance. */
function legSwing(index: number, frame: number): number {
  if (frame === 0) return 0
  const lead = index === 0 || index === 3
  const phase = frame === 1 ? 1 : -1
  return lead ? phase : -phase
}

function paintLimb(
  ctx: CanvasRenderingContext2D,
  leg: { hip: Pt; knee: Pt; foot: Pt; side: number; outward: number },
  basis: Basis,
  accent: string,
): void {
  bone(ctx, leg.hip, leg.knee, 2.15, 1.65, MECH)
  joint(ctx, leg.knee, 1.85)
  bone(ctx, leg.knee, leg.foot, 1.55, 1.2, MECH_DARK)
  paintShield(ctx, leg.knee, leg.foot, basis, leg.outward, accent)
  paintClaw(ctx, leg.knee, leg.foot)
}

function bone(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, w0: number, w1: number, fill: string): void {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const px = -dy / len
  const py = dx / len
  ctx.beginPath()
  ctx.moveTo(a.x + px * w0, a.y + py * w0)
  ctx.lineTo(b.x + px * w1, b.y + py * w1)
  ctx.lineTo(b.x - px * w1, b.y - py * w1)
  ctx.lineTo(a.x - px * w0, a.y - py * w0)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(a.x - px * 0.35, a.y - py * 0.35)
  ctx.lineTo(b.x - px * 0.25, b.y - py * 0.25)
  ctx.strokeStyle = MECH_LIGHT
  ctx.lineWidth = 0.7
  ctx.stroke()
}

function joint(ctx: CanvasRenderingContext2D, p: Pt, radius: number): void {
  ctx.beginPath()
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
  ctx.fillStyle = JOINT
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(p.x - 0.35, p.y - 0.4, radius * 0.34, 0, Math.PI * 2)
  ctx.fillStyle = MECH_LIGHT
  ctx.fill()
}

function paintShield(
  ctx: CanvasRenderingContext2D,
  knee: Pt,
  foot: Pt,
  basis: Basis,
  outward: number,
  accent: string,
): void {
  const dx = foot.x - knee.x
  const dy = foot.y - knee.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const ox = basis.sx * outward
  const oy = basis.sy * outward
  const p = (t: number, out: number): Pt => ({
    x: knee.x + ux * len * t + ox * out,
    y: knee.y + uy * len * t + oy * out,
  })
  const plate = [p(0.12, 0.2), p(0.32, 2.7), p(0.58, 3.25), p(0.84, 2.15), p(0.98, 0.15), p(0.7, -0.35), p(0.34, -0.2)]
  trace(ctx, plate)
  ctx.fillStyle = HULL
  ctx.fill()
  ctx.strokeStyle = accent
  ctx.lineWidth = 1.15
  ctx.stroke()
  ctx.strokeStyle = INK
  ctx.lineWidth = 0.7
  ctx.stroke()
  const mark = p(0.56, 1.2)
  ctx.beginPath()
  ctx.moveTo(mark.x + ox * 0.85, mark.y + oy * 0.85)
  ctx.lineTo(mark.x - ux * 0.85 - ox * 0.15, mark.y - uy * 0.85 - oy * 0.15)
  ctx.lineTo(mark.x + ux * 0.85 - ox * 0.15, mark.y + uy * 0.85 - oy * 0.15)
  ctx.closePath()
  ctx.fillStyle = accent
  ctx.fill()
}

function paintClaw(ctx: CanvasRenderingContext2D, knee: Pt, foot: Pt): void {
  const dx = foot.x - knee.x
  const dy = foot.y - knee.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux
  const side = (along: number, across: number): Pt => ({
    x: foot.x + ux * along + px * across,
    y: foot.y + uy * along + py * across,
  })
  // One thick sickle, plus a shorter inner hook.
  for (const hook of [
    { reach: 3.5, curl: 2.6, width: 1.15 },
    { reach: 2.3, curl: -1.9, width: 0.8 },
  ]) {
    const belly = side(hook.reach * 0.55, hook.curl * 0.15)
    const tip = side(hook.reach * 0.2, hook.curl)
    ctx.beginPath()
    ctx.moveTo(side(0.2, hook.width * 0.2).x, side(0.2, hook.width * 0.2).y)
    ctx.quadraticCurveTo(belly.x, belly.y, tip.x, tip.y)
    ctx.quadraticCurveTo(
      side(hook.reach * 0.45, hook.curl * 0.35).x,
      side(hook.reach * 0.45, hook.curl * 0.35).y,
      side(0.15, -hook.width * 0.15).x,
      side(0.15, -hook.width * 0.15).y,
    )
    ctx.closePath()
    ctx.fillStyle = MECH_DARK
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.7
    ctx.stroke()
  }
  joint(ctx, foot, 1.35)
}

function paintHip(ctx: CanvasRenderingContext2D, hip: Pt): void {
  joint(ctx, hip, 2.15)
  ctx.beginPath()
  ctx.arc(hip.x, hip.y, 0.7, 0, Math.PI * 2)
  ctx.fillStyle = MECH_DARK
  ctx.fill()
}

function paintChassis(ctx: CanvasRenderingContext2D, at: (forward: number, side: number, lift?: number) => Pt, ang: number): void {
  ctx.beginPath()
  ctx.ellipse(0.2, 1.15, 9.5, 6.45, ang, 0, Math.PI * 2)
  ctx.fillStyle = MECH
  ctx.fill()
  const head = at(6.8, 0)
  ctx.beginPath()
  ctx.ellipse(head.x, head.y + 0.4, 4.6, 3.5, ang, 0, Math.PI * 2)
  ctx.fillStyle = MECH_DARK
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.stroke()
}

function paintSensor(ctx: CanvasRenderingContext2D, at: (forward: number, side: number, lift?: number) => Pt, ang: number): void {
  const c = at(9.6, 0)
  ctx.beginPath()
  ctx.ellipse(c.x, c.y, 3.5, 2.75, ang, 0, Math.PI * 2)
  ctx.fillStyle = '#1c2228'
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.stroke()
  const lenses = [
    { f: 10.7, s: 0, r: 1.2 },
    { f: 9.5, s: 1.45, r: 0.92 },
    { f: 9.5, s: -1.45, r: 0.92 },
    { f: 8.7, s: 0.55, r: 0.58 },
    { f: 8.7, s: -0.55, r: 0.58 },
  ]
  for (const lens of lenses) {
    const p = at(lens.f, lens.s)
    ctx.beginPath()
    ctx.arc(p.x, p.y, lens.r, 0, Math.PI * 2)
    ctx.fillStyle = '#10161c'
    ctx.fill()
    ctx.strokeStyle = '#6a727c'
    ctx.lineWidth = 0.6
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(p.x, p.y, lens.r * 0.58, 0, Math.PI * 2)
    ctx.fillStyle = '#9ed4ea'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(p.x - lens.r * 0.22, p.y - lens.r * 0.22, Math.max(0.25, lens.r * 0.2), 0, Math.PI * 2)
    ctx.fillStyle = '#f5fbff'
    ctx.fill()
  }
}

function paintHull(
  ctx: CanvasRenderingContext2D,
  at: (forward: number, side: number, lift?: number) => Pt,
  ang: number,
  accent: string,
): void {
  ctx.beginPath()
  ctx.ellipse(0, 0, 8.7, 5.5, ang, 0, Math.PI * 2)
  ctx.fillStyle = HULL
  ctx.fill()
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(0, 0, 8.7, 5.5, ang, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = 'rgba(74, 66, 52, 0.16)'
  ctx.beginPath()
  ctx.ellipse(1.4, 3.6, 9, 4.2, 0.15, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
  ctx.beginPath()
  ctx.ellipse(-3.1, -3.4, 4.8, 2.35, -0.55, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.rotate(ang)
  ctx.beginPath()
  ctx.moveTo(-6.3, 0)
  ctx.lineTo(-1.2, 0)
  ctx.moveTo(5.15, 0)
  ctx.lineTo(7.15, 0)
  ctx.strokeStyle = accent
  ctx.lineWidth = 1.35
  ctx.stroke()
  ctx.beginPath()
  ctx.rect(-0.2, -2.05, 5.15, 4.1)
  ctx.fillStyle = HULL_SHADE
  ctx.fill()
  ctx.strokeStyle = accent
  ctx.lineWidth = 0.95
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(2.3, -2.05)
  ctx.lineTo(2.3, 2.05)
  ctx.strokeStyle = '#b7b1a4'
  ctx.lineWidth = 0.65
  ctx.stroke()
  for (const side of [-1.7, 1.7]) {
    ctx.fillStyle = MECH
    ctx.fillRect(-6.15, side - 0.38, 1.9, 0.76)
  }
  ctx.restore()

  ctx.beginPath()
  ctx.ellipse(0, 0, 7.55, 4.45, ang, 0, Math.PI * 2)
  ctx.strokeStyle = accent
  ctx.lineWidth = 0.9
  ctx.stroke()
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(0, 0, 8.45, 5.25, ang, 0, Math.PI * 2)
  ctx.clip()
  const bandA = at(6.15, -5.2)
  const bandB = at(6.15, 5.2)
  ctx.beginPath()
  ctx.moveTo(bandA.x, bandA.y)
  ctx.lineTo(bandB.x, bandB.y)
  ctx.strokeStyle = accent
  ctx.lineWidth = 1.55
  ctx.stroke()
  ctx.restore()
  ctx.beginPath()
  ctx.ellipse(0, 0, 8.7, 5.5, ang, 0, Math.PI * 2)
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.25
  ctx.stroke()
}

function paintStack(
  ctx: CanvasRenderingContext2D,
  at: (forward: number, side: number, lift?: number) => Pt,
  side: number,
  accent: string,
): void {
  const base = at(-6.7, side)
  const top = base.y - 3.3
  const half = 1.4
  ctx.beginPath()
  ctx.moveTo(base.x - half, base.y)
  ctx.lineTo(base.x - half, top)
  ctx.lineTo(base.x + half, top)
  ctx.lineTo(base.x + half, base.y)
  ctx.closePath()
  ctx.fillStyle = MECH
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 0.9
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(base.x, top, half, 0.72, 0, 0, Math.PI * 2)
  ctx.fillStyle = HULL
  ctx.fill()
  ctx.strokeStyle = accent
  ctx.lineWidth = 0.85
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(base.x, base.y, half, 0.55, 0, 0, Math.PI * 2)
  ctx.fillStyle = MECH_DARK
  ctx.fill()
}

function paintPod(
  ctx: CanvasRenderingContext2D,
  at: (forward: number, side: number, lift?: number) => Pt,
  ang: number,
  side: number,
  recoil: number,
  accent: string,
  muzzles: Pt[],
): void {
  const podSide = side * 8.15
  const c = at(0.55, podSide)
  ctx.beginPath()
  ctx.ellipse(c.x, c.y, 3.55, 3.05, ang, 0, Math.PI * 2)
  ctx.fillStyle = HULL
  ctx.fill()
  ctx.strokeStyle = accent
  ctx.lineWidth = 1.2
  ctx.stroke()
  ctx.strokeStyle = INK
  ctx.lineWidth = 0.8
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(c.x, c.y, 1.55, 1.25, ang, 0, Math.PI * 2)
  ctx.fillStyle = MECH_DARK
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 0.7
  ctx.stroke()

  const yokeA = at(3.1 + recoil, podSide - 2.2)
  const yokeB = at(3.1 + recoil, podSide + 2.2)
  ctx.beginPath()
  ctx.moveTo(yokeA.x, yokeA.y)
  ctx.lineTo(yokeB.x, yokeB.y)
  ctx.strokeStyle = MECH_DARK
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.stroke()

  for (const bore of [-1.85, 1.85]) {
    const s = podSide + bore
    const a = at(3.1 + recoil, s)
    const b = at(16.8 + recoil, s)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y + 0.65)
    ctx.lineTo(b.x, b.y + 0.65)
    ctx.strokeStyle = '#14181c'
    ctx.lineWidth = 2.45
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = '#2c343c'
    ctx.lineWidth = 2.05
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(a.x - 0.35, a.y - 0.45)
    ctx.lineTo(b.x - 0.35, b.y - 0.45)
    ctx.strokeStyle = MECH_LIGHT
    ctx.lineWidth = 0.65
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(b.x, b.y, 1.2, 0, Math.PI * 2)
    ctx.fillStyle = '#161b20'
    ctx.fill()
    ctx.strokeStyle = MECH_LIGHT
    ctx.lineWidth = 0.7
    ctx.stroke()
    muzzles.push(b)
  }
}

function paintMuzzle(ctx: CanvasRenderingContext2D, tip: Pt, fx: number, fy: number): void {
  const ang = Math.atan2(fy, fx)
  const x = tip.x + fx * 2.1
  const y = tip.y + fy * 2.1
  ctx.beginPath()
  ctx.ellipse(x, y, 3.3, 1.65, ang, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 244, 214, 0.95)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x + fx * 1.7, y + fy * 1.7, 1.3, 0, Math.PI * 2)
  ctx.fillStyle = '#ff9d42'
  ctx.fill()
}

function trace(ctx: CanvasRenderingContext2D, points: Pt[]): void {
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
