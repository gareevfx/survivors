import { facingDir } from './stalkerArt'
import { PLAYER_COLOR } from './types'
import { hash2 } from './rng'

/**
 * Isometric scenery and buildings. Yellow trim in the references is the team color.
 * Sprites are cached. Ponds, dirt, and flowers are decoration only.
 */

const INK = '#1c2420'
const STEEL = '#9aa3ad'
const STEEL_MID = '#6d7680'
const STEEL_DARK = '#3a434c'
const STEEL_DEEP = '#262d34'
const LIGHT = '#e4e8ee'
const CONCRETE = '#c8ccd2'
const HOLO = '#3ad4ef'
const HOLO_DEEP = '#146880'

type Ctx = CanvasRenderingContext2D

const tileSprites = new Map<string, HTMLCanvasElement>()
const buildingSprites = new Map<string, HTMLCanvasElement>()
const propSprites = new Map<string, HTMLCanvasElement>()
const portraits = new Map<string, string>()

export type GroundKind = 'grass' | 'grass2' | 'dirt' | 'pond' | 'flower'

export function groundKind(tx: number, ty: number, seed: number): GroundKind {
  const n = hash2(tx, ty, seed + 3)
  const blot = hash2(tx * 2 + 1, ty * 2 - 1, seed + 11)
  if (blot > 0.92 && n > 0.4) return 'pond'
  if (n > 0.82) return 'dirt'
  if (n > 0.74) return 'flower'
  if (n > 0.45) return 'grass2'
  return 'grass'
}

/** North tip of a ground or fog diamond inside its canvas. */
export const GROUND_ANCHOR = { x: 35, y: 2 }

