import { findPath } from './pathfind'
import { mulberry32 } from './rng'
import { BUILDING_STATS, MAP_H, MAP_W, TILE } from './types'

export interface OreSpawn {
  tx: number
  ty: number
}

export interface KeepSite {
  tx: number
  ty: number
}

const KEEP_W = BUILDING_STATS.keep.w
const KEEP_H = BUILDING_STATS.keep.h
/** Open tiles around each Castle footprint, with no rocks or trees. */
export const CASTLE_YARD = 9
const KEEP_SIGHT = BUILDING_STATS.keep.sight
/** Largest integer tile-offset whose center still falls inside Castle sight. */
const RIM_MAX_R2 = Math.floor((KEEP_SIGHT * KEEP_SIGHT) / (TILE * TILE))
/** Nearest offset still within one tile of that sight edge. */
const RIM_MIN_R2 = Math.ceil(((KEEP_SIGHT - TILE) * (KEEP_SIGHT - TILE)) / (TILE * TILE))

/**
 * Opposite corners are the longest camps on this map. Northmark takes the southern
 * site of a random pair near that maximum, so each match shifts but the two Castles
 * stay as far apart as the corners allow.
 */
export function pickKeepSites(seed: number): { player: KeepSite; enemy: KeepSite } {
  const rng = mulberry32(seed + 0x51ed)
  const margin = 2
  const slack = 6
  const southWest = window(margin, MAP_H - margin - KEEP_H - 8, margin + 10, MAP_H - margin - KEEP_H)
  const southEast = window(MAP_W - margin - KEEP_W - 10, MAP_H - margin - KEEP_H - 8, MAP_W - margin - KEEP_W, MAP_H - margin - KEEP_H)
  const northWest = window(margin, margin, margin + 10, margin + 8)
  const northEast = window(MAP_W - margin - KEEP_W - 10, margin, MAP_W - margin - KEEP_W, margin + 8)
  const pairings = [
    [southWest, northEast],
    [southEast, northWest],
  ]
  let max = 0
  const pairs: Array<{ player: KeepSite; enemy: KeepSite; distance: number }> = []
  for (const [south, north] of pairings) {
    for (const player of south) {
      for (const enemy of north) {
        const distance = centerDistance(player, enemy)
        if (distance > max) max = distance
        pairs.push({ player, enemy, distance })
      }
    }
  }
  const far = pairs.filter((pair) => pair.distance >= max - slack)
  const pick = far[Math.floor(rng() * far.length)] ?? pairs[0]
  if (!pick) return { player: { tx: margin, ty: MAP_H - margin - KEEP_H }, enemy: { tx: MAP_W - margin - KEEP_W, ty: margin } }
  return { player: pick.player, enemy: pick.enemy }
}

function window(x0: number, y0: number, x1: number, y1: number): KeepSite[] {
  const sites: KeepSite[] = []
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) sites.push({ tx, ty })
  }
  return sites
}

function centerDistance(a: KeepSite, b: KeepSite): number {
  const dx = a.tx + KEEP_W / 2 - (b.tx + KEEP_W / 2)
  const dy = a.ty + KEEP_H / 2 - (b.ty + KEEP_H / 2)
  return Math.hypot(dx, dy)
}

