import { aiPlaceNearKeep, commandAttack, commandMove, tryTrain } from './commands'
import { nearestWalkable } from './nav'
import { findPath } from './pathfind'
import { buildingCenter, rockAt } from './state'
import { BUILDING_STATS, MAP_H, MAP_W, TILE, type MatchState, type Rock, type Unit } from './types'

/** Extra tiles of walking that justify stopping to break a rock. */
const ROCK_DETOUR = 12
/** Bank or reachable ore below this counts as running low (a yard costs more). */
const ORE_NEED = 80

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

function idlePorter(unit: Unit): boolean {
  return unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0 && !unit.order
}

export function updateAi(state: MatchState, dt: number): void {
  if (state.outcome) return
  state.aiAcc += dt
  if (state.aiAcc < 0.5) return
  state.aiAcc = 0

  const porters = state.units.filter((unit) => unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0)
  for (const porter of porters) {
    if (!idlePorter(porter)) continue
    const node = nearestNode(state, porter.x, porter.y)
    if (!node) continue
    porter.order = {
      type: 'gather',
      nodeId: node.id,
      phase: porter.cargo > 0 ? 'return' : 'approach',
    }
    porter.nodeMemory = node.id
    porter.path = []
    porter.goalX = null
    porter.goalY = null
  }

  const oreBlock = economyRock(state, porters)
  if (oreBlock) assignOrePorters(state, porters, oreBlock.rock, oreBlock.trapped)

  const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  if (!keep?.complete) return

  const queuedPorters = keep.queue.filter((job) => job.kind === 'porter').length
  if (porters.length + queuedPorters < 6 && keep.queue.length < 2) {
    tryTrain(state, keep.id, 'porter')
  }

  const constructing = state.buildings.some((building) => building.owner === 1 && !building.complete && building.hp > 0)
  const yard = state.buildings.find((building) => building.owner === 1 && building.kind === 'yard' && building.hp > 0)
  const silos = state.buildings.filter((building) => building.owner === 1 && building.kind === 'silo' && building.hp > 0).length
  if (!constructing) {
    if (!yard && state.oreHeld[1] >= BUILDING_STATS.yard.cost) {
      aiPlaceNearKeep(state, 'yard')
    } else if (
      state.supplyCap[1] - state.supplyUsed[1] <= 2 &&
      silos < 4 &&
      state.oreHeld[1] >= BUILDING_STATS.silo.cost
    ) {
      aiPlaceNearKeep(state, 'silo')
    }
  }

  const readyYard = state.buildings.find(
    (building) => building.owner === 1 && building.kind === 'yard' && building.complete && building.hp > 0,
  )
  if (readyYard && readyYard.queue.length < 1) {
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
  if (blocker) assignRockBreakers(state, army, blocker.rock, blocker.trapped)
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

/**
 * Rock between porters and remaining ore. A sealed route is always cleared.
 * A long detour is cleared only when the bank or the ore they can already reach is running low.
 */
function economyRock(state: MatchState, porters: Unit[]): { rock: Rock; trapped: boolean } | null {
  const seekers = porters.filter((unit) => unit.cargo <= 0 && unit.order?.type !== 'construct')
  const seeker = seekers[0]
  if (!seeker) return null
  const start = nearestWalkable(state, seeker.x, seeker.y)
  if (!start) return null
  const nodes = state.ore.filter((node) => node.amount > 0)
  if (!nodes.length) return null
  nodes.sort((a, b) => {
    const da = (a.tx - start.tx) ** 2 + (a.ty - start.ty) ** 2
    const db = (b.tx - start.tx) ** 2 + (b.ty - start.ty) ** 2
    return da - db
  })

  const cleared = withoutRocks(state)
  let bestOpen = Infinity
  let reachableAmount = 0
  let bestShort: { len: number; path: Array<{ tx: number; ty: number }> } | null = null

  for (const node of nodes) {
    const openGoal = adjacentOpen(state.blocked, node.tx, node.ty)
    const shortGoal = adjacentOpen(cleared, node.tx, node.ty)
    if (shortGoal) {
      const shortcut = findPath(cleared, MAP_W, MAP_H, start.tx, start.ty, shortGoal.tx, shortGoal.ty)
      if (shortcut) {
        const len = routeLength(start, shortcut)
        if (!bestShort || len < bestShort.len) bestShort = { len, path: shortcut }
      }
    }
    if (openGoal) {
      const open = findPath(state.blocked, MAP_W, MAP_H, start.tx, start.ty, openGoal.tx, openGoal.ty)
      if (open) {
        const len = routeLength(start, open)
        if (len < bestOpen) bestOpen = len
        reachableAmount += node.amount
      }
    }
    if (state.oreHeld[1] >= ORE_NEED && reachableAmount >= ORE_NEED) return null
  }

  if (!bestShort) return null
  if (bestOpen === Infinity) {
    const rock = rockAlong(state, start, bestShort.path)
    return rock ? { rock, trapped: true } : null
  }
  const needMore = state.oreHeld[1] < ORE_NEED || reachableAmount < ORE_NEED
  if (!needMore || bestOpen - bestShort.len < ROCK_DETOUR) return null
  const rock = rockAlong(state, start, bestShort.path)
  return rock ? { rock, trapped: false } : null
}

function adjacentOpen(blocked: Uint8Array, tx: number, ty: number): { tx: number; ty: number } | null {
  for (const [dx, dy] of NEIGHBORS) {
    const x = tx + dx
    const y = ty + dy
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue
    if (blocked[y * MAP_W + x] === 0) return { tx: x, ty: y }
  }
  return null
}

function assignOrePorters(state: MatchState, porters: Unit[], rock: Rock, trapped: boolean): void {
  const crew = porters
    .filter((unit) => unit.cargo <= 0 && unit.order?.type !== 'construct')
    .sort(
      (a, b) =>
        Math.hypot(a.x - (rock.tx + 0.5) * TILE, a.y - (rock.ty + 0.5) * TILE) -
        Math.hypot(b.x - (rock.tx + 0.5) * TILE, b.y - (rock.ty + 0.5) * TILE),
    )
  const chosen = trapped ? crew : crew.slice(0, 2)
  const fresh = chosen.filter((unit) => !(unit.order?.type === 'attack' && unit.order.kind === 'rock'))
  if (!fresh.length) return
  commandAttack(
    state,
    fresh.map((unit) => unit.id),
    rock.id,
    'rock',
  )
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

function fightingSomeone(unit: Unit): boolean {
  if (unit.order?.type === 'attack' && unit.order.kind !== 'rock') return true
  return unit.order?.type === 'attackMove' && unit.order.focusId != null && unit.order.focusKind !== 'rock'
}

function nearestToRock(rock: Rock, units: Unit[]): Unit[] {
  const x = (rock.tx + 0.5) * TILE
  const y = (rock.ty + 0.5) * TILE
  return units.slice().sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))
}

/** Pikes break march rocks. Miners fill in only when no pike is free. Howlers never do. */
function assignRockBreakers(state: MatchState, army: Unit[], rock: Rock, trapped: boolean): void {
  const pikes = nearestToRock(
    rock,
    army.filter((unit) => unit.kind === 'pike' && !fightingSomeone(unit)),
  )
  const miners = nearestToRock(
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
  const pool = pikes.length ? pikes : miners
  const crew = trapped ? pool : pool.slice(0, 2)
  const fresh = crew.filter((unit) => !(unit.order?.type === 'attack' && unit.order.kind === 'rock'))
  if (!fresh.length) return
  commandAttack(
    state,
    fresh.map((unit) => unit.id),
    rock.id,
    'rock',
  )
}

function nearestNode(state: MatchState, x: number, y: number): { id: number } | null {
  let best: { id: number } | null = null
  let bestD = Infinity
  for (const node of state.ore) {
    if (node.amount <= 0) continue
    const dx = (node.tx + 0.5) * TILE - x
    const dy = (node.ty + 0.5) * TILE - y
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = node
    }
  }
  return best
}
