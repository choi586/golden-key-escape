// 황금 열쇠 대탈출 — game client
(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => { const d = a - b; return Math.atan2(Math.sin(d), Math.cos(d)); };
const damp = (rate, dt) => 1 - Math.pow(rate, dt);     // frame-rate independent smoothing factor

if (!window.THREE) {
  document.body.insertAdjacentHTML('beforeend', '<div class="overlay"><div class="card panel"><h1>불러오기 실패</h1><p>3D 라이브러리를 불러오지 못했어요. 새로고침해 주세요.</p></div></div>');
  return;
}
const THREE = window.THREE;

// ---------- saved settings ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('gke_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('gke_' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};
const opt = {
  sfx: store.get('sfx', true), music: store.get('music', true), autoCam: store.get('autoCam', true),
  sens: clamp(+store.get('sens', 1) || 1, 0.4, 2), quality: store.get('quality', 'high') === 'low' ? 'low' : 'high',
};

// ---------- constants ----------
const COLORS = [0xff6b6b, 0xffa94d, 0xffd43b, 0x69db7c, 0x38d9a9, 0x4dabf7, 0x9775fa, 0xf783ac];
const hexCss = (h) => '#' + h.toString(16).padStart(6, '0');
const ROOM = 18;                  // half size of the play pen
const GRAVITY = 26, JUMP_V = 9.4, SPEED = 7.2, PAD_V = 18.5;
const STEP_UP = 0.55;             // auto step height (walk up stairs without jumping)
const EXIT = { x: 0, z: ROOM - 0.8 };
const N_STEPS = 45, STEP_W = 5.2, STEP_H = 0.35, STEP_D = 3.0;
const CHECKPOINTS = [15, 30];     // stair indexes with a flag
const SWEEPERS = [21, 37];        // stair indexes with a spinning bar
const SHIELDS = [9, 25];          // stair indexes with a shield pickup
const EMOTES = ['👋', '😂', '😱', '👍'];
const MARBLE_R = 0.6, MARBLE_PERIOD = 39000, MARBLE_N = 3;
const HAND_R = 2.9;

// ---------- renderer / scene ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const C = (hex) => new THREE.Color(hex).convertSRGBToLinear();     // colours are authored in sRGB
const std = (hex, rough, metal) => new THREE.MeshStandardMaterial({ color: C(hex), roughness: rough === undefined ? 0.6 : rough, metalness: metal || 0 });
const basic = (hex, o) => new THREE.MeshBasicMaterial(Object.assign({ color: C(hex) }, o || {}));
function canvasTex(w, h, draw, rx, ry) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding;
  if (rx) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry || rx); }
  t.anisotropy = 4;
  return t;
}
const mesh = (geo, mat, shadow) => { const m = new THREE.Mesh(geo, mat); if (shadow) { m.castShadow = true; m.receiveShadow = true; } return m; };

const scene = new THREE.Scene();
scene.background = canvasTex(16, 256, (c, w, h) => {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#8fc9ff'); g.addColorStop(0.55, '#cfe8ff'); g.addColorStop(1, '#fff1dc');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
});
scene.fog = new THREE.Fog(C(0xdcecff), 70, 190);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
scene.add(new THREE.HemisphereLight(C(0xffffff), C(0xe6cfae), 0.62));
const sun = new THREE.DirectionalLight(C(0xfff1d6), 0.78);
sun.position.set(18, 42, 14);
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -27; sun.shadow.camera.right = 27; sun.shadow.camera.top = 27; sun.shadow.camera.bottom = -27;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 95; sun.shadow.bias = -0.0006;
scene.add(sun);

function applyQuality() {
  const hi = opt.quality === 'high';
  renderer.setPixelRatio(hi ? Math.min(window.devicePixelRatio || 1, 2) : 1);
  renderer.shadowMap.enabled = hi; sun.castShadow = hi;
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  resize();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = w < h ? 72 : 60; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------- the big bedroom outside + the play pen ----------
const WALL_H = 9;
(function buildRoom() {
  // bedroom floor (far outside the pen) and giant toys, so you feel tiny
  const wood = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#d9b48a'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      c.fillStyle = ['#d2ab80', '#deba92', '#cfa678', '#dbb68c'][i]; c.fillRect(0, i * 64, w, 62);
      c.fillStyle = 'rgba(120,80,40,.35)'; c.fillRect(0, i * 64 + 62, w, 2); c.fillRect((i * 97) % w, i * 64, 2, 62);
    }
  }, 14, 14);
  const outer = mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.85 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.06; outer.receiveShadow = true; scene.add(outer);

  const matTex = canvasTex(256, 256, (c, w, h) => {
    const cols = ['#fff0d2', '#ffe8c4', '#ffe8c4', '#fff0d2'];
    for (let i = 0; i < 4; i++) { c.fillStyle = cols[i]; c.fillRect((i % 2) * 128, (i >> 1) * 128, 128, 128); }
    c.strokeStyle = 'rgba(190,150,100,.35)'; c.lineWidth = 3; c.strokeRect(0, 0, 128, 128); c.strokeRect(128, 128, 128, 128);
  }, 6, 6);
  const floor = mesh(new THREE.PlaneGeometry(ROOM * 2, ROOM * 2), new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const rug = mesh(new THREE.CircleGeometry(7.2, 48), std(0xffe3ec, 0.95));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.012, -1); rug.receiveShadow = true; scene.add(rug);
  [[6.2, 6.6, 0xff9eb5], [4.2, 4.45, 0xffc2d1]].forEach((r) => {
    const ring = mesh(new THREE.RingGeometry(r[0], r[1], 48), std(r[2], 0.95));
    ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.02, -1); scene.add(ring);
  });

  const wallTex = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#fff3d6'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffe9bd'; c.fillRect(0, 0, w / 2, h);
    c.fillStyle = 'rgba(255,170,120,.5)';
    [[32, 30], [96, 94]].forEach((p) => { c.beginPath(); c.arc(p[0], p[1], 5, 0, 7); c.fill(); });
  }, 9, 2);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
  const defs = [[0, -ROOM, 0], [0, ROOM, Math.PI], [-ROOM, 0, Math.PI / 2], [ROOM, 0, -Math.PI / 2]];
  defs.forEach((d) => {
    const w = mesh(new THREE.PlaneGeometry(ROOM * 2, WALL_H), wallMat);
    w.position.set(d[0], WALL_H / 2, d[1]); w.rotation.y = d[2]; w.receiveShadow = true; scene.add(w);
    const base = mesh(new THREE.PlaneGeometry(ROOM * 2, 0.7), std(0xffb4a2, 0.8));
    base.position.set(d[0] * 0.999, 0.35, d[1] * 0.999); base.rotation.y = d[2]; scene.add(base);
    const cap = mesh(new THREE.BoxGeometry(ROOM * 2 + 0.6, 0.35, 0.6), std(0xff9e8a, 0.6));   // rim of the pen
    cap.position.set(d[0], WALL_H + 0.17, d[1]); cap.rotation.y = d[2]; scene.add(cap);
  });
  function onWall(m, wall, along, y, off) {   // wall: 0 back(-z) 1 front(+z) 2 left(-x) 3 right(+x)
    const d = defs[wall], inx = d[0] ? -Math.sign(d[0]) : 0, inz = d[1] ? -Math.sign(d[1]) : 0;
    m.position.set(d[0] + inx * off + (d[0] ? 0 : along), y, d[1] + inz * off + (d[1] ? 0 : along));
    m.rotation.y = d[2]; scene.add(m); return m;
  }
  const frameMat = std(0xffffff, 0.5);
  [-8, 8].forEach((a) => {   // windows
    onWall(mesh(new THREE.PlaneGeometry(5.6, 4.6), frameMat), 2, a, 5.2, 0.02);
    onWall(mesh(new THREE.PlaneGeometry(5, 4), basic(0x8fd3ff)), 2, a, 5.2, 0.04);
    onWall(mesh(new THREE.PlaneGeometry(0.22, 4), frameMat), 2, a, 5.2, 0.06);
    onWall(mesh(new THREE.PlaneGeometry(5, 0.22), frameMat), 2, a, 5.2, 0.06);
    onWall(mesh(new THREE.CircleGeometry(0.8, 24), basic(0xffffff)), 2, a - 1.2, 6.0, 0.05);
    onWall(mesh(new THREE.CircleGeometry(0.55, 24), basic(0xffffff)), 2, a - 0.3, 5.8, 0.05);
  });
  [[-9, 0xffadad, 0xff6b6b, 3], [0, 0xa0c4ff, 0x4dabf7, 5], [9, 0xcaffbf, 0x69db7c, 32]].forEach((d2) => {   // posters
    onWall(mesh(new THREE.PlaneGeometry(3.6, 4.4), std(0x8d5a3b, 0.7)), 3, d2[0], 5.4, 0.02);
    onWall(mesh(new THREE.PlaneGeometry(3.1, 3.9), std(d2[1], 0.9)), 3, d2[0], 5.4, 0.04);
    onWall(mesh(new THREE.CircleGeometry(1.0, d2[3]), basic(d2[2])), 3, d2[0], 5.4, 0.06);
  });
  const flagCols = [0xff6b6b, 0xffd43b, 0x69db7c, 0x4dabf7, 0x9775fa, 0xf783ac];   // bunting above the mouse hole
  for (let b = 0; b < 12; b++) {
    const tri = onWall(mesh(new THREE.CircleGeometry(0.7, 3), basic(flagCols[b % 6], { side: THREE.DoubleSide })), 1, -13.2 + b * 2.4, 7.6 - Math.sin((b / 11) * Math.PI) * 0.9, 0.05);
    tri.rotation.z = -Math.PI / 2;
  }

  // giant toys out in the bedroom
  const letterTex = (ch, bg) => canvasTex(128, 128, (c) => {
    c.fillStyle = bg; c.fillRect(0, 0, 128, 128); c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = 10; c.strokeRect(9, 9, 110, 110);
    c.fillStyle = '#fff'; c.font = '900 84px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ch, 64, 70);
  });
  [[-33, 4.5, 9, 'A', '#ff8787', 0.3], [-34, 4.5, -4, 'B', '#74c0fc', -0.2], [-33.5, 13.5, 2.5, 'C', '#8ce99a', 0.6], [34, 4.5, -18, 'D', '#ffd43b', 0.5]].forEach((b) => {
    const m = mesh(new THREE.BoxGeometry(9, 9, 9), new THREE.MeshStandardMaterial({ map: letterTex(b[3], b[4]), roughness: 0.6 }), true);
    m.position.set(b[0], b[1], b[2]); m.rotation.y = b[5]; scene.add(m);
  });
  const ballTex = canvasTex(256, 128, (c, w, h) => {
    ['#ff6b6b', '#ffffff', '#4dabf7', '#ffffff', '#ffd43b', '#ffffff'].forEach((col, i) => { c.fillStyle = col; c.fillRect(i * w / 6, 0, w / 6 + 1, h); });
  });
  const ball = mesh(new THREE.SphereGeometry(7, 32, 24), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.35 }), true);
  ball.position.set(35, 7, 8); ball.rotation.z = 0.5; scene.add(ball);
  const crayon = new THREE.Group();
  const cb = mesh(new THREE.CylinderGeometry(1.3, 1.3, 16, 16), std(0x9775fa, 0.5), true); crayon.add(cb);
  const ct = mesh(new THREE.ConeGeometry(1.3, 3, 16), std(0x7950f2, 0.5), true); ct.position.y = 9.5; crayon.add(ct);
  crayon.rotation.z = Math.PI / 2; crayon.rotation.y = 0.5; crayon.position.set(4, 1.3, 34); scene.add(crayon);
})();

