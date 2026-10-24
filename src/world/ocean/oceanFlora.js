// Island vegetation and sea-floor life, all procedural and instanced:
//   umbrella (stone) pines and palms built from alpha cards on a painted atlas, Mediterranean cypresses,
//   maquis bushes, coral heads on the reef, and boulders along rocky shores and the breakwater.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Simplex2, mulberry32, smoothstep } from '../../util/noise.js';
import { NEAR } from './oceanTerrain.js';
import { PLACES, moleDist } from './islandShape.js';
import { withUnderwater } from './oceanShading.js';

// ---------------------------------------------------------------- atlas (1024 x 512, row 0 = top)
const AW = 1024, AH = 512;
const PINE = { x: 0, y: 0, w: 448, h: 448 };
const BARK = { x: 456, y: 0, w: 48, h: 240 };
const PBARK = { x: 456, y: 256, w: 48, h: 250 };
const FROND = { x: 512, y: 0, w: 512, h: 512 };
const uvOf = (R, u, v) => [(R.x + 2 + u * (R.w - 4)) / AW, (R.y + 2 + v * (R.h - 4)) / AH];

function paintAtlas() {
  const c = document.createElement('canvas');
  c.width = AW; c.height = AH;
  const g = c.getContext('2d');
  const rnd = mulberry32(17);
  g.lineCap = 'round';
  // --- stone-pine needle clump: dense dark core, long paired needles radiating out
  {
    const cx = PINE.x + PINE.w / 2, cy = PINE.y + PINE.h / 2, R = PINE.w / 2 - 8;
    const tones = ['#1d3420', '#24402a', '#2e4d2f', '#3a5c34', '#4b6c3c', '#5f7d45'];
    g.fillStyle = '#1b2f1d';
    g.beginPath(); g.arc(cx, cy, R * 0.42, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 95; i++) {
      const a = rnd() * Math.PI * 2, r0 = rnd() * R * 0.35, len = R * (0.45 + rnd() * 0.5);
      const x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0;
      const bend = (rnd() - 0.5) * 0.5;
      g.strokeStyle = '#3d2b1e'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(x0, y0);
      const x1 = x0 + Math.cos(a + bend * 0.5) * len * 0.8, y1 = y0 + Math.sin(a + bend * 0.5) * len * 0.8;
      g.lineTo(x1, y1); g.stroke();
      // needles along the twig, in fans
      for (let k = 0; k < 9; k++) {
        const t = 0.2 + k / 9 * 0.8;
        const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
        const shade = Math.min(tones.length - 1, Math.floor((t * 0.6 + rnd() * 0.6) * tones.length));
        g.strokeStyle = tones[shade]; g.lineWidth = 1.6;
        g.beginPath();
        for (let n = 0; n < 7; n++) {
          const na = a + bend + (rnd() - 0.5) * 1.8, nl = 18 + rnd() * 22;
          const ex = px + Math.cos(na) * nl, ey = py + Math.sin(na) * nl;
          if (Math.hypot(ex - cx, ey - cy) > R) continue;
          g.moveTo(px, py); g.lineTo(ex, ey);
        }
        g.stroke();
      }
    }
  }
  // --- bark strips
  {
    g.fillStyle = '#5a4030'; g.fillRect(BARK.x, BARK.y, BARK.w, BARK.h);
    for (let i = 0; i < 160; i++) {
      const v = 60 + rnd() * 70 | 0;
      g.fillStyle = `rgba(${v + 30},${v},${v * 0.75 | 0},0.7)`;
      g.fillRect(BARK.x + rnd() * BARK.w, BARK.y + rnd() * BARK.h, 3 + rnd() * 8, 4 + rnd() * 10);
    }
    g.fillStyle = '#7a6a55'; g.fillRect(PBARK.x, PBARK.y, PBARK.w, PBARK.h);
    for (let r = 0; r < 26; r++) {
      const y = PBARK.y + r * PBARK.h / 26;
      g.fillStyle = 'rgba(60,48,36,0.85)'; g.fillRect(PBARK.x, y, PBARK.w, 3);
      g.fillStyle = 'rgba(150,135,110,0.5)'; g.fillRect(PBARK.x, y + 3, PBARK.w, 2);
    }
  }
  // --- palm frond: rachis left -> right, leaflets angled toward the tip on both sides
  {
    const x0 = FROND.x + 6, x1 = FROND.x + FROND.w - 6, cy = FROND.y + FROND.h / 2;
    const L = x1 - x0;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 70; i++) {
        const t = 0.04 + i / 70 * 0.95;
        const px = x0 + t * L, py = cy;
        const len = (FROND.h / 2 - 10) * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.7) * (0.85 + rnd() * 0.15);
        const ang = side * (1.05 - 0.45 * t) + (rnd() - 0.5) * 0.08;      // angle from the rachis
        const ex = px + Math.cos(ang) * len * 0.55, ey = py + Math.sin(ang) * len;
        const w = 5 + 4 * (1 - t);
        const grd = g.createLinearGradient(px, py, ex, ey);
        grd.addColorStop(0, '#3f6a2a'); grd.addColorStop(0.7, '#5f8a35'); grd.addColorStop(1, '#a9a85a');
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(px - w * 0.3, py);
        g.quadraticCurveTo((px + ex) / 2 + side * w, (py + ey) / 2, ex, ey);
        g.quadraticCurveTo((px + ex) / 2 - side * w * 0.2, (py + ey) / 2, px + w * 0.6, py);
        g.fill();
      }
    }
    g.strokeStyle = '#8a8a4a'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(x0, cy); g.lineTo(x1, cy); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ---------------------------------------------------------------- geometry helpers
