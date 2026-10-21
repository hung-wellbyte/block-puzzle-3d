import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BOARD_SIZE as B, generateLevel } from './level.js?v=2';

// ---------- Constants ----------
const HALF = B / 2;
const TILE_TOP = 0.04;
const BLOCK_H = 0.5;
const BASE_Y = TILE_TOP + BLOCK_H / 2;
const HOLD_LIFT = 0.85;
const DRAG_THRESHOLD = 6;
const PALETTE = [
  0xff5a5f, 0xffb400, 0x2f80ed, 0x27ae60, 0x9b51e0, 0xff7a1a, 0x00b8a9, 0xeb5ea7,
  0x56ccf2, 0x8bd346, 0x5b6cff, 0xf2d14c, 0xc0392b, 0x1abc9c, 0xb07cff, 0xa0522d,
  0x7fd8ff, 0xd4a017,
];
const FIXED_COLOR = 0x2b2f3a;
const STORAGE_KEY = 'block-puzzle-3d';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const ui = {
  level: $('levelLabel'), time: $('time'), moves: $('moves'), left: $('left'),
  filled: $('filled'), bar: $('progressBar'), toast: $('toast'),
  prev: $('prevLevel'), next: $('nextLevel'), undo: $('undoBtn'), rotate: $('rotateBtn'),
  hint: $('hintBtn'), solution: $('solutionBtn'), reset: $('resetBtn'), random: $('randomBtn'),
  help: $('helpModal'), win: $('winModal'), sound: $('soundBtn'), camera: $('cameraBtn'),
};

// ---------- Persistence ----------
const save = (() => {
  let data = { level: 1, unlocked: 1, best: {}, sound: true, seenHelp: false };
  try { Object.assign(data, JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}); } catch { /* storage unavailable */ }
  return {
    data,
    write() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ignore */ } },
  };
})();

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);

scene.add(new THREE.HemisphereLight(0xffffff, 0xd8deea, 0.45));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(7, 16, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 50 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 4;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(300, 300),
  new THREE.ShadowMaterial({ color: 0x1b2440, opacity: 0.12 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.72;
ground.receiveShadow = true;
scene.add(ground);

// ---------- Board ----------
const tiles = [];
(function buildBoard() {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0xf6f7fb, roughness: 0.55 });
  const base = new THREE.Mesh(new RoundedBoxGeometry(B + 1.2, 0.7, B + 1.2, 4, 0.22), baseMat);
  base.position.y = -0.35;
  base.castShadow = base.receiveShadow = true;
  group.add(base);

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(B + 0.16, 0.02, B + 0.16),
    new THREE.MeshStandardMaterial({ color: 0xc9d0de, roughness: 0.8 }),
  );
  floor.position.y = 0.0;
  floor.receiveShadow = true;
  group.add(floor);

  const rimMat = new THREE.MeshStandardMaterial({ color: 0x8e99bd, roughness: 0.45, metalness: 0.05 });
  const rimH = 0.26;
  const long = new RoundedBoxGeometry(B + 1.2, rimH, 0.5, 3, 0.1);
  const short = new RoundedBoxGeometry(0.5, rimH, B + 0.4, 3, 0.1);
  for (const s of [-1, 1]) {
    const a = new THREE.Mesh(long, rimMat);
    a.position.set(0, rimH / 2, s * (HALF + 0.35));
    const b = new THREE.Mesh(short, rimMat);
    b.position.set(s * (HALF + 0.35), rimH / 2, 0);
    for (const m of [a, b]) { m.castShadow = m.receiveShadow = true; group.add(m); }
  }

  const tileGeo = new RoundedBoxGeometry(0.94, 0.04, 0.94, 2, 0.015);
  for (let r = 0; r < B; r++) {
    tiles.push([]);
    for (let c = 0; c < B; c++) {
      const mat = new THREE.MeshStandardMaterial({
        color: (r + c) % 2 ? 0xeef1f7 : 0xffffff, roughness: 0.6, emissive: 0x000000,
      });
      const t = new THREE.Mesh(tileGeo, mat);
      t.position.set(c - HALF + 0.5, 0.02, r - HALF + 0.5);
      t.receiveShadow = true;
      group.add(t);
      tiles[r].push(t);
    }
  }
  scene.add(group);
})();

// Ghost preview that shows where the held piece will land.
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.5, depthWrite: false });
const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 1), ghostMat);
ghost.visible = false;
ghost.renderOrder = 2;
scene.add(ghost);

