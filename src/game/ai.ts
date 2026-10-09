import { aiPlaceNearKeep, assignMiners, commandAttack, commandMove, tryTrain } from './commands'
import { nearestWalkable } from './nav'
import { findPath } from './pathfind'
import { buildingCenter, rockAt } from './state'
import { BUILDING_STATS, TILE, type MatchState, type PlayerId, type Rock, type Unit } from './types'

/** Extra tiles of walking that justify stopping to break a rock for the army. */
const ROCK_DETOUR = 12

interface Brain {
  owner: PlayerId
  explored: Uint8Array
  visible: Uint8Array
  spotted: Array<{ id: number; x: number; y: number }>
  scout: number
  attacking: boolean
  next: 'pike' | 'howler'
}

function brain(state: MatchState, owner: PlayerId): Brain {
  if (owner === 0) {
    return {
      owner,
      explored: state.explored,
      visible: state.visible,
      spotted: state.playerSpotted,
      scout: state.playerAiScout,
      attacking: state.playerAiAttacking,
      next: state.playerAiNext,
    }
  }
  if (owner === 1) {
    return {
      owner,
      explored: state.aiExplored,
      visible: state.aiVisible,
      spotted: state.aiSpotted,
      scout: state.aiScout,
      attacking: state.aiAttacking,
      next: state.aiNext,
    }
  }
  return {
    owner,
    explored: state.sideExplored[owner] ?? state.aiExplored,
    visible: state.sideVisible[owner] ?? state.aiVisible,
    spotted: state.sideSpotted[owner] ?? [],
    scout: state.sideScout[owner] ?? 0,
    attacking: state.sideAttacking[owner] ?? false,
    next: state.sideNext[owner] ?? 'pike',
  }
}

function store(state: MatchState, side: Brain): void {
  if (side.owner === 0) {
    state.playerAiScout = side.scout
    state.playerAiAttacking = side.attacking
    state.playerAiNext = side.next
    return
  }
  if (side.owner === 1) {
    state.aiScout = side.scout
    state.aiAttacking = side.attacking
    state.aiNext = side.next
    return
  }
  state.sideScout[side.owner] = side.scout
  state.sideAttacking[side.owner] = side.attacking
  state.sideNext[side.owner] = side.next
}

function tileBit(state: MatchState, grid: Uint8Array, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= state.mapW || ty >= state.mapH) return false
  return grid[ty * state.mapW + tx] === 1
}

function idlePorter(unit: Unit, owner: PlayerId): boolean {
  return unit.owner === owner && unit.kind === 'porter' && unit.hp > 0 && !unit.order
}

/** Unexplored ground this close to the scout is searched first, so new minerals are found before a long hunt. */
const SCOUT_LOCAL = 16 * TILE
/** A Drone stays this far from a Bike it can see. A Bike's shot reaches 46. */
export const DRONE_BIKE_AVOID = 80
const DRONE_KEEP = 2

/**
 * Pick the next patch of fog to enter.
 * Nearby black ground comes first (new minerals). After that, unexplored ground
 * toward the far side of the map is the search for the enemy. Shroud is only
 * revisited while the Castle is still unknown.
 */
export function scoutArea(state: MatchState, fromX: number, fromY: number): { x: number; y: number } | null {
  return scoutFor(state, brain(state, 1), fromX, fromY)
}

