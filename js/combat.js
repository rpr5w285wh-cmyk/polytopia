// Polytopia-style combat math.
import { UNITS, RULES, TERRAIN } from './constants.js';

// Defence multiplier from the tile the defender stands on.
export function defenseBonus(game, defender) {
  const tile = game.tile(defender.x, defender.y);
  const owner = game.players[defender.ownerId];
  if (tile.cityId !== -1) return RULES.cityDefenseBonus;
  if (tile.terrain === TERRAIN.FOREST && owner.techs.has('archery')) return RULES.forestDefenseBonus;
  if (tile.terrain === TERRAIN.MOUNTAIN && owner.techs.has('climbing')) return RULES.mountainDefenseBonus;
  return 1;
}

// Returns { damage, retaliation } without applying anything.
export function previewAttack(game, attacker, defender) {
  const aDef = UNITS[attacker.kind];
  const dDef = UNITS[defender.kind];
  const attackForce = aDef.atk * (attacker.hp / attacker.maxHp);
  const defenseForce = dDef.def * (defender.hp / defender.maxHp) * defenseBonus(game, defender);
  const total = attackForce + defenseForce;
  const damage = Math.round((attackForce / total) * aDef.atk * 4.5);
  let retaliation = 0;
  if (defender.hp - damage > 0) {
    const dist = Math.max(Math.abs(attacker.x - defender.x), Math.abs(attacker.y - defender.y));
    if (dist <= dDef.range) {
      retaliation = Math.round((defenseForce / total) * dDef.def * 4.5);
    }
  }
  return { damage: Math.max(1, damage), retaliation };
}
