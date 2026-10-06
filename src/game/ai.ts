import { aiPlaceNearKeep, commandMove, tryTrain } from './commands'
import { buildingCenter } from './state'
import { BUILDING_STATS, TILE, type MatchState, type Unit } from './types'

function idlePorter(unit: Unit): boolean {
  return unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0 && !unit.order
}

export function updateAi(state: MatchState, dt: number): void {
  if (state.outcome) return
  state.aiAcc += dt
  if (state.aiAcc < 0.5) return
  state.aiAcc = 0

  const porters = state.units.filter((unit) => unit.owner === 1 && unit.kind === 'porter' && unit.hp > 0)
  for (const porter of porters) {
    if (!idlePorter(porter)) continue
    const node = nearestNode(state, porter.x, porter.y)
    if (!node) continue
    porter.order = {
      type: 'gather',
      nodeId: node.id,
      phase: porter.cargo > 0 ? 'return' : 'approach',
    }
    porter.nodeMemory = node.id
    porter.path = []
    porter.goalX = null
    porter.goalY = null
  }

  const keep = state.buildings.find((building) => building.owner === 1 && building.kind === 'keep' && building.hp > 0)
  if (!keep?.complete) return

  const queuedPorters = keep.queue.filter((job) => job.kind === 'porter').length
  if (porters.length + queuedPorters < 6 && keep.queue.length < 2) {
    tryTrain(state, keep.id, 'porter')
  }

  const constructing = state.buildings.some((building) => building.owner === 1 && !building.complete && building.hp > 0)
  const yard = state.buildings.find((building) => building.owner === 1 && building.kind === 'yard' && building.hp > 0)
  const silos = state.buildings.filter((building) => building.owner === 1 && building.kind === 'silo' && building.hp > 0).length
  if (!constructing) {
    if (!yard && state.oreHeld[1] >= BUILDING_STATS.yard.cost) {
      aiPlaceNearKeep(state, 'yard')
    } else if (
      state.supplyCap[1] - state.supplyUsed[1] <= 2 &&
      silos < 4 &&
      state.oreHeld[1] >= BUILDING_STATS.silo.cost
    ) {
      aiPlaceNearKeep(state, 'silo')
    }
  }

  const readyYard = state.buildings.find(
    (building) => building.owner === 1 && building.kind === 'yard' && building.complete && building.hp > 0,
  )
  if (readyYard && readyYard.queue.length < 1) {
    const first = state.aiNext
    const second = first === 'pike' ? 'howler' : 'pike'
    if (tryTrain(state, readyYard.id, first) === null) state.aiNext = second
    else tryTrain(state, readyYard.id, second)
  }

  const army = state.units.filter((unit) => unit.owner === 1 && unit.kind !== 'porter' && unit.hp > 0)
  const playerKeep = state.buildings.find(
    (building) => building.owner === 0 && building.kind === 'keep' && building.hp > 0,
  )
  const keepPoint = buildingCenter(keep)
  const threatened = state.units.some(
    (unit) =>
      unit.owner === 0 &&
      unit.kind !== 'porter' &&
      unit.hp > 0 &&
      Math.hypot(unit.x - keepPoint.x, unit.y - keepPoint.y) < 340,
  )
  if (threatened || army.length >= 10 || (state.time > 105 && army.length >= 5)) state.aiAttacking = true
  if (!threatened && army.length === 0) state.aiAttacking = false
  if (!state.aiAttacking || !playerKeep) return

  const dest = threatened ? keepPoint : buildingCenter(playerKeep)
  for (const unit of army) {
    if (unit.order?.type === 'attack') continue
    if (unit.order?.type === 'attackMove' && unit.order.focusId != null) continue
    if (
      unit.order?.type === 'attackMove' &&
      Math.hypot(unit.order.x - dest.x, unit.order.y - dest.y) < 56
    ) {
      continue
    }
    commandMove(state, [unit.id], dest.x, dest.y, true)
  }
}

function nearestNode(state: MatchState, x: number, y: number): { id: number } | null {
  let best: { id: number } | null = null
  let bestD = Infinity
  for (const node of state.ore) {
    if (node.amount <= 0) continue
    const dx = (node.tx + 0.5) * TILE - x
    const dy = (node.ty + 0.5) * TILE - y
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = node
    }
  }
  return best
}
