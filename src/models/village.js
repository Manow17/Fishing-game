// Alpenfisch — village set dressing: Swiss alpine chalets, hay barns, church, dock,
// Simmental cows, Schrägzaun fences, flag poles, hay bales, benches.
// Fully procedural: geometry is merged per material (one draw call per material per
// model) and all canvas textures / materials are cached at module level and shared.
import * as THREE from 'three';

const PI = Math.PI;

/* =============================== random / noise =============================== */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  const r = mulberry32(Math.imul((Math.round(seed * 7919) | 0) ^ 0x5bd1e995, 0x9E3779B1) ^ 0x85ebca6b);
  for (let i = 0; i < 4; i++) r();
  const f = () => r();
  f.range = (a, b) => a + (b - a) * r();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  f.pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
  f.chance = (p) => r() < p;
  return f;
}
function hash3(x, y, z, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1440670441) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise3(x, y, z, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, s);
  const L = (a, b, t) => a + (b - a) * t;
  return L(
    L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
    L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm3(x, y, z, s = 0) {
  return 0.58 * vnoise3(x, y, z, s) + 0.3 * vnoise3(x * 2.03, y * 2.03, z * 2.03, s + 7) + 0.12 * vnoise3(x * 4.1, y * 4.1, z * 4.1, s + 13);
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/* =================================== colours ================================== */
// Vertex colours live in linear space; THREE.Color#set converts sRGB hex -> linear.
const _col = new THREE.Color();
function lin(hex) { _col.set(hex); return [_col.r, _col.g, _col.b]; }
function scaleC(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
function jit(c, R, amt) { const k = 1 + (R() - 0.5) * 2 * amt; return [c[0] * k, c[1] * k, c[2] * k]; }
function mixC(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
const WHITE = [1, 1, 1];

/* ================================ geometry builder ============================ */
// Collects primitives per material key, bakes transforms, computes world-scale
// box-projected UVs (in each primitive's local frame) and per-vertex tint colours,
// then emits ONE merged, non-indexed mesh per material.

const TILE = { plaster: 3, stone: 2.2, wood: 2, woodLight: 2, shingle: 2, slate: 2, tile: 2, hay: 1.4 };
const _P = new THREE.Vector3(), _N = new THREE.Vector3(), _NM = new THREE.Matrix3();
const _pos = new THREE.Vector3(), _q = new THREE.Quaternion(), _scl = new THREE.Vector3(), _eul = new THREE.Euler();

// Transform: translate * (Ry * Rx * Rz) * scale
function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_pos.set(x, y, z), _q.setFromEuler(_eul.set(rx, ry, rz, 'YXZ')), _scl.set(sx, sy, sz));
}
// Basis whose +axis points from a to b (axis 'z' for boxes, 'y' for cylinders).
function between(a, b, axis = 'z') {
  const A = new THREE.Vector3(a[0], a[1], a[2]), B = new THREE.Vector3(b[0], b[1], b[2]);
  const d = B.clone().sub(A); const len = d.length(); d.normalize();
  let side = new THREE.Vector3(0, 1, 0).cross(d);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0); else side.normalize();
  const up = d.clone().cross(side).normalize();
  const m = new THREE.Matrix4();
  if (axis === 'z') m.makeBasis(side, up, d); else m.makeBasis(side, d, up.negate());
  m.setPosition(A.add(B).multiplyScalar(0.5));
  return { m, len };
}

class Builder {
  constructor() { this.b = new Map(); this.stack = [new THREE.Matrix4()]; }
  get top() { return this.stack[this.stack.length - 1]; }
  push(m) { this.stack.push(this.top.clone().multiply(m)); return this; }
  pop() { this.stack.pop(); return this; }
  bucket(key) {
    let b = this.b.get(key);
    if (!b) this.b.set(key, (b = { p: [], n: [], u: [], c: [] }));
    return b;
  }
  // o: { color:[r,g,b]|hex, colorFn(p)->rgb, rect:[u0,v0,u1,v1], flipU, uv:'keep', tile, uo, vo, swap }
  add(key, geo, m, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    const full = m ? this.top.clone().multiply(m) : this.top;
    _NM.getNormalMatrix(full);
    const b = this.bucket(key);
    const tile = o.tile || TILE[key] || 1;
    const mode = o.rect ? 'rect' : (o.uv || 'box');
    const col = o.color ? (Array.isArray(o.color) ? o.color : lin(o.color)) : WHITE;
    const uo = o.uo || 0, vo = o.vo || 0;
    for (let i = 0; i < P.count; i++) {
      _P.fromBufferAttribute(P, i); _N.fromBufferAttribute(N, i);
      let u, v;
      if (mode === 'box') {
        const ax = Math.abs(_N.x), ay = Math.abs(_N.y), az = Math.abs(_N.z);
        if (ax >= ay && ax >= az) { u = _P.z; v = _P.y; }
        else if (ay >= az) { u = _P.x; v = _P.z; }
        else { u = _P.x; v = _P.y; }
        if (o.swap) { const t = u; u = v; v = t; }
        u = u / tile + uo; v = v / tile + vo;
      } else if (mode === 'rect') {
        const r = o.rect, uu = U ? U.getX(i) : 0, vv = U ? U.getY(i) : 0;
        u = r[0] + (r[2] - r[0]) * (o.flipU ? 1 - uu : uu);
        v = r[1] + (r[3] - r[1]) * vv;
      } else { u = (U ? U.getX(i) : 0) * (o.us || 1) + uo; v = (U ? U.getY(i) : 0) * (o.vs || 1) + vo; }
      _P.applyMatrix4(full); _N.applyMatrix3(_NM).normalize();
      b.p.push(_P.x, _P.y, _P.z); b.n.push(_N.x, _N.y, _N.z); b.u.push(u, v);
      const c = o.colorFn ? o.colorFn(_P) : col;
      b.c.push(c[0], c[1], c[2]);
    }
    return this;
  }
  box(key, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, o) { return this.add(key, new THREE.BoxGeometry(w, h, d), M(x, y, z, rx, ry, rz), o); }
  cyl(key, rt, rb, h, seg, x, y, z, rx = 0, ry = 0, rz = 0, o) { return this.add(key, new THREE.CylinderGeometry(rt, rb, h, seg, 1), M(x, y, z, rx, ry, rz), o); }
  quad(key, w, h, rect, x, y, z, rx = 0, ry = 0, rz = 0, o = {}) { return this.add(key, new THREE.PlaneGeometry(w, h), M(x, y, z, rx, ry, rz), { ...o, rect }); }
  beam(key, a, b, w, h, o) { const { m, len } = between(a, b, 'z'); return this.add(key, new THREE.BoxGeometry(w, h, len), m, o); }
  rod(key, a, b, r0, r1, seg, o) { const { m, len } = between(a, b, 'y'); return this.add(key, new THREE.CylinderGeometry(r1, r0, len, seg, 1), m, o); }
  // smooth low-poly blob (icosahedron with radial normals)
  blob(key, r, x, y, z, sx = 1, sy = 1, sz = 1, o, rx = 0, ry = 0, rz = 0, detail = 0) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { _P.fromBufferAttribute(p, i).normalize(); n.setXYZ(i, _P.x, _P.y, _P.z); }
    return this.add(key, g, M(x, y, z, rx, ry, rz, sx, sy, sz), o);
  }
  // ellipsoid from a UV sphere (smooth), optional vertex shaper f(v) on the unit sphere
  ellip(key, rx, ry, rz, x, y, z, ax = 0, ay = 0, az = 0, o, ws = 12, hs = 8, shaper) {
    const g = new THREE.SphereGeometry(1, ws, hs);
    if (shaper) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { _P.fromBufferAttribute(p, i); shaper(_P); p.setXYZ(i, _P.x, _P.y, _P.z); }
      g.computeVertexNormals();
    }
    return this.add(key, g, M(x, y, z, ax, ay, az, rx, ry, rz), o);
  }
  tris() { let t = 0; for (const b of this.b.values()) t += b.p.length / 9; return t; }
  build(group = new THREE.Group()) {
    for (const [key, b] of this.b) {
      if (!b.p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
      g.computeBoundingBox(); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, getMat(key));
      mesh.name = key; mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

/* ================================ canvas textures ============================= */

const _tex = new Map();
function canvasTexture(key, w, h, draw, clamp = false) {
  let t = _tex.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.name = 'village_' + key;
  _tex.set(key, t);
  return t;
}
const cl255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const rgba = (c, k = 1, a = 1) => `rgba(${cl255(c[0] * k)},${cl255(c[1] * k)},${cl255(c[2] * k)},${a})`;
// call fn at every periodic copy of an item of radius r that touches the S x S canvas
function tiled(S, x, y, r, fn) {
  for (let dx = -S; dx <= S; dx += S) for (let dy = -S; dy <= S; dy += S) {
    const X = x + dx, Y = y + dy;
    if (X + r < 0 || X - r > S || Y + r < 0 || Y - r > S) continue;
    fn(X, Y);
  }
}
function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
function speckle(g, S, R, n, dark, light, a0, a1) {
  for (let i = 0; i < n; i++) {
    const c = R() < 0.5 ? dark : light;
    g.fillStyle = `rgba(${c},${a0 + R() * (a1 - a0)})`;
    g.fillRect(R() * S, R() * S, 1 + R() * 1.6, 1 + R() * 1.6);
  }
}

// Horizontal log / plank wood. Canvas top = +v. One tile = 2 m.
function drawWood(g, S, R, base, rows, round) {
  const rh = S / rows;
  g.fillStyle = rgba(base, 0.4); g.fillRect(0, 0, S, S);
  for (let i = 0; i < rows; i++) {
    const y0 = i * rh;
    let x = R() * S; const end = x + S;
    while (x < end - 1) {
      let len = S * (0.3 + R() * 0.75);
      if (x + len > end - S * 0.12) len = end - x;
      const k = 0.8 + R() * 0.36, warm = (R() - 0.5) * 0.14;
      const c = [base[0] * k * (1 + warm), base[1] * k, base[2] * k * (1 - warm)];
      const gr = g.createLinearGradient(0, y0, 0, y0 + rh);
      if (round) {
        gr.addColorStop(0, rgba(c, 1.12)); gr.addColorStop(0.3, rgba(c, 1.03));
        gr.addColorStop(0.82, rgba(c, 0.88)); gr.addColorStop(1, rgba(c, 0.56));
      } else {
        gr.addColorStop(0, rgba(c, 1.06)); gr.addColorStop(0.85, rgba(c, 0.95)); gr.addColorStop(1, rgba(c, 0.62));
      }
      for (const dx of [0, -S]) {
        const X = x + dx;
        g.fillStyle = gr; g.fillRect(X, y0, len, rh);
        g.fillStyle = 'rgba(18,9,4,0.6)'; g.fillRect(X, y0, 1.6, rh);
        // knots
        if (R() < 0.45) {
          const kx = X + 10 + R() * (len - 20), ky = y0 + rh * (0.3 + R() * 0.4), kr = 2 + R() * 4;
          g.fillStyle = 'rgba(35,18,8,0.55)'; g.beginPath(); g.ellipse(kx, ky, kr * 1.6, kr, 0, 0, 2 * PI); g.fill();
          g.strokeStyle = 'rgba(35,18,8,0.25)'; g.lineWidth = 1; g.beginPath(); g.ellipse(kx, ky, kr * 3, kr * 1.7, 0, 0, 2 * PI); g.stroke();
        }
      }
      x += len;
    }
    // grain (periodic in x so the tile wraps)
    for (let j = 0; j < 16; j++) {
      const yy = y0 + 2 + R() * (rh - 5), amp = R() * 2.2, f = 1 + Math.floor(R() * 4), ph = R() * 6.28;
      g.strokeStyle = R() < 0.6 ? `rgba(28,14,6,${0.06 + R() * 0.14})` : `rgba(255,225,190,${0.04 + R() * 0.08})`;
      g.lineWidth = 0.6 + R() * 1.3;
      g.beginPath();
      for (let X = 0; X <= S; X += 8) { const Y = yy + amp * Math.sin((X / S) * 2 * PI * f + ph); if (X) g.lineTo(X, Y); else g.moveTo(X, Y); }
      g.stroke();
    }
    g.fillStyle = 'rgba(12,6,3,0.6)'; g.fillRect(0, y0 + rh - 2, S, 2);
    g.fillStyle = 'rgba(255,230,200,0.13)'; g.fillRect(0, y0, S, 1.5);
  }
  speckle(g, S, R, 2500, '20,10,5', '255,230,200', 0.04, 0.1);
}
function texWood() { return canvasTexture('wood', 512, 512, (g, S) => drawWood(g, S, makeRng(5), [112, 64, 37], 10, true)); }
function texWoodLight() { return canvasTexture('woodLight', 512, 512, (g, S) => drawWood(g, S, makeRng(6), [150, 136, 118], 11, false)); }

function texPlaster() {
  return canvasTexture('plaster', 512, 512, (g, S) => {
    const R = makeRng(11);
    g.fillStyle = '#ece8de'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 46; i++) {
      const x = R() * S, y = R() * S, r = 30 + R() * 90, a = 0.025 + R() * 0.04, dark = R() < 0.6;
      tiled(S, x, y, r, (X, Y) => {
        const gr = g.createRadialGradient(X, Y, 0, X, Y, r);
        gr.addColorStop(0, dark ? `rgba(130,118,95,${a})` : `rgba(255,255,250,${a})`);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(X - r, Y - r, 2 * r, 2 * r);
      });
    }
    // rubble stones faintly showing through the whitewash
    for (let i = 0; i < 110; i++) {
      const x = R() * S, y = R() * S, rx = 12 + R() * 28, ry = 8 + R() * 14, rot = (R() - 0.5) * 0.6;
      tiled(S, x, y, rx + 4, (X, Y) => {
        g.save(); g.translate(X, Y); g.rotate(rot);
        g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 2 * PI);
        g.fillStyle = 'rgba(255,255,255,0.06)'; g.fill();
        g.strokeStyle = 'rgba(115,104,84,0.075)'; g.lineWidth = 2.5; g.stroke();
        g.beginPath(); g.ellipse(1.5, 2, rx, ry, 0, 0.2, PI - 0.2);
        g.strokeStyle = 'rgba(100,90,70,0.07)'; g.lineWidth = 2; g.stroke();
        g.restore();
      });
    }
    speckle(g, S, R, 7000, '95,88,72', '255,255,255', 0.04, 0.12);
  });
}

function texStone() {
  return canvasTexture('stone', 512, 512, (g, S) => {
    const R = makeRng(21);
    g.fillStyle = '#4c4843'; g.fillRect(0, 0, S, S);
    const rows = 9, rh = S / rows;
    for (let i = 0; i < rows; i++) {
      let x = R() * S; const end = x + S;
      while (x < end - 4) {
        let w = 38 + R() * 80; if (end - x < 50) w = end - x;
        const h = rh * (0.84 + R() * 0.12), base = 98 + R() * 58, warm = (R() - 0.5) * 22;
        const c = [base + warm, base + warm * 0.4, base - warm * 0.4 - 5];
        const Y = i * rh + 2 + R() * 3, rr = 5 + R() * 8;
        for (const dx of [0, -S]) {
          const X = x + dx + 2;
          rrect(g, X, Y, w - 4, h - 4, rr);
          const gr = g.createLinearGradient(0, Y, 0, Y + h);
          gr.addColorStop(0, rgba(c, 1.14)); gr.addColorStop(0.6, rgba(c, 0.97)); gr.addColorStop(1, rgba(c, 0.74));
          g.fillStyle = gr; g.fill();
        }
        x += w;
      }
    }
    for (let i = 0; i < 70; i++) { // lichen
      const x = R() * S, y = R() * S, r = 2 + R() * 6;
      g.fillStyle = R() < 0.5 ? 'rgba(170,165,80,0.22)' : 'rgba(210,205,190,0.25)';
      g.beginPath(); g.arc(x, y, r, 0, 2 * PI); g.fill();
    }
    speckle(g, S, R, 6000, '40,38,35', '235,232,225', 0.06, 0.16);
  });
}

