// Arsenal original de Vértice Arena.
// Ángulos en radianes. Daño por bala (o por perdigón en escopeta).

const D = Math.PI / 180;

export const WEAPONS = {
  kestrel: {
    id: 'kestrel', name: 'Kestrel AR-7', slot: 0, kind: 'rifle', fire: 'auto',
    damage: 26, headMult: 1.6, rpm: 640, mag: 30, reserve: 120, reload: 2.1,
    falloff: [30, 60], minMult: 0.72, pellets: 1, range: 200,
    spread: { hip: 3.2 * D, ads: 0.35 * D, move: 2.0 * D, air: 5 * D, crouch: 0.75, bloom: 0.35 * D, bloomMax: 3 * D, recover: 6 * D },
    recoil: { pitch: 0.9 * D, yaw: 0.35 * D }, zoom: 1.35, adsTime: 0.22, switchTime: 0.45, moveMul: 1.0,
    loud: 45, preferred: 22, model: { len: 0.62, color: 0x3a4250, accent: 0x4fa3ff }, snd: { f: 900, decay: 0.16, thump: 90, gain: 0.9 },
  },
  brisa: {
    id: 'brisa', name: 'Brisa SMG', slot: 0, kind: 'smg', fire: 'auto',
    damage: 19, headMult: 1.4, rpm: 860, mag: 32, reserve: 160, reload: 1.8,
    falloff: [12, 30], minMult: 0.55, pellets: 1, range: 150,
    spread: { hip: 2.6 * D, ads: 0.9 * D, move: 0.9 * D, air: 4 * D, crouch: 0.8, bloom: 0.25 * D, bloomMax: 3 * D, recover: 8 * D },
    recoil: { pitch: 0.55 * D, yaw: 0.45 * D }, zoom: 1.2, adsTime: 0.15, switchTime: 0.35, moveMul: 1.06,
    loud: 38, preferred: 12, model: { len: 0.45, color: 0x2f3437, accent: 0x7cf2c8 }, snd: { f: 1500, decay: 0.1, thump: 120, gain: 0.7 },
  },
  trueno: {
    id: 'trueno', name: 'Trueno 12', slot: 0, kind: 'shotgun', fire: 'semi',
    damage: 14, headMult: 1.25, rpm: 78, mag: 6, reserve: 30, reload: 2.4,
    falloff: [6, 18], minMult: 0.2, pellets: 8, range: 60,
    spread: { hip: 5.5 * D, ads: 4.0 * D, move: 0.5 * D, air: 1 * D, crouch: 0.95, bloom: 0, bloomMax: 0, recover: 10 * D },
    recoil: { pitch: 4.5 * D, yaw: 0.8 * D }, zoom: 1.1, adsTime: 0.2, switchTime: 0.5, moveMul: 1.0,
    loud: 50, preferred: 6, model: { len: 0.7, color: 0x5a3b2a, accent: 0xffb347 }, snd: { f: 500, decay: 0.3, thump: 60, gain: 1.0 },
  },
  halcon: {
    id: 'halcon', name: 'Halcón LR', slot: 0, kind: 'sniper', fire: 'semi',
    damage: 105, headMult: 2.0, rpm: 42, mag: 5, reserve: 25, reload: 3.0,
    falloff: [200, 300], minMult: 1, pellets: 1, range: 300,
    spread: { hip: 8 * D, ads: 0.02 * D, move: 4 * D, air: 8 * D, crouch: 0.8, bloom: 0, bloomMax: 0, recover: 10 * D },
    recoil: { pitch: 5 * D, yaw: 0.6 * D }, zoom: 4.0, adsTime: 0.38, switchTime: 0.6, moveMul: 0.9,
    loud: 70, preferred: 40, model: { len: 0.95, color: 0x2b3a2f, accent: 0xc6ff5a }, snd: { f: 650, decay: 0.45, thump: 50, gain: 1.0 },
  },
  vespa: {
    id: 'vespa', name: 'Vespa BR', slot: 0, kind: 'rifle', fire: 'burst', burst: 3, burstRpm: 900,
    damage: 31, headMult: 1.5, rpm: 160, mag: 24, reserve: 96, reload: 2.3,
    falloff: [35, 70], minMult: 0.75, pellets: 1, range: 200,
    spread: { hip: 3.0 * D, ads: 0.25 * D, move: 1.8 * D, air: 5 * D, crouch: 0.75, bloom: 0.3 * D, bloomMax: 1.5 * D, recover: 7 * D },
    recoil: { pitch: 0.8 * D, yaw: 0.25 * D }, zoom: 1.5, adsTime: 0.24, switchTime: 0.45, moveMul: 0.98,
    loud: 45, preferred: 28, model: { len: 0.66, color: 0x45394f, accent: 0xff6bd6 }, snd: { f: 1100, decay: 0.14, thump: 85, gain: 0.85 },
  },
  mazo: {
    id: 'mazo', name: 'Mazo LMG', slot: 0, kind: 'lmg', fire: 'auto',
    damage: 24, headMult: 1.5, rpm: 590, mag: 75, reserve: 150, reload: 3.8,
    falloff: [28, 60], minMult: 0.7, pellets: 1, range: 200,
    spread: { hip: 4.0 * D, ads: 0.6 * D, move: 2.5 * D, air: 6 * D, crouch: 0.7, bloom: 0.2 * D, bloomMax: 2.5 * D, recover: 5 * D },
    recoil: { pitch: 0.7 * D, yaw: 0.5 * D }, zoom: 1.3, adsTime: 0.32, switchTime: 0.7, moveMul: 0.86,
    loud: 50, preferred: 25, model: { len: 0.78, color: 0x3d3d2e, accent: 0xffe14d }, snd: { f: 750, decay: 0.2, thump: 70, gain: 0.95 },
  },
  aguja: {
    id: 'aguja', name: 'Aguja P9', slot: 1, kind: 'pistol', fire: 'semi',
    damage: 24, headMult: 1.6, rpm: 400, mag: 12, reserve: 60, reload: 1.4,
    falloff: [15, 35], minMult: 0.6, pellets: 1, range: 120,
    spread: { hip: 1.8 * D, ads: 0.5 * D, move: 0.8 * D, air: 3 * D, crouch: 0.85, bloom: 0.5 * D, bloomMax: 2 * D, recover: 9 * D },
    recoil: { pitch: 1.4 * D, yaw: 0.4 * D }, zoom: 1.15, adsTime: 0.12, switchTime: 0.3, moveMul: 1.08,
    loud: 35, preferred: 12, model: { len: 0.24, color: 0x30333a, accent: 0xe0e6f0 }, snd: { f: 1300, decay: 0.12, thump: 110, gain: 0.7 },
  },
  colmillo: {
    id: 'colmillo', name: 'Colmillo', slot: 2, kind: 'melee', fire: 'melee',
    damage: 55, headMult: 1.0, rpm: 100, mag: 0, reserve: 0, reload: 0,
    falloff: [99, 99], minMult: 1, pellets: 1, range: 2.3,
    spread: { hip: 0, ads: 0, move: 0, air: 0, crouch: 1, bloom: 0, bloomMax: 0, recover: 0 },
    recoil: { pitch: 0, yaw: 0 }, zoom: 1, adsTime: 0.1, switchTime: 0.25, moveMul: 1.12,
    loud: 4, preferred: 1.5, model: { len: 0.3, color: 0x9aa3ad, accent: 0x222222 }, snd: { f: 3000, decay: 0.06, thump: 0, gain: 0.4 },
  },
};

export const PRIMARIES = ['kestrel', 'brisa', 'trueno', 'halcon', 'vespa', 'mazo'];
export const SECONDARY = 'aguja';
export const MELEE = 'colmillo';

// Escalera del modo Gun Game (la última es el cuchillo).
export const GUN_LADDER = ['mazo', 'kestrel', 'vespa', 'brisa', 'trueno', 'halcon', 'aguja', 'colmillo'];

export function defaultLoadout(primary = 'kestrel') {
  return [PRIMARIES.includes(primary) ? primary : 'kestrel', SECONDARY, MELEE];
}

export function freshAmmo(loadout) {
  return loadout.map((id) => {
    const w = id ? WEAPONS[id] : null;
    return w ? [w.mag, w.reserve] : [0, 0];
  });
}

export function damageAt(w, dist) {
  const [a, b] = w.falloff;
  if (dist <= a) return w.damage;
  if (dist >= b) return w.damage * w.minMult;
  const k = (dist - a) / (b - a);
  return w.damage * (1 - k * (1 - w.minMult));
}
