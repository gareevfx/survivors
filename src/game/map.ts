import { findPath } from './pathfind'
import { mulberry32 } from './rng'
import { BUILDING_STATS, FFA_MAP_H, FFA_MAP_W, MAP_H, MAP_W, TILE } from './types'

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

/**
 * One Silo in each corner of the 80×50 field, then shuffled so any side can
 * start in any corner. Each site sits as far into its corner as the window allows.
 */
export function pickFfaSites(seed: number): KeepSite[] {
  const rng = mulberry32(seed + 0x51ed)
  const margin = 2
  const south = FFA_MAP_H - margin - KEEP_H
  const east = FFA_MAP_W - margin - KEEP_W
  const corners = [
    pickCorner(rng, window(margin, south - 8, margin + 10, south), (site) => site.ty * 100 - site.tx),
    pickCorner(rng, window(east - 10, south - 8, east, south), (site) => site.ty * 100 + site.tx),
    pickCorner(rng, window(margin, margin, margin + 10, margin + 8), (site) => -site.ty * 100 - site.tx),
    pickCorner(rng, window(east - 10, margin, east, margin + 8), (site) => -site.ty * 100 + site.tx),
  ]
  for (let i = corners.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const swap = corners[i]
    corners[i] = corners[j] ?? corners[i]
    corners[j] = swap ?? corners[j]
  }
  return corners
}

function pickCorner(rng: () => number, sites: KeepSite[], score: (site: KeepSite) => number): KeepSite {
  let best = -Infinity
  for (const site of sites) {
    const value = score(site)
    if (value > best) best = value
  }
  const far = sites.filter((site) => score(site) >= best - 6)
  return far[Math.floor(rng() * far.length)] ?? sites[0] ?? { tx: 2, ty: 2 }
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
  mapW: number,
  mapH: number,
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
        if (tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) continue
        if (guarded(tx, ty)) continue
        tiles[ty * mapW + tx] = 0
        blocked[ty * mapW + tx] = 0
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
  sites: KeepSite[],
  mapW = MAP_W,
  mapH = MAP_H,
): { tiles: Uint8Array; ore: OreSpawn[] } {
  const rng = mulberry32(seed)
  const tiles = new Uint8Array(mapW * mapH)
  const guarded = (tx: number, ty: number) => sites.some((site) => inCamp(site, tx, ty))
  const at = (tx: number, ty: number) => ty * mapW + tx
  const blobs = mapW === MAP_W && mapH === MAP_H ? 96 : Math.round((96 * mapW * mapH) / (MAP_W * MAP_H))

  for (let i = 0; i < blobs; i++) {
    const cx = 2 + Math.floor(rng() * (mapW - 4))
    const cy = 2 + Math.floor(rng() * (mapH - 4))
    const rad = 1.15 + rng() * 2.3
    const grove = rng() < 0.42 ? 3 : 1
    for (let y = -4; y <= 4; y++) {
      for (let x = -4; x <= 4; x++) {
        if (x * x + y * y > rad * rad) continue
        const tx = cx + x
        const ty = cy + y
        if (tx < 1 || ty < 1 || tx >= mapW - 1 || ty >= mapH - 1) continue
        if (guarded(tx, ty)) continue
        const index = at(tx, ty)
        if (tiles[index] !== 0) continue
        tiles[index] = grove
      }
    }
  }

  for (let ty = 0; ty < mapH; ty++) {
    for (let tx = 0; tx < mapW; tx++) {
      if (guarded(tx, ty)) tiles[at(tx, ty)] = 0
    }
  }

  const ore: OreSpawn[] = []
  const add = (tx: number, ty: number) => {
    if (tx < 1 || ty < 1 || tx >= mapW - 1 || ty >= mapH - 1) return
    if (sites.some((site) => coversFootprint(site, tx, ty))) return
    tiles[at(tx, ty)] = 0
    if (!ore.some((spot) => spot.tx === tx && spot.ty === ty)) ore.push({ tx, ty })
  }
  const addBlock = (tx: number, ty: number, w: number, h: number) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) add(tx + x, ty + y)
    }
  }

  const rims = sites.map((site) => rimPatch(site, aimOf(site, sites), mapW, mapH))
  for (const rim of rims) {
    for (const [tx, ty] of rim) add(tx, ty)
  }

  for (const [tx, ty] of expansionPatches(mapW, mapH)) {
    if (sites.some((site) => nearCamp(site, tx, ty))) continue
    addBlock(tx, ty, 3, 2)
  }

  const rimGuard = new Set<number>()
  for (const rim of rims) {
    for (const [tx, ty] of rim) rimGuard.add(at(tx, ty))
  }
  const keepOre = (tx: number, ty: number) => guarded(tx, ty) || rimGuard.has(at(tx, ty))
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i]
    const rim = rims[i]
    if (!site || !rim) continue
    openMineralRoute(tiles, site, aimOf(site, sites), rim, mapW, mapH)
  }

  const anchors = sites.map((site) => campAnchor(site, mapW, mapH))
  const blocked = new Uint8Array(tiles)
  for (const node of ore) blocked[at(node.tx, node.ty)] = 1
  for (const anchor of anchors) {
    tiles[at(anchor.tx, anchor.ty)] = 0
    blocked[at(anchor.tx, anchor.ty)] = 0
  }
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const start = anchors[i]
      const goal = anchors[j]
      if (!start || !goal) continue
      if (!findPath(blocked, mapW, mapH, start.tx, start.ty, goal.tx, goal.ty)) {
        carve(tiles, blocked, ore, keepOre, start.tx, start.ty, goal.tx, goal.ty, mapW, mapH)
      }
    }
  }

  return { tiles, ore }
}