// ---------- exit (mouse hole) ----------
let exitGlow, exitLock;
(function buildExit() {
  const g = new THREE.Group();
  const hole = mesh(new THREE.CircleGeometry(1.6, 32, 0, Math.PI), basic(0x1d1530)); hole.position.y = 0.02; g.add(hole);
  g.add(mesh(new THREE.TorusGeometry(1.68, 0.14, 10, 32, Math.PI), std(0x8d5a3b, 0.6)));
  exitGlow = mesh(new THREE.RingGeometry(1.2, 2.0, 40), basic(0xffd43b, { transparent: true, opacity: 0, depthWrite: false }));
  exitGlow.rotation.x = -Math.PI / 2; exitGlow.position.set(0, 0.04, -1.2); g.add(exitGlow);
  exitLock = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(96, 96, (c) => { c.font = '70px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('🔒', 48, 52); }), transparent: true }));
  exitLock.scale.set(1.3, 1.3, 1); exitLock.position.set(0, 2.5, -0.3); g.add(exitLock);
  g.position.set(EXIT.x, 0, ROOM - 0.03); g.rotation.y = Math.PI;
  scene.add(g);
})();

// ---------- spiral stairs + altar ----------
const steps = [];       // oriented box colliders
let altar = null;       // circular collider
const keyPos = new THREE.Vector3();
(function buildStairs() {
  const stairColors = [0xffadad, 0xffd6a5, 0xfdffb6, 0xcaffbf, 0x9bf6ff, 0xa0c4ff, 0xbdb2ff, 0xffc6ff];
  const geo = new THREE.BoxGeometry(STEP_W, STEP_H, STEP_D);
  const mats = stairColors.map((c) => std(c, 0.4, 0.03));
  for (let i = 0; i < N_STEPS; i++) {
    const angle = (i / N_STEPS) * Math.PI * 5.5, radius = 13.0 - i * 0.1;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius - 1.0, y = 0.15 + i * STEP_H, rot = -angle + Math.PI / 2;
    const m = mesh(geo, mats[i % mats.length], true);
    m.position.set(x, y, z); m.rotation.y = rot; scene.add(m);
    // collider follows the step's real rotation, so you can't stand on thin air beside it
    steps.push({ cx: x, cz: z, cos: Math.cos(rot), sin: Math.sin(rot), hw: STEP_W / 2 + 0.25, hd: STEP_D / 2 + 0.2, topY: y + STEP_H / 2, rx: Math.cos(angle), rz: Math.sin(angle) });
  }
  const la = ((N_STEPS - 1) / N_STEPS) * Math.PI * 5.5, lr = 13.0 - (N_STEPS - 1) * 0.1;
  const ax = Math.cos(la) * (lr - 3.2), az = Math.sin(la) * (lr - 3.2) - 1.0, ay = 0.15 + (N_STEPS - 1) * STEP_H + 0.05;
  const am = mesh(new THREE.CylinderGeometry(4.5, 4.5, 0.8, 40), std(0xffd700, 0.25, 0.4), true);
  am.position.set(ax, ay, az); scene.add(am);
  const trim = mesh(new THREE.TorusGeometry(4.5, 0.12, 8, 48), std(0xfff3b0, 0.3, 0.5)); trim.rotation.x = Math.PI / 2; trim.position.set(ax, ay + 0.4, az); scene.add(trim);
  altar = { cx: ax, cz: az, r: 4.6, topY: ay + 0.4 };
  keyPos.set(ax, ay + 0.4 + 1.3, az);
})();
const TOP_Y = altar.topY;

// ---------- trampolines (shortcuts) ----------
const pads = [];
[[0.244, 7.0], [5.376, 6.3]].forEach((d) => {
  const x = Math.cos(d[0]) * d[1], z = Math.sin(d[0]) * d[1] - 1.0, g = new THREE.Group();
  const rim = mesh(new THREE.CylinderGeometry(1.45, 1.55, 0.28, 28), std(0xff6b6b, 0.5), true); rim.position.y = 0.14; g.add(rim);
  const skin = mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.06, 28), std(0x364fc7, 0.4)); skin.position.y = 0.29; g.add(skin);
  const arrow = mesh(new THREE.CircleGeometry(0.55, 3), basic(0xffffff)); arrow.rotation.x = -Math.PI / 2; arrow.position.y = 0.33; g.add(arrow);
  g.position.set(x, 0, z); scene.add(g);
  pads.push({ x, z, r: 1.4, top: 0.3, g, skin, bounce: 0 });
});

// ---------- checkpoint flags ----------
const flags = CHECKPOINTS.map((idx) => {
  const st = steps[idx], g = new THREE.Group();
  const pole = mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), std(0xffffff, 0.4)); pole.position.y = 1.1; g.add(pole);
  const cloth = mesh(new THREE.PlaneGeometry(0.9, 0.6), basic(0xadb5bd, { side: THREE.DoubleSide })); cloth.position.set(0.48, 1.85, 0); g.add(cloth);
  g.position.set(st.cx + st.rx * 1.25, st.topY, st.cz + st.rz * 1.25); scene.add(g);
  return { idx, cloth };
});

// ---------- stars ----------
const stars = [];
(function buildStars() {
  const geo = new THREE.OctahedronGeometry(0.38), mat = std(0xffe066, 0.25, 0.3);
  mat.emissive = C(0x8a6a00);
  const add = (x, y, z) => { const m = mesh(geo, mat); m.position.set(x, y, z); scene.add(m); stars.push({ mesh: m, x, y, z, got: false }); };
  for (let i = 3; i < steps.length - 1; i += 4) {
    const st = steps[i], side = (i % 8 === 3) ? 1 : -1;      // alternate outer / inner edge, some need a jump
    add(st.cx + st.rx * side, st.topY + (i % 3 === 0 ? 2.3 : 1.2), st.cz + st.rz * side);
  }
  add(-14.5, 1.2, 14.5); add(14.5, 1.2, -14.5); add(0, 1.2, -1);
})();

// ---------- shield pickups ----------
const shields = SHIELDS.map((idx) => {
  const st = steps[idx], g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(0.5, 20, 14), new THREE.MeshStandardMaterial({ color: C(0x74c0fc), transparent: true, opacity: 0.45, roughness: 0.1 })));
  const core = mesh(new THREE.IcosahedronGeometry(0.24), std(0xffffff, 0.2)); core.material.emissive = C(0x3b82c4); g.add(core);
  const x = st.cx - st.rx, z = st.cz - st.rz, y = st.topY + 1.15;
  g.position.set(x, y, z); scene.add(g);
  return { g, x, y, z, respawn: 0 };
});

// ---------- rolling marbles (same timing for everyone in the room) ----------
const marbles = [];
[0xff6b6b, 0x4dabf7, 0x69db7c].slice(0, MARBLE_N).forEach((c, i) => {
  const m = mesh(new THREE.SphereGeometry(MARBLE_R, 20, 14), std(c, 0.15, 0.2)); m.castShadow = true;
  m.add(mesh(new THREE.TorusGeometry(MARBLE_R * 0.98, 0.07, 6, 20), basic(0xffffff)));
  scene.add(m); marbles.push({ mesh: m, off: (i - 1) * 0.85, dx: 0, dz: 0, live: false });
});
function updateMarbles() {
  const top = steps.length - 2, lowest = 3, span = top - lowest;
  marbles.forEach((mb, i) => {
    const ph = ((Date.now() + i * MARBLE_PERIOD / marbles.length) % MARBLE_PERIOD) / MARBLE_PERIOD;
    const u = top - ph * span, a = Math.floor(u), f = u - a, s0 = steps[a], s1 = steps[Math.min(a + 1, steps.length - 1)];
    const x = lerp(s0.cx, s1.cx, f) + lerp(s0.rx, s1.rx, f) * mb.off, z = lerp(s0.cz, s1.cz, f) + lerp(s0.rz, s1.rz, f) * mb.off;
    const y = lerp(s0.topY, s1.topY, f) + MARBLE_R, pos = mb.mesh.position;
    const mvx = x - pos.x, mvz = z - pos.z, ml = Math.hypot(mvx, mvz);
    if (ml > 0.0001 && ml < 2) { mb.dx = mvx / ml; mb.dz = mvz / ml; mb.mesh.rotation.x += ml / MARBLE_R * mb.dz; mb.mesh.rotation.z -= ml / MARBLE_R * mb.dx; }
    pos.set(x, y, z);
    const sc = Math.min(1, ph * 30, (1 - ph) * 30); mb.mesh.scale.setScalar(Math.max(0.01, sc));   // fade in at the top, pop at the bottom
    mb.live = sc > 0.8;
  });
}

// ---------- spinning bars ----------
const SWEEP_LEN = 2.05, SWEEP_SPEED = 1.5;
const sweepers = SWEEPERS.map((idx, i) => {
  const st = steps[idx], g = new THREE.Group();
  const pole = mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.8, 12), std(0x495057, 0.5), true); pole.position.y = 0.4; g.add(pole);
  for (let k = 0; k < 4; k++) {
    const seg = mesh(new THREE.BoxGeometry(SWEEP_LEN / 2, 0.3, 0.3), std(k % 2 ? 0xffffff : 0xff6b6b, 0.5), true);
    seg.position.set(-SWEEP_LEN * 0.75 + k * SWEEP_LEN / 2, 0.42, 0); g.add(seg);
  }
  const knob = mesh(new THREE.SphereGeometry(0.26, 12, 10), std(0xffd43b, 0.4)); knob.position.y = 0.86; g.add(knob);
  g.position.set(st.cx, st.topY, st.cz); scene.add(g);
  return { g, st, dir: i % 2 ? -1 : 1, ang: 0 };
});
function updateSweepers() {
  const t = Date.now() / 1000;
  sweepers.forEach((sw, i) => { sw.ang = (t * SWEEP_SPEED * sw.dir + i * 1.3) % (Math.PI * 2); sw.g.rotation.y = sw.ang; });
}

