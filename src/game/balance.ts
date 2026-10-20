import { BUILDING_STATS, type BuildingKind } from './types'

/** A captured Stalker stays with its old owner and takes no orders for this long, then joins the captor. */
export const STALKER_CAPTURE_STUN_SECONDS = 20

/** Applied to the Silo's listed max hit points. Repair and a finished capture both restore this much. */
export const SILO_HP_MULTIPLIER = 3

/** Enemy combat units must stand in weapon range of a ruined Silo for this long to take it. */
export const SILO_CAPTURE_SECONDS = 60

/** Seconds of capture progress lost per second while no enemy combat unit is in range. */
export const CAPTURE_DRAIN_RATE = 1

export const SILO_CAPTURE_ALERT = 'Your Silo was captured - retake it'

export function siloMaxHp(): number {
  return BUILDING_STATS.keep.hp * SILO_HP_MULTIPLIER
}

export function buildingMaxHp(kind: BuildingKind): number {
  if (kind === 'keep') return siloMaxHp()
  return BUILDING_STATS[kind].hp
}
