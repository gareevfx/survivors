import { DRONE_BIKE_AVOID, scoutArea, SILO_AI_EXPANSION_REACH, siloRallyPoint, siloWaveNeed, updateSiloAi } from './game/siloAi'
import { runCommand } from './game/console'
import { cycleSide, takeSide } from './game/control'
import { aiPlaceNearKeep, assignMiners, cancelTrain, commandAttack, commandConstruct, commandFreeze, commandFreezeAuto, commandGather, commandHarvestOrAttack, commandHoverGrid, commandMove, commandRepair, commandStop, hoverGridSpots, installCryo, playerHovers, thawCryo, tryPlace, tryTrain } from './game/commands'
import { CASTLE_YARD, narrowPassageCount } from './game/map'
import { AI_BUILD_GAP, AI_MINERAL_KEEP, areaCharted, findBuildSpotWithin, mineralLaneTiles } from './game/nav'
import { findPath, rockShotClear } from './game/pathfind'
import { yardEntrance } from './game/factoryArt'
import { minimapFrame } from './game/render'
import { keepEntrance } from './game/siloArt'
import { animalCounts, CROW_COUNT } from './game/animals'
import { applyDue, armPlayback, beginRecording, currentTape, finishRecording, rememberAlways, rememberLive, sealReplayStats } from './game/replay'
import { step } from './game/sim'
import { buildingCenter, buildingRect, canPlace, createMatch, isWalkable, makeBuilding, makeUnit, PILLAR_GAP, placementAllowed, rebuildBlocked, recomputeSupply, unitById } from './game/state'
import { storageFill } from './game/storageArt'
import { AGGRO_RANGE, BUILDING_STATS, CRYO_COST, CRYO_FREEZE_COST, CRYO_RECOVER, CRYO_SLOTS, FFA8_MAP_H, FFA8_MAP_W, FLASHER_POWER_SECONDS, GATHER_AMOUNT, GORILLA_POWER_SECONDS, GRID_CLOAK_SECONDS, HOVER_POWER_SECONDS, INTERACT, isShutdown, MAP_H, MAP_W, PLAYER_COLOR, PLAYER_NAME, POWER_LOW, ROCK_HP, SILO_REPAIR_COST, SILO_REPAIR_TIME, STALKER_LIFESPAN, STARTING_ORE, STORAGE_CAP, SUPPLY_MAX, TILE, TREE_HP, UNIT_KINDS, UNIT_STATS, type Building, type MatchState, type PlayerId, type Unit, type UnitKind } from './game/types'
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
import { commandSnapshot, describeSelection, endStatsHtml, statsPanelHtml } from './ui/hud'
import { loreBody } from './ui/lore'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** True when a Stalker's hit points match the five-minute drain and nothing else. */
function stalkerUntouched(unit: { hp: number; age: number } | null | undefined): boolean {
  if (!unit) return false
  const expected = UNIT_STATS.porter.hp * (1 - Math.min(unit.age, STALKER_LIFESPAN) / STALKER_LIFESPAN)
  return Math.abs(unit.hp - expected) < 1e-4
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
  assert(!runCommand(state, 'ai control'), 'the old ai control command was still accepted')
  assert(!state.aiControl, 'the old command turned SiloAI on')
  assert(runCommand(state, 'SiloAI'), 'siloai was rejected')
  assert(state.aiControl, 'AI Control did not turn on')
  assert(state.toasts[state.toasts.length - 1]?.text === 'SiloAI is on.', 'SiloAI did not announce itself')
  assert(runCommand(state, 'siloai'), 'repeating siloai was rejected')
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
  for (let i = 0; i < 20; i++) step(state, 1 / 60)

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

  assert(runCommand(state, 'SiloAI Off'), 'siloai off was rejected')
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
  assert(runCommand(fresh, 'SILOAI OFF'), 'siloai off was rejected while already off')
  assert(!fresh.aiControl, 'the off command turned AI control on')
  assert(fresh.toasts[fresh.toasts.length - 1]?.text === 'SiloAI is already off.', 'the off notice was wrong')
  assert(!runCommand(fresh, 'off ai control'), 'the old off ai control command was still accepted')
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
  const homePoint = buildingCenter(home)
  makeUnit(state, 1, 'porter', homePoint.x, homePoint.y + 36)
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

function countsMatch(state: MatchState, owner: number, kind: UnitKind, created: number, lost: number): void {
  const row = state.stats[owner]
  assert(row, `missing stats for side ${owner}`)
  assert(row.created[kind] === created, `side ${owner} created ${row.created[kind]} ${kind}, expected ${created}`)
  assert(row.lost[kind] === lost, `side ${owner} lost ${row.lost[kind]} ${kind}, expected ${lost}`)
}

function endOfMatchStats(): void {
  const fresh = createMatch(4)
  for (let owner = 0; owner < fresh.playerCount; owner++) {
    const alive: Record<UnitKind, number> = { porter: 0, pike: 0, howler: 0, drone: 0 }
    for (const unit of fresh.units) {
      if (unit.owner === owner && unit.hp > 0) alive[unit.kind] += 1
    }
    for (const kind of UNIT_KINDS) countsMatch(fresh, owner, kind, alive[kind], 0)
    assert(fresh.stats[owner]?.dumps === 0, 'a new side already collected dumps')
    assert(fresh.stats[owner]?.silos === 0, 'a new side already captured a silo')
  }
  assert((fresh.stats[0]?.created.porter ?? 0) > 0, 'Silo 01 started without Stalkers')

  const keep = fresh.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(keep, 'missing the home Silo')
  keep.queue.push({ kind: 'pike', remaining: 0.01, total: 1 })
  step(fresh, 1 / 60)
  assert(fresh.units.some((unit) => unit.owner === 0 && unit.kind === 'pike' && unit.hp > 0), 'the Flasher never stepped out')
  countsMatch(fresh, 0, 'pike', 1, 0)
  const trained = fresh.units.find((unit) => unit.owner === 0 && unit.kind === 'pike')
  assert(trained, 'the trained Flasher disappeared')
  trained.hp = 0
  step(fresh, 1 / 60)
  countsMatch(fresh, 0, 'pike', 1, 1)
  assert(!fresh.units.some((unit) => unit.id === trained.id), 'the dead Flasher stayed on the field')

  const hauler = fresh.units.find((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  assert(hauler, 'missing a Stalker to deliver dumps')
  clearPad(fresh, 16, 16, 28, 28)
  const bin = makeBuilding(fresh, 0, 'silo', 20, 20, true)
  rebuildBlocked(fresh)
  hauler.x = (bin.tx + 1) * TILE
  hauler.y = (bin.ty + 2) * TILE + 8
  hauler.cargo = 8
  hauler.order = { type: 'gather', nodeId: -1, phase: 'return' }
  const bank = fresh.oreHeld[0]
  const collected = () => fresh.stats[0]?.dumps ?? -1
  step(fresh, 1 / 30)
  assert(collected() === 8, `delivered dumps were ${collected()}`)
  assert(fresh.oreHeld[0] === bank + 8, 'the bank did not take the delivered dumps')
  bin.stock = STORAGE_CAP
  hauler.cargo = 8
  hauler.order = { type: 'gather', nodeId: -1, phase: 'return' }
  step(fresh, 1 / 30)
  assert(collected() === 8, 'a full Storage counted a refused haul')
  assert(hauler.cargo === 8, 'a full Storage took the cargo anyway')
  bin.stock = STORAGE_CAP - 3
  hauler.order = { type: 'gather', nodeId: -1, phase: 'return' }
  step(fresh, 1 / 30)
  assert(collected() === 11, `a partial haul counted ${collected()}`)
  assert(tryTrain(fresh, keep.id, 'porter') === null, 'the Silo rejected a Stalker paid from the bank')
  assert(collected() === 11, 'spending dumps reduced the collected total')

  const open = createMatch(4)
  clearPad(open, 36, 20, 46, 32)
  rebuildBlocked(open)
  const beforeCreated = open.stats.map((row) => ({ ...row.created }))
  const beforeLost = open.stats.map((row) => ({ ...row.lost }))
  const stalker = makeUnit(open, 1, 'porter', 40.5 * TILE, 25.5 * TILE)
  const pike = makeUnit(open, 0, 'pike', stalker.x + 18, stalker.y)
  assert(open.stats[1]?.created.porter === (beforeCreated[1]?.porter ?? 0) + 1, 'the extra Stalker was not created')
  assert(open.stats[0]?.created.pike === (beforeCreated[0]?.pike ?? 0) + 1, 'the extra Flasher was not created')
  commandAttack(open, [pike.id], stalker.id, 'unit')
  for (let i = 0; i < 40; i++) step(open, 1 / 60)
  const taken = unitById(open, stalker.id)
  assert(taken?.owner === 0, 'the uncovered Stalker was not captured')
  assert(open.stats[1]?.lost.porter === (beforeLost[1]?.porter ?? 0), 'capturing a Stalker counted as a loss')
  assert(open.stats[0]?.created.porter === (beforeCreated[0]?.porter ?? 0), 'a captured Stalker counted as created')

  const duel = createMatch(2)
  const started = duel.stats.map((row) => ({ created: { ...row.created }, lost: { ...row.lost }, dumps: row.dumps }))
  const enemy = duel.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(enemy, 'missing the enemy Silo')
  enemy.hp = 0
  step(duel, 1 / 60)
  assert(duel.outcome === 'win', 'destroying the Silo did not end the 1v1')
  assert(duel.stats[0]?.silos === 1, 'the captor did not record the Silo')
  assert(duel.stats[1]?.silos === 0, 'the fallen side recorded its own capture')
  assert(duel.stats[0]?.dumps === started[0]?.dumps && duel.stats[1]?.dumps === started[1]?.dumps, 'capturing a bank counted as collected dumps')
  for (const kind of UNIT_KINDS) {
    assert(duel.stats[0]?.created[kind] === started[0]?.created[kind], `capture created a ${kind}`)
    assert(duel.stats[1]?.created[kind] === started[1]?.created[kind], `capture created a ${kind} for the loser`)
    assert(duel.stats[0]?.lost[kind] === started[0]?.lost[kind], `capture lost a ${kind}`)
    assert(duel.stats[1]?.lost[kind] === started[1]?.lost[kind], `transferred ${kind}s counted as lost`)
  }

  const wiped = createMatch(4, 'ffa')
  const victim = 1
  const victims = wiped.units.filter((unit) => unit.owner === victim && unit.hp > 0)
  assert(victims.length > 0, 'the wiped side had no units')
  for (const owner of [0, 2, 3]) wiped.eliminated[owner] = true
  const victimKeep = wiped.buildings.find((building) => building.owner === victim && building.kind === 'keep')
  assert(victimKeep, 'missing the Silo to wipe')
  victimKeep.hp = 0
  step(wiped, 1 / 60)
  assert(wiped.units.every((unit) => unit.owner !== victim), 'the wiped side kept a unit')
  assert(wiped.stats[victim]?.lost.porter === victims.length, `the wipe lost ${wiped.stats[victim]?.lost.porter}, not ${victims.length}`)
  assert(wiped.stats.every((row) => row.silos === 0), 'a wipe with no captor counted a Silo')

  const aged = createMatch(6)
  const elder = aged.units.find((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  assert(elder, 'missing a Stalker to age out')
  const graves = aged.graves.length
  elder.age = STALKER_LIFESPAN
  step(aged, 1 / 60)
  assert(aged.stats[0]?.lost.porter === 1, 'an aged Stalker was not lost')
  assert(aged.stats[0]?.created.porter === aged.units.filter((unit) => unit.owner === 0 && unit.kind === 'porter').length + 1, 'aging changed how many Stalkers were created')
  assert(aged.graves.length === graves + 1, 'the aged Stalker left no grave')

  const freed = createMatch(8)
  const living: Record<number, Record<UnitKind, number>> = {}
  for (let owner = 0; owner < freed.playerCount; owner++) {
    living[owner] = { porter: 0, pike: 0, howler: 0, drone: 0 }
  }
  for (const unit of freed.units) {
    const row = living[unit.owner]
    if (row) row[unit.kind] += 1
  }
  assert(runCommand(freed, 'freedom'), 'freedom was rejected')
  for (let owner = 0; owner < freed.playerCount; owner++) {
    for (const kind of UNIT_KINDS) {
      countsMatch(freed, owner, kind, living[owner]?.[kind] ?? 0, living[owner]?.[kind] ?? 0)
    }
  }

  const board = createMatch(9, 'ffa8')
  board.time = 125.9
  board.outcome = 'win'
  board.stats[0]!.created.howler = 13
  board.stats[0]!.lost.drone = 2
  board.stats[0]!.dumps = 4321
  board.stats[0]!.silos = 6
  board.stats[7]!.created.pike = 15
  const html = endStatsHtml(board)
  assert(html.includes('>02:05<'), `duration was not 02:05 in ${html.slice(0, 80)}`)
  assert(html.includes('Duration'), 'the panel omitted the duration label')
  assert(html.includes('Created') && html.includes('Lost'), 'the panel omitted created and lost')
  assert(html.includes('Dumps collected') && html.includes('Silos captured'), 'the panel omitted dumps or silos')
  for (let owner = 0; owner < 8; owner++) assert(html.includes(PLAYER_NAME[owner] ?? ''), `the panel omitted ${PLAYER_NAME[owner]}`)
  assert(!html.includes('Silo 09'), 'the eight-player panel listed an extra side')
  assert(html.includes('>13<') && html.includes('>4321<') && html.includes('>15<'), 'the panel dropped a recorded total')
  assert((html.match(/class="you"/g) ?? []).length === 1, 'Silo 01 was not the only highlighted side')
  const quiet = createMatch(1)
  quiet.time = 0
  assert(endStatsHtml(quiet).includes('>00:00<'), 'a new match did not format as 00:00')
  quiet.time = 59.9
  assert(endStatsHtml(quiet).includes('>00:59<'), '59 seconds did not format as 00:59')
  quiet.time = 3600
  assert(endStatsHtml(quiet).includes('>60:00<'), 'an hour did not format as 60:00')
  assert(!endStatsHtml(quiet).includes('Silo 03'), 'a 1v1 panel listed Silo 03')
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
  assert(!runCommand(state, 'both cam'), 'the old both cam command was still accepted')
  assert(!state.bothCam, 'the old command turned all cams on')
  assert(runCommand(state, '  All Cams  '), 'all cams was rejected')
  assert(state.bothCam && !state.enemyCam && !state.fogCleared, 'all cams did not replace the normal view')
  assert(state.toasts[state.toasts.length - 1]?.text === 'All cams is on.', 'all cams did not announce itself')
  assert(runCommand(state, 'ALL CAMS'), 'repeating all cams was rejected')
  assert(state.toasts[state.toasts.length - 1]?.text === 'All cams is already on.', 'the repeat used the wrong notice')
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
  assert(runCommand(state, 'all cams'), 'all cams was rejected after enemy cam')
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
  assert(!runCommand(state, 'off both cam'), 'the old off both cam command was still accepted')
  assert(runCommand(state, 'all cams off'), 'all cams off was rejected while already off')
  assert(state.toasts[state.toasts.length - 1]?.text === 'All cams is already off.', 'the off notice was wrong')
  assert(runCommand(state, 'all cams') && runCommand(state, 'All Cams Off'), 'all cams off was rejected')
  assert(!state.bothCam && !state.enemyCam && !state.fogCleared, 'off both cam left a special view on')
  assert(viewTileVisible(state, keep.tx + 1, keep.ty + 1) && !viewTileVisible(state, enemy.tx + 1, enemy.ty + 1), 'off both cam did not return to Northmark')
}

function wildlifeStaysAmbient(): void {
  for (const mode of ['duel', 'ffa'] as const) {
    const state = createMatch(4, mode)
    const crows = state.animals.filter((animal) => animal.kind === 'crow').length
    assert(state.animals.length === CROW_COUNT && crows === CROW_COUNT, `${mode} spawned ${state.animals.length} animals, ${crows} crows`)
  }

  const state = createMatch(4)
  state.aiAcc = -1000
  const units = state.units.length
  const supply = state.supplyUsed[0]
  const graves = state.graves.length
  const starts = state.animals.map((animal) => ({ x: animal.x, y: animal.y }))
  for (let i = 0; i < 90; i++) step(state, 1 / 30)
  assert(state.units.length === units, 'wildlife changed the unit list')
  assert(state.supplyUsed[0] === supply, 'wildlife changed supply')
  assert(state.graves.length === graves, 'wildlife left a grave')
  let moved = false
  for (let i = 0; i < state.animals.length; i++) {
    const animal = state.animals[i]
    const start = starts[i]
    if (!animal || !start) continue
    if (Math.hypot(animal.x - start.x, animal.y - start.y) > 4) moved = true
  }
  assert(moved, 'crows stood still')

  const crow = state.animals.find((animal) => animal.kind === 'crow')
  assert(crow, 'missing a crow')
  const keep = state.buildings.find((building) => building.kind === 'keep')
  assert(keep, 'missing a Silo to fly over')
  crow.x = (keep.tx + 1) * TILE
  crow.y = (keep.ty + 1) * TILE
  crow.facing = 0
  const crossed = crow.y
  step(state, 0.4)
  assert(crow.x > (keep.tx + 1) * TILE, 'a crow did not fly')
  assert(Math.abs(crow.y - crossed) < 1, 'a crow followed the ground')
  assert(state.units.length === units, 'a crow joined the unit list')

  const frozen = state.animals.map((animal) => ({ x: animal.x, y: animal.y }))
  state.paused = true
  step(state, 1)
  for (let i = 0; i < state.animals.length; i++) {
    const animal = state.animals[i]
    const still = frozen[i]
    assert(animal && still && animal.x === still.x && animal.y === still.y, 'wildlife moved while paused')
  }
  state.paused = false
  const alive = state.animals.length
  assert(runCommand(state, 'freedom'), 'freedom was rejected')
  assert(state.units.length === 0, 'freedom left a unit')
  assert(state.animals.length === alive, 'freedom removed wildlife')
  assert(state.graves.length === graves, 'freedom laid a grave for wildlife')
}

function stalkerDoesNotAttackCombatUnits(): void {
  const state = createMatch(4)
  state.aiAcc = -1000
  clearPad(state, 30, 12, 50, 28)
  rebuildBlocked(state)
  const stalker = makeUnit(state, 0, 'porter', 40.5 * TILE, 20.5 * TILE)
  const task = (): Unit['order'] => stalker.order
  const flasher = makeUnit(state, 1, 'pike', stalker.x + 22, stalker.y)
  const gorilla = makeUnit(state, 1, 'howler', stalker.x + 18, stalker.y + 16)
  const hover = makeUnit(state, 1, 'drone', stalker.x - 20, stalker.y + 8)
  const otherStalker = makeUnit(state, 1, 'porter', stalker.x + 400, stalker.y + 400)
  const rock = state.rocks.find((entry) => entry.hp > 0)
  const enemyKeep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  assert(rock && enemyKeep, 'missing a rock or Silo a Stalker can still attack')

  commandAttack(state, [stalker.id], flasher.id, 'unit')
  assert(task() == null, 'a Stalker was ordered onto a Flasher')
  commandAttack(state, [stalker.id], gorilla.id, 'unit')
  assert(task() == null, 'a Stalker was ordered onto a Gorilla')
  commandAttack(state, [stalker.id], hover.id, 'unit')
  assert(task() == null, 'a Stalker was ordered onto a Hover')

  const ally = makeUnit(state, 0, 'pike', stalker.x, stalker.y + 48)
  commandAttack(state, [stalker.id, ally.id], gorilla.id, 'unit')
  assert(task() == null, 'a Stalker joined an attack on a Gorilla')
  assert(ally.order?.type === 'attack' && ally.order.targetId === gorilla.id, 'a Flasher was refused the same order')
  ally.hp = 0

  commandAttack(state, [stalker.id], otherStalker.id, 'unit')
  const onStalker = task()
  assert(
    onStalker?.type === 'attack' && onStalker.kind === 'unit' && onStalker.targetId === otherStalker.id,
    'a Stalker could not attack another Stalker',
  )
  commandAttack(state, [stalker.id], rock.id, 'rock')
  const onRock = task()
  assert(onRock?.type === 'attack' && onRock.kind === 'rock', 'a Stalker could not attack rock')
  commandAttack(state, [stalker.id], enemyKeep.id, 'building')
  const onKeep = task()
  assert(
    onKeep?.type === 'attack' && onKeep.kind === 'building' && onKeep.targetId === enemyKeep.id,
    'a Stalker could not attack a Silo',
  )

  stalker.order = { type: 'attack', targetId: flasher.id, kind: 'unit' }
  stalker.hurtTimer = 3
  const flasherHp = flasher.hp
  const gorillaHp = gorilla.hp
  const hoverHp = hover.hp
  for (let i = 0; i < 40; i++) step(state, 1 / 30)
  assert(flasher.hp === flasherHp && gorilla.hp === gorillaHp && hover.hp === hoverHp, 'a Stalker damaged a combat unit')
  const aimed = task()
  const aimedUnit = aimed?.type === 'attack' && aimed.kind === 'unit' ? unitById(state, aimed.targetId) : null
  assert(aimedUnit == null || aimedUnit.kind === 'porter', 'a Stalker kept a combat unit as its target')
  commandMove(state, [stalker.id], flasher.x, flasher.y, true)
  for (let i = 0; i < 20; i++) step(state, 1 / 30)
  const moving = task()
  const focus = moving?.type === 'attackMove' && moving.focusKind === 'unit' ? unitById(state, moving.focusId ?? -1) : null
  const struck = moving?.type === 'attack' && moving.kind === 'unit' ? unitById(state, moving.targetId) : null
  assert(focus == null || focus.kind === 'porter', 'attack-move locked a Stalker onto a combat unit')
  assert(struck == null || struck.kind === 'porter', 'attack-move sent a Stalker after a combat unit')
  assert(flasher.hp === flasherHp && gorilla.hp === gorillaHp && hover.hp === hoverHp, 'attack-move let a Stalker damage a combat unit')
}

function speedTriplesTheMatch(): void {
  const state = createMatch(1)
  const rate = (): number => state.speed
  assert(rate() === 1, 'a match starts at triple speed')
  assert(!runCommand(state, 'speed'), 'a partial speed line was accepted')
  assert(rate() === 1, 'a partial line changed the speed')
  assert(runCommand(state, '  Speed x3  '), 'speed x3 was rejected')
  assert(rate() === 3, 'speed x3 did not triple the simulation')
  assert(state.toasts[state.toasts.length - 1]?.text === 'Speed x3 is on.', 'speed x3 did not announce itself')
  assert(runCommand(state, 'SPEED X3'), 'repeating speed x3 was rejected')
  assert(rate() === 3, 'repeating speed x3 turned it off')
  assert(state.toasts[state.toasts.length - 1]?.text === 'Speed x3 is already on.', 'the repeat used the wrong notice')
  const before = state.time
  step(state, 1)
  assert(Math.abs(state.time - (before + 1)) < 1e-6, 'speed x3 changed what one step means')
  assert(runCommand(state, 'Speed x3 Off'), 'speed x3 off was rejected')
  assert(rate() === 1, 'speed x3 off left the match sped up')
  assert(state.toasts[state.toasts.length - 1]?.text === 'Speed x3 is off.', 'speed x3 off did not announce itself')
  assert(runCommand(state, 'speed x3 off'), 'speed x3 off was rejected while already off')
  assert(rate() === 1, 'the off command turned triple speed on')
  assert(state.toasts[state.toasts.length - 1]?.text === 'Speed x3 is already off.', 'the off notice was wrong')
}

function freedomKillsEveryUnit(): void {
  const state = createMatch(4)
  const buildings = state.buildings.map((building) => building.id)
  const stalkers = state.units.filter((unit) => unit.kind === 'porter')
  assert(stalkers.length > 0, 'the map has no Stalkers')
  makeUnit(state, 1, 'pike', 18.5 * TILE, 18.5 * TILE)
  state.selectedUnits = state.units.filter((unit) => unit.owner === 0).map((unit) => unit.id)
  const graves = state.graves.length
  assert(runCommand(state, '  Freedom  '), 'freedom was rejected')
  assert(state.units.length === 0, 'freedom left a unit on the map')
  assert(state.selectedUnits.length === 0, 'freedom kept a selected unit')
  assert(state.buildings.every((building) => buildings.includes(building.id)), 'freedom removed a building')
  assert(state.graves.length === graves, 'freedom left a grave')
  assert(state.supplyUsed.every((used) => used === 0), 'freedom kept Cells reserved for a dead unit')
  assert(state.toasts[state.toasts.length - 1]?.text === 'All units are dead.', 'freedom did not announce itself')
  step(state, 2)
  assert(state.graves.length === graves, 'a later step built graves for the units freedom killed')
  assert(runCommand(state, 'freedom'), 'freedom was rejected on an empty map')
  assert(state.toasts[state.toasts.length - 1]?.text === 'No units left.', 'an empty map used the wrong notice')
  assert(!runCommand(state, 'free'), 'a partial freedom line was accepted')
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
  const homeHp = home.hp
  const foeHp = foe.hp
  const fighter = makeUnit(state, 0, 'pike', worker.x + 8, worker.y + 18)
  commandAttack(state, [foe.id], worker.id, 'unit')
  commandAttack(state, [fighter.id], foe.id, 'unit')
  commandAttack(state, [sieger.id], home.id, 'building')
  for (let i = 0; i < 5 * 60; i++) step(state, 1 / 60)
  const workerNow = unitById(state, worker.id)
  const homeNow = state.buildings.find((building) => building.id === home.id)
  const foeNow = unitById(state, foe.id)
  assert(workerNow && stalkerUntouched(workerNow), 'a Northmark worker took damage in God Mode')
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
  assert(homePoint, 'missing the Silo the Gorilla should guard')
  assert(
    tankOrder?.type === 'attackMove' || tankOrder?.type === 'attack',
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

function ordered(state: MatchState, owner: number): boolean {
  return state.units.some((unit) => unit.owner === owner && unit.hp > 0 && unit.order != null)
}

function clearOrders(state: MatchState): void {
  for (const unit of state.units) unit.order = null
}

function doubleGameCommand(): void {
  const state = createMatch(11)
  assert(!state.doubleGame && Number(state.control) === 0, 'a match starts in double game')
  assert(!runCommand(state, 'double'), 'a partial line turned double game on')
  assert(!state.doubleGame, 'a partial line changed double game')
  assert(!runCommand(state, 'double game on'), 'an unknown double game line was accepted')
  assert(!state.doubleGame, 'an unknown line turned double game on')
  assert(runCommand(state, 'double game'), 'double game was rejected')
  assert(state.doubleGame && Number(state.control) === 0, 'double game did not start on Silo 01')
  assert(state.toasts[state.toasts.length - 1]?.text === 'Double game is on. Tab changes side.', 'double game did not announce itself')
  assert(runCommand(state, 'double game'), 'repeating double game was rejected')
  assert(state.doubleGame, 'repeating double game turned it off')
  assert(state.toasts[state.toasts.length - 1]?.text === 'Double game is already on.', 'the repeat used the wrong notice')

  const home = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  const foe = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(home && foe, 'missing silos')
  assert(viewTileVisible(state, home.tx + 1, home.ty + 1), 'Silo 01 went dark under double game')
  assert(!viewTileVisible(state, foe.tx + 1, foe.ty + 1), 'Silo 02 was visible before switching')
  state.selectedUnits = state.units.filter((unit) => unit.owner === 0).map((unit) => unit.id)
  state.placement = 'yard'
  cycleSide(state)
  assert(Number(state.control) === 1, 'the side did not move to Silo 02')
  assert(state.selectedUnits.length === 0 && state.placement == null, 'switching sides kept the previous hands')
  assert(viewTileVisible(state, foe.tx + 1, foe.ty + 1), 'Silo 02 stayed dark while controlled')
  assert(!viewTileVisible(state, home.tx + 1, home.ty + 1), 'Silo 01 stayed lit after leaving it')
  assert(describeSelection(state).includes(PLAYER_NAME[1] ?? 'Silo 02'), 'the panel did not name the controlled side')
  assert(!ordered(state, 1), 'Silo 02 started with orders')
  updateSiloAi(state, 0.5)
  assert(!ordered(state, 1), 'SiloAI ordered the controlled side')

  assert(runCommand(state, 'all cams'), 'all cams was rejected during double game')
  assert(state.bothCam && state.doubleGame && Number(state.control) === 1, 'all cams cleared double game')
  assert(
    viewTileVisible(state, home.tx + 1, home.ty + 1) && viewTileVisible(state, foe.tx + 1, foe.ty + 1),
    'all cams did not merge sight during double game',
  )
  assert(runCommand(state, 'all cams off'), 'all cams off was rejected')
  assert(!state.bothCam && state.doubleGame, 'all cams off cleared double game')

  assert(runCommand(state, 'show enemy cam'), 'enemy cam was rejected during double game')
  assert(state.enemyCam && Number(state.control) === 1 && state.doubleGame, 'enemy cam changed double game')
  assert(!viewTileVisible(state, home.tx + 1, home.ty + 1), 'enemy cam showed Silo 01')
  assert(viewTileVisible(state, foe.tx + 1, foe.ty + 1), 'enemy cam hid a side other than Silo 01')
  assert(runCommand(state, 'off enemy cam'), 'off enemy cam was rejected')

  assert(runCommand(state, 'siloai'), 'siloai was rejected during double game')
  assert(state.aiControl && state.doubleGame, 'siloai cleared double game')
  clearOrders(state)
  updateSiloAi(state, 0.5)
  assert(ordered(state, 0), 'SiloAI did not play Silo 01 while another side was controlled')
  assert(!ordered(state, 1), 'SiloAI ordered the side under the player')

  takeSide(state, 0)
  assert(Number(state.control) === 0, 'the switcher did not return to Silo 01')
  clearOrders(state)
  updateSiloAi(state, 0.5)
  assert(!ordered(state, 0), 'SiloAI ordered Silo 01 while it was controlled')
  assert(ordered(state, 1), 'SiloAI stayed suspended after leaving Silo 02')

  assert(runCommand(state, 'double game off'), 'double game off was rejected')
  assert(!state.doubleGame && Number(state.control) === 0, 'double game off did not return to Silo 01')
  assert(state.aiControl, 'double game off cleared siloai')
  assert(state.toasts[state.toasts.length - 1]?.text === 'Double game is off.', 'double game off used the wrong notice')
  clearOrders(state)
  updateSiloAi(state, 0.5)
  assert(ordered(state, 1), 'Silo 02 stayed suspended after double game off')
  assert(ordered(state, 0), 'siloai did not resume Silo 01 after double game off')
  assert(runCommand(state, 'double game off'), 'double game off was rejected while already off')
  assert(!state.doubleGame, 'the off command turned double game on')
  assert(state.toasts[state.toasts.length - 1]?.text === 'Double game is already off.', 'the off repeat used the wrong notice')

  const ffa = createMatch(12, 'ffa')
  assert(runCommand(ffa, 'double game'), 'double game was rejected in a free-for-all')
  cycleSide(ffa)
  cycleSide(ffa)
  cycleSide(ffa)
  assert(Number(ffa.control) === 3, 'cycle did not walk every seated side')
  cycleSide(ffa)
  assert(Number(ffa.control) === 0, 'cycle did not wrap to Silo 01')
  assert(runCommand(ffa, 'off fow'), 'off fow was rejected during double game')
  cycleSide(ffa)
  cycleSide(ffa)
  assert(Number(ffa.control) === 2 && ffa.doubleGame && ffa.fogCleared, 'off fow cleared double game')
  assert(viewTileVisible(ffa, 0, 0), 'off fow followed the controlled side into fog')
  const seat = ffa.buildings.find((building) => building.owner === 2 && building.kind === 'keep')
  assert(seat && viewTileVisible(ffa, seat.tx + 1, seat.ty + 1), 'the controlled Silo stayed dark with fog off')
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
doubleGameCommand()
freedomKillsEveryUnit()
speedTriplesTheMatch()
wildlifeStaysAmbient()
stalkerDoesNotAttackCombatUnits()
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
endOfMatchStats()
replayRepeatsTheMatch()
replayCarriesSpeed()
replayShowsRecordedStats()
powerDebrisAndBatteries()
cryoPreservesStalkers()
cryoButtonSendsTheHealthiest()
siloCryoButtonsFollowTheVessels()
siloAiUsesHoverGrid()
siloAiBuysCryoFor250()
siloAiBanksHovers()
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
eightPlayerFieldPlacesEightSilos()
aisAttackEachOther()
eliminatingASideRemovesIt()
groundUnitsNeverOverlapSolidGround()
diagonalMovesCannotSqueeze()
towerFitsInsideCastleSightAndShoots()
pillarsLeaveTwoEmptyCells()
hoversGridAcrossTheMap()
gridCloakHidesHovers()
scannerEndsHoverCloak()
towerFiresOutToItsSight()
workersMineCastleMineralsThenTheNearestPatch()
captureHarvestAndPassages()
siloAiRaisesStorageAtRemoteDumps()
siloAiWidensNarrowPassages()
siloAiStoresAtNewDumpsWhileHomeRemains()
siloAiAimsGorillasAtBuildings()
siloAiFightsStructuresBeforeStalkers()
humanPlacementIgnoresAiGap()
siloAiAttacksInWaves()
combatUnitsGuardWhileTheWaveGathers()
siloAiLeavesUnfinishedStorageExposed()
pillarCapturesAnUncoveredStalker()
siloAiPillarsWatchMinesAndAvoidEnemyPillars()
siloAiRefusesUnchartedGround()
ruinedSiloCanBeRepaired()
siloAiDefendsItsSilo()
siloAiKeepsStalkersWorking()
cellsBlockTrainingUntilStorage()
fullStorageRefusesAHaul()
console.log('smoke ok')

function captureHarvestAndPassages(): void {
  assert(TREE_HP === 6 && ROCK_HP === 28, `tree life is ${TREE_HP}, rock life is ${ROCK_HP}`)
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
  assert(taken?.owner === 0 && stalkerUntouched(taken), `uncovered stalker was not captured (${taken?.owner}, ${taken?.hp})`)
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
  assert(still?.owner === 1 && stalkerUntouched(still), `a covered stalker changed (${still?.owner}, ${still?.hp})`)

  const far = createMatch(4)
  clearPad(far, 36, 20, 46, 32)
  rebuildBlocked(far)
  const lone = makeUnit(far, 1, 'porter', 40.5 * TILE, 24.5 * TILE)
  makeUnit(far, 1, 'pike', lone.x + 40, lone.y)
  const foe = makeUnit(far, 0, 'pike', lone.x - 18, lone.y)
  commandAttack(far, [foe.id], lone.id, 'unit')
  for (let i = 0; i < 40; i++) step(far, 1 / 60)
  const safe = unitById(far, lone.id)
  assert(safe?.owner === 1 && stalkerUntouched(safe), 'a friendly flasher did not keep the stalker')

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
    shelteredStill?.owner === 1 && stalkerUntouched(shelteredStill),
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
    risingTaken?.owner === 0 && stalkerUntouched(risingTaken),
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
    aiKept?.owner === 0 && stalkerUntouched(aiKept),
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

function eightPlayerFieldPlacesEightSilos(): void {
  assert(PLAYER_NAME[0] === 'Silo 01' && PLAYER_NAME[7] === 'Silo 08', 'side names do not reach Silo 08')
  assert(PLAYER_COLOR.length >= 8 && new Set(PLAYER_COLOR.slice(0, 8)).size === 8, 'the eight team colors are not distinct')
  const duel = createMatch(2, 'duel')
  assert(duel.mode === 'duel' && duel.mapW === 80 && duel.mapH === 40 && duel.playerCount === 2, '1 vs 1 changed size')
  const four = createMatch(2, 'ffa')
  assert(four.mode === 'ffa' && four.mapW === 90 && four.mapH === 50 && four.playerCount === 4, '4-player free-for-all changed size')
  const quota = animalCounts(FFA8_MAP_W, FFA8_MAP_H)
  assert(quota.crow > CROW_COUNT, 'crows did not grow with the 100×100 field')

  for (const seed of [2, 7]) {
    const state = createMatch(seed, 'ffa8')
    assert(state.mode === 'ffa8' && state.mapW === FFA8_MAP_W && state.mapH === FFA8_MAP_H, `8-player map is ${state.mapW}×${state.mapH}`)
    assert(state.playerCount === 8 && state.tiles.length === FFA8_MAP_W * FFA8_MAP_H, 'the 8-player map did not seat eight sides on 100×100')
    assert(state.sideExplored.length === 8 && state.sideVisible.length === 8 && state.oreHeld.length === 8, 'a side is missing fog or a bank')
    const keeps = state.buildings.filter((building) => building.kind === 'keep' && building.hp > 0)
    assert(keeps.length === 8, `expected 8 Silos, saw ${keeps.length}`)
    assert(new Set(keeps.map((keep) => keep.owner)).size === 8, 'two Silos share a side')
    const gaps = narrowPassageCount(state.tiles, state.ore, state.mapW, state.mapH)
    assert(gaps === 0, `8-player seed ${seed} left ${gaps} one-tile passages`)
    const frame = minimapFrame(180, 140, state.mapW, state.mapH)
    assert(Math.abs(frame.w - frame.h) < 0.01, 'the square field does not fit a square minimap')
    let corners = 0
    let edges = 0
    let minD = Infinity
    const onEdge = (value: number) => value < 20 || value > 80
    for (let i = 0; i < keeps.length; i++) {
      const keep = keeps[i]
      if (!keep) continue
      const ex = onEdge(keep.tx)
      const ey = onEdge(keep.ty)
      if (ex && ey) corners += 1
      else if (ex || ey) edges += 1
      else assert(false, `Silo ${keep.owner} is not on the ring (${keep.tx}, ${keep.ty})`)
      for (let j = i + 1; j < keeps.length; j++) {
        const other = keeps[j]
        if (!other) continue
        minD = Math.min(minD, Math.hypot(keep.tx + 1.5 - (other.tx + 1.5), keep.ty + 1.5 - (other.ty + 1.5)))
        const yards = { x0: keep.tx - 9, y0: keep.ty - 9, x1: keep.tx + 2 + 9, y1: keep.ty + 2 + 9 }
        const box = { x0: other.tx - 9, y0: other.ty - 9, x1: other.tx + 2 + 9, y1: other.ty + 2 + 9 }
        const overlap = yards.x0 <= box.x1 && box.x0 <= yards.x1 && yards.y0 <= box.y1 && box.y0 <= yards.y1
        assert(!overlap, `seed ${seed} Silo yards overlap`)
      }
      const sight = BUILDING_STATS.keep.sight / TILE
      const near = state.ore.filter(
        (node) => Math.hypot(node.tx + 0.5 - (keep.tx + 1.5), node.ty + 0.5 - (keep.ty + 1.5)) <= sight + 1,
      )
      assert(near.length >= 4, `Silo ${keep.owner} has only ${near.length} dumps nearby`)
      const workers = state.units.filter((unit) => unit.owner === keep.owner && unit.kind === 'porter' && unit.hp > 0)
      assert(workers.length === 4, `side ${keep.owner} did not start with four stalkers`)
      assert(state.oreHeld[keep.owner] === STARTING_ORE, `side ${keep.owner} did not start with the usual dumps`)
      assert(sideTileVisible(state, keep.owner, keep.tx + 1, keep.ty + 1), `side ${keep.owner} cannot see its own Silo`)
      assert(PLAYER_NAME[keep.owner]?.startsWith('Silo '), `side ${keep.owner} has no Silo tag`)
    }
    assert(corners === 4 && edges === 4, `Silos are ${corners} corners and ${edges} edges`)
    assert(minD > 40, `Silos are only ${minD.toFixed(1)} tiles apart`)
    assert(state.rocks.length > duel.rocks.length * 2, 'rocks and trees did not scale with the 100×100 field')
    assert(state.ore.length > four.ore.length, 'the 100×100 field has fewer dumps than the 4-player map')
    const crows = state.animals.filter((animal) => animal.kind === 'crow').length
    assert(state.animals.length === quota.crow && crows === quota.crow, `crows are ${crows} of ${state.animals.length}`)
  }

  const state = createMatch(4, 'ffa8')
  const home = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep' && building.hp > 0)
  const far = state.buildings.find((building) => building.owner === 7 && building.kind === 'keep' && building.hp > 0)
  assert(home && far, 'missing Silo 01 or Silo 08')
  assert(viewTileVisible(state, home.tx + 1, home.ty + 1), 'Silo 01 starts outside its own sight')
  assert(!viewTileVisible(state, far.tx + 1, far.ty + 1), 'Silo 08 is visible to Silo 01 at the start')
  assert(runCommand(state, 'all cams'), 'all cams was rejected on the 8-player map')
  for (const keep of state.buildings) {
    if (keep.kind !== 'keep' || keep.hp <= 0) continue
    assert(viewTileVisible(state, keep.tx + 1, keep.ty + 1), `all cams hid ${PLAYER_NAME[keep.owner]}`)
  }
  assert(runCommand(state, 'all cams off'), 'all cams off was rejected')
  assert(runCommand(state, 'double game'), 'double game was rejected on the 8-player map')
  state.selectedUnits = [1]
  for (let step = 0; step < 7; step++) cycleSide(state)
  assert(Number(state.control) === 7 && state.selectedUnits.length === 0, 'double game did not reach Silo 08')
  assert(viewTileVisible(state, far.tx + 1, far.ty + 1), 'Silo 08 stayed dark while controlled')
  assert(!viewTileVisible(state, home.tx + 1, home.ty + 1), 'Silo 01 stayed lit after leaving it')
  state.selectedBuilding = far.id
  assert(describeSelection(state).includes('Silo 08'), 'the Silo tag did not follow the controlled side')
  cycleSide(state)
  assert(Number(state.control) === 0, 'double game did not wrap after Silo 08')
  assert(runCommand(state, 'double game off') && !state.doubleGame, 'double game off failed')

  const victim = state.buildings.find((building) => building.owner === 7 && building.kind === 'keep' && building.hp > 0)
  assert(victim, 'missing Silo 08 for capture')
  const ids = state.units.filter((unit) => unit.owner === 7 && unit.hp > 0).map((unit) => unit.id)
  const victimOre = state.oreHeld[7] ?? 0
  const captorOre = state.oreHeld[3] ?? 0
  victim.hp = 6
  const fallenCenter = buildingCenter(victim)
  const killer = makeUnit(state, 3, 'pike', fallenCenter.x, fallenCenter.y + 70)
  commandAttack(state, [killer.id], victim.id, 'building')
  for (let i = 0; i < 90; i++) {
    step(state, 1 / 60)
    if (state.eliminated[7]) break
  }
  assert(state.eliminated[7], 'destroying a Silo did not eliminate that side in the 8-player match')
  assert(state.outcome == null, 'one capture ended the 8-player match')
  for (const id of ids) assert(unitById(state, id)?.owner === 3, 'a captured unit did not join Silo 04')
  assert(state.oreHeld[3] === captorOre + victimOre, `dumps moved to ${state.oreHeld[3]}, expected ${captorOre + victimOre}`)
  assert(state.oreHeld[7] === 0, 'Silo 08 kept dumps')
  assert(
    state.buildings.filter((building) => building.kind === 'keep' && building.hp > 0).length === 7,
    'every other Silo fell with the first capture',
  )
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
    assert(state.mapW === 90 && state.mapH === 50, `free for all map is ${state.mapW}×${state.mapH}`)
    assert(state.playerCount === 4 && state.mode === 'ffa', 'free for all did not seat four sides')
    assert(state.tiles.length === 90 * 50, 'the free-for-all map did not fill 90×50 cells')
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
    assert(tree && tree.hp === TREE_HP, 'a free-for-all tree does not have 6 life')
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
  assert(storageFill(SUPPLY_MAX) === 1, 'the Cells maximum does not fill Storage')
  const middle = storageFill((first + SUPPLY_MAX) / 2)
  assert(middle > 0.4 && middle < 0.6, `a middle Cells cap filled Storage by ${middle}`)
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
  assert(UNIT_STATS.drone.cost === 50, `hover cost is ${UNIT_STATS.drone.cost}, not 50 dumps`)
  assert(UNIT_STATS.drone.supply === 0, 'hover still uses store cells')
  assert(
    UNIT_STATS.drone.blurb.includes('50 dumps'),
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
  state.oreHeld[0] = 50
  assert(tryTrain(state, yard.id, 'drone') === null, 'a full store cells bar refused a hover')
  assert(state.oreHeld[0] === 0, 'hover was not charged 50 dumps')
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
function pillarsLeaveTwoEmptyCells(): void {
  const state = createMatch(3)
  state.oreHeld[0] = 2000
  const keep = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep' && building.hp > 0)
  assert(keep, 'missing a Silo for Pillar spacing')
  const tx = keep.tx
  const span = 6
  let ty = keep.ty + BUILDING_STATS.keep.h + 1
  if (ty + span >= state.mapH) ty = keep.ty - span
  assert(ty >= 1 && tx + 4 < state.mapW, 'the Silo sits too close to the map edge for the spacing pad')
  clearPad(state, tx - 1, ty - 1, tx + 6, ty + span)
  rebuildBlocked(state)
  assert(PILLAR_GAP === 2, 'Pillar spacing is not two empty cells')
  for (const [x, y] of [
    [tx, ty],
    [tx + 1, ty],
    [tx + 2, ty],
    [tx + 3, ty],
    [tx + 2, ty + 2],
    [tx, ty + 1],
    [tx + 1, ty + 1],
  ] as const) {
    assert(canPlace(state, 'tower', x, y), `spacing pad is blocked at ${x},${y}`)
    assert(placementAllowed(state, 0, 'tower', x, y), `spacing pad left Silo sight at ${x},${y}`)
  }
  const first = tryPlace(state, 0, 'tower', tx, ty, [])
  assert(first === null, first ?? 'the first Pillar was refused')
  const touching = tryPlace(state, 0, 'tower', tx + 1, ty, [])
  assert(touching === 'Leave two empty cells between Pillars', touching ?? 'a touching Pillar was accepted')
  const one = tryPlace(state, 0, 'tower', tx + 2, ty, [])
  assert(one === 'Leave two empty cells between Pillars', one ?? 'one empty cell was enough')
  assert(!placementAllowed(state, 0, 'tower', tx + 2, ty + 2), 'one empty cell on the diagonal was allowed')
  assert(placementAllowed(state, 0, 'tower', tx + 3, ty), 'two empty cells were refused in the preview')
  const second = tryPlace(state, 0, 'tower', tx + 3, ty, [])
  assert(second === null, second ?? 'two empty cells were refused')
  assert(placementAllowed(state, 0, 'silo', tx, ty + 1), 'a Storage was held to the Pillar gap')
  assert(
    BUILDING_STATS.tower.blurb.includes('Leave two empty cells between Pillars'),
    'the Pillar tooltip omits the gap',
  )
}

function minAssignmentCost(cost: number[][]): number {
  const n = cost.length
  const used = new Array<boolean>(n).fill(false)
  let best = Infinity
  const walk = (row: number, sum: number): void => {
    if (sum >= best) return
    if (row === n) {
      best = sum
      return
    }
    for (let col = 0; col < n; col++) {
      if (used[col]) continue
      used[col] = true
      walk(row + 1, sum + cost[row][col])
      used[col] = false
    }
  }
  walk(0, 0)
  return best
}

function hoversGridAcrossTheMap(): void {
  const short = createMatch(5)
  const few: Unit[] = []
  for (let i = 0; i < 9; i++) few.push(makeUnit(short, 0, 'drone', 2400, 180 + i * 28))
  const porter = makeUnit(short, 0, 'porter', 2300, 200)
  const enemy = makeUnit(short, 1, 'drone', 2200, 200)
  const dead = makeUnit(short, 0, 'drone', 2100, 200)
  dead.hp = 0
  short.selectedUnits = [...few.map((unit) => unit.id), porter.id, enemy.id, dead.id]
  assert(playerHovers(short, short.selectedUnits).length === 9, 'dead and enemy Hovers counted toward Grid')
  commandHoverGrid(short, short.selectedUnits)
  assert(few.every((unit) => unit.order == null), 'nine Hovers were given a grid')
  assert(porter.order == null && enemy.order == null, 'Grid ordered a unit that is not a player Hover')

  const state = createMatch(5)
  assert(state.mapW === MAP_W && state.mapH === MAP_H, 'the grid check left the duel map')
  const hovers: Unit[] = []
  for (let i = 0; i < 10; i++) {
    const hover = makeUnit(state, 0, 'drone', 2480, 160 + i * 24)
    hover.scanning = true
    hovers.push(hover)
  }
  const extra = makeUnit(state, 0, 'porter', 2300, 220)
  const foe = makeUnit(state, 1, 'drone', 2000, 220)
  state.selectedUnits = [...hovers.map((unit) => unit.id), extra.id, foe.id]
  assert(playerHovers(state, state.selectedUnits).length === 10, 'ten living player Hovers were not the grid count')
  const spots = hoverGridSpots(state.mapW, state.mapH, 10)
  const expectedX = [256, 768, 1280, 1792, 2304]
  const expectedY = [320, 960]
  assert(spots.length === 10, 'ten Hovers did not get ten cells')
  const seen = new Set(spots.map((spot) => `${spot.x},${spot.y}`))
  assert(seen.size === 10, 'grid cells overlapped')
  for (const spot of spots) {
    assert(expectedX.includes(spot.x) && expectedY.includes(spot.y), `cell ${spot.x},${spot.y} is not a 5×2 center`)
  }
  commandHoverGrid(state, state.selectedUnits)
  const task = (unit: Unit): Unit['order'] => unit.order
  const cost = hovers.map((unit) => spots.map((spot) => (spot.x - unit.x) ** 2 + (spot.y - unit.y) ** 2))
  let travel = 0
  const usedSpots = new Set<string>()
  for (const hover of hovers) {
    const order = task(hover)
    assert(order?.type === 'move', 'a Hover was not ordered to fly')
    if (order?.type !== 'move') continue
    const key = `${order.x},${order.y}`
    assert(seen.has(key), `order ${key} missed the grid`)
    assert(!usedSpots.has(key), 'two Hovers share a cell')
    usedSpots.add(key)
    travel += (order.x - hover.x) ** 2 + (order.y - hover.y) ** 2
    assert(hover.scanning === false, 'Grid left a Hover scanning')
    assert(hover.goalX === order.x && hover.goalY === order.y, 'the flight target left the cell center')
  }
  assert(usedSpots.size === 10, 'a grid cell was left empty')
  assert(travel === minAssignmentCost(cost), 'the grid did not minimize travel')
  assert(task(extra) == null && task(foe) == null, 'Grid moved a unit that is not a selected player Hover')

  for (let tick = 0; tick < 30; tick++) step(state, 1)
  for (const hover of hovers) {
    const order = task(hover)
    assert(order == null, 'a Hover kept its order after arriving')
    assert(hover.scanning === false, 'a Hover resumed scanning')
    const home = spots.find((spot) => Math.hypot(spot.x - hover.x, spot.y - hover.y) <= 3.5)
    assert(home, `a Hover stopped at ${hover.x},${hover.y} instead of its cell`)
  }
  const parked = hovers.map((hover) => ({ x: hover.x, y: hover.y }))
  for (let tick = 0; tick < 5; tick++) step(state, 1)
  hovers.forEach((hover, index) => {
    assert(task(hover) == null, 'a parked Hover took a new order')
    assert(hover.x === parked[index].x && hover.y === parked[index].y, 'a parked Hover left its cell')
  })

  const wide = createMatch(6)
  const eleven: Unit[] = []
  for (let i = 0; i < 11; i++) eleven.push(makeUnit(wide, 0, 'drone', 400 + i * 20, 200))
  commandHoverGrid(wide, eleven.map((unit) => unit.id))
  const odd = hoverGridSpots(wide.mapW, wide.mapH, 11)
  assert(odd.length === 11, 'eleven Hovers did not fill a short last row')
  const tail = odd[10]
  assert(tail.x === (wide.mapW * TILE) / 2, 'the leftover Hover was not centered on the last row')
  assert(Math.abs(tail.y - 2.5 * ((wide.mapH * TILE) / 3)) < 1e-6, 'the last row is not the third band')
  const held = new Set(eleven.map((unit) => (unit.order?.type === 'move' ? `${unit.order.x},${unit.order.y}` : '')))
  assert(held.size === 11 && [...held].every((key) => odd.some((spot) => `${spot.x},${spot.y}` === key)), 'the short row was not assigned')

  wide.paused = true
  for (const hover of eleven) hover.order = null
  commandHoverGrid(wide, eleven.map((unit) => unit.id))
  assert(eleven.every((unit) => unit.order == null), 'Grid ran while the match was paused')
}

function gridCloakHidesHovers(): void {
  assert(GRID_CLOAK_SECONDS === 45, `Grid invisibility is ${GRID_CLOAK_SECONDS}s`)
  assert(
    loreBody('Hover').includes(`invisible for ${GRID_CLOAK_SECONDS} seconds`),
    'the Hover lore omits Grid invisibility',
  )
  assert(
    UNIT_STATS.drone.blurb.includes(`invisible for ${GRID_CLOAK_SECONDS} seconds`),
    'the Hover tooltip omits Grid invisibility',
  )

  const few = createMatch(9)
  few.eliminated[1] = true
  few.units = []
  const short: Unit[] = []
  for (let i = 0; i < 9; i++) short.push(makeUnit(few, 0, 'drone', 400 + i * 24, 400))
  commandHoverGrid(few, short.map((unit) => unit.id))
  assert(short.every((unit) => unit.cloak === 0), 'fewer than ten Hovers were hidden')

  const state = createMatch(11)
  state.eliminated[1] = true
  state.units = []
  const hovers: Unit[] = []
  for (let i = 0; i < 10; i++) hovers.push(makeUnit(state, 0, 'drone', 480 + i * 28, 420))
  const porter = makeUnit(state, 0, 'porter', 80, 80)
  const pike = makeUnit(state, 1, 'pike', hovers[0].x + 16, hovers[0].y)
  commandHoverGrid(state, [...hovers.map((unit) => unit.id), porter.id])
  assert(hovers.every((unit) => unit.cloak === GRID_CLOAK_SECONDS), 'Grid did not hide every Hover it sent')
  assert(porter.cloak === 0, 'Grid hid a unit that is not a Hover')
  state.selectedUnits = [hovers[0].id]
  assert(describeSelection(state).includes(`Invisible ${GRID_CLOAK_SECONDS}s`), 'the Hover panel omitted the cloak timer')
  assert(viewUnitSeen(state, hovers[0]), 'the owner could not see a hidden Hover')
  state.enemyCam = true
  assert(!viewUnitSeen(state, hovers[0]), 'enemy cam drew a hidden Hover')
  state.enemyCam = false

  const hp = hovers[0].hp
  commandAttack(state, [pike.id], hovers[0].id, 'unit')
  const task = (): Unit['order'] => pike.order
  assert(task() == null, 'an enemy was ordered onto a hidden Hover')
  step(state, 1)
  assert(hovers[0].hp === hp, 'a hidden Hover took damage')
  assert(task() == null, 'an enemy acquired a hidden Hover')

  state.paused = true
  step(state, 5)
  const left = (): number => hovers[0].cloak
  assert(left() === GRID_CLOAK_SECONDS - 1, 'the cloak timer moved while the match was paused')
  state.paused = false
  step(state, 10)
  assert(left() === GRID_CLOAK_SECONDS - 11, 'the cloak timer did not follow match time')
  commandHoverGrid(state, hovers.map((unit) => unit.id))
  assert(hovers.every((unit) => unit.cloak === GRID_CLOAK_SECONDS), 'pressing Grid again did not reset the timer')
  step(state, GRID_CLOAK_SECONDS)
  assert(hovers.every((unit) => unit.cloak === 0), 'a Hover stayed hidden after 45 seconds')
  hovers[0].x = pike.x + 16
  hovers[0].y = pike.y
  updateVision(state)
  state.enemyCam = true
  assert(viewUnitSeen(state, hovers[0]), 'a Hover stayed invisible to enemies after the timer ended')
  state.enemyCam = false
  commandAttack(state, [pike.id], hovers[0].id, 'unit')
  assert(task()?.type === 'attack', 'an enemy could not attack the Hover once it was visible')
}

function scannerEndsHoverCloak(): void {
  assert(
    loreBody('Hover').includes('scanning Hover reveals an invisible enemy Hover'),
    'the Hover lore omits the Scanner reveal',
  )
  assert(
    UNIT_STATS.drone.blurb.includes('scanning Hover reveals an invisible enemy Hover'),
    'the Hover tooltip omits the Scanner reveal',
  )

  const state = createMatch(12)
  state.eliminated[1] = true
  state.units = []
  const hidden = makeUnit(state, 0, 'drone', 800, 400)
  hidden.cloak = GRID_CLOAK_SECONDS
  const quiet = makeUnit(state, 1, 'drone', hidden.x + 40, hidden.y)
  step(state, 1)
  const cloak = (): number => hidden.cloak
  assert(cloak() === GRID_CLOAK_SECONDS - 1, 'a Hover that is not scanning removed the cloak')

  const friend = makeUnit(state, 0, 'drone', hidden.x + 30, hidden.y)
  friend.scanning = true
  step(state, 1)
  assert(cloak() === GRID_CLOAK_SECONDS - 2, 'a friendly scanner removed the cloak')

  quiet.x = hidden.x + UNIT_STATS.drone.sight + 8
  quiet.y = hidden.y
  quiet.scanning = true
  const outside = cloak()
  step(state, 1)
  assert(cloak() === outside - 1, 'a scanner outside sight removed the cloak')

  quiet.x = hidden.x + UNIT_STATS.drone.sight
  quiet.y = hidden.y
  step(state, 1)
  assert(cloak() === 0, 'a scanning Hover inside sight left the cloak on')
  quiet.x = hidden.x + UNIT_STATS.drone.sight + 80
  step(state, 1)
  assert(cloak() === 0, 'the cloak returned after the scanner left')

  hidden.cloak = GRID_CLOAK_SECONDS
  quiet.scanning = false
  step(state, 1)
  assert(cloak() === GRID_CLOAK_SECONDS - 1, 'Scanner off still removed the cloak')
  quiet.scanning = true
  quiet.x = hidden.x + 20
  step(state, 1)
  assert(cloak() === 0, 'turning Scanner back on inside sight left the cloak on')

  friend.hp = 0
  quiet.x = 80
  quiet.y = 80
  const pike = makeUnit(state, 1, 'pike', hidden.x + 18, hidden.y)
  commandAttack(state, [pike.id], hidden.id, 'unit')
  const task = (): Unit['order'] => pike.order
  assert(task()?.type === 'attack', 'a revealed Hover could not be attacked')

  const ai = createMatch(13)
  ai.units = []
  const scout = makeUnit(ai, 1, 'drone', 900, 500)
  ai.aiAcc = 0
  updateSiloAi(ai, 0.5)
  assert(scout.scanning, 'SiloAI did not put its Hover in Scanner mode')
  const prey = makeUnit(ai, 0, 'drone', scout.x + 40, scout.y)
  prey.cloak = GRID_CLOAK_SECONDS
  ai.eliminated[1] = true
  step(ai, 1)
  assert(prey.cloak === 0, 'a SiloAI scanner left an enemy Hover hidden')
}

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
  assert(stalkerUntouched(behindRock), 'the Tower shot through a rock')
  assert(stalkerUntouched(behindTree), 'the Tower shot through a tree')
  assert(stalkerUntouched(hidden), 'the Tower shot an enemy outside its sight')
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
  assert(stalkerUntouched(hidden), 'the Tower fired into the fog after retargeting')

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

function focusOf(unit: Unit | undefined): { kind: string; id: number } | null {
  const order = unit?.order
  if (order?.type === 'attackMove' && order.focusKind != null && order.focusId != null) {
    return { kind: order.focusKind, id: order.focusId }
  }
  if (order?.type === 'attack') return { kind: order.kind, id: order.targetId }
  return null
}

/** Open ground far from every structure, with room for a Stalker, a Flasher, and a Factory. */
function engagementGround(state: MatchState): { tx: number; ty: number; x: number; y: number } {
  for (let ty = 8; ty < state.mapH - 8; ty++) {
    for (let tx = 8; tx < state.mapW - 8; tx++) {
      if (!isWalkable(state, tx, ty) || !isWalkable(state, tx + 2, ty) || !isWalkable(state, tx - 5, ty)) continue
      const x = (tx + 0.5) * TILE
      const y = (ty + 0.5) * TILE
      let clear = true
      for (const building of state.buildings) {
        if (building.hp <= 0) continue
        const center = buildingCenter(building)
        if (Math.hypot(center.x - x, center.y - y) < 420) clear = false
      }
      if (clear) return { tx, ty, x, y }
    }
  }
  throw new Error('no open ground for the engagement test')
}

function siloAiFightsStructuresBeforeStalkers(): void {
  assert(AGGRO_RANGE === 176, `engagement range is ${AGGRO_RANGE}`)
  const state = createMatch(43)
  state.aiAcc = -30
  const origin = engagementGround(state)
  const fighter = makeUnit(state, 1, 'pike', origin.x, origin.y)
  const stalker = makeUnit(state, 0, 'porter', (origin.tx + 2.5) * TILE, origin.y)
  const foe = makeUnit(state, 0, 'pike', (origin.tx - 4.5) * TILE, origin.y)
  assert(Math.hypot(foe.x - stalker.x, foe.y - stalker.y) > UNIT_STATS.pike.sight, 'the enemy Flasher covers the Stalker')
  const foeGap = Math.hypot(fighter.x - foe.x, fighter.y - foe.y)
  const stalkerGap = Math.hypot(fighter.x - stalker.x, fighter.y - stalker.y)
  assert(foeGap <= AGGRO_RANGE, 'the enemy Flasher is outside engagement range')
  assert(stalkerGap < foeGap, 'the Stalker was not the closer target')
  commandMove(state, [fighter.id], origin.x + 8, origin.y, true)
  step(state, 1 / 60)
  const combatFocus = focusOf(unitById(state, fighter.id))
  assert(
    combatFocus?.kind === 'unit' && combatFocus.id === foe.id,
    'SiloAI captured a Stalker while a Flasher was in engagement range',
  )

  foe.hp = 0
  const yard = makeBuilding(state, 0, 'yard', origin.tx + 1, origin.ty - 5, true)
  const stood = unitById(state, fighter.id)
  assert(stood, 'the Flasher vanished before the Factory check')
  const yardGap = Math.hypot(buildingCenter(yard).x - stood.x, buildingCenter(yard).y - stood.y)
  const stalkerNow = Math.hypot(stalker.x - stood.x, stalker.y - stood.y)
  assert(yardGap <= AGGRO_RANGE, 'the Factory is outside engagement range')
  assert(stalkerNow < yardGap, 'the Stalker was not closer than the Factory')
  stood.order = { type: 'attackMove', x: origin.x + 8, y: origin.y, focusId: null, focusKind: null }
  step(state, 1 / 60)
  const buildingFocus = focusOf(unitById(state, fighter.id))
  assert(
    buildingFocus?.kind === 'building' && buildingFocus.id === yard.id,
    'SiloAI captured a Stalker while a Factory was in engagement range',
  )

  yard.hp = 0
  const again = unitById(state, fighter.id)
  assert(again, 'the Flasher vanished before the Stalker check')
  again.order = { type: 'attackMove', x: origin.x + 8, y: origin.y, focusId: null, focusKind: null }
  step(state, 1 / 60)
  const stalkerFocus = focusOf(unitById(state, fighter.id))
  assert(
    stalkerFocus?.kind === 'unit' && stalkerFocus.id === stalker.id,
    'SiloAI ignored a Stalker once the engagement range was clear',
  )

  const human = createMatch(44)
  const spot = engagementGround(human)
  const player = makeUnit(human, 0, 'pike', spot.x, spot.y)
  const worker = makeUnit(human, 1, 'porter', (spot.tx + 2.5) * TILE, spot.y)
  makeUnit(human, 1, 'pike', (spot.tx - 4.5) * TILE, spot.y)
  commandMove(human, [player.id], spot.x + 8, spot.y, true)
  step(human, 1 / 60)
  const playerFocus = focusOf(unitById(human, player.id))
  assert(playerFocus?.kind === 'unit' && playerFocus.id === worker.id, 'a player attack-move skipped the closer Stalker')
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
    assert(now?.order?.type === 'attackMove' || now?.order?.type === 'attack', 'a short group stood idle')
    assert(!aimsAt(now, rally, 80), 'a short group stood at the rally')
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
  assert(held?.order?.type === 'attackMove' || held?.order?.type === 'attack', 'a new Flasher stood idle while the wave was out')
  for (const unit of wave) {
    assert(aimsAt(unitById(state, unit.id), foePoint, 120), 'the first wave turned back before it was wiped out')
  }

  for (const unit of wave.slice(1)) unit.hp = 0
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  const survivor = unitById(state, wave[0]?.id ?? -1)
  assert(survivor && survivor.hp > 0, 'the last fighter was removed')
  assert(!aimsAt(survivor, foePoint, 120), 'a wiped wave kept marching')
  assert(
    survivor.order?.type === 'attackMove' || survivor.order?.type === 'move' || survivor.order?.type === 'attack',
    'the survivor stood idle',
  )
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
  makeUnit(quiet, 1, 'porter', home.x, home.y + 36)
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
  assert(taken?.owner === 0 && stalkerUntouched(taken), `a Pillar did not capture the uncovered stalker (${taken?.owner}, ${taken?.hp})`)

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
  assert(safe?.owner === 1 && stalkerUntouched(safe), `a Pillar captured a Stalker inside finished Storage (${safe?.owner}, ${safe?.hp})`)
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
  const keepPoint = buildingCenter(keep)
  makeUnit(state, 1, 'porter', keepPoint.x, keepPoint.y + 36)
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

function combatUnitsGuardWhileTheWaveGathers(): void {
  const state = createMatch(5)
  state.time = 20
  const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  const foe = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep' && building.hp > 0)
  assert(keep && foe, 'missing a Silo for the guard patrol')
  const foePoint = buildingCenter(foe)
  state.aiSpotted.push({ id: foe.id, x: foePoint.x, y: foePoint.y })
  for (const unit of state.units) if (unit.owner === 0) unit.hp = 0
  state.oreHeld[1] = 0
  const rally = siloRallyPoint(state, 1)
  assert(rally, 'missing a rally for the waiting wave')
  const need = siloWaveNeed(state)
  const remote = { id: state.nextId++, tx: 40, ty: 22, amount: 420, base: null }
  state.ore.push(remote)
  const bin = makeBuilding(state, 1, 'silo', 44, 22, true)
  const binPoint = buildingCenter(bin)
  const miner = makeUnit(state, 1, 'porter', (remote.tx + 0.5) * TILE, (remote.ty + 0.5) * TILE)
  miner.order = { type: 'gather', nodeId: remote.id, phase: 'approach' }
  miner.nodeMemory = remote.id
  const waiting: Unit[] = [
    makeUnit(state, 1, 'howler', rally.x, rally.y),
    makeUnit(state, 1, 'pike', rally.x + 12, rally.y),
    makeUnit(state, 1, 'pike', rally.x - 12, rally.y),
  ]
  assert(waiting.length < need.count, 'the guard patrol already filled a wave')
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  assert(!state.aiAttacking, 'a short patrol marched as a wave')
  const orderedNearBin = waiting.some((unit) => {
    const order = unitById(state, unit.id)?.order
    if (order?.type !== 'attackMove' && order?.type !== 'move') return false
    return Math.hypot(order.x - binPoint.x, order.y - binPoint.y) < Math.hypot(order.x - rally.x, order.y - rally.y)
  })
  assert(orderedNearBin, 'no combat unit guarded the remote Storage')
  const idleFor = new Map<number, number>()
  for (let i = 0; i < 6 * 60; i++) {
    step(state, 1 / 60)
    assert(!state.aiAttacking, 'the waiting patrol launched a short wave')
    for (const unit of waiting) {
      const now = unitById(state, unit.id)
      assert(now && now.hp > 0, 'a waiting fighter died on patrol')
      const idle = now.order == null
      const acc = idle ? (idleFor.get(unit.id) ?? 0) + 1 / 60 : 0
      idleFor.set(unit.id, acc)
      assert(acc <= 1.5, `a combat unit stood idle for ${acc.toFixed(2)}s while the wave gathered`)
    }
  }
  const raider = makeUnit(state, 0, 'pike', binPoint.x + 20, binPoint.y)
  const tx = Math.floor(raider.x / TILE)
  const ty = Math.floor(raider.y / TILE)
  if (tx >= 0 && ty >= 0 && tx < state.mapW && ty < state.mapH) state.aiVisible[ty * state.mapW + tx] = 1
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  assert(!state.aiAttacking, 'answering a raider launched the wave')
  assert(
    waiting.some((unit) => attacksAttacker(unitById(state, unit.id), raider.id)),
    'no combat unit attacked the raider beside the Storage',
  )
}

function siloAiDefendsItsSilo(): void {
  const state = createMatch(5)
  state.time = 20
  const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  const foe = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep' && building.hp > 0)
  assert(keep && foe, 'missing a Silo for the defense')
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
    assert(now?.order?.type === 'attackMove' || now?.order?.type === 'move', 'the army stood idle after the attack')
    assert(!aimsAt(now, foePoint, 120), 'the army kept marching on the enemy Silo')
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

function cellsBlockTrainingUntilStorage(): void {
  assert(SUPPLY_MAX === 65, `Cells maximum is ${SUPPLY_MAX}`)
  assert(
    BUILDING_STATS.keep.supply + 11 * BUILDING_STATS.silo.supply > SUPPLY_MAX,
    'building supply does not exceed the Cells maximum',
  )
  assert(BUILDING_STATS.tower.hp === 160, `Pillar health is ${BUILDING_STATS.tower.hp}`)
  assert(BUILDING_STATS.tower.buildTime === 7, `Pillar build time is ${BUILDING_STATS.tower.buildTime}`)
  const state = createMatch(3)
  const silo = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(silo, 'missing a Silo for Cells')
  recomputeSupply(state)
  assert(state.supplyCap[0] === BUILDING_STATS.keep.supply, 'the Silo did not set the Cells cap')
  let guard = 0
  while (state.supplyUsed[0] < state.supplyCap[0] && guard++ < 80) {
    makeUnit(state, 0, 'pike', 40 + (guard % 20) * 8, 40 + Math.floor(guard / 20) * 8)
    recomputeSupply(state)
  }
  assert(state.supplyUsed[0] === state.supplyCap[0], 'Cells were not filled to the cap')
  state.oreHeld[0] = UNIT_STATS.porter.cost * 4
  const blocked = tryTrain(state, silo.id, 'porter')
  assert(blocked === 'Cells cap reached — raise a Storage', `training at the cap returned ${blocked}`)
  assert(!silo.queue.some((job) => job.kind === 'porter'), 'a Stalker was queued at the Cells cap')
  const before = state.supplyCap[0]
  makeBuilding(state, 0, 'silo', 20, 20, true)
  recomputeSupply(state)
  assert(state.supplyCap[0] === before + BUILDING_STATS.silo.supply, 'Storage did not raise Cells')
  assert(tryTrain(state, silo.id, 'porter') === null, 'Storage did not unblock training')
  assert(silo.queue.some((job) => job.kind === 'porter'), 'the Stalker was not queued after Storage')

  const packed = createMatch(4)
  const home = packed.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(home, 'missing a Silo for the Cells maximum')
  for (let i = 0; i < 11; i++) makeBuilding(packed, 0, 'silo', 8 + (i % 4) * 4, 8 + Math.floor(i / 4) * 4, true)
  recomputeSupply(packed)
  assert(packed.supplyCap[0] === SUPPLY_MAX, `Cells stopped at ${packed.supplyCap[0]}, not ${SUPPLY_MAX}`)
  guard = 0
  while (packed.supplyUsed[0] < SUPPLY_MAX && guard++ < 120) {
    makeUnit(packed, 0, 'pike', 48 + (guard % 20) * 8, 48)
    recomputeSupply(packed)
  }
  packed.oreHeld[0] = UNIT_STATS.porter.cost
  const still = tryTrain(packed, home.id, 'porter')
  assert(still === 'Cells cap reached — raise a Storage', `the maximum still allowed training (${still})`)
  makeBuilding(packed, 0, 'silo', 30, 16, true)
  recomputeSupply(packed)
  assert(packed.supplyCap[0] === SUPPLY_MAX, 'another Storage raised Cells past 65')
}

function fullStorageRefusesAHaul(): void {
  assert(STORAGE_CAP === 500, `Storage cap is ${STORAGE_CAP}`)
  const state = createMatch(4)
  state.aiAcc = -30
  for (let owner = 0; owner < state.playerCount; owner++) state.sideAcc[owner] = -30
  const keep = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(keep, 'missing a Silo for the overflow')
  clearPad(state, 14, 14, 40, 28)
  const full = makeBuilding(state, 0, 'silo', 18, 18, true)
  full.stock = STORAGE_CAP
  const open = makeBuilding(state, 0, 'silo', 18, 23, true)
  let emptyStock = 0
  open.stock = emptyStock
  rebuildBlocked(state)
  const worker = state.units.find((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  assert(worker, 'missing a Stalker to turn away')
  for (const unit of state.units) {
    if (unit.id === worker.id) continue
    unit.cargo = 0
    unit.order = { type: 'move', x: unit.x, y: unit.y }
    unit.path = []
    unit.goalX = unit.x
    unit.goalY = unit.y
  }
  worker.x = (full.tx + 1) * TILE
  worker.y = (full.ty + 2) * TILE + 8
  worker.cargo = GATHER_AMOUNT
  worker.order = { type: 'gather', nodeId: -1, phase: 'return' }
  const bank = state.oreHeld[0]
  step(state, 1 / 30)
  const turned = unitById(state, worker.id)
  const stillFull = full.stock
  const stillOpen = open.stock
  assert(stillFull === STORAGE_CAP, `a full Storage took dumps (${stillFull})`)
  assert(stillOpen === 0, `the open Storage was filled before the Stalker arrived (${stillOpen})`)
  assert(turned?.cargo === GATHER_AMOUNT, `the refused haul was dropped (${turned?.cargo})`)
  assert(state.oreHeld[0] === bank, `the bank took a refused haul (${state.oreHeld[0]})`)
  for (let i = 0; i < 180; i++) {
    step(state, 1 / 30)
    if ((unitById(state, worker.id)?.cargo ?? 1) === 0) break
  }
  const delivered = unitById(state, worker.id)
  assert(delivered?.cargo === 0, `the Stalker never reached another drop-off (${delivered?.cargo})`)
  const fullAfter = full.stock
  const openAfter = open.stock
  assert(fullAfter === STORAGE_CAP, 'the full Storage accepted the rerouted haul')
  assert(openAfter === GATHER_AMOUNT, `the open Storage received ${openAfter}`)
  assert(state.oreHeld[0] === bank + GATHER_AMOUNT, `the bank is ${state.oreHeld[0]}`)

  const overflow = createMatch(4)
  overflow.aiAcc = -30
  for (let owner = 0; owner < overflow.playerCount; owner++) overflow.sideAcc[owner] = -30
  const home = overflow.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(home, 'missing a Silo for the remainder')
  clearPad(overflow, 14, 14, 28, 24)
  const tight = makeBuilding(overflow, 0, 'silo', 18, 18, true)
  tight.stock = STORAGE_CAP - 3
  rebuildBlocked(overflow)
  const hauler = overflow.units.find((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  assert(hauler, 'missing a Stalker for the partial drop')
  for (const unit of overflow.units) {
    if (unit.id === hauler.id) continue
    unit.cargo = 0
    unit.order = { type: 'move', x: unit.x, y: unit.y }
    unit.path = []
    unit.goalX = unit.x
    unit.goalY = unit.y
  }
  hauler.x = (tight.tx + 1) * TILE
  hauler.y = (tight.ty + 2) * TILE + 8
  hauler.cargo = GATHER_AMOUNT
  hauler.order = { type: 'gather', nodeId: -1, phase: 'return' }
  const before = overflow.oreHeld[0]
  step(overflow, 1 / 30)
  assert(tight.stock === STORAGE_CAP, `the Storage stopped at ${tight.stock}`)
  assert(hauler.cargo === GATHER_AMOUNT - 3, `the Stalker did not keep the remainder (${hauler.cargo})`)
  assert(overflow.oreHeld[0] === before + 3, `the bank took ${overflow.oreHeld[0] - before}`)
  hauler.x = (home.tx + 1) * TILE
  hauler.y = (home.ty + 3) * TILE + 8
  hauler.order = { type: 'gather', nodeId: -1, phase: 'return' }
  hauler.path = []
  hauler.goalX = null
  hauler.goalY = null
  step(overflow, 1 / 30)
  assert(hauler.cargo === 0, `the Silo left ${hauler.cargo} on the Stalker`)
  assert(tight.stock === STORAGE_CAP, 'the remainder went back into the full Storage')
  assert(overflow.oreHeld[0] === before + GATHER_AMOUNT, `the Silo bank is ${overflow.oreHeld[0]}`)

  overflow.selectedBuilding = tight.id
  overflow.selectedUnits = []
  const fullPanel = describeSelection(overflow)
  assert(fullPanel.includes(`${STORAGE_CAP} / ${STORAGE_CAP}`), 'the panel does not show 500 / 500')
  assert(fullPanel.includes('Full'), 'a full Storage is not marked Full')
  tight.stock = 12
  const openPanel = describeSelection(overflow)
  assert(openPanel.includes(`12 / ${STORAGE_CAP}`), 'the panel does not show dumps out of 500')
  assert(!openPanel.includes('Full'), 'a Storage with room is marked Full')

  const raid = createMatch(3)
  raid.aiAcc = -30
  clearPad(raid, 24, 16, 40, 32)
  const enemyBin = makeBuilding(raid, 1, 'silo', 30, 22, true)
  enemyBin.stock = STORAGE_CAP
  raid.oreHeld[1] = 100
  rebuildBlocked(raid)
  const thief = raid.units.find((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  assert(thief, 'missing a raider')
  thief.x = (enemyBin.tx + 1) * TILE
  thief.y = (enemyBin.ty + 2) * TILE + 8
  thief.cargo = 0
  thief.order = null
  assert(commandHarvestOrAttack(raid, [thief.id], enemyBin.id), 'a full Storage could not be raided')
  for (let i = 0; i < 80; i++) {
    step(raid, 1 / 30)
    if ((unitById(raid, thief.id)?.cargo ?? 0) > 0) break
  }
  assert(unitById(raid, thief.id)?.cargo === GATHER_AMOUNT, 'raiding a full Storage took nothing')
  assert(enemyBin.stock === STORAGE_CAP - GATHER_AMOUNT, `the raid left ${enemyBin.stock}`)

  const spent = createMatch(2)
  clearPad(spent, 16, 16, 28, 28)
  const bin = makeBuilding(spent, 0, 'silo', 20, 20, true)
  bin.stock = STORAGE_CAP
  spent.oreHeld[0] = 200
  rebuildBlocked(spent)
  const silo = spent.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(silo, 'missing a Silo to spend from Storage')
  assert(tryTrain(spent, silo.id, 'porter') === null, 'spending from a full Storage failed')
  assert(bin.stock === STORAGE_CAP - UNIT_STATS.porter.cost, `spending left ${bin.stock}`)
  const builder = spent.units.find((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)
  assert(builder, 'missing a builder')
  assert(tryPlace(spent, 0, 'silo', 24, 20, [builder.id]) === null, 'a full Storage blocked a new one')
  assert(
    spent.buildings.some((building) => building.kind === 'silo' && building.id !== bin.id),
    'the new Storage was not started',
  )

  const field = createMatch(7)
  const aiKeep = field.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  assert(aiKeep, 'missing a Silo for the replacement Storage')
  const cx = 40
  const cy = 24
  const radius = 12
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= field.mapW || y >= field.mapH) continue
      field.tiles[y * field.mapW + x] = 0
    }
  }
  field.rocks = field.rocks.filter((rock) => Math.max(Math.abs(rock.tx - cx), Math.abs(rock.ty - cy)) > radius)
  for (const node of field.ore) {
    if (node.base === 1) node.amount = 0
    else if (Math.max(Math.abs(node.tx - cx), Math.abs(node.ty - cy)) <= radius + 4) node.amount = 0
  }
  const remote = { id: field.nextId++, tx: cx, ty: cy, amount: 420, base: null }
  field.ore.push(remote)
  chartDisk(field, 1, cx, cy, radius)
  const purseTx = aiKeep.tx < cx ? Math.max(1, aiKeep.tx - 6) : Math.min(field.mapW - 4, aiKeep.tx + 6)
  const purse = makeBuilding(field, 1, 'silo', purseTx, Math.max(1, aiKeep.ty - 4), true)
  purse.stock = STORAGE_CAP
  assert(
    footprintGap(purse.tx, purse.ty, BUILDING_STATS.silo.w, BUILDING_STATS.silo.h, remote.tx, remote.ty) > SILO_AI_EXPANSION_REACH,
    'the Cryo purse Storage sits close enough to the remote heap to count as its drop-off',
  )
  const filled = makeBuilding(field, 1, 'silo', cx + 5, cy, true)
  filled.stock = STORAGE_CAP
  const aiHome = buildingCenter(aiKeep)
  for (let i = 0; i < 3; i++) makeUnit(field, 1, 'porter', aiHome.x + i * 12, aiHome.y + 48)
  rebuildBlocked(field)
  field.oreHeld[1] = 500
  const beforeIds = new Set(field.buildings.map((building) => building.id))
  field.aiAcc = 0
  updateSiloAi(field, 0.5)
  const raised = field.buildings.find(
    (building) => building.owner === 1 && building.kind === 'silo' && !beforeIds.has(building.id),
  )
  assert(raised, 'SiloAI left the full Storage as the only drop-off')
  const gap = footprintGap(raised.tx, raised.ty, BUILDING_STATS.silo.w, BUILDING_STATS.silo.h, remote.tx, remote.ty)
  assert(
    gap >= AI_MINERAL_KEEP && gap <= SILO_AI_EXPANSION_REACH,
    `the replacement Storage is ${gap} tiles from the heap`,
  )
  assert(raised.id !== filled.id, 'SiloAI did not start a second Storage')
}

function openPad(state: MatchState, x0: number, y0: number, x1: number, y1: number): void {
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= state.mapW || ty >= state.mapH) continue
      state.tiles[ty * state.mapW + tx] = 0
    }
  }
  state.rocks = state.rocks.filter((rock) => rock.tx < x0 || rock.tx > x1 || rock.ty < y0 || rock.ty > y1)
  for (const node of state.ore) {
    if (node.tx >= x0 && node.tx <= x1 && node.ty >= y0 && node.ty <= y1) node.amount = 0
  }
  rebuildBlocked(state)
}

function cryoPreservesStalkers(): void {
  assert(CRYO_COST === 250, 'a Silo Cryo costs 250 dumps')
  assert(CRYO_FREEZE_COST === 50, 'freezing a Stalker costs 50 dumps')
  assert(CRYO_SLOTS === 4, 'a Silo Cryo holds 4 Stalkers')
  assert(CRYO_RECOVER === 240, 'a Cryo recovers for 4 minutes')
  assert(
    BUILDING_STATS.keep.blurb.includes('250') &&
      BUILDING_STATS.keep.blurb.includes('50') &&
      BUILDING_STATS.keep.blurb.includes('200') &&
      BUILDING_STATS.keep.blurb.includes('4 minutes') &&
      BUILDING_STATS.keep.blurb.includes('Defrost'),
    'the Silo tooltip lists the Cryo',
  )
  const lore = loreBody('Silo')
  assert(
    lore.includes('250') && lore.includes('50') && lore.includes('200') && lore.includes('4 minutes') && lore.includes('Defrost'),
    'Silo lore lists the Cryo',
  )
  assert(!('cryo' in BUILDING_STATS), 'Cryo is still a separate building')

  const state = createMatch(21)
  const cryo = state.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(cryo, 'Silo 01 has no Silo')
  const tx = cryo.tx
  const ty = cryo.ty
  openPad(state, tx - 2, ty - 2, tx + 5, ty + 6)
  rebuildBlocked(state)
  const doorX = (tx + 1.5) * TILE
  const doorY = (ty + 3) * TILE + 16
  assert(!cryo.cryo, 'a new Silo already had a Cryo')
  assert(!commandFreeze(state, state.units.filter((unit) => unit.owner === 0).map((unit) => unit.id), cryo.id), 'a Silo without a Cryo accepted Stalkers')
  state.oreHeld[0] = CRYO_COST
  assert(installCryo(state, cryo.id) === null, 'the Silo did not add a Cryo')
  assert(cryo.cryo, 'the Cryo button did not attach the vessels')
  assert(state.oreHeld[0] === 0, 'adding a Cryo did not cost 250 dumps')
  state.oreHeld[0] = CRYO_COST
  assert(installCryo(state, cryo.id) !== null, 'a Silo accepted a second Cryo')
  assert(state.oreHeld[0] === CRYO_COST, 'a second Cryo still charged dumps')
  const stalkers = state.units.filter((unit) => unit.owner === 0 && unit.kind === 'porter')
  assert(stalkers.length >= 4, 'the match starts with four Stalkers')
  const crew = stalkers.slice(0, 4)
  for (const unit of crew) {
    unit.x = doorX
    unit.y = doorY
    unit.order = null
    unit.cargo = 0
    unit.age = 12
  }
  const first = crew[0]
  assert(first, 'missing a Stalker')
  thawCryo(state, cryo.id)
  const recover = () => cryo.cryoRecover
  assert(recover() === 0, 'an empty thaw started a recovery')
  const rider = makeUnit(state, 0, 'pike', doorX + 80, doorY)
  assert(!commandFreeze(state, [rider.id], cryo.id), 'a Flasher was treated as a freeze order')
  rider.hp = 0
  const created = () => state.stats[0]?.created.porter ?? -1
  const lost = () => state.stats[0]?.lost.porter ?? -1
  const createdBefore = created()
  const lostBefore = lost()
  state.oreHeld[0] = 80
  assert(commandFreeze(state, [first.id], cryo.id), 'one Stalker was not refused')
  assert(first.order == null, 'one Stalker was sent to freeze')
  assert(
    state.toasts.some((toast) => toast.text === 'Select 4 Stalkers to freeze.'),
    'fewer than 4 Stalkers did not say so',
  )
  const mixed = makeUnit(state, 0, 'pike', doorX + 90, doorY)
  assert(commandFreeze(state, [...crew.map((unit) => unit.id), mixed.id], cryo.id), 'a mixed selection was not refused')
  assert(crew.every((unit) => unit.order == null), 'a mixed selection was sent to freeze')
  mixed.hp = 0

  state.oreHeld[0] = 40
  assert(commandFreeze(state, crew.map((unit) => unit.id), cryo.id), 'the group was not sent')
  step(state, 1 / 30)
  assert(crew.every((unit) => unit.frozen == null), 'the group froze without 200 dumps')
  assert(state.oreHeld[0] === 40, 'a refused group still charged dumps')
  assert(
    state.toasts.some((toast) => toast.text === 'Need 200 dumps to freeze.'),
    'a refused group did not say it needs 200 dumps',
  )

  const lagging = crew[3]
  assert(lagging, 'missing the fourth Stalker')
  lagging.x = doorX + 400
  lagging.y = doorY + 400
  state.oreHeld[0] = 200
  assert(commandFreeze(state, crew.map((unit) => unit.id), cryo.id), 'the group was not sent again')
  step(state, 1 / 30)
  assert(crew.every((unit) => unit.frozen == null), 'the group froze before all four arrived')
  lagging.x = doorX
  lagging.y = doorY
  step(state, 1 / 30)
  assert(crew.every((unit) => unit.frozen === cryo.id), 'the group did not freeze together')
  assert(state.oreHeld[0] === 0, 'the group did not cost 200 dumps')
  assert(created() === createdBefore, 'freezing counted as a new Stalker')
  assert(lost() === lostBefore, 'freezing counted as a loss')
  assert(crew.every((unit) => !viewUnitSeen(state, unit)), 'a frozen Stalker stayed visible')
  const frozenAge = first.age
  const frozenHp = first.hp
  step(state, 1)
  assert(first.age === frozenAge && first.hp === frozenHp, 'a frozen Stalker kept aging')

  state.selectedBuilding = cryo.id
  state.selectedUnits = []
  const panel = describeSelection(state)
  assert(panel.includes('4 / 4'), 'the Cryo panel hid the slot count')
  assert(panel.includes('50 dumps each'), 'the Cryo panel hid the freeze cost')
  assert(panel.includes('200 for the group'), 'the Cryo panel hid the group cost')
  assert(!panel.includes('shelter housing'), 'the Silo panel still showed its description')

  const foe = makeUnit(state, 1, 'pike', doorX, doorY)
  commandAttack(state, [foe.id], first.id, 'unit')
  step(state, 1)
  assert(first.hp === frozenHp && first.frozen === cryo.id, 'a frozen Stalker took a hit')

  thawCryo(state, cryo.id)
  assert(crew.every((unit) => unit.frozen == null && unit.nodeMemory === 0), 'thaw left a Stalker frozen')
  assert(recover() === CRYO_RECOVER, 'thaw did not start the recovery')
  const thawed = buildingRect(cryo)
  const stillInside = crew.some(
    (unit) => unit.x >= thawed.x && unit.x <= thawed.x + thawed.w && unit.y >= thawed.y && unit.y <= thawed.y + thawed.h,
  )
  assert(!stillInside, 'thaw left a Stalker inside the Cryo')
  const recovering = describeSelection(state)
  assert(recovering.includes('Recovery') && recovering.includes('4:00'), 'the panel hid a full recovery')
  step(state, 1)
  assert(recover() === CRYO_RECOVER - 1, 'recovery did not tick')
  assert(first.age > frozenAge, 'a thawed Stalker did not resume aging')
  const ticking = describeSelection(state)
  assert(ticking.includes('Recovery') && ticking.includes('3:59'), 'the panel hid the recovery countdown')

  for (const unit of crew) {
    unit.x = doorX
    unit.y = doorY
    unit.order = null
  }
  state.oreHeld[0] = 200
  assert(commandFreeze(state, crew.map((unit) => unit.id), cryo.id), 'a recovering Cryo ignored the order')
  assert(crew.every((unit) => unit.order == null), 'a recovering Cryo accepted Stalkers')
  assert(state.toasts.some((toast) => toast.text === 'Cryo is recovering.'), 'a recovering Cryo did not say so')

  cryo.cryoRecover = 0
  state.oreHeld[0] = 200
  commandFreeze(state, crew.map((unit) => unit.id), cryo.id)
  step(state, 1 / 30)
  assert(crew.every((unit) => unit.frozen === cryo.id), 'the group did not freeze after recovery')
  cryo.hp = 0
  const lostAtDestroy = lost()
  step(state, 1 / 30)
  assert(crew.every((unit) => unit.hp > 0 && unit.frozen == null), 'destroying the Cryo did not release the Stalkers')
  assert(lost() === lostAtDestroy, 'releasing a frozen Stalker counted as a loss')

  const packed = createMatch(23)
  const full = packed.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(full, 'Silo 01 has no Silo')
  full.cryo = true
  openPad(packed, full.tx - 2, full.ty - 2, full.tx + 5, full.ty + 6)
  rebuildBlocked(packed)
  const fillers = packed.units.filter((unit) => unit.owner === 0 && unit.kind === 'porter').slice(0, 4)
  assert(fillers.length === 4, 'need four Stalkers to fill a Cryo')
  const fullDoorX = (full.tx + 1.5) * TILE
  const fullDoorY = (full.ty + 3) * TILE + 16
  packed.oreHeld[0] = 200
  for (const unit of fillers) {
    unit.x = fullDoorX
    unit.y = fullDoorY
    unit.order = null
    unit.cargo = 0
  }
  commandFreeze(packed, fillers.map((unit) => unit.id), full.id)
  step(packed, 1 / 30)
  assert(fillers.every((unit) => unit.frozen === full.id), 'the Cryo did not take four Stalkers')
  assert(packed.oreHeld[0] === 0, 'the group did not cost 200 dumps')
  const extras = []
  for (let i = 0; i < 4; i++) {
    const extra = makeUnit(packed, 0, 'porter', fullDoorX, fullDoorY)
    extra.cargo = 0
    extras.push(extra)
  }
  packed.oreHeld[0] = 200
  commandFreeze(packed, extras.map((unit) => unit.id), full.id)
  step(packed, 1 / 30)
  assert(extras.every((unit) => unit.frozen == null && unit.order == null), 'a second group entered a full Cryo')
  assert(packed.oreHeld[0] === 200, 'a full Cryo still charged the freeze')
  assert(packed.toasts.some((toast) => toast.text === 'Cryo is full.'), 'a full Cryo did not say so')

  const dropped = createMatch(26)
  const bay = dropped.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(bay, 'Silo 01 has no Silo')
  bay.cryo = true
  openPad(dropped, bay.tx - 2, bay.ty - 2, bay.tx + 5, bay.ty + 6)
  rebuildBlocked(dropped)
  const party = dropped.units.filter((unit) => unit.owner === 0 && unit.kind === 'porter').slice(0, 4)
  assert(party.length === 4, 'need four Stalkers to cancel a freeze')
  for (const unit of party) {
    unit.x = doorX + 400
    unit.y = doorY
    unit.order = null
    unit.cargo = 0
  }
  dropped.oreHeld[0] = 200
  commandFreeze(dropped, party.map((unit) => unit.id), bay.id)
  const lostMember = party[0]
  assert(lostMember, 'missing a Stalker to drop')
  lostMember.hp = 0
  step(dropped, 1 / 30)
  assert(
    party.every((unit) => unit.order == null),
    'a short party kept walking',
  )
  assert(dropped.toasts.some((toast) => toast.text === 'Freeze cancelled.'), 'a short party did not say so')

  const brain = createMatch(24)
  const starters = brain.units.filter((unit) => unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0)
  assert(starters.length === 4, 'Dunmarch did not start with four Stalkers')
  const elder = starters[0]
  assert(elder, 'Dunmarch has no Stalker')
  for (const unit of starters) {
    unit.cargo = 0
    unit.order = null
  }
  brain.oreHeld[1] = 199
  const aiKeep = brain.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(aiKeep, 'Dunmarch has no Silo')
  aiKeep.cryo = true
  const bank = aiKeep
  const pad = buildingCenter(aiKeep)
  rebuildBlocked(brain)
  brain.aiAcc = 0
  updateSiloAi(brain, 0.5)
  assert(
    !brain.units.some((unit) => unit.owner === 1 && unit.order?.type === 'freeze'),
    'SiloAI froze without 200 dumps',
  )
  elder.hp = 0
  brain.oreHeld[1] = 200
  brain.aiAcc = 0
  updateSiloAi(brain, 0.5)
  assert(
    !brain.units.some((unit) => unit.owner === 1 && unit.order?.type === 'freeze'),
    'SiloAI froze fewer than four Stalkers',
  )
  elder.hp = UNIT_STATS.porter.hp
  bank.cryoRecover = 120
  brain.oreHeld[1] = 200
  brain.aiAcc = 0
  updateSiloAi(brain, 0.5)
  assert(
    !brain.units.some((unit) => unit.owner === 1 && unit.order?.type === 'freeze'),
    'SiloAI froze Stalkers during recovery',
  )
  bank.cryoRecover = 0
  for (const unit of brain.units) {
    if (unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0) {
      unit.cargo = 0
      unit.order = null
    }
  }
  brain.oreHeld[1] = 200
  brain.aiAcc = 0
  updateSiloAi(brain, 0.5)
  const sent = brain.units.filter((unit) => unit.owner === 1 && unit.order?.type === 'freeze')
  assert(sent.length === 4, 'SiloAI did not press Cryo for four Stalkers')
  const extra = makeUnit(brain, 1, 'porter', pad.x, pad.y + 20)
  const extraOrder = () => extra.order?.type
  brain.oreHeld[1] = 200
  brain.aiAcc = 0
  updateSiloAi(brain, 0.5)
  const still = brain.units.filter((unit) => unit.owner === 1 && unit.order?.type === 'freeze')
  assert(still.length === 4 && extraOrder() !== 'freeze', 'SiloAI pressed Cryo while a group was already inbound')
  for (const unit of sent) {
    unit.order = null
    unit.frozen = bank.id
  }
  brain.oreHeld[1] = 200
  brain.aiAcc = 0
  updateSiloAi(brain, 0.5)
  assert(sent.every((unit) => unit.frozen === bank.id), 'SiloAI defrosted a filled Cryo')
  assert(extraOrder() !== 'freeze', 'SiloAI pressed Cryo while Stalkers were already inside')
  const cooled = () => bank.cryoRecover
  assert(cooled() === 0, 'a filled Cryo started recovery on its own')
}

function siloAiUsesHoverGrid(): void {
  const state = createMatch(31)
  const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(keep, 'Dunmarch has no Silo for the flight')
  const home = buildingCenter(keep)
  const flight = []
  for (let i = 0; i < 10; i++) flight.push(makeUnit(state, 1, 'drone', home.x + (i - 5) * 8, home.y + 36))
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  const spots = hoverGridSpots(state.mapW, state.mapH, 10)
  const goals = flight.map((unit) => (unit.order?.type === 'move' ? `${unit.order.x},${unit.order.y}` : ''))
  assert(flight.every((unit) => unit.cloak === GRID_CLOAK_SECONDS && !unit.scanning), 'Grid did not hide the flight')
  assert(new Set(goals).size === 10, 'Grid did not give each Hover its own spot')
  for (const goal of goals) assert(spots.some((spot) => `${spot.x},${spot.y}` === goal), 'a Hover left the Grid')

  for (const unit of flight) {
    unit.cloak = 0
    unit.order = null
  }
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  assert(flight.every((unit) => unit.cloak === 0), 'Grid ran again before its cooldown')

  state.time = 90
  state.aiExplored.fill(1)
  state.aiVisible.fill(1)
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  assert(flight.every((unit) => unit.cloak === 0), 'Grid scouted a map this side already sees')

  const lead = flight[0]
  assert(lead, 'missing a Hover')
  const foe = makeUnit(state, 0, 'pike', lead.x + 12, lead.y)
  state.aiVisible[Math.floor(foe.y / TILE) * state.mapW + Math.floor(foe.x / TILE)] = 1
  state.aiAcc = 0
  updateSiloAi(state, 0.5)
  assert(flight.every((unit) => unit.cloak === GRID_CLOAK_SECONDS), 'Grid stayed visible while a Bike was on the flight')

  const few = createMatch(33)
  const fewKeep = few.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(fewKeep, 'missing a Silo')
  const pad = buildingCenter(fewKeep)
  const nine = []
  for (let i = 0; i < 9; i++) nine.push(makeUnit(few, 1, 'drone', pad.x + i * 8, pad.y + 30))
  few.aiAcc = 0
  updateSiloAi(few, 0.5)
  assert(nine.every((unit) => unit.cloak === 0), 'Grid accepted fewer than 10 Hovers')
}

function raiseBase(state: MatchState, owner: PlayerId): Building {
  const keep = state.buildings.find((building) => building.owner === owner && building.kind === 'keep')
  assert(keep, 'Dunmarch has no Silo')
  chartBase(state, owner, keep.tx + 1, keep.ty + 1, 16)
  makeBuilding(state, owner, 'yard', 36, 16, true)
  makeBuilding(state, owner, 'yard', 40, 16, true)
  makeBuilding(state, owner, 'tower', 36, 20, true)
  makeBuilding(state, owner, 'tower', 40, 20, true)
  makeBuilding(state, owner, 'tower', 44, 20, true)
  rebuildBlocked(state)
  return keep
}

function siloAiBuysCryoFor250(): void {
  const plenty = createMatch(32)
  plenty.time = 0
  plenty.oreHeld[1] = 2000
  plenty.aiAcc = 0
  raiseBase(plenty, 1)
  updateSiloAi(plenty, 0.5)
  const plentyKeep = plenty.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(plentyKeep?.cryo, 'SiloAI waited to buy Cryo while it could pay 250')
  assert(plenty.oreHeld[1] <= 2000 - CRYO_COST, 'the Cryo did not cost 250 while four Stalkers were working')
  assert(
    !plenty.buildings.some((building) => building.kind === 'keep' && building.owner === 1 && building.id !== plentyKeep?.id),
    'SiloAI raised a second Silo for the Cryo',
  )

  const state = createMatch(34)
  state.time = 0
  state.oreHeld[1] = 300
  state.aiAcc = 0
  const keep = raiseBase(state, 1)
  const doomed = state.units.find((unit) => unit.owner === 1 && unit.kind === 'porter')
  assert(doomed, 'Dunmarch has no Stalker to lose')
  doomed.hp = 0
  updateSiloAi(state, 0.5)
  assert(keep.cryo, 'SiloAI did not add a Cryo after Stalkers dropped low')
  assert(!state.buildings.some((building) => building.kind === 'keep' && building.owner === 1 && building.id !== keep.id), 'SiloAI raised a second Silo for the Cryo')
  assert(state.oreHeld[1] === 0, 'the Cryo did not cost 250 after replacing a Stalker')

  const early = createMatch(38)
  early.time = 0
  early.oreHeld[1] = 250
  early.aiAcc = 0
  const earlyKeep = early.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(earlyKeep, 'Dunmarch has no Silo for an early Cryo')
  const spare = early.units.find((unit) => unit.owner === 1 && unit.kind === 'porter')
  assert(spare, 'Dunmarch has no Stalker to count')
  spare.hp = 0
  const before = early.buildings.length
  updateSiloAi(early, 0.5)
  assert(earlyKeep.cryo, 'SiloAI waited on Storage, Factory, and Pillar before the Cryo')
  assert(early.buildings.length === before, 'the early Cryo raised a building')
  assert(early.oreHeld[1] === 0, 'the early Cryo did not cost 250')

  const bare = createMatch(39)
  bare.time = 0
  bare.oreHeld[1] = 250
  bare.aiAcc = 0
  const bareKeep = bare.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(bareKeep, 'Dunmarch has no Silo for a Cryo with no Stalkers')
  for (const unit of bare.units) {
    if (unit.owner === 1 && unit.kind === 'porter') unit.hp = 0
  }
  const bareBefore = bare.buildings.length
  updateSiloAi(bare, 0.5)
  assert(bareKeep.cryo, 'SiloAI skipped Cryo with no Stalkers on the map')
  assert(bare.buildings.length === bareBefore, 'a Cryo with no Stalkers raised a building')
  assert(bare.oreHeld[1] === 0, 'a Cryo with no Stalkers did not cost 250')

  const short = createMatch(40)
  short.time = 0
  short.oreHeld[1] = 249
  short.aiAcc = 0
  const shortKeep = short.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(shortKeep, 'Dunmarch has no Silo for a short bank')
  updateSiloAi(short, 0.5)
  assert(!shortKeep.cryo, 'SiloAI bought Cryo with 249 dumps')
}

function siloAiBanksHovers(): void {
  const state = createMatch(35)
  state.oreHeld[1] = 750
  state.aiAcc = 0
  const keep = raiseBase(state, 1)
  const home = buildingCenter(keep)
  makeUnit(state, 1, 'porter', home.x, home.y + 24)
  makeUnit(state, 1, 'porter', home.x + 14, home.y + 24)
  makeUnit(state, 1, 'drone', home.x, home.y + 40)
  makeUnit(state, 1, 'drone', home.x + 16, home.y + 40)
  const before = state.buildings.length
  updateSiloAi(state, 0.5)
  const queued = state.buildings.reduce((count, building) => {
    if (building.owner !== 1) return count
    return count + building.queue.filter((job) => job.kind === 'drone').length
  }, 0)
  assert(queued === 2, 'surplus dumps did not queue a Hover at each Factory')
  assert(state.buildings.length === before, 'surplus dumps raised another Factory before the Grid')
  assert(state.oreHeld[1] === 400, 'two Hovers did not cost 100 dumps')

  const lean = createMatch(36)
  lean.oreHeld[1] = 499
  lean.aiAcc = 0
  const leanKeep = raiseBase(lean, 1)
  const leanHome = buildingCenter(leanKeep)
  makeUnit(lean, 1, 'porter', leanHome.x, leanHome.y + 24)
  makeUnit(lean, 1, 'porter', leanHome.x + 14, leanHome.y + 24)
  makeUnit(lean, 1, 'drone', leanHome.x, leanHome.y + 40)
  makeUnit(lean, 1, 'drone', leanHome.x + 16, leanHome.y + 40)
  updateSiloAi(lean, 0.5)
  const leanQueued = lean.buildings.reduce((count, building) => {
    if (building.owner !== 1) return count
    return count + building.queue.filter((job) => job.kind === 'drone').length
  }, 0)
  assert(leanQueued === 0, 'a bank under 500 dumps trained extra Hovers')
}

function cryoButtonSendsTheHealthiest(): void {
  const field = createMatch(37)
  const silo = field.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(silo, 'Silo 01 has no Silo')
  silo.cryo = true
  openPad(field, silo.tx - 3, silo.ty - 3, silo.tx + 14, silo.ty + 8)
  rebuildBlocked(field)
  const hub = buildingCenter(silo)
  const starters = field.units.filter((unit) => unit.owner === 0 && unit.kind === 'porter')
  assert(starters.length === 4, 'auto-freeze needs the starting Stalkers')
  const sixth = makeUnit(field, 0, 'porter', hub.x, hub.y)
  const seventh = makeUnit(field, 0, 'porter', hub.x, hub.y)
  const sleeper = makeUnit(field, 0, 'porter', hub.x, hub.y)
  sleeper.frozen = -1
  sleeper.hp = 200
  const rider = makeUnit(field, 0, 'pike', hub.x, hub.y)
  rider.hp = 200
  const rival = field.units.find((unit) => unit.owner === 1 && unit.kind === 'porter')
  assert(rival, 'the other Silo has no Stalker')
  rival.hp = 200
  rival.x = hub.x
  rival.y = hub.y
  rival.order = null

  const ranked = [...starters, sixth, seventh]
  assert(ranked.length === 6, 'auto-freeze needs six Stalkers')
  const far100 = ranked[0]
  const near90 = ranked[1]
  const far90 = ranked[2]
  const near80 = ranked[3]
  const far80 = ranked[4]
  const low = ranked[5]
  assert(far100 && near90 && far90 && near80 && far80 && low, 'missing a ranked Stalker')

  const placeRanked = (unit: Unit, hp: number, dx: number) => {
    unit.hp = hp
    unit.x = hub.x + dx
    unit.y = hub.y
    unit.order = null
    unit.cargo = 0
    unit.frozen = null
  }
  placeRanked(far100, 100, 200)
  placeRanked(near90, 90, 48)
  placeRanked(far90, 90, 160)
  placeRanked(near80, 80, 240)
  placeRanked(far80, 80, 64)
  placeRanked(low, 40, 8)
  assert(far80.id > near80.id, 'the nearer Stalker was not the later one')

  field.oreHeld[0] = 200
  assert(commandFreeze(field, [far80.id, low.id, near80.id, far90.id], silo.id), 'selecting 4 Stalkers did not send them')
  assert(
    [far80, low, near80, far90].every((unit) => unit.order?.type === 'freeze' && unit.order.buildingId === silo.id),
    'a manual group was not ordered',
  )
  for (const unit of ranked) unit.order = null

  far100.cargo = 8
  far100.order = { type: 'construct', buildingId: silo.id }
  silo.cryoRecover = 30
  assert(commandFreezeAuto(field, silo.id), 'a recovering Cryo ignored the button')
  assert(ranked.every((unit) => unit.order?.type !== 'freeze'), 'a recovering Cryo sent Stalkers')
  assert(field.oreHeld[0] === 200, 'a recovering Cryo spent dumps')
  assert(field.toasts.some((toast) => toast.text === 'Cryo is recovering.'), 'the Cryo button hid the recovery')
  silo.cryoRecover = 0
  far100.order = null

  far80.hp = 0
  far90.hp = 0
  low.hp = 0
  field.toasts.length = 0
  assert(commandFreezeAuto(field, silo.id), 'a short crew was not refused')
  assert(
    ranked.every((unit) => unit.hp <= 0 || unit.order == null),
    'a short crew was sent to freeze',
  )
  assert(
    field.toasts.some((toast) => toast.text === 'Select 4 Stalkers to freeze.'),
    'a short crew did not say to select 4',
  )
  placeRanked(far90, 90, 160)
  placeRanked(far80, 80, 64)
  placeRanked(low, 40, 8)

  field.oreHeld[0] = 199
  field.toasts.length = 0
  assert(commandFreezeAuto(field, silo.id), 'a short bank was not refused')
  assert(ranked.every((unit) => unit.order == null), 'a short bank sent Stalkers')
  assert(field.oreHeld[0] === 199, 'a short bank spent dumps')
  assert(
    field.toasts.some((toast) => toast.text === 'Need 200 dumps to freeze.'),
    'a short bank did not say it needs 200',
  )

  field.oreHeld[0] = 200
  far100.cargo = 8
  far100.order = { type: 'construct', buildingId: silo.id }
  field.toasts.length = 0
  assert(commandFreezeAuto(field, silo.id), 'the Cryo button did not send Stalkers')
  const picked = [far100, near90, far90, far80]
  const spared = [near80, low]
  assert(
    picked.every((unit) => unit.order?.type === 'freeze' && unit.order.buildingId === silo.id),
    'the Cryo button did not pick the healthiest Stalkers',
  )
  assert(spared.every((unit) => unit.order == null), 'the Cryo button sent a weaker Stalker')
  assert(sleeper.frozen === -1 && sleeper.order == null, 'a frozen Stalker was sent again')
  assert(rider.order == null, 'a Flasher was sent to freeze')
  assert(rival.order == null, 'another Silo’s Stalker was sent to freeze')
  assert(far100.cargo === 8, 'freezing dropped the carried dumps')
  assert(field.oreHeld[0] === 200, 'the Cryo button charged dumps before the group arrived')

  for (const unit of ranked) unit.order = null
  placeRanked(far100, 50, 40)
  placeRanked(near90, 50, 50)
  placeRanked(far90, 50, 60)
  placeRanked(near80, 50, 300)
  placeRanked(far80, 50, 300)
  placeRanked(low, 50, 400)
  const tied = [near80, far80].sort((a, b) => a.id - b.id)
  const tiedFirst = tied[0]
  const tiedSecond = tied[1]
  assert(tiedFirst && tiedSecond && tiedFirst.id < tiedSecond.id, 'missing a tied Stalker')
  field.toasts.length = 0
  assert(commandFreezeAuto(field, silo.id), 'a health tie was not sent')
  const orderType = (unit: Unit) => unit.order?.type
  assert(
    orderType(far100) === 'freeze' && orderType(near90) === 'freeze' && orderType(far90) === 'freeze',
    'nearer equal-health Stalkers were left behind',
  )
  assert(orderType(tiedFirst) === 'freeze', 'the earlier Stalker lost a distance tie')
  assert(tiedSecond.order == null && low.order == null, 'a later tied Stalker was sent')

  field.toasts.length = 0
  assert(commandFreezeAuto(field, silo.id), 'a busy Cryo was not refused')
  assert(field.toasts.some((toast) => toast.text === 'Cryo is full.'), 'a second Cryo click did not say the Cryo is full')
  assert(tiedSecond.order == null, 'a full Cryo sent another Stalker')

  const gateX = (silo.tx + 1.5) * TILE
  const gateY = (silo.ty + 3) * TILE + 16
  for (const unit of [far100, near90, far90, tiedFirst]) {
    unit.x = gateX
    unit.y = gateY
  }
  step(field, 1 / 30)
  assert(
    [far100, near90, far90, tiedFirst].every((unit) => unit.frozen === silo.id),
    'the auto-sent group did not freeze at the door',
  )
  const bank = () => field.oreHeld[0]
  assert(bank() === 0, 'the auto-sent group did not cost 200 dumps')
  assert(tiedSecond.frozen == null && low.frozen == null, 'an unpicked Stalker froze too')
}

function siloCryoButtonsFollowTheVessels(): void {
  const dock = createMatch(47)
  const home = dock.buildings.find((building) => building.owner === 0 && building.kind === 'keep')
  assert(home, 'Silo 01 has no Silo')
  dock.selectedBuilding = home.id
  dock.selectedUnits = []
  dock.oreHeld[0] = CRYO_COST
  const bare = describeSelection(dock)
  assert(!bare.includes('shelter housing'), 'a Silo without a Cryo still showed its description')
  const buying = commandSnapshot(dock)
  const buyCryo = buying.find((cmd) => cmd.label === 'Cryo')
  assert(buyCryo && !buyCryo.disabled && buyCryo.detail === '250 dumps', 'the first Cryo click is not the purchase')
  assert(!buying.some((cmd) => cmd.label === 'Defrost' || cmd.label === 'Thaw'), 'Defrost showed before the vessels were bought')

  home.cryo = true
  const emptyDock = () => commandSnapshot(dock)
  const emptyCryo = emptyDock().find((cmd) => cmd.label === 'Cryo')
  const emptyDefrost = emptyDock().find((cmd) => cmd.label === 'Defrost')
  assert(emptyCryo && !emptyCryo.disabled && emptyCryo.detail === '200 dumps', 'an empty Cryo was not ready')
  assert(emptyDefrost && emptyDefrost.disabled && emptyDefrost.detail === 'empty', 'Defrost was active in an empty Cryo')

  const walkers = dock.units.filter((unit) => unit.owner === 0 && unit.kind === 'porter').slice(0, 4)
  assert(walkers.length === 4, 'need four Stalkers to fill the Cryo button')
  for (const unit of walkers) unit.order = { type: 'freeze', buildingId: home.id }
  const walking = commandSnapshot(dock)
  const walkCryo = walking.find((cmd) => cmd.label === 'Cryo')
  const walkDefrost = walking.find((cmd) => cmd.label === 'Defrost')
  assert(walkCryo?.disabled, 'Cryo stayed active while Stalkers were on the way')
  assert(walkDefrost && !walkDefrost.disabled, 'Defrost stayed inactive while Stalkers were on the way')

  for (const unit of walkers) {
    unit.order = null
    unit.frozen = home.id
  }
  const fullDock = commandSnapshot(dock)
  const fullCryo = fullDock.find((cmd) => cmd.label === 'Cryo')
  const fullDefrost = fullDock.find((cmd) => cmd.label === 'Defrost')
  assert(fullCryo?.disabled && fullCryo.detail === '200 dumps', 'Cryo stayed active with Stalkers inside')
  assert(fullDefrost && !fullDefrost.disabled && fullDefrost.detail === '4 inside', 'Defrost did not offer the frozen Stalkers')

  thawCryo(dock, home.id)
  const cooling = commandSnapshot(dock)
  const coolCryo = cooling.find((cmd) => cmd.label === 'Cryo')
  const coolDefrost = cooling.find((cmd) => cmd.label === 'Defrost')
  assert(coolCryo?.disabled && coolCryo.detail === 'Recovery 4:00', 'Cryo hid the recovery countdown')
  assert(coolDefrost?.disabled, 'Defrost stayed active during recovery')
  const cooledPanel = describeSelection(dock)
  assert(cooledPanel.includes('Recovery') && cooledPanel.includes('4:00'), 'the panel hid recovery')
  assert(!cooledPanel.includes('shelter housing'), 'the recovering Silo panel showed its description')

  home.cryoRecover = 0
  const openDock = commandSnapshot(dock)
  const openCryo = openDock.find((cmd) => cmd.label === 'Cryo')
  const openDefrost = openDock.find((cmd) => cmd.label === 'Defrost')
  assert(openCryo && !openCryo.disabled, 'Cryo stayed inactive after recovery')
  assert(openDefrost?.disabled, 'Defrost stayed active after the vessels emptied')

  const plant = makeBuilding(dock, 0, 'yard', home.tx + 8, home.ty + 8, true)
  dock.selectedBuilding = plant.id
  const factoryPanel = describeSelection(dock)
  assert(factoryPanel.includes('Facility for manufacturing'), 'the Factory panel lost its description')
}

function matchFingerprint(state: MatchState): string {
  const units = state.units
    .map((unit) => `${unit.id}:${unit.owner}:${unit.kind}:${unit.hp}:${unit.x}:${unit.y}:${unit.order?.type ?? ''}:${unit.frozen ?? ''}`)
    .join('|')
  const buildings = state.buildings
    .map((building) => `${building.id}:${building.owner}:${building.kind}:${building.hp}:${building.tx}:${building.ty}:${building.complete}:${building.progress}:${building.cryo}:${building.stock}`)
    .join('|')
  const ore = state.ore.map((node) => `${node.id}:${node.amount}`).join('|')
  return `${state.simTick}|${state.time}|${state.outcome}|${state.oreHeld.join(',')}|${units}|${buildings}|${ore}`
}

function replayRepeatsTheMatch(): void {
  const seed = 41
  beginRecording(seed, 'duel')
  const live = createMatch(seed, 'duel')
  for (let i = 0; i < 40; i++) step(live, 1 / 60)
  assert(currentTape()?.actions.length === 0, 'SiloAI orders were written onto the replay tape')
  live.paused = true
  rememberLive(live, { op: 'stop', ids: [1] })
  assert(currentTape()?.actions.length === 0, 'a paused order was recorded')
  live.paused = false
  const ids = live.units.filter((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0).map((unit) => unit.id)
  assert(ids.length >= 4, 'replay needs the starting Stalkers')
  const keep = live.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(keep, 'replay needs the enemy Silo')
  const goal = buildingCenter(keep)
  rememberLive(live, { op: 'move', ids, x: goal.x, y: goal.y, attack: true })
  commandMove(live, ids, goal.x, goal.y, true)
  assert(currentTape()?.actions.length === 1, 'the attack-move was not recorded')
  assert(currentTape()?.actions[0]?.tick === live.simTick, 'the attack-move was stamped on the wrong step')
  for (let i = 0; i < 180; i++) step(live, 1 / 60)
  const tape = finishRecording()
  assert(tape && !live.replay, 'recording did not keep the live match')
  const played = createMatch(seed, 'duel')
  played.replay = true
  armPlayback(tape)
  while (played.simTick < live.simTick) {
    applyDue(played)
    step(played, 1 / 60)
  }
  assert(matchFingerprint(played) === matchFingerprint(live), 'replay diverged from the match')
  assert(played.replay, 'playback cleared the replay flag')
  const plainA = createMatch(seed, 'duel')
  const plainB = createMatch(seed, 'duel')
  for (let i = 0; i < 120; i++) {
    step(plainA, 1 / 60)
    step(plainB, 1 / 60)
  }
  assert(matchFingerprint(plainA) === matchFingerprint(plainB), 'the same seed diverged with no orders')
}

function replayCarriesSpeed(): void {
  const seed = 42
  beginRecording(seed, 'duel')
  const live = createMatch(seed, 'duel')
  const liveSpeed = () => live.speed
  assert(liveSpeed() === 1, 'a match started sped up')
  rememberAlways(live, { op: 'console', text: 'speed x3' })
  assert(runCommand(live, 'speed x3'), 'speed x3 was rejected on the tape')
  for (let i = 0; i < 5; i++) step(live, 1 / 60)
  assert(liveSpeed() === 3, 'the live match dropped speed x3')
  rememberAlways(live, { op: 'console', text: 'speed x3 off' })
  assert(runCommand(live, 'speed x3 off'), 'speed x3 off was rejected on the tape')
  step(live, 1 / 60)
  const tape = finishRecording()
  assert(tape && tape.actions.length === 2, 'speed changes were not recorded')
  assert(tape.actions[0]?.tick === 0 && tape.actions[0].action.op === 'console', 'speed x3 was stamped on the wrong step')
  assert(tape.actions[1]?.tick === 5 && tape.actions[1].action.op === 'console', 'speed x3 off was stamped on the wrong step')
  const played = createMatch(seed, 'duel')
  played.replay = true
  const playedSpeed = () => played.speed
  armPlayback(tape)
  applyDue(played)
  assert(playedSpeed() === 3, 'replay did not turn speed x3 on with the tape')
  while (played.simTick < live.simTick) {
    applyDue(played)
    step(played, 1 / 60)
  }
  assert(playedSpeed() === 1, 'replay left speed x3 on after the tape turned it off')
  assert(runCommand(played, 'speed x3') && playedSpeed() === 3, 'a replay could not turn speed x3 on')
  assert(tape.actions.length === 2, 'a replay speed toggle was written onto the tape')
  assert(runCommand(played, 'speed x3 off') && playedSpeed() === 1, 'a replay could not turn speed x3 off')
}

function replayShowsRecordedStats(): void {
  const seed = 45
  beginRecording(seed, 'duel')
  const live = createMatch(seed, 'duel')
  live.time = 125.9
  live.outcome = 'win'
  live.stats[0]!.dumps = 4321
  live.stats[0]!.silos = 2
  live.stats[1]!.created.pike = 9
  sealReplayStats(live)
  live.time = 3
  live.stats[0]!.dumps = 1
  const tape = currentTape()
  assert(tape?.final?.time === 125.9, 'the tape lost the recorded duration')
  assert(tape?.final?.stats[0]?.dumps === 4321, 'the tape followed a later edit of the dumps')
  assert(tape?.final?.stats[1]?.created.pike === 9, 'the tape lost the recorded Flasher total')
  const played = createMatch(seed, 'duel')
  played.replay = true
  played.time = 4
  played.stats[0]!.dumps = 7
  played.stats[1]!.created.pike = 1
  const recorded = tape?.final
  assert(recorded, 'playback has no recorded statistics')
  const frozen = statsPanelHtml(recorded.time, recorded.playerCount, recorded.stats)
  const partial = endStatsHtml(played)
  assert(frozen.includes('>02:05<'), 'the recorded duration was not 02:05')
  assert(frozen.includes('>4321<') && frozen.includes('>9<'), 'the recorded totals were dropped')
  assert(partial.includes('>00:04<') && partial.includes('>7<'), 'the replay panel was not the partial match')
  assert(!partial.includes('>4321<'), 'the unfinished replay already showed the final dumps')
  assert(frozen !== partial, 'the recorded panel matched the unfinished replay')
  for (let i = 0; i < 30; i++) step(played, 1 / 60)
  const still = statsPanelHtml(recorded.time, recorded.playerCount, recorded.stats)
  assert(still === frozen, 'playback changed the recorded statistics')
  assert(currentTape()?.actions.length === 0, 'sealing the statistics wrote an order')
}

function countAmount(state: MatchState, amount: number, seen: Set<number>): number {
  return state.ore.filter((node) => node.amount === amount && !seen.has(node.id)).length
}

function powerDebrisAndBatteries(): void {
  const debris = createMatch(11)
  debris.aiAcc = -30
  debris.sideAcc.fill(-30)
  const seen = new Set(debris.ore.map((node) => node.id))
  const yard = makeBuilding(debris, 0, 'yard', 8, 8, true)
  yard.hp = 0
  step(debris, 1 / 60)
  const factoryPiles = debris.ore.filter((node) => node.amount === 15 && !seen.has(node.id))
  assert(factoryPiles.length === 6, `a Factory left ${factoryPiles.length} piles of 15`)
  for (const pile of factoryPiles) seen.add(pile.id)
  const vault = makeBuilding(debris, 1, 'silo', 14, 8, true)
  vault.stock = 30
  vault.dropDumps = true
  debris.oreHeld[1] = 80
  vault.hp = 0
  step(debris, 1 / 60)
  assert(countAmount(debris, 10, seen) === 4, 'a Storage did not leave 4 piles of 10')
  assert(countAmount(debris, 30, seen) === 1, 'a combat kill did not leave the stored dumps')
  assert(debris.oreHeld[1] === 50, `the stored pile did not leave the bank (${debris.oreHeld[1]})`)
  for (const node of debris.ore) if (node.amount === 10 || node.amount === 30) seen.add(node.id)
  const pillar = makeBuilding(debris, 0, 'tower', 20, 8, true)
  pillar.hp = 0
  step(debris, 1 / 60)
  assert(countAmount(debris, 50, seen) === 1, 'a Pillar did not leave one pile of 50')
  const quiet = makeBuilding(debris, 1, 'silo', 24, 8, true)
  quiet.stock = 15
  quiet.hp = 0
  const bank = debris.oreHeld[1]
  step(debris, 1 / 60)
  assert(!debris.ore.some((node) => node.amount === 15 && !seen.has(node.id)), 'a Storage dropped its stock without a combat kill')
  assert(debris.oreHeld[1] === bank, 'debris changed the bank')
  const pile = factoryPiles[0]
  assert(pile, 'missing a Factory pile to gather')
  const porter = makeUnit(debris, 0, 'porter', (pile.tx + 1.5) * TILE, (pile.ty + 0.5) * TILE)
  commandGather(debris, [porter.id], pile.id)
  let cargo = 0
  for (let i = 0; i < 8 * 60; i++) {
    step(debris, 1 / 60)
    cargo = unitById(debris, porter.id)?.cargo ?? 0
    if (cargo > 0) break
  }
  assert(cargo === GATHER_AMOUNT, `a Stalker gathered ${cargo} from building debris`)

  const rates = createMatch(13)
  rates.aiAcc = -30
  rates.sideAcc.fill(-30)
  const flasher = makeUnit(rates, 0, 'pike', 200, 200)
  const ape = makeUnit(rates, 0, 'howler', 280, 200)
  const hover = makeUnit(rates, 0, 'drone', 360, 200)
  for (let i = 0; i < 60; i++) step(rates, 1 / 60)
  const flasherPower = () => flasher.power
  const apePower = () => ape.power
  const hoverPower = () => hover.power
  assert(Math.abs(flasherPower() - (1 - 1 / FLASHER_POWER_SECONDS)) < 0.001, `Flasher Power is ${flasher.power}`)
  assert(Math.abs(apePower() - (1 - 1 / GORILLA_POWER_SECONDS)) < 0.001, `Gorilla Power is ${ape.power}`)
  assert(Math.abs(hoverPower() - (1 - 1 / HOVER_POWER_SECONDS)) < 0.001, `Hover Power is ${hover.power}`)
  ape.power = 0.00001
  ape.order = { type: 'move', x: 800, y: 200 }
  const held = ape.x
  step(rates, 1 / 60)
  assert(ape.power === 0 && isShutdown(ape), 'empty Power did not shut the Gorilla down')
  assert(ape.hp > 0 && ape.order == null && ape.x === held, 'a shut-down Gorilla died or kept moving')
  commandMove(rates, [ape.id], 900, 200, false)
  assert(ape.order == null, 'a shut-down Gorilla accepted an order')

  flasher.hp = 0
  step(rates, 1 / 60)
  const cellX = Math.floor(flasher.x / TILE)
  const cellY = Math.floor(flasher.y / TILE)
  const battery = rates.batteries.find((entry) => entry.tx === cellX && entry.ty === cellY)
  assert(battery, 'a destroyed Flasher left no battery')
  assert(!rates.units.some((unit) => unit.id === flasher.id), 'the destroyed Flasher stayed on the field')
  hover.x = (cellX + 0.5) * TILE
  hover.y = (cellY + 0.5) * TILE
  hover.power = 0.2
  step(rates, 1 / 60)
  assert(hover.power === 1, 'standing on a battery did not refill Power')
  assert(!rates.batteries.some((entry) => entry.id === battery.id), 'the battery stayed after it was picked up')

  const brain = createMatch(14)
  brain.aiAcc = 0
  const home = brain.buildings.find((building) => building.owner === 1 && building.kind === 'keep')
  assert(home, 'missing a Silo for the battery run')
  const spot = buildingCenter(home)
  const tired = makeUnit(brain, 1, 'pike', spot.x + 48, spot.y)
  tired.power = POWER_LOW - 0.05
  const bx = Math.floor(tired.x / TILE) + 3
  const by = Math.floor(tired.y / TILE)
  brain.batteries.push({ id: brain.nextId++, tx: bx, ty: by })
  brain.aiExplored[by * brain.mapW + bx] = 1
  brain.aiVisible[by * brain.mapW + bx] = 1
  updateSiloAi(brain, 0.5)
  const sent = tired.order
  const chargeX = (bx + 0.5) * TILE
  const chargeY = (by + 0.5) * TILE
  assert(sent?.type === 'move', 'SiloAI left a low-Power Flasher in place')
  assert(Math.hypot(sent.x - chargeX, sent.y - chargeY) <= 8, 'SiloAI did not send the Flasher to the battery')
  const fresh = makeUnit(brain, 1, 'howler', spot.x - 36, spot.y)
  fresh.power = POWER_LOW
  updateSiloAi(brain, 0.5)
  const stayed = fresh.order
  assert(stayed?.type !== 'move' || Math.hypot(stayed.x - chargeX, stayed.y - chargeY) > 8, 'SiloAI sent a Flasher that still had 30% Power')

  const seed = 46
  beginRecording(seed, 'duel')
  const live = createMatch(seed, 'duel')
  live.aiAcc = -30
  live.sideAcc.fill(-30)
  const victim = makeUnit(live, 1, 'pike', 320, 280)
  victim.hp = 1
  const hunter = makeUnit(live, 0, 'pike', victim.x + 30, victim.y)
  rememberLive(live, { op: 'attack', ids: [hunter.id], targetId: victim.id, kind: 'unit' })
  commandAttack(live, [hunter.id], victim.id, 'unit')
  for (let i = 0; i < 90 && live.units.some((unit) => unit.id === victim.id); i++) step(live, 1 / 60)
  assert(!live.units.some((unit) => unit.id === victim.id), 'the recorded shot left the Flasher alive')
  assert(live.batteries.length === 1, 'the recorded kill left no battery')
  const tape = finishRecording()
  assert(tape && tape.actions.length === 1 && tape.actions[0]?.action.op === 'attack', 'the kill was not the only recorded order')
  const played = createMatch(seed, 'duel')
  played.replay = true
  played.aiAcc = -30
  played.sideAcc.fill(-30)
  const playedVictim = makeUnit(played, 1, 'pike', 320, 280)
  playedVictim.hp = 1
  makeUnit(played, 0, 'pike', playedVictim.x + 30, playedVictim.y)
  armPlayback(tape)
  while (played.simTick < live.simTick) {
    applyDue(played)
    step(played, 1 / 60)
  }
  assert(played.batteries.length === live.batteries.length, 'replay dropped the battery')
  assert(played.batteries[0]?.tx === live.batteries[0]?.tx && played.batteries[0]?.ty === live.batteries[0]?.ty, 'replay moved the battery')
  const liveHunter = live.units.find((unit) => unit.kind === 'pike' && unit.owner === 0)
  const playedHunter = played.units.find((unit) => unit.kind === 'pike' && unit.owner === 0)
  assert(liveHunter && playedHunter, 'replay lost the hunter')
  assert(Math.abs(playedHunter.power - liveHunter.power) < 1e-6, 'replay Power diverged from the match')
}