// ---------- particles ----------
const bursts = [];
function burst(x, y, z, color, n, power, size) {
  const pos = new Float32Array(n * 3), vel = [];
  for (let i = 0; i < n; i++) {
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2, sp = (power || 5) * (0.4 + Math.random() * 0.6);
    vel.push(Math.cos(a) * Math.cos(e) * sp, Math.abs(Math.sin(e)) * sp + 2, Math.sin(a) * Math.cos(e) * sp);
  }
  const geo = new THREE.BufferGeometry(), attr = new THREE.BufferAttribute(pos, 3);
  geo.setAttribute('position', attr);
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: C(color), size: size || 0.28, transparent: true, depthWrite: false }));
  pts.frustumCulled = false; scene.add(pts);
  bursts.push({ pts, attr, vel, t: 0, life: 1.1 });
}
function updateBursts(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i], arr = b.attr.array; b.t += dt;
    for (let j = 0; j < b.vel.length; j += 3) {
      b.vel[j + 1] -= 14 * dt;
      arr[j] += b.vel[j] * dt; arr[j + 1] += b.vel[j + 1] * dt; arr[j + 2] += b.vel[j + 2] * dt;
    }
    b.attr.needsUpdate = true; b.pts.material.opacity = Math.max(0, 1 - b.t / b.life);
    if (b.t >= b.life) { scene.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose(); bursts.splice(i, 1); }
  }
}

// ---------- sound: tiny synth, no audio files ----------
let AC = null, sfxGain = null, musicGain = null;
function audio() {
  if (!AC) {
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return null;
    try { AC = new Ctx(); } catch (e) { return null; }
    sfxGain = AC.createGain(); sfxGain.connect(AC.destination);
    musicGain = AC.createGain(); musicGain.gain.value = 0.5; musicGain.connect(AC.destination);
  }
  if (AC.state === 'suspended') AC.resume().catch(() => {});
  return AC;
}
function tone(freq, dur, type, vol, slideTo, delay, dest) {
  const ac = audio(); if (!ac) return;
  try {
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + (delay || 0);
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.1, t + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest || sfxGain); o.start(t); o.stop(t + dur + 0.03);
  } catch (e) { /* audio is optional */ }
}
function sfx(name) {
  if (!opt.sfx) return;
  if (name === 'jump') tone(320, 0.16, 'square', 0.045, 620);
  else if (name === 'land') tone(140, 0.09, 'sine', 0.12, 70);
  else if (name === 'step') tone(520 + Math.random() * 80, 0.03, 'triangle', 0.018);
  else if (name === 'boing') { tone(180, 0.35, 'sine', 0.16, 720); tone(360, 0.3, 'triangle', 0.06, 1100, 0.03); }
  else if (name === 'star') { tone(880, 0.1, 'triangle', 0.1); tone(1320, 0.16, 'triangle', 0.1, 0, 0.08); }
  else if (name === 'key') [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.11, 0, i * 0.09));
  else if (name === 'warn') { tone(180, 0.25, 'sawtooth', 0.045, 240); tone(180, 0.25, 'sawtooth', 0.045, 240, 0.4); tone(180, 0.25, 'sawtooth', 0.045, 240, 0.8); }
  else if (name === 'slam') tone(110, 0.4, 'sine', 0.24, 38);
  else if (name === 'caught') { tone(400, 0.2, 'square', 0.07, 200); tone(200, 0.35, 'square', 0.07, 90, 0.18); }
  else if (name === 'hit') tone(240, 0.2, 'square', 0.08, 90);
  else if (name === 'flag') { tone(660, 0.12, 'triangle', 0.1); tone(880, 0.2, 'triangle', 0.1, 0, 0.1); }
  else if (name === 'shield') { tone(440, 0.25, 'sine', 0.1, 880); tone(660, 0.3, 'sine', 0.08, 1320, 0.1); }
  else if (name === 'pop') tone(900, 0.18, 'triangle', 0.12, 200);
  else if (name === 'tick') tone(660, 0.12, 'square', 0.07);
  else if (name === 'go') { tone(990, 0.4, 'square', 0.08); tone(1320, 0.4, 'triangle', 0.08, 0, 0.02); }
  else if (name === 'win') [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, 0, i * 0.12));
  else if (name === 'emote') tone(700, 0.09, 'sine', 0.06, 900);
  else if (name === 'join') { tone(587, 0.1, 'sine', 0.05); tone(784, 0.14, 'sine', 0.05, 0, 0.09); }
}
// background music: a gentle music-box loop that speeds up once you hold the key
const music = { next: 0, beat: 0, on: false };
const CHORDS = [[262, 330, 392], [220, 262, 330], [175, 220, 262], [196, 247, 294]];   // C  Am  F  G
function musicTick() {
  if (!opt.music || !music.on || document.hidden) return;
  const ac = audio(); if (!ac || ac.state !== 'running') return;
  const spb = 60 / (me.hasKey ? 152 : 108) / 2;       // eighth notes
  if (music.next < ac.currentTime) music.next = ac.currentTime + 0.05;
  while (music.next < ac.currentTime + 0.25) {
    const b = music.beat++, ch = CHORDS[Math.floor(b / 8) % 4], d = music.next - ac.currentTime;
    const arp = [0, 1, 2, 1, 0, 2, 1, 2][b % 8];
    tone(ch[arp] * 2, spb * 1.8, 'triangle', 0.035, 0, d, musicGain);
    if (b % 4 === 0) tone(ch[0] / 2, spb * 3.6, 'sine', 0.07, 0, d, musicGain);
    if (b % 8 === 6) tone(ch[2] * 4, spb * 1.2, 'sine', 0.018, 0, d, musicGain);
    music.next += spb;
  }
}
setInterval(musicTick, 80);

// ---------- golden key ----------
function makeKey(scale) {
  const g = new THREE.Group(), mat = std(0xffc800, 0.2, 0.7);
  mat.emissive = C(0x664400);
  const add = (geo, x, y) => { const m = mesh(geo, mat); m.position.set(x, y, 0); g.add(m); };
  add(new THREE.TorusGeometry(0.32, 0.1, 10, 24), 0, 0.45);
  add(new THREE.BoxGeometry(0.14, 0.8, 0.14), 0, -0.2);
  add(new THREE.BoxGeometry(0.3, 0.12, 0.14), 0.18, -0.5);
  add(new THREE.BoxGeometry(0.22, 0.12, 0.14), 0.14, -0.28);
  g.scale.setScalar(scale || 1);
  return g;
}
const worldKey = makeKey(1.5); worldKey.position.copy(keyPos); scene.add(worldKey);
const keyLight = new THREE.PointLight(C(0xffd45e), 1.4, 16); keyLight.position.copy(keyPos); scene.add(keyLight);
const keyBeam = mesh(new THREE.CylinderGeometry(0.5, 1.1, 14, 20, 1, true), basic(0xffe066, { transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
keyBeam.position.set(keyPos.x, keyPos.y + 6.5, keyPos.z); scene.add(keyBeam);

// ---------- avatars ----------
const emoteTex = {};
function emojiTexture(idx) {
  if (!emoteTex[idx]) emoteTex[idx] = canvasTex(128, 128, (c) => {
    c.fillStyle = 'rgba(255,255,255,.94)'; c.beginPath(); c.arc(64, 64, 60, 0, Math.PI * 2); c.fill();
    c.font = '76px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(EMOTES[idx - 1], 64, 70);
  });
  return emoteTex[idx];
}
function makeAvatar(colorIdx) {
  const g = new THREE.Group(), rig = new THREE.Group(); g.add(rig);
  const bodyMat = std(COLORS[colorIdx], 0.45), dark = std(0x2b2140, 0.7), eyeM = basic(0x2b2140);
  const body = mesh(new THREE.CylinderGeometry(0.4, 0.46, 0.78, 18), bodyMat); body.position.y = 0.68; body.castShadow = true; rig.add(body);
  const belly = mesh(new THREE.CircleGeometry(0.19, 18), basic(0xffffff, { transparent: true, opacity: 0.85 })); belly.position.set(0, 0.66, 0.44); rig.add(belly);
  const head = mesh(new THREE.SphereGeometry(0.39, 22, 18), std(0xfff1e0, 0.6)); head.position.y = 1.4; head.castShadow = true; rig.add(head);
  [-0.14, 0.14].forEach((ex) => {
    const e = mesh(new THREE.SphereGeometry(0.06, 10, 8), eyeM); e.position.set(ex, 1.45, 0.345); rig.add(e);
    const ch = mesh(new THREE.CircleGeometry(0.07, 12), basic(0xff9eb5, { transparent: true, opacity: 0.75 })); ch.position.set(ex * 1.85, 1.32, 0.3); ch.lookAt(ex * 4, 1.3, 2); rig.add(ch);
  });
  const smile = mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 12, Math.PI), eyeM); smile.position.set(0, 1.33, 0.365); smile.rotation.z = Math.PI; rig.add(smile);
  const ant = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6), bodyMat); ant.position.y = 1.9; rig.add(ant);
  const bulb = mesh(new THREE.SphereGeometry(0.09, 10, 8), bodyMat); bulb.position.y = 2.08; rig.add(bulb);
  const arms = [-1, 1].map((s) => {
    const piv = new THREE.Group(); piv.position.set(s * 0.5, 1.0, 0);
    const a = mesh(new THREE.BoxGeometry(0.15, 0.46, 0.17), bodyMat); a.position.y = -0.2; a.castShadow = true; piv.add(a);
    const hnd = mesh(new THREE.SphereGeometry(0.1, 8, 8), std(0xfff1e0, 0.6)); hnd.position.y = -0.46; piv.add(hnd);
    rig.add(piv); return piv;
  });
  const legs = [-0.2, 0.2].map((lx) => { const l = mesh(new THREE.BoxGeometry(0.24, 0.32, 0.32), dark); l.position.set(lx, 0.16, 0); l.castShadow = true; rig.add(l); return l; });
  const key = makeKey(0.75); key.position.set(0, 0.9, -0.5); key.rotation.z = 0.5; key.visible = false; rig.add(key);
  const crown = mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.2, 5, 1, true), std(0xffd43b, 0.35, 0.1)); crown.material.side = THREE.DoubleSide; crown.material.emissive = C(0x7a5a00);
  crown.position.y = 1.83; crown.visible = false; rig.add(crown);
  const shield = mesh(new THREE.SphereGeometry(1.25, 24, 16), new THREE.MeshStandardMaterial({ color: C(0x74c0fc), transparent: true, opacity: 0.28, roughness: 0.1, depthWrite: false }));
  shield.position.y = 1.0; shield.visible = false; g.add(shield);
  const em = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
  em.scale.set(1.3, 1.3, 1); em.position.y = 3.6; em.renderOrder = 11; em.visible = false; g.add(em);
  g.userData = { rig, bodyMat, key, legs, arms, crown, shield, emote: em, emoteIdx: 0, colorIdx, ph: 0, air: 0 };
  return g;
}
function setAvatarColor(av, idx) {
  if (av.userData.colorIdx === idx) return;
  av.userData.colorIdx = idx; av.userData.bodyMat.color.copy(C(COLORS[idx]));
}
function showEmote(av, idx) {     // idx 0 hides, 1..EMOTES.length shows
  const ud = av.userData; if (ud.emoteIdx === idx) return;
  ud.emoteIdx = idx; ud.emote.visible = idx > 0; if (!idx) return;
  ud.emote.material.map = emojiTexture(idx); ud.emote.material.needsUpdate = true;
}
function animateAvatar(av, moving, grounded, dt) {
  const ud = av.userData;
  if (moving && grounded) ud.ph += dt * 14;
  const s = moving && grounded ? Math.sin(ud.ph) : 0;
  ud.legs[0].position.z = s * 0.2; ud.legs[1].position.z = -s * 0.2;
  ud.air = lerp(ud.air, grounded ? 0 : 1, damp(0.0005, dt));
  ud.arms[0].rotation.x = s * 0.8; ud.arms[1].rotation.x = -s * 0.8;
  ud.arms[0].rotation.z = -ud.air * 2.3; ud.arms[1].rotation.z = ud.air * 2.3;
  if (ud.shield.visible) ud.shield.rotation.y += dt;
}
function makeLabel(text) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(3.2, 0.8, 1); sp.position.y = 2.75; sp.renderOrder = 10;
  sp.userData = { cv, tex, text: null };
  setLabel(sp, text);
  return sp;
}
function setLabel(sp, text) {
  if (sp.userData.text === text) return;
  sp.userData.text = text;
  const c = sp.userData.cv.getContext('2d');
  c.clearRect(0, 0, 256, 64);
  c.font = '800 30px "Apple SD Gothic Neo","Malgun Gothic",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  const w = Math.min(244, c.measureText(text).width + 28), x = 128 - w / 2, r = 20;
  c.fillStyle = 'rgba(43,33,64,.78)'; c.beginPath();
  c.moveTo(x + r, 10); c.arcTo(x + w, 10, x + w, 54, r); c.arcTo(x + w, 54, x, 54, r); c.arcTo(x, 54, x, 10, r); c.arcTo(x, 10, x + w, 10, r); c.fill();
  c.fillStyle = '#fff'; c.fillText(text, 128, 33, 230);
  sp.userData.tex.needsUpdate = true;
}

