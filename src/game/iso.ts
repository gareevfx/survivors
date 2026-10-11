/** 2:1 isometric projection. World pixels stay the simulation's coordinates. */

const TILE = 32

export function worldToIso(wx: number, wy: number): { x: number; y: number } {
  return { x: wx - wy, y: (wx + wy) * 0.5 }
}

export function isoToWorld(ix: number, iy: number): { x: number; y: number } {
  return { x: iy + ix * 0.5, y: iy - ix * 0.5 }
}

/** Screen direction of one snapped facing. +forward is the nose; +side is the unit's right. */
export function isoFacingBasis(dir: number): { ang: number; fx: number; fy: number; sx: number; sy: number } {
  const ang = dir * (Math.PI / 4)
  const wfx = Math.cos(ang)
  const wfy = Math.sin(ang)
  const ix = wfx - wfy
  const iy = (wfx + wfy) * 0.5
  const len = Math.hypot(ix, iy) || 1
  const fx = ix / len
  const fy = iy / len
  return { ang: Math.atan2(fy, fx), fx, fy, sx: -fy, sy: fx }
}

/** Iso-space bounds of a world rectangle from (0,0) to (mapPxW, mapPxH). */
export function isoBounds(mapPxW: number, mapPxH: number): { minX: number; minY: number; maxX: number; maxY: number } {
  const corners = [
    worldToIso(0, 0),
    worldToIso(mapPxW, 0),
    worldToIso(0, mapPxH),
    worldToIso(mapPxW, mapPxH),
  ]
  let minX = corners[0]?.x ?? 0
  let maxX = minX
  let minY = corners[0]?.y ?? 0
  let maxY = minY
  for (const corner of corners) {
    minX = Math.min(minX, corner.x)
    maxX = Math.max(maxX, corner.x)
    minY = Math.min(minY, corner.y)
    maxY = Math.max(maxY, corner.y)
  }
  return { minX, minY, maxX, maxY }
}

/** North corner of a tile, in iso space. */
export function tileNorth(tx: number, ty: number): { x: number; y: number } {
  return worldToIso(tx * TILE, ty * TILE)
}
