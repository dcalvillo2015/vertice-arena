// Gestor de salas, independiente del transporte (WebSocket en el servidor, o local en el navegador).
import { Room } from './Room.js';
import { TICK_RATE, MODES } from '../constants.js';
import { MAP_LIST } from '../maps.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.clients = new Map();
    this.nextClientId = 1;
  }

  connect(send) {
    const id = this.nextClientId++;
    this.clients.set(id, { id, send, name: 'Jugador', room: null });
    send({ t: 'welcome', id, maps: MAP_LIST, tick: TICK_RATE });
    return id;
  }

  disconnect(id) {
    const c = this.clients.get(id);
    if (!c) return;
    if (c.room) c.room.removeClient(id);
    this.clients.delete(id);
  }

  makeCode() {
    for (;;) {
      let s = '';
      for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(s)) return s;
    }
  }

  createRoom(settings) {
    const code = this.makeCode();
    const room = new Room({
      code, settings,
      send: (cid, msg) => { const c = this.clients.get(cid); if (c) c.send(msg); },
      onEmpty: (r) => this.rooms.delete(r.code),
    });
    this.rooms.set(code, room);
    return room;
  }

  leave(c) {
    if (c.room) { const r = c.room; c.room = null; r.removeClient(c.id); }
  }

  message(id, msg) {
    const c = this.clients.get(id);
    if (!c || !msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'create':
      case 'quick': {
        this.leave(c);
        c.name = msg.name;
        const settings = { ...(msg.settings || {}) };
        if (msg.t === 'quick') {
          // "Jugar contra bots": sala propia que arranca al instante.
          const bots = Math.max(1, Math.min(11, settings.botCount | 0 || 5));
          settings.botCount = bots;
          settings.maxPlayers = Math.min(12, bots + 1);
          settings.fillBots = true;
          if (settings.mode === MODES.TDM_BOTS) settings.maxPlayers = 12;
        }
        const room = this.createRoom(settings);
        c.room = room;
        room.addClient({ id: c.id, name: c.name, primary: msg.primary });
        if (msg.t === 'quick') room.startMatch();
        break;
      }
      case 'join': {
        const code = String(msg.code || '').toUpperCase().trim();
        const room = this.rooms.get(code);
        if (!room) { c.send({ t: 'error', msg: 'No existe ninguna sala con ese código.' }); return; }
        const humans = room.clients.size;
        const bots = [...room.entities.values()].filter((e) => e.isBot).length;
        const full = room.phase === 'lobby' ? humans >= room.settings.maxPlayers
          : humans >= 12 || (humans + bots >= room.settings.maxPlayers && bots === 0);
        if (full) { c.send({ t: 'error', msg: 'La sala está llena.' }); return; }
        this.leave(c);
        c.name = msg.name;
        c.room = room;
        room.addClient({ id: c.id, name: c.name, primary: msg.primary });
        break;
      }
      case 'leave':
        this.leave(c);
        c.send({ t: 'left' });
        break;
      default:
        if (c.room) c.room.handleMessage(id, msg);
    }
  }

  tick(dt) {
    for (const room of this.rooms.values()) {
      try { room.update(dt); }
      catch (err) { console.error(`[sala ${room.code}] error en update:`, err); }
    }
  }
}
