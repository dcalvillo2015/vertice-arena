// Construye la escena 3D del mapa a partir de MapData (geometría instanciada, luces, niebla).
import * as THREE from 'three';
import { CELL } from '/shared/constants.js';

function canvasTex(size, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class World {
  constructor(map, { shadows = true } = {}) {
    this.map = map;
    const th = map.def.theme;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(th.sky);
    scene.fog = new THREE.Fog(th.fog, 45, 150);

    // Luces
    const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x4a4036, 1.1);
    scene.add(hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.set(map.width * 0.5 - 30, 55, map.depth * 0.5 - 20);
    sun.target.position.set(map.width / 2, 0, map.depth / 2);
    scene.add(sun, sun.target);
    if (shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const s = Math.max(map.width, map.depth) * 0.62;
      Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 5, far: 160 });
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.02;
    }

    // Suelo con baldosas de 1 celda
    const floorTex = canvasTex(256, (g, n) => {
      g.fillStyle = hex(th.floor); g.fillRect(0, 0, n, n);
      for (let i = 0; i < 900; i++) {
        const v = Math.random() * 30 - 15;
        g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 400})`;
        g.fillRect(Math.random() * n, Math.random() * n, 3, 3);
      }
      g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 3; g.strokeRect(0, 0, n, n);
      g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1; g.strokeRect(4, 4, n - 8, n - 8);
    }, [map.w, map.h]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.width, map.depth),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(map.width / 2, 0, map.depth / 2);
    floor.receiveShadow = true;
    scene.add(floor);

    // Terreno exterior
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: new THREE.Color(th.floor).multiplyScalar(0.7) }));
    outside.rotation.x = -Math.PI / 2;
    outside.position.set(map.width / 2, -0.02, map.depth / 2);
    scene.add(outside);

    this.buildBlocks(th, shadows);
    this.buildMarkers(th);
    this.buildSkyline(th);
  }

  buildBlocks(th, shadows) {
    const map = this.map, scene = this.scene;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const walls = [], tall = [], crates = [];
    // Muros: fusionar tramos horizontales de la misma altura
    for (let z = 0; z < map.h; z++) {
      let x = 0;
      while (x < map.w) {
        const h = map.heightAt(x, z);
        if (h >= 4) {
          let x2 = x;
          while (x2 + 1 < map.w && map.heightAt(x2 + 1, z) === h) x2++;
          walls.push({ x0: x, x1: x2, z, h });
          x = x2 + 1;
        } else {
          if (h > 1.5) tall.push({ x, z, h });
          else if (h > 0) crates.push({ x, z, h });
          x++;
        }
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const wallMesh = new THREE.InstancedMesh(box, wallMat, walls.length);
    const trimMesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: th.wallTop, roughness: 0.6 }), walls.length);
    const baseMesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: new THREE.Color(th.wall).multiplyScalar(0.55), roughness: 0.9 }), walls.length);
    walls.forEach((w, i) => {
      const len = (w.x1 - w.x0 + 1) * CELL;
      p.set((w.x0 * CELL) + len / 2, w.h / 2, (w.z + 0.5) * CELL);
      s.set(len, w.h, CELL);
      wallMesh.setMatrixAt(i, m4.compose(p, q, s));
      col.set(th.wall).multiplyScalar(0.92 + Math.random() * 0.12);
      wallMesh.setColorAt(i, col);
      p.set((w.x0 * CELL) + len / 2, w.h + 0.06, (w.z + 0.5) * CELL);
      s.set(len + 0.02, 0.12, CELL + 0.02);
      trimMesh.setMatrixAt(i, m4.compose(p, q, s));
      p.set((w.x0 * CELL) + len / 2, 0.2, (w.z + 0.5) * CELL);
      s.set(len + 0.04, 0.4, CELL + 0.04);
      baseMesh.setMatrixAt(i, m4.compose(p, q, s));
    });
    for (const m of [wallMesh, trimMesh, baseMesh]) { m.castShadow = shadows; m.receiveShadow = true; scene.add(m); }

    // Cajas bajas
    const crateTex = canvasTex(128, (g, n) => {
      g.fillStyle = hex(th.crate); g.fillRect(0, 0, n, n);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 8; g.strokeRect(4, 4, n - 8, n - 8);
      g.lineWidth = 6; g.beginPath(); g.moveTo(8, 8); g.lineTo(n - 8, n - 8); g.moveTo(n - 8, 8); g.lineTo(8, n - 8); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.06)';
      for (let i = 1; i < 6; i++) g.fillRect(0, i * n / 6, n, 2);
    });
    const crateMesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.8 }), Math.max(1, crates.length));
    crateMesh.count = crates.length;
    crates.forEach((c, i) => {
      p.set((c.x + 0.5) * CELL, c.h / 2, (c.z + 0.5) * CELL);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.04);
      s.set(CELL * 0.96, c.h, CELL * 0.96);
      crateMesh.setMatrixAt(i, m4.compose(p, q, s));
    });
    q.identity();
    crateMesh.castShadow = shadows; crateMesh.receiveShadow = true;
    scene.add(crateMesh);

    // Cajas altas (contenedores / tanques)
    const tallTex = canvasTex(128, (g, n) => {
      g.fillStyle = hex(th.tall); g.fillRect(0, 0, n, n);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let i = 0; i < 8; i++) g.fillRect(i * n / 8, 0, 5, n);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, n, 6);
    });
    const tallMesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ map: tallTex, roughness: 0.6, metalness: 0.05 }), Math.max(1, tall.length));
    tallMesh.count = tall.length;
    tall.forEach((c, i) => {
      p.set((c.x + 0.5) * CELL, c.h / 2, (c.z + 0.5) * CELL);
      s.set(CELL * 0.98, c.h, CELL * 0.98);
      tallMesh.setMatrixAt(i, m4.compose(p, q, s));
    });
    tallMesh.castShadow = shadows; tallMesh.receiveShadow = true;
    scene.add(tallMesh);
  }

  buildMarkers(th) {
    const map = this.map;
    const ring = new THREE.RingGeometry(0.55, 0.8, 24);
    const mats = [
      new THREE.MeshBasicMaterial({ color: 0x3d6bff, transparent: true, opacity: 0.45, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: 0xffa62b, transparent: true, opacity: 0.45, depthWrite: false }),
    ];
    for (const team of [0, 1]) {
      for (const sp of map.spawns[team]) {
        const m = new THREE.Mesh(ring, mats[team]);
        m.rotation.x = -Math.PI / 2;
        m.position.set(sp.x, 0.02, sp.z);
        this.scene.add(m);
      }
    }
    const zoneMat = new THREE.MeshBasicMaterial({ color: th.accent, transparent: true, opacity: 0.25, depthWrite: false });
    for (const z of map.zones) {
      const m = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.45, 40), zoneMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(z.x, 0.02, z.z);
      this.scene.add(m);
    }
  }

  buildSkyline(th) {
    const map = this.map;
    const n = 70;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(th.wall).multiplyScalar(0.75) }), n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const cx = map.width / 2, cz = map.depth / 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.05;
      const r = 70 + Math.random() * 50;
      const h = 8 + Math.random() * 30;
      p.set(cx + Math.cos(a) * r, h / 2, cz + Math.sin(a) * r);
      s.set(6 + Math.random() * 14, h, 6 + Math.random() * 14);
      mesh.setMatrixAt(i, m4.compose(p, q, s));
    }
    this.scene.add(mesh);
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
      }
    });
  }
}