// ---------- local player ----------
const me = { name: '나', colorIdx: Math.floor(Math.random() * COLORS.length), hasKey: false, finished: null, stars: 0, cp: -1, emote: 0, emoteT: 0, shield: false };
const player = makeAvatar(me.colorIdx); scene.add(player);
const vel = { x: 0, z: 0 }, knock = { x: 0, z: 0, cd: 0 }, squash = { s: 1, v: 0 };
let vy = 0, grounded = true, airT = 0, jumpBuf = 0, bounceT = 0, fallSpeed = 0, stepPh = 0, padTipShown = false;
function spawn() {
  if (me.cp >= 0) { const st = steps[me.cp]; player.position.set(st.cx, st.topY, st.cz); }   // last checkpoint flag
  else player.position.set(7 + Math.random() * 6, 0, 11 + Math.random() * 3);
  player.rotation.y = Math.PI; vy = 0; vel.x = vel.z = 0; knock.x = knock.z = 0; grounded = true; airT = 0;
}
spawn();

// ---------- pushable toy blocks (local to each screen) ----------
const boxes = [[-9, 9, 0xff8787, 'ㄱ'], [-12, 4, 0x74c0fc, 'ㄴ'], [5, 4, 0x8ce99a, 'ㄷ']].map((d) => {
  const s = 1.7, h = 1.1;
  const tex = canvasTex(128, 128, (c) => {
    c.fillStyle = hexCss(d[2]); c.fillRect(0, 0, 128, 128); c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 8; c.strokeRect(8, 8, 112, 112);
    c.fillStyle = '#fff'; c.font = '900 78px "Apple SD Gothic Neo","Malgun Gothic",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(d[3], 64, 70);
  });
  const m = mesh(new THREE.BoxGeometry(s, h, s), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }), true);
  m.position.set(d[0], h / 2, d[1]); scene.add(m);
  return { mesh: m, half: s / 2, top: h, home: [d[0], d[1]] };
});

// ---------- giant kid + hand ----------
const kid = new THREE.Group(), pupils = [], brows = [], lids = [];
(function buildKid() {
  const skin = std(0xffd9b8, 0.8);
  kid.add(mesh(new THREE.SphereGeometry(7, 40, 28), skin));
  kid.add(mesh(new THREE.SphereGeometry(7.25, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.42), std(0x5b3a29, 0.9)));
  [-7, 7].forEach((ex) => { const ear = mesh(new THREE.SphereGeometry(1.5, 16, 12), skin); ear.position.set(ex, -0.3, 0); kid.add(ear); });
  [-2.6, 2.6].forEach((ex) => {
    const w = mesh(new THREE.SphereGeometry(1.5, 20, 16), std(0xffffff, 0.3)); w.position.set(ex, 0.6, 6.0); kid.add(w); lids.push(w);
    const p = mesh(new THREE.SphereGeometry(0.75, 16, 12), basic(0x1d1530)); p.position.set(ex, 0.6, 7.2); kid.add(p); pupils.push({ m: p, bx: ex });
    const ch = mesh(new THREE.CircleGeometry(1.1, 20), basic(0xff9eb5, { transparent: true, opacity: 0.6 })); ch.position.set(ex * 1.55, -1.8, 6.05); ch.lookAt(ex * 3, -3, 14); kid.add(ch);
    const br = mesh(new THREE.BoxGeometry(2.6, 0.45, 0.4), std(0x4a2f21, 0.9)); br.position.set(ex, 2.9, 6.25); kid.add(br); brows.push({ m: br, s: Math.sign(ex) });
  });
  const nose = mesh(new THREE.SphereGeometry(0.7, 14, 10), std(0xffc9a3, 0.8)); nose.position.set(0, -0.6, 7.0); kid.add(nose);
  const mouth = mesh(new THREE.TorusGeometry(1.4, 0.22, 8, 20, Math.PI), basic(0xb3402a)); mouth.position.set(0, -2.6, 6.45); mouth.rotation.z = Math.PI; kid.add(mouth);
  const sh = mesh(new THREE.SphereGeometry(11, 24, 16), std(0x74c0fc, 0.8)); sh.scale.set(1.25, 0.8, 0.7); sh.position.set(0, -13.5, -1); kid.add(sh);   // shoulders
  kid.position.set(0, 16, -ROOM - 12);
  scene.add(kid);
})();
const hand = new THREE.Group();
(function buildHand() {
  const skin = std(0xffd9b8, 0.75);
  const palm = mesh(new THREE.BoxGeometry(4.6, 1.2, 4.4), skin, true); hand.add(palm);
  for (let i = 0; i < 4; i++) {
    const f = mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.8, 10), skin, true);
    f.position.set(-1.72 + i * 1.15, -0.2, 3.3); f.rotation.x = Math.PI / 2 + 0.22; hand.add(f);
    const tip = mesh(new THREE.SphereGeometry(0.5, 10, 8), skin); tip.position.set(-1.72 + i * 1.15, -0.5, 4.65); hand.add(tip);
  }
  const th = mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.2, 10), skin, true); th.position.set(-3.1, -0.2, 0.7); th.rotation.z = Math.PI / 2; th.rotation.y = 0.5; hand.add(th);
  const cuff = mesh(new THREE.CylinderGeometry(2.0, 2.0, 1.6, 16), std(0xffffff, 0.8)); cuff.rotation.x = Math.PI / 2; cuff.position.set(0, 0.3, -2.9); hand.add(cuff);
  const arm = mesh(new THREE.CylinderGeometry(1.6, 1.9, 44, 12), std(0x74c0fc, 0.8)); arm.rotation.x = Math.PI / 2; arm.position.set(0, 0.4, -25); hand.add(arm);
  hand.position.set(0, 26, -10);
  scene.add(hand);
})();
const marker = new THREE.Group();
const markRing = mesh(new THREE.RingGeometry(2.4, HAND_R, 48), basic(0xff2d2d, { transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
const markFill = mesh(new THREE.CircleGeometry(HAND_R, 48), basic(0xff2d2d, { transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
markRing.rotation.x = markFill.rotation.x = -Math.PI / 2; marker.add(markRing); marker.add(markFill); marker.visible = false; scene.add(marker);
const hs = { state: 'hover', t: 9, tx: 0, ty: 0, tz: 0, fromY: 0 };

// ---------- input ----------
let keys = {}, jumpHeld = false, lastLookT = 0;
const joy = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
const cam = { yaw: Math.PI * 0.15, pitch: 0.42, dist: 10, shake: 0, pos: new THREE.Vector3(), ready: false };
const drag = { id: null, x: 0, y: 0 };
const game = { state: 'menu', t0: 0, elapsed: 0, cdEnd: 0, lastCount: null };
let clockOff = 0;                                   // lets tests fast-forward time
const clock = () => performance.now() + clockOff;
const overlayOpen = () => !$('settings').classList.contains('hidden');

// Release every held key whenever the browser might swallow a keyup (stuck "W keeps walking" bug).
function releaseKeys() { keys = {}; jumpHeld = false; }
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  // On macOS no keyup arrives for keys released while ⌘ is held, so never latch keys during shortcuts.
  if (e.metaKey || e.ctrlKey || e.altKey || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') { releaseKeys(); return; }
  if (e.code === 'Escape') { if (game.state !== 'menu') toggleSettings(); return; }
  if (!e.repeat && e.code === 'Space') jumpBuf = 0.14;
  if (!e.repeat && /^Digit[1-4]$/.test(e.code)) doEmote(+e.code.slice(5));
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') releaseKeys();
});
window.addEventListener('blur', releaseKeys);
window.addEventListener('contextmenu', (e) => { releaseKeys(); if (e.target === canvas) e.preventDefault(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseKeys(); });
document.addEventListener('focusin', (e) => { if (e.target && e.target.tagName === 'INPUT') releaseKeys(); });

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.45 && joy.id === null && game.state !== 'done') {
    joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0;
    const s = $('stick'); s.style.display = 'block'; s.style.left = (e.clientX - 60) + 'px'; s.style.top = (e.clientY - 60) + 'px';
  } else if (drag.id === null) { drag.id = e.pointerId; drag.x = e.clientX; drag.y = e.clientY; }
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === joy.id) {
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy; const l = Math.hypot(dx, dy), m = 52;
    if (l > m) { dx *= m / l; dy *= m / l; }
    joy.x = dx / m; joy.y = dy / m;
    $('stick').firstElementChild.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  } else if (e.pointerId === drag.id) {
    const k = (e.pointerType === 'touch' ? 0.0075 : 0.006) * opt.sens;
    cam.yaw -= (e.clientX - drag.x) * k; cam.pitch = clamp(cam.pitch + (e.clientY - drag.y) * k * 0.85, -0.25, 1.35);
    drag.x = e.clientX; drag.y = e.clientY; lastLookT = clock();
  }
});
function pointerEnd(e) {
  if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; $('stick').style.display = 'none'; $('stick').firstElementChild.style.transform = ''; }
  if (e.pointerId === drag.id) drag.id = null;
}
canvas.addEventListener('pointerup', pointerEnd); canvas.addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist + e.deltaY * 0.01, 4, 22); e.preventDefault(); }, { passive: false });
const jb = $('jump');
jb.addEventListener('pointerdown', (e) => { jumpHeld = true; jumpBuf = 0.14; e.preventDefault(); });
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => jb.addEventListener(ev, () => { jumpHeld = false; }));
window.addEventListener('touchstart', () => { document.body.classList.add('touch'); }, { once: true, passive: true });

