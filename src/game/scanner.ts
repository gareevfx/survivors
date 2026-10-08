import { setUnitDestination, stopMoving } from './nav'
import { unitById } from './state'
import { MAP_H, MAP_W, TILE, type MatchState, type Unit } from './types'
import { tileExplored } from './vision'

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

/** Keep each scanning Hover on a flight. Black fog first, then the oldest sighting. */
export function updateScanners(state: MatchState): void {
  if (state.outcome || state.paused || state.aiControl) return
  const hovers = state.units.filter(
    (unit) => unit.owner === 0 && unit.kind === 'drone' && unit.hp > 0 && unit.scanning,
  )
  if (!hovers.length) return
  const black = blackRemains(state)
  const reserved: Array<{ x: number; y: number }> = []
  for (const hover of hovers) {
    const order = hover.order
    if (order?.type === 'move') {
      const dist = Math.hypot(hover.x - order.x, hover.y - order.y)
      const revealed = black && tileExplored(state, Math.floor(order.x / TILE), Math.floor(order.y / TILE))
      if (dist > HOLD && !revealed) {
        reserved.push({ x: order.x, y: order.y })
        continue
      }
    }
    const goal = scanGoal(state, hover.x, hover.y, reserved, black)
    reserved.push(goal)
    hover.order = { type: 'move', x: goal.x, y: goal.y }
    hover.idleAcquire = false
    hover.leashX = null
    hover.leashY = null
    setUnitDestination(state, hover, goal.x, goal.y)
  }
}

function playerHovers(state: MatchState, ids: number[]): Unit[] {
  const hovers: Unit[] = []
  for (const id of ids) {
    const unit = unitById(state, id)
    if (unit && unit.owner === 0 && unit.kind === 'drone' && unit.hp > 0) hovers.push(unit)
  }
  return hovers
}

function blackRemains(state: MatchState): boolean {
  for (let i = 0; i < state.explored.length; i++) {
    if (state.explored[i] === 0) return true
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
): { x: number; y: number } {
  let nearest: { x: number; y: number; d: number } | null = null
  let oldest: { x: number; y: number; score: number } | null = null
  for (let ty = 0; ty < MAP_H; ty += 2) {
    for (let tx = 0; tx < MAP_W; tx += 2) {
      const index = ty * MAP_W + tx
      const x = (tx + 0.5) * TILE
      const y = (ty + 0.5) * TILE
      const from = Math.hypot(x - fromX, y - fromY)
      if (from < TILE * 2) continue
      if (crowded(reserved, x, y)) continue
      if (black) {
        if (state.explored[index] !== 0) continue
        if (!nearest || from < nearest.d) nearest = { x, y, d: from }
        continue
      }
      if (state.visible[index] === 1) continue
      const score = state.seenAt[index] * 100000 + from
      if (!oldest || score < oldest.score) oldest = { x, y, score }
    }
  }
  if (nearest) return { x: nearest.x, y: nearest.y }
  if (oldest) return { x: oldest.x, y: oldest.y }
  const corners = [
    { x: 4.5 * TILE, y: 4.5 * TILE },
    { x: (MAP_W - 4.5) * TILE, y: 4.5 * TILE },
    { x: 4.5 * TILE, y: (MAP_H - 4.5) * TILE },
    { x: (MAP_W - 4.5) * TILE, y: (MAP_H - 4.5) * TILE },
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
