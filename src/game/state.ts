import { generateBattlefield, pickKeepSites, workerCamp } from './map'
import { updateVision } from './vision'
import {
  BUILDING_STATS,
  MAP_H,
  MAP_W,
  ORE_NODE_AMOUNT,
  ROCK_HP,
  STARTING_ORE,
  SUPPLY_MAX,
  TILE,
  UNIT_STATS,
  type Building,
  type BuildingKind,
  type MatchState,
  type PlayerId,
  type Rock,
  type Target,
  type TargetKind,
  type Unit,
  type UnitKind,
} from './types'

export function tileIndex(tx: number, ty: number): number {
  return ty * MAP_W + tx
}

export function isWalkable(state: MatchState, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false
  return state.blocked[tileIndex(tx, ty)] === 0
}

export function rebuildBlocked(state: MatchState): void {
  state.blocked.set(state.tiles)
  for (const node of state.ore) {
    if (node.amount > 0) state.blocked[tileIndex(node.tx, node.ty)] = 1
  }
  for (const building of state.buildings) {
    if (building.hp <= 0) continue
    const stats = BUILDING_STATS[building.kind]
    for (let y = 0; y < stats.h; y++) {
      for (let x = 0; x < stats.w; x++) {
        state.blocked[tileIndex(building.tx + x, building.ty + y)] = 1
      }
    }
  }
}

export function recomputeSupply(state: MatchState): void {
  const used: [number, number] = [0, 0]
  const cap: [number, number] = [0, 0]
  for (const unit of state.units) {
    if (unit.hp <= 0) continue
    used[unit.owner] += UNIT_STATS[unit.kind].supply
  }
  for (const building of state.buildings) {
    if (building.hp <= 0) continue
    if (building.complete) cap[building.owner] += BUILDING_STATS[building.kind].supply
    for (const job of building.queue) used[building.owner] += UNIT_STATS[job.kind].supply
  }
  state.supplyUsed = used
  state.supplyCap = [Math.min(SUPPLY_MAX, cap[0]), Math.min(SUPPLY_MAX, cap[1])]
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

export function canPlace(state: MatchState, kind: BuildingKind, tx: number, ty: number): boolean {
  const stats = BUILDING_STATS[kind]
  if (tx < 0 || ty < 0 || tx + stats.w > MAP_W || ty + stats.h > MAP_H) return false
  for (let y = 0; y < stats.h; y++) {
    for (let x = 0; x < stats.w; x++) {
      if (state.blocked[tileIndex(tx + x, ty + y)]) return false
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
    rallyX: (tx + stats.w / 2) * TILE,
    rallyY: (ty + stats.h) * TILE + 18,
    hitFlash: 0,
    spawnN: 0,
  }
  state.buildings.push(building)
  return building
}

export function createMatch(seed: number): MatchState {
  const camps = pickKeepSites(seed)
  const field = generateBattlefield(seed, camps.player, camps.enemy)
  const state: MatchState = {
    seed,
    tiles: field.tiles,
    blocked: new Uint8Array(MAP_W * MAP_H),
    explored: new Uint8Array(MAP_W * MAP_H),
    visible: new Uint8Array(MAP_W * MAP_H),
    aiExplored: new Uint8Array(MAP_W * MAP_H),
    aiVisible: new Uint8Array(MAP_W * MAP_H),
    aiSpotted: [],
    playerSpotted: [],
    aiScout: 0,
    playerAiScout: 0,
    fogCleared: false,
    enemyCam: false,
    bothCam: false,
    godMode: false,
    aiControl: false,
    ore: [],
    rocks: [],
    units: [],
    buildings: [],
    projectiles: [],
    particles: [],
    pings: [],
    toasts: [],
    nextId: 1,
    oreHeld: [STARTING_ORE, STARTING_ORE],
    supplyUsed: [0, 0],
    supplyCap: [0, 0],
    time: 0,
    paused: false,
    outcome: null,
    selectedUnits: [],
    selectedBuilding: null,
    selectedOre: null,
    placement: null,
    attackMoveArmed: false,
    moveArmed: false,
    aiAcc: 0,
    aiAttacking: false,
    aiNext: 'pike',
    playerAiAcc: 0,
    playerAiAttacking: false,
    playerAiNext: 'pike',
    underAttackCd: 0,
    events: [],
    tutorial: true,
  }

  for (const spot of field.ore) {
    state.ore.push({
      id: state.nextId++,
      tx: spot.tx,
      ty: spot.ty,
      amount: ORE_NODE_AMOUNT,
    })
  }

  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const tile = field.tiles[tileIndex(tx, ty)]
      if (tile !== 1 && tile !== 3) continue
      state.rocks.push({
        id: state.nextId++,
        tx,
        ty,
        hp: ROCK_HP,
        hitFlash: 0,
        kind: tile === 3 ? 'tree' : 'rock',
      })
    }
  }

  const homeKeep = makeBuilding(state, 0, 'keep', camps.player.tx, camps.player.ty, true)
  const enemyKeep = makeBuilding(state, 1, 'keep', camps.enemy.tx, camps.enemy.ty, true)
  aimRally(homeKeep, camps.enemy)
  aimRally(enemyKeep, camps.player)

  for (const [tx, ty] of workerCamp(camps.player, camps.enemy, field.ore)) {
    makeUnit(state, 0, 'porter', (tx + 0.5) * TILE, (ty + 0.5) * TILE)
  }
  for (const [tx, ty] of workerCamp(camps.enemy, camps.player, field.ore)) {
    makeUnit(state, 1, 'porter', (tx + 0.5) * TILE, (ty + 0.5) * TILE)
  }

  rebuildBlocked(state)
  recomputeSupply(state)
  updateVision(state)
  return state
}

function aimRally(building: Building, toward: { tx: number; ty: number }): void {
  const stats = BUILDING_STATS[building.kind]
  const x = (building.tx + stats.w / 2) * TILE
  const y = (building.ty + stats.h / 2) * TILE
  const dx = (toward.tx + stats.w / 2) * TILE - x
  const dy = (toward.ty + stats.h / 2) * TILE - y
  const length = Math.hypot(dx, dy) || 1
  building.rallyX = x + (dx / length) * 78
  building.rallyY = y + (dy / length) * 78
}

export function playerKeep(state: MatchState): Building | undefined {
  return state.buildings.find((building) => building.owner === 0 && building.kind === 'keep' && building.hp > 0)
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
