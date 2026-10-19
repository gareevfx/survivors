import './style.css'
import { audibleEvents, Sfx } from './game/audio'
import { centerCamera, type Camera } from './game/camera'
import { runCommand } from './game/console'
import { controlledSide, cycleSide, handsOff, takeSide } from './game/control'
import { attachInput, narrowSelection, selectOwnCombatUnits, setActiveKind } from './game/input'
import { buildTerrain, minimapFrame, renderMinimap, renderWorld } from './game/render'
import { applyDue, armPlayback, beginRecording, currentTape, finishRecording, rememberAlways, sealReplayStats } from './game/replay'
import { step } from './game/sim'
import { buildingCenter, createMatch, playerKeep, pushToast, sideAnchor, unitById } from './game/state'
import { FFA8_MAP_H, FFA8_MAP_W, FFA_MAP_H, FFA_MAP_W, MAP_H, MAP_W, PLAYER_NAME, type MatchMode, type MatchState } from './game/types'
import { playerHearsAt } from './game/vision'
import { resetHudCache, syncHud, toggleReplayStats } from './ui/hud'
import { hideLesson, syncLesson } from './ui/lesson'
import { lessonTick, noteLessonCamera, skipLesson } from './game/tutorial'

const view = document.querySelector<HTMLCanvasElement>('#view')
const minimap = document.querySelector<HTMLCanvasElement>('#minimap')
const hintClose = document.querySelector<HTMLButtonElement>('#hint-x')
const again = document.querySelector<HTMLButtonElement>('#again')
const replayButton = document.querySelector<HTMLButtonElement>('#replay')
const statisticButton = document.querySelector<HTMLButtonElement>('#statistic')
const camsButton = document.querySelector<HTMLButtonElement>('#cams')
const speedButton = document.querySelector<HTMLButtonElement>('#speed')
const idle = document.querySelector<HTMLButtonElement>('#idle')
const unitsButton = document.querySelector<HTMLButtonElement>('#units')

if (!view || !minimap) {
  throw new Error('Survivors failed to find its canvas.')
}

const stage: HTMLCanvasElement = view
const mini: HTMLCanvasElement = minimap
const commandForm = document.querySelector<HTMLFormElement>('#console')
const commandInput = document.querySelector<HTMLInputElement>('#console-input')
if (!commandForm || !commandInput) {
  throw new Error('Survivors failed to find its command line.')
}
const commandBar = commandForm
const commandField = commandInput
const duelNote = document.querySelector<HTMLElement>('#menu-duel-note')
if (duelNote) {
  duelNote.textContent = `${PLAYER_NAME[0]} against ${PLAYER_NAME[1]} on the wide ${MAP_W}×${MAP_H} field.`
}
const ffaNote = document.querySelector<HTMLElement>('#menu-ffa-note')
if (ffaNote) {
  ffaNote.textContent = `${PLAYER_NAME.slice(0, 4).join(', ')}, each against the others, on a ${FFA_MAP_W}×${FFA_MAP_H} field.`
}
const ffa8Note = document.querySelector<HTMLElement>('#menu-ffa8-note')
if (ffa8Note) {
  ffa8Note.textContent = `${PLAYER_NAME.slice(0, 8).join(', ')}, each against the others, on a ${FFA8_MAP_W}×${FFA8_MAP_H} field.`
}
const tutorialNote = document.querySelector<HTMLElement>('#menu-tutorial-note')
if (tutorialNote) {
  tutorialNote.textContent = 'A guided match on a small field. The enemy holds still until the last step.'
}
const sfx = new Sfx()
let commandArmedAt = 0
let match: MatchState | null = null
let terrain: HTMLCanvasElement | null = null
let menuOpen = true
const camera: Camera = { x: 0, y: 0, zoom: 1.35 }
const menu = document.querySelector<HTMLElement>('#menu')
const menuResume = document.querySelector<HTMLButtonElement>('#menu-resume')
const hintCopy = document.querySelector<HTMLElement>('#hint p')

