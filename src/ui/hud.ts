import { cancelBuilding, cancelTrain, commandStop, tryTrain } from '../game/commands'
import { toggleScanner } from '../game/scanner'
import { flasherPortraitUrl } from '../game/flasherArt'
import { gorillaPortraitUrl } from '../game/gorillaArt'
import { hoverPortraitUrl } from '../game/hoverArt'
import { stalkerPortraitUrl } from '../game/stalkerArt'
import { buildingById, unitById } from '../game/state'
import {
  BUILDING_STATS,
  PLAYER_COLOR,
  PLAYER_NAME,
  UNIT_STATS,
  type BuildingKind,
  type MatchState,
  type UnitKind,
} from '../game/types'

export interface HudActions {
  armPlace: (kind: BuildingKind) => void
  armMove: () => void
  armAttack: () => void
  dismissHint: () => void
  selectIdle: () => void
  toggleHelp: () => void
  toggleMute: () => void
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

export function syncHud(state: MatchState, muted: boolean, actions: HudActions): void {
  const ore = document.querySelector('#ore')
  const supply = document.querySelector('#supply')
  const clock = document.querySelector('#clock')
  const idle = document.querySelector('#idle')
  const mute = document.querySelector('#mute')
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
  const brand = document.querySelector('#brand-line')
  const sides = document.querySelector('#sides')

  if (ore) ore.textContent = String(state.oreHeld[0])
  const supplyText = `${state.supplyUsed[0]} / ${state.supplyCap[0]}`
  if (supply) {
    supply.textContent = supplyText
    supply.classList.toggle('tight', state.supplyCap[0] - state.supplyUsed[0] <= 1)
  }
  if (clock) clock.textContent = formatTime(state.time)
  const idleCount = state.units.filter(
    (unit) => unit.owner === 0 && unit.kind === 'porter' && unit.hp > 0 && !unit.order,
  ).length
  if (idle) idle.textContent = idleCount ? `Idle ${idleCount}` : 'Idle'
  if (mute) mute.textContent = muted ? 'Sound off' : 'Sound'
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

  if (brand) {
    brand.textContent = state.mode === 'ffa' ? 'Free for all · four Silos' : 'Silo_01 against Silo_02'
  }
  if (sides) {
    sides.innerHTML = Array.from({ length: state.playerCount }, (_, owner) => {
      const name = PLAYER_NAME[owner] ?? `Side ${owner + 1}`
      const color = PLAYER_COLOR[owner] ?? '#ffffff'
      const gone = state.eliminated[owner] || !state.buildings.some((building) => building.owner === owner && building.kind === 'keep' && building.hp > 0)
      return `<span class="${gone && owner !== 0 ? 'out' : ''}"><i style="background:${color}"></i>${escapeHtml(name)}</span>`
    }).join('')
  }

  if (overlay && endKicker && endTitle && endCopy && endSeed) {
    overlay.classList.toggle('hidden', state.outcome == null)
    const others = PLAYER_NAME.slice(1, state.playerCount).join(', ')
    if (state.outcome === 'win') {
      endKicker.textContent = PLAYER_NAME[0] ?? 'Silo_01'
      endTitle.textContent = 'New Ground is yours'
      endCopy.textContent =
        state.playerCount > 2
          ? 'Every enemy Silo is rubble. Your banners stay on the field.'
          : `The ${PLAYER_NAME[1]} Silo is rubble. Your banners stay on the field.`
    } else if (state.outcome === 'lose') {
      endKicker.textContent = state.playerCount > 2 ? 'The field' : (PLAYER_NAME[1] ?? 'Silo_02')
      endTitle.textContent = 'The silo has fallen'
      endCopy.textContent =
        state.playerCount > 2
          ? `Your Silo is gone. ${others} fight on without you.`
          : `Your Silo is gone. ${PLAYER_NAME[1]} takes New Ground.`
    }
    endSeed.textContent = `Field ${state.seed}`
  }

  const commands = buildCommands(state, actions)
  const key = `${state.aiControl ? 'ai' : 'player'}|${commands.map((cmd) => `${cmd.id}:${cmd.disabled}:${cmd.armed}:${cmd.detail ?? ''}`).join('|')}`
  if (key !== commandKey) {
    commandKey = key
    paintCommands(commands, state.aiControl)
  }
}

export function resetHudCache(): void {
  commandKey = '\0'
}

function buildCommands(state: MatchState, actions: HudActions): Cmd[] {
  if (state.outcome) return []
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
  if (building && building.owner === 0 && state.selectedUnits.length === 0) {
    if (!building.complete) {
      return [
        {
          id: 'cancel-build',
          label: 'Cancel',
          detail: '75% back',
          title: 'Cancel construction and refund most of the dumps',
          disabled: false,
          run: () => cancelBuilding(state, building.id),
        },
      ]
    }
    if (building.kind === 'keep') {
      const cmds = [
        trainButton(state, building.id, 'porter'),
        placeButton(state, 'yard', actions),
        placeButton(state, 'silo', actions),
        placeButton(state, 'tower', actions),
      ]
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
          commandStop(state, state.selectedUnits)
          state.moveArmed = false
          state.attackMoveArmed = false
        },
      },
    ]
    const hovers = state.selectedUnits
      .map((id) => unitById(state, id))
      .filter((unit): unit is NonNullable<typeof unit> => !!unit && unit.owner === 0 && unit.kind === 'drone' && unit.hp > 0)
    if (hovers.length) {
      cmds.push({
        id: 'scan',
        label: 'Scanner',
        hotkey: 'C',
        title: 'Fly to the nearest black fog, then the tiles seen longest ago',
        disabled: false,
        armed: hovers.every((unit) => unit.scanning),
        run: () => toggleScanner(state, hovers.map((unit) => unit.id)),
      })
    }
    if (porters) {
      cmds.push(placeButton(state, 'yard', actions), placeButton(state, 'silo', actions), placeButton(state, 'tower', actions))
    }
    return cmds
  }
  return []
}