// ---------- UI helpers ----------
let toastTimer = null;
function toast(msg, ms) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms || 2200);
}
function feed(msg) {
  const box = $('feed'), d = document.createElement('div'); d.textContent = msg; box.appendChild(d);
  while (box.children.length > 4) box.removeChild(box.firstChild);
  setTimeout(() => { d.classList.add('out'); setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 650); }, 5200);
}
function fmt(t) { return t >= 60 ? Math.floor(t / 60) + ':' + (t % 60 < 10 ? '0' : '') + (t % 60).toFixed(1) : t.toFixed(1) + '초'; }
function showCount(text) {
  const el = $('count'); el.textContent = text; el.classList.toggle('word', text.length > 1); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}
function setGoal() {
  const g = $('goal');
  g.textContent = me.hasKey ? '🚪 열쇠를 들고 벽의 쥐구멍으로!' : '🔑 계단 꼭대기의 열쇠를 찾아요';
  g.classList.toggle('key', me.hasKey);
  $('pointerLabel').textContent = me.hasKey ? '쥐구멍' : '열쇠';
}
function doEmote(idx) {
  if (game.state === 'menu') return;
  me.emote = idx; me.emoteT = 2.6; sfx('emote');
}
function toggleSettings(force) {
  const el = $('settings'), show = force === undefined ? el.classList.contains('hidden') : force;
  el.classList.toggle('hidden', !show); releaseKeys();
}

// ---------- menus ----------
(function buildUI() {
  // emotes
  const eb = $('emotes');
  EMOTES.forEach((em, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = em; b.setAttribute('aria-label', '이모티콘 ' + em);
    const k = document.createElement('kbd'); k.textContent = i + 1; b.appendChild(k);
    b.addEventListener('click', () => { doEmote(i + 1); b.blur(); });
    eb.appendChild(b);
  });
  // colour swatches
  const sw = $('swatches');
  const savedC = store.get('color', null);
  if (typeof savedC === 'number' && savedC >= 0 && savedC < COLORS.length) { me.colorIdx = savedC; setAvatarColor(player, savedC); }
  COLORS.forEach((c, i) => {
    const b = document.createElement('button'); b.type = 'button';
    b.style.background = hexCss(c); b.setAttribute('aria-label', '색 ' + (i + 1));
    if (i === me.colorIdx) b.classList.add('sel');
    b.addEventListener('click', () => {
      me.colorIdx = i; setAvatarColor(player, i); store.set('color', i);
      Array.prototype.forEach.call(sw.children, (x) => x.classList.remove('sel')); b.classList.add('sel');
    });
    sw.appendChild(b);
  });
  let savedName = store.get('name', '');
  if (!savedName) { try { savedName = localStorage.getItem('keyEscapeName') || ''; } catch (e) { /* ignore */ } }
  $('name').value = String(savedName).slice(0, 12);
  $('startBtn').addEventListener('click', startGame);
  $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) startGame(); });
  $('starMax').textContent = stars.length;

  // settings
  const bind = (id, key, onChange) => {
    const el = $(id); el.checked = opt[key];
    el.addEventListener('change', () => { opt[key] = el.checked; store.set(key, opt[key]); if (onChange) onChange(); });
  };
  bind('optSfx', 'sfx', () => sfx('star'));
  bind('optMusic', 'music', () => { audio(); music.next = 0; });
  bind('optAuto', 'autoCam');
  $('optSens').value = opt.sens;
  $('optSens').addEventListener('input', (e) => { opt.sens = clamp(+e.target.value || 1, 0.4, 2); store.set('sens', opt.sens); });
  $('optQuality').value = opt.quality;
  $('optQuality').addEventListener('change', (e) => { opt.quality = e.target.value === 'low' ? 'low' : 'high'; store.set('quality', opt.quality); applyQuality(); });
  $('setBtn').addEventListener('click', (e) => { toggleSettings(); e.currentTarget.blur(); });
  $('closeSet').addEventListener('click', () => toggleSettings(false));
  $('settings').addEventListener('click', (e) => { if (e.target === $('settings')) toggleSettings(false); });
  $('restartBtn').addEventListener('click', () => { toggleSettings(false); beginRun(3); });

  $('shareBtn').addEventListener('click', (e) => {
    const url = location.href, done = () => toast('🔗 주소를 복사했어요! 친구에게 보내세요');
    if (navigator.share && document.body.classList.contains('touch')) navigator.share({ title: '황금 열쇠 대탈출', url }).catch(() => {});
    else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => toast(url, 5000));
    else toast(url, 5000);
    e.currentTarget.blur();
  });
  $('groupBtn').addEventListener('click', (e) => { groupStart(); e.currentTarget.blur(); });
  $('groupAgainBtn').addEventListener('click', groupStart);
  $('againBtn').addEventListener('click', () => beginRun(3));
  $('watchBtn').addEventListener('click', startSpectate);
  $('specNext').addEventListener('click', () => { spec.idx++; });
  $('specAgain').addEventListener('click', () => beginRun(3));
})();
document.body.classList.add('menu');

function startGame() {
  me.name = ($('name').value || '').replace(/[<>]/g, '').trim().slice(0, 12) || ('장난감' + Math.floor(Math.random() * 90 + 10));
  store.set('name', me.name);
  $('start').classList.add('hidden'); document.body.classList.remove('menu');
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // hand the keyboard back to the game
  audio(); music.on = true;
  beginRun(3);
}
function beginRun(countdown) {
  me.hasKey = false; me.finished = null; me.stars = 0; me.cp = -1; me.emote = 0; me.shield = false; knock.cd = 0;
  stars.forEach((s) => { s.got = false; s.mesh.visible = true; });
  shields.forEach((s) => { s.respawn = 0; s.g.visible = true; });
  flags.forEach((fl) => fl.cloth.material.color.copy(C(0xadb5bd)));
  boxes.forEach((b) => b.mesh.position.set(b.home[0], b.top / 2, b.home[1]));
  $('stars').textContent = '0'; $('time').textContent = '0.0';
  $('end').classList.add('hidden'); $('spectate').classList.add('hidden'); spec.on = false;
  releaseKeys(); spawn(); player.visible = true;
  cam.yaw = Math.PI * 0.15; cam.pitch = 0.42;
  game.state = 'countdown'; game.cdEnd = clock() + (countdown || 3) * 1000; game.lastCount = null; game.elapsed = 0;
  hs.state = 'hover'; hs.t = 9; marker.visible = false;
  fps.t = 0; fps.n = 0;
  setGoal();
}
function groupStart() {
  if (!netOk) { beginRun(3); return; }
  try { ws.send(JSON.stringify({ cmd: 'start', n: me.name })); } catch (e) { /* reconnecting */ }
  groupStart.sent = performance.now();
  setTimeout(() => { if (groupStart.sent && performance.now() - groupStart.sent > 900) { groupStart.sent = 0; toast('조금 뒤에 다시 눌러 주세요'); } }, 1000);
}

// ---------- support height / collisions ----------
function supportAt(x, y, z) {
  let s = 0;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (Math.abs(x - b.mesh.position.x) <= b.half + 0.1 && Math.abs(z - b.mesh.position.z) <= b.half + 0.1 && y >= b.top - 0.25) s = Math.max(s, b.top);
  }
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (Math.hypot(x - p.x, z - p.z) <= p.r) s = Math.max(s, p.top);
  }
  for (let i = 0; i < steps.length; i++) {
    const p = steps[i];
    if (y + STEP_UP < p.topY) continue;
    const dx = x - p.cx, dz = z - p.cz, lx = dx * p.cos - dz * p.sin, lz = dx * p.sin + dz * p.cos;
    if (Math.abs(lx) <= p.hw && Math.abs(lz) <= p.hd) s = Math.max(s, p.topY);
  }
  if (y + STEP_UP >= altar.topY && Math.hypot(x - altar.cx, z - altar.cz) <= altar.r) s = Math.max(s, altar.topY);
  return s;
}
function pushBoxes() {
  const px = player.position, lim = ROOM - 0.4;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i], bp = b.mesh.position, reach = b.half + 0.38;
    const dx = px.x - bp.x, dz = px.z - bp.z;
    if (Math.abs(dx) >= reach || Math.abs(dz) >= reach || px.y >= b.top - 0.25) continue;
    if (reach - Math.abs(dx) < reach - Math.abs(dz)) {
      const nx = clamp(px.x - Math.sign(dx || 1) * reach, -lim + b.half, lim - b.half);
      bp.x = nx; px.x = nx + Math.sign(dx || 1) * reach;
    } else {
      const nz = clamp(px.z - Math.sign(dz || 1) * reach, -lim + b.half, lim - b.half);
      bp.z = nz; px.z = nz + Math.sign(dz || 1) * reach;
    }
  }
}

