import { PLAYER_COLOR } from './types'

/**
 * The Pillar is a one-cell mast with a wind turbine and an observation cab.
 * The mast and cab are cached. The blades and the cannon are drawn live.
 */

const W = 32
const H = 32
const PAD_X = 18
const PAD_Y = 20

const HUB_X = 16
const HUB_Y = 14
const CAB_X = 16
const CAB_Y = 2

const masts = new Map<string, HTMLCanvasElement>()
const cabs = new Map<string, HTMLCanvasElement>()
const portraits = new Map<number, string>()

export function pillarDamageStage(hp: number, full: number): number {
  const ratio = full > 0 ? hp / full : 1
  if (ratio > 0.75) return 0
  if (ratio > 0.5) return 1
  if (ratio > 0.25) return 2
  return 3
}

function paintMast(ctx: CanvasRenderingContext2D, color: string, stage: number): void {
  ctx.fillStyle = 'rgba(16, 12, 8, 0.32)'
  ctx.beginPath()
  ctx.ellipse(17, 30, 14, 4.2, 0, 0, Math.PI * 2)
  ctx.fill()

  const pad = ctx.createLinearGradient(2, 22, 30, 32)
  pad.addColorStop(0, '#ddd6c8')
  pad.addColorStop(1, '#8d887c')
  ctx.fillStyle = pad
  ctx.beginPath()
  ctx.ellipse(16, 27, 13, 5, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = 'rgba(90, 84, 74, 0.45)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(6, 26)
  ctx.lineTo(2, 18)
  ctx.moveTo(26, 26)
  ctx.lineTo(30, 18)
  ctx.stroke()

  const steel = ctx.createLinearGradient(8, 8, 24, 26)
  steel.addColorStop(0, '#d7dbe0')
  steel.addColorStop(0.5, '#8e959c')
  steel.addColorStop(1, '#4c535a')
  ctx.strokeStyle = steel
  ctx.lineWidth = 2.4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(9, 25)
  ctx.lineTo(14, 6)
  ctx.moveTo(23, 25)
  ctx.lineTo(18, 6)
  ctx.stroke()

  ctx.strokeStyle = '#5c646c'
  ctx.lineWidth = 1
  for (const y of [11, 16, 21]) {
    const t = (y - 6) / 20
    const left = 14 + (9 - 14) * t
    const right = 18 + (23 - 18) * t
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
    ctx.stroke()
  }

  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(13, 6)
  ctx.lineTo(19, 6)
  ctx.stroke()

  if (stage >= 1) {
    ctx.strokeStyle = 'rgba(36, 30, 26, 0.7)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(12, 10)
    ctx.lineTo(17, 18)
    ctx.lineTo(14, 24)
    ctx.stroke()
  }
  if (stage >= 2) {
    ctx.fillStyle = 'rgba(28, 24, 20, 0.4)'
    ctx.beginPath()
    ctx.ellipse(18, 20, 4, 2.2, 0.4, 0, Math.PI * 2)
    ctx.fill()
  }
  if (stage >= 3) {
    ctx.fillStyle = 'rgba(20, 18, 16, 0.45)'
    ctx.beginPath()
    ctx.ellipse(13, 14, 3.5, 2, -0.3, 0, Math.PI * 2)
    ctx.fill()
  }
}

function paintCab(ctx: CanvasRenderingContext2D, color: string, stage: number): void {
  const shell = ctx.createLinearGradient(8, -2, 24, 8)
  shell.addColorStop(0, '#f2f4f6')
  shell.addColorStop(0.55, '#b7bdc4')
  shell.addColorStop(1, '#5e666e')
  ctx.fillStyle = shell
  ctx.beginPath()
  ctx.ellipse(CAB_X, CAB_Y, 8.2, 5.4, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#1a2128'
  for (const wx of [12.2, 16, 19.8]) {
    ctx.beginPath()
    ctx.ellipse(wx, CAB_Y + 0.3, 1.35, 1.05, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = 'rgba(180, 220, 235, 0.35)'
  ctx.beginPath()
  ctx.ellipse(12.6, CAB_Y, 0.45, 0.35, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.ellipse(CAB_X, CAB_Y, 8.2, 5.4, 0, 0, Math.PI * 2)
  ctx.stroke()

  if (stage >= 2) {
    ctx.strokeStyle = 'rgba(36, 30, 26, 0.75)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(12, 0)
    ctx.lineTo(18, 4)
    ctx.stroke()
  }
  if (stage >= 3) {
    ctx.fillStyle = 'rgba(20, 18, 16, 0.4)'
    ctx.beginPath()
    ctx.ellipse(19, 3, 3, 1.6, 0.2, 0, Math.PI * 2)
    ctx.fill()
  }
}

function cached(store: Map<string, HTMLCanvasElement>, color: string, stage: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const key = `${color}:${stage}`
  const found = store.get(key)
  if (found) return found
  const canvas = document.createElement('canvas')
  canvas.width = W + PAD_X * 2
  canvas.height = H + PAD_Y * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.translate(PAD_X, PAD_Y)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  paint(ctx)
  store.set(key, canvas)
  return canvas
}

function paintBlades(ctx: CanvasRenderingContext2D, spin: number, color: string): void {
  ctx.save()
  ctx.translate(HUB_X, HUB_Y)
  ctx.scale(1, 0.86)
  for (let i = 0; i < 3; i++) {
    ctx.save()
    ctx.rotate(spin + (i * Math.PI * 2) / 3)
    const blade = ctx.createLinearGradient(0, 0, 16, 0)
    blade.addColorStop(0, '#f4f6f8')
    blade.addColorStop(1, '#8b939b')
    ctx.fillStyle = blade
    ctx.beginPath()
    ctx.moveTo(1.2, 0)
    ctx.quadraticCurveTo(8, -2.4, 16, -0.7)
    ctx.quadraticCurveTo(8, 1.6, 1.2, 0)
    ctx.fill()
    ctx.strokeStyle = 'rgba(40, 46, 52, 0.45)'
    ctx.lineWidth = 0.6
    ctx.stroke()
    ctx.restore()
  }
  ctx.fillStyle = '#3a4148'
  ctx.beginPath()
  ctx.arc(0, 0, 2.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(0, 0, 1.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function paintCannon(ctx: CanvasRenderingContext2D, aim: number, color: string, flash: boolean): void {
  ctx.save()
  ctx.translate(CAB_X, CAB_Y)
  ctx.rotate(aim)
  ctx.fillStyle = '#2e343a'
  ctx.fillRect(4.2, -1.5, 10.5, 3)
  ctx.fillStyle = '#6a7178'
  ctx.fillRect(4.2, -1.5, 10.5, 0.8)
  ctx.fillStyle = color
  ctx.fillRect(6, -0.45, 3.2, 0.9)
  if (flash) {
    const glow = ctx.createRadialGradient(15.2, 0, 0, 15.2, 0, 7)
    glow.addColorStop(0, 'rgba(255, 246, 214, 0.95)')
    glow.addColorStop(0.45, 'rgba(255, 176, 64, 0.7)')
    glow.addColorStop(1, 'rgba(255, 120, 40, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(15.2, 0, 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#ffe7a8'
    ctx.lineWidth = 1
    for (let i = 0; i < 3; i++) {
      const a = -0.5 + i * 0.5
      ctx.beginPath()
      ctx.moveTo(14.5, 0)
      ctx.lineTo(14.5 + Math.cos(a) * 6, Math.sin(a) * 3.2)
      ctx.stroke()
    }
  }
  ctx.restore()
}

export interface PillarLook {
  color: string
  stage: number
  /** Blade angle in radians. */
  spin: number
  /** Cannon aim, canvas atan2. */
  aim: number
  flash: boolean
}

export function drawPillarSprite(ctx: CanvasRenderingContext2D, x: number, y: number, look: PillarLook): void {
  const mast = cached(masts, look.color, look.stage, (pen) => paintMast(pen, look.color, look.stage))
  const cab = cached(cabs, look.color, look.stage, (pen) => paintCab(pen, look.color, look.stage))
  ctx.drawImage(mast, x - PAD_X, y - PAD_Y)
  ctx.save()
  ctx.translate(x, y)
  paintBlades(ctx, look.spin, look.color)
  ctx.restore()
  ctx.drawImage(cab, x - PAD_X, y - PAD_Y)
  ctx.save()
  ctx.translate(x, y)
  paintCannon(ctx, look.aim, look.color, look.flash)
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
  ctx.translate(14, 16)
  ctx.scale(1.35, 1.35)
  drawPillarSprite(ctx, 0, 0, {
    color: PLAYER_COLOR[owner] ?? '#5ec8ff',
    stage: 0,
    spin: 0.5,
    aim: 0.3,
    flash: false,
  })
  ctx.restore()
  const url = canvas.toDataURL()
  portraits.set(owner, url)
  return url
}
