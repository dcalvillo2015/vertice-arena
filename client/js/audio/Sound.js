// Sonido sintetizado con Web Audio (sin archivos externos): disparos por arma, impactos,
// recargas, pasos y avisos. Los sonidos de otros jugadores son posicionales.
export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.lastShot = new Map();
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5;
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  setListener(pos, fwd) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(pos.x, t); l.positionY.setValueAtTime(pos.y, t); l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t); l.forwardY.setValueAtTime(fwd.y, t); l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else if (l.setPosition) {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  out(pos) {
    if (!pos) return this.master;
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 4; p.rolloffFactor = 1.1; p.maxDistance = 120;
    if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; }
    else p.setPosition(pos[0], pos[1], pos[2]);
    p.connect(this.master);
    return p;
  }

  noiseBurst({ dest, freq = 1000, q = 0.8, type = 'bandpass', gain = 0.8, attack = 0.002, decay = 0.15, when = 0 }) {
    const c = this.ctx, t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + decay + 0.05);
  }

  tone({ dest, freq = 440, to = null, type = 'sine', gain = 0.3, decay = 0.1, when = 0 }) {
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + decay);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + decay + 0.05);
  }

  gunshot(weapon, pos = null, entityId = 0) {
    if (!this.ensure()) return;
    // limitar la frecuencia por entidad para no saturar
    const now = this.ctx.currentTime;
    if (pos && now - (this.lastShot.get(entityId) || 0) < 0.04) return;
    this.lastShot.set(entityId, now);
    const s = weapon.snd;
    const dest = this.out(pos);
    const local = !pos;
    this.noiseBurst({ dest, freq: s.f, q: 0.7, gain: s.gain * (local ? 0.75 : 1), decay: s.decay });
    this.noiseBurst({ dest, freq: s.f * 3, q: 1.5, type: 'highpass', gain: s.gain * 0.35, decay: s.decay * 0.4 });
    if (s.thump) this.tone({ dest, freq: s.thump * 1.6, to: s.thump * 0.6, gain: s.gain * 0.55, decay: 0.12 });
    if (weapon.kind === 'sniper' || weapon.kind === 'shotgun') {
      this.noiseBurst({ dest, freq: 300, q: 0.5, type: 'lowpass', gain: 0.35, decay: 0.5, when: 0.03 });
    }
  }

  knife(pos = null) {
    if (!this.ensure()) return;
    this.noiseBurst({ dest: this.out(pos), freq: 3500, q: 2, type: 'bandpass', gain: 0.25, decay: 0.12 });
  }

  hit(head) {
    if (!this.ensure()) return;
    this.tone({ dest: this.master, freq: head ? 1900 : 1300, type: 'square', gain: 0.07, decay: 0.05 });
    if (head) this.tone({ dest: this.master, freq: 2600, type: 'sine', gain: 0.12, decay: 0.18, when: 0.02 });
  }

  killConfirm() {
    if (!this.ensure()) return;
    this.tone({ dest: this.master, freq: 660, type: 'triangle', gain: 0.18, decay: 0.12 });
    this.tone({ dest: this.master, freq: 990, type: 'triangle', gain: 0.18, decay: 0.2, when: 0.08 });
  }

  hurt() {
    if (!this.ensure()) return;
    this.noiseBurst({ dest: this.master, freq: 180, type: 'lowpass', gain: 0.5, decay: 0.18 });
  }

  reload(dur) {
    if (!this.ensure()) return;
    this.noiseBurst({ dest: this.master, freq: 2400, q: 4, gain: 0.25, decay: 0.05, when: 0.05 });
    this.noiseBurst({ dest: this.master, freq: 1800, q: 4, gain: 0.3, decay: 0.06, when: dur * 0.55 });
    this.noiseBurst({ dest: this.master, freq: 2800, q: 5, gain: 0.3, decay: 0.05, when: Math.max(0.1, dur - 0.15) });
  }

  empty() {
    if (!this.ensure()) return;
    this.noiseBurst({ dest: this.master, freq: 3200, q: 6, gain: 0.2, decay: 0.03 });
  }

  swap() {
    if (!this.ensure()) return;
    this.noiseBurst({ dest: this.master, freq: 1500, q: 3, gain: 0.15, decay: 0.08 });
  }

  step(pos, loud = 1) {
    if (!this.ensure()) return;
    this.noiseBurst({ dest: this.out(pos), freq: 220, q: 0.9, type: 'lowpass', gain: 0.22 * loud, decay: 0.07 });
  }

  countdown(final) {
    if (!this.ensure()) return;
    this.tone({ dest: this.master, freq: final ? 880 : 520, type: 'triangle', gain: 0.2, decay: final ? 0.4 : 0.15 });
  }
}
