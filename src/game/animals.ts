import { hash2, mulberry32 } from './rng'
import { TILE, type Animal, type AnimalKind, type MatchState } from './types'

/** Fixed handful. The same counts on the duel field and the free-for-all. */
export const BEAR_COUNT = 4
export const MOOSE_COUNT = 3
export const CROW_COUNT = 6
export const EAGLE_COUNT = 3

const BEAR_SPEED = 24
const MOOSE_SPEED = 36
const CROW_SPEED = 84
const EAGLE_TURN = 0.24

/** Place ambient wildlife on a fresh match. Ground animals start on open tiles. */
export function spawnAnimals(state: MatchState): void {
  const rand = mulberry32(state.seed ^ 0x51f15e)
  const open = openTiles(state)
  const placed: Array<[number, number]> = []
  const animals: Animal[] = []
  for (let i = 0; i < BEAR_COUNT; i++) animals.push(placeGround(state, 'bear', open, placed, rand, animals.length))
  for (let i = 0; i < MOOSE_COUNT; i++) animals.push(placeGround(state, 'moose', open, placed, rand, animals.length))
  for (let i = 0; i < CROW_COUNT; i++) animals.push(placeCrow(state, rand, animals.length))
  for (let i = 0; i < EAGLE_COUNT; i++) animals.push(placeEagle(state, rand, animals.length))
  state.animals = animals
}

/** Wander and fly. Does nothing to units, fog, or the blocked grid. */
export function updateAnimals(state: MatchState, dt: number): void {
  const list = state.animals
  for (let index = 0; index < list.length; index++) {
    const animal = list[index]
    if (!animal) continue
    if (animal.kind === 'bear' || animal.kind === 'moose') wander(state, animal, index, dt)
    else if (animal.kind === 'crow') flyCrow(state, animal, index, dt)
    else circleEagle(animal, index, dt)
  }
}

function openTiles(state: MatchState): Array<[number, number]> {
  const open: Array<[number, number]> = []
  for (let ty = 0; ty < state.mapH; ty++) {
    for (let tx = 0; tx < state.mapW; tx++) {
      if (walkable(state, tx, ty)) open.push([tx, ty])
    }
  }
  return open
}

function placeGround(
  state: MatchState,
  kind: AnimalKind,
  open: Array<[number, number]>,
  placed: Array<[number, number]>,
  rand: () => number,
  index: number,
): Animal {
  const spot = takeSpot(open, placed, rand)
  const tx = spot?.[0] ?? 1
  const ty = spot?.[1] ?? 1
  placed.push([tx, ty])
  const animal: Animal = {
    kind,
    x: (tx + 0.5) * TILE,
    y: (ty + 0.5) * TILE,
    facing: 0,
    goalX: (tx + 0.5) * TILE,
    goalY: (ty + 0.5) * TILE,
    orbitX: 0,
    orbitY: 0,
    orbitR: 0,
    phase: hash2(index, 1, state.seed) * 8,
    turn: 0,
  }
  chooseGoal(state, animal, index)
  return animal
}

function takeSpot(
  open: Array<[number, number]>,
  placed: Array<[number, number]>,
  rand: () => number,
): [number, number] | null {
  if (open.length === 0) return null
  for (let n = 0; n < 48; n++) {
    const spot = open[(rand() * open.length) | 0]
    if (!spot) continue
    let clear = true
    for (const prev of placed) {
      if (Math.abs(prev[0] - spot[0]) + Math.abs(prev[1] - spot[1]) < 8) {
        clear = false
        break
      }
    }
    if (clear) return spot
  }
  return open[(rand() * open.length) | 0] ?? null
}

function placeCrow(state: MatchState, rand: () => number, index: number): Animal {
  const w = state.mapW * TILE
  const h = state.mapH * TILE
  const animal: Animal = {
    kind: 'crow',
    x: 16 + rand() * (w - 32),
    y: 16 + rand() * (h - 32),
    facing: rand() * Math.PI * 2,
    goalX: 0,
    goalY: 0,
    orbitX: 0,
    orbitY: 0,
    orbitR: 0,
    phase: rand() * 6,
    turn: index,
  }
  return animal
}

function placeEagle(state: MatchState, rand: () => number, index: number): Animal {
  const w = state.mapW * TILE
  const h = state.mapH * TILE
  const orbitR = 110 + rand() * 70
  const marginX = Math.min(orbitR + 24, w * 0.35)
  const marginY = Math.min(orbitR * 0.72 + 24, h * 0.35)
  const orbitX = marginX + rand() * Math.max(32, w - marginX * 2)
  const orbitY = marginY + rand() * Math.max(32, h - marginY * 2)
  const phase = rand() * Math.PI * 2
  const animal: Animal = {
    kind: 'eagle',
    x: 0,
    y: 0,
    facing: 0,
    goalX: 0,
    goalY: 0,
    orbitX,
    orbitY,
    orbitR,
    phase,
    turn: index,
  }
  layOnOrbit(animal)
  return animal
}

