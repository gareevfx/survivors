import { isoBounds, isoToWorld, worldToIso } from './iso'
import { MAP_PX_H, MAP_PX_W } from './types'

export interface Camera {
  /** Iso-space point at the top-left of the view. */
  x: number
  y: number
  zoom: number
}

export { worldToIso } from './iso'

export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return isoToWorld(cam.x + sx / cam.zoom, cam.y + sy / cam.zoom)
}

export function worldToScreen(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  const iso = worldToIso(wx, wy)
  return { x: (iso.x - cam.x) * cam.zoom, y: (iso.y - cam.y) * cam.zoom }
}

export function clampCamera(
  cam: Camera,
  viewW: number,
  viewH: number,
  mapPxW = MAP_PX_W,
  mapPxH = MAP_PX_H,
): void {
  const bounds = isoBounds(mapPxW, mapPxH)
  const pad = 120
  const minX = bounds.minX - pad
  const maxX = bounds.maxX + pad
  const minY = bounds.minY - pad
  const maxY = bounds.maxY + pad
  const spanX = maxX - minX
  const spanY = maxY - minY
  const visW = viewW / cam.zoom
  const visH = viewH / cam.zoom
  if (visW >= spanX) cam.x = minX + (spanX - visW) / 2
  else cam.x = Math.max(minX, Math.min(maxX - visW, cam.x))
  if (visH >= spanY) cam.y = minY + (spanY - visH) / 2
  else cam.y = Math.max(minY, Math.min(maxY - visH, cam.y))
}

export function centerCamera(
  cam: Camera,
  wx: number,
  wy: number,
  viewW: number,
  viewH: number,
  mapPxW = MAP_PX_W,
  mapPxH = MAP_PX_H,
): void {
  const iso = worldToIso(wx, wy)
  cam.x = iso.x - viewW / (2 * cam.zoom)
  cam.y = iso.y - viewH / (2 * cam.zoom)
  clampCamera(cam, viewW, viewH, mapPxW, mapPxH)
}
