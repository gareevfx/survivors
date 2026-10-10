import { DRONE_BIKE_AVOID, scoutArea, SILO_AI_EXPANSION_REACH, siloRallyPoint, siloWaveNeed, updateSiloAi } from './game/siloAi'
import { runCommand } from './game/console'
import { aiPlaceNearKeep, assignMiners, cancelTrain, commandAttack, commandConstruct, commandGather, commandHarvestOrAttack, commandMove, commandRepair, commandStop, tryPlace, tryTrain } from './game/commands'
import { CASTLE_YARD, narrowPassageCount } from './game/map'
import { AI_BUILD_GAP, AI_MINERAL_KEEP, areaCharted, findBuildSpotWithin, mineralLaneTiles } from './game/nav'
import { findPath, rockShotClear } from './game/pathfind'
import { yardEntrance } from './game/factoryArt'
import { keepEntrance } from './game/siloArt'
import { step } from './game/sim'
import { buildingCenter, buildingRect, canPlace, createMatch, isWalkable, makeBuilding, makeUnit, placementAllowed, rebuildBlocked, recomputeSupply, unitById } from './game/state'
import { storageFill } from './game/storageArt'
import { BUILDING_STATS, GATHER_AMOUNT, INTERACT, MAP_H, MAP_W, PLAYER_NAME, ROCK_HP, SILO_REPAIR_COST, SILO_REPAIR_TIME, STARTING_ORE, STORAGE_FILL_REFERENCE, TILE, TREE_HP, UNIT_STATS, type Building, type MatchState, type PlayerId, type Unit } from './game/types'
import {
  aiTileExplored,
  aiTileVisible,
  depositKnown,
  groundShown,
  tileExplored,
  tileVisible,
  unitSeen,
  updateVision,
  viewBuildingSeen,
  viewRuinShown,
  viewGroundShown,
  viewTileVisible,
  sideTileVisible,
  viewUnitSeen,
} from './game/vision'
import { toggleScanner, updateScanners } from './game/scanner'
import { describeSelection } from './ui/hud'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** Hit points are numbers, so 8/3 is stored. Subtracting it from a whole value can be off by one bit. */
function sameDamage(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) < 1e-9
}

function castleSendsTheNearestFreeWorker(): void {
  const state = createMatch(4)
  state.oreHeld[0] = 800
  state.oreHeld[1] = 800
  const workers = state.units.filter((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  assert(workers.length >= 4, 'Northmark needs four workers')
  const spot = { tx: 20, ty: 20 }
  const clearPad = (x0: number, y0: number, x1: number, y1: number) => {
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        state.tiles[ty * MAP_W + tx] = 0
        for (const ore of state.ore) {
          if (ore.tx === tx && ore.ty === ty) ore.amount = 0
        }
      }
    }
    state.rocks = state.rocks.filter((rock) => rock.tx < x0 || rock.tx > x1 || rock.ty < y0 || rock.ty > y1)
  }
  clearPad(16, 18, 40, 24)
  rebuildBlocked(state)
  assert(canPlace(state, 'yard', spot.tx, spot.ty), 'factory pad is blocked')
  const centerX = (spot.tx + BUILDING_STATS.yard.w / 2) * TILE
  const centerY = (spot.ty + BUILDING_STATS.yard.h / 2) * TILE
  const near = workers[0]
  const far = workers[1]
  const miner = workers[2]
  const busy = workers[3]
  assert(near && far && miner && busy, 'missing a worker')
  const foe = state.units.find((unit) => unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0)
  assert(foe, 'missing a Dunmarch worker')
  const place = (unit: (typeof workers)[number], dx: number) => {
    unit.x = centerX + dx
    unit.y = centerY
    unit.cargo = 0
    unit.nodeMemory = -1
    unit.path = []
    unit.goalX = null
    unit.goalY = null
  }
  place(near, 140)
  near.order = null
  place(far, 420)
  far.order = null
  place(miner, 48)
  const node = state.ore.find((entry) => entry.amount > 0)
  assert(node, 'missing minerals')
  miner.order = { type: 'gather', nodeId: node.id, phase: 'approach' }
  place(busy, 16)
  busy.order = { type: 'attack', targetId: foe.id, kind: 'unit' }
  const job = (unit: { order: { type: string } | null }) => unit.order?.type ?? 'idle'
  const placed = tryPlace(state, 0, 'yard', spot.tx, spot.ty, [])
  assert(placed === null, placed ?? 'Castle build failed')
  assert(job(near) === 'construct', 'the nearer idle worker was not sent to build')
  assert(job(far) === 'idle', 'a farther idle worker was sent instead')
  assert(job(miner) === 'gather', 'a closer miner was pulled while an idle worker was free')
  assert(job(busy) === 'attack', 'a busy worker was pulled off a fight')
  const held = state.oreHeld[0]
  near.hp = 0
  step(state, 1 / 60)
  assert(job(far) === 'construct', 'the next idle worker did not take over the site')
  assert(job(miner) === 'gather', 'a miner took over while an idle worker was free')
  for (const unit of state.units) {
    if (unit.owner !== 0 || unit.kind !== 'porter' || unit.hp <= 0) continue
    unit.order = { type: 'attack', targetId: foe.id, kind: 'unit' }
  }
  const before = state.buildings.length
  let refusedSpot: { tx: number; ty: number } | null = null
  for (let ty = 2; ty < MAP_H - 4 && !refusedSpot; ty++) {
    for (let tx = 2; tx < MAP_W - 4; tx++) {
      if (canPlace(state, 'silo', tx, ty)) {
        refusedSpot = { tx, ty }
        break
      }
    }
  }
  assert(refusedSpot, 'no open silo site')
  const refused = tryPlace(state, 0, 'silo', refusedSpot.tx, refusedSpot.ty, [])
  assert(refused === 'No free Stalker. Idle stalkers build first, then miners.', refused ?? 'a busy camp was allowed to build')
  assert(state.oreHeld[0] === held, 'minerals were spent with no free worker')
  assert(state.buildings.length === before, 'a building was placed with no free worker')

  const ai = state.units.filter((unit) => unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0)
  assert(ai.length >= 2, 'Dunmarch needs two workers')
  const aiNear = ai[0]
  const aiFar = ai[1]
  assert(aiNear && aiFar, 'missing a Dunmarch worker')
  const aiSpot = { tx: 24, ty: 30 }
  clearPad(20, 28, 44, 34)
  rebuildBlocked(state)
  assert(canPlace(state, 'silo', aiSpot.tx, aiSpot.ty), 'Dunmarch silo pad is blocked')
  const aiX = (aiSpot.tx + 1) * TILE
  const aiY = (aiSpot.ty + 1) * TILE
  aiNear.x = aiX + 70
  aiNear.y = aiY
  aiNear.order = null
  aiNear.cargo = 0
  aiFar.x = aiX + 320
  aiFar.y = aiY
  aiFar.order = null
  aiFar.cargo = 0
  for (const unit of ai) {
    if (unit.id === aiNear.id || unit.id === aiFar.id) continue
    unit.order = { type: 'attack', targetId: near.id, kind: 'unit' }
  }
  const aiPlaced = tryPlace(state, 1, 'silo', aiSpot.tx, aiSpot.ty, [])
  assert(aiPlaced === null, aiPlaced ?? 'Dunmarch build failed')
  assert(job(aiNear) === 'construct', 'Dunmarch did not send its nearer idle worker')
  assert(job(aiFar) === 'idle', 'Dunmarch sent a farther worker')
}

