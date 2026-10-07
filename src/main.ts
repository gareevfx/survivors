import './style.css'
import { Sfx } from './game/audio'
import { centerCamera, clampCamera, type Camera } from './game/camera'
import { attachInput } from './game/input'
import { buildTerrain, renderMinimap, renderWorld } from './game/render'
import { step } from './game/sim'
import { buildingCenter, createMatch, playerKeep, pushToast, unitById } from './game/state'
import type { MatchState } from './game/types'
import { resetHudCache, syncHud } from './ui/hud'

const view = document.querySelector<HTMLCanvasElement>('#view')
const minimap = document.querySelector<HTMLCanvasElement>('#minimap')
const help = document.querySelector<HTMLElement>('#help')
const helpButton = document.querySelector<HTMLButtonElement>('#help-btn')
const hintClose = document.querySelector<HTMLButtonElement>('#hint-x')
const again = document.querySelector<HTMLButtonElement>('#again')
const idle = document.querySelector<HTMLButtonElement>('#idle')
const muteButton = document.querySelector<HTMLButtonElement>('#mute')

if (!view || !minimap || !help) {
  throw new Error('Ridgekeep failed to find its canvas.')
}

const stage: HTMLCanvasElement = view
const mini: HTMLCanvasElement = minimap
const helpPanel: HTMLElement = help

const sfx = new Sfx()
let match: MatchState = createMatch((Math.random() * 1_000_000_000) | 0)
let terrain = buildTerrain(match.seed)
const camera: Camera = { x: 0, y: 0, zoom: 1.35 }

function frameSize(): { w: number; h: number } {
  const rect = stage.getBoundingClientRect()
  return { w: rect.width, h: rect.height }
}

function focus(x: number, y: number): void {
  const size = frameSize()
  centerCamera(camera, x, y, size.w, size.h)
}

function lookAtHome(): void {
  const keep = playerKeep(match)
  if (!keep) return
  const center = buildingCenter(keep)
  focus(center.x, center.y)
}

function boot(seed?: number): void {
  match = createMatch(seed ?? ((Math.random() * 1_000_000_000) | 0))
  terrain = buildTerrain(match.seed)
  camera.zoom = 1.35
  input.clearGroups()
  resetHudCache()
  lookAtHome()
}

const input = attachInput({
  canvas: stage,
  getState: () => match,
  getCamera: () => camera,
  onMute: () => {
    sfx.unlock()
    sfx.toggle()
  },
  onHelp: () => helpPanel.classList.toggle('hidden'),
  closeHelp: () => helpPanel.classList.add('hidden'),
  helpOpen: () => !helpPanel.classList.contains('hidden'),
  onActivity: () => sfx.unlock(),
  selectIdle: () => selectIdlePorters(),
  focusPoint: focus,
})

function selectIdlePorters(): void {
  const ids = match.units
    .filter((unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0 && !unit.order)
    .map((unit) => unit.id)
  if (!ids.length) {
    pushToast(match, 'Every worker is already busy.')
    return
  }
  match.selectedUnits = ids
  match.selectedBuilding = null
  match.selectedOre = null
  match.events.push({ type: 'select' })
  const first = unitById(match, ids[0] ?? -1)
  if (first) focus(first.x, first.y)
}

hintClose?.addEventListener('click', () => {
  match.tutorial = false
})
helpButton?.addEventListener('click', () => helpPanel.classList.toggle('hidden'))
document.querySelector('#help-close')?.addEventListener('click', () => helpPanel.classList.add('hidden'))
again?.addEventListener('click', () => boot())
idle?.addEventListener('click', () => {
  sfx.unlock()
  selectIdlePorters()
})
muteButton?.addEventListener('click', () => {
  sfx.unlock()
  sfx.toggle()
})

let miniDrag = false
const jumpMinimap = (event: PointerEvent) => {
  const rect = mini.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * terrain.width
  const y = ((event.clientY - rect.top) / rect.height) * terrain.height
  focus(x, y)
}
mini.addEventListener('pointerdown', (event) => {
  miniDrag = true
  mini.setPointerCapture(event.pointerId)
  jumpMinimap(event)
})
mini.addEventListener('pointermove', (event) => {
  if (miniDrag) jumpMinimap(event)
})
mini.addEventListener('pointerup', () => {
  miniDrag = false
})

lookAtHome()
const size = frameSize()
clampCamera(camera, size.w, size.h)

let last = performance.now()
let acc = 0
const STEP = 1 / 60

function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  acc += dt
  let guard = 0
  while (acc >= STEP && guard++ < 6) {
    step(match, STEP)
    acc -= STEP
  }
  input.pan(dt)
  const drawn = renderWorld(stage, match, terrain, camera, {
    drag: input.dragRect(),
    pointer: input.pointerWorld(),
  })
  renderMinimap(mini, match, camera, drawn.viewW, drawn.viewH)
  syncHud(match, sfx.muted, {
    armPlace: (kind) => {
      match.placement = match.placement === kind ? null : kind
      match.attackMoveArmed = false
      match.moveArmed = false
    },
    armMove: () => {
      match.moveArmed = !match.moveArmed
      match.attackMoveArmed = false
      match.placement = null
    },
    armAttack: () => {
      match.attackMoveArmed = !match.attackMoveArmed
      match.moveArmed = false
      match.placement = null
    },
    dismissHint: () => {
      match.tutorial = false
    },
    selectIdle: () => selectIdlePorters(),
    toggleHelp: () => helpPanel.classList.toggle('hidden'),
    toggleMute: () => sfx.toggle(),
    restart: () => boot(),
  })
  const events = match.events.splice(0, match.events.length)
  sfx.consume(events)
  const cursor = match.placement ? 'cell' : match.attackMoveArmed ? 'crosshair' : match.moveArmed ? 'copy' : 'crosshair'
  if (stage.style.cursor !== cursor) stage.style.cursor = cursor
  requestAnimationFrame(loop)
}

requestAnimationFrame(loop)
