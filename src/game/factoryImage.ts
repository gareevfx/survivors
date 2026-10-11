import { recolorTrim } from './siloImage'
import { PLAYER_COLOR, TILE } from './types'

/**
 * The Factory sprite is the keyed gantry photograph, drawn as-is.
 * It is scaled uniformly so its width matches the 2×3 footprint diamond,
 * and the bottom center of the picture sits on that diamond's front corner.
 * Orange trim is hue-mapped to the team color. One sprite is cached per color.
 * The drop shadow is drawn by the renderer, not baked into the photo.
 */

const SRC = '/assets/factory.png'
const FOOT_W = 2
const FOOT_H = 3
/** Iso width of the 2×3 diamond. */
const DIAMOND_W = (FOOT_W + FOOT_H) * TILE
/** Front corner of that diamond, relative to the footprint center. */
const FRONT_DX = ((FOOT_W - FOOT_H) * TILE) / 2
const FRONT_DY = ((FOOT_W + FOOT_H) * TILE) / 4

type Anchor = { canvas: HTMLCanvasElement; ax: number; ay: number }

let photo: HTMLImageElement | null = null
let ready = false
const tints = new Map<string, Anchor>()
const portraits = new Map<string, string>()

export function preloadFactoryImage(): void {
  if (ready || photo || typeof Image === 'undefined') return
  const image = new Image()
  image.decoding = 'async'
  image.onload = () => {
    ready = true
    for (const color of PLAYER_COLOR) factoryPhotoSprite(color)
  }
  image.src = SRC
  photo = image
}

preloadFactoryImage()

/** Uniform size for a source photo: diamond width, original aspect, bottom on the front corner. */
export function factoryPlacement(srcW: number, srcH: number): { width: number; height: number; ax: number; ay: number } {
  const width = DIAMOND_W
  const height = Math.max(1, Math.round(srcH * (width / srcW)))
  return { width, height, ax: width / 2 - FRONT_DX, ay: height - FRONT_DY }
}

/** True when the photo is scaled evenly to the 2×3 diamond and sits on its front corner. */
export function factoryCoversFootprint(): boolean {
  const square = factoryPlacement(1000, 1000)
  const tall = factoryPlacement(500, 800)
  const onFront = (place: { width: number; height: number; ax: number; ay: number }) =>
    Math.abs(place.width / 2 - place.ax - FRONT_DX) < 0.6 && Math.abs(place.height - place.ay - FRONT_DY) < 0.6
  return (
    square.width === DIAMOND_W &&
    tall.width === DIAMOND_W &&
    square.width === (2 + 3) * TILE &&
    Math.abs(square.height - square.width) <= 1 &&
    Math.abs(tall.height / tall.width - 800 / 500) < 0.02 &&
    onFront(square) &&
    onFront(tall)
  )
}

export function factoryPhotoSprite(color: string): Anchor | null {
  if (!ready || !photo) return null
  const cached = tints.get(color)
  if (cached) return cached
  const made = tintSprite(photo, color)
  tints.set(color, made)
  return made
}

export function factoryPhotoPortrait(owner: number): string {
  if (typeof document === 'undefined' || !ready) return ''
  const color = PLAYER_COLOR[owner] ?? '#5ec8ff'
  const cached = portraits.get(color)
  if (cached) return cached
  const sprite = factoryPhotoSprite(color)
  if (!sprite) return ''
  const url = portraitUrl(sprite.canvas)
  portraits.set(color, url)
  return url
}

function portraitUrl(sprite: HTMLCanvasElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#243024'
  ctx.fillRect(0, 0, 64, 64)
  const scale = Math.min(58 / sprite.width, 58 / sprite.height)
  const w = sprite.width * scale
  const h = sprite.height * scale
  ctx.drawImage(sprite, (64 - w) / 2, (64 - h) / 2 + 1, w, h)
  return canvas.toDataURL()
}

function tintSprite(image: HTMLImageElement, color: string): Anchor {
  const place = factoryPlacement(image.width, image.height)
  const canvas = document.createElement('canvas')
  canvas.width = place.width
  canvas.height = place.height
  const ctx = canvas.getContext('2d')
  const placed = { canvas, ax: place.ax, ay: place.ay }
  if (!ctx) return placed
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, place.width, place.height)
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
  recolorTrim(frame.data, color)
  ctx.putImageData(frame, 0, 0)
  return placed
}
