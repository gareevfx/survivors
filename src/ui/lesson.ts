import { worldToScreen, type Camera } from '../game/camera'
import { lessonView } from '../game/tutorial'
import type { MatchState } from '../game/types'

/** Place the lesson card and the pulsing arrow. Hidden once the lesson is over. */
export function syncLesson(state: MatchState, camera: Camera, canvas: HTMLCanvasElement): void {
  const panel = document.querySelector<HTMLElement>('#lesson')
  const kicker = document.querySelector('#lesson-kicker')
  const copy = document.querySelector('#lesson-text')
  const arrow = document.querySelector<HTMLElement>('#lesson-arrow')
  const done = document.querySelector<HTMLElement>('#lesson-done')
  const overlay = document.querySelector<HTMLElement>('#overlay')
  document.querySelectorAll('.lesson-hot').forEach((node) => node.classList.remove('lesson-hot'))

  const finished = !!state.lesson?.finished || (state.mode === 'tutorial' && state.outcome === 'win')
  if (done) done.classList.toggle('hidden', !finished)
  if (finished && overlay) overlay.classList.add('hidden')

  const hint = lessonView(state)
  if (!panel || !arrow) return
  if (!hint) {
    panel.classList.add('hidden')
    arrow.classList.add('hidden')
    return
  }
  panel.classList.remove('hidden')
  if (kicker) kicker.textContent = `Step ${hint.step} / ${hint.total}`
  if (copy) copy.textContent = hint.text

  if (hint.hud) {
    const target = document.querySelector(hint.hud)
    if (target) target.classList.add('lesson-hot')
  }

  const spot = hint.world
  if (!spot) {
    arrow.classList.add('hidden')
    return
  }
  const rect = canvas.getBoundingClientRect()
  const screen = worldToScreen(camera, spot.x, spot.y)
  const margin = 18
  const x = Math.min(rect.width - margin, Math.max(margin, screen.x))
  const y = Math.min(rect.height - margin, Math.max(margin, screen.y))
  arrow.classList.remove('hidden')
  arrow.style.left = `${rect.left + x}px`
  arrow.style.top = `${rect.top + y}px`
}

export function hideLesson(): void {
  document.querySelector('#lesson')?.classList.add('hidden')
  document.querySelector('#lesson-arrow')?.classList.add('hidden')
  document.querySelector('#lesson-done')?.classList.add('hidden')
  document.querySelectorAll('.lesson-hot').forEach((node) => node.classList.remove('lesson-hot'))
}
