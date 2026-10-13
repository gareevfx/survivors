import { localOwner, multiplayer } from './mpRole'
import { BUILDING_STATS, TILE, UNIT_STATS, type Building, type MatchState, type PlayerId, type Unit } from './types'

/** Refresh every side's sight. Off Fog of War reveals the map for Silo 01 only. */
export function updateVision(state: MatchState): void {
  const cells = state.mapW * state.mapH
  for (let owner = 0; owner < state.playerCount; owner++) {
    const explored = exploredGrid(state, owner)
    if (owner === 0 && state.fogCleared) {
      explored.fill(1)
      state.visible.fill(1)
      state.sideVisible[0] = state.visible
      continue
    }
    let visible = state.sideVisible[owner]
    if (!visible || visible.length !== cells) {
      visible = new Uint8Array(cells)
      state.sideVisible[owner] = visible
    } else visible.fill(0)
    paintSight(state, owner, visible, explored)
    if (owner === 0) state.visible = visible
    else if (owner === 1) state.aiVisible = visible
  }
  const now = state.time
  for (let i = 0; i < state.visible.length; i++) {
    if (state.visible[i] === 1) state.seenAt[i] = now
  }
  if (multiplayer()) {
    if (!state.aiSeenAt || state.aiSeenAt.length !== state.aiVisible.length) {
      state.aiSeenAt = new Float32Array(state.aiVisible.length)
    }
    for (let i = 0; i < state.aiVisible.length; i++) {
      if (state.aiVisible[i] === 1) state.aiSeenAt[i] = now
    }
  }
  rememberSightings(state)
  if (state.selectedOre != null) {
    const node = state.ore.find((entry) => entry.id === state.selectedOre)
    if (!node || node.amount <= 0 || !tileExplored(state, node.tx, node.ty)) state.selectedOre = null
  }
  if (state.selectedGrave != null) {
    const grave = state.graves.find((entry) => entry.id === state.selectedGrave)
    if (!grave || !viewGroundShown(state, grave.tx, grave.ty)) state.selectedGrave = null
  }
}

function exploredGrid(state: MatchState, owner: PlayerId): Uint8Array {
  if (owner === 0) return state.explored
  if (owner === 1) return state.aiExplored
  return state.sideExplored[owner] ?? state.aiExplored
}

