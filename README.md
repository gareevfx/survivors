# Survivors

A browser RTS. Run with `npm install` then `npm run dev`. Serves on http://127.0.0.1:4317/.

Computer sides in 1 vs 1 and free-for-all, and the `ai control` command, all use SiloAI. It gathers Dumps, raises Storage, a Factory, and Pillars, keeps Hovers scouting, and attacks the enemy Silo. When the Dumps beside its Silo run out, or a Hover (or any sight) finds a heap far from its Silos and Storages, it builds a Storage there and hauls to it. Stalkers widen a passage that pinches below two cells. Gorillas are built for sieges and sent at buildings; Flashers take units. SiloAI leaves two open cells between its own buildings.
