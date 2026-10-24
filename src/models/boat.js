// Alpenfisch — traditional Swiss Weidling (Aare/Rhine river boat) with a 15 hp
// tiller outboard, plus a landing net. Everything is procedural: geometry is
// built from code and every texture is painted into a canvas at load time.
//
// Conventions: bow +Z, up +Y, origin = hull centre on the design waterline.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ----------------------------------------------------------------------------
// small helpers
// ----------------------------------------------------------------------------
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _c = new THREE.Color();
const lin = (hex, k = 1) => { _c.set(hex); return [_c.r * k, _c.g * k, _c.b * k]; };
const WHITE = [1, 1, 1];

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Tileable value noise: period (px, py) in lattice units.
function makeNoise(seed) {
  const r = rng(seed); const perm = new Uint8Array(256); const val = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; val[i] = r(); }
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  const h = (X, Y) => val[perm[(perm[X & 255] + Y) & 255]];
  const n = (x, y, px = 256, py = 256) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X0 = ((xi % px) + px) % px, Y0 = ((yi % py) + py) % py, X1 = (X0 + 1) % px, Y1 = (Y0 + 1) % py;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(h(X0, Y0), h(X1, Y0), u), lerp(h(X0, Y1), h(X1, Y1), u), v);
  };
  n.fbm = (x, y, oct, px, py) => { let s = 0, a = 0.5, f = 1, w = 0; for (let o = 0; o < oct; o++) { s += a * n(x * f, y * f, px * f, py * f); w += a; a *= 0.5; f *= 2; } return s / w; };
  return n;
}

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(cv, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

// ----------------------------------------------------------------------------
// procedural textures (shared, built once)
// ----------------------------------------------------------------------------
// Wood: grain runs along U. 1 texture = 2.0 m (U) x 0.5 m (V).
// Returns colour map + data map (R = bump height, G = roughness).
function woodTextures(seed = 7) {
  const W = 1024, H = 256; const n = makeNoise(seed);
  const cc = canvas(W, H), dc = canvas(W, H);
  const ci = cc.getContext('2d').createImageData(W, H), di = dc.getContext('2d').createImageData(W, H);
  const RINGS = 44;
  for (let y = 0; y < H; y++) {
    const fy = y / H;
    for (let x = 0; x < W; x++) {
      const fx = x / W;
      const warp = n.fbm(fx * 2, fy * 2, 3, 2, 2) * 1.1 + n.fbm(fx * 8, fy * 4, 2, 8, 4) * 0.18;
      const r = fy * RINGS + warp * 2.2;
      const t = r - Math.floor(r);
      const late = smooth(0.62, 0.86, t) * (1 - smooth(0.88, 0.99, t));
      const fiber = n(fx * 6, fy * 420, 6, 420);
      const fine = n(fx * 24, fy * 900, 24, 900);
      const blotch = n.fbm(fx * 3, fy * 1.5, 3, 3, 2);
      const k = late * 0.55 + fiber * 0.22 + fine * 0.12;
      const b = 0.86 + blotch * 0.26;
      const i = (y * W + x) * 4;
      ci.data[i] = clamp((204 - 78 * k) * b, 0, 255);
      ci.data[i + 1] = clamp((146 - 70 * k) * b, 0, 255);
      ci.data[i + 2] = clamp((88 - 50 * k) * b, 0, 255);
      ci.data[i + 3] = 255;
      di.data[i] = clamp(255 * (0.7 - late * 0.35 - fiber * 0.25 + fine * 0.1), 0, 255);
      di.data[i + 1] = clamp(255 * (0.36 + late * 0.14 + fiber * 0.12 + (1 - blotch) * 0.08), 0, 255);
      di.data[i + 2] = 0; di.data[i + 3] = 255;
    }
  }
  cc.getContext('2d').putImageData(ci, 0, 0); dc.getContext('2d').putImageData(di, 0, 0);
  return { map: tex(cc), data: tex(dc, false) };
}

function ropeTexture() {
  const W = 64, H = 32, cv = canvas(W, H), ctx = cv.getContext('2d'), im = ctx.createImageData(W, H); const n = makeNoise(3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const f = (u * 3 + v * 3) % 1;                       // 3 twisted strands
    const s = Math.sin(Math.PI * f);
    const fib = n(x * 0.9, y * 0.25, W * 0.9, H * 0.25);
    const k = (0.45 + 0.55 * Math.pow(s, 0.6)) * (0.85 + 0.3 * fib);
    const i = (y * W + x) * 4;
    im.data[i] = 225 * k; im.data[i + 1] = 210 * k; im.data[i + 2] = 172 * k; im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0); return tex(cv);
}

// Generic fabric / grime noise (grey), used by fabric, metal and plastic.
function noiseTexture(seed, weave) {
  const W = 256, cv = canvas(W, W), ctx = cv.getContext('2d'), im = ctx.createImageData(W, W); const n = makeNoise(seed);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    let k = 0.75 + 0.25 * n.fbm(x / 32, y / 32, 4, 8, 8);
    if (weave) { const a = Math.sin(x * Math.PI / 2) * Math.sin(y * Math.PI / 2); k *= 0.86 + 0.14 * a + 0.08 * n(x / 2, y / 2, 128, 128); }
    else k = 0.6 + 0.4 * n.fbm(x / 8, y / 8, 4, 32, 32);
    const i = (y * W + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = 255 * clamp(k, 0, 1); im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0); return tex(cv, !!weave);
}

function swissFlagTexture() {
  const S = 256, cv = canvas(S, S), ctx = cv.getContext('2d');
  ctx.fillStyle = '#d52b1e'; ctx.fillRect(0, 0, S, S);
  const u = S / 32; ctx.fillStyle = '#ffffff';
  ctx.fillRect(13 * u, 6 * u, 6 * u, 20 * u); ctx.fillRect(6 * u, 13 * u, 20 * u, 6 * u);
  const im = ctx.getImageData(0, 0, S, S); const n = makeNoise(11);   // weave
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const k = 0.9 + 0.1 * ((x + y) % 2) + 0.06 * (n(x / 6, y / 6, 43, 43) - 0.5); const i = (y * S + x) * 4;
    im.data[i] *= k; im.data[i + 1] *= k; im.data[i + 2] *= k;
  }
  ctx.putImageData(im, 0, 0); return tex(cv, true, false);
}

function plateTexture(text) {
  const cv = canvas(512, 128), ctx = cv.getContext('2d');
  ctx.fillStyle = '#f4f4ef'; ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, 496, 112);
  // tiny Bernese shield
  ctx.fillStyle = '#d52b1e'; ctx.beginPath(); ctx.moveTo(30, 28); ctx.lineTo(78, 28); ctx.lineTo(78, 76); ctx.quadraticCurveTo(54, 104, 30, 76); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#f1c40f'; ctx.beginPath(); ctx.moveTo(30, 28); ctx.lineTo(78, 28); ctx.lineTo(30, 76); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#111'; ctx.font = 'bold 84px Arial, Helvetica, sans-serif'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 100, 68);
  return tex(cv, true, false);
}

// Cowl decal atlas: u 0..0.5 = port side (front -> back), 0.5..1 = starboard side (back -> front).
// v = height up the cowl side; the top rows and the half edges stay plain paint.
function cowlTexture() {
  const W = 1024, H = 512, cv = canvas(W, H), ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#45494f'); g.addColorStop(0.55, '#33363b'); g.addColorStop(1, '#25282c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (const ox of [0, 512]) {
    ctx.save(); ctx.translate(ox, 0);
    ctx.beginPath(); ctx.moveTo(40, 478); ctx.bezierCurveTo(180, 470, 330, 440, 480, 392); ctx.lineTo(480, 414); ctx.bezierCurveTo(330, 462, 180, 488, 40, 494); ctx.closePath();
    ctx.fillStyle = '#c8202a'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(40, 500); ctx.bezierCurveTo(180, 494, 330, 470, 480, 424); ctx.lineTo(480, 430); ctx.bezierCurveTo(330, 478, 180, 500, 40, 505); ctx.closePath();
    ctx.fillStyle = '#d9dde2'; ctx.fill();
    ctx.fillStyle = '#eef1f4'; ctx.textBaseline = 'alphabetic';
    ctx.font = 'italic bold 84px Arial, Helvetica, sans-serif'; ctx.fillText('15', 278, 416);
    ctx.font = 'bold 32px Arial, Helvetica, sans-serif'; ctx.fillText('ALPINA', 164, 352);
    ctx.font = '14px Arial, Helvetica, sans-serif'; ctx.fillStyle = '#b8bec6'; ctx.fillText('FOUR STROKE · EFI', 166, 374);
    ctx.restore();
  }
  return tex(cv, true, false);
}

function netTexture() {
  const S = 128, cv = canvas(S, S), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S); ctx.strokeStyle = '#1d2422'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(0, S / 2); ctx.lineTo(S / 2, 0); ctx.lineTo(S, S / 2); ctx.lineTo(S / 2, S); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(S, 0); ctx.stroke();
  const t = tex(cv); return t;
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const wood = woodTextures(7);
  const grime = noiseTexture(5, false);
  const weave = noiseTexture(9, true);
  const T = { wood, rope: ropeTexture(), grime, weave, flag: swissFlagTexture(), cowl: cowlTexture(), net: netTexture() };
  const M = {};
  M.wood = new THREE.MeshPhysicalMaterial({ name: 'weidling-wood', map: wood.map, bumpMap: wood.data, bumpScale: 1.2, roughnessMap: wood.data, roughness: 1, vertexColors: true, clearcoat: 0.35, clearcoatRoughness: 0.35 });
  M.metal = new THREE.MeshStandardMaterial({ name: 'galvanised', color: 0xffffff, vertexColors: true, metalness: 0.9, roughness: 0.42, roughnessMap: grime });
  M.rope = new THREE.MeshStandardMaterial({ name: 'rope', map: T.rope, bumpMap: T.rope, bumpScale: 1.5, roughness: 0.92 });
  M.plastic = new THREE.MeshPhysicalMaterial({ name: 'plastic', vertexColors: true, roughness: 0.48, metalness: 0, roughnessMap: grime, clearcoat: 0.15 });
  M.fabric = new THREE.MeshStandardMaterial({ name: 'canvas', map: weave, vertexColors: true, roughness: 0.95, bumpMap: weave, bumpScale: 0.8 });
  M.flag = new THREE.MeshStandardMaterial({ name: 'flag', map: T.flag, roughness: 0.85, side: THREE.DoubleSide });
  M.cowl = new THREE.MeshPhysicalMaterial({ name: 'cowl', map: T.cowl, roughness: 0.32, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.12 });
  M.motor = new THREE.MeshPhysicalMaterial({ name: 'motor-paint', vertexColors: true, roughness: 0.4, metalness: 0.25, clearcoat: 0.4, clearcoatRoughness: 0.3, roughnessMap: grime });
  M.prop = new THREE.MeshStandardMaterial({ name: 'prop', color: 0x9aa1a8, metalness: 0.95, roughness: 0.28, side: THREE.DoubleSide });
  M.mask = new THREE.MeshBasicMaterial({ name: 'boat-water-mask', colorWrite: false, depthWrite: true, transparent: true, side: THREE.DoubleSide });
  SHARED = { T, M };
  return SHARED;
}

