import { controlledSide, handsOff } from './control'
import { setUnitDestination, stopMoving } from './nav'
import { unitById } from './state'
import { TILE, UNIT_STATS, type MatchState, type PlayerId, type Unit } from './types'

/** Keep a flight until the Fly is this close, matching the AI Drone scout. */
const HOLD = 80
/** Second Fly skips a patch already claimed this close. */
const SPREAD = 8 * TILE
/** Steer this far clear of a combat unit or Pillar the Fly can see. */
const THREAT_GAP = 80
/** Allies inside this radius can answer a Guard call. About two screens. */
const GUARD_RADIUS = 40 * TILE
/** Seconds before the same Fly may call again. */
const GUARD_COOLDOWN = 10
const GUARD_PING = 1.2

/**
 * Turn Scanner on for the selected player Flies, or off when they are already scanning.
 * Scanner and Guard cannot both be on. A fresh scan drops the current order.
 */
export function toggleScanner(state: MatchState, ids: number[]): void {
  if (state.outcome || state.paused) return
  const hovers = playerHovers(state, ids)
  if (!hovers.length) return
  const allOn = hovers.every((hover) => hover.scanning)
  for (const hover of hovers) {
    hover.scanning = !allOn
    hover.guarding = false
    hover.guardSent = []
    hover.order = null
    hover.idleAcquire = false
    stopMoving(hover)
  }
  if (!allOn) updateScanners(state)
}

/**
 * Turn Guard on for the selected player Flies, or off when they are already guarding.
 * The Fly holds its current spot. Guard and Scanner cannot both be on.
 */
export function toggleGuard(state: MatchState, ids: number[]): void {
  if (state.outcome || state.paused) return
  const hovers = playerHovers(state, ids)
  if (!hovers.length) return
  const allOn = hovers.every((hover) => hover.guarding)
  for (const hover of hovers) {
    hover.guarding = !allOn
    hover.scanning = false
    hover.guardSent = []
    hover.order = null
    hover.idleAcquire = false
    stopMoving(hover)
  }
}

/**
 * A scanning Fly ends Grid invisibility on enemy Flies inside its sight.
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

/** Keep each scanning Fly of the controlled side on a flight across the whole map. */
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
    const threats = flyThreats(state, hover)
    const order = hover.order
    if (order?.type === 'move' && !insideThreat(hover.x, hover.y, threats)) {
      const dist = Math.hypot(hover.x - order.x, hover.y - order.y)
      const tx = Math.floor(order.x / TILE)
      const ty = Math.floor(order.y / TILE)
      const revealed = black && tx >= 0 && ty >= 0 && ty < state.mapH && tx < state.mapW && sight.explored[ty * state.mapW + tx] === 1
      const blocked = routeBlocked(hover.x, hover.y, order.x, order.y, threats)
      if (dist > HOLD && !revealed && !blocked) {
        reserved.push({ x: order.x, y: order.y })
        continue
      }
    }
    const goal = insideThreat(hover.x, hover.y, threats)
      ? escapePoint(state, hover.x, hover.y, threats)
      : scanGoal(state, hover.x, hover.y, reserved, black, sight, side === 0, threats)
    reserved.push(goal)
    hover.order = { type: 'move', x: goal.x, y: goal.y }
    hover.idleAcquire = false
    hover.leashX = null
    hover.leashY = null
    setUnitDestination(state, hover, goal.x, goal.y)
  }
}

/** A guarding Fly holds still and calls nearby combat units when an enemy combat unit enters sight. */
export function updateGuards(state: MatchState): void {
  if (state.outcome || state.paused) return
  for (const fly of state.units) {
    if (fly.kind !== 'drone' || !fly.guarding || fly.hp <= 0) continue
    if (fly.order || fly.goalX != null) {
      fly.order = null
      fly.idleAcquire = false
      stopMoving(fly)
    }
    if (fly.power <= 0 || fly.ice > 0 || fly.frozen != null) continue
    const foes = enemyCombatInSight(state, fly)
    if (!foes.length) {
      fly.guardSent = []
      continue
    }
    fly.guardSent = fly.guardSent.filter((id) => stillResponding(state, fly.owner, id))
    if (state.time < fly.guardCd) continue
    const sent = new Set(fly.guardSent)
    const nearby = nearbyCombat(state, fly).filter((unit) => !sent.has(unit.id))
    if (!nearby.length) continue
    const count = Math.ceil(nearby.length / 2)
    const picked = nearby.slice(0, count)
    const spot = foes[0]
    if (!spot) continue
    for (const ally of picked) {
      ally.order = { type: 'attackMove', x: spot.x, y: spot.y, focusId: null, focusKind: null }
      ally.scanning = false
      ally.guarding = false
      ally.idleAcquire = false
      ally.nodeMemory = -1
      ally.leashX = null
      ally.leashY = null
      setUnitDestination(state, ally, spot.x, spot.y)
      fly.guardSent.push(ally.id)
    }
    fly.guardCd = state.time + GUARD_COOLDOWN
    state.pings.push({ x: spot.x, y: spot.y, life: GUARD_PING, max: GUARD_PING, color: '#ffd24a' })
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

interface Threat {
  x: number
  y: number
  r: number
}

/** Enemy Flashers, Gorillas, and finished Pillars inside this Fly's own sight. */
function flyThreats(state: MatchState, fly: Unit): Threat[] {
  const sight = UNIT_STATS.drone.sight
  const threats: Threat[] = []
  for (const unit of state.units) {
    if (unit.owner === fly.owner || unit.hp <= 0 || unit.cloak > 0) continue
    if (unit.kind !== 'pike' && unit.kind !== 'howler') continue
    if (Math.hypot(unit.x - fly.x, unit.y - fly.y) > sight) continue
    threats.push({ x: unit.x, y: unit.y, r: THREAT_GAP })
  }
  for (const building of state.buildings) {
    if (building.owner === fly.owner || building.hp <= 0 || building.kind !== 'tower' || !building.complete) continue
    const x = (building.tx + 0.5) * TILE
    const y = (building.ty + 0.5) * TILE
    if (Math.hypot(x - fly.x, y - fly.y) > sight) continue
    threats.push({ x, y, r: THREAT_GAP })
  }
  return threats
}

function insideThreat(x: number, y: number, threats: Threat[]): boolean {
  return threats.some((threat) => Math.hypot(threat.x - x, threat.y - y) < threat.r)
}

function distToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy
  if (len2 < 1) return Math.hypot(px - x0, py - y0)
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2))
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
}

