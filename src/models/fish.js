// Alpenfisch — procedurally modelled fish of Swiss rivers and lakes, and of the open ocean.
//
// Everything (geometry, colour/normal/roughness maps, fin atlas, eyes) is generated
// procedurally once per species (cached, unit length) and shared between instances.
// Per instance only materials + a small uniform block are created; the vertex
// shader animates swimming / turning / struggling / fin fanning on the GPU.
// Swimming style (body-wave envelope, rigid bill, struggle strength / tempo) is per
// species but lives in uniforms, so every fish still shares the same shader programs.
//
// Local frame: nose +Z, dorsal +Y, fish's left side +X. Origin = mid-length, mid-height.
import * as THREE from 'three';

export const FRESHWATER_SPECIES = ['brownTrout', 'rainbowTrout', 'grayling', 'arcticChar', 'pike', 'perch', 'huchen', 'whitefish', 'barbel', 'chub'];
export const OCEAN_SPECIES = ['greatWhite', 'hammerhead', 'mako', 'blueMarlin', 'swordfish', 'bluefinTuna', 'yellowfinTuna', 'mahiMahi', 'giantGrouper', 'barracuda'];
export const FISH_SPECIES = [...FRESHWATER_SPECIES, ...OCEAN_SPECIES];

export const FISH_INFO = {
  brownTrout:   { name: 'Brown Trout',    localName: 'Bachforelle',       latin: 'Salmo trutta fario',  sizeRange: [0.25, 0.65] },
  rainbowTrout: { name: 'Rainbow Trout',  localName: 'Regenbogenforelle', latin: 'Oncorhynchus mykiss', sizeRange: [0.25, 0.6] },
  grayling:     { name: 'Grayling',       localName: 'Äsche',             latin: 'Thymallus thymallus', sizeRange: [0.25, 0.5] },
  arcticChar:   { name: 'Arctic Char',    localName: 'Seesaibling',       latin: 'Salvelinus umbla',    sizeRange: [0.22, 0.5] },
  pike:         { name: 'Northern Pike',  localName: 'Hecht',             latin: 'Esox lucius',         sizeRange: [0.45, 1.2] },
  perch:        { name: 'European Perch', localName: 'Egli',              latin: 'Perca fluviatilis',   sizeRange: [0.15, 0.4] },
  huchen:       { name: 'Huchen',         localName: 'Huchen',            latin: 'Hucho hucho',         sizeRange: [0.6, 1.3] },
  whitefish:    { name: 'Whitefish',      localName: 'Felchen',           latin: 'Coregonus sp.',       sizeRange: [0.25, 0.5] },
  barbel:       { name: 'Barbel',         localName: 'Barbe',             latin: 'Barbus barbus',       sizeRange: [0.3, 0.8] },
  chub:         { name: 'Chub',           localName: 'Alet',              latin: 'Squalius cephalus',   sizeRange: [0.25, 0.6] },
  // open ocean
  greatWhite:    { name: 'Great White Shark',      localName: 'Weißer Hai',          latin: 'Carcharodon carcharias', sizeRange: [2.5, 5.5] },
  hammerhead:    { name: 'Great Hammerhead',       localName: 'Großer Hammerhai',    latin: 'Sphyrna mokarran',       sizeRange: [2, 5] },
  mako:          { name: 'Shortfin Mako',          localName: 'Kurzflossen-Mako',    latin: 'Isurus oxyrinchus',      sizeRange: [1.8, 3.8] },
  blueMarlin:    { name: 'Blue Marlin',            localName: 'Blauer Marlin',       latin: 'Makaira nigricans',      sizeRange: [2, 4.3] },
  swordfish:     { name: 'Swordfish',              localName: 'Schwertfisch',        latin: 'Xiphias gladius',        sizeRange: [1.8, 4] },
  bluefinTuna:   { name: 'Atlantic Bluefin Tuna',  localName: 'Roter Thun',          latin: 'Thunnus thynnus',        sizeRange: [1.2, 3] },
  yellowfinTuna: { name: 'Yellowfin Tuna',         localName: 'Gelbflossen-Thun',    latin: 'Thunnus albacares',      sizeRange: [0.8, 2.2] },
  mahiMahi:      { name: 'Mahi-mahi',              localName: 'Goldmakrele',         latin: 'Coryphaena hippurus',    sizeRange: [0.6, 1.6] },
  giantGrouper:  { name: 'Goliath Grouper',        localName: 'Goliath-Zackenbarsch', latin: 'Epinephelus itajara',   sizeRange: [1, 2.5] },
  barracuda:     { name: 'Great Barracuda',        localName: 'Großer Barrakuda',    latin: 'Sphyraena barracuda',    sizeRange: [0.6, 1.8] },
};

// ---------------------------------------------------------------------------
// small math helpers
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2, DEG = Math.PI / 180;
const V3 = THREE.Vector3;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function mulberry(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function hash2(i, j) {
  let h = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// monotone cubic (Fritsch–Carlson) through [[x,y],...]
function curve(pts) {
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  if (n === 1) return () => ys[0];
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const crv = (v) => (typeof v === 'number' ? () => v : curve(v));
const hexRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (c, a = c[3] ?? 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

function gradLUT(stops, n) {
  const out = new Float32Array(n * 3), cs = stops.map(s => [s[0], hexRGB(s[1])]);
  for (let i = 0; i < n; i++) {
    const v = (i + 0.5) / n;
    let k = 0; while (k < cs.length - 2 && v > cs[k + 1][0]) k++;
    const a = cs[k], b = cs[k + 1];
    const fl = clamp((v - a[0]) / (b[0] - a[0]), 0, 1), f = lerp(fl, fl * fl * (3 - 2 * fl), 0.5);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = lerp(a[1][c], b[1][c], f);
  }
  return out;
}

function makeNoise(seed) {
  const R = mulberry(seed), P = new Uint16Array(512), G = new Float32Array(256);
  for (let i = 0; i < 256; i++) { P[i] = i; G[i] = R(); }
  for (let i = 255; i > 0; i--) { const j = (R() * (i + 1)) | 0; const t = P[i]; P[i] = P[j]; P[j] = t; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const n2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const a = G[P[P[X] + Y]], b = G[P[P[X + 1] + Y]], c = G[P[P[X] + Y + 1]], d = G[P[P[X + 1] + Y + 1]];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
  const fbm = (x, y, o = 3) => { let s = 0, a = 0.5, f = 1, t = 0; for (let i = 0; i < o; i++) { s += a * n2(x * f, y * f); t += a; a *= 0.5; f *= 2.03; } return s / t; };
  return { n2, fbm };
}

function mkCanvas(w, h) {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}
function dataTex(data, w, h, { srgb = false, repeat = false, aniso = 4 } = {}) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso; t.needsUpdate = true;
  return t;
}
function canvasTex(cv, srgb = true) {
  const t = new THREE.CanvasTexture(cv);
  t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// Body shape: profile curves + super-ellipse cross sections.
// t = 0 nose tip ... 1 tail-fin tip (units of total length).  v = 0 dorsal ... 1 ventral
// (arc-length around one flank; both flanks mirrored so there is no UV seam).
// ---------------------------------------------------------------------------
class Shape {
  constructor(d) {
    const P = d.prof;
    this.tail = P[P.length - 1][0];
    this.tipY = P[0][1];
    this.t1 = P[1][0];
    const rest = P.slice(1);
    this.cT = curve(rest.map(r => [r[0], r[1] - this.tipY]));
    this.cB = curve(rest.map(r => [r[0], this.tipY - r[2]]));
    this.cW = curve(rest.map(r => [r[0], r[3]]));
    const pe = (c) => { const v1 = c(this.t1), h = 1e-4, m = (c(this.t1 + h) - v1) / h; return clamp(m * this.t1 / Math.max(v1, 1e-6), 0.3, d.nose ?? 0.55); };
    this.pT = pe(this.cT); this.pB = pe(this.cB); this.pW = pe(this.cW);
    this.nT = crv(d.nT ?? 2); this.nB = crv(d.nB ?? 2); this.wl = crv(d.wl ?? 0.42);
    this.head = d.head ?? 0.1;
  }
  prof(t) {
    let a, b, w;
    if (t < this.t1) {
      const k = Math.max(t, 0) / this.t1;
      a = this.cT(this.t1) * Math.pow(k, this.pT); b = this.cB(this.t1) * Math.pow(k, this.pB); w = this.cW(this.t1) * Math.pow(k, this.pW);
    } else { a = this.cT(t); b = this.cB(t); w = this.cW(t); }
    const hf = 1 + this.head * sstep(0, 0.025, t) * (1 - sstep(0.05, 0.2, t)); // blunter, fuller head
    a *= hf; b *= hf; w *= 1 + (hf - 1) * 0.8;
    return { yT: this.tipY + a, yB: this.tipY - b, w: Math.max(0, w), nT: this.nT(t), nB: this.nB(t), wl: this.wl(t) };
  }
  xy(pr, th) {
    const yW = pr.yB + (pr.yT - pr.yB) * pr.wl;
    const s = Math.max(0, Math.sin(th)), c = Math.cos(th);
    if (c >= 0) { const e = 2 / pr.nT; return [pr.w * Math.pow(s, e), yW + (pr.yT - yW) * Math.pow(c, e)]; }
    const e = 2 / pr.nB; return [pr.w * Math.pow(s, e), yW - (yW - pr.yB) * Math.pow(-c, e)];
  }
  ring(t) {
    const K = 96, pr = this.prof(t);
    const xs = new Float64Array(K + 1), ys = new Float64Array(K + 1), L = new Float64Array(K + 1);
    for (let k = 0; k <= K; k++) {
      const [x, y] = this.xy(pr, Math.PI * k / K); xs[k] = x; ys[k] = y;
      if (k) L[k] = L[k - 1] + Math.hypot(x - xs[k - 1], y - ys[k - 1]);
    }
    const P = L[K];
    const at = (v) => {
      if (P < 1e-9) return [0, ys[0]];
      const tg = clamp(v, 0, 1) * P; let lo = 0, hi = K;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] < tg) lo = m; else hi = m; }
      const f = (tg - L[lo]) / Math.max(L[hi] - L[lo], 1e-12);
      return [lerp(xs[lo], xs[hi], f), lerp(ys[lo], ys[hi], f)];
    };
    const vAt = (y) => {
      if (P < 1e-9) return 0.5;
      if (y >= ys[0]) return 0; if (y <= ys[K]) return 1;
      let lo = 0, hi = K;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ys[m] > y) lo = m; else hi = m; }
      const f = (ys[lo] - y) / Math.max(ys[lo] - ys[hi], 1e-12);
      return lerp(L[lo], L[hi], f) / P;
    };
    // vertex placement that blends arc length with turning angle (m = 0: pure arc length), so
    // sharp keels, blunt hammer tips and flat sword edges get enough vertices. Returns the
    // arc-length fraction v (the texture coordinate) of the q-th placement fraction.
    let M = null;
    const vMix = (q, m) => {
      if (P < 1e-9 || m <= 0) return q;
      if (!M) {
        const tr = new Float64Array(K + 1), dir = (x0, y0, x1, y1) => Math.atan2(y1 - y0, x1 - x0);
        for (let k = 0; k <= K; k++) {
          const xa = k ? xs[k - 1] : -xs[1], ya = k ? ys[k - 1] : ys[1], xb = k < K ? xs[k + 1] : -xs[K - 1], yb = k < K ? ys[k + 1] : ys[K - 1];
          let d = dir(xs[k], ys[k], xb, yb) - dir(xa, ya, xs[k], ys[k]);
          d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
          tr[k] = d;
        }
        const Th = new Float64Array(K + 1);
        for (let k = 1; k <= K; k++) Th[k] = Th[k - 1] + 0.5 * (tr[k - 1] + tr[k]);
        M = new Float64Array(K + 1);
        const T = Math.max(Th[K], 1e-9);
        for (let k = 0; k <= K; k++) M[k] = (1 - m) * L[k] / P + m * Th[k] / T;
      }
      if (q <= 0) return 0; if (q >= 1) return 1;
      let lo = 0, hi = K;
      while (hi - lo > 1) { const mm = (lo + hi) >> 1; if (M[mm] < q) lo = mm; else hi = mm; }
      const f = (q - M[lo]) / Math.max(M[hi] - M[lo], 1e-12);
      return lerp(L[lo], L[hi], f) / P;
    };
    return { pr, P, at, vAt, vMix };
  }
  surf(t, v) { const [x, y] = this.ring(t).at(v); return new V3(x, y, 0.5 - t); }
  normal(t, v) {
    const h = 0.002;
    const a = this.surf(t, Math.min(1, v + h)).sub(this.surf(t, Math.max(0, v - h)));
    const b = this.surf(t + h, v).sub(this.surf(Math.max(0, t - h), v));
    const n = new V3().crossVectors(a, b).normalize();
    const p = this.surf(t, v), pr = this.prof(t), yW = pr.yB + (pr.yT - pr.yB) * pr.wl;
    if (n.x * p.x + n.y * (p.y - yW) < 0) n.negate();
    return n;
  }
}

// ---------------------------------------------------------------------------
// Species definitions. All lengths in units of total length (TL).
//  prof rows: [t, yTop, yBottom, halfWidth]  (row 0 = snout tip)
//  eye: t,v position on the flank, r radius, out = protruding fraction
//  fins: geometry;  fp: fin paint (atlas);  paint(B): body markings
// ---------------------------------------------------------------------------
const SALMONID_SWIM = { k: 6.2, amp: 1, fIdle: 1.0, fMax: 4.6 };

// --- ocean helpers ---------------------------------------------------------
// Sharp countershading: dorsal colour (from grad) above an irregular line, belly colour below.
function counterPix(bound, belly, soft, jag, extra) {
  const vb = curve(bound), bc = hexRGB(belly);
  return (t, v, c, n1, n2 = 0.5) => {
    const b = vb(t) + (n1 - 0.5) * jag + (n2 - 0.5) * jag * 0.18;
    const f = sstep(b - soft, b + soft, v);
    c[0] = lerp(c[0], bc[0], f); c[1] = lerp(c[1], bc[1], f); c[2] = lerp(c[2], bc[2], f);
    if (extra) extra(t, v, c, n1, n2, f);
  };
}
const tintPix = (c, col, k) => { c[0] = lerp(c[0], col[0], k); c[1] = lerp(c[1], col[1], k); c[2] = lerp(c[2], col[2], k); };
// pale healed scratches (sharks, billfish)
function scars(B, n, col = 'rgba(214,218,222,0.3)', t = [0.04, 0.7], v = [0.08, 0.6]) {
  const { R } = B;
  for (let i = 0; i < n; i++) {
    const t0 = lerp(t[0], t[1], R()), v0 = lerp(v[0], v[1], R()), a = lerp(-0.8, 0.8, R()), L = lerp(0.012, 0.055, R()), P = B.P(t0);
    const pts = []; for (let k = 0; k <= 8; k++) { const q = k / 8; pts.push([t0 + L * q * Math.cos(a), v0 + (L * q * Math.sin(a) + 0.0015 * Math.sin(q * 9 + i)) / P]); }
    B.stroke(pts, lerp(0.8, 2, R()), col);
    if (R() < 0.45) B.stroke(pts.map(([tt, vv]) => [tt + 0.0018, vv + 0.006]), lerp(0.6, 1.3, R()), col);
  }
}
// soft skin mottling
function mottle(B, n, t, v, r, dark, light) {
  const { R } = B;
  for (let i = 0; i < n; i++) B.blob(lerp(t[0], t[1], R()), lerp(v[0], v[1], R()), lerp(r[0], r[1], R()), R() < 0.55 ? dark : light, 1, lerp(1.4, 3, R()), R() * 3);
}

// Swim envelopes (see GLSL fishLat): lateral amplitude = env[0] + env[1] t + env[2] t^2 + env[3] max(t - knee, 0)^2
const SHARK_SKIN = { tile: 'skin', nl: 360, nv: 80, nrm: 0.2, edge: 0, jit: 0, mask: false };
const SHARK_FINMAT = { opacity: 1, rough: 0.55, clear: 0.45, ccRough: 0.3, opaque: true, spec: 0.5 };
const TUNA_FINLETS = (d0, v0) => ({ dorsal: { n: 9, t0: d0, t1: 0.775, bl0: 0.016, bl1: 0.011, h0: 0.017, h1: 0.012 }, ventral: { n: 8, t0: v0, t1: 0.775, bl0: 0.015, bl1: 0.011, h0: 0.016, h1: 0.011 } });
const OCEAN_BODY = { rings: 64, segs: 40, mix: 0.35 };
const TUNA_CAUDAL = { base: [[0.832, -0.011], [0.822, 0.012]], out: [[0, 0.995, -0.162], [0.12, 0.965, -0.112], [0.3, 0.925, -0.052], [0.45, 0.906, -0.012], [0.5, 0.903, 0], [0.55, 0.906, 0.012], [0.7, 0.925, 0.052], [0.88, 0.965, 0.112], [1, 0.995, 0.162]], thick: 0.0055, bow0: 0.06, bow1: 0.06, bowW: 0.2, ns: 22, nr: 8, gain: 0.02 };

