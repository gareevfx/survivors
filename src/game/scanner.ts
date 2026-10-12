import { setUnitDestination, stopMoving } from './nav'
import { unitById } from './state'
import { TILE, type MatchState, type Unit } from './types'
import { tileExplored } from './vision'

/** Keep a flight until the Hover is this close, matching the AI Drone scout. */
const HOLD = 80
/** Second Hover skips a patch already claimed this close. */
const SPREAD = 8 * TILE
/** Distance from the attacker that counts as clear. A Hover sprint ends here. */
export const HOVER_FLEE_SAFE = 10 * TILE
/** Speed multiplier while a SiloAI Hover is leaving the attacker. */
const FLEE_SPEED = 2

interface HoverFlee {
  ax: number
  ay: number
  x: number
  y: number
  phase: 'run' | 'bias'
}

const flees = new Map<number, HoverFlee>()

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
 * A SiloAI Hover that is scanning (player Scanner under ai control, or any computer Hover on its scout flight)
 * was just hit. Sprint straight away from the attacker, then the next scan avoids that spot.
 * A human Hover that is not under SiloAI is unchanged.
 */
export function noteHoverAttack(state: MatchState, hover: Unit, ax: number, ay: number): void {
  if (hover.kind !== 'drone' || hover.hp <= 0) return
  if (!(hover.owner > 0 || state.aiControl)) return
  const scanning = hover.scanning
  const dest = fleePoint(state, hover, ax, ay)
  flees.set(hover.id, { ax, ay, x: dest.x, y: dest.y, phase: 'run' })
  hover.order = { type: 'move', x: dest.x, y: dest.y }
  hover.idleAcquire = false
  hover.nodeMemory = -1
  hover.leashX = null
  hover.leashY = null
  hover.scanning = scanning
  setUnitDestination(state, hover, dest.x, dest.y)
}

/** True while the Hover should keep the sprint and not be given a new scan. */
export function hoverFleeBlocks(hover: Unit): boolean {
  const flee = flees.get(hover.id)
  if (!flee || flee.phase !== 'run') return false
  if (fleeReached(hover, flee)) {
    flee.phase = 'bias'
    return false
  }
  return true
}

/** Sprint speed, or 1 when this Hover is not leaving an attacker. */
export function hoverFleeSpeed(hover: Unit): number {
  return hoverFleeBlocks(hover) ? FLEE_SPEED : 1
}

export function hoverFleeDest(hover: Unit): { x: number; y: number } | null {
  const flee = flees.get(hover.id)
  if (!flee || flee.phase !== 'run') return null
  return { x: flee.x, y: flee.y }
}

/** The attacker to stay away from on the next scan, once the sprint is over. */
export function takeHoverFleeBias(hover: Unit): { x: number; y: number } | null {
  const flee = flees.get(hover.id)
  if (!flee || flee.phase !== 'bias') return null
  flees.delete(hover.id)
  return { x: flee.ax, y: flee.ay }
}

/** Keep each scanning Hover on a flight. Black fog first, then the oldest sighting. */
export function updateScanners(state: MatchState): void {
  if (state.outcome || state.paused) return
  const hovers = state.units.filter(
    (unit) => unit.owner === 0 && unit.kind === 'drone' && unit.hp > 0 && unit.scanning,
  )
  if (!hovers.length) return
  const black = blackRemains(state)
  const reserved: Array<{ x: number; y: number }> = []
  for (const hover of hovers) {
    if (hoverFleeBlocks(hover)) {
      const dest = hoverFleeDest(hover)
      if (dest) {
        const order = hover.order
        if (order?.type !== 'move' || Math.hypot(order.x - dest.x, order.y - dest.y) > 4) {
          const scanning = hover.scanning
          hover.order = { type: 'move', x: dest.x, y: dest.y }
          hover.scanning = scanning
          setUnitDestination(state, hover, dest.x, dest.y)
        }
        reserved.push(dest)
      }
      continue
    }
    const avoid = takeHoverFleeBias(hover)
    const order = hover.order
    if (order?.type === 'move' && !avoid) {
      const dist = Math.hypot(hover.x - order.x, hover.y - order.y)
      const revealed = black && tileExplored(state, Math.floor(order.x / TILE), Math.floor(order.y / TILE))
      if (dist > HOLD && !revealed) {
        reserved.push({ x: order.x, y: order.y })
        continue
      }
    }
    const goal = scanGoal(state, hover.x, hover.y, reserved, black, avoid)
    reserved.push(goal)
    hover.order = { type: 'move', x: goal.x, y: goal.y }
    hover.idleAcquire = false
    hover.leashX = null
    hover.leashY = null
    setUnitDestination(state, hover, goal.x, goal.y)
  }
}

function fleeReached(hover: Unit, flee: HoverFlee): boolean {
  return Math.hypot(hover.x - flee.ax, hover.y - flee.ay) >= HOVER_FLEE_SAFE - 8
    || Math.hypot(hover.x - flee.x, hover.y - flee.y) < 48
}

function fleePoint(state: MatchState, hover: Unit, ax: number, ay: number): { x: number; y: number } {
  const away = Math.atan2(hover.y - ay, hover.x - ax)
  const margin = 16
  const maxX = state.mapW * TILE - margin
  const maxY = state.mapH * TILE - margin
  let best = { x: hover.x, y: hover.y }
  let bestScore = -1
  for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const angle = (Math.hypot(hover.x - ax, hover.y - ay) < 8 ? 0 : away) + turn
    const x = Math.max(margin, Math.min(maxX, ax + Math.cos(angle) * HOVER_FLEE_SAFE))
    const y = Math.max(margin, Math.min(maxY, ay + Math.sin(angle) * HOVER_FLEE_SAFE))
    const score = Math.hypot(x - ax, y - ay) * 2 + Math.hypot(x - hover.x, y - hover.y)
    if (score > bestScore) {
      bestScore = score
      best = { x, y }
    }
  }
  return best
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
  avoid: { x: number; y: number } | null,
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
      if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < HOVER_FLEE_SAFE) continue
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
    { x: (state.mapW - 4.5) * TILE, y: 4.5 * TILE },
    { x: 4.5 * TILE, y: (state.mapH - 4.5) * TILE },
    { x: (state.mapW - 4.5) * TILE, y: (state.mapH - 4.5) * TILE },
  ]
  let best = corners[0] ?? { x: fromX, y: fromY }
  let bestD = -1
  for (const spot of corners) {
    if (crowded(reserved, spot.x, spot.y)) continue
    if (avoid && Math.hypot(spot.x - avoid.x, spot.y - avoid.y) < HOVER_FLEE_SAFE) continue
    const distance = Math.hypot(spot.x - fromX, spot.y - fromY)
    if (distance > bestD) {
      bestD = distance
      best = spot
    }
  }
  if (avoid && Math.hypot(best.x - avoid.x, best.y - avoid.y) < HOVER_FLEE_SAFE) {
    let far = best
    let farD = -1
    for (const spot of corners) {
      const distance = Math.hypot(spot.x - avoid.x, spot.y - avoid.y)
      if (distance > farD) {
        farD = distance
        far = spot
      }
    }
    return far
  }
  return best
}
