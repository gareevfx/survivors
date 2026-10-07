# Ridgekeep

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

1. Select the workers (click or drag a box) and right-click a gold minerals patch. Up to three workers work that patch. Any extras walk to the nearest patch that still has room. Gray rock does not stop them; they walk through it.
2. They gather, walk the minerals back to your Castle, and repeat. The count is in the top bar.
3. Select a worker (or the Castle) and place a **Factory**. The site rises only while a worker stands on it. Order that worker away and the label switches to **Paused** with no further progress. The work already done is kept. Select the worker and right-click the site to resume. A second worker on the site speeds the work.
4. Place a **Silo** when the population bar is full. Each Silo adds room for 8 more.
5. Select the Factory and train **bikes** (short reach) and **tanks** (long reach).
6. Right-click enemies to attack, or press **Q** and left-click for attack-move. Workers walk through gray rock to reach minerals. Right-click gray rock with workers to break it — bikes and tanks cannot — and the stone stops blocking bikes and tanks once it shatters. Left-click a minerals patch to see how much is left.
7. Destroy the Dunmarch Castle to win. If your Castle falls, the skirmish is lost.

## Controls

| Action | Input |
| --- | --- |
| Select | Left-click. Drag a box for several units. Shift adds. |
| Select all of one type on screen | Double-click a unit |
| Move | Right-click ground, or the Move button then left-click |
| Attack | Right-click an enemy. Right-click gray rock with workers to break it. Bikes and tanks cannot. |
| Attack-move | `Q`, then left-click |
| Gather | Right-click minerals with workers selected. At most 3 workers per patch; extras take the nearest open patch. Workers walk through gray rock on the way. |
| Minerals amount | Left-click a minerals patch |
| Stop | `X` |
| Factory / Silo | `Y` / `L`, then left-click the map |
| Train worker | Select the Castle, `P` |
| Train bike / tank | Select the Factory, `K` / `J` |
| Rally point | Select a building, right-click the ground |
| Cancel placement or clear selection | `Esc` or right-click |
| Pan | `WASD` or arrow keys, or move the pointer to the screen edge |
| Pan (drag) | Middle mouse. On a touch screen, drag the map |
| Zoom | Mouse wheel |
| Jump camera | Click the minimap |
| Center camera | `Space` (selection, or your Castle) |
| Idle workers | `F` or the Idle button |
| Control groups | `Ctrl+1`–`9` to save, `1`–`9` to recall. Tap the number again to center. |
| Mute | `M` |
| Controls overlay | `?` or `F1` |

Touch: drag pans the map, a tap selects, a tap on open ground moves the selection, and a tap on an enemy attacks.

## Known limitations

- No fog of war, save games, or multiplayer.
- One map, one minerals type, and one enemy script. Dunmarch gathers, builds Factories and Silos with no count limit, trains fighters, and attack-moves once it has a small force or once you show up at its Castle. If gray rock seals that march, or forces a detour of about a dozen tiles, Dunmarch sends workers to break the stone, then resumes the attack. Bikes and tanks never damage rock. Workers walk through rock to reach minerals, and they still break a rock when ordered to. Each deposit takes at most 3 workers from one side; the rest spread to the nearest deposit with room. An unfinished building gains progress only while a worker is constructing on that site.
- Units slide around each other instead of hard-blocking. Buildings and minerals block movement. Gray rock blocks bikes and tanks until a worker destroys it; workers walk through it. Pathing is grid A*. Only workers, when ordered, break gray rock. Idle units and attack-move do not seek stones out.
- Combat is automatic once units are told to attack, attack-move, or (for fighters) left idle near an enemy. Workers shoot back at point-blank range but keep hauling unless they were idle.
- Placeholder shapes stand in for sprites and audio is a few synthesized tones.
