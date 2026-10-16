export const TILE = 32
/** 1 vs 1 uses an 80×40 field. */
export const MAP_W = 80
export const MAP_H = 40
export const MAP_PX_W = TILE * MAP_W
export const MAP_PX_H = TILE * MAP_H
/** Free-for-all uses a 90×50 field. */
export const FFA_MAP_W = 90
export const FFA_MAP_H = 50
/** Eight-player free-for-all uses a 100×100 field. */
export const FFA8_MAP_W = 100
export const FFA8_MAP_H = 100
export type MatchMode = 'duel' | 'ffa' | 'ffa8'

export const GATHER_TIME = 1.2
export const GATHER_AMOUNT = 8
export const ORE_NODE_AMOUNT = 420
/** At most this many miners from one side may work a single deposit. */
export const MINERS_PER_DEPOSIT = 3
/** Workers chip gray rock when ordered. Bikes and tanks cannot damage it. */
export const ROCK_HP = 28
/** Trees block like rock. Each starts with this many hit points. */
export const TREE_HP = 6
/** Seconds a Hover stays invisible after Grid sends it. Match time, not wall time. */
export const GRID_CLOAK_SECONDS = 45
export const STARTING_ORE = 120
/** Hard ceiling on Cells. Finished buildings still add their supply (Silo 12, Storage 8); the sum is clamped to this. */
export const SUPPLY_MAX = 65
/** One Storage holds this many dumps. A Silo does not. */
export const STORAGE_CAP = 500
export const INTERACT = 42
/** Flasher, Gorilla, Hover, and Frog run this long from a full Power bar. */
export const FLASHER_POWER_SECONDS = 3 * 60
export const GORILLA_POWER_SECONDS = 10 * 60
export const HOVER_POWER_SECONDS = 8 * 60
export const FROG_POWER_SECONDS = 6 * 60
/** Frog Freeze holds every other unit in its sight this long. Power does not drain while that lasts. */
export const FROG_FREEZE_SECONDS = 30
/** Seconds before that Frog can Freeze again. */
export const FROG_FREEZE_COOLDOWN = 90
/** Fraction of a full Power bar removed when Freeze ends. Empty Power shuts the unit down. */
export const FROG_THAW_POWER = 0.5
/** SiloAI sends a combat unit to a battery or a friendly Pillar below this fraction of Power. */
export const POWER_LOW = 0.3
/** A friendly Pillar refills Power from empty to full in this many seconds, and drain stops while that lasts. */
export const PILLAR_CHARGE_SECONDS = 30
/** SiloAI stops this far inside a Pillar's sight so the unit is charging, not standing on the edge. */
export const PILLAR_CHARGE_INSET = 16
/** Dumps left on the ground when a building is destroyed. */
export const FACTORY_DEBRIS_PILES = 6
export const FACTORY_DEBRIS_AMOUNT = 15
export const STORAGE_DEBRIS_PILES = 4
export const STORAGE_DEBRIS_AMOUNT = 10
export const PILLAR_DEBRIS_PILES = 1
export const PILLAR_DEBRIS_AMOUNT = 50
export const AGGRO_RANGE = 176
export const CHASE_BREAK = 300
/** A worker that has not moved on an order for this long is sent to the next job. */
export const STUCK_REDIRECT_SECONDS = 4
/** A Stalker's hit points drain to 0 over this many seconds. Other units do not expire. */
export const STALKER_LIFESPAN = 5 * 60

export type PlayerId = number
export type UnitKind = 'porter' | 'pike' | 'howler' | 'drone' | 'frog'

export const UNIT_KINDS: readonly UnitKind[] = ['porter', 'pike', 'howler', 'drone', 'frog']

/** Flashers, Gorillas, Hovers, Frogs, and any later fighting unit. A Stalker is not one. */
export function isCombatUnit(kind: UnitKind): boolean {
  return kind !== 'porter'
}

/** Seconds of Power from full. Stalkers have none. */
export function powerSeconds(kind: UnitKind): number {
  if (kind === 'pike') return FLASHER_POWER_SECONDS
  if (kind === 'howler') return GORILLA_POWER_SECONDS
  if (kind === 'drone') return HOVER_POWER_SECONDS
  if (kind === 'frog') return FROG_POWER_SECONDS
  return 0
}

/** A Flasher, Gorilla, Hover, or Frog with an empty Power bar. It is still alive. */
export function isShutdown(unit: { kind: UnitKind; power: number }): boolean {
  return powerSeconds(unit.kind) > 0 && unit.power <= 0
}
export type BuildingKind = 'keep' | 'yard' | 'silo' | 'tower'

