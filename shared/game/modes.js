// Reglas de cada modo de juego.
import { MODES, MODE_INFO, TEAM } from '../constants.js';
import { GUN_LADDER, defaultLoadout } from '../weapons.js';

export const GUN_KILLS_PER_LEVEL = 2; // bajas necesarias por nivel (el cuchillo final gana con 1)

export function isTeamMode(mode) { return MODE_INFO[mode]?.teams === true; }

export function loadoutFor(room, e) {
  if (room.settings.mode === MODES.GUN) {
    const wid = GUN_LADDER[Math.min(e.gunLevel, GUN_LADDER.length - 1)];
    return wid === 'colmillo' ? [null, null, 'colmillo'] : [wid, null, 'colmillo'];
  }
  return defaultLoadout(e.primary);
}

// Asigna equipos al empezar la partida.
export function assignTeams(room, humans, bots) {
  const mode = room.settings.mode;
  if (!isTeamMode(mode)) {
    for (const e of [...humans, ...bots]) e.team = TEAM.NONE;
    return;
  }
  if (mode === MODES.TDM_BOTS) {
    for (const e of humans) e.team = TEAM.A;
    for (const e of bots) e.team = TEAM.B;
    return;
  }
  const count = [0, 0];
  humans.forEach((e, i) => { e.team = i % 2; count[e.team]++; });
  for (const b of bots) {
    b.team = count[0] <= count[1] ? 0 : 1;
    count[b.team]++;
  }
}

export function teamForJoin(room) {
  const mode = room.settings.mode;
  if (!isTeamMode(mode)) return TEAM.NONE;
  if (mode === MODES.TDM_BOTS) return TEAM.A;
  const count = [0, 0];
  for (const e of room.entities.values()) if (e.team >= 0) count[e.team]++;
  return count[0] <= count[1] ? 0 : 1;
}

// Devuelve true si la partida termina con esta baja.
export function onKill(room, killer, victim, weaponId) {
  const mode = room.settings.mode;
  if (isTeamMode(mode)) {
    if (killer && killer !== victim && killer.team !== victim.team) room.teamScore[killer.team]++;
    return room.settings.scoreLimit > 0 && room.teamScore.some((s) => s >= room.settings.scoreLimit);
  }
  if (mode === MODES.FFA) {
    return !!killer && room.settings.scoreLimit > 0 && killer.kills >= room.settings.scoreLimit;
  }
  if (mode === MODES.GUN) {
    if (!killer || killer === victim) return false;
    if (weaponId === 'colmillo' && victim.gunLevel > 0) { victim.gunLevel--; victim.gunKills = 0; } // humillación: el cuchillo hace bajar de nivel
    if (killer.gunLevel >= GUN_LADDER.length - 1) {
      killer.gunLevel = GUN_LADDER.length; // completó la escalera
      return true;
    }
    killer.gunKills = (killer.gunKills || 0) + 1;
    if (killer.gunKills >= GUN_KILLS_PER_LEVEL) {
      killer.gunKills = 0;
      killer.gunLevel++;
      room.giveLoadout(killer);
    }
    return false;
  }
  return false;
}

export function computeWinner(room) {
  const mode = room.settings.mode;
  const ents = [...room.entities.values()];
  if (isTeamMode(mode)) {
    const [a, b] = room.teamScore;
    if (a === b) return { team: -1, name: 'Empate' };
    const team = a > b ? 0 : 1;
    return { team, name: team === 0 ? 'Equipo Cobalto' : 'Equipo Ámbar' };
  }
  const key = mode === MODES.GUN
    ? (e) => e.gunLevel * 1000 + e.kills * 10 - e.deaths * 0.01
    : (e) => e.kills * 1000 + e.score - e.deaths * 0.01;
  ents.sort((x, y) => key(y) - key(x));
  const top = ents[0];
  return top ? { team: -1, id: top.id, name: top.name } : { team: -1, name: 'Nadie' };
}
