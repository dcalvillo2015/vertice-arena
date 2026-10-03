// Arma en primera persona (escena propia para que no atraviese paredes).
import * as THREE from 'three';
import { WEAPONS } from '/shared/weapons.js';

function flashTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 60);
  grd.addColorStop(0, 'rgba(255,255,230,1)'); grd.addColorStop(0.25, 'rgba(255,200,90,0.9)'); grd.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grd;
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, r = i % 2 ? 26 : 62;
    g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const FLASH_TEX = (() => { try { return flashTexture(); } catch { return null; } })();

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(1, 2, 1); this.scene.add(d);
    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.models = {};
    this.current = null;
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ map: FLASH_TEX, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flash.visible = false;
    this.flashT = 0;
    this.kickZ = 0; this.kickRot = 0; this.kickV = 0;
    this.sway = new THREE.Vector2();
    this.bobT = 0;
    this.swingT = 0;
    this.hip = new THREE.Vector3(0.2, -0.205, -0.5);
    this.adsPos = new THREE.Vector3(0, -0.092, -0.4);
  }

  build(id) {
    const w = WEAPONS[id];
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: w.model.color, roughness: 0.5, metalness: 0.4 });
    const accent = new THREE.MeshStandardMaterial({ color: w.model.accent, roughness: 0.4, metalness: 0.2, emissive: w.model.accent, emissiveIntensity: 0.15 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.9 });
    const add = (geom, m, x, y, z, rx = 0) => { const mesh = new THREE.Mesh(geom, m); mesh.position.set(x, y, z); mesh.rotation.x = rx; g.add(mesh); return mesh; };
    const L = w.model.len;
    let muzzleZ;
    if (w.kind === 'melee') {
      add(new THREE.BoxGeometry(0.035, 0.04, 0.12), glove, 0, 0, 0.02);
      const blade = add(new THREE.BoxGeometry(0.008, 0.035, 0.2), new THREE.MeshStandardMaterial({ color: 0xcfd6de, metalness: 0.9, roughness: 0.25 }), 0, 0.005, -0.14);
      blade.scale.y = 1;
      add(new THREE.BoxGeometry(0.06, 0.012, 0.012), accent, 0, 0, -0.04);
      add(new THREE.BoxGeometry(0.07, 0.08, 0.1), glove, 0, -0.01, 0.06);
      muzzleZ = -0.25;
    } else {
      add(new THREE.BoxGeometry(0.06, 0.085, L * 0.55), body, 0, 0, -L * 0.2);                          // cajón de mecanismos
      const barrel = add(new THREE.CylinderGeometry(0.014, 0.014, L * 0.5, 8), body, 0, 0.018, -L * 0.62, Math.PI / 2);
      barrel.material = body;
      add(new THREE.BoxGeometry(0.03, 0.008, L * 0.3), accent, 0, 0.047, -L * 0.25);                   // riel con color de acento
      add(new THREE.BoxGeometry(0.064, 0.02, L * 0.22), accent, 0, -0.03, -L * 0.42);                  // guardamanos
      if (w.kind !== 'pistol') add(new THREE.BoxGeometry(0.05, 0.075, 0.2), body, 0, -0.012, 0.15);   // culata
      const magH = w.kind === 'lmg' ? 0.09 : w.kind === 'shotgun' ? 0.04 : 0.12;
      if (w.kind === 'lmg') add(new THREE.BoxGeometry(0.1, magH, 0.12), accent, 0, -0.07, -L * 0.2);
      else if (w.kind === 'shotgun') add(new THREE.BoxGeometry(0.055, 0.045, 0.18), accent, 0, -0.045, -L * 0.55);
      else add(new THREE.BoxGeometry(0.04, magH, 0.05), body, 0, -0.09, -L * 0.18, -0.15);
      add(new THREE.BoxGeometry(0.035, 0.08, 0.04), glove, 0, -0.075, -0.02, 0.2);                  // empuñadura
      if (w.kind === 'sniper') {
        add(new THREE.CylinderGeometry(0.028, 0.028, 0.26, 12), new THREE.MeshStandardMaterial({ color: 0x15181d, metalness: 0.6, roughness: 0.3 }), 0, 0.09, -L * 0.25, Math.PI / 2);
      } else if (w.kind !== 'pistol') {
        add(new THREE.BoxGeometry(0.008, 0.026, 0.012), accent, -0.012, 0.062, -L * 0.05);            // alza (dos postes)
        add(new THREE.BoxGeometry(0.008, 0.026, 0.012), accent, 0.012, 0.062, -L * 0.05);
        add(new THREE.BoxGeometry(0.005, 0.03, 0.008), accent, 0, 0.034, -L * 0.85);               // punto de mira
      } else {
        add(new THREE.BoxGeometry(0.012, 0.018, 0.012), accent, 0, 0.05, -0.02);
      }
      // manos
      add(new THREE.BoxGeometry(0.07, 0.07, 0.1), glove, 0.01, -0.07, 0.01);
      if (w.kind !== 'pistol') add(new THREE.BoxGeometry(0.07, 0.06, 0.1), glove, -0.02, -0.045, -L * 0.48);
      else add(new THREE.BoxGeometry(0.07, 0.07, 0.09), glove, -0.03, -0.08, 0.02);
      muzzleZ = -L * 0.88;
    }
    g.userData.muzzleZ = muzzleZ;
    g.traverse((o) => { if (o.isMesh) o.renderOrder = 1; });
    return g;
  }

  setWeapon(id) {
    if (this.currentId === id) return;
    if (this.current) this.holder.remove(this.current);
    if (!this.models[id]) this.models[id] = this.build(id);
    this.current = this.models[id];
    this.currentId = id;
    this.holder.add(this.current);
    this.current.add(this.flash);
    this.flash.position.set(0, 0.018, this.current.userData.muzzleZ - 0.06);
    this.raise = 1;
  }

  fire(w) {
    if (w.kind === 'melee') { this.swingT = 0.35; return; }
    this.kickV += w.kind === 'sniper' || w.kind === 'shotgun' ? 0.09 : 0.03;
    this.kickRot += w.kind === 'sniper' || w.kind === 'shotgun' ? 0.14 : 0.025;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.6);
    this.flashT = 0.045;
  }

  update(dt, st) {
    if (!this.current) return;
    this.camera.aspect = st.aspect;
    this.camera.updateProjectionMatrix();
    const ads = st.ads;
    // posición base
    const pos = new THREE.Vector3().lerpVectors(this.hip, this.adsPos, ads);
    // balanceo al caminar
    const sp = st.onGround ? Math.min(1, st.speed / 6) : 0;
    this.bobT += dt * (6 + st.speed * 1.2);
    const bobAmt = (1 - ads * 0.85) * sp;
    pos.x += Math.cos(this.bobT) * 0.012 * bobAmt;
    pos.y += Math.abs(Math.sin(this.bobT)) * 0.014 * bobAmt;
    // inercia al mirar
    this.sway.x += (-st.lookDx * 0.0004 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (st.lookDy * 0.0004 - this.sway.y) * Math.min(1, dt * 10);
    pos.x += this.sway.x * (1 - ads * 0.8);
    pos.y += this.sway.y * (1 - ads * 0.8);
    // retroceso (muelle)
    this.kickZ += this.kickV; this.kickV = 0;
    this.kickZ += (0 - this.kickZ) * Math.min(1, dt * 18);
    this.kickRot += (0 - this.kickRot) * Math.min(1, dt * 14);
    pos.z += this.kickZ;
    let rx = this.kickRot, ry = 0, rz = 0;
    // sprint
    if (st.sprint) { rx -= 0.35; ry += 0.6; pos.x += 0.03; pos.y -= 0.06; }
    // recarga
    if (st.reload > 0) { const k = Math.sin(Math.min(1, st.reload) * Math.PI); rx -= 0.6 * k; rz += 0.5 * k; pos.y -= 0.08 * k; }
    // cambio de arma
    if (st.switching > 0) { pos.y -= 0.25 * st.switching; rx -= 0.6 * st.switching; }
    // cuchillazo
    if (this.swingT > 0) {
      this.swingT -= dt;
      const k = Math.sin((1 - this.swingT / 0.35) * Math.PI);
      ry += 0.9 * k; pos.x -= 0.15 * k; pos.z -= 0.12 * k;
    }
    this.current.position.copy(pos);
    this.current.rotation.set(rx, ry, rz);
    this.current.visible = !st.hidden;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
  }

  render(renderer) {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