// ---------- player update ----------
function shove(dx, dz, power, up, msg) {
  const l = Math.hypot(dx, dz) || 1;
  knock.x = dx / l * power; knock.z = dz / l * power; knock.cd = 1.1;
  vy = up; grounded = false; airT = 1; bounceT = 0.4;
  cam.shake = Math.max(cam.shake, 0.25); sfx('hit'); toast(msg, 1800);
  if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* ignore */ } }
}
function physStep(dt, ix, iz) {
  const p = player.position, hasInput = Math.hypot(ix, iz) > 0.08;
  // horizontal: accelerate toward the wanted velocity (snappy on the ground, floaty in the air)
  const tx = hasInput ? ix * SPEED : 0, tz = hasInput ? iz * SPEED : 0;
  const acc = (grounded ? (hasInput ? 60 : 75) : (hasInput ? 24 : 5)) * dt;
  const dvx = tx - vel.x, dvz = tz - vel.z, dl = Math.hypot(dvx, dvz);
  if (dl <= acc) { vel.x = tx; vel.z = tz; } else { vel.x += dvx / dl * acc; vel.z += dvz / dl * acc; }
  if (knock.x || knock.z) {
    const kd = Math.pow(0.02, dt); knock.x *= kd; knock.z *= kd;
    if (Math.abs(knock.x) + Math.abs(knock.z) < 0.3) knock.x = knock.z = 0;
  }
  p.x += (vel.x + knock.x) * dt; p.z += (vel.z + knock.z) * dt;
  pushBoxes();
  p.x = clamp(p.x, -ROOM + 0.4, ROOM - 0.4); p.z = clamp(p.z, -ROOM + 0.4, ROOM - 0.4);

  // jump: buffered press + a short grace period after walking off an edge
  const held = keys.Space || jumpHeld;
  if ((jumpBuf > 0 || held) && (grounded || airT < 0.1) && vy <= 0.01) {
    vy = JUMP_V; grounded = false; airT = 1; jumpBuf = 0; squash.s = 1.25; sfx('jump');
  }
  // letting go early makes a shorter hop
  const g = GRAVITY * ((vy > 0 && !held && bounceT <= 0) ? 2.3 : 1);
  const prevY = p.y;
  vy -= g * dt; p.y += vy * dt;
  const sup = supportAt(p.x, Math.max(prevY, p.y), p.z);
  if (p.y <= sup && vy <= 0.01) {
    if (!grounded) {
      fallSpeed = -vy;
      if (fallSpeed > 7) { squash.s = clamp(1 - fallSpeed * 0.022, 0.62, 1); sfx('land'); burst(p.x, sup + 0.1, p.z, 0xffffff, 6, 1.6, 0.2); }
    }
    p.y = sup; vy = 0; grounded = true; airT = 0;
    // trampolines
    for (let i = 0; i < pads.length; i++) {
      const pd = pads[i];
      if (Math.abs(sup - pd.top) < 0.01 && Math.hypot(p.x - pd.x, p.z - pd.z) <= pd.r - 0.15) {
        vy = PAD_V; grounded = false; airT = 1; bounceT = 1.5; pd.bounce = 1; squash.s = 1.35; sfx('boing');
        burst(p.x, pd.top + 0.1, p.z, 0x74c0fc, 10, 3);
        if (!padTipShown) { padTipShown = true; toast('🎪 트램펄린! 공중에서 방향을 잡아 계단에 착지해요', 2800); }
      }
    }
  } else { grounded = false; airT += dt; }
}
function updatePlayer(dt) {
  let f = 0, r = 0;
  if (!overlayOpen()) {
    if (keys.KeyW || keys.ArrowUp) f += 1; if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) r += 1; if (keys.KeyA || keys.ArrowLeft) r -= 1;
  }
  f -= joy.y; r += joy.x;
  let ix = -Math.sin(cam.yaw) * f + Math.cos(cam.yaw) * r, iz = -Math.cos(cam.yaw) * f - Math.sin(cam.yaw) * r;
  const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }

  if (knock.cd > 0) knock.cd -= dt;
  if (jumpBuf > 0) jumpBuf -= dt;
  if (bounceT > 0) bounceT -= dt;
  const n = Math.max(1, Math.ceil(dt / (1 / 90)));      // small fixed sub-steps: stable on slow devices
  for (let i = 0; i < n; i++) physStep(dt / n, ix, iz);

  const p = player.position, sp = Math.hypot(vel.x, vel.z), moving = sp > 0.6;
  if (moving) player.rotation.y += angDiff(Math.atan2(vel.x, vel.z), player.rotation.y) * Math.min(1, dt * 14);
  animateAvatar(player, moving, grounded, dt);
  // squash & stretch spring, a little forward lean
  squash.v += (1 - squash.s) * 170 * dt; squash.v *= Math.pow(0.0006, dt); squash.s += squash.v * dt;
  const sy = clamp(squash.s, 0.55, 1.45), sxz = 1 / Math.sqrt(sy), rig = player.userData.rig;
  rig.scale.set(sxz, sy, sxz);
  rig.rotation.x = lerp(rig.rotation.x, grounded ? (sp / SPEED) * 0.16 : -0.12, damp(0.001, dt));
  if (moving && grounded) { stepPh += dt * sp * 0.62; if (stepPh >= 1) { stepPh = 0; sfx('step'); } }

  // stars
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    if (!s.got && Math.hypot(p.x - s.x, p.z - s.z) < 1.1 && Math.abs(p.y + 0.9 - s.y) < 1.3) {
      s.got = true; s.mesh.visible = false; me.stars++; $('stars').textContent = me.stars;
      sfx('star'); burst(s.x, s.y, s.z, 0xffe066, 14, 4);
      if (me.stars === stars.length) toast('⭐ 별을 전부 모았어요!', 2400);
    }
  }
  // shield pickups
  for (let i = 0; i < shields.length; i++) {
    const s = shields[i];
    if (s.respawn > 0) { s.respawn -= dt; if (s.respawn <= 0) s.g.visible = true; continue; }
    if (!me.shield && Math.hypot(p.x - s.x, p.z - s.z) < 1.2 && Math.abs(p.y + 0.9 - s.y) < 1.4) {
      me.shield = true; s.g.visible = false; s.respawn = 25; sfx('shield'); burst(s.x, s.y, s.z, 0x74c0fc, 16, 4);
      toast('🛡 방패 획득! 손을 한 번 막아줘요', 2400);
    }
  }
  // checkpoint flags
  if (grounded) for (let i = 0; i < flags.length; i++) {
    const fl = flags[i], st = steps[fl.idx];
    if (fl.idx > me.cp && Math.abs(p.y - st.topY) < 0.2 && Math.hypot(p.x - st.cx, p.z - st.cz) < 2.6) {
      me.cp = fl.idx; fl.cloth.material.color.copy(C(0xff4d6d)); sfx('flag');
      toast('🚩 체크포인트! 잡혀도 여기서 다시 시작해요', 2400);
    }
  }
  if (knock.cd <= 0) {
    // rolling marbles
    for (let i = 0; i < marbles.length; i++) {
      const mb = marbles[i], mp = mb.mesh.position;
      if (mb.live && Math.hypot(p.x - mp.x, p.z - mp.z) < MARBLE_R + 0.45 && p.y < mp.y + MARBLE_R * 0.6 && p.y + 1.6 > mp.y - MARBLE_R) {
        shove(mb.dx, mb.dz, 11, 6.5, '🔴 구슬에 맞았어요! 점프로 피해요'); break;
      }
    }
    // spinning bars
    for (let i = 0; i < sweepers.length && knock.cd <= 0; i++) {
      const sw = sweepers[i], dx = p.x - sw.st.cx, dz = p.z - sw.st.cz, c = Math.cos(sw.ang), s = Math.sin(sw.ang);
      const along = dx * c - dz * s, perp = dx * s + dz * c;
      if (Math.abs(along) < SWEEP_LEN + 0.1 && Math.abs(perp) < 0.5 && p.y < sw.st.topY + 0.62 && p.y > sw.st.topY - 0.4) {
        // push the way the bar is travelling at that point
        const tvx = sw.dir * dz, tvz = -sw.dir * dx, tl = Math.hypot(tvx, tvz);
        if (tl > 0.3) shove(tvx, tvz, 9.5, 5.5, '🌀 막대에 맞았어요! 타이밍을 보고 점프!');
        else shove(dx || 1, dz, 7, 5, '🌀 막대에 맞았어요! 타이밍을 보고 점프!');
      }
    }
  }
  // key pickup
  if (!me.hasKey && Math.hypot(p.x - keyPos.x, p.z - keyPos.z) < 1.5 && Math.abs(p.y + 1 - keyPos.y) < 2.2) {
    me.hasKey = true; setGoal(); toast('🔑 황금 열쇠 획득! 이제 쥐구멍으로 탈출하세요!', 2800);
    sfx('key'); burst(keyPos.x, keyPos.y, keyPos.z, 0xffd43b, 30, 6);
  }
  // escape
  const nearExit = p.y < 1 && Math.hypot(p.x - EXIT.x, p.z - EXIT.z) < 1.9;
  if (me.hasKey && nearExit) finish();
  else if (nearExit && !updatePlayer.warned) {
    updatePlayer.warned = true; toast('쥐구멍이 잠겨 있어요. 열쇠가 필요해요 🔒');
    setTimeout(() => { updatePlayer.warned = false; }, 3000);
  }
}
function finish() {
  me.finished = Math.round(game.elapsed * 10) / 10; game.state = 'done';
  marker.visible = false; hs.state = 'hover'; hs.t = 9; releaseKeys();
  $('result').textContent = fmt(me.finished);
  let best = +store.get('best', 0);
  if (!(best > 0)) { try { best = parseFloat(localStorage.getItem('keyEscapeBest')) || 0; } catch (e) { best = 0; } }
  const isNew = !(best > 0) || me.finished < best;
  if (isNew) store.set('best', me.finished);
  $('endStats').textContent = '⭐ ' + me.stars + '/' + stars.length + ' · ' + (isNew ? '🎉 내 최고 기록!' : '내 최고 기록 ' + fmt(best));
  sfx('win');
  const pp = player.position;
  [0xff6b6b, 0xffd43b, 0x4dabf7, 0x69db7c].forEach((c) => burst(pp.x, pp.y + 1.5, pp.z - 1.5, c, 24, 8));
  if (netOk) { try { ws.send(JSON.stringify({ cmd: 'finish', t: me.finished, s: me.stars })); } catch (e) { /* offline */ } }
  renderRank();
  $('end').classList.remove('hidden');
}
function caught() {
  if (me.shield) {
    me.shield = false; sfx('pop'); burst(player.position.x, player.position.y + 1, player.position.z, 0x74c0fc, 26, 6);
    toast('🛡 방패가 막아줬어요!', 2000); cam.shake = 0.4; return;
  }
  const hadKey = me.hasKey, back = me.cp >= 0 ? '체크포인트로' : '처음으로';
  me.hasKey = false; setGoal(); spawn(); cam.shake = 0.5; sfx('caught');
  toast(hadKey ? '✋ 잡혔어요! 열쇠를 빼앗기고 ' + back + '…' : '✋ 잡혔어요! ' + back + ' 돌아갑니다', 2600);
  if (navigator.vibrate) { try { navigator.vibrate([80, 40, 120]); } catch (e) { /* ignore */ } }
}

