import { flasherFrame } from './flasherArt'
import { gorillaFrame } from './gorillaArt'
import { hoverFrame, paintHoverRotors } from './hoverArt'
import { isoFactoryPortraitUrl } from './isoArt'
import { BUILDING_STATS, TILE, type UnitKind } from './types'

/**
 * The Factory is a roofless garage. Walls and the bay floor are cached.
 * The door, robotic arms, weld sparks, and the unit on the line are drawn live.
 */

const W = 96
const H = 64
const PAD_X = 18
const PAD_Y = 16

type Tool = 'weld' | 'grip' | 'rivet'

interface ArmMount {
  x: number
  y: number
  shoulder: number
  elbow: number
  tool: Tool
}

/** Folded rest poses. Shoulders lie along the wall; elbows tuck the tool back. */
const ARMS: ArmMount[] = [
  { x: 22, y: 16, shoulder: 0.42, elbow: 2.2, tool: 'weld' },
  { x: 74, y: 16, shoulder: Math.PI - 0.42, elbow: -2.2, tool: 'grip' },
  { x: 16, y: 40, shoulder: 1.2, elbow: 2.05, tool: 'rivet' },
  { x: 80, y: 38, shoulder: Math.PI - 1.15, elbow: -2.05, tool: 'weld' },
]

export interface FactoryLook {
  color: string
  owner: number
  /** 0 closed, 1 fully open. */
  open: number
  /** 0 clean through 3 ruined. */
  stage: number
  /** Training progress 0–1. Negative hides the unit on the line. */
  progress: number
  kind: UnitKind | null
  /** Arms cycle and throw sparks. Idle and the door-open retract stay folded. */
  busy: boolean
  time: number
  /** Construction 0–1. A finished Factory is 1. */
  built: number
}

const bodies = new Map<string, HTMLCanvasElement>()

/** Walkable point just outside the south bay door. New units appear here. */
export function yardEntrance(building: { tx: number; ty: number }): { x: number; y: number } {
  const stats = BUILDING_STATS.yard
  return {
    x: (building.tx + stats.w / 2) * TILE,
    y: (building.ty + stats.h) * TILE + 16,
  }
}

