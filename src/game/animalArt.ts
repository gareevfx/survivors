import type { Animal } from './types'

/**
 * Original top-down crows. Sprites are cached and drawn in the same ink-outline
 * style as the rest of the Surface. The sprite faces east; the renderer rotates
 * it onto the heading.
 */

const cache = new Map<number, HTMLCanvasElement>()

export function drawAnimal(ctx: CanvasRenderingContext2D, animal: Animal): void {
  const frames = 3
  let frame = Math.floor(animal.phase) % frames
  if (frame < 0) frame += frames
  const sprite = crowSprite(frame)
  ctx.save()
  ctx.translate(animal.x, animal.y)
  ctx.fillStyle = 'rgba(16, 12, 8, 0.2)'
  ctx.beginPath()
  ctx.ellipse(1, 12, 6, 3.4, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.rotate(animal.facing)
  ctx.translate(0, -11)
  ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2)
  ctx.restore()
}

function crowSprite(frame: number): HTMLCanvasElement {
  const cached = cache.get(frame)
  if (cached) return cached
  const size = 36
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.translate(size / 2, size / 2)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  paintCrow(ctx, frame)
  cache.set(frame, canvas)
  return canvas
}

function paintCrow(ctx: CanvasRenderingContext2D, frame: number): void {
  wings(ctx, frame, 13, '#1c1c1c')
  ctx.fillStyle = '#141414'
  ctx.strokeStyle = '#0c0c0c'
  ctx.lineWidth = 1.15
  ctx.beginPath()
  ctx.moveTo(-5.2, 0)
  ctx.lineTo(-9.4, -2.4)
  ctx.lineTo(-9.2, 2.4)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(-0.6, 0, 6.2, 2.3, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(4.6, 0, 2.15, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#3a3a3a'
  ctx.beginPath()
  ctx.moveTo(6.4, -0.75)
  ctx.lineTo(9.6, 0)
  ctx.lineTo(6.4, 0.75)
  ctx.fill()
  ctx.fillStyle = '#f2efe6'
  ctx.beginPath()
  ctx.arc(5, -0.75, 0.5, 0, Math.PI * 2)
  ctx.fill()
}

/** Wings spread across the body. Frame 0 is a high glide, frame 2 a downstroke. */
function wings(ctx: CanvasRenderingContext2D, frame: number, span: number, color: string): void {
  const tip = frame === 0 ? span : frame === 1 ? span * 0.42 : span * 0.2
  const sweep = frame === 2 ? span * 0.28 : 0
  ctx.fillStyle = color
  ctx.strokeStyle = '#1a120e'
  ctx.lineWidth = 1.2
  for (const side of [1, -1]) {
    ctx.beginPath()
    ctx.moveTo(2, side * 1.6)
    ctx.lineTo(-span * 0.08, side * tip)
    ctx.lineTo(-span * 0.62 + sweep, side * tip * 0.78)
    ctx.lineTo(span * 0.28, side * Math.max(2.2, tip * 0.16))
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
}
