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
const ITEM_STEPS = [9, 25, 34];   // stair indexes with a mystery item box
const ITEMS = { boost: '🚀', spring: '🦘', banana: '🍌', freeze: '❄️' };
const HATS = [['없음', 0, '🚫'], ['고깔', 5, '🎉'], ['야구모자', 15, '🧢'], ['신사모', 30, '🎩'], ['고양이 귀', 50, '🐱'], ['프로펠러', 80, '🚁']];   // name, stars needed, icon
const DASH_V = 20, DASH_CD = 2.2;
const CHEST = { x: -14.3, z: -14.3 };
// surprise events: the whole room gets the same one, picked from the clock
const EVENTS = [
  { id: 'lowgrav', icon: '🌙', name: '저중력', tip: '점프가 훨씬 높아져요' },
  { id: 'storm', icon: '🔴', name: '구슬 폭풍', tip: '구슬이 두 배로 굴러와요' },
  { id: 'starrain', icon: '⭐', name: '별 비', tip: '보너스 별을 주워요' },
  { id: 'sneeze', icon: '🤧', name: '아이의 재채기', tip: '바람에 밀려나요' },
  { id: 'dark', icon: '🌑', name: '정전', tip: '불이 꺼졌어요' },
  { id: 'speed', icon: '⚡', name: '스피드 타임', tip: '모두 빨라져요' },
];
const EV_PERIOD = 50000, EV_WARN = 5000, EV_LEN = 15000;
const ev = { on: null, phase: 'idle', warnSlot: -1, startT: 0, force: null, grav: 1, speed: 1, storm: false, wind: 0, bonus: [], sky: null, lamp: null, pulse: false };
const ACH = [
  ['first', '첫 탈출', '처음으로 탈출하기'],
  ['fast', '날쌘돌이', '2분 안에 탈출하기'],
  ['faster', '번개', '1분 15초 안에 탈출하기'],
  ['untouched', '손은 눈보다 느리다', '한 번도 잡히지 않고 탈출하기'],
  ['allstars', '별 수집가', '한 판에 별 14개 모두 모으기'],
  ['stars50', '별부자', '별을 누적 50개 모으기'],
  ['bonus', '별똥별', '별 비 이벤트에서 보너스 별 줍기'],
  ['trampoline', '곡예사', '바닥 트램펄린으로 계단에 착지하기'],
  ['island', '구름 위 산책', '구름섬에 올라서기'],
  ['chest', '열려라 참깨', '보물상자 열기'],
  ['shield', '철벽', '방패로 손 막기'],
  ['dodger', '피하기 달인', '손을 누적 20번 피하기'],
  ['bumper', '박치기왕', '박치기를 누적 5번 성공하기'],
  ['thief', '괴도', '쟁탈전에서 조각 빼앗기'],
  ['winner', '쟁탈전 승리', '쟁탈전에서 한 판 이기기'],
];
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
const hemi = new THREE.HemisphereLight(C(0xffffff), C(0xe6cfae), 0.62); scene.add(hemi);
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
function addPad(x, y, z, v) {
  const g = new THREE.Group();
  const rim = mesh(new THREE.CylinderGeometry(1.45, 1.55, 0.28, 28), std(0xff6b6b, 0.5), true); rim.position.y = 0.14; g.add(rim);
  const skin = mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.06, 28), std(0x364fc7, 0.4)); skin.position.y = 0.29; g.add(skin);
  const arrow = mesh(new THREE.CircleGeometry(0.55, 3), basic(0xffffff)); arrow.rotation.x = -Math.PI / 2; arrow.position.y = 0.33; g.add(arrow);
  g.position.set(x, y, z); scene.add(g);
  pads.push({ x, z, r: 1.4, top: y + 0.3, v: v || PAD_V, g, skin, bounce: 0 });
}
[[0.244, 7.0], [5.376, 6.3]].forEach((d) => addPad(Math.cos(d[0]) * d[1], 0, Math.sin(d[0]) * d[1] - 1.0));

// ---------- cloud island in the middle of the room + a shuttle platform from the stairs ----------
const ISLAND = { x: 0, z: -1, y: 9.3, r: 3.2 }, DOCK = steps[26];     // the shuttle docks at stair 26
const plats = [];
(function buildIsland() {
  const cloud = std(0xffffff, 0.9), g = new THREE.Group();
  const top = mesh(new THREE.CylinderGeometry(ISLAND.r, ISLAND.r * 0.8, 0.5, 32), cloud, true); top.position.y = -0.25; g.add(top);
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2, puff = mesh(new THREE.SphereGeometry(1.0 + (i % 3) * 0.25, 14, 10), cloud);
    puff.position.set(Math.cos(a) * 2.5, -0.75, Math.sin(a) * 2.5); g.add(puff);
  }
  g.position.set(ISLAND.x, ISLAND.y, ISLAND.z); scene.add(g);
  plats.push({ x: ISLAND.x, z: ISLAND.z, top: ISLAND.y, r: ISLAND.r, dx: 0, dz: 0, g: null });
  const sg = new THREE.Group();
  const deck = mesh(new THREE.CylinderGeometry(1.5, 1.3, 0.35, 24), std(0xffc9de, 0.5), true); deck.position.y = -0.175; sg.add(deck);
  const ring = mesh(new THREE.TorusGeometry(1.5, 0.08, 8, 28), std(0xff8fab, 0.5)); ring.rotation.x = Math.PI / 2; sg.add(ring);
  scene.add(sg);
  plats.push({ x: 0, z: 0, top: ISLAND.y, r: 1.5, dx: 0, dz: 0, g: sg });
})();
addPad(ISLAND.x - DOCK.rx * 1.3, ISLAND.y, ISLAND.z - DOCK.rz * 1.3, 19.5);   // bounces you up to the golden altar
function updatePlats() {
  const sh = plats[1], u = 0.5 - 0.5 * Math.cos(Date.now() / 1000 * Math.PI * 2 / 7), r = lerp(7.3, 3.9, u);
  const x = ISLAND.x + DOCK.rx * r, z = ISLAND.z + DOCK.rz * r;
  sh.dx = x - sh.x; sh.dz = z - sh.z; if (Math.abs(sh.dx) + Math.abs(sh.dz) > 1) sh.dx = sh.dz = 0;
  sh.x = x; sh.z = z; sh.g.position.set(x, sh.top, z);
}
updatePlats();

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

// ---------- mystery item boxes ----------
const itemBoxes = [];
(function buildItemBoxes() {
  const tex = canvasTex(128, 128, (c) => {
    const g = c.createLinearGradient(0, 0, 128, 128); g.addColorStop(0, '#ff8fab'); g.addColorStop(0.5, '#ffd43b'); g.addColorStop(1, '#74c0fc');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128); c.strokeStyle = '#fff'; c.lineWidth = 10; c.strokeRect(6, 6, 116, 116);
    c.fillStyle = '#fff'; c.font = '900 92px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', 64, 70);
  });
  const geo = new THREE.BoxGeometry(0.75, 0.75, 0.75), mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 });
  mat.emissive = C(0x332200);
  const add = (x, y, z) => { const m = mesh(geo, mat); m.position.set(x, y, z); scene.add(m); itemBoxes.push({ g: m, x, y, z, respawn: 0 }); };
  ITEM_STEPS.forEach((idx) => { const st = steps[idx]; add(st.cx - st.rx, st.topY + 1.15, st.cz - st.rz); });
  add(-10, 1.15, -9); add(12, 1.15, 1); add(-11, 1.15, 12);
  add(ISLAND.x - DOCK.rz * 2.2, ISLAND.y + 1.15, ISLAND.z + DOCK.rx * 2.2);
})();

