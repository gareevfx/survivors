import type { MatchState, PlayerId } from './types'

/**
 * Double game is hot-seat control. It does not change who the match is about.
 * Win, lose, god mode, `siloai`, and `show enemy cam` stay tied to Silo 01.
 * `all cams` and `off fow` stay view cheats: they are not cleared by double game,
 * and double game is not cleared by them. While either is on, that view replaces
 * the controlled side's own fog. `off fow` still shows the whole map.
 * The side you are sitting in has its SiloAI suspended, including Silo 01 when
 * `siloai` is also on. Leaving that side resumes it. `double game off` does not
 * clear `siloai`, so Silo 01 goes back to SiloAI if that command is still on.
 */

/** Side the human is commanding. Silo 01 unless double game is on. */
export function controlledSide(state: MatchState): PlayerId {
  if (!state.doubleGame) return 0
  const owner = state.control
  if (owner < 0 || owner >= state.playerCount) return 0
  return owner
}

/** True while the human is giving this side's orders, so SiloAI must stay quiet. */
export function aiSuspended(state: MatchState, owner: PlayerId): boolean {
  return state.doubleGame && owner === controlledSide(state)
}

/** SiloAI owns the only human seat. Double game hands every controlled side back to the player. */
export function handsOff(state: MatchState): boolean {
  return state.aiControl && !state.doubleGame
}

export function clearHands(state: MatchState): void {
  state.selectedUnits = []
  state.selectedBuilding = null
  state.selectedOre = null
  state.selectedGrave = null
  state.placement = null
  state.attackMoveArmed = false
  state.moveArmed = false
}

/** Pick a seated side. Eliminated sides stay in the list so their ruins can be inspected. */
export function takeSide(state: MatchState, owner: PlayerId): void {
  if (!state.doubleGame) return
  if (owner < 0 || owner >= state.playerCount || owner === state.control) return
  state.control = owner
  clearHands(state)
}

export function cycleSide(state: MatchState): void {
  if (!state.doubleGame || state.playerCount < 1) return
  state.control = (state.control + 1) % state.playerCount
  clearHands(state)
}
