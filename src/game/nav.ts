import { findPath } from './pathfind'
import { canPlace, footprintInKeepSight, isWalkable, rockAt } from './state'
import {
  BUILDING_STATS,
  GATHER_TIME,
  TILE,
  UNIT_STATS,
  type MatchState,
  type Rock,
  type Unit,
} from './types'

/** True when a circle overlaps a blocked tile, including rocks, trees, minerals, and buildings. */
export function circleHitsSolid(state: MatchState, x: number, y: number, radius: number): boolean {
  const minTx = Math.floor((x - radius) / TILE)
  const maxTx = Math.floor((x + radius) / TILE)
  const minTy = Math.floor((y - radius) / TILE)
  const maxTy = Math.floor((y + radius) / TILE)
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (isWalkable(state, tx, ty)) continue
      const left = tx * TILE
      const top = ty * TILE
      const cx = Math.max(left, Math.min(x, left + TILE))
      const cy = Math.max(top, Math.min(y, top + TILE))
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy < radius * radius) return true
    }
  }
  return false
}

/** Step from a blocked point back toward the unit until the body fits on open ground. */
function pullToClearGround(
  state: MatchState,
  x: number,
  y: number,
  fromX: number,
  fromY: number,
  radius: number,
): { x: number; y: number } | null {
  const dx = fromX - x
  const dy = fromY - y
  const len = Math.hypot(dx, dy) || 1
  for (let dist = 2; dist <= 72; dist += 2) {
    const px = x + (dx / len) * dist
    const py = y + (dy / len) * dist
    const tx = Math.floor(px / TILE)
    const ty = Math.floor(py / TILE)
    if (!isWalkable(state, tx, ty)) continue
    if (!circleHitsSolid(state, px, py, radius)) return { x: px, y: py }
  }
  return null
}

/**
 * True when the straight step would leave the body on a blocked tile or
 * squeeze the center between two blocked tiles.
 */
export function groundMoveBlocked(
  state: MatchState,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
): boolean {
  if (circleHitsSolid(state, x1, y1, radius)) return true
  const dist = Math.hypot(x1 - x0, y1 - y0)
  const steps = Math.max(1, Math.ceil(dist / 4))
  let prevTx = Math.floor(x0 / TILE)
  let prevTy = Math.floor(y0 / TILE)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const x = x0 + (x1 - x0) * t
    const y = y0 + (y1 - y0) * t
    const tx = Math.floor(x / TILE)
    const ty = Math.floor(y / TILE)
    if (tx !== prevTx && ty !== prevTy) {
      if (!isWalkable(state, tx, prevTy) || !isWalkable(state, prevTx, ty)) return true
    }
    if (circleHitsSolid(state, x, y, radius)) return true
    prevTx = tx
    prevTy = ty
  }
  return false
}

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
    unit.goalX = Math.max(margin, Math.min(state.mapW * TILE - margin, gx))
    unit.goalY = Math.max(margin, Math.min(state.mapH * TILE - margin, gy))
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

  let destX = goalOpen ? gx : (goal.tx + 0.5) * TILE
  let destY = goalOpen ? gy : (goal.ty + 0.5) * TILE
  const body = UNIT_STATS[unit.kind].radius
  if (circleHitsSolid(state, destX, destY, body)) {
    const pulled = pullToClearGround(state, destX, destY, unit.x, unit.y, body)
    destX = pulled?.x ?? (goal.tx + 0.5) * TILE
    destY = pulled?.y ?? (goal.ty + 0.5) * TILE
  }
  unit.goalX = destX
  unit.goalY = destY

  if (start.tx === goal.tx && start.ty === goal.ty) {
    unit.path = []
    return true
  }

  const path = findPath(
    state.blocked,
    state.mapW,
    state.mapH,
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

/** Walkable tiles kept around every side of an AI building, including corners. */
export const AI_BUILD_GAP = 1
/**
 * Chebyshev tiles between an AI footprint and any mineral tile.
 * A gap of 3 leaves two open tiles between the building and the patch.
 */
export const AI_MINERAL_KEEP = 3
/**
 * Mineral patches this close to the Castle center reserve the straight haul.
 * The starting patches sit about eight tiles out, so 12 covers them and
 * leaves the long roads to distant patches free for building.
 */
export const AI_MINERAL_LANE = 12

/** Tiles on the straight haul from a Castle center to each nearby mineral patch. */
export function mineralLaneTiles(state: MatchState, cx: number, cy: number): Set<number> {
  const lanes = new Set<number>()
  const reach = AI_MINERAL_LANE * AI_MINERAL_LANE
  for (const node of state.ore) {
    if (node.amount <= 0) continue
    const dx = node.tx - cx
    const dy = node.ty - cy
    if (dx * dx + dy * dy > reach) continue
    for (const [tx, ty] of lineTiles(cx, cy, node.tx, node.ty)) {
      if (tx < 0 || ty < 0 || tx >= state.mapW || ty >= state.mapH) continue
      lanes.add(ty * state.mapW + tx)
    }
  }
  return lanes
}

export function findBuildSpot(
  state: MatchState,
  kind: 'yard' | 'silo' | 'tower',
  anchorTx: number,
  anchorTy: number,
): { tx: number; ty: number } | null {
  const cx = anchorTx + 1
  const cy = anchorTy + 1
  const lanes = mineralLaneTiles(state, cx, cy)
  const stats = BUILDING_STATS[kind]
  for (let r = 5; r < state.mapW; r++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (Math.abs(x - cx) !== r && Math.abs(y - cy) !== r) continue
        if (kind === 'tower' && !footprintInKeepSight(anchorTx, anchorTy, x, y, stats.w, stats.h)) continue
        if (aiMayBuild(state, kind, x, y, lanes)) return { tx: x, ty: y }
      }
    }
  }
  return null
}

