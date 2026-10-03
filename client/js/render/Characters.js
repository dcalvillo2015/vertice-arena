// Modelos de personaje originales (low-poly a base de cajas), con animación de caminar,
// agacharse, apuntar, muerte, LOD por distancia y etiqueta de nombre para aliados.
import * as THREE from 'three';
import { WEAPONS } from '/shared/weapons.js';

const TEAM_COLORS = [0x3d6bff, 0xffa62b];
const FFA_COLORS = [0x3d6bff, 0xffa62b, 0x4fd18b, 0xe25cff, 0xff5d5d, 0x5ce1ff, 0xf2e45c, 0xc28cff, 0xff8fb1, 0x9be35c, 0xffffff, 0x8f9bb3];
export function colorFor(team, id) { return team >= 0 ? TEAM_COLORS[team] : FFA_COLORS[id % FFA_COLORS.length]; }

const geo = {
  leg: new THREE.BoxGeometry(0.19, 0.86, 0.22).translate(0, -0.43, 0),
  torso: new THREE.BoxGeometry(0.52, 0.62, 0.3),
  vest: new THREE.BoxGeometry(0.56, 0.36, 0.34),
  head: new THREE.BoxGeometry(0.28, 0.3, 0.3),
  visor: new THREE.BoxGeometry(0.24, 0.07, 0.04),
  arm: new THREE.BoxGeometry(0.13, 0.13, 0.5).translate(0, 0, -0.22),
  gun: new THREE.BoxGeometry(0.07, 0.11, 1).translate(0, 0, -0.5),
  low: new THREE.BoxGeometry(0.5, 1.75, 0.32).translate(0, 0.875, 0),
};
const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts }));
  return matCache.get(key);
}
const WEAPON_IDS = Object.keys(WEAPONS);

export class CharacterModel {
  constructor({ team, id, name, ally }) {
    const color = colorFor(team, id);
    const dark = new THREE.Color(color).multiplyScalar(0.35).getHex();
    this.root = new THREE.Group();
    const body = this.body = new THREE.Group();
    this.root.add(body);

    this.hip = new THREE.Group(); this.hip.position.y = 0.9; body.add(this.hip);
    this.legL = new THREE.Mesh(geo.leg, mat(0x2a2f3a)); this.legL.position.x = -0.13;
    this.legR = new THREE.Mesh(geo.leg, mat(0x2a2f3a)); this.legR.position.x = 0.13;
    this.hip.add(this.legL, this.legR);

    this.chest = new THREE.Group(); this.chest.position.y = 0.32; this.hip.add(this.chest);
    const torso = new THREE.Mesh(geo.torso, mat(color)); torso.position.y = 0;
    const vest = new THREE.Mesh(geo.vest, mat(dark)); vest.position.y = 0.06;
    this.chest.add(torso, vest);
    this.headG = new THREE.Group(); this.headG.position.y = 0.48; this.chest.add(this.headG);
    const head = new THREE.Mesh(geo.head, mat(0x3a3f4a));
    const visor = new THREE.Mesh(geo.visor, mat(color, { emissive: color, emissiveIntensity: 0.8 }));
    visor.position.set(0, 0.02, -0.16);
    this.headG.add(head, visor);

    this.arms = new THREE.Group(); this.arms.position.set(0, 0.18, -0.05); this.chest.add(this.arms);
    const armL = new THREE.Mesh(geo.arm, mat(color)); armL.position.set(-0.2, 0, 0); armL.rotation.y = 0.35;
    const armR = new THREE.Mesh(geo.arm, mat(color)); armR.position.set(0.2, 0, 0); armR.rotation.y = -0.1;
    this.gun = new THREE.Mesh(geo.gun, mat(0x23262d));
    this.gun.position.set(0.1, -0.02, -0.25);
    this.arms.add(armL, armR, this.gun);
    this.muzzle = new THREE.Object3D(); this.gun.add(this.muzzle);

    this.low = new THREE.Mesh(geo.low, mat(color));
    this.low.visible = false;
    this.root.add(this.low);

    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });

    if (ally && name) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 64;
      const g = c.getContext('2d');
      g.font = '600 34px "Chakra Petch", sans-serif'; g.textAlign = 'center';
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(name, 128, 44);
      g.fillStyle = '#' + new THREE.Color(color).getHexString(); g.fillText(name, 128, 44);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      this.tag.scale.set(2.4, 0.6, 1);
      this.tag.position.y = 2.25;
      this.tag.renderOrder = 10;
      this.root.add(this.tag);
    }
    this.phase = 0;
    this.dead = false;
    this.deadT = 0;
    this.weaponIdx = -1;
    this.lastPos = null;
    this.speed = 0;
  }

  setWeapon(idx) {
    if (idx === this.weaponIdx) return;
    this.weaponIdx = idx;
    const w = WEAPONS[WEAPON_IDS[idx]];
    if (!w) return;
    const len = w.kind === 'melee' ? 0.3 : w.model.len;
    this.gun.scale.set(1, w.kind === 'pistol' ? 0.9 : 1, len);
    this.gun.material = mat(w.model.color);
    this.muzzle.position.set(0, 0, -1);
  }

  muzzleWorld(out) { return this.muzzle.getWorldPosition(out); }

  die() { if (!this.dead) { this.dead = true; this.deadT = 0; } }
  revive() { this.dead = false; this.deadT = 0; this.root.rotation.set(0, this.root.rotation.y, 0); this.body.position.y = 0; this.root.visible = true; }

  update(s, dt, camPos) {
    const root = this.root;
    if (this.dead) {
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.35);
      this.body.rotation.x = k * 1.45;
      this.body.position.y = -Math.max(0, this.deadT - 2) * 0.6;
      root.visible = this.deadT < 3.2;
      return;
    }
    this.body.rotation.x = 0;
    root.visible = s.alive;
    if (!s.alive) return;
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = s.yaw;
    if (this.lastPos) {
      const v = Math.hypot(s.x - this.lastPos[0], s.z - this.lastPos[1]) / Math.max(dt, 1e-3);
      this.speed += (Math.min(9, v) - this.speed) * Math.min(1, dt * 10);
    }
    this.lastPos = [s.x, s.z];
    const far = camPos ? Math.hypot(camPos.x - s.x, camPos.z - s.z) > 55 : false;
    this.body.visible = !far;
    this.low.visible = far;
    if (far) { this.low.scale.y = 1 - s.crouch * 0.35; return; }
    // Agacharse
    const c = s.crouch;
    this.hip.position.y = 0.9 - 0.42 * c;
    this.legL.scale.y = this.legR.scale.y = 1 - 0.5 * c;
    // Caminar
    const sp = Math.min(1, this.speed / 5);
    this.phase += dt * (4 + this.speed * 1.3);
    const swing = Math.sin(this.phase) * 0.7 * sp;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.chest.rotation.x = s.sprint ? 0.25 : 0;
    this.chest.position.y = 0.32 + Math.abs(Math.cos(this.phase)) * 0.04 * sp;
    // Apuntar
    this.arms.rotation.x = s.sprint ? -0.6 : s.pitch;
    this.headG.rotation.x = s.pitch * 0.6;
    this.arms.position.z = s.ads ? -0.12 : -0.05;
    if (s.reloading) this.arms.rotation.x = -0.5 + Math.sin(this.phase * 2) * 0.1;
  }
}
