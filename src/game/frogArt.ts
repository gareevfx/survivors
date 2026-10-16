import { PLAYER_COLOR, type Unit } from './types'

/**
 * Original Frog art: a white buggy with a glass cryo tank on the back.
 * The body stays white. Team color is the trim, hubs, and tank collar.
 */

const SIZE = 72
const OX = 36
const OY = 40

const INK = '#14110e'
const WHITE = '#f7f4ee'
const SHADE = '#d9d3c8'
const RUBBER = '#1a1c1f'
const GLASS = 'rgba(214, 236, 244, 0.55)'
const ICE = '#b7e4f2'

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
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}

/** Eight facings, clockwise from east, matching canvas atan2. */
function facingDir(facing: number): number {
  const turn = Math.PI * 2
  const angle = ((facing % turn) + turn) % turn
  return Math.round(angle / (Math.PI / 4)) % 8
}

export function frogSprite(unit: Unit): HTMLCanvasElement {
  const moving = unit.goalX != null
  const frame = moving ? Math.floor(unit.anim) % 2 : 0
  return frogFrame(unit.owner, facingDir(unit.facing), frame)
}

export function frogFrame(owner: number, dir: number, frame: number): HTMLCanvasElement {
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
  paintFrog(ctx, dir, frame, teamColor(owner))
  sprites.set(key, canvas)
  return canvas
}

/** Bust used on the Factory train button and the selection panel. */
export function frogPortraitUrl(owner: number): string {
  if (typeof document === 'undefined') return ''
  const cached = portraits.get(owner)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 40
  canvas.height = 40
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.translate(20, 24)
  ctx.scale(0.72, 0.72)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  paintFrog(ctx, 1, 0, teamColor(owner))
  const url = canvas.toDataURL()
  portraits.set(owner, url)
  return url
}

function paintFrog(ctx: CanvasRenderingContext2D, dir: number, frame: number, color: string): void {
  const ang = dir * (Math.PI / 4)
  const fx = Math.cos(ang)
  const fy = Math.sin(ang)
  const sx = -Math.sin(ang)
  const sy = Math.cos(ang)
  const roll = frame ? 1.1 : 0
  const at = (forward: number, side: number) => ({
    x: fx * forward + sx * side,
    y: fy * forward * 0.62 + sy * side * 0.62 - forward * 0.08 + roll,
  })

  ctx.strokeStyle = INK
  ctx.lineWidth = 1.25

  const wheels: Array<[number, number]> = [
    [9, -8],
    [9, 8],
    [-10, -8],
    [-10, 8],
  ]
  for (const [forward, side] of wheels) {
    const wheel = at(forward, side)
    ctx.fillStyle = RUBBER
    ctx.beginPath()
    ctx.ellipse(wheel.x, wheel.y, 4.2, 4.2, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(wheel.x, wheel.y, 1.7, 0, Math.PI * 2)
    ctx.fill()
  }

  const nose = at(14, 0)
  const tail = at(-14, 0)
  const left = at(0, -8)
  const right = at(0, 8)
  ctx.fillStyle = WHITE
  ctx.beginPath()
  ctx.moveTo(nose.x, nose.y)
  ctx.lineTo(right.x + (nose.x - right.x) * 0.15, right.y + (nose.y - right.y) * 0.15)
  ctx.lineTo(tail.x + (right.x - tail.x) * 0.2, tail.y + (right.y - tail.y) * 0.2)
  ctx.lineTo(tail.x + (left.x - tail.x) * 0.2, tail.y + (left.y - tail.y) * 0.2)
  ctx.lineTo(left.x + (nose.x - left.x) * 0.15, left.y + (nose.y - left.y) * 0.15)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  const stripeA = at(6, -3.2)
  const stripeB = at(-6, -3.2)
  ctx.strokeStyle = color
  ctx.lineWidth = 2.2
  ctx.beginPath()
  ctx.moveTo(stripeA.x, stripeA.y)
  ctx.lineTo(stripeB.x, stripeB.y)
  ctx.stroke()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.25

  const seat = at(1, 0)
  ctx.fillStyle = SHADE
  ctx.beginPath()
  ctx.ellipse(seat.x, seat.y - 2, 5.5, 3.4, ang, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  const tank = at(-8, 0)
  ctx.save()
  ctx.translate(tank.x, tank.y - 7)
  ctx.rotate(ang * 0.15)
  ctx.fillStyle = shade(color, -30)
  ctx.fillRect(-4.2, -1, 8.4, 3.2)
  ctx.strokeRect(-4.2, -1, 8.4, 3.2)
  const glass = ctx.createLinearGradient(-5, 0, 5, 0)
  glass.addColorStop(0, 'rgba(150, 196, 210, 0.85)')
  glass.addColorStop(0.35, GLASS)
  glass.addColorStop(1, 'rgba(90, 150, 170, 0.7)')
  ctx.fillStyle = glass
  ctx.beginPath()
  ctx.moveTo(-4.5, -1)
  ctx.lineTo(-3.2, -12)
  ctx.lineTo(3.2, -12)
  ctx.lineTo(4.5, -1)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = ICE
  ctx.globalAlpha = 0.85
  ctx.fillRect(-2.4, -8, 4.8, 6)
  ctx.globalAlpha = 1
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.fillRect(-2.6, -11.2, 1.3, 8)
  ctx.fillStyle = color
  ctx.fillRect(-3.4, -12.6, 6.8, 2.2)
  ctx.strokeRect(-3.4, -12.6, 6.8, 2.2)
  ctx.restore()

  const lamp = at(13, 0)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(lamp.x, lamp.y - 1, 1.8, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}