/** Duel keeps its original patch list. Free-for-all spreads patches across the 80×50 field, clear of the corner yards. */
function expansionPatches(mapW: number, mapH: number): Array<[number, number]> {
  if (mapW === MAP_W && mapH === MAP_H) {
    return [
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
  }
  const patches: Array<[number, number]> = []
  for (const ty of [13, 23, 33, 43]) {
    for (const tx of [24, 36, 48, 60]) patches.push([tx, ty])
  }
  return patches
}

function aimOf(site: KeepSite, sites: KeepSite[]): KeepSite {
  let x = 0
  let y = 0
  let n = 0
  for (const other of sites) {
    if (other.tx === site.tx && other.ty === site.ty) continue
    x += other.tx
    y += other.ty
    n += 1
  }
  if (n === 0) return { tx: site.tx + 1, ty: Math.max(0, site.ty - 1) }
  return { tx: x / n, ty: y / n }
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
function rimPatch(site: KeepSite, other: KeepSite, mapW: number, mapH: number): Array<[number, number]> {
  const dirX = other.tx - site.tx || 1
  const dirY = other.ty - site.ty || -1
  const chosen = growRim(site, dirX, dirY, RIM_MIN_R2, mapW, mapH)
  if (chosen.length >= 4) return chosen
  return growRim(site, dirX, dirY, RIM_MIN_R2 - 2, mapW, mapH)
}

function growRim(
  site: KeepSite,
  dirX: number,
  dirY: number,
  minR2: number,
  mapW: number,
  mapH: number,
): Array<[number, number]> {
  const maxR2 = RIM_MAX_R2
  const spots: Array<{ tx: number; ty: number; ix: number; iy: number; score: number }> = []
  for (let iy = -8; iy <= 8; iy++) {
    for (let ix = -8; ix <= 8; ix++) {
      const r2 = ix * ix + iy * iy
      if (r2 < minR2 || r2 > maxR2) continue
      const tx = site.tx + 1 + ix
      const ty = site.ty + 1 + iy
      if (tx < 1 || ty < 1 || tx >= mapW - 1 || ty >= mapH - 1) continue
      if (coversFootprint(site, tx, ty)) continue
      spots.push({ tx, ty, ix, iy, score: ix * dirX + iy * dirY })
    }
  }
  spots.sort((a, b) => b.score - a.score)
  const seed = spots[0]
  if (!seed) return []
  const chosen = [seed]
  const used = new Set<number>([seed.ty * mapW + seed.tx])
  while (chosen.length < 5) {
    let best: (typeof spots)[number] | null = null
    for (const spot of spots) {
      const key = spot.ty * mapW + spot.tx
      if (used.has(key)) continue
      const touch = chosen.some(
        (have) => Math.abs(have.ix - spot.ix) <= 1 && Math.abs(have.iy - spot.iy) <= 1,
      )
      if (!touch) continue
      if (!best || spot.score > best.score) best = spot
    }
    if (!best) break
    chosen.push(best)
    used.add(best.ty * mapW + best.tx)
  }
  return chosen.map((spot) => [spot.tx, spot.ty])
}

/** Clears rocks between a Castle and its rim minerals when they would seal the patch. */
function openMineralRoute(
  tiles: Uint8Array,
  site: KeepSite,
  other: KeepSite,
  patch: Array<[number, number]>,
  mapW: number,
  mapH: number,
): void {
  if (patch.length === 0) return
  const oreAt = new Set(patch.map(([tx, ty]) => ty * mapW + tx))
  const blocked = routeBlocked(tiles, site, oreAt, mapW, mapH)
  const dirX = other.tx - site.tx
  const dirY = other.ty - site.ty
  let start: [number, number] | null = null
  let startScore = Infinity
  for (let y = site.ty - 1; y <= site.ty + KEEP_H; y++) {
    for (let x = site.tx - 1; x <= site.tx + KEEP_W; x++) {
      if (coversFootprint(site, x, y)) continue
      if (x < 0 || y < 0 || x >= mapW || y >= mapH) continue
      if (blocked[y * mapW + x]) continue
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
    approachTiles(grid, patch, mapW, mapH).some(([gx, gy]) => findPath(grid, mapW, mapH, from[0], from[1], gx, gy))
  if (reaches(blocked)) return

  const homeX = site.tx + 1
  const homeY = site.ty + 1
  for (const [tx, ty] of patch) clearRockLine(tiles, site, oreAt, homeX, homeY, tx, ty, mapW, mapH)
  const opened = routeBlocked(tiles, site, oreAt, mapW, mapH)
  if (reaches(opened)) return
  for (const [tx, ty] of patch) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) clearRockTile(tiles, site, oreAt, tx + ox, ty + oy, mapW, mapH)
    }
  }
}

function routeBlocked(tiles: Uint8Array, site: KeepSite, oreAt: Set<number>, mapW: number, mapH: number): Uint8Array {
  const blocked = new Uint8Array(tiles)
  for (let y = 0; y < KEEP_H; y++) {
    for (let x = 0; x < KEEP_W; x++) {
      const tx = site.tx + x
      const ty = site.ty + y
      if (tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) continue
      blocked[ty * mapW + tx] = 1
    }
  }
  for (const index of oreAt) blocked[index] = 1
  return blocked
}

function approachTiles(
  blocked: Uint8Array,
  patch: Array<[number, number]>,
  mapW: number,
  mapH: number,
): Array<[number, number]> {
  const goals: Array<[number, number]> = []
  const seen = new Set<number>()
  for (const [tx, ty] of patch) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue
        const x = tx + ox
        const y = ty + oy
        if (x < 0 || y < 0 || x >= mapW || y >= mapH) continue
        const key = y * mapW + x
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
  mapW: number,
  mapH: number,
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
    clearRockTile(tiles, site, oreAt, x, y, mapW, mapH)
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
      clearRockTile(tiles, site, oreAt, x, prevY, mapW, mapH)
      clearRockTile(tiles, site, oreAt, prevX, y, mapW, mapH)
    }
  }
}

