import { BUILDING_STATS, UNIT_STATS, type BuildingKind } from './types'

/** After a capture, the Stalker already belongs to the captor and cannot act or be captured again for this long. */
export const STALKER_CAPTURE_STUN_SECONDS = 20

/** Applied to the Silo's listed max hit points. Repair and a finished capture both restore this much. */
export const SILO_HP_MULTIPLIER = 3

/** Enemy combat units must stand in weapon range of a ruined Silo for this long to take it. */
export const SILO_CAPTURE_SECONDS = 60

/** Seconds of capture progress lost per second while no enemy combat unit is in range. */
export const CAPTURE_DRAIN_RATE = 1

export const SILO_CAPTURE_ALERT = 'Your Silo was captured - retake it'

/** A unit above this fraction of Power walks past a battery and does not pick it up. */
export const BATTERY_PICKUP_MAX = 0.9

/** A unit that stays at 0 Power for this long becomes one Dumps pile. */
export const DRY_TRASH_SECONDS = 60

/** Dumps in the pile left by a destroyed or expired discharged unit. */
export const DISCHARGED_DUMPS = 15

/** Power a Stalker restores when it finishes reviving a discharged unit. */
export const REVIVE_POWER = 0.3

/** Seconds to train one Flasher or one Fly. */
export const FLASHER_TRAIN_SECONDS = 8
export const FLY_TRAIN_SECONDS = 8

/** Seconds to train one Gorilla or one Frog. */
export const GORILLA_TRAIN_SECONDS = 10
export const FROG_TRAIN_SECONDS = 10

/** A full Power bar on a Flasher or Frog reaches 0 in this many seconds. */
export const FLASHER_BATTERY_SECONDS = 2 * 60
export const FROG_BATTERY_SECONDS = 2 * 60

/** A full Power bar on a Gorilla reaches 0 in this many seconds. */
export const GORILLA_BATTERY_SECONDS = 3 * 60

/** A full Power bar on a Fly reaches 0 in this many seconds. The sim reads HOVER_POWER_SECONDS, the same 90. */
export const FLY_BATTERY_SECONDS = 90

/** A Gorilla spends this long folding into a gun, or unfolding back into a tank. */
export const ARTILLERY_SECONDS = 10

/** Flash doubles a Flasher's speed for this long. */
export const FLASH_SECONDS = 5

/** Seconds before that Flasher can Flash again. The boost itself sits inside this. */
export const FLASH_COOLDOWN = 20

/** Stalkers standing on an enemy Silo ruin capture it in this many seconds. Combat units still take 60. */
export const STALKER_RUIN_CAPTURE_SECONDS = 240

UNIT_STATS.pike.trainTime = FLASHER_TRAIN_SECONDS
UNIT_STATS.howler.trainTime = GORILLA_TRAIN_SECONDS
UNIT_STATS.drone.trainTime = FLY_TRAIN_SECONDS
UNIT_STATS.frog.trainTime = FROG_TRAIN_SECONDS

export function siloMaxHp(): number {
  return BUILDING_STATS.keep.hp * SILO_HP_MULTIPLIER
}

export function buildingMaxHp(kind: BuildingKind): number {
  if (kind === 'keep') return siloMaxHp()
  return BUILDING_STATS[kind].hp
}