// Roof textures: canvas top = up-slope (towards the ridge).
function texShingle() {
  return canvasTexture('shingle', 512, 512, (g, S) => {
    const R = makeRng(31);
    const rows = 8, rh = S / rows;
    g.fillStyle = '#2e2924'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < rows; i++) {
      const y0 = i * rh;
      let x = R() * S; const end = x + S;
      while (x < end - 2) {
        let w = 20 + R() * 38; if (end - x < 24) w = end - x;
        const k = 0.72 + R() * 0.42, warm = R() * 0.2;
        const c = [114 * k * (1 + warm * 0.6), 106 * k, 98 * k * (1 - warm * 0.3)];
        const gr = g.createLinearGradient(0, y0, 0, y0 + rh);
        gr.addColorStop(0, rgba(c, 0.6)); gr.addColorStop(0.35, rgba(c, 0.97)); gr.addColorStop(1, rgba(c, 1.1));
        const grain = [];
        for (let j = 0; j < 5; j++) grain.push([R() * (w - 4), 0.08 + R() * 0.12]);
        for (const dx of [0, -S]) {
          const X = x + dx;
          g.fillStyle = gr; g.fillRect(X + 1, y0, w - 2, rh - 1);
          for (const [gx, ga] of grain) { g.fillStyle = `rgba(30,25,20,${ga})`; g.fillRect(X + 2 + gx, y0 + 2, 1, rh - 4); }
          g.fillStyle = 'rgba(255,245,230,0.2)'; g.fillRect(X + 1, y0 + rh - 3, w - 2, 2);
        }
        x += w;
      }
      const sh = g.createLinearGradient(0, y0, 0, y0 + rh * 0.38);
      sh.addColorStop(0, 'rgba(10,8,6,0.7)'); sh.addColorStop(1, 'rgba(10,8,6,0)');
      g.fillStyle = sh; g.fillRect(0, y0, S, rh * 0.38);
    }
    for (let i = 0; i < 60; i++) { // moss & lichen
      const x = R() * S, y = R() * S, r = 2 + R() * 7;
      g.fillStyle = R() < 0.6 ? 'rgba(95,115,45,0.28)' : 'rgba(190,185,120,0.25)';
      g.beginPath(); g.arc(x, y, r, 0, 2 * PI); g.fill();
    }
    speckle(g, S, R, 3000, '20,18,15', '230,225,215', 0.05, 0.12);
  });
}
function texSlate() {
  return canvasTexture('slate', 512, 512, (g, S) => {
    const R = makeRng(41);
    const rows = 8, rh = S / rows, tw = S / 6;
    g.fillStyle = '#26282b'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < rows; i++) {
      const y0 = i * rh, off = (i % 2) * tw * 0.5;
      for (let j = -1; j < 7; j++) {
        const X = j * tw + off, k = 0.78 + R() * 0.4;
        const c = [96 * k, 100 * k, 106 * k * (1 + (R() - 0.5) * 0.1)];
        const gr = g.createLinearGradient(0, y0, 0, y0 + rh);
        gr.addColorStop(0, rgba(c, 0.62)); gr.addColorStop(0.35, rgba(c, 1)); gr.addColorStop(1, rgba(c, 1.12));
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(X + 2, y0); g.lineTo(X + tw - 2, y0);
        g.lineTo(X + tw - 2 - R() * 3, y0 + rh - 2 - R() * 3); g.lineTo(X + 2 + R() * 3, y0 + rh - 1 - R() * 2);
        g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(X + 3, y0 + rh - 3, tw - 6, 1.5);
      }
      const sh = g.createLinearGradient(0, y0, 0, y0 + rh * 0.3);
      sh.addColorStop(0, 'rgba(5,5,6,0.7)'); sh.addColorStop(1, 'rgba(5,5,6,0)');
      g.fillStyle = sh; g.fillRect(0, y0, S, rh * 0.3);
    }
    for (let i = 0; i < 50; i++) {
      const x = R() * S, y = R() * S, r = 2 + R() * 5;
      g.fillStyle = 'rgba(200,190,120,0.2)'; g.beginPath(); g.arc(x, y, r, 0, 2 * PI); g.fill();
    }
    speckle(g, S, R, 3000, '10,10,12', '220,225,230', 0.05, 0.1);
  });
}
// Biberschwanz (beaver-tail) clay tiles, red-brown.
function texTile() {
  return canvasTexture('tile', 512, 512, (g, S) => {
    const R = makeRng(51);
    const rows = 14, rh = S / rows, cols = 11, tw = S / cols;
    g.fillStyle = '#3a1c13'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < rows; i++) {
      const y0 = i * rh, off = (i % 2) * tw * 0.5;
      for (let j = -1; j <= cols; j++) {
        const X = j * tw + off, k = 0.8 + R() * 0.32, c = [166 * k, 78 * k * (0.9 + R() * 0.2), 52 * k];
        const gr = g.createLinearGradient(0, y0, 0, y0 + rh * 1.6);
        gr.addColorStop(0, rgba(c, 0.62)); gr.addColorStop(0.4, rgba(c, 1)); gr.addColorStop(1, rgba(c, 1.12));
        g.fillStyle = gr;
        const w = tw - 2, bot = y0 + rh * 1.55;
        g.beginPath();
        g.moveTo(X + 1, y0); g.lineTo(X + 1 + w, y0); g.lineTo(X + 1 + w, bot - w * 0.45);
        g.quadraticCurveTo(X + 1 + w, bot, X + 1 + w / 2, bot);
        g.quadraticCurveTo(X + 1, bot, X + 1, bot - w * 0.45);
        g.closePath(); g.fill();
      }
      const sh = g.createLinearGradient(0, y0, 0, y0 + rh * 0.4);
      sh.addColorStop(0, 'rgba(25,8,4,0.55)'); sh.addColorStop(1, 'rgba(25,8,4,0)');
      g.fillStyle = sh; g.fillRect(0, y0, S, rh * 0.4);
    }
    for (let i = 0; i < 40; i++) {
      const x = R() * S, y = R() * S, r = 2 + R() * 5;
      g.fillStyle = 'rgba(60,70,40,0.2)'; g.beginPath(); g.arc(x, y, r, 0, 2 * PI); g.fill();
    }
    speckle(g, S, R, 3000, '40,15,8', '240,200,170', 0.05, 0.12);
  });
}
function texHay() {
  return canvasTexture('hay', 512, 512, (g, S) => {
    const R = makeRng(61);
    g.fillStyle = '#b89a52'; g.fillRect(0, 0, S, S);
    const pal = [[214, 186, 110], [178, 148, 78], [228, 208, 146], [150, 126, 66], [170, 162, 92], [120, 100, 55]];
    for (let i = 0; i < 5200; i++) {
      const x = R() * S, y = R() * S, len = 8 + R() * 30, a = (R() - 0.5) * 1.3, c = pal[Math.floor(R() * pal.length)];
      const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
      g.strokeStyle = rgba(c, 1, 0.55 + R() * 0.4); g.lineWidth = 0.8 + R() * 1.6;
      tiled(S, x, y, len, (X, Y) => { g.beginPath(); g.moveTo(X, Y); g.lineTo(X + dx, Y + dy); g.stroke(); });
    }
  });
}

/* ================================= decal atlas ================================ */
// One 1024² RGBA canvas with every decal (windows, shutters, doors, carved railing,
// geraniums, friezes, clock faces ...). Rendered with alphaTest + polygonOffset.
const AS = 1024;
const ATLAS_PX = {
  win6: [0, 0, 176, 256], win4: [176, 0, 352, 208], winS: [352, 0, 464, 112],
  door: [464, 0, 624, 320], bdoor: [624, 0, 768, 256], clock: [768, 0, 1024, 256],
  shut0: [0, 256, 88, 512], shut1: [88, 256, 176, 512], shut2: [176, 256, 264, 512], shut3: [264, 256, 352, 512],
  arch: [352, 256, 464, 512], logs: [464, 320, 624, 512], louver: [624, 256, 768, 512], cdoor: [768, 256, 1024, 672],
  rail: [0, 512, 512, 704], geran: [512, 512, 768, 704], frieze: [0, 704, 768, 768], carve: [0, 768, 768, 816],
  inscr: [0, 816, 768, 864], bale: [768, 672, 1024, 928], oculus: [0, 864, 160, 1024], vent: [160, 864, 288, 1024],
  hayDoor: [288, 864, 448, 1024],
};
const AR = {};
for (const k in ATLAS_PX) {
  const [x0, y0, x1, y1] = ATLAS_PX[k];
  AR[k] = [(x0 + 1) / AS, 1 - (y1 - 1) / AS, (x1 - 1) / AS, 1 - (y0 + 1) / AS];
}
// left fraction fu of a region (keeps texel scale when a quad is narrower) / top fraction fv
function subRect(r, fu = 1, fv = 1) { return [r[0], r[1] + (r[3] - r[1]) * (1 - fv), r[0] + (r[2] - r[0]) * fu, r[3]]; }

function heartPath(g, cx, cy, s) {
  g.beginPath();
  g.moveTo(cx, cy + s * 0.9);
  g.bezierCurveTo(cx - s * 1.25, cy + s * 0.05, cx - s * 0.7, cy - s * 0.95, cx, cy - s * 0.32);
  g.bezierCurveTo(cx + s * 0.7, cy - s * 0.95, cx + s * 1.25, cy + s * 0.05, cx, cy + s * 0.9);
  g.closePath();
}
function archPath(g, x, y, w, h) {
  const r = w / 2;
  g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + r); g.arc(x + r, y + r, r, PI, 0); g.lineTo(x + w, y + h); g.closePath();
}
function circle(g, x, y, r, fill) { g.beginPath(); g.arc(x, y, r, 0, 2 * PI); g.fillStyle = fill; g.fill(); }

function drawWindow(g, [x, y, x1, y1], cols, rows) {
  const w = x1 - x, h = y1 - y, frame = '#f4f0e7';
  g.fillStyle = frame; g.fillRect(x, y, w, h);
  const f = Math.max(7, Math.round(w * 0.09));
  const gx = x + f, gy = y + f, gw = w - 2 * f, gh = h - 2 * f;
  const gr = g.createLinearGradient(gx, gy, gx + gw * 0.7, gy + gh);
  gr.addColorStop(0, '#7891a6'); gr.addColorStop(0.42, '#344858'); gr.addColorStop(1, '#17212b');
  g.fillStyle = gr; g.fillRect(gx, gy, gw, gh);
  g.save(); g.beginPath(); g.rect(gx, gy, gw, gh); g.clip();
  const wg = g.createRadialGradient(gx + gw / 2, gy + gh * 0.8, 2, gx + gw / 2, gy + gh * 0.8, gw * 0.7);
  wg.addColorStop(0, 'rgba(140,95,50,0.35)'); wg.addColorStop(1, 'rgba(140,95,50,0)');
  g.fillStyle = wg; g.fillRect(gx, gy, gw, gh);
  // lace drapes + scalloped valance
  g.fillStyle = 'rgba(250,247,240,0.93)';
  for (const s of [0, 1]) {
    const ex = s ? gx + gw : gx, d = s ? -1 : 1;
    g.beginPath(); g.moveTo(ex, gy); g.lineTo(ex + d * gw * 0.33, gy);
    g.quadraticCurveTo(ex + d * gw * 0.1, gy + gh * 0.55, ex + d * gw * 0.17, gy + gh);
    g.lineTo(ex, gy + gh); g.closePath(); g.fill();
  }
  const nsc = cols * 2;
  g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + gw, gy); g.lineTo(gx + gw, gy + gh * 0.1);
  for (let i = nsc - 1; i >= 0; i--) { const sx = gx + gw * i / nsc; g.quadraticCurveTo(sx + gw / nsc / 2, gy + gh * 0.2, sx, gy + gh * 0.1); }
  g.closePath(); g.fill();
  g.fillStyle = 'rgba(170,160,150,0.35)';
  for (let i = 0; i < 40; i++) { const s = i % 2, ex = s ? gx + gw - 4 : gx + 4; g.fillRect(ex + (s ? -1 : 1) * ((i * 7) % (gw * 0.22)), gy + ((i * 23) % gh), 2, 2); }
  g.fillStyle = 'rgba(255,255,255,0.13)';
  g.beginPath(); g.moveTo(gx + gw * 0.3, gy); g.lineTo(gx + gw * 0.55, gy); g.lineTo(gx + gw * 0.1, gy + gh); g.lineTo(gx - gw * 0.15, gy + gh); g.closePath(); g.fill();
  g.restore();
  const bar = Math.max(3, Math.round(w * 0.04));
  g.fillStyle = frame;
  for (let c = 1; c < cols; c++) { const k = c * 2 === cols ? 2 : 1; g.fillRect(gx + gw * c / cols - bar * k / 2, gy, bar * k, gh); }
  for (let r = 1; r < rows; r++) g.fillRect(gx, gy + gh * r / rows - bar / 2, gw, bar);
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(gx, gy, gw, 3); g.fillRect(gx, gy, 3, gh);
  g.strokeStyle = 'rgba(80,70,60,0.6)'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function drawShutter(g, [x, y, x1, y1], A, B, flame) {
  const w = x1 - x, h = y1 - y;
  g.fillStyle = A; g.fillRect(x, y, w, h);
  if (flame) {
    g.save(); g.beginPath(); g.rect(x + 8, y + 8, w - 16, h - 16); g.clip();
    g.fillStyle = B;
    const step = 36, dip = 18;
    for (let yy = y - step; yy < y + h + step; yy += step) {
      g.beginPath();
      g.moveTo(x, yy); g.lineTo(x + w / 2, yy + dip); g.lineTo(x + w, yy);
      g.lineTo(x + w, yy + step * 0.48); g.lineTo(x + w / 2, yy + dip + step * 0.48); g.lineTo(x, yy + step * 0.48);
      g.closePath(); g.fill();
    }
    g.restore();
  } else {
    for (let i = 1; i < 4; i++) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + w * i / 4 - 1, y, 2, h); }
    heartPath(g, x + w / 2, y + h * 0.18, 11); g.fillStyle = 'rgba(25,18,12,0.9)'; g.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,0.38)'; g.lineWidth = 7; g.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
  g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = 2; g.strokeRect(x + 8, y + 8, w - 16, h - 16);
  g.fillStyle = '#1d1a17';
  for (const fy of [0.13, 0.84]) {
    g.fillRect(x + w * 0.3, y + h * fy, w * 0.7, 6);
    g.beginPath(); g.arc(x + w * 0.3, y + h * fy + 3, 5, 0, 2 * PI); g.fill();
  }
}

