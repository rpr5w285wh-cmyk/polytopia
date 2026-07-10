// DOM overlay: top bar, selection/action panel, tech modal, toasts, end screen.
import { UNITS, TECHS, RESOURCES, RULES } from './constants.js';
import { previewAttack } from './combat.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(game, renderer, hooks) {
    this.game = game;
    this.renderer = renderer;
    this.hooks = hooks; // { isHumanTurn(), onHumanEndTurn() }
    this.sel = null;    // {type:'unit', unitId} | {type:'tile', x, y}

    $('end-turn-btn').onclick = () => {
      if (this.hooks.isHumanTurn() && !game.over) this.hooks.onHumanEndTurn();
    };
    $('tech-btn').onclick = () => this.showTech();
    $('tech-close').onclick = () => $('tech-modal').classList.add('hidden');
    $('tech-modal').addEventListener('click', (e) => {
      if (e.target === $('tech-modal')) $('tech-modal').classList.add('hidden');
    });

    game.onEvent((ev) => this.handleEvent(ev));
    this.refresh();
  }

  // ---------- game events → visuals ----------
  handleEvent(ev) {
    const g = this.game;
    const r = this.renderer;
    switch (ev.type) {
      case 'attack': {
        r.addFloat(ev.at.x, ev.at.y, `-${ev.damage}`, '#ff6b6b');
        if (!ev.killed && ev.retaliation > 0) {
          const a = g.units.get(ev.attackerId);
          if (a) r.addFloat(a.x, a.y, `-${ev.retaliation}`, '#ffb84d');
        }
        break;
      }
      case 'veteran': {
        const u = g.units.get(ev.unitId);
        if (u) r.addFloat(u.x, u.y, 'Veteran!', '#ffd76a');
        break;
      }
      case 'capture': {
        const city = g.cities[ev.cityId];
        const p = g.players[ev.playerId];
        this.toast(ev.prevOwner === -1
          ? `${p.name} founded ${city.name}`
          : `${p.name} captured ${city.name}!`);
        break;
      }
      case 'cityLevel': {
        const city = g.cities[ev.cityId];
        if (this.isViewer(city.ownerId)) {
          this.toast(`${city.name} grew to level ${ev.level}${ev.reward ? ' — ' + ev.reward : ''}`);
        }
        break;
      }
      case 'research': {
        if (this.isViewer(ev.playerId)) this.toast(`Researched ${TECHS[ev.techId].name}`);
        break;
      }
      case 'eliminated':
        this.toast(`The ${g.players[ev.playerId].name} tribe has fallen!`);
        break;
      case 'gameOver':
        this.clearSelection();
        setTimeout(() => this.showEndScreen(ev), 600);
        break;
    }
    this.refresh();
  }

  isViewer(playerId) {
    return playerId >= 0 && this.game.players[playerId]?.type === 'human';
  }

  // ---------- selection ----------
  handleTileClick(x, y) {
    const g = this.game;
    if (g.over) return;
    if (!this.hooks.isHumanTurn()) return;
    if (!this.renderer.isExplored(x, y)) { this.clearSelection(); return; }

    // acting on a highlighted tile with a selected unit
    if (this.sel?.type === 'unit') {
      const unit = g.units.get(this.sel.unitId);
      const hl = this.renderer.highlights.get(g.idx(x, y));
      if (unit && hl === 'move') {
        g.moveUnit(unit.id, x, y);
        this.selectUnit(unit.id); // keep selected for dash attacks
        return;
      }
      if (unit && hl === 'attack') {
        const target = g.unitAt(x, y);
        if (target) g.attack(unit.id, target.id);
        if (g.units.has(unit.id)) this.selectUnit(unit.id);
        else this.clearSelection();
        return;
      }
    }

    const unitHere = g.unitAt(x, y);
    if (unitHere && unitHere.ownerId === g.currentPlayer) {
      this.selectUnit(unitHere.id);
      return;
    }
    this.selectTile(x, y);
  }

  selectUnit(unitId) {
    const g = this.game;
    const unit = g.units.get(unitId);
    if (!unit) { this.clearSelection(); return; }
    this.sel = { type: 'unit', unitId };
    this.renderer.selected = { x: unit.x, y: unit.y };
    this.renderer.highlights = new Map();
    for (const i of g.reachableTiles(unit).keys()) this.renderer.highlights.set(i, 'move');
    for (const t of g.attackTargets(unit)) this.renderer.highlights.set(g.idx(t.x, t.y), 'attack');
    this.renderPanel();
  }

  selectTile(x, y) {
    this.sel = { type: 'tile', x, y };
    this.renderer.selected = { x, y };
    this.renderer.highlights = new Map();
    this.renderPanel();
  }

  clearSelection() {
    this.sel = null;
    this.renderer.selected = null;
    this.renderer.highlights = new Map();
    this.renderPanel();
  }

  // ---------- panels ----------
  refresh() {
    const g = this.game;
    const p = g.player();
    $('turn-info').textContent = `Turn ${g.turn}/${RULES.turnLimit}`;
    $('player-info').innerHTML =
      `<span class="dot" style="background:${p.color}"></span>${p.name}` +
      (p.type === 'ai' ? ' <small>(AI thinking…)</small>' : '');
    $('star-info').textContent = `★ ${p.stars}  (+${g.incomeOf(p)}/turn)`;
    $('end-turn-btn').disabled = !this.hooks.isHumanTurn() || g.over;
    $('tech-btn').disabled = !this.hooks.isHumanTurn() || g.over;
    if (!$('tech-modal').classList.contains('hidden')) this.renderTech();
    if (this.sel?.type === 'unit') {
      // revalidate highlight state after any event
      const u = g.units.get(this.sel.unitId);
      if (!u) this.clearSelection();
    }
    this.renderPanel();
  }

  renderPanel() {
    const panel = $('action-panel');
    const g = this.game;
    if (!this.sel || g.over) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    panel.innerHTML = '';

    if (this.sel.type === 'unit') {
      const u = g.units.get(this.sel.unitId);
      if (!u) { panel.classList.add('hidden'); return; }
      const def = UNITS[u.kind];
      panel.appendChild(el('h3', `${def.name}${u.veteran ? ' ★' : ''}`));
      const stats = el('div', '');
      stats.innerHTML =
        `<span class="stat">HP <b>${u.hp}/${u.maxHp}</b></span>` +
        `<span class="stat">ATK <b>${def.atk}</b></span>` +
        `<span class="stat">DEF <b>${def.def}</b></span>` +
        `<span class="stat">MOV <b>${def.mov}</b></span>` +
        `<span class="stat">RANGE <b>${def.range}</b></span>` +
        `<span class="stat">${def.dash ? 'Can move + attack' : 'Move or attack'}</span>`;
      panel.appendChild(stats);
      const actions = el('div', '', 'actions');

      const city = g.cityAt(u.x, u.y);
      if (city && city.ownerId !== u.ownerId) {
        const btn = el('button', city.ownerId === -1 ? 'Capture Village' : 'Capture City');
        btn.disabled = u.moved || u.attacked;
        btn.onclick = () => { g.captureCity(u.id); this.selectUnit(u.id); };
        actions.appendChild(btn);
      }
      const done = el('button', 'Deselect');
      done.onclick = () => this.clearSelection();
      actions.appendChild(done);
      panel.appendChild(actions);

      const sub = el('div', '', 'sub');
      sub.textContent = u.moved || u.attacked
        ? 'This unit has acted this turn.'
        : 'Click a highlighted tile to move, a red-ringed enemy to attack.';
      panel.appendChild(sub);
      return;
    }

    // tile selection
    const { x, y } = this.sel;
    const t = g.tile(x, y);
    const city = g.cityAt(x, y);
    const enemyUnit = g.unitAt(x, y);
    const p = g.player();

    if (city) {
      const ownerName = city.ownerId === -1 ? 'Neutral' : g.players[city.ownerId].name;
      panel.appendChild(el('h3', `${city.name} ${city.ownerId === -1 ? '(Village)' : `— Level ${city.level}`}`));
      panel.appendChild(el('div', city.ownerId === -1
        ? 'Move a unit here, then capture it next turn.'
        : `${ownerName}${city.isCapital ? ' capital' : ''} · Population ${city.pop}/${city.level + 1}`
          + (city.workshop ? ' · Workshop' : ''), 'sub'));

      if (city.ownerId === p.id && this.hooks.isHumanTurn()) {
        const actions = el('div', '', 'actions');
        const occupied = g.tile(city.x, city.y).unitId !== -1;
        for (const { kind, def } of g.trainableUnits(city)) {
          const btn = el('button', `${def.name} (${def.cost}★)`);
          btn.disabled = occupied || p.stars < def.cost;
          btn.title = occupied ? 'City tile is occupied' : '';
          btn.onclick = () => { g.trainUnit(city.id, kind); this.refresh(); };
          actions.appendChild(btn);
        }
        panel.appendChild(actions);
      }
    } else {
      const bits = [t.terrain[0].toUpperCase() + t.terrain.slice(1)];
      if (t.resource) bits.push(RESOURCES[t.resource].name);
      if (t.improvement) bits.push(t.improvement);
      panel.appendChild(el('h3', bits.join(' · ')));
      if (t.territoryOf !== -1) {
        const c = g.cities[t.territoryOf];
        panel.appendChild(el('div',
          `Territory of ${c.name}${c.ownerId >= 0 ? ` (${g.players[c.ownerId].name})` : ''}`, 'sub'));
      }
    }

    if (enemyUnit) {
      const def = UNITS[enemyUnit.kind];
      const line = el('div', '', 'sub');
      line.textContent = `${g.players[enemyUnit.ownerId].name} ${def.name} — HP ${enemyUnit.hp}/${enemyUnit.maxHp}, ATK ${def.atk}, DEF ${def.def}`;
      panel.appendChild(line);
    }

    const actions = g.tileActions(x, y);
    if (actions.length && this.hooks.isHumanTurn()) {
      const row = el('div', '', 'actions');
      for (const a of actions) {
        const btn = el('button', a.label + (a.needTech ? ` — needs ${a.needTech}` : ''));
        btn.disabled = !a.enabled;
        btn.onclick = () => {
          if (g.doTileAction(x, y, a.id)) {
            this.renderer.addFloat(x, y, 'pop +', '#8ef78e');
            this.selectTile(x, y);
          }
        };
        row.appendChild(btn);
      }
      panel.appendChild(row);
    }
  }

  // ---------- tech modal ----------
  showTech() {
    this.renderTech();
    $('tech-modal').classList.remove('hidden');
  }

  renderTech() {
    const g = this.game;
    const p = g.player();
    const root = $('tech-tree');
    root.innerHTML = '';
    for (const tier of [1, 2, 3]) {
      const wrap = el('div', '', 'tech-tier');
      wrap.appendChild(el('h4', `Tier ${tier}`));
      const grid = el('div', '', 'tech-grid');
      for (const [id, t] of Object.entries(TECHS)) {
        if (t.tier !== tier) continue;
        const card = el('div', '', 'tech-card');
        const has = p.techs.has(id);
        const reqOk = !t.req || p.techs.has(t.req);
        const cost = g.techCostFor(p, id);
        card.classList.add(has ? 'researched' : reqOk ? 'available' : 'locked');
        card.appendChild(el('b', t.name));
        card.appendChild(el('div', t.desc + (t.req ? ` (requires ${TECHS[t.req].name})` : ''), 'desc'));
        if (has) {
          card.appendChild(el('span', 'Researched ✓', 'done'));
        } else {
          const btn = el('button', `Research (${cost}★)`);
          btn.disabled = !g.canResearch(p, id) || !this.hooks.isHumanTurn();
          btn.onclick = () => { g.research(id); this.renderTech(); this.refresh(); };
          card.appendChild(btn);
        }
        grid.appendChild(card);
      }
      wrap.appendChild(grid);
      root.appendChild(wrap);
    }
  }

  // ---------- toasts & end screen ----------
  toast(msg) {
    const box = $('notifications');
    const node = el('div', msg, 'toast');
    box.appendChild(node);
    setTimeout(() => node.remove(), 3200);
    while (box.children.length > 4) box.firstChild.remove();
  }

  showEndScreen(ev) {
    const g = this.game;
    const winner = ev.winnerId >= 0 ? g.players[ev.winnerId] : null;
    const humanWon = winner?.type === 'human';
    $('end-title').textContent = winner
      ? (humanWon ? 'VICTORY!' : `${winner.name} WINS`)
      : 'GAME OVER';
    $('end-detail').textContent = ev.reason === 'domination'
      ? 'Victory by domination — every rival has fallen.'
      : `Turn limit reached — highest score wins.`;
    const scores = $('end-scores');
    scores.innerHTML = '';
    const ranked = [...g.players].sort((a, b) => g.scoreOf(b) - g.scoreOf(a));
    for (const p of ranked) {
      const row = el('div', '', 'score-row' + (p === winner ? ' winner' : ''));
      row.innerHTML = `<span><span class="dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.color};margin-right:6px"></span>${p.name}${p.alive ? '' : ' ☠'}</span><b>${g.scoreOf(p)}</b>`;
      scores.appendChild(row);
    }
    $('end-screen').classList.remove('hidden');
  }
}

function el(tag, text = '', cls = '') {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
