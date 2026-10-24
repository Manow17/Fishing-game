// The island's harbour and buildings: stone quay walls round the basin, the wooden dock, whitewashed
// fishermen's houses, a blue-domed chapel, the lighthouse with its turning beam, moored caïques and
// buoys riding the swell, and quay clutter (bollards, lamps, crates, nets, a taverna).
import * as THREE from 'three';
import { mulberry32, smoothstep } from '../../util/noise.js';
import { makeCanvas, toTexture } from '../../util/textures.js';
import { PLACES, basinSDF } from './islandShape.js';
import { withUnderwater } from './oceanShading.js';
import { ENV } from '../env.js';

const UP = new THREE.Vector3(0, 1, 0);
const col = (hex) => new THREE.Color().setHex(hex);

// ---------------------------------------------------------------- merged vertex-coloured geometry
class Kit {
  constructor() { this.parts = []; this.stack = [new THREE.Matrix4()]; }
  get m() { return this.stack[this.stack.length - 1]; }
  push(x, y, z, ry = 0, s = 1) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, ry), new THREE.Vector3(s, s, s));
    this.stack.push(this.m.clone().multiply(m));
  }
  pop() { this.stack.pop(); }
  add(g, c, shade = null) {
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(this.m);
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    const C = c instanceof THREE.Color ? c : col(c);
    for (let i = 0; i < n; i++) {
      const k = shade ? shade(g.attributes.position.getY(i)) : 1;
      a[i * 3] = C.r * k; a[i * 3 + 1] = C.g * k; a[i * 3 + 2] = C.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    this.parts.push(g);
    return g;
  }
  box(w, h, d, x, y, z, c, ry = 0, shade = null) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return this.add(g, c, shade);
  }
  cyl(rt, rb, h, seg, x, y, z, c, open = false) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
    g.translate(x, y, z);
    return this.add(g, c);
  }
  blob(r, x, y, z, c, sy = 1, detail = 0) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    g.scale(1, sy, 1); g.translate(x, y, z);
    return this.add(g, c);
  }
  build(material, { shadows = true } = {}) {
    let n = 0;
    for (const g of this.parts) n += g.attributes.position.count;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
    let o = 0;
    for (const g of this.parts) {
      P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); C.set(g.attributes.color.array, o * 3);
      o += g.attributes.position.count;
      g.dispose();
    }
    this.parts = [];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = shadows; mesh.receiveShadow = true;
    return mesh;
  }
}

const WHITES = [0xf6f3ec, 0xf3efe6, 0xf8f6f1, 0xefe9dd, 0xf4f1ea];
const ACCENT_WALLS = [0xead8ad, 0xd6e3ea, 0xf0d6cb, 0xe3e6cf];
const TRIM = [0x1f5fa8, 0x2a6fb8, 0x2f7d5a, 0xa83228, 0x2e8c9a, 0x3b4fa0, 0xd9a43b];

