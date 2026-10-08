# Alternativen

A single-player real-time strategy skirmish in the browser. Northmark and Dunmarch each hold a Castle on a ridge of minerals, rock, and trees. Gather the minerals beside your Castle, raise a Factory, Silos, and Towers, train workers, bikes, tanks, and drones, and destroy the enemy Castle. If your own Castle falls, the field is lost.

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

You start with a Castle, four workers, and a small store of minerals — not enough for a Factory. Each match places the two Castles in opposite corners, as far apart as that map allows. The nearest minerals sit on the edge of each Castle's sight: inside the starting view, not beside the walls. The red Dunmarch base will gather, build, and march on you.

1. Select the workers (click or drag a box) and right-click a gold minerals patch. Up to three workers work that patch. They mine the Castle-area minerals first, from a neighboring tile. After those run out, extras walk to the nearest revealed patch by path length. They do not set out for minerals still under the fog. If gray rock or a tree seals a patch, those workers break it, then haul. Rocks, trees, and mineral patches block workers, bikes, and tanks until the rock or tree is destroyed or the patch is mined out.
2. They gather, walk the minerals back to your Castle, and repeat. The count is in the top bar.
3. Select a worker (or the Castle) and place a **Factory**. Ordering it from the Castle sends the nearest idle Worker, or the nearest miner if every Worker is already hauling. The site rises only while a worker stands on it. If that worker dies or is sent away, the next free Worker takes over. With nobody left to send, the label switches to **Paused** and the minerals stay spent until you cancel. A second worker on the site speeds the work.
4. Place a **Silo** when the population bar is full. Each Silo adds room for 8 more.
5. Select the Factory and train **bikes** (short reach, 50 minerals), **tanks** (long reach, 100 minerals), and **drones** (75 minerals, 11 seconds). A Drone flies over rock, trees, and minerals, carries no weapon, and sees as far as a Castle. Tanks cannot attack it. Bikes and Towers can, and deal half their usual damage.
6. Place a **Tower** (`T`, 100 minerals) inside the Castle's sight. It occupies one cell, sees as far as a Drone, and shoots with a Bike's damage, range, and rate. The blue ring while placing it is that sight: green cells are legal, red cells are not.
7. Right-click enemies to attack, or press **Q** and left-click for attack-move. Shots stop at gray rock and trees. Right-click gray rock or a tree with workers to break it — bikes and tanks cannot — and the tile stops blocking once it shatters. Left-click a minerals patch to see how much is left. Workers sent to a sealed patch break the rocks in the way, then haul. A worker who cannot move for about 4 seconds leaves that job for the next minerals patch or unfinished building.
8. Destroy the Dunmarch Castle to win. If your Castle falls, the skirmish is lost. Dunmarch and AI Control keep fighters and Towers at the Castle, and pull the army home when that Castle or a nearby building is under attack.

## Controls

| Action | Input |
| --- | --- |
| Select | Left-click. Drag a box for several units. Shift adds. |
| Select all of one type on screen | Double-click a unit |
| Move | Right-click ground, or the Move button then left-click |
| Attack | Right-click an enemy. Right-click gray rock or a tree with workers to break it. Bikes and tanks cannot. |
| Attack-move | `Q`, then left-click |
| Gather | Right-click minerals with workers selected. Workers take Castle-area minerals first. At most 3 workers per patch. After the base runs out, extras take the nearest revealed patch by path length. They break gray rock or trees that seal their patch, and they mine from a neighboring tile. |
| Minerals amount | Left-click a minerals patch |
| Stop | `X` |
| Factory / Silo / Tower | `Y` / `L` / `T`, then left-click the map. A Tower must sit inside Castle sight |
| Train worker | Select the Castle, `P` |
| Train bike / tank / drone | Select the Factory, `K` / `J` / `H` |
| Rally point | Select a building, right-click the ground |
| Cancel placement or clear selection | `Esc` or right-click |
| Pan | `WASD` or arrow keys, or move the pointer to the screen edge |
| Pan (drag) | Middle mouse. On a touch screen, drag the map |
| Zoom | Mouse wheel |
| Jump camera | Click the minimap |
| Center camera | `Space` (selection, or your Castle) |
| Idle workers | `F` or the Idle button |
| Control groups | `Ctrl+1`–`9` to save, `1`–`9` to recall. Tap the number again to center. |
| Command line | `Enter`. The box says “write here”. `Off FOW` reveals the map, and `FOW` hides it again except what you can see. `God Mode` makes your units and buildings invulnerable, and `Off God Mode` turns that off. `Show Enemy Cam` draws only what Dunmarch can see, and `Off Enemy Cam` returns to your own sight. `Both Cam` draws whatever either side can see, and `Off Both Cam` returns to your own sight. `AI Control` plays Northmark with that same sight, and `Off AI Control` returns the orders. Escape cancels. |
| Pause | Pause button (beside Controls), or the Pause key. The match clock stops. Resume continues from that moment. |
| Mute | `M` |
| Controls overlay | `?` or `F1` |

