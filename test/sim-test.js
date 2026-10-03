// Partidas completas sólo con bots, sin red. Comprueba que los bots se mueven por todo
// el mapa, combaten, no se quedan atascados y que la partida termina con un ganador.
import { Room } from '../shared/game/Room.js';
import { TICK_RATE } from '../shared/constants.js';

const dt = 1 / TICK_RATE;
const scenarios = [
  { mode: 'tdm', mapId: 'patio', maxPlayers: 8, botDifficulty: 'mixed' },
  { mode: 'ffa', mapId: 'refineria', maxPlayers: 6, botDifficulty: 'hard' },
  { mode: 'gungame', mapId: 'patio', maxPlayers: 6, botDifficulty: 'expert' },
  { mode: 'tdm', mapId: 'refineria', maxPlayers: 8, botDifficulty: 'easy' },
  // Partidas largas sin límite de puntos para medir cobertura del mapa
  { mode: 'tdm', mapId: 'patio', maxPlayers: 8, botDifficulty: 'normal', scoreLimit: 0, timeLimit: 300, coverage: true },
  { mode: 'ffa', mapId: 'refineria', maxPlayers: 6, botDifficulty: 'expert', scoreLimit: 0, timeLimit: 300, coverage: true },
];

let failures = 0;
for (const s of scenarios) {
  const msgs = [];
  const room = new Room({ code: 'TEST', settings: { timeLimit: 420, ...s, fillBots: true }, send: (c, m) => msgs.push(m) });
  room.startMatch();
  const visited = new Map();
  const lastMove = new Map();
  let maxIdle = 0, idleBot = null;
  const t0 = performance.now();
  let ticks = 0;
  let worstTick = 0;
  while (room.phase !== 'ended' && ticks < TICK_RATE * 600) {
    const a = performance.now();
    room.update(dt);
    worstTick = Math.max(worstTick, performance.now() - a);
    ticks++;
    for (const e of room.entities.values()) {
      if (!visited.has(e.id)) visited.set(e.id, new Set());
      visited.get(e.id).add(`${Math.floor(e.ms.x / 2)},${Math.floor(e.ms.z / 2)}`);
      const lm = lastMove.get(e.id);
      if (!lm || !e.alive || Math.hypot(lm.x - e.ms.x, lm.z - e.ms.z) > 1.5) {
        lastMove.set(e.id, { x: e.ms.x, z: e.ms.z, t: room.time });
      } else if (room.time - lm.t > maxIdle) { maxIdle = room.time - lm.t; idleBot = `${e.name}(${e.difficulty},${e.brain.state})`; }
    }
  }
  const ms = performance.now() - t0;
  const ents = [...room.entities.values()];
  const totalKills = ents.reduce((a, e) => a + e.kills, 0);
  const walk = room.nav.walkList.length;
  const union = new Set();
  for (const v of visited.values()) for (const k of v) union.add(k);
  const coverage = union.size / walk;
  const end = room.endInfo;
  console.log(`\n== ${s.mode} / ${s.mapId} / ${s.botDifficulty} ==`);
  console.log(`  duración simulada ${room.time.toFixed(0)} s en ${ms.toFixed(0)} ms (${(ms / ticks).toFixed(3)} ms/tick, peor ${worstTick.toFixed(2)} ms)`);
  console.log(`  bajas totales ${totalKills}, cobertura del mapa ${(coverage * 100).toFixed(0)}%, máx. tiempo quieto ${maxIdle.toFixed(1)} s ${idleBot || ''}`);
  console.log(`  fin: ${end ? end.reason : 'NO TERMINÓ'}  ganador: ${end ? end.winner.name : '-'}  marcador ${room.teamScore.join('-')}`);
  for (const st of (end ? end.stats : [])) {
    console.log(`   ${st.name.padEnd(8)} ${String(st.diff).padEnd(7)} K${String(st.k).padStart(3)} D${String(st.d).padStart(3)} prec ${String(st.acc).padStart(3)}% HS ${st.hs} nivel ${st.gl}`);
  }
  if (!end) { failures++; console.log('  FALLO: la partida no terminó'); }
  if (totalKills < 10) { failures++; console.log('  FALLO: muy pocas bajas'); }
  if (s.coverage && coverage < 0.5) { failures++; console.log('  FALLO: los bots no recorren el mapa'); }
  if (maxIdle > 25) { failures++; console.log('  FALLO: algún bot se queda atascado'); }
}
if (failures) { console.error(`\nsim-test: ${failures} fallo(s)`); process.exit(1); }
console.log('\nsim-test OK');

// --- Alcance: un único bot debe poder llegar a cualquier celda transitable de cada mapa.
for (const mapId of ['patio', 'refineria']) {
  const room = new Room({ code: 'NAV', settings: { mode: 'ffa', mapId, maxPlayers: 2, fillBots: false, botDifficulty: 'normal' }, send: () => {} });
  const bot = room.createBot(-1, 0);
  room.spawn(bot);
  room.phase = 'playing';
  room.timeLeft = 1e9;
  const brain = bot.brain;
  brain.think = () => {};           // control manual del objetivo
  brain.perceive = () => {};
  const cells = room.nav.walkList;
  let reached = 0, failed = [];
  const stride = 3;
  for (let i = 0; i < cells.length; i += stride) {
    const g = { x: (cells[i] % room.map.w + 0.5) * 2, z: (Math.floor(cells[i] / room.map.w) + 0.5) * 2 };
    brain.goTo(g, 'test');
    let ok = false;
    for (let t = 0; t < 30 * 25; t++) {
      room.update(dt);
      if (Math.hypot(bot.ms.x - g.x, bot.ms.z - g.z) < 0.7) { ok = true; break; }
    }
    if (ok) reached++; else failed.push(`(${cells[i] % room.map.w},${Math.floor(cells[i] / room.map.w)})`);
  }
  const total = Math.ceil(cells.length / stride);
  console.log(`[alcance ${mapId}] ${reached}/${total} celdas alcanzadas por un bot ${failed.length ? 'fallos: ' + failed.slice(0, 10).join(' ') : ''}`);
  if (reached < total) { console.error('FALLO de alcance'); process.exit(1); }
}
console.log('alcance OK');
