import { findPath } from './pathfind'
import { canPlace, isWalkable, rockAt } from './state'
import { GATHER_TIME, MAP_H, MAP_PX_H, MAP_PX_W, MAP_W, ROCK_HP, TILE, UNIT_STATS, type MatchState, type Rock, type Unit } from './types'

export function stopMoving(unit: Unit): void {
  unit.path = []
  unit.goalX = null
  unit.goalY = null
  unit.stuckT = 0
}

export function nearestWalkable(
  state: MatchState,
  x: number,
  y: number,
): { tx: number; ty: number } | null {
  const sx = Math.floor(x / TILE)
  const sy = Math.floor(y / TILE)
  if (isWalkable(state, sx, sy)) return { tx: sx, ty: sy }
  for (let rad = 1; rad <= 8; rad++) {
    for (let ty = sy - rad; ty <= sy + rad; ty++) {
      for (let tx = sx - rad; tx <= sx + rad; tx++) {
        if (Math.abs(tx - sx) !== rad && Math.abs(ty - sy) !== rad) continue
        if (isWalkable(state, tx, ty)) return { tx, ty }
      }
    }
  }
  return null
}

/** Closest open tile on the ring around a footprint. */
export function nearestParking(
  state: MatchState,
  tx: number,
  ty: number,
  w: number,
  h: number,
  fromX: number,
  fromY: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number; d: number } | null = null
  const consider = (x: number, y: number, penScale: number) => {
    if (!isWalkable(state, x, y)) return
    const wx = (x + 0.5) * TILE
    const wy = (y + 0.5) * TILE
    let pen = 0
    for (const unit of state.units) {
      if (unit.hp <= 0) continue
      if (Math.hypot(unit.x - wx, unit.y - wy) < 16) pen += 56
    }
    const d = (wx - fromX) ** 2 + (wy - fromY) ** 2 + pen * pen * penScale
    if (!best || d < best.d) best = { x: wx, y: wy, d }
  }

  for (let y = ty - 1; y <= ty + h; y++) {
    for (let x = tx - 1; x <= tx + w; x++) {
      const inside = x >= tx && x < tx + w && y >= ty && y < ty + h
      if (!inside) consider(x, y, 1)
    }
  }
  if (best) return best

  for (let rad = 2; rad <= 7; rad++) {
    for (let y = ty - rad; y <= ty + h - 1 + rad; y++) {
      for (let x = tx - rad; x <= tx + w - 1 + rad; x++) {
        const edge =
          x === tx - rad || y === ty - rad || x === tx + w - 1 + rad || y === ty + h - 1 + rad
        if (edge) consider(x, y, 0)
      }
    }
    if (best) return best
  }
  return null
}

export function setUnitDestination(state: MatchState, unit: Unit, gx: number, gy: number): boolean {
  if (unit.kind === 'drone') {
    const margin = 8
    unit.path = []
    unit.goalX = Math.max(margin, Math.min(MAP_PX_W - margin, gx))
    unit.goalY = Math.max(margin, Math.min(MAP_PX_H - margin, gy))
    unit.stuckT = 0
    return true
  }
  const goalTileX = Math.floor(gx / TILE)
  const goalTileY = Math.floor(gy / TILE)
  const goalOpen = isWalkable(state, goalTileX, goalTileY)
  const start = nearestWalkable(state, unit.x, unit.y)
  const goal = goalOpen ? { tx: goalTileX, ty: goalTileY } : nearestWalkable(state, gx, gy)
  if (!start || !goal) {
    unit.path = []
    unit.goalX = gx
    unit.goalY = gy
    return false
  }

  const destX = goalOpen ? gx : (goal.tx + 0.5) * TILE
  const destY = goalOpen ? gy : (goal.ty + 0.5) * TILE
  unit.goalX = destX
  unit.goalY = destY

  if (start.tx === goal.tx && start.ty === goal.ty) {
    unit.path = []
    return true
  }

  const path = findPath(
    state.blocked,
    MAP_W,
    MAP_H,
    start.tx,
    start.ty,
    goal.tx,
    goal.ty,
    occupancyPenalty(state, unit),
  )
  if (!path) {
    unit.path = []
    return false
  }
  unit.path = path.map((step) => ({ x: (step.tx + 0.5) * TILE, y: (step.ty + 0.5) * TILE }))
  const last = unit.path[unit.path.length - 1]
  if (last && goalOpen) {
    last.x = destX
    last.y = destY
  }
  unit.stuckT = 0
  return true
}