function drawDoor(g, [x, y, x1, y1], R) {
  const w = x1 - x, h = y1 - y;
  g.fillStyle = '#3b2213'; g.fillRect(x, y, w, h);
  const f = 11, ix = x + f, iy = y + f, iw = w - 2 * f, ih = h - f;
  for (let i = 0; i < 6; i++) {
    const bx = ix + iw * i / 6;
    g.fillStyle = rgba([130, 76, 40], 0.85 + R() * 0.3); g.fillRect(bx, iy, iw / 6 + 1, ih);
    g.fillStyle = 'rgba(20,10,5,0.5)'; g.fillRect(bx, iy, 1.5, ih);
  }
  const wy = iy + 14, wh = ih * 0.2;
  g.fillStyle = '#efe9dc'; g.fillRect(ix + 16, wy, iw - 32, wh);
  g.fillStyle = '#25313b'; g.fillRect(ix + 22, wy + 6, iw - 44, wh - 12);
  g.fillStyle = '#efe9dc'; g.fillRect(ix + iw / 2 - 2, wy + 6, 4, wh - 12);
  for (const py of [0.5, 0.78]) {
    const cx = ix + iw / 2, cy = iy + ih * py, s = iw * 0.34;
    g.fillStyle = 'rgba(40,20,8,0.38)'; g.fillRect(ix + 12, cy - s * 0.7, iw - 24, s * 1.4);
    g.beginPath(); g.moveTo(cx, cy - s * 0.62); g.lineTo(cx + s * 0.62, cy); g.lineTo(cx, cy + s * 0.62); g.lineTo(cx - s * 0.62, cy); g.closePath();
    g.fillStyle = '#93582f'; g.fill(); g.strokeStyle = 'rgba(20,10,5,0.6)'; g.lineWidth = 2; g.stroke();
    for (let k = 0; k < 6; k++) circle(g, cx + Math.cos(k * PI / 3) * 6, cy + Math.sin(k * PI / 3) * 6, 4, '#c8392c');
    circle(g, cx, cy, 3.5, '#e8c252');
  }
  g.fillStyle = '#161514'; g.fillRect(ix + iw - 24, iy + ih * 0.6, 7, 24);
  circle(g, ix + iw - 20.5, iy + ih * 0.6, 6, '#161514');
}

function drawBarnDoor(g, [x, y, x1, y1], R) {
  const w = x1 - x, h = y1 - y;
  g.fillStyle = '#2a2018'; g.fillRect(x, y, w, h);
  for (let i = 0; i < 6; i++) {
    const bx = x + 6 + (w - 12) * i / 6;
    g.fillStyle = rgba([104, 88, 74], 0.8 + R() * 0.35); g.fillRect(bx, y + 6, (w - 12) / 6 - 1.5, h - 6);
  }
  g.fillStyle = 'rgba(70,56,44,1)';
  g.fillRect(x + 6, y + h * 0.18, w - 12, 14); g.fillRect(x + 6, y + h * 0.78, w - 12, 14);
  g.save(); g.translate(x + w / 2, y + h * 0.48); g.rotate(-Math.atan2(h * 0.6, w - 12)); g.fillRect(-h * 0.36, -7, h * 0.72, 14); g.restore();
  g.fillStyle = '#141210';
  for (const fy of [0.18, 0.78]) g.fillRect(x + 6, y + h * fy + 4, w * 0.45, 6);
  circle(g, x + w * 0.8, y + h * 0.52, 5, '#141210');
}

function drawClock(g, [x, y]) {
  const cx = x + 128, cy = y + 128;
  circle(g, cx, cy, 125, '#2a2a2a');
  circle(g, cx, cy, 119, '#d4ad4c');
  circle(g, cx, cy, 108, '#1d2433');
  g.fillStyle = '#e2bf5e';
  for (let i = 0; i < 60; i++) {
    const big = i % 5 === 0;
    g.save(); g.translate(cx, cy); g.rotate(i * PI / 30);
    if (big) g.fillRect(-5, -102, 10, 26); else g.fillRect(-1.5, -102, 3, 8);
    g.restore();
  }
  g.strokeStyle = '#e8c766'; g.lineCap = 'round';
  const hand = (a, len, wd) => { g.lineWidth = wd; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len); g.stroke(); };
  hand(-PI / 3 + 0.1, 58, 11); hand(PI / 3, 88, 7);
  circle(g, cx, cy, 10, '#e8c766');
  g.lineCap = 'butt';
}

function drawArchWindow(g, [x, y, x1, y1], R) {
  const w = x1 - x, h = y1 - y;
  archPath(g, x, y, w, h); g.fillStyle = '#d6cfbf'; g.fill();
  const i = 9; archPath(g, x + i, y + i, w - 2 * i, h - i - 4);
  const gr = g.createLinearGradient(x, y, x + w, y + h);
  gr.addColorStop(0, '#a8bab7'); gr.addColorStop(0.5, '#62777b'); gr.addColorStop(1, '#3a4a50');
  g.fillStyle = gr; g.fill();
  g.save(); g.clip();
  for (let k = 0; k < 18; k++) { g.fillStyle = R() < 0.5 ? 'rgba(220,180,90,0.25)' : 'rgba(150,190,200,0.2)'; g.fillRect(x + R() * w, y + R() * h, 14, 14); }
  g.strokeStyle = 'rgba(35,35,35,0.65)'; g.lineWidth = 1.5;
  for (let d = -h; d < w + h; d += 14) {
    g.beginPath(); g.moveTo(x + d, y); g.lineTo(x + d + h, y + h); g.stroke();
    g.beginPath(); g.moveTo(x + d, y); g.lineTo(x + d - h, y + h); g.stroke();
  }
  g.fillStyle = '#d6cfbf'; g.fillRect(x + w / 2 - 2.5, y, 5, h); g.fillRect(x, y + h * 0.55, w, 5);
  g.restore();
}

function drawLouver(g, [x, y, x1, y1]) {
  const w = x1 - x, h = y1 - y;
  archPath(g, x, y, w, h); g.fillStyle = '#d6cfbf'; g.fill();
  const i = 11; archPath(g, x + i, y + i, w - 2 * i, h - i - 2);
  g.fillStyle = '#16120f'; g.fill();
  g.save(); g.clip();
  for (let yy = y + i + 8; yy < y + h; yy += 17) {
    g.fillStyle = '#5c4433'; g.fillRect(x, yy, w, 10);
    g.fillStyle = 'rgba(255,230,200,0.22)'; g.fillRect(x, yy, w, 2);
  }
  g.fillStyle = '#4a3628'; g.fillRect(x + w / 2 - 3, y, 6, h);
  g.restore();
}

function drawChurchDoor(g, [x, y, x1, y1], R) {
  const w = x1 - x, h = y1 - y;
  archPath(g, x, y, w, h); g.fillStyle = '#cfc7b6'; g.fill();
  const i = 16; archPath(g, x + i, y + i, w - 2 * i, h - i);
  g.fillStyle = '#4a2a17'; g.fill();
  g.save(); g.clip();
  const n = 8;
  for (let k = 0; k < n; k++) {
    const bx = x + i + (w - 2 * i) * k / n;
    g.fillStyle = rgba([118, 66, 36], 0.85 + R() * 0.3); g.fillRect(bx + 1, y, (w - 2 * i) / n - 2, h);
  }
  g.fillStyle = '#2a170c'; g.fillRect(x + w / 2 - 3, y, 6, h);
  for (let yy = y + h * 0.3; yy < y + h - 10; yy += 34) for (let xx = x + i + 14; xx < x1 - i; xx += 28) circle(g, xx, yy, 3, '#191614');
  g.strokeStyle = '#1a1714'; g.lineWidth = 4;
  for (const s of [-1, 1]) { g.beginPath(); g.arc(x + w / 2 + s * 22, y + h * 0.6, 11, 0, 2 * PI); g.stroke(); }
  g.restore();
}

function drawLogs(g, [x, y, x1, y1], R) {
  const w = x1 - x, h = y1 - y;
  g.fillStyle = '#24170e'; g.fillRect(x, y, w, h);
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  let row = 0;
  for (let yy = y + 10; yy < y + h + 12; yy += 21, row++) {
    const off = row % 2 ? 11 : 0;
    for (let xx = x + 8 + off; xx < x + w + 12; xx += 23) {
      const r = 10 + R() * 4, cx = xx + (R() - 0.5) * 5, cy = yy + (R() - 0.5) * 4;
      circle(g, cx, cy, r, '#4a3020');
      const k = 0.85 + R() * 0.3;
      const gr = g.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, r - 2);
      gr.addColorStop(0, rgba([222, 182, 124], k)); gr.addColorStop(1, rgba([176, 124, 72], k));
      circle(g, cx, cy, r - 2.6, gr);
      g.strokeStyle = 'rgba(110,70,35,0.35)'; g.lineWidth = 1;
      for (let rr = 3; rr < r - 3; rr += 2.6) { g.beginPath(); g.arc(cx, cy, rr, 0, 2 * PI); g.stroke(); }
      if (R() < 0.5) { g.strokeStyle = 'rgba(60,35,15,0.6)'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + (R() - 0.5) * 2 * r, cy + (R() - 0.5) * 2 * r); g.stroke(); }
    }
  }
  g.restore();
}

// Bernese "Laubsägeli": sawn balcony boards whose mirrored edge cut-outs form ornaments.
function drawRail(g, [x, y, x1, y1], R) {
  const w = x1 - x, h = y1 - y, n = 14, bw = w / n;
  for (let i = 0; i < n; i++) {
    const bx = x + i * bw, c = [124, 74, 41];
    const gr = g.createLinearGradient(bx, 0, bx + bw, 0);
    const k = 0.85 + R() * 0.25;
    gr.addColorStop(0, rgba(c, k * 0.75)); gr.addColorStop(0.2, rgba(c, k)); gr.addColorStop(0.85, rgba(c, k * 0.95)); gr.addColorStop(1, rgba(c, k * 0.6));
    g.fillStyle = gr; g.fillRect(bx, y, bw, h);
  }
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  for (let i = 0; i <= n; i++) {
    const ex = x + i * bw;
    circle(g, ex, y + h * 0.2, 8.5, '#000');
    heartPath(g, ex, y + h * 0.5, 15); g.fill();
    g.beginPath(); g.moveTo(ex, y + h * 0.74); g.lineTo(ex + 9, y + h * 0.82); g.lineTo(ex, y + h * 0.9); g.lineTo(ex - 9, y + h * 0.82); g.closePath(); g.fill();
    g.fillRect(ex - 1.2, y, 2.4, h);
  }
  for (let i = 0; i < n; i++) {
    const cx = x + (i + 0.5) * bw;
    circle(g, cx, y + h * 0.34, 4, '#000');
    rrect(g, cx - 3, y + h * 0.6, 6, 16, 3); g.fill();
  }
  g.restore();
}

function drawGeranium(g, [x, y, x1, y1], R) {
  const w = x1 - x, h = y1 - y;
  const leafC = ['#2c6421', '#3c8229', '#24521a', '#4c9433', '#356f25'];
  const flowC = ['#e3202b', '#ff3a3a', '#c8121e', '#f2343f', '#d81b26'];
  const leaf = (lx, ly, r) => {
    circle(g, lx, ly, r, leafC[Math.floor(R() * leafC.length)]);
    g.strokeStyle = 'rgba(15,40,10,0.45)'; g.lineWidth = 1; g.beginPath(); g.arc(lx, ly, r * 0.55, 0, 2 * PI); g.stroke();
  };
  const cluster = (fx, fy, s) => {
    const m = 7 + Math.floor(R() * 6);
    for (let k = 0; k < m; k++) {
      const a = R() * 2 * PI, d = R() * s;
      circle(g, fx + Math.cos(a) * d, fy + Math.sin(a) * d * 0.8, 3.2 + R() * 2.2, flowC[Math.floor(R() * flowC.length)]);
    }
    circle(g, fx - s * 0.3, fy - s * 0.3, 2.2, 'rgba(255,150,150,0.9)');
  };
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  const strands = [];
  for (let i = 0; i < 9; i++) strands.push([x + 14 + R() * (w - 28), y + 20 + R() * 15, 40 + R() * (h - 75)]);
  for (const [sx, sy, len] of strands) {
    let px = sx;
    for (let t = 0; t < len; t += 9) { px += (R() - 0.5) * 6; leaf(px, sy + t, 6 + R() * 4); }
  }
  for (let i = 0; i < 70; i++) leaf(x + 10 + R() * (w - 20), y + 10 + Math.pow(R(), 1.8) * 46, 7 + R() * 6);
  for (const [sx, sy, len] of strands) {
    for (let t = 18; t < len; t += 30 + R() * 14) cluster(sx + (R() - 0.5) * 8, sy + t, 9);
    cluster(sx, sy + len + 2, 10);
  }
  for (let i = 0; i < 16; i++) cluster(x + 14 + R() * (w - 28), y + 10 + R() * 36, 11);
  g.restore();
}

function drawFrieze(g, [x, y, x1, y1]) {
  const w = x1 - x, h = y1 - y;
  g.fillStyle = '#3f2416'; g.fillRect(x, y, w, h);
  g.fillStyle = '#d2a548'; g.fillRect(x, y + 3, w, 5); g.fillRect(x, y + h - 8, w, 5);
  g.fillStyle = '#efe6d2';
  for (let xx = x; xx < x1; xx += 12) { g.fillRect(xx, y + 10, 6, 6); g.fillRect(xx + 6, y + h - 16, 6, 6); }
  for (let i = 0, xx = x + 24; xx < x1; xx += 48, i++) {
    const cy = y + h / 2;
    if (i % 2 === 0) {
      for (let k = 0; k < 6; k++) circle(g, xx + Math.cos(k * PI / 3) * 7, cy + Math.sin(k * PI / 3) * 7, 5, '#efe6d2');
      circle(g, xx, cy, 4.5, '#c0332a');
    } else {
      g.fillStyle = '#3d8a3a'; g.beginPath(); g.ellipse(xx - 7, cy + 3, 7, 3, -0.5, 0, 2 * PI); g.fill();
      g.beginPath(); g.ellipse(xx + 7, cy + 3, 7, 3, 0.5, 0, 2 * PI); g.fill();
      g.fillStyle = '#c0332a'; g.beginPath(); g.moveTo(xx - 6, cy - 7); g.lineTo(xx - 3, cy - 2); g.lineTo(xx, cy - 8); g.lineTo(xx + 3, cy - 2); g.lineTo(xx + 6, cy - 7); g.lineTo(xx + 5, cy + 4); g.lineTo(xx - 5, cy + 4); g.closePath(); g.fill();
    }
    if (xx + 24 < x1) circle(g, xx + 24, cy, 3, '#4a6fae');
  }
}

function drawCarve(g, [x, y, x1, y1]) {
  const w = x1 - x;
  g.fillStyle = '#6a3e22'; g.fillRect(x, y, w, 22);
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + 20, w, 2);
  for (let xx = x + 16; xx < x1; xx += 32) {
    g.beginPath(); g.arc(xx, y + 21, 14, 0, PI); g.closePath(); g.fillStyle = '#6a3e22'; g.fill();
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(xx, y + 21, 14, 0.2, PI - 0.2); g.lineTo(xx, y + 21); g.fill();
  }
  g.save(); g.globalCompositeOperation = 'destination-out';
  for (let xx = x + 16; xx < x1; xx += 32) { circle(g, xx, y + 26, 3.5, '#000'); g.fillRect(xx + 15, y + 8, 2, 6); }
  g.restore();
}