// ---------- treasure chest + two floor buttons (push a block on each, or stand on them with a friend) ----------
const chest = { open: false, lid: null, warned: false };
const plates = [[-6, 5], [2.5, 7.5]].map((d) => {
  const base = mesh(new THREE.CylinderGeometry(1.25, 1.35, 0.1, 28), std(0x868e96, 0.6)); base.position.set(d[0], 0.05, d[1]); base.receiveShadow = true; scene.add(base);
  const cap = mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.12, 28), std(0xff6b6b, 0.4)); cap.position.set(d[0], 0.14, d[1]); scene.add(cap);
  return { x: d[0], z: d[1], cap, pressed: false };
});
(function buildChest() {
  const wood = std(0x9c6644, 0.7), gold = std(0xffc800, 0.3, 0.3), g = new THREE.Group();
  const box = mesh(new THREE.BoxGeometry(2.4, 1.2, 1.6), wood, true); box.position.y = 0.6; g.add(box);
  [-0.8, 0.8].forEach((x) => { const band = mesh(new THREE.BoxGeometry(0.2, 1.24, 1.64), gold); band.position.set(x, 0.6, 0); g.add(band); });
  const lid = new THREE.Group(); lid.position.set(0, 1.2, -0.8);
  const lidM = mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.4, 16, 1, false, 0, Math.PI), wood, true); lidM.rotation.z = Math.PI / 2; lidM.rotation.y = Math.PI / 2; lidM.position.set(0, 0, 0.8); lid.add(lidM);
  const lock = mesh(new THREE.BoxGeometry(0.4, 0.45, 0.12), gold); lock.position.set(0, 0, 1.64); lid.add(lock);
  g.add(lid); chest.lid = lid;
  g.position.set(CHEST.x, 0, CHEST.z); g.rotation.y = Math.PI / 4; scene.add(g);
})();

