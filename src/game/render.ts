import { drawAnimal } from './animalArt'
import { FAR_ZOOM, type Camera } from './camera'
import { lessonView } from './tutorial'
import { controlledSide } from './control'
import { buildingCenter, buildingRect, cryoOccupants, getTarget, inFriendlyPillarSight, placementAllowed, sideKeep } from './state'
import { flasherFrame, flasherSprite } from './flasherArt'
import { gorillaFrame, gorillaSprite } from './gorillaArt'
import { FLY_RADAR_SPIN, hoverCameraPoint, hoverFrame, hoverSprite, paintHoverDish, paintHoverRotors } from './hoverArt'
import { frogFrame, frogSprite } from './frogArt'
import { facingBasis, facingDir, stalkerFrame, stalkerSprite } from './stalkerArt'
import { drawFactorySprite, factoryDamageStage } from './factoryArt'
import { drawKeepSprite, keepDamageStage, keepDoorSlide, keepFillLevel } from './siloArt'
import { drawPillarSprite, pillarDamageStage } from './pillarArt'
import { drawStorageSprite, storageCylinderCount, storageDamageStage } from './storageArt'
import { drawGraveSprite, drawOreSprite, drawRockSprite, drawTreeSprite, fogSprite, oreVariant, oreVariantSprite, paintTerrain, rockVariant, rockVariantSprite, terrainCss, treeVariant, treeVariantSprite } from './terrainArt'
import { footprintExplored, viewBuildingSeen, viewGroundShown, viewMemories, viewTileExplored, viewTileVisible, viewUnitSeen, viewerOwns } from './vision'
import {
  BUILDING_STATS,
  MAP_H,
  MAP_W,
  type MatchMode,
  ORE_NODE_AMOUNT,
  PLAYER_COLOR,
  CRYO_RECOVER,
  ROCK_HP,
  isShutdown,
  powerSeconds,
  TILE,
  TREE_HP,
  UNIT_STATS,
  type Building,
  type BuildingKind,
  type BuildingSighting,
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
  const canvas = document.createElement('canvas')
  canvas.width = mapW * TILE
  canvas.height = mapH * TILE
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  paintTerrain(ctx, seed, mapW, mapH, mode)
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
  const view = {
    l: cam.x - 48,
    t: cam.y - 48,
    r: cam.x + viewW / cam.zoom + 48,
    b: cam.y + viewH / cam.zoom + 48,
  }
  const sx0 = Math.max(0, Math.floor(view.l))
  const sy0 = Math.max(0, Math.floor(view.t))
  const sx1 = Math.min(terrain.width, Math.ceil(view.r))
  const sy1 = Math.min(terrain.height, Math.ceil(view.b))
  const coarse = cam.zoom < FAR_ZOOM
  const bucket = coarse ? lodBucket(cam.zoom) : 0

  ctx.imageSmoothingEnabled = true
  if (coarse) {
    const small = terrainLod(terrain, bucket)
    ctx.drawImage(small, 0, 0, terrain.width, terrain.height)
  } else if (sx1 > sx0 && sy1 > sy0) {
    ctx.drawImage(terrain, sx0, sy0, sx1 - sx0, sy1 - sy0, sx0, sy0, sx1 - sx0, sy1 - sy0)
  }
  ctx.imageSmoothingEnabled = false

  for (const rock of state.rocks) {
    if (rock.hp <= 0) continue
    if (!viewGroundShown(state, rock.tx, rock.ty)) continue
    const x = (rock.tx + 0.5) * TILE
    const y = (rock.ty + 0.5) * TILE
    if (x < view.l || y < view.t || x > view.r || y > view.b) continue
    if (coarse) drawRockLod(ctx, rock.kind, rock.tx, rock.ty, state.seed, bucket)
    else if (rock.kind === 'tree') drawTreeSprite(ctx, rock.tx, rock.ty, state.seed)
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
    const picked = state.selectedOre === node.id
    if (coarse) drawOreLod(ctx, node.tx, node.ty, state.seed, node.amount, ORE_NODE_AMOUNT, picked, bucket)
    else drawOreSprite(ctx, node.tx, node.ty, state.seed, picked, node.amount, ORE_NODE_AMOUNT)
  }

  for (const battery of state.batteries) {
    if (!viewGroundShown(state, battery.tx, battery.ty)) continue
    const x = (battery.tx + 0.5) * TILE
    const y = (battery.ty + 0.5) * TILE
    if (x < view.l || y < view.t || x > view.r || y > view.b) continue
    if (coarse) drawBatteryLod(ctx, x, y, bucket)
    else drawBattery(ctx, x, y)
  }

  for (const grave of state.graves) {
    if (!viewGroundShown(state, grave.tx, grave.ty)) continue
    const x = (grave.tx + 0.5) * TILE
    const y = (grave.ty + 0.5) * TILE
    if (x < view.l || y < view.t || x > view.r || y > view.b) continue
    const picked = state.selectedGrave === grave.id
    if (coarse) drawGraveLod(ctx, x, y, picked, bucket)
    else drawGraveSprite(ctx, grave.tx, grave.ty, picked)
  }

  if (state.tutorial) drawOreHint(ctx, state)

  const memories = viewMemories(state)
  const memoryIds = new Set(memories.map((spot) => spot.id))
  const buildings = state.buildings.slice().sort((a, b) => a.ty - b.ty)
  for (const building of buildings) {
    if (memoryIds.has(building.id)) continue
    if (!viewBuildingSeen(state, building)) continue
    const rect = buildingRect(building)
    if (rect.x > view.r || rect.y > view.b || rect.x + rect.w < view.l || rect.y + rect.h < view.t) continue
    if (coarse) drawBuildingLod(ctx, state, building, bucket)
    else drawBuilding(ctx, state, building)
  }
  for (const spot of memories) drawMemory(ctx, state, spot, view, coarse, bucket)

  for (const ping of state.pings) drawPing(ctx, ping.x, ping.y, ping.life / ping.max, ping.color)
  drawLessonMark(ctx, state)

  const selected = new Set(state.selectedUnits)
  const units = state.units.slice().sort((a, b) => a.y - b.y)
  for (const unit of units) {
    if (!viewUnitSeen(state, unit)) continue
    if (unit.x < view.l || unit.y < view.t || unit.x > view.r || unit.y > view.b) continue
    const picked = selected.has(unit.id)
    if (picked) drawOrderLine(ctx, unit)
    if (coarse) drawUnitLod(ctx, unit, picked, bucket)
    else drawUnit(ctx, state, unit, picked)
  }

  const viewer = state.bothCam ? -1 : state.enemyCam ? 1 : controlledSide(state)
  for (const shot of state.projectiles) {
    if (shot.x < view.l || shot.y < view.t || shot.x > view.r || shot.y > view.b) continue
    if (shot.owner !== viewer && !viewTileVisible(state, Math.floor(shot.x / TILE), Math.floor(shot.y / TILE))) continue
    ctx.fillStyle = teamColor(shot.owner)
    ctx.beginPath()
    ctx.arc(shot.x, shot.y, shot.radius, 0, Math.PI * 2)
    ctx.fill()
  }

  for (const ring of state.rings) {
    if (!viewTileVisible(state, Math.floor(ring.x / TILE), Math.floor(ring.y / TILE))) continue
    const grown = 1 - Math.max(0, ring.life / ring.max)
    const radius = 8 + (ring.reach - 8) * grown
    ctx.save()
    ctx.strokeStyle = `rgba(210, 244, 255, ${0.15 + (1 - grown) * 0.7})`
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 + (1 - grown) * 0.45})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(ring.x, ring.y, Math.max(4, radius - 6), 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  for (const particle of state.particles) {
    if (particle.x < view.l || particle.y < view.t || particle.x > view.r || particle.y > view.b) continue
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

  drawBirds(ctx, state, view)
  if (coarse) drawFogLod(ctx, state, bucket)
  else drawFog(ctx, state, view)
  drawFreezeBan(ctx, state)
  if (state.bothCam) drawBothSight(ctx, state, view)

  if (state.placement && overlay.pointer) {
    const stats = BUILDING_STATS[state.placement]
    const tx = Math.floor(overlay.pointer.x / TILE)
    const ty = Math.floor(overlay.pointer.y / TILE)
    if (state.placement === 'tower') drawKeepSight(ctx, state)
    drawPlacement(ctx, state, state.placement, tx, ty, stats.w, stats.h)
  }

  const rally = state.selectedBuilding != null ? state.buildings.find((b) => b.id === state.selectedBuilding) : undefined
  if (rally && rally.owner === controlledSide(state) && viewBuildingSeen(state, rally)) {
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

interface FogSheet {
  canvas: HTMLCanvasElement
  pen: CanvasRenderingContext2D | null
  bucket: number
  mapW: number
  mapH: number
  cell: number
  stamps: Uint16Array
  match: MatchState
}

let fogSheet: FogSheet | null = null

/** Same edge stamps as drawFog, kept on one layer and repainted only where vision changed. */
function drawFogLod(ctx: CanvasRenderingContext2D, state: MatchState, bucket: number): void {
  const cell = Math.max(1, Math.round(TILE * bucket))
  if (
    !fogSheet ||
    fogSheet.match !== state ||
    fogSheet.bucket !== bucket ||
    fogSheet.mapW !== state.mapW ||
    fogSheet.mapH !== state.mapH ||
    fogSheet.cell !== cell
  ) {
    const canvas = document.createElement('canvas')
    canvas.width = cell * state.mapW
    canvas.height = cell * state.mapH
    fogSheet = {
      canvas,
      pen: canvas.getContext('2d'),
      bucket,
      mapW: state.mapW,
      mapH: state.mapH,
      cell,
      stamps: new Uint16Array(state.mapW * state.mapH),
      match: state,
    }
  }
  const pen = fogSheet.pen
  if (pen) {
    pen.imageSmoothingEnabled = true
    pen.imageSmoothingQuality = 'high'
    for (let ty = 0; ty < state.mapH; ty++) {
      const row = ty * state.mapW
      for (let tx = 0; tx < state.mapW; tx++) {
        const black = !viewTileVisible(state, tx, ty) && !viewTileExplored(state, tx, ty)
        const code = viewTileVisible(state, tx, ty)
          ? 1
          : 2 +
            (black ? 81 : 0) +
            fogSide(state, tx, ty - 1, black) +
            fogSide(state, tx + 1, ty, black) * 3 +
            fogSide(state, tx, ty + 1, black) * 9 +
            fogSide(state, tx - 1, ty, black) * 27
        const index = row + tx
        if (fogSheet.stamps[index] === code) continue
        fogSheet.stamps[index] = code
        const dx = tx * cell
        const dy = ty * cell
        pen.clearRect(dx, dy, cell, cell)
        if (code <= 1) continue
        const shrouded = code < 83
        const packed = code - 2 - (shrouded ? 0 : 81)
        pen.drawImage(
          fogSprite(
            shrouded ? 'shroud' : 'black',
            packed % 3,
            Math.floor(packed / 3) % 3,
            Math.floor(packed / 9) % 3,
            Math.floor(packed / 27) % 3,
          ),
          dx,
          dy,
          cell,
          cell,
        )
      }
    }
  }
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(fogSheet.canvas, 0, 0, state.mapW * TILE, state.mapH * TILE)
  ctx.restore()
}

function drawBirds(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  view: { l: number; t: number; r: number; b: number },
): void {
  for (const animal of state.animals) {
    if (animal.kind !== 'crow') continue
    if (animal.x < view.l || animal.y < view.t || animal.x > view.r || animal.y > view.b) continue
    if (!viewTileVisible(state, Math.floor(animal.x / TILE), Math.floor(animal.y / TILE))) continue
    drawAnimal(ctx, animal)
  }
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
  const keep = sideKeep(state, controlledSide(state))
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

/** A faint ring of each seen Silo's sight while a Frog is selected. Freeze does not work inside it. */
function drawFreezeBan(ctx: CanvasRenderingContext2D, state: MatchState): void {
  const selected = state.selectedUnits.some((id) =>
    state.units.some((unit) => unit.id === id && unit.kind === 'frog' && unit.hp > 0),
  )
  if (!selected) return
  const reach = BUILDING_STATS.keep.sight
  ctx.save()
  ctx.strokeStyle = 'rgba(186, 224, 236, 0.42)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([5, 8])
  for (const building of state.buildings) {
    if (building.kind !== 'keep' || building.hp <= 0 || !viewBuildingSeen(state, building)) continue
    const center = buildingCenter(building)
    ctx.beginPath()
    ctx.arc(center.x, center.y, reach, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

function drawKeepSight(ctx: CanvasRenderingContext2D, state: MatchState): void {
  const keep = sideKeep(state, controlledSide(state))
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
  const side = controlledSide(state)
  const explored = footprintExplored(state, side, kind, tx, ty)
  const open = explored && placementAllowed(state, side, kind, tx, ty)
  const onMap = tx >= 0 && ty >= 0 && tx + w <= state.mapW && ty + h <= state.mapH
  ctx.save()
  ctx.globalAlpha = 0.85
  ctx.fillStyle = open ? 'rgba(120, 180, 90, 0.35)' : 'rgba(180, 64, 48, 0.35)'
  ctx.strokeStyle = open ? '#d7f08a' : '#ff8d7a'
  ctx.lineWidth = 2
  ctx.fillRect(tx * TILE, ty * TILE, w * TILE, h * TILE)
  ctx.strokeRect(tx * TILE + 1, ty * TILE + 1, w * TILE - 2, h * TILE - 2)
  ctx.fillStyle = onMap && !explored ? '#ffd2c8' : '#f4f1e4'
  ctx.font = '12px "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(onMap && !explored ? 'Unexplored ground' : BUILDING_STATS[kind].label, (tx + w / 2) * TILE, ty * TILE - 6)
  ctx.restore()
}

/** Ceil so a full recovery reads 4:00 and a fraction still shows 0:01. */
function formatRecover(time: number): string {
  const seconds = Math.max(0, Math.ceil(time))
  const min = Math.floor(seconds / 60)
  const rem = seconds % 60
  return `${min}:${rem.toString().padStart(2, '0')}`
}

const ghostHeld = new WeakMap<Building, number>()
const ghostDraw = new WeakSet<Building>()

function memoryBuilding(spot: BuildingSighting): Building | null {
  if (!spot.kind || spot.tx == null || spot.ty == null) return null
  const job =
    spot.jobKind && spot.jobTotal != null && spot.jobLeft != null
      ? [{ kind: spot.jobKind, remaining: spot.jobLeft, total: spot.jobTotal }]
      : []
  const building: Building = {
    id: spot.id,
    owner: spot.owner ?? 0,
    kind: spot.kind,
    tx: spot.tx,
    ty: spot.ty,
    hp: spot.hp ?? BUILDING_STATS[spot.kind].hp,
    progress: spot.progress ?? 1,
    complete: spot.complete !== false,
    queue: job,
    rallyX: 0,
    rallyY: 0,
    hitFlash: 0,
    spawnN: 0,
    hatch: spot.hatch ?? 0,
    dish: spot.dish ?? 0,
    attackCd: 10,
    alert: 0,
    focusId: null,
    focusKind: null,
    stock: spot.stock ?? 0,
    struckBy: null,
    dropDumps: false,
    ruined: false,
    repairPaid: false,
    cryo: spot.cryo === true,
    cryoRecover: 0,
  }
  if (spot.held != null) ghostHeld.set(building, spot.held)
  ghostDraw.add(building)
  return building
}

function drawMemory(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  spot: BuildingSighting,
  view: { l: number; t: number; r: number; b: number },
  coarse: boolean,
  bucket: number,
): void {
  const building = memoryBuilding(spot)
  if (!building) return
  const rect = buildingRect(building)
  if (rect.x > view.r || rect.y > view.b || rect.x + rect.w < view.l || rect.y + rect.h < view.t) return
  if (coarse) drawBuildingLod(ctx, state, building, bucket)
  else drawBuilding(ctx, state, building)
  if (state.selectedGhost !== spot.id) return
  ctx.save()
  ctx.strokeStyle = 'rgba(244, 241, 196, 0.7)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 3])
  ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2)
  ctx.restore()
}

/** Far-zoom steps. Sprites are rasterized once per step, then scaled with the camera. */
const LOD_BUCKETS = [0.22, 0.35, 0.5, 0.65]

function lodBucket(zoom: number): number {
  for (const step of LOD_BUCKETS) {
    if (zoom <= step) return step
  }
  return LOD_BUCKETS[LOD_BUCKETS.length - 1] ?? 0.65
}

interface LodSprite {
  canvas: HTMLCanvasElement
  worldW: number
  worldH: number
}

const lodSprites = new Map<string, LodSprite>()
const LOD_PAD = 56
const UNIT_BOX = 96
const LOD_DIR = 2

function lodSprite(key: string, worldW: number, worldH: number, draw: (ctx: CanvasRenderingContext2D) => void): LodSprite {
  const cached = lodSprites.get(key)
  if (cached) return cached
  const full = document.createElement('canvas')
  full.width = Math.max(1, Math.ceil(worldW))
  full.height = Math.max(1, Math.ceil(worldH))
  const pen = full.getContext('2d')
  const bucket = Number(key.slice(key.lastIndexOf(':') + 1))
  const scale = Number.isFinite(bucket) && bucket > 0 ? bucket : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(worldW * scale))
  canvas.height = Math.max(1, Math.ceil(worldH * scale))
  const sprite: LodSprite = { canvas, worldW, worldH }
  if (!pen) {
    lodSprites.set(key, sprite)
    return sprite
  }
  pen.imageSmoothingEnabled = true
  draw(pen)
  const out = canvas.getContext('2d')
  if (out) {
    out.imageSmoothingEnabled = true
    out.imageSmoothingQuality = 'high'
    out.drawImage(full, 0, 0, canvas.width, canvas.height)
  }
  lodSprites.set(key, sprite)
  if (lodSprites.size > 600) lodSprites.clear()
  lodSprites.set(key, sprite)
  return sprite
}

const terrainSheets = new WeakMap<HTMLCanvasElement, Map<number, HTMLCanvasElement>>()

function terrainLod(terrain: HTMLCanvasElement, bucket: number): HTMLCanvasElement {
  let levels = terrainSheets.get(terrain)
  if (!levels) {
    levels = new Map()
    terrainSheets.set(terrain, levels)
  }
  const cached = levels.get(bucket)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(terrain.width * bucket))
  canvas.height = Math.max(1, Math.ceil(terrain.height * bucket))
  const pen = canvas.getContext('2d')
  if (pen) {
    pen.imageSmoothingEnabled = true
    pen.imageSmoothingQuality = 'high'
    pen.drawImage(terrain, 0, 0, canvas.width, canvas.height)
  }
  levels.set(bucket, canvas)
  return canvas
}

function blitLod(ctx: CanvasRenderingContext2D, sprite: LodSprite, x: number, y: number): void {
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(sprite.canvas, x, y, sprite.worldW, sprite.worldH)
  ctx.restore()
}

function drawRockLod(
  ctx: CanvasRenderingContext2D,
  kind: 'rock' | 'tree' | undefined,
  tx: number,
  ty: number,
  seed: number,
  bucket: number,
): void {
  if (kind === 'tree') {
    const index = treeVariant(tx, ty, seed)
    const src = treeVariantSprite(index)
    if (!src) return
    const sprite = lodSprite(`tree:${index}:${bucket}`, src.width, src.height, (pen) => {
      pen.drawImage(src, 0, 0)
    })
    blitLod(ctx, sprite, tx * TILE - 8, ty * TILE - 22)
    return
  }
  const index = rockVariant(tx, ty, seed)
  const src = rockVariantSprite(index)
  if (!src) return
  const sprite = lodSprite(`rock:${index}:${bucket}`, src.width, src.height, (pen) => {
    pen.drawImage(src, 0, 0)
  })
  blitLod(ctx, sprite, tx * TILE - 6, ty * TILE - 6)
}

function drawOreLod(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  seed: number,
  amount: number,
  full: number,
  selected: boolean,
  bucket: number,
): void {
  const x = (tx + 0.5) * TILE
  const y = (ty + 0.5) * TILE
  if (selected) {
    ctx.save()
    ctx.strokeStyle = 'rgba(244, 241, 196, 0.95)'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.ellipse(x, y + 6, 18, 10, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  const index = oreVariant(tx, ty, seed)
  const src = oreVariantSprite(index)
  if (!src) return
  const ratio = full > 0 ? Math.max(0.15, Math.min(1, amount / full)) : 1
  const step = Math.round(ratio * 4) / 4
  const scale = 0.68 + 0.32 * step
  const sprite = lodSprite(`ore:${index}:${step}:${bucket}`, 72, 72, (pen) => {
    pen.translate(36, 44)
    pen.scale(scale, scale)
    pen.drawImage(src, -25, -32, 50, 44)
  })
  blitLod(ctx, sprite, x - 36, y - 44)
}

function drawBatteryLod(ctx: CanvasRenderingContext2D, x: number, y: number, bucket: number): void {
  const sprite = lodSprite(`battery:${bucket}`, 32, 32, (pen) => {
    drawBattery(pen, 16, 16)
  })
  blitLod(ctx, sprite, x - 16, y - 16)
}

function drawGraveLod(ctx: CanvasRenderingContext2D, x: number, y: number, selected: boolean, bucket: number): void {
  if (selected) {
    ctx.save()
    ctx.strokeStyle = 'rgba(244, 241, 196, 0.95)'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.ellipse(x, y + 4, 12, 7, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  const sprite = lodSprite(`grave:${bucket}`, 48, 56, (pen) => {
    pen.translate(8, 24)
    drawGraveSprite(pen, 0, 0, false)
  })
  blitLod(ctx, sprite, x - 24, y - 40)
}

function buildingLod(state: MatchState, building: Building, bucket: number): LodSprite {
  const stats = BUILDING_STATS[building.kind]
  const worldW = stats.w * TILE + LOD_PAD * 2
  const worldH = stats.h * TILE + LOD_PAD * 2
  const color = building.ruined ? '#6a645c' : teamColor(building.owner)
  const stage =
    building.kind === 'keep'
      ? building.ruined
        ? 4
        : keepDamageStage(building.hp, stats.hp)
      : building.kind === 'yard'
        ? factoryDamageStage(building.hp, stats.hp)
        : building.kind === 'tower'
          ? pillarDamageStage(building.hp, stats.hp)
          : storageDamageStage(building.hp, stats.hp)
  let detail = `${stage}`
  if (building.kind === 'keep') {
    const fill = building.ruined ? 0 : Math.round(keepFillLevel(building.stock) * 4) / 4
    const held = building.cryo ? (ghostHeld.get(building) ?? cryoOccupants(state, building.id)) : 0
    detail = `${stage}:${building.cryo && !building.ruined ? 1 : 0}:${fill.toFixed(2)}:${held}`
  } else if (building.kind === 'silo') {
    const stock = building.complete && !building.ruined ? building.stock : 0
    detail = `${stage}:${storageCylinderCount(stock)}`
  } else if (building.kind === 'yard') {
    const built = building.complete || building.ruined ? 1 : Math.round(building.progress * 4) / 4
    detail = `${stage}:${built.toFixed(2)}`
  }
  const key = `${building.kind}:${building.owner}:${detail}:${bucket}`
  return lodSprite(key, worldW, worldH, (ctx) => {
    ctx.translate(LOD_PAD, LOD_PAD)
    if (building.kind === 'keep') {
      drawKeepSprite(ctx, 0, 0, {
        color,
        open: 0,
        lit: building.ruined ? 0 : Math.round(keepFillLevel(building.stock) * 4) / 4,
        stage,
        dish: 0.6,
        progress: -1,
        smoke: 0,
        cryo: building.cryo && !building.ruined,
        held: building.cryo ? (ghostHeld.get(building) ?? cryoOccupants(state, building.id)) : 0,
      })
    } else if (building.kind === 'yard') {
      const built = building.complete || building.ruined ? 1 : Math.round(building.progress * 4) / 4
      drawFactorySprite(ctx, 0, 0, {
        color,
        owner: building.owner,
        open: 0,
        stage,
        progress: -1,
        kind: null,
        busy: false,
        time: 0,
        built,
      })
    } else if (building.kind === 'tower') {
      drawPillarSprite(ctx, 0, 0, {
        color,
        stage,
        time: 0,
        charging: false,
        aim: Math.PI / 2,
        flash: false,
      })
    } else {
      const stock = building.complete && !building.ruined ? storageCylinderCount(building.stock) * 250 : 0
      drawStorageSprite(ctx, 0, 0, color, stock, stage)
    }
  })
}

function drawBuildingLod(ctx: CanvasRenderingContext2D, state: MatchState, building: Building, bucket: number): void {
  const sprite = buildingLod(state, building, bucket)
  const x = building.tx * TILE
  const y = building.ty * TILE
  ctx.save()
  ctx.imageSmoothingEnabled = true
  if (!building.complete && !building.ruined) ctx.globalAlpha = 0.45 + building.progress * 0.5
  ctx.drawImage(sprite.canvas, x - LOD_PAD, y - LOD_PAD, sprite.worldW, sprite.worldH)
  ctx.restore()
  drawBuildingChrome(ctx, state, building, false)
}

function unitLod(kind: Unit['kind'], owner: number, bucket: number): LodSprite {
  const key = `unit:${kind}:${owner}:${bucket}`
  return lodSprite(key, UNIT_BOX, UNIT_BOX, (ctx) => {
    const color = teamColor(owner)
    ctx.translate(UNIT_BOX / 2, UNIT_BOX / 2)
    ctx.fillStyle = 'rgba(16, 12, 8, 0.34)'
    ctx.beginPath()
    ctx.ellipse(2, 8, 12, 4, 0, 0, Math.PI * 2)
    ctx.fill()
    if (kind === 'porter') ctx.drawImage(stalkerFrame(owner, LOD_DIR, 0, false, false), -26, -30)
    else if (kind === 'pike') ctx.drawImage(flasherFrame(owner, LOD_DIR, 0, false, false), -32, -34)
    else if (kind === 'howler') ctx.drawImage(gorillaFrame(owner, LOD_DIR, 0, false, false), -36, -38)
    else if (kind === 'frog') ctx.drawImage(frogFrame(owner, LOD_DIR, 0), -36, -40)
    else {
      ctx.translate(0, -6)
      ctx.drawImage(hoverFrame(owner, LOD_DIR, 0), -28, -30)
      paintHoverRotors(ctx, LOD_DIR, 0.4, color)
    }
  })
}

function drawUnitLod(ctx: CanvasRenderingContext2D, unit: Unit, selected: boolean, bucket: number): void {
  const stats = UNIT_STATS[unit.kind]
  const sprite = unitLod(unit.kind, unit.owner, bucket)
  ctx.save()
  ctx.imageSmoothingEnabled = true
  if (isShutdown(unit)) ctx.globalAlpha = 0.35
  else if (unit.cloak > 0) ctx.globalAlpha = 0.45
  ctx.drawImage(sprite.canvas, unit.x - UNIT_BOX / 2, unit.y - UNIT_BOX / 2, sprite.worldW, sprite.worldH)
  ctx.restore()
  if (selected) {
    ctx.strokeStyle = 'rgba(244, 241, 196, 0.95)'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.ellipse(unit.x, unit.y + 3, stats.radius + 5, stats.radius * 0.62, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  if (unit.ice > 0) {
    ctx.save()
    ctx.translate(unit.x, unit.y)
    ctx.fillStyle = 'rgba(186, 228, 244, 0.42)'
    ctx.strokeStyle = 'rgba(244, 252, 255, 0.9)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.ellipse(0, 2, stats.radius + 6, stats.radius * 0.78 + 4, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
  const powered = powerSeconds(unit.kind) > 0
  if (powered || selected || unit.hp < stats.hp - 0.5) {
    bar(ctx, unit.x - 12, unit.y - stats.radius - 10, 24, unit.hp / stats.hp, hpColor(unit.hp / stats.hp))
  }
  if (powered) bar(ctx, unit.x - 12, unit.y - stats.radius - 4, 24, unit.power, unit.power <= 0 ? '#6d7c84' : '#3ec6ff')
}

function drawBuilding(ctx: CanvasRenderingContext2D, state: MatchState, building: Building): void {
  const stats = BUILDING_STATS[building.kind]
  const x = building.tx * TILE
  const y = building.ty * TILE
  const w = stats.w * TILE
  const h = stats.h * TILE
  const color = building.ruined ? '#6a645c' : (PLAYER_COLOR[building.owner] ?? PLAYER_COLOR[0])
  ctx.save()
  if (
    building.kind !== 'keep' &&
    building.kind !== 'yard' &&
    building.kind !== 'silo' &&
    building.kind !== 'tower'
  ) {
    ctx.fillStyle = 'rgba(16, 12, 8, 0.2)'
    ctx.beginPath()
    ctx.ellipse(x + w * 0.58, y + h * 0.7, w * 0.42, h * 0.14, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(16, 12, 8, 0.28)'
    ctx.beginPath()
    ctx.ellipse(x + w * 0.52 + 4, y + h * 0.78, w * 0.3, 5.5, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  if (!building.complete && !building.ruined) ctx.globalAlpha = 0.45 + building.progress * 0.5

  if (building.kind === 'keep') drawKeep(ctx, state, building, x, y, color)
  else if (building.kind === 'yard') drawYard(ctx, state, building, x, y, color)
  else if (building.kind === 'tower') drawTower(ctx, state, building, x, y, color)
  else drawStorage(ctx, state, building, x, y, color)

  ctx.restore()
  drawBuildingChrome(ctx, state, building, true)
}

function drawBuildingChrome(
  ctx: CanvasRenderingContext2D,
  state: MatchState,
  building: Building,
  labels: boolean,
): void {
  const stats = BUILDING_STATS[building.kind]
  const x = building.tx * TILE
  const y = building.ty * TILE
  const w = stats.w * TILE
  const h = stats.h * TILE
  const selected = state.selectedBuilding === building.id
  if (!building.ruined && building.hp < stats.hp) {
    ctx.strokeStyle = 'rgba(40, 24, 18, 0.45)'
    ctx.beginPath()
    ctx.moveTo(x + w * 0.3, y + 10)
    ctx.lineTo(x + w * 0.55, y + h * 0.6)
    ctx.lineTo(x + w * 0.7, y + h - 8)
    ctx.stroke()
  }

  if (building.ruined) {
    const repairing = state.units.some(
      (unit) => unit.order?.type === 'repair' && unit.order.buildingId === building.id && unit.hp > 0,
    )
    if (building.progress > 0 || repairing) {
      bar(ctx, x + 8, y - 8, w - 16, building.progress, '#e6c15a')
      if (labels) {
        ctx.fillStyle = '#f4e7bf'
        ctx.font = '10px "Segoe UI", sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(repairing && building.progress < 1 ? 'Repairing' : 'Paused', x + w / 2, y - 12)
      }
    }
  } else if (!building.complete) {
    bar(ctx, x + 8, y - 8, w - 16, building.progress, '#e6c15a')
    if (labels) {
      ctx.fillStyle = '#f4e7bf'
      ctx.font = '10px "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      const crew = state.units.some(
        (unit) => unit.order?.type === 'construct' && unit.order.buildingId === building.id && unit.hp > 0,
      )
      ctx.fillText(crew ? 'Raising' : 'Paused', x + w / 2, y - 12)
    }
  } else if (building.kind === 'keep' && building.cryo && building.cryoRecover > 0) {
    const remain = building.cryoRecover
    bar(ctx, x + 8, y - 8, w - 16, 1 - remain / CRYO_RECOVER, '#9fd7e8')
    if (labels) {
      ctx.fillStyle = '#f4e7bf'
      ctx.font = '10px "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`Recovery ${formatRecover(remain)}`, x + w / 2, y - 12)
    }
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
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  drawKeepSprite(ctx, x, y, {
    color,
    open: building.ruined ? 0 : keepDoorSlide(building.hatch),
    lit: building.ruined ? 0 : keepFillLevel(building.stock),
    id: building.id,
    stage: building.ruined ? 4 : keepDamageStage(building.hp, stats.hp),
    dish: building.dish,
    progress: building.ruined ? -1 : progress,
    smoke: state.time,
    cryo: building.cryo && !building.ruined,
    held: ghostHeld.get(building) ?? (building.cryo ? cryoOccupants(state, building.id) : 0),
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

function pillarCharging(state: MatchState, building: Building): boolean {
  if (ghostDraw.has(building)) return false
  if (!building.complete || building.ruined || building.hp <= 0) return false
  const origin = buildingCenter(building)
  const reach = BUILDING_STATS.tower.sight
  for (const unit of state.units) {
    if (unit.owner !== building.owner || unit.hp <= 0 || unit.frozen != null) continue
    if (powerSeconds(unit.kind) <= 0 || unit.power >= 1) continue
    if (Math.hypot(origin.x - unit.x, origin.y - unit.y) <= reach) return true
  }
  return false
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
    time: state.time,
    charging: pillarCharging(state, building),
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
  const stock = building.complete && !building.ruined ? building.stock : 0
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  drawStorageSprite(ctx, x, y, color, stock, storageDamageStage(building.hp, stats.hp), {
    id: building.id,
    time: state.time,
  })
  ctx.restore()
  ctx.imageSmoothingEnabled = false
}

/** Faint owner-only wedge. The leading edge matches the dish, and the trail fades behind it. */
function drawFlyRadar(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string): void {
  const reach = UNIT_STATS.drone.sight
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.fillStyle = color
  for (let step = 6; step >= 1; step--) {
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, reach, -0.16 * step, 0.05)
    ctx.closePath()
    ctx.globalAlpha = 0.028 * (7 - step)
    ctx.fill()
  }
  ctx.globalAlpha = 0.4
  ctx.strokeStyle = color
  ctx.lineWidth = 1.25
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(reach, 0)
  ctx.stroke()
  ctx.restore()
}

function drawUnit(ctx: CanvasRenderingContext2D, state: MatchState, unit: Unit, selected: boolean): void {
  const stats = UNIT_STATS[unit.kind]
  const bob =
    unit.kind === 'drone'
      ? Math.sin(state.time * 3.1 + unit.id * 0.7) * 1.15
      : unit.goalX != null
        ? Math.sin(unit.anim) * 1.1
        : 0

  if (unit.kind === 'drone' && unit.guarding && viewerOwns(state, unit.owner)) {
    drawFlyRadar(ctx, unit.x, unit.y, state.time * FLY_RADAR_SPIN + unit.id, teamColor(unit.owner))
  }

  if (selected || (state.tutorial && unit.owner === controlledSide(state) && unit.kind === 'porter')) {
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
  if (isShutdown(unit)) ctx.globalAlpha = 0.35
  else if (unit.cloak > 0) ctx.globalAlpha = 0.45
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
    const accent = teamColor(unit.owner)
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
    if (unit.guarding && viewerOwns(state, unit.owner)) paintHoverDish(ctx, state.time * FLY_RADAR_SPIN + unit.id, accent)
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
  } else if (unit.kind === 'frog') {
    ctx.fillStyle = 'rgba(16, 12, 8, 0.34)'
    ctx.beginPath()
    ctx.ellipse(2, 9, 16, 5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.drawImage(frogSprite(unit), -36, -40)
    if (unit.hitFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, unit.hitFlash * 3)})`
      ctx.beginPath()
      ctx.arc(0, 0, stats.radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  } else {
    ctx.restore()
  }

  if (unit.ice > 0) {
    ctx.save()
    ctx.translate(unit.x, unit.y)
    ctx.fillStyle = 'rgba(186, 228, 244, 0.42)'
    ctx.strokeStyle = 'rgba(244, 252, 255, 0.9)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.ellipse(0, 2, stats.radius + 6, stats.radius * 0.78 + 4, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)'
    ctx.beginPath()
    ctx.moveTo(-stats.radius, -2)
    ctx.lineTo(stats.radius * 0.2, stats.radius * 0.45)
    ctx.moveTo(stats.radius * 0.35, -stats.radius * 0.4)
    ctx.lineTo(-2, stats.radius * 0.55)
    ctx.stroke()
    ctx.restore()
    const label = `${Math.ceil(unit.ice)}s`
    ctx.save()
    ctx.font = 'bold 11px "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.lineWidth = 3
    ctx.strokeStyle = '#16323c'
    ctx.fillStyle = '#e7f8ff'
    ctx.strokeText(label, unit.x, unit.y - stats.radius - 16)
    ctx.fillText(label, unit.x, unit.y - stats.radius - 16)
    ctx.restore()
  }

  const powered = powerSeconds(unit.kind) > 0
  const showHp = powered || selected || unit.hp < stats.hp - 0.5 || unit.hitFlash > 0
  if (showHp) bar(ctx, unit.x - 12, unit.y - stats.radius - 10, 24, unit.hp / stats.hp, hpColor(unit.hp / stats.hp))
  if (powered) {
    const charging = inFriendlyPillarSight(state, unit) && unit.power < 1
    const wave = 0.5 + 0.5 * Math.sin(state.time * 5)
    const powerColor = !charging ? (unit.power <= 0 ? '#6d7c84' : '#3ec6ff') : wave > 0.5 ? '#d8fbff' : '#3ec6ff'
    const barX = unit.x - 12
    const barY = unit.y - stats.radius - 4
    bar(ctx, barX, barY, 24, unit.power, powerColor)
    if (charging) {
      ctx.save()
      ctx.strokeStyle = `rgba(186, 244, 255, ${0.25 + wave * 0.55})`
      ctx.lineWidth = 1
      ctx.strokeRect(barX - 0.5, barY - 0.5, 25, 5)
      ctx.restore()
    }
  }

  if (unit.cloak > 0) {
    const label = `${Math.ceil(unit.cloak)}s`
    ctx.save()
    ctx.font = 'bold 11px "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.lineWidth = 3
    ctx.strokeStyle = '#2a2a2a'
    ctx.fillStyle = '#f4f1c4'
    const labelY = unit.y - stats.radius - 16
    ctx.strokeText(label, unit.x, labelY)
    ctx.fillText(label, unit.x, labelY)
    ctx.restore()
  }

  if (unit.owner === controlledSide(state) && unit.kind === 'porter' && !unit.order) {
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

function drawLessonMark(ctx: CanvasRenderingContext2D, state: MatchState): void {
  const hint = lessonView(state)
  if (!hint?.world) return
  const pulse = 14 + Math.sin(state.time * 5) * 6
  ctx.save()
  ctx.strokeStyle = 'rgba(230, 193, 90, 0.95)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(hint.world.x, hint.world.y, 18 + pulse, 0, Math.PI * 2)
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

function drawBattery(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = 'rgba(16, 12, 8, 0.35)'
  ctx.beginPath()
  ctx.ellipse(1, 8, 7, 2.4, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#10262c'
  ctx.strokeStyle = '#d7fff6'
  ctx.lineWidth = 1.2
  ctx.fillRect(-6, -4, 12, 10)
  ctx.strokeRect(-6.5, -4.5, 13, 11)
  ctx.fillStyle = '#3ec6ff'
  ctx.fillRect(-4, -2, 8, 6)
  ctx.fillStyle = '#e9fbff'
  ctx.fillRect(-2, -7, 4, 3)
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
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(minimapGround(state), ox, oy, frame.w, frame.h)
  ctx.fillStyle = '#d4894a'
  for (const node of state.ore) {
    if (!viewGroundShown(state, node.tx, node.ty)) continue
    ctx.globalAlpha = viewTileVisible(state, node.tx, node.ty) ? 1 : 0.45
    ctx.fillRect(ox + node.tx * sx, oy + node.ty * sy, sx, sy)
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = '#3ec6ff'
  for (const battery of state.batteries) {
    if (!viewGroundShown(state, battery.tx, battery.ty)) continue
    ctx.globalAlpha = viewTileVisible(state, battery.tx, battery.ty) ? 1 : 0.45
    ctx.fillRect(ox + battery.tx * sx, oy + battery.ty * sy, sx, sy)
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
    if (unit.cloak > 0) ctx.globalAlpha = 0.45
    ctx.fillRect(px - 1, py - 1, 2.2, 2.2)
    if (unit.cloak > 0) ctx.globalAlpha = 1
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
