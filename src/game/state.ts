import { spawnAnimals } from './animals'
import { localOwner } from './mpRole'
import { generateBattlefield, pickFfaSites, pickKeepSites, workerCamp } from './map'
import { yardEntrance } from './factoryArt'
import { keepEntrance } from './siloArt'
import { updateVision } from './vision'
import {
  BUILDING_STATS,
  FFA_MAP_H,
  FFA_MAP_W,
  MAP_H,
  MAP_W,
  ORE_NODE_AMOUNT,
  ROCK_HP,
  STARTING_ORE,
  SUPPLY_MAX,
  TILE,
  TREE_HP,
  UNIT_STATS,
  type Building,
  type BuildingKind,
  type MatchMode,
  type MatchState,
  type PlayerId,
  type Rock,
  type Target,
  type TargetKind,
  type Unit,
  type UnitKind,
} from './types'

export function tileIndex(tx: number, ty: number, mapW = MAP_W): number {
  return ty * mapW + tx
}

export function isWalkable(state: MatchState, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= state.mapW || ty >= state.mapH) return false
  return state.blocked[tileIndex(tx, ty, state.mapW)] === 0
}

export function rebuildBlocked(state: MatchState): void {
  state.blocked.set(state.tiles)
  for (const node of state.ore) {
    if (node.amount > 0) state.blocked[tileIndex(node.tx, node.ty, state.mapW)] = 1
  }
  for (const building of state.buildings) {
    if (building.hp <= 0 && !building.ruined) continue
    const stats = BUILDING_STATS[building.kind]
    for (let y = 0; y < stats.h; y++) {
      for (let x = 0; x < stats.w; x++) {
        state.blocked[tileIndex(building.tx + x, building.ty + y, state.mapW)] = 1
      }
    }
  }
}

export function recomputeSupply(state: MatchState): void {
  const used = Array.from({ length: state.playerCount }, () => 0)
  const cap = Array.from({ length: state.playerCount }, () => 0)
  for (const unit of state.units) {
    if (unit.hp <= 0) continue
    used[unit.owner] = (used[unit.owner] ?? 0) + UNIT_STATS[unit.kind].supply
  }
  for (const building of state.buildings) {
    if (building.hp <= 0) continue
    if (building.complete) cap[building.owner] = (cap[building.owner] ?? 0) + BUILDING_STATS[building.kind].supply
    for (const job of building.queue) used[building.owner] = (used[building.owner] ?? 0) + UNIT_STATS[job.kind].supply
  }
  state.supplyUsed = used
  state.supplyCap = cap.map((value) => Math.min(SUPPLY_MAX, value))
}

export function pushToast(state: MatchState, text: string): void {
  state.toasts.push({ text, life: 3.5 })
  if (state.toasts.length > 4) state.toasts.shift()
}

export function unitById(state: MatchState, id: number): Unit | undefined {
  return state.units.find((unit) => unit.id === id)
}

export function buildingById(state: MatchState, id: number): Building | undefined {
  return state.buildings.find((building) => building.id === id)
}

export function rockById(state: MatchState, id: number): Rock | undefined {
  return state.rocks.find((rock) => rock.id === id)
}

export function rockAt(state: MatchState, tx: number, ty: number): Rock | undefined {
  return state.rocks.find((rock) => rock.tx === tx && rock.ty === ty && rock.hp > 0)
}

export function buildingRect(building: Building): { x: number; y: number; w: number; h: number } {
  const stats = BUILDING_STATS[building.kind]
  return {
    x: building.tx * TILE,
    y: building.ty * TILE,
    w: stats.w * TILE,
    h: stats.h * TILE,
  }
}

export function buildingCenter(building: Building): { x: number; y: number } {
  const rect = buildingRect(building)
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}

export function distToRect(
  px: number,
  py: number,
  rect: { x: number; y: number; w: number; h: number },
): number {
  const cx = Math.max(rect.x, Math.min(px, rect.x + rect.w))
  const cy = Math.max(rect.y, Math.min(py, rect.y + rect.h))
  return Math.hypot(px - cx, py - cy)
}

export function unitTarget(unit: Unit): Target {
  const stats = UNIT_STATS[unit.kind]
  return {
    id: unit.id,
    owner: unit.owner,
    x: unit.x,
    y: unit.y,
    radius: stats.radius,
    hp: unit.hp,
    targetKind: 'unit',
    unitKind: unit.kind,
    cloaked: unit.cloak > 0,
  }
}