function pauseFreezesTheSimulation(): void {
  const state = createMatch(5)
  assert(!state.paused, 'a new match starts paused')
  const worker = state.units.find((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  assert(worker, 'missing worker')
  const startX = worker.x
  const startY = worker.y
  commandMove(state, [worker.id], startX + 480, startY, false)
  assert(worker.order?.type === 'move', 'worker was not ordered to move')
  const goalX = worker.goalX
  for (let i = 0; i < 30 && worker.x === startX; i++) step(state, 1 / 60)
  assert(worker.x !== startX, 'worker did not move before the pause')
  const frozenX = worker.x
  const frozenY = worker.y
  const frozenTime = state.time
  state.paused = true
  commandMove(state, [worker.id], startX, startY - 400, false)
  assert(worker.goalX === goalX, 'a move order took effect while paused')
  for (let i = 0; i < 180; i++) step(state, 1 / 60)
  assert(state.time === frozenTime, 'the clock advanced while paused')
  assert(worker.x === frozenX && worker.y === frozenY, 'a unit moved while paused')
  state.paused = false
  step(state, 1 / 60)
  assert(Math.abs(state.time - (frozenTime + 1 / 60)) < 1e-6, 'resume did not continue the clock by one step')
  assert(worker.x !== frozenX || worker.y !== frozenY, 'the move did not continue after resume')
}

function northmarkPlaysItself(): void {
  const state = createMatch(8)
  assert(!state.aiControl, 'a match starts under AI control')
  assert(!runCommand(state, 'ai'), 'a partial line turned AI control on')
  assert(!state.aiControl, 'a partial line changed AI control')
  assert(runCommand(state, 'AI Control'), 'AI Control was rejected')
  assert(state.aiControl, 'AI Control did not turn on')
  assert(state.toasts[state.toasts.length - 1]?.text === 'SiloAI is on.', 'SiloAI did not announce itself')
  assert(runCommand(state, 'ai control'), 'repeating AI control was rejected')
  assert(state.aiControl, 'repeating AI control turned it off')
  assert(state.toasts[state.toasts.length - 1]?.text === 'SiloAI is already on.', 'the repeat used the wrong notice')

  const watcher = state.units.find((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  assert(watcher, 'missing a Northmark worker')
  state.paused = true
  const frozenTime = state.time
  const frozenX = watcher.x
  for (let i = 0; i < 40; i++) step(state, 1 / 60)
  assert(state.time === frozenTime, 'AI control advanced the clock while paused')
  assert(watcher.x === frozenX && watcher.order == null, 'AI control gave orders while paused')
  state.paused = false

  const hidden = state.ore.find((node) => node.amount > 0 && !depositKnown(state, 0, node.tx, node.ty))
  assert(hidden, 'every mineral started inside Northmark sight')
  state.aiExplored[hidden.ty * MAP_W + hidden.tx] = 1
  state.oreHeld[0] = 800
  for (let i = 0; i < 90; i++) step(state, 1 / 60)

  const porters = state.units.filter((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  const mined = porters.filter((unit) => {
    const order = unit.order
    return order?.type === 'gather' || (order?.type === 'attack' && order.resumeNode != null)
  })
  assert(mined.length > 0, 'Northmark did not mine under AI control')
  for (const unit of mined) {
    const order = unit.order
    const nodeId = order?.type === 'gather' ? order.nodeId : order?.type === 'attack' ? order.resumeNode : null
    const node = state.ore.find((entry) => entry.id === nodeId)
    assert(node, 'a miner was sent to a missing deposit')
    assert(depositKnown(state, 0, node.tx, node.ty), 'AI control mined minerals Northmark has not seen')
    assert(node.id !== hidden.id, 'AI control used Dunmarch sight to pick minerals')
  }
  const site = state.buildings.find((building) => building.owner === 0 && !building.complete && building.hp > 0)
  assert(site && (site.kind === 'yard' || site.kind === 'silo'), 'Northmark did not start a Factory or Silo')
  assert(
    porters.some((unit) => unit.order?.type === 'construct' && unit.order.buildingId === site.id),
    'no free worker was sent to the new site',
  )

  const enemy = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  const home = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep' && building.hp > 0)
  assert(enemy && home, 'missing a castle to attack')
  state.playerSpotted.push({ id: enemy.id, x: (enemy.tx + 1.5) * TILE, y: (enemy.ty + 1.5) * TILE })
  const rally = siloRallyPoint(state, 0)
  assert(rally, 'missing the player rally')
  const need = siloWaveNeed(state)
  const pikes = []
  for (let i = 0; i < need.gorillas; i++) pikes.push(makeUnit(state, 0, 'howler', rally.x, rally.y + i * 8))
  for (let i = 0; i < need.count - need.gorillas; i++) pikes.push(makeUnit(state, 0, 'pike', rally.x + 14, rally.y + i * 8))
  recomputeSupply(state)
  state.playerAiAcc = 0
  for (let i = 0; i < 40; i++) step(state, 1 / 60)
  const enemyX = (enemy.tx + 1.5) * TILE
  const enemyY = (enemy.ty + 1.5) * TILE
  const homeX = (home.tx + 1.5) * TILE
  const homeY = (home.ty + 1.5) * TILE
  const strikers = pikes.filter((unit) => {
    if (unit.hp <= 0) return false
    const order = unit.order
    if (order?.type === 'attack' && order.kind === 'building') return true
    if (order?.type !== 'attackMove') return false
    const toEnemy = Math.hypot(order.x - enemyX, order.y - enemyY)
    const toHome = Math.hypot(order.x - homeX, order.y - homeY)
    return toEnemy < toHome
  })
  assert(strikers.length > 0, 'Northmark did not march on the Dunmarch Castle')

  assert(runCommand(state, 'Off AI Control'), 'off ai control was rejected')
  assert(!state.aiControl, 'AI control stayed on')
  const idle = porters.find((unit) => unit.hp > 0 && unit.order?.type !== 'construct')
  const mover = porters.find((unit) => unit.hp > 0 && unit.id !== idle?.id && unit.order?.type !== 'construct')
  assert(idle && mover, 'missing workers to hand back')
  idle.order = null
  idle.cargo = 0
  idle.nodeMemory = -1
  commandMove(state, [mover.id], mover.x + 240, mover.y, false)
  const goalX = mover.goalX
  const goalY = mover.goalY
  assert(mover.order?.type === 'move', 'the player could not order a worker after AI control')
  for (let i = 0; i < 120; i++) step(state, 1 / 60)
  assert(idle.order == null, 'AI control kept assigning workers after it was turned off')
  assert(
    mover.order?.type === 'move' && mover.goalX === goalX && mover.goalY === goalY,
    'turning AI control off replaced the player order',
  )

  const fresh = createMatch(9)
  assert(!fresh.aiControl, 'a new match kept AI control')
  assert(runCommand(fresh, 'OFF AI CONTROL'), 'off ai control was rejected while already off')
  assert(!fresh.aiControl, 'the off command turned AI control on')
  assert(fresh.toasts[fresh.toasts.length - 1]?.text === 'SiloAI is already off.', 'the off notice was wrong')
}

function castleYardsStayOpen(): void {
  const stats = BUILDING_STATS.keep
  for (let seed = 1; seed <= 16; seed++) {
    const state = createMatch(seed)
    for (const owner of [0, 1] as const) {
      const keep = state.buildings.find((building) => building.owner === owner && building.kind === 'keep')
      assert(keep, `seed ${seed} side ${owner} is missing a castle`)
      for (let ty = keep.ty - CASTLE_YARD; ty <= keep.ty + stats.h - 1 + CASTLE_YARD; ty++) {
        for (let tx = keep.tx - CASTLE_YARD; tx <= keep.tx + stats.w - 1 + CASTLE_YARD; tx++) {
          if (tx >= keep.tx && tx < keep.tx + stats.w && ty >= keep.ty && ty < keep.ty + stats.h) continue
          if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue
          const blocker = state.rocks.find((rock) => rock.tx === tx && rock.ty === ty && rock.hp > 0)
          assert(!blocker, `seed ${seed} side ${owner} has a ${blocker?.kind ?? 'blocker'} in the castle yard`)
        }
      }
    }
  }
}

function treesGrowInGrovesAndBlockLikeRocks(): void {
  let trees = 0
  let stones = 0
  let groved = 0
  for (let seed = 1; seed <= 12; seed++) {
    const state = createMatch(seed)
    const treeAt = new Set(
      state.rocks.filter((rock) => rock.kind === 'tree' && rock.hp > 0).map((rock) => rock.ty * MAP_W + rock.tx),
    )
    for (const rock of state.rocks) {
      if (rock.hp <= 0) continue
      if (rock.kind === 'tree') {
        assert(rock.hp === TREE_HP, `a tree started at ${rock.hp}, not ${TREE_HP}`)
        trees += 1
        let neighbor = false
        for (let dy = -1; dy <= 1 && !neighbor; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            if (treeAt.has((rock.ty + dy) * MAP_W + (rock.tx + dx))) neighbor = true
          }
        }
        if (neighbor) groved += 1
        assert(state.tiles[rock.ty * MAP_W + rock.tx] === 3, 'a tree tile is not marked as a tree')
        assert(!isWalkable(state, rock.tx, rock.ty), 'a tree does not block movement')
      } else {
        assert(rock.hp === ROCK_HP, `a rock started at ${rock.hp}, not ${ROCK_HP}`)
        stones += 1
        assert(state.tiles[rock.ty * MAP_W + rock.tx] === 1, 'a rock tile is not marked as stone')
      }
    }
  }
  const share = trees / (trees + stones)
  assert(trees > 0 && stones > 0, 'the map is missing trees or rocks')
  assert(share >= 0.33 && share <= 0.5, `trees are ${share.toFixed(2)} of the blockers`)
  assert(groved / trees >= 0.8, 'trees are scattered as single tiles instead of groves')

  const state = createMatch(6)
  const tree = state.rocks.find((rock) => rock.kind === 'tree' && rock.hp > 0 && rock.tx > 2 && rock.tx < MAP_W - 3)
  assert(tree, 'missing a tree to clear')
  assert(
    !rockShotClear(state.tiles, MAP_W, MAP_H, { tx: tree.tx - 2, ty: tree.ty }, { tx: tree.tx + 2, ty: tree.ty }),
    'a shot passes through a tree',
  )
  const around = findPath(state.blocked, MAP_W, MAP_H, tree.tx - 1, tree.ty, tree.tx + 1, tree.ty)
  if (around) {
    assert(
      around.every((step) => step.tx !== tree.tx || step.ty !== tree.ty),
      'a path stepped on a tree',
    )
  }
  let stand: { tx: number; ty: number } | null = null
  for (let dy = -1; dy <= 1 && !stand; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (isWalkable(state, tree.tx + dx, tree.ty + dy)) {
        stand = { tx: tree.tx + dx, ty: tree.ty + dy }
        break
      }
    }
  }
  assert(stand, 'no open tile beside a tree')
  const before = tree.hp
  const porter = makeUnit(state, 0, 'porter', (stand.tx + 0.5) * TILE, (stand.ty + 0.5) * TILE)
  commandAttack(state, [porter.id], tree.id, 'rock')
  for (let i = 0; i < 4 * 60; i++) step(state, 1 / 60)
  const still = state.rocks.find((rock) => rock.id === tree.id)
  assert((still?.hp ?? 0) < before, 'a worker did not damage the tree')

  const other = state.rocks.find((rock) => rock.kind === 'tree' && rock.hp > 0 && rock.id !== tree.id)
  assert(other, 'missing a second tree')
  const bike = makeUnit(state, 0, 'pike', (other.tx + 0.5) * TILE + 20, (other.ty + 0.5) * TILE)
  const bikeHp = other.hp
  commandAttack(state, [bike.id], other.id, 'rock')
  assert(bike.order?.type !== 'attack', 'a bike was sent to chop a tree')
  for (let i = 0; i < 2 * 60; i++) step(state, 1 / 60)
  assert(state.rocks.find((rock) => rock.id === other.id)?.hp === bikeHp, 'a bike damaged a tree')
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
    if (d < best) {
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
  const spot = yardNearHome(state)
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

function yardNearHome(state: MatchState): { tx: number; ty: number } | null {
  const keep = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  if (!keep) return null
  for (let rad = 2; rad <= 14; rad++) {
    for (let ty = keep.ty - rad; ty <= keep.ty + 3 + rad; ty++) {
      for (let tx = keep.tx - rad; tx <= keep.tx + 3 + rad; tx++) {
        const edge = tx === keep.tx - rad || ty === keep.ty - rad || tx === keep.tx + 3 + rad || ty === keep.ty + 3 + rad
        if (!edge) continue
        if (canPlace(state, 'yard', tx, ty)) return { tx, ty }
      }
    }
  }
  return null
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
  const spot = yardNearHome(state)
  assert(spot, 'no yard site for paused build')
  const placed = tryPlace(state, 0, 'yard', spot.tx, spot.ty, porters.map((unit) => unit.id))
  assert(placed === null, placed ?? 'place failed')
  const yard = state.buildings.find((building) => building.owner === 0 && building.kind === 'yard' && !building.complete)
  assert(yard, 'yard was not started')
  const foe = state.units.find((unit) => unit.owner === 1 && unit.hp > 0)
  assert(foe, 'missing an enemy for the spare workers')
  for (const unit of porters) {
    if (unit.order?.type === 'construct') continue
    unit.order = { type: 'attack', targetId: foe.id, kind: 'unit' }
    unit.nodeMemory = -1
  }
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
  const rock = state.rocks.find((entry) => isWalkable(state, entry.tx + 1, entry.ty))
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

function sealRow(state: MatchState, wallY: number): void {
  // Open the approach and everything past the wall so one broken rock
  // is the whole seal. Groves south of the line would otherwise keep
  // the worker chopping after the gap opens.
  for (let ty = Math.max(0, wallY - 4); ty < MAP_H; ty++) {
    if (ty === wallY) continue
    state.rocks = state.rocks.filter((rock) => rock.ty !== ty)
    for (let tx = 0; tx < MAP_W; tx++) {
      if (footprintBlocks(state, tx, ty)) continue
      const tile = state.tiles[ty * MAP_W + tx]
      if (tile === 1 || tile === 3) state.tiles[ty * MAP_W + tx] = 0
    }
  }
  for (let tx = 0; tx < MAP_W; tx++) {
    if (footprintBlocks(state, tx, wallY)) continue
    state.rocks = state.rocks.filter((rock) => rock.tx !== tx || rock.ty !== wallY)
    state.tiles[wallY * MAP_W + tx] = 1
    state.rocks.push({ id: state.nextId++, tx, ty: wallY, hp: ROCK_HP, hitFlash: 0 })
  }
}

function aiBreaksBlockingRock(): void {
  const state = createMatch(9)
  const wallY = 24
  sealRow(state, wallY)
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
  const node = state.ore.find((entry) => entry.ty > 28 && entry.amount > 0)
  assert(node, 'no southern minerals')
  for (const ore of state.ore) {
    if (ore.id !== node.id) ore.amount = 0
  }
  node.amount = 420
  state.aiExplored[node.ty * MAP_W + node.tx] = 1
  const wallY = 24
  sealRow(state, wallY)
  rebuildBlocked(state)
  const porters = state.units.filter((unit) => unit.owner === 1 && unit.kind === 'porter')
  assert(porters.length > 0, 'Dunmarch has no workers')
  let placed = 0
  for (let ty = wallY - 1; ty >= 2 && placed < porters.length; ty--) {
    for (let tx = 1; tx < MAP_W - 1 && placed < porters.length; tx++) {
      if (!isWalkable(state, tx, ty)) continue
      const porter = porters[placed]
      if (!porter) break
      porter.x = (tx + 0.5) * TILE
      porter.y = (ty + 0.5) * TILE
      porter.order = null
      porter.cargo = 0
      porter.path = []
      porter.goalX = null
      porter.goalY = null
      placed += 1
    }
  }
  assert(placed === porters.length, 'no open ground north of the wall for every Dunmarch worker')
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
    findPath(state.blocked, MAP_W, MAP_H, Math.floor(origin.x / TILE), Math.floor(origin.y / TILE), south.tx, south.ty) === null,
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
  assert(text.includes('Dumps'), 'dumps panel missing title')
  assert(!text.includes('>Ore<'), 'minerals panel still says Ore')
  assert(text.includes(`${node.amount} remaining`), `minerals panel missing amount: ${text}`)
  const worker = state.units.find((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  assert(worker, 'missing worker')
  state.selectedOre = null
  state.selectedUnits = [worker.id]
  const workerPanel = describeSelection(state)
  assert(workerPanel.includes(UNIT_STATS.porter.label) && UNIT_STATS.porter.label === 'Stalker', 'selection does not say Stalker')
  assert(workerPanel.includes('Trained shelter residents;'), 'stalker panel omitted its lore')
  assert(workerPanel.includes(`${Math.ceil(worker.hp)} / ${UNIT_STATS.porter.hp}`), 'stalker panel dropped its health')
  state.selectedUnits = []
  state.selectedBuilding = null
  state.selectedOre = null
  const field = describeSelection(state)
  assert(field.includes('<h2>Surface</h2>'), 'empty panel lost the Surface title')
  assert(field.includes('Uncharted territory;'), 'empty panel omitted the Surface lore')
  assert(!field.includes('Destroy the enemy Silo'), 'empty panel still shows the old rules paragraph')
  state.selectedUnits = []
  state.selectedOre = node.id
  node.amount = 80
  assert(describeSelection(state).includes('80 remaining'), 'minerals panel did not follow the amount')
}

function minersClearRockToGather(): void {
  const state = createMatch(9)
  const node = state.ore.find((entry) => entry.ty > 28 && entry.amount > 0)
  assert(node, 'no southern minerals')
  for (const ore of state.ore) {
    if (ore.id !== node.id) ore.amount = 0
  }
  const wallY = 24
  sealRow(state, wallY)
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
  const home = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(home, 'missing a Silo for the factories')
  chartBase(state, 1, home.tx + 1, home.ty + 1, 40)
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
  const beforeSilos = state.buildings.filter((building) => building.owner === 1 && building.kind === 'silo').length
  packSupply()
  state.oreHeld[1] = 4000
  step(state, 0.5)
  const afterSilos = state.buildings.filter((building) => building.owner === 1 && building.kind === 'silo').length
  assert(afterSilos === beforeSilos, 'SiloAI raised Storage because Cells were full')
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

function enemyCamShowsDunmarchSight(): void {
  const state = createMatch(1)
  const keep = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  const enemy = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(keep && enemy, 'missing castles')
  assert(!state.enemyCam, 'a match started on enemy cam')
  assert(viewTileVisible(state, keep.tx + 1, keep.ty + 1), 'Northmark starts outside its own sight')
  assert(!viewTileVisible(state, enemy.tx + 1, enemy.ty + 1), 'Dunmarch is visible before enemy cam')
  assert(!runCommand(state, 'show enemy'), 'a partial enemy cam line was accepted')
  assert(!state.enemyCam, 'a partial line turned enemy cam on')
  assert(runCommand(state, '  Show Enemy Cam  '), 'show enemy cam was rejected')
  assert(state.enemyCam, 'show enemy cam did not turn on')
  assert(runCommand(state, 'SHOW ENEMY CAM'), 'repeating show enemy cam was rejected')
  assert(state.enemyCam, 'repeating the command turned enemy cam off')
  assert(viewTileVisible(state, enemy.tx + 1, enemy.ty + 1), 'Dunmarch castle is dark on enemy cam')
  assert(!viewTileVisible(state, keep.tx + 1, keep.ty + 1), 'Northmark castle stays lit on enemy cam')
  assert(viewBuildingSeen(state, enemy), 'Dunmarch castle is hidden from its own cam')
  assert(!viewBuildingSeen(state, keep), 'Northmark castle is drawn on enemy cam')
  assert(!tileExplored(state, enemy.tx + 1, enemy.ty + 1), 'enemy cam revealed the map for Northmark')
  assert(aiTileExplored(state, enemy.tx + 1, enemy.ty + 1), 'enemy cam forgot Dunmarch sight')
  const spy = makeUnit(state, 0, 'porter', (enemy.tx + 1.5) * TILE, (enemy.ty + 4) * TILE)
  updateVision(state)
  assert(viewUnitSeen(state, spy), 'a Northmark unit inside Dunmarch sight stayed hidden')
  spy.x = (keep.tx + 1.5) * TILE
  spy.y = (keep.ty + 1.5) * TILE
  updateVision(state)
  assert(!viewUnitSeen(state, spy), 'a Northmark unit outside Dunmarch sight stayed drawn')
  const foe = state.units.find((unit) => unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0)
  assert(foe && viewUnitSeen(state, foe), 'a Dunmarch unit was hidden on enemy cam')
  let shroud: { tx: number; ty: number } | null = null
  let black: { tx: number; ty: number } | null = null
  for (let ty = 0; ty < MAP_H && (!shroud || !black); ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (aiTileExplored(state, tx, ty) || aiTileVisible(state, tx, ty)) continue
      if (!shroud) shroud = { tx, ty }
      else if (tx !== shroud.tx || ty !== shroud.ty) {
        black = { tx, ty }
        break
      }
    }
  }
  assert(shroud && black, 'the map started fully inside Dunmarch sight')
  state.aiExplored[shroud.ty * MAP_W + shroud.tx] = 1
  assert(viewGroundShown(state, shroud.tx, shroud.ty) && !viewTileVisible(state, shroud.tx, shroud.ty), 'enemy shroud hid rocks and minerals')
  assert(!viewGroundShown(state, black.tx, black.ty), 'black ground on enemy cam still shows rocks and minerals')
  assert(runCommand(state, 'Off Enemy Cam'), 'off enemy cam was rejected')
  assert(!state.enemyCam, 'off enemy cam left the mode on')
  assert(viewTileVisible(state, keep.tx + 1, keep.ty + 1), 'Northmark sight did not return')
  assert(!viewTileVisible(state, enemy.tx + 1, enemy.ty + 1), 'Dunmarch stayed visible after enemy cam')
  assert(viewBuildingSeen(state, keep) && !viewBuildingSeen(state, enemy), 'building sight did not return to Northmark')
  assert(runCommand(state, 'off enemy cam'), 'off enemy cam was rejected while already off')
  assert(!state.enemyCam, 'the off command turned enemy cam back on')
  const cleared = createMatch(2)
  assert(runCommand(cleared, 'off fog of war'), 'could not turn fog off')
  assert(runCommand(cleared, 'show enemy cam'), 'enemy cam was rejected after clear fog')
  const clearedKeep = cleared.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(clearedKeep, 'missing castle')
  assert(tileVisible(cleared, clearedKeep.tx + 1, clearedKeep.ty + 1), 'clear fog stopped revealing Northmark')
  assert(!viewTileVisible(cleared, clearedKeep.tx + 1, clearedKeep.ty + 1), 'clear fog also revealed enemy cam')
  const fresh = createMatch(3)
  assert(!fresh.enemyCam, 'a new match kept enemy cam')
}

function bothCamMergesSight(): void {
  const state = createMatch(1)
  const keep = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  const enemy = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(keep && enemy, 'missing castles')
  assert(!state.bothCam, 'a match started on both cam')
  assert(!runCommand(state, 'both'), 'a partial both cam line was accepted')
  assert(!state.bothCam, 'a partial line turned both cam on')
  assert(runCommand(state, '  Both Cam  '), 'both cam was rejected')
  assert(state.bothCam && !state.enemyCam && !state.fogCleared, 'both cam did not replace the normal view')
  assert(state.toasts[state.toasts.length - 1]?.text === 'Both cam is on.', 'both cam did not announce itself')
  assert(runCommand(state, 'BOTH CAM'), 'repeating both cam was rejected')
  assert(state.toasts[state.toasts.length - 1]?.text === 'Both cam is already on.', 'the repeat used the wrong notice')
  assert(viewTileVisible(state, keep.tx + 1, keep.ty + 1), 'Northmark went dark on both cam')
  assert(viewTileVisible(state, enemy.tx + 1, enemy.ty + 1), 'Dunmarch stayed dark on both cam')
  assert(viewBuildingSeen(state, keep) && viewBuildingSeen(state, enemy), 'a castle was hidden on both cam')
  assert(!tileExplored(state, enemy.tx + 1, enemy.ty + 1), 'both cam revealed Dunmarch to Northmark')
  assert(!aiTileExplored(state, keep.tx + 1, keep.ty + 1), 'both cam revealed Northmark to Dunmarch')
  const foe = state.units.find((unit) => unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0)
  assert(foe && viewUnitSeen(state, foe), 'a Dunmarch worker inside its own sight was hidden')
  let sharedBlack: { tx: number; ty: number } | null = null
  let secondBlack: { tx: number; ty: number } | null = null
  for (let ty = 0; ty < MAP_H && (!sharedBlack || !secondBlack); ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (tileExplored(state, tx, ty) || aiTileExplored(state, tx, ty)) continue
      if (tileVisible(state, tx, ty) || aiTileVisible(state, tx, ty)) continue
      if (!sharedBlack) sharedBlack = { tx, ty }
      else if (!secondBlack) secondBlack = { tx, ty }
    }
  }
  assert(sharedBlack && secondBlack, 'the map started fully explored by someone')
  assert(!viewGroundShown(state, sharedBlack.tx, sharedBlack.ty), 'ground neither side has seen is drawn')
  state.aiExplored[sharedBlack.ty * MAP_W + sharedBlack.tx] = 1
  assert(
    viewGroundShown(state, sharedBlack.tx, sharedBlack.ty) && !viewTileVisible(state, sharedBlack.tx, sharedBlack.ty),
    'Dunmarch shroud did not merge into the gray',
  )
  assert(!tileExplored(state, sharedBlack.tx, sharedBlack.ty), 'merged shroud was written into Northmark memory')
  state.explored[secondBlack.ty * MAP_W + secondBlack.tx] = 1
  assert(
    viewGroundShown(state, secondBlack.tx, secondBlack.ty) && !viewTileVisible(state, secondBlack.tx, secondBlack.ty),
    'Northmark shroud did not merge into the gray',
  )
  assert(runCommand(state, 'show enemy cam'), 'enemy cam was rejected while both cam was on')
  assert(state.enemyCam && !state.bothCam && !state.fogCleared, 'enemy cam did not replace both cam')
  assert(!viewTileVisible(state, keep.tx + 1, keep.ty + 1), 'Northmark stayed lit after switching to enemy cam')
  assert(runCommand(state, 'both cam'), 'both cam was rejected after enemy cam')
  assert(state.bothCam && !state.enemyCam, 'both cam did not replace enemy cam')
  assert(runCommand(state, 'off fow'), 'off fow was rejected while both cam was on')
  assert(state.fogCleared && !state.bothCam && !state.enemyCam, 'off fow did not replace both cam')
  assert(viewTileVisible(state, 0, 0), 'off fow left a corner dark')
  assert(state.toasts[state.toasts.length - 1]?.text === 'FOW is off.', 'off fow used the old notice')
  assert(runCommand(state, 'FOW'), 'fow was rejected')
  assert(!state.fogCleared && !state.bothCam && !state.enemyCam, 'fow did not return to the normal view')
  assert(state.toasts[state.toasts.length - 1]?.text === 'FOW is on.', 'fow used the old notice')
  assert(viewTileVisible(state, keep.tx + 1, keep.ty + 1), 'the normal view lost Northmark')
  assert(!viewTileVisible(state, enemy.tx + 1, enemy.ty + 1), 'the normal view kept Dunmarch lit')
  assert(!tileExplored(state, enemy.tx + 1, enemy.ty + 1), 'fow left the enemy castle explored')
  assert(runCommand(state, 'off both cam'), 'off both cam was rejected while already off')
  assert(state.toasts[state.toasts.length - 1]?.text === 'Both cam is already off.', 'the off notice was wrong')
  assert(runCommand(state, 'both cam') && runCommand(state, 'Off Both Cam'), 'off both cam was rejected')
  assert(!state.bothCam && !state.enemyCam && !state.fogCleared, 'off both cam left a special view on')
  assert(viewTileVisible(state, keep.tx + 1, keep.ty + 1) && !viewTileVisible(state, enemy.tx + 1, enemy.ty + 1), 'off both cam did not return to Northmark')
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
  assert(!runCommand(state, 'clear fog of war'), 'the old clear fog command was still accepted')
  assert(!state.fogCleared, 'the old command revealed the map')
  assert(runCommand(state, '  Off Fog of War  '), 'Off Fog of War was rejected')
  assert(state.fogCleared, 'the command did not mark fog cleared')
  assert(tileVisible(state, 0, 0) && tileExplored(state, MAP_W - 1, MAP_H - 1), 'a corner of the map stayed hidden')
  assert(tileVisible(state, enemy.tx + 1, enemy.ty + 1), 'Dunmarch stayed hidden after the command')
  const home = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(home && !aiTileExplored(state, home.tx + 1, home.ty + 1), 'Off Fog of War also revealed the map for Dunmarch')
  step(state, 0.5)
  assert(state.fogCleared && tileVisible(state, enemy.tx, enemy.ty), 'fog returned after the command')
  const again = createMatch(2)
  assert(!again.fogCleared, 'a new match kept the cleared fog')
  assert(!runCommand(again, 'clear fog'), 'the old clear fog alias was accepted')
  assert(!again.fogCleared, 'the old alias revealed the map')
  assert(runCommand(again, 'OFF FOG OF WAR'), 'the off fog command was rejected')
  assert(again.fogCleared && tileVisible(again, 0, MAP_H - 1), 'off fog of war left part of the map dark')
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
  assert(runCommand(state, 'Off Fog of War'), 'could not turn fog off before turning it on')
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
  const worker = makeUnit(state, 0, 'pike', 14.5 * TILE, 10.5 * TILE)
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

function unitsSteerAroundEachOther(): void {
  const state = createMatch(8)
  for (const unit of state.units) unit.hp = 0
  for (const node of state.ore) node.amount = 0
  const open: Array<[number, number]> = []
  for (let y = 10; y <= 16; y++) {
    for (let x = 8; x <= 24; x++) open.push([x, y])
  }
  carveGround(state, open)
  rebuildBlocked(state)
  const west = makeUnit(state, 0, 'porter', 10.5 * TILE, 13.5 * TILE)
  const east = makeUnit(state, 1, 'porter', 20.5 * TILE, 13.5 * TILE)
  const westStart = west.x
  const eastStart = east.x
  commandMove(state, [west.id], 22.5 * TILE, 13.5 * TILE, false)
  commandMove(state, [east.id], 8.5 * TILE, 13.5 * TILE, false)
  let maxJump = 0
  let prevWest = { x: west.x, y: west.y }
  let prevEast = { x: east.x, y: east.y }
  for (let i = 0; i < 8 * 60; i++) {
    step(state, 1 / 60)
    const westNow = unitById(state, west.id)
    const eastNow = unitById(state, east.id)
    assert(westNow && eastNow, 'a passing unit disappeared')
    maxJump = Math.max(
      maxJump,
      Math.hypot(westNow.x - prevWest.x, westNow.y - prevWest.y),
      Math.hypot(eastNow.x - prevEast.x, eastNow.y - prevEast.y),
    )
    prevWest = { x: westNow.x, y: westNow.y }
    prevEast = { x: eastNow.x, y: eastNow.y }
  }
  const passedWest = unitById(state, west.id)
  const passedEast = unitById(state, east.id)
  assert(passedWest && passedEast, 'missing units after they passed')
  assert(maxJump < 24, 'a unit jumped onto another tile instead of walking around')
  assert(passedWest.x > eastStart - TILE, 'the Northmark worker did not get past the oncoming worker')
  assert(passedEast.x < westStart + TILE, 'the Dunmarch worker did not get past the oncoming worker')
  assert(Math.hypot(passedWest.x - 22.5 * TILE, passedWest.y - 13.5 * TILE) < 48, 'the Northmark worker did not finish the move')
  assert(Math.hypot(passedEast.x - 8.5 * TILE, passedEast.y - 13.5 * TILE) < 48, 'the Dunmarch worker did not finish the move')

  const blocked = createMatch(9)
  for (const unit of blocked.units) unit.hp = 0
  for (const node of blocked.ore) node.amount = 0
  carveGround(blocked, open)
  rebuildBlocked(blocked)
  const stand = makeUnit(blocked, 1, 'porter', 16.5 * TILE, 13.5 * TILE)
  const mover = makeUnit(blocked, 0, 'porter', 10.5 * TILE, 13.5 * TILE)
  commandMove(blocked, [mover.id], 22.5 * TILE, 13.5 * TILE, false)
  let standJump = 0
  let moverJump = 0
  let prevStand = { x: stand.x, y: stand.y }
  let prevMover = { x: mover.x, y: mover.y }
  for (let i = 0; i < 6 * 60; i++) {
    step(blocked, 1 / 60)
    const standNow = unitById(blocked, stand.id)
    const moverNow = unitById(blocked, mover.id)
    assert(standNow && moverNow, 'a unit disappeared while steering')
    standJump = Math.max(standJump, Math.hypot(standNow.x - prevStand.x, standNow.y - prevStand.y))
    moverJump = Math.max(moverJump, Math.hypot(moverNow.x - prevMover.x, moverNow.y - prevMover.y))
    prevStand = { x: standNow.x, y: standNow.y }
    prevMover = { x: moverNow.x, y: moverNow.y }
  }
  const around = unitById(blocked, mover.id)
  assert(around, 'the moving worker disappeared')
  assert(standJump < 24 && moverJump < 24, 'a unit was nudged onto an empty tile')
  assert(around.x > stand.x + 24, 'the worker did not walk around the unit in the way')

  const jammed = createMatch(8)
  for (const unit of jammed.units) unit.hp = 0
  for (const node of jammed.ore) node.amount = 0
  carveGround(jammed, [
    [8, 8],
    [7, 8],
  ])
  rebuildBlocked(jammed)
  const bike = makeUnit(jammed, 0, 'pike', 8 * TILE + 26, 8.5 * TILE)
  commandMove(jammed, [bike.id], 30.5 * TILE, 8.5 * TILE, false)
  let bikeJump = 0
  let prevBike = { x: bike.x, y: bike.y }
  for (let i = 0; i < 6 * 60; i++) {
    step(jammed, 1 / 60)
    const now = unitById(jammed, bike.id)
    assert(now, 'the jammed bike disappeared')
    bikeJump = Math.max(bikeJump, Math.hypot(now.x - prevBike.x, now.y - prevBike.y))
    prevBike = { x: now.x, y: now.y }
  }
  const still = unitById(jammed, bike.id)
  assert(still, 'missing jammed bike')
  assert(bikeJump < 24, 'the jammed bike was moved onto a neighboring tile in one step')
  assert(still.order == null || still.order.type === 'move', 'the jammed bike was given a different order')
}

function dunmarchAimsAtTheCastle(): void {
  const state = createMatch(4)
  const castle = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(castle, 'missing the player castle')
  const silo = makeBuilding(state, 0, 'silo', 40, 8, true)
  const castlePoint = { x: (castle.tx + 1.5) * TILE, y: (castle.ty + 1.5) * TILE }
  const siloPoint = { x: (silo.tx + 1) * TILE, y: (silo.ty + 1) * TILE }
  state.aiSpotted.push(
    { id: silo.id, x: siloPoint.x, y: siloPoint.y },
    { id: castle.id, x: castlePoint.x, y: castlePoint.y },
  )
  const rally = siloRallyPoint(state, 1)
  assert(rally, 'missing the Dunmarch rally')
  const need = siloWaveNeed(state)
  const fighters: Array<ReturnType<typeof makeUnit>> = []
  for (let i = 0; i < need.gorillas; i++) fighters.push(makeUnit(state, 1, 'howler', rally.x, rally.y + i * 8))
  for (let i = 0; i < need.count - need.gorillas; i++) {
    fighters.push(makeUnit(state, 1, 'pike', rally.x + 14, rally.y + i * 8))
  }
  const distracted = fighters.find((unit) => unit.kind === 'pike')
  assert(distracted, 'missing a fighter')
  commandAttack(state, [distracted.id], silo.id, 'building')
  step(state, 0.5)
  for (const fighter of fighters) {
    const order = unitById(state, fighter.id)?.order
    assert(order, 'fighter stood idle after the Castle was known')
    if (order.type === 'attack') {
      assert(order.kind === 'building' && order.targetId === castle.id, 'fighter kept a target other than the Castle')
      continue
    }
    assert(order.type === 'attackMove', `fighter took ${order.type} instead of marching on the Castle`)
    const toCastle = Math.hypot(order.x - castlePoint.x, order.y - castlePoint.y)
    const toSilo = Math.hypot(order.x - siloPoint.x, order.y - siloPoint.y)
    assert(toCastle < toSilo, 'fighter marched on the Silo instead of the Castle')
  }

  const sight = createMatch(4)
  const home = sight.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(home, 'missing the player castle')
  const siloTx = home.tx + 5 + 2 < MAP_W ? home.tx + 5 : home.tx - 4
  const nearSilo = makeBuilding(sight, 0, 'silo', siloTx, home.ty, true)
  const homePoint = { x: (home.tx + 1.5) * TILE, y: (home.ty + 1.5) * TILE }
  const nearPoint = { x: (nearSilo.tx + 1) * TILE, y: (nearSilo.ty + 1) * TILE }
  sight.aiSpotted.push({ id: home.id, x: homePoint.x, y: homePoint.y }, { id: nearSilo.id, x: nearPoint.x, y: nearPoint.y })
  for (const unit of sight.units) {
    if (unit.owner === 0) unit.hp = 0
  }
  const eye = makeUnit(sight, 1, 'pike', (homePoint.x + nearPoint.x) / 2, (homePoint.y + nearPoint.y) / 2)
  commandMove(sight, [eye.id], homePoint.x, homePoint.y, true)
  for (let i = 0; i < 8; i++) step(sight, 1 / 60)
  const aimed = unitById(sight, eye.id)?.order
  assert(
    aimed?.type === 'attackMove' && aimed.focusKind === 'building' && aimed.focusId === home.id,
    'Dunmarch aimed at the nearer Silo instead of the Castle',
  )
}

function dunmarchScoutsMineralsAndTheEnemy(): void {
  const state = createMatch(1)
  const home = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  const castle = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(home && castle, 'missing castles')
  state.aiExplored.fill(1)
  state.aiVisible.fill(0)
  state.aiExplored[4 * MAP_W + 4] = 0
  state.aiExplored[30 * MAP_W + 40] = 0
  const fromX = 8.5 * TILE
  const fromY = 4.5 * TILE
  const minerals = scoutArea(state, fromX, fromY)
  assert(minerals, 'no scout goal while black ground is nearby')
  assert(
    Math.floor(minerals.x / TILE) === 4 && Math.floor(minerals.y / TILE) === 4,
    'scout ignored nearby black ground with minerals still hidden',
  )
  state.aiExplored[4 * MAP_W + 4] = 1
  const hunt = scoutArea(state, fromX, fromY)
  assert(hunt, 'no scout goal for the far fog')
  assert(
    Math.floor(hunt.x / TILE) === 40 && Math.floor(hunt.y / TILE) === 30,
    'scout did not head across the map for the enemy',
  )
  state.aiExplored.fill(1)
  state.aiVisible.fill(1)
  state.aiVisible[10 * MAP_W + 20] = 0
  const shroud = scoutArea(state, fromX, fromY)
  assert(
    shroud && Math.floor(shroud.x / TILE) === 20 && Math.floor(shroud.y / TILE) === 10,
    'scout skipped shrouded ground while the Castle was unknown',
  )
  state.aiSpotted.push({ id: castle.id, x: (castle.tx + 1.5) * TILE, y: (castle.ty + 1.5) * TILE })
  assert(scoutArea(state, fromX, fromY) == null, 'scout kept wandering shroud after the Castle was found')

  const live = createMatch(3)
  const enemy = live.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(enemy, 'missing Dunmarch castle')
  const drone = makeUnit(live, 1, 'drone', (enemy.tx + 1.5) * TILE, (enemy.ty + 1.5) * TILE)
  const tank = makeUnit(live, 1, 'howler', drone.x + 40, drone.y)
  const startX = drone.x
  const startY = drone.y
  const before = live.aiExplored.reduce((sum, bit) => sum + bit, 0)
  step(live, 0.5)
  assert(live.aiScout === drone.id, 'Dunmarch sent a tank to scout instead of the Drone')
  const tankOrder = unitById(live, tank.id)?.order
  const rally = siloRallyPoint(live, 1)
  const homePoint = buildingCenter(enemy)
  assert(rally, 'missing the rally beside the Silo')
  const tankX = tankOrder?.type === 'attackMove' || tankOrder?.type === 'move' ? tankOrder.x : null
  const tankY = tankOrder?.type === 'attackMove' || tankOrder?.type === 'move' ? tankOrder.y : null
  assert(
    tankX != null &&
      tankY != null &&
      (Math.hypot(tankX - rally.x, tankY - rally.y) < 100 || Math.hypot(tankX - homePoint.x, tankY - homePoint.y) < 120),
    'the Gorilla left the Silo to scout',
  )
  for (let i = 0; i < 8 * 30; i++) step(live, 1 / 30)
  const flown = unitById(live, drone.id)
  assert(flown?.order?.type === 'move', 'the Drone scout was not ordered into the fog')
  assert(Math.hypot(flown.x - startX, flown.y - startY) > 48, 'the Drone scout did not move')
  const after = live.aiExplored.reduce((sum, bit) => sum + bit, 0)
  assert(after > before + 10, 'scouting did not reveal new ground')

  const prod = createMatch(6)
  const yard = makeBuilding(prod, 1, 'yard', 60, 10, true)
  prod.oreHeld[1] = 500
  step(prod, 0.5)
  assert(
    yard.queue.some((job) => job.kind === 'drone'),
    'Dunmarch Factory did not train a Drone',
  )
}

function wideMapHidesObjectsAndMakesDunmarchScout(): void {
  assert(MAP_W === 80 && MAP_H === 40, `1 vs 1 map is ${MAP_W}x${MAP_H}, not 80×40`)
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
  assert(assignedDeposit(worker) === unseen.id, 'worker ignored buried minerals after the revealed patch was empty')

  const before = state.aiExplored.reduce((sum, bit) => sum + bit, 0)
  for (let i = 0; i < 12 * 30; i++) step(state, 1 / 30)
  const after = state.aiExplored.reduce((sum, bit) => sum + bit, 0)
  assert(after > before + 10, 'Dunmarch did not scout new ground')
  assert(!state.aiAttacking, 'Dunmarch marched on Northmark before seeing the Castle')
  assert(!state.aiSpotted.some((spot) => spot.id === keep.id), 'Dunmarch recorded the Castle without seeing it')
}

function mineralsSitOnTheVisionEdge(): void {
  const sight = BUILDING_STATS.keep.sight
  const inner = sight - TILE
  for (let seed = 1; seed <= 24; seed++) {
    const state = createMatch(seed)
    for (const owner of [0, 1] as const) {
      const keep = state.buildings.find((building) => building.owner === owner && building.kind === 'keep')
      assert(keep, 'missing a castle')
      const cx = (keep.tx + BUILDING_STATS.keep.w / 2) * TILE
      const cy = (keep.ty + BUILDING_STATS.keep.h / 2) * TILE
      let nearest = Infinity
      let node: { tx: number; ty: number } | null = null
      for (const ore of state.ore) {
        const dist = Math.hypot((ore.tx + 0.5) * TILE - cx, (ore.ty + 0.5) * TILE - cy)
        if (dist < nearest) {
          nearest = dist
          node = ore
        }
      }
      assert(node, `seed ${seed} side ${owner} has no minerals`)
      assert(
        nearest >= inner - 0.01 && nearest <= sight + 0.01,
        `seed ${seed} side ${owner} nearest minerals are ${nearest.toFixed(1)}px from the castle, sight is ${sight}`,
      )
      const visible = owner === 0 ? tileVisible(state, node.tx, node.ty) : aiTileVisible(state, node.tx, node.ty)
      assert(visible, `seed ${seed} side ${owner} cannot see its starting minerals`)
      const worker = state.units.find((unit) => unit.owner === owner && unit.kind === 'porter' && unit.hp > 0)
      assert(worker, `seed ${seed} side ${owner} has no worker`)
      const start = { tx: Math.floor(worker.x / TILE), ty: Math.floor(worker.y / TILE) }
      let goal: { tx: number; ty: number } | null = null
      for (let oy = -1; oy <= 1 && !goal; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue
          const tx = node.tx + ox
          const ty = node.ty + oy
          if (isWalkable(state, tx, ty)) {
            goal = { tx, ty }
            break
          }
        }
      }
      assert(goal, `seed ${seed} side ${owner} starting minerals have no open side`)
      const path = findPath(state.blocked, MAP_W, MAP_H, start.tx, start.ty, goal.tx, goal.ty)
      assert(path, `seed ${seed} side ${owner} cannot walk to its starting minerals`)
    }
  }
}

function castlesSpawnFarApart(): void {
  const camps = new Set<string>()
  let closest = Infinity
  for (let seed = 1; seed <= 8; seed++) {
    const state = createMatch(seed)
    const home = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
    const enemy = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
    assert(home && enemy, 'missing a castle')
    const apart = Math.hypot(home.tx + 1.5 - (enemy.tx + 1.5), home.ty + 1.5 - (enemy.ty + 1.5))
    if (apart < closest) closest = apart
    camps.add(`${home.tx},${home.ty},${enemy.tx},${enemy.ty}`)
    assert(home.ty > enemy.ty, 'the camps were not on opposite ends of the map')
    const overlap =
      home.tx < enemy.tx + 3 && enemy.tx < home.tx + 3 && home.ty < enemy.ty + 3 && enemy.ty < home.ty + 3
    assert(!overlap, 'the castles overlapped')
    const workers = (owner: number) =>
      state.units.filter((unit) => unit.owner === owner && unit.kind === 'porter' && unit.hp > 0).length
    assert(workers(0) === 4 && workers(1) === 4, 'a camp did not start with four workers')
  }
  assert(closest > 65, `castles spawned too close (${closest.toFixed(1)} tiles)`)
  assert(camps.size >= 2, 'castle placement did not change between matches')
}

function buriedMineralsPreferTheFasterRock(): void {
  const state = createMatch(8)
  for (const unit of state.units) unit.hp = 0
  for (const node of state.ore) node.amount = 0
  const open: Array<[number, number]> = []
  for (let x = 10; x <= 14; x++) open.push([x, 10])
  for (let y = 11; y <= 18; y++) open.push([10, y])
  open.push([11, 18], [12, 18])
  carveGround(state, open)
  const near = { id: state.nextId++, tx: 16, ty: 10, amount: 420 }
  const far = { id: state.nextId++, tx: 16, ty: 18, amount: 420 }
  state.ore.push(near, far)
  rebuildBlocked(state)
  const worker = makeUnit(state, 0, 'porter', 10.5 * TILE, 10.5 * TILE)
  assignMiners(state, [worker], null)
  assert(assignedDeposit(worker) === near.id, 'Northmark did not open the faster buried minerals')
  assert(worker.order?.type === 'attack' && worker.order.kind === 'rock', 'Northmark walked through rock to buried minerals')
  const foe = makeUnit(state, 1, 'porter', 10.5 * TILE, 10.5 * TILE)
  assignMiners(state, [foe], null)
  assert(assignedDeposit(foe) === near.id, 'Dunmarch did not open the faster buried minerals')
  const revealed = { id: state.nextId++, tx: 12, ty: 10, amount: 420 }
  state.ore.push(revealed)
  state.explored[10 * MAP_W + 12] = 1
  state.aiExplored[10 * MAP_W + 12] = 1
  worker.order = null
  worker.nodeMemory = 0
  foe.order = null
  foe.nodeMemory = 0
  assignMiners(state, [worker], null)
  assignMiners(state, [foe], null)
  assert(assignedDeposit(worker) === revealed.id, 'Northmark left a revealed patch for buried minerals')
  assert(assignedDeposit(foe) === revealed.id, 'Dunmarch left a revealed patch for buried minerals')
}

pathAroundWall()
routeExists()
castlesSpawnFarApart()
mineralsSitOnTheVisionEdge()
castleYardsStayOpen()
treesGrowInGrovesAndBlockLikeRocks()
pauseFreezesTheSimulation()
castleSendsTheNearestFreeWorker()
buriedMineralsPreferTheFasterRock()
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
enemyCamShowsDunmarchSight()
bothCamMergesSight()
godModeSavesNorthmark()
fogAndGodModeTurnOff()
northmarkPlaysItself()
shotsCannotCrossRocks()
stuckWorkerRetargets()
unitsSteerAroundEachOther()
dunmarchAimsAtTheCastle()
dunmarchScoutsMineralsAndTheEnemy()
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
aiBuildingsLeaveAGapAndAvoidMinerals()
aiDroneNeverIdles()
droneFliesFromTheFactory()
hoverCostsDumpsAndNoStoreCells()
scanningHoverRevealsBlackFog()
cancelLastStalkerRefundsTheQueue()
stalkersLeaveByTheSiloDoor()
unitsLeaveByTheFactoryDoor()
storageStartsEmptyAndFillsWithCells()
bothModesUseTheirOwnMapSize()
aisAttackEachOther()
eliminatingASideRemovesIt()
groundUnitsNeverOverlapSolidGround()
diagonalMovesCannotSqueeze()
towerFitsInsideCastleSightAndShoots()
towerFiresOutToItsSight()
workersMineCastleMineralsThenTheNearestPatch()
captureHarvestAndPassages()
siloAiRaisesStorageAtRemoteDumps()
siloAiWidensNarrowPassages()
siloAiStoresAtNewDumpsWhileHomeRemains()
siloAiAimsGorillasAtBuildings()
humanPlacementIgnoresAiGap()
siloAiAttacksInWaves()
siloAiLeavesUnfinishedStorageExposed()
pillarCapturesAnUncoveredStalker()
siloAiPillarsWatchMinesAndAvoidEnemyPillars()
siloAiRefusesUnchartedGround()
ruinedSiloCanBeRepaired()
siloAiDefendsItsSilo()
siloAiKeepsStalkersWorking()
cellsDoNotCapTraining()
console.log('smoke ok')

function captureHarvestAndPassages(): void {
  assert(TREE_HP === 14 && ROCK_HP === 28, `tree life is ${TREE_HP}, rock life is ${ROCK_HP}`)
  for (let seed = 1; seed <= 8; seed++) {
    for (const mode of ['duel', 'ffa'] as const) {
      const field = createMatch(seed, mode)
      const gaps = narrowPassageCount(field.tiles, field.ore, field.mapW, field.mapH)
      assert(gaps === 0, `${mode} seed ${seed} left ${gaps} one-tile passages`)
    }
  }

  const open = createMatch(4)
  clearPad(open, 36, 20, 46, 32)
  rebuildBlocked(open)
  const stalker = makeUnit(open, 1, 'porter', 40.5 * TILE, 25.5 * TILE)
  const pike = makeUnit(open, 0, 'pike', stalker.x + 18, stalker.y)
  commandAttack(open, [pike.id], stalker.id, 'unit')
  for (let i = 0; i < 40; i++) step(open, 1 / 60)
  const taken = unitById(open, stalker.id)
  assert(taken?.owner === 0 && taken.hp === UNIT_STATS.porter.hp, `uncovered stalker was not captured (${taken?.owner}, ${taken?.hp})`)
  assert(open.toasts.some((toast) => toast.text === 'Stalker captured.'), 'no stalker capture toast')

  const home = createMatch(4)
  const enemyKeep = home.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(enemyKeep, 'missing the covered stalker silo')
  const homeCenter = buildingCenter(enemyKeep)
  const guarded = makeUnit(home, 1, 'porter', homeCenter.x, homeCenter.y + 70)
  const shooter = makeUnit(home, 0, 'pike', guarded.x + 16, guarded.y)
  commandAttack(home, [shooter.id], guarded.id, 'unit')
  for (let i = 0; i < 40; i++) step(home, 1 / 60)
  const still = unitById(home, guarded.id)
  assert(still?.owner === 1 && still.hp === UNIT_STATS.porter.hp, `a covered stalker changed (${still?.owner}, ${still?.hp})`)

  const far = createMatch(4)
  clearPad(far, 36, 20, 46, 32)
  rebuildBlocked(far)
  const lone = makeUnit(far, 1, 'porter', 40.5 * TILE, 24.5 * TILE)
  makeUnit(far, 1, 'pike', lone.x + 40, lone.y)
  const foe = makeUnit(far, 0, 'pike', lone.x - 18, lone.y)
  commandAttack(far, [foe.id], lone.id, 'unit')
  for (let i = 0; i < 40; i++) step(far, 1 / 60)
  const safe = unitById(far, lone.id)
  assert(safe?.owner === 1 && safe.hp === UNIT_STATS.porter.hp, 'a friendly flasher did not keep the stalker')

  assert(BUILDING_STATS.silo.sight === 150, `storage sight is ${BUILDING_STATS.silo.sight}`)
  assert(
    UNIT_STATS.porter.blurb.includes('Storage'),
    'the stalker tooltip no longer names Storage cover',
  )
  const sheltered = createMatch(4)
  clearPad(sheltered, 30, 16, 50, 34)
  const shelterBin = makeBuilding(sheltered, 1, 'silo', 38, 24, true)
  rebuildBlocked(sheltered)
  const binCenter = buildingCenter(shelterBin)
  const shelteredStalker = makeUnit(sheltered, 1, 'porter', 40.5 * TILE, 25.5 * TILE)
  assert(
    Math.hypot(shelteredStalker.x - binCenter.x, shelteredStalker.y - binCenter.y) <= BUILDING_STATS.silo.sight,
    'the sheltered stalker is outside storage sight',
  )
  for (const keep of sheltered.buildings) {
    if (keep.kind !== 'keep') continue
    const keepCenter = buildingCenter(keep)
    assert(
      Math.hypot(keepCenter.x - shelteredStalker.x, keepCenter.y - shelteredStalker.y) > BUILDING_STATS.keep.sight,
      'the storage-cover stalker is also inside a silo',
    )
  }
  const storageShooter = makeUnit(sheltered, 0, 'pike', shelteredStalker.x + 18, shelteredStalker.y)
  commandAttack(sheltered, [storageShooter.id], shelteredStalker.id, 'unit')
  for (let i = 0; i < 40; i++) step(sheltered, 1 / 60)
  const shelteredStill = unitById(sheltered, shelteredStalker.id)
  assert(
    shelteredStill?.owner === 1 && shelteredStill.hp === UNIT_STATS.porter.hp,
    `storage sight did not keep the stalker (${shelteredStill?.owner}, ${shelteredStill?.hp})`,
  )

  const rising = createMatch(4)
  clearPad(rising, 30, 16, 50, 34)
  const risingBin = makeBuilding(rising, 1, 'silo', 38, 24, false)
  rebuildBlocked(rising)
  assert(!risingBin.complete && risingBin.hp > 0, 'the unfinished storage was not standing')
  const risingCenter = buildingCenter(risingBin)
  const risingStalker = makeUnit(rising, 1, 'porter', 40.5 * TILE, 25.5 * TILE)
  assert(
    Math.hypot(risingStalker.x - risingCenter.x, risingStalker.y - risingCenter.y) <= BUILDING_STATS.silo.sight,
    'the builder is outside the unfinished storage sight',
  )
  for (const keep of rising.buildings) {
    if (keep.kind !== 'keep') continue
    const keepCenter = buildingCenter(keep)
    assert(
      Math.hypot(keepCenter.x - risingStalker.x, keepCenter.y - risingStalker.y) > BUILDING_STATS.keep.sight,
      'the unfinished-storage stalker is also inside a silo',
    )
  }
  const risingShooter = makeUnit(rising, 0, 'pike', risingStalker.x + 18, risingStalker.y)
  commandAttack(rising, [risingShooter.id], risingStalker.id, 'unit')
  for (let i = 0; i < 40; i++) step(rising, 1 / 60)
  const risingTaken = unitById(rising, risingStalker.id)
  assert(
    risingTaken?.owner === 0 && risingTaken.hp === UNIT_STATS.porter.hp,
    `an unfinished storage protected the stalker (${risingTaken?.owner}, ${risingTaken?.hp})`,
  )

  const beyond = createMatch(4)
  clearPad(beyond, 36, 20, 46, 32)
  const distantBin = makeBuilding(beyond, 1, 'silo', 8, 8, true)
  rebuildBlocked(beyond)
  const distantCenter = buildingCenter(distantBin)
  const exposedStalker = makeUnit(beyond, 1, 'porter', 40.5 * TILE, 25.5 * TILE)
  assert(
    Math.hypot(exposedStalker.x - distantCenter.x, exposedStalker.y - distantCenter.y) > BUILDING_STATS.silo.sight,
    'the exposed stalker is still inside storage sight',
  )
  const exposedShooter = makeUnit(beyond, 0, 'pike', exposedStalker.x + 18, exposedStalker.y)
  commandAttack(beyond, [exposedShooter.id], exposedStalker.id, 'unit')
  for (let i = 0; i < 40; i++) step(beyond, 1 / 60)
  const exposedTaken = unitById(beyond, exposedStalker.id)
  assert(exposedTaken?.owner === 0, `a stalker outside storage sight was not captured (${exposedTaken?.owner})`)

  const ai = createMatch(6)
  clearPad(ai, 30, 16, 50, 34)
  const aiBin = makeBuilding(ai, 0, 'silo', 38, 24, true)
  rebuildBlocked(ai)
  const aiCenter = buildingCenter(aiBin)
  const aiStalker = makeUnit(ai, 0, 'porter', aiCenter.x, aiCenter.y)
  const aiPike = makeUnit(ai, 1, 'pike', aiStalker.x + 30, aiStalker.y)
  ai.aiVisible[Math.floor(aiStalker.y / TILE) * ai.mapW + Math.floor(aiStalker.x / TILE)] = 1
  commandMove(ai, [aiPike.id], aiStalker.x, aiStalker.y, true)
  ai.aiAcc = 0
  updateSiloAi(ai, 0.5)
  ai.aiAcc = -10
  const aiOrder = unitById(ai, aiPike.id)?.order
  assert(
    !(aiOrder?.type === 'attack' && aiOrder.kind === 'unit' && aiOrder.targetId === aiStalker.id),
    'SiloAI ordered a capture on a Stalker covered by Storage',
  )
  for (let i = 0; i < 90; i++) step(ai, 1 / 60)
  const aiKept = unitById(ai, aiStalker.id)
  assert(
    aiKept?.owner === 0 && aiKept.hp === UNIT_STATS.porter.hp,
    `SiloAI captured a stalker beside Storage (${aiKept?.owner}, ${aiKept?.hp})`,
  )

  const dump = createMatch(2)
  const worker = dump.units.find((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  const playerKeep = dump.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(worker && playerKeep, 'missing a stalker to drop dumps')
  clearPad(dump, 16, 16, 28, 28)
  const bin = makeBuilding(dump, 0, 'silo', 20, 20, true)
  rebuildBlocked(dump)
  worker.x = (bin.tx + 1) * TILE
  worker.y = (bin.ty + 2) * TILE + 8
  worker.cargo = 8
  worker.order = { type: 'gather', nodeId: -1, phase: 'return' }
  const bank = dump.oreHeld[0]
  step(dump, 1 / 30)
  assert(bin.stock === 8, `storage did not take the load (${bin.stock})`)
  assert(dump.oreHeld[0] === bank + 8, `the bank did not take the load (${dump.oreHeld[0]})`)
  bin.stock = 30
  dump.oreHeld[0] = 100
  assert(tryTrain(dump, playerKeep.id, 'porter') === null, 'the silo rejected a stalker paid from storage')
  assert(bin.stock === 0, `spending left ${bin.stock} dumps in storage`)
  assert(dump.oreHeld[0] === 50, `spending left ${dump.oreHeld[0]} dumps in the bank`)

  const raid = createMatch(3)
  raid.aiAcc = -10
  clearPad(raid, 24, 16, 40, 32)
  const enemyBin = makeBuilding(raid, 1, 'silo', 30, 22, true)
  rebuildBlocked(raid)
  enemyBin.stock = 20
  raid.oreHeld[1] = 100
  const thief = raid.units.find((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  assert(thief, 'missing a thief')
  thief.x = (enemyBin.tx + 1) * TILE
  thief.y = (enemyBin.ty + 2) * TILE + 8
  thief.cargo = 0
  thief.order = null
  assert(commandHarvestOrAttack(raid, [thief.id], enemyBin.id), 'stalkers did not haul from the enemy storage')
  for (let i = 0; i < 80; i++) {
    step(raid, 1 / 30)
    if ((unitById(raid, thief.id)?.cargo ?? 0) > 0) break
  }
  const loaded = unitById(raid, thief.id)
  assert(loaded?.cargo === GATHER_AMOUNT, `stolen cargo was ${loaded?.cargo}`)
  assert(enemyBin.stock === 20 - GATHER_AMOUNT, `storage kept ${enemyBin.stock}`)
  assert(raid.oreHeld[1] === 100 - GATHER_AMOUNT, `the victim bank is ${raid.oreHeld[1]}`)

  const smash = createMatch(3)
  smash.aiAcc = -10
  const victimKeep = smash.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(victimKeep, 'missing a storage site')
  const vault = makeBuilding(smash, 1, 'silo', victimKeep.tx + 4, victimKeep.ty, true)
  vault.stock = 30
  vault.hp = 10
  smash.oreHeld[1] = 80
  const vaultCenter = buildingCenter(vault)
  const ape = makeUnit(smash, 0, 'howler', vaultCenter.x, vaultCenter.y + 60)
  commandAttack(smash, [ape.id], vault.id, 'building')
  for (let i = 0; i < 90; i++) {
    step(smash, 1 / 60)
    if (!smash.buildings.some((building) => building.id === vault.id)) break
  }
  assert(!smash.buildings.some((building) => building.id === vault.id), 'the gorilla left the storage standing')
  assert(smash.ore.some((node) => node.amount === 30), 'the gorilla left no dumps pile')
  assert(smash.oreHeld[1] === 50, `the pile did not leave the bank (${smash.oreHeld[1]})`)

  const zap = createMatch(3)
  zap.aiAcc = -10
  const homeKeep = zap.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(homeKeep, 'missing the pillar yard')
  const box = makeBuilding(zap, 1, 'silo', homeKeep.tx + 4, homeKeep.ty, true)
  box.stock = 15
  box.hp = 1
  zap.oreHeld[1] = 40
  makeBuilding(zap, 0, 'tower', homeKeep.tx + 6, homeKeep.ty, true)
  rebuildBlocked(zap)
  for (let i = 0; i < 180; i++) {
    step(zap, 1 / 60)
    if (!zap.buildings.some((building) => building.id === box.id)) break
  }
  assert(!zap.buildings.some((building) => building.id === box.id), 'the pillar left the storage standing')
  assert(!zap.ore.some((node) => node.amount === 15), 'a pillar left a dumps pile')
  assert(zap.oreHeld[1] === 40, `a pillar changed the bank to ${zap.oreHeld[1]}`)

  const ffa = createMatch(5, 'ffa')
  const fallen = ffa.buildings.find((building) => building.owner === 2 && building.kind === 'keep')
  const playerUnit = ffa.units.find((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  assert(fallen && playerUnit, 'missing a free-for-all silo to capture')
  const victimOre = ffa.oreHeld[2] ?? 0
  const captorOre = ffa.oreHeld[1] ?? 0
  const ids = ffa.units.filter((unit) => unit.owner === 2 && unit.hp > 0).map((unit) => unit.id)
  const extra = makeBuilding(ffa, 2, 'silo', fallen.tx + 4, fallen.ty, true)
  extra.stock = 11
  fallen.hp = 6
  const fallenCenter = buildingCenter(fallen)
  const killer = makeUnit(ffa, 1, 'pike', fallenCenter.x, fallenCenter.y + 70)
  const capturedId = ids[0]
  assert(capturedId != null, 'the victim had no units')
  ffa.selectedUnits = [playerUnit.id, capturedId]
  commandAttack(ffa, [killer.id], fallen.id, 'building')
  for (let i = 0; i < 90; i++) {
    step(ffa, 1 / 60)
    if (ffa.eliminated[2]) break
  }
  assert(ffa.eliminated[2], 'destroying the silo did not eliminate that side')
  assert(ffa.outcome == null, 'one capture ended the free-for-all')
  assert(!ffa.units.some((unit) => unit.owner === 2), 'captured units kept the loser')
  assert(!ffa.buildings.some((building) => building.owner === 2), 'captured buildings kept the loser')
  for (const id of ids) assert(unitById(ffa, id)?.owner === 1, 'a captured unit did not join the killer')
  const moved = ffa.buildings.find((building) => building.id === extra.id)
  assert(moved?.owner === 1 && moved.stock === 11, 'storage stock did not move with the building')
  assert(ffa.oreHeld[1] === captorOre + victimOre, `dumps moved to ${ffa.oreHeld[1]}, expected ${captorOre + victimOre}`)
  assert(ffa.oreHeld[2] === 0, 'the loser kept dumps')
  assert(ffa.selectedUnits.includes(playerUnit.id), 'the player lost their own selection')
  assert(!ffa.selectedUnits.includes(capturedId), 'a captured unit stayed in the player selection')
  const sample = unitById(ffa, capturedId)
  assert(sample, 'the captured unit disappeared')
  assert(
    sideTileVisible(ffa, 1, Math.floor(sample.x / TILE), Math.floor(sample.y / TILE)),
    'the captor cannot see a unit it just took',
  )
  updateSiloAi(ffa, 0.5)
  assert(ffa.eliminated[2] && unitById(ffa, capturedId)?.owner === 1, 'AI gave the captured side back')

  const duel = createMatch(2)
  const enemy = duel.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(enemy, 'missing the 1v1 silo')
  const enemyIds = duel.units.filter((unit) => unit.owner === 1 && unit.hp > 0).map((unit) => unit.id)
  enemy.hp = 6
  const enemyCenter = buildingCenter(enemy)
  const finisher = makeUnit(duel, 0, 'pike', enemyCenter.x, enemyCenter.y + 70)
  commandAttack(duel, [finisher.id], enemy.id, 'building')
  for (let i = 0; i < 90; i++) {
    step(duel, 1 / 60)
    if (duel.outcome) break
  }
  assert(duel.outcome === 'win', `capturing the enemy silo did not win (${duel.outcome})`)
  for (const id of enemyIds) assert(unitById(duel, id)?.owner === 0, '1v1 capture left units with the loser')
}

function bothModesUseTheirOwnMapSize(): void {
  const duel = createMatch(4)
  assert(duel.mode === 'duel' && duel.mapW === 80 && duel.mapH === 40, `1 vs 1 map is ${duel.mapW}×${duel.mapH}`)
  assert(duel.tiles.length === 80 * 40, '1 vs 1 did not fill 80×40 cells')
  assert(duel.playerCount === 2, '1 vs 1 seated extra sides')
  const duelKeeps = duel.buildings.filter((building) => building.kind === 'keep' && building.hp > 0)
  assert(duelKeeps.length === 2, '1 vs 1 is missing a Silo')
  const duelA = duelKeeps[0]
  const duelB = duelKeeps[1]
  assert(duelA && duelB, '1 vs 1 Silos did not both place')
  const duelDx = duelA.tx + 1.5 - (duelB.tx + 1.5)
  const duelDy = duelA.ty + 1.5 - (duelB.ty + 1.5)
  assert(Math.hypot(duelDx, duelDy) > 65, `1 vs 1 Silos are only ${Math.hypot(duelDx, duelDy).toFixed(1)} tiles apart`)
  const corners = new Map<number, Set<string>>()
  const sight = BUILDING_STATS.keep.sight
  const inner = sight - TILE
  for (let seed = 1; seed <= 12; seed++) {
    const state = createMatch(seed, 'ffa')
    assert(state.mapW === 80 && state.mapH === 70, `free for all map is ${state.mapW}×${state.mapH}`)
    assert(state.playerCount === 4 && state.mode === 'ffa', 'free for all did not seat four sides')
    assert(state.tiles.length === 80 * 70, 'the free-for-all map did not fill 80×70 cells')
    const keeps = state.buildings.filter((building) => building.kind === 'keep' && building.hp > 0)
    assert(keeps.length === 4, 'free for all is missing a Silo')
    const owners = new Set(keeps.map((keep) => keep.owner))
    assert(owners.size === 4, 'two Silos share a side')
    const midX = state.mapW / 2
    const midY = state.mapH / 2
    const quads = new Set(keeps.map((keep) => `${keep.tx < midX ? 'W' : 'E'}${keep.ty < midY ? 'N' : 'S'}`))
    assert(quads.size === 4, `Silos are not in four corners (${[...quads].join(', ')})`)
    const yards = keeps.map((keep) => ({
      x0: keep.tx - 9,
      y0: keep.ty - 9,
      x1: keep.tx + 2 + 9,
      y1: keep.ty + 2 + 9,
    }))
    for (let i = 0; i < yards.length; i++) {
      for (let j = i + 1; j < yards.length; j++) {
        const a = yards[i]
        const b = yards[j]
        if (!a || !b) continue
        const overlap = a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1
        assert(!overlap, `seed ${seed} Silo yards overlap`)
      }
    }
    for (const keep of keeps) {
      const quad = `${keep.tx < midX ? 'W' : 'E'}${keep.ty < midY ? 'N' : 'S'}`
      const seen = corners.get(keep.owner) ?? new Set<string>()
      seen.add(quad)
      corners.set(keep.owner, seen)
      const workers = state.units.filter((unit) => unit.owner === keep.owner && unit.kind === 'porter' && unit.hp > 0)
      assert(workers.length === 4, `side ${keep.owner} did not start with four stalkers`)
      assert(state.oreHeld[keep.owner] === STARTING_ORE, `side ${keep.owner} did not start with the usual dumps`)
      for (let ty = keep.ty - 9; ty <= keep.ty + 2 + 9; ty++) {
        for (let tx = keep.tx - 9; tx <= keep.tx + 2 + 9; tx++) {
          if (tx >= keep.tx && tx < keep.tx + 3 && ty >= keep.ty && ty < keep.ty + 3) continue
          if (tx < 0 || ty < 0 || tx >= state.mapW || ty >= state.mapH) continue
          const blocker = state.rocks.find((rock) => rock.tx === tx && rock.ty === ty && rock.hp > 0)
          assert(!blocker, `seed ${seed} side ${keep.owner} has a blocker in the Silo yard`)
        }
      }
      const cx = (keep.tx + 1.5) * TILE
      const cy = (keep.ty + 1.5) * TILE
      let nearest = Infinity
      let node: { tx: number; ty: number } | null = null
      for (const ore of state.ore) {
        const dist = Math.hypot((ore.tx + 0.5) * TILE - cx, (ore.ty + 0.5) * TILE - cy)
        if (dist < nearest) {
          nearest = dist
          node = ore
        }
      }
      assert(node, `seed ${seed} side ${keep.owner} has no dumps`)
      assert(
        nearest >= inner - 0.01 && nearest <= sight + 0.01,
        `seed ${seed} side ${keep.owner} nearest dumps are ${nearest.toFixed(1)}px from the Silo`,
      )
      assert(sideTileVisible(state, keep.owner, node.tx, node.ty), `seed ${seed} side ${keep.owner} cannot see its starting dumps`)
      if (keep.owner !== 0) {
        assert(!tileVisible(state, keep.tx + 1, keep.ty + 1), 'Silo 01 can see another Silo at the start')
      }
    }
    const tree = state.rocks.find((rock) => rock.kind === 'tree')
    const stone = state.rocks.find((rock) => rock.kind !== 'tree')
    assert(tree && tree.hp === TREE_HP, 'a free-for-all tree does not have half life')
    assert(stone && stone.hp === ROCK_HP, 'a free-for-all rock changed life')
  }
  for (const [owner, quads] of corners) {
    assert(quads.size > 1, `side ${owner} always starts in ${[...quads].join(', ')}`)
  }
}

function aisAttackEachOther(): void {
  const state = createMatch(3, 'ffa')
  const keep2 = state.buildings.find((building) => building.owner === 2 && building.kind === 'keep')
  const keep3 = state.buildings.find((building) => building.owner === 3 && building.kind === 'keep')
  assert(keep2 && keep3, 'missing two computer Silos')
  const home2 = buildingCenter(keep2)
  const home3 = buildingCenter(keep3)
  state.sideSpotted[2]?.push({ id: keep3.id, x: home3.x, y: home3.y })
  state.sideSpotted[3]?.push({ id: keep2.id, x: home2.x, y: home2.y })
  state.sideAttacking[2] = true
  state.sideAttacking[3] = true
  const rally2 = siloRallyPoint(state, 2)
  assert(rally2, 'missing the Silo 03 rally')
  const need = siloWaveNeed(state)
  for (let n = 0; n < need.gorillas; n++) makeUnit(state, 2, 'howler', rally2.x, rally2.y + n * 8)
  for (let n = 0; n < need.count - need.gorillas; n++) makeUnit(state, 2, 'pike', rally2.x + 12, rally2.y + n * 8)
  for (let n = 0; n < 3; n++) makeUnit(state, 3, 'pike', home3.x + 30 + n * 18, home3.y + 36)
  updateSiloAi(state, 0.5)
  const mover = state.units.find((unit) => {
    if (unit.owner !== 2 || unit.kind !== 'pike' || !unit.order) return false
    const order = unit.order
    if (order.type === 'attack') return order.kind === 'building' && order.targetId === keep3.id
    if (order.type === 'move' || order.type === 'attackMove') return Math.hypot(order.x - home3.x, order.y - home3.y) < 80
    return false
  })
  assert(mover, 'Silo 03 did not march on Silo 04')
  const tower = makeBuilding(state, 2, 'tower', keep2.tx + 4, keep2.ty, true)
  const foe = makeUnit(state, 3, 'pike', (tower.tx + 0.5) * TILE + 36, (tower.ty + 0.5) * TILE)
  foe.order = null
  state.aiAcc = -10
  state.playerAiAcc = -10
  for (let owner = 0; owner < state.playerCount; owner++) state.sideAcc[owner] = -10
  const before = foe.hp
  for (let i = 0; i < 120; i++) {
    step(state, 1 / 60)
    if (foe.hp < before) break
  }
  assert(foe.hp < before, 'a Pillar ignored an enemy from another computer side')
}

function eliminatingASideRemovesIt(): void {
  const state = createMatch(5, 'ffa')
  const victim = state.buildings.find((building) => building.owner === 2 && building.kind === 'keep')
  const other = state.buildings.find((building) => building.owner === 3 && building.kind === 'keep')
  const second = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(victim && other && second, 'missing Silos to eliminate')
  victim.hp = 0
  step(state, 1 / 60)
  assert(state.outcome == null, 'one fallen Silo ended the free-for-all')
  assert(state.eliminated[2], 'Silo 03 was not marked eliminated')
  assert(!state.units.some((unit) => unit.owner === 2), 'eliminated units remained')
  assert(!state.buildings.some((building) => building.owner === 2), 'eliminated buildings remained')
  assert(
    state.toasts.some((toast) => toast.text.includes(PLAYER_NAME[2] ?? '') && toast.text.includes('eliminated')),
    'no elimination toast',
  )
  assert(state.buildings.some((building) => building.id === other.id && building.hp > 0), 'another side was removed')
  other.hp = 0
  second.hp = 0
  step(state, 1 / 60)
  assert(state.outcome === 'win', `destroying every enemy Silo did not win (${state.outcome})`)

  const loss = createMatch(5, 'ffa')
  const home = loss.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(home, 'missing the player Silo')
  home.hp = 0
  step(loss, 1 / 60)
  assert(loss.outcome === 'lose', `a fallen player Silo did not lose (${loss.outcome})`)
}

function footprintGap(tx: number, ty: number, w: number, h: number, ox: number, oy: number): number {
  const dx = ox < tx ? tx - ox : ox > tx + w - 1 ? ox - (tx + w - 1) : 0
  const dy = oy < ty ? ty - oy : oy > ty + h - 1 ? oy - (ty + h - 1) : 0
  return Math.max(dx, dy)
}

function aiBuildingsLeaveAGapAndAvoidMinerals(): void {
  assert(AI_BUILD_GAP === 2, 'SiloAI no longer leaves two cells between buildings')
  for (const seed of [1, 2, 5, 8]) {
    const state = createMatch(seed)
    state.oreHeld[1] = 8000
    const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
    assert(keep, 'missing Dunmarch castle')
    chartBase(state, 1, keep.tx + 1, keep.ty + 1, 40)
    for (let n = 0; n < 4; n++) {
      const placed = aiPlaceNearKeep(state, n % 2 === 0 ? 'yard' : 'silo', 1)
      assert(placed, `seed ${seed} could not place AI building ${n}`)
      const building = state.buildings[state.buildings.length - 1]
      assert(building, 'placement did not add a building')
      building.complete = true
      building.progress = 1
      for (const unit of state.units) {
        if (unit.order?.type !== 'construct') continue
        unit.order = null
        unit.path = []
        unit.goalX = null
        unit.goalY = null
      }
      rebuildBlocked(state)
      updateVision(state)
    }
    const built = state.buildings.filter((building) => building.owner === 1 && building.kind !== 'keep')
    assert(built.length >= 4, `seed ${seed} placed ${built.length} AI buildings`)
    const lanes = mineralLaneTiles(state, keep.tx + 1, keep.ty + 1)
    for (const building of built) {
      const stats = BUILDING_STATS[building.kind]
      for (let y = building.ty - AI_BUILD_GAP; y <= building.ty + stats.h - 1 + AI_BUILD_GAP; y++) {
        for (let x = building.tx - AI_BUILD_GAP; x <= building.tx + stats.w - 1 + AI_BUILD_GAP; x++) {
          const inside = x >= building.tx && x < building.tx + stats.w && y >= building.ty && y < building.ty + stats.h
          if (inside) continue
          assert(x >= 0 && y >= 0 && x < MAP_W && y < MAP_H, `seed ${seed} building touches the map edge`)
          assert(isWalkable(state, x, y), `seed ${seed} ${building.kind} has no free cell at ${x},${y}`)
          assert(state.tiles[y * MAP_W + x] !== 1 && state.tiles[y * MAP_W + x] !== 3, 'a rock or tree touches an AI building')
        }
      }
      for (const node of state.ore) {
        if (node.amount <= 0) continue
        const gap = footprintGap(building.tx, building.ty, stats.w, stats.h, node.tx, node.ty)
        assert(gap >= AI_MINERAL_KEEP, `seed ${seed} ${building.kind} is ${gap} tiles from minerals`)
      }
      for (let y = 0; y < stats.h; y++) {
        for (let x = 0; x < stats.w; x++) {
          assert(
            !lanes.has((building.ty + y) * MAP_W + (building.tx + x)),
            `seed ${seed} ${building.kind} sits on the haul to minerals`,
          )
        }
      }
    }
  }
}

function aiDroneNeverIdles(): void {
  const state = createMatch(3)
  const enemy = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(enemy, 'missing Dunmarch castle')
  const drone = makeUnit(state, 1, 'drone', (enemy.tx + 1.5) * TILE, (enemy.ty + 1.5) * TILE)
  const startX = drone.x
  const startY = drone.y
  let idle = 0
  for (let i = 0; i < 40; i++) {
    step(state, 0.5)
    const now = unitById(state, drone.id)
    assert(now && now.hp > 0, 'the Drone died while scouting')
    if (!now.order) idle += 1
    else idle = 0
    assert(idle <= 1, 'the Drone stayed idle for more than a moment')
  }
  const flown = unitById(state, drone.id)
  assert(flown, 'missing the Drone')
  assert(Math.hypot(flown.x - startX, flown.y - startY) > 80, 'the Drone did not fly a scout route')
  if (flown.order?.type === 'move') {
    flown.x = flown.order.x
    flown.y = flown.order.y
  }
  flown.order = null
  flown.path = []
  flown.goalX = null
  flown.goalY = null
  step(state, 0.5)
  const resumed = unitById(state, drone.id)
  assert(resumed?.order?.type === 'move', 'the Drone stayed idle after arriving')

  const bike = makeUnit(state, 0, 'pike', resumed.x + 30, resumed.y)
  state.aiVisible[Math.floor(bike.y / TILE) * MAP_W + Math.floor(bike.x / TILE)] = 1
  step(state, 0.5)
  const avoiding = unitById(state, drone.id)
  assert(avoiding?.order?.type === 'move', 'the Drone had no flight away from the Bike')
  if (avoiding.order?.type === 'move') {
    const distance = Math.hypot(avoiding.order.x - bike.x, avoiding.order.y - bike.y)
    assert(distance >= DRONE_BIKE_AVOID, `the Drone flew toward a Bike (${distance.toFixed(0)})`)
  }

  const second = createMatch(6)
  const yard = makeBuilding(second, 1, 'yard', 60, 10, true)
  second.oreHeld[1] = 500
  const home = second.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(home, 'missing a castle for the second Drone')
  makeUnit(second, 1, 'drone', (home.tx + 1.5) * TILE, (home.ty + 1.5) * TILE)
  makeUnit(second, 1, 'pike', (home.tx + 4.5) * TILE, (home.ty + 1.5) * TILE)
  makeUnit(second, 1, 'pike', (home.tx + 5.5) * TILE, (home.ty + 1.5) * TILE)
  step(second, 0.5)
  assert(
    yard.queue.some((job) => job.kind === 'drone'),
    'Dunmarch did not train a second Drone',
  )

  const north = createMatch(4)
  north.aiControl = true
  const castle = north.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(castle, 'missing the Northmark castle')
  const playerDrone = makeUnit(north, 0, 'drone', (castle.tx + 1.5) * TILE, (castle.ty + 1.5) * TILE)
  step(north, 0.5)
  assert(unitById(north, playerDrone.id)?.order?.type === 'move', 'AI Control left the Northmark Drone idle')
}

function exploredTiles(state: MatchState): number {
  let count = 0
  for (let i = 0; i < state.explored.length; i++) count += state.explored[i] ?? 0
  return count
}

function cancelLastStalkerRefundsTheQueue(): void {
  const state = createMatch(41)
  const silo = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(silo, 'missing the Silo')
  const ore = state.oreHeld[0]
  const cells = state.supplyUsed[0]
  assert(tryTrain(state, silo.id, 'porter') === null, 'the Silo rejected a Stalker')
  const firstQueued = silo.queue.length
  assert(firstQueued === 1, 'the Stalker was not queued')
  assert(state.oreHeld[0] === ore - UNIT_STATS.porter.cost, 'the Stalker was not charged')
  assert(state.supplyUsed[0] === cells + UNIT_STATS.porter.supply, 'the Stalker did not reserve a cell')
  const current = silo.queue[0]
  assert(current, 'the queued Stalker is missing')
  current.remaining = 3
  assert(tryTrain(state, silo.id, 'porter') === null, 'the Silo rejected a second Stalker')
  const secondQueued = silo.queue.length
  assert(secondQueued === 2, 'the second Stalker was not queued')
  cancelTrain(state, silo.id)
  const afterCancel = silo.queue.length
  assert(afterCancel === 1, 'cancel did not drop the last Stalker')
  assert(silo.queue[0]?.remaining === 3, 'cancel reset the Stalker already in production')
  assert(state.oreHeld[0] === ore - UNIT_STATS.porter.cost, 'cancel did not refund the last Stalker')
  assert(state.supplyUsed[0] === cells + UNIT_STATS.porter.supply, 'cancel did not free the last Stalker cell')
  assert(
    state.toasts.some((toast) => toast.text === 'Cancelled Stalker.'),
    'cancel toast missing',
  )
  cancelTrain(state, silo.id)
  const emptied = silo.queue.length
  assert(emptied === 0, 'cancel left the Stalker in production')
  assert(state.oreHeld[0] === ore, 'cancel did not refund the Stalker in production')
  assert(state.supplyUsed[0] === cells, 'cancel did not free the cell for the Stalker in production')
  cancelTrain(state, silo.id)
  assert(state.oreHeld[0] === ore, 'an empty queue refunded dumps')
}

function stalkersLeaveByTheSiloDoor(): void {
  const state = createMatch(41)
  const silo = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(silo, 'missing the Silo')
  const mouth = keepEntrance(silo)
  assert(Math.hypot(silo.rallyX - mouth.x, silo.rallyY - mouth.y) < 1, 'the Silo rally is not at the entrance')
  const before = state.units.length
  assert(tryTrain(state, silo.id, 'porter') === null, 'the Silo rejected a Stalker')
  const job = silo.queue[0]
  assert(job, 'the Stalker was not queued')
  job.remaining = 0.02
  step(state, 0.05)
  assert(state.units.length === before + 1, 'the Stalker did not leave the Silo')
  const born = state.units[state.units.length - 1]
  assert(born && born.kind === 'porter' && born.owner === 0, 'the new unit is not a Stalker')
  assert(Math.hypot(born.x - mouth.x, born.y - mouth.y) < 28, 'the Stalker did not emerge at the entrance')
  assert(silo.hatch > 0, 'the Silo door did not open')
}

function unitsLeaveByTheFactoryDoor(): void {
  const state = createMatch(16)
  const yard = makeBuilding(state, 0, 'yard', 14, 30, true)
  const mouth = yardEntrance(yard)
  const mtx = Math.floor(mouth.x / TILE)
  const mty = Math.floor(mouth.y / TILE)
  state.rocks = state.rocks.filter((rock) => rock.tx !== mtx || rock.ty !== mty)
  state.tiles[mty * state.mapW + mtx] = 0
  rebuildBlocked(state)
  assert(Math.hypot(yard.rallyX - mouth.x, yard.rallyY - mouth.y) < 1, 'the Factory rally is not at the bay door')
  const before = state.units.length
  assert(tryTrain(state, yard.id, 'pike') === null, 'the Factory rejected a Flasher')
  const job = yard.queue[0]
  assert(job, 'the Flasher was not queued')
  job.remaining = 0.02
  step(state, 0.05)
  assert(state.units.length === before + 1, 'the Flasher did not leave the Factory')
  const born = state.units[state.units.length - 1]
  assert(born && born.kind === 'pike' && born.owner === 0, 'the new unit is not a Flasher')
  assert(Math.hypot(born.x - mouth.x, born.y - mouth.y) < 28, 'the Flasher did not emerge at the bay door')
  assert(yard.hatch > 0, 'the Factory door did not open')
}

function storageStartsEmptyAndFillsWithCells(): void {
  const first = BUILDING_STATS.keep.supply + BUILDING_STATS.silo.supply
  assert(storageFill(first) === 0, 'the first Storage is not empty')
  assert(storageFill(BUILDING_STATS.keep.supply) === 0, 'Silo Cells already fill a Storage')
  assert(STORAGE_FILL_REFERENCE === BUILDING_STATS.keep.supply + BUILDING_STATS.silo.supply * 4, 'Storage fill reference drifted')
  assert(storageFill(STORAGE_FILL_REFERENCE) === 1, 'a Silo plus four Storages does not fill Storage')
  assert(storageFill(STORAGE_FILL_REFERENCE + 40) === 1, 'Cells past the reference overflowed Storage art')
  const middle = storageFill((first + STORAGE_FILL_REFERENCE) / 2)
  assert(middle > 0.4 && middle < 0.6, `a middle Cells total filled Storage by ${middle}`)
}

function scanningHoverRevealsBlackFog(): void {
  const state = createMatch(31)
  const hover = makeUnit(state, 0, 'drone', 40 * TILE, 22 * TILE)
  updateVision(state)
  const before = exploredTiles(state)
  toggleScanner(state, [hover.id])
  assert(hover.scanning, 'scanner did not arm the hover')
  assert(hover.order?.type === 'move', 'scanner did not send the hover into the fog')
  const order = hover.order
  assert(order?.type === 'move', 'scanner order was lost')
  if (order?.type !== 'move') return
  assert(
    !tileExplored(state, Math.floor(order.x / TILE), Math.floor(order.y / TILE)),
    'scanner flew toward ground that was already explored',
  )
  for (let i = 0; i < 12 * 60; i++) step(state, 1 / 60)
  const flown = unitById(state, hover.id)
  assert(flown?.scanning, 'the hover left scanner mode on its own')
  assert(exploredTiles(state) > before, 'a scanning hover revealed no new tiles')
  assert(flown, 'the scanning hover is gone')

  const partner = makeUnit(state, 0, 'drone', flown.x + 20, flown.y)
  toggleScanner(state, [flown.id, partner.id])
  const first = flown.order
  const second = partner.order
  assert(first?.type === 'move' && second?.type === 'move', 'two hovers were not both sent scanning')
  if (first?.type !== 'move' || second?.type !== 'move') return
  assert(
    Math.hypot(first.x - second.x, first.y - second.y) >= 8 * TILE,
    'two scanning hovers took the same patch',
  )

  commandStop(state, [flown.id, partner.id])
  assert(!flown.scanning && !partner.scanning, 'stop left scanner mode on')
  toggleScanner(state, [partner.id])
  assert(partner.scanning, 'scanner did not turn back on')
  commandMove(state, [partner.id], partner.x + 400, partner.y, false)
  assert(!partner.scanning, 'a move order left scanner mode on')

  const sweep = createMatch(32)
  sweep.explored.fill(1)
  sweep.seenAt.fill(40)
  sweep.visible.fill(0)
  const oldTx = 4
  const oldTy = 4
  sweep.seenAt[oldTy * MAP_W + oldTx] = 1
  const scout = makeUnit(sweep, 0, 'drone', 60.5 * TILE, 30.5 * TILE)
  scout.scanning = true
  updateScanners(sweep)
  const memory = scout.order
  assert(memory?.type === 'move', 'a fully explored map gave the hover no flight')
  if (memory?.type !== 'move') return
  assert(
    Math.hypot(memory.x - (oldTx + 0.5) * TILE, memory.y - (oldTy + 0.5) * TILE) < TILE,
    'scanner did not fly to the tile seen longest ago',
  )
}

function hoverCostsDumpsAndNoStoreCells(): void {
  assert(UNIT_STATS.drone.cost === 75, `hover cost is ${UNIT_STATS.drone.cost}, not 75 dumps`)
  assert(UNIT_STATS.drone.supply === 0, 'hover still uses store cells')
  assert(
    UNIT_STATS.drone.blurb.includes('75 dumps') && UNIT_STATS.drone.blurb.includes('no cells'),
    'hover tooltip omits the cost',
  )

  const state = createMatch(21)
  const yard = makeBuilding(state, 0, 'yard', 14, 30, true)
  let guard = 0
  while (state.supplyUsed[0] < state.supplyCap[0] && guard++ < 40) {
    makeUnit(state, 0, 'pike', 80 + guard * 6, 80)
    recomputeSupply(state)
  }
  assert(state.supplyUsed[0] === state.supplyCap[0], 'store cells were not full')
  const used = state.supplyUsed[0]
  state.oreHeld[0] = 75
  assert(tryTrain(state, yard.id, 'drone') === null, 'a full store cells bar refused a hover')
  assert(state.oreHeld[0] === 0, 'hover was not charged 75 dumps')
  assert(state.supplyUsed[0] === used, 'queueing a hover raised store cells')
  const queued = yard.queue[0]
  assert(queued?.kind === 'drone', 'hover was not queued')
  if (!queued) return
  queued.remaining = 0.01
  step(state, 0.05)
  assert(
    state.units.some((unit) => unit.owner === 0 && unit.kind === 'drone' && unit.hp > 0),
    'hover did not finish training',
  )
  assert(state.supplyUsed[0] === used, 'a finished hover raised store cells')

  const foe = createMatch(22)
  guard = 0
  while (foe.supplyUsed[1] < foe.supplyCap[1] && guard++ < 40) {
    makeUnit(foe, 1, 'pike', 80 + guard * 6, 80)
    recomputeSupply(foe)
  }
  const foeUsed = foe.supplyUsed[1]
  const foeYard = makeBuilding(foe, 1, 'yard', 14, 8, true)
  foe.oreHeld[1] = UNIT_STATS.porter.cost + UNIT_STATS.drone.cost
  step(foe, 0.5)
  assert(
    foeYard.queue.some((job) => job.kind === 'drone'),
    'the AI skipped a Hover while Cells were already full',
  )
  const queuedCells = foe.buildings
    .filter((building) => building.owner === 1)
    .reduce((sum, building) => sum + building.queue.reduce((inner, job) => inner + UNIT_STATS[job.kind].supply, 0), 0)
  assert(foe.supplyUsed[1] === foeUsed + queuedCells, 'training changed Cells by something other than the queue')
  assert(UNIT_STATS.drone.supply === 0, 'the Hover queue would raise Cells')

  const capped = createMatch(23)
  const capYard = makeBuilding(capped, 1, 'yard', 14, 8, true)
  makeUnit(capped, 1, 'drone', 200, 200)
  makeUnit(capped, 1, 'drone', 240, 200)
  recomputeSupply(capped)
  capped.oreHeld[1] = 500
  step(capped, 0.5)
  const hoverJobs = capYard.queue.filter((job) => job.kind === 'drone').length
  const hoverUnits = capped.units.filter((unit) => unit.owner === 1 && unit.kind === 'drone' && unit.hp > 0).length
  assert(hoverUnits + hoverJobs === 2, `AI trained past 2 hovers (${hoverUnits} living, ${hoverJobs} queued)`)
}

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
  drone.path = []
  drone.goalX = null
  drone.goalY = null
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

function terrainOverlap(state: MatchState, x: number, y: number, radius: number): string | null {
  const minTx = Math.floor((x - radius) / TILE)
  const maxTx = Math.floor((x + radius) / TILE)
  const minTy = Math.floor((y - radius) / TILE)
  const maxTy = Math.floor((y + radius) / TILE)
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue
      const tile = state.tiles[ty * MAP_W + tx] ?? 0
      const mineral = state.ore.some((node) => node.amount > 0 && node.tx === tx && node.ty === ty)
      if (tile !== 1 && tile !== 3 && !mineral) continue
      const left = tx * TILE
      const top = ty * TILE
      const nearestX = Math.max(left, Math.min(x, left + TILE))
      const nearestY = Math.max(top, Math.min(y, top + TILE))
      if ((x - nearestX) ** 2 + (y - nearestY) ** 2 >= radius * radius) continue
      if (mineral) return `minerals at ${tx},${ty}`
      return tile === 3 ? `tree at ${tx},${ty}` : `rock at ${tx},${ty}`
    }
  }
  return null
}

function groundUnitsNeverOverlapSolidGround(): void {
  const state = createMatch(11)
  state.aiControl = true
  const hits: string[] = []
  for (let i = 0; i < 240; i++) {
    step(state, 0.25)
    for (const unit of state.units) {
      if (unit.hp <= 0 || unit.kind === 'drone') continue
      const hit = terrainOverlap(state, unit.x, unit.y, UNIT_STATS[unit.kind].radius)
      if (!hit) continue
      hits.push(`${unit.kind} overlapped ${hit} at t=${state.time.toFixed(1)}`)
      if (hits.length >= 4) break
    }
    if (hits.length >= 4 || state.outcome) break
  }
  assert(hits.length === 0, hits.join('; '))

  const chore = createMatch(13)
  const worker = chore.units.find((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  const rock = chore.rocks.find((entry) => entry.hp > 0 && isWalkable(chore, entry.tx + 1, entry.ty))
  assert(worker && rock, 'missing a worker or a rock with an open side')
  for (const unit of chore.units) {
    if (unit.id !== worker.id) unit.hp = 0
  }
  worker.x = (rock.tx + 1.5) * TILE
  worker.y = (rock.ty + 0.5) * TILE
  commandAttack(chore, [worker.id], rock.id, 'rock')
  for (let i = 0; i < 10 * 60 && rock.hp > 0; i++) {
    step(chore, 1 / 60)
    const now = unitById(chore, worker.id)
    assert(now, 'the worker disappeared while breaking rock')
    const hit = terrainOverlap(chore, now.x, now.y, UNIT_STATS.porter.radius)
    assert(hit == null, `worker stepped onto ${hit} before the rock fell`)
  }
}

function diagonalMovesCannotSqueeze(): void {
  const state = createMatch(12)
  for (const unit of state.units) unit.hp = 0
  for (const node of state.ore) node.amount = 0
  const open: Array<[number, number]> = []
  for (let x = 36; x <= 42; x++) open.push([x, 20])
  open.push([36, 21], [42, 21], [42, 22], [41, 22], [40, 22], [39, 22], [38, 22], [37, 22])
  carveGround(state, open)
  rebuildBlocked(state)
  const around = findPath(state.blocked, MAP_W, MAP_H, 36, 21, 37, 22)
  assert(around, 'the long way around the corner disappeared')
  assert(!(around.length === 1 && around[0]?.tx === 37 && around[0]?.ty === 22), 'the path stepped diagonally through the rocks')
  let prev = { tx: 36, ty: 21 }
  for (const stepTile of around) {
    if (stepTile.tx !== prev.tx && stepTile.ty !== prev.ty) {
      const sideA = state.blocked[prev.ty * MAP_W + stepTile.tx]
      const sideB = state.blocked[stepTile.ty * MAP_W + prev.tx]
      assert(!sideA && !sideB, 'a diagonal path step squeezed a blocked corner')
    }
    prev = stepTile
  }
  const direct = findPath(state.blocked, MAP_W, MAP_H, 36, 21, 37, 22)
  assert(direct && direct.length > 1, 'findPath offered the blocked diagonal')

  const bike = makeUnit(state, 0, 'pike', 36.5 * TILE, 21.5 * TILE)
  commandMove(state, [bike.id], 37.5 * TILE, 22.5 * TILE, false)
  for (let i = 0; i < 14 * 60; i++) {
    step(state, 1 / 60)
    const now = unitById(state, bike.id)
    assert(now, 'the bike disappeared on the corner')
    const hit = terrainOverlap(state, now.x, now.y, UNIT_STATS.pike.radius)
    assert(hit == null, `bike overlapped ${hit} while going around the corner`)
  }
  const arrived = unitById(state, bike.id)
  assert(arrived, 'missing the bike')
  assert(
    Math.hypot(arrived.x - 37.5 * TILE, arrived.y - 22.5 * TILE) < 24,
    'the bike did not walk around the blocked corner',
  )

  const drone = makeUnit(state, 0, 'drone', 36.5 * TILE, 21.5 * TILE)
  commandMove(state, [drone.id], 37.5 * TILE, 22.5 * TILE, false)
  let flew = false
  for (let i = 0; i < 6 * 60; i++) {
    step(state, 1 / 60)
    const now = unitById(state, drone.id)
    if (now && Math.hypot(now.x - 37.5 * TILE, now.y - 22.5 * TILE) < 8) {
      flew = true
      break
    }
  }
  assert(flew, 'the drone could not fly over the blocked corner')
}

function towerFitsInsideCastleSightAndShoots(): void {
  const state = createMatch(5)
  state.oreHeld[0] = 800
  const keep = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep' && building.hp > 0)
  assert(keep, 'missing the Northmark castle')
  const center = buildingCenter(keep)
  const sight = BUILDING_STATS.keep.sight
  let inside: { tx: number; ty: number } | null = null
  let outside: { tx: number; ty: number } | null = null
  for (let ty = 1; ty < MAP_H - 1; ty++) {
    for (let tx = 1; tx < MAP_W - 1; tx++) {
      if (!canPlace(state, 'tower', tx, ty)) continue
      const distance = Math.hypot((tx + 0.5) * TILE - center.x, (ty + 0.5) * TILE - center.y)
      if (!inside && distance <= sight) inside = { tx, ty }
      if (!outside && distance > sight + TILE) outside = { tx, ty }
    }
  }
  assert(inside, 'no open cell inside Castle sight')
  assert(outside, 'no open cell outside Castle sight')
  assert(placementAllowed(state, 0, 'tower', inside.tx, inside.ty), 'a cell inside Castle sight rejected the Tower')
  assert(!placementAllowed(state, 0, 'tower', outside.tx, outside.ty), 'a cell outside Castle sight accepted the Tower')
  const refused = tryPlace(state, 0, 'tower', outside.tx, outside.ty, [])
  assert(refused === 'Pillars must stand inside Silo sight', refused ?? 'the outside Tower was built')
  assert(BUILDING_STATS.tower.w === 1 && BUILDING_STATS.tower.h === 1, 'the Tower is not one cell')
  assert(BUILDING_STATS.tower.sight === UNIT_STATS.drone.sight, 'Tower sight does not match the Drone')
  assert(BUILDING_STATS.tower.damage === 8 / 3, 'Tower damage is not one third of 8')
  assert(UNIT_STATS.pike.damage === 8, 'Bike damage changed with the Tower')
  const built = tryPlace(state, 0, 'tower', inside.tx, inside.ty, [])
  assert(built === null, built ?? 'the Tower inside Castle sight was refused')
  const placed = state.buildings.find((building) => building.kind === 'tower')
  assert(placed, 'the Tower was not added')

  const fight = createMatch(7)
  const home = fight.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(home, 'missing a castle for the firing Tower')
  const homeCenter = buildingCenter(home)
  let spot: { tx: number; ty: number } | null = null
  let towardCenter = Infinity
  const midX = (MAP_W / 2) * TILE
  const midY = (MAP_H / 2) * TILE
  for (let ty = home.ty - 8; ty <= home.ty + 10; ty++) {
    for (let tx = home.tx - 8; tx <= home.tx + 10; tx++) {
      if (!canPlace(fight, 'tower', tx, ty)) continue
      const x = (tx + 0.5) * TILE
      const y = (ty + 0.5) * TILE
      const distance = Math.hypot(x - homeCenter.x, y - homeCenter.y)
      if (distance > BUILDING_STATS.keep.sight - TILE) continue
      const inward = Math.hypot(x - midX, y - midY)
      if (inward < towardCenter) {
        towardCenter = inward
        spot = { tx, ty }
      }
    }
  }
  assert(spot, 'no tile for a firing Tower')
  const tower = makeBuilding(fight, 0, 'tower', spot.tx, spot.ty, true)
  rebuildBlocked(fight)
  const origin = buildingCenter(tower)
  const foe = makeUnit(fight, 1, 'pike', origin.x + 36, origin.y)
  let drop = 0
  for (let i = 0; i < 120; i++) {
    const before = foe.hp
    step(fight, 1 / 60)
    if (foe.hp < before) {
      drop = before - foe.hp
      break
    }
  }
  assert(sameDamage(drop, BUILDING_STATS.tower.damage ?? 0), `the Tower dealt ${drop}, not ${BUILDING_STATS.tower.damage}`)
  foe.hp = 0
  const drone = makeUnit(fight, 1, 'drone', origin.x + 28, origin.y + 6)
  let droneDrop = 0
  for (let i = 0; i < 120; i++) {
    const before = drone.hp
    step(fight, 1 / 60)
    if (drone.hp < before) {
      droneDrop = before - drone.hp
      break
    }
  }
  assert(sameDamage(droneDrop, (BUILDING_STATS.tower.damage ?? 0) / 2), `the Tower dealt ${droneDrop} to a Drone`)
  drone.hp = 0
  const rockTx = spot.tx + 1 < MAP_W ? spot.tx + 1 : spot.tx - 1
  fight.tiles[spot.ty * MAP_W + rockTx] = 1
  const rock = { id: fight.nextId++, tx: rockTx, ty: spot.ty, hp: ROCK_HP, hitFlash: 0, kind: 'rock' as const }
  fight.rocks.push(rock)
  rebuildBlocked(fight)
  for (let i = 0; i < 90; i++) step(fight, 1 / 60)
  assert(rock.hp === ROCK_HP, 'the Tower shot a rock')
  updateVision(fight)
  let revealed = false
  for (let ty = 0; ty < MAP_H && !revealed; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const x = (tx + 0.5) * TILE
      const y = (ty + 0.5) * TILE
      if (Math.hypot(x - homeCenter.x, y - homeCenter.y) <= BUILDING_STATS.keep.sight) continue
      if (Math.hypot(x - origin.x, y - origin.y) > UNIT_STATS.drone.sight) continue
      if (tileVisible(fight, tx, ty)) {
        revealed = true
        break
      }
    }
  }
  assert(revealed, 'the Tower did not reveal ground past the Castle')
}

function pin(unit: Unit): void {
  unit.order = { type: 'move', x: unit.x, y: unit.y }
  unit.path = []
  unit.goalX = unit.x
  unit.goalY = unit.y
  unit.nodeMemory = -1
}

function clearPad(state: MatchState, tx0: number, ty0: number, tx1: number, ty1: number): void {
  const x0 = Math.max(0, Math.min(tx0, tx1))
  const x1 = Math.min(MAP_W - 1, Math.max(tx0, tx1))
  const y0 = Math.max(0, Math.min(ty0, ty1))
  const y1 = Math.min(MAP_H - 1, Math.max(ty0, ty1))
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) state.tiles[ty * MAP_W + tx] = 0
  }
  for (const node of state.ore) {
    if (node.tx >= x0 && node.tx <= x1 && node.ty >= y0 && node.ty <= y1) node.amount = 0
  }
  state.rocks = state.rocks.filter((rock) => rock.tx < x0 || rock.tx > x1 || rock.ty < y0 || rock.ty > y1)
}

/** Tower range is its own sight, shared by both sides. It holds one target and will not fire through rock, trees, or fog. */
function towerFiresOutToItsSight(): void {
  const state = createMatch(8)
  const home = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(home, 'missing a castle for the long Tower shot')
  const homeCenter = buildingCenter(home)
  const midX = (MAP_W / 2) * TILE
  const midY = (MAP_H / 2) * TILE
  let spot: { tx: number; ty: number } | null = null
  let towardCenter = Infinity
  for (let ty = home.ty - 8; ty <= home.ty + 10; ty++) {
    for (let tx = home.tx - 8; tx <= home.tx + 10; tx++) {
      if (!canPlace(state, 'tower', tx, ty)) continue
      const x = (tx + 0.5) * TILE
      const y = (ty + 0.5) * TILE
      if (Math.hypot(x - homeCenter.x, y - homeCenter.y) > BUILDING_STATS.keep.sight - TILE) continue
      const inward = Math.hypot(x - midX, y - midY)
      if (inward < towardCenter) {
        towardCenter = inward
        spot = { tx, ty }
      }
    }
  }
  assert(spot, 'no tile for a long-range Tower')
  const tower = makeBuilding(state, 0, 'tower', spot.tx, spot.ty, true)
  const origin = buildingCenter(tower)
  const towardX = midX - origin.x
  const towardY = midY - origin.y
  const stepX = Math.abs(towardX) >= Math.abs(towardY) ? (towardX >= 0 ? 1 : -1) : 0
  const stepY = stepX === 0 ? (towardY >= 0 ? 1 : -1) : 0
  const tileAlong = (tilesAway: number) => ({ tx: spot.tx + stepX * tilesAway, ty: spot.ty + stepY * tilesAway })
  const edge = tileAlong(7)
  const beyond = tileAlong(11)
  const onMap = (tx: number, ty: number) => tx >= 1 && ty >= 1 && tx < MAP_W - 1 && ty < MAP_H - 1
  let flankX = stepY
  let flankY = stepX
  if (!onMap(spot.tx + flankX * 6, spot.ty + flankY * 6)) {
    flankX = -flankX
    flankY = -flankY
  }
  const sideTile = { tx: spot.tx + flankX * 3, ty: spot.ty + flankY * 3 }
  const otherSide = { tx: spot.tx + flankX * 6, ty: spot.ty + flankY * 6 }
  const pads = [edge, beyond, sideTile, otherSide, { tx: spot.tx, ty: spot.ty }]
  let minX = spot.tx
  let maxX = spot.tx
  let minY = spot.ty
  let maxY = spot.ty
  for (const pad of pads) {
    minX = Math.min(minX, pad.tx)
    maxX = Math.max(maxX, pad.tx)
    minY = Math.min(minY, pad.ty)
    maxY = Math.max(maxY, pad.ty)
  }
  clearPad(state, minX - 1, minY - 1, maxX + 1, maxY + 1)
  const rockTx = spot.tx + flankX
  const rockTy = spot.ty + flankY
  state.tiles[rockTy * MAP_W + rockTx] = 1
  const rock = { id: state.nextId++, tx: rockTx, ty: rockTy, hp: ROCK_HP, hitFlash: 0, kind: 'rock' as const }
  state.rocks.push(rock)
  const treeTx = spot.tx + flankX * 4
  const treeTy = spot.ty + flankY * 4
  state.tiles[treeTy * MAP_W + treeTx] = 3
  const tree = { id: state.nextId++, tx: treeTx, ty: treeTy, hp: ROCK_HP, hitFlash: 0, kind: 'tree' as const }
  state.rocks.push(tree)
  rebuildBlocked(state)
  const edgeDist = Math.hypot((edge.tx + 0.5) * TILE - origin.x, (edge.ty + 0.5) * TILE - origin.y)
  const beyondDist = Math.hypot((beyond.tx + 0.5) * TILE - origin.x, (beyond.ty + 0.5) * TILE - origin.y)
  assert(edgeDist > UNIT_STATS.pike.range + 30, `edge target is only ${edgeDist.toFixed(0)}px away`)
  assert(edgeDist <= BUILDING_STATS.tower.sight, `edge target is outside sight at ${edgeDist.toFixed(0)}px`)
  assert(beyondDist > BUILDING_STATS.tower.sight, `fog target is inside sight at ${beyondDist.toFixed(0)}px`)
  assert(
    !rockShotClear(state.tiles, MAP_W, MAP_H, { tx: spot.tx, ty: spot.ty }, sideTile),
    'the rock does not block the side shot',
  )
  assert(
    !rockShotClear(state.tiles, MAP_W, MAP_H, { tx: spot.tx, ty: spot.ty }, otherSide),
    'the tree does not block the other shot',
  )
  assert(
    rockShotClear(state.tiles, MAP_W, MAP_H, { tx: spot.tx, ty: spot.ty }, edge),
    'rock or a tree blocks the sight-edge shot',
  )
  const far = makeUnit(state, 1, 'pike', (edge.tx + 0.5) * TILE, (edge.ty + 0.5) * TILE)
  const hidden = makeUnit(state, 1, 'porter', (beyond.tx + 0.5) * TILE, (beyond.ty + 0.5) * TILE)
  const behindRock = makeUnit(state, 1, 'porter', (sideTile.tx + 0.5) * TILE, (sideTile.ty + 0.5) * TILE)
  const behindTree = makeUnit(state, 1, 'porter', (otherSide.tx + 0.5) * TILE, (otherSide.ty + 0.5) * TILE)
  let shotSeen = false
  let drop = 0
  for (let i = 0; i < 180; i++) {
    pin(far)
    pin(hidden)
    pin(behindRock)
    pin(behindTree)
    const before = far.hp
    step(state, 1 / 60)
    const shot = state.projectiles.find((entry) => entry.sourceId === tower.id)
    if (
      shot &&
      shot.damage === BUILDING_STATS.tower.damage &&
      shot.speed === UNIT_STATS.pike.projectileSpeed &&
      shot.radius === UNIT_STATS.pike.projectileRadius
    ) {
      shotSeen = true
    }
    if (far.hp < before) {
      drop = before - far.hp
      break
    }
  }
  assert(shotSeen, 'the Tower shot was not a Bike projectile')
  assert(sameDamage(drop, BUILDING_STATS.tower.damage ?? 0), `the Tower dealt ${drop} at the edge of its sight`)
  assert(behindRock.hp === UNIT_STATS.porter.hp, 'the Tower shot through a rock')
  assert(behindTree.hp === UNIT_STATS.porter.hp, 'the Tower shot through a tree')
  assert(hidden.hp === UNIT_STATS.porter.hp, 'the Tower shot an enemy outside its sight')
  assert(rock.hp === ROCK_HP && tree.hp === ROCK_HP, 'the Tower shot a rock or a tree')
  const near = tileAlong(2)
  const closer = makeUnit(state, 1, 'pike', (near.tx + 0.5) * TILE, (near.ty + 0.5) * TILE)
  const closerHp = closer.hp
  const farHp = far.hp
  for (let i = 0; i < 90; i++) {
    pin(far)
    pin(hidden)
    pin(behindRock)
    pin(behindTree)
    pin(closer)
    step(state, 1 / 60)
  }
  assert(closer.hp === closerHp, 'the Tower left its target for a closer enemy')
  assert(far.hp < farHp, 'the Tower stopped firing on the enemy still in sight')
  far.hp = 0
  let closerDrop = 0
  for (let i = 0; i < 180; i++) {
    pin(hidden)
    pin(behindRock)
    pin(behindTree)
    pin(closer)
    const before = closer.hp
    step(state, 1 / 60)
    if (closer.hp < before) {
      closerDrop = before - closer.hp
      break
    }
  }
  assert(sameDamage(closerDrop, BUILDING_STATS.tower.damage ?? 0), `the Tower did not retarget after the kill (${closerDrop})`)
  assert(hidden.hp === UNIT_STATS.porter.hp, 'the Tower fired into the fog after retargeting')

  const foeHome = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(foeHome, 'missing the Dunmarch castle')
  const foeCenter = buildingCenter(foeHome)
  let foeSpot: { tx: number; ty: number } | null = null
  let foeInward = Infinity
  for (let ty = foeHome.ty - 8; ty <= foeHome.ty + 10; ty++) {
    for (let tx = foeHome.tx - 8; tx <= foeHome.tx + 10; tx++) {
      if (tx < 1 || ty < 1 || tx >= MAP_W - 1 || ty >= MAP_H - 1) continue
      if (!canPlace(state, 'tower', tx, ty)) continue
      const x = (tx + 0.5) * TILE
      const y = (ty + 0.5) * TILE
      if (Math.hypot(x - foeCenter.x, y - foeCenter.y) > BUILDING_STATS.keep.sight - TILE) continue
      const inward = Math.hypot(x - midX, y - midY)
      if (inward < foeInward) {
        foeInward = inward
        foeSpot = { tx, ty }
      }
    }
  }
  assert(foeSpot, 'no tile for a Dunmarch Tower')
  const foeTower = makeBuilding(state, 1, 'tower', foeSpot.tx, foeSpot.ty, true)
  const foeOrigin = buildingCenter(foeTower)
  const foeTowardX = midX - foeOrigin.x
  const foeTowardY = midY - foeOrigin.y
  const foeStepX = Math.abs(foeTowardX) >= Math.abs(foeTowardY) ? (foeTowardX >= 0 ? 1 : -1) : 0
  const foeStepY = foeStepX === 0 ? (foeTowardY >= 0 ? 1 : -1) : 0
  const foeEdge = { tx: foeSpot.tx + foeStepX * 7, ty: foeSpot.ty + foeStepY * 7 }
  clearPad(state, foeSpot.tx - 1, foeSpot.ty - 1, foeEdge.tx, foeEdge.ty)
  clearPad(state, foeEdge.tx - 1, foeEdge.ty - 1, foeSpot.tx, foeSpot.ty)
  rebuildBlocked(state)
  const victim = makeUnit(state, 0, 'pike', (foeEdge.tx + 0.5) * TILE, (foeEdge.ty + 0.5) * TILE)
  const victimDist = Math.hypot(victim.x - foeOrigin.x, victim.y - foeOrigin.y)
  assert(victimDist > UNIT_STATS.pike.range && victimDist <= BUILDING_STATS.tower.sight, 'Dunmarch target is not at the sight edge')
  let foeDrop = 0
  for (let i = 0; i < 180; i++) {
    pin(victim)
    const before = victim.hp
    step(state, 1 / 60)
    if (victim.hp < before) {
      foeDrop = before - victim.hp
      break
    }
  }
  assert(sameDamage(foeDrop, BUILDING_STATS.tower.damage ?? 0), `the Dunmarch Tower dealt ${foeDrop} at the edge of its sight`)

  victim.hp = 0
  const drone = makeUnit(state, 0, 'drone', victim.x, victim.y)
  let droneDrop = 0
  for (let i = 0; i < 180; i++) {
    pin(drone)
    const before = drone.hp
    step(state, 1 / 60)
    if (drone.hp < before) {
      droneDrop = before - drone.hp
      break
    }
  }
  assert(sameDamage(droneDrop, (BUILDING_STATS.tower.damage ?? 0) / 2), `the Tower dealt ${droneDrop} to a Drone at the edge of its sight`)
}

function workersMineCastleMineralsThenTheNearestPatch(): void {
  const state = createMatch(4)
  const base = state.ore.filter((node) => node.base === 0 && node.amount > 0)
  const expansion = state.ore.find((node) => node.base == null && node.amount > 0)
  assert(base.length >= 2, 'the castle area has no minerals')
  assert(expansion, 'the map has no expansion minerals')
  state.explored[expansion.ty * MAP_W + expansion.tx] = 1
  const workers = state.units.filter((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  for (const worker of workers) {
    worker.order = null
    worker.cargo = 0
    worker.nodeMemory = 0
  }
  assignMiners(state, workers, null)
  assert(
    workers.some((worker) => assignedDeposit(worker) != null),
    'no worker took a castle mineral',
  )
  for (const worker of workers) {
    const id = assignedDeposit(worker)
    if (id == null) continue
    const node = state.ore.find((entry) => entry.id === id)
    assert(node?.base === 0, 'a worker left castle minerals for a revealed expansion')
  }

  const field = createMatch(9)
  for (const unit of field.units) unit.hp = 0
  for (const node of field.ore) node.amount = 0
  const open: Array<[number, number]> = []
  for (let x = 10; x <= 18; x++) open.push([x, 10])
  for (let y = 10; y <= 16; y++) open.push([18, y])
  carveGround(field, open)
  const sealed = { id: field.nextId++, tx: 10, ty: 12, amount: 420 }
  const openPatch = { id: field.nextId++, tx: 18, ty: 16, amount: 420 }
  const hidden = { id: field.nextId++, tx: 14, ty: 12, amount: 420 }
  field.ore.push(sealed, openPatch, hidden)
  field.explored[sealed.ty * MAP_W + sealed.tx] = 1
  field.explored[openPatch.ty * MAP_W + openPatch.tx] = 1
  field.aiExplored[sealed.ty * MAP_W + sealed.tx] = 1
  field.aiExplored[openPatch.ty * MAP_W + openPatch.tx] = 1
  rebuildBlocked(field)
  const worker = makeUnit(field, 0, 'porter', 10.5 * TILE, 10.5 * TILE)
  assignMiners(field, [worker], null)
  assert(assignedDeposit(worker) === openPatch.id, 'Northmark skipped the nearest revealed patch')
  const foe = makeUnit(field, 1, 'porter', 10.5 * TILE, 10.5 * TILE)
  assignMiners(field, [foe], null)
  assert(assignedDeposit(foe) === openPatch.id, 'Dunmarch skipped the nearest revealed patch')
}

function siloAiRaisesStorageAtRemoteDumps(): void {
  const state = createMatch(7)
  state.aiControl = true
  const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  const player = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep' && building.hp > 0)
  assert(keep && player, 'missing a Silo for SiloAI')
  const cx = 40
  const cy = 24
  const radius = 12
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) continue
      state.tiles[y * state.mapW + x] = 0
    }
  }
  state.rocks = state.rocks.filter((rock) => Math.max(Math.abs(rock.tx - cx), Math.abs(rock.ty - cy)) > radius)
  for (const node of state.ore) {
    if (node.base === 1) node.amount = 0
    else if (Math.max(Math.abs(node.tx - cx), Math.abs(node.ty - cy)) <= radius + 4) node.amount = 0
  }
  const remote = { id: state.nextId++, tx: cx, ty: cy, amount: 420, base: null }
  state.ore.push(remote)
  chartDisk(state, 1, cx, cy, radius)
  rebuildBlocked(state)
  state.oreHeld[1] = 500
  const before = new Set(state.buildings.map((building) => building.id))
  updateSiloAi(state, 0.5)

  const built = state.buildings.find(
    (building) => building.owner === 1 && building.kind === 'silo' && !before.has(building.id),
  )
  assert(built, 'SiloAI did not raise a Storage at the remote Dumps heap')
  const stats = BUILDING_STATS.silo
  const gap = footprintGap(built.tx, built.ty, stats.w, stats.h, remote.tx, remote.ty)
  assert(
    gap >= AI_MINERAL_KEEP && gap <= SILO_AI_EXPANSION_REACH,
    `remote Storage is ${gap} tiles from the Dumps heap`,
  )
  const home = buildingCenter(keep)
  const dumpX = (remote.tx + 0.5) * TILE
  const dumpY = (remote.ty + 0.5) * TILE
  const store = buildingCenter(built)
  assert(
    Math.hypot(store.x - dumpX, store.y - dumpY) < Math.hypot(home.x - dumpX, home.y - dumpY),
    'the remote Storage is farther from the heap than the Silo',
  )
  for (let y = built.ty - AI_BUILD_GAP; y <= built.ty + stats.h - 1 + AI_BUILD_GAP; y++) {
    for (let x = built.tx - AI_BUILD_GAP; x <= built.tx + stats.w - 1 + AI_BUILD_GAP; x++) {
      const inside = x >= built.tx && x < built.tx + stats.w && y >= built.ty && y < built.ty + stats.h
      if (inside) continue
      assert(isWalkable(state, x, y), `remote Storage has no free cell at ${x},${y}`)
    }
  }
  for (const node of state.ore) {
    if (node.amount <= 0) continue
    const nodeGap = footprintGap(built.tx, built.ty, stats.w, stats.h, node.tx, node.ty)
    assert(nodeGap >= AI_MINERAL_KEEP, `remote Storage is ${nodeGap} tiles from Dumps`)
  }
  const hauling = state.units.some((unit) => {
    if (unit.owner !== 1 || unit.kind !== 'porter' || unit.hp <= 0) return false
    return unit.order?.type === 'gather' && unit.order.nodeId === remote.id
  })
  assert(hauling, 'SiloAI did not send a Stalker to the remote Dumps heap')
  const playerMining = state.units.some((unit) => {
    if (unit.owner !== 0 || unit.kind !== 'porter' || unit.hp <= 0) return false
    const order = unit.order
    return order?.type === 'gather' || (order?.type === 'attack' && order.resumeNode != null)
  })
  assert(playerMining, 'SiloAI did not gather for the player side')

  const raid = createMatch(11)
  const foeKeep = raid.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  const aiKeep = raid.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(foeKeep && aiKeep, 'missing Silos for the raid')
  for (const node of raid.ore) node.amount = 0
  raid.oreHeld[1] = 0
  const binTx = Math.min(Math.max(4, foeKeep.tx - 6), raid.mapW - BUILDING_STATS.silo.w - 1)
  const binTy = Math.min(Math.max(4, foeKeep.ty), raid.mapH - BUILDING_STATS.silo.h - 1)
  const bin = makeBuilding(raid, 0, 'silo', binTx, binTy, true)
  bin.stock = 40
  for (let y = 0; y < BUILDING_STATS.silo.h; y++) {
    for (let x = 0; x < BUILDING_STATS.silo.w; x++) {
      raid.aiVisible[(bin.ty + y) * raid.mapW + (bin.tx + x)] = 1
    }
  }
  makeUnit(raid, 1, 'drone', (aiKeep.tx + 1.5) * TILE, (aiKeep.ty + 1.5) * TILE)
  updateSiloAi(raid, 0.5)
  const raider = raid.units.find(
    (unit) => unit.owner === 1 && unit.kind === 'porter' && unit.order?.type === 'gather' && unit.order.binId === bin.id,
  )
  assert(raider, 'SiloAI did not send a Stalker to raid the enemy Storage')
}

function siloAiWidensNarrowPassages(): void {
  const state = createMatch(8)
  const open: Array<[number, number]> = []
  for (let x = 8; x <= 28; x++) open.push([x, 20])
  carveGround(state, open)
  for (const node of state.ore) node.amount = 0
  rebuildBlocked(state)
  const porter = state.units.find((unit) => unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0)
  assert(porter, 'missing a SiloAI Stalker')
  parkOtherWorkers(state, porter.id)
  porter.x = 8.5 * TILE
  porter.y = 20.5 * TILE
  commandMove(state, [porter.id], 28.5 * TILE, 20.5 * TILE, false)
  assert((unitById(state, porter.id)?.path.length ?? 0) > 0, 'the Stalker has no path through the corridor')
  state.oreHeld[1] = 0
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  const order = unitById(state, porter.id)?.order
  assert(
    order?.type === 'attack' && order.kind === 'rock' && order.resume?.type === 'move',
    'SiloAI Stalker did not stop to widen the one-cell corridor',
  )
  const wall = state.rocks.find((rock) => rock.id === order.targetId)
  assert(wall && (wall.ty === 19 || wall.ty === 21), 'the Stalker swung at something other than the corridor wall')
  wall.hp = 0
  step(state, 1 / 60)
  const resumed = unitById(state, porter.id)?.order
  assert(resumed?.type === 'move', 'the Stalker did not resume the move after the passage opened')
  assert(isWalkable(state, wall.tx, wall.ty), 'clearing the wall left the cell blocked')

  const hands = createMatch(8)
  const handsOpen: Array<[number, number]> = []
  for (let x = 8; x <= 28; x++) handsOpen.push([x, 20])
  carveGround(hands, handsOpen)
  for (const node of hands.ore) node.amount = 0
  rebuildBlocked(hands)
  const human = hands.units.find((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  assert(human, 'missing a player Stalker')
  human.x = 8.5 * TILE
  human.y = 20.5 * TILE
  commandMove(hands, [human.id], 28.5 * TILE, 20.5 * TILE, false)
  hands.aiControl = false
  updateSiloAi(hands, 0.5)
  assert(unitById(hands, human.id)?.order?.type === 'move', 'a player Stalker widened a passage on its own')

  hands.aiControl = true
  hands.playerAiAcc = 0
  updateSiloAi(hands, 0.5)
  const assisted = unitById(hands, human.id)?.order
  assert(
    assisted?.type === 'attack' && assisted.kind === 'rock' && assisted.resume?.type === 'move',
    'ai control did not widen the passage for the player Stalker',
  )

  const pinched = createMatch(9)
  const lane: Array<[number, number]> = []
  for (let x = 8; x <= 24; x++) lane.push([x, 24])
  carveGround(pinched, lane)
  for (const node of pinched.ore) node.amount = 0
  for (let x = 8; x <= 24; x++) {
    pinched.tiles[23 * MAP_W + x] = 0
    pinched.rocks = pinched.rocks.filter((rock) => rock.tx !== x || rock.ty !== 23)
    pinched.ore.push({ id: pinched.nextId++, tx: x, ty: 23, amount: 420 })
    const south = pinched.rocks.find((rock) => rock.tx === x && rock.ty === 25 && rock.hp > 0)
    if (south) south.kind = 'tree'
  }
  rebuildBlocked(pinched)
  const hauler = pinched.units.find((unit) => unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0)
  assert(hauler, 'missing a Stalker for the dumps pinch')
  parkOtherWorkers(pinched, hauler.id)
  hauler.x = 8.5 * TILE
  hauler.y = 24.5 * TILE
  commandMove(pinched, [hauler.id], 24.5 * TILE, 24.5 * TILE, false)
  pinched.oreHeld[1] = 0
  pinched.aiAcc = 0
  updateSiloAi(pinched, 0.5)
  const treeOrder = unitById(pinched, hauler.id)?.order
  assert(treeOrder?.type === 'attack' && treeOrder.kind === 'rock', 'SiloAI ignored a corridor closed by dumps and trees')
  const tree = pinched.rocks.find((rock) => rock.id === treeOrder.targetId)
  assert(tree?.kind === 'tree' && tree.ty === 25, 'the Stalker did not clear the tree wall beside the dumps')

  const slowed = createMatch(10)
  const wide: Array<[number, number]> = []
  for (let x = 8; x <= 24; x++) {
    wide.push([x, 30], [x, 31])
  }
  carveGround(slowed, wide)
  for (const node of slowed.ore) node.amount = 0
  slowed.tiles[30 * MAP_W + 16] = 1
  slowed.rocks.push({ id: slowed.nextId++, tx: 16, ty: 30, hp: ROCK_HP, hitFlash: 0, kind: 'rock' })
  rebuildBlocked(slowed)
  const stuck = slowed.units.find((unit) => unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0)
  assert(stuck, 'missing a Stalker for the slowed step')
  parkOtherWorkers(slowed, stuck.id)
  stuck.x = 15.5 * TILE
  stuck.y = 30.5 * TILE
  commandMove(slowed, [stuck.id], 22.5 * TILE, 30.5 * TILE, false)
  stuck.stuckT = 0.6
  slowed.oreHeld[1] = 0
  slowed.aiAcc = 0
  updateSiloAi(slowed, 0.5)
  const stuckOrder = unitById(slowed, stuck.id)?.order
  assert(
    stuckOrder?.type === 'attack' && stuckOrder.kind === 'rock' && stuckOrder.resume?.type === 'move',
    'a slowed SiloAI Stalker did not clear the rock in front of it',
  )
  const jammed = slowed.rocks.find((rock) => rock.id === stuckOrder.targetId)
  assert(jammed?.tx === 16 && jammed.ty === 30, 'the slowed Stalker cleared the wrong cell')
}

function siloAiStoresAtNewDumpsWhileHomeRemains(): void {
  const state = createMatch(7)
  const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  assert(keep, 'missing the Silo')
  assert(
    state.ore.some((node) => node.base === 1 && node.amount > 0),
    'the near-Silo Dumps were already gone',
  )
  const cx = 40
  const cy = 24
  const homeGap = footprintGap(keep.tx, keep.ty, BUILDING_STATS.keep.w, BUILDING_STATS.keep.h, cx, cy)
  assert(homeGap > SILO_AI_EXPANSION_REACH, `the new heap is only ${homeGap} tiles from the Silo`)
  const radius = 12
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) continue
      state.tiles[y * state.mapW + x] = 0
    }
  }
  state.rocks = state.rocks.filter((rock) => Math.max(Math.abs(rock.tx - cx), Math.abs(rock.ty - cy)) > radius)
  for (const node of state.ore) {
    if (node.base === 1) continue
    if (Math.max(Math.abs(node.tx - cx), Math.abs(node.ty - cy)) <= radius + 2) node.amount = 0
  }
  const remote = { id: state.nextId++, tx: cx, ty: cy, amount: 420, base: null }
  state.ore.push(remote)
  chartDisk(state, 1, cx, cy, radius)
  rebuildBlocked(state)
  state.oreHeld[1] = 800
  state.aiAcc = 0
  const before = new Set(state.buildings.map((building) => building.id))
  updateSiloAi(state, 0.5)
  const built = state.buildings.find(
    (building) => building.owner === 1 && building.kind === 'silo' && !before.has(building.id),
  )
  assert(built, 'SiloAI did not raise a Storage at a newly found far Dumps heap')
  const stats = BUILDING_STATS.silo
  const gap = footprintGap(built.tx, built.ty, stats.w, stats.h, remote.tx, remote.ty)
  assert(
    gap >= AI_MINERAL_KEEP && gap <= SILO_AI_EXPANSION_REACH,
    `the new Storage is ${gap} tiles from the Dumps heap`,
  )
  for (let y = built.ty - AI_BUILD_GAP; y <= built.ty + stats.h - 1 + AI_BUILD_GAP; y++) {
    for (let x = built.tx - AI_BUILD_GAP; x <= built.tx + stats.w - 1 + AI_BUILD_GAP; x++) {
      const inside = x >= built.tx && x < built.tx + stats.w && y >= built.ty && y < built.ty + stats.h
      if (inside) continue
      assert(isWalkable(state, x, y), `new Storage is missing the two-cell gap at ${x},${y}`)
    }
  }
  assert(
    state.ore.some((node) => node.base === 1 && node.amount > 0),
    'SiloAI waited until the near-Silo Dumps were gone',
  )
  const hauling = state.units.some(
    (unit) => unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0 && unit.order?.type === 'gather' && unit.order.nodeId === remote.id,
  )
  assert(hauling, 'no Stalker went to mine the new Dumps heap')

  built.complete = true
  built.progress = 1
  const miner = state.units.find(
    (unit) => unit.owner === 1 && unit.kind === 'porter' && unit.order?.type === 'gather' && unit.order.nodeId === remote.id,
  )
  assert(miner, 'the miner disappeared')
  miner.x = (remote.tx + 2.5) * TILE
  miner.y = (remote.ty + 0.5) * TILE
  miner.cargo = 8
  miner.order = { type: 'gather', nodeId: remote.id, phase: 'return' }
  miner.path = []
  miner.goalX = null
  miner.goalY = null
  state.aiAcc = -10
  step(state, 1 / 60)
  const goalX = miner.goalX
  const goalY = miner.goalY
  assert(goalX != null && goalY != null, 'the loaded Stalker did not head for a drop-off')
  const store = buildingCenter(built)
  const home = buildingCenter(keep)
  assert(
    Math.hypot(goalX - store.x, goalY - store.y) < Math.hypot(goalX - home.x, goalY - home.y),
    'the Stalker carried the new Dumps back to the Silo instead of the Storage',
  )
}

function siloAiAimsGorillasAtBuildings(): void {
  const state = createMatch(15)
  const foe = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep' && building.hp > 0)
  assert(foe, 'missing the enemy Silo')
  const center = buildingCenter(foe)
  const gorilla = makeUnit(state, 1, 'howler', center.x + 110, center.y)
  const flasher = makeUnit(state, 1, 'pike', center.x + 110, center.y + 20)
  makeUnit(state, 0, 'pike', center.x + 70, center.y)
  gorilla.order = { type: 'attackMove', x: center.x, y: center.y, focusId: null, focusKind: null }
  flasher.order = { type: 'attackMove', x: center.x, y: center.y, focusId: null, focusKind: null }
  step(state, 1 / 60)
  const ape = unitById(state, gorilla.id)?.order
  const bike = unitById(state, flasher.id)?.order
  assert(ape?.type === 'attackMove' && ape.focusKind === 'building', 'the Gorilla did not aim at the enemy building')
  assert(ape.focusId === foe.id, 'the Gorilla ignored the Silo for something else')
  assert(bike?.type === 'attackMove' && bike.focusKind === 'unit', 'the Flasher aimed at a building while a unit was in reach')

  const yard = makeBuilding(state, 0, 'yard', foe.tx + 6, foe.ty, true)
  const alone = makeUnit(state, 1, 'howler', (yard.tx + 1.5) * TILE + 80, (yard.ty + 1) * TILE)
  alone.order = { type: 'attackMove', x: (yard.tx + 1.5) * TILE, y: (yard.ty + 1) * TILE, focusId: null, focusKind: null }
  step(state, 1 / 60)
  const siege = unitById(state, alone.id)?.order
  assert(
    siege?.type === 'attackMove' && siege.focusKind === 'building' && siege.focusId === yard.id,
    'the Gorilla did not aim at the Factory',
  )

  const train = createMatch(6)
  for (const building of train.buildings) {
    if (building.owner === 1 && building.kind === 'yard') building.complete = false
  }
  const home = train.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(home, 'missing a Silo for the Factory')
  const factory = makeBuilding(train, 1, 'yard', home.tx + 6, home.ty - 6, true)
  makeBuilding(train, 1, 'yard', home.tx + 6, home.ty + 6, false)
  makeUnit(train, 1, 'drone', (home.tx + 1.5) * TILE, (home.ty + 1.5) * TILE)
  makeUnit(train, 1, 'drone', (home.tx + 2.5) * TILE, (home.ty + 1.5) * TILE)
  makeBuilding(train, 1, 'silo', 20, 20, true)
  makeBuilding(train, 1, 'silo', 24, 20, true)
  train.oreHeld[1] = 4000
  recomputeSupply(train)
  let howlers = 0
  let pikes = 0
  for (let n = 0; n < 6; n++) {
    train.aiAcc = 0
    updateSiloAi(train, 0.5)
    const job = factory.queue.find((entry) => entry.kind === 'howler' || entry.kind === 'pike')
    assert(job, `Factory train ${n + 1} was not a Gorilla or Flasher`)
    if (job.kind === 'howler') howlers += 1
    else pikes += 1
    makeUnit(train, 1, job.kind, 90 + n * 12, 90)
    factory.queue = factory.queue.filter((entry) => entry !== job)
    train.oreHeld[1] = 4000
    recomputeSupply(train)
  }
  assert(howlers === 4 && pikes === 2, `siege mix was ${howlers} Gorillas and ${pikes} Flashers`)
}

function humanPlacementIgnoresAiGap(): void {
  const state = createMatch(2)
  state.oreHeld[0] = 500
  const stats = BUILDING_STATS.yard
  let placed = false
  for (let ty = 1; ty < MAP_H - stats.h - 1 && !placed; ty++) {
    for (let tx = 1; tx < MAP_W - stats.w - 1 && !placed; tx++) {
      if (!canPlace(state, 'yard', tx, ty)) continue
      let tight = false
      for (let y = ty - 1; y <= ty + stats.h; y++) {
        for (let x = tx - 1; x <= tx + stats.w; x++) {
          const inside = x >= tx && x < tx + stats.w && y >= ty && y < ty + stats.h
          if (!inside && !isWalkable(state, x, y)) tight = true
        }
      }
      if (!tight) continue
      const error = tryPlace(state, 0, 'yard', tx, ty, [])
      assert(error == null, `human placement refused a legal footprint (${error})`)
      placed = true
    }
  }
  assert(placed, 'no human footprint sat against rock, so the gap check could not run')
}

function aimsAt(unit: Unit | undefined, point: { x: number; y: number }, reach: number): boolean {
  const order = unit?.order
  if (order?.type !== 'attackMove' && order?.type !== 'move') return false
  return Math.hypot(order.x - point.x, order.y - point.y) <= reach
}

function siloAiAttacksInWaves(): void {
  const early = createMatch(4)
  early.time = 20
  const late = createMatch(4)
  late.time = 300
  const ffa = createMatch(4, 'ffa')
  ffa.time = 20
  const ffaLate = createMatch(4, 'ffa')
  ffaLate.time = 300
  const earlyNeed = siloWaveNeed(early)
  const lateNeed = siloWaveNeed(late)
  const ffaNeed = siloWaveNeed(ffa)
  const ffaLateNeed = siloWaveNeed(ffaLate)
  assert(earlyNeed.gorillas >= 2 && earlyNeed.count >= 6, 'an early wave has no Gorilla share')
  assert(lateNeed.count > earlyNeed.count, 'the wave does not grow as the match goes on')
  assert(ffaNeed.count > earlyNeed.count && ffaNeed.gorillas > earlyNeed.gorillas, 'free-for-all does not ask for a larger wave')
  assert(ffaLateNeed.count > ffaNeed.count, 'a late free-for-all wave did not grow')

  const state = createMatch(5)
  state.time = 20
  const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  const foe = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep' && building.hp > 0)
  assert(keep && foe, 'missing a Silo for the wave')
  const foePoint = buildingCenter(foe)
  state.aiSpotted.push({ id: foe.id, x: foePoint.x, y: foePoint.y })
  const rally = siloRallyPoint(state, 1)
  assert(rally, 'SiloAI has no rally point')
  assert(Math.hypot(rally.x - buildingCenter(keep).x, rally.y - buildingCenter(keep).y) > 3 * TILE, 'the rally sits on the Silo')
  const need = siloWaveNeed(state)
  const short: Unit[] = []
  short.push(makeUnit(state, 1, 'howler', rally.x, rally.y))
  short.push(makeUnit(state, 1, 'pike', rally.x + 10, rally.y))
  short.push(makeUnit(state, 1, 'pike', rally.x - 10, rally.y))
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  assert(!state.aiAttacking, 'SiloAI marched before the wave was full')
  for (const unit of short) {
    const now = unitById(state, unit.id)
    assert(!aimsAt(now, foePoint, 120), 'a short group was sent at the enemy Silo')
    assert(aimsAt(now, rally, 100), 'a short group did not stay at the rally')
  }

  const wave: Unit[] = [...short]
  while (wave.filter((unit) => unit.kind === 'howler').length < need.gorillas) {
    wave.push(makeUnit(state, 1, 'howler', rally.x, rally.y + 8))
  }
  while (wave.length < need.count) {
    wave.push(makeUnit(state, 1, 'pike', rally.x, rally.y - 8))
  }
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  assert(state.aiAttacking, 'a full wave did not leave the rally')
  for (const unit of wave) {
    assert(aimsAt(unitById(state, unit.id), foePoint, 120), 'the wave did not attack together')
  }

  const home = buildingCenter(keep)
  const newbie = makeUnit(state, 1, 'pike', home.x + 140, home.y)
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  const held = unitById(state, newbie.id)
  assert(!aimsAt(held, foePoint, 120), 'a new Flasher joined the wave alone')
  assert(aimsAt(held, rally, 100), 'a new Flasher did not gather for the next wave')
  for (const unit of wave) {
    assert(aimsAt(unitById(state, unit.id), foePoint, 120), 'the first wave turned back before it was wiped out')
  }

  for (const unit of wave.slice(1)) unit.hp = 0
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  const survivor = unitById(state, wave[0]?.id ?? -1)
  assert(survivor && survivor.hp > 0, 'the last fighter was removed')
  assert(!aimsAt(survivor, foePoint, 120), 'a wiped wave kept marching')
  assert(aimsAt(survivor, rally, 100) || aimsAt(survivor, home, 120), 'the survivor did not regroup')
}

function headingHome(unit: Unit | undefined, home: { x: number; y: number }, site: { x: number; y: number }): boolean {
  const order = unit?.order
  const move = order?.type === 'move' ? order : order?.type === 'attack' && order.resume?.type === 'move' ? order.resume : null
  if (!move) return false
  return Math.hypot(move.x - home.x, move.y - home.y) < Math.hypot(move.x - site.x, site.y - move.y)
}

/** Open ground and a known Dumps heap far from Silo 01, matching the remote-storage setup. */
function carveRemoteDump(state: MatchState, owner: PlayerId): { tx: number; ty: number; id: number } {
  const cx = 40
  const cy = 24
  const radius = 12
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) continue
      state.tiles[y * state.mapW + x] = 0
    }
  }
  state.rocks = state.rocks.filter((rock) => Math.max(Math.abs(rock.tx - cx), Math.abs(rock.ty - cy)) > radius)
  for (const node of state.ore) {
    if (node.base === owner) node.amount = 0
    else if (Math.max(Math.abs(node.tx - cx), Math.abs(node.ty - cy)) <= radius + 4) node.amount = 0
  }
  const remote = { id: state.nextId++, tx: cx, ty: cy, amount: 420, base: null }
  state.ore.push(remote)
  chartDisk(state, owner, cx, cy, radius)
  rebuildBlocked(state)
  return remote
}

/** Mark a chebyshev disk explored for one side. Shroud (not currently visible) stays as it is. */
function chartDisk(state: MatchState, owner: PlayerId, cx: number, cy: number, radius: number): void {
  const grid = owner === 0 ? state.explored : owner === 1 ? state.aiExplored : state.sideExplored[owner]
  if (!grid) return
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) continue
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) > radius) continue
      grid[y * state.mapW + x] = 1
    }
  }
}

/** Chart ground around a Silo without revealing Dumps tiles, so a far heap stays unknown. */
function chartBase(state: MatchState, owner: PlayerId, cx: number, cy: number, radius: number): void {
  const grid = owner === 0 ? state.explored : owner === 1 ? state.aiExplored : state.sideExplored[owner]
  if (!grid) return
  const ore = new Set<number>()
  for (const node of state.ore) {
    if (node.amount <= 0) continue
    ore.add(node.ty * state.mapW + node.tx)
  }
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) continue
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) > radius) continue
      const index = y * state.mapW + x
      if (ore.has(index)) continue
      grid[index] = 1
    }
  }
}

