// Level generation for the Mondrian-style set: 3 fixed black blocks plus a
// fixed set of 8 coloured blocks that exactly cover the remaining 58 cells.
// A level is made by randomly tiling the whole board with all 11 blocks, then
// keeping the black blocks where they landed — so every level is solvable.
// A solver counts how many solutions a black placement allows; fewer
// solutions means a harder level.

export const BOARD_SIZE = 8;

// [w, h] — w spans columns (x), h spans rows (z)
export const FIXED_SHAPES = [[1, 1], [1, 2], [1, 3]];
export const PLAYER_SHAPES = [[3, 4], [2, 5], [2, 4], [3, 3], [2, 3], [1, 5], [1, 4], [2, 2]];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const orientations = ([w, h]) => (w === h ? [[w, h]] : [[w, h], [h, w]]);

function emptyGrid() {
  return Array.from({ length: BOARD_SIZE }, () => new Array(BOARD_SIZE).fill(false));
}

function rectFree(grid, c, r, w, h) {
  if (c + w > BOARD_SIZE || r + h > BOARD_SIZE) return false;
  for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (grid[y][x]) return false;
  return true;
}

function setRect(grid, c, r, w, h, v) {
  for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) grid[y][x] = v;
}

function firstEmpty(grid) {
  for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) if (!grid[r][c]) return [c, r];
  return null;
}

// Covers the board with every shape exactly once. The first empty cell in
// row-major order must be the top-left corner of whichever block covers it.
function randomTiling(rng, shapes) {
  const grid = emptyGrid();
  const used = new Array(shapes.length).fill(false);
  const out = new Array(shapes.length);
  const rec = () => {
    const cell = firstEmpty(grid);
    if (!cell) return true;
    const [c, r] = cell;
    for (const i of shuffle(rng, shapes.map((_, k) => k))) {
      if (used[i]) continue;
      for (const [w, h] of shuffle(rng, orientations(shapes[i]))) {
        if (!rectFree(grid, c, r, w, h)) continue;
        setRect(grid, c, r, w, h, true);
        used[i] = true;
        out[i] = { c, r, w, h };
        if (rec()) return true;
        used[i] = false;
        setRect(grid, c, r, w, h, false);
      }
    }
    return false;
  };
  return rec() ? out : null;
}

// Number of ways to place PLAYER_SHAPES around the given fixed blocks, up to `limit`.
export function countSolutions(fixed, limit = 50) {
  const grid = emptyGrid();
  for (const f of fixed) setRect(grid, f.c, f.r, f.w, f.h, true);
  const used = new Array(PLAYER_SHAPES.length).fill(false);
  let count = 0;
  const rec = () => {
    const cell = firstEmpty(grid);
    if (!cell) { count++; return; }
    const [c, r] = cell;
    for (let i = 0; i < PLAYER_SHAPES.length && count < limit; i++) {
      if (used[i]) continue;
      for (const [w, h] of orientations(PLAYER_SHAPES[i])) {
        if (!rectFree(grid, c, r, w, h)) continue;
        setRect(grid, c, r, w, h, true);
        used[i] = true;
        rec();
        used[i] = false;
        setRect(grid, c, r, w, h, false);
        if (count >= limit) return;
      }
    }
  };
  rec();
  return count;
}

// Accepted solution-count range per level; harder levels allow fewer solutions.
function difficultyFor(level) {
  if (level <= 3) return [8, Infinity];
  if (level <= 7) return [3, 7];
  if (level <= 12) return [2, 2];
  return [1, 1];
}

export function generateLevel(seed, level) {
  const rng = mulberry32(seed);
  const [lo, hi] = difficultyFor(level);
  const shapes = [...FIXED_SHAPES, ...PLAYER_SHAPES];
  let best = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    const tiling = randomTiling(rng, shapes);
    if (!tiling) continue;
    const fixed = tiling.slice(0, FIXED_SHAPES.length);
    const solutions = countSolutions(fixed, Math.min(hi, 50) + 1);
    const miss = solutions < lo ? lo - solutions : solutions > hi ? solutions - hi : 0;
    if (!best || miss < best.miss) best = { miss, tiling, solutions };
    if (miss === 0) break;
  }
  const { tiling, solutions } = best;
  const pieces = PLAYER_SHAPES.map(([w, h], i) => ({
    w: Math.max(w, h), h: Math.min(w, h), solution: tiling[FIXED_SHAPES.length + i],
  }));
  return { fixed: tiling.slice(0, FIXED_SHAPES.length), pieces, solutions };
}