export function findBuildSpot(
  state: MatchState,
  kind: 'yard' | 'silo',
  anchorTx: number,
  anchorTy: number,
): { tx: number; ty: number } | null {
  const cx = anchorTx + 1
  const cy = anchorTy + 1
  for (let r = 5; r < MAP_W; r++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (Math.abs(x - cx) !== r && Math.abs(y - cy) !== r) continue
        if (canPlace(state, kind, x, y)) return { tx: x, ty: y }
      }
    }
  }
  return null
}

const APPROACH: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

/**
 * Walk length from a worker to a deposit. A clear route uses A* on walkable tiles.
 * A sealed route sorts after every clear one, by the same length with rocks ignored.
 */
export function haulCost(state: MatchState, unit: Unit, node: { tx: number; ty: number }): number {
  const start = nearestWalkable(state, unit.x, unit.y)
  if (!start) return Number.POSITIVE_INFINITY
  const openGoal = adjacentOpen(state.blocked, node.tx, node.ty)
  if (openGoal) {
    const open = findPath(state.blocked, MAP_W, MAP_H, start.tx, start.ty, openGoal.tx, openGoal.ty)
    if (open) return routeLength(start, open)
  }
  const cleared = clearedOfRocks(state)
  const shortGoal = adjacentOpen(cleared, node.tx, node.ty)
  if (!shortGoal) return Number.POSITIVE_INFINITY
  const shortcut = findPath(cleared, MAP_W, MAP_H, start.tx, start.ty, shortGoal.tx, shortGoal.ty)
  if (!shortcut) return Number.POSITIVE_INFINITY
  return 1_000_000 + routeLength(start, shortcut)
}

/**
 * Seconds until the first load can be picked up: walk the rock-ignoring route,
 * chip every rock on it, then gather once. Lower is sooner.
 */
export function harvestTime(state: MatchState, unit: Unit, node: { tx: number; ty: number }): number {
  const start = nearestWalkable(state, unit.x, unit.y)
  if (!start) return Number.POSITIVE_INFINITY
  const cleared = clearedOfRocks(state)
  const goal = adjacentOpen(cleared, node.tx, node.ty)
  if (!goal) return Number.POSITIVE_INFINITY
  const shortcut = findPath(cleared, MAP_W, MAP_H, start.tx, start.ty, goal.tx, goal.ty)
  if (!shortcut) return Number.POSITIVE_INFINITY
  const stats = UNIT_STATS.porter
  const shots = Math.ceil(ROCK_HP / Math.max(1, stats.damage))
  const travel = (routeLength(start, shortcut) * TILE) / stats.speed
  const breaking = rocksAlong(state, start, shortcut).length * shots * stats.cooldown
  return travel + breaking + GATHER_TIME
}

/**
 * Rock to break when no walkable route to this ore exists.
 * An open route, however long, is left alone. Only workers clear stone.
 * Dunmarch breaks the rock on that shortcut closest to the deposit.
 * A player worker breaks the first rock on the way.
 */
export function gatherBlockRock(
  state: MatchState,
  unit: Unit,
  node: { tx: number; ty: number },
): Rock | null {
  if (unit.kind !== 'porter') return null
  const start = nearestWalkable(state, unit.x, unit.y)
  if (!start) return null
  const openGoal = adjacentOpen(state.blocked, node.tx, node.ty)
  if (openGoal && findPath(state.blocked, MAP_W, MAP_H, start.tx, start.ty, openGoal.tx, openGoal.ty)) {
    return null
  }
  const cleared = clearedOfRocks(state)
  const shortGoal = adjacentOpen(cleared, node.tx, node.ty)
  if (!shortGoal) return null
  const shortcut = findPath(cleared, MAP_W, MAP_H, start.tx, start.ty, shortGoal.tx, shortGoal.ty)
  if (!shortcut) return null
  const rocks = rocksAlong(state, start, shortcut)
  if (!rocks.length) return null
  if (unit.owner !== 1) return rocks[0] ?? null
  const nearestDeposit = rocks.slice().sort((a, b) => rockDistance(a, node) - rockDistance(b, node))
  return nearestDeposit.find((rock) => reachableRock(state, start, rock)) ?? nearestDeposit[0] ?? null
}

