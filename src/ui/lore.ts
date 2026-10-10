/** Descriptions for the info panel. The panel title already names the subject. */
export const LORE_ENTRIES: ReadonlyArray<{ name: string; body: string }> = [
  { name: 'Surface', body: 'Uncharted territory;' },
  { name: 'Silo', body: 'A shelter housing people;' },
  { name: 'Ruined Silo', body: 'A collapsed shelter. A Stalker can repair it.' },
  { name: 'Stalker', body: 'Trained shelter residents;' },
  { name: 'Dumps', body: 'The piles of technical debris;' },
  { name: 'Cells', body: 'Storage units;' },
  { name: 'Storage', body: 'Storage for Cells;' },
  { name: 'Pillar', body: 'Windmill with battle tower;' },
  { name: 'Factory', body: 'Facility for manufacturing combat and exploration units;' },
  { name: 'Flasher', body: 'Very fast unit;' },
  { name: 'Gorilla', body: 'Tank;' },
  { name: 'Hover', body: 'Surface explorer;' },
]

export function loreBody(name: string): string {
  return LORE_ENTRIES.find((entry) => entry.name === name)?.body ?? ''
}