function scoutFor(state: MatchState, side: Brain, fromX: number, fromY: number): { x: number; y: number } | null {
  const keep = state.buildings.find((building) => building.owner === side.owner && building.kind === 'keep' && building.hp > 0)
  const home = keep ? buildingCenter(keep) : { x: fromX, y: fromY }
  const castleKnown = spottedKeep(state, side.owner) != null
  const far = { x: state.mapW * TILE - home.x, y: state.mapH * TILE - home.y }
  let mineral: { x: number; y: number; d: number } | null = null
  let hunt: { x: number; y: number; score: number } | null = null
  let shroud: { x: number; y: number; score: number } | null = null
  for (let ty = 0; ty < state.mapH; ty += 2) {
    for (let tx = 0; tx < state.mapW; tx += 2) {
      const index = ty * state.mapW + tx
      const explored = side.explored[index] === 1
      const visible = side.visible[index] === 1
      if (visible) continue
      const x = (tx + 0.5) * TILE
      const y = (ty + 0.5) * TILE
      const fromScout = Math.hypot(x - fromX, y - fromY)
      if (fromScout < TILE) continue
      const towardEnemy = Math.hypot(x - far.x, y - far.y)
      if (!explored) {
        if (fromScout <= SCOUT_LOCAL && (!mineral || fromScout < mineral.d)) mineral = { x, y, d: fromScout }
        const score = fromScout + towardEnemy * (castleKnown ? 0.15 : 0.45)
        if (!hunt || score < hunt.score) hunt = { x, y, score }
        continue
      }
      if (castleKnown) continue
      const score = fromScout + towardEnemy * 0.45 + 800
      if (!shroud || score < shroud.score) shroud = { x, y, score }
    }
  }
  if (mineral) return { x: mineral.x, y: mineral.y }
  if (hunt) return { x: hunt.x, y: hunt.y }
  if (shroud) return { x: shroud.x, y: shroud.y }
  return null
}

function seenEnemyBikes(state: MatchState, side: Brain): Array<{ x: number; y: number }> {
  const bikes: Array<{ x: number; y: number }> = []
  for (const unit of state.units) {
    if (unit.owner === side.owner || unit.kind !== 'pike' || unit.hp <= 0) continue
    if (!tileBit(state, side.visible, Math.floor(unit.x / TILE), Math.floor(unit.y / TILE))) continue
    bikes.push({ x: unit.x, y: unit.y })
  }
  return bikes
}

function nearBike(bikes: Array<{ x: number; y: number }>, x: number, y: number): boolean {
  return bikes.some((bike) => Math.hypot(bike.x - x, bike.y - y) < DRONE_BIKE_AVOID)
}

/**
 * Next flight for a Drone. Nearby black ground comes first (hidden minerals),
 * then unexplored ground toward the enemy Castle, then gray ground that is
 * not being watched. After the whole map is in sight, the Drone patrols.
 */
function droneGoal(
  state: MatchState,
  side: Brain,
  fromX: number,
  fromY: number,
  reserved: Array<{ x: number; y: number }>,
): { x: number; y: number } {
  const bikes = seenEnemyBikes(state, side)
  const castle = spottedKeep(state, side.owner)
  const keep = state.buildings.find((building) => building.owner === side.owner && building.kind === 'keep' && building.hp > 0)
  const home = keep ? buildingCenter(keep) : { x: fromX, y: fromY }
  const far = { x: state.mapW * TILE - home.x, y: state.mapH * TILE - home.y }
  const foes = state.units.filter(
    (unit) =>
      unit.owner !== side.owner &&
      unit.hp > 0 &&
      unit.kind !== 'pike' &&
      tileBit(state, side.visible, Math.floor(unit.x / TILE), Math.floor(unit.y / TILE)),
  )
  const crowded = (x: number, y: number) => reserved.some((spot) => Math.hypot(spot.x - x, spot.y - y) < 8 * TILE)
  let local: { x: number; y: number; d: number } | null = null
  let hunt: { x: number; y: number; score: number } | null = null
  let shroud: { x: number; y: number; score: number } | null = null
  for (let ty = 0; ty < state.mapH; ty += 2) {
    for (let tx = 0; tx < state.mapW; tx += 2) {
      const index = ty * state.mapW + tx
      const explored = side.explored[index] === 1
      const visible = side.visible[index] === 1
      if (explored && visible) continue
      const x = (tx + 0.5) * TILE
      const y = (ty + 0.5) * TILE
      const fromScout = Math.hypot(x - fromX, y - fromY)
      if (fromScout < TILE * 2) continue
      if (nearBike(bikes, x, y)) continue
      const share = crowded(x, y) ? 2400 : 0
      const towardEnemy = Math.hypot(x - far.x, y - far.y)
      if (!explored) {
        if (fromScout <= SCOUT_LOCAL && (!local || fromScout + share < local.d)) local = { x, y, d: fromScout + share }
        const score = fromScout + towardEnemy * 0.35 + share
        if (!hunt || score < hunt.score) hunt = { x, y, score }
        continue
      }
      let score = fromScout + 700 + share
      if (castle) score += Math.hypot(x - castle.x, y - castle.y) * 0.2
      for (const foe of foes) {
        if (Math.hypot(x - foe.x, y - foe.y) < 220) score -= 280
      }
      if (!shroud || score < shroud.score) shroud = { x, y, score }
    }
  }
  if (local && local.d <= SCOUT_LOCAL) return { x: local.x, y: local.y }
  if (hunt) return { x: hunt.x, y: hunt.y }
  if (local) return { x: local.x, y: local.y }
  if (shroud) return { x: shroud.x, y: shroud.y }
  const patrol = [
    { x: 4.5 * TILE, y: 4.5 * TILE },
    { x: (state.mapW - 4.5) * TILE, y: 4.5 * TILE },
    { x: 4.5 * TILE, y: (state.mapH - 4.5) * TILE },
    { x: (state.mapW - 4.5) * TILE, y: (state.mapH - 4.5) * TILE },
    { x: far.x, y: far.y },
  ]
  let best = patrol[0] ?? { x: fromX + TILE * 4, y: fromY }
  let bestD = -1
  for (const spot of patrol) {
    if (nearBike(bikes, spot.x, spot.y)) continue
    const distance = Math.hypot(spot.x - fromX, spot.y - fromY) - (crowded(spot.x, spot.y) ? 10000 : 0)
    if (distance > bestD) {
      bestD = distance
      best = spot
    }
  }
  return best
}