// ----------------------------------------------------------------------------
// geometry builders
// ----------------------------------------------------------------------------
class Geo {
  constructor() { this.p = []; this.uv = []; this.c = []; this.i = []; }
  v(x, y, z, u = 0, w = 0, c = WHITE) { this.p.push(x, y, z); this.uv.push(u, w); this.c.push(c[0], c[1], c[2]); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  build(normals = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    if (normals) g.computeVertexNormals();
    return g;
  }
}

// Parametric grid: f(i, j) -> [x, y, z, u, v, color?]
function loftGrid(nI, nJ, f, flip = false) {
  const g = new Geo();
  for (let i = 0; i < nI; i++) for (let j = 0; j < nJ; j++) { const r = f(i, j); g.v(r[0], r[1], r[2], r[3], r[4], r[5] || WHITE); }
  for (let i = 0; i < nI - 1; i++) for (let j = 0; j < nJ - 1; j++) {
    const a = i * nJ + j, b = (i + 1) * nJ + j, c = (i + 1) * nJ + j + 1, d = i * nJ + j + 1;
    if (flip) g.quad(a, d, c, b); else g.quad(a, b, c, d);
  }
  return g.build();
}

// Loft through closed rings of Vector3 (all rings same length).
function loftRings(rings, { flip = false, capStart = false, capEnd = false, uScale = 1, vScale = 1, color = WHITE } = {}) {
  const g = new Geo(); const m = rings[0].length;
  let acc = 0;
  for (let i = 0; i < rings.length; i++) {
    if (i > 0) acc += rings[i][0].distanceTo(rings[i - 1][0]);
    let per = 0;
    for (let j = 0; j <= m; j++) {
      const p = rings[i][j % m];
      if (j > 0) per += p.distanceTo(rings[i][j - 1]);
      g.v(p.x, p.y, p.z, acc * uScale, per * vScale, color);
    }
  }
  const W = m + 1;
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < m; j++) {
    const a = i * W + j, b = (i + 1) * W + j, c = (i + 1) * W + j + 1, d = i * W + j + 1;
    if (flip) g.quad(a, d, c, b); else g.quad(a, b, c, d);
  }
  const parts = [g.build()];
  const mk = (ring, rev) => {
    const h = new Geo(); const ctr = new THREE.Vector3(); ring.forEach(p => ctr.add(p)); ctr.multiplyScalar(1 / ring.length);
    const ci = h.v(ctr.x, ctr.y, ctr.z, 0.5, 0.5, color);
    ring.forEach(p => h.v(p.x, p.y, p.z, 0.5 + (p.x - ctr.x) * 4, 0.5 + (p.y - ctr.y + p.z - ctr.z) * 4, color));
    for (let j = 0; j < m; j++) { const a = 1 + j, b = 1 + (j + 1) % m; if (rev) h.tri(ci, b, a); else h.tri(ci, a, b); }
    return h.build();
  };
  if (capStart) parts.push(mk(rings[0], flip));
  if (capEnd) parts.push(mk(rings[rings.length - 1], !flip));
  return parts.length > 1 ? mergeGeometries(parts, false) : parts[0];
}

// Rectangular strip swept along a path. P: points, T: thickness dirs, W: width dirs.
// Each face gets its own vertices -> crisp edges. Ends capped.
function boxSweep(P, T, W, t, w, color = WHITE, uScale = 0.5) {
  const g = new Geo(); const n = P.length;
  const corner = (i, k) => {
    const s = (k === 1 || k === 2) ? 0.5 : -0.5, th = (k >= 2) ? t : 0;
    return P[i].clone().addScaledVector(W[i], s * w).addScaledVector(T[i], th);
  };
  const tan = P[1].clone().sub(P[0]);
  const flip = tan.clone().cross(W[0]).dot(T[0]) > 0;
  const len = [0]; for (let i = 1; i < n; i++) len.push(len[i - 1] + P[i].distanceTo(P[i - 1]));
  for (let k = 0; k < 4; k++) {
    const base = g.p.length / 3;
    for (let i = 0; i < n; i++) {
      const a = corner(i, k), b = corner(i, (k + 1) % 4);
      g.v(a.x, a.y, a.z, len[i] * uScale, k * 0.13, color); g.v(b.x, b.y, b.z, len[i] * uScale, k * 0.13 + 0.06, color);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2, b = base + (i + 1) * 2, c = b + 1, d = a + 1;
      if (flip) g.quad(a, b, c, d); else g.quad(a, d, c, b);
    }
  }
  for (const [i, rev] of [[0, true], [n - 1, false]]) {
    const base = g.p.length / 3; for (let k = 0; k < 4; k++) { const p = corner(i, k); g.v(p.x, p.y, p.z, (k & 1) * 0.05, (k >> 1) * 0.05, color); }
    if (rev !== flip) g.quad(base, base + 1, base + 2, base + 3); else g.quad(base, base + 3, base + 2, base + 1);
  }
  return g.build(true);
}

// Tube along a CatmullRom through points. uLen: metres per texture repeat along the tube.
function tube(points, radius, tubular = 32, radial = 8, closed = false, uLen = 0.04) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  const g = new THREE.TubeGeometry(curve, tubular, radius, radial, closed);
  if (uLen) { const L = curve.getLength(); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * L / uLen); }
  return g;
}

function M4(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx, order = 'XYZ') {
  return new THREE.Matrix4().compose(V3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, order)), V3(sx, sy, sz));
}

// Normalise a geometry for merging: indexed, attributes position/normal/uv/color only.
function prep(geo, matrix, color) {
  const g = geo.clone();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  g.morphAttributes = {}; g.clearGroups();
  if (!g.index) { const idx = []; for (let i = 0; i < g.attributes.position.count; i++) idx.push(i); g.setIndex(idx); }
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.color) {
    const a = new Float32Array(n * 3); const c = color || WHITE;
    for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  } else if (color) {
    const a = g.attributes.color; for (let i = 0; i < n; i++) a.setXYZ(i, a.getX(i) * color[0], a.getY(i) * color[1], a.getZ(i) * color[2]);
  }
  if (matrix) {
    g.applyMatrix4(matrix);
    if (matrix.determinant() < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
  }
  return g;
}

class Buckets {
  constructor() { this.m = new Map(); }
  add(key, geo, matrix, color) { if (!this.m.has(key)) this.m.set(key, []); this.m.get(key).push(prep(geo, matrix, color)); return this; }
  mesh(key, material, shadow = true) {
    const list = this.m.get(key); if (!list || !list.length) return null;
    const g = mergeGeometries(list, false); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material); mesh.name = key; mesh.castShadow = shadow; mesh.receiveShadow = true; return mesh;
  }
}

// Foil (teardrop) outline in the XZ plane at height y: round nose at +Z (zf), sharp-ish tail at zf-len.
function foilRing(y, zf, len, wid, n = 20) {
  const pts = []; const r = wid / 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const z = c >= 0 ? zf - r + c * r : zf - r + c * (len - r);
    const x = s * r * (c >= 0 ? 1 : 1 - 0.55 * Math.pow(-c, 1.3));
    pts.push(V3(x, y, z));
  }
  return pts;
}

// Rounded-rectangle ring in a plane spanned by unit vectors a (width) and b (height) around centre o.
function rrRing(o, a, b, w, h, r, n = 4) {
  const pts = []; const cx = [w / 2 - r, -(w / 2 - r), -(w / 2 - r), w / 2 - r], cy = [h / 2 - r, h / 2 - r, -(h / 2 - r), -(h / 2 - r)];
  for (let k = 0; k < 4; k++) for (let i = 0; i <= n; i++) {
    const ang = (k + i / n) * Math.PI / 2;
    pts.push(o.clone().addScaledVector(a, cx[k] + Math.cos(ang) * r).addScaledVector(b, cy[k] + Math.sin(ang) * r));
  }
  return pts;
}

// ----------------------------------------------------------------------------
// hull lines (all in metres). u = 0 at the transom, 1 at the bow tip.
// ----------------------------------------------------------------------------
const ZS = -3.70, ZB = 3.80, LEN = ZB - ZS, SHELL = 0.022;
const NOTCH_W = 0.21, NOTCH_Y = 0.44;              // transom motor notch half width / top
const T_AFT = ZS - 0.016, T_FWD = ZS + 0.037;      // transom slab faces
const SEAM = [0.37, 0.70], GROOVE = 0.006, GROOVE_D = 0.0025;
const FLOOR_OFF = 0.085;                            // floorboard top above the hull bottom
const DECK_Z = 2.85;                                 // foredeck starts here
const uOf = z => clamp((z - ZS) / LEN, 0, 1);

function hTop(u) {
  if (u < 0.32) return 0.50 + 0.30 * Math.sin(Math.PI / 2 * u / 0.32);
  if (u <= 0.5) return 0.80;
  const w = Math.min(1, (u - 0.5) / 0.5);
  return 0.022 + 0.778 * Math.pow(Math.cos(w * Math.PI / 2), 1.15);
}
function hBot(u) {
  if (u < 0.32) return 0.36 + 0.18 * Math.sin(Math.PI / 2 * u / 0.32);
  if (u <= 0.48) return 0.54;
  const w = Math.min(1, (u - 0.48) / 0.52);
  return 0.018 + 0.522 * Math.pow(Math.cos(w * Math.PI / 2), 1.3);
}
function yBot(u) {
  if (u < 0.13) { const w = (0.13 - u) / 0.13; return -0.18 + 0.12 * w * w; }
  if (u <= 0.52) return -0.18;
  const w = Math.min(1, (u - 0.52) / 0.48); return -0.18 + 1.11 * Math.pow(w, 1.9);
}
function ySheer(u) {
  if (u < 0.36) { const w = (0.36 - u) / 0.36; return 0.47 + 0.10 * w * w; }
  const w = Math.min(1, (u - 0.36) / 0.64); return 0.47 + 0.55 * Math.pow(w, 2.4);
}
function sec(u) {
  const hB = hBot(u), hT = hTop(u), yB = yBot(u), yS = ySheer(u);
  const ddx = hT - hB, ddy = yS - yB, len = Math.hypot(ddx, ddy), dx = ddx / len, dy = ddy / len;
  return { u, z: ZS + u * LEN, hB, hT, yB, yS, dx, dy, nx: dy, ny: -dx, len,
    sIn0: SHELL * (1 - dx) / dy, sInTop: (yS - yB - dx * SHELL) / dy };
}
const secAtZ = z => sec(uOf(z));
// port-side points on the outer / inner side line at param s, offset `off` into the material
const outerPt = (S, s, off = 0) => [S.hB + S.dx * s - S.nx * off, S.yB + S.dy * s - S.ny * off];
const innerPt = (S, s, off = 0) => [S.hB - S.nx * SHELL + S.dx * s + S.nx * off, S.yB - S.ny * SHELL + S.dy * s + S.ny * off];
const innerX = (S, y) => { const s = (y - S.yB - S.dx * SHELL) / S.dy; return S.hB - S.nx * SHELL + S.dx * s; };
const outerX = (S, y) => S.hB + S.dx * (y - S.yB) / S.dy;
const floorY = z => yBot(uOf(z)) + FLOOR_OFF;

let SECS = null;
function hullSections() {
  if (SECS) return SECS;
  SECS = []; const N = 116;
  for (let i = 0; i <= N; i++) { const t = i / N; SECS.push(sec(1.25 * t - 0.25 * t * t)); }
  return SECS;
}

// Build a strip over sections. prof(S) -> list of [x, y] (already in final order, stbd -> port).
function hullStrip(secs, prof, flip, colFn, vOff = 0) {
  const P = secs.map(prof); const nJ = P[0].length;
  const G = P.map(pp => { const a = [0]; for (let k = 1; k < nJ; k++) a.push(a[k - 1] + Math.hypot(pp[k][0] - pp[k - 1][0], pp[k][1] - pp[k - 1][1])); return a; });
  let ref = 0; secs.forEach((S, i) => { if (Math.abs(S.u - 0.4) < Math.abs(secs[ref].u - 0.4)) ref = i; });
  const Gref = Math.max(1e-4, G[ref][nJ - 1]);
  return loftGrid(secs.length, nJ, (i, j) => {
    const S = secs[i], p = P[i][j]; const Gi = Math.max(1e-4, G[i][nJ - 1]);
    return [p[0], p[1], S.z, S.z / 2.0, vOff + (G[i][j] / Gi) * Gref / 0.5, colFn ? colFn(S, j, p, nJ) : WHITE];
  }, flip);
}
const mirrorRev = list => list.slice().reverse().map(p => [-p[0], p[1]]);

