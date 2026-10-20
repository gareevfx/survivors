# Survivors

A browser RTS. Run with `npm install` then `npm run dev`. 
Ready-to-play online version of the game [Play Survivors](https://gareevfx.com/project-survivors/index.html)

## About the game

The world has run out of fresh resources, and what's left is the wreckage. Piles of technical debris, called Dumps, lie scattered across the map. Each player starts with a single Silo, the command center that trains Stalkers. These hardy scavengers can't be destroyed. They haul Dumps back to the Silo or to Storages that hold your Cells, and they clear rocks and trees from their path as they go.

Stalkers aren't safe from everyone. Anyone can capture one that wanders outside the watchful range of a Silo, Flasher, Gorilla or Storage. Pillars, the windmills with battle towers, can also capture them. So you expand carefully. Factories turn out Flashers, which are lightning-fast raiders. They also build Gorillas, the heavy tanks that smash buildings, and Fly scouts that map the unknown, because nobody can build in uncharted land.

## Game rules

**Goal**
- Destroy an enemy Silo, which leaves a ruin, and then hold it with Flashers or Gorillas for 60 seconds to capture it.
- The capture pauses while the owner's combat units are in range, drains if your units leave, and resets if the owner's Stalker repairs the ruin.
- Capturing a Silo gives you only the Dumps stored in it. The loser keeps their other buildings and units and gets the alert "Your Silo was captured - retake it", so Silos can change hands back and forth.
- A player is out once they have no Silo or ruin, no Factory and no combat units. In 1v1 that ends the match, and in free-for-all the rest play on.

**Economy**
- Stalkers haul Dumps to the Silo, which holds 3000, or to Storages, which hold 750 each.
- You can only build on explored ground.
- Demolishing your own Factory, Storage or Pillar returns 25% of its cost.

**Stalkers**
- They can't be destroyed, but enemies can capture them outside the cover of a Silo, Storage, Flasher or Gorilla. Pillars can capture them too.
- A captured Stalker turns grey for 20 seconds with a countdown and then joins the captor.
- They clear rocks and trees from their path.

**Buildings and units**
- Silo: the command center and the only place that trains Stalkers. It has 3 times its old health.
- Storage, Factory, Pillar: enemies can only destroy these, never capture them.
- Pillar: refills Power and revives units. Combat units with 0 Power shut down and can be refilled from a battery.
- Factory: builds Flashers (fast), Gorillas (tanks that smash buildings), Fly (scouts, with Scanner and Guard) and the Frog, whose Freeze is on R and lasts 20 seconds but doesn't work inside a Silo's sight.

**SiloAI**
- It plays by the same rules, as an opponent or as an autoplayer for your side.

## Donat

If you are interested in the game and would like to help expand its universe (or perhaps even support the development of a 3D version), please consider making a contribution by transferring funds:

- Crypto (ETH) 0x8853fae653B3b0600377928a1D528ABF43c9fe7F
