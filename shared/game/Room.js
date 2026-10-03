// Sala de juego con simulación autoritativa. Independiente del transporte:
// recibe mensajes con handleMessage() y envía con this.send(clientId, msg).
import {
  TICK_RATE, SNAPSHOT_RATE, INTERP_DELAY, MAX_LAG_COMP, HEALTH, RESPAWN_TIME, SPAWN_PROTECT,
  MODES, MODE_INFO, TEAM, BTN, DIFFICULTIES,
} from '../constants.js';
import { MapData } from '../MapData.js';
import { MAPS } from '../maps.js';
import { NavGrid } from '../nav.js';
import { createMoveState, stepMove, eyeHeight, bodyHeight, rayVsPlayer } from '../physics.js';
import { WEAPONS, PRIMARIES, damageAt } from '../weapons.js';
import { createWeaponState, weaponStep, currentWeapon, shotDirections } from './combat.js';
import { isTeamMode, assignTeams, teamForJoin, loadoutFor, onKill, computeWinner } from './modes.js';
import { BotBrain } from './Bot.js';
import { DIFFICULTY, PERSONALITIES, BOT_NAMES } from './difficulty.js';

const WEAPON_IDS = Object.keys(WEAPONS);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function normalizeSettings(s = {}) {
  const mode = Object.values(MODES).includes(s.mode) ? s.mode : MODES.TDM;
  const info = MODE_INFO[mode];
  const maxPlayers = clampInt(s.maxPlayers, 2, 12, 8);
  return {
    mode,
    mapId: MAPS[s.mapId] ? s.mapId : 'patio',
    maxPlayers,
    botDifficulty: [...DIFFICULTIES, 'mixed'].includes(s.botDifficulty) ? s.botDifficulty : 'normal',
    fillBots: s.fillBots !== false,
    botCount: clampInt(s.botCount, 0, 11, 0),
    scoreLimit: clampInt(s.scoreLimit, 0, 200, info.scoreLimit),
    timeLimit: clampInt(s.timeLimit, 60, 1800, info.timeLimit),
  };
}

function clampInt(v, a, b, def) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(a, Math.min(b, n));
}

export class Room {
  constructor({ code, settings, send, onEmpty }) {
    this.code = code;
    this.settings = normalizeSettings(settings);
    this.send = send;
    this.onEmpty = onEmpty || (() => {});
    this.clients = new Map();   // clientId -> { id, name, entityId, primary }
    this.hostId = null;
    this.entities = new Map();  // entityId -> entidad
    this.nextEntityId = 1;
    this.phase = 'lobby';
    this.time = 0;
    this.noises = [];
    this.intel = [new Map(), new Map()];  // información compartida por equipo (bots)
    this.engagements = new Map();         // objetivo -> Map(botId -> t)
    this.pushes = [[], []];               // peticiones de apoyo de bots expertos
    this.events = [];
    this.privateEvents = new Map();
    this.snapAcc = 0;
    this.boardAcc = 0;
    this.pingAcc = 0;
    this.teamScore = [0, 0];
    this.loadMap();
  }

  loadMap() {
    this.map = new MapData(this.settings.mapId);
    this.nav = new NavGrid(this.map);
  }

  // ---------------------------------------------------------------- clientes
  addClient(client) {
    const c = { id: client.id, name: sanitizeName(client.name), entityId: null, primary: client.primary || 'kestrel' };
    this.clients.set(c.id, c);
    if (!this.hostId) this.hostId = c.id;
    if (this.phase === 'lobby') {
      this.broadcastLobby();
    } else {
      // Unirse a partida en curso: sustituye a un bot si la sala está llena.
      const humans = [...this.entities.values()].filter((e) => !e.isBot).length;
      const bots = [...this.entities.values()].filter((e) => e.isBot);
      let team = teamForJoin(this);
      if (humans + bots.length >= this.settings.maxPlayers && bots.length) {
        const pref = bots.filter((b) => team < 0 || b.team === team || this.settings.mode === MODES.TDM_BOTS);
        const victim = (pref.length ? pref : bots)[pref.length ? pref.length - 1 : bots.length - 1];
        if (this.settings.mode !== MODES.TDM_BOTS && team >= 0) team = victim.team;
        this.removeEntity(victim.id);
      }
      const e = this.createEntity({ name: c.name, isBot: false, team, clientId: c.id, primary: c.primary });
      c.entityId = e.id;
      if (this.phase === 'playing') this.spawn(e); else e.respawnAt = 0;
      this.sendStart(c);
      this.broadcastRoster();
    }
    return c;
  }

