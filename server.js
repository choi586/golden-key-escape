// 황금 열쇠 대탈출 — static file server + WebSocket relay for multiplayer
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const MAX_PER_ROOM = 24;
const TICK_MS = 66;
const START_DELAY_MS = 4000;      // countdown everyone sees after "다 같이 출발"
const START_COOLDOWN_MS = 6000;   // one group start per room every few seconds
const MAX_RECORDS = 10;
const WIN_TARGET = 3;              // 쟁탈전: first to win this many rounds is the champion
const STEAL_RANGE = 2.8, STEAL_IMMUNE_MS = 2000;
const MAX_TRAPS_PER_ROOM = 24, MAX_TRAPS_PER_PLAYER = 3, TRAP_TTL_MS = 90000, ITEM_COOLDOWN_MS = 1000;

// ---------- static files (gzipped, cached in memory) ----------
const fileCache = new Map();   // path -> { mtimeMs, raw, gz }
function loadFile(file, cb) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return cb(err || new Error('not a file'));
    const hit = fileCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs) return cb(null, hit);
    fs.readFile(file, (err2, raw) => {
      if (err2) return cb(err2);
      const entry = { mtimeMs: st.mtimeMs, raw, gz: null };
      const ext = path.extname(file);
      if (ext === '.html' || ext === '.js' || ext === '.css' || ext === '.svg') entry.gz = zlib.gzipSync(raw, { level: 6 });
      fileCache.set(file, entry);
      cb(null, entry);
    });
  });
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); return res.end(); }
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  loadFile(file, (err, entry) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    const headers = {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      // the 3D library never changes; everything else must be fresh after a deploy
      'Cache-Control': path.basename(file) === 'three.min.js' ? 'public, max-age=604800' : 'no-cache',
      'Vary': 'Accept-Encoding',
    };
    const gzipOk = entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (gzipOk) headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    res.end(gzipOk ? entry.gz : entry.raw);
  });
});

// ---------- rooms ----------
const rooms = new Map();     // code -> { players: Map(id -> entry), lastStart }
const records = new Map();   // code -> { list: [{ id, n, c, t, s }], at }  (kept while the server is up)
let nextId = 1;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const cleanName = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) : '');