function cancelTrainButton(state: MatchState, buildingId: number): Cmd {
  return {
    id: 'cancel-train',
    label: 'Cancel',
    detail: 'last order',
    title: 'Refund the latest training order',
    disabled: false,
    run: () => cancelTrain(state, buildingId),
  }
}

function placeButton(state: MatchState, kind: BuildingKind, actions: HudActions): Cmd {
  const stats = BUILDING_STATS[kind]
  const afford = state.oreHeld[0] >= stats.cost
  return {
    id: `place-${kind}`,
    label: stats.label,
    hotkey: kind === 'yard' ? 'Y' : kind === 'silo' ? 'L' : 'T',
    detail: `${stats.cost} dumps`,
    title: afford ? stats.blurb : `Need ${stats.cost} dumps`,
    disabled: !afford,
    armed: state.placement === kind,
    run: () => actions.armPlace(kind),
  }
}

function trainButton(state: MatchState, buildingId: number, kind: UnitKind): Cmd {
  const stats = UNIT_STATS[kind]
  const afford = state.oreHeld[0] >= stats.cost
  const room = stats.supply === 0 || state.supplyUsed[0] + stats.supply <= state.supplyCap[0]
  let title = stats.blurb
  if (!afford) title = `Need ${stats.cost} dumps`
  else if (!room) title = 'Cells cap reached — raise a Storage'
  const cells = stats.supply === 1 ? '1 cell' : `${stats.supply} cells`
  const detail = stats.supply === 0 ? `${stats.cost} dumps · no cells` : `${stats.cost} dumps · ${cells}`
  return {
    id: `train-${kind}`,
    label: stats.label,
    hotkey: kind === 'porter' ? 'P' : kind === 'pike' ? 'K' : kind === 'howler' ? 'J' : 'H',
    detail,
    title,
    disabled: !afford || !room,
    run: () => {
      const error = tryTrain(state, buildingId, kind)
      if (error) state.toasts.push({ text: error, life: 3 })
    },
  }
}