// Hint marker: pulsing fill, raised border and a floating ghost of the suggested piece.
const hintGroup = new THREE.Group();
hintGroup.visible = false;
scene.add(hintGroup);
const hintFillMat = new THREE.MeshBasicMaterial({ color: 0xffb400, transparent: true, opacity: 0.5, depthWrite: false });
const hintFill = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 1), hintFillMat);
hintFill.renderOrder = 2;
const hintEdgeMat = new THREE.MeshStandardMaterial({ color: 0xffb400, emissive: 0xffb400, emissiveIntensity: 0.6, roughness: 0.4 });
const hintEdges = [0, 1, 2, 3].map(() => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), hintEdgeMat));
const hintGhostMat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4, depthWrite: false, roughness: 0.4 });
const hintGhost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), hintGhostMat);
hintGroup.add(hintFill, hintGhost, ...hintEdges);

function setHintMarker(rect, { color, ghostColor = null, edgeH = 0.14 }) {
  const { c, r, w, h } = rect;
  hintGroup.position.set(cellX(c, w), 0, cellX(r, h));
  hintFillMat.color.set(color);
  hintEdgeMat.color.set(color);
  hintEdgeMat.emissive.set(color);
  hintFill.scale.set(w - 0.04, 1, h - 0.04);
  hintFill.position.y = TILE_TOP + 0.015;
  const t = 0.09;
  const bars = [
    [w + t, t, 0, -h / 2], [w + t, t, 0, h / 2],
    [t, h + t, -w / 2, 0], [t, h + t, w / 2, 0],
  ];
  bars.forEach(([sx, sz, x, z], i) => {
    hintEdges[i].scale.set(sx, edgeH, sz);
    hintEdges[i].position.set(x, TILE_TOP + edgeH / 2, z);
  });
  hintGhost.visible = ghostColor !== null;
  if (ghostColor !== null) {
    hintGhostMat.color.set(ghostColor);
    hintGhost.scale.set(w - 0.1, BLOCK_H, h - 0.1);
  }
}

// ---------- Block meshes ----------
const bodyGeoCache = new Map();
function bodyGeo(w, h) {
  const key = `${w}x${h}`;
  if (!bodyGeoCache.has(key)) bodyGeoCache.set(key, new RoundedBoxGeometry(w - 0.08, BLOCK_H, h - 0.08, 4, 0.1));
  return bodyGeoCache.get(key);
}
const capGeo = new RoundedBoxGeometry(0.62, 0.05, 0.62, 2, 0.02);

function buildBlock(w, h, color, fixed) {
  const group = new THREE.Group();
  const mat = fixed
    ? new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2 })
    : new THREE.MeshPhysicalMaterial({ color, roughness: 0.36, clearcoat: 0.8, clearcoatRoughness: 0.25 });
  const body = new THREE.Mesh(bodyGeo(w, h), mat);
  body.castShadow = body.receiveShadow = true;
  group.add(body);

  // One raised cap per unit cell so piece sizes are readable at a glance.
  const capColor = new THREE.Color(color).lerp(new THREE.Color(fixed ? 0x000000 : 0xffffff), fixed ? 0.35 : 0.2);
  const capMat = new THREE.MeshStandardMaterial({ color: capColor, roughness: fixed ? 0.8 : 0.4 });
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(-w / 2 + i + 0.5, BLOCK_H / 2 - 0.005, -h / 2 + j + 0.5);
      cap.castShadow = true;
      group.add(cap);
    }
  }
  return { group, body, mats: [mat, capMat] };
}

// ---------- Game state ----------
let level = null; // { number, seed, random, fixed, pieces }
let fixedBlocks = [];
let pieces = [];
let trayPanels = [];
let undoStack = [];
let moves = 0;
let hintsUsed = 0;
let startTime = 0;
let elapsed = 0;
let won = false;
let revealed = null; // snapshot of the board taken before the solution was shown
let solutionSeen = false;
let winT = 0;

let holding = null;
let holdMode = 'drag'; // 'drag' until the first pointerup without movement, then 'click'
let holdStart = null; // snapshot before pickup, for undo
let holdOrigin = null; // the held piece's state before pickup, for cancel
let snap = null; // { c, r, w, h, valid }
let hover = null;
let downOnCanvas = false;
const downPos = { x: 0, y: 0 };
const pointer = { ndc: new THREE.Vector2(), inside: false, dirty: true };

let hint = null; // { kind: 'place' | 'wrong', piece, t }
let ghostFlash = 0;

const dims = (p) => (p.rotSteps % 2 ? [p.h, p.w] : [p.w, p.h]);
const cellX = (c, w) => c - HALF + w / 2;

function occupancy(exclude) {
  const grid = Array.from({ length: B }, () => new Array(B).fill(null));
  const mark = (c, r, w, h, owner) => {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) grid[y][x] = owner;
  };
  for (const f of fixedBlocks) mark(f.c, f.r, f.w, f.h, f);
  for (const p of pieces) {
    if (p === exclude || !p.placed) continue;
    const [w, h] = dims(p);
    mark(p.placed.c, p.placed.r, w, h, p);
  }
  return grid;
}

function rectFree(grid, c, r, w, h) {
  if (c < 0 || r < 0 || c + w > B || r + h > B) return false;
  for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (grid[y][x]) return false;
  return true;
}

