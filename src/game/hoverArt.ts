import { facingBasis, facingDir } from './stalkerArt'
import { PLAYER_COLOR, type Unit } from './types'

/**
 * Original Hover art: a flying two-blade drone.
 * The body is off-white. Team color is the secondary trim. The body is cached.
 * Rotors are drawn each frame so the blur can spin without new sprites.
 */

const SIZE = 56
const OX = 28
const OY = 30

const INK = '#3a3f46'
const WHITE = '#f4f1e8'
const SHADE = '#d5d1c6'
const MOTOR = '#2a2e32'
const LENS = '#1c2128'

const sprites = new Map<string, HTMLCanvasElement>()
const portraits = new Map<number, string>()

function teamColor(owner: number): string {
  return PLAYER_COLOR[owner] ?? PLAYER_COLOR[0] ?? '#5ec8ff'
}

export function hoverSprite(unit: Unit, sway: number): HTMLCanvasElement {
  return hoverFrame(unit.owner, facingDir(unit.facing), sway)
}

export function hoverFrame(owner: number, dir: number, sway: number): HTMLCanvasElement {
  const frame = sway ? 1 : 0
  const key = `${owner}:${dir}:${frame}`
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
  paintHover(ctx, dir, frame, teamColor(owner))
  sprites.set(key, canvas)
  return canvas
}

/** Radians per second. Matches an idle Silo roof dish. */
export const FLY_RADAR_SPIN = 0.42

/**
 * Small roof-style dish drawn live while Guard is on.
 * The body sprite stays cached; only this part turns.
 */