Touch: drag pans the map, a tap selects, a tap on open ground moves the selection, and a tap on an enemy attacks.

## Known limitations

- Save games and multiplayer are not included. Both sides have fog of war: black for unexplored ground, and a dark shroud for ground that has been seen but is not being watched. The black hides everything. Rocks and minerals stay visible in the gray shroud. Enemy units and buildings stay hidden until they are in sight. Sight comes from workers, bikes, tanks, drones, and buildings. Press Enter and run Off FOW to reveal the whole map for Northmark. FOW turns that off and hides everything outside current sight. Show Enemy Cam draws the map with Dunmarch's sight instead, and Off Enemy Cam returns to Northmark's sight. Both Cam lights any ground either side can see and grays ground either side has explored, and Off Both Cam returns to Northmark's sight. These views replace one another and do not change what either side knows. God Mode keeps Northmark units and buildings from taking damage, and Off God Mode lets them take damage again. Dunmarch keeps its own fog and has to scout.
- One wide 16:9 map, one minerals type, and one enemy script. Mineral patches are spread across the field. Dunmarch gathers only patches it has seen. It uses the same roster as Northmark: workers, bikes, tanks, drones, Silos, Towers, a Factory, and a Castle, under the same fog and rock rules. Dunmarch trains up to two Drones, and AI Control does the same for Northmark. A Drone keeps flying: nearby black fog first, then the far map for the enemy Castle, then gray ground, including after the whole map has been visited. It stays clear of a Bike it can see. Before a Drone exists, a Bike scouts, or one spare Worker. Finds are mined only after they are revealed, and the army attacks the Castle once a scout has seen it. An AI Factory, Silo, or Tower keeps one empty tile on every side, stays three tiles from every mineral patch, and does not sit on the straight haul from its Castle to a patch within twelve tiles. Towers are placed only inside Castle sight, up to three, after two Factories. Dunmarch builds Factories and Silos with no count limit and trains fighters alongside those Drones. Its army’s objective is to destroy your Castle and to keep its own. It leaves a couple of fighters at home, marches on your Castle once a unit has seen it, and pulls the army back when its Castle or a nearby building is under attack. It will not settle for sieging another building instead. If it has not seen the Castle, it still defends its own when your fighters are in sight, or marches on another building it has spotted. If gray rock seals that march, or forces a detour of about a dozen tiles, Dunmarch sends workers to break the stone, then resumes the attack. Bikes and tanks never damage rock. Dunmarch hauls along the shortest open path. When a patch is sealed, its workers break the blocking rocks closest to that patch, then walk the opened ground. Each deposit takes at most 3 workers from one side. Workers mine Castle-area minerals first. Once those are gone, a revealed patch is taken by path length, even if rocks must be broken on the way. When every revealed patch is empty, both sides break rocks toward the minerals that take the least travel and chipping time. An unfinished building gains progress only while a worker is constructing on that site.
- Units steer around friendly and enemy units instead of hard-blocking. Buildings, rock, trees, and minerals block the body of every ground unit. A tile opens when its rock or tree is destroyed, or when its mineral patch is mined out. Pathing is grid A* and will not cut between two blocked tiles. If a ground unit is ever inside a blocked tile, it is moved to the nearest free cell. Drones fly in a straight line and ignore those blockers. Workers ordered onto gray rock or a tree break it, including obstacles that seal a minerals patch, and they do not step onto that tile until it is gone. Bikes, tanks, drones, idle units, and attack-move do not seek stones out. Drones deal no damage. Tanks cannot attack a Drone. Bikes and Towers can, for half damage.
- Combat is automatic once units are told to attack, attack-move, or (for fighters) left idle near an enemy. A finished Tower shoots the nearest enemy in Bike range on its own, and it does not shoot rocks or trees. A shot that would cross gray rock or a tree does not fire. Workers shoot back at point-blank range but keep hauling unless they were idle. Ground units steer around other ground units, and drones steer around other drones. A worker who is still boxed in after 4 seconds is sent to the next revealed minerals patch or unfinished site.
- Placeholder shapes stand in for sprites and audio is a few synthesized tones.
