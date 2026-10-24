// Alpenfisch — procedural 2.7 m spinning rod + size-3000 spinning reel.
// Everything is generated (geometry + canvas textures). Draw calls: 5
//   blank (dynamic) · thread wraps (dynamic) · guides+tip-top (dynamic) · grip/seat hardware (static) · reel (SkinnedMesh)
import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Material atlas: one colour canvas + one ORM canvas (R=clearcoat, G=roughness,
// B=metalness) + one bump canvas, shared by every hardware / reel part.
// ---------------------------------------------------------------------------
const AT = 1024;
const SW = 64;
const REG = { cork: [128, 320], eva: [448, 128], line: [576, 128], skirt: [704, 64], label: [768, 64], brushed: [832, 192] };
const SW_DEF = {
  chrome:   ['#e2e5e9', 0.10, 1.0, 0.0],
  gunmetal: ['#767c86', 0.24, 1.0, 0.0],
  paint:    ['#323843', 0.32, 0.6, 1.0],
  gold:     ['#cfa865', 0.24, 1.0, 0.25],
  rubber:   ['#151516', 0.78, 0.0, 0.0],
  sic:      ['#202226', 0.05, 0.6, 1.0],
  graphite: ['#1b1e22', 0.36, 0.3, 0.9],
  alu:      ['#b8bdc2', 0.22, 1.0, 0.0],
  brass:    ['#b58a46', 0.25, 1.0, 0.0],
  titanium: ['#9a9ea5', 0.16, 1.0, 0.0],
  black:    ['#0e0f11', 0.22, 0.1, 1.0],
  white:    ['#e9e7e1', 0.45, 0.0, 0.6],
  red:      ['#9c2128', 0.35, 0.2, 1.0],
  silver:   ['#c9cdd2', 0.28, 1.0, 0.0],
  darkalu:  ['#2e3238', 0.26, 1.0, 0.4],
  pearl:    ['#d8d2c4', 0.30, 0.3, 1.0],
};
const SWATCHES = Object.keys(SW_DEF);

function swUV(name) {
  const i = SWATCHES.indexOf(name);
  return [((i % 16) * SW + SW / 2) / AT, 1 - (Math.floor(i / 16) * SW + SW / 2) / AT];
}
// u wraps horizontally over the whole atlas width; t in 0..1 spans the region top->bottom
function regUV(name, u, t) {
  const [y0, h] = REG[name];
  return [u, 1 - (y0 + 3 + clamp(t, 0, 1) * (h - 6)) / AT];
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

let _atlas = null;
function getAtlas() {
  if (_atlas) return _atlas;
  const cc = makeCanvas(AT, AT), oc = makeCanvas(AT, AT), bc = makeCanvas(AT, AT);
  const c = cc.getContext('2d'), o = oc.getContext('2d'), b = bc.getContext('2d');
  c.fillStyle = '#808080'; c.fillRect(0, 0, AT, AT);
  o.fillStyle = 'rgb(0,128,0)'; o.fillRect(0, 0, AT, AT);
  b.fillStyle = 'rgb(128,128,128)'; b.fillRect(0, 0, AT, AT);
  SWATCHES.forEach((name, i) => {
    const [col, rough, metal, ccv] = SW_DEF[name];
    const x = (i % 16) * SW, y = Math.floor(i / 16) * SW;
    c.fillStyle = col; c.fillRect(x, y, SW, SW);
    o.fillStyle = `rgb(${Math.round(ccv * 255)},${Math.round(rough * 255)},${Math.round(metal * 255)})`;
    o.fillRect(x, y, SW, SW);
  });
  const R = rng(1234);
  const region = (ctx, name, fill) => {
    const [y0, h] = REG[name];
    ctx.save(); ctx.beginPath(); ctx.rect(0, y0, AT, h); ctx.clip();
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, y0, AT, h); }
  };
  const ell = (ctx, x, y, rx, ry, rot) => {
    for (const dx of [-AT, 0, AT]) {
      if (x + dx + rx * 2 < 0 || x + dx - rx * 2 > AT) continue;
      ctx.beginPath(); ctx.ellipse(x + dx, y, Math.max(0.3, rx), Math.max(0.3, ry), rot, 0, TAU); ctx.fill();
    }
  };

  // ---- cork (rings map 1024 px around, ~150 px per 12.5 mm ring)
  {
    const [y0, h] = REG.cork;
    region(c, 'cork', '#c49859'); region(b, 'cork', 'rgb(150,150,150)'); region(o, 'cork', 'rgb(0,200,0)');
    for (let i = 0; i < 2600; i++) {
      const x = R() * AT, y = y0 + R() * h, rx = 3 + R() * 16, ry = 2 + R() * 10, rot = R() * Math.PI, dark = R() < 0.5;
      c.fillStyle = dark ? `rgba(140,92,50,${0.07 + R() * 0.14})` : `rgba(232,198,148,${0.07 + R() * 0.16})`;
      ell(c, x, y, rx, ry, rot);
      b.fillStyle = dark ? 'rgba(105,105,105,0.12)' : 'rgba(180,180,180,0.12)';
      ell(b, x, y, rx, ry, rot);
    }
    for (let i = 0; i < 42000; i++) {
      const x = R() * AT, y = y0 + R() * h, v = R();
      c.fillStyle = v < 0.5 ? `rgba(92,60,28,${0.12 + R() * 0.25})` : `rgba(246,218,172,${0.10 + R() * 0.2})`;
      c.fillRect(x, y, R() < 0.3 ? 2 : 1, 1);
      b.fillStyle = v < 0.5 ? 'rgba(90,90,90,0.35)' : 'rgba(190,190,190,0.3)';
      b.fillRect(x, y, 1, 1);
    }
    for (let i = 0; i < 430; i++) {
      const x = R() * AT, y = y0 + R() * h;
      const s = 0.8 + Math.pow(R(), 2.8) * 7;
      const rx = s * (1 + R() * 1.6), ry = s * (0.45 + R() * 0.5), rot = R() * Math.PI;
      c.fillStyle = 'rgba(150,104,60,0.4)'; ell(c, x, y, rx * 1.5 + 1, ry * 1.5 + 1, rot);
      c.fillStyle = 'rgba(92,60,30,0.85)'; ell(c, x, y, rx, ry, rot);
      c.fillStyle = 'rgba(48,29,12,0.9)'; ell(c, x, y, rx * 0.5, ry * 0.45, rot);
      b.fillStyle = 'rgba(70,70,70,0.9)'; ell(b, x, y, rx * 1.15, ry * 1.15, rot);
      b.fillStyle = 'rgba(15,15,15,1)'; ell(b, x, y, rx * 0.6, ry * 0.55, rot);
      o.fillStyle = 'rgb(0,240,0)'; ell(o, x, y, rx, ry, rot);
    }
    for (let i = 0; i < 70; i++) { // filler putty patches
      const x = R() * AT, y = y0 + R() * h, s = 2 + R() * 5;
      c.fillStyle = 'rgba(214,182,132,0.75)'; ell(c, x, y, s * 1.4, s, R() * 3);
    }
    c.restore(); b.restore(); o.restore();
  }
  // ---- EVA foam
  {
    const [y0, h] = REG.eva;
    region(c, 'eva', '#1c1c1d'); region(b, 'eva', 'rgb(140,140,140)'); region(o, 'eva', 'rgb(0,228,0)');
    for (let i = 0; i < 30000; i++) {
      const x = R() * AT, y = y0 + R() * h, v = R();
      c.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.55)' : 'rgba(72,72,74,0.35)';
      c.fillRect(x, y, 1, 1);
      b.fillStyle = v < 0.5 ? 'rgba(30,30,30,0.85)' : 'rgba(205,205,205,0.5)';
      b.fillRect(x, y, R() < 0.3 ? 2 : 1, R() < 0.3 ? 2 : 1);
    }
    c.restore(); b.restore(); o.restore();
  }
  // ---- wound monofilament on the spool (u around the spool, t along the spool)
  {
    const [y0, h] = REG.line;
    region(c, 'line', '#6f7a22'); region(b, 'line', 'rgb(70,70,70)'); region(o, 'line', 'rgb(150,70,0)');
    for (let layer = 0; layer < 2; layer++) {
      for (let y = y0 - 24 + layer; y < y0 + h + 24; y += 3) {
        const slope = layer ? 6 : -6;
        const k = 0.85 + R() * 0.15;
        c.strokeStyle = `rgba(${(205 * k) | 0},${(214 * k) | 0},${(92 * k) | 0},${layer ? 0.6 : 0.95})`;
        c.lineWidth = 2.1; c.beginPath(); c.moveTo(0, y); c.lineTo(AT, y + slope); c.stroke();
        c.strokeStyle = 'rgba(250,255,205,0.35)'; c.lineWidth = 0.7;
        c.beginPath(); c.moveTo(0, y - 0.5); c.lineTo(AT, y + slope - 0.5); c.stroke();
        b.strokeStyle = layer ? 'rgba(200,200,200,0.6)' : 'rgba(225,225,225,0.95)'; b.lineWidth = 1.8;
        b.beginPath(); b.moveTo(0, y); b.lineTo(AT, y + slope); b.stroke();
      }
    }
    c.restore(); b.restore(); o.restore();
  }
  // ---- spool skirt print
  {
    const [y0, h] = REG.skirt;
    region(c, 'skirt', '#23262c'); region(o, 'skirt', 'rgb(120,74,235)');
    c.fillStyle = '#cfa865'; c.fillRect(0, y0 + 9, AT, 2); c.fillRect(0, y0 + h - 11, AT, 2);
    o.fillStyle = 'rgb(40,60,255)'; o.fillRect(0, y0 + 9, AT, 2); o.fillRect(0, y0 + h - 11, AT, 2);
    const txt = 'ALPEN 3000 FB  ·  0.25 mm / 150 m  ·  DRAG 9 kg';
    for (const ctx of [c, o]) { ctx.font = 'bold 24px Arial, Helvetica, sans-serif'; ctx.textBaseline = 'middle'; }
    const tw = c.measureText(txt).width, sx = Math.min(1, 470 / tw);
    for (const x0 of [21, 533]) {
      for (const [ctx, col] of [[c, '#d8dbe0'], [o, 'rgb(90,110,60)']]) {
        ctx.save(); ctx.translate(x0, y0 + h / 2 + 1); ctx.scale(sx, 1); ctx.fillStyle = col; ctx.fillText(txt, 0, 0); ctx.restore();
      }
    }
    c.restore(); o.restore();
  }
  // ---- rod label band (x = along the blank, y = top quarter of the circumference)
  {
    const [y0, h] = REG.label;
    region(c, 'label', '#171a1f'); region(o, 'label', 'rgb(255,40,90)');
    for (const [ctx, col] of [[c, '#d2ad66'], [o, 'rgb(80,60,255)']]) {
      ctx.fillStyle = col; ctx.fillRect(8, y0, 3, h); ctx.fillRect(16, y0, 1.5, h); ctx.fillRect(AT - 11, y0, 3, h); ctx.fillRect(AT - 17.5, y0, 1.5, h);
    }
    const stretch = 2.4; // blank is ~2.4x more pixels/mm along its length than around it
    const parts = [['ALPENFISCH', 'bold 21px Georgia, serif', '#ddb76c', 'rgb(60,50,255)'],
      ['   TROUT SPIN 270  ·  5–25 g  ·  2 pc', 'bold 15px Arial, sans-serif', '#c9ccd1', 'rgb(70,70,200)']];
    let x = 40;
    for (const [t, font, col, ocol] of parts) {
      c.font = font; const w = c.measureText(t).width;
      for (const [ctx, cl] of [[c, col], [o, ocol]]) {
        ctx.save(); ctx.font = font; ctx.textBaseline = 'middle'; ctx.translate(x, y0 + h / 2 + 1); ctx.scale(stretch, 1);
        ctx.fillStyle = cl; ctx.fillText(t, 0, 0); ctx.restore();
      }
      x += w * stretch;
    }
    c.restore(); o.restore();
  }
  // ---- brushed champagne aluminium (streaks along u = machined rings on lathe parts)
  {
    const [y0, h] = REG.brushed;
    region(c, 'brushed', '#c8aa74'); region(o, 'brushed', 'rgb(50,62,255)'); region(b, 'brushed', 'rgb(128,128,128)');
    for (let i = 0; i < 1700; i++) {
      const y = y0 + R() * h, a = 0.04 + R() * 0.12, lt = R() < 0.5;
      c.fillStyle = lt ? `rgba(255,242,214,${a})` : `rgba(92,70,38,${a})`;
      c.fillRect(0, y, AT, R() < 0.8 ? 1 : 2);
      o.fillStyle = `rgba(50,${lt ? 45 : 95},255,0.3)`; o.fillRect(0, y, AT, 1);
      b.fillStyle = lt ? 'rgba(165,165,165,0.35)' : 'rgba(90,90,90,0.35)'; b.fillRect(0, y, AT, 1);
    }
    c.restore(); o.restore(); b.restore();
  }

  const mk = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  _atlas = { map: mk(cc, true), orm: mk(oc, false), bump: mk(bc, false) };
  return _atlas;
}

