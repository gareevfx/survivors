import { controlledSide } from './control'
import {
  BUILDING_STATS,
  TILE,
  UNIT_STATS,
  type Building,
  type BuildingKind,
  type BuildingSighting,
  type MatchState,
  type PlayerId,
  type Unit,
} from './types'

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
  rememberSightings(state)
  if (state.selectedOre != null) {
    const node = state.ore.find((entry) => entry.id === state.selectedOre)
    if (!node || node.amount <= 0 || !viewGroundShown(state, node.tx, node.ty)) state.selectedOre = null
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

/**
 * Every footprint tile is ground this side has explored.
 * Current sight and the translucent shroud both count. Black fog does not.
 * One black tile, or a tile off the map, rejects the building.
 */
export function footprintExplored(
  state: MatchState,
  owner: PlayerId,
  kind: BuildingKind,
  tx: number,
  ty: number,
): boolean {
  const stats = BUILDING_STATS[kind]
  for (let y = 0; y < stats.h; y++) {
    for (let x = 0; x < stats.w; x++) {
      if (!sideTileExplored(state, owner, tx + x, ty + y)) return false
    }
  }
  return true
}

/** Rocks and minerals stay drawn on explored ground, including the gray shroud. Black ground hides them. */
export function groundShown(state: MatchState, tx: number, ty: number): boolean {
  return tileExplored(state, tx, ty)
}

/**
 * Sight used for drawing and for the player's clicks.
 * Both cam merges every side. Enemy cam is still every side but Silo 01.
 * Off Fog of War shows the whole map. Otherwise the camera is the controlled side.
 */
export function viewTileVisible(state: MatchState, tx: number, ty: number): boolean {
  if (state.bothCam) return anySideBit(state, tx, ty, false, true)
  if (state.enemyCam) return anySideBit(state, tx, ty, true, true)
  if (state.fogCleared) return onMap(state, tx, ty)
  return sideTileVisible(state, controlledSide(state), tx, ty)
}

/**
 * A world sound is heard only on a tile the human can see right now.
 * Black fog and the gray shroud are silent. Fog of War off and all cams open the whole map.
 * Enemy cam does not: it changes the picture, not this side's ears.
 */
export function playerHearsAt(state: MatchState, x: number, y: number): boolean {
  if (state.fogCleared || state.bothCam) return true
  return sideTileVisible(state, controlledSide(state), Math.floor(x / TILE), Math.floor(y / TILE))
}

export function viewTileExplored(state: MatchState, tx: number, ty: number): boolean {
  if (state.bothCam) return anySideBit(state, tx, ty, false, false)
  if (state.enemyCam) return anySideBit(state, tx, ty, true, false)
  if (state.fogCleared) return onMap(state, tx, ty)
  return sideTileExplored(state, controlledSide(state), tx, ty)
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

/** True when this camera includes that side, so the side still sees its own cloaked Flies. */
export function viewerOwns(state: MatchState, owner: PlayerId): boolean {
  if (state.bothCam) return true
  if (state.enemyCam) return owner !== 0
  return owner === controlledSide(state)
}

export function viewUnitSeen(state: MatchState, unit: Unit): boolean {
  if (unit.frozen != null) return false
  if (unit.cloak > 0 && !viewerOwns(state, unit.owner)) return false
  if (!state.bothCam && !state.enemyCam && unit.owner === controlledSide(state)) return true
  if (!state.bothCam && state.enemyCam && unit.owner !== 0) return true
  return viewTileVisible(state, Math.floor(unit.x / TILE), Math.floor(unit.y / TILE))
}

export function viewBuildingSeen(state: MatchState, building: Building): boolean {
  if (building.ruined) return viewRuinShown(state, building)
  if (!state.bothCam && !state.enemyCam && building.owner === controlledSide(state)) return true
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
  if (unit.frozen != null) return false
  if (unit.cloak > 0 && unit.owner !== 0) return false
  if (unit.owner === 0) return true
  return tileVisible(state, Math.floor(unit.x / TILE), Math.floor(unit.y / TILE))
}

function paintSight(state: MatchState, owner: PlayerId, visible: Uint8Array, explored: Uint8Array): void {
  for (const unit of state.units) {
    if (unit.owner !== owner || unit.hp <= 0 || unit.frozen != null) continue
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

function cryoHeld(state: MatchState, buildingId: number): number {
  let count = 0
  for (const unit of state.units) {
    if (unit.frozen === buildingId && unit.hp > 0) count += 1
  }
  return count
}

function takeSighting(state: MatchState, building: Building): BuildingSighting {
  const stats = BUILDING_STATS[building.kind]
  const job = building.queue[0]
  return {
    id: building.id,
    x: (building.tx + stats.w / 2) * TILE,
    y: (building.ty + stats.h / 2) * TILE,
    kind: building.kind,
    owner: building.owner,
    tx: building.tx,
    ty: building.ty,
    hp: building.hp,
    stock: building.stock,
    progress: building.progress,
    complete: building.complete,
    ruined: building.ruined,
    cryo: building.cryo,
    held: building.cryo ? cryoHeld(state, building.id) : 0,
    hatch: building.hatch,
    dish: building.dish,
    jobKind: job?.kind,
    jobLeft: job?.remaining,
    jobTotal: job?.total,
  }
}

function ownerSeesTiles(state: MatchState, owner: PlayerId, tx: number, ty: number, w: number, h: number): boolean {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (sideTileVisible(state, owner, tx + x, ty + y)) return true
    }
  }
  return false
}

/** The footprint this side would have to look at before a remembered building can be dropped. */
function footprintCurrentlySeen(
  state: MatchState,
  owner: PlayerId,
  spot: BuildingSighting,
  building: Building | undefined,
): boolean {
  if (spot.kind && spot.tx != null && spot.ty != null) {
    const stats = BUILDING_STATS[spot.kind]
    return ownerSeesTiles(state, owner, spot.tx, spot.ty, stats.w, stats.h)
  }
  if (building) {
    const stats = BUILDING_STATS[building.kind]
    return ownerSeesTiles(state, owner, building.tx, building.ty, stats.w, stats.h)
  }
  return sideTileVisible(state, owner, Math.floor(spot.x / TILE), Math.floor(spot.y / TILE))
}

function rememberSightings(state: MatchState): void {
  for (let owner = 0; owner < state.playerCount; owner++) {
    const spots = state.sideSpotted[owner]
    if (!spots) continue
    for (const building of state.buildings) {
      if (building.owner === owner || building.hp <= 0 || building.ruined) continue
      if (!ownerSeesBuilding(state, owner, building)) continue
      const next = takeSighting(state, building)
      const known = spots.find((spot) => spot.id === building.id)
      if (known) Object.assign(known, next)
      else spots.push(next)
    }
    for (let i = spots.length - 1; i >= 0; i--) {
      const spot = spots[i]
      if (!spot) continue
      const building = state.buildings.find((entry) => entry.id === spot.id)
      if (!footprintCurrentlySeen(state, owner, spot, building)) continue
      const gone = !building || building.hp <= 0 || building.owner === owner || building.ruined
      if (gone) spots.splice(i, 1)
    }
  }
  if (state.selectedGhost != null && !viewMemories(state).some((spot) => spot.id === state.selectedGhost)) {
    state.selectedGhost = null
  }
}

function viewOwners(state: MatchState): PlayerId[] {
  const owners: PlayerId[] = []
  if (state.bothCam) {
    for (let owner = 0; owner < state.playerCount; owner++) owners.push(owner)
  } else if (state.enemyCam) {
    for (let owner = 1; owner < state.playerCount; owner++) owners.push(owner)
  } else owners.push(controlledSide(state))
  return owners
}

function memoryInShroud(state: MatchState, spot: BuildingSighting): boolean {
  if (!spot.kind || spot.tx == null || spot.ty == null) return false
  const stats = BUILDING_STATS[spot.kind]
  let explored = false
  let visible = false
  for (let y = 0; y < stats.h; y++) {
    for (let x = 0; x < stats.w; x++) {
      if (viewTileVisible(state, spot.tx + x, spot.ty + y)) visible = true
      if (viewTileExplored(state, spot.tx + x, spot.ty + y)) explored = true
    }
  }
  return explored && !visible
}

/** Enemy buildings this camera remembers but cannot see right now. Units are never included. */
export function viewMemories(state: MatchState): BuildingSighting[] {
  const list: BuildingSighting[] = []
  const seen = new Set<number>()
  for (const owner of viewOwners(state)) {
    for (const spot of state.sideSpotted[owner] ?? []) {
      if (seen.has(spot.id) || !memoryInShroud(state, spot)) continue
      seen.add(spot.id)
      list.push(spot)
    }
  }
  return list
}

/**
 * What this side still believes about a sighting.
 * A snapshot stands in for a building that fell while the footprint was hidden.
 * A note with no snapshot still requires the live building.
 */
export function rememberedBuilding(
  state: MatchState,
  owner: PlayerId,
  spot: BuildingSighting,
): { id: number; x: number; y: number; kind: BuildingKind; complete: boolean } | null {
  if (spot.kind) {
    if (spot.ruined || spot.owner === owner) return null
    if (spot.hp != null && spot.hp <= 0) return null
    return {
      id: spot.id,
      x: spot.x,
      y: spot.y,
      kind: spot.kind,
      complete: spot.complete !== false,
    }
  }
  const building = state.buildings.find((entry) => entry.id === spot.id && entry.hp > 0 && !entry.ruined && entry.owner !== owner)
  if (!building) return null
  return { id: building.id, x: spot.x, y: spot.y, kind: building.kind, complete: building.complete }
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