// port half of the bottom panel + first strake, centre -> seam 1 (outer or inner)
function bottomHalf(S, inner) {
  const f = inner ? innerPt : outerPt; const b = 0.018;
  const s0 = inner ? S.sIn0 : 0;
  const C = inner ? [f(S, s0)[0], S.yB + SHELL] : [S.hB, S.yB];
  const cx = Math.max(C[0], b + 0.004);
  const pts = [];
  for (let k = 0; k <= 3; k++) pts.push([(cx - b) * k / 3, C[1]]);
  const P1 = [cx - b, C[1]], P3 = f(S, s0 + b);
  pts.push([0.25 * P1[0] + 0.5 * cx + 0.25 * P3[0], 0.25 * P1[1] + 0.5 * C[1] + 0.25 * P3[1]]);
  pts.push(P3);
  const s1 = SEAM[0] * S.len;
  pts.push(f(S, lerp(s0 + b, s1 - GROOVE, 0.5)));
  pts.push(f(S, s1 - GROOVE));
  pts.push(f(S, s1, GROOVE_D));
  return pts;
}
function strakeHalf(S, inner, k) {
  const f = inner ? innerPt : outerPt;
  const a = SEAM[k - 1] * S.len;
  const top = k === 2 ? (inner ? S.sInTop : S.len) : SEAM[k] * S.len;
  const pts = [f(S, a, GROOVE_D), f(S, a + GROOVE)];
  if (k === 2) { pts.push(f(S, lerp(a + GROOVE, top, 0.5))); pts.push(f(S, top)); }
  else { pts.push(f(S, top - GROOVE)); pts.push(f(S, top, GROOVE_D)); }
  return pts;
}

function buildHullShell(B, seed, accentLin) {
  const secs = hullSections();
  const R = rng(seed);
  const tones = Array.from({ length: 8 }, () => 0.9 + R() * 0.16);
  const seamDark = (j, nJ, lastIsSeam, firstIsSeam) => ((j === nJ - 1 && lastIsSeam) || (j === 0 && firstIsSeam)) ? 0.5 : 1;
  // --- outer shell (material 'hull': varnish above, tar below via shader)
  B.add('hull', hullStrip(secs, S => { const h = bottomHalf(S, false); return mirrorRev(h).concat(h.slice(1)); }, true,
    (S, j, p, nJ) => { const k = tones[0] * ((j === 0 || j === nJ - 1) ? 0.5 : 1); return [k, k, k]; }, 0));
  for (const k of [1, 2]) {
    for (const side of [1, -1]) {
      const t = tones[k * 2 + (side > 0 ? 0 : 1)];
      B.add('hull', hullStrip(secs, S => { const h = strakeHalf(S, false, k); return side > 0 ? h : mirrorRev(h); }, true,
        (S, j, p, nJ) => { const d = side > 0 ? seamDark(j, nJ, k === 1, true) : seamDark(j, nJ, true, k === 1); return [t * d, t * d, t * d]; }, k * 0.41));
    }
  }
  // --- inner shell (varnished interior, darker in the bilge)
  const isecs = secs.filter(S => S.u <= 0.975);
  const bilge = (p, S) => lerp(0.5, 1, smooth(S.yB, S.yB + 0.3, p[1]));
  B.add('wood', hullStrip(isecs, S => { const h = bottomHalf(S, true); return mirrorRev(h).concat(h.slice(1)); }, false,
    (S, j, p, nJ) => { const k = 0.92 * bilge(p, S) * ((j === 0 || j === nJ - 1) ? 0.55 : 1); return [k, k * 0.97, k * 0.93]; }, 0.2));
  for (const k of [1, 2]) for (const side of [1, -1]) {
    const t = tones[k * 2 + (side > 0 ? 0 : 1)] * 0.97;
    B.add('wood', hullStrip(isecs, S => { const h = strakeHalf(S, true, k); return side > 0 ? h : mirrorRev(h); }, false,
      (S, j, p, nJ) => { const d = side > 0 ? seamDark(j, nJ, k === 1, true) : seamDark(j, nJ, true, k === 1); const c = t * d * bilge(p, S); return [c, c * 0.97, c * 0.93]; }, 0.3 + k * 0.37));
  }

  // --- transom slab with motor notch
  {
    const S = sec(0); const h = bottomHalf(S, false).slice(0, 6); h.push(outerPt(S, S.len));
    const outline = mirrorRev(h).concat(h.slice(1));
    const sh = new THREE.Shape();
    sh.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) sh.lineTo(outline[i][0], outline[i][1]);
    sh.lineTo(NOTCH_W + 0.03, S.yS); sh.quadraticCurveTo(NOTCH_W, S.yS, NOTCH_W, S.yS - 0.03); sh.lineTo(NOTCH_W, NOTCH_Y);
    sh.lineTo(-NOTCH_W, NOTCH_Y); sh.lineTo(-NOTCH_W, S.yS - 0.03); sh.quadraticCurveTo(-NOTCH_W, S.yS, -NOTCH_W - 0.03, S.yS);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: T_FWD - T_AFT - 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 6 });
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5 + 0.3, uv.getY(i) * 2.0);
    B.add('hull', g, M4(0, 0, T_AFT + 0.004), [0.95, 0.93, 0.9]);
  }

  // --- bow cap: galvanised sheet over the stem, with rivets
  {
    const U0 = 0.984; const csecs = secs.filter(S => S.u >= U0); csecs.unshift(sec(U0));
    const off = 0.0035;
    const prof = S => { const b = 0.018; const pts = [[0, S.yB - off], [(S.hB - b) * 0.5, S.yB - off], [S.hB - b, S.yB - off]];
      const P3 = outerPt(S, b, -off); pts.push([lerp(S.hB - b, P3[0], 0.5) + off * 0.7, lerp(S.yB - off, P3[1], 0.5) - off * 0.3]); pts.push(P3);
      pts.push(outerPt(S, S.len * 0.5, -off)); pts.push(outerPt(S, S.len + 0.02, -off)); return mirrorRev(pts).concat(pts.slice(1)); };
    B.add('metal', hullStrip(csecs, prof, true, null), null, lin(0x868c91));
    // nose plate closing the tip
    const S = csecs[csecs.length - 1]; const ring = prof(S);
    const g = new Geo(); const top = (S.yS + 0.02), bot = S.yB - off; const zc = S.z + 0.004;
    const ci = g.v(0, (top + bot) / 2, zc + 0.006, 0.5, 0.5);
    ring.forEach(p => g.v(p[0], p[1], S.z, p[0], p[1]));
    for (let j = 0; j < ring.length - 1; j++) g.tri(ci, 1 + j, 2 + j);
    g.tri(ci, ring.length, 1);
    B.add('metal', g.build(), null, lin(0x868c91));
    // stem-head cover over the open top of the tip
    const tsecs = secs.filter(S => S.u >= 0.972); tsecs.unshift(sec(0.972));
    B.add('metal', loftGrid(tsecs.length, 3, (i, j) => { const S = tsecs[i]; const top = outerPt(S, S.len + 0.02, -off); const x = top[0] + 0.001;
      return [(j - 1) * x, top[1] + (j === 1 ? 0.006 : 0), S.z, 0, 0]; }), null, lin(0x868c91));
    const rv = new THREE.SphereGeometry(0.0055, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2);
    const S0 = sec(U0 + 0.003);
    for (const side of [1, -1]) for (const f of [0.15, 0.42, 0.7, 0.97]) {
      const p = outerPt(S0, S0.len * f, -off); const n = V3(side * S0.nx, S0.ny, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), n);
      B.add('metal', rv, new THREE.Matrix4().compose(V3(side * p[0], p[1], S0.z), q, V3(1, 0.6, 1)), lin(0xa8adb2));
    }
  }

  // --- painted stripe + pinstripe (accent), tapering into the bow
  {
    const ssecs = secs.filter(S => S.u >= 0.004 && S.u <= 0.95);
    for (const [c0, c1, col] of [[0.095, 0.02, 'accent'], [0.127, 0.0035, 'pin']]) {
      for (const side of [1, -1]) {
        const prof = S => { const k = 1 - smooth(0.84, 0.95, S.u); const c = S.len - c0 * lerp(1, 0.6, smooth(0.84, 0.95, S.u)); const w = c1 * k + 0.0004;
          const pts = [outerPt(S, c - w, -0.0016), outerPt(S, c + w, -0.0016)]; return side > 0 ? pts : mirrorRev(pts); };
        B.add('accent', hullStrip(ssecs, prof, true, null), null, col === 'pin' ? lin(0xf3ead2) : accentLin);
      }
    }
  }

  // --- rub rails (half round, tapered ends)
  {
    const rsecs = secs.filter(S => S.u <= 0.975);
    for (const side of [1, -1]) {
      const prof = S => { const k = smooth(0, 0.015, S.u) * (1 - smooth(0.95, 0.975, S.u)) * 0.85 + 0.15; const s = S.len - 0.045; const pts = [];
        for (let a = 0; a <= 6; a++) { const ang = -Math.PI / 2 + a / 6 * Math.PI; pts.push(outerPt(S, s + Math.sin(ang) * 0.016 * k, -Math.cos(ang) * 0.014 * k + 0.001)); }
        return side > 0 ? pts : mirrorRev(pts); };
      B.add('wood', hullStrip(rsecs, prof, true, null, 0.7), null, [0.62, 0.5, 0.4]);
    }
  }
}