const OCEAN = {
  // ------------------------------------------------------------------ sharks
  greatWhite: {
    prof: [[0, 0.004, 0.004, 0], [0.01, 0.017, -0.006, 0.015], [0.025, 0.032, -0.019, 0.03], [0.05, 0.05, -0.036, 0.048], [0.08, 0.067, -0.053, 0.062], [0.12, 0.084, -0.07, 0.075], [0.17, 0.098, -0.085, 0.085], [0.23, 0.108, -0.097, 0.091], [0.3, 0.113, -0.104, 0.092], [0.37, 0.111, -0.104, 0.087], [0.44, 0.102, -0.097, 0.077], [0.51, 0.087, -0.084, 0.064], [0.58, 0.068, -0.066, 0.048], [0.65, 0.05, -0.048, 0.037], [0.7, 0.036, -0.034, 0.03], [0.745, 0.026, -0.024, 0.027], [0.78, 0.021, -0.019, 0.021], [0.805, 0.02, -0.018, 0.011], [0.82, 0.021, -0.019, 0]],
    nT: [[0, 2.1], [0.3, 2.0], [0.6, 1.9], [0.69, 1.6], [0.745, 1.25], [0.8, 1.3], [0.82, 1.5]],
    nB: [[0, 2.6], [0.12, 2.8], [0.35, 2.4], [0.6, 2.0], [0.69, 1.6], [0.745, 1.25], [0.8, 1.3], [0.82, 1.5]],
    wl: [[0, 0.4], [0.25, 0.42], [0.6, 0.46], [0.75, 0.5]], head: 0, nose: 0.7, body: OCEAN_BODY, shark: true,
    eye: { t: 0.074, v: 0.42, r: 0.0078, out: 0.3, fwd: 0.1, up: 0.06, iris: '#161c24', dark: '#030405', ring: '#2a3743', depth: 0.1 },
    mouthTV: [[0.057, 1.0], [0.061, 0.94], [0.069, 0.875], [0.083, 0.81], [0.101, 0.75], [0.121, 0.7]], furrow: 0.012,
    hook: [0.062, 1.0, 0.004],
    gills: { t: [0.166, 0.182, 0.196, 0.208, 0.219], v0: [0.25, 0.27, 0.29, 0.32, 0.35], v1: [0.7, 0.71, 0.71, 0.7, 0.68], bend: 0.006, slant: -0.004 },
    nostrils: [[0.034, 0.88]], pores: { t: [0.004, 0.11], v: [0.15, 0.98], n: 170 },
    fangs: [{ q: [0.1, 0.9], n: 11, len: [0.0085, 0.005], w: 0.8, dir: 1, off: -0.009 }, { q: [0.16, 0.8], n: 8, len: [0.0055, 0.0035], w: 0.55, dir: -1, off: 0.018 }],
    op: { t: [0.235, 0.24, 0.235], v: [0.1, 0.5, 0.95] }, pre: 0.02,
    sc: SHARK_SKIN, detailStr: 1.1,
    mat: { rough: 0.5, metal: [[0, 0.04], [1, 0.02]], irid: 0, clear: 0.55, ccRough: 0.28, fin: SHARK_FINMAT },
    swim: { k: 4.8, amp: 1, fIdle: 0.42, fMax: 1.7, env: [0.008, -0.02, 0.03, 0.25], knee: 0.4, shake: 0.055, thrash: 0.12, sRate: 0.42, ref: 4, flap: 0.6 },
    grad: [[0, '#3c444c'], [0.3, '#4b545d'], [0.5, '#616b74'], [1, '#76808a']],
    pix: counterPix([[0, 0.72], [0.05, 0.62], [0.11, 0.6], [0.17, 0.55], [0.23, 0.61], [0.3, 0.6], [0.45, 0.57], [0.62, 0.55], [0.74, 0.52], [0.82, 0.56]], '#ebedeb', 0.007, 0.13),
    fins: {
      dorsal: { t0: 0.315, t1: 0.43, out: [[0, 0.405, 0.108], [0.3, 0.41, 0.062], [0.6, 0.418, 0.03], [0.85, 0.432, 0.011], [1, 0.45, 0.004]], thick: 0.009, bow0: 0.08, bowW: 0.3, ns: 14, nr: 7, gain: 0.02, inset: 0.004 },
      dorsal2: { t0: 0.625, t1: 0.645, out: [[0, 0.642, 0.022], [0.4, 0.648, 0.012], [1, 0.672, 0.003]], thick: 0.003, ns: 5, nr: 3, gain: 0.03 },
      anal: { t0: 0.64, t1: 0.662, out: [[0, 0.66, 0.02], [0.4, 0.665, 0.011], [1, 0.688, 0.003]], thick: 0.003, ns: 5, nr: 3, gain: 0.03 },
      caudal: { base: [[0.805, -0.014], [0.785, 0.016]], out: [[0, 0.955, -0.14], [0.1, 0.935, -0.105], [0.25, 0.905, -0.06], [0.4, 0.882, -0.022], [0.48, 0.874, -0.002], [0.56, 0.882, 0.022], [0.7, 0.91, 0.066], [0.85, 0.948, 0.116], [1, 1.0, 0.168]], thick: 0.007, bow0: 0.05, bow1: 0.06, bowW: 0.2, ns: 22, nr: 8, gain: 0.02 },
      pectoral: { t: 0.21, bl: 0.06, v0: 0.7, v1: 0.78, d0: [0.75, -0.35, -0.55], d1: [0.5, -0.22, -0.84], len: [[0, 0.19], [0.12, 0.175], [0.4, 0.11], [0.75, 0.05], [1, 0.03]], thick: 0.006, bow0: 0.07, bowW: 0.3, ns: 12, nr: 7, gain: 0.03, tuck: 0, camber: 0.03, under: 'pectoralU' },
      pelvic: { t: 0.49, bl: 0.035, v0: 0.86, v1: 0.92, d0: [0.45, -0.6, -0.65], d1: [0.2, -0.35, -0.9], len: [[0, 0.075], [0.3, 0.06], [1, 0.022]], thick: 0.004, ns: 7, nr: 4, gain: 0.05, tuck: 0, camber: 0.02 },
    },
    fp: {
      dorsal: { skin: true, mem: [[0, '#49525b'], [0.7, '#434b54'], [1, '#2c3238']], edge: { w: 0.07, col: 'rgba(24,26,30,0.85)' } },
      dorsal2: { skin: true, mem: [[0, '#4b545d'], [1, '#353b42']] },
      anal: { skin: true, mem: [[0, '#d8dbdb'], [1, '#5b636b']] },
      caudal: { skin: true, mem: [[0, '#4a535c'], [0.75, '#414951'], [1, '#2a3036']], edge: { w: 0.05, col: 'rgba(22,24,28,0.8)' } },
      pectoral: { skin: true, mem: [[0, '#4c555e'], [0.75, '#424a52'], [1, '#202429']], edge: { w: 0.06, col: 'rgba(18,20,24,0.9)' } },
      pectoralU: { skin: true, mem: [[0, '#eceeec'], [0.6, '#e2e5e4'], [1, '#c9cdcd']], corner: { s: 0.0, r: 1.0, rad: 0.5, col: 'rgba(14,15,18,0.95)' }, edge: { w: 0.05, col: 'rgba(30,32,36,0.8)' } },
      pelvic: { skin: true, mem: [[0, '#d9dcdb'], [0.5, '#7b848c'], [1, '#3a4148']] },
      teeth: {},
    },
    paint(B) {
      mottle(B, 90, [0.02, 0.8], [0.02, 0.52], [0.008, 0.03], [26, 30, 36, 0.12], [150, 158, 166, 0.09]);
      scars(B, 7);
      B.blob(0.29, 0.8, 0.011, [14, 15, 18, 0.8], 0.6, 1.8, 0.3); // black axil spot behind the pectoral
      B.blob(0.004, 0.45, 0.03, [24, 28, 32, 0.25], 1, 1.5);
    },
  },

  hammerhead: {
    prof: [[0, 0.002, 0.002, 0], [0.006, 0.008, -0.005, 0.104], [0.016, 0.0105, -0.0075, 0.117], [0.03, 0.0115, -0.0085, 0.122], [0.044, 0.012, -0.009, 0.116], [0.056, 0.0145, -0.0115, 0.094], [0.068, 0.022, -0.018, 0.058], [0.085, 0.034, -0.028, 0.043], [0.12, 0.051, -0.043, 0.047], [0.18, 0.066, -0.058, 0.055], [0.25, 0.075, -0.068, 0.059], [0.33, 0.077, -0.072, 0.058], [0.41, 0.072, -0.07, 0.052], [0.49, 0.062, -0.062, 0.044], [0.57, 0.05, -0.05, 0.036], [0.64, 0.038, -0.037, 0.028], [0.7, 0.027, -0.025, 0.02], [0.74, 0.02, -0.017, 0.015], [0.765, 0.018, -0.015, 0.009], [0.78, 0.019, -0.015, 0]],
    nT: [[0, 3.6], [0.05, 3.4], [0.075, 2.4], [0.12, 2.1], [0.6, 2.0], [0.72, 1.7], [0.78, 1.6]],
    nB: [[0, 3.6], [0.05, 3.4], [0.075, 2.6], [0.15, 2.6], [0.4, 2.3], [0.6, 2.0], [0.72, 1.7], [0.78, 1.6]],
    wl: [[0, 0.45], [0.06, 0.45], [0.1, 0.42], [0.6, 0.47], [0.78, 0.5]], head: 0, nose: 0.55, shark: true,
    body: { rings: 66, segs: 40, mix: 0.45 },
    eye: { t: 0.03, v: 0.5, r: 0.0056, out: 0.5, fwd: 0.35, up: 0.0, iris: '#7a5a22', dark: '#191208', ring: '#b8944a', depth: 0.1 },
    mouthTV: [[0.071, 1.0], [0.077, 0.97], [0.084, 0.91], [0.09, 0.85], [0.093, 0.82]], furrow: 0.006,
    hook: [0.074, 1.0, 0.003],
    gills: { t: [0.15, 0.162, 0.174, 0.186, 0.198], v0: [0.36, 0.37, 0.38, 0.39, 0.4], v1: [0.64, 0.65, 0.66, 0.66, 0.66], bend: 0.004 },
    nostrils: [[0.007, 0.4], [0.007, 0.6]], pores: { t: [0.002, 0.065], v: [0.45, 0.98], n: 240 },
    op: { t: [0.21, 0.215, 0.21], v: [0.1, 0.5, 0.95] }, pre: 0.02,
    sc: SHARK_SKIN, detailStr: 1.1,
    mat: { rough: 0.5, metal: [[0, 0.04], [1, 0.02]], irid: 0, clear: 0.55, ccRough: 0.28, fin: SHARK_FINMAT },
    swim: { k: 5.2, amp: 1, fIdle: 0.5, fMax: 1.9, env: [0.012, -0.028, 0.035, 0.24], knee: 0.38, shake: 0.05, thrash: 0.12, sRate: 0.45, ref: 3.5, flap: 0.6 },
    grad: [[0, '#4a463c'], [0.3, '#5a564b'], [0.5, '#716e63'], [1, '#858276']],
    pix: counterPix([[0, 0.6], [0.05, 0.56], [0.075, 0.62], [0.2, 0.62], [0.5, 0.58], [0.78, 0.55]], '#e8e7e1', 0.03, 0.08),
    fins: {
      dorsal: { t0: 0.27, t1: 0.355, out: [[0, 0.348, 0.165], [0.18, 0.338, 0.115], [0.42, 0.336, 0.065], [0.68, 0.345, 0.027], [0.88, 0.365, 0.009], [1, 0.388, 0.003]], thick: 0.008, bow0: 0.09, bowW: 0.3, ns: 14, nr: 8, gain: 0.02, inset: 0.004 },
      dorsal2: { t0: 0.6, t1: 0.63, out: [[0, 0.632, 0.034], [0.35, 0.64, 0.016], [0.7, 0.655, 0.008], [1, 0.68, 0.003]], thick: 0.003, ns: 6, nr: 3, gain: 0.03 },
      anal: { t0: 0.595, t1: 0.635, out: [[0, 0.638, 0.04], [0.35, 0.642, 0.018], [0.6, 0.65, 0.014], [1, 0.672, 0.003]], thick: 0.003, ns: 6, nr: 3, gain: 0.03 },
      caudal: { base: [[0.775, -0.011], [0.752, 0.013]], out: [[0, 0.868, -0.08], [0.1, 0.852, -0.05], [0.2, 0.843, -0.022], [0.32, 0.872, -0.006], [0.48, 0.91, 0.012], [0.64, 0.944, 0.03], [0.74, 0.96, 0.043], [0.8, 0.957, 0.055], [0.88, 0.982, 0.068], [0.95, 0.998, 0.084], [1, 0.993, 0.1]], thick: 0.006, bow0: 0.06, bow1: 0.03, bowW: 0.15, ns: 24, nr: 8, gain: 0.02 },
      pectoral: { t: 0.165, bl: 0.045, v0: 0.72, v1: 0.8, d0: [0.78, -0.38, -0.5], d1: [0.5, -0.25, -0.85], len: [[0, 0.13], [0.15, 0.115], [0.45, 0.07], [0.8, 0.035], [1, 0.022]], thick: 0.005, bow0: 0.06, bowW: 0.3, ns: 10, nr: 6, gain: 0.03, tuck: 0, camber: 0.03, under: 'pectoralU' },
      pelvic: { t: 0.455, bl: 0.035, v0: 0.86, v1: 0.92, d0: [0.4, -0.65, -0.6], d1: [0.15, -0.35, -0.9], len: [[0, 0.07], [0.3, 0.05], [1, 0.02]], thick: 0.004, bow0: 0.05, ns: 7, nr: 4, gain: 0.05, tuck: 0 },
    },
    fp: {
      dorsal: { skin: true, mem: [[0, '#56524a'], [0.8, '#4c4941'], [1, '#34322c']], edge: { w: 0.05, col: 'rgba(36,34,30,0.8)' } },
      dorsal2: { skin: true, mem: [[0, '#5a564d'], [1, '#3c3a33']] },
      anal: { skin: true, mem: [[0, '#d6d4cc'], [1, '#6a675c']] },
      caudal: { skin: true, mem: [[0, '#58544b'], [0.8, '#4a473f'], [1, '#302e29']], corner: { s: 1, r: 1, rad: 0.3, col: 'rgba(30,28,24,0.75)' }, edge: { w: 0.05, col: 'rgba(36,34,30,0.75)' } },
      pectoral: { skin: true, mem: [[0, '#5a564d'], [0.8, '#4f4b43'], [1, '#3a3731']], edge: { w: 0.06, col: 'rgba(40,38,32,0.8)' } },
      pectoralU: { skin: true, mem: [[0, '#e6e5df'], [0.7, '#d5d3cb'], [1, '#8c897e']], corner: { s: 0, r: 1, rad: 0.45, col: 'rgba(70,66,58,0.7)' } },
      pelvic: { skin: true, mem: [[0, '#dcdad3'], [0.6, '#8a877c'], [1, '#56534a']] },
    },
    paint(B) {
      mottle(B, 80, [0.02, 0.78], [0.02, 0.55], [0.008, 0.028], [36, 34, 28, 0.12], [160, 156, 140, 0.08]);
      scars(B, 5, 'rgba(214,212,204,0.26)', [0.1, 0.7]);
      // darker leading margin of the cephalofoil
      for (let i = 0; i <= 24; i++) { const v = i / 24; B.blob(0.0015, v, 0.003, [40, 38, 32, 0.22], 1, 2.5); }
    },
  },

  mako: {
    prof: [[0, 0.007, 0.007, 0], [0.012, 0.014, -0.002, 0.01], [0.03, 0.025, -0.012, 0.021], [0.06, 0.041, -0.027, 0.035], [0.1, 0.057, -0.043, 0.049], [0.15, 0.071, -0.057, 0.06], [0.22, 0.082, -0.071, 0.067], [0.3, 0.087, -0.079, 0.069], [0.38, 0.086, -0.081, 0.066], [0.46, 0.079, -0.077, 0.059], [0.54, 0.066, -0.065, 0.049], [0.62, 0.05, -0.049, 0.038], [0.69, 0.034, -0.033, 0.029], [0.745, 0.022, -0.02, 0.025], [0.785, 0.017, -0.015, 0.019], [0.81, 0.017, -0.015, 0.009], [0.825, 0.018, -0.016, 0]],
    nT: [[0, 2.1], [0.3, 2.0], [0.62, 1.85], [0.7, 1.5], [0.75, 1.2], [0.8, 1.25], [0.825, 1.5]],
    nB: [[0, 2.4], [0.15, 2.5], [0.4, 2.2], [0.62, 1.9], [0.7, 1.5], [0.75, 1.2], [0.8, 1.25], [0.825, 1.5]],
    wl: [[0, 0.42], [0.3, 0.44], [0.75, 0.5]], head: 0, nose: 0.78, body: OCEAN_BODY, shark: true,
    eye: { t: 0.078, v: 0.42, r: 0.0098, out: 0.32, fwd: 0.12, up: 0.04, iris: '#0e1218', dark: '#030406', ring: '#1f2c3e', depth: 0.11 },
    mouthTV: [[0.05, 1.0], [0.062, 0.97], [0.08, 0.905], [0.098, 0.835], [0.112, 0.785], [0.12, 0.755]], furrow: 0.008,
    hook: [0.054, 1.0, 0.003],
    gills: { t: [0.16, 0.174, 0.188, 0.202, 0.216], v0: [0.29, 0.3, 0.31, 0.33, 0.36], v1: [0.66, 0.67, 0.68, 0.68, 0.67], bend: 0.005, slant: -0.003 },
    nostrils: [[0.03, 0.9]], pores: { t: [0.004, 0.1], v: [0.15, 0.98], n: 140 },
    fangs: [{ q: [0.1, 0.85], n: 8, len: [0.0088, 0.005], w: 0.32, dir: 1, off: -0.008 }, { q: [0.12, 0.8], n: 7, len: [0.0082, 0.0042], w: 0.3, dir: -1, off: 0.016 }],
    op: { t: [0.225, 0.23, 0.225], v: [0.1, 0.5, 0.95] }, pre: 0.02,
    sc: SHARK_SKIN, detailStr: 1.1,
    mat: { rough: 0.36, metal: [[0, 0.26], [0.45, 0.24], [0.6, 0.02], [1, 0.02]], metalLum: [0.0, 0.12], irid: 0, clear: 0.75, ccRough: 0.18, fin: SHARK_FINMAT },
    swim: { k: 4.6, amp: 1, fIdle: 0.6, fMax: 2.6, env: [0.006, -0.016, 0.022, 0.3], knee: 0.45, shake: 0.05, thrash: 0.12, sRate: 0.5, ref: 2.8, flap: 0.6 },
    grad: [[0, '#121836'], [0.25, '#18224e'], [0.45, '#22336e'], [1, '#2c4288']],
    pix: counterPix([[0, 0.66], [0.06, 0.6], [0.12, 0.6], [0.2, 0.58], [0.5, 0.56], [0.8, 0.52]], '#f0f1ef', 0.006, 0.05,
      (t, v, c, n1, n2, f) => { const k = sstep(0.4, 0.55, v) * (1 - f) * 0.3; c[0] += 20 * k; c[1] += 36 * k; c[2] += 60 * k; }),
    fins: {
      dorsal: { t0: 0.335, t1: 0.43, out: [[0, 0.41, 0.082], [0.25, 0.418, 0.06], [0.55, 0.423, 0.03], [0.82, 0.435, 0.011], [1, 0.452, 0.004]], thick: 0.007, bow0: 0.11, bowW: 0.35, ns: 12, nr: 7, gain: 0.02, inset: 0.004 },
      dorsal2: { t0: 0.64, t1: 0.655, out: [[0, 0.655, 0.016], [1, 0.678, 0.003]], thick: 0.0025, ns: 4, nr: 3, gain: 0.03 },
      anal: { t0: 0.655, t1: 0.67, out: [[0, 0.672, 0.015], [1, 0.692, 0.003]], thick: 0.0025, ns: 4, nr: 3, gain: 0.03 },
      caudal: { base: [[0.81, -0.012], [0.79, 0.014]], out: [[0, 0.962, -0.135], [0.1, 0.94, -0.1], [0.25, 0.91, -0.056], [0.4, 0.888, -0.02], [0.48, 0.88, -0.001], [0.56, 0.888, 0.02], [0.7, 0.915, 0.062], [0.85, 0.952, 0.112], [1, 1.0, 0.158]], thick: 0.006, bow0: 0.05, bow1: 0.06, bowW: 0.2, ns: 22, nr: 8, gain: 0.02 },
      pectoral: { t: 0.2, bl: 0.045, v0: 0.7, v1: 0.78, d0: [0.8, -0.35, -0.5], d1: [0.5, -0.25, -0.83], len: [[0, 0.145], [0.15, 0.13], [0.45, 0.08], [0.8, 0.04], [1, 0.025]], thick: 0.005, bow0: 0.06, bowW: 0.3, ns: 10, nr: 6, gain: 0.03, tuck: 0, camber: 0.03, under: 'pectoralU' },
      pelvic: { t: 0.5, bl: 0.03, v0: 0.86, v1: 0.92, d0: [0.4, -0.62, -0.65], d1: [0.18, -0.35, -0.9], len: [[0, 0.06], [0.3, 0.045], [1, 0.018]], thick: 0.0035, ns: 6, nr: 4, gain: 0.05, tuck: 0 },
    },
    fp: {
      dorsal: { skin: true, mem: [[0, '#1c2858'], [0.8, '#17204a'], [1, '#0f1532']], edge: { w: 0.05, col: 'rgba(16,20,48,0.8)' } },
      dorsal2: { skin: true, mem: [[0, '#1c2858'], [1, '#141c40']] },
      anal: { skin: true, mem: [[0, '#e8eaea'], [1, '#1e2a56']] },
      caudal: { skin: true, mem: [[0, '#1d295a'], [0.8, '#18214c'], [1, '#0f1532']], edge: { w: 0.04, col: 'rgba(14,18,44,0.8)' } },
      pectoral: { skin: true, mem: [[0, '#1d2958'], [0.85, '#172048'], [1, '#0f1532']] },
      pectoralU: { skin: true, mem: [[0, '#eef0ef'], [0.7, '#e4e7e7'], [1, '#9aa0b4']], corner: { s: 0, r: 1, rad: 0.4, col: 'rgba(40,52,100,0.6)' } },
      pelvic: { skin: true, mem: [[0, '#e8eaea'], [0.6, '#46558a'], [1, '#1c2858']] },
      teeth: {},
    },
    paint(B) {
      mottle(B, 50, [0.02, 0.8], [0.02, 0.5], [0.01, 0.03], [14, 20, 60, 0.12], [80, 110, 200, 0.08]);
      scars(B, 3, 'rgba(200,210,236,0.22)');
    },
  },

  // ------------------------------------------------------------------ billfish
  blueMarlin: {
    prof: [[0, 0.024, 0.024, 0], [0.02, 0.0262, 0.0218, 0.0024], [0.06, 0.0285, 0.0192, 0.0044], [0.1, 0.031, 0.0158, 0.0062], [0.13, 0.0335, 0.0125, 0.0076], [0.15, 0.0365, 0.009, 0.0088], [0.162, 0.041, -0.003, 0.011], [0.178, 0.051, -0.021, 0.019], [0.2, 0.066, -0.04, 0.029], [0.23, 0.083, -0.058, 0.039], [0.27, 0.098, -0.072, 0.046], [0.32, 0.105, -0.079, 0.05], [0.38, 0.104, -0.08, 0.049], [0.45, 0.097, -0.076, 0.045], [0.52, 0.086, -0.069, 0.04], [0.59, 0.071, -0.058, 0.033], [0.66, 0.053, -0.045, 0.026], [0.72, 0.036, -0.031, 0.02], [0.77, 0.022, -0.019, 0.018], [0.8, 0.016, -0.014, 0.015], [0.82, 0.016, -0.014, 0.007], [0.835, 0.018, -0.015, 0]],
    nT: [[0, 2.0], [0.15, 2.0], [0.2, 2.2], [0.5, 2.0], [0.7, 1.8], [0.77, 1.3], [0.81, 1.25], [0.835, 1.5]],
    nB: [[0, 2.0], [0.15, 2.0], [0.2, 2.3], [0.5, 2.1], [0.7, 1.8], [0.77, 1.3], [0.81, 1.25], [0.835, 1.5]],
    wl: [[0, 0.5], [0.15, 0.5], [0.2, 0.45], [0.5, 0.46], [0.8, 0.5]], head: 0, nose: 0.5,
    body: { rings: 64, segs: 40, mix: 0.3, rt: [[0, 0], [0.025, 0.004], [0.11, 0.17], [0.16, 0.205], [0.3, 0.33], [0.82, 0.92], [1, 1]] },
    eye: { t: 0.198, v: 0.4, r: 0.012, out: 0.4, fwd: 0.1, up: 0.04, iris: '#2c3a4c', dark: '#06090f', ring: '#a6b6c6', depth: 0.1 },
    mouth: [[0.158, 0.006], [0.218, -0.008]], mouthCurve: 1.0, mouthPt: [0.165, 0.0],
    nostrils: [[0.184, 0.34], [0.188, 0.33]],
    op: { t: [0.245, 0.272, 0.25], v: [0.2, 0.5, 0.9] }, pre: 0.035,
    sc: { tile: 'skin', nl: 320, nv: 80, nrm: 0.16, edge: 0, jit: 0, mask: false },
    mat: { rough: 0.32, metal: [[0, 0.2], [0.35, 0.28], [0.5, 0.52], [0.8, 0.48], [1, 0.4]], metalLum: [0.04, 0.3], irid: 0, clear: 0.9, ccRough: 0.1, fin: { opacity: 0.97, rough: 0.45, clear: 0.4, opaque: true } },
    swim: { k: 4.6, amp: 1, fIdle: 0.5, fMax: 2.4, env: [0.002, -0.004, 0.006, 0.42], knee: 0.5, shake: 0.035, thrash: 0.1, sRate: 0.55, ref: 3.2, bill: 0.19, flap: 0.7 },
    grad: [[0, '#0a1230'], [0.18, '#0e1c46'], [0.32, '#162c66'], [0.4, '#36568a'], [0.47, '#a6b2be'], [0.7, '#d0d7dc'], [1, '#eceff1']],
    pix(t, v, c, n1) {
      const b = 1 - sstep(0.15, 0.172, t); // dark blue-grey bill
      if (b > 0) tintPix(c, v < 0.55 ? [34, 44, 64] : [70, 80, 98], b * (0.85 + 0.15 * n1));
    },
    fins: {
      dorsal: { t0: 0.255, t1: 0.64, out: [[0, 0.29, 0.13], [0.06, 0.305, 0.1], [0.14, 0.335, 0.062], [0.25, 0.38, 0.042], [0.5, 0.48, 0.034], [0.75, 0.58, 0.028], [0.9, 0.63, 0.02], [1, 0.66, 0.008]], ns: 26, nr: 5, gain: 0.04 },
      dorsal2: { t0: 0.705, t1: 0.725, out: [[0, 0.725, 0.03], [0.5, 0.74, 0.018], [1, 0.75, 0.006]], ns: 4, nr: 3, gain: 0.05 },
      anal: { t0: 0.52, t1: 0.6, out: [[0, 0.55, 0.075], [0.15, 0.565, 0.055], [0.4, 0.585, 0.03], [0.7, 0.6, 0.02], [1, 0.62, 0.006]], thick: 0.003, bow0: 0.04, ns: 9, nr: 5, gain: 0.03 },
      anal2: { t0: 0.7, t1: 0.72, out: [[0, 0.72, 0.028], [0.5, 0.735, 0.016], [1, 0.745, 0.005]], ns: 4, nr: 3, gain: 0.05 },
      caudal: { base: [[0.822, -0.013], [0.81, 0.015]], out: [[0, 0.965, -0.17], [0.1, 0.94, -0.12], [0.25, 0.9, -0.06], [0.42, 0.875, -0.018], [0.5, 0.872, 0], [0.58, 0.876, 0.02], [0.75, 0.905, 0.065], [0.9, 0.945, 0.125], [1, 1.0, 0.18]], thick: 0.005, bow0: 0.05, bow1: 0.05, bowW: 0.2, ns: 22, nr: 8, gain: 0.02 },
      pectoral: { t: 0.268, bl: 0.025, v0: 0.68, v1: 0.74, d0: [0.6, -0.45, -0.65], d1: [0.3, -0.3, -0.9], len: [[0, 0.16], [0.2, 0.13], [0.5, 0.07], [1, 0.025]], thick: 0.004, bow0: 0.04, ns: 10, nr: 6, gain: 0.08, tuck: 0.35, under: 'pectoralU' },
      pelvic: { t: 0.285, bl: 0.008, v0: 0.95, v1: 0.98, d0: [0.12, -0.45, -0.88], d1: [0.1, -0.35, -0.93], len: [[0, 0.1], [1, 0.08]], ns: 3, nr: 6, gain: 0.25, tuck: 0.3 },
    },
    fp: {
      dorsal: { rays: 40, rayW: 0.28, segA: 0.04, mem: [[0, 'rgba(16,24,56,0.97)'], [1, 'rgba(26,40,90,0.92)']], ray: 'rgba(6,10,26,0.9)', edge: { w: 0.05, col: 'rgba(10,14,34,0.8)' } },
      dorsal2: { rays: 6, mem: [[0, 'rgba(18,28,62,0.96)'], [1, 'rgba(26,40,88,0.9)']], ray: 'rgba(6,10,26,0.9)' },
      anal: { rays: 12, mem: [[0, 'rgba(176,188,204,0.96)'], [0.5, 'rgba(70,90,130,0.94)'], [1, 'rgba(30,44,86,0.92)']], ray: 'rgba(30,40,70,0.8)' },
      anal2: { rays: 6, mem: [[0, 'rgba(150,164,184,0.95)'], [1, 'rgba(30,44,86,0.9)']], ray: 'rgba(30,40,70,0.8)' },
      caudal: { rays: 26, rayW: 0.22, segA: 0.04, mem: [[0, 'rgba(22,30,64,0.99)'], [1, 'rgba(14,20,46,0.97)']], ray: 'rgba(8,12,30,0.85)' },
      pectoral: { skin: true, mem: [[0, '#1c2a5a'], [0.8, '#16224a'], [1, '#0f1736']] },
      pectoralU: { skin: true, mem: [[0, '#b6c0cc'], [0.6, '#7f8ca2'], [1, '#3a4766']] },
      pelvic: { rays: 4, mem: [[0, 'rgba(30,44,90,0.95)'], [1, 'rgba(20,30,70,0.9)']], ray: 'rgba(8,12,30,0.8)' },
    },
    paint(B) {
      const { R } = B;
      // ~15 rows of luminous pale-cobalt vertical stripes made of bars and dots
      for (let i = 0; i < 16; i++) {
        const tc = 0.29 + i * 0.03 + (R() - 0.5) * 0.006;
        if (tc > 0.76) break;
        const v1 = lerp(0.62, 0.5, (tc - 0.29) / 0.47);
        let v = 0.1 + R() * 0.05;
        while (v < v1) {
          const L = lerp(0.025, 0.07, R()), ve = Math.min(v + L, v1);
          B.bar(tc + (v - 0.3) * 0.012, 0.0048, 0.004, v, ve, [150, 196, 255, 0.5], 2, 0.002);
          v = ve + lerp(0.012, 0.035, R());
          if (R() < 0.3) { B.blob(tc + 0.002, v - 0.006, 0.0022, [170, 210, 255, 0.5], 0.4); }
        }
      }
      mottle(B, 40, [0.18, 0.8], [0.0, 0.35], [0.01, 0.03], [8, 14, 34, 0.15], [60, 90, 160, 0.1]);
      scars(B, 3, 'rgba(200,214,236,0.22)', [0.25, 0.7]);
    },
  },

  swordfish: {
    prof: [[0, 0.02, 0.02, 0], [0.02, 0.0215, 0.0185, 0.005], [0.08, 0.0237, 0.0163, 0.011], [0.15, 0.0258, 0.0142, 0.016], [0.22, 0.0285, 0.0118, 0.0188], [0.255, 0.0315, 0.008, 0.0198], [0.272, 0.037, -0.004, 0.021], [0.29, 0.047, -0.019, 0.025], [0.32, 0.061, -0.038, 0.034], [0.36, 0.075, -0.053, 0.043], [0.42, 0.084, -0.063, 0.049], [0.49, 0.086, -0.066, 0.05], [0.56, 0.079, -0.062, 0.046], [0.63, 0.065, -0.053, 0.04], [0.7, 0.048, -0.04, 0.032], [0.75, 0.033, -0.028, 0.027], [0.79, 0.021, -0.018, 0.025], [0.815, 0.017, -0.015, 0.017], [0.832, 0.018, -0.015, 0.007], [0.845, 0.02, -0.016, 0]],
    nT: [[0, 1.7], [0.24, 1.75], [0.29, 2.2], [0.6, 2.0], [0.72, 1.7], [0.79, 1.15], [0.82, 1.2], [0.845, 1.5]],
    nB: [[0, 1.7], [0.24, 1.75], [0.29, 2.3], [0.6, 2.1], [0.72, 1.7], [0.79, 1.15], [0.82, 1.2], [0.845, 1.5]],
    wl: [[0, 0.5], [0.25, 0.5], [0.3, 0.45], [0.6, 0.46], [0.8, 0.5]], head: 0, nose: 0.45,
    body: { rings: 64, segs: 40, mix: 0.4, rt: [[0, 0], [0.02, 0.004], [0.13, 0.27], [0.18, 0.32], [0.32, 0.43], [0.82, 0.92], [1, 1]] },
    eye: { t: 0.305, v: 0.38, r: 0.0135, out: 0.42, fwd: 0.1, up: 0.03, iris: '#2b4f7c', dark: '#07101c', ring: '#82a8d0', depth: 0.12 },
    mouth: [[0.268, 0.004], [0.318, -0.01]], mouthCurve: 1.0, mouthPt: [0.276, 0.0],
    nostrils: [[0.29, 0.34], [0.294, 0.33]],
    op: { t: [0.345, 0.375, 0.355], v: [0.2, 0.5, 0.9] }, pre: 0.035,
    sc: { tile: 'skin', nl: 300, nv: 70, nrm: 0.34, edge: 0, jit: 0, mask: false },
    mat: { rough: 0.44, metal: [[0, 0.1], [1, 0.12]], metalLum: [0.05, 0.4], irid: 0, clear: 0.75, ccRough: 0.2, fin: SHARK_FINMAT },
    swim: { k: 4.5, amp: 1, fIdle: 0.45, fMax: 2.2, env: [0.002, -0.004, 0.006, 0.45], knee: 0.52, shake: 0.035, thrash: 0.1, sRate: 0.55, ref: 2.8, bill: 0.29, flap: 0.7 },
    grad: [[0, '#171017'], [0.2, '#221721'], [0.38, '#32232b'], [0.52, '#4a3936'], [0.7, '#655246'], [1, '#86725f']],
    pix(t, v, c, n1, n2) {
      const b = 1 - sstep(0.25, 0.275, t); // flat sword: dark above, paler beneath
      if (b > 0) tintPix(c, v < 0.5 ? [40, 32, 38] : [96, 84, 80], b * (0.8 + 0.2 * n2));
    },
    fins: {
      dorsal: { t0: 0.335, t1: 0.395, out: [[0, 0.418, 0.125], [0.2, 0.413, 0.085], [0.45, 0.408, 0.05], [0.7, 0.413, 0.025], [0.9, 0.424, 0.01], [1, 0.435, 0.004]], thick: 0.007, bow0: 0.07, bowW: 0.3, ns: 12, nr: 7, gain: 0.015, inset: 0.004 },
      dorsal2: { t0: 0.79, t1: 0.8, out: [[0, 0.805, 0.02], [1, 0.815, 0.003]], thick: 0.002, ns: 3, nr: 3, gain: 0.03 },
      anal: { t0: 0.6, t1: 0.645, out: [[0, 0.665, 0.066], [0.3, 0.662, 0.036], [0.65, 0.664, 0.015], [1, 0.675, 0.004]], thick: 0.004, bow0: 0.05, ns: 8, nr: 5, gain: 0.02 },
      anal2: { t0: 0.775, t1: 0.787, out: [[0, 0.792, 0.016], [1, 0.802, 0.003]], thick: 0.002, ns: 3, nr: 3, gain: 0.03 },
      caudal: { base: [[0.832, -0.012], [0.82, 0.014]], out: [[0, 0.97, -0.165], [0.12, 0.945, -0.115], [0.28, 0.912, -0.056], [0.44, 0.893, -0.014], [0.5, 0.89, 0], [0.56, 0.893, 0.015], [0.72, 0.915, 0.062], [0.88, 0.952, 0.122], [1, 1.0, 0.176]], thick: 0.006, bow0: 0.05, bow1: 0.05, bowW: 0.2, ns: 22, nr: 8, gain: 0.02 },
      pectoral: { t: 0.365, bl: 0.03, v0: 0.8, v1: 0.86, d0: [0.55, -0.55, -0.62], d1: [0.3, -0.35, -0.89], len: [[0, 0.14], [0.15, 0.12], [0.45, 0.065], [0.8, 0.03], [1, 0.018]], thick: 0.0045, bow0: 0.05, ns: 10, nr: 6, gain: 0.03, tuck: 0.2, under: 'pectoralU' },
    },
    fp: {
      dorsal: { skin: true, mem: [[0, '#2b2029'], [0.8, '#241a22'], [1, '#160f15']], mottle: { n: 14, rr: [0.03, 0.07], col: 'rgba(80,60,60,0.12)' } },
      dorsal2: { skin: true, mem: [[0, '#2b2029'], [1, '#1a1219']] },
      anal: { skin: true, mem: [[0, '#6e5c54'], [1, '#2a1f27']] },
      anal2: { skin: true, mem: [[0, '#5a4a46'], [1, '#2a1f27']] },
      caudal: { skin: true, mem: [[0, '#2c2129'], [1, '#1a1319']], mottle: { n: 20, rr: [0.02, 0.05], col: 'rgba(80,60,60,0.12)' } },
      pectoral: { skin: true, mem: [[0, '#33252e'], [1, '#1c141a']] },
      pectoralU: { skin: true, mem: [[0, '#8c7a70'], [1, '#3a2d33']] },
    },
    paint(B) {
      mottle(B, 110, [0.26, 0.82], [0.0, 0.7], [0.008, 0.03], [20, 14, 20, 0.16], [130, 110, 100, 0.1]);
      scars(B, 9, 'rgba(196,180,172,0.3)', [0.3, 0.75], [0.1, 0.7]);
      for (let i = 0; i < 30; i++) B.blob(lerp(0.0, 0.25, B.R()), lerp(0.05, 0.95, B.R()), lerp(0.002, 0.006, B.R()), [20, 16, 18, 0.25], 1, 2.5);
    },
  },

  // ------------------------------------------------------------------ tunas
  bluefinTuna: {
    prof: [[0, 0.004, 0.004, 0], [0.012, 0.016, -0.008, 0.014], [0.03, 0.034, -0.024, 0.03], [0.06, 0.058, -0.046, 0.05], [0.1, 0.083, -0.07, 0.07], [0.15, 0.104, -0.092, 0.085], [0.21, 0.12, -0.11, 0.096], [0.28, 0.13, -0.122, 0.1], [0.35, 0.132, -0.126, 0.1], [0.42, 0.126, -0.12, 0.094], [0.49, 0.108, -0.104, 0.082], [0.56, 0.084, -0.082, 0.066], [0.63, 0.058, -0.057, 0.048], [0.69, 0.035, -0.034, 0.031], [0.74, 0.02, -0.019, 0.022], [0.78, 0.013, -0.012, 0.02], [0.81, 0.012, -0.011, 0.015], [0.83, 0.014, -0.013, 0.006], [0.845, 0.017, -0.015, 0]],
    nT: [[0, 2.2], [0.4, 2.1], [0.65, 1.9], [0.72, 1.5], [0.77, 1.12], [0.81, 1.12], [0.845, 1.4]],
    nB: [[0, 2.4], [0.4, 2.2], [0.65, 1.9], [0.72, 1.5], [0.77, 1.12], [0.81, 1.12], [0.845, 1.4]],
    wl: [[0, 0.44], [0.3, 0.47], [0.75, 0.5]], head: 0, nose: 0.72, body: OCEAN_BODY,
    eye: { t: 0.088, v: 0.38, r: 0.0125, out: 0.38, fwd: 0.12, up: 0.04, iris: '#2a2c30', dark: '#060709', ring: '#cdbb7c', depth: 0.1 },
    mouth: [[0.002, -0.002], [0.066, -0.026]], mouthCurve: 1.2,
    op: { t: [0.205, 0.238, 0.21], v: [0.15, 0.5, 0.9] }, pre: 0.042,
    LL: [[0.23, 0.3], [0.4, 0.33], [0.6, 0.4], [0.84, 0.5]], LLpores: false,
    sc: { nl: 280, nv: 80, nrm: 0.12, edge: 0.03, jit: 0.02 },
    mat: { rough: 0.3, metal: [[0, 0.32], [0.3, 0.4], [0.45, 0.62], [0.75, 0.55], [1, 0.42]], metalLum: [0.02, 0.28], irid: 0.35, clear: 0.9, ccRough: 0.1, fin: { opacity: 0.97, rough: 0.45, clear: 0.35, opaque: true } },
    swim: { k: 4.4, amp: 1, fIdle: 0.9, fMax: 4.0, env: [0.003, -0.006, 0.008, 0.6], knee: 0.58, shake: 0.03, thrash: 0.1, sRate: 0.7, ref: 2.0 },
    grad: [[0, '#060b1c'], [0.18, '#0a1430'], [0.3, '#12234a'], [0.37, '#30466a'], [0.44, '#97a3af'], [0.6, '#c2cad0'], [0.8, '#dadfe2'], [1, '#eaedee']],
    pix(t, v, c, n1) { const k = sstep(0.18, 0.3, v) * (1 - sstep(0.33, 0.4, v)) * sstep(0.08, 0.2, t) * (1 - sstep(0.7, 0.8, t)) * 0.3; c[0] += 10 * k; c[1] += 40 * k; c[2] += 70 * k; },
    fins: {
      dorsal: { t0: 0.29, t1: 0.45, out: [[0, 0.315, 0.068], [0.2, 0.345, 0.05], [0.5, 0.385, 0.03], [0.8, 0.43, 0.013], [1, 0.462, 0.004]], ns: 14, nr: 4, gain: 0.04 },
      dorsal2: { t0: 0.475, t1: 0.53, out: [[0, 0.555, 0.088], [0.25, 0.556, 0.052], [0.6, 0.56, 0.022], [1, 0.57, 0.006]], thick: 0.0035, bow0: 0.05, ns: 8, nr: 5, gain: 0.03 },
      anal: { t0: 0.55, t1: 0.6, out: [[0, 0.625, 0.08], [0.25, 0.627, 0.046], [0.6, 0.63, 0.02], [1, 0.64, 0.006]], thick: 0.0035, bow0: 0.05, ns: 8, nr: 5, gain: 0.03 },
      caudal: TUNA_CAUDAL,
      pectoral: { t: 0.235, bl: 0.028, v0: 0.5, v1: 0.56, d0: [0.42, -0.06, -0.9], d1: [0.32, -0.18, -0.93], len: [[0, 0.15], [0.2, 0.125], [0.5, 0.07], [1, 0.022]], thick: 0.003, bow0: 0.04, ns: 9, nr: 6, gain: 0.08, tuck: 0.5, under: 'pectoralU' },
      pelvic: { t: 0.27, bl: 0.016, v0: 0.92, v1: 0.96, d0: [0.3, -0.55, -0.78], d1: [0.15, -0.4, -0.9], len: [[0, 0.055], [0.4, 0.045], [1, 0.02]], ns: 6, nr: 4, gain: 0.2, tuck: 0.4 },
    },
    finlets: TUNA_FINLETS(0.585, 0.655),
    fp: {
      dorsal: { rays: 13, spiny: true, mem: [[0, 'rgba(60,72,96,0.95)'], [1, 'rgba(176,156,84,0.82)']], ray: 'rgba(16,20,32,0.95)' },
      dorsal2: { rays: 14, mem: [[0, 'rgba(56,50,52,0.97)'], [1, 'rgba(112,72,52,0.95)']], ray: 'rgba(28,24,24,0.9)', edge: { w: 0.08, col: 'rgba(40,30,28,0.9)' } },
      anal: { rays: 13, mem: [[0, 'rgba(176,182,188,0.96)'], [1, 'rgba(110,112,116,0.92)']], ray: 'rgba(76,78,84,0.85)' },
      caudal: { skin: true, mem: [[0, '#1a2440'], [0.6, '#131b32'], [1, '#0c1122']], sCol: [[0, 'rgba(0,0,0,0)'], [0.5, 'rgba(70,64,40,0.25)'], [1, 'rgba(0,0,0,0)']] },
      pectoral: { skin: true, mem: [[0, '#16203a'], [0.8, '#101830'], [1, '#0a0f20']] },
      pectoralU: { skin: true, mem: [[0, '#8e98a4'], [0.7, '#4e5a70'], [1, '#1c2438']] },
      pelvic: { rays: 7, mem: [[0, 'rgba(70,74,84,0.95)'], [1, 'rgba(40,44,54,0.9)']], ray: 'rgba(20,22,28,0.85)' },
      finlet: { rays: 0, base: false, noFade: true, mem: [[0, 'rgba(226,190,48,1)'], [1, 'rgba(242,208,64,1)']], edge: { w: 0.28, col: 'rgba(22,22,24,1)' } },
    },
    paint(B) {
      const { R } = B;
      // faint silvery spots and broken lines on the lower flanks
      for (let i = 0; i < 20; i++) {
        const tc = 0.33 + i * 0.021 + (R() - 0.5) * 0.004;
        for (let v = 0.5 + R() * 0.03; v < 0.86; v += lerp(0.022, 0.034, R())) if (R() < 0.75) B.blob(tc + (v - 0.5) * 0.01, v, lerp(0.0016, 0.0026, R()), [236, 240, 244, 0.42], 0.5, lerp(1, 1.8, R()), 1.57);
      }
      B.blob(0.3, 0.42, 0.06, [150, 160, 170, 0.12], 1, 2.2); // corselet
      mottle(B, 40, [0.1, 0.78], [0.0, 0.32], [0.01, 0.03], [6, 10, 26, 0.16], [40, 80, 150, 0.1]);
    },
  },

  yellowfinTuna: {
    prof: [[0, 0.004, 0.004, 0], [0.012, 0.015, -0.008, 0.013], [0.03, 0.031, -0.022, 0.027], [0.06, 0.052, -0.041, 0.044], [0.1, 0.073, -0.062, 0.06], [0.15, 0.091, -0.08, 0.072], [0.21, 0.104, -0.094, 0.08], [0.28, 0.111, -0.103, 0.083], [0.35, 0.112, -0.106, 0.082], [0.42, 0.106, -0.101, 0.077], [0.49, 0.093, -0.089, 0.068], [0.56, 0.074, -0.071, 0.056], [0.63, 0.052, -0.05, 0.041], [0.69, 0.032, -0.031, 0.028], [0.74, 0.018, -0.017, 0.02], [0.78, 0.012, -0.011, 0.018], [0.81, 0.011, -0.01, 0.013], [0.83, 0.013, -0.012, 0.005], [0.845, 0.016, -0.014, 0]],
    nT: [[0, 2.2], [0.4, 2.1], [0.65, 1.9], [0.72, 1.5], [0.77, 1.12], [0.81, 1.12], [0.845, 1.4]],
    nB: [[0, 2.4], [0.4, 2.2], [0.65, 1.9], [0.72, 1.5], [0.77, 1.12], [0.81, 1.12], [0.845, 1.4]],
    wl: [[0, 0.44], [0.3, 0.47], [0.75, 0.5]], head: 0, nose: 0.72, body: OCEAN_BODY,
    eye: { t: 0.085, v: 0.38, r: 0.0118, out: 0.38, fwd: 0.12, up: 0.04, iris: '#2a2c30', dark: '#060709', ring: '#d2c07e', depth: 0.1 },
    mouth: [[0.002, -0.002], [0.062, -0.022]], mouthCurve: 1.2,
    op: { t: [0.195, 0.228, 0.2], v: [0.15, 0.5, 0.9] }, pre: 0.04,
    LL: [[0.22, 0.3], [0.4, 0.33], [0.6, 0.4], [0.84, 0.5]], LLpores: false,
    sc: { nl: 260, nv: 70, nrm: 0.12, edge: 0.03, jit: 0.02 },
    mat: { rough: 0.3, metal: [[0, 0.32], [0.3, 0.38], [0.4, 0.25], [0.5, 0.62], [0.75, 0.55], [1, 0.42]], metalLum: [0.02, 0.28], irid: 0.3, clear: 0.9, ccRough: 0.1, fin: { opacity: 0.97, rough: 0.45, clear: 0.35, opaque: true } },
    swim: { k: 4.4, amp: 1, fIdle: 1.1, fMax: 4.8, env: [0.003, -0.006, 0.008, 0.6], knee: 0.58, shake: 0.03, thrash: 0.1, sRate: 0.75, ref: 1.4 },
    grad: [[0, '#070d22'], [0.18, '#0c1a3e'], [0.3, '#152a56'], [0.36, '#2e4466'], [0.43, '#9a9a72'], [0.5, '#b4bbc0'], [0.62, '#cad0d4'], [0.8, '#dee2e4'], [1, '#eceeef']],
    pix(t, v, c, n1, n2) { // golden lateral band from the eye to the tail
      const env = sstep(0.05, 0.12, t) * (1 - sstep(0.76, 0.84, t)), vc = 0.425 - 0.02 * sstep(0.5, 0.8, t);
      const k = env * (1 - sstep(0.018, 0.04, Math.abs(v - vc + 0.008 * (n2 - 0.5)))) * 0.82;
      tintPix(c, [232, 188, 46], k);
    },
    fins: {
      dorsal: { t0: 0.28, t1: 0.43, out: [[0, 0.305, 0.06], [0.2, 0.335, 0.045], [0.5, 0.375, 0.027], [0.8, 0.418, 0.012], [1, 0.445, 0.004]], ns: 14, nr: 4, gain: 0.04 },
      dorsal2: { t0: 0.465, t1: 0.515, out: [[0, 0.61, 0.17], [0.1, 0.588, 0.12], [0.3, 0.56, 0.06], [0.6, 0.548, 0.022], [1, 0.553, 0.006]], thick: 0.003, bow0: 0.03, ns: 10, nr: 7, gain: 0.04 },
      anal: { t0: 0.535, t1: 0.585, out: [[0, 0.68, 0.16], [0.1, 0.658, 0.112], [0.3, 0.632, 0.056], [0.6, 0.62, 0.02], [1, 0.622, 0.006]], thick: 0.003, bow0: 0.03, ns: 10, nr: 7, gain: 0.04 },
      caudal: TUNA_CAUDAL,
      pectoral: { t: 0.225, bl: 0.026, v0: 0.48, v1: 0.54, d0: [0.36, -0.05, -0.93], d1: [0.28, -0.16, -0.95], len: [[0, 0.22], [0.15, 0.19], [0.45, 0.1], [1, 0.022]], thick: 0.003, bow0: 0.03, ns: 10, nr: 7, gain: 0.08, tuck: 0.5, under: 'pectoralU' },
      pelvic: { t: 0.265, bl: 0.016, v0: 0.92, v1: 0.96, d0: [0.3, -0.55, -0.78], d1: [0.15, -0.4, -0.9], len: [[0, 0.055], [0.4, 0.045], [1, 0.02]], ns: 6, nr: 4, gain: 0.2, tuck: 0.4 },
    },
    finlets: TUNA_FINLETS(0.57, 0.638),
    fp: {
      dorsal: { rays: 13, spiny: true, mem: [[0, 'rgba(70,76,84,0.95)'], [1, 'rgba(204,170,60,0.85)']], ray: 'rgba(20,22,30,0.95)' },
      dorsal2: { rays: 16, mem: [[0, 'rgba(206,164,38,0.97)'], [0.5, 'rgba(236,196,50,0.96)'], [1, 'rgba(246,210,64,0.94)']], ray: 'rgba(150,110,20,0.8)', rayW: 0.16 },
      anal: { rays: 15, mem: [[0, 'rgba(210,176,60,0.97)'], [0.5, 'rgba(238,198,52,0.96)'], [1, 'rgba(246,212,66,0.94)']], ray: 'rgba(150,110,20,0.8)', rayW: 0.16 },
      caudal: { skin: true, mem: [[0, '#1c2642'], [0.6, '#151d34'], [1, '#0e1324']], sCol: [[0, 'rgba(0,0,0,0)'], [0.5, 'rgba(120,100,30,0.25)'], [1, 'rgba(0,0,0,0)']] },
      pectoral: { skin: true, mem: [[0, '#18233e'], [0.6, '#131c34'], [1, '#2c3020']] },
      pectoralU: { skin: true, mem: [[0, '#9aa2ac'], [0.7, '#5a6476'], [1, '#2a3040']] },
      pelvic: { rays: 7, mem: [[0, 'rgba(90,92,96,0.95)'], [1, 'rgba(60,62,66,0.9)']], ray: 'rgba(20,22,28,0.85)' },
      finlet: { rays: 0, base: false, noFade: true, mem: [[0, 'rgba(240,204,40,1)'], [1, 'rgba(250,220,60,1)']], edge: { w: 0.26, col: 'rgba(22,22,24,1)' } },
    },
    paint(B) {
      const { R } = B;
      // ~20 rows of broken white vertical lines and dots on the belly
      for (let i = 0; i < 22; i++) {
        const tc = 0.3 + i * 0.02 + (R() - 0.5) * 0.004;
        for (let v = 0.52 + R() * 0.03; v < 0.88; v += lerp(0.03, 0.05, R())) {
          if (R() < 0.55) B.bar(tc + (v - 0.5) * 0.01, 0.0024, 0.002, v, v + lerp(0.012, 0.03, R()), [240, 244, 248, 0.42], 1);
          else B.blob(tc, v, lerp(0.0014, 0.0022, R()), [240, 244, 248, 0.45], 0.5);
        }
      }
      mottle(B, 40, [0.1, 0.78], [0.0, 0.32], [0.01, 0.03], [6, 10, 26, 0.16], [40, 80, 150, 0.1]);
    },
  },

  // ------------------------------------------------------------------ mahi-mahi (bull)
  mahiMahi: {
    prof: [[0, -0.006, -0.006, 0], [0.008, 0.018, -0.024, 0.011], [0.02, 0.054, -0.04, 0.021], [0.04, 0.09, -0.056, 0.031], [0.07, 0.115, -0.071, 0.039], [0.11, 0.126, -0.083, 0.044], [0.17, 0.124, -0.092, 0.045], [0.25, 0.114, -0.096, 0.043], [0.34, 0.1, -0.093, 0.039], [0.43, 0.085, -0.085, 0.034], [0.52, 0.069, -0.072, 0.028], [0.6, 0.054, -0.057, 0.022], [0.68, 0.039, -0.042, 0.016], [0.74, 0.027, -0.029, 0.012], [0.78, 0.021, -0.022, 0.009], [0.8, 0.021, -0.021, 0.006], [0.815, 0.024, -0.024, 0]],
    nT: [[0, 1.9], [0.1, 1.8], [0.5, 1.8], [0.815, 1.6]], nB: [[0, 2.2], [0.3, 2.1], [0.815, 1.6]],
    wl: [[0, 0.5], [0.1, 0.48], [0.5, 0.48], [0.8, 0.5]], head: 0, nose: 0.6, body: { rings: 60, segs: 40, mix: 0.25 },
    eye: { t: 0.04, v: 0.6, r: 0.011, out: 0.42, fwd: 0.16, up: 0.05, iris: '#b48a2e', dark: '#2a1f0c', ring: '#ecc95c', depth: 0.08 },
    mouth: [[0.0, -0.007], [0.044, -0.03]], mouthCurve: 1.2,
    nostrils: [[0.026, 0.5], [0.03, 0.49]],
    op: { t: [0.11, 0.142, 0.122], v: [0.28, 0.6, 0.93] }, pre: 0.034,
    LL: [[0.14, 0.4], [0.25, 0.37], [0.45, 0.43], [0.81, 0.5]], LLpores: false,
    sc: { nl: 220, nv: 64, nrm: 0.14, edge: 0.04, jit: 0.03 },
    mat: { rough: 0.3, metal: [[0, 0.3], [0.5, 0.45], [1, 0.25]], metalLum: [0.05, 0.4], irid: 0.75, clear: 0.9, ccRough: 0.1 },
    swim: { k: 5.6, amp: 1, fIdle: 1.1, fMax: 4.4, env: [0.012, -0.03, 0.06, 0.12], knee: 0.45, shake: 0.045, thrash: 0.1, sRate: 0.85, ref: 1.1 },
    grad: [[0, '#1d5a6c'], [0.12, '#287664'], [0.25, '#5c963c'], [0.38, '#a4b238'], [0.5, '#d6bc36'], [0.65, '#e4c44a'], [0.82, '#eedb86'], [1, '#f3ebc0']],
    pix(t, v, c, n1, n2) { const k = (n1 - 0.5) * 0.5; c[0] += 30 * k; c[1] += 18 * k; c[2] -= 20 * k; },
    fins: {
      dorsal: { t0: 0.058, t1: 0.79, out: [[0, 0.072, 0.062], [0.08, 0.13, 0.09], [0.25, 0.27, 0.086], [0.45, 0.42, 0.072], [0.65, 0.57, 0.057], [0.85, 0.72, 0.04], [1, 0.81, 0.014]], ns: 40, nr: 4, gain: 0.08 },
      anal: { t0: 0.45, t1: 0.785, out: [[0, 0.475, 0.045], [0.3, 0.58, 0.052], [0.6, 0.68, 0.045], [0.85, 0.75, 0.035], [1, 0.8, 0.014]], ns: 20, nr: 4, gain: 0.08 },
      caudal: { base: [[0.806, -0.018], [0.796, 0.018]], out: [[0, 1.0, -0.13], [0.12, 0.962, -0.09], [0.3, 0.905, -0.04], [0.45, 0.876, -0.008], [0.5, 0.873, 0], [0.55, 0.876, 0.008], [0.7, 0.905, 0.04], [0.88, 0.962, 0.09], [1, 1.0, 0.13]], ns: 20, nr: 8, gain: 0.03 },
      pectoral: { t: 0.128, bl: 0.02, v0: 0.6, v1: 0.66, d0: [0.5, 0.05, -0.86], d1: [0.35, -0.2, -0.91], len: [[0, 0.1], [0.25, 0.085], [0.6, 0.05], [1, 0.02]], ns: 8, nr: 6 },
      pelvic: { t: 0.14, bl: 0.016, v0: 0.94, v1: 0.98, d0: [0.3, -0.6, -0.74], d1: [0.15, -0.4, -0.9], len: [[0, 0.075], [0.4, 0.06], [1, 0.03]] },
    },
    fp: {
      dorsal: { rays: 44, rayW: 0.22, mem: [[0, 'rgba(20,62,100,0.96)'], [1, 'rgba(36,92,140,0.88)']], ray: 'rgba(10,32,60,0.9)', spots: [{ n: 30, rr: [0.006, 0.012], col: 'rgba(60,150,210,0.6)', r: [0.1, 0.7] }] },
      anal: { rays: 24, mem: [[0, 'rgba(214,204,150,0.9)'], [1, 'rgba(120,150,170,0.75)']], ray: 'rgba(110,110,90,0.8)' },
      caudal: { rays: 22, mem: [[0, 'rgba(170,166,70,0.92)'], [1, 'rgba(100,124,110,0.82)']], ray: 'rgba(80,80,40,0.85)', edge: { w: 0.06, col: 'rgba(60,80,70,0.7)' } },
      pectoral: { rays: 14, mem: [[0, 'rgba(200,190,120,0.8)'], [1, 'rgba(160,170,140,0.55)']], ray: 'rgba(120,110,60,0.8)' },
      pelvic: { rays: 7, mem: [[0, 'rgba(220,210,150,0.85)'], [1, 'rgba(70,90,110,0.7)']], ray: 'rgba(120,110,60,0.8)' },
    },
    paint(B) {
      const { R } = B;
      const pts = B.scatter(320, { t: [0.06, 0.8], v: [0.08, 0.8], minD: 0.0085, dens: (t, v) => 1 - 0.6 * sstep(0.6, 0.8, v) });
      for (const [t, v] of pts) {
        const r = lerp(0.0016, 0.0034, R());
        if (R() < 0.7) B.blob(t, v, r, [18, 50, 80, 0.75], 0.4); else B.blob(t, v, r * 1.1, [40, 120, 210, 0.75], 0.4);
      }
      B.blob(0.05, 0.25, 0.05, [30, 100, 120, 0.25], 1, 1.4); // blue-green forehead
      mottle(B, 30, [0.1, 0.8], [0.3, 0.7], [0.02, 0.05], [200, 150, 30, 0.12], [240, 220, 100, 0.12]);
    },
  },

  // ------------------------------------------------------------------ goliath grouper
  giantGrouper: {
    prof: [[0, -0.045, -0.045, 0], [0.01, -0.017, -0.06, 0.036], [0.03, 0.014, -0.081, 0.064], [0.06, 0.05, -0.101, 0.088], [0.1, 0.085, -0.119, 0.104], [0.15, 0.116, -0.134, 0.116], [0.22, 0.139, -0.149, 0.121], [0.3, 0.153, -0.157, 0.121], [0.38, 0.155, -0.157, 0.115], [0.46, 0.148, -0.149, 0.103], [0.54, 0.132, -0.133, 0.087], [0.62, 0.109, -0.109, 0.068], [0.68, 0.087, -0.087, 0.05], [0.73, 0.069, -0.069, 0.036], [0.77, 0.06, -0.06, 0.025], [0.79, 0.062, -0.062, 0.015], [0.805, 0.066, -0.066, 0]],
    nT: [[0, 3.0], [0.15, 2.8], [0.3, 2.4], [0.5, 2.1], [0.805, 1.8]], nB: [[0, 2.4], [0.2, 2.5], [0.5, 2.2], [0.805, 1.8]],
    wl: [[0, 0.45], [0.3, 0.44], [0.8, 0.5]], head: 0, nose: 0.5, body: { rings: 60, segs: 40, mix: 0.2 },
    eye: { t: 0.085, v: 0.22, r: 0.0085, out: 0.45, fwd: 0.12, up: 0.15, iris: '#7a5a2e', dark: '#22160a', ring: '#c69a58', depth: 0.06 },
    mouth: [[0.0, -0.044], [0.15, -0.072]], mouthCurve: 1.0, mouthPt: [0.004, -0.049], bigMouth: true, detailStr: 1.3,
    op: { t: [0.27, 0.33, 0.29], v: [0.12, 0.5, 0.92] }, pre: 0.085,
    LL: [[0.3, 0.2], [0.45, 0.24], [0.65, 0.32], [0.8, 0.45]],
    sc: { nl: 130, nv: 56, nrm: 0.32, edge: 0.07, jit: 0.05 },
    mat: { rough: 0.5, metal: [[0, 0.03], [1, 0.03]], irid: 0, clear: 0.55, ccRough: 0.25 },
    swim: { k: 5.4, amp: 0.9, fIdle: 0.45, fMax: 2.2, env: [0.012, -0.03, 0.07, 0.04], knee: 0.5, shake: 0.035, thrash: 0.08, sRate: 0.55, ref: 1.8 },
    grad: [[0, '#3a3121'], [0.15, '#4a3f29'], [0.3, '#5f5136'], [0.5, '#786949'], [0.7, '#8f8163'], [0.88, '#a5997b'], [1, '#b3a98b']],
    pix(t, v, c, n1, n2) { const k = 0.75 + 0.55 * n1 + 0.15 * (n2 - 0.5); c[0] *= k; c[1] *= k; c[2] *= k * 0.96; },
    fins: {
      dorsal: { t0: 0.3, t1: 0.5, out: [[0, 0.32, 0.04], [0.3, 0.38, 0.05], [0.7, 0.46, 0.05], [1, 0.51, 0.045]], ns: 14, nr: 4, gain: 0.05 },
      dorsal2: { t0: 0.5, t1: 0.72, out: [[0, 0.52, 0.055], [0.25, 0.58, 0.075], [0.5, 0.65, 0.08], [0.75, 0.71, 0.07], [0.9, 0.74, 0.045], [1, 0.745, 0.015]], ns: 16, nr: 5, gain: 0.08 },
      anal: { t0: 0.6, t1: 0.71, out: [[0, 0.625, 0.05], [0.3, 0.665, 0.07], [0.6, 0.71, 0.07], [0.85, 0.74, 0.05], [1, 0.745, 0.015]], ns: 12, nr: 5, gain: 0.08 },
      caudal: { base: [[0.79, -0.057], [0.79, 0.057]], out: [[0, 0.885, -0.098], [0.15, 0.94, -0.087], [0.32, 0.982, -0.05], [0.5, 1.0, 0], [0.68, 0.982, 0.05], [0.85, 0.94, 0.087], [1, 0.885, 0.098]], ns: 16, nr: 8, gain: 0.04 },
      pectoral: { t: 0.29, bl: 0.045, v0: 0.6, v1: 0.72, d0: [0.55, 0.15, -0.82], d1: [0.4, -0.35, -0.85], len: [[0, 0.09], [0.3, 0.12], [0.6, 0.115], [1, 0.07]], ns: 10, nr: 6 },
      pelvic: { t: 0.33, bl: 0.03, v0: 0.9, v1: 0.95, d0: [0.4, -0.6, -0.7], d1: [0.2, -0.5, -0.84], len: [[0, 0.08], [0.4, 0.085], [1, 0.05]] },
    },
    fp: {
      dorsal: { rays: 11, spiny: true, notch: 0.12, mem: [[0, 'rgba(84,74,44,0.95)'], [1, 'rgba(110,96,60,0.85)']], ray: 'rgba(40,34,20,0.95)', spots: [{ n: 26, rr: [0.012, 0.02], col: 'rgba(24,20,12,0.85)', r: [0.1, 0.8] }] },
      dorsal2: { rays: 16, mem: [[0, 'rgba(96,84,50,0.95)'], [1, 'rgba(120,104,64,0.85)']], ray: 'rgba(50,42,24,0.9)', spots: [{ n: 50, rr: [0.01, 0.018], col: 'rgba(24,20,12,0.85)', r: [0.08, 0.85] }], edge: { w: 0.06, col: 'rgba(170,160,120,0.5)' } },
      anal: { rays: 9, mem: [[0, 'rgba(110,96,60,0.95)'], [1, 'rgba(126,110,70,0.85)']], ray: 'rgba(50,42,24,0.9)', spots: [{ n: 30, rr: [0.014, 0.024], col: 'rgba(24,20,12,0.85)', r: [0.08, 0.85] }] },
      caudal: { rays: 17, mem: [[0, 'rgba(100,88,54,0.95)'], [1, 'rgba(118,102,64,0.86)']], ray: 'rgba(50,42,24,0.9)', spots: [{ n: 70, rr: [0.008, 0.014], col: 'rgba(24,20,12,0.85)', r: [0.08, 0.9] }], edge: { w: 0.05, col: 'rgba(170,160,120,0.5)' } },
      pectoral: { rays: 18, mem: [[0, 'rgba(120,104,62,0.92)'], [1, 'rgba(136,118,74,0.78)']], ray: 'rgba(60,50,28,0.85)', spots: [{ n: 40, rr: [0.012, 0.02], col: 'rgba(30,24,14,0.8)', r: [0.1, 0.9] }] },
      pelvic: { rays: 6, mem: [[0, 'rgba(120,104,62,0.92)'], [1, 'rgba(90,78,48,0.85)']], ray: 'rgba(60,50,28,0.85)', spots: [{ n: 16, rr: [0.02, 0.035], col: 'rgba(30,24,14,0.8)', r: [0.1, 0.9] }] },
    },
    paint(B) {
      const { R } = B;
      // irregular dark oblique bars
      [0.22, 0.34, 0.46, 0.58, 0.7].forEach((tc) => B.bar(tc, lerp(0.05, 0.065, R()), 0.04, 0.02, lerp(0.62, 0.72, R()), [40, 34, 18, 0.42], 9, 0.05));
      mottle(B, 140, [0.0, 0.8], [0.0, 0.85], [0.01, 0.035], [44, 38, 20, 0.2], [190, 176, 120, 0.13]);
      const sp = B.scatter(260, { t: [0.0, 0.79], v: [0.0, 0.8], minD: 0.009, dens: (t, v) => (t < 0.3 ? 1 : 0.45) * (1 - 0.6 * sstep(0.55, 0.8, v)) });
      for (const [t, v] of sp) B.blob(t, v, lerp(0.0016, 0.0032, R()), [22, 18, 10, 0.85], 0.35);
    },
  },

  // ------------------------------------------------------------------ great barracuda
  barracuda: {
    prof: [[0, -0.008, -0.008, 0], [0.01, -0.002, -0.014, 0.006], [0.03, 0.009, -0.02, 0.013], [0.06, 0.021, -0.028, 0.021], [0.1, 0.034, -0.036, 0.029], [0.15, 0.046, -0.044, 0.036], [0.21, 0.056, -0.052, 0.042], [0.28, 0.063, -0.058, 0.045], [0.36, 0.066, -0.062, 0.046], [0.45, 0.066, -0.064, 0.044], [0.54, 0.062, -0.062, 0.04], [0.62, 0.054, -0.055, 0.034], [0.69, 0.043, -0.044, 0.026], [0.75, 0.032, -0.032, 0.018], [0.8, 0.026, -0.026, 0.012], [0.83, 0.027, -0.027, 0.007], [0.85, 0.03, -0.03, 0]],
    nT: [[0, 2.6], [0.15, 2.3], [0.4, 2.1], [0.85, 1.7]], nB: [[0, 2.4], [0.3, 2.2], [0.85, 1.7]],
    wl: [[0, 0.46], [0.3, 0.47], [0.85, 0.5]], head: 0, nose: 0.75, body: { rings: 60, segs: 36, mix: 0.25 },
    eye: { t: 0.13, v: 0.3, r: 0.0105, out: 0.4, fwd: 0.14, up: 0.08, iris: '#c8bf96', dark: '#3a382a', ring: '#ece2b0', depth: 0.07 },
    mouth: [[0.004, -0.009], [0.115, -0.018]], mouthCurve: 1.0, mouthPt: [0.004, -0.01],
    fangs: [{ q: [0.06, 0.7], n: 7, len: [0.013, 0.005], w: 0.42, dir: 1, off: -0.007 }, { q: [0.02, 0.58], n: 6, len: [0.014, 0.005], w: 0.4, dir: -1, off: 0.008 }],
    op: { t: [0.215, 0.255, 0.23], v: [0.15, 0.5, 0.92] }, pre: 0.05,
    LL: [[0.26, 0.32], [0.4, 0.42], [0.85, 0.48]],
    sc: { nl: 160, nv: 40, nrm: 0.28, edge: 0.06, jit: 0.04 },
    mat: { rough: 0.32, metal: [[0, 0.15], [0.3, 0.45], [0.6, 0.6], [1, 0.45]], irid: 0, clear: 0.88, ccRough: 0.1 },
    swim: { k: 6.4, amp: 0.95, fIdle: 0.75, fMax: 3.6, env: [0.012, -0.03, 0.075, 0.05], knee: 0.55, shake: 0.045, thrash: 0.1, sRate: 0.8, ref: 1.2 },
    grad: [[0, '#2c3a40'], [0.15, '#3c4c54'], [0.3, '#6f7f86'], [0.45, '#aab6bb'], [0.6, '#c9d0d3'], [0.8, '#e2e6e7'], [1, '#eff1f1']],
    fins: {
      dorsal: { t0: 0.37, t1: 0.42, out: [[0, 0.4, 0.06], [0.4, 0.415, 0.036], [1, 0.432, 0.006]], ns: 6, nr: 4 },
      dorsal2: { t0: 0.64, t1: 0.69, out: [[0, 0.675, 0.056], [0.3, 0.69, 0.032], [0.7, 0.7, 0.018], [1, 0.712, 0.007]], ns: 7, nr: 4 },
      anal: { t0: 0.665, t1: 0.71, out: [[0, 0.7, 0.05], [0.3, 0.712, 0.03], [0.7, 0.722, 0.016], [1, 0.733, 0.006]], ns: 7, nr: 4 },
      caudal: { base: [[0.84, -0.024], [0.84, 0.024]], out: [[0, 1.0, -0.112], [0.12, 0.962, -0.078], [0.3, 0.925, -0.035], [0.43, 0.917, -0.012], [0.5, 0.922, 0], [0.57, 0.917, 0.012], [0.7, 0.925, 0.035], [0.88, 0.962, 0.078], [1, 1.0, 0.112]], ns: 18, nr: 8 },
      pectoral: { t: 0.24, bl: 0.016, v0: 0.6, v1: 0.66, d0: [0.55, 0.0, -0.84], d1: [0.4, -0.25, -0.88], len: [[0, 0.07], [0.3, 0.064], [1, 0.03]], ns: 7, nr: 5 },
      pelvic: { t: 0.39, bl: 0.016, v0: 0.92, v1: 0.96, d0: [0.4, -0.55, -0.73], d1: [0.2, -0.45, -0.87], len: [[0, 0.055], [0.4, 0.05], [1, 0.03]] },
    },
    fp: {
      dorsal: { rays: 5, spiny: true, mem: [[0, 'rgba(60,70,76,0.92)'], [1, 'rgba(40,46,52,0.85)']], ray: 'rgba(20,24,28,0.95)' },
      dorsal2: { rays: 10, mem: [[0, 'rgba(58,66,72,0.92)'], [1, 'rgba(36,40,46,0.88)']], ray: 'rgba(20,24,28,0.9)', corner: { s: 0, r: 1, rad: 0.35, col: 'rgba(236,238,236,0.9)' } },
      anal: { rays: 10, mem: [[0, 'rgba(150,158,162,0.9)'], [1, 'rgba(46,52,58,0.88)']], ray: 'rgba(30,34,38,0.9)', corner: { s: 0, r: 1, rad: 0.35, col: 'rgba(236,238,236,0.9)' } },
      caudal: { rays: 19, mem: [[0, 'rgba(70,78,84,0.95)'], [1, 'rgba(24,28,32,0.92)']], ray: 'rgba(16,18,22,0.9)', corner: { s: 0, r: 1, rad: 0.18, col: 'rgba(238,240,238,0.95)' }, corner2: { s: 1, r: 1, rad: 0.18, col: 'rgba(238,240,238,0.95)' } },
      pectoral: { rays: 13, mem: [[0, 'rgba(190,196,198,0.75)'], [1, 'rgba(150,160,166,0.5)']], ray: 'rgba(110,116,120,0.8)' },
      pelvic: { rays: 6, mem: [[0, 'rgba(210,214,214,0.8)'], [1, 'rgba(170,178,180,0.55)']], ray: 'rgba(120,126,130,0.8)' },
      teeth: {},
    },
    paint(B) {
      const { R } = B;
      for (let i = 0; i < 20; i++) { // dark oblique bars on the upper flank
        const tc = 0.24 + i * 0.029 + (R() - 0.5) * 0.006;
        B.bar(tc, lerp(0.009, 0.013, R()), 0.006, 0.02, lerp(0.32, 0.4, R()), [28, 36, 42, 0.6], 3, 0.03);
      }
      const bl = B.scatter(8, { t: [0.5, 0.82], v: [0.48, 0.76], minD: 0.045 });
      for (const [t, v] of bl) B.irregular(t, v, lerp(0.006, 0.011, R()), [14, 14, 18, 0.85]);
      B.blob(0.06, 0.15, 0.06, [30, 40, 46, 0.3], 1, 2.5);
    },
  },
};

