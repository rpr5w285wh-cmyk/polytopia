// Static game data: terrain, resources, units, techs, tribes, city rewards.

export const TERRAIN = {
  FIELD: 'field',
  FOREST: 'forest',
  MOUNTAIN: 'mountain',
  WATER: 'water',
};

export const RESOURCES = {
  fruit: { name: 'Fruit', terrain: 'field', tech: 'organization', cost: 2, pop: 1 },
  crop: { name: 'Crop', terrain: 'field', tech: 'farming', cost: 5, pop: 2, improvement: 'farm' },
  animal: { name: 'Wild Animal', terrain: 'forest', tech: 'hunting', cost: 2, pop: 1 },
  metal: { name: 'Metal', terrain: 'mountain', tech: 'mining', cost: 5, pop: 2, improvement: 'mine' },
  fish: { name: 'Fish', terrain: 'water', tech: 'fishing', cost: 2, pop: 1 },
};

export const IMPROVEMENTS = {
  farm: { name: 'Farm' },
  mine: { name: 'Mine' },
  lumberhut: { name: 'Lumber Hut', terrain: 'forest', tech: 'forestry', cost: 3, pop: 1 },
};

// skills: dash = may attack after moving; noRetaliation targets can't strike back
export const UNITS = {
  warrior:   { name: 'Warrior',   glyph: 'W', cost: 2,  hp: 10, atk: 2,   def: 2, mov: 1, range: 1, dash: true },
  rider:     { name: 'Rider',     glyph: 'R', cost: 3,  hp: 10, atk: 2,   def: 1, mov: 2, range: 1, dash: true,  tech: 'riding' },
  archer:    { name: 'Archer',    glyph: 'A', cost: 3,  hp: 10, atk: 2,   def: 1, mov: 1, range: 2, dash: true,  tech: 'archery' },
  defender:  { name: 'Defender',  glyph: 'D', cost: 3,  hp: 15, atk: 1,   def: 3, mov: 1, range: 1, dash: false, tech: 'shields' },
  swordsman: { name: 'Swordsman', glyph: 'S', cost: 5,  hp: 15, atk: 3,   def: 3, mov: 1, range: 1, dash: true,  tech: 'smithery' },
  catapult:  { name: 'Catapult',  glyph: 'C', cost: 8,  hp: 10, atk: 4,   def: 0, mov: 1, range: 3, dash: false, tech: 'mathematics' },
  knight:    { name: 'Knight',    glyph: 'K', cost: 8,  hp: 10, atk: 3.5, def: 1, mov: 3, range: 1, dash: true,  tech: 'chivalry' },
  giant:     { name: 'Giant',     glyph: 'G', cost: 0,  hp: 40, atk: 5,   def: 4, mov: 1, range: 1, dash: false, rewardOnly: true },
};

export const TECHS = {
  // tier 1
  organization: { name: 'Organization', tier: 1, req: null, desc: 'Harvest fruit from fields' },
  climbing:     { name: 'Climbing',     tier: 1, req: null, desc: 'Move onto mountains, see far from peaks' },
  hunting:      { name: 'Hunting',      tier: 1, req: null, desc: 'Hunt wild animals in forests' },
  riding:       { name: 'Riding',       tier: 1, req: null, desc: 'Unlock the fast Rider unit' },
  fishing:      { name: 'Fishing',      tier: 1, req: null, desc: 'Harvest fish from shallow water' },
  // tier 2
  farming:      { name: 'Farming',      tier: 2, req: 'organization', desc: 'Build farms on crop tiles (+2 pop)' },
  shields:      { name: 'Shields',      tier: 2, req: 'organization', desc: 'Unlock the sturdy Defender unit' },
  mining:       { name: 'Mining',       tier: 2, req: 'climbing',     desc: 'Build mines on metal tiles (+2 pop)' },
  archery:      { name: 'Archery',      tier: 2, req: 'hunting',      desc: 'Unlock the ranged Archer, +defence in forests' },
  forestry:     { name: 'Forestry',     tier: 2, req: 'hunting',      desc: 'Build lumber huts in forests (+1 pop)' },
  freespirit:   { name: 'Free Spirit',  tier: 2, req: 'riding',       desc: 'Path to Chivalry' },
  // tier 3
  smithery:     { name: 'Smithery',     tier: 3, req: 'mining',       desc: 'Unlock the mighty Swordsman' },
  mathematics:  { name: 'Mathematics',  tier: 3, req: 'forestry',     desc: 'Unlock the long-range Catapult' },
  chivalry:     { name: 'Chivalry',     tier: 3, req: 'freespirit',   desc: 'Unlock the chain-attacking Knight' },
};

export const TECH_BASE_COST = { 1: 5, 2: 7, 3: 9 };

export function techCost(techId, numCities) {
  const t = TECHS[techId];
  return Math.round(TECH_BASE_COST[t.tier] * (1 + 0.2 * numCities));
}

export const TRIBES = [
  { name: 'Imperius', color: '#3b82f6', dark: '#1d4ed8', startTech: 'organization',
    cityNames: ['Lux', 'Aurum', 'Corona', 'Solis', 'Ventus', 'Astra', 'Nova', 'Magna'] },
  { name: 'Bardur',   color: '#b45309', dark: '#7c3a06', startTech: 'hunting',
    cityNames: ['Grimsdal', 'Ulfheim', 'Bjornby', 'Skogvik', 'Torsted', 'Vargfell', 'Havnir', 'Eldstad'] },
  { name: 'Oumaji',   color: '#eab308', dark: '#a16207', startTech: 'riding',
    cityNames: ['Zebasi', 'Kalahi', 'Sahadi', 'Omaruru', 'Tumbesi', 'Wadibo', 'Ashanti', 'Bombasi'] },
  { name: 'Xin-xi',   color: '#dc2626', dark: '#991b1b', startTech: 'climbing',
    cityNames: ['Sha-po', 'Kai-lin', 'Mon-tu', 'Yun-shi', 'Ta-hua', 'Li-fan', 'Xiao-lu', 'Pei-ku'] },
];

// Fixed city level-up rewards (Polytopia offers a choice; we keep it simple).
export const CITY_REWARDS = {
  2: { id: 'workshop', label: 'Workshop (+1 star per turn)' },
  3: { id: 'border', label: 'Border Growth' },
  4: { id: 'pop', label: 'Population Boost (+3 pop)' },
  5: { id: 'giant', label: 'A Giant joins the city!' },
};

export const RULES = {
  startStars: 5,
  turnLimit: 30,
  healOwnTerritory: 4,
  healNeutral: 2,
  veteranKills: 3,
  veteranBonusHp: 5,
  cityDefenseBonus: 1.5,
  forestDefenseBonus: 1.5, // requires archery
  mountainDefenseBonus: 1.5, // requires climbing
};