// ---------- rolling marbles (same timing for everyone in the room) ----------
const marbles = [];
[0xff6b6b, 0x4dabf7, 0x69db7c].slice(0, MARBLE_N).forEach((c, i) => {
  const m = mesh(new THREE.SphereGeometry(MARBLE_R, 20, 14), std(c, 0.15, 0.2)); m.castShadow = true;
  m.add(mesh(new THREE.TorusGeometry(MARBLE_R * 0.98, 0.07, 6, 20), basic(0xffffff)));
  scene.add(m); marbles.push({ mesh: m, off: (i - 1) * 0.85, dx: 0, dz: 0, live: false });
});
[0, 1, 2].forEach((i) => {       // extra marbles that only roll during the 구슬 폭풍 event
  const m = mesh(new THREE.SphereGeometry(MARBLE_R, 20, 14), std(0x9775fa, 0.15, 0.2)); m.castShadow = true; m.visible = false;
  m.add(mesh(new THREE.TorusGeometry(MARBLE_R * 0.98, 0.07, 6, 20), basic(0xffffff)));
  scene.add(m); marbles.push({ mesh: m, off: (1 - i) * 0.6, dx: 0, dz: 0, live: false, storm: true });
});
function updateMarbles() {
  const top = steps.length - 2, lowest = 3, span = top - lowest;
  marbles.forEach((mb, i) => {
    const ph = ((Date.now() + (mb.storm ? i - 2.5 : i) * MARBLE_PERIOD / MARBLE_N) % MARBLE_PERIOD) / MARBLE_PERIOD;
    const u = top - ph * span, a = Math.floor(u), f = u - a, s0 = steps[a], s1 = steps[Math.min(a + 1, steps.length - 1)];
    const x = lerp(s0.cx, s1.cx, f) + lerp(s0.rx, s1.rx, f) * mb.off, z = lerp(s0.cz, s1.cz, f) + lerp(s0.rz, s1.rz, f) * mb.off;
    const y = lerp(s0.topY, s1.topY, f) + MARBLE_R, pos = mb.mesh.position;
    const mvx = x - pos.x, mvz = z - pos.z, ml = Math.hypot(mvx, mvz);
    if (ml > 0.0001 && ml < 2) { mb.dx = mvx / ml; mb.dz = mvz / ml; mb.mesh.rotation.x += ml / MARBLE_R * mb.dz; mb.mesh.rotation.z -= ml / MARBLE_R * mb.dx; }
    pos.set(x, y, z);
    const sc = Math.min(1, ph * 30, (1 - ph) * 30); mb.mesh.scale.setScalar(Math.max(0.01, sc));   // fade in at the top, pop at the bottom
    mb.live = sc > 0.8;
    if (mb.storm) { mb.mesh.visible = ev.storm; if (!ev.storm) mb.live = false; }
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
  else if (name === 'dash') tone(900, 0.16, 'sawtooth', 0.035, 250);
  else if (name === 'event') [659, 880, 1175].forEach((f, i) => tone(f, 0.18, 'square', 0.06, 0, i * 0.08));
  else if (name === 'sneeze') { tone(500, 0.12, 'sawtooth', 0.05, 900); tone(700, 0.5, 'sawtooth', 0.07, 120, 0.12); }
  else if (name === 'ach') [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.2, 'triangle', 0.1, 0, i * 0.07));
  else if (name === 'open') [392, 523, 659, 784].forEach((f, i) => tone(f, 0.3, 'triangle', 0.1, 0, i * 0.1));
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
// the key is broken into three pieces hidden around the room
const pieces = [
  { name: '꼭대기', icon: '⛰️', pos: keyPos.clone() },
  { name: '구름섬', icon: '☁️', pos: new THREE.Vector3(ISLAND.x + DOCK.rx * 1.4, ISLAND.y + 1.3, ISLAND.z + DOCK.rz * 1.4) },
  { name: '보물상자', icon: '🧰', pos: new THREE.Vector3(CHEST.x, 2.3, CHEST.z) },
];
pieces.forEach((pc) => {
  pc.got = false;
  pc.mesh = makeKey(1.25); pc.mesh.position.copy(pc.pos); scene.add(pc.mesh);
  pc.beam = mesh(new THREE.CylinderGeometry(0.4, 0.9, 12, 20, 1, true), basic(0xffe066, { transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
  pc.beam.position.set(pc.pos.x, pc.pos.y + 5.5, pc.pos.z); scene.add(pc.beam);
});
const pieceAvailable = (i) => i !== 2 || chest.open;
// 열쇠 쟁탈전: one shared set of pieces for the whole room, the server decides who holds what
const battle = { on: false, pieces: [null, null, null], scores: [], phase: 'play', round: 0, over: false, target: 3 };
let grabCd = 0, stealCd = 0, escapeCd = 0;
const pieceAtHome = (i) => (battle.on ? battle.pieces[i] === null : !pieces[i].got);
const keyLight = new THREE.PointLight(C(0xffd45e), 1.4, 16); keyLight.position.copy(keyPos); scene.add(keyLight);

// ---------- banana traps (shared with the room) ----------
const traps = new Map();   // id -> { mesh, by, x, y, z }
function addTrap(id, by, p) {
  if (traps.has(id) || traps.size > 40) return;
  const m = mesh(new THREE.TorusGeometry(0.32, 0.12, 8, 14, Math.PI * 1.1), std(0xffe066, 0.4)); m.castShadow = true;
  m.rotation.x = Math.PI / 2; m.position.set(p[0], p[1] + 0.14, p[2]); scene.add(m);
  traps.set(id, { mesh: m, by, x: p[0], y: p[1], z: p[2] });
}
function removeTrap(id) { const t = traps.get(id); if (t) { scene.remove(t.mesh); traps.delete(id); } }
function clearTraps() { [...traps.keys()].forEach(removeTrap); }

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
  const antenna = new THREE.Group(); rig.add(antenna);
  const ant = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6), bodyMat); ant.position.y = 1.9; antenna.add(ant);
  const bulb = mesh(new THREE.SphereGeometry(0.09, 10, 8), bodyMat); bulb.position.y = 2.08; antenna.add(bulb);
  const hatHolder = new THREE.Group(); hatHolder.position.y = 1.4; rig.add(hatHolder);
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
  const ice = mesh(new THREE.BoxGeometry(1.5, 2.3, 1.5), new THREE.MeshStandardMaterial({ color: C(0xa5d8ff), transparent: true, opacity: 0.45, roughness: 0.05, depthWrite: false }));
  ice.position.y = 1.1; ice.visible = false; g.add(ice);
  g.userData = { rig, bodyMat, key, legs, arms, crown, shield, ice, antenna, hatHolder, hat: 0, prop: null, emote: em, emoteIdx: 0, colorIdx, ph: 0, air: 0 };
  return g;
}
function setHat(av, idx) {
  const ud = av.userData; if (ud.hat === idx) return;
  ud.hat = idx; ud.prop = null; ud.antenna.visible = idx === 0;
  const h = ud.hatHolder; while (h.children.length) h.remove(h.children[0]);
  const add = (geo, mat, x, y, z) => { const m = mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; h.add(m); return m; };
  if (idx === 1) {            // party cone
    add(new THREE.ConeGeometry(0.24, 0.6, 16), std(0xff8fab, 0.5), 0, 0.62); add(new THREE.SphereGeometry(0.08, 8, 8), std(0xffffff, 0.5), 0, 0.94);
    const band = add(new THREE.TorusGeometry(0.2, 0.035, 6, 16), std(0xffd43b, 0.5), 0, 0.42); band.rotation.x = Math.PI / 2;
  } else if (idx === 2) {     // baseball cap
    add(new THREE.SphereGeometry(0.42, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(0x4dabf7, 0.6), 0, 0.06);
    const brim = add(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16), std(0x1c7ed6, 0.6), 0, 0.12, 0.42); brim.scale.z = 0.8;
  } else if (idx === 3) {     // top hat
    add(new THREE.CylinderGeometry(0.27, 0.27, 0.46, 18), std(0x2b2140, 0.5), 0, 0.58); add(new THREE.CylinderGeometry(0.46, 0.46, 0.04, 20), std(0x2b2140, 0.5), 0, 0.35);
    add(new THREE.CylinderGeometry(0.275, 0.275, 0.09, 18), std(0xff6b6b, 0.5), 0, 0.42);
  } else if (idx === 4) {     // cat ears
    [-0.2, 0.2].forEach((x) => { const e = add(new THREE.ConeGeometry(0.13, 0.26, 4), std(0x495057, 0.6), x, 0.42); e.rotation.y = Math.PI / 4; add(new THREE.ConeGeometry(0.07, 0.15, 4), std(0xffadc6, 0.6), x, 0.4, 0.05).rotation.y = Math.PI / 4; });
  } else if (idx === 5) {     // propeller beanie
    add(new THREE.SphereGeometry(0.42, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), std(0x69db7c, 0.6), 0, 0.08);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 6), std(0xffd43b, 0.5), 0, 0.55);
    ud.prop = add(new THREE.BoxGeometry(0.7, 0.03, 0.1), std(0xff6b6b, 0.5), 0, 0.63);
  }
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
  if (ud.prop) ud.prop.rotation.y += dt * (moving || !grounded ? 22 : 5);
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
const me = { name: '나', colorIdx: Math.floor(Math.random() * COLORS.length), hasKey: false, order: [], finished: null, stars: 0, cp: -1, emote: 0, emoteT: 0, shield: false,
  item: null, boostT: 0, frozenT: 0, dashCd: 0, hat: 0 };
const dashVec = { x: 0, z: 0 }, dashDir = { x: 0, z: 1 }, run = { caught: false, fromPad: false };
let dashHit = 0;
let ridePlat = null, totalStars = Math.max(0, Math.floor(+store.get('totalStars', 0)) || 0);
const player = makeAvatar(me.colorIdx); scene.add(player);
const vel = { x: 0, z: 0 }, knock = { x: 0, z: 0, cd: 0 }, squash = { s: 1, v: 0 };
let vy = 0, grounded = true, airT = 0, jumpBuf = 0, bounceT = 0, fallSpeed = 0, stepPh = 0, padTipShown = false;
function spawn() {
  if (me.cp >= 0) { const st = steps[me.cp]; player.position.set(st.cx, st.topY, st.cz); }   // last checkpoint flag
  else player.position.set(7 + Math.random() * 6, 0, 11 + Math.random() * 3);
  player.rotation.y = Math.PI; vy = 0; vel.x = vel.z = 0; knock.x = knock.z = 0; dashVec.x = dashVec.z = 0; grounded = true; airT = 0; ridePlat = null;
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
  if (!e.repeat && (e.code === 'ShiftLeft' || e.code === 'ShiftRight')) dash();
  if (!e.repeat && (e.code === 'KeyE' || e.code === 'KeyQ' || e.code === 'KeyF')) useItem();
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
  if (battle.on) g.textContent = me.hasKey ? '🚪 다 모았어요! 쥐구멍으로 도망쳐요!' : '⚔️ 조각을 줍거나, 든 친구와 부딪혀 빼앗아요';
  else g.textContent = me.hasKey ? '🚪 열쇠 완성! 벽의 쥐구멍으로!' : '🔑 열쇠 조각 3개를 모아요';
  g.classList.toggle('key', me.hasKey);
  const box = $('pieces'); box.textContent = '';
  pieces.forEach((pc, i) => {
    const sp = document.createElement('span'); sp.textContent = pc.icon; sp.title = pc.name;
    const owner = battle.on ? battle.pieces[i] : null;
    if (battle.on ? owner === myId && myId !== null : pc.got) sp.className = 'got'; else if (owner) sp.className = 'taken';
    box.appendChild(sp);
  });
  $('modeTag').textContent = battle.on ? '⚔️ 쟁탈전 · ' + Math.max(1, battle.round) + '판 (' + battle.target + '승 우승)' : '⏱ 기록 경주';
}
function setItem(kind) {
  me.item = kind;
  const b = $('itemBtn'); b.firstElementChild.textContent = kind ? ITEMS[kind] : '·'; b.classList.toggle('has', !!kind);
}
// ---------- items ----------
function rollItem() {
  const friends = Object.keys(remotes).length > 0;
  const bag = friends ? ['boost', 'boost', 'spring', 'spring', 'shield', 'banana', 'banana', 'freeze', 'freeze'] : ['boost', 'boost', 'spring', 'spring', 'shield'];
  const kind = bag[Math.floor(Math.random() * bag.length)];
  if (kind === 'shield') {
    if (me.shield) return rollItemNoShield(bag);
    me.shield = true; sfx('shield'); toast('🛡 방패! 손을 한 번 막아줘요', 2200); return;
  }
  setItem(kind); sfx('shield');
  toast(ITEMS[kind] + ' ' + { boost: '부스터', spring: '슈퍼 점프', banana: '바나나 함정', freeze: '얼음 폭탄' }[kind] + ' 획득! (E 키 / 아이템 버튼)', 2400);
}
function rollItemNoShield(bag) { const b = bag.filter((k) => k !== 'shield'); const kind = b[Math.floor(Math.random() * b.length)]; setItem(kind); sfx('shield'); toast(ITEMS[kind] + ' 아이템 획득! (E 키 / 아이템 버튼)', 2200); }
function useItem() {
  if (game.state !== 'play' || !me.item || overlayOpen()) return;
  const kind = me.item, p = player.position; setItem(null);
  if (kind === 'boost') { me.boostT = 4; sfx('boing'); toast('🚀 부스터!', 1200); }
  else if (kind === 'spring') { vy = 15.5; grounded = false; airT = 1; bounceT = 1.2; squash.s = 1.35; sfx('boing'); burst(p.x, p.y + 0.2, p.z, 0x69db7c, 12, 3); }
  else if (kind === 'banana') {
    const pos = [Math.round(p.x * 100) / 100, Math.round(supportAt(p.x, p.y, p.z) * 100) / 100, Math.round(p.z * 100) / 100];
    if (netOk) { try { ws.send(JSON.stringify({ cmd: 'trap', p: pos })); } catch (e) { /* offline */ } }
    sfx('pop'); toast('🍌 바나나를 놓았어요', 1400);
  } else if (kind === 'freeze') {
    if (netOk) { try { ws.send(JSON.stringify({ cmd: 'freeze', p: [p.x, p.y, p.z] })); } catch (e) { /* offline */ } }
    sfx('shield'); burst(p.x, p.y + 1, p.z, 0xa5d8ff, 40, 9); toast('❄️ 얼음 폭탄! 가까운 친구가 느려져요', 1600);
  }
}
function dash() {
  if (game.state !== 'play' || me.dashCd > 0 || me.frozenT > 0 || overlayOpen()) return;
  let dx = vel.x, dz = vel.z;
  if (Math.hypot(dx, dz) < 0.5) { dx = Math.sin(player.rotation.y); dz = Math.cos(player.rotation.y); }
  const l = Math.hypot(dx, dz) || 1;
  dashVec.x = dx / l * DASH_V; dashVec.z = dz / l * DASH_V; me.dashCd = DASH_CD;
  if (!grounded && vy < 2) vy = 2;                    // a little lift, so an air-dash can save a jump
  dashDir.x = dx / l; dashDir.z = dz / l; dashHit = 0.35;      // bumping into someone during a dash shoves them
  squash.s = 0.8; sfx('dash'); burst(player.position.x, player.position.y + 0.6, player.position.z, 0xffffff, 8, 2, 0.2);
}
function gotFrozen(byName) {
  if (me.shield) { me.shield = false; sfx('pop'); toast('🛡 방패가 얼음을 막았어요!', 1800); return; }
  me.frozenT = 3; sfx('caught'); toast('❄️ ' + byName + ' 님의 얼음 폭탄! 잠깐 느려져요', 2200);
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
  // hats unlock with the stars you have collected over all your runs
  me.hat = clamp(Math.floor(+store.get('hat', 0)) || 0, 0, HATS.length - 1);
  if (totalStars < HATS[me.hat][1]) me.hat = 0;
  setHat(player, me.hat);
  const hb = $('hats');
  HATS.forEach((h, i) => {
    const b = document.createElement('button'); b.type = 'button'; const locked = totalStars < h[1];
    b.textContent = locked ? '🔒' : h[2]; b.title = h[0] + (locked ? ' (별 ' + h[1] + '개 필요)' : '');
    if (locked) { b.classList.add('locked'); const n = document.createElement('small'); n.textContent = '⭐' + h[1]; b.appendChild(n); }
    if (i === me.hat) b.classList.add('sel');
    b.addEventListener('click', () => {
      if (locked) { $('hatInfo').textContent = h[0] + ': 별을 ' + h[1] + '개 모으면 열려요 (지금 ' + totalStars + '개)'; return; }
      me.hat = i; setHat(player, i); store.set('hat', i);
      Array.prototype.forEach.call(hb.children, (x) => x.classList.remove('sel')); b.classList.add('sel');
    });
    hb.appendChild(b);
  });
  $('hatInfo').textContent = '지금까지 모은 별 ⭐ ' + totalStars + '개';
  $('itemBtn').addEventListener('pointerdown', (e) => { useItem(); e.preventDefault(); });
  $('dashBtn').addEventListener('pointerdown', (e) => { dash(); e.preventDefault(); });

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
  $('restartBtn').addEventListener('click', () => { toggleSettings(false); if (battle.on) groupStart(); else beginRun(3); });
  $('optMode').addEventListener('change', (e) => {
    const mode = e.target.value === 'battle' ? 'battle' : 'race';
    e.target.value = battle.on ? 'battle' : 'race';            // the server confirms the switch for everyone
    if (!netOk) { toast('서버에 연결된 뒤에 바꿀 수 있어요'); return; }
    try { ws.send(JSON.stringify({ cmd: 'mode', mode, n: me.name })); } catch (err) { /* reconnecting */ }
    toggleSettings(false);
  });
  $('bendNext').addEventListener('click', groupStart);
  const achToggle = (show) => { $('achPanel').classList.toggle('hidden', !show); if (show) renderAch(); };
  $('achBtn').addEventListener('click', () => achToggle(true));
  $('achBtn2').addEventListener('click', () => { toggleSettings(false); achToggle(true); });
  $('achClose').addEventListener('click', () => achToggle(false));
  $('achPanel').addEventListener('click', (e) => { if (e.target === $('achPanel')) achToggle(false); });

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
  me.hasKey = false; me.order = []; me.finished = null; me.stars = 0; me.cp = -1; me.emote = 0; me.shield = false; knock.cd = 0;
  me.boostT = 0; me.frozenT = 0; me.dashCd = 0; setItem(null);
  pieces.forEach((pc) => { pc.got = false; });
  chest.open = false; chest.warned = false; chest.lid.rotation.x = 0;
  stars.forEach((s) => { s.got = false; s.mesh.visible = true; });
  itemBoxes.forEach((s) => { s.respawn = 0; s.g.visible = true; });
  flags.forEach((fl) => fl.cloth.material.color.copy(C(0xadb5bd)));
  boxes.forEach((b) => b.mesh.position.set(b.home[0], b.top / 2, b.home[1]));
  $('stars').textContent = '0'; $('time').textContent = '0.0';
  $('end').classList.add('hidden'); $('bend').classList.add('hidden'); $('spectate').classList.add('hidden'); spec.on = false;
  if (battle.on) { me.order = [0, 1, 2].filter((i) => myId !== null && battle.pieces[i] === myId); me.hasKey = me.order.length === 3; }
  grabCd = stealCd = escapeCd = 0; run.caught = false; run.fromPad = false; dashHit = 0;
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
    if (y + STEP_UP >= p.top && Math.hypot(x - p.x, z - p.z) <= p.r) s = Math.max(s, p.top);
  }
  for (let i = 0; i < plats.length; i++) {
    const p = plats[i];
    if (y + STEP_UP >= p.top && Math.hypot(x - p.x, z - p.z) <= p.r) s = Math.max(s, p.top);
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
  const top = SPEED * (me.boostT > 0 ? 1.6 : 1) * (me.frozenT > 0 ? 0.35 : 1) * (battle.on ? 1 - 0.06 * me.order.length : 1) * ev.speed;   // carrying pieces in 쟁탈전 slows you a little
  const tx = hasInput ? ix * top : 0, tz = hasInput ? iz * top : 0;
  const acc = (grounded ? (hasInput ? 60 : 75) : (hasInput ? 24 : 5)) * dt;
  const dvx = tx - vel.x, dvz = tz - vel.z, dl = Math.hypot(dvx, dvz);
  if (dl <= acc) { vel.x = tx; vel.z = tz; } else { vel.x += dvx / dl * acc; vel.z += dvz / dl * acc; }
  if (knock.x || knock.z) {
    const kd = Math.pow(0.02, dt); knock.x *= kd; knock.z *= kd;
    if (Math.abs(knock.x) + Math.abs(knock.z) < 0.3) knock.x = knock.z = 0;
  }
  if (dashVec.x || dashVec.z) {
    const dd = Math.pow(0.0008, dt); dashVec.x *= dd; dashVec.z *= dd;
    if (Math.abs(dashVec.x) + Math.abs(dashVec.z) < 0.4) dashVec.x = dashVec.z = 0;
  }
  p.x += (vel.x + knock.x + dashVec.x) * dt; p.z += (vel.z + knock.z + dashVec.z + ev.wind) * dt;
  pushBoxes();
  p.x = clamp(p.x, -ROOM + 0.4, ROOM - 0.4); p.z = clamp(p.z, -ROOM + 0.4, ROOM - 0.4);

  // jump: buffered press + a short grace period after walking off an edge
  const held = keys.Space || jumpHeld;
  if ((jumpBuf > 0 || held) && (grounded || airT < 0.1) && vy <= 0.01) {
    vy = JUMP_V * (me.frozenT > 0 ? 0.75 : 1); grounded = false; airT = 1; jumpBuf = 0; squash.s = 1.25; sfx('jump');
  }
  // letting go early makes a shorter hop
  const g = GRAVITY * ev.grav * ((vy > 0 && !held && bounceT <= 0) ? 2.3 : 1);
  const prevY = p.y;
  vy -= g * dt; p.y += vy * dt;
  const sup = supportAt(p.x, Math.max(prevY, p.y), p.z);
  if (p.y <= sup && vy <= 0.01) {
    if (!grounded) {
      fallSpeed = -vy;
      if (fallSpeed > 7) { squash.s = clamp(1 - fallSpeed * 0.022, 0.62, 1); sfx('land'); burst(p.x, sup + 0.1, p.z, 0xffffff, 6, 1.6, 0.2); }
    }
    p.y = sup; vy = 0; grounded = true; airT = 0;
    if (run.fromPad) { if (sup > 4) unlock('trampoline'); run.fromPad = false; }
    // trampolines
    for (let i = 0; i < pads.length; i++) {
      const pd = pads[i];
      if (Math.abs(sup - pd.top) < 0.01 && Math.hypot(p.x - pd.x, p.z - pd.z) <= pd.r - 0.15) {
        vy = pd.v; grounded = false; airT = 1; bounceT = 1.5; run.fromPad = i < 2; pd.bounce = 1; squash.s = 1.35; sfx('boing');
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

  if (ridePlat) { player.position.x += ridePlat.dx; player.position.z += ridePlat.dz; }   // carried by the shuttle
  if (me.boostT > 0) { me.boostT -= dt; if (Math.random() < dt * 25) burst(player.position.x, player.position.y + 0.3, player.position.z, 0xffa94d, 2, 1.2, 0.2); }
  if (me.frozenT > 0) me.frozenT -= dt;
  if (me.dashCd > 0) me.dashCd -= dt;
  if (knock.cd > 0) knock.cd -= dt;
  if (jumpBuf > 0) jumpBuf -= dt;
  if (bounceT > 0) bounceT -= dt;
  const n = Math.max(1, Math.ceil(dt / (1 / 90)));      // small fixed sub-steps: stable on slow devices
  for (let i = 0; i < n; i++) physStep(dt / n, ix, iz);

  const p = player.position, sp = Math.hypot(vel.x, vel.z), moving = sp > 0.6;
  ridePlat = null;
  if (grounded) for (let i = 0; i < plats.length; i++) { const pl = plats[i]; if (Math.abs(p.y - pl.top) < 0.02 && Math.hypot(p.x - pl.x, p.z - pl.z) <= pl.r) ridePlat = pl; }
  if (ridePlat === plats[0]) unlock('island');
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
      totalStars++; store.set('totalStars', totalStars);
      if (totalStars >= 50) unlock('stars50'); if (me.stars === stars.length) unlock('allstars');
      sfx('star'); burst(s.x, s.y, s.z, 0xffe066, 14, 4);
      if (me.stars === stars.length) toast('⭐ 별을 전부 모았어요!', 2400);
    }
  }
  // mystery item boxes
  for (let i = 0; i < itemBoxes.length; i++) {
    const s = itemBoxes[i];
    if (s.respawn > 0) { s.respawn -= dt; if (s.respawn <= 0) s.g.visible = true; continue; }
    if (!me.item && Math.hypot(p.x - s.x, p.z - s.z) < 1.2 && Math.abs(p.y + 0.9 - s.y) < 1.4) {
      s.g.visible = false; s.respawn = 12; burst(s.x, s.y, s.z, 0xffd43b, 16, 4); rollItem();
    }
  }
  // banana traps left by friends
  traps.forEach((t, id) => {
    if (t.by === myId || knock.cd > 0) return;
    if (Math.hypot(p.x - t.x, p.z - t.z) < 0.85 && Math.abs(p.y - t.y) < 0.9) {
      removeTrap(id);
      if (netOk) { try { ws.send(JSON.stringify({ cmd: 'trapHit', id })); } catch (e) { /* offline */ } }
      const a = Math.random() * Math.PI * 2; shove(Math.cos(a), Math.sin(a), 9, 6, '🍌 미끄덩! 바나나를 밟았어요');
    }
  });
  // checkpoint flags
  if (grounded) for (let i = 0; i < flags.length; i++) {
    const fl = flags[i], st = steps[fl.idx];
    // counts once you stand anywhere at or above the flag's step, so hopping over that step or taking a trampoline can't skip it
    if (fl.idx > me.cp && p.y >= st.topY - 0.05) {
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
  // key pieces
  for (let i = 0; i < pieces.length; i++) {
    const pc = pieces[i];
    if (!pieceAtHome(i) || !pieceAvailable(i)) continue;
    if (Math.hypot(p.x - pc.pos.x, p.z - pc.pos.z) < 1.5 && Math.abs(p.y + 1 - pc.pos.y) < 2.2) {
      if (battle.on) {       // ask the server: only one player can have it
        if (grabCd <= 0 && netOk) { grabCd = 0.4; try { ws.send(JSON.stringify({ cmd: 'grab', i })); } catch (e) { /* offline */ } }
        continue;
      }
      pc.got = true; me.order.push(i); me.hasKey = me.order.length === pieces.length; setGoal();
      sfx('key'); burst(pc.pos.x, pc.pos.y, pc.pos.z, 0xffd43b, 30, 6);
      toast(me.hasKey ? '🔑 황금 열쇠 완성! 이제 쥐구멍으로 탈출하세요!' : '🔑 열쇠 조각 ' + me.order.length + '/3! (' + pc.name + ')', 2800);
    }
  }
  // 쟁탈전: bump into someone who carries a piece to steal it
  if (grabCd > 0) grabCd -= dt; if (stealCd > 0) stealCd -= dt; if (escapeCd > 0) escapeCd -= dt;
  if (battle.on && stealCd <= 0 && netOk) {
    for (const id in remotes) {
      if (battle.pieces.indexOf(id) < 0) continue;
      const rp = remotes[id].av.position;
      if (Math.hypot(p.x - rp.x, p.y - rp.y, p.z - rp.z) < 1.5) {
        stealCd = 0.6; try { ws.send(JSON.stringify({ cmd: 'steal', from: id })); } catch (e) { /* offline */ }
        break;
      }
    }
  }
  // 박치기: dash into another player to shove them
  if (dashHit > 0) {
    dashHit -= dt;
    if (netOk) for (const id in remotes) {
      const r = remotes[id]; if (!r.av.visible) continue;
      const rp = r.av.position;
      if (Math.hypot(p.x - rp.x, p.y - rp.y, p.z - rp.z) < 1.5) {
        dashHit = 0;
        try { ws.send(JSON.stringify({ cmd: 'bump', to: id, d: [dashDir.x, dashDir.z] })); } catch (e) { /* offline */ }
        sfx('hit'); burst(rp.x, rp.y + 1, rp.z, 0xffffff, 14, 5); toast('💥 박치기!', 900); cam.shake = Math.max(cam.shake, 0.15);
        countAch('bump', 5, 'bumper');
        break;
      }
    }
  }
  // the locked chest: tell the player what to do
  if (!chest.open && !chest.warned && p.y < 1 && Math.hypot(p.x - CHEST.x, p.z - CHEST.z) < 3.2) {
    chest.warned = true; toast('🧰 잠긴 보물상자! 바닥의 빨간 버튼 두 개를 블록으로 눌러요 (친구가 밟아도 돼요)', 4200);
    setTimeout(() => { chest.warned = false; }, 9000);
  }
  // escape
  const nearExit = p.y < 1 && Math.hypot(p.x - EXIT.x, p.z - EXIT.z) < 1.9;
  if (me.hasKey && nearExit && battle.on) {
    if (escapeCd <= 0 && netOk) { escapeCd = 1; try { ws.send(JSON.stringify({ cmd: 'escape' })); } catch (e) { /* offline */ } }
  } else if (me.hasKey && nearExit) finish();
  else if (nearExit && !updatePlayer.warned) {
    updatePlayer.warned = true; toast('쥐구멍이 잠겨 있어요. 열쇠 조각 3개가 필요해요 🔒');
    setTimeout(() => { updatePlayer.warned = false; }, 3000);
  }
}
function finish() {
  me.finished = Math.round(game.elapsed * 10) / 10; game.state = 'done';
  unlock('first'); if (me.finished <= 120) unlock('fast'); if (me.finished <= 75) unlock('faster'); if (!run.caught) unlock('untouched');
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
    toast('🛡 방패가 막아줬어요!', 2000); cam.shake = 0.4; unlock('shield'); return;
  }
  run.caught = true;
  const back = me.cp >= 0 ? '체크포인트로' : '처음으로';
  let lost = null;
  if (battle.on) {
    if (me.order.length) { lost = { name: '' }; if (netOk) { try { ws.send(JSON.stringify({ cmd: 'drop' })); } catch (e) { /* offline */ } } }
  } else if (me.order.length) { lost = pieces[me.order.pop()]; lost.got = false; }      // the newest piece goes back where it was
  me.hasKey = false; setGoal(); spawn(); cam.shake = 0.5; sfx('caught');
  toast(lost ? '✋ 잡혔어요! ' + (lost.name ? lost.name + ' ' : '') + '조각을 빼앗기고 ' + back + '…' : '✋ 잡혔어요! ' + back + ' 돌아갑니다', 2800);
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
      else if (active && Math.hypot(p.x - hs.tx, p.z - hs.tz) < 9) countAch('dodge', 20, 'dodger');
      hs.state = 'rest'; hs.t = 0.8;
    }
  } else if (hs.state === 'rest') {
    hs.t -= dt;
    if (hs.t <= 0) {
      hs.state = 'hover';
      // the kid gets impatient the higher you climb, and furious once you hold the key
      const hurry = me.hasKey ? 1 : Math.max(clamp(p.y / TOP_Y, 0, 1) * 0.6, me.order.length * 0.25);
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
    kp: (typeof pr.kp === 'number' && isFinite(pr.kp)) ? clamp(Math.floor(pr.kp), 0, 3) : 0,
    h: (typeof pr.h === 'number' && isFinite(pr.h)) ? clamp(Math.floor(pr.h), 0, HATS.length - 1) : 0,
    fz: pr.fz === true,
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
    ud.key.visible = d.kp > 0; ud.key.scale.setScalar(0.35 + 0.14 * d.kp); ud.ice.visible = d.fz; setHat(r.av, d.h);
    ud.shield.visible = d.sh; ud.crown.visible = p.id === champ; r.av.visible = d.t === null; showEmote(r.av, d.e);
    const k = damp(0.0005, dt), moved = Math.hypot(d.x - pos.x, d.z - pos.z), air = Math.abs(d.y - pos.y) > 0.35;
    if (moved > 12) pos.set(d.x, d.y, d.z);     // respawned: snap instead of sliding across the room
    else { pos.x += (d.x - pos.x) * k; pos.y += (d.y - pos.y) * k; pos.z += (d.z - pos.z) * k; }
    r.av.rotation.y += angDiff(d.ry, r.av.rotation.y) * k;
    animateAvatar(r.av, moved > 0.03, !air, dt);

    // little news feed
    const prev = prevPeers[p.id];
    if (!prev) { if (peersSeen && game.state !== 'menu') { feed('👋 ' + d.name + ' 입장'); sfx('join'); } }
    else {
      if (d.k && !prev.k) feed('🔑 ' + d.name + ' 열쇠 완성!');
      else if (d.kp > prev.kp) feed('🔑 ' + d.name + ' 조각 ' + d.kp + '/3');
      if (d.t !== null && prev.t === null) feed('🏁 ' + d.name + ' 탈출! ' + fmt(d.t));
    }
    prevPeers[p.id] = { k: d.k, kp: d.kp, t: d.t, name: d.name };
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
function nameOf(id) { return id === myId ? me.name : (prevPeers[id] ? prevPeers[id].name : '친구'); }
function setMode(mode) {
  battle.on = mode === 'battle';
  $('optMode').value = battle.on ? 'battle' : 'race';
  if (!battle.on) { me.order = []; me.hasKey = false; pieces.forEach((pc) => { pc.got = false; }); }
  setGoal();
}
function applyBattle(b) {
  if (!b || typeof b !== 'object' || !Array.isArray(b.pieces)) return;
  battle.pieces = [0, 1, 2].map((i) => (typeof b.pieces[i] === 'string' ? b.pieces[i] : null));
  battle.scores = Array.isArray(b.scores) ? b.scores.filter((x) => x && typeof x.id === 'string').map((x) => ({ id: x.id, w: Math.max(0, x.w | 0) })) : [];
  battle.phase = b.phase === 'results' ? 'results' : 'play'; battle.round = b.round | 0; battle.over = !!b.over; battle.target = (b.target | 0) || 3;
  if (!battle.on) return;
  me.order = [0, 1, 2].filter((i) => myId !== null && battle.pieces[i] === myId);
  me.hasKey = me.order.length === 3; setGoal();
  const L = b.last; if (!L || typeof L !== 'object' || game.state === 'menu') return;
  const pcName = Number.isInteger(L.i) && pieces[L.i] ? pieces[L.i].name + ' ' : '', pp = player.position;
  if (L.type === 'grab') {
    if (L.by === myId) { sfx('key'); burst(pp.x, pp.y + 1.5, pp.z, 0xffd43b, 24, 5); toast(me.hasKey ? '🔑 다 모았어요! 쥐구멍으로 도망쳐요!' : '🔑 ' + pcName + '조각 획득! 빼앗기지 않게 조심!', 2400); }
    else feed('🔑 ' + nameOf(L.by) + ' ' + pcName + '조각');
  } else if (L.type === 'steal') {
    if (L.by === myId) { unlock('thief'); sfx('key'); burst(pp.x, pp.y + 1.5, pp.z, 0xffd43b, 24, 5); toast('😈 ' + nameOf(L.from) + ' 님의 조각을 빼앗았어요!' + (me.hasKey ? ' 쥐구멍으로!' : ''), 2400); }
    else if (L.from === myId) {
      const r = remotes[L.by], dx = r ? pp.x - r.av.position.x : 1, dz = r ? pp.z - r.av.position.z : 0;
      shove(dx, dz, 9, 6, '😱 ' + nameOf(L.by) + ' 님에게 조각을 빼앗겼어요! 쫓아가요!');
    } else feed('😈 ' + nameOf(L.by) + ' → ' + nameOf(L.from) + ' 조각 빼앗기!');
  } else if (L.type === 'drop' && L.by !== myId) feed('✋ ' + nameOf(L.by) + ' 조각을 놓쳤어요');
  else if (L.type === 'win') { if (L.by === myId) unlock('winner'); showBattleEnd(L.by); }
}
function showBattleEnd(winner) {
  game.state = 'done'; marker.visible = false; hs.state = 'hover'; hs.t = 9; releaseKeys();
  const mine = winner === myId;
  $('bendTitle').textContent = (battle.over ? '🏆 최종 우승: ' : '🎉 이번 판 승리: ') + nameOf(winner) + (mine ? ' (나)' : '');
  $('bendSub').textContent = battle.over ? battle.target + '판을 먼저 이겼어요! 다음 판부터 점수가 새로 시작돼요.' : battle.round + '번째 판 종료 · ' + battle.target + '판을 먼저 이기면 우승';
  const ol = $('bendRank'); ol.textContent = '';
  battle.scores.slice().sort((a, b) => b.w - a.w).slice(0, 8).forEach((r, i) => {
    const li = document.createElement('li'); if (r.id === myId) li.className = 'me';
    const rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = ['🥇', '🥈', '🥉'][i] || (i + 1);
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = nameOf(r.id) + (r.id === myId ? ' (나)' : '');
    const st = document.createElement('span'); st.className = 'st'; st.textContent = '🏆 ' + r.w + '승';
    li.appendChild(rk); li.appendChild(nm); li.appendChild(st); ol.appendChild(li);
  });
  sfx(mine ? 'win' : 'flag');
  if (mine) [0xff6b6b, 0xffd43b, 0x4dabf7, 0x69db7c].forEach((c) => burst(player.position.x, player.position.y + 1.5, player.position.z - 1.5, c, 24, 8));
  $('bend').classList.remove('hidden');
}
function sendPresence(now) {
  if (!ws || ws.readyState !== 1 || now - lastSend < 66 || game.state === 'menu') return;
  lastSend = now;
  const p = player.position, r2 = (v) => Math.round(v * 100) / 100;
  try {
    ws.send(JSON.stringify({ n: me.name, c: me.colorIdx, k: me.hasKey, kp: me.order.length, h: me.hat, fz: me.frozenT > 0, sh: me.shield, t: me.finished, e: me.emote, s: me.stars,
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
    if (typeof m.hello === 'string') { myId = m.hello; clearTraps(); }
    if (m.mode === 'race' || m.mode === 'battle') { if ((m.mode === 'battle') !== battle.on) { setMode(m.mode); if (m.ev === 'mode' && game.state !== 'menu') toast(battle.on ? '⚔️ 열쇠 쟁탈전으로 바뀌었어요!' : '⏱ 기록 경주로 바뀌었어요!', 2600); } }
    if (m.b) { if (m.ev === 'start' && m.b && typeof m.b === 'object') m.b.last = null; applyBattle(m.b); }
    const okP = (a) => Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every((v) => typeof v === 'number' && isFinite(v));
    if (Array.isArray(m.traps)) m.traps.forEach((t) => { if (t && typeof t.id === 'string' && okP(t.p)) addTrap(t.id, t.by, t.p); });
    if (m.ev === 'trap' && m.t && typeof m.t.id === 'string' && okP(m.t.p)) addTrap(m.t.id, m.t.by, m.t.p);
    if (m.ev === 'trapGone' && typeof m.id === 'string') removeTrap(m.id);
    if (m.ev === 'bump' && game.state === 'play' && Array.isArray(m.d) && typeof m.d[0] === 'number' && typeof m.d[1] === 'number' && isFinite(m.d[0]) && isFinite(m.d[1])) {
      const who = typeof m.n === 'string' ? m.n.slice(0, 12) : '친구';
      if (me.shield) { me.shield = false; sfx('pop'); toast('🛡 방패가 ' + who + ' 님의 박치기를 막았어요!', 1800); }
      else if (knock.cd <= 0) shove(m.d[0], m.d[1], 11, 6.5, '💥 ' + who + ' 님의 박치기!');
    }
    if (m.ev === 'freeze' && okP(m.p) && m.by !== myId && game.state === 'play') {
      const pp = player.position;
      burst(m.p[0], m.p[1] + 1, m.p[2], 0xa5d8ff, 40, 9);
      if (Math.hypot(pp.x - m.p[0], pp.y - m.p[1], pp.z - m.p[2]) < 10) gotFrozen(typeof m.n === 'string' ? m.n.slice(0, 12) : '친구');
    }
    if (Array.isArray(m.rec)) { records = m.rec.filter((r) => r && typeof r.t === 'number' && isFinite(r.t)).slice(0, 10); renderRank(); }
    if (Array.isArray(m.peers)) { snapshot = m.peers; snapshot.received = true; }
    if (Array.isArray(m.pd)) { // 달라진 칸만 온 것 → 마지막 상태에 덮어씀
      const map = new Map(); for (const q of snapshot) if (q && typeof q.id === 'string') map.set(q.id, q);
      for (const d of m.pd) if (d && typeof d.id === 'string') map.set(d.id, Object.assign({}, map.get(d.id), d));
      snapshot = [...map.values()]; snapshot.received = true;
    }
    if (m.ev === 'start' && typeof m.in === 'number') {
      groupStart.sent = 0;
      clearTraps();
      if (game.state === 'menu') return;
      toggleSettings(false);
      beginRun(clamp(m.in / 1000, 1, 10));
      if (battle.on) toast('⚔️ 열쇠 쟁탈전 ' + Math.max(1, battle.round) + '판! 조각을 줍고, 든 친구와 부딪혀 빼앗아요', 3600);
      else toast('🏁 ' + (typeof m.by === 'string' ? m.by.slice(0, 12) : '친구') + ' 님이 다 같이 출발을 눌렀어요!', 3000);
    }
  };
  ws.onclose = (e) => {
    netOk = false; snapshot = []; myId = null; clearTraps();
    if (e && e.code === 1013) { $('net').textContent = '방이 꽉 찼어요'; setTimeout(connect, 8000); } else setTimeout(connect, 2000);
  };
  ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };
}
connect();

// ---------- board / progress / ranking ----------
function updateBoard(list) {
  const rows = [{ id: 'me', name: me.name, c: me.colorIdx, y: player.position.y, k: me.hasKey, kp: me.order.length, t: me.finished, s: me.stars, me: true }];
  list.forEach((d) => rows.push({ id: d.id, name: d.name, c: d.c, y: d.y, k: d.k, kp: d.kp, t: d.t, s: d.s, me: false }));
  rows.sort((a, b) => {
    if ((a.t !== null) !== (b.t !== null)) return a.t !== null ? -1 : 1;
    if (a.t !== null) return a.t - b.t;
    if (a.kp !== b.kp) return b.kp - a.kp;
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
    const wins = battle.on ? (battle.scores.find((x) => x.id === (r.me ? myId : r.id)) || { w: 0 }).w : 0;
    st.textContent = battle.on ? '🏆' + wins + ' 🔑' + r.kp : (r.t !== null ? '🏁 ' + fmt(r.t) : '🔑' + r.kp + '/3');
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
  let label = '쥐구멍';
  if (me.hasKey) tmpV.set(EXIT.x, 1.2, ROOM - 0.5);
  else {      // nearest piece you still need
    let best = null, bd = 1e9;
    pieces.forEach((pc, i) => { if (!pieceAtHome(i)) return; const d = pc.pos.distanceTo(player.position); if (d < bd) { bd = d; best = pc; } });
    if (best) { tmpV.copy(best.pos); label = best.name; }
    else {
      let who = null;
      if (battle.on) for (const id in remotes) { if (battle.pieces.indexOf(id) < 0) continue; const d = remotes[id].av.position.distanceTo(player.position); if (d < bd) { bd = d; who = id; } }
      if (!who) { el.style.display = 'none'; return; }
      tmpV.copy(remotes[who].av.position); tmpV.y += 1.2; label = nameOf(who);
    }
  }
  if ($('pointerLabel').textContent !== label) $('pointerLabel').textContent = label;
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

// ---------- achievements (kept in this browser) ----------
const ach = { got: store.get('ach', {}) || {}, cnt: store.get('achCnt', {}) || {} };
let achTimer = null;
function renderAch() {
  const n = ACH.filter((a) => ach.got[a[0]]).length, label = '🏅 업적 ' + n + '/' + ACH.length;
  $('achBtn').textContent = label; $('achBtn2').textContent = label;
  const ol = $('achList'); ol.textContent = '';
  ACH.forEach((a) => {
    const li = document.createElement('li'); if (ach.got[a[0]]) li.className = 'got';
    const ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = ach.got[a[0]] ? '🏅' : '🔒';
    const tx = document.createElement('span'); const b = document.createElement('b'); b.textContent = a[1]; tx.appendChild(b);
    const cnt = a[0] === 'dodger' ? ' (' + Math.min(20, ach.cnt.dodge || 0) + '/20)' : a[0] === 'bumper' ? ' (' + Math.min(5, ach.cnt.bump || 0) + '/5)' : a[0] === 'stars50' ? ' (' + Math.min(50, totalStars) + '/50)' : '';
    tx.appendChild(document.createTextNode(' ' + a[2] + cnt));
    li.appendChild(ic); li.appendChild(tx); ol.appendChild(li);
  });
}
function unlock(id) {
  if (ach.got[id]) return;
  const a = ACH.find((x) => x[0] === id); if (!a) return;
  ach.got[id] = 1; store.set('ach', ach.got); renderAch();
  const el = $('achPop'); el.textContent = '🏅 업적 달성! ' + a[1]; el.classList.add('on');
  clearTimeout(achTimer); achTimer = setTimeout(() => el.classList.remove('on'), 3400);
  sfx('ach');
}
function countAch(key, need, id) {
  if (ach.got[id]) return;
  ach.cnt[key] = (ach.cnt[key] || 0) + 1; store.set('achCnt', ach.cnt);
  if (ach.cnt[key] >= need) unlock(id);
}
renderAch();

// ---------- surprise events ----------
function eventAt(slot) {
  // a shuffled bag per six slots: every event comes up once per round, and never twice in a row
  const n = EVENTS.length, bag = (block) => {
    let r = (Math.imul(block, 0x9E3779B1) >>> 0) || 1; const a = EVENTS.map((_, k) => k);
    for (let k = n - 1; k > 0; k--) { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; const m = r % (k + 1), t = a[k]; a[k] = a[m]; a[m] = t; }
    return a;
  };
  const block = Math.floor(slot / n), cur = bag(block), prev = bag(block - 1);
  if (cur[0] === prev[n - 1]) { const t = cur[0]; cur[0] = cur[1]; cur[1] = t; }
  return EVENTS[cur[slot - block * n]];
}
const bonusGeo = new THREE.OctahedronGeometry(0.5), bonusMat = std(0xff8fab, 0.25, 0.3); bonusMat.emissive = C(0x8a2a4a);
function startEvent(id, seed) {
  ev.startT = Date.now();
  if (id === 'lowgrav') ev.grav = 0.42;
  else if (id === 'speed') ev.speed = 1.4;
  else if (id === 'storm') ev.storm = true;
  else if (id === 'dark') {
    ev.sky = scene.background; scene.background = C(0x0b0d1a); scene.fog.color.copy(C(0x0b0d1a));
    hemi.intensity = 0.06; sun.intensity = 0.04;
    if (!ev.lamp) { ev.lamp = new THREE.PointLight(C(0xfff1c2), 1.5, 15); ev.lamp.position.y = 2.2; player.add(ev.lamp); }
    ev.lamp.visible = true;
  } else if (id === 'starrain') {
    let r = (seed >>> 0) || 1; const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
    for (let i = 0; i < 10; i++) {
      const st = steps[2 + Math.floor(rnd() * (steps.length - 4))], side = rnd() < 0.5 ? -1 : 1;
      const m = mesh(bonusGeo, bonusMat), x = st.cx + st.rx * side * 0.9, z = st.cz + st.rz * side * 0.9, y = st.topY + 1.2;
      m.position.set(x, y + 14, z); scene.add(m); ev.bonus.push({ mesh: m, x, y, z });
    }
  }
}
function endEvent(id) {
  ev.grav = 1; ev.speed = 1; ev.storm = false; ev.wind = 0; ev.pulse = false;
  if (id === 'dark') { scene.background = ev.sky; scene.fog.color.copy(C(0xdcecff)); hemi.intensity = 0.62; sun.intensity = 0.78; if (ev.lamp) ev.lamp.visible = false; }
  ev.bonus.forEach((b) => scene.remove(b.mesh)); ev.bonus.length = 0;
}
function updateEvents(dt) {
  const t = Date.now(), slot = Math.floor(t / EV_PERIOD), into = t - slot * EV_PERIOD;
  let cur = eventAt(slot), phase = into < EV_WARN ? 'warn' : (into < EV_WARN + EV_LEN ? 'on' : 'idle'), left = EV_WARN + EV_LEN - into, seed = slot;
  if (ev.force) {
    if (t > ev.force.until) ev.force = null;
    else { cur = ev.force.e; phase = 'on'; left = ev.force.until - t; seed = 7; }
  }
  if (game.state !== 'play') phase = 'idle';
  const on = phase === 'on' ? cur.id : null;
  if (on !== ev.on) {
    if (ev.on) endEvent(ev.on);
    ev.on = on;
    if (on) { startEvent(on, seed); sfx('event'); toast(cur.icon + ' ' + cur.name + '! ' + cur.tip, 2600); }
  }
  if (phase === 'warn' && ev.warnSlot !== slot) { ev.warnSlot = slot; sfx('tick'); }
  const el = $('evBanner');
  if (phase === 'idle') el.classList.add('hidden');
  else {
    el.classList.remove('hidden'); el.classList.toggle('warn', phase === 'warn');
    $('evText').textContent = phase === 'warn' ? '곧 시작: ' + cur.icon + ' ' + cur.name : cur.icon + ' ' + cur.name + ' · ' + Math.ceil(left / 1000) + '초';
  }
  if (on === 'sneeze') {       // three gusts that push everyone away from the kid
    const pulse = ((t - ev.startT) % 5000) < 1800;
    if (pulse && !ev.pulse) { sfx('sneeze'); cam.shake = Math.max(cam.shake, 0.3); }
    ev.pulse = pulse; ev.wind = pulse ? 5.5 : 0;
    if (pulse && Math.random() < dt * 30) { const p = player.position; burst(p.x + (Math.random() - 0.5) * 8, p.y + 1 + Math.random() * 2, p.z - 6, 0xffffff, 3, 2, 0.18); }
  }
  if (ev.bonus.length) {
    const p = player.position;
    for (let i = ev.bonus.length - 1; i >= 0; i--) {
      const b = ev.bonus[i]; b.mesh.rotation.y += dt * 4;
      b.mesh.position.y = Math.max(b.y, b.mesh.position.y - dt * 9);       // falls from the sky, then hovers
      if (Math.hypot(p.x - b.x, p.z - b.z) < 1.2 && Math.abs(p.y + 0.9 - b.mesh.position.y) < 1.4) {
        scene.remove(b.mesh); ev.bonus.splice(i, 1);
        totalStars++; store.set('totalStars', totalStars); if (totalStars >= 50) unlock('stars50'); unlock('bonus');
        sfx('star'); burst(b.x, b.y, b.z, 0xff8fab, 16, 4); toast('⭐ 보너스 별 +1 (모자 해금용)', 1500);
      }
    }
  }
}

// ---------- floor buttons + chest ----------
function updatePuzzle(dt, list) {
  const p = player.position;
  let all = true;
  plates.forEach((pl) => {
    let on = game.state === 'play' && p.y < 0.6 && Math.hypot(p.x - pl.x, p.z - pl.z) < 1.05;
    for (let i = 0; i < boxes.length && !on; i++) on = Math.hypot(boxes[i].mesh.position.x - pl.x, boxes[i].mesh.position.z - pl.z) < 1.05;
    for (let i = 0; i < list.length && !on; i++) on = list[i].t === null && list[i].y < 0.6 && Math.hypot(list[i].x - pl.x, list[i].z - pl.z) < 1.05;
    if (on !== pl.pressed) { pl.pressed = on; pl.cap.material.color.copy(C(on ? 0x51cf66 : 0xff6b6b)); if (on && game.state === 'play') sfx('flag'); }
    pl.cap.position.y = lerp(pl.cap.position.y, on ? 0.08 : 0.14, damp(0.001, dt));
    if (!on) all = false;
  });
  if (all && !chest.open && game.state === 'play') {
    chest.open = true; sfx('open'); unlock('chest'); burst(CHEST.x, 1.6, CHEST.z, 0xffd43b, 30, 6);
    toast('🧰 보물상자가 열렸어요! 안에 열쇠 조각이 있어요', 3000);
  }
  chest.lid.rotation.x = lerp(chest.lid.rotation.x, chest.open ? -1.9 : 0, damp(0.01, dt));
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
  updatePlats(); updateEvents(dt);

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
  player.userData.ice.visible = me.frozenT > 0 && game.state === 'play';
  for (let i = 0; i < stars.length; i++) { const s = stars[i]; s.mesh.rotation.y += dt * 2.4; s.mesh.position.y = s.y + Math.sin(now * 0.004 + i) * 0.12; }
  itemBoxes.forEach((s, i) => { s.g.rotation.y += dt * 1.5; s.g.rotation.x += dt * 0.7; s.g.position.y = s.y + Math.sin(now * 0.003 + i * 2) * 0.12; });
  traps.forEach((t) => { t.mesh.rotation.z += dt * 1.2; });
  pads.forEach((pd) => { pd.bounce = Math.max(0, pd.bounce - dt * 3); pd.skin.position.y = 0.29 - Math.sin(pd.bounce * Math.PI) * 0.16; });
  const list = syncRemotes(dt);
  sendPresence(now);
  updatePuzzle(dt, list);

  pieces.forEach((pc, i) => {
    pc.mesh.visible = pc.beam.visible = pieceAtHome(i) && pieceAvailable(i) && game.state !== 'done';
    pc.mesh.rotation.y += dt * 2; pc.mesh.position.y = pc.pos.y + Math.sin(now * 0.003 + i) * 0.2;
    pc.beam.material.opacity = 0.12 + 0.05 * Math.sin(now * 0.004 + i);
  });
  keyLight.visible = pieceAtHome(0);
  const pk = player.userData.key; pk.visible = me.order.length > 0; pk.scale.setScalar(0.35 + 0.14 * me.order.length);
  player.visible = game.state !== 'done';
  exitGlow.material.opacity = me.hasKey ? 0.35 + 0.3 * Math.sin(now * 0.006) : 0;
  exitLock.visible = !me.hasKey; exitLock.position.y = 2.5 + Math.sin(now * 0.003) * 0.1;

  boardT -= dt;
  if (boardT <= 0) {
    boardT = 0.25; $('shieldIcon').classList.toggle('hidden', !me.shield); updateBoard(list);
    const db = $('dashBtn'); db.classList.toggle('cool', me.dashCd > 0);
  }
  if (game.state === 'play') $('time').textContent = game.elapsed < 60 ? game.elapsed.toFixed(1) : fmt(game.elapsed);
  updateCamera(dt, now, list);
  updatePointer();
  renderer.render(scene, camera);
}
applyQuality();
requestAnimationFrame(frame);

// test hook for local development only
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  window.__gke = { ev, ach, unlock, forceEvent(id, ms) { ev.force = { e: EVENTS.find((x) => x.id === id), until: Date.now() + (ms || 15000) }; }, battle, player, me, vel, stars, steps, marbles, sweepers, itemBoxes, pads, plats, pieces, plates, chest, boxes, traps, ISLAND, CHEST, useItem, dash, setItem, flags, keyPos, EXIT, hs, game, cam, opt, spec, remotes, get records() { return records; }, get myId() { return myId; }, get netOk() { return netOk; }, beginRun, groupStart, state: () => ({ vy, grounded, airT }),
    tick(n, dt) { for (let i = 0; i < n; i++) { clockOff += (dt || 1 / 60) * 1000; step(clock()); } } };
}
})();
