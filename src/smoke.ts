import { assignMiners, commandAttack, commandGather, commandMove, tryPlace, tryTrain } from './game/commands'
import { findPath } from './game/pathfind'
import { step } from './game/sim'
import { canPlace, createMatch, isWalkable, makeUnit, rebuildBlocked, unitById } from './game/state'
import { BUILDING_STATS, MAP_H, MAP_W, ROCK_HP, STARTING_ORE, TILE, type MatchState } from './game/types'
import { describeSelection } from './ui/hud'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function pathAroundWall(): void {
  const w = 12
  const h = 12
  const blocked = new Uint8Array(w * h)
  for (let x = 0; x < 10; x++) blocked[5 * w + x] = 1
  const path = findPath(blocked, w, h, 2, 2, 2, 8)
  assert(path && path.length > 0, 'path should skirt a wall')
  assert(
    path.every((step) => blocked[step.ty * w + step.tx] === 0),
    'path stepped on a blocked tile',
  )
  assert(
    path.some((step) => step.ty === 5 && step.tx >= 10) || path.some((step) => step.tx >= 10),
    'path did not use the gap beside the wall',
  )
  const open = findPath(new Uint8Array(w * h), w, h, 1, 1, 6, 1)
  assert(open && open.length > 0, 'open ground should be routable')
}

function routeExists(): void {
  const state = createMatch(7)
  const porter = state.units.find((unit) => unit.owner === 0 && unit.kind === 'porter')
  const enemy = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(porter && enemy, 'missing starting forces')
  const sx = Math.floor(porter.x / TILE)
  const sy = Math.floor(porter.y / TILE)
  let goal: { tx: number; ty: number } | null = null
  for (let rad = 2; rad <= 8 && !goal; rad++) {
    for (let ty = enemy.ty - rad; ty <= enemy.ty + rad; ty++) {
      for (let tx = enemy.tx - rad; tx <= enemy.tx + rad; tx++) {
        if (isWalkable(state, tx, ty)) {
          goal = { tx, ty }
          break
        }
      }
      if (goal) break
    }
  }
  assert(goal, 'no open ground near the enemy keep')
  const path = findPath(state.blocked, MAP_W, MAP_H, sx, sy, goal.tx, goal.ty)
  assert(path, `no route from (${sx},${sy}) to (${goal.tx},${goal.ty})`)
}

function gatherWorks(): void {
  const state = createMatch(4)
  const porters = state.units.filter((unit) => unit.owner === 0 && unit.kind === 'porter')
  let node = state.ore[0]
  assert(node, 'missing ore')
  let best = Infinity
  for (const ore of state.ore) {
    const d = (ore.tx * TILE - (porters[0]?.x ?? 0)) ** 2 + (ore.ty * TILE - (porters[0]?.y ?? 0)) ** 2
    if (ore.ty > 28 && ore.tx < 20 && d < best) {
      best = d
      node = ore
    }
  }
  commandGather(
    state,
    porters.map((unit) => unit.id),
    node.id,
  )
  let onTarget = 0
  for (const porter of porters) {
    const id = assignedDeposit(porter)
    assert(id != null, 'miner was not sent to a deposit')
    if (id === node.id) onTarget += 1
  }
  assert(onTarget <= 3 && onTarget >= 1, `clicked deposit has ${onTarget} miners`)
  for (let i = 0; i < 20 * 30; i++) step(state, 1 / 30)
  assert(state.oreHeld[0] > STARTING_ORE, `ore did not increase (${state.oreHeld[0]})`)
}