function wander(state: MatchState, animal: Animal, index: number, dt: number): void {
  const tx = Math.floor(animal.x / TILE)
  const ty = Math.floor(animal.y / TILE)
  if (!walkable(state, tx, ty)) {
    const spot = nearestOpen(state, tx, ty)
    if (!spot) return
    animal.x = (spot[0] + 0.5) * TILE
    animal.y = (spot[1] + 0.5) * TILE
    chooseGoal(state, animal, index)
    return
  }
  const dx = animal.goalX - animal.x
  const dy = animal.goalY - animal.y
  const dist = Math.hypot(dx, dy)
  if (dist < 8) {
    chooseGoal(state, animal, index)
    return
  }
  const speed = animal.kind === 'moose' ? MOOSE_SPEED : BEAR_SPEED
  const step = Math.min(dist, speed * dt)
  const nx = animal.x + (dx / dist) * step
  const ny = animal.y + (dy / dist) * step
  if (!walkable(state, Math.floor(nx / TILE), Math.floor(ny / TILE))) {
    chooseGoal(state, animal, index)
    return
  }
  animal.x = nx
  animal.y = ny
  animal.facing = Math.atan2(dy, dx)
  animal.phase += dt * (animal.kind === 'moose' ? 3.1 : 2.4)
}

function chooseGoal(state: MatchState, animal: Animal, index: number): void {
  animal.turn += 1
  const heading = hash2(index, animal.turn, state.seed) * Math.PI * 2
  const reach = 80 + hash2(index + 3, animal.turn, state.seed) * 160
  for (let attempt = 0; attempt < 10; attempt++) {
    const ang = heading + attempt * 0.62
    const tx = Math.floor((animal.x + Math.cos(ang) * reach) / TILE)
    const ty = Math.floor((animal.y + Math.sin(ang) * reach) / TILE)
    if (!walkable(state, tx, ty)) continue
    animal.goalX = (tx + 0.5) * TILE
    animal.goalY = (ty + 0.5) * TILE
    animal.facing = Math.atan2(animal.goalY - animal.y, animal.goalX - animal.x)
    return
  }
  const tx = Math.floor(animal.x / TILE)
  const ty = Math.floor(animal.y / TILE)
  const neighbors: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]
  const shift = animal.turn % neighbors.length
  for (let i = 0; i < neighbors.length; i++) {
    const dir = neighbors[(i + shift) % neighbors.length]
    if (!dir) continue
    const nx = tx + dir[0]
    const ny = ty + dir[1]
    if (!walkable(state, nx, ny)) continue
    animal.goalX = (nx + 0.5) * TILE
    animal.goalY = (ny + 0.5) * TILE
    animal.facing = Math.atan2(animal.goalY - animal.y, animal.goalX - animal.x)
    return
  }
}

function flyCrow(state: MatchState, animal: Animal, index: number, dt: number): void {
  const w = state.mapW * TILE
  const h = state.mapH * TILE
  const pad = 40
  if (animal.x < -pad || animal.y < -pad || animal.x > w + pad || animal.y > h + pad) {
    relaunchCrow(state, animal, index)
  }
  const speed = CROW_SPEED + (index % 5) * 6
  animal.x += Math.cos(animal.facing) * speed * dt
  animal.y += Math.sin(animal.facing) * speed * dt
  animal.phase += dt * 7
}

function relaunchCrow(state: MatchState, animal: Animal, index: number): void {
  animal.turn += 1
  const w = state.mapW * TILE
  const h = state.mapH * TILE
  const edge = Math.floor(hash2(index, animal.turn, state.seed) * 4) % 4
  const along = hash2(index + 5, animal.turn, state.seed)
  const drift = (hash2(index + 9, animal.turn, state.seed) - 0.5) * 0.55
  if (edge === 0) {
    animal.x = -12
    animal.y = along * h
    animal.facing = drift
  } else if (edge === 1) {
    animal.x = w + 12
    animal.y = along * h
    animal.facing = Math.PI + drift
  } else if (edge === 2) {
    animal.x = along * w
    animal.y = -12
    animal.facing = Math.PI / 2 + drift
  } else {
    animal.x = along * w
    animal.y = h + 12
    animal.facing = -Math.PI / 2 + drift
  }
}

function circleEagle(animal: Animal, index: number, dt: number): void {
  animal.phase += dt * (EAGLE_TURN + (index % 3) * 0.035)
  layOnOrbit(animal)
}

function layOnOrbit(animal: Animal): void {
  const ang = animal.phase
  animal.x = animal.orbitX + Math.cos(ang) * animal.orbitR
  animal.y = animal.orbitY + Math.sin(ang) * animal.orbitR * 0.72
  const tx = -Math.sin(ang) * animal.orbitR
  const ty = Math.cos(ang) * animal.orbitR * 0.72
  animal.facing = Math.atan2(ty, tx)
}

function walkable(state: MatchState, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= state.mapW || ty >= state.mapH) return false
  return state.blocked[ty * state.mapW + tx] === 0
}

function nearestOpen(state: MatchState, tx: number, ty: number): [number, number] | null {
  if (walkable(state, tx, ty)) return [tx, ty]
  for (let rad = 1; rad <= 8; rad++) {
    for (let y = ty - rad; y <= ty + rad; y++) {
      for (let x = tx - rad; x <= tx + rad; x++) {
        if (Math.abs(x - tx) !== rad && Math.abs(y - ty) !== rad) continue
        if (walkable(state, x, y)) return [x, y]
      }
    }
  }
  return null
}
