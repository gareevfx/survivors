import { controlledSide, handsOff } from './control'
import { setUnitDestination, stopMoving } from './nav'
import { unitById } from './state'
import { TILE, UNIT_STATS, type MatchState, type PlayerId, type Unit } from './types'

/** Keep a flight until the Hover is this close, matching the AI Drone scout. */
const HOLD = 80
/** Second Hover skips a patch already claimed this close. */
const SPREAD = 8 * TILE

/**
 * Turn Scanner on for the selected player Hovers, or off when they are already scanning.
 * A fresh scan drops the current order so the next flight is the nearest black fog.
 */
export function toggleScanner(state: MatchState, ids: number[]): void {
  if (state.outcome || state.paused) return
  const hovers = playerHovers(state, ids)
  if (!hovers.length) return
  const allOn = hovers.every((hover) => hover.scanning)
  for (const hover of hovers) {
    hover.scanning = !allOn
    hover.order = null
    hover.idleAcquire = false
    stopMoving(hover)
  }
  if (!allOn) updateScanners(state)
}

/**
 * A scanning Hover ends Grid invisibility on enemy Hovers inside its sight.
 * The cloak stays off after the scanner leaves. A later Grid order can hide them again.
 */
export function revealCloakedByScanners(state: MatchState): void {
  const sight = UNIT_STATS.drone.sight
  const scanners = state.units.filter((unit) => unit.kind === 'drone' && unit.hp > 0 && unit.scanning)
  if (!scanners.length) return
  for (const hidden of state.units) {
    if (hidden.kind !== 'drone' || hidden.hp <= 0 || hidden.cloak <= 0) continue
    for (const scanner of scanners) {
      if (scanner.owner === hidden.owner) continue
      if (Math.hypot(scanner.x - hidden.x, scanner.y - hidden.y) <= sight) {
        hidden.cloak = 0
        break
      }
    }
  }
}

/** Keep each scanning Hover of the controlled side on a flight. Black fog first, then the oldest sighting. */
export function updateScanners(state: MatchState): void {
  if (state.outcome || state.paused || handsOff(state)) return
  const side = controlledSide(state)
  const hovers = state.units.filter(
    (unit) => unit.owner === side && unit.kind === 'drone' && unit.hp > 0 && unit.power > 0 && unit.ice <= 0 && unit.scanning,
  )
  if (!hovers.length) return
  const sight = sightGrids(state, side)
  const black = blackRemains(sight.explored)
  const reserved: Array<{ x: number; y: number }> = []
  for (const hover of hovers) {
    const order = hover.order
    if (order?.type === 'move') {
      const dist = Math.hypot(hover.x - order.x, hover.y - order.y)
      const tx = Math.floor(order.x / TILE)
      const ty = Math.floor(order.y / TILE)
      const revealed = black && tx >= 0 && ty >= 0 && ty < state.mapH && tx < state.mapW && sight.explored[ty * state.mapW + tx] === 1
      if (dist > HOLD && !revealed) {
        reserved.push({ x: order.x, y: order.y })
        continue
      }
    }
    const goal = scanGoal(state, hover.x, hover.y, reserved, black, sight, side === 0)
    reserved.push(goal)
    hover.order = { type: 'move', x: goal.x, y: goal.y }
    hover.idleAcquire = false
    hover.leashX = null
    hover.leashY = null
    setUnitDestination(state, hover, goal.x, goal.y)
  }
}

function playerHovers(state: MatchState, ids: number[]): Unit[] {
  const side = controlledSide(state)
  const hovers: Unit[] = []
  for (const id of ids) {
    const unit = unitById(state, id)
    if (unit && unit.owner === side && unit.kind === 'drone' && unit.hp > 0 && unit.power > 0 && unit.ice <= 0) hovers.push(unit)
  }
  return hovers
}

function sightGrids(state: MatchState, owner: PlayerId): { explored: Uint8Array; visible: Uint8Array } {
  if (owner === 0) return { explored: state.explored, visible: state.visible }
  if (owner === 1) return { explored: state.aiExplored, visible: state.aiVisible }
  return {
    explored: state.sideExplored[owner] ?? state.explored,
    visible: state.sideVisible[owner] ?? state.visible,
  }
}

function blackRemains(explored: Uint8Array): boolean {
  for (let i = 0; i < explored.length; i++) {
    if (explored[i] === 0) return true
  }
  return false
}

function crowded(reserved: Array<{ x: number; y: number }>, x: number, y: number): boolean {
  return reserved.some((spot) => Math.hypot(spot.x - x, spot.y - y) < SPREAD)
}

/**
 * Nearest unexplored tile, then the least recently seen tile that is not in sight.
 * Reserved goals keep a second Hover off the same patch, as the AI Drone scout does.
 */
function scanGoal(
  state: MatchState,
  fromX: number,
  fromY: number,
  reserved: Array<{ x: number; y: number }>,
  black: boolean,
  sight: { explored: Uint8Array; visible: Uint8Array },
  remember: boolean,
): { x: number; y: number } {
  let nearest: { x: number; y: number; d: number } | null = null
  let oldest: { x: number; y: number; score: number } | null = null
  for (let ty = 0; ty < state.mapH; ty += 2) {
    for (let tx = 0; tx < state.mapW; tx += 2) {
      const index = ty * state.mapW + tx
      const x = (tx + 0.5) * TILE
      const y = (ty + 0.5) * TILE
      const from = Math.hypot(x - fromX, y - fromY)
      if (from < TILE * 2) continue
      if (crowded(reserved, x, y)) continue
      if (black) {
        if (sight.explored[index] !== 0) continue
        if (!nearest || from < nearest.d) nearest = { x, y, d: from }
        continue
      }
      if (sight.visible[index] === 1) continue
      const age = remember ? state.seenAt[index] : 0
      const score = age * 100000 + from
      if (!oldest || score < oldest.score) oldest = { x, y, score }
    }
  }
  if (nearest) return { x: nearest.x, y: nearest.y }
  if (oldest) return { x: oldest.x, y: oldest.y }
  const corners = [
    { x: 4.5 * TILE, y: 4.5 * TILE },
    { x: (state.mapW - 4.5) * TILE, y: 4.5 * TILE },
    { x: 4.5 * TILE, y: (state.mapH - 4.5) * TILE },
    { x: (state.mapW - 4.5) * TILE, y: (state.mapH - 4.5) * TILE },
  ]
  let best = corners[0] ?? { x: fromX, y: fromY }
  let bestD = -1
  for (const spot of corners) {
    if (crowded(reserved, spot.x, spot.y)) continue
    const distance = Math.hypot(spot.x - fromX, spot.y - fromY)
    if (distance > bestD) {
      bestD = distance
      best = spot
    }
  }
  return best
}