function buildAndTrain(): void {
  const state = createMatch(11)
  state.oreHeld[0] = 800
  const porters = state.units.filter((unit) => unit.owner === 0 && unit.kind === 'porter')
  let spot: { tx: number; ty: number } | null = null
  for (let ty = 30; ty < 44 && !spot; ty++) {
    for (let tx = 2; tx < 16; tx++) {
      if (canPlace(state, 'yard', tx, ty)) {
        spot = { tx, ty }
        break
      }
    }
  }
  assert(spot, 'no yard site')
  const placed = tryPlace(
    state,
    0,
    'yard',
    spot.tx,
    spot.ty,
    porters.map((unit) => unit.id),
  )
  assert(placed === null, placed ?? 'place failed')
  for (let i = 0; i < 40 * 30; i++) step(state, 1 / 30)
  const yard = state.buildings.find((building) => building.owner === 0 && building.kind === 'yard')
  assert(yard?.complete, 'yard never finished')
  assert(tryTrain(state, yard.id, 'pike') === null, 'could not train a pike')
  for (let i = 0; i < 15 * 30; i++) step(state, 1 / 30)
  assert(
    state.units.some((unit) => unit.owner === 0 && unit.kind === 'pike'),
    'pike was not produced',
  )
}

function pausedConstructionStillAdvances(): void {
  const state = createMatch(11)
  state.oreHeld[0] = 800
  const porters = state.units.filter((unit) => unit.owner === 0 && unit.kind === 'porter')
  let spot: { tx: number; ty: number } | null = null
  for (let ty = 30; ty < 44 && !spot; ty++) {
    for (let tx = 2; tx < 16; tx++) {
      if (canPlace(state, 'yard', tx, ty)) {
        spot = { tx, ty }
        break
      }
    }
  }
  assert(spot, 'no yard site for paused build')
  const placed = tryPlace(state, 0, 'yard', spot.tx, spot.ty, porters.map((unit) => unit.id))
  assert(placed === null, placed ?? 'place failed')
  const yard = state.buildings.find((building) => building.owner === 0 && building.kind === 'yard' && !building.complete)
  assert(yard, 'yard was not started')
  for (const unit of state.units) {
    if (unit.order?.type === 'construct') unit.order = null
  }
  const before = yard.progress
  step(state, 1)
  assert(yard.progress > before, 'paused factory did not gain progress')
  assert(!yard.complete, 'paused factory finished in one second')
  const buildSeconds = BUILDING_STATS.yard.buildTime
  for (let i = 0; i < buildSeconds; i++) step(state, 1)
  assert(yard.complete, 'paused factory never finished')
}

function howlerCannotBreakRock(): void {
  const state = createMatch(9)
  const offsets: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  const rock = state.rocks.find((entry) => offsets.some(([dx, dy]) => isWalkable(state, entry.tx + dx, entry.ty + dy)))
  assert(rock, 'map has no rock beside open ground')
  assert(!isWalkable(state, rock.tx, rock.ty), 'rock tile should block')
  const before = rock.hp
  const howler = makeUnit(state, 0, 'howler', (rock.tx + 0.5) * TILE, (rock.ty + 0.5) * TILE - 40)
  commandAttack(state, [howler.id], rock.id, 'rock')
  assert(unitById(state, howler.id)?.order == null, 'howler accepted a rock order')
  const forced = unitById(state, howler.id)
  if (forced) forced.order = { type: 'attack', targetId: rock.id, kind: 'rock' }
  for (let i = 0; i < 6 * 60; i++) step(state, 1 / 60)
  const untouched = state.rocks.find((entry) => entry.id === rock.id)
  assert(untouched && untouched.hp === before, 'howler damaged the rock')
  const pike = makeUnit(state, 0, 'pike', (rock.tx + 0.5) * TILE, (rock.ty + 0.5) * TILE - 40)
  commandAttack(state, [pike.id], rock.id, 'rock')
  let broke = false
  for (let i = 0; i < 12 * 60; i++) {
    step(state, 1 / 60)
    if (!state.rocks.some((entry) => entry.id === rock.id)) {
      broke = true
      break
    }
  }
  assert(broke, 'pike did not destroy the rock')
  assert(state.tiles[rock.ty * MAP_W + rock.tx] === 0, 'rock tile was not cleared')
  assert(isWalkable(state, rock.tx, rock.ty), 'destroyed rock still blocks')
  const start = offsets
    .map(([dx, dy]) => ({ tx: rock.tx + dx, ty: rock.ty + dy }))
    .find((tile) => isWalkable(state, tile.tx, tile.ty))
  assert(start, 'no open tile next to the broken rock')
  const path = findPath(state.blocked, MAP_W, MAP_H, start.tx, start.ty, rock.tx, rock.ty)
  assert(path && path.some((step) => step.tx === rock.tx && step.ty === rock.ty), 'path does not enter the cleared rock')
  const walker = makeUnit(state, 0, 'pike', (start.tx + 0.5) * TILE, (start.ty + 0.5) * TILE)
  commandMove(state, [walker.id], (rock.tx + 0.5) * TILE, (rock.ty + 0.5) * TILE, false)
  for (let i = 0; i < 4 * 60; i++) step(state, 1 / 60)
  const moved = unitById(state, walker.id)
  assert(
    moved && Math.floor(moved.x / TILE) === rock.tx && Math.floor(moved.y / TILE) === rock.ty,
    `pike did not walk onto the cleared rock (${moved?.x}, ${moved?.y})`,
  )
}