class Geo {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
  v(p, n, uv, c) { this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.u.push(uv[0], uv[1]); this.c.push(c[0], c[1], c[2]); return this.p.length / 3 - 1; }
  quad(a, b, c, d) { this.i.push(a, b, c, b, d, c); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// tube along points with radii, 'sides' around; region R mapped u around, v along
function tube(M, pts, radii, sides, R, colorAt) {
  const up = V3(0, 1, 0), tmp = V3(0, 0, 0);
  const rings = [];
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const d = (k < pts.length - 1 ? pts[k + 1].clone().sub(p) : p.clone().sub(pts[k - 1])).normalize();
    let side = tmp.crossVectors(d, Math.abs(d.y) > 0.95 ? V3(1, 0, 0) : up).normalize().clone();
    const bin = V3(0, 0, 0).crossVectors(side, d).normalize();
    const ring = [];
    for (let s = 0; s <= sides; s++) {
      const a = s / sides * Math.PI * 2;
      const n = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
      const c = colorAt(k / (pts.length - 1));
      ring.push(M.v(p.clone().addScaledVector(n, radii[k]), n, uvOf(R, s / sides, k / (pts.length - 1)), c));
    }
    rings.push(ring);
  }
  for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < sides; s++) M.quad(rings[k][s], rings[k][s + 1], rings[k + 1][s], rings[k + 1][s + 1]);
}

