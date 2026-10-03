// HUD: vida, munición, mira dinámica, hitmarkers, kill feed, marcador, minimapa y clasificación.
import { WEAPONS, PRIMARIES, GUN_LADDER } from '/shared/weapons.js';
import { MODE_INFO, TEAM_NAMES } from '/shared/constants.js';
import { colorFor } from '../render/Characters.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = (n) => '#' + n.toString(16).padStart(6, '0');

export class Hud {
  constructor() {
    this.el = {
      score: $('hud-score'), timer: $('hud-timer'), feed: $('killfeed'), cross: $('crosshair'), hit: $('hitmarker'),
      scope: $('scope'), vign: $('dmg-vignette'), arrows: $('dmg-arrows'), center: $('center-msg'), notice: $('notice'),
      hpNum: $('hp-num'), hpFill: $('hp-fill'), hpBox: document.querySelector('.hud-health'),
      wname: $('weapon-name'), mag: $('ammo-mag'), res: $('ammo-res'), ammoBox: document.querySelector('.ammo'),
      reloadBar: document.querySelector('.reload-bar'), reloadFill: $('reload-fill'),
      board: $('scoreboard'), mini: $('minimap'),
    };
    this.cross = [...this.el.cross.children];
    this.hitT = null; this.noticeT = null;
    this.feedItems = [];
    this.cache = {};
    this.miniCtx = this.el.mini.getContext('2d');
  }

  reset() {
    this.el.feed.innerHTML = '';
    this.el.arrows.innerHTML = '';
    this.el.center.innerHTML = '';
    this.el.board.classList.remove('on');
    this.el.scope.classList.remove('on');
    this.el.vign.style.opacity = 0;
    this.cache = {};
    this.miniBase = null;
  }

  set(key, el, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn ? fn(value) : (el.textContent = value);
  }

  health(hp) {
    this.set('hp', this.el.hpNum, Math.max(0, Math.ceil(hp)));
    this.set('hpw', null, Math.max(0, Math.ceil(hp)), (v) => { this.el.hpFill.style.width = v + '%'; this.el.hpBox.classList.toggle('low', v <= 35); });
  }

  ammo(w, mag, res, reloadK) {
    this.set('wn', this.el.wname, w.name);
    if (w.fire === 'melee') { this.set('mag', this.el.mag, '—'); this.set('res', this.el.res, ''); }
    else { this.set('mag', this.el.mag, mag); this.set('res', this.el.res, '/ ' + res); }
    this.set('empty', null, w.fire !== 'melee' && mag === 0, (v) => this.el.ammoBox.classList.toggle('empty', v));
    const on = reloadK > 0;
    this.set('rl', null, on, (v) => this.el.reloadBar.classList.toggle('on', v));
    if (on) this.el.reloadFill.style.width = Math.round(reloadK * 100) + '%';
  }

  crosshair(px, visible, melee, adsDot) {
    const g = Math.round(px);
    this.set('cads', null, !!adsDot, (v) => this.el.cross.classList.toggle('ads', v));
    this.set('cv', null, visible, (v) => this.el.cross.classList.toggle('hidden', !v));
    this.set('cdot', null, melee, (v) => this.el.cross.classList.toggle('dot', v));
    this.set('cg', null, g, (gap) => {
      const [up, down, left, right] = this.cross;
      up.style.top = `${-gap - 9}px`; down.style.top = `${gap}px`;
      left.style.left = `${-gap - 9}px`; right.style.left = `${gap}px`;
      for (const c of this.cross) c.style.display = melee ? 'none' : '';
    });
  }

  scope(on) { this.set('scope', null, on, (v) => this.el.scope.classList.toggle('on', v)); }

  hitmarker(head, kill) {
    const h = this.el.hit;
    h.classList.remove('on', 'kill', 'head');
    void h.offsetWidth;
    h.classList.add('on');
    if (kill) h.classList.add('kill'); else if (head) h.classList.add('head');
    clearTimeout(this.hitT);
    this.hitT = setTimeout(() => h.classList.remove('on'), kill ? 220 : 120);
  }