// carbon blank: dark graphite with fine fibre streaks + sparse metallic flake
let _carbon = null;
function getCarbon() {
  if (_carbon) return _carbon;
  const W = 256, H = 512, R = rng(99);
  const cc = makeCanvas(W, H), oc = makeCanvas(W, H);
  const c = cc.getContext('2d'), o = oc.getContext('2d');
  c.fillStyle = '#191d22'; c.fillRect(0, 0, W, H);
  o.fillStyle = 'rgb(255,92,80)'; o.fillRect(0, 0, W, H);
  for (let i = 0; i < 420; i++) {
    const x = Math.floor(R() * W), a = 0.03 + R() * 0.08;
    c.fillStyle = R() < 0.5 ? `rgba(60,70,82,${a})` : `rgba(5,6,8,${a * 1.5})`;
    c.fillRect(x, 0, 1, H);
    o.fillStyle = `rgba(255,${R() < 0.5 ? 70 : 115},80,0.25)`; o.fillRect(x, 0, 1, H);
  }
  for (let i = 0; i < 1800; i++) {
    const x = Math.floor(R() * W), y = Math.floor(R() * H);
    c.fillStyle = `rgba(${150 + R() * 60 | 0},${160 + R() * 60 | 0},${175 + R() * 60 | 0},${0.5 + R() * 0.5})`;
    c.fillRect(x, y, 1, 1);
    o.fillStyle = 'rgb(255,40,255)'; o.fillRect(x, y, 1, 1);
  }
  const mk = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  _carbon = { map: mk(cc, true), orm: mk(oc, false) };
  return _carbon;
}

// thread wraps: rows of individual threads (grey, tinted by vertex colour)
let _thread = null;
function getThread() {
  if (_thread) return _thread;
  const S = 64, cv = makeCanvas(S, S), c = cv.getContext('2d'), R = rng(5);
  for (let k = 0; k < 8; k++) {
    const j = 0.9 + R() * 0.1;
    for (let y = 0; y < 8; y++) {
      const e = Math.sin(((y + 0.5) / 8) * Math.PI);
      const v = Math.round((95 + 160 * Math.pow(e, 0.7)) * j);
      c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(0, k * 8 + y, S, 1);
    }
  }
  for (let i = 0; i < 300; i++) { c.fillStyle = `rgba(255,255,255,${R() * 0.15})`; c.fillRect(R() * S, R() * S, 2, 1); }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  _thread = t;
  return t;
}