/** Every living Drone stays on a scout flight. A second Drone takes a different patch. */
function dispatchDrones(state: MatchState, side: Brain): void {
  const drones = state.units.filter((unit) => unit.owner === side.owner && unit.kind === 'drone' && unit.hp > 0)
  if (!drones.length) return
  const bikes = seenEnemyBikes(state, side)
  const reserved: Array<{ x: number; y: number }> = []
  for (const drone of drones) {
    const order = drone.order
    const traveling = order?.type === 'move' && Math.hypot(drone.x - order.x, drone.y - order.y) > 80
    const threatened =
      nearBike(bikes, drone.x, drone.y) || (order?.type === 'move' && nearBike(bikes, order.x, order.y))
    if (traveling && !threatened) {
      reserved.push({ x: order.x, y: order.y })
      side.scout = drone.id
      continue
    }
    const goal = droneGoal(state, side, drone.x, drone.y, reserved)
    reserved.push(goal)
    side.scout = drone.id
    commandMove(state, [drone.id], goal.x, goal.y, false)
  }
}

/** A Bike, else one spare Worker, while no Drone is flying. Tanks stay with the army. */
function claimScout(state: MatchState, side: Brain, idle: Unit[]): Unit | null {
  if (state.units.some((unit) => unit.owner === side.owner && unit.kind === 'drone' && unit.hp > 0)) return null
  const porters = state.units.filter((unit) => unit.owner === side.owner && unit.kind === 'porter' && unit.hp > 0)
  const castleKnown = spottedKeep(state, side.owner) != null
  const current = state.units.find((unit) => unit.id === side.scout && unit.owner === side.owner && unit.hp > 0)
  if (
    current?.kind === 'pike' &&
    !side.attacking &&
    !castleKnown &&
    current.order?.type !== 'construct'
  ) {
    return current
  }
  if (!side.attacking && !castleKnown) {
    const bike = state.units.find(
      (unit) => unit.owner === side.owner && unit.kind === 'pike' && unit.hp > 0 && !unit.order,
    )
    if (bike) return bike
  }
  if (current?.kind === 'porter' && porters.length >= 2 && current.cargo <= 0 && current.order?.type !== 'construct') {
    return current
  }
  if (idle.length >= 2 && porters.length >= 2) return idle[idle.length - 1] ?? null
  return null
}