/** Dumps to add a Cryo to one Silo. Once per Silo. */
export const CRYO_COST = 250
/** Frozen Stalkers one Silo Cryo can hold. A freeze order sends this many at once. */
export const CRYO_SLOTS = 4
/** Dumps charged for each Stalker when the group of four enters. */
export const CRYO_FREEZE_COST = 50
/** Seconds a Silo Cryo refuses Stalkers after a Defrost. */
export const CRYO_RECOVER = 4 * 60
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
    blurb: 'Hauls dumps and raises structures. Breaks gray rock and trees that seal a dumps patch. Opponents cannot destroy a Stalker. A unit or a Pillar captures one only when it stands outside the sight of its own Silo, a finished Storage, Flashers, and Gorillas. Lives for 5 minutes.',
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
    blurb: 'Quick rider with a short reach. Power lasts 3 minutes, then the Flasher shuts down until a battery recharges it. Inside a friendly Pillar\'s sight, Power refills in 30 seconds instead of draining.',
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
    blurb: 'Slow gunner with a long reach. Power lasts 10 minutes, then the Gorilla shuts down until a battery recharges it. Inside a friendly Pillar\'s sight, Power refills in 30 seconds instead of draining.',
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
    blurb: `Flies over rock and buildings. No weapons. Sees as far as a Silo. Costs 50 dumps. Flashers deal half damage; gorillas cannot attack it. Select 10 Hovers to activate the Grid. Those Hovers turn invisible for ${GRID_CLOAK_SECONDS} seconds. A scanning Hover reveals an invisible enemy Hover inside its sight. Power lasts 8 minutes, then the Hover shuts down until a battery recharges it. Inside a friendly Pillar's sight, Power refills in 30 seconds instead of draining.`,
    hp: 80,
    speed: 118,
    radius: 8,
    damage: 0,
    range: 0,
    cooldown: 1,
    sight: 260,
    supply: 0,
    cost: 50,
    trainTime: 8,
    projectileSpeed: 0,
    projectileRadius: 0,
    flying: true,
  },
  frog: {
    label: 'Frog',
    blurb: 'White buggy with a cryo tank. Same speed and sight as a Flasher. No weapon. 64 hit points, 75 dumps, 12 seconds to build, 2 cells. Power lasts 6 minutes. Freeze ices every other unit in sight for 30 seconds. Power does not drain while frozen. When the ice ends, each unit with Power loses half a bar. Cooldown 90 seconds. A friendly Pillar refills Power in 30 seconds.',
    hp: 64,
    speed: 104,
    radius: 11,
    damage: 0,
    range: 0,
    cooldown: 1,
    sight: 176,
    supply: 2,
    cost: 75,
    trainTime: 12,
    projectileSpeed: 0,
    projectileRadius: 0,
    flying: false,
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
    blurb: 'Drop-off for dumps and home of the stalkers. Destroying a Silo captures that side\'s buildings, units, and dumps. In 1 vs 1 the match ends. In a free-for-all that side is out. A Cryo can be added once for 250 dumps: four glass vessels. Select 4 Stalkers and send them to the Silo. Freezing costs 50 dumps each (200 for the group). Defrost releases them beside the Silo, then the Cryo recovers for 4 minutes.',
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
    blurb: 'Trains flashers, gorillas, hovers, and frogs. Destruction leaves 6 piles of 15 dumps.',
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
    blurb: 'Raises the cells cap by 8. Holds at most 500 dumps. Stalkers can drop dumps here or haul them out of an enemy Storage. A Flasher or Gorilla that destroys it leaves one dumps pile. Destruction also leaves 4 piles of 10 dumps.',
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
    blurb: 'One cell. Sees as far as a Hover and shoots the closest enemy in that sight for 8/3 damage, at a Flasher\'s rate. An uncovered enemy Stalker is captured instead. Hovers take half of that. Place it inside Silo sight. Leave two empty cells between Pillars. A friendly Flasher, Gorilla, Hover, or Frog inside this sight refills Power in 30 seconds instead of draining. Destruction leaves one pile of 50 dumps.',
    w: 1,
    h: 1,
    hp: 160,
    cost: 100,
    buildTime: 7,
    supply: 0,
    sight: UNIT_STATS.drone.sight,
    damage: 8 / 3,
  },
}