// ---------------------------------------------------------------------------
// Geometry builder: parametric grids with finite-difference normals.
// ---------------------------------------------------------------------------
const _gp = new THREE.Vector3();
class GB {
  constructor({ skin = false } = {}) {
    this.p = []; this.n = []; this.t = []; this.i = [];
    this.sk = skin ? [] : null;
    this.bone = 0;
    this.m = null; this.nm = new THREE.Matrix3();
  }
  xf(m) { this.m = m ? m.clone() : null; if (m) this.nm.getNormalMatrix(m); return this; }
  get vc() { return this.p.length / 3; }
  grid(NU, NV, pos, uv, o = {}) {
    const cu = !!o.closedU, cv = !!o.closedV, flip = !!o.flip;
    const W = NU + 1, H = NV + 1, P = new Float64Array(W * H * 3), N = new Float64Array(W * H * 3);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      pos(i, j, _gp); const k = (j * W + i) * 3;
      P[k] = _gp.x; P[k + 1] = _gp.y; P[k + 2] = _gp.z;
    }
    const zeroRow = new Uint8Array(H);
    for (let j = 0; j < H; j++) {
      let allZero = true;
      for (let i = 0; i < W; i++) {
        let i0 = i - 1, i1 = i + 1, j0 = j - 1, j1 = j + 1;
        if (cu) { if (i0 < 0) i0 = NU - 1; if (i1 > NU) i1 = 1; } else { i0 = Math.max(0, i0); i1 = Math.min(NU, i1); }
        if (cv) { if (j0 < 0) j0 = NV - 1; if (j1 > NV) j1 = 1; } else { j0 = Math.max(0, j0); j1 = Math.min(NV, j1); }
        const a = (j * W + i1) * 3, b = (j * W + i0) * 3, c = (j1 * W + i) * 3, d = (j0 * W + i) * 3;
        const ux = P[a] - P[b], uy = P[a + 1] - P[b + 1], uz = P[a + 2] - P[b + 2];
        const vx = P[c] - P[d], vy = P[c + 1] - P[d + 1], vz = P[c + 2] - P[d + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz), k = (j * W + i) * 3;
        if (l > 1e-14) { const s = (flip ? -1 : 1) / l; N[k] = nx * s; N[k + 1] = ny * s; N[k + 2] = nz * s; allZero = false; }
      }
      zeroRow[j] = allZero ? 1 : 0;
    }
    for (let j = 0; j < H; j++) {
      if (zeroRow[j]) { // pole: average of neighbouring row
        const jn = j === 0 ? 1 : j === NV ? NV - 1 : (zeroRow[j + 1] ? j - 1 : j + 1);
        let sx = 0, sy = 0, sz = 0;
        for (let i = 0; i < NU; i++) { const k = (jn * W + i) * 3; sx += N[k]; sy += N[k + 1]; sz += N[k + 2]; }
        const l = Math.hypot(sx, sy, sz) || 1;
        for (let i = 0; i < W; i++) { const k = (j * W + i) * 3; N[k] = sx / l; N[k + 1] = sy / l; N[k + 2] = sz / l; }
      } else {
        for (let i = 0; i < W; i++) {
          const k = (j * W + i) * 3;
          if (N[k] === 0 && N[k + 1] === 0 && N[k + 2] === 0) {
            const jn = j > 0 ? j - 1 : j + 1, kn = (jn * W + i) * 3;
            N[k] = N[kn]; N[k + 1] = N[kn + 1]; N[k + 2] = N[kn + 2];
          }
        }
      }
    }
    const base = this.vc, v = new THREE.Vector3(), nn = new THREE.Vector3();
    const constUV = Array.isArray(uv) ? uv : null;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = (j * W + i) * 3;
      v.set(P[k], P[k + 1], P[k + 2]); nn.set(N[k], N[k + 1], N[k + 2]);
      if (this.m) { v.applyMatrix4(this.m); nn.applyMatrix3(this.nm).normalize(); }
      this.p.push(v.x, v.y, v.z); this.n.push(nn.x, nn.y, nn.z);
      const t = constUV || uv(i, j);
      this.t.push(t[0], t[1]);
      if (this.sk) this.sk.push(this.bone);
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = base + j * W + i, b = a + 1, c = a + W + 1, d = a + W;
      if (!flip) this.i.push(a, b, d, b, c, d); else this.i.push(a, d, b, b, d, c);
    }
  }
  // surface of revolution around +Z. prof: [[r, z], ...]. o.uv(u, j, r, z) | o.sw ; o.a0/o.a1 partial ; o.rmod(theta, j)
  lathe(prof, segs, o = {}) {
    const partial = o.a0 !== undefined, a0 = partial ? o.a0 : 0, a1 = partial ? o.a1 : TAU, ph = o.phase || 0;
    const uvf = o.uv ? (i, j) => o.uv(i / segs, j, prof[j][0], prof[j][1]) : swUV(o.sw || 'chrome');
    this.grid(segs, prof.length - 1, (i, j, out) => {
      const th = a0 + (a1 - a0) * i / segs + ph;
      let r = prof[j][0];
      if (o.rmod && r > 0) r += o.rmod(th, j, r);
      out.set(r * Math.cos(th), r * Math.sin(th), prof[j][1]);
    }, uvf, { closedU: !partial, flip: o.flip });
  }
  torus(R, a, b, NU, NV, cx, cy, cz, sw) {
    this.grid(NU, NV, (i, j, out) => {
      const th = i / NU * TAU, ph = j / NV * TAU, r = R + a * Math.cos(ph);
      out.set(cx + r * Math.cos(th), cy + r * Math.sin(th), cz + b * Math.sin(ph));
    }, swUV(sw), { closedU: true, closedV: true });
  }
  // tube along a polyline (parallel transport). rad: number | (j) => r
  tube(pts, rad, segs, sw, o = {}) {
    const n = pts.length, T = [], N = [], B = [];
    for (let j = 0; j < n; j++) {
      const a = pts[Math.max(0, j - 1)], b = pts[Math.min(n - 1, j + 1)];
      const t = new THREE.Vector3().subVectors(b, a);
      if (t.lengthSq() < 1e-16) t.copy(T[j - 1] || new THREE.Vector3(0, 0, 1)); else t.normalize();
      T.push(t);
    }
    let nrm = new THREE.Vector3(0, 1, 0);
    if (Math.abs(nrm.dot(T[0])) > 0.9) nrm.set(1, 0, 0);
    for (let j = 0; j < n; j++) {
      nrm = nrm.clone().addScaledVector(T[j], -nrm.dot(T[j])).normalize();
      N.push(nrm); B.push(new THREE.Vector3().crossVectors(T[j], nrm));
    }
    const rf = typeof rad === 'function' ? rad : () => rad;
    this.grid(segs, n - 1, (i, j, out) => {
      const th = i / segs * TAU, r = rf(j), c = Math.cos(th) * r, s = Math.sin(th) * r;
      out.set(pts[j].x + N[j].x * c + B[j].x * s, pts[j].y + N[j].y * c + B[j].y * s, pts[j].z + N[j].z * c + B[j].z * s);
    }, o.uv || swUV(sw), { closedU: true });
  }
  // rounded-rectangle bar along a path; wDir sets the "wide" direction
  bar(pts, wf, tf, wDir, segs, sw, ex = 4) {
    const n = pts.length, F = [];
    for (let j = 0; j < n; j++) {
      const a = pts[Math.max(0, j - 1)], b = pts[Math.min(n - 1, j + 1)];
      const T = new THREE.Vector3().subVectors(b, a).normalize();
      const W = wDir.clone().addScaledVector(T, -wDir.dot(T)).normalize();
      const Th = new THREE.Vector3().crossVectors(T, W);
      F.push([W, Th]);
    }
    this.grid(segs, n - 1, (i, j, out) => {
      const th = i / segs * TAU, c = Math.cos(th), s = Math.sin(th);
      const t = j / (n - 1), w = wf(t), h = tf(t);
      const sx = Math.sign(c) * Math.pow(Math.abs(c), 2 / ex) * h, sy = Math.sign(s) * Math.pow(Math.abs(s), 2 / ex) * w;
      const [W, Th] = F[j];
      out.set(pts[j].x + Th.x * sx + W.x * sy, pts[j].y + Th.y * sx + W.y * sy, pts[j].z + Th.z * sx + W.z * sy);
    }, swUV(sw), { closedU: true, flip: true });
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.t, 2));
    if (this.sk) {
      const n = this.sk.length, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let k = 0; k < n; k++) { si[k * 4] = this.sk[k]; sw[k * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    }
    g.setIndex(this.i);
    return g;
  }
}

// ---------------------------------------------------------------------------
// Rod layout (metres, rod-local: butt at origin, +Z toward the tip, guides & reel on -Y)
// ---------------------------------------------------------------------------
const L = 2.7;
const FER = 1.35;          // put-over ferrule (2-piece rod)
const U0 = 0.27;           // nothing bends below 27 % of the length (grip / seat stay rigid)
const REEL_Z = 0.45;       // reel foot centre
const SEAT_R = 0.0105;     // reel-seat barrel radius
const REEL_Y = -(SEAT_R + 0.068); // reel-local origin = spool axis under the foot

function blankR(s) {
  const u = clamp(s / L, 0, 1);
  let d = 1.8 + 10.2 * Math.pow(1 - u, 1.15); // diameter in mm
  if (s >= FER && s < FER + 0.075) d += 0.5 * (s < FER + 0.06 ? 1 : 1 - smooth((s - FER - 0.06) / 0.015));
  return d * 0.0005;
}

const GUIDES = [
  { s: 0.97, ri: 0.0125, h: 0.0405, dbl: true },
  { s: 1.29, ri: 0.0080, h: 0.0270, dbl: true },
  { s: 1.57, ri: 0.0060, h: 0.0195 },
  { s: 1.81, ri: 0.0050, h: 0.0155 },
  { s: 2.02, ri: 0.0040, h: 0.0124 },
  { s: 2.21, ri: 0.0035, h: 0.0104 },
  { s: 2.38, ri: 0.0030, h: 0.0092 },
  { s: 2.54, ri: 0.0030, h: 0.0082 },
];
for (const g of GUIDES) {
  g.w = 0.0006 + 0.12 * g.ri;            // insert radial width
  g.tz = 0.0011 + 0.22 * g.ri;           // insert thickness (along the line)
  g.rr = 0.00032 + 0.035 * g.ri;         // frame ring wire radius
  g.Rr = g.ri + g.w + g.rr * 0.8;        // frame ring centre radius
  g.rb = blankR(g.s);
  g.fs = (g.dbl ? 0.42 : 0.33) * g.h;    // leg base distance from ring plane
  g.fl = 0.0055 + 0.24 * g.h;            // foot length
  g.fw = 0.0007 + 0.05 * g.ri;           // foot half width
  g.ft = 0.00022 + 0.012 * g.ri;         // foot thickness
  g.lr = 0.00028 + 0.042 * g.ri;         // leg wire radius
}
const TIP = { ri: 0.0024 };
TIP.w = 0.0006 + 0.12 * TIP.ri; TIP.tz = 0.0011 + 0.22 * TIP.ri; TIP.rr = 0.00032 + 0.035 * TIP.ri;
TIP.Rr = TIP.ri + TIP.w + TIP.rr * 0.8;
TIP.rb = blankR(L);
TIP.h = TIP.rb + 0.0009 + TIP.Rr + TIP.rr;
TIP.z = -0.0012;

