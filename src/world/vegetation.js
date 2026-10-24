// Spruce/larch forests (instanced, 2 LODs), boulders and a camera-following grass field.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Simplex2, mulberry32, smoothstep } from '../util/noise.js';
import { heightAt, normalAt, NEAR, sampleHeight, sampleNormal } from './terrain.js';
import { riverCoords, waterY, riverRocks, halfWidth, centerX, ISLANDS } from './river.js';

// ---------- Trees ----------
// Norway spruce built from folded, drooping "frond" cards (SpeedTree-style) around a textured core.
// All tree parts share one procedural needle atlas (row 0 = top, flipY off):
const ATLAS = 1024;
const FROND_A = { x: 0, y: 0, w: 1024, h: 400 };    // branch spray seen from above, base -> tip = left -> right
const FROND_B = { x: 0, y: 408, w: 1024, h: 400 };  // second spray variant
const CORE = { x: 0, y: 816, w: 960, h: 208 };      // whole inner crown, bottom -> top = left -> right
const BARK = { x: 968, y: 824, w: 48, h: 192 };     // opaque bark strip
const atlasUV = (R, t, s) => [(R.x + 1 + t * (R.w - 2)) / ATLAS, (R.y + 1 + s * (R.h - 2)) / ATLAS];

// Paints a needle spray: an axis with alternating side shoots, tertiary shoots and bottle-brush needles.
function paintSpray(ctx, R, seed, o) {
  const rnd = mulberry32(seed);
  const pad = 8;
  const x0 = R.x + pad, len = R.w - 2 * pad, cy = R.y + R.h / 2, H2 = R.h / 2 - pad;
  const axisAt = (t) => [x0 + t * len, cy + (Math.sin(t * 3.0 + o.phase) * 0.05 + Math.sin(t * 9.0 + o.phase * 2.0) * 0.015) * H2 * t];
  const pal = o.palette, NT = pal.length;
  // is (x, y) inside the spray envelope (with a margin for the needles)?
  const inside = (x, y, m) => {
    const te = (x - x0) / len;
    if (te > 1 || x > x0 + len - m) return false;
    return Math.abs(y - cy) < o.env(Math.max(0, te)) * (H2 - m) + 6 && Math.abs(y - cy) < H2 - m;
  };
  ctx.save();
  ctx.beginPath(); ctx.rect(R.x + 2, R.y + 2, R.w - 4, R.h - 4); ctx.clip();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  const shoot = (sx, sy, ang, l, target, curl) => {
    const n = Math.max(2, Math.ceil(l / 5));
    const pts = [];
    let x = sx, y = sy, a = ang;
    for (let i = 0; i <= n; i++) {
      pts.push([x, y, i / n]);
      a += (target - a) * curl / n + (rnd() - 0.5) * 0.12;
      x += Math.cos(a) * l / n; y += Math.sin(a) * l / n;
    }
    return pts;
  };
  const strokeChunks = (pts, w0, w1, style) => {
    ctx.strokeStyle = style;
    const n = pts.length - 1;
    for (let c = 0; c < 3; c++) {
      const i0 = Math.floor(n * c / 3), i1 = Math.floor(n * (c + 1) / 3);
      if (i1 <= i0) continue;
      ctx.lineWidth = w0 + (w1 - w0) * (c / 2);
      ctx.beginPath(); ctx.moveTo(pts[i0][0], pts[i0][1]);
      for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
  };
  // needles bucketed by tone so each group is a handful of stroke() calls
  const buckets = Array.from({ length: NT + 1 }, () => []);
  const needles = (pts, nl0, tone0, tipT) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay, s] = pts[i], [bx, by] = pts[i + 1];
      const dir = Math.atan2(by - ay, bx - ax);
      const seg = Math.hypot(bx - ax, by - ay);
      const cnt = Math.max(1, Math.round(seg / o.step));
      for (let k = 0; k < cnt; k++) {
        const q = k / cnt;
        const px = ax + (bx - ax) * q, py = ay + (by - ay) * q;
        const ss = s + q / (pts.length - 1);
        for (let side = -1; side <= 1; side += 2) {
          const na = dir + side * (0.5 + rnd() * 0.75);
          const nl = nl0 * (0.7 + rnd() * 0.5) * (1 - 0.35 * ss);
          const tone = tone0 + ss * 0.45 + tipT * 0.25 + (rnd() - 0.5) * 0.55;
          let b = Math.max(0, Math.min(NT - 1, Math.floor(tone * NT)));
          if (ss > 0.82 && rnd() < o.fresh) b = NT;        // fresh light-green shoot tips
          buckets[b].push(px, py, px + Math.cos(na) * nl, py + Math.sin(na) * nl);
        }
        if (rnd() < 0.4) {
          const na = dir + (rnd() - 0.5) * 0.5, nl = nl0 * 0.8 * (1 - 0.3 * ss);
          const b = Math.max(0, Math.min(NT - 1, Math.floor((tone0 + 0.25 + ss * 0.4 + rnd() * 0.3) * NT)));
          buckets[b].push(px, py, px + Math.cos(na) * nl, py + Math.sin(na) * nl);
        }
      }
    }
  };
  const flush = () => {
    ctx.lineWidth = o.needleW;
    for (let b = 0; b <= NT; b++) {
      const L = buckets[b];
      if (!L.length) continue;
      ctx.strokeStyle = b === NT ? o.freshColor : pal[b];
      ctx.beginPath();
      for (let i = 0; i < L.length; i += 4) { ctx.moveTo(L[i], L[i + 1]); ctx.lineTo(L[i + 2], L[i + 3]); }
      ctx.stroke();
      L.length = 0;
    }
  };

  // main axis (woody, visible where the inner branch is bare)
  const axisPts = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40 * 0.97; const [x, y] = axisAt(t); axisPts.push([x, y, t]); }
  if (o.axisW > 0) strokeChunks(axisPts, o.axisW, o.axisW * 0.35, o.wood);

  // side shoots, base to tip, alternating sides
  let t = o.t0, side = rnd() < 0.5 ? -1 : 1;
  while (t < 0.97) {
    const [sx, sy] = axisAt(t);
    const ang = side * o.angAt(t) * (0.75 + rnd() * 0.5);
    const target = side * o.bendTo;
    // length so that the shoot tip lands inside the (irregular) envelope, never at the region border
    const jit = (rnd() < 0.18 ? 0.45 : 0.68) + rnd() * 0.32;
    let l = 40;
    for (let it = 0; it < 3; it++) {
      const aAvg = ang + (target - ang) * 0.35;
      const adv = Math.cos(aAvg) * l / len;
      const reach = o.env(Math.min(1, Math.max(0, t + adv * 0.7))) * (H2 - o.nl * 1.6) * jit;
      l = Math.max(12, reach / Math.max(0.25, Math.abs(Math.sin(aAvg))));
    }
    let main;
    for (let it = 0; it < 5; it++) {
      main = shoot(sx, sy, ang, l, target, o.curl * (0.5 + rnd()));
      if (main.every(([x, y]) => inside(x, y, o.nl * 1.3))) break;
      l *= 0.8;
    }
    const group = [main];
    // tertiary shoots
    let s = 0.12 + rnd() * 0.08, tside = rnd() < 0.5 ? -1 : 1;
    while (s < 0.86) {
      const idx = Math.floor(s * (main.length - 1));
      const [px, py] = main[idx], [qx, qy] = main[Math.min(idx + 1, main.length - 1)];
      const d = Math.atan2(qy - py, qx - px);
      let tl = Math.max(10, l * (0.22 + 0.3 * (1 - s)) * (0.6 + rnd() * 0.6)) * o.tert;
      let tp;
      for (let it = 0; it < 4; it++) {   // shrink tertiaries that would poke out of the envelope
        tp = shoot(px, py, d + tside * (0.7 + rnd() * 0.35), tl, d + tside * 0.25, 0.6);
        const [ex, ey] = tp[tp.length - 1];
        if (inside(ex, ey, o.nl * 1.2)) break;
        tl *= 0.7;
      }
      group.push(tp);
      s += (o.tertGap + rnd() * 10) / l;
      tside = -tside;
    }
    // dark dense undercoat -> twig -> needles
    for (const p of group) strokeChunks(p, o.nl * 1.5, o.nl * 0.75, o.under);
    ctx.lineWidth = 1.4;
    for (const p of group) strokeChunks(p, 1.8, 1.0, o.wood);
    group.forEach((p, gi) => needles(p, gi === 0 ? o.nl * 1.1 : o.nl, 0.18 + t * 0.2, t));
    flush();
    t += o.gap * (0.6 + rnd() * 0.9) * (1 - 0.35 * t);
    side = rnd() < 0.85 ? -side : side;
  }
  // needles along the axis itself, mid-toned so the rachis doesn't read as a bright or dark line
  needles(axisPts.filter(p => p[2] > o.t0), o.nl * 0.95, 0.16, 0.2);
  flush();
  ctx.restore();
}

