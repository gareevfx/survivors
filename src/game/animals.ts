import { hash2, mulberry32 } from './rng'
import { FFA_MAP_H, FFA_MAP_W, TILE, type Animal, type MatchState } from './types'

/** Fixed handful on the duel field and the 4-player free-for-all. Larger maps scale by area. */
export const CROW_COUNT = 6

/** Crows for a map. The count stays put through 90×50, then grows with the field. */
export function animalCounts(mapW: number, mapH: number): { crow: number } {
  const base = FFA_MAP_W * FFA_MAP_H
  const scale = mapW * mapH <= base ? 1 : (mapW * mapH) / base
  return { crow: Math.max(CROW_COUNT, Math.round(CROW_COUNT * scale)) }
}

const CROW_SPEED = 84

/** Place crows on a fresh match. */
export function spawnAnimals(state: MatchState): void {
  const rand = mulberry32(state.seed ^ 0x51f15e)
  const quota = animalCounts(state.mapW, state.mapH)
  const animals: Animal[] = []
  for (let i = 0; i < quota.crow; i++) animals.push(placeCrow(state, rand, animals.length))
  state.animals = animals
}

/** Fly the crows. Does nothing to units, fog, or the blocked grid. */
export function updateAnimals(state: MatchState, dt: number): void {
  const list = state.animals
  for (let index = 0; index < list.length; index++) {
    const animal = list[index]
    if (!animal) continue
    flyCrow(state, animal, index, dt)
  }
}

function placeCrow(state: MatchState, rand: () => number, index: number): Animal {
  const w = state.mapW * TILE
  const h = state.mapH * TILE
  return {
    kind: 'crow',
    x: 16 + rand() * (w - 32),
    y: 16 + rand() * (h - 32),
    facing: rand() * Math.PI * 2,
    phase: rand() * 6,
    turn: index,
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
