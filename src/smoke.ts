import { runCommand } from './game/console'
import { assignMiners, commandAttack, commandConstruct, commandGather, commandMove, tryPlace, tryTrain } from './game/commands'
import { findPath } from './game/pathfind'
import { step } from './game/sim'
import { buildingRect, canPlace, createMatch, isWalkable, makeBuilding, makeUnit, rebuildBlocked, recomputeSupply, unitById } from './game/state'
import { BUILDING_STATS, INTERACT, MAP_H, MAP_W, ROCK_HP, STARTING_ORE, TILE, UNIT_STATS, type Building, type MatchState } from './game/types'
import { aiTileExplored, depositKnown, groundShown, tileExplored, tileVisible, unitSeen, updateVision } from './game/vision'
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
  assert(node, 'missing minerals')
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
    assert(id != null, 'worker was not sent to a deposit')
    if (id === node.id) onTarget += 1
  }
  assert(onTarget <= 3 && onTarget >= 1, `clicked deposit has ${onTarget} workers`)
  for (let i = 0; i < 20 * 30; i++) step(state, 1 / 30)
  assert(state.oreHeld[0] > STARTING_ORE, `minerals did not increase (${state.oreHeld[0]})`)
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

function distToBuilding(unit: { x: number; y: number }, building: Building): number {
  const rect = buildingRect(building)
  const cx = Math.max(rect.x, Math.min(unit.x, rect.x + rect.w))
  const cy = Math.max(rect.y, Math.min(unit.y, rect.y + rect.h))
  return Math.hypot(unit.x - cx, unit.y - cy)
}

function constructionPausesUntilWorkerReturns(): void {
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
  let worked = false
  for (let i = 0; i < 20 * 30; i++) {
    step(state, 1 / 30)
    if (yard.progress > 0.05) {
      worked = true
      break
    }
  }
  assert(worked, 'worker never started the factory')
  const crew = state.units.filter((unit) => unit.order?.type === 'construct' && unit.order.buildingId === yard.id)
  assert(crew.length > 0, 'no worker stayed on the factory')
  commandMove(state, crew.map((unit) => unit.id), 40, 40, false)
  let left = false
  for (let i = 0; i < 25 * 30; i++) {
    step(state, 1 / 30)
    if (crew.every((unit) => distToBuilding(unit, yard) > INTERACT)) {
      left = true
      break
    }
  }
  assert(left, 'workers did not leave the factory')
  const saved = yard.progress
  assert(saved < 1 && !yard.complete, 'factory finished before the workers left')
  for (let i = 0; i < 3 * 30; i++) step(state, 1 / 30)
  assert(yard.progress === saved, 'paused factory gained progress with no worker on site')
  const pausedPanel = describeSelection({ ...state, selectedBuilding: yard.id, selectedUnits: [] })
  assert(pausedPanel.includes('paused'), 'paused factory panel omitted the pause')
  assert(!pausedPanel.includes('still building'), 'paused factory panel still claims it is building')
  commandConstruct(state, crew.map((unit) => unit.id), yard.id)
  let resumed = false
  for (let i = 0; i < 40 * 30; i++) {
    step(state, 1 / 30)
    if (yard.progress > saved) {
      resumed = true
      break
    }
  }
  assert(resumed, 'returning worker did not resume the factory')
  assert(yard.progress < 1 || yard.complete, 'resume reset or skipped the saved progress')
  for (let i = 0; i < 40 * 30 && !yard.complete; i++) step(state, 1 / 30)
  assert(yard.complete, 'factory never finished after the worker returned')
  assert(yard.progress === 1, 'finished factory did not keep a full bar')
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
  assert(unitById(state, pike.id)?.order == null, 'bike accepted a rock order')
  const forcedPike = unitById(state, pike.id)
  if (forcedPike) forcedPike.order = { type: 'attack', targetId: rock.id, kind: 'rock' }
  for (let i = 0; i < 6 * 60; i++) step(state, 1 / 60)
  const stillRock = state.rocks.find((entry) => entry.id === rock.id)
  assert(stillRock && stillRock.hp === before, 'bike damaged the rock')
  stillRock.hp = 0
  step(state, 1 / 30)
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
  const playerKeep = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep' && building.hp > 0)
  assert(playerKeep, 'missing the player castle to scout')
  state.aiSpotted.push({
    id: playerKeep.id,
    x: (playerKeep.tx + 1.5) * TILE,
    y: (playerKeep.ty + 1.5) * TILE,
  })
  state.aiAttacking = true
  step(state, 0.5)
  const howlerOrder = unitById(state, howler.id)?.order
  assert(!(howlerOrder?.type === 'attack' && howlerOrder.kind === 'rock'), 'Dunmarch ordered a tank onto a rock')
  const pikeOrder = unitById(state, pike.id)?.order
  assert(!(pikeOrder?.type === 'attack' && pikeOrder.kind === 'rock'), 'Dunmarch ordered a bike onto a rock')
  const ordered = state.units.find(
    (unit) => unit.owner === 1 && unit.kind === 'porter' && unit.order?.type === 'attack' && unit.order.kind === 'rock',
  )
  assert(ordered?.order?.type === 'attack' && ordered.order.kind === 'rock', 'Dunmarch did not send a worker to break the rock')
  const targetId = ordered.order.targetId
  const target = state.rocks.find((rock) => rock.id === targetId)
  assert(target, 'rock order pointed at nothing')
  let broke = false
  for (let i = 0; i < 70 * 60; i++) {
    step(state, 1 / 60)
    const stillHowler = unitById(state, howler.id)?.order
    const stillPike = unitById(state, pike.id)?.order
    assert(!(stillHowler?.type === 'attack' && stillHowler.kind === 'rock'), 'tank was ordered onto a rock mid-siege')
    assert(!(stillPike?.type === 'attack' && stillPike.kind === 'rock'), 'bike was ordered onto a rock mid-siege')
    if (!state.rocks.some((rock) => rock.id === targetId)) {
      broke = true
      break
    }
  }
  assert(broke, 'worker did not break the blocking rock')
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
  assert((still?.hp ?? 0) < before, 'ordered worker did not damage the rock')
}

