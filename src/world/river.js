// River definition: centerline, width, depth, flow field and in-river boulders.
// The river runs from north (-Z, upstream) to south (+Z, downstream).
import { mulberry32, smoothstep, clamp } from '../util/noise.js';

export const PLAY_Z = [-2850, 2850];          // playable stretch along the river
export const WATER_SLOPE = 0.004;              // water surface drops this much per meter downstream

const RAPIDS = [
  { z: 330, w: 85 },
  { z: -640, w: 70 },
  { z: -2480, w: 120 },   // the northern gorge
];
// Gorges: rock walls rise from the banks (h metres) and squeeze the river.
const GORGES = [
  { z: -2480, w: 230, h: 46 },
  { z: -640, w: 95, h: 12 },
  { z: 330, w: 110, h: 9 },
];
// The lake: the valley floods into a wide, deep, slow lake.
export const LAKE = { z0: 1250, z1: 1600, z2: 1980, z3: 2320 };

export function lakeMask(z) {
  return smoothstep(LAKE.z0, LAKE.z1, z) * (1 - smoothstep(LAKE.z2, LAKE.z3, z));
}
// 0..1 gorge strength and wall height at z
export function gorge(z) {
  let g = 0, h = 0;
  for (const G of GORGES) { const t = (z - G.z) / G.w; const k = Math.exp(-t * t * 2.4); if (k > g) { g = k; h = G.h; } }
  return { g, h };
}

export function centerX(z) {
  return 95 * Math.sin(z * 0.0021 + 0.5) + 38 * Math.sin(z * 0.0057 + 2.0) + 10 * Math.sin(z * 0.013 + 0.3);
}
export function centerSlope(z) {
  return 95 * 0.0021 * Math.cos(z * 0.0021 + 0.5) + 38 * 0.0057 * Math.cos(z * 0.0057 + 2.0) + 10 * 0.013 * Math.cos(z * 0.013 + 0.3);
}
export function rapids(z) {
  let r = 0;
  for (const R of RAPIDS) { const t = (z - R.z) / R.w; r = Math.max(r, Math.exp(-t * t * 2.2)); }
  return r;
}
export function halfWidth(z) {
  const lk = lakeMask(z);
  return 40 + 9 * Math.sin(z * 0.0031 + 1.3) + 5 * Math.sin(z * 0.0091) - 9 * rapids(z) - 9 * gorge(z).g
    + lk * (175 + 28 * Math.sin(z * 0.011 + 0.6) + 14 * Math.sin(z * 0.027));
}
export function waterY(z) {
  return -WATER_SLOPE * z;
}
export function maxDepth(z) {
  const river = (3.6 + 1.4 * Math.sin(z * 0.0043 + 0.7) + 0.6 * Math.sin(z * 0.011)) * (1 - 0.45 * rapids(z));
  return river + (15 - river) * lakeMask(z);
}
export function flowMax(z) {
  return 2.1 * (40 / halfWidth(z)) + 2.2 * rapids(z);
}

// Vertical wave displacement, identical to the water vertex shader (water.js) so boats and floats ride
// exactly the surface you see. S = lobby wave scale (1 = normal), n = lateral position, depth = water depth.
export function riverWave(x, z, t, S, rp, n, depth) {
  let w = (Math.sin(z * 0.9 + x * 0.3 - t * 2.1) * 0.03 + Math.sin(z * 0.37 - x * 0.55 + t * 1.3) * 0.04) * S;
  const S2 = Math.max(S - 1, 0);
  if (S2 > 0) w += S2 * (Math.sin(z * 0.11 + x * 0.05 - t * 0.9) * 0.28 + Math.sin(z * 0.071 - x * 0.13 + t * 0.7) * 0.22 + Math.sin(x * 0.09 + z * 0.03 - t * 1.1) * 0.12);
  const lat = 1 - smoothstep(0.3, 1.0, Math.abs(n));
  w += rp * (Math.sin(z * 1.6 + Math.sin(x * 0.7) * 1.5) * 0.18 + Math.sin(x * 2.1 + z * 0.8 + t * 3.0) * 0.08) * lat * Math.min(1.5, 0.4 + S * 0.6);
  const shore = 1 - smoothstep(0.05, 0.5, depth);
  return w * (1 - shore);
}

