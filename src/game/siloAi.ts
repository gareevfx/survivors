import { aiPlaceNearKeep, assignMiners, cancelBuilding, commandAttack, commandConstruct, commandFreezeAuto, commandHarvestOrAttack, commandMove, commandRepair, installCryo, sendHoverGrid, tryPlace, tryTrain } from './commands'
import { areaCharted, findBuildSpot, findBuildSpotWithin, findTowerWatchSpot, nearestWalkable, stopMoving } from './nav'
import { findPath } from './pathfind'
import { buildingCenter, buildingRect, cryoOccupants, cryoParty, distToRect, isWalkable, rockAt, rockById } from './state'
import { AGGRO_RANGE, BUILDING_STATS, CRYO_COST, CRYO_FREEZE_COST, CRYO_SLOTS, INTERACT, SILO_REPAIR_COST, STORAGE_CAP, TILE, UNIT_STATS, type Building, type MatchState, type PlayerId, type Rock, type Unit } from './types'
import { aiSuspended } from './control'
import { depositKnown, sideTileExplored } from './vision'

/**
 * SiloAI plays one side from that side's own sight.
 * Computer opponents in 1 vs 1 and free-for-all use it, and so does `siloai`.
 * Stalkers widen a corridor that pinches below two cells, then go back to the job.
 * A Dumps heap far from this side's Silos and Storages gets its own Storage.
 * A Storage that already holds 500 dumps is not a drop-off, so another is raised beside that heap.
 * When two or fewer Cells are free, the next building is a Storage beside the Silo.
 * Gorillas are the siege share and shoot buildings; Flashers take units.
 * Combat units leave in a wave, not one by one. Until that wave is full they
 * patrol the Silo, Storage, Pillars, and mining Stalkers, spread toward the
 * exposed ones, and attack any enemy that closes on those assets.
 * A remote Storage goes up only when that ground is already covered or no enemy
 * has been seen there. Spare Flashers and Gorillas walk there first. An unfinished
 * Storage does not protect the builder, so a capture or a close enemy pulls the other Stalkers off it.
 * Pillars watch Dumps and Storage so they can capture an uncovered enemy Stalker.
 * A known enemy Pillar is treated as that same capture risk.
 * A building goes down only on ground this side has explored, footprint and the
 * two-cell gap included. Explored ground under the shroud is fine. A Hover charts
 * a black site before a Stalker is sent to build there.
 * A ruined Silo on explored, safe ground is repaired when this side can pay.
 * An enemy in weapon range of the Silo, or of a building beside it, pulls every
 * Flasher and Gorilla off the wave to attack them. They return to the patrol after.
 * A Stalker with nothing to do mines, helps a building, or joins a repair.
 */

/** A Storage this far from a Dumps tile counts as the drop-off for that heap. */
export const SILO_AI_EXPANSION_REACH = 14

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
  /** Build site whose footprint is still black. Cleared every think; not stored. */
  chart: { x: number; y: number } | null
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
      chart: null,
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
      chart: null,
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
    chart: null,
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
  return unit.owner === owner && unit.kind === 'porter' && unit.hp > 0 && unit.frozen == null && !unit.order
}

/** Unexplored ground this close to the scout is searched first, so new minerals are found before a long hunt. */
const SCOUT_LOCAL = 16 * TILE
/** A Drone stays this far from a Bike it can see. A Bike's shot reaches 46. */
export const DRONE_BIKE_AVOID = 80
const DRONE_KEEP = 2
/** Hovers that fill one Grid. Surplus dumps train up to this many. */
const HOVER_GRID = 10
/**
 * Dumps past the next factory (160) and a gorilla (100).
 * At this bank the side buys Hovers toward a Grid instead of another factory.
 */
const HOVER_SURPLUS = 500

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

/** Seconds after a Grid order before this side may hide the flight again. The 45s cloak sits inside it. */
const GRID_REUSE = 90

