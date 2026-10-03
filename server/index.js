// Servidor de Vértice Arena: archivos estáticos + WebSocket + simulación autoritativa.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { acceptUpgrade } from './websocket.js';
import { RoomManager } from '../shared/game/RoomManager.js';
import { TICK_RATE } from '../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const THREE_VENDOR = path.join(ROOT, 'client', 'vendor', 'three.module.js');
const THREE_NODE = path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js');
const THREE_LOCAL = fs.existsSync(THREE_VENDOR) ? THREE_VENDOR : THREE_NODE;
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base + path.sep) || p === base ? p : null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  if (p === '/vendor/three.module.js') {
    if (fs.existsSync(THREE_LOCAL)) return serveFile(res, THREE_LOCAL);
    res.writeHead(302, { Location: THREE_CDN }); res.end(); return;
  }
  if (p === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: manager.rooms.size, clients: manager.clients.size })); return; }
  if (p === '/' || p === '') p = '/index.html';
  let file;
  if (p.startsWith('/shared/')) file = safeJoin(path.join(ROOT, 'shared'), p.slice('/shared/'.length));
  else file = safeJoin(path.join(ROOT, 'client'), p.slice(1));
  if (!file) { res.writeHead(403); res.end(); return; }
  serveFile(res, file);
});

const manager = new RoomManager();

server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
  const ws = acceptUpgrade(req, socket);
  if (!ws) return;
  const id = manager.connect((msg) => ws.send(JSON.stringify(msg)));
  ws.on('message', (text) => {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    try { manager.message(id, msg); } catch (err) { console.error('Error procesando mensaje:', err); }
  });
  ws.on('close', () => manager.disconnect(id));
  const hb = setInterval(() => {
    if (!ws.open) { clearInterval(hb); return; }
    if (Date.now() - ws.lastPong > 45000) { ws.close(1001); clearInterval(hb); return; }
    ws.ping();
  }, 15000);
});

// Bucle de simulación a paso fijo
const STEP = 1 / TICK_RATE;
let last = process.hrtime.bigint();
let acc = 0;
setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Number(now - last) / 1e9;
  last = now;
  let n = 0;
  while (acc >= STEP && n < 5) { manager.tick(STEP); acc -= STEP; n++; }
  if (acc > STEP * 5) acc = 0; // si el servidor se queda atrás, no acumular deuda
}, 1000 / TICK_RATE / 2);

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n  VÉRTICE ARENA — servidor listo');
  console.log(`  Local:      http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Red local:  http://${ip}:${PORT}   (compártelo con tus amigos en la misma red)`);
  console.log(`  Three.js:   ${fs.existsSync(THREE_LOCAL) ? 'local (' + path.relative(ROOT, THREE_LOCAL) + ')' : 'CDN jsDelivr'}\n`);
});
