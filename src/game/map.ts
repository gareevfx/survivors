import { findPath } from './pathfind'
import { mulberry32 } from './rng'
import { MAP_H, MAP_W, PLAYER_KEEP_TX, PLAYER_KEEP_TY } from './types'

export interface OreSpawn {
  tx: number
  ty: number
}

function protect(tx: number, ty: number): boolean {
  const player = tx >= 2 && tx <= 18 && ty >= 28 && ty <= 42
  const enemy = tx >= MAP_W - 19 && tx <= MAP_W - 3 && ty >= 2 && ty <= 16
  return player || enemy
}

function stampRock(tiles: Uint8Array, tx: number, ty: number): void {
  if (tx < 1 || ty < 1 || tx >= MAP_W - 1 || ty >= MAP_H - 1) return
  if (protect(tx, ty)) return
  tiles[ty * MAP_W + tx] = 1
}

function carve(
  tiles: Uint8Array,
  blocked: Uint8Array,
  ore: OreSpawn[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  let x = x0
  let y = y0
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  const guardMax = dx + dy + 4
  for (let guard = 0; guard < guardMax; guard++) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const tx = x + ox
        const ty = y + oy
        if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue
        if (protect(tx, ty)) continue
        tiles[ty * MAP_W + tx] = 0
        blocked[ty * MAP_W + tx] = 0
        const idx = ore.findIndex((o) => o.tx === tx && o.ty === ty)
        if (idx >= 0) ore.splice(idx, 1)
      }
    }
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }
}

export function generateBattlefield(seed: number): { tiles: Uint8Array; ore: OreSpawn[] } {
  const rng = mulberry32(seed)
  const tiles = new Uint8Array(MAP_W * MAP_H)

  for (let i = 0; i < 52; i++) {
    const cx = 2 + Math.floor(rng() * (MAP_W - 4))
    const cy = 2 + Math.floor(rng() * (MAP_H - 4))
    const rad = 1.15 + rng() * 2.3
    for (let y = -4; y <= 4; y++) {
      for (let x = -4; x <= 4; x++) {
        if (x * x + y * y > rad * rad) continue
        stampRock(tiles, cx + x, cy + y)
        stampRock(tiles, MAP_W - 1 - (cx + x), MAP_H - 1 - (cy + y))
      }
    }
  }

  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (protect(tx, ty)) tiles[ty * MAP_W + tx] = 0
    }
  }

  const ore: OreSpawn[] = []
  const add = (tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return
    tiles[ty * MAP_W + tx] = 0
    if (!ore.some((o) => o.tx === tx && o.ty === ty)) ore.push({ tx, ty })
  }

  const clusters: Array<Array<[number, number]>> = [
    [
      [12, 30],
      [13, 30],
      [14, 30],
      [12, 31],
      [13, 31],
      [14, 31],
      [12, 32],
      [13, 32],
    ],
    [
      [22, 33],
      [23, 33],
      [24, 33],
      [22, 34],
      [23, 34],
      [24, 34],
    ],
    [
      [28, 8],
      [29, 8],
      [30, 8],
      [28, 9],
      [29, 9],
    ],
    [
      [30, 36],
      [31, 36],
      [32, 36],
      [30, 37],
      [31, 37],
    ],
    [
      [36, 14],
      [37, 14],
      [38, 14],
      [36, 15],
      [37, 15],
    ],
    [
      [36, 28],
      [37, 28],
      [38, 28],
      [36, 29],
      [37, 29],
    ],
    [
      [46, 18],
      [47, 18],
      [48, 18],
      [46, 19],
      [47, 19],
      [48, 19],
      [47, 20],
      [48, 20],
    ],
  ]
  for (const cluster of clusters) {
    for (const [x, y] of cluster) {
      add(x, y)
      add(MAP_W - 1 - x, MAP_H - 1 - y)
    }
  }

  const startX = PLAYER_KEEP_TX + 4
  const startY = PLAYER_KEEP_TY + 4
  const goalX = MAP_W - 1 - startX
  const goalY = MAP_H - 1 - startY
  tiles[startY * MAP_W + startX] = 0
  tiles[goalY * MAP_W + goalX] = 0

  const blocked = new Uint8Array(tiles)
  for (const node of ore) blocked[node.ty * MAP_W + node.tx] = 1
  blocked[startY * MAP_W + startX] = 0
  blocked[goalY * MAP_W + goalX] = 0

  if (!findPath(blocked, MAP_W, MAP_H, startX, startY, goalX, goalY)) {
    carve(tiles, blocked, ore, startX, startY, goalX, goalY)
  }

  return { tiles, ore }
}
