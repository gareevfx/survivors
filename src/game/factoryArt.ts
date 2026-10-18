import { flasherFrame } from './flasherArt'
import { frogFrame } from './frogArt'
import { gorillaFrame } from './gorillaArt'
import { hoverFrame, paintHoverRotors } from './hoverArt'
import { BUILDING_STATS, PLAYER_COLOR, TILE, type UnitKind } from './types'

/**
 * The Factory is a roofless concrete bay on a 3×2 footprint.
 * The shell is cached. The striped door, arms, and the unit on the line are drawn live.
 * Player color is only the door stripes, the emblem, and the arm-joint rings.
 */

const W = 96
const H = 64

const SHELL = { x: 3, y: 2, w: 90, h: 60, r: 8 }
const FLOOR = { x: 14, y: 13, w: 68, h: 32 }
const DOOR = { x: 32, y: 46, w: 32, h: 14 }

type Tool = 'weld' | 'grip' | 'rivet'

interface ArmMount {
  x: number
  y: number
  shoulder: number
  elbow: number
  tool: Tool
}

/** Folded along the walls. Busy poses reach into the bay. */
const ARMS: ArmMount[] = [
  { x: 17, y: 22, shoulder: 1.35, elbow: 2.15, tool: 'weld' },
  { x: 79, y: 22, shoulder: Math.PI - 1.35, elbow: -2.15, tool: 'grip' },
  { x: 32, y: 15, shoulder: 0.2, elbow: 2.15, tool: 'rivet' },
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
const portraits = new Map<number, string>()

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

function paintFloor(ctx: CanvasRenderingContext2D): void {
  const cols = 4
  const rows = 2
  const gap = 2
  const cellW = (FLOOR.w - gap * (cols + 1)) / cols
  const cellH = (FLOOR.h - gap * (rows + 1)) / rows
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const px = FLOOR.x + gap + col * (cellW + gap)
      const py = FLOOR.y + gap + row * (cellH + gap)
      const tone = (col + row) % 2 === 0 ? '#f7f4ee' : '#ebe4d8'
      const shade = ctx.createLinearGradient(px, py, px, py + cellH)
      shade.addColorStop(0, '#fbf9f4')
      shade.addColorStop(1, tone)
      ctx.fillStyle = shade
      ctx.fillRect(px, py, cellW, cellH)
      ctx.strokeStyle = '#b7aea0'
      ctx.lineWidth = 1
      ctx.strokeRect(px + 0.5, py + 0.5, cellW - 1, cellH - 1)
    }
  }
}

function paintShell(ctx: CanvasRenderingContext2D, stage: number): void {
  const { x, y, w, h, r } = SHELL
  const pad = ctx.createLinearGradient(x, y, x + w, y + h)
  pad.addColorStop(0, '#f6f2ea')
  pad.addColorStop(0.45, '#e6dfd2')
  pad.addColorStop(1, '#cfc6b6')
  ctx.fillStyle = pad
  roundPath(ctx, x, y, w, h, r)
  ctx.fill()
  ctx.strokeStyle = '#8d8476'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255, 252, 246, 0.7)'
  ctx.lineWidth = 1
  roundPath(ctx, x + 2, y + 2, w - 4, h - 4, r - 2)
  ctx.stroke()

  ctx.fillStyle = 'rgba(90, 78, 62, 0.08)'
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(x + 8 + ((i * 19) % (w - 20)), y + 5 + ((i * 11) % 6), 2, 1)
  }

  ctx.fillStyle = '#12161b'
  roundPath(ctx, FLOOR.x, FLOOR.y, FLOOR.w, FLOOR.h, 4)
  ctx.fill()
  paintFloor(ctx)

  ctx.fillStyle = '#101418'
  for (const gx of [18, 66]) {
    roundPath(ctx, gx, 5, 12, 5, 1.5)
    ctx.fill()
  }
  ctx.fillStyle = 'rgba(214, 232, 240, 0.28)'
  ctx.fillRect(19, 6, 2, 3)
  ctx.fillRect(67, 6, 2, 3)

  ctx.fillStyle = '#12110f'
  roundPath(ctx, DOOR.x, DOOR.y, DOOR.w, DOOR.h, 3)
  ctx.fill()

  if (stage > 0) paintDamage(ctx, stage)
}