function frameSize(): { w: number; h: number } {
  const rect = stage.getBoundingClientRect()
  return { w: rect.width, h: rect.height }
}

function focus(x: number, y: number): void {
  if (!match) return
  const size = frameSize()
  centerCamera(camera, x, y, size.w, size.h, match.mapW * 32, match.mapH * 32)
}

function openCommand(): void {
  commandBar.classList.remove('hidden')
  commandField.focus()
  commandField.select()
  commandArmedAt = performance.now()
}

function closeCommand(): void {
  commandBar.classList.add('hidden')
  commandField.value = ''
  stage.focus()
}

function lookAtHome(): void {
  if (!match) return
  const keep = playerKeep(match)
  if (!keep) return
  const center = buildingCenter(keep)
  focus(center.x, center.y)
}

function showMenu(): void {
  menuOpen = true
  menu?.classList.remove('hidden')
  if (menuResume) menuResume.classList.toggle('hidden', !match || match.outcome != null)
  if (match && !match.outcome) match.paused = true
  hideLesson()
}

function presentMatch(mode: MatchMode): void {
  hideLesson()
  last = performance.now()
  acc = 0
  closeCommand()
  menuOpen = false
  menu?.classList.add('hidden')
  if (!match) return
  terrain = buildTerrain(match.seed, match.mapW, match.mapH, mode)
  camera.zoom = mode === 'ffa8' ? 0.75 : mode === 'ffa' ? 0.85 : 1.35
  if (hintCopy) {
    hintCopy.textContent =
      mode === 'tutorial'
        ? 'Follow the lesson panel. Skip a step, or leave for the menu, whenever you want.'
        : mode === 'duel'
          ? 'Destroy the enemy Silo and defend your own. Select the stalkers and right-click the dumps beside the Silo.'
          : 'Destroy every enemy Silo and defend your own. Select the stalkers and right-click the dumps beside the Silo.'
  }
  input.clearGroups()
  resetHudCache()
  lookAtHome()
}

function startMatch(mode: MatchMode, seed?: number): void {
  const chosen = seed ?? ((Math.random() * 1_000_000_000) | 0)
  match = createMatch(chosen, mode)
  beginRecording(chosen, mode)
  presentMatch(mode)
}

function startReplay(): void {
  const tape = currentTape()
  if (!tape || !match) return
  sealReplayStats(match)
  finishRecording()
  match = createMatch(tape.seed, tape.mode)
  if (match.mode === 'tutorial') match.lesson = null
  match.replay = true
  match.tutorial = false
  match.paused = false
  armPlayback(tape)
  presentMatch(tape.mode)
}

function boot(seed?: number): void {
  startMatch(match?.mode ?? 'duel', seed)
}

commandForm.addEventListener('submit', (event) => {
  event.preventDefault()
  if (performance.now() - commandArmedAt < 250) return
  const text = commandField.value
  if (!text.trim()) {
    closeCommand()
    return
  }
  if (!match) return
  if (match.replay) {
    const line = text.trim().toLowerCase().replace(/\s+/g, ' ')
    const allowed = line === 'all cams' || line === 'all cams off' || line === 'speed x3' || line === 'speed x3 off'
    if (!allowed) {
      pushToast(match, 'The replay is still playing.')
      closeCommand()
      return
    }
  }
  const known = runCommand(match, text)
  if (known && !match.replay) rememberAlways(match, { op: 'console', text })
  if (known) closeCommand()
  else commandField.select()
})

const input = attachInput({
  canvas: stage,
  getState: () => {
    if (!match) throw new Error('Survivors has no match yet.')
    return match
  },
  active: () => match != null && !menuOpen,
  getCamera: () => camera,
  onMute: () => {
    sfx.unlock()
    sfx.toggle()
  },
  commandOpen: () => !commandBar.classList.contains('hidden'),
  openCommand,
  closeCommand,
  onActivity: () => sfx.unlock(),
  selectIdle: () => selectIdlePorters(),
  focusPoint: focus,
})

