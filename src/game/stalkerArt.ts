import { PLAYER_COLOR } from './types'
import type { Unit } from './types'

/**
 * Original Stalker art: a gray vault-style jumpsuit on a cargo scooter.
 * Sprites are cached. Team color is trim only. The suit stays gray.
 */

const SIZE = 52
const OX = 26
const OY = 30

const SUIT = '#8d9096'
const SUIT_SHADE = '#6e7278'
const INK = '#161311'
const METAL = '#3c434b'
const RUBBER = '#1a1a1a'

type SpriteKey = string

const sprites = new Map<SpriteKey, HTMLCanvasElement>()
const portraits = new Map<number, string>()

function accentOf(owner: number): string {
  return PLAYER_COLOR[owner] ?? PLAYER_COLOR[0] ?? '#5ec8ff'
}

/** Eight facings, clockwise from east, matching canvas atan2. */
export function facingDir(facing: number): number {
  const turn = Math.PI * 2
  const angle = ((facing % turn) + turn) % turn
  return Math.round(angle / (Math.PI / 4)) % 8
}

/** Ground axes for one snapped facing. +forward is the nose; +side is the rider's right. */
export function facingBasis(dir: number): { ang: number; fx: number; fy: number; sx: number; sy: number } {
  const ang = dir * (Math.PI / 4)
  const fx = Math.cos(ang)
  const fy = Math.sin(ang)
  return { ang, fx, fy, sx: -Math.sin(ang), sy: Math.cos(ang) }
}

export function stalkerSprite(unit: Unit): HTMLCanvasElement {
  const moving = unit.goalX != null
  const order = unit.order
  const working =
    order?.type === 'construct' ||
    order?.type === 'attack' ||
    (order?.type === 'gather' && order.phase === 'mine')
  const frame = moving || working ? Math.floor(unit.anim) % 2 : 0
  return stalkerFrame(unit.owner, facingDir(unit.facing), frame, working, unit.cargo > 0)
}

export function stalkerFrame(
  owner: number,
  dir: number,
  frame: number,
  working: boolean,
  cargo: boolean,
): HTMLCanvasElement {
  const key = `${owner}:${dir}:${frame}:${working ? 1 : 0}:${cargo ? 1 : 0}`
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
  paintStalker(ctx, dir, frame, working, cargo, accentOf(owner))
  sprites.set(key, canvas)
  return canvas
}

/** Bust used on the Silo train button and the selection panel. */
export function stalkerPortraitUrl(owner: number): string {
  if (typeof document === 'undefined') return ''
  const cached = portraits.get(owner)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 40
  canvas.height = 40
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.translate(20, 24)
  ctx.scale(1.28, 1.28)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  paintStalker(ctx, 1, 0, false, false, accentOf(owner))
  const url = canvas.toDataURL()
  portraits.set(owner, url)
  return url
}

