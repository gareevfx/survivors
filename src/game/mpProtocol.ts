import {
  commandAttack,
  commandConstruct,
  commandGather,
  commandHarvestOrAttack,
  commandHoverGrid,
  commandMove,
  commandRally,
  commandRepair,
  commandRepairNearest,
  commandStop,
  tryPlace,
  tryTrain,
  cancelBuilding,
  cancelTrain,
} from './commands'
import { asHost, type NetCmd } from './mpLink'
import { mp } from './mpRole'
import { toggleScanner } from './scanner'
import { buildingById, unitById } from './state'
import type {
  Animal,
  AnimalKind,
  Building,
  BuildingKind,
  GameEvent,
  MatchState,
  Order,
  Projectile,
  TargetKind,
  Unit,
  UnitKind,
} from './types'

const SNAP_HZ = 12

export interface UnitSnap {
  id: number
  owner: number
  kind: UnitKind
  x: number
  y: number
  hp: number
  facing: number
  order: Order | null
  cargo: number
  scanning: boolean
  cloak: number
  age: number
  hitFlash: number
}

export interface BuildingSnap {
  id: number
  owner: number
  kind: BuildingKind
  tx: number
  ty: number
  hp: number
  progress: number
  complete: boolean
  queue: Array<{ kind: UnitKind; remaining: number; total: number }>
  rallyX: number
  rallyY: number
  hitFlash: number
  hatch: number
  dish: number
  alert: number
  stock: number
  ruined: boolean
  repairPaid: boolean
}

export interface ProjectileSnap {
  id: number
  owner: number
  sourceId: number
  x: number
  y: number
  targetId: number
  targetKind: TargetKind
  damage: number
  speed: number
  radius: number
  life: number
}

export interface AnimalSnap {
  kind: AnimalKind
  x: number
  y: number
  facing: number
  goalX: number
  goalY: number
  orbitX: number
  orbitY: number
  orbitR: number
  phase: number
  turn: number
}

export interface Snapshot {
  v: 1
  mapW: number
  mapH: number
  time: number
  nextId: number
  outcome: 'win' | 'lose' | null
  eliminated: boolean[]
  oreHeld: number[]
  supplyUsed: number[]
  supplyCap: number[]
  explored: string
  visible: string
  aiExplored: string
  aiVisible: string
  units: UnitSnap[]
  buildings: BuildingSnap[]
  projectiles: ProjectileSnap[]
  rocks: Array<{ id: number; tx: number; ty: number; hp: number; hitFlash: number; kind: 'rock' | 'tree' }>
  ore: Array<{ id: number; tx: number; ty: number; amount: number; base: number | null }>
  graves: Array<{ id: number; tx: number; ty: number }>
  animals: AnimalSnap[]
  events: GameEvent[]
}

interface Slide {
  x0: number
  y0: number
  x1: number
  y1: number
}

const unitSlides = new Map<number, Slide>()
const shotSlides = new Map<number, Slide>()
let animalSlides: Slide[] = []
let blend = 1

export function resetInterp(): void {
  unitSlides.clear()
  shotSlides.clear()
  animalSlides = []
  blend = 1
}