function lookAtSide(owner: number): void {
  if (!match) return
  const keep = sideAnchor(match, owner)
  if (!keep) return
  const center = buildingCenter(keep)
  focus(center.x, center.y)
}

function selectIdlePorters(): void {
  const live = match
  if (!live) return
  const ids = live.units
    .filter(
      (unit) =>
        unit.owner === controlledSide(live) &&
        unit.kind === 'porter' &&
        unit.hp > 0 &&
        unit.frozen == null &&
        !unit.order,
    )
    .map((unit) => unit.id)
  if (!ids.length) {
    pushToast(live, 'Every stalker is already busy.')
    return
  }
  if (live.lesson) live.lesson.flags.idle = true
  live.selectedUnits = ids
  live.selectedBuilding = null
  live.selectedOre = null
  live.selectedGrave = null
  live.selectedGhost = null
  live.events.push({ type: 'select' })
  const first = unitById(live, ids[0] ?? -1)
  if (first) focus(first.x, first.y)
}

hintClose?.addEventListener('click', () => {
  if (match) match.tutorial = false
})
document.querySelector('#pause')?.addEventListener('click', () => {
  if (!match || menuOpen) return
  match.paused = !match.paused
})
document.querySelector('#menu-btn')?.addEventListener('click', () => showMenu())
document.querySelector('#menu-tutorial')?.addEventListener('click', () => startMatch('tutorial'))
document.querySelector('#menu-duel')?.addEventListener('click', () => startMatch('duel'))
document.querySelector('#menu-ffa')?.addEventListener('click', () => startMatch('ffa'))
document.querySelector('#menu-ffa8')?.addEventListener('click', () => startMatch('ffa8'))
const about = document.querySelector<HTMLElement>('#about')
document.querySelector('#menu-about')?.addEventListener('click', () => {
  about?.classList.remove('hidden')
})
document.querySelector('#about-close')?.addEventListener('click', () => {
  about?.classList.add('hidden')
})
menuResume?.addEventListener('click', () => {
  if (!match || match.outcome) return
  menuOpen = false
  menu?.classList.add('hidden')
  match.paused = false
})
document.querySelector('#to-menu')?.addEventListener('click', () => showMenu())
document.querySelector('#lesson-exit')?.addEventListener('click', () => showMenu())
document.querySelector('#lesson-menu')?.addEventListener('click', () => showMenu())
document.querySelector('#lesson-skip')?.addEventListener('click', () => {
  if (!match || match.replay) return
  skipLesson(match)
  lessonTick(match)
})
document.querySelector('#lesson-play')?.addEventListener('click', () => startMatch('duel'))
again?.addEventListener('click', () => boot())
replayButton?.addEventListener('click', () => {
  sfx.unlock()
  startReplay()
})
statisticButton?.addEventListener('click', () => {
  if (!match?.replay || match.outcome) return
  sfx.unlock()
  toggleReplayStats()
})
camsButton?.addEventListener('click', () => {
  if (!match?.replay) return
  sfx.unlock()
  runCommand(match, match.bothCam ? 'all cams off' : 'all cams')
})
speedButton?.addEventListener('click', () => {
  if (!match?.replay) return
  sfx.unlock()
  runCommand(match, match.speed === 3 ? 'speed x3 off' : 'speed x3')
})
idle?.addEventListener('click', () => {
  sfx.unlock()
  selectIdlePorters()
})
unitsButton?.addEventListener('click', () => {
  sfx.unlock()
  if (match) selectOwnCombatUnits(match)
})
document.querySelector('#inspect')?.addEventListener('pointerdown', (event) => {
  if (!match || menuOpen || !(event instanceof PointerEvent)) return
  if (event.button !== 0) return
  const node = event.target instanceof Element ? event.target.closest('.select-chip') : null
  if (!(node instanceof HTMLElement)) return
  const kind = node.dataset.kind
  if (kind !== 'porter' && kind !== 'pike' && kind !== 'howler' && kind !== 'drone' && kind !== 'frog') return
  event.preventDefault()
  event.stopPropagation()
  if (event.ctrlKey || event.metaKey) {
    setActiveKind(match, kind)
    return
  }
  narrowSelection(match, kind, event.shiftKey)
})
document.querySelector('#side-switch')?.addEventListener('click', (event) => {
  if (!match?.doubleGame || match.outcome || match.replay) return
  const button = event.target instanceof Element ? event.target.closest('button') : null
  if (!(button instanceof HTMLButtonElement)) return
  const owner = Number(button.dataset.side)
  if (!Number.isInteger(owner)) return
  if (owner === match.control) cycleSide(match)
  else takeSide(match, owner)
  rememberAlways(match, { op: 'side', owner: match.control })
  lookAtSide(match.control)
})

