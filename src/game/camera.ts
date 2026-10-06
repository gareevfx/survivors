import { MAP_PX_H, MAP_PX_W } from './types'

export interface Camera {
  x: number
  y: number
  zoom: number
}

export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: cam.x + sx / cam.zoom, y: cam.y + sy / cam.zoom }
}

export function worldToScreen(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom }
}

export function clampCamera(cam: Camera, viewW: number, viewH: number): void {
  const worldW = viewW / cam.zoom
  const worldH = viewH / cam.zoom
  if (worldW >= MAP_PX_W) cam.x = (MAP_PX_W - worldW) / 2
  else cam.x = Math.max(0, Math.min(MAP_PX_W - worldW, cam.x))
  if (worldH >= MAP_PX_H) cam.y = (MAP_PX_H - worldH) / 2
  else cam.y = Math.max(0, Math.min(MAP_PX_H - worldH, cam.y))
}

export function centerCamera(
  cam: Camera,
  wx: number,
  wy: number,
  viewW: number,
  viewH: number,
): void {
  cam.x = wx - viewW / (2 * cam.zoom)
  cam.y = wy - viewH / (2 * cam.zoom)
  clampCamera(cam, viewW, viewH)
}
