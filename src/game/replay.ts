import { runCommand } from './console'
import {
  cancelBuilding,
  cancelTrain,
  demolishBuilding,
  commandAttack,
  commandConstruct,
  commandFreeze,
  commandFreezeAuto,
  commandFrost,
  commandGather,
  commandHarvestOrAttack,
  commandHoverGrid,
  commandMove,
  commandRally,
  commandRepair,
  commandRepairNearest,
  commandStop,
  installCryo,
  thawCryo,
  tryPlace,
  tryTrain,
} from './commands'
import { takeSide } from './control'
import { toggleGuard, toggleScanner } from './scanner'
import type { BuildingKind, MatchMode, MatchState, SideStats, TargetKind, UnitKind } from './types'

export type ReplayAction =
  | { op: 'move'; ids: number[]; x: number; y: number; attack: boolean }
  | { op: 'attack'; ids: number[]; targetId: number; kind: TargetKind }
  | { op: 'gather'; ids: number[]; nodeId: number }
  | { op: 'harvest'; ids: number[]; buildingId: number }
  | { op: 'construct'; ids: number[]; buildingId: number }
  | { op: 'repair'; ids: number[]; buildingId: number }
  | { op: 'repairNearest'; ids: number[] }
  | { op: 'stop'; ids: number[] }
  | { op: 'freeze'; ids: number[]; buildingId: number }
  | { op: 'freezeAuto'; buildingId: number }
  | { op: 'thaw'; buildingId: number }
  | { op: 'rally'; buildingId: number; x: number; y: number }
  | { op: 'train'; buildingId: number; kind: UnitKind }
  | { op: 'cancelTrain'; buildingId: number }
  | { op: 'place'; owner: number; kind: BuildingKind; tx: number; ty: number; porters: number[] }
  | { op: 'cancelBuilding'; buildingId: number }
  | { op: 'demolish'; buildingId: number }
  | { op: 'cryo'; buildingId: number }
  | { op: 'grid'; ids: number[] }
  | { op: 'scan'; ids: number[] }
  | { op: 'guard'; ids: number[] }
  | { op: 'frost'; ids: number[] }
  | { op: 'console'; text: string }
  | { op: 'side'; owner: number }

interface Stamped {
  tick: number
  action: ReplayAction
}

/** Totals from the match that was recorded, kept for the replay statistics panel. */
export interface ReplayFinal {
  time: number
  playerCount: number
  stats: SideStats[]
}

export interface ReplayTape {
  seed: number
  mode: MatchMode
  actions: Stamped[]
  /** Filled when playback starts, from the finished match rather than the replay. */
  final: ReplayFinal | null
}

let recording = false
let tape: ReplayTape | null = null
let playAt: number[] = []
let play: ReplayAction[] = []
let cursor = 0

export function beginRecording(seed: number, mode: MatchMode): void {
  recording = true
  tape = { seed, mode, actions: [], final: null }
  playAt = []
  play = []
  cursor = 0
}

export function finishRecording(): ReplayTape | null {
  recording = false
  return tape
}

export function currentTape(): ReplayTape | null {
  return tape
}

/** Copy the finished match's statistics onto the tape. Later replay steps do not change this. */
export function sealReplayStats(state: MatchState): void {
  if (!tape) return
  tape.final = {
    time: state.time,
    playerCount: state.playerCount,
    stats: state.stats.map((row) => ({
      created: { ...row.created },
      lost: { ...row.lost },
      dumps: row.dumps,
      silos: row.silos,
    })),
  }
}

function stamp(action: ReplayAction): ReplayAction {
  if ('ids' in action) return { ...action, ids: action.ids.slice() }
  if (action.op === 'place') return { ...action, porters: action.porters.slice() }
  return action
}

function push(state: MatchState, action: ReplayAction): void {
  if (!recording || !tape || state.replay) return
  tape.actions.push({ tick: state.simTick, action: stamp(action) })
}

/** Orders the simulation drops while paused or after the match is over. */
export function rememberLive(state: MatchState, action: ReplayAction): void {
  if (state.paused || state.outcome) return
  push(state, action)
}

/** Cheats, Defrost, and side changes. These still apply while the match is paused. */
export function rememberAlways(state: MatchState, action: ReplayAction): void {
  if (state.outcome) return
  push(state, action)
}

export function armPlayback(source: ReplayTape): void {
  playAt = source.actions.map((entry) => entry.tick)
  play = source.actions.map((entry) => entry.action)
  cursor = 0
}

/** Apply every human order stamped for the step the match is about to take. */
export function applyDue(state: MatchState): void {
  while (cursor < play.length && (playAt[cursor] ?? Infinity) <= state.simTick) {
    const action = play[cursor]
    cursor += 1
    if (action) dispatch(state, action)
  }
}

function dispatch(state: MatchState, action: ReplayAction): void {
  switch (action.op) {
    case 'move':
      commandMove(state, action.ids, action.x, action.y, action.attack)
      return
    case 'attack':
      commandAttack(state, action.ids, action.targetId, action.kind)
      return
    case 'gather':
      commandGather(state, action.ids, action.nodeId)
      return
    case 'harvest':
      commandHarvestOrAttack(state, action.ids, action.buildingId)
      return
    case 'construct':
      commandConstruct(state, action.ids, action.buildingId)
      return
    case 'repair':
      commandRepair(state, action.ids, action.buildingId)
      return
    case 'repairNearest':
      commandRepairNearest(state, action.ids)
      return
    case 'stop':
      commandStop(state, action.ids)
      return
    case 'freeze':
      commandFreeze(state, action.ids, action.buildingId)
      return
    case 'freezeAuto':
      commandFreezeAuto(state, action.buildingId)
      return
    case 'thaw':
      thawCryo(state, action.buildingId)
      return
    case 'rally':
      commandRally(state, action.buildingId, action.x, action.y)
      return
    case 'train':
      tryTrain(state, action.buildingId, action.kind)
      return
    case 'cancelTrain':
      cancelTrain(state, action.buildingId)
      return
    case 'place':
      tryPlace(state, action.owner, action.kind, action.tx, action.ty, action.porters)
      return
    case 'cancelBuilding':
      cancelBuilding(state, action.buildingId)
      return
    case 'demolish':
      demolishBuilding(state, action.buildingId)
      return
    case 'cryo':
      installCryo(state, action.buildingId)
      return
    case 'grid':
      commandHoverGrid(state, action.ids)
      return
    case 'scan':
      toggleScanner(state, action.ids)
      return
    case 'guard':
      toggleGuard(state, action.ids)
      return
    case 'frost':
      commandFrost(state, action.ids)
      return
    case 'console':
      runCommand(state, action.text)
      return
    case 'side':
      takeSide(state, action.owner)
      return
  }
}