// ---------- the hand ----------
function updateHand(dt, now) {
  const p = player.position, hp = hand.position, active = game.state === 'play';
  let danger = 0;
  if (hs.state === 'hover') {
    const k = damp(0.2, dt);
    hp.x += (p.x * 0.6 - hp.x) * k; hp.z += (p.z * 0.6 - 4 - hp.z) * k; hp.y += (p.y + 17 - hp.y) * k;
    if (active) { hs.t -= dt; if (hs.t <= 0) { hs.state = 'warn'; hs.t = 1.5; marker.visible = true; sfx('warn'); } }
  } else if (hs.state === 'warn') {
    hs.t -= dt;
    if (hs.t > 0.55) { hs.tx = p.x; hs.tz = p.z; hs.ty = grounded ? p.y : supportAt(p.x, p.y, p.z); }   // tracks you, then locks
    marker.position.set(hs.tx, hs.ty + 0.08, hs.tz);
    markRing.material.opacity = 0.45 + 0.45 * Math.abs(Math.sin(now * 0.02));
    markFill.scale.setScalar(clamp(1 - hs.t / 1.5, 0.05, 1));
    const k2 = damp(0.001, dt);
    hp.x += (hs.tx - hp.x) * k2; hp.z += (hs.tz - hp.z) * k2; hp.y += (hs.ty + 10 - hp.y) * k2;
    if (active && Math.hypot(p.x - hs.tx, p.z - hs.tz) < HAND_R) danger = 1 - hs.t / 1.5;
    if (hs.t <= 0) { hs.state = 'slam'; hs.t = 0.22; hs.fromY = hp.y; hp.x = hs.tx; hp.z = hs.tz; }
  } else if (hs.state === 'slam') {
    hs.t -= dt;
    const u = clamp(1 - hs.t / 0.22, 0, 1);
    hp.y = hs.fromY + (hs.ty + 0.7 - hs.fromY) * u * u;
    if (hs.t <= 0) {
      cam.shake = Math.max(cam.shake, 0.3); marker.visible = false;
      if (active) { sfx('slam'); burst(hs.tx, hs.ty + 0.2, hs.tz, 0xffffff, 18, 5, 0.22); }
      if (active && Math.hypot(p.x - hs.tx, p.z - hs.tz) < HAND_R && Math.abs(p.y - hs.ty) < 2.4) caught();
      hs.state = 'rest'; hs.t = 0.8;
    }
  } else if (hs.state === 'rest') {
    hs.t -= dt;
    if (hs.t <= 0) {
      hs.state = 'hover';
      // the kid gets impatient the higher you climb, and furious once you hold the key
      const hurry = me.hasKey ? 1 : clamp(p.y / TOP_Y, 0, 1) * 0.6;
      hs.t = (6 - 2.6 * hurry) + Math.random() * (4 - 1.8 * hurry);
    }
  }
  $('vignette').style.opacity = danger > 0 ? (0.35 + 0.65 * danger).toFixed(2) : '0';
  // the kid watches you: eyes follow, eyebrows get angry when you hold the key, and it blinks
  const ex = clamp(p.x / ROOM, -1, 1) * 0.55, ey = clamp((p.y - 8) / 16, -1, 1) * 0.5;
  pupils.forEach((pu) => { pu.m.position.x = pu.bx + ex; pu.m.position.y = 0.6 + ey; });
  const angry = me.hasKey && active ? 1 : 0;
  brows.forEach((b) => { b.m.rotation.z = lerp(b.m.rotation.z, -b.s * 0.38 * angry, damp(0.01, dt)); b.m.position.y = lerp(b.m.position.y, 2.9 - angry * 0.5, damp(0.01, dt)); });
  const blink = (now % 4200) < 130 ? 0.12 : 1;
  lids.forEach((l) => { l.scale.y = blink; }); pupils.forEach((pu) => { pu.m.scale.y = blink; });
  kid.position.y = 16 + Math.sin(now * 0.0012) * 0.5;
}

// ---------- multiplayer ----------
let ws = null, netOk = false, snapshot = [], myId = null, records = [];
const remotes = {}, prevPeers = {};
let lastSend = 0, peersSeen = false;
const roomCode = (new URLSearchParams(location.search).get('room') || 'lobby').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'lobby';
$('roomName').textContent = roomCode === 'lobby' ? '플레이어' : roomCode + ' 방';
function readPeer(pr) {
  if (!pr || typeof pr !== 'object') return null;
  const a = pr.p;
  if (!Array.isArray(a) || a.length < 4) return null;
  for (let i = 0; i < 4; i++) if (typeof a[i] !== 'number' || !isFinite(a[i])) return null;
  return {
    x: clamp(a[0], -ROOM, ROOM), y: clamp(a[1], 0, 60), z: clamp(a[2], -ROOM, ROOM), ry: a[3],
    name: (typeof pr.n === 'string' && pr.n.trim() ? pr.n.trim().slice(0, 12) : '친구'),
    c: (typeof pr.c === 'number' && isFinite(pr.c)) ? ((Math.floor(pr.c) % COLORS.length) + COLORS.length) % COLORS.length : 0,
    e: (typeof pr.e === 'number' && pr.e >= 1 && pr.e <= EMOTES.length) ? Math.floor(pr.e) : 0,
    s: (typeof pr.s === 'number' && isFinite(pr.s)) ? clamp(Math.floor(pr.s), 0, 99) : 0,
    k: pr.k === true, sh: pr.sh === true, t: (typeof pr.t === 'number' && isFinite(pr.t) && pr.t > 0) ? pr.t : null,
  };
}
function syncRemotes(dt) {
  const seen = {}, list = [], peers = netOk ? snapshot : [], champ = records.length ? records[0].id : null;
  for (let i = 0; i < peers.length; i++) {
    const p = peers[i]; if (!p || typeof p.id !== 'string') continue;
    const d = readPeer(p); if (!d) continue;
    d.id = p.id; seen[p.id] = true; list.push(d);
    let r = remotes[p.id];
    if (!r) {
      r = { av: makeAvatar(d.c), label: makeLabel(d.name), lastY: d.y };
      r.av.add(r.label); r.av.position.set(d.x, d.y, d.z); r.av.rotation.y = d.ry; scene.add(r.av); remotes[p.id] = r;
    }
    const ud = r.av.userData, pos = r.av.position;
    setAvatarColor(r.av, d.c); setLabel(r.label, d.name);
    ud.key.visible = d.k; ud.shield.visible = d.sh; ud.crown.visible = p.id === champ; r.av.visible = d.t === null; showEmote(r.av, d.e);
    const k = damp(0.0005, dt), moved = Math.hypot(d.x - pos.x, d.z - pos.z), air = Math.abs(d.y - pos.y) > 0.35;
    if (moved > 12) pos.set(d.x, d.y, d.z);     // respawned: snap instead of sliding across the room
    else { pos.x += (d.x - pos.x) * k; pos.y += (d.y - pos.y) * k; pos.z += (d.z - pos.z) * k; }
    r.av.rotation.y += angDiff(d.ry, r.av.rotation.y) * k;
    animateAvatar(r.av, moved > 0.03, !air, dt);

    // little news feed
    const prev = prevPeers[p.id];
    if (!prev) { if (peersSeen && game.state !== 'menu') { feed('👋 ' + d.name + ' 입장'); sfx('join'); } }
    else {
      if (d.k && !prev.k) feed('🔑 ' + d.name + ' 열쇠 획득!');
      if (d.t !== null && prev.t === null) feed('🏁 ' + d.name + ' 탈출! ' + fmt(d.t));
    }
    prevPeers[p.id] = { k: d.k, t: d.t, name: d.name };
  }
  if (netOk && snapshot.received) peersSeen = true;
  for (const id in remotes) if (!seen[id]) {
    scene.remove(remotes[id].av); delete remotes[id];
    if (prevPeers[id] && game.state !== 'menu') feed('🚪 ' + prevPeers[id].name + ' 퇴장');
    delete prevPeers[id];
  }
  player.userData.crown.visible = myId !== null && myId === champ;
  return list;
}
function sendPresence(now) {
  if (!ws || ws.readyState !== 1 || now - lastSend < 66 || game.state === 'menu') return;
  lastSend = now;
  const p = player.position, r2 = (v) => Math.round(v * 100) / 100;
  try {
    ws.send(JSON.stringify({ n: me.name, c: me.colorIdx, k: me.hasKey, sh: me.shield, t: me.finished, e: me.emote, s: me.stars,
      p: [r2(p.x), r2(p.y), r2(p.z), r2(player.rotation.y)] }));
  } catch (e) { /* reconnecting */ }
}
function connect() {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  try {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?room=' + encodeURIComponent(roomCode));
  } catch (e) { setTimeout(connect, 3000); return; }
  ws.onopen = () => { netOk = true; };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (typeof m.hello === 'string') myId = m.hello;
    if (Array.isArray(m.rec)) { records = m.rec.filter((r) => r && typeof r.t === 'number' && isFinite(r.t)).slice(0, 10); renderRank(); }
    if (Array.isArray(m.peers)) { snapshot = m.peers; snapshot.received = true; }
    if (m.ev === 'start' && typeof m.in === 'number') {
      groupStart.sent = 0;
      if (game.state === 'menu') return;
      toggleSettings(false);
      beginRun(clamp(m.in / 1000, 1, 10));
      toast('🏁 ' + (typeof m.by === 'string' ? m.by.slice(0, 12) : '친구') + ' 님이 다 같이 출발을 눌렀어요!', 3000);
    }
  };
  ws.onclose = (e) => {
    netOk = false; snapshot = []; myId = null;
    if (e && e.code === 1013) { $('net').textContent = '방이 꽉 찼어요'; setTimeout(connect, 8000); } else setTimeout(connect, 2000);
  };
  ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };
}
connect();

