# Tiny Tribes

A turn-based 4X strategy game inspired by *The Battle of Polytopia*, written in
vanilla JavaScript + HTML5 Canvas. No dependencies, no build step.

## Run it

Open `index.html` in a browser, or serve the folder (ES modules need http on some browsers):

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## How to play

You lead a tribe on a procedurally generated island. Each turn you earn **stars**
from your cities and spend them on harvesting resources, researching technology,
and training units. Win by **domination** (capture every rival's cities) or by
having the highest **score** when turn 30 ends.

- **Move / attack** — click a unit, then click a highlighted tile (white = move,
  red ring = attack). Most units can move *and* attack; slow ones can do only one.
- **Capture** — move onto a village or enemy city, then press *Capture* on your
  next turn with that unit.
- **Grow cities** — click resource tiles inside your borders to harvest fruit,
  hunt animals, build farms/mines/lumber huts. Population levels your city up,
  raising star income and granting rewards (workshop, border growth, a Giant…).
- **Research** — the Tech button opens a 3-tier tree that unlocks resources,
  terrain (Climbing lets you cross mountains) and stronger units.
- **Fog of war** — scouts reveal the map; mountains grant a wider view.
- **Camera** — drag to pan, scroll/pinch to zoom, `Enter` ends the turn.

### Units

| Unit | Cost | HP | Atk | Def | Move | Range | Notes |
|-----------|-----:|---:|----:|----:|-----:|------:|-------|
| Warrior | 2★ | 10 | 2 | 2 | 1 | 1 | starting unit |
| Rider | 3★ | 10 | 2 | 1 | 2 | 1 | fast |
| Archer | 3★ | 10 | 2 | 1 | 1 | 2 | ranged |
| Defender | 3★ | 15 | 1 | 3 | 1 | 1 | move *or* attack |
| Swordsman | 5★ | 15 | 3 | 3 | 1 | 1 | |
| Catapult | 8★ | 10 | 4 | 0 | 1 | 3 | move *or* attack |
| Knight | 8★ | 10 | 3.5 | 1 | 3 | 1 | |
| Giant | — | 40 | 5 | 4 | 1 | 1 | city level-5 reward |

Units that kill 3 enemies become **veterans** (+5 max HP). Idle units heal each
turn. Defenders standing in cities, forests (with Archery) or mountains (with
Climbing) take less damage.

### Setup options

2–4 players, each slot Human or AI — single-player, hotseat multiplayer, or an
all-AI spectator match. Maps are seeded: enter the same seed to replay the same
island.

## Code layout

```
index.html      page shell + HUD containers
css/style.css   menus, panels, modals
js/constants.js data tables (terrain, units, techs, tribes)
js/rng.js       seeded PRNG (mulberry32)
js/mapgen.js    procedural island generation
js/game.js      game state + all rule-checked actions
js/combat.js    Polytopia-style damage formulas
js/ai.js        heuristic AI opponents
js/renderer.js  isometric canvas renderer
js/input.js     pointer/keyboard: pan, zoom, tile picking
js/ui.js        DOM overlay: panels, tech tree, toasts
js/main.js      menu, game loop, AI scheduling
```
