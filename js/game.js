// Central game state and all rule-checked actions.
import {
  TERRAIN, RESOURCES, IMPROVEMENTS, UNITS, TECHS, techCost,
  TRIBES, CITY_REWARDS, RULES,
} from './constants.js';
import { generateMap, NEIGHBORS8 } from './mapgen.js';
import { previewAttack } from './combat.js';

let nextUnitId = 1;

export class Game {
  // config: { size, seed, players: [{ type: 'human'|'ai', tribeIndex }] }
  constructor(config) {
    this.size = config.size;
    this.seed = String(config.seed);
    this.listeners = [];
    this.over = false;
    this.winner = null;
    this.turn = 1;
    this.currentPlayer = 0;

    const map = generateMap(this.size, this.seed, config.players.length);
    this.tiles = map.tiles;

    this.players = config.players.map((p, i) => {
      const tribe = TRIBES[p.tribeIndex];
      return {
        id: i,
        type: p.type,
        tribe,
        name: tribe.name,
        color: tribe.color,
        stars: RULES.startStars,
        techs: new Set([tribe.startTech]),
        explored: new Set(),
        alive: true,
        kills: 0,
        cityNameIdx: 1, // 0 is the capital
      };
    });

    this.units = new Map();
    this.cities = [];

    // Capitals
    map.capitals.forEach(([x, y], i) => {
      const p = this.players[i];
      const city = this.addCity(x, y, i, { isCapital: true, name: p.tribe.cityNames[0] });
      this.claimTerritory(city, 1);
      this.spawnUnit('warrior', i, x, y, { fresh: true });
      this.reveal(p, x, y, 2);
    });

    // Neutral villages
    for (const [x, y] of map.villages) {
      this.addCity(x, y, -1, { name: 'Village' });
    }

    // First player's turn begins
    this.beginTurn(this.players[0]);
  }

  // ---------- plumbing ----------
  onEvent(cb) { this.listeners.push(cb); }
  emit(ev) { for (const cb of this.listeners) cb(ev); }

  idx(x, y) { return y * this.size + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.size && y < this.size; }
  tile(x, y) { return this.tiles[this.idx(x, y)]; }
  unitAt(x, y) {
    const id = this.tile(x, y).unitId;
    return id === -1 ? null : this.units.get(id);
  }
  cityById(id) { return this.cities[id]; }
  cityAt(x, y) {
    const id = this.tile(x, y).cityId;
    return id === -1 ? null : this.cities[id];
  }
  dist(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }
  player() { return this.players[this.currentPlayer]; }
  citiesOf(playerId) { return this.cities.filter((c) => c.ownerId === playerId); }
  unitsOf(playerId) { return [...this.units.values()].filter((u) => u.ownerId === playerId); }

  // ---------- setup helpers ----------
  addCity(x, y, ownerId, opts = {}) {
    const city = {
      id: this.cities.length,
      x, y, ownerId,
      level: 1, pop: 0,
      isCapital: !!opts.isCapital,
      workshop: false,
      borderGrown: false,
      name: opts.name || 'City',
    };
    this.cities.push(city);
    const t = this.tile(x, y);
    t.cityId = city.id;
    t.terrain = TERRAIN.FIELD;
    t.resource = null;
    return city;
  }