function footprintBlocks(state: MatchState, tx: number, ty: number): boolean {
  if (state.ore.some((node) => node.tx === tx && node.ty === ty && node.amount > 0)) return true
  return state.buildings.some((building) => {
    if (building.hp <= 0) return false
    const stats = BUILDING_STATS[building.kind]
    return tx >= building.tx && ty >= building.ty && tx < building.tx + stats.w && ty < building.ty + stats.h
  })
}

function aiBreaksBlockingRock(): void {
  const state = createMatch(9)
  const wallY = 24
  for (let tx = 0; tx < MAP_W; tx++) {
    if (footprintBlocks(state, tx, wallY)) continue
    if (state.tiles[wallY * MAP_W + tx] === 1) continue
    state.tiles[wallY * MAP_W + tx] = 1
    state.rocks.push({ id: state.nextId++, tx, ty: wallY, hp: ROCK_HP, hitFlash: 0 })
  }
  rebuildBlocked(state)

  let spot: { tx: number; ty: number } | null = null
  for (let tx = 1; tx < MAP_W - 1 && !spot; tx++) {
    if (!state.rocks.some((rock) => rock.tx === tx && rock.ty === wallY && rock.hp > 0)) continue
    for (const ty of [22, 21, 20, 19]) {
      if (isWalkable(state, tx, ty)) {
        spot = { tx, ty }
        break
      }
    }
  }
  assert(spot, 'no open ground north of the rock wall')
  const pike = makeUnit(state, 1, 'pike', (spot.tx + 0.5) * TILE, (spot.ty + 0.5) * TILE)
  const howler = makeUnit(state, 1, 'howler', (spot.tx + 0.5) * TILE, (spot.ty + 0.5) * TILE)
  const before = findPath(state.blocked, MAP_W, MAP_H, spot.tx, spot.ty, spot.tx, wallY + 3)
  assert(before === null, 'wall did not seal the march')
  state.aiAttacking = true
  step(state, 0.5)
  const howlerOrder = unitById(state, howler.id)?.order
  assert(!(howlerOrder?.type === 'attack' && howlerOrder.kind === 'rock'), 'Dunmarch ordered a howler onto a rock')
  const ordered = unitById(state, pike.id)
  assert(ordered?.order?.type === 'attack' && ordered.order.kind === 'rock', 'Dunmarch did not order the pike onto a rock')
  const targetId = ordered.order.targetId
  const target = state.rocks.find((rock) => rock.id === targetId)
  assert(target, 'rock order pointed at nothing')
  let broke = false
  for (let i = 0; i < 20 * 60; i++) {
    step(state, 1 / 60)
    const stillHowler = unitById(state, howler.id)?.order
    assert(!(stillHowler?.type === 'attack' && stillHowler.kind === 'rock'), 'howler was ordered onto a rock mid-siege')
    if (!state.rocks.some((rock) => rock.id === targetId)) {
      broke = true
      break
    }
  }
  assert(broke, 'pike did not break the blocking rock')
  assert(isWalkable(state, target.tx, target.ty), 'broken rock still blocks')
  for (let i = 0; i < 2 * 60; i++) step(state, 1 / 60)
  const resumed = unitById(state, pike.id)
  assert(
    !(resumed?.order?.type === 'attack' && resumed.order.kind === 'rock'),
    `Dunmarch kept sieging rock after the gap opened (${resumed?.order?.type ?? 'idle'})`,
  )
  const south = { tx: target.tx, ty: wallY + 2 }
  assert(isWalkable(state, south.tx, south.ty) || isWalkable(state, target.tx, target.ty), 'no ground beyond the wall')
  const through = findPath(
    state.blocked,
    MAP_W,
    MAP_H,
    spot.tx,
    spot.ty,
    isWalkable(state, south.tx, south.ty) ? south.tx : target.tx,
    isWalkable(state, south.tx, south.ty) ? south.ty : target.ty,
  )
  assert(through, 'path did not open after the rock fell')
}

