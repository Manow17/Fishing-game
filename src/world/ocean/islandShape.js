// "Isola" — the analytic shape of the ocean map: island, harbour, reef, shelf, drop-off and deep sea.
// Coordinates: metres, +x east, +z south (the minimap is north-up with -z at the top), sea level y = 0.
// sampleIsland() is only used while baking the height grids (oceanTerrain.js); the game reads the grids.
// No three.js import so it can be previewed / tested in node.
import { Simplex2, smoothstep, clamp } from '../../util/noise.js';

const nWarp = new Simplex2(101), nCoast = new Simplex2(202), nHill = new Simplex2(303);
const nRug = new Simplex2(404), nSea = new Simplex2(505), nReef = new Simplex2(606), nMisc = new Simplex2(707);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- key places
export const PLACES = {
  center: { x: -40, z: 0 },
  // harbour basin (water), quay along its west edge, mole closing the east side
  basin: { x0: 652, x1: 764, z0: -8, z1: 104, r: 12 },
  quayY: 0.8,
  mole: { pts: [[728, -24], [781, -24], [781, 74]], top: 2.0, half: 3.6 },
  dock: { x: 652, z: 50, yaw: Math.PI / 2, len: 14 },
  lighthouse: { x: -936, z: 168 },
  cove: { x: -60, z: 655 },
  peak: { x: -170, z: -235 },
  chapel: { x: 330, z: -150 },
  seamount: { x: 2550, z: -1550 },
  reefSector: [1.85, 2.75],          // polar angle (atan2(z, x) around center) of the fringing reef
  stacks: [
    { x: -1132, z: 238, r: 15, h: 24 }, { x: -1082, z: 312, r: 9, h: 13 }, { x: -1185, z: 120, r: 7, h: 9 },
    { x: -262, z: -668, r: 19, h: 31 }, { x: 128, z: -652, r: 11, h: 15 }, { x: -340, z: -700, r: 7, h: 8 },
  ],
};

// ---------------------------------------------------------------- SDF helpers (negative inside)
const circle = (x, z, cx, cz, r) => Math.hypot(x - cx, z - cz) - r;
function capsule(x, z, ax, az, bx, bz, r) {
  const px = x - ax, pz = z - az, vx = bx - ax, vz = bz - az;
  const h = clamp((px * vx + pz * vz) / (vx * vx + vz * vz), 0, 1);
  return Math.hypot(px - vx * h, pz - vz * h) - r;
}
function roundBox(x, z, cx, cz, hx, hz, r) {
  const qx = Math.abs(x - cx) - hx + r, qz = Math.abs(z - cz) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
const smax = (a, b, k) => -smin(-a, -b, k);

// Distance to the breakwater's centre line
export function moleDist(x, z) {
  const P = PLACES.mole.pts;
  let d = Infinity;
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, az] = P[i], [bx, bz] = P[i + 1];
    d = Math.min(d, capsule(x, z, ax, az, bx, bz, 0));
  }
  return d;
}

// Harbour basin outline (also used for the quay walls)
export function basinSDF(x, z) {
  const B = PLACES.basin;
  return roundBox(x, z, (B.x0 + B.x1) / 2, (B.z0 + B.z1) / 2, (B.x1 - B.x0) / 2, (B.z1 - B.z0) / 2, B.r);
}

// Signed distance to the coastline (negative on land), before the harbour edits
function naturalSDF(x, z) {
  const wx = x + 75 * nWarp.noise(x * 0.0015, z * 0.0015) + 24 * nWarp.noise(x * 0.0062 + 3.1, z * 0.0062);
  const wz = z + 75 * nWarp.noise(x * 0.0015 + 7.3, z * 0.0015 - 2.1) + 24 * nWarp.noise(x * 0.0062 - 5.2, z * 0.0062 + 1.7);
  let d = circle(wx, wz, -120, -10, 545);
  d = smin(d, circle(wx, wz, 420, 40, 330), 190);
  d = smin(d, capsule(wx, wz, -430, 70, -940, 168, 118), 150);      // west headland (lighthouse)
  d = smin(d, capsule(wx, wz, -420, -230, 250, -300, 255), 170);    // north ridge
  d = smax(d, -circle(wx, wz, -60, 640, 290), 80);                    // south cove
  return d;
}

const HARB = { x0: 600, x1: 800, z0: -50, z1: 140 };
function harbourWeight(x, z) {
  // 1 inside the harbour works, fading over 60 m
  const dx = Math.max(HARB.x0 - x, 0, x - HARB.x1), dz = Math.max(HARB.z0 - z, 0, z - HARB.z1);
  return 1 - smoothstep(0, 60, Math.hypot(dx, dz));
}