/** Every living Drone stays on a scout flight. A second Drone takes a different patch. Ten or more may take the Grid instead. */
function dispatchDrones(state: MatchState, side: Brain): void {
  const drones = state.units.filter((unit) => unit.owner === side.owner && unit.kind === 'drone' && unit.hp > 0)
  if (!drones.length) return
  if (issueHoverGrid(state, side, drones)) return
  const bikes = seenEnemyBikes(state, side)
  const reserved: Array<{ x: number; y: number }> = []
  for (const drone of drones) {
    if (drone.cloak > 0) continue
    const order = drone.order
    const traveling = order?.type === 'move' && Math.hypot(drone.x - order.x, drone.y - order.y) > 80
    const threatened =
      nearBike(bikes, drone.x, drone.y) || (order?.type === 'move' && nearBike(bikes, order.x, order.y))
    if (traveling && !threatened) {
      reserved.push({ x: order.x, y: order.y })
      side.scout = drone.id
      drone.scanning = true
      continue
    }
    const goal = droneGoal(state, side, drone.x, drone.y, reserved)
    reserved.push(goal)
    side.scout = drone.id
    commandMove(state, [drone.id], goal.x, goal.y, false)
    drone.scanning = true
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
  if (
    current?.kind === 'porter' &&
    porters.length >= 2 &&
    current.cargo <= 0 &&
    current.order?.type !== 'construct' &&
    current.order?.type !== 'freeze'
  ) {
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

function footprintGap(tx: number, ty: number, w: number, h: number, ox: number, oy: number): number {
  const dx = ox < tx ? tx - ox : ox > tx + w - 1 ? ox - (tx + w - 1) : 0
  const dy = oy < ty ? ty - oy : oy > ty + h - 1 ? oy - (ty + h - 1) : 0
  return Math.max(dx, dy)
}

/** Dumps still sitting in this side's Silo patch. Unknown heaps farther out do not count. */
function homeDumpsRemain(state: MatchState, owner: PlayerId): boolean {
  return state.ore.some((node) => node.amount > 0 && node.base === owner)
}

function storageNearDump(state: MatchState, owner: PlayerId, tx: number, ty: number): boolean {
  const stats = BUILDING_STATS.silo
  for (const building of state.buildings) {
    if (building.owner !== owner || building.hp <= 0 || building.kind !== 'silo') continue
    if (building.stock >= STORAGE_CAP) continue
    if (footprintGap(building.tx, building.ty, stats.w, stats.h, tx, ty) <= SILO_AI_EXPANSION_REACH) return true
  }
  return false
}

function farFromBuildings(
  state: MatchState,
  owner: PlayerId,
  tx: number,
  ty: number,
  kinds: ReadonlyArray<'keep' | 'silo'>,
): boolean {
  for (const building of state.buildings) {
    if (building.owner !== owner || building.hp <= 0) continue
    if (!kinds.includes(building.kind as 'keep' | 'silo')) continue
    if (building.kind === 'silo' && building.stock >= STORAGE_CAP) continue
    const stats = BUILDING_STATS[building.kind]
    if (footprintGap(building.tx, building.ty, stats.w, stats.h, tx, ty) <= SILO_AI_EXPANSION_REACH) return false
  }
  return true
}

/** True when no friendly Silo or Storage is close enough to take this heap's haul. */
function farFromDropoffs(state: MatchState, owner: PlayerId, tx: number, ty: number): boolean {
  return farFromBuildings(state, owner, tx, ty, ['keep', 'silo'])
}

/** An enemy this close to a remote Storage site can reach a builder before the Storage is finished. */
const EXPANSION_THREAT = 8 * TILE

type ExpansionPlan =
  | { kind: 'none' }
  | { kind: 'wait'; x: number; y: number }
  | { kind: 'escort'; x: number; y: number }
  | { kind: 'build'; tx: number; ty: number }

function ownKeep(state: MatchState, owner: PlayerId): Building | undefined {
  return state.buildings.find((building) => building.owner === owner && building.kind === 'keep' && building.hp > 0)
}

/** True when this point sits outside the Silo's own sight, so an unfinished Storage there leaves Stalkers open. */
function remoteFromKeep(state: MatchState, owner: PlayerId, x: number, y: number): boolean {
  const keep = ownKeep(state, owner)
  if (!keep) return false
  const home = buildingCenter(keep)
  return Math.hypot(x - home.x, y - home.y) > BUILDING_STATS.keep.sight
}

function spotCenter(tx: number, ty: number): { x: number; y: number } {
  const stats = BUILDING_STATS.silo
  return { x: (tx + stats.w / 2) * TILE, y: (ty + stats.h / 2) * TILE }
}

/** Silo, finished Storage, Flasher, or Gorilla sight already reaches this ground. An unfinished Storage does not count. */
function siteCovered(state: MatchState, owner: PlayerId, x: number, y: number): boolean {
  for (const building of state.buildings) {
    if (building.owner !== owner || building.hp <= 0) continue
    if (building.kind === 'keep') {
      const center = buildingCenter(building)
      if (Math.hypot(center.x - x, center.y - y) <= BUILDING_STATS.keep.sight) return true
    } else if (building.kind === 'silo' && building.complete) {
      const center = buildingCenter(building)
      if (Math.hypot(center.x - x, center.y - y) <= BUILDING_STATS.silo.sight) return true
    }
  }
  for (const ally of state.units) {
    if (ally.owner !== owner || ally.hp <= 0) continue
    if (ally.kind !== 'pike' && ally.kind !== 'howler') continue
    if (Math.hypot(ally.x - x, ally.y - y) <= UNIT_STATS[ally.kind].sight) return true
  }
  return false
}

/** A finished enemy Pillar this side has seen, close enough that its shot would capture a Stalker here. */
function knownPillarReaches(state: MatchState, side: Brain, x: number, y: number): boolean {
  const reach = BUILDING_STATS.tower.sight
  for (const building of state.buildings) {
    if (building.owner === side.owner || building.hp <= 0 || building.kind !== 'tower' || !building.complete) continue
    const seen =
      seesFootprint(state, side, building.tx, building.ty, 1, 1) || side.spotted.some((spot) => spot.id === building.id)
    if (!seen) continue
    const center = buildingCenter(building)
    if (Math.hypot(center.x - x, center.y - y) <= reach) return true
  }
  return false
}

/** Hostile units and buildings this side can see right now, close to the site. A known Pillar counts out to its own sight. */
function knownEnemyNear(state: MatchState, side: Brain, x: number, y: number): boolean {
  if (knownPillarReaches(state, side, x, y)) return true
  for (const unit of state.units) {
    if (unit.owner === side.owner || unit.hp <= 0 || unit.kind === 'drone' || unit.cloak > 0) continue
    if (!tileBit(state, side.visible, Math.floor(unit.x / TILE), Math.floor(unit.y / TILE))) continue
    if (Math.hypot(unit.x - x, unit.y - y) <= EXPANSION_THREAT) return true
  }
  for (const building of state.buildings) {
    if (building.owner === side.owner || building.hp <= 0 || building.kind === 'tower') continue
    const stats = BUILDING_STATS[building.kind]
    if (!seesFootprint(state, side, building.tx, building.ty, stats.w, stats.h)) continue
    const center = buildingCenter(building)
    if (Math.hypot(center.x - x, center.y - y) <= EXPANSION_THREAT) return true
  }
  return false
}

/** Combat units that are not the Silo guard and are not already out with a wave. Two is a small escort. */
function spareEscorts(state: MatchState, side: Brain, x: number, y: number): Unit[] {
  if (side.attacking) return []
  const keep = ownKeep(state, side.owner)
  if (!keep) return []
  const keepPoint = buildingCenter(keep)
  const army = state.units.filter(
    (unit) => unit.owner === side.owner && unit.hp > 0 && (unit.kind === 'pike' || unit.kind === 'howler'),
  )
  const garrison = garrisonIds(army, keepPoint)
  return army
    .filter((unit) => !garrison.has(unit.id))
    .sort((a, b) => {
      const rank = (unit: Unit) => (unit.kind === 'howler' ? 0 : 1)
      const byKind = rank(a) - rank(b)
      if (byKind !== 0) return byKind
      return Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)
    })
    .slice(0, 2)
}

function escortsStuck(escorts: Unit[], x: number, y: number): boolean {
  if (!escorts.length) return false
  return escorts.every((unit) => {
    const order = unit.order
    const aimed =
      (order?.type === 'attackMove' || order?.type === 'move') && Math.hypot(order.x - x, order.y - y) < 80
    const far = Math.hypot(unit.x - x, unit.y - y) > UNIT_STATS[unit.kind].sight
    const idle = unit.path.length === 0 && (unit.goalX == null || unit.stuckT > 1)
    return aimed && far && idle
  })
}

function builderOf(unit: Unit, buildingId: number): boolean {
  const order = unit.order
  if (!order) return false
  if (order.type === 'construct' && order.buildingId === buildingId) return true
  return order.type === 'attack' && order.resume?.type === 'construct' && order.resume.buildingId === buildingId
}

function livingBuilder(state: MatchState, owner: PlayerId, buildingId: number): Unit | undefined {
  return state.units.find(
    (unit) => unit.owner === owner && unit.kind === 'porter' && unit.hp > 0 && builderOf(unit, buildingId),
  )
}

/**
 * Raise one Storage beside a Dumps heap this side has seen.
 * The Silo patch running dry still sends them to the nearest known heap.
 * A heap found while that patch remains gets a Storage too, when it sits
 * farther than a haul from every Silo and Storage this side already has.
 * The builder goes only when the site is inside Silo, Flasher, or Gorilla sight,
 * or when no enemy has been seen nearby. Spare combat walks there first.
 * The spot uses the same gap and lane rules as a base building, and the
 * footprint plus that gap must already be explored. A black site is charted
 * by a Hover instead of built on.
 */
function expansionPlan(state: MatchState, side: Brain): ExpansionPlan {
  if ((state.oreHeld[side.owner] ?? 0) < BUILDING_STATS.silo.cost) return { kind: 'none' }
  const keep = ownKeep(state, side.owner)
  if (!keep) return { kind: 'none' }
  const homeGone = !homeDumpsRemain(state, side.owner)
  const home = buildingCenter(keep)
  const nodes = state.ore
    .filter((node) => {
      if (node.amount <= 0 || node.base === side.owner) return false
      if (!depositKnown(state, side.owner, node.tx, node.ty)) return false
      if (storageNearDump(state, side.owner, node.tx, node.ty)) return false
      if (!homeGone && !farFromDropoffs(state, side.owner, node.tx, node.ty)) return false
      return true
    })
    .sort((a, b) => {
      const da = Math.hypot((a.tx + 0.5) * TILE - home.x, (a.ty + 0.5) * TILE - home.y)
      const db = Math.hypot((b.tx + 0.5) * TILE - home.x, (b.ty + 0.5) * TILE - home.y)
      return da - db
    })
  let escort: { x: number; y: number } | null = null
  for (const node of nodes) {
    const spot = findBuildSpotWithin(state, 'silo', node.tx, node.ty, SILO_AI_EXPANSION_REACH, side.owner)
    if (!spot) {
      const blind = findBuildSpotWithin(state, 'silo', node.tx, node.ty, SILO_AI_EXPANSION_REACH, side.owner, false)
      rememberBlindSpot(state, side, 'silo', blind)
      continue
    }
    const center = spotCenter(spot.tx, spot.ty)
    const covered = siteCovered(state, side.owner, center.x, center.y)
    const enemies = knownEnemyNear(state, side, center.x, center.y)
    const escorts = spareEscorts(state, side, center.x, center.y)
    if (enemies && !covered) {
      if (escorts.length && !escortsStuck(escorts, center.x, center.y) && !escort) escort = center
      continue
    }
    if (!covered && escorts.length > 0 && !escortsStuck(escorts, center.x, center.y)) {
      return { kind: 'wait', x: center.x, y: center.y }
    }
    return { kind: 'build', tx: spot.tx, ty: spot.ty }
  }
  if (escort) return { kind: 'escort', x: escort.x, y: escort.y }
  return { kind: 'none' }
}

function placeExpansionStorage(state: MatchState, side: Brain): boolean {
  const plan = expansionPlan(state, side)
  if (plan.kind === 'build') return tryPlace(state, side.owner, 'silo', plan.tx, plan.ty, []) === null
  return plan.kind === 'wait'
}

function storageBeside(state: MatchState, owner: PlayerId, tx: number, ty: number): Building | null {
  const stats = BUILDING_STATS.silo
  for (const building of state.buildings) {
    if (building.owner !== owner || building.hp <= 0 || building.kind !== 'silo') continue
    if (footprintGap(building.tx, building.ty, stats.w, stats.h, tx, ty) <= SILO_AI_EXPANSION_REACH) return building
  }
  return null
}

function dumpsBeside(state: MatchState, building: Building): number[] {
  const stats = BUILDING_STATS.silo
  const ids: number[] = []
  for (const node of state.ore) {
    if (node.amount <= 0) continue
    if (footprintGap(building.tx, building.ty, stats.w, stats.h, node.tx, node.ty) <= SILO_AI_EXPANSION_REACH) ids.push(node.id)
  }
  return ids
}

/**
 * A builder who was captured, or an enemy who showed up beside an unfinished remote Storage,
 * is a reason to stop. Other Stalkers head home instead of walking into the same ground.
 * The building comes down when the builder is gone or the site is still uncovered.
 */
function abortThreatenedExpansion(state: MatchState, side: Brain): void {
  const keep = ownKeep(state, side.owner)
  if (!keep) return
  const home = buildingCenter(keep)
  for (const building of [...state.buildings]) {
    if (building.owner !== side.owner || building.kind !== 'silo' || building.hp <= 0 || building.complete) continue
    const center = buildingCenter(building)
    if (Math.hypot(center.x - home.x, center.y - home.y) <= BUILDING_STATS.keep.sight) continue
    const enemies = knownEnemyNear(state, side, center.x, center.y)
    const builder = livingBuilder(state, side.owner, building.id)
    if (!enemies && builder) continue
    const covered = siteCovered(state, side.owner, center.x, center.y)
    const pullBuilder = !builder || !covered
    const nodes = new Set(dumpsBeside(state, building))
    const fleeing: number[] = []
    for (const unit of state.units) {
      if (unit.owner !== side.owner || unit.kind !== 'porter' || unit.hp <= 0) continue
      const onBuild = builderOf(unit, building.id)
      const gathering = unit.order?.type === 'gather' && nodes.has(unit.order.nodeId)
      if (onBuild && !pullBuilder) continue
      if (!onBuild && !gathering) continue
      fleeing.push(unit.id)
    }
    if (pullBuilder) cancelBuilding(state, building.id)
    if (fleeing.length) commandMove(state, fleeing, home.x, home.y, false)
  }
}

/** Keep a small escort on the way to a remote site until that Storage is finished or the ground is given up. */
function sendExpansionEscort(state: MatchState, side: Brain): void {
  let point: { x: number; y: number } | null = null
  for (const building of state.buildings) {
    if (building.owner !== side.owner || building.kind !== 'silo' || building.hp <= 0 || building.complete) continue
    const center = buildingCenter(building)
    if (!remoteFromKeep(state, side.owner, center.x, center.y)) continue
    point = center
    break
  }
  if (!point) {
    const plan = expansionPlan(state, side)
    if (plan.kind === 'wait' || plan.kind === 'escort') point = { x: plan.x, y: plan.y }
  }
  if (!point) return
  const ids: number[] = []
  for (const unit of spareEscorts(state, side, point.x, point.y)) {
    if (unit.order?.type === 'attack') continue
    const order = unit.order
    if (
      (order?.type === 'attackMove' || order?.type === 'move') &&
      Math.hypot(order.x - point.x, order.y - point.y) < 48
    ) {
      continue
    }
    ids.push(unit.id)
  }
  if (ids.length) commandMove(state, ids, point.x, point.y, true)
}

/** One Stalker works each expansion heap that already has a Storage beside it. */
function staffExpansionDumps(state: MatchState, side: Brain): void {
  const homeGone = !homeDumpsRemain(state, side.owner)
  for (const node of state.ore) {
    if (node.amount <= 0 || node.base === side.owner) continue
    if (!depositKnown(state, side.owner, node.tx, node.ty)) continue
    const bin = storageBeside(state, side.owner, node.tx, node.ty)
    if (!bin) continue
    const nodeX = (node.tx + 0.5) * TILE
    const nodeY = (node.ty + 0.5) * TILE
    if (knownPillarReaches(state, side, nodeX, nodeY) && !siteCovered(state, side.owner, nodeX, nodeY)) continue
    if (!bin.complete) {
      const center = buildingCenter(bin)
      const open = remoteFromKeep(state, side.owner, center.x, center.y)
      if (open && (knownEnemyNear(state, side, center.x, center.y) || !livingBuilder(state, side.owner, bin.id))) continue
    }
    if (!homeGone && !farFromBuildings(state, side.owner, node.tx, node.ty, ['keep'])) continue
    sendStalkerToDump(state, side, node.id)
  }
}

function sendStalkerToDump(state: MatchState, side: Brain, nodeId: number): void {
  const mining = state.units.some(
    (unit) =>
      unit.owner === side.owner &&
      unit.kind === 'porter' &&
      unit.hp > 0 &&
      unit.order?.type === 'gather' &&
      unit.order.nodeId === nodeId,
  )
  if (mining) return
  const candidate = state.units.find((unit) => {
    if (unit.owner !== side.owner || unit.kind !== 'porter' || unit.hp <= 0 || unit.cargo > 0) return false
    if (unit.id === side.scout) return false
    const order = unit.order
    if (order?.type === 'construct') return false
    if (order?.type === 'attack' && order.kind === 'rock' && order.resume) return false
    return true
  })
  if (!candidate) return
  candidate.order = { type: 'gather', nodeId, phase: 'approach' }
  candidate.nodeMemory = nodeId
  candidate.idleAcquire = false
  stopMoving(candidate)
}

function seesFootprint(state: MatchState, side: Brain, tx: number, ty: number, w: number, h: number): boolean {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tileBit(state, side.visible, tx + x, ty + y)) return true
    }
  }
  return false
}

