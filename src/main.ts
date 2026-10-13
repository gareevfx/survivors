import './style.css'
import { Sfx } from './game/audio'
import { centerCamera, type Camera } from './game/camera'
import { runCommand } from './game/console'
import { attachInput } from './game/input'
import { localOwner, mp, multiplayer } from './game/mpRole'
import { acceptReply, endMp, hostRoom, joinInvite, pumpNet } from './game/mpSession'
import { drawQr } from './game/qr'
import { buildTerrain, minimapFrame, renderMinimap, renderWorld } from './game/render'
import { step } from './game/sim'
import { buildingCenter, createMatch, playerKeep, pushToast, unitById } from './game/state'
import { FFA_MAP_H, FFA_MAP_W, MAP_H, MAP_W, PLAYER_NAME, type MatchMode, type MatchState } from './game/types'
import { resetHudCache, syncHud } from './ui/hud'

const view = document.querySelector<HTMLCanvasElement>('#view')
const minimap = document.querySelector<HTMLCanvasElement>('#minimap')
const hintClose = document.querySelector<HTMLButtonElement>('#hint-x')
const again = document.querySelector<HTMLButtonElement>('#again')
const idle = document.querySelector<HTMLButtonElement>('#idle')

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
  if (multiplayer()) {
    if (match) pushToast(match, 'Commands are off in multiplayer.')
    return
  }
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
  if (multiplayer()) {
    leaveOnline('You left the match.')
    return
  }
  menuOpen = true
  menu?.classList.remove('hidden')
  showMp(false)
  if (menuResume) menuResume.classList.toggle('hidden', !match || match.outcome != null)
  if (match && !match.outcome) match.paused = true
}