function routeBlocked(fromX: number, fromY: number, x: number, y: number, threats: Threat[]): boolean {
  if (!threats.length) return false
  if (insideThreat(x, y, threats)) return true
  if (insideThreat(fromX, fromY, threats)) return false
  return threats.some((threat) => distToSegment(threat.x, threat.y, fromX, fromY, x, y) < threat.r)
}

function escapePoint(state: MatchState, fromX: number, fromY: number, threats: Threat[]): { x: number; y: number } {
  let ax = 0
  let ay = 0
  for (const threat of threats) {
    const dx = fromX - threat.x
    const dy = fromY - threat.y
    const distance = Math.hypot(dx, dy) || 1
    if (distance > threat.r + TILE * 6) continue
    ax += dx / distance
    ay += dy / distance
  }
  const mag = Math.hypot(ax, ay) || 1
  return {
    x: Math.max(TILE, Math.min(state.mapW * TILE - TILE, fromX + (ax / mag) * TILE * 8)),
    y: Math.max(TILE, Math.min(state.mapH * TILE - TILE, fromY + (ay / mag) * TILE * 8)),
  }
}

/**
 * Farthest unexplored tile, then the least recently seen tile that is not in sight.
 * A straight flight that would cross a seen combat unit or Pillar is skipped.
 * Reserved goals keep a second Fly off the same patch.
 */
function scanGoal(
  state: MatchState,
  fromX: number,
  fromY: number,
  reserved: Array<{ x: number; y: number }>,
  black: boolean,
  sight: { explored: Uint8Array; visible: Uint8Array },
  remember: boolean,
  threats: Threat[],
): { x: number; y: number } {
  let farthest: { x: number; y: number; d: number } | null = null
  let oldest: { x: number; y: number; score: number } | null = null
  for (let ty = 0; ty < state.mapH; ty += 2) {
    for (let tx = 0; tx < state.mapW; tx += 2) {
      const index = ty * state.mapW + tx
      const x = (tx + 0.5) * TILE
      const y = (ty + 0.5) * TILE
      const from = Math.hypot(x - fromX, y - fromY)
      if (from < TILE * 2) continue
      if (crowded(reserved, x, y)) continue
      if (routeBlocked(fromX, fromY, x, y, threats)) continue
      if (black) {
        if (sight.explored[index] !== 0) continue
        if (!farthest || from > farthest.d) farthest = { x, y, d: from }
        continue
      }
      if (sight.visible[index] === 1) continue
      const age = remember ? state.seenAt[index] : 0
      const score = age * 100000 + from
      if (!oldest || score < oldest.score) oldest = { x, y, score }
    }
  }
  if (farthest) return { x: farthest.x, y: farthest.y }
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
    if (routeBlocked(fromX, fromY, spot.x, spot.y, threats)) continue
    const distance = Math.hypot(spot.x - fromX, spot.y - fromY)
    if (distance > bestD) {
      bestD = distance
      best = spot
    }
  }
  if (bestD < 0 && threats.length) return escapePoint(state, fromX, fromY, threats)
  return best
}

function enemyCombatInSight(state: MatchState, fly: Unit): Array<{ x: number; y: number; d: number }> {
  const sight = UNIT_STATS.drone.sight
  const foes: Array<{ x: number; y: number; d: number }> = []
  for (const unit of state.units) {
    if (unit.owner === fly.owner || unit.hp <= 0 || unit.cloak > 0) continue
    if (unit.kind !== 'pike' && unit.kind !== 'howler') continue
    const distance = Math.hypot(unit.x - fly.x, unit.y - fly.y)
    if (distance > sight) continue
    foes.push({ x: unit.x, y: unit.y, d: distance })
  }
  foes.sort((a, b) => a.d - b.d)
  return foes
}

function nearbyCombat(state: MatchState, fly: Unit): Unit[] {
  const allies: Unit[] = []
  for (const unit of state.units) {
    if (unit.owner !== fly.owner || unit.hp <= 0 || unit.id === fly.id) continue
    if (unit.kind !== 'pike' && unit.kind !== 'howler') continue
    if (unit.frozen != null || unit.power <= 0 || unit.ice > 0) continue
    const distance = Math.hypot(unit.x - fly.x, unit.y - fly.y)
    if (distance > GUARD_RADIUS) continue
    allies.push(unit)
  }
  allies.sort((a, b) => Math.hypot(a.x - fly.x, a.y - fly.y) - Math.hypot(b.x - fly.x, b.y - fly.y))
  return allies
}

function stillResponding(state: MatchState, owner: PlayerId, id: number): boolean {
  const ally = unitById(state, id)
  if (!ally || ally.hp <= 0 || ally.owner !== owner) return false
  const order = ally.order
  return order?.type === 'attack' || order?.type === 'attackMove'
}
