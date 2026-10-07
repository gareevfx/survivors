import { aiPlaceNearKeep, assignMiners, commandAttack, commandMove, tryTrain } from './commands'
import { nearestWalkable } from './nav'
import { findPath } from './pathfind'
import { buildingCenter, rockAt } from './state'
import { BUILDING_STATS, MAP_H, MAP_W, TILE, type MatchState, type Rock, type Unit } from './types'

/** Extra tiles of walking that justify stopping to break a rock for the army. */
const ROCK_DETOUR = 12

function idlePorter(unit: Unit): boolean {
  return unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0 && !unit.order
}

export function updateAi(state: MatchState, dt: number): void {
  if (state.outcome) return
  state.aiAcc += dt
  if (state.aiAcc < 0.5) return
  state.aiAcc = 0

  const porters = state.units.filter((unit) => unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0)
  assignMiners(
    state,
    porters.filter((unit) => idlePorter(unit)),
    null,
  )

  const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  if (!keep?.complete) return

  const queuedPorters = keep.queue.filter((job) => job.kind === 'porter').length
  if (porters.length + queuedPorters < 6 && keep.queue.length < 2) {
    tryTrain(state, keep.id, 'porter')
  }

  const constructing = state.buildings.some((building) => building.owner === 1 && !building.complete && building.hp > 0)
  if (!constructing) {
    const supplyRoom = state.supplyCap[1] - state.supplyUsed[1]
    if (supplyRoom <= 2 && state.oreHeld[1] >= BUILDING_STATS.silo.cost) {
      aiPlaceNearKeep(state, 'silo')
    } else if (state.oreHeld[1] >= BUILDING_STATS.yard.cost) {
      aiPlaceNearKeep(state, 'yard')
    }
  }

  const readyYards = state.buildings.filter(
    (building) => building.owner === 1 && building.kind === 'yard' && building.complete && building.hp > 0,
  )
  for (const readyYard of readyYards) {
    if (readyYard.queue.length >= 1) continue
    const first = state.aiNext
    const second = first === 'pike' ? 'howler' : 'pike'
    if (tryTrain(state, readyYard.id, first) === null) state.aiNext = second
    else tryTrain(state, readyYard.id, second)
  }

  const army = state.units.filter((unit) => unit.owner === 1 && unit.kind !== 'porter' && unit.hp > 0)
  const playerKeep = state.buildings.find(
    (building) => building.owner === 0 && building.kind === 'keep' && building.hp > 0,
  )
  const keepPoint = buildingCenter(keep)
  const threatened = state.units.some(
    (unit) =>
      unit.owner === 0 &&
      unit.kind !== 'porter' &&
      unit.hp > 0 &&
      Math.hypot(unit.x - keepPoint.x, unit.y - keepPoint.y) < 340,
  )
  if (threatened || army.length >= 10 || (state.time > 105 && army.length >= 5)) state.aiAttacking = true
  if (!threatened && army.length === 0) state.aiAttacking = false
  if (!state.aiAttacking || !playerKeep) return

  const dest = threatened ? keepPoint : buildingCenter(playerKeep)
  const blocker = rockBlockingMarch(state, army, dest.x, dest.y)
  if (blocker) assignRockBreakers(state, blocker.rock, blocker.trapped)
  for (const unit of army) {
    if (unit.order?.type === 'attack') continue
    if (unit.order?.type === 'attackMove' && unit.order.focusId != null) continue
    if (
      unit.order?.type === 'attackMove' &&
      Math.hypot(unit.order.x - dest.x, unit.order.y - dest.y) < 56
    ) {
      continue
    }
    commandMove(state, [unit.id], dest.x, dest.y, true)
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
    const open = findPath(state.blocked, MAP_W, MAP_H, start.tx, start.ty, goal.tx, goal.ty)
    const shortcut = findPath(cleared, MAP_W, MAP_H, start.tx, start.ty, goal.tx, goal.ty)
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
    cleared[rock.ty * MAP_W + rock.tx] = 0
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
function assignRockBreakers(state: MatchState, rock: Rock, trapped: boolean): void {
  const workers = nearestToRock(
    rock,
    state.units.filter(
      (unit) =>
        unit.owner === 1 &&
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