let miniDrag = false
const jumpMinimap = (event: PointerEvent) => {
  const rect = mini.getBoundingClientRect()
  if (!match || !terrain) return
  const frame = minimapFrame(rect.width, rect.height, match.mapW, match.mapH)
  const x = ((event.clientX - rect.left - frame.x) / frame.w) * terrain.width
  const y = ((event.clientY - rect.top - frame.y) / frame.h) * terrain.height
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

showMenu()

let last = performance.now()
let acc = 0
const STEP = 1 / 60

function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  if (match && terrain && !menuOpen) {
    const live = match
    const ground = terrain
    if (!live.paused) {
      const rate = live.speed === 3 ? 3 : 1
      acc += dt * rate
      let guard = 0
      while (acc >= STEP && guard++ < 6 * rate) {
        if (live.replay && !live.outcome) applyDue(live)
        step(live, STEP)
        acc -= STEP
        if (live.outcome) break
      }
      if (live.outcome) finishRecording()
    }
    input.pan(dt)
    const drawn = renderWorld(stage, live, ground, camera, {
      drag: input.dragRect(),
      pointer: input.pointerWorld(),
    })
    renderMinimap(mini, live, camera, drawn.viewW, drawn.viewH)
    if (live.lesson) {
      const size = frameSize()
      noteLessonCamera(live, camera.x + size.w / (2 * camera.zoom), camera.y + size.h / (2 * camera.zoom), camera.zoom)
      lessonTick(live)
    }
    syncHud(live, {
      armPlace: (kind) => {
        if (live.paused || handsOff(live)) return
        live.placement = live.placement === kind ? null : kind
        live.attackMoveArmed = false
        live.moveArmed = false
      },
      armMove: () => {
        if (live.paused || handsOff(live)) return
        live.moveArmed = !live.moveArmed
        live.attackMoveArmed = false
        live.placement = null
      },
      armAttack: () => {
        if (live.paused || handsOff(live)) return
        live.attackMoveArmed = !live.attackMoveArmed
        live.moveArmed = false
        live.placement = null
      },
      dismissHint: () => {
        live.tutorial = false
      },
      selectIdle: () => selectIdlePorters(),
      restart: () => boot(),
    })
    if (live.lesson || live.mode === 'tutorial') syncLesson(live, camera, stage)
    const events = live.events.splice(0, live.events.length)
    sfx.consume(audibleEvents(events, (x, y) => playerHearsAt(live, x, y)))
    const cursor = live.placement ? 'cell' : live.attackMoveArmed ? 'crosshair' : live.moveArmed ? 'copy' : 'crosshair'
    if (stage.style.cursor !== cursor) stage.style.cursor = cursor
  }
  requestAnimationFrame(loop)
}

requestAnimationFrame(loop)