// A Cycladic house: white cube, flat roof with parapet or a terracotta hip roof, blue/green/red
// joinery, shutters, maybe an outside stair, a balcony, pots and bougainvillea.
// Local frame: footprint centred on the origin, ground at y = 0, front facing +z.
function house(K, rnd, opts = {}) {
  const w = opts.w ?? 5 + rnd() * 3, d = opts.d ?? 4.6 + rnd() * 2.4;
  const two = opts.two ?? rnd() < 0.45;
  const h = two ? 6.0 : 3.3;
  const wall = col(rnd() < 0.82 ? WHITES[(rnd() * WHITES.length) | 0] : ACCENT_WALLS[(rnd() * ACCENT_WALLS.length) | 0]);
  const trim = col(opts.trim ?? TRIM[(rnd() * TRIM.length) | 0]);
  const dark = col(0x23282e), white = col(0xf7f5f0);
  const ao = (y) => 0.78 + 0.22 * smoothstep(-0.2, 1.2, y);   // contact darkening at the foot of the walls
  K.box(w, h + 3, d, 0, (h - 3) / 2, 0, wall, 0, ao);
  if (rnd() < 0.55) K.box(w + 0.04, 0.38, d + 0.04, 0, 0.1, 0, rnd() < 0.5 ? col(0x9aa7ae) : trim.clone().lerp(white, 0.35));
  const tiled = opts.tiled ?? rnd() < 0.3;
  if (tiled) {
    const diag = Math.SQRT2;
    const g = new THREE.ConeGeometry(1, 1, 4, 1);
    g.rotateY(Math.PI / 4);
    g.scale((w + 0.6) / diag, 1.35, (d + 0.6) / diag);
    g.translate(0, h + 0.675, 0);
    K.add(g, col(0xb4552f), (y) => 0.85 + 0.15 * smoothstep(h, h + 1.3, y));
    K.box(w + 0.5, 0.12, d + 0.5, 0, h + 0.02, 0, col(0x9c4728));
  } else {
    const pt = 0.2, ph = 0.42;
    K.box(w, ph, pt, 0, h + ph / 2, d / 2 - pt / 2, wall);
    K.box(w, ph, pt, 0, h + ph / 2, -d / 2 + pt / 2, wall);
    K.box(pt, ph, d - 2 * pt, w / 2 - pt / 2, h + ph / 2, 0, wall);
    K.box(pt, ph, d - 2 * pt, -w / 2 + pt / 2, h + ph / 2, 0, wall);
    K.box(w - 0.3, 0.06, d - 0.3, 0, h + 0.04, 0, col(0xd8d3c8));
    if (rnd() < 0.45) { // chimney
      const cx = (rnd() - 0.5) * (w - 1.2), cz = (rnd() - 0.5) * (d - 1.2);
      K.box(0.55, 1.0, 0.55, cx, h + 0.5, cz, wall);
      K.box(0.75, 0.12, 0.75, cx, h + 1.05, cz, wall);
    }
    if (rnd() < 0.3) { K.cyl(0.45, 0.45, 0.9, 10, (rnd() - 0.5) * (w - 1.4), h + 0.5, (rnd() - 0.5) * (d - 1.4), col(0x6d7378)); } // water tank
  }
  // door on the front
  const dx = (rnd() - 0.5) * (w - 2.2);
  K.box(1.3, 2.35, 0.06, dx, 1.12, d / 2 + 0.03, white);
  K.box(1.0, 2.1, 0.1, dx, 1.05, d / 2 + 0.04, trim);
  K.box(1.35, 0.12, 0.35, dx, 2.3, d / 2 + 0.16, white);           // lintel ledge
  K.box(1.6, 0.18, 0.7, dx, 0.02, d / 2 + 0.35, wall);              // doorstep
  // windows with shutters on all four facades
  const windowAt = (fx, fy, face) => {
    // face: 0 front(+z) 1 back(-z) 2 right(+x) 3 left(-x)
    const rot = [0, Math.PI, Math.PI / 2, -Math.PI / 2][face];
    const off = [d / 2, d / 2, w / 2, w / 2][face];
    K.push(0, 0, 0, rot);
    K.box(0.95, 1.15, 0.05, fx, fy, off + 0.02, white);
    K.box(0.72, 0.92, 0.06, fx, fy, off + 0.03, dark);
    K.box(1.0, 0.1, 0.22, fx, fy - 0.6, off + 0.1, white);
    if (rnd() < 0.55) { // open shutters folded against the wall
      K.box(0.4, 0.95, 0.05, fx - 0.62, fy, off + 0.06, trim);
      K.box(0.4, 0.95, 0.05, fx + 0.62, fy, off + 0.06, trim);
    } else if (rnd() < 0.6) {
      K.box(0.76, 0.95, 0.06, fx, fy, off + 0.07, trim);
    }
    K.pop();
  };
  const stories = two ? 2 : 1;
  for (let s = 0; s < stories; s++) {
    const y = 1.55 + s * 2.75;
    for (let f = 0; f < 4; f++) {
      const span = f < 2 ? w : d;
      const n = span > 6.5 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        if (rnd() < (f === 0 ? 0.15 : 0.35)) continue;
        let fx = n === 1 ? (rnd() - 0.5) * (span - 2.2) : (i === 0 ? -1 : 1) * span * 0.25;
        if (f === 0 && s === 0 && Math.abs(fx - dx) < 1.4) fx = dx + (fx > dx ? 1.6 : -1.6);
        if (Math.abs(fx) > span / 2 - 0.7) continue;
        windowAt(f === 3 ? -fx : fx, y, f);
      }
    }
  }
  // outside stair to the roof / upper floor along the right wall
  if (two && rnd() < 0.5) {
    const side = rnd() < 0.5 ? 1 : -1, steps = 14;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      K.box(0.95, (i + 1) * (h / steps), h / steps * 1.0, side * (w / 2 + 0.48), (i + 1) * (h / steps) / 2, -d / 2 + 0.4 + t * (d - 0.8), wall);
    }
  }
  if (two && rnd() < 0.35) { // balcony
    K.box(w * 0.5, 0.15, 1.0, 0, 2.95, d / 2 + 0.5, wall);
    for (let i = 0; i <= 6; i++) K.box(0.04, 0.9, 0.04, -w * 0.25 + i * w * 0.5 / 6, 3.45, d / 2 + 0.97, trim);
    K.box(w * 0.5, 0.05, 0.06, 0, 3.9, d / 2 + 0.97, trim);
  }
  // pots and bougainvillea
  for (let i = 0; i < 1 + (rnd() * 3 | 0); i++) {
    const px = dx + (rnd() < 0.5 ? -1 : 1) * (0.9 + rnd() * 0.5), pz = d / 2 + 0.3 + rnd() * 0.3;
    K.cyl(0.18, 0.13, 0.36, 8, px, 0.18, pz, col(0xb5653a));
    K.blob(0.26, px, 0.5, pz, col(rnd() < 0.3 ? 0xd23a6a : 0x3f6e2e), 0.85);
  }
  if (rnd() < 0.4) {
    const bx = (rnd() < 0.5 ? -1 : 1) * (w / 2 - 0.6), r2 = mulberry32((rnd() * 1e6) | 0);
    for (let i = 0; i < 14; i++) {
      const y = 0.6 + r2() * (h - 0.9), x = bx + (r2() - 0.5) * 1.4, z = d / 2 + 0.15 + r2() * 0.25;
      K.blob(0.22 + r2() * 0.25, x, y, z, col(r2() < 0.75 ? (r2() < 0.5 ? 0xc2185b : 0xd81b60) : 0x2f5d26), 0.9);
    }
  }
  return { w, d, h: tiled ? h + 1.4 : h + 0.4 };
}

