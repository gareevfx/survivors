import type { Camera } from './camera'
import { hash2 } from './rng'
import { buildingCenter, buildingRect, playerKeep } from './state'
import { viewBuildingSeen, viewGroundShown, viewTileExplored, viewTileVisible, viewUnitSeen } from './vision'
import {
  BUILDING_STATS,
  MAP_H,
  MAP_PX_H,
  MAP_PX_W,
  MAP_W,
  PLAYER_COLOR,
  ROCK_HP,
  TILE,
  UNIT_STATS,
  type Building,
  type BuildingKind,
  type MatchState,
  type Unit,
} from './types'

export interface WorldOverlay {
  drag: { x: number; y: number; w: number; h: number } | null
  pointer: { x: number; y: number } | null
}

const GRASS = ['#66754c', '#6e7d52', '#5e6c46', '#758856', '#617048', '#6a784e']

export function buildTerrain(seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = MAP_PX_W
  canvas.height = MAP_PX_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const n = hash2(tx, ty, seed)
      const x = tx * TILE
      const y = ty * TILE
      ctx.fillStyle = GRASS[Math.floor(n * GRASS.length)] ?? GRASS[0]
      ctx.fillRect(x, y, TILE, TILE)
      if (n > 0.82) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)'
        ctx.fillRect(x + 6, y + 18, 4, 2)
      } else       if (n < 0.08) {
        ctx.fillStyle = 'rgba(30,40,18,0.18)'
        ctx.beginPath()
        ctx.ellipse(x + 16, y + 20, 5, 2, 0, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  ctx.strokeStyle = 'rgba(20, 24, 14, 0.45)'
  ctx.lineWidth = 4
  ctx.strokeRect(2, 2, MAP_PX_W - 4, MAP_PX_H - 4)
  return canvas
}

function drawTree(ctx: CanvasRenderingContext2D, tx: number, ty: number, seed: number): void {
  const x = tx * TILE + TILE / 2
  const y = ty * TILE + TILE / 2
  const j = hash2(tx + 11, ty + 4, seed)
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.beginPath()
  ctx.ellipse(x + 1, y + 9, 11, 4.2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = j > 0.5 ? '#6b4423' : '#8a5a32'
  ctx.fillRect(x - 2.2, y + 1, 4.4, 11)
  ctx.fillStyle = j > 0.45 ? '#6d4a28' : '#3f6b32'
  ctx.beginPath()
  ctx.arc(x + 4, y - 1, 7.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = j > 0.5 ? '#3c8f38' : '#4ea24a'
  ctx.beginPath()
  ctx.arc(x - 2, y - 5, 9.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = j > 0.6 ? '#8d6230' : '#d2e07a'
  ctx.beginPath()
  ctx.arc(x - 5, y - 8, 3.1, 0, Math.PI * 2)
  ctx.fill()
}

function drawRock(ctx: CanvasRenderingContext2D, tx: number, ty: number, seed: number): void {
  const x = tx * TILE + TILE / 2
  const y = ty * TILE + TILE / 2
  const j = hash2(tx + 3, ty + 9, seed)
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.beginPath()
  ctx.ellipse(x + 2, y + 6, 11, 5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = j > 0.5 ? '#534e46' : '#5c574e'
  ctx.beginPath()
  ctx.moveTo(x - 11, y + 3)
  ctx.lineTo(x - 5, y - 9)
  ctx.lineTo(x + 3, y - 11)
  ctx.lineTo(x + 11, y - 2)
  ctx.lineTo(x + 6, y + 8)
  ctx.lineTo(x - 7, y + 8)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.beginPath()
  ctx.arc(x - 2, y - 4, 3.2, 0, Math.PI * 2)
  ctx.fill()
}

export function renderWorld(
  canvas: HTMLCanvasElement,
  state: MatchState,
  terrain: HTMLCanvasElement,
  cam: Camera,
  overlay: WorldOverlay,
): { viewW: number; viewH: number } {
  const rect = canvas.getBoundingClientRect()
  const viewW = Math.max(1, rect.width)
  const viewH = Math.max(1, rect.height)
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const bw = Math.round(viewW * dpr)
  const bh = Math.round(viewH * dpr)
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw
    canvas.height = bh
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return { viewW, viewH }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#12160f'
  ctx.fillRect(0, 0, viewW, viewH)

  ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.x * cam.zoom * dpr, -cam.y * cam.zoom * dpr)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(terrain, 0, 0)

  const view = {
    l: cam.x - 48,
    t: cam.y - 48,
    r: cam.x + viewW / cam.zoom + 48,
    b: cam.y + viewH / cam.zoom + 48,
  }

  for (const rock of state.rocks) {
    if (rock.hp <= 0) continue
    if (!viewGroundShown(state, rock.tx, rock.ty)) continue
    const x = (rock.tx + 0.5) * TILE
    const y = (rock.ty + 0.5) * TILE
    if (x < view.l || y < view.t || x > view.r || y > view.b) continue
    if (rock.kind === 'tree') drawTree(ctx, rock.tx, rock.ty, state.seed)
    else drawRock(ctx, rock.tx, rock.ty, state.seed)
    if (rock.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.7, rock.hitFlash * 2.4)})`
      ctx.beginPath()
      ctx.arc(x, y - 1, 10, 0, Math.PI * 2)
      ctx.fill()
    }
    if (rock.hp < ROCK_HP) {
      bar(ctx, rock.tx * TILE + 4, rock.ty * TILE - 2, TILE - 8, rock.hp / ROCK_HP, hpColor(rock.hp / ROCK_HP))
    }
  }

  for (const node of state.ore) {
    if (!viewGroundShown(state, node.tx, node.ty)) continue
    const x = (node.tx + 0.5) * TILE
    const y = (node.ty + 0.5) * TILE
    if (x < view.l || y < view.t || x > view.r || y > view.b) continue
    drawOre(ctx, x, y, state.selectedOre === node.id)
  }

  if (state.tutorial) drawOreHint(ctx, state)

  const buildings = state.buildings.slice().sort((a, b) => a.ty - b.ty)
  for (const building of buildings) {
    if (!viewBuildingSeen(state, building)) continue
    const rect = buildingRect(building)
    if (rect.x > view.r || rect.y > view.b || rect.x + rect.w < view.l || rect.y + rect.h < view.t) continue
    drawBuilding(ctx, state, building)
  }

  for (const ping of state.pings) drawPing(ctx, ping.x, ping.y, ping.life / ping.max, ping.color)

  const selected = new Set(state.selectedUnits)
  const units = state.units.slice().sort((a, b) => a.y - b.y)
  for (const unit of units) {
    if (!viewUnitSeen(state, unit)) continue
    if (unit.x < view.l || unit.y < view.t || unit.x > view.r || unit.y > view.b) continue
    if (selected.has(unit.id)) drawOrderLine(ctx, unit)
    drawUnit(ctx, state, unit, selected.has(unit.id))
  }

  const viewer = state.bothCam ? -1 : state.enemyCam ? 1 : 0
  for (const shot of state.projectiles) {
    if (shot.owner !== viewer && !viewTileVisible(state, Math.floor(shot.x / TILE), Math.floor(shot.y / TILE))) continue
    ctx.fillStyle = shot.owner === 0 ? '#e9f7ff' : '#ffd2c8'
    ctx.beginPath()
    ctx.arc(shot.x, shot.y, shot.radius, 0, Math.PI * 2)
    ctx.fill()
  }

  for (const particle of state.particles) {
    if (!viewTileVisible(state, Math.floor(particle.x / TILE), Math.floor(particle.y / TILE))) continue
    const alpha = Math.max(0, particle.life / particle.max)
    ctx.globalAlpha = alpha
    if (particle.text) {
      ctx.font = 'bold 14px "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.lineWidth = 3
      ctx.strokeStyle = '#1a1408'
      ctx.strokeText(particle.text, particle.x, particle.y)
      ctx.fillStyle = particle.color
      ctx.fillText(particle.text, particle.x, particle.y)
    } else {
      ctx.fillStyle = particle.color
      ctx.beginPath()
      ctx.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  drawFog(ctx, state, view)
  if (state.bothCam) drawBothSight(ctx, state, view)

  if (state.placement && overlay.pointer) {
    const stats = BUILDING_STATS[state.placement]
    const tx = Math.floor(overlay.pointer.x / TILE)
    const ty = Math.floor(overlay.pointer.y / TILE)
    drawPlacement(ctx, state, state.placement, tx, ty, stats.w, stats.h)
  }

  const rally = state.selectedBuilding != null ? state.buildings.find((b) => b.id === state.selectedBuilding) : undefined
  if (rally && rally.owner === 0 && viewBuildingSeen(state, rally)) {
    ctx.strokeStyle = 'rgba(159, 216, 255, 0.8)'
    ctx.fillStyle = '#9fd8ff'
    ctx.beginPath()
    ctx.moveTo(rally.rallyX, rally.rallyY)
    ctx.lineTo(rally.rallyX, rally.rallyY - 14)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(rally.rallyX, rally.rallyY - 14)
    ctx.lineTo(rally.rallyX + 8, rally.rallyY - 10)
    ctx.lineTo(rally.rallyX, rally.rallyY - 6)
    ctx.fill()
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (overlay.drag && overlay.drag.w !== 0 && overlay.drag.h !== 0) {
    ctx.fillStyle = 'rgba(215, 240, 138, 0.14)'
    ctx.strokeStyle = 'rgba(232, 240, 196, 0.95)'
    ctx.lineWidth = 1
    ctx.fillRect(overlay.drag.x, overlay.drag.y, overlay.drag.w, overlay.drag.h)
    ctx.strokeRect(overlay.drag.x, overlay.drag.y, overlay.drag.w, overlay.drag.h)
  }
  return { viewW, viewH }
}

/** Faint rings so Both cam shows which side is lighting the ground. */
function drawBothSight(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  view: { l: number; t: number; r: number; b: number },
): void {
  ctx.save()
  ctx.lineWidth = 1.25
  ctx.setLineDash([5, 7])
  const sources: Array<{ x: number; y: number; radius: number; owner: 0 | 1 }> = []
  for (const unit of state.units) {
    if (unit.hp <= 0) continue
    sources.push({ x: unit.x, y: unit.y, radius: UNIT_STATS[unit.kind].sight, owner: unit.owner })
  }
  for (const building of state.buildings) {
    if (building.hp <= 0) continue
    const stats = BUILDING_STATS[building.kind]
    sources.push({
      x: (building.tx + stats.w / 2) * TILE,
      y: (building.ty + stats.h / 2) * TILE,
      radius: stats.sight,
      owner: building.owner,
    })
  }
  for (const owner of [0, 1] as const) {
    ctx.strokeStyle = owner === 0 ? 'rgba(94, 200, 255, 0.28)' : 'rgba(255, 93, 78, 0.28)'
    for (const source of sources) {
      if (source.owner !== owner) continue
      if (source.x + source.radius < view.l || source.x - source.radius > view.r) continue
      if (source.y + source.radius < view.t || source.y - source.radius > view.b) continue
      ctx.beginPath()
      ctx.arc(source.x, source.y, source.radius, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.restore()
}

function drawFog(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  view: { l: number; t: number; r: number; b: number },
): void {
  const x0 = Math.max(0, Math.floor(view.l / TILE))
  const y0 = Math.max(0, Math.floor(view.t / TILE))
  const x1 = Math.min(MAP_W - 1, Math.floor(view.r / TILE))
  const y1 = Math.min(MAP_H - 1, Math.floor(view.b / TILE))
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (viewTileVisible(state, tx, ty)) continue
      ctx.fillStyle = viewTileExplored(state, tx, ty) ? 'rgba(6, 8, 6, 0.58)' : '#070806'
      ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE)
    }
  }
}

function drawOre(ctx: CanvasRenderingContext2D, x: number, y: number, selected = false): void {
  if (selected) {
    ctx.save()
    ctx.strokeStyle = 'rgba(244, 241, 196, 0.95)'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.ellipse(x, y + 4, 16, 9, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  const crystals: Array<[number, number, number, string]> = [
    [0, -6, 7, '#f0c857'],
    [-7, 4, 5.5, '#d9a63a'],
    [6, 5, 6, '#e8b84a'],
  ]
  for (const [ox, oy, r, color] of crystals) {
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3
      const px = x + ox + Math.cos(a) * r
      const py = y + oy + Math.sin(a) * r * 0.82
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = '#7a5414'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(255, 244, 210, 0.9)'
  ctx.beginPath()
  ctx.arc(x - 1, y - 8, 1.7, 0, Math.PI * 2)
  ctx.fill()
}

function drawOreHint(ctx: CanvasRenderingContext2D, state: MatchState): void {
  const keep = playerKeep(state)
  if (!keep) return
  const origin = buildingCenter(keep)
  let best: { x: number; y: number; d: number } | null = null
  for (const node of state.ore) {
    if (!viewGroundShown(state, node.tx, node.ty)) continue
    const x = (node.tx + 0.5) * TILE
    const y = (node.ty + 0.5) * TILE
    const d = (x - origin.x) ** 2 + (y - origin.y) ** 2
    if (!best || d < best.d) best = { x, y, d }
  }
  if (!best) return
  ctx.save()
  ctx.fillStyle = '#f6e7b0'
  ctx.font = '12px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.fillText('Right-click minerals', best.x, best.y - 20)
  ctx.restore()
}

function drawPlacement(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  kind: BuildingKind,
  tx: number,
  ty: number,
  w: number,
  h: number,
): void {
  let open = tx >= 0 && ty >= 0 && tx + w <= MAP_W && ty + h <= MAP_H
  if (open) {
    for (let y = 0; y < h && open; y++) {
      for (let x = 0; x < w; x++) {
        if (state.blocked[(ty + y) * MAP_W + (tx + x)]) {
          open = false
          break
        }
      }
    }
  }
  ctx.save()
  ctx.globalAlpha = 0.85
  ctx.fillStyle = open ? 'rgba(120, 180, 90, 0.35)' : 'rgba(180, 64, 48, 0.35)'
  ctx.strokeStyle = open ? '#d7f08a' : '#ff8d7a'
  ctx.lineWidth = 2
  ctx.fillRect(tx * TILE, ty * TILE, w * TILE, h * TILE)
  ctx.strokeRect(tx * TILE + 1, ty * TILE + 1, w * TILE - 2, h * TILE - 2)
  ctx.fillStyle = '#f4f1e4'
  ctx.font = '12px "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(BUILDING_STATS[kind].label, (tx + w / 2) * TILE, ty * TILE - 6)
  ctx.restore()
}

function drawBuilding(ctx: CanvasRenderingContext2D, state: MatchState, building: Building): void {
  const stats = BUILDING_STATS[building.kind]
  const x = building.tx * TILE
  const y = building.ty * TILE
  const w = stats.w * TILE
  const h = stats.h * TILE
  const color = PLAYER_COLOR[building.owner]
  const selected = state.selectedBuilding === building.id
  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.beginPath()
  ctx.ellipse(x + w / 2 + 2, y + h / 2 + 8, w * 0.38, 8, 0, 0, Math.PI * 2)
  ctx.fill()
  if (!building.complete) ctx.globalAlpha = 0.45 + building.progress * 0.5

  if (building.kind === 'keep') drawKeep(ctx, x, y, w, h, color)
  else if (building.kind === 'yard') drawYard(ctx, x, y, w, h, color, state.time)
  else drawSilo(ctx, x, y, w, h, color)

  if (building.hp < stats.hp) {
    ctx.strokeStyle = 'rgba(40, 24, 18, 0.45)'
    ctx.beginPath()
    ctx.moveTo(x + w * 0.3, y + 10)
    ctx.lineTo(x + w * 0.55, y + h * 0.6)
    ctx.lineTo(x + w * 0.7, y + h - 8)
    ctx.stroke()
  }
  ctx.restore()

  if (!building.complete) {
    bar(ctx, x + 8, y - 8, w - 16, building.progress, '#e6c15a')
    ctx.fillStyle = '#f4e7bf'
    ctx.font = '10px "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    const crew = state.units.some(
      (unit) => unit.order?.type === 'construct' && unit.order.buildingId === building.id && unit.hp > 0,
    )
    ctx.fillText(crew ? 'Raising' : 'Paused', x + w / 2, y - 12)
  } else if (selected || building.hp < stats.hp || building.hitFlash > 0) {
    bar(ctx, x + 8, y - 7, w - 16, building.hp / stats.hp, hpColor(building.hp / stats.hp))
  }

  if (selected) {
    ctx.strokeStyle = 'rgba(244, 241, 196, 0.95)'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
  }
  if (building.hitFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${building.hitFlash * 2.2})`
    ctx.fillRect(x, y, w, h)
  }
}

function drawKeep(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = '#6a655c'
  roundRect(ctx, x + 8, y + 10, w - 16, h - 16, 5)
  ctx.fill()
  ctx.fillStyle = '#3f4a38'
  ctx.fillRect(x + 24, y + 26, w - 48, h - 48)
  const towers = [
    [x + 12, y + 12],
    [x + w - 30, y + 12],
    [x + 12, y + h - 30],
    [x + w - 30, y + h - 30],
  ]
  for (const [tx, ty] of towers) {
    ctx.fillStyle = '#7a756b'
    ctx.beginPath()
    ctx.arc(tx + 9, ty + 9, 11, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#2e2b26'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(tx + 9, ty + 9, 11, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = color
    ctx.fillRect(tx + 8, ty - 4, 2, 8)
    ctx.beginPath()
    ctx.moveTo(tx + 10, ty - 4)
    ctx.lineTo(tx + 20, ty)
    ctx.lineTo(tx + 10, ty + 4)
    ctx.fill()
  }
  ctx.fillStyle = '#241f1b'
  ctx.fillRect(x + w / 2 - 7, y + h - 24, 14, 12)
}

function drawYard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  time: number,
): void {
  ctx.fillStyle = '#5c5348'
  ctx.fillRect(x + 8, y + 18, w - 16, h - 26)
  ctx.fillStyle = '#3e3832'
  ctx.beginPath()
  ctx.moveTo(x + 4, y + 20)
  ctx.lineTo(x + w / 2, y + 4)
  ctx.lineTo(x + w - 4, y + 20)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = color
  ctx.fillRect(x + w - 22, y + 8, 8, 6)
  ctx.fillStyle = '#2a2622'
  ctx.fillRect(x + 18, y + h - 22, 16, 14)
  ctx.fillRect(x + w - 36, y + h - 22, 16, 14)
  ctx.fillStyle = 'rgba(220,220,220,0.35)'
  const puff = (time * 10) % 14
  ctx.beginPath()
  ctx.arc(x + w - 18, y + 4 - puff, 3 + puff * 0.15, 0, Math.PI * 2)
  ctx.fill()
}

function drawSilo(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = '#6d6458'
  ctx.beginPath()
  ctx.ellipse(x + w / 2, y + h - 14, w * 0.34, 8, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillRect(x + w * 0.2, y + 16, w * 0.6, h - 32)
  ctx.fillStyle = '#857b6d'
  ctx.beginPath()
  ctx.ellipse(x + w / 2, y + 16, w * 0.3, 8, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(40, 32, 24, 0.35)'
  ctx.beginPath()
  ctx.moveTo(x + w * 0.2, y + h * 0.45)
  ctx.lineTo(x + w * 0.8, y + h * 0.45)
  ctx.moveTo(x + w * 0.2, y + h * 0.62)
  ctx.lineTo(x + w * 0.8, y + h * 0.62)
  ctx.stroke()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x + w / 2, y + 4)
  ctx.lineTo(x + w / 2 + 8, y + 10)
  ctx.lineTo(x + w / 2, y + 16)
  ctx.fill()
}

function drawUnit(ctx: CanvasRenderingContext2D, state: MatchState, unit: Unit, selected: boolean): void {
  const stats = UNIT_STATS[unit.kind]
  const body = unit.owner === 0 ? '#6ecfff' : '#ff6d5e'
  const ink = unit.owner === 0 ? '#14384c' : '#4c1814'
  const bob = unit.goalX != null ? Math.sin(unit.anim) * 1.1 : 0

  if (selected || (state.tutorial && unit.owner === 0 && unit.kind === 'porter')) {
    const pulse = state.tutorial && !selected ? 0.45 + Math.sin(state.time * 4) * 0.2 : 0.9
    ctx.save()
    ctx.strokeStyle = selected ? `rgba(244, 241, 196, ${pulse})` : `rgba(230, 193, 90, ${pulse})`
    ctx.lineWidth = selected ? 1.6 : 1.2
    ctx.beginPath()
    ctx.ellipse(unit.x, unit.y + 3, stats.radius + 5, stats.radius * 0.62, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  ctx.save()
  ctx.translate(unit.x, unit.y + bob)
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.beginPath()
  const lift = unit.kind === 'drone' ? 10 : 5
  ctx.ellipse(1, lift, stats.radius * 0.85, stats.radius * 0.4, 0, 0, Math.PI * 2)
  ctx.fill()
  if (unit.kind === 'drone') ctx.translate(0, -8)
  ctx.rotate(unit.facing)

  if (unit.kind === 'porter') {
    ctx.fillStyle = ink
    ctx.fillRect(-8, -4, 6, 7)
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.arc(1, 0, 7.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = ink
    ctx.lineWidth = 1.4
    ctx.stroke()
    if (unit.cargo > 0) {
      ctx.fillStyle = '#f0c857'
      ctx.fillRect(3, -4, 5, 5)
    }
  } else if (unit.kind === 'pike') {
    ctx.strokeStyle = '#efe6cf'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(4, 0)
    ctx.lineTo(16, 0)
    ctx.stroke()
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.moveTo(10, 0)
    ctx.lineTo(-8, -7)
    ctx.lineTo(-5, 0)
    ctx.lineTo(-8, 7)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = ink
    ctx.lineWidth = 1.3
    ctx.stroke()
  } else if (unit.kind === 'drone') {
    ctx.strokeStyle = body
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(-12, 0)
    ctx.lineTo(12, 0)
    ctx.moveTo(0, -7)
    ctx.lineTo(0, 7)
    ctx.stroke()
    ctx.fillStyle = '#d7f08a'
    ctx.beginPath()
    ctx.moveTo(7, 0)
    ctx.lineTo(0, -4.5)
    ctx.lineTo(-7, 0)
    ctx.lineTo(0, 4.5)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = ink
    ctx.lineWidth = 1.3
    ctx.stroke()
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.arc(0, 0, 1.7, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.fillStyle = body
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3
      const px = Math.cos(a) * 8
      const py = Math.sin(a) * 7
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = ink
    ctx.lineWidth = 1.4
    ctx.stroke()
    ctx.fillStyle = ink
    ctx.fillRect(4, -2.2, 12, 4.4)
    ctx.fillStyle = '#efe6cf'
    ctx.fillRect(14, -1.4, 3, 2.8)
  }

  if (unit.hitFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, unit.hitFlash * 3)})`
    ctx.beginPath()
    ctx.arc(0, 0, stats.radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  const showHp = selected || unit.hp < stats.hp - 0.5 || unit.hitFlash > 0
  if (showHp) bar(ctx, unit.x - 12, unit.y - stats.radius - 10, 24, unit.hp / stats.hp, hpColor(unit.hp / stats.hp))

  if (unit.owner === 0 && unit.kind === 'porter' && !unit.order) {
    ctx.fillStyle = '#f0c857'
    ctx.beginPath()
    ctx.moveTo(unit.x, unit.y - 16)
    ctx.lineTo(unit.x + 3.5, unit.y - 12)
    ctx.lineTo(unit.x, unit.y - 8)
    ctx.lineTo(unit.x - 3.5, unit.y - 12)
    ctx.fill()
  }
}

function drawOrderLine(ctx: CanvasRenderingContext2D, unit: Unit): void {
  if (!unit.path.length && unit.goalX == null) return
  ctx.save()
  ctx.strokeStyle = 'rgba(244, 241, 196, 0.45)'
  ctx.lineWidth = 1
  ctx.setLineDash([3, 4])
  ctx.beginPath()
  ctx.moveTo(unit.x, unit.y)
  for (const point of unit.path) ctx.lineTo(point.x, point.y)
  if (unit.goalX != null && unit.goalY != null) ctx.lineTo(unit.goalX, unit.goalY)
  ctx.stroke()
  ctx.restore()
}

function drawPing(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, color: string): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.globalAlpha = Math.max(0, k)
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x, y, 6 + (1 - k) * 16, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, ratio: number, fill: string): void {
  const r = Math.max(0, Math.min(1, ratio))
  ctx.fillStyle = 'rgba(0,0,0,0.65)'
  ctx.fillRect(x, y, w, 4)
  ctx.fillStyle = fill
  ctx.fillRect(x + 0.5, y + 0.5, Math.max(0, (w - 1) * r), 3)
}

function hpColor(ratio: number): string {
  if (ratio > 0.55) return '#8ed15a'
  if (ratio > 0.28) return '#e6c15a'
  return '#e25b4a'
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Fit the 16:9 map inside the minimap element without stretching it. */
export function minimapFrame(cssW: number, cssH: number): { x: number; y: number; w: number; h: number } {
  const aspect = MAP_W / MAP_H
  const box = cssW / Math.max(1, cssH)
  if (box > aspect) {
    const w = cssH * aspect
    return { x: (cssW - w) / 2, y: 0, w, h: cssH }
  }
  const h = cssW / aspect
  return { x: 0, y: (cssH - h) / 2, w: cssW, h }
}

export function renderMinimap(
  canvas: HTMLCanvasElement,
  state: MatchState,
  cam: Camera,
  viewW: number,
  viewH: number,
): void {
  const rect = canvas.getBoundingClientRect()
  const cssW = Math.max(1, rect.width)
  const cssH = Math.max(1, rect.height)
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const bw = Math.round(cssW * dpr)
  const bh = Math.round(cssH * dpr)
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw
    canvas.height = bh
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#070806'
  ctx.fillRect(0, 0, cssW, cssH)
  const frame = minimapFrame(cssW, cssH)
  const sx = frame.w / MAP_W
  const sy = frame.h / MAP_H
  const ox = frame.x
  const oy = frame.y
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (!viewTileExplored(state, tx, ty)) continue
      ctx.fillStyle = viewTileVisible(state, tx, ty) ? '#2a3324' : '#161b14'
      ctx.fillRect(ox + tx * sx, oy + ty * sy, sx, sy)
    }
  }
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (!viewTileExplored(state, tx, ty)) continue
      const tile = state.tiles[ty * MAP_W + tx]
      if (tile !== 1 && tile !== 3) continue
      ctx.fillStyle = tile === 3 ? '#3d9a45' : '#3a3832'
      ctx.fillRect(ox + tx * sx, oy + ty * sy, sx, sy)
    }
  }
  ctx.fillStyle = '#e6c15a'
  for (const node of state.ore) {
    if (!viewGroundShown(state, node.tx, node.ty)) continue
    ctx.fillRect(ox + node.tx * sx, oy + node.ty * sy, sx, sy)
  }
  for (const building of state.buildings) {
    if (!viewBuildingSeen(state, building)) continue
    const stats = BUILDING_STATS[building.kind]
    ctx.fillStyle = building.owner === 0 ? '#7ecfff' : '#ff7d70'
    ctx.globalAlpha = building.complete ? 1 : 0.55
    ctx.fillRect(ox + building.tx * sx, oy + building.ty * sy, stats.w * sx, stats.h * sy)
  }
  ctx.globalAlpha = 1
  for (const unit of state.units) {
    if (!viewUnitSeen(state, unit)) continue
    ctx.fillStyle = unit.owner === 0 ? '#d8f4ff' : '#ffd0c8'
    const px = ox + (unit.x / TILE) * sx
    const py = oy + (unit.y / TILE) * sy
    ctx.fillRect(px - 1, py - 1, 2.2, 2.2)
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (!viewTileExplored(state, tx, ty) || viewTileVisible(state, tx, ty)) continue
      ctx.fillRect(ox + tx * sx, oy + ty * sy, sx, sy)
    }
  }
  ctx.strokeStyle = '#f4f1c4'
  ctx.lineWidth = 1
  ctx.strokeRect(
    ox + (cam.x / TILE) * sx,
    oy + (cam.y / TILE) * sy,
    (viewW / cam.zoom / TILE) * sx,
    (viewH / cam.zoom / TILE) * sy,
  )
}
