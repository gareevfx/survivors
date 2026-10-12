import { sideKnowsEnemyKeep, updateSiloAi } from './siloAi'
import { updateScanners } from './scanner'
import { assignMiners, coverOpenSites, debitDumps, fillOpenGatherSlots, redirectStuckPorter } from './commands'
import { circleHitsSolid, gatherBlockRock, groundMoveBlocked, nearestParking, nearestWalkable, setUnitDestination, stopMoving } from './nav'
import { rockShotClear } from './pathfind'
import { yardEntrance } from './factoryArt'
import { keepEntrance } from './siloArt'
import { updateVision } from './vision'
import {
  buildingById,
  isWalkable,
  buildingCenter,
  buildingRect,
  buildingTarget,
  distToRect,
  getTarget,
  pushToast,
  rebuildBlocked,
  recomputeSupply,
  rockById,
  unitById,
  unitTarget,
} from './state'
import {
  AGGRO_RANGE,
  BUILDING_STATS,
  CHASE_BREAK,
  GATHER_AMOUNT,
  GATHER_TIME,
  INTERACT,
  SILO_REPAIR_COST,
  SILO_REPAIR_TIME,
  STORAGE_CAP,
  PLAYER_COLOR,
  PLAYER_NAME,
  STALKER_LIFESPAN,
  STUCK_REDIRECT_SECONDS,
  TILE,
  UNIT_STATS,
  type Building,
  type MatchState,
  type Order,
  type Target,
  type Unit,
} from './types'

export function step(state: MatchState, dt: number): void {
  if (state.outcome || state.paused) return
  state.time += dt
  updateSiloAi(state, dt)

  for (const unit of state.units) refreshUnit(state, unit, dt)
  releaseFromTerrain(state)
  for (const unit of state.units) moveUnit(state, unit, dt)
  separate(state)
  releaseFromTerrain(state)
  advanceGather(state, dt)
  advanceConstruct(state, dt)
  advanceRepair(state, dt)
  advanceProduction(state, dt)

  for (const unit of state.units) {
    unit.attackCd = Math.max(0, unit.attackCd - dt)
    unit.hitFlash = Math.max(0, unit.hitFlash - dt)
    unit.hurtTimer = Math.max(0, unit.hurtTimer - dt)
    if (unit.kind === 'porter' && unit.hp > 0) {
      unit.age += dt
      if (unit.age >= STALKER_LIFESPAN) unit.hp = 0
    }
    tryFire(state, unit)
  }
  for (const building of state.buildings) {
    building.hitFlash = Math.max(0, building.hitFlash - dt)
    building.alert = Math.max(0, building.alert - dt)
    if (building.hatch > 0) building.hatch = Math.max(0, building.hatch - dt)
    if (building.kind === 'keep' && building.hp > 0) {
      const busy = !building.complete || building.queue.length > 0
      building.dish += dt * (busy ? 0.95 : 0.42)
    }
    if (building.kind === 'tower') tryFireTower(state, building, dt)
  }
  for (const rock of state.rocks) rock.hitFlash = Math.max(0, rock.hitFlash - dt)
  updateProjectiles(state, dt)
  cleanup(state)
  coverOpenSites(state)
  fillOpenGatherSlots(state)
  watchStuckUnits(state, dt)
  updateVision(state)
  updateScanners(state)
  fadeEffects(state, dt)
  recomputeSupply(state)
}

function refreshUnit(state: MatchState, unit: Unit, dt: number): void {
  unit.repathIn = Math.max(0, unit.repathIn - dt)
  const order = unit.order
  if (!order) {
    if (unit.kind === 'porter' && unit.cargo > 0) {
      unit.order = { type: 'gather', nodeId: unit.nodeMemory, phase: 'return' }
      return
    }
    if (unit.kind !== 'porter' && unit.kind !== 'drone') {
      const stats = UNIT_STATS[unit.kind]
      const foe =
        nearestHostile(state, unit, stats.sight, false) ??
        nearestHostile(state, unit, stats.range + 28, true)
      if (foe && (foe.targetKind === 'unit' || dist(unit, foe) <= stats.range + foe.radius)) {
        unit.order = { type: 'attack', targetId: foe.id, kind: foe.targetKind }
        unit.idleAcquire = true
        unit.leashX = unit.x
        unit.leashY = unit.y
        stopMoving(unit)
      }
    }
    return
  }

  if (order.type === 'move') {
    if (unit.goalX == null) setUnitDestination(state, unit, order.x, order.y)
    return
  }

  if (order.type === 'attackMove') {
    let focus =
      order.focusId != null && order.focusKind ? getTarget(state, order.focusId, order.focusKind) : null
    if (focus && coveredStalkerTarget(state, focus)) focus = null
    if (focus && (!isAttackable(unit, focus) || dist(unit, focus) > CHASE_BREAK)) focus = null
    if (!focus) {
      order.focusId = null
      order.focusKind = null
      const foe = nearestHostile(state, unit, AGGRO_RANGE, true)
      if (foe) {
        order.focusId = foe.id
        order.focusKind = foe.targetKind
        focus = foe
      }
    }
    if (focus) holdOrApproach(state, unit, focus)
    else if (unit.goalX == null) setUnitDestination(state, unit, order.x, order.y)
    return
  }

  if (order.type === 'attack') {
    const focus = getTarget(state, order.targetId, order.kind)
    if (!focus || !isAttackable(unit, focus)) {
      const resumeOrder = order.kind === 'rock' ? order.resume : undefined
      const resumeNode = order.kind === 'rock' ? order.resumeNode : undefined
      unit.order = null
      unit.idleAcquire = false
      stopMoving(unit)
      if (resumeOrder && unit.kind === 'porter' && unit.hp > 0) unit.order = resumeOrder
      else if (resumeNode != null && unit.kind === 'porter' && unit.hp > 0) resumeGather(state, unit, resumeNode)
      return
    }
    if (unit.idleAcquire && unit.leashX != null && unit.leashY != null) {
      const away = Math.hypot(unit.x - unit.leashX, unit.y - unit.leashY)
      if (away > AGGRO_RANGE * 1.6 || dist(unit, focus) > CHASE_BREAK) {
        const lx = unit.leashX
        const ly = unit.leashY
        unit.idleAcquire = false
        unit.order = { type: 'move', x: lx, y: ly }
        setUnitDestination(state, unit, lx, ly)
        return
      }
    }
    holdOrApproach(state, unit, focus)
    return
  }

  if (order.type === 'gather') {
    refreshGather(state, unit, order)
    return
  }

  if (order.type === 'repair') {
    refreshRepair(state, unit, order)
    return
  }

  refreshConstruct(state, unit, order)
}

function holdOrApproach(state: MatchState, unit: Unit, focus: Target): void {
  if (inWeaponRange(unit, focus) && shotClear(state, unit.x, unit.y, focus.x, focus.y)) {
    stopMoving(unit)
    unit.facing = Math.atan2(focus.y - unit.y, focus.x - unit.x)
    return
  }
  const stand = standPoint(state, unit, focus)
  const far = unit.goalX == null || Math.hypot((unit.goalX ?? 0) - stand.x, (unit.goalY ?? 0) - stand.y) > 24
  if (far && unit.repathIn <= 0) {
    setUnitDestination(state, unit, stand.x, stand.y)
    unit.repathIn = 0.4
  }
}

function standPoint(state: MatchState, unit: Unit, focus: Target): { x: number; y: number } {
  const stats = UNIT_STATS[unit.kind]
  if (focus.targetKind === 'rock') {
    const tx = Math.floor(focus.x / TILE)
    const ty = Math.floor(focus.y / TILE)
    let best: { x: number; y: number; d: number } | null = null
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        if (!isWalkable(state, tx + dx, ty + dy)) continue
        const x = (tx + dx + 0.5) * TILE
        const y = (ty + dy + 0.5) * TILE
        if (circleHitsSolid(state, x, y, stats.radius)) continue
        if (Math.hypot(x - focus.x, y - focus.y) > stats.range + focus.radius * 0.85) continue
        if (!shotClear(state, x, y, focus.x, focus.y)) continue
        const d = (x - unit.x) ** 2 + (y - unit.y) ** 2
        if (!best || d < best.d) best = { x, y, d }
      }
    }
    if (best) return best
  }
  const dx = unit.x - focus.x
  const dy = unit.y - focus.y
  const d = Math.hypot(dx, dy) || 1
  const reach = stats.range + focus.radius * 0.85
  const stand = Math.max(focus.radius + stats.radius + 4, reach * 0.86)
  return { x: focus.x + (dx / d) * stand, y: focus.y + (dy / d) * stand }
}