// Builds the atlas and uploads it with hand-made mipmaps: colour is dilated into transparent texels
// (no dark fringes) and every level is alpha-scaled to keep the level-0 coverage (trees don't thin out).
let _branchTex = null;
function branchTexture() {
  if (_branchTex) return _branchTex;
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS;
  const ctx = c.getContext('2d');
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const ramp = (stops, n) => Array.from({ length: n }, (_, i) => {
    const x = i / (n - 1) * (stops.length - 1), j = Math.min(stops.length - 2, Math.floor(x));
    const m = mix(stops[j], stops[j + 1], x - j);
    return `rgb(${m[0]},${m[1]},${m[2]})`;
  });
  const palette = ramp([[18, 36, 27], [30, 58, 41], [44, 78, 51], [66, 100, 60]], 8);
  const common = {
    palette, freshColor: 'rgb(86,116,60)', under: 'rgb(13,27,20)', wood: 'rgb(52,38,28)',
    step: 2.3, needleW: 1.7, nl: 10, tert: 1, tertGap: 24, curl: 0.55, bendTo: 0, fresh: 0.25,
  };
  const frondEnv = (t0, peak) => (t) => {
    if (t <= t0) return 0;
    const u = (t - t0) / (1 - t0);
    const e = u < peak ? Math.pow(Math.sin(u / peak * Math.PI / 2), 0.7) : Math.pow(Math.max(0, 1 - ((u - peak) / (1 - peak)) ** 1.7), 0.75);
    return e;
  };
  paintSpray(ctx, FROND_A, 11, { ...common, phase: 0.3, t0: 0.06, env: frondEnv(0.04, 0.45), angAt: (t) => 1.05 - 0.45 * t, gap: 0.021, axisW: 7 });
  paintSpray(ctx, FROND_B, 23, { ...common, phase: 2.1, t0: 0.08, env: frondEnv(0.06, 0.4), angAt: (t) => 0.95 - 0.4 * t, gap: 0.024, axisW: 6, curl: 0.7, nl: 11, fresh: 0.3 });
  paintSpray(ctx, CORE, 37, {
    ...common, phase: 1.0, t0: 0.02, gap: 0.012, axisW: 0, nl: 9, tert: 0.9, fresh: 0.05,
    env: (t) => smoothstep(0, 0.05, t) * Math.pow(1 - t, 0.75),
    angAt: (t) => 1.95 - 1.3 * smoothstep(0.8, 1.0, t), bendTo: 2.3, curl: 0.35,
  });
  // bark strip
  const br = mulberry32(5);
  ctx.fillStyle = 'rgb(70,52,40)';
  ctx.fillRect(BARK.x, BARK.y, BARK.w, BARK.h);
  for (let i = 0; i < 90; i++) {
    const g = 40 + br() * 50 | 0;
    ctx.fillStyle = `rgba(${g + 12},${g},${g * 0.8 | 0},0.6)`;
    ctx.fillRect(BARK.x + br() * BARK.w, BARK.y + br() * BARK.h, 1 + br() * 3, 6 + br() * 30);
  }

  // ---- mip chain (premultiplied float box filter) ----
  const src = ctx.getImageData(0, 0, ATLAS, ATLAS).data;
  const levels = [];
  let w = ATLAS, h = ATLAS;
  let pm = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = src[i * 4 + 3] / 255;
    pm[i * 4] = src[i * 4] / 255 * a; pm[i * 4 + 1] = src[i * 4 + 1] / 255 * a; pm[i * 4 + 2] = src[i * 4 + 2] / 255 * a; pm[i * 4 + 3] = a;
  }
  levels.push({ w, h, pm });
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), out = new Float32Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const xa = Math.min(2 * x, w - 1), xb = Math.min(2 * x + 1, w - 1), ya = Math.min(2 * y, h - 1), yb = Math.min(2 * y + 1, h - 1);
      const i00 = (ya * w + xa) * 4, i01 = (ya * w + xb) * 4, i10 = (yb * w + xa) * 4, i11 = (yb * w + xb) * 4, o = (y * nw + x) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = (pm[i00 + k] + pm[i01 + k] + pm[i10 + k] + pm[i11 + k]) * 0.25;
    }
    levels.push({ w: nw, h: nh, pm: out });
    w = nw; h = nh; pm = out;
  }
  // un-premultiply; empty texels inherit the colour of the next coarser level ("pull" fill)
  for (let L = levels.length - 1; L >= 0; L--) {
    const lv = levels[L], par = levels[L + 1];
    const rgb = new Float32Array(lv.w * lv.h * 3);
    for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
      const i = y * lv.w + x, a = lv.pm[i * 4 + 3];
      if (a > 0.004) { rgb[i * 3] = lv.pm[i * 4] / a; rgb[i * 3 + 1] = lv.pm[i * 4 + 1] / a; rgb[i * 3 + 2] = lv.pm[i * 4 + 2] / a; }
      else if (par) {
        const j = (Math.min(par.h - 1, y >> 1) * par.w + Math.min(par.w - 1, x >> 1)) * 3;
        rgb[i * 3] = par.rgb[j]; rgb[i * 3 + 1] = par.rgb[j + 1]; rgb[i * 3 + 2] = par.rgb[j + 2];
      } else { rgb[i * 3] = 0.12; rgb[i * 3 + 1] = 0.22; rgb[i * 3 + 2] = 0.15; }
    }
    lv.rgb = rgb;
  }
  // coverage-preserving alpha scale per level
  const CUT = 0.5;
  const coverage = (lv, s) => { let n = 0; for (let i = 3; i < lv.pm.length; i += 4) if (lv.pm[i] * s >= CUT) n++; return n / (lv.w * lv.h); };
  const c0 = coverage(levels[0], 1);
  const mipmaps = levels.map((lv, L) => {
    let s = 1;
    if (L > 0) {
      let lo = 1, hi = 4;
      for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; if (coverage(lv, m) < c0) lo = m; else hi = m; }
      s = (lo + hi) / 2;
    }
    const data = new Uint8Array(lv.w * lv.h * 4);
    for (let i = 0; i < lv.w * lv.h; i++) {
      data[i * 4] = Math.min(255, lv.rgb[i * 3] * 255 + 0.5);
      data[i * 4 + 1] = Math.min(255, lv.rgb[i * 3 + 1] * 255 + 0.5);
      data[i * 4 + 2] = Math.min(255, lv.rgb[i * 3 + 2] * 255 + 0.5);
      data[i * 4 + 3] = Math.min(255, lv.pm[i * 4 + 3] * s * 255 + 0.5);
    }
    return { data, width: lv.w, height: lv.h };
  });
  const t = new THREE.DataTexture(mipmaps[0].data, ATLAS, ATLAS, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.mipmaps = mipmaps;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  t.needsUpdate = true;
  _branchTex = t;
  return t;
}

