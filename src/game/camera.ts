import { MAP_PX_H, MAP_PX_W } from './types'

/** Closest the camera may come. Matches the previous wheel ceiling. */
export const ZOOM_MAX = 2

/**
 * Below this, sprites are taken from a zoom-step cache and scaled with the camera.
 * The art is the same as up close: ground, fog edges, rocks, trees, dumps, and units.
 * A fully zoomed-out 150×150 field stays in this band.
 */
export const FAR_ZOOM = 0.7

export interface Camera {
  x: number
  y: number
  zoom: number
}

/** Smallest zoom that still fits the whole map in the view. Never above {@link ZOOM_MAX}. */
export function fitZoom(viewW: number, viewH: number, mapPxW: number, mapPxH: number): number {
  const spanW = Math.max(1, mapPxW)
  const spanH = Math.max(1, mapPxH)
  const fit = Math.min(Math.max(1, viewW) / spanW, Math.max(1, viewH) / spanH)
  return Math.min(ZOOM_MAX, fit)
}

/**
 * Multiply zoom, keep it between the full-map fit and {@link ZOOM_MAX}, and hold
 * the world point under (anchorSx, anchorSy) still. Then frame the map.
 */
export function zoomToward(
  cam: Camera,
  viewW: number,
  viewH: number,
  mapPxW: number,
  mapPxH: number,
  factor: number,
  anchorSx: number,
  anchorSy: number,
): void {
  const before = screenToWorld(cam, anchorSx, anchorSy)
  const min = fitZoom(viewW, viewH, mapPxW, mapPxH)
  cam.zoom = Math.max(min, Math.min(ZOOM_MAX, cam.zoom * factor))
  cam.x = before.x - anchorSx / cam.zoom
  cam.y = before.y - anchorSy / cam.zoom
  clampCamera(cam, viewW, viewH, mapPxW, mapPxH)
}

export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: cam.x + sx / cam.zoom, y: cam.y + sy / cam.zoom }
}

export function worldToScreen(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom }
}

export function clampCamera(
  cam: Camera,
  viewW: number,
  viewH: number,
  mapPxW = MAP_PX_W,
  mapPxH = MAP_PX_H,
): void {
  const worldW = viewW / cam.zoom
  const worldH = viewH / cam.zoom
  if (worldW >= mapPxW) cam.x = (mapPxW - worldW) / 2
  else cam.x = Math.max(0, Math.min(mapPxW - worldW, cam.x))
  if (worldH >= mapPxH) cam.y = (mapPxH - worldH) / 2
  else cam.y = Math.max(0, Math.min(mapPxH - worldH, cam.y))
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
  cam.x = wx - viewW / (2 * cam.zoom)
  cam.y = wy - viewH / (2 * cam.zoom)
  clampCamera(cam, viewW, viewH, mapPxW, mapPxH)
}