export function coastSDF(x, z) {
  let d = naturalSDF(x, z);
  const hw = harbourWeight(x, z);
  if (hw < 1 && d < 140 && d > -140) d += (1 - hw) * (1 - smoothstep(100, 140, Math.abs(d))) * (15 * nCoast.fbm(x * 0.011, z * 0.011, 3) + 4.5 * nCoast.noise(x * 0.045, z * 0.045));
  if (hw > 0) {
    // a little land around the basin so the quay has room; the mole is a ridge on the sea floor
    const h = Math.min(roundBox(x, z, 690, -30, 62, 22, 14), roundBox(x, z, 690, 126, 58, 24, 16), roundBox(x, z, 630, 48, 24, 92, 12));
    d = smin(d, h, 26);
    d = smax(d, -basinSDF(x, z), 3);
    d = smax(d, -roundBox(x, z, 790, 92, 34, 16, 6), 3);           // harbour mouth (south-east)
  }
  return d;
}

// Distance from shore at which the shelf breaks into deep water, by bearing
function shelfEdge(x, z) {
  const a = Math.atan2(z - PLACES.center.z, x - PLACES.center.x);
  return 960 + 330 * Math.sin(a) + 120 * Math.cos(2 * a + 0.7) + 170 * nSea.noise(x * 0.0009, z * 0.0009);
}

// How cliffy the coast is here (0 = sandy / gentle, 1 = sheer cliffs)
function cliffiness(x, z) {
  const north = smoothstep(-160, -320, z + 70 * nMisc.noise(x * 0.003, 1.3));
  const west = smoothstep(-600, -760, x + 50 * nMisc.noise(2.7, z * 0.004));
  let c = Math.max(north, west);
  c = Math.max(c, 0.55 * smoothstep(0.25, 0.6, nMisc.noise(x * 0.0035 + 9, z * 0.0035)));
  const cove = Math.hypot(x - PLACES.cove.x, z - PLACES.cove.z);
  c *= smoothstep(330, 470, cove);
  c *= 1 - harbourWeight(x, z);
  return c;
}

// Fringing reef south-west of the island: 0..1 sector weight
function reefSector(x, z) {
  const a = Math.atan2(z - PLACES.center.z, x - PLACES.center.x);
  const [a0, a1] = PLACES.reefSector;
  return smoothstep(a0, a0 + 0.18, a) * (1 - smoothstep(a1 - 0.18, a1, a));
}

const _s = { h: 0, pave: 0, reef: 0, sand: 0, cliff: 0, sd: 0 };