const snapshot = () => pieces.map((p) => ({ placed: p.placed && { ...p.placed }, rotSteps: p.rotSteps }));
function restore(snap) {
  snap.forEach((s, i) => { pieces[i].placed = s.placed && { ...s.placed }; pieces[i].rotSteps = s.rotSteps; });
}
const sameState = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- Level lifecycle ----------
function clearLevel() {
  for (const obj of [...fixedBlocks, ...pieces]) {
    scene.remove(obj.mesh);
    obj.mats.forEach((m) => m.dispose());
  }
  fixedBlocks = [];
  pieces = [];
}

function loadLevel(number, { random = false, seed } = {}) {
  cancelHold(true);
  clearLevel();
  const levelSeed = random ? seed ?? Math.floor(Math.random() * 1e9) : number * 7919 + 13;
  const data = generateLevel(levelSeed, random ? 6 + Math.floor(Math.random() * 6) : number);
  level = { number, seed: levelSeed, random, ...data };

  for (const f of data.fixed) {
    const { group, body, mats } = buildBlock(f.w, f.h, FIXED_COLOR, true);
    const block = { ...f, fixed: true, mesh: group, mats, shake: 0 };
    body.userData.piece = block;
    group.position.set(cellX(f.c, f.w), BASE_Y, cellX(f.r, f.h));
    scene.add(group);
    fixedBlocks.push(block);
  }

  // Each block shape keeps the same colour on every level.
  data.pieces.forEach((d, i) => {
    const color = PALETTE[i % PALETTE.length];
    const { group, body, mats } = buildBlock(d.w, d.h, color, false);
    const p = {
      id: i, w: d.w, h: d.h, color, solution: d.solution, mesh: group, mats,
      placed: null, rotSteps: 0, home: new THREE.Vector3(), hoverT: 0, glow: 0,
    };
    body.userData.piece = p;
    scene.add(group);
    pieces.push(p);
  });

  if (!random) { save.data.level = number; save.write(); }
  resetProgress();
  layout(true);
  // Drop the pieces in from above for a little entrance animation.
  pieces.forEach((p, i) => p.mesh.position.set(p.home.x, 4 + i * 0.25, p.home.z));
  fixedBlocks.forEach((f) => { f.mesh.position.y = 6; });
  updateHUD();
}

function resetProgress() {
  undoStack = [];
  moves = 0;
  hintsUsed = 0;
  won = false;
  winT = 0;
  hint = null;
  revealed = null;
  solutionSeen = false;
  startTime = performance.now();
  elapsed = 0;
  ui.win.hidden = true;
}

function restartLevel() {
  cancelHold(true);
  pieces.forEach((p) => { p.placed = null; p.rotSteps = 0; });
  resetProgress();
  updateHUD();
  sfx.back();
}

// ---------- Tray layout & camera fit ----------
function shelfPack(items, region) {
  const gap = 0.4;
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w);
  const rows = [];
  let row = null;
  for (const it of sorted) {
    if (!row || row.w + gap + it.w > region.w) {
      row = { items: [], w: -gap, h: 0 };
      rows.push(row);
    }
    row.items.push(it);
    row.w += gap + it.w;
    row.h = Math.max(row.h, it.h);
  }
  const kept = [];
  const leftover = [];
  let depth = -gap;
  for (const rw of rows) {
    if (depth + gap + rw.h > region.d) { leftover.push(...rw.items); continue; }
    depth += gap + rw.h;
    kept.push(rw);
  }
  let z = region.align === 'center' ? region.z0 + (region.d - depth) / 2 : region.z0;
  let minX = Infinity, maxX = -Infinity;
  for (const rw of kept) {
    let x = region.x0 + (region.w - rw.w) / 2;
    for (const it of rw.items) {
      it.home.set(x + it.w / 2, BASE_Y, z + rw.h / 2);
      x += it.w + gap;
    }
    minX = Math.min(minX, region.x0 + (region.w - rw.w) / 2);
    maxX = Math.max(maxX, region.x0 + (region.w + rw.w) / 2);
    z += rw.h + gap;
  }
  const bounds = kept.length
    ? { minX, maxX, minZ: z - gap - depth, maxZ: z - gap }
    : null;
  return { leftover, bounds };
}

