// Movimiento del jugador (determinista, compartido por servidor, bots y predicción del cliente)
// y pruebas de impacto contra hitboxes.
import { PLAYER, BTN } from './constants.js';

export function createMoveState(x = 0, y = 0, z = 0) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: true, crouch: 0 };
}

export function copyMoveState(dst, src) {
  dst.x = src.x; dst.y = src.y; dst.z = src.z;
  dst.vx = src.vx; dst.vy = src.vy; dst.vz = src.vz;
  dst.onGround = src.onGround; dst.crouch = src.crouch;
  return dst;
}

export function eyeHeight(crouch) {
  return PLAYER.standEye + (PLAYER.crouchEye - PLAYER.standEye) * crouch;
}

export function bodyHeight(crouch) {
  return PLAYER.standHeight + (PLAYER.crouchHeight - PLAYER.standHeight) * crouch;
}

// cmd: { mx (strafe -1..1), mz (avance -1..1), b (botones), y (yaw), dt }
// moveMul: multiplicador de velocidad del arma equipada.
// Devuelve true si el jugador está esprintando.
export function stepMove(s, cmd, dt, map, moveMul = 1) {
  const b = cmd.b | 0;
  const wantCrouch = (b & BTN.CROUCH) !== 0;
  const target = wantCrouch ? 1 : 0;
  const cr = 8 * dt;
  s.crouch = s.crouch < target ? Math.min(target, s.crouch + cr) : Math.max(target, s.crouch - cr);

  let mx = Math.max(-1, Math.min(1, cmd.mx || 0));
  let mz = Math.max(-1, Math.min(1, cmd.mz || 0));
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }

  const ads = (b & BTN.ADS) !== 0;
  const firing = (b & BTN.FIRE) !== 0;
  const sprinting = (b & BTN.SPRINT) !== 0 && mz > 0.6 && !ads && !firing && s.crouch < 0.3;
  let speed = PLAYER.walk;
  if (s.crouch > 0.5) speed = PLAYER.crouchSpeed;
  else if (ads) speed = PLAYER.adsSpeed;
  else if (sprinting) speed = PLAYER.sprint;
  speed *= moveMul;

  // forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)  (convención de cámara de Three.js)
  const sy = Math.sin(cmd.y || 0), cy = Math.cos(cmd.y || 0);
  const tvx = (-sy * mz + cy * mx) * speed;
  const tvz = (-cy * mz - sy * mx) * speed;
  const accel = (s.onGround ? PLAYER.accelGround : PLAYER.accelAir) * dt;
  s.vx += clampMag(tvx - s.vx, accel);
  s.vz += clampMag(tvz - s.vz, accel);

  if ((b & BTN.JUMP) && s.onGround && s.crouch < 0.5) {
    s.vy = PLAYER.jumpVel;
    s.onGround = false;
  }
  s.vy -= PLAYER.gravity * dt;

  const nx = s.x + s.vx * dt;
  if (!map.collides(nx, s.z, s.y)) s.x = nx; else s.vx = 0;
  const nz = s.z + s.vz * dt;
  if (!map.collides(s.x, nz, s.y)) s.z = nz; else s.vz = 0;

  s.y += s.vy * dt;
  const g = map.groundHeight(s.x, s.z, Math.max(s.y, 0));
  if (s.y <= g) {
    s.y = g; if (s.vy < 0) s.vy = 0; s.onGround = true;
  } else {
    s.onGround = false;
  }
  if (s.y < -20) { s.y = 0; s.vy = 0; } // red de seguridad
  return sprinting;
}

function clampMag(v, m) { return v > m ? m : v < -m ? -m : v; }

export function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

export function anglesFromDir(dx, dy, dz) {
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return [yaw, pitch];
}

// Impacto de un rayo contra un jugador (pos: {x,y,z,crouch}). Devuelve {dist, head} o null.
export function rayVsPlayer(ox, oy, oz, dx, dy, dz, maxDist, p) {
  const h = bodyHeight(p.crouch);
  // Cabeza: esfera
  const hx = p.x, hy = p.y + h - 0.2, hz = p.z, hr = 0.23;
  const lx = ox - hx, ly = oy - hy, lz = oz - hz;
  const bq = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - hr * hr;
  const disc = bq * bq - c;
  let best = null;
  if (disc >= 0) {
    const t = -bq - Math.sqrt(disc);
    if (t > 0 && t < maxDist) best = { dist: t, head: true };
  }
  // Cuerpo: caja
  const r = 0.33;
  const tb = rayBox(ox, oy, oz, dx, dy, dz, p.x - r, p.y, p.z - r, p.x + r, p.y + h - 0.4, p.z + r);
  if (tb !== null && tb < maxDist && (!best || tb < best.dist)) best = { dist: tb, head: false };
  return best;
}

function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz], lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
    } else {
      let t1 = (lo[i] - o[i]) / d[i], t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return tmin > 0 ? tmin : null;
}