// Full sample: ground height and material hints. out.sd = coast SDF (negative on land).
export function sampleIsland(x, z, out = _s) {
  const d = coastSDF(x, z);
  const c = cliffiness(x, z);
  const hw = harbourWeight(x, z);
  let h, pave = 0, reef = 0, sand = 0;
  if (d < 0) {
    // ---------------- land
    const s = -d;
    const beach = 0.048 * Math.min(s, 38) + 0.014 * Math.max(0, s - 38);
    const Hc = 24 + 16 * nRug.noise(x * 0.004, z * 0.004) + 14 * smoothstep(-700, -950, x);
    const cliff = Hc * smoothstep(0, 18, s) + 0.03 * s;
    const coastal = lerp(beach, cliff, c);
    const hill = 58 * Math.pow(smoothstep(25, 460, s), 1.15) * (0.7 + 0.45 * nHill.fbm(x * 0.0021, z * 0.0021, 4));
    const pd = Math.hypot(x - PLACES.peak.x, z - PLACES.peak.z);
    const pk = Math.exp(-Math.pow(pd / 285, 1.55));
    const peak = 182 * pk * smoothstep(15, 140, s);
    // ridges and gullies that sharpen toward the summit
    const crag = 34 * pk * (nRug.ridged(x * 0.0085 + 3.3, z * 0.0085, 4) - 0.38) * smoothstep(30, 200, s);
    const ridge = 46 * Math.exp(-((z + 250 + 0.12 * x) ** 2) / (150 * 150)) * smoothstep(-650, -350, x) * (1 - smoothstep(150, 420, x)) * smoothstep(20, 120, s);
    const rug = (7 + 9 * c) * nRug.ridged(x * 0.0065, z * 0.0065, 4) * smoothstep(15, 90, s);
    const detail = 1.1 * nRug.fbm(x * 0.03, z * 0.03, 3) * smoothstep(4, 30, s);
    h = coastal + hill + peak + crag + ridge + rug + detail;
    sand = (1 - c) * (1 - smoothstep(26, 50, s + 10 * nMisc.noise(x * 0.02, z * 0.02)));
    if (hw > 0) {
      // harbour: flat quay paving and arms, the village slope rises behind
      const q = PLACES.quayY;
      // paved quay: a 16 m strip along the west and north edges of the basin
      const bd = basinSDF(x, z);
      const quay = 1 - smoothstep(13, 19, bd);
      const flat = quay * hw;
      h = lerp(Math.max(h, q * hw), q + 0.08 * nMisc.noise(x * 0.1, z * 0.1), flat);
      h = Math.max(h, q * smoothstep(0, 6, s) * hw);
      pave = quay * hw;
      sand *= 1 - hw;
    }
  } else {
    // ---------------- sea floor
    const o = d;
    const Dn = lerp(11, 26, c), slope0 = lerp(0.055, 0.75, c);
    let depth = Dn * (1 - Math.exp(-o * slope0 / Dn)) + 0.022 * o;
    const E = shelfEdge(x, z);
    depth += 255 * smoothstep(E - 90, E + 260, o) + 0.07 * Math.max(0, o - E - 260);
    depth += (2.2 + 4 * c) * nSea.fbm(x * 0.009, z * 0.009, 3) * smoothstep(3, 25, depth);
    if (c > 0.01 && o < 160) depth += 4.5 * c * nRug.ridged(x * 0.02, z * 0.02, 3) * (1 - smoothstep(40, 160, o));  // boulder fields under cliffs
    // offshore seamount: a pinnacle rising to ~16 m
    const sm = Math.hypot(x - PLACES.seamount.x, z - PLACES.seamount.z);
    if (sm < 900) {
      const top = 16 + 3 * nSea.noise(x * 0.02, z * 0.02);
      const mound = top + (depth - top) * smoothstep(60, 620, sm + 60 * nSea.noise(x * 0.004, z * 0.004));
      depth = Math.min(depth, mound);
      reef = Math.max(reef, 1 - smoothstep(80, 260, sm));
    }
    depth = Math.min(depth, 950);
    // fringing reef with a lagoon behind its crest
    const rs = reefSector(x, z);
    if (rs > 0 && o < 520) {
      const crestO = 300 + 45 * nReef.noise(x * 0.004, z * 0.004);
      const lag = 3.2 + 1.6 * nReef.fbm(x * 0.012, z * 0.012, 2);
      const lagoonW = smoothstep(25, 90, o) * (1 - smoothstep(crestO - 10, crestO + 25, o));
      let rd = lerp(depth, Math.min(depth, lag), lagoonW * rs);
      const crest = Math.exp(-(((o - crestO) / 26) ** 2)) * rs;
      const top = 0.75 + 0.6 * nReef.noise(x * 0.03, z * 0.03);
      rd = lerp(rd, Math.min(rd, top), crest);
      // coral heads (bommies) in the lagoon
      const bm = smoothstep(0.42, 0.7, nReef.noise(x * 0.025 + 4, z * 0.025)) * lagoonW * rs;
      rd -= bm * 1.8;
      // steep outer reef face, then the shelf
      const outer = smoothstep(crestO, crestO + 70, o) * (1 - smoothstep(crestO + 70, crestO + 220, o)) * rs;
      rd = lerp(rd, Math.max(rd, depth), outer * 0.3);
      depth = Math.max(0.5, rd);
      reef = Math.max(reef, rs * Math.max(crest, bm, 0.45 * lagoonW * smoothstep(0.3, 0.6, nReef.noise(x * 0.05, z * 0.05) + 0.3), outer * 0.8));
    }
    // rocky reef patches along the cliffs too
    if (c > 0.01 && o < 140) reef = Math.max(reef, c * (1 - smoothstep(40, 140, o)) * smoothstep(0.1, 0.4, nRug.noise(x * 0.012, z * 0.012) + 0.2));
    h = -depth;
    // harbour basin: flat sand bottom
    const bs = basinSDF(x, z);
    if (hw > 0 && bs < 40) {
      const k = (1 - smoothstep(0, 40, bs)) * hw;
      h = lerp(h, -5.4 + 0.25 * nSea.noise(x * 0.05, z * 0.05), k);
    }
    sand = 1 - c * 0.7;
  }
  // the mole: a rubble breakwater ridge with a flat top closing the east side of the basin
  {
    const dd = moleDist(x, z);
    const M = PLACES.mole;
    if (dd < 22) {
      const prof = M.top + 0.06 * nMisc.noise(x * 0.2, z * 0.2) - Math.max(0, dd - M.half) * 1.25;
      if (prof > h) { h = prof; pave = Math.max(pave, 1 - smoothstep(M.half - 0.8, M.half + 0.6, dd)); sand = 0; }
    }
  }
  // sea stacks
  for (const S of PLACES.stacks) {
    const sd = Math.hypot(x - S.x, z - S.z);
    if (sd > S.r * 3) continue;
    const k = 1 - smoothstep(S.r * 0.75, S.r * 1.35, sd + 3 * nRug.noise(x * 0.08, z * 0.08));
    const top = S.h * (0.85 + 0.15 * nRug.noise(x * 0.05, z * 0.05)) - Math.max(0, sd - S.r * 0.4) * 0.4;
    h = Math.max(h, lerp(h, top, k));
  }
  out.h = h; out.pave = clamp(pave, 0, 1); out.reef = clamp(reef, 0, 1); out.sand = clamp(sand, 0, 1); out.cliff = c; out.sd = d;
  return out;
}
