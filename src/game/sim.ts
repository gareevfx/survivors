import { updateAi } from './ai'
import { assignMiners, fillOpenGatherSlots } from './commands'
import { gatherBlockRock, nearestParking, setUnitDestination, stopMoving } from './nav'
import {
  buildingById,
  buildingCenter,
  buildingRect,
  buildingTarget,
  distToRect,
  getTarget,
  pushToast,
  rebuildBlocked,
  recomputeSupply,
  rockById,
  unitById,
  unitTarget,
} from './state'
import {
  AGGRO_RANGE,
  BUILDING_STATS,
  CHASE_BREAK,
  GATHER_AMOUNT,
  GATHER_TIME,
  INTERACT,
  MAP_W,
  TILE,
  UNIT_STATS,
  type Building,
  type MatchState,
  type Order,
  type Target,
  type Unit,
} from './types'

export function step(state: MatchState, dt: number): void {
  if (state.outcome) return
  state.time += dt
  updateAi(state, dt)

  for (const unit of state.units) refreshUnit(state, unit, dt)
  for (const unit of state.units) moveUnit(state, unit, dt)
  separate(state)
  advanceGather(state, dt)
  advanceConstruct(state, dt)
  advanceProduction(state, dt)

  for (const unit of state.units) {
    unit.attackCd = Math.max(0, unit.attackCd - dt)
    unit.hitFlash = Math.max(0, unit.hitFlash - dt)
    unit.hurtTimer = Math.max(0, unit.hurtTimer - dt)
    tryFire(state, unit)
  }
  for (const building of state.buildings) building.hitFlash = Math.max(0, building.hitFlash - dt)
  for (const rock of state.rocks) rock.hitFlash = Math.max(0, rock.hitFlash - dt)
  updateProjectiles(state, dt)
  cleanup(state)
  fillOpenGatherSlots(state)
  fadeEffects(state, dt)
  recomputeSupply(state)
}

function refreshUnit(state: MatchState, unit: Unit, dt: number): void {
  unit.repathIn = Math.max(0, unit.repathIn - dt)
  const order = unit.order
  if (!order) {
    if (unit.kind === 'porter' && unit.cargo > 0) {
      unit.order = { type: 'gather', nodeId: unit.nodeMemory, phase: 'return' }
      return
    }
    if (unit.kind !== 'porter') {
      const stats = UNIT_STATS[unit.kind]
      const foe =
        nearestHostile(state, unit, stats.sight, false) ??
        nearestHostile(state, unit, stats.range + 28, true)
      if (foe && (foe.targetKind === 'unit' || dist(unit, foe) <= stats.range + foe.radius)) {
        unit.order = { type: 'attack', targetId: foe.id, kind: foe.targetKind }
        unit.idleAcquire = true
        unit.leashX = unit.x
        unit.leashY = unit.y
        stopMoving(unit)
      }
    }
    return
  }

  if (order.type === 'move') {
    if (unit.goalX == null) setUnitDestination(state, unit, order.x, order.y)
    return
  }

  if (order.type === 'attackMove') {
    let focus =
      order.focusId != null && order.focusKind ? getTarget(state, order.focusId, order.focusKind) : null
    if (focus && (!isAttackable(unit, focus) || dist(unit, focus) > CHASE_BREAK)) focus = null
    if (!focus) {
      order.focusId = null
      order.focusKind = null
      const foe = nearestHostile(state, unit, AGGRO_RANGE, true)
      if (foe) {
        order.focusId = foe.id
        order.focusKind = foe.targetKind
        focus = foe
      }
    }
    if (focus) holdOrApproach(state, unit, focus)
    else if (unit.goalX == null) setUnitDestination(state, unit, order.x, order.y)
    return
  }

  if (order.type === 'attack') {
    const focus = getTarget(state, order.targetId, order.kind)
    if (!focus || !isAttackable(unit, focus)) {
      unit.order = null
      unit.idleAcquire = false
      stopMoving(unit)
      return
    }
    if (unit.idleAcquire && unit.leashX != null && unit.leashY != null) {
      const away = Math.hypot(unit.x - unit.leashX, unit.y - unit.leashY)
      if (away > AGGRO_RANGE * 1.6 || dist(unit, focus) > CHASE_BREAK) {
        const lx = unit.leashX
        const ly = unit.leashY
        unit.idleAcquire = false
        unit.order = { type: 'move', x: lx, y: ly }
        setUnitDestination(state, unit, lx, ly)
        return
      }
    }
    holdOrApproach(state, unit, focus)
    return
  }

  if (order.type === 'gather') {
    refreshGather(state, unit, order)
    return
  }

  refreshConstruct(state, unit, order)
}