export function buildingTarget(building: Building): Target {
  const stats = BUILDING_STATS[building.kind]
  const center = buildingCenter(building)
  return {
    id: building.id,
    owner: building.owner,
    x: center.x,
    y: center.y,
    radius: (Math.min(stats.w, stats.h) * TILE) / 2,
    hp: building.hp,
    targetKind: 'building',
  }
}

export function rockTarget(rock: Rock): Target {
  return {
    id: rock.id,
    owner: 0,
    x: (rock.tx + 0.5) * TILE,
    y: (rock.ty + 0.5) * TILE,
    radius: 12,
    hp: rock.hp,
    targetKind: 'rock',
  }
}

export function getTarget(state: MatchState, id: number, kind: TargetKind): Target | null {
  if (kind === 'unit') {
    const unit = unitById(state, id)
    if (!unit || unit.hp <= 0) return null
    return unitTarget(unit)
  }
  if (kind === 'rock') {
    const rock = rockById(state, id)
    if (!rock || rock.hp <= 0) return null
    return rockTarget(rock)
  }
  const building = buildingById(state, id)
  if (!building || building.hp <= 0) return null
  return buildingTarget(building)
}

/** True when a footprint's center lies inside the sight circle of a Castle at this tile. */
export function footprintInKeepSight(
  keepTx: number,
  keepTy: number,
  tx: number,
  ty: number,
  w: number,
  h: number,
): boolean {
  const kx = (keepTx + BUILDING_STATS.keep.w / 2) * TILE
  const ky = (keepTy + BUILDING_STATS.keep.h / 2) * TILE
  const x = (tx + w / 2) * TILE
  const y = (ty + h / 2) * TILE
  return Math.hypot(x - kx, y - ky) <= BUILDING_STATS.keep.sight + 0.5
}

/** Empty cells required between Pillar footprints. */
export const PILLAR_GAP = 2

/** Terrain check plus the Tower rules: Silo sight, and two empty cells from every other Pillar. */
export function placementAllowed(
  state: MatchState,
  owner: PlayerId,
  kind: BuildingKind,
  tx: number,
  ty: number,
): boolean {
  if (!canPlace(state, kind, tx, ty)) return false
  if (kind !== 'tower') return true
  if (!pillarsClear(state, tx, ty)) return false
  const keep = state.buildings.find((building) => building.owner === owner && building.kind === 'keep' && building.hp > 0)
  if (!keep) return false
  const stats = BUILDING_STATS.tower
  return footprintInKeepSight(keep.tx, keep.ty, tx, ty, stats.w, stats.h)
}

/** True when this Pillar footprint leaves at least two empty cells around every other Pillar. */
export function pillarsClear(state: MatchState, tx: number, ty: number): boolean {
  const stats = BUILDING_STATS.tower
  for (const building of state.buildings) {
    if (building.kind !== 'tower' || building.hp <= 0) continue
    if (emptyCellsBetween(tx, ty, stats.w, stats.h, building.tx, building.ty, stats.w, stats.h) < PILLAR_GAP) return false
  }
  return true
}

/** Chebyshev count of open cells between two footprints. Negative when they overlap. */
function emptyCellsBetween(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): number {
  const gapX = ax + aw <= bx ? bx - (ax + aw) : bx + bw <= ax ? ax - (bx + bw) : -1
  const gapY = ay + ah <= by ? by - (ay + ah) : by + bh <= ay ? ay - (by + bh) : -1
  return Math.max(gapX, gapY)
}

function castlePatchOwner(
  camps: Array<{ owner: PlayerId; tx: number; ty: number }>,
  tx: number,
  ty: number,
): PlayerId | null {
  const x = (tx + 0.5) * TILE
  const y = (ty + 0.5) * TILE
  const sight = BUILDING_STATS.keep.sight
  for (const camp of camps) {
    const cx = (camp.tx + BUILDING_STATS.keep.w / 2) * TILE
    const cy = (camp.ty + BUILDING_STATS.keep.h / 2) * TILE
    if (Math.hypot(x - cx, y - cy) <= sight + 0.5) return camp.owner
  }
  return null
}

