// Isometric canvas renderer: terrain, territory, resources, cities, units, fog, effects.
import { TERRAIN, UNITS } from './constants.js';

const TILE_W = 64; // full diamond width at zoom 1
const TILE_H = 32;

const COLORS = {
  field: '#82c96e', fieldAlt: '#76bf62',
  forestFloor: '#6ab35b', tree: '#2d7a45', treeDark: '#215e35',
  mountain: '#a8b4bd', mountainDark: '#8a97a1', peak: '#e8eef2',
  water: '#4a9fd8', waterDark: '#3c8cc4',
  fog: '#cfdbe6', fogEdge: '#b9c9d8',
  grid: 'rgba(0,0,0,0.08)',
};

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.selected = null;              // {x, y}
    this.highlights = new Map();       // tileIdx -> 'move' | 'attack'
    this.floats = [];                  // {wx, wy, text, color, age}
    this.unitVisual = new Map();       // unitId -> {x, y} lerped position
    this.viewExplored = null;          // Set of tile idx, or null = see all
    this.time = 0;
    this.resize();
  }

  resize() {
    this.canvas.width = window.innerWidth * devicePixelRatio;
    this.canvas.height = window.innerHeight * devicePixelRatio;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
  }

  centerOn(tx, ty) {
    const { x, y } = this.tileCenter(tx, ty);
    this.cam.x += window.innerWidth / 2 - x;
    this.cam.y += window.innerHeight / 2 - y;
  }

  // world (tile coords, possibly fractional) -> CSS pixels
  project(tx, ty) {
    const z = this.cam.zoom;
    return {
      x: (tx - ty) * (TILE_W / 2) * z + this.cam.x,
      y: (tx + ty) * (TILE_H / 2) * z + this.cam.y,
    };
  }
  tileCenter(tx, ty) { return this.project(tx, ty); }

  // CSS pixels -> tile coords ({x, y} ints) or null
  tileAt(px, py) {
    const z = this.cam.zoom;
    const a = (px - this.cam.x) / ((TILE_W / 2) * z);
    const b = (py - this.cam.y) / ((TILE_H / 2) * z);
    const tx = Math.round((a + b) / 2);
    const ty = Math.round((b - a) / 2);
    if (!this.game.inBounds(tx, ty)) return null;
    return { x: tx, y: ty };
  }

  addFloat(tx, ty, text, color) {
    this.floats.push({ tx, ty, text, color, age: 0 });
  }

  isExplored(tx, ty) {
    return !this.viewExplored || this.viewExplored.has(this.game.idx(tx, ty));
  }

  frame(dt) {
    this.time += dt;
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.fillStyle = '#0b1c2c';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    const g = this.game;
    // painter's order: back-to-front along x+y
    for (let s = 0; s <= (g.size - 1) * 2; s++) {
      for (let x = Math.max(0, s - g.size + 1); x <= Math.min(s, g.size - 1); x++) {
        this.drawTile(ctx, x, s - x);
      }
    }

    // lerp + draw units above terrain in the same order
    for (const unit of g.units.values()) {
      let v = this.unitVisual.get(unit.id);
      if (!v) { v = { x: unit.x, y: unit.y }; this.unitVisual.set(unit.id, v); }
      const k = Math.min(1, dt * 10);
      v.x += (unit.x - v.x) * k;
      v.y += (unit.y - v.y) * k;
    }
    for (const id of [...this.unitVisual.keys()]) {
      if (!this.game.units.has(id)) this.unitVisual.delete(id);
    }
    const sortedUnits = [...g.units.values()].sort((a, b) => (a.x + a.y) - (b.x + b.y));
    for (const unit of sortedUnits) {
      if (!this.isExplored(unit.x, unit.y)) continue;
      this.drawUnit(ctx, unit);
    }

    for (const city of g.cities) {
      if (this.isExplored(city.x, city.y)) this.drawCityLabel(ctx, city);
    }

    // selection + attack rings on top
    if (this.selected) this.strokeDiamond(ctx, this.selected.x, this.selected.y, '#ffd76a', 2.5);
    for (const [i, kind] of this.highlights) {
      if (kind !== 'attack') continue;
      const x = i % g.size, y = Math.floor(i / g.size);
      const pulse = 2 + Math.sin(this.time * 6) * 0.8;
      this.strokeDiamond(ctx, x, y, '#ff5252', pulse);
    }

    this.drawFloats(ctx, dt);
    ctx.restore();
  }

  diamondPath(ctx, cx, cy, hw, hh) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
  }

  fillDiamond(ctx, tx, ty, color, scale = 1) {
    const z = this.cam.zoom;
    const { x, y } = this.tileCenter(tx, ty);
    this.diamondPath(ctx, x, y, (TILE_W / 2) * z * scale, (TILE_H / 2) * z * scale);
    ctx.fillStyle = color;
    ctx.fill();
  }

  strokeDiamond(ctx, tx, ty, color, width = 2, scale = 0.96) {
    const z = this.cam.zoom;
    const { x, y } = this.tileCenter(tx, ty);
    this.diamondPath(ctx, x, y, (TILE_W / 2) * z * scale, (TILE_H / 2) * z * scale);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  drawTile(ctx, tx, ty) {
    const g = this.game;
    const z = this.cam.zoom;
    const t = g.tile(tx, ty);
    const { x, y } = this.tileCenter(tx, ty);

    // cull offscreen
    if (x < -TILE_W * z || x > window.innerWidth + TILE_W * z
      || y < -TILE_H * z * 3 || y > window.innerHeight + TILE_H * z * 2) return;

    if (!this.isExplored(tx, ty)) {
      this.fillDiamond(ctx, tx, ty, COLORS.fog, 1.0);
      this.strokeDiamond(ctx, tx, ty, COLORS.fogEdge, 1, 0.99);
      return;
    }

    // base terrain
    const alt = (tx + ty) % 2 === 0;
    let base = COLORS.field;
    if (t.terrain === TERRAIN.WATER) base = alt ? COLORS.water : COLORS.waterDark;
    else if (t.terrain === TERRAIN.FOREST) base = COLORS.forestFloor;
    else base = alt ? COLORS.field : COLORS.fieldAlt;
    this.fillDiamond(ctx, tx, ty, base);
    this.strokeDiamond(ctx, tx, ty, COLORS.grid, 1, 1);

    // territory tint & border
    if (t.territoryOf !== -1) {
      const city = g.cities[t.territoryOf];
      if (city.ownerId !== -1) {
        const color = g.players[city.ownerId].color;
        ctx.globalAlpha = 0.16;
        this.fillDiamond(ctx, tx, ty, color);
        ctx.globalAlpha = 1;
        this.strokeDiamond(ctx, tx, ty, color + '88', 1.4, 0.93);
      }
    }

    // terrain decoration
    if (t.terrain === TERRAIN.MOUNTAIN) this.drawMountain(ctx, x, y, z);
    if (t.terrain === TERRAIN.FOREST) this.drawTrees(ctx, x, y, z, tx * 7 + ty * 13);

    if (t.resource) this.drawResource(ctx, t.resource, x, y, z);
    if (t.improvement) this.drawImprovement(ctx, t.improvement, x, y, z);

    // move highlight
    const hl = this.highlights.get(g.idx(tx, ty));
    if (hl === 'move') {
      ctx.globalAlpha = 0.45 + Math.sin(this.time * 5) * 0.08;
      this.fillDiamond(ctx, tx, ty, '#ffffff', 0.55);
      ctx.globalAlpha = 1;
    }

    if (t.cityId !== -1) this.drawCity(ctx, g.cities[t.cityId], x, y, z);
  }

  drawMountain(ctx, x, y, z) {
    const w = 16 * z, h = 20 * z;
    ctx.beginPath();
    ctx.moveTo(x - w, y + 6 * z);
    ctx.lineTo(x - 3 * z, y - h);
    ctx.lineTo(x + w * 0.9, y + 6 * z);
    ctx.closePath();
    ctx.fillStyle = COLORS.mountainDark;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 8 * z, y - 6 * z);
    ctx.lineTo(x - 3 * z, y - h);
    ctx.lineTo(x + 3 * z, y - 7 * z);
    ctx.closePath();
    ctx.fillStyle = COLORS.peak;
    ctx.fill();
  }

  drawTrees(ctx, x, y, z, salt) {
    const spots = [[-9, 2], [6, -3], [0, 6]];
    for (let i = 0; i < spots.length; i++) {
      if ((salt + i) % 4 === 3) continue;
      const [ox, oy] = spots[i];
      const bx = x + ox * z, by = y + oy * z;
      ctx.beginPath();
      ctx.moveTo(bx - 5 * z, by);
      ctx.lineTo(bx, by - 12 * z);
      ctx.lineTo(bx + 5 * z, by);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? COLORS.treeDark : COLORS.tree;
      ctx.fill();
      ctx.fillStyle = '#5b3a1e';
      ctx.fillRect(bx - 1 * z, by, 2 * z, 3 * z);
    }
  }

  drawResource(ctx, kind, x, y, z) {
    ctx.save();
    switch (kind) {
      case 'fruit':
        ctx.fillStyle = '#8e44ad';
        for (const [ox, oy] of [[-3, 0], [3, 0], [0, -4]])
          this.dot(ctx, x + ox * z, y + oy * z, 3.2 * z);
        break;
      case 'crop':
        ctx.strokeStyle = '#d4a017';
        ctx.lineWidth = 2 * z;
        for (const ox of [-6, 0, 6]) {
          ctx.beginPath();
          ctx.moveTo(x + ox * z, y + 5 * z);
          ctx.lineTo(x + ox * z, y - 6 * z);
          ctx.stroke();
        }
        break;
      case 'animal':
        ctx.fillStyle = '#7a4a21';
        this.dot(ctx, x, y - 2 * z, 5 * z);
        ctx.fillStyle = '#5b3a1e';
        this.dot(ctx, x - 4 * z, y - 7 * z, 2 * z);
        this.dot(ctx, x + 4 * z, y - 7 * z, 2 * z);
        break;
      case 'metal':
        ctx.fillStyle = '#d8dee4';
        this.diamondPath(ctx, x, y - 2 * z, 6 * z, 6 * z);
        ctx.fill();
        ctx.strokeStyle = '#78848d';
        ctx.lineWidth = 1.2 * z;
        ctx.stroke();
        break;
      case 'fish':
        ctx.fillStyle = '#eaf6ff';
        ctx.beginPath();
        ctx.ellipse(x, y, 6 * z, 3 * z, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + 5 * z, y);
        ctx.lineTo(x + 9 * z, y - 3 * z);
        ctx.lineTo(x + 9 * z, y + 3 * z);
        ctx.closePath();
        ctx.fill();
        break;
    }
    ctx.restore();
  }

  drawImprovement(ctx, kind, x, y, z) {
    ctx.save();
    if (kind === 'farm') {
      ctx.fillStyle = '#e8c258';
      for (const [ox, oy] of [[-6, -2], [2, -2], [-2, 3]])
        ctx.fillRect(x + ox * z, y + oy * z, 5 * z, 3.4 * z);
    } else if (kind === 'mine') {
      ctx.fillStyle = '#6d6d6d';
      ctx.beginPath();
      ctx.moveTo(x - 7 * z, y + 4 * z);
      ctx.lineTo(x, y - 6 * z);
      ctx.lineTo(x + 7 * z, y + 4 * z);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(x - 2 * z, y - 1 * z, 4 * z, 5 * z);
    } else if (kind === 'lumberhut') {
      ctx.fillStyle = '#9a6a3a';
      ctx.fillRect(x - 5 * z, y - 3 * z, 10 * z, 6 * z);
      ctx.fillStyle = '#6f4a26';
      ctx.beginPath();
      ctx.moveTo(x - 6 * z, y - 3 * z);
      ctx.lineTo(x, y - 8 * z);
      ctx.lineTo(x + 6 * z, y - 3 * z);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawCity(ctx, city, x, y, z) {
    const g = this.game;
    const owner = city.ownerId === -1 ? null : g.players[city.ownerId];
    const main = owner ? owner.color : '#b9b3a8';
    const dark = owner ? owner.tribe.dark : '#8b8579';

    // houses
    const houses = Math.min(3, city.level);
    const offs = [[0, 0], [-10, 4], [10, 4]];
    for (let i = houses - 1; i >= 0; i--) {
      const hx = x + offs[i][0] * z, hy = y + offs[i][1] * z;
      ctx.fillStyle = '#f2ecd9';
      ctx.fillRect(hx - 6 * z, hy - 7 * z, 12 * z, 8 * z);
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(hx - 7 * z, hy - 7 * z);
      ctx.lineTo(hx, hy - 13 * z);
      ctx.lineTo(hx + 7 * z, hy - 7 * z);
      ctx.closePath();
      ctx.fill();
    }
    // flag for capitals
    if (city.isCapital && owner) {
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1.2 * z;
      ctx.beginPath();
      ctx.moveTo(x, y - 13 * z);
      ctx.lineTo(x, y - 22 * z);
      ctx.stroke();
      ctx.fillStyle = main;
      ctx.beginPath();
      ctx.moveTo(x, y - 22 * z);
      ctx.lineTo(x + 8 * z, y - 19 * z);
      ctx.lineTo(x, y - 16 * z);
      ctx.closePath();
      ctx.fill();
    }

  }

  // nameplates render in a later pass so units never cover them
  drawCityLabel(ctx, city) {
    const g = this.game;
    const z = this.cam.zoom;
    const { x, y } = this.tileCenter(city.x, city.y);
    const owner = city.ownerId === -1 ? null : g.players[city.ownerId];

    const label = city.ownerId === -1 ? city.name : `${city.name} ⭐${city.level}`;
    ctx.font = `${Math.max(9, 10 * z)}px sans-serif`;
    ctx.textAlign = 'center';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(10,20,32,0.75)';
    ctx.beginPath();
    ctx.roundRect(x - tw / 2 - 5, y + 8 * z, tw + 10, 13 * Math.max(1, z * 0.9), 4);
    ctx.fill();
    ctx.fillStyle = owner ? '#fff' : '#ded8cb';
    ctx.fillText(label, x, y + 8 * z + 10 * Math.max(1, z * 0.9));

    // population progress pips
    if (owner) {
      const need = city.level + 1;
      const w = 4 * z, gap = 2 * z;
      const total = need * w + (need - 1) * gap;
      for (let i = 0; i < need; i++) {
        ctx.fillStyle = i < city.pop ? '#ffd76a' : 'rgba(255,255,255,0.35)';
        ctx.fillRect(x - total / 2 + i * (w + gap), y + 4 * z, w, 3 * z);
      }
    }
  }

  drawUnit(ctx, unit) {
    const g = this.game;
    const z = this.cam.zoom;
    const v = this.unitVisual.get(unit.id) || unit;
    const { x, y } = this.project(v.x, v.y);
    const owner = g.players[unit.ownerId];
    const def = UNITS[unit.kind];
    const r = (unit.kind === 'giant' ? 15 : 11) * z;

    // ready indicator for the side whose turn it is
    const ready = unit.ownerId === g.currentPlayer && !unit.moved && !unit.attacked && !g.over;
    if (ready) {
      ctx.beginPath();
      ctx.arc(x, y - 6 * z, r + 3 * z, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(x, y - 6 * z, r, 0, Math.PI * 2);
    ctx.fillStyle = owner.color;
    ctx.fill();
    ctx.strokeStyle = owner.tribe.dark;
    ctx.lineWidth = 2 * z;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = `bold ${11 * z}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.glyph, x, y - 6 * z + 0.5);
    ctx.textBaseline = 'alphabetic';

    if (unit.veteran) {
      ctx.fillStyle = '#ffd76a';
      ctx.font = `${9 * z}px sans-serif`;
      ctx.fillText('★', x + r * 0.9, y - 6 * z - r * 0.7);
    }

    // hp bar
    if (unit.hp < unit.maxHp) {
      const bw = 24 * z, bh = 3.5 * z;
      const frac = unit.hp / unit.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - bw / 2, y - 6 * z - r - 7 * z, bw, bh);
      ctx.fillStyle = frac > 0.5 ? '#58d068' : frac > 0.25 ? '#ffcc4d' : '#ff5252';
      ctx.fillRect(x - bw / 2, y - 6 * z - r - 7 * z, bw * frac, bh);
    }
  }

  dot(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawFloats(ctx, dt) {
    for (const f of this.floats) {
      f.age += dt;
      const { x, y } = this.tileCenter(f.tx, f.ty);
      ctx.globalAlpha = Math.max(0, 1 - f.age / 1.3);
      ctx.font = `bold ${14 * Math.min(1.2, this.cam.zoom)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      const fy = y - 20 - f.age * 28;
      ctx.strokeText(f.text, x, fy);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, fy);
      ctx.globalAlpha = 1;
    }
    this.floats = this.floats.filter((f) => f.age < 1.3);
  }
}