function holdOrApproach(state: MatchState, unit: Unit, focus: Target): void {
  if (inWeaponRange(unit, focus)) {
    stopMoving(unit)
    unit.facing = Math.atan2(focus.y - unit.y, focus.x - unit.x)
    return
  }
  const stand = standPoint(unit, focus)
  const far = unit.goalX == null || Math.hypot((unit.goalX ?? 0) - stand.x, (unit.goalY ?? 0) - stand.y) > 24
  if (far && unit.repathIn <= 0) {
    setUnitDestination(state, unit, stand.x, stand.y)
    unit.repathIn = 0.4
  }
}

function standPoint(unit: Unit, focus: Target): { x: number; y: number } {
  const stats = UNIT_STATS[unit.kind]
  const dx = unit.x - focus.x
  const dy = unit.y - focus.y
  const d = Math.hypot(dx, dy) || 1
  const reach = stats.range + focus.radius * 0.85
  const stand = Math.max(focus.radius + stats.radius + 4, reach * 0.86)
  return { x: focus.x + (dx / d) * stand, y: focus.y + (dy / d) * stand }
}

function inWeaponRange(unit: Unit, focus: Target): boolean {
  const stats = UNIT_STATS[unit.kind]
  return dist(unit, focus) <= stats.range + focus.radius * 0.85
}

function dist(unit: Unit, focus: Target): number {
  return Math.hypot(unit.x - focus.x, unit.y - focus.y)
}

function refreshGather(state: MatchState, unit: Unit, order: Extract<Order, { type: 'gather' }>): void {
  const node = state.ore.find((entry) => entry.id === order.nodeId) ?? null
  if ((!node || node.amount <= 0) && unit.cargo <= 0) {
    if (order.phase !== 'return') {
      assignMiners(state, [unit], null)
      return
    }
    if (unit.cargo <= 0) {
      unit.order = null
      unit.nodeMemory = 0
      stopMoving(unit)
      return
    }
  }

  if (order.phase === 'mine') {
    if (!node || node.amount <= 0 || distToTile(unit, node.tx, node.ty) > INTERACT) {
      order.phase = 'approach'
      stopMoving(unit)
    } else {
      stopMoving(unit)
      const cx = (node.tx + 0.5) * TILE
      const cy = (node.ty + 0.5) * TILE
      unit.facing = Math.atan2(cy - unit.y, cx - unit.x)
    }
    return
  }

  if (order.phase === 'approach') {
    if (unit.cargo > 0) {
      order.phase = 'return'
      stopMoving(unit)
      return
    }
    if (!node || node.amount <= 0) {
      assignMiners(state, [unit], null)
      return
    }
    if (distToTile(unit, node.tx, node.ty) <= INTERACT) {
      order.phase = 'mine'
      unit.gatherTimer = 0
      stopMoving(unit)
      return
    }
    if (unit.goalX == null) {
      const spot = nearestParking(state, node.tx, node.ty, 1, 1, unit.x, unit.y)
      if (!spot) {
        if (!clearBlockedGather(state, unit, node)) unit.order = null
        return
      }
      if (!setUnitDestination(state, unit, spot.x, spot.y)) clearBlockedGather(state, unit, node)
    }
    return
  }

  const keep = nearestCompleteKeep(state, unit.owner, unit.x, unit.y)
  if (!keep) {
    stopMoving(unit)
    return
  }
  if (distToRect(unit.x, unit.y, buildingRect(keep)) <= INTERACT) {
    stopMoving(unit)
    return
  }
  if (unit.goalX == null) {
    const stats = BUILDING_STATS.keep
    const spot = nearestParking(state, keep.tx, keep.ty, stats.w, stats.h, unit.x, unit.y)
    if (spot) setUnitDestination(state, unit, spot.x, spot.y)
  }
}

