import { cancelBuilding, cancelTrain, commandFreezeAuto, commandHoverGrid, commandRepair, commandRepairNearest, commandStop, installCryo, playerHovers, thawCryo, tryTrain } from '../game/commands'
import { controlledSide, handsOff } from '../game/control'
import { toggleScanner } from '../game/scanner'
import { flasherPortraitUrl } from '../game/flasherArt'
import { gorillaPortraitUrl } from '../game/gorillaArt'
import { hoverPortraitUrl } from '../game/hoverArt'
import { factoryPortraitUrl } from '../game/factoryArt'
import { ruinedSiloPortraitUrl, siloPortraitUrl } from '../game/siloArt'
import { pillarPortraitUrl } from '../game/pillarArt'
import { storagePortraitUrl } from '../game/storageArt'
import { stalkerPortraitUrl } from '../game/stalkerArt'
import { buildingById, buildingCenter, cryoOccupants, cryoParty, unitById } from '../game/state'
import {
  BUILDING_STATS,
  CRYO_COST,
  CRYO_FREEZE_COST,
  CRYO_SLOTS,
  PLAYER_COLOR,
  PLAYER_NAME,
  SILO_REPAIR_COST,
  SILO_REPAIR_TIME,
  STORAGE_CAP,
  GRID_CLOAK_SECONDS,
  UNIT_KINDS,
  UNIT_STATS,
  type Building,
  type BuildingKind,
  type MatchState,
  type UnitKind,
} from '../game/types'
import { currentTape, rememberAlways, rememberLive } from '../game/replay'
import { loreBody } from './lore'

export interface HudActions {
  armPlace: (kind: BuildingKind) => void
  armMove: () => void
  armAttack: () => void
  dismissHint: () => void
  selectIdle: () => void
  restart: () => void
}

interface Cmd {
  id: string
  label: string
  hotkey?: string
  detail?: string
  title: string
  disabled: boolean
  armed?: boolean
  run: () => void
}

let commandKey = ''
let sideKey = ''
let endKey = ''
let replayStatsKey = ''
let replayStatsShown = false

/** Open or close the recorded match's statistics over the replay. */
export function toggleReplayStats(): void {
  replayStatsShown = !replayStatsShown
}

