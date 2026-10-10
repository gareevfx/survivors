export const TILE = 32
/** Both match modes use an 80×50 field. */
export const MAP_W = 80
export const MAP_H = 50
export const MAP_PX_W = TILE * MAP_W
export const MAP_PX_H = TILE * MAP_H
/** Free-for-all uses the same 80×50 field as 1v1. */
export const FFA_MAP_W = 80
export const FFA_MAP_H = 50

export type MatchMode = 'duel' | 'ffa'

export const PLAYER_KEEP_TX = 6
export const PLAYER_KEEP_TY = 34

export const GATHER_TIME = 1.2
export const GATHER_AMOUNT = 8
export const ORE_NODE_AMOUNT = 420
/** At most this many miners from one side may work a single deposit. */
export const MINERS_PER_DEPOSIT = 3
/** Workers chip gray rock when ordered. Bikes and tanks cannot damage it. */
export const ROCK_HP = 56
/** Trees block like rock and take half as many hits. */
export const TREE_HP = ROCK_HP / 2
export const STARTING_ORE = 120
export const SUPPLY_MAX = 60
export const INTERACT = 42
export const AGGRO_RANGE = 176
export const CHASE_BREAK = 300
/** A worker that has not moved on an order for this long is sent to the next job. */
export const STUCK_REDIRECT_SECONDS = 4

export type PlayerId = number
export type UnitKind = 'porter' | 'pike' | 'howler' | 'drone'
export type BuildingKind = 'keep' | 'yard' | 'silo' | 'tower'
export type TargetKind = 'unit' | 'building' | 'rock'

export interface UnitStats {
  label: string
  blurb: string
  hp: number
  speed: number
  radius: number
  damage: number
  range: number
  cooldown: number
  sight: number
  supply: number
  cost: number
  trainTime: number
  projectileSpeed: number
  projectileRadius: number
  /** Ignores rocks, buildings, and other ground blockers. */
  flying: boolean
}

export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  porter: {
    label: 'Stalker',
    blurb: 'Hauls dumps and raises structures. Breaks gray rock and trees that seal a dumps patch. Opponents cannot destroy a Stalker. One is captured only when it stands outside the sight of its own Silo, a finished Storage, Flashers, and Gorillas.',
    hp: 42,
    speed: 86,
    radius: 9,
    damage: 3,
    range: 26,
    cooldown: 1.05,
    sight: 110,
    supply: 1,
    cost: 50,
    trainTime: 8,
    projectileSpeed: 280,
    projectileRadius: 2.4,
    flying: false,
  },
  pike: {
    label: 'Flasher',
    blurb: 'Quick rider with a short reach.',
    hp: 58,
    speed: 104,
    radius: 10,
    damage: 8,
    range: 46,
    cooldown: 0.7,
    sight: 176,
    supply: 1,
    cost: 50,
    trainTime: 9,
    projectileSpeed: 420,
    projectileRadius: 2.2,
    flying: false,
  },
  howler: {
    label: 'Gorilla',
    blurb: 'Slow gunner with a long reach.',
    hp: 74,
    speed: 66,
    radius: 11,
    damage: 14,
    range: 156,
    cooldown: 1.5,
    sight: 210,
    supply: 2,
    cost: 100,
    trainTime: 14,
    projectileSpeed: 200,
    projectileRadius: 4,
    flying: false,
  },
  drone: {
    label: 'Hover',
    blurb: 'Flies over rock and buildings. No weapons. Sees as far as a Silo. Costs 75 dumps and no cells. Flashers deal half damage; gorillas cannot attack it.',
    hp: 40,
    speed: 118,
    radius: 8,
    damage: 0,
    range: 0,
    cooldown: 1,
    sight: 260,
    supply: 0,
    cost: 75,
    trainTime: 11,
    projectileSpeed: 0,
    projectileRadius: 0,
    flying: true,
  },
}

export interface BuildingStats {
  label: string
  blurb: string
  w: number
  h: number
  hp: number
  cost: number
  buildTime: number
  supply: number
  sight: number
  /** Shot damage. Only a Tower fires. Hit points keep the fraction. */
  damage?: number
}