function refreshConstruct(state: MatchState, unit: Unit, order: Extract<Order, { type: 'construct' }>): void {
  const building = buildingById(state, order.buildingId)
  if (!building || building.hp <= 0 || building.complete) {
    unit.order = null
    stopMoving(unit)
    return
  }
  const rect = buildingRect(building)
  if (distToRect(unit.x, unit.y, rect) <= INTERACT) {
    stopMoving(unit)
    const center = buildingCenter(building)
    unit.facing = Math.atan2(center.y - unit.y, center.x - unit.x)
    return
  }
  if (unit.goalX == null) {
    const stats = BUILDING_STATS[building.kind]
    const spot = nearestParking(state, building.tx, building.ty, stats.w, stats.h, unit.x, unit.y)
    if (spot) setUnitDestination(state, unit, spot.x, spot.y)
  }
}

function distToTile(unit: Unit, tx: number, ty: number): number {
  const rect = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE }
  return distToRect(unit.x, unit.y, rect)
}

function clearBlockedGather(state: MatchState, unit: Unit, node: { id: number; tx: number; ty: number }): boolean {
  if (unit.owner !== 0 || unit.kind !== 'porter') return false
  const rock = gatherBlockRock(state, unit, node)
  if (!rock) return false
  unit.order = { type: 'attack', targetId: rock.id, kind: 'rock', resumeNode: node.id }
  unit.nodeMemory = node.id
  stopMoving(unit)
  return true
}

function resumeGather(state: MatchState, unit: Unit, nodeId: number): void {
  const node = state.ore.find((entry) => entry.id === nodeId && entry.amount > 0)
  if (!node) {
    unit.nodeMemory = 0
    return
  }
  const rock = gatherBlockRock(state, unit, node)
  unit.nodeMemory = nodeId
  if (rock) unit.order = { type: 'attack', targetId: rock.id, kind: 'rock', resumeNode: nodeId }
  else unit.order = { type: 'gather', nodeId, phase: unit.cargo > 0 ? 'return' : 'approach' }
  stopMoving(unit)
}

function nearestCompleteKeep(state: MatchState, owner: 0 | 1, x: number, y: number): Building | null {
  let best: Building | null = null
  let bestD = Infinity
  for (const building of state.buildings) {
    if (building.owner !== owner || building.kind !== 'keep' || !building.complete || building.hp <= 0) continue
    const center = buildingCenter(building)
    const d = (center.x - x) ** 2 + (center.y - y) ** 2
    if (d < bestD) {
      bestD = d
      best = building
    }
  }
  return best
}