/** Extra path cost on tiles where another unit of the same layer is standing. */
function occupancyPenalty(state: MatchState, unit: Unit): Uint8Array {
  const penalty = new Uint8Array(MAP_W * MAP_H)
  const flying = unit.kind === 'drone'
  for (const other of state.units) {
    if (other.id === unit.id || other.hp <= 0) continue
    if ((other.kind === 'drone') !== flying) continue
    const tx = Math.floor(other.x / TILE)
    const ty = Math.floor(other.y / TILE)
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue
    const index = ty * MAP_W + tx
    penalty[index] = Math.min(255, (penalty[index] ?? 0) + 8)
  }
  return penalty
}

function clearedOfRocks(state: MatchState): Uint8Array {
  const cleared = new Uint8Array(state.blocked)
  for (const rock of state.rocks) {
    if (rock.hp <= 0) continue
    cleared[rock.ty * MAP_W + rock.tx] = 0
  }
  return cleared
}

function rockDistance(rock: Rock, node: { tx: number; ty: number }): number {
  return (rock.tx - node.tx) ** 2 + (rock.ty - node.ty) ** 2
}

function reachableRock(state: MatchState, start: { tx: number; ty: number }, rock: Rock): boolean {
  for (const [dx, dy] of APPROACH) {
    const tx = rock.tx + dx
    const ty = rock.ty + dy
    if (!isWalkable(state, tx, ty)) continue
    if (tx === start.tx && ty === start.ty) return true
    if (findPath(state.blocked, MAP_W, MAP_H, start.tx, start.ty, tx, ty)) return true
  }
  return false
}

/** Path length in tiles from a worker to the open ring around a footprint. */
export function builderTravel(
  state: MatchState,
  unit: Unit,
  tx: number,
  ty: number,
  w: number,
  h: number,
): number {
  const start = nearestWalkable(state, unit.x, unit.y)
  if (!start) return Number.POSITIVE_INFINITY
  let goal: { tx: number; ty: number; d: number } | null = null
  for (let y = ty - 1; y <= ty + h; y++) {
    for (let x = tx - 1; x <= tx + w; x++) {
      const inside = x >= tx && x < tx + w && y >= ty && y < ty + h
      if (inside || !isWalkable(state, x, y)) continue
      const d = (unit.x - (x + 0.5) * TILE) ** 2 + (unit.y - (y + 0.5) * TILE) ** 2
      if (!goal || d < goal.d) goal = { tx: x, ty: y, d }
    }
  }
  if (!goal) return Number.POSITIVE_INFINITY
  if (goal.tx === start.tx && goal.ty === start.ty) return 0
  const path = findPath(state.blocked, MAP_W, MAP_H, start.tx, start.ty, goal.tx, goal.ty)
  if (!path) return Number.POSITIVE_INFINITY
  return routeLength(start, path)
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

function adjacentOpen(blocked: Uint8Array, tx: number, ty: number): { tx: number; ty: number } | null {
  for (const [dx, dy] of APPROACH) {
    const x = tx + dx
    const y = ty + dy
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue
    if (blocked[y * MAP_W + x] === 0) return { tx: x, ty: y }
  }
  return null
}

function rocksAlong(
  state: MatchState,
  start: { tx: number; ty: number },
  path: Array<{ tx: number; ty: number }>,
): Rock[] {
  const rocks: Rock[] = []
  const seen = new Set<number>()
  let prev = start
  for (const step of path) {
    for (const rock of rocksOnSegment(state, prev.tx, prev.ty, step.tx, step.ty)) {
      if (seen.has(rock.id)) continue
      seen.add(rock.id)
      rocks.push(rock)
    }
    prev = step
  }
  return rocks
}

function rocksOnSegment(state: MatchState, x0: number, y0: number, x1: number, y1: number): Rock[] {
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  const rocks: Rock[] = []
  let x = x0
  let y = y0
  for (let guard = 0; guard <= dx + dy + 1; guard++) {
    const rock = rockAt(state, x, y)
    if (rock) rocks.push(rock)
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
  return rocks
}