// Never trust what a client sends: keep only the fields we know, in sane ranges.
function sanitize(m) {
  if (!Array.isArray(m.p) || m.p.length < 4 || !m.p.slice(0, 4).every(num)) return null;
  return {
    n: cleanName(m.n),
    c: num(m.c) ? clampN(Math.floor(m.c), 0, 7) : 0,
    k: m.k === true,
    kp: num(m.kp) ? clampN(Math.floor(m.kp), 0, 3) : 0,
    h: num(m.h) ? clampN(Math.floor(m.h), 0, 5) : 0,
    fz: m.fz === true,
    sh: m.sh === true,
    e: num(m.e) && m.e >= 1 && m.e <= 4 ? Math.floor(m.e) : 0,
    s: num(m.s) ? clampN(Math.floor(m.s), 0, 99) : 0,
    t: num(m.t) && m.t > 0 ? clampN(m.t, 0, 99999) : null,
    p: [clampN(m.p[0], -18, 18), clampN(m.p[1], 0, 60), clampN(m.p[2], -18, 18), clampN(m.p[3], -100, 100)],
  };
}
function sendTo(entry, obj) {
  if (entry.ws.readyState === 1) { try { entry.ws.send(JSON.stringify(obj)); } catch (e) { /* socket is going away */ } }
}
function broadcast(room, obj) {
  const msg = JSON.stringify(obj);
  for (const e of room.players.values()) if (e.ws.readyState === 1) { try { e.ws.send(msg); } catch (err) { /* ignore */ } }
}
// ---------- 열쇠 쟁탈전 (battle mode): the server decides who holds each of the three pieces ----------
function newBattle() { return { pieces: [null, null, null], at: [0, 0, 0], wins: new Map(), immune: new Map(), phase: 'play', round: 0, over: false }; }
function resetPieces(b) { b.pieces = [null, null, null]; b.at = [0, 0, 0]; b.immune.clear(); }
function newestPiece(b, id) { let best = -1; for (let i = 0; i < 3; i++) if (b.pieces[i] === id && (best < 0 || b.at[i] > b.at[best])) best = i; return best; }
function battleView(room, last) {
  const b = room.b, scores = [];
  for (const id of room.players.keys()) scores.push({ id, w: b.wins.get(id) || 0 });
  return { pieces: b.pieces, phase: b.phase, round: b.round, over: b.over, target: WIN_TARGET, scores, last: last || null };
}
function sendBattle(room, last) { broadcast(room, { ev: 'battle', b: battleView(room, last) }); }
function recordList(code) { const r = records.get(code); return r ? r.list : []; }
function addRecord(code, id, state, t, s) {
  let r = records.get(code);
  if (!r) { r = { list: [], at: 0 }; records.set(code, r); }
  r.at = Date.now();
  const mine = r.list.find((x) => x.id === id);
  if (mine) { if (t >= mine.t) return false; r.list.splice(r.list.indexOf(mine), 1); }
  r.list.push({ id, n: (state && state.n) || '친구', c: state ? state.c : 0, t, s });
  r.list.sort((a, b) => a.t - b.t);
  if (r.list.length > MAX_RECORDS) r.list.length = MAX_RECORDS;
  return true;
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });
wss.on('connection', (ws, req) => {
  const code = (new URL(req.url, 'http://x').searchParams.get('room') || 'lobby').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'lobby';
  let room = rooms.get(code);
  if (!room) { room = { players: new Map(), lastStart: 0, traps: new Map(), mode: 'race', b: newBattle() }; rooms.set(code, room); }
  if (room.players.size >= MAX_PER_ROOM) { ws.close(1013, 'room full'); return; }
  const id = 'p' + (nextId++);
  const entry = { ws, state: null, alive: true, msgs: 0, lastItem: 0 };
  room.players.set(id, entry);
  sendTo(entry, { hello: id, rec: recordList(code), mode: room.mode, b: battleView(room), traps: [...room.traps.values()].map((t) => ({ id: t.id, by: t.by, p: t.p })) });

  ws.on('message', (raw) => {
    if (++entry.msgs > 60) return;                 // per-second flood guard (reset below)
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.cmd === 'start') {                       // "다 같이 출발": everyone in the room restarts together
      const now = Date.now();
      if (now - room.lastStart < START_COOLDOWN_MS) return;
      room.lastStart = now;
      startRound(room, (entry.state && entry.state.n) || cleanName(m.n) || '친구');
    } else if (m.cmd === 'mode') {                 // switch between 기록 경주 and 열쇠 쟁탈전 for the whole room
      const now = Date.now();
      if ((m.mode !== 'race' && m.mode !== 'battle') || m.mode === room.mode || now - room.lastStart < START_COOLDOWN_MS) return;
      room.lastStart = now; room.mode = m.mode; room.b = newBattle();
      broadcast(room, { ev: 'mode', mode: room.mode });
      startRound(room, (entry.state && entry.state.n) || cleanName(m.n) || '친구');
    } else if (m.cmd === 'grab' || m.cmd === 'steal' || m.cmd === 'drop' || m.cmd === 'escape') {
      const b = room.b;
      if (room.mode !== 'battle' || b.phase !== 'play' || !entry.state) return;
      const now = Date.now();
      if (m.cmd === 'grab') {
        const i = m.i;
        if (!Number.isInteger(i) || i < 0 || i > 2 || b.pieces[i] !== null) return;
        b.pieces[i] = id; b.at[i] = now; sendBattle(room, { type: 'grab', by: id, i });
      } else if (m.cmd === 'steal') {
        const victim = typeof m.from === 'string' && m.from !== id ? room.players.get(m.from) : null;
        if (!victim || !victim.state || (b.immune.get(m.from) || 0) > now) return;
        const a = entry.state.p, v = victim.state.p;
        if (Math.hypot(a[0] - v[0], a[1] - v[1], a[2] - v[2]) > STEAL_RANGE) return;
        const i = newestPiece(b, m.from); if (i < 0) return;
        b.pieces[i] = id; b.at[i] = now; b.immune.set(id, now + STEAL_IMMUNE_MS);   // the thief can't be robbed straight back
        sendBattle(room, { type: 'steal', by: id, from: m.from, i });
      } else if (m.cmd === 'drop') {
        const i = newestPiece(b, id); if (i < 0) return;
        b.pieces[i] = null; sendBattle(room, { type: 'drop', by: id, i });
      } else {
        if (b.pieces.some((o) => o !== id)) return;          // must hold all three
        b.wins.set(id, (b.wins.get(id) || 0) + 1); b.phase = 'results';
        if (b.wins.get(id) >= WIN_TARGET) b.over = true;
        sendBattle(room, { type: 'win', by: id });
      }
    } else if (m.cmd === 'trap' || m.cmd === 'freeze') {   // items that affect other players
      const now = Date.now();
      if (now - entry.lastItem < ITEM_COOLDOWN_MS) return;
      if (!Array.isArray(m.p) || m.p.length < 3 || !m.p.slice(0, 3).every(num)) return;
      const p = [clampN(m.p[0], -18, 18), clampN(m.p[1], 0, 60), clampN(m.p[2], -18, 18)];
      entry.lastItem = now;
      if (m.cmd === 'freeze') { broadcast(room, { ev: 'freeze', by: id, n: (entry.state && entry.state.n) || '친구', p }); return; }
      let mine = 0; for (const t of room.traps.values()) if (t.by === id) mine++;
      if (mine >= MAX_TRAPS_PER_PLAYER || room.traps.size >= MAX_TRAPS_PER_ROOM) return;
      const t = { id: 't' + (nextId++), by: id, p, at: now };
      room.traps.set(t.id, t);
      broadcast(room, { ev: 'trap', t: { id: t.id, by: id, p } });
    } else if (m.cmd === 'trapHit') {
      if (typeof m.id === 'string' && room.traps.delete(m.id)) broadcast(room, { ev: 'trapGone', id: m.id });
    } else if (m.cmd === 'finish') {
      if (!num(m.t) || m.t < 5 || m.t > 99999) return;
      const s = num(m.s) ? clampN(Math.floor(m.s), 0, 99) : 0;
      if (addRecord(code, id, entry.state, Math.round(m.t * 10) / 10, s)) broadcast(room, { rec: recordList(code) });
    } else {
      const st = sanitize(m);
      if (st) entry.state = st;
    }
  });
  ws.on('pong', () => { entry.alive = true; });
  const leave = () => {
    const b = room.b; let held = false;
    for (let i = 0; i < 3; i++) if (b.pieces[i] === id) { b.pieces[i] = null; held = true; }
    b.wins.delete(id); b.immune.delete(id);
    room.players.delete(id);
    if (room.mode === 'battle' && room.players.size) sendBattle(room, held ? { type: 'drop', by: id, i: -1 } : null);
    if (room.players.size === 0 && rooms.get(code) === room) rooms.delete(code);
  };
  ws.on('close', leave);
  ws.on('error', leave);
});