function moveUnit(state: MatchState, unit: Unit, dt: number): void {
  let left = dt
  let blockedStep = false
  let guard = 0
  while (left > 0.0001 && unit.goalX != null && unit.goalY != null && guard++ < 6) {
    const usingPath = unit.path.length > 0
    const point = usingPath ? unit.path[0] : null
    const tx = point ? point.x : unit.goalX
    const ty = point ? point.y : unit.goalY
    if (tx == null || ty == null) break
    const dx = tx - unit.x
    const dy = ty - unit.y
    const distance = Math.hypot(dx, dy)
    const arrive = usingPath ? 5 : 3.5
    if (distance <= arrive) {
      if (usingPath) {
        unit.path.shift()
        continue
      }
      unit.x = tx
      unit.y = ty
      unit.goalX = null
      unit.goalY = null
      unit.repathIn = 0
      if (unit.order?.type === 'move') unit.order = null
      if (unit.order?.type === 'attackMove' && unit.order.focusId == null) {
        if (Math.hypot(unit.x - unit.order.x, unit.y - unit.order.y) < 22) unit.order = null
      }
      break
    }
    const speed = UNIT_STATS[unit.kind].speed
    const stepLen = Math.min(distance, speed * left)
    const ox = unit.x
    const oy = unit.y
    tryMove(state, unit, (dx / distance) * stepLen, (dy / distance) * stepLen)
    unit.facing = Math.atan2(dy, dx)
    const moved = Math.hypot(unit.x - ox, unit.y - oy)
    if (moved < stepLen * 0.2) {
      blockedStep = true
      break
    }
    left -= stepLen / speed
  }
  unit.anim += dt * 7
  if (unit.goalX != null && blockedStep) unit.stuckT += dt
  else unit.stuckT = 0
  if (unit.stuckT > 0.85 && unit.goalX != null && unit.goalY != null) {
    unit.stuckT = 0
    const gx = unit.goalX
    const gy = unit.goalY
    unit.path = []
    setUnitDestination(state, unit, gx, gy)
  }
}

function tryMove(state: MatchState, unit: Unit, dx: number, dy: number): void {
  const radius = UNIT_STATS[unit.kind].radius * 0.45
  if (!circleBlocked(state, unit.x + dx, unit.y + dy, radius)) {
    unit.x += dx
    unit.y += dy
    return
  }
  if (!circleBlocked(state, unit.x + dx, unit.y, radius)) {
    unit.x += dx
    return
  }
  if (!circleBlocked(state, unit.x, unit.y + dy, radius)) unit.y += dy
}

function circleBlocked(state: MatchState, x: number, y: number, radius: number): boolean {
  const samples: Array<[number, number]> = [
    [0, 0],
    [radius, 0],
    [-radius, 0],
    [0, radius],
    [0, -radius],
  ]
  for (const [ox, oy] of samples) {
    const tx = Math.floor((x + ox) / TILE)
    const ty = Math.floor((y + oy) / TILE)
    if (tx < 0 || ty < 0 || tx >= 48 || ty >= 48) return true
    if (state.blocked[ty * 48 + tx]) return true
  }
  return false
}

function separate(state: MatchState): void {
  const units = state.units
  for (let i = 0; i < units.length; i++) {
    const a = units[i]
    if (!a || a.hp <= 0) continue
    for (let j = i + 1; j < units.length; j++) {
      const b = units[j]
      if (!b || b.hp <= 0) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const distance = Math.hypot(dx, dy) || 0.001
      const min = UNIT_STATS[a.kind].radius + UNIT_STATS[b.kind].radius - 1
      if (distance >= min) continue
      const wa = isStationary(a) ? 0 : 1
      const wb = isStationary(b) ? 0 : 1
      if (wa + wb === 0) continue
      const overlap = min - distance
      const ox = (dx / distance) * overlap
      const oy = (dy / distance) * overlap
      if (wa) tryMove(state, a, (-ox * wa) / (wa + wb), (-oy * wa) / (wa + wb))
      if (wb) tryMove(state, b, (ox * wb) / (wa + wb), (oy * wb) / (wa + wb))
    }
  }
}

function isStationary(unit: Unit): boolean {
  if (unit.goalX != null) return false
  const order = unit.order
  if (!order) return false
  return order.type === 'attack' || order.type === 'attackMove' || order.type === 'gather' || order.type === 'construct'
}

