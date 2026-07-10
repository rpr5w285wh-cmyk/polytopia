// Heuristic AI: research, grow cities, train units, fight and expand.
import { UNITS, TECHS } from './constants.js';
import { previewAttack } from './combat.js';

const TECH_PRIORITY = [
  'organization', 'hunting', 'climbing', 'riding', 'farming', 'forestry',
  'mining', 'archery', 'shields', 'fishing', 'smithery', 'freespirit',
  'mathematics', 'chivalry',
];

const TRAIN_PRIORITY = ['knight', 'swordsman', 'catapult', 'rider', 'archer', 'defender', 'warrior'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function playAITurn(game, opts = {}) {
  const delay = opts.delay ?? 0;
  const p = game.player();
  const pause = async () => { if (delay) await sleep(delay); };

  // --- 1. research: one tech per turn when comfortably affordable ---
  for (const techId of TECH_PRIORITY) {
    if (game.over) return;
    if (!p.techs.has(techId) && game.canResearch(p, techId)
        && p.stars >= game.techCostFor(p, techId) + 2) {
      game.research(techId);
      await pause();
      break;
    }
  }

  // --- 2. economy: buy the best pop-per-star actions, keep a small reserve ---
  const reserve = 2;
  for (let guard = 0; guard < 20; guard++) {
    if (game.over) return;
    let best = null;
    for (const city of game.citiesOf(p.id)) {
      for (const t of game.tiles) {
        if (t.territoryOf !== city.id) continue;
        for (const a of game.tileActions(t.x, t.y)) {
          if (!a.enabled || p.stars - a.cost < reserve) continue;
          const value = (parseFloat(a.label.match(/\+(\d+) pop/)?.[1] ?? 1)) / a.cost;
          if (!best || value > best.value) best = { x: t.x, y: t.y, id: a.id, value };
        }
      }
    }
    if (!best) break;
    game.doTileAction(best.x, best.y, best.id);
    await pause();
  }

  // --- 3. training ---
  const armyCap = game.citiesOf(p.id).length * 3 + 1;
  for (const city of game.citiesOf(p.id).sort((a, b) => b.isCapital - a.isCapital)) {
    if (game.over) return;
    if (game.unitsOf(p.id).length >= armyCap) break;
    if (game.tile(city.x, city.y).unitId !== -1) continue;
    for (const kind of TRAIN_PRIORITY) {
      const def = UNITS[kind];
      if (def.tech && !p.techs.has(def.tech)) continue;
      if (p.stars < def.cost) continue;
      game.trainUnit(city.id, kind);
      await pause();
      break;
    }
  }

  // --- 4. units ---
  for (const unit of game.unitsOf(p.id)) {
    if (game.over) return;
    if (!game.units.has(unit.id)) continue; // died to retaliation earlier this turn
    await playUnit(game, p, unit, pause);
  }
}

async function playUnit(game, p, unit, pause) {
  // capture the city we're standing on
  const cityHere = game.cityAt(unit.x, unit.y);
  if (cityHere && cityHere.ownerId !== p.id && !unit.moved && !unit.attacked) {
    game.captureCity(unit.id);
    await pause();
    return;
  }

  // attack if a good trade is available before moving
  if (tryAttack(game, unit)) { await pause(); return; }

  // move toward the best goal
  if (!unit.moved && !unit.attacked) {
    const goal = pickGoal(game, p, unit);
    if (goal) {
      const reach = game.reachableTiles(unit);
      let best = null;
      for (const i of reach.keys()) {
        const x = i % game.size, y = Math.floor(i / game.size);
        const d = game.dist(x, y, goal.x, goal.y);
        if (!best || d < best.d) best = { x, y, d };
      }
      if (best && best.d < game.dist(unit.x, unit.y, goal.x, goal.y)) {
        game.moveUnit(unit.id, best.x, best.y);
        await pause();
      }
    }
  }

  // dash attack after moving
  if (tryAttack(game, unit)) await pause();
}

function tryAttack(game, unit) {
  const targets = game.attackTargets(unit);
  let best = null;
  for (const t of targets) {
    const { damage, retaliation } = previewAttack(game, unit, t);
    const kills = damage >= t.hp;
    // favorable trade: a kill, damage beating retaliation, or we're low-risk
    if (!kills && damage < retaliation && unit.hp - retaliation <= 0) continue;
    if (!kills && damage + 1 < retaliation) continue;
    const score = (kills ? 100 : 0) + damage - retaliation;
    if (!best || score > best.score) best = { target: t, score };
  }
  if (best) return game.attack(unit.id, best.target.id);
  return false;
}

function pickGoal(game, p, unit) {
  let best = null;
  const consider = (x, y, weight) => {
    const d = game.dist(unit.x, unit.y, x, y);
    const score = weight - d;
    if (!best || score > best.score) best = { x, y, score };
  };

  for (const city of game.cities) {
    if (city.ownerId === p.id) continue;
    if (!p.explored.has(game.idx(city.x, city.y))) continue;
    // neutral villages are easy expansion; enemy capitals win games
    consider(city.x, city.y, city.ownerId === -1 ? 12 : (city.isCapital ? 14 : 10));
  }

  // wounded visible enemies nearby
  for (const other of game.units.values()) {
    if (other.ownerId === p.id) continue;
    if (!p.explored.has(game.idx(other.x, other.y))) continue;
    if (game.dist(unit.x, unit.y, other.x, other.y) <= 4) consider(other.x, other.y, 8);
  }

  if (best) return best;

  // otherwise explore: head to the nearest explored tile that borders fog
  let frontier = null;
  for (const i of p.explored) {
    const x = i % game.size, y = Math.floor(i / game.size);
    let edge = false;
    for (let dy = -1; dy <= 1 && !edge; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (game.inBounds(nx, ny) && !p.explored.has(game.idx(nx, ny))) { edge = true; break; }
      }
    }
    if (!edge) continue;
    const d = game.dist(unit.x, unit.y, x, y);
    if (!frontier || d < frontier.d) frontier = { x, y, d };
  }
  return frontier;
}
