import { GRID_CLOAK_SECONDS } from '../game/types'

/** Descriptions for the info panel. The panel title already names the subject. */
export const LORE_ENTRIES: ReadonlyArray<{ name: string; body: string }> = [
  { name: 'Surface', body: 'Uncharted territory;' },
  { name: 'Silo', body: 'A shelter housing people;' },
  { name: 'Ruined Silo', body: 'A collapsed shelter. A Stalker can repair it.' },
  { name: 'Stalker', body: 'Trained shelter residents; lives for 5 minutes;' },
  { name: 'Dumps', body: 'The piles of technical debris;' },
  { name: 'Cells', body: 'Storage units, up to 65;' },
  { name: 'Storage', body: 'Storage for Cells;' },
  {
    name: 'Cryo',
    body: 'A 2×2 vault. Building it costs 250 dumps. It holds 4 Stalkers. Select 4 Stalkers to freeze them. Freezing costs 50 dumps each, 200 for the group, when they enter. Inside, a Stalker leaves the map, cannot be attacked, and its 5-minute life is paused. Thaw releases them, then the Cryo recovers for 4 minutes. Destroying the Cryo releases them too.',
  },
  { name: 'Pillar', body: 'Windmill with battle tower;' },
  { name: 'Factory', body: 'Facility for manufacturing combat and exploration units;' },
  { name: 'Flasher', body: 'Very fast unit;' },
  { name: 'Gorilla', body: 'Tank;' },
  { name: 'Hover', body: `Surface explorer; Select 10 Hovers to activate the Grid. Those Hovers turn invisible for ${GRID_CLOAK_SECONDS} seconds. A scanning Hover reveals an invisible enemy Hover inside its sight.` },
]

export function loreBody(name: string): string {
  return LORE_ENTRIES.find((entry) => entry.name === name)?.body ?? ''
}