function sendScout(state: MatchState, side: Brain, scout: Unit | null): void {
  if (!scout) return
  const goal = scoutFor(state, side, scout.x, scout.y)
  if (!goal) return
  const order = scout.order
  if (order && (order.type === 'move' || order.type === 'attackMove')) {
    if (Math.hypot(scout.x - order.x, scout.y - order.y) > 80) return
  }
  side.scout = scout.id
  const fightOnTheWay = scout.kind === 'pike'
  commandMove(state, [scout.id], goal.x, goal.y, fightOnTheWay)
}

function spottedKeep(state: MatchState, owner: PlayerId): { id: number; x: number; y: number } | null {
  const side = brain(state, owner)
  const keep = state.buildings.find((building) => building.owner === owner && building.kind === 'keep' && building.hp > 0)
  const home = keep ? buildingCenter(keep) : { x: 0, y: 0 }
  let best: { id: number; x: number; y: number; distance: number } | null = null
  for (const spot of side.spotted) {
    const building = state.buildings.find((entry) => entry.id === spot.id && entry.hp > 0 && entry.owner !== owner)
    if (building?.kind !== 'keep') continue
    const distance = Math.hypot(spot.x - home.x, spot.y - home.y)
    if (!best || distance < best.distance) best = { id: building.id, x: spot.x, y: spot.y, distance }
  }
  return best ? { id: best.id, x: best.x, y: best.y } : null
}

/** The player Castle, once a Dunmarch unit has seen it. Destroying it is the attack objective. */
export function spottedPlayerKeep(state: MatchState): { id: number; x: number; y: number } | null {
  return spottedKeep(state, 1)
}

/** True when this side has seen the enemy Castle. Northmark's memory is its own sight. */
export function sideKnowsEnemyKeep(state: MatchState, owner: PlayerId): boolean {
  return spottedKeep(state, owner) != null
}

function knownEnemyBuilding(state: MatchState, side: Brain): { x: number; y: number } | null {
  const castle = spottedKeep(state, side.owner)
  if (castle) return { x: castle.x, y: castle.y }
  let fallback: { x: number; y: number } | null = null
  for (const spot of side.spotted) {
    const building = state.buildings.find((entry) => entry.id === spot.id && entry.hp > 0 && entry.owner !== side.owner)
    if (!building) continue
    fallback = { x: spot.x, y: spot.y }
  }
  return fallback
}

function keepStands(state: MatchState, owner: PlayerId): boolean {
  return state.buildings.some((building) => building.owner === owner && building.kind === 'keep' && building.hp > 0)
}

/**
 * Every computer side, and AI Control, shares this script.
 * A side with no Silo is already eliminated, so it is skipped.
 * Units and buildings captured with that Silo belong to the captor and are ordered here on the captor's turn.
 * Covered Stalkers are not auto-targets; a hit captures one only outside its own Silo, Flasher, and Gorilla sight.
 */
export function updateAi(state: MatchState, dt: number): void {
  if (state.outcome) return
  state.aiAcc += dt
  if (state.aiAcc >= 0.5) {
    state.aiAcc = 0
    if (!state.eliminated[1] && keepStands(state, 1)) runSide(state, 1)
  }
  for (let owner = 2; owner < state.playerCount; owner++) {
    state.sideAcc[owner] = (state.sideAcc[owner] ?? 0) + dt
    if ((state.sideAcc[owner] ?? 0) < 0.5) continue
    state.sideAcc[owner] = 0
    if (!state.eliminated[owner] && keepStands(state, owner)) runSide(state, owner)
  }
  if (!state.aiControl || state.eliminated[0] || !keepStands(state, 0)) return
  state.playerAiAcc += dt
  if (state.playerAiAcc < 0.5) return
  state.playerAiAcc = 0
  runSide(state, 0)
}

