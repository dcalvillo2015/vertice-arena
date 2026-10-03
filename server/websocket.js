// Implementación mínima de WebSocket (RFC 6455) sin dependencias externas.
// Soporta frames de texto, fragmentación, ping/pong y cierre.
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 1 << 20;

export class WSConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    this.fragOpcode = 0;
    this.open = true;
    this.lastPong = Date.now();
    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  send(text) {
    if (!this.open) return;
    const payload = Buffer.from(text, 'utf8');
    this._writeFrame(0x1, payload);
  }

  ping() { if (this.open) this._writeFrame(0x9, Buffer.alloc(0)); }

  close(code = 1000) {
    if (!this.open) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code, 0);
    this._writeFrame(0x8, b);
    this.socket.end();
    this._closed();
  }

  _writeFrame(opcode, payload) {
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
    }
    try { this.socket.write(Buffer.concat([header, payload])); } catch { this._closed(); }
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.open) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) { this.close(1009); return; }
        len = Number(big); off = 10;
      }
      if (len > MAX_PAYLOAD) { this.close(1009); return; }
      if (!masked) { this.close(1002); return; } // los clientes siempre enmascaran
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const data = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) data[i] = b[off + 4 + i] ^ mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this._handleFrame(fin, opcode, data);
    }
  }

  _handleFrame(fin, opcode, data) {
    switch (opcode) {
      case 0x0: // continuación
        this.fragments.push(data);
        if (fin) {
          const all = Buffer.concat(this.fragments);
          this.fragments = [];
          if (this.fragOpcode === 0x1) this.emit('message', all.toString('utf8'));
        }
        break;
      case 0x1:
      case 0x2:
        if (fin) { if (opcode === 0x1) this.emit('message', data.toString('utf8')); }
        else { this.fragOpcode = opcode; this.fragments = [data]; }
        break;
      case 0x8: this.close(); break;
      case 0x9: this._writeFrame(0xA, data); break;
      case 0xA: this.lastPong = Date.now(); break;
      default: this.close(1002);
    }
  }
}

// Completa el handshake HTTP Upgrade. Devuelve WSConnection o null.
export function acceptUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  return new WSConnection(socket);
}