const SPECIES = {
  brownTrout: {
    prof: [[0, 0, 0, 0], [0.008, 0.015, -0.012, 0.012], [0.02, 0.029, -0.023, 0.021], [0.05, 0.048, -0.04, 0.034], [0.09, 0.065, -0.055, 0.043], [0.14, 0.079, -0.067, 0.05], [0.21, 0.09, -0.077, 0.054], [0.29, 0.099, -0.088, 0.056], [0.37, 0.103, -0.095, 0.055], [0.45, 0.099, -0.096, 0.05], [0.54, 0.087, -0.087, 0.042], [0.63, 0.07, -0.071, 0.032], [0.71, 0.053, -0.053, 0.022], [0.78, 0.044, -0.042, 0.014], [0.825, 0.045, -0.043, 0.008], [0.85, 0.049, -0.047, 0]],
    nT: [[0, 2.3], [0.3, 2.0], [0.7, 1.8], [0.85, 1.6]], nB: [[0, 2.3], [0.4, 2.3], [0.7, 1.9], [0.85, 1.6]], wl: 0.42,
    eye: { t: 0.062, v: 0.3, r: 0.0155, out: 0.38, fwd: 0.12, up: 0.04, iris: '#b48a3c', dark: '#4a3214', ring: '#e8cf86' },
    mouth: [[0.0, -0.004], [0.105, -0.03]],
    op: { t: [0.165, 0.205, 0.175], v: [0.14, 0.5, 0.93] }, pre: 0.042,
    LL: [[0.2, 0.3], [0.32, 0.41], [0.55, 0.45], [0.85, 0.47]],
    sc: { nl: 120, nv: 38, nrm: 0.24, edge: 0.05, jit: 0.05 },
    mat: { rough: 0.42, metal: [[0, 0.04], [0.5, 0.14], [1, 0.16]], irid: 0.18, clear: 0.85 },
    swim: SALMONID_SWIM,
    grad: [[0, '#38361e'], [0.12, '#484424'], [0.27, '#6a5f30'], [0.42, '#a08443'], [0.56, '#c6a252'], [0.7, '#d7ba68'], [0.85, '#e8d6a0'], [1, '#f2e9cf']],
    fins: {
      dorsal: { t0: 0.37, t1: 0.48, len: [[0, 0.04], [0.12, 0.105], [0.3, 0.1], [0.7, 0.064], [1, 0.034]], rake: [[0, 28], [0.2, 32], [1, 56]] },
      adipose: { t0: 0.70, t1: 0.745, h: 0.022 },
      anal: { t0: 0.625, t1: 0.70, len: [[0, 0.03], [0.12, 0.075], [0.35, 0.07], [1, 0.034]], rake: [[0, 30], [1, 52]] },
      caudal: { spread: 21, fork: 0.12, pw: 1.6, round: 0.3, d0: 0.7 },
      pectoral: { t: 0.212, bl: 0.022, v0: 0.72, v1: 0.8, d0: [0.85, -0.08, -1], d1: [0.5, -0.5, -1], len: [[0, 0.1], [0.35, 0.095], [1, 0.052]] },
      pelvic: { t: 0.47, bl: 0.022, v0: 0.86, v1: 0.93, d0: [0.42, -0.42, -1], d1: [0.18, -0.6, -1], len: [[0, 0.074], [0.4, 0.064], [1, 0.04]] },
    },
    fp: {
      dorsal: { rays: 12, mem: [[0, 'rgba(88,76,44,0.9)'], [0.5, 'rgba(108,94,58,0.72)'], [1, 'rgba(122,106,70,0.55)']], ray: 'rgba(62,50,28,0.9)', spots: [{ n: 16, rr: [0.018, 0.03], col: 'rgba(18,14,10,0.92)', r: [0.08, 0.75] }, { n: 3, rr: [0.016, 0.024], col: 'rgba(190,50,30,0.9)', r: [0.1, 0.5] }], edge: { w: 0.07, col: 'rgba(235,225,195,0.55)' } },
      caudal: { rays: 19, mem: [[0, 'rgba(88,76,44,0.9)'], [1, 'rgba(104,88,54,0.62)']], ray: 'rgba(60,48,28,0.9)', spots: [{ n: 8, rr: [0.012, 0.02], col: 'rgba(20,16,12,0.85)', r: [0.05, 0.4], s: [0.55, 0.95] }], edge: { w: 0.06, col: 'rgba(55,44,26,0.6)' } },
      anal: { rays: 10, mem: [[0, 'rgba(176,136,66,0.85)'], [1, 'rgba(196,146,78,0.6)']], ray: 'rgba(120,88,40,0.85)', lead: { w: 0.12, col: 'rgba(242,236,214,0.9)' } },
      pelvic: { rays: 9, mem: [[0, 'rgba(180,138,66,0.85)'], [1, 'rgba(198,148,80,0.6)']], ray: 'rgba(120,88,40,0.85)', lead: { w: 0.12, col: 'rgba(242,236,214,0.9)' } },
      pectoral: { rays: 13, mem: [[0, 'rgba(160,122,64,0.8)'], [1, 'rgba(186,136,78,0.5)']], ray: 'rgba(110,80,40,0.85)', lead: { w: 0.07, col: 'rgba(235,228,205,0.7)' } },
      adipose: { mem: [[0, 'rgba(84,72,40,0.97)'], [1, 'rgba(110,90,50,0.97)']], edge: { w: 0.4, col: 'rgba(214,72,34,0.97)' } },
    },
    paint(B) {
      const { R } = B;
      for (let i = 0; i < 45; i++) B.blob(lerp(0.04, 0.82, R()), lerp(0, 0.22, R()), lerp(0.01, 0.025, R()), [36, 32, 16, 0.16], 1, lerp(1, 2.2, R()));
      const blk = B.scatter(95, { t: [0.05, 0.8], v: [0.0, 0.62], minD: 0.0145, dens: (t, v) => (1 - sstep(0.38, 0.64, v)) * (t < 0.12 ? 0.5 : 1) });
      for (const [t, v] of blk) {
        const r = lerp(0.0033, 0.0068, R()) * (1 - 0.35 * sstep(0.35, 0.6, v)) * (t < 0.2 ? 0.75 : 1);
        if (v > 0.12) B.blob(t, v, r * 1.8, [214, 205, 170, 0.33], 0.7);
        B.irregular(t, v, r, [16, 12, 9, 0.93]);
      }
      const red = B.scatter(26, { t: [0.2, 0.8], v: [0.36, 0.68], minD: 0.028 });
      for (const [t, v] of red) {
        const r = lerp(0.0034, 0.0055, R());
        B.blob(t, v, r * 1.95, [232, 236, 236, 0.85], 0.4);
        B.blob(t, v, r, [196, 42, 26, 0.96], 0.18);
      }
    },
  },
  rainbowTrout: {
    prof: [[0, 0, 0, 0], [0.008, 0.012, -0.011, 0.011], [0.02, 0.025, -0.02, 0.019], [0.05, 0.046, -0.039, 0.033], [0.09, 0.064, -0.055, 0.043], [0.14, 0.08, -0.069, 0.051], [0.21, 0.093, -0.081, 0.055], [0.29, 0.103, -0.092, 0.057], [0.37, 0.106, -0.099, 0.056], [0.45, 0.101, -0.099, 0.051], [0.54, 0.088, -0.089, 0.042], [0.63, 0.07, -0.072, 0.032], [0.71, 0.053, -0.053, 0.021], [0.78, 0.043, -0.042, 0.013], [0.825, 0.045, -0.043, 0.008], [0.85, 0.05, -0.048, 0]],
    nT: [[0, 2.3], [0.3, 2.0], [0.7, 1.8], [0.85, 1.6]], nB: [[0, 2.3], [0.4, 2.3], [0.7, 1.9], [0.85, 1.6]], wl: 0.42,
    eye: { t: 0.058, v: 0.3, r: 0.0155, out: 0.38, fwd: 0.12, up: 0.04, iris: '#a8986a', dark: '#3c3624', ring: '#d8c890' },
    mouth: [[0.0, -0.004], [0.095, -0.028]],
    op: { t: [0.16, 0.198, 0.17], v: [0.14, 0.5, 0.93] }, pre: 0.04,
    LL: [[0.2, 0.3], [0.32, 0.42], [0.55, 0.46], [0.85, 0.48]],
    sc: { nl: 130, nv: 40, nrm: 0.34, edge: 0.06, jit: 0.05 },
    mat: { rough: 0.36, metal: [[0, 0.08], [0.25, 0.25], [0.5, 0.48], [1, 0.4]], irid: 0.4, clear: 0.85 },
    swim: SALMONID_SWIM,
    grad: [[0, '#2b423c'], [0.14, '#3a584d'], [0.28, '#6c867a'], [0.42, '#a8b4ad'], [0.56, '#c9cdcc'], [0.72, '#dbdedd'], [0.86, '#eeeeeb'], [1, '#f7f5f1']],
    pix(t, v, c, n1) {
      const m = (1 - sstep(0.04, 0.12, Math.abs(v - 0.47 + 0.03 * (n1 - 0.5)))) * sstep(0.1, 0.2, t) * (1 - sstep(0.78, 0.86, t));
      const k = m * 0.62; c[0] = lerp(c[0], 214, k); c[1] = lerp(c[1], 96, k); c[2] = lerp(c[2], 128, k);
    },
    fins: {
      dorsal: { t0: 0.37, t1: 0.475, len: [[0, 0.04], [0.12, 0.1], [0.3, 0.095], [0.7, 0.062], [1, 0.034]], rake: [[0, 28], [0.2, 32], [1, 56]] },
      adipose: { t0: 0.70, t1: 0.742, h: 0.021 },
      anal: { t0: 0.625, t1: 0.70, len: [[0, 0.03], [0.12, 0.074], [0.35, 0.068], [1, 0.034]], rake: [[0, 30], [1, 52]] },
      caudal: { spread: 22, fork: 0.18, pw: 1.4, round: 0.28, d0: 0.72 },
      pectoral: { t: 0.207, bl: 0.022, v0: 0.72, v1: 0.8, d0: [0.85, -0.08, -1], d1: [0.5, -0.5, -1], len: [[0, 0.098], [0.35, 0.092], [1, 0.05]] },
      pelvic: { t: 0.47, bl: 0.022, v0: 0.86, v1: 0.93, d0: [0.42, -0.42, -1], d1: [0.18, -0.6, -1], len: [[0, 0.072], [0.4, 0.062], [1, 0.04]] },
    },
    fp: {
      dorsal: { rays: 12, mem: [[0, 'rgba(104,116,100,0.85)'], [1, 'rgba(150,150,140,0.55)']], ray: 'rgba(70,74,64,0.9)', spots: [{ n: 34, rr: [0.012, 0.02], col: 'rgba(22,22,24,0.9)', r: [0.05, 0.85] }], edge: { w: 0.06, col: 'rgba(240,240,236,0.6)' } },
      caudal: { rays: 19, mem: [[0, 'rgba(104,114,100,0.88)'], [1, 'rgba(140,140,130,0.58)']], ray: 'rgba(66,70,60,0.9)', spots: [{ n: 70, rr: [0.008, 0.014], col: 'rgba(22,22,24,0.9)', r: [0.05, 0.9] }] },
      anal: { rays: 10, mem: [[0, 'rgba(204,170,160,0.75)'], [1, 'rgba(222,200,190,0.5)']], ray: 'rgba(150,120,110,0.8)', lead: { w: 0.1, col: 'rgba(246,244,240,0.9)' } },
      pelvic: { rays: 9, mem: [[0, 'rgba(206,172,160,0.75)'], [1, 'rgba(222,200,190,0.5)']], ray: 'rgba(150,120,110,0.8)', lead: { w: 0.1, col: 'rgba(246,244,240,0.9)' } },
      pectoral: { rays: 13, mem: [[0, 'rgba(196,176,160,0.7)'], [1, 'rgba(214,200,188,0.45)']], ray: 'rgba(140,120,108,0.8)' },
      adipose: { mem: [[0, 'rgba(90,108,94,0.97)'], [1, 'rgba(110,120,104,0.97)']], spots: [{ n: 6, rr: [0.03, 0.05], col: 'rgba(20,20,22,0.95)', r: [0.1, 0.8] }], edge: { w: 0.18, col: 'rgba(30,32,30,0.95)' } },
    },
    paint(B) {
      const { R } = B;
      B.blob(0.155, 0.52, 0.032, [214, 110, 130, 0.5], 0.9, 1.3);
      const pts = B.scatter(270, { t: [0.04, 0.845], v: [0, 0.64], minD: 0.0074, dens: (t, v) => 1 - sstep(0.4, 0.66, v) });
      for (const [t, v] of pts) B.irregular(t, v, lerp(0.0018, 0.0034, R()), [20, 20, 24, 0.9]);
    },
  },

  grayling: {
    prof: [[0, 0.004, 0.004, 0], [0.02, 0.02, -0.011, 0.013], [0.05, 0.038, -0.028, 0.025], [0.09, 0.056, -0.045, 0.034], [0.15, 0.076, -0.062, 0.042], [0.22, 0.09, -0.077, 0.046], [0.3, 0.098, -0.088, 0.047], [0.38, 0.099, -0.092, 0.045], [0.47, 0.09, -0.088, 0.04], [0.56, 0.075, -0.077, 0.032], [0.64, 0.058, -0.062, 0.024], [0.72, 0.043, -0.045, 0.016], [0.78, 0.036, -0.036, 0.011], [0.81, 0.038, -0.038, 0.007], [0.83, 0.042, -0.042, 0]],
    nT: [[0, 2.2], [0.3, 1.8], [0.7, 1.7], [0.83, 1.6]], nB: [[0, 2.2], [0.4, 2.1], [0.7, 1.8], [0.83, 1.6]], wl: 0.44, head: 0.07,
    eye: { t: 0.056, v: 0.3, r: 0.0165, out: 0.4, fwd: 0.14, up: 0.04, iris: '#c9a042', dark: '#4a3412', ring: '#f0d890', tear: true },
    mouth: [[0.006, -0.004], [0.045, -0.016]],
    op: { t: [0.14, 0.175, 0.15], v: [0.14, 0.5, 0.93] }, pre: 0.035,
    LL: [[0.17, 0.3], [0.3, 0.42], [0.55, 0.47], [0.83, 0.48]],
    sc: { nl: 85, nv: 26, nrm: 0.6, edge: 0.16, jit: 0.07 },
    mat: { rough: 0.34, metal: [[0, 0.1], [0.3, 0.32], [0.6, 0.5], [1, 0.42]], irid: 0.5, clear: 0.85 },
    swim: SALMONID_SWIM,
    grad: [[0, '#323d3c'], [0.14, '#4a5756'], [0.3, '#7d8888'], [0.45, '#a7acae'], [0.6, '#bfc0c2'], [0.78, '#d6d4d2'], [1, '#ece8e2']],
    pix(t, v, c, n1) { const k = (n1 - 0.5) * 30 * (1 - v), b = sstep(0.25, 0.5, v) * (1 - sstep(0.6, 0.85, v)) * 0.18; c[0] += k * 0.6 + b * 40; c[1] += b * 18; c[2] += k - b * 10; },
    fins: {
      dorsal: { t0: 0.255, t1: 0.5, len: [[0, 0.03], [0.08, 0.075], [0.4, 0.105], [0.8, 0.135], [0.94, 0.13], [1, 0.11]], rake: [[0, 22], [0.5, 34], [1, 52]], ns: 18, nr: 8 },
      adipose: { t0: 0.70, t1: 0.735, h: 0.018 },
      anal: { t0: 0.62, t1: 0.69, len: [[0, 0.03], [0.12, 0.068], [0.4, 0.06], [1, 0.03]], rake: [[0, 30], [1, 52]] },
      caudal: { spread: 22, fork: 0.36, pw: 1.25, round: 0.22, d0: 0.78 },
      pectoral: { t: 0.185, bl: 0.022, v0: 0.74, v1: 0.82, d0: [0.85, -0.1, -1], d1: [0.5, -0.52, -1], len: [[0, 0.095], [0.35, 0.088], [1, 0.05]] },
      pelvic: { t: 0.43, bl: 0.024, v0: 0.86, v1: 0.93, d0: [0.45, -0.42, -1], d1: [0.2, -0.6, -1], len: [[0, 0.085], [0.4, 0.074], [1, 0.045]] },
    },
    fp: {
      dorsal: { rays: 22, mem: [[0, 'rgba(66,56,76,0.9)'], [0.6, 'rgba(84,62,94,0.84)'], [1, 'rgba(96,60,92,0.78)']], ray: 'rgba(36,28,42,0.92)',
        spots: [{ n: 20, rr: [0.012, 0.02], col: 'rgba(24,20,28,0.85)', r: [0.05, 0.4], s: [0.0, 0.4] }, { n: 60, rr: [0.01, 0.017], col: 'rgba(206,52,72,0.92)', r: [0.12, 0.8], asp: 0.7 }, { n: 34, rr: [0.008, 0.014], col: 'rgba(64,176,170,0.9)', r: [0.15, 0.78], asp: 0.7 }],
        edge: { w: 0.11, col: 'rgba(226,60,92,0.96)' }, subEdge: { at: 0.86, w: 0.025, col: 'rgba(24,20,30,0.92)' } },
      caudal: { rays: 19, mem: [[0, 'rgba(92,86,100,0.88)'], [1, 'rgba(120,108,122,0.58)']], ray: 'rgba(60,54,66,0.9)', edge: { w: 0.07, col: 'rgba(70,50,70,0.6)' } },
      anal: { rays: 10, mem: [[0, 'rgba(120,104,124,0.82)'], [1, 'rgba(140,120,140,0.55)']], ray: 'rgba(80,66,84,0.85)' },
      pelvic: { rays: 10, mem: [[0, 'rgba(150,104,112,0.88)'], [1, 'rgba(164,92,112,0.66)']], ray: 'rgba(100,60,74,0.85)', stripes: { n: 4, col: 'rgba(110,36,70,0.55)' } },
      pectoral: { rays: 13, mem: [[0, 'rgba(178,164,140,0.7)'], [1, 'rgba(196,180,156,0.45)']], ray: 'rgba(120,108,90,0.8)' },
      adipose: { mem: [[0, 'rgba(84,92,94,0.97)'], [1, 'rgba(110,112,114,0.97)']] },
    },
    paint(B) {
      const { R } = B, nv = B.def.sc.nv;
      for (let j = 1; j < nv * 0.8; j++) { const v = j / nv; B.line(0.19, B.tail, v, [34, 32, 44, 0.3 * (1 - v)], 1.8); }
      const pts = B.scatter(16, { t: [0.19, 0.44], v: [0.2, 0.7], minD: 0.018 });
      for (const [t, v] of pts) B.irregular(t, v, lerp(0.003, 0.0055, R()), [22, 20, 26, 0.9]);
      B.blob(0.45, 0.45, 0.12, [150, 110, 160, 0.13], 1, 2.5);
      B.blob(0.3, 0.33, 0.06, [176, 140, 90, 0.14], 1, 2);
    },
  },

  arcticChar: {
    prof: [[0, 0, 0, 0], [0.008, 0.012, -0.011, 0.011], [0.02, 0.025, -0.02, 0.019], [0.05, 0.045, -0.038, 0.032], [0.09, 0.062, -0.054, 0.042], [0.14, 0.076, -0.067, 0.049], [0.21, 0.087, -0.079, 0.053], [0.29, 0.096, -0.09, 0.055], [0.37, 0.099, -0.096, 0.054], [0.45, 0.095, -0.096, 0.05], [0.54, 0.084, -0.087, 0.042], [0.63, 0.068, -0.071, 0.032], [0.71, 0.051, -0.052, 0.021], [0.78, 0.041, -0.041, 0.013], [0.825, 0.043, -0.042, 0.008], [0.85, 0.048, -0.047, 0]],
    nT: [[0, 2.3], [0.3, 2.0], [0.7, 1.8], [0.85, 1.6]], nB: [[0, 2.3], [0.4, 2.4], [0.7, 1.9], [0.85, 1.6]], wl: 0.42,
    eye: { t: 0.06, v: 0.3, r: 0.015, out: 0.38, fwd: 0.12, up: 0.04, iris: '#b8a878', dark: '#40382a', ring: '#e6dcb2' },
    mouth: [[0.0, -0.004], [0.1, -0.028]],
    op: { t: [0.165, 0.2, 0.172], v: [0.14, 0.5, 0.93] }, pre: 0.04,
    LL: [[0.2, 0.3], [0.32, 0.41], [0.55, 0.45], [0.85, 0.47]],
    sc: { nl: 140, nv: 44, nrm: 0.25, edge: 0.03, jit: 0.04 },
    mat: { rough: 0.4, metal: [[0, 0.04], [0.5, 0.12], [1, 0.08]], irid: 0.15, clear: 0.85 },
    swim: SALMONID_SWIM,
    grad: [[0, '#22322d'], [0.14, '#31453c'], [0.3, '#4d604e'], [0.44, '#6f7c5a'], [0.54, '#a8783e'], [0.64, '#d4692a'], [0.8, '#e2542a'], [1, '#e86a3c']],
    fins: {
      dorsal: { t0: 0.38, t1: 0.48, len: [[0, 0.04], [0.12, 0.098], [0.3, 0.094], [0.7, 0.06], [1, 0.032]], rake: [[0, 28], [0.2, 32], [1, 56]] },
      adipose: { t0: 0.71, t1: 0.75, h: 0.02 },
      anal: { t0: 0.63, t1: 0.70, len: [[0, 0.03], [0.12, 0.074], [0.35, 0.068], [1, 0.034]], rake: [[0, 30], [1, 52]] },
      caudal: { spread: 22, fork: 0.24, pw: 1.4, round: 0.28, d0: 0.74 },
      pectoral: { t: 0.208, bl: 0.022, v0: 0.72, v1: 0.8, d0: [0.85, -0.08, -1], d1: [0.5, -0.5, -1], len: [[0, 0.1], [0.35, 0.094], [1, 0.05]] },
      pelvic: { t: 0.48, bl: 0.022, v0: 0.86, v1: 0.93, d0: [0.42, -0.42, -1], d1: [0.18, -0.6, -1], len: [[0, 0.074], [0.4, 0.064], [1, 0.04]] },
    },
    fp: {
      dorsal: { rays: 12, mem: [[0, 'rgba(62,76,64,0.9)'], [1, 'rgba(88,98,86,0.6)']], ray: 'rgba(40,50,40,0.9)', spots: [{ n: 10, rr: [0.012, 0.02], col: 'rgba(200,196,160,0.5)', r: [0.1, 0.6] }] },
      caudal: { rays: 19, mem: [[0, 'rgba(62,72,62,0.9)'], [1, 'rgba(90,94,84,0.62)']], ray: 'rgba(40,48,40,0.9)', sCol: [[0, 'rgba(200,90,50,0.35)'], [0.3, 'rgba(200,90,50,0)'], [1, 'rgba(0,0,0,0)']] },
      anal: { rays: 10, mem: [[0, 'rgba(212,92,44,0.92)'], [1, 'rgba(226,110,60,0.78)']], ray: 'rgba(160,60,30,0.85)', lead: { w: 0.1, col: 'rgba(252,252,248,1)', black: 'rgba(18,16,16,0.92)' } },
      pelvic: { rays: 9, mem: [[0, 'rgba(214,92,44,0.92)'], [1, 'rgba(226,110,60,0.78)']], ray: 'rgba(160,60,30,0.85)', lead: { w: 0.11, col: 'rgba(252,252,248,1)', black: 'rgba(18,16,16,0.92)' } },
      pectoral: { rays: 13, mem: [[0, 'rgba(206,96,50,0.9)'], [1, 'rgba(222,114,64,0.7)']], ray: 'rgba(150,60,30,0.85)', lead: { w: 0.08, col: 'rgba(252,252,248,1)', black: 'rgba(18,16,16,0.9)' } },
      adipose: { mem: [[0, 'rgba(52,66,56,0.97)'], [1, 'rgba(70,80,66,0.97)']] },
    },
    paint(B) {
      const { R } = B;
      const pts = B.scatter(110, { t: [0.12, 0.84], v: [0.03, 0.66], minD: 0.013 });
      for (const [t, v] of pts) {
        const lo = sstep(0.4, 0.62, v), r = lerp(0.0028, 0.005, R()) * (1 - 0.3 * (1 - sstep(0.05, 0.3, v)));
        B.blob(t, v, r, [lerp(232, 250, lo), lerp(222, 172, lo), lerp(186, 122, lo), lerp(0.72, 0.85, lo)], 0.35);
      }
      B.blob(0.06, 0.95, 0.03, [236, 230, 214, 0.6], 0.9, 2);
    },
  },
  pike: {
    prof: [[0, 0, 0, 0], [0.006, 0.006, -0.006, 0.011], [0.02, 0.011, -0.012, 0.019], [0.05, 0.018, -0.02, 0.026], [0.09, 0.028, -0.03, 0.032], [0.13, 0.041, -0.038, 0.04], [0.19, 0.054, -0.047, 0.046], [0.26, 0.064, -0.057, 0.048], [0.34, 0.07, -0.065, 0.047], [0.44, 0.073, -0.071, 0.045], [0.54, 0.072, -0.072, 0.041], [0.63, 0.064, -0.066, 0.033], [0.71, 0.05, -0.052, 0.022], [0.79, 0.035, -0.036, 0.013], [0.84, 0.034, -0.034, 0.008], [0.865, 0.038, -0.037, 0]],
    nT: [[0, 3.0], [0.2, 2.6], [0.4, 2.2], [0.8, 1.8]], nB: [[0, 2.8], [0.3, 2.4], [0.8, 1.8]], wl: 0.48, head: 0.0, nose: 0.4,
    eye: { t: 0.122, v: 0.235, r: 0.0165, out: 0.42, fwd: 0.18, up: 0.25, iris: '#d8b030', dark: '#5a4210', ring: '#f6e27a' },
    mouth: [[0.0, -0.001], [0.13, -0.014]], mouthCurve: 1.0, teeth: true,
    op: { t: [0.2, 0.255, 0.23], v: [0.1, 0.5, 0.93] }, pre: 0.05,
    LL: [[0.25, 0.3], [0.4, 0.44], [0.86, 0.48]],
    sc: { nl: 115, nv: 34, nrm: 0.36, edge: 0.06, jit: 0.05 },
    mat: { rough: 0.36, metal: [[0, 0.05], [0.5, 0.1], [1, 0.08]], irid: 0.1, clear: 0.9 },
    swim: { k: 6.8, amp: 0.95, fIdle: 0.7, fMax: 4.0 },
    grad: [[0, '#28301b'], [0.12, '#343f22'], [0.3, '#46522c'], [0.5, '#5b6534'], [0.68, '#85844e'], [0.84, '#d5cc98'], [1, '#ece6c6']],
    fins: {
      dorsal: { t0: 0.63, t1: 0.75, len: [[0, 0.03], [0.15, 0.072], [0.5, 0.08], [0.85, 0.07], [1, 0.05]], rake: [[0, 25], [1, 50]], ns: 14 },
      anal: { t0: 0.645, t1: 0.755, len: [[0, 0.028], [0.15, 0.066], [0.5, 0.074], [0.85, 0.064], [1, 0.045]], rake: [[0, 28], [1, 52]], ns: 14 },
      caudal: { spread: 24, fork: 0.3, pw: 1.2, round: 0.45, d0: 0.6 },
      pectoral: { t: 0.258, bl: 0.022, v0: 0.76, v1: 0.84, d0: [0.85, -0.1, -1], d1: [0.5, -0.52, -1], len: [[0, 0.085], [0.35, 0.08], [1, 0.045]] },
      pelvic: { t: 0.49, bl: 0.022, v0: 0.86, v1: 0.93, d0: [0.42, -0.42, -1], d1: [0.18, -0.6, -1], len: [[0, 0.068], [0.4, 0.06], [1, 0.036]] },
    },
    fp: {
      dorsal: { rays: 17, mem: [[0, 'rgba(116,96,56,0.9)'], [1, 'rgba(150,96,58,0.72)']], ray: 'rgba(70,56,30,0.9)', mottle: { n: 22, rr: [0.03, 0.06], col: 'rgba(36,38,22,0.72)' } },
      anal: { rays: 16, mem: [[0, 'rgba(130,100,58,0.9)'], [1, 'rgba(164,100,60,0.72)']], ray: 'rgba(76,58,30,0.9)', mottle: { n: 14, rr: [0.04, 0.07], col: 'rgba(36,38,22,0.7)' } },
      caudal: { rays: 19, mem: [[0, 'rgba(110,96,56,0.9)'], [1, 'rgba(146,98,58,0.7)']], ray: 'rgba(66,54,30,0.9)', mottle: { n: 30, rr: [0.025, 0.05], col: 'rgba(36,38,22,0.72)' } },
      pectoral: { rays: 13, mem: [[0, 'rgba(198,160,92,0.72)'], [1, 'rgba(214,166,104,0.5)']], ray: 'rgba(140,110,60,0.8)' },
      pelvic: { rays: 10, mem: [[0, 'rgba(200,160,92,0.76)'], [1, 'rgba(214,160,100,0.55)']], ray: 'rgba(140,110,60,0.8)' },
    },
    paint(B) {
      const { R } = B;
      for (let i = 0; i < 60; i++) B.blob(lerp(0.02, 0.86, R()), lerp(0, 0.3, R()), lerp(0.006, 0.016, R()), [30, 40, 18, 0.22], 0.8, lerp(1.5, 3, R()), R() * 3);
      let t = 0.235;
      while (t < 0.85) {
        let v = 0.08 + R() * 0.05;
        while (v < 0.8) {
          if (R() > 0.12) {
            const r = lerp(0.0033, 0.0052, R()) * (v > 0.65 ? 0.75 : 1);
            B.blob(t + (R() - 0.5) * 0.012 + v * 0.02, v, r, [214, 206, 142, 0.9], 0.35, lerp(1.6, 2.6, R()), (R() - 0.5) * 0.7);
          }
          v += lerp(0.05, 0.085, R());
        }
        t += lerp(0.017, 0.025, R());
      }
      const ch = B.scatter(30, { t: [0.13, 0.24], v: [0.2, 0.75], minD: 0.008 });
      for (const [tt, v] of ch) B.blob(tt, v, lerp(0.0018, 0.003, R()), [206, 198, 140, 0.75], 0.4, lerp(1.2, 2.2, R()), R() * 3);
      for (let i = 0; i < 9; i++) B.blob(lerp(0.02, 0.12, i / 8), 0.97, 0.0016, [40, 40, 30, 0.7], 0.3);
    },
  },

  perch: {
    prof: [[0, 0, 0, 0], [0.02, 0.016, -0.016, 0.014], [0.05, 0.034, -0.035, 0.027], [0.09, 0.054, -0.055, 0.038], [0.14, 0.082, -0.072, 0.047], [0.2, 0.117, -0.088, 0.053], [0.27, 0.142, -0.1, 0.056], [0.34, 0.148, -0.108, 0.055], [0.42, 0.14, -0.11, 0.05], [0.5, 0.118, -0.104, 0.043], [0.58, 0.094, -0.09, 0.034], [0.66, 0.07, -0.068, 0.024], [0.73, 0.05, -0.047, 0.015], [0.79, 0.044, -0.041, 0.01], [0.83, 0.048, -0.044, 0]],
    nT: [[0, 2.0], [0.2, 1.75], [0.5, 1.7], [0.83, 1.55]], nB: [[0, 2.2], [0.5, 2.0], [0.83, 1.6]], wl: 0.4,
    eye: { t: 0.075, v: 0.26, r: 0.02, out: 0.42, fwd: 0.14, up: 0.06, iris: '#d8862a', dark: '#5a2a10', ring: '#f2c25a' },
    mouth: [[0.0, -0.002], [0.085, -0.022]],
    op: { t: [0.2, 0.25, 0.215], v: [0.16, 0.48, 0.93] }, pre: 0.05, spine: true,
    LL: [[0.24, 0.25], [0.4, 0.3], [0.6, 0.38], [0.83, 0.46]],
    sc: { nl: 65, nv: 22, nrm: 0.55, edge: 0.14, jit: 0.07 },
    mat: { rough: 0.42, metal: [[0, 0.05], [0.5, 0.16], [1, 0.12]], irid: 0.15, clear: 0.8 },
    swim: { k: 5.6, amp: 0.85, fIdle: 1.3, fMax: 5.0 },
    grad: [[0, '#2a381c'], [0.12, '#3c5024'], [0.3, '#6d7d32'], [0.45, '#98a040'], [0.6, '#b8b45a'], [0.75, '#d2cb8a'], [0.88, '#e8e2c0'], [1, '#f3eedc']],
    fins: {
      dorsal: { t0: 0.265, t1: 0.47, len: [[0, 0.04], [0.15, 0.085], [0.4, 0.09], [0.75, 0.06], [1, 0.03]], rake: [[0, 18], [1, 40]], ns: 16, nr: 6 },
      dorsal2: { t0: 0.485, t1: 0.625, len: [[0, 0.05], [0.12, 0.075], [0.5, 0.068], [1, 0.035]], rake: [[0, 25], [1, 52]], ns: 12 },
      anal: { t0: 0.6, t1: 0.67, len: [[0, 0.03], [0.15, 0.07], [0.5, 0.066], [1, 0.035]], rake: [[0, 25], [1, 48]] },
      caudal: { spread: 26, fork: 0.18, pw: 1.4, round: 0.4, d0: 0.65 },
      pectoral: { t: 0.248, bl: 0.026, v0: 0.48, v1: 0.62, d0: [0.62, 0.22, -1], d1: [0.42, -0.5, -1], len: [[0, 0.09], [0.4, 0.088], [1, 0.05]] },
      pelvic: { t: 0.265, bl: 0.024, v0: 0.88, v1: 0.94, d0: [0.4, -0.55, -1], d1: [0.15, -0.7, -1], len: [[0, 0.08], [0.4, 0.07], [1, 0.045]] },
    },
    fp: {
      dorsal: { rays: 14, spiny: true, notch: 0.15, mem: [[0, 'rgba(118,124,94,0.88)'], [1, 'rgba(146,146,124,0.68)']], ray: 'rgba(46,46,36,0.95)', blotch: { s: [0.72, 1.0], r: [0.12, 0.85], col: 'rgba(16,16,20,0.92)' }, edge: { w: 0.08, col: 'rgba(40,40,36,0.6)' } },
      dorsal2: { rays: 13, mem: [[0, 'rgba(150,152,90,0.78)'], [1, 'rgba(172,166,110,0.55)']], ray: 'rgba(90,90,50,0.85)' },
      anal: { rays: 10, mem: [[0, 'rgba(228,96,36,0.93)'], [1, 'rgba(240,112,46,0.82)']], ray: 'rgba(170,60,20,0.85)', lead: { w: 0.12, col: 'rgba(240,200,170,0.8)' } },
      pelvic: { rays: 6, mem: [[0, 'rgba(232,96,36,0.93)'], [1, 'rgba(242,112,46,0.82)']], ray: 'rgba(170,60,20,0.85)', lead: { w: 0.14, col: 'rgba(245,220,200,0.85)' } },
      pectoral: { rays: 14, mem: [[0, 'rgba(218,178,98,0.72)'], [1, 'rgba(230,180,110,0.5)']], ray: 'rgba(160,120,60,0.8)' },
      caudal: { rays: 17, mem: [[0, 'rgba(176,120,60,0.88)'], [1, 'rgba(212,104,46,0.74)']], ray: 'rgba(110,70,30,0.9)', sCol: [[0, 'rgba(236,90,30,0.55)'], [0.45, 'rgba(236,90,30,0.15)'], [1, 'rgba(110,110,80,0.25)']] },
    },
    paint(B) {
      const { R } = B;
      const bars = [0.29, 0.365, 0.44, 0.515, 0.59, 0.66, 0.735];
      bars.forEach((tc, i) => {
        const vEnd = lerp(0.6, 0.72, R()) - (i === 0 || i === bars.length - 1 ? 0.1 : 0);
        const w = lerp(0.028, 0.036, R()) * (i > 4 ? 0.8 : 1);
        if (i % 2 === 1 && R() < 0.85) {
          B.bar(tc - w * 0.45, w * 0.55, w * 0.35, 0.0, 0.3, [26, 34, 14, 0.75], 4, 0.02);
          B.bar(tc + w * 0.45, w * 0.55, w * 0.35, 0.0, 0.3, [26, 34, 14, 0.75], 4, -0.02);
          B.bar(tc, w * 0.8, w * 0.3, 0.24, vEnd, [26, 34, 14, 0.75], 5, 0);
        } else B.bar(tc, w, w * 0.32, 0.0, vEnd, [26, 34, 14, 0.75], 5, 0);
      });
      B.blob(0.22, 0.42, 0.007, [20, 24, 14, 0.75], 0.5);
      for (let i = 0; i < 30; i++) B.blob(lerp(0.1, 0.8, R()), lerp(0.4, 0.75, R()), lerp(0.01, 0.02, R()), [210, 190, 80, 0.1], 1, 2);
    },
  },
  huchen: {
    prof: [[0, 0, 0, 0], [0.02, 0.014, -0.012, 0.016], [0.05, 0.03, -0.027, 0.031], [0.09, 0.046, -0.042, 0.042], [0.15, 0.062, -0.056, 0.053], [0.22, 0.072, -0.068, 0.06], [0.31, 0.08, -0.076, 0.064], [0.4, 0.082, -0.08, 0.063], [0.5, 0.078, -0.077, 0.058], [0.59, 0.068, -0.068, 0.048], [0.67, 0.054, -0.055, 0.035], [0.75, 0.04, -0.04, 0.022], [0.81, 0.034, -0.033, 0.013], [0.84, 0.036, -0.035, 0.007], [0.86, 0.04, -0.039, 0]],
    nT: [[0, 2.6], [0.2, 2.2], [0.6, 2.0], [0.86, 1.7]], nB: [[0, 2.4], [0.4, 2.2], [0.86, 1.7]], wl: 0.45,
    eye: { t: 0.068, v: 0.26, r: 0.012, out: 0.38, fwd: 0.12, up: 0.08, iris: '#a89070', dark: '#3e3020', ring: '#e2d0a8' },
    mouth: [[0.0, -0.004], [0.12, -0.022]],
    op: { t: [0.17, 0.215, 0.185], v: [0.13, 0.5, 0.93] }, pre: 0.045,
    LL: [[0.21, 0.3], [0.34, 0.42], [0.86, 0.47]],
    sc: { nl: 180, nv: 54, nrm: 0.22, edge: 0.03, jit: 0.04 },
    mat: { rough: 0.4, metal: [[0, 0.05], [0.5, 0.22], [1, 0.18]], irid: 0.22, clear: 0.85 },
    swim: { k: 6.6, amp: 1, fIdle: 0.8, fMax: 4.2 },
    grad: [[0, '#38392e'], [0.15, '#4b4737'], [0.3, '#695944'], [0.45, '#88654f'], [0.6, '#a6826a'], [0.75, '#d3bba6'], [0.9, '#ece3da'], [1, '#f3eee8']],
    fins: {
      dorsal: { t0: 0.4, t1: 0.495, len: [[0, 0.035], [0.12, 0.078], [0.3, 0.075], [0.7, 0.05], [1, 0.028]], rake: [[0, 30], [1, 56]] },
      adipose: { t0: 0.72, t1: 0.76, h: 0.018 },
      anal: { t0: 0.66, t1: 0.725, len: [[0, 0.026], [0.12, 0.06], [0.35, 0.056], [1, 0.028]], rake: [[0, 30], [1, 52]] },
      caudal: { spread: 21, fork: 0.22, pw: 1.4, round: 0.3, d0: 0.72 },
      pectoral: { t: 0.218, bl: 0.022, v0: 0.74, v1: 0.82, d0: [0.85, -0.1, -1], d1: [0.5, -0.52, -1], len: [[0, 0.085], [0.35, 0.08], [1, 0.045]] },
      pelvic: { t: 0.5, bl: 0.022, v0: 0.86, v1: 0.93, d0: [0.42, -0.42, -1], d1: [0.18, -0.6, -1], len: [[0, 0.065], [0.4, 0.056], [1, 0.035]] },
    },
    fp: {
      dorsal: { rays: 12, mem: [[0, 'rgba(110,90,74,0.9)'], [1, 'rgba(136,104,88,0.62)']], ray: 'rgba(70,54,42,0.9)', spots: [{ n: 8, rr: [0.012, 0.018], col: 'rgba(40,28,22,0.8)', r: [0.1, 0.6] }] },
      caudal: { rays: 19, mem: [[0, 'rgba(112,90,76,0.9)'], [1, 'rgba(140,104,90,0.62)']], ray: 'rgba(70,54,42,0.9)', edge: { w: 0.06, col: 'rgba(70,50,40,0.55)' } },
      anal: { rays: 10, mem: [[0, 'rgba(168,118,94,0.85)'], [1, 'rgba(186,130,104,0.58)']], ray: 'rgba(110,76,58,0.85)' },
      pelvic: { rays: 9, mem: [[0, 'rgba(170,120,96,0.85)'], [1, 'rgba(188,132,106,0.58)']], ray: 'rgba(110,76,58,0.85)' },
      pectoral: { rays: 14, mem: [[0, 'rgba(160,118,96,0.8)'], [1, 'rgba(184,132,108,0.52)']], ray: 'rgba(104,74,58,0.85)' },
      adipose: { mem: [[0, 'rgba(96,80,64,0.97)'], [1, 'rgba(120,94,76,0.97)']] },
    },
    paint(B) {
      const { R } = B;
      const pts = B.scatter(210, { t: [0.03, 0.855], v: [0.0, 0.56], minD: 0.0092, dens: (t, v) => 1 - sstep(0.34, 0.57, v) });
      for (const [t, v] of pts) {
        const r = lerp(0.0011, 0.0018, R()), rot = R() * Math.PI, c = [40, 28, 22, 0.86];
        if (R() < 0.6) { B.blob(t, v, r, c, 0.3, 2.4, rot); B.blob(t, v, r, c, 0.3, 2.4, rot + lerp(1.1, 1.9, R())); }
        else B.blob(t, v, r * 1.3, c, 0.3, 1.8, rot);
      }
      for (let i = 0; i < 30; i++) B.blob(lerp(0.15, 0.85, R()), lerp(0.35, 0.6, R()), lerp(0.02, 0.04, R()), [190, 110, 80, 0.1], 1, 2.5);
    },
  },

  whitefish: {
    prof: [[0, 0.006, 0.006, 0], [0.015, 0.02, -0.006, 0.012], [0.04, 0.034, -0.02, 0.022], [0.08, 0.052, -0.038, 0.031], [0.13, 0.068, -0.054, 0.038], [0.2, 0.082, -0.068, 0.042], [0.28, 0.09, -0.078, 0.043], [0.36, 0.092, -0.082, 0.041], [0.45, 0.086, -0.08, 0.037], [0.54, 0.073, -0.071, 0.03], [0.62, 0.058, -0.058, 0.022], [0.69, 0.044, -0.043, 0.015], [0.75, 0.036, -0.035, 0.01], [0.785, 0.038, -0.037, 0.006], [0.8, 0.041, -0.04, 0]],
    nT: [[0, 2.2], [0.3, 1.9], [0.7, 1.7], [0.8, 1.6]], nB: [[0, 2.2], [0.4, 2.2], [0.8, 1.6]], wl: 0.44,  head: 0.07,
    eye: { t: 0.052, v: 0.32, r: 0.0175, out: 0.4, fwd: 0.14, up: 0.03, iris: '#b4b4ac', dark: '#34363a', ring: '#dcdcd2', topDark: 0.5 },
    mouth: [[0.008, -0.002], [0.036, -0.01]],
    op: { t: [0.13, 0.165, 0.14], v: [0.14, 0.5, 0.93] }, pre: 0.033,
    LL: [[0.16, 0.3], [0.3, 0.42], [0.8, 0.47]],
    sc: { nl: 85, nv: 26, nrm: 0.55, edge: 0.13, jit: 0.06 },
    mat: { rough: 0.32, metal: [[0, 0.12], [0.25, 0.4], [0.55, 0.58], [1, 0.45]], irid: 0.5, clear: 0.85 },
    swim: { k: 6.2, amp: 1, fIdle: 1.1, fMax: 4.8 },
    grad: [[0, '#38474f'], [0.12, '#4d626d'], [0.25, '#8898a0'], [0.4, '#b6bfc3'], [0.6, '#cdd2d4'], [0.8, '#e0e2e2'], [1, '#f1f1ef']],
    fins: {
      dorsal: { t0: 0.36, t1: 0.455, len: [[0, 0.04], [0.12, 0.112], [0.3, 0.1], [0.7, 0.06], [1, 0.03]], rake: [[0, 26], [0.2, 30], [1, 56]] },
      adipose: { t0: 0.68, t1: 0.715, h: 0.018 },
      anal: { t0: 0.61, t1: 0.69, len: [[0, 0.03], [0.12, 0.066], [0.35, 0.058], [1, 0.03]], rake: [[0, 30], [1, 54]] },
      caudal: { spread: 22, fork: 0.55, pw: 1.0, round: 0.2, d0: 0.82 },
      pectoral: { t: 0.172, bl: 0.022, v0: 0.76, v1: 0.84, d0: [0.85, -0.1, -1], d1: [0.5, -0.52, -1], len: [[0, 0.09], [0.35, 0.084], [1, 0.045]] },
      pelvic: { t: 0.44, bl: 0.022, v0: 0.86, v1: 0.93, d0: [0.42, -0.42, -1], d1: [0.18, -0.6, -1], len: [[0, 0.076], [0.4, 0.066], [1, 0.04]] },
    },
    fp: {
      dorsal: { rays: 12, mem: [[0, 'rgba(126,136,142,0.72)'], [1, 'rgba(84,94,104,0.68)']], ray: 'rgba(70,78,86,0.9)', edge: { w: 0.16, col: 'rgba(48,56,64,0.72)' } },
      caudal: { rays: 19, mem: [[0, 'rgba(126,136,142,0.75)'], [1, 'rgba(84,94,104,0.66)']], ray: 'rgba(70,78,86,0.9)', edge: { w: 0.12, col: 'rgba(48,56,64,0.7)' } },
      anal: { rays: 11, mem: [[0, 'rgba(212,212,206,0.62)'], [1, 'rgba(186,192,194,0.48)']], ray: 'rgba(150,154,156,0.8)', edge: { w: 0.15, col: 'rgba(110,118,124,0.5)' } },
      pelvic: { rays: 10, mem: [[0, 'rgba(214,214,208,0.62)'], [1, 'rgba(188,192,194,0.48)']], ray: 'rgba(150,154,156,0.8)', edge: { w: 0.15, col: 'rgba(110,118,124,0.5)' } },
      pectoral: { rays: 14, mem: [[0, 'rgba(206,208,204,0.6)'], [1, 'rgba(180,186,190,0.45)']], ray: 'rgba(144,148,150,0.8)', edge: { w: 0.15, col: 'rgba(100,108,116,0.5)' } },
      adipose: { mem: [[0, 'rgba(90,104,112,0.95)'], [1, 'rgba(110,120,128,0.95)']] },
    },
    paint(B) {
      const nv = B.def.sc.nv;
      for (let j = 1; j < nv * 0.4; j++) { const v = j / nv; B.line(0.17, B.tail, v, [30, 40, 50, 0.16 * (1 - v * 2)], 1.4); }
    },
  },

  barbel: {
    prof: [[0, 0.004, 0.004, 0], [0.008, 0.011, -0.004, 0.009], [0.02, 0.02, -0.011, 0.017], [0.05, 0.035, -0.022, 0.028], [0.09, 0.05, -0.034, 0.036], [0.15, 0.072, -0.048, 0.046], [0.22, 0.09, -0.06, 0.053], [0.3, 0.102, -0.068, 0.056], [0.38, 0.106, -0.072, 0.055], [0.47, 0.1, -0.073, 0.05], [0.56, 0.086, -0.068, 0.042], [0.64, 0.068, -0.058, 0.032], [0.72, 0.05, -0.044, 0.021], [0.78, 0.04, -0.035, 0.013], [0.805, 0.04, -0.035, 0.008], [0.82, 0.043, -0.038, 0]],
    nT: [[0, 2.0], [0.4, 1.9], [0.82, 1.7]], nB: [[0, 2.2], [0.2, 2.8], [0.5, 2.8], [0.82, 1.8]], wl: 0.35,
    eye: { t: 0.088, v: 0.25, r: 0.011, out: 0.42, fwd: 0.12, up: 0.12, iris: '#b89048', dark: '#4a3214', ring: '#e8cc84' },
    mouth: [[0.028, -0.016], [0.062, -0.024]], mouthPt: [0.03, -0.018],
    op: { t: [0.17, 0.215, 0.185], v: [0.13, 0.5, 0.93] }, pre: 0.045,
    LL: [[0.21, 0.28], [0.34, 0.4], [0.82, 0.46]],
    sc: { nl: 60, nv: 20, nrm: 0.6, edge: 0.2, jit: 0.07 },
    mat: { rough: 0.4, metal: [[0, 0.06], [0.5, 0.24], [1, 0.16]], irid: 0.22, clear: 0.8 },
    swim: { k: 6.4, amp: 1, fIdle: 0.9, fMax: 4.2 },
    grad: [[0, '#3c381f'], [0.15, '#554e26'], [0.3, '#776a34'], [0.45, '#9b8a47'], [0.6, '#b7a465'], [0.75, '#d0c399'], [0.9, '#e6dfc6'], [1, '#efe9d6']],
    barbels: [{ t: 0.012, v: 0.86, len: 0.034, dir: [0.25, -0.75, 0.15], r: 0.0018 }, { t: 0.06, v: 0.92, len: 0.048, dir: [0.35, -0.8, -0.3], r: 0.002 }],
    fins: {
      dorsal: { t0: 0.38, t1: 0.47, len: [[0, 0.05], [0.12, 0.112], [0.3, 0.1], [0.7, 0.055], [1, 0.03]], rake: [[0, 24], [0.2, 30], [1, 56]] },
      anal: { t0: 0.66, t1: 0.71, len: [[0, 0.04], [0.15, 0.085], [0.5, 0.07], [1, 0.04]], rake: [[0, 34], [1, 50]] },
      caudal: { spread: 22, fork: 0.38, pw: 1.2, round: 0.22, d0: 0.78 },
      pectoral: { t: 0.21, bl: 0.024, v0: 0.8, v1: 0.9, d0: [0.9, -0.04, -1], d1: [0.35, -0.7, -1], len: [[0, 0.09], [0.35, 0.084], [1, 0.045]] },
      pelvic: { t: 0.47, bl: 0.022, v0: 0.86, v1: 0.93, d0: [0.5, -0.35, -1], d1: [0.25, -0.55, -1], len: [[0, 0.07], [0.4, 0.062], [1, 0.038]] },
    },
    fp: {
      dorsal: { rays: 11, mem: [[0, 'rgba(106,96,66,0.88)'], [1, 'rgba(128,114,84,0.6)']], ray: 'rgba(64,56,34,0.9)', lead: { w: 0.07, col: 'rgba(60,52,30,0.95)' } },
      caudal: { rays: 19, mem: [[0, 'rgba(116,98,62,0.88)'], [1, 'rgba(146,100,68,0.66)']], ray: 'rgba(70,58,34,0.9)', sCol: [[0, 'rgba(210,90,50,0.5)'], [0.45, 'rgba(210,90,50,0.08)'], [1, 'rgba(0,0,0,0)']] },
      anal: { rays: 8, mem: [[0, 'rgba(200,118,68,0.88)'], [1, 'rgba(216,114,70,0.68)']], ray: 'rgba(140,76,40,0.85)' },
      pelvic: { rays: 9, mem: [[0, 'rgba(200,120,70,0.86)'], [1, 'rgba(216,116,72,0.64)']], ray: 'rgba(140,76,40,0.85)' },
      pectoral: { rays: 15, mem: [[0, 'rgba(196,124,72,0.84)'], [1, 'rgba(212,120,74,0.6)']], ray: 'rgba(136,78,42,0.85)' },
      barbel: { flesh: '#c49a64' },
    },
    paint(B) {
      const { R } = B;
      const pts = B.scatter(190, { t: [0.04, 0.81], v: [0.02, 0.6], minD: 0.009, dens: (t, v) => 1 - sstep(0.3, 0.6, v) });
      for (const [t, v] of pts) B.blob(t, v, lerp(0.001, 0.0018, R()), [48, 38, 22, 0.55], 0.4);
      B.blob(0.4, 0.42, 0.14, [200, 170, 80, 0.12], 1, 2.5);
    },
  },

  chub: {
    prof: [[0, 0, 0, 0], [0.02, 0.018, -0.016, 0.018], [0.05, 0.036, -0.032, 0.033], [0.09, 0.054, -0.048, 0.045], [0.15, 0.072, -0.064, 0.055], [0.22, 0.086, -0.078, 0.062], [0.3, 0.096, -0.09, 0.065], [0.38, 0.099, -0.096, 0.063], [0.47, 0.094, -0.094, 0.058], [0.56, 0.082, -0.084, 0.049], [0.64, 0.066, -0.068, 0.037], [0.72, 0.05, -0.05, 0.024], [0.78, 0.042, -0.041, 0.015], [0.805, 0.043, -0.042, 0.009], [0.82, 0.046, -0.045, 0]],
    nT: [[0, 2.4], [0.3, 2.1], [0.82, 1.8]], nB: [[0, 2.3], [0.4, 2.2], [0.82, 1.8]], wl: 0.45,
    eye: { t: 0.063, v: 0.3, r: 0.014, out: 0.38, fwd: 0.12, up: 0.05, iris: '#d0a060', dark: '#4a3218', ring: '#f0d8a0', topDark: 0.6 },
    mouth: [[0.0, -0.004], [0.072, -0.024]],
    op: { t: [0.165, 0.21, 0.18], v: [0.13, 0.5, 0.93] }, pre: 0.045,
    LL: [[0.2, 0.32], [0.34, 0.45], [0.82, 0.5]],
    sc: { nl: 45, nv: 15, nrm: 0.75, edge: 0.5, jit: 0.08 },
    mat: { rough: 0.36, metal: [[0, 0.08], [0.3, 0.28], [0.6, 0.38], [1, 0.3]], irid: 0.3, clear: 0.85 },
    swim: { k: 6.0, amp: 1, fIdle: 1.0, fMax: 4.6 },
    grad: [[0, '#2b3432'], [0.12, '#3a4644'], [0.3, '#6a726e'], [0.45, '#a19e8e'], [0.6, '#c0baa0'], [0.78, '#dcd8c8'], [1, '#eeece6']],
    fins: {
      dorsal: { t0: 0.45, t1: 0.535, len: [[0, 0.045], [0.12, 0.09], [0.4, 0.085], [0.8, 0.06], [1, 0.04]], rake: [[0, 24], [1, 48]] },
      anal: { t0: 0.64, t1: 0.71, len: [[0, 0.035], [0.15, 0.07], [0.5, 0.072], [1, 0.045]], rake: [[0, 28], [1, 44]] },
      caudal: { spread: 22, fork: 0.28, pw: 1.3, round: 0.3, d0: 0.7 },
      pectoral: { t: 0.208, bl: 0.022, v0: 0.78, v1: 0.85, d0: [0.85, -0.1, -1], d1: [0.5, -0.52, -1], len: [[0, 0.085], [0.35, 0.08], [1, 0.045]] },
      pelvic: { t: 0.43, bl: 0.022, v0: 0.86, v1: 0.93, d0: [0.42, -0.42, -1], d1: [0.18, -0.6, -1], len: [[0, 0.07], [0.4, 0.062], [1, 0.038]] },
    },
    fp: {
      dorsal: { rays: 10, mem: [[0, 'rgba(66,70,62,0.9)'], [1, 'rgba(56,58,56,0.78)']], ray: 'rgba(40,42,38,0.9)', edge: { w: 0.08, col: 'rgba(26,26,26,0.8)' } },
      caudal: { rays: 19, mem: [[0, 'rgba(72,76,70,0.9)'], [1, 'rgba(56,56,56,0.8)']], ray: 'rgba(40,42,38,0.9)', edge: { w: 0.09, col: 'rgba(22,22,22,0.88)' } },
      anal: { rays: 10, mem: [[0, 'rgba(218,92,46,0.9)'], [1, 'rgba(230,102,52,0.76)']], ray: 'rgba(160,62,30,0.85)' },
      pelvic: { rays: 9, mem: [[0, 'rgba(220,94,46,0.9)'], [1, 'rgba(232,104,52,0.76)']], ray: 'rgba(160,62,30,0.85)' },
      pectoral: { rays: 15, mem: [[0, 'rgba(218,162,100,0.76)'], [1, 'rgba(230,160,100,0.55)']], ray: 'rgba(160,110,60,0.8)' },
    },
    paint(B) {
      const { R } = B;
      for (let i = 0; i < 40; i++) B.blob(lerp(0.02, 0.8, R()), lerp(0, 0.18, R()), lerp(0.01, 0.022, R()), [26, 32, 30, 0.2], 1, 2);
      B.blob(0.1, 0.1, 0.05, [30, 36, 34, 0.35], 1, 1.5);
    },
  },
};
Object.assign(SPECIES, OCEAN);

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
const ATLAS = 1024;
const REG = {
  caudal: [0, 0, 512, 448], dorsal: [512, 0, 512, 448],
  anal: [0, 448, 256, 256], pectoral: [256, 448, 256, 256], pelvic: [512, 448, 256, 256], dorsal2: [768, 448, 256, 256],
  adipose: [0, 704, 256, 160], barbel: [256, 704, 128, 128],
  finlet: [384, 704, 128, 160], anal2: [512, 704, 192, 160], teeth: [704, 704, 64, 64], pectoralU: [768, 704, 256, 256],
};
const BODY_RINGS = 48, BODY_SEGS = 32;