// Stone pine, unit height: crooked bare trunk, a few limbs and a flat umbrella crown of needle cards.
function pineGeometry(seed) {
  const rnd = mulberry32(seed * 31 + 7);
  const M = new Geo();
  const lx = (rnd() - 0.5) * 0.16, lz = (rnd() - 0.5) * 0.16, topY = 0.56 + rnd() * 0.08;
  const pts = [];
  for (let k = 0; k <= 5; k++) {
    const t = k / 5;
    pts.push(V3(lx * t * t * 1.4 + Math.sin(t * 5 + seed) * 0.008, t * topY, lz * t * t * 1.4 + Math.cos(t * 4 + seed) * 0.008));
  }
  const barkC = (t) => { const k = 0.55 + 0.4 * t; return [k, k * 0.95, k * 0.9]; };
  tube(M, pts, [0.03, 0.026, 0.022, 0.019, 0.016, 0.014], 6, BARK, barkC);
  const top = pts[5];
  const C = top.clone().add(V3(0, 0.17, 0));
  const R = 0.36 + rnd() * 0.1;
  const nL = 3 + (rnd() * 2 | 0);
  for (let b = 0; b < nL; b++) {
    const a = (b / nL) * Math.PI * 2 + rnd() * 0.8, r = R * (0.35 + rnd() * 0.3);
    const s = top.clone().add(V3(0, -0.04, 0));
    const e = C.clone().add(V3(Math.cos(a) * r, -0.04 - rnd() * 0.04, Math.sin(a) * r));
    const m = s.clone().lerp(e, 0.5).add(V3(0, 0.03, 0));
    tube(M, [s, m, e], [0.012, 0.009, 0.005], 4, BARK, barkC);
  }
  // crown: clusters on a flat dome
  const n = V3(0, 0, 0), centerLow = C.clone().add(V3(0, -0.28, 0));
  const NC = 20 + (rnd() * 6 | 0);
  const card = (p, ax, ay, size, tiltOut) => {
    // horizontal-ish card around p, axes ax (unit, horizontal) and ay = perpendicular
    const out = V3(p.x - C.x, 0, p.z - C.z);
    const ol = out.length() || 1; out.multiplyScalar(1 / ol);
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    const ids = corners.map(([sx, sy]) => {
      const q = p.clone().addScaledVector(ax, sx * size).addScaledVector(ay, sy * size);
      q.y += (sx * ax.dot(out) + sy * ay.dot(out)) * size * tiltOut;
      n.copy(q).sub(centerLow).normalize(); n.y += 0.35; n.normalize();
      const rr = Math.min(1, Math.hypot(q.x - C.x, q.z - C.z) / R);
      const ao = (0.55 + 0.45 * rr) * (0.75 + 0.25 * smoothstep(C.y - 0.06, C.y + 0.08, q.y));
      return M.v(q, n, uvOf(PINE, (sx + 1) / 2, (sy + 1) / 2), [ao * 0.95, ao, ao * 0.9]);
    });
    M.quad(ids[0], ids[1], ids[2], ids[3]);
  };
  for (let i = 0; i < NC; i++) {
    const u = (i + rnd() * 0.5) / NC, a = i * 2.39996 + rnd() * 0.4;
    const r = R * Math.sqrt(u) * 0.92;
    const p = V3(C.x + Math.cos(a) * r, 0, C.z + Math.sin(a) * r);
    p.y = C.y + 0.07 * (1 - (r / R) ** 2) + (rnd() - 0.5) * 0.035 - 0.02;
    const size = 0.11 + rnd() * 0.06;
    const rot = rnd() * Math.PI;
    const ax = V3(Math.cos(rot), 0, Math.sin(rot)), ay = V3(-Math.sin(rot), 0, Math.cos(rot));
    card(p, ax, ay, size, 0.35);
    // two steep cards give the clump thickness from the side
    for (let k = 0; k < 2; k++) {
      const ra = rot + k * Math.PI / 2;
      const vx = V3(Math.cos(ra), 0, Math.sin(ra));
      const ids = [];
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const q = p.clone().addScaledVector(vx, sx * size * 0.95);
        q.y += sy * size * 0.42;
        n.copy(q).sub(centerLow).normalize(); n.y += 0.3; n.normalize();
        const ao = 0.6 + 0.3 * (sy + 1) / 2;
        ids.push(M.v(q, n, uvOf(PINE, (sx + 1) / 2, (sy + 1) / 2), [ao * 0.95, ao, ao * 0.9]));
      }
      M.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }
  return M.build();
}

// Palm, unit = trunk height: curved ringed trunk and ~16 arching pinnate fronds (folded strips).
function palmGeometry(seed) {
  const rnd = mulberry32(seed * 53 + 11);
  const M = new Geo();
  const la = rnd() * Math.PI * 2, lean = 0.1 + rnd() * 0.22;
  const pts = [], radii = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    pts.push(V3(Math.cos(la) * lean * Math.pow(t, 1.7), t, Math.sin(la) * lean * Math.pow(t, 1.7)));
    radii.push(0.034 + 0.03 * Math.pow(1 - t, 6) + 0.006 * smoothstep(0.85, 1, t));
  }
  tube(M, pts, radii, 8, PBARK, (t) => { const k = 0.7 + 0.3 * t; return [k, k * 0.97, k * 0.92]; });
  const T = pts[10];
  const n = V3(0, 0, 0);
  const NF = 15 + (rnd() * 4 | 0);
  const frond = (a, e, len, tint, droop) => {
    let dir = V3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
    const side = V3(-Math.sin(a), 0, Math.cos(a));
    let p = T.clone().add(V3(0, 0.01, 0));
    const SEG = 6, rows = [];
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const w = len * 0.24 * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * t)), 0.6) + 0.004;
      const up = V3(0, 0, 0).crossVectors(side, dir).normalize();
      if (up.y < 0) up.multiplyScalar(-1);
      const fold = w * (0.35 + 0.15 * droop);
      const L = p.clone().addScaledVector(side, w).addScaledVector(up, -fold);
      const Rr = p.clone().addScaledVector(side, -w).addScaledVector(up, -fold);
      n.copy(up).addScaledVector(V3(Math.cos(a), 0, Math.sin(a)), 0.4).normalize();
      const k = 0.8 + 0.2 * t;
      const col = [tint[0] * k, tint[1] * k, tint[2] * k];
      rows.push([M.v(L, n, uvOf(FROND, t, 0), col), M.v(p.clone(), n, uvOf(FROND, t, 0.5), col), M.v(Rr, n, uvOf(FROND, t, 1), col)]);
      // arch: gravity pulls the rachis down more toward the tip
      dir.y -= (0.16 + 0.12 * droop) * (0.4 + t);
      dir.normalize();
      p.addScaledVector(dir, len / SEG);
    }
    for (let s = 0; s < SEG; s++) {
      M.quad(rows[s][0], rows[s][1], rows[s + 1][0], rows[s + 1][1]);
      M.quad(rows[s][1], rows[s][2], rows[s + 1][1], rows[s + 1][2]);
    }
  };
  for (let i = 0; i < NF; i++) {
    const f = i / (NF - 1);
    const a = i * 2.39996 + rnd() * 0.3;
    const e = THREE.MathUtils.degToRad(62 - 85 * f + (rnd() - 0.5) * 14);
    const len = 0.44 + rnd() * 0.14 - 0.06 * (1 - f);
    const old = f > 0.8 && rnd() < 0.5;
    const tint = old ? [1.15, 1.0, 0.55] : [0.9 + rnd() * 0.15, 1.0, 0.85 + rnd() * 0.1];
    frond(a, e, len, tint, f);
  }
  // a skirt of dead, hanging fronds
  for (let i = 0; i < 3; i++) frond(rnd() * Math.PI * 2, THREE.MathUtils.degToRad(-70), 0.3, [0.85, 0.65, 0.4], 1.5);
  return M.build();
}