  damage(angle, amount) {
    this.el.vign.style.transition = 'none';
    this.el.vign.style.opacity = Math.min(1, 0.35 + amount / 60);
    requestAnimationFrame(() => { this.el.vign.style.transition = ''; this.el.vign.style.opacity = 0; });
    const a = document.createElement('div');
    a.className = 'arrow';
    a.style.transform = `rotate(${angle}rad)`;
    this.el.arrows.appendChild(a);
    setTimeout(() => { a.style.opacity = 0; }, 500);
    setTimeout(() => a.remove(), 1200);
  }

  notice(text) {
    this.el.notice.textContent = text;
    this.el.notice.classList.remove('on'); void this.el.notice.offsetWidth;
    this.el.notice.classList.add('on');
    clearTimeout(this.noticeT);
    this.noticeT = setTimeout(() => this.el.notice.classList.remove('on'), 900);
  }

  killfeed(killer, victim, weaponId, head, youId) {
    const span = (e) => {
      if (!e) return '<span class="cn">?</span>';
      const cls = e.team >= 0 ? `c${e.team}` : 'cn';
      return `<span class="${cls}${e.id === youId ? ' me' : ''}">${esc(e.name)}</span>`;
    };
    const w = WEAPONS[weaponId];
    const div = document.createElement('div');
    div.className = 'kf';
    div.innerHTML = killer && killer !== victim
      ? `${span(killer)}<span class="w">${esc(w ? w.name : '')}</span>${span(victim)}${head ? '<span class="hs">en la cabeza</span>' : ''}`
      : `${span(victim)}<span class="w">eliminado</span>`;
    this.el.feed.prepend(div);
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
    setTimeout(() => div.remove(), 6000);
  }

  topBar(game) {
    const s = game.settings, info = MODE_INFO[s.mode];
    const ts = game.teamScore;
    let html;
    if (info.teams) {
      const my = game.myTeam;
      html = `<div class="t t0${my === 0 ? ' mine' : ''}" title="${TEAM_NAMES[0]}">${ts[0]}</div><div class="t t1${my === 1 ? ' mine' : ''}" title="${TEAM_NAMES[1]}">${ts[1]}</div>`;
      if (s.scoreLimit) html += `<div class="solo">a ${s.scoreLimit}</div>`;
    } else if (s.mode === 'gungame') {
      const lvl = Math.min(game.gunLevel, GUN_LADDER.length - 1);
      html = `<div class="solo">Nivel ${lvl + 1}/${GUN_LADDER.length} · ${esc(WEAPONS[GUN_LADDER[lvl]].name)}</div><div class="solo">Líder: ${esc(game.leaderText())}</div>`;
    } else {
      html = `<div class="solo">Tus bajas ${game.myKills}${s.scoreLimit ? ' / ' + s.scoreLimit : ''}</div><div class="solo">Líder: ${esc(game.leaderText())}</div>`;
    }
    this.set('top', null, html, (v) => { this.el.score.innerHTML = v; });
    const tl = Math.max(0, game.timeLeft | 0);
    this.set('timer', this.el.timer, `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`);
  }

  center(html) { this.set('center', null, html, (v) => { this.el.center.innerHTML = v; }); }

  deathMessage(killerName, respawn, primary, showPicks) {
    let picks = '';
    if (showPicks) {
      picks = '<div class="picks">' + PRIMARIES.map((id, i) =>
        `<span class="${id === primary ? 'sel' : ''}">${i + 1} ${esc(WEAPONS[id].name)}</span>`).join('') + '</div>';
    }
    this.center(`<div class="big">Eliminado</div><div class="sub">${killerName ? 'por ' + esc(killerName) + ' · ' : ''}reapareces en ${Math.ceil(respawn)}</div>${picks}`);
  }