export function captureSnapshot(state: MatchState, events: GameEvent[] = []): Snapshot {
  return {
    v: 1,
    mapW: state.mapW,
    mapH: state.mapH,
    time: state.time,
    nextId: state.nextId,
    outcome: state.outcome,
    eliminated: state.eliminated.slice(),
    oreHeld: state.oreHeld.slice(),
    supplyUsed: state.supplyUsed.slice(),
    supplyCap: state.supplyCap.slice(),
    explored: encodeBytes(state.explored),
    visible: encodeBytes(state.visible),
    aiExplored: encodeBytes(state.aiExplored),
    aiVisible: encodeBytes(state.aiVisible),
    units: state.units
      .filter((unit) => unit.hp > 0)
      .map((unit) => ({
        id: unit.id,
        owner: unit.owner,
        kind: unit.kind,
        x: unit.x,
        y: unit.y,
        hp: unit.hp,
        facing: unit.facing,
        order: unit.order ? clone<Order>(unit.order) : null,
        cargo: unit.cargo,
        scanning: unit.scanning,
        cloak: unit.cloak,
        age: unit.age,
        hitFlash: unit.hitFlash,
      })),
    buildings: state.buildings
      .filter((building) => building.hp > 0 || building.ruined)
      .map((building) => ({
        id: building.id,
        owner: building.owner,
        kind: building.kind,
        tx: building.tx,
        ty: building.ty,
        hp: building.hp,
        progress: building.progress,
        complete: building.complete,
        queue: building.queue.map((job) => ({ kind: job.kind, remaining: job.remaining, total: job.total })),
        rallyX: building.rallyX,
        rallyY: building.rallyY,
        hitFlash: building.hitFlash,
        hatch: building.hatch,
        dish: building.dish,
        alert: building.alert,
        stock: building.stock,
        ruined: building.ruined,
        repairPaid: building.repairPaid,
      })),
    projectiles: state.projectiles.map((shot) => ({
      id: shot.id,
      owner: shot.owner,
      sourceId: shot.sourceId,
      x: shot.x,
      y: shot.y,
      targetId: shot.targetId,
      targetKind: shot.targetKind,
      damage: shot.damage,
      speed: shot.speed,
      radius: shot.radius,
      life: shot.life,
    })),
    rocks: state.rocks
      .filter((rock) => rock.hp > 0)
      .map((rock) => ({
        id: rock.id,
        tx: rock.tx,
        ty: rock.ty,
        hp: rock.hp,
        hitFlash: rock.hitFlash,
        kind: rock.kind === 'tree' ? 'tree' : 'rock',
      })),
    ore: state.ore.map((node) => ({
      id: node.id,
      tx: node.tx,
      ty: node.ty,
      amount: node.amount,
      base: node.base ?? null,
    })),
    graves: state.graves.map((grave) => ({ id: grave.id, tx: grave.tx, ty: grave.ty })),
    animals: state.animals.map((animal) => ({
      kind: animal.kind,
      x: animal.x,
      y: animal.y,
      facing: animal.facing,
      goalX: animal.goalX,
      goalY: animal.goalY,
      orbitX: animal.orbitX,
      orbitY: animal.orbitY,
      orbitR: animal.orbitR,
      phase: animal.phase,
      turn: animal.turn,
    })),
    events: events.slice(0, 32),
  }
}