export const BUILDING_STATS: Record<BuildingKind, BuildingStats> = {
  keep: {
    label: 'Silo',
    blurb: 'Drop-off for dumps and home of the stalkers. Destroying a Silo captures that side\'s buildings, units, and dumps. In 1 vs 1 the match ends. In a free-for-all that side is out.',
    w: 3,
    h: 3,
    hp: 1700,
    cost: 0,
    buildTime: 1,
    supply: 12,
    sight: 260,
  },
  yard: {
    label: 'Factory',
    blurb: 'Trains flashers, gorillas, and hovers.',
    w: 3,
    h: 2,
    hp: 720,
    cost: 160,
    buildTime: 18,
    supply: 0,
    sight: 180,
  },
  silo: {
    label: 'Storage',
    blurb: 'Raises the cells cap by 8. Stalkers can drop dumps here or haul them out of an enemy Storage. A Flasher or Gorilla that destroys it leaves one dumps pile.',
    w: 2,
    h: 2,
    hp: 400,
    cost: 80,
    buildTime: 11,
    supply: 8,
    sight: 150,
  },
  tower: {
    label: 'Pillar',
    blurb: 'One cell. Sees as far as a Hover and shoots the closest enemy in that sight for 8/3 damage, at a Flasher\'s rate. Hovers take half of that. Place it inside Silo sight.',
    w: 1,
    h: 1,
    hp: 320,
    cost: 100,
    buildTime: 14,
    supply: 0,
    sight: UNIT_STATS.drone.sight,
    damage: 8 / 3,
  },
}

export const PLAYER_NAME: readonly string[] = ['Silo 01', 'Silo 02', 'Silo 03', 'Silo 04']
export const PLAYER_COLOR: readonly string[] = ['#5ec8ff', '#ff5d4e', '#7dff6a', '#c58bff']

export type Order =
  | { type: 'move'; x: number; y: number }
  | {
      type: 'attackMove'
      x: number
      y: number
      focusId: number | null
      focusKind: TargetKind | null
    }
  | { type: 'attack'; targetId: number; kind: TargetKind; resumeNode?: number; resume?: Order }
  | { type: 'gather'; nodeId: number; phase: 'approach' | 'mine' | 'return'; binId?: number }
  | { type: 'construct'; buildingId: number }

export interface Unit {
  id: number
  owner: PlayerId
  kind: UnitKind
  x: number
  y: number
  hp: number
  facing: number
  anim: number
  order: Order | null
  path: Array<{ x: number; y: number }>
  goalX: number | null
  goalY: number | null
  attackCd: number
  hurtTimer: number
  hitFlash: number
  cargo: number
  gatherTimer: number
  stuckT: number
  /** Seconds the worker has stayed put while an order still expects movement. */
  stuckOrderT: number
  stuckX: number
  stuckY: number
  /** Deposit skipped after a stuck redirect, so idle assignment does not send them straight back. */
  avoidNode: number
  avoidUntil: number
  leashX: number | null
  leashY: number | null
  idleAcquire: boolean
  nodeMemory: number
  repathIn: number
  /** Player Hover flying itself across black fog, then the oldest sightings. */
  scanning: boolean
}

export interface TrainJob {
  kind: UnitKind
  remaining: number
  total: number
}

export interface Building {
  id: number
  owner: PlayerId
  kind: BuildingKind
  tx: number
  ty: number
  hp: number
  progress: number
  complete: boolean
  queue: TrainJob[]
  rallyX: number
  rallyY: number
  hitFlash: number
  spawnN: number
  /** Seconds the Silo or Factory door stays open after a unit steps out. */
  hatch: number
  /** Roof dish angle. Integrated so a change in speed does not jump. */
  dish: number
  attackCd: number
  /** Seconds this building stays a defense alarm after it takes damage. */
  alert: number
  /** Enemy the Tower is shooting. Kept until that enemy leaves sight or dies. */
  focusId: number | null
  focusKind: TargetKind | null
  /** Dumps physically stored here. Spending draws the richest Storage down first. */
  stock: number
  /** Owner of the last hit. A fallen Silo is captured by this side when they still have one. */
  struckBy: number | null
  /** The killing blow was a Flasher or Gorilla, so a Storage leaves one dumps pile. */
  dropDumps: boolean
}

export interface OreNode {
  id: number
  tx: number
  ty: number
  amount: number
  /** Castle-area patch for this side. Absent on expansion minerals and hand-built nodes. */
  base?: PlayerId | null
}