  scoreboard(game, on) {
    this.el.board.classList.toggle('on', on);
    if (!on) return;
    const rows = [...game.roster.values()];
    const stat = (e) => game.board.get(e.id) || { k: 0, d: 0, a: 0, s: 0, ping: 0, gl: 0 };
    rows.sort((a, b) => (stat(b).s - stat(a).s) || (stat(b).k - stat(a).k));
    const gun = game.settings.mode === 'gungame';
    const table = (list) => `<table class="sb"><thead><tr><th>Jugador</th>${gun ? '<th>Nivel</th>' : ''}<th>Bajas</th><th>Muertes</th><th>Asist.</th><th>Puntos</th><th>Ping</th></tr></thead><tbody>${
      list.map((e) => { const s = stat(e); const ent = game.remote.get(e.id);
        const dead = e.id === game.youId ? !game.alive : ent && !ent.alive;
        return `<tr class="${e.id === game.youId ? 'me' : ''}"><td><span class="${dead ? 'dead' : ''}">${esc(e.name)}</span>${e.bot ? `<span class="bot">bot · ${esc(diffName(e.diff))}</span>` : ''}</td>${gun ? `<td>${Math.min(s.gl + 1, GUN_LADDER.length)}</td>` : ''}<td>${s.k}</td><td>${s.d}</td><td>${s.a}</td><td>${s.s}</td><td>${e.bot ? '—' : s.ping}</td></tr>`; }).join('')
    }</tbody></table>`;
    const info = MODE_INFO[game.settings.mode];
    let html = `<h3><span>${esc(info.name)}</span><span>${esc(game.mapName)}</span></h3>`;
    if (info.teams) {
      for (const t of [0, 1]) {
        html += `<div class="sb-team t${t}"><h4>Equipo ${TEAM_NAMES[t]} — ${game.teamScore[t]}</h4>${table(rows.filter((r) => r.team === t))}</div>`;
      }
    } else {
      html += `<div class="sb-team tn"><h4>Todos contra todos</h4>${table(rows)}</div>`;
    }
    this.el.board.innerHTML = html;
  }

  minimap(game) {
    const ctx = this.miniCtx, map = game.map, S = 168;
    const k = S / Math.max(map.width, map.depth);
    if (!this.miniBase) {
      const c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d');
      for (let z = 0; z < map.h; z++) for (let x = 0; x < map.w; x++) {
        const h = map.heightAt(x, z);
        if (h <= 0) continue;
        g.fillStyle = h > 3 ? 'rgba(233,237,242,0.55)' : h > 1.5 ? 'rgba(233,237,242,0.35)' : 'rgba(233,237,242,0.2)';
        g.fillRect(x * 2 * k, z * 2 * k, 2 * k + 0.5, 2 * k + 0.5);
      }
      this.miniBase = c;
    }
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.miniBase, 0, 0);
    const now = performance.now();
    for (const [id, r] of game.remote) {
      if (!r.alive || id === game.youId) continue;
      const info = game.roster.get(id);
      if (!info) continue;
      const ally = game.isAlly(info);
      // Los enemigos sólo aparecen un instante cuando disparan sin silenciador
      if (!ally && !(r.firedAt && now - r.firedAt < 1200)) continue;
      ctx.fillStyle = ally ? css(colorFor(info.team, id)) : '#ff4d5e';
      ctx.beginPath(); ctx.arc(r.x * k, r.z * k, ally ? 3 : 3.5, 0, Math.PI * 2); ctx.fill();
    }
    if (game.alive) {
      const x = game.ms.x * k, z = game.ms.z * k, yaw = game.yaw;
      ctx.save(); ctx.translate(x, z); ctx.rotate(-yaw);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
}

function diffName(d) { return { easy: 'fácil', normal: 'normal', hard: 'difícil', expert: 'experto' }[d] || ''; }
