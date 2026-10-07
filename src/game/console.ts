import { pushToast } from './state'
import type { MatchState } from './types'
import { clearFog } from './vision'

/**
 * Run one line from the command bar.
 * Returns true when the line was a known command.
 */
export function runCommand(state: MatchState, raw: string): boolean {
  const text = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!text) return false
  if (text === 'clear fog of war' || text === 'clear fog') {
    if (state.fogCleared) {
      pushToast(state, 'Fog of war is already clear.')
      return true
    }
    clearFog(state)
    pushToast(state, 'Fog of war cleared for this match.')
    return true
  }
  if (text === 'god mode') {
    if (state.godMode) {
      pushToast(state, 'God Mode is already on.')
      return true
    }
    state.godMode = true
    pushToast(state, 'God Mode is on for this match.')
    return true
  }
  pushToast(state, 'Unknown command.')
  return false
}