function porterBreaksRockWhenOrdered(): void {
  const state = createMatch(4)
  const rock = state.rocks.find((entry) => entry.hp > 0)
  assert(rock, 'missing rock')
  const before = rock.hp
  const porter = makeUnit(state, 0, 'porter', (rock.tx + 0.5) * TILE + 24, (rock.ty + 0.5) * TILE)
  commandAttack(state, [porter.id], rock.id, 'rock')
  for (let i = 0; i < 4 * 60; i++) step(state, 1 / 60)
  const still = state.rocks.find((entry) => entry.id === rock.id)
  assert((still?.hp ?? 0) < before, 'ordered porter did not damage the rock')
}

function aiPortersBreakRockForOre(): void {
  const state = createMatch(9)
  const node = state.ore.find((entry) => entry.ty > 28 && entry.tx < 18)
  assert(node, 'no southern ore')
  for (const ore of state.ore) {
    if (ore.id !== node.id) ore.amount = 0
  }
  node.amount = 420
  const wallY = 24
  for (let tx = 0; tx < MAP_W; tx++) {
    if (footprintBlocks(state, tx, wallY)) continue
    if (state.tiles[wallY * MAP_W + tx] === 1) continue
    state.tiles[wallY * MAP_W + tx] = 1
    state.rocks.push({ id: state.nextId++, tx, ty: wallY, hp: ROCK_HP, hitFlash: 0 })
  }
  rebuildBlocked(state)
  const porters = state.units.filter((unit) => unit.owner === 1 && unit.kind === 'porter')
  assert(porters.length > 0, 'Dunmarch has no porters')
  let placed = 0
  for (let tx = 4; tx < MAP_W - 4 && placed < porters.length; tx++) {
    if (!isWalkable(state, tx, 20)) continue
    const porter = porters[placed]
    if (!porter) break
    porter.x = (tx + 0.5) * TILE
    porter.y = 20.5 * TILE
    porter.order = null
    porter.cargo = 0
    porter.path = []
    porter.goalX = null
    porter.goalY = null
    placed += 1
  }
  assert(placed > 0, 'no open ground for Dunmarch porters')
  const origin = porters[0]
  assert(origin, 'missing porter')
  let south: { tx: number; ty: number } | null = null
  for (let ty = wallY + 1; ty < MAP_H && !south; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (isWalkable(state, tx, ty)) {
        south = { tx, ty }
        break
      }
    }
  }
  assert(south, 'no open ground south of the wall')
  assert(
    findPath(state.blocked, MAP_W, MAP_H, Math.floor(origin.x / TILE), 20, south.tx, south.ty) === null,
    'ore stayed reachable through the wall',
  )
  state.oreHeld[1] = 40
  state.aiAttacking = false
  step(state, 0.5)
  const breaker = porters
    .map((unit) => unitById(state, unit.id))
    .find((unit) => unit?.order?.type === 'attack' && unit.order.kind === 'rock')
  assert(breaker?.order?.type === 'attack' && breaker.order.kind === 'rock', 'porters did not attack a rock to reach ore')
  const targetId = breaker.order.targetId
  let broke = false
  for (let i = 0; i < 30 * 60; i++) {
    step(state, 1 / 60)
    if (!state.rocks.some((rock) => rock.id === targetId)) {
      broke = true
      break
    }
  }
  assert(broke, 'porters did not break the ore blockage')
  for (let i = 0; i < 2 * 60; i++) step(state, 1 / 60)
  const resumed = unitById(state, breaker.id)
  assert(
    resumed?.order?.type === 'gather' || !(resumed?.order?.type === 'attack' && resumed.order.kind === 'rock'),
    'porter kept sieging after the ore route opened',
  )
}