export function paintHoverDish(ctx: CanvasRenderingContext2D, angle: number, accent: string): void {
  ctx.save()
  ctx.rotate(angle)
  ctx.fillStyle = '#4e4a44'
  ctx.beginPath()
  ctx.arc(0, 0, 1.35, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#3a3632'
  ctx.lineWidth = 1.15
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(5.4, 0)
  ctx.stroke()
  const bowl = ctx.createLinearGradient(2, -3, 12, 3)
  bowl.addColorStop(0, '#f7f4ee')
  bowl.addColorStop(0.45, '#d5d8de')
  bowl.addColorStop(1, '#5a6068')
  ctx.fillStyle = bowl
  ctx.beginPath()
  ctx.ellipse(7.4, 0, 3.6, 1.55, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = accent
  ctx.lineWidth = 0.75
  ctx.stroke()
  ctx.restore()
}

/** Cheap spinning discs. Not cached, so the blades can turn every frame. */
export function paintHoverRotors(ctx: CanvasRenderingContext2D, dir: number, spin: number, accent: string): void {
  const { fx, fy, sx, sy } = facingBasis(dir)
  const at = (forward: number, side: number) => ({
    x: fx * forward + sx * side,
    y: fy * forward + sy * side,
  })
  for (const side of [-1, 1]) {
    const hub = at(0.1, side * 6.15)
    ctx.beginPath()
    ctx.arc(hub.x, hub.y, 5.05, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(72, 78, 84, 0.34)'
    ctx.fill()
    const angle = spin * side
    ctx.lineCap = 'round'
    for (const ghost of [0.55, 0]) {
      const a = angle - ghost * 0.7 * side
      ctx.beginPath()
      ctx.moveTo(hub.x + Math.cos(a) * 4.7, hub.y + Math.sin(a) * 4.7)
      ctx.lineTo(hub.x - Math.cos(a) * 4.7, hub.y - Math.sin(a) * 4.7)
      ctx.strokeStyle = ghost ? 'rgba(58, 64, 70, 0.28)' : 'rgba(48, 54, 60, 0.62)'
      ctx.lineWidth = ghost ? 2.4 : 1.7
      ctx.stroke()
    }
    ctx.globalAlpha = 0.85
    ctx.fillStyle = accent
    for (const end of [1, -1]) {
      ctx.beginPath()
      ctx.arc(hub.x + Math.cos(angle) * 4.35 * end, hub.y + Math.sin(angle) * 4.35 * end, 0.85, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
}

export function hoverCameraPoint(dir: number): { x: number; y: number } {
  const { fx, fy } = facingBasis(dir)
  return { x: fx * 5.7, y: fy * 5.7 + 1.15 }
}

/** Bust used on the Factory train button and the selection panel. */
export function hoverPortraitUrl(owner: number): string {
  if (typeof document === 'undefined') return ''
  const cached = portraits.get(owner)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 40
  canvas.height = 40
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const accent = teamColor(owner)
  ctx.translate(20, 22)
  ctx.scale(0.95, 0.95)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  paintHover(ctx, 1, 0, accent)
  paintHoverRotors(ctx, 1, 0.7, accent)
  const url = canvas.toDataURL()
  portraits.set(owner, url)
  return url
}

function paintHover(ctx: CanvasRenderingContext2D, dir: number, frame: number, accent: string): void {
  const { ang, fx, fy, sx, sy } = facingBasis(dir)
  const at = (forward: number, side: number) => ({
    x: fx * forward + sx * side,
    y: fy * forward + sy * side,
  })

  ctx.strokeStyle = INK
  ctx.lineWidth = 1.35
  ctx.lineCap = 'round'

  if (fy > 0) paintAntenna(ctx, at, frame, accent)

  for (const side of [-1, 1]) {
    const root = at(0, side * 2.4)
    const hub = at(0.1, side * 6.15)
    ctx.beginPath()
    ctx.moveTo(root.x, root.y)
    ctx.lineTo(hub.x, hub.y)
    ctx.strokeStyle = '#4a5056'
    ctx.lineWidth = 2.3
    ctx.stroke()
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.8
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(hub.x, hub.y, 1.85, 0, Math.PI * 2)
    ctx.fillStyle = MOTOR
    ctx.fill()
    ctx.lineWidth = 1.15
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(hub.x, hub.y, 0.8, 0, Math.PI * 2)
    ctx.fillStyle = accent
    ctx.fill()
  }

  ctx.beginPath()
  ctx.ellipse(0, 0, 6.35, 4.05, ang, 0, Math.PI * 2)
  ctx.fillStyle = WHITE
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.45
  ctx.stroke()

  ctx.beginPath()
  ctx.ellipse(sx * 0.35, sy * 0.35 + 0.55, 3.5, 1.85, ang, 0, Math.PI * 2)
  ctx.fillStyle = SHADE
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(at(-3.6, 0).x, at(-3.6, 0).y)
  ctx.lineTo(at(3.8, 0).x, at(3.8, 0).y)
  ctx.strokeStyle = '#5c6168'
  ctx.lineWidth = 0.85
  ctx.stroke()

  ctx.beginPath()
  ctx.ellipse(0, 0, 1.2, 3.35, ang, 0, Math.PI * 2)
  ctx.strokeStyle = accent
  ctx.lineWidth = 1.85
  ctx.stroke()
  ctx.strokeStyle = INK
  ctx.lineWidth = 0.65
  ctx.stroke()

  for (const side of [-2.55, 2.55]) {
    ctx.beginPath()
    ctx.moveTo(at(-2.1, side).x, at(-2.1, side).y)
    ctx.lineTo(at(2.3, side).x, at(2.3, side).y)
    ctx.strokeStyle = accent
    ctx.lineWidth = 1.35
    ctx.stroke()
  }

  const cam = at(5.7, 0)
  cam.y += 1.15
  ctx.beginPath()
  ctx.ellipse(cam.x, cam.y, 1.85, 1.55, 0, 0, Math.PI * 2)
  ctx.fillStyle = '#3a4046'
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.05
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cam.x, cam.y, 1.05, 0, Math.PI * 2)
  ctx.fillStyle = LENS
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cam.x - 0.35, cam.y - 0.4, 0.42, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.fill()

  if (fy <= 0) paintAntenna(ctx, at, frame, accent)
}

function paintAntenna(
  ctx: CanvasRenderingContext2D,
  at: (forward: number, side: number) => { x: number; y: number },
  frame: number,
  accent: string,
): void {
  const sway = frame ? 1.5 : 0
  const base = at(-5.2, 0.3)
  const mid = at(-7.4, sway * 0.45)
  const tip = at(-9.6, sway)
  mid.y -= 2.2
  tip.y -= 4.4
  ctx.beginPath()
  ctx.moveTo(base.x, base.y)
  ctx.quadraticCurveTo(mid.x, mid.y, tip.x, tip.y)
  ctx.strokeStyle = '#2a2e34'
  ctx.lineWidth = 1.15
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(tip.x, tip.y, 1.05, 0, Math.PI * 2)
  ctx.fillStyle = accent
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 0.9
  ctx.stroke()
}