export function groundSprite(kind: GroundKind): HTMLCanvasElement {
  const cached = tileSprites.get(kind)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 70
  canvas.height = 40
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.translate(GROUND_ANCHOR.x, GROUND_ANCHOR.y + 16)
  paintDiamond(ctx, 33, 16)
  if (kind === 'pond') {
    const water = ctx.createLinearGradient(-20, 0, 20, 18)
    water.addColorStop(0, '#8fd0c8')
    water.addColorStop(0.5, '#3f9ea8')
    water.addColorStop(1, '#1e6c78')
    ctx.fillStyle = water
  } else if (kind === 'dirt') {
    const dirt = ctx.createLinearGradient(0, -8, 0, 20)
    dirt.addColorStop(0, '#c4a06a')
    dirt.addColorStop(1, '#8d6a3c')
    ctx.fillStyle = dirt
  } else {
    const grass = ctx.createLinearGradient(0, -10, 8, 22)
    grass.addColorStop(0, kind === 'grass2' ? '#8fbe58' : '#7eb44c')
    grass.addColorStop(1, kind === 'grass2' ? '#5c9438' : '#4f8a34')
    ctx.fillStyle = grass
  }
  ctx.fill()
  ctx.strokeStyle = 'rgba(30, 50, 20, 0.18)'
  ctx.lineWidth = 1
  ctx.stroke()
  if (kind === 'flower') {
    for (const spot of [
      [-8, 4],
      [6, 8],
      [2, -2],
    ] as const) {
      ctx.fillStyle = spot[0] < 0 ? '#f2e27a' : '#f4f7f2'
      ctx.beginPath()
      ctx.arc(spot[0], spot[1], 1.3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  if (kind === 'grass' || kind === 'grass2') {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.beginPath()
    ctx.moveTo(-10, 6)
    ctx.lineTo(-4, 4)
    ctx.moveTo(8, 10)
    ctx.lineTo(14, 7)
    ctx.stroke()
  }
  tileSprites.set(kind, canvas)
  return canvas
}

export function fogDiamond(solid: boolean): HTMLCanvasElement {
  const key = solid ? 'fog-solid' : 'fog-shroud'
  const cached = tileSprites.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 70
  canvas.height = 40
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.translate(GROUND_ANCHOR.x, GROUND_ANCHOR.y + 16)
  paintDiamond(ctx, 33, 16)
  ctx.fillStyle = solid ? '#10160f' : 'rgba(10, 16, 12, 0.62)'
  ctx.fill()
  tileSprites.set(key, canvas)
  return canvas
}

function paintDiamond(ctx: Ctx, hw: number, hh: number): void {
  ctx.beginPath()
  ctx.moveTo(0, -hh)
  ctx.lineTo(hw, 0)
  ctx.lineTo(0, hh)
  ctx.lineTo(-hw, 0)
  ctx.closePath()
}

function footprint(ctx: Ctx, w: number, h: number): void {
  const c = (dx: number, dy: number) => ({ x: dx - dy, y: (dx + dy) * 0.5 })
  const nw = c((-w / 2) * 32, (-h / 2) * 32)
  const ne = c((w / 2) * 32, (-h / 2) * 32)
  const se = c((w / 2) * 32, (h / 2) * 32)
  const sw = c((-w / 2) * 32, (h / 2) * 32)
  ctx.beginPath()
  ctx.moveTo(nw.x, nw.y)
  ctx.lineTo(ne.x, ne.y)
  ctx.lineTo(se.x, se.y)
  ctx.lineTo(sw.x, sw.y)
  ctx.closePath()
}

function spriteCanvas(w: number, h: number, originY: number): { canvas: HTMLCanvasElement; ctx: Ctx; ax: number; ay: number } | null {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const ax = w / 2
  const ay = originY
  ctx.translate(ax, ay)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  return { canvas, ctx, ax, ay }
}

type Anchor = { canvas: HTMLCanvasElement; ax: number; ay: number }

function cached(key: string, build: () => Anchor | null): Anchor | null {
  const hit = buildingSprites.get(key)
  if (hit) return { canvas: hit, ax: Number(hit.dataset.ax), ay: Number(hit.dataset.ay) }
  const made = build()
  if (!made) return null
  made.canvas.dataset.ax = String(made.ax)
  made.canvas.dataset.ay = String(made.ay)
  buildingSprites.set(key, made.canvas)
  return made
}

export function drawAnchored(ctx: Ctx, sprite: Anchor, x: number, y: number): void {
  ctx.drawImage(sprite.canvas, x - sprite.ax, y - sprite.ay)
}

export function keepSprite(color: string, ruined: boolean, open = false): Anchor | null {
  const key = `keep:${color}:${ruined ? 1 : 0}:${open ? 1 : 0}`
  return cached(key, () => {
    const made = spriteCanvas(240, 210, 132)
    if (!made) return null
    paintKeep(made.ctx, color, ruined, open)
    return { canvas: made.canvas, ax: made.ax, ay: made.ay }
  })
}

function paintKeep(ctx: Ctx, accent: string, ruined: boolean, open: boolean): void {
  ctx.save()
  ctx.translate(8, 12)
  footprint(ctx, 3.15, 3.15)
  ctx.fillStyle = 'rgba(16, 28, 14, 0.28)'
  ctx.fill()
  ctx.restore()
  footprint(ctx, 3, 3)
  const pad = ctx.createLinearGradient(-40, -20, 40, 40)
  pad.addColorStop(0, ruined ? '#6a645c' : LIGHT)
  pad.addColorStop(0.5, ruined ? '#4a463f' : STEEL)
  pad.addColorStop(1, ruined ? '#2e2b28' : STEEL_DARK)
  ctx.fillStyle = pad
  ctx.fill()
  ctx.strokeStyle = accent
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.2
  ctx.stroke()

  // Walled ring.
  footprint(ctx, 2.15, 2.15)
  ctx.fillStyle = ruined ? '#3a3834' : STEEL_DEEP
  ctx.fill()
  ctx.strokeStyle = accent
  ctx.lineWidth = 2
  ctx.stroke()

  // Tower body.
  ctx.fillStyle = ruined ? '#5c584f' : LIGHT
  roundTower(ctx, 0, 6, 34, 58)
  ctx.fillStyle = ruined ? '#3e3c38' : STEEL_MID
  ctx.beginPath()
  ctx.moveTo(18, 6)
  ctx.lineTo(30, -2)
  ctx.lineTo(30, -48)
  ctx.lineTo(18, -40)
  ctx.closePath()
  ctx.fill()

  if (!ruined) {
    ctx.fillStyle = HOLO
    ctx.globalAlpha = 0.85
    ctx.fillRect(-16, -28, 10, 22)
    ctx.fillRect(2, -26, 12, 18)
    ctx.globalAlpha = 0.45
    ctx.fillStyle = '#d8fbff'
    ctx.fillRect(-14, -26, 3, 16)
    ctx.globalAlpha = 1
    // Hex door on the south face. It drops when a Stalker is leaving.
    const doorY = open ? 6 : -2
    ctx.fillStyle = STEEL_DEEP
    ctx.fillRect(-8, doorY, 16, open ? 10 : 16)
    ctx.strokeStyle = HOLO
    ctx.lineWidth = 1.2
    ctx.strokeRect(-8, doorY, 16, open ? 10 : 16)
    ctx.beginPath()
    for (let row = 0; row < (open ? 2 : 3); row++) {
      for (let col = 0; col < 3; col++) {
        ctx.moveTo(-5 + col * 4, doorY + 4 + row * 4)
        ctx.lineTo(-3 + col * 4, doorY + 6 + row * 4)
      }
    }
    ctx.stroke()
  } else {
    ctx.fillStyle = '#2a2824'
    ctx.fillRect(-10, 0, 18, 12)
    ctx.strokeStyle = '#6a5040'
    ctx.beginPath()
    ctx.moveTo(-18, -10)
    ctx.lineTo(8, -36)
    ctx.lineTo(16, -6)
    ctx.stroke()
  }

  // Dome.
  ctx.beginPath()
  ctx.ellipse(0, -48, ruined ? 14 : 18, ruined ? 8 : 12, 0, 0, Math.PI * 2)
  ctx.fillStyle = ruined ? '#3a3a38' : HOLO_DEEP
  ctx.fill()
  ctx.strokeStyle = ruined ? '#5c5854' : HOLO
  ctx.lineWidth = 1.2
  ctx.stroke()
  if (!ruined) {
    ctx.strokeStyle = 'rgba(186, 236, 255, 0.8)'
    ctx.beginPath()
    ctx.moveTo(-12, -48)
    ctx.lineTo(12, -48)
    ctx.moveTo(0, -58)
    ctx.lineTo(0, -38)
    ctx.moveTo(-8, -54)
    ctx.lineTo(8, -42)
    ctx.moveTo(8, -54)
    ctx.lineTo(-8, -42)
    ctx.stroke()
  }

  // Team band and small guns.
  ctx.fillStyle = accent
  ctx.fillRect(-20, -8, 40, 3)
  for (const side of [-1, 1]) {
    ctx.fillStyle = STEEL_DARK
    ctx.fillRect(side * 28, -6, 10, 6)
    ctx.fillStyle = accent
    ctx.fillRect(side * 28, -6, 10, 1.6)
  }

  // Dish.
  if (!ruined) {
    ctx.strokeStyle = STEEL_DARK
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(16, -36)
    ctx.lineTo(26, -52)
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(28, -54, 7, 3.2, -0.6, 0, Math.PI * 2)
    ctx.fillStyle = LIGHT
    ctx.fill()
    ctx.strokeStyle = accent
    ctx.stroke()
  }
}

function roundTower(ctx: Ctx, x: number, y: number, hw: number, height: number): void {
  ctx.beginPath()
  ctx.moveTo(x - hw, y)
  ctx.lineTo(x - hw, y - height)
  ctx.quadraticCurveTo(x, y - height - 10, x + hw, y - height)
  ctx.lineTo(x + hw, y)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.1
  ctx.stroke()
}

export function factorySprite(color: string, frame: number): Anchor | null {
  const key = `yard:${color}:${frame}`
  return cached(key, () => {
    const made = spriteCanvas(230, 180, 118)
    if (!made) return null
    paintFactory(made.ctx, color, frame)
    return { canvas: made.canvas, ax: made.ax, ay: made.ay }
  })
}

function paintFactory(ctx: Ctx, accent: string, frame: number): void {
  ctx.save()
  ctx.translate(6, 10)
  footprint(ctx, 3.1, 2.1)
  ctx.fillStyle = 'rgba(16, 28, 14, 0.25)'
  ctx.fill()
  ctx.restore()
  footprint(ctx, 3, 2)
  const pad = ctx.createLinearGradient(-30, -10, 20, 30)
  pad.addColorStop(0, LIGHT)
  pad.addColorStop(1, CONCRETE)
  ctx.fillStyle = pad
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.2
  ctx.stroke()
  // Hazard edge in team color.
  ctx.save()
  ctx.clip()
  ctx.strokeStyle = accent
  ctx.lineWidth = 4
  ctx.setLineDash([7, 5])
  footprint(ctx, 2.82, 1.86)
  ctx.stroke()
  ctx.restore()

  const posts = footprintPoints(3, 2)
  for (const post of posts) {
    ctx.fillStyle = LIGHT
    ctx.fillRect(post.x - 5, post.y - 36, 10, 36)
    ctx.fillStyle = STEEL_DARK
    ctx.fillRect(post.x - 5, post.y - 36, 3, 36)
    ctx.fillStyle = accent
    ctx.fillRect(post.x - 4, post.y - 16, 8, 4)
    ctx.strokeStyle = INK
    ctx.lineWidth = 1
    ctx.strokeRect(post.x - 5, post.y - 36, 10, 36)
  }
  const north = posts[0]
  const east = posts[1]
  if (north && east) {
    ctx.beginPath()
    ctx.moveTo(north.x, north.y - 34)
    ctx.lineTo(east.x, east.y - 34)
    ctx.strokeStyle = STEEL_MID
    ctx.lineWidth = 6
    ctx.stroke()
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.stroke()
  }
  // Cross gantry and the hanging assembly head.
  const slide = (frame - 1.5) * 10
  ctx.beginPath()
  ctx.moveTo(-28, -30)
  ctx.lineTo(36, -18)
  ctx.strokeStyle = LIGHT
  ctx.lineWidth = 5
  ctx.stroke()
  const headX = slide
  const headY = -24 + slide * 0.15
  ctx.fillStyle = STEEL_DARK
  ctx.fillRect(headX - 7, headY, 14, 8)
  ctx.fillStyle = accent
  ctx.fillRect(headX - 7, headY, 14, 2)
  ctx.strokeStyle = STEEL_DEEP
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(headX, headY + 8)
  ctx.lineTo(headX, headY + 20)
  ctx.stroke()
  ctx.fillStyle = '#1e252b'
  ctx.fillRect(headX - 5, headY + 18, 10, 8)
  ctx.fillStyle = HOLO
  ctx.fillRect(headX - 3, headY + 20, 6, 3)
}

function footprintPoints(w: number, h: number): Array<{ x: number; y: number }> {
  const c = (dx: number, dy: number) => ({ x: dx - dy, y: (dx + dy) * 0.5 })
  return [
    c((-w / 2) * 32, (-h / 2) * 32),
    c((w / 2) * 32, (-h / 2) * 32),
    c((w / 2) * 32, (h / 2) * 32),
    c((-w / 2) * 32, (h / 2) * 32),
  ]
}

export function storageSprite(color: string, fill: number): Anchor | null {
  const bucket = Math.round(fill * 4)
  const key = `silo:${color}:${bucket}`
  return cached(key, () => {
    const made = spriteCanvas(170, 160, 108)
    if (!made) return null
    paintStorage(made.ctx, color, bucket / 4)
    return { canvas: made.canvas, ax: made.ax, ay: made.ay }
  })
}

function paintStorage(ctx: Ctx, accent: string, fill: number): void {
  ctx.save()
  ctx.translate(4, 8)
  paintDiamond(ctx, 62, 30)
  ctx.fillStyle = 'rgba(16, 28, 14, 0.25)'
  ctx.fill()
  ctx.restore()
  const tiers = [
    { y: 18, rx: 46, ry: 16, h: 22 },
    { y: -2, rx: 36, ry: 13, h: 18 },
    { y: -20, rx: 26, ry: 10, h: 14 },
  ]
  for (const tier of tiers) {
    ctx.fillStyle = STEEL_DARK
    ctx.beginPath()
    ctx.ellipse(4, tier.y, tier.rx, tier.ry, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = STEEL
    ctx.fillRect(-tier.rx + 4, tier.y - tier.h, tier.rx * 2, tier.h)
    ctx.fillStyle = LIGHT
    ctx.beginPath()
    ctx.ellipse(0, tier.y - tier.h, tier.rx, tier.ry, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.strokeStyle = accent
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.ellipse(0, -4, 34, 12, 0, 0, Math.PI * 2)
  ctx.stroke()
  const inner = 8 + fill * 28
  ctx.fillStyle = fill > 0.05 ? HOLO : '#243038'
  ctx.globalAlpha = 0.35 + fill * 0.55
  ctx.beginPath()
  ctx.ellipse(0, 8 - fill * 18, inner, inner * 0.4, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
}

export function pillarSprite(color: string, dir: number, flash: boolean, spin: number): Anchor | null {
  const bucket = ((Math.round(spin / (Math.PI / 4)) % 8) + 8) % 8
  const key = `tower:${color}:${dir}:${flash ? 1 : 0}:${bucket}`
  return cached(key, () => {
    const made = spriteCanvas(120, 150, 108)
    if (!made) return null
    paintPillar(made.ctx, color, dir, flash, bucket * (Math.PI / 4))
    return { canvas: made.canvas, ax: made.ax, ay: made.ay }
  })
}

function paintPillar(ctx: Ctx, accent: string, dir: number, flash: boolean, spin: number): void {
  ctx.save()
  ctx.translate(3, 6)
  paintDiamond(ctx, 30, 14)
  ctx.fillStyle = 'rgba(16, 28, 14, 0.28)'
  ctx.fill()
  ctx.restore()
  paintDiamond(ctx, 26, 12)
  ctx.fillStyle = '#4c555e'
  ctx.fill()
  ctx.strokeStyle = accent
  ctx.lineWidth = 2
  ctx.stroke()
  for (const foot of footprintPoints(0.7, 0.7)) {
    ctx.fillStyle = STEEL_DEEP
    ctx.fillRect(foot.x - 4, foot.y - 3, 8, 6)
    ctx.fillStyle = accent
    ctx.fillRect(foot.x - 3, foot.y - 3, 6, 1.5)
  }
  ctx.fillStyle = LIGHT
  ctx.fillRect(-10, -8, 20, 28)
  ctx.fillStyle = STEEL_MID
  ctx.fillRect(4, -8, 6, 28)
  ctx.fillStyle = accent
  ctx.fillRect(-10, 2, 20, 3)
  ctx.strokeStyle = INK
  ctx.strokeRect(-10, -8, 20, 28)

  // U-arm and cannon. The head aims along the snapped facing.
  const ang = dir * (Math.PI / 4)
  const wfx = Math.cos(ang)
  const wfy = Math.sin(ang)
  const ix = wfx - wfy
  const iy = (wfx + wfy) * 0.5
  const len = Math.hypot(ix, iy) || 1
  const fx = ix / len
  const fy = iy / len
  ctx.strokeStyle = LIGHT
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(-8, -8)
  ctx.lineTo(-12, -36)
  ctx.lineTo(12, -36)
  ctx.lineTo(8, -8)
  ctx.stroke()
  ctx.strokeStyle = accent
  ctx.lineWidth = 1.5
  ctx.stroke()
  const muzzle = { x: fx * 22, y: -36 + fy * 16 }
  ctx.fillStyle = STEEL_DARK
  ctx.beginPath()
  ctx.moveTo(-4, -36)
  ctx.lineTo(muzzle.x, muzzle.y)
  ctx.lineWidth = 6
  ctx.strokeStyle = '#2a3036'
  ctx.stroke()
  ctx.fillStyle = accent
  ctx.fillRect(-6, -40, 12, 3)
  if (flash) {
    ctx.beginPath()
    ctx.arc(muzzle.x + fx * 6, muzzle.y + fy * 4, 5, 0, Math.PI * 2)
    ctx.fillStyle = '#fff1c4'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(muzzle.x + fx * 10, muzzle.y + fy * 6, 2.4, 0, Math.PI * 2)
    ctx.fillStyle = '#ff9a3c'
    ctx.fill()
  }
  // Small turbine on the pylon.
  ctx.save()
  ctx.translate(0, -48)
  ctx.rotate(spin)
  ctx.strokeStyle = STEEL_LIGHTISH(accent)
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(-9, 0)
  ctx.lineTo(9, 0)
  ctx.moveTo(0, -7)
  ctx.lineTo(0, 7)
  ctx.moveTo(-6, -5)
  ctx.lineTo(6, 5)
  ctx.stroke()
  ctx.restore()
  ctx.beginPath()
  ctx.arc(0, -48, 2, 0, Math.PI * 2)
  ctx.fillStyle = accent
  ctx.fill()
}

function STEEL_LIGHTISH(accent: string): string {
  void accent
  return '#d5dbe3'
}

export function treeSprite(variant: number): Anchor | null {
  const key = `tree:${variant}`
  const hit = propSprites.get(key)
  if (hit) return { canvas: hit, ax: 28, ay: 52 }
  const made = spriteCanvas(56, 64, 52)
  if (!made) return null
  const ctx = made.ctx
  ctx.fillStyle = 'rgba(20, 36, 16, 0.28)'
  ctx.beginPath()
  ctx.ellipse(2, 4, 14, 6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#6a4a2c'
  ctx.fillRect(-3, -16, 6, 18)
  ctx.fillStyle = variant ? '#6eae40' : '#7fbe4e'
  ctx.beginPath()
  ctx.ellipse(-6, -24, 12, 9, 0, 0, Math.PI * 2)
  ctx.ellipse(7, -22, 11, 8, 0, 0, Math.PI * 2)
  ctx.ellipse(0, -32, 13, 10, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.beginPath()
  ctx.ellipse(-4, -34, 6, 3, -0.4, 0, Math.PI * 2)
  ctx.fill()
  const anchor = { canvas: made.canvas, ax: made.ax, ay: made.ay }
  propSprites.set(key, made.canvas)
  return anchor
}

export function rockSprite(variant: number): Anchor | null {
  const key = `rock:${variant}`
  const hit = propSprites.get(key)
  if (hit) return { canvas: hit, ax: 22, ay: 28 }
  const made = spriteCanvas(44, 36, 28)
  if (!made) return null
  const ctx = made.ctx
  ctx.fillStyle = 'rgba(20, 28, 16, 0.25)'
  ctx.beginPath()
  ctx.ellipse(2, 3, 12, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-12, 2)
  ctx.lineTo(-6, -14 - variant)
  ctx.lineTo(4, -18)
  ctx.lineTo(14, -6)
  ctx.lineTo(8, 4)
  ctx.closePath()
  ctx.fillStyle = variant ? '#8a9096' : '#6e767e'
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.stroke()
  ctx.fillStyle = '#c5ccd2'
  ctx.fillRect(-2, -12, 4, 3)
  const anchor = { canvas: made.canvas, ax: made.ax, ay: made.ay }
  propSprites.set(key, made.canvas)
  return anchor
}

export function oreSprite(rich: boolean): Anchor | null {
  const key = rich ? 'ore-rich' : 'ore'
  const hit = propSprites.get(key)
  if (hit) return { canvas: hit, ax: 24, ay: 26 }
  const made = spriteCanvas(48, 36, 26)
  if (!made) return null
  const ctx = made.ctx
  ctx.fillStyle = 'rgba(20, 28, 16, 0.22)'
  ctx.beginPath()
  ctx.ellipse(2, 4, 14, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  const piles = [
    [-8, 0, 10, 6],
    [2, -2, 12, 7],
    [-2, -8, 8, 5],
  ] as const
  for (const [x, y, w, h] of piles) {
    ctx.fillStyle = '#8a6840'
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = '#c2b8a4'
    ctx.fillRect(x + 1, y, w * 0.4, 2)
  }
  if (rich) {
    ctx.fillStyle = '#e6c15a'
    ctx.fillRect(4, -6, 3, 2)
  }
  const anchor = { canvas: made.canvas, ax: made.ax, ay: made.ay }
  propSprites.set(key, made.canvas)
  return anchor
}

function portraitOf(key: string, paint: (ctx: Ctx) => void): string {
  if (typeof document === 'undefined') return ''
  const cachedUrl = portraits.get(key)
  if (cachedUrl) return cachedUrl
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#243024'
  ctx.fillRect(0, 0, 64, 64)
  ctx.translate(32, 40)
  ctx.scale(0.34, 0.34)
  ctx.lineJoin = 'round'
  paint(ctx)
  const url = canvas.toDataURL()
  portraits.set(key, url)
  return url
}

export function isoKeepPortraitUrl(owner: number): string {
  const color = PLAYER_COLOR[owner] ?? '#5ec8ff'
  return portraitOf(`keep-icon:${color}`, (ctx) => paintKeep(ctx, color, false, false))
}

export function isoRuinedPortraitUrl(): string {
  return portraitOf('keep-ruin', (ctx) => paintKeep(ctx, '#8a8070', true, false))
}

export function isoFactoryPortraitUrl(owner: number): string {
  const color = PLAYER_COLOR[owner] ?? '#5ec8ff'
  return portraitOf(`yard-icon:${color}`, (ctx) => paintFactory(ctx, color, 1))
}

export function isoStoragePortraitUrl(owner: number): string {
  const color = PLAYER_COLOR[owner] ?? '#5ec8ff'
  return portraitOf(`silo-icon:${color}`, (ctx) => paintStorage(ctx, color, 0.45))
}

export function isoPillarPortraitUrl(owner: number): string {
  const color = PLAYER_COLOR[owner] ?? '#5ec8ff'
  return portraitOf(`tower-icon:${color}`, (ctx) => paintPillar(ctx, color, 0, false, 0.4))
}

export function pillarAimDir(angle: number): number {
  return facingDir(angle)
}