function startMatch(mode: MatchMode, seed?: number): void {
  closeCommand()
  menuOpen = false
  menu?.classList.add('hidden')
  showMp(false)
  match = createMatch(seed ?? ((Math.random() * 1_000_000_000) | 0), mode)
  terrain = buildTerrain(match.seed, match.mapW, match.mapH, mode)
  camera.zoom = mode === 'ffa' ? 0.85 : 1.35
  if (hintCopy) {
    hintCopy.textContent =
      mode === 'duel'
        ? 'Destroy the enemy Silo and defend your own. Select the stalkers and right-click the dumps beside the Silo.'
        : 'Destroy every enemy Silo and defend your own. Select the stalkers and right-click the dumps beside the Silo.'
  }
  input.clearGroups()
  resetHudCache()
  lookAtHome()
  last = performance.now()
  acc = 0
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
  const known = runCommand(match, text)
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

function selectIdlePorters(): void {
  if (!match) return
  const ids = match.units
    .filter((unit) => unit.owner === localOwner() && unit.kind === 'porter' && unit.hp > 0 && !unit.order)
    .map((unit) => unit.id)
  if (!ids.length) {
    pushToast(match, 'Every stalker is already busy.')
    return
  }
  match.selectedUnits = ids
  match.selectedBuilding = null
  match.selectedOre = null
  match.selectedGrave = null
  match.events.push({ type: 'select' })
  const first = unitById(match, ids[0] ?? -1)
  if (first) focus(first.x, first.y)
}

hintClose?.addEventListener('click', () => {
  if (match) match.tutorial = false
})
document.querySelector('#pause')?.addEventListener('click', () => {
  if (!match || menuOpen || multiplayer()) return
  match.paused = !match.paused
})
document.querySelector('#menu-btn')?.addEventListener('click', () => showMenu())
document.querySelector('#menu-duel')?.addEventListener('click', () => startMatch('duel'))
document.querySelector('#menu-ffa')?.addEventListener('click', () => startMatch('ffa'))
const donat = document.querySelector<HTMLElement>('#donat')
document.querySelector('#menu-donat')?.addEventListener('click', () => {
  donat?.classList.remove('hidden')
})
document.querySelector('#donat-close')?.addEventListener('click', () => {
  donat?.classList.add('hidden')
})
const about = document.querySelector<HTMLElement>('#about')
document.querySelector('#menu-about')?.addEventListener('click', () => {
  about?.classList.remove('hidden')
})
document.querySelector('#about-close')?.addEventListener('click', () => {
  about?.classList.add('hidden')
})
menuResume?.addEventListener('click', () => {
  if (!match || match.outcome || multiplayer()) return
  menuOpen = false
  menu?.classList.add('hidden')
  match.paused = false
})
document.querySelector('#to-menu')?.addEventListener('click', () => showMenu())
again?.addEventListener('click', () => {
  if (multiplayer()) {
    leaveOnline('Host a new room to play again.')
    return
  }
  boot()
})
idle?.addEventListener('click', () => {
  sfx.unlock()
  selectIdlePorters()
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

const mpPanel = document.querySelector<HTMLElement>('#mp-panel')
const mpStatus = document.querySelector<HTMLElement>('#mp-status')
const mpLive = document.querySelector<HTMLElement>('#mp-live')
const mpPaste = document.querySelector<HTMLTextAreaElement>('#mp-paste')
const mpOfferText = document.querySelector<HTMLTextAreaElement>('#mp-offer-text')
const mpReplyPaste = document.querySelector<HTMLTextAreaElement>('#mp-reply-paste')
const mpAnswerText = document.querySelector<HTMLTextAreaElement>('#mp-answer-text')
const LAN_INTRO = 'Same Wi-Fi. No server. The host plays Silo 01. The guest plays Silo 02.'

function showMp(open: boolean): void {
  mpPanel?.classList.toggle('hidden', !open)
  for (const id of ['#menu-duel', '#menu-duel-note', '#menu-ffa', '#menu-ffa-note', '#menu-about', '#menu-donat', '#menu-mp']) {
    document.querySelector(id)?.classList.toggle('hidden', open)
  }
  if (menuResume) menuResume.classList.toggle('hidden', open || !match || match.outcome != null)
  if (!open) showLanStep('setup')
}

function showLanStep(step: 'setup' | 'offer' | 'answer'): void {
  document.querySelector('#mp-setup')?.classList.toggle('hidden', step !== 'setup')
  document.querySelector('#mp-offer')?.classList.toggle('hidden', step !== 'offer')
  document.querySelector('#mp-answer')?.classList.toggle('hidden', step !== 'answer')
}

function paintQr(id: string, noteId: string, text: string, noun: string): void {
  const canvas = document.querySelector<HTMLCanvasElement>(id)
  const note = document.querySelector<HTMLElement>(noteId)
  if (!canvas) return
  const drew = drawQr(canvas, text)
  canvas.classList.toggle('hidden', !drew)
  if (note) note.textContent = drew ? '' : `This ${noun} is too long to scan. Copy the text.`
}

function setMpStatus(text: string, live: boolean): void {
  if (mpStatus) mpStatus.textContent = text
  if (mpLive) {
    mpLive.textContent = text
    mpLive.classList.toggle('hidden', !live)
  }
}

function mpHooks() {
  return {
    onStatus: (text: string, live: boolean) => setMpStatus(text, live),
    onInvite: (text: string) => {
      if (mpOfferText) mpOfferText.value = text
      if (mpReplyPaste) mpReplyPaste.value = ''
      paintQr('#mp-offer-qr', '#mp-offer-qr-note', text, 'invite')
      showLanStep('offer')
    },
    onReply: (text: string) => {
      if (mpAnswerText) mpAnswerText.value = text
      paintQr('#mp-answer-qr', '#mp-answer-qr-note', text, 'reply')
      showLanStep('answer')
    },
    onReady: (seed: number) => startMatch('duel', seed),
    onDrop: (message: string) => leaveOnline(message),
    getState: () => match,
  }
}

function leaveOnline(message: string): void {
  endMp()
  closeCommand()
  match = null
  terrain = null
  menuOpen = true
  menu?.classList.remove('hidden')
  showLanStep('setup')
  showMp(true)
  if (mpPaste) mpPaste.value = ''
  if (mpReplyPaste) mpReplyPaste.value = ''
  setMpStatus(message, false)
  const pause = document.querySelector<HTMLButtonElement>('#pause')
  if (pause) pause.disabled = false
}

document.querySelector('#menu-mp')?.addEventListener('click', () => {
  showMp(true)
  showLanStep('setup')
  if (mpPaste) mpPaste.value = ''
  setMpStatus(LAN_INTRO, false)
})
document.querySelector('#mp-back')?.addEventListener('click', () => leaveLan())
document.querySelector('#mp-offer-back')?.addEventListener('click', () => leaveLan())
document.querySelector('#mp-answer-back')?.addEventListener('click', () => leaveLan())
document.querySelector('#mp-host')?.addEventListener('click', () => {
  hostRoom(mpHooks())
})
document.querySelector('#mp-join')?.addEventListener('click', () => {
  joinInvite(mpPaste?.value ?? '', mpHooks())
})
document.querySelector('#mp-connect')?.addEventListener('click', () => {
  acceptReply(mpReplyPaste?.value ?? '')
})
document.querySelector('#mp-offer-copy')?.addEventListener('click', () => {
  copyText(mpOfferText?.value ?? '', 'Invite copied. Paste it on the other PC.')
})
document.querySelector('#mp-answer-copy')?.addEventListener('click', () => {
  copyText(mpAnswerText?.value ?? '', 'Reply copied. Paste it on the host PC.')
})

function leaveLan(): void {
  if (multiplayer()) leaveOnline('You left the match.')
  else {
    endMp()
    showMp(false)
    setMpStatus(LAN_INTRO, false)
  }
}

function copyText(text: string, doneText: string): void {
  if (!text) return
  const done = () => setMpStatus(doneText, false)
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).then(done).catch(() => {
      done()
    })
    return
  }
  done()
}

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
    if (multiplayer()) {
      live.paused = false
      live.speed = 1
    }
    if (mp.role !== 'guest' && !live.paused) {
      const rate = live.speed === 3 ? 3 : 1
      acc += dt * rate
      let guard = 0
      while (acc >= STEP && guard++ < 6 * rate) {
        step(live, STEP)
        acc -= STEP
      }
    }
    pumpNet(live, dt)
    input.pan(dt)
    const drawn = renderWorld(stage, live, ground, camera, {
      drag: input.dragRect(),
      pointer: input.pointerWorld(),
    })
    renderMinimap(mini, live, camera, drawn.viewW, drawn.viewH)
    syncHud(live, {
      armPlace: (kind) => {
        if (live.paused || live.aiControl) return
        live.placement = live.placement === kind ? null : kind
        live.attackMoveArmed = false
        live.moveArmed = false
      },
      armMove: () => {
        if (live.paused || live.aiControl) return
        live.moveArmed = !live.moveArmed
        live.attackMoveArmed = false
        live.placement = null
      },
      armAttack: () => {
        if (live.paused || live.aiControl) return
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
    const events = live.events.splice(0, live.events.length)
    sfx.consume(events)
    const cursor = live.placement ? 'cell' : live.attackMoveArmed ? 'crosshair' : live.moveArmed ? 'copy' : 'crosshair'
    if (stage.style.cursor !== cursor) stage.style.cursor = cursor
  }
  requestAnimationFrame(loop)
}

requestAnimationFrame(loop)

// A background tab stops painting. Catch the host sim up when frames stall.
window.setInterval(() => {
  if (mp.role !== 'host' || !match || menuOpen) return
  const now = performance.now()
  const gap = now - last
  if (gap < 90) return
  const live = match
  live.paused = false
  live.speed = 1
  last = now
  let budget = Math.min(1, gap / 1000)
  while (budget > 0) {
    const slice = Math.min(0.05, budget)
    acc += slice
    let guard = 0
    while (acc >= STEP && guard++ < 6) {
      step(live, STEP)
      acc -= STEP
    }
    pumpNet(live, slice)
    budget -= slice
  }
}, 200)