function advanceGather(state: MatchState, dt: number): void {
  for (const unit of state.units) {
    const order = unit.order
    if (!order || order.type !== 'gather') continue
    if (order.phase === 'mine') {
      const node = state.ore.find((entry) => entry.id === order.nodeId)
      if (!node || node.amount <= 0) continue
      if (unit.hurtTimer > 0 && nearestHostile(state, unit, UNIT_STATS.porter.range + 12, false)) continue
      unit.gatherTimer += dt
      if (unit.gatherTimer < GATHER_TIME) continue
      const take = Math.min(GATHER_AMOUNT, node.amount)
      node.amount -= take
      unit.cargo = take
      unit.nodeMemory = node.id
      unit.gatherTimer = 0
      if (node.amount <= 0) {
        burst(state, (node.tx + 0.5) * TILE, (node.ty + 0.5) * TILE, '#e6c15a', 6)
        if (state.selectedOre === node.id) state.selectedOre = null
        state.ore = state.ore.filter((entry) => entry.amount > 0)
        rebuildBlocked(state)
      }
      order.phase = 'return'
      stopMoving(unit)
      continue
    }
    if (order.phase !== 'return' || unit.cargo <= 0) continue
    const keep = nearestCompleteKeep(state, unit.owner, unit.x, unit.y)
    if (!keep) continue
    if (distToRect(unit.x, unit.y, buildingRect(keep)) > INTERACT) continue
    state.oreHeld[unit.owner] += unit.cargo
    if (unit.owner === 0) state.tutorial = false
    state.particles.push({
      x: unit.x,
      y: unit.y - 18,
      vx: 0,
      vy: -28,
      life: 1.15,
      max: 1.15,
      r: 0,
      color: '#ffe7a0',
      text: `+${unit.cargo}`,
    })
    unit.cargo = 0
    assignMiners(state, [unit], order.nodeId)
  }
}

function advanceConstruct(state: MatchState, dt: number): void {
  for (const building of state.buildings) {
    if (building.complete || building.hp <= 0) continue
    const crew = state.units.filter((unit) => {
      if (unit.hp <= 0 || unit.order?.type !== 'construct' || unit.order.buildingId !== building.id) return false
      return distToRect(unit.x, unit.y, buildingRect(building)) <= INTERACT
    })
    // A site with no worker in range is paused. Progress stays where it is until someone returns.
    if (!crew.length) continue
    const speed = 1 + (crew.length - 1) * 0.6
    building.progress += (dt * speed) / BUILDING_STATS[building.kind].buildTime
    if (building.progress < 1) continue
    building.progress = 1
    building.complete = true
    for (const unit of crew) {
      unit.order = null
      stopMoving(unit)
    }
    recomputeSupply(state)
    if (building.owner === 0) {
      state.events.push({ type: 'ready' })
      pushToast(state, `${BUILDING_STATS[building.kind].label} finished.`)
    }
  }
}

function advanceProduction(state: MatchState, dt: number): void {
  for (const building of state.buildings) {
    if (!building.complete || building.hp <= 0) continue
    const job = building.queue[0]
    if (!job) continue
    job.remaining -= dt
    if (job.remaining > 0) continue
    building.queue.shift()
    spawnTrained(state, building, job.kind)
    if (building.owner === 0) state.events.push({ type: 'ready' })
  }
}

