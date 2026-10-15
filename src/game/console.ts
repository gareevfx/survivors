import { clearHands } from './control'
import { noteUnitLost, pushToast, recomputeSupply } from './state'
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
  if (text === 'all cams') {
    if (state.bothCam && !state.enemyCam && !state.fogCleared) {
      pushToast(state, 'All cams is already on.')
      return true
    }
    leaveViews(state, 'both')
    state.bothCam = true
    pushToast(state, 'All cams is on.')
    return true
  }
  if (text === 'all cams off') {
    if (!state.bothCam) {
      pushToast(state, 'All cams is already off.')
      return true
    }
    state.bothCam = false
    pushToast(state, 'All cams is off.')
    return true
  }
  if (text === 'freedom') {
    for (const unit of state.units) {
      unit.hp = 0
      noteUnitLost(state, unit.owner, unit.kind)
    }
    const any = state.units.length > 0
    state.units = []
    state.selectedUnits = []
    recomputeSupply(state)
    pushToast(state, any ? 'All units are dead.' : 'No units left.')
    return true
  }
  if (text === 'siloai') {
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
  if (text === 'speed x3') {
    if (state.speed === 3) {
      pushToast(state, 'Speed x3 is already on.')
      return true
    }
    state.speed = 3
    pushToast(state, 'Speed x3 is on.')
    return true
  }
  if (text === 'speed x3 off') {
    if (state.speed !== 3) {
      pushToast(state, 'Speed x3 is already off.')
      return true
    }
    state.speed = 1
    pushToast(state, 'Speed x3 is off.')
    return true
  }
  if (text === 'double game') {
    if (state.doubleGame) {
      pushToast(state, 'Double game is already on.')
      return true
    }
    state.doubleGame = true
    state.control = 0
    clearHands(state)
    pushToast(state, 'Double game is on. Tab changes side.')
    return true
  }
  if (text === 'double game off') {
    if (!state.doubleGame) {
      pushToast(state, 'Double game is already off.')
      return true
    }
    state.doubleGame = false
    state.control = 0
    clearHands(state)
    pushToast(state, 'Double game is off.')
    return true
  }
  if (text === 'siloai off') {
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