function carve(
  tiles: Uint8Array,
  blocked: Uint8Array,
  ore: OreSpawn[],
  guarded: (tx: number, ty: number) => boolean,
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
        if (guarded(tx, ty)) continue
        tiles[ty * MAP_W + tx] = 0
        blocked[ty * MAP_W + tx] = 0
        const idx = ore.findIndex((spot) => spot.tx === tx && spot.ty === ty)
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

export function generateBattlefield(
  seed: number,
  player: KeepSite,
  enemy: KeepSite,
): { tiles: Uint8Array; ore: OreSpawn[] } {
  const rng = mulberry32(seed)
  const tiles = new Uint8Array(MAP_W * MAP_H)
  const camps = [player, enemy]
  const guarded = (tx: number, ty: number) => camps.some((site) => inCamp(site, tx, ty))

  for (let i = 0; i < 96; i++) {
    const cx = 2 + Math.floor(rng() * (MAP_W - 4))
    const cy = 2 + Math.floor(rng() * (MAP_H - 4))
    const rad = 1.15 + rng() * 2.3
    const grove = rng() < 0.42 ? 3 : 1
    for (let y = -4; y <= 4; y++) {
      for (let x = -4; x <= 4; x++) {
        if (x * x + y * y > rad * rad) continue
        const tx = cx + x
        const ty = cy + y
        if (tx < 1 || ty < 1 || tx >= MAP_W - 1 || ty >= MAP_H - 1) continue
        if (guarded(tx, ty)) continue
        const index = ty * MAP_W + tx
        if (tiles[index] !== 0) continue
        tiles[index] = grove
      }
    }
  }

  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (guarded(tx, ty)) tiles[ty * MAP_W + tx] = 0
    }
  }

  const ore: OreSpawn[] = []
  const add = (tx: number, ty: number) => {
    if (tx < 1 || ty < 1 || tx >= MAP_W - 1 || ty >= MAP_H - 1) return
    if (camps.some((site) => coversFootprint(site, tx, ty))) return
    tiles[ty * MAP_W + tx] = 0
    if (!ore.some((spot) => spot.tx === tx && spot.ty === ty)) ore.push({ tx, ty })
  }
  const addBlock = (tx: number, ty: number, w: number, h: number) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) add(tx + x, ty + y)
    }
  }

  const playerRim = rimPatch(player, enemy)
  const enemyRim = rimPatch(enemy, player)
  for (const [tx, ty] of playerRim) add(tx, ty)
  for (const [tx, ty] of enemyRim) add(tx, ty)

  const expansions: Array<[number, number]> = [
    [24, 10],
    [36, 8],
    [48, 11],
    [22, 20],
    [34, 18],
    [46, 21],
    [28, 30],
    [40, 27],
    [52, 31],
    [18, 16],
    [58, 16],
  ]
  for (const [tx, ty] of expansions) {
    if (nearCamp(player, tx, ty) || nearCamp(enemy, tx, ty)) continue
    addBlock(tx, ty, 3, 2)
  }

  const rimGuard = new Set<number>()
  for (const [tx, ty] of playerRim) rimGuard.add(ty * MAP_W + tx)
  for (const [tx, ty] of enemyRim) rimGuard.add(ty * MAP_W + tx)
  const keepOre = (tx: number, ty: number) => guarded(tx, ty) || rimGuard.has(ty * MAP_W + tx)
  openMineralRoute(tiles, player, enemy, playerRim)
  openMineralRoute(tiles, enemy, player, enemyRim)

  const start = campAnchor(player)
  const goal = campAnchor(enemy)
  tiles[start.ty * MAP_W + start.tx] = 0
  tiles[goal.ty * MAP_W + goal.tx] = 0
  const blocked = new Uint8Array(tiles)
  for (const node of ore) blocked[node.ty * MAP_W + node.tx] = 1
  blocked[start.ty * MAP_W + start.tx] = 0
  blocked[goal.ty * MAP_W + goal.tx] = 0
  if (!findPath(blocked, MAP_W, MAP_H, start.tx, start.ty, goal.tx, goal.ty)) {
    carve(tiles, blocked, ore, keepOre, start.tx, start.ty, goal.tx, goal.ty)
  }

  return { tiles, ore }
}

function inCamp(site: KeepSite, tx: number, ty: number): boolean {
  return (
    tx >= site.tx - CASTLE_YARD &&
    tx <= site.tx + KEEP_W - 1 + CASTLE_YARD &&
    ty >= site.ty - CASTLE_YARD &&
    ty <= site.ty + KEEP_H - 1 + CASTLE_YARD
  )
}

function coversFootprint(site: KeepSite, tx: number, ty: number): boolean {
  return tx >= site.tx && ty >= site.ty && tx < site.tx + KEEP_W && ty < site.ty + KEEP_H
}

function nearCamp(site: KeepSite, tx: number, ty: number): boolean {
  const dx = tx - (site.tx + KEEP_W / 2)
  const dy = ty - (site.ty + KEEP_H / 2)
  return dx * dx + dy * dy < 15 * 15
}

/**
 * Starting minerals on the outer rim of Castle sight. Tile centers are an integer
 * offset from the Castle center, and only offsets whose length sits inside the
 * sight circle and within one tile of it are used. The same rule is applied to
 * both camps, aimed at the other Castle.
 */
function rimPatch(site: KeepSite, other: KeepSite): Array<[number, number]> {
  const dirX = other.tx - site.tx || 1
  const dirY = other.ty - site.ty || -1
  const chosen = growRim(site, dirX, dirY, RIM_MIN_R2)
  if (chosen.length >= 4) return chosen
  return growRim(site, dirX, dirY, RIM_MIN_R2 - 2)
}

function growRim(site: KeepSite, dirX: number, dirY: number, minR2: number): Array<[number, number]> {
  const maxR2 = RIM_MAX_R2
  const spots: Array<{ tx: number; ty: number; ix: number; iy: number; score: number }> = []
  for (let iy = -8; iy <= 8; iy++) {
    for (let ix = -8; ix <= 8; ix++) {
      const r2 = ix * ix + iy * iy
      if (r2 < minR2 || r2 > maxR2) continue
      const tx = site.tx + 1 + ix
      const ty = site.ty + 1 + iy
      if (tx < 1 || ty < 1 || tx >= MAP_W - 1 || ty >= MAP_H - 1) continue
      if (coversFootprint(site, tx, ty)) continue
      spots.push({ tx, ty, ix, iy, score: ix * dirX + iy * dirY })
    }
  }
  spots.sort((a, b) => b.score - a.score)
  const seed = spots[0]
  if (!seed) return []
  const chosen = [seed]
  const used = new Set<number>([seed.ty * MAP_W + seed.tx])
  while (chosen.length < 5) {
    let best: (typeof spots)[number] | null = null
    for (const spot of spots) {
      const key = spot.ty * MAP_W + spot.tx
      if (used.has(key)) continue
      const touch = chosen.some(
        (have) => Math.abs(have.ix - spot.ix) <= 1 && Math.abs(have.iy - spot.iy) <= 1,
      )
      if (!touch) continue
      if (!best || spot.score > best.score) best = spot
    }
    if (!best) break
    chosen.push(best)
    used.add(best.ty * MAP_W + best.tx)
  }
  return chosen.map((spot) => [spot.tx, spot.ty])
}