function assignedDeposit(unit: { order: { type: string; nodeId?: number; kind?: string; resumeNode?: number } | null }): number | null {
  const order = unit.order
  if (!order) return null
  if (order.type === 'gather' && order.nodeId != null) return order.nodeId
  if (order.type === 'attack' && order.kind === 'rock' && order.resumeNode != null) return order.resumeNode
  return null
}

function threeMinersPerDeposit(): void {
  const state = createMatch(4)
  const node = state.ore.find((entry) => entry.amount > 0)
  assert(node, 'missing ore')
  for (const ore of state.ore) {
    if (ore.id !== node.id) ore.amount = 0
  }
  const porters = state.units.filter((unit) => unit.owner === 0 && unit.kind === 'porter')
  assert(porters.length >= 4, `need 4 miners, have ${porters.length}`)
  commandGather(
    state,
    porters.map((unit) => unit.id),
    node.id,
  )
  const assigned = porters.filter((unit) => assignedDeposit(unit) === node.id)
  const waiting = porters.filter((unit) => unit.order == null && unit.nodeMemory === 0)
  assert(assigned.length === 3, `expected 3 miners on the deposit, got ${assigned.length}`)
  assert(waiting.length === porters.length - 3, `expected extras to wait, got ${waiting.length}`)
  const victim = assigned[0]
  assert(victim, 'missing assigned miner')
  victim.hp = 0
  step(state, 1 / 60)
  const filled = waiting.filter((unit) => assignedDeposit(unitById(state, unit.id) ?? { order: null }) === node.id)
  assert(filled.length === 1, 'waiting miner did not take the slot freed by a death')
}