export function syncHud(state: MatchState, actions: HudActions): void {
  const ore = document.querySelector('#ore')
  const supply = document.querySelector('#supply')
  const clock = document.querySelector('#clock')
  const idle = document.querySelector('#idle')
  const statistic = document.querySelector<HTMLButtonElement>('#statistic')
  const cams = document.querySelector<HTMLButtonElement>('#cams')
  const speed = document.querySelector<HTMLButtonElement>('#speed')
  const replayStats = document.querySelector('#replay-stats')
  const replayStatsBody = document.querySelector('#replay-stats-body')
  const hint = document.querySelector('#hint')
  const mode = document.querySelector('#modeflag')
  const pause = document.querySelector<HTMLButtonElement>('#pause')
  const pausedBanner = document.querySelector('#paused')
  const aiBadge = document.querySelector('#ai-badge')
  const bothBadge = document.querySelector('#both-badge')
  const inspect = document.querySelector('#inspect')
  const toasts = document.querySelector('#toasts')
  const overlay = document.querySelector('#overlay')
  const endKicker = document.querySelector('#end-kicker')
  const endTitle = document.querySelector('#end-title')
  const endCopy = document.querySelector('#end-copy')
  const endSeed = document.querySelector('#end-seed')
  const endStats = document.querySelector('#end-stats')
  const sides = document.querySelector('#sides')
  const side = controlledSide(state)
  const held = state.oreHeld[side] ?? 0
  const used = state.supplyUsed[side] ?? 0
  const cap = state.supplyCap[side] ?? 0

  if (ore) ore.textContent = String(held)
  const supplyText = `${used} / ${cap}`
  if (supply) {
    supply.textContent = supplyText
    supply.classList.toggle('tight', cap - used <= 1)
    const cells = supply.closest('.readout')
    if (cells instanceof HTMLElement) cells.title = loreBody('Cells')
  }
  if (clock) clock.textContent = formatTime(state.time)
  const idleCount = state.units.filter(
    (unit) => unit.owner === side && unit.kind === 'porter' && unit.hp > 0 && unit.frozen == null && !unit.order,
  ).length
  if (idle) idle.textContent = idleCount ? `Idle ${idleCount}` : 'Idle'
  const replayLive = state.replay && state.outcome == null
  const recorded = currentTape()?.final
  if (statistic) {
    statistic.classList.toggle('hidden', !replayLive)
    statistic.setAttribute('aria-pressed', replayStatsShown && replayLive ? 'true' : 'false')
  }
  if (replayStats && replayStatsBody) {
    const show = replayStatsShown && replayLive && recorded != null
    replayStats.classList.toggle('hidden', !show)
    if (!show) {
      replayStatsKey = ''
    } else {
      const html = statsPanelHtml(recorded.time, recorded.playerCount, recorded.stats)
      if (html !== replayStatsKey) {
        replayStatsKey = html
        replayStatsBody.innerHTML = html
      }
    }
  }
  if (cams) {
    cams.classList.toggle('hidden', !replayLive)
    cams.setAttribute('aria-pressed', state.bothCam ? 'true' : 'false')
  }
  if (speed) {
    speed.classList.toggle('hidden', !replayLive)
    speed.setAttribute('aria-pressed', state.speed === 3 ? 'true' : 'false')
  }
  if (hint) hint.classList.toggle('hidden', !state.tutorial)
  if (pause) {
    pause.textContent = state.paused ? 'Resume' : 'Pause'
    pause.title = state.paused ? 'Resume the match (Pause)' : 'Pause the match (Pause)'
    pause.setAttribute('aria-pressed', state.paused ? 'true' : 'false')
  }
  if (pausedBanner) pausedBanner.classList.toggle('hidden', !state.paused)
  if (aiBadge) aiBadge.classList.toggle('hidden', !state.aiControl)
  if (bothBadge) bothBadge.classList.toggle('hidden', !state.bothCam)

  if (mode) {
    if (state.placement) {
      const stats = BUILDING_STATS[state.placement]
      mode.textContent = `Placing ${stats.label} (${stats.cost} dumps). Left-click the map. Right-click cancels.`
      mode.classList.remove('hidden')
    } else if (state.attackMoveArmed) {
      mode.textContent = 'Attack-move: left-click the ground. Units fight anything they meet. Esc cancels.'
      mode.classList.remove('hidden')
    } else if (state.moveArmed) {
      mode.textContent = 'Move: left-click the ground. Right-click cancels.'
      mode.classList.remove('hidden')
    } else {
      mode.classList.add('hidden')
    }
  }

  if (inspect) inspect.innerHTML = describeSelection(state)
  if (toasts) {
    toasts.innerHTML = state.toasts.map((toast) => `<div class="toast">${escapeHtml(toast.text)}</div>`).join('')
  }

  if (sides) {
    sides.innerHTML = Array.from({ length: state.playerCount }, (_, owner) => {
      const name = PLAYER_NAME[owner] ?? `Side ${owner + 1}`
      const color = PLAYER_COLOR[owner] ?? '#ffffff'
      const gone = state.eliminated[owner] || !state.buildings.some((building) => building.owner === owner && building.kind === 'keep' && building.hp > 0)
      const you = state.doubleGame && owner === side ? ' you' : ''
      return `<span class="${gone && owner !== 0 ? 'out' : ''}${you}"><i style="background:${color}"></i>${escapeHtml(name)}</span>`
    }).join('')
  }

  if (overlay && endKicker && endTitle && endCopy && endSeed) {
    overlay.classList.toggle('hidden', state.outcome == null)
    const others = PLAYER_NAME.slice(1, state.playerCount).join(', ')
    if (state.outcome === 'win') {
      endKicker.textContent = PLAYER_NAME[0] ?? 'Silo 01'
      endTitle.textContent = 'Surface is yours'
      endCopy.textContent =
        state.playerCount > 2
          ? 'Every enemy Silo is rubble. Your banners stay on the field.'
          : `The ${PLAYER_NAME[1]} Silo is rubble. Your banners stay on the field.`
    } else if (state.outcome === 'lose') {
      endKicker.textContent = state.playerCount > 2 ? 'The field' : (PLAYER_NAME[1] ?? 'Silo 02')
      endTitle.textContent = 'The silo has fallen'
      endCopy.textContent =
        state.playerCount > 2
          ? `Your Silo is gone. ${others} fight on without you.`
          : `Your Silo is gone. ${PLAYER_NAME[1]} takes Surface.`
    }
    endSeed.textContent = `Field ${state.seed}`
    if (endStats) {
      if (state.outcome == null) {
        endKey = ''
        if (endStats.innerHTML) endStats.innerHTML = ''
      } else {
        const html = endStatsHtml(state)
        if (html !== endKey) {
          endKey = html
          endStats.innerHTML = html
        }
      }
    }
  }

  syncSideSwitch(state)

  const commands = buildCommands(state, actions)
  const locked = handsOff(state)
  const key = `${state.replay ? 'replay' : locked ? 'ai' : 'player'}|${state.doubleGame ? side : 'home'}|${commands.map((cmd) => `${cmd.id}:${cmd.disabled}:${cmd.armed}:${cmd.detail ?? ''}`).join('|')}`
  if (key !== commandKey) {
    commandKey = key
    paintCommands(commands, locked, state.replay ? 'Replay' : 'Select stalkers, the Silo, or a Factory.')
  }
}

