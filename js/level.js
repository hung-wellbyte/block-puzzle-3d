// Level generation: places the 3 fixed obstacle blocks, then partitions the
// remaining cells into rectangles. Because the player pieces are cut from an
// actual tiling, every generated level is guaranteed to be solvable.

export const BOARD_SIZE = 8;

// [w, h] — w spans columns (x), h spans rows (z)
const FIXED_SHAPES = [[1, 1], [1, 2], [1, 3]];
const MAX_SIDE = 4;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Weights are per rectangle shape, keyed by area. Later levels favour smaller
// pieces, which means more pieces and a harder search for the player.
function difficultyFor(level) {
  if (level <= 3) return { weights: { 2: 0.3, 3: 0.9, 4: 1.4, 6: 1.6, 8: 1.0 }, target: [9, 12] };
  if (level <= 8) return { weights: { 2: 0.7, 3: 1.2, 4: 1.5, 6: 1.1, 8: 0.4 }, target: [12, 15] };
  return { weights: { 2: 1.1, 3: 1.5, 4: 1.4, 6: 0.7, 8: 0.15 }, target: [15, 18] };
}

function emptyGrid() {
  return Array.from({ length: BOARD_SIZE }, () => new Array(BOARD_SIZE).fill(false));
}

function rectFree(grid, c, r, w, h) {
  if (c < 0 || r < 0 || c + w > BOARD_SIZE || r + h > BOARD_SIZE) return false;
  for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (grid[y][x]) return false;
  return true;
}

function fillRect(grid, c, r, w, h) {
  for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) grid[y][x] = true;
}

// Fixed blocks must not touch each other (not even diagonally) so they spread
// across the board; that constraint is dropped if it can't be satisfied.
function placeFixed(rng, grid) {
  const fixed = [];
  const halo = emptyGrid();
  for (const [sw, sh] of FIXED_SHAPES) {
    const [w, h] = rng() < 0.5 ? [sw, sh] : [sh, sw];
    let placed = false;
    for (let attempt = 0; attempt < 400 && !placed; attempt++) {
      const c = Math.floor(rng() * (BOARD_SIZE - w + 1));
      const r = Math.floor(rng() * (BOARD_SIZE - h + 1));
      if (!rectFree(grid, c, r, w, h)) continue;
      if (attempt < 300 && !rectFree(halo, c, r, w, h)) continue;
      fillRect(grid, c, r, w, h);
      for (let y = r - 1; y <= r + h; y++)
        for (let x = c - 1; x <= c + w; x++)
          if (x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE) halo[y][x] = true;
      fixed.push({ c, r, w, h });
      placed = true;
    }
  }
  return fixed;
}

function partition(rng, grid, weights) {
  const g = grid.map((row) => row.slice());
  const parts = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (g[r][c]) continue;
      const cands = [];
      for (let h = 1; h <= MAX_SIDE; h++) {
        for (let w = 1; w <= MAX_SIDE; w++) {
          const area = w * h;
          const wt = area === 1 ? 0.0001 : weights[area];
          if (!wt || !rectFree(g, c, r, w, h)) continue;
          cands.push({ w, h, wt });
        }
      }
      const total = cands.reduce((s, k) => s + k.wt, 0);
      let pick = rng() * total;
      let chosen = cands[cands.length - 1];
      for (const k of cands) {
        pick -= k.wt;
        if (pick <= 0) { chosen = k; break; }
      }
      fillRect(g, c, r, chosen.w, chosen.h);
      parts.push({ c, r, w: chosen.w, h: chosen.h });
    }
  }
  return parts;
}

function score(parts, target) {
  const singles = parts.filter((p) => p.w * p.h === 1).length;
  const n = parts.length;
  const off = n < target[0] ? target[0] - n : n > target[1] ? n - target[1] : 0;
  return singles * 10 + off * 2;
}

export function generateLevel(seed, level) {
  const rng = mulberry32(seed);
  const { weights, target } = difficultyFor(level);
  let best = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    const grid = emptyGrid();
    const fixed = placeFixed(rng, grid);
    if (fixed.length !== FIXED_SHAPES.length) continue;
    const parts = partition(rng, grid, weights);
    const s = score(parts, target);
    if (!best || s < best.s) best = { s, fixed, parts };
    if (s === 0) break;
  }
  const pieces = best.parts
    .map((p) => ({ w: Math.max(p.w, p.h), h: Math.min(p.w, p.h), solution: p }))
    .sort((a, b) => b.w * b.h - a.w * a.h || b.w - a.w);
  return { fixed: best.fixed, pieces };
}
