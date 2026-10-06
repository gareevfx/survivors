import { clampCamera, screenToWorld, worldToScreen, type Camera } from './camera'
import {
  commandAttack,
  commandGather,
  commandMove,
  commandRally,
  commandStop,
  tryPlace,
  tryTrain,
} from './commands'
import { buildingById, buildingCenter, playerKeep, pushToast, unitById } from './state'
import {
  TILE,
  type BuildingKind,
  type MatchState,
  type UnitKind,
} from './types'

export interface DragRect {
  x: number
  y: number
  w: number
  h: number
}

interface Drag {
  pointerId: number
  button: number
  x0: number
  y0: number
  x1: number
  y1: number
  moved: boolean
  kind: 'mouse' | 'touch' | 'pen'
  panning: boolean
  lastX: number
  lastY: number
}

export interface InputController {
  pan(dt: number): void
  dragRect(): DragRect | null
  pointerWorld(): { x: number; y: number } | null
  clearGroups(): void
}

export function attachInput(opts: {
  canvas: HTMLCanvasElement
  getState: () => MatchState
  getCamera: () => Camera
  onMute: () => void
  onHelp: () => void
  closeHelp: () => void
  helpOpen: () => boolean
  onActivity: () => void
  selectIdle: () => void
  focusPoint: (x: number, y: number) => void
}): InputController {
  const keyAt = new Map<string, number>()
  const groups = new Map<number, number[]>()
  // Key repeat keeps this fresh. A keydown that never receives keyup stops panning
  // instead of dragging the camera across the map.
  const held = (code: string) => {
    const at = keyAt.get(code)
    return at != null && performance.now() - at < 1200
  }
  let pointer: { sx: number; sy: number; over: boolean } | null = null
  let drag: Drag | null = null
  let lastClick = { t: 0, id: -1 }

  const view = () => {
    const rect = opts.canvas.getBoundingClientRect()
    return { w: rect.width, h: rect.height, left: rect.left, top: rect.top }
  }

  const local = (event: MouseEvent) => {
    const box = view()
    return { x: event.clientX - box.left, y: event.clientY - box.top, box }
  }

  const worldAt = (sx: number, sy: number) => screenToWorld(opts.getCamera(), sx, sy)

  function armPlace(kind: BuildingKind): void {
    const state = opts.getState()
    if (state.outcome) return
    const keep = state.selectedBuilding != null ? buildingById(state, state.selectedBuilding) : undefined
    const porters = state.selectedUnits.some((id) => unitById(state, id)?.kind === 'porter')
    const keepOk = keep?.owner === 0 && keep.kind === 'keep'
    if (!porters && !keepOk && !state.units.some((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0)) {
      pushToast(state, 'Select a porter or the Keep first.')
      return
    }
    state.placement = state.placement === kind ? null : kind
    state.attackMoveArmed = false
    state.moveArmed = false
  }

  function trainSelected(kind: UnitKind): void {
    const state = opts.getState()
    const building = state.selectedBuilding != null ? buildingById(state, state.selectedBuilding) : undefined
    if (!building || building.owner !== 0) return
    const error = tryTrain(state, building.id, kind)
    if (error) pushToast(state, error)
  }

  function clearSelection(state: MatchState): void {
    state.selectedUnits = []
    state.selectedBuilding = null
  }

  function selectUnit(state: MatchState, id: number, shift: boolean): void {
    const unit = unitById(state, id)
    if (!unit || unit.owner !== 0 || unit.hp <= 0) {
      if (!shift) clearSelection(state)
      return
    }
    state.selectedBuilding = null
    if (shift) {
      const index = state.selectedUnits.indexOf(id)
      if (index >= 0) state.selectedUnits.splice(index, 1)
      else state.selectedUnits.push(id)
    } else {
      state.selectedUnits = [id]
    }
    state.events.push({ type: 'select' })
  }

  function onLeftClick(sx: number, sy: number, shift: boolean, touch: boolean): void {
    const state = opts.getState()
    if (state.outcome) return
    const world = worldAt(sx, sy)
    opts.onActivity()

    if (state.placement) {
      const tx = Math.floor(world.x / TILE)
      const ty = Math.floor(world.y / TILE)
      const porters = state.selectedUnits.filter((id) => unitById(state, id)?.kind === 'porter')
      const error = tryPlace(state, 0, state.placement, tx, ty, porters)
      if (error) pushToast(state, error)
      return
    }

    if (state.attackMoveArmed && state.selectedUnits.length) {
      commandMove(state, state.selectedUnits, world.x, world.y, true)
      state.attackMoveArmed = false
      return
    }
    if (state.moveArmed && state.selectedUnits.length) {
      commandMove(state, state.selectedUnits, world.x, world.y, false)
      state.moveArmed = false
      return
    }

    const hit = pick(state, world.x, world.y)
    if (touch && state.selectedUnits.length && hit?.type === 'unit') {
      const unit = unitById(state, hit.id)
      if (unit && unit.owner === 1) {
        commandAttack(state, state.selectedUnits, hit.id, 'unit')
        return
      }
    }
    if (touch && state.selectedUnits.length && hit?.type === 'building') {
      const building = buildingById(state, hit.id)
      if (building && building.owner === 1) {
        commandAttack(state, state.selectedUnits, hit.id, 'building')
        return
      }
    }
    if (touch && state.selectedUnits.length && (!hit || hit.type === 'ore')) {
      if (hit?.type === 'ore') commandGather(state, state.selectedUnits, hit.id)
      else commandMove(state, state.selectedUnits, world.x, world.y, false)
      return
    }

    if (!hit) {
      if (!shift) clearSelection(state)
      return
    }
    if (hit.type === 'unit') {
      const now = performance.now()
      if (!shift && hit.id === lastClick.id && now - lastClick.t < 280) {
        const unit = unitById(state, hit.id)
        if (unit && unit.owner === 0) {
          const box = view()
          const cam = opts.getCamera()
          state.selectedUnits = state.units
            .filter((other) => {
              if (other.owner !== 0 || other.kind !== unit.kind || other.hp <= 0) return false
              const screen = worldToScreen(cam, other.x, other.y)
              return screen.x >= 0 && screen.y >= 0 && screen.x <= box.w && screen.y <= box.h
            })
            .map((other) => other.id)
          state.selectedBuilding = null
          state.events.push({ type: 'select' })
        }
      } else {
        selectUnit(state, hit.id, shift)
      }
      lastClick = { t: now, id: hit.id }
      return
    }
    if (hit.type === 'building') {
      const building = buildingById(state, hit.id)
      if (!building || building.owner !== 0) {
        if (!shift) clearSelection(state)
        return
      }
      state.selectedBuilding = building.id
      state.selectedUnits = []
      state.events.push({ type: 'select' })
      lastClick = { t: performance.now(), id: -1 }
    }
  }

  function onRightClick(sx: number, sy: number): void {
    const state = opts.getState()
    if (state.outcome) return
    opts.onActivity()
    if (state.placement || state.attackMoveArmed || state.moveArmed) {
      state.placement = null
      state.attackMoveArmed = false
      state.moveArmed = false
      return
    }
    const world = worldAt(sx, sy)
    if (state.selectedBuilding != null && state.selectedUnits.length === 0) {
      commandRally(state, state.selectedBuilding, world.x, world.y)
      return
    }
    if (!state.selectedUnits.length) return
    const hit = pick(state, world.x, world.y)
    if (hit?.type === 'unit') {
      const unit = unitById(state, hit.id)
      if (unit && unit.owner === 1) {
        commandAttack(state, state.selectedUnits, hit.id, 'unit')
        return
      }
    }
    if (hit?.type === 'building') {
      const building = buildingById(state, hit.id)
      if (building && building.owner === 1) {
        commandAttack(state, state.selectedUnits, hit.id, 'building')
        return
      }
    }
    if (hit?.type === 'ore') {
      commandGather(state, state.selectedUnits, hit.id)
      return
    }
    commandMove(state, state.selectedUnits, world.x, world.y, false)
  }

  function boxSelect(x0: number, y0: number, x1: number, y1: number, shift: boolean): void {
    const state = opts.getState()
    if (state.outcome) return
    const cam = opts.getCamera()
    const a = screenToWorld(cam, x0, y0)
    const b = screenToWorld(cam, x1, y1)
    const minX = Math.min(a.x, b.x)
    const maxX = Math.max(a.x, b.x)
    const minY = Math.min(a.y, b.y)
    const maxY = Math.max(a.y, b.y)
    const ids = state.units
      .filter(
        (unit) =>
          unit.owner === 0 &&
          unit.hp > 0 &&
          unit.x >= minX &&
          unit.x <= maxX &&
          unit.y >= minY &&
          unit.y <= maxY,
      )
      .map((unit) => unit.id)
    if (shift) {
      const set = new Set(state.selectedUnits)
      for (const id of ids) set.add(id)
      state.selectedUnits = [...set]
    } else {
      state.selectedUnits = ids
    }
    if (ids.length) {
      state.selectedBuilding = null
      state.events.push({ type: 'select' })
    } else if (!shift) {
      state.selectedBuilding = null
    }
  }

  opts.canvas.addEventListener('contextmenu', (event) => event.preventDefault())

  opts.canvas.addEventListener('pointerdown', (event) => {
    opts.canvas.focus()
    const pos = local(event)
    pointer = { sx: pos.x, sy: pos.y, over: true }
    opts.onActivity()
    if (event.button === 2) {
      onRightClick(pos.x, pos.y)
      return
    }
    if (event.button !== 0) {
      drag = {
        pointerId: event.pointerId,
        button: event.button,
        x0: pos.x,
        y0: pos.y,
        x1: pos.x,
        y1: pos.y,
        moved: false,
        kind: event.pointerType === 'touch' ? 'touch' : 'mouse',
        panning: event.button === 1,
        lastX: pos.x,
        lastY: pos.y,
      }
      opts.canvas.setPointerCapture(event.pointerId)
      return
    }
    drag = {
      pointerId: event.pointerId,
      button: 0,
      x0: pos.x,
      y0: pos.y,
      x1: pos.x,
      y1: pos.y,
      moved: false,
      kind: event.pointerType === 'touch' ? 'touch' : event.pointerType === 'pen' ? 'pen' : 'mouse',
      panning: false,
      lastX: pos.x,
      lastY: pos.y,
    }
    opts.canvas.setPointerCapture(event.pointerId)
  })

  opts.canvas.addEventListener('pointermove', (event) => {
    const pos = local(event)
    pointer = { sx: pos.x, sy: pos.y, over: true }
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = pos.x - drag.lastX
    const dy = pos.y - drag.lastY
    drag.lastX = pos.x
    drag.lastY = pos.y
    drag.x1 = pos.x
    drag.y1 = pos.y
    if (Math.hypot(pos.x - drag.x0, pos.y - drag.y0) > 5) drag.moved = true
    const touchPan = drag.kind === 'touch' && drag.button === 0
    if (drag.panning || touchPan) {
      const cam = opts.getCamera()
      cam.x -= dx / cam.zoom
      cam.y -= dy / cam.zoom
      const box = view()
      clampCamera(cam, box.w, box.h)
      drag.panning = true
    }
  })

  const endDrag = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const finished = drag
    drag = null
    if (finished.panning) return
    if (finished.button !== 0) return
    if (finished.moved && finished.kind !== 'touch') {
      const state = opts.getState()
      if (!state.placement && !state.attackMoveArmed && !state.moveArmed) {
        boxSelect(finished.x0, finished.y0, finished.x1, finished.y1, event.shiftKey)
      }
      return
    }
    if (!finished.moved) onLeftClick(finished.x1, finished.y1, event.shiftKey, finished.kind === 'touch')
  }

  opts.canvas.addEventListener('pointerup', endDrag)
  opts.canvas.addEventListener('pointercancel', endDrag)
  opts.canvas.addEventListener('pointerleave', () => {
    if (pointer) pointer.over = false
  })
  opts.canvas.addEventListener('pointerenter', (event) => {
    const pos = local(event)
    pointer = { sx: pos.x, sy: pos.y, over: true }
  })

  opts.canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      const pos = local(event)
      const cam = opts.getCamera()
      const before = screenToWorld(cam, pos.x, pos.y)
      const next = cam.zoom * (event.deltaY > 0 ? 0.9 : 1.11)
      cam.zoom = Math.max(0.55, Math.min(2, next))
      cam.x = before.x - pos.x / cam.zoom
      cam.y = before.y - pos.y / cam.zoom
      const box = view()
      clampCamera(cam, box.w, box.h)
    },
    { passive: false },
  )

  window.addEventListener('keydown', (event) => {
    keyAt.set(event.code, performance.now())
    if (
      event.code === 'Space' ||
      event.code === 'ArrowUp' ||
      event.code === 'ArrowDown' ||
      event.code === 'ArrowLeft' ||
      event.code === 'ArrowRight'
    ) {
      event.preventDefault()
    }
    if (event.repeat) return
    const state = opts.getState()
    if (event.code === 'F1' || (event.code === 'Slash' && event.shiftKey)) {
      event.preventDefault()
      opts.onHelp()
      return
    }
    if (event.code === 'Escape') {
      if (opts.helpOpen()) {
        opts.closeHelp()
        return
      }
      state.placement = null
      state.attackMoveArmed = false
      state.moveArmed = false
      clearSelection(state)
      return
    }
    if (event.code === 'KeyM') {
      opts.onMute()
      return
    }
    if (state.outcome) return
    if (event.code === 'KeyQ' && state.selectedUnits.length) {
      state.attackMoveArmed = !state.attackMoveArmed
      state.moveArmed = false
      state.placement = null
      return
    }
    if (event.code === 'KeyX') {
      commandStop(state, state.selectedUnits)
      state.attackMoveArmed = false
      state.moveArmed = false
      return
    }
    if (event.code === 'KeyY') {
      armPlace('yard')
      return
    }
    if (event.code === 'KeyL') {
      armPlace('silo')
      return
    }
    if (event.code === 'KeyP') {
      trainSelected('porter')
      return
    }
    if (event.code === 'KeyK') {
      trainSelected('pike')
      return
    }
    if (event.code === 'KeyJ') {
      trainSelected('howler')
      return
    }
    if (event.code === 'KeyF') {
      opts.selectIdle()
      return
    }
    if (event.code === 'Space') {
      const selected = state.selectedUnits
        .map((id) => unitById(state, id))
        .filter((unit): unit is NonNullable<typeof unit> => !!unit && unit.hp > 0)
      if (selected.length) {
        const x = selected.reduce((sum, unit) => sum + unit.x, 0) / selected.length
        const y = selected.reduce((sum, unit) => sum + unit.y, 0) / selected.length
        opts.focusPoint(x, y)
        return
      }
      if (state.selectedBuilding != null) {
        const building = buildingById(state, state.selectedBuilding)
        if (building) {
          const center = buildingCenter(building)
          opts.focusPoint(center.x, center.y)
          return
        }
      }
      const keep = playerKeep(state)
      if (keep) {
        const center = buildingCenter(keep)
        opts.focusPoint(center.x, center.y + 30)
      }
      return
    }
    if (event.code.startsWith('Digit')) {
      const n = Number(event.code.slice(5))
      if (n < 1 || n > 9) return
      if (event.ctrlKey || event.metaKey) {
        groups.set(n, state.selectedUnits.slice())
        pushToast(state, `Group ${n} saved.`)
        return
      }
      const ids = (groups.get(n) ?? []).filter((id) => {
        const unit = unitById(state, id)
        return !!unit && unit.hp > 0 && unit.owner === 0
      })
      groups.set(n, ids)
      if (!ids.length) return
      state.selectedUnits = ids.slice()
      state.selectedBuilding = null
      state.events.push({ type: 'select' })
      if (lastClick.id === -100 - n && performance.now() - lastClick.t < 350) {
        const members = ids
          .map((id) => unitById(state, id))
          .filter((unit): unit is NonNullable<typeof unit> => !!unit)
        if (members.length) {
          const x = members.reduce((sum, unit) => sum + unit.x, 0) / members.length
          const y = members.reduce((sum, unit) => sum + unit.y, 0) / members.length
          opts.focusPoint(x, y)
        }
      }
      lastClick = { t: performance.now(), id: -100 - n }
    }
  })

  window.addEventListener('keyup', (event) => {
    keyAt.delete(event.code)
  })
  window.addEventListener('blur', () => {
    keyAt.clear()
  })

  return {
    pan(dt: number) {
      const cam = opts.getCamera()
      const box = view()
      const speed = 740 / cam.zoom
      let dx = 0
      let dy = 0
      if (held('KeyW') || held('ArrowUp')) dy -= 1
      if (held('KeyS') || held('ArrowDown')) dy += 1
      if (held('KeyA') || held('ArrowLeft')) dx -= 1
      if (held('KeyD') || held('ArrowRight')) dx += 1
      if (pointer?.over && !drag?.panning && !opts.helpOpen()) {
        const margin = 8
        if (pointer.sx < margin) dx -= 1
        if (pointer.sx > box.w - margin) dx += 1
        if (pointer.sy < margin) dy -= 1
        if (pointer.sy > box.h - margin) dy += 1
      }
      if (dx === 0 && dy === 0) return
      const len = Math.hypot(dx, dy) || 1
      cam.x += (dx / len) * speed * dt
      cam.y += (dy / len) * speed * dt
      clampCamera(cam, box.w, box.h)
    },
    dragRect() {
      if (!drag || drag.panning || drag.kind === 'touch' || !drag.moved || drag.button !== 0) return null
      const x = Math.min(drag.x0, drag.x1)
      const y = Math.min(drag.y0, drag.y1)
      return { x, y, w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) }
    },
    pointerWorld() {
      if (!pointer?.over) return null
      return worldAt(pointer.sx, pointer.sy)
    },
    clearGroups() {
      groups.clear()
    },
  }
}