// opercle (gill cover) rear edge: t as function of v (quadratic through 3 points)
function opT(def, v) {
  const [a, b, c] = def.op.t, [v0, v1, v2] = def.op.v;
  const x = clamp(v, v0, v2);
  return a * ((x - v1) * (x - v2)) / ((v0 - v1) * (v0 - v2)) + b * ((x - v0) * (x - v2)) / ((v1 - v0) * (v1 - v2)) + c * ((x - v0) * (x - v1)) / ((v2 - v0) * (v2 - v1));
}

// bd: { rings, segs, mix (curvature-aware vertex placement), rt ([[ring fraction, t / tail], ...]) }
function buildBody(shape, bd = {}) {
  const N = bd.rings ?? BODY_RINGS, R = bd.segs ?? BODY_SEGS, half = R / 2, mix = bd.mix ?? 0, rt = bd.rt ? curve(bd.rt) : null;
  const pos = new Float32Array((N + 1) * R * 3), uv = new Float32Array((N + 1) * R * 2), idx = [];
  for (let i = 0; i <= N; i++) {
    const x = i / N, t = shape.tail * (rt ? clamp(rt(x), 0, 1) : x - 0.6 * Math.sin(TAU * x) / TAU);
    const ring = shape.ring(t);
    for (let j = 0; j < R; j++) {
      const left = j <= half, q = left ? j / half : (R - j) / half, v = mix ? ring.vMix(q, mix) : q;
      const [px, py] = ring.at(v), k = i * R + j;
      pos[k * 3] = left ? px : -px; pos[k * 3 + 1] = py; pos[k * 3 + 2] = 0.5 - t;
      uv[k * 2] = t / shape.tail; uv[k * 2 + 1] = v;
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < R; j++) {
    const a = i * R + j, b = i * R + (j + 1) % R, c = (i + 1) * R + j, d = (i + 1) * R + (j + 1) % R;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let j = 0; j < R; j++) { // rounded snout: blend tip normals forward
    const v = new V3(n.getX(R + j), n.getY(R + j), n.getZ(R + j)).multiplyScalar(0.45).add(new V3(0, 0, 0.9)).normalize();
    n.setXYZ(j, v.x, v.y, v.z);
  }
  return g;
}

// p position, n normal, uv, f = aFin (ray distance, flap gain, flap phase, tuck), fn = aFinN (flap direction), i index
function finAcc() { return { p: [], n: [], uv: [], f: [], fn: [], i: [] }; }

// generic ray-grid fin: base(s) -> tip(s), s along the fin base, r along the rays
function addGrid(A, o) {
  const ns = o.ns ?? 12, nr = o.nr ?? 6, rect = o.rect;
  const b0 = o.base(0), b1 = o.base(1), bm = o.base(0.5), tm = o.tip(0.5);
  const n = new V3().crossVectors(new V3().subVectors(b1, b0), new V3().subVectors(tm, bm)).normalize();
  if (n.dot(o.hint) < 0) n.negate();
  for (const sd of (o.mirror ? [1, -1] : [1])) {
    const start = A.p.length / 3;
    for (let a = 0; a <= ns; a++) {
      const s = a / ns, B = o.base(s), T = o.tip(s), len = B.distanceTo(T);
      for (let b = 0; b <= nr; b++) {
        const r = b / nr, camb = (o.camber || 0) * len * Math.sin(Math.PI * s) * r * r;
        A.p.push((lerp(B.x, T.x, r) + n.x * camb) * sd, lerp(B.y, T.y, r) + n.y * camb, lerp(B.z, T.z, r) + n.z * camb);
        A.n.push(n.x * sd, n.y, n.z);
        A.uv.push((rect[0] + 3 + s * (rect[2] - 6)) / ATLAS, (rect[1] + 3 + r * (rect[3] - 6)) / ATLAS);
        A.f.push(r * len, o.gain || 0, (o.phase ? o.phase(s) : 0) + (sd < 0 ? (o.mirrorPhase || 0) : 0), o.tuck || 0);
        A.fn.push(n.x * sd, n.y, n.z);
      }
    }
    for (let a = 0; a < ns; a++) for (let b = 0; b < nr; b++) {
      const i0 = start + a * (nr + 1) + b, i1 = i0 + 1, i2 = i0 + nr + 1, i3 = i2 + 1;
      if (sd > 0) A.i.push(i0, i2, i1, i1, i2, i3); else A.i.push(i0, i1, i2, i1, i3, i2);
    }
  }
}

// Stiff fin with real thickness (sharks, tunas, billfish): a closed two-skinned foil with a rounded
// leading edge and a thin trailing edge. Optional convex "bow" on the edge rays. aFinN carries the
// mid-plane normal, so flapping / tucking moves both skins together.
function addFoil(A, o) {
  const ns = o.ns ?? 12, nr = o.nr ?? 6, rect = o.rect;
  const b0 = o.base(0), b1 = o.base(1), bm = o.base(0.5), tm = o.tip(0.5);
  const n = new V3().crossVectors(new V3().subVectors(b1, b0), new V3().subVectors(tm, bm)).normalize();
  if (n.dot(o.hint) < 0) n.negate();
  // chord-wise thickness: caudal lobes have leading edges at both s = 0 and s = 1
  const Pc = o.lobes ? (s) => Math.pow(Math.max(Math.sin(Math.PI * s), 0), 0.4) : (s) => Math.sqrt(Math.max(s, 0)) * Math.pow(Math.max(1 - s, 0), 0.9) / 0.402;
  const Qr = (r) => Math.sqrt(Math.max(0, 1 - Math.pow(r, 1.7))) * (1 - 0.45 * r);
  const e0 = new V3().subVectors(o.tip(0), b0), e1 = new V3().subVectors(o.tip(1), b1);
  const p0 = new V3().crossVectors(n, e0).normalize(); if (p0.dot(new V3().subVectors(b0, b1)) < 0) p0.negate();
  const p1 = new V3().crossVectors(n, e1).normalize(); if (p1.dot(new V3().subVectors(b1, b0)) < 0) p1.negate();
  const bw = o.bowW ?? 0.25, L0 = e0.length(), L1 = e1.length();
  const S = [], M = [], H = [], LEN = [];
  for (let a = 0; a <= ns; a++) {
    const u = a / ns, s = lerp(u, 0.5 - 0.5 * Math.cos(Math.PI * u), 0.6); // denser at the edges
    const B = o.base(s), T = o.tip(s), len = B.distanceTo(T), rm = [], rh = [];
    const w0 = s < bw ? (1 - s / bw) ** 2 : 0, w1 = s > 1 - bw ? (1 - (1 - s) / bw) ** 2 : 0;
    for (let b = 0; b <= nr; b++) {
      const r = b / nr, q = new V3().lerpVectors(B, T, r), sn = Math.sin(Math.PI * r);
      if (o.bow0) q.addScaledVector(p0, o.bow0 * L0 * sn * w0);
      if (o.bow1) q.addScaledVector(p1, o.bow1 * L1 * sn * w1);
      if (o.camber) q.addScaledVector(n, o.camber * len * Math.sin(Math.PI * s) * r * r);
      rm.push(q); rh.push(o.thick * Pc(s) * Qr(r));
    }
    S.push(s); M.push(rm); H.push(rh); LEN.push(len);
  }
  const ac = Math.max(1, ns >> 1), bc = Math.max(1, nr >> 1);
  for (const sd of (o.mirror ? [1, -1] : [1])) {
    for (const f of [1, -1]) {
      const start = A.p.length / 3, rc = (o.rectU && f * n.y < 0) ? o.rectU : rect;
      const P = (a, b) => M[a][b].clone().addScaledVector(n, f * H[a][b]);
      const dS = (a, b) => P(Math.min(a + 1, ns), b).sub(P(Math.max(a - 1, 0), b)), dR = (a, b) => P(a, Math.min(b + 1, nr)).sub(P(a, Math.max(b - 1, 0)));
      const sg = Math.sign(new V3().crossVectors(dS(ac, bc), dR(ac, bc)).dot(n) * f) || 1;
      for (let a = 0; a <= ns; a++) for (let b = 0; b <= nr; b++) {
        const p = P(a, b), nn = new V3().crossVectors(dS(a, b), dR(a, b));
        if (nn.lengthSq() < 1e-16) nn.copy(n).multiplyScalar(f); else nn.normalize().multiplyScalar(sg);
        const s = S[a], r = b / nr;
        A.p.push(p.x * sd, p.y, p.z); A.n.push(nn.x * sd, nn.y, nn.z);
        A.uv.push((rc[0] + 3 + s * (rc[2] - 6)) / ATLAS, (rc[1] + 3 + r * (rc[3] - 6)) / ATLAS);
        A.f.push(r * LEN[a], o.gain || 0, (o.phase ? o.phase(s) : 0) + (sd < 0 ? (o.mirrorPhase || 0) : 0), o.tuck || 0);
        A.fn.push(n.x * sd, n.y, n.z);
      }
      const ccw = (sg > 0) !== (sd < 0); // triangle (i0, i2, i1) faces along cross(dS, dR)
      for (let a = 0; a < ns; a++) for (let b = 0; b < nr; b++) {
        const i0 = start + a * (nr + 1) + b, i1 = i0 + 1, i2 = i0 + nr + 1, i3 = i2 + 1;
        if (ccw) A.i.push(i0, i2, i1, i1, i2, i3); else A.i.push(i0, i1, i2, i1, i3, i2);
      }
    }
  }
}

// median fin from an explicit outline: out = [[s, t, h], ...] tip curve (h above the back / below the belly)
function outlineMedian(shape, f, sign) {
  const ot = curve(f.out.map(p => [p[0], p[1]])), oh = curve(f.out.map(p => [p[0], p[2]]));
  const yAt = (t) => { const pr = shape.prof(Math.min(t, shape.tail)); return sign > 0 ? pr.yT : pr.yB; };
  const base = (s) => { const t = lerp(f.t0, f.t1, s); return new V3(0, yAt(t) - sign * (f.inset ?? 0.0025), 0.5 - t); };
  const tip = (s) => { const t = ot(s); return new V3(0, yAt(t) + sign * oh(s), 0.5 - t); };
  return { base, tip, hint: new V3(1, 0, 0) };
}

// caudal fin from an explicit outline: base = [[t, y] bottom, [t, y] top], out = [[s, t, y], ...] lower tip -> upper tip
function outlineCaudal(shape, f) {
  const ot = curve(f.out.map(p => [p[0], p[1]])), oy = curve(f.out.map(p => [p[0], p[2]]));
  const B0 = new V3(0, f.base[0][1], 0.5 - f.base[0][0]), B1 = new V3(0, f.base[1][1], 0.5 - f.base[1][0]);
  return { base: (s) => new V3().lerpVectors(B0, B1, s), tip: (s) => new V3(0, oy(s), 0.5 - ot(s)), hint: new V3(1, 0, 0) };
}

// row of small finlets (tunas) on the back (sign 1) or belly (sign -1)
function addFinlets(A, shape, fl, sign, ph) {
  for (let i = 0; i < fl.n; i++) {
    const q = fl.n > 1 ? i / (fl.n - 1) : 0, tc = lerp(fl.t0, fl.t1, q), bl = lerp(fl.bl0, fl.bl1, q), h = lerp(fl.h0, fl.h1, q);
    const f = { t0: tc - bl / 2, t1: tc + bl / 2, out: [[0, tc + bl * 0.6, h], [1, tc + bl * 1.05, 0.0015]], inset: 0.0012 };
    addGrid(A, { ...outlineMedian(shape, f, sign), ns: 2, nr: 2, rect: REG.finlet, gain: 0.3, phase: () => ph(q) + i * 0.4 });
  }
}

// mouth line in (t, v): explicit (sharks) or from the jaw line (t, y) of bony fishes
function mouthPathTV(def, shape) {
  const mp = [];
  if (def.mouthTV) {
    const n = def.mouthTV.length - 1, ct = curve(def.mouthTV.map((p, i) => [i, p[0]])), cv = curve(def.mouthTV.map((p, i) => [i, p[1]]));
    for (let i = 0; i <= 18; i++) { const q = i / 18 * n; mp.push([ct(q), cv(q)]); }
    return mp;
  }
  const [[mt0, my0], [mt1, my1]] = def.mouth;
  for (let i = 0; i <= 18; i++) {
    const q = i / 18, t = lerp(Math.max(mt0, 0.003), mt1, q), y = my0 + (my1 - my0) * Math.pow(q, def.mouthCurve ?? 1.3);
    mp.push([t, shape.ring(t).vAt(y)]);
  }
  return mp;
}

// visible teeth along the mouth line: flattened triangular pyramids (upper row points down, lower row up)
function addFangs(A, def, shape, rect) {
  const mp = mouthPathTV(def, shape), R = mulberry(hashStr(def.id) + 99);
  const at = (q) => { const f = clamp(q, 0, 1) * 18, i = Math.min(17, Math.floor(f)), k = f - i; return [lerp(mp[i][0], mp[i + 1][0], k), lerp(mp[i][1], mp[i + 1][1], k)]; };
  const u0 = (rect[0] + rect[2] / 2) / ATLAS, vb = (rect[1] + 4) / ATLAS, vt = (rect[1] + rect[3] - 4) / ATLAS;
  for (const row of def.fangs) {
    for (let i = 0; i < row.n; i++) {
      const q = lerp(row.q[0], row.q[1], (i + 0.5) / row.n), [t, v0] = at(q), v = clamp(v0 + row.off, 0.001, 0.999);
      const L = lerp(row.len[0], row.len[1], (i + 0.5) / row.n) * lerp(0.8, 1.15, R()), W = L * row.w;
      const p = shape.surf(t, v), nrm = shape.normal(t, v);
      const [ta, va] = at(q - 0.02), [tb, vb2] = at(q + 0.02);
      const tg = shape.surf(tb, clamp(vb2 + row.off, 0, 1)).sub(shape.surf(ta, clamp(va + row.off, 0, 1)));
      tg.addScaledVector(nrm, -tg.dot(nrm)).normalize();
      const dn = shape.surf(t, Math.min(1, v + 0.01)).sub(shape.surf(t, Math.max(0, v - 0.01))).normalize(); // toward larger v (down the flank)
      const dir = dn.multiplyScalar(row.dir).addScaledVector(new V3(0, -row.dir, 0), 0.45).addScaledVector(nrm, 0.25).normalize();
      const c = p.clone().addScaledVector(nrm, 0.0006);
      const k1 = c.clone().addScaledVector(tg, -W / 2), k2 = c.clone().addScaledVector(tg, W / 2), k3 = c.clone().addScaledVector(nrm, W * 0.35);
      const ap = c.clone().addScaledVector(dir, L), cen = c.clone().addScaledVector(nrm, W * 0.12).addScaledVector(dir, L * 0.3);
      for (const sd of [1, -1]) {
        for (const [a, b] of [[k1, k2], [k2, k3], [k3, k1]]) {
          const fn = new V3().crossVectors(new V3().subVectors(b, a), new V3().subVectors(ap, a)).normalize();
          const mid = a.clone().add(b).add(ap).multiplyScalar(1 / 3);
          let tri = [a, b, ap];
          if (fn.dot(mid.sub(cen)) < 0) { fn.negate(); tri = [b, a, ap]; }
          if (sd < 0) tri = [tri[1], tri[0], tri[2]];
          const start = A.p.length / 3;
          tri.forEach((pp, k) => {
            A.p.push(pp.x * sd, pp.y, pp.z); A.n.push(fn.x * sd, fn.y, fn.z);
            A.uv.push(u0 + (k - 1) * 0.004, k === 2 ? vt : vb); A.f.push(0, 0, 0, 0); A.fn.push(0, 0, 0);
          });
          A.i.push(start, start + 1, start + 2);
        }
      }
    }
  }
}

function medianFin(shape, f, sign) {
  const L = crv(f.len), rk = crv(f.rake);
  const base = (s) => { const t = lerp(f.t0, f.t1, s), pr = shape.prof(t); return new V3(0, (sign > 0 ? pr.yT : pr.yB) - sign * 0.0025, 0.5 - t); };
  const tip = (s) => { const b = base(s), a = rk(s) * DEG, l = L(s); return new V3(0, b.y + sign * l * Math.cos(a), b.z - l * Math.sin(a)); };
  return { base, tip, hint: new V3(1, 0, 0) };
}

function caudalFin(shape, f) {
  const tb = shape.tail - 0.012, pr = shape.prof(tb);
  const yc = (pr.yT + pr.yB) / 2, hh = (pr.yT - pr.yB) / 2 * (f.baseH ?? 0.95);
  const ang = (s) => lerp(-f.spread, f.spread, s) * DEG;
  const shp = (s) => {
    const d = Math.abs(s - 0.5) * 2;
    let l = 1 - f.fork * Math.pow(1 - d, f.pw ?? 1.5);
    if (d > f.d0) l *= 1 - f.round * Math.pow((d - f.d0) / (1 - f.d0), 2);
    return l;
  };
  let m = 0; for (let i = 0; i <= 128; i++) { const s = i / 128; m = Math.max(m, shp(s) * Math.cos(ang(s))); }
  const Lc = (1 - tb) / m;
  const base = (s) => new V3(0, yc + (s * 2 - 1) * hh, 0.5 - tb);
  const tip = (s) => { const b = base(s), a = ang(s), l = Lc * shp(s); return new V3(0, b.y + l * Math.sin(a), b.z - l * Math.cos(a)); };
  return { base, tip, hint: new V3(1, 0, 0) };
}

function pairedFin(shape, f) {
  const L = crv(f.len), d0 = new V3(...f.d0).normalize(), d1 = new V3(...f.d1).normalize();
  const base = (s) => { const t = f.t + f.bl * s, v = lerp(f.v0, f.v1, s); return shape.surf(t, v).addScaledVector(shape.normal(t, v), -0.0015); };
  const tip = (s) => base(s).addScaledVector(new V3().lerpVectors(d0, d1, s).normalize(), L(s));
  return { base, tip, hint: shape.normal(f.t + f.bl / 2, (f.v0 + f.v1) / 2) };
}

function addTube(A, shape, b, rect) {
  const root = shape.surf(b.t, b.v).addScaledVector(shape.normal(b.t, b.v), -0.001);
  const dir = new V3(...b.dir).normalize(), nl = 6, nc = 6;
  const cen = (s) => root.clone().addScaledVector(dir, b.len * s).add(new V3(0, -b.len * 0.25 * s * s, -b.len * 0.2 * s * s));
  for (const sd of [1, -1]) {
    const start = A.p.length / 3;
    for (let a = 0; a <= nl; a++) {
      const s = a / nl, c = cen(s), tg = cen(Math.min(1, s + 0.05)).sub(cen(Math.max(0, s - 0.05))).normalize();
      const nA = new V3().crossVectors(tg, new V3(0, 0, 1)); if (nA.lengthSq() < 1e-6) nA.set(1, 0, 0); nA.normalize();
      const nB = new V3().crossVectors(tg, nA).normalize(), rr = b.r * (1 - 0.7 * s);
      for (let k = 0; k <= nc; k++) {
        const ph = TAU * k / nc, o = nA.clone().multiplyScalar(Math.cos(ph)).addScaledVector(nB, Math.sin(ph));
        A.p.push((c.x + o.x * rr) * sd, c.y + o.y * rr, c.z + o.z * rr);
        A.n.push(o.x * sd, o.y, o.z);
        A.uv.push((rect[0] + 8 + s * (rect[2] - 16)) / ATLAS, (rect[1] + 8 + (k / nc) * (rect[3] - 16)) / ATLAS);
        A.f.push(0, 0, 0, 0); A.fn.push(0, 0, 0);
      }
    }
    for (let a = 0; a < nl; a++) for (let k = 0; k < nc; k++) {
      const i0 = start + a * (nc + 1) + k, i1 = i0 + 1, i2 = i0 + nc + 1, i3 = i2 + 1;
      // orient outward
      const P = (i) => new V3(A.p[i * 3], A.p[i * 3 + 1], A.p[i * 3 + 2]);
      const nrm = new V3().crossVectors(P(i2).sub(P(i0)), P(i1).sub(P(i0)));
      const out = new V3(A.n[i0 * 3], A.n[i0 * 3 + 1], A.n[i0 * 3 + 2]);
      if (nrm.dot(out) >= 0) A.i.push(i0, i2, i1, i1, i2, i3); else A.i.push(i0, i1, i2, i1, i3, i2);
    }
  }
}

function accToGeo(A) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(A.n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(A.uv, 2));
  if (A.f.length) {
    g.setAttribute('aFin', new THREE.Float32BufferAttribute(A.f, 4));
    g.setAttribute('aFinN', new THREE.Float32BufferAttribute(A.fn, 3));
  }
  g.setIndex(A.i);
  return g;
}