  removeClient(clientId) {
    const c = this.clients.get(clientId);
    if (!c) return;
    this.clients.delete(clientId);
    if (c.entityId) {
      const e = this.entities.get(c.entityId);
      this.removeEntity(c.entityId);
      // Rellenar con bot si la partida sigue
      if (e && this.phase !== 'lobby' && this.settings.fillBots && this.clients.size > 0) {
        const bot = this.createBot(e.team, this.entities.size);
        this.spawn(bot);
      }
      this.broadcastRoster();
    }
    if (this.hostId === clientId) this.hostId = this.clients.keys().next().value || null;
    if (this.clients.size === 0) { this.onEmpty(this); return; }
    if (this.phase === 'lobby') this.broadcastLobby();
  }

  handleMessage(clientId, msg) {
    const c = this.clients.get(clientId);
    if (!c || !msg) return;
    const e = c.entityId ? this.entities.get(c.entityId) : null;
    switch (msg.t) {
      case 'input':
        if (e && Array.isArray(msg.c)) {
          for (const a of msg.c) {
            if (!Array.isArray(a) || e.queue.length > 120) break;
            e.queue.push({
              s: a[0] | 0, mx: +a[1] || 0, mz: +a[2] || 0, b: a[3] | 0, y: +a[4] || 0, p: +a[5] || 0,
              dt: Math.max(0, Math.min(0.05, +a[6] || 0)), w: a[7] ?? -1, r: !!a[8],
            });
          }
        }
        break;
      case 'pong':
        if (e && typeof msg.st === 'number') e.ping = Math.max(0, Math.min(1, this.time - msg.st));
        break;
      case 'class':
        if (PRIMARIES.includes(msg.w)) { c.primary = msg.w; if (e) { e.primary = msg.w; if (!e.alive) e.pendingLoadout = true; } }
        break;
      case 'start':
        if (clientId === this.hostId && this.phase === 'lobby') this.startMatch();
        break;
      case 'settings':
        if (clientId === this.hostId && this.phase === 'lobby') {
          this.settings = normalizeSettings({ ...this.settings, ...msg.settings });
          this.loadMap();
          this.broadcastLobby();
        }
        break;
      case 'restart':
        if (clientId === this.hostId && this.phase === 'ended') this.restartMatch();
        break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- entidades
  createEntity({ name, isBot, team, clientId = null, primary = 'kestrel', difficulty = null, personality = null }) {
    const id = this.nextEntityId++;
    const e = {
      id, name, isBot, team, clientId, primary, difficulty, personality,
      alive: false, health: HEALTH.max,
      ms: createMoveState(0, 0, 0), yaw: 0, pitch: 0, buttons: 0, sprinting: false,
      ws: createWeaponState([primary, 'aguja', 'colmillo']),
      queue: [], budget: 0, ack: 0, ping: 0,
      kills: 0, deaths: 0, assists: 0, score: 0,
      shots: 0, hits: 0, headshots: 0, damage: 0,
      damageBy: new Map(), lastDamageT: -99, respawnAt: 0, protectUntil: 0,
      spawnCount: 0, spawnYaw: 0, gunLevel: 0, killerId: 0, stepAcc: 0,
      hist: [], pendingLoadout: false,
    };
    this.entities.set(id, e);
    if (isBot) e.brain = new BotBrain(this, e, difficulty, personality);
    return e;
  }

  createBot(team, index) {
    let diff = this.settings.botDifficulty;
    if (diff === 'mixed') diff = DIFFICULTIES[index % DIFFICULTIES.length];
    const pkeys = Object.keys(PERSONALITIES);
    const personality = pkeys[(index * 7 + this.nextEntityId) % pkeys.length];
    const prims = PERSONALITIES[personality].primaries;
    const primary = prims[Math.floor(Math.random() * prims.length)];
    const used = new Set([...this.entities.values()].map((x) => x.name));
    let name = BOT_NAMES.find((n) => !used.has(n)) || `Bot${this.nextEntityId}`;
    return this.createEntity({ name, isBot: true, team, primary, difficulty: diff, personality });
  }

  removeEntity(id) {
    this.entities.delete(id);
    for (const m of this.intel) m.delete(id);
    this.engagements.delete(id);
  }

  giveLoadout(e) {
    const lo = loadoutFor(this, e);
    const prevSlot = e.ws.slot;
    e.ws = createWeaponState(lo);
    if (e.alive && this.settings.mode === MODES.GUN) {
      e.ws.switchT = currentWeapon(e.ws).switchTime;
    } else if (prevSlot && lo[prevSlot]) {
      // mantener ranura si existe
    }
  }

  isEnemy(a, b) {
    if (a === b) return false;
    if (a.team < 0 || b.team < 0) return true;
    return a.team !== b.team;
  }

  eye(e) { return [e.ms.x, e.ms.y + eyeHeight(e.ms.crouch), e.ms.z]; }

  // ---------------------------------------------------------------- partida
  startMatch() {
    // Crear entidades de humanos y bots
    this.entities.clear();
    this.nextEntityId = 1;
    const humans = [];
    for (const c of this.clients.values()) {
      const e = this.createEntity({ name: c.name, isBot: false, team: TEAM.NONE, clientId: c.id, primary: c.primary });
      c.entityId = e.id;
      humans.push(e);
    }
    let botCount = this.settings.botCount;
    if (this.settings.fillBots && this.settings.mode !== MODES.TDM_BOTS) {
      botCount = Math.max(botCount, this.settings.maxPlayers - humans.length);
    }
    botCount = Math.min(botCount, 12 - humans.length);
    const bots = [];
    for (let i = 0; i < botCount; i++) bots.push(this.createBot(TEAM.NONE, i));
    assignTeams(this, humans, bots);
    this.beginRound();
  }

  restartMatch() {
    for (const e of this.entities.values()) {
      e.kills = e.deaths = e.assists = e.score = 0;
      e.shots = e.hits = e.headshots = e.damage = 0;
      e.gunLevel = 0; e.gunKills = 0;
      if (e.brain) e.brain.reset();
    }
    this.beginRound();
  }

  beginRound() {
    this.teamScore = [0, 0];
    this.time = 0;
    this.noises = [];
    this.intel = [new Map(), new Map()];
    this.engagements = new Map();
    this.phase = 'countdown';
    this.countdown = 3;
    this.timeLeft = this.settings.timeLimit;
    this.endInfo = null;
    for (const e of this.entities.values()) { e.queue = []; this.spawn(e); }
    for (const c of this.clients.values()) this.sendStart(c);
    this.broadcastRoster();
    this.sendBoard();
  }

  sendStart(c) {
    this.send(c.id, {
      t: 'start', code: this.code, settings: this.settings, you: c.entityId, host: this.hostId === c.id,
      roster: this.roster(), phase: this.phase,
    });
  }

  roster() {
    return [...this.entities.values()].map((e) => ({
      id: e.id, name: e.name, team: e.team, bot: e.isBot, diff: e.difficulty,
      pers: e.personality ? PERSONALITIES[e.personality].label : null,
    }));
  }

  broadcastRoster() { this.broadcast({ t: 'roster', roster: this.roster() }); }

  broadcastLobby() {
    const players = [...this.clients.values()].map((c) => ({ id: c.id, name: c.name, host: c.id === this.hostId }));
    for (const c of this.clients.values()) {
      this.send(c.id, { t: 'lobby', code: this.code, settings: this.settings, players, host: c.id === this.hostId, you: c.id });
    }
  }

  broadcast(msg) { for (const c of this.clients.values()) this.send(c.id, msg); }

  chooseSpawn(e) {
    const teams = isTeamMode(this.settings.mode);
    let cands = teams ? this.map.spawns[e.team].slice() : this.map.spawns.ffa.slice();
    if (teams) cands.push(...this.map.patrol.filter((p) => p.side === e.team));
    else cands.push(...this.map.patrol);
    const enemies = [...this.entities.values()].filter((o) => o.alive && o !== e && this.isEnemy(e, o));
    const others = [...this.entities.values()].filter((o) => o.alive && o !== e);
    let best = null, bestScore = -Infinity;
    for (const c of cands) {
      let minD = 40, visible = false;
      for (const o of enemies) {
        const d = Math.hypot(o.ms.x - c.x, o.ms.z - c.z);
        if (d < minD) minD = d;
        if (!visible && d < 45) {
          const [ex, ey, ez] = this.eye(o);
          if (this.map.los(ex, ey, ez, c.x, 1.5, c.z)) visible = true;
        }
      }
      let occupied = false;
      for (const o of others) if (Math.hypot(o.ms.x - c.x, o.ms.z - c.z) < 1.2) occupied = true;
      const score = minD - (visible ? 30 : 0) - (occupied ? 100 : 0) + Math.random() * 4
        + (teams && this.map.spawns[e.team].includes(c) ? 6 : 0);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best || this.map.spawns.ffa[0];
  }

  spawn(e) {
    const p = this.chooseSpawn(e);
    e.ms = createMoveState(p.x, 0, p.z);
    e.yaw = Math.atan2(-(this.map.center.x - p.x), -(this.map.center.z - p.z));
    e.pitch = 0;
    e.spawnYaw = e.yaw;
    e.spawnCount++;
    e.alive = true;
    e.health = HEALTH.max;
    e.protectUntil = this.time + SPAWN_PROTECT;
    e.lastDamageT = -99;
    e.damageBy.clear();
    e.pendingLoadout = false;
    e.ws = createWeaponState(loadoutFor(this, e));
    e.hist = [];
    e.queue = [];
    if (e.brain) e.brain.onSpawn();
  }

  // ---------------------------------------------------------------- bucle
  update(dt) {
    if (this.phase === 'lobby') return;
    this.time += dt;

    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.phase = 'playing';
    }

    if (this.phase === 'playing') {
      this.timeLeft -= dt;
      // Bots
      for (const e of this.entities.values()) {
        if (!e.isBot) continue;
        const cmd = e.brain.update(dt);
        this.applyCommand(e, cmd, dt);
      }
      // Humanos
      for (const e of this.entities.values()) {
        if (e.isBot) continue;
        e.budget = Math.min(e.budget + dt, 0.25);
        while (e.queue.length && e.queue[0].dt <= e.budget + 1e-6) {
          const cmd = e.queue.shift();
          e.budget -= cmd.dt;
          this.applyCommand(e, cmd, cmd.dt);
        }
      }
      // Vida, regeneración y reapariciones
      for (const e of this.entities.values()) {
        if (e.alive) {
          if (e.health < HEALTH.max && this.time - e.lastDamageT > HEALTH.regenDelay) {
            e.health = Math.min(HEALTH.max, e.health + HEALTH.regenRate * dt);
          }
        } else if (this.time >= e.respawnAt) {
          this.spawn(e);
          this.events.push({ k: 'spawn', e: e.id });
        }
        // Historial para compensación de lag
        e.hist.push({ t: this.time, x: e.ms.x, y: e.ms.y, z: e.ms.z, c: e.ms.crouch });
        if (e.hist.length > 16) e.hist.shift();
      }
      this.noises = this.noises.filter((n) => this.time - n.t < 1.0);
      if (this.timeLeft <= 0) this.endMatch('time');
    } else if (this.phase === 'countdown') {
      // Durante la cuenta atrás se confirman los comandos sin mover a nadie.
      for (const e of this.entities.values()) {
        if (e.isBot) continue;
        for (const cmd of e.queue) { e.ack = cmd.s; e.yaw = cmd.y; e.pitch = cmd.p; }
        e.queue.length = 0;
        e.budget = 0;
      }
    }

    // Red
    this.snapAcc += dt;
    if (this.snapAcc >= 1 / SNAPSHOT_RATE - 1e-6) {
      this.snapAcc = 0;
      this.sendSnapshots();
    }
    this.boardAcc += dt;
    if (this.boardAcc >= 1) { this.boardAcc = 0; this.sendBoard(); }
    this.pingAcc += dt;
    if (this.pingAcc >= 2) { this.pingAcc = 0; this.broadcast({ t: 'ping', st: this.time }); }
  }

  applyCommand(e, cmd, dt) {
    e.yaw = cmd.y;
    e.pitch = Math.max(-1.5, Math.min(1.5, cmd.p));
    e.buttons = cmd.b;
    if (cmd.s !== undefined) e.ack = cmd.s;
    if (!e.alive || dt <= 0) return;
    const w = currentWeapon(e.ws);
    e.sprinting = stepMove(e.ms, cmd, dt, this.map, w.moveMul);
    const shots = [];
    weaponStep(e.ws, e.ms, cmd, dt, shots);
    for (const s of shots) this.fireShot(e, s);
    // Ruido de pasos (los bots pueden oír a quien corre)
    const speed = Math.hypot(e.ms.vx, e.ms.vz);
    if (e.ms.onGround && speed > 3.5 && e.ms.crouch < 0.5) {
      e.stepAcc += dt;
      if (e.stepAcc > 0.45) {
        e.stepAcc = 0;
        this.noises.push({ x: e.ms.x, z: e.ms.z, r: e.sprinting ? 14 : 7, src: e.id, t: this.time, kind: 'step' });
      }
    }
  }

  rewound(t, back) {
    if (back <= 0 || t.hist.length < 2) return { x: t.ms.x, y: t.ms.y, z: t.ms.z, crouch: t.ms.crouch };
    const target = this.time - back;
    const h = t.hist;
    if (target <= h[0].t) return { x: h[0].x, y: h[0].y, z: h[0].z, crouch: h[0].c };
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (a.t <= target && target <= b.t) {
        const k = (target - a.t) / Math.max(1e-6, b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, crouch: a.c + (b.c - a.c) * k };
      }
    }
    return { x: t.ms.x, y: t.ms.y, z: t.ms.z, crouch: t.ms.crouch };
  }

  fireShot(e, shot) {
    const w = WEAPONS[shot.wid];
    e.shots++;
    e.protectUntil = 0; // disparar cancela la protección de aparición
    const [ox, oy, oz] = this.eye(e);
    const back = e.isBot ? 0 : Math.min(MAX_LAG_COMP, e.ping / 2 + INTERP_DELAY);
    this.noises.push({ x: ox, z: oz, r: w.loud, src: e.id, t: this.time, kind: 'shot' });
    if (e.brain) e.brain.onShotFired(w);

    if (w.fire === 'melee') {
      this.meleeAttack(e, w, ox, oy, oz, back);
      this.events.push({ k: 'shot', e: e.id, w: w.id, o: [r2(ox), r2(oy), r2(oz)], h: [] });
      return;
    }

    const dirs = shotDirections(e.id, shot);
    const perTarget = new Map();
    const ends = [];
    const targets = [];
    for (const t of this.entities.values()) {
      if (t === e || !t.alive || !this.isEnemy(e, t)) continue;
      targets.push({ t, pos: this.rewound(t, back) });
    }
    for (let i = 0; i < dirs.length; i++) {
      const [dx, dy, dz] = dirs[i];
      const wall = this.map.raycast(ox, oy, oz, dx, dy, dz, w.range);
      const wallDist = wall ? wall.dist : w.range;
      let best = null;
      for (const tg of targets) {
        const p = tg.pos;
        // descarte rápido: distancia del rayo al centro del objetivo
        const lx = p.x - ox, ly = p.y + 1 - oy, lz = p.z - oz;
        const proj = lx * dx + ly * dy + lz * dz;
        if (proj < 0 || proj > wallDist + 1) continue;
        const perp2 = lx * lx + ly * ly + lz * lz - proj * proj;
        if (perp2 > 2.5 * 2.5) continue;
        const hit = rayVsPlayer(ox, oy, oz, dx, dy, dz, wallDist, p);
        if (hit && (!best || hit.dist < best.hit.dist)) best = { tg, hit };
        // Disparo cercano: los bots reaccionan
        if (!hit && perp2 < 2.5 * 2.5 && tg.t.brain) tg.t.brain.onNearMiss(e);
      }
      const dist = best ? best.hit.dist : wallDist;
      if (i < 4) ends.push([r2(ox + dx * dist), r2(oy + dy * dist), r2(oz + dz * dist), best ? 1 : (wall ? 0 : 2),
        wall && !best ? wall.nx : 0, wall && !best ? wall.ny : 0, wall && !best ? wall.nz : 0]);
      if (best) {
        const dmg = damageAt(w, best.hit.dist) * (best.hit.head ? w.headMult : 1);
        const cur = perTarget.get(best.tg.t) || { dmg: 0, head: false };
        cur.dmg += dmg; cur.head = cur.head || best.hit.head;
        perTarget.set(best.tg.t, cur);
      }
    }
    this.events.push({ k: 'shot', e: e.id, w: w.id, o: [r2(ox), r2(oy), r2(oz)], h: ends });
    if (perTarget.size) e.hits++;
    for (const [t, info] of perTarget) {
      if (info.head) e.headshots++;
      this.applyDamage(t, e, info.dmg, info.head, w.id);
    }
  }

  meleeAttack(e, w, ox, oy, oz, back) {
    const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
    let best = null, bestD = Infinity;
    for (const t of this.entities.values()) {
      if (t === e || !t.alive || !this.isEnemy(e, t)) continue;
      const p = this.rewound(t, back);
      const dx = p.x - ox, dz = p.z - oz;
      const d = Math.hypot(dx, dz);
      if (d > w.range + 0.35 || d < 1e-3) continue;
      const dot = (dx * fx + dz * fz) / d;
      if (dot < 0.75) continue;
      if (Math.abs((p.y + 1) - oy) > 1.6) continue;
      if (!this.map.los(ox, oy, oz, p.x, p.y + 1.2, p.z)) continue;
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best) {
      e.hits++;
      // Ataque por la espalda: letal
      const tfx = -Math.sin(best.yaw), tfz = -Math.cos(best.yaw);
      const backstab = tfx * fx + tfz * fz > 0.5;
      this.applyDamage(best, e, backstab ? 150 : w.damage, false, w.id);
    }
  }

  applyDamage(victim, attacker, amount, head, weaponId) {
    if (!victim.alive || this.time < victim.protectUntil || this.phase !== 'playing') return;
    const dmg = Math.max(1, Math.round(amount));
    victim.health -= dmg;
    victim.lastDamageT = this.time;
    victim.damageBy.set(attacker.id, (victim.damageBy.get(attacker.id) || 0) + dmg);
    attacker.damage += dmg;
    const kill = victim.health <= 0;
    this.privateEvent(attacker, { k: 'hit', head, kill, dmg, v: victim.id });
    this.privateEvent(victim, { k: 'dmg', dmg, from: [r2(attacker.ms.x), r2(attacker.ms.z)], a: attacker.id });
    if (victim.brain) victim.brain.onDamaged(attacker, dmg);
    if (attacker.brain) attacker.brain.onDealtDamage(victim, dmg);
    if (kill) this.kill(victim, attacker, weaponId, head);
  }

  kill(victim, killer, weaponId, head) {
    victim.alive = false;
    victim.health = 0;
    victim.deaths++;
    victim.respawnAt = this.time + RESPAWN_TIME;
    victim.killerId = killer ? killer.id : 0;
    if (killer && killer !== victim) {
      killer.kills++;
      killer.score += 100 + (head ? 25 : 0);
      for (const [id, d] of victim.damageBy) {
        if (id === killer.id || d < 30) continue;
        const a = this.entities.get(id);
        if (a) { a.assists++; a.score += 50; }
      }
    }
    victim.damageBy.clear();
    this.engagements.delete(victim.id);
    for (const m of this.intel) m.delete(victim.id);
    this.events.push({ k: 'kill', a: killer ? killer.id : 0, v: victim.id, w: weaponId, h: !!head });
    if (victim.brain) victim.brain.onDeath();
    if (killer && killer.brain) killer.brain.onKill(victim);
    const ended = onKill(this, killer, victim, weaponId);
    this.sendBoard();
    if (ended) this.endMatch('score');
  }

  endMatch(reason) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    const winner = computeWinner(this);
    const stats = [...this.entities.values()].map((e) => ({
      id: e.id, name: e.name, team: e.team, bot: e.isBot, diff: e.difficulty,
      k: e.kills, d: e.deaths, a: e.assists, s: e.score,
      kd: e.deaths ? Math.round((e.kills / e.deaths) * 100) / 100 : e.kills,
      acc: e.shots ? Math.round((e.hits / e.shots) * 100) : 0,
      hs: e.headshots, dmg: e.damage, gl: e.gunLevel,
    })).sort((a, b) => (b.s - a.s) || (b.k - a.k));
    this.endInfo = { winner, reason, stats, teamScore: this.teamScore.slice(), mode: this.settings.mode };
    this.sendSnapshots();
    for (const c of this.clients.values()) {
      this.send(c.id, { t: 'end', ...this.endInfo, host: c.id === this.hostId });
    }
  }