// gunwale caps, inwales, risers, frames, floorboards, thwarts, foredeck
function buildInterior(B, seed) {
  const R = rng(seed + 17);
  const secs = hullSections();
  // gunwale cap: closed profile swept along the sheer, from the transom face to the tip
  {
    const gsecs = [{ ...sec(0), z: T_AFT }].concat(secs.filter(S => S.u <= 0.986));
    for (const side of [1, -1]) {
      const rings = gsecs.map(S => {
        const xo = S.hT, xi = Math.max(0.004, innerX(S, S.yS)), y = S.yS;
        const loop = [[xi - 0.012, y - 0.006], [xo + 0.014, y - 0.006], [xo + 0.019, y + 0.008], [xo + 0.013, y + 0.024], [(xi + xo) / 2, y + 0.03], [xi - 0.008, y + 0.026], [xi - 0.015, y + 0.012]];
        const L = side > 0 ? loop : loop.slice().reverse().map(p => [-p[0], p[1]]);
        return L.map(p => V3(p[0], p[1], S.z));
      });
      B.add('wood', loftRings(rings, { flip: true, capStart: true, capEnd: true, uScale: 0.5, vScale: 2 }), null, [0.86, 0.72, 0.58]);
    }
  }
  // inwales + risers (box sweeps along the inside of the planking)
  const along = (z0, z1, n, yFn, w, t, col) => {
    for (const side of [1, -1]) {
      const P = [], T = [], W = [];
      for (let i = 0; i <= n; i++) {
        const S = secAtZ(lerp(z0, z1, i / n)); const y = yFn(S); const x = innerX(S, y);
        P.push(V3(side * x, y, S.z)); T.push(V3(-side * S.nx, -S.ny, 0)); W.push(V3(side * S.dx, S.dy, 0));
      }
      B.add('wood', boxSweep(P, T, W, t, w, col, 0.5));
    }
  };
  along(T_FWD, DECK_Z + 0.05, 40, S => S.yS - 0.026, 0.042, 0.024, [0.8, 0.66, 0.5]);
  const riserY = S => 0.208 + Math.max(0, S.z - 0.5) * 0.075;
  along(T_FWD + 0.02, 1.75, 34, riserY, 0.04, 0.022, [0.75, 0.62, 0.48]);

  // frames (ribs) — U-shaped, thicker floor timbers
  const frameZ = []; for (let z = -3.33; z <= 2.7; z += 0.5) frameZ.push(z);
  for (const z of frameZ) {
    const S = secAtZ(z); const pts = [], T = [];
    const sidePt = (s) => { const p = innerPt(S, s); return { p: [p[0], p[1]], n: [-S.nx, -S.ny] }; };
    const xc = innerPt(S, S.sIn0)[0], yb = S.yB + SHELL;
    const half = [
      { p: [0, yb], n: [0, 1], t: 0.045 },
      { p: [Math.max(0.01, xc - 0.04), yb], n: [0, 1], t: 0.045 },
      { p: [xc, yb], n: (() => { const a = V3(-S.nx, 1 - S.ny, 0).normalize(); return [a.x, a.y]; })(), t: 0.04 },
      { ...sidePt(S.sIn0 + 0.05), t: 0.03 },
      { ...sidePt(lerp(S.sIn0, S.sInTop, 0.6)), t: 0.026 },
      { ...sidePt(S.sInTop - 0.05), t: 0.022 },
    ];
    const full = half.slice().reverse().map(h => ({ p: [-h.p[0], h.p[1]], n: [-h.n[0], h.n[1]], t: h.t })).concat(half.slice(1));
    for (const h of full) { pts.push(V3(h.p[0], h.p[1], z)); T.push(V3(h.n[0], h.n[1], 0).multiplyScalar(h.t)); }
    const k = 0.78 + R() * 0.1;
    B.add('wood', boxSweep(pts, T, pts.map(() => V3(0, 0, 1)), 1, 0.042, [k * 0.82, k * 0.66, k * 0.5], 0.5));
  }

  // floorboards: slats following the rocker of the bottom
  {
    const n = 9, pitch = 0.094, sw = 0.074, th = 0.018;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * pitch;
      let z0 = null, z1 = null;
      for (let z = T_FWD + 0.03; z <= 2.45; z += 0.01) {
        const S = secAtZ(z); const ok = innerX(S, floorY(z) - th) > Math.abs(x) + sw / 2 + 0.012;
        if (ok && z0 === null) z0 = z; if (ok) z1 = z; else if (z0 !== null && z > 0) break;
      }
      if (z0 === null || z1 - z0 < 0.3) continue;
      const m = Math.max(8, Math.round((z1 - z0) / 0.08)); const P = [], T = [], W = [];
      for (let k = 0; k <= m; k++) { const z = lerp(z0, z1, k / m); P.push(V3(x, floorY(z) - th, z)); T.push(V3(0, 1, 0)); W.push(V3(1, 0, 0)); }
      const tone = 0.6 + R() * 0.14;
      B.add('wood', boxSweep(P, T, W, th, sw, [tone, tone * 0.88, tone * 0.76], 0.5));
    }
  }

  // thwarts with hanging knees
  const thwarts = [{ z: -3.10, y: 0.26 }, { z: -0.60, y: 0.26 }, { z: 1.45, y: 0.33 }];
  for (const t of thwarts) {
    const S = secAtZ(t.z); const half = innerX(S, t.y - 0.016) - 0.002;
    const g = new RoundedBoxGeometry(half * 2, 0.032, 0.22, 2, 0.008);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * half * 0.9, uv.getY(i) * 0.4);
    B.add('wood', g, M4(0, t.y - 0.016, t.z), [0.86, 0.74, 0.6]);
    for (const side of [1, -1]) {
      const yk = t.y - 0.032; const x0 = innerX(S, yk) - 0.004; const x1 = innerX(S, yk - 0.16);
      const sh = new THREE.Shape(); sh.moveTo(x0 - 0.13, yk); sh.lineTo(x0, yk); sh.lineTo(x1, yk - 0.16); sh.quadraticCurveTo(x1 - 0.02, yk - 0.03, x0 - 0.13, yk);
      const kg = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false, curveSegments: 4 });
      B.add('wood', kg, new THREE.Matrix4().makeScale(side, 1, 1).premultiply(M4(0, 0, t.z - 0.015)), [0.82, 0.68, 0.52]);
    }
  }
  // pillar under the middle thwart
  B.add('wood', new THREE.CylinderGeometry(0.018, 0.022, 0.26 - 0.032 - floorY(-0.6), 10), M4(0, (0.228 + floorY(-0.6)) / 2, -0.6), [0.8, 0.66, 0.5]);

  // foredeck planks (taper to the stem) + deck beam + coaming
  {
    const dsecs = [secAtZ(DECK_Z)].concat(secs.filter(S => S.z > DECK_Z && S.u <= 0.995));
    const NP = 5;
    for (let p = 0; p < NP; p++) {
      const prof = S => { const y = S.yS - 0.012; const xi = Math.max(0.002, innerX(S, y) + 0.004);
        const a = lerp(-xi, xi, p / NP) + (p ? 0.0018 : 0), b = lerp(-xi, xi, (p + 1) / NP) - (p < NP - 1 ? 0.0018 : 0);
        return [[a, y], [lerp(a, b, 0.5), y + 0.0015], [b, y]]; };
      const tone = 0.86 + R() * 0.12;
      // planks run lengthwise: we sweep across sections with the profile across X
      const P = dsecs.map(prof);
      B.add('wood', loftGrid(dsecs.length, 3, (i, j) => [P[i][j][0], P[i][j][1], dsecs[i].z, dsecs[i].z / 2, P[i][j][0] * 2 + p * 0.31, [tone, tone * 0.92, tone * 0.84]], true));
    }
    const S = secAtZ(DECK_Z); const y = S.yS - 0.012; const xi = innerX(S, y);
    B.add('wood', new RoundedBoxGeometry(xi * 2 + 0.01, 0.05, 0.06, 2, 0.006), M4(0, y - 0.02, DECK_Z + 0.02), [0.78, 0.64, 0.5]);
    B.add('wood', new RoundedBoxGeometry(xi * 2 - 0.02, 0.022, 0.025, 2, 0.006), M4(0, y + 0.012, DECK_Z + 0.012), [0.9, 0.76, 0.6]);
  }
  // motor board doubler on the transom
  B.add('wood', new RoundedBoxGeometry(NOTCH_W * 2 + 0.08, 0.24, 0.03, 2, 0.006), M4(0, NOTCH_Y - 0.12, T_FWD + 0.015), [0.8, 0.66, 0.52]);
  // quarter knees tying the gunwales to the transom
  for (const side of [1, -1]) {
    const S = sec(0.02); const y = S.yS - 0.02; const xi = innerX(S, y);
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(-0.2, 0); sh.quadraticCurveTo(-0.06, 0.06, 0, 0.2); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false, curveSegments: 5 });
    B.add('wood', g, new THREE.Matrix4().makeScale(side, 1, 1).premultiply(M4(xi * side, y, T_FWD, Math.PI / 2, 0, 0)), [0.82, 0.66, 0.5]);
  }
  // copper nail heads where the frames are fastened through the planking (outside, above the tar)
  {
    const head = new THREE.CircleGeometry(0.0042, 6); const COPPER = lin(0xb4703f);
    for (const z of frameZ) {
      const S = secAtZ(z);
      const ss = [0.5 * SEAM[0], SEAM[0] + (SEAM[1] - SEAM[0]) * 0.33, SEAM[0] + (SEAM[1] - SEAM[0]) * 0.67, SEAM[1] + (1 - SEAM[1]) * 0.3, SEAM[1] + (1 - SEAM[1]) * 0.62];
      for (const side of [1, -1]) for (const f of ss) {
        const pt = outerPt(S, f * S.len, -0.0009); if (pt[1] < 0.12) continue;
        const n = V3(side * S.nx, S.ny, 0); const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), n);
        B.add('metal', head, new THREE.Matrix4().compose(V3(side * pt[0], pt[1], z + 0.004), q, V3(1, 1, 1)), COPPER);
        B.add('metal', head, new THREE.Matrix4().compose(V3(side * pt[0], pt[1], z - 0.008), q, V3(1, 1, 1)), COPPER);
      }
    }
  }
  return { thwarts, frameZ };
}

// depth-only lid over the open hull so a transparent water surface is not drawn inside the boat
function buildWaterMask() {
  const secs = hullSections();
  const g = loftGrid(secs.length, 2, (i, j) => { const S = secs[i]; const x = (j ? 1 : -1) * (S.hT + 0.01); return [x, S.yS + 0.03, S.z, 0, 0]; });
  return g;
}

// ----------------------------------------------------------------------------
// fittings & gear
// ----------------------------------------------------------------------------
const deckY = z => ySheer(uOf(z)) - 0.012;
const deckSlope = z => (deckY(z + 0.01) - deckY(z - 0.01)) / 0.02;
const EYE_Y = (yBot(1) + ySheer(1)) / 2;
const RING_POS = V3(0, EYE_Y - 0.064, ZB + 0.038);
const GALV = lin(0xc3c8cc), DARKMETAL = lin(0x4a4d50), BRASS = lin(0xd8b25a);

function hornCleat(len = 0.15) {
  const parts = [];
  const horn = new THREE.CapsuleGeometry(0.0085, len - 0.017, 4, 8); horn.rotateX(Math.PI / 2); horn.scale(1, 0.8, 1); horn.translate(0, 0.032, 0);
  parts.push(horn);
  for (const s of [-1, 1]) { const f = new THREE.CylinderGeometry(0.008, 0.012, 0.03, 8); f.translate(0, 0.015, s * len * 0.22); parts.push(f); }
  const base = new RoundedBoxGeometry(0.03, 0.006, len * 0.62, 1, 0.002); base.translate(0, 0.003, 0); parts.push(base);
  return mergeGeometries(parts.map(p => prep(p)), false);
}

function oarGeometry(L = 2.9) {
  // shaft as lathe (axis Y), then laid along +Z
  const prof = [];
  const r = z => z < 0.02 ? 0.012 + z * 0.25 : z < 0.15 ? 0.0175 : z < 0.2 ? lerp(0.0175, 0.024, (z - 0.15) / 0.05) : z < 1.1 ? 0.024 : lerp(0.024, 0.018, (z - 1.1) / (L - 0.75 - 1.1));
  for (let i = 0; i <= 24; i++) { const z = (i / 24) * (L - 0.6); prof.push(new THREE.Vector2(r(z), z)); }
  prof.unshift(new THREE.Vector2(0, 0));
  const shaft = new THREE.LatheGeometry(prof, 10); shaft.rotateX(Math.PI / 2);
  const uv = shaft.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * L * 0.5, uv.getX(i) * 0.15);
  const sh = new THREE.Shape(); const z0 = L - 0.75, bw = 0.072;
  sh.moveTo(-0.016, z0); sh.bezierCurveTo(-0.03, z0 + 0.15, -bw, z0 + 0.25, -bw, z0 + 0.4); sh.lineTo(-bw, L - 0.06);
  sh.quadraticCurveTo(-bw, L, -bw + 0.05, L); sh.lineTo(bw - 0.05, L); sh.quadraticCurveTo(bw, L, bw, L - 0.06);
  sh.lineTo(bw, z0 + 0.4); sh.bezierCurveTo(bw, z0 + 0.25, 0.03, z0 + 0.15, 0.016, z0); sh.closePath();
  const blade = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 6 });
  blade.translate(0, 0, -0.003); blade.rotateX(Math.PI / 2);   // shape y -> +z, extrusion -> -y
  const buv = blade.attributes.uv; for (let i = 0; i < buv.count; i++) buv.setXY(i, buv.getY(i) * 0.5, buv.getX(i) * 0.5);
  const sleeve = new THREE.CylinderGeometry(0.0262, 0.0262, 0.26, 10, 1, true); sleeve.rotateX(Math.PI / 2); sleeve.translate(0, 0, 0.95);
  return { wood: mergeGeometries([prep(shaft), prep(blade)], false), sleeve };
}

