import { PLAYER_COLOR } from './types'

/**
 * Cryo is a low ice vault, two cells square. The body is cached. Four pods
 * in the roof light up as Stalkers freeze inside.
 */

const W = 64
const H = 64
const PAD_X = 14
const PAD_Y = 16

const bodies = new Map<string, HTMLCanvasElement>()
const portraits = new Map<number, string>()

export function cryoDamageStage(hp: number, full: number): number {
  const ratio = full > 0 ? hp / full : 1
  if (ratio > 0.75) return 0
  if (ratio > 0.5) return 1
  if (ratio > 0.25) return 2
  return 3
}

function paintBody(ctx: CanvasRenderingContext2D, color: string, held: number, stage: number): void {
  ctx.fillStyle = 'rgba(12, 18, 22, 0.35)'
  ctx.beginPath()
  ctx.ellipse(34, 58, 28, 7, 0, 0, Math.PI * 2)
  ctx.fill()

  const pad = ctx.createLinearGradient(4, 46, 60, 64)
  pad.addColorStop(0, '#d5e4ea')
  pad.addColorStop(1, '#7f949c')
  ctx.fillStyle = pad
  ctx.beginPath()
  ctx.roundRect(4, 46, 56, 14, 4)
  ctx.fill()

  const shell = ctx.createLinearGradient(8, 14, 56, 52)
  shell.addColorStop(0, '#f4fbff')
  shell.addColorStop(0.45, '#b9dbe6')
  shell.addColorStop(1, '#6f8f9c')
  ctx.fillStyle = shell
  ctx.strokeStyle = '#2c4650'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(32, 8)
  ctx.lineTo(58, 22)
  ctx.lineTo(58, 46)
  ctx.lineTo(32, 58)
  ctx.lineTo(6, 46)
  ctx.lineTo(6, 22)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = color
  ctx.fillRect(6, 30, 52, 4)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
  ctx.beginPath()
  ctx.moveTo(32, 10)
  ctx.lineTo(54, 22)
  ctx.lineTo(32, 28)
  ctx.lineTo(10, 22)
  ctx.closePath()
  ctx.fill()

  const pods: Array<[number, number]> = [
    [20, 24],
    [44, 24],
    [20, 40],
    [44, 40],
  ]
  pods.forEach(([px, py], index) => {
    const lit = index < held
    ctx.fillStyle = lit ? '#dff8ff' : '#1c3038'
    ctx.strokeStyle = lit ? '#7ee0ff' : '#3d5a66'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.ellipse(px, py, 6.5, 4.2, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    if (lit) {
      ctx.fillStyle = 'rgba(180, 240, 255, 0.85)'
      ctx.beginPath()
      ctx.ellipse(px - 1.5, py - 1, 2, 1.2, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  })

  if (stage >= 1) {
    ctx.strokeStyle = 'rgba(40, 24, 18, 0.55)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(18, 18)
    ctx.lineTo(28, 36)
    ctx.lineTo(22, 50)
    ctx.stroke()
  }
  if (stage >= 2) {
    ctx.beginPath()
    ctx.moveTo(46, 16)
    ctx.lineTo(40, 34)
    ctx.lineTo(50, 48)
    ctx.stroke()
  }
  if (stage >= 3) {
    ctx.fillStyle = 'rgba(20, 18, 16, 0.4)'
    ctx.beginPath()
    ctx.ellipse(24, 44, 7, 3, -0.2, 0, Math.PI * 2)
    ctx.ellipse(42, 30, 5, 2.2, 0.4, 0, Math.PI * 2)
    ctx.fill()
  }
}

function bodySprite(color: string, held: number, stage: number): HTMLCanvasElement {
  const key = `${color}:${held}:${stage}`
  const cached = bodies.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = W + PAD_X * 2
  canvas.height = H + PAD_Y * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.translate(PAD_X, PAD_Y)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  paintBody(ctx, color, held, stage)
  bodies.set(key, canvas)
  return canvas
}

export function drawCryoSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  held: number,
  stage: number,
): void {
  const pods = Math.max(0, Math.min(4, Math.floor(held)))
  ctx.drawImage(bodySprite(color, pods, stage), x - PAD_X, y - PAD_Y)
}

/** Selection portrait. Empty when there is no document, so smoke can call it. */
export function cryoPortraitUrl(owner: number): string {
  if (typeof document === 'undefined') return ''
  const cached = portraits.get(owner)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 72
  canvas.height = 72
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#3d5560'
  ctx.fillRect(0, 0, 72, 72)
  ctx.save()
  ctx.translate(8, 6)
  ctx.scale(0.82, 0.82)
  drawCryoSprite(ctx, 0, 0, PLAYER_COLOR[owner] ?? '#5ec8ff', 2, 0)
  ctx.restore()
  const url = canvas.toDataURL()
  portraits.set(owner, url)
  return url
}
