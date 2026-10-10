import { BUILDING_STATS, PLAYER_COLOR, STORAGE_FILL_REFERENCE } from './types'

/**
 * Storage is a round warehouse of three stacked tiers. The whole drawing is
 * cached. A side's first Storage is empty. Further Cells from buildings fill the
 * bottom tier, then the middle, then the top, up to a Silo plus four Storages.
 */

const W = 64
const H = 64
const PAD_X = 16
const PAD_Y = 18

interface Tier {
  rimY: number
  baseY: number
  rx: number
  ry: number
  /** Crate slots in the open top, from -1 to 1 across the ellipse. */
  slots: Array<[number, number]>
}

const TIERS: Tier[] = [
  {
    rimY: 42,
    baseY: 56,
    rx: 28,
    ry: 10,
    slots: [
      [-0.62, 0.05],
      [0.62, 0.05],
      [-0.38, 0.42],
      [0.38, 0.42],
      [-0.7, -0.38],
      [0.7, -0.38],
      [-0.12, 0.55],
      [0.12, 0.55],
    ],
  },
  {
    rimY: 28,
    baseY: 42,
    rx: 19,
    ry: 7.5,
    slots: [
      [-0.58, 0.2],
      [0.58, 0.2],
      [-0.22, 0.5],
      [0.22, 0.5],
      [0, -0.35],
    ],
  },
  {
    rimY: 16,
    baseY: 28,
    rx: 12,
    ry: 5.2,
    slots: [
      [-0.35, 0.15],
      [0.38, 0.2],
      [0, -0.25],
    ],
  },
]

const bodies = new Map<string, HTMLCanvasElement>()
const portraits = new Map<number, string>()

/**
 * 0 when Cells are at or below a Silo plus one Storage.
 * 1 at a Silo plus four Storages. Past that the warehouse stays full.
 * The first finished Storage is an empty warehouse; later capacity fills it.
 */
export function storageFill(cap: number): number {
  const emptyAt = BUILDING_STATS.keep.supply + BUILDING_STATS.silo.supply
  const span = STORAGE_FILL_REFERENCE - emptyAt
  if (span <= 0 || cap <= emptyAt) return 0
  return Math.max(0, Math.min(1, (cap - emptyAt) / span))
}

export function storageDamageStage(hp: number, full: number): number {
  const ratio = full > 0 ? hp / full : 1
  if (ratio > 0.75) return 0
  if (ratio > 0.5) return 1
  if (ratio > 0.25) return 2
  return 3
}

function tierAmount(fill: number, index: number): number {
  const start = index / TIERS.length
  const end = (index + 1) / TIERS.length
  if (fill <= start) return 0
  if (fill >= end) return 1
  return (fill - start) / (end - start)
}