function buildFins(def, shape) {
  const A = finAcc(), F = def.fins;
  const ph = (s) => s * 2.6;
  // f: species fin def (optional overrides: ns, nr, gain, tuck, camber, thick -> foil, bow*, under);  o: defaults
  const fin = (f, geo, o) => {
    const opt = { ...geo, ...o, ns: f.ns ?? o.ns, nr: f.nr ?? o.nr, gain: f.gain ?? o.gain, tuck: f.tuck ?? o.tuck, camber: f.camber ?? o.camber };
    if (f.thick) addFoil(A, { ...opt, thick: f.thick, bow0: f.bow0, bow1: f.bow1, bowW: f.bowW, rectU: f.under ? REG[f.under] : null });
    else addGrid(A, opt);
  };
  const med = (f, sign) => (f.out ? outlineMedian(shape, f, sign) : medianFin(shape, f, sign));
  if (F.dorsal) fin(F.dorsal, med(F.dorsal, 1), { ns: 12, nr: 6, rect: REG.dorsal, gain: 0.1, phase: ph });
  if (F.dorsal2) fin(F.dorsal2, med(F.dorsal2, 1), { ns: 10, nr: 5, rect: REG.dorsal2, gain: 0.1, phase: ph });
  if (F.adipose) {
    const a = F.adipose, h = a.h;
    addGrid(A, { ...medianFin(shape, { t0: a.t0, t1: a.t1, len: [[0, h * 0.12], [0.35, h * 0.62], [0.7, h * 0.92], [1, h]], rake: [[0, 40], [1, 72]] }, 1), ns: 6, nr: 3, rect: REG.adipose, gain: 0.05, phase: ph });
  }
  if (F.anal) fin(F.anal, med(F.anal, -1), { ns: 10, nr: 5, rect: REG.anal, gain: 0.1, phase: ph });
  if (F.anal2) fin(F.anal2, med(F.anal2, -1), { ns: 4, nr: 3, rect: REG.anal2, gain: 0.1, phase: ph });
  if (F.caudal) fin(F.caudal, F.caudal.out ? outlineCaudal(shape, F.caudal) : caudalFin(shape, F.caudal), { ns: 16, nr: 8, rect: REG.caudal, gain: 0.03, phase: ph, lobes: true });
  if (F.pectoral) fin(F.pectoral, pairedFin(shape, F.pectoral), { ns: 8, nr: 6, rect: REG.pectoral, gain: 1, tuck: 1, phase: (s) => s * 1.4, mirror: true, mirrorPhase: 0.7, camber: 0.08 });
  if (F.pelvic) fin(F.pelvic, pairedFin(shape, F.pelvic), { ns: 7, nr: 5, rect: REG.pelvic, gain: 0.35, tuck: 0.45, phase: (s) => s * 1.2 + 1.5, mirror: true, mirrorPhase: 0.5, camber: 0.06 });
  if (def.finlets?.dorsal) addFinlets(A, shape, def.finlets.dorsal, 1, ph);
  if (def.finlets?.ventral) addFinlets(A, shape, def.finlets.ventral, -1, ph);
  if (def.fangs) addFangs(A, def, shape, REG.teeth);
  for (const b of def.barbels || []) addTube(A, shape, b, REG.barbel);
  return accToGeo(A);
}

