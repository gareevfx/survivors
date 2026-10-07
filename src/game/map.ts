import { findPath } from './pathfind'
import { mulberry32 } from './rng'
import { BUILDING_STATS, MAP_H, MAP_W } from './types'

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
    for (let y = -4; y <= 4; y++) {
      for (let x = -4; x <= 4; x++) {
        if (x * x + y * y > rad * rad) continue
        const tx = cx + x
        const ty = cy + y
        if (tx < 1 || ty < 1 || tx >= MAP_W - 1 || ty >= MAP_H - 1) continue
        if (guarded(tx, ty)) continue
        tiles[ty * MAP_W + tx] = 1
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

  addBlock(homeOrigin(player, enemy).tx, homeOrigin(player, enemy).ty, 3, 3)
  addBlock(homeOrigin(enemy, player).tx, homeOrigin(enemy, player).ty, 3, 3)

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

  const start = campAnchor(player)
  const goal = campAnchor(enemy)
  tiles[start.ty * MAP_W + start.tx] = 0
  tiles[goal.ty * MAP_W + goal.tx] = 0
  const blocked = new Uint8Array(tiles)
  for (const node of ore) blocked[node.ty * MAP_W + node.tx] = 1
  blocked[start.ty * MAP_W + start.tx] = 0
  blocked[goal.ty * MAP_W + goal.tx] = 0
  if (!findPath(blocked, MAP_W, MAP_H, start.tx, start.ty, goal.tx, goal.ty)) {
    carve(tiles, blocked, ore, guarded, start.tx, start.ty, goal.tx, goal.ty)
  }

  return { tiles, ore }
}

function inCamp(site: KeepSite, tx: number, ty: number): boolean {
  return tx >= site.tx - 6 && tx <= site.tx + KEEP_W + 5 && ty >= site.ty - 6 && ty <= site.ty + KEEP_H + 5
}

function coversFootprint(site: KeepSite, tx: number, ty: number): boolean {
  return tx >= site.tx && ty >= site.ty && tx < site.tx + KEEP_W && ty < site.ty + KEEP_H
}

function nearCamp(site: KeepSite, tx: number, ty: number): boolean {
  const dx = tx - (site.tx + KEEP_W / 2)
  const dy = ty - (site.ty + KEEP_H / 2)
  return dx * dx + dy * dy < 15 * 15
}

/** A 3×3 patch just outside the Castle, toward the other base, inside starting sight. */
function homeOrigin(site: KeepSite, other: KeepSite): KeepSite {
  const dirX = Math.sign(other.tx - site.tx) || 1
  const dirY = Math.sign(other.ty - site.ty) || -1
  const tx = dirX > 0 ? site.tx + KEEP_W + 1 : site.tx - 3
  const ty = dirY > 0 ? site.ty + KEEP_H + 1 : site.ty - 3
  return {
    tx: Math.max(1, Math.min(MAP_W - 4, tx)),
    ty: Math.max(1, Math.min(MAP_H - 4, ty)),
  }
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