// Signed lateral distance from the centerline (meters, + = east/+X side) and normalized distance.
export function riverCoords(x, z, out = {}) {
  const s = centerSlope(z);
  const inv = 1 / Math.sqrt(1 + s * s);
  out.d = (x - centerX(z)) * inv;
  out.hw = halfWidth(z);
  out.n = out.d / out.hw;
  out.tx = s * inv;   // downstream tangent
  out.tz = inv;
  return out;
}

// Depth profile below the water surface at normalized lateral position n (outer bends are deeper).
export function depthAt(x, z) {
  const c = riverCoords(x, z, _rc);
  if (Math.abs(c.n) >= 1) return 0;
  const curv = clamp(centerSlope(z + 20) - centerSlope(z - 20), -0.6, 0.6) * (1 - lakeMask(z));
  const nn = c.n - curv * 0.35;               // shift thalweg toward outer bank
  // lakes shelve quickly then flatten out; rivers have a rounder profile
  const prof = Math.pow(Math.max(0, 1 - nn * nn), 0.75 - 0.45 * lakeMask(z));
  return maxDepth(z) * prof;
}
const _rc = {};

// Surface flow velocity (m/s) at a point. Returns {x, z, speed}.
export function flowAt(x, z, out = {}) {
  const c = riverCoords(x, z, _rc2);
  const n = Math.min(1, Math.abs(c.n));
  const speed = flowMax(z) * Math.pow(Math.max(0, 1 - n * n), 0.45);
  out.x = c.tx * speed;
  out.z = c.tz * speed;
  out.speed = speed;
  return out;
}
const _rc2 = {};

// Boulders that sit in the river (collision + foam wakes). Deterministic.
export const riverRocks = (() => {
  const rnd = mulberry32(777);
  const rocks = [];
  const tryAdd = (z, n, r) => {
    const hw = halfWidth(z);
    const d = n * hw;
    const s = centerSlope(z);
    const inv = 1 / Math.sqrt(1 + s * s);
    const x = centerX(z) + d / inv;
    for (const o of rocks) if ((o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + r + 4) ** 2) return;
    rocks.push({ x, z, r, n, top: 0.35 + rnd() * 0.9 });
  };
  for (const R of RAPIDS) {
    for (let i = 0; i < 26; i++) {
      const z = R.z + (rnd() - 0.5) * R.w * 1.6;
      // keep a navigable lane near the centre
      let n = (rnd() * 2 - 1) * 0.92;
      if (Math.abs(n) < 0.22) n = Math.sign(n || 1) * (0.22 + rnd() * 0.2);
      tryAdd(z, n, 0.7 + rnd() * 1.6);
    }
  }
  for (let i = 0; i < 150; i++) {
    const z = PLAY_Z[0] + rnd() * (PLAY_Z[1] - PLAY_Z[0]);
    const side = rnd() < 0.5 ? -1 : 1;
    if (lakeMask(z) > 0.05) { if (rnd() < 0.7) continue; tryAdd(z, side * (0.9 + rnd() * 0.07), 0.6 + rnd() * 1.6); continue; }
    tryAdd(z, side * (0.55 + rnd() * 0.4), 0.5 + rnd() * 1.4);
  }
  return rocks;
})();

// Structure attractiveness for fish (pools, rock eddies, slack water near banks).
export function habitat(x, z, depth) {
  let rockNear = 0;
  for (const r of riverRocks) {
    const dx = x - r.x, dz = z - r.z;
    if (Math.abs(dz) > 30) continue;
    const dd = Math.sqrt(dx * dx + dz * dz);
    // eddy just downstream (+z) of a rock
    const down = dz > 0 ? 1 : 0.4;
    rockNear = Math.max(rockNear, down * Math.exp(-Math.max(0, dd - r.r) / 6));
  }
  const c = riverCoords(x, z, _rc3);
  const pool = smoothstep(2.5, 5, depth ?? maxDepth(z));
  const seam = Math.exp(-((Math.abs(c.n) - 0.6) ** 2) / 0.04); // current seams
  return { rock: rockNear, pool, seam, rapids: rapids(z), n: c.n };
}
const _rc3 = {};

// ---------------------------------------------------------------- lake islands
// ISLANDS: [{ x, z, r, h }]  (h = crown height above the water)
export const ISLANDS = [
  { x: centerX(1720) + 55, z: 1720, r: 36, h: 7.5 },
  { x: centerX(1880) - 95, z: 1880, r: 19, h: 4 },
];

