// Valida los mapas: dimensiones, spawns, conectividad total de la navegación y A*.
import { MAPS } from '../shared/maps.js';
import { MapData } from '../shared/MapData.js';
import { NavGrid } from '../shared/nav.js';

let fail = 0;
for (const id of Object.keys(MAPS)) {
  const m = new MapData(id);
  const nav = new NavGrid(m);
  // BFS desde el primer spawn
  const start = m.spawns[0][0];
  const seen = new Uint8Array(m.w * m.h);
  const q = [[start.cx, start.cz]];
  seen[start.cz * m.w + start.cx] = 1;
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nav.isWalk(nx, nz) && !seen[nz * m.w + nx]) { seen[nz * m.w + nx] = 1; q.push([nx, nz]); }
    }
  }
  const unreachable = nav.walkList.filter((i) => !seen[i]);
  // A* entre todos los spawns y zonas
  const pts = [...m.spawns.ffa, ...m.patrol, ...m.zones];
  let pathFail = 0;
  for (const a of pts) for (const b of pts) if (!nav.findPath(a.x, a.z, b.x, b.z)) pathFail++;
  console.log(`[${id}] ${m.w}x${m.h}  spawnsA=${m.spawns[0].length} spawnsB=${m.spawns[1].length} ffa=${m.spawns.ffa.length} patrulla=${m.patrol.length} zonas=${m.zones.length} coberturas=${m.coverPoints.length} celdas=${nav.walkList.length} inalcanzables=${unreachable.length} rutasFallidas=${pathFail}`);
  if (unreachable.length) {
    fail++;
    console.log('  celdas inalcanzables:', unreachable.slice(0, 20).map((i) => `(${i % m.w},${Math.floor(i / m.w)})`).join(' '));
  }
  if (pathFail || m.spawns[0].length < 4 || m.spawns[1].length < 4) fail++;
  // raycast básico: desde un spawn hacia el suelo
  const r = m.raycast(start.x, 1.6, start.z, 0, -1, 0, 10);
  if (!r || Math.abs(r.dist - 1.6) > 1e-6) { fail++; console.log('  raycast al suelo incorrecto', r); }
}
if (fail) { console.error(`map-test: ${fail} problema(s)`); process.exit(1); }
console.log('map-test OK');
