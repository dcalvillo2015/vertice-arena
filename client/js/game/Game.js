// Partida en el cliente: predicción + reconciliación del jugador local, interpolación de
// entidades remotas, efectos, HUD y sonido. El servidor es la autoridad.
import * as THREE from 'three';
import { CLIENT_STEP, INTERP_DELAY, BTN, MODE_INFO } from '/shared/constants.js';
import { MapData } from '/shared/MapData.js';
import { MAPS } from '/shared/maps.js';
import { WEAPONS, PRIMARIES } from '/shared/weapons.js';
import { createMoveState, copyMoveState, stepMove, eyeHeight, rayVsPlayer } from '/shared/physics.js';
import { createWeaponState, copyWeaponState, weaponStep, currentWeapon, computeSpread, shotDirections } from '/shared/game/combat.js';
import { World } from '../render/World.js';
import { CharacterModel } from '../render/Characters.js';
import { ViewModel } from '../render/ViewModel.js';
import { Effects } from '../render/Effects.js';
import { Input } from './Input.js';

const WEAPON_IDS = Object.keys(WEAPONS);
const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

export class Game {
  constructor(app, start) {
    this.app = app;
    this.renderer = app.renderer;
    this.hud = app.hud;
    this.sound = app.sound;
    this.cfg = app.cfg;
    this.code = start.code;
    this.isHost = start.host;
    this.settings = start.settings;
    this.youId = start.you;
    this.map = new MapData(this.settings.mapId);
    this.mapName = MAPS[this.settings.mapId].name;
    this.roster = new Map();
    this.board = new Map();
    this.remote = new Map();
    this.teamScore = [0, 0];
    this.timeLeft = this.settings.timeLimit;
    this.phase = start.phase;
    this.gunLevel = 0;
    this.myKills = 0;

    this.world = new World(this.map, { shadows: this.cfg.shadows });
    this.scene = this.world.scene;
    this.camera = new THREE.PerspectiveCamera(this.cfg.fov, 1, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.vm = new ViewModel();
    this.fx = new Effects(this.scene);
    this.input = new Input(this.renderer.domElement);
    this.input.onLockChange = (locked) => app.onPointerLock(locked);

    // Estado local predicho
    this.ms = createMoveState(0, 0, 0);
    this.ws = createWeaponState([this.app.primary, 'aguja', 'colmillo']);
    this.alive = false;
    this.hp = 100;
    this.yaw = 0; this.pitch = 0;
    this.recoilRecover = 0;
    this.seq = 0;
    this.pending = [];
    this.outbox = [];
    this.lastSend = 0;
    this.acc = 0;
    this.lastSpawn = -1;
    this.visualOffset = new THREE.Vector3();
    this.crouchVis = 0;
    this.adsK = 0;
    this.wantSlot = -1; this.wantReload = false; this.lastSlot = 1;
    this.scoreboardOn = false;
    this.respawnIn = 0;
    this.killerName = '';
    this.serverOffset = null;
    this.prevReloadT = 0; this.prevSlot = -1;
    this.stepAcc = 0;
    this.lastCountdownBeep = 99;
    this.primary = this.app.primary;

    this.setRoster(start.roster);
    this.hud.reset();
    this.resize();
    this.running = true;
    this.lastFrame = performance.now();
    this._loop = (t) => this.frame(t);
    requestAnimationFrame(this._loop);
  }

  // ------------------------------------------------------------------ roster / equipos
  setRoster(list) {
    const seen = new Set();
    for (const r of list) {
      seen.add(r.id);
      const prev = this.roster.get(r.id);
      this.roster.set(r.id, r);
      if (r.id === this.youId) continue;
      const ent = this.remote.get(r.id);
      if (!ent || !prev || prev.team !== r.team) {
        if (ent) this.scene.remove(ent.model.root);
        const model = new CharacterModel({ team: r.team, id: r.id, name: r.name, ally: this.isAlly(r) });
        this.scene.add(model.root);
        this.remote.set(r.id, { buf: ent ? ent.buf : [], model, alive: false, x: 0, y: 0, z: 0, stepAcc: 0, firedAt: 0 });
      }
    }
    for (const [id, ent] of this.remote) {
      if (!seen.has(id)) { this.scene.remove(ent.model.root); this.remote.delete(id); }
    }
  }

  get myTeam() { const r = this.roster.get(this.youId); return r ? r.team : -1; }
  isAlly(r) { const t = this.myTeam; return t >= 0 && r.team === t && r.id !== this.youId; }

  leaderText() {
    let best = null;
    for (const r of this.roster.values()) {
      const s = this.board.get(r.id);
      if (!s) continue;
      const key = this.settings.mode === 'gungame' ? s.gl * 1000 + s.k : s.k * 1000 + s.s;
      if (!best || key > best.key) best = { key, name: r.name, s };
    }
    if (!best) return '—';
    return this.settings.mode === 'gungame' ? `${best.name} (nivel ${best.s.gl + 1})` : `${best.name} (${best.s.k})`;
  }

  // ------------------------------------------------------------------ red
  onMessage(m) {
    switch (m.t) {
      case 'snap': this.onSnapshot(m); break;
      case 'roster': this.setRoster(m.roster); break;
      case 'board':
        for (const [id, k, d, a, s, ping, gl] of m.rows) this.board.set(id, { k, d, a, s, ping, gl });
        this.teamScore = m.ts;
        { const me = this.board.get(this.youId); if (me) { this.myKills = me.k; this.gunLevel = me.gl; } }
        if (this.scoreboardOn) this.hud.scoreboard(this, true);
        break;
      case 'ping': this.app.net.send({ t: 'pong', st: m.st }); break;
      default: break;
    }
  }

  onSnapshot(m) {
    const now = performance.now() / 1000;
    const sample = m.time - now;
    if (this.serverOffset === null || sample > this.serverOffset) this.serverOffset = sample;
    else this.serverOffset += (sample - this.serverOffset) * 0.02;
    if (this.phase !== m.phase && m.phase === 'playing') this.sound.countdown(true);
    this.phase = m.phase;
    this.countdown = m.cd;
    this.timeLeft = m.tl;
    this.teamScore = m.ts;

    for (const e of m.ents) {
      const [id, x, y, z, yaw, pitch, crouch, flags, wi, hp] = e;
      if (id === this.youId) continue;
      const r = this.remote.get(id);
      if (!r) continue;
      r.buf.push({ t: m.time, x, y, z, yaw, pitch, crouch, flags, wi, hp });
      if (r.buf.length > 30) r.buf.shift();
    }
    if (m.you) this.reconcile(m.you);
    for (const ev of m.ev) this.onEvent(ev);
    if (m.pev) for (const ev of m.pev) this.onPrivateEvent(ev);
  }

  reconcile(you) {
    const wasAlive = this.alive;
    this.alive = you.alive;
    this.hp = you.hp;
    this.respawnIn = you.rs;
    this.protectedNow = you.pr;
    if (this.settings.mode === 'gungame') this.gunLevel = you.gl;
    if (you.sp !== this.lastSpawn) {
      // Nueva aparición: colocar la vista
      this.lastSpawn = you.sp;
      this.yaw = you.sy; this.pitch = 0;
      this.pending = this.pending.filter((c) => c.s > you.ack);
      copyMoveState(this.ms, msFrom(you.ms));
      copyWeaponState(this.ws, wsFrom(you.ws));
      this.visualOffset.set(0, 0, 0);
      this.recoilRecover = 0;
      return;
    }
    if (!you.alive) { if (wasAlive) this.onDeathLocal(you.kb); return; }
    const bx = this.ms.x, by = this.ms.y, bz = this.ms.z;
    copyMoveState(this.ms, msFrom(you.ms));
    copyWeaponState(this.ws, wsFrom(you.ws));
    this.pending = this.pending.filter((c) => c.s > you.ack);
    if (this.phase === 'playing') for (const c of this.pending) this.simulate(c, false);
    const ex = bx - this.ms.x, ey = by - this.ms.y, ez = bz - this.ms.z;
    const err = Math.hypot(ex, ey, ez);
    if (err > 0.05) this.corrections = (this.corrections || 0) + 1; // métrica de depuración: desajustes de predicción
    if (err > 2) this.visualOffset.set(0, 0, 0);
    else if (err > 0.001) this.visualOffset.add(tmpV2.set(ex, ey, ez));
  }

  onDeathLocal(killerId) {
    const k = this.roster.get(killerId);
    this.killerName = k && killerId !== this.youId ? k.name : '';
    this.input.mouse.left = false;
  }

  onEvent(ev) {
    if (ev.k === 'shot') {
      if (ev.e === this.youId) return;
      const r = this.remote.get(ev.e);
      const w = WEAPONS[ev.w];
      const o = tmpV.set(ev.o[0], ev.o[1], ev.o[2]);
      let muzzle = o.clone();
      if (r && r.model.root.visible && r.model.body.visible) { r.model.muzzleWorld(muzzle); }
      if (r) r.firedAt = performance.now();
      if (w.fire === 'melee') { this.sound.knife(ev.o); return; }
      const camDist = this.camera.position.distanceTo(o);
      this.fx.muzzleFlash(muzzle, camDist < 40);
      this.sound.gunshot(w, ev.o, ev.e);
      ev.h.forEach((h, i) => {
        const end = new THREE.Vector3(h[0], h[1], h[2]);
        if (i < 2 || w.pellets === 1) this.fx.tracer(muzzle, end);
        if (h[3] === 0) this.fx.impact(end, [h[4], h[5], h[6]], 'wall');
        else if (h[3] === 1) {
          const n = tmpV2.copy(muzzle).sub(end).normalize();
          this.fx.impact(end, [n.x, n.y, n.z], 'player');
        }
      });
    } else if (ev.k === 'kill') {
      const killer = this.roster.get(ev.a), victim = this.roster.get(ev.v);
      this.hud.killfeed(killer, victim, ev.w, ev.h, this.youId);
      const r = this.remote.get(ev.v);
      if (r) r.model.die();
      if (ev.a === this.youId && ev.v !== this.youId) {
        this.sound.killConfirm();
        this.hud.notice(`${ev.h ? 'Disparo a la cabeza  ' : ''}+${ev.h ? 125 : 100}`);
      }
    } else if (ev.k === 'spawn') {
      const r = this.remote.get(ev.e);
      if (r) { r.model.revive(); r.buf = r.buf.slice(-1); }
    }
  }

  onPrivateEvent(ev) {
    if (ev.k === 'hit') {
      this.hud.hitmarker(ev.head, ev.kill);
      this.sound.hit(ev.head);
    } else if (ev.k === 'dmg') {
      const dx = ev.from[0] - this.ms.x, dz = ev.from[1] - this.ms.z;
      const ang = Math.atan2(-dx, -dz);         // yaw hacia el atacante
      this.hud.damage(-(ang - this.yaw), ev.dmg);
      this.sound.hurt();
    }
  }

  // ------------------------------------------------------------------ simulación local
  simulate(cmd, emit) {
    const w = currentWeapon(this.ws);
    stepMove(this.ms, cmd, cmd.dt, this.map, w.moveMul);
    const shots = [];
    weaponStep(this.ws, this.ms, cmd, cmd.dt, shots);
    if (emit) for (const s of shots) this.localShot(s);
  }

  localShot(shot) {
    const w = WEAPONS[shot.wid];
    this.vm.fire(w);
    if (w.fire === 'melee') { this.sound.knife(); return; }
    this.sound.gunshot(w);
    // Retroceso de cámara (con recuperación parcial)
    const k = this.input.mouse.right ? 0.65 : 1;
    const kick = w.recoil.pitch * k * (0.85 + Math.random() * 0.3);
    this.pitch = Math.min(1.5, this.pitch + kick);
    this.recoilRecover += kick * 0.55;
    this.yaw += (Math.random() - 0.5) * 2 * w.recoil.yaw * k;
    // Trazadoras e impactos predichos con la misma semilla que el servidor
    const eyeY = this.ms.y + eyeHeight(this.ms.crouch);
    const ox = this.ms.x, oy = eyeY, oz = this.ms.z;
    const dirs = shotDirections(this.youId, shot);
    const muzzle = this.muzzlePoint();
    this.fx.localFlash(muzzle);
    dirs.forEach(([dx, dy, dz], i) => {
      const wall = this.map.raycast(ox, oy, oz, dx, dy, dz, w.range);
      let dist = wall ? wall.dist : w.range;
      let hitPlayer = false;
      for (const [id, r] of this.remote) {
        if (!r.alive) continue;
        const info = this.roster.get(id);
        if (info && this.isAlly(info)) continue;
        const h = rayVsPlayer(ox, oy, oz, dx, dy, dz, dist, { x: r.x, y: r.y, z: r.z, crouch: r.crouch || 0 });
        if (h) { dist = h.dist; hitPlayer = true; }
      }
      const end = new THREE.Vector3(ox + dx * dist, oy + dy * dist, oz + dz * dist);
      if (i < 3) this.fx.tracer(muzzle, end);
      if (hitPlayer) this.fx.impact(end, [-dx, -dy, -dz], 'player');
      else if (wall) this.fx.impact(end, [wall.nx, wall.ny, wall.nz], 'wall');
    });
  }

  muzzlePoint() {
    // Punto aproximado del cañón en el mundo (delante y a la derecha de la cámara)
    const ads = this.adsK;
    tmpV2.set(0.2 * (1 - ads), -0.15 * (1 - ads) - 0.05 * ads, -0.9).applyQuaternion(this.camera.quaternion);
    return this.camera.position.clone().add(tmpV2);
  }

  buildCmd(dt) {
    const inp = this.input;
    let mx = 0, mz = 0, b = 0;
    if (inp.locked) {
      if (inp.down('KeyW')) mz += 1;
      if (inp.down('KeyS')) mz -= 1;
      if (inp.down('KeyD')) mx += 1;
      if (inp.down('KeyA')) mx -= 1;
      if (inp.down('Space')) b |= BTN.JUMP;
      if (inp.down('KeyC') || inp.down('ControlLeft')) b |= BTN.CROUCH;
      if (inp.down('ShiftLeft') || inp.down('ShiftRight')) b |= BTN.SPRINT;
      if (inp.mouse.right) b |= BTN.ADS;
      if (inp.mouse.left) b |= BTN.FIRE;
    }
    const cmd = { s: ++this.seq, mx, mz, b, y: round3(this.yaw), p: round3(this.pitch), dt, w: this.wantSlot, r: this.wantReload };
    this.wantSlot = -1; this.wantReload = false;
    return cmd;
  }

  handleActions() {
    for (const a of this.input.consumeActions()) {
      if (a === 'scoreboard-on') { this.scoreboardOn = true; this.hud.scoreboard(this, true); }
      else if (a === 'scoreboard-off') { this.scoreboardOn = false; this.hud.scoreboard(this, false); }
      else if (a === 'reload') this.wantReload = true;
      else if (a.startsWith('digit')) {
        const n = Number(a.slice(5));
        if (!this.alive && this.settings.mode !== 'gungame') {
          if (n >= 1 && n <= PRIMARIES.length) {
            this.primary = PRIMARIES[n - 1];
            this.app.setPrimary(this.primary);
            this.app.net.send({ t: 'class', w: this.primary });
          }
        } else if (n <= 3) this.requestSlot(n - 1);
      } else if (a === 'last') this.requestSlot(this.lastSlot);
      else if (a === 'next' || a === 'prev') {
        const dir = a === 'next' ? 1 : -1;
        for (let i = 1; i <= 3; i++) {
          const s = (this.ws.slot + dir * i + 3) % 3;
          if (this.ws.loadout[s]) { this.requestSlot(s); break; }
        }
      }
    }
  }

  requestSlot(s) {
    if (s < 0 || s > 2 || !this.ws.loadout[s] || s === this.ws.slot) return;
    this.lastSlot = this.ws.slot;
    this.wantSlot = s;
  }

  // ------------------------------------------------------------------ bucle
  frame(t) {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000);
    this.lastFrame = t;

    this.handleActions();
    // Mirar (cada frame, sin esperar al paso fijo)
    const [ldx, ldy] = this.input.consumeLook();
    const ads = (this.input.mouse.right && this.alive) ? 1 : 0;
    const w = currentWeapon(this.ws);
    const sens = 0.0022 * this.cfg.sens * (ads ? this.cfg.adsSens / Math.sqrt(w.zoom) : 1);
    this.yaw = wrap(this.yaw - ldx * sens);
    this.pitch -= ldy * sens * (this.cfg.invertY ? -1 : 1);
    if (this.recoilRecover > 0 && !this.input.mouse.left) {
      const r = Math.min(this.recoilRecover, dt * 0.25);
      this.pitch -= r; this.recoilRecover -= r;
    }
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));

    // Pasos fijos de predicción
    this.acc += dt;
    while (this.acc >= CLIENT_STEP) {
      this.acc -= CLIENT_STEP;
      const cmd = this.buildCmd(CLIENT_STEP);
      this.pending.push(cmd);
      this.outbox.push(cmd);
      if (this.alive && this.phase === 'playing') this.simulate(cmd, true);
    }
    if (this.pending.length > 240) this.pending.splice(0, this.pending.length - 240);
    if (t - this.lastSend > 33 && this.outbox.length) {
      this.app.net.send({ t: 'input', c: this.outbox.map((c) => [c.s, c.mx, c.mz, c.b, c.y, c.p, c.dt, c.w, c.r ? 1 : 0]) });
      this.outbox = [];
      this.lastSend = t;
    }

    this.updateLocalFeedback(w);
    this.updateRemotes(dt);
    this.updateCamera(dt, ldx, ldy);
    this.fx.update(dt);
    this.updateHud(dt);
    this.render();
  }

  updateLocalFeedback(w) {
    // Sonidos de recarga / cambio de arma detectando transiciones del estado predicho
    if (this.ws.reloadT > 0 && this.prevReloadT === 0) this.sound.reload(w.reload);
    if (this.prevSlot !== -1 && this.ws.slot !== this.prevSlot) this.sound.swap();
    if (this.input.mouse.left && this.alive && w.fire !== 'melee' && this.ws.ammo[this.ws.slot][0] === 0 && this.ws.ammo[this.ws.slot][1] === 0 && !this.emptyClicked) {
      this.sound.empty(); this.emptyClicked = true;
    }
    if (!this.input.mouse.left) this.emptyClicked = false;
    this.prevReloadT = this.ws.reloadT;
    this.prevSlot = this.ws.slot;
    this.vm.setWeapon(w.id);
  }

  updateRemotes(dt) {
    const renderT = performance.now() / 1000 + (this.serverOffset || 0) - INTERP_DELAY;
    const camPos = this.camera.position;
    for (const [id, r] of this.remote) {
      const buf = r.buf;
      if (!buf.length) { r.model.root.visible = r.model.dead && r.model.root.visible; continue; }
      let a = buf[0], b = buf[0];
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].t <= renderT) { a = buf[i]; b = buf[i + 1] || buf[i]; break; }
      }
      const span = b.t - a.t;
      const k = span > 0 ? Math.max(0, Math.min(1, (renderT - a.t) / span)) : 0;
      r.x = a.x + (b.x - a.x) * k;
      r.y = a.y + (b.y - a.y) * k;
      r.z = a.z + (b.z - a.z) * k;
      r.crouch = a.crouch + (b.crouch - a.crouch) * k;
      const yaw = a.yaw + wrap(b.yaw - a.yaw) * k;
      const pitch = a.pitch + (b.pitch - a.pitch) * k;
      const flags = b.flags;
      const aliveNow = (flags & 1) !== 0;
      if (aliveNow && r.model.dead && (a.flags & 1)) r.model.revive();
      r.alive = aliveNow;
      r.hp = b.hp;
      r.model.setWeapon(b.wi);
      r.model.update({ x: r.x, y: r.y, z: r.z, yaw, pitch, crouch: r.crouch, alive: aliveNow, sprint: (flags & 2) !== 0, ads: (flags & 4) !== 0, reloading: (flags & 8) !== 0 }, dt, camPos);
      // Pasos de otros jugadores
      if (aliveNow && (flags & 16) && r.crouch < 0.5) {
        const sp = r.model.speed;
        if (sp > 3) {
          r.stepAcc += dt * sp;
          if (r.stepAcc > 2.6) {
            r.stepAcc = 0;
            const d = Math.hypot(r.x - camPos.x, r.z - camPos.z);
            if (d < 24) this.sound.step([r.x, r.y + 0.1, r.z], (flags & 2) ? 1.3 : 0.8);
          }
        }
      }
    }
  }

  updateCamera(dt, ldx, ldy) {
    const w = currentWeapon(this.ws);
    this.crouchVis += (this.ms.crouch - this.crouchVis) * Math.min(1, dt * 20);
    this.visualOffset.multiplyScalar(Math.max(0, 1 - dt * 12));
    const wantAds = this.alive && this.input.mouse.right && this.ws.switchT === 0 && this.ws.reloadT === 0 && w.fire !== 'melee' ? 1 : 0;
    this.adsK += (wantAds - this.adsK) * Math.min(1, dt / Math.max(0.05, w.adsTime) * 3);
    const cam = this.camera;
    if (this.alive) {
      cam.position.set(this.ms.x + this.visualOffset.x, this.ms.y + eyeHeight(this.crouchVis) + this.visualOffset.y, this.ms.z + this.visualOffset.z);
      const speed = Math.hypot(this.ms.vx, this.ms.vz);
      if (this.ms.onGround && speed > 0.5) {
        this.stepAcc += dt * speed;
        cam.position.y += Math.sin(this.stepAcc * 2.2) * 0.025 * (1 - this.adsK);
        if (this.stepAcc > Math.PI * 2 / 2.2) { this.stepAcc = 0; if (this.ms.crouch < 0.5 && speed > 3.5) this.sound.step(null, 0.5); }
      }
    } else {
      // Cámara de muerte: se eleva lentamente
      cam.position.y += (Math.min(this.ms.y + 4, 6) - cam.position.y) * Math.min(1, dt * 1.5);
    }
    cam.rotation.set(this.pitch, this.yaw, 0);
    const scoped = w.kind === 'sniper' && this.adsK > 0.85;
    const fov = this.cfg.fov / (1 + (w.zoom - 1) * this.adsK);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.hud.scope(scoped);
    this.vm.update(dt, {
      aspect: cam.aspect, ads: this.adsK, speed: Math.hypot(this.ms.vx, this.ms.vz), onGround: this.ms.onGround,
      sprint: this.alive && (this.input.down('ShiftLeft') || this.input.down('ShiftRight')) && this.input.down('KeyW') && !this.input.mouse.right && !this.input.mouse.left && this.ms.crouch < 0.3,
      reload: this.ws.reloadT > 0 ? 1 - this.ws.reloadT / w.reload : 0,
      switching: this.ws.switchT > 0 ? this.ws.switchT / w.switchTime : 0,
      lookDx: ldx, lookDy: ldy, hidden: !this.alive || scoped,
    });
    tmpV.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.sound.setListener(cam.position, tmpV);
  }

  updateHud() {
    const hud = this.hud;
    const w = currentWeapon(this.ws);
    const a = this.ws.ammo[this.ws.slot];
    hud.health(this.alive ? this.hp : 0);
    hud.ammo(w, a[0], a[1], this.ws.reloadT > 0 ? 1 - this.ws.reloadT / w.reload : 0);
    const spread = computeSpread(w, this.ws, this.ms, this.input.mouse.right ? BTN.ADS : 0);
    const px = Math.tan(spread) / Math.tan((this.camera.fov * Math.PI / 180) / 2) * (window.innerHeight / 2);
    hud.crosshair(4 + px, this.alive && this.adsK < 0.6 && this.phase !== 'ended', w.fire === 'melee', this.alive && this.adsK >= 0.6 && w.kind !== 'sniper');
    hud.topBar(this);
    hud.minimap(this);
    // Mensaje central
    if (this.phase === 'countdown') {
      const n = Math.ceil(this.countdown || 0);
      if (n !== this.lastCountdownBeep && n > 0) { this.lastCountdownBeep = n; this.sound.countdown(false); }
      const team = this.myTeam;
      hud.center(`<div class="big">${n > 0 ? n : '¡Ya!'}</div><div class="sub">${MODE_INFO[this.settings.mode].name}${team >= 0 ? ' · Equipo ' + (team === 0 ? 'Cobalto' : 'Ámbar') : ''}</div>`);
    } else if (!this.alive && this.phase === 'playing') {
      hud.deathMessage(this.killerName, this.respawnIn, this.primary, this.settings.mode !== 'gungame');
    } else if (this.protectedNow && this.alive) {
      hud.center('<div class="sub">Protección de aparición</div>');
    } else {
      hud.center('');
    }
  }

  render() {
    const r = this.renderer;
    r.autoClear = false;
    r.clear();
    r.render(this.scene, this.camera);
    this.vm.render(r);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  stop() {
    this.running = false;
    this.input.dispose();
  }

  dispose() {
    this.stop();
    this.world.dispose();
  }
}

function round3(v) { return Math.round(v * 1000) / 1000; }
function msFrom(a) { return { x: a[0], y: a[1], z: a[2], vx: a[3], vy: a[4], vz: a[5], onGround: !!a[6], crouch: a[7] }; }
function wsFrom(o) {
  return { loadout: o.lo, slot: o.sl, ammo: o.am, reloadT: o.rt, switchT: o.st, fireT: o.ft, burstLeft: o.bl, bloom: o.bo, shotSeq: o.sq, trig: o.tr, adsT: o.at };
}
