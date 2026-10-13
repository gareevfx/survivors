import { mp } from './mpRole'
import type { BuildingKind, TargetKind, UnitKind } from './types'

/** A guest order. The host applies it as Silo 02. */
export type NetCmd =
  | { op: 'move'; ids: number[]; x: number; y: number; attackMove: boolean }
  | { op: 'attack'; ids: number[]; targetId: number; kind: TargetKind }
  | { op: 'stop'; ids: number[] }
  | { op: 'gather'; ids: number[]; nodeId: number }
  | { op: 'construct'; ids: number[]; buildingId: number }
  | { op: 'repair'; ids: number[]; buildingId: number }
  | { op: 'repairNearest'; ids: number[] }
  | { op: 'harvest'; ids: number[]; buildingId: number }
  | { op: 'train'; buildingId: number; kind: UnitKind }
  | { op: 'cancelTrain'; buildingId: number }
  | { op: 'cancelBuild'; buildingId: number }
  | { op: 'place'; kind: BuildingKind; tx: number; ty: number; porters: number[] }
  | { op: 'rally'; buildingId: number; x: number; y: number }
  | { op: 'scan'; ids: number[] }
  | { op: 'grid'; ids: number[] }

type Sender = (cmd: NetCmd) => void

let sender: Sender | null = null
let applying = false

export function setGuestSender(fn: Sender | null): void {
  sender = fn
}

/** Guest browsers forward the order. The host, and single-player, run it here. */
export function guestSend(cmd: NetCmd): boolean {
  if (applying || mp.role !== 'guest' || !sender) return false
  sender(cmd)
  return true
}

/** Commands the host applies must not be forwarded again. */
export function asHost<T>(fn: () => T): T {
  applying = true
  try {
    return fn()
  } finally {
    applying = false
  }
}