/** One spare Stalker hauls dumps out of an enemy Storage this side can see. */
function maybeRaidStorage(state: MatchState, side: Brain): void {
  const waiting = state.units.filter(
    (unit) =>
      unit.owner === side.owner &&
      unit.kind === 'porter' &&
      unit.hp > 0 &&
      unit.cargo <= 0 &&
      unit.order == null &&
      unit.id !== side.scout,
  )
  if (!waiting.length) return
  let bestUnit: Unit | null = null
  let bestBin: Building | null = null
  let bestD = Infinity
  for (const building of state.buildings) {
    if (building.owner === side.owner || building.hp <= 0 || building.kind !== 'silo' || building.stock <= 0) continue
    const stats = BUILDING_STATS.silo
    if (!seesFootprint(state, side, building.tx, building.ty, stats.w, stats.h)) continue
    const center = buildingCenter(building)
    for (const unit of waiting) {
      const distance = Math.hypot(unit.x - center.x, unit.y - center.y)
      if (distance < bestD) {
        bestD = distance
        bestUnit = unit
        bestBin = building
      }
    }
  }
  if (!bestUnit || !bestBin) return
  commandHarvestOrAttack(state, [bestUnit.id], bestBin.id)
}

/**
 * Every computer side, and `siloai`, shares SiloAI.
 * A side with no Silo is already eliminated, so it is skipped.
 * Units and buildings captured with that Silo belong to the captor and are ordered here on the captor's turn.
 * Covered Stalkers are not auto-targets. A hit captures one only outside its own Silo, finished Storage, Flasher, and Gorilla sight.
 */
export function updateSiloAi(state: MatchState, dt: number): void {
  if (state.outcome) return
  // Eight sides think one army per tick, the same stagger as the old 150×150 field.
  // Four-side and duel keep the half-second beat.
  const crowded = state.playerCount > 4
  const think = crowded ? 0.75 : 0.5
  let budget = crowded ? 1 : 8

  state.aiAcc += dt
  if (state.aiAcc >= think) {
    if (aiSuspended(state, 1)) state.aiAcc = think
    else if (state.eliminated[1] || !keepStands(state, 1)) state.aiAcc = 0
    else if (budget > 0) {
      state.aiAcc = 0
      budget -= 1
      runSide(state, 1)
    } else state.aiAcc = think
  }
  for (let owner = 2; owner < state.playerCount; owner++) {
    state.sideAcc[owner] = (state.sideAcc[owner] ?? 0) + dt
    if ((state.sideAcc[owner] ?? 0) < think) continue
    if (aiSuspended(state, owner)) {
      state.sideAcc[owner] = think
      continue
    }
    if (state.eliminated[owner] || !keepStands(state, owner)) {
      state.sideAcc[owner] = 0
      continue
    }
    if (budget <= 0) {
      state.sideAcc[owner] = think
      continue
    }
    state.sideAcc[owner] = 0
    budget -= 1
    runSide(state, owner)
  }
  if (!state.aiControl || state.eliminated[0] || !keepStands(state, 0) || aiSuspended(state, 0)) return
  state.playerAiAcc += dt
  if (state.playerAiAcc < think) return
  if (budget <= 0 && crowded) {
    state.playerAiAcc = think
    return
  }
  state.playerAiAcc = 0
  runSide(state, 0)
}

