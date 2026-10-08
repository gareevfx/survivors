export const TILE = 32
/** 80×45 tiles is a 16:9 battlefield, wider than the old square map. */
export const MAP_W = 80
export const MAP_H = 45
export const MAP_PX_W = TILE * MAP_W
export const MAP_PX_H = TILE * MAP_H

export const PLAYER_KEEP_TX = 6
export const PLAYER_KEEP_TY = 34

export const GATHER_TIME = 1.2
export const GATHER_AMOUNT = 8
export const ORE_NODE_AMOUNT = 420
/** At most this many miners from one side may work a single deposit. */
export const MINERS_PER_DEPOSIT = 3
/** Workers chip gray rock when ordered. Bikes and tanks cannot damage it. */
export const ROCK_HP = 56
export const STARTING_ORE = 120
export const SUPPLY_MAX = 60
export const INTERACT = 42
export const AGGRO_RANGE = 176
export const CHASE_BREAK = 300
/** A worker that has not moved on an order for this long is sent to the next job. */
export const STUCK_REDIRECT_SECONDS = 4

export type PlayerId = 0 | 1
export type UnitKind = 'porter' | 'pike' | 'howler' | 'drone'
export type BuildingKind = 'keep' | 'yard' | 'silo'
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
    label: 'Worker',
    blurb: 'Hauls minerals and raises structures. Breaks gray rock and trees that seal a minerals patch.',
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
    label: 'Bike',
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
    label: 'Tank',
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
    label: 'Drone',
    blurb: 'Flies over rock and buildings. No weapons. Sees as far as a Castle. Bikes deal half damage; tanks cannot attack it.',
    hp: 40,
    speed: 118,
    radius: 8,
    damage: 0,
    range: 0,
    cooldown: 1,
    sight: 260,
    supply: 1,
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
}

export const BUILDING_STATS: Record<BuildingKind, BuildingStats> = {
  keep: {
    label: 'Castle',
    blurb: 'Drop-off for minerals and home of the workers. If it falls, the field is lost.',
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
    blurb: 'Trains bikes, tanks, and drones.',
    w: 3,
    h: 2,
    hp: 720,
    cost: 160,
    buildTime: 18,
    supply: 0,
    sight: 180,
  },
  silo: {
    label: 'Silo',
    blurb: 'Raises the population cap by 8.',
    w: 2,
    h: 2,
    hp: 400,
    cost: 80,
    buildTime: 11,
    supply: 8,
    sight: 150,
  },
}

export const PLAYER_NAME = ['Northmark', 'Dunmarch'] as const
export const PLAYER_COLOR = ['#5ec8ff', '#ff5d4e'] as const

export type Order =
  | { type: 'move'; x: number; y: number }
  | {
      type: 'attackMove'
      x: number
      y: number
      focusId: number | null
      focusKind: TargetKind | null
    }
  | { type: 'attack'; targetId: number; kind: TargetKind; resumeNode?: number }
  | { type: 'gather'; nodeId: number; phase: 'approach' | 'mine' | 'return' }
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
}

export interface OreNode {
  id: number
  tx: number
  ty: number
  amount: number
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
  tiles: Uint8Array
  blocked: Uint8Array
  /** Tiles Northmark has ever seen. Stays revealed after units leave. */
  explored: Uint8Array
  /** Tiles currently inside Northmark sight. Rebuilt each step. */
  visible: Uint8Array
  /** Tiles Dunmarch has scouted. Minerals and enemies outside this are unknown. */
  aiExplored: Uint8Array
  /** Tiles currently inside Dunmarch sight. Rebuilt each step. */
  aiVisible: Uint8Array
  /** Player buildings Dunmarch has seen. The last position is kept until that building is gone. */
  aiSpotted: Array<{ id: number; x: number; y: number }>
  /** Dunmarch buildings Northmark has seen. Used only while AI control is playing this side. */
  playerSpotted: Array<{ id: number; x: number; y: number }>
  /** Drone, bike, or spare worker currently scouting fog for minerals and the enemy. */
  aiScout: number
  /** Northmark scout while AI control is on. */
  playerAiScout: number
  /** When set, the player's fog stays off for the rest of this match. Dunmarch still scouts. */
  fogCleared: boolean
  /** When set, the map is drawn with Dunmarch's fog instead of Northmark's. */
  enemyCam: boolean
  /** When set, Northmark units and buildings take no damage until the next match. */
  godMode: boolean
  /** When set, Dunmarch's build-and-fight loop plays Northmark from Northmark's own sight. */
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
  oreHeld: [number, number]
  supplyUsed: [number, number]
  supplyCap: [number, number]
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
