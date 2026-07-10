// Procedural map generation: terrain blobs, capitals spread apart, villages, resources.
import { TERRAIN } from './constants.js';
import { makeRng } from './rng.js';

const NEIGHBORS8 = [];
for (let dy = -1; dy <= 1; dy++)
  for (let dx = -1; dx <= 1; dx++)
    if (dx || dy) NEIGHBORS8.push([dx, dy]);

export { NEIGHBORS8 };

export function generateMap(size, seedStr, numPlayers) {
  const rng = makeRng(seedStr);
  for (let attempt = 0; attempt < 20; attempt++) {
    const map = tryGenerate(size, rng, numPlayers);
    if (map) return map;
  }
  // Fallback: all-land map always works
  return tryGenerate(size, rng, numPlayers, true);
}

function tryGenerate(size, rng, numPlayers, noWater = false) {
  const tiles = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      tiles.push({
        x, y,
        terrain: TERRAIN.FIELD,
        resource: null,
        improvement: null,
        cityId: -1,        // city sitting on this tile
        territoryOf: -1,   // city whose borders include this tile
        unitId: -1,
      });
    }
  }
  const idx = (x, y) => y * size + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < size && y < size;

  // --- terrain blobs ---
  const paintBlob = (terrain, count, blobSize) => {
    for (let i = 0; i < count; i++) {
      let x = rng.int(size), y = rng.int(size);
      for (let j = 0; j < blobSize; j++) {
        if (inBounds(x, y)) tiles[idx(x, y)].terrain = terrain;
        const [dx, dy] = rng.pick(NEIGHBORS8);
        x += dx; y += dy;
      }
    }
  };
  const area = size * size;
  if (!noWater) paintBlob(TERRAIN.WATER, Math.round(area / 55), 9);
  paintBlob(TERRAIN.FOREST, Math.round(area / 22), 7);
  paintBlob(TERRAIN.MOUNTAIN, Math.round(area / 45), 5);

  // --- capitals: sample candidates, maximize min pairwise distance ---
  const margin = 2;
  const capitals = [];
  for (let p = 0; p < numPlayers; p++) {
    let best = null, bestScore = -1;
    for (let c = 0; c < 60; c++) {
      const x = margin + rng.int(size - margin * 2);
      const y = margin + rng.int(size - margin * 2);
      const d = capitals.length
        ? Math.min(...capitals.map(([cx, cy]) => Math.max(Math.abs(cx - x), Math.abs(cy - y))))
        : size;
      if (d > bestScore) { bestScore = d; best = [x, y]; }
    }
    if (capitals.length && bestScore < Math.floor(size / 3)) return null; // too cramped, retry
    capitals.push(best);
  }

  // clear ground around capitals
  for (const [cx, cy] of capitals) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!inBounds(x, y)) continue;
        const t = tiles[idx(x, y)];
        if (t.terrain === TERRAIN.WATER || (dx === 0 && dy === 0)) t.terrain = TERRAIN.FIELD;
      }
    }
  }

  // --- land connectivity between capitals (units can cross everything but water) ---
  if (!noWater && !connected(tiles, size, capitals)) return null;

  // --- villages ---
  const villages = [];
  const villageTarget = Math.round(area / 32);
  const farFromAll = (x, y, list, minD) =>
    list.every(([px, py]) => Math.max(Math.abs(px - x), Math.abs(py - y)) >= minD);
  for (let i = 0; i < 400 && villages.length < villageTarget; i++) {
    const x = 1 + rng.int(size - 2), y = 1 + rng.int(size - 2);
    const t = tiles[idx(x, y)];
    if (t.terrain === TERRAIN.WATER || t.terrain === TERRAIN.MOUNTAIN) continue;
    if (!farFromAll(x, y, capitals, 3) || !farFromAll(x, y, villages, 3)) continue;
    t.terrain = TERRAIN.FIELD;
    villages.push([x, y]);
  }

  // --- resources ---
  for (const t of tiles) {
    if (t.cityId !== -1) continue;
    const isVillage = villages.some(([vx, vy]) => vx === t.x && vy === t.y);
    const isCapital = capitals.some(([cx, cy]) => cx === t.x && cy === t.y);
    if (isVillage || isCapital) continue;
    switch (t.terrain) {
      case TERRAIN.FIELD:
        if (rng.chance(0.14)) t.resource = 'fruit';
        else if (rng.chance(0.10)) t.resource = 'crop';
        break;
      case TERRAIN.FOREST:
        if (rng.chance(0.32)) t.resource = 'animal';
        break;
      case TERRAIN.MOUNTAIN:
        if (rng.chance(0.4)) t.resource = 'metal';
        break;
      case TERRAIN.WATER:
        if (rng.chance(0.25)) t.resource = 'fish';
        break;
    }
  }

  // guarantee a couple of easy starting resources near each capital
  for (const [cx, cy] of capitals) {
    let easy = 0;
    const ring = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = cx + dx, y = cy + dy;
        if (!inBounds(x, y)) continue;
        const t = tiles[idx(x, y)];
        ring.push(t);
        if (t.resource === 'fruit' || t.resource === 'animal') easy++;
      }
    rng.shuffle(ring);
    for (const t of ring) {
      if (easy >= 2) break;
      if (t.resource) continue;
      if (t.terrain === TERRAIN.FIELD) { t.resource = 'fruit'; easy++; }
      else if (t.terrain === TERRAIN.FOREST) { t.resource = 'animal'; easy++; }
    }
  }

  return { size, tiles, capitals, villages };
}

function connected(tiles, size, capitals) {
  const idx = (x, y) => y * size + x;
  const passable = (t) => t.terrain !== TERRAIN.WATER;
  const [sx, sy] = capitals[0];
  const seen = new Set([idx(sx, sy)]);
  const queue = [[sx, sy]];
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of NEIGHBORS8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const i = idx(nx, ny);
      if (seen.has(i) || !passable(tiles[i])) continue;
      seen.add(i);
      queue.push([nx, ny]);
    }
  }
  return capitals.every(([x, y]) => seen.has(idx(x, y)));
}
