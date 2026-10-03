// Efectos con object pooling: trazadoras, partículas de impacto, marcas de bala y fogonazos.
import * as THREE from 'three';
import { FLASH_TEX } from './ViewModel.js';

const MAX_PARTICLES = 600;
const MAX_TRACERS = 48;
const MAX_DECALS = 80;
const MAX_FLASHES = 12;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    // Trazadoras: cilindros finos estirados
    const tg = new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracers = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(tg, this.tracerMat.clone());
      m.visible = false; m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), len: 0 });
    }
    this.tracerIdx = 0;

    // Partículas: un único THREE.Points
    const pg = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMax = new Float32Array(MAX_PARTICLES);
    this.pBase = new Float32Array(MAX_PARTICLES * 3);
    this.pGrav = new Float32Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) this.pPos[i * 3 + 1] = -999;
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pIdx = 0;
    this.activeParticles = 0;

    // Marcas de bala
    const dc = document.createElement('canvas'); dc.width = dc.height = 32;
    const g = dc.getContext('2d');
    const grd = g.createRadialGradient(16, 16, 1, 16, 16, 15);
    grd.addColorStop(0, 'rgba(10,10,10,0.95)'); grd.addColorStop(0.5, 'rgba(30,30,30,0.6)'); grd.addColorStop(1, 'rgba(30,30,30,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
    const dtex = new THREE.CanvasTexture(dc);
    const dmat = new THREE.MeshBasicMaterial({ map: dtex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const dgeo = new THREE.PlaneGeometry(0.14, 0.14);
    this.decals = [];
    for (let i = 0; i < MAX_DECALS; i++) {
      const m = new THREE.Mesh(dgeo, dmat); m.visible = false; scene.add(m); this.decals.push(m);
    }
    this.decalIdx = 0;

    // Fogonazos de otros jugadores
    const fmat = new THREE.SpriteMaterial({ map: FLASH_TEX, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.flashes = [];
    for (let i = 0; i < MAX_FLASHES; i++) {
      const s = new THREE.Sprite(fmat); s.visible = false; s.scale.setScalar(0.5); scene.add(s);
      this.flashes.push({ s, life: 0 });
    }
    this.flashIdx = 0;
    // Luz de fogonazo (una sola, siempre presente para no recompilar shaders)
    this.light = new THREE.PointLight(0xffc070, 0, 9, 2);
    scene.add(this.light);
    this.lightLife = 0;
  }

  tracer(from, to) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % MAX_TRACERS;
    t.from.copy(from); t.to.copy(to);
    t.len = from.distanceTo(to);
    if (t.len < 1) return;
    t.life = Math.min(0.12, 0.04 + t.len / 900);
    t.max = t.life;
    t.mesh.visible = true;
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
  }

  spawn(x, y, z, vx, vy, vz, r, gC, b, life, grav = 9) {
    const i = this.pIdx;
    this.pIdx = (this.pIdx + 1) % MAX_PARTICLES;
    this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
    this.pVel[i * 3] = vx; this.pVel[i * 3 + 1] = vy; this.pVel[i * 3 + 2] = vz;
    this.pBase[i * 3] = r; this.pBase[i * 3 + 1] = gC; this.pBase[i * 3 + 2] = b;
    this.pLife[i] = life; this.pMax[i] = life; this.pGrav[i] = grav;
  }

  impact(p, n, kind) {
    // kind: 'wall' | 'player'
    const count = kind === 'player' ? 7 : 9;
    for (let i = 0; i < count; i++) {
      const sp = kind === 'player' ? 2 : 4;
      const vx = n[0] * sp + (Math.random() - 0.5) * sp, vy = n[1] * sp + Math.random() * sp * 0.8, vz = n[2] * sp + (Math.random() - 0.5) * sp;
      if (kind === 'player') this.spawn(p.x, p.y, p.z, vx, vy, vz, 0.9, 0.15, 0.2, 0.35, 6);
      else if (i < 4) this.spawn(p.x, p.y, p.z, vx * 1.5, vy * 1.5, vz * 1.5, 1, 0.75, 0.3, 0.25, 12);
      else this.spawn(p.x, p.y, p.z, vx * 0.4, vy * 0.4, vz * 0.4, 0.45, 0.42, 0.38, 0.6, 2);
    }
    this.activeParticles = MAX_PARTICLES;
    if (kind === 'wall') this.decal(p, n);
  }

  decal(p, n) {
    const m = this.decals[this.decalIdx];
    this.decalIdx = (this.decalIdx + 1) % MAX_DECALS;
    m.visible = true;
    m.position.set(p.x + n[0] * 0.012, p.y + n[1] * 0.012, p.z + n[2] * 0.012);
    m.lookAt(p.x + n[0], p.y + n[1], p.z + n[2]);
    m.rotateZ(Math.random() * Math.PI);
  }

  muzzleFlash(pos, withLight = true) {
    const f = this.flashes[this.flashIdx];
    this.flashIdx = (this.flashIdx + 1) % MAX_FLASHES;
    f.s.visible = true; f.s.position.copy(pos); f.life = 0.05;
    f.s.material.rotation = Math.random() * Math.PI;
    f.s.scale.setScalar(0.4 + Math.random() * 0.3);
    if (withLight) { this.light.position.copy(pos); this.light.intensity = 6; this.lightLife = 0.05; }
  }

  localFlash(pos) { this.light.position.copy(pos); this.light.intensity = 5; this.lightLife = 0.05; }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.mesh.visible = false; continue; }
      const k = 1 - t.life / t.max;               // la trazadora "viaja" hacia el destino
      const segLen = Math.min(t.len, 6);
      const start = Math.min(t.len - segLen * 0.3, k * t.len);
      t.mesh.position.copy(t.from).lerp(t.to, start / t.len);
      t.mesh.scale.set(1, 1, Math.max(0.1, Math.min(segLen, t.len - start)));
      t.mesh.material.opacity = 0.85 * (t.life / t.max + 0.3);
    }
    if (this.activeParticles > 0) {
      let alive = 0;
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (this.pLife[i] <= 0) continue;
        this.pLife[i] -= dt;
        const j = i * 3;
        if (this.pLife[i] <= 0) { this.pPos[j + 1] = -999; this.pCol[j] = this.pCol[j + 1] = this.pCol[j + 2] = 0; continue; }
        alive++;
        this.pVel[j + 1] -= this.pGrav[i] * dt;
        this.pPos[j] += this.pVel[j] * dt; this.pPos[j + 1] += this.pVel[j + 1] * dt; this.pPos[j + 2] += this.pVel[j + 2] * dt;
        if (this.pPos[j + 1] < 0.01) { this.pPos[j + 1] = 0.01; this.pVel[j + 1] *= -0.3; }
        const k = this.pLife[i] / this.pMax[i];
        this.pCol[j] = this.pBase[j] * k; this.pCol[j + 1] = this.pBase[j + 1] * k; this.pCol[j + 2] = this.pBase[j + 2] * k;
      }
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
      this.activeParticles = alive;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) f.s.visible = false;
    }
    if (this.lightLife > 0) { this.lightLife -= dt; if (this.lightLife <= 0) this.light.intensity = 0; }
  }
}
