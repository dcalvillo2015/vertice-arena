// Controlador de la aplicación: menús, sala de espera, partida y pantalla final.
import * as THREE from 'three';
import { Net } from './net.js';
import { Game } from './game/Game.js';
import { Hud } from './ui/Hud.js';
import { Sound } from './audio/Sound.js';
import { MAPS } from '/shared/maps.js';
import { WEAPONS, PRIMARIES } from '/shared/weapons.js';
import { MODE_INFO, TEAM_NAMES, DIFFICULTY_NAMES } from '/shared/constants.js';
import { MapData } from '/shared/MapData.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DEFAULT_CFG = { sens: 1, adsSens: 0.8, fov: 85, volume: 0.7, shadows: true, invertY: false, resScale: 1 };
const store = {
  get(k, d) { try { const v = localStorage.getItem('va.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('va.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

const MODE_HINTS = {
  tdm_bots: 'Tú (y tus amigos) contra un equipo entero de bots.',
  tdm: 'Dos equipos mezclando humanos y bots. Gana el primero en llegar al límite de bajas.',
  ffa: 'Todos contra todos. Gana quien consiga más bajas.',
  gungame: 'Cada 2 bajas cambias de arma. Gana quien consiga una baja con el cuchillo final.',
};
const DIFF_HINTS = {
  easy: 'Reaccionan tarde, fallan a menudo y apenas buscan cobertura.',
  normal: 'Buena puntería, se cubren de vez en cuando e intentan flanquear.',
  hard: 'Reaccionan rápido, se cubren, flanquean y cambian de posición.',
  expert: 'Coordinan ataques, preparan emboscadas y gestionan bien la munición.',
  mixed: 'Cada bot con una dificultad distinta.',
};

class App {
  constructor() {
    this.cfg = { ...DEFAULT_CFG, ...store.get('cfg', {}) };
    this.primary = store.get('primary', 'kestrel');
    this.name = store.get('name', '');
    this.sound = new Sound();
    this.sound.setVolume(this.cfg.volume);
    this.hud = new Hud();
    this.game = null;
    this.screenStack = ['screen-main'];
    this.lobby = null;
    this.lastEnd = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    $('canvas-holder').appendChild(this.renderer.domElement);
    this.applyRes();
    window.addEventListener('resize', () => { this.applyRes(); this.game?.resize(); this.plan?.resize(); });

    this.buildForms();
    this.bindUi();
    this.plan = new MenuPlan($('menu-plan'));

    this.net = new Net((m) => this.onMessage(m));
    this.net.connect().then((mode) => {
      const s = $('conn-status');
      if (mode === 'online') { s.textContent = 'Conectado al servidor'; s.className = 'conn ok'; }
      else {
        s.textContent = 'Sin servidor: modo local, sólo partidas contra bots';
        s.className = 'conn local';
        document.querySelectorAll('.online-only').forEach((b) => { b.disabled = true; });
      }
    });
  }

  applyRes() {
    const r = Math.min(window.devicePixelRatio || 1, 2) * this.cfg.resScale;
    this.renderer.setPixelRatio(r);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------------ menús
  show(id, push = true) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    document.body.classList.toggle('in-game', id === 'game');
    if (push && this.screenStack[this.screenStack.length - 1] !== id) this.screenStack.push(id);
    if (id === 'screen-main') this.screenStack = ['screen-main'];
    const first = document.querySelector(`#${id} .menu-item, #${id} input:not([type=radio]):not([type=range]), #${id} .cta`);
    if (first && id !== 'game') setTimeout(() => first.focus({ preventScroll: true }), 30);
  }

  back() {
    this.screenStack.pop();
    this.show(this.screenStack[this.screenStack.length - 1] || 'screen-main', false);
  }

  buildForms() {
    for (const fs of document.querySelectorAll('.seg.maps')) {
      fs.insertAdjacentHTML('beforeend', Object.values(MAPS).map((m, i) =>
        `<label><input type="radio" name="mapId" value="${m.id}" ${i === 0 ? 'checked' : ''}><span>${esc(m.name)}<small>${esc(m.description)}</small></span></label>`).join(''));
    }
    for (const fs of document.querySelectorAll('.seg.weapons')) {
      fs.insertAdjacentHTML('beforeend', PRIMARIES.map((id) => {
        const w = WEAPONS[id];
        const kind = { rifle: 'Fusil', smg: 'Subfusil', shotgun: 'Escopeta', sniper: 'Francotirador', lmg: 'Ametralladora' }[w.kind];
        return `<label><input type="radio" name="primary" value="${id}" ${id === this.primary ? 'checked' : ''}><span>${esc(w.name)}<small>${kind}</small></span></label>`;
      }).join(''));
    }
    $('player-name').value = this.name;
    const out = (input, outEl) => { const f = () => { outEl.textContent = input.value; }; input.addEventListener('input', f); f(); };
    out($('bots-count'), $('bots-count-out'));
    out($('create-max'), $('create-max-out'));
    out($('create-bots'), $('create-bots-out'));
    const hints = () => {
      const f = $('form-bots');
      $('bots-mode-hint').textContent = MODE_HINTS[f.mode.value];
      $('bots-diff-hint').textContent = DIFF_HINTS[f.botDifficulty.value];
    };
    $('form-bots').addEventListener('change', hints);
    hints();
    // Ajustes
    for (const input of document.querySelectorAll('[data-setting]')) {
      const key = input.dataset.setting;
      if (input.type === 'checkbox') input.checked = !!this.cfg[key]; else input.value = this.cfg[key];
      input.addEventListener('input', () => {
        this.cfg[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
        store.set('cfg', this.cfg);
        this.syncSettings(key);
      });
    }
    this.syncSettings();
  }

  syncSettings(changed) {
    for (const input of document.querySelectorAll('[data-setting]')) {
      const key = input.dataset.setting;
      if (input.type === 'checkbox') input.checked = !!this.cfg[key]; else input.value = this.cfg[key];
    }
    const fmt = { sens: (v) => v.toFixed(2), adsSens: (v) => v.toFixed(2), fov: (v) => `${v}°`, volume: (v) => `${Math.round(v * 100)}%`, resScale: (v) => `${Math.round(v * 100)}%` };
    for (const o of document.querySelectorAll('[data-out]')) o.textContent = fmt[o.dataset.out](Number(this.cfg[o.dataset.out]));
    if (changed === 'volume') this.sound.setVolume(this.cfg.volume);
    if (changed === 'resScale') this.applyRes();
    if (changed === 'fov' && this.game) { this.game.camera.fov = this.cfg.fov; this.game.camera.updateProjectionMatrix(); }
  }

  playerName() {
    const n = $('player-name').value.trim().slice(0, 16) || 'Jugador';
    store.set('name', n);
    return n;
  }

  setPrimary(id) { this.primary = id; store.set('primary', id); }

  formSettings(form) {
    const fd = new FormData(form);
    const o = {};
    for (const [k, v] of fd.entries()) o[k] = v;
    o.fillBots = form.fillBots ? form.fillBots.checked : true;
    for (const k of ['botCount', 'maxPlayers', 'timeLimit']) if (o[k] !== undefined) o[k] = Number(o[k]);
    return o;
  }

  bindUi() {
    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) { this.sound.ensure(); this.show(go.dataset.go); }
      if (e.target.closest('[data-back]')) this.back();
    });
    $('form-bots').addEventListener('submit', (e) => {
      e.preventDefault();
      this.sound.ensure();
      const s = this.formSettings(e.target);
      this.setPrimary(s.primary);
      this.net.send({ t: 'quick', name: this.playerName(), primary: s.primary, settings: s });
    });
    $('form-create').addEventListener('submit', (e) => {
      e.preventDefault();
      this.sound.ensure();
      const s = this.formSettings(e.target);
      this.setPrimary(s.primary);
      this.net.send({ t: 'create', name: this.playerName(), primary: s.primary, settings: s });
    });
    $('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    $('form-join').addEventListener('submit', (e) => {
      e.preventDefault();
      this.sound.ensure();
      $('join-error').textContent = '';
      this.net.send({ t: 'join', code: $('join-code').value, name: this.playerName(), primary: this.primary });
    });
    $('lobby-start').addEventListener('click', () => this.net.send({ t: 'start' }));
    $('lobby-leave').addEventListener('click', () => { this.net.send({ t: 'leave' }); this.show('screen-main'); });
    $('lobby-code').addEventListener('click', () => {
      const code = $('lobby-code').textContent;
      navigator.clipboard?.writeText(code).then(() => {
        $('lobby-code').classList.add('copied');
        setTimeout(() => $('lobby-code').classList.remove('copied'), 900);
      }).catch(() => {});
    });
    $('pause-resume').addEventListener('click', () => this.game?.input.lock());
    $('pause-quit').addEventListener('click', () => this.leaveGame());
    $('end-menu').addEventListener('click', () => this.leaveGame());
    $('end-again').addEventListener('click', () => this.net.send({ t: 'restart' }));
    this.renderer.domElement.addEventListener('click', () => {
      if (this.game && this.game.phase !== 'ended') { this.sound.ensure(); this.game.input.lock(); }
    });
    $('click-to-play').addEventListener('click', () => this.game?.input.lock());
  }

  onPointerLock(locked) {
    if (!this.game) return;
    $('pause').classList.toggle('on', !locked && this.game.phase !== 'ended' && this.pausedOnce);
    $('click-to-play').classList.toggle('on', !locked && !this.pausedOnce && this.game.phase !== 'ended');
    if (locked) this.pausedOnce = true;
  }

  // ------------------------------------------------------------------ red
  onMessage(m) {
    switch (m.t) {
      case 'welcome': break;
      case 'error':
        $('join-error').textContent = m.msg;
        if (!document.getElementById('screen-join').classList.contains('active')) alert(m.msg);
        break;
      case 'lobby': this.showLobby(m); break;
      case 'start': this.startGame(m); break;
      case 'end': this.showEnd(m); break;
      case 'left': break;
      case 'disconnected':
        this.leaveGame(true);
        $('conn-status').textContent = 'Se perdió la conexión con el servidor. Recarga la página.';
        $('conn-status').className = 'conn';
        break;
      default:
        if (this.game) this.game.onMessage(m);
    }
  }

  showLobby(m) {
    this.lobby = m;
    $('lobby-code').textContent = m.code;
    $('lobby-url').textContent = location.host;
    const s = m.settings;
    $('lobby-summary').textContent = `${MODE_INFO[s.mode].name} en ${MAPS[s.mapId].name}, ${s.maxPlayers} plazas, bots ${DIFFICULTY_NAMES[s.botDifficulty].toLowerCase()}`;
    $('lobby-players').innerHTML = m.players.map((p) => `<li>${esc(p.name)}${p.id === m.you ? ' (tú)' : ''}<em>${p.host ? 'anfitrión' : 'listo'}</em></li>`).join('');
    const bots = s.mode === 'tdm_bots' ? s.botCount : (s.fillBots ? Math.max(0, s.maxPlayers - m.players.length) : 0);
    $('lobby-fill').textContent = bots ? `Al empezar se añadirán ${bots} bots.` : 'No se añadirán bots.';
    $('lobby-start').disabled = !m.host;
    $('lobby-start').textContent = m.host ? 'Empezar partida' : 'Esperando al anfitrión';
    this.show('screen-lobby');
  }

  startGame(m) {
    if (this.game) this.game.dispose();
    this.lastEnd = null;
    this.pausedOnce = false;
    this.game = new Game(this, m);
    $('pause-code').textContent = this.net.mode === 'online' ? `Código de sala: ${m.code}` : 'Partida local';
    $('pause').classList.remove('on');
    $('click-to-play').classList.add('on');
    this.show('game');
    this.game.input.lock();
  }

  leaveGame(silent) {
    if (this.game) { this.game.dispose(); this.game = null; }
    if (!silent) this.net.send({ t: 'leave' });
    $('pause').classList.remove('on');
    this.show('screen-main');
  }

  showEnd(m) {
    if (!this.game) return;
    const g = this.game;
    g.phase = 'ended';
    g.input.unlock();
    setTimeout(() => {
      if (!this.game) return;
      g.stop();
      this.renderEnd(m, g);
      this.show('screen-end');
    }, 1800);
    this.hud.center(`<div class="big">${m.winner.team >= 0 ? (m.winner.team === g.myTeam ? 'Victoria' : 'Derrota') : m.winner.id === g.youId ? 'Victoria' : 'Fin de la partida'}</div>`);
  }

  renderEnd(m, g) {
    const myTeam = g.myTeam;
    let win;
    if (MODE_INFO[m.mode].teams) win = m.winner.team === -1 ? null : m.winner.team === myTeam;
    else win = m.winner.id === g.youId;
    const title = win === null ? 'Empate' : win ? 'Victoria' : 'Derrota';
    const reason = m.reason === 'time' ? 'Se acabó el tiempo.' : 'Se alcanzó el objetivo de la partida.';
    const detail = MODE_INFO[m.mode].teams
      ? `${TEAM_NAMES[0]} ${m.teamScore[0]} – ${m.teamScore[1]} ${TEAM_NAMES[1]}. ${reason}`
      : `Gana ${esc(m.winner.name)}. ${reason}`;
    $('end-banner').innerHTML = `<div class="result ${win ? 'win' : 'lose'}">${title}</div><div class="detail">${detail}</div>`;
    const gun = m.mode === 'gungame';
    $('end-table').innerHTML = `<thead><tr><th>Jugador</th><th>Tipo</th>${gun ? '<th>Nivel</th>' : ''}<th>Bajas</th><th>Muertes</th><th>K/D</th><th>Asist.</th><th>Puntos</th><th>Precisión</th><th>A la cabeza</th><th>Daño</th></tr></thead><tbody>${
      m.stats.map((s) => `<tr class="${s.id === g.youId ? 'me' : ''}"><td class="${s.team >= 0 ? 'team' + s.team : ''}">${esc(s.name)}</td><td>${s.bot ? 'Bot ' + esc((DIFFICULTY_NAMES[s.diff] || '').toLowerCase()) : 'Humano'}</td>${gun ? `<td>${Math.min(s.gl + 1, 8)}</td>` : ''}<td>${s.k}</td><td>${s.d}</td><td>${s.kd.toFixed(2)}</td><td>${s.a}</td><td>${s.s}</td><td>${s.acc}%</td><td>${s.hs}</td><td>${s.dmg}</td></tr>`).join('')
    }</tbody>`;
    $('end-again').disabled = !m.host;
    $('end-again').textContent = m.host ? 'Jugar otra vez' : 'Esperando al anfitrión';
  }
}

// Fondo del menú: plano cenital de los mapas reales, trazado línea a línea.
class MenuPlan {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.maps = Object.keys(MAPS).map((id) => new MapData(id));
    this.idx = 0; this.t = 0;
    this.resize();
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.last = performance.now();
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
      this.last = now;
      if (document.body.classList.contains('in-game')) return;
      this.t += dt;
      this.draw();
    };
    requestAnimationFrame(loop);
  }

  resize() {
    const r = window.devicePixelRatio || 1;
    this.c.width = innerWidth * r; this.c.height = innerHeight * r;
    this.g.setTransform(r, 0, 0, r, 0, 0);
  }

  draw() {
    const g = this.g, W = innerWidth, H = innerHeight;
    const cycle = 14;
    const map = this.maps[Math.floor(this.t / cycle) % this.maps.length];
    const local = this.reduced ? cycle : this.t % cycle;
    g.clearRect(0, 0, W, H);
    const size = Math.min(W * 0.62, H * 1.15);
    const cs = size / map.w;
    const ox = W - size * 0.78, oy = (H - size) / 2;
    g.save();
    g.translate(ox + size / 2, oy + size / 2);
    g.rotate(-0.12);
    g.translate(-size / 2, -size / 2);
    const reveal = Math.min(1, local / 6);
    const fade = local > cycle - 1.2 ? (cycle - local) / 1.2 : 1;
    g.globalAlpha = 0.9 * fade;
    // rejilla
    g.strokeStyle = 'rgba(154,166,189,0.07)'; g.lineWidth = 1;
    for (let i = 0; i <= map.w; i++) {
      g.beginPath(); g.moveTo(i * cs, 0); g.lineTo(i * cs, map.h * cs); g.stroke();
      g.beginPath(); g.moveTo(0, i * cs); g.lineTo(map.w * cs, i * cs); g.stroke();
    }
    // bloques revelados por filas desde el vértice central
    for (let z = 0; z < map.h; z++) {
      for (let x = 0; x < map.w; x++) {
        const h = map.heightAt(x, z);
        const d = Math.hypot(x - map.w / 2, z - map.h / 2) / (map.w * 0.71);
        if (d > reveal) continue;
        if (h > 3) { g.fillStyle = 'rgba(233,237,242,0.13)'; g.fillRect(x * cs, z * cs, cs, cs); }
        else if (h > 1.5) { g.strokeStyle = 'rgba(233,237,242,0.28)'; g.strokeRect(x * cs + 2, z * cs + 2, cs - 4, cs - 4); }
        else if (h > 0) { g.strokeStyle = 'rgba(233,237,242,0.18)'; g.strokeRect(x * cs + 4, z * cs + 4, cs - 8, cs - 8); }
      }
    }
    // spawns de ambos equipos
    for (const team of [0, 1]) {
      g.fillStyle = team === 0 ? 'rgba(61,107,255,0.75)' : 'rgba(255,166,43,0.75)';
      for (const s of map.spawns[team]) {
        const d = Math.hypot(s.cx - map.w / 2, s.cz - map.h / 2) / (map.w * 0.71);
        if (d > reveal) continue;
        g.beginPath(); g.arc(s.x / 2 * cs, s.z / 2 * cs, cs * 0.22, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
    g.globalAlpha = 1;
    // nombre del mapa
    g.fillStyle = `rgba(154,166,189,${0.6 * fade})`;
    g.font = '500 13px Barlow, sans-serif';
    g.textAlign = 'right';
    g.fillText(map.def.name, W - 24, H - 20);
  }
}

window.app = new App();
