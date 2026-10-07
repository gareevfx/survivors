import { commandAttack, commandGather, commandMove, tryPlace, tryTrain } from './game/commands'
import { findPath } from './game/pathfind'
import { step } from './game/sim'
import { canPlace, createMatch, isWalkable, makeUnit, unitById } from './game/state'
import { MAP_H, MAP_W, STARTING_ORE, TILE } from './game/types'

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

function howlerBreaksRock(): void {
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
  const howler = makeUnit(state, 0, 'howler', (rock.tx + 0.5) * TILE, (rock.ty + 0.5) * TILE - 96)
  commandAttack(state, [howler.id], rock.id, 'rock')
  let broke = false
  for (let i = 0; i < 12 * 60; i++) {
    step(state, 1 / 60)
    if (!state.rocks.some((entry) => entry.id === rock.id)) {
      broke = true
      break
    }
  }
  assert(broke, 'howler did not destroy the rock')
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
howlerBreaksRock()
pikeChipsRock()
attacksBuildings()
combatResolves()
keepDecidesTheField()
enemyPlays()
console.log('smoke ok')