function hoverRoster(state: MatchState, owner: PlayerId): number {
  let count = 0
  for (const unit of state.units) {
    if (unit.owner === owner && unit.kind === 'drone' && unit.hp > 0) count += 1
  }
  for (const building of state.buildings) {
    if (building.owner !== owner || building.hp <= 0) continue
    for (const job of building.queue) if (job.kind === 'drone') count += 1
  }
  return count
}

/** Two factories and three pillars are up, and Cells are not about to run out. */
function baseReadyForHovers(state: MatchState, side: Brain): boolean {
  const room = state.supplyCap[side.owner] - state.supplyUsed[side.owner]
  if (room <= 2) return false
  let yards = 0
  let towers = 0
  for (const building of state.buildings) {
    if (building.owner !== side.owner || building.hp <= 0) continue
    if (building.kind === 'yard') yards += 1
    if (building.kind === 'tower') towers += 1
  }
  return yards >= 2 && towers >= 3
}

function dronesToTrain(state: MatchState, side: Brain): number {
  const have = hoverRoster(state, side.owner)
  if (have < DRONE_KEEP) {
    if (have === 0) return 1
    let combat = 0
    for (const unit of state.units) {
      if (unit.owner !== side.owner || unit.hp <= 0) continue
      if (unit.kind === 'pike' || unit.kind === 'howler') combat += 1
    }
    return combat >= 2 ? 1 : 0
  }
  if (have >= HOVER_GRID || !baseReadyForHovers(state, side)) return 0
  if ((state.oreHeld[side.owner] ?? 0) < HOVER_SURPLUS) return 0
  return HOVER_GRID - have
}

/**
 * Ten Hovers cover the map and turn invisible. Used to scout while much of the
 * map is still dark, or when the flight or the Silo is under attack. Not again
 * until the cooldown has run, so they are not hidden forever.
 */
function issueHoverGrid(state: MatchState, side: Brain, drones: Unit[]): boolean {
  if (drones.length < HOVER_GRID) return false
  const last = state.gridAt[side.owner] ?? -1
  if (last >= 0 && state.time - last < GRID_REUSE) return false
  if (!flightUnderAttack(state, side, drones) && !wantsGridScout(side)) return false
  sendHoverGrid(state, drones)
  const sent = drones.every((unit) => unit.cloak > 0)
  if (!sent) return false
  state.gridAt[side.owner] = state.time
  return true
}

function flightUnderAttack(state: MatchState, side: Brain, drones: Unit[]): boolean {
  const bikes = seenEnemyBikes(state, side)
  if (drones.some((drone) => nearBike(bikes, drone.x, drone.y))) return true
  const keep = ownKeep(state, side.owner)
  if (!keep) return false
  const home = buildingCenter(keep)
  const reach = BUILDING_STATS.keep.sight
  for (const unit of state.units) {
    if (unit.owner === side.owner || unit.hp <= 0 || unit.kind === 'drone' || unit.cloak > 0) continue
    if (!tileBit(state, side.visible, Math.floor(unit.x / TILE), Math.floor(unit.y / TILE))) continue
    if (Math.hypot(unit.x - home.x, unit.y - home.y) <= reach) return true
  }
  return false
}

/** Enough of this side's map is still black that a Grid is worth a scout pass. */
function wantsGridScout(side: Brain): boolean {
  let dark = 0
  let samples = 0
  const grid = side.explored
  for (let index = 0; index < grid.length; index += 8) {
    samples += 1
    if (grid[index] === 0) dark += 1
  }
  return samples > 0 && dark / samples >= 0.2
}

/**
 * Press Cryo for a group of four whenever the vessels are empty, recovery is done,
 * four Stalkers are on the map, and the bank can pay 200. A filled Cryo stays filled.
 */
function tendCryo(state: MatchState, side: Brain): void {
  const cryo = state.buildings.find(
    (building) => building.owner === side.owner && building.kind === 'keep' && building.cryo && building.complete && building.hp > 0,
  )
  if (!cryo || cryo.cryoRecover > 0) return
  if (cryoOccupants(state, cryo.id) > 0 || cryoParty(state, cryo.id).length > 0) return
  let active = 0
  for (const unit of state.units) {
    if (unit.owner === side.owner && unit.kind === 'porter' && unit.hp > 0 && unit.frozen == null) active += 1
  }
  if (active < CRYO_SLOTS) return
  if ((state.oreHeld[side.owner] ?? 0) < CRYO_FREEZE_COST * CRYO_SLOTS) return
  commandFreezeAuto(state, cryo.id)
}

/** The Silo Cryo upgrade. Bought as soon as the Silo is finished and the bank can pay 250. */
function cryoWanted(state: MatchState, side: Brain): boolean {
  if ((state.oreHeld[side.owner] ?? 0) < CRYO_COST) return false
  const keep = ownKeep(state, side.owner)
  return !!keep?.complete && !keep.cryo
}

/** Surplus dumps fill a Hover Grid before another Factory goes up. */
function bankingHovers(state: MatchState, side: Brain, ore: number): boolean {
  return ore >= HOVER_SURPLUS && hoverRoster(state, side.owner) < HOVER_GRID
}

function runSide(state: MatchState, owner: PlayerId): void {
  const side = brain(state, owner)
  dispatchDrones(state, side)
  tendCryo(state, side)
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
    finish(state, side)
    return
  }

  if (cryoWanted(state, side)) installCryo(state, keep.id)

  const queuedPorters = keep.queue.filter((job) => job.kind === 'porter').length
  if (porters.length + queuedPorters < 6 && keep.queue.length < 2) {
    tryTrain(state, keep.id, 'porter')
  }

  const constructing = state.buildings.some(
    (building) => building.owner === side.owner && !building.complete && building.hp > 0,
  )
  if (!constructing) {
    // Free Cells against the live cap. A Silo is 12 and each finished Storage adds 8, up to 65.
    const supplyRoom = state.supplyCap[side.owner] - state.supplyUsed[side.owner]
    const ore = state.oreHeld[side.owner]
    const yards = state.buildings.filter(
      (building) => building.owner === side.owner && building.kind === 'yard' && building.hp > 0,
    ).length
    const towers = state.buildings.filter(
      (building) => building.owner === side.owner && building.kind === 'tower' && building.hp > 0,
    ).length
    if (supplyRoom <= 2 && ore >= BUILDING_STATS.silo.cost) {
      placeChartedNearKeep(state, side, 'silo')
    } else if (placeExpansionStorage(state, side)) {
      // A Storage now stands beside a Dumps heap this side has seen.
    } else if (yards < 2 && ore >= BUILDING_STATS.yard.cost) {
      placeChartedNearKeep(state, side, 'yard')
    } else if (towers < 3 && ore >= BUILDING_STATS.tower.cost) {
      if (!placeWatchPillar(state, side) && ore >= BUILDING_STATS.yard.cost) {
        placeChartedNearKeep(state, side, 'yard')
      }
    } else if (ore >= BUILDING_STATS.yard.cost && !bankingHovers(state, side, ore)) {
      placeChartedNearKeep(state, side, 'yard')
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
    const first = siegeMix(state, side)
    const second = first === 'howler' ? 'pike' : 'howler'
    if (tryTrain(state, readyYard.id, first) === null) side.next = second
    else tryTrain(state, readyYard.id, second)
  }

  maybeRaidStorage(state, side)

  const army = state.units.filter(
    (unit) => unit.owner === side.owner && unit.kind !== 'porter' && unit.kind !== 'drone' && unit.hp > 0,
  )
  const keepPoint = buildingCenter(keep)
  const threats = siloAttackers(state, side, keepPoint)
  const castle = spottedKeep(state, side.owner)
  const spotted = knownEnemyBuilding(state, side)
  const rally = rallyPoint(state, side, keepPoint)
  const posts = guardPosts(state, side, keepPoint)
  const need = siloWaveNeed(state)
  const garrison = garrisonIds(army, keepPoint)
  if (threats.length) {
    side.attacking = false
    defendHome(state, army, threats)
    finish(state, side)
    return
  }
  if (army.length === 0) side.attacking = false

  const pool = army.filter((unit) => !garrison.has(unit.id))
  const dest = castle ?? spotted
  const wasAttacking = side.attacking
  const field = dest && wasAttacking ? pool.filter((unit) => withWave(unit, dest, keepPoint, rally, state, posts)) : []
  const wiped = wasAttacking && field.length <= 1
  if (wiped) side.attacking = false
  const gathering = pool.filter((unit) => !field.includes(unit) || wiped)
  const gorillasReady = gathering.filter((unit) => unit.kind === 'howler').length >= need.gorillas
  const rallyReady = !!dest && !side.attacking && gathering.length >= need.count && gorillasReady
  if (rallyReady) side.attacking = true

  if (!side.attacking || !dest) {
    guardDuty(state, side, army, keepPoint)
    finish(state, side)
    return
  }

  const strike = rallyReady ? gathering : field
  const waiting = pool.filter((unit) => !strike.includes(unit))
  const home = army.filter((unit) => garrison.has(unit.id))
  guardDuty(state, side, home.concat(waiting), keepPoint)
  const blocker = rockBlockingMarch(state, strike, dest.x, dest.y)
  if (blocker) assignRockBreakers(state, side.owner, blocker.rock, blocker.trapped)
  marchWave(state, strike, dest, castle)
  finish(state, side)
}