function inWeaponRange(unit: Unit, focus: Target): boolean {
  const stats = UNIT_STATS[unit.kind]
  return dist(unit, focus) <= stats.range + focus.radius * 0.85
}

function shotClear(state: MatchState, x0: number, y0: number, x1: number, y1: number): boolean {
  return rockShotClear(
    state.tiles,
    state.mapW,
    state.mapH,
    { tx: Math.floor(x0 / TILE), ty: Math.floor(y0 / TILE) },
    { tx: Math.floor(x1 / TILE), ty: Math.floor(y1 / TILE) },
  )
}

function dist(unit: Unit, focus: Target): number {
  return Math.hypot(unit.x - focus.x, unit.y - focus.y)
}

function refreshGather(state: MatchState, unit: Unit, order: Extract<Order, { type: 'gather' }>): void {
  if (order.binId != null) {
    refreshBinGather(state, unit, order)
    return
  }
  const node = state.ore.find((entry) => entry.id === order.nodeId) ?? null
  if ((!node || node.amount <= 0) && unit.cargo <= 0) {
    if (order.phase !== 'return') {
      assignMiners(state, [unit], null)
      return
    }
    if (unit.cargo <= 0) {
      unit.order = null
      unit.nodeMemory = 0
      stopMoving(unit)
      return
    }
  }

  if (order.phase === 'mine') {
    if (!node || node.amount <= 0 || distToTile(unit, node.tx, node.ty) > INTERACT) {
      order.phase = 'approach'
      stopMoving(unit)
    } else {
      stopMoving(unit)
      const cx = (node.tx + 0.5) * TILE
      const cy = (node.ty + 0.5) * TILE
      unit.facing = Math.atan2(cy - unit.y, cx - unit.x)
    }
    return
  }

  if (order.phase === 'approach') {
    if (unit.cargo > 0) {
      order.phase = 'return'
      stopMoving(unit)
      return
    }
    if (!node || node.amount <= 0) {
      assignMiners(state, [unit], null)
      return
    }
    if (distToTile(unit, node.tx, node.ty) <= INTERACT) {
      order.phase = 'mine'
      unit.gatherTimer = 0
      stopMoving(unit)
      return
    }
    if (unit.goalX == null) {
      const spot = nearestParking(state, node.tx, node.ty, 1, 1, unit.x, unit.y)
      if (!spot) {
        clearBlockedGather(state, unit, node)
        return
      }
      if (!setUnitDestination(state, unit, spot.x, spot.y)) clearBlockedGather(state, unit, node)
    }
    return
  }

  approachDropoff(state, unit)
}

function refreshBinGather(state: MatchState, unit: Unit, order: Extract<Order, { type: 'gather' }>): void {
  const bin = order.binId != null ? buildingById(state, order.binId) : undefined
  const open = !!bin && bin.hp > 0 && bin.kind === 'silo' && bin.owner !== unit.owner && bin.stock > 0
  if (order.phase === 'mine') {
    if (!open || !bin || distToRect(unit.x, unit.y, buildingRect(bin)) > INTERACT) {
      order.phase = 'approach'
      stopMoving(unit)
    } else {
      stopMoving(unit)
      const center = buildingCenter(bin)
      unit.facing = Math.atan2(center.y - unit.y, center.x - unit.x)
    }
    return
  }
  if (order.phase === 'approach') {
    if (unit.cargo > 0) {
      order.phase = 'return'
      stopMoving(unit)
      return
    }
    if (!open || !bin) {
      unit.order = null
      stopMoving(unit)
      return
    }
    if (distToRect(unit.x, unit.y, buildingRect(bin)) <= INTERACT) {
      order.phase = 'mine'
      unit.gatherTimer = 0
      stopMoving(unit)
      return
    }
    if (unit.goalX == null) {
      const stats = BUILDING_STATS.silo
      const spot = nearestParking(state, bin.tx, bin.ty, stats.w, stats.h, unit.x, unit.y)
      if (spot) setUnitDestination(state, unit, spot.x, spot.y)
    }
    return
  }
  approachDropoff(state, unit)
}

function refreshRepair(state: MatchState, unit: Unit, order: Extract<Order, { type: 'repair' }>): void {
  const building = buildingById(state, order.buildingId)
  if (!building?.ruined) {
    unit.order = null
    stopMoving(unit)
    return
  }
  const rect = buildingRect(building)
  if (distToRect(unit.x, unit.y, rect) <= INTERACT) {
    stopMoving(unit)
    const center = buildingCenter(building)
    unit.facing = Math.atan2(center.y - unit.y, center.x - unit.x)
    return
  }
  if (unit.goalX == null) {
    const stats = BUILDING_STATS.keep
    const spot = nearestParking(state, building.tx, building.ty, stats.w, stats.h, unit.x, unit.y)
    if (spot) setUnitDestination(state, unit, spot.x, spot.y)
  }
}

function refreshConstruct(state: MatchState, unit: Unit, order: Extract<Order, { type: 'construct' }>): void {
  const building = buildingById(state, order.buildingId)
  if (!building || building.hp <= 0 || building.complete) {
    unit.order = null
    stopMoving(unit)
    return
  }
  const rect = buildingRect(building)
  if (distToRect(unit.x, unit.y, rect) <= INTERACT) {
    stopMoving(unit)
    const center = buildingCenter(building)
    unit.facing = Math.atan2(center.y - unit.y, center.x - unit.x)
    return
  }
  if (unit.goalX == null) {
    const stats = BUILDING_STATS[building.kind]
    const spot = nearestParking(state, building.tx, building.ty, stats.w, stats.h, unit.x, unit.y)
    if (spot) setUnitDestination(state, unit, spot.x, spot.y)
  }
}

function distToTile(unit: Unit, tx: number, ty: number): number {
  const rect = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE }
  return distToRect(unit.x, unit.y, rect)
}

function clearBlockedGather(state: MatchState, unit: Unit, node: { id: number; tx: number; ty: number }): boolean {
  if (unit.kind !== 'porter') return false
  const rock = gatherBlockRock(state, unit, node)
  if (!rock) return false
  unit.order = { type: 'attack', targetId: rock.id, kind: 'rock', resumeNode: node.id }
  unit.nodeMemory = node.id
  stopMoving(unit)
  return true
}

function resumeGather(state: MatchState, unit: Unit, nodeId: number): void {
  const node = state.ore.find((entry) => entry.id === nodeId && entry.amount > 0)
  if (!node) {
    unit.nodeMemory = 0
    return
  }
  const rock = gatherBlockRock(state, unit, node)
  unit.nodeMemory = nodeId
  if (rock) unit.order = { type: 'attack', targetId: rock.id, kind: 'rock', resumeNode: nodeId }
  else unit.order = { type: 'gather', nodeId, phase: unit.cargo > 0 ? 'return' : 'approach' }
  stopMoving(unit)
}

function storageAccepts(building: Building): boolean {
  return building.kind !== 'silo' || building.stock < STORAGE_CAP
}

function nearestDropoff(state: MatchState, owner: number, x: number, y: number): Building | null {
  let best: Building | null = null
  let bestD = Infinity
  for (const building of state.buildings) {
    if (building.owner !== owner || !building.complete || building.hp <= 0) continue
    if (building.kind !== 'keep' && building.kind !== 'silo') continue
    if (!storageAccepts(building)) continue
    const center = buildingCenter(building)
    const d = (center.x - x) ** 2 + (center.y - y) ** 2
    if (d < bestD) {
      bestD = d
      best = building
    }
  }
  return best
}

function approachDropoff(state: MatchState, unit: Unit): void {
  const drop = nearestDropoff(state, unit.owner, unit.x, unit.y)
  if (!drop) {
    stopMoving(unit)
    return
  }
  const rect = buildingRect(drop)
  if (distToRect(unit.x, unit.y, rect) <= INTERACT) {
    stopMoving(unit)
    return
  }
  const aimed =
    unit.goalX != null && unit.goalY != null && distToRect(unit.goalX, unit.goalY, rect) <= INTERACT
  if (aimed) return
  const stats = BUILDING_STATS[drop.kind]
  const spot = nearestParking(state, drop.tx, drop.ty, stats.w, stats.h, unit.x, unit.y)
  if (spot) setUnitDestination(state, unit, spot.x, spot.y)
}