function layout(instant = false) {
  const aspect = window.innerWidth / window.innerHeight;
  const portrait = aspect < 1.05;
  const edge = HALF + 0.6;
  let regions;
  if (!portrait) {
    regions = [
      { x0: edge + 0.7, z0: -edge, w: 6.4, d: edge * 2, align: 'center' },
      { x0: -edge - 0.7 - 6.4, z0: -edge, w: 6.4, d: edge * 2, align: 'center' },
      { x0: -edge, z0: edge + 0.8, w: edge * 2, d: 12, align: 'start' },
    ];
  } else {
    regions = [
      { x0: -edge, z0: edge + 0.8, w: edge * 2, d: 14, align: 'start' },
      { x0: -edge, z0: -edge - 0.8 - 8, w: edge * 2, d: 8, align: 'start' },
    ];
  }

  // Split pieces evenly by area between the two side trays in landscape.
  const buckets = regions.map(() => []);
  if (!portrait) {
    const area = [0, 0];
    for (const p of pieces) {
      const k = area[0] <= area[1] ? 0 : 1;
      buckets[k].push(p);
      area[k] += p.w * p.h;
    }
  } else {
    buckets[0].push(...pieces);
  }

  const boxes = [];
  let carry = [];
  regions.forEach((region, i) => {
    const { leftover, bounds } = shelfPack([...buckets[i], ...carry], region);
    carry = leftover;
    if (bounds) boxes.push(bounds);
  });

  for (const panel of trayPanels) { scene.remove(panel); panel.geometry.dispose(); }
  trayPanels = boxes.map((b) => {
    const pad = 0.45;
    const w = b.maxX - b.minX + pad * 2;
    const d = b.maxZ - b.minZ + pad * 2;
    const panel = new THREE.Mesh(new RoundedBoxGeometry(w, 0.3, d, 4, 0.14), trayMat);
    panel.position.set((b.minX + b.maxX) / 2, TILE_TOP - 0.15, (b.minZ + b.maxZ) / 2);
    panel.castShadow = panel.receiveShadow = true;
    scene.add(panel);
    return panel;
  });

  const all = { minX: -edge, maxX: edge, minZ: -edge, maxZ: edge };
  for (const b of boxes) {
    all.minX = Math.min(all.minX, b.minX - 0.45);
    all.maxX = Math.max(all.maxX, b.maxX + 0.45);
    all.minZ = Math.min(all.minZ, b.minZ - 0.45);
    all.maxZ = Math.max(all.maxZ, b.maxZ + 0.45);
  }
  fitCamera(all, instant);
}
const trayMat = new THREE.MeshStandardMaterial({ color: 0xe9ecf4, roughness: 0.7 });

const camHome = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
let camTween = null;

function fitCamera(b, instant) {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const sx = (b.maxX - b.minX) / 2 + 0.6;
  const sz = (b.maxZ - b.minZ) / 2 + 0.6;
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanH = tanV * camera.aspect;
  const elev = THREE.MathUtils.degToRad(56);
  // Leave room for the HUD (top) and toolbar (bottom).
  const uiMargin = window.innerWidth < 720 ? 1.45 : 1.22;
  const dist = Math.max(sx / tanH, ((sz * Math.sin(elev)) / tanV) * uiMargin) + sz * Math.cos(elev) * 0.5 + 0.6;
  camHome.target.set(cx, 0, cz + (window.innerWidth < 720 ? -0.3 : 0.4));
  camHome.pos.set(0, Math.sin(elev), Math.cos(elev)).multiplyScalar(dist).add(camHome.target);
  controls.maxDistance = dist * 2;
  if (instant) {
    camera.position.copy(camHome.pos);
    controls.target.copy(camHome.target);
    controls.update();
  } else {
    resetCamera();
  }
}

function resetCamera() {
  camTween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone() };
}

// ---------- Interaction ----------
const raycaster = new THREE.Raycaster();
const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TILE_TOP);
const planeHit = new THREE.Vector3();

function setPointer(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  pointer.dirty = true;
}

function pickAt() {
  raycaster.setFromCamera(pointer.ndc, camera);
  const targets = [...fixedBlocks, ...pieces].filter((p) => p !== holding).map((p) => p.mesh.children[0]);
  const hit = raycaster.intersectObjects(targets, false)[0];
  return hit ? hit.object.userData.piece : null;
}

function pointerOnBoardPlane() {
  raycaster.setFromCamera(pointer.ndc, camera);
  return raycaster.ray.intersectPlane(boardPlane, planeHit);
}

function updateHold() {
  if (!holding) return;
  const pt = pointerOnBoardPlane();
  const [w, h] = dims(holding);
  snap = null;
  if (pt) {
    const margin = 0.7;
    if (Math.abs(pt.x) < HALF + margin && Math.abs(pt.z) < HALF + margin) {
      const c = THREE.MathUtils.clamp(Math.round(pt.x + HALF - w / 2), 0, B - w);
      const r = THREE.MathUtils.clamp(Math.round(pt.z + HALF - h / 2), 0, B - h);
      snap = { c, r, w, h, valid: rectFree(occupancy(holding), c, r, w, h) };
    }
    holding.holdPos = snap
      ? new THREE.Vector3(cellX(snap.c, w), BASE_Y + HOLD_LIFT, cellX(snap.r, h))
      : new THREE.Vector3(pt.x, BASE_Y + HOLD_LIFT, pt.z);
  }
  if (snap) {
    ghost.visible = true;
    ghost.scale.set(w - 0.06, 1, h - 0.06);
    ghost.position.set(cellX(snap.c, w), TILE_TOP + 0.02, cellX(snap.r, h));
    ghostMat.color.set(snap.valid ? 0x34d399 : 0xf87171);
  } else {
    ghost.visible = false;
  }
}

