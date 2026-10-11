import { screenToWorld, worldToIso, type Camera } from './camera'
import { FLASHER_OX, FLASHER_OY, flasherSprite } from './flasherArt'
import { GORILLA_OX, GORILLA_OY, gorillaSprite } from './gorillaArt'
import { hoverCameraPoint, hoverSprite, paintHoverRotors } from './hoverArt'
import {
  GROUND_ANCHOR,
  drawAnchored,
  factorySprite,
  fogDiamond,
  groundKind,
  groundSprite,
  keepSprite,
  oreSprite,
  siloGateOffset,
  pillarAimDir,
  pillarSprite,
  rockSprite,
  storageSprite,
  treeSprite,
} from './isoArt'
import { facingBasis, facingDir, stalkerSprite } from './stalkerArt'
import { buildingCenter, getTarget, placementAllowed, playerKeep } from './state'
import { storageFill } from './storageArt'
import { terrainCss } from './terrainArt'
import { viewBuildingSeen, viewGroundShown, viewTileExplored, viewTileVisible, viewUnitSeen } from './vision'
import {
  BUILDING_STATS,
  MAP_H,
  MAP_W,
  type MatchMode,
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

function teamColor(owner: number): string {
  return PLAYER_COLOR[owner] ?? '#ffffff'
}

function teamRgba(owner: number, alpha: number): string {
  const hex = PLAYER_COLOR[owner] ?? '#ffffff'
  const value = Number.parseInt(hex.slice(1), 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function buildTerrain(seed: number, mapW = MAP_W, mapH = MAP_H, mode: MatchMode = 'duel'): HTMLCanvasElement {
  void seed
  void mode
  const canvas = document.createElement('canvas')
  canvas.width = mapW * TILE
  canvas.height = mapH * TILE
  return canvas
}

export function renderWorld(
  canvas: HTMLCanvasElement,
  state: MatchState,
  _terrain: HTMLCanvasElement,
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
  ctx.imageSmoothingQuality = 'medium'

  const tiles = visibleTiles(cam, viewW, viewH, state.mapW, state.mapH)
  for (let ty = tiles.ty0; ty <= tiles.ty1; ty++) {
    for (let tx = tiles.tx0; tx <= tiles.tx1; tx++) {
      if (!viewTileExplored(state, tx, ty)) continue
      const north = worldToIso(tx * TILE, ty * TILE)
      const kind = groundKind(tx, ty, state.seed)
      ctx.drawImage(groundSprite(kind), north.x - GROUND_ANCHOR.x, north.y - GROUND_ANCHOR.y)
    }
  }

  const stamps: Array<{ depth: number; paint: () => void }> = []
  for (const rock of state.rocks) {
    if (rock.hp <= 0) continue
    if (!viewGroundShown(state, rock.tx, rock.ty)) continue
    const x = (rock.tx + 0.5) * TILE
    const y = (rock.ty + 0.5) * TILE
    if (!onScreen(cam, viewW, viewH, x, y, 48)) continue
    stamps.push({
      depth: x + y,
      paint: () => {
        const sprite = rock.kind === 'tree' ? treeSprite((rock.tx + rock.ty) & 1) : rockSprite((rock.tx * 3 + rock.ty) & 1)
        const at = worldToIso(x, y)
        if (sprite) drawAnchored(ctx, sprite, at.x, at.y)
        if (rock.hitFlash > 0) {
          ctx.fillStyle = `rgba(255,255,255,${Math.min(0.7, rock.hitFlash * 2.4)})`
          ctx.beginPath()
          ctx.ellipse(at.x, at.y, 12, 6, 0, 0, Math.PI * 2)
          ctx.fill()
        }
        const full = rock.kind === 'tree' ? TREE_HP : ROCK_HP
        if (rock.hp < full) bar(ctx, at.x - 12, at.y - 28, 24, rock.hp / full, hpColor(rock.hp / full))
      },
    })
  }

  for (const node of state.ore) {
    if (!viewGroundShown(state, node.tx, node.ty)) continue
    const x = (node.tx + 0.5) * TILE
    const y = (node.ty + 0.5) * TILE
    if (!onScreen(cam, viewW, viewH, x, y, 40)) continue
    stamps.push({
      depth: x + y,
      paint: () => {
        const sprite = oreSprite(node.amount > ORE_NODE_AMOUNT * 0.55)
        const at = worldToIso(x, y)
        if (sprite) drawAnchored(ctx, sprite, at.x, at.y)
        if (state.selectedOre === node.id) {
          ctx.strokeStyle = '#f6e7b0'
          ctx.lineWidth = 1.4
          ctx.beginPath()
          ctx.ellipse(at.x, at.y + 2, 16, 8, 0, 0, Math.PI * 2)
          ctx.stroke()
        }
      },
    })
  }

  for (const building of state.buildings) {
    if (!viewBuildingSeen(state, building)) continue
    const stats = BUILDING_STATS[building.kind]
    const x = (building.tx + stats.w / 2) * TILE
    const y = (building.ty + stats.h / 2) * TILE
    if (!onScreen(cam, viewW, viewH, x, y, 140)) continue
    stamps.push({
      depth: (building.tx + stats.w + building.ty + stats.h) * TILE,
      paint: () => drawBuilding(ctx, state, building),
    })
  }

  const selected = new Set(state.selectedUnits)
  for (const unit of state.units) {
    if (!viewUnitSeen(state, unit)) continue
    if (!onScreen(cam, viewW, viewH, unit.x, unit.y, 64)) continue
    stamps.push({
      depth: unit.x + unit.y,
      paint: () => {
        if (selected.has(unit.id)) drawOrderLine(ctx, unit)
        drawUnit(ctx, state, unit, selected.has(unit.id))
      },
    })
  }

  stamps.sort((a, b) => a.depth - b.depth)
  for (const stamp of stamps) stamp.paint()
  if (state.showGrid) drawFootprintGrid(ctx, state)

  for (const ping of state.pings) {
    const at = worldToIso(ping.x, ping.y)
    drawPing(ctx, at.x, at.y, ping.life / ping.max, ping.color)
  }

  const viewer = state.bothCam ? -1 : state.enemyCam ? 1 : 0
  for (const shot of state.projectiles) {
    if (!onScreen(cam, viewW, viewH, shot.x, shot.y, 20)) continue
    if (shot.owner !== viewer && !viewTileVisible(state, Math.floor(shot.x / TILE), Math.floor(shot.y / TILE))) continue
    const at = worldToIso(shot.x, shot.y)
    ctx.fillStyle = teamColor(shot.owner)
    ctx.beginPath()
    ctx.arc(at.x, at.y, shot.radius, 0, Math.PI * 2)
    ctx.fill()
  }

  for (const particle of state.particles) {
    if (!onScreen(cam, viewW, viewH, particle.x, particle.y, 24)) continue
    if (!viewTileVisible(state, Math.floor(particle.x / TILE), Math.floor(particle.y / TILE))) continue
    const at = worldToIso(particle.x, particle.y)
    const alpha = Math.max(0, particle.life / particle.max)
    ctx.globalAlpha = alpha
    if (particle.text) {
      ctx.font = 'bold 14px "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.lineWidth = 3
      ctx.strokeStyle = '#1a1408'
      ctx.strokeText(particle.text, at.x, at.y)
      ctx.fillStyle = particle.color
      ctx.fillText(particle.text, at.x, at.y)
    } else {
      ctx.fillStyle = particle.color
      ctx.beginPath()
      ctx.arc(at.x, at.y, particle.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  drawFog(ctx, state, tiles)
  if (state.bothCam) drawBothSight(ctx, state, cam, viewW, viewH)
  if (state.tutorial) drawOreHint(ctx, state)

  if (state.placement && overlay.pointer) {
    const stats = BUILDING_STATS[state.placement]
    const tx = Math.floor(overlay.pointer.x / TILE)
    const ty = Math.floor(overlay.pointer.y / TILE)
    if (state.placement === 'tower') drawKeepSight(ctx, state)
    drawPlacement(ctx, state, state.placement, tx, ty, stats.w, stats.h)
  }

  const rally = state.selectedBuilding != null ? state.buildings.find((b) => b.id === state.selectedBuilding) : undefined
  if (rally && rally.owner === 0 && viewBuildingSeen(state, rally)) {
    const at = worldToIso(rally.rallyX, rally.rallyY)
    ctx.strokeStyle = 'rgba(159, 216, 255, 0.8)'
    ctx.fillStyle = '#9fd8ff'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(at.x, at.y)
    ctx.lineTo(at.x, at.y - 16)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(at.x, at.y - 16)
    ctx.lineTo(at.x + 8, at.y - 11)
    ctx.lineTo(at.x, at.y - 7)
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

function visibleTiles(
  cam: Camera,
  viewW: number,
  viewH: number,
  mapW: number,
  mapH: number,
): { tx0: number; ty0: number; tx1: number; ty1: number } {
  const corners = [
    screenToWorld(cam, -120, -140),
    screenToWorld(cam, viewW + 120, -140),
    screenToWorld(cam, -120, viewH + 180),
    screenToWorld(cam, viewW + 120, viewH + 180),
  ]
  let minX = corners[0]?.x ?? 0
  let maxX = minX
  let minY = corners[0]?.y ?? 0
  let maxY = minY
  for (const corner of corners) {
    minX = Math.min(minX, corner.x)
    maxX = Math.max(maxX, corner.x)
    minY = Math.min(minY, corner.y)
    maxY = Math.max(maxY, corner.y)
  }
  return {
    tx0: Math.max(0, Math.floor(minX / TILE) - 2),
    ty0: Math.max(0, Math.floor(minY / TILE) - 2),
    tx1: Math.min(mapW - 1, Math.ceil(maxX / TILE) + 2),
    ty1: Math.min(mapH - 1, Math.ceil(maxY / TILE) + 2),
  }
}

function onScreen(cam: Camera, viewW: number, viewH: number, wx: number, wy: number, margin: number): boolean {
  const at = worldToIso(wx, wy)
  return at.x >= cam.x - margin && at.y >= cam.y - margin && at.x <= cam.x + viewW / cam.zoom + margin && at.y <= cam.y + viewH / cam.zoom + margin
}

function traceCircle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  const steps = 28
  ctx.beginPath()
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2
    const at = worldToIso(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
    if (i === 0) ctx.moveTo(at.x, at.y)
    else ctx.lineTo(at.x, at.y)
  }
}

function drawFootprintGrid(ctx: CanvasRenderingContext2D, state: MatchState): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(255, 228, 150, 0.92)'
  ctx.lineWidth = 1.25
  ctx.setLineDash([5, 4])
  for (const building of state.buildings) {
    if (building.hp <= 0 && !building.ruined) continue
    if (!viewBuildingSeen(state, building)) continue
    const stats = BUILDING_STATS[building.kind]
    traceFootprint(ctx, building.tx, building.ty, stats.w, stats.h)
    ctx.stroke()
  }
  ctx.restore()
}

function traceFootprint(ctx: CanvasRenderingContext2D, tx: number, ty: number, w: number, h: number): void {
  const corner = (dx: number, dy: number) => worldToIso((tx + dx) * TILE, (ty + dy) * TILE)
  const nw = corner(0, 0)
  const ne = corner(w, 0)
  const se = corner(w, h)
  const sw = corner(0, h)
  ctx.beginPath()
  ctx.moveTo(nw.x, nw.y)
  ctx.lineTo(ne.x, ne.y)
  ctx.lineTo(se.x, se.y)
  ctx.lineTo(sw.x, sw.y)
  ctx.closePath()
}

/** Faint rings so Both cam shows which side is lighting the ground. */
function drawBothSight(ctx: CanvasRenderingContext2D, state: MatchState, cam: Camera, viewW: number, viewH: number): void {
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
      if (!onScreen(cam, viewW, viewH, source.x, source.y, source.radius)) continue
      traceCircle(ctx, source.x, source.y, source.radius)
      ctx.stroke()
    }
  }
  ctx.restore()
}

function drawFog(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  tiles: { tx0: number; ty0: number; tx1: number; ty1: number },
): void {
  const solid = fogDiamond(true)
  const shroud = fogDiamond(false)
  for (let ty = tiles.ty0; ty <= tiles.ty1; ty++) {
    for (let tx = tiles.tx0; tx <= tiles.tx1; tx++) {
      if (viewTileVisible(state, tx, ty)) continue
      const north = worldToIso(tx * TILE, ty * TILE)
      const stamp = viewTileExplored(state, tx, ty) ? shroud : solid
      ctx.drawImage(stamp, north.x - GROUND_ANCHOR.x, north.y - GROUND_ANCHOR.y)
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
  const at = worldToIso(best.x, best.y)
  ctx.save()
  ctx.fillStyle = '#f6e7b0'
  ctx.font = '12px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.fillText('Right-click dumps', at.x, at.y - 28)
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
  traceCircle(ctx, center.x, center.y, BUILDING_STATS.keep.sight)
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
  const label = worldToIso((tx + w / 2) * TILE, ty * TILE)
  ctx.save()
  ctx.globalAlpha = 0.85
  traceFootprint(ctx, tx, ty, w, h)
  ctx.fillStyle = open ? 'rgba(120, 180, 90, 0.35)' : 'rgba(180, 64, 48, 0.35)'
  ctx.fill()
  ctx.strokeStyle = open ? '#d7f08a' : '#ff8d7a'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = '#f4f1e4'
  ctx.font = '12px "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(BUILDING_STATS[kind].label, label.x, label.y - 8)
  ctx.restore()
}

function drawBuilding(ctx: CanvasRenderingContext2D, state: MatchState, building: Building): void {
  const stats = BUILDING_STATS[building.kind]
  const color = building.ruined ? '#8a8074' : teamColor(building.owner)
  const cx = (building.tx + stats.w / 2) * TILE
  const cy = (building.ty + stats.h / 2) * TILE
  const at = worldToIso(cx, cy)
  ctx.save()
  if (!building.complete && !building.ruined) ctx.globalAlpha = 0.45 + building.progress * 0.5
  if (building.kind === 'keep') {
    ctx.save()
    ctx.fillStyle = 'rgba(12, 22, 10, 0.34)'
    ctx.beginPath()
    ctx.ellipse(at.x, at.y + 30, 78, 18, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    const sprite = keepSprite(color, building.ruined)
    if (sprite) drawAnchored(ctx, sprite, at.x, at.y)
    if (!building.ruined && building.hatch > 0.02) {
      const gate = siloGateOffset()
      const glow = Math.min(1, building.hatch / 0.7)
      ctx.save()
      ctx.globalAlpha = (0.35 + 0.25 * Math.sin(state.time * 9)) * glow
      ctx.fillStyle = '#d8fbff'
      ctx.beginPath()
      ctx.ellipse(at.x + gate.x, at.y + gate.y, 12, 18, 0.05, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 0.45 * glow
      ctx.strokeStyle = '#3ad4ef'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.restore()
    }
  } else if (building.kind === 'yard') {
    ctx.save()
    ctx.fillStyle = 'rgba(12, 22, 10, 0.34)'
    ctx.beginPath()
    ctx.ellipse(at.x + ((stats.w - stats.h) * TILE) / 2, at.y + 26, 68, 15, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    const sprite = factorySprite(color)
    if (sprite) drawAnchored(ctx, sprite, at.x, at.y)
  } else if (building.kind === 'tower') {
    const origin = buildingCenter(building)
    let aim = Math.PI / 2
    if (building.focusId != null && (building.focusKind === 'unit' || building.focusKind === 'building')) {
      const target = getTarget(state, building.focusId, building.focusKind)
      if (target) aim = Math.atan2(target.y - origin.y, target.x - origin.x)
    }
    const cool = UNIT_STATS.pike.cooldown
    const flash = building.complete && building.attackCd > cool - 0.18
    const spin = building.complete ? state.time * 2.2 : 0.4
    const sprite = pillarSprite(color, pillarAimDir(aim), flash, spin)
    if (sprite) drawAnchored(ctx, sprite, at.x, at.y)
  } else {
    const cap = state.supplyCap[building.owner] ?? 0
    const fill = building.complete ? storageFill(cap) : 0
    const sprite = storageSprite(color, fill)
    if (sprite) drawAnchored(ctx, sprite, at.x, at.y)
  }
  ctx.restore()

  const top = worldToIso((building.tx + stats.w / 2) * TILE, building.ty * TILE)
  if (building.ruined) {
    const repairing = state.units.some((unit) => unit.order?.type === 'repair' && unit.order.buildingId === building.id && unit.hp > 0)
    if (building.progress > 0 || repairing) {
      bar(ctx, top.x - 22, top.y - 16, 44, building.progress, '#e6c15a')
      ctx.fillStyle = '#f4e7bf'
      ctx.font = '10px "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(repairing && building.progress < 1 ? 'Repairing' : 'Paused', top.x, top.y - 20)
    }
  } else if (!building.complete) {
    bar(ctx, top.x - 22, top.y - 16, 44, building.progress, '#e6c15a')
    ctx.fillStyle = '#f4e7bf'
    ctx.font = '10px "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    const crew = state.units.some((unit) => unit.order?.type === 'construct' && unit.order.buildingId === building.id && unit.hp > 0)
    ctx.fillText(crew ? 'Raising' : 'Paused', top.x, top.y - 20)
  } else if (state.selectedBuilding === building.id || building.hp < stats.hp || building.hitFlash > 0) {
    bar(ctx, top.x - 22, top.y - 16, 44, building.hp / stats.hp, hpColor(building.hp / stats.hp))
  }

  if (state.selectedBuilding === building.id) {
    ctx.strokeStyle = 'rgba(244, 241, 196, 0.95)'
    ctx.lineWidth = 2
    traceFootprint(ctx, building.tx, building.ty, stats.w, stats.h)
    ctx.stroke()
  }
  if (building.hitFlash > 0) {
    ctx.save()
    ctx.globalAlpha = Math.min(0.45, building.hitFlash * 1.6)
    traceFootprint(ctx, building.tx, building.ty, stats.w, stats.h)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.restore()
  }
}

function drawUnit(ctx: CanvasRenderingContext2D, state: MatchState, unit: Unit, selected: boolean): void {
  const stats = UNIT_STATS[unit.kind]
  const bob = unit.kind === 'drone' ? Math.sin(state.time * 3.1 + unit.id * 0.7) * 1.15 : unit.goalX != null ? Math.sin(unit.anim) * 1.1 : 0
  const at = worldToIso(unit.x, unit.y)

  if (selected || (state.tutorial && unit.owner === 0 && unit.kind === 'porter')) {
    const pulse = state.tutorial && !selected ? 0.45 + Math.sin(state.time * 4) * 0.2 : 0.9
    ctx.save()
    ctx.strokeStyle = selected ? `rgba(244, 241, 196, ${pulse})` : `rgba(230, 193, 90, ${pulse})`
    ctx.lineWidth = selected ? 1.6 : 1.2
    ctx.beginPath()
    ctx.ellipse(at.x, at.y + 2, stats.radius + 6, (stats.radius + 6) * 0.5, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  ctx.save()
  ctx.translate(at.x, at.y)
  ctx.fillStyle = unit.kind === 'drone' ? 'rgba(16, 22, 12, 0.28)' : 'rgba(16, 28, 14, 0.32)'
  ctx.beginPath()
  const shadowW = unit.kind === 'porter' ? 11 : unit.kind === 'drone' ? 9 : 16
  ctx.ellipse(2, 3, shadowW, shadowW * 0.42, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.translate(0, bob)
  if (unit.kind === 'drone') ctx.translate(0, -8)

  if (unit.kind === 'porter') {
    ctx.drawImage(stalkerSprite(unit), -26, -34)
  } else if (unit.kind === 'pike') {
    ctx.drawImage(flasherSprite(unit), -FLASHER_OX, -FLASHER_OY)
  } else if (unit.kind === 'howler') {
    ctx.drawImage(gorillaSprite(unit), -GORILLA_OX, -GORILLA_OY)
  } else {
    const dir = facingDir(unit.facing)
    const { fx, fy } = facingBasis(dir)
    if (unit.goalX != null) {
      ctx.translate(fx * 1.2, fy * 0.35)
      ctx.rotate(fx * 0.12)
    }
    const sway = Math.floor(state.time * 2.4 + unit.id) % 2
    ctx.drawImage(hoverSprite(unit, sway), -28, -30)
    paintHoverRotors(ctx, dir, state.time * 9, teamColor(unit.owner))
    if (unit.scanning) {
      const cam = hoverCameraPoint(dir)
      ctx.strokeStyle = teamColor(unit.owner)
      ctx.globalAlpha = 0.5 + Math.sin(state.time * 6) * 0.15
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cam.x, cam.y, 2.7, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }
  if (unit.hitFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, unit.hitFlash * 3)})`
    ctx.beginPath()
    ctx.arc(0, -8, stats.radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  const showHp = selected || unit.hp < stats.hp - 0.5 || unit.hitFlash > 0
  if (showHp) bar(ctx, at.x - 12, at.y - stats.radius - 22, 24, unit.hp / stats.hp, hpColor(unit.hp / stats.hp))

  if (unit.owner === 0 && unit.kind === 'porter' && !unit.order) {
    ctx.fillStyle = '#f0c857'
    ctx.beginPath()
    ctx.moveTo(at.x, at.y - 26)
    ctx.lineTo(at.x + 3.5, at.y - 21)
    ctx.lineTo(at.x, at.y - 16)
    ctx.lineTo(at.x - 3.5, at.y - 21)
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
  const start = worldToIso(unit.x, unit.y)
  ctx.moveTo(start.x, start.y)
  for (const point of unit.path) {
    const at = worldToIso(point.x, point.y)
    ctx.lineTo(at.x, at.y)
  }
  if (unit.goalX != null && unit.goalY != null) {
    const goal = worldToIso(unit.goalX, unit.goalY)
    ctx.lineTo(goal.x, goal.y)
  }
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
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(minimapGround(state), ox, oy, frame.w, frame.h)
  ctx.fillStyle = '#d4894a'
  for (const node of state.ore) {
    if (!viewGroundShown(state, node.tx, node.ty)) continue
    ctx.globalAlpha = viewTileVisible(state, node.tx, node.ty) ? 1 : 0.45
    ctx.fillRect(ox + node.tx * sx, oy + node.ty * sy, sx, sy)
  }
  ctx.globalAlpha = 1
  for (const building of state.buildings) {
    if (!viewBuildingSeen(state, building)) continue
    const stats = BUILDING_STATS[building.kind]
    if (building.ruined) {
      ctx.globalAlpha = 0.55
      ctx.fillStyle = '#5c564c'
      ctx.fillRect(ox + building.tx * sx, oy + building.ty * sy, stats.w * sx, stats.h * sy)
      ctx.globalAlpha = 1
      continue
    }
    ctx.globalAlpha = building.complete ? 1 : 0.55
    if (building.kind === 'keep') {
      ctx.fillStyle = '#c8c2b4'
      ctx.fillRect(ox + building.tx * sx, oy + building.ty * sy, stats.w * sx, stats.h * sy)
      ctx.fillStyle = teamColor(building.owner)
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
      ctx.fillStyle = teamColor(building.owner)
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
      ctx.strokeStyle = teamColor(building.owner)
      ctx.stroke()
    } else if (building.kind === 'tower') {
      const cx = ox + (building.tx + 0.5) * sx
      const cy = oy + (building.ty + 0.5) * sy
      const radius = Math.min(sx, sy) * 0.42
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fillStyle = '#8d939a'
      ctx.fill()
      ctx.fillStyle = teamColor(building.owner)
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(0.8, radius * 0.38), 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = teamColor(building.owner)
      ctx.fillRect(ox + building.tx * sx, oy + building.ty * sy, stats.w * sx, stats.h * sy)
    }
  }
  ctx.globalAlpha = 1
  for (const unit of state.units) {
    if (!viewUnitSeen(state, unit)) continue
    ctx.fillStyle = teamColor(unit.owner)
    const px = ox + (unit.x / TILE) * sx
    const py = oy + (unit.y / TILE) * sy
    ctx.fillRect(px - 1, py - 1, 2.2, 2.2)
  }
  ctx.strokeStyle = '#f4f1c4'
  ctx.lineWidth = 1
  const corners = [
    screenToWorld(cam, 0, 0),
    screenToWorld(cam, viewW, 0),
    screenToWorld(cam, viewW, viewH),
    screenToWorld(cam, 0, viewH),
  ]
  ctx.beginPath()
  corners.forEach((corner, index) => {
    const px = ox + (corner.x / TILE) * sx
    const py = oy + (corner.y / TILE) * sy
    if (index === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.closePath()
  ctx.stroke()
}

let groundCanvas: HTMLCanvasElement | null = null
let groundState: MatchState | null = null
let groundFrame = 0

/** One pixel per tile. Large fields refresh every few frames so the minimap does not repaint the whole map every tick. */
function minimapGround(state: MatchState): HTMLCanvasElement {
  groundFrame += 1
  const big = state.mapW * state.mapH > 90 * 50
  const sizeChanged = !groundCanvas || groundCanvas.width !== state.mapW || groundCanvas.height !== state.mapH
  const refresh = sizeChanged || groundState !== state || !big || groundFrame % 4 === 1
  if (!groundCanvas || sizeChanged) {
    groundCanvas = document.createElement('canvas')
    groundCanvas.width = state.mapW
    groundCanvas.height = state.mapH
  }
  if (!refresh) return groundCanvas
  groundState = state
  const pen = groundCanvas.getContext('2d')
  if (!pen) return groundCanvas
  const image = pen.createImageData(state.mapW, state.mapH)
  const data = image.data
  for (let ty = 0; ty < state.mapH; ty++) {
    const row = ty * state.mapW
    for (let tx = 0; tx < state.mapW; tx++) {
      const p = (row + tx) * 4
      if (!viewTileExplored(state, tx, ty)) continue
      let r = 18
      let g = 16
      let b = 12
      if (viewTileVisible(state, tx, ty)) {
        const tile = state.tiles[row + tx]
        if (tile === 3) {
          r = 60
          g = 106
          b = 52
        } else if (tile === 1) {
          r = 74
          g = 67
          b = 56
        } else {
          const parts = terrainCss(tx, ty, state.seed, state.mapW, state.mapH, state.mode).match(/\d+/g)
          r = Number(parts?.[0] ?? 40)
          g = Number(parts?.[1] ?? 48)
          b = Number(parts?.[2] ?? 28)
        }
      }
      data[p] = r
      data[p + 1] = g
      data[p + 2] = b
      data[p + 3] = 255
    }
  }
  pen.putImageData(image, 0, 0)
  return groundCanvas
}
