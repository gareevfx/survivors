# Survivors

A browser RTS. Run with `npm install` then `npm run dev`.

## About the game

The world has run out of fresh resources, and what's left is the wreckage. Piles of technical debris, called Dumps, lie scattered across the map. Each player starts with a single Silo, the command center that trains Stalkers. These hardy scavengers can't be destroyed. They haul Dumps back to the Silo or to Storages that hold your Cells, and they clear rocks and trees from their path as they go.

Stalkers aren't safe from everyone. Anyone can capture one that wanders outside the watchful range of a Silo, Flasher, Gorilla or Storage. Pillars, the windmills with battle towers, can also capture them. So you expand carefully. A Silo can add a Cryo once, for 250 dumps: four glass vessels. Select 4 Stalkers and send them to the Silo to freeze them. Freezing costs 50 dumps each, 200 for the group, when they enter. Inside, a Stalker leaves the map, cannot be attacked, and its 5-minute life is paused. Thaw releases them beside the Silo, then the Cryo recovers for 4 minutes. If the Silo is destroyed or captured, they are released too. Factories turn out Flashers, which are lightning-fast raiders. They also build Gorillas, the heavy tanks that smash buildings, and Hover scouts that map the unknown, because nobody can build in uncharted land.

Everything comes down to the Silo. Destroy an enemy's Silo and you capture it, along with every building, every unit and every resource that player owned. In a 1v1 on a tight 80x40 map, that ends the match. In the four-player free-for-all on 90x50, and the eight-player free-for-all on 100x100, the war goes on. Even a ruined Silo isn't gone for good, since a brave Stalker can repair it.

Each match is a race between scavenging and fighting. The SiloAI plays by the same rules and never lets a Stalker idle. It builds Storages beside fresh Dumps and keeps a tidy gap between its buildings. It widens narrow passages and gathers its army before it strikes. You can face it as an opponent, or hand it your own side as an autoplayer.

## Game rules

**Goal**
- Destroy an enemy Silo to capture it. All of that player's buildings and units become yours, and their resources transfer to you.
- In 1v1 that wins the match. In the 4-player and 8-player modes the game continues.
- A destroyed Silo stays as a ruin, and a Stalker can repair it.

**Economy**
- Stalkers gather Dumps (piles of technical debris) and deliver them to the Silo or to a Storage.
- Storage raises your Cells capacity, and the limit is 100 Cells. Training units checks Cells.
- A Storage holding 500 Dumps is full and accepts no more deliveries.
- A Stalker can also harvest from an enemy Storage.
- When a Storage is destroyed by a Flasher or Gorilla, one pile of Dumps is left at the site.

**Stalkers**
- Stalkers can't be destroyed, but an enemy can capture them.
- They can't be captured inside the vision range of a Silo, Flasher, Gorilla or Storage.
- They can be captured while they are building a Storage.
- Pillars can capture them.
- They clear rocks and trees from their path.

**Buildings and units**
- Silo: trains Stalkers and is the command center. It is 3x3.
- Storage: stores Cells.
- Cryo: added once to a Silo for 250 dumps. Four glass vessels hold 4 Stalkers. Select 4 and send them to the Silo: 50 dumps each, 200 for the group. A frozen Stalker's 5-minute life is paused. After a thaw the Cryo recovers for 4 minutes. Destroying or capturing the Silo releases them.
- Pillar: a windmill with a battle tower. Its build time and life are halved.
- Factory: makes combat and exploration units. It is 3x3.
- Flasher: a very fast unit.
- Gorilla: a tank, best against buildings.
- Hover: a flying scout.

**Map**
- Narrow passages must be at least 2 tiles wide.
- Tree and rock life is halved.
- Stalkers can't build in uncharted territory.
- Modes: 1v1 on 80x40, 4 players on 90x50, and 8 players on 100x100.

**SiloAI**
- It plays by the same rules, as an opponent or as an autoplayer.
- Military units attack or defend, and Stalkers never idle.
- It builds Storage near new Dumps when the ones near its Silo run out.
- It keeps a 2-cell gap between buildings.
- It gathers a group of units before attacking.
- It widens narrow passages.

## Donat

If you are interested in the game and would like to help expand its universe (or perhaps even support the development of a 3D version), please consider making a contribution by transferring funds:

- Crypto (ETH) 0x8853fae653B3b0600377928a1D528ABF43c9fe7F
