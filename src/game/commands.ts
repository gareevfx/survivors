import { findBuildSpot, gatherBlockRock, nearestParking, setUnitDestination, stopMoving } from './nav'
import {
  buildingById,
  buildingCenter,
  buildingRect,
  canPlace,
  makeBuilding,
  pushToast,
  rebuildBlocked,
  recomputeSupply,
  rockById,
  unitById,
} from './state'
import {
  BUILDING_STATS,
  TILE,
  UNIT_STATS,
  type BuildingKind,
  type MatchState,
  type PlayerId,
  type TargetKind,
  type Unit,
  type UnitKind,
} from './types'

function living(state: MatchState, ids: number[]): Unit[] {
  const units: Unit[] = []
  for (const id of ids) {
    const unit = unitById(state, id)
    if (unit && unit.hp > 0) units.push(unit)
  }
  return units
}

function noteOrder(state: MatchState, units: Unit[]): void {
  if (units.some((unit) => unit.owner === 0)) state.events.push({ type: 'order' })
}

export function commandStop(state: MatchState, ids: number[]): void {
  if (state.outcome) return
  for (const unit of living(state, ids)) {
    unit.order = null
    unit.idleAcquire = false
    stopMoving(unit)
  }
}

export function commandMove(state: MatchState, ids: number[], x: number, y: number, attackMove: boolean): void {
  if (state.outcome) return
  const units = living(state, ids)
  if (!units.length) return
  const cols = Math.ceil(Math.sqrt(units.length))
  const spacing = 26
  const rows = Math.ceil(units.length / cols)
  units.sort((a, b) => a.y - b.y || a.x - b.x)
  units.forEach((unit, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    const ox = (col - (cols - 1) / 2) * spacing
    const oy = (row - (rows - 1) / 2) * spacing
    const gx = x + ox
    const gy = y + oy
    if (attackMove) {
      unit.order = { type: 'attackMove', x: gx, y: gy, focusId: null, focusKind: null }
    } else {
      unit.order = { type: 'move', x: gx, y: gy }
    }
    unit.idleAcquire = false
    unit.leashX = null
    unit.leashY = null
    setUnitDestination(state, unit, gx, gy)
  })
  if (units.some((unit) => unit.owner === 0)) {
    state.pings.push({
      x,
      y,
      life: 0.6,
      max: 0.6,
      color: attackMove ? '#ffb089' : '#d7f08a',
    })
  }
  noteOrder(state, units)
}

export function commandAttack(
  state: MatchState,
  ids: number[],
  targetId: number,
  kind: TargetKind,
): void {
  if (state.outcome) return
  let owner: PlayerId | null = null
  let x = 0
  let y = 0
  let neutral = false
  if (kind === 'unit') {
    const target = unitById(state, targetId)
    if (!target || target.hp <= 0) return
    owner = target.owner
    x = target.x
    y = target.y
  } else if (kind === 'building') {
    const target = buildingById(state, targetId)
    if (!target || target.hp <= 0) return
    owner = target.owner
    const center = buildingCenter(target)
    x = center.x
    y = center.y
  } else {
    const target = rockById(state, targetId)
    if (!target || target.hp <= 0) return
    neutral = true
    x = (target.tx + 0.5) * TILE
    y = (target.ty + 0.5) * TILE
  }
  const units = living(state, ids).filter((unit) => {
    if (kind === 'rock' && unit.kind === 'howler') return false
    return neutral || unit.owner !== owner
  })
  if (!units.length) return
  for (const unit of units) {
    unit.order = { type: 'attack', targetId, kind }
    unit.idleAcquire = false
    unit.leashX = null
    unit.leashY = null
    stopMoving(unit)
  }
  if (units.some((unit) => unit.owner === 0)) {
    state.pings.push({ x, y, life: 0.45, max: 0.45, color: '#ff7a68' })
  }
  noteOrder(state, units)
}

export function commandGather(state: MatchState, ids: number[], nodeId: number): void {
  if (state.outcome) return
  const node = state.ore.find((entry) => entry.id === nodeId && entry.amount > 0)
  if (!node) return
  const units = living(state, ids)
  const porters = units.filter((unit) => unit.kind === 'porter')
  const others = units.filter((unit) => unit.kind !== 'porter')
  for (const unit of porters) {
    unit.order = {
      type: 'gather',
      nodeId,
      phase: unit.cargo > 0 ? 'return' : 'approach',
    }
    unit.nodeMemory = nodeId
    unit.idleAcquire = false
    stopMoving(unit)
  }
  for (const unit of porters) {
    if (unit.cargo > 0) continue
    const rock = gatherBlockRock(state, unit, node)
    if (!rock) continue
    unit.order = { type: 'attack', targetId: rock.id, kind: 'rock', resumeNode: nodeId }
    stopMoving(unit)
  }
  if (others.length) {
    commandMove(
      state,
      others.map((unit) => unit.id),
      (node.tx + 0.5) * TILE,
      (node.ty + 0.5) * TILE,
      false,
    )
  } else if (porters.length) {
    state.pings.push({
      x: (node.tx + 0.5) * TILE,
      y: (node.ty + 0.5) * TILE,
      life: 0.45,
      max: 0.45,
      color: '#e6c15a',
    })
    noteOrder(state, porters)
  }
}

export function commandRally(state: MatchState, buildingId: number, x: number, y: number): void {
  if (state.outcome) return
  const building = buildingById(state, buildingId)
  if (!building || building.owner !== 0 || building.hp <= 0) return
  building.rallyX = x
  building.rallyY = y
  state.pings.push({ x, y, life: 0.5, max: 0.5, color: '#9fd8ff' })
  state.events.push({ type: 'order' })
}

