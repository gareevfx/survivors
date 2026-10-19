import { commandAttack } from './commands'
import { spawnAnimals } from './animals'
import {
  blankSideStats,
  buildingCenter,
  makeBuilding,
  makeUnit,
  rebuildBlocked,
  recomputeSupply,
} from './state'
import { updateVision } from './vision'
import {
  ORE_NODE_AMOUNT,
  TILE,
  TREE_HP,
  type Lesson,
  type MatchState,
} from './types'

/** Construction and training run this many times faster during the guided lesson. */
export const LESSON_PACE = 3

export const TUTORIAL_W = 36
export const TUTORIAL_H = 20

const HOME = { tx: 3, ty: 7 }
const ENEMY = { tx: 27, ty: 7 }
const STORAGE_PAD = { tx: 8, ty: 4 }
const FACTORY_PAD = { tx: 8, ty: 12 }
const PILLAR_PAD = { tx: 6, ty: 3 }
const ORE_AT = { tx: 10, ty: 8 }
const FOG_AT = { tx: 24, ty: 8 }

interface Step {
  id: string
  text: string
  hud: string | null
  world: (state: MatchState) => { x: number; y: number } | null
  done: (state: MatchState) => boolean
}

function tileCenter(tx: number, ty: number): { x: number; y: number } {
  return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE }
}

function playerKeep(state: MatchState) {
  return state.buildings.find((building) => building.owner === 0 && building.kind === 'keep' && building.hp > 0)
}

function enemyKeep(state: MatchState) {
  return state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
}

function unitOf(state: MatchState, id: number) {
  return state.units.find((unit) => unit.id === id && unit.hp > 0)
}