function finish(state: MatchState, side: Brain): void {
  repairRuins(state, side)
  abortThreatenedExpansion(state, side)
  retreatFromEnemyPillars(state, side)
  sendExpansionEscort(state, side)
  staffExpansionDumps(state, side)
  widenNarrowPassages(state, side)
  employIdleStalkers(state, side)
  scoutUnchartedSite(state, side)
  store(state, side)
}

/**
 * A Stalker with no order helps a building, joins a repair, or mines.
 * The three-miner deposit cap still prefers open slots. Overflow mines too, so nobody stands idle.
 */
function employIdleStalkers(state: MatchState, side: Brain): void {
  let idle = state.units.filter(
    (unit) =>
      unit.owner === side.owner &&
      unit.kind === 'porter' &&
      unit.hp > 0 &&
      unit.cargo <= 0 &&
      !unit.order &&
      unit.id !== side.scout,
  )
  if (!idle.length) return
  const site = state.buildings.find(
    (building) => building.owner === side.owner && building.hp > 0 && !building.complete && !building.ruined,
  )
  if (site) {
    commandConstruct(state, idle.map((unit) => unit.id), site.id)
    return
  }
  const repairing = state.buildings.find(
    (building) =>
      building.ruined &&
      state.units.some(
        (unit) =>
          unit.owner === side.owner &&
          unit.hp > 0 &&
          unit.order?.type === 'repair' &&
          unit.order.buildingId === building.id,
      ),
  )
  if (repairing) {
    const crew = state.units.filter(
      (unit) => unit.hp > 0 && unit.order?.type === 'repair' && unit.order.buildingId === repairing.id,
    ).length
    const extra = idle.slice(0, Math.max(0, 2 - crew))
    if (extra.length) commandRepair(state, extra.map((unit) => unit.id), repairing.id)
    const sent = new Set(extra.map((unit) => unit.id))
    idle = idle.filter((unit) => !sent.has(unit.id))
  }
  if (!idle.length) return
  assignMiners(state, idle, null)
  idle = idle.filter((unit) => !unit.order)
  const sample = idle[0]
  if (!sample) return
  const node = nearestKnownDump(state, side, sample)
  if (!node) return
  for (const unit of idle) {
    unit.nodeMemory = node.id
    unit.idleAcquire = false
    unit.order = { type: 'gather', nodeId: node.id, phase: 'approach' }
    stopMoving(unit)
  }
}

function nearestKnownDump(
  state: MatchState,
  side: Brain,
  unit: Unit,
): { id: number; tx: number; ty: number } | null {
  let best: { id: number; tx: number; ty: number } | null = null
  let bestD = Infinity
  for (const node of state.ore) {
    if (node.amount <= 0) continue
    if (!depositKnown(state, side.owner, node.tx, node.ty)) continue
    const distance = Math.hypot((node.tx + 0.5) * TILE - unit.x, (node.ty + 0.5) * TILE - unit.y)
    if (distance < bestD) {
      bestD = distance
      best = node
    }
  }
  return best
}

/**
 * Repair the closest ruined Silo this side has explored, when the ground is safe
 * and the repair is affordable. One Stalker goes. A site already being repaired is left alone.
 */
function repairRuins(state: MatchState, side: Brain): void {
  const keep = ownKeep(state, side.owner)
  if (!keep) return
  const home = buildingCenter(keep)
  const ruins = state.buildings
    .filter((building) => building.ruined && building.kind === 'keep')
    .sort((a, b) => {
      const da = Math.hypot(buildingCenter(a).x - home.x, buildingCenter(a).y - home.y)
      const db = Math.hypot(buildingCenter(b).x - home.x, buildingCenter(b).y - home.y)
      return da - db
    })
  for (const ruin of ruins) {
    if (!ruinCharted(state, side.owner, ruin)) continue
    const center = buildingCenter(ruin)
    const safe = siteCovered(state, side.owner, center.x, center.y) || !knownEnemyNear(state, side, center.x, center.y)
    if (!safe) continue
    if (state.units.some((unit) => unit.owner === side.owner && unit.hp > 0 && unit.order?.type === 'repair' && unit.order.buildingId === ruin.id)) {
      return
    }
    if (!ruin.repairPaid && (state.oreHeld[side.owner] ?? 0) < SILO_REPAIR_COST) continue
    const porter = repairPorter(state, side, center.x, center.y)
    if (!porter) return
    commandRepair(state, [porter.id], ruin.id)
    return
  }
}

function ruinCharted(state: MatchState, owner: PlayerId, building: Building): boolean {
  const stats = BUILDING_STATS.keep
  for (let y = 0; y < stats.h; y++) {
    for (let x = 0; x < stats.w; x++) {
      if (!sideTileExplored(state, owner, building.tx + x, building.ty + y)) return false
    }
  }
  return true
}

function repairPorter(state: MatchState, side: Brain, x: number, y: number): Unit | undefined {
  let best: Unit | undefined
  let bestRank = Infinity
  for (const unit of state.units) {
    if (unit.owner !== side.owner || unit.kind !== 'porter' || unit.hp <= 0 || unit.cargo > 0) continue
    if (unit.id === side.scout) continue
    const order = unit.order
    if (order?.type === 'construct' || order?.type === 'repair') continue
    if (order?.type === 'attack' && order.resume) continue
    const idle = order == null ? 0 : 1
    const distance = Math.hypot(unit.x - x, unit.y - y)
    const rank = idle * 100000 + distance
    if (rank < bestRank) {
      bestRank = rank
      best = unit
    }
  }
  return best
}

/** A Hover charts a legal site that is still black. One think scouts; a later think can build. */
function scoutUnchartedSite(state: MatchState, side: Brain): void {
  const chart = side.chart
  if (!chart) return
  const drone = state.units.find(
    (unit) => unit.owner === side.owner && unit.kind === 'drone' && unit.hp > 0 && unit.cloak <= 0,
  )
  if (!drone) return
  const order = drone.order
  if (order?.type === 'move' && Math.hypot(order.x - chart.x, order.y - chart.y) < 48) return
  commandMove(state, [drone.id], chart.x, chart.y, false)
}

function placeChartedNearKeep(state: MatchState, side: Brain, kind: 'yard' | 'silo' | 'tower'): boolean {
  if (aiPlaceNearKeep(state, kind, side.owner)) return true
  const keep = ownKeep(state, side.owner)
  if (!keep) return false
  rememberBlindSpot(state, side, kind, findBuildSpot(state, kind, keep.tx, keep.ty, side.owner, false))
  return false
}

