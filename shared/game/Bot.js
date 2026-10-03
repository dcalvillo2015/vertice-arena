// Cerebro de los bots. Se ejecuta en el servidor (o en la sala local) y produce
// comandos de entrada idénticos a los de un jugador humano.
//
// Percepción honesta: un bot sólo conoce posiciones que ha VISTO (campo de visión +
// línea de visión), OÍDO (disparos/pasos, con error) o que un compañero ha avistado.
// Nunca dispara si no tiene línea de visión.
import { BTN, PLAYER } from '../constants.js';
import { WEAPONS } from '../weapons.js';
import { eyeHeight, bodyHeight, anglesFromDir } from '../physics.js';
import { currentWeapon } from './combat.js';
import { DIFFICULTY, PERSONALITIES } from './difficulty.js';
import { isTeamMode } from './modes.js';

const TAU = Math.PI * 2;
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const rand = Math.random;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const ROLES = ['attack', 'defend', 'roam'];
let roleCounter = 0;

export class BotBrain {
  constructor(room, ent, difficulty, personality) {
    this.room = room;
    this.e = ent;
    this.difficulty = DIFFICULTY[difficulty] ? difficulty : 'normal';
    const base = DIFFICULTY[this.difficulty];
    const pers = PERSONALITIES[personality] || PERSONALITIES.tactico;
    // Mezcla dificultad + personalidad + pequeña variación individual
    const jitter = () => 0.9 + rand() * 0.2;
    this.p = {
      ...base,
      reaction: base.reaction * jitter(),
      cover: clamp01(base.cover + pers.cover),
      flank: clamp01(base.flank + pers.flank),
      chase: clamp01(base.chase + pers.chase),
      rangeMul: pers.rangeMul,
    };
    this.role = ROLES[roleCounter++ % ROLES.length];
    this.reset();
  }

  reset() {
    this.mem = new Map();
    this.state = 'patrol';
    this.target = null;
    this.goal = null;
    this.path = null; this.pathIdx = 0; this.repathAt = 0; this.pathGoalKey = '';
    this.nextThink = 0; this.nextPerceive = 0; this.lastNoiseT = this.room.time;
    this.aimYaw = this.e.yaw; this.aimPitch = 0;
    this.errYaw = 0; this.errPitch = 0;
    this.strafeDir = 1; this.strafeUntil = 0;
    this.hold = null; this.holdUntil = 0;
    this.lookAt = null;
    this.stuckCheckT = 0; this.stuckPos = null; this.stuck = 0; this.jumpT = 0; this.unstickUntil = 0; this.unstickDir = 0;
    this.underFireT = -99;
    this.wantReload = false; this.wantSlot = -1;
    this.fireHeld = false; this.pulseT = 0; this.burstShots = 0; this.burstPauseUntil = 0;
    this.combatReposAt = 0; this.engageStart = 0; this.aimHead = false;
    this.retreatDecisionT = -99; this.retreating = false;
    this.sprintPath = rand() < this.p.sprint;
    this.hesitateUntil = 0;
    this.recentGoals = [];
  }

  onSpawn() {
    const keepMem = this.mem;
    this.reset();
    // Recuerdos borrosos de la vida anterior sólo para expertos
    if (this.difficulty === 'expert') for (const [k, m] of keepMem) { m.visible = false; m.aware = 0; this.mem.set(k, m); }
    this.aimYaw = this.e.yaw;
  }
  onDeath() { this.target = null; this.path = null; }
  onKill() { this.target = null; this.nextThink = 0; }

  memOf(id) {
    let m = this.mem.get(id);
    if (!m) { m = { id, aware: 0, visible: false, seen: null, seenT: -99, vel: [0, 0], heard: null, heardT: -99, threatT: -99, hitByMeT: -99 }; this.mem.set(id, m); }
    return m;
  }

  onDamaged(attacker) {
    const now = this.room.time;
    const m = this.memOf(attacker.id);
    const err = this.p.noiseErr * 0.4;
    m.heard = { x: attacker.ms.x + (rand() - 0.5) * err, z: attacker.ms.z + (rand() - 0.5) * err };
    m.heardT = now; m.threatT = now;
    m.aware = Math.max(m.aware, 0.55);
    this.underFireT = now;
    this.nextThink = Math.min(this.nextThink, now + this.p.reaction * 0.5);
    this.nextPerceive = now; // mira inmediatamente
    if (!this.target) this.lookAt = m.heard;
  }

