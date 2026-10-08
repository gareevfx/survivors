import { builderTravel, findBuildSpot, gatherBlockRock, harvestTime, haulCost, nearestParking, setUnitDestination, stopMoving } from './nav'
import { depositKnown } from './vision'
import {
  buildingById,
  buildingCenter,
  buildingRect,
  canPlace,
  makeBuilding,
  placementAllowed,
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

/**
 * Rank a revealed deposit. Open ground beats any sealed patch. Dunmarch uses
 * path length; Northmark uses straight-line distance inside that same split.
 * Unreachable deposits sort last.
 */
function revealedScore(state: MatchState, unit: Unit, node: { tx: number; ty: number }): number {
  const access = haulCost(state, unit, node)
  if (!Number.isFinite(access)) return 2_000_000_000 + depositDistance(unit, node)
  if (unit.owner === 1) return access
  if (access >= 1_000_000) return 1_000_000_000 + depositDistance(unit, node)
  return depositDistance(unit, node)
}

/** Path length to an expansion. Open ground sorts ahead of a sealed patch. */
function expansionScore(state: MatchState, unit: Unit, node: { tx: number; ty: number }): number {
  const access = haulCost(state, unit, node)
  if (!Number.isFinite(access)) return 2_000_000_000 + depositDistance(unit, node)
  return access
}

function castleMineralsRemain(state: MatchState, owner: PlayerId): boolean {
  return state.ore.some(
    (node) => node.amount > 0 && node.base === owner && depositKnown(state, owner, node.tx, node.ty),
  )
}

function noteProgress(unit: Unit): void {
  unit.stuckOrderT = 0
  unit.stuckX = unit.x
  unit.stuckY = unit.y
  unit.avoidNode = -1
  unit.avoidUntil = 0
}

function giveDeposit(state: MatchState, unit: Unit, node: { id: number; tx: number; ty: number }): void {
  noteProgress(unit)
  unit.nodeMemory = node.id
  unit.idleAcquire = false
  if (unit.cargo > 0) {
    unit.order = { type: 'gather', nodeId: node.id, phase: 'return' }
    stopMoving(unit)
    return
  }
  const rock = gatherBlockRock(state, unit, node)
  if (rock) {
    unit.order = { type: 'attack', targetId: rock.id, kind: 'rock', resumeNode: node.id }
    stopMoving(unit)
    return
  }
  unit.order = { type: 'gather', nodeId: node.id, phase: 'approach' }
  stopMoving(unit)
}

function pickMinerTarget(
  state: MatchState,
  miners: Unit[],
  room: (id: number) => boolean,
  mode: 'base' | 'revealed' | 'buried',
): { index: number; node: { id: number; tx: number; ty: number } } | null {
  let bestIndex = -1
  let bestNode: { id: number; tx: number; ty: number } | null = null
  let bestD = Infinity
  for (let i = 0; i < miners.length; i++) {
    const unit = miners[i]
    if (!unit) continue
    for (const node of state.ore) {
      if (!room(node.id)) continue
      if (unit.avoidNode === node.id && state.time < unit.avoidUntil) continue
      const known = depositKnown(state, unit.owner, node.tx, node.ty)
      let distance = Infinity
      if (mode === 'base') {
        if (node.base !== unit.owner || !known) continue
        distance = revealedScore(state, unit, node)
      } else if (mode === 'revealed') {
        if (!known || node.base === unit.owner) continue
        distance = expansionScore(state, unit, node)
      } else {
        distance = harvestTime(state, unit, node)
      }
      if (distance < bestD) {
        bestD = distance
        bestIndex = i
        bestNode = node
      }
    }
  }
  if (!bestNode || bestIndex < 0) return null
  return { index: bestIndex, node: bestNode }
}

/**
 * Send these miners to ore. A clicked deposit fills first, up to MINERS_PER_DEPOSIT,
 * counting miners already working it. Castle-area minerals come next, until that
 * base is empty. After that, everyone takes the nearest revealed expansion by
 * path length. When no revealed minerals remain, they open the buried patch that
 * takes the least travel and rock-breaking time. Miners with no slot wait
 * (nodeMemory 0) until one opens.
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
    giveDeposit(state, unit, node)
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

  const homeLeft = castleMineralsRemain(state, owner)
  const revealedRemain = state.ore.some(
    (node) => node.amount > 0 && node.base !== owner && depositKnown(state, owner, node.tx, node.ty),
  )
  const left = [...pending]
  while (left.length) {
    const mode = homeLeft ? 'base' : revealedRemain ? 'revealed' : 'buried'
    const picked = pickMinerTarget(state, left, room, mode)
    if (!picked) break
    const unit = left.splice(picked.index, 1)[0]
    if (!unit) break
    claim(unit, picked.node)
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

/**
 * A worker has not been able to move. Gather and rock-clearing switch to the
 * next deposit with room. Construction switches to the next unfinished site,
 * or to minerals if there is none. A return trip and an explicit move or
 * attack keep their target and only take a fresh path.
 */
export function redirectStuckPorter(state: MatchState, unit: Unit): void {
  if (unit.kind !== 'porter' || unit.hp <= 0) return
  const order = unit.order
  if (!order) return
  unit.stuckOrderT = 0
  unit.stuckX = unit.x
  unit.stuckY = unit.y
  if (order.type === 'gather' && order.phase === 'return') {
    stopMoving(unit)
    return
  }
  if (order.type === 'gather') {
    sendNextDeposit(state, unit, order.nodeId)
    return
  }
  if (order.type === 'attack' && order.resumeNode != null) {
    sendNextDeposit(state, unit, order.resumeNode)
    return
  }
  if (order.type === 'construct') {
    const next = nearestOpenSite(state, unit, order.buildingId)
    if (next) {
      noteProgress(unit)
      unit.order = { type: 'construct', buildingId: next.id }
      unit.nodeMemory = -1
      stopMoving(unit)
      return
    }
    sendNextDeposit(state, unit, null)
    return
  }
  if (unit.goalX != null && unit.goalY != null) {
    const gx = unit.goalX
    const gy = unit.goalY
    unit.path = []
    setUnitDestination(state, unit, gx, gy)
  }
}

function nearestOpenSite(state: MatchState, unit: Unit, excludeId: number): { id: number } | null {
  let best: { id: number } | null = null
  let bestD = Infinity
  for (const building of state.buildings) {
    if (building.id === excludeId || building.owner !== unit.owner || building.hp <= 0 || building.complete) continue
    const center = buildingCenter(building)
    const distance = (center.x - unit.x) ** 2 + (center.y - unit.y) ** 2
    if (distance < bestD) {
      bestD = distance
      best = building
    }
  }
  return best
}

function sendNextDeposit(state: MatchState, unit: Unit, excludeId: number | null): void {
  const counts = new Map<number, number>()
  for (const other of state.units) {
    if (other.id === unit.id || other.owner !== unit.owner || other.kind !== 'porter' || other.hp <= 0) continue
    const id = depositOf(other)
    if (id == null) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const homeLeft = castleMineralsRemain(state, unit.owner)
  const revealedRemain = state.ore.some(
    (node) =>
      node.amount > 0 &&
      node.id !== excludeId &&
      node.base !== unit.owner &&
      depositKnown(state, unit.owner, node.tx, node.ty),
  )
  let best: { id: number; tx: number; ty: number } | null = null
  let bestD = Infinity
  for (const node of state.ore) {
    if (node.amount <= 0) continue
    if (excludeId != null && node.id === excludeId) continue
    if ((counts.get(node.id) ?? 0) >= MINERS_PER_DEPOSIT) continue
    if (unit.avoidNode === node.id && state.time < unit.avoidUntil) continue
    const known = depositKnown(state, unit.owner, node.tx, node.ty)
    if (homeLeft) {
      if (node.base !== unit.owner || !known) continue
      const distance = revealedScore(state, unit, node)
      if (distance < bestD) {
        bestD = distance
        best = node
      }
      continue
    }
    if (revealedRemain) {
      if (!known || node.base === unit.owner) continue
      const distance = expansionScore(state, unit, node)
      if (distance < bestD) {
        bestD = distance
        best = node
      }
      continue
    }
    const time = harvestTime(state, unit, node)
    if (time < bestD) {
      bestD = time
      best = node
    }
  }
  if (!best) {
    unit.order = null
    unit.nodeMemory = -1
    unit.avoidNode = excludeId ?? -1
    unit.avoidUntil = state.time + 8
    stopMoving(unit)
    return
  }
  giveDeposit(state, unit, best)
}

export function commandStop(state: MatchState, ids: number[]): void {
  if (state.outcome || state.paused) return
  for (const unit of living(state, ids)) {
    noteProgress(unit)
    unit.order = null
    unit.nodeMemory = -1
    unit.idleAcquire = false
    stopMoving(unit)
  }
}

export function commandMove(state: MatchState, ids: number[], x: number, y: number, attackMove: boolean): void {
  if (state.outcome || state.paused) return
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
    noteProgress(unit)
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
  if (state.outcome || state.paused) return
  let owner: PlayerId | null = null
  let x = 0
  let y = 0
  let neutral = false
  let victimKind: UnitKind | null = null
  if (kind === 'unit') {
    const target = unitById(state, targetId)
    if (!target || target.hp <= 0) return
    owner = target.owner
    victimKind = target.kind
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
    if (unit.kind === 'drone') return false
    if (kind === 'rock' && unit.kind !== 'porter') return false
    if (victimKind === 'drone' && unit.kind === 'howler') return false
    return neutral || unit.owner !== owner
  })
  if (!units.length) return
  for (const unit of units) {
    noteProgress(unit)
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
  if (state.outcome || state.paused) return
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
  if (state.outcome || state.paused) return
  const building = buildingById(state, buildingId)
  if (!building || building.hp <= 0 || building.complete) return
  const crew = living(state, ids).filter((unit) => unit.kind === 'porter' && unit.owner === building.owner)
  if (!crew.length) return
  for (const unit of crew) {
    noteProgress(unit)
    unit.order = { type: 'construct', buildingId: building.id }
    unit.idleAcquire = false
    unit.nodeMemory = -1
    stopMoving(unit)
  }
  noteOrder(state, crew)
}

export function commandRally(state: MatchState, buildingId: number, x: number, y: number): void {
  if (state.outcome || state.paused) return
  const building = buildingById(state, buildingId)
  if (!building || building.owner !== 0 || building.hp <= 0) return
  building.rallyX = x
  building.rallyY = y
  state.pings.push({ x, y, life: 0.5, max: 0.5, color: '#9fd8ff' })
  state.events.push({ type: 'order' })
}

export function tryTrain(state: MatchState, buildingId: number, kind: UnitKind): string | null {
  if (state.paused) return null
  if (state.outcome) return 'The battle is over'
  const building = buildingById(state, buildingId)
  if (!building || building.hp <= 0) return 'That structure is gone'
  if (!building.complete) return 'Still under construction'
  if (building.kind === 'keep' && kind !== 'porter') return 'The Silo trains stalkers'
  if (building.kind === 'yard' && kind === 'porter') return 'The Factory trains flashers, gorillas, and hovers'
  if (building.kind === 'silo') return 'A storage does not train anyone'
  const stats = UNIT_STATS[kind]
  if (state.oreHeld[building.owner] < stats.cost) return `Need ${stats.cost} dumps`
  if (stats.supply > 0 && state.supplyUsed[building.owner] + stats.supply > state.supplyCap[building.owner]) {
    return 'Cells cap reached — raise a Storage'
  }
  if (building.queue.length >= 5) return 'Training queue is full'
  state.oreHeld[building.owner] -= stats.cost
  building.queue.push({ kind, remaining: stats.trainTime, total: stats.trainTime })
  recomputeSupply(state)
  if (building.owner === 0) state.events.push({ type: 'build' })
  return null
}

export function cancelTrain(state: MatchState, buildingId: number): void {
  if (state.outcome || state.paused) return
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
  if (state.paused) return null
  if (state.outcome) return 'The battle is over'
  if (kind === 'keep') return 'The Silo is already standing'
  const stats = BUILDING_STATS[kind]
  if (state.oreHeld[owner] < stats.cost) return `Need ${stats.cost} dumps`
  if (!canPlace(state, kind, tx, ty)) return 'That ground will not hold it'
  if (!placementAllowed(state, owner, kind, tx, ty)) return 'Pillars must stand inside Silo sight'

  const porters = state.units.filter((unit) => unit.owner === owner && unit.kind === 'porter' && unit.hp > 0)
  const preferred = new Set(preferredPorterIds)
  let crew: Unit[]
  if (preferred.size === 0) {
    const choice = nearestFreeBuilder(state, owner, tx, ty, stats.w, stats.h)
    if (!choice) {
      return porters.length
        ? 'No free Stalker. Idle stalkers build first, then miners.'
        : 'You need a stalker to build'
    }
    crew = [choice]
  } else {
    const pool = porters.filter((unit) => preferred.has(unit.id))
    const choices = (pool.length ? pool : porters).slice().sort((a, b) => {
      const da = (a.x - (tx + stats.w / 2) * TILE) ** 2 + (a.y - (ty + stats.h / 2) * TILE) ** 2
      const db = (b.x - (tx + stats.w / 2) * TILE) ** 2 + (b.y - (ty + stats.h / 2) * TILE) ** 2
      return da - db
    })
    if (!choices.length) return 'You need a stalker to build'
    crew = choices.slice(0, Math.min(2, choices.length))
  }

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
  if (state.outcome || state.paused) return
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
  if (building.owner === 0) pushToast(state, `Cancelled. Returned ${refund} dumps.`)
}

/**
 * Idle workers first, then workers who are mining or carrying minerals home.
 * Someone already sent to a building stays there. Path length picks the
 * nearest; a worker with no route falls back to straight-line distance.
 */
export function nearestFreeBuilder(
  state: MatchState,
  owner: PlayerId,
  tx: number,
  ty: number,
  w: number,
  h: number,
): Unit | null {
  const centerX = (tx + w / 2) * TILE
  const centerY = (ty + h / 2) * TILE
  let best: Unit | null = null
  let bestTier = Infinity
  let bestScore = Infinity
  for (const unit of state.units) {
    if (unit.owner !== owner || unit.kind !== 'porter' || unit.hp <= 0) continue
    const tier = freeBuilderTier(unit)
    if (tier == null) continue
    const along = builderTravel(state, unit, tx, ty, w, h)
    const score = Number.isFinite(along)
      ? along
      : 1_000_000 + Math.hypot(unit.x - centerX, unit.y - centerY) / TILE
    if (tier < bestTier || (tier === bestTier && score < bestScore)) {
      best = unit
      bestTier = tier
      bestScore = score
    }
  }
  return best
}

/** 0 = idle, 1 = mining or returning minerals. Builders and other orders are busy. */
function freeBuilderTier(unit: Unit): 0 | 1 | null {
  if (unit.order?.type === 'construct') return null
  if (unit.order == null && unit.cargo <= 0) return 0
  if (unit.cargo > 0) return 1
  if (unit.order?.type === 'gather') return 1
  if (unit.order?.type === 'attack' && unit.order.resumeNode != null) return 1
  return null
}

/** An unfinished building with nobody assigned gets the next nearest free worker. */
export function coverOpenSites(state: MatchState): void {
  for (const building of state.buildings) {
    if (building.complete || building.hp <= 0 || building.kind === 'keep') continue
    const staffed = state.units.some(
      (unit) => unit.hp > 0 && unit.order?.type === 'construct' && unit.order.buildingId === building.id,
    )
    if (staffed) continue
    const stats = BUILDING_STATS[building.kind]
    const worker = nearestFreeBuilder(state, building.owner, building.tx, building.ty, stats.w, stats.h)
    if (!worker) continue
    worker.order = { type: 'construct', buildingId: building.id }
    worker.idleAcquire = false
    worker.nodeMemory = -1
    stopMoving(worker)
  }
}

export function aiPlaceNearKeep(state: MatchState, kind: 'yard' | 'silo' | 'tower', owner: PlayerId = 1): boolean {
  const keep = state.buildings.find((building) => building.owner === owner && building.kind === 'keep' && building.hp > 0)
  if (!keep) return false
  const spot = findBuildSpot(state, kind, keep.tx, keep.ty)
  if (!spot) return false
  return tryPlace(state, owner, kind, spot.tx, spot.ty, []) === null
}