function moveUnit(state: MatchState, unit: Unit, dt: number): void {
  let left = dt
  let blockedStep = false
  let guard = 0
  while (left > 0.0001 && unit.goalX != null && unit.goalY != null && guard++ < 6) {
    const usingPath = unit.path.length > 0
    const point = usingPath ? unit.path[0] : null
    const tx = point ? point.x : unit.goalX
    const ty = point ? point.y : unit.goalY
    if (tx == null || ty == null) break
    const dx = tx - unit.x
    const dy = ty - unit.y
    const distance = Math.hypot(dx, dy)
    const arrive = usingPath ? 5 : 3.5
    if (distance <= arrive) {
      if (usingPath) {
        unit.path.shift()
        continue
      }
      const radius = UNIT_STATS[unit.kind].radius
      if (unit.kind === 'drone' || !groundMoveBlocked(state, unit.x, unit.y, tx, ty, radius)) {
        unit.x = tx
        unit.y = ty
      }
      unit.goalX = null
      unit.goalY = null
      unit.repathIn = 0
      if (unit.order?.type === 'move') unit.order = null
      if (unit.order?.type === 'attackMove' && unit.order.focusId == null) {
        if (Math.hypot(unit.x - unit.order.x, unit.y - unit.order.y) < 22) unit.order = null
      }
      break
    }
    const speed = UNIT_STATS[unit.kind].speed
    const stepLen = Math.min(distance, speed * left)
    const desiredX = dx / distance
    const desiredY = dy / distance
    const steer = steerAround(state, unit, desiredX, desiredY, tx, ty)
    const ox = unit.x
    const oy = unit.y
    tryMove(state, unit, steer.x * stepLen, steer.y * stepLen)
    let moved = Math.hypot(unit.x - ox, unit.y - oy)
    if (moved < stepLen * 0.25) {
      tryMove(state, unit, desiredX * stepLen, desiredY * stepLen)
      moved = Math.hypot(unit.x - ox, unit.y - oy)
    }
    if (moved < stepLen * 0.25) {
      const preferLeft = steer.x * -desiredY + steer.y * desiredX >= 0
      const sideX = (preferLeft ? -desiredY : desiredY) * stepLen
      const sideY = (preferLeft ? desiredX : -desiredX) * stepLen
      tryMove(state, unit, sideX, sideY)
      moved = Math.hypot(unit.x - ox, unit.y - oy)
      if (moved < stepLen * 0.25) {
        tryMove(state, unit, -sideX, -sideY)
        moved = Math.hypot(unit.x - ox, unit.y - oy)
      }
    }
    unit.facing = Math.atan2(moved > 0.01 ? unit.y - oy : desiredY, moved > 0.01 ? unit.x - ox : desiredX)
    if (moved < stepLen * 0.2) {
      blockedStep = true
      break
    }
    left -= stepLen / speed
  }
  unit.anim += dt * 7
  if (unit.goalX != null && blockedStep) unit.stuckT += dt
  else unit.stuckT = 0
  if (unit.stuckT > 0.85 && unit.goalX != null && unit.goalY != null) {
    unit.stuckT = 0
    const gx = unit.goalX
    const gy = unit.goalY
    unit.path = []
    setUnitDestination(state, unit, gx, gy)
  }
}

function tryMove(state: MatchState, unit: Unit, dx: number, dy: number): void {
  if (unit.kind === 'drone') {
    const margin = 6
    unit.x = Math.max(margin, Math.min(state.mapW * TILE - margin, unit.x + dx))
    unit.y = Math.max(margin, Math.min(state.mapH * TILE - margin, unit.y + dy))
    return
  }
  const radius = UNIT_STATS[unit.kind].radius
  const nx = unit.x + dx
  const ny = unit.y + dy
  if (!groundMoveBlocked(state, unit.x, unit.y, nx, ny, radius)) {
    unit.x = nx
    unit.y = ny
    return
  }
  if (!groundMoveBlocked(state, unit.x, unit.y, nx, unit.y, radius)) {
    unit.x = nx
    return
  }
  if (!groundMoveBlocked(state, unit.x, unit.y, unit.x, ny, radius)) unit.y = ny
}

/** A ground unit inside a blocked tile, or clipping one, is moved to the nearest free cell. */
function releaseFromTerrain(state: MatchState): void {
  for (const unit of state.units) {
    if (unit.hp <= 0 || unit.kind === 'drone') continue
    const radius = UNIT_STATS[unit.kind].radius
    if (!circleHitsSolid(state, unit.x, unit.y, radius)) continue
    const originTx = Math.floor(unit.x / TILE)
    const originTy = Math.floor(unit.y / TILE)
    let bestX = unit.x
    let bestY = unit.y
    let bestD = Infinity
    for (let ty = originTy - 8; ty <= originTy + 8; ty++) {
      for (let tx = originTx - 8; tx <= originTx + 8; tx++) {
        if (!isWalkable(state, tx, ty)) continue
        const x = (tx + 0.5) * TILE
        const y = (ty + 0.5) * TILE
        if (circleHitsSolid(state, x, y, radius)) continue
        const distance = Math.hypot(x - unit.x, y - unit.y)
        if (distance < bestD) {
          bestD = distance
          bestX = x
          bestY = y
        }
      }
    }
    if (bestD < Infinity) {
      unit.x = bestX
      unit.y = bestY
    }
  }
}

/** Slide the step off units ahead. Ground ignores drones, and drones ignore the ground. */
function steerAround(
  state: MatchState,
  unit: Unit,
  dx: number,
  dy: number,
  tx: number,
  ty: number,
): { x: number; y: number } {
  const goalD = Math.hypot(tx - unit.x, ty - unit.y)
  const scale = goalD < 22 ? 0 : goalD < 48 ? (goalD - 22) / 26 : 1
  if (scale <= 0) return { x: dx, y: dy }
  const radius = UNIT_STATS[unit.kind].radius
  const flying = unit.kind === 'drone'
  let ax = 0
  let ay = 0
  for (const other of state.units) {
    if (other.id === unit.id || other.hp <= 0) continue
    if ((other.kind === 'drone') !== flying) continue
    if (closingOn(unit, other.id)) continue
    const ox = other.x - unit.x
    const oy = other.y - unit.y
    const od = Math.hypot(ox, oy) || 0.001
    const space = radius + UNIT_STATS[other.kind].radius + 14
    if (od > space + 22) continue
    const ahead = (ox * dx + oy * dy) / od
    if (ahead < -0.15 && od > space) continue
    const side = dx * oy - dy * ox
    const sign = Math.abs(side) < 1 ? (unit.id < other.id ? 1 : -1) : side > 0 ? -1 : 1
    const urgency = od < space ? 1.6 : Math.max(0, 1 - (od - space) / 22) * (ahead > 0 ? 1 : 0.35)
    ax += -dy * sign * urgency
    ay += dx * sign * urgency
    if (od < space) {
      ax -= (ox / od) * ((space - od) / space) * 1.5
      ay -= (oy / od) * ((space - od) / space) * 1.5
    }
  }
  const sx = dx + ax * scale
  const sy = dy + ay * scale
  const length = Math.hypot(sx, sy) || 1
  return { x: sx / length, y: sy / length }
}

function closingOn(unit: Unit, otherId: number): boolean {
  const order = unit.order
  if (!order) return false
  if (order.type === 'attack' && order.kind === 'unit' && order.targetId === otherId) return true
  if (order.type === 'attackMove' && order.focusKind === 'unit' && order.focusId === otherId) return true
  return false
}

function separate(state: MatchState): void {
  const units = state.units
  for (let i = 0; i < units.length; i++) {
      const a = units[i]
    if (!a || a.hp <= 0 || a.kind === 'drone') continue
    for (let j = i + 1; j < units.length; j++) {
      const b = units[j]
      if (!b || b.hp <= 0 || b.kind === 'drone') continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const distance = Math.hypot(dx, dy) || 0.001
      const min = UNIT_STATS[a.kind].radius + UNIT_STATS[b.kind].radius - 1
      if (distance >= min) continue
      const wa = isStationary(a) ? 0 : 1
      const wb = isStationary(b) ? 0 : 1
      if (wa + wb === 0) continue
      const overlap = min - distance
      const ox = (dx / distance) * overlap
      const oy = (dy / distance) * overlap
      if (wa) tryMove(state, a, (-ox * wa) / (wa + wb), (-oy * wa) / (wa + wb))
      if (wb) tryMove(state, b, (ox * wb) / (wa + wb), (oy * wb) / (wa + wb))
    }
  }
}