export const PLAYER_NAME: readonly string[] = [
  'Silo 01',
  'Silo 02',
  'Silo 03',
  'Silo 04',
  'Silo 05',
  'Silo 06',
  'Silo 07',
  'Silo 08',
  'Silo 09',
  'Silo 10',
]
/** Bright team colors, separated on the olive terrain and from each other. */
export const PLAYER_COLOR: readonly string[] = [
  '#5ec8ff',
  '#ff5d4e',
  '#7dff6a',
  '#c58bff',
  '#ffd24a',
  '#ff7ad1',
  '#2fe0c8',
  '#ff9a32',
  '#e8e6f2',
  '#6f93ff',
]

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
  | { type: 'repair'; buildingId: number }
  | { type: 'freeze'; buildingId: number }

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
  /** Seconds of Grid invisibility left. Enemies cannot see or attack while this is above zero. */
  cloak: number
  /** Seconds this unit has been in the match. A Stalker's hit points drain across STALKER_LIFESPAN. */
  age: number
  /** Cryo this Stalker is frozen inside. Null while the Stalker is on the map. */
  frozen: number | null
  /** Seconds left in a Frog Freeze. The unit stays on the map and cannot move or act. Power does not drain. When this hits zero, a unit with Power loses half a bar. */
  ice: number
  /** Seconds until this Frog can Freeze again. */
  frostCd: number
  /**
   * Fraction of Power left, from 1 down to 0. A Flasher, Gorilla, Hover, or Frog drains it.
   * At 0 the unit shuts down: it stays on the map, but it does not move, fire, or take orders until Power is above 0.
   * A battery refills it. A finished friendly Pillar refills it while the unit is inside that Pillar's sight.
   */
  power: number
}

/** Expanding frost left by Frog Freeze. Rendering only, spawned by the order. */
export interface FrostRing {
  x: number
  y: number
  life: number
  max: number
  reach: number
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
  /** A fallen Silo left on the map. Neutral, blocks movement, and can be repaired. */
  ruined: boolean
  /** The repair cost has already been paid, so more Stalkers only add speed. */
  repairPaid: boolean
  /** This Silo has four glass vessels. Bought once for CRYO_COST. */
  cryo: boolean
  /** Seconds before this Silo Cryo can freeze another group. Zero when it is ready. */
  cryoRecover: number
}

/**
 * A Silo is the side's home and has no build price, so repair is not half of zero.
 * 80 dumps is the price of a Storage, which is half a Factory. One Stalker finishes in 8 seconds.
 * The Silo comes back at full health, owned by that Stalker's side.
 */
export const SILO_REPAIR_COST = 80
export const SILO_REPAIR_TIME = 8

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

/** One charge left where a Flasher, Gorilla, or Hover was destroyed. It does not block movement. */
export interface Battery {
  id: number
  tx: number
  ty: number
}

/** A Stalker who died of age. It marks the tile and does not block movement. */
export interface Grave {
  id: number
  tx: number
  ty: number
}

/** Ambient crows. Not a unit: they cannot be selected, ordered, or attacked. */
export type AnimalKind = 'crow'

export interface Animal {
  kind: AnimalKind
  x: number
  y: number
  facing: number
  /** Wing beat. */
  phase: number
  /** Bumps each time a crow picks a new heading. */
  turn: number
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

/** Totals kept for one side and shown when the match ends. */
export interface SideStats {
  /** Units that entered the field for this side, including the Stalkers it starts with. */
  created: Record<UnitKind, number>
  /** Units that died, or that vanished because the side was wiped out with nobody to take them. A capture is not a loss. */
  lost: Record<UnitKind, number>
  /** Dumps carried home to a Silo or Storage. The starting pile and a captured bank are not included. */
  dumps: number
  /** Enemy Silos this side captured by destroying them. */
  silos: number
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
  /**
   * Hot-seat. The player commands any seated side and sees that side's fog.
   * Silo 01 still decides the match, god mode, `siloai`, and enemy cam.
   */
  doubleGame: boolean
  /** Side commanded while double game is on. Zero while it is off. */
  control: PlayerId
  ore: OreNode[]
  rocks: Rock[]
  graves: Grave[]
  /** Batteries left by destroyed Flashers, Gorillas, Hovers, and Frogs. */
  batteries: Battery[]
  /** Crows. Ambient only. */
  animals: Animal[]
  units: Unit[]
  buildings: Building[]
  projectiles: Projectile[]
  particles: Particle[]
  rings: FrostRing[]
  pings: Ping[]
  toasts: Toast[]
  nextId: number
  oreHeld: number[]
  supplyUsed: number[]
  supplyCap: number[]
  time: number
  /** Per-side totals for the end-of-match panel. Indexed by owner. */
  stats: SideStats[]
  /** While set, the match clock and every simulation system stay where they are. */
  paused: boolean
  /** Simulation rate. 3 while the `speed x3` command is on, otherwise 1. */
  speed: number
  /** Steps already taken. Human orders are stamped with this so a replay can apply them again. */
  simTick: number
  /** Watch-only playback of the tape for this seed. Orders from the player are ignored. */
  replay: boolean
  outcome: null | 'win' | 'lose'
  selectedUnits: number[]
  selectedBuilding: number | null
  selectedOre: number | null
  selectedGrave: number | null
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
  /** Match time when this side last ordered Hover Grid. -1 until the first use. */
  gridAt: number[]
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
    /** Grid invisibility. Weapons refuse a cloaked unit. */
    cloaked?: boolean
}