/** Remember the first terrain-legal site whose footprint is still unexplored. */
function rememberBlindSpot(
  state: MatchState,
  side: Brain,
  kind: 'yard' | 'silo' | 'tower',
  spot: { tx: number; ty: number } | null,
): void {
  if (side.chart || !spot) return
  if (areaCharted(state, side.owner, kind, spot.tx, spot.ty)) return
  const stats = BUILDING_STATS[kind]
  side.chart = { x: (spot.tx + stats.w / 2) * TILE, y: (spot.ty + stats.h / 2) * TILE }
}

/**
 * Put the next Pillar where it can see a Dumps heap or a Storage, still inside Silo sight.
 * That is the ground where an enemy Stalker would be captured. Extra Pillars fall back beside the Silo.
 */
function placeWatchPillar(state: MatchState, side: Brain): boolean {
  const keep = ownKeep(state, side.owner)
  if (!keep) return false
  if ((state.oreHeld[side.owner] ?? 0) < BUILDING_STATS.tower.cost) return false
  const towers = state.buildings.filter(
    (building) => building.owner === side.owner && building.kind === 'tower' && building.hp > 0,
  )
  const home = buildingCenter(keep)
  const watches: Array<{ x: number; y: number }> = []
  for (const node of state.ore) {
    if (node.amount <= 0 || node.base !== side.owner) continue
    watches.push({ x: (node.tx + 0.5) * TILE, y: (node.ty + 0.5) * TILE })
  }
  for (const building of state.buildings) {
    if (building.owner !== side.owner || building.hp <= 0 || building.kind !== 'silo') continue
    watches.push(buildingCenter(building))
  }
  const sight = BUILDING_STATS.tower.sight
  const open = watches.filter(
    (point) => !towers.some((tower) => Math.hypot(buildingCenter(tower).x - point.x, buildingCenter(tower).y - point.y) <= sight),
  )
  open.sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))
  for (const point of open) {
    const spot = findTowerWatchSpot(state, keep.tx, keep.ty, point.x, point.y, side.owner)
    if (!spot) {
      rememberBlindSpot(
        state,
        side,
        'tower',
        findTowerWatchSpot(state, keep.tx, keep.ty, point.x, point.y, side.owner, false),
      )
      continue
    }
    const centerX = (spot.tx + BUILDING_STATS.tower.w / 2) * TILE
    const centerY = (spot.ty + BUILDING_STATS.tower.h / 2) * TILE
    if (Math.hypot(centerX - point.x, centerY - point.y) > sight) continue
    if (tryPlace(state, side.owner, 'tower', spot.tx, spot.ty, []) === null) return true
  }
  return placeChartedNearKeep(state, side, 'tower')
}

/** Stalkers outside their own cover walk home when a known enemy Pillar can reach them or their job. */
function retreatFromEnemyPillars(state: MatchState, side: Brain): void {
  const keep = ownKeep(state, side.owner)
  if (!keep) return
  const home = buildingCenter(keep)
  const fleeing: number[] = []
  for (const unit of state.units) {
    if (unit.owner !== side.owner || unit.kind !== 'porter' || unit.hp <= 0) continue
    if (siteCovered(state, side.owner, unit.x, unit.y)) continue
    let threatened = knownPillarReaches(state, side, unit.x, unit.y)
    const order = unit.order
    if (!threatened && order?.type === 'gather') {
      const node = state.ore.find((entry) => entry.id === order.nodeId)
      if (node) threatened = knownPillarReaches(state, side, (node.tx + 0.5) * TILE, (node.ty + 0.5) * TILE)
    }
    if (!threatened && order?.type === 'construct') {
      const building = state.buildings.find((entry) => entry.id === order.buildingId)
      if (building) {
        const center = buildingCenter(building)
        threatened = knownPillarReaches(state, side, center.x, center.y)
      }
    }
    if (!threatened) continue
    if (order?.type === 'move' && Math.hypot(order.x - home.x, order.y - home.y) < 80) continue
    fleeing.push(unit.id)
  }
  if (fleeing.length) commandMove(state, fleeing, home.x, home.y, false)
}

/** Two Gorillas for each Flasher, so a siege has guns for buildings. */
function siegeMix(state: MatchState, side: Brain): 'pike' | 'howler' {
  let howlers = 0
  let pikes = 0
  for (const unit of state.units) {
    if (unit.owner !== side.owner || unit.hp <= 0) continue
    if (unit.kind === 'howler') howlers += 1
    if (unit.kind === 'pike') pikes += 1
  }
  for (const building of state.buildings) {
    if (building.owner !== side.owner || building.hp <= 0) continue
    for (const job of building.queue) {
      if (job.kind === 'howler') howlers += 1
      if (job.kind === 'pike') pikes += 1
    }
  }
  return howlers < (pikes + 1) * 2 ? 'howler' : 'pike'
}

/**
 * A moving Stalker that has entered a one-cell corridor, or is stuck on rock,
 * tree, or dumps, clears the adjacent rock or tree until the gap is two cells.
 * The job it left is stored on the swing and restored when the pinch is gone.
 */
function widenNarrowPassages(state: MatchState, side: Brain): void {
  for (const unit of state.units) {
    if (unit.owner !== side.owner || unit.kind !== 'porter' || unit.hp <= 0) continue
    const order = unit.order
    const widening = order?.type === 'attack' && order.kind === 'rock' && order.resume != null
    const pinched = passageRock(state, unit)
    if (widening && order?.type === 'attack') {
      const rock = rockById(state, order.targetId)
      if (rock && rock.hp > 0 && pinched) continue
      if (!pinched) {
        unit.order = order.resume ?? null
        unit.idleAcquire = false
        stopMoving(unit)
        continue
      }
    }
    if (!pinched) continue
    if (!widening && !porterTraveling(state, unit)) continue
    if (order?.type === 'attack' && order.kind === 'rock' && order.targetId === pinched.id) continue
    const resume = order?.type === 'attack' ? order.resume : (order ?? undefined)
    unit.order = { type: 'attack', targetId: pinched.id, kind: 'rock', resume }
    unit.idleAcquire = false
    stopMoving(unit)
  }
}

function porterTraveling(state: MatchState, unit: Unit): boolean {
  const order = unit.order
  if (!order) return false
  if (order.type === 'move' || order.type === 'attackMove') return true
  if (order.type === 'gather' && order.phase !== 'mine') return true
  if (order.type === 'construct') {
    const building = state.buildings.find((entry) => entry.id === order.buildingId)
    if (!building || building.hp <= 0) return false
    return distToRect(unit.x, unit.y, buildingRect(building)) > INTERACT
  }
  return order.type === 'attack' && order.kind !== 'rock'
}

function passageRock(state: MatchState, unit: Unit): Rock | null {
  const moving = unit.path.length > 0 || unit.goalX != null || unit.stuckT >= 0.35 || unit.stuckOrderT >= 0.8
  if (!moving) return null
  const seen = new Set<number>()
  for (const cell of passageTiles(unit)) {
    const key = cell.ty * state.mapW + cell.tx
    if (seen.has(key)) continue
    seen.add(key)
    const rock = pinchRockAt(state, cell.tx, cell.ty)
    if (rock) return rock
  }
  return rockSlowingPorter(state, unit)
}

function passageTiles(unit: Unit): Array<{ tx: number; ty: number }> {
  const tiles: Array<{ tx: number; ty: number }> = []
  const tx = Math.floor(unit.x / TILE)
  const ty = Math.floor(unit.y / TILE)
  tiles.push({ tx, ty })
  const steps = unit.path.length > 0 ? unit.path.slice(0, 8) : []
  for (const step of steps) {
    tiles.push({ tx: Math.floor(step.x / TILE), ty: Math.floor(step.y / TILE) })
  }
  return tiles
}