export interface Rock {
  id: number
  tx: number
  ty: number
  hp: number
  hitFlash: number
  /** Trees block, hide behind fog, and break the same way as stone. */
  kind?: 'rock' | 'tree'
}

export interface Projectile {
  id: number
  owner: PlayerId
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

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  r: number
  color: string
  text?: string
}

export interface Ping {
  x: number
  y: number
  life: number
  max: number
  color: string
}

export interface Toast {
  text: string
  life: number
}

export type GameEvent =
  | { type: 'order' }
  | { type: 'select' }
  | { type: 'attack' }
  | { type: 'death' }
  | { type: 'ready' }
  | { type: 'build' }
  | { type: 'win' }
  | { type: 'lose' }

export interface MatchState {
  seed: number
  mode: MatchMode
  playerCount: number
  mapW: number
  mapH: number
  /** A side whose Silo is gone. Its units and buildings have been removed. */
  eliminated: boolean[]
  tiles: Uint8Array
  blocked: Uint8Array
  /** Tiles Silo 01 has ever seen. Stays revealed after units leave. */
  explored: Uint8Array
  /** Tiles currently inside Silo 01 sight. Rebuilt each step. */
  visible: Uint8Array
  /** Match time when Silo 01 last saw each tile. Zero until that tile is seen. */
  seenAt: Float32Array
  /** Tiles Silo 02 has scouted. Same array as sideExplored[1]. */
  aiExplored: Uint8Array
  /** Tiles currently inside Silo 02 sight. Same array as sideVisible[1]. */
  aiVisible: Uint8Array
  /** Explored ground for every side, indexed by owner. */
  sideExplored: Uint8Array[]
  /** Current sight for every side, indexed by owner. */
  sideVisible: Uint8Array[]
  /** Enemy buildings each side has seen. */
  sideSpotted: Array<Array<{ id: number; x: number; y: number }>>
  /** Player buildings Silo 02 has seen. Same array as sideSpotted[1]. */
  aiSpotted: Array<{ id: number; x: number; y: number }>
  /** Enemy buildings Silo 01 has seen. Same array as sideSpotted[0]. */
  playerSpotted: Array<{ id: number; x: number; y: number }>
  /** Drone, bike, or spare worker currently scouting fog for minerals and the enemy. */
  aiScout: number
  /** Northmark scout while AI control is on. */
  playerAiScout: number
  /** When set, the player's fog stays off until FOW is turned back on. Dunmarch still scouts. */
  fogCleared: boolean
  /** When set, the map is drawn with Dunmarch's fog instead of Northmark's. */
  enemyCam: boolean
  /** When set, the map is drawn with both sides' fog combined. Rendering only. */
  bothCam: boolean
  /** When set, Northmark units and buildings take no damage until the next match. */
  godMode: boolean
  /** When set, SiloAI plays Silo 01 from Silo 01's own sight. */
  aiControl: boolean
  ore: OreNode[]
  rocks: Rock[]
  units: Unit[]
  buildings: Building[]
  projectiles: Projectile[]
  particles: Particle[]
  pings: Ping[]
  toasts: Toast[]
  nextId: number
  oreHeld: number[]
  supplyUsed: number[]
  supplyCap: number[]
  time: number
  /** While set, the match clock and every simulation system stay where they are. */
  paused: boolean
  outcome: null | 'win' | 'lose'
  selectedUnits: number[]
  selectedBuilding: number | null
  selectedOre: number | null
  placement: BuildingKind | null
  attackMoveArmed: boolean
  moveArmed: boolean
  aiAcc: number
  aiAttacking: boolean
  aiNext: 'pike' | 'howler'
  /** Think timers for sides other than Silo 02, which still uses aiAcc. */
  sideAcc: number[]
  sideAttacking: boolean[]
  sideNext: Array<'pike' | 'howler'>
  sideScout: number[]
  playerAiAcc: number
  playerAiAttacking: boolean
  playerAiNext: 'pike' | 'howler'
  underAttackCd: number
  events: GameEvent[]
  tutorial: boolean
}

export interface Target {
  id: number
  owner: PlayerId
  x: number
  y: number
  radius: number
  hp: number
    targetKind: TargetKind
    /** Set when the target is a unit, so weapons can tell a Drone from a Bike. */
    unitKind?: UnitKind
}
