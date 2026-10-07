import { findBuildSpot, nearestParking, setUnitDestination, stopMoving } from './nav'
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
  MINERS_PER_DEPOSIT,
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

function depositOf(unit: Unit): number | null {
  const order = unit.order
  if (order?.type === 'gather') return order.nodeId
  if (order?.type === 'attack' && order.kind === 'rock' && order.resumeNode != null) return order.resumeNode
  return null
}

function depositDistance(unit: Unit, node: { tx: number; ty: number }): number {
  const dx = (node.tx + 0.5) * TILE - unit.x
  const dy = (node.ty + 0.5) * TILE - unit.y
  return dx * dx + dy * dy
}

function giveDeposit(unit: Unit, node: { id: number; tx: number; ty: number }): void {
  unit.nodeMemory = node.id
  unit.idleAcquire = false
  if (unit.cargo > 0) {
    unit.order = { type: 'gather', nodeId: node.id, phase: 'return' }
    stopMoving(unit)
    return
  }
  unit.order = { type: 'gather', nodeId: node.id, phase: 'approach' }
  stopMoving(unit)
}

/**
 * Send these miners to ore. A clicked deposit fills first, up to MINERS_PER_DEPOSIT,
 * counting miners already working it. Everyone else takes the nearest deposit that
 * still has ore and a free slot. Miners with no slot wait (nodeMemory 0) until one opens.
 */
export function assignMiners(state: MatchState, miners: Unit[], preferredId: number | null): void {
  const crew = miners.filter((unit) => unit.hp > 0 && unit.kind === 'porter')
  if (!crew.length) return
  const owner = crew[0]?.owner
  if (owner == null) return
  const same = crew.filter((unit) => unit.owner === owner)
  const exclude = new Set(same.map((unit) => unit.id))
  const counts = new Map<number, number>()
  for (const unit of state.units) {
    if (exclude.has(unit.id) || unit.owner !== owner || unit.kind !== 'porter' || unit.hp <= 0) continue
    const id = depositOf(unit)
    if (id == null) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const room = (id: number) => {
    const node = state.ore.find((entry) => entry.id === id && entry.amount > 0)
    return !!node && (counts.get(id) ?? 0) < MINERS_PER_DEPOSIT
  }
  const claim = (unit: Unit, node: { id: number; tx: number; ty: number }) => {
    counts.set(node.id, (counts.get(node.id) ?? 0) + 1)
    giveDeposit(unit, node)
  }

  const pending = new Set(same)
  const preferred = preferredId != null ? state.ore.find((entry) => entry.id === preferredId && entry.amount > 0) : undefined
  if (preferred && room(preferred.id)) {
    const closest = same.slice().sort((a, b) => depositDistance(a, preferred) - depositDistance(b, preferred))
    for (const unit of closest) {
      if (!room(preferred.id)) break
      claim(unit, preferred)
      pending.delete(unit)
    }
  }

  const left = [...pending]
  while (left.length) {
    let bestIndex = -1
    let bestNode: { id: number; tx: number; ty: number } | null = null
    let bestD = Infinity
    for (let i = 0; i < left.length; i++) {
      const unit = left[i]
      if (!unit) continue
      for (const node of state.ore) {
        if (!room(node.id)) continue
        const distance = depositDistance(unit, node)
        if (distance < bestD) {
          bestD = distance
          bestIndex = i
          bestNode = node
        }
      }
    }
    if (!bestNode || bestIndex < 0) break
    const unit = left.splice(bestIndex, 1)[0]
    if (!unit) break
    claim(unit, bestNode)
  }
  for (const unit of left) {
    unit.order = null
    unit.nodeMemory = 0
    unit.idleAcquire = false
    stopMoving(unit)
  }
}

/** Miners who were told to gather and are waiting for a free slot. */
export function fillOpenGatherSlots(state: MatchState): void {
  const waiting = state.units.filter(
    (unit) => unit.kind === 'porter' && unit.hp > 0 && unit.cargo <= 0 && unit.order == null && unit.nodeMemory === 0,
  )
  for (const owner of [0, 1] as const) {
    const group = waiting.filter((unit) => unit.owner === owner)
    if (group.length) assignMiners(state, group, null)
  }
}

export function commandStop(state: MatchState, ids: number[]): void {
  if (state.outcome) return
  for (const unit of living(state, ids)) {
    unit.order = null
    unit.nodeMemory = -1
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
    unit.nodeMemory = -1
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
    if (kind === 'rock' && unit.kind !== 'porter') return false
    return neutral || unit.owner !== owner
  })
  if (!units.length) return
  for (const unit of units) {
    unit.order = { type: 'attack', targetId, kind }
    unit.nodeMemory = -1
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
  if (porters.length) {
    assignMiners(state, porters, node.id)
    state.pings.push({
      x: (node.tx + 0.5) * TILE,
      y: (node.ty + 0.5) * TILE,
      life: 0.45,
      max: 0.45,
      color: '#e6c15a',
    })
    noteOrder(state, porters)
  }
  if (others.length) {
    commandMove(
      state,
      others.map((unit) => unit.id),
      (node.tx + 0.5) * TILE,
      (node.ty + 0.5) * TILE,
      false,
    )
  }
}

/** Send workers back to an unfinished building. Progress already on the site is kept. */
export function commandConstruct(state: MatchState, ids: number[], buildingId: number): void {
  if (state.outcome) return
  const building = buildingById(state, buildingId)
  if (!building || building.hp <= 0 || building.complete) return
  const crew = living(state, ids).filter((unit) => unit.kind === 'porter' && unit.owner === building.owner)
  if (!crew.length) return
  for (const unit of crew) {
    unit.order = { type: 'construct', buildingId: building.id }
    unit.idleAcquire = false
    unit.nodeMemory = -1
    stopMoving(unit)
  }
  noteOrder(state, crew)
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
  if (building.kind === 'keep' && kind !== 'porter') return 'The Castle trains workers'
  if (building.kind === 'yard' && kind === 'porter') return 'The Factory trains fighters'
  if (building.kind === 'silo') return 'A silo does not train anyone'
  const stats = UNIT_STATS[kind]
  if (state.oreHeld[building.owner] < stats.cost) return `Need ${stats.cost} minerals`
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
    const spot = nearestParking(state, building.tx, building.ty, stats.w, stats.h, unit.x, unit.y, unit.kind)
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
  if (state.oreHeld[owner] < stats.cost) return `Need ${stats.cost} minerals`
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
  if (!choices.length) return 'You need a worker to build'
  // A new site with nobody selected takes a free worker. Builders stay on the job they already have.
  const free = preferred.size === 0 ? choices.filter((unit) => unit.order?.type !== 'construct') : []
  const ranked = free.length ? free : choices
  const limit = preferred.size === 0 ? 1 : Math.min(2, ranked.length)
  const crew = ranked.slice(0, limit)

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
    porter.nodeMemory = -1
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
  if (building.owner === 0) pushToast(state, `Cancelled. Returned ${refund} minerals.`)
}

export function aiPlaceNearKeep(state: MatchState, kind: 'yard' | 'silo'): boolean {
  const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  if (!keep) return false
  const spot = findBuildSpot(state, kind, keep.tx, keep.ty)
  if (!spot) return false
  return tryPlace(state, 1, kind, spot.tx, spot.ty, []) === null
}