function clearRockTile(
  tiles: Uint8Array,
  site: KeepSite,
  oreAt: Set<number>,
  tx: number,
  ty: number,
  mapW: number,
  mapH: number,
): void {
  if (tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) return
  if (coversFootprint(site, tx, ty)) return
  if (oreAt.has(ty * mapW + tx)) return
  tiles[ty * mapW + tx] = 0
}

function campAnchor(site: KeepSite, mapW: number, mapH: number): KeepSite {
  return {
    tx: Math.max(1, Math.min(mapW - 2, site.tx + 1)),
    ty: Math.max(1, Math.min(mapH - 2, site.ty + 1)),
  }
}

/** Four worker tiles on the ring around a Castle, preferring the side away from the other camp. */
export function workerCamp(
  site: KeepSite,
  other: KeepSite,
  ore: OreSpawn[],
  mapW = MAP_W,
  mapH = MAP_H,
): Array<[number, number]> {
  const spots: Array<[number, number]> = []
  for (let y = site.ty - 1; y <= site.ty + KEEP_H; y++) {
    for (let x = site.tx - 1; x <= site.tx + KEEP_W; x++) {
      if (x >= site.tx && x < site.tx + KEEP_W && y >= site.ty && y < site.ty + KEEP_H) continue
      if (x < 1 || y < 1 || x >= mapW - 1 || y >= mapH - 1) continue
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