function pickUp(p) {
  holding = p;
  holdMode = 'drag';
  holdStart = snapshot();
  holdOrigin = { placed: p.placed, rotSteps: p.rotSteps };
  p.placed = null;
  p.holdPos = p.mesh.position.clone().setY(BASE_Y + HOLD_LIFT);
  controls.enabled = false;
  sfx.pick();
  updateHold();
  updateHUD();
}

function release() {
  const p = holding;
  holding = null;
  snap = null;
  ghost.visible = false;
  controls.enabled = true;
  if (p && holdStart) {
    const now = snapshot();
    if (!sameState(now, holdStart)) {
      undoStack.push(holdStart);
      moves++;
    }
  }
  holdStart = null;
  // A hint is done once the suggested piece is placed (or the misplaced one is lifted off).
  if (hint && (hint.kind === 'place' ? hint.piece.placed : !hint.piece.placed)) hint = null;
  updateHUD();
  checkWin();
}

function returnToTray(p) {
  p.placed = null;
  p.rotSteps -= p.rotSteps % 2; // back to the tray orientation without spinning the long way round
}

function cancelHold(silent = false) {
  if (!holding) return;
  holding.placed = holdOrigin.placed;
  holding.rotSteps = holdOrigin.rotSteps;
  holdStart = null; // a cancel never counts as a move
  release();
  if (!silent) sfx.back();
}

function tryDrop() {
  const p = holding;
  if (snap && snap.valid) {
    p.placed = { c: snap.c, r: snap.r };
    p.mesh.scale.set(1.08, 0.78, 1.08);
    sfx.place();
    release();
    return;
  }
  if (snap) {
    sfx.error();
    ghostFlash = 0.35;
    if (holdMode === 'click') return; // keep holding so the player can try another spot
    cancelHold(true);
    toast('Không thể đặt ở đây — khối bị chồng lên khối khác');
    return;
  }
  returnToTray(p);
  sfx.back();
  release();
}

function rotateHeld() {
  if (!holding) {
    toast('Hãy chọn một khối trước khi xoay');
    return;
  }
  if (holding.w === holding.h) return;
  holding.rotSteps -= 1;
  sfx.rotate();
  updateHold();
}

function onPointerDown(e) {
  if (won) return;
  if (revealed) {
    toast('Đang xem lời giải — bấm “Ẩn lời giải” để tiếp tục chơi');
    return;
  }
  setPointer(e);
  pointer.inside = true;
  downOnCanvas = true;
  downPos.x = e.clientX;
  downPos.y = e.clientY;

  if (e.button === 2) {
    if (holding) { rotateHeld(); return; }
    const hit = pickAt();
    if (hit && !hit.fixed && hit.placed) {
      const before = snapshot();
      returnToTray(hit);
      undoStack.push(before);
      moves++;
      sfx.back();
      updateHUD();
    }
    return;
  }
  if (e.button !== 0) return;

  if (holding) {
    // Click mode: tapping another tray piece away from the board swaps pieces.
    updateHold();
    if (!snap) {
      const other = pickAt();
      if (other && !other.fixed && !other.placed) {
        returnToTray(holding);
        release();
        pickUp(other);
        holdMode = 'click';
        downOnCanvas = false;
      }
    }
    return;
  }

  const hit = pickAt();
  if (!hit) return;
  if (hit.fixed) {
    hit.shake = 0.45;
    sfx.error();
    toast('Khối đen là khối cố định — không thể di chuyển');
    return;
  }
  pickUp(hit);
}

function onPointerMove(e) {
  setPointer(e);
  if (holding) updateHold();
}

function onPointerUp(e) {
  if (!downOnCanvas) return;
  downOnCanvas = false;
  if (!holding) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > DRAG_THRESHOLD;
  if (holdMode === 'drag' && !moved) {
    holdMode = 'click';
    return;
  }
  setPointer(e);
  updateHold();
  tryDrop();
}