// ---------------------------------------------------------------------------
// Static hardware: butt cap, split cork/EVA grip, reel seat, winding checks, label, hook keeper
// ---------------------------------------------------------------------------
function buildHardware(gb) {
  const R = rng(4242);
  const cork = (z0, z1, rf, rings) => {
    const len = (z1 - z0) / rings;
    for (let k = 0; k < rings; k++) {
      const a = z0 + k * len, b = a + len, e = 0.0005, dip = 0.00014;
      const prof = [[rf(a) - dip, a], [rf(a + e), a + e], [rf(b - e), b - e], [rf(b) - dip, b]];
      const uo = R(), vo = R() * 0.5, span = 0.47 * (len / 0.0125);
      gb.lathe(prof, 24, { uv: (u, j, r, z) => regUV('cork', u + uo, vo + span * (z - a) / len) });
    }
  };
  const eva = (prof) => gb.lathe(prof, 26, { uv: (u, j, r, z) => regUV('eva', u, (z * 9.0) % 1) });

  // butt cap (rubber) + gold trim ring
  gb.lathe([[0, 0], [0.0055, 0.0002], [0.0098, 0.0011], [0.0124, 0.0032], [0.0135, 0.0075], [0.0136, 0.0215]], 24, { sw: 'rubber' });
  gb.lathe([[0.0131, 0.0214], [0.0139, 0.0219], [0.0139, 0.0246], [0.0131, 0.0251]], 24, { sw: 'gold' });
  // rear grip: EVA / cork / EVA
  eva([[0.0129, 0.0251], [0.0133, 0.0256], [0.0134, 0.0345]]);
  const rearR = (z) => 0.0129 + 0.0008 * Math.sin(Math.PI * clamp((z - 0.025) / 0.125, 0, 1));
  cork(0.0345, 0.1345, rearR, 8);
  eva([[0.0130, 0.1345], [0.0129, 0.1460], [0.0124, 0.1475]]);
  // winding check
  gb.lathe([[0.0126, 0.1474], [0.0127, 0.1482], [0.0118, 0.1505], [0.0082, 0.1522], [blankR(0.153) + 0.0002, 0.1528]], 24, { sw: 'gold' });
  // upper rear grip (EVA) leading into the seat
  gb.lathe([[blankR(0.300) + 0.0002, 0.2995], [0.0080, 0.3005], [0.0112, 0.3022], [0.0116, 0.3035], [0.0113, 0.3045]], 24, { sw: 'gold' });
  eva([[0.0110, 0.3045], [0.0112, 0.3200], [0.0118, 0.3700], [0.0121, 0.3830]]);
  // fixed rear hood (gunmetal) + hood lip over the foot end
  gb.lathe([[0.0119, 0.3828], [0.0124, 0.3836], [0.0125, 0.4060], [0.0119, 0.4075], [0.0110, 0.4080]], 28, { sw: 'gunmetal' });
  const lipBlend = (th, j, r) => -(r - SEAT_R + 0.0004) * smooth(clamp((Math.abs(th + Math.PI / 2) / 0.85 - 0.45) / 0.55, 0, 1));
  gb.lathe([[0.0122, 0.4040], [0.0141, 0.4100], [0.0146, 0.4165], [0.0145, 0.4235], [0.0139, 0.4262], [0.0130, 0.4266]], 16,
    { sw: 'gunmetal', a0: -Math.PI / 2 - 0.85, a1: -Math.PI / 2 + 0.85, rmod: lipBlend });
  // graphite seat barrel
  gb.lathe([[0.0110, 0.4080], [SEAT_R, 0.4088], [SEAT_R, 0.4900]], 28, { sw: 'graphite' });
  // front moving hood + lip
  gb.lathe([[0.0130, 0.4734], [0.0139, 0.4738], [0.0145, 0.4765], [0.0146, 0.4830], [0.0140, 0.4880]], 16,
    { sw: 'gunmetal', a0: -Math.PI / 2 - 0.85, a1: -Math.PI / 2 + 0.85, rmod: lipBlend });
  gb.lathe([[0.0118, 0.4800], [0.0126, 0.4812], [0.0127, 0.4890], [0.0122, 0.4900]], 28, { sw: 'gunmetal' });
  // knurled lock nut + lock ring
  gb.lathe([[0.0122, 0.4900], [0.0133, 0.4906], [0.0136, 0.4920], [0.0136, 0.5100], [0.0133, 0.5114], [0.0125, 0.5120]], 60,
    { sw: 'gunmetal', rmod: (th, j) => (j >= 2 && j <= 3 ? -0.00034 * Math.pow(0.5 + 0.5 * Math.cos(th * 30), 2) : 0) });
  gb.lathe([[0.0121, 0.5122], [0.0128, 0.5128], [0.0128, 0.5196], [0.0124, 0.5205]], 28, { sw: 'chrome' });
  gb.lathe([[0.0120, 0.5205], [0.0126, 0.5212], [0.0126, 0.5232], [0.0122, 0.5238]], 28, { sw: 'gold' });
  // foregrip cork, tapered
  const foreR = (z) => lerp(0.0123, 0.0100, smooth(clamp((z - 0.5238) / 0.1, 0, 1))) - 0.0003 * Math.sin(Math.PI * clamp((z - 0.5238) / 0.1, 0, 1));
  cork(0.5238, 0.6238, foreR, 8);
  eva([[0.0098, 0.6238], [0.0099, 0.6260], [0.0095, 0.6320]]);
  gb.lathe([[0.0096, 0.6318], [0.0098, 0.6330], [0.0085, 0.6352], [0.0068, 0.6368], [blankR(0.637) + 0.00015, 0.6375]], 24, { sw: 'gold' });
  // label band on the blank (text on the top quarter of the circumference)
  const l0 = 0.6720, l1 = 0.7270;
  gb.lathe([[blankR(l0) + 0.00004, l0 - 0.0003], [blankR(l0) + 0.00009, l0], [blankR(l1) + 0.00009, l1], [blankR(l1) + 0.00004, l1 + 0.0003]], 32, {
    uv: (u, j, r, z) => {
      const th = u * TAU, t = (th - Math.PI / 4) / (Math.PI / 2);
      return regUV('label', clamp((z - l0) / (l1 - l0), 0, 1) * 0.999, t < 0 || t > 1 ? 0 : t);
    },
  });
  // hook keeper (foot under the wrap + folding wire loop), underside
  const kz = 0.6505, rbk = blankR(0.655);
  gb.grid(3, 4, (i, j, out) => {
    const a = (i / 3 - 0.5) * 2, z = kz + 0.0001 + j / 4 * 0.0098, phi = -Math.PI / 2 + a * 0.0010 / rbk, rr = rbk + 0.00035 * (1 - a * a * 0.6);
    out.set(rr * Math.cos(phi), rr * Math.sin(phi), z);
  }, swUV('chrome'));
  const ky = -(rbk + 0.0004), wx = 0.0011;
  const kp = [[-wx, ky, 0.6595], [-wx, ky - 0.0018, 0.6622], [-wx * 0.9, ky - 0.0038, 0.6648], [-wx * 0.45, ky - 0.0049, 0.6662],
    [0, ky - 0.0051, 0.6665], [wx * 0.45, ky - 0.0049, 0.6662], [wx * 0.9, ky - 0.0038, 0.6648], [wx, ky - 0.0018, 0.6622], [wx, ky, 0.6595]]
    .map((p) => new THREE.Vector3(...p));
  gb.tube(kp, 0.00045, 6, 'chrome');
}

// ---------------------------------------------------------------------------
// Guide templates (guide-local: origin on the blank axis at the ring station)
// ---------------------------------------------------------------------------
function bezier(a, b, c, d, n) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t;
    out.push(new THREE.Vector3()
      .addScaledVector(a, u * u * u).addScaledVector(b, 3 * u * u * t).addScaledVector(c, 3 * u * t * t).addScaledVector(d, t * t * t));
  }
  return out;
}

function buildGuide(gb, g) {
  const segs = g.ri > 0.007 ? 26 : g.ri > 0.0045 ? 20 : 14;
  const cy = -g.h;
  gb.torus(g.ri + g.w / 2, g.w / 2 + 0.00005, g.tz / 2, segs, 6, 0, cy, 0, 'sic');
  gb.torus(g.Rr, g.rr, g.rr * 1.5, segs, 5, 0, cy, 0, 'titanium');
  const legs = (zf, ang) => {
    for (const sx of [-1, 1]) {
      const phi = sx * ang;
      const at = new THREE.Vector3(g.Rr * Math.sin(phi), cy + g.Rr * Math.cos(phi), 0);
      const base = new THREE.Vector3(sx * g.fw * 0.45, -(g.rb + g.ft * 0.8), zf);
      const dy = at.y - base.y;
      const c1 = base.clone().add(new THREE.Vector3(0, dy * 0.45, -zf * 0.02));
      const c2 = at.clone().add(new THREE.Vector3(-at.x * 0.05, -dy * 0.25, zf * 0.45));
      const pts = bezier(base, c1, c2, at, 6);
      gb.tube(pts, (j) => g.lr * (1.5 - 0.35 * j / 6), 5, 'titanium');
    }
  };
  const foot = (zStart, zEnd) => {
    gb.grid(4, 5, (i, j, out) => {
      const a = (i / 4 - 0.5) * 2, t = j / 5, z = lerp(zStart, zEnd, t);
      const hw = g.fw * (1 - 0.72 * t), th = g.ft * (1 - 0.55 * t) * (1 - 0.55 * a * a);
      const phi = -Math.PI / 2 + a * hw / g.rb, r = g.rb + th;
      out.set(r * Math.cos(phi), r * Math.sin(phi), z);
    }, swUV('titanium'), { flip: zEnd < zStart });
  };
  if (g.dbl) {
    legs(-g.fs, 1.05); legs(g.fs, 1.05);
    foot(-g.fs, -g.fs - g.fl); foot(g.fs, g.fs + g.fl);
  } else {
    legs(-g.fs, 0.62);
    foot(-g.fs, -g.fs - g.fl);
  }
}

function buildTipTop(gb) {
  const rb = TIP.rb, cy = -TIP.h, z = TIP.z;
  gb.lathe([[rb + 0.0002, -0.0118], [rb + 0.00045, -0.0112], [rb + 0.00045, -0.0006], [rb + 0.0003, 0.0002], [rb * 0.6, 0.0006], [0, 0.0007]], 14, { sw: 'titanium' });
  gb.torus(TIP.ri + TIP.w / 2, TIP.w / 2 + 0.00005, TIP.tz / 2, 16, 6, 0, cy, z, 'sic');
  gb.torus(TIP.Rr, TIP.rr, TIP.rr * 1.5, 16, 5, 0, cy, z, 'titanium');
  const top = cy + TIP.Rr;
  gb.bar([new THREE.Vector3(0, -rb, -0.0085), new THREE.Vector3(0, -rb - 0.0003, -0.0045), new THREE.Vector3(0, (top - rb) / 2, z - 0.0006), new THREE.Vector3(0, top, z)],
    (t) => lerp(0.0016, 0.0009, t), () => 0.00035, new THREE.Vector3(0, 0, 1), 10, 'titanium');
}

