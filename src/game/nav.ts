import { findPath } from './pathfind'
import { canPlace, isWalkable } from './state'
import { MAP_H, MAP_W, TILE, type MatchState, type Unit } from './types'

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

  const path = findPath(state.blocked, MAP_W, MAP_H, start.tx, start.ty, goal.tx, goal.ty)
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
  for (let r = 5; r <= 15; r++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (Math.abs(x - cx) !== r && Math.abs(y - cy) !== r) continue
        if (canPlace(state, kind, x, y)) return { tx: x, ty: y }
      }
    }
  }
  return null
}