/** Copy a host snapshot onto the guest. Selection, camera, and placement stay local. */
export function applySnapshot(state: MatchState, snap: Snapshot): void {
  if (snap.mapW !== state.mapW || snap.mapH !== state.mapH) return
  state.time = snap.time
  state.nextId = snap.nextId
  const incoming = snap.outcome
  const next =
    mp.role === 'guest'
      ? incoming === 'win'
        ? 'lose'
        : incoming === 'lose'
          ? 'win'
          : null
      : incoming
  if (state.outcome !== next && (next === 'win' || next === 'lose')) {
    state.events.push({ type: next })
  }
  state.outcome = next
  for (let i = 0; i < state.eliminated.length && i < snap.eliminated.length; i++) {
    state.eliminated[i] = snap.eliminated[i] === true
  }
  copyNumbers(state.oreHeld, snap.oreHeld)
  copyNumbers(state.supplyUsed, snap.supplyUsed)
  copyNumbers(state.supplyCap, snap.supplyCap)
  decodeInto(state.explored, snap.explored)
  decodeInto(state.visible, snap.visible)
  decodeInto(state.aiExplored, snap.aiExplored)
  decodeInto(state.aiVisible, snap.aiVisible)

  const nextUnits: Unit[] = []
  for (const data of snap.units) {
    if (!isUnitKind(data.kind)) continue
    const unit = state.units.find((entry) => entry.id === data.id) ?? blankUnit(data)
    unit.owner = data.owner
    unit.kind = data.kind
    unit.x = data.x
    unit.y = data.y
    unit.hp = data.hp
    unit.facing = data.facing
    unit.order = data.order ? clone<Order>(data.order) : null
    unit.cargo = data.cargo
    unit.scanning = data.scanning
    unit.cloak = data.cloak
    unit.age = data.age
    unit.hitFlash = data.hitFlash
    unit.path = []
    unit.goalX = null
    unit.goalY = null
    nextUnits.push(unit)
  }
  state.units = nextUnits

  const nextBuildings: Building[] = []
  for (const data of snap.buildings) {
    if (!isBuildingKind(data.kind)) continue
    const building = state.buildings.find((entry) => entry.id === data.id) ?? blankBuilding(data)
    building.owner = data.owner
    building.kind = data.kind
    building.tx = data.tx
    building.ty = data.ty
    building.hp = data.hp
    building.progress = data.progress
    building.complete = data.complete
    building.queue = data.queue
      .filter((job) => isUnitKind(job.kind))
      .map((job) => ({ kind: job.kind, remaining: job.remaining, total: job.total }))
    building.rallyX = data.rallyX
    building.rallyY = data.rallyY
    building.hitFlash = data.hitFlash
    building.hatch = data.hatch
    building.dish = data.dish
    building.alert = data.alert
    building.stock = data.stock
    building.ruined = data.ruined
    building.repairPaid = data.repairPaid
    nextBuildings.push(building)
  }
  state.buildings = nextBuildings

  const shotIds = new Set<number>()
  const shots: Projectile[] = []
  for (const data of snap.projectiles) {
    if (!isTargetKind(data.targetKind)) continue
    shotIds.add(data.id)
    const prev = state.projectiles.find((shot) => shot.id === data.id)
    shots.push({
      id: data.id,
      owner: data.owner,
      sourceId: data.sourceId,
      x: prev?.x ?? data.x,
      y: prev?.y ?? data.y,
      targetId: data.targetId,
      targetKind: data.targetKind,
      damage: data.damage,
      speed: data.speed,
      radius: data.radius,
      life: data.life,
    })
  }
  state.projectiles = shots

  state.rocks = snap.rocks.map((rock) => ({
    id: rock.id,
    tx: rock.tx,
    ty: rock.ty,
    hp: rock.hp,
    hitFlash: rock.hitFlash,
    kind: rock.kind === 'tree' ? 'tree' : 'rock',
  }))
  state.ore = snap.ore.map((node) => ({
    id: node.id,
    tx: node.tx,
    ty: node.ty,
    amount: node.amount,
    base: node.base,
  }))
  state.graves = snap.graves.map((grave) => ({ id: grave.id, tx: grave.tx, ty: grave.ty }))
  state.animals = snap.animals.map((animal) => animalFrom(animal))
  if (state.nextId < snap.nextId) state.nextId = snap.nextId

  const me = mp.role === 'guest' ? 1 : 0
  state.selectedUnits = state.selectedUnits.filter((id) => {
    const unit = unitById(state, id)
    return !!unit && unit.owner === me && unit.hp > 0
  })
  if (state.selectedBuilding != null) {
    const selected = buildingById(state, state.selectedBuilding)
    if (!selected || (selected.owner !== me && !selected.ruined)) state.selectedBuilding = null
  }
  if (state.selectedOre != null && !state.ore.some((node) => node.id === state.selectedOre && node.amount > 0)) {
    state.selectedOre = null
  }
  if (state.selectedGrave != null && !state.graves.some((grave) => grave.id === state.selectedGrave)) {
    state.selectedGrave = null
  }
  for (const event of snap.events) {
    if (event.type === 'attack' || event.type === 'death' || event.type === 'ready' || event.type === 'build') {
      state.events.push(event)
    }
  }
}

/** Remember where things were, apply the snapshot, then hold the previous picture. */
export function acceptSnapshot(state: MatchState, snap: Snapshot): void {
  armSlides(state, snap)
  applySnapshot(state, snap)
  blend = 0
  writeInterp(state, 0)
}

/** Guest-only. Moves units and shots from the previous snapshot toward the new one. */
export function advanceInterp(state: MatchState, dt: number): void {
  if (mp.role !== 'guest') return
  blend = Math.min(1, blend + dt * SNAP_HZ)
  writeInterp(state, blend)
  for (const unit of state.units) unit.anim += dt * 6
}

/** Smoke helper. `t` is 0 at the previous snapshot and 1 at the new one. */
export function setGuestBlend(state: MatchState, t: number): void {
  blend = Math.max(0, Math.min(1, t))
  writeInterp(state, blend)
}

export function applyNetCmd(state: MatchState, cmd: NetCmd): string | null {
  return asHost(() => applyParsed(state, cmd))
}

