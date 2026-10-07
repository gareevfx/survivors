# Alternativen

A single-player real-time strategy skirmish in the browser. Northmark and Dunmarch each hold a Castle on a ridge of minerals and rock. Gather minerals, raise a Factory and Silos, train workers, bikes, and tanks, and destroy the enemy Castle.

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

You start with a Castle, four workers, and a small store of minerals — not enough for a Factory. The red Dunmarch base is across the ridge and will gather, build, and march on you.

1. Select the workers (click or drag a box) and right-click a gold minerals patch. Up to three workers work that patch. Any extras walk to the nearest revealed patch that still has room. They do not set out for minerals still under the fog. If gray rock seals a patch, those workers break it, then haul.
2. They gather, walk the minerals back to your Castle, and repeat. The count is in the top bar.
3. Select a worker (or the Castle) and place a **Factory**. The site rises only while a worker stands on it. Order that worker away and the label switches to **Paused** with no further progress. The work already done is kept. Select the worker and right-click the site to resume. A second worker on the site speeds the work.
4. Place a **Silo** when the population bar is full. Each Silo adds room for 8 more.
5. Select the Factory and train **bikes** (short reach, 50 minerals), **tanks** (long reach, 100 minerals), and **drones** (75 minerals, 11 seconds). A Drone flies over rock and buildings, carries no weapon, and sees as far as a Castle. Tanks cannot attack it. Bikes can, and deal half their usual damage.
6. Right-click enemies to attack, or press **Q** and left-click for attack-move. Shots stop at gray rock. Right-click gray rock with workers to break it — bikes and tanks cannot — and the stone stops blocking once it shatters. Left-click a minerals patch to see how much is left. Workers sent to a sealed patch break the rocks in the way, then haul. A worker who cannot move for about 4 seconds leaves that job for the next minerals patch or unfinished building.
7. Destroy the Dunmarch Castle to win. If your Castle falls, the skirmish is lost.

## Controls

| Action | Input |
| --- | --- |
| Select | Left-click. Drag a box for several units. Shift adds. |
| Select all of one type on screen | Double-click a unit |
| Move | Right-click ground, or the Move button then left-click |
| Attack | Right-click an enemy. Right-click gray rock with workers to break it. Bikes and tanks cannot. |
| Attack-move | `Q`, then left-click |
| Gather | Right-click minerals with workers selected. At most 3 workers per patch; extras take the nearest revealed patch. They break gray rock that seals their patch. |
| Minerals amount | Left-click a minerals patch |
| Stop | `X` |
| Factory / Silo | `Y` / `L`, then left-click the map |
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
| Command line | `Enter`. The box says “write here”. `Clear Fog of War` reveals the map, and `Fog of War` hides it again except what you can see. `God Mode` makes your units and buildings invulnerable, and `Off God Mode` turns that off. Escape cancels. |
| Mute | `M` |
| Controls overlay | `?` or `F1` |

Touch: drag pans the map, a tap selects, a tap on open ground moves the selection, and a tap on an enemy attacks.

## Known limitations

- Save games and multiplayer are not included. Both sides have fog of war: black for unexplored ground, and a dark shroud for ground that has been seen but is not being watched. The black hides everything. Rocks and minerals stay visible in the gray shroud. Enemy units and buildings stay hidden until they are in sight. Sight comes from workers, bikes, tanks, drones, and buildings. Press Enter and run Clear Fog of War to reveal the whole map for Northmark. Fog of War turns that off and hides everything outside current sight. God Mode keeps Northmark units and buildings from taking damage, and Off God Mode lets them take damage again. Dunmarch keeps its own fog and has to scout.
- One wide 16:9 map, one minerals type, and one enemy script. Mineral patches are spread across the field. Dunmarch gathers only patches it has seen, sends a scout into unknown ground, builds Factories and Silos with no count limit, and trains fighters. Its army’s objective is to destroy your Castle. It marches on that Castle once a unit has seen it, and it will not settle for sieging another building instead. If it has not seen the Castle, it still defends its own when your fighters are in sight, or marches on another building it has spotted. If gray rock seals that march, or forces a detour of about a dozen tiles, Dunmarch sends workers to break the stone, then resumes the attack. Bikes and tanks never damage rock. Dunmarch hauls along the shortest open path. When a patch is sealed, its workers break the blocking rocks closest to that patch, then walk the opened ground. Each deposit takes at most 3 workers from one side; the rest spread to the nearest revealed deposit with room. An unfinished building gains progress only while a worker is constructing on that site.
- Units slide around each other instead of hard-blocking. Buildings, rock, and minerals block movement until a rock is destroyed. Pathing is grid A*. Drones fly in a straight line and ignore those blockers. Workers ordered onto gray rock break it, including rocks that seal a minerals patch. Bikes, tanks, drones, idle units, and attack-move do not seek stones out. Drones deal no damage. Tanks cannot attack a Drone. Bikes can, for half damage.
- Combat is automatic once units are told to attack, attack-move, or (for fighters) left idle near an enemy. A shot that would cross gray rock does not fire. Workers shoot back at point-blank range but keep hauling unless they were idle. Any unit that cannot move for 4 seconds is shifted onto an adjacent empty tile. A drone uses an open neighboring cell; ground units need walkable ground with nobody standing on it. A worker who is still boxed in after that is sent to the next revealed minerals patch or unfinished site.
- Placeholder shapes stand in for sprites and audio is a few synthesized tones.