function paintCommands(commands: Cmd[], handsOff: boolean): void {
  const root = document.querySelector('#commands')
  if (!root) return
  root.innerHTML = ''
  if (!commands.length) {
    const empty = document.createElement('p')
    empty.className = 'cmd-empty'
    empty.textContent = 'Select stalkers, the Silo, or a Factory.'
    root.append(empty)
    return
  }
  for (const cmd of commands) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cmd'
    if (cmd.armed) button.classList.add('armed')
    button.disabled = cmd.disabled || handsOff
    button.title = handsOff ? 'AI control is giving the orders' : cmd.title
    if (cmd.id === 'train-porter' || cmd.id === 'train-pike' || cmd.id === 'train-howler' || cmd.id === 'train-drone') {
      const icon = document.createElement('img')
      icon.className = 'unit-icon'
      icon.alt = ''
      const src =
        cmd.id === 'train-drone'
          ? hoverPortraitUrl(0)
          : cmd.id === 'train-howler'
            ? gorillaPortraitUrl(0)
            : cmd.id === 'train-pike'
              ? flasherPortraitUrl(0)
              : stalkerPortraitUrl(0)
      icon.src = src
      button.append(icon)
    }
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

export function describeSelection(state: MatchState): string {
  const building = state.selectedBuilding != null ? buildingById(state, state.selectedBuilding) : undefined
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
      ? `Construction ${Math.floor(building.progress * 100)}%${raising ? '' : ' · paused'}`
      : stats.blurb
    return `
      <p class="eyebrow">${PLAYER_NAME[building.owner]}</p>
      <h2>${stats.label}</h2>
      <div class="meter"><span style="width:${pct * 100}%"></span></div>
      <p class="meta">${Math.max(0, Math.ceil(building.hp))} / ${stats.hp} · ${status}</p>
      ${stats.damage != null ? `<p class="meta">Damage ${formatThirds(stats.damage)}. Hovers take half.</p>` : ''}
      ${!building.complete && !raising ? '<p class="meta">Progress is kept. Right-click the site with a Stalker to resume.</p>' : ''}
      ${queue ? `<p class="meta">Queue: ${escapeHtml(queue)}</p>` : ''}
      ${building.complete ? '<p class="meta">Right-click the map to set the rally point.</p>' : ''}
    `
  }

  const ore = state.selectedOre != null ? state.ore.find((node) => node.id === state.selectedOre) : undefined
  if (ore && state.selectedUnits.length === 0) {
    return `
      <p class="eyebrow">${PLAYER_NAME[0]}</p>
      <h2>Dumps</h2>
      <p class="meta">${ore.amount} remaining</p>
    `
  }

  const units = state.selectedUnits
    .map((id) => unitById(state, id))
    .filter((unit): unit is NonNullable<typeof unit> => !!unit && unit.hp > 0)
  if (!units.length) {
    return `
      <p class="eyebrow">${PLAYER_NAME[0]}</p>
      <h2>New Ground</h2>
      <p class="meta">${state.playerCount > 2 ? 'Destroy every enemy Silo.' : 'Destroy the enemy Silo.'} If your Silo falls, the field is lost. Stalkers mine the dumps beside your Silo first; after those run out they take the nearest patch a scout has revealed. Rocks, trees, and dumps block every ground unit. Trees have half the life of rock. Raise a Pillar inside Silo sight. It shoots the closest enemy in its own sight. Flashers and gorillas cannot break rock. A Hover flies and does not shoot.</p>
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
      <p class="meta">${Math.ceil(unit.hp)} / ${stats.hp} · ${stats.blurb}</p>
      ${unit.scanning ? '<p class="meta">Scanning</p>' : ''}
      ${cargo ? `<p class="meta">${cargo}</p>` : ''}
    `
  }
  const counts = new Map<string, number>()
  for (const unit of units) counts.set(UNIT_STATS[unit.kind].label, (counts.get(UNIT_STATS[unit.kind].label) ?? 0) + 1)
  const summary = [...counts.entries()].map(([label, count]) => `${count} ${label}${count > 1 ? 's' : ''}`).join(', ')
  const scanning = units.some((unit) => unit.scanning)
  const groupPortrait = units.some((unit) => unit.kind === 'porter')
    ? stalkerPortraitUrl(0)
    : units.some((unit) => unit.kind === 'pike')
      ? flasherPortraitUrl(0)
      : units.some((unit) => unit.kind === 'howler')
        ? gorillaPortraitUrl(0)
        : units.some((unit) => unit.kind === 'drone')
          ? hoverPortraitUrl(0)
          : ''
  const portrait = groupPortrait ? `<img class="unit-icon" alt="" src="${groupPortrait}" />` : ''
  return `
    <p class="eyebrow">${PLAYER_NAME[0]}</p>
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

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (char) => {
    if (char === '&') return '&amp;'
    if (char === '<') return '&lt;'
    return '&gt;'
  })
}