// eyes: protruding spherical caps with planar iris UVs (u+ = forward, v- = up)
function buildEyes(def, shape) {
  const e = def.eye, A = finAcc();
  const p = shape.surf(e.t, e.v), n = shape.normal(e.t, e.v);
  for (const sd of [1, -1]) {
    const axis = new V3(n.x * sd, n.y + e.up, n.z + e.fwd).normalize();
    const c = new V3(p.x * sd, p.y, p.z).addScaledVector(new V3(n.x * sd, n.y, n.z), -e.r * (1 - e.out));
    const F = new V3(0, 0, 1).addScaledVector(axis, -axis.z).normalize();
    const U = new V3(0, 1, 0).addScaledVector(axis, -axis.y).addScaledVector(F, -F.y).normalize();
    const nu = 20, nv = 7, sweep = 80 * DEG, start = A.p.length / 3;
    for (let iv = 0; iv <= nv; iv++) {
      const a = sweep * iv / nv;
      for (let iu = 0; iu <= nu; iu++) {
        const phi = TAU * iu / nu;
        const d = axis.clone().multiplyScalar(Math.cos(a)).addScaledVector(F, Math.sin(a) * Math.cos(phi)).addScaledVector(U, Math.sin(a) * Math.sin(phi));
        A.p.push(c.x + d.x * e.r, c.y + d.y * e.r, c.z + d.z * e.r);
        A.n.push(d.x, d.y, d.z);
        A.uv.push(0.5 + 0.5 * Math.sin(a) * Math.cos(phi), 0.5 - 0.5 * Math.sin(a) * Math.sin(phi));
      }
    }
    for (let iv = 0; iv < nv; iv++) for (let iu = 0; iu < nu; iu++) {
      const i0 = start + iv * (nu + 1) + iu, i1 = i0 + 1, i2 = i0 + nu + 1, i3 = i2 + 1;
      const P = (i) => new V3(A.p[i * 3], A.p[i * 3 + 1], A.p[i * 3 + 2]);
      const q0 = P(i0), nrm = new V3().crossVectors(P(i2).sub(q0), P(i3).sub(q0));
      const out = P(i3).sub(c);
      if (nrm.dot(out) >= 0) A.i.push(i0, i2, i3, i0, i3, i1); else A.i.push(i0, i3, i2, i0, i1, i3);
    }
  }
  return accToGeo(A);
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------
// Imbricated scale field in "scale units" (x along body, y around). Anterior scales
// overlap posterior ones, so each visible scale is a crescent ending in a free edge.
function scaleField(x, y, per, o) {
  const RAD = 0.8;
  let bc = 1e9, bq = 0, bdx = 0, bi = 0, bj = 0;
  const j0 = Math.floor(y);
  for (let j = j0 - 1; j <= j0 + 1; j++) {
    const off = (j & 1) * 0.5, cy = j + 0.5, i0 = Math.floor(x - off);
    for (let i = i0 - 1; i <= i0 + 1; i++) {
      const cx = i + off + 0.5, dx = x - cx, dy = y - cy, q = Math.sqrt(dx * dx + dy * dy) / RAD;
      if (q < 1 && cx < bc) { bc = cx; bq = q; bdx = dx / RAD; bi = i; bj = j; }
    }
  }
  const id = hash2(((bi % per) + per) % per, ((bj % per) + per) % per);
  o.q = bq; o.id = id;
  o.h = 0.5 + 0.42 * bdx - 0.12 * bq * bq + 0.1 * (id - 0.5) + 0.012 * Math.sin(bq * 48);
  o.edge = sstep(0.8, 0.97, bq) * sstep(-0.3, 0.3, bdx);
}

let TILE = null;
function scaleTile() {
  if (TILE) return TILE;
  const S = 512, NS = 8, h = new Float32Array(S * S), o = {};
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { scaleField((x + 0.5) / S * NS, (y + 0.5) / S * NS, NS, o); h[y * S + x] = o.h; }
  const hb = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += h[((y + dy + S) % S) * S + ((x + dx + S) % S)];
    hb[y * S + x] = s / 9;
  }
  const out = new Uint8Array(S * S * 4), st = 7;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const gx = hb[y * S + (x + 1) % S] - hb[y * S + (x - 1 + S) % S], gy = hb[((y + 1) % S) * S + x] - hb[((y - 1 + S) % S) * S + x];
    let nx = -gx * st, ny = -gy * st, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * S + x) * 4;
    out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  TILE = dataTex(out, S, S, { repeat: true, aniso: 8 });
  return TILE;
}

