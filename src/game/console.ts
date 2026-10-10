import { pushToast } from './state'
import type { MatchState } from './types'
import { clearFog, restoreFog } from './vision'

function normalView(state: MatchState): boolean {
  return !state.fogCleared && !state.enemyCam && !state.bothCam
}

/** Drop every special view except the one about to be shown. Clearing FOW restores real sight. */
function leaveViews(state: MatchState, keep: 'normal' | 'clear' | 'enemy' | 'both'): void {
  if (keep !== 'clear' && state.fogCleared) restoreFog(state)
  if (keep !== 'enemy') state.enemyCam = false
  if (keep !== 'both') state.bothCam = false
}

/**
 * Run one line from the command bar.
 * Returns true when the line was a known command.
 */
export function runCommand(state: MatchState, raw: string): boolean {
  const text = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!text) return false
  if (text === 'off fow' || text === 'off fog of war') {
    if (state.fogCleared && !state.enemyCam && !state.bothCam) {
      pushToast(state, 'FOW is already off.')
      return true
    }
    leaveViews(state, 'clear')
    clearFog(state)
    pushToast(state, 'FOW is off.')
    return true
  }
  if (text === 'fow' || text === 'fog of war') {
    if (normalView(state)) {
      pushToast(state, 'FOW is already on.')
      return true
    }
    leaveViews(state, 'normal')
    pushToast(state, 'FOW is on.')
    return true
  }
  if (text === 'god mode') {
    if (state.godMode) {
      pushToast(state, 'God Mode is already on.')
      return true
    }
    state.godMode = true
    pushToast(state, 'God Mode is on.')
    return true
  }
  if (text === 'off god mode') {
    if (!state.godMode) {
      pushToast(state, 'God Mode is already off.')
      return true
    }
    state.godMode = false
    pushToast(state, 'God Mode is off.')
    return true
  }
  if (text === 'show enemy cam') {
    if (state.enemyCam && !state.bothCam && !state.fogCleared) {
      pushToast(state, 'Enemy cam is already on.')
      return true
    }
    leaveViews(state, 'enemy')
    state.enemyCam = true
    pushToast(state, 'Enemy cam is on.')
    return true
  }
  if (text === 'off enemy cam') {
    if (!state.enemyCam) {
      pushToast(state, 'Enemy cam is already off.')
      return true
    }
    state.enemyCam = false
    pushToast(state, 'Enemy cam is off.')
    return true
  }
  if (text === 'both cam') {
    if (state.bothCam && !state.enemyCam && !state.fogCleared) {
      pushToast(state, 'Both cam is already on.')
      return true
    }
    leaveViews(state, 'both')
    state.bothCam = true
    pushToast(state, 'Both cam is on.')
    return true
  }
  if (text === 'off both cam') {
    if (!state.bothCam) {
      pushToast(state, 'Both cam is already off.')
      return true
    }
    state.bothCam = false
    pushToast(state, 'Both cam is off.')
    return true
  }
  if (text === 'ai control') {
    if (state.aiControl) {
      pushToast(state, 'SiloAI is already on.')
      return true
    }
    state.aiControl = true
    state.placement = null
    state.attackMoveArmed = false
    state.moveArmed = false
    state.playerAiAcc = 0.5
    pushToast(state, 'SiloAI is on.')
    return true
  }
  if (text === 'off ai control') {
    if (!state.aiControl) {
      pushToast(state, 'SiloAI is already off.')
      return true
    }
    state.aiControl = false
    for (const unit of state.units) {
      if (unit.owner !== 0 || unit.order != null || unit.nodeMemory !== 0) continue
      unit.nodeMemory = -1
    }
    pushToast(state, 'SiloAI is off.')
    return true
  }
  pushToast(state, 'Unknown command.')
  return false
}