function aiMayBuild(
  state: MatchState,
  kind: 'yard' | 'silo' | 'tower',
  tx: number,
  ty: number,
  lanes: Set<number>,
): boolean {
  if (!canPlace(state, kind, tx, ty)) return false
  const stats = BUILDING_STATS[kind]
  for (let y = ty - AI_BUILD_GAP; y <= ty + stats.h - 1 + AI_BUILD_GAP; y++) {
    for (let x = tx - AI_BUILD_GAP; x <= tx + stats.w - 1 + AI_BUILD_GAP; x++) {
      const footprint = x >= tx && x < tx + stats.w && y >= ty && y < ty + stats.h
      if (footprint) continue
      if (!isWalkable(state, x, y)) return false
    }
  }
  for (const node of state.ore) {
    if (node.amount <= 0) continue
    if (footprintDistance(tx, ty, stats.w, stats.h, node.tx, node.ty) < AI_MINERAL_KEEP) return false
  }
  for (let y = 0; y < stats.h; y++) {
    for (let x = 0; x < stats.w; x++) {
      if (lanes.has((ty + y) * state.mapW + (tx + x))) return false
    }
  }
  return true
}

function footprintDistance(tx: number, ty: number, w: number, h: number, ox: number, oy: number): number {
  const dx = ox < tx ? tx - ox : ox > tx + w - 1 ? ox - (tx + w - 1) : 0
  const dy = oy < ty ? ty - oy : oy > ty + h - 1 ? oy - (ty + h - 1) : 0
  return Math.max(dx, dy)
}

function lineTiles(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const tiles: Array<[number, number]> = []
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  let x = x0
  let y = y0
  for (let guard = 0; guard <= dx + dy + 1; guard++) {
    tiles.push([x, y])
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
  return tiles
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
  const openGoal = adjacentOpen(state, state.blocked, node.tx, node.ty)
  if (openGoal) {
    const open = findPath(state.blocked, state.mapW, state.mapH, start.tx, start.ty, openGoal.tx, openGoal.ty)
    if (open) return routeLength(start, open)
  }
  const cleared = clearedOfRocks(state)
  const shortGoal = adjacentOpen(state, cleared, node.tx, node.ty)
  if (!shortGoal) return Number.POSITIVE_INFINITY
  const shortcut = findPath(cleared, state.mapW, state.mapH, start.tx, start.ty, shortGoal.tx, shortGoal.ty)
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
  const goal = adjacentOpen(state, cleared, node.tx, node.ty)
  if (!goal) return Number.POSITIVE_INFINITY
  const shortcut = findPath(cleared, state.mapW, state.mapH, start.tx, start.ty, goal.tx, goal.ty)
  if (!shortcut) return Number.POSITIVE_INFINITY
  const stats = UNIT_STATS.porter
  const travel = (routeLength(start, shortcut) * TILE) / stats.speed
  const breaking = rocksAlong(state, start, shortcut).reduce((sum, rock) => {
    const shots = Math.ceil(rock.hp / Math.max(1, stats.damage))
    return sum + shots * stats.cooldown
  }, 0)
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
  const openGoal = adjacentOpen(state, state.blocked, node.tx, node.ty)
  if (openGoal && findPath(state.blocked, state.mapW, state.mapH, start.tx, start.ty, openGoal.tx, openGoal.ty)) {
    return null
  }
  const cleared = clearedOfRocks(state)
  const shortGoal = adjacentOpen(state, cleared, node.tx, node.ty)
  if (!shortGoal) return null
  const shortcut = findPath(cleared, state.mapW, state.mapH, start.tx, start.ty, shortGoal.tx, shortGoal.ty)
  if (!shortcut) return null
  const rocks = rocksAlong(state, start, shortcut)
  if (!rocks.length) return null
  if (unit.owner !== 1) return rocks[0] ?? null
  const nearestDeposit = rocks.slice().sort((a, b) => rockDistance(a, node) - rockDistance(b, node))
  return nearestDeposit.find((rock) => reachableRock(state, start, rock)) ?? nearestDeposit[0] ?? null
}

/** Extra path cost on tiles where another unit of the same layer is standing. */
function occupancyPenalty(state: MatchState, unit: Unit): Uint8Array {
  const penalty = new Uint8Array(state.mapW * state.mapH)
  const flying = unit.kind === 'drone'
  for (const other of state.units) {
    if (other.id === unit.id || other.hp <= 0) continue
    if ((other.kind === 'drone') !== flying) continue
    const tx = Math.floor(other.x / TILE)
    const ty = Math.floor(other.y / TILE)
    if (tx < 0 || ty < 0 || tx >= state.mapW || ty >= state.mapH) continue
    const index = ty * state.mapW + tx
    penalty[index] = Math.min(255, (penalty[index] ?? 0) + 8)
  }
  return penalty
}

function clearedOfRocks(state: MatchState): Uint8Array {
  const cleared = new Uint8Array(state.blocked)
  for (const rock of state.rocks) {
    if (rock.hp <= 0) continue
    cleared[rock.ty * state.mapW + rock.tx] = 0
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
    if (findPath(state.blocked, state.mapW, state.mapH, start.tx, start.ty, tx, ty)) return true
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
  const path = findPath(state.blocked, state.mapW, state.mapH, start.tx, start.ty, goal.tx, goal.ty)
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

function adjacentOpen(state: MatchState, blocked: Uint8Array, tx: number, ty: number): { tx: number; ty: number } | null {
  for (const [dx, dy] of APPROACH) {
    const x = tx + dx
    const y = ty + dy
    if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) continue
    if (blocked[y * state.mapW + x] === 0) return { tx: x, ty: y }
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