function grapnelAnchor(folded = false) {
  const parts = [];
  const shank = new THREE.CylinderGeometry(0.011, 0.011, 0.30, 10); shank.translate(0, 0.15, 0); parts.push(shank);
  const ring = new THREE.TorusGeometry(0.026, 0.0055, 6, 16); ring.translate(0, 0.33, 0); parts.push(ring);
  const collar = new THREE.CylinderGeometry(0.018, 0.018, 0.045, 10); collar.translate(0, 0.07, 0); parts.push(collar);
  const hub = new THREE.CylinderGeometry(0.02, 0.016, 0.035, 10); hub.translate(0, 0.012, 0); parts.push(hub);
  for (let k = 0; k < 4; k++) {
    const pts = folded ? [V3(0, 0.0, 0), V3(0.022, -0.012, 0), V3(0.034, 0.02, 0), V3(0.03, 0.09, 0), V3(0.026, 0.13, 0)]
      : [V3(0, 0.02, 0), V3(0.05, -0.008, 0), V3(0.1, 0.025, 0), V3(0.122, 0.085, 0), V3(0.118, 0.13, 0)];
    const t = tube(pts, 0.0065, 16, 6, false, 0);
    const fl = new THREE.ConeGeometry(0.022, 0.05, 4); fl.scale(1, 1, 0.35); fl.translate(folded ? 0.026 : 0.118, 0.15, 0);
    const g = mergeGeometries([prep(t), prep(fl)], false); g.rotateY(k * Math.PI / 2 + Math.PI / 4); parts.push(g);
  }
  return mergeGeometries(parts.map(p => prep(p)), false);
}

function flemishCoil(cx, cz, r0, r1, turns, yFn, rad) {
  const pts = []; const n = Math.round(turns * 20);
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = t * turns * Math.PI * 2, r = lerp(r0, r1, t);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; pts.push(V3(x, yFn(z) + rad + Math.sin(a * 3.1) * 0.0015, z));
  }
  return pts;
}

function buildGear(B, accent, seed) {
  const R = rng(seed + 41);
  // --- bow eye + mooring ring
  { const eye = new THREE.TorusGeometry(0.014, 0.0045, 6, 14); eye.rotateY(Math.PI / 2); B.add('metal', eye, M4(0, EYE_Y, ZB + 0.022), GALV);
    const plate = new THREE.CylinderGeometry(0.016, 0.016, 0.006, 12); plate.rotateX(Math.PI / 2); B.add('metal', plate, M4(0, EYE_Y, ZB + 0.008), GALV);
    B.add('metal', new THREE.TorusGeometry(0.034, 0.0055, 8, 22), M4(0, EYE_Y - 0.03, ZB + 0.038), GALV); }
  // --- cleats: two on the foredeck, two on the stern gunwales
  const cleat = hornCleat();
  for (const s of [1, -1]) {
    const z = 3.47; B.add('metal', cleat, M4(s * 0.068, deckY(z), z, -Math.atan(deckSlope(z)), 0, 0, 0.85), GALV);
    const S = sec(0.04); B.add('metal', cleat, M4(s * (S.hT - 0.012), S.yS + 0.03, S.z, 0, 0, 0, 0.8), GALV);
  }
  // --- oarlocks at the middle thwart
  for (const s of [1, -1]) {
    const S = secAtZ(-0.95); const x = s * (S.hT - 0.004), y = S.yS + 0.03;
    const sock = new THREE.CylinderGeometry(0.015, 0.018, 0.018, 10); B.add('metal', sock, M4(x, y + 0.009, S.z), GALV);
    const pin = new THREE.CylinderGeometry(0.007, 0.007, 0.07, 8); B.add('metal', pin, M4(x, y + 0.01, S.z), GALV);
    const horn = new THREE.TorusGeometry(0.034, 0.0062, 6, 14, Math.PI); horn.rotateZ(Math.PI); horn.rotateY(Math.PI / 2);
    B.add('metal', horn, M4(x, y + 0.08, S.z), GALV);
  }
  // --- oars on the starboard side, resting on rear + middle thwarts
  const oar = oarGeometry(2.9);
  for (const [x, y, roll] of [[-0.36, 0.283, 0.25], [-0.445, 0.283, -0.3]]) {
    const m = M4(x, y, -3.32, 0.0, 0.012 * (x < -0.4 ? -1 : 1), roll);
    B.add('wood', oar.wood, m, [0.96, 0.86, 0.72]);
    B.add('fabric', oar.sleeve, m, lin(0x3b2a1e));
  }
  // --- push pole (Stachel) with iron shoe
  {
    const a = V3(-0.57, 0.263, -1.2), b = V3(-0.405, 0.356, 1.55); const L = a.distanceTo(b);
    const pole = new THREE.CylinderGeometry(0.02, 0.023, L, 10, 1); const uv = pole.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * L * 0.5, uv.getX(i) * 0.15);
    pole.rotateX(Math.PI / 2);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), b.clone().sub(a).normalize());
    const mid = a.clone().add(b).multiplyScalar(0.5);
    B.add('wood', pole, new THREE.Matrix4().compose(mid, q, V3(1, 1, 1)), [0.9, 0.78, 0.62]);
    const shoe = new THREE.ConeGeometry(0.022, 0.16, 10); shoe.rotateX(Math.PI / 2); shoe.translate(0, 0, L / 2 + 0.075);
    const ferr = new THREE.CylinderGeometry(0.0235, 0.0235, 0.1, 10); ferr.rotateX(Math.PI / 2); ferr.translate(0, 0, L / 2 - 0.03);
    B.add('metal', mergeGeometries([prep(shoe), prep(ferr)], false), new THREE.Matrix4().compose(mid, q, V3(1, 1, 1)), DARKMETAL);
  }
  // --- clamp-on rod holders inside the gunwales beside the fisher (parallel to the flared side, raked aft)
  for (const side of [1, -1]) {
    const S = secAtZ(-0.15); const flare = Math.atan2(S.dx, S.dy);
    const top = V3(side * (innerX(S, S.yS) - 0.032), S.yS + 0.035, S.z);
    const t = new THREE.CylinderGeometry(0.02, 0.017, 0.17, 12, 1, true); t.translate(0, -0.085, 0);
    const lip = new THREE.TorusGeometry(0.02, 0.004, 5, 12); lip.rotateX(Math.PI / 2);
    const m = new THREE.Matrix4().compose(top, new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, 0, -side * flare, 'ZXY')), V3(1, 1, 1));
    B.add('plastic', t, m, lin(0x1a1c1e)); B.add('plastic', lip, m, lin(0x2a2c2e));
    B.add('plastic', new RoundedBoxGeometry(0.03, 0.05, 0.05, 1, 0.006), m.clone().multiply(M4(side * 0.026, -0.05, 0)), lin(0x2a2c2e));
  }
  // --- wooden bailer (Schoepfkelle) by the driver's feet
  {
    const prof = [[0.0, 0.0], [0.07, 0.004], [0.095, 0.03], [0.1, 0.075], [0.094, 0.078], [0.088, 0.034], [0.066, 0.012], [0.0, 0.009]].map(q => new THREE.Vector2(q[0], q[1]));
    const bowl = new THREE.LatheGeometry(prof, 16); bowl.scale(1, 1, 1.25);
    const handle = new THREE.CylinderGeometry(0.013, 0.016, 0.26, 8); handle.rotateX(Math.PI / 2 - 0.35); handle.translate(0, 0.1, -0.21);
    const g = mergeGeometries([prep(bowl), prep(handle)], false);
    B.add('wood', g, M4(0.36, floorY(-2.2) + 0.002, -2.2, 0, 2.3, 0.04), [0.62, 0.48, 0.34]);
  }
  // --- fish crate (slatted) between middle and front thwarts
  const crateZ = 0.58, crateFloor = floorY(crateZ);
  {
    const W = 0.46, Lc = 0.74, H = 0.22, t = 0.014; const c = (k) => { const v = 0.72 + R() * 0.12; return [v, v * 0.93, v * 0.86]; };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add('wood', new THREE.BoxGeometry(0.03, H, 0.03), M4(sx * (W / 2 - 0.015), crateFloor + H / 2, crateZ + sz * (Lc / 2 - 0.015)), c());
    for (let k = 0; k < 3; k++) {
      const y = crateFloor + 0.02 + k * 0.072 + 0.028;
      for (const sx of [-1, 1]) B.add('wood', new RoundedBoxGeometry(t, 0.056, Lc - 0.004, 1, 0.003), M4(sx * (W / 2 - t / 2 + 0.002), y, crateZ), c());
      if (k !== 1) for (const sz of [-1, 1]) B.add('wood', new RoundedBoxGeometry(W - 0.004, 0.056, t, 1, 0.003), M4(0, y, crateZ + sz * (Lc / 2 - t / 2 + 0.002)), c());
    }
    for (let k = 0; k < 4; k++) B.add('wood', new RoundedBoxGeometry(W / 4 - 0.008, 0.012, Lc - 0.03, 1, 0.003), M4(-W / 2 + W / 8 + k * W / 4, crateFloor + 0.014, crateZ), c());
    for (const sz of [-1, 1]) B.add('wood', new THREE.BoxGeometry(W - 0.03, 0.012, 0.03), M4(0, crateFloor + 0.004, crateZ + sz * 0.25), c());
  }
  // --- seat cushion on the front thwart
  B.add('fabric', new RoundedBoxGeometry(0.42, 0.045, 0.2, 3, 0.018), M4(0.02, 0.352, 1.45, 0, 0.05, 0), lin(0xb3282d));
  // --- canvas duffel bag near the bow
  {
    const prof = []; for (let i = 0; i <= 12; i++) { const t = i / 12; const r = 0.12 * Math.pow(Math.sin(Math.PI * t), 0.35) + 0.002; prof.push(new THREE.Vector2(r, (t - 0.5) * 0.5)); }
    const bag = new THREE.LatheGeometry(prof, 14); bag.rotateX(Math.PI / 2); bag.scale(1.1, 0.85, 1);
    const fy = floorY(1.18);
    B.add('fabric', bag, M4(-0.36, fy + 0.1, 1.18, 0, -0.2, 0.1), lin(0x5f6b45));
    for (const dz of [-0.1, 0.1]) { const strap = new THREE.TorusGeometry(0.113, 0.007, 4, 24); strap.scale(1.1, 0.85, 1); B.add('fabric', strap, M4(-0.36, fy + 0.1, 1.18, 0, -0.2, 0.1).multiply(M4(0, 0, dz)), lin(0x2e2a24)); }
    const handle = new THREE.TorusGeometry(0.06, 0.009, 5, 12, Math.PI); B.add('fabric', handle, M4(-0.36, fy + 0.2, 1.18, 0, -0.2 + Math.PI / 2, 0.1), lin(0x2e2a24));
  }
  // --- tackle box (stbd, beside the fisher)
  {
    const fy = floorY(0.02), m = M4(-0.4, fy, 0.02, 0, 0.08, 0);
    const P = (g, mm, col) => B.add('plastic', g, m.clone().multiply(mm), col);
    P(new RoundedBoxGeometry(0.2, 0.14, 0.36, 3, 0.012), M4(0, 0.07, 0), lin(0x3d6b4f));
    P(new RoundedBoxGeometry(0.21, 0.035, 0.37, 3, 0.012), M4(0, 0.155, 0), lin(0x4f8463));
    for (const s of [-1, 1]) P(new RoundedBoxGeometry(0.016, 0.04, 0.035, 1, 0.004), M4(0.105, 0.128, s * 0.11), lin(0xe08a1e));
    const h = new THREE.TorusGeometry(0.06, 0.009, 6, 14, Math.PI); h.rotateY(Math.PI / 2); P(h, M4(0, 0.172, 0), lin(0x23332a));
  }
  // --- thermos near the stbd quarter
  {
    const fy = floorY(-2.62), m = M4(-0.12, fy, -2.62);
    const prof = [[0, 0], [0.042, 0], [0.046, 0.01], [0.046, 0.26], [0.04, 0.28], [0.03, 0.29]].map(p => new THREE.Vector2(p[0], p[1]));
    B.add('metal', new THREE.LatheGeometry(prof, 16), m, lin(0xd9dee2));
    B.add('plastic', new THREE.CylinderGeometry(0.044, 0.046, 0.085, 16), m.clone().multiply(M4(0, 0.325, 0)), lin(0x2a2d31));
    B.add('plastic', new THREE.CylinderGeometry(0.047, 0.047, 0.03, 16), m.clone().multiply(M4(0, 0.06, 0)), lin(0x9c2a22));
  }
  // --- 12 L fuel tank + hose
  {
    const fy = floorY(-3.43), m = M4(-0.22, fy, -3.43);
    const body = new RoundedBoxGeometry(0.25, 0.2, 0.36, 4, 0.04);
    const p = body.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0) p.setX(i, p.getX(i) * (1 - y * 0.5)); }
    body.computeVertexNormals();
    B.add('plastic', body, m.clone().multiply(M4(0, 0.1, 0)), lin(0xc22a1f));
    B.add('plastic', new THREE.CylinderGeometry(0.028, 0.028, 0.03, 14), m.clone().multiply(M4(0.04, 0.205, -0.1)), lin(0x1c1c1c));
    B.add('plastic', new THREE.CylinderGeometry(0.022, 0.022, 0.018, 12), m.clone().multiply(M4(-0.04, 0.2, -0.11)), lin(0xe8e2c8));
    const hd = new THREE.TorusGeometry(0.06, 0.01, 6, 12, Math.PI); hd.rotateY(Math.PI / 2); B.add('plastic', hd, m.clone().multiply(M4(0, 0.18, 0.05)), lin(0x1c1c1c));
    const hose = tube([V3(-0.22, fy + 0.2, -3.27), V3(-0.2, fy + 0.25, -3.18), V3(-0.12, fy + 0.08, -3.3), V3(-0.08, 0.3, -3.5), V3(-0.065, 0.5, -3.6), V3(-0.06, 0.525, -3.675)], 0.0085, 40, 6, false, 0);
    B.add('plastic', hose, null, lin(0x161616));
    const bulb = new THREE.SphereGeometry(0.022, 10, 8); bulb.scale(1, 1, 1.6); B.add('plastic', bulb, M4(-0.12, fy + 0.085, -3.3, 0.6, 0.3, 0), lin(0x111111));
  }
  // --- flag staff socket + staff + brass finial
  {
    const x = 0.40, z = T_FWD + 0.055, y0 = sec(0.02).yS - 0.06;
    B.add('metal', new THREE.CylinderGeometry(0.017, 0.017, 0.12, 12), M4(x, y0 + 0.04, z), GALV);
    B.add('wood', new THREE.CylinderGeometry(0.0095, 0.012, 0.86, 8), M4(x, y0 + 0.43, z), [0.95, 0.85, 0.7]);
    B.add('metal', new THREE.SphereGeometry(0.019, 12, 8), M4(x, y0 + 0.875, z), BRASS);
  }
  // --- registration plates on both sides of the bow
  {
    const z = 2.32; const S = secAtZ(z); const s = S.len - 0.205;
    for (const side of [1, -1]) {
      const p0 = outerPt(S, s, -0.003); const S2 = secAtZ(z + 0.01); const p1 = outerPt(S2, S2.len - 0.205, -0.003);
      const pos = V3(side * p0[0], p0[1], z);
      const along = V3(side * (p1[0] - p0[0]), p1[1] - p0[1], 0.01).normalize();
      const up = V3(side * S.dx, S.dy, 0).normalize();
      const xAxis = side > 0 ? along.clone().negate() : along.clone();
      const yAxis = up.clone().addScaledVector(xAxis, -up.dot(xAxis)).normalize();
      const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
      const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(pos);
      B.add('plate', new THREE.PlaneGeometry(0.3, 0.072), m);
    }
  }
  return { crate: V3(0, crateFloor + 0.02, crateZ) };
}

