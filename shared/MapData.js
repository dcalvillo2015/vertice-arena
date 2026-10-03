// Datos del mapa: rejilla de alturas, colisiones, raycast 3D, puntos tácticos.
import { CELL, PLAYER } from './constants.js';
import { MAPS } from './maps.js';

const HEIGHTS = { '#': 4.5, 'H': 2.2, 'C': 1.0 };

export class MapData {
  constructor(mapId) {
    const def = MAPS[mapId] || MAPS.patio;
    this.id = def.id;
    this.def = def;
    this.rows = def.rows;
    this.h = this.rows.length;
    this.w = this.rows[0].length;
    this.cell = CELL;
    this.width = this.w * CELL;
    this.depth = this.h * CELL;
    this.heights = new Float32Array(this.w * this.h);
    this.spawns = { 0: [], 1: [], ffa: [] };
    this.patrol = [];
    this.zones = [];
    for (let z = 0; z < this.h; z++) {
      const row = this.rows[z];
      if (row.length !== this.w) throw new Error(`Mapa ${this.id}: fila ${z} mide ${row.length}, se esperaban ${this.w}`);
      for (let x = 0; x < this.w; x++) {
        const ch = row[x];
        this.heights[z * this.w + x] = HEIGHTS[ch] || 0;
        const p = { x: (x + 0.5) * CELL, z: (z + 0.5) * CELL, cx: x, cz: z };
        if (ch === 'A') { this.spawns[0].push(p); this.spawns.ffa.push(p); }
        else if (ch === 'B') { this.spawns[1].push(p); this.spawns.ffa.push(p); }
        else if (ch === 'S') this.spawns.ffa.push(p);
        else if (ch === 'P') this.patrol.push(p);
        else if (ch === 'Z') this.zones.push(p);
      }
    }
    // Lado de cada punto táctico: equipo A defiende la mitad sur (z grande), B la norte.
    const mid = this.depth / 2;
    for (const p of [...this.patrol, ...this.zones]) p.side = p.z > mid ? 0 : 1;
    this.center = { x: this.width / 2, z: this.depth / 2 };
    this.coverPoints = this._buildCover();
  }

  heightAt(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return 99;
    return this.heights[cz * this.w + cx];
  }

  walkableCell(cx, cz) { return this.heightAt(cx, cz) === 0; }

  cellOf(x, z) { return [Math.floor(x / CELL), Math.floor(z / CELL)]; }

  // ¿Colisiona un AABB de radio r con los pies en feetY?
  collides(x, z, feetY, r = PLAYER.radius) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++)
        if (this.heightAt(cx, cz) > feetY + PLAYER.step) return true;
    return false;
  }

  // Altura del suelo bajo el AABB (la caja más alta que no bloquea).
  groundHeight(x, z, feetY, r = PLAYER.radius) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    let g = 0;
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const h = this.heightAt(cx, cz);
        if (h <= feetY + PLAYER.step && h > g) g = h;
      }
    return g;
  }

  // Raycast 3D contra la rejilla y el suelo. Devuelve {dist, nx, ny, nz} o null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    const tFloor = dy < 0 ? -oy / dy : Infinity;
    const limit = Math.min(maxDist, tFloor);
    let cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? CELL / Math.abs(dx) : Infinity;
    const tdz = dz !== 0 ? CELL / Math.abs(dz) : Infinity;
    let tmx = dx > 0 ? ((cx + 1) * CELL - ox) / dx : dx < 0 ? (cx * CELL - ox) / dx : Infinity;
    let tmz = dz > 0 ? ((cz + 1) * CELL - oz) / dz : dz < 0 ? (cz * CELL - oz) / dz : Infinity;
    let t = 0, axis = -1;
    for (let guard = 0; guard < 512; guard++) {
      const tExit = Math.min(tmx, tmz, limit);
      const h = this.heightAt(cx, cz);
      if (h > 0) {
        const yIn = oy + dy * t, yOut = oy + dy * tExit;
        if (yIn < h) {
          if (axis === 0) return { dist: t, nx: -stepX, ny: 0, nz: 0 };
          if (axis === 1) return { dist: t, nx: 0, ny: 0, nz: -stepZ };
          return { dist: 0, nx: 0, ny: 1, nz: 0 };
        }
        if (yOut < h && dy < 0) return { dist: (h - oy) / dy, nx: 0, ny: 1, nz: 0 };
      }
      if (tExit >= limit) break;
      if (tmx < tmz) { cx += stepX; t = tmx; tmx += tdx; axis = 0; }
      else { cz += stepZ; t = tmz; tmz += tdz; axis = 1; }
    }
    if (tFloor <= maxDist) return { dist: tFloor, nx: 0, ny: 1, nz: 0 };
    return null;
  }

  // Línea de visión entre dos puntos 3D.
  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return true;
    const hit = this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d);
    return !hit || hit.dist >= d - 0.05;
  }

  // ¿Puede un jugador caminar en línea recta de a a b (en el suelo)?
  clearPath(ax, az, bx, bz, r = PLAYER.radius + 0.05) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / 0.3));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      if (this.collides(ax + (bx - ax) * k, az + (bz - az) * k, 0, r)) return false;
    }
    return true;
  }

  // Puntos de cobertura: celdas transitables pegadas a un obstáculo.
  _buildCover() {
    const out = [];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let cz = 0; cz < this.h; cz++)
      for (let cx = 0; cx < this.w; cx++) {
        if (!this.walkableCell(cx, cz)) continue;
        for (const [ox, oz] of dirs) {
          const h = this.heightAt(cx + ox, cz + oz);
          if (h <= 0 || h >= 99) continue;
          if (cx + ox <= 0 || cz + oz <= 0 || cx + ox >= this.w - 1 || cz + oz >= this.h - 1) continue; // muros exteriores
          out.push({
            x: (cx + 0.5) * CELL + ox * 0.45,
            z: (cz + 0.5) * CELL + oz * 0.45,
            nx: -ox, nz: -oz,   // normal: dirección hacia la que "mira" la cobertura (lejos del obstáculo)
            low: h < 1.5,
            cx, cz,
          });
        }
      }
    return out;
  }
}