export function parseCmd(data: unknown): NetCmd | null {
  if (!data || typeof data !== 'object') return null
  const cmd = data as { op?: unknown }
  if (typeof cmd.op !== 'string') return null
  return data as NetCmd
}

export function parseSnap(data: unknown): Snapshot | null {
  if (!data || typeof data !== 'object') return null
  const snap = data as Partial<Snapshot>
  if (snap.v !== 1 || !Array.isArray(snap.units) || !Array.isArray(snap.buildings)) return null
  if (typeof snap.mapW !== 'number' || typeof snap.mapH !== 'number') return null
  if (typeof snap.explored !== 'string' || typeof snap.visible !== 'string') return null
  if (typeof snap.aiExplored !== 'string' || typeof snap.aiVisible !== 'string') return null
  return data as Snapshot
}

function applyParsed(state: MatchState, cmd: NetCmd): string | null {
  if (cmd.op === 'move') {
    commandMove(state, sideIds(state, cmd.ids), num(cmd.x), num(cmd.y), cmd.attackMove === true)
    return null
  }
  if (cmd.op === 'attack') {
    if (!isTargetKind(cmd.kind)) return null
    commandAttack(state, sideIds(state, cmd.ids), num(cmd.targetId), cmd.kind)
    return null
  }
  if (cmd.op === 'stop') {
    commandStop(state, sideIds(state, cmd.ids))
    return null
  }
  if (cmd.op === 'gather') {
    commandGather(state, sideIds(state, cmd.ids), num(cmd.nodeId))
    return null
  }
  if (cmd.op === 'construct') {
    const building = buildingById(state, num(cmd.buildingId))
    if (!building || building.owner !== 1 || building.complete) return null
    commandConstruct(state, sideIds(state, cmd.ids), building.id)
    return null
  }
  if (cmd.op === 'repair') {
    const building = buildingById(state, num(cmd.buildingId))
    if (!building?.ruined) return null
    return commandRepair(state, sideIds(state, cmd.ids), building.id)
  }
  if (cmd.op === 'repairNearest') return commandRepairNearest(state, sideIds(state, cmd.ids))
  if (cmd.op === 'harvest') {
    commandHarvestOrAttack(state, sideIds(state, cmd.ids), num(cmd.buildingId))
    return null
  }
  if (cmd.op === 'train') {
    const building = buildingById(state, num(cmd.buildingId))
    if (!building || building.owner !== 1) return null
    if (!isUnitKind(cmd.kind)) return null
    return tryTrain(state, building.id, cmd.kind)
  }
  if (cmd.op === 'cancelTrain') {
    const building = buildingById(state, num(cmd.buildingId))
    if (!building || building.owner !== 1) return null
    cancelTrain(state, building.id)
    return null
  }
  if (cmd.op === 'cancelBuild') {
    const building = buildingById(state, num(cmd.buildingId))
    if (!building || building.owner !== 1 || building.complete) return null
    cancelBuilding(state, building.id)
    return null
  }
  if (cmd.op === 'place') {
    if (!isBuildingKind(cmd.kind) || cmd.kind === 'keep') return null
    return tryPlace(state, 1, cmd.kind, num(cmd.tx), num(cmd.ty), sideIds(state, cmd.porters))
  }
  if (cmd.op === 'rally') {
    const building = buildingById(state, num(cmd.buildingId))
    if (!building || building.owner !== 1) return null
    commandRally(state, building.id, num(cmd.x), num(cmd.y))
    return null
  }
  if (cmd.op === 'scan') {
    toggleScanner(state, sideIds(state, cmd.ids), 1)
    return null
  }
  if (cmd.op === 'grid') {
    commandHoverGrid(state, sideIds(state, cmd.ids), 1)
    return null
  }
  return null
}

function sideIds(state: MatchState, ids: unknown): number[] {
  if (!Array.isArray(ids)) return []
  const out: number[] = []
  for (const id of ids) {
    if (typeof id !== 'number' || !Number.isFinite(id)) continue
    const unit = unitById(state, id)
    if (unit && unit.owner === 1 && unit.hp > 0) out.push(id)
  }
  return out
}