function drawInscription(g, [x, y, x1, y1]) {
  const w = x1 - x, h = y1 - y;
  const gr = g.createLinearGradient(0, y, 0, y1);
  gr.addColorStop(0, '#3a2012'); gr.addColorStop(0.15, '#5e3622'); gr.addColorStop(0.85, '#55301d'); gr.addColorStop(1, '#2e190d');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.save();
  g.font = 'italic 600 30px Georgia, serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const txt = 'Mit Gott und Fleiss erbaut · Anno 1787';
  const tw = g.measureText(txt).width, sc = Math.min(1, (w - 90) / tw);
  g.translate(x + w / 2, y + h / 2 + 1); g.scale(sc, 1);
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillText(txt, 1.5, 1.5);
  g.fillStyle = '#f3e3b6'; g.fillText(txt, 0, 0);
  g.restore();
  for (const ex of [x + 24, x1 - 24]) { heartPath(g, ex, y + h / 2, 11); g.fillStyle = '#c3352b'; g.fill(); }
}

function drawBaleEnd(g, [x, y], R) {
  const cx = x + 128, cy = y + 128;
  circle(g, cx, cy, 125, '#a88a46');
  for (let t = 0; t < 1; t += 0.0015) {
    const a = t * 2 * PI * 9, r = 4 + t * 118;
    g.strokeStyle = rgba(R() < 0.5 ? [222, 196, 122] : [168, 138, 70], 1, 0.7);
    g.lineWidth = 2 + R() * 2;
    g.beginPath(); g.arc(cx, cy, r, a, a + 0.25); g.stroke();
  }
  for (let i = 0; i < 500; i++) {
    const a = R() * 2 * PI, r = R() * 118, l = 4 + R() * 10;
    g.strokeStyle = rgba(R() < 0.5 ? [235, 214, 150] : [140, 112, 58], 1, 0.6);
    g.lineWidth = 1 + R();
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.lineTo(cx + Math.cos(a + 0.08) * r + Math.cos(a) * l * 0.2, cy + Math.sin(a + 0.08) * r); g.stroke();
  }
}

function drawOculus(g, [x, y]) {
  const cx = x + 80, cy = y + 80;
  circle(g, cx, cy, 78, '#d6cfbf');
  circle(g, cx, cy, 64, '#4d6266');
  const cols = ['#c94b3a', '#3d63a8', '#d9b14a', '#5e9a5e'];
  for (let k = 0; k < 4; k++) circle(g, cx + Math.cos(k * PI / 2) * 28, cy + Math.sin(k * PI / 2) * 28, 22, cols[k]);
  circle(g, cx, cy, 16, '#e7d9a0');
  g.strokeStyle = '#262626'; g.lineWidth = 3;
  for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(cx + Math.cos(k * PI / 2) * 28, cy + Math.sin(k * PI / 2) * 28, 22, 0, 2 * PI); g.stroke(); }
}

function drawVent(g, [x, y, x1, y1]) {
  const w = x1 - x, h = y1 - y;
  g.fillStyle = '#3a271a'; g.fillRect(x, y, w, h);
  g.fillStyle = '#0f0c09'; g.fillRect(x + 12, y + 12, w - 24, h - 24);
  for (let i = 1; i < 5; i++) { g.fillStyle = '#5b4231'; g.fillRect(x + 12 + (w - 24) * i / 5 - 5, y + 12, 10, h - 24); }
}

function drawHayDoor(g, [x, y, x1, y1], R) {
  const w = x1 - x, h = y1 - y;
  g.fillStyle = '#33241a'; g.fillRect(x, y, w, h);
  g.fillStyle = '#100c08'; g.fillRect(x + 12, y + 12, w - 24, h - 24);
  g.save(); g.beginPath(); g.rect(x + 12, y + 12, w - 24, h - 24); g.clip();
  for (let i = 0; i < 700; i++) {
    const px = x + 12 + R() * (w - 24), top = y + h * 0.35 + Math.abs(px - (x + w / 2)) * 0.35;
    const py = top + R() * (y1 - top), a = (R() - 0.5) * 1.6, l = 6 + R() * 12;
    g.strokeStyle = rgba(R() < 0.5 ? [205, 176, 100] : [160, 130, 70], 1, 0.85); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke();
  }
  g.restore();
}

const SHUTTER_SCHEMES = [
  ['#2f6a3b', '#efe9dc', true],  // green / white flames
  ['#a3262b', '#efe9dc', true],  // red / white flames
  ['#2b5e37', '', false],        // plain forest green with heart
  ['#9a2a23', '#e2b437', true],  // Bernese red / yellow
];
function texAtlas() {
  return canvasTexture('atlas', AS, AS, (g) => {
    const R = makeRng(71), P = ATLAS_PX;
    drawWindow(g, P.win6, 2, 3); drawWindow(g, P.win4, 2, 2); drawWindow(g, P.winS, 2, 2);
    drawDoor(g, P.door, R); drawBarnDoor(g, P.bdoor, R); drawClock(g, P.clock);
    SHUTTER_SCHEMES.forEach(([a, b, f], i) => drawShutter(g, P['shut' + i], a, b, f));
    drawArchWindow(g, P.arch, R); drawLogs(g, P.logs, R); drawLouver(g, P.louver); drawChurchDoor(g, P.cdoor, R);
    drawRail(g, P.rail, R); drawGeranium(g, P.geran, R); drawFrieze(g, P.frieze); drawCarve(g, P.carve);
    drawInscription(g, P.inscr); drawBaleEnd(g, P.bale, R); drawOculus(g, P.oculus); drawVent(g, P.vent); drawHayDoor(g, P.hayDoor, R);
  }, true);
}

/* =================================== materials ================================ */
const _mats = new Map();
function getMat(key) {
  let m = _mats.get(key);
  if (m) return m;
  const S = (o) => new THREE.MeshStandardMaterial(o);
  switch (key) {
    case 'plaster': m = S({ map: texPlaster(), roughness: 0.94 }); break;
    case 'stone': m = S({ map: texStone(), roughness: 0.9 }); break;
    case 'wood': m = S({ map: texWood(), roughness: 0.82 }); break;
    case 'woodLight': m = S({ map: texWoodLight(), roughness: 0.88 }); break;
    case 'shingle': m = S({ map: texShingle(), roughness: 0.92 }); break;
    case 'slate': m = S({ map: texSlate(), roughness: 0.62, metalness: 0.05 }); break;
    case 'tile': m = S({ map: texTile(), roughness: 0.78 }); break;
    case 'hay': m = S({ map: texHay(), roughness: 1 }); break;
    case 'atlas': m = S({ map: texAtlas(), roughness: 0.72, alphaTest: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }); break;
    case 'metal': m = S({ roughness: 0.38, metalness: 0.75 }); break;
    case 'fur': m = S({ roughness: 0.88 }); break;
    case 'plastic': m = S({ roughness: 0.4 }); break;
    default: m = S({ roughness: 0.62 }); // 'paint'
  }
  m.vertexColors = true;
  m.name = 'village_' + key;
  _mats.set(key, m);
  return m;
}

/* ============================ shared building pieces ========================== */

const LEAF = lin(0x3a7a2a);
const FLOWERS = [
  [lin(0xe3202b), lin(0xc8141e), lin(0xff3b3b), lin(0xd81b26)],
  [lin(0xe3202b), lin(0xe8457a), lin(0xff6f9a), lin(0xc8141e)],
];
const WIN = { win6: [0.78, 1.13], win4: [0.8, 0.95], winS: [0.56, 0.56] };

// Symmetric gable roof with ridge along Z. The roof underside passes through the wall
// plate (±W/2, yE). Builds slabs, soffits, fascia, rafters, bargeboards (+carving), ridge.
function gableRoof(b, p) {
  const { W, yE, pitch, oS, zF, zB, t = 0.17, key, soffit = 'wood', tint = WHITE, carve = false, rafters = true, ridgeKey = 'wood' } = p;
  const cosP = Math.cos(pitch), sinP = Math.sin(pitch), tanP = Math.tan(pitch);
  const yR = yE + (W / 2) * tanP;
  const half = W / 2 + oS, L = half / cosP;
  const Lz = zF - zB, zc = (zF + zB) / 2;
  for (const s of [-1, 1]) {
    const ax = new THREE.Vector3(0, 0, s), ay = new THREE.Vector3(s * sinP, cosP, 0), az = new THREE.Vector3(-s * cosP, sinP, 0);
    const frame = (d, off, z = zc) => {
      const m = new THREE.Matrix4().makeBasis(ax, ay, az);
      m.setPosition(s * d * cosP + ay.x * off, yR - d * sinP + ay.y * off, z);
      return m;
    };
    b.add(key, new THREE.BoxGeometry(Lz, t, L + 0.03), frame(L / 2 - 0.015, t / 2), { uo: s * 0.37 });
    if (soffit) b.add(soffit, new THREE.BoxGeometry(Lz - 0.02, 0.025, L - 0.02), frame(L / 2, -0.014), { color: soffit === 'wood' ? scaleC(tint, 1.12) : WHITE });
    // fascia board at the eave
    const ex = s * half, ey = yE - oS * tanP;
    b.box('wood', 0.05, 0.3, Lz + 0.02, ex + s * (t * sinP + 0.025), ey + t * 0.5 - 0.04, zc, 0, 0, 0, { color: tint });
    if (rafters) {
      const d0 = (W / 2 - 0.3) / cosP, d1 = L - 0.07;
      for (let z = zB + 0.3; z < zF - 0.15; z += 0.85) b.add('wood', new THREE.BoxGeometry(0.1, 0.14, d1 - d0), frame((d0 + d1) / 2, -0.03 - 0.07, z), { color: tint });
    }
    // bargeboards following the verges (carved strip on the front)
    const P = (d, off, z) => [s * d * cosP + ay.x * off, yR - d * sinP + ay.y * off, z];
    for (const [zz, front] of [[zF + 0.035, true], [zB - 0.035, false]]) {
      b.beam('wood', P(-0.06, t - 0.17, zz), P(L + 0.04, t - 0.17, zz), 0.07, 0.36, { color: tint });
      if (front && carve) {
        const n = Math.ceil(L / 3.2), sl = (L + 0.1) / n;
        for (let i = 0; i < n; i++) {
          const c = P(-0.05 + sl * (i + 0.5), t - 0.17 - 0.18 - 0.07, zz + 0.012);
          b.quad('atlas', sl, 0.2, subRect(AR.carve, Math.min(1, sl / 3.2)), c[0], c[1], c[2], 0, 0, -s * pitch, { flipU: s < 0 });
        }
      }
    }
  }
  b.box(ridgeKey, 0.36, 0.1, Lz + 0.1, 0, yR + t / cosP + 0.03, zc, 0, 0, 0, { color: tint });
  return {
    yR, L, half, t, cosP, sinP, tanP,
    // point on the top surface at slope distance d from the ridge, raised `off` along the normal
    top: (s, d, off = 0) => [s * (d * cosP + sinP * (t + off)), yR - d * sinP + cosP * (t + off)],
  };
}

// Window decal (+ shutters, sill, head trim, flower box) in a wall frame:
// wall surface at z = 0, outward +z, y = sill height.
function addWindow(b, x, y, kind, o = {}) {
  const [w, h] = WIN[kind];
  b.quad('atlas', w, h, AR[kind], x, y + h / 2, 0.03);
  if (o.scheme != null) {
    const sw = w * 0.5, r = AR['shut' + o.scheme];
    b.quad('atlas', sw, h, r, x - w / 2 - sw / 2 - 0.05, y + h / 2, 0.045);
    b.quad('atlas', sw, h, r, x + w / 2 + sw / 2 + 0.05, y + h / 2, 0.045, 0, 0, 0, { flipU: true });
  }
  b.box(o.sillKey || 'wood', w + 0.22, 0.06, 0.16, x, y - 0.03, 0.07, 0, 0, 0, { color: o.sillColor || [0.7, 0.66, 0.62] });
  if (o.head) b.box('wood', w + 0.26, 0.08, 0.1, x, y + h + 0.05, 0.05, 0, 0, 0, { color: o.headColor || WHITE });
  if (o.flowers) addFlowerBox(b, x, y - 0.16, 0.2, w + 0.14, o.R, o.cols);
}

// Flower box with geranium mounds + trailing geranium spray. (x,y,z) = box centre.
function addFlowerBox(b, x, y, z, len, R, cols) {
  b.box('wood', len, 0.18, 0.2, x, y, z, 0, 0, 0, { color: [0.9, 0.84, 0.78] });
  const n = Math.max(2, Math.round(len / 0.26));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5;
    b.blob('paint', 0.13, x + t * len + (R() - 0.5) * 0.05, y + 0.12, z + (R() - 0.5) * 0.06, 1.25, 0.8, 1.1, { color: jit(LEAF, R, 0.3) });
  }
  const m = Math.max(3, Math.round(len / 0.17));
  for (let i = 0; i < m; i++) {
    b.blob('paint', 0.055 + R() * 0.03, x + (R() - 0.5) * len * 0.95, y + 0.19 + R() * 0.1, z + (R() - 0.35) * 0.2, 1, 0.85, 1, { color: jit(R.pick(cols), R, 0.15) });
  }
  const segs = Math.max(1, Math.round(len / 1.0)), sw = len / segs;
  for (let i = 0; i < segs; i++) {
    b.quad('atlas', sw * 1.04, 0.6, subRect(AR.geran, Math.min(1, sw / 1.0)), x - len / 2 + sw * (i + 0.5), y - 0.2, z + 0.115, 0, 0, 0, { flipU: R() < 0.5 });
  }
}