const STEPS: Step[] = [
  {
    id: 'camera',
    text: 'Pan with WASD, the arrows, or by dragging, and zoom with the wheel or + and −. The arrow marks a spot to look toward.',
    hud: null,
    world: (state) => {
      const keep = playerKeep(state)
      if (!keep) return null
      const center = buildingCenter(keep)
      return { x: center.x + 220, y: center.y }
    },
    done: (state) => !!state.lesson?.flags.panned && !!state.lesson.flags.zoomed,
  },
  {
    id: 'silo',
    text: 'Press 1 to select your Silo. Press 1 again and the camera centers on it. The Silo trains Stalkers and stores Dumps.',
    hud: null,
    world: (state) => {
      const keep = playerKeep(state)
      return keep ? buildingCenter(keep) : null
    },
    done: (state) => (state.lesson?.siloPresses ?? 0) > (state.lesson?.siloMark ?? 0),
  },
  {
    id: 'stalkers',
    text: 'Click a Stalker, or drag a box around them. Stalkers haul Dumps and raise buildings. They cannot be destroyed. An enemy captures one that stands outside your Silo, a finished Storage, a Flasher, and a Gorilla.',
    hud: null,
    world: (state) => {
      const porter = state.units.find((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
      return porter ? { x: porter.x, y: porter.y } : null
    },
    done: (state) =>
      state.selectedUnits.some((id) => {
        const unit = unitOf(state, id)
        return !!unit && unit.owner === 0 && unit.kind === 'porter'
      }),
  },
  {
    id: 'idle',
    text: 'Press F or click Idle. That selects every Stalker who is waiting for work.',
    hud: '#idle',
    world: () => null,
    done: (state) => !!state.lesson?.flags.idle,
  },
  {
    id: 'haul',
    text: 'Right-click the Dumps pile with Stalkers selected. They carry a load home. The Silo holds 3000 dumps. A Storage holds 750 and adds 8 Cells.',
    hud: null,
    world: () => tileCenter(ORE_AT.tx, ORE_AT.ty),
    done: (state) => (state.oreHeld[0] ?? 0) > (state.lesson?.oreMark ?? 0),
  },
  {
    id: 'capacity',
    text: 'Press 1 and read the Dumps number. That is what you can spend. It cannot rise past the room left in your Silo and Storages.',
    hud: '#dumps-readout',
    world: (state) => {
      const keep = playerKeep(state)
      return keep ? buildingCenter(keep) : null
    },
    done: (state) => (state.lesson?.siloPresses ?? 0) > (state.lesson?.siloMark ?? 0),
  },
  {
    id: 'storage',
    text: 'Press L and left-click the marked ground. Building is allowed only on explored tiles. Black fog refuses the site.',
    hud: null,
    world: () => tileCenter(STORAGE_PAD.tx, STORAGE_PAD.ty),
    done: (state) => state.buildings.some((building) => building.owner === 0 && building.kind === 'silo' && building.hp > 0),
  },
  {
    id: 'factory',
    text: 'Press Y and left-click the marked ground to raise a Factory. It has to stand on explored ground too.',
    hud: null,
    world: () => tileCenter(FACTORY_PAD.tx, FACTORY_PAD.ty),
    done: (state) => state.buildings.some((building) => building.owner === 0 && building.kind === 'yard' && building.hp > 0),
  },
  {
    id: 'train',
    text: 'When the Factory finishes, queue a Flasher (K), a Gorilla (J), and a Fly (H). A squad is already outside so you can practice while these are built.',
    hud: '#commands',
    world: (state) => {
      const yard = state.buildings.find((building) => building.owner === 0 && building.kind === 'yard' && building.hp > 0)
      return yard ? buildingCenter(yard) : tileCenter(FACTORY_PAD.tx, FACTORY_PAD.ty)
    },
    done: (state) => {
      const lesson = state.lesson
      if (!lesson) return false
      const stats = state.stats[0]
      const queued = (kind: 'pike' | 'howler' | 'drone') =>
        state.buildings.some(
          (building) => building.owner === 0 && building.queue.some((job) => job.kind === kind),
        )
      const pike = (stats?.created.pike ?? 0) > lesson.bornPike || queued('pike')
      const howler = (stats?.created.howler ?? 0) > lesson.bornHowler || queued('howler')
      const fly = (stats?.created.drone ?? 0) > lesson.bornFly || queued('drone')
      return pike && howler && fly
    },
  },
  {
    id: 'groups',
    text: 'Click Units to select your Flashers and Gorillas. Ctrl+2 saves that group. Press 2 to select it again. Groups are 0 and 2 through 9. Key 1 stays on the Silo.',
    hud: '#units',
    world: () => null,
    done: (state) =>
      !!state.lesson?.flags.units && !!state.lesson.flags.grouped && !!state.lesson.flags.recalled,
  },
  {
    id: 'capture',
    text: 'Select a Flasher and right-click the enemy Stalker in the open. A hit captures a Stalker who is outside its own Silo, Storage, Flasher, and Gorilla sight.',
    hud: null,
    world: (state) => {
      const captive = unitOf(state, state.lesson?.captive ?? -1)
      return captive ? { x: captive.x, y: captive.y } : null
    },
    done: (state) => unitOf(state, state.lesson?.captive ?? -1)?.owner === 0,
  },
  {
    id: 'pillar',
    text: 'Press T and place a Pillar on the mark. It must stand inside Silo sight, with two empty cells between Pillars. Standing in its sight refills Power in 30 seconds.',
    hud: null,
    world: () => tileCenter(PILLAR_PAD.tx, PILLAR_PAD.ty),
    done: (state) => {
      const known = new Set(state.lesson?.towerIds ?? [])
      return state.buildings.some(
        (building) => building.owner === 0 && building.kind === 'tower' && building.hp > 0 && !known.has(building.id),
      )
    },
  },
  {
    id: 'battery',
    text: 'This Flasher is low on Power. Right-click the battery beside it. A combat unit that goes dry shuts down. When it dies it leaves a battery, and the next unit to walk over that battery refills.',
    hud: null,
    world: (state) => {
      const cell = state.batteries[0]
      return cell ? tileCenter(cell.tx, cell.ty) : null
    },
    done: (state) => {
      const drained = unitOf(state, state.lesson?.drained ?? -1)
      if (!drained) return state.batteries.length === 0
      return drained.power >= 0.95 || state.batteries.length === 0
    },
  },
  {
    id: 'fly',
    text: 'Select the Fly and press C for Scanner. It maps unexplored ground, far tiles first. Then click Guard. The Fly holds, and when an enemy combat unit enters its sight it calls nearby combat units.',
    hud: null,
    world: (state) => {
      const fly = state.units.find((unit) => unit.owner === 0 && unit.kind === 'drone' && unit.hp > 0)
      return fly ? { x: fly.x, y: fly.y } : null
    },
    done: (state) => !!state.lesson?.flags.scanned && !!state.lesson.flags.guarded,
  },
  {
    id: 'freeze',
    text: 'Select the Frog and press R. Freeze ices every other unit in its sight for 20 seconds, shatters trees there, and halves the health of rocks. It does nothing inside a Silo\'s sight. Half a Power bar comes off when the ice ends.',
    hud: null,
    world: (state) => {
      const frog = state.units.find((unit) => unit.owner === 0 && unit.kind === 'frog' && unit.hp > 0)
      return frog ? { x: frog.x, y: frog.y } : null
    },
    done: (state) =>
      state.units.some((unit) => unit.owner === 0 && unit.kind === 'frog' && unit.hp > 0 && unit.frostCd > 0),
  },
  {
    id: 'demolish',
    text: 'Select your Pillar and press B. The button turns red and reads Confirm for 3 seconds. Press B again. You get 25 dumps back, a quarter of the 100 it cost. The Silo cannot be demolished.',
    hud: null,
    world: (state) => {
      const tower = state.buildings.find((building) => building.owner === 0 && building.kind === 'tower' && building.hp > 0)
      return tower ? buildingCenter(tower) : tileCenter(PILLAR_PAD.tx, PILLAR_PAD.ty)
    },
    done: (state) => {
      const ids = state.lesson?.towerIds ?? []
      if (!ids.length) return false
      return ids.some((id) => !state.buildings.some((building) => building.id === id && building.hp > 0))
    },
  },
  {
    id: 'fog',
    text: 'Pan east into the black. You cannot see that ground, and shots or deaths there stay silent. Sound comes only from your current sight.',
    hud: null,
    world: () => tileCenter(FOG_AT.tx, FOG_AT.ty),
    done: (state) => {
      const lesson = state.lesson
      if (!lesson || lesson.anchorZoom < 0) return false
      const tx = Math.floor(lesson.viewX / TILE)
      const ty = Math.floor(lesson.viewY / TILE)
      if (tx < 0 || ty < 0 || tx >= state.mapW || ty >= state.mapH) return false
      return state.visible[ty * state.mapW + tx] !== 1
    },
  },
  {
    id: 'win',
    text: 'Destroy the enemy Silo. Their squad attacks now. In a 1v1, that capture ends the match.',
    hud: null,
    world: (state) => {
      const keep = enemyKeep(state)
      return keep ? buildingCenter(keep) : tileCenter(ENEMY.tx, ENEMY.ty)
    },
    done: (state) => state.outcome === 'win',
  },
]

export function lessonStepCount(): number {
  return STEPS.length
}

export function lessonStepId(index: number): string {
  return STEPS[index]?.id ?? ''
}

function blankLesson(): Lesson {
  return {
    index: 0,
    prepared: -1,
    finished: false,
    fight: false,
    anchorX: 0,
    anchorY: 0,
    anchorZoom: -1,
    viewX: 0,
    viewY: 0,
    siloPresses: 0,
    siloMark: 0,
    oreMark: 0,
    bornPike: 0,
    bornHowler: 0,
    bornFly: 0,
    towerIds: [],
    captive: -1,
    drained: -1,
    flags: {
      panned: false,
      zoomed: false,
      idle: false,
      units: false,
      grouped: false,
      recalled: false,
      scanned: false,
      guarded: false,
    },
  }
}

function at(tx: number, ty: number, mapW: number): number {
  return ty * mapW + tx
}

/** A small 1v1 field. The enemy side does not think until the last step. */
export function createTutorialMatch(seed: number): MatchState {
  const mapW = TUTORIAL_W
  const mapH = TUTORIAL_H
  const playerCount = 2
  const cells = mapW * mapH
  const tiles = new Uint8Array(cells)
  const trees: Array<[number, number]> = [
    [15, 13],
    [16, 13],
    [16, 14],
    [22, 6],
    [22, 7],
  ]
  for (const [tx, ty] of trees) tiles[at(tx, ty, mapW)] = 3

  const explored = new Uint8Array(cells)
  const visible = new Uint8Array(cells)
  const aiExplored = new Uint8Array(cells)
  const aiVisible = new Uint8Array(cells)
  const playerSpotted: MatchState['playerSpotted'] = []
  const aiSpotted: MatchState['aiSpotted'] = []
  const state: MatchState = {
    seed,
    mode: 'tutorial',
    playerCount,
    mapW,
    mapH,
    eliminated: [false, false],
    tiles,
    blocked: new Uint8Array(cells),
    explored,
    visible,
    seenAt: new Float32Array(cells),
    aiExplored,
    aiVisible,
    sideExplored: [explored, aiExplored],
    sideVisible: [visible, aiVisible],
    sideSpotted: [playerSpotted, aiSpotted],
    aiSpotted,
    playerSpotted,
    aiScout: 0,
    playerAiScout: 0,
    fogCleared: false,
    enemyCam: false,
    bothCam: false,
    godMode: false,
    aiControl: false,
    doubleGame: false,
    control: 0,
    ore: [],
    rocks: [],
    graves: [],
    batteries: [],
    animals: [],
    units: [],
    buildings: [],
    projectiles: [],
    particles: [],
    rings: [],
    pings: [],
    toasts: [],
    nextId: 1,
    oreHeld: [700, 80],
    supplyUsed: [0, 0],
    supplyCap: [0, 0],
    time: 0,
    stats: [blankSideStats(), blankSideStats()],
    paused: false,
    speed: 1,
    simTick: 0,
    replay: false,
    outcome: null,
    selectedUnits: [],
    activeKind: null,
    selectedBuilding: null,
    selectedGhost: null,
    selectedOre: null,
    selectedGrave: null,
    placement: null,
    attackMoveArmed: false,
    moveArmed: false,
    aiAcc: 0,
    aiAttacking: false,
    aiNext: 'pike',
    sideAcc: [0, 0],
    sideAttacking: [false, false],
    sideNext: ['pike', 'pike'],
    sideScout: [0, 0],
    playerAiAcc: 0,
    playerAiAttacking: false,
    playerAiNext: 'pike',
    underAttackCd: 0,
    gridAt: [-1, -1],
    events: [],
    tutorial: false,
    lesson: blankLesson(),
  }

  state.ore.push({
    id: state.nextId++,
    tx: ORE_AT.tx,
    ty: ORE_AT.ty,
    amount: ORE_NODE_AMOUNT,
    base: 0,
  })
  for (const [tx, ty] of trees) {
    state.rocks.push({
      id: state.nextId++,
      tx,
      ty,
      hp: TREE_HP,
      hitFlash: 0,
      kind: 'tree',
    })
  }

  const home = makeBuilding(state, 0, 'keep', HOME.tx, HOME.ty, true)
  const enemy = makeBuilding(state, 1, 'keep', ENEMY.tx, ENEMY.ty, true)
  home.stock = 700
  enemy.stock = 80
  enemy.hp = 420

  const porters: Array<[number, number]> = [
    [2.5, 8.5],
    [2.5, 10.5],
    [6.5, 6.5],
    [6.5, 11.5],
  ]
  for (const [tx, ty] of porters) makeUnit(state, 0, 'porter', tx * TILE, ty * TILE)
  makeUnit(state, 0, 'pike', 5.5 * TILE, 6.5 * TILE)
  const drained = makeUnit(state, 0, 'pike', 5.5 * TILE, 14.5 * TILE)
  drained.power = 0.22
  state.lesson!.drained = drained.id
  makeUnit(state, 0, 'howler', 4.5 * TILE, 12.5 * TILE)
  makeUnit(state, 0, 'drone', 6.5 * TILE, 6.5 * TILE)
  const frog = makeUnit(state, 0, 'frog', 15.5 * TILE, 14.5 * TILE)
  frog.facing = 0

  const captive = makeUnit(state, 1, 'porter', 11.5 * TILE, 6.5 * TILE)
  state.lesson!.captive = captive.id
  makeUnit(state, 1, 'porter', 29.5 * TILE, 9.5 * TILE)
  const raider = makeUnit(state, 1, 'pike', 26.5 * TILE, 6.5 * TILE)
  raider.hp = Math.ceil(raider.hp * 0.55)
  const tank = makeUnit(state, 1, 'howler', 26.5 * TILE, 11.5 * TILE)
  tank.hp = Math.ceil(tank.hp * 0.5)

  state.batteries.push({ id: state.nextId++, tx: 7, ty: 14 })

  rebuildBlocked(state)
  recomputeSupply(state)
  updateVision(state)
  spawnAnimals(state)
  return state
}

function ensureFactory(state: MatchState): void {
  if (state.buildings.some((building) => building.owner === 0 && building.kind === 'yard' && building.hp > 0)) return
  const site = makeBuilding(state, 0, 'yard', FACTORY_PAD.tx, FACTORY_PAD.ty, true)
  site.progress = 1
  rebuildBlocked(state)
  recomputeSupply(state)
}

function ensurePillar(state: MatchState): void {
  if (state.buildings.some((building) => building.owner === 0 && building.kind === 'tower' && building.hp > 0)) return
  const site = makeBuilding(state, 0, 'tower', PILLAR_PAD.tx, PILLAR_PAD.ty, true)
  site.progress = 1
  rebuildBlocked(state)
  recomputeSupply(state)
}

function prepare(state: MatchState): void {
  const lesson = state.lesson
  if (!lesson) return
  const step = STEPS[lesson.index]
  lesson.prepared = lesson.index
  if (!step) return
  lesson.siloMark = lesson.siloPresses
  lesson.oreMark = state.oreHeld[0] ?? 0
  const stats = state.stats[0]
  lesson.bornPike = stats?.created.pike ?? 0
  lesson.bornHowler = stats?.created.howler ?? 0
  lesson.bornFly = stats?.created.drone ?? 0
  lesson.towerIds = state.buildings
    .filter((building) => building.owner === 0 && building.kind === 'tower' && building.hp > 0)
    .map((building) => building.id)
  if (step.id === 'train') ensureFactory(state)
  if (step.id === 'demolish') {
    ensurePillar(state)
    lesson.towerIds = state.buildings
      .filter((building) => building.owner === 0 && building.kind === 'tower' && building.hp > 0)
      .map((building) => building.id)
  }
  if (step.id === 'win') lesson.fight = true
}

/** Remember the camera so pan, zoom, and the fog step can complete. */
export function noteLessonCamera(state: MatchState, x: number, y: number, zoom: number): void {
  const lesson = state.lesson
  if (!lesson || lesson.finished) return
  lesson.viewX = x
  lesson.viewY = y
  if (lesson.anchorZoom < 0) {
    lesson.anchorX = x
    lesson.anchorY = y
    lesson.anchorZoom = zoom
    return
  }
  if (Math.hypot(x - lesson.anchorX, y - lesson.anchorY) > 70) lesson.flags.panned = true
  if (Math.abs(zoom - lesson.anchorZoom) > 0.06) lesson.flags.zoomed = true
}

function noteFly(state: MatchState): void {
  const lesson = state.lesson
  if (!lesson) return
  for (const unit of state.units) {
    if (unit.owner !== 0 || unit.kind !== 'drone' || unit.hp <= 0) continue
    if (unit.scanning) lesson.flags.scanned = true
    if (lesson.flags.scanned && unit.guarding) lesson.flags.guarded = true
  }
}

/** Advance one step when its action has happened. Safe to call while the match is paused. */
export function lessonTick(state: MatchState): void {
  const lesson = state.lesson
  if (!lesson || lesson.finished) return
  noteFly(state)
  if (lesson.prepared !== lesson.index) {
    prepare(state)
    return
  }
  const step = STEPS[lesson.index]
  if (!step) {
    lesson.finished = true
    return
  }
  if (!step.done(state)) return
  lesson.index += 1
  lesson.prepared = -1
  if (lesson.index >= STEPS.length) lesson.finished = true
}

export function skipLesson(state: MatchState): void {
  const lesson = state.lesson
  if (!lesson || lesson.finished) return
  lesson.index += 1
  lesson.prepared = -1
  if (lesson.index >= STEPS.length) lesson.finished = true
}

export interface LessonView {
  step: number
  total: number
  text: string
  hud: string | null
  world: { x: number; y: number } | null
}

export function lessonView(state: MatchState): LessonView | null {
  const lesson = state.lesson
  if (!lesson || lesson.finished || state.outcome) return null
  const step = STEPS[lesson.index]
  if (!step) return null
  return {
    step: lesson.index + 1,
    total: STEPS.length,
    text: step.text,
    hud: step.hud,
    world: step.world(state),
  }
}

/** Send the enemy squad at the player's Silo. Full SiloAI stays off for this match. */
export function lessonEnemyPush(state: MatchState): void {
  const lesson = state.lesson
  if (state.mode !== 'tutorial' || !lesson?.fight || lesson.finished || state.outcome || state.paused) return
  const keep = playerKeep(state)
  if (!keep) return
  const ids = state.units
    .filter((unit) => unit.owner === 1 && unit.hp > 0 && (unit.kind === 'pike' || unit.kind === 'howler') && !unit.order)
    .map((unit) => unit.id)
  if (!ids.length) return
  commandAttack(state, ids, keep.id, 'building')
}