/** A walkable cell with both sides closed. The rock or tree in that wall is the one to clear. */
function pinchRockAt(state: MatchState, tx: number, ty: number): Rock | null {
  if (!isWalkable(state, tx, ty)) return null
  const blocked = (x: number, y: number) => !isWalkable(state, x, y)
  const left = blocked(tx - 1, ty)
  const right = blocked(tx + 1, ty)
  const up = blocked(tx, ty - 1)
  const down = blocked(tx, ty + 1)
  const options: Array<[number, number]> = []
  if (left && right && (!up || !down)) options.push([tx - 1, ty], [tx + 1, ty])
  if (up && down && (!left || !right)) options.push([tx, ty - 1], [tx, ty + 1])
  for (const [x, y] of options) {
    const rock = rockAt(state, x, y)
    if (rock && rock.hp > 0) return rock
  }
  return null
}

/** Stuck against a rock or tree, including when dumps close the other side of the step. */
function rockSlowingPorter(state: MatchState, unit: Unit): Rock | null {
  if (unit.stuckT < 0.35 && unit.stuckOrderT < 0.8) return null
  const goal = travelGoal(unit)
  if (!goal) return null
  const tx = Math.floor(unit.x / TILE)
  const ty = Math.floor(unit.y / TILE)
  const dx = Math.sign(goal.x - unit.x)
  const dy = Math.sign(goal.y - unit.y)
  const steps: Array<[number, number]> = []
  if (dx !== 0) steps.push([tx + dx, ty])
  if (dy !== 0) steps.push([tx, ty + dy])
  if (dx !== 0 && dy !== 0) steps.push([tx + dx, ty + dy])
  for (const [x, y] of steps) {
    const rock = rockAt(state, x, y)
    if (rock && rock.hp > 0) return rock
  }
  for (const [sx, sy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const rock = rockAt(state, tx + sx, ty + sy)
    if (!rock || rock.hp <= 0) continue
    if (!isWalkable(state, tx - sx, ty - sy)) return rock
  }
  return null
}

function travelGoal(unit: Unit): { x: number; y: number } | null {
  if (unit.goalX != null && unit.goalY != null) return { x: unit.goalX, y: unit.goalY }
  const order = unit.order
  if (!order) return null
  if (order.type === 'move' || order.type === 'attackMove') return { x: order.x, y: order.y }
  if (order.type === 'attack' && order.resume) return travelGoal({ ...unit, order: order.resume })
  return null
}

/**
 * Fighters required before a wave leaves the rally.
 * The bar rises with the match clock, and free-for-all asks for a larger group.
 * Every wave includes at least a couple of Gorillas.
 */
export function siloWaveNeed(state: MatchState): { count: number; gorillas: number } {
  let count = 6
  let gorillas = 2
  if (state.time >= 150) count = 8
  if (state.time >= 260) {
    count = 10
    gorillas = 3
  }
  if (state.playerCount > 2) {
    count += 2
    gorillas += 1
  }
  return { count, gorillas }
}

/** Where this side's Flashers and Gorillas form up, a short walk in front of the Silo. */
export function siloRallyPoint(state: MatchState, owner: PlayerId): { x: number; y: number } | null {
  const keep = state.buildings.find((building) => building.owner === owner && building.kind === 'keep' && building.hp > 0)
  if (!keep) return null
  return rallyPoint(state, brain(state, owner), buildingCenter(keep))
}

function rallyPoint(state: MatchState, side: Brain, keepPoint: { x: number; y: number }): { x: number; y: number } {
  const castle = spottedKeep(state, side.owner)
  const aim = castle ?? { x: (state.mapW * TILE) / 2, y: (state.mapH * TILE) / 2 }
  const dx = aim.x - keepPoint.x
  const dy = aim.y - keepPoint.y
  const len = Math.hypot(dx, dy) || 1
  for (const tiles of [6, 7, 5, 8]) {
    const x = keepPoint.x + (dx / len) * tiles * TILE
    const y = keepPoint.y + (dy / len) * tiles * TILE
    const walk = nearestWalkable(state, x, y)
    if (!walk) continue
    const point = { x: (walk.tx + 0.5) * TILE, y: (walk.ty + 0.5) * TILE }
    if (Math.hypot(point.x - keepPoint.x, point.y - keepPoint.y) < 4 * TILE) continue
    return point
  }
  return { x: keepPoint.x, y: keepPoint.y }
}

/** Already sent with the assault, or fighting beside that objective. A patrol order does not count. */
const WAVE_FORM = 130

function withWave(
  unit: Unit,
  dest: { x: number; y: number },
  keepPoint: { x: number; y: number },
  rally: { x: number; y: number },
  state: MatchState,
  posts: GuardPost[],
): boolean {
  const order = unit.order
  if (order?.type === 'attackMove' || order?.type === 'move') {
    if (Math.hypot(order.x - dest.x, order.y - dest.y) < 96) return true
    if (postOf(state, posts, order.x, order.y) >= 0) return false
  } else if (order?.type === 'attack') {
    return Math.hypot(unit.x - dest.x, unit.y - dest.y) < 420
  } else if (order) {
    return false
  }
  return (
    Math.hypot(unit.x - keepPoint.x, unit.y - keepPoint.y) > 320 &&
    Math.hypot(unit.x - rally.x, unit.y - rally.y) > WAVE_FORM
  )
}

/** How close an enemy must be to a guarded asset before the patrol attacks it. */
const GUARD_ALERT = 160
/** A fighter this close to its post, with nowhere left to walk, is sent to the next asset. */
const GUARD_ARRIVE = 42

interface GuardPost {
  x: number
  y: number
  exposure: number
  key: string
  angle: number
  standOff: number
}

/**
 * Assets the waiting army spreads across. Remote Storage and Stalkers on far
 * Dumps sort first. The Silo is a short circuit so the home guard keeps moving.
 */
function guardPosts(state: MatchState, side: Brain, keepPoint: { x: number; y: number }): GuardPost[] {
  const posts: GuardPost[] = []
  for (let i = 0; i < 3; i++) {
    posts.push({
      x: keepPoint.x,
      y: keepPoint.y,
      exposure: 0,
      key: `keep-${i}`,
      angle: (i * 2 * Math.PI) / 3,
      standOff: 150,
    })
  }
  for (const building of state.buildings) {
    if (building.owner !== side.owner || building.hp <= 0 || building.ruined) continue
    if (building.kind !== 'silo' && building.kind !== 'tower') continue
    const center = buildingCenter(building)
    const dx = center.x - keepPoint.x
    const dy = center.y - keepPoint.y
    posts.push({
      x: center.x,
      y: center.y,
      exposure: Math.hypot(dx, dy),
      key: `b${building.id}`,
      angle: Math.atan2(dy, dx),
      standOff: 48,
    })
  }
  for (const unit of state.units) {
    if (unit.owner !== side.owner || unit.kind !== 'porter' || unit.hp <= 0) continue
    const mining = unit.cargo > 0 || unit.order?.type === 'gather'
    if (!mining) continue
    const dx = unit.x - keepPoint.x
    const dy = unit.y - keepPoint.y
    posts.push({
      x: unit.x,
      y: unit.y,
      exposure: Math.hypot(dx, dy),
      key: `u${unit.id}`,
      angle: Math.atan2(dy, dx),
      standOff: 36,
    })
  }
  return posts
}

function standPoint(state: MatchState, post: GuardPost): { x: number; y: number } {
  const x = post.x + Math.cos(post.angle) * post.standOff
  const y = post.y + Math.sin(post.angle) * post.standOff
  const walk = nearestWalkable(state, x, y)
  if (!walk) return { x, y }
  return { x: (walk.tx + 0.5) * TILE, y: (walk.ty + 0.5) * TILE }
}

function postOf(state: MatchState, posts: GuardPost[], x: number, y: number): number {
  let best = -1
  let bestD = 72
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i]
    if (!post) continue
    const stand = standPoint(state, post)
    const distance = Math.hypot(stand.x - x, stand.y - y)
    if (distance < bestD) {
      bestD = distance
      best = i
    }
  }
  return best
}

function arrivedAt(unit: Unit, point: { x: number; y: number }): boolean {
  return unit.path.length === 0 && Math.hypot(unit.x - point.x, unit.y - point.y) <= GUARD_ARRIVE
}

