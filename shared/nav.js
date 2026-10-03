// Navegación: rejilla de navegación derivada del mapa (navmesh de celdas) + A* + suavizado de ruta.
import { CELL } from './constants.js';

class MinHeap {
  constructor() { this.items = []; this.keys = []; }
  get size() { return this.items.length; }
  push(item, key) {
    const a = this.items, k = this.keys;
    a.push(item); k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]]; [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items, k = this.keys;
    const top = a[0];
    const li = a.pop(), lk = k.pop();
    if (a.length) {
      a[0] = li; k[0] = lk;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

export class NavGrid {
  constructor(map) {
    this.map = map;
    this.w = map.w; this.h = map.h;
    const n = this.w * this.h;
    this.walk = new Uint8Array(n);
    for (let z = 0; z < this.h; z++)
      for (let x = 0; x < this.w; x++)
        this.walk[z * this.w + x] = map.walkableCell(x, z) ? 1 : 0;
    // Coste extra cerca de obstáculos para que las rutas no rocen las esquinas.
    this.extra = new Float32Array(n);
    for (let z = 0; z < this.h; z++)
      for (let x = 0; x < this.w; x++) {
        let near = 0;
        for (const [dx, dz] of DIRS) if (!this.isWalk(x + dx, z + dz)) near++;
        this.extra[z * this.w + x] = near * 0.08;
      }
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 0;
    this.walkList = [];
    for (let i = 0; i < n; i++) if (this.walk[i]) this.walkList.push(i);
  }

  isWalk(x, z) { return x >= 0 && z >= 0 && x < this.w && z < this.h && this.walk[z * this.w + x] === 1; }

  nearestWalkable(cx, cz) {
    if (this.isWalk(cx, cz)) return [cx, cz];
    for (let r = 1; r < 6; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++)
          if (Math.max(Math.abs(dx), Math.abs(dz)) === r && this.isWalk(cx + dx, cz + dz)) return [cx + dx, cz + dz];
    return null;
  }

  randomPoint(rand = Math.random) {
    const i = this.walkList[(rand() * this.walkList.length) | 0];
    return { x: (i % this.w + 0.5) * CELL, z: (Math.floor(i / this.w) + 0.5) * CELL };
  }

  // A* de (sx,sz) a (tx,tz) en coordenadas de mundo. Devuelve lista de puntos {x,z} suavizada o null.
  findPath(sx, sz, tx, tz) {
    const s = this.nearestWalkable(Math.floor(sx / CELL), Math.floor(sz / CELL));
    const t = this.nearestWalkable(Math.floor(tx / CELL), Math.floor(tz / CELL));
    if (!s || !t) return null;
    const W = this.w;
    const si = s[1] * W + s[0], ti = t[1] * W + t[0];
    const gen = ++this.gen;
    const heap = new MinHeap();
    this.g[si] = 0; this.stamp[si] = gen; this.parent[si] = -1;
    heap.push(si, 0);
    let found = false, iter = 0;
    while (heap.size && iter++ < 4000) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === ti) { found = true; break; }
      const cx = cur % W, cz = (cur - cx) / W;
      for (const [dx, dz, cost] of DIRS) {
        const nx = cx + dx, nz = cz + dz;
        if (!this.isWalk(nx, nz)) continue;
        if (dx && dz && (!this.isWalk(cx + dx, cz) || !this.isWalk(cx, cz + dz))) continue; // sin cortar esquinas
        const ni = nz * W + nx;
        if (this.closed[ni] === gen) continue;
        const ng = this.g[cur] + cost + this.extra[ni];
        if (this.stamp[ni] !== gen || ng < this.g[ni]) {
          this.stamp[ni] = gen; this.g[ni] = ng; this.parent[ni] = cur;
          const hx = Math.abs(nx - t[0]), hz = Math.abs(nz - t[1]);
          heap.push(ni, ng + (hx + hz) + (Math.SQRT2 - 2) * Math.min(hx, hz));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = ti; i !== -1; i = this.parent[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => ({ x: (i % W + 0.5) * CELL, z: (Math.floor(i / W) + 0.5) * CELL }));
    // El último punto es el destino exacto si es transitable.
    if (!this.map.collides(tx, tz, 0)) pts[pts.length - 1] = { x: tx, z: tz };
    return this.smooth(sx, sz, pts);
  }

  // Suavizado tipo "string pulling": salta puntos intermedios mientras haya camino libre.
  smooth(sx, sz, pts) {
    const out = [];
    let ax = sx, az = sz, i = 0;
    while (i < pts.length) {
      let j = Math.min(pts.length - 1, i + 12);
      while (j > i && !this.map.clearPath(ax, az, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]);
      ax = pts[j].x; az = pts[j].z;
      i = j + 1;
    }
    return out;
  }
}