function workersBreakRockToReachMinerals(): void {
  const state = createMatch(9)
  const node = state.ore.find((entry) => entry.ty > 28 && entry.tx < 18)
  assert(node, 'no southern minerals')
  for (const ore of state.ore) {
    if (ore.id !== node.id) ore.amount = 0
  }
  node.amount = 420
  state.aiExplored[node.ty * MAP_W + node.tx] = 1
  const wallY = 24
  for (let tx = 0; tx < MAP_W; tx++) {
    if (footprintBlocks(state, tx, wallY)) continue
    if (state.tiles[wallY * MAP_W + tx] === 1) continue
    state.tiles[wallY * MAP_W + tx] = 1
    state.rocks.push({ id: state.nextId++, tx, ty: wallY, hp: ROCK_HP, hitFlash: 0 })
  }
  rebuildBlocked(state)
  const porters = state.units.filter((unit) => unit.owner === 1 && unit.kind === 'porter')
  assert(porters.length > 0, 'Dunmarch has no workers')
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
  assert(placed > 0, 'no open ground for Dunmarch workers')
  const origin = porters[0]
  assert(origin, 'missing worker')
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
    'workers could path across the minerals wall',
  )
  state.oreHeld[1] = 40
  state.aiAttacking = false
  step(state, 0.5)
  const breaker = porters
    .map((unit) => unitById(state, unit.id))
    .find((unit) => unit?.order?.type === 'attack' && unit.order.kind === 'rock')
  assert(breaker?.order?.type === 'attack' && breaker.order.kind === 'rock', 'workers did not attack a rock sealing the minerals')
  const targetId = breaker.order.targetId
  let broke = false
  for (let i = 0; i < 40 * 60; i++) {
    step(state, 1 / 60)
    const crossed = porters.some((unit) => Math.floor(unit.y / TILE) > wallY)
    if (crossed && state.rocks.some((rock) => rock.id === targetId)) {
      assert(false, 'worker crossed the wall before the rock fell')
    }
    if (!state.rocks.some((rock) => rock.id === targetId)) {
      broke = true
      break
    }
  }
  assert(broke, 'workers did not break the rock sealing the minerals')
  let resumed = false
  for (let i = 0; i < 5 * 60; i++) {
    step(state, 1 / 60)
    const order = unitById(state, breaker.id)?.order
    if (order?.type === 'gather' || (order?.type === 'attack' && order.kind === 'rock' && order.targetId !== targetId)) {
      resumed = true
      break
    }
    if (order?.type !== 'attack') {
      resumed = true
      break
    }
  }
  assert(resumed, 'worker did not resume after opening the minerals path')
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
  assert(node, 'missing minerals')
  for (const ore of state.ore) {
    if (ore.id !== node.id) ore.amount = 0
  }
  const porters = state.units.filter((unit) => unit.owner === 0 && unit.kind === 'porter')
  assert(porters.length >= 4, `need 4 workers, have ${porters.length}`)
  commandGather(
    state,
    porters.map((unit) => unit.id),
    node.id,
  )
  const assigned = porters.filter((unit) => assignedDeposit(unit) === node.id)
  const waiting = porters.filter((unit) => unit.order == null && unit.nodeMemory === 0)
  assert(assigned.length === 3, `expected 3 workers on the deposit, got ${assigned.length}`)
  assert(waiting.length === porters.length - 3, `expected extras to wait, got ${waiting.length}`)
  const victim = assigned[0]
  assert(victim, 'missing assigned worker')
  victim.hp = 0
  step(state, 1 / 60)
  const filled = waiting.filter((unit) => assignedDeposit(unitById(state, unit.id) ?? { order: null }) === node.id)
  assert(filled.length === 1, 'waiting worker did not take the slot freed by a death')
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
    assert(id != null, 'worker was not assigned a deposit')
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  for (const count of counts.values()) assert(count <= 3, `a deposit has ${count} workers`)
  assert(counts.get(target.id) === 3, `clicked deposit has ${counts.get(target.id)} workers`)
  assert(counts.size >= 2, 'extra workers stayed on the full deposit')
}