// ---------------------------------------------------------------- calm side rivers
// TRIBUTARIES: [{ name, points: [{x, z}], halfWidth: [m per point], pond: {x, z, r} }]
// Each leaves the main river and winds into its own side valley, ending in a pond. No current.
// The water surface follows the same waterY(z) as everything else, so it's flat along the channel.
export const TRIBUTARIES = [];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function makeTributary(name, z0, side, ctrl, pond, hw) {
  // ctrl: [dx, dz] offsets (dx away from the river) from the main river's bank point at z0
  const s = centerSlope(z0);
  const bank = { x: centerX(z0) + side * halfWidth(z0) * 0.7 * Math.sqrt(1 + s * s), z: z0 };
  const P = [bank, ...ctrl.map(([dx, dz]) => ({ x: bank.x + side * dx, z: bank.z + dz }))];
  const pts = [], widths = [];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[Math.max(0, i - 1)], b = P[i], c = P[i + 1], d = P[Math.min(P.length - 1, i + 2)];
    const len = Math.hypot(c.x - b.x, c.z - b.z);
    const n = Math.max(2, Math.ceil(len / 3));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      pts.push({ x: catmull(a.x, b.x, c.x, d.x, t), z: catmull(a.z, b.z, c.z, d.z, t) });
    }
  }
  pts.push(P[P.length - 1]);
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    widths.push(hw * (1 + 0.25 * Math.sin(t * 17.3) + 0.15 * Math.sin(t * 41)) * (t < 0.08 ? 1.6 - t / 0.08 * 0.6 : 1));
  }
  const end = pts[pts.length - 1];
  const tr = { name, points: pts, halfWidth: widths, pond: { x: end.x + side * pond.dx, z: end.z + pond.dz, r: pond.r }, depth: 2.4, pondDepth: 5 };
  TRIBUTARIES.push(tr);
  return tr;
}

makeTributary('Gletscherbach-Altwasser', -1660, 1,
  [[60, 10], [150, -40], [260, -30], [360, -95], [450, -120]], { dx: 55, dz: -20, r: 58 }, 12);
makeTributary('Giessen', 880, -1,
  [[70, 25], [170, -10], [280, 45], [390, 20], [470, 70]], { dx: 50, dz: 25, r: 46 }, 11);

// Signed-distance grids (distance beyond the tributary bank, negative inside) for fast queries.
const TG = TRIBUTARIES.map((tr) => {
  const R = 700, cell = 8;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of tr.points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  x0 = Math.min(x0, tr.pond.x - tr.pond.r) - R; x1 = Math.max(x1, tr.pond.x + tr.pond.r) + R;
  z0 = Math.min(z0, tr.pond.z - tr.pond.r) - R; z1 = Math.max(z1, tr.pond.z + tr.pond.r) + R;
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  // samples: channel points + the pond as one big circle
  const sx = [], sz = [], sh = [], sd = [];
  for (let i = 0; i < tr.points.length; i++) { sx.push(tr.points[i].x); sz.push(tr.points[i].z); sh.push(tr.halfWidth[i]); sd.push(tr.depth); }
  sx.push(tr.pond.x); sz.push(tr.pond.z); sh.push(tr.pond.r); sd.push(tr.pondDepth);
  const dist = new Float32Array(nx * nz), dep = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell;
      let best = Infinity, bd = 0;
      for (let k = 0; k < sx.length; k++) {
        const dx = x - sx[k], dz = z - sz[k];
        const e = Math.sqrt(dx * dx + dz * dz) - sh[k];
        if (e < best) { best = e; bd = sd[k]; }
      }
      dist[j * nx + i] = best; dep[j * nx + i] = bd;
    }
  }
  return { x0, z0, nx, nz, cell, dist, dep };
});

// Nearest side water: sd = metres beyond its bank (negative = in the water), D = its max depth.
export function sideWater(x, z, out = {}) {
  out.sd = Infinity; out.D = 0;
  for (const g of TG) {
    const fx = (x - g.x0) / g.cell, fz = (z - g.z0) / g.cell;
    if (fx < 0 || fz < 0 || fx >= g.nx - 1 || fz >= g.nz - 1) continue;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const k = j * g.nx + i;
    const a = g.dist[k], b = g.dist[k + 1], c = g.dist[k + g.nx], d = g.dist[k + g.nx + 1];
    const v = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
    if (v < out.sd) { out.sd = v; out.D = g.dep[k]; }
  }
  return out;
}