function siloAiLeavesUnfinishedStorageExposed(): void {
  const threatened = createMatch(7)
  const remote = carveRemoteDump(threatened, 1)
  threatened.oreHeld[1] = 500
  const foe = makeUnit(threatened, 0, 'pike', (remote.tx + 0.5) * TILE, (remote.ty + 0.5) * TILE)
  threatened.aiVisible[remote.ty * threatened.mapW + remote.tx] = 1
  const before = new Set(threatened.buildings.map((building) => building.id))
  updateSiloAi(threatened, 0.5)
  assert(
    !threatened.buildings.some((building) => building.owner === 1 && building.kind === 'silo' && !before.has(building.id)),
    'SiloAI raised a Storage beside a known enemy',
  )
  assert(unitById(threatened, foe.id)?.owner === 0, 'the watching flasher was removed')

  const quiet = createMatch(7)
  const heap = carveRemoteDump(quiet, 1)
  quiet.oreHeld[1] = 500
  const keep = quiet.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(keep, 'missing a Silo for the escort')
  const rally = siloRallyPoint(quiet, 1)
  assert(rally, 'missing the escort rally')
  const escort = makeUnit(quiet, 1, 'pike', rally.x, rally.y)
  updateSiloAi(quiet, 0.5)
  assert(
    !quiet.buildings.some((building) => building.owner === 1 && building.kind === 'silo'),
    'SiloAI sent a builder before the escort reached the site',
  )
  const escortOrder = unitById(quiet, escort.id)?.order
  const dumpX = (heap.tx + 0.5) * TILE
  const dumpY = (heap.ty + 0.5) * TILE
  const home = buildingCenter(keep)
  assert(
    escortOrder?.type === 'attackMove' &&
      Math.hypot(escortOrder.x - dumpX, escortOrder.y - dumpY) < Math.hypot(escortOrder.x - home.x, escortOrder.y - home.y),
    'the spare Flasher was not sent to the remote site first',
  )
  escort.x = escortOrder.x
  escort.y = escortOrder.y
  quiet.aiAcc = 0
  updateSiloAi(quiet, 0.5)
  const raised = quiet.buildings.find((building) => building.owner === 1 && building.kind === 'silo' && !building.complete)
  assert(raised, 'SiloAI did not raise the Storage once a Flasher covered the site')
  assert(
    quiet.units.some((unit) => unit.owner === 1 && unit.kind === 'porter' && unit.order?.type === 'construct' && unit.order.buildingId === raised.id),
    'no Stalker stayed to build the covered Storage',
  )

  const hot = createMatch(4)
  const hotKeep = hot.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(hotKeep, 'missing a Silo for the retreat')
  const hotHome = buildingCenter(hotKeep)
  const site = makeBuilding(hot, 1, 'silo', 38, 24, false)
  const sitePoint = buildingCenter(site)
  assert(
    Math.hypot(sitePoint.x - hotHome.x, sitePoint.y - hotHome.y) > BUILDING_STATS.keep.sight,
    'the construction site is inside Silo sight',
  )
  const node = { id: hot.nextId++, tx: 41, ty: 25, amount: 200, base: null }
  hot.ore.push(node)
  const builder = makeUnit(hot, 1, 'porter', sitePoint.x, sitePoint.y + 40)
  builder.order = { type: 'construct', buildingId: site.id }
  const extra = makeUnit(hot, 1, 'porter', sitePoint.x + 36, sitePoint.y + 36)
  extra.order = { type: 'gather', nodeId: node.id, phase: 'approach' }
  const raider = makeUnit(hot, 0, 'pike', sitePoint.x + 48, sitePoint.y)
  hot.aiVisible[Math.floor(raider.y / TILE) * hot.mapW + Math.floor(raider.x / TILE)] = 1
  hot.oreHeld[1] = 0
  updateSiloAi(hot, 0.5)
  assert(!hot.buildings.some((building) => building.id === site.id), 'SiloAI left the unfinished Storage up beside an enemy')
  assert(headingHome(unitById(hot, builder.id), hotHome, sitePoint), 'the builder was not pulled off the open site')
  assert(headingHome(unitById(hot, extra.id), hotHome, sitePoint), 'a second Stalker was fed into the open site')
  assert(
    unitById(hot, extra.id)?.order?.type !== 'gather',
    'the extra Stalker kept mining beside the unfinished Storage',
  )

  const lost = createMatch(4)
  const lostKeep = lost.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(lostKeep, 'missing a Silo after a capture')
  const lostHome = buildingCenter(lostKeep)
  const shell = makeBuilding(lost, 1, 'silo', 38, 24, false)
  const shellPoint = buildingCenter(shell)
  const captured = makeUnit(lost, 0, 'porter', shellPoint.x, shellPoint.y + 30)
  const hauler = makeUnit(lost, 1, 'porter', shellPoint.x + 28, shellPoint.y + 28)
  const lostNode = { id: lost.nextId++, tx: 41, ty: 25, amount: 200, base: null }
  lost.ore.push(lostNode)
  hauler.order = { type: 'gather', nodeId: lostNode.id, phase: 'approach' }
  lost.oreHeld[1] = 0
  updateSiloAi(lost, 0.5)
  assert(!lost.buildings.some((building) => building.id === shell.id), 'SiloAI kept building after the builder was captured')
  assert(headingHome(unitById(lost, hauler.id), lostHome, shellPoint), 'SiloAI left another Stalker at the captured build')
  assert(unitById(lost, captured.id)?.owner === 0, 'the captured builder was handed back')
}