/** A combat unit or enemy structure already inside this fighter's engagement range. */
function engagementOccupied(state: MatchState, fighter: Unit): boolean {
  for (const other of state.units) {
    if (other.owner === fighter.owner || other.hp <= 0 || other.cloak > 0 || other.frozen != null) continue
    if (other.kind === 'porter') continue
    if (other.kind === 'drone' && fighter.kind === 'howler') continue
    if (Math.hypot(other.x - fighter.x, other.y - fighter.y) <= AGGRO_RANGE) return true
  }
  for (const building of state.buildings) {
    if (building.owner === fighter.owner || building.hp <= 0) continue
    const center = buildingCenter(building)
    if (Math.hypot(center.x - fighter.x, center.y - fighter.y) <= AGGRO_RANGE) return true
  }
  return false
}

/**
 * Waiting Flashers and Gorillas patrol assets instead of standing at the rally.
 * The most exposed posts are filled first. An enemy beside one of them is attacked
 * at once. Combat units come before Stalkers, and a Stalker is left alone while a
 * structure or combat unit is inside engagement range. A fighter who has reached a
 * post is sent to the next, so nobody stands.
 */
function guardDuty(state: MatchState, side: Brain, units: Unit[], keepPoint: { x: number; y: number }): void {
  if (!units.length) return
  const posts = guardPosts(state, side, keepPoint).sort((a, b) => b.exposure - a.exposure || (a.key < b.key ? -1 : 1))
  if (!posts.length) return
  const busy = new Set<number>()
  const enemies: Unit[] = []
  for (const enemy of state.units) {
    if (enemy.owner === side.owner || enemy.hp <= 0 || enemy.kind === 'drone' || enemy.cloak > 0) continue
    if (!tileBit(state, side.visible, Math.floor(enemy.x / TILE), Math.floor(enemy.y / TILE))) continue
    let near = false
    for (const post of posts) {
      if (Math.hypot(enemy.x - post.x, enemy.y - post.y) <= GUARD_ALERT) near = true
    }
    if (near) enemies.push(enemy)
  }
  enemies.sort((a, b) => Number(a.kind === 'porter') - Number(b.kind === 'porter') || a.id - b.id)
  for (const enemy of enemies) {
    let chosen: Unit | undefined
    let chosenD = Infinity
    for (const unit of units) {
      if (busy.has(unit.id)) continue
      const order = unit.order
      if (order?.type === 'attack' && order.kind === 'unit' && order.targetId === enemy.id) {
        chosen = unit
        break
      }
      const distance = Math.hypot(unit.x - enemy.x, unit.y - enemy.y)
      if (distance < chosenD) {
        chosenD = distance
        chosen = unit
      }
    }
    if (!chosen) continue
    if (enemy.kind === 'porter' && engagementOccupied(state, chosen)) continue
    busy.add(chosen.id)
    const order = chosen.order
    if (order?.type === 'attack' && order.kind === 'unit' && order.targetId === enemy.id) continue
    commandAttack(state, [chosen.id], enemy.id, 'unit')
  }

  const load = new Map<string, number>()
  for (const post of posts) load.set(post.key, 0)
  const hold = new Set<number>()
  for (const unit of units) {
    if (busy.has(unit.id)) continue
    const order = unit.order
    if (order?.type === 'attack' && order.kind === 'unit') {
      const target = state.units.find((other) => other.id === order.targetId && other.hp > 0)
      if (target && posts.some((post) => Math.hypot(target.x - post.x, target.y - post.y) <= GUARD_ALERT + 48)) {
        busy.add(unit.id)
        continue
      }
    }
    if (order?.type !== 'attackMove' && order?.type !== 'move') continue
    const index = postOf(state, posts, order.x, order.y)
    const post = index < 0 ? undefined : posts[index]
    if (!post) continue
    if (arrivedAt(unit, standPoint(state, post))) continue
    hold.add(unit.id)
    load.set(post.key, (load.get(post.key) ?? 0) + 1)
  }

  for (const unit of units) {
    if (busy.has(unit.id) || hold.has(unit.id)) continue
    const order = unit.order
    let next: GuardPost | undefined
    if (order?.type === 'attackMove' || order?.type === 'move') {
      const index = postOf(state, posts, order.x, order.y)
      const post = index < 0 ? undefined : posts[index]
      if (post && arrivedAt(unit, standPoint(state, post))) {
        for (let step = 1; step <= posts.length; step++) {
          const candidate = posts[(index + step) % posts.length]
          if (!candidate) continue
          if ((load.get(candidate.key) ?? 0) === 0 || step === posts.length) {
            next = candidate
            break
          }
        }
      }
    }
    if (!next) {
      let best = posts[0]
      let bestLoad = Infinity
      for (const post of posts) {
        const count = load.get(post.key) ?? 0
        if (count < bestLoad) {
          bestLoad = count
          best = post
        }
      }
      next = best
    }
    if (!next) continue
    load.set(next.key, (load.get(next.key) ?? 0) + 1)
    const point = standPoint(state, next)
    if (
      (order?.type === 'attackMove' || order?.type === 'move') &&
      Math.hypot(order.x - point.x, order.y - point.y) < 48
    ) {
      continue
    }
    commandMove(state, [unit.id], point.x, point.y, true)
  }
}

function marchWave(
  state: MatchState,
  strikers: Unit[],
  dest: { x: number; y: number },
  castle: { id: number; x: number; y: number } | null,
): void {
  const fresh: number[] = []
  for (const unit of strikers) {
    const order = unit.order
    if (
      castle &&
      unit.kind !== 'howler' &&
      order?.type === 'attack' &&
      order.kind === 'building' &&
      order.targetId !== castle.id
    ) {
      fresh.push(unit.id)
      continue
    }
    if (
      castle &&
      unit.kind !== 'howler' &&
      order?.type === 'attackMove' &&
      order.focusKind === 'building' &&
      order.focusId !== castle.id
    ) {
      order.focusId = null
      order.focusKind = null
    }
    if (order?.type === 'attack') continue
    if (order?.type === 'attackMove' && order.focusId != null) continue
    if (order?.type === 'attackMove' && Math.hypot(order.x - dest.x, order.y - dest.y) < 56) continue
    fresh.push(unit.id)
  }
  if (fresh.length) commandMove(state, fresh, dest.x, dest.y, true)
}

/** Two fighters already beside the Silo stay out of the assault count. They still patrol. */
const HOME_GUARD = 2
const HOME_NEAR = 100

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

/** Buildings this close to a Silo count as part of the base the army defends. */
const SILO_DEFENSE_REACH = 320

/**
 * Enemy units that are damaging the Silo, or a building beside it, or that have
 * stepped into their own weapon range of one. Pillars shoot on their own.
 */
function siloAttackers(state: MatchState, side: Brain, keepPoint: { x: number; y: number }): Unit[] {
  const watched = state.buildings.filter((building) => {
    if (building.owner !== side.owner || building.hp <= 0 || building.ruined) return false
    const center = buildingCenter(building)
    return Math.hypot(center.x - keepPoint.x, center.y - keepPoint.y) <= SILO_DEFENSE_REACH
  })
  if (!watched.length) return []
  const threats: Unit[] = []
  for (const unit of state.units) {
    if (unit.owner === side.owner || unit.hp <= 0 || unit.kind === 'drone' || unit.cloak > 0) continue
    const range = UNIT_STATS[unit.kind].range
    if (range <= 0) continue
    const seen = tileBit(state, side.visible, Math.floor(unit.x / TILE), Math.floor(unit.y / TILE))
    for (const building of watched) {
      const distance = distToRect(unit.x, unit.y, buildingRect(building))
      const reach = building.alert > 0 ? range + 48 : range
      if (distance > reach) continue
      if (!seen && building.alert <= 0) continue
      threats.push(unit)
      break
    }
  }
  return threats
}

/** Every Flasher and Gorilla attacks the nearest attacker. The wave waits. */
function defendHome(state: MatchState, army: Unit[], threats: Unit[]): void {
  for (const unit of army) {
    let best: Unit | undefined
    let bestD = Infinity
    for (const threat of threats) {
      if (threat.hp <= 0) continue
      const distance = Math.hypot(unit.x - threat.x, unit.y - threat.y)
      if (distance < bestD) {
        bestD = distance
        best = threat
      }
    }
    if (!best) continue
    const order = unit.order
    if (order?.type === 'attack' && order.kind === 'unit' && order.targetId === best.id) continue
    commandAttack(state, [unit.id], best.id, 'unit')
  }
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

