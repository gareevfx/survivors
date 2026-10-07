import { pushToast } from './state'
import type { MatchState } from './types'
import { clearFog, restoreFog } from './vision'

/**
 * Run one line from the command bar.
 * Returns true when the line was a known command.
 */
export function runCommand(state: MatchState, raw: string): boolean {
  const text = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!text) return false
  if (text === 'off fog of war') {
    if (state.fogCleared) {
      pushToast(state, 'Fog of war is already off.')
      return true
    }
    clearFog(state)
    pushToast(state, 'Fog of war is off.')
    return true
  }
  if (text === 'fog of war') {
    if (!state.fogCleared) {
      pushToast(state, 'Fog of war is already on.')
      return true
    }
    restoreFog(state)
    pushToast(state, 'Fog of war is on.')
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
    if (state.enemyCam) {
      pushToast(state, 'Enemy cam is already on.')
      return true
    }
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
  pushToast(state, 'Unknown command.')
  return false
}
