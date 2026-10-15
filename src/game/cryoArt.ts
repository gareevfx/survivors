import { PLAYER_COLOR } from './types'

/**
 * Cryo is four glass cylinders in a 2×2 grid. An empty vessel is clear glass.
 * An occupied vessel shows a Stalker standing inside, covered in ice.
 * The drawing is cached. Team color is only the collar.
 */

const W = 64
const H = 64
const PAD_X = 10
const PAD_Y = 12

/** Centers and bases, back row then front row, so the front pair paints last. */
const VESSELS: ReadonlyArray<readonly [number, number]> = [
  [16, 28],
  [48, 28],
  [16, 58],
  [48, 58],
]

const RX = 12
const RY = 4.2
const TALL = 26

const bodies = new Map<string, HTMLCanvasElement>()
const portraits = new Map<number, string>()

export function cryoDamageStage(hp: number, full: number): number {
  const ratio = full > 0 ? hp / full : 1
  if (ratio > 0.75) return 0
  if (ratio > 0.5) return 1
  if (ratio > 0.25) return 2
  return 3
}

function cylinderPath(ctx: CanvasRenderingContext2D, cx: number, top: number, base: number): void {
  ctx.beginPath()
  ctx.moveTo(cx - RX, top)
  ctx.lineTo(cx - RX, base)
  ctx.ellipse(cx, base, RX, RY, 0, Math.PI, 0, true)
  ctx.lineTo(cx + RX, top)
  ctx.ellipse(cx, top, RX, RY, 0, 0, Math.PI, true)
  ctx.closePath()
}

/** A standing Stalker fitted inside the tube: gray suit, helmet, team stripe. */
function paintStalker(ctx: CanvasRenderingContext2D, cx: number, base: number, accent: string): void {
  const foot = base - 4
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineWidth = 0.7
  ctx.strokeStyle = '#161311'
  ctx.fillStyle = '#1c1c1c'
  ctx.fillRect(cx - 3.6, foot - 2.4, 2.6, 2.6)
  ctx.fillRect(cx + 1, foot - 2.4, 2.6, 2.6)

  ctx.fillStyle = '#6e7278'
  ctx.fillRect(cx - 3.1, foot - 8.2, 2.3, 6)
  ctx.fillRect(cx + 0.8, foot - 8.2, 2.3, 6)

  ctx.fillStyle = '#8d9096'
  ctx.beginPath()
  ctx.roundRect(cx - 4.4, foot - 15.2, 8.8, 7.4, 1.6)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = accent
  ctx.fillRect(cx - 4.4, foot - 14.4, 8.8, 1.7)
  ctx.fillStyle = '#6e7278'
  ctx.fillRect(cx - 6.2, foot - 14, 1.9, 5)
  ctx.fillRect(cx + 4.3, foot - 14, 1.9, 5)

  ctx.beginPath()
  ctx.arc(cx, foot - 18.2, 3.1, 0, Math.PI * 2)
  ctx.fillStyle = '#e2ba9a'
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#555b63'
  ctx.beginPath()
  ctx.ellipse(cx, foot - 19.4, 3.5, 2.1, 0, Math.PI, 0, false)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = accent
  ctx.fillRect(cx - 3, foot - 19.1, 6, 1)
  ctx.fillStyle = '#172028'
  ctx.beginPath()
  ctx.ellipse(cx, foot - 17.2, 2.2, 1, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** A thin frost over the figure, plus an ice crust. The suit and visor stay readable. */
function paintIce(ctx: CanvasRenderingContext2D, cx: number, top: number, base: number): void {
  ctx.save()
  cylinderPath(ctx, cx, top, base)
  ctx.clip()
  ctx.fillStyle = 'rgba(210, 242, 252, 0.28)'
  ctx.fillRect(cx - RX, top, RX * 2, base - top)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(cx - 5, top + 7)
  ctx.lineTo(cx - 2, base - 5)
  ctx.moveTo(cx + 4, top + 9)
  ctx.lineTo(cx + 1, base - 6)
  ctx.stroke()
  ctx.fillStyle = 'rgba(244, 252, 255, 0.92)'
  for (const ix of [cx - 4, cx, cx + 4]) {
    ctx.beginPath()
    ctx.moveTo(ix - 1.1, top + 1)
    ctx.lineTo(ix + 1.1, top + 1)
    ctx.lineTo(ix, top + 6)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

function paintVessel(
  ctx: CanvasRenderingContext2D,
  cx: number,
  base: number,
  occupied: boolean,
  color: string,
  cracks: boolean,
  broken: boolean,
): void {
  const top = base - TALL
  ctx.fillStyle = 'rgba(16, 18, 14, 0.28)'
  ctx.beginPath()
  ctx.ellipse(cx + 1.5, base + 3, RX + 1.5, RY + 0.4, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.save()
  cylinderPath(ctx, cx, top, base)
  const glass = ctx.createLinearGradient(cx - RX, 0, cx + RX, 0)
  glass.addColorStop(0, 'rgba(198, 228, 238, 0.42)')
  glass.addColorStop(0.2, 'rgba(255, 255, 255, 0.05)')
  glass.addColorStop(0.72, 'rgba(255, 255, 255, 0.04)')
  glass.addColorStop(1, 'rgba(110, 168, 186, 0.4)')
  ctx.fillStyle = glass
  ctx.fill()
  ctx.restore()

  if (occupied) {
    ctx.save()
    cylinderPath(ctx, cx, top, base)
    ctx.clip()
    paintStalker(ctx, cx, base, color)
    ctx.restore()
    paintIce(ctx, cx, top, base)
  }

  ctx.save()
  cylinderPath(ctx, cx, top, base)
  ctx.strokeStyle = broken ? 'rgba(90, 110, 118, 0.9)' : 'rgba(244, 252, 255, 0.95)'
  ctx.lineWidth = 1.35
  ctx.stroke()
  ctx.restore()

  ctx.beginPath()
  ctx.ellipse(cx, top, RX, RY, 0, 0, Math.PI * 2)
  ctx.fillStyle = occupied ? 'rgba(220, 244, 252, 0.22)' : 'rgba(210, 238, 246, 0.1)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
  ctx.lineWidth = 1.2
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(cx - 3, top - 0.4, 3.2, 1.1, -0.4, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
  ctx.fill()

  ctx.beginPath()
  ctx.ellipse(cx, base, RX, RY, 0, 0, Math.PI * 2)
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.stroke()

  if (cracks) {
    ctx.strokeStyle = 'rgba(36, 48, 54, 0.8)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx - 4, top + 6)
    ctx.lineTo(cx + 1, top + 12)
    ctx.lineTo(cx - 2, base - 4)
    ctx.stroke()
  }
  if (broken) {
    ctx.fillStyle = 'rgba(20, 24, 22, 0.45)'
    ctx.beginPath()
    ctx.ellipse(cx + 3, base - 8, 4, 3, 0.4, 0, Math.PI * 2)
    ctx.fill()
  }
}

function paintBody(ctx: CanvasRenderingContext2D, color: string, held: number, stage: number): void {
  VESSELS.forEach(([cx, base], index) => {
    paintVessel(ctx, cx, base, index < held, color, stage >= 1 && index % 2 === 0, stage >= 3 && index === 1)
  })
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
  ctx.translate(6, 4)
  ctx.scale(0.9, 0.9)
  drawCryoSprite(ctx, 0, 0, PLAYER_COLOR[owner] ?? '#5ec8ff', 2, 0)
  ctx.restore()
  const url = canvas.toDataURL()
  portraits.set(owner, url)
  return url
}