function syncSideSwitch(state: MatchState): void {
  const root = document.querySelector('#side-switch')
  if (!root) return
  root.classList.toggle('hidden', !state.doubleGame)
  if (!state.doubleGame) return
  const side = controlledSide(state)
  const marks = Array.from({ length: state.playerCount }, (_, owner) => {
    const gone = state.eliminated[owner] || !state.buildings.some((building) => building.owner === owner && building.kind === 'keep' && building.hp > 0)
    return gone ? '0' : '1'
  }).join('')
  const key = `${side}|${marks}`
  if (key === sideKey) return
  sideKey = key
  root.innerHTML = Array.from({ length: state.playerCount }, (_, owner) => {
    const name = PLAYER_NAME[owner] ?? `Side ${owner + 1}`
    const color = PLAYER_COLOR[owner] ?? '#ffffff'
    const gone = marks[owner] === '0'
    const pressed = owner === side
    return `<button type="button" data-side="${owner}" aria-pressed="${pressed ? 'true' : 'false'}" class="${gone ? 'out' : ''}" title="${pressed ? 'Cycle side (Tab)' : `Command ${escapeHtml(name)}`}"><i style="background:${color}"></i>${escapeHtml(name)}</button>`
  }).join('')
}

export function resetHudCache(): void {
  commandKey = '\0'
  sideKey = '\0'
  endKey = ''
  replayStatsKey = ''
  replayStatsShown = false
}

export function endStatsHtml(state: MatchState): string {
  return statsPanelHtml(state.time, state.playerCount, state.stats)
}

/** The end-of-match statistics table. `time` is the duration, not the replay clock. */
export function statsPanelHtml(time: number, playerCount: number, stats: MatchState['stats']): string {
  const kindHeads = UNIT_KINDS.map((kind) => `<th scope="col">${escapeHtml(UNIT_STATS[kind].label)}</th>`).join('')
  const rows = Array.from({ length: playerCount }, (_, owner) => {
    const row = stats[owner]
    const name = PLAYER_NAME[owner] ?? `Side ${owner + 1}`
    const color = swatchColor(PLAYER_COLOR[owner] ?? '#ffffff')
    const created = UNIT_KINDS.map((kind) => row?.created[kind] ?? 0)
    const lost = UNIT_KINDS.map((kind) => row?.lost[kind] ?? 0)
    return `<tr class="${owner === 0 ? 'you' : ''}"><th scope="row"><span class="end-side"><i style="background:${color}"></i>${escapeHtml(name)}</span></th>${statCells(created, true)}${statCells(lost, true)}<td class="group">${row?.dumps ?? 0}</td><td class="group">${row?.silos ?? 0}</td></tr>`
  }).join('')
  return `<p class="end-duration"><span>Duration</span><b>${formatDuration(time)}</b></p><div class="end-table-wrap"><table aria-label="Match statistics"><thead><tr><th rowspan="2" scope="col">Side</th><th class="group" colspan="4" scope="colgroup">Created</th><th class="group" colspan="4" scope="colgroup">Lost</th><th class="group" rowspan="2" scope="col">Dumps collected</th><th class="group" rowspan="2" scope="col">Silos captured</th></tr><tr>${kindHeads}${kindHeads}</tr></thead><tbody>${rows}</tbody></table></div>`
}

function statCells(values: number[], grouped: boolean): string {
  return values.map((value, index) => `<td${grouped && index === 0 ? ' class="group"' : ''}>${value}</td>`).join('')
}

function swatchColor(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#ffffff'
}