// Registered before OrbitControls so we can disable it when a piece is grabbed.
canvas.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointerleave', () => { pointer.inside = false; });
canvas.addEventListener('pointerenter', () => { pointer.inside = true; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 7;
controls.maxPolarAngle = Math.PI / 2.2;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.addEventListener('start', () => { camTween = null; });

// ---------- Actions ----------
function undo() {
  if (revealed) { toggleSolution(); return; }
  if (holding) { cancelHold(); return; }
  const prev = undoStack.pop();
  if (!prev) { toast('Không còn gì để hoàn tác'); return; }
  restore(prev);
  moves++;
  sfx.back();
  updateHUD();
}

function showHint() {
  if (won || revealed) return;
  if (holding) cancelHold(true);
  const occ = occupancy(null);
  const free = pieces.filter((p) => !p.placed);
  const solutions = [...pieces].map((p) => p.solution).sort((a, b) => b.w * b.h - a.w * a.h);
  for (const s of solutions) {
    if (!rectFree(occ, s.c, s.r, s.w, s.h)) continue;
    const match = free.find((p) => (p.w === s.w && p.h === s.h) || (p.w === s.h && p.h === s.w));
    if (!match) continue;
    hint = { kind: 'place', piece: match, t: 10 };
    setHintMarker(s, { color: 0xffb400, ghostColor: match.color });
    hintsUsed++;
    sfx.hint();
    toast(`Gợi ý: đặt khối ${match.w}×${match.h} vào vùng đang sáng`);
    return;
  }
  // No consistent hint left: point at a misplaced piece instead.
  const wrong = pieces.find((p) => {
    if (!p.placed) return false;
    const [w, h] = dims(p);
    return !pieces.some((q) => q.solution.c === p.placed.c && q.solution.r === p.placed.r && q.solution.w === w && q.solution.h === h);
  });
  if (wrong) {
    const [w, h] = dims(wrong);
    hint = { kind: 'wrong', piece: wrong, t: 6 };
    setHintMarker({ c: wrong.placed.c, r: wrong.placed.r, w, h }, { color: 0xff3b30, edgeH: BLOCK_H + 0.2 });
    hintsUsed++;
    toast('Khối đang sáng có thể đặt sai vị trí — hãy thử gỡ nó ra');
  } else {
    toast('Bạn đang đi đúng hướng!');
  }
}

// Shows the generated solution; pressing again restores the player's own arrangement.
function toggleSolution() {
  if (won) return;
  if (revealed) {
    restore(revealed);
    revealed = null;
    sfx.back();
    updateHUD();
    return;
  }
  cancelHold(true);
  hint = null;
  revealed = snapshot();
  solutionSeen = true;
  const token = revealed;
  [...pieces]
    .sort((a, b) => a.solution.r - b.solution.r || a.solution.c - b.solution.c)
    .forEach((p, i) => {
      setTimeout(() => {
        if (revealed !== token) return;
        const s = p.solution;
        if ((s.w !== p.w) !== (p.rotSteps % 2 !== 0)) p.rotSteps -= 1;
        p.placed = { c: s.c, r: s.r };
        p.mesh.scale.set(1.08, 0.78, 1.08);
        sfx.place();
        updateHUD();
      }, i * 90);
    });
  toast('Lời giải của màn này — bấm lại để ẩn và tiếp tục chơi');
  updateHUD();
}

function checkWin() {
  if (won || revealed || !pieces.every((p) => p.placed)) return;
  const occ = occupancy(null);
  if (!occ.every((row) => row.every(Boolean))) return;
  won = true;
  winT = 0;
  elapsed = performance.now() - startTime;
  const n = pieces.length;
  const stars = solutionSeen ? 1 : hintsUsed === 0 ? 3 : hintsUsed <= 2 ? 2 : 1;

  if (!level.random) {
    const key = String(level.number);
    const prev = save.data.best[key];
    if (!prev || stars > prev.stars || (stars === prev.stars && elapsed < prev.time)) {
      save.data.best[key] = { stars, time: elapsed, moves };
    }
    save.data.unlocked = Math.max(save.data.unlocked, level.number + 1);
    save.write();
  }

  sfx.win();
  launchConfetti();
  setTimeout(() => {
    [...ui.win.querySelectorAll('.stars span')].forEach((s, i) => s.classList.toggle('on', i < stars));
    $('winText').textContent = level.random
      ? 'Bạn đã lấp kín bàn chơi ngẫu nhiên!'
      : `Bạn đã hoàn thành màn ${level.number} với ${n} khối.`;
    $('winTime').textContent = formatTime(elapsed);
    $('winMoves').textContent = moves;
    $('winHints').textContent = hintsUsed;
    $('winNext').textContent = level.random ? 'Màn ngẫu nhiên mới →' : 'Màn tiếp theo →';
    ui.win.hidden = false;
  }, 1300);
  updateHUD();
}

// ---------- HUD ----------
function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function updateHUD() {
  if (!level) return;
  const placed = pieces.filter((p) => p.placed);
  const filled = 6 + placed.reduce((s, p) => s + p.w * p.h, 0);
  ui.level.textContent = level.random ? 'Ngẫu nhiên' : `Màn ${level.number}`;
  ui.moves.textContent = moves;
  ui.left.textContent = pieces.length - placed.length;
  ui.filled.textContent = filled;
  ui.bar.style.width = `${(filled / (B * B)) * 100}%`;
  ui.prev.disabled = !level.random && level.number <= 1;
  ui.next.disabled = !level.random && level.number >= save.data.unlocked;
  ui.undo.disabled = !revealed && !holding && undoStack.length === 0;
  ui.rotate.classList.toggle('active', !!holding);
  ui.rotate.disabled = ui.hint.disabled = !!revealed;
  ui.solution.classList.toggle('active', !!revealed);
  ui.solution.querySelector('span').textContent = revealed ? 'Ẩn lời giải' : 'Lời giải';
}

let toastTimer = 0;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2200);
}

