// Peer-to-peer lobby over WebRTC (PeerJS). Star topology: the host relays between guests.
const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const PREFIX = 'alpenfisch-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = PEERJS_URL;
    s.onload = () => res(window.Peer);
    s.onerror = () => rej(new Error('Could not load PeerJS'));
    document.head.appendChild(s);
  });
}

const makeCode = () => Array.from({ length: 5 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');

export class Network {
  constructor(handlers) {
    this.h = handlers; // { onJoin(id, info), onLeave(id), onState(id, s), onEvent(id, ev), onStatus(text) }
    this.peer = null;
    this.isHost = false;
    this.conns = new Map(); // id -> DataConnection
    this.roster = new Map(); // id -> info
    this.myId = null;
    this.code = null;
    this.info = null;
  }

  get active() { return !!this.peer; }

  async host(info) {
    const Peer = await loadPeerJS();
    this.info = info;
    this.isHost = true;
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = makeCode();
      try {
        await new Promise((res, rej) => {
          const peer = new Peer(PREFIX + code, { debug: 1 });
          const to = setTimeout(() => rej(new Error('timeout')), 12000);
          peer.on('open', (id) => { clearTimeout(to); this.peer = peer; this.myId = id; this.code = code; res(); });
          peer.on('error', (e) => { clearTimeout(to); if (!this.peer) { peer.destroy(); rej(e); } else this.h.onStatus?.('Network: ' + e.type); });
        });
        break;
      } catch (e) {
        if (attempt === 3 || (e.type && e.type !== 'unavailable-id')) throw e;
      }
    }
    this.roster.set(this.myId, info);
    this.peer.on('connection', (conn) => this._accept(conn));
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (_) {} });
    return this.code;
  }

  async join(code, info) {
    const Peer = await loadPeerJS();
    this.info = info;
    this.isHost = false;
    code = code.trim().toUpperCase();
    await new Promise((res, rej) => {
      const peer = new Peer({ debug: 1 });
      const to = setTimeout(() => rej(new Error('Timed out reaching the lobby')), 15000);
      peer.on('open', (id) => {
        this.peer = peer; this.myId = id;
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json', metadata: info });
        conn.on('open', () => { clearTimeout(to); this.code = code; this._wire(conn, true); res(); });
        conn.on('error', (e) => { clearTimeout(to); rej(e); });
      });
      peer.on('error', (e) => {
        clearTimeout(to);
        rej(new Error(e.type === 'peer-unavailable' ? 'No lobby with that code' : (e.message || e.type)));
      });
    });
  }

  _accept(conn) {
    conn.on('open', () => {
      this._wire(conn, false);
      const info = conn.metadata || { name: 'Angler' };
      this.roster.set(conn.peer, info);
      // tell the newcomer who is here, tell everyone about the newcomer
      conn.send({ t: 'roster', list: [...this.roster.entries()] });
      this._broadcast({ t: 'join', id: conn.peer, info }, conn.peer);
      this.h.onJoin?.(conn.peer, info);
    });
  }

  _wire(conn, toHost) {
    this.conns.set(conn.peer, conn);
    conn.on('data', (msg) => this._onData(conn.peer, msg));
    conn.on('close', () => this._drop(conn.peer));
    conn.on('error', () => this._drop(conn.peer));
    if (toHost) this.hostId = conn.peer;
  }

  _drop(id) {
    if (!this.conns.has(id)) return;
    this.conns.delete(id);
    if (this.isHost) {
      this.roster.delete(id);
      this._broadcast({ t: 'leave', id });
      this.h.onLeave?.(id);
    } else if (id === this.hostId) {
      for (const pid of this.roster.keys()) if (pid !== this.myId) this.h.onLeave?.(pid);
      this.roster.clear();
      this.h.onStatus?.('Disconnected from the lobby host');
    }
  }

  _onData(from, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (this.isHost) {
      // relay guests' messages to everyone else, stamped with sender
      if (msg.t === 's' || msg.t === 'e') {
        this._broadcast({ ...msg, from }, from);
        if (msg.t === 's') this.h.onState?.(from, msg.d);
        else this.h.onEvent?.(from, msg.d);
      }
      return;
    }
    switch (msg.t) {
      case 'roster':
        for (const [id, info] of msg.list) {
          this.roster.set(id, info);
          if (id !== this.myId) this.h.onJoin?.(id, info);
        }
        break;
      case 'join': if (msg.id !== this.myId) { this.roster.set(msg.id, msg.info); this.h.onJoin?.(msg.id, msg.info); } break;
      case 'leave': this.roster.delete(msg.id); this.h.onLeave?.(msg.id); break;
      case 's': this.h.onState?.(msg.from || from, msg.d); break;
      case 'e': this.h.onEvent?.(msg.from || from, msg.d); break;
    }
  }

  _broadcast(msg, except) {
    for (const [id, c] of this.conns) if (id !== except && c.open) { try { c.send(msg); } catch (_) {} }
  }

  sendState(d) { if (this.peer) this._broadcast({ t: 's', d }); }
  sendEvent(d) { if (this.peer) this._broadcast({ t: 'e', d }); }

  leave() {
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    this.peer?.destroy();
    this.peer = null;
  }
}