function buildCommands(state: MatchState, actions: HudActions): Cmd[] {
  if (state.outcome || state.replay) return []
  if (state.placement) {
    return [
      {
        id: 'cancel-place',
        label: 'Cancel',
        hotkey: 'Esc',
        title: 'Cancel placement',
        disabled: false,
        run: () => {
          state.placement = null
        },
      },
    ]
  }

  const building = state.selectedBuilding != null ? buildingById(state, state.selectedBuilding) : undefined
  if (building?.ruined && state.selectedUnits.length === 0) {
    const afford = building.repairPaid || (state.oreHeld[controlledSide(state)] ?? 0) >= SILO_REPAIR_COST
    const porter = nearestPlayerPorter(state, building)
    return [
      {
        id: 'repair-silo',
        label: 'Repair',
        hotkey: 'R',
        detail: `${SILO_REPAIR_COST} dumps · ${SILO_REPAIR_TIME}s`,
        title: !porter ? 'You need a stalker to repair' : afford ? 'Send the nearest Stalker to repair this Silo' : `Need ${SILO_REPAIR_COST} dumps`,
        disabled: !porter || !afford,
        run: () => {
          const worker = nearestPlayerPorter(state, building)
          if (!worker) {
            state.toasts.push({ text: 'You need a stalker to repair', life: 3 })
            return
          }
          rememberLive(state, { op: 'repair', ids: [worker.id], buildingId: building.id })
          const error = commandRepair(state, [worker.id], building.id)
          if (error) state.toasts.push({ text: error, life: 3 })
        },
      },
    ]
  }
  if (building && building.owner === controlledSide(state) && state.selectedUnits.length === 0) {
    if (!building.complete) {
      return [
        {
          id: 'cancel-build',
          label: 'Cancel',
          detail: '75% back',
          title: 'Cancel construction and refund most of the dumps',
          disabled: false,
          run: () => {
            rememberLive(state, { op: 'cancelBuilding', buildingId: building.id })
            cancelBuilding(state, building.id)
          },
        },
      ]
    }
    if (building.kind === 'keep') {
      const cmds = [
        trainButton(state, building.id, 'porter'),
        placeButton(state, 'yard', actions),
        placeButton(state, 'silo', actions),
        placeButton(state, 'tower', actions),
        cryoButton(state, building),
      ]
      if (building.cryo) cmds.push(defrostButton(state, building))
      if (building.queue.length) cmds.push(cancelTrainButton(state, building.id))
      return cmds
    }
    if (building.kind === 'yard') {
      const cmds = [
        trainButton(state, building.id, 'pike'),
        trainButton(state, building.id, 'howler'),
        trainButton(state, building.id, 'drone'),
      ]
      if (building.queue.length) cmds.push(cancelTrainButton(state, building.id))
      return cmds
    }
    return []
  }

  if (state.selectedUnits.length) {
    const porters = state.selectedUnits.some((id) => unitById(state, id)?.kind === 'porter')
    const cmds: Cmd[] = [
      {
        id: 'move',
        label: 'Move',
        title: 'Left-click a destination',
        disabled: false,
        armed: state.moveArmed,
        run: () => actions.armMove(),
      },
      {
        id: 'attack',
        label: 'Attack',
        hotkey: 'Q',
        title: 'Attack-move: fight anything along the way',
        disabled: false,
        armed: state.attackMoveArmed,
        run: () => actions.armAttack(),
      },
      {
        id: 'stop',
        label: 'Stop',
        hotkey: 'X',
        title: 'Cancel orders',
        disabled: false,
        run: () => {
          rememberLive(state, { op: 'stop', ids: state.selectedUnits })
          commandStop(state, state.selectedUnits)
          state.moveArmed = false
          state.attackMoveArmed = false
        },
      },
    ]
    const hovers = playerHovers(state, state.selectedUnits)
    if (hovers.length) {
      cmds.push({
        id: 'scan',
        label: 'Scanner',
        hotkey: 'C',
        title: 'Fly to the nearest black fog, then the tiles seen longest ago. Reveals an invisible enemy Hover inside sight.',
        disabled: false,
        armed: hovers.every((unit) => unit.scanning),
        run: () => {
          const ids = hovers.map((unit) => unit.id)
          rememberLive(state, { op: 'scan', ids })
          toggleScanner(state, ids)
        },
      })
      const gridReady = hovers.length >= 10
      cmds.push({
        id: 'grid',
        label: 'Grid',
        title: gridReady
          ? `Fly to an even grid covering the map, stay there, and turn invisible for ${GRID_CLOAK_SECONDS} seconds`
          : 'Needs 10 Hovers selected',
        disabled: !gridReady,
        run: () => {
          rememberLive(state, { op: 'grid', ids: state.selectedUnits })
          commandHoverGrid(state, state.selectedUnits)
          state.moveArmed = false
          state.attackMoveArmed = false
        },
      })
    }
    if (porters) {
      cmds.push(
        repairButton(state),
        placeButton(state, 'yard', actions),
        placeButton(state, 'silo', actions),
        placeButton(state, 'tower', actions),
      )
    }
    return cmds
  }
  return []
}

