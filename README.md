# Ridgekeep

A single-player real-time strategy skirmish in the browser. Silo_01 and Silo_02 each hold a Silo on New Ground, among dumps, rock, and trees. Gather the dumps beside your Silo, raise a Factory, Storages, and Pillars, train stalkers, flashers, gorillas, and hovers, and destroy the enemy Silo. If your own Silo falls, the field is lost.

The factions, names, and shapes are original. The map is drawn with canvas geometry — there is no borrowed art.

## Run locally

```bash
npm install
npm run dev
```

Vite serves the game at [http://127.0.0.1:4317](http://127.0.0.1:4317).

```bash
npm run typecheck   # TypeScript only
npm run smoke       # headless simulation checks
npm run build       # production bundle in dist/
npm run preview     # serve the bundle
```

No account, server, or network connection is required after install.

## How to play

You start with a Silo, four stalkers, and a small store of dumps — not enough for a Factory. Each match places the two Silos in opposite corners, as far apart as that map allows. The nearest dumps sit on the edge of each Silo's sight: inside the starting view, not beside the walls. The red Silo_02 base will gather, build, and march on you.

1. Select the stalkers (click or drag a box) and right-click a gold dumps patch. Up to three stalkers work that patch. They mine the Silo-area dumps first, from a neighboring tile. After those run out, extras walk to the nearest revealed patch by path length. They do not set out for dumps still under the fog. If gray rock or a tree seals a patch, those stalkers break it, then haul. Rocks, trees, and dumps patches block stalkers, flashers, and gorillas until the rock or tree is destroyed or the patch is mined out.
2. They gather, walk the dumps back to your Silo, and repeat. The count is in the top bar.
3. Select a stalker (or the Silo) and place a **Factory**. Ordering it from the Silo sends the nearest idle Stalker, or the nearest miner if every Stalker is already hauling. The site rises only while a stalker stands on it. If that stalker dies or is sent away, the next free Stalker takes over. With nobody left to send, the label switches to **Paused** and the dumps stay spent until you cancel. A second stalker on the site speeds the work.
4. Place a **Storage** when the store cells bar is full. Each Storage adds room for 8 more.
5. Select the Factory and train **flashers** (short reach, 50 dumps), **gorillas** (long reach, 100 dumps), and **hovers** (75 dumps, no store cells, 11 seconds). A Hover flies over rock, trees, and dumps, carries no weapon, and sees as far as a Silo. Gorillas cannot attack it. Flashers and Pillars can, and deal half their usual damage.
6. Place a **Pillar** (`T`, 100 dumps) inside the Silo's sight. It occupies one cell and sees as far as a Hover. It automatically shoots the closest enemy in that sight for 8/3 damage at a Flasher's rate. Hovers take half of that. It keeps shooting that enemy until they leave sight or die. Rocks and trees still stop the shot. The blue ring while placing it is Silo sight: green cells are legal, red cells are not.
7. Right-click enemies to attack, or press **Q** and left-click for attack-move. Shots stop at gray rock and trees. Right-click gray rock or a tree with stalkers to break it — flashers and gorillas cannot — and the tile stops blocking once it shatters. Left-click a dumps patch to see how much is left. Stalkers sent to a sealed patch break the rocks in the way, then haul. A stalker who cannot move for about 4 seconds leaves that job for the next dumps patch or unfinished building.
8. Destroy the Silo_02 Silo to win. If your Silo falls, the skirmish is lost. Silo_02 and AI Control keep fighters and Pillars at the Silo, and pull the army home when that Silo or a nearby building is under attack.

## Controls

| Action | Input |
| --- | --- |
| Select | Left-click. Drag a box for several units. Shift adds. |
| Select all of one type on screen | Double-click a unit |
| Move | Right-click ground, or the Move button then left-click |
| Attack | Right-click an enemy. Right-click gray rock or a tree with stalkers to break it. Flashers and gorillas cannot. |
| Attack-move | `Q`, then left-click |
| Gather | Right-click dumps with stalkers selected. Stalkers take Silo-area dumps first. At most 3 stalkers per patch. After the base runs out, extras take the nearest revealed patch by path length. They break gray rock or trees that seal their patch, and they mine from a neighboring tile. |
| Dumps amount | Left-click a dumps patch |
| Stop | `X` |
| Factory / Storage / Pillar | `Y` / `L` / `T`, then left-click the map. A Pillar must sit inside Silo sight |
| Train stalker | Select the Silo, `P` |
| Train flasher / gorilla / hover | Select the Factory, `K` / `J` / `H` |
| Rally point | Select a building, right-click the ground |
| Cancel placement or clear selection | `Esc` or right-click |
| Pan | `WASD` or arrow keys, or move the pointer to the screen edge |
| Pan (drag) | Middle mouse. On a touch screen, drag the map |
| Zoom | Mouse wheel |
| Jump camera | Click the minimap |
| Center camera | `Space` (selection, or your Silo) |
| Idle stalkers | `F` or the Idle button |
| Control groups | `Ctrl+1`–`9` to save, `1`–`9` to recall. Tap the number again to center. |
| Command line | `Enter`. The box says “write here”. `Off FOW` reveals the map, and `FOW` hides it again except what you can see. `God Mode` makes your units and buildings invulnerable, and `Off God Mode` turns that off. `Show Enemy Cam` draws only what Silo_02 can see, and `Off Enemy Cam` returns to your own sight. `Both Cam` draws whatever either side can see, and `Off Both Cam` returns to your own sight. `AI Control` plays Silo_01 with that same sight, and `Off AI Control` returns the orders. Escape cancels. |
| Pause | Pause button (beside Controls), or the Pause key. The match clock stops. Resume continues from that moment. |
| Mute | `M` |
| Controls overlay | `?` or `F1` |

Touch: drag pans the map, a tap selects, a tap on open ground moves the selection, and a tap on an enemy attacks.

## Known limitations

- Save games and multiplayer are not included. Both sides have fog of war: black for unexplored ground, and a dark shroud for ground that has been seen but is not being watched. The black hides everything. Rocks and dumps stay visible in the gray shroud. Enemy units and buildings stay hidden until they are in sight. Sight comes from stalkers, flashers, gorillas, hovers, and buildings. Press Enter and run Off FOW to reveal the whole map for Silo_01. FOW turns that off and hides everything outside current sight. Show Enemy Cam draws the map with Silo_02's sight instead, and Off Enemy Cam returns to Silo_01's sight. Both Cam lights any ground either side can see and grays ground either side has explored, and Off Both Cam returns to Silo_01's sight. These views replace one another and do not change what either side knows. God Mode keeps Silo_01 units and buildings from taking damage, and Off God Mode lets them take damage again. Silo_02 keeps its own fog and has to scout.
- One wide 16:9 map, one dumps type, and one enemy script. Dumps patches are spread across the field. Silo_02 gathers only patches it has seen. It uses the same roster as Silo_01: stalkers, flashers, gorillas, hovers, Storages, Pillars, a Factory, and a Silo, under the same fog and rock rules. Silo_02 trains up to two Hovers, and AI Control does the same for Silo_01. A Hover keeps flying: nearby black fog first, then the far map for the enemy Silo, then gray ground, including after the whole map has been visited. It stays clear of a Flasher it can see. Before a Hover exists, a Flasher scouts, or one spare Stalker. Finds are mined only after they are revealed, and the army attacks the Silo once a scout has seen it. An AI Factory, Storage, or Pillar keeps one empty tile on every side, stays three tiles from every dumps patch, and does not sit on the straight haul from its Silo to a patch within twelve tiles. Pillars are placed only inside Silo sight, up to three, after two Factories. Silo_02 builds Factories and Storages with no count limit and trains fighters alongside those Hovers. Its army’s objective is to destroy your Silo and to keep its own. It leaves a couple of fighters at home, marches on your Silo once a unit has seen it, and pulls the army back when its Silo or a nearby building is under attack. It will not settle for sieging another building instead. If it has not seen the Silo, it still defends its own when your fighters are in sight, or marches on another building it has spotted. If gray rock seals that march, or forces a detour of about a dozen tiles, Silo_02 sends stalkers to break the stone, then resumes the attack. Flashers and gorillas never damage rock. Silo_02 hauls along the shortest open path. When a patch is sealed, its stalkers break the blocking rocks closest to that patch, then walk the opened ground. Each deposit takes at most 3 stalkers from one side. Stalkers mine Silo-area dumps first. Once those are gone, a revealed patch is taken by path length, even if rocks must be broken on the way. When every revealed patch is empty, both sides break rocks toward the dumps that take the least travel and chipping time. An unfinished building gains progress only while a stalker is constructing on that site.
- Units steer around friendly and enemy units instead of hard-blocking. Buildings, rock, trees, and dumps block the body of every ground unit. A tile opens when its rock or tree is destroyed, or when its dumps patch is mined out. Pathing is grid A* and will not cut between two blocked tiles. If a ground unit is ever inside a blocked tile, it is moved to the nearest free cell. Hovers fly in a straight line and ignore those blockers. Stalkers ordered onto gray rock or a tree break it, including obstacles that seal a dumps patch, and they do not step onto that tile until it is gone. Flashers, gorillas, hovers, idle units, and attack-move do not seek stones out. Hovers deal no damage. Gorillas cannot attack a Hover. Flashers and Pillars can, for half damage.
- Combat is automatic once units are told to attack, attack-move, or (for fighters) left idle near an enemy. A finished Pillar shoots the closest enemy unit or building inside its own sight, the same radius as a Hover, and keeps that target until it leaves sight or dies. The shot deals 8/3 damage at a Flasher's rate. Hovers take half of that. It does not shoot rocks or trees, it does not fire through them, and it ignores ground it cannot currently see. A shot that would cross gray rock or a tree does not fire. Stalkers shoot back at point-blank range but keep hauling unless they were idle. Ground units steer around other ground units, and hovers steer around other hovers. A stalker who is still boxed in after 4 seconds is sent to the next revealed dumps patch or unfinished site.
- Placeholder shapes stand in for sprites and audio is a few synthesized tones.