  onNearMiss(shooter) {
    if (!this.room.isEnemy(this.e, shooter)) return;
    const now = this.room.time;
    const m = this.memOf(shooter.id);
    const err = this.p.noiseErr * 0.6;
    m.heard = { x: shooter.ms.x + (rand() - 0.5) * err, z: shooter.ms.z + (rand() - 0.5) * err };
    m.heardT = now; m.threatT = now;
    m.aware = Math.max(m.aware, 0.35);
    this.underFireT = now;
    if (!this.target) this.lookAt = m.heard;
  }

  onDealtDamage(victim) { this.memOf(victim.id).hitByMeT = this.room.time; }

  onShotFired(w) {
    const k = 1 - this.p.recoilControl;
    this.aimPitch += w.recoil.pitch * k;
    this.aimYaw += (rand() - 0.5) * 2 * w.recoil.yaw * k;
  }

  // ------------------------------------------------------------------ percepción
  perceive(dt) {
    const room = this.room, e = this.e, map = room.map, p = this.p, now = room.time;
    const [ex, ey, ez] = room.eye(e);
    const fx = -Math.sin(this.aimYaw), fz = -Math.cos(this.aimYaw);
    const halfFov = (p.fov * Math.PI / 180) / 2;
    for (const o of room.entities.values()) {
      if (o === e || !room.isEnemy(e, o)) continue;
      const m = this.memOf(o.id);
      if (!o.alive) { m.visible = false; m.aware = 0; continue; }
      const dx = o.ms.x - ex, dz = o.ms.z - ez;
      const d = Math.hypot(dx, dz);
      let vis = false, periphery = false;
      if (d < p.viewDist) {
        const ang = d > 1e-3 ? Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) : 0;
        if (d < 2.5 || ang <= halfFov) {
          periphery = ang > halfFov * 0.55;
          const bh = bodyHeight(o.ms.crouch);
          vis = map.los(ex, ey, ez, o.ms.x, o.ms.y + bh - 0.2, o.ms.z) || map.los(ex, ey, ez, o.ms.x, o.ms.y + bh * 0.55, o.ms.z);
        }
      }
      if (vis) {
        const moving = Math.hypot(o.ms.vx, o.ms.vz) > 1;
        let rate = dt / p.reaction;
        rate *= 1.2 - 0.6 * (d / p.viewDist);
        if (!moving && o.ms.crouch > 0.5) rate *= 0.55;
        if (o.buttons & BTN.FIRE) rate *= 1.6;
        if (periphery) rate *= 0.6;
        if (now - m.threatT < 1.5) rate *= 1.5;
        m.aware = Math.min(1.5, m.aware + rate);
        if (m.aware >= 1) {
          if (m.seen && now - m.seenT < 0.6) {
            const k = 1 / Math.max(0.05, now - m.seenT);
            m.vel = [(o.ms.x - m.seen.x) * k, (o.ms.z - m.seen.z) * k];
          }
          m.visible = true;
          m.seen = { x: o.ms.x, y: o.ms.y, z: o.ms.z };
          m.seenT = now;
          if (this.e.team >= 0) room.intel[this.e.team].set(o.id, { x: o.ms.x, z: o.ms.z, t: now, by: e.id });
        } else {
          m.visible = false;
          if (m.aware > 0.35) this.lookAt = { x: o.ms.x, z: o.ms.z };   // "¿Qué ha sido eso?"
        }
      } else {
        m.visible = false;
        m.aware = Math.max(0, m.aware - dt * 0.6);
      }
    }
    // Oído
    for (const n of room.noises) {
      if (n.t <= this.lastNoiseT || n.src === e.id) continue;
      const src = room.entities.get(n.src);
      if (!src || !room.isEnemy(e, src)) continue;
      const d = Math.hypot(n.x - e.ms.x, n.z - e.ms.z);
      if (d > n.r * p.hearing) continue;
      const m = this.memOf(n.src);
      if (m.visible) continue;
      const err = p.noiseErr * (0.3 + d / n.r);
      m.heard = { x: n.x + (rand() - 0.5) * err, z: n.z + (rand() - 0.5) * err };
      m.heardT = n.t;
      if (n.kind === 'shot') m.aware = Math.max(m.aware, 0.3);
    }
    this.lastNoiseT = now;
    // Información de compañeros (sólo difícil/experto)
    if (p.useIntel && e.team >= 0) {
      for (const [id, info] of room.intel[e.team]) {
        if (now - info.t > 2.5 || info.by === e.id) continue;
        const m = this.memOf(id);
        if (!m.visible && info.t > m.heardT) { m.heard = { x: info.x, z: info.z }; m.heardT = info.t; }
      }
    }
  }

  // ------------------------------------------------------------------ decisión
  selectTarget() {
    const room = this.room, e = this.e, now = room.time;
    let best = null, bestScore = -Infinity;
    const expertish = this.difficulty === 'hard' || this.difficulty === 'expert';
    for (const m of this.mem.values()) {
      if (!m.visible) continue;
      const o = room.entities.get(m.id);
      if (!o || !o.alive) continue;
      const d = Math.hypot(o.ms.x - e.ms.x, o.ms.z - e.ms.z);
      let s = 100 - d;
      if (this.target === o.id) s += 15;
      if (now - m.threatT < 2) s += 25;
      if (expertish) {
        // ¿Me está apuntando?
        const ax = e.ms.x - o.ms.x, az = e.ms.z - o.ms.z;
        const dd = Math.hypot(ax, az) || 1;
        const dot = (ax * -Math.sin(o.yaw) + az * -Math.cos(o.yaw)) / dd;
        if (dot > 0.95) s += 25;
        if (now - m.hitByMeT < 3) s += 20;  // rematar
      }
      if (this.difficulty === 'expert') {
        const eng = room.engagements.get(o.id);
        if (eng) for (const [bid, t] of eng) if (bid !== e.id && now - t < 1) s += 12; // fuego concentrado
        if (o.isBot === false) s += 5;
      }
      if (s > bestScore) { bestScore = s; best = o.id; }
    }
    return best;
  }

  think() {
    const room = this.room, e = this.e, p = this.p, now = room.time;
    const w = currentWeapon(e.ws);
    const ammo = e.ws.ammo[e.ws.slot];
    const hpFrac = e.health / 100;
    const prevTarget = this.target;
    this.target = this.selectTarget();
    if (this.target !== prevTarget && this.target) this.acquire();

    // Gestión de munición y armas
    this.wantReload = false;
    this.wantSlot = -1;
    const primary = e.ws.loadout[0] ? WEAPONS[e.ws.loadout[0]] : null;
    const pAmmo = e.ws.ammo[0];
    if (w.fire !== 'melee') {
      if (ammo[0] === 0 && ammo[1] > 0) {
        const pistolOk = e.ws.loadout[1] && e.ws.ammo[1][0] > 0;
        if (this.target && p.switchOnEmpty && e.ws.slot === 0 && pistolOk && this.distTo(this.target) < 25) this.wantSlot = 1;
        else this.wantReload = true;
      } else if (!this.target && ammo[0] < w.mag * p.reloadAt && ammo[1] > 0) {
        this.wantReload = true;
      }
      if (ammo[0] === 0 && ammo[1] === 0) {
        if (e.ws.slot === 0 && e.ws.loadout[1] && (e.ws.ammo[1][0] + e.ws.ammo[1][1]) > 0) this.wantSlot = 1;
        else if (e.ws.loadout[2]) this.wantSlot = 2;
      }
    }
    // Volver al arma principal cuando no hay peligro
    if (!this.target && e.ws.slot !== 0 && primary && (pAmmo[0] + pAmmo[1]) > 0) this.wantSlot = 0;
    if (e.ws.slot === 2 && primary && (pAmmo[0] + pAmmo[1]) > 0 && this.target && this.distTo(this.target) > 4) this.wantSlot = 0;

    if (this.target) {
      const o = room.entities.get(this.target);
      const d = this.distTo(this.target);
      this.registerEngagement(o.id);
      // ¿Huir?
      if (hpFrac < p.retreatHp) {
        if (now - this.retreatDecisionT > 3) { this.retreatDecisionT = now; this.retreating = rand() < p.retreatChance; }
      } else if (hpFrac > 0.75) this.retreating = false;

      if (this.retreating && d > 3) {
        const cov = this.findCover(o, { maxDist: 16, away: true });
        if (cov) { this.setState('retreat'); this.goTo(cov, 'cover'); this.hold = cov; this.holdUntil = now + 3; return; }
      }
      if (this.wantReload && rand() < p.cover && d > 6) {
        const cov = this.findCover(o, { maxDist: 10 });
        if (cov) { this.setState('cover'); this.goTo(cov, 'cover'); this.hold = cov; this.holdUntil = now + w.reload + 0.4; return; }
      }
      this.setState('engage');
      if (now >= this.combatReposAt) {
        this.combatReposAt = now + 1.5 + rand() * 2;
        this.chooseCombatPosition(o, d, w);
      }
      if (p.coordinate && e.team >= 0) room.pushes[e.team].push({ x: o.ms.x, z: o.ms.z, t: now, by: e.id, target: o.id });
      return;
    }

    // Sin objetivo visible: memoria reciente
    let recent = null, heard = null;
    for (const m of this.mem.values()) {
      const o = room.entities.get(m.id);
      if (!o || !o.alive) continue;
      if (m.seen && now - m.seenT < p.memory && (!recent || m.seenT > recent.seenT)) recent = m;
      if (m.heard && now - m.heardT < 4 && (!heard || m.heardT > heard.heardT)) heard = m;
    }

    if (this.retreating && hpFrac < 0.75 && this.hold) { this.setState('retreat'); return; }

    if (recent) {
      const chase = rand() < p.chase || hpFrac > 0.8 && this.difficulty !== 'easy' && rand() < 0.5;
      if (this.state === 'chase' || this.state === 'ambush') return; // mantener decisión
      if (chase) {
        let tx = recent.seen.x, tz = recent.seen.z;
        if (p.predict > 0) { tx += recent.vel[0] * 0.6 * p.predict; tz += recent.vel[1] * 0.6 * p.predict; }
        this.setState('chase');
        this.goTo({ x: tx, z: tz }, 'chase');
        this.lookAt = { x: recent.seen.x, z: recent.seen.z };
        if (p.coordinate && e.team >= 0) room.pushes[e.team].push({ x: tx, z: tz, t: now, by: e.id, target: recent.id });
      } else {
        const cov = this.findCover({ ms: { x: recent.seen.x, y: 0, z: recent.seen.z, crouch: 0 } }, { maxDist: 8, needLOS: true });
        this.setState('ambush');
        if (cov) { this.goTo(cov, 'cover'); this.hold = cov; }
        this.holdUntil = now + 2 + rand() * 2;
        this.lookAt = { x: recent.seen.x, z: recent.seen.z };
      }
      return;
    }

    if (heard) {
      if (this.state === 'investigate' || this.state === 'ambush') {
        if (this.state === 'ambush' && now < this.holdUntil) return;
        if (this.state === 'investigate' && this.goal && this.goalKey === 'heard' && now - heard.heardT > 0.5) return;
      }
      this.lookAt = heard.heard;
      if (rand() < p.ambush) {
        // Emboscada: esperar a cubierto mirando hacia el ruido
        const cov = this.findCover({ ms: { x: heard.heard.x, y: 0, z: heard.heard.z, crouch: 0 } }, { maxDist: 8, needLOS: true });
        if (cov) { this.setState('ambush'); this.goTo(cov, 'cover'); this.hold = cov; this.holdUntil = now + 2.5 + rand() * 2.5; return; }
      }
      this.setState('investigate');
      let gx = heard.heard.x, gz = heard.heard.z;
      if (p.flank > 0.5 && rand() < p.flank * 0.5) {
        const f = this.flankPoint(gx, gz, 8);
        if (f) { gx = f.x; gz = f.z; }
      }
      this.goTo({ x: gx, z: gz }, 'heard');
      return;
    }

    // Apoyo coordinado (expertos)
    if (p.coordinate && e.team >= 0) {
      const list = room.pushes[e.team] = room.pushes[e.team].filter((q) => now - q.t < 3);
      const q = list.find((q) => q.by !== e.id && Math.hypot(q.x - e.ms.x, q.z - e.ms.z) < 30);
      if (q && this.state !== 'support') {
        const f = this.flankPoint(q.x, q.z, 9) || q;
        this.setState('support');
        this.goTo(f, 'support');
        this.lookAt = { x: q.x, z: q.z };
        return;
      }
    }

    // Retirada para regenerar
    if (hpFrac < 0.5 && this.difficulty !== 'easy' && this.hold && now < this.holdUntil + 3) { this.setState('regen'); return; }

    // Patrulla / objetivos del modo
    if (this.state === 'patrol' && this.goalKey === 'via' && this.goal && this.reached(this.goal, 1.5) && this.finalGoal) {
      this.goTo(this.finalGoal, 'obj'); this.finalGoal = null; return;
    }
    if (this.state !== 'patrol' || !this.goal || this.reached(this.goal, 1.2) || !this.path) {
      if (this.state === 'patrol' && this.goal && this.reached(this.goal, 1.2) && now < this.holdUntil) return;
      this.setState('patrol');
      const g = this.pickObjective();
      if (this.via) { this.finalGoal = g; this.goTo(this.via, 'via'); }
      else this.goTo(g, 'obj');
      this.hold = null;
      this.holdUntil = now + 1 + rand() * (this.role === 'defend' ? 6 : 2);
      this.lookAt = null;
    } else if (p.reposition > 0 && rand() < p.reposition * 0.05) {
      this.goTo(this.pickObjective(), 'obj');
    }
  }

  setState(s) {
    if (this.state !== s) {
      this.state = s;
      if (s !== 'engage') this.engageStart = 0;
    }
  }

  acquire() {
    const p = this.p;
    const s = () => (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.5);
    this.errYaw = p.aimErrInit * s();
    this.errPitch = p.aimErrInit * 0.6 * s();
    this.engageStart = this.room.time;
    this.aimHead = rand() < p.headChance;
    this.burstShots = 0;
    if (p.hesitate > 0) this.hesitateUntil = this.room.time + rand() * p.hesitate;
  }

  registerEngagement(targetId) {
    let m = this.room.engagements.get(targetId);
    if (!m) { m = new Map(); this.room.engagements.set(targetId, m); }
    m.set(this.e.id, this.room.time);
  }

  engagedByOthers(targetId) {
    const m = this.room.engagements.get(targetId);
    if (!m) return 0;
    let n = 0;
    for (const [id, t] of m) if (id !== this.e.id && this.room.time - t < 1) n++;
    return n;
  }

  chooseCombatPosition(o, d, w) {
    const p = this.p, room = this.room;
    const pref = w.preferred * p.rangeMul;
    this.hold = null;
    // Flanqueo cuando un compañero ya está combatiendo al objetivo
    if (p.flank > 0 && d > 8 && this.engagedByOthers(o.id) > 0 && rand() < p.flank) {
      const f = this.flankPoint(o.ms.x, o.ms.z, Math.min(12, d * 0.7));
      if (f) { this.goTo(f, 'flank'); return; }
    }
    // Cobertura desde la que se pueda disparar
    if (rand() < p.cover) {
      const cov = this.findCover(o, { maxDist: 9, needLOS: true });
      if (cov) { this.goTo(cov, 'cover'); this.hold = cov; this.holdUntil = room.time + 2 + rand() * 2; return; }
    }
    if (w.fire === 'melee' || d > pref * 1.4) { this.goTo({ x: o.ms.x, z: o.ms.z }, 'advance'); return; }
    if (d < pref * 0.45 && w.kind === 'sniper') {
      const ax = this.e.ms.x - o.ms.x, az = this.e.ms.z - o.ms.z, l = Math.hypot(ax, az) || 1;
      this.goTo({ x: this.e.ms.x + ax / l * 8, z: this.e.ms.z + az / l * 8 }, 'backoff');
      return;
    }
    this.goal = null; this.path = null; // mantener posición y moverse lateralmente
  }

  flankPoint(tx, tz, dist) {
    const e = this.e, nav = this.room.nav;
    const ax = tx - e.ms.x, az = tz - e.ms.z, l = Math.hypot(ax, az) || 1;
    const side = rand() < 0.5 ? 1 : -1;
    for (const s of [side, -side]) {
      const px = tx + (-az / l) * dist * s - ax / l * 2;
      const pz = tz + (ax / l) * dist * s - az / l * 2;
      const c = nav.nearestWalkable(Math.floor(px / 2), Math.floor(pz / 2));
      if (c) return { x: (c[0] + 0.5) * 2, z: (c[1] + 0.5) * 2 };
    }
    return null;
  }

  // Busca un punto de cobertura respecto a la amenaza `o`.
  findCover(o, { maxDist = 10, needLOS = false, away = false } = {}) {
    const map = this.room.map, e = this.e;
    const tx = o.ms.x, tz = o.ms.z, ty = (o.ms.y || 0) + 1.6;
    const cands = [];
    for (const c of map.coverPoints) {
      const d = Math.hypot(c.x - e.ms.x, c.z - e.ms.z);
      if (d > maxDist) continue;
      const dt = Math.hypot(c.x - tx, c.z - tz);
      if (dt < 4) continue;
      // La normal de la cobertura debe apuntar lejos de la amenaza
      const dot = ((tx - c.x) * c.nx + (tz - c.z) * c.nz) / dt;
      if (dot > -0.2) continue;
      cands.push({ c, d, dt });
    }
    cands.sort((a, b) => a.d - b.d);
    let best = null, bestS = -Infinity;
    for (let i = 0; i < Math.min(cands.length, 24); i++) {
      const { c, d, dt } = cands[i];
      const hideY = c.low ? 0.95 : 1.5;
      if (map.los(tx, ty, tz, c.x, hideY, c.z)) continue;            // no protege
      let s = -d;
      if (needLOS) {
        // Cobertura baja: de pie puedo disparar. Alta: asomarse desde el borde (aprox. con LOS desde el punto desplazado)
        const peek = c.low ? map.los(c.x, 1.62, c.z, tx, ty - 0.3, tz)
          : map.los(c.x + c.nz * 1.1, 1.62, c.z - c.nx * 1.1, tx, ty - 0.3, tz) || map.los(c.x - c.nz * 1.1, 1.62, c.z + c.nx * 1.1, tx, ty - 0.3, tz);
        if (!peek) continue;
        s += c.low ? 3 : 0;
      }
      if (away) s += dt * 0.6;
      if (s > bestS) { bestS = s; best = c; }
    }
    return best ? { x: best.x, z: best.z, low: best.low } : null;
  }

  pickObjective() {
    const room = this.room, map = room.map, e = this.e;
    const team = e.team;
    let pool;
    if (isTeamMode(room.settings.mode) && team >= 0) {
      const own = [...map.patrol, ...map.zones].filter((q) => q.side === team);
      const enemy = [...map.patrol, ...map.zones].filter((q) => q.side !== team);
      if (this.role === 'attack') pool = [...enemy, ...map.zones, map.center];
      else if (this.role === 'defend') pool = [...own, ...map.zones.filter((q) => q.side === team)];
      else pool = [...map.patrol, ...map.zones, map.center];
    } else {
      pool = [...map.patrol, ...map.zones, map.center, ...map.spawns.ffa];
    }
    pool = pool.filter((q) => Math.hypot(q.x - e.ms.x, q.z - e.ms.z) > 6 && !this.recentGoals.includes(q));
    // Exploración: a veces visitan cualquier rincón del mapa (rutas alternativas, esquinas)
    const explore = this.role === 'roam' || !isTeamMode(room.settings.mode) ? 0.4 : 0.2;
    if (!pool.length || rand() < explore) return room.nav.randomPoint();
    const g = pick(pool);
    // Rutas alternativas: pasar por un punto intermedio que no esté en la línea directa
    this.via = null;
    if (rand() < 0.45) {
      const dg = Math.hypot(g.x - e.ms.x, g.z - e.ms.z);
      const vias = map.patrol.filter((q) => {
        const a = Math.hypot(q.x - e.ms.x, q.z - e.ms.z), b = Math.hypot(g.x - q.x, g.z - q.z);
        return a > 5 && b > 5 && a + b < dg * 1.9 && a + b > dg * 1.15;
      });
      if (vias.length) this.via = pick(vias);
    }
    this.recentGoals.push(g);
    if (this.recentGoals.length > 3) this.recentGoals.shift();
    // Defensores: buscar una cobertura cerca del punto
    if (this.role === 'defend' && rand() < this.p.cover) {
      const near = map.coverPoints.filter((c) => Math.hypot(c.x - g.x, c.z - g.z) < 5);
      if (near.length) { const c = pick(near); return { x: c.x, z: c.z }; }
    }
    return { x: g.x + (rand() - 0.5) * 1.5, z: g.z + (rand() - 0.5) * 1.5 };
  }

  goTo(g, key) {
    if (!g) return;
    const sameGoal = this.goal && Math.hypot(this.goal.x - g.x, this.goal.z - g.z) < 1;
    this.goal = { x: g.x, z: g.z };
    this.goalKey = key;
    if (!sameGoal) { this.path = null; this.repathAt = 0; }
  }

  reached(g, r = 0.6) { return Math.hypot(g.x - this.e.ms.x, g.z - this.e.ms.z) < r; }

  distTo(id) {
    const o = this.room.entities.get(id);
    return o ? Math.hypot(o.ms.x - this.e.ms.x, o.ms.z - this.e.ms.z) : Infinity;
  }

  // ------------------------------------------------------------------ actualización por tick
  update(dt) {
    const room = this.room, e = this.e, p = this.p, now = room.time;
    const cmd = { mx: 0, mz: 0, b: 0, y: this.aimYaw, p: this.aimPitch, w: -1, r: false };
    if (!e.alive) return cmd;

    if (now >= this.nextPerceive) {
      const pdt = p.perceiveInt + (now - this.nextPerceive);
      this.perceive(Math.min(pdt, 0.5));
      this.nextPerceive = now + p.perceiveInt * (0.85 + rand() * 0.3);
    }
    if (now >= this.nextThink) {
      this.think();
      this.nextThink = now + p.thinkInt * (0.8 + rand() * 0.4);
    }
    // Validar objetivo (podría haber muerto o desaparecido entre decisiones)
    let tgt = this.target ? room.entities.get(this.target) : null;
    if (tgt && (!tgt.alive || !this.memOf(tgt.id).visible)) { tgt = null; }

    const w = currentWeapon(e.ws);
    const [ex, ey, ez] = room.eye(e);

    // --- Movimiento
    let wx = 0, wz = 0, moving = false;
    const holding = this.hold && this.reached(this.hold, 0.7) && now < this.holdUntil;
    if (this.goal && !holding) {
      if (!this.path || now >= this.repathAt) {
        this.path = p.smartPath ? room.nav.findPath(e.ms.x, e.ms.z, this.goal.x, this.goal.z)
          : this.rawPath(this.goal);
        this.pathIdx = 0;
        this.repathAt = now + (tgt ? 0.8 : 2.5) + rand();
      }
      if (this.path && this.pathIdx < this.path.length) {
        let wp = this.path[this.pathIdx];
        while (wp && Math.hypot(wp.x - e.ms.x, wp.z - e.ms.z) < 0.55) {
          this.pathIdx++;
          wp = this.path[this.pathIdx];
        }
        if (wp) {
          const dx = wp.x - e.ms.x, dz = wp.z - e.ms.z, l = Math.hypot(dx, dz) || 1;
          wx = dx / l; wz = dz / l; moving = true;
        } else if (this.goalKey !== 'cover') {
          this.goal = null; this.path = null;
        }
      }
    }
    // Movimiento lateral en combate
    if (tgt && !holding && (!moving || this.goalKey === 'advance')) {
      if (now > this.strafeUntil) {
        this.strafeDir = rand() < 0.5 ? -1 : 1;
        this.strafeUntil = now + 0.35 + rand() * 0.9;
        this.strafeActive = rand() < p.strafe;
      }
      if (this.strafeActive) {
        const tx = tgt.ms.x - e.ms.x, tz = tgt.ms.z - e.ms.z, l = Math.hypot(tx, tz) || 1;
        const sx = -tz / l * this.strafeDir, sz = tx / l * this.strafeDir;
        if (!room.map.collides(e.ms.x + sx * 0.8, e.ms.z + sz * 0.8, e.ms.y)) {
          wx = wx * 0.6 + sx; wz = wz * 0.6 + sz; moving = true;
        } else this.strafeDir *= -1;
      }
    }
    // Desatascar
    if (now < this.unstickUntil) {
      wx = Math.cos(this.unstickDir); wz = Math.sin(this.unstickDir); moving = true;
    }
    if (now - this.stuckCheckT > 1) {
      if (this.stuckPos && moving && Math.hypot(e.ms.x - this.stuckPos[0], e.ms.z - this.stuckPos[1]) < 0.35) {
        this.stuck++;
        this.jumpT = now + 0.1;
        this.unstickDir = rand() * TAU;
        this.unstickUntil = now + 0.4;
        if (this.stuck >= 2) { this.path = null; this.repathAt = 0; }
        if (this.stuck >= 4) { this.goal = null; this.stuck = 0; this.state = 'patrol'; this.nextThink = 0; }
      } else this.stuck = 0;
      this.stuckPos = [e.ms.x, e.ms.z];
      this.stuckCheckT = now;
    }
    if (now < this.hesitateUntil) moving = false; // los bots fáciles se quedan "pensando"

    // --- Puntería
    let wantYaw = this.aimYaw, wantPitch = 0, turnMul = 0.6;
    let aimed = false, d = 0;
    if (tgt) {
      const bh = bodyHeight(tgt.ms.crouch);
      const aimY = tgt.ms.y + (this.aimHead || (p.prefersHeadHeight && w.kind === 'sniper') ? bh - 0.2 : bh * 0.62);
      let tx = tgt.ms.x, tz = tgt.ms.z;
      if (p.predict > 0) { tx += tgt.ms.vx * 0.06 * p.predict; tz += tgt.ms.vz * 0.06 * p.predict; }
      const dx = tx - ex, dy = aimY - ey, dz = tz - ez;
      d = Math.hypot(dx, dz);
      const [ty, tp] = anglesFromDir(dx, dy, dz);
      // El error de puntería decae con el tiempo de seguimiento y crece si el objetivo se mueve lateralmente
      const decay = Math.exp(-p.aimErrDecay * dt);
      this.errYaw *= decay; this.errPitch *= decay;
      const lat = Math.abs((tgt.ms.vx * dz - tgt.ms.vz * dx) / Math.max(1, d));
      const wob = p.aimErrMin * (1 + lat * p.trackPenalty * 25);
      const errY = this.errYaw + Math.sin(now * 3.1 + e.id) * wob;
      const errP = this.errPitch + Math.cos(now * 2.3 + e.id * 2) * wob * 0.6;
      wantYaw = ty + errY; wantPitch = tp + errP;
      turnMul = 1;
      const tol = Math.atan2(0.35, Math.max(1, d)) * p.fireTol;
      const offYaw = Math.abs(wrap(this.aimYaw - ty)), offPitch = Math.abs(this.aimPitch - tp);
      aimed = offYaw < tol && offPitch < tol * 1.4;
    } else if (this.lookAt) {
      const dx = this.lookAt.x - e.ms.x, dz = this.lookAt.z - e.ms.z;
      if (Math.hypot(dx, dz) > 0.5) wantYaw = Math.atan2(-dx, -dz);
      if (moving && now - this.underFireT > 2 && this.state === 'patrol') wantYaw = Math.atan2(-wx, -wz);
    } else if (moving) {
      wantYaw = Math.atan2(-wx, -wz);
    }
    const maxTurn = p.turnSpeed * turnMul * dt;
    const dyaw = wrap(wantYaw - this.aimYaw);
    this.aimYaw = wrap(this.aimYaw + Math.max(-maxTurn, Math.min(maxTurn, dyaw * Math.min(1, dt * 12))));
    const dp = wantPitch - this.aimPitch;
    this.aimPitch += Math.max(-maxTurn, Math.min(maxTurn, dp * Math.min(1, dt * 10)));
    this.aimPitch = Math.max(-1.3, Math.min(1.3, this.aimPitch));

    // --- Disparo
    let fire = false;
    const ammo = e.ws.ammo[e.ws.slot];
    const inRange = w.fire === 'melee' ? d < w.range : (w.kind === 'shotgun' ? d < 24 : d < p.viewDist + 10);
    if (tgt && aimed && inRange && now >= this.hesitateUntil && (ammo[0] > 0 || w.fire === 'melee') && e.ws.switchT === 0) {
      if (w.fire === 'auto') {
        if (p.burstControl && d > 18) {
          if (now >= this.burstPauseUntil) {
            fire = true;
            if (e.ws.fireT === 0 && this.fireHeld) this.burstShots++;
            if (this.burstShots >= 3 + Math.floor(rand() * 3)) { this.burstShots = 0; this.burstPauseUntil = now + 0.22 + rand() * 0.15; fire = false; }
          }
        } else fire = true;
      } else {
        // Semiautomáticas: pulsar y soltar
        const rate = w.kind === 'sniper' ? 1.1 : p.semiRate;
        const sniperReady = w.kind !== 'sniper' || e.ws.adsT > w.adsTime * 0.9 || d < 8;
        if (!this.fireHeld && now >= this.pulseT && sniperReady) { fire = true; this.pulseT = now + 1 / rate; }
      }
    }
    this.fireHeld = fire;

    // --- Botones
    let b = 0;
    if (fire) b |= BTN.FIRE;
    const wantAds = tgt && w.fire !== 'melee' && (w.kind === 'sniper' || (this.difficulty !== 'easy' && d > 14 && w.kind !== 'shotgun'));
    if (wantAds) b |= BTN.ADS;
    const sprint = moving && !tgt && (this.sprintPath || this.state === 'chase' || this.state === 'retreat') && this.state !== 'ambush';
    if (sprint) b |= BTN.SPRINT;
    const atLowCover = this.hold && this.hold.low && this.reached(this.hold, 0.8);
    const crouch = (holding && (atLowCover && (!fire || e.ws.reloadT > 0 || now - this.underFireT < 0.6))) ||
      (this.state === 'ambush' && holding && !tgt);
    if (crouch) b |= BTN.CROUCH;
    if (now < this.jumpT) b |= BTN.JUMP;

    // Dirección de movimiento en ejes locales (relativa a la vista)
    if (moving) {
      const l = Math.hypot(wx, wz) || 1;
      wx /= l; wz /= l;
      const fx = -Math.sin(this.aimYaw), fz = -Math.cos(this.aimYaw);
      const rx = Math.cos(this.aimYaw), rz = -Math.sin(this.aimYaw);
      cmd.mz = wx * fx + wz * fz;
      cmd.mx = wx * rx + wz * rz;
    }
    cmd.b = b;
    cmd.y = this.aimYaw;
    cmd.p = this.aimPitch;
    if (this.wantSlot >= 0 && this.wantSlot !== e.ws.slot) cmd.w = this.wantSlot;
    if (this.wantReload && e.ws.reloadT === 0) { cmd.r = true; this.wantReload = false; }
    return cmd;
  }

  // Ruta "torpe" para bots fáciles: A* sin suavizar (sigue el centro de cada celda).
  rawPath(goal) {
    const path = this.room.nav.findPath(this.e.ms.x, this.e.ms.z, goal.x, goal.z);
    if (!path || path.length < 2) return path;
    // Añadir pequeñas desviaciones para un movimiento menos eficiente
    return path.map((q, i) => (i === path.length - 1 ? q : { x: q.x + (rand() - 0.5) * 0.6, z: q.z + (rand() - 0.5) * 0.6 }));
  }
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