// anchor stowed on the foredeck with its coiled line (one group, hidden when deployed)
function buildAnchorStowed(M) {
  const B = new Buckets();
  const z = 3.0, slope = -Math.atan(deckSlope(3.15));
  // folded grapnel lying on the deck, shank toward the bow
  B.add('anchor', grapnelAnchor(true), M4(0.105, deckY(3.15) + 0.036, z, slope, 0, 0).multiply(M4(0, 0, 0, Math.PI / 2, 0.5, 0)), GALV);
  const ringP = V3(0.105, deckY(3.33) + 0.03, 3.33);
  const coil = flemishCoil(-0.07, 3.08, 0.025, 0.115, 4.3, zz => deckY(zz), 0.0065);
  const last = coil[coil.length - 1], first = coil[0];
  const lead = [last, V3(last.x + 0.04, deckY(last.z + 0.06) + 0.008, last.z + 0.06), V3(0.06, deckY(3.25) + 0.012, 3.25), V3(0.09, ringP.y - 0.01, ringP.z - 0.02), ringP];
  B.add('rope', tube(coil, 0.0065, 180, 6, false, 0.05));
  B.add('rope', tube(lead, 0.0065, 18, 6, false, 0.05));
  const toCleat = [first, V3(first.x + 0.01, first.y + 0.02, first.z + 0.03), V3(-0.06, deckY(3.3) + 0.015, 3.3), V3(-0.07, deckY(3.44) + 0.035, 3.44), V3(-0.06, deckY(3.5) + 0.034, 3.5), V3(-0.08, deckY(3.47) + 0.03, 3.47)];
  B.add('rope', tube(toCleat, 0.0065, 24, 6, false, 0.05));
  const g = new THREE.Group(); g.name = 'anchor-stowed';
  g.add(B.mesh('anchor', M.metal)); g.add(B.mesh('rope', M.rope));
  return g;
}
function buildAnchorRope(M) {
  const a = RING_POS.clone(), b = V3(0, -2.4, 7.1);
  const mid = a.clone().lerp(b, 0.5).add(V3(0, -0.06, 0));
  const g = tube([a, a.clone().lerp(mid, 0.5).add(V3(0, -0.012, 0)), mid, b], 0.0068, 40, 6, false, 0.05);
  const mesh = new THREE.Mesh(g, M.rope); mesh.castShadow = true; mesh.name = 'anchor-rope';
  return mesh;
}

// ----------------------------------------------------------------------------
// 15 hp tiller outboard. Local frame: origin on the steering axis at clamp height,
// +Z toward the boat (forward), lower unit hangs down -Y.
// ----------------------------------------------------------------------------
const PIVOT = V3(0, 0.455, ZS - 0.115);
const PAINT = lin(0x2b2e33), RUBBER = lin(0x121212), ORANGE = lin(0xe07a1f), RED = lin(0xc0201e), ZINC = lin(0xa9adb0), ALU = lin(0x8d9399);

// Super-ellipse shell, rings stacked in Y, optional rounded top / bottom. u runs around (port half 0..0.5, stbd 0.5..1).
function cowlShell({ y0, y1, a0, b0, zc, R = 0, roundTop = true, slope = 0, taper = 0, n = 4, m = 40, straight = 3, cap = true }) {
  const g = new Geo(); const rings = [];
  const H = y1 - y0;
  for (let i = 0; i <= straight; i++) rings.push({ y: roundTop ? y0 + (H - R) * i / straight : y1 - (H - R) * i / straight, k: 0 });
  if (R > 0) for (let i = 1; i <= 6; i++) { const ph = i / 6 * Math.PI / 2; rings.push({ y: roundTop ? y1 - R + R * Math.sin(ph) : y0 + R - R * Math.sin(ph), k: R * (1 - Math.cos(ph)) }); }
  if (!roundTop) rings.reverse();
  const N = rings.length; const SE = (v) => Math.sign(v) * Math.pow(Math.abs(v), 2 / n);
  for (let i = 0; i < N; i++) {
    const { y, k } = rings[i]; const h = clamp((y - y0) / H, 0, 1);
    const a = a0 * (1 - taper * h) - k, b = b0 * (1 - taper * 0.5 * h) - k, z0 = zc - slope * h * h;
    for (let j = 0; j <= m; j++) {
      const th = (j / m) * Math.PI * 2;
      g.v(SE(Math.sin(th)) * a, y, z0 + SE(Math.cos(th)) * b, j / m, h * 0.86 + 0.02);
    }
  }
  const W = m + 1;
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < m; j++) { const A = i * W + j, Bv = (i + 1) * W + j, C = (i + 1) * W + j + 1, D = i * W + j + 1; g.quad(A, D, C, Bv); }
  const geo = g.build();
  const nrm = geo.attributes.normal; for (let i = 0; i < N; i++) { const A = i * W, Bv = i * W + m; const v = V3(nrm.getX(A) + nrm.getX(Bv), nrm.getY(A) + nrm.getY(Bv), nrm.getZ(A) + nrm.getZ(Bv)).normalize(); nrm.setXYZ(A, v.x, v.y, v.z); nrm.setXYZ(Bv, v.x, v.y, v.z); }
  if (!cap) return geo;
  const c = new Geo(); const last = roundTop ? N - 1 : 0; const { y } = rings[last];
  const ring = []; for (let j = 0; j < m; j++) ring.push([geo.attributes.position.getX(last * W + j), geo.attributes.position.getZ(last * W + j)]);
  const cx = ring.reduce((s, p) => s + p[0], 0) / m, cz = ring.reduce((s, p) => s + p[1], 0) / m;
  const ci = c.v(cx, y + (roundTop ? 0.004 : -0.004), cz, 0.25, roundTop ? 0.99 : 0.01);
  ring.forEach(p => c.v(p[0], y, p[1], 0.25, roundTop ? 0.99 : 0.01));
  for (let j = 0; j < m; j++) { const A = 1 + j, Bv = 1 + (j + 1) % m; if (roundTop) c.tri(ci, A, Bv); else c.tri(ci, Bv, A); }
  return mergeGeometries([geo, c.build()], false);
}

function propellerGeometry() {
  const parts = [];
  const prof = [[0, 0.03], [0.022, 0.028], [0.03, 0.015], [0.03, -0.05], [0.026, -0.075], [0.021, -0.078], [0.019, -0.05]].map(p => new THREE.Vector2(p[0], p[1]));
  const hub = new THREE.LatheGeometry(prof, 16); hub.rotateX(Math.PI / 2); parts.push(hub);   // lathe +y -> +z (front inside the gearcase)
  const P = 0.28, NR = 8, NC = 6;
  for (let b = 0; b < 3; b++) {
    const tb = b * Math.PI * 2 / 3;
    for (const sgn of [1, -1]) {
      const g = new Geo();
      for (let ir = 0; ir <= NR; ir++) {
        const t = ir / NR, r = lerp(0.024, 0.116, t);
        const C = 0.072 * (0.62 + 0.55 * t) * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.6))) + 0.002;
        const phi = Math.atan(P / (2 * Math.PI * r)); const skew = 0.32 * Math.pow(t, 1.6);
        for (let ic = 0; ic <= NC; ic++) {
          const c = (ic / NC) * 2 - 1, s = c * C / 2;
          const T = 0.0065 * (1 - 0.75 * t) * (1 - c * c) * sgn * 0.5;
          const tang = s * Math.cos(phi) + T * Math.sin(phi), ax = -s * Math.sin(phi) + T * Math.cos(phi);
          const ang = tb + skew + tang / r;
          g.v(r * Math.cos(ang), r * Math.sin(ang), ax - 0.02, t, c);
        }
      }
      for (let i = 0; i < NR; i++) for (let j = 0; j < NC; j++) { const A = i * (NC + 1) + j, Bv = A + NC + 1; if (sgn > 0) g.quad(A, Bv, Bv + 1, A + 1); else g.quad(A, A + 1, Bv + 1, Bv); }
      parts.push(g.build());
    }
  }
  return mergeGeometries(parts.map(p => prep(p)), false);
}