function paintDamage(ctx: CanvasRenderingContext2D, stage: number): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(36, 28, 20, 0.75)'
  ctx.lineWidth = 1.1
  ctx.lineCap = 'round'
  const cracks = [
    [12, 8, 28, 10, 22, 16],
    [78, 8, 70, 14, 84, 20],
    [10, 40, 16, 52],
    [84, 36, 78, 50],
  ]
  const count = stage === 1 ? 1 : stage === 2 ? 3 : 4
  for (let i = 0; i < count; i++) {
    const line = cracks[i]
    if (!line) continue
    ctx.beginPath()
    ctx.moveTo(line[0] ?? 0, line[1] ?? 0)
    for (let p = 2; p < line.length; p += 2) ctx.lineTo(line[p] ?? 0, line[p + 1] ?? 0)
    ctx.stroke()
  }
  if (stage >= 2) {
    ctx.fillStyle = 'rgba(40, 34, 28, 0.18)'
    ctx.beginPath()
    ctx.ellipse(24, 8, 8, 3, -0.2, 0, Math.PI * 2)
    ctx.fill()
  }
  if (stage >= 3) {
    ctx.fillStyle = 'rgba(28, 24, 20, 0.35)'
    ctx.beginPath()
    ctx.ellipse(74, 48, 8, 3.5, 0.2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
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
  paintShell(ctx, stage)
  bodies.set(key, canvas)
  return canvas
}

function paintDoor(ctx: CanvasRenderingContext2D, open: number, color: string, time: number): void {
  const { x, y, w, h } = DOOR
  const slide = Math.max(0, Math.min(1, open)) * (h + 2)
  ctx.save()
  roundPath(ctx, x, y, w, h, 3)
  ctx.clip()
  ctx.save()
  ctx.translate(0, -slide)
  const stripes = Math.ceil((w + h) / 4) + 2
  for (let i = -2; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? color : '#2a261f'
    ctx.beginPath()
    ctx.moveTo(x + i * 4, y - 2)
    ctx.lineTo(x + i * 4 + 5, y - 2)
    ctx.lineTo(x + i * 4 + 5 - h, y + h + 2)
    ctx.lineTo(x + i * 4 - h, y + h + 2)
    ctx.closePath()
    ctx.fill()
  }
  if (open < 0.04) {
    const sheen = x + ((Math.sin(time * 0.55) + 1) / 2) * (w - 4)
    ctx.fillStyle = 'rgba(255, 252, 244, 0.22)'
    ctx.fillRect(sheen, y, 3, h)
  }
  const cx = x + w / 2
  const cy = y + h / 2
  ctx.beginPath()
  ctx.arc(cx, cy, 3.6, 0, Math.PI * 2)
  ctx.fillStyle = '#f7f4ee'
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = color
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, 1.4, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
  ctx.restore()
}

function limb(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, width: number): void {
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
  shade.addColorStop(0, '#f7f8f6')
  shade.addColorStop(0.45, '#d5d8dc')
  shade.addColorStop(1, '#9aa1a8')
  ctx.fillStyle = shade
  ctx.fill()
  ctx.strokeStyle = 'rgba(90, 96, 102, 0.55)'
  ctx.lineWidth = 0.8
  ctx.stroke()
}

function pose(arm: ArmMount, index: number, time: number, busy: boolean): { shoulder: number; elbow: number; reach: number } {
  if (!busy) return { shoulder: arm.shoulder, elbow: arm.elbow, reach: 0 }
  const aim = Math.atan2(30 - arm.y, 48 - arm.x)
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
    ctx.strokeStyle = '#8d949c'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(fx * 2 + px * 2.2, fy * 2 + py * 2.2)
    ctx.lineTo(fx * 6.5 + px * 3, fy * 6.5 + py * 3)
    ctx.moveTo(fx * 2 - px * 2.2, fy * 2 - py * 2.2)
    ctx.lineTo(fx * 6.5 - px * 3, fy * 6.5 - py * 3)
    ctx.stroke()
  } else if (tool === 'rivet') {
    ctx.fillStyle = '#c5ccd2'
    ctx.beginPath()
    ctx.ellipse(fx * 3.2, fy * 3.2, 3, 1.6, ang, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.fillStyle = '#b7c0c8'
    ctx.beginPath()
    ctx.ellipse(fx * 3, fy * 3, 3.2, 1.4, ang, 0, Math.PI * 2)
    ctx.fill()
    if (spark) {
      const glow = ctx.createRadialGradient(fx * 6.5, fy * 6.5, 0, fx * 6.5, fy * 6.5, 6)
      glow.addColorStop(0, 'rgba(255, 244, 210, 0.95)')
      glow.addColorStop(0.45, 'rgba(255, 176, 64, 0.5)')
      glow.addColorStop(1, 'rgba(255, 120, 40, 0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(fx * 6.5, fy * 6.5, 6, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

function paintArms(ctx: CanvasRenderingContext2D, color: string, time: number, busy: boolean): void {
  ARMS.forEach((arm, index) => {
    const { shoulder, elbow, reach } = pose(arm, index, time, busy)
    const upper = 13
    const fore = 10
    const x1 = arm.x + Math.cos(shoulder) * upper
    const y1 = arm.y + Math.sin(shoulder) * upper
    const ang = shoulder + elbow
    const x2 = x1 + Math.cos(ang) * fore
    const y2 = y1 + Math.sin(ang) * fore
    const spark = busy && arm.tool === 'weld' && reach > 0.72

    ctx.fillStyle = '#e7ebef'
    ctx.beginPath()
    ctx.arc(arm.x, arm.y, 4.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 1.3
    ctx.stroke()
    ctx.fillStyle = '#f7f4ee'
    ctx.beginPath()
    ctx.arc(arm.x, arm.y, 1.7, 0, Math.PI * 2)
    ctx.fill()

    limb(ctx, arm.x, arm.y, x1, y1, 2.2)
    ctx.fillStyle = '#f4f6f8'
    ctx.beginPath()
    ctx.arc(x1, y1, 2.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#9aa1a8'
    ctx.lineWidth = 0.8
    ctx.stroke()
    limb(ctx, x1, y1, x2, y2, 1.7)
    paintTool(ctx, x2, y2, ang, arm.tool, spark)
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
  ctx.rect(FLOOR.x + 2, FLOOR.y + 2, FLOOR.w - 4, FLOOR.h - 4)
  ctx.clip()
  ctx.translate(48, 29)
  const sprite =
    kind === 'howler'
      ? gorillaFrame(owner, 2, 0, false, false)
      : kind === 'drone'
        ? hoverFrame(owner, 2, 0)
        : kind === 'frog'
          ? frogFrame(owner, 2, 0)
          : flasherFrame(owner, 2, 0, false, false)
  const scale = 0.18 + grown * 0.2
  ctx.globalAlpha = 0.2 + grown * 0.8
  ctx.scale(scale, scale)
  ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2)
  if (kind === 'drone') paintHoverRotors(ctx, 2, time * (2 + grown * 6), color)
  ctx.restore()
}

function paintSmoke(ctx: CanvasRenderingContext2D, time: number, stage: number): void {
  if (stage < 2) return
  const drift = Math.sin(time * 1.3) * 2
  ctx.fillStyle = stage >= 3 ? 'rgba(48, 44, 40, 0.4)' : 'rgba(70, 66, 60, 0.22)'
  ctx.beginPath()
  ctx.ellipse(28 + drift, 1, 7, 2.6, 0, 0, Math.PI * 2)
  ctx.ellipse(68 - drift, 0, 5, 2.2, 0, 0, Math.PI * 2)
  ctx.fill()
}

export function drawFactorySprite(ctx: CanvasRenderingContext2D, x: number, y: number, look: FactoryLook): void {
  ctx.drawImage(bodySprite(look.stage), x, y)
  ctx.save()
  ctx.translate(x, y)
  paintAssembly(ctx, look.owner, look.kind, look.progress, look.time, look.color)
  paintArms(ctx, look.color, look.time, look.busy && look.built > 0.999)
  paintDoor(ctx, look.built > 0.999 ? look.open : 0, look.color, look.time)
  paintSmoke(ctx, look.time, look.stage)
  ctx.restore()
}

/** Selection portrait and build-menu icon. Empty when there is no document, so smoke can call it. */
export function factoryPortraitUrl(owner: number): string {
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
  ctx.translate(4, 14)
  ctx.scale(0.68, 0.68)
  drawFactorySprite(ctx, 0, 0, {
    color: PLAYER_COLOR[owner] ?? '#5ec8ff',
    owner,
    open: 0,
    stage: 0,
    progress: 0.62,
    kind: 'pike',
    busy: true,
    time: 1.2,
    built: 1,
  })
  ctx.restore()
  const url = canvas.toDataURL()
  portraits.set(owner, url)
  return url
}