// ---------- Sound ----------
let audioCtx = null;
function tone(freq, dur = 0.12, type = 'sine', vol = 0.12, slideTo) {
  if (!save.data.sound) return;
  try {
    audioCtx ??= new AudioContext();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  } catch { /* audio unavailable */ }
}
const sfx = {
  pick: () => tone(440, 0.09, 'triangle', 0.1, 660),
  place: () => { tone(260, 0.14, 'sine', 0.22, 150); tone(1100, 0.05, 'triangle', 0.05); },
  rotate: () => tone(720, 0.05, 'square', 0.035, 940),
  error: () => tone(170, 0.18, 'sawtooth', 0.06, 110),
  back: () => tone(520, 0.1, 'triangle', 0.07, 320),
  hint: () => tone(880, 0.25, 'sine', 0.08, 1320),
  win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'triangle', 0.12), i * 110)),
};

// ---------- Confetti ----------
const CONFETTI = 260;
const confetti = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.18, 0.1),
  new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  CONFETTI,
);
confetti.frustumCulled = false;
confetti.visible = false;
scene.add(confetti);
const conf = Array.from({ length: CONFETTI }, () => ({
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(),
}));
let confettiT = 0;

function launchConfetti() {
  const col = new THREE.Color();
  conf.forEach((c, i) => {
    c.pos.set((Math.random() - 0.5) * 6, 0.6, (Math.random() - 0.5) * 6);
    c.vel.set((Math.random() - 0.5) * 9, 7 + Math.random() * 8, (Math.random() - 0.5) * 9);
    c.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    c.spin.set(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5);
    confetti.setColorAt(i, col.set(PALETTE[i % PALETTE.length]));
  });
  confetti.instanceColor.needsUpdate = true;
  confetti.visible = true;
  confettiT = 0;
}

const dummy = new THREE.Object3D();
function updateConfetti(dt) {
  if (!confetti.visible) return;
  confettiT += dt;
  conf.forEach((c, i) => {
    c.vel.y -= 12 * dt;
    c.vel.multiplyScalar(1 - 1.6 * dt);
    c.pos.addScaledVector(c.vel, dt);
    c.rot.x += c.spin.x * dt;
    c.rot.y += c.spin.y * dt;
    c.rot.z += c.spin.z * dt;
    dummy.position.copy(c.pos);
    dummy.rotation.copy(c.rot);
    dummy.updateMatrix();
    confetti.setMatrixAt(i, dummy.matrix);
  });
  confetti.instanceMatrix.needsUpdate = true;
  if (confettiT > 6) confetti.visible = false;
}

// ---------- Main loop ----------
const clock = new THREE.Clock();
const tmpTarget = new THREE.Vector3();
const warnColor = new THREE.Color(0xff3b30);
const unitScale = new THREE.Vector3(1, 1, 1);