// Balcony with sawn (Laubsäge) railing and flower boxes. Wall frame, deck top at y.
function addBalcony(b, cx, bw, y, bd, R, cols, tint, flowers = true) {
  const dk = scaleC(tint, 0.85);
  b.box('wood', bw, 0.1, bd, cx, y - 0.05, bd / 2, 0, 0, 0, { color: tint });
  const nj = Math.max(3, Math.round(bw / 1.4) + 1);
  for (let i = 0; i < nj; i++) {
    const x = cx - bw / 2 + 0.1 + (bw - 0.2) * i / (nj - 1);
    b.box('wood', 0.13, 0.18, bd + 0.1, x, y - 0.19, (bd + 0.1) / 2 - 0.05, 0, 0, 0, { color: dk });
    b.box('wood', 0.12, 0.12, 0.26, x, y - 0.33, bd - 0.1, 0, 0, 0, { color: dk });
  }
  const H = 1.0, zr = bd - 0.06;
  const np = Math.max(2, Math.round(bw / 2.0)) + 1;
  for (let i = 0; i < np; i++) b.box('wood', 0.11, H, 0.11, cx - bw / 2 + 0.055 + (bw - 0.11) * i / (np - 1), y + H / 2, zr, 0, 0, 0, { color: dk });
  for (const s of [-1, 1]) b.box('wood', 0.11, H, 0.11, cx + s * (bw / 2 - 0.055), y + H / 2, 0.08, 0, 0, 0, { color: dk });
  b.box('wood', bw + 0.06, 0.07, 0.2, cx, y + H + 0.035, zr, 0, 0, 0, { color: tint });
  for (const s of [-1, 1]) b.box('wood', 0.2, 0.07, bd, cx + s * (bw / 2 - 0.055), y + H + 0.035, bd / 2, 0, 0, 0, { color: tint });
  b.box('wood', bw, 0.08, 0.09, cx, y + 0.1, zr, 0, 0, 0, { color: dk });
  const ns = Math.max(1, Math.round(bw / 2.0)), sw = bw / ns;
  for (let i = 0; i < ns; i++) b.quad('atlas', sw, 0.82, subRect(AR.rail, Math.min(1, sw / 2.0)), cx - bw / 2 + sw * (i + 0.5), y + 0.56, zr);
  for (const s of [-1, 1]) b.quad('atlas', bd - 0.16, 0.82, subRect(AR.rail, Math.min(1, (bd - 0.16) / 2.0)), cx + s * (bw / 2 - 0.055), y + 0.56, bd / 2 + 0.01, 0, PI / 2, 0);
  if (flowers) {
    const nf = Math.max(1, Math.round(bw / 1.8)), fl = bw / nf;
    for (let i = 0; i < nf; i++) addFlowerBox(b, cx - bw / 2 + fl * (i + 0.5), y + H - 0.06, zr + 0.17, fl - 0.14, R, cols);
  }
}

// Rustic bench: origin on the ground under the seat centre, sitter faces +Z.
function addBench(b, x, z, ry, key = 'wood', tint = [0.95, 0.9, 0.85]) {
  b.push(M(x, 0, z, 0, ry, 0));
  const dk = scaleC(tint, 0.8);
  b.box(key, 1.6, 0.07, 0.38, 0, 0.45, 0, 0, 0, 0, { color: tint });
  for (const s of [-1, 1]) {
    b.box(key, 0.07, 0.42, 0.32, s * 0.62, 0.21, 0.02, 0, 0, 0, { color: dk });
    b.box(key, 0.07, 0.55, 0.06, s * 0.62, 0.72, -0.17, -0.13, 0, 0, { color: dk });
  }
  b.box(key, 1.6, 0.16, 0.04, 0, 0.84, -0.21, -0.13, 0, 0, { color: tint });
  b.box(key, 1.25, 0.06, 0.05, 0, 0.12, 0.02, 0, 0, 0, { color: dk });
  b.pop();
}

/* ==================================== chalet ================================== */

export function createChalet(seed = 0) {
  const R = makeRng(seed * 7 + 3);
  const b = new Builder();
  const W = R.range(8.2, 11.6), D = R.range(9, 13.5);
  const nWood = R() < 0.55 ? 2 : 1;
  const hS = R.range(2.5, 2.85), hF = 2.4, sill = 0.26;
  const yW0 = hS + sill, yE = yW0 + nWood * hF;
  const pitch = R.range(19, 25) * PI / 180, tanP = Math.tan(pitch);
  const oF = R.range(1.7, 2.3), oB = R.range(0.7, 1.0), oS = R.range(1.05, 1.4);
  const roofKey = R() < 0.62 ? 'shingle' : 'slate';
  const stones = roofKey === 'shingle' && R() < 0.7;
  const scheme = R.int(0, 3);
  const nBalc = Math.min(nWood, R() < 0.5 ? 1 : 2);
  const sideBalc = R() < 0.45;
  const cols = FLOWERS[R() < 0.72 ? 0 : 1];
  const wk = R.range(0.8, 1.1);
  const tint = [wk, wk * 0.97, wk * 0.93], dk = scaleC(tint, 0.8), logC = scaleC(tint, 1.1);
  const hw = W / 2 + 0.04, hd = D / 2 + 0.04; // log wall faces
  const grime = (p) => { const k = 0.72 + 0.28 * Math.sqrt(clamp01((p.y + 1.5) / (hS + 1.5))); return [k, k * 0.985, k * 0.95]; };
  const ws = R() < 0.5 ? -1 : 1;                        // woodpile side
  const wl = R.range(2.4, 3.6), wz = R.range(-D / 2 + wl / 2 + 0.7, D / 2 - wl / 2 - 0.9);
  const nS = Math.max(2, Math.floor((D - 1.6) / 2.4)), ssp = (D - 1.6) / nS;
  const zStack = nS % 2 ? ssp / 2 : 0;                    // interior wall log-ends between side windows
  const balcLevels = nBalc === 2 ? [nWood - 1, nWood - 2] : [nWood - 1];

  // ---- whitewashed masonry ground floor (reaches 1.5 m below grade) + stone plinth
  b.box('plaster', W, hS + 1.5, D, 0, (hS - 1.5) / 2, 0, 0, 0, 0, { colorFn: grime });
  b.box('stone', W + 0.12, 1.95, D + 0.12, 0, -0.55, 0);
  b.box('wood', W + 0.26, sill, D + 0.26, 0, hS + sill / 2, 0, 0, 0, 0, { color: dk });

  // ---- log body incl. gable triangle
  const sh = new THREE.Shape();
  sh.moveTo(-hw, yW0); sh.lineTo(hw, yW0); sh.lineTo(hw, yE); sh.lineTo(0, yE + hw * tanP + 0.02); sh.lineTo(-hw, yE); sh.closePath();
  const ex = new THREE.ExtrudeGeometry(sh, { depth: 2 * hd, bevelEnabled: false, curveSegments: 1 });
  ex.translate(0, 0, -hd);
  b.add('wood', ex, null, { color: tint });
  for (let k = 1; k <= nWood; k++) b.box('wood', 2 * hw + 0.14, 0.2, 2 * hd + 0.14, 0, yW0 + k * hF - 0.1, 0, 0, 0, 0, { color: dk });
  // interlocking corner log ends (Gwätt)
  let row = 0;
  for (let y = yW0 + 0.12; y < yE - 0.22; y += 0.2, row++) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      if (row % 2) b.box('wood', 0.3, 0.16, 0.16, sx * (hw + 0.13), y, sz * (hd - 0.08), 0, 0, 0, { color: logC });
      else b.box('wood', 0.16, 0.16, 0.3, sx * (hw - 0.08), y, sz * (hd + 0.13), 0, 0, 0, { color: logC });
    }
    if (row % 2) for (const sx of [-1, 1]) b.box('wood', 0.3, 0.16, 0.16, sx * (hw + 0.13), y, zStack, 0, 0, 0, { color: logC });
  }

  // ---- front (gable) facade: window bands, balconies, frieze, inscription, attic windows
  const nFront = Math.max(2, Math.min(6, Math.floor((W - 1.0) / 1.75)));
  const sp = Math.min(1.95, (W - 1.0) / nFront);
  b.push(M(0, 0, hd));
  for (let k = 0; k < nWood; k++) {
    const yb = yW0 + k * hF, hasB = balcLevels.includes(k);
    for (let i = 0; i < nFront; i++) addWindow(b, (i - (nFront - 1) / 2) * sp, yb + 0.72, 'win6', { scheme, flowers: !hasB && R() < 0.85, R, cols, head: true, headColor: dk });
    if (hasB) addBalcony(b, 0, 2 * hw + 0.3, yb + 0.02, R.range(1.0, 1.25), R, cols, tint);
  }
  const xf = hw - 0.34 / tanP - 0.15;
  if (xf > 1) {
    const nfz = Math.ceil((2 * xf) / 3), fw = (2 * xf) / nfz;
    for (let i = 0; i < nfz; i++) b.quad('atlas', fw, 0.24, subRect(AR.frieze, Math.min(1, fw / 3)), -xf + fw * (i + 0.5), yE + 0.13, 0.025);
  }
  const iw = Math.min(3.4, 2 * (hw - 0.75 / tanP) - 0.4);
  if (iw > 1.8) b.quad('atlas', iw, iw / 16, AR.inscr, 0, yE + 0.5, 0.025);
  {
    const gy = yE + 0.8, yRr = yE + hw * tanP;
    const gk = yRr - gy > 1.5 ? 'win4' : 'winS', [gw, gh] = WIN[gk];
    for (const x of [-W / 8, W / 8, -3 * W / 8, 3 * W / 8]) {
      if (gy + gh + 0.22 < yRr - (Math.abs(x) + gw / 2 + 0.1) * tanP) addWindow(b, x, gy, gk, { R, head: true, headColor: dk });
    }
  }
  b.pop();

  // ---- front ground floor: door, stone surround, step, windows, bench
  b.push(M(0, 0, D / 2));
  const doorX = R() < 0.4 ? 0 : (R() < 0.5 ? -1 : 1) * W * R.range(0.18, 0.28);
  b.quad('atlas', 1.0, 2.0, AR.door, doorX, 1.25, 0.03);
  for (const s of [-1, 1]) b.box('stone', 0.16, 2.24, 0.08, doorX + s * 0.58, 1.12, 0.03, 0, 0, 0, { color: [1.15, 1.15, 1.12] });
  b.box('stone', 1.34, 0.18, 0.1, doorX, 2.33, 0.04, 0, 0, 0, { color: [1.15, 1.15, 1.12] });
  b.box('stone', 1.5, 0.85, 0.55, doorX, -0.175, 0.28);
  const benchX = doorX + (doorX > 0.1 ? -1 : 1) * 1.6;
  addBench(b, benchX, 0.33, 0, 'wood', tint);
  const nG = Math.max(2, Math.floor((W - 1.6) / 1.9));
  for (let i = 0; i < nG; i++) {
    const x = (i - (nG - 1) / 2) * ((W - 1.6) / nG);
    if (Math.abs(x - doorX) < 1.5) continue;
    addWindow(b, x, 0.95, 'win4', { scheme, sillKey: 'stone', sillColor: WHITE, flowers: Math.abs(x - benchX) > 1.1 && R() < 0.75, R, cols });
  }
  b.pop();

  // ---- side facades
  for (const s of [-1, 1]) {
    const sideB = sideBalc && s === -ws;
    b.push(M(s * hw, 0, 0, 0, s * PI / 2, 0));
    for (let k = 0; k < nWood; k++) {
      const top = k === nWood - 1;
      for (let i = 0; i < nS; i++) addWindow(b, (i - (nS - 1) / 2) * ssp, yW0 + k * hF + 0.72, 'win6', { scheme, R, cols, flowers: !(sideB && top) && R() < 0.35, head: true, headColor: dk });
    }
    if (sideB) addBalcony(b, 0, D * 0.62, yW0 + (nWood - 1) * hF + 0.02, 1.0, R, cols, tint, R() < 0.6);
    b.pop();
    b.push(M(s * W / 2, 0, 0, 0, s * PI / 2, 0));
    for (let i = 0; i < nS; i++) {
      const lx = (i - (nS - 1) / 2) * ssp;
      if (s === ws && Math.abs(-s * lx - wz) < wl / 2 + 0.75) continue;
      addWindow(b, lx, 0.95, 'win4', { scheme, sillKey: 'stone', sillColor: WHITE, R, cols, flowers: R() < 0.3 });
    }
    b.pop();
  }
  // ---- back facade
  b.push(M(0, 0, -hd, 0, PI, 0));
  for (let k = 0; k < nWood; k++) for (const x of [-W * 0.24, W * 0.24]) addWindow(b, x, yW0 + k * hF + 0.72, 'win6', { scheme, head: true, headColor: dk });
  b.pop();
  b.push(M(0, 0, -D / 2, 0, PI, 0));
  addWindow(b, -W * 0.22, 0.95, 'win4', { scheme, sillKey: 'stone', sillColor: WHITE });
  b.pop();

  // ---- roof, purlins with carved heads, brackets (Büge)
  const roof = gableRoof(b, { W: 2 * hw, yE, pitch, oS, zF: hd + oF, zB: -hd - oB, key: roofKey, t: 0.18, tint: dk, carve: true });
  const zP0 = -hd - oB + 0.08, zP1 = hd + oF - 0.06;
  for (const x of [0, W * 0.25, -W * 0.25, hw, -hw, hw + oS * 0.72, -(hw + oS * 0.72)]) {
    const yt = roof.yR - Math.abs(x) * tanP - 0.03;
    b.box('wood', 0.2, 0.24, zP1 - zP0, x, yt - 0.12, (zP0 + zP1) / 2, 0, 0, 0, { color: dk });
    b.box('wood', 0.18, 0.14, 0.55, x, yt - 0.31, zP1 - 0.36, 0, 0, 0, { color: dk });
    b.box('wood', 0.16, 0.1, 0.3, x, yt - 0.43, zP1 - 0.52, 0, 0, 0, { color: dk });
  }
  for (const x of [0, W * 0.25, -W * 0.25]) {
    const yt = roof.yR - Math.abs(x) * tanP - 0.27;
    const yf = Math.max(yE + 0.75, yt - 1.25);
    if (yt - yf < 0.45) continue;
    b.beam('wood', [x, yf, hd + 0.02], [x, yt + 0.02, hd + oF * 0.62], 0.13, 0.13, { color: dk });
  }
  for (const s of [-1, 1]) {
    const xo = s * (hw + oS * 0.72), yt = roof.yR - Math.abs(xo) * tanP - 0.27;
    for (const z of [hd - 0.45, zStack, -hd + 0.45]) b.beam('wood', [s * (hw + 0.02), yt - 1.0, z], [xo, yt + 0.02, z], 0.13, 0.13, { color: dk });
  }

  // ---- chimney with little wooden hood
  const chx = (R() < 0.5 ? -1 : 1) * W * R.range(0.1, 0.22), chz = R.range(-D * 0.3, D * 0.15);
  const ctop = roof.yR - Math.abs(chx) * tanP + 0.18 / roof.cosP + R.range(0.7, 1.0);
  b.box('plaster', 0.6, ctop - yE + 0.3, 0.6, chx, (ctop + yE - 0.3) / 2, chz, 0, 0, 0, { colorFn: (p) => { const k = 1 - 0.4 * smooth(yE, ctop, p.y); return [k, k, k * 0.97]; } });
  b.box('stone', 0.78, 0.07, 0.78, chx, ctop + 0.035, chz);
  for (const [px, pz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) b.box('wood', 0.06, 0.3, 0.06, chx + px, ctop + 0.22, chz + pz, 0, 0, 0, { color: dk });
  for (const s of [-1, 1]) b.box(roofKey, 0.5, 0.04, 0.95, chx + s * 0.22, ctop + 0.45, chz, 0, 0, -s * 0.45);

  // ---- stone-weighted shingle roof (Schwersteindach)
  if (stones) {
    for (const s of [-1, 1]) for (const f of [0.24, 0.52, 0.8]) {
      const d = f * roof.L, [px, py] = roof.top(s, d, 0.05);
      b.add('wood', new THREE.CylinderGeometry(0.055, 0.055, zP1 - zP0, 6, 1), M(px, py, (zP0 + zP1) / 2, PI / 2, 0, 0), { color: dk });
      for (let z = zP0 + 0.3; z < zP1 - 0.25; z += R.range(0.55, 1.0)) {
        if (Math.abs(z - chz) < 0.6 && Math.abs(px - chx) < 1.2) continue;
        const r = R.range(0.14, 0.24), [qx, qy] = roof.top(s, d - 0.13, r * 0.5);
        b.blob('stone', r, qx, qy, z, 1.15, 0.7, 1.0, { color: jit([1, 1, 1], R, 0.15) }, (R() - 0.5) * 0.3, 0, -s * pitch);
      }
    }
  }

  // ---- woodpile against a side wall
  {
    const x0 = ws * (W / 2), wd = 0.55, wh = 1.8;
    b.box('wood', wd, wh, wl, x0 + ws * (wd / 2 + 0.02), wh / 2, wz, 0, 0, 0, { color: [0.5, 0.42, 0.36] });
    const nx = Math.max(2, Math.round(wl / 0.8)), qw = wl / nx;
    b.push(M(x0 + ws * (wd + 0.025), 0, wz, 0, ws * PI / 2, 0));
    for (let i = 0; i < nx; i++) for (let j = 0; j < 2; j++) b.quad('atlas', qw, wh / 2, AR.logs, (i - (nx - 1) / 2) * qw, wh / 4 + j * wh / 2, 0, 0, 0, 0, { flipU: (i + j) % 2 === 1 });
    b.pop();
    b.box('wood', wd + 0.3, 0.05, wl + 0.3, x0 + ws * (wd / 2 + 0.12), wh + 0.1, wz, 0, 0, -ws * 0.18, { color: dk });
    for (const e of [-1, 1]) b.box('wood', 0.1, wh + 0.12, 0.1, x0 + ws * (wd + 0.07), (wh + 0.12) / 2, wz + e * (wl / 2 + 0.02), 0, 0, 0, { color: dk });
  }

  const g = b.build(new THREE.Group());
  g.name = 'Chalet';
  g.userData = { kind: 'chalet', seed, width: W + 2 * oS, depth: D + oF + oB, height: roof.yR + 0.3, footprint: [W, D] };
  return g;
}

