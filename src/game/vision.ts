import { BUILDING_STATS, MAP_H, MAP_W, TILE, UNIT_STATS, type Building, type MatchState, type Unit } from './types'

/** Player sight only. Dunmarch keeps a full view of the map. */
export function updateVision(state: MatchState): void {
  if (state.fogCleared) {
    state.explored.fill(1)
    state.visible.fill(1)
    return
  }
  const visible = new Uint8Array(MAP_W * MAP_H)
  for (const unit of state.units) {
    if (unit.owner !== 0 || unit.hp <= 0) continue
    reveal(state, visible, unit.x, unit.y, UNIT_STATS[unit.kind].sight)
  }
  for (const building of state.buildings) {
    if (building.owner !== 0 || building.hp <= 0) continue
    const stats = BUILDING_STATS[building.kind]
    reveal(state, visible, (building.tx + stats.w / 2) * TILE, (building.ty + stats.h / 2) * TILE, stats.sight)
  }
  state.visible = visible
}

/** Reveal every tile until Fog of War is turned back on. A new match starts under fog. */
export function clearFog(state: MatchState): void {
  state.fogCleared = true
  state.explored.fill(1)
  state.visible.fill(1)
}

/** Hide the map again. Only tiles in current friendly sight stay explored. */
export function restoreFog(state: MatchState): void {
  state.fogCleared = false
  state.explored.fill(0)
  state.visible.fill(0)
  updateVision(state)
}

export function tileVisible(state: MatchState, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false
  return state.visible[ty * MAP_W + tx] === 1
}

export function tileExplored(state: MatchState, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false
  return state.explored[ty * MAP_W + tx] === 1
}

export function unitSeen(state: MatchState, unit: Unit): boolean {
  if (unit.owner === 0) return true
  return tileVisible(state, Math.floor(unit.x / TILE), Math.floor(unit.y / TILE))
}

export function buildingSeen(state: MatchState, building: Building): boolean {
  if (building.owner === 0) return true
  const stats = BUILDING_STATS[building.kind]
  for (let y = 0; y < stats.h; y++) {
    for (let x = 0; x < stats.w; x++) {
      if (tileVisible(state, building.tx + x, building.ty + y)) return true
    }
  }
  return false
}

function reveal(state: MatchState, visible: Uint8Array, x: number, y: number, radius: number): void {
  const minX = Math.max(0, Math.floor((x - radius) / TILE))
  const maxX = Math.min(MAP_W - 1, Math.floor((x + radius) / TILE))
  const minY = Math.max(0, Math.floor((y - radius) / TILE))
  const maxY = Math.min(MAP_H - 1, Math.floor((y + radius) / TILE))
  const reach = radius * radius
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const cx = (tx + 0.5) * TILE
      const cy = (ty + 0.5) * TILE
      if ((cx - x) ** 2 + (cy - y) ** 2 > reach) continue
      const index = ty * MAP_W + tx
      visible[index] = 1
      state.explored[index] = 1
    }
  }
}