// Mediterranean chapel: white nave, apse, drum + blue dome, bell gable. Front faces +z.
function chapel(K) {
  const wall = col(0xf8f6f1), blue = col(0x2459b0), dark = col(0x23282e);
  K.box(5.4, 7.5, 9, 0, 0.75, 0, wall);                         // nave (down to -3)
  const ap = new THREE.CylinderGeometry(2.7, 2.7, 6.5, 16, 1, false, Math.PI / 2, Math.PI);
  ap.translate(0, 1.25, -4.5);
  K.add(ap, wall);
  K.box(5.6, 0.25, 9.2, 0, 4.55, 0, wall);
  K.cyl(2.0, 2.0, 1.3, 20, 0, 5.3, 0.8, wall);                  // drum
  const dome = new THREE.SphereGeometry(2.15, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(0, 5.95, 0.8);
  K.add(dome, blue);
  K.cyl(0.05, 0.05, 0.9, 6, 0, 8.4, 0.8, col(0xf0f0f0));
  K.box(0.5, 0.06, 0.06, 0, 8.55, 0.8, col(0xf0f0f0));
  // bell gable over the front
  K.box(0.35, 2.0, 0.4, -1.0, 5.4, 4.35, wall); K.box(0.35, 2.0, 0.4, 1.0, 5.4, 4.35, wall);
  K.box(2.6, 0.45, 0.45, 0, 6.6, 4.35, wall);
  const bell = new THREE.CylinderGeometry(0.18, 0.32, 0.45, 12, 1, true); bell.translate(0, 5.6, 4.35);
  K.add(bell, col(0x8a6a2a));
  K.box(0.06, 0.6, 0.06, 0, 7.15, 4.35, col(0xf0f0f0)); K.box(0.36, 0.06, 0.06, 0, 7.25, 4.35, col(0xf0f0f0));
  // door, windows, steps
  K.box(1.4, 2.4, 0.08, 0, 1.2, 4.52, blue);
  K.box(1.8, 2.8, 0.05, 0, 1.4, 4.51, col(0xe9e4d8));
  for (const z of [-2, 1]) for (const s of [-1, 1]) K.box(0.08, 1.2, 0.5, s * 2.72, 2.2, z, dark);
  for (let i = 0; i < 3; i++) K.box(3.2 - i * 0.4, 0.18, 0.6, 0, -0.1 + i * 0.18, 5.6 - i * 0.45, wall);
}

// ---------------------------------------------------------------- caïque (moored fishing boat)
function caique(seed) {
  const rnd = mulberry32(seed * 97 + 5);
  const L = 5.5 + rnd() * 3, B = L * (0.3 + rnd() * 0.04), D = 0.85;
  const hullC = col(rnd() < 0.7 ? 0xf3f1ea : TRIM[(rnd() * 4) | 0]);
  const band = col(TRIM[(rnd() * TRIM.length) | 0]);
  const anti = col(rnd() < 0.5 ? 0x7a2420 : 0x2b3a44);
  const NS = 18, NJ = 6;
  const pos = [], colr = [], idx = [];
  const sheerAt = (t) => 0.48 + 0.42 * Math.pow(Math.abs(2 * t - 1), 2.4) + (t > 0.5 ? 0.16 * (2 * t - 1) ** 2 : 0);
  const halfW = (t) => B / 2 * Math.pow(Math.sin(Math.PI * (0.015 + 0.97 * t)), 0.55);
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= NS; i++) {
      const t = i / NS, z = (t - 0.5) * L, sh = sheerAt(t), keel = -D * (1 - 0.4 * Math.pow(Math.abs(2 * t - 1), 2.5)), hw = halfW(t);
      for (let j = 0; j <= NJ; j++) {
        const s = j / NJ, y = keel + (sh - keel) * s;
        const x = side * hw * Math.pow(Math.sin(s * Math.PI / 2), 0.55);
        pos.push(x, y, z);
        const c = y < 0.04 ? anti : (sh - y < 0.18 ? band : hullC);
        colr.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < NS; i++) for (let j = 0; j < NJ; j++) {
      const a = base + i * (NJ + 1) + j, b = a + 1, c = a + NJ + 1, d = c + 1;
      if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);   // outward-facing
    }
  }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  hull.setIndex(idx);
  hull.computeVertexNormals();
  const K = new Kit();
  K.parts.push(hull.toNonIndexed());
  // deck (a lid over the hull, so no water shows inside)
  const dpos = [], dc = col(0x9a7a55);
  for (let i = 0; i < NS; i++) {
    const t0 = i / NS, t1 = (i + 1) / NS;
    const z0 = (t0 - 0.5) * L, z1 = (t1 - 0.5) * L, y0 = sheerAt(t0) - 0.16, y1 = sheerAt(t1) - 0.16, w0 = halfW(t0) * 0.96, w1 = halfW(t1) * 0.96;
    dpos.push(-w0, y0, z0, -w1, y1, z1, w0, y0, z0, w0, y0, z0, -w1, y1, z1, w1, y1, z1);   // facing up
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
  deck.computeVertexNormals();
  K.add(deck, dc);
  // wheelhouse, mast, net pile
  if (rnd() < 0.65) {
    const zc = -L * 0.12;
    K.box(B * 0.55, 1.15, 1.4, 0, sheerAt(0.4) + 0.4, zc, col(0xf5f3ee));
    K.box(B * 0.62, 0.08, 1.6, 0, sheerAt(0.4) + 1.0, zc, band);
    K.box(B * 0.5, 0.35, 0.05, 0, sheerAt(0.4) + 0.65, zc + 0.71, col(0x2a3540));
  }
  K.cyl(0.05, 0.06, 2.8, 6, 0, 1.6, L * 0.22, col(0x8a6a45));
  K.blob(0.45, 0, sheerAt(0.8) - 0.05, -L * 0.33, col(rnd() < 0.5 ? 0xd2652d : 0x3e7d5a), 0.45);
  return { K, L, B };
}