/** Labels on the command bar for the current selection. Smoke reads the Cryo and Defrost states from here. */
export function commandSnapshot(state: MatchState): Array<{ label: string; detail: string; disabled: boolean; title: string }> {
  const actions: HudActions = {
    armPlace() {},
    armMove() {},
    armAttack() {},
    dismissHint() {},
    selectIdle() {},
    restart() {},
  }
  return buildCommands(state, actions).map((cmd) => ({
    label: cmd.label,
    detail: cmd.detail ?? '',
    disabled: cmd.disabled,
    title: cmd.title,
  }))
}

function cancelTrainButton(state: MatchState, buildingId: number): Cmd {
  return {
    id: 'cancel-train',
    label: 'Cancel',
    detail: 'last order',
    title: 'Refund the latest training order',
    disabled: false,
    run: () => {
      rememberLive(state, { op: 'cancelTrain', buildingId })
      cancelTrain(state, buildingId)
    },
  }
}

function cryoUse(state: MatchState, building: Building): { recovering: boolean; occupied: boolean; held: number } {
  const held = cryoOccupants(state, building.id)
  const inbound = cryoParty(state, building.id).length > 0
  return { recovering: building.cryoRecover > 0, occupied: held > 0 || inbound, held }
}

function cryoButton(state: MatchState, building: Building): Cmd {
  if (!building.cryo) {
    const afford = (state.oreHeld[controlledSide(state)] ?? 0) >= CRYO_COST
    return {
      id: 'cryo',
      label: 'Cryo',
      detail: `${CRYO_COST} dumps`,
      title: afford
        ? 'Add four glass vessels to this Silo, once. Select 4 Stalkers and send them here. Freezing costs 50 dumps each, 200 for the group. Defrost releases them beside the Silo, then the Cryo recovers for 4 minutes.'
        : `Need ${CRYO_COST} dumps`,
      disabled: !afford,
      run: () => {
        rememberLive(state, { op: 'cryo', buildingId: building.id })
        const error = installCryo(state, building.id)
        if (error) state.toasts.push({ text: error, life: 3.5 })
      },
    }
  }
  const use = cryoUse(state, building)
  const send =
    'Send the 4 Stalkers with the most health remaining to this Silo. When health matches, the nearest ones go. Freezing costs 200 dumps for the group when they arrive. Selecting 4 Stalkers and sending them still works.'
  const countdown = formatRecover(building.cryoRecover)
  return {
    id: 'cryo',
    label: 'Cryo',
    detail: use.recovering ? `Recovery ${countdown}` : `${CRYO_FREEZE_COST * CRYO_SLOTS} dumps`,
    title: use.recovering
      ? `The Cryo is recovering for ${countdown}.`
      : use.occupied
        ? 'Stalkers are frozen or already on their way. Defrost releases the ones inside.'
        : send,
    disabled: use.recovering || use.occupied,
    run: () => {
      rememberLive(state, { op: 'freezeAuto', buildingId: building.id })
      commandFreezeAuto(state, building.id)
    },
  }
}

function defrostButton(state: MatchState, building: Building): Cmd {
  const use = cryoUse(state, building)
  return {
    id: 'defrost',
    label: 'Defrost',
    detail: use.held ? `${use.held} inside` : 'empty',
    title: `Defrost releases the frozen Stalkers beside this Silo. The ${CRYO_FREEZE_COST} dumps spent to freeze each one is not returned. The Cryo then recovers for 4 minutes.`,
    disabled: use.recovering || !use.occupied,
    run: () => {
      rememberAlways(state, { op: 'thaw', buildingId: building.id })
      thawCryo(state, building.id)
    },
  }
}

function placeButton(state: MatchState, kind: BuildingKind, actions: HudActions): Cmd {
  const stats = BUILDING_STATS[kind]
  const afford = (state.oreHeld[controlledSide(state)] ?? 0) >= stats.cost
  return {
    id: `place-${kind}`,
    label: stats.label,
    hotkey: kind === 'yard' ? 'Y' : kind === 'silo' ? 'L' : kind === 'tower' ? 'T' : 'O',
    detail: `${stats.cost} dumps`,
    title: afford ? stats.blurb : `Need ${stats.cost} dumps`,
    disabled: !afford,
    armed: state.placement === kind,
    run: () => actions.armPlace(kind),
  }
}