export function tryTrain(state: MatchState, buildingId: number, kind: UnitKind): string | null {
  if (state.outcome) return 'The battle is over'
  const building = buildingById(state, buildingId)
  if (!building || building.hp <= 0) return 'That structure is gone'
  if (!building.complete) return 'Still under construction'
  if (building.kind === 'keep' && kind !== 'porter') return 'The Castle trains miners'
  if (building.kind === 'yard' && kind === 'porter') return 'The Factory trains fighters'
  if (building.kind === 'silo') return 'A silo does not train anyone'
  const stats = UNIT_STATS[kind]
  if (state.oreHeld[building.owner] < stats.cost) return `Need ${stats.cost} ore`
  if (state.supplyUsed[building.owner] + stats.supply > state.supplyCap[building.owner]) {
    return 'Population cap reached — raise a Silo'
  }
  if (building.queue.length >= 5) return 'Training queue is full'
  state.oreHeld[building.owner] -= stats.cost
  building.queue.push({ kind, remaining: stats.trainTime, total: stats.trainTime })
  recomputeSupply(state)
  if (building.owner === 0) state.events.push({ type: 'build' })
  return null
}

export function cancelTrain(state: MatchState, buildingId: number): void {
  if (state.outcome) return
  const building = buildingById(state, buildingId)
  if (!building || building.queue.length === 0) return
  const job = building.queue.pop()
  if (!job) return
  state.oreHeld[building.owner] += UNIT_STATS[job.kind].cost
  recomputeSupply(state)
  if (building.owner === 0) pushToast(state, `Cancelled ${UNIT_STATS[job.kind].label}.`)
}

function ejectFrom(state: MatchState, building: ReturnType<typeof makeBuilding>): void {
  const rect = buildingRect(building)
  const stats = BUILDING_STATS[building.kind]
  for (const unit of state.units) {
    const inside =
      unit.x >= rect.x && unit.x <= rect.x + rect.w && unit.y >= rect.y && unit.y <= rect.y + rect.h
    if (!inside) continue
    const spot = nearestParking(state, building.tx, building.ty, stats.w, stats.h, unit.x, unit.y)
    if (spot) {
      unit.x = spot.x
      unit.y = spot.y
    }
    stopMoving(unit)
  }
}

export function tryPlace(
  state: MatchState,
  owner: PlayerId,
  kind: BuildingKind,
  tx: number,
  ty: number,
  preferredPorterIds: number[],
): string | null {
  if (state.outcome) return 'The battle is over'
  if (kind === 'keep') return 'The Castle is already standing'
  const stats = BUILDING_STATS[kind]
  if (state.oreHeld[owner] < stats.cost) return `Need ${stats.cost} ore`
  if (!canPlace(state, kind, tx, ty)) return 'That ground will not hold it'

  const porters = state.units.filter((unit) => unit.owner === owner && unit.kind === 'porter' && unit.hp > 0)
  const preferred = new Set(preferredPorterIds)
  const pool = preferred.size
    ? porters.filter((unit) => preferred.has(unit.id))
    : porters
  const choices = (pool.length ? pool : porters).slice().sort((a, b) => {
    const da = (a.x - (tx + stats.w / 2) * TILE) ** 2 + (a.y - (ty + stats.h / 2) * TILE) ** 2
    const db = (b.x - (tx + stats.w / 2) * TILE) ** 2 + (b.y - (ty + stats.h / 2) * TILE) ** 2
    return da - db
  })
  if (!choices.length) return 'You need a miner to build'
  const limit = preferred.size === 0 ? 1 : Math.min(2, choices.length)
  const crew = choices.slice(0, limit)

  state.oreHeld[owner] -= stats.cost
  const building = makeBuilding(state, owner, kind, tx, ty, false)
  const center = buildingCenter(building)
  building.rallyX = center.x
  building.rallyY = (ty + stats.h) * TILE + 16
  rebuildBlocked(state)
  ejectFrom(state, building)

  for (const porter of crew) {
    porter.order = { type: 'construct', buildingId: building.id }
    porter.idleAcquire = false
    stopMoving(porter)
  }

  if (owner === 0) {
    state.placement = null
    state.attackMoveArmed = false
    state.moveArmed = false
    state.selectedBuilding = building.id
    state.selectedUnits = []
    state.selectedOre = null
    state.events.push({ type: 'build' })
    pushToast(state, `Raising a ${stats.label}.`)
  }
  return null
}

export function cancelBuilding(state: MatchState, buildingId: number): void {
  if (state.outcome) return
  const building = buildingById(state, buildingId)
  if (!building || building.complete || building.kind === 'keep') return
  const refund = Math.floor(BUILDING_STATS[building.kind].cost * 0.75)
  for (const job of building.queue) state.oreHeld[building.owner] += UNIT_STATS[job.kind].cost
  state.oreHeld[building.owner] += refund
  state.buildings = state.buildings.filter((entry) => entry.id !== building.id)
  for (const unit of state.units) {
    if (unit.order?.type === 'construct' && unit.order.buildingId === building.id) {
      unit.order = null
      stopMoving(unit)
    }
  }
  if (state.selectedBuilding === building.id) state.selectedBuilding = null
  rebuildBlocked(state)
  recomputeSupply(state)
  if (building.owner === 0) pushToast(state, `Cancelled. Returned ${refund} ore.`)
}

export function aiPlaceNearKeep(state: MatchState, kind: 'yard' | 'silo'): boolean {
  const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  if (!keep) return false
  const spot = findBuildSpot(state, kind, keep.tx, keep.ty)
  if (!spot) return false
  return tryPlace(state, 1, kind, spot.tx, spot.ty, []) === null
}