function dronesToTrain(state: MatchState, side: Brain): number {
  let living = 0
  for (const unit of state.units) {
    if (unit.owner === side.owner && unit.kind === 'drone' && unit.hp > 0) living += 1
  }
  let queued = 0
  for (const building of state.buildings) {
    if (building.owner !== side.owner || building.hp <= 0) continue
    for (const job of building.queue) if (job.kind === 'drone') queued += 1
  }
  const have = living + queued
  if (have >= DRONE_KEEP) return 0
  if (have === 0) return 1
  let combat = 0
  for (const unit of state.units) {
    if (unit.owner !== side.owner || unit.hp <= 0) continue
    if (unit.kind === 'pike' || unit.kind === 'howler') combat += 1
  }
  return combat >= 2 ? 1 : 0
}

function runSide(state: MatchState, owner: PlayerId): void {
  const side = brain(state, owner)
  dispatchDrones(state, side)
  const porters = state.units.filter((unit) => unit.owner === side.owner && unit.kind === 'porter' && unit.hp > 0)
  const idle = porters.filter((unit) => idlePorter(unit, side.owner))
  const scout = claimScout(state, side, idle)
  assignMiners(
    state,
    idle.filter((unit) => unit.id !== scout?.id),
    null,
  )
  sendScout(state, side, scout)

  const keep = state.buildings.find((building) => building.owner === side.owner && building.kind === 'keep' && building.hp > 0)
  if (!keep?.complete) {
    store(state, side)
    return
  }

  const queuedPorters = keep.queue.filter((job) => job.kind === 'porter').length
  if (porters.length + queuedPorters < 6 && keep.queue.length < 2) {
    tryTrain(state, keep.id, 'porter')
  }

  const constructing = state.buildings.some(
    (building) => building.owner === side.owner && !building.complete && building.hp > 0,
  )
  if (!constructing) {
    const supplyRoom = state.supplyCap[side.owner] - state.supplyUsed[side.owner]
    const ore = state.oreHeld[side.owner]
    const yards = state.buildings.filter(
      (building) => building.owner === side.owner && building.kind === 'yard' && building.hp > 0,
    ).length
    const towers = state.buildings.filter(
      (building) => building.owner === side.owner && building.kind === 'tower' && building.hp > 0,
    ).length
    if (supplyRoom <= 2 && ore >= BUILDING_STATS.silo.cost) {
      aiPlaceNearKeep(state, 'silo', side.owner)
    } else if (yards < 2 && ore >= BUILDING_STATS.yard.cost) {
      aiPlaceNearKeep(state, 'yard', side.owner)
    } else if (towers < 3 && ore >= BUILDING_STATS.tower.cost) {
      if (!aiPlaceNearKeep(state, 'tower', side.owner) && ore >= BUILDING_STATS.yard.cost) {
        aiPlaceNearKeep(state, 'yard', side.owner)
      }
    } else if (ore >= BUILDING_STATS.yard.cost) {
      aiPlaceNearKeep(state, 'yard', side.owner)
    }
  }

  const readyYards = state.buildings.filter(
    (building) => building.owner === side.owner && building.kind === 'yard' && building.complete && building.hp > 0,
  )
  let dronesLeft = dronesToTrain(state, side)
  for (const readyYard of readyYards) {
    if (readyYard.queue.length >= 1) continue
    if (dronesLeft > 0 && tryTrain(state, readyYard.id, 'drone') === null) {
      dronesLeft -= 1
      continue
    }
    const first = side.next
    const second = first === 'pike' ? 'howler' : 'pike'
    if (tryTrain(state, readyYard.id, first) === null) side.next = second
    else tryTrain(state, readyYard.id, second)
  }

  const army = state.units.filter(
    (unit) => unit.owner === side.owner && unit.kind !== 'porter' && unit.kind !== 'drone' && unit.hp > 0,
  )
  const keepPoint = buildingCenter(keep)
  const homeAlert = castleUnderAttack(state, side, keepPoint)
  const castle = spottedKeep(state, side.owner)
  const spotted = knownEnemyBuilding(state, side)
  if (spotted && (army.length >= 10 || (state.time > 105 && army.length >= 5))) side.attacking = true
  if (army.length === 0) side.attacking = false
  const garrison = garrisonIds(army, keepPoint)
  if (homeAlert) {
    recallToCastle(state, army, keepPoint)
    store(state, side)
    return
  }
  if (!side.attacking || !spotted) {
    store(state, side)
    return
  }
  holdGarrison(state, army, garrison, keepPoint)

  const dest = castle ?? spotted
  const strikers = army.filter((unit) => !garrison.has(unit.id))
  const blocker = rockBlockingMarch(state, strikers, dest.x, dest.y)
  if (blocker) assignRockBreakers(state, side.owner, blocker.rock, blocker.trapped)
  for (const unit of strikers) {
    const order = unit.order
    if (castle && order?.type === 'attack' && order.kind === 'building' && order.targetId !== castle.id) {
      commandMove(state, [unit.id], dest.x, dest.y, true)
      continue
    }
    if (castle && order?.type === 'attackMove' && order.focusKind === 'building' && order.focusId !== castle.id) {
      order.focusId = null
      order.focusKind = null
    }
    if (order?.type === 'attack') continue
    if (order?.type === 'attackMove' && order.focusId != null) continue
    if (order?.type === 'attackMove' && Math.hypot(order.x - dest.x, order.y - dest.y) < 56) continue
    commandMove(state, [unit.id], dest.x, dest.y, true)
  }
  store(state, side)
}