function paintStalker(
  ctx: CanvasRenderingContext2D,
  dir: number,
  frame: number,
  working: boolean,
  cargo: boolean,
  accent: string,
): void {
  const { ang, fx, fy, sx, sy } = facingBasis(dir)
  const at = (forward: number, side: number) => ({
    x: fx * forward + sx * side,
    y: fy * forward + sy * side,
  })

  ctx.strokeStyle = INK
  ctx.lineWidth = 1.35

  const spin = frame ? Math.PI / 2 : 0.15
  for (const forward of [-8.5, 8.5]) {
    const wheel = at(forward, 0)
    ctx.beginPath()
    ctx.ellipse(wheel.x, wheel.y, 3.3, 3.3, 0, 0, Math.PI * 2)
    ctx.fillStyle = RUBBER
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(wheel.x, wheel.y, 1.25, 0, Math.PI * 2)
    ctx.fillStyle = '#9aa1a8'
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(wheel.x + Math.cos(spin) * 2.3, wheel.y + Math.sin(spin) * 2.3)
    ctx.lineTo(wheel.x - Math.cos(spin) * 2.3, wheel.y - Math.sin(spin) * 2.3)
    ctx.strokeStyle = '#5c656e'
    ctx.stroke()
    ctx.strokeStyle = INK
  }

  const tail = at(-6.5, 0)
  const nose = at(7, 0)
  ctx.beginPath()
  ctx.moveTo(tail.x + sx * 2.6, tail.y + sy * 2.6)
  ctx.lineTo(nose.x + sx * 2.2, nose.y + sy * 2.2)
  ctx.lineTo(nose.x - sx * 2.2, nose.y - sy * 2.2)
  ctx.lineTo(tail.x - sx * 2.6, tail.y - sy * 2.6)
  ctx.closePath()
  ctx.fillStyle = METAL
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(tail.x, tail.y)
  ctx.lineTo(nose.x, nose.y)
  ctx.strokeStyle = accent
  ctx.lineWidth = 1.15
  ctx.stroke()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.35

  const cell = at(-3.5, 2)
  roundBox(ctx, cell.x - 2.2, cell.y - 1.6, 4.4, 3.2, METAL)
  ctx.fillStyle = accent
  ctx.fillRect(cell.x - 1.2, cell.y - 0.7, 2.4, 1.4)

  const lamp = at(10.2, 0)
  ctx.beginPath()
  ctx.arc(lamp.x, lamp.y, 1.7, 0, Math.PI * 2)
  ctx.fillStyle = '#f4ecc4'
  ctx.fill()
  ctx.stroke()

  const gripL = at(5.2, -3.4)
  const gripR = at(5.2, 3.4)
  ctx.beginPath()
  ctx.moveTo(gripL.x, gripL.y)
  ctx.lineTo(gripR.x, gripR.y)
  ctx.strokeStyle = '#2a3036'
  ctx.lineWidth = 2.1
  ctx.stroke()
  ctx.strokeStyle = accent
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(gripL.x, gripL.y)
  ctx.lineTo(gripR.x, gripR.y)
  ctx.stroke()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.35

  if (cargo) {
    const bounce = frame ? -1.3 : 0
    const crate = at(-11, 0.4)
    roundBox(ctx, crate.x - 4.2, crate.y - 5.2 + bounce, 8.4, 7, '#6d6554')
    ctx.fillStyle = '#7ec8f0'
    ctx.beginPath()
    ctx.moveTo(crate.x, crate.y - 3.6 + bounce)
    ctx.lineTo(crate.x + 2.3, crate.y - 1.1 + bounce)
    ctx.lineTo(crate.x, crate.y + 0.8 + bounce)
    ctx.lineTo(crate.x - 2.3, crate.y - 1.1 + bounce)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  const hip = at(-0.5, 0)
  const facing = fy
  const bodyW = 4.1 + Math.abs(facing) * 1.5
  const bx = hip.x
  const by = hip.y - 5.5

  ctx.fillStyle = SUIT_SHADE
  ctx.beginPath()
  ctx.ellipse(bx + sx * 1.7, by + 3.6, 1.7, 2.3, ang, 0, Math.PI * 2)
  ctx.ellipse(bx - sx * 1.7, by + 3.6, 1.7, 2.3, ang, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  ctx.beginPath()
  ctx.ellipse(bx, by, bodyW, 3.7, 0, 0, Math.PI * 2)
  ctx.fillStyle = SUIT
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = 'rgba(30, 32, 36, 0.16)'
  ctx.beginPath()
  ctx.ellipse(bx + 1, by + 0.8, bodyW * 0.5, 1.8, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = accent
  ctx.fillRect(bx - bodyW * 0.7, by - 3.1, bodyW * 1.4, 2)
  ctx.fillRect(bx - bodyW - 0.2, by - 0.4, 2.1, 1.7)
  ctx.fillRect(bx + bodyW - 1.9, by - 0.4, 2.1, 1.7)

  if (facing > 0.2) {
    ctx.strokeStyle = '#3e4248'
    ctx.beginPath()
    ctx.moveTo(bx, by - 1.6)
    ctx.lineTo(bx, by + 2.4)
    ctx.stroke()
    ctx.fillStyle = accent
    ctx.fillRect(bx - 1.6, by - 0.2, 3.2, 2)
  } else if (facing < -0.2) {
    ctx.fillStyle = accent
    ctx.fillRect(bx - 2.3, by - 0.6, 4.6, 3)
  } else {
    ctx.strokeStyle = '#3e4248'
    ctx.beginPath()
    ctx.moveTo(bx + fx * 0.2, by - 1.5)
    ctx.lineTo(bx + fx * 0.2, by + 2.3)
    ctx.stroke()
  }
  ctx.strokeStyle = INK

  ctx.fillStyle = '#2c2c2c'
  ctx.fillRect(bx - bodyW * 0.72, by + 2.1, bodyW * 1.44, 1.5)
  ctx.fillStyle = accent
  ctx.fillRect(bx - 0.9, by + 2.1, 1.8, 1.5)

  const hx = bx + fx * 0.8
  const hy = by - 6.1
  ctx.beginPath()
  ctx.arc(hx, hy, 3.5, 0, Math.PI * 2)
  ctx.fillStyle = '#e2ba9a'
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#555b63'
  ctx.beginPath()
  ctx.ellipse(hx, hy - 1.3, 3.8, 2.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = accent
  ctx.fillRect(hx - 3.2, hy - 1.5, 6.4, 1.15)

  if (facing > -0.4) {
    ctx.fillStyle = '#172028'
    ctx.beginPath()
    ctx.ellipse(hx + fx * 1.4, hy + 0.45, 2.5, 1.25, ang * 0.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = accent
    ctx.globalAlpha = 0.75
    ctx.fillRect(hx + fx * 0.5, hy, 1.3, 0.8)
    ctx.globalAlpha = 1
  } else {
    ctx.fillStyle = '#3a332c'
    ctx.beginPath()
    ctx.arc(hx - fx * 0.5, hy, 1.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  const bootA = at(-1.5, -2.1)
  const bootB = at(-1.5, 2.1)
  ctx.fillStyle = '#222'
  for (const boot of [bootA, bootB]) {
    ctx.beginPath()
    ctx.ellipse(boot.x, boot.y + 0.6, 1.9, 1.15, ang, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  if (working) {
    const swing = frame ? 2.4 : -1.2
    const hand = at(3.5 + swing, 6.2)
    ctx.beginPath()
    ctx.moveTo(bx + sx * 3, by + 0.4)
    ctx.lineTo(hand.x, hand.y - 1)
    ctx.strokeStyle = SUIT
    ctx.lineWidth = 2.4
    ctx.stroke()
    ctx.strokeStyle = INK
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.strokeStyle = '#d5d8dc'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(hand.x, hand.y - 4.2)
    ctx.lineTo(hand.x, hand.y + 1.6)
    ctx.moveTo(hand.x - 2.2, hand.y - 3.2)
    ctx.lineTo(hand.x + 2.1, hand.y - 1.2)
    ctx.stroke()
    ctx.fillStyle = '#242424'
    ctx.beginPath()
    ctx.arc(hand.x, hand.y - 1, 1.35, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.2
    ctx.stroke()
    if (frame) {
      ctx.fillStyle = '#f6e7a8'
      ctx.fillRect(hand.x + 2.4, hand.y - 2.2, 1.6, 1.6)
      ctx.fillStyle = '#fffaf0'
      ctx.fillRect(hand.x + 3.6, hand.y - 3.4, 1.1, 1.1)
    }
    ctx.fillStyle = '#242424'
    ctx.beginPath()
    ctx.arc(gripL.x, gripL.y, 1.35, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = accent
    ctx.fillRect(gripL.x - 1, gripL.y - 2.3, 2, 1.1)
  } else {
    ctx.fillStyle = '#242424'
    for (const grip of [gripL, gripR]) {
      ctx.beginPath()
      ctx.arc(grip.x, grip.y, 1.45, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.fillStyle = accent
    ctx.fillRect(gripL.x - 1.1, gripL.y - 2.4, 2.2, 1.15)
    ctx.fillRect(gripR.x - 1.1, gripR.y - 2.4, 2.2, 1.15)
  }
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.35
}

function roundBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string): void {
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.stroke()
}