// colour-shading lookup for the scale field (8x8 scales): jitter, free-edge, centre terms
let SHADE = null;
function scaleShade() {
  if (SHADE) return SHADE;
  const S = 512, NS = 8, a = new Float32Array(S * S * 3), o = {};
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    scaleField((x + 0.5) / S * NS, (y + 0.5) / S * NS, NS, o);
    const i = (y * S + x) * 3; a[i] = (o.id - 0.5) * 2; a[i + 1] = o.edge; a[i + 2] = 1 - o.q;
  }
  SHADE = { S, a };
  return SHADE;
}

// Scaleless skin (sharks, billfish): tileable fine grain with faint denticle ridges along the body.
let SKIN = null;
function skinTile() {
  if (SKIN) return SKIN;
  const S = 512, h = new Float32Array(S * S);
  const w = (i, p) => ((i % p) + p) % p;
  const pn = (x, y, p) => { // periodic value noise
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(w(xi, p) + p * 7, w(yi, p)), b = hash2(w(xi + 1, p) + p * 7, w(yi, p)), c = hash2(w(xi, p) + p * 7, w(yi + 1, p)), d = hash2(w(xi + 1, p) + p * 7, w(yi + 1, p));
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    let s = 0.45 * pn(u * 6, v * 6, 6) + 0.27 * pn(u * 14, v * 14, 14) + 0.17 * pn(u * 32, v * 32, 32) + 0.11 * pn(u * 64, v * 64, 64);
    s += 0.025 * Math.sin(TAU * (v * 48 + 0.8 * pn(u * 4, v * 4, 4)));
    h[y * S + x] = s;
  }
  const out = new Uint8Array(S * S * 4), st = 11;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const gx = h[y * S + (x + 1) % S] - h[y * S + (x - 1 + S) % S], gy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
    let nx = -gx * st, ny = -gy * st, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * S + x) * 4;
    out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  SKIN = dataTex(out, S, S, { repeat: true, aniso: 8 });
  return SKIN;
}

function halfPerimeterTable(shape) {
  const NP = 128, Pt = new Float32Array(NP + 1);
  for (let i = 0; i <= NP; i++) Pt[i] = Math.max(shape.ring(Math.max(i / NP, 0.003) * shape.tail).P, 0.003);
  return Pt;
}

// Painting helper: draws in physical (t, v) space onto a (u, v) canvas.
function makeHelper(ctx, W, H, def, shape, R, Pt) {
  const tail = shape.tail, NP = Pt.length - 1, sx = W / tail, k = W / 2048;
  const P = (t) => { const f = clamp(t / tail, 0, 1) * NP, i = Math.min(NP - 1, Math.floor(f)); return lerp(Pt[i], Pt[i + 1], f - i); };
  const E = def.eye;
  const B = {
    ctx, W, H, tail, R, P, def, shape, k, eye: E,
    px: (t, v) => [t * sx, v * H],
    blob(t, v, r, c, soft = 0.3, asp = 1, rot = 0) {
      ctx.save();
      ctx.translate(t * sx, v * H); ctx.scale(sx, H / P(t)); ctx.rotate(rot); ctx.scale(r * asp, r);
      if (soft > 0) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        g.addColorStop(0, rgba(c)); g.addColorStop(Math.max(0, 1 - soft), rgba(c)); g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
      } else ctx.fillStyle = rgba(c);
      ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
      ctx.restore();
    },
    ring(t, v, r, w, col) {
      ctx.save(); ctx.translate(t * sx, v * H); ctx.scale(sx, H / P(t));
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); ctx.restore();
    },
    irregular(t, v, r, c) {
      for (let i = 0; i < 3; i++) {
        const a = R() * TAU, d = r * 0.38 * R();
        B.blob(t + Math.cos(a) * d, v + Math.sin(a) * d / P(t), r * lerp(0.6, 0.85, R()), c, 0.25, lerp(0.8, 1.35, R()), R() * 3);
      }
      B.blob(t, v, r * 0.8, c, 0.2);
    },
    scatter(n, o) {
      const pts = [];
      for (let tries = 0; pts.length < n && tries < n * 40; tries++) {
        const t = lerp(o.t[0], o.t[1], R()), v = lerp(o.v[0], o.v[1], R());
        if (o.dens && R() > o.dens(t, v)) continue;
        if (Math.hypot(t - E.t, (v - E.v) * P(E.t)) < E.r * 1.7) continue;
        const Pv = P(t);
        let ok = true;
        for (const q of pts) { const dt = q[0] - t, dv = (q[1] - v) * Pv; if (dt * dt + dv * dv < o.minD * o.minD) { ok = false; break; } }
        if (ok) pts.push([t, v]);
      }
      return pts;
    },
    path(pts) { ctx.beginPath(); pts.forEach(([t, v], i) => (i ? ctx.lineTo(t * sx, v * H) : ctx.moveTo(t * sx, v * H))); },
    stroke(pts, w, col, blur = 0) { ctx.save(); if (blur) ctx.filter = `blur(${blur * k}px)`; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = col; ctx.lineWidth = w * k; B.path(pts); ctx.stroke(); ctx.restore(); },
    fillPoly(pts, col, blur = 0) { ctx.save(); if (blur) ctx.filter = `blur(${blur * k}px)`; ctx.fillStyle = col; B.path(pts); ctx.closePath(); ctx.fill(); ctx.restore(); },
    line(t0, t1, v, c, w) {
      const pts = []; for (let i = 0; i <= 40; i++) { const t = lerp(t0, t1, i / 40); pts.push([t, v + 0.004 * Math.sin(t * 40 + v * 17)]); }
      B.stroke(pts, w, rgba(c));
    },
    bar(tc, w0, w1, v0, v1, c, blur = 4, lean = 0) {
      const L = [], Rr = [];
      for (let i = 0; i <= 24; i++) {
        const f = i / 24, v = lerp(v0, v1, f), w = lerp(w0, w1, f), cx = tc - lean * (1 - f) + 0.004 * Math.sin(v * 13 + tc * 50);
        L.push([cx - w / 2, v]); Rr.push([cx + w / 2, v]);
      }
      B.fillPoly(L.concat(Rr.reverse()), rgba(c), blur);
    },
  };
  return B;
}

function headPaths(def, shape) {
  const E = def.eye, mp = mouthPathTV(def, shape);
  const opP = []; for (let i = 0; i <= 28; i++) { const v = lerp(def.op.v[0], def.op.v[2], i / 28); opP.push([opT(def, v), v]); }
  const preP = [], pv0 = Math.min(E.v + 0.1, 0.45);
  for (let i = 0; i <= 20; i++) { const v = lerp(pv0, def.op.v[2] - 0.03, i / 20); preP.push([opT(def, v) - def.pre * (1 - 0.35 * (v - pv0)), v]); }
  const mx = []; // maxilla outline (upper jaw bone) above the rear of the mouth line
  for (let i = 0; i <= 12; i++) { const q = lerp(0.35, 1, i / 12), p = mp[Math.round(q * 18)]; mx.push([p[0], p[1] - 0.035 * Math.sin(Math.PI * (i / 12) * 0.5 + 0.3)]); }
  const LLc = def.LL ? curve(def.LL) : null;
  return { mp, opP, preP, mx, LL: LLc };
}

// Sharks: five gill slits, crescent ventral mouth (with a gum line when teeth show), labial furrow,
// nostrils, ampullae of Lorenzini pores and a recessed eye.  isH: height map for the detail normals.
function sharkHead(B, isH) {
  const { def, shape } = B, E = def.eye, G = def.gills, R = mulberry(hashStr(def.id) + 5);
  const sh = (pts, dt, dv) => pts.map(([t, v]) => [t + dt, v + dv]);
  if (isH) B.ring(E.t, E.v, E.r * 1.28, E.r * 0.3, 'rgb(152,152,152)');
  else { B.blob(E.t, E.v, E.r * 1.8, [8, 10, 12, 0.32], 0.8); B.ring(E.t, E.v, E.r * 1.12, E.r * 0.18, 'rgba(10,12,14,0.55)'); }
  for (let i = 0; i < G.t.length; i++) {
    const pts = [];
    for (let k = 0; k <= 20; k++) { const q = k / 20; pts.push([G.t[i] + G.bend * Math.sin(Math.PI * q) + (G.slant || 0) * q, lerp(G.v0[i], G.v1[i], q)]); }
    if (isH) {
      B.stroke(sh(pts, 0.0042, 0), 7, 'rgb(156,156,156)'); // overlapping rear flap
      B.stroke(sh(pts, 0.0016, 0), 3.5, 'rgb(146,146,146)');
      B.stroke(pts, 3, 'rgb(46,46,46)');                  // the slit
    } else {
      B.stroke(sh(pts, -0.0022, 0), 7, 'rgba(0,0,0,0.12)', 3);
      B.stroke(pts, 2.4, 'rgba(10,12,16,0.62)', 0.7);
      B.stroke(sh(pts, 0.0028, 0), 3, 'rgba(255,255,255,0.1)', 1.2);
    }
  }
  const mp = mouthPathTV(def, shape), corner = mp[mp.length - 1], fur = def.furrow || 0;
  const furrow = [corner, [corner[0] + fur * 0.5, corner[1] - 0.02], [corner[0] + fur, corner[1] - 0.03]];
  if (isH) {
    B.stroke(mp, 7, 'rgb(64,64,64)'); B.stroke(sh(mp, 0, -0.014), 3.2, 'rgb(166,166,166)'); B.stroke(sh(mp, 0, 0.016), 3, 'rgb(158,158,158)');
    if (fur) B.stroke(furrow, 2.4, 'rgb(80,80,80)');
  } else {
    if (def.fangs) { B.stroke(mp, 9, 'rgba(92,40,44,0.9)'); B.stroke(sh(mp, 0, 0.012), 2.4, 'rgba(16,10,12,0.85)'); B.stroke(sh(mp, 0, -0.012), 2, 'rgba(16,10,12,0.6)'); }
    else B.stroke(mp, 3.2, 'rgba(14,14,16,0.85)');
    if (fur) B.stroke(furrow, 1.8, 'rgba(14,14,16,0.6)');
  }
  for (const [t, v] of def.nostrils || []) {
    if (isH) { B.blob(t, v, 0.0045, [70, 70, 70, 1], 0.4, 2.2); B.blob(t + 0.002, v - 0.01, 0.003, [165, 165, 165, 1], 0.5, 2.2); }
    else B.blob(t, v, 0.0045, [14, 14, 16, 0.75], 0.4, 2.2);
  }
  const Po = def.pores;
  if (Po) for (let i = 0; i < Po.n; i++) {
    const t = lerp(Po.t[0], Po.t[1], Math.pow(R(), 1.4)), v = lerp(Po.v[0], Po.v[1], R());
    if (Math.hypot(t - E.t, (v - E.v) * B.P(t)) < E.r * 2) continue;
    B.blob(t, v, lerp(0.0006, 0.0011, R()), isH ? [90, 90, 90, 1] : [12, 14, 18, 0.5], 0.4);
  }
}

function headFeatures(B, mode) {
  const { def, shape } = B, E = def.eye, isH = mode === 'h';
  if (def.shark) return sharkHead(B, isH);
  const { mp, opP, preP, mx, LL } = headPaths(def, shape);
  const nos = def.nostrils || [[E.t * 0.55, E.v - 0.02], [E.t * 0.68, E.v - 0.035]];
  const shift = (pts, dt, dv) => pts.map(([t, v]) => [t + dt, v + dv]);
  const plate = opP.concat(preP.slice().reverse());
  const nl = def.sc.nl, tail = shape.tail, tStartLL = opT(def, 0.35);
  if (isH) {
    B.fillPoly(plate, 'rgb(133,133,133)', 10);
    B.stroke(opP, 2.4, 'rgb(112,112,112)');
    B.stroke(shift(opP, -0.003, 0), 2, 'rgb(138,138,138)');
    B.stroke(preP, 2, 'rgb(122,122,122)');
    B.stroke(mx, 2.2, 'rgb(146,146,146)');
    if (def.bigMouth) { B.stroke(shift(mp, 0, -0.022), 12, 'rgb(176,176,176)', 4); B.stroke(shift(mp, 0, 0.026), 12, 'rgb(172,172,172)', 4); }
    B.stroke(mp, def.bigMouth ? 9 : 4.5, 'rgb(36,36,36)');
    B.stroke(shift(mp, 0, 0.014), 3, 'rgb(158,158,158)');
    B.ring(E.t, E.v, E.r * 1.2, E.r * 0.25, 'rgb(150,150,150)');
    B.blob(nos[0][0], nos[0][1], 0.0024, [40, 40, 40, 1], 0.4);
    B.blob(nos[1][0], nos[1][1], 0.002, [50, 50, 50, 1], 0.4);
    if (LL && def.LLpores !== false) for (let i = 0; i < nl; i++) { const t = (i + 0.5) / nl * tail; if (t > tStartLL) B.blob(t, LL(t), tail / nl * 0.2, [70, 70, 70, 1], 0.4, 1.4); }
    if (def.spine) B.fillPoly([[opT(def, 0.4) - 0.014, 0.38], [opT(def, 0.45) + 0.012, 0.45], [opT(def, 0.5) - 0.014, 0.5]], 'rgb(165,165,165)', 1);
    return;
  }
  B.blob(E.t, E.v, E.r * 1.5, [18, 14, 10, 0.22], 0.8);
  B.fillPoly(plate, 'rgba(255,248,235,0.05)', 8);
  B.stroke(opP, 2.2, 'rgba(20,16,12,0.3)');
  B.stroke(shift(opP, -0.0035, 0), 2.6, 'rgba(255,250,240,0.08)');
  B.stroke(shift(opP.filter(p => p[1] > 0.55), 0.0025, 0), 2.2, 'rgba(150,40,45,0.25)');
  B.stroke(preP, 1.4, 'rgba(25,20,15,0.06)');
  B.stroke(mx, 1.5, 'rgba(25,20,15,0.22)');
  if (def.fangs) B.stroke(mp, 7, 'rgba(70,30,32,0.85)'); // slightly parted jaws behind the teeth
  if (def.bigMouth) { // thick lips: dark gape, pale lip rims, shadow under the lower lip
    B.stroke(shift(mp, 0, 0.05), 10, 'rgba(20,14,8,0.22)', 6);
    B.stroke(shift(mp, 0, -0.024), 9, 'rgba(255,238,206,0.16)', 3); B.stroke(shift(mp, 0, 0.026), 9, 'rgba(255,238,206,0.13)', 3);
    B.stroke(mp, 11, 'rgba(22,14,10,0.9)', 1.5);
  }
  B.stroke(mp, 3.6, 'rgba(22,14,10,0.9)');
  B.stroke(shift(mp, 0, 0.014), 3, 'rgba(255,245,230,0.22)');
  B.blob(nos[0][0], nos[0][1], 0.0023, [14, 12, 10, 0.85], 0.35);
  B.blob(nos[1][0], nos[1][1], 0.0019, [14, 12, 10, 0.75], 0.35);
  if (def.teeth) for (let i = 1; i < 17; i++) { const [t, v] = mp[i]; B.blob(t, v + 0.012, 0.0011, [245, 240, 225, 0.85], 0.3); B.blob(t + 0.003, v - 0.01, 0.0009, [245, 240, 225, 0.6], 0.3); }
  if (def.spine) B.fillPoly([[opT(def, 0.4) - 0.014, 0.38], [opT(def, 0.45) + 0.012, 0.45], [opT(def, 0.5) - 0.014, 0.5]], 'rgba(30,34,20,0.3)', 2.5);
  if (!LL) return;
  const llPts = []; for (let i = 0; i <= 40; i++) { const t = lerp(tStartLL, tail, i / 40); llPts.push([t, LL(t)]); }
  B.stroke(llPts, 1.3, 'rgba(240,240,230,0.14)');
  if (def.LLpores !== false) for (let i = 0; i < nl; i++) { const t = (i + 0.5) / nl * tail; if (t > tStartLL) B.blob(t, LL(t), tail / nl * 0.18, [20, 18, 16, 0.55], 0.4, 1.5); }
}

let GRAIN = null;
function paintColor(def, shape, variant, Pt) {
  const W = 2048, H = 512, tail = shape.tail;
  const cv = mkCanvas(W, H), ctx = cv.getContext('2d');
  const R = mulberry(hashStr(def.id) * 31 + variant * 7919 + 1), nz = makeNoise(hashStr(def.id) + variant * 101);
  const B = makeHelper(ctx, W, H, def, shape, R, Pt);
  // 1. base colour (half resolution, upscaled): dorsal->ventral gradient + mottling
  const BW = W >> 1, BH = H >> 1, lut = gradLUT(def.grad, BH), c = [0, 0, 0];
  const base = mkCanvas(BW, BH), bctx = base.getContext('2d'), bimg = bctx.createImageData(BW, BH), bd = bimg.data;
  for (let y = 0; y < BH; y++) {
    const v = (y + 0.5) / BH;
    for (let x = 0; x < BW; x++) {
      const u = (x + 0.5) / BW, n1 = nz.fbm(u * 22, v * 6, 3), n2 = nz.n2(u * 160, v * 40);
      c[0] = lut[y * 3]; c[1] = lut[y * 3 + 1]; c[2] = lut[y * 3 + 2];
      if (def.pix) def.pix(u * tail, v, c, n1, n2);
      const k = 1 + (0.26 * (n1 - 0.5) + 0.08 * (n2 - 0.5)) * (1 - 0.6 * v), i = (y * BW + x) * 4;
      bd[i] = c[0] * k; bd[i + 1] = c[1] * k; bd[i + 2] = c[2] * k; bd[i + 3] = 255;
    }
  }
  bctx.putImageData(bimg, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(base, 0, 0, W, H);
  // 2. species markings
  def.paint(B);
  // 3. scale pigment pattern + fine grain (full resolution)
  if (!GRAIN) { GRAIN = new Float32Array(65536); const gr = mulberry(99); for (let i = 0; i < 65536; i++) GRAIN[i] = 1 + (gr() - 0.5) * 0.05; }
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const sc = def.sc, SH = scaleShade(), SS = SH.S, sa = SH.a, fx = sc.nl * SS / 8 / W, fy = sc.nv * SS / 8 / H;
  const ix = new Int32Array(W); for (let x = 0; x < W; x++) ix[x] = ((((x + 0.5) * fx) | 0) % SS) * 3;
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H, ot = opT(def, v), vf = 1 - 0.75 * sstep(0.55, 0.98, v), row = ((((y + 0.5) * fy) | 0) % SS) * SS * 3;
    const x0 = Math.max(0, Math.floor((ot + 0.003) / tail * W)), x1 = Math.min(W, Math.ceil((ot + 0.035) / tail * W));
    const kj = sc.jit, ke = sc.edge * vf, kc = 0.05 * sc.edge, gy = (y & 255) << 8;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let k = GRAIN[gy | (x & 255)];
      if (x >= x0) {
        const m = x >= x1 ? 1 : sstep(x0, x1, x), j = row + ix[x];
        k *= 1 + m * (kj * sa[j] - ke * sa[j + 1] + kc * sa[j + 2]);
      }
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 4. crisp head details on top
  headFeatures(B, 'c');
  cv.__px = d; // reused by makeORM (avoids a second GPU readback)
  return cv;
}

// roughness (G) + metalness (B), derived from the painted colour so dark spots are not mirror-silver
function makeORM(def, shape, cv) {
  const W = 512, H = 128, sw = cv.width / W, sh = cv.height / H, tail = shape.tail;
  const src = cv.__px || cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  delete cv.__px;
  const metal = crv(def.mat.metal), out = new Uint8Array(W * H * 4), [ml0, ml1] = def.mat.metalLum || [0.1, 0.45];
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H, ot = opT(def, v), mv = metal(v);
    for (let x = 0; x < W; x++) {
      const j = ((y * sh + (sh >> 1)) * cv.width + (x * sw + (sw >> 1))) * 4;
      const lum = (0.3 * src[j] + 0.59 * src[j + 1] + 0.11 * src[j + 2]) / 255, t = (x + 0.5) / W * tail;
      const rough = clamp(def.mat.rough + 0.08 * (0.5 - lum) - (t < ot ? 0.05 : 0), 0.15, 0.9);
      const met = mv * sstep(ml0, ml1, lum);
      const i = (y * W + x) * 4;
      out[i] = 255; out[i + 1] = rough * 255; out[i + 2] = met * 255; out[i + 3] = 255;
    }
  }
  return dataTex(out, W, H);
}

// head detail normal map (gill cover, jaw, eye rim, nostrils, lateral-line pores); alpha = scale mask
function paintDetail(def, shape, Pt) {
  const [W, H] = def.detailRes || (def.body ? [2048, 512] : [1024, 256]), tail = shape.tail, mask = def.sc.mask !== false;
  const cv = mkCanvas(W, H), ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgb(128,128,128)'; ctx.fillRect(0, 0, W, H);
  headFeatures(makeHelper(ctx, W, H, def, shape, mulberry(5), Pt), 'h');
  const src = ctx.getImageData(0, 0, W, H).data, out = new Uint8Array(W * H * 4), st = 2.2;
  const h = (x, y) => src[(clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)) * 4] / 255;
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H, ot = opT(def, v);
    for (let x = 0; x < W; x++) {
      let nx = -(h(x + 1, y) - h(x - 1, y)) * st, ny = -(h(x, y + 1) - h(x, y - 1)) * st, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const t = (x + 0.5) / W * tail, i = (y * W + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = (mask ? 0.12 + 0.88 * sstep(ot + 0.003, ot + 0.04, t) : 1) * 255;
    }
  }
  return dataTex(out, W, H);
}