// Soft "volumetric" normal: outward from the trunk axis and tilted up, so the crown shades like one
// fluffy cone instead of a set of flat cards. (fx, fz) is used close to the axis where radial is undefined.
const TREE_UP = 0.62;
function crownNormal(x, z, fx, fz, out, cardN = null, cardW = 0) {
  const rl = Math.hypot(x, z), k = Math.min(1, rl / 0.035);
  const nx = (rl > 1e-6 ? x / rl : 0) * k + fx * (1 - k), nz = (rl > 1e-6 ? z / rl : 0) * k + fz * (1 - k);
  out.set(nx, TREE_UP, nz).normalize();
  if (cardN) out.addScaledVector(cardN, cardW).normalize();
  return out;
}
// Ambient occlusion: dark towards the trunk and in the lower crown.
const crownAO = (rr, f) => (0.36 + 0.64 * smoothstep(0.08, 0.95, rr)) * (0.74 + 0.26 * Math.pow(f, 0.8));
const crownProfile = (y0, Rmax) => (y) => {
  const f = Math.min(1, Math.max(0, (y - y0) / (1 - y0)));
  return Rmax * Math.pow(1 - f, 0.92) * (1 + 0.14 * Math.sin(f * Math.PI)) + 0.004;
};

class TreeMesh {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.und = []; this.idx = []; }
  // under: how much darker the back (under) face is; fade: hide the card when seen edge-on
  v(p, n, uv, c, under = 0, fade = 0) {
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(uv[0], uv[1]);
    this.col.push(c[0], c[1], c[2]); this.und.push(under, fade);
    return this.pos.length / 3 - 1;
  }
  quad(a, b, c, d) { this.idx.push(a, b, c, b, d, c); }   // a b / c d, front face = (b-a) x (c-a)
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aCard', new THREE.Float32BufferAttribute(this.und, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
const tint = (ao, rr) => [ao * (0.9 + 0.1 * rr), ao, ao * (1.0 - 0.05 * rr)];