/** Combat units already beside the Castle stay there. Two is enough for a standing guard. */
const HOME_GUARD = 2
const HOME_NEAR = 220

function garrisonIds(army: Unit[], keepPoint: { x: number; y: number }): Set<number> {
  const near = army
    .filter((unit) => Math.hypot(unit.x - keepPoint.x, unit.y - keepPoint.y) <= HOME_NEAR)
    .sort(
      (a, b) =>
        Math.hypot(a.x - keepPoint.x, a.y - keepPoint.y) - Math.hypot(b.x - keepPoint.x, b.y - keepPoint.y),
    )
    .slice(0, HOME_GUARD)
  return new Set(near.map((unit) => unit.id))
}

function holdGarrison(
  state: MatchState,
  army: Unit[],
  garrison: Set<number>,
  keepPoint: { x: number; y: number },
): void {
  for (const unit of army) {
    if (!garrison.has(unit.id)) continue
    const order = unit.order
    if (order?.type === 'attack') continue
    if (
      (order?.type === 'attackMove' || order?.type === 'move') &&
      Math.hypot(order.x - keepPoint.x, order.y - keepPoint.y) < 96
    ) {
      continue
    }
    commandMove(state, [unit.id], keepPoint.x, keepPoint.y, true)
  }
}

function recallToCastle(state: MatchState, army: Unit[], keepPoint: { x: number; y: number }): void {
  for (const unit of army) {
    const order = unit.order
    if (order?.type === 'attack' && order.kind === 'unit') {
      const foe = state.units.find((other) => other.id === order.targetId && other.hp > 0)
      if (foe && Math.hypot(foe.x - keepPoint.x, foe.y - keepPoint.y) < 420) continue
    }
    if (order?.type === 'attackMove' && Math.hypot(order.x - keepPoint.x, order.y - keepPoint.y) < 96) continue
    commandMove(state, [unit.id], keepPoint.x, keepPoint.y, true)
  }
}

/** The Castle, or a building beside it, is taking damage or has an enemy in sight nearby. */
function castleUnderAttack(state: MatchState, side: Brain, keepPoint: { x: number; y: number }): boolean {
  for (const building of state.buildings) {
    if (building.owner !== side.owner || building.hp <= 0 || building.alert <= 0) continue
    if (building.kind === 'keep') return true
    const center = buildingCenter(building)
    if (Math.hypot(center.x - keepPoint.x, center.y - keepPoint.y) < 420) return true
  }
  for (const unit of state.units) {
    if (unit.owner === side.owner || unit.hp <= 0 || unit.kind === 'drone') continue
    if (!tileBit(state, side.visible, Math.floor(unit.x / TILE), Math.floor(unit.y / TILE))) continue
    if (Math.hypot(unit.x - keepPoint.x, unit.y - keepPoint.y) < 320) return true
    for (const building of state.buildings) {
      if (building.owner !== side.owner || building.hp <= 0) continue
      const center = buildingCenter(building)
      if (Math.hypot(center.x - keepPoint.x, center.y - keepPoint.y) > 420) continue
      if (Math.hypot(unit.x - center.x, unit.y - center.y) < 180) return true
    }
  }
  return false
}