function buildMotor(Bfixed, M) {
  const B = new Buckets();
  // --- upper cowl (decal atlas: port half / stbd half)
  B.add('cowl', cowlShell({ y0: 0.186, y1: 0.45, a0: 0.158, b0: 0.225, zc: -0.115, R: 0.075, roundTop: true, slope: 0.035, taper: 0.1, m: 48, straight: 3 }));
  // --- lower cowl / pan, rubber seal band
  B.add('motor', cowlShell({ y0: 0.03, y1: 0.18, a0: 0.15, b0: 0.218, zc: -0.115, R: 0.05, roundTop: false, taper: -0.04, m: 40, straight: 2 }), null, lin(0x34373c));
  B.add('motor', cowlShell({ y0: 0.176, y1: 0.19, a0: 0.161, b0: 0.228, zc: -0.115, R: 0, m: 40, straight: 1, cap: false }), null, RUBBER);
  // --- midsection (drive shaft housing) and gearcase strut
  const mid = []; for (let i = 0; i <= 8; i++) { const t = i / 8; mid.push(foilRing(lerp(0.06, -0.562, t), lerp(-0.035, -0.04, t), lerp(0.235, 0.21, t), lerp(0.122, 0.088, t), 22)); }
  B.add('motor', loftRings(mid.reverse(), { flip: true }), null, PAINT);
  const strut = []; for (let i = 0; i <= 3; i++) { const t = i / 3; strut.push(foilRing(lerp(-0.552, -0.7, t), lerp(-0.035, -0.02, t), 0.215, lerp(0.07, 0.056, t), 22)); }
  B.add('motor', loftRings(strut.reverse(), { flip: true }), null, PAINT);
  { const r = []; for (const y of [0.032, 0.022]) r.push(foilRing(y, -0.029, 0.248, 0.136, 22)); B.add('motor', loftRings(r, { flip: true }), null, RUBBER); }
  B.add('motor', new THREE.CylinderGeometry(0.005, 0.005, 0.02, 8), M4(0.06, 0.07, -0.32, Math.PI / 2, 0, 0), lin(0x9aa0a6));
  // --- anti-cavitation plate
  { const s = new THREE.Shape(); s.moveTo(-0.05, 0.0); s.bezierCurveTo(-0.12, -0.02, -0.125, -0.12, -0.12, -0.24); s.quadraticCurveTo(-0.118, -0.33, -0.06, -0.335);
    s.lineTo(0.06, -0.335); s.quadraticCurveTo(0.118, -0.33, 0.12, -0.24); s.bezierCurveTo(0.125, -0.12, 0.12, -0.02, 0.05, 0.0); s.quadraticCurveTo(0, 0.03, -0.05, 0.0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.003, bevelSegments: 1, curveSegments: 8 });
    g.rotateX(Math.PI / 2); // shape y -> -z ... (x, y, d) -> (x, -d, y)
    B.add('motor', g, M4(0, -0.556, -0.02), PAINT); }
  // --- torpedo gearcase
  { const pr = []; const L = 0.31; for (let i = 0; i <= 14; i++) { const t = i / 14; const z = t * L; const r = 0.046 * Math.pow(Math.sin(Math.min(1, t * 1.6) * Math.PI / 2), 0.55) * (1 - 0.35 * Math.pow(t, 3)); pr.push(new THREE.Vector2(Math.max(0.001, r), z)); }
    const g = new THREE.LatheGeometry(pr, 18); g.rotateX(-Math.PI / 2); // +y -> -z: nose at z=0 going aft
    B.add('motor', g, M4(0, -0.7, 0.055), PAINT); }
  // --- skeg
  { const s = new THREE.Shape(); s.moveTo(-0.03, -0.71); s.lineTo(-0.25, -0.71); s.lineTo(-0.24, -0.855); s.quadraticCurveTo(-0.225, -0.878, -0.2, -0.872); s.lineTo(-0.16, -0.85); s.lineTo(-0.04, -0.735); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 4 });
    g.rotateY(-Math.PI / 2); // shape x -> z, extrude -> x
    B.add('motor', g, M4(0.004, 0, 0), PAINT); }
  // --- anode, intake slots, exhaust relief
  B.add('motor', new RoundedBoxGeometry(0.012, 0.035, 0.07, 1, 0.004), M4(0, -0.58, -0.17), ZINC);
  for (const s of [1, -1]) for (let k = 0; k < 4; k++) B.add('motor', new THREE.BoxGeometry(0.004, 0.035, 0.007), M4(s * 0.03, -0.62, -0.045 - k * 0.016), RUBBER);
  B.add('motor', new THREE.SphereGeometry(0.012, 8, 6), M4(0, -0.12, -0.258, 0, 0, 0, 0.6, 1.4, 0.4), RUBBER);
  // --- steering yoke + lower mount to the swivel shaft
  B.add('motor', new RoundedBoxGeometry(0.07, 0.05, 0.06, 1, 0.01), M4(0, -0.2, -0.02), lin(0x26292d));
  B.add('motor', new RoundedBoxGeometry(0.09, 0.04, 0.07, 1, 0.01), M4(0, 0.02, -0.015), lin(0x26292d));
  // --- tiller arm
  { const rings = []; const z0 = 0.06, z1 = 0.62;
    for (let i = 0; i <= 8; i++) { const t = i / 8; const z = lerp(z0, z1, t); const y = 0.1 + 0.03 * t; rings.push(rrRing(V3(0, y, z), V3(1, 0, 0), V3(0, 1, 0), lerp(0.062, 0.042, t), lerp(0.05, 0.036, t), lerp(0.018, 0.014, t), 3)); }
    B.add('motor', loftRings(rings, { flip: true, capEnd: true }), null, lin(0x303338)); }
  B.add('motor', new THREE.CylinderGeometry(0.026, 0.026, 0.075, 14), M4(0, 0.1, 0.09, 0, 0, Math.PI / 2), lin(0x26292d));
  // twist grip with ribs
  { const pr = []; for (let i = 0; i <= 40; i++) { const t = i / 40; const z = t * 0.2; let r = 0.0205 + 0.0012 * Math.sin(t * Math.PI * 34) * (t > 0.08 && t < 0.92 ? 1 : 0); if (t > 0.94) r *= Math.sqrt(Math.max(0.05, 1 - (t - 0.94) / 0.06 * 0.95)); pr.push(new THREE.Vector2(r, z)); }
    pr.unshift(new THREE.Vector2(0.001, 0)); const g = new THREE.LatheGeometry(pr, 14); g.rotateX(Math.PI / 2);
    B.add('motor', g, M4(0, 0.13, 0.62), RUBBER);
    B.add('motor', new THREE.CylinderGeometry(0.0225, 0.0225, 0.008, 14), M4(0, 0.13, 0.625, Math.PI / 2, 0, 0), ORANGE);
    B.add('motor', new THREE.CylinderGeometry(0.008, 0.008, 0.008, 10), M4(0, 0.13, 0.822, Math.PI / 2, 0, 0), RED); }
  // kill switch + coiled lanyard
  B.add('motor', new THREE.CylinderGeometry(0.014, 0.016, 0.016, 12), M4(0, 0.14, 0.2), RED);
  { const pts = []; const turns = 10, n = turns * 10; for (let i = 0; i <= n; i++) { const t = i / n, a = t * turns * Math.PI * 2; pts.push(V3(Math.cos(a) * 0.007 + 0.036 + 0.01 * t, 0.135 - 0.11 * t, 0.205 + Math.sin(a) * 0.007 + 0.05 * t * t)); }
    B.add('motor', tube(pts, 0.0019, n, 4, false, 0), null, RED); }
  // recoil starter T-handle, choke, shift lever, fuel connector, cowl latch
  { const h = new THREE.CapsuleGeometry(0.011, 0.07, 3, 8); h.rotateZ(Math.PI / 2); B.add('motor', h, M4(0, 0.3, 0.128), RUBBER);
    B.add('motor', new THREE.CylinderGeometry(0.008, 0.008, 0.03, 8), M4(0, 0.3, 0.112, Math.PI / 2, 0, 0), RUBBER); }
  B.add('motor', new THREE.CylinderGeometry(0.009, 0.009, 0.02, 10), M4(0.07, 0.11, 0.105, Math.PI / 2, 0, 0), lin(0xd8d8d0));
  { const lever = new RoundedBoxGeometry(0.012, 0.09, 0.02, 1, 0.004); B.add('motor', lever, M4(-0.158, 0.1, 0.04, 0.5, 0, 0), RUBBER);
    B.add('motor', new THREE.SphereGeometry(0.014, 10, 8), M4(-0.158, 0.14, 0.06), RUBBER); }
  B.add('motor', new THREE.CylinderGeometry(0.012, 0.012, 0.03, 10), M4(-0.06, 0.07, 0.108, Math.PI / 2, 0, 0), lin(0x1a1a1a));
  B.add('motor', new RoundedBoxGeometry(0.05, 0.02, 0.012, 1, 0.004), M4(0, 0.2, -0.34), RUBBER);

  const yaw = new THREE.Group(); yaw.name = 'outboard'; yaw.position.copy(PIVOT);
  const body = new THREE.Group(); yaw.add(body);
  body.add(B.mesh('cowl', M.cowl)); body.add(B.mesh('motor', M.motor));
  const prop = new THREE.Mesh(propellerGeometry(), M.prop); prop.castShadow = true; prop.name = 'prop';
  prop.position.set(0, -0.7, -0.255); body.add(prop);
  const tillerGrip = new THREE.Object3D(); tillerGrip.name = 'tillerGrip'; tillerGrip.position.set(0, 0.13, 0.72); body.add(tillerGrip);

  // --- fixed clamp bracket on the transom (goes into the boat's metal bucket)
  const P0 = PIVOT; const AL = lin(0x8a9096);
  Bfixed.add('metal', new THREE.CylinderGeometry(0.032, 0.032, 0.25, 14), M4(P0.x, 0.345, P0.z), AL);
  Bfixed.add('metal', new THREE.CylinderGeometry(0.018, 0.018, 0.25, 10), M4(0, 0.43, -3.77, 0, 0, Math.PI / 2), AL);
  for (const s of [1, -1]) {
    const sh = new THREE.Shape(); sh.moveTo(0, 0.47); sh.lineTo(-0.115, 0.47); sh.lineTo(-0.13, 0.36); sh.lineTo(-0.1, 0.24); sh.lineTo(-0.02, 0.22); sh.lineTo(0, 0.3); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.003, bevelSegments: 1 });
    g.rotateY(-Math.PI / 2); // shape x -> z
    Bfixed.add('metal', g, M4(s * 0.1 + 0.006, 0, T_AFT), AL);
    // clamp: top bar, inner leg, screw, pad, T-handle
    Bfixed.add('metal', new RoundedBoxGeometry(0.045, 0.022, 0.245, 1, 0.006), M4(s * 0.1, NOTCH_Y + 0.011, -3.6775), AL);
    Bfixed.add('metal', new RoundedBoxGeometry(0.045, 0.16, 0.02, 1, 0.006), M4(s * 0.1, NOTCH_Y - 0.06, T_FWD + 0.07), AL);
    Bfixed.add('metal', new THREE.CylinderGeometry(0.008, 0.008, 0.11, 8), M4(s * 0.1, 0.34, T_FWD + 0.075, Math.PI / 2, 0, 0), GALV);
    Bfixed.add('metal', new THREE.CylinderGeometry(0.02, 0.02, 0.008, 12), M4(s * 0.1, 0.34, T_FWD + 0.034, Math.PI / 2, 0, 0), RUBBER);
    const th = new THREE.CapsuleGeometry(0.008, 0.08, 3, 8); th.rotateZ(Math.PI / 2); Bfixed.add('metal', th, M4(s * 0.1, 0.34, T_FWD + 0.13), RUBBER);
  }
  return { yaw, body, prop, tillerGrip };
}