function updateHover() {
  if (!pointer.dirty) return;
  pointer.dirty = false;
  if (holding || won || !pointer.inside) {
    hover = null;
  } else {
    hover = pickAt();
  }
  canvas.style.cursor = holding ? 'grabbing' : hover ? (hover.fixed ? 'not-allowed' : 'grab') : 'default';
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  const k = (rate) => 1 - Math.exp(-rate * dt);

  updateHover();
  if (!won && level) ui.time.textContent = formatTime(performance.now() - startTime);
  if (won) winT += dt;
  if (hint) { hint.t -= dt; if (hint.t <= 0) hint = null; }
  ghostFlash = Math.max(0, ghostFlash - dt);
  ghostMat.opacity = ghostFlash > 0 ? 0.35 + 0.4 * Math.abs(Math.sin(ghostFlash * 30)) : 0.5;

  for (const p of pieces) {
    const [w, h] = dims(p);
    if (p === holding) {
      tmpTarget.copy(p.holdPos ?? p.mesh.position);
      tmpTarget.y += Math.sin(time * 4) * 0.04;
    } else if (p.placed) {
      tmpTarget.set(cellX(p.placed.c, w), BASE_Y, cellX(p.placed.r, h));
      if (won) {
        const wave = Math.sin(winT * 7 - (p.placed.c + p.placed.r) * 0.55);
        tmpTarget.y += Math.max(0, wave) * 0.45 * Math.max(0, 1 - winT / 2.5);
      }
    } else {
      tmpTarget.copy(p.home);
    }
    p.hoverT += ((p === hover ? 1 : 0) - p.hoverT) * k(14);
    tmpTarget.y += p.hoverT * 0.12;
    p.mesh.position.lerp(tmpTarget, k(p === holding ? 22 : 12));
    p.mesh.rotation.y += (p.rotSteps * (Math.PI / 2) - p.mesh.rotation.y) * k(16);
    p.mesh.scale.lerp(unitScale, k(10));

    const isHint = hint && hint.piece === p;
    const glow = isHint ? 0.4 + 0.3 * Math.sin(time * 8) : p.hoverT * 0.16 + (p === holding ? 0.1 : 0);
    for (const m of p.mats) {
      if (isHint && p.placed) m.emissive.copy(warnColor);
      else m.emissive.setHex(p.color);
      m.emissiveIntensity = glow;
    }
  }

  for (const f of fixedBlocks) {
    f.shake = Math.max(0, f.shake - dt);
    const base = new THREE.Vector3(cellX(f.c, f.w), BASE_Y, cellX(f.r, f.h));
    f.mesh.position.y += (base.y - f.mesh.position.y) * k(9);
    f.mesh.position.x = base.x + Math.sin(f.shake * 60) * 0.06 * (f.shake / 0.45);
    f.mesh.position.z = base.z;
  }

  hintGroup.visible = !!hint;
  if (hint) {
    const fade = Math.min(1, hint.t / 0.5);
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    hintFillMat.opacity = (0.3 + 0.35 * pulse) * fade;
    hintEdgeMat.emissiveIntensity = 0.3 + 0.6 * pulse;
    hintGhostMat.opacity = (0.3 + 0.2 * pulse) * fade;
    hintGhost.position.y = BASE_Y + 0.25 + Math.sin(time * 3) * 0.1;
  }

  if (camTween) {
    camTween.t = Math.min(1, camTween.t + dt * 1.6);
    const e = 1 - Math.pow(1 - camTween.t, 3);
    camera.position.lerpVectors(camTween.p0, camHome.pos, e);
    controls.target.lerpVectors(camTween.t0, camHome.target, e);
    if (camTween.t >= 1) camTween = null;
  }

  updateConfetti(dt);
  controls.update();
  renderer.render(scene, camera);
}

// ---------- Wiring ----------
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  layout(false);
}
window.addEventListener('resize', resize);

ui.undo.addEventListener('click', undo);
ui.rotate.addEventListener('click', rotateHeld);
ui.hint.addEventListener('click', showHint);
ui.solution.addEventListener('click', toggleSolution);
ui.reset.addEventListener('click', restartLevel);
ui.random.addEventListener('click', () => loadLevel(level.number, { random: true }));
ui.camera.addEventListener('click', resetCamera);
ui.prev.addEventListener('click', () => {
  loadLevel(level.random ? save.data.level : Math.max(1, level.number - 1));
});
ui.next.addEventListener('click', () => {
  loadLevel(level.random ? save.data.level : Math.min(save.data.unlocked, level.number + 1));
});
$('winReplay').addEventListener('click', restartLevel);
$('winNext').addEventListener('click', () => {
  if (level.random) loadLevel(level.number, { random: true });
  else loadLevel(level.number + 1);
});
$('helpBtn').addEventListener('click', () => { ui.help.hidden = false; });
ui.help.addEventListener('click', (e) => {
  if (e.target === ui.help || e.target.hasAttribute('data-close')) {
    ui.help.hidden = true;
    save.data.seenHelp = true;
    save.write();
  }
});

function syncSoundButton() { ui.sound.classList.toggle('muted', !save.data.sound); }
ui.sound.addEventListener('click', () => {
  save.data.sound = !save.data.sound;
  save.write();
  syncSoundButton();
});

window.addEventListener('keydown', (e) => {
  if (!ui.help.hidden) {
    if (e.key === 'Escape' || e.key === 'Enter') ui.help.querySelector('[data-close]').click();
    return;
  }
  if (!ui.win.hidden) {
    if (e.key === 'Enter') $('winNext').click();
    return;
  }
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); undo(); return; }
  if (key === 'r' || key === ' ') { e.preventDefault(); rotateHeld(); }
  else if (key === 'escape') cancelHold();
  else if (key === 'h') showHint();
  else if (key === 's') toggleSolution();
  else if (key === 'n') ui.random.click();
  else if (key === 'c') resetCamera();
});

// ---------- Boot ----------
renderer.setSize(window.innerWidth, window.innerHeight, false);
syncSoundButton();
loadLevel(Math.min(save.data.level, save.data.unlocked));
animate();
$('loading').classList.add('done');
if (!save.data.seenHelp) ui.help.hidden = false;

// Debug hook for automated testing: open with ?debug
if (new URLSearchParams(location.search).has('debug')) {
  window.__puzzle = {
    get pieces() { return pieces; },
    get won() { return won; },
    // Screen position (CSS px) of a world point.
    toScreen(x, y, z) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
    },
  };
}
