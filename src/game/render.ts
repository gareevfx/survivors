import type { Camera } from './camera'
import { buildingCenter, buildingRect, getTarget, placementAllowed, playerKeep } from './state'
import { flasherSprite } from './flasherArt'
import { gorillaSprite } from './gorillaArt'
import { hoverCameraPoint, hoverSprite, paintHoverRotors } from './hoverArt'
import { facingBasis, facingDir, stalkerSprite } from './stalkerArt'
import { drawFactorySprite, factoryDamageStage } from './factoryArt'
import { drawKeepSprite, keepDamageStage, keepWindowCount } from './siloArt'
import { drawPillarSprite, pillarDamageStage } from './pillarArt'
import { drawStorageSprite, storageDamageStage, storageFill } from './storageArt'
import { drawOreSprite, drawRockSprite, drawTreeSprite, fogSprite, paintTerrain, terrainCss } from './terrainArt'
import { viewBuildingSeen, viewGroundShown, viewTileExplored, viewTileVisible, viewUnitSeen } from './vision'
import {
  BUILDING_STATS,
  MAP_H,
  MAP_W,
  ORE_NODE_AMOUNT,
  PLAYER_COLOR,
  ROCK_HP,
  TILE,
  TREE_HP,
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

function teamColor(owner: number, first: string, second: string, third: string, fourth: string): string {
  if (owner === 0) return first
  if (owner === 1) return second
  if (owner === 2) return third
  return fourth
}

function teamRgba(owner: number, alpha: number): string {
  const hex = PLAYER_COLOR[owner] ?? '#ffffff'
  const value = Number.parseInt(hex.slice(1), 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function buildTerrain(seed: number, mapW = MAP_W, mapH = MAP_H, ffa = false): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = mapW * TILE
  canvas.height = mapH * TILE
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  paintTerrain(ctx, seed, mapW, mapH, ffa)
  return canvas
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
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(terrain, 0, 0)
  ctx.imageSmoothingEnabled = false

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
    if (rock.kind === 'tree') drawTreeSprite(ctx, rock.tx, rock.ty, state.seed)
    else drawRockSprite(ctx, rock.tx, rock.ty, state.seed)
    if (rock.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.7, rock.hitFlash * 2.4)})`
      ctx.beginPath()
      ctx.arc(x, y - 1, 10, 0, Math.PI * 2)
      ctx.fill()
    }
    const full = rock.kind === 'tree' ? TREE_HP : ROCK_HP
    if (rock.hp < full) {
      bar(ctx, rock.tx * TILE + 4, rock.ty * TILE - 2, TILE - 8, rock.hp / full, hpColor(rock.hp / full))
    }
  }

  for (const node of state.ore) {
    if (!viewGroundShown(state, node.tx, node.ty)) continue
    const x = (node.tx + 0.5) * TILE
    const y = (node.ty + 0.5) * TILE
    if (x < view.l || y < view.t || x > view.r || y > view.b) continue
    drawOreSprite(ctx, node.tx, node.ty, state.seed, state.selectedOre === node.id, node.amount, ORE_NODE_AMOUNT)
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
    ctx.fillStyle = teamColor(shot.owner, '#e9f7ff', '#ffd2c8', '#e5ffe2', '#f0e6ff')
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
    if (state.placement === 'tower') drawKeepSight(ctx, state)
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
  const sources: Array<{ x: number; y: number; radius: number; owner: number }> = []
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
  for (let owner = 0; owner < state.playerCount; owner++) {
    ctx.strokeStyle = teamRgba(owner, 0.28)
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

function fogSide(state: MatchState, tx: number, ty: number, black: boolean): number {
  if (tx < 0 || ty < 0 || tx >= state.mapW || ty >= state.mapH) return 0
  if (viewTileVisible(state, tx, ty)) return 2
  if (black && viewTileExplored(state, tx, ty)) return 1
  return 0
}

function drawFog(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  view: { l: number; t: number; r: number; b: number },
): void {
  const x0 = Math.max(0, Math.floor(view.l / TILE))
  const y0 = Math.max(0, Math.floor(view.t / TILE))
  const x1 = Math.min(state.mapW - 1, Math.floor(view.r / TILE))
  const y1 = Math.min(state.mapH - 1, Math.floor(view.b / TILE))
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (viewTileVisible(state, tx, ty)) continue
      const black = !viewTileExplored(state, tx, ty)
      const stamp = fogSprite(
        black ? 'black' : 'shroud',
        fogSide(state, tx, ty - 1, black),
        fogSide(state, tx + 1, ty, black),
        fogSide(state, tx, ty + 1, black),
        fogSide(state, tx - 1, ty, black),
      )
      ctx.drawImage(stamp, tx * TILE, ty * TILE)
    }
  }
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
  ctx.fillText('Right-click dumps', best.x, best.y - 34)
  ctx.restore()
}

function drawKeepSight(ctx: CanvasRenderingContext2D, state: MatchState): void {
  const keep = playerKeep(state)
  if (!keep) return
  const center = buildingCenter(keep)
  ctx.save()
  ctx.strokeStyle = 'rgba(94, 200, 255, 0.7)'
  ctx.fillStyle = 'rgba(94, 200, 255, 0.06)'
  ctx.lineWidth = 2
  ctx.setLineDash([8, 6])
  ctx.beginPath()
  ctx.arc(center.x, center.y, BUILDING_STATS.keep.sight, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
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
  const open = placementAllowed(state, 0, kind, tx, ty)
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
  const color = PLAYER_COLOR[building.owner] ?? PLAYER_COLOR[0]
  const selected = state.selectedBuilding === building.id
  ctx.save()
  if (building.kind !== 'keep' && building.kind !== 'yard' && building.kind !== 'silo' && building.kind !== 'tower') {
    ctx.fillStyle = 'rgba(16, 12, 8, 0.2)'
    ctx.beginPath()
    ctx.ellipse(x + w * 0.58, y + h * 0.7, w * 0.42, h * 0.14, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(16, 12, 8, 0.28)'
    ctx.beginPath()
    ctx.ellipse(x + w * 0.52 + 4, y + h * 0.78, w * 0.3, 5.5, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  if (!building.complete) ctx.globalAlpha = 0.45 + building.progress * 0.5

  if (building.kind === 'keep') drawKeep(ctx, state, building, x, y, color)
  else if (building.kind === 'yard') drawYard(ctx, state, building, x, y, color)
  else if (building.kind === 'tower') drawTower(ctx, state, building, x, y, color)
  else drawStorage(ctx, state, building, x, y, color)

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

function drawKeep(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  building: Building,
  x: number,
  y: number,
  color: string,
): void {
  const stats = BUILDING_STATS.keep
  const job = building.queue[0]
  const progress = job && job.total > 0 ? Math.max(0, Math.min(1, 1 - job.remaining / job.total)) : -1
  const open = building.hatch > 0.28 ? 1 : Math.max(0, building.hatch / 0.28)
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  drawKeepSprite(ctx, x, y, {
    color,
    open,
    lit: keepWindowCount(state.oreHeld[building.owner] ?? 0),
    stage: keepDamageStage(building.hp, stats.hp),
    dish: building.dish,
    progress,
    smoke: state.time,
  })
  ctx.restore()
  ctx.imageSmoothingEnabled = false
}

function drawYard(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  building: Building,
  x: number,
  y: number,
  color: string,
): void {
  const stats = BUILDING_STATS.yard
  const job = building.queue[0]
  const producing = building.complete && job != null
  const progress = job && job.total > 0 ? Math.max(0, Math.min(1, 1 - job.remaining / job.total)) : -1
  const open = building.hatch > 0.28 ? 1 : Math.max(0, building.hatch / 0.28)
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  drawFactorySprite(ctx, x, y, {
    color,
    owner: building.owner,
    open,
    stage: factoryDamageStage(building.hp, stats.hp),
    progress,
    kind: producing && job ? job.kind : null,
    busy: producing && building.hatch < 0.05,
    time: state.time,
    built: building.complete ? 1 : building.progress,
  })
  ctx.restore()
  ctx.imageSmoothingEnabled = false
}

function drawTower(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  building: Building,
  x: number,
  y: number,
  color: string,
): void {
  const stats = BUILDING_STATS.tower
  const origin = buildingCenter(building)
  let aim = Math.PI / 2
  if (building.focusId != null && (building.focusKind === 'unit' || building.focusKind === 'building')) {
    const target = getTarget(state, building.focusId, building.focusKind)
    if (target) aim = Math.atan2(target.y - origin.y, target.x - origin.x)
  }
  const cool = UNIT_STATS.pike.cooldown
  const flash = building.complete && building.attackCd > cool - 0.18
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  drawPillarSprite(ctx, x, y, {
    color,
    stage: pillarDamageStage(building.hp, stats.hp),
    spin: building.complete ? state.time * 2.6 : 0.4,
    aim,
    flash,
  })
  ctx.restore()
  ctx.imageSmoothingEnabled = false
}

function drawStorage(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  building: Building,
  x: number,
  y: number,
  color: string,
): void {
  const stats = BUILDING_STATS.silo
  const cap = state.supplyCap[building.owner] ?? 0
  const fill = building.complete ? storageFill(cap) : 0
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  drawStorageSprite(ctx, x, y, color, fill, storageDamageStage(building.hp, stats.hp))
  ctx.restore()
  ctx.imageSmoothingEnabled = false
}

function drawUnit(ctx: CanvasRenderingContext2D, state: MatchState, unit: Unit, selected: boolean): void {
  const stats = UNIT_STATS[unit.kind]
  const bob =
    unit.kind === 'drone'
      ? Math.sin(state.time * 3.1 + unit.id * 0.7) * 1.15
      : unit.goalX != null
        ? Math.sin(unit.anim) * 1.1
        : 0

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
  if (unit.kind === 'porter') {
    ctx.fillStyle = 'rgba(16, 12, 8, 0.34)'
    ctx.beginPath()
    ctx.ellipse(2, 8, 12, 4.2, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.drawImage(stalkerSprite(unit), -26, -30)
    if (unit.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, unit.hitFlash * 3)})`
      ctx.beginPath()
      ctx.arc(0, 0, stats.radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  } else if (unit.kind === 'pike') {
    ctx.fillStyle = 'rgba(16, 12, 8, 0.34)'
    ctx.beginPath()
    ctx.ellipse(2, 8, 14, 4.6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.drawImage(flasherSprite(unit), -32, -34)
    if (unit.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, unit.hitFlash * 3)})`
      ctx.beginPath()
      ctx.arc(0, 0, stats.radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  } else if (unit.kind === 'howler') {
    ctx.fillStyle = 'rgba(16, 12, 8, 0.36)'
    ctx.beginPath()
    ctx.ellipse(2, 9, 16, 5.2, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.drawImage(gorillaSprite(unit), -36, -38)
    if (unit.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, unit.hitFlash * 3)})`
      ctx.beginPath()
      ctx.arc(0, 0, stats.radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  } else if (unit.kind === 'drone') {
    const dir = facingDir(unit.facing)
    const { fx, fy } = facingBasis(dir)
    const accent = teamColor(unit.owner, '#5ec8ff', '#ff5d4e', '#7dff6a', '#c58bff')
    ctx.fillStyle = 'rgba(16, 12, 8, 0.28)'
    ctx.beginPath()
    ctx.ellipse(2, 12, 8.5, 3.1, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.translate(0, -6)
    if (unit.goalX != null) {
      ctx.translate(fx * 1.2, fy * 0.35)
      ctx.rotate(fx * 0.16)
    }
    const sway = Math.floor(state.time * 2.4 + unit.id) % 2
    ctx.drawImage(hoverSprite(unit, sway), -28, -30)
    paintHoverRotors(ctx, dir, state.time * 9, accent)
    if (unit.scanning) {
      const cam = hoverCameraPoint(dir)
      ctx.strokeStyle = accent
      ctx.globalAlpha = 0.5 + Math.sin(state.time * 6) * 0.15
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cam.x, cam.y, 2.7, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    if (unit.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, unit.hitFlash * 3)})`
      ctx.beginPath()
      ctx.arc(0, 0, stats.radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

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

/** Fit the map inside the minimap element without stretching it. */
export function minimapFrame(
  cssW: number,
  cssH: number,
  mapW = MAP_W,
  mapH = MAP_H,
): { x: number; y: number; w: number; h: number } {
  const aspect = mapW / mapH
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
  const frame = minimapFrame(cssW, cssH, state.mapW, state.mapH)
  const sx = frame.w / state.mapW
  const sy = frame.h / state.mapH
  const ox = frame.x
  const oy = frame.y
  for (let ty = 0; ty < state.mapH; ty++) {
    for (let tx = 0; tx < state.mapW; tx++) {
      if (!viewTileExplored(state, tx, ty)) continue
      ctx.fillStyle = viewTileVisible(state, tx, ty)
        ? terrainCss(tx, ty, state.seed, state.mapW, state.mapH, state.mode === 'ffa')
        : '#12100c'
      ctx.fillRect(ox + tx * sx, oy + ty * sy, sx, sy)
    }
  }
  for (let ty = 0; ty < state.mapH; ty++) {
    for (let tx = 0; tx < state.mapW; tx++) {
      if (!viewTileExplored(state, tx, ty)) continue
      const tile = state.tiles[ty * state.mapW + tx]
      if (tile !== 1 && tile !== 3) continue
      ctx.fillStyle = tile === 3 ? '#3c6a34' : '#4a4338'
      ctx.fillRect(ox + tx * sx, oy + ty * sy, sx, sy)
    }
  }
  ctx.fillStyle = '#d4894a'
  for (const node of state.ore) {
    if (!viewGroundShown(state, node.tx, node.ty)) continue
    ctx.fillRect(ox + node.tx * sx, oy + node.ty * sy, sx, sy)
  }
  for (const building of state.buildings) {
    if (!viewBuildingSeen(state, building)) continue
    const stats = BUILDING_STATS[building.kind]
    ctx.globalAlpha = building.complete ? 1 : 0.55
    if (building.kind === 'keep') {
      ctx.fillStyle = '#c8c2b4'
      ctx.fillRect(ox + building.tx * sx, oy + building.ty * sy, stats.w * sx, stats.h * sy)
      ctx.fillStyle = teamColor(building.owner, '#7ecfff', '#ff7d70', '#9dff90', '#d7b6ff')
      ctx.fillRect(ox + (building.tx + stats.w - 1) * sx, oy + building.ty * sy, sx, Math.max(1, sy))
    } else if (building.kind === 'yard') {
      ctx.fillStyle = '#aeb4bc'
      ctx.fillRect(ox + building.tx * sx, oy + building.ty * sy, stats.w * sx, stats.h * sy)
      ctx.fillStyle = '#2c3136'
      const inset = Math.max(0.6, Math.min(sx, sy) * 0.35)
      ctx.fillRect(
        ox + building.tx * sx + inset,
        oy + building.ty * sy + inset,
        stats.w * sx - inset * 2,
        stats.h * sy - inset * 2,
      )
      ctx.fillStyle = teamColor(building.owner, '#7ecfff', '#ff7d70', '#9dff90', '#d7b6ff')
      ctx.fillRect(ox + building.tx * sx, oy + (building.ty + stats.h) * sy - Math.max(1, sy * 0.35), stats.w * sx, Math.max(1, sy * 0.35))
    } else if (building.kind === 'silo') {
      const cx = ox + (building.tx + stats.w / 2) * sx
      const cy = oy + (building.ty + stats.h / 2) * sy
      const radius = Math.min(stats.w * sx, stats.h * sy) * 0.42
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fillStyle = '#c8c2b4'
      ctx.fill()
      ctx.lineWidth = Math.max(1, radius * 0.28)
      ctx.strokeStyle = teamColor(building.owner, '#7ecfff', '#ff7d70', '#9dff90', '#d7b6ff')
      ctx.stroke()
    } else if (building.kind === 'tower') {
      const cx = ox + (building.tx + 0.5) * sx
      const cy = oy + (building.ty + 0.5) * sy
      const radius = Math.min(sx, sy) * 0.42
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fillStyle = '#8d939a'
      ctx.fill()
      ctx.fillStyle = teamColor(building.owner, '#7ecfff', '#ff7d70', '#9dff90', '#d7b6ff')
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(0.8, radius * 0.38), 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = teamColor(building.owner, '#7ecfff', '#ff7d70', '#9dff90', '#d7b6ff')
      ctx.fillRect(ox + building.tx * sx, oy + building.ty * sy, stats.w * sx, stats.h * sy)
    }
  }
  ctx.globalAlpha = 1
  for (const unit of state.units) {
    if (!viewUnitSeen(state, unit)) continue
    ctx.fillStyle = teamColor(unit.owner, '#d8f4ff', '#ffd0c8', '#e7ffe4', '#f0e4ff')
    const px = ox + (unit.x / TILE) * sx
    const py = oy + (unit.y / TILE) * sy
    ctx.fillRect(px - 1, py - 1, 2.2, 2.2)
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
  for (let ty = 0; ty < state.mapH; ty++) {
    for (let tx = 0; tx < state.mapW; tx++) {
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