function spawnTrained(state: MatchState, building: Building, kind: Unit['kind']): void {
  const stats = BUILDING_STATS[building.kind]
  const spots: Array<{ x: number; y: number }> = []
  for (let y = building.ty - 1; y <= building.ty + stats.h; y++) {
    for (let x = building.tx - 1; x <= building.tx + stats.w; x++) {
      const inside = x >= building.tx && x < building.tx + stats.w && y >= building.ty && y < building.ty + stats.h
      if (inside) continue
      if (x < 0 || y < 0 || x >= 48 || y >= 48) continue
      if (state.blocked[y * 48 + x]) continue
      spots.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE })
    }
  }
  spots.sort(
    (a, b) =>
      Math.hypot(a.x - building.rallyX, a.y - building.rallyY) -
      Math.hypot(b.x - building.rallyX, b.y - building.rallyY),
  )
  const spot = spots[building.spawnN++ % Math.max(1, spots.length)] ?? {
    x: building.rallyX,
    y: building.rallyY,
  }
  const unit: Unit = {
    id: state.nextId++,
    owner: building.owner,
    kind,
    x: spot.x,
    y: spot.y,
    hp: UNIT_STATS[kind].hp,
    facing: Math.atan2(building.rallyY - spot.y, building.rallyX - spot.x),
    anim: 0,
    order: null,
    path: [],
    goalX: null,
    goalY: null,
    attackCd: 0,
    hurtTimer: 0,
    hitFlash: 0,
    cargo: 0,
    gatherTimer: 0,
    stuckT: 0,
    leashX: null,
    leashY: null,
    idleAcquire: false,
    nodeMemory: -1,
    repathIn: 0,
  }
  state.units.push(unit)
  if (Math.hypot(building.rallyX - spot.x, building.rallyY - spot.y) > 20) {
    unit.order = { type: 'move', x: building.rallyX, y: building.rallyY }
    setUnitDestination(state, unit, building.rallyX, building.rallyY)
  }
}

function tryFire(state: MatchState, unit: Unit): void {
  if (unit.attackCd > 0 || unit.hp <= 0) return
  const target = pickFireTarget(state, unit)
  if (!target || !inWeaponRange(unit, target)) return
  const stats = UNIT_STATS[unit.kind]
  unit.attackCd = stats.cooldown
  unit.facing = Math.atan2(target.y - unit.y, target.x - unit.x)
  state.projectiles.push({
    id: state.nextId++,
    owner: unit.owner,
    sourceId: unit.id,
    x: unit.x + Math.cos(unit.facing) * (stats.radius + 3),
    y: unit.y + Math.sin(unit.facing) * (stats.radius + 3),
    targetId: target.id,
    targetKind: target.targetKind,
    damage: stats.damage,
    speed: stats.projectileSpeed,
    radius: stats.projectileRadius,
    life: 2.6,
  })
  state.particles.push({
    x: unit.x + Math.cos(unit.facing) * (stats.radius + 2),
    y: unit.y + Math.sin(unit.facing) * (stats.radius + 2),
    vx: Math.cos(unit.facing) * 20,
    vy: Math.sin(unit.facing) * 20,
    life: 0.12,
    max: 0.12,
    r: 3,
    color: unit.owner === 0 ? '#e7f6ff' : '#ffe1d6',
  })
  state.events.push({ type: 'attack' })
}

function isAttackable(unit: Unit, focus: Target): boolean {
  if (focus.hp <= 0) return false
  if (focus.targetKind === 'rock') return unit.kind !== 'howler'
  return focus.owner !== unit.owner
}

function pickFireTarget(state: MatchState, unit: Unit): Target | null {
  const order = unit.order
  if (order?.type === 'attack') {
    const aimed = getTarget(state, order.targetId, order.kind)
    if (aimed && isAttackable(unit, aimed)) return aimed
  }
  if (order?.type === 'attackMove' && order.focusId != null && order.focusKind) {
    const aimed = getTarget(state, order.focusId, order.focusKind)
    if (aimed && isAttackable(unit, aimed)) return aimed
  }
  const angry = unit.hurtTimer > 0
  const combat =
    unit.kind !== 'porter' && (order == null || order.type === 'move' || order.type === 'attackMove')
  if (!angry && !combat) return null
  if (unit.kind === 'porter' && !angry) return null
  const stats = UNIT_STATS[unit.kind]
  return nearestHostile(state, unit, stats.range + 40, order?.type === 'attackMove')
}