function pillarCapturesAnUncoveredStalker(): void {
  assert(UNIT_STATS.porter.blurb.includes('Pillar'), 'the Stalker tooltip does not name a Pillar')
  assert(BUILDING_STATS.tower.blurb.toLowerCase().includes('captured'), 'the Pillar tooltip does not say it captures')

  const open = createMatch(4)
  open.aiAcc = -10
  const stalker = makeUnit(open, 1, 'porter', 40.5 * TILE, 25.5 * TILE)
  clearPad(open, 36, 22, 44, 30)
  rebuildBlocked(open)
  const tower = makeBuilding(open, 0, 'tower', 41, 26, true)
  const origin = buildingCenter(tower)
  assert(Math.hypot(stalker.x - origin.x, stalker.y - origin.y) <= BUILDING_STATS.tower.sight, 'the uncovered stalker is outside Pillar sight')
  for (const keep of open.buildings) {
    if (keep.kind !== 'keep') continue
    const center = buildingCenter(keep)
    assert(Math.hypot(center.x - stalker.x, center.y - stalker.y) > BUILDING_STATS.keep.sight, 'the uncovered stalker is inside a Silo')
  }
  for (let i = 0; i < 180; i++) {
    pin(stalker)
    step(open, 1 / 60)
    if (unitById(open, stalker.id)?.owner === 0) break
  }
  const taken = unitById(open, stalker.id)
  assert(taken?.owner === 0 && taken.hp === UNIT_STATS.porter.hp, `a Pillar did not capture the uncovered stalker (${taken?.owner}, ${taken?.hp})`)

  const sheltered = createMatch(4)
  sheltered.aiAcc = -10
  const shelter = makeBuilding(sheltered, 1, 'silo', 38, 24, true)
  const guarded = makeUnit(sheltered, 1, 'porter', 40.5 * TILE, 25.5 * TILE)
  clearPad(sheltered, 36, 22, 44, 30)
  rebuildBlocked(sheltered)
  makeBuilding(sheltered, 0, 'tower', 41, 26, true)
  assert(
    Math.hypot(guarded.x - buildingCenter(shelter).x, guarded.y - buildingCenter(shelter).y) <= BUILDING_STATS.silo.sight,
    'the sheltered stalker is outside finished Storage sight',
  )
  for (let i = 0; i < 90; i++) {
    pin(guarded)
    step(sheltered, 1 / 60)
  }
  const safe = unitById(sheltered, guarded.id)
  assert(safe?.owner === 1 && safe.hp === UNIT_STATS.porter.hp, `a Pillar captured a Stalker inside finished Storage (${safe?.owner}, ${safe?.hp})`)
}