function repairButton(state: MatchState): Cmd {
  const porters = state.selectedUnits.filter((id) => {
    const unit = unitById(state, id)
    return !!unit && unit.owner === controlledSide(state) && unit.kind === 'porter' && unit.hp > 0
  })
  const ruin = state.buildings.some((building) => building.ruined)
  const bank = state.oreHeld[controlledSide(state)] ?? 0
  const afford = state.buildings.some(
    (building) => building.ruined && (building.repairPaid || bank >= SILO_REPAIR_COST),
  )
  let title = 'Repair the nearest ruined Silo'
  if (!porters.length) title = 'You need a stalker to repair'
  else if (!ruin) title = 'No ruined Silo'
  else if (!afford) title = `Need ${SILO_REPAIR_COST} dumps`
  return {
    id: 'repair',
    label: 'Repair',
    hotkey: 'R',
    detail: `${SILO_REPAIR_COST} dumps · ${SILO_REPAIR_TIME}s`,
    title,
    disabled: !porters.length || !ruin || !afford,
    run: () => {
      rememberLive(state, { op: 'repairNearest', ids: state.selectedUnits })
      const error = commandRepairNearest(state, state.selectedUnits)
      if (error) state.toasts.push({ text: error, life: 3 })
    },
  }
}

function trainButton(state: MatchState, buildingId: number, kind: UnitKind): Cmd {
  const stats = UNIT_STATS[kind]
  const side = controlledSide(state)
  const afford = (state.oreHeld[side] ?? 0) >= stats.cost
  const room = stats.supply === 0 || (state.supplyUsed[side] ?? 0) + stats.supply <= (state.supplyCap[side] ?? 0)
  let title = stats.blurb
  if (!afford) title = `Need ${stats.cost} dumps`
  else if (!room) title = 'Cells cap reached — raise a Storage'
  const cells = stats.supply === 1 ? '1 cell' : `${stats.supply} cells`
  const detail = stats.supply === 0 ? `${stats.cost} dumps` : `${stats.cost} dumps · ${cells}`
  return {
    id: `train-${kind}`,
    label: stats.label,
    hotkey: kind === 'porter' ? 'P' : kind === 'pike' ? 'K' : kind === 'howler' ? 'J' : 'H',
    detail,
    title,
    disabled: !afford || !room,
    run: () => {
      rememberLive(state, { op: 'train', buildingId, kind })
      const error = tryTrain(state, buildingId, kind)
      if (error) state.toasts.push({ text: error, life: 3 })
    },
  }
}

function paintCommands(commands: Cmd[], handsOff: boolean, emptyText: string): void {
  const root = document.querySelector('#commands')
  if (!root) return
  root.innerHTML = ''
  if (handsOff) {
    const note = document.createElement('p')
    note.className = 'cmd-note'
    note.textContent = 'SiloAI'
    root.append(note)
  }
  if (!commands.length) {
    const empty = document.createElement('p')
    empty.className = 'cmd-empty'
    empty.textContent = emptyText
    root.append(empty)
    return
  }
  for (const cmd of commands) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cmd'
    if (cmd.armed) button.classList.add('armed')
    button.disabled = cmd.disabled || handsOff
    button.title = handsOff ? 'SiloAI is giving the orders' : cmd.title
    const label = document.createElement('span')
    label.className = 'cmd-label'
    label.textContent = cmd.label
    button.append(label)
    if (cmd.hotkey) {
      const key = document.createElement('kbd')
      key.textContent = cmd.hotkey
      button.append(key)
    }
    if (cmd.detail) {
      const detail = document.createElement('span')
      detail.className = 'cmd-detail'
      detail.textContent = cmd.detail
      button.append(detail)
    }
    button.addEventListener('click', () => {
      if (handsOff) return
      cmd.run()
    })
    root.append(button)
  }
}