  privateEvent(e, ev) {
    if (!e.clientId) return;
    if (!this.privateEvents.has(e.clientId)) this.privateEvents.set(e.clientId, []);
    this.privateEvents.get(e.clientId).push(ev);
  }

  sendBoard() {
    const rows = [...this.entities.values()].map((e) => [
      e.id, e.kills, e.deaths, e.assists, e.score, Math.round(e.ping * 1000), e.gunLevel,
    ]);
    this.broadcast({ t: 'board', rows, ts: this.teamScore });
  }

  sendSnapshots() {
    const ents = [];
    for (const e of this.entities.values()) {
      const ws = e.ws;
      const flags = (e.alive ? 1 : 0) | (e.sprinting ? 2 : 0) | ((e.buttons & BTN.ADS) ? 4 : 0)
        | (ws.reloadT > 0 ? 8 : 0) | (e.ms.onGround ? 16 : 0) | ((e.buttons & BTN.FIRE) ? 32 : 0)
        | (this.time < e.protectUntil ? 64 : 0);
      ents.push([e.id, r2(e.ms.x), r2(e.ms.y), r2(e.ms.z), r3(e.yaw), r3(e.pitch), r2(e.ms.crouch), flags,
        WEAPON_IDS.indexOf(ws.loadout[ws.slot] || 'colmillo'), Math.ceil(e.health)]);
    }
    const base = {
      t: 'snap', time: r3(this.time), phase: this.phase, cd: r2(Math.max(0, this.countdown || 0)),
      tl: Math.max(0, Math.round(this.timeLeft)), ts: this.teamScore, ents, ev: this.events,
    };
    for (const c of this.clients.values()) {
      const e = this.entities.get(c.entityId);
      const msg = { ...base };
      if (e) {
        const ws = e.ws, ms = e.ms;
        msg.you = {
          ack: e.ack, alive: e.alive, hp: Math.ceil(e.health),
          ms: [r3(ms.x), r3(ms.y), r3(ms.z), r3(ms.vx), r3(ms.vy), r3(ms.vz), ms.onGround ? 1 : 0, r3(ms.crouch)],
          ws: {
            lo: ws.loadout, sl: ws.slot, am: ws.ammo, rt: r3(ws.reloadT), st: r3(ws.switchT), ft: r3(ws.fireT),
            bl: ws.burstLeft, bo: r3(ws.bloom), sq: ws.shotSeq, tr: ws.trig, at: r3(ws.adsT),
          },
          rs: e.alive ? 0 : r2(Math.max(0, e.respawnAt - this.time)),
          sp: e.spawnCount, sy: r3(e.spawnYaw), gl: e.gunLevel, kb: e.killerId,
          pr: this.time < e.protectUntil,
        };
      }
      const priv = this.privateEvents.get(c.id);
      if (priv && priv.length) msg.pev = priv;
      this.send(c.id, msg);
    }
    this.events = [];
    this.privateEvents.clear();
  }
}

function sanitizeName(n) {
  const s = String(n || '').replace(/[<>&"'`]/g, '').trim().slice(0, 16);
  return s || 'Jugador';
}