function isStationary(unit: Unit): boolean {
  if (unit.goalX != null) return false
  const order = unit.order
  if (!order) return false
  return (
    order.type === 'attack' ||
    order.type === 'attackMove' ||
    order.type === 'gather' ||
    order.type === 'construct' ||
    order.type === 'repair'
  )
}

function advanceGather(state: MatchState, dt: number): void {
  for (const unit of state.units) {
    const order = unit.order
    if (!order || order.type !== 'gather') continue
    if (order.binId != null) {
      advanceBinGather(state, unit, order, dt)
      continue
    }
    if (order.phase === 'mine') {
      const node = state.ore.find((entry) => entry.id === order.nodeId)
      if (!node || node.amount <= 0) continue
      if (unit.hurtTimer > 0 && nearestHostile(state, unit, UNIT_STATS.porter.range + 12, false)) continue
      unit.gatherTimer += dt
      if (unit.gatherTimer < GATHER_TIME) continue
      const take = Math.min(GATHER_AMOUNT, node.amount)
      node.amount -= take
      unit.cargo = take
      unit.nodeMemory = node.id
      unit.gatherTimer = 0
      if (node.amount <= 0) {
        burst(state, (node.tx + 0.5) * TILE, (node.ty + 0.5) * TILE, '#e6c15a', 6)
        if (state.selectedOre === node.id) state.selectedOre = null
        state.ore = state.ore.filter((entry) => entry.amount > 0)
        rebuildBlocked(state)
      }
      order.phase = 'return'
      stopMoving(unit)
      continue
    }
    if (order.phase !== 'return' || unit.cargo <= 0) continue
    deliverCargo(state, unit, order)
  }
}

function advanceBinGather(
  state: MatchState,
  unit: Unit,
  order: Extract<Order, { type: 'gather' }>,
  dt: number,
): void {
  if (order.phase === 'mine') {
    const bin = order.binId != null ? buildingById(state, order.binId) : undefined
    if (!bin || bin.hp <= 0 || bin.kind !== 'silo' || bin.stock <= 0 || bin.owner === unit.owner) return
    if (unit.hurtTimer > 0 && nearestHostile(state, unit, UNIT_STATS.porter.range + 12, false)) return
    unit.gatherTimer += dt
    if (unit.gatherTimer < GATHER_TIME) return
    const take = Math.min(GATHER_AMOUNT, bin.stock)
    bin.stock -= take
    const bank = state.oreHeld[bin.owner] ?? 0
    state.oreHeld[bin.owner] = Math.max(0, bank - take)
    unit.cargo = take
    unit.gatherTimer = 0
    order.phase = 'return'
    stopMoving(unit)
    return
  }
  if (order.phase === 'return' && unit.cargo > 0) deliverCargo(state, unit, order)
}

function deliverCargo(state: MatchState, unit: Unit, order: Extract<Order, { type: 'gather' }>): void {
  const drop = nearestDropoff(state, unit.owner, unit.x, unit.y)
  if (!drop) return
  if (distToRect(unit.x, unit.y, buildingRect(drop)) > INTERACT) return
  let moved = unit.cargo
  if (drop.kind === 'silo') {
    const room = STORAGE_CAP - drop.stock
    if (room <= 0) return
    moved = Math.min(unit.cargo, room)
    drop.stock += moved
  }
  state.oreHeld[unit.owner] = (state.oreHeld[unit.owner] ?? 0) + moved
  unit.cargo -= moved
  if (unit.owner === 0) state.tutorial = false
  state.particles.push({
    x: unit.x,
    y: unit.y - 18,
    vx: 0,
    vy: -28,
    life: 1.15,
    max: 1.15,
    r: 0,
    color: '#ffe7a0',
    text: `+${moved}`,
  })
  if (unit.cargo > 0) {
    stopMoving(unit)
    approachDropoff(state, unit)
    return
  }
  const resume = order.binId != null ? null : order.nodeId
  assignMiners(state, [unit], resume)
}

function advanceConstruct(state: MatchState, dt: number): void {
  for (const building of state.buildings) {
    if (building.complete || building.hp <= 0) continue
    const crew = state.units.filter((unit) => {
      if (unit.hp <= 0 || unit.order?.type !== 'construct' || unit.order.buildingId !== building.id) return false
      return distToRect(unit.x, unit.y, buildingRect(building)) <= INTERACT
    })
    // A site with no worker in range is paused. Progress stays where it is until someone returns.
    if (!crew.length) continue
    const speed = 1 + (crew.length - 1) * 0.6
    building.progress += (dt * speed) / BUILDING_STATS[building.kind].buildTime
    if (building.progress < 1) continue
    building.progress = 1
    building.complete = true
    for (const unit of crew) {
      unit.order = null
      stopMoving(unit)
    }
    recomputeSupply(state)
    if (building.owner === 0) {
      state.events.push({ type: 'ready' })
      pushToast(state, `${BUILDING_STATS[building.kind].label} finished.`)
    }
  }
}

function advanceRepair(state: MatchState, dt: number): void {
  for (const building of state.buildings) {
    if (!building.ruined) continue
    const crew = state.units.filter((unit) => {
      if (unit.hp <= 0 || unit.order?.type !== 'repair' || unit.order.buildingId !== building.id) return false
      return distToRect(unit.x, unit.y, buildingRect(building)) <= INTERACT
    })
    if (!crew.length) continue
    const payer = crew[0]
    if (!payer) continue
    if (!building.repairPaid) {
      if ((state.oreHeld[payer.owner] ?? 0) < SILO_REPAIR_COST) {
        for (const unit of crew) {
          unit.order = null
          stopMoving(unit)
        }
        if (payer.owner === 0) pushToast(state, `Need ${SILO_REPAIR_COST} dumps`)
        continue
      }
      debitDumps(state, payer.owner, SILO_REPAIR_COST)
      building.repairPaid = true
    }
    const speed = 1 + (crew.length - 1) * 0.6
    building.progress += (dt * speed) / SILO_REPAIR_TIME
    if (building.progress < 1) continue
    restoreSilo(state, building, payer.owner)
  }
}

/** A finished repair is a working Silo at full health, owned by the Stalker who completed it. */
function restoreSilo(state: MatchState, building: Building, owner: number): void {
  const stats = BUILDING_STATS.keep
  const mouth = keepEntrance(building)
  building.ruined = false
  building.repairPaid = false
  building.owner = owner
  building.hp = stats.hp
  building.complete = true
  building.progress = 1
  building.queue = []
  building.stock = 0
  building.alert = 0
  building.focusId = null
  building.focusKind = null
  building.struckBy = null
  building.hatch = 0
  building.rallyX = mouth.x
  building.rallyY = mouth.y
  for (const unit of state.units) {
    if (unit.order?.type === 'repair' && unit.order.buildingId === building.id) {
      unit.order = null
      stopMoving(unit)
    }
  }
  recomputeSupply(state)
  rebuildBlocked(state)
  if (owner === 0) pushToast(state, 'The Silo is repaired.')
}

function advanceProduction(state: MatchState, dt: number): void {
  for (const building of state.buildings) {
    if (!building.complete || building.hp <= 0) continue
    const job = building.queue[0]
    if (!job) continue
    job.remaining -= dt
    if (job.remaining > 0) continue
    building.queue.shift()
    spawnTrained(state, building, job.kind)
    if (building.owner === 0) state.events.push({ type: 'ready' })
  }
}

function baySpot(state: MatchState, building: Building): { x: number; y: number } {
  return mouthSpot(state, building, yardEntrance(building))
}

function entranceSpot(state: MatchState, building: Building): { x: number; y: number } {
  return mouthSpot(state, building, keepEntrance(building))
}