// Near LOD: unit height (base y=0, top y=1).
function spruceGeometry(seed) {
  const rnd = mulberry32(seed * 7919 + 101);
  const M = new TreeMesh();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const n = new THREE.Vector3();
  const y0 = 0.075 + rnd() * 0.04;
  const Rmax = 0.2 + rnd() * 0.025;
  const crownR = crownProfile(y0, Rmax);
  const fOf = (y) => Math.min(1, Math.max(0, (y - y0) / (1 - y0)));

  // trunk (5 sides, bark): visible below the crown, fading into the shade inside it
  const TS = 5, rings = [[0, 0.011, 0.75, 0], [y0 + 0.03, 0.0075, 0.4, 0.3], [0.34, 0.0035, 0.06, 1]];
  for (let i = 0; i <= TS; i++) {
    const a = i / TS * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    n.set(ca, 0, sa);
    for (const [y, r, c, v] of rings) M.v(V(ca * r, y, sa * r), n, atlasUV(BARK, i / TS, v), [c, c, c]);
  }
  for (let i = 0; i < TS; i++) for (let j = 0; j < 2; j++) M.quad((i + 1) * 3 + j, i * 3 + j, (i + 1) * 3 + j + 1, i * 3 + j + 1);

  // core: three crossed vertical planes painted with the inner-crown texture (fills gaps, forms the leader)
  const a0c = rnd() * Math.PI;
  for (let k = 0; k < 3; k++) {
    const a = a0c + k * Math.PI / 3, dx = Math.cos(a), dz = Math.sin(a);
    const ids = [];
    for (const ty of [0, 0.5, 1]) {
      const y = y0 - 0.02 + ty * (1.0 - y0 + 0.02);
      const hw = Math.max(0.006, crownR(y) * 0.6);
      const row = [];
      for (const s of [-1, 0, 1]) {
        const p = V(dx * hw * s, y, dz * hw * s);
        crownNormal(p.x, p.z, dx * s, dz * s, n);
        if (s === 0) n.set(0, 1, 0);
        const rr = Math.abs(s) * 0.5;
        const ao = crownAO(rr, fOf(y)) * 0.9;
        row.push(M.v(p, n, atlasUV(CORE, ty, (s + 1) / 2), tint(ao, rr), 0, 1));
      }
      ids.push(row);
    }
    for (let r = 0; r < 2; r++) { M.quad(ids[r][0], ids[r][1], ids[r + 1][0], ids[r + 1][1]); M.quad(ids[r][1], ids[r][2], ids[r + 1][1], ids[r + 1][2]); }
  }

  // fronds, whorl by whorl
  const NW = 18 + (rnd() * 3 | 0);
  const yTop = 0.95;
  const up = V(0, 1, 0);
  for (let w = 0; w < NW; w++) {
    const f = w / (NW - 1);
    const y = y0 + (yTop - y0) * Math.pow(f, 0.93) + (rnd() - 0.5) * 0.01;
    const R = crownR(y);
    const cnt = Math.max(3, Math.round(7.2 - 3.8 * f + (rnd() - 0.5) * 1.3));
    const a0 = rnd() * Math.PI * 2;
    for (let b = 0; b < cnt; b++) {
      const az = a0 + (b + (rnd() - 0.5) * 0.6) * Math.PI * 2 / cnt;
      const ca = Math.cos(az), sa = Math.sin(az);
      const out = V(ca, 0, sa), lat = V(-sa, 0, ca);
      // lower branches sag then turn up at the tip; upper ones point upwards
      const e1 = (f < 0.75 ? -0.42 + f * 0.7 : -0.105 + (f - 0.75) * 2.2) * (0.75 + rnd() * 0.5);
      const e2 = e1 + (0.55 - f * 0.35) * (0.7 + rnd() * 0.6);
      const L = R * (0.8 + rnd() * 0.4) / (0.5 * Math.cos(e1) + 0.5 * Math.cos(e2));
      const W = L * (0.68 + rnd() * 0.2) * (f > 0.85 ? 1.2 : 1);
      const fold = (0.82 - f * 0.4) + (rnd() - 0.5) * 0.16;
      const foldK = [1 + (rnd() - 0.5) * 0.35, 1, 1 + (rnd() - 0.5) * 0.35];   // halves not symmetric
      const roll = (rnd() - 0.5) * 0.4;
      const reg = rnd() < 0.5 ? FROND_A : FROND_B;
      const flip = rnd() < 0.5;
      // branches also curve sideways a little
      const sweep = (rnd() - 0.5) * 0.6;
      const h1 = out.clone().multiplyScalar(Math.cos(sweep * 0.3)).addScaledVector(lat, Math.sin(sweep * 0.3));
      const h2 = out.clone().multiplyScalar(Math.cos(sweep)).addScaledVector(lat, Math.sin(sweep));
      const d1 = h1.multiplyScalar(Math.cos(e1)).addScaledVector(up, Math.sin(e1));
      const d2 = h2.multiplyScalar(Math.cos(e2)).addScaledVector(up, Math.sin(e2));
      const P0 = V(ca * 0.006, y, sa * 0.006);
      const P1 = P0.clone().addScaledVector(d1, L * 0.5);
      const P2 = P1.clone().addScaledVector(d2, L * 0.5);
      const secs = [[P0, d1, 0.34, 0], [P1, d1.clone().add(d2).normalize(), 1, 0.5], [P2, d2, 0.8, 1]];
      const ids = [];
      for (const [P, T, wk, tu] of secs) {
        const S = lat.clone().multiplyScalar(Math.cos(roll)).addScaledVector(up, Math.sin(roll));
        const U = new THREE.Vector3().crossVectors(S, T).normalize();
        S.crossVectors(T, U).normalize();
        const half = W * wk * 0.5;
        const row = [];
        for (const s of [-1, 0, 1]) {
          const p = P.clone();
          const fo = fold * foldK[s + 1];
          if (s !== 0) p.addScaledVector(S, s * Math.cos(fo) * half).addScaledVector(U, -Math.sin(fo) * half);
          const cardN = s === 0 ? U : U.clone().multiplyScalar(Math.cos(fo)).addScaledVector(S, s * Math.sin(fo));
          crownNormal(p.x, p.z, ca, sa, n, cardN, 0.08);
          const rr = Math.min(1.1, Math.hypot(p.x, p.z) / Math.max(0.03, crownR(p.y)));
          const ao = crownAO(rr, fOf(p.y)) * (s === 0 ? 1 : 0.9);
          const vv = flip ? (1 - s) / 2 : (s + 1) / 2;
          row.push(M.v(p, n, atlasUV(reg, tu, vv), tint(ao, rr), 0.38, 1));
        }
        ids.push(row);
      }
      for (let r = 0; r < 2; r++) {
        M.quad(ids[r][0], ids[r][1], ids[r + 1][0], ids[r + 1][1]);
        M.quad(ids[r][1], ids[r][2], ids[r + 1][1], ids[r + 1][2]);
      }
    }
  }
  return M.build();
}