function pick(
  state: MatchState,
  x: number,
  y: number,
): { type: 'unit' | 'building' | 'ore'; id: number } | null {
  for (const node of state.ore) {
    const cx = (node.tx + 0.5) * TILE
    const cy = (node.ty + 0.5) * TILE
    if (Math.hypot(cx - x, cy - y) <= 14) return { type: 'ore', id: node.id }
  }
  let best: { id: number; d: number } | null = null
  for (const unit of state.units) {
    if (unit.hp <= 0) continue
    const d = Math.hypot(unit.x - x, unit.y - y)
    const reach = (unit.kind === 'howler' ? 12 : 10) + 6
    if (d <= reach && (!best || d < best.d)) best = { id: unit.id, d }
  }
  if (best) return { type: 'unit', id: best.id }
  for (let i = state.buildings.length - 1; i >= 0; i--) {
    const building = state.buildings[i]
    if (!building || building.hp <= 0) continue
    const rect = {
      x: building.tx * TILE,
      y: building.ty * TILE,
      w: (building.kind === 'keep' || building.kind === 'yard' ? 3 : 2) * TILE,
      h: (building.kind === 'keep' ? 3 : 2) * TILE,
    }
    if (x >= rect.x && y >= rect.y && x <= rect.x + rect.w && y <= rect.y + rect.h) {
      return { type: 'building', id: building.id }
    }
  }
  return null
}