// Pentagonal (house-profile) prism, ridge along Z.
function gableBody(b, key, hw, hd, y0, yE, yApex, o) {
  const sh = new THREE.Shape();
  sh.moveTo(-hw, y0); sh.lineTo(hw, y0); sh.lineTo(hw, yE); sh.lineTo(0, yApex); sh.lineTo(-hw, yE); sh.closePath();
  const ex = new THREE.ExtrudeGeometry(sh, { depth: 2 * hd, bevelEnabled: false, curveSegments: 1 });
  ex.translate(0, 0, -hd);
  b.add(key, ex, null, o);
}

/* ===================================== barn =================================== */
// 'stadel' = timber granary on stone piers with mouse-stones; 'heustall' = stone stable
// with a vertically boarded hay loft above. Picked by seed.
export function createBarn(seed = 0) {
  const R = makeRng(seed * 13 + 5);
  const b = new Builder();
  const stadel = Math.abs(Math.round(seed)) % 2 === 0;
  const W = R.range(5.2, 7), D = R.range(5.6, 8);
  const k = R.range(0.58, 0.74), tint = [k, k * 0.86, k * 0.76], dk = scaleC(tint, 0.78);
  const roofKey = R() < 0.6 ? 'shingle' : 'slate';
  const pitch = R.range(21, 27) * PI / 180, tanP = Math.tan(pitch);
  const hw = W / 2, hd = D / 2;
  let yE;
  if (stadel) {
    const yB = 1.05, y0 = yB + 0.24;
    const zs = D > 6.6 ? [-hd + 0.35, 0, hd - 0.35] : [-hd + 0.35, hd - 0.35];
    for (const x of [-hw + 0.35, hw - 0.35]) for (const z of zs) {
      b.box('stone', 0.5, yB - 0.12 + 1.5, 0.5, x, (yB - 0.12 - 1.5) / 2, z, 0, (R() - 0.5) * 0.3, 0, { color: jit(WHITE, R, 0.1) });
      b.cyl('stone', 0.43, 0.46, 0.09, 12, x, yB - 0.075, z, 0, R() * 3, 0, { color: [1.15, 1.15, 1.12] });
    }
    b.box('wood', W + 0.12, 0.24, D + 0.12, 0, yB + 0.12, 0, 0, 0, 0, { color: dk });
    yE = y0 + R.range(2.6, 3.2);
    gableBody(b, 'wood', hw, hd, y0, yE, yE + hw * tanP + 0.02, { color: tint });
    let row = 0;
    for (let y = y0 + 0.1; y < yE - 0.15; y += 0.2, row++) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      if (row % 2) b.box('wood', 0.28, 0.16, 0.15, sx * (hw + 0.12), y, sz * (hd - 0.075), 0, 0, 0, { color: scaleC(tint, 1.1) });
      else b.box('wood', 0.15, 0.16, 0.28, sx * (hw - 0.075), y, sz * (hd + 0.12), 0, 0, 0, { color: scaleC(tint, 1.1) });
    }
    const dx = R.range(-0.2, 0.2) * W;
    b.quad('atlas', 1.0, 1.75, AR.bdoor, dx, y0 + 0.9, hd + 0.03);
    // detached stone steps (gap keeps the mice out)
    for (let i = 0; i < 3; i++) b.box('stone', 1.1, (i + 1) * 0.34 + 0.5, 0.42, dx, ((i + 1) * 0.34 - 0.5) / 2, hd + 0.42 + (2 - i) * 0.4, 0, 0, 0, { color: jit(WHITE, R, 0.08) });
    for (const s of [-1, 1]) {
      b.push(M(s * hw, 0, 0, 0, s * PI / 2, 0));
      b.quad('atlas', 0.42, 0.52, AR.vent, -hd * 0.4, y0 + 1.9, 0.03);
      b.quad('atlas', 0.42, 0.52, AR.vent, hd * 0.4, y0 + 1.9, 0.03);
      b.pop();
    }
    b.quad('atlas', 0.5, 0.62, AR.vent, 0, yE + 0.55, hd + 0.03);
  } else {
    const hS = R.range(2.2, 2.5), y0 = hS + 0.22, white = R() < 0.4;
    const grime = (p) => { const q = 0.75 + 0.25 * clamp01((p.y + 1.5) / (hS + 1.5)); return [q, q * 0.98, q * 0.94]; };
    b.box(white ? 'plaster' : 'stone', W, hS + 1.5, D, 0, (hS - 1.5) / 2, 0, 0, 0, 0, white ? { colorFn: grime } : { color: jit(WHITE, R, 0.06) });
    if (white) b.box('stone', W + 0.1, 1.9, D + 0.1, 0, -0.55, 0);
    b.box('wood', W + 0.22, 0.22, D + 0.22, 0, hS + 0.11, 0, 0, 0, 0, { color: dk });
    yE = y0 + R.range(2.1, 2.7);
    const gt = R.range(0.55, 0.72), grey = [gt, gt * 0.93, gt * 0.86];
    gableBody(b, 'woodLight', hw + 0.03, hd + 0.03, y0, yE, yE + (hw + 0.03) * tanP + 0.02, { color: grey, swap: true });
    // vertical battens over the board joints
    for (const s of [-1, 1]) for (let z = -hd + 0.3; z < hd - 0.1; z += 0.55) b.box('woodLight', 0.05, yE - y0, 0.07, s * (hw + 0.05), (y0 + yE) / 2, z, 0, 0, 0, { color: scaleC(grey, 0.8), swap: true });
    const dx = R.range(-0.18, 0.18) * W;
    b.quad('atlas', 1.1, 1.95, AR.bdoor, dx, 1.0, hd + 0.03);
    b.box('wood', 1.35, 0.14, 0.1, dx, 2.05, hd + 0.05, 0, 0, 0, { color: dk });
    b.box('stone', 1.4, 0.7, 0.4, dx, -0.3, hd + 0.2);
    for (const s of [-1, 1]) {
      b.push(M(s * W / 2, 0, 0, 0, s * PI / 2, 0));
      for (const z of [-hd * 0.45, hd * 0.45]) addWindow(b, z, 1.25, 'winS', { sillKey: 'stone', sillColor: WHITE });
      b.pop();
    }
    const hy = y0 + 0.4, gh = yE + (hw * tanP) - hy;
    if (gh > 1.6) b.quad('atlas', 1.3, 1.3, AR.hayDoor, 0, hy + 0.65, hd + 0.06);
    else b.quad('atlas', 1.3, 1.3, AR.hayDoor, 0, y0 + 1.1, hd + 0.06);
  }
  const oS = 0.75, oF = 0.9, oB = 0.7;
  const roof = gableRoof(b, { W: W + 0.04, yE, pitch, oS, zF: hd + oF, zB: -hd - oB, key: roofKey, t: 0.15, tint: dk, carve: false });
  const zP0 = -hd - oB + 0.06, zP1 = hd + oF - 0.05;
  for (const x of [0, hw, -hw, hw + oS * 0.65, -(hw + oS * 0.65)]) {
    const yt = roof.yR - Math.abs(x) * tanP - 0.03;
    b.box('wood', 0.18, 0.22, zP1 - zP0, x, yt - 0.11, (zP0 + zP1) / 2, 0, 0, 0, { color: dk });
  }
  if (roofKey === 'shingle' && R() < 0.75) {
    for (const s of [-1, 1]) for (const f of [0.3, 0.7]) {
      const d = f * roof.L, [px, py] = roof.top(s, d, 0.05);
      b.add('wood', new THREE.CylinderGeometry(0.05, 0.05, zP1 - zP0, 6, 1), M(px, py, (zP0 + zP1) / 2, PI / 2, 0, 0), { color: dk });
      for (let z = zP0 + 0.25; z < zP1 - 0.2; z += R.range(0.5, 0.95)) {
        const r = R.range(0.13, 0.22), [qx, qy] = roof.top(s, d - 0.12, r * 0.5);
        b.blob('stone', r, qx, qy, z, 1.15, 0.7, 1.0, { color: jit(WHITE, R, 0.15) }, (R() - 0.5) * 0.3, 0, -s * pitch);
      }
    }
  }
  const g = b.build(new THREE.Group());
  g.name = 'Barn';
  g.userData = { kind: 'barn', type: stadel ? 'stadel' : 'heustall', seed, width: W + 2 * oS, depth: D + oF + oB, height: roof.yR + 0.3, footprint: [W, D] };
  return g;
}

/* ==================================== church ================================== */
export function createChurch() {
  const R = makeRng(4242);
  const b = new Builder();
  const W = 8.6, D = 15, H = 6.8, pitch = 42 * PI / 180, tanP = Math.tan(pitch);
  const hw = W / 2, hd = D / 2;
  const GOLD = lin(0xd8aa3e), QUOIN = [1.22, 1.2, 1.14];
  const grime = (top) => (p) => { const k = 0.74 + 0.26 * Math.sqrt(clamp01((p.y + 1.5) / (top + 1.5))); return [k, k * 0.985, k * 0.955]; };

  // ---- nave
  b.box('plaster', W, H + 1.5, D, 0, (H - 1.5) / 2, 0, 0, 0, 0, { colorFn: grime(H) });
  gableBody(b, 'plaster', hw, hd, H - 0.01, H, H + hw * tanP + 0.02);
  b.box('stone', W + 0.14, 2.05, D + 0.14, 0, -0.475, 0, 0, 0, 0, { color: QUOIN });
  for (const s of [-1, 1]) b.box('stone', 0.2, 0.22, D + 0.1, s * (hw + 0.04), H - 0.11, 0, 0, 0, 0, { color: QUOIN });
  for (let y = 0.85, i = 0; y < H - 0.3; y += 0.62, i++) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const a = i % 2 ? 0.5 : 0.3, c = i % 2 ? 0.3 : 0.5;
    b.box('stone', a, 0.28, c, sx * (hw - a / 2 + 0.025), y, sz * (hd - c / 2 + 0.025), 0, 0, 0, { color: QUOIN });
  }
  const roof = gableRoof(b, { W, yE: H, pitch, oS: 0.5, zF: hd + 0.45, zB: -hd - 0.2, key: 'tile', t: 0.2, soffit: 'plaster', tint: [0.75, 0.62, 0.52], carve: false, rafters: false, ridgeKey: 'tile' });
  // nave windows
  for (const s of [-1, 1]) {
    b.push(M(s * hw, 0, 0, 0, s * PI / 2, 0));
    for (const z of [-4.6, -0.8, 3.0]) {
      b.quad('atlas', 1.05, 2.5, AR.arch, z, 3.65, 0.035);
      b.box('stone', 1.3, 0.1, 0.16, z, 2.37, 0.07, 0, 0, 0, { color: QUOIN });
    }
    b.pop();
  }
  // ---- polygonal apse
  const ar = hw - 0.55, Ha = H - 0.9;
  b.add('plaster', new THREE.CylinderGeometry(ar, ar, Ha + 1.5, 4, 1, true, PI / 2, PI), M(0, (Ha - 1.5) / 2, -hd), { colorFn: grime(Ha) });
  b.add('stone', new THREE.CylinderGeometry(ar + 0.07, ar + 0.07, 2.05, 4, 1, true, PI / 2, PI), M(0, -0.475, -hd), { color: QUOIN });
  const rr = ar + 0.5, rh = rr * Math.tan(pitch * 0.95);
  b.add('tile', new THREE.CylinderGeometry(0.02, rr, rh, 4, 1, false, PI / 2, PI), M(0, Ha + rh / 2 - 0.08, -hd), { uv: 'keep', us: (PI * rr) / 2, vs: Math.hypot(rr, rh) / 2 });
  for (const a of [-PI / 8, PI / 8]) {
    const n = PI + a, ap = ar * Math.cos(PI / 8) + 0.035;
    b.quad('atlas', 0.85, 2.1, AR.arch, Math.sin(n) * ap, 3.2, -hd + Math.cos(n) * ap, 0, n, 0);
  }

  // ---- bell tower with clock, belfry louvres and tall slender spire
  const T = 3.7, tH = 17.6, tz = hd + T / 2 - 0.3;
  b.box('plaster', T, tH + 1.5, T, 0, (tH - 1.5) / 2, tz, 0, 0, 0, { colorFn: grime(tH) });
  b.box('stone', T + 0.14, 2.05, T + 0.14, 0, -0.475, tz, 0, 0, 0, { color: QUOIN });
  for (let y = 0.85, i = 0; y < tH - 0.4; y += 0.62, i++) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const a = i % 2 ? 0.55 : 0.32, c = i % 2 ? 0.32 : 0.55;
    b.box('stone', a, 0.28, c, sx * (T / 2 - a / 2 + 0.03), y, tz + sz * (T / 2 - c / 2 + 0.03), 0, 0, 0, { color: QUOIN });
  }
  for (const [y, e, h] of [[12.35, 0.3, 0.22], [14.45, 0.24, 0.16], [tH + 0.02, 0.4, 0.3]]) b.box('stone', T + e, h, T + e, 0, y, tz, 0, 0, 0, { color: QUOIN });
  for (let i = 0; i < 4; i++) {
    b.push(M(0, 0, tz, 0, i * PI / 2, 0));
    b.quad('atlas', 1.85, 1.85, AR.clock, 0, 13.4, T / 2 + 0.04);
    for (const x of [-0.55, 0.55]) b.quad('atlas', 0.78, 1.75, AR.louver, x, 16.0, T / 2 + 0.035);
    b.box('stone', 2.0, 0.1, 0.18, 0, 15.08, T / 2 + 0.06, 0, 0, 0, { color: QUOIN });
    if (i !== 0) b.quad('atlas', 0.45, 1.05, AR.arch, 0, 9.4, T / 2 + 0.035);
    b.quad('atlas', 0.45, 1.05, AR.arch, 0, i === 0 ? 7.0 : 5.6, T / 2 + 0.035);
    b.pop();
  }
  // entrance
  b.quad('atlas', 1.6, 2.6, AR.cdoor, 0, 0.35 + 1.3, tz + T / 2 + 0.04);
  b.quad('atlas', 0.95, 0.95, AR.oculus, 0, 4.4, tz + T / 2 + 0.04);
  for (let i = 0; i < 3; i++) b.box('stone', 2.4 - i * 0.3, 0.12 * (i + 1) + 0.5, 0.36, 0, (0.12 * (i + 1) - 0.5) / 2, tz + T / 2 + 0.18 + (2 - i) * 0.34, 0, 0, 0, { color: QUOIN });
  // small windows on the nave front beside the tower
  for (const s of [-1, 1]) b.quad('atlas', 0.7, 1.7, AR.arch, s * (T / 2 + (hw - T / 2) / 2), 3.4, hd + 0.035);
  // flared skirt + octagonal spire
  const yS = tH + 0.17;
  const r0 = (T / 2 + 0.42) * Math.SQRT2, r1 = (T / 2 - 0.12) * Math.SQRT2;
  b.add('tile', new THREE.CylinderGeometry(r1, r0, 0.9, 4, 1, false), M(0, yS + 0.45, tz, 0, PI / 4, 0), { uv: 'keep', us: 4 * r0 / Math.SQRT2 / 2 * 2, vs: 0.6 });
  const Hs = 12.5, rs = (T / 2 - 0.1) / Math.cos(PI / 8);
  b.add('tile', new THREE.CylinderGeometry(0.03, rs, Hs, 8, 1, false), M(0, yS + 0.85 + Hs / 2, tz, 0, PI / 8, 0), { uv: 'keep', us: (2 * PI * rs) / 2, vs: Math.hypot(rs, Hs) / 2 });
  const yTop = yS + 0.85 + Hs;
  b.blob('metal', 0.2, 0, yTop + 0.12, tz, 1, 1, 1, { color: GOLD }, 0, 0, 0, 1);
  b.box('metal', 0.07, 1.25, 0.07, 0, yTop + 0.75, tz, 0, 0, 0, { color: GOLD });
  b.box('metal', 0.6, 0.07, 0.07, 0, yTop + 0.98, tz, 0, 0, 0, { color: GOLD });
  // little weathercock
  b.blob('metal', 0.14, 0, yTop + 1.45, tz, 1.5, 0.9, 0.35, { color: GOLD }, 0, 0, 0, 0);
  b.box('metal', 0.04, 0.3, 0.04, 0, yTop + 1.36, tz, 0, 0, 0, { color: GOLD });

  const g = b.build(new THREE.Group());
  g.name = 'Church';
  g.userData = { kind: 'church', width: W + 1, depth: D + T + 1, height: yTop + 1.6, footprint: [W, D + T] };
  return g;
}