/** Show a third-based damage value as a fraction, so 8/3 does not print as a long decimal. */
function formatThirds(value: number): string {
  const thirds = Math.round(value * 3)
  if (Math.abs(value * 3 - thirds) < 1e-6 && thirds % 3 !== 0) return `${thirds}/3`
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function nearestPlayerPorter(state: MatchState, building: Building): { id: number } | undefined {
  const center = buildingCenter(building)
  let best: { id: number } | undefined
  let bestD = Infinity
  for (const unit of state.units) {
    if (unit.owner !== controlledSide(state) || unit.kind !== 'porter' || unit.hp <= 0 || unit.frozen != null) continue
    const distance = Math.hypot(unit.x - center.x, unit.y - center.y)
    if (distance < bestD) {
      bestD = distance
      best = unit
    }
  }
  return best
}

export function describeSelection(state: MatchState): string {
  const building = state.selectedBuilding != null ? buildingById(state, state.selectedBuilding) : undefined
  if (building?.ruined && state.selectedUnits.length === 0) {
    const portraitUrl = ruinedSiloPortraitUrl()
    const portrait = portraitUrl ? `<img class="unit-icon" alt="" src="${portraitUrl}" />` : ''
    const pct = Math.max(0, Math.min(1, building.progress))
    return `
      <p class="eyebrow">Neutral</p>
      <h2>${portrait}Ruined Silo</h2>
      <div class="meter"><span style="width:${pct * 100}%"></span></div>
      <p class="meta">${SILO_REPAIR_COST} dumps · ${SILO_REPAIR_TIME}s</p>
      <p class="lore">${escapeHtml(loreBody('Ruined Silo'))}</p>
    `
  }
  if (building && state.selectedUnits.length === 0) {
    const stats = BUILDING_STATS[building.kind]
    const pct = Math.max(0, Math.min(1, building.hp / stats.hp))
    const queue = building.queue
      .map((job, index) => {
        const label = UNIT_STATS[job.kind].label
        return index === 0 ? `${label} ${Math.ceil(job.remaining)}s` : label
      })
      .join(', ')
    const raising = state.units.some(
      (unit) => unit.hp > 0 && unit.order?.type === 'construct' && unit.order.buildingId === building.id,
    )
    const status = !building.complete
      ? ` · Construction ${Math.floor(building.progress * 100)}%${raising ? '' : ' · paused'}`
      : ''
    const portraitUrl =
      building.kind === 'keep'
        ? siloPortraitUrl(building.owner)
        : building.kind === 'yard'
          ? factoryPortraitUrl(building.owner)
          : building.kind === 'silo'
            ? storagePortraitUrl(building.owner)
            : building.kind === 'tower'
              ? pillarPortraitUrl(building.owner)
              : ''
    const portrait = portraitUrl ? `<img class="unit-icon" alt="" src="${portraitUrl}" />` : ''
    return `
      <p class="eyebrow">${PLAYER_NAME[building.owner]}</p>
      <h2>${portrait}${stats.label}</h2>
      <div class="meter"><span style="width:${pct * 100}%"></span></div>
      <p class="meta">${Math.max(0, Math.ceil(building.hp))} / ${stats.hp}${status}</p>
      ${building.kind === 'keep' ? '' : `<p class="lore">${escapeHtml(loreBody(stats.label))}</p>`}
      ${building.kind === 'silo' ? `<p class="meta">${building.stock} / ${STORAGE_CAP}${building.stock >= STORAGE_CAP ? ' · Full' : ''}</p>` : ''}
      ${building.kind === 'keep' && building.cryo ? `<p class="meta">${cryoOccupants(state, building.id)} / ${CRYO_SLOTS} · ${CRYO_FREEZE_COST} dumps each · ${CRYO_FREEZE_COST * CRYO_SLOTS} for the group</p>` : ''}
      ${building.kind === 'keep' && building.cryo && building.cryoRecover > 0 ? `<p class="meta">Recovery ${formatRecover(building.cryoRecover)}</p>` : ''}
      ${stats.damage != null ? `<p class="meta">Damage ${formatThirds(stats.damage)}. Hovers take half.</p>` : ''}
      ${!building.complete && !raising ? '<p class="meta">Progress is kept. Right-click the site with a Stalker to resume.</p>' : ''}
      ${queue ? `<p class="meta">Queue: ${escapeHtml(queue)}</p>` : ''}
      ${building.complete ? '<p class="meta">Right-click the map to set the rally point.</p>' : ''}
    `
  }

  const grave = state.selectedGrave != null ? state.graves.find((entry) => entry.id === state.selectedGrave) : undefined
  if (grave && state.selectedUnits.length === 0 && state.selectedBuilding == null) {
    return `
      <p class="eyebrow">Neutral</p>
      <h2>Grave</h2>
      <p class="lore">He lived a worthy life and died a natural death.</p>
    `
  }

  const ore = state.selectedOre != null ? state.ore.find((node) => node.id === state.selectedOre) : undefined
  if (ore && state.selectedUnits.length === 0) {
    return `
      <p class="eyebrow">${PLAYER_NAME[controlledSide(state)] ?? 'Silo'}</p>
      <h2>Dumps</h2>
      <p class="meta">${ore.amount} remaining</p>
      <p class="lore">${escapeHtml(loreBody('Dumps'))}</p>
    `
  }

  const units = state.selectedUnits
    .map((id) => unitById(state, id))
    .filter((unit): unit is NonNullable<typeof unit> => !!unit && unit.hp > 0)
  if (!units.length) {
    return `
      <p class="eyebrow">${PLAYER_NAME[controlledSide(state)] ?? 'Silo'}</p>
      <h2>Surface</h2>
      <p class="lore">${escapeHtml(loreBody('Surface'))}</p>
    `
  }
  if (units.length === 1) {
    const unit = units[0]
    if (!unit) return ''
    const stats = UNIT_STATS[unit.kind]
    const pct = Math.max(0, unit.hp / stats.hp)
    const cargo = unit.cargo > 0 ? `Carrying ${unit.cargo} dumps.` : ''
    const portraitUrl =
      unit.kind === 'porter'
        ? stalkerPortraitUrl(unit.owner)
        : unit.kind === 'pike'
          ? flasherPortraitUrl(unit.owner)
          : unit.kind === 'howler'
            ? gorillaPortraitUrl(unit.owner)
            : unit.kind === 'drone'
              ? hoverPortraitUrl(unit.owner)
              : ''
    const portrait = portraitUrl ? `<img class="unit-icon" alt="" src="${portraitUrl}" />` : ''
    return `
      <p class="eyebrow">${PLAYER_NAME[unit.owner]}</p>
      <h2>${portrait}${stats.label}</h2>
      <div class="meter"><span style="width:${pct * 100}%"></span></div>
      <p class="meta">${Math.ceil(unit.hp)} / ${stats.hp}</p>
      <p class="lore">${escapeHtml(loreBody(stats.label))}</p>
      ${unit.scanning ? '<p class="meta">Scanning</p>' : ''}
      ${unit.cloak > 0 ? `<p class="meta">Invisible ${Math.ceil(unit.cloak)}s</p>` : ''}
      ${cargo ? `<p class="meta">${cargo}</p>` : ''}
    `
  }
  const counts = new Map<string, number>()
  for (const unit of units) counts.set(UNIT_STATS[unit.kind].label, (counts.get(UNIT_STATS[unit.kind].label) ?? 0) + 1)
  const summary = [...counts.entries()].map(([label, count]) => `${count} ${label}${count > 1 ? 's' : ''}`).join(', ')
  const scanning = units.some((unit) => unit.scanning)
  const portraitOwner = units[0]?.owner ?? controlledSide(state)
  const groupPortrait = units.some((unit) => unit.kind === 'porter')
    ? stalkerPortraitUrl(portraitOwner)
    : units.some((unit) => unit.kind === 'pike')
      ? flasherPortraitUrl(portraitOwner)
      : units.some((unit) => unit.kind === 'howler')
        ? gorillaPortraitUrl(portraitOwner)
        : units.some((unit) => unit.kind === 'drone')
          ? hoverPortraitUrl(portraitOwner)
          : ''
  const portrait = groupPortrait ? `<img class="unit-icon" alt="" src="${groupPortrait}" />` : ''
  return `
    <p class="eyebrow">${PLAYER_NAME[portraitOwner] ?? 'Silo'}</p>
    <h2>${portrait}${units.length} selected</h2>
    <p class="meta">${escapeHtml(summary)}</p>
    ${scanning ? '<p class="meta">Scanning</p>' : ''}
  `
}

function formatTime(time: number): string {
  const seconds = Math.floor(time)
  const min = Math.floor(seconds / 60)
  const rem = seconds % 60
  return `${min}:${rem.toString().padStart(2, '0')}`
}

/** Ceil so a full recovery reads 4:00 and a fraction still shows 0:01. */
function formatRecover(time: number): string {
  const seconds = Math.max(0, Math.ceil(time))
  const min = Math.floor(seconds / 60)
  const rem = seconds % 60
  return `${min}:${rem.toString().padStart(2, '0')}`
}

function formatDuration(time: number): string {
  const seconds = Math.max(0, Math.floor(time))
  const min = Math.floor(seconds / 60)
  const rem = seconds % 60
  return `${String(min).padStart(2, '0')}:${rem.toString().padStart(2, '0')}`
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (char) => {
    if (char === '&') return '&amp;'
    if (char === '<') return '&lt;'
    return '&gt;'
  })
}