// thread wraps: [s0, s1, footHalfWidth (0 = none), footThickness]
function wrapList() {
  const W = [];
  for (const g of GUIDES) {
    W.push([g.s - g.fs - g.fl - 0.0016, g.s - g.fs - 0.0006, g.fw, g.ft]);
    if (g.dbl) W.push([g.s + g.fs + 0.0006, g.s + g.fs + g.fl + 0.0016, g.fw, g.ft]);
  }
  W.push([0.6375, 0.6460, 0, 0]);               // decorative trim wrap after the foregrip
  W.push([0.6500, 0.6605, 0.0010, 0.00035]);    // hook keeper
  W.push([FER + 0.0004, FER + 0.0125, 0, 0]);   // ferrule reinforcement
  W.push([L - 0.0205, L - 0.0110, 0, 0]);       // tip-top
  return W;
}

// ---------------------------------------------------------------------------
// Spinning reel, size 3000 (reel-local: origin on the spool axis below the foot centre,
// +Z toward the rod tip, +Y up toward the rod, handle on +X = angler's LEFT).
// One SkinnedMesh; every vertex is rigidly bound to one bone.
// ---------------------------------------------------------------------------
const B_ROOT = 0, B_ROTOR = 1, B_BAIL = 2, B_SPOOL = 3, B_DRAG = 4, B_HANDLE = 5, B_LINE = 6;
const PZ = 0.0215;     // bail pivot plane (rotor-local z)
const DZ = 0.0100;     // bail wire plane offset in front of the pivots
const RW = 0.0305;     // bail wire radius
const HP = new THREE.Vector3(0, -0.010, -0.028); // handle / main-gear axis (along X)
const KNOB = new THREE.Vector3(0.0497, -0.0555, 0); // knob centre, handle-bone local
const BAIL_CLOSED = 0.26, BAIL_OPEN = 3.02;
const ROLLER_LOCAL = new THREE.Vector3(RW + 0.0017, 0.0029, DZ); // line groove, bail-bone local
const LIP_LOCAL = new THREE.Vector3(0, 0.0252, 0.0458);         // spool front lip (top), spool-bone local

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const axisX = (sign, c) => new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeRotationY(sign * Math.PI / 2));
const axisY = (c) => new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));

function bodySection(t) {
  const cap = t < 0.2 ? Math.sqrt(Math.max(0, 1 - Math.pow(1 - t / 0.2, 2))) : 1;
  const x = clamp((t - 0.02) / 0.93, 0, 1);
  const belly = Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(x, 1.4))), 0.9);
  const front = smooth(clamp((t - 0.74) / 0.26, 0, 1));
  let a = lerp(0.0172, 0.0203, smooth(clamp(t / 0.45, 0, 1)));
  let bt = 0.0150 + 0.0035 * Math.sin(Math.PI * x);
  let bb = 0.0165 + 0.0195 * belly;
  a = lerp(a, 0.0166, front); bt = lerp(bt, 0.0166, front); bb = lerp(bb, 0.0166, front);
  return { a: a * cap, bt: bt * cap, bb: bb * cap, n: lerp(2.8, 2.0, front) };
}
const se = (c, n) => Math.sign(c) * Math.pow(Math.abs(c), 2 / n);

function buildReel(gb) {
  // ---------------- body / stem / foot (root)
  gb.bone = B_ROOT;
  const zr = -0.068, zf = -0.0015;
  gb.grid(32, 20, (i, j, out) => {
    const t = Math.pow(j / 20, 1.2), z = lerp(zr, zf, t), S = bodySection(t), th = i / 32 * TAU;
    const c = Math.cos(th), s = Math.sin(th);
    out.set(se(c, S.n + 1.1 * (S.n - 2) / 0.8) * S.a, se(s, S.n) * (s >= 0 ? S.bt : S.bb), z);
  }, swUV('paint'), { closedU: true });
  gb.grid(20, 12, (i, j, out) => {
    const k = j / 12, y = lerp(0.008, 0.0662, k);
    const hz = 0.0072 + 0.0092 * Math.pow(1 - k, 2.2) + 0.0062 * Math.pow(k, 7);
    const hx = 0.0040 + 0.0036 * Math.pow(1 - k, 2) + 0.0014 * Math.pow(k, 7);
    const cz = lerp(-0.027, -0.002, smooth(k)), th = i / 20 * TAU;
    out.set(se(Math.cos(th), 2.5) * hx, y, cz + se(Math.sin(th), 2.5) * hz);
  }, swUV('paint'), { closedU: true, flip: true });
  gb.grid(12, 14, (i, j, out) => {
    const t = j / 14, z = lerp(-0.029, 0.029, t), e = Math.pow(Math.abs(2 * t - 1), 6);
    const w = 0.0062 * Math.sqrt(Math.max(0, 1 - e)), hy = 0.0012 * Math.pow(Math.max(0, 1 - e), 0.3), th = i / 12 * TAU;
    const x = se(Math.cos(th), 4) * w;
    out.set(x, 0.0668 + se(Math.sin(th), 4) * hy + (SEAT_R - Math.sqrt(SEAT_R * SEAT_R - x * x)), z);
  }, swUV('paint'), { closedU: true });
  // gear-housing bosses + screw cap on the right (-X), handle side (+X)
  gb.xf(axisX(1, HP));
  gb.lathe([[0.0150, 0.0150], [0.0151, 0.0196], [0.0146, 0.0206], [0.0080, 0.0209]], 36, { sw: 'paint' });
  gb.xf(axisX(-1, HP));
  gb.lathe([[0.0150, 0.0150], [0.0151, 0.0196], [0.0146, 0.0206], [0.0078, 0.0208]], 36, { sw: 'paint' });
  gb.lathe([[0.0076, 0.0204], [0.0077, 0.0231], [0.0072, 0.0243], [0.0046, 0.0248], [0, 0.0249]], 28, { uv: (u, j, r) => regUV('brushed', u, 0.2 + r * 40) });
  gb.xf(null);
  // anti-reverse lever (rear underside)
  gb.bar([V(0, -0.0180, -0.0555), V(0, -0.0232, -0.0602), V(0, -0.0260, -0.0652), V(0, -0.0266, -0.0682)],
    (t) => lerp(0.0036, 0.0027, t), () => 0.0011, V(1, 0, 0), 10, 'darkalu');

  // ---------------- rotor
  gb.bone = B_ROTOR;
  gb.lathe([[0.0164, -0.0052], [0.0184, -0.0047], [0.0218, -0.0023], [0.0243, 0.0012], [0.0254, 0.0050],
    [0.0256, 0.0163], [0.0251, 0.0173], [0.0236, 0.0177]], 40, { sw: 'paint' });
  gb.lathe([[0.0221, -0.0018], [0.0230, -0.0009], [0.0236, 0.0001]], 40, { sw: 'gold', rmod: () => 0.00012 });
  for (const sx of [1, -1]) {
    gb.bar([V(sx * 0.0232, 0, -0.0006), V(sx * 0.0263, 0, 0.0068), V(sx * 0.0300, 0, 0.0133), V(sx * 0.0321, 0, 0.0195), V(sx * 0.0325, 0, 0.0228)],
      (t) => lerp(0.0072, 0.0043, t), () => 0.0019, V(0, 1, 0), 14, 'paint');
    gb.xf(axisX(sx, V(sx * 0.0322, 0, PZ)));
    gb.lathe([[0.0042, 0], [0.0043, 0.0010], [0.0037, 0.0017], [0, 0.0019]], 18, { sw: 'paint' });
    gb.xf(null);
  }

  // ---------------- bail (rest pose: wire apex at +Y)
  gb.bone = B_BAIL;
  const t0 = Math.asin(0.0062 / RW), wp = [];
  for (let k = 0; k <= 30; k++) { const t = lerp(t0, Math.PI, k / 30); wp.push(V(RW * Math.cos(t), RW * Math.sin(t), PZ + DZ)); }
  gb.tube(wp, 0.00095, 7, 'chrome');
  gb.xf(axisY(V(RW, 0, PZ + DZ)));
  gb.lathe([[0.0019, -0.0004], [0.0024, 0.0006], [0.0019, 0.0027], [0.0024, 0.0048], [0.0019, 0.0058]], 16, { sw: 'gold' });
  gb.lathe([[0.0019, 0.0057], [0.0027, 0.0059], [0.0028, 0.0065], [0.0019, 0.0071], [0, 0.0072]], 16, { sw: 'chrome' });
  gb.lathe([[0, -0.0017], [0.0021, -0.0016], [0.0027, -0.0011], [0.0026, -0.0003]], 16, { sw: 'chrome' });
  gb.xf(null);
  gb.bar([V(0.0338, 0, PZ), V(0.0338, -0.0007, PZ + 0.0035), V(0.0328, -0.0012, PZ + DZ - 0.0025), V(RW + 0.0008, -0.0013, PZ + DZ)],
    (t) => lerp(0.0033, 0.0027, t), () => 0.0010, V(0, 1, 0), 10, 'chrome');
  gb.bar([V(-0.0338, 0, PZ), V(-0.0336, 0.0002, PZ + 0.0040), V(-0.0320, 0.0002, PZ + DZ - 0.0015), V(-RW, 0, PZ + DZ)],
    (t) => lerp(0.0029, 0.0017, t), () => 0.0010, V(0, 1, 0), 10, 'chrome');
  for (const sx of [1, -1]) {
    gb.xf(axisX(sx, V(sx * 0.0341, 0, PZ)));
    gb.lathe([[0.0027, 0], [0.0027, 0.0007], [0.0021, 0.0012], [0, 0.0013]], 16, { sw: 'chrome' });
    gb.xf(null);
  }

  // ---------------- spool
  gb.bone = B_SPOOL;
  const sk0 = 0.0076, sk1 = 0.0236;
  gb.lathe([[0.0262, 0.0058], [0.0271, 0.0064], [0.0275, sk0], [0.0275, sk1], [0.0271, 0.0250], [0.0261, 0.0257]], 48,
    { uv: (u, j, r, z) => regUV('skirt', u, 1 - (z - sk0) / (sk1 - sk0)) });
  gb.lathe([[0.0262, 0.0058], [0.0258, 0.0062], [0.0258, 0.0150]], 40, { sw: 'darkalu', flip: true });
  gb.lathe([[0.0261, 0.0257], [0.0250, 0.0261], [0.0236, 0.0262], [0.0200, 0.0263]], 48, { uv: (u, j, r) => regUV('brushed', u, (0.0262 - r) * 30) });
  gb.lathe([[0.0190, 0.0442], [0.0240, 0.0445], [0.0251, 0.0456], [0.0247, 0.0468], [0.0236, 0.0473], [0.0134, 0.0476]], 48,
    { uv: (u, j) => regUV('brushed', u, 0.3 + j * 0.1) });
  gb.bone = B_LINE;
  gb.lathe([[0.0168, 0.0262], [0.0228, 0.0264], [0.0235, 0.0285], [0.0237, 0.0353], [0.0235, 0.0422], [0.0228, 0.0442], [0.0168, 0.0444]], 40,
    { uv: (u, j, r, z) => regUV('line', u * 2, (z - 0.0262) / 0.0182) });
  // drag knob
  gb.bone = B_DRAG;
  gb.lathe([[0.0128, 0.0475], [0.0133, 0.0479], [0.0133, 0.0499], [0.0129, 0.0503]], 44, { sw: 'gold' });
  gb.lathe([[0.0126, 0.0503], [0.0131, 0.0509], [0.0132, 0.0545], [0.0131, 0.0588], [0.0125, 0.0604], [0.0108, 0.0616]], 60,
    { sw: 'darkalu', rmod: (th, j) => (j >= 1 && j <= 4 ? -0.0011 * Math.pow(0.5 + 0.5 * Math.cos(th * 12), 3) : 0) });
  gb.lathe([[0.0108, 0.0616], [0.0092, 0.0623], [0.0060, 0.0628], [0.0030, 0.0630], [0, 0.0631]], 28, { uv: (u, j, r) => regUV('brushed', u, 0.55 + r * 30) });

  // ---------------- handle (rest: arm pointing down)
  gb.bone = B_HANDLE;
  gb.xf(axisX(1, HP));
  gb.lathe([[0.0076, 0.0168], [0.0077, 0.0205], [0.0069, 0.0214], [0.0063, 0.0222], [0.0063, 0.0262], [0.0060, 0.0268]], 24, { sw: 'darkalu' });
  gb.lathe([[0.0060, 0.0262], [0.0082, 0.0266], [0.0085, 0.0302], [0.0079, 0.0309], [0.0040, 0.0312], [0, 0.0313]], 24, { sw: 'darkalu' });
  gb.xf(null);
  const ap = [];
  for (let k = 0; k <= 8; k++) { const t = k / 8; ap.push(V(0.0292 + 0.003 * t * t, HP.y - 0.0555 * t, HP.z)); }
  gb.bar(ap, (t) => lerp(0.0064, 0.0037, t), () => 0.0017, V(0, 0, 1), 14, 'darkalu');
  const kc = V(0, HP.y + KNOB.y, HP.z);
  gb.xf(axisX(1, kc));
  gb.lathe([[0.0040, 0.0284], [0.0047, 0.0290], [0.0048, 0.0334], [0.0040, 0.0342], [0.0024, 0.0346]], 24, { sw: 'darkalu' });
  gb.lathe([[0.0022, 0.0344], [0.0022, 0.0392]], 14, { sw: 'chrome' });
  gb.lathe([[0.0024, 0.0388], [0.0062, 0.0392], [0.0082, 0.0410], [0.0091, 0.0450], [0.0090, 0.0530], [0.0074, 0.0590], [0.0047, 0.0606]], 26,
    { uv: (u, j, r, z) => regUV('eva', u, (z - 0.0388) * 20) });
  gb.lathe([[0.0047, 0.0605], [0.0035, 0.0610], [0, 0.0612]], 20, { sw: 'gold' });
  gb.xf(null);
}