function siloAiPillarsWatchMinesAndAvoidEnemyPillars(): void {
  const state = createMatch(9)
  const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  assert(keep, 'missing a Silo for the Pillar')
  makeBuilding(state, 1, 'yard', 4, 4, true)
  makeBuilding(state, 1, 'yard', 8, 4, true)
  state.oreHeld[1] = 500
  updateSiloAi(state, 0.5)
  const tower = state.buildings.find((building) => building.owner === 1 && building.kind === 'tower' && building.hp > 0)
  assert(tower, 'SiloAI did not raise a Pillar')
  const home = buildingCenter(keep)
  let watch: { tx: number; ty: number } | null = null
  let nearest = Infinity
  for (const node of state.ore) {
    if (node.amount <= 0 || node.base !== 1) continue
    const distance = Math.hypot((node.tx + 0.5) * TILE - home.x, (node.ty + 0.5) * TILE - home.y)
    if (distance < nearest) {
      nearest = distance
      watch = node
    }
  }
  assert(watch, 'Silo 02 has no Dumps to watch')
  const center = buildingCenter(tower)
  const towardX = (watch.tx + 0.5) * TILE - home.x
  const towardY = (watch.ty + 0.5) * TILE - home.y
  const placedX = center.x - home.x
  const placedY = center.y - home.y
  assert(towardX * placedX + towardY * placedY > 0, 'the Pillar was not built toward the Dumps')
  assert(
    Math.hypot(center.x - (watch.tx + 0.5) * TILE, center.y - (watch.ty + 0.5) * TILE) <= BUILDING_STATS.tower.sight,
    'the Pillar cannot see the Dumps',
  )

  const hot = createMatch(7)
  const remote = carveRemoteDump(hot, 1)
  hot.oreHeld[1] = 500
  const enemy = makeBuilding(hot, 0, 'tower', remote.tx + 2, remote.ty, true)
  hot.aiVisible[enemy.ty * hot.mapW + enemy.tx] = 1
  const before = new Set(hot.buildings.map((building) => building.id))
  const miner = makeUnit(hot, 1, 'porter', (remote.tx + 4.5) * TILE, (remote.ty + 0.5) * TILE)
  miner.order = { type: 'gather', nodeId: remote.id, phase: 'approach' }
  const hotKeep = hot.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  assert(hotKeep, 'missing a Silo for the retreat')
  updateSiloAi(hot, 0.5)
  assert(
    !hot.buildings.some((building) => building.owner === 1 && building.kind === 'silo' && !before.has(building.id)),
    'SiloAI raised a Storage inside an enemy Pillar sight',
  )
  assert(
    headingHome(unitById(hot, miner.id), buildingCenter(hotKeep), buildingCenter(enemy)),
    'SiloAI left a Stalker where an enemy Pillar can capture it',
  )
}