function nearestHostile(state: MatchState, unit: Unit, radius: number, buildingsToo: boolean): Target | null {
  let best: Target | null = null
  let bestD = radius
  for (const other of state.units) {
    if (other.owner === unit.owner || other.hp <= 0 || other.id === unit.id) continue
    const d = Math.hypot(other.x - unit.x, other.y - unit.y)
    if (d < bestD) {
      bestD = d
      best = unitTarget(other)
    }
  }
  if (!best && buildingsToo) {
    for (const building of state.buildings) {
      if (building.owner === unit.owner || building.hp <= 0) continue
      const center = buildingCenter(building)
      const d = Math.hypot(center.x - unit.x, center.y - unit.y)
      if (d < bestD) {
        bestD = d
        best = buildingTarget(building)
      }
    }
  }
  return best
}

function updateProjectiles(state: MatchState, dt: number): void {
  const next = []
  for (const shot of state.projectiles) {
    shot.life -= dt
    const target = getTarget(state, shot.targetId, shot.targetKind)
    if (!target || target.hp <= 0 || shot.life <= 0) continue
    const dx = target.x - shot.x
    const dy = target.y - shot.y
    const distance = Math.hypot(dx, dy)
    if (distance <= shot.radius + 8) {
      applyHit(state, target, shot.damage, shot.sourceId)
      burst(state, target.x, target.y, shot.owner === 0 ? '#d7f1ff' : '#ffd0c6', 4)
      continue
    }
    const stepLen = Math.min(distance, shot.speed * dt)
    shot.x += (dx / distance) * stepLen
    shot.y += (dy / distance) * stepLen
    next.push(shot)
  }
  state.projectiles = next
}

function applyHit(state: MatchState, target: Target, damage: number, sourceId: number): void {
  if (target.targetKind === 'rock') {
    const source = unitById(state, sourceId)
    if (source?.kind === 'howler') return
    const rock = rockById(state, target.id)
    if (!rock || rock.hp <= 0) return
    rock.hp -= damage
    rock.hitFlash = 0.18
    return
  }
  if (target.targetKind === 'unit') {
    const unit = unitById(state, target.id)
    if (!unit || unit.hp <= 0) return
    unit.hp -= damage
    unit.hitFlash = 0.16
    unit.hurtTimer = 3.2
    if (unit.hp > 0 && unit.kind === 'porter' && !unit.order) {
      const attacker = unitById(state, sourceId)
      if (attacker && attacker.hp > 0) {
        unit.order = { type: 'attack', targetId: attacker.id, kind: 'unit' }
        unit.idleAcquire = true
        unit.leashX = unit.x
        unit.leashY = unit.y
      }
    }
    return
  }
  const building = buildingById(state, target.id)
  if (!building || building.hp <= 0) return
  building.hp -= damage
  building.hitFlash = 0.18
  if (building.owner === 0 && state.underAttackCd <= 0) {
    state.underAttackCd = 8
    const label = building.kind === 'keep' ? 'The Castle is under attack.' : `Your ${BUILDING_STATS[building.kind].label} is under attack.`
    state.toasts.push({ text: label, life: 3.4 })
  }
}

