export const TILE = 32
export const MAP_W = 48
export const MAP_H = 48
export const MAP_PX_W = TILE * MAP_W
export const MAP_PX_H = TILE * MAP_H

export const PLAYER_KEEP_TX = 8
export const PLAYER_KEEP_TY = 36

export const GATHER_TIME = 1.2
export const GATHER_AMOUNT = 8
export const ORE_NODE_AMOUNT = 420
/** Four howler hits. Any ordered attacker can chip a rock; howlers are the practical siege tool. */
export const ROCK_HP = 56
export const STARTING_ORE = 120
export const SUPPLY_MAX = 60
export const INTERACT = 42
export const AGGRO_RANGE = 176
export const CHASE_BREAK = 300

export type PlayerId = 0 | 1
export type UnitKind = 'porter' | 'pike' | 'howler'
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
}

export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  porter: {
    label: 'Porter',
    blurb: 'Hauls ore and raises structures. Right-click gray rock to break it.',
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
  },
  pike: {
    label: 'Pike',
    blurb: 'Quick infantry with a short spear.',
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
  },
  howler: {
    label: 'Howler',
    blurb: 'Slow slinger with a long reach. Right-click gray rock to break it.',
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
}

export const BUILDING_STATS: Record<BuildingKind, BuildingStats> = {
  keep: {
    label: 'Keep',
    blurb: 'Drop-off for ore and home of the porters. If it falls, the field is lost.',
    w: 3,
    h: 3,
    hp: 1700,
    cost: 0,
    buildTime: 1,
    supply: 12,
  },
  yard: {
    label: 'Yard',
    blurb: 'Trains pikes and howlers.',
    w: 3,
    h: 2,
    hp: 720,
    cost: 160,
    buildTime: 18,
    supply: 0,
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
  | { type: 'attack'; targetId: number; kind: TargetKind }
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
  outcome: null | 'win' | 'lose'
  selectedUnits: number[]
  selectedBuilding: number | null
  placement: BuildingKind | null
  attackMoveArmed: boolean
  moveArmed: boolean
  aiAcc: number
  aiAttacking: boolean
  aiNext: 'pike' | 'howler'
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
}
