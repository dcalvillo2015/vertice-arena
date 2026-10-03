// Conexión con el servidor. Si no hay servidor WebSocket disponible, ejecuta las
// salas localmente en el navegador (sólo partidas contra bots).
import { TICK_RATE } from '/shared/constants.js';

export class Net {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.mode = 'none';
    this.ws = null;
  }

  async connect() {
    const ok = await this.tryWebSocket();
    if (ok) { this.mode = 'online'; return 'online'; }
    await this.startLocal();
    this.mode = 'local';
    return 'local';
  }

  tryWebSocket() {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      try {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${proto}//${location.host}/ws`);
        const timer = setTimeout(() => { try { ws.close(); } catch { /* */ } finish(false); }, 2500);
        ws.onopen = () => {
          clearTimeout(timer);
          this.ws = ws;
          ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } this.onMessage(m); };
          ws.onclose = () => { if (this.mode === 'online') this.onMessage({ t: 'disconnected' }); };
          finish(true);
        };
        ws.onerror = () => { clearTimeout(timer); finish(false); };
      } catch { finish(false); }
    });
  }

  async startLocal() {
    const { RoomManager } = await import('/shared/game/RoomManager.js');
    this.manager = new RoomManager();
    this.localId = this.manager.connect((msg) => queueMicrotask(() => this.onMessage(msg)));
    let last = performance.now(), acc = 0;
    const step = 1 / TICK_RATE;
    this.localTimer = setInterval(() => {
      const now = performance.now();
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= step) { this.manager.tick(step); acc -= step; }
    }, 1000 / TICK_RATE / 2);
  }

  send(msg) {
    if (this.mode === 'online' && this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
    else if (this.mode === 'local' && this.manager) this.manager.message(this.localId, msg);
  }
}