  claimTerritory(city, radius) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = city.x + dx, y = city.y + dy;
        if (!this.inBounds(x, y)) continue;
        const t = this.tile(x, y);
        if (t.territoryOf === -1) t.territoryOf = city.id;
      }
    }
  }

  spawnUnit(kind, ownerId, x, y, opts = {}) {
    const def = UNITS[kind];
    const unit = {
      id: nextUnitId++,
      kind, ownerId, x, y,
      hp: def.hp, maxHp: def.hp,
      kills: 0, veteran: false,
      // freshly spawned units can't act until next turn, except initial warriors
      moved: !opts.fresh, attacked: !opts.fresh,
    };
    this.units.set(unit.id, unit);
    this.tile(x, y).unitId = unit.id;
    this.revealFor(unit);
    return unit;
  }

  removeUnit(unit) {
    this.units.delete(unit.id);
    const t = this.tile(unit.x, unit.y);
    if (t.unitId === unit.id) t.unitId = -1;
  }

  reveal(player, x, y, radius) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx, ny = y + dy;
        if (this.inBounds(nx, ny)) player.explored.add(this.idx(nx, ny));
      }
    }
  }

  revealFor(unit) {
    const player = this.players[unit.ownerId];
    const onMountain = this.tile(unit.x, unit.y).terrain === TERRAIN.MOUNTAIN;
    this.reveal(player, unit.x, unit.y, onMountain && player.techs.has('climbing') ? 2 : 1);
  }

  // ---------- economy ----------
  incomeOf(player) {
    let income = 0;
    for (const c of this.citiesOf(player.id)) {
      income += c.level + (c.isCapital ? 1 : 0) + (c.workshop ? 1 : 0);
    }
    return income;
  }

  techCostFor(player, techId) {
    return techCost(techId, this.citiesOf(player.id).length);
  }

  canResearch(player, techId) {
    const t = TECHS[techId];
    if (!t || player.techs.has(techId)) return false;
    if (t.req && !player.techs.has(t.req)) return false;
    return player.stars >= this.techCostFor(player, techId);
  }

  research(techId) {
    const p = this.player();
    if (!this.canResearch(p, techId)) return false;
    p.stars -= this.techCostFor(p, techId);
    p.techs.add(techId);
    this.emit({ type: 'research', playerId: p.id, techId });
    return true;
  }

  // ---------- movement ----------
  // Tiles a unit may end its move on: Map<tileIdx, true>
  reachableTiles(unit) {
    const result = new Map();
    if (unit.moved || unit.attacked) return result;
    const def = UNITS[unit.kind];
    const player = this.players[unit.ownerId];
    const canClimb = player.techs.has('climbing');

    const startIdx = this.idx(unit.x, unit.y);
    const best = new Map([[startIdx, def.mov]]);
    const queue = [[unit.x, unit.y, def.mov]];

    while (queue.length) {
      const [x, y, mp] = queue.shift();
      if (mp <= 0) continue;
      for (const [dx, dy] of NEIGHBORS8) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const t = this.tile(nx, ny);
        if (t.terrain === TERRAIN.WATER) continue;
        if (t.terrain === TERRAIN.MOUNTAIN && !canClimb) continue;
        if (t.unitId !== -1) continue; // cannot enter or pass through occupied tiles

        // forest & mountain and enemy zone-of-control consume all remaining movement
        const stops = t.terrain === TERRAIN.FOREST || t.terrain === TERRAIN.MOUNTAIN
          || this.adjacentEnemy(nx, ny, unit.ownerId);
        const left = stops ? 0 : mp - 1;

        const i = this.idx(nx, ny);
        if ((best.get(i) ?? -1) >= left) continue;
        best.set(i, left);
        result.set(i, true);
        queue.push([nx, ny, left]);
      }
    }
    return result;
  }

  adjacentEnemy(x, y, playerId) {
    for (const [dx, dy] of NEIGHBORS8) {
      const nx = x + dx, ny = y + dy;
      if (!this.inBounds(nx, ny)) continue;
      const u = this.unitAt(nx, ny);
      if (u && u.ownerId !== playerId) return true;
    }
    return false;
  }

  moveUnit(unitId, x, y) {
    const unit = this.units.get(unitId);
    if (!unit || unit.ownerId !== this.currentPlayer || this.over) return false;
    const reach = this.reachableTiles(unit);
    if (!reach.has(this.idx(x, y))) return false;
    const from = { x: unit.x, y: unit.y };
    this.tile(unit.x, unit.y).unitId = -1;
    unit.x = x; unit.y = y;
    this.tile(x, y).unitId = unit.id;
    unit.moved = true;
    this.revealFor(unit);
    this.emit({ type: 'move', unitId: unit.id, from, to: { x, y } });
    return true;
  }

  // ---------- combat ----------
  canAttack(unit) {
    if (unit.attacked) return false;
    if (unit.moved && !UNITS[unit.kind].dash) return false;
    return true;
  }

  attackTargets(unit) {
    if (!this.canAttack(unit) || unit.ownerId !== this.currentPlayer) return [];
    const def = UNITS[unit.kind];
    const player = this.players[unit.ownerId];
    const targets = [];
    for (const other of this.units.values()) {
      if (other.ownerId === unit.ownerId) continue;
      if (this.dist(unit.x, unit.y, other.x, other.y) > def.range) continue;
      if (!player.explored.has(this.idx(other.x, other.y))) continue;
      targets.push(other);
    }
    return targets;
  }

  attack(unitId, targetId) {
    const unit = this.units.get(unitId);
    const target = this.units.get(targetId);
    if (!unit || !target || this.over) return false;
    if (unit.ownerId !== this.currentPlayer) return false;
    if (!this.attackTargets(unit).some((t) => t.id === targetId)) return false;

    const { damage, retaliation } = previewAttack(this, unit, target);
    target.hp -= damage;
    const killed = target.hp <= 0;
    this.emit({
      type: 'attack', attackerId: unit.id, defenderId: target.id,
      damage, retaliation, killed,
      at: { x: target.x, y: target.y },
    });

    if (killed) {
      const spot = { x: target.x, y: target.y };
      this.removeUnit(target);
      this.recordKill(unit);
      // melee attackers step into the vacated tile
      const def = UNITS[unit.kind];
      const t = this.tile(spot.x, spot.y);
      const canClimb = this.players[unit.ownerId].techs.has('climbing');
      if (def.range === 1 && this.dist(unit.x, unit.y, spot.x, spot.y) === 1
          && t.terrain !== TERRAIN.WATER
          && (t.terrain !== TERRAIN.MOUNTAIN || canClimb)) {
        this.tile(unit.x, unit.y).unitId = -1;
        unit.x = spot.x; unit.y = spot.y;
        t.unitId = unit.id;
        this.revealFor(unit);
      }
    } else if (retaliation > 0) {
      unit.hp -= retaliation;
      if (unit.hp <= 0) {
        this.removeUnit(unit);
        this.recordKill(target);
      }
    }

    if (this.units.has(unitId)) unit.attacked = true;
    this.checkUnitElimination();
    return true;
  }

  recordKill(unit) {
    unit.kills++;
    this.players[unit.ownerId].kills++;
    if (!unit.veteran && unit.kills >= RULES.veteranKills) {
      unit.veteran = true;
      unit.maxHp += RULES.veteranBonusHp;
      unit.hp = unit.maxHp;
      this.emit({ type: 'veteran', unitId: unit.id });
    }
  }

  // ---------- cities ----------
  captureCity(unitId) {
    const unit = this.units.get(unitId);
    if (!unit || unit.ownerId !== this.currentPlayer || this.over) return false;
    if (unit.moved || unit.attacked) return false;
    const city = this.cityAt(unit.x, unit.y);
    if (!city || city.ownerId === unit.ownerId) return false;

    const prevOwner = city.ownerId;
    city.ownerId = unit.ownerId;
    city.name = city.name === 'Village'
      ? this.nextCityName(this.players[unit.ownerId])
      : city.name;
    this.claimTerritory(city, city.borderGrown ? 2 : 1);
    unit.moved = true;
    unit.attacked = true;
    this.reveal(this.players[unit.ownerId], city.x, city.y, 2);
    this.emit({ type: 'capture', cityId: city.id, playerId: unit.ownerId, prevOwner });

    if (prevOwner !== -1) this.checkCityElimination(prevOwner);
    this.checkVictory();
    return true;
  }

  nextCityName(player) {
    const names = player.tribe.cityNames;
    const name = names[player.cityNameIdx % names.length];
    player.cityNameIdx++;
    return name;
  }

  addPop(city, n) {
    city.pop += n;
    while (city.pop >= city.level + 1) {
      city.pop -= city.level + 1;
      city.level++;
      this.applyReward(city);
    }
  }

  applyReward(city) {
    const reward = CITY_REWARDS[Math.min(city.level, 5)];
    this.emit({ type: 'cityLevel', cityId: city.id, level: city.level, reward: reward?.label });
    if (!reward) return;
    switch (reward.id) {
      case 'workshop':
        city.workshop = true;
        break;
      case 'border':
        if (!city.borderGrown) {
          city.borderGrown = true;
          this.claimTerritory(city, 2);
        }
        break;
      case 'pop':
        city.pop += 3; // handled by caller's loop? no — safe: below threshold triggers next loop pass
        break;
      case 'giant': {
        const spot = this.freeSpotNear(city.x, city.y);
        if (spot) this.spawnUnit('giant', city.ownerId, spot.x, spot.y);
        break;
      }
    }
  }

  freeSpotNear(x, y) {
    if (this.tile(x, y).unitId === -1) return { x, y };
    for (const [dx, dy] of NEIGHBORS8) {
      const nx = x + dx, ny = y + dy;
      if (!this.inBounds(nx, ny)) continue;
      const t = this.tile(nx, ny);
      if (t.unitId === -1 && t.terrain !== TERRAIN.WATER && t.terrain !== TERRAIN.MOUNTAIN) {
        return { x: nx, y: ny };
      }
    }
    return null;
  }

  // Which economy actions are possible on a tile for the current player.
  tileActions(x, y) {
    const p = this.player();
    const t = this.tile(x, y);
    const actions = [];
    if (this.over || t.territoryOf === -1) return actions;
    const owningCity = this.cities[t.territoryOf];
    if (!owningCity || owningCity.ownerId !== p.id) return actions;

    if (t.resource) {
      const r = RESOURCES[t.resource];
      actions.push({
        id: 'harvest',
        label: `${r.improvement ? 'Build ' + IMPROVEMENTS[r.improvement].name : 'Harvest ' + r.name} (${r.cost}★, +${r.pop} pop)`,
        cost: r.cost,
        enabled: p.techs.has(r.tech) && p.stars >= r.cost,
        needTech: p.techs.has(r.tech) ? null : TECHS[r.tech].name,
      });
    }
    if (t.terrain === TERRAIN.FOREST && !t.improvement && !t.resource) {
      const h = IMPROVEMENTS.lumberhut;
      actions.push({
        id: 'lumberhut',
        label: `Build Lumber Hut (${h.cost}★, +${h.pop} pop)`,
        cost: h.cost,
        enabled: p.techs.has(h.tech) && p.stars >= h.cost,
        needTech: p.techs.has(h.tech) ? null : TECHS[h.tech].name,
      });
    }
    return actions;
  }

  doTileAction(x, y, actionId) {
    const p = this.player();
    const t = this.tile(x, y);
    const action = this.tileActions(x, y).find((a) => a.id === actionId);
    if (!action || !action.enabled) return false;
    const city = this.cities[t.territoryOf];
    p.stars -= action.cost;
    if (actionId === 'harvest') {
      const r = RESOURCES[t.resource];
      if (r.improvement) t.improvement = r.improvement;
      t.resource = null;
      this.addPop(city, r.pop);
    } else if (actionId === 'lumberhut') {
      t.improvement = 'lumberhut';
      this.addPop(city, IMPROVEMENTS.lumberhut.pop);
    }
    this.emit({ type: 'economy', x, y, cityId: city.id });
    return true;
  }

  trainableUnits(city) {
    const p = this.players[city.ownerId];
    return Object.entries(UNITS)
      .filter(([, def]) => !def.rewardOnly)
      .filter(([, def]) => !def.tech || p.techs.has(def.tech))
      .map(([kind, def]) => ({ kind, def }));
  }

  trainUnit(cityId, kind) {
    const p = this.player();
    const city = this.cities[cityId];
    const def = UNITS[kind];
    if (!city || city.ownerId !== p.id || this.over) return false;
    if (!def || def.rewardOnly) return false;
    if (def.tech && !p.techs.has(def.tech)) return false;
    if (p.stars < def.cost) return false;
    if (this.tile(city.x, city.y).unitId !== -1) return false;
    p.stars -= def.cost;
    const unit = this.spawnUnit(kind, p.id, city.x, city.y);
    this.emit({ type: 'train', unitId: unit.id, cityId });
    return true;
  }

  // ---------- turn flow ----------
  endTurn() {
    if (this.over) return;
    const p = this.player();
    // idle units recover
    for (const u of this.unitsOf(p.id)) {
      if (u.moved || u.attacked || u.hp >= u.maxHp) continue;
      const terr = this.tile(u.x, u.y).territoryOf;
      const ownTerritory = terr !== -1 && this.cities[terr].ownerId === p.id;
      u.hp = Math.min(u.maxHp, u.hp + (ownTerritory ? RULES.healOwnTerritory : RULES.healNeutral));
    }
    this.emit({ type: 'turnEnd', playerId: p.id });

    // advance to next living player
    let next = this.currentPlayer;
    for (let i = 0; i < this.players.length; i++) {
      next = (next + 1) % this.players.length;
      if (next === 0) {
        this.turn++;
        if (this.turn > RULES.turnLimit) { this.scoreVictory(); return; }
      }
      if (this.players[next].alive) break;
    }
    this.currentPlayer = next;
    this.beginTurn(this.players[next]);
  }

  beginTurn(player) {
    player.stars += this.incomeOf(player);
    for (const u of this.unitsOf(player.id)) {
      u.moved = false;
      u.attacked = false;
    }
    this.emit({ type: 'turnStart', playerId: player.id, turn: this.turn });
  }

  // ---------- elimination & victory ----------
  checkCityElimination(playerId) {
    const p = this.players[playerId];
    if (!p.alive) return;
    if (this.citiesOf(playerId).length === 0) {
      p.alive = false;
      for (const u of this.unitsOf(playerId)) this.removeUnit(u);
      this.emit({ type: 'eliminated', playerId });
    }
  }

  // a player with no cities AND no units is also out (edge case safety)
  checkUnitElimination() {
    for (const p of this.players) {
      if (p.alive && this.citiesOf(p.id).length === 0 && this.unitsOf(p.id).length === 0) {
        p.alive = false;
        this.emit({ type: 'eliminated', playerId: p.id });
      }
    }
    this.checkVictory();
  }

  checkVictory() {
    if (this.over) return;
    const alive = this.players.filter((p) => p.alive);
    if (alive.length === 1) {
      this.over = true;
      this.winner = alive[0];
      this.emit({ type: 'gameOver', winnerId: alive[0].id, reason: 'domination' });
    }
  }

  scoreVictory() {
    this.over = true;
    let best = null;
    for (const p of this.players) {
      if (p.alive && (!best || this.scoreOf(p) > this.scoreOf(best))) best = p;
    }
    this.winner = best;
    this.emit({ type: 'gameOver', winnerId: best?.id ?? -1, reason: 'score' });
  }

  scoreOf(player) {
    const cities = this.citiesOf(player.id);
    const pop = cities.reduce((s, c) => s + c.pop + c.level, 0);
    return cities.length * 100 + pop * 20 + player.techs.size * 50
      + player.kills * 10 + this.unitsOf(player.id).length * 5;
  }
}