function mouthSpot(state: MatchState, building: Building, mouth: { x: number; y: number }): { x: number; y: number } {
  const side = ((building.spawnN % 3) - 1) * 8
  building.spawnN += 1
  let x = mouth.x + side
  let y = mouth.y
  const tx = Math.floor(x / TILE)
  const ty = Math.floor(y / TILE)
  if (!isWalkable(state, tx, ty)) {
    const spot = nearestWalkable(state, mouth.x, mouth.y)
    if (spot) {
      x = (spot.tx + 0.5) * TILE
      y = (spot.ty + 0.5) * TILE
    }
  }
  building.hatch = 0.7
  return { x, y }
}

function spawnTrained(state: MatchState, building: Building, kind: Unit['kind']): void {
  if (building.kind === 'keep') {
    placeTrained(state, building, kind, entranceSpot(state, building))
    return
  }
  if (building.kind === 'yard') {
    placeTrained(state, building, kind, baySpot(state, building))
    return
  }
  const stats = BUILDING_STATS[building.kind]
  const spots: Array<{ x: number; y: number }> = []
  for (let y = building.ty - 1; y <= building.ty + stats.h; y++) {
    for (let x = building.tx - 1; x <= building.tx + stats.w; x++) {
      const inside = x >= building.tx && x < building.tx + stats.w && y >= building.ty && y < building.ty + stats.h
      if (inside) continue
      if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) continue
      if (state.blocked[y * state.mapW + x]) continue
      spots.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE })
    }
  }
  spots.sort(
    (a, b) =>
      Math.hypot(a.x - building.rallyX, a.y - building.rallyY) -
      Math.hypot(b.x - building.rallyX, b.y - building.rallyY),
  )
  const ring = spots.length ? spots[building.spawnN++ % spots.length] : undefined
  const fallback = nearestWalkable(state, building.rallyX, building.rallyY)
  const spot = ring ?? (fallback ? { x: (fallback.tx + 0.5) * TILE, y: (fallback.ty + 0.5) * TILE } : {
    x: building.rallyX,
    y: building.rallyY,
  })
  placeTrained(state, building, kind, spot)
}

function placeTrained(state: MatchState, building: Building, kind: Unit['kind'], spot: { x: number; y: number }): void {
  const unit: Unit = {
    id: state.nextId++,
    owner: building.owner,
    kind,
    x: spot.x,
    y: spot.y,
    hp: UNIT_STATS[kind].hp,
    facing: (() => {
      const dx = building.rallyX - spot.x
      const dy = building.rallyY - spot.y
      return Math.hypot(dx, dy) > 12 ? Math.atan2(dy, dx) : Math.PI / 2
    })(),
    anim: 0,
    order: null,
    path: [],
    goalX: null,
    goalY: null,
    attackCd: 0,
    hurtTimer: 0,
    hitFlash: 0,
    cargo: 0,
    gatherTimer: 0,
    stuckT: 0,
    stuckOrderT: 0,
    stuckX: spot.x,
    stuckY: spot.y,
    avoidNode: -1,
    avoidUntil: 0,
    leashX: null,
    leashY: null,
    idleAcquire: false,
    nodeMemory: -1,
    repathIn: 0,
    scanning: false,
    age: 0,
  }
  state.units.push(unit)
  if (Math.hypot(building.rallyX - spot.x, building.rallyY - spot.y) > 20) {
    unit.order = { type: 'move', x: building.rallyX, y: building.rallyY }
    setUnitDestination(state, unit, building.rallyX, building.rallyY)
  }
}

function tryFire(state: MatchState, unit: Unit): void {
  if (unit.attackCd > 0 || unit.hp <= 0 || unit.kind === 'drone') return
  const target = pickFireTarget(state, unit)
  if (!target || !inWeaponRange(unit, target)) return
  if (!shotClear(state, unit.x, unit.y, target.x, target.y)) return
  const stats = UNIT_STATS[unit.kind]
  unit.attackCd = stats.cooldown
  unit.facing = Math.atan2(target.y - unit.y, target.x - unit.x)
  state.projectiles.push({
    id: state.nextId++,
    owner: unit.owner,
    sourceId: unit.id,
    x: unit.x + Math.cos(unit.facing) * (stats.radius + 3),
    y: unit.y + Math.sin(unit.facing) * (stats.radius + 3),
    targetId: target.id,
    targetKind: target.targetKind,
    damage: stats.damage,
    speed: stats.projectileSpeed,
    radius: stats.projectileRadius,
    life: 2.6,
  })
  state.particles.push({
    x: unit.x + Math.cos(unit.facing) * (stats.radius + 2),
    y: unit.y + Math.sin(unit.facing) * (stats.radius + 2),
    vx: Math.cos(unit.facing) * 20,
    vy: Math.sin(unit.facing) * 20,
    life: 0.12,
    max: 0.12,
    r: 3,
    color: sideTone(unit.owner),
  })
  state.events.push({ type: 'attack' })
}

/**
 * A finished Pillar uses its own damage, a Flasher's rate, and a Hover's sight as its range.
 * It holds the closest enemy it can see until that enemy leaves sight or dies.
 * An uncovered enemy Stalker is a target; the hit captures them. A covered one is ignored.
 * Rocks and trees block the shot. Ground the Pillar cannot currently see is ignored.
 */
function tryFireTower(state: MatchState, building: Building, dt: number): void {
  building.attackCd = Math.max(0, building.attackCd - dt)
  if (!building.complete || building.hp <= 0) {
    building.focusId = null
    building.focusKind = null
    return
  }
  const pike = UNIT_STATS.pike
  const damage = BUILDING_STATS.tower.damage
  if (damage == null) return
  const origin = buildingCenter(building)
  let target = lockedTowerTarget(state, building, origin)
  if (!target) {
    building.focusId = null
    building.focusKind = null
    target = closestTowerTarget(state, building, origin)
    if (target) {
      building.focusId = target.id
      building.focusKind = target.targetKind
    }
  }
  if (!target || building.attackCd > 0) return
  building.attackCd = pike.cooldown
  const aim = Math.atan2(target.y - origin.y, target.x - origin.x)
  state.projectiles.push({
    id: state.nextId++,
    owner: building.owner,
    sourceId: building.id,
    x: origin.x + Math.cos(aim) * 14,
    y: origin.y + Math.sin(aim) * 14,
    targetId: target.id,
    targetKind: target.targetKind,
    damage,
    speed: pike.projectileSpeed,
    radius: pike.projectileRadius,
    life: 2.6,
  })
  state.particles.push({
    x: origin.x + Math.cos(aim) * 16,
    y: origin.y + Math.sin(aim) * 16,
    vx: Math.cos(aim) * 20,
    vy: Math.sin(aim) * 20,
    life: 0.12,
    max: 0.12,
    r: 3,
    color: sideTone(building.owner),
  })
  state.events.push({ type: 'attack' })
}

function lockedTowerTarget(state: MatchState, building: Building, origin: { x: number; y: number }): Target | null {
  if (building.focusId == null || (building.focusKind !== 'unit' && building.focusKind !== 'building')) return null
  const target = getTarget(state, building.focusId, building.focusKind)
  if (!target || !towerEngages(state, building, origin, target)) return null
  return target
}

function closestTowerTarget(state: MatchState, building: Building, origin: { x: number; y: number }): Target | null {
  let best: Target | null = null
  let bestD = Infinity
  for (const unit of state.units) {
    if (unit.owner === building.owner || unit.hp <= 0) continue
    const target = unitTarget(unit)
    if (!towerEngages(state, building, origin, target)) continue
    const distance = Math.hypot(target.x - origin.x, target.y - origin.y)
    if (distance < bestD) {
      best = target
      bestD = distance
    }
  }
  for (const other of state.buildings) {
    if (other.id === building.id || other.owner === building.owner || other.hp <= 0) continue
    const target = buildingTarget(other)
    if (!towerEngages(state, building, origin, target)) continue
    const distance = Math.hypot(target.x - origin.x, target.y - origin.y)
    if (distance < bestD) {
      best = target
      bestD = distance
    }
  }
  return best
}

/**
 * True when this enemy is inside the Pillar's own sight, currently visible, and not behind rock or a tree.
 * Covered Stalkers are skipped. Uncovered ones stay valid so the shot can capture them.
 */