// Mediterranean cypress: a tall dark flame, solid, unit height
function cypressGeometry(seed) {
  const nz = new Simplex2(seed + 300);
  const g = new THREE.CylinderGeometry(1, 1, 1, 10, 14, false);
  g.translate(0, 0.5, 0);
  const pos = g.attributes.position, col = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const prof = 0.085 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(y, 0.72) * 1.0)), 0.85) + 0.003;
    const a = Math.atan2(z, x);
    const r = prof * (1 + 0.22 * nz.noise(a * 1.6, y * 9) + 0.08 * nz.noise(a * 5, y * 30));
    pos.setXYZ(i, Math.cos(a) * r * (x * x + z * z > 0.001 ? 1 : 0), y < 0.001 ? 0 : y, Math.sin(a) * r * (x * x + z * z > 0.001 ? 1 : 0));
    const k = 0.55 + 0.45 * y + 0.15 * nz.noise(a * 4, y * 20);
    col.push(0.09 * k, 0.15 * k, 0.07 * k);
  }
  g.deleteAttribute('uv');
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function bushGeometry(seed) {
  const nz = new Simplex2(seed + 500);
  let g = new THREE.IcosahedronGeometry(1, 2);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const pos = g.attributes.position, col = [];
  const v = V3(0, 0, 0);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = 1 + 0.28 * nz.noise(v.x * 1.7, v.y * 1.7 + v.z) + 0.12 * nz.noise(v.x * 4.5, v.z * 4.5);
    v.multiplyScalar(d); v.y = v.y * 0.62;
    if (v.y < -0.1) v.y = -0.1 - (v.y + 0.1) * 0.2;
    pos.setXYZ(i, v.x, v.y + 0.1, v.z);
    const k = 0.5 + 0.5 * smoothstep(-0.2, 0.6, v.y) + 0.12 * nz.noise(v.x * 6, v.z * 6);
    col.push(0.12 * k, 0.16 * k, 0.07 * k);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function boulderGeometry(seed, detail = 2) {
  const nz = new Simplex2(seed);
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const pos = g.attributes.position, v = V3(0, 0, 0);
  const sq = 0.55 + (seed % 4) * 0.12;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.multiplyScalar(1 + 0.25 * nz.fbm(v.x * 1.2, v.y * 1.2 + v.z * 0.8, 3) + 0.07 * nz.noise(v.x * 4, v.z * 4 + v.y * 2));
    v.y *= sq;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// coral heads, unit size, vertex colours white-ish (instance colour tints them)
function coralGeometry(kind, seed) {
  const rnd = mulberry32(seed);
  const parts = [];
  const colorize = (g, k = 1) => {
    const n = g.attributes.position.count, c = [];
    for (let i = 0; i < n; i++) { const y = g.attributes.position.getY(i); const s = (0.6 + 0.4 * Math.min(1, Math.max(0, y))) * k; c.push(s, s, s); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.deleteAttribute('uv');
    return g;
  };
  if (kind === 0) {           // brain / boulder coral
    const nz = new Simplex2(seed);
    let g = new THREE.IcosahedronGeometry(1, 2);
    g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g);
    const p = g.attributes.position, v = V3(0, 0, 0);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      v.multiplyScalar(1 + 0.08 * Math.sin(v.x * 9 + nz.noise(v.y * 3, v.z * 3) * 4) + 0.1 * nz.noise(v.x * 2, v.z * 2));
      v.y = Math.max(-0.25, v.y * 0.7);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    parts.push(colorize(g));
  } else if (kind === 1) {    // branching (staghorn)
    for (let b = 0; b < 9; b++) {
      const a = rnd() * Math.PI * 2, tilt = 0.25 + rnd() * 0.7, h = 0.6 + rnd() * 0.6;
      const g = new THREE.CylinderGeometry(0.03, 0.07, h, 5, 1);
      g.translate(0, h / 2, 0);
      g.rotateZ(tilt); g.rotateY(a);
      g.translate((rnd() - 0.5) * 0.4, -0.05, (rnd() - 0.5) * 0.4);
      parts.push(colorize(g));
      const tip = new THREE.CylinderGeometry(0.02, 0.04, h * 0.5, 4, 1);
      tip.translate(0, h * 0.25, 0); tip.rotateZ(tilt + 0.6 * (rnd() - 0.5)); tip.rotateY(a + 0.6);
      tip.translate(Math.cos(-a) * Math.sin(tilt) * h * 0.5, Math.cos(tilt) * h * 0.85, Math.sin(-a) * Math.sin(tilt) * h * 0.5);
      parts.push(colorize(tip, 1.15));
    }
  } else {                    // table coral on a stalk
    const top = new THREE.CylinderGeometry(1, 0.85, 0.12, 12, 1);
    top.translate(0, 0.45, 0);
    const stalk = new THREE.CylinderGeometry(0.12, 0.2, 0.45, 6, 1);
    stalk.translate(0, 0.22, 0);
    parts.push(colorize(top), colorize(stalk, 0.8));
  }
  const geos = parts.map(g => g.index ? g.toNonIndexed() : g);
  const out = mergeGeo(geos);
  out.computeVertexNormals();
  return out;
}

function mergeGeo(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), C = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    P.set(g.attributes.position.array, o * 3);
    if (g.attributes.color) C.set(g.attributes.color.array, o * 3); else C.fill(1, o * 3, (o + g.attributes.position.count) * 3);
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return g;
}

// ---------------------------------------------------------------- materials
const SWAY = (k) => `
  #ifdef USE_INSTANCING
    vec3 ip = instanceMatrix[3].xyz;
    float hh = max(transformed.y, 0.0);
    float sw = sin(uTime * 1.1 + ip.x * 0.05 + ip.z * 0.07) * 0.6 + sin(uTime * 2.3 + ip.x * 0.13) * 0.25;
    transformed.x += sw * ${k.toFixed(3)} * hh * hh;
    transformed.z += sw * ${(k * 0.5).toFixed(3)} * hh * hh;
  #endif`;

function foliageMaterial(atlas, sharedTime, key, swayK) {
  const m = new THREE.MeshStandardMaterial({
    map: atlas, vertexColors: true, alphaTest: 0.42, alphaToCoverage: true, side: THREE.DoubleSide,
    roughness: 0.85, metalness: 0, envMapIntensity: 0.8,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + SWAY(swayK));
    // leaves keep their soft crown normal on both faces, and are fairly matte
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <normal_fragment_begin>', `float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
        vec3 normal = normalize( vNormal );
        vec3 nonPerturbedNormal = normal;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directSpecular *= 0.3;
        reflectedLight.indirectSpecular *= 0.25;`);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

function seaRockMaterial(rockTex, waterU) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tRock = { value: rockTex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRP; varying vec3 vRN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 rp = vec4(transformed, 1.0);
        vec3 rn = objectNormal;
        #ifdef USE_INSTANCING
          rp = instanceMatrix * rp; rn = mat3(instanceMatrix) * rn;
        #endif
        vRP = (modelMatrix * rp).xyz; vRN = normalize(mat3(modelMatrix) * rn);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRP; varying vec3 vRN; uniform sampler2D tRock;')
      .replace('#include <map_fragment>', `
        vec3 bw = pow(abs(vRN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        vec3 rc = texture2D(tRock, vRP.zy * 0.3).rgb * bw.x + texture2D(tRock, vRP.xz * 0.3).rgb * bw.y + texture2D(tRock, vRP.xy * 0.3).rgb * bw.z;
        rc *= vec3(1.12, 1.05, 0.92) * 0.82;
        float hy = vRP.y;
        // tide line: dark wet band, green-brown weed and barnacles just around sea level
        float wet = 1.0 - smoothstep(0.2, 1.4, hy);
        rc *= mix(1.0, 0.5, wet);
        float weed = smoothstep(-1.6, -0.4, hy) * (1.0 - smoothstep(0.1, 0.7, hy));
        rc = mix(rc, vec3(0.12, 0.13, 0.06), weed * 0.6);
        diffuseColor.rgb *= rc;
        float rRough = mix(0.9, 0.35, wet * (1.0 - smoothstep(-0.5, -0.1, -hy)));`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rRough;');
  };
  return withUnderwater(m, waterU, 'ocean-searock', { caustics: true });
}

// ---------------------------------------------------------------- placement
export function createFlora(scene, ctx) {
  const { S, bake, time, layout, obstacles, shared, waterU } = ctx;
  const N = NEAR.n;
  const rnd = mulberry32(777);
  const dens = new Simplex2(4242);
  const atlas = paintAtlas();
  const excl = layout.exclusions || [];
  const blocked = (x, z, r = 0) => { for (const e of excl) if ((e.x - x) ** 2 + (e.z - z) ** 2 < (e.r + r) ** 2) return true; return false; };
  const splat = (x, z, ch) => {
    const i = Math.round((x - NEAR.x0) / NEAR.step), j = Math.round((z - NEAR.z0) / NEAR.step);
    if (i < 0 || j < 0 || i >= N || j >= N) return 0;
    return bake.splat[(j * N + i) * 4 + ch] / 255;
  };
  const slopeAt = (x, z) => {
    const e = 2;
    return Math.hypot(S.groundY(x + e, z) - S.groundY(x - e, z), S.groundY(x, z + e) - S.groundY(x, z - e)) / (2 * e);
  };
  const X0 = -1250, X1 = 900, Z0 = -800, Z1 = 820;
  const randPt = () => [X0 + rnd() * (X1 - X0), Z0 + rnd() * (Z1 - Z0)];

  const trees = [];
  // ---- stone pines on the hillsides, in woods and as scattered singles
  const pines = [];
  for (let t = 0; t < 60000 && pines.length < 1300; t++) {
    const [x, z] = randPt();
    const y = S.groundY(x, z);
    if (y < 5 || y > 170) continue;
    if (splat(x, z, 0) > 0.2 || splat(x, z, 2) > 0.4) continue;
    const sl = slopeAt(x, z);
    if (sl > 0.62) continue;
    const f = dens.fbm(x * 0.0045, z * 0.0045, 3);
    const p = smoothstep(-0.05, 0.3, f) * 0.85 + 0.04;
    if (rnd() > p * (1 - smoothstep(0.4, 0.62, sl) * 0.7)) continue;
    if (blocked(x, z, 3)) continue;
    const h = 7 + rnd() * 7;
    pines.push({ x, y: y - 0.2, z, h, w: 0.9 + rnd() * 0.35, rot: rnd() * 6.283, c: 0.85 + rnd() * 0.3 });
  }
  // ---- palms: harbour village, behind the beaches, a few along the shore
  const palms = [];
  for (let t = 0; t < 40000 && palms.length < 110; t++) {
    const [x, z] = randPt();
    const y = S.groundY(x, z);
    if (y < 1.3 || y > 16) continue;
    const sd = S.shoreDist(x, z);
    if (sd > -4 || sd < -140) continue;
    if (splat(x, z, 0) > 0.5) continue;
    const harb = Math.hypot(x - 620, z - 50) < 190, cove = Math.hypot(x - PLACES.cove.x, z - PLACES.cove.z) < 420;
    const p = harb ? 0.5 : cove ? 0.35 : 0.04;
    if (rnd() > p || blocked(x, z, 2) || slopeAt(x, z) > 0.4) continue;
    palms.push({ x, y: y - 0.15, z, h: 6 + rnd() * 6, w: 1, rot: rnd() * 6.283, c: 0.9 + rnd() * 0.2 });
  }
  // ---- cypresses: around the chapel and the village
  const cypress = [];
  for (let t = 0; t < 20000 && cypress.length < 60; t++) {
    const ch = layout.chapel || PLACES.chapel;
    const near = rnd() < 0.5 ? ch : { x: 560, z: 40 };
    const a = rnd() * 6.283, r = 10 + rnd() * (near === ch ? 45 : 110);
    const x = near.x + Math.cos(a) * r, z = near.z + Math.sin(a) * r;
    const y = S.groundY(x, z);
    if (y < 2 || splat(x, z, 0) > 0.2 || slopeAt(x, z) > 0.5 || blocked(x, z, 1.5)) continue;
    cypress.push({ x, y: y - 0.1, z, h: 8 + rnd() * 7, w: 1, rot: rnd() * 6.283, c: 0.85 + rnd() * 0.3 });
  }
  // ---- maquis bushes
  const bushes = [];
  for (let t = 0; t < 120000 && bushes.length < 4200; t++) {
    const [x, z] = randPt();
    const y = S.groundY(x, z);
    if (y < 2.2 || y > 190) continue;
    if (splat(x, z, 0) > 0.15 || splat(x, z, 2) > 0.5) continue;
    if (slopeAt(x, z) > 0.8) continue;
    const f = dens.fbm(x * 0.006 + 7, z * 0.006, 3);
    if (rnd() > smoothstep(-0.25, 0.35, f) * 0.9 + 0.08) continue;
    if (blocked(x, z, 1)) continue;
    const s = 0.6 + Math.pow(rnd(), 2) * 1.6;
    bushes.push({ x, y: y - 0.15 * s, z, h: s, w: 1 + rnd() * 0.5, rot: rnd() * 6.283, c: 0.8 + rnd() * 0.4 });
  }
  for (const t of [...pines, ...palms, ...cypress]) trees.push({ x: t.x, z: t.z });

  const foliage = foliageMaterial(atlas, time, 'ocean-pine-v1', 0.012);
  const palmMat = foliageMaterial(atlas, time, 'ocean-palm-v1', 0.03);
  const solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  solid.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', '#include <begin_vertex>' + SWAY(0.01));
  };
  solid.customProgramCacheKey = () => 'ocean-solid-sway';

  // near (shadow casting) / far split, refreshed as the camera moves
  const groups = [];
  const mkGroup = (list, geos, mat, opts = {}) => {
    const near = geos.map(g => { const m = new THREE.InstancedMesh(g, mat, list.length); m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); return m; });
    const far = geos.map(g => { const m = new THREE.InstancedMesh(g, mat, list.length); m.count = 0; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); return m; });
    groups.push({ list, near, far, shadowDist: opts.shadowDist ?? 140 });
  };
  mkGroup(pines, [pineGeometry(1), pineGeometry(2), pineGeometry(3), pineGeometry(4)], foliage);
  mkGroup(palms, [palmGeometry(1), palmGeometry(2), palmGeometry(3)], palmMat);
  mkGroup(cypress, [cypressGeometry(1), cypressGeometry(2)], solid);
  mkGroup(bushes, [bushGeometry(1), bushGeometry(2), bushGeometry(3)], solid, { shadowDist: 60 });

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pp = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const last = new THREE.Vector3(1e9, 0, 0);
  function refresh(cam) {
    if (cam.distanceToSquared(last) < 20 * 20) return;
    last.copy(cam);
    for (const G of groups) {
      const nc = G.near.map(() => 0), fc = G.far.map(() => 0);
      const sd2 = G.shadowDist * G.shadowDist;
      G.list.forEach((t, i) => {
        const v = i % G.near.length;
        const nearOne = (t.x - cam.x) ** 2 + (t.z - cam.z) ** 2 < sd2;
        const m = nearOne ? G.near[v] : G.far[v];
        const k = nearOne ? nc[v]++ : fc[v]++;
        q.setFromAxisAngle(UP, t.rot);
        pp.set(t.x, t.y, t.z);
        sc.set(t.h * t.w, t.h, t.h * t.w);
        m4.compose(pp, q, sc);
        m.setMatrixAt(k, m4);
        m.setColorAt(k, col.setRGB(t.c, t.c, t.c * 0.95));
      });
      const flush = (arr, counts) => arr.forEach((m, v) => { m.count = counts[v]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
      flush(G.near, nc); flush(G.far, fc);
    }
  }

  // ---- static: coral heads on the reef and the seamount, boulders along rocky shores and the mole
  const rockMat = seaRockMaterial(shared.rock, waterU);
  const coralMat = withUnderwater(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), waterU, 'ocean-coral', { caustics: true });
  const corals = [];
  for (let t = 0; t < 90000 && corals.length < 1500; t++) {
    const [x, z] = [X0 - 100 + rnd() * (X1 - X0 + 200), Z0 + rnd() * (Z1 - Z0 + 200)];
    const r = S.reef(x, z);
    if (r < 0.35) continue;
    const y = S.groundY(x, z);
    if (y > -0.9 || y < -16) continue;
    if (rnd() > r) continue;
    const kind = rnd() < 0.45 ? 0 : rnd() < 0.6 ? 1 : 2;
    const s = (kind === 2 ? 0.5 : 0.35) + rnd() * (kind === 0 ? 1.1 : 0.8);
    if (y + s * 0.8 > -0.6) continue;
    corals.push({ x, y: y - 0.05, z, s, kind, rot: rnd() * 6.283 });
  }
  const coralPal = [[0.95, 0.55, 0.6], [0.95, 0.75, 0.35], [0.6, 0.45, 0.85], [0.55, 0.8, 0.55], [0.9, 0.85, 0.7], [0.4, 0.75, 0.85], [0.95, 0.45, 0.3]];
  const coralGeos = [coralGeometry(0, 1), coralGeometry(1, 2), coralGeometry(2, 3)];
  const coralMeshes = coralGeos.map((g, k) => {
    const list = corals.filter(c => c.kind === k);
    const m = new THREE.InstancedMesh(g, coralMat, Math.max(1, list.length));
    m.count = list.length;
    list.forEach((c, i) => {
      q.setFromAxisAngle(UP, c.rot); pp.set(c.x, c.y, c.z); sc.set(c.s, c.s * (0.7 + rnd() * 0.5), c.s);
      m.setMatrixAt(i, m4.compose(pp, q, sc));
      const p = coralPal[(rnd() * coralPal.length) | 0];
      m.setColorAt(i, col.setRGB(p[0], p[1], p[2]));
    });
    m.instanceMatrix.needsUpdate = true;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    scene.add(m);
    return m;
  });

  const rocks = [];
  // rocky shorelines
  for (let t = 0; t < 120000 && rocks.length < 1100; t++) {
    const [x, z] = [X0 - 150 + rnd() * (X1 - X0 + 300), Z0 - 150 + rnd() * (Z1 - Z0 + 300)];
    const sd = S.shoreDist(x, z);
    if (sd < -8 || sd > 14) continue;
    const cl = splat(x, z, 3);
    if (rnd() > cl * 0.9 + 0.05) continue;
    if (splat(x, z, 0) > 0.3 || blocked(x, z, 2)) continue;
    const y = S.groundY(x, z);
    if (y > 2.2 || y < -5) continue;             // at the foot of the cliffs, not stuck on their faces
    const s = 0.5 + Math.pow(rnd(), 2.2) * 3.2;
    rocks.push({ x, y: y - s * 0.3, z, s, sy: s * (0.6 + rnd() * 0.5), rot: rnd() * 6.283 });
  }
  // around the sea stacks
  for (const st of PLACES.stacks) for (let i = 0; i < 14; i++) {
    const a = rnd() * 6.283, r = st.r * (1 + rnd() * 1.4);
    const x = st.x + Math.cos(a) * r, z = st.z + Math.sin(a) * r;
    const s = 0.8 + rnd() * 2.6;
    rocks.push({ x, y: S.groundY(x, z) - s * 0.25, z, s, sy: s * 0.7, rot: rnd() * 6.283 });
  }
  // breakwater armour: rubble along both slopes of the mole
  {
    const P = PLACES.mole.pts;
    for (let i = 0; i < P.length - 1; i++) {
      const [ax, az] = P[i], [bx, bz] = P[i + 1];
      const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L;
      for (let s = 0; s < L; s += 1.6) for (const side of [-1, 1]) {
        const off = PLACES.mole.half + 1.2 + rnd() * 3.2;
        const x = ax + dx * s - dz * off * side + (rnd() - 0.5), z = az + dz * s + dx * off * side + (rnd() - 0.5);
        if (moleDist(x, z) < PLACES.mole.half + 0.6) continue;
        const sz = 0.7 + rnd() * 1.0;
        rocks.push({ x, y: S.groundY(x, z) - sz * 0.2, z, s: sz, sy: sz * 0.75, rot: rnd() * 6.283 });
      }
    }
  }
  const rockGeos = [boulderGeometry(3), boulderGeometry(8), boulderGeometry(13)];
  const e = new THREE.Euler();
  const rockMeshes = rockGeos.map((g, k) => {
    const list = rocks.filter((_, i) => i % 3 === k);
    const m = new THREE.InstancedMesh(g, rockMat, Math.max(1, list.length));
    m.count = list.length;
    list.forEach((r, i) => {
      e.set((rnd() - 0.5) * 0.4, r.rot, (rnd() - 0.5) * 0.4);
      q.setFromEuler(e); pp.set(r.x, r.y, r.z); sc.set(r.s, r.sy, r.s * (0.8 + rnd() * 0.4));
      m.setMatrixAt(i, m4.compose(pp, q, sc));
    });
    m.instanceMatrix.needsUpdate = true;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    scene.add(m);
    return m;
  });
  // rocks that break the surface out on the water are obstacles for boats
  for (const r of rocks) {
    const top = r.y + r.sy * 0.85;
    if (top > -0.4 && S.groundY(r.x, r.z) < 0.2 && r.s > 0.9) obstacles.push({ x: r.x, z: r.z, r: r.s * 0.85 });
  }

  return {
    trees,
    counts: { pines: pines.length, palms: palms.length, cypress: cypress.length, bushes: bushes.length, corals: corals.length, rocks: rocks.length },
    update(dt, t, cam) { refresh(cam.position); },
  };
}
