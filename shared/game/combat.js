// Estado de armas determinista (servidor + predicción del cliente) y dispersión con semilla.
import { WEAPONS, freshAmmo } from '../weapons.js';
import { BTN } from '../constants.js';
import { dirFromAngles } from '../physics.js';

export function createWeaponState(loadout) {
  return {
    loadout: loadout.slice(),
    slot: loadout[0] ? 0 : (loadout[1] ? 1 : 2),
    ammo: freshAmmo(loadout),
    reloadT: 0, switchT: 0, fireT: 0,
    burstLeft: 0, bloom: 0, shotSeq: 0, trig: false,
    adsT: 0,            // tiempo acumulado apuntando (para precisión del francotirador)
  };
}

export function copyWeaponState(dst, src) {
  dst.loadout = src.loadout.slice();
  dst.slot = src.slot;
  dst.ammo = src.ammo.map((a) => a.slice());
  dst.reloadT = src.reloadT; dst.switchT = src.switchT; dst.fireT = src.fireT;
  dst.burstLeft = src.burstLeft; dst.bloom = src.bloom; dst.shotSeq = src.shotSeq;
  dst.trig = src.trig; dst.adsT = src.adsT;
  return dst;
}

export function currentWeapon(ws) {
  return WEAPONS[ws.loadout[ws.slot]] || WEAPONS.colmillo;
}

export function computeSpread(w, ws, ms, b) {
  const sp = w.spread;
  const ads = (b & BTN.ADS) !== 0;
  const adsK = Math.min(1, ws.adsT / Math.max(0.05, w.adsTime));
  let s = ads ? sp.hip + (sp.ads - sp.hip) * adsK : sp.hip;
  const speed = Math.hypot(ms.vx, ms.vz);
  s += sp.move * Math.min(1, speed / 5.2);
  if (!ms.onGround) s += sp.air;
  if (ms.crouch > 0.5) s *= sp.crouch;
  s += ws.bloom;
  return s;
}

// Avanza el estado del arma un paso. Empuja en `shots` los disparos producidos.
// cmd.w: ranura pedida (0..2) o undefined/-1; cmd.r: recargar.
export function weaponStep(ws, ms, cmd, dt, shots) {
  let w = currentWeapon(ws);
  const b = cmd.b | 0;
  const fire = (b & BTN.FIRE) !== 0;
  const ads = (b & BTN.ADS) !== 0;
  ws.adsT = ads ? ws.adsT + dt : 0;
  ws.fireT = Math.max(0, ws.fireT - dt);
  ws.bloom = Math.max(0, ws.bloom - w.spread.recover * dt);

  if (ws.switchT > 0) ws.switchT = Math.max(0, ws.switchT - dt);

  if (ws.reloadT > 0) {
    ws.reloadT -= dt;
    if (ws.reloadT <= 0) {
      ws.reloadT = 0;
      const a = ws.ammo[ws.slot];
      const take = Math.min(w.mag - a[0], a[1]);
      a[0] += take; a[1] -= take;
    }
  }

  // Cambio de arma
  const want = cmd.w;
  if (want !== undefined && want !== null && want >= 0 && want <= 2 && want !== ws.slot && ws.loadout[want]) {
    ws.slot = want;
    w = currentWeapon(ws);
    ws.switchT = w.switchTime;
    ws.reloadT = 0; ws.burstLeft = 0; ws.fireT = 0; ws.bloom = 0;
  }

  const a = ws.ammo[ws.slot];
  const isMelee = w.fire === 'melee';
  const canReload = !isMelee && ws.reloadT === 0 && ws.switchT === 0 && a[0] < w.mag && a[1] > 0;
  if (cmd.r && canReload) { ws.reloadT = w.reload; ws.burstLeft = 0; }

  const edge = fire && !ws.trig;
  ws.trig = fire;

  if (ws.switchT > 0) return;

  // Recarga automática al intentar disparar sin balas
  if (!isMelee && fire && a[0] === 0 && canReload) { ws.reloadT = w.reload; return; }

  // La escopeta puede interrumpir la recarga si tiene cartuchos
  if (ws.reloadT > 0) {
    if (w.kind === 'shotgun' && edge && a[0] > 0) ws.reloadT = 0;
    else return;
  }

  let trigger = false;
  if (w.fire === 'auto') trigger = fire;
  else if (w.fire === 'semi' || w.fire === 'melee') trigger = edge;
  else if (w.fire === 'burst') {
    if (edge && ws.burstLeft === 0 && ws.fireT === 0) ws.burstLeft = w.burst;
    trigger = ws.burstLeft > 0;
  }
  if (!trigger || ws.fireT > 0) return;
  if (!isMelee && a[0] <= 0) { ws.burstLeft = 0; return; }

  if (!isMelee) a[0]--;
  const spread = computeSpread(w, ws, ms, b);
  shots.push({ seq: ws.shotSeq, wid: w.id, yaw: cmd.y, pitch: cmd.p, spread });
  ws.shotSeq++;
  ws.bloom = Math.min(w.spread.bloomMax, ws.bloom + w.spread.bloom);
  if (w.fire === 'burst') {
    ws.burstLeft--;
    ws.fireT = ws.burstLeft > 0 ? 60 / w.burstRpm : 60 / w.rpm;
    if (a[0] <= 0) ws.burstLeft = 0;
  } else {
    ws.fireT = 60 / w.rpm;
  }
}

// PRNG con semilla (mulberry32) para que cliente y servidor calculen la misma dispersión.
export function seededRand(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function shotDirections(entityId, shot) {
  const w = WEAPONS[shot.wid];
  const rnd = seededRand((entityId * 73856093) ^ (shot.seq * 19349663) ^ 0x5bd1e995);
  const out = [];
  for (let i = 0; i < w.pellets; i++) {
    const r = shot.spread * Math.sqrt(rnd());
    const th = rnd() * Math.PI * 2;
    out.push(dirFromAngles(shot.yaw + r * Math.cos(th), shot.pitch + r * Math.sin(th)));
  }
  return out;
}