/* ===================================== dock =================================== */
// Origin: shore end of the deck, y = 0 is the deck top, deck runs along +Z.
// Water surface expected at y = -0.6 (posts reach y = -3.6).
export function createDock(length = 14) {
  const L = Math.max(4, length);
  const R = makeRng(Math.round(L * 10) + 77);
  const b = new Builder();
  const DW = 2.4, hw = DW / 2, water = -0.6, bottom = -3.6;
  const WET = [0.42, 0.46, 0.36], DRY = [0.78, 0.74, 0.7], STEEL = lin(0xb8bcc2);
  // deck planks (slightly irregular)
  for (let z = 0; z < L - 0.01; z += 0.2) {
    const k = R.range(0.8, 1.08);
    b.box('woodLight', DW + R.range(-0.02, 0.07), 0.05, 0.185, R.range(-0.025, 0.025), -0.025 + R.range(-0.006, 0.006), z + 0.1, 0, R.range(-0.006, 0.006), 0, { color: [k, k * 0.98, k * 0.95], vo: R() * 4 });
  }
  for (const x of [-hw + 0.15, 0, hw - 0.15]) b.box('woodLight', 0.12, 0.2, L, x, -0.15, L / 2, 0, 0, 0, { color: [0.62, 0.58, 0.54] });
  for (const s of [-1, 1]) b.box('woodLight', 0.06, 0.18, L, s * (hw + 0.03), -0.1, L / 2, 0, 0, 0, { color: [0.7, 0.66, 0.6] });
  // bents: cap beam, posts, X-bracing
  const nB = Math.max(2, Math.round((L - 0.5) / 2.4) + 1);
  for (let i = 0; i < nB; i++) {
    const z = 0.25 + (L - 0.5) * i / (nB - 1), last = i === nB - 1;
    b.box('woodLight', DW + 0.34, 0.2, 0.18, 0, -0.35, z, 0, 0, 0, { color: [0.6, 0.56, 0.52] });
    for (const s of [-1, 1]) {
      const x = s * (hw + 0.1);
      const topY = last ? 0.55 : -0.25;
      b.cyl('woodLight', 0.12, 0.12, topY - water, 8, x, (topY + water) / 2, z, 0, 0, 0, { color: DRY, swap: true });
      b.cyl('woodLight', 0.12, 0.13, water - bottom, 8, x, (water + bottom) / 2, z, 0, 0, 0, { color: WET, swap: true });
      if (last) b.cyl('woodLight', 0.135, 0.135, 0.05, 8, x, topY + 0.02, z, 0, 0, 0, { color: [0.5, 0.47, 0.44] });
    }
    for (const s of [-1, 1]) b.beam('woodLight', [s * (hw + 0.02), -0.48, z + 0.13], [-s * (hw + 0.02), -2.3, z + 0.13], 0.07, 0.14, { color: WET });
  }
  // stone abutment at the shore
  b.box('stone', DW + 0.9, 1.9, 1.3, 0, -1.0, -0.5, 0, 0, 0, { color: [0.72, 0.72, 0.7] });
  // cleats
  for (const f of [0.35, 0.7]) for (const s of [-1, 1]) {
    const z = L * f;
    b.box('metal', 0.08, 0.05, 0.12, s * (hw - 0.06), 0.025, z, 0, 0, 0, { color: lin(0x3a3d40) });
    b.box('metal', 0.06, 0.04, 0.32, s * (hw - 0.06), 0.07, z, 0, 0, 0, { color: lin(0x3a3d40) });
  }
  // coiled rope
  for (const [r, y] of [[0.24, 0.03], [0.17, 0.07]]) b.add('paint', new THREE.TorusGeometry(r, 0.032, 5, 16), M(hw - 0.45, y, L - 1.7, PI / 2, 0, 0), { color: lin(0xc9b48a) });
  b.rod('paint', [hw - 0.21, 0.03, L - 1.7], [hw + 0.1, 0.4, L - 0.25], 0.025, 0.025, 5, { color: lin(0xc9b48a) });
  // swimming ladder (stainless) on the +x side near the end
  {
    const lx = hw + 0.08, lz = L - 1.5;
    for (const dz of [-0.24, 0.24]) {
      b.rod('metal', [lx, -1.9, lz + dz], [lx, 0.72, lz + dz], 0.022, 0.022, 6, { color: STEEL });
      b.rod('metal', [lx, 0.72, lz + dz], [hw - 0.3, 0.72, lz + dz], 0.022, 0.022, 6, { color: STEEL });
      b.rod('metal', [hw - 0.3, 0.72, lz + dz], [hw - 0.3, 0.0, lz + dz], 0.022, 0.022, 6, { color: STEEL });
    }
    for (let y = -1.7; y < -0.1; y += 0.3) b.box('metal', 0.07, 0.03, 0.5, lx, y, lz, 0, 0, 0, { color: STEEL });
  }
  // bench at the end looking out over the water
  addBench(b, 0, L - 0.6, 0, 'woodLight', [0.85, 0.78, 0.7]);
  // life ring on a post
  {
    const pz = L * 0.55, px = -hw + 0.1, cy = 0.85;
    b.box('woodLight', 0.1, 1.3, 0.1, px, 0.6, pz, 0, 0, 0, { color: DRY });
    b.box('woodLight', 0.04, 0.5, 0.42, px - 0.07, 1.05, pz, 0, 0, 0, { color: [0.95, 0.92, 0.88] });
    const RED = lin(0xd42a1e), WHT = lin(0xf3f1ec);
    b.add('paint', new THREE.TorusGeometry(0.31, 0.07, 8, 24), M(px - 0.17, cy, pz, 0, PI / 2, 0), {
      colorFn: (p) => { const a = Math.atan2(p.y - cy, p.z - pz) + PI / 4 + 2 * PI; return Math.floor(a / (PI / 2)) % 2 ? RED : WHT; },
    });
  }
  const g = b.build(new THREE.Group());
  g.name = 'Dock';
  g.userData = { kind: 'dock', length: L, width: DW, waterY: water, moorZ: L - 1.0 };
  return g;
}

/* ===================================== cow ==================================== */
// Simmental / Fleckvieh. Faces +Z, origin on the ground between the hooves.
export function createCow(seed = 0) {
  const R = makeRng(seed * 31 + 11);
  const RED = lin(R.pick([0x8e4a22, 0x9a5426, 0x7e3d1c, 0xa35c2c, 0x8a4524])), WH = lin(0xefe9dc);
  const PINK = lin(0xd9ae9e), HOOF = lin(0x2a2420), HORN = lin(0xe6dcc0), DARK = lin(0x151210), LEATHER = lin(0x4a2b16);
  const thr = R.range(0.42, 0.52), so = R() * 100;
  const coat = (p) => {
    let n = fbm3(p.x * 2.0 + so, p.y * 2.0, p.z * 2.0 - so, 3) + 0.08;
    n -= Math.max(0, 0.86 - p.y) * 1.2;
    n -= Math.max(0, p.z - 0.85) * 0.7;
    return mixC(WH, RED, smooth(thr - 0.03, thr + 0.03, n));
  };
  const box = (v) => {
    v.x = Math.sign(v.x) * Math.pow(Math.abs(v.x), 0.8);
    v.y = Math.sign(v.y) * Math.pow(Math.abs(v.y), 0.88);
    v.z = Math.sign(v.z) * Math.pow(Math.abs(v.z), 0.7);
  };
  const group = new THREE.Group(); group.name = 'Cow';
  // ---- body (static)
  const b = new Builder(), cc = { colorFn: coat };
  b.ellip('fur', 0.33, 0.41, 0.94, 0, 1.03, -0.06, 0, 0, 0, cc, 22, 14, box);
  b.ellip('fur', 0.27, 0.33, 0.4, 0, 1.13, 0.48, 0, 0, 0, cc, 14, 10);
  b.ellip('fur', 0.3, 0.31, 0.44, 0, 1.12, -0.6, 0, 0, 0, cc, 14, 10);
  b.ellip('fur', 0.22, 0.28, 0.24, 0, 0.9, 0.72, 0, 0, 0, cc, 10, 8);
  b.ellip('fur', 0.075, 0.06, 0.16, 0, 1.36, -0.94, 0, 0, 0, cc, 8, 6);
  for (const s of [-1, 1]) {
    // front leg
    b.ellip('fur', 0.11, 0.26, 0.15, s * 0.19, 0.98, 0.58, 0, 0, 0, cc, 10, 8);
    b.rod('fur', [s * 0.19, 0.95, 0.6], [s * 0.19, 0.43, 0.61], 0.095, 0.068, 8, cc);
    b.ellip('fur', 0.07, 0.068, 0.072, s * 0.19, 0.43, 0.61, 0, 0, 0, cc, 8, 6);
    b.rod('fur', [s * 0.19, 0.43, 0.61], [s * 0.19, 0.09, 0.62], 0.052, 0.048, 8, cc);
    b.ellip('fur', 0.056, 0.052, 0.058, s * 0.19, 0.1, 0.625, 0, 0, 0, cc, 8, 6);
    b.cyl('fur', 0.054, 0.066, 0.09, 8, s * 0.19, 0.045, 0.635, 0, 0, 0, { color: HOOF });
    // hind leg
    b.ellip('fur', 0.14, 0.32, 0.25, s * 0.2, 0.93, -0.66, 0, 0, 0, cc, 10, 8);
    b.rod('fur', [s * 0.2, 0.8, -0.66], [s * 0.2, 0.47, -0.79], 0.09, 0.062, 8, cc);
    b.ellip('fur', 0.064, 0.068, 0.075, s * 0.2, 0.47, -0.79, 0, 0, 0, cc, 8, 6);
    b.rod('fur', [s * 0.2, 0.47, -0.79], [s * 0.2, 0.09, -0.72], 0.052, 0.048, 8, cc);
    b.ellip('fur', 0.056, 0.052, 0.058, s * 0.2, 0.1, -0.715, 0, 0, 0, cc, 8, 6);
    b.cyl('fur', 0.054, 0.066, 0.09, 8, s * 0.2, 0.045, -0.705, 0, 0, 0, { color: HOOF });
  }
  b.ellip('fur', 0.15, 0.12, 0.17, 0, 0.64, -0.45, 0, 0, 0, { color: PINK }, 10, 8);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl('fur', 0.016, 0.02, 0.09, 5, sx * 0.055, 0.5, -0.45 + sz * 0.07, 0, 0, 0, { color: PINK });
  b.build(group);

  // ---- head + neck (pivot at the base of the neck)
  const PIV = new THREE.Vector3(0, 1.12, 0.66);
  const headPivot = new THREE.Group(); headPivot.position.copy(PIV); group.add(headPivot);
  const neckCoat = (p) => coat({ x: p.x, y: p.y + PIV.y, z: p.z + PIV.z });
  const h = new Builder();
  h.ellip('fur', 0.18, 0.25, 0.42, 0, 0.04, 0.26, -0.32, 0, 0, { colorFn: neckCoat }, 14, 10);
  h.ellip('fur', 0.07, 0.2, 0.3, 0, -0.17, 0.3, -0.2, 0, 0, { colorFn: neckCoat }, 8, 6);
  const HF = M(0, 0.18, 0.68, 0.6, 0, 0);
  h.push(HF);
  h.ellip('fur', 0.135, 0.125, 0.15, 0, 0.01, 0.06, 0, 0, 0, { color: WH }, 12, 8);
  h.ellip('fur', 0.1, 0.09, 0.25, 0, -0.015, 0.27, 0, 0, 0, { color: WH }, 12, 8);
  h.ellip('fur', 0.11, 0.08, 0.15, 0, -0.07, 0.16, 0, 0, 0, { color: WH }, 10, 6);
  h.ellip('fur', 0.1, 0.08, 0.085, 0, -0.04, 0.48, 0, 0, 0, { color: PINK }, 10, 8);
  h.ellip('fur', 0.09, 0.055, 0.07, 0, 0.11, 0.0, 0, 0, 0, { color: lin(0xeadcc0) }, 8, 6);
  const patches = R() < 0.5;
  for (const s of [-1, 1]) {
    h.ellip('fur', 0.022, 0.02, 0.014, s * 0.04, -0.01, 0.56, 0, 0, 0, { color: DARK }, 6, 4);
    h.ellip('fur', 0.026, 0.026, 0.026, s * 0.118, 0.045, 0.1, 0, 0, 0, { color: DARK }, 8, 6);
    if (patches) h.ellip('fur', 0.03, 0.058, 0.072, s * 0.105, 0.035, 0.1, 0, 0, 0, { color: RED }, 8, 6);
    h.rod('paint', [s * 0.08, 0.1, 0.0], [s * 0.145, 0.125, 0.02], 0.032, 0.026, 6, { color: HORN });
    h.rod('paint', [s * 0.145, 0.125, 0.02], [s * 0.175, 0.17, 0.065], 0.026, 0.016, 6, { color: HORN });
    h.rod('paint', [s * 0.175, 0.17, 0.065], [s * 0.165, 0.205, 0.1], 0.016, 0.005, 5, { color: lin(0x4a4034) });
  }
  h.pop();
  // leather bell strap around the neck
  h.add('paint', new THREE.CylinderGeometry(1, 1, 0.09, 16, 1, true), M(0, 0.0, 0.2, PI / 2 - 0.32, 0, 0, 0.215, 1, 0.285), { color: LEATHER });
  h.build(headPivot);

  // bell (kept hanging under gravity in update)
  const bell = new THREE.Group(); bell.position.set(0, -0.27, 0.3); headPivot.add(bell);
  const bb = new Builder(), BRASS = lin(0xc49a3a);
  bb.add('metal', new THREE.TorusGeometry(0.035, 0.012, 5, 10), M(0, -0.015, 0, 0, PI / 2, 0), { color: LEATHER });
  bb.ellip('metal', 0.08, 0.05, 0.065, 0, -0.06, 0, 0, 0, 0, { color: BRASS }, 10, 6);
  bb.add('metal', new THREE.CylinderGeometry(0.08, 0.125, 0.22, 12, 1, true), M(0, -0.16, 0, 0, 0, 0, 1, 1, 0.8), { color: BRASS });
  bb.add('metal', new THREE.CircleGeometry(0.122, 12), M(0, -0.268, 0, PI / 2, 0, 0, 1, 0.8, 1), { color: lin(0x1c1712) });
  bb.blob('metal', 0.03, 0, -0.24, 0, 1, 1, 1, { color: lin(0x6a5a3a) });
  bb.build(bell);

  // ears (flick)
  const ears = [];
  for (const s of [-1, 1]) {
    const pv = new THREE.Group();
    pv.position.set(s * 0.13, 0.07, 0.04).applyMatrix4(HF);
    pv.quaternion.setFromRotationMatrix(HF);
    headPivot.add(pv);
    const e = new THREE.Group(); pv.add(e);
    const eb = new Builder(), earC = patches || R() < 0.6 ? RED : WH;
    eb.ellip('fur', 0.11, 0.028, 0.065, s * 0.1, -0.01, 0, 0, 0, s * -0.3, { colorFn: (p) => (p.y > -0.03 ? earC : PINK) }, 10, 6);
    eb.build(e);
    ears.push({ e, s, next: R.range(0.5, 5), t0: -10 });
  }
  // tail
  const tail = new THREE.Group(); tail.position.set(0, 1.36, -1.04); group.add(tail);
  const tb = new Builder();
  tb.rod('fur', [0, 0, 0], [0, -0.74, -0.05], 0.032, 0.02, 6, { colorFn: (p) => coat({ x: p.x, y: p.y + 1.36, z: p.z - 1.04 }) });
  tb.ellip('fur', 0.055, 0.14, 0.055, 0, -0.82, -0.05, 0, 0, 0, { color: lin(0xf1e9d8) }, 8, 6);
  tb.build(tail);

  // ---- animation
  const st = { mode: R() < 0.7 ? 'graze' : 'up', t: R.range(0, 5), dur: R.range(6, 14), pitch: 0.6, yaw: 0, ph: R() * 20 };
  function update(dt, time) {
    dt = Math.min(dt || 0, 0.1);
    st.t += dt;
    if (st.t > st.dur) {
      st.t = 0;
      if (st.mode === 'graze') { st.mode = 'up'; st.dur = R.range(3, 7); } else { st.mode = 'graze'; st.dur = R.range(7, 16); }
    }
    let tp, ty, roll;
    if (st.mode === 'graze') {
      tp = 1.12 + 0.05 * Math.sin(time * 5.3 + st.ph) * (Math.sin(time * 0.7 + st.ph) > 0 ? 1 : 0.3);
      ty = 0.26 * Math.sin(time * 0.31 + st.ph);
      roll = 0.01 * Math.sin(time * 6);
    } else {
      tp = 0.04 + 0.025 * Math.sin(time * 8.2);
      ty = 0.35 * Math.sin(time * 0.23 + st.ph * 2);
      roll = 0.03 * Math.sin(time * 7.6);
    }
    const k = 1 - Math.exp(-dt * 2.2);
    st.pitch += (tp - st.pitch) * k; st.yaw += (ty - st.yaw) * k;
    headPivot.rotation.set(st.pitch, st.yaw, roll, 'YXZ');
    bell.rotation.set(-st.pitch + 0.07 * Math.sin(time * 2.6 + st.ph), 0, -roll);
    for (const o of ears) {
      if (time > o.next) { o.t0 = time; o.next = time + R.range(1.5, 6.5); }
      const f = (time - o.t0) / 0.32, a = f >= 0 && f < 1 ? Math.sin(f * PI) : 0;
      o.e.rotation.set(0.5 * a, o.s * 0.35 * a, o.s * 0.45 * a);
    }
    const env = 0.25 + 0.75 * Math.pow(Math.max(0, Math.sin(time * 0.43 + st.ph)), 2);
    tail.rotation.set(0.1 + 0.07 * Math.sin(time * 1.3 + st.ph) * env, 0, Math.sin(time * 2.4 + st.ph) * 0.42 * env);
  }
  update(0, R() * 10);
  group.userData = { kind: 'cow', seed, height: 1.48, length: 2.6 };
  return { object: group, update };
}