function startRound(room, by) {
  room.traps.clear();
  const b = room.b;
  if (room.mode === 'battle') {
    if (b.over) { b.wins.clear(); b.over = false; b.round = 0; }
    resetPieces(b); b.phase = 'play'; b.round++;
  }
  broadcast(room, { ev: 'start', in: START_DELAY_MS, by, mode: room.mode, b: battleView(room) });
}

// Broadcast: each player receives everyone else in the same room.
setInterval(() => {
  for (const room of rooms.values()) {
    const all = [];
    for (const [id, e] of room.players) if (e.state) all.push(Object.assign({ id }, e.state));
    for (const [id, e] of room.players) sendTo(e, { peers: all.filter((p) => p.id !== id) });
  }
}, TICK_MS);

setInterval(() => { for (const room of rooms.values()) for (const e of room.players.values()) e.msgs = 0; }, 1000);

// Drop dead connections, and forget records of rooms nobody has used for a long time.
setInterval(() => {
  for (const room of rooms.values()) for (const e of room.players.values()) {
    if (!e.alive) { e.ws.terminate(); continue; }
    e.alive = false; try { e.ws.ping(); } catch (err) { /* ignore */ }
  }
  const now = Date.now();
  for (const room of rooms.values()) for (const t of room.traps.values()) {
    if (now - t.at > TRAP_TTL_MS) { room.traps.delete(t.id); broadcast(room, { ev: 'trapGone', id: t.id }); }
  }
  for (const [code, r] of records) if (!rooms.has(code) && now - r.at > 6 * 3600 * 1000) records.delete(code);
}, 30000);

server.listen(PORT, () => console.log('listening on ' + PORT));