function aiUsesTheSameMinerCap(): void {
  const state = createMatch(2)
  const node = state.ore.find((entry) => entry.amount > 0)
  assert(node, 'missing minerals')
  for (const ore of state.ore) {
    if (ore.id !== node.id) ore.amount = 0
  }
  const porters = state.units.filter((unit) => unit.owner === 1 && unit.kind === 'porter')
  assert(porters.length >= 4, `Dunmarch needs 4 workers, has ${porters.length}`)
  for (const porter of porters) {
    porter.order = null
    porter.nodeMemory = -1
    porter.cargo = 0
  }
  state.aiExplored[node.ty * MAP_W + node.tx] = 1
  assignMiners(state, porters, null)
  const onNode = porters.filter((unit) => assignedDeposit(unit) === node.id)
  assert(onNode.length === 3, `Dunmarch put ${onNode.length} workers on one deposit`)
}

function oreSelectionShowsAmount(): void {
  const state = createMatch(3)
  const node = state.ore.find((entry) => entry.amount > 0)
  assert(node, 'missing minerals')
  state.selectedOre = node.id
  const text = describeSelection(state)
  assert(text.includes('Minerals'), 'minerals panel missing title')
  assert(!text.includes('>Ore<'), 'minerals panel still says Ore')
  assert(text.includes(`${node.amount} remaining`), `minerals panel missing amount: ${text}`)
  const worker = state.units.find((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  assert(worker, 'missing worker')
  state.selectedOre = null
  state.selectedUnits = [worker.id]
  const workerPanel = describeSelection(state)
  assert(workerPanel.includes(UNIT_STATS.porter.label) && UNIT_STATS.porter.label === 'Worker', 'selection does not say Worker')
  assert(workerPanel.includes('minerals'), 'worker panel does not say minerals')
  state.selectedUnits = []
  state.selectedOre = node.id
  node.amount = 80
  assert(describeSelection(state).includes('80 remaining'), 'minerals panel did not follow the amount')
}

function minersClearRockToGather(): void {
  const state = createMatch(9)
  const node = state.ore.find((entry) => entry.ty > 28 && entry.tx < 18)
  assert(node, 'no southern minerals')
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
  assert(spot, 'no open ground north of the minerals wall')
  const miner = makeUnit(state, 0, 'porter', (spot.tx + 0.5) * TILE, (spot.ty + 0.5) * TILE)
  const tank = makeUnit(state, 0, 'howler', (spot.tx + 1.5) * TILE, (spot.ty + 0.5) * TILE)
  commandGather(state, [miner.id, tank.id], node.id)
  const ordered = unitById(state, miner.id)
  assert(
    ordered?.order?.type === 'attack' && ordered.order.kind === 'rock' && ordered.order.resumeNode === node.id,
    'worker did not attack the rock sealing the minerals',
  )
  const tankOrder = unitById(state, tank.id)?.order
  assert(!(tankOrder?.type === 'attack' && tankOrder.kind === 'rock'), 'tank was sent to break rock')
  const targetId = ordered.order.targetId
  let broke = false
  for (let i = 0; i < 45 * 60; i++) {
    step(state, 1 / 60)
    const tankNow = unitById(state, tank.id)?.order
    assert(!(tankNow?.type === 'attack' && tankNow.kind === 'rock'), 'tank attacked a rock while workers gathered')
    const worker = unitById(state, miner.id)
    if (worker && Math.floor(worker.y / TILE) > wallY && state.rocks.some((rock) => rock.id === targetId)) {
      assert(false, 'worker crossed the wall before the rock fell')
    }
    if (!state.rocks.some((rock) => rock.id === targetId)) {
      broke = true
      break
    }
  }
  assert(broke, 'worker did not break the rock sealing the minerals')
  let resumed = false
  for (let i = 0; i < 5 * 60; i++) {
    step(state, 1 / 60)
    const order = unitById(state, miner.id)?.order
    if (order?.type === 'gather' && order.nodeId === node.id) {
      resumed = true
      break
    }
  }
  assert(resumed, 'worker did not go back to gathering after the rock fell')
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

function combatUnitsDoNotChipRock(): void {
  const state = createMatch(8)
  const rock = state.rocks[0]
  assert(rock, 'missing rock')
  const before = rock.hp
  const pike = makeUnit(state, 0, 'pike', (rock.tx + 0.5) * TILE + 28, (rock.ty + 0.5) * TILE)
  const tank = makeUnit(state, 0, 'howler', (rock.tx + 0.5) * TILE - 28, (rock.ty + 0.5) * TILE)
  commandAttack(state, [pike.id, tank.id], rock.id, 'rock')
  assert(unitById(state, pike.id)?.order == null, 'bike accepted a rock order')
  assert(unitById(state, tank.id)?.order == null, 'tank accepted a rock order')
  for (let i = 0; i < 3 * 60; i++) step(state, 1 / 60)
  const still = state.rocks.find((entry) => entry.id === rock.id)
  assert(still?.hp === before, 'combat unit damaged a rock')
}

function aiPlacesMoreFactoriesAndSilos(): void {
  const state = createMatch(2)
  state.oreHeld[1] = 4000
  const finishSites = () => {
    for (const building of state.buildings) {
      if (building.owner !== 1 || building.complete) continue
      building.complete = true
      building.progress = 1
    }
    for (const unit of state.units) {
      if (unit.owner === 1 && unit.order?.type === 'construct') {
        unit.order = null
        unit.path = []
        unit.goalX = null
        unit.goalY = null
      }
    }
    rebuildBlocked(state)
    recomputeSupply(state)
  }
  const packSupply = () => {
    let guard = 0
    while (state.supplyCap[1] - state.supplyUsed[1] > 2 && guard++ < 80) {
      makeUnit(state, 1, 'pike', 40 + guard * 4, 40)
      recomputeSupply(state)
    }
  }
  step(state, 0.5)
  assert(
    state.buildings.some((building) => building.owner === 1 && building.kind === 'yard'),
    'Dunmarch did not start a factory',
  )
  finishSites()
  step(state, 0.5)
  const yards = state.buildings.filter((building) => building.owner === 1 && building.kind === 'yard')
  assert(yards.length >= 2, `Dunmarch stopped at ${yards.length} factories`)
  finishSites()
  for (let n = 0; n < 5; n++) {
    packSupply()
    const before = state.buildings.filter((building) => building.owner === 1 && building.kind === 'silo').length
    step(state, 0.5)
    const after = state.buildings.filter((building) => building.owner === 1 && building.kind === 'silo').length
    assert(after > before, `Dunmarch did not start silo ${n + 1} (have ${after})`)
    finishSites()
  }
  const silos = state.buildings.filter((building) => building.owner === 1 && building.kind === 'silo').length
  assert(silos >= 5, `Dunmarch stopped at ${silos} silos`)
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

function carveGround(state: MatchState, open: Array<[number, number]>): void {
  state.tiles.fill(1)
  for (const [tx, ty] of open) state.tiles[ty * MAP_W + tx] = 0
  state.rocks = []
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (state.tiles[ty * MAP_W + tx] !== 1) continue
      state.rocks.push({ id: state.nextId++, tx, ty, hp: ROCK_HP, hitFlash: 0 })
    }
  }
}

function parkOtherWorkers(state: MatchState, keeperId: number): void {
  for (const unit of state.units) {
    if (unit.owner !== 1 || unit.kind !== 'porter' || unit.id === keeperId || unit.hp <= 0) continue
    unit.order = { type: 'move', x: unit.x, y: unit.y }
    unit.cargo = 0
    unit.nodeMemory = -1
    unit.path = []
    unit.goalX = null
    unit.goalY = null
  }
}

function aiHaulsTheShortestOpenPath(): void {
  const state = createMatch(3)
  const open: Array<[number, number]> = []
  for (let y = 10; y <= 17; y++) open.push([10, y])
  carveGround(state, open)
  for (const node of state.ore) node.amount = 0
  const far = { id: state.nextId++, tx: 10, ty: 18, amount: 420 }
  const near = { id: state.nextId++, tx: 14, ty: 10, amount: 420 }
  state.ore.push(far, near)
  state.aiExplored[far.ty * MAP_W + far.tx] = 1
  state.aiExplored[near.ty * MAP_W + near.tx] = 1
  rebuildBlocked(state)
  const worker = state.units.find((unit) => unit.owner === 1 && unit.kind === 'porter')
  assert(worker, 'missing Dunmarch worker')
  worker.x = 10.5 * TILE
  worker.y = 10.5 * TILE
  worker.order = null
  worker.cargo = 0
  worker.path = []
  worker.goalX = null
  worker.goalY = null
  worker.nodeMemory = 0
  parkOtherWorkers(state, worker.id)
  state.oreHeld[1] = 0
  state.aiAttacking = false
  step(state, 0.5)
  const order = unitById(state, worker.id)?.order
  assert(
    order?.type === 'gather' && order.nodeId === far.id,
    `Dunmarch skipped the open minerals path for a nearer sealed patch (${order?.type ?? 'none'})`,
  )
}

function aiBreaksRockClosestToMinerals(): void {
  const state = createMatch(4)
  const open: Array<[number, number]> = []
  for (let y = 10; y <= 12; y++) open.push([10, y])
  open.push([11, 12])
  for (let y = 13; y <= 15; y++) open.push([11, y])
  open.push([10, 15], [10, 17])
  carveGround(state, open)
  for (const [tx, ty] of [
    [9, 17],
    [11, 17],
    [9, 18],
    [11, 18],
    [9, 19],
    [10, 19],
    [11, 19],
  ] as const) {
    state.tiles[ty * MAP_W + tx] = 2
    state.rocks = state.rocks.filter((rock) => rock.tx !== tx || rock.ty !== ty)
  }
  for (const node of state.ore) node.amount = 0
  const node = { id: state.nextId++, tx: 10, ty: 18, amount: 420 }
  state.ore.push(node)
  state.aiExplored[node.ty * MAP_W + node.tx] = 1
  rebuildBlocked(state)
  const nearRock = state.rocks.find((rock) => rock.tx === 10 && rock.ty === 13)
  const farRock = state.rocks.find((rock) => rock.tx === 10 && rock.ty === 16)
  assert(nearRock && farRock, 'missing the rocks that seal the minerals')
  assert(
    findPath(state.blocked, MAP_W, MAP_H, 10, 10, 10, 17) === null,
    'a clear path already reached the minerals',
  )
  const worker = state.units.find((unit) => unit.owner === 1 && unit.kind === 'porter')
  assert(worker, 'missing Dunmarch worker')
  worker.x = 10.5 * TILE
  worker.y = 10.5 * TILE
  worker.order = null
  worker.cargo = 0
  worker.path = []
  worker.goalX = null
  worker.goalY = null
  worker.nodeMemory = 0
  parkOtherWorkers(state, worker.id)
  state.oreHeld[1] = 0
  state.aiAttacking = false
  step(state, 0.5)
  const order = unitById(state, worker.id)?.order
  assert(
    order?.type === 'attack' && order.kind === 'rock' && order.targetId === farRock.id,
    `Dunmarch broke rock ${order?.type === 'attack' ? order.targetId : 'none'} instead of the one beside the minerals (${farRock.id}, worker-side ${nearRock.id})`,
  )
}

function fogHidesUnexploredGround(): void {
  const state = createMatch(1)
  const keep = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  const enemy = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(keep && enemy, 'missing castles')
  assert(tileVisible(state, keep.tx + 1, keep.ty + 1), 'the player castle is not in sight')
  assert(tileExplored(state, keep.tx + 1, keep.ty + 1), 'the player castle was not explored')
  assert(!tileVisible(state, enemy.tx + 1, enemy.ty + 1), 'Dunmarch is visible at the start')
  assert(!tileExplored(state, enemy.tx + 1, enemy.ty + 1), 'Dunmarch starts explored')
  const foe = makeUnit(state, 1, 'pike', (enemy.tx + 1.5) * TILE, (enemy.ty + 5) * TILE)
  updateVision(state)
  assert(!unitSeen(state, foe), 'an enemy outside sight is shown')
  const scout = makeUnit(state, 0, 'howler', foe.x + 30, foe.y)
  updateVision(state)
  assert(unitSeen(state, foe), 'a nearby friendly unit did not reveal the enemy')
  assert(tileExplored(state, enemy.tx + 1, enemy.ty + 1), 'scouting did not mark the ground explored')
  scout.hp = 0
  scout.x = (keep.tx + 1.5) * TILE
  scout.y = (keep.ty + 1.5) * TILE
  updateVision(state)
  assert(!unitSeen(state, foe), 'the enemy stayed visible after the scout left')
  assert(tileExplored(state, enemy.tx + 1, enemy.ty + 1), 'explored ground was forgotten')
  assert(!tileVisible(state, enemy.tx + 1, enemy.ty + 1), 'abandoned ground stayed lit')
  assert(groundShown(state, enemy.tx + 1, enemy.ty + 1), 'rocks and minerals vanished from the gray shroud')
  assert(!groundShown(state, 0, 0), 'black ground still shows rocks and minerals')
  assert(!aiTileExplored(state, keep.tx + 1, keep.ty + 1), 'Dunmarch started with a view of Northmark')
}

function clearFogCommandRevealsTheMap(): void {
  const state = createMatch(1)
  const enemy = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(enemy, 'missing Dunmarch castle')
  assert(!tileExplored(state, enemy.tx + 1, enemy.ty + 1), 'the map started fully revealed')
  assert(!runCommand(state, 'no such order'), 'an unknown line was accepted')
  assert(!state.fogCleared, 'an unknown command cleared the fog')
  assert(runCommand(state, '  Clear Fog of War  '), 'Clear Fog of War was rejected')
  assert(state.fogCleared, 'the command did not mark fog cleared')
  assert(tileVisible(state, 0, 0) && tileExplored(state, MAP_W - 1, MAP_H - 1), 'a corner of the map stayed hidden')
  assert(tileVisible(state, enemy.tx + 1, enemy.ty + 1), 'Dunmarch stayed hidden after the command')
  const home = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(home && !aiTileExplored(state, home.tx + 1, home.ty + 1), 'Clear Fog of War also revealed the map for Dunmarch')
  step(state, 0.5)
  assert(state.fogCleared && tileVisible(state, enemy.tx, enemy.ty), 'fog returned after the command')
  const again = createMatch(2)
  assert(!again.fogCleared, 'a new match kept the cleared fog')
  assert(runCommand(again, 'clear fog'), 'the clear fog alias was rejected')
  assert(again.fogCleared && tileVisible(again, 0, MAP_H - 1), 'clear fog left part of the map dark')
}

function godModeSavesNorthmark(): void {
  const state = createMatch(11)
  const open: Array<[number, number]> = []
  for (let y = 9; y <= 14; y++) {
    for (let x = 10; x <= 16; x++) open.push([x, y])
  }
  carveGround(state, open)
  rebuildBlocked(state)
  const home = makeBuilding(state, 0, 'silo', 10, 10, true)
  const worker = makeUnit(state, 0, 'porter', 14.5 * TILE, 10.5 * TILE)
  const foe = makeUnit(state, 1, 'pike', worker.x + 28, worker.y)
  const sieger = makeUnit(state, 1, 'howler', 13.5 * TILE, 12.5 * TILE)
  assert(runCommand(state, 'God Mode'), 'God Mode was rejected')
  assert(state.godMode, 'God Mode did not turn on')
  const workerHp = worker.hp
  const homeHp = home.hp
  const foeHp = foe.hp
  commandAttack(state, [foe.id], worker.id, 'unit')
  commandAttack(state, [worker.id], foe.id, 'unit')
  commandAttack(state, [sieger.id], home.id, 'building')
  for (let i = 0; i < 5 * 60; i++) step(state, 1 / 60)
  const workerNow = unitById(state, worker.id)
  const homeNow = state.buildings.find((building) => building.id === home.id)
  const foeNow = unitById(state, foe.id)
  assert(workerNow && workerNow.hp === workerHp, 'a Northmark worker took damage in God Mode')
  assert(homeNow && homeNow.hp === homeHp, 'a Northmark building took damage in God Mode')
  assert(!foeNow || foeNow.hp < foeHp, 'God Mode also protected Dunmarch')
  const fresh = createMatch(12)
  assert(!fresh.godMode, 'a new match kept God Mode')
  assert(runCommand(fresh, 'god mode'), 'god mode alias was rejected')
  assert(fresh.godMode, 'the alias did not turn God Mode on')
}

function fogAndGodModeTurnOff(): void {
  const state = createMatch(14)
  const keep = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  const enemy = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(keep && enemy, 'missing castles')
  assert(runCommand(state, 'Fog of War'), 'Fog of War was rejected while already on')
  assert(!state.fogCleared && !tileExplored(state, enemy.tx + 1, enemy.ty + 1), 'Fog of War cleared a map that was already hidden')
  assert(runCommand(state, 'Clear Fog of War'), 'could not clear fog before turning it on')
  assert(tileVisible(state, enemy.tx + 1, enemy.ty + 1), 'the clear did not reveal Dunmarch')
  assert(runCommand(state, 'fog of war'), 'fog of war was rejected')
  assert(!state.fogCleared, 'fog of war left the map revealed')
  assert(tileVisible(state, keep.tx + 1, keep.ty + 1), 'the Castle left sight when fog returned')
  assert(!tileExplored(state, enemy.tx + 1, enemy.ty + 1), 'Dunmarch stayed explored after fog returned')
  step(state, 0.5)
  assert(!tileVisible(state, enemy.tx, enemy.ty), 'fog did not stay on after the next step')

  const open: Array<[number, number]> = []
  for (let y = 9; y <= 14; y++) {
    for (let x = 10; x <= 16; x++) open.push([x, y])
  }
  carveGround(state, open)
  rebuildBlocked(state)
  const worker = makeUnit(state, 0, 'porter', 14.5 * TILE, 10.5 * TILE)
  const foe = makeUnit(state, 1, 'pike', worker.x + 28, worker.y)
  assert(runCommand(state, 'God Mode'), 'God Mode was rejected')
  commandAttack(state, [foe.id], worker.id, 'unit')
  commandAttack(state, [worker.id], foe.id, 'unit')
  for (let i = 0; i < 2 * 60; i++) step(state, 1 / 60)
  const safe = unitById(state, worker.id)
  assert(safe && safe.hp === worker.hp, 'the worker was hurt before God Mode was turned off')
  assert(runCommand(state, 'Off God Mode'), 'off god mode was rejected')
  assert(!state.godMode, 'God Mode stayed on')
  const before = safe.hp
  for (let i = 0; i < 3 * 60; i++) step(state, 1 / 60)
  const hurt = unitById(state, worker.id)
  assert(hurt && hurt.hp < before, 'the worker took no damage after God Mode was turned off')
}

function shotsCannotCrossRocks(): void {
  const state = createMatch(8)
  const open: Array<[number, number]> = []
  for (let y = 9; y <= 11; y++) {
    for (const x of [10, 11, 13, 14]) open.push([x, y])
  }
  carveGround(state, open)
  rebuildBlocked(state)
  const gun = makeUnit(state, 0, 'howler', 10.5 * TILE, 10.5 * TILE)
  const foe = makeUnit(state, 1, 'pike', 14.5 * TILE, 10.5 * TILE)
  const before = foe.hp
  commandAttack(state, [gun.id], foe.id, 'unit')
  for (let i = 0; i < 3 * 60; i++) step(state, 1 / 60)
  assert(unitById(state, foe.id)?.hp === before, 'a shot passed through gray rock')
  const blocker = state.rocks.find((rock) => rock.tx === 12 && rock.ty === 10)
  assert(blocker, 'missing the rock on the line of fire')
  blocker.hp = 0
  step(state, 1 / 60)
  commandAttack(state, [gun.id], foe.id, 'unit')
  let hurt = false
  for (let i = 0; i < 4 * 60; i++) {
    step(state, 1 / 60)
    if ((unitById(state, foe.id)?.hp ?? before) < before) {
      hurt = true
      break
    }
  }
  assert(hurt, 'clearing the rock did not let the shot through')
}

function sealIsland(state: MatchState, tx: number, ty: number): void {
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    const x = tx + dx
    const y = ty + dy
    state.tiles[y * MAP_W + x] = 2
    state.rocks = state.rocks.filter((rock) => rock.tx !== x || rock.ty !== y)
  }
}

function stuckWorkerRetargets(): void {
  const state = createMatch(5)
  const open: Array<[number, number]> = [[8, 8]]
  for (let y = 20; y <= 22; y++) {
    for (let x = 20; x <= 22; x++) open.push([x, y])
    for (let x = 30; x <= 32; x++) open.push([x, y])
  }
  carveGround(state, open)
  sealIsland(state, 8, 8)
  for (const node of state.ore) node.amount = 0
  const near = { id: state.nextId++, tx: 21, ty: 21, amount: 420 }
  const far = { id: state.nextId++, tx: 31, ty: 21, amount: 420 }
  state.ore.push(near, far)
  state.explored[near.ty * MAP_W + near.tx] = 1
  state.explored[far.ty * MAP_W + far.tx] = 1
  rebuildBlocked(state)
  const worker = makeUnit(state, 0, 'porter', 8.5 * TILE, 8.5 * TILE)
  commandGather(state, [worker.id], near.id)
  assert(assignedDeposit(worker) === near.id, 'worker did not take the nearer minerals')
  for (let i = 0; i < 200; i++) step(state, 1 / 60)
  assert(assignedDeposit(unitById(state, worker.id) ?? worker) === near.id, 'worker left the minerals before 4 seconds')
  for (let i = 0; i < 120; i++) step(state, 1 / 60)
  const moved = unitById(state, worker.id)
  assert(moved && Math.floor(moved.x / TILE) === 8 && Math.floor(moved.y / TILE) === 8, 'caged worker left the sealed tile')
  assert(assignedDeposit(moved) === far.id, 'stuck worker did not take the next minerals patch')

  const sites = createMatch(6)
  carveGround(sites, [[8, 8]])
  sealIsland(sites, 8, 8)
  rebuildBlocked(sites)
  const builder = makeUnit(sites, 0, 'porter', 8.5 * TILE, 8.5 * TILE)
  const closer = makeBuilding(sites, 0, 'silo', 18, 18, false)
  const farther = makeBuilding(sites, 0, 'silo', 30, 18, false)
  commandConstruct(sites, [builder.id], farther.id)
  for (let i = 0; i < 200; i++) step(sites, 1 / 60)
  const early = unitById(sites, builder.id)?.order
  assert(early?.type === 'construct' && early.buildingId === farther.id, 'builder left the first site before 4 seconds')
  for (let i = 0; i < 120; i++) step(sites, 1 / 60)
  const order = unitById(sites, builder.id)?.order
  assert(
    order?.type === 'construct' && order.buildingId === closer.id,
    'stuck builder did not switch to the nearer site',
  )
}

function wideMapHidesObjectsAndMakesDunmarchScout(): void {
  assert(MAP_W * 9 === MAP_H * 16, `map is ${MAP_W}x${MAP_H}, not 16:9`)
  const state = createMatch(1)
  assert(state.ore.length >= 40, `expected more mineral patches, saw ${state.ore.length}`)
  const keep = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  const enemy = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(keep && enemy, 'missing castles')
  const known = state.ore.filter((node) => depositKnown(state, 0, node.tx, node.ty))
  const hidden = state.ore.filter((node) => !depositKnown(state, 0, node.tx, node.ty))
  const aiKnown = state.ore.filter((node) => depositKnown(state, 1, node.tx, node.ty))
  const aiHidden = state.ore.filter((node) => !depositKnown(state, 1, node.tx, node.ty))
  assert(known.length >= 4, `Northmark starts with ${known.length} minerals in sight`)
  assert(hidden.length >= 8, 'Northmark can already see every mineral')
  assert(aiKnown.length >= 4, `Dunmarch starts with ${aiKnown.length} minerals in sight`)
  assert(aiHidden.length >= 8, 'Dunmarch can already see every mineral')
  assert(!aiTileExplored(state, keep.tx + 1, keep.ty + 1), 'Dunmarch starts knowing the player castle')
  const shrouded = hidden[0]
  assert(shrouded, 'missing a hidden mineral')
  state.explored[shrouded.ty * MAP_W + shrouded.tx] = 1
  assert(tileExplored(state, shrouded.tx, shrouded.ty), 'revealing a mineral did not mark the ground')
  assert(!tileVisible(state, shrouded.tx, shrouded.ty), 'a shrouded mineral is still in active sight')
  assert(groundShown(state, shrouded.tx, shrouded.ty), 'a mineral under the gray shroud is hidden')
  const black = hidden.find((node) => node.id !== shrouded.id)
  assert(black && !groundShown(state, black.tx, black.ty), 'a mineral in the black fog is shown')
  assert(depositKnown(state, 0, shrouded.tx, shrouded.ty), 'a revealed mineral was forgotten for gathering')

  const worker = state.units.find((unit) => unit.owner === 0 && unit.kind === 'porter')
  assert(worker, 'missing worker')
  for (const node of state.ore) node.amount = 0
  const seen = { id: state.nextId++, tx: 16, ty: 38, amount: 400 }
  const unseen = { id: state.nextId++, tx: 50, ty: 22, amount: 400 }
  state.ore.push(seen, unseen)
  state.explored[seen.ty * MAP_W + seen.tx] = 1
  rebuildBlocked(state)
  assignMiners(state, [worker], null)
  assert(assignedDeposit(worker) === seen.id, 'worker walked toward minerals still under the fog')
  seen.amount = 0
  worker.order = null
  worker.nodeMemory = 0
  assignMiners(state, [worker], null)
  assert(worker.order == null, 'worker took a mineral that was never revealed')

  const before = state.aiExplored.reduce((sum, bit) => sum + bit, 0)
  for (let i = 0; i < 12 * 30; i++) step(state, 1 / 30)
  const after = state.aiExplored.reduce((sum, bit) => sum + bit, 0)
  assert(after > before + 10, 'Dunmarch did not scout new ground')
  assert(!state.aiAttacking, 'Dunmarch marched on Northmark before seeing the Castle')
  assert(!state.aiSpotted.some((spot) => spot.id === keep.id), 'Dunmarch recorded the Castle without seeing it')
}

pathAroundWall()
routeExists()
gatherWorks()
buildAndTrain()
howlerCannotBreakRock()
constructionPausesUntilWorkerReturns()
aiBreaksBlockingRock()
porterBreaksRockWhenOrdered()
workersBreakRockToReachMinerals()
aiHaulsTheShortestOpenPath()
aiBreaksRockClosestToMinerals()
fogHidesUnexploredGround()
clearFogCommandRevealsTheMap()
godModeSavesNorthmark()
fogAndGodModeTurnOff()
shotsCannotCrossRocks()
stuckWorkerRetargets()
threeMinersPerDeposit()
minersSpreadToNearestOpenDeposit()
aiUsesTheSameMinerCap()
oreSelectionShowsAmount()
minersClearRockToGather()
aiIgnoresRocksOnOpenRoute()
combatUnitsDoNotChipRock()
aiPlacesMoreFactoriesAndSilos()
attacksBuildings()
combatResolves()
keepDecidesTheField()
enemyPlays()
wideMapHidesObjectsAndMakesDunmarchScout()
droneFliesFromTheFactory()
console.log('smoke ok')

function droneFliesFromTheFactory(): void {
  const state = createMatch(16)
  const yard = makeBuilding(state, 0, 'yard', 14, 30, true)
  assert(yard, 'factory was not placed')
  assert(tryTrain(state, yard.id, 'drone') === null, 'factory rejected the drone')
  const queued = yard.queue[0]
  assert(queued?.kind === 'drone', 'drone was not queued')
  assert(state.oreHeld[0] === STARTING_ORE - UNIT_STATS.drone.cost, 'drone cost was not charged')
  assert(UNIT_STATS.drone.sight === BUILDING_STATS.keep.sight, 'drone sight does not match the castle')
  assert(UNIT_STATS.drone.damage === 0 && UNIT_STATS.drone.flying, 'drone is not an unarmed flyer')
  queued.remaining = 0.01
  step(state, 0.05)
  const drone = state.units.find((unit) => unit.owner === 0 && unit.kind === 'drone')
  assert(drone, 'factory did not produce the drone')

  const rock = state.rocks.find((entry) => entry.hp > 0 && entry.tx > 4 && entry.tx < MAP_W - 4 && entry.ty > 2 && entry.ty < MAP_H - 2)
  assert(rock, 'no rock for the drone to fly over')
  drone.x = (rock.tx - 2) * TILE
  drone.y = (rock.ty + 0.5) * TILE
  drone.order = null
  drone.path = []
  drone.goalX = null
  drone.goalY = null
  const before = rock.hp
  commandMove(state, [drone.id], (rock.tx + 2) * TILE, drone.y, false)
  let crossed = false
  for (let i = 0; i < 8 * 60; i++) {
    step(state, 1 / 60)
    const now = unitById(state, drone.id)
    if (now && now.x > (rock.tx + 0.6) * TILE) {
      crossed = true
      break
    }
  }
  assert(crossed, 'drone did not fly across the rock')
  assert(state.rocks.find((entry) => entry.id === rock.id)?.hp === before, 'flying over the rock damaged it')

  drone.x = 40.5 * TILE
  drone.y = 8.5 * TILE
  drone.order = null
  updateVision(state)
  assert(tileVisible(state, 40, 8), 'drone did not reveal the tile under it')
  assert(tileVisible(state, 40, 15), 'drone sight is shorter than the castle')
  assert(!tileVisible(state, 40, 20), 'drone sight reaches farther than the castle')

  const foe = makeUnit(state, 1, 'pike', drone.x + 30, drone.y)
  const foeHp = foe.hp
  commandAttack(state, [drone.id], foe.id, 'unit')
  assert(unitById(state, drone.id)?.order == null, 'drone accepted an attack order')
  for (let i = 0; i < 3 * 60; i++) step(state, 1 / 60)
  assert(unitById(state, foe.id)?.hp === foeHp, 'drone dealt combat damage')
  foe.hp = 0

  const tank = makeUnit(state, 1, 'howler', drone.x - 40, drone.y)
  commandAttack(state, [tank.id], drone.id, 'unit')
  assert(unitById(state, tank.id)?.order == null, 'tank accepted an order to attack a drone')
  const forced = unitById(state, tank.id)
  if (forced) forced.order = { type: 'attack', targetId: drone.id, kind: 'unit' }
  const untouched = unitById(state, drone.id)?.hp ?? 0
  for (let i = 0; i < 3 * 60; i++) step(state, 1 / 60)
  assert(unitById(state, drone.id)?.hp === untouched, 'tank damaged a drone')

  const bike = makeUnit(state, 1, 'pike', drone.x + 24, drone.y + 8)
  commandAttack(state, [bike.id], drone.id, 'unit')
  const startHp = unitById(state, drone.id)?.hp ?? 0
  let firstDrop = 0
  for (let i = 0; i < 3 * 60; i++) {
    step(state, 1 / 60)
    const hp = unitById(state, drone.id)?.hp ?? startHp
    if (hp < startHp) {
      firstDrop = startHp - hp
      break
    }
  }
  assert(firstDrop === UNIT_STATS.pike.damage / 2, `bike dealt ${firstDrop} to a drone, not half of ${UNIT_STATS.pike.damage}`)
}