// Far LOD (<= 60 triangles): five overlapping skirts painted with the same frond texture, so colour,
// shading and the scalloped layered outline match the near trees.
function farTreeGeometry() {
  const M = new TreeMesh();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const n = new THREE.Vector3();
  const y0 = 0.095, crownR = crownProfile(y0, 0.2125);
  const fOf = (y) => Math.min(1, Math.max(0, (y - y0) / (1 - y0)));
  const TIERS = 5, SEG = 5;
  const K = 0.7;   // calibrated so the far LOD matches the near trees' average brightness
  const tk = (ao, rr) => tint(ao * K, rr * 0.5);
  for (let k = 0; k < TIERS; k++) {
    const yb = y0 - 0.035 + k * 0.17, yt = Math.min(1.0, yb + (k === TIERS - 1 ? 0.3 : 0.27));
    const rb = crownR(yb + 0.04) * 1.3, rt = k === TIERS - 1 ? 0.0 : crownR(yt) * 0.35;
    const a0 = k * 0.9;
    const ids = [];
    for (let i = 0; i <= SEG; i++) {
      const a = a0 + i / SEG * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const pt = V(ca * rt, yt, sa * rt), pb = V(ca * rb, yb, sa * rb);
      const v = i % 2 ? 1 : 0;   // mirror every other face so neighbours meet with matching edges
      crownNormal(pt.x, pt.z, ca, sa, n);
      const it = M.v(pt, n, atlasUV(FROND_A, 0.12, v), tk(crownAO(0.35, fOf(yt)), 0.35));
      crownNormal(pb.x, pb.z, ca, sa, n);
      const ib = M.v(pb, n, atlasUV(FROND_A, 1, v), tk(crownAO(1, fOf(yb)) * 0.86, 1));
      ids.push([it, ib]);
    }
    for (let i = 0; i < SEG; i++) M.quad(ids[i][0], ids[i + 1][0], ids[i][1], ids[i + 1][1]);
  }
  // trunk stub + thin leader as crossed cards
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI / 2, dx = Math.cos(a) * 0.012, dz = Math.sin(a) * 0.012;
    n.set(0, 0.3, 1).normalize();
    const bc = [0.6, 0.6, 0.6], tc = [0.35, 0.35, 0.35];
    const b = [M.v(V(-dx, 0, -dz), n, atlasUV(BARK, 0, 0), bc), M.v(V(dx, 0, dz), n, atlasUV(BARK, 1, 0), bc),
      M.v(V(-dx * 0.6, y0 + 0.06, -dz * 0.6), n, atlasUV(BARK, 0, 1), tc), M.v(V(dx * 0.6, y0 + 0.06, dz * 0.6), n, atlasUV(BARK, 1, 1), tc)];
    M.quad(b[0], b[1], b[2], b[3]);
    const lx = Math.cos(a) * 0.03, lz = Math.sin(a) * 0.03;
    n.set(0, 1, 0);
    const c = tk(crownAO(0.5, 1), 0.5);
    const l = [M.v(V(-lx, 0.9, -lz), n, atlasUV(CORE, 0.86, 0), c), M.v(V(lx, 0.9, lz), n, atlasUV(CORE, 0.86, 1), c),
      M.v(V(-lx, 1.01, -lz), n, atlasUV(CORE, 1, 0), c), M.v(V(lx, 1.01, lz), n, atlasUV(CORE, 1, 1), c)];
    M.quad(l[0], l[1], l[2], l[3]);
  }
  return M.build();
}

const WIND_GLSL = `
  #ifdef USE_INSTANCING
    vec3 ip = instanceMatrix[3].xyz;
    float sway = sin(uTime * 1.3 + ip.x * 0.05 + ip.z * 0.07) * 0.5 + sin(uTime * 2.7 + ip.x * 0.11) * 0.25;
    transformed.x += sway * 0.025 * transformed.y * transformed.y;
    transformed.z += sway * 0.012 * transformed.y * transformed.y;
  #endif`;

function windMaterial(sharedTime, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.88, metalness: 0, map: branchTexture(),
    alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, envMapIntensity: 0.75, ...opts,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec2 aCard;\nvarying vec2 vCard;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvCard = aCard;${WIND_GLSL}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCard;')
      // keep the soft crown normal on both faces (no flip for back faces) ...
      .replace('#include <normal_fragment_begin>', `float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
        vec3 normal = normalize( vNormal );
        // seen from "behind" the crown normal (e.g. from below): turn it towards the viewer so the
        // foliage doesn't get grazing-angle sky sheen
        vec3 viewDirN = normalize( vViewPosition );
        normal = normalize( normal + viewDirN * max( 0.0, 0.3 - dot( normal, viewDirN ) ) );
        vec3 nonPerturbedNormal = normal;`)
      // needles are matte: keep only a little of the specular
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directSpecular *= 0.35;
        reflectedLight.indirectSpecular *= 0.25;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // ... but the underside of a branch is darker than its top
        diffuseColor.rgb *= gl_FrontFacing ? 1.0 : 1.0 - vCard.x;
        // cards seen almost edge-on fade out instead of showing up as flat planks / streaks
        vec3 cardN = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
        float facing = abs( dot( cardN, normalize( vViewPosition ) ) );
        diffuseColor.a *= mix( 1.0, smoothstep( 0.06, 0.22, facing ), vCard.y );`);
  };
  m.customProgramCacheKey = () => 'wind-tree-v3';
  return m;
}

// Shadow-pass material with the same sway (map + alphaTest are copied from the main material by three).
function windDepthMaterial(sharedTime) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>${WIND_GLSL}`);
  };
  m.customProgramCacheKey = () => 'wind-tree-depth';
  return m;
}