/** Clears rocks between a Castle and its rim minerals when they would seal the patch. */
function openMineralRoute(
  tiles: Uint8Array,
  site: KeepSite,
  other: KeepSite,
  patch: Array<[number, number]>,
): void {
  if (patch.length === 0) return
  const oreAt = new Set(patch.map(([tx, ty]) => ty * MAP_W + tx))
  const blocked = routeBlocked(tiles, site, oreAt)
  const dirX = other.tx - site.tx
  const dirY = other.ty - site.ty
  let start: [number, number] | null = null
  let startScore = Infinity
  for (let y = site.ty - 1; y <= site.ty + KEEP_H; y++) {
    for (let x = site.tx - 1; x <= site.tx + KEEP_W; x++) {
      if (coversFootprint(site, x, y)) continue
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue
      if (blocked[y * MAP_W + x]) continue
      const score = (x - site.tx) * dirX + (y - site.ty) * dirY
      if (score < startScore) {
        startScore = score
        start = [x, y]
      }
    }
  }
  if (!start) return
  const from = start
  const reaches = (grid: Uint8Array) =>
    approachTiles(grid, patch).some(([gx, gy]) => findPath(grid, MAP_W, MAP_H, from[0], from[1], gx, gy))
  if (reaches(blocked)) return

  const homeX = site.tx + 1
  const homeY = site.ty + 1
  for (const [tx, ty] of patch) clearRockLine(tiles, site, oreAt, homeX, homeY, tx, ty)
  const opened = routeBlocked(tiles, site, oreAt)
  if (reaches(opened)) return
  for (const [tx, ty] of patch) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) clearRockTile(tiles, site, oreAt, tx + ox, ty + oy)
    }
  }
}

function routeBlocked(tiles: Uint8Array, site: KeepSite, oreAt: Set<number>): Uint8Array {
  const blocked = new Uint8Array(tiles)
  for (let y = 0; y < KEEP_H; y++) {
    for (let x = 0; x < KEEP_W; x++) {
      const tx = site.tx + x
      const ty = site.ty + y
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue
      blocked[ty * MAP_W + tx] = 1
    }
  }
  for (const index of oreAt) blocked[index] = 1
  return blocked
}

function approachTiles(blocked: Uint8Array, patch: Array<[number, number]>): Array<[number, number]> {
  const goals: Array<[number, number]> = []
  const seen = new Set<number>()
  for (const [tx, ty] of patch) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue
        const x = tx + ox
        const y = ty + oy
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue
        const key = y * MAP_W + x
        if (seen.has(key) || blocked[key]) continue
        seen.add(key)
        goals.push([x, y])
      }
    }
  }
  return goals
}

function clearRockLine(
  tiles: Uint8Array,
  site: KeepSite,
  oreAt: Set<number>,
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
    clearRockTile(tiles, site, oreAt, x, y)
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    const prevX = x
    const prevY = y
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
    if (x !== prevX && y !== prevY) {
      clearRockTile(tiles, site, oreAt, x, prevY)
      clearRockTile(tiles, site, oreAt, prevX, y)
    }
  }
}

function clearRockTile(
  tiles: Uint8Array,
  site: KeepSite,
  oreAt: Set<number>,
  tx: number,
  ty: number,
): void {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return
  if (coversFootprint(site, tx, ty)) return
  if (oreAt.has(ty * MAP_W + tx)) return
  tiles[ty * MAP_W + tx] = 0
}

function campAnchor(site: KeepSite): KeepSite {
  return {
    tx: Math.max(1, Math.min(MAP_W - 2, site.tx + 1)),
    ty: Math.max(1, Math.min(MAP_H - 2, site.ty + 1)),
  }
}

/** Four worker tiles on the ring around a Castle, preferring the side away from the other camp. */
export function workerCamp(site: KeepSite, other: KeepSite, ore: OreSpawn[]): Array<[number, number]> {
  const spots: Array<[number, number]> = []
  for (let y = site.ty - 1; y <= site.ty + KEEP_H; y++) {
    for (let x = site.tx - 1; x <= site.tx + KEEP_W; x++) {
      if (x >= site.tx && x < site.tx + KEEP_W && y >= site.ty && y < site.ty + KEEP_H) continue
      if (x < 1 || y < 1 || x >= MAP_W - 1 || y >= MAP_H - 1) continue
      if (ore.some((spot) => spot.tx === x && spot.ty === y)) continue
      spots.push([x, y])
    }
  }
  const ox = other.tx - site.tx
  const oy = other.ty - site.ty
  spots.sort((a, b) => {
    const da = (a[0] - site.tx) * ox + (a[1] - site.ty) * oy
    const db = (b[0] - site.tx) * ox + (b[1] - site.ty) * oy
    return da - db
  })
  return spots.slice(0, 4)
}
