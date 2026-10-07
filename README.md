# Ridgekeep

A single-player real-time strategy skirmish in the browser. Northmark and Dunmarch each hold a Keep on a ridge of ore and rock. Gather ore, raise a Yard and Silos, train porters, pikes, and howlers, and destroy the enemy Keep.

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

You start with a Keep, four porters, and a little ore — not enough for a Yard. The red Dunmarch base is across the ridge and will mine, build, and march on you.

1. Select the porters (click or drag a box) and right-click a gold ore patch.
2. They mine, walk the ore back to your Keep, and repeat. The count is in the top bar.
3. Select a porter (or the Keep) and place a **Yard**. A porter walks over and builds it.
4. Place a **Silo** when the population bar is full. Each Silo adds room for 8 more.
5. Select the Yard and train **pikes** (short spears) and **howlers** (long reach).
6. Right-click enemies to attack, or press **Q** and left-click for attack-move. Right-click gray rock to break it — howlers do this best — and the stone stops blocking once it shatters.
7. Destroy the Dunmarch Keep to win. If your Keep falls, the skirmish is lost.

## Controls

| Action | Input |
| --- | --- |
| Select | Left-click. Drag a box for several units. Shift adds. |
| Select all of one type on screen | Double-click a unit |
| Move | Right-click ground, or the Move button then left-click |
| Attack | Right-click an enemy or gray rock |
| Attack-move | `Q`, then left-click |
| Gather | Right-click ore with porters selected |
| Stop | `X` |
| Yard / Silo | `Y` / `L`, then left-click the map |
| Train porter | Select the Keep, `P` |
| Train pike / howler | Select the Yard, `K` / `J` |
| Rally point | Select a building, right-click the ground |
| Cancel placement or clear selection | `Esc` or right-click |
| Pan | `WASD` or arrow keys, or move the pointer to the screen edge |
| Pan (drag) | Middle mouse. On a touch screen, drag the map |
| Zoom | Mouse wheel |
| Jump camera | Click the minimap |
| Center camera | `Space` (selection, or your Keep) |
| Idle porters | `F` or the Idle button |
| Control groups | `Ctrl+1`–`9` to save, `1`–`9` to recall. Tap the number again to center. |
| Mute | `M` |
| Controls overlay | `?` or `F1` |

Touch: drag pans the map, a tap selects, a tap on open ground moves the selection, and a tap on an enemy attacks.

## Known limitations

- No fog of war, save games, or multiplayer.
- One map, one ore type, and one enemy script. Dunmarch mines, builds a Yard and Silos, trains fighters, and attack-moves once it has a small force or once you show up at its Keep. If gray rock seals that march, or forces a detour of about a dozen tiles, Dunmarch sends howlers (pikes, when it has no howlers) to break the stone, then resumes the attack. The same rule opens ore: a sealed haul is always cleared by porters, and a long detour is cleared only when the ore bank or the ore they can already reach is under 80. Your own porters break rock only when you right-click it.
- Units slide around each other instead of hard-blocking. Buildings, rock, and ore block movement until a rock is destroyed. Pathing is grid A*. Ordered attacks hit gray rock; idle units and attack-move do not seek stones out.
- Combat is automatic once units are told to attack, attack-move, or (for fighters) left idle near an enemy. Porters shoot back at point-blank range but keep hauling unless they were idle.
- Placeholder shapes stand in for sprites and audio is a few synthesized tones.
