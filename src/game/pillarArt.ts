import { PLAYER_COLOR } from './types'

/**
 * The Pillar is a compact concrete pylon on a 1×1 pad.
 * Player color is the shaft hoop and the emitter ring on top.
 * The ring pulses on its own. While the Pillar is refilling a friendly unit, a second ring breathes outward.
 */

const W = 32
const H = 32

export interface PillarLook {
  color: string
  /** 0 clean through 3 ruined. */
  stage: number
  time: number
  /** This Pillar is refilling a friendly unit's Power. */
  charging: boolean
  /** Cannon aim, canvas atan2. The emitter tick points this way. */
  aim: number
  flash: boolean
}

const bodies = new Map<string, HTMLCanvasElement>()
const portraits = new Map<number, string>()

export function pillarDamageStage(hp: number, full: number): number {
  const ratio = full > 0 ? hp / full : 1
  if (ratio > 0.75) return 0
  if (ratio > 0.5) return 1
  if (ratio > 0.25) return 2
  return 3
}

function rgba(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  if (!Number.isFinite(value)) return `rgba(94, 200, 255, ${alpha})`
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
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

function paintBody(ctx: CanvasRenderingContext2D, stage: number): void {
  const pad = ctx.createLinearGradient(3, 20, 29, 31)
  pad.addColorStop(0, '#f3efe6')
  pad.addColorStop(1, '#c9c0b2')
  ctx.fillStyle = pad
  roundPath(ctx, 3, 21, 26, 9, 4)
  ctx.fill()
  ctx.strokeStyle = '#8d8476'
  ctx.lineWidth = 1.2
  ctx.stroke()

  const shaft = ctx.createLinearGradient(9, 4, 23, 24)
  shaft.addColorStop(0, '#f7f4ee')
  shaft.addColorStop(0.5, '#e4ddd2')
  shaft.addColorStop(1, '#cfc6b6')
  ctx.fillStyle = shaft
  roundPath(ctx, 9, 4, 14, 20, 6)
  ctx.fill()
  ctx.strokeStyle = '#8d8476'
  ctx.lineWidth = 1.4
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255, 252, 246, 0.75)'
  ctx.lineWidth = 1
  roundPath(ctx, 10.5, 5.5, 11, 17, 5)
  ctx.stroke()

  const panel = ctx.createLinearGradient(11, 10, 21, 18)
  panel.addColorStop(0, '#fbf9f4')
  panel.addColorStop(1, '#ebe4d8')
  ctx.fillStyle = panel
  roundPath(ctx, 11.5, 10, 9, 8, 2)
  ctx.fill()
  ctx.strokeStyle = '#b7aea0'
  ctx.lineWidth = 0.8
  ctx.stroke()

  ctx.fillStyle = '#12161b'
  roundPath(ctx, 14.2, 12, 3.6, 4.2, 1.2)
  ctx.fill()
  ctx.fillStyle = 'rgba(214, 232, 240, 0.35)'
  ctx.fillRect(14.6, 12.4, 1, 1.6)

  if (stage >= 1) {
    ctx.strokeStyle = 'rgba(36, 28, 20, 0.75)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(12, 8)
    ctx.lineTo(16, 14)
    ctx.lineTo(13, 20)
    ctx.stroke()
  }
  if (stage >= 2) {
    ctx.fillStyle = 'rgba(28, 24, 20, 0.35)'
    ctx.beginPath()
    ctx.ellipse(18, 16, 3.2, 1.8, 0.3, 0, Math.PI * 2)
    ctx.fill()
  }
  if (stage >= 3) {
    ctx.fillStyle = 'rgba(20, 18, 16, 0.4)'
    ctx.beginPath()
    ctx.ellipse(14, 9, 3, 1.6, -0.2, 0, Math.PI * 2)
    ctx.fill()
  }
}

function bodySprite(stage: number): HTMLCanvasElement {
  const key = String(stage)
  const cached = bodies.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  paintBody(ctx, stage)
  bodies.set(key, canvas)
  return canvas
}

function paintHoop(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.strokeStyle = color
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(10, 18)
  ctx.quadraticCurveTo(16, 21, 22, 18)
  ctx.stroke()
}

function paintEmitter(ctx: CanvasRenderingContext2D, look: PillarLook): void {
  const cx = 16
  const cy = 7
  const pulse = 0.5 + 0.5 * Math.sin(look.time * 2.3)
  const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, 8)
  glow.addColorStop(0, rgba(look.color, 0.28 + pulse * 0.28))
  glow.addColorStop(1, rgba(look.color, 0))
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(cx, cy, 8, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = look.color
  ctx.globalAlpha = 0.55 + pulse * 0.45
  ctx.lineWidth = 1.5 + pulse * 0.7
  ctx.beginPath()
  ctx.arc(cx, cy, 5.2, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 0.22 + pulse * 0.2
  ctx.fillStyle = look.color
  ctx.beginPath()
  ctx.arc(cx, cy, 3.1, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  if (look.charging) {
    for (let i = 0; i < 2; i++) {
      const t = (look.time * 0.8 + i * 0.5) % 1
      ctx.strokeStyle = rgba(look.color, (1 - t) * 0.5)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(cx, cy, 6 + t * 8, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(look.aim)
  ctx.fillStyle = look.color
  ctx.globalAlpha = 0.9
  ctx.fillRect(4.2, -0.9, look.flash ? 6.5 : 3.2, 1.8)
  ctx.globalAlpha = 1
  if (look.flash) {
    const burst = ctx.createRadialGradient(10, 0, 0, 10, 0, 6)
    burst.addColorStop(0, 'rgba(255, 250, 230, 0.95)')
    burst.addColorStop(0.45, rgba(look.color, 0.65))
    burst.addColorStop(1, rgba(look.color, 0))
    ctx.fillStyle = burst
    ctx.beginPath()
    ctx.arc(10, 0, 6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawPillarSprite(ctx: CanvasRenderingContext2D, x: number, y: number, look: PillarLook): void {
  ctx.drawImage(bodySprite(look.stage), x, y)
  ctx.save()
  ctx.translate(x, y)
  paintHoop(ctx, look.color)
  paintEmitter(ctx, look)
  ctx.restore()
}

/** Selection portrait and build-menu icon. Empty when there is no document, so smoke can call it. */
export function pillarPortraitUrl(owner: number): string {
  if (typeof document === 'undefined') return ''
  const cachedUrl = portraits.get(owner)
  if (cachedUrl) return cachedUrl
  const canvas = document.createElement('canvas')
  canvas.width = 72
  canvas.height = 72
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#6d6248'
  ctx.fillRect(0, 0, 72, 72)
  ctx.save()
  ctx.translate(16, 16)
  ctx.scale(1.25, 1.25)
  drawPillarSprite(ctx, 0, 0, {
    color: PLAYER_COLOR[owner] ?? '#5ec8ff',
    stage: 0,
    time: 0.8,
    charging: false,
    aim: -Math.PI / 2,
    flash: false,
  })
  ctx.restore()
  const url = canvas.toDataURL()
  portraits.set(owner, url)
  return url
}