function siloAiRefusesUnchartedGround(): void {
  const state = createMatch(7)
  const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  assert(keep, 'missing a Silo for the uncharted site')
  const cx = 40
  const cy = 24
  const radius = 12
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) continue
      state.tiles[y * state.mapW + x] = 0
      state.aiExplored[y * state.mapW + x] = 0
      state.aiVisible[y * state.mapW + x] = 0
    }
  }
  state.rocks = state.rocks.filter((rock) => Math.max(Math.abs(rock.tx - cx), Math.abs(rock.ty - cy)) > radius)
  for (const node of state.ore) {
    if (node.base === 1) node.amount = 0
    else if (Math.max(Math.abs(node.tx - cx), Math.abs(node.ty - cy)) <= radius + 4) node.amount = 0
  }
  const remote = { id: state.nextId++, tx: cx, ty: cy, amount: 420, base: null }
  state.ore.push(remote)
  state.aiExplored[cy * state.mapW + cx] = 1
  rebuildBlocked(state)
  state.oreHeld[1] = 2000
  const hover = makeUnit(state, 1, 'drone', (keep.tx + 1.5) * TILE, (keep.ty + 1.5) * TILE)
  const blind = findBuildSpotWithin(state, 'silo', remote.tx, remote.ty, SILO_AI_EXPANSION_REACH, 1, false)
  assert(blind, 'no terrain-legal Storage site beside the uncharted Dumps')
  assert(!areaCharted(state, 1, 'silo', blind.tx, blind.ty), 'the remote Storage site was already explored')
  const before = new Set(state.buildings.map((building) => building.id))
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  assert(
    !state.buildings.some((building) => building.owner === 1 && building.kind === 'silo' && !before.has(building.id)),
    'SiloAI built a Storage on unexplored ground',
  )
  const flown = unitById(state, hover.id)
  const aim = flown?.order
  const siteX = (blind.tx + BUILDING_STATS.silo.w / 2) * TILE
  const siteY = (blind.ty + BUILDING_STATS.silo.h / 2) * TILE
  assert(
    aim?.type === 'move' && Math.hypot(aim.x - siteX, aim.y - siteY) < 48,
    'the Hover was not sent to chart the unexplored Storage site',
  )

  state.buildings = state.buildings.filter((building) => before.has(building.id))
  for (const unit of state.units) {
    if (unit.order?.type !== 'construct') continue
    unit.order = null
    unit.path = []
    unit.goalX = null
    unit.goalY = null
  }
  chartDisk(state, 1, cx, cy, radius)
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) continue
      state.aiVisible[y * state.mapW + x] = 0
    }
  }
  assert(areaCharted(state, 1, 'silo', blind.tx, blind.ty), 'charting the disk left the Storage site black')
  state.oreHeld[1] = 2000
  state.aiAcc = 0
  rebuildBlocked(state)
  updateSiloAi(state, 0.5)
  const built = state.buildings.find(
    (building) => building.owner === 1 && building.kind === 'silo' && !before.has(building.id),
  )
  assert(built, 'SiloAI did not build the Storage once the site was explored')
  assert(areaCharted(state, 1, 'silo', built.tx, built.ty), 'the Storage footprint is not fully explored')
  assert(state.aiVisible[built.ty * state.mapW + built.tx] === 0, 'SiloAI required current sight instead of explored ground')

  const hands = createMatch(2)
  hands.explored.fill(0)
  hands.oreHeld[0] = 800
  const stats = BUILDING_STATS.yard
  let humanBuilt = false
  for (let ty = 1; ty < MAP_H - stats.h - 1 && !humanBuilt; ty++) {
    for (let tx = 1; tx < MAP_W - stats.w - 1 && !humanBuilt; tx++) {
      if (!canPlace(hands, 'yard', tx, ty)) continue
      if (hands.explored[ty * MAP_W + tx] !== 0) continue
      if (tryPlace(hands, 0, 'yard', tx, ty, []) != null) continue
      humanBuilt = hands.explored[ty * MAP_W + tx] === 0
    }
  }
  assert(humanBuilt, 'a human Stalker was refused a building on unexplored ground')
}