export function factoryDamageStage(hp: number, full: number): number {
  const ratio = full > 0 ? hp / full : 1
  if (ratio > 0.75) return 0
  if (ratio > 0.5) return 1
  if (ratio > 0.25) return 2
  return 3
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

function paintBody(ctx: CanvasRenderingContext2D, color: string, stage: number): void {
  ctx.fillStyle = 'rgba(16, 12, 8, 0.32)'
  ctx.beginPath()
  ctx.ellipse(48, 70, 46, 8, 0, 0, Math.PI * 2)
  ctx.fill()

  const pad = ctx.createLinearGradient(-8, -4, 104, 74)
  pad.addColorStop(0, '#e4dfd4')
  pad.addColorStop(0.5, '#c4bfb4')
  pad.addColorStop(1, '#8e897e')
  ctx.fillStyle = pad
  roundPath(ctx, -8, -2, 112, 74, 3)
  ctx.fill()

  const floor = ctx.createLinearGradient(12, 12, 84, 52)
  floor.addColorStop(0, '#5c6168')
  floor.addColorStop(0.55, '#3e434a')
  floor.addColorStop(1, '#2c3136')
  ctx.fillStyle = floor
  ctx.fillRect(12, 12, 72, 40)

  ctx.strokeStyle = 'rgba(20, 22, 26, 0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(24, 16)
  ctx.lineTo(24, 48)
  ctx.moveTo(72, 16)
  ctx.lineTo(72, 48)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(150, 156, 164, 0.45)'
  ctx.beginPath()
  ctx.moveTo(22, 16)
  ctx.lineTo(22, 48)
  ctx.moveTo(74, 16)
  ctx.lineTo(74, 48)
  ctx.stroke()

  ctx.strokeStyle = color
  ctx.globalAlpha = 0.85
  ctx.lineWidth = 1.4
  ctx.setLineDash([5, 4])
  ctx.beginPath()
  ctx.moveTo(48, 18)
  ctx.lineTo(48, 48)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.globalAlpha = 1

  ctx.strokeStyle = 'rgba(18, 20, 24, 0.55)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(18, 28)
  ctx.bezierCurveTo(30, 26, 40, 34, 58, 30)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(30, 40)
  ctx.bezierCurveTo(44, 38, 60, 44, 70, 36)
  ctx.stroke()

  const bins: Array<[number, string]> = [
    [18, '#6a624f'],
    [32, '#4e5960'],
    [58, '#5d6850'],
    [70, color],
  ]
  for (const [bx, fill] of bins) {
    ctx.fillStyle = '#2a2e32'
    ctx.fillRect(bx, 14, 10, 7)
    ctx.fillStyle = fill
    ctx.globalAlpha = fill === color ? 0.9 : 1
    ctx.fillRect(bx + 1, 15, 8, 4)
    ctx.globalAlpha = 1
  }

  ctx.strokeStyle = '#1e2226'
  ctx.lineWidth = 1
  for (let i = 0; i < 5; i++) {
    const hx = 40 + i * 3.2
    ctx.beginPath()
    ctx.moveTo(hx, 13)
    ctx.lineTo(hx, 17)
    ctx.stroke()
  }

  for (let i = 0; i < 8; i++) {
    const stripe = i % 2 === 0 ? '#e2c15a' : '#24282c'
    ctx.fillStyle = stripe
    ctx.fillRect(26 + i * 5.5, 48, 5.5, 6)
  }

  const wall = ctx.createLinearGradient(2, 2, 94, 62)
  wall.addColorStop(0, '#d7dbe0')
  wall.addColorStop(0.45, '#aeb4bc')
  wall.addColorStop(1, '#6d737b')
  ctx.fillStyle = wall
  ctx.fillRect(2, 2, 92, 10)
  ctx.fillRect(2, 12, 10, 40)
  ctx.fillRect(84, 12, 10, 40)
  ctx.fillRect(2, 50, 24, 12)
  ctx.fillRect(70, 50, 24, 12)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)'
  ctx.fillRect(4, 3, 88, 2)
  ctx.fillRect(3, 12, 2, 48)
  ctx.fillStyle = color
  ctx.fillRect(12, 10, 72, 2)
  ctx.fillRect(10, 14, 2, 36)
  ctx.fillRect(84, 14, 2.2, 36)
  ctx.fillRect(4, 50, 20, 2)
  ctx.fillRect(72, 50, 20, 2)

  ctx.fillStyle = 'rgba(30, 34, 38, 0.28)'
  ctx.fillRect(12, 12, 72, 3)
  ctx.fillRect(12, 12, 3, 36)
  ctx.fillRect(81, 12, 3, 36)

  const stains: Array<[number, number, number]> = [
    [20, 6, 4],
    [66, 7, 3],
    [6, 30, 3.5],
    [88, 36, 3],
    [16, 56, 4],
    [78, 55, 3],
  ]
  ctx.fillStyle = 'rgba(70, 62, 48, 0.28)'
  for (const [sx, sy, rad] of stains) {
    ctx.beginPath()
    ctx.ellipse(sx, sy, rad, rad * 0.55, 0.4, 0, Math.PI * 2)
    ctx.fill()
  }

  if (stage >= 1) {
    ctx.strokeStyle = 'rgba(36, 30, 26, 0.7)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(18, 4)
    ctx.lineTo(34, 8)
    ctx.lineTo(28, 14)
    ctx.moveTo(80, 24)
    ctx.lineTo(88, 40)
    ctx.stroke()
  }
  if (stage >= 2) {
    ctx.fillStyle = 'rgba(28, 24, 20, 0.38)'
    ctx.beginPath()
    ctx.ellipse(30, 8, 12, 4, -0.2, 0, Math.PI * 2)
    ctx.ellipse(78, 46, 10, 5, 0.3, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(24, 20, 16, 0.75)'
    ctx.beginPath()
    ctx.moveTo(60, 4)
    ctx.lineTo(52, 12)
    ctx.lineTo(64, 18)
    ctx.stroke()
  }
  if (stage >= 3) {
    ctx.fillStyle = 'rgba(20, 18, 16, 0.45)'
    ctx.fillRect(14, 20, 18, 10)
    ctx.beginPath()
    ctx.ellipse(70, 8, 14, 5, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

function bodySprite(color: string, stage: number): HTMLCanvasElement {
  const key = `${color}:${stage}`
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
  paintBody(ctx, color, stage)
  bodies.set(key, canvas)
  return canvas
}

function paintDoor(ctx: CanvasRenderingContext2D, open: number, color: string): void {
  ctx.fillStyle = '#2a2e32'
  ctx.fillRect(26, 49, 44, 2)
  ctx.fillStyle = color
  ctx.fillRect(26, 49, 44, 1.6)
  ctx.fillRect(25, 49, 2.4, 13)
  ctx.fillRect(68.6, 49, 2.4, 13)
  const slats = 12 * (1 - Math.max(0, Math.min(1, open)))
  if (slats < 0.6) return
  const metal = ctx.createLinearGradient(27, 50, 69, 50 + slats)
  metal.addColorStop(0, '#8b929b')
  metal.addColorStop(1, '#555c64')
  ctx.fillStyle = metal
  ctx.fillRect(27.5, 50.5, 41, slats)
  ctx.strokeStyle = 'rgba(24, 26, 30, 0.4)'
  ctx.lineWidth = 1
  for (let y = 53; y < 50 + slats; y += 2.6) {
    ctx.beginPath()
    ctx.moveTo(28, y)
    ctx.lineTo(68, y)
    ctx.stroke()
  }
}

function limb(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
): void {
  const ang = Math.atan2(y1 - y0, x1 - x0)
  const nx = Math.sin(ang) * width
  const ny = -Math.cos(ang) * width
  ctx.beginPath()
  ctx.moveTo(x0 + nx, y0 + ny)
  ctx.lineTo(x1 + nx, y1 + ny)
  ctx.lineTo(x1 - nx, y1 - ny)
  ctx.lineTo(x0 - nx, y0 - ny)
  ctx.closePath()
  const shade = ctx.createLinearGradient(x0 + nx, y0 + ny, x0 - nx, y0 - ny)
  shade.addColorStop(0, '#e4e7eb')
  shade.addColorStop(0.45, '#b7bdc4')
  shade.addColorStop(1, '#6e757d')
  ctx.fillStyle = shade
  ctx.fill()
  ctx.strokeStyle = 'rgba(28, 32, 36, 0.55)'
  ctx.lineWidth = 1
  ctx.stroke()
}

function pose(arm: ArmMount, index: number, time: number, busy: boolean): { shoulder: number; elbow: number; reach: number } {
  if (!busy) return { shoulder: arm.shoulder, elbow: arm.elbow, reach: 0 }
  const aim = Math.atan2(33 - arm.y, 48 - arm.x)
  const t = time * (1.05 + index * 0.19) + index * 1.35
  const reach = 0.5 + 0.5 * Math.sin(t)
  const wobble = Math.sin(t * 1.45 + 0.7) * 0.18
  const shoulder = arm.shoulder + (aim - arm.shoulder) * (0.28 + 0.72 * reach) + wobble * 0.35
  const sign = arm.elbow < 0 ? -1 : 1
  const elbow = sign * (0.4 + (1 - reach) * 1.55 + wobble)
  return { shoulder, elbow, reach }
}

function paintTool(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, tool: Tool, spark: boolean): void {
  const fx = Math.cos(ang)
  const fy = Math.sin(ang)
  const px = -fy
  const py = fx
  ctx.save()
  ctx.translate(x, y)
  if (tool === 'grip') {
    ctx.strokeStyle = '#2c3136'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(fx * 2 + px * 2.2, fy * 2 + py * 2.2)
    ctx.lineTo(fx * 7 + px * 3.2, fy * 7 + py * 3.2)
    ctx.moveTo(fx * 2 - px * 2.2, fy * 2 - py * 2.2)
    ctx.lineTo(fx * 7 - px * 3.2, fy * 7 - py * 3.2)
    ctx.stroke()
  } else if (tool === 'rivet') {
    ctx.fillStyle = '#4a5158'
    ctx.beginPath()
    ctx.ellipse(fx * 3.5, fy * 3.5, 3.2, 1.8, ang, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#d7dde3'
    ctx.fillRect(fx * 5 - 1, fy * 5 - 1, 2.2, 2.2)
  } else {
    ctx.fillStyle = '#3a4046'
    ctx.beginPath()
    ctx.ellipse(fx * 3, fy * 3, 3.4, 1.5, ang, 0, Math.PI * 2)
    ctx.fill()
    if (spark) {
      const glow = ctx.createRadialGradient(fx * 7, fy * 7, 0, fx * 7, fy * 7, 7)
      glow.addColorStop(0, 'rgba(255, 244, 210, 0.95)')
      glow.addColorStop(0.45, 'rgba(255, 176, 64, 0.55)')
      glow.addColorStop(1, 'rgba(255, 120, 40, 0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(fx * 7, fy * 7, 7, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

function paintSparks(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, index: number): void {
  const flick = 0.6 + 0.4 * Math.sin(time * 22 + index * 2)
  ctx.fillStyle = `rgba(255, 236, 190, ${0.75 + flick * 0.2})`
  ctx.beginPath()
  ctx.arc(x, y, 1.5 + flick, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#ffe3a4'
  ctx.lineWidth = 1
  for (let i = 0; i < 4; i++) {
    const a = time * 11 + index * 0.8 + i * 1.5
    const len = 3.2 + (i % 2) * 2.2
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len * 0.7)
    ctx.stroke()
  }
}

function paintArms(ctx: CanvasRenderingContext2D, color: string, time: number, busy: boolean): void {
  ARMS.forEach((arm, index) => {
    const { shoulder, elbow, reach } = pose(arm, index, time, busy)
    const upper = 16
    const fore = 13
    const x1 = arm.x + Math.cos(shoulder) * upper
    const y1 = arm.y + Math.sin(shoulder) * upper
    const ang = shoulder + elbow
    const x2 = x1 + Math.cos(ang) * fore
    const y2 = y1 + Math.sin(ang) * fore
    const spark = busy && arm.tool === 'weld' && reach > 0.72

    ctx.fillStyle = '#3e444b'
    ctx.beginPath()
    ctx.arc(arm.x, arm.y, 5.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 1.4
    ctx.stroke()
    ctx.fillStyle = '#c5cbcf'
    ctx.beginPath()
    ctx.arc(arm.x, arm.y, 2.3, 0, Math.PI * 2)
    ctx.fill()

    limb(ctx, arm.x, arm.y, x1, y1, 2.5)
    ctx.fillStyle = '#2e343a'
    ctx.beginPath()
    ctx.arc(x1, y1, 2.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x1, y1, 1.2, 0, Math.PI * 2)
    ctx.fill()
    limb(ctx, x1, y1, x2, y2, 2)
    paintTool(ctx, x2, y2, ang, arm.tool, spark)
    if (spark) paintSparks(ctx, x2 + Math.cos(ang) * 7, y2 + Math.sin(ang) * 7, time, index)
  })
}

function paintAssembly(
  ctx: CanvasRenderingContext2D,
  owner: number,
  kind: UnitKind | null,
  progress: number,
  time: number,
  color: string,
): void {
  if (!kind || progress < 0) return
  const grown = Math.max(0, Math.min(1, progress))
  ctx.save()
  ctx.beginPath()
  ctx.rect(14, 14, 68, 34)
  ctx.clip()
  ctx.translate(48, 31)
  ctx.globalAlpha = grown < 0.45 ? 0.9 : 0.35
  ctx.strokeStyle = '#d5dbe1'
  ctx.lineWidth = 1.15
  if (kind === 'howler') {
    ctx.beginPath()
    ctx.ellipse(0, -2, 10, 6, 0, 0, Math.PI * 2)
    ctx.moveTo(-4, 2)
    ctx.lineTo(-12, 9)
    ctx.moveTo(4, 2)
    ctx.lineTo(12, 9)
    ctx.moveTo(-5, 0)
    ctx.lineTo(-13, 5)
    ctx.moveTo(5, 0)
    ctx.lineTo(13, 5)
    ctx.moveTo(4, -4)
    ctx.lineTo(16, -6)
    ctx.stroke()
  } else if (kind === 'drone') {
    ctx.beginPath()
    ctx.ellipse(0, 0, 11, 7, 0, 0, Math.PI * 2)
    ctx.moveTo(-12, 0)
    ctx.lineTo(12, 0)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.ellipse(0, 0, 8, 5, 0, 0, Math.PI * 2)
    ctx.moveTo(-3, 3)
    ctx.lineTo(-11, 8)
    ctx.moveTo(-3, -3)
    ctx.lineTo(-11, -8)
    ctx.moveTo(3, 3)
    ctx.lineTo(11, 8)
    ctx.moveTo(3, -3)
    ctx.lineTo(11, -8)
    ctx.moveTo(5, 4)
    ctx.lineTo(14, 5)
    ctx.moveTo(5, -4)
    ctx.lineTo(14, -5)
    ctx.stroke()
  }
  const sprite =
    kind === 'howler'
      ? gorillaFrame(owner, 2, 0, false, false)
      : kind === 'drone'
        ? hoverFrame(owner, 2, 0)
        : flasherFrame(owner, 2, 0, false, false)
  const scale = kind === 'pike' ? 0.16 + grown * 0.18 : 0.2 + grown * 0.22
  ctx.globalAlpha = 0.15 + grown * 0.85
  ctx.scale(scale, scale)
  ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2)
  if (kind === 'drone') paintHoverRotors(ctx, 2, time * (2 + grown * 6), color)
  ctx.restore()
}

function paintScaffold(ctx: CanvasRenderingContext2D, x: number, y: number, built: number): void {
  const rise = 6 + (1 - built) * 16
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = '#c2a56e'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  const posts: Array<[number, number]> = [
    [4, 4],
    [92, 4],
    [4, 60],
    [92, 60],
  ]
  for (const [px, py] of posts) {
    ctx.beginPath()
    ctx.moveTo(px, py)
    ctx.lineTo(px, py - rise)
    ctx.stroke()
  }
  ctx.strokeStyle = '#8d7348'
  ctx.beginPath()
  ctx.moveTo(4, 4 - rise)
  ctx.lineTo(92, 4 - rise)
  ctx.moveTo(4, 60 - rise * 0.35)
  ctx.lineTo(92, 60 - rise * 0.35)
  ctx.stroke()
  ctx.restore()
}

function paintSmoke(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, stage: number): void {
  if (stage < 2) return
  const drift = Math.sin(time * 1.3) * 2
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = stage >= 3 ? 'rgba(48, 44, 40, 0.4)' : 'rgba(70, 66, 60, 0.24)'
  ctx.beginPath()
  ctx.ellipse(28 + drift, -2, 8, 3.2, 0, 0, Math.PI * 2)
  ctx.ellipse(70 - drift, -4, 6, 2.6, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function drawFactorySprite(ctx: CanvasRenderingContext2D, x: number, y: number, look: FactoryLook): void {
  ctx.save()
  if (look.built < 0.999) {
    const top = y + (1 - look.built) * H
    ctx.beginPath()
    ctx.rect(x - PAD_X, top, W + PAD_X * 2, y + H + PAD_Y - top)
    ctx.clip()
  }
  ctx.drawImage(bodySprite(look.color, look.stage), x - PAD_X, y - PAD_Y)
  ctx.save()
  ctx.translate(x, y)
  paintAssembly(ctx, look.owner, look.kind, look.progress, look.time, look.color)
  paintArms(ctx, look.color, look.time, look.busy)
  paintDoor(ctx, look.open, look.color)
  ctx.restore()
  ctx.restore()
  if (look.built < 0.999) paintScaffold(ctx, x, y, look.built)
  paintSmoke(ctx, x, y, look.time, look.stage)
}

/** Selection portrait and build-menu icon. Empty when there is no document, so smoke can call it. */
export function factoryPortraitUrl(owner: number): string {
  return isoFactoryPortraitUrl(owner)
}