function createReel(material) {
  const gb = new GB({ skin: true });
  buildReel(gb);
  const geo = gb.geometry();
  const bones = [];
  const mk = (name, parent, x = 0, y = 0, z = 0) => {
    const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z);
    if (parent) parent.add(b);
    bones.push(b); return b;
  };
  const root = mk('reelRoot', null);
  const rotor = mk('rotor', root);
  const bail = mk('bail', rotor, 0, 0, PZ);
  const spool = mk('spool', root);
  const drag = mk('dragKnob', spool);
  const handle = mk('handle', root, HP.x, HP.y, HP.z);
  const line = mk('spoolLine', spool);
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.name = 'Reel3000';
  mesh.add(root);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  return { mesh, root, rotor, bail, spool, drag, handle, line, tris: geo.index.count / 3 };
}

// ---------------------------------------------------------------------------
// createRod
// ---------------------------------------------------------------------------
const SAG_TIP = 0.075;   // tip angle (rad) of the unloaded rod held horizontally
const SAG_P = 1.6;
const NC = 128, DSC = L / NC;
const _q = new THREE.Quaternion(), _g = new THREE.Vector3(), _t = new THREE.Vector3(), _c3 = new THREE.Vector3(), _m4 = new THREE.Matrix4();
const easeOutBack = (t) => { const c1 = 1.2, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

export function createRod(opts = {}) {
  const accent = new THREE.Color(opts.accent ?? 0x8e1b2b);
  const trimCol = new THREE.Color(opts.trim ?? 0xd9b86c);
  const atlas = getAtlas(), carbon = getCarbon(), thread = getThread();
  thread.colorSpace = THREE.SRGBColorSpace;

  const object = new THREE.Group();
  object.name = 'SpinningRod';

  const matAtlas = new THREE.MeshPhysicalMaterial({
    map: atlas.map, roughnessMap: atlas.orm, metalnessMap: atlas.orm, clearcoatMap: atlas.orm,
    bumpMap: atlas.bump, bumpScale: 0.6, roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.1,
  });
  const matBlank = new THREE.MeshPhysicalMaterial({
    map: carbon.map, roughnessMap: carbon.orm, metalnessMap: carbon.orm, roughness: 1, metalness: 1,
    clearcoat: 1, clearcoatRoughness: 0.06,
  });
  const matWrap = new THREE.MeshPhysicalMaterial({
    vertexColors: true, map: thread, bumpMap: thread, bumpScale: 0.5, roughness: 0.5, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.04,
  });

  // ---------- static hardware
  const hw = new GB();
  buildHardware(hw);
  const hardware = new THREE.Mesh(hw.geometry(), matAtlas);
  hardware.name = 'RodGrip';

  // ---------- blank (dynamic)
  const BR = 16, BW = BR + 1;
  const st = [];
  for (let k = 0; k <= 84; k++) st.push(0.02 + (L - 0.0036 - 0.02) * Math.pow(k / 84, 0.9));
  st.push(FER - 0.0006, FER + 0.0002, FER + 0.06, FER + 0.075);
  st.sort((a, b) => a - b);
  const NS = st.length, stR = st.map(blankR);
  const cosT = new Float32Array(BW), sinT = new Float32Array(BW);
  for (let i = 0; i <= BR; i++) { cosT[i] = Math.cos(i / BR * TAU); sinT[i] = Math.sin(i / BR * TAU); }
  const bGeo = new THREE.BufferGeometry();
  const bPos = new Float32Array(NS * BW * 3), bNor = new Float32Array(NS * BW * 3), bUV = new Float32Array(NS * BW * 2), bIdx = [];
  for (let j = 0; j < NS; j++) for (let i = 0; i <= BR; i++) { const k = (j * BW + i) * 2; bUV[k] = i / BR; bUV[k + 1] = st[j] / 0.1; }
  for (let j = 0; j < NS - 1; j++) for (let i = 0; i < BR; i++) { const a = j * BW + i, b = a + 1, c = a + BW + 1, d = a + BW; bIdx.push(a, b, d, b, c, d); }
  bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3).setUsage(THREE.DynamicDrawUsage));
  bGeo.setAttribute('normal', new THREE.BufferAttribute(bNor, 3).setUsage(THREE.DynamicDrawUsage));
  bGeo.setAttribute('uv', new THREE.BufferAttribute(bUV, 2));
  bGeo.setIndex(bIdx);
  const blank = new THREE.Mesh(bGeo, matBlank);
  blank.name = 'RodBlank';

  // ---------- thread wraps (dynamic)
  const WR = 12, WWd = WR + 1;
  const WRAPS = wrapList();
  const T_WRAP = 0.00026;
  // ring template: [fromEnd, offset, radial lift (0..1), normal radial, normal axial, trim?]
  const RING = [[0, 0, 0, 0.42, -0.9, 1], [0, 0.00035, 1, 0.92, -0.38, 1], [0, 0.0010, 1, 1, 0, 1], [0, 0.0010, 1, 1, 0, 0],
    [1, 0.0010, 1, 1, 0, 0], [1, 0.0010, 1, 1, 0, 1], [1, 0.00035, 1, 0.92, 0.38, 1], [1, 0, 0, 0.42, 0.9, 1]];
  const wRingS = [], wRingNR = [], wRingNZ = [], wR = [];
  const wCol = [], wUV = [], wIdx = [];
  let wv = 0;
  for (const [s0, s1, fw, ft] of WRAPS) {
    const rings0 = wRingS.length;
    for (const [fe, off, lift, nr, nz, trim] of RING) {
      const s = fe ? s1 - off : s0 + off, rb = blankR(s);
      wRingS.push(s); wRingNR.push(nr); wRingNZ.push(nz);
      const col = trim ? trimCol : accent;
      for (let i = 0; i <= WR; i++) {
        let bump = 0;
        if (fw > 0 && lift > 0) {
          let d = i / WR * TAU - 1.5 * Math.PI;
          if (d < -Math.PI) d += TAU;
          bump = ft * 1.25 * Math.exp(-Math.pow(d / (fw / rb * 1.2), 2));
        }
        wR.push(rb + lift * T_WRAP + bump);
        wCol.push(col.r, col.g, col.b);
        wUV.push(i / WR, (s - s0) / 0.0016);
      }
    }
    for (let j = 0; j < RING.length - 1; j++) for (let i = 0; i < WR; i++) {
      const a = (rings0 + j) * WWd + i, b = a + 1, c = a + WWd + 1, d = a + WWd;
      wIdx.push(a, b, d, b, c, d);
    }
    wv += RING.length * WWd;
  }
  const NWR = wRingS.length;
  const wCos = new Float32Array(WWd), wSin = new Float32Array(WWd);
  for (let i = 0; i <= WR; i++) { wCos[i] = Math.cos(i / WR * TAU); wSin[i] = Math.sin(i / WR * TAU); }
  const wGeo = new THREE.BufferGeometry();
  const wPos = new Float32Array(wv * 3), wNor = new Float32Array(wv * 3);
  wGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3).setUsage(THREE.DynamicDrawUsage));
  wGeo.setAttribute('normal', new THREE.BufferAttribute(wNor, 3).setUsage(THREE.DynamicDrawUsage));
  wGeo.setAttribute('color', new THREE.Float32BufferAttribute(wCol, 3));
  wGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wUV, 2));
  wGeo.setIndex(wIdx);
  const wrapMesh = new THREE.Mesh(wGeo, matWrap);
  wrapMesh.name = 'RodWraps';

  // ---------- guides + tip-top (dynamic, deformed along the bent blank)
  const gg = new GB();
  const gRanges = []; // [v0, v1, station, zmin, zmax]
  const addRange = (v0, st0) => {
    let zmin = Infinity, zmax = -Infinity;
    for (let v = v0; v < gg.vc; v++) { const z = gg.p[v * 3 + 2]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
    gRanges.push([v0, gg.vc, st0, zmin, zmax]);
  };
  for (const g of GUIDES) { const v0 = gg.vc; buildGuide(gg, g); addRange(v0, g.s); }
  { const v0 = gg.vc; buildTipTop(gg); addRange(v0, L); }
  const gGeo = gg.geometry();
  const gTP = Float32Array.from(gg.p), gTN = Float32Array.from(gg.n);
  const GS = 10, SF = new Float32Array((GS + 1) * 12);
  const gPos = gGeo.attributes.position.array, gNor = gGeo.attributes.normal.array;
  gGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
  gGeo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  const guideMesh = new THREE.Mesh(gGeo, matAtlas);
  guideMesh.name = 'RodGuides';

  // ---------- reel
  const reel = createReel(matAtlas);
  const reelGroup = new THREE.Group();
  reelGroup.name = 'ReelMount';
  reelGroup.position.set(0, REEL_Y, REEL_Z);
  reelGroup.add(reel.mesh);

  const gripRight = new THREE.Object3D(); gripRight.name = 'gripRight';
  gripRight.position.set(0, 0, REEL_Z);
  const gripLeft = new THREE.Object3D(); gripLeft.name = 'gripLeft';
  gripLeft.position.copy(KNOB);
  reel.handle.add(gripLeft);
  const tip = new THREE.Object3D(); tip.name = 'rodTip';

  for (const m of [blank, wrapMesh, guideMesh, hardware, reel.mesh]) {
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    object.add(m === reel.mesh ? reelGroup : m);
  }
  object.add(gripRight, tip);

  // ---------- bend model --------------------------------------------------
  // The blank is a curve whose tangent angle grows as Θ(s) = load·x^(p+1) + sag·x^(q+1),
  // x = (s/L - U0)/(1-U0). load/sag are 2D angle vectors in the rod's XY plane.
  const cP = new Float32Array((NC + 1) * 3);
  let lvx = 0, lvy = 0, lvvx = 0, lvvy = 0, ltx = 0, lty = 0;
  let pCur = 3, pT = 3, sgx = 0, sgy = -SAG_TIP;
  let bendAmount = 0, hasTarget = false;
  const bendTarget = new THREE.Vector3();
  const invU = 1 / (1 - U0);
  let TX = 0, TY = 0;
  const F = { px: 0, py: 0, pz: 0, ax: 1, ay: 0, az: 0, bx: 0, by: 1, bz: 0, cx: 0, cy: 0, cz: 1 };

  function thetaAt(s) {
    const u = s / L;
    if (u <= U0) { TX = 0; TY = 0; return; }
    const x = (u - U0) * invU;
    const fl = Math.pow(x, pCur + 1), fs = Math.pow(x, SAG_P + 1);
    TX = lvx * fl + sgx * fs; TY = lvy * fl + sgy * fs;
  }
  function rotFrom(tx, ty) {
    const a = Math.sqrt(tx * tx + ty * ty);
    if (a < 1e-9) { F.ax = 1; F.ay = 0; F.az = 0; F.bx = 0; F.by = 1; F.bz = 0; F.cx = 0; F.cy = 0; F.cz = 1; return; }
    const dx = tx / a, dy = ty / a, ax = -dy, ay = dx, c = Math.cos(a), s = Math.sin(a), k = 1 - c;
    F.ax = c + k * ax * ax; F.ay = k * ax * ay; F.az = -s * ay;
    F.bx = k * ax * ay; F.by = c + k * ay * ay; F.bz = s * ax;
    F.cx = s * dx; F.cy = s * dy; F.cz = c;
  }
  function frameAt(s) {
    let ext = 0;
    if (s > L) { ext = s - L; s = L; } else if (s < 0) { ext = s; s = 0; }
    thetaAt(s); rotFrom(TX, TY);
    const f = s / DSC; let i = Math.floor(f); if (i >= NC) i = NC - 1; const t = f - i, k = i * 3;
    F.px = cP[k] + (cP[k + 3] - cP[k]) * t + F.cx * ext;
    F.py = cP[k + 1] + (cP[k + 4] - cP[k + 1]) * t + F.cy * ext;
    F.pz = cP[k + 2] + (cP[k + 5] - cP[k + 2]) * t + F.cz * ext;
  }
  function integrate() {
    let x = 0, y = 0, z = 0;
    cP[0] = cP[1] = cP[2] = 0;
    for (let i = 0; i < NC; i++) {
      thetaAt((i + 0.5) * DSC);
      const a = Math.sqrt(TX * TX + TY * TY);
      let tx = TX, ty = TY, tz = 1;
      if (a > 1e-9) { const s = Math.sin(a) / a; tx = TX * s; ty = TY * s; tz = Math.cos(a); }
      x += tx * DSC; y += ty * DSC; z += tz * DSC;
      cP[i * 3 + 3] = x; cP[i * 3 + 4] = y; cP[i * 3 + 5] = z;
    }
  }
  function rebuild() {
    integrate();
    // blank
    for (let j = 0; j < NS; j++) {
      frameAt(st[j]);
      const r = stR[j];
      for (let i = 0; i <= BR; i++) {
        const c = cosT[i], s = sinT[i], k = (j * BW + i) * 3;
        const nx = F.ax * c + F.bx * s, ny = F.ay * c + F.by * s, nz = F.az * c + F.bz * s;
        bPos[k] = F.px + nx * r; bPos[k + 1] = F.py + ny * r; bPos[k + 2] = F.pz + nz * r;
        bNor[k] = nx; bNor[k + 1] = ny; bNor[k + 2] = nz;
      }
    }
    bGeo.attributes.position.needsUpdate = true; bGeo.attributes.normal.needsUpdate = true;
    // wraps
    for (let j = 0; j < NWR; j++) {
      frameAt(wRingS[j]);
      const nr = wRingNR[j], nzz = wRingNZ[j];
      for (let i = 0; i <= WR; i++) {
        const v = j * WWd + i, k = v * 3, c = wCos[i], s = wSin[i], r = wR[v];
        const rx = F.ax * c + F.bx * s, ry = F.ay * c + F.by * s, rz = F.az * c + F.bz * s;
        wPos[k] = F.px + rx * r; wPos[k + 1] = F.py + ry * r; wPos[k + 2] = F.pz + rz * r;
        wNor[k] = rx * nr + F.cx * nzz; wNor[k + 1] = ry * nr + F.cy * nzz; wNor[k + 2] = rz * nr + F.cz * nzz;
      }
    }
    wGeo.attributes.position.needsUpdate = true; wGeo.attributes.normal.needsUpdate = true;
    // guides: sample the bend frame GS+1 times across each guide, vertices interpolate
    for (const [v0, v1, st0, zmin, zmax] of gRanges) {
      const span = Math.max(1e-6, zmax - zmin);
      for (let q = 0; q <= GS; q++) {
        frameAt(st0 + zmin + span * q / GS);
        const o = q * 12;
        SF[o] = F.px; SF[o + 1] = F.py; SF[o + 2] = F.pz; SF[o + 3] = F.ax; SF[o + 4] = F.ay; SF[o + 5] = F.az;
        SF[o + 6] = F.bx; SF[o + 7] = F.by; SF[o + 8] = F.bz; SF[o + 9] = F.cx; SF[o + 10] = F.cy; SF[o + 11] = F.cz;
      }
      for (let v = v0; v < v1; v++) {
        const k = v * 3, x = gTP[k], y = gTP[k + 1];
        const f = (gTP[k + 2] - zmin) / span * GS;
        let q = Math.floor(f); if (q >= GS) q = GS - 1; if (q < 0) q = 0;
        const t = f - q, u = 1 - t, o = q * 12, o2 = o + 12;
        const px = SF[o] * u + SF[o2] * t, py = SF[o + 1] * u + SF[o2 + 1] * t, pz = SF[o + 2] * u + SF[o2 + 2] * t;
        const ax = SF[o + 3] * u + SF[o2 + 3] * t, ay = SF[o + 4] * u + SF[o2 + 4] * t, az = SF[o + 5] * u + SF[o2 + 5] * t;
        const bx = SF[o + 6] * u + SF[o2 + 6] * t, by = SF[o + 7] * u + SF[o2 + 7] * t, bz = SF[o + 8] * u + SF[o2 + 8] * t;
        const cx = SF[o + 9] * u + SF[o2 + 9] * t, cy = SF[o + 10] * u + SF[o2 + 10] * t, cz = SF[o + 11] * u + SF[o2 + 11] * t;
        gPos[k] = px + ax * x + bx * y; gPos[k + 1] = py + ay * x + by * y; gPos[k + 2] = pz + az * x + bz * y;
        const a = gTN[k], b = gTN[k + 1], c = gTN[k + 2];
        gNor[k] = ax * a + bx * b + cx * c; gNor[k + 1] = ay * a + by * b + cy * c; gNor[k + 2] = az * a + bz * b + cz * c;
      }
    }
    gGeo.attributes.position.needsUpdate = true; gGeo.attributes.normal.needsUpdate = true;
    // tip marker
    frameAt(L + TIP.z);
    tip.position.set(F.px - F.bx * TIP.h, F.py - F.by * TIP.h, F.pz - F.bz * TIP.h);
    _m4.makeBasis(_g.set(F.ax, F.ay, F.az), _t.set(F.bx, F.by, F.bz), _c3.set(F.cx, F.cy, F.cz));
    tip.quaternion.setFromRotationMatrix(_m4);
  }
  // local ring centre of guide i (i === GUIDES.length -> tip-top)
  function ringCentre(i, out) {
    if (i < GUIDES.length) { const g = GUIDES[i]; frameAt(g.s); return out.set(F.px - F.bx * g.h, F.py - F.by * g.h, F.pz - F.bz * g.h); }
    frameAt(L + TIP.z);
    return out.set(F.px - F.bx * TIP.h, F.py - F.by * TIP.h, F.pz - F.bz * TIP.h);
  }

  // ---------- reel state
  let crank = 0, bailOpen = false, drag = 0.5, spoolFrac = 0.85;
  let handleA = 0, rotorA = 0, dragA = 0;
  let bailFrom = BAIL_CLOSED, bailTo = BAIL_CLOSED, bailK = 1, bailA = BAIL_CLOSED;
  reel.bail.rotation.x = BAIL_CLOSED;

  let last = [NaN, NaN, NaN, NaN, NaN];
  let first = true;

  const api = {
    object, length: L, gripRight, gripLeft, tip,
    reel: { mesh: reel.mesh, rotor: reel.rotor, bail: reel.bail, spool: reel.spool, handle: reel.handle },
    setBend(amount, targetWorld) {
      bendAmount = clamp(+amount || 0, 0, 1.6);
      if (targetWorld) { bendTarget.copy(targetWorld); hasTarget = true; }
    },
    setReel(o = {}) {
      if (o.crank !== undefined) crank = +o.crank || 0;
      if (o.drag !== undefined) drag = clamp(+o.drag || 0, 0, 1);
      if (o.bailOpen !== undefined && !!o.bailOpen !== bailOpen) {
        bailOpen = !!o.bailOpen;
        bailFrom = bailA; bailTo = bailOpen ? BAIL_OPEN : BAIL_CLOSED; bailK = 0;
      }
    },
    setSpoolLine(f) { spoolFrac = clamp(+f || 0, 0, 1); },
    getLinePath(out) {
      object.updateWorldMatrix(true, true);
      const n = GUIDES.length + 2;
      while (out.length < n) out.push(new THREE.Vector3());
      out.length = n;
      if (bailA < 1.4) out[0].copy(ROLLER_LOCAL).applyMatrix4(reel.bail.matrixWorld);
      else out[0].copy(LIP_LOCAL).applyMatrix4(reel.spool.matrixWorld);
      for (let i = 0; i <= GUIDES.length; i++) ringCentre(i, out[i + 1]).applyMatrix4(object.matrixWorld);
      return out;
    },
    update(dt) {
      dt = clamp(dt || 0, 0, 0.1);
      // gravity sag from the rod's current world orientation
      object.getWorldQuaternion(_q);
      _g.set(0, -1, 0).applyQuaternion(_q.invert());
      sgx = _g.x * SAG_TIP; sgy = _g.y * SAG_TIP;
      // load target: tip tangent turns toward the line direction
      if (bendAmount > 0 && hasTarget) {
        object.updateWorldMatrix(true, false);
        _t.copy(bendTarget); object.worldToLocal(_t);
        const k = NC * 3, dx = _t.x - cP[k], dy = _t.y - cP[k + 1], dz = _t.z - cP[k + 2];
        const perp = Math.sqrt(dx * dx + dy * dy), phi = Math.atan2(perp, dz);
        const th = Math.min(2.3, phi * (1 - Math.exp(-1.6 * bendAmount)));
        if (perp > 1e-6) { ltx = dx / perp * th; lty = dy / perp * th; } else { ltx = 0; lty = 0; }
      } else { ltx = 0; lty = 0; }
      pT = lerp(3.0, 1.0, clamp(bendAmount / 1.3, 0, 1));
      pCur += (pT - pCur) * (1 - Math.exp(-6 * dt));
      // damped spring (rod recoil / tip vibration when the load changes)
      const W0 = TAU * 2.3, Z = 0.3;
      const steps = Math.max(1, Math.ceil(dt * 240)), h = dt / steps;
      for (let i = 0; i < steps; i++) {
        lvvx += (W0 * W0 * (ltx - lvx) - 2 * Z * W0 * lvvx) * h;
        lvvy += (W0 * W0 * (lty - lvy) - 2 * Z * W0 * lvvy) * h;
        lvx += lvvx * h; lvy += lvvy * h;
      }
      const sig = [lvx, lvy, sgx, sgy, pCur];
      let changed = first;
      for (let i = 0; i < 5; i++) if (!(Math.abs(sig[i] - last[i]) < 1e-6)) changed = true;
      if (changed) { rebuild(); last = sig; first = false; }

      // reel mechanics
      handleA += crank * TAU * dt;
      rotorA -= crank * TAU * 5.2 * dt;
      reel.handle.rotation.x = handleA;
      reel.rotor.rotation.z = rotorA;
      reel.spool.position.z = -0.0022 + 0.0062 * Math.sin(handleA * 0.55);
      if (bailK < 1) {
        bailK = Math.min(1, bailK + dt / 0.16);
        bailA = bailFrom + (bailTo - bailFrom) * easeOutBack(bailK);
      } else bailA = bailTo;
      reel.bail.rotation.x = bailA;
      dragA += (-drag * 4.2 - dragA) * (1 - Math.exp(-10 * dt));
      reel.drag.rotation.z = dragA;
      const rf = (0.0168 + 0.0006 + spoolFrac * (0.0237 - 0.0174)) / 0.0237;
      reel.line.scale.set(rf, rf, 1);
    },
    dispose() {
      for (const m of [blank, wrapMesh, guideMesh, hardware, reel.mesh]) m.geometry.dispose();
      matAtlas.dispose(); matBlank.dispose(); matWrap.dispose();
    },
    stats: null,
  };
  api.stats = {
    drawCalls: 5,
    triangles: { blank: bIdx.length / 3, wraps: wIdx.length / 3, guides: gGeo.index.count / 3, grip: hardware.geometry.index.count / 3, reel: reel.tris },
  };
  api.stats.triangles.total = Object.values(api.stats.triangles).reduce((a, b) => a + b, 0);
  api.update(0);
  return api;
}