function visibleGrid(state: MatchState, owner: PlayerId): Uint8Array {
  if (owner === 0) return state.visible
  if (owner === 1) return state.aiVisible
  return state.sideVisible[owner] ?? state.aiVisible
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

function onMap(state: MatchState, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < state.mapW && ty < state.mapH
}

export function tileVisible(state: MatchState, tx: number, ty: number): boolean {
  if (!onMap(state, tx, ty)) return false
  return state.visible[ty * state.mapW + tx] === 1
}

export function tileExplored(state: MatchState, tx: number, ty: number): boolean {
  if (!onMap(state, tx, ty)) return false
  return state.explored[ty * state.mapW + tx] === 1
}

export function aiTileExplored(state: MatchState, tx: number, ty: number): boolean {
  if (!onMap(state, tx, ty)) return false
  return state.aiExplored[ty * state.mapW + tx] === 1
}

export function aiTileVisible(state: MatchState, tx: number, ty: number): boolean {
  if (!onMap(state, tx, ty)) return false
  return state.aiVisible[ty * state.mapW + tx] === 1
}

export function sideTileVisible(state: MatchState, owner: PlayerId, tx: number, ty: number): boolean {
  if (!onMap(state, tx, ty)) return false
  return visibleGrid(state, owner)[ty * state.mapW + tx] === 1
}

export function sideTileExplored(state: MatchState, owner: PlayerId, tx: number, ty: number): boolean {
  if (!onMap(state, tx, ty)) return false
  return exploredGrid(state, owner)[ty * state.mapW + tx] === 1
}

/** Rocks and minerals stay drawn on explored ground, including the gray shroud. Black ground hides them. */
export function groundShown(state: MatchState, tx: number, ty: number): boolean {
  return tileExplored(state, tx, ty)
}

/** Sight used for drawing. Both cam merges every side. Enemy cam shows every side but Silo 01. */
export function viewTileVisible(state: MatchState, tx: number, ty: number): boolean {
  if (state.bothCam) return anySideBit(state, tx, ty, false, true)
  if (state.enemyCam) return anySideBit(state, tx, ty, true, true)
  return localOwner() === 0 ? tileVisible(state, tx, ty) : aiTileVisible(state, tx, ty)
}

export function viewTileExplored(state: MatchState, tx: number, ty: number): boolean {
  if (state.bothCam) return anySideBit(state, tx, ty, false, false)
  if (state.enemyCam) return anySideBit(state, tx, ty, true, false)
  return localOwner() === 0 ? tileExplored(state, tx, ty) : aiTileExplored(state, tx, ty)
}

function anySideBit(state: MatchState, tx: number, ty: number, enemiesOnly: boolean, current: boolean): boolean {
  const first = enemiesOnly ? 1 : 0
  for (let owner = first; owner < state.playerCount; owner++) {
    if (current ? sideTileVisible(state, owner, tx, ty) : sideTileExplored(state, owner, tx, ty)) return true
  }
  return false
}

export function viewGroundShown(state: MatchState, tx: number, ty: number): boolean {
  return viewTileExplored(state, tx, ty)
}

/** True when this camera includes that side, so the side still sees its own cloaked Hovers. */
function viewerOwns(state: MatchState, owner: PlayerId): boolean {
  if (state.bothCam) return true
  if (state.enemyCam) return owner !== 0
  return owner === localOwner()
}

export function viewUnitSeen(state: MatchState, unit: Unit): boolean {
  if (unit.cloak > 0 && !viewerOwns(state, unit.owner)) return false
  if (!state.bothCam && !state.enemyCam && unit.owner === localOwner()) return true
  if (!state.bothCam && state.enemyCam && unit.owner !== 0) return true
  return viewTileVisible(state, Math.floor(unit.x / TILE), Math.floor(unit.y / TILE))
}

export function viewBuildingSeen(state: MatchState, building: Building): boolean {
  if (building.ruined) return viewRuinShown(state, building)
  if (!state.bothCam && !state.enemyCam && building.owner === localOwner()) return true
  if (!state.bothCam && state.enemyCam && building.owner !== 0) return true
  const stats = BUILDING_STATS[building.kind]
  for (let y = 0; y < stats.h; y++) {
    for (let x = 0; x < stats.w; x++) {
      if (viewTileVisible(state, building.tx + x, building.ty + y)) return true
    }
  }
  return false
}

/** A ruined Silo is drawn on explored ground, including the gray shroud. Black fog hides it. */
export function viewRuinShown(state: MatchState, building: Building): boolean {
  const stats = BUILDING_STATS[building.kind]
  for (let y = 0; y < stats.h; y++) {
    for (let x = 0; x < stats.w; x++) {
      if (viewTileExplored(state, building.tx + x, building.ty + y)) return true
    }
  }
  return false
}

/** A deposit automatic gathering may use. Explored ground counts even under the shroud. */
export function depositKnown(state: MatchState, owner: PlayerId, tx: number, ty: number): boolean {
  return sideTileExplored(state, owner, tx, ty)
}

export function unitSeen(state: MatchState, unit: Unit): boolean {
  if (unit.cloak > 0 && unit.owner !== 0) return false
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
    reveal(state, visible, explored, unit.x, unit.y, UNIT_STATS[unit.kind].sight)
  }
  for (const building of state.buildings) {
    if (building.owner !== owner || building.hp <= 0) continue
    const stats = BUILDING_STATS[building.kind]
    reveal(state, visible, explored, (building.tx + stats.w / 2) * TILE, (building.ty + stats.h / 2) * TILE, stats.sight)
  }
}

function reveal(state: MatchState, visible: Uint8Array, explored: Uint8Array, x: number, y: number, radius: number): void {
  const minX = Math.max(0, Math.floor((x - radius) / TILE))
  const maxX = Math.min(state.mapW - 1, Math.floor((x + radius) / TILE))
  const minY = Math.max(0, Math.floor((y - radius) / TILE))
  const maxY = Math.min(state.mapH - 1, Math.floor((y + radius) / TILE))
  const reach = radius * radius
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const cx = (tx + 0.5) * TILE
      const cy = (ty + 0.5) * TILE
      if ((cx - x) ** 2 + (cy - y) ** 2 > reach) continue
      const index = ty * state.mapW + tx
      visible[index] = 1
      explored[index] = 1
    }
  }
}

function rememberSightings(state: MatchState): void {
  for (let owner = 0; owner < state.playerCount; owner++) {
    const spots = owner === 0 ? state.playerSpotted : owner === 1 ? state.aiSpotted : state.sideSpotted[owner]
    if (!spots) continue
    for (const building of state.buildings) {
      if (building.owner === owner || building.hp <= 0) continue
      if (!ownerSeesBuilding(state, owner, building)) continue
      const stats = BUILDING_STATS[building.kind]
      const x = (building.tx + stats.w / 2) * TILE
      const y = (building.ty + stats.h / 2) * TILE
      const known = spots.find((spot) => spot.id === building.id)
      if (known) {
        known.x = x
        known.y = y
      } else {
        spots.push({ id: building.id, x, y })
      }
    }
    for (let i = spots.length - 1; i >= 0; i--) {
      const spot = spots[i]
      if (!spot) continue
      const building = state.buildings.find((entry) => entry.id === spot.id)
      if (!building || building.hp <= 0 || building.owner === owner) spots.splice(i, 1)
    }
  }
}

function ownerSeesBuilding(state: MatchState, owner: PlayerId, building: Building): boolean {
  const stats = BUILDING_STATS[building.kind]
  for (let y = 0; y < stats.h; y++) {
    for (let x = 0; x < stats.w; x++) {
      if (sideTileVisible(state, owner, building.tx + x, building.ty + y)) return true
    }
  }
  return false
}