function towerEngages(state: MatchState, building: Building, origin: { x: number; y: number }, target: Target): boolean {
  if (target.hp <= 0 || target.owner === building.owner || target.targetKind === 'rock') return false
  if (coveredStalkerTarget(state, target)) return false
  if (!targetInTowerSight(state, building, origin, target)) return false
  return shotClear(state, origin.x, origin.y, target.x, target.y)
}

function targetInTowerSight(
  state: MatchState,
  building: Building,
  origin: { x: number; y: number },
  target: Target,
): boolean {
  if (target.targetKind === 'unit') {
    const tx = Math.floor(target.x / TILE)
    const ty = Math.floor(target.y / TILE)
    return tileInTowerCircle(origin, tx, ty) && sideSeesTile(state, building.owner, tx, ty)
  }
  if (target.targetKind !== 'building') return false
  const other = buildingById(state, target.id)
  if (!other) return false
  const stats = BUILDING_STATS[other.kind]
  for (let y = 0; y < stats.h; y++) {
    for (let x = 0; x < stats.w; x++) {
      const tx = other.tx + x
      const ty = other.ty + y
      if (tileInTowerCircle(origin, tx, ty) && sideSeesTile(state, building.owner, tx, ty)) return true
    }
  }
  return false
}

function tileInTowerCircle(origin: { x: number; y: number }, tx: number, ty: number): boolean {
  const cx = (tx + 0.5) * TILE
  const cy = (ty + 0.5) * TILE
  return Math.hypot(cx - origin.x, cy - origin.y) <= BUILDING_STATS.tower.sight
}

function sideSeesTile(state: MatchState, owner: number, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= state.mapW || ty >= state.mapH) return false
  const grid = owner === 0 ? state.visible : owner === 1 ? state.aiVisible : state.sideVisible[owner]
  if (!grid) return false
  return grid[ty * state.mapW + tx] === 1
}

function isAttackable(unit: Unit, focus: Target): boolean {
  if (focus.hp <= 0) return false
  if (unit.kind === 'drone') return false
  if (focus.targetKind === 'rock') return unit.kind === 'porter'
  if (focus.unitKind === 'drone' && unit.kind === 'howler') return false
  return focus.owner !== unit.owner
}

function pickFireTarget(state: MatchState, unit: Unit): Target | null {
  const order = unit.order
  if (order?.type === 'attack') {
    const aimed = getTarget(state, order.targetId, order.kind)
    if (aimed && isAttackable(unit, aimed)) return aimed
  }
  if (order?.type === 'attackMove' && order.focusId != null && order.focusKind) {
    const aimed = getTarget(state, order.focusId, order.focusKind)
    if (aimed && isAttackable(unit, aimed)) return aimed
  }
  const angry = unit.hurtTimer > 0
  const combat =
    unit.kind !== 'porter' &&
    unit.kind !== 'drone' &&
    (order == null || order.type === 'move' || order.type === 'attackMove')
  if (!angry && !combat) return null
  if ((unit.kind === 'porter' || unit.kind === 'drone') && !angry) return null
  const stats = UNIT_STATS[unit.kind]
  return nearestHostile(state, unit, stats.range + 40, order?.type === 'attackMove')
}

function siloControlled(state: MatchState, unit: Unit): boolean {
  return unit.owner === 0 ? state.aiControl : unit.owner > 0
}

/** Gorillas on a SiloAI attack-move shoot buildings before units. */
function nearestSiegeBuilding(state: MatchState, unit: Unit, radius: number): Target | null {
  let best: Target | null = null
  let bestD = radius
  for (const building of state.buildings) {
    if (building.owner === unit.owner || building.hp <= 0) continue
    if (building.kind !== 'keep' && building.kind !== 'silo' && building.kind !== 'yard' && building.kind !== 'tower') continue
    const center = buildingCenter(building)
    const d = Math.hypot(center.x - unit.x, center.y - unit.y)
    if (d < bestD) {
      bestD = d
      best = buildingTarget(building)
    }
  }
  return best
}

function nearestHostile(state: MatchState, unit: Unit, radius: number, buildingsToo: boolean): Target | null {
  if (
    buildingsToo &&
    unit.kind === 'howler' &&
    unit.order?.type === 'attackMove' &&
    siloControlled(state, unit)
  ) {
    const structure = nearestSiegeBuilding(state, unit, radius)
    if (structure) return structure
  }
  let best: Target | null = null
  let bestD = radius
  for (const other of state.units) {
    if (other.owner === unit.owner || other.hp <= 0 || other.id === unit.id) continue
    if (other.kind === 'drone' && unit.kind === 'howler') continue
    if (other.kind === 'porter' && stalkerCovered(state, other)) continue
    const d = Math.hypot(other.x - unit.x, other.y - unit.y)
    if (d < bestD) {
      bestD = d
      best = unitTarget(other)
    }
  }
  if (!best && buildingsToo) {
    const castleFirst =
      (unit.owner !== 0 && sideKnowsEnemyKeep(state, unit.owner)) ||
      (unit.owner === 0 && state.aiControl && sideKnowsEnemyKeep(state, 0))
    for (const building of state.buildings) {
      if (building.owner === unit.owner || building.hp <= 0) continue
      if (castleFirst && building.kind !== 'keep') continue
      const center = buildingCenter(building)
      const d = Math.hypot(center.x - unit.x, center.y - unit.y)
      if (d < bestD) {
        bestD = d
        best = buildingTarget(building)
      }
    }
  }
  return best
}

function updateProjectiles(state: MatchState, dt: number): void {
  const next = []
  for (const shot of state.projectiles) {
    shot.life -= dt
    const target = getTarget(state, shot.targetId, shot.targetKind)
    if (!target || target.hp <= 0 || shot.life <= 0) continue
    const dx = target.x - shot.x
    const dy = target.y - shot.y
    const distance = Math.hypot(dx, dy)
    if (distance <= shot.radius + 8) {
      applyHit(state, target, shot.damage, shot.sourceId)
      burst(state, target.x, target.y, sideTone(shot.owner), 4)
      continue
    }
    const stepLen = Math.min(distance, shot.speed * dt)
    shot.x += (dx / distance) * stepLen
    shot.y += (dy / distance) * stepLen
    next.push(shot)
  }
  state.projectiles = next
}

function applyHit(state: MatchState, target: Target, damage: number, sourceId: number): void {
  if (state.godMode && target.owner === 0 && target.targetKind !== 'rock') return
  if (target.targetKind === 'rock') {
    const source = unitById(state, sourceId)
    if (source?.kind !== 'porter') return
    const rock = rockById(state, target.id)
    if (!rock || rock.hp <= 0) return
    rock.hp -= damage
    rock.hitFlash = 0.18
    return
  }
  if (target.targetKind === 'unit') {
    const unit = unitById(state, target.id)
    if (!unit || unit.hp <= 0) return
    const source = unitById(state, sourceId)
    const sourceBuilding = source ? undefined : buildingById(state, sourceId)
    if (unit.kind === 'porter') {
      const attacker = source?.owner ?? sourceBuilding?.owner
      if (attacker == null || attacker === unit.owner || stalkerCovered(state, unit)) return
      captureStalker(state, unit, attacker)
      return
    }
    if (unit.kind === 'drone' && source?.kind === 'howler') return
    const bikeShot = source?.kind === 'pike' || sourceBuilding?.kind === 'tower'
    const dealt = unit.kind === 'drone' && bikeShot ? damage / 2 : damage
    unit.hp -= dealt
    unit.hitFlash = 0.16
    unit.hurtTimer = 3.2
    return
  }
  const building = buildingById(state, target.id)
  if (!building || building.hp <= 0) return
  const attacker = attackerOwner(state, sourceId)
  if (attacker != null) building.struckBy = attacker
  building.hp -= damage
  if (building.hp <= 0) {
    const source = unitById(state, sourceId)
    building.dropDumps = source?.kind === 'pike' || source?.kind === 'howler'
  }
  building.hitFlash = 0.18
  building.alert = 8
  if (building.owner === 0 && state.underAttackCd <= 0) {
    state.underAttackCd = 8
    const label = building.kind === 'keep' ? 'The Silo is under attack.' : `Your ${BUILDING_STATS[building.kind].label} is under attack.`
    state.toasts.push({ text: label, life: 3.4 })
  }
}

