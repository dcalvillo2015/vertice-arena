// Teclado + ratón con Pointer Lock.
export class Input {
  constructor(element) {
    this.el = element;
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.dx = 0; this.dy = 0;
    this.actions = [];
    this.locked = false;
    this.enabled = true;
    this.onLockChange = () => {};
    this._h = {
      keydown: (e) => this.keydown(e),
      keyup: (e) => { this.keys.delete(e.code); if (e.code === 'Tab') this.actions.push('scoreboard-off'); },
      mousemove: (e) => { if (this.locked) { this.dx += e.movementX || 0; this.dy += e.movementY || 0; } },
      mousedown: (e) => {
        if (!this.locked) return;
        if (e.button === 0) this.mouse.left = true;
        if (e.button === 2) this.mouse.right = true;
      },
      mouseup: (e) => {
        if (e.button === 0) this.mouse.left = false;
        if (e.button === 2) this.mouse.right = false;
      },
      wheel: (e) => { if (this.locked) this.actions.push(e.deltaY > 0 ? 'next' : 'prev'); },
      contextmenu: (e) => e.preventDefault(),
      lockchange: () => {
        this.locked = document.pointerLockElement === this.el;
        if (!this.locked) { this.keys.clear(); this.mouse.left = this.mouse.right = false; }
        this.onLockChange(this.locked);
      },
      blur: () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; },
    };
    document.addEventListener('keydown', this._h.keydown);
    document.addEventListener('keyup', this._h.keyup);
    document.addEventListener('mousemove', this._h.mousemove);
    document.addEventListener('mousedown', this._h.mousedown);
    document.addEventListener('mouseup', this._h.mouseup);
    document.addEventListener('wheel', this._h.wheel, { passive: true });
    document.addEventListener('contextmenu', this._h.contextmenu);
    document.addEventListener('pointerlockchange', this._h.lockchange);
    window.addEventListener('blur', this._h.blur);
  }

  keydown(e) {
    if (!this.enabled) return;
    if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) this.actions.push('scoreboard-on'); return; }
    if (!this.locked) {
      // Elegir arma estando muerto también funciona sin captura del ratón
      if (/^Digit[1-6]$/.test(e.code)) this.actions.push('digit' + e.code.slice(5));
      return;
    }
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft', 'KeyC'].includes(e.code)) e.preventDefault();
    if (!e.repeat) {
      if (e.code === 'KeyR') this.actions.push('reload');
      else if (/^Digit[1-6]$/.test(e.code)) this.actions.push('digit' + e.code.slice(5));
      else if (e.code === 'KeyQ') this.actions.push('last');
    }
    this.keys.add(e.code);
  }

  lock() {
    if (this.locked) return;
    const p = this.el.requestPointerLock?.({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => this.el.requestPointerLock?.());
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  consumeLook() { const r = [this.dx, this.dy]; this.dx = 0; this.dy = 0; return r; }
  consumeActions() { const a = this.actions; this.actions = []; return a; }

  dispose() {
    document.removeEventListener('keydown', this._h.keydown);
    document.removeEventListener('keyup', this._h.keyup);
    document.removeEventListener('mousemove', this._h.mousemove);
    document.removeEventListener('mousedown', this._h.mousedown);
    document.removeEventListener('mouseup', this._h.mouseup);
    document.removeEventListener('wheel', this._h.wheel);
    document.removeEventListener('contextmenu', this._h.contextmenu);
    document.removeEventListener('pointerlockchange', this._h.lockchange);
    window.removeEventListener('blur', this._h.blur);
    this.unlock();
  }
}
