// 황금 열쇠 대탈출 — static file server + WebSocket relay for multiplayer
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const MAX_PER_ROOM = 24;
const TICK_MS = 66;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const rooms = new Map();   // code -> Map(id -> { ws, state })
let nextId = 1;
const num = (v) => typeof v === 'number' && Number.isFinite(v);

// Never trust what a client sends: keep only the fields we know, in sane ranges.
function sanitize(m) {
  if (!m || typeof m !== 'object' || !Array.isArray(m.p) || m.p.length < 4 || !m.p.slice(0, 4).every(num)) return null;
  const c = (v, a, b) => Math.max(a, Math.min(b, v));
  return {
    n: typeof m.n === 'string' ? m.n.slice(0, 12) : '',
    c: num(m.c) ? c(Math.floor(m.c), 0, 7) : 0,
    k: m.k === true,
    t: num(m.t) && m.t > 0 ? c(m.t, 0, 99999) : null,
    p: [c(m.p[0], -18, 18), c(m.p[1], 0, 40), c(m.p[2], -18, 18), c(m.p[3], -100, 100)],
  };
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });
wss.on('connection', (ws, req) => {
  const code = (new URL(req.url, 'http://x').searchParams.get('room') || 'lobby').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'lobby';
  let room = rooms.get(code);
  if (!room) { room = new Map(); rooms.set(code, room); }
  if (room.size >= MAX_PER_ROOM) { ws.close(1013, 'room full'); return; }
  const id = 'p' + (nextId++);
  const entry = { ws, state: null, alive: true };
  room.set(id, entry);

  ws.on('message', (raw) => {
    try { const s = sanitize(JSON.parse(raw.toString())); if (s) entry.state = s; } catch (e) { /* ignore bad input */ }
  });
  ws.on('pong', () => { entry.alive = true; });
  const leave = () => { room.delete(id); if (room.size === 0) rooms.delete(code); };
  ws.on('close', leave);
  ws.on('error', leave);
});

// Broadcast: each player receives everyone else in the same room.
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.size < 1) continue;
    const all = [];
    for (const [id, e] of room) if (e.state) all.push(Object.assign({ id }, e.state));
    for (const [id, e] of room) {
      if (e.ws.readyState !== 1) continue;
      e.ws.send(JSON.stringify({ peers: all.filter((p) => p.id !== id) }));
    }
  }
}, TICK_MS);

// Drop dead connections.
setInterval(() => {
  for (const room of rooms.values()) for (const e of room.values()) {
    if (!e.alive) { e.ws.terminate(); continue; }
    e.alive = false; try { e.ws.ping(); } catch (err) {}
  }
}, 30000);

server.listen(PORT, () => console.log('listening on ' + PORT));