function cleanup(state: MatchState): void {
  clearBrokenRocks(state)
  const deadUnits = state.units.filter((unit) => unit.hp <= 0)
  if (deadUnits.length) {
    const deadIds = new Set(deadUnits.map((unit) => unit.id))
    for (const unit of deadUnits) {
      burst(state, unit.x, unit.y, sideTone(unit.owner), 8)
      state.events.push({ type: 'death' })
    }
    state.units = state.units.filter((unit) => unit.hp > 0)
    state.selectedUnits = state.selectedUnits.filter((id) => !deadIds.has(id))
  }

  const deadBuildings = state.buildings.filter((building) => building.hp <= 0 && !building.ruined)
  if (!deadBuildings.length) return
  const fallenKeeps: Array<{ owner: number; struckBy: number | null }> = []
  for (const building of deadBuildings) {
    const center = buildingCenter(building)
    burst(state, center.x, center.y, sideTone(building.owner), 16)
    for (const job of building.queue) state.oreHeld[building.owner] = (state.oreHeld[building.owner] ?? 0) + UNIT_STATS[job.kind].cost
    if (!building.complete) {
      state.oreHeld[building.owner] = (state.oreHeld[building.owner] ?? 0) + Math.floor(BUILDING_STATS[building.kind].cost * 0.75)
    }
    if (building.kind === 'silo' && building.dropDumps) dropStoragePile(state, building)
    for (const unit of state.units) {
      if (unit.order?.type === 'construct' && unit.order.buildingId === building.id) {
        unit.order = null
        stopMoving(unit)
      }
      if (unit.order?.type === 'repair' && unit.order.buildingId === building.id) {
        unit.order = null
        stopMoving(unit)
      }
      if (unit.order?.type === 'attack' && unit.order.kind === 'building' && unit.order.targetId === building.id) {
        unit.order = null
        stopMoving(unit)
      }
    }
    if (state.selectedBuilding === building.id) state.selectedBuilding = null
    state.events.push({ type: 'death' })
    if (building.kind === 'keep') fallenKeeps.push({ owner: building.owner, struckBy: building.struckBy })
  }
  for (const building of deadBuildings) {
    if (building.kind !== 'keep') continue
    building.ruined = true
    building.repairPaid = false
    building.owner = -1
    building.hp = 0
    building.complete = false
    building.progress = 0
    building.queue = []
    building.stock = 0
    building.alert = 0
    building.focusId = null
    building.focusKind = null
    building.hatch = 0
    building.dropDumps = false
  }
  state.buildings = state.buildings.filter((building) => building.hp > 0 || building.ruined)
  let removedSide = false
  for (let owner = 0; owner < state.playerCount; owner++) {
    if (state.eliminated[owner] || sideHasKeep(state, owner)) continue
    const fallen = fallenKeeps.find((entry) => entry.owner === owner)
    const captor = captorFor(state, owner, fallen?.struckBy ?? null)
    if (captor == null) eliminateSide(state, owner)
    else captureSide(state, owner, captor)
    removedSide = true
  }
  if (removedSide) recomputeSupply(state)
  rebuildBlocked(state)
  const livingKeep = (building: Building) => building.kind === 'keep' && building.hp > 0 && !building.ruined
  const playerAlive = state.buildings.some((building) => building.owner === 0 && livingKeep(building))
  const enemyAlive = state.buildings.some((building) => building.owner > 0 && livingKeep(building))
  if (!playerAlive) {
    state.outcome = 'lose'
    state.events.push({ type: 'lose' })
  } else if (!enemyAlive) {
    state.outcome = 'win'
    state.events.push({ type: 'win' })
  }
}

function sideTone(owner: number): string {
  return PLAYER_COLOR[owner] ?? '#d7d3c8'
}

/**
 * A Stalker inside the sight of its own Silo, a finished Storage, a Flasher, or a Gorilla cannot be captured.
 * Storage uses its own sight (150). A Storage that is still under construction gives no cover.
 */
function stalkerCovered(state: MatchState, unit: Unit): boolean {
  for (const building of state.buildings) {
    if (building.owner !== unit.owner || building.hp <= 0) continue
    if (building.kind !== 'keep' && building.kind !== 'silo') continue
    if (building.kind === 'silo' && !building.complete) continue
    const center = buildingCenter(building)
    if (Math.hypot(center.x - unit.x, center.y - unit.y) <= BUILDING_STATS[building.kind].sight) return true
  }
  for (const ally of state.units) {
    if (ally.owner !== unit.owner || ally.hp <= 0 || ally.id === unit.id) continue
    if (ally.kind !== 'pike' && ally.kind !== 'howler') continue
    if (Math.hypot(ally.x - unit.x, ally.y - unit.y) <= UNIT_STATS[ally.kind].sight) return true
  }
  return false
}

function coveredStalkerTarget(state: MatchState, target: Target): boolean {
  if (target.targetKind !== 'unit') return false
  const unit = unitById(state, target.id)
  return !!unit && unit.kind === 'porter' && stalkerCovered(state, unit)
}

function attackerOwner(state: MatchState, sourceId: number): number | null {
  const unit = unitById(state, sourceId)
  if (unit) return unit.owner
  const building = buildingById(state, sourceId)
  return building ? building.owner : null
}

function captureStalker(state: MatchState, unit: Unit, newOwner: number): void {
  const previous = unit.owner
  if (previous === newOwner) return
  unit.owner = newOwner
  unit.order = null
  unit.idleAcquire = false
  unit.scanning = false
  unit.leashX = null
  unit.leashY = null
  stopMoving(unit)
  state.selectedUnits = state.selectedUnits.filter((id) => {
    const selected = unitById(state, id)
    return !!selected && selected.owner === 0 && selected.hp > 0
  })
  for (const other of state.units) {
    if (other.owner !== newOwner) continue
    const order = other.order
    if (order?.type === 'attack' && order.kind === 'unit' && order.targetId === unit.id) {
      other.order = null
      stopMoving(other)
    }
    if (order?.type === 'attackMove' && order.focusKind === 'unit' && order.focusId === unit.id) {
      order.focusId = null
      order.focusKind = null
    }
  }
  recomputeSupply(state)
  if (previous === 0) pushToast(state, 'A Stalker was captured.')
  else if (newOwner === 0) pushToast(state, 'Stalker captured.')
}

function sideHasKeep(state: MatchState, owner: number): boolean {
  return state.buildings.some((building) => building.owner === owner && building.kind === 'keep' && building.hp > 0)
}

function captorFor(state: MatchState, victim: number, struckBy: number | null): number | null {
  const struck = struckBy
  if (struck != null && struck !== victim && !state.eliminated[struck] && sideHasKeep(state, struck)) return struck
  for (let owner = 0; owner < state.playerCount; owner++) {
    if (owner === victim || state.eliminated[owner]) continue
    if (sideHasKeep(state, owner)) return owner
  }
  for (let owner = 0; owner < state.playerCount; owner++) {
    if (owner !== victim && !state.eliminated[owner]) return owner
  }
  return null
}

function captureSide(state: MatchState, victim: number, captor: number): void {
  if (state.eliminated[victim]) return
  state.eliminated[victim] = true
  for (const building of state.buildings) {
    if (building.owner !== victim || building.hp <= 0) continue
    building.owner = captor
    building.focusId = null
    building.focusKind = null
    building.alert = 0
  }
  const taken = new Set<number>()
  for (const unit of state.units) {
    if (unit.owner !== victim || unit.hp <= 0) continue
    unit.owner = captor
    unit.order = null
    unit.idleAcquire = false
    unit.scanning = false
    unit.leashX = null
    unit.leashY = null
    stopMoving(unit)
    taken.add(unit.id)
  }
  state.oreHeld[captor] = (state.oreHeld[captor] ?? 0) + (state.oreHeld[victim] ?? 0)
  state.oreHeld[victim] = 0
  state.selectedUnits = state.selectedUnits.filter((id) => {
    const unit = unitById(state, id)
    return !!unit && unit.owner === 0 && unit.hp > 0
  })
  if (state.selectedBuilding != null) {
    const selected = buildingById(state, state.selectedBuilding)
    if (!selected || selected.owner !== 0 || selected.hp <= 0) state.selectedBuilding = null
  }
  for (const unit of state.units) {
    const order = unit.order
    if (order?.type === 'attack' && order.kind === 'unit' && taken.has(order.targetId) && unit.owner === captor) {
      unit.order = null
      stopMoving(unit)
    }
    if (order?.type === 'attack' && order.kind === 'building') {
      const building = buildingById(state, order.targetId)
      if (building && building.owner === unit.owner) {
        unit.order = null
        stopMoving(unit)
      }
    }
    if (order?.type === 'attackMove' && order.focusId != null && order.focusKind === 'unit' && taken.has(order.focusId)) {
      order.focusId = null
      order.focusKind = null
    }
    if (order?.type === 'construct') {
      const site = buildingById(state, order.buildingId)
      if (!site || site.owner !== unit.owner) {
        unit.order = null
        stopMoving(unit)
      }
    }
  }
  pushToast(state, `${PLAYER_NAME[victim] ?? 'A side'} is eliminated.`)
}