function armSlides(state: MatchState, snap: Snapshot): void {
  unitSlides.clear()
  for (const data of snap.units) {
    const prev = state.units.find((unit) => unit.id === data.id)
    unitSlides.set(data.id, {
      x0: prev?.x ?? data.x,
      y0: prev?.y ?? data.y,
      x1: data.x,
      y1: data.y,
    })
  }
  shotSlides.clear()
  for (const data of snap.projectiles) {
    const prev = state.projectiles.find((shot) => shot.id === data.id)
    shotSlides.set(data.id, {
      x0: prev?.x ?? data.x,
      y0: prev?.y ?? data.y,
      x1: data.x,
      y1: data.y,
    })
  }
  animalSlides = snap.animals.map((animal, index) => {
    const prev = state.animals[index]
    return {
      x0: prev?.x ?? animal.x,
      y0: prev?.y ?? animal.y,
      x1: animal.x,
      y1: animal.y,
    }
  })
}

function writeInterp(state: MatchState, t: number): void {
  for (const unit of state.units) {
    const slide = unitSlides.get(unit.id)
    if (!slide) continue
    unit.x = slide.x0 + (slide.x1 - slide.x0) * t
    unit.y = slide.y0 + (slide.y1 - slide.y0) * t
  }
  for (const shot of state.projectiles) {
    const slide = shotSlides.get(shot.id)
    if (!slide) continue
    shot.x = slide.x0 + (slide.x1 - slide.x0) * t
    shot.y = slide.y0 + (slide.y1 - slide.y0) * t
  }
  state.animals.forEach((animal, index) => {
    const slide = animalSlides[index]
    if (!slide) return
    animal.x = slide.x0 + (slide.x1 - slide.x0) * t
    animal.y = slide.y0 + (slide.y1 - slide.y0) * t
  })
}

function blankUnit(data: UnitSnap): Unit {
  return {
    id: data.id,
    owner: data.owner,
    kind: data.kind,
    x: data.x,
    y: data.y,
    hp: data.hp,
    facing: data.facing,
    anim: 0,
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
    stuckX: data.x,
    stuckY: data.y,
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
}

function blankBuilding(data: BuildingSnap): Building {
  return {
    id: data.id,
    owner: data.owner,
    kind: data.kind,
    tx: data.tx,
    ty: data.ty,
    hp: data.hp,
    progress: data.progress,
    complete: data.complete,
    queue: [],
    rallyX: data.rallyX,
    rallyY: data.rallyY,
    hitFlash: 0,
    spawnN: 0,
    hatch: 0,
    dish: 0,
    attackCd: 0,
    alert: 0,
    focusId: null,
    focusKind: null,
    stock: 0,
    struckBy: null,
    dropDumps: false,
    ruined: data.ruined,
    repairPaid: false,
  }
}

function animalFrom(animal: AnimalSnap): Animal {
  return {
    kind: animal.kind,
    x: animal.x,
    y: animal.y,
    facing: animal.facing,
    goalX: animal.goalX,
    goalY: animal.goalY,
    orbitX: animal.orbitX,
    orbitY: animal.orbitY,
    orbitR: animal.orbitR,
    phase: animal.phase,
    turn: animal.turn,
  }
}

function copyNumbers(into: number[], from: number[]): void {
  for (let i = 0; i < into.length && i < from.length; i++) into[i] = from[i] ?? into[i] ?? 0
}

function encodeBytes(bytes: Uint8Array): string {
  let text = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    text += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunk)))
  }
  return btoa(text)
}

function decodeInto(target: Uint8Array, packed: string): void {
  if (typeof packed !== 'string' || !packed) return
  const bin = atob(packed)
  const n = Math.min(target.length, bin.length)
  for (let i = 0; i < n; i++) target[i] = bin.charCodeAt(i) & 255
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isUnitKind(kind: unknown): kind is UnitKind {
  return kind === 'porter' || kind === 'pike' || kind === 'howler' || kind === 'drone'
}

function isBuildingKind(kind: unknown): kind is BuildingKind {
  return kind === 'keep' || kind === 'yard' || kind === 'silo' || kind === 'tower'
}

function isTargetKind(kind: unknown): kind is TargetKind {
  return kind === 'unit' || kind === 'building' || kind === 'rock'
}
