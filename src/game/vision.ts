import { BUILDING_STATS, MAP_H, MAP_W, TILE, UNIT_STATS, type Building, type MatchState, type PlayerId, type Unit } from './types'

/** Refresh both armies' sight. Clear Fog of War reveals the map for Northmark only. */
export function updateVision(state: MatchState): void {
  if (state.fogCleared) {
    state.explored.fill(1)
    state.visible.fill(1)
  } else {
    const visible = new Uint8Array(MAP_W * MAP_H)
    paintSight(state, 0, visible, state.explored)
    state.visible = visible
  }
  const aiVisible = new Uint8Array(MAP_W * MAP_H)
  paintSight(state, 1, aiVisible, state.aiExplored)
  state.aiVisible = aiVisible
  rememberSightings(state)
  if (state.selectedOre != null) {
    const node = state.ore.find((entry) => entry.id === state.selectedOre)
    if (!node || !tileVisible(state, node.tx, node.ty)) state.selectedOre = null
  }
}

/** Reveal every tile for the player until Fog of War is turned back on. A new match starts under fog. */
export function clearFog(state: MatchState): void {
  state.fogCleared = true
  state.explored.fill(1)
  state.visible.fill(1)
}

/** Hide the player's map again. Only tiles in current friendly sight stay explored. */
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

export function aiTileExplored(state: MatchState, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false
  return state.aiExplored[ty * MAP_W + tx] === 1
}

export function aiTileVisible(state: MatchState, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false
  return state.aiVisible[ty * MAP_W + tx] === 1
}

/** Minerals, rocks, and other map objects are drawn only on tiles in current sight. */
export function objectInSight(state: MatchState, tx: number, ty: number): boolean {
  return tileVisible(state, tx, ty)
}

/** A deposit automatic gathering may use. Explored ground counts even under the shroud. */
export function depositKnown(state: MatchState, owner: PlayerId, tx: number, ty: number): boolean {
  if (owner === 0) return tileExplored(state, tx, ty)
  return aiTileExplored(state, tx, ty)
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

function paintSight(state: MatchState, owner: PlayerId, visible: Uint8Array, explored: Uint8Array): void {
  for (const unit of state.units) {
    if (unit.owner !== owner || unit.hp <= 0) continue
    reveal(visible, explored, unit.x, unit.y, UNIT_STATS[unit.kind].sight)
  }
  for (const building of state.buildings) {
    if (building.owner !== owner || building.hp <= 0) continue
    const stats = BUILDING_STATS[building.kind]
    reveal(visible, explored, (building.tx + stats.w / 2) * TILE, (building.ty + stats.h / 2) * TILE, stats.sight)
  }
}

function reveal(visible: Uint8Array, explored: Uint8Array, x: number, y: number, radius: number): void {
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
      explored[index] = 1
    }
  }
}

function rememberSightings(state: MatchState): void {
  for (const building of state.buildings) {
    if (building.owner !== 0 || building.hp <= 0) continue
    if (!aiSeesBuilding(state, building)) continue
    const stats = BUILDING_STATS[building.kind]
    const x = (building.tx + stats.w / 2) * TILE
    const y = (building.ty + stats.h / 2) * TILE
    const known = state.aiSpotted.find((spot) => spot.id === building.id)
    if (known) {
      known.x = x
      known.y = y
    } else {
      state.aiSpotted.push({ id: building.id, x, y })
    }
  }
  state.aiSpotted = state.aiSpotted.filter((spot) => {
    const building = state.buildings.find((entry) => entry.id === spot.id)
    return !!building && building.hp > 0 && building.owner === 0
  })
}

function aiSeesBuilding(state: MatchState, building: Building): boolean {
  const stats = BUILDING_STATS[building.kind]
  for (let y = 0; y < stats.h; y++) {
    for (let x = 0; x < stats.w; x++) {
      if (aiTileVisible(state, building.tx + x, building.ty + y)) return true
    }
  }
  return false
}