function ruinedSiloCanBeRepaired(): void {
  const duel = createMatch(2)
  const enemy = duel.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(enemy, 'missing the 1v1 Silo')
  const enemyId = enemy.id
  enemy.hp = 0
  enemy.struckBy = 0
  step(duel, 1 / 60)
  assert(duel.outcome === 'win', `destroying the Silo did not end the 1v1 (${duel.outcome})`)
  const wreck = duel.buildings.find((building) => building.id === enemyId)
  assert(wreck?.ruined && wreck.owner === -1 && wreck.hp === 0, 'the 1v1 Silo disappeared instead of leaving a ruin')
  assert(
    !duel.buildings.some((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0),
    'the loser still has a living Silo',
  )

  const state = createMatch(4, 'ffa')
  const fallen = state.buildings.find((building) => building.owner === 2 && building.kind === 'keep')
  assert(fallen, 'missing a free-for-all Silo')
  const victimOre = state.oreHeld[2] ?? 0
  const captorOre = state.oreHeld[1] ?? 0
  const fallenId = fallen.id
  fallen.hp = 0
  fallen.struckBy = 1
  state.aiAcc = -20
  for (let owner = 0; owner < state.playerCount; owner++) state.sideAcc[owner] = -20
  step(state, 1 / 60)
  assert(state.eliminated[2], 'destroying the Silo did not capture that side')
  assert(state.outcome == null, 'one ruined Silo ended the free-for-all')
  assert(!state.buildings.some((building) => building.owner === 2), 'captured buildings kept the loser')
  assert(!state.units.some((unit) => unit.owner === 2), 'captured units kept the loser')
  assert(state.oreHeld[1] === captorOre + victimOre, 'dumps did not transfer with the capture')
  const ruin = state.buildings.find((building) => building.id === fallenId)
  assert(ruin?.ruined && ruin.owner === -1 && ruin.hp === 0 && !ruin.complete, 'the Silo did not stay as a neutral ruin')
  for (let y = 0; y < BUILDING_STATS.keep.h; y++) {
    for (let x = 0; x < BUILDING_STATS.keep.w; x++) {
      assert(!isWalkable(state, ruin.tx + x, ruin.ty + y), `the ruin does not block ${ruin.tx + x},${ruin.ty + y}`)
    }
  }
  const savedHp = state.units.map((unit) => unit.hp)
  for (const unit of state.units) unit.hp = 0
  updateVision(state)
  assert(!sideTileVisible(state, 1, ruin.tx + 1, ruin.ty + 1), 'a ruined Silo still grants vision')
  state.units.forEach((unit, index) => {
    unit.hp = savedHp[index] ?? unit.hp
  })
  state.selectedBuilding = ruin.id
  state.selectedUnits = []
  const panel = describeSelection(state)
  assert(panel.includes('Ruined Silo'), 'the info panel did not title the wreck')
  assert(panel.includes('A collapsed shelter. A Stalker can repair it.'), 'the info panel lore is missing')
  for (let y = 0; y < BUILDING_STATS.keep.h; y++) {
    for (let x = 0; x < BUILDING_STATS.keep.w; x++) {
      state.explored[(ruin.ty + y) * state.mapW + (ruin.tx + x)] = 0
      state.aiExplored[(ruin.ty + y) * state.mapW + (ruin.tx + x)] = 0
    }
  }
  assert(!viewRuinShown(state, ruin), 'a ruin on black fog was treated as explored')
  for (let y = 0; y < BUILDING_STATS.keep.h; y++) {
    for (let x = 0; x < BUILDING_STATS.keep.w; x++) {
      state.aiExplored[(ruin.ty + y) * state.mapW + (ruin.tx + x)] = 1
      state.explored[(ruin.ty + y) * state.mapW + (ruin.tx + x)] = 1
      state.aiVisible[(ruin.ty + y) * state.mapW + (ruin.tx + x)] = 0
      state.visible[(ruin.ty + y) * state.mapW + (ruin.tx + x)] = 0
    }
  }
  assert(viewRuinShown(state, ruin), 'an explored ruin under the shroud was hidden')

  const owners = state.units.map((unit) => unit.owner)
  for (const unit of state.units) unit.owner = 0
  const watcher = makeUnit(state, 0, 'pike', (ruin.tx + 1.5) * TILE, (ruin.ty + 4) * TILE)
  for (let i = 0; i < 30; i++) step(state, 1 / 60)
  const watching = unitById(state, watcher.id)
  assert(
    !(watching?.order?.type === 'attack' && watching.order.kind === 'building' && watching.order.targetId === ruin.id),
    'a Flasher auto-fired on the ruined Silo',
  )
  state.units = state.units.filter((unit) => unit.id !== watcher.id)
  state.units.forEach((unit, index) => {
    if (owners[index] != null) unit.owner = owners[index] ?? unit.owner
  })

  const stalker = state.units.find((unit) => unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0)
  assert(stalker, 'missing a Stalker to refuse the repair')
  state.oreHeld[1] = 0
  const refused = commandRepair(state, [stalker.id], ruin.id)
  assert(refused != null, 'a repair started with no dumps')
  assert(stalker.order?.type !== 'repair', 'the Stalker was ordered to repair without dumps')

  for (let y = 0; y < BUILDING_STATS.keep.h; y++) {
    for (let x = 0; x < BUILDING_STATS.keep.w; x++) state.aiExplored[(ruin.ty + y) * state.mapW + (ruin.tx + x)] = 0
  }
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  assert(
    !state.units.some((unit) => unit.owner === 1 && unit.order?.type === 'repair'),
    'SiloAI repaired a Silo it had not explored',
  )
  for (let y = 0; y < BUILDING_STATS.keep.h; y++) {
    for (let x = 0; x < BUILDING_STATS.keep.w; x++) state.aiExplored[(ruin.ty + y) * state.mapW + (ruin.tx + x)] = 1
  }
  const foe = makeUnit(state, 0, 'pike', (ruin.tx + 1.5) * TILE, (ruin.ty + 0.5) * TILE)
  state.aiVisible[Math.floor(foe.y / TILE) * state.mapW + Math.floor(foe.x / TILE)] = 1
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  assert(
    !state.units.some((unit) => unit.owner === 1 && unit.order?.type === 'repair'),
    'SiloAI repaired a Silo beside a visible enemy',
  )
  state.units = state.units.filter((unit) => unit.id !== foe.id)
  state.oreHeld[1] = 500
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  assert(
    state.units.some((unit) => unit.owner === 1 && unit.kind === 'porter' && unit.order?.type === 'repair' && unit.order.buildingId === ruin.id),
    'SiloAI did not send a Stalker to the closest safe ruin',
  )

  for (const unit of state.units) {
    unit.cargo = 0
    unit.nodeMemory = -1
    unit.order = { type: 'move', x: 8, y: 8 }
    unit.path = []
    unit.goalX = null
    unit.goalY = null
  }
  const builder = makeUnit(state, 1, 'porter', (ruin.tx + 1.5) * TILE, (ruin.ty + 3.6) * TILE)
  state.oreHeld[1] = SILO_REPAIR_COST
  const capBefore = state.supplyCap[1] ?? 0
  assert(commandRepair(state, [builder.id], ruin.id) == null, 'the paid repair was refused')
  state.aiAcc = -30
  for (let owner = 0; owner < state.playerCount; owner++) state.sideAcc[owner] = -30
  let started = false
  for (let i = 0; i < 20 * 60; i++) {
    step(state, 1 / 60)
    if (ruin.progress > 0 && ruin.ruined) started = true
    if (!ruin.ruined) break
  }
  assert(started, 'the repair never showed progress')
  const restored = state.buildings.find((building) => building.id === fallenId)
  assert(restored && !restored.ruined && restored.complete && restored.owner === 1, 'the repair did not restore the Silo')
  assert(restored.hp === BUILDING_STATS.keep.hp, `the Silo came back with ${restored.hp} health`)
  assert(state.oreHeld[1] === 0, `repair left ${state.oreHeld[1]} dumps`)
  assert(state.supplyCap[1] === capBefore + BUILDING_STATS.keep.supply, 'the restored Silo did not add its cells')
  assert(state.eliminated[2], 'repairing the ruin brought the captured side back')
  state.oreHeld[1] = UNIT_STATS.porter.cost
  assert(tryTrain(state, restored.id, 'porter') == null, 'the restored Silo does not train Stalkers')
  updateVision(state)
  const center = buildingCenter(restored)
  let saw = false
  for (let ty = 0; ty < state.mapH && !saw; ty++) {
    for (let tx = 0; tx < state.mapW; tx++) {
      const distance = Math.hypot((tx + 0.5) * TILE - center.x, (ty + 0.5) * TILE - center.y)
      if (distance < 150 || distance > 240) continue
      saw = sideTileVisible(state, 1, tx, ty)
      ty = state.mapH
      break
    }
  }
  assert(saw, 'the restored Silo grants no vision')
  assert(SILO_REPAIR_TIME === 8 && SILO_REPAIR_COST === 80, 'repair price changed')
}

function attacksAttacker(unit: Unit | undefined, targetId: number): boolean {
  const order = unit?.order
  return order?.type === 'attack' && order.kind === 'unit' && order.targetId === targetId
}

function siloAiDefendsItsSilo(): void {
  const state = createMatch(5)
  state.time = 20
  const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  const foe = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep' && building.hp > 0)
  assert(keep && foe, 'missing a Silo for the defense')
  const home = buildingCenter(keep)
  const foePoint = buildingCenter(foe)
  state.aiSpotted.push({ id: foe.id, x: foePoint.x, y: foePoint.y })
  const rally = siloRallyPoint(state, 1)
  assert(rally, 'SiloAI has no rally while defending')
  const far = makeUnit(state, 1, 'pike', foePoint.x - 40, foePoint.y)
  far.order = { type: 'attackMove', x: foePoint.x, y: foePoint.y, focusId: foe.id, focusKind: 'building' }
  state.aiAttacking = true
  const rallyPike = makeUnit(state, 1, 'pike', rally.x, rally.y)
  const gorilla = makeUnit(state, 1, 'howler', rally.x + 18, rally.y)
  const shed = makeBuilding(state, 1, 'silo', keep.tx, keep.ty + 4, true)
  const shedCenter = buildingCenter(shed)
  const bystander = makeUnit(state, 0, 'howler', foePoint.x + 90, foePoint.y)
  updateVision(state)
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  assert(!attacksAttacker(unitById(state, far.id), bystander.id), 'a distant enemy pulled the army home')
  assert(!attacksAttacker(unitById(state, rallyPike.id), bystander.id), 'the rally group attacked a distant enemy')

  const attacker = makeUnit(state, 0, 'pike', shedCenter.x, shedCenter.y + BUILDING_STATS.silo.h * TILE * 0.5 + 24)
  updateVision(state)
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  assert(!state.aiAttacking, 'SiloAI kept the wave going while the base was under attack')
  for (const unit of [far, rallyPike, gorilla]) {
    assert(attacksAttacker(unitById(state, unit.id), attacker.id), 'a military unit did not attack the Silo attacker')
  }
  const drone = state.units.find((unit) => unit.owner === 1 && unit.kind === 'drone' && unit.hp > 0)
  if (drone) assert(!attacksAttacker(drone, attacker.id), 'a Hover joined the Silo defense')

  attacker.hp = 0
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  for (const unit of [far, rallyPike, gorilla]) {
    const now = unitById(state, unit.id)
    assert(now?.order?.type !== 'attack', 'the army kept chasing after the attack ended')
    assert(aimsAt(now, rally, 180) || aimsAt(now, home, 180), 'the army did not return to the rally')
  }
}

function siloAiKeepsStalkersWorking(): void {
  const state = createMatch(2)
  state.oreHeld[1] = 0
  const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  assert(keep, 'missing a Silo for idle stalkers')
  const home = buildingCenter(keep)
  for (let i = 0; i < 8; i++) makeUnit(state, 1, 'porter', home.x + i * 8, home.y + 70)
  updateVision(state)
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  const porters = state.units.filter((unit) => unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0)
  const idle = porters.filter((unit) => !unit.order)
  assert(idle.length === 0, `SiloAI left ${idle.length} stalkers with nothing to do`)
  const working = porters.filter((unit) => unit.order?.type === 'gather' || (unit.order?.type === 'attack' && unit.order.kind === 'rock'))
  assert(working.length >= 4, `expected stalkers on dumps, got ${working.length}`)
}

function cellsDoNotCapTraining(): void {
  assert(BUILDING_STATS.tower.hp === 160, `Pillar health is ${BUILDING_STATS.tower.hp}`)
  assert(BUILDING_STATS.tower.buildTime === 7, `Pillar build time is ${BUILDING_STATS.tower.buildTime}`)
  const state = createMatch(3)
  const silo = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(silo, 'missing a Silo for Cells')
  for (let i = 0; i < 70; i++) makeUnit(state, 0, 'pike', 40 + (i % 20) * 8, 40 + Math.floor(i / 20) * 8)
  recomputeSupply(state)
  assert(state.supplyUsed[0] > 60, 'the old Cells maximum was not passed')
  assert(state.supplyUsed[0] > state.supplyCap[0], 'spawned units stayed under the building Cells')
  state.oreHeld[0] = UNIT_STATS.porter.cost
  assert(tryTrain(state, silo.id, 'porter') === null, 'Cells stopped a Stalker from training')
  assert(silo.queue.some((job) => job.kind === 'porter'), 'the Stalker was not queued past the old cap')
}