export function canPlace(state: MatchState, kind: BuildingKind, tx: number, ty: number): boolean {
  const stats = BUILDING_STATS[kind]
  if (tx < 0 || ty < 0 || tx + stats.w > state.mapW || ty + stats.h > state.mapH) return false
  for (let y = 0; y < stats.h; y++) {
    for (let x = 0; x < stats.w; x++) {
      if (state.blocked[tileIndex(tx + x, ty + y, state.mapW)]) return false
    }
  }
  return true
}

export function makeUnit(
  state: MatchState,
  owner: PlayerId,
  kind: UnitKind,
  x: number,
  y: number,
): Unit {
  const unit: Unit = {
    id: state.nextId++,
    owner,
    kind,
    x,
    y,
    hp: UNIT_STATS[kind].hp,
    facing: owner === 0 ? -Math.PI / 2 : Math.PI / 2,
    anim: Math.random() * 4,
    order: null,
    path: [],
    goalX: null,
    goalY: null,
    attackCd: 0,
    hurtTimer: 0,
    hitFlash: 0,
    cargo: 0,
    gatherTimer: 0,
    stuckT: 0,
    stuckOrderT: 0,
    stuckX: x,
    stuckY: y,
    avoidNode: -1,
    avoidUntil: 0,
    leashX: null,
    leashY: null,
    idleAcquire: false,
    nodeMemory: -1,
    repathIn: 0,
    scanning: false,
    cloak: 0,
    age: 0,
  }
  state.units.push(unit)
  return unit
}

export function makeBuilding(
  state: MatchState,
  owner: PlayerId,
  kind: BuildingKind,
  tx: number,
  ty: number,
  complete: boolean,
): Building {
  const stats = BUILDING_STATS[kind]
  const mouth = kind === 'keep' ? keepEntrance({ tx, ty }) : kind === 'yard' ? yardEntrance({ tx, ty }) : null
  const building: Building = {
    id: state.nextId++,
    owner,
    kind,
    tx,
    ty,
    hp: stats.hp,
    progress: complete ? 1 : 0,
    complete,
    queue: [],
    rallyX: mouth ? mouth.x : (tx + stats.w / 2) * TILE,
    rallyY: mouth ? mouth.y : (ty + stats.h) * TILE + 18,
    hitFlash: 0,
    spawnN: 0,
    hatch: 0,
    dish: owner * 1.1,
    attackCd: 0,
    alert: 0,
    focusId: null,
    focusKind: null,
    stock: 0,
    struckBy: null,
    dropDumps: false,
    ruined: false,
    repairPaid: false,
  }
  state.buildings.push(building)
  return building
}