function cleanup(state: MatchState): void {
  clearBrokenRocks(state)
  const deadUnits = state.units.filter((unit) => unit.hp <= 0)
  if (deadUnits.length) {
    const deadIds = new Set(deadUnits.map((unit) => unit.id))
    for (const unit of deadUnits) {
      burst(state, unit.x, unit.y, unit.owner === 0 ? '#b9e4f8' : '#ffb2a8', 8)
      state.events.push({ type: 'death' })
    }
    state.units = state.units.filter((unit) => unit.hp > 0)
    state.selectedUnits = state.selectedUnits.filter((id) => !deadIds.has(id))
  }

  const deadBuildings = state.buildings.filter((building) => building.hp <= 0)
  if (!deadBuildings.length) return
  for (const building of deadBuildings) {
    const center = buildingCenter(building)
    burst(state, center.x, center.y, building.owner === 0 ? '#9ec8de' : '#e7a197', 16)
    for (const job of building.queue) state.oreHeld[building.owner] += UNIT_STATS[job.kind].cost
    if (!building.complete) {
      state.oreHeld[building.owner] += Math.floor(BUILDING_STATS[building.kind].cost * 0.75)
    }
    for (const unit of state.units) {
      if (unit.order?.type === 'construct' && unit.order.buildingId === building.id) {
        unit.order = null
        stopMoving(unit)
      }
      if (unit.order?.type === 'attack' && unit.order.kind === 'building' && unit.order.targetId === building.id) {
        unit.order = null
        stopMoving(unit)
      }
    }
    if (state.selectedBuilding === building.id) state.selectedBuilding = null
    state.events.push({ type: 'death' })
  }
  state.buildings = state.buildings.filter((building) => building.hp > 0)
  rebuildBlocked(state)
  const playerAlive = state.buildings.some((building) => building.owner === 0 && building.kind === 'keep')
  const enemyAlive = state.buildings.some((building) => building.owner === 1 && building.kind === 'keep')
  if (!playerAlive) {
    state.outcome = 'lose'
    state.events.push({ type: 'lose' })
  } else if (!enemyAlive) {
    state.outcome = 'win'
    state.events.push({ type: 'win' })
  }
}

function clearBrokenRocks(state: MatchState): void {
  const dead = state.rocks.filter((rock) => rock.hp <= 0)
  if (!dead.length) return
  const deadIds = new Set(dead.map((rock) => rock.id))
  for (const rock of dead) {
    state.tiles[rock.ty * MAP_W + rock.tx] = 0
    burst(state, (rock.tx + 0.5) * TILE, (rock.ty + 0.5) * TILE, '#b7b1a6', 7)
  }
  state.rocks = state.rocks.filter((rock) => rock.hp > 0)
  rebuildBlocked(state)
  for (const unit of state.units) {
    if (unit.order?.type === 'attack' && unit.order.kind === 'rock' && deadIds.has(unit.order.targetId)) {
      const resume = unit.order.resumeNode
      unit.order = null
      unit.idleAcquire = false
      stopMoving(unit)
      if (resume != null && unit.kind === 'porter' && unit.hp > 0) resumeGather(state, unit, resume)
    }
    if (
      unit.order?.type === 'attackMove' &&
      unit.order.focusKind === 'rock' &&
      unit.order.focusId != null &&
      deadIds.has(unit.order.focusId)
    ) {
      unit.order.focusId = null
      unit.order.focusKind = null
    }
  }
  for (const unit of state.units) {
    if (unit.hp <= 0 || unit.goalX == null || unit.goalY == null) continue
    setUnitDestination(state, unit, unit.goalX, unit.goalY)
  }
}

function burst(state: MatchState, x: number, y: number, color: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count + Math.random() * 0.4
    const s = 18 + Math.random() * 40
    state.particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 0.35 + Math.random() * 0.35,
      max: 0.7,
      r: 1.5 + Math.random() * 2.2,
      color,
    })
  }
}

function fadeEffects(state: MatchState, dt: number): void {
  state.underAttackCd = Math.max(0, state.underAttackCd - dt)
  for (const particle of state.particles) {
    particle.life -= dt
    particle.x += particle.vx * dt
    particle.y += particle.vy * dt
  }
  if (state.particles.length > 220) state.particles.splice(0, state.particles.length - 220)
  state.particles = state.particles.filter((particle) => particle.life > 0)
  for (const ping of state.pings) ping.life -= dt
  state.pings = state.pings.filter((ping) => ping.life > 0)
  for (const toast of state.toasts) toast.life -= dt
  state.toasts = state.toasts.filter((toast) => toast.life > 0)
  if (state.events.length > 48) state.events.splice(0, state.events.length - 48)
}