export function createForest(scene, sharedTime, exclusions = []) {
  const rnd = mulberry32(2024);
  const rnd2 = mulberry32(4048);   // per-tree look (kept separate so the layout stays the same)
  const dens = new Simplex2(55);
  const trees = [];
  const tmp = {};
  const nrm = new THREE.Vector3();
  let attempts = 0;
  while (trees.length < 24000 && attempts < 340000) {
    attempts++;
    const x = NEAR.x0 + 20 + rnd() * (NEAR.x1 - NEAR.x0 - 40);
    const z = NEAR.z0 + 20 + rnd() * (NEAR.z1 - NEAR.z0 - 40);
    riverCoords(x, z, tmp);
    const e = Math.abs(tmp.d) - tmp.hw;
    const y = sampleHeight(x, z);
    const hAW = y - waterY(z);
    const island = e < 0 && hAW > 1.2;           // lake islands get a few trees too
    if (e < 14 && !island) continue;
    if (hAW < 2.2 && !island) continue;          // keep side-river banks open
    if (y > 1050) continue;
    sampleNormal(x, z, nrm);
    if (nrm.y < 0.62) continue;
    // forest patches on the slopes, scattered singles + riparian line near water
    const f = dens.fbm(x * 0.004, z * 0.004, 3) + 0.25 * smoothstep(60, 400, e);
    const riparian = Math.exp(-((e - 22) ** 2) / 60) * 0.35;
    const p = smoothstep(0.05, 0.35, f) * 0.95 + 0.025 + riparian;
    if (rnd() > p) continue;
    let bad = false;
    for (const ex of exclusions) if ((ex.x - x) ** 2 + (ex.z - z) ** 2 < ex.r * ex.r) { bad = true; break; }
    if (bad) continue;
    const h = (14 + rnd() * 18) * (1 - smoothstep(700, 1050, y) * 0.5);
    const larch = rnd() < 0.18;
    trees.push({ x, y: y - 0.3, z, h, rot: rnd() * Math.PI * 2, larch, tint: 0.8 + rnd() * 0.45 });
  }

  // little stands of spruce and larch on the lake islands
  for (const I of ISLANDS) {
    const n = Math.round(10 + I.r * 0.6);
    for (let k = 0, tries = 0; k < n && tries < 200; tries++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * I.r * 0.72;
      const x = I.x + Math.cos(a) * rr, z = I.z + Math.sin(a) * rr;
      const y = sampleHeight(x, z);
      if (y - waterY(z) < 1.4) continue;
      trees.push({ x, y: y - 0.3, z, h: 11 + rnd() * 13, rot: rnd() * Math.PI * 2, larch: rnd() < 0.3, tint: 0.8 + rnd() * 0.45 });
      k++;
    }
  }

  const variants = [spruceGeometry(1), spruceGeometry(2), spruceGeometry(3)];
  const nearMat = windMaterial(sharedTime);
  const depthMat = windDepthMaterial(sharedTime);
  const MAXN = trees.length;
  // near trees within SHADOW_DIST cast shadows; the rest of the near LOD skips the shadow pass
  // (instanced meshes aren't culled per instance, so every caster would be drawn into the shadow map)
  const mkNear = (g, shadows) => {
    const m = new THREE.InstancedMesh(g, nearMat, MAXN);
    m.castShadow = shadows; m.receiveShadow = true; m.count = 0;
    m.customDepthMaterial = depthMat;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  };
  const nearMeshes = variants.map(g => mkNear(g, true));
  const midMeshes = variants.map(g => mkNear(g, false));
  // same material as the near trees so colour and lighting match across the LOD switch
  const far = new THREE.InstancedMesh(farTreeGeometry(), nearMat, MAXN);
  far.count = 0; far.frustumCulled = false; far.receiveShadow = true;
  scene.add(far);

  const mat4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const t of trees) {
    t.wide = 0.9 + rnd2() * 0.22;
    t.hue = rnd2();
    const k = 0.86 + (t.tint - 0.8) / 0.45 * 0.28;
    t.color = t.larch
      ? new THREE.Color(1.6 * k, 1.5 * k, 0.72 * k)
      : new THREE.Color((0.88 + t.hue * 0.1) * k, 1.0 * k, (1.12 - t.hue * 0.1) * k);
  }
  const LOD_DIST = 340, SHADOW_DIST = 150;
  let last = new THREE.Vector3(1e9, 0, 0);
  function refresh(camPos) {
    if (camPos.distanceToSquared(last) < 25 * 25) return;
    last.copy(camPos);
    const counts = [0, 0, 0], midCounts = [0, 0, 0];
    let farCount = 0;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const dx = t.x - camPos.x, dz = t.z - camPos.z;
      const d2 = dx * dx + dz * dz;
      q.setFromAxisAngle(up, t.rot);
      p.set(t.x, t.y, t.z);
      s.set(t.h * t.wide, t.h, t.h * t.wide);
      mat4.compose(p, q, s);
      if (d2 < SHADOW_DIST * SHADOW_DIST) {
        const v = i % 3;
        const m = nearMeshes[v];
        m.setMatrixAt(counts[v], mat4);
        m.setColorAt(counts[v], t.color);
        counts[v]++;
      } else if (d2 < LOD_DIST * LOD_DIST) {
        const v = i % 3;
        const m = midMeshes[v];
        m.setMatrixAt(midCounts[v], mat4);
        m.setColorAt(midCounts[v], t.color);
        midCounts[v]++;
      } else {
        far.setMatrixAt(farCount, mat4);
        far.setColorAt(farCount, t.color);
        farCount++;
      }
    }
    const flush = (m, n) => {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    nearMeshes.forEach((m, v) => flush(m, counts[v]));
    midMeshes.forEach((m, v) => flush(m, midCounts[v]));
    far.count = farCount;
    far.instanceMatrix.needsUpdate = true;
    if (far.instanceColor) far.instanceColor.needsUpdate = true;
  }
  return { trees, refresh };
}

