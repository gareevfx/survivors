/** Field lore. The panel title already names the subject, so these are the descriptions only. */
export const LORE_ENTRIES: ReadonlyArray<{ name: string; body: string }> = [
  {
    name: 'New Ground',
    body: 'Uncharted territory; however, the remnants of old machinery and debris on the surface indicate that an advanced civilization once existed here.',
  },
  {
    name: 'Silo',
    body: 'A shelter housing people; it was clearly built a long time ago. This building serves as a training site for "Stalkers" and acts as a command center for construction operations.',
  },
  {
    name: 'Stalker',
    body: 'Shelter inhabitants retrained for surface operations. Their task is to scavenge valuable parts left over from the past from the piles of technical debris on the surface to use in future construction of machinery and buildings. Their lives are highly valued, and their protected status is widely recognized, though they can still be captured. They are also capable of traversing the terrain by clearing obstacles like rocks and trees from their path.',
  },
  {
    name: 'Dumps',
    body: 'The piles of technical debris found on the "New Ground" surface.',
  },
  {
    name: 'Cells',
    body: 'Storage units for processed, useful parts intended for future construction.',
  },
  {
    name: 'Storage',
    body: 'Buildings that house these storage cells. These can be placed near "Dumps" to facilitate rapid delivery by "Stalkers."',
  },
  {
    name: 'Pillar',
    body: 'A structure serving as both a wind turbine and a combat observation post. Its weapon-equipped tower helps fend off hostile intruders.',
  },
  {
    name: 'Factory',
    body: 'An automated facility for manufacturing combat and exploration robotics.',
  },
  {
    name: 'Flasher',
    body: 'A combat robot unit resembling an off-road motorcycle equipped with a cannon; its key feature is high-speed mobility.',
  },
  {
    name: 'Gorilla',
    body: 'A heavy combat robot (tank).',
  },
  {
    name: 'Hover',
    body: 'A flying robot primarily tasked with terrain exploration.',
  },
]

export function loreBody(name: string): string {
  return LORE_ENTRIES.find((entry) => entry.name === name)?.body ?? ''
}