// ---------- board / progress / ranking ----------
function updateBoard(list) {
  const rows = [{ id: 'me', name: me.name, c: me.colorIdx, y: player.position.y, k: me.hasKey, t: me.finished, s: me.stars, me: true }];
  list.forEach((d) => rows.push({ id: d.id, name: d.name, c: d.c, y: d.y, k: d.k, t: d.t, s: d.s, me: false }));
  rows.sort((a, b) => {
    if ((a.t !== null) !== (b.t !== null)) return a.t !== null ? -1 : 1;
    if (a.t !== null) return a.t - b.t;
    if (a.k !== b.k) return a.k ? -1 : 1;
    return b.y - a.y;
  });
  const champ = records.length ? records[0].id : null;
  const ol = $('list'); ol.textContent = '';
  rows.slice(0, 8).forEach((r) => {
    const li = document.createElement('li'); if (r.me) li.className = 'me';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = hexCss(COLORS[r.c]);
    const nm = document.createElement('span'); nm.className = 'nm';
    nm.textContent = ((r.me ? myId === champ && champ !== null : r.id === champ) ? '👑 ' : '') + r.name + (r.me ? ' (나)' : '');
    const st = document.createElement('span'); st.className = 'st';
    st.textContent = r.t !== null ? '🏁 ' + fmt(r.t) : (r.k ? '🔑 ' : '') + Math.round(r.y) + 'm';
    li.appendChild(dot); li.appendChild(nm); li.appendChild(st); ol.appendChild(li);
  });
  if (rows.length > 8) { const li = document.createElement('li'); li.textContent = '… 외 ' + (rows.length - 8) + '명'; ol.appendChild(li); }
  const n = rows.length;
  $('net').textContent = netOk ? (n > 1 ? n + '명' : '친구 기다리는 중') : '연결 중…';
  $('roomInfo').textContent = netOk ? (list.length ? '지금 이 방에서 ' + list.length + '명이 놀고 있어요 🎮' : '이 주소를 친구에게 보내면 같은 방에서 만나요') : '서버에 연결하는 중…';

  // race bar on the left
  const track = $('track'); track.textContent = '';
  rows.slice().reverse().forEach((r) => {
    if (r.t !== null && !r.me) return;
    const d = document.createElement('span'); d.className = 'pd' + (r.me ? ' me' : '') + (r.k ? ' haskey' : '');
    d.style.background = hexCss(COLORS[r.c]); d.style.bottom = (clamp(r.y / TOP_Y, 0, 1) * 100).toFixed(1) + '%';
    track.appendChild(d);
  });
}
function renderRank() {
  const ol = $('rank'); if (!ol) return; ol.textContent = '';
  let rows = records.slice(0, 5).map((r) => ({ n: typeof r.n === 'string' ? r.n.slice(0, 12) : '친구', c: clamp(Math.floor(+r.c) || 0, 0, COLORS.length - 1), t: r.t, s: r.s | 0, me: r.id === myId }));
  if (!rows.length && me.finished !== null) rows = [{ n: me.name, c: me.colorIdx, t: me.finished, s: me.stars, me: true }];
  if (!rows.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = '아직 기록이 없어요'; ol.appendChild(li); return; }
  rows.forEach((r, i) => {
    const li = document.createElement('li'); if (r.me) li.className = 'me';
    const rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = ['🥇', '🥈', '🥉'][i] || (i + 1);
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = hexCss(COLORS[r.c]);
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.n + (r.me ? ' (나)' : '');
    const st = document.createElement('span'); st.className = 'st'; st.textContent = fmt(r.t) + ' · ⭐' + r.s;
    li.appendChild(rk); li.appendChild(dot); li.appendChild(nm); li.appendChild(st); ol.appendChild(li);
  });
}
renderRank();

// ---------- goal pointer ----------
const tmpV = new THREE.Vector3();
function updatePointer() {
  const el = $('pointer');
  if (game.state !== 'play') { el.style.display = 'none'; return; }
  if (me.hasKey) tmpV.set(EXIT.x, 1.2, ROOM - 0.5); else tmpV.copy(keyPos);
  const dist = tmpV.distanceTo(player.position);
  tmpV.project(camera);
  const behind = tmpV.z > 1;
  let x = tmpV.x, y = tmpV.y;
  if (behind) { x = -x; y = -y; }
  if (!behind && Math.abs(x) < 0.82 && Math.abs(y) < 0.78 || dist < 6) { el.style.display = 'none'; return; }
  const a = Math.atan2(y, x), w = window.innerWidth, h = window.innerHeight;
  const rx = w / 2 - 54, ry = h / 2 - (w < 760 ? 178 : 90);
  el.style.display = 'block';
  el.style.transform = 'translate(' + (w / 2 + Math.cos(a) * rx).toFixed(0) + 'px,' + (h / 2 - Math.sin(a) * ry).toFixed(0) + 'px)';
  el.firstElementChild.style.transform = 'rotate(' + (Math.PI / 2 - a).toFixed(2) + 'rad)';
}

// ---------- spectating after you escape ----------
const spec = { on: false, idx: 0 };
function startSpectate() {
  $('end').classList.add('hidden'); $('spectate').classList.remove('hidden'); spec.on = true; spec.idx = 0;
}
function spectateTarget(list) {
  const racing = list.filter((d) => d.t === null);
  if (!racing.length) { $('specName').textContent = '달리는 친구가 없어요'; return null; }
  const d = racing[spec.idx % racing.length], r = remotes[d.id];
  $('specName').textContent = '👀 ' + d.name + ' 구경 중';
  return r ? r.av.position : null;
}

// ---------- camera ----------
function updateCamera(dt, now, list) {
  let target = player.position;
  if (spec.on) { target = spectateTarget(list) || tmpV.set(0, 6, -1); }
  if (!cam.ready) { cam.pos.copy(target); cam.ready = true; }
  cam.pos.x = lerp(cam.pos.x, target.x, damp(0.00002, dt)); cam.pos.z = lerp(cam.pos.z, target.z, damp(0.00002, dt));
  cam.pos.y = lerp(cam.pos.y, target.y, damp(0.003, dt));              // softer vertically: stairs don't jitter
  // gently swing behind the direction you run in, unless you just moved the view yourself
  if (opt.autoCam && game.state === 'play' && !spec.on && drag.id === null && now - lastLookT > 1200) {
    const sp = Math.hypot(vel.x, vel.z);
    if (sp > 2) {
      const want = Math.atan2(-vel.x, -vel.z), d = angDiff(want, cam.yaw);
      if (Math.abs(d) < 2.3) cam.yaw += d * Math.min(1, dt * 1.5) * (sp / SPEED);
    }
  }
  if (game.state === 'menu') cam.yaw += dt * 0.08;
  else if (spec.on && drag.id === null) cam.yaw += dt * 0.12;
  const cp = Math.cos(cam.pitch), tx = cam.pos.x, ty = cam.pos.y + 1.4, tz = cam.pos.z;
  let sx = 0, sy = 0;
  if (cam.shake > 0) { cam.shake = Math.max(0, cam.shake - dt); sx = (Math.random() - 0.5) * cam.shake; sy = (Math.random() - 0.5) * cam.shake; }
  camera.position.set(tx + Math.sin(cam.yaw) * cp * cam.dist + sx, Math.max(0.4, ty + Math.sin(cam.pitch) * cam.dist + sy), tz + Math.cos(cam.yaw) * cp * cam.dist);
  camera.lookAt(tx, ty, tz);
}

// ---------- main loop ----------
const fps = { t: 0, n: 0, checked: false };
let last = clock(), boardT = 0;
function frame() {
  requestAnimationFrame(frame);
  step(clock());
}
function step(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;

  if (game.state === 'countdown') {
    const left = (game.cdEnd - now) / 1000, n = Math.ceil(left);   // real time, so everyone in the room starts together
    if (n !== game.lastCount && n <= 3 && n >= 1) { game.lastCount = n; showCount(String(n)); sfx('tick'); }
    animateAvatar(player, false, true, dt);
    if (left <= 0) { game.state = 'play'; game.t0 = now; showCount('출발!'); sfx('go'); toast('계단을 올라 황금 열쇠를 찾으세요!', 2200); }
  } else if (game.state === 'play') {
    game.elapsed = (now - game.t0) / 1000;
    updatePlayer(dt);
    // drop to "빠르게" automatically on slow devices
    if (!fps.checked) { fps.t += dt; fps.n++; if (fps.t > 5) { fps.checked = true; if (fps.n / fps.t < 26 && opt.quality === 'high') { opt.quality = 'low'; $('optQuality').value = 'low'; applyQuality(); toast('기기가 느려서 그래픽을 가볍게 바꿨어요', 2600); } } }
  }
  updateHand(dt, now); updateMarbles(); updateSweepers(); updateBursts(dt);
  if (me.emoteT > 0) { me.emoteT -= dt; if (me.emoteT <= 0) me.emote = 0; }
  showEmote(player, me.emote);
  player.userData.shield.visible = me.shield; if (me.shield) player.userData.shield.rotation.y += dt;
  for (let i = 0; i < stars.length; i++) { const s = stars[i]; s.mesh.rotation.y += dt * 2.4; s.mesh.position.y = s.y + Math.sin(now * 0.004 + i) * 0.12; }
  shields.forEach((s, i) => { s.g.rotation.y += dt * 1.5; s.g.position.y = s.y + Math.sin(now * 0.003 + i * 2) * 0.12; });
  pads.forEach((pd) => { pd.bounce = Math.max(0, pd.bounce - dt * 3); pd.skin.position.y = 0.29 - Math.sin(pd.bounce * Math.PI) * 0.16; });
  const list = syncRemotes(dt);
  sendPresence(now);

  worldKey.visible = keyBeam.visible = !me.hasKey && game.state !== 'done';
  worldKey.rotation.y += dt * 2; worldKey.position.y = keyPos.y + Math.sin(now * 0.003) * 0.2;
  keyBeam.material.opacity = 0.12 + 0.05 * Math.sin(now * 0.004);
  player.userData.key.visible = me.hasKey; player.visible = game.state !== 'done';
  exitGlow.material.opacity = me.hasKey ? 0.35 + 0.3 * Math.sin(now * 0.006) : 0;
  exitLock.visible = !me.hasKey; exitLock.position.y = 2.5 + Math.sin(now * 0.003) * 0.1;

  boardT -= dt;
  if (boardT <= 0) { boardT = 0.25; $('shieldIcon').classList.toggle('hidden', !me.shield); updateBoard(list); }
  if (game.state === 'play') $('time').textContent = game.elapsed < 60 ? game.elapsed.toFixed(1) : fmt(game.elapsed);
  updateCamera(dt, now, list);
  updatePointer();
  renderer.render(scene, camera);
}
applyQuality();
requestAnimationFrame(frame);

// test hook for local development only
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  window.__gke = { player, me, vel, stars, steps, marbles, sweepers, shields, pads, flags, keyPos, EXIT, hs, game, cam, opt, spec, remotes, get records() { return records; }, get myId() { return myId; }, get netOk() { return netOk; }, beginRun, groupStart, state: () => ({ vy, grounded, airT }),
    tick(n, dt) { for (let i = 0; i < n; i++) { clockOff += (dt || 1 / 60) * 1000; step(clock()); } } };
}
})();