// ----------------------------------------------------------------------------
// materials that differ per boat
// ----------------------------------------------------------------------------
function makeHullMaterial(T, accent) {
  const m = new THREE.MeshPhysicalMaterial({ name: 'weidling-hull', map: T.wood.map, bumpMap: T.wood.data, bumpScale: 1.2, roughnessMap: T.wood.data, roughness: 1, vertexColors: true, clearcoat: 0.5, clearcoatRoughness: 0.28 });
  // optional paint over the varnished planks (boat upgrades recolour the hull)
  const paint = { uPaint: { value: new THREE.Color(0xffffff) }, uPaintAmt: { value: 0 } };
  m.userData.paint = paint;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, paint);
    sh.uniforms.uTarY = { value: 0.1 }; sh.uniforms.uTar = { value: new THREE.Color(0x17120e) }; sh.uniforms.uBoot = { value: accent };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHullP; varying vec3 vHullN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHullP = position; vHullN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vHullP; varying vec3 vHullN; uniform float uTarY; uniform vec3 uTar; uniform vec3 uBoot; uniform vec3 uPaint; uniform float uPaintAmt; float hullTar; float hullBoot; float hullPaint;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float lum = dot(diffuseColor.rgb, vec3(0.333));
          float aa = max(fwidth(vHullP.y), 1e-4);
          float under = step(vHullN.y, -0.6);
          float below = 1.0 - smoothstep(uTarY - aa, uTarY + aa, vHullP.y);
          hullTar = max(below, under);
          hullBoot = (1.0 - below) * (1.0 - smoothstep(uTarY + 0.022 - aa, uTarY + 0.022 + aa, vHullP.y)) * (1.0 - under);
          diffuseColor.rgb = mix(diffuseColor.rgb, uTar * (0.55 + 0.9 * lum), hullTar);
          diffuseColor.rgb = mix(diffuseColor.rgb, uBoot, hullBoot);
          hullPaint = uPaintAmt * (1.0 - hullTar) * (1.0 - hullBoot);
          diffuseColor.rgb = mix(diffuseColor.rgb, uPaint * (0.62 + 0.75 * lum), hullPaint);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.5 + 0.2 * roughnessFactor, hullTar); roughnessFactor = mix(roughnessFactor, 0.3, hullBoot); roughnessFactor = mix(roughnessFactor, 0.32, hullPaint);`);
  };
  m.customProgramCacheKey = () => 'weidling-hull-v2';
  return m;
}

const HIP = 0.10; // seated hip-joint height above the seat surface (matches angler.js)

/**
 * Traditional Swiss Weidling with a 15 hp tiller outboard.
 * Origin: hull centre on the design waterline, bow +Z, up +Y.
 */
export function createBoat(opts = {}) {
  const { T, M } = shared();
  const accentHex = opts.accent ?? 0x2f6b8f;
  const seed = ((opts.seed ?? accentHex) >>> 0) % 100000 + 3;
  const accent = new THREE.Color(accentHex);
  const object = new THREE.Group(); object.name = 'weidling';

  const B = new Buckets();
  buildHullShell(B, seed, lin(accentHex));
  const { thwarts } = buildInterior(B, seed);
  const gear = buildGear(B, accentHex, seed);
  const motor = buildMotor(B, M);

  const hullMat = makeHullMaterial(T, accent);
  const accentMat = new THREE.MeshPhysicalMaterial({ name: 'stripe', color: 0xffffff, vertexColors: true, roughness: 0.36, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const plateMat = new THREE.MeshStandardMaterial({ name: 'plate', map: plateTexture(`BE ${1000 + (seed % 8999)}`), roughness: 0.4, metalness: 0.1 });
  for (const [k, mat] of [['hull', hullMat], ['wood', M.wood], ['metal', M.metal], ['accent', accentMat], ['plastic', M.plastic], ['fabric', M.fabric], ['plate', plateMat]]) {
    const mesh = B.mesh(k, mat); if (mesh) object.add(mesh);
  }
  object.add(motor.yaw);

  // anchor: stowed on deck vs. rope running to the bottom
  const anchorStowed = buildAnchorStowed(M); object.add(anchorStowed);
  const anchorRope = buildAnchorRope(M); anchorRope.visible = false; object.add(anchorRope);

  // Swiss flag on the stern staff (animated cloth)
  const FW = 0.3, FH = 0.3, fseg = 12;
  const flagGeo = new THREE.PlaneGeometry(FW, FH, fseg, fseg); flagGeo.translate(FW / 2, -FH / 2, 0);
  const flagBase = flagGeo.attributes.position.array.slice();
  const flag = new THREE.Mesh(flagGeo, M.flag); flag.castShadow = true; flag.name = 'flag';
  const staffTop = V3(0.40, sec(0.02).yS - 0.06 + 0.84, T_FWD + 0.055);
  flag.position.copy(staffTop); flag.rotation.y = Math.PI / 2; object.add(flag);

  // depth-only lid so transparent water (renderOrder >= 0) is not drawn inside the hull
  const waterMask = new THREE.Mesh(buildWaterMask(), M.mask); waterMask.name = 'waterMask';
  waterMask.renderOrder = -1; waterMask.castShadow = false; waterMask.receiveShadow = false; object.add(waterMask);

  // API anchors
  const seats = {
    driver: V3(0.30, thwarts[0].y + HIP, thwarts[0].z),
    fisher: V3(0.0, thwarts[1].y + HIP, thwarts[1].z),
  };
  const crate = new THREE.Object3D(); crate.name = 'crate'; crate.position.copy(gear.crate); object.add(crate);
  const netRest = new THREE.Object3D(); netRest.name = 'netRest';
  netRest.position.set(0.33, floorY(-0.15) + 0.022, -0.15);
  netRest.quaternion.setFromEuler(new THREE.Euler(-0.268, -0.077, 0.0, 'YXZ'));
  object.add(netRest);

  object.traverse(o => { if (o.isMesh && o !== waterMask) { o.castShadow = true; o.receiveShadow = true; } });

  let throttle = 0, steer = 0, propSpeed = 0, propAngle = 0, deployed = false;
  const pos = flagGeo.attributes.position;
  return {
    object, length: LEN, beam: hTop(0.4) * 2 + 0.04,
    seats, tillerGrip: motor.tillerGrip, crate, netRest, waterMask,
    setThrottle(t) { throttle = clamp(t || 0, -1, 1); },
    setSteer(s) { steer = clamp(s || 0, -1, 1); motor.yaw.rotation.y = steer * (Math.PI / 6); },
    setAnchor(d) { deployed = !!d; anchorStowed.visible = !deployed; anchorRope.visible = deployed; },
    // paint the hull (hex colour) or null for bare varnished wood
    setPaint(hex) {
      const p = hullMat.userData.paint;
      if (hex == null) { p.uPaintAmt.value = 0; return; }
      p.uPaint.value.set(hex); p.uPaintAmt.value = 1;
    },
    update(dt = 0.016, time = performance.now() / 1000) {
      // prop spin-up with inertia; ~18 rev/s visual top speed
      const target = throttle * 18 * Math.PI * 2;
      propSpeed += (target - propSpeed) * Math.min(1, dt * 3);
      propAngle += propSpeed * dt; motor.prop.rotation.z = propAngle;
      const a = Math.abs(throttle);
      const vib = (0.25 + a) * 0.0012;
      motor.body.position.set(Math.sin(time * 97) * vib * 0.5, Math.sin(time * 131) * vib, 0);
      motor.body.rotation.set(Math.sin(time * 83) * vib * 0.8, 0, Math.sin(time * 71) * vib * 1.5);
      // flag: travelling waves, stronger with speed
      const wind = 0.55 + 0.45 * a;
      for (let i = 0; i < pos.count; i++) {
        const x0 = flagBase[i * 3], y0 = flagBase[i * 3 + 1]; const u = x0 / FW;
        const w = Math.sin(u * 7.5 - time * (6 + 6 * wind) + y0 * 3) * 0.6 + Math.sin(u * 13 - time * 11 + y0 * 9) * 0.25;
        pos.setXYZ(i, x0 * (1 - 0.04 * wind) - u * u * 0.01, y0 - u * u * 0.03 * (1.2 - wind), w * u * 0.045 * (0.6 + wind));
      }
      pos.needsUpdate = true; flagGeo.computeVertexNormals();
    },
  };
}

/** Landing net: origin at the handle butt, handle along +Z, hoop at the far end (~2.0 m). */
export function createLandingNet() {
  const { T, M } = shared();
  const B = new Buckets();
  const ALUM = lin(0x9aa3ab), BLACK = lin(0x151515);
  const tubeZ = (r, z0, z1, seg = 12) => { const g = new THREE.CylinderGeometry(r, r, z1 - z0, seg, 1, true); g.rotateX(Math.PI / 2); g.translate(0, 0, (z0 + z1) / 2); return g; };
  B.add('metal', tubeZ(0.016, 0.38, 1.12), null, ALUM);
  B.add('metal', tubeZ(0.0128, 1.08, 1.5), null, lin(0xb4bbc2));
  B.add('plastic', tubeZ(0.021, 0.02, 0.38, 14), null, BLACK);
  B.add('plastic', new THREE.SphereGeometry(0.022, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M4(0, 0, 0.02, -Math.PI / 2, 0, 0, 1, 1, 0.6), BLACK);
  B.add('plastic', tubeZ(0.02, 1.1, 1.16, 14), null, BLACK);
  B.add('plastic', new THREE.CylinderGeometry(0.006, 0.006, 0.03, 8), M4(0.022, 0, 1.13, 0, 0, Math.PI / 2), lin(0xe07a1f));
  B.add('plastic', new RoundedBoxGeometry(0.05, 0.03, 0.09, 2, 0.01), M4(0, 0, 1.5), BLACK);
  // oval hoop
  const C = V3(0, 0, 1.75), A = 0.24, Bz = 0.27;
  const hp = []; for (let i = 0; i < 40; i++) { const t = i / 40 * Math.PI * 2; hp.push(V3(Math.sin(t) * A, 0, C.z - Math.cos(t) * Bz)); }
  B.add('metal', tube(hp, 0.0075, 80, 8, true, 0), null, lin(0x3d4a44));
  const out = new THREE.Group(); out.name = 'landing-net';
  for (const [k, mat] of [['metal', M.metal], ['plastic', M.plastic]]) out.add(B.mesh(k, mat));
  // rubberised mesh bag
  const NA = 40, ND = 9, depth = 0.36;
  const g = loftGrid(NA + 1, ND + 1, (i, j) => {
    const t = i / NA * Math.PI * 2, d = j / ND;
    const s = Math.pow(Math.cos(d * Math.PI / 2), 0.8) * 0.97 + 0.03 * (1 - d);
    const x = Math.sin(t) * A * s, z = C.z - Math.cos(t) * Bz * s - d * d * 0.05;
    const y = -depth * Math.pow(Math.sin(d * Math.PI / 2), 1.1) - 0.006;
    return [x, y, z, (i / NA) * 16, d * 7];
  });
  const netMat = new THREE.MeshStandardMaterial({ name: 'net', map: T.net, color: 0x2f3d37, roughness: 0.75, alphaTest: 0.45, side: THREE.DoubleSide });
  const bag = new THREE.Mesh(g, netMat); bag.castShadow = true; bag.name = 'net-bag'; out.add(bag);
  const hoopCenter = new THREE.Object3D(); hoopCenter.position.copy(C); out.add(hoopCenter);
  out.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { object: out, hoopCenter };
}
