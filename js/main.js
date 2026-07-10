// Entry point: menu, game loop, AI scheduling, screen switching.
import { TRIBES } from './constants.js';
import { Game } from './game.js';
import { Renderer } from './renderer.js';
import { setupInput } from './input.js';
import { UI } from './ui.js';
import { playAITurn } from './ai.js';

const $ = (id) => document.getElementById(id);

// ---------- menu ----------
const slots = [
  { type: 'human', tribeIndex: 0 },
  { type: 'ai', tribeIndex: 1 },
  { type: 'ai', tribeIndex: 2 },
  { type: 'none', tribeIndex: 3 },
];
let mapSize = 16;

function renderSlots() {
  const root = $('player-slots');
  root.innerHTML = '';
  slots.forEach((slot, i) => {
    const tribe = TRIBES[slot.tribeIndex];
    const row = document.createElement('div');
    row.className = 'player-slot';
    row.style.opacity = slot.type === 'none' ? 0.45 : 1;
    row.innerHTML =
      `<span class="slot-swatch" style="background:${tribe.color}"></span>` +
      `<span class="slot-name">${tribe.name} <span class="slot-tech">starts with ${tribe.startTech}</span></span>`;
    const btn = document.createElement('button');
    btn.className = 'slot-type';
    btn.textContent = slot.type === 'human' ? '👤 Human' : slot.type === 'ai' ? '🤖 AI' : '— Off';
    btn.onclick = () => {
      const order = ['human', 'ai', 'none'];
      slot.type = order[(order.indexOf(slot.type) + 1) % order.length];
      renderSlots();
    };
    row.appendChild(btn);
    root.appendChild(row);
  });
}

$('map-size-group').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  mapSize = parseInt(btn.dataset.size, 10);
  for (const b of $('map-size-group').children) b.classList.toggle('active', b === btn);
});

$('start-btn').onclick = () => {
  const active = slots.filter((s) => s.type !== 'none');
  if (active.length < 2) { alert('Need at least 2 players.'); return; }
  const seed = $('seed-input').value.trim() || String(Math.floor(Math.random() * 1e9));
  startGame({
    size: mapSize,
    seed,
    players: active.map((s) => ({ type: s.type, tribeIndex: s.tribeIndex })),
  });
};

$('again-btn').onclick = () => {
  $('end-screen').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('menu-screen').classList.remove('hidden');
  running = false;
};

renderSlots();

// ---------- game session ----------
let running = false;
let game, renderer, ui;
let aiPumping = false;

function startGame(config) {
  game = new Game(config);
  const canvas = $('game-canvas');
  renderer = new Renderer(canvas, game);
  updateViewer();

  ui = new UI(game, renderer, {
    isHumanTurn: () => !game.over && game.player().type === 'human',
    onHumanEndTurn: () => {
      ui.clearSelection();
      game.endTurn();
      updateViewer();
      ui.refresh();
      pumpAI();
    },
  });

  setupInput(canvas, renderer, {
    onTileClick: (x, y) => ui.handleTileClick(x, y),
    onMissClick: () => ui.clearSelection(),
    onEndTurnKey: () => {
      if (!game.over && game.player().type === 'human') {
        ui.clearSelection();
        game.endTurn();
        updateViewer();
        ui.refresh();
        pumpAI();
      }
    },
  });

  // camera on the first human capital (or first capital)
  const viewIdx = Math.max(0, game.players.findIndex((p) => p.type === 'human'));
  const home = game.citiesOf(viewIdx).find((c) => c.isCapital) || game.cities[0];
  renderer.cam.zoom = Math.min(1.4, 22 / game.size + 0.4);
  renderer.centerOn(home.x, home.y);

  $('menu-screen').classList.add('hidden');
  $('end-screen').classList.add('hidden');
  $('hud').classList.remove('hidden');

  if (!running) { running = true; requestAnimationFrame(loop); }
  pumpAI();

  // handles for automated testing / debugging
  window.game = game;
  window.renderer = renderer;
  window.ui = ui;
}

function updateViewer() {
  const humans = game.players.filter((p) => p.type === 'human');
  if (humans.length === 0) {
    renderer.viewExplored = null; // spectator sees all
  } else if (game.player().type === 'human') {
    renderer.viewExplored = game.player().explored;
  } else if (!renderer.viewExplored) {
    renderer.viewExplored = humans[0].explored;
  }
}

async function pumpAI() {
  if (aiPumping) return;
  aiPumping = true;
  try {
    while (running && !game.over && game.player().type === 'ai') {
      ui.refresh();
      const delay = window.AI_DELAY ?? 120;
      await playAITurn(game, { delay });
      if (!game.over) {
        game.endTurn();
        updateViewer();
      }
      ui.refresh();
      await new Promise((r) => setTimeout(r, delay));
    }
  } finally {
    aiPumping = false;
    ui.refresh();
  }
}

let last = performance.now();
function loop(now) {
  if (!running) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  renderer.frame(dt);
  requestAnimationFrame(loop);
}

window.startGame = startGame;
