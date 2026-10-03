// Prueba de extremo a extremo: arranca el servidor, conecta dos clientes por WebSocket,
// crea sala con código, se une el segundo, arranca con bots y comprueba snapshots e inputs.
import { spawn } from 'node:child_process';
import { BTN } from '../shared/constants.js';

const PORT = 3999;
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res) => srv.stdout.on('data', (d) => { if (String(d).includes('servidor listo')) res(); }));

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const c = { ws, msgs: [], waiters: [] };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    c.msgs.push(m);
    c.waiters = c.waiters.filter((w) => { if (w.pred(m)) { w.res(m); return false; } return true; });
  };
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = (pred, ms = 5000) => new Promise((res, rej) => {
    const found = c.msgs.find(pred);
    if (found) return res(found);
    const t = setTimeout(() => rej(new Error('timeout esperando mensaje')), ms);
    c.waiters.push({ pred, res: (m) => { clearTimeout(t); res(m); } });
  });
  c.ready = new Promise((res) => { ws.onopen = res; });
  return c;
}

let ok = true;
const check = (cond, label) => { console.log(`${cond ? '✔' : '✘'} ${label}`); if (!cond) ok = false; };

try {
  const a = client(), b = client();
  await a.ready; await b.ready;
  await a.wait((m) => m.t === 'welcome');
  a.send({ t: 'create', name: 'Ana', settings: { mode: 'tdm', mapId: 'patio', maxPlayers: 6, botDifficulty: 'normal', fillBots: true } });
  const lobby = await a.wait((m) => m.t === 'lobby');
  check(/^[A-Z0-9]{5}$/.test(lobby.code), `sala creada con código ${lobby.code}`);
  b.send({ t: 'join', code: lobby.code, name: 'Beto' });
  const lobbyB = await b.wait((m) => m.t === 'lobby' && m.players.length === 2);
  check(lobbyB.players.length === 2, 'el amigo se une con el código');
  a.send({ t: 'start' });
  const start = await a.wait((m) => m.t === 'start');
  check(start.roster.length === 6, `partida con ${start.roster.filter((r) => !r.bot).length} humanos + ${start.roster.filter((r) => r.bot).length} bots`);
  const teams = start.roster.map((r) => r.team);
  check(teams.filter((t) => t === 0).length === 3 && teams.filter((t) => t === 1).length === 3, 'equipos equilibrados 3 vs 3');
  // Esperar a que acabe la cuenta atrás
  const snap = await a.wait((m) => m.t === 'snap' && m.phase === 'playing', 6000);
  check(!!snap.you && snap.ents.length === 6, 'snapshots con estado propio y 6 entidades');
  const p0 = snap.you.ms.slice(0, 3);
  // Enviar 1 s de inputs: avanzar y disparar
  let seq = 1;
  for (let i = 0; i < 10; i++) {
    const cmds = [];
    for (let k = 0; k < 6; k++) cmds.push([seq++, 0, 1, BTN.FIRE, snap.you.sy, 0, 1 / 60, -1, 0]);
    a.send({ t: 'input', c: cmds });
    await new Promise((r) => setTimeout(r, 100));
  }
  const later = await a.wait((m) => m.t === 'snap' && m.you && m.you.ack === seq - 1, 3000);
  const p1 = later.you.ms.slice(0, 3);
  const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
  check(moved > 2, `el servidor aplica el movimiento (${moved.toFixed(2)} m) y confirma ack=${later.you.ack}`);
  check(later.you.ws.am[0][0] < 30 || later.you.ws.rt > 0, `disparos procesados (cargador ${later.you.ws.am[0][0]})`);
  // ¿Los bots se mueven?
  const botsBefore = snap.ents.filter((e) => start.roster.find((r) => r.id === e[0]).bot);
  await new Promise((r) => setTimeout(r, 1500));
  const snap2 = a.msgs.filter((m) => m.t === 'snap').pop();
  let movedBots = 0;
  for (const e of botsBefore) {
    const n = snap2.ents.find((x) => x[0] === e[0]);
    if (n && Math.hypot(n[1] - e[1], n[3] - e[3]) > 1) movedBots++;
  }
  check(movedBots >= 2, `${movedBots}/${botsBefore.length} bots se están moviendo en el servidor`);
  // Partida rápida contra bots
  const c = client(); await c.ready;
  c.send({ t: 'quick', name: 'Solo', settings: { mode: 'ffa', mapId: 'refineria', botCount: 7, botDifficulty: 'expert' } });
  const qs = await c.wait((m) => m.t === 'start');
  check(qs.roster.length === 8 && qs.roster.filter((r) => r.bot).length === 7, 'JUGAR CONTRA BOTS: 1 humano + 7 bots');
  // Unirse a una partida en curso sustituye a un bot
  const d = client(); await d.ready;
  d.send({ t: 'join', code: qs.code, name: 'Tarde' });
  const ds = await d.wait((m) => m.t === 'start');
  check(ds.roster.length === 8 && ds.roster.filter((r) => !r.bot).length === 2, 'unirse a partida en curso sustituye a un bot');
  b.send({ t: 'join', code: 'ZZZZZ', name: 'x' });
  const err = await b.wait((m) => m.t === 'error');
  check(!!err, `código inválido rechazado ("${err.msg}")`);
  for (const x of [a, b, c, d]) x.ws.close();
} catch (e) {
  console.error(e);
  ok = false;
}
srv.kill();
if (!ok) { console.error('net-test: FALLO'); process.exit(1); }
console.log('net-test OK');