function minersSpreadToNearestOpenDeposit(): void {
  const state = createMatch(4)
  const nodes = state.ore.filter((entry) => entry.amount > 0)
  assert(nodes.length >= 2, 'need two deposits')
  const target = nodes[0]
  assert(target, 'missing target deposit')
  const porters = state.units.filter((unit) => unit.owner === 0 && unit.kind === 'porter')
  commandGather(
    state,
    porters.map((unit) => unit.id),
    target.id,
  )
  const counts = new Map<number, number>()
  for (const porter of porters) {
    const id = assignedDeposit(porter)
    assert(id != null, 'miner was not assigned a deposit')
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  for (const count of counts.values()) assert(count <= 3, `a deposit has ${count} miners`)
  assert(counts.get(target.id) === 3, `clicked deposit has ${counts.get(target.id)} miners`)
  assert(counts.size >= 2, 'extra miners stayed on the full deposit')
}

function aiUsesTheSameMinerCap(): void {
  const state = createMatch(2)
  const node = state.ore.find((entry) => entry.amount > 0)
  assert(node, 'missing ore')
  for (const ore of state.ore) {
    if (ore.id !== node.id) ore.amount = 0
  }
  const porters = state.units.filter((unit) => unit.owner === 1 && unit.kind === 'porter')
  assert(porters.length >= 4, `Dunmarch needs 4 miners, has ${porters.length}`)
  for (const porter of porters) {
    porter.order = null
    porter.nodeMemory = -1
    porter.cargo = 0
  }
  assignMiners(state, porters, null)
  const onNode = porters.filter((unit) => assignedDeposit(unit) === node.id)
  assert(onNode.length === 3, `Dunmarch put ${onNode.length} miners on one deposit`)
}

function oreSelectionShowsAmount(): void {
  const state = createMatch(3)
  const node = state.ore.find((entry) => entry.amount > 0)
  assert(node, 'missing ore')
  state.selectedOre = node.id
  const text = describeSelection(state)
  assert(text.includes('Ore'), 'ore panel missing title')
  assert(text.includes(`${node.amount} remaining`), `ore panel missing amount: ${text}`)
  node.amount = 80
  assert(describeSelection(state).includes('80 remaining'), 'ore panel did not follow the amount')
}

function minersClearRockToGather(): void {
  const state = createMatch(9)
  const node = state.ore.find((entry) => entry.ty > 28 && entry.tx < 18)
  assert(node, 'no southern ore')
  for (const ore of state.ore) {
    if (ore.id !== node.id) ore.amount = 0
  }
  const wallY = 24
  for (let tx = 0; tx < MAP_W; tx++) {
    if (footprintBlocks(state, tx, wallY)) continue
    if (state.tiles[wallY * MAP_W + tx] === 1) continue
    state.tiles[wallY * MAP_W + tx] = 1
    state.rocks.push({ id: state.nextId++, tx, ty: wallY, hp: ROCK_HP, hitFlash: 0 })
  }
  rebuildBlocked(state)
  let spot: { tx: number; ty: number } | null = null
  for (let tx = 4; tx < MAP_W - 4 && !spot; tx++) {
    if (isWalkable(state, tx, 20)) spot = { tx, ty: 20 }
  }
  assert(spot, 'no open ground north of the ore wall')
  const miner = makeUnit(state, 0, 'porter', (spot.tx + 0.5) * TILE, (spot.ty + 0.5) * TILE)
  const tank = makeUnit(state, 0, 'howler', (spot.tx + 1.5) * TILE, (spot.ty + 0.5) * TILE)
  commandGather(state, [miner.id, tank.id], node.id)
  const ordered = unitById(state, miner.id)
  assert(
    ordered?.order?.type === 'attack' && ordered.order.kind === 'rock' && ordered.order.resumeNode === node.id,
    'miner did not attack the rock sealing the ore',
  )
  const tankOrder = unitById(state, tank.id)?.order
  assert(!(tankOrder?.type === 'attack' && tankOrder.kind === 'rock'), 'tank was sent to break rock')
  const targetId = ordered.order.targetId
  let broke = false
  for (let i = 0; i < 40 * 60; i++) {
    step(state, 1 / 60)
    const tankNow = unitById(state, tank.id)?.order
    assert(!(tankNow?.type === 'attack' && tankNow.kind === 'rock'), 'tank attacked a rock while miners gathered')
    if (!state.rocks.some((rock) => rock.id === targetId)) {
      broke = true
      break
    }
  }
  assert(broke, 'miner did not break the rock sealing the ore')
  let resumed = false
  for (let i = 0; i < 3 * 60; i++) {
    step(state, 1 / 60)
    const order = unitById(state, miner.id)?.order
    if (order?.type === 'gather' && order.nodeId === node.id) {
      resumed = true
      break
    }
  }
  assert(resumed, 'miner did not go back to gathering after the rock fell')
}

function aiIgnoresRocksOnOpenRoute(): void {
  const state = createMatch(6)
  const keep = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(keep, 'missing player keep')
  let spot: { tx: number; ty: number } | null = null
  for (let rad = 4; rad <= 8 && !spot; rad++) {
    for (let ty = keep.ty - rad; ty <= keep.ty + rad && !spot; ty++) {
      for (let tx = keep.tx - rad; tx <= keep.tx + rad; tx++) {
        if (isWalkable(state, tx, ty)) {
          spot = { tx, ty }
          break
        }
      }
    }
  }
  assert(spot, 'no open ground near the player keep')
  const howler = makeUnit(state, 1, 'howler', (spot.tx + 0.5) * TILE, (spot.ty + 0.5) * TILE)
  state.aiAttacking = true
  for (let i = 0; i < 3; i++) step(state, 0.5)
  const order = unitById(state, howler.id)?.order
  assert(!(order?.type === 'attack' && order.kind === 'rock'), 'Dunmarch broke rock on a short open route')
}

function pikeChipsRock(): void {
  const state = createMatch(8)
  const rock = state.rocks[0]
  assert(rock, 'missing rock')
  const before = rock.hp
  const pike = makeUnit(state, 0, 'pike', (rock.tx + 0.5) * TILE + 28, (rock.ty + 0.5) * TILE)
  commandAttack(state, [pike.id], rock.id, 'rock')
  for (let i = 0; i < 3 * 60; i++) step(state, 1 / 60)
  const still = state.rocks.find((entry) => entry.id === rock.id)
  assert((still?.hp ?? 0) < before, 'pike could not damage a rock')
}

function attacksBuildings(): void {
  const state = createMatch(3)
  const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(keep, 'missing keep')
  const pike = makeUnit(state, 0, 'pike', (keep.tx + 1.5) * TILE, (keep.ty + 3.5) * TILE)
  const before = keep.hp
  commandAttack(state, [pike.id], keep.id, 'building')
  for (let i = 0; i < 5 * 60; i++) step(state, 1 / 60)
  const still = state.buildings.find((building) => building.id === keep.id)
  assert(!still || still.hp < before, 'pike did not damage the keep')
}

function combatResolves(): void {
  const state = createMatch(19)
  const a = makeUnit(state, 0, 'pike', 700, 700)
  const b = makeUnit(state, 1, 'pike', 730, 700)
  commandAttack(state, [a.id], b.id, 'unit')
  commandAttack(state, [b.id], a.id, 'unit')
  for (let i = 0; i < 12 * 60; i++) step(state, 1 / 60)
  const leftA = unitById(state, a.id)
  const leftB = unitById(state, b.id)
  const damaged = (leftA?.hp ?? 0) < 40 || (leftB?.hp ?? 0) < 40 || !leftA || !leftB
  assert(damaged, `pikes did not fight (${leftA?.hp}, ${leftB?.hp})`)
}

function keepDecidesTheField(): void {
  const state = createMatch(2)
  const enemy = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(enemy, 'missing enemy keep')
  enemy.hp = 0
  step(state, 1 / 60)
  assert(state.outcome === 'win', `expected win, got ${state.outcome}`)
  const loss = createMatch(2)
  const own = loss.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(own, 'missing player keep')
  own.hp = 0
  step(loss, 1 / 60)
  assert(loss.outcome === 'lose', `expected loss, got ${loss.outcome}`)
}

function enemyPlays(): void {
  const state = createMatch(5)
  for (let i = 0; i < 75 * 30; i++) {
    step(state, 1 / 30)
    if (state.outcome) break
  }
  for (const unit of state.units) {
    assert(Number.isFinite(unit.x) && Number.isFinite(unit.y), 'unit position became NaN')
  }
  const yard = state.buildings.some((building) => building.owner === 1 && building.kind === 'yard')
  const army = state.units.some((unit) => unit.owner === 1 && unit.kind !== 'porter')
  assert(state.oreHeld[1] > STARTING_ORE || yard, 'Dunmarch never gathered or built')
  assert(yard || army, 'Dunmarch raised no yard and no fighters')
  assert(
    state.buildings.some((building) => building.owner === 1 && building.kind === 'keep'),
    'enemy keep vanished without a result',
  )
  assert(state.outcome == null, `match ended too early: ${state.outcome}`)
}

pathAroundWall()
routeExists()
gatherWorks()
buildAndTrain()
howlerCannotBreakRock()
pausedConstructionStillAdvances()
aiBreaksBlockingRock()
porterBreaksRockWhenOrdered()
aiPortersBreakRockForOre()
threeMinersPerDeposit()
minersSpreadToNearestOpenDeposit()
aiUsesTheSameMinerCap()
oreSelectionShowsAmount()
minersClearRockToGather()
aiIgnoresRocksOnOpenRoute()
pikeChipsRock()
attacksBuildings()
combatResolves()
keepDecidesTheField()
enemyPlays()
console.log('smoke ok')