function dropStoragePile(state: MatchState, building: Building): void {
  const amount = building.stock
  if (amount <= 0) return
  state.oreHeld[building.owner] = Math.max(0, (state.oreHeld[building.owner] ?? 0) - amount)
  building.stock = 0
  const stats = BUILDING_STATS[building.kind]
  let spot: { tx: number; ty: number } | null = null
  for (let y = 0; y < stats.h && !spot; y++) {
    for (let x = 0; x < stats.w; x++) {
      const tx = building.tx + x
      const ty = building.ty + y
      if (state.ore.some((node) => node.tx === tx && node.ty === ty && node.amount > 0)) continue
      spot = { tx, ty }
      break
    }
  }
  const cell = spot ?? { tx: building.tx, ty: building.ty }
  state.tiles[cell.ty * state.mapW + cell.tx] = 0
  const rock = state.rocks.find((entry) => entry.tx === cell.tx && entry.ty === cell.ty)
  if (rock) rock.hp = 0
  state.ore.push({ id: state.nextId++, tx: cell.tx, ty: cell.ty, amount })
}

function eliminateSide(state: MatchState, owner: number): void {
  if (state.eliminated[owner]) return
  state.eliminated[owner] = true
  const buildingIds = new Set(state.buildings.filter((building) => building.owner === owner).map((building) => building.id))
  const unitIds = new Set(state.units.filter((unit) => unit.owner === owner).map((unit) => unit.id))
  state.buildings = state.buildings.filter((building) => building.owner !== owner)
  state.units = state.units.filter((unit) => unit.owner !== owner)
  state.selectedUnits = state.selectedUnits.filter((id) => !unitIds.has(id))
  if (state.selectedBuilding != null && buildingIds.has(state.selectedBuilding)) state.selectedBuilding = null
  for (const unit of state.units) {
    const order = unit.order
    if (order?.type === 'attack') {
      const hit =
        (order.kind === 'unit' && unitIds.has(order.targetId)) ||
        (order.kind === 'building' && buildingIds.has(order.targetId))
      if (hit) {
        unit.order = null
        stopMoving(unit)
      }
    } else if (order?.type === 'construct' && buildingIds.has(order.buildingId)) {
      unit.order = null
      stopMoving(unit)
    }
  }
  pushToast(state, `${PLAYER_NAME[owner] ?? 'A side'} is eliminated.`)
}

function clearBrokenRocks(state: MatchState): void {
  const dead = state.rocks.filter((rock) => rock.hp <= 0)
  if (!dead.length) return
  const deadIds = new Set(dead.map((rock) => rock.id))
  for (const rock of dead) {
    state.tiles[rock.ty * state.mapW + rock.tx] = 0
    burst(state, (rock.tx + 0.5) * TILE, (rock.ty + 0.5) * TILE, rock.kind === 'tree' ? '#6ea84a' : '#b7b1a6', 7)
  }
  state.rocks = state.rocks.filter((rock) => rock.hp > 0)
  rebuildBlocked(state)
  for (const unit of state.units) {
    if (unit.order?.type === 'attack' && unit.order.kind === 'rock' && deadIds.has(unit.order.targetId)) {
      const resumeOrder = unit.order.resume
      const resume = unit.order.resumeNode
      unit.order = null
      unit.idleAcquire = false
      stopMoving(unit)
      if (resumeOrder && unit.kind === 'porter' && unit.hp > 0) unit.order = resumeOrder
      else if (resume != null && unit.kind === 'porter' && unit.hp > 0) resumeGather(state, unit, resume)
    }
    if (
      unit.order?.type === 'attackMove' &&
      unit.order.focusKind === 'rock' &&
      unit.order.focusId != null &&
      deadIds.has(unit.order.focusId)
    ) {
      unit.order.focusId = null
      unit.order.focusKind = null
    }
  }
  for (const unit of state.units) {
    if (unit.hp <= 0 || unit.goalX == null || unit.goalY == null) continue
    setUnitDestination(state, unit, unit.goalX, unit.goalY)
  }
}

function burst(state: MatchState, x: number, y: number, color: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count + Math.random() * 0.4
    const s = 18 + Math.random() * 40
    state.particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 0.35 + Math.random() * 0.35,
      max: 0.7,
      r: 1.5 + Math.random() * 2.2,
      color,
    })
  }
}

const STUCK_SHIFT = 8

function watchStuckUnits(state: MatchState, dt: number): void {
  for (const unit of state.units) {
    if (unit.hp <= 0) continue
    if (unit.avoidNode >= 0 && state.time >= unit.avoidUntil) unit.avoidNode = -1
    if (!unit.order || workingInPlace(state, unit)) {
      noteProgress(unit)
      continue
    }
    if (Math.hypot(unit.x - unit.stuckX, unit.y - unit.stuckY) >= STUCK_SHIFT) {
      noteProgress(unit)
      continue
    }
    unit.stuckOrderT += dt
    if (unit.stuckOrderT < STUCK_REDIRECT_SECONDS) continue
    if (unit.kind === 'porter') redirectStuckPorter(state, unit)
    else repaceStuckUnit(state, unit)
  }
}

function noteProgress(unit: Unit): void {
  unit.stuckOrderT = 0
  unit.stuckX = unit.x
  unit.stuckY = unit.y
  unit.stuckT = 0
}

function repaceStuckUnit(state: MatchState, unit: Unit): void {
  noteProgress(unit)
  if (unit.goalX == null || unit.goalY == null) return
  const gx = unit.goalX
  const gy = unit.goalY
  unit.path = []
  setUnitDestination(state, unit, gx, gy)
}

function workingInPlace(state: MatchState, unit: Unit): boolean {
  const order = unit.order
  if (!order) return true
  if (order.type === 'gather' && order.phase === 'mine') return true
  if (order.type === 'gather' && order.phase === 'return') {
    const drop = nearestDropoff(state, unit.owner, unit.x, unit.y)
    return !!drop && distToRect(unit.x, unit.y, buildingRect(drop)) <= INTERACT
  }
  if (order.type === 'construct') {
    const building = buildingById(state, order.buildingId)
    return !!building && building.hp > 0 && distToRect(unit.x, unit.y, buildingRect(building)) <= INTERACT
  }
  if (order.type === 'repair') {
    const building = buildingById(state, order.buildingId)
    return !!building && building.ruined && distToRect(unit.x, unit.y, buildingRect(building)) <= INTERACT
  }
  if (order.type === 'attack') {
    const target = getTarget(state, order.targetId, order.kind)
    return !!target && inWeaponRange(unit, target) && shotClear(state, unit.x, unit.y, target.x, target.y)
  }
  if (order.type === 'attackMove' && order.focusId != null && order.focusKind) {
    const target = getTarget(state, order.focusId, order.focusKind)
    return !!target && inWeaponRange(unit, target) && shotClear(state, unit.x, unit.y, target.x, target.y)
  }
  return false
}

function fadeEffects(state: MatchState, dt: number): void {
  state.underAttackCd = Math.max(0, state.underAttackCd - dt)
  for (const particle of state.particles) {
    particle.life -= dt
    particle.x += particle.vx * dt
    particle.y += particle.vy * dt
  }
  if (state.particles.length > 220) state.particles.splice(0, state.particles.length - 220)
  state.particles = state.particles.filter((particle) => particle.life > 0)
  for (const ping of state.pings) ping.life -= dt
  state.pings = state.pings.filter((ping) => ping.life > 0)
  for (const toast of state.toasts) toast.life -= dt
  state.toasts = state.toasts.filter((toast) => toast.life > 0)
  if (state.events.length > 48) state.events.splice(0, state.events.length - 48)
}