/**
 * A rock on the way to the player when the real route is gone, or at least ROCK_DETOUR tiles longer
 * than the same route with stones ignored. Buildings and ore still count as blocked.
 */
function rockBlockingMarch(
  state: MatchState,
  army: Unit[],
  destX: number,
  destY: number,
): { rock: Rock; trapped: boolean } | null {
  const goal = nearestWalkable(state, destX, destY)
  if (!goal) return null
  const cleared = withoutRocks(state)

  let detour: Rock | null = null
  for (const unit of army) {
    const start = nearestWalkable(state, unit.x, unit.y)
    if (!start) continue
    const open = findPath(state.blocked, state.mapW, state.mapH, start.tx, start.ty, goal.tx, goal.ty)
    const shortcut = findPath(cleared, state.mapW, state.mapH, start.tx, start.ty, goal.tx, goal.ty)
    if (!shortcut) continue
    if (!open) {
      const rock = rockAlong(state, start, shortcut)
      if (rock) return { rock, trapped: true }
      continue
    }
    if (detour) continue
    if (routeLength(start, open) - routeLength(start, shortcut) < ROCK_DETOUR) continue
    detour = rockAlong(state, start, shortcut)
  }
  return detour ? { rock: detour, trapped: false } : null
}

function withoutRocks(state: MatchState): Uint8Array {
  const cleared = new Uint8Array(state.blocked)
  for (const rock of state.rocks) {
    if (rock.hp <= 0) continue
    cleared[rock.ty * state.mapW + rock.tx] = 0
  }
  return cleared
}

function routeLength(start: { tx: number; ty: number }, path: Array<{ tx: number; ty: number }>): number {
  let length = 0
  let prev = start
  for (const step of path) {
    length += Math.hypot(step.tx - prev.tx, step.ty - prev.ty)
    prev = step
  }
  return length
}

function rockAlong(
  state: MatchState,
  start: { tx: number; ty: number },
  path: Array<{ tx: number; ty: number }>,
): Rock | null {
  let prev = start
  for (const step of path) {
    const rock = firstRockOnSegment(state, prev.tx, prev.ty, step.tx, step.ty)
    if (rock) return rock
    prev = step
  }
  return null
}

function firstRockOnSegment(state: MatchState, x0: number, y0: number, x1: number, y1: number): Rock | null {
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  let x = x0
  let y = y0
  for (let guard = 0; guard <= dx + dy + 1; guard++) {
    const rock = rockAt(state, x, y)
    if (rock) return rock
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }
  return null
}

function nearestToRock(rock: Rock, units: Unit[]): Unit[] {
  const x = (rock.tx + 0.5) * TILE
  const y = (rock.ty + 0.5) * TILE
  return units.slice().sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))
}

/** Workers break rocks that stop the army. Bikes and tanks never shoot stone. */
function assignRockBreakers(state: MatchState, owner: PlayerId, rock: Rock, trapped: boolean): void {
  const workers = nearestToRock(
    rock,
    state.units.filter(
      (unit) =>
        unit.owner === owner &&
        unit.kind === 'porter' &&
        unit.hp > 0 &&
        unit.cargo <= 0 &&
        unit.order?.type !== 'construct',
    ),
  )
  const crew = trapped ? workers : workers.slice(0, 2)
  const fresh = crew.filter((unit) => !(unit.order?.type === 'attack' && unit.order.kind === 'rock'))
  if (!fresh.length) return
  commandAttack(
    state,
    fresh.map((unit) => unit.id),
    rock.id,
    'rock',
  )
}