// ---------------------------------------------------------------- textures
function ashlarTexture() {
  const c = makeCanvas(512), g = c.getContext('2d'), rnd = mulberry32(55);
  g.fillStyle = '#8f877a'; g.fillRect(0, 0, 512, 512);
  const rows = 8;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * 80;
    const y = r * 64;
    while (x < 512) {
      const w = 70 + rnd() * 90, k = 0.82 + rnd() * 0.3;
      g.fillStyle = `rgb(${200 * k | 0},${190 * k | 0},${168 * k | 0})`;
      g.fillRect(x + 3, y + 3, w - 6, 58);
      for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '90,85,75' : '235,228,210'},0.18)`; g.fillRect(x + 3 + rnd() * (w - 8), y + 3 + rnd() * 54, 2 + rnd() * 5, 2 + rnd() * 4); }
      // wrap so the texture tiles horizontally
      if (x + w > 512) { g.fillStyle = `rgb(${200 * k | 0},${190 * k | 0},${168 * k | 0})`; g.fillRect(x + 3 - 512, y + 3, w - 6, 58); }
      x += w;
    }
  }
  return toTexture(c);
}

function flareTexture() {
  const c = makeCanvas(128), g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,250,230,1)'); grd.addColorStop(0.12, 'rgba(255,235,180,0.8)');
  grd.addColorStop(0.4, 'rgba(255,210,140,0.18)'); grd.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- build
export async function createHarbour(scene, ctx) {
  const { S, time, layout, obstacles, shared, waterU } = ctx;
  layout.exclusions = layout.exclusions || [];
  const excl = layout.exclusions, colliders = layout.colliders;
  const rnd = mulberry32(2718);
  const animated = [];
  const solid = withUnderwater(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }), waterU, 'ocean-kit');
  const lowest = (x, z, r) => {
    let m = S.groundY(x, z);
    for (let a = 0; a < 6.28; a += 0.785) m = Math.min(m, S.groundY(x + Math.cos(a) * r, z + Math.sin(a) * r));
    return m;
  };
  const free = (x, z, r) => excl.every(e => (e.x - x) ** 2 + (e.z - z) ** 2 > (e.r + r) ** 2);
  const take = (x, z, r, collide = true) => { excl.push({ x, z, r }); if (collide) colliders.push({ x, z, r: r * 0.92 }); };

  // ---- quay walls round the basin (only where there is land behind them)
  {
    const B = PLACES.basin, R = B.r;
    const pts = [];
    const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2, hx = (B.x1 - B.x0) / 2 - R, hz = (B.z1 - B.z0) / 2 - R;
    // walk the rounded rectangle: straight edges + quarter circles
    const corners = [[cx + hx, cz + hz, 0], [cx - hx, cz + hz, Math.PI / 2], [cx - hx, cz - hz, Math.PI], [cx + hx, cz - hz, 1.5 * Math.PI]];
    for (let k = 0; k < 4; k++) {
      const [ox, oz, a0] = corners[k];
      for (let i = 0; i <= 6; i++) { const a = a0 + i / 6 * Math.PI / 2; pts.push([ox + Math.cos(a) * R, oz + Math.sin(a) * R, Math.cos(a), Math.sin(a)]); }
      const [nx2, nz2] = corners[(k + 1) % 4];
      const a1 = a0 + Math.PI / 2, ex = ox + Math.cos(a1) * R, ez = oz + Math.sin(a1) * R, fx = nx2 + Math.cos(a1) * R, fz = nz2 + Math.sin(a1) * R;
      const L = Math.hypot(fx - ex, fz - ez), n = Math.ceil(L / 2);
      for (let i = 1; i < n; i++) pts.push([ex + (fx - ex) * i / n, ez + (fz - ez) * i / n, Math.cos(a1), Math.sin(a1)]);
    }
    const tex = ashlarTexture();
    const wallMat = withUnderwater(new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.9 }), waterU, 'ocean-quaywall', { caustics: true });
    const P = [], N = [], U = [], C = [];
    const top = PLACES.quayY + 0.06, bot = -5.8;
    let run = 0;
    const land = pts.map(([x, z, nx, nz]) => S.groundY(x + nx * 2.5, z + nz * 2.5) > 0.3);
    const wcol = (y) => { const wet = 1 - smoothstep(-0.2, 0.9, y); const k = 1 - 0.45 * wet; return [k * (1 - 0.15 * wet), k * (1 - 0.05 * wet), k * (1 - 0.2 * wet)]; };
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!(land[i] && land[(i + 1) % pts.length])) { run += seg; continue; }
      // inner face (normal points into the basin = -outward)
      const quad = (p0, p1, p2, p3, n, uv) => {
        for (const [p, t] of [[p0, uv[0]], [p1, uv[1]], [p2, uv[2]], [p1, uv[1]], [p3, uv[3]], [p2, uv[2]]]) {
          P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); U.push(t[0], t[1]); C.push(...wcol(p[1]));
        }
      };
      const n0 = [-(a[2] + b[2]) / 2, 0, -(a[3] + b[3]) / 2];
      const u0 = run / 2.2, u1 = (run + seg) / 2.2;
      const ys = [bot, -2.5, 0.0, 0.5, top - 0.25];
      for (let k = 0; k < ys.length - 1; k++) {
        const y0 = ys[k], y1 = ys[k + 1];
        quad([a[0], y0, a[1]], [b[0], y0, b[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], n0, [[u0, y0 / 2.2], [u1, y0 / 2.2], [u0, y1 / 2.2], [u1, y1 / 2.2]]);
      }
      // coping stone: front lip and top, overhanging the face a little
      const o = 0.12, ia = [a[0] - a[2] * o, a[1] - a[3] * o], ib = [b[0] - b[2] * o, b[1] - b[3] * o];
      const ka = [a[0] + a[2] * 0.9, a[1] + a[3] * 0.9], kb = [b[0] + b[2] * 0.9, b[1] + b[3] * 0.9];
      quad([ia[0], top - 0.25, ia[1]], [ib[0], top - 0.25, ib[1]], [ia[0], top, ia[1]], [ib[0], top, ib[1]], n0, [[u0, 0], [u1, 0], [u0, 0.12], [u1, 0.12]]);
      quad([ia[0], top, ia[1]], [ib[0], top, ib[1]], [ka[0], top, ka[1]], [kb[0], top, kb[1]], [0, 1, 0], [[u0, 0.3], [u1, 0.3], [u0, 0.75], [u1, 0.75]]);
      run += seg;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, wallMat);
    m.receiveShadow = true; m.castShadow = false;
    m.name = 'quayWalls';
    scene.add(m);
  }

  // ---- the dock
  let V = null;
  try { V = await import('../../models/village.js'); } catch (e) { console.warn('[ocean] village models unavailable', e); }
  for (const d of layout.docks) {
    take(d.x - 1, d.z, 2.5, false);
    if (!V) continue;
    try {
      const dock = V.createDock(PLACES.dock.len);
      dock.position.set(d.x, d.y, d.z);
      dock.rotation.y = d.yaw;
      dock.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      scene.add(dock);
    } catch (e) { console.warn(e); }
  }
  // keep the shop spot and the walk from the dock clear
  for (const s of layout.shops) take(s.x, s.z, 4, false);
  take(640, 50, 7, false);

  // ---- houses
  const K = new Kit();
  const placeHouse = (x, z, yaw, opts = {}) => {
    const hr = rnd;
    const w = opts.w ?? 5 + hr() * 2.6, d = opts.d ?? 4.6 + hr() * 2.2, r = Math.hypot(w, d) / 2;
    if (!free(x, z, r * 0.9)) return false;
    const y = lowest(x, z, r * 0.8);
    if (y < 0.5) return false;
    K.push(x, y, z, yaw);
    house(K, hr, { ...opts, w, d });
    K.pop();
    take(x, z, r * 0.95);
    return true;
  };
  // waterfront row facing the quay, the north row facing the basin, a few on the south arm
  for (let z = -42; z < 152;) {
    const w = 5 + rnd() * 2.5;
    if (z < 60 && z + w > 40) { z = 61; continue; }    // keep the walk up from the dock open
    const d = 5 + rnd() * 2;
    placeHouse(634.5 - d / 2 - rnd() * 1.5, z + w / 2, Math.PI / 2, { w: d, d: w });
    z += w + 0.4 + (rnd() < 0.25 ? 3 + rnd() * 3 : 0);
  }
  for (let x = 664; x < 738;) {
    const w = 5 + rnd() * 2.5, d = 5 + rnd() * 2;
    placeHouse(x + w / 2, -23 - d / 2 - rnd(), 0, { w, d });
    x += w + 0.5 + (rnd() < 0.3 ? 3 : 0);
  }
  for (let x = 668; x < 730;) {
    const w = 5 + rnd() * 2.5, d = 5 + rnd() * 2;
    placeHouse(x + w / 2, 120 + d / 2 + rnd(), Math.PI, { w, d });
    x += w + 1 + rnd() * 5;
  }
  // up the slope behind
  for (let t = 0, n = 0; t < 900 && n < 22; t++) {
    const x = 500 + rnd() * 120, z = -70 + rnd() * 250;
    const y = S.groundY(x, z);
    if (y < 1.5 || y > 40) continue;
    const e = 3, sl = Math.hypot(S.groundY(x + e, z) - S.groundY(x - e, z), S.groundY(x, z + e) - S.groundY(x, z - e)) / (2 * e);
    if (sl > 0.42) continue;
    if (placeHouse(x, z, Math.PI / 2 + (rnd() - 0.5) * 0.7)) n++;
  }

  // ---- chapel on the flattest spot near its hill, cypresses around it (flora reads layout.chapel)
  {
    let best = null, bs = 1e9;
    for (let i = 0; i < 200; i++) {
      const a = rnd() * 6.283, r = rnd() * 70, x = PLACES.chapel.x + Math.cos(a) * r, z = PLACES.chapel.z + Math.sin(a) * r;
      const y = S.groundY(x, z);
      if (y < 8) continue;
      const e = 5, sl = Math.hypot(S.groundY(x + e, z) - S.groundY(x - e, z), S.groundY(x, z + e) - S.groundY(x, z - e)) / (2 * e);
      const score = sl * 100 - y * 0.1;
      if (score < bs) { bs = score; best = { x, z }; }
    }
    if (best) {
      const y = lowest(best.x, best.z, 5);
      const yaw = Math.atan2(700 - best.x, 50 - best.z);     // front toward the harbour
      K.push(best.x, y, best.z, yaw); chapel(K); K.pop();
      take(best.x, best.z, 6.5);
      layout.chapel = { x: best.x, z: best.z };
    }
  }

  // ---- lighthouse + keeper's cottage
  const LH = layout.lighthouse;
  const lhY = lowest(LH.x, LH.z, 4) - 0.1;
  {
    K.push(LH.x, lhY, LH.z, 0);
    const pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(2.5 - 0.9 * t, 1 + t * 14)); }
    const tower = new THREE.LatheGeometry(pts, 24);
    K.add(tower, col(0xf6f4ee));
    // red bands tinted via a second pass
    const last = K.parts[K.parts.length - 1], ca = last.attributes.color, pa = last.attributes.position;
    for (let i = 0; i < ca.count; i++) {
      const y = pa.getY(i) - lhY;
      if ((y > 7.5 && y < 9.3) || (y > 12.3 && y < 14.1)) ca.setXYZ(i, 0.62, 0.07, 0.05);
    }
    const base = new THREE.CylinderGeometry(3.4, 3.6, 2.2, 8); base.translate(0, -0.1, 0);
    K.add(base, col(0xd8d2c4));
    K.cyl(2.45, 2.45, 0.28, 24, 0, 15.1, 0, col(0x3a3f44));
    for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; K.box(0.05, 0.95, 0.05, Math.cos(a) * 2.3, 15.7, Math.sin(a) * 2.3, col(0x2f3438)); }
    const rail = new THREE.TorusGeometry(2.3, 0.04, 4, 32); rail.rotateX(Math.PI / 2); rail.translate(0, 16.15, 0);
    K.add(rail, col(0x2f3438));
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; K.box(0.08, 1.9, 0.08, Math.cos(a) * 1.15, 16.2, Math.sin(a) * 1.15, col(0x2f3438)); }
    K.cyl(1.25, 1.25, 0.35, 16, 0, 15.4, 0, col(0x2f3438));
    const roof = new THREE.ConeGeometry(1.5, 1.1, 16); roof.translate(0, 17.75, 0);
    K.add(roof, col(0x8c1f17));
    K.blob(0.22, 0, 18.4, 0, col(0x2f3438), 1, 1);
    K.cyl(0.02, 0.02, 1.2, 4, 0, 19.0, 0, col(0x2f3438));
    K.box(1.0, 2.0, 0.2, 0, 2.0, 2.45, col(0x2a5a8a));
    for (const y of [5, 9, 12.5]) K.box(0.5, 0.8, 0.12, 0, y, 2.5 - (y - 1) / 14 * 0.9, col(0x23282e));
    K.pop();
    take(LH.x, LH.z, 4);
    // keeper's cottage next to it, facing the sea
    const cx = LH.x + 9, cz = LH.z - 4;
    if (free(cx, cz, 4)) {
      const cy = lowest(cx, cz, 3.5);
      K.push(cx, cy, cz, Math.PI); house(K, rnd, { w: 6.5, d: 5, two: false, tiled: true, trim: 0x2a5a8a }); K.pop();
      take(cx, cz, 4.2);
    }
  }
  // lantern glass, lamp and the turning beams
  {
    const g = new THREE.Group();
    g.position.set(LH.x, lhY, LH.z);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, 1.9, 16, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x9fc6cf, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false }));
    glass.position.y = 16.55;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 10), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff1c8, emissiveIntensity: 7 }));
    lamp.position.y = 16.45;
    g.add(glass, lamp);
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0.22 } },
      vertexShader: `varying float vT; varying vec3 vN; varying vec3 vV;
        void main(){ vT = uv.y; vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform float uI; varying float vT; varying vec3 vN; varying vec3 vV;
        void main(){ float edge = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.5);
          float a = uI * edge * pow(clamp(vT, 0.0, 1.0), 2.0);
          gl_FragColor = vec4(vec3(1.0, 0.93, 0.75) * a, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    const rot = new THREE.Group();
    rot.position.y = 16.45;
    for (const s of [1, -1]) {
      const cone = new THREE.ConeGeometry(9, 140, 20, 1, true);
      cone.translate(0, -70, 0);           // apex at the lamp
      cone.rotateZ(s * Math.PI / 2);       // horizontal
      const m = new THREE.Mesh(cone, beamMat);
      m.renderOrder = 4;
      m.frustumCulled = false;
      rot.add(m);
    }
    g.add(rot);
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTexture(), color: 0xfff0d0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    flare.position.y = 16.45;
    flare.scale.setScalar(5);
    g.add(flare);
    scene.add(g);
    const beamDir = new THREE.Vector3(), toCam = new THREE.Vector3(), lampW = new THREE.Vector3();
    animated.push({
      update(dt, t, cam) {
        rot.rotation.y = t * (Math.PI * 2 / 12);   // one turn every 12 s: a flash every 6 s
        lampW.set(LH.x, lhY + 16.45, LH.z);
        toCam.copy(cam.position).sub(lampW);
        const dist = toCam.length();
        toCam.normalize();
        beamDir.set(Math.cos(-rot.rotation.y), 0, Math.sin(-rot.rotation.y));
        const al = Math.abs(beamDir.x * toCam.x + beamDir.z * toCam.z) / Math.max(0.2, Math.hypot(toCam.x, toCam.z));
        const flash = Math.pow(Math.max(0, al), 60);
        flare.material.opacity = 0.25 + 0.75 * flash;
        flare.scale.setScalar((4 + flash * 18) * Math.max(1, dist / 300));
      },
    });
  }

  // ---- harbour light at the end of the mole
  {
    const [mx, mz] = PLACES.mole.pts[PLACES.mole.pts.length - 1];
    const y = S.groundY(mx, mz);
    K.push(mx, y, mz, 0);
    K.cyl(1.0, 1.15, 0.6, 12, 0, 0.3, 0, col(0xdedad0));
    K.cyl(0.55, 0.7, 4.2, 12, 0, 2.6, 0, col(0x2f8a4e));
    for (const yy of [1.4, 3.2]) K.cyl(0.66, 0.68, 0.5, 12, 0, yy, 0, col(0xf2f2ee));
    K.cyl(0.42, 0.42, 0.7, 10, 0, 5.05, 0, col(0x2a2f33));
    K.pop();
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshStandardMaterial({ color: 0, emissive: 0x4cff7a, emissiveIntensity: 4 }));
    glow.position.set(mx, y + 5.05, mz);
    scene.add(glow);
    take(mx, mz, 1.3);
  }

  // ---- quay furniture: bollards, lamps, crates, nets, benches, a taverna
  {
    const iron = col(0x2b2f33), lampC = col(0x2c4a3a);
    const bollard = (x, z) => { const y = S.groundY(x, z); K.cyl(0.17, 0.2, 0.55, 10, x, y + 0.27, z, iron); K.blob(0.2, x, y + 0.56, z, iron, 0.6, 1); };
    // along the west quay edge and the north quay edge
    for (let z = -2; z < 102; z += 9) if (Math.abs(z - 50) > 4) bollard(PLACES.basin.x0 - 0.9, z);
    for (let x = 662; x < 750; x += 10) bollard(x, PLACES.basin.z0 - 0.9);
    for (let x = 662; x < 742; x += 10) bollard(x, PLACES.basin.z1 + 0.9);
    // the mole top
    { const P = PLACES.mole.pts; for (let i = 0; i < P.length - 1; i++) { const [ax, az] = P[i], [bx, bz] = P[i + 1]; const L = Math.hypot(bx - ax, bz - az); for (let s = 6; s < L - 3; s += 12) bollard(ax + (bx - ax) * s / L, az + (bz - az) * s / L); } }
    const lamp = (x, z) => {
      const y = S.groundY(x, z);
      K.cyl(0.07, 0.1, 3.4, 8, x, y + 1.7, z, lampC);
      K.cyl(0.18, 0.12, 0.12, 8, x, y + 0.06, z, lampC);
      K.box(0.36, 0.45, 0.36, x, y + 3.6, z, col(0xf5ecd0));
      K.cyl(0.0, 0.32, 0.25, 4, x, y + 3.95, z, lampC);
      take(x, z, 0.35);
    };
    for (let z = -2; z < 104; z += 24) lamp(PLACES.basin.x0 - 6, z + 6);
    for (let x = 670; x < 745; x += 26) lamp(x, PLACES.basin.z0 - 6);
    // fish crates near the dock
    const crateCols = [0x2a62b0, 0xd2402f, 0xf2c14e, 0x3d9a6a, 0xeaeaea];
    for (const [cx, cz] of [[645, 58], [647.5, 61], [644, 26]]) {
      const y = S.groundY(cx, cz);
      let h = 0;
      const n = 2 + (rnd() * 4 | 0);
      for (let i = 0; i < n; i++) {
        const c = crateCols[(rnd() * crateCols.length) | 0];
        K.box(0.8, 0.32, 0.55, cx + (rnd() - 0.5) * 0.12, y + h + 0.16, cz + (rnd() - 0.5) * 0.1, c, (rnd() - 0.5) * 0.3);
        h += 0.33;
      }
      take(cx, cz, 0.8);
    }
    // nets with floats
    for (const [nx, nz] of [[643, 70], [690, -16], [705, 115]]) {
      const y = S.groundY(nx, nz);
      for (let i = 0; i < 7; i++) K.blob(0.55 + rnd() * 0.35, nx + (rnd() - 0.5) * 1.6, y + 0.15, nz + (rnd() - 0.5) * 1.2, col(rnd() < 0.5 ? 0x2f6a4f : 0xc8642d), 0.35, 1);
      for (let i = 0; i < 6; i++) K.blob(0.12, nx + (rnd() - 0.5) * 1.8, y + 0.42, nz + (rnd() - 0.5) * 1.4, col(0xf2c14e), 1, 1);
      take(nx, nz, 1.3);
    }
    // taverna: pergola with tables and chairs on the north quay
    {
      const tx = 700, tz = -17, y = S.groundY(tx, tz), wood = col(0x7a5a3a), cloth = col(0xf4f1ea), chair = col(0x2a62b0);
      for (const sx of [-5, 0, 5]) for (const sz of [-2, 2]) K.box(0.14, 2.6, 0.14, tx + sx, y + 1.3, tz + sz, wood);
      for (let i = -5; i <= 5; i += 0.6) K.box(0.08, 0.08, 4.4, tx + i, y + 2.65, tz, wood);
      K.box(10.4, 0.12, 0.14, tx, y + 2.58, tz - 2, wood); K.box(10.4, 0.12, 0.14, tx, y + 2.58, tz + 2, wood);
      for (let i = 0; i < 8; i++) K.blob(0.5, tx - 4.5 + i * 1.3 + rnd() * 0.4, y + 2.75, tz + (rnd() - 0.5) * 3.5, col(0x3d6e2c), 0.4, 1);  // vine
      for (const sx of [-3.2, 0, 3.2]) {
        K.cyl(0.45, 0.45, 0.05, 12, tx + sx, y + 0.76, tz, cloth); K.cyl(0.04, 0.04, 0.74, 6, tx + sx, y + 0.37, tz, wood);
        for (const cz of [-0.85, 0.85]) { K.box(0.42, 0.06, 0.42, tx + sx, y + 0.45, tz + cz, chair); K.box(0.42, 0.5, 0.05, tx + sx, y + 0.7, tz + cz * 1.25, chair); }
      }
      take(tx, tz, 3.2, false);
      for (const sx of [-3.2, 0, 3.2]) colliders.push({ x: tx + sx, z: tz, r: 1.0 });
    }
    // benches looking out over the basin
    if (V && V.createBench) {
      for (const [bx, bz, yaw] of [[641, 30, Math.PI / 2], [641, 82, Math.PI / 2], [675, -12, 0]]) {
        try { const b = V.createBench(); b.position.set(bx, S.groundY(bx, bz), bz); b.rotation.y = yaw; b.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); scene.add(b); take(bx, bz, 0.9); } catch (e) { /* optional */ }
      }
    }
  }

  const village = K.build(solid);
  village.name = 'oceanVillage';
  scene.add(village);

  // ---- moored caïques (stern-to the west quay, Mediterranean style) and one at anchor, riding the water
  const boatMat = withUnderwater(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), waterU, 'ocean-boats');
  const floaters = [];
  const addFloater = (object, x, z, h, L, B, draft = 0) => {
    object.position.set(x, 0, z);
    object.rotation.y = h;
    scene.add(object);
    floaters.push({ o: object, x, z, h, L, B, draft, pitch: 0, roll: 0, y: 0 });
  };
  const moorings = [[658, 8], [658, 16.5], [658, 25], [658, 76], [658, 86], [733, 30]];
  moorings.forEach(([x, z], i) => {
    const { K: bk, L, B } = caique(i + 3);
    const m = bk.build(boatMat);
    const atAnchor = x > 700;
    const h = atAnchor ? 2.3 : Math.PI / 2;
    const cx = atAnchor ? x : x + L / 2 - 1.2;
    addFloater(m, cx, z, h, L, B);
    const fx = Math.sin(h), fz = Math.cos(h);
    for (const s of [-0.3, 0, 0.3]) obstacles.push({ x: cx + fx * s * L, z: z + fz * s * L, r: B / 2 + 0.25 });
  });

  // ---- buoys: harbour entrance marks and a bell buoy offshore
  const buoyKit = (kind) => {
    const k = new Kit();
    if (kind === 'bell') {
      k.cyl(0.9, 0.7, 1.0, 12, 0, 0.0, 0, col(0xe6b81e));
      k.cyl(0.95, 0.95, 0.25, 12, 0, 0.55, 0, col(0x1d1d1d));
      for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; k.box(0.08, 2.2, 0.08, Math.cos(a) * 0.55, 1.7, Math.sin(a) * 0.55, col(0x1d1d1d)); }
      k.cyl(0.25, 0.4, 0.45, 10, 0, 2.2, 0, col(0x8a6a2a), true);
      k.cyl(0.0, 0.3, 0.6, 4, 0, 3.05, 0, col(0x1d1d1d));
    } else {
      const c = kind === 'red' ? 0xc8261e : 0x22884a;
      k.cyl(0.55, 0.45, 1.2, 12, 0, 0.1, 0, col(c));
      if (kind === 'red') k.cyl(0.32, 0.32, 0.8, 4, 0, 1.1, 0, col(c));
      else k.cyl(0.0, 0.42, 0.9, 12, 0, 1.15, 0, col(c));
      k.cyl(0.58, 0.58, 0.12, 12, 0, 0.45, 0, col(0xf2f2ee));
    }
    return k.build(boatMat);
  };
  const buoys = [['red', 797, 92], ['green', 764, 116], ['bell', 1180, 140]];
  for (const [kind, x, z] of buoys) {
    const m = buoyKit(kind);
    addFloater(m, x, z, 0, 1.2, 1.2, 0.25);
    obstacles.push({ x, z, r: kind === 'bell' ? 1.2 : 0.9 });
    layout.buoys.push({ x, z, kind });
  }

  const _s = (x, z) => ENV.surface(x, z);
  return {
    update(dt, t, cam) {
      for (const a of animated) a.update(dt, t, cam);
      const k = Math.min(1, dt * 5);
      for (const f of floaters) {
        const fx = Math.sin(f.h), fz = Math.cos(f.h), L = f.L * 0.38, B = f.B * 0.45;
        const hb = _s(f.x + fx * L, f.z + fz * L), hs = _s(f.x - fx * L, f.z - fz * L);
        const hp = _s(f.x - fz * B, f.z + fx * B), hq = _s(f.x + fz * B, f.z - fx * B);
        f.y += ((hb + hs + hp + hq) / 4 - f.draft - f.y) * k;
        f.pitch += (Math.atan2(hs - hb, 2 * L) - f.pitch) * k;
        f.roll += (Math.atan2(hq - hp, 2 * B) - f.roll) * k;
        f.o.position.y = f.y;
        f.o.rotation.set(f.pitch, f.h, f.roll, 'YXZ');
      }
    },
  };
}