function paintFinRegion(ctx, rect, f, R) {
  const [x0, y0, w, h] = rect, X = (s) => x0 + s * w, Y = (r) => y0 + r * h;
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
  const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
  for (const [r, c] of f.mem) g.addColorStop(r, c);
  ctx.fillStyle = g; ctx.fillRect(x0, y0, w, h);
  if (f.sCol) { const g2 = ctx.createLinearGradient(x0, 0, x0 + w, 0); for (const [s, c] of f.sCol) g2.addColorStop(s, c); ctx.fillStyle = g2; ctx.fillRect(x0, y0, w, h); }
  // subtle membrane mottling
  for (let i = 0; i < 50; i++) {
    ctx.fillStyle = f.skin ? (R() < 0.5 ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.02)') : R() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    ctx.beginPath(); ctx.ellipse(X(R()), Y(R()), w * lerp(0.02, 0.07, R()), h * lerp(0.02, 0.06, R()), 0, 0, TAU); ctx.fill();
  }
  if (f.mottle) for (let i = 0; i < f.mottle.n; i++) {
    const rr = lerp(f.mottle.rr[0], f.mottle.rr[1], R()) * w;
    ctx.fillStyle = f.mottle.col; ctx.beginPath(); ctx.ellipse(X(R()), Y(lerp(0.05, 0.95, R())), rr * lerp(0.6, 1.4, R()), rr * lerp(0.5, 1, R()), R() * 3, 0, TAU); ctx.fill();
  }
  if (f.stripes) for (let i = 0; i < f.stripes.n; i++) {
    const r = lerp(0.2, 0.85, (i + 0.5) / f.stripes.n);
    ctx.strokeStyle = f.stripes.col; ctx.lineWidth = h * 0.045; ctx.beginPath(); ctx.moveTo(x0, Y(r)); ctx.lineTo(x0 + w, Y(r + 0.06)); ctx.stroke();
  }
  for (const sp of f.spots || []) for (let i = 0; i < sp.n; i++) {
    const s = lerp(sp.s?.[0] ?? 0.04, sp.s?.[1] ?? 0.96, R()), r = lerp(sp.r?.[0] ?? 0.1, sp.r?.[1] ?? 0.85, R());
    const rad = lerp(sp.rr[0], sp.rr[1], R()) * w;
    ctx.fillStyle = sp.col; ctx.beginPath(); ctx.ellipse(X(s), Y(r), rad * (sp.asp ?? 1), rad * lerp(0.8, 1.2, R()), 0, 0, TAU); ctx.fill();
  }
  for (const cn of [f.corner, f.corner2]) if (cn) { // dark (or white) fin tips
    const R0 = Math.max(w, h) * cn.rad, gx = ctx.createRadialGradient(X(cn.s), Y(cn.r), 0, X(cn.s), Y(cn.r), R0);
    gx.addColorStop(0, cn.col); gx.addColorStop(0.55, cn.col); gx.addColorStop(1, cn.col.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = gx; ctx.fillRect(x0, y0, w, h);
  }
  if (f.blotch) {
    const b = f.blotch, gx = ctx.createRadialGradient(X((b.s[0] + b.s[1]) / 2), Y((b.r[0] + b.r[1]) / 2), 0, X((b.s[0] + b.s[1]) / 2), Y((b.r[0] + b.r[1]) / 2), Math.max((b.s[1] - b.s[0]) * w, (b.r[1] - b.r[0]) * h) * 0.6);
    gx.addColorStop(0, b.col); gx.addColorStop(0.7, b.col); gx.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gx; ctx.fillRect(X(b.s[0]), Y(b.r[0]), (b.s[1] - b.s[0]) * w, (b.r[1] - b.r[0]) * h);
  }
  // fin rays: segmented, dichotomously branching (or tapering spines)
  const n = f.rays || 0, sp = n ? w / n : 0;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const X0 = X((i + 0.5) / n);
    if (f.spiny) {
      const th = sp * 0.3; ctx.fillStyle = f.ray;
      ctx.beginPath(); ctx.moveTo(X0 - th / 2, Y(0)); ctx.lineTo(X0 + th / 2, Y(0)); ctx.lineTo(X0 + th * 0.06, Y(1)); ctx.lineTo(X0 - th * 0.06, Y(1)); ctx.fill();
      continue;
    }
    const th = Math.max(1.2, sp * (f.rayW ?? 0.2)), br = f.branch ?? 0.42, br2 = lerp(br, 1, 0.55);
    ctx.strokeStyle = f.ray;
    ctx.lineWidth = th; ctx.beginPath(); ctx.moveTo(X0, Y(0)); ctx.lineTo(X0, Y(br)); ctx.stroke();
    ctx.lineWidth = th * 0.7;
    for (const sd of [-1, 1]) {
      const xa = X0 + sd * sp * 0.12;
      ctx.beginPath(); ctx.moveTo(X0, Y(br)); ctx.quadraticCurveTo(X0 + sd * sp * 0.06, Y((br + br2) / 2), xa, Y(br2)); ctx.stroke();
      ctx.lineWidth = th * 0.5;
      for (const sd2 of [-1, 1]) { ctx.beginPath(); ctx.moveTo(xa, Y(br2)); ctx.lineTo(xa + sd2 * sp * 0.08, Y(1)); ctx.stroke(); }
      ctx.lineWidth = th * 0.7;
    }
    ctx.fillStyle = `rgba(255,255,255,${f.segA ?? 0.18})`; // ray segment joints
    for (let r = 0.1; r < 1; r += lerp(0.05, 0.08, R())) ctx.fillRect(X0 - th, Y(r), th * 2, Math.max(1, h * 0.006));
  }
  if (f.lead) {
    ctx.fillStyle = f.lead.col; ctx.fillRect(x0, y0, w * f.lead.w, h);
    if (f.lead.black) { ctx.fillStyle = f.lead.black; ctx.fillRect(x0 + w * f.lead.w, y0, w * 0.04, h); }
  }
  if (f.edge) {
    const ge = ctx.createLinearGradient(0, Y(1 - f.edge.w), 0, Y(1));
    ge.addColorStop(0, 'rgba(0,0,0,0)'); ge.addColorStop(0.35, f.edge.col); ge.addColorStop(1, f.edge.col);
    ctx.fillStyle = ge; ctx.fillRect(x0, Y(1 - f.edge.w), w, f.edge.w * h + 1);
  }
  if (f.subEdge) { ctx.fillStyle = f.subEdge.col; ctx.fillRect(x0, Y(f.subEdge.at), w, f.subEdge.w * h); }
  if (f.skin) { // skin-covered fin: fine wrinkles along the chord, no translucent fringe
    ctx.strokeStyle = 'rgba(0,0,0,0.05)'; ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) { const yy = Y(R()); ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 + w, yy + h * lerp(-0.03, 0.03, R())); ctx.stroke(); }
    ctx.restore();
    return;
  }
  if (f.noFade) { ctx.restore(); return; }
  ctx.globalCompositeOperation = 'destination-out';
  if (f.notch) for (let i = 0; i <= n; i++) {
    ctx.fillStyle = 'rgba(0,0,0,1)'; ctx.beginPath(); ctx.ellipse(X(i / n), Y(1), sp * 0.42, h * f.notch, 0, 0, TAU); ctx.fill();
  }
  const gm = ctx.createLinearGradient(0, Y(0.94), 0, Y(1));
  gm.addColorStop(0, 'rgba(0,0,0,0)'); gm.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = gm; ctx.fillRect(x0, Y(0.94), w, h * 0.06 + 1);
  ctx.restore();
}

function paintFins(def) {
  const cv = mkCanvas(ATLAS, ATLAS), ctx = cv.getContext('2d'), R = mulberry(hashStr(def.id) + 17);
  const lut = gradLUT(def.grad, 64), fleshAt = (v) => { const i = Math.min(63, (v * 64) | 0) * 3; return [lut[i], lut[i + 1], lut[i + 2]]; };
  const BASE = { caudal: [0.45, 0.3], dorsal: [0.04, 0.05], dorsal2: [0.04, 0.05], anal: [0.92, 0.05], pelvic: [0.9, 0.07], pectoral: [0.75, 0.08] };
  const fp = def.fangs ? { teeth: {}, ...def.fp } : def.fp;
  for (const key of Object.keys(fp)) {
    const f = fp[key], rect = REG[key];
    if (!rect) continue;
    if (key === 'barbel') { ctx.fillStyle = f.flesh; ctx.fillRect(...rect); continue; }
    if (key === 'teeth') { // enamel: ivory root -> translucent white tip
      const g = ctx.createLinearGradient(0, rect[1], 0, rect[1] + rect[3]);
      g.addColorStop(0, '#d9cfb4'); g.addColorStop(0.35, '#ece6d4'); g.addColorStop(1, '#fbfaf4');
      ctx.fillStyle = g; ctx.fillRect(...rect); continue;
    }
    paintFinRegion(ctx, rect, f, R);
    if (BASE[key] && !f.skin && f.base !== false) { // fleshy, scaled fin base blending into the body colour
      const [v, w] = BASE[key], [x0, y0, ww, hh] = rect, cols = key === 'caudal' ? 32 : 1;
      for (let i = 0; i < cols; i++) {
        const s = (i + 0.5) / cols, c = fleshAt(key === 'caudal' ? lerp(0.9, 0.08, s) : v);
        const ext = key === 'caudal' ? w * (1 - 0.55 * Math.pow(Math.abs(s - 0.5) * 2, 2)) : w;
        const g = ctx.createLinearGradient(0, y0, 0, y0 + hh * ext);
        g.addColorStop(0, rgba(c, 0.98)); g.addColorStop(0.3, rgba(c, 0.9)); g.addColorStop(0.65, rgba(c, 0.45)); g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g; ctx.fillRect(x0 + ww * i / cols - 0.5, y0, ww / cols + 1, hh * ext);
      }
      if (key === 'caudal') { // small scales creeping onto the fin base
        ctx.strokeStyle = 'rgba(0,0,0,0.14)'; ctx.lineWidth = 1.2;
        for (let r = 0; r < 4; r++) for (let i = 0; i < 26; i++) {
          const cx = x0 + ww * (i + 0.5 * (r & 1)) / 26, cy = y0 + hh * w * (0.12 + r * 0.17);
          ctx.beginPath(); ctx.arc(cx, cy, ww / 40, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
        }
      }
    }
  }
  return canvasTex(cv, true);
}

function paintEye(def) {
  const e = def.eye, S = 128, d = new Uint8Array(S * S * 4), nz = makeNoise(hashStr(def.id) + 3);
  const iris = hexRGB(e.iris), dark = hexRGB(e.dark), ring = hexRGB(e.ring), rim = hexRGB(def.grad[2][1]).map(v => v * 0.55);
  const mix = (a, b, f) => [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const px = (x + 0.5) / S * 2 - 1, py = (y + 0.5) / S * 2 - 1, r = Math.hypot(px, py), a = Math.atan2(py, px);
    let pr = 0.36; if (e.tear) pr += 0.16 * Math.pow(Math.max(0, Math.cos(a)), 8);
    const k = clamp((r - pr) / (0.8 - pr), 0, 1), streak = nz.n2(a * 9 + 50, r * 4) * 0.6 + nz.n2(a * 30 + 9, r * 9) * 0.4;
    let c = mix(ring, iris, sstep(0.0, 0.16, k));
    c = mix(c, dark, sstep(0.5, 1.0, k) * 0.8);
    c = c.map(v => v * (0.75 + 0.5 * streak));
    if (e.topDark) c = c.map(v => v * (1 - e.topDark * sstep(-0.1, -0.8, py)));
    c = mix(c, [8, 8, 10], 1 - sstep(pr - 0.015, pr + 0.02, r));
    c = mix(c, mix(dark.map(v => v * 0.45), rim, sstep(0.84, 0.95, r)), sstep(0.78, 0.84, r));
    const i = (y * S + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  return dataTex(d, S, S, { srgb: true });
}

// ---------------------------------------------------------------------------
// Shader injection (identical code for every instance -> shared programs)
// ---------------------------------------------------------------------------
const GLSL_DEFORM = /* glsl */`
uniform float uTime;
uniform float uPhase;
uniform float uAmp;
uniform float uWaveK;
uniform float uTurn;
uniform float uStruggle;
uniform float uFlapPhase;
uniform float uFlapAmp;
uniform float uTuck;
uniform vec4 uEnv;  // body-wave envelope: x + y t + z t^2 + w max( t - knee, 0 )^2
uniform vec4 uEnv2; // knee, struggle head-shake amp, struggle tail-thrash amp, rigid snout end (bill base)
float fishLat( float t ) {
  float kn = max( t - uEnv2.x, 0.0 );
  float env = uEnv.x + uEnv.y * t + uEnv.z * t * t + uEnv.w * kn * kn;
  float x = uAmp * env * sin( uPhase - uWaveK * t );
  float d = t - 0.42;
  x += uTurn * 0.6 * ( d * d - 0.0064 );
  float h = 1.0 - t; h = h * h * h;
  float hs = sin( uTime * 23.0 ) * 0.6 + sin( uTime * 14.3 + 1.3 ) * 0.4;
  float ts = sin( uTime * 19.0 - 7.0 * t ) * 0.6 + sin( uTime * 29.0 - 10.0 * t + 2.1 ) * 0.4;
  x += uStruggle * ( uEnv2.y * h * hs + uEnv2.z * t * t * ts );
  return x;
}
vec3 fishDeform( vec3 p, inout vec3 n ) {
  float t = 0.5 - p.z;
  float tq = max( t, uEnv2.w ); // ahead of tq (a bill) the body is a rigid extension of the head
  float h = 1.0 - tq; h = h * h * h;
  float ro = uStruggle * 0.35 * sin( uTime * 7.7 + 1.0 ) * ( t - 0.45 );
  float cr = cos( ro ), sr = sin( ro );
  p.xy = vec2( cr * p.x - sr * p.y, sr * p.x + cr * p.y );
  n.xy = vec2( cr * n.x - sr * n.y, sr * n.x + cr * n.y );
  float x0 = fishLat( tq );
  float sl = ( fishLat( tq + 0.01 ) - x0 ) * 100.0;
  x0 += sl * ( t - tq );
  float th = atan( -sl );
  float c = cos( th ), s = sin( th );
  n = vec3( n.x * c + n.z * s, n.y, -n.x * s + n.z * c );
  return vec3( x0 + p.x * c, p.y + uStruggle * h * 0.02 * sin( uTime * 17.0 + 0.5 ), p.z - p.x * s );
}
`;
const GLSL_FIN_FLAP = 'fishP += aFinN * aFin.x * ( aFin.y * uFlapAmp * sin( uFlapPhase + aFin.z ) - aFin.w * uTuck );\n';
// Eyes with depth: the iris is sampled with a parallax offset, as if it sat behind the clear cornea.
const GLSL_EYE_MAP = /* glsl */`
#ifdef USE_MAP
  vec2 eyeUv = vMapUv;
  if ( uEyeDepth > 0.0 ) {
    vec3 eP = - vViewPosition, eN = normalize( vNormal );
    vec3 q0 = dFdx( eP ), q1 = dFdy( eP );
    vec2 st0 = dFdx( vMapUv ), st1 = dFdy( vMapUv );
    vec3 q1p = cross( q1, eN ), q0p = cross( eN, q0 );
    vec3 eT = q1p * st0.x + q0p * st1.x, eB = q1p * st0.y + q0p * st1.y;
    float eS = max( dot( eT, eT ), dot( eB, eB ) );
    eS = eS > 0.0 ? inversesqrt( eS ) : 0.0;
    vec3 eV = normalize( vViewPosition );
    float eK = 1.0 - smoothstep( 0.33, 0.41, length( vMapUv - 0.5 ) );
    eyeUv -= vec2( dot( eV, eT ), dot( eV, eB ) ) * eS / max( dot( eV, eN ), 0.3 ) * uEyeDepth * eK;
  }
  diffuseColor *= texture2D( map, eyeUv );
#endif
`;
const GLSL_BODY_NORMAL = /* glsl */`
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  vec4 fishDet = texture2D( uDetail, vMapUv );
  mapN.xy *= normalScale * fishDet.a;
  vec3 detN = fishDet.xyz * 2.0 - 1.0;
  detN.xy *= uDetailStr;
  mapN = normalize( vec3( mapN.xy + detN.xy, mapN.z * detN.z ) );
  normal = normalize( tbn * mapN );
#endif
`;

function patchMaterial(mat, U, kind) {
  mat.onBeforeCompile = (sh) => {
    for (const k in U) sh.uniforms[k] = U[k];
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL_DEFORM + (kind === 'fin' ? 'attribute vec4 aFin;\nattribute vec3 aFinN;\n' : ''));
    if (kind === 'depth') {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', 'vec3 fishN = vec3( 0.0, 0.0, 1.0 );\nvec3 transformed = fishDeform( vec3( position ), fishN );');
    } else {
      sh.vertexShader = sh.vertexShader
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 fishP = vec3( position );\n' + (kind === 'fin' ? GLSL_FIN_FLAP : '') + 'fishP = fishDeform( fishP, objectNormal );')
        .replace('#include <begin_vertex>', 'vec3 transformed = fishP;');
    }
    if (kind === 'body') {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nuniform float uDetailStr;')
        .replace('#include <normal_fragment_maps>', GLSL_BODY_NORMAL);
    }
    if (kind === 'eye') {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uEyeDepth;')
        .replace('#include <map_fragment>', GLSL_EYE_MAP);
    }
  };
  mat.customProgramCacheKey = () => 'alpenfisch-' + kind + '-v2';
  return mat;
}

// JS mirror of the vertex deformation (keeps the mouth / hook point attached)
function latJS(u, t) {
  const E = u.uEnv.value, E2 = u.uEnv2.value, kn = Math.max(t - E2.x, 0), T = u.uTime.value;
  const env = E.x + E.y * t + E.z * t * t + E.w * kn * kn;
  let x = u.uAmp.value * env * Math.sin(u.uPhase.value - u.uWaveK.value * t);
  const d = t - 0.42; x += u.uTurn.value * 0.6 * (d * d - 0.0064);
  const h = (1 - t) ** 3;
  x += u.uStruggle.value * (E2.y * h * (Math.sin(T * 23) * 0.6 + Math.sin(T * 14.3 + 1.3) * 0.4) + E2.z * t * t * (Math.sin(T * 19 - 7 * t) * 0.6 + Math.sin(T * 29 - 10 * t + 2.1) * 0.4));
  return x;
}
function deformJS(u, p, out) {
  const t = 0.5 - p.z, tq = Math.max(t, u.uEnv2.value.w), h = (1 - tq) ** 3, T = u.uTime.value, S = u.uStruggle.value;
  const ro = S * 0.35 * Math.sin(T * 7.7 + 1) * (t - 0.45), cr = Math.cos(ro), sr = Math.sin(ro);
  const px = cr * p.x - sr * p.y, py = sr * p.x + cr * p.y;
  const xq = latJS(u, tq), sl = (latJS(u, tq + 0.01) - xq) * 100, x0 = xq + sl * (t - tq), th = Math.atan(-sl), c = Math.cos(th), s = Math.sin(th);
  return out.set(x0 + px * c, py + S * h * 0.02 * Math.sin(T * 17 + 0.5), p.z - px * s);
}

// ---------------------------------------------------------------------------
// Per-species cache
// ---------------------------------------------------------------------------
const NVAR = 3;
const cache = new Map();

function getBase(id) {
  let b = cache.get(id);
  if (b) return b;
  const def = SPECIES[id]; def.id = id;
  const shape = new Shape(def);
  const body = buildBody(shape, def.body), fins = buildFins(def, shape), eyes = buildEyes(def, shape);
  body.computeBoundingBox();
  const yc = (body.boundingBox.max.y + body.boundingBox.min.y) / 2;
  for (const g of [body, fins, eyes]) g.translate(0, -yc, 0);
  const box = new THREE.Box3().setFromBufferAttribute(body.attributes.position).union(new THREE.Box3().setFromBufferAttribute(fins.attributes.position));
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  sphere.radius *= 1.2;
  for (const g of [body, fins, eyes]) { g.boundingBox = box.clone(); g.boundingSphere = sphere.clone(); }
  // hook point: lower-jaw tip on the midline (sharks: underside of the snout; billfish: bill base / lower jaw)
  let mouth;
  if (def.hook) { const [ht, hv, hi] = def.hook, p = shape.surf(ht, hv).addScaledVector(shape.normal(ht, hv), -hi); mouth = new V3(0, p.y - yc, p.z); }
  else { const mp = def.mouthPt ?? def.mouth[0]; mouth = new V3(0, mp[1] - yc, 0.5 - Math.max(mp[0], 0) - 0.004); }
  const Pt = halfPerimeterTable(shape);
  const tile = (def.sc.tile === 'skin' ? skinTile() : scaleTile()).clone();
  tile.repeat.set(def.sc.nl / 8, def.sc.nv / 8);
  b = {
    def, shape, body, fins, eyes, Pt, tile, mouth,
    detail: paintDetail(def, shape, Pt),
    finTex: paintFins(def),
    eyeTex: paintEye(def),
    variants: new Map(),
    triangles: (body.index.count + fins.index.count + eyes.index.count) / 3,
  };
  cache.set(id, b);
  return b;
}

function getVariant(b, k) {
  let v = b.variants.get(k);
  if (v) return v;
  const cv = paintColor(b.def, b.shape, k, b.Pt);
  v = { color: canvasTex(cv, true), orm: makeORM(b.def, b.shape, cv) };
  b.variants.set(k, v);
  return v;
}

/** Build the shared geometry/textures for some species ahead of time (e.g. during a loading screen). */
export function preloadFish(ids = FISH_SPECIES, variants = 1) {
  for (const id of ids) { const b = getBase(id); for (let k = 0; k < variants; k++) getVariant(b, k); }
}

/** Free every cached geometry/texture (only when no fish instances remain). */
export function disposeFishCache() {
  for (const b of cache.values()) {
    b.body.dispose(); b.fins.dispose(); b.eyes.dispose(); b.detail.dispose(); b.finTex.dispose(); b.eyeTex.dispose(); b.tile.dispose();
    for (const v of b.variants.values()) { v.color.dispose(); v.orm.dispose(); }
  }
  cache.clear();
  if (TILE) { TILE.dispose(); TILE = null; }
  if (SKIN) { SKIN.dispose(); SKIN = null; }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------
export function createFish(speciesId, lengthMeters, seed = 0) {
  const id = SPECIES[speciesId] ? speciesId : 'brownTrout';
  const b = getBase(id), def = b.def;
  const R = mulberry((seed * 2654435761) ^ hashStr(id));
  const variant = getVariant(b, ((seed % NVAR) + NVAR) % NVAR);
  const sw = def.swim;
  // big fish beat their tails more slowly: tempo scales with (reference length / length)^0.4
  const fs = sw.ref ? clamp(Math.pow(sw.ref / Math.max(lengthMeters, 0.05), 0.4), 0.55, 1.8) : 1;

  const U = {
    uTime: { value: R() * 100 }, uPhase: { value: R() * TAU }, uAmp: { value: 0.3 }, uWaveK: { value: sw.k },
    uTurn: { value: 0 }, uStruggle: { value: 0 }, uFlapPhase: { value: R() * TAU }, uFlapAmp: { value: 0.5 }, uTuck: { value: 0 },
    uDetail: { value: b.detail }, uDetailStr: { value: def.detailStr ?? 0.8 },
    uEnv: { value: new THREE.Vector4(...(sw.env || [0.02, -0.045, 0.11, 0])) },
    uEnv2: { value: new THREE.Vector4(sw.knee ?? 1, sw.shake ?? 0.045, sw.thrash ?? 0.1, sw.bill ?? 0) },
    uEyeDepth: { value: def.eye.depth ?? 0 },
  };
  // individual variation: slight tint / brightness and body proportions
  const tint = new THREE.Color().setHSL(0, 0, 1).multiplyScalar(lerp(0.9, 1.08, R()));
  tint.r *= lerp(0.96, 1.04, R()); tint.b *= lerp(0.96, 1.04, R());
  const fat = lerp(-0.035, 0.05, R()), deep = lerp(-0.03, 0.04, R());

  const m = def.mat;
  const bodyMat = patchMaterial(new THREE.MeshPhysicalMaterial({
    map: variant.color, color: tint,
    normalMap: b.tile, normalScale: new THREE.Vector2(def.sc.nrm, def.sc.nrm),
    roughnessMap: variant.orm, metalnessMap: variant.orm, roughness: 1, metalness: 1,
    clearcoat: m.clear, clearcoatRoughness: m.ccRough ?? 0.12,
    iridescence: m.irid, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 420],
  }), U, 'body');
  const fm = m.fin || {}; // stiff, skin-covered fins (sharks, tunas, billfish) render opaque
  const finMat = patchMaterial(new THREE.MeshPhysicalMaterial({
    map: b.finTex, color: tint, transparent: !fm.opaque, depthWrite: true, side: THREE.DoubleSide, alphaTest: fm.opaque ? 0.5 : 0.03,
    opacity: fm.opacity ?? 0.92, roughness: fm.rough ?? 0.6, metalness: 0, specularIntensity: fm.spec ?? 0.4, clearcoat: fm.clear ?? 0.15, clearcoatRoughness: fm.ccRough ?? 0.35, forceSinglePass: true,
  }), U, 'fin');
  const eyeMat = patchMaterial(new THREE.MeshPhysicalMaterial({
    map: b.eyeTex, roughness: 0.22, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03,
  }), U, 'eye');
  const depthMat = patchMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), U, 'depth');

  const object = new THREE.Group();
  object.name = 'fish:' + id;
  object.scale.setScalar(lengthMeters);
  const body = new THREE.Mesh(b.body, bodyMat);
  body.castShadow = true; body.receiveShadow = true; body.customDepthMaterial = depthMat;
  const fins = new THREE.Mesh(b.fins, finMat);
  const eyes = new THREE.Mesh(b.eyes, eyeMat);
  for (const mesh of [body, fins, eyes]) { mesh.scale.set(1 + fat, 1 + deep, 1); object.add(mesh); }
  const mouth = new THREE.Object3D();
  mouth.name = 'mouth';
  object.add(mouth);
  object.userData.species = id;

  const st = { speed: 0, speedT: 0, turn: 0, turnT: 0, str: 0, strT: 0, time: U.uTime.value, phase: U.uPhase.value, flap: U.uFlapPhase.value };
  const tmp = new V3();
  const updateMouth = () => { deformJS(U, b.mouth, tmp); mouth.position.set(tmp.x * (1 + fat), tmp.y * (1 + deep), tmp.z); };
  updateMouth();

  return {
    object, mouth, species: id, info: FISH_INFO[id], length: lengthMeters,
    meshes: { body, fins, eyes },
    setSwim(speed01 = 0, turn = 0) { st.speedT = clamp(speed01, 0, 1); st.turnT = clamp(turn, -1, 1); },
    setStruggle(amount = 0) { st.strT = clamp(amount, 0, 1); },
    update(dt) {
      dt = Math.min(Math.max(dt, 0), 0.1);
      st.speed += (st.speedT - st.speed) * (1 - Math.exp(-dt * 3));
      st.turn += (st.turnT - st.turn) * (1 - Math.exp(-dt * 5));
      st.str += (st.strT - st.str) * (1 - Math.exp(-dt * 7));
      const sp = st.speed, S = st.str;
      st.time = (st.time + dt * (sw.sRate ?? 1) * fs) % 1000; // drives the struggle shakes
      st.phase = (st.phase + TAU * lerp(sw.fIdle, sw.fMax, sp) * fs * (1 + S * 0.5) * dt) % TAU;
      st.flap = (st.flap + TAU * lerp(1.5, 2.2, sp) * (sw.flap ?? 1) * (1 + S * 1.5) * dt) % TAU;
      U.uTime.value = st.time; U.uPhase.value = st.phase; U.uFlapPhase.value = st.flap;
      U.uAmp.value = lerp(0.28, 1, sp) * sw.amp * (1 - 0.5 * S);
      U.uTurn.value = st.turn; U.uStruggle.value = S;
      U.uFlapAmp.value = lerp(0.5, 0.1, sp) + S * 0.5;
      U.uTuck.value = sp * 0.55 * (1 - S);
      updateMouth();
    },
    dispose() {
      object.removeFromParent();
      bodyMat.dispose(); finMat.dispose(); eyeMat.dispose(); depthMat.dispose();
    },
  };
}

/** Diagnostics: triangle count of the shared mesh set for a species. */
export function fishTriangleCount(speciesId) { return getBase(speciesId).triangles; }