/* ==================================== fence =================================== */
// Swiss "Schrägzaun": pairs of round posts with leaning split rails, willow ties.
export function createFence(length = 6) {
  const L = Math.max(0.5, length);
  const R = makeRng(Math.round(L * 100) + 17);
  const b = new Builder();
  const nP = Math.max(1, Math.round(L / 2.4)), sp = L / nP;
  const WILLOW = [0.42, 0.36, 0.3];
  for (let i = 0; i <= nP; i++) {
    const z = i * sp, lean = (R() - 0.5) * 0.06;
    for (const s of [-1, 1]) b.cyl('woodLight', 0.04, 0.05, 1.42, 6, s * 0.055, 0.49, z, lean, 0, s * 0.02, { color: jit([0.85, 0.8, 0.75], R, 0.1), swap: true });
    for (const y of [0.32, 0.88]) b.add('woodLight', new THREE.TorusGeometry(0.1, 0.018, 3, 7), M(0, y, z, PI / 2, 0, 0, 1.12, 0.7, 1), { color: WILLOW });
  }
  const a = 0.6, tA = Math.tan(a), yMid = 0.58, yLo = 0.1, yHi = 1.08;
  for (let zc = -2; zc < L + 2; zc += 0.3) {
    let z0 = zc - (yMid - yLo) / tA, z1 = zc + (yHi - yMid) / tA;
    z0 = Math.max(z0, 0.02); z1 = Math.min(z1, L - 0.02);
    if (z1 - z0 < 0.3) continue;
    const y0 = yMid + (z0 - zc) * tA, y1 = yMid + (z1 - zc) * tA, x = (R() - 0.5) * 0.025;
    b.beam('woodLight', [x, y0, z0], [x, y1, z1], 0.045, 0.075, { color: jit([1, 0.96, 0.92], R, 0.12), uo: R() * 4 });
  }
  const g = b.build(new THREE.Group());
  g.name = 'Fence';
  g.userData = { kind: 'fence', length: L };
  return g;
}

/* =================================== flag pole ================================ */
function flagMaterial(type) {
  const key = 'flag_' + type;
  let m = _mats.get(key);
  if (m) return m;
  const tex = canvasTexture(key, 256, 256, (g, S) => {
    if (type === 'canton') {
      g.fillStyle = '#d52b1e'; g.fillRect(0, 0, S, S);
      g.fillStyle = '#f2c200';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(S * 0.34, 0); g.lineTo(S, S * 0.66); g.lineTo(S, S); g.lineTo(S * 0.66, S); g.lineTo(0, S * 0.34); g.closePath(); g.fill();
      g.save(); g.translate(S * 0.52, S * 0.5); g.rotate(PI / 4);
      g.fillStyle = '#151210';
      g.beginPath(); g.ellipse(0, 0, 44, 20, 0, 0, 2 * PI); g.fill();
      g.beginPath(); g.ellipse(-46, -12, 16, 13, -0.3, 0, 2 * PI); g.fill();
      g.beginPath(); g.ellipse(-60, -8, 9, 6, -0.2, 0, 2 * PI); g.fill();
      circle(g, -44, -25, 5, '#151210');
      for (const [lx, ly, ang] of [[-26, 14, 0.25], [-14, 16, -0.15], [22, 14, 0.2], [34, 12, -0.25]]) { g.save(); g.translate(lx, ly); g.rotate(ang); g.fillRect(-5, 0, 10, 22); g.restore(); }
      g.beginPath(); g.moveTo(40, -6); g.quadraticCurveTo(58, -18, 56, -2); g.lineWidth = 4; g.strokeStyle = '#151210'; g.stroke();
      g.fillStyle = '#d52b1e'; g.fillRect(-68, -4, 8, 3);
      circle(g, -48, -15, 2, '#f2c200');
      g.restore();
    } else {
      g.fillStyle = '#da291c'; g.fillRect(0, 0, S, S);
      g.fillStyle = '#ffffff';
      const a = S * 6 / 32, l = S * 20 / 32;
      g.fillRect((S - a) / 2, (S - l) / 2, a, l); g.fillRect((S - l) / 2, (S - a) / 2, l, a);
    }
  }, true);
  m = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.85 });
  m.name = 'village_' + key;
  _mats.set(key, m);
  return m;
}

// Flag flies towards +X (wind from -X). Returns { object, update(dt, time) }.
export function createFlagPole(type = 'swiss') {
  const group = new THREE.Group(); group.name = 'FlagPole';
  const b = new Builder(), H = 7;
  b.box('stone', 0.6, 0.5, 0.6, 0, -0.1, 0, 0, 0, 0, { color: [1.15, 1.15, 1.12] });
  b.cyl('paint', 0.045, 0.07, H, 10, 0, H / 2, 0, 0, 0, 0, { color: lin(0xf2f2ee) });
  b.blob('metal', 0.09, 0, H + 0.07, 0, 1, 1, 1, { color: lin(0xd8aa3e) }, 0, 0, 0, 1);
  b.rod('paint', [0.07, 1.1, 0.0], [0.07, H - 0.05, 0.0], 0.006, 0.006, 4, { color: lin(0xdddddd) });
  b.box('metal', 0.03, 0.12, 0.05, 0.075, 1.1, 0, 0, 0, 0, { color: lin(0x777777) });
  b.build(group);
  const FS = 1.5;
  const geo = new THREE.PlaneGeometry(FS, FS, 15, 10);
  geo.translate(FS / 2, 0, 0);
  const base = geo.attributes.position.array.slice();
  const flag = new THREE.Mesh(geo, flagMaterial(type === 'canton' ? 'canton' : 'swiss'));
  flag.position.set(0.06, H - 0.1 - FS / 2, 0);
  flag.castShadow = true; flag.receiveShadow = true;
  group.add(flag);
  const pos = geo.attributes.position;
  const ph = Math.random() * 10;
  function update(dt, time) {
    const t = time + ph;
    for (let i = 0; i < pos.count; i++) {
      const x0 = base[i * 3], y0 = base[i * 3 + 1], u = x0 / FS;
      const w = Math.sin(u * 5.2 - t * 6.2 + y0 * 0.9) * 0.15 * u + Math.sin(u * 11 - t * 10.5 + y0 * 2.1) * 0.04 * u;
      pos.setXYZ(i, x0 - Math.abs(w) * 0.25 * u, y0 - u * u * 0.08 + Math.sin(u * 3 - t * 4) * 0.02 * u, w);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }
  update(0, 0);
  group.userData = { kind: 'flagpole', type, height: H };
  return { object: group, update };
}

/* ================================ hay bale / bench ============================ */
// seed % 3: 0 = round straw bale, 1 = plastic-wrapped silage bale, 2 = loose hay pile.
export function createHayBale(seed = 0) {
  const R = makeRng(seed * 17 + 9);
  const kind = Math.abs(Math.round(seed)) % 3;
  const b = new Builder();
  const ry = R() * PI;
  if (kind === 2) {
    const so = R() * 50;
    b.ellip('hay', R.range(1.0, 1.3), R.range(0.75, 0.95), R.range(0.9, 1.2), 0, 0, 0, 0, ry, 0, { color: jit(WHITE, R, 0.08) }, 16, 10, (v) => {
      const n = 1 + 0.16 * (vnoise3(v.x * 2.5 + so, v.y * 2.5, v.z * 2.5, 9) - 0.5);
      v.multiplyScalar(n);
      if (v.y < -0.12) v.y = -0.12;
    });
    for (let i = 0; i < 6; i++) {
      const a = R() * 2 * PI, d = R.range(0.9, 1.4);
      b.ellip('hay', R.range(0.2, 0.4), 0.08, R.range(0.15, 0.3), Math.cos(a) * d, 0.02, Math.sin(a) * d, 0, a, 0, { color: jit(WHITE, R, 0.1) }, 8, 5);
    }
  } else {
    const r = 0.66, len = 1.2;
    b.push(M(0, 0, 0, 0, ry, 0));
    if (kind === 0) {
      b.add('hay', new THREE.CylinderGeometry(r, r, len, 24, 1, true), M(0, r * 0.94, 0, 0, 0, PI / 2, 0.94, 1, 1), { uv: 'keep', us: (2 * PI * r) / 1.4, vs: len / 1.4 });
      for (const s of [-1, 1]) b.quad('atlas', 2 * r, 2 * r * 0.94, AR.bale, s * len / 2, r * 0.94, 0, 0, s * PI / 2, 0);
    } else {
      const c = R.pick([lin(0xeef1ea), lin(0xa6c48e), lin(0x2a2c2a)]);
      b.add('plastic', new THREE.CylinderGeometry(r + 0.02, r + 0.02, len, 24, 1), M(0, (r + 0.02) * 0.94, 0, 0, 0, PI / 2, 0.94, 1, 1), { color: c });
    }
    b.pop();
  }
  const g = b.build(new THREE.Group());
  g.name = 'HayBale';
  g.userData = { kind: 'haybale', type: ['round', 'wrapped', 'pile'][kind] };
  return g;
}

export function createBench() {
  const b = new Builder();
  addBench(b, 0, 0, 0, 'wood', [1, 0.95, 0.9]);
  const g = b.build(new THREE.Group());
  g.name = 'Bench';
  g.userData = { kind: 'bench' };
  return g;
}

/* =========================== introspection (tests/preview) ==================== */
export function modelStats(object) {
  let tris = 0, calls = 0;
  object.traverse((o) => {
    if (!o.isMesh) return;
    calls++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return { tris: Math.round(tris), calls };
}