function paintTier(
  ctx: CanvasRenderingContext2D,
  tier: Tier,
  color: string,
  amount: number,
  stage: number,
): void {
  const cx = W / 2
  const wall = ctx.createLinearGradient(cx - tier.rx, 0, cx + tier.rx, 0)
  wall.addColorStop(0, '#6a7076')
  wall.addColorStop(0.28, '#c9ced3')
  wall.addColorStop(0.55, '#a3a9b0')
  wall.addColorStop(1, '#4e555c')
  ctx.fillStyle = wall
  ctx.beginPath()
  ctx.ellipse(cx, tier.rimY, tier.rx, tier.ry, 0, Math.PI, 0, true)
  ctx.lineTo(cx + tier.rx, tier.baseY)
  ctx.ellipse(cx, tier.baseY, tier.rx, tier.ry, 0, 0, Math.PI, false)
  ctx.closePath()
  ctx.fill()

  const floor = ctx.createRadialGradient(cx, tier.rimY, 1, cx, tier.rimY, tier.rx)
  floor.addColorStop(0, '#171b20')
  floor.addColorStop(0.72, '#2a3036')
  floor.addColorStop(1, '#3a4148')
  ctx.fillStyle = floor
  ctx.beginPath()
  ctx.ellipse(cx, tier.rimY, tier.rx * 0.86, tier.ry * 0.78, 0, 0, Math.PI * 2)
  ctx.fill()

  const shown = amount <= 0 ? 0 : Math.max(1, Math.round(amount * tier.slots.length))
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(cx, tier.rimY, tier.rx * 0.84, tier.ry * 0.74, 0, 0, Math.PI * 2)
  ctx.clip()
  for (let i = 0; i < shown; i++) {
    const slot = tier.slots[i]
    if (!slot) continue
    const [ox, oy] = slot
    const x = cx + ox * tier.rx * 0.62
    const y = tier.rimY + oy * tier.ry * 0.5
    const cw = Math.max(3.2, tier.rx * 0.22)
    const ch = Math.max(2.2, tier.ry * 0.42)
    ctx.fillStyle = i % 2 === 0 ? '#c4a06a' : '#8d6840'
    ctx.fillRect(x - cw / 2, y - ch / 2, cw, ch)
    ctx.fillStyle = 'rgba(40, 28, 16, 0.35)'
    ctx.fillRect(x - cw / 2, y - ch / 2, cw, 0.7)
    if (i % 3 === 0) {
      ctx.fillStyle = color
      ctx.fillRect(x - cw / 2, y - 0.4, cw, 0.9)
    }
  }
  ctx.restore()

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.ellipse(cx, tier.rimY - 0.4, tier.rx * 0.96, tier.ry * 0.86, 0, Math.PI * 1.05, Math.PI * 1.95)
  ctx.stroke()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.7
  ctx.beginPath()
  ctx.ellipse(cx, tier.rimY, tier.rx, tier.ry, 0, 0, Math.PI * 2)
  ctx.stroke()

  if (stage >= 1) {
    ctx.strokeStyle = 'rgba(36, 30, 26, 0.65)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx - tier.rx * 0.4, tier.rimY + 2)
    ctx.lineTo(cx - tier.rx * 0.1, (tier.rimY + tier.baseY) / 2)
    ctx.lineTo(cx + tier.rx * 0.15, tier.baseY - 1)
    ctx.stroke()
  }
  if (stage >= 2) {
    ctx.fillStyle = 'rgba(28, 24, 20, 0.35)'
    ctx.beginPath()
    ctx.ellipse(cx + tier.rx * 0.25, (tier.rimY + tier.baseY) / 2, tier.rx * 0.28, tier.ry * 0.45, 0.2, 0, Math.PI * 2)
    ctx.fill()
  }
}

function paintBody(ctx: CanvasRenderingContext2D, color: string, fill: number, stage: number): void {
  ctx.fillStyle = 'rgba(16, 12, 8, 0.3)'
  ctx.beginPath()
  ctx.ellipse(W / 2 + 2, 60, 30, 7, 0, 0, Math.PI * 2)
  ctx.fill()

  const pad = ctx.createLinearGradient(0, 36, 64, 64)
  pad.addColorStop(0, '#d9d4c8')
  pad.addColorStop(1, '#8e897e')
  ctx.fillStyle = pad
  ctx.beginPath()
  ctx.ellipse(W / 2, 54, 31, 11, 0, 0, Math.PI * 2)
  ctx.fill()

  for (let i = 0; i < TIERS.length; i++) {
    const tier = TIERS[i]
    if (!tier) continue
    paintTier(ctx, tier, color, tierAmount(fill, i), stage)
  }

  if (stage >= 3) {
    ctx.fillStyle = 'rgba(20, 18, 16, 0.4)'
    ctx.beginPath()
    ctx.ellipse(22, 48, 8, 3, -0.2, 0, Math.PI * 2)
    ctx.ellipse(44, 34, 6, 2.4, 0.3, 0, Math.PI * 2)
    ctx.fill()
  }
}

function fillKey(fill: number): number {
  return Math.max(0, Math.min(6, Math.round(fill * 6)))
}

function bodySprite(color: string, fill: number, stage: number): HTMLCanvasElement {
  const step = fillKey(fill)
  const key = `${color}:${step}:${stage}`
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
  paintBody(ctx, color, step / 6, stage)
  bodies.set(key, canvas)
  return canvas
}

export function drawStorageSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  fill: number,
  stage: number,
): void {
  ctx.drawImage(bodySprite(color, fill, stage), x - PAD_X, y - PAD_Y)
}

/** Selection portrait and build-menu icon. Empty when there is no document, so smoke can call it. */
export function storagePortraitUrl(owner: number): string {
  if (typeof document === 'undefined') return ''
  const cached = portraits.get(owner)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 72
  canvas.height = 72
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#6d6248'
  ctx.fillRect(0, 0, 72, 72)
  ctx.save()
  ctx.translate(10, 8)
  ctx.scale(0.78, 0.78)
  drawStorageSprite(ctx, 0, 0, PLAYER_COLOR[owner] ?? '#5ec8ff', 0.5, 0)
  ctx.restore()
  const url = canvas.toDataURL()
  portraits.set(owner, url)
  return url
}
