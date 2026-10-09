import {
  BUILDING_STATS,
  PLAYER_NAME,
  UNIT_STATS,
  type BuildingKind,
  type UnitKind,
} from '../game/types'

const UNIT_ORDER: UnitKind[] = ['porter', 'drone', 'pike', 'howler']
const BUILDING_ORDER: BuildingKind[] = ['keep', 'silo', 'yard', 'tower']

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (char) => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;'))
}

function formatDamage(value: number): string {
  const thirds = Math.round(value * 3)
  if (Math.abs(value * 3 - thirds) < 1e-6 && thirds % 3 !== 0) return `${thirds}/3`
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value)
}

function unitArticle(kind: UnitKind): string {
  const stats = UNIT_STATS[kind]
  const cells = stats.supply === 0 ? 'no cells' : stats.supply === 1 ? '1 cell' : `${stats.supply} cells`
  const weapon =
    stats.damage <= 0
      ? 'No weapon.'
      : `Damage ${formatDamage(stats.damage)}, range ${stats.range}, every ${num(stats.cooldown)}s.`
  return `
    <article>
      <h4>${escapeHtml(stats.label)}</h4>
      <p class="meta">${stats.cost} dumps · ${cells} · trains in ${num(stats.trainTime)}s · health ${stats.hp} · speed ${stats.speed} · sight ${stats.sight}. ${weapon}</p>
      <p>${escapeHtml(stats.blurb)}</p>
    </article>
  `
}

function buildingArticle(kind: BuildingKind): string {
  const stats = BUILDING_STATS[kind]
  const cost = stats.cost === 0 ? 'stands at the start' : `${stats.cost} dumps`
  const cells = stats.supply === 0 ? 'no cells' : `+${stats.supply} cells`
  const damage = stats.damage != null ? ` Damage ${formatDamage(stats.damage)}.` : ''
  return `
    <article>
      <h4>${escapeHtml(stats.label)}</h4>
      <p class="meta">${stats.w}×${stats.h} · ${cost} · ${num(stats.buildTime)}s · health ${stats.hp} · ${cells} · sight ${stats.sight}.${damage}</p>
      <p>${escapeHtml(stats.blurb)}</p>
    </article>
  `
}

const LORE: Array<[string, string]> = [
  ['New Ground', 'Uncharted territory; however, the remnants of old machinery and debris on the surface indicate that an advanced civilization once existed here.'],
  ['Silo', 'A shelter housing people; it was clearly built a long time ago. This building serves as a training site for "Stalkers" and acts as a command center for construction operations.'],
  ['Stalker', 'Shelter inhabitants retrained for surface operations. Their task is to scavenge valuable parts left over from the past from the piles of technical debris on the surface to use in future construction of machinery and buildings. Their lives are highly valued, and their protected status is widely recognized, though they can still be captured. They are also capable of traversing the terrain by clearing obstacles like rocks and trees from their path.'],
  ['Dumps', 'The piles of technical debris found on the "New Ground" surface.'],
  ['Cells', 'Storage units for processed, useful parts intended for future construction.'],
  ['Storage', 'Buildings that house these storage cells. These can be placed near "Dumps" to facilitate rapid delivery by "Stalkers."'],
  ['Pillar', 'A structure serving as both a wind turbine and a combat observation post. Its weapon-equipped tower helps fend off hostile intruders.'],
  ['Factory', 'An automated facility for manufacturing combat and exploration robotics.'],
  ['Flasher', 'A combat robot unit resembling an off-road motorcycle equipped with a cannon; its key feature is high-speed mobility.'],
  ['Gorilla', 'A heavy combat robot (tank).'],
  ['Hover', 'A flying robot primarily tasked with terrain exploration.'],
]

function term(name: string): string {
  return `<b>"${escapeHtml(name)}"</b>`
}

function loreMarkup(): string {
  const items = LORE.map(([name, body]) => {
    const text = escapeHtml(body).replace(/&quot;|\"([^\"]+)\"/g, (_match, quoted: string) => term(quoted))
    return `<li>${term(name)}: ${text}</li>`
  })
  return `<ul>${items.join('')}</ul>`
}

/** Lore, commands, and the roster. Costs and stats come from the match config. */
export function rulesMarkup(): string {
  const you = PLAYER_NAME[0] ?? 'Silo 01'
  return `
    <h3>Rules</h3>
    ${loreMarkup()}
    <h3>Commands</h3>
    <ul>
      <li><b>Enter</b> opens the command line. The box says “write here”. Escape closes it.</li>
      <li><b>Off FOW</b> reveals the map. <b>FOW</b> hides it again, except what you can see.</li>
      <li><b>Both Cam</b> draws whatever any side can see. <b>Off Both Cam</b> returns to your sight.</li>
      <li><b>Show Enemy Cam</b> draws what every other side can see. <b>Off Enemy Cam</b> returns to your sight.</li>
      <li><b>AI Control</b> lets the computer play ${you} from your own sight. <b>Off AI Control</b> gives those orders back.</li>
      <li><b>God Mode</b> stops damage to your units and buildings, so enemies cannot capture your Stalkers either. <b>Off God Mode</b> lets them take hits again.</li>
    </ul>
    <h3>Units</h3>
    <div class="roster">
      ${UNIT_ORDER.map(unitArticle).join('')}
    </div>
    <h3>Buildings</h3>
    <div class="roster">
      ${BUILDING_ORDER.map(buildingArticle).join('')}
    </div>
    <h3>Controls</h3>
    <ul>
      <li><b>Left-click</b> a friendly unit or building. Drag a box to select several. Shift adds. <b>Double-click</b> a unit to grab every visible one of that type.</li>
      <li><b>Right-click</b> ground to move, an enemy to attack, dumps to gather, an enemy Storage that holds dumps so Stalkers haul them out, or gray rock or a tree with Stalkers to break it.</li>
      <li><b>Q</b>, then left-click, orders an attack-move. <b>X</b> stops. <b>Esc</b> or right-click cancels placement.</li>
      <li><b>Y</b> places a Factory, <b>L</b> a Storage, and <b>T</b> a Pillar. A Pillar must stand inside Silo sight.</li>
      <li><b>P</b> trains a Stalker from the Silo. <b>K</b> trains a Flasher, <b>J</b> a Gorilla, and <b>H</b> a Hover, when a Factory is selected. <b>Cancel</b> (last order) refunds the newest job.</li>
      <li><b>C</b> or <b>Scanner</b>, with Hovers selected, sends them through the black fog. Press it again, give a move order, or press <b>X</b> to stop.</li>
      <li><b>Pause</b> freezes the match. The Pause button sits beside Rules, and the Pause key does the same. The command line still opens.</li>
      <li><b>WASD</b> or the arrow keys pan. Wheel zooms. The edge of the map scrolls. Middle-drag pans. Click the minimap to jump. <b>Space</b> recenters.</li>
      <li><b>F</b> selects idle Stalkers. <b>Ctrl+1–9</b> saves a group, <b>1–9</b> recalls it. <b>M</b> mutes. <b>?</b> or <b>F1</b> opens Rules.</li>
      <li>Right-click with a building selected to set its rally point.</li>
      <li>Touch: drag to pan, tap to select, tap the ground to move, tap an enemy to attack.</li>
    </ul>
  `
}