export function createMatch(seed: number, mode: MatchMode = 'duel'): MatchState {
  const duel = mode === 'duel'
  const mapW = duel ? MAP_W : FFA_MAP_W
  const mapH = duel ? MAP_H : FFA_MAP_H
  const playerCount = duel ? 2 : 4
  const sites = duel
    ? [pickKeepSites(seed, mapW, mapH).player, pickKeepSites(seed, mapW, mapH).enemy]
    : pickFfaSites(seed, mapW, mapH)
  const field = generateBattlefield(seed, sites, mapW, mapH)
  const cells = mapW * mapH
  const explored = new Uint8Array(cells)
  const visible = new Uint8Array(cells)
  const aiExplored = new Uint8Array(cells)
  const aiVisible = new Uint8Array(cells)
  const playerSpotted: Array<{ id: number; x: number; y: number }> = []
  const aiSpotted: Array<{ id: number; x: number; y: number }> = []
  const sideExplored = [explored, aiExplored]
  const sideVisible = [visible, aiVisible]
  const sideSpotted = [playerSpotted, aiSpotted]
  for (let owner = 2; owner < playerCount; owner++) {
    sideExplored.push(new Uint8Array(cells))
    sideVisible.push(new Uint8Array(cells))
    sideSpotted.push([])
  }
  const state: MatchState = {
    seed,
    mode,
    playerCount,
    mapW,
    mapH,
    eliminated: Array.from({ length: playerCount }, () => false),
    tiles: field.tiles,
    blocked: new Uint8Array(cells),
    explored,
    visible,
    seenAt: new Float32Array(cells),
    aiExplored,
    aiVisible,
    sideExplored,
    sideVisible,
    sideSpotted,
    aiSpotted,
    playerSpotted,
    aiScout: 0,
    playerAiScout: 0,
    fogCleared: false,
    enemyCam: false,
    bothCam: false,
    godMode: false,
    aiControl: false,
    ore: [],
    rocks: [],
    graves: [],
    animals: [],
    units: [],
    buildings: [],
    projectiles: [],
    particles: [],
    pings: [],
    toasts: [],
    nextId: 1,
    oreHeld: Array.from({ length: playerCount }, () => STARTING_ORE),
    supplyUsed: Array.from({ length: playerCount }, () => 0),
    supplyCap: Array.from({ length: playerCount }, () => 0),
    time: 0,
    paused: false,
    speed: 1,
    outcome: null,
    selectedUnits: [],
    selectedBuilding: null,
    selectedOre: null,
    selectedGrave: null,
    placement: null,
    attackMoveArmed: false,
    moveArmed: false,
    aiAcc: 0,
    aiAttacking: false,
    aiNext: 'pike',
    sideAcc: Array.from({ length: playerCount }, () => 0),
    sideAttacking: Array.from({ length: playerCount }, () => false),
    sideNext: Array.from({ length: playerCount }, () => 'pike' as const),
    sideScout: Array.from({ length: playerCount }, () => 0),
    playerAiAcc: 0,
    playerAiAttacking: false,
    playerAiNext: 'pike',
    underAttackCd: 0,
    events: [],
    tutorial: true,
  }

  const campsByOwner: Array<{ owner: PlayerId; tx: number; ty: number }> = sites.map((site, owner) => ({
    owner,
    tx: site.tx,
    ty: site.ty,
  }))
  for (const spot of field.ore) {
    state.ore.push({
      id: state.nextId++,
      tx: spot.tx,
      ty: spot.ty,
      amount: ORE_NODE_AMOUNT,
      base: castlePatchOwner(campsByOwner, spot.tx, spot.ty),
    })
  }

  for (let ty = 0; ty < mapH; ty++) {
    for (let tx = 0; tx < mapW; tx++) {
      const tile = field.tiles[tileIndex(tx, ty, mapW)]
      if (tile !== 1 && tile !== 3) continue
      state.rocks.push({
        id: state.nextId++,
        tx,
        ty,
        hp: tile === 3 ? TREE_HP : ROCK_HP,
        hitFlash: 0,
        kind: tile === 3 ? 'tree' : 'rock',
      })
    }
  }

  const keeps = sites.map((site, owner) => makeBuilding(state, owner, 'keep', site.tx, site.ty, true))
  for (let owner = 0; owner < sites.length; owner++) {
    const site = sites[owner]
    const keep = keeps[owner]
    if (!site || !keep) continue
    const aim = aimSite(site, sites)
    aimRally(keep)
    for (const [tx, ty] of workerCamp(site, aim, field.ore, mapW, mapH)) {
      const unit = makeUnit(state, owner, 'porter', (tx + 0.5) * TILE, (ty + 0.5) * TILE)
      const dx = (aim.tx + 1.5) * TILE - unit.x
      const dy = (aim.ty + 1.5) * TILE - unit.y
      unit.facing = Math.atan2(dy, dx)
    }
  }

  rebuildBlocked(state)
  recomputeSupply(state)
  updateVision(state)
  spawnAnimals(state)
  return state
}

function aimSite(site: { tx: number; ty: number }, sites: Array<{ tx: number; ty: number }>): { tx: number; ty: number } {
  let x = 0
  let y = 0
  let n = 0
  for (const other of sites) {
    if (other.tx === site.tx && other.ty === site.ty) continue
    x += other.tx
    y += other.ty
    n += 1
  }
  if (n === 0) return { tx: site.tx + 1, ty: site.ty - 1 }
  return { tx: x / n, ty: y / n }
}

function aimRally(building: Building): void {
  const mouth = keepEntrance(building)
  building.rallyX = mouth.x
  building.rallyY = mouth.y
}

export function playerKeep(state: MatchState): Building | undefined {
  const owner = localOwner()
  return state.buildings.find((building) => building.owner === owner && building.kind === 'keep' && building.hp > 0)
}

export function nearestOre(state: MatchState, x: number, y: number): { id: number; tx: number; ty: number } | null {
  let best: { id: number; tx: number; ty: number } | null = null
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