// ---------- Rocks ----------
function boulderGeometry(seed) {
  const n = new Simplex2(seed);
  let g = new THREE.IcosahedronGeometry(1, 5);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const sq = 0.6 + (seed % 3) * 0.12;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = 1 + 0.22 * n.fbm(v.x * 1.3, v.y * 1.3 + v.z * 0.7, 4) + 0.06 * n.noise(v.x * 5, v.z * 5 + v.y * 3);
    v.multiplyScalar(d);
    v.y *= sq;
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.4; // flattened base
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function createRockMaterial(rockTex, sharedTime) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tRock = { value: rockTex };
    sh.uniforms.uTime = sharedTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wpp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpp = instanceMatrix * wpp;
        #endif
        vWP = (modelMatrix * wpp).xyz;
        vec3 nn = objectNormal;
        #ifdef USE_INSTANCING
          nn = mat3(instanceMatrix) * nn;
        #endif
        vWN = normalize(mat3(modelMatrix) * nn);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; uniform sampler2D tRock;')
      .replace('#include <map_fragment>', `
        vec3 bw = pow(abs(vWN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        float sc = 0.35;
        vec3 rc = texture2D(tRock, vWP.zy * sc).rgb * bw.x + texture2D(tRock, vWP.xz * sc).rgb * bw.y + texture2D(tRock, vWP.xy * sc).rgb * bw.z;
        float hAW = vWP.y + 0.004 * vWP.z;
        float moss = smoothstep(0.55, 0.9, vWN.y) * smoothstep(0.8, 1.6, hAW);
        rc = mix(vec3(dot(rc, vec3(0.33))), rc, 0.6) * 0.78;
        rc = mix(rc, vec3(0.16, 0.26, 0.08) * (0.7 + rc.g), moss * 0.85);
        float wet = 1.0 - smoothstep(-0.1, 0.5, hAW);
        rc *= mix(1.0, 0.5, wet);
        if (hAW < 0.0) rc *= exp(hAW * vec3(0.3, 0.1, 0.09));
        diffuseColor.rgb *= rc;
        float rRough = mix(0.88, 0.3, wet);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rRough;');
  };
  m.customProgramCacheKey = () => 'rock-tri';
  return m;
}

export function createRocks(scene, rockTex, sharedTime) {
  const rnd = mulberry32(31);
  const geos = [boulderGeometry(3), boulderGeometry(7), boulderGeometry(12)];
  const mat = createRockMaterial(rockTex, sharedTime);
  const list = [];
  // In-river boulders from the river definition
  for (const r of riverRocks) {
    const wy = waterY(r.z);
    list.push({ x: r.x, y: wy + r.top - r.r * 0.75, z: r.z, s: r.r, sy: r.r * 0.9, rot: rnd() * 6.28 });
  }
  // Bank boulders and scattered meadow rocks
  const tmp = {};
  for (let i = 0; i < 1800; i++) {
    const z = NEAR.z0 + 40 + rnd() * (NEAR.z1 - NEAR.z0 - 80);
    const side = rnd() < 0.5 ? -1 : 1;
    const hw = halfWidth(z);
    const e = rnd() < 0.7 ? rnd() * 18 - 2 : 20 + rnd() * 400;
    riverCoords(0, z, tmp);
    const x = centerX(z) + (side * (hw + e)) / tmp.tz;
    const y = sampleHeight(x, z);
    const s = e < 18 ? 0.3 + Math.pow(rnd(), 2.5) * 2.2 : 0.6 + Math.pow(rnd(), 2) * 4;
    list.push({ x, y: y - s * 0.25, z, s, sy: s * (0.7 + rnd() * 0.5), rot: rnd() * 6.28 });
  }
  const meshes = geos.map(g => {
    const m = new THREE.InstancedMesh(g, mat, list.length);
    m.castShadow = true; m.receiveShadow = true; m.count = 0;
    scene.add(m);
    return m;
  });
  const mat4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  list.forEach((r, i) => {
    const m = meshes[i % 3];
    e.set((rnd() - 0.5) * 0.3, r.rot, (rnd() - 0.5) * 0.3);
    q.setFromEuler(e);
    mat4.compose(new THREE.Vector3(r.x, r.y, r.z), q, new THREE.Vector3(r.s, r.sy, r.s * (0.8 + rnd() * 0.4)));
    m.setMatrixAt(m.count++, mat4);
  });
  meshes.forEach(m => { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); });
  return { meshes, material: mat };
}


// ---------- Grass ----------
const grassVert = /* glsl */`
  attribute vec2 aOffset;
  attribute vec4 aRand;
  attribute vec3 aFlower;
  attribute float aHead;
  uniform vec2 uCenter;
  uniform float uSize;
  uniform sampler2D tHeight;
  uniform vec2 uHOrigin, uHSize;
  uniform float uTime;
  varying float vTip;
  varying vec3 vCol;
  varying float vHead;
  varying vec3 vWP;
  #include <fog_pars_vertex>
  void main() {
    vec2 base = aOffset * uSize;
    vec2 wxz = base + uSize * floor((uCenter - base) / uSize + 0.5);
    vec2 huv = (wxz - uHOrigin) / uHSize;
    vec2 hd = texture2D(tHeight, huv).rg;
    float inside = step(0.0, huv.x) * step(huv.x, 1.0) * step(0.0, huv.y) * step(huv.y, 1.0);
    float keep = step(aRand.w, hd.g) * inside;
    float dist = length(wxz - uCenter);
    float fade = 1.0 - smoothstep(uSize * 0.36, uSize * 0.5, dist);
    float sc = aRand.y * keep * fade;
    float flower = step(0.001, aFlower.r + aFlower.g + aFlower.b);
    vec3 p = position;
    p.xz *= mix(1.0, 1.0, flower);
    if (aHead > 0.5) p *= flower;   // flower heads only exist on flower clumps
    float c = cos(aRand.x), s = sin(aRand.x);
    p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
    float tip = clamp(position.y / 0.55, 0.0, 1.0);
    float gust = sin(uTime * 1.7 + wxz.x * 0.09 + wxz.y * 0.05) * 0.6 + sin(uTime * 3.1 + wxz.x * 0.3) * 0.25;
    p.x += gust * 0.16 * tip * tip;
    p.z += gust * 0.07 * tip * tip;
    vec3 wp = vec3(wxz.x, hd.r - 0.05, wxz.y) + p * sc;
    vTip = tip;
    vHead = aHead * flower;
    vCol = mix(vec3(0.9, 1.0, 0.75), vec3(1.15, 1.08, 0.7), aRand.z);
    vCol = aHead > 0.5 ? aFlower : vCol;
    vWP = wp;
    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const grassFrag = /* glsl */`
  uniform vec3 uSunColor, uSunDir, uAmbient;
  varying float vTip;
  varying vec3 vCol;
  varying float vHead;
  varying vec3 vWP;
  #include <fog_pars_fragment>
  void main() {
    vec3 root = vec3(0.07, 0.16, 0.03);
    vec3 tipc = vec3(0.36, 0.62, 0.14);
    vec3 col = mix(root, tipc, vTip) * vCol;
    if (vHead > 0.5) col = vCol;
    vec3 V = normalize(cameraPosition - vWP);
    float trans = pow(max(dot(-V, uSunDir), 0.0), 4.0) * vTip;
    vec3 light = uAmbient + uSunColor * (0.55 + 0.45 * vTip) * max(uSunDir.y, 0.0) * 0.9 + uSunColor * trans * 0.6;
    gl_FragColor = vec4(col * light, 1.0);
    #include <fog_fragment>
  }
`;

function grassClumpGeometry() {
  const pos = [], head = [];
  const blades = 5;
  const rnd = mulberry32(8);
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rnd();
    const ox = Math.cos(a) * 0.08 * rnd(), oz = Math.sin(a) * 0.08 * rnd();
    const h = 0.35 + rnd() * 0.25;
    const lean = 0.08 + rnd() * 0.12;
    const w = 0.035;
    const dir = [Math.cos(a), Math.sin(a)];
    const side = [-dir[1], dir[0]];
    const seg = (t, ww) => [ox + dir[0] * lean * t * t + side[0] * ww, h * t, oz + dir[1] * lean * t * t + side[1] * ww];
    const p0 = seg(0, -w), p1 = seg(0, w), p2 = seg(0.5, -w * 0.75), p3 = seg(0.5, w * 0.75), p4 = seg(1, 0);
    pos.push(...p0, ...p1, ...p2, ...p2, ...p1, ...p3, ...p2, ...p3, ...p4);
    for (let i = 0; i < 9; i++) head.push(0);
  }
  // flower stalk head (two crossed quads at ~0.5 m)
  const hy = 0.5, hs = 0.05;
  const quad = (ax, az) => {
    const a = [-ax * hs, hy - hs, -az * hs], b = [ax * hs, hy - hs, az * hs], c = [ax * hs, hy + hs, az * hs], d = [-ax * hs, hy + hs, -az * hs];
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) head.push(1);
  };
  quad(1, 0); quad(0, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aHead', new THREE.Float32BufferAttribute(head, 1));
  return g;
}

export function createGrass(scene, heightBake, sharedTime, sun) {
  const COUNT = 52000;
  const SIZE = 190;
  const g = grassClumpGeometry();
  const rnd = mulberry32(77);
  const off = new Float32Array(COUNT * 2), rand = new Float32Array(COUNT * 4), flower = new Float32Array(COUNT * 3);
  const flowerCols = [[1, 1, 1], [1, 0.85, 0.15], [0.55, 0.3, 0.9], [0.2, 0.35, 1.0], [1, 0.35, 0.25], [1, 0.95, 0.8]];
  for (let i = 0; i < COUNT; i++) {
    off[i * 2] = rnd(); off[i * 2 + 1] = rnd();
    rand[i * 4] = rnd() * Math.PI * 2;
    rand[i * 4 + 1] = 0.7 + rnd() * 0.9;
    rand[i * 4 + 2] = rnd();
    rand[i * 4 + 3] = 0.05 + rnd() * 0.9;
    if (rnd() < 0.09) {
      const c = flowerCols[(rnd() * flowerCols.length) | 0];
      flower[i * 3] = c[0]; flower[i * 3 + 1] = c[1]; flower[i * 3 + 2] = c[2];
    }
  }
  g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 2));
  g.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 4));
  g.setAttribute('aFlower', new THREE.InstancedBufferAttribute(flower, 3));
  g.instanceCount = COUNT;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uCenter: { value: new THREE.Vector2() }, uSize: { value: SIZE },
    tHeight: { value: null }, uHOrigin: { value: heightBake.origin }, uHSize: { value: heightBake.size },
    uTime: { value: 0 },
    uSunColor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uAmbient: { value: new THREE.Color(0.32, 0.38, 0.45) },
  }]);
  uniforms.tHeight.value = heightBake.tex;
  uniforms.uTime = sharedTime;
  uniforms.uSunColor.value.copy(sun.color).multiplyScalar(1.0);
  uniforms.uSunDir.value.copy(sun.dir);
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: grassVert, fragmentShader: grassFrag, side: THREE.DoubleSide, fog: true });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    mesh,
    update(center) { uniforms.uCenter.value.set(center.x, center.z); },
  };
}
