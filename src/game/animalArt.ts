import type { Animal, AnimalKind } from './types'

/**
 * Original top-down wildlife. Sprites are cached and drawn in the same ink-outline
 * style as the rest of the Surface. Ground animals face east in the sprite;
 * the renderer rotates them onto their heading.
 */

const INK = '#24160f'

const cache = new Map<string, HTMLCanvasElement>()

export function drawAnimal(ctx: CanvasRenderingContext2D, animal: Animal): void {
  const flying = animal.kind === 'crow' || animal.kind === 'eagle'
  const frames = flying ? 3 : 2
  let frame = Math.floor(animal.phase) % frames
  if (frame < 0) frame += frames
  const sprite = animalSprite(animal.kind, frame)
  const lift = flying ? 11 : 0
  ctx.save()
  ctx.translate(animal.x, animal.y)
  ctx.fillStyle = flying ? 'rgba(16, 12, 8, 0.2)' : 'rgba(16, 12, 8, 0.34)'
  ctx.beginPath()
  const shadowW = animal.kind === 'eagle' ? 12 : animal.kind === 'moose' ? 13 : animal.kind === 'bear' ? 10 : 6
  ctx.ellipse(1, flying ? 12 : 7, shadowW, 3.4, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.rotate(animal.facing)
  ctx.translate(0, -lift)
  ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2)
  ctx.restore()
}

function animalSprite(kind: AnimalKind, frame: number): HTMLCanvasElement {
  const key = `${kind}:${frame}`
  const cached = cache.get(key)
  if (cached) return cached
  const size = kind === 'eagle' ? 56 : kind === 'moose' ? 52 : kind === 'crow' ? 36 : 48
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.translate(size / 2, size / 2)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = INK
  if (kind === 'bear') paintBear(ctx, frame)
  else if (kind === 'moose') paintMoose(ctx, frame)
  else if (kind === 'crow') paintCrow(ctx, frame)
  else paintEagle(ctx, frame)
  cache.set(key, canvas)
  return canvas
}

function paintBear(ctx: CanvasRenderingContext2D, frame: number): void {
  const step = frame % 2 === 0 ? 1.6 : -1.6
  ctx.fillStyle = '#3a2618'
  leg(ctx, -8, 7.4, step, 3.1, 4.2)
  leg(ctx, -8, -7.4, -step, 3.1, 4.2)
  leg(ctx, 5.5, 6.6, -step, 2.8, 3.8)
  leg(ctx, 5.5, -6.6, step, 2.8, 3.8)
  ctx.fillStyle = '#6b4630'
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.ellipse(-1, 0, 12.4, 7.6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#5a3b28'
  ctx.beginPath()
  ctx.arc(11.2, 0, 5.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#2c1c12'
  ctx.beginPath()
  ctx.arc(9.2, -5.6, 2.3, 0, Math.PI * 2)
  ctx.arc(9.2, 5.6, 2.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#c4a07a'
  ctx.beginPath()
  ctx.ellipse(15.6, 0, 2.8, 2.05, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#1a120e'
  ctx.beginPath()
  ctx.arc(17.4, 0, 1.15, 0, Math.PI * 2)
  ctx.fill()
}

function paintMoose(ctx: CanvasRenderingContext2D, frame: number): void {
  const step = frame % 2 === 0 ? 1.8 : -1.8
  ctx.fillStyle = '#efe2cc'
  leg(ctx, -9, 5.6, step, 2.3, 5)
  leg(ctx, -9, -5.6, -step, 2.3, 5)
  leg(ctx, 7, 5, -step, 2.1, 5.1)
  leg(ctx, 7, -5, step, 2.1, 5.1)
  ctx.fillStyle = '#a56c42'
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.ellipse(-2, 0, 14.4, 6.4, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#8d5a34'
  ctx.beginPath()
  ctx.ellipse(12.2, 0, 7.2, 3.6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = '#2a1c12'
  ctx.lineWidth = 1.7
  antler(ctx, 1)
  antler(ctx, -1)
  ctx.fillStyle = '#1a120e'
  ctx.beginPath()
  ctx.arc(18.6, 0, 1.25, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(13.4, -1.7, 0.75, 0, Math.PI * 2)
  ctx.fill()
}

function antler(ctx: CanvasRenderingContext2D, side: number): void {
  ctx.beginPath()
  ctx.moveTo(13, side * 2.4)
  ctx.lineTo(15.5, side * 10.5)
  ctx.moveTo(14.4, side * 6.2)
  ctx.lineTo(18.4, side * 8.4)
  ctx.moveTo(14.6, side * 8.2)
  ctx.lineTo(12.2, side * 11.6)
  ctx.stroke()
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

function paintEagle(ctx: CanvasRenderingContext2D, frame: number): void {
  wings(ctx, frame, 20, '#6a4328')
  ctx.fillStyle = '#8d6238'
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.25
  ctx.beginPath()
  ctx.moveTo(-7.5, 0)
  ctx.lineTo(-14.5, -3.6)
  ctx.lineTo(-14.2, 3.6)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(-1.2, 0, 8.6, 3, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#f3f0e6'
  ctx.beginPath()
  ctx.arc(7.2, 0, 3.7, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#e2b34a'
  ctx.beginPath()
  ctx.moveTo(10, -0.9)
  ctx.lineTo(14.2, 0)
  ctx.lineTo(10, 0.9)
  ctx.fill()
  ctx.fillStyle = '#1a120e'
  ctx.beginPath()
  ctx.arc(7.6, -1.15, 0.6, 0, Math.PI * 2)
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

function leg(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  step: number,
  rx = 2.7,
  ry = 3.6,
): void {
  ctx.beginPath()
  ctx.ellipse(x, y + step, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
}
