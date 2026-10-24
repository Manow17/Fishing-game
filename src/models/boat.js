// Alpenfisch — player boats, plus a landing net. Everything is procedural: geometry
// is built from code and every texture is painted into a canvas at load time.
//
//   'weidling'    traditional Swiss Weidling (Aare/Rhine river boat), 15 hp tiller outboard
//   'runabout'    classic Swiss mahogany runabout (Boesch / Riva style), inboard, ~7 m
//   'sportfisher' modern centre-console sport-fishing boat, twin outboards, ~10 m
//
// Conventions: bow +Z, up +Y, origin = hull centre on the design waterline. No scale is
// baked in: the game scales `object` for the size slider and places anglers itself.
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
  const shield = () => { ctx.beginPath(); ctx.moveTo(30, 28); ctx.lineTo(78, 28); ctx.lineTo(78, 76); ctx.quadraticCurveTo(54, 104, 30, 76); ctx.closePath(); };
  if (text.startsWith('LU')) { // Lucerne: per pale azure and argent
    shield(); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.save(); shield(); ctx.clip(); ctx.fillStyle = '#2a64b4'; ctx.fillRect(30, 28, 24, 80); ctx.restore();
    shield(); ctx.lineWidth = 2; ctx.strokeStyle = '#111'; ctx.stroke();
  } else { // tiny Bernese shield
    ctx.fillStyle = '#d52b1e'; shield(); ctx.fill();
    ctx.fillStyle = '#f1c40f'; ctx.beginPath(); ctx.moveTo(30, 28); ctx.lineTo(78, 28); ctx.lineTo(30, 76); ctx.closePath(); ctx.fill();
  }
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

// Varnished mahogany planking. Grain runs along U; 1 tile = 2.0 m (U) x 0.72 m (V), 8 planks of 9 cm.
// deck: pale caulking between the planks (Riva style), hull: tight dark seams. data: R bump, G roughness.
function mahoganyTextures(seed = 21) {
  const W = 1024, H = 512, PL = 8, PH = H / PL; const n = makeNoise(seed); const R = rng(seed);
  const tone = Array.from({ length: PL }, () => 0.84 + R() * 0.26);
  const warm = Array.from({ length: PL }, () => (R() - 0.5) * 0.12);
  const ph = Array.from({ length: PL }, () => R() * 10);
  const fr = Array.from({ length: PL }, () => 4 + R() * 5);
  const cv = canvas(W, H), dv = canvas(W, H);
  const ci = cv.getContext('2d').createImageData(W, H), di = dv.getContext('2d').createImageData(W, H);
  // the warp field is smooth: evaluate it on a coarse grid and interpolate (keeps the first build quick)
  const GS = 8, GW = W / GS + 1, GH = H / GS + 1, G = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) G[gy * GW + gx] = n.fbm((gx * GS / W) * 4, (gy * GS / H) * 8, 3, 4, 8);
  const s4 = new Float32Array(W), c4 = new Float32Array(W);
  for (let x = 0; x < W; x++) { s4[x] = Math.sin(x / W * Math.PI * 4); c4[x] = Math.cos(x / W * Math.PI * 4); }
  const cd = ci.data, dd = di.data;
  for (let y = 0; y < H; y++) {
    const p = Math.floor(y / PH), fp = (y % PH + 0.5) / PH, fy = y / H, gy = Math.min(GH - 2, (y / GS) | 0), ty = y / GS - gy;
    const sp = Math.sin(p), cp = Math.cos(p), base = fp * fr[p] * 0.5 + ph[p], tk = tone[p], w = warm[p];
    const edge = Math.min(fp, 1 - fp) * PH, seam = edge < 2.2;
    for (let x = 0; x < W; x++) {
      const fx = x / W, gx = Math.min(GW - 2, (x / GS) | 0), tx = x / GS - gx, g0 = gy * GW + gx;
      const warp = (G[g0] * (1 - tx) + G[g0 + 1] * tx) * (1 - ty) + (G[g0 + GW] * (1 - tx) + G[g0 + GW + 1] * tx) * ty;
      const rib = Math.sin((base + warp * 2.4 + (s4[x] * cp + c4[x] * sp) * 0.25) * Math.PI * 2); // ribbon figure
      const fine = n(fx * 12, fy * 700, 12, 700);
      const pore = n(fx * 220, fy * 1100, 220, 1100) < 0.22;
      const dark = Math.max(0, Math.min(1, 0.5 + rib * 0.16 + (fine - 0.5) * 0.34 + (warp - 0.5) * 0.3 + (pore ? 0.18 : 0)));
      const k = tk * (1.12 - dark * 0.42), i = (y * W + x) * 4;
      cd[i] = 126 * k * (1 + w); cd[i + 1] = 54 * k * (1 - w * 0.5); cd[i + 2] = 30 * k * (1 - w); cd[i + 3] = 255;
      dd[i] = 255 * (seam ? 0.18 : 0.62 + rib * 0.04 + (fine - 0.5) * 0.12 - (pore ? 0.12 : 0));
      dd[i + 1] = 255 * (seam ? 0.55 : 0.16 + (pore ? 0.08 : 0) + dark * 0.05); dd[i + 2] = 0; dd[i + 3] = 255;
    }
  }
  const out = {};
  for (const kind of ['deck', 'hull']) {
    const c = canvas(W, H), ctx = c.getContext('2d'); ctx.putImageData(ci, 0, 0);
    for (let p = 0; p <= PL; p++) {
      const y = p * PH;
      if (kind === 'deck') {
        ctx.fillStyle = 'rgba(60,30,16,0.55)'; ctx.fillRect(0, y - 2.6, W, 5.2);    // dark shadow line either side
        ctx.fillStyle = '#d8cbae'; ctx.fillRect(0, y - 1.7, W, 3.4);                  // pale caulking
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, y - 0.5, W, 1.0);
      } else { ctx.fillStyle = 'rgba(40,16,6,0.55)'; ctx.fillRect(0, y - 1, W, 2); }
    }
    out[kind] = tex(c);
  }
  dv.getContext('2d').putImageData(di, 0, 0); out.data = tex(dv, false);
  return out;
}

// Cream upholstery leather (also tinted grey/white for marine vinyl). Fine grain + soft creases.
function leatherTexture() {
  const S = 256, cv = canvas(S, S), ctx = cv.getContext('2d'), im = ctx.createImageData(S, S); const n = makeNoise(17);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const g = n(x / 2, y / 2, 128, 128), c = n.fbm(x / 32, y / 32, 3, 8, 8);
    const k = 0.93 + (g - 0.5) * 0.06 + (c - 0.5) * 0.05; const i = (y * S + x) * 4;
    im.data[i] = 240 * k; im.data[i + 1] = 230 * k; im.data[i + 2] = 207 * k; im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0); return tex(cv);
}

// Moulded non-skid deck: raised diamond pyramids in a smooth gelcoat. 1 tile = 0.25 m.
function nonSkidTexture() {
  const S = 256, C = 20, cv = canvas(S, S), bv = canvas(S, S);
  const ctx = cv.getContext('2d'), im = ctx.createImageData(S, S), bm = bv.getContext('2d').createImageData(S, S); const n = makeNoise(29);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x / S) * C, v = (y / S) * C; const fu = u - Math.floor(u) - 0.5, fv = v - Math.floor(v) - 0.5;
    const h = clamp(1 - (Math.abs(fu) + Math.abs(fv)) * 2.2, 0, 1);
    const dirt = n.fbm(x / 32, y / 32, 3, 8, 8);
    const k = (0.93 + h * 0.05) * (0.97 + dirt * 0.04) - (h < 0.05 ? 0.02 : 0); const i = (y * S + x) * 4;
    im.data[i] = 236 * k; im.data[i + 1] = 239 * k; im.data[i + 2] = 238 * k; im.data[i + 3] = 255;
    bm.data[i] = bm.data[i + 1] = bm.data[i + 2] = 255 * Math.pow(h, 0.7); bm.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0); bv.getContext('2d').putImageData(bm, 0, 0);
  return { map: tex(cv), bump: tex(bv, false) };
}

// Instrument / decal atlas (1024 x 1024) + matching emissive map. Regions in px (x, y, w, h).
const ATLAS = {
  speedo: [0, 0, 256, 256], tacho: [256, 0, 256, 256],
  small: [[512, 0], [640, 0], [768, 0], [896, 0], [512, 128], [640, 128], [768, 128], [896, 128]], // 128 x 128
  mfd: [0, 256, 512, 320], engine: [512, 256, 256, 160], switches: [768, 256, 256, 128], keys: [768, 384, 256, 32],
  compass: [512, 416, 128, 128], red: [640, 416, 64, 64], green: [704, 416, 64, 64], white: [768, 416, 64, 64],
  amber: [832, 416, 64, 64], emblem: [896, 416, 128, 128], dashDark: [640, 480, 128, 64],
  rbName: [0, 576, 1024, 160], sfName: [0, 736, 1024, 128], sfBrand: [0, 864, 512, 96], sfModel: [512, 864, 512, 96],
  glovebox: [0, 960, 256, 64], vent: [256, 960, 128, 64],
};
function atlasUV(key, i) { const r = i == null ? ATLAS[key] : [...ATLAS[key][i], 128, 128]; return { u0: r[0] / 1024, u1: (r[0] + r[2]) / 1024, v0: 1 - (r[1] + r[3]) / 1024, v1: 1 - r[1] / 1024 }; }
// planar quad (w x h, centred, facing +Z) mapped to an atlas region
function atlasQuad(key, w, h, i) {
  const g = new THREE.PlaneGeometry(w, h); const r = atlasUV(key, i); const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, lerp(r.u0, r.u1, uv.getX(k)), lerp(r.v0, r.v1, uv.getY(k)));
  return g;
}
// disc facing +Z mapped to a square atlas region
function atlasDisc(key, r, i, seg = 28) {
  const g = new THREE.CircleGeometry(r, seg); const a = atlasUV(key, i); const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, lerp(a.u0, a.u1, uv.getX(k)), lerp(a.v0, a.v1, uv.getY(k)));
  return g;
}

function panelAtlas() {
  const S = 1024, cv = canvas(S, S), ctx = cv.getContext('2d'), ev = canvas(S, S), e = ev.getContext('2d');
  ctx.fillStyle = '#1a1c1f'; ctx.fillRect(0, 0, S, S); e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  const font = (px, w = 'bold') => `${w} ${px}px Arial, Helvetica, sans-serif`;
  // --- classic chrome-bezel gauges with cream faces (runabout) or black faces (sportfisher)
  const gauge = (x, y, s, { label, max, step, cream = true, unit = '', glow = 0.18, arc = 1.5 }) => {
    const cx = x + s / 2, cy = y + s / 2, R = s / 2 - 2;
    let g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#9aa0a6'); g.addColorStop(0.8, '#e9edf0'); g.addColorStop(1, '#5d636a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    const r = R * 0.84;
    g = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
    if (cream) { g.addColorStop(0, '#fbf5e4'); g.addColorStop(1, '#e2d6b8'); } else { g.addColorStop(0, '#26292e'); g.addColorStop(1, '#0d0e10'); }
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    const ink = cream ? '#16181a' : '#f2f4f6';
    const a0 = Math.PI * (0.5 + (2 - arc) / 2), a1 = a0 + Math.PI * arc; const steps = Math.round(max / step);
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let k = 0; k <= steps * 2; k++) {
      const a = lerp(a0, a1, k / (steps * 2)), big = k % 2 === 0; ctx.lineWidth = big ? s * 0.016 : s * 0.008;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92); ctx.lineTo(cx + Math.cos(a) * r * (big ? 0.76 : 0.83), cy + Math.sin(a) * r * (big ? 0.76 : 0.83)); ctx.stroke();
      if (big && s > 100) { ctx.font = font(s * 0.085); ctx.fillText(String((k / 2) * step), cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6); }
    }
    if (!cream) { ctx.strokeStyle = '#d4322a'; ctx.lineWidth = s * 0.02; ctx.beginPath(); ctx.arc(cx, cy, r * 0.9, lerp(a0, a1, 0.82), a1); ctx.stroke(); }
    ctx.font = font(s * (s > 100 ? 0.075 : 0.13)); ctx.fillStyle = ink; ctx.fillText(label, cx, cy + r * (s > 100 ? 0.38 : 0.5));
    if (unit) { ctx.font = font(s * 0.05, 'normal'); ctx.fillText(unit, cx, cy + r * 0.52); }
    const na = lerp(a0, a1, 0.22); ctx.strokeStyle = cream ? '#b0201b' : '#ff5a2c'; ctx.lineWidth = s * 0.022; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - Math.cos(na) * r * 0.12, cy - Math.sin(na) * r * 0.12); ctx.lineTo(cx + Math.cos(na) * r * 0.78, cy + Math.sin(na) * r * 0.78); ctx.stroke();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.08, 0, Math.PI * 2); ctx.fill();
    const hl = ctx.createLinearGradient(cx, cy - r, cx, cy); hl.addColorStop(0, 'rgba(255,255,255,0.35)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl; ctx.beginPath(); ctx.ellipse(cx, cy - r * 0.45, r * 0.75, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    e.fillStyle = `rgba(255,236,200,${glow})`; e.beginPath(); e.arc(cx, cy, r, 0, Math.PI * 2); e.fill();
  };
  gauge(0, 0, 256, { label: 'KM/H', max: 80, step: 10, unit: 'ALPENFISCH' });
  gauge(256, 0, 256, { label: 'RPM x1000', max: 6, step: 1, unit: 'V8 · 5.7 L' });
  [['FUEL', 4, 1], ['OIL', 8, 2], ['TEMP', 120, 30], ['VOLT', 16, 4]].forEach(([l, m, st], k) => gauge(512 + k * 128, 0, 128, { label: l, max: m, step: st }));
  [['TRIM', 10, 5], ['FUEL', 4, 1], ['RPM', 6, 1], ['KN', 50, 10]].forEach(([l, m, st], k) => gauge(512 + k * 128, 128, 128, { label: l, max: m, step: st, cream: false, glow: 0.25 }));
  // --- multifunction display: chart plotter (left) + sonar echogram (right)
  {
    const [x, y, w, h] = ATLAS.mfd; const n = makeNoise(41);
    ctx.fillStyle = '#0b0c0e'; ctx.fillRect(x, y, w, h);
    const sx = x + 12, sy = y + 12, sw = w - 24, sh = h - 24, half = sw * 0.55;
    ctx.fillStyle = '#9fd3ef'; ctx.fillRect(sx, sy, half, sh);          // sea
    ctx.fillStyle = '#f0e2b0'; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + half * 0.45, sy);   // coast
    for (let k = 0; k <= 20; k++) { const t = k / 20; ctx.lineTo(sx + half * (0.45 + 0.25 * Math.sin(t * 7) * t + 0.1 * t), sy + t * sh * 0.55); }
    ctx.lineTo(sx, sy + sh * 0.6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#5d8fb0'; ctx.lineWidth = 1;
    for (let c = 1; c <= 4; c++) { ctx.beginPath(); for (let k = 0; k <= 30; k++) { const t = k / 30; const px = sx + half * (0.45 + 0.25 * Math.sin(t * 7) * t + 0.1 * t) + c * 22, py = sy + t * sh * 0.75 + c * 10; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); }
    ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.moveTo(sx + half * 0.62, sy + sh * 0.62); ctx.lineTo(sx + half * 0.58, sy + sh * 0.72); ctx.lineTo(sx + half * 0.66, sy + sh * 0.72); ctx.fill();
    ctx.strokeStyle = '#1b1b1b'; ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx + half * 0.62, sy + sh * 0.66); ctx.lineTo(sx + half * 0.95, sy + sh * 0.2); ctx.stroke(); ctx.setLineDash([]);
    const ex = sx + half + 6, ew = sw - half - 6;                        // sonar
    const g = ctx.createLinearGradient(0, sy, 0, sy + sh); g.addColorStop(0, '#0a1f6b'); g.addColorStop(1, '#03092b');
    ctx.fillStyle = g; ctx.fillRect(ex, sy, ew, sh);
    for (let px = 0; px < ew; px++) {
      const bot = sy + sh * (0.62 + 0.12 * Math.sin(px * 0.035) + 0.05 * n(px * 0.08, 3, 64, 64));
      const gr = ctx.createLinearGradient(0, bot, 0, sy + sh); gr.addColorStop(0, '#ff3b1f'); gr.addColorStop(0.15, '#f4d03f'); gr.addColorStop(0.45, '#2e86de'); gr.addColorStop(1, '#0a1f6b');
      ctx.fillStyle = gr; ctx.fillRect(ex + px, bot, 1, sy + sh - bot);
    }
    for (const [fx2, fy2] of [[0.3, 0.35], [0.55, 0.42], [0.62, 0.28], [0.8, 0.5]]) { ctx.strokeStyle = '#f39c12'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(ex + ew * fx2, sy + sh * fy2, 6, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(sx, sy, sw, 22); ctx.fillStyle = '#fff'; ctx.font = font(15); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('14.2 kn   SOG     46°12\'N 06°09\'E', sx + 6, sy + 11); ctx.textAlign = 'right'; ctx.fillText('24.6 m   18.4 °C', sx + sw - 6, sy + 11);
    e.globalAlpha = 0.55; e.drawImage(cv, sx, sy, sw, sh, sx, sy, sw, sh); e.globalAlpha = 1;   // backlit: glow in the screen's own colours
  }
  // --- engine data display
  { const [x, y, w, h] = ATLAS.engine; ctx.fillStyle = '#07080a'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#10161c'; ctx.fillRect(x + 8, y + 8, w - 16, h - 16);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#7fd3ff'; ctx.font = font(13); ctx.fillText('PORT', x + 18, y + 30); ctx.fillText('STBD', x + 140, y + 30);
    ctx.fillStyle = '#fff'; ctx.font = font(34); ctx.fillText('4850', x + 16, y + 70); ctx.fillText('4870', x + 138, y + 70);
    ctx.font = font(12, 'normal'); ctx.fillStyle = '#b8c4cc'; ctx.fillText('RPM   TRIM 12%', x + 18, y + 92); ctx.fillText('RPM   TRIM 12%', x + 140, y + 92);
    ctx.fillStyle = '#3ad16b'; ctx.fillRect(x + 18, y + 108, 90, 10); ctx.fillRect(x + 140, y + 108, 88, 10); ctx.fillStyle = '#b8c4cc'; ctx.fillText('FUEL 412 L', x + 18, y + 138);
    e.globalAlpha = 0.6; e.drawImage(cv, x + 8, y + 8, w - 16, h - 16, x + 8, y + 8, w - 16, h - 16); e.globalAlpha = 1; }
  // --- rocker switch panel with blue LEDs
  { const [x, y, w, h] = ATLAS.switches; ctx.fillStyle = '#16181b'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#2a2e33'; ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
    for (let k = 0; k < 6; k++) { const sx = x + 14 + k * 39; ctx.fillStyle = '#0c0d0f'; ctx.fillRect(sx, y + 30, 28, 60); ctx.fillStyle = '#34383d'; ctx.fillRect(sx + 3, y + 33, 22, 26);
      ctx.fillStyle = '#4aa8ff'; ctx.fillRect(sx + 10, y + 72, 8, 8); e.fillStyle = '#4aa8ff'; e.fillRect(sx + 9, y + 71, 10, 10);
      ctx.fillStyle = '#c8cdd2'; ctx.font = font(9); ctx.textAlign = 'center'; ctx.fillText(['NAV', 'ANC', 'BILGE', 'WELL', 'HORN', 'LTS'][k], sx + 14, y + 110); } }
  // --- ignition keys strip
  { const [x, y, w, h] = ATLAS.keys; ctx.fillStyle = '#9aa0a6'; ctx.fillRect(x, y, w, h); }
  // --- compass card
  { const [x, y, w] = ATLAS.compass; const cx = x + w / 2, cy = y + w / 2; ctx.fillStyle = '#101214'; ctx.fillRect(x, y, w, w);
    ctx.fillStyle = '#f3efe6'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.46, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111'; ctx.font = font(18); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ['N', 'E', 'S', 'W'].forEach((l, k) => { const a = k * Math.PI / 2 - Math.PI / 2; ctx.fillStyle = k ? '#111' : '#c0392b'; ctx.fillText(l, cx + Math.cos(a) * w * 0.33, cy + Math.sin(a) * w * 0.33); });
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1; for (let k = 0; k < 36; k++) { const a = k * Math.PI / 18; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * w * 0.44, cy + Math.sin(a) * w * 0.44); ctx.lineTo(cx + Math.cos(a) * w * (k % 3 ? 0.41 : 0.38), cy + Math.sin(a) * w * (k % 3 ? 0.41 : 0.38)); ctx.stroke(); }
    e.fillStyle = 'rgba(255,220,180,0.2)'; e.beginPath(); e.arc(cx, cy, w * 0.46, 0, Math.PI * 2); e.fill(); }
  // --- navigation light lenses (glow)
  for (const [k, col, glow] of [['red', '#e8231c', '#ff2a1a'], ['green', '#1fc35a', '#22ff6a'], ['white', '#fffbe8', '#fff6dd'], ['amber', '#ffb020', '#ffa000']]) {
    const [x, y, w, h] = ATLAS[k]; const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 2, x + w / 2, y + h / 2, w * 0.7); g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, col); g.addColorStop(1, col);
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h); e.fillStyle = glow; e.fillRect(x, y, w, h);
  }
  // --- Swiss emblem (wheel hub): red disc, white cross, chrome ring
  { const [x, y, w] = ATLAS.emblem; const cx = x + w / 2, cy = y + w / 2;
    const g = ctx.createRadialGradient(cx - 20, cy - 20, 5, cx, cy, w / 2); g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, '#8b9298'); g.addColorStop(1, '#dfe3e6');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, w); ctx.fillStyle = '#c8102e'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; const u = w * 0.4 / 16; ctx.fillRect(cx - 3 * u, cy - 10 * u, 6 * u, 20 * u); ctx.fillRect(cx - 10 * u, cy - 3 * u, 20 * u, 6 * u); }
  // --- dark dash filler, glovebox / vent textures
  { const [x, y, w, h] = ATLAS.dashDark; ctx.fillStyle = '#121315'; ctx.fillRect(x, y, w, h); }
  { // burl-veneer glovebox lid
    const [x, y, w, h] = ATLAS.glovebox; const n = makeNoise(77); const im = ctx.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const v = n.fbm(i / 18, j / 9, 4, 64, 64), r = Math.sin((n.fbm(i / 30 + 3, j / 12, 3, 64, 64) * 9 + v * 4) * Math.PI);
      const k = 0.55 + 0.25 * r + 0.2 * v; const o = (j * w + i) * 4;
      im.data[o] = 150 * k; im.data[o + 1] = 78 * k; im.data[o + 2] = 40 * k; im.data[o + 3] = 255;
    }
    ctx.putImageData(im, x, y); const g = ctx.createLinearGradient(x, y, x, y + h); g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  }
  { const [x, y, w, h] = ATLAS.vent; ctx.fillStyle = '#0e0f10'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#c9ced3';
    for (let k = 0; k < 7; k++) ctx.fillRect(x + 6, y + 6 + k * 8, w - 12, 4); }
  // --- decals with alpha (cut out by alphaTest): transom name boards and hull lettering
  const clearR = (r) => ctx.clearRect(r[0], r[1], r[2], r[3]);
  { const r = ATLAS.rbName; clearR(r); ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const g = ctx.createLinearGradient(0, r[1] + 20, 0, r[1] + 120); g.addColorStop(0, '#fff3c4'); g.addColorStop(0.45, '#d4a53c'); g.addColorStop(0.55, '#a87a1f'); g.addColorStop(1, '#f1d48a');
    ctx.font = 'italic bold 92px Georgia, "Times New Roman", serif'; ctx.lineWidth = 6; ctx.strokeStyle = '#3b2108'; ctx.strokeText('Alpenfisch', 512, r[1] + 100);
    ctx.fillStyle = g; ctx.fillText('Alpenfisch', 512, r[1] + 100);
    ctx.font = 'bold 34px Georgia, "Times New Roman", serif'; ctx.lineWidth = 4; ctx.strokeText('L U Z E R N', 512, r[1] + 148); ctx.fillText('L U Z E R N', 512, r[1] + 148); ctx.restore(); }
  { const r = ATLAS.sfName; clearR(r); ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round'; ctx.strokeStyle = '#f4f6f7'; ctx.fillStyle = '#16191d';
    ctx.font = 'italic 900 78px Arial, Helvetica, sans-serif'; ctx.lineWidth = 8; ctx.strokeText('ALPENFISCH', 512, r[1] + 78); ctx.fillText('ALPENFISCH', 512, r[1] + 78);
    ctx.font = 'bold 30px Arial, Helvetica, sans-serif'; ctx.lineWidth = 5; ctx.strokeText('B A S E L   ·   S W I T Z E R L A N D', 512, r[1] + 118); ctx.fillText('B A S E L   ·   S W I T Z E R L A N D', 512, r[1] + 118); ctx.restore(); }
  { const r = ATLAS.sfBrand; clearR(r); ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = 'italic 900 64px Arial, Helvetica, sans-serif'; ctx.fillStyle = '#1b2026'; ctx.fillText('ALPENFISCH', r[0] + 8, r[1] + 50);
    ctx.fillStyle = '#c8102e'; ctx.fillRect(r[0] + 440, r[1] + 22, 56, 56); ctx.fillStyle = '#fff'; ctx.fillRect(r[0] + 462, r[1] + 31, 12, 38); ctx.fillRect(r[0] + 449, r[1] + 44, 38, 12); ctx.restore(); }
  { const r = ATLAS.sfModel; clearR(r); ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.strokeStyle = '#f4f6f7';
    ctx.font = 'italic 900 70px Arial, Helvetica, sans-serif'; ctx.lineWidth = 7; ctx.strokeText('950', r[0] + 10, r[1] + 50); ctx.fillStyle = '#1b2026'; ctx.fillText('950', r[0] + 10, r[1] + 50);
    ctx.font = 'italic bold 40px Arial, Helvetica, sans-serif'; ctx.lineWidth = 5; ctx.strokeText('CENTER CONSOLE', r[0] + 150, r[1] + 54); ctx.fillStyle = '#5d6974'; ctx.fillText('CENTER CONSOLE', r[0] + 150, r[1] + 54); ctx.restore(); }
  return { map: tex(cv, true, false), emissive: tex(ev, true, false) };
}

// Big V8 outboard cowl decal atlas (same layout as cowlTexture: port half, starboard half).
function sfCowlTexture() {
  const W = 1024, H = 512, cv = canvas(W, H), ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2b2e33'); g.addColorStop(0.5, '#1b1d21'); g.addColorStop(1, '#121316');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (const ox of [0, 512]) {
    ctx.save(); ctx.translate(ox, 0);
    ctx.beginPath(); ctx.moveTo(30, 470); ctx.bezierCurveTo(170, 455, 330, 400, 490, 330); ctx.lineTo(490, 352); ctx.bezierCurveTo(330, 425, 170, 478, 30, 488); ctx.closePath();
    ctx.fillStyle = '#c9ced4'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(30, 494); ctx.bezierCurveTo(170, 486, 330, 440, 490, 362); ctx.lineTo(490, 370); ctx.bezierCurveTo(330, 450, 170, 494, 30, 500); ctx.closePath();
    ctx.fillStyle = '#d21f26'; ctx.fill();
    ctx.fillStyle = '#eef1f4'; ctx.textBaseline = 'alphabetic';
    ctx.font = 'italic 900 112px Arial, Helvetica, sans-serif'; ctx.fillText('300', 250, 380);
    ctx.font = 'bold 40px Arial, Helvetica, sans-serif'; ctx.fillText('ALPINA', 120, 300);
    ctx.font = 'italic bold 30px Arial, Helvetica, sans-serif'; ctx.fillStyle = '#d21f26'; ctx.fillText('V8', 420, 300);
    ctx.font = '15px Arial, Helvetica, sans-serif'; ctx.fillStyle = '#9aa2ab'; ctx.fillText('FOUR STROKE · 4.6 L · EFI', 122, 322);
    ctx.restore();
  }
  ctx.fillStyle = '#c4c9ce'; ctx.fillRect(W - 24, 0, 24, 24); // plain patch (uv 0.985) for the painted lower unit
  return tex(cv, true, false);
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
  M.chrome = new THREE.MeshStandardMaterial({ name: 'chrome', color: 0xffffff, vertexColors: true, metalness: 1, roughness: 0.13 });
  M.panel = null; // built lazily (instrument atlas)
  SHARED = { T, M };
  return SHARED;
}
// instrument / decal atlas material (shared by the runabout and the sportfisher)
function sharedPanel() {
  const S = shared();
  if (!S.M.panel) {
    const A = panelAtlas(); S.T.atlas = A;
    S.M.panel = new THREE.MeshStandardMaterial({ name: 'panel', map: A.map, emissiveMap: A.emissive, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.3, metalness: 0.05, alphaTest: 0.5, vertexColors: true });
    S.M.glass = new THREE.MeshPhysicalMaterial({ name: 'glass', color: 0xd8efe8, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.02 });
    S.M.leather = new THREE.MeshPhysicalMaterial({ name: 'leather', map: leatherTexture(), vertexColors: true, roughness: 0.52, sheen: 0.4, sheenRoughness: 0.5, sheenColor: 0xffffff, clearcoat: 0.15, clearcoatRoughness: 0.5 });
    S.M.leather.bumpMap = S.M.leather.map; S.M.leather.bumpScale = 0.6;
    S.M.bronze = new THREE.MeshStandardMaterial({ name: 'bronze', color: 0xc9935a, metalness: 1, roughness: 0.26, side: THREE.DoubleSide });
  }
  return S;
}
function sharedRunabout() {
  const S = sharedPanel();
  if (!S.M.mahog) {
    const T = mahoganyTextures(21); S.T.mahog = T;
    S.M.mahog = new THREE.MeshPhysicalMaterial({ name: 'mahogany-deck', map: T.deck, bumpMap: T.data, bumpScale: 0.9, roughnessMap: T.data, roughness: 1, vertexColors: true, specularIntensity: 0.25, clearcoat: 0.4, clearcoatRoughness: 0.08 });
    S.M.mahogP = new THREE.MeshPhysicalMaterial({ name: 'mahogany-panel', map: T.hull, bumpMap: T.data, bumpScale: 0.6, roughnessMap: T.data, roughness: 1, vertexColors: true, specularIntensity: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.1 });
  }
  return S;
}
function sharedSportfisher() {
  const S = sharedPanel();
  if (!S.M.gel) {
    const ns = nonSkidTexture(); S.T.nonskid = ns;
    S.M.gel = new THREE.MeshPhysicalMaterial({ name: 'gelcoat', color: 0xffffff, vertexColors: true, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.12 });
    S.M.glassTint = new THREE.MeshPhysicalMaterial({ name: 'glass-tint', color: 0x4a565c, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.03 });
    S.M.nonskid = new THREE.MeshStandardMaterial({ name: 'non-skid', map: ns.map, bumpMap: ns.bump, bumpScale: 1.6, vertexColors: true, roughness: 0.78 });
    { const cv = canvas(128, 128), ctx = cv.getContext('2d'), im = ctx.createImageData(128, 128); const n = makeNoise(53);   // faint orange-peel for the gelcoat hull
      for (let i = 0; i < 128 * 128; i++) { const k = 0.975 + 0.025 * n((i % 128) / 4, ((i / 128) | 0) / 4, 32, 32); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255 * k; im.data[i * 4 + 3] = 255; }
      ctx.putImageData(im, 0, 0); S.T.gelNoise = tex(cv); }
    S.M.sfCowl = new THREE.MeshPhysicalMaterial({ name: 'v8-cowl', map: sfCowlTexture(), vertexColors: true, roughness: 0.3, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 });
  }
  return S;
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

// Make the winding of an indexed geometry agree with an expected outward direction field
// expect(centroid: Vector3) -> Vector3. Saves reasoning about loft orientation case by case.
const _oa = V3(), _ob = V3(), _oc = V3(), _on = V3(), _om = V3();
function orient(geo, expect) {
  const p = geo.attributes.position, ix = geo.index.array; let s = 0;
  for (let i = 0; i < ix.length; i += 3) {
    _oa.fromBufferAttribute(p, ix[i]); _ob.fromBufferAttribute(p, ix[i + 1]); _oc.fromBufferAttribute(p, ix[i + 2]);
    _on.subVectors(_ob, _oa).cross(_om.subVectors(_oc, _oa));
    _om.copy(_oa).add(_ob).add(_oc).multiplyScalar(1 / 3);
    s += _on.dot(expect(_om));
  }
  if (s < 0) { for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } geo.computeVertexNormals(); }
  return geo;
}
const OUT_X = p => V3(Math.sign(p.x) || 1, 0, 0), UP = () => V3(0, 1, 0), DOWN = () => V3(0, -1, 0);

// Loft a strip over sections; prof(S) -> [[x, y], ...] (same count for every section).
// uv(S, p, girth, total, j) -> [u, v]; default: u along z, v = girth from the first point (0.72 m per tile).
function stripLoft(secs, prof, { uv = null, col = null, expect = null } = {}) {
  const P = secs.map(prof); const nJ = P[0].length;
  const G = P.map(pp => { const a = [0]; for (let k = 1; k < nJ; k++) a.push(a[k - 1] + Math.hypot(pp[k][0] - pp[k - 1][0], pp[k][1] - pp[k - 1][1])); return a; });
  const g = loftGrid(secs.length, nJ, (i, j) => {
    const S = secs[i], p = P[i][j]; const t = uv ? uv(S, p, G[i][j], G[i][nJ - 1], j) : [S.z * 0.5, G[i][j] / 0.72];
    return [p[0], p[1], S.z, t[0], t[1], col ? col(S, j, p) : WHITE];
  });
  return expect ? orient(g, expect) : g;
}

// Weathering for the Weidling's varnished wood: sun-bleached upward faces, blotchy tone, bilge grime.
function weatherWood(geo, seed) {
  const n = makeNoise(seed); const p = geo.attributes.position, nr = geo.attributes.normal, c = geo.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const blot = n.fbm(x * 2.5 + 40 + y * 1.7, z * 1.9 + 40, 3, 256, 256);
    const bleach = smooth(0.55, 0.95, nr.getY(i)) * smooth(0.2, 0.75, y) * (0.25 + 0.75 * blot) * 0.42;
    const grime = (1 - smooth(-0.15, 0.12, y)) * (0.08 + 0.14 * blot);
    let r = c.getX(i), g = c.getY(i), b = c.getZ(i); const k = 0.9 + blot * 0.18;
    r *= k; g *= k; b *= k; const L = (r + g + b) / 3;
    r = lerp(r, L * 1.12, bleach); g = lerp(g, L * 1.1, bleach); b = lerp(b, L * 1.06, bleach);
    c.setXYZ(i, r * (1 - grime), g * (1 - grime * 0.95), b * (1 - grime * 0.8));
  }
  c.needsUpdate = true;
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
        // the accent band takes its colour from the per-boat material (setAccent); the pinstripe is plain cream paint
        if (col === 'pin') B.add('plastic', hullStrip(ssecs, prof, true, null), null, lin(0xf3ead2));
        else B.add('accent', hullStrip(ssecs, prof, true, null), null, WHITE);
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
  // stern (driver), middle (fisher), front, and the passenger thwart between stern and middle
  const thwarts = [{ z: -3.10, y: 0.26 }, { z: -0.60, y: 0.26 }, { z: 1.45, y: 0.33 }, { z: -1.95, y: 0.26 }];
  const screw = new THREE.CylinderGeometry(0.0055, 0.0055, 0.003, 8);
  for (const t of thwarts) {
    const S = secAtZ(t.z); const half = innerX(S, t.y - 0.016) - 0.002;
    const g = new RoundedBoxGeometry(half * 2, 0.032, 0.22, 2, 0.008);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * half * 0.9, uv.getY(i) * 0.4);
    B.add('wood', g, M4(0, t.y - 0.016, t.z), [0.86, 0.74, 0.6]);
    // bronze screw heads where the thwart sits on the risers
    for (const side of [1, -1]) for (const dz of [-0.06, 0.06]) B.add('metal', screw, M4(side * (half - 0.03), t.y + 0.0005, t.z + dz), lin(0xa77b4a));
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
          // river scum / water staining just above the boot top, broken up by the grain
          float scum = (1.0 - hullTar) * (1.0 - hullBoot) * (1.0 - smoothstep(uTarY + 0.03, uTarY + 0.17, vHullP.y)) * (0.45 + 0.55 * smoothstep(0.1, 0.5, lum));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.66, 0.55), scum * 0.55);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.5 + 0.2 * roughnessFactor, hullTar); roughnessFactor = mix(roughnessFactor, 0.3, hullBoot); roughnessFactor = mix(roughnessFactor, 0.32, hullPaint);`);
  };
  m.customProgramCacheKey = () => 'weidling-hull-v3';
  return m;
}

const HIP = 0.10; // seated hip-joint height above the seat surface (matches angler.js)

// ----------------------------------------------------------------------------
// parts shared by all boat types
// ----------------------------------------------------------------------------
// Swiss flag, animated cloth. Origin at the top of the hoist; flies toward +X in its own frame.
function makeFlag(M, size = 0.3) {
  const FW = size, FH = size, k = size / 0.3, seg = 12;
  const geo = new THREE.PlaneGeometry(FW, FH, seg, seg); geo.translate(FW / 2, -FH / 2, 0);
  const base = geo.attributes.position.array.slice(); const pos = geo.attributes.position;
  const mesh = new THREE.Mesh(geo, M.flag); mesh.castShadow = true; mesh.name = 'flag';
  return {
    mesh,
    update(time, a) {
      const wind = 0.55 + 0.45 * a;
      for (let i = 0; i < pos.count; i++) {
        const x0 = base[i * 3], y0 = base[i * 3 + 1]; const u = x0 / FW, ys = y0 / k;
        const w = Math.sin(u * 7.5 - time * (6 + 6 * wind) + ys * 3) * 0.6 + Math.sin(u * 13 - time * 11 + ys * 9) * 0.25;
        pos.setXYZ(i, x0 * (1 - 0.04 * wind) - u * u * 0.01 * k, y0 - u * u * 0.03 * k * (1.2 - wind), w * u * 0.045 * k * (0.6 + wind));
      }
      pos.needsUpdate = true; geo.computeVertexNormals();
    },
  };
}

// Rope from `a` (fairlead) down to the bottom at `b`, shown while the anchor is down.
function anchorRopeMesh(M, a, b, r = 0.0075) {
  const mid = a.clone().lerp(b, 0.5).add(V3(0, -0.06, 0));
  const mesh = new THREE.Mesh(tube([a, a.clone().lerp(mid, 0.5).add(V3(0, -0.012, 0)), mid, b], r, 40, 6, false, 0.05), M.rope);
  mesh.castShadow = true; mesh.name = 'anchor-rope'; mesh.visible = false; return mesh;
}

// Steering wheel. Frame: wheel plane XY, column axis +Z (away from the driver). The returned `spin` group
// turns about Z; right/left hand targets sit on the rim at "ten to two" (right hand = driver's right = -X).
function buildWheel(M, { R = 0.19, rimR = 0.012, spokes = 'banjo', dish = 0.05, rim = 'chrome', rimCol = WHITE } = {}) {
  const B = new Buckets(); const CH = lin(0xe4e8eb);
  // rim with gentle finger grips on the inside
  const rg = new THREE.TorusGeometry(R, rimR, 10, 96); const p = rg.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const a = Math.atan2(y, x), r = Math.hypot(x, y);
    const inner = clamp((R - r) / rimR, 0, 1); const k = 1 - 0.18 * inner * Math.pow(Math.abs(Math.sin(a * 18)), 0.6);
    const nr = R - (R - r) * k; p.setXYZ(i, Math.cos(a) * nr, Math.sin(a) * nr, z * (0.95 + 0.05 * k));
  }
  rg.computeVertexNormals(); B.add(rim, rg, null, rimCol);
  const hub = new THREE.CylinderGeometry(0.036, 0.048, 0.07, 24); hub.rotateX(Math.PI / 2); B.add('chrome', hub, M4(0, 0, dish + 0.004), CH);
  const boss = new THREE.TorusGeometry(0.036, 0.006, 6, 24); B.add('chrome', boss, M4(0, 0, dish - 0.031), CH);
  B.add('panel', atlasDisc('emblem', 0.033, null, 24), M4(0, 0, dish - 0.031, 0, Math.PI, 0));
  if (spokes === 'banjo') {
    // three spokes (9, 3 and 6 o'clock), each a fan of four thin spring-steel wires
    for (const a of [0, Math.PI, -Math.PI / 2]) {
      const d = V3(Math.cos(a), Math.sin(a), 0), t = V3(-d.y, d.x, 0);
      for (let k = 0; k < 4; k++) {
        const off = (k - 1.5) * 0.009;
        const a0 = d.clone().multiplyScalar(0.04).addScaledVector(t, off * 0.5).add(V3(0, 0, dish - 0.01));
        const a1 = d.clone().multiplyScalar(R - rimR * 0.4).addScaledVector(t, off * 2.2);
        const L = a0.distanceTo(a1); const w = new THREE.CylinderGeometry(0.0022, 0.0022, L, 6, 1, true);
        const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), a1.clone().sub(a0).normalize());
        B.add('chrome', w, new THREE.Matrix4().compose(a0.clone().lerp(a1, 0.5), q, V3(1, 1, 1)), CH);
      }
      B.add('chrome', new RoundedBoxGeometry(0.03, 0.012, 0.012, 1, 0.004), new THREE.Matrix4().compose(d.clone().multiplyScalar(R - rimR * 0.6), new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), a), V3(1, 1, 1)), CH);
    }
  } else {
    // five flat stainless spokes, dished
    for (let s = 0; s < 5; s++) {
      const a = -Math.PI / 2 + s * Math.PI * 2 / 5; const d = V3(Math.cos(a), Math.sin(a), 0), t = V3(-d.y, d.x, 0);
      const P = [0, 0.5, 1].map(f => d.clone().multiplyScalar(lerp(0.04, R - rimR * 0.5, f)).add(V3(0, 0, lerp(dish - 0.012, 0, f))));
      B.add('chrome', boxSweep(P, P.map(() => V3(0, 0, -1)), P.map(() => t), 0.006, 0.02, CH, 1));
    }
  }
  const spin = new THREE.Group(); spin.name = 'wheel';
  for (const [k, mat] of [['chrome', M.chrome], ['plastic', M.plastic], ['panel', M.panel]]) { const m = B.mesh(k, mat); if (m) spin.add(m); }
  const right = new THREE.Object3D(); right.name = 'helmRight'; right.position.set(-R * Math.sin(0.96), R * Math.cos(0.96), -0.004); spin.add(right);
  const left = new THREE.Object3D(); left.name = 'helmLeft'; left.position.set(R * Math.sin(0.96), R * Math.cos(0.96), -0.004); spin.add(left);
  return { spin, right, left };
}

// RoundedBox in varnished mahogany, UVs kept inside one plank of the deck atlas so no caulk lines show.
function woodBox(w, h, d, plank = 3, r = 0.008) {
  const g = new RoundedBoxGeometry(w, h, d, 2, r); const uv = g.attributes.uv; const s = Math.max(w, d) / 2;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, (plank + 0.12 + 0.76 * uv.getY(i)) / 8);
  return g;
}

// RoundedBox for large varnished panels: box-projected uvs in metres (grain along the longest horizontal axis).
function panelBox(w, h, d, r = 0.008) {
  const g = new RoundedBoxGeometry(w, h, d, 2, r); const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)); const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (az >= ax && az >= ay) uv.setXY(i, x / 2, y / 0.72 + 0.03); else if (ax >= ay) uv.setXY(i, z / 2, y / 0.72 + 0.03); else uv.setXY(i, x / 2, z / 0.72 + 0.03);
  }
  return g;
}

// Pleated upholstered cushion: width w (X), height h (Y), depth d (Z), centred on the origin. The rounded
// cross-section is swept along X; the `face` side ('top' or 'front' = +Z) is tufted into `pleats` rolls.
function cushion(w, h, d, { pleats = 0, r = 0.028, puff = 0.012, face = 'top', segX = null } = {}) {
  const nx = segX || Math.max(6, pleats * 5), cn = 3, rings = [];
  for (let i = 0; i <= nx; i++) {
    const x = -w / 2 + (w * i) / nx; const ex = Math.min(x + w / 2, w / 2 - x); const endK = Math.sqrt(clamp(ex / (r * 1.4), 0, 1));
    let pf = 1; if (pleats > 0) { const f = ((x + w / 2) / w) * pleats; pf = Math.pow(Math.sin(Math.PI * (f - Math.floor(f))), 0.4); }
    let ring = rrRing(V3(x, 0, 0), V3(0, 0, 1), V3(0, 1, 0), d * lerp(0.9, 1, endK), h * lerp(0.84, 1, endK), r, cn);
    ring = ring.slice((cn + 1) * 3).concat(ring.slice(0, (cn + 1) * 3)); // loft seam on the underside
    for (const p of ring) {
      const wgt = face === 'top' ? Math.pow(clamp((p.y + h / 2) / h, 0, 1), 2) : Math.pow(clamp((p.z + d / 2) / d, 0, 1), 2);
      const rad = V3(0, p.y, p.z); const len = rad.length() || 1;
      p.addScaledVector(rad, -puff * (1 - pf) * wgt / len);
    }
    rings.push(ring);
  }
  return loftRings(rings, { capStart: true, capEnd: true, uScale: 1.6, vScale: 1.6 });
}

// ----------------------------------------------------------------------------
// type: Weidling
// ----------------------------------------------------------------------------
function buildWeidling(opts) {
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
  const accentMat = new THREE.MeshPhysicalMaterial({ name: 'stripe', color: accentHex, vertexColors: true, roughness: 0.36, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const plateMat = new THREE.MeshStandardMaterial({ name: 'plate', map: plateTexture(`BE ${1000 + (seed % 8999)}`), roughness: 0.4, metalness: 0.1 });
  for (const [k, mat] of [['hull', hullMat], ['wood', M.wood], ['metal', M.metal], ['accent', accentMat], ['plastic', M.plastic], ['fabric', M.fabric], ['plate', plateMat]]) {
    const mesh = B.mesh(k, mat); if (!mesh) continue;
    if (k === 'wood' || k === 'hull') weatherWood(mesh.geometry, seed + (k === 'hull' ? 7 : 0));
    object.add(mesh);
  }
  object.add(motor.yaw);

  // anchor: stowed on deck vs. rope running to the bottom
  const anchorStowed = buildAnchorStowed(M); object.add(anchorStowed);
  const anchorRope = buildAnchorRope(M); anchorRope.visible = false; object.add(anchorRope);

  // Swiss flag on the stern staff (animated cloth)
  const flag = makeFlag(M, 0.3);
  flag.mesh.position.set(0.40, sec(0.02).yS - 0.06 + 0.84, T_FWD + 0.055); flag.mesh.rotation.y = Math.PI / 2; object.add(flag.mesh);

  const waterMask = new THREE.Mesh(buildWaterMask(), M.mask); waterMask.name = 'waterMask'; object.add(waterMask);

  const seats = {
    driver: V3(0.30, thwarts[0].y + HIP, thwarts[0].z),
    fisher: V3(0.0, thwarts[1].y + HIP, thwarts[1].z),
    passengers: [V3(0.0, thwarts[3].y + HIP, thwarts[3].z), V3(0.02, 0.375 + HIP, thwarts[2].z)],
  };
  const crate = new THREE.Object3D(); crate.name = 'crate'; crate.position.copy(gear.crate); object.add(crate);
  const netRest = new THREE.Object3D(); netRest.name = 'netRest';
  netRest.position.set(0.33, floorY(-0.15) + 0.022, -0.15);
  netRest.quaternion.setFromEuler(new THREE.Euler(-0.268, -0.077, 0.0, 'YXZ'));
  object.add(netRest);
  finishMeshes(object, waterMask);

  let throttle = 0, steer = 0, propSpeed = 0, propAngle = 0;
  return {
    object, length: LEN, beam: hTop(0.4) * 2 + 0.04,
    seats, seatInfo: { canFaceAft: { driver: false, fisher: true, passengers: [false, false] } },
    helm: { kind: 'tiller', right: motor.tillerGrip, left: null },
    tillerGrip: motor.tillerGrip, crate, netRest, waterMask,
    physics: { mass: 480, thrust: 2100, halfLength: 3.6, beam: 1.64, draft: 0.2 },
    setThrottle(t) { throttle = clamp(t || 0, -1, 1); },
    setSteer(s) { steer = clamp(s || 0, -1, 1); motor.yaw.rotation.y = steer * (Math.PI / 6); },
    setAnchor(d) { const on = !!d; anchorStowed.visible = !on; anchorRope.visible = on; },
    // paint the hull (hex colour) or null for bare varnished wood
    setPaint(hex) {
      const p = hullMat.userData.paint;
      if (hex == null) { p.uPaintAmt.value = 0; return; }
      p.uPaint.value.set(hex); p.uPaintAmt.value = 1;
    },
    setAccent(hex) { if (hex == null) return; accent.set(hex); accentMat.color.set(hex); },
    update(dt = 0.016, time = performance.now() / 1000) {
      // prop spin-up with inertia; ~18 rev/s visual top speed
      const target = throttle * 18 * Math.PI * 2;
      propSpeed += (target - propSpeed) * Math.min(1, dt * 3);
      propAngle += propSpeed * dt; motor.prop.rotation.z = propAngle;
      const a = Math.abs(throttle);
      const vib = (0.25 + a) * 0.0012;
      motor.body.position.set(Math.sin(time * 97) * vib * 0.5, Math.sin(time * 131) * vib, 0);
      motor.body.rotation.set(Math.sin(time * 83) * vib * 0.8, 0, Math.sin(time * 71) * vib * 1.5);
      flag.update(time, a);
    },
  };
}

// shadows on, mask off; glass after the water so it tints correctly
function finishMeshes(object, waterMask) {
  object.traverse(o => {
    if (!o.isMesh) return;
    if (o === waterMask) { o.renderOrder = -1; o.castShadow = false; o.receiveShadow = false; return; }
    if (o.material && o.material.name.startsWith('glass')) { o.renderOrder = 3; o.castShadow = false; o.receiveShadow = false; return; }
    o.castShadow = true; o.receiveShadow = true;
  });
}

// ----------------------------------------------------------------------------
// hard-chine planing hulls (runabout, sportfisher). u = 0 at the aft end, 1 at the stem head.
// D: { z0, z1, keelY, sheerY, halfS, chineK, chineF, flatW?, flareE, bulge, convex?, strakes?: [{at, depth, fade}] }
// ----------------------------------------------------------------------------
function planingHull(D) {
  const L = D.z1 - D.z0, strakes = D.strakes || [];
  const TS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  function sec(u, topY = null) {
    u = clamp(u, 0, 1);
    const z = D.z0 + u * L;
    const yK = D.keelY(u), ySm = D.sheerY(u), xS = Math.max(0, D.halfS(u));
    const xC = xS * D.chineK(u), yC = lerp(yK, ySm, D.chineF(u));
    const wf = D.flatW ? D.flatW(u) * smooth(0, 0.25, xS) : 0;
    const conv = (D.convex || 0) * xC;
    const bl = t => [xC * t, lerp(yK, yC, t) - conv * Math.sin(Math.PI * t)];
    const slope = Math.max(0.15, (yC - yK) / Math.max(xC, 1e-3));
    const bottom = [];
    for (const t of TS) {
      bottom.push(bl(t));
      for (const s of strakes) if (Math.abs(t - s.at) < 1e-6) {
        const d = s.depth * (1 - smooth(s.fade[0], s.fade[1], u)) * smooth(0, 0.3, xC); const P1 = bl(t);
        bottom.push([P1[0] + 0.003, P1[1] - d]);
        bottom.push(bl(Math.min(t + 0.08, t + (d / slope + 0.004) / Math.max(xC, 1e-3))));
      }
    }
    bottom.push([xC + wf, yC - (wf > 0.01 ? 0.008 : 0) * smooth(0, 0.3, xS)]);
    // topsides: chine (flat end) -> sheer, flared by flareE, bulged by bulge
    const x0 = xC + wf, NT = 8, full = [];
    for (let k = 0; k <= NT; k++) {
      const t = k / NT; full.push([lerp(x0, xS, Math.pow(t, D.flareE(u))) + D.bulge(u) * Math.sin(Math.PI * t) * smooth(0, 0.3, xS), lerp(yC, ySm, t)]);
    }
    const look = [[0, yK]]; for (const t of TS.slice(1)) { const q = bl(t); if (q[1] > look[look.length - 1][1] + 1e-5) look.push(q); }
    for (const q of full) if (q[1] > look[look.length - 1][1] + 1e-5) look.push(q);
    const outerX = (y) => {
      if (y <= look[0][1]) return 0; for (let k = 1; k < look.length; k++) if (y <= look[k][1]) { const a = look[k - 1], b = look[k]; return lerp(a[0], b[0], (y - a[1]) / (b[1] - a[1])); }
      return look[look.length - 1][0];
    };
    let top = full, yS = ySm, xT = xS;
    if (topY != null && topY < ySm) { yS = topY; top = []; for (let k = 0; k <= NT; k++) { const y = lerp(yC, topY, k / NT); top.push([outerX(y), y]); } xT = outerX(topY); }
    return { u, z, yK, yS, ySm, xS: xT, xSm: xS, xC, yC, wf, bottom, top, outerX };
  }
  const uOfZ = z => (z - D.z0) / L;
  // sections between zA and zB, denser toward the stem (bias) — always including both ends exactly
  function secs(zA, zB, n, { bias = 0, topY = null } = {}) {
    const out = []; for (let i = 0; i <= n; i++) { let t = i / n; t = t + bias * t * (1 - t); out.push(sec(uOfZ(lerp(zA, zB, t)), topY)); } return out;
  }
  // hull skin over a list of sections: bottom (keel to chine flats) + two topsides; crisp chines.
  function skin(S, B, key) {
    B.add(key, stripLoft(S, s => mirrorRev(s.bottom).concat(s.bottom.slice(1)), { uv: (s, p, g) => [s.z * 0.5, 10 + g / 0.72], expect: p => V3(p.x * 0.6, -1, 0) }));
    for (const side of [1, -1]) {
      B.add(key, stripLoft(S, s => side > 0 ? s.top : s.top.map(q => [-q[0], q[1]]), { uv: (s, p, g, tot) => [s.z * 0.5, (tot - g) / 0.72], expect: () => V3(side, 0, 0) }));
    }
  }
  // flat transom face closing a section, facing -Z (aft). topFn(x) gives the top edge (deck camber).
  function transom(S, topFn = null) {
    const half = S.bottom.concat(S.top.slice(1));
    const outline = mirrorRev(half).concat(half.slice(1));
    const sh = new THREE.Shape(); sh.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) sh.lineTo(outline[i][0], outline[i][1]);
    if (topFn) { for (let k = 1; k < 16; k++) { const x = lerp(S.xS, -S.xS, k / 16); sh.lineTo(x, topFn(x)); } }
    sh.closePath();
    const g = new THREE.ShapeGeometry(sh, 4); const uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 0.5, 10 + p.getY(i) / 0.72);
    g.translate(0, 0, S.z); g.deleteAttribute('normal'); g.computeVertexNormals();
    return orient(prep(g), () => V3(0, 0, -1));
  }
  function mask(S, lift = 0.03) {
    return loftGrid(S.length, 2, (i, j) => { const s = S[i]; return [(j ? 1 : -1) * (s.xS + 0.015), s.yS + lift, s.z, 0, 0]; });
  }
  return { sec, secs, skin, transom, mask, uOfZ, L };
}

// Zoned hull paint: below the waterline `bottom`, an accent boot stripe, topsides in the natural finish
// (texture x vertex colour) or `paint`; optional accent sheer stripe measured down the topside girth
// (topside uv.v = girth from the sheer / 0.72; bottom & transom uvs are offset by +10 so they never match).
function makeZonedHull(name, base, Z) {
  const m = new THREE.MeshPhysicalMaterial({ name, vertexColors: true, ...base });
  const U = {
    uPaint: { value: new THREE.Color(0xffffff) }, uPaintAmt: { value: 0 }, uAccent: { value: new THREE.Color(Z.accent) },
    uBottom: { value: new THREE.Color(Z.bottom) }, uWl: { value: Z.wl }, uBootW: { value: Z.bootW },
    uStripe: { value: new THREE.Vector3(Z.stripe ? Z.stripe[0] : -1, Z.stripe ? Z.stripe[1] : -1, Z.stripe ? 1 : 0) },
    uPK: { value: new THREE.Vector2(Z.paintK ? Z.paintK[0] : 1, Z.paintK ? Z.paintK[1] : 0) },
    uBotRough: { value: Z.bottomRough ?? 0.6 },
  };
  m.userData.zones = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHullP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHullP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vHullP; uniform vec3 uPaint; uniform float uPaintAmt; uniform vec3 uAccent; uniform vec3 uBottom; uniform float uWl; uniform float uBootW;
      uniform vec3 uStripe; uniform vec2 uPK; uniform float uBotRough; float zBelow; float zBoot; float zPaint;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          float aa = max(fwidth(vHullP.y), 1e-4);
          zBelow = 1.0 - smoothstep(uWl - aa, uWl + aa, vHullP.y);
          zBoot = (1.0 - zBelow) * (1.0 - smoothstep(uWl + uBootW - aa, uWl + uBootW + aa, vHullP.y));
          float sd = vMapUv.y * 0.72; float a2 = max(fwidth(sd), 1e-4);
          float stripe = uStripe.z * smoothstep(uStripe.x - a2, uStripe.x + a2, sd) * (1.0 - smoothstep(uStripe.y - a2, uStripe.y + a2, sd));
          zPaint = uPaintAmt * (1.0 - zBelow) * (1.0 - zBoot);
          diffuseColor.rgb = mix(diffuseColor.rgb, uPaint * (uPK.x + uPK.y * lum), zPaint);
          diffuseColor.rgb = mix(diffuseColor.rgb, uBottom * (0.9 + 0.25 * lum), zBelow);
          diffuseColor.rgb = mix(diffuseColor.rgb, uAccent, max(zBoot, stripe * (1.0 - zBelow)));
          zBoot = max(zBoot, stripe);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, uBotRough, zBelow); roughnessFactor = mix(roughnessFactor, 0.22, zBoot); roughnessFactor = mix(roughnessFactor, 0.24, zPaint);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= 1.0 - 0.85 * zBelow;
        #endif`);
  };
  m.customProgramCacheKey = () => 'zoned-hull-v1';
  return m;
}

// ----------------------------------------------------------------------------
// type: classic mahogany runabout (Boesch / Riva style), ~7 m, inboard V8
// ----------------------------------------------------------------------------
const RB = { Z0: -3.45, Z1: 3.55, SIDE: 0.17, MARGIN: 0.10, CF: 0.40, CA: -1.95, FLOOR: -0.08, HATCH: [-3.05, -2.03], CAMBER: 0.055 };
function buildRunabout(opts) {
  const { T, M } = sharedRunabout();
  const accentHex = opts.accent ?? 0x1f4e8c;
  const seed = ((opts.seed ?? accentHex) >>> 0) % 100000 + 11; const R = rng(seed);
  const object = new THREE.Group(); object.name = 'runabout';
  const B = new Buckets();
  const { Z0, Z1, SIDE, MARGIN, CF, CA, FLOOR, CAMBER } = RB;

  // ---- hull lines
  const sheerY = u => u < 0.3 ? 0.58 + 0.025 * ((0.3 - u) / 0.3) ** 2 : 0.58 + 0.37 * ((u - 0.3) / 0.7) ** 2.2;
  const keelY = u => u < 0.6 ? -0.35 + 0.01 * u : -0.344 + (sheerY(1) + 0.344) * ((u - 0.6) / 0.4) ** 3.2;
  const halfS = u => u < 0.5 ? 1.10 - 0.13 * ((0.5 - u) / 0.5) ** 2.2 : 1.10 * Math.sqrt(Math.max(0, 1 - ((u - 0.5) / 0.5) ** 2.2));
  const H = planingHull({ z0: Z0, z1: Z1, keelY, sheerY, halfS, chineK: u => 0.92 - 0.1 * smooth(0.5, 1, u), chineF: u => 0.28 + 0.14 * smooth(0.55, 1, u),
    flareE: u => lerp(0.8, 1.3, smooth(0.45, 1, u)), bulge: () => 0.012, convex: 0.025 });
  const at = z => H.sec(H.uOfZ(z));
  const deckY = (x, S) => S.yS + CAMBER * (1 - Math.min(1, (x / Math.max(S.xS, 1e-3)) ** 2));
  const hullSecs = H.secs(Z0, Z1, 96, { bias: 0.45 });

  // ---- hull skin + transom
  H.skin(hullSecs, B, 'hull');
  const S0 = hullSecs[0];
  B.add('hull', H.transom(S0, x => deckY(x, S0)));

  // ---- deck: straight king-planked centre, margin planks that follow the sheer, covering boards along the cockpit
  const deckPiece = (S, xa, xb, nJ, uvFn) => stripLoft(S, s => { const a = xa(s), b = xb(s); const out = []; for (let j = 0; j < nJ; j++) { const x = lerp(a, b, j / (nJ - 1)); out.push([x, deckY(x, s)]); } return out; },
    { uv: (s, p) => uvFn(s, p[0]), expect: UP });
  const centreUV = (s, x) => [s.z * 0.5, x / 0.72 + 1 / 16];
  const foreS = H.secs(CF, Z1 - 0.004, 40, { bias: 0.5 }), aftS = H.secs(Z0, CA, 24), cockS = H.secs(CA, CF, 30);
  B.add('mahog', deckPiece(foreS, s => -Math.max(0, s.xS - MARGIN), s => Math.max(0, s.xS - MARGIN), 11, centreUV), null, [1, 1, 1]);
  B.add('mahog', deckPiece(aftS, s => -(s.xS - MARGIN), s => s.xS - MARGIN, 11, centreUV));
  for (const side of [1, -1]) {
    const marg = H.secs(Z0, Z1 - 0.004, 110, { bias: 0.45 });
    B.add('mahog', deckPiece(marg, s => side * Math.max(0, s.xS - MARGIN), s => side * s.xS, 3, (s, x) => [s.z * 0.5, (s.xS - Math.abs(x)) / MARGIN / 8]), null, [0.95, 0.93, 0.9]);
    B.add('mahog', deckPiece(cockS, s => side * (s.xS - SIDE), s => side * (s.xS - MARGIN), 2, (s, x) => [s.z * 0.5, 1 / 8 + (s.xS - MARGIN - Math.abs(x)) / (SIDE - MARGIN) / 8]), null, [0.97, 0.95, 0.92]);
  }

  // ---- cockpit: walls, floor (carpet), aft bulkhead, footwell under the foredeck
  const FW = 0.75; // footwell runs under the foredeck to here
  const wallS = H.secs(CA, FW, 34);
  const wallX = s => s.xS - SIDE;
  for (const side of [1, -1]) {
    B.add('mahogP', stripLoft(wallS, s => [[side * wallX(s), FLOOR], [side * wallX(s), deckY(wallX(s), s) - 0.004]],
      { uv: (s, p) => [s.z * 0.5, (p[1] - FLOOR) / 0.72 + 0.03], expect: () => V3(-side, 0, 0) }), null, [0.84, 0.8, 0.78]);
    // coaming lip along the opening
    const lipS = H.secs(CA, CF, 30);
    B.add('mahog', stripLoft(lipS, s => { const x = wallX(s), y = deckY(x, s); return [[x - 0.0, y - 0.03], [x - 0.012, y + 0.004], [x - 0.004, y + 0.02], [x + 0.018, y + 0.016], [x + 0.03, y]].map(q => [side * q[0], q[1]]); },
      { uv: (s, p, g) => [s.z * 0.5, (6.2 + g * 6) / 8], expect: p => V3(-side * 0.3, 1, 0) }), null, [0.86, 0.8, 0.76]);
  }
  B.add('fabric', stripLoft(wallS, s => [[-wallX(s), FLOOR], [wallX(s), FLOOR]], { uv: (s, p) => [s.z * 3, p[0] * 3], expect: UP }), null, lin(0x2a3550));
  { // aft bulkhead (behind the rear bench) + aft lip
    const s = at(CA); const xw = wallX(s);
    const g = loftGrid(2, 9, (i, j) => { const x = lerp(-xw, xw, j / 8); const y = i ? deckY(x, s) - 0.004 : FLOOR; return [x, y, CA, x * 0.5, (y - FLOOR) / 0.72 + 0.03]; });
    B.add('mahogP', orient(g, () => V3(0, 0, 1)), null, [0.82, 0.78, 0.76]);
    const lip = loftGrid(9, 4, (i, j) => { const x = lerp(-xw, xw, i / 8), y = deckY(x, s); const q = [[0, -0.03], [0.012, 0.004], [0.004, 0.02], [-0.018, 0.016]][j]; return [x, y + q[1], CA + q[0], x * 0.5, (6.2 + j * 0.2) / 8]; });
    B.add('mahog', orient(lip, p => V3(0, 1, 0.3)), null, [0.86, 0.8, 0.76]);
  }
  { // footwell: ceiling under the foredeck, front bulkhead (dark)
    const fs = H.secs(0.28, FW, 6); const yc = 0.565;
    B.add('plastic', stripLoft(fs, s => [[-wallX(s), yc], [wallX(s), yc]], { expect: DOWN }), null, lin(0x1c1612));
    const s = at(FW); const xw = wallX(s);
    B.add('plastic', orient(loftGrid(2, 2, (i, j) => [lerp(-xw, xw, j), i ? yc : FLOOR, FW, 0, 0]), () => V3(0, 0, -1)), null, lin(0x1c1612));
  }

  // ---- dashboard, crash pad
  const DZ = 0.30; const dS = at(DZ); const dashW = wallX(dS);
  {
    const g = panelBox(dashW * 2, 0.36, 0.03, 0.006); B.add('mahogP', g, M4(0, 0.385, DZ + 0.015), [0.86, 0.78, 0.72]);
    const pad = cushion(dashW * 2 + 0.01, 0.09, 0.15, { pleats: 0, r: 0.03, face: 'front', segX: 10 });
    B.add('leather', pad, M4(0, 0.6, DZ + 0.055, 0, 0, 0), WHITE);
    { const s = at(CF); const xw = wallX(s); const lip = loftGrid(9, 4, (i, j) => { const x = lerp(-xw, xw, i / 8), y = deckY(x, s); const q = [[0.0, -0.075], [-0.012, 0.004], [-0.004, 0.02], [0.018, 0.016]][j]; return [x, y + q[1], CF + q[0], x * 0.5, (6.2 + j * 0.2) / 8]; });
      B.add('mahog', orient(lip, p => V3(0, 1, -0.3)), null, [0.86, 0.8, 0.76]); }
    const pip = new THREE.CylinderGeometry(0.0055, 0.0055, dashW * 2, 6); pip.rotateZ(Math.PI / 2);
    B.add('accent', pip, M4(0, 0.552, DZ - 0.012));
  }
  // gauges in front of the driver, small gauges in the centre, glovebox + grab handle for the passenger
  const DRV = -0.40;
  const gaugeAt = (key, i, r, x, y) => {
    B.add('panel', atlasDisc(key, r, i), M4(x, y, DZ - 0.002, 0, Math.PI, 0));
    B.add('chrome', new THREE.TorusGeometry(r + 0.004, 0.0055, 6, 28), M4(x, y, DZ - 0.003), lin(0xe8ecef));
    const hood = new THREE.CylinderGeometry(r + 0.009, r + 0.009, 0.018, 28, 1, true, -Math.PI / 2 - 1.1, 2.2); hood.rotateX(Math.PI / 2);
    B.add('chrome', hood, M4(x, y, DZ - 0.011), lin(0xd8dde1));
  };
  gaugeAt('speedo', null, 0.058, DRV - 0.088, 0.475); gaugeAt('tacho', null, 0.058, DRV + 0.088, 0.475);
  for (let k = 0; k < 4; k++) gaugeAt('small', k, 0.03, -0.12 + k * 0.08, 0.47);
  B.add('panel', atlasQuad('glovebox', 0.36, 0.13), M4(0.42, 0.40, DZ - 0.003, 0, Math.PI, 0));
  B.add('chrome', new RoundedBoxGeometry(0.37, 0.14, 0.004, 1, 0.002), M4(0.42, 0.40, DZ - 0.0005), lin(0xc9ced3));
  B.add('chrome', new THREE.CylinderGeometry(0.009, 0.009, 0.012, 14), M4(0.42, 0.44, DZ - 0.008, Math.PI / 2, 0, 0), lin(0xe4e8eb));
  { const h = tube([V3(0.22, 0.52, DZ - 0.005), V3(0.24, 0.535, DZ - 0.05), V3(0.6, 0.535, DZ - 0.05), V3(0.62, 0.52, DZ - 0.005)], 0.009, 24, 8, false, 0); B.add('chrome', h, null, lin(0xe4e8eb)); }
  // chrome toggle switches on bezels + ignition key
  for (let k = 0; k < 5; k++) { const x = -0.13 + k * 0.05;
    B.add('chrome', new THREE.CylinderGeometry(0.011, 0.011, 0.006, 14), M4(x, 0.37, DZ - 0.003, Math.PI / 2, 0, 0), lin(0xdfe3e6));
    const lev = new THREE.CylinderGeometry(0.0025, 0.0035, 0.03, 6); lev.translate(0, 0.015, 0); B.add('chrome', lev, M4(x, 0.37, DZ - 0.006, -Math.PI / 2 - 0.5, 0, 0), lin(0xeef1f3)); }
  B.add('chrome', new THREE.CylinderGeometry(0.016, 0.016, 0.01, 16), M4(0.12, 0.30, DZ - 0.004, Math.PI / 2, 0, 0), lin(0xdfe3e6));
  B.add('plastic', new RoundedBoxGeometry(0.008, 0.03, 0.03, 1, 0.003), M4(0.12, 0.30, DZ - 0.022), lin(0x1a1a1a));

  // ---- steering wheel on a chrome column
  const WHUB = V3(DRV, 0.70, -0.03), WTILT = 0.35;
  const wheel = buildWheel(M, { R: 0.19, rimR: 0.012, spokes: 'banjo', dish: 0.05, rim: 'chrome', rimCol: lin(0xeef1f3) });
  const wheelPivot = new THREE.Group(); wheelPivot.name = 'helm'; wheelPivot.position.copy(WHUB); wheelPivot.rotation.x = WTILT;
  wheelPivot.add(wheel.spin); object.add(wheelPivot);
  {
    const ax = V3(0, -Math.sin(WTILT), Math.cos(WTILT)); const a = WHUB.clone().addScaledVector(ax, 0.07), b = WHUB.clone().addScaledVector(ax, (DZ - WHUB.z) / ax.z);
    const col = new THREE.CylinderGeometry(0.016, 0.02, a.distanceTo(b), 14); const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), ax);
    B.add('chrome', col, new THREE.Matrix4().compose(a.clone().lerp(b, 0.5), q, V3(1, 1, 1)), lin(0xe4e8eb));
    const bell = new THREE.CylinderGeometry(0.022, 0.045, 0.06, 18); B.add('chrome', bell, new THREE.Matrix4().compose(b.clone().addScaledVector(ax, -0.03), q, V3(1, 1, 1)), lin(0xe4e8eb));
  }
  // throttle / shift lever on the starboard wall
  { const s = at(-0.12); const x = -wallX(s) + 0.012;
    B.add('chrome', new RoundedBoxGeometry(0.024, 0.11, 0.16, 2, 0.01), M4(x + 0.012, 0.42, -0.12), lin(0xdfe3e6));
    const lv = new THREE.CylinderGeometry(0.007, 0.009, 0.2, 10); lv.translate(0, 0.1, 0); B.add('chrome', lv, M4(x + 0.035, 0.44, -0.12, 0.55, 0, 0), lin(0xe8ecef));
    B.add('plastic', new THREE.SphereGeometry(0.02, 14, 10), M4(x + 0.035, 0.44 + 0.2 * Math.cos(0.55), -0.12 + 0.2 * Math.sin(0.55)), lin(0x14110f)); }

  // ---- windscreen: curved glass on a chrome frame, wrapping back onto the covering boards
  {
    const n = 4, a = 1.0, b = 0.46, zc = 0.10, h0 = 0.33, rake = 0.62, N = 40;
    const se = (phi) => { const s = Math.sin(phi), c = Math.cos(phi); return [a * Math.sign(s) * Math.pow(Math.abs(s), 2 / n), zc + b * Math.pow(Math.abs(c), 2 / n)]; };
    const base = [], topP = [];
    for (let i = 0; i <= N; i++) {
      const phi = -Math.PI / 2 + Math.PI * i / N; const [x, z] = se(phi);
      const [x1, z1] = se(phi + 0.01), [x0, z0] = se(phi - 0.01); const tx = x1 - x0, tz = z1 - z0; const nl = Math.hypot(tx, tz) || 1; const nx = tz / nl, nz = -tx / nl; // outward
      const y = deckY(x, at(z)) + 0.012; const h = h0 * (1 - 0.18 * Math.abs(Math.sin(phi)));
      base.push(V3(x, y, z)); topP.push(V3(x - nx * h * Math.sin(rake), y + h * Math.cos(rake), z - nz * h * Math.sin(rake)));
    }
    const g = loftGrid(N + 1, 2, (i, j) => { const p = j ? topP[i] : base[i]; return [p.x, p.y, p.z, i / N, j]; });
    B.add('glass', g, null, lin(0xdff0ea));
    B.add('chrome', tube(topP, 0.0095, 80, 8, false, 0), null, lin(0xeef1f3));
    const P = base.map(p => p.clone().add(V3(0, 0.008, 0))); const Tn = P.map(() => V3(0, 1, 0)); const Wn = P.map((p, i) => { const q = P[Math.min(N, i + 1)].clone().sub(P[Math.max(0, i - 1)]).normalize(); return V3(q.z, 0, -q.x); });
    B.add('chrome', boxSweep(P, Tn, Wn, 0.022, 0.024, lin(0xdfe3e6), 1));
    for (const i of [0, 9, N - 9, N]) {
      const p0 = base[i], p1 = topP[i]; const L = p0.distanceTo(p1); const post = new THREE.CylinderGeometry(0.009, 0.012, L, 10);
      const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), p1.clone().sub(p0).normalize());
      B.add('chrome', post, new THREE.Matrix4().compose(p0.clone().lerp(p1, 0.5), q, V3(1, 1, 1)), lin(0xeef1f3));
      B.add('chrome', new RoundedBoxGeometry(0.04, 0.012, 0.05, 1, 0.004), M4(p0.x, p0.y + 0.004, p0.z), lin(0xe4e8eb));
    }
  }

  // ---- benches: pleated cream leather, varnished bases and seat backs, accent piping, chrome grab rail
  const bench = (zFront, zBack, isFront, tilt) => {
    const s = at((zFront + zBack) / 2); const w = wallX(s) * 2 - 0.03, d = zFront - zBack, seatTop = 0.26, cush = 0.12;
    B.add('mahogP', panelBox(w, seatTop - cush - FLOOR + 0.01, d - 0.03), M4(0, (FLOOR + seatTop - cush) / 2, (zFront + zBack) / 2 - 0.01), [0.78, 0.7, 0.66]);
    const pleats = Math.round(w / 0.155);
    B.add('leather', cushion(w, cush, d, { pleats, r: 0.035, puff: 0.014 }), M4(0, seatTop - cush / 2, (zFront + zBack) / 2));
    const pip = new THREE.CylinderGeometry(0.006, 0.006, w - 0.05, 6); pip.rotateZ(Math.PI / 2);
    B.add('accent', pip, M4(0, seatTop - 0.012, zFront - 0.012));
    // backrest, tilted back 15 deg about its bottom front edge
    const BH = 0.5, BT = 0.11; const bm = M4(0, seatTop - 0.05, zBack, tilt, 0, 0);
    B.add('leather', cushion(w, BH, BT, { pleats, r: 0.04, puff: 0.014, face: 'front' }), bm.clone().multiply(M4(0, BH / 2, -BT / 2)));
    const pip2 = new THREE.CylinderGeometry(0.006, 0.006, w - 0.06, 6); pip2.rotateZ(Math.PI / 2);
    B.add('accent', pip2, bm.clone().multiply(M4(0, BH - 0.012, -0.008)));
    if (isFront) {
      // varnished back of the front seat (seen by the rear passengers) + chrome grab rail
      B.add('mahogP', panelBox(w, BH + seatTop - FLOOR - 0.05, 0.022), bm.clone().multiply(M4(0, (BH - (seatTop - 0.05 - FLOOR)) / 2, -BT - 0.012)), [0.82, 0.74, 0.7]);
      const r0 = bm.clone().multiply(M4(0, BH + 0.03, -BT - 0.02)); const pts = [];
      for (const x of [-0.6, -0.58, 0, 0.58, 0.6]) pts.push(V3(x * w / 1.4, Math.abs(x) > 0.59 ? -0.04 : 0, 0).applyMatrix4(r0));
      B.add('chrome', tube(pts, 0.011, 40, 8, false, 0), null, lin(0xeef1f3));
    }
  };
  bench(-0.04, -0.56, true, -0.26);
  bench(-1.26, -1.78, false, -0.15);

  // ---- engine hatch on the aft deck: raised, king-planked, chrome hinges, handle and louvred vents
  {
    const [hA, hF] = RB.HATCH; const hs = H.secs(hA, hF, 14); const HW = 0.80, lift = 0.045;
    B.add('mahog', stripLoft(hs, s => { const out = []; for (let j = 0; j <= 10; j++) { const x = lerp(-HW, HW, j / 10); out.push([x, deckY(x, s) + lift]); } return out; }, { uv: (s, p) => [s.z * 0.5, p[0] / 0.72 + 1 / 16], expect: UP }));
    for (const side of [1, -1]) B.add('mahog', stripLoft(hs, s => [[side * HW, deckY(HW, s) - 0.01], [side * HW, deckY(HW, s) + lift]], { uv: (s, p) => [s.z * 0.5, (2.2 + (p[1] - s.yS) * 4) / 8], expect: () => V3(side, 0, 0) }), null, [0.82, 0.76, 0.72]);
    for (const [z, dir] of [[hA, -1], [hF, 1]]) { const s = at(z); B.add('mahog', orient(loftGrid(2, 11, (i, j) => { const x = lerp(-HW, HW, j / 10); return [x, deckY(x, s) + (i ? lift : -0.01), z, x * 0.5, (2.2 + i * 0.4) / 8]; }), () => V3(0, 0, dir)), null, [0.82, 0.76, 0.72]); }
    for (const x of [-0.5, 0.5]) { const s = at(hF - 0.06); B.add('chrome', new RoundedBoxGeometry(0.07, 0.012, 0.14, 1, 0.004), M4(x, deckY(x, s) + lift + 0.004, hF - 0.03), lin(0xe4e8eb)); }
    { const s = at(hA + 0.06); const y = deckY(0, s) + lift; B.add('chrome', tube([V3(-0.09, y, hA + 0.06), V3(-0.08, y + 0.035, hA + 0.06), V3(0.08, y + 0.035, hA + 0.06), V3(0.09, y, hA + 0.06)], 0.008, 20, 8, false, 0), null, lin(0xeef1f3)); }
    for (const x of [-0.55, 0.55]) {
      const z = hA + 0.25; const s = at(z); const y = deckY(x, s) + lift + 0.003;
      B.add('panel', atlasQuad('vent', 0.16, 0.09), M4(x, y + 0.001, z, -Math.PI / 2, 0, 0, 1));
      B.add('chrome', new RoundedBoxGeometry(0.18, 0.008, 0.11, 1, 0.003), M4(x, y - 0.002, z), lin(0xd7dce0));
    }
  }

  // ---- chrome: rub strips along the sheer and across the transom, stem band, cleats, fairlead, bow light
  for (const side of [1, -1]) {
    const pts = H.secs(Z0 + 0.005, Z1 - 0.03, 70, { bias: 0.4 }).map(s => V3(side * (s.xS + 0.006), s.yS - 0.006, s.z));
    B.add('chrome', tube(pts, 0.011, 140, 6, false, 0), null, lin(0xeef1f3));
  }
  { const pts = []; for (let k = 0; k <= 16; k++) { const x = lerp(S0.xS, -S0.xS, k / 16); pts.push(V3(x, deckY(x, S0) - 0.006, Z0 - 0.006)); } B.add('chrome', tube(pts, 0.01, 40, 6, false, 0), null, lin(0xeef1f3)); }
  { const pts = []; for (let k = 0; k <= 24; k++) { const u = lerp(0.84, 0.999, k / 24); pts.push(V3(0, keelY(u), Z0 + u * H.L + 0.004)); } B.add('chrome', tube(pts, 0.013, 48, 8, false, 0), null, lin(0xeef1f3)); }
  const cleat = hornCleat(0.17);
  { const z = 3.05; const s = at(z); B.add('chrome', cleat, M4(0, deckY(0, s), z, -0.12, 0, 0), lin(0xeef1f3)); }
  for (const side of [1, -1]) { const z = -3.24; const s = at(z); B.add('chrome', cleat, M4(side * 0.74, deckY(0.74, s), z, 0, 0.0, 0, 0.9), lin(0xeef1f3)); }
  { const z = Z1 - 0.12; const s = at(z); const y = deckY(0, s);
    const ch = new THREE.TorusGeometry(0.035, 0.01, 8, 16, Math.PI); ch.rotateY(Math.PI / 2); B.add('chrome', ch, M4(0, y + 0.004, z), lin(0xeef1f3));
    B.add('chrome', new RoundedBoxGeometry(0.05, 0.012, 0.11, 1, 0.004), M4(0, y + 0.004, z), lin(0xe4e8eb)); }
  { const z = 2.72; const s = at(z); const y = deckY(0, s);
    const body = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2); B.add('chrome', body, M4(0, y, z, 0, 0, 0, 0.045, 0.05, 0.1), lin(0xeef1f3));
    for (const [side, key] of [[1, 'red'], [-1, 'green']]) B.add('panel', atlasQuad(key, 0.05, 0.026), M4(side * 0.034, y + 0.022, z + 0.03, 0, side * Math.PI / 2 * 0.85, 0)); }

  // ---- flagstaff with the Swiss flag at the stern
  const flagZ = Z0 + 0.14; const fs0 = at(flagZ); const fy0 = deckY(0, fs0);
  B.add('chrome', new THREE.CylinderGeometry(0.02, 0.028, 0.05, 14), M4(0, fy0 + 0.02, flagZ), lin(0xe4e8eb));
  B.add('chrome', new THREE.CylinderGeometry(0.007, 0.009, 0.62, 8), M4(0, fy0 + 0.33, flagZ), lin(0xeef1f3));
  B.add('chrome', new THREE.SphereGeometry(0.016, 12, 8), M4(0, fy0 + 0.65, flagZ), lin(0xe8c66a));
  const flag = makeFlag(M, 0.26); flag.mesh.position.set(0, fy0 + 0.63, flagZ); flag.mesh.rotation.y = Math.PI / 2; object.add(flag.mesh);

  // ---- transom: gilt name, exhaust outlets, swim ladder
  B.add('panel', atlasQuad('rbName', 1.1, 0.172), M4(0, 0.38, Z0 - 0.003, 0, Math.PI, 0));
  for (const x of [-0.42, 0.42]) {
    const ring = new THREE.TorusGeometry(0.055, 0.012, 8, 24); B.add('chrome', ring, M4(x, 0.13, Z0 - 0.01, 0, 0, 0, 1, 0.6, 1), lin(0xeef1f3));
    B.add('plastic', new THREE.CircleGeometry(0.052, 20), M4(x, 0.13, Z0 - 0.006, 0, Math.PI, 0, 1, 0.6, 1), lin(0x0c0c0c));
  }
  { const x0 = 0.66; const y = deckY(x0, S0);
    for (const dx of [-0.13, 0.13]) B.add('chrome', tube([V3(x0 + dx, y + 0.005, Z0 + 0.09), V3(x0 + dx, y + 0.06, Z0 + 0.02), V3(x0 + dx, y + 0.03, Z0 - 0.06), V3(x0 + dx, y - 0.2, Z0 - 0.07), V3(x0 + dx, -0.32, Z0 - 0.07)], 0.01, 30, 8, false, 0), null, lin(0xeef1f3));
    for (const yy of [0.2, -0.05, -0.28]) B.add('chrome', new RoundedBoxGeometry(0.27, 0.012, 0.05, 1, 0.004), M4(x0, yy, Z0 - 0.075), lin(0xdfe3e6)); }

  // ---- canton registration plates on both bow quarters
  const plateMat = new THREE.MeshStandardMaterial({ name: 'plate', map: plateTexture(`LU ${1000 + (seed % 8999)}`), roughness: 0.4, metalness: 0.1 });
  for (const side of [1, -1]) {
    const z = 1.95, s = at(z), y = s.yS - 0.13; const p0 = V3(side * s.outerX(y), y, z), p1 = V3(side * s.outerX(y + 0.05), y + 0.05, z);
    const s2 = at(z + 0.05); const p2 = V3(side * s2.outerX(y), y, z + 0.05);
    const up = p1.clone().sub(p0).normalize(), along = p2.clone().sub(p0).normalize(); const nrm = new THREE.Vector3().crossVectors(along, up).normalize().multiplyScalar(side > 0 ? -1 : 1);
    if (nrm.x * side < 0) nrm.negate();
    const xAx = new THREE.Vector3().crossVectors(up, nrm).normalize();
    B.add('plate', new THREE.PlaneGeometry(0.3, 0.072), new THREE.Matrix4().makeBasis(xAx, up, nrm).setPosition(p0.addScaledVector(nrm, 0.003)));
  }

  // ---- running gear: shaft, strut, bronze prop and rudder
  const SHAFT = 0.175, PROPZ = -2.85; const sh0 = V3(0, keelY(H.uOfZ(-1.55)) + 0.02, -1.55); const shDir = V3(0, -Math.sin(SHAFT), -Math.cos(SHAFT));
  const propPos = sh0.clone().addScaledVector(shDir, (sh0.z - PROPZ) / Math.cos(SHAFT));
  { const L = sh0.distanceTo(propPos) - 0.05; const g = new THREE.CylinderGeometry(0.02, 0.02, L, 10); const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), shDir);
    B.add('chrome', g, new THREE.Matrix4().compose(sh0.clone().addScaledVector(shDir, L / 2), q, V3(1, 1, 1)), lin(0xc9a27a));
    const bz = -2.6; const bp = sh0.clone().addScaledVector(shDir, (sh0.z - bz) / Math.cos(SHAFT));
    B.add('chrome', new THREE.CylinderGeometry(0.034, 0.034, 0.12, 14), new THREE.Matrix4().compose(bp, q, V3(1, 1, 1)), lin(0xc9a27a));
    for (const sx of [-1, 1]) { const s = at(bz); const top = V3(sx * 0.13, lerp(s.yK, s.yC, 0.13 / Math.max(0.1, s.xC)) + 0.01, bz);
      const P = [top, top.clone().lerp(bp, 0.5), bp]; const d = bp.clone().sub(top).normalize(); const Wn = P.map(() => V3(0, 0, 1)), Tn = P.map(() => new THREE.Vector3().crossVectors(d, V3(0, 0, 1)).normalize());
      B.add('chrome', boxSweep(P, Tn, Wn, 0.012, 0.07, lin(0xc9a27a), 1)); }
    // rudder stock gland on the hull bottom
    B.add('chrome', new THREE.CylinderGeometry(0.03, 0.04, 0.03, 12), M4(0, keelY(H.uOfZ(-3.17)) - 0.005, -3.17), lin(0xc9a27a));
  }
  const propMount = new THREE.Group(); propMount.position.copy(propPos); propMount.rotation.x = -SHAFT; object.add(propMount);
  const prop = new THREE.Mesh(propellerGeometry(), M.bronze); prop.name = 'prop'; prop.scale.setScalar(1.42); propMount.add(prop);
  const rudder = new THREE.Group(); rudder.name = 'rudder'; rudder.position.set(0, keelY(H.uOfZ(-3.17)), -3.17); object.add(rudder);
  { const s = new THREE.Shape(); s.moveTo(0.04, 0); s.lineTo(-0.15, 0); s.quadraticCurveTo(-0.2, -0.05, -0.2, -0.16); s.lineTo(-0.19, -0.36); s.quadraticCurveTo(-0.17, -0.4, -0.12, -0.4); s.lineTo(0.02, -0.36); s.quadraticCurveTo(0.05, -0.34, 0.05, -0.3); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 6 }); g.translate(0, 0, -0.006); g.rotateY(-Math.PI / 2);
    const stock = new THREE.CylinderGeometry(0.018, 0.018, 0.08, 10); stock.translate(0, 0.0, 0);
    const rm = new THREE.Mesh(mergeGeometries([prep(g), prep(stock)], false), M.bronze); rm.name = 'rudder-blade'; rudder.add(rm); }

  // ---- fish crate (varnished, between the benches) and the landing-net rest on the engine hatch
  const crateZ = -0.855;
  { const L = 0.64, W = 0.27, Hh = 0.15, t = 0.012; const c = () => { const v = 0.8 + R() * 0.12; return [v, v * 0.95, v * 0.92]; };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add('mahog', woodBox(0.024, Hh, 0.024, 6, 0.003), M4(sx * (L / 2 - 0.012), FLOOR + Hh / 2, crateZ + sz * (W / 2 - 0.012)), c());
    for (let k = 0; k < 2; k++) { const y = FLOOR + 0.035 + k * 0.07;
      for (const sz of [-1, 1]) B.add('mahog', woodBox(L - 0.004, 0.052, t, 3 + k, 0.003), M4(0, y, crateZ + sz * (W / 2 - t / 2)), c());
      for (const sx of [-1, 1]) B.add('mahog', woodBox(t, 0.052, W - 0.004, 5, 0.003), M4(sx * (L / 2 - t / 2), y, crateZ), c()); }
    B.add('mahog', woodBox(L - 0.02, 0.01, W - 0.02, 2, 0.002), M4(0, FLOOR + 0.008, crateZ), c());
    for (const sx of [-1, 1]) B.add('chrome', new THREE.TorusGeometry(0.03, 0.005, 6, 12, Math.PI), M4(sx * (L / 2 + 0.002), FLOOR + Hh - 0.02, crateZ, 0, Math.PI / 2, 0), lin(0xe4e8eb)); }
  const crate = new THREE.Object3D(); crate.name = 'crate'; crate.position.set(0, FLOOR + 0.02, crateZ); crate.rotation.y = Math.PI / 2; object.add(crate);
  const netRest = new THREE.Object3D(); netRest.name = 'netRest';
  { const dir = V3(0.755, 0, -0.656), hoop = V3(0.5, 0, -2.93); const butt = hoop.clone().addScaledVector(dir, -1.75); const s = at(-2.5);
    netRest.position.set(butt.x, deckY(0.3, s) + 0.045 + 0.022, butt.z); netRest.quaternion.setFromEuler(new THREE.Euler(0.0, Math.atan2(dir.x, dir.z), 0, 'YXZ')); }
  object.add(netRest);

  // ---- anchor line from the bow fairlead
  const anchorRope = anchorRopeMesh(M, V3(0, deckY(0, at(Z1 - 0.12)) + 0.01, Z1 - 0.08), V3(0, -3.2, Z1 + 3.6)); object.add(anchorRope);

  // ---- materials, meshes
  const accent = new THREE.Color(accentHex);
  const hullMat = makeZonedHull('runabout-hull', { map: T.mahog.hull, bumpMap: T.mahog.data, bumpScale: 0.7, roughnessMap: T.mahog.data, roughness: 1, clearcoat: 1, clearcoatRoughness: 0.04 },
    { accent: accentHex, bottom: 0xe9e4d6, wl: 0.025, bootW: 0.05, paintK: [0.82, 1.4], bottomRough: 0.45 });
  const accentMat = new THREE.MeshPhysicalMaterial({ name: 'piping', color: accentHex, vertexColors: true, roughness: 0.45, clearcoat: 0.3 });
  for (const [k, mat] of [['hull', hullMat], ['mahog', M.mahog], ['mahogP', M.mahogP], ['chrome', M.chrome], ['leather', M.leather], ['fabric', M.fabric], ['plastic', M.plastic], ['panel', M.panel], ['glass', M.glass], ['accent', accentMat], ['plate', plateMat]]) {
    const mesh = B.mesh(k, mat); if (mesh) object.add(mesh);
  }
  const waterMask = new THREE.Mesh(H.mask(hullSecs, 0.07), M.mask); waterMask.name = 'waterMask'; object.add(waterMask);
  finishMeshes(object, waterMask);

  const seats = {
    driver: V3(DRV, 0.26 + HIP, -0.41), fisher: V3(0.40, 0.26 + HIP, -1.63),
    passengers: [V3(0.40, 0.26 + HIP, -0.41), V3(-0.40, 0.26 + HIP, -1.63)],
  };
  let throttle = 0, steer = 0, propSpeed = 0, propAngle = 0;
  return {
    object, length: Z1 - Z0, beam: 2 * 1.10 + 0.04,
    seats, seatInfo: { canFaceAft: { driver: false, fisher: false, passengers: [false, false] } },
    helm: { kind: 'wheel', right: wheel.right, left: wheel.left }, tillerGrip: wheel.right,
    crate, netRest, waterMask,
    physics: { mass: 1350, thrust: 4600, halfLength: 3.5, beam: 2.24, draft: 0.36 },
    setThrottle(t) { throttle = clamp(t || 0, -1, 1); },
    setSteer(s) { steer = clamp(s || 0, -1, 1); wheel.spin.rotation.z = steer * 1.75; rudder.rotation.y = steer * 0.6; },
    setAnchor(d) { anchorRope.visible = !!d; },
    setPaint(hex) { const z = hullMat.userData.zones; if (hex == null) { z.uPaintAmt.value = 0; return; } z.uPaint.value.set(hex); z.uPaintAmt.value = 1; },
    setAccent(hex) { if (hex == null) return; accent.set(hex); hullMat.userData.zones.uAccent.value.set(hex); accentMat.color.set(hex); },
    update(dt = 0.016, time = performance.now() / 1000) {
      const target = throttle * 24 * Math.PI * 2;
      propSpeed += (target - propSpeed) * Math.min(1, dt * 2.5);
      propAngle += propSpeed * dt; prop.rotation.z = propAngle;
      flag.update(time, Math.abs(throttle));
    },
  };
}

// ----------------------------------------------------------------------------
// type: modern centre-console sport-fisher, ~10 m, deep V, twin V8 outboards
// ----------------------------------------------------------------------------
const SF = { ZA: -5.05, ZT: -4.40, Z1: 4.95, DECK: 0.42, BOW_DECK: 0.66, STEP: 2.60, BRACKET: 0.48, CAP: 0.21 };
// every uv of a geometry at one atlas spot (solid colour / glow from the instrument atlas, or the cowl's plain patch)
function flatUV(geo, u, v) { const uv = geo.attributes.uv; if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v); return geo; }
function atlasSolid(geo, key) { const r = atlasUV(key); return flatUV(geo, (r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2); }

// 300 hp V8 outboard. Local frame: origin on the steering axis at the clamp, +Z toward the boat, lower unit down -Y.
// One mesh (cowl decals + painted lower unit share the cowl atlas) + the prop.
function buildBigOutboard(M, mirror) {
  const B = new Buckets(); const PLAIN = [0.985, 0.985];
  const P = (g) => flatUV(g, PLAIN[0], PLAIN[1]);
  const GRAPH = lin(0x2a2d31), BLACK = lin(0x111214);
  B.add('m', cowlShell({ y0: 0.17, y1: 0.80, a0: 0.29, b0: 0.47, zc: -0.22, R: 0.12, roundTop: true, slope: 0.06, taper: 0.1, m: 40, straight: 3 }));
  B.add('m', P(cowlShell({ y0: -0.03, y1: 0.17, a0: 0.272, b0: 0.452, zc: -0.21, R: 0.06, roundTop: false, taper: -0.03, m: 32, straight: 1 })), null, GRAPH);
  B.add('m', P(cowlShell({ y0: 0.158, y1: 0.18, a0: 0.294, b0: 0.474, zc: -0.215, R: 0, m: 32, straight: 1, cap: false })), null, BLACK);
  // rear cowl grab handle / water-pump indicator, front air intake grille
  B.add('m', P(new RoundedBoxGeometry(0.16, 0.035, 0.03, 2, 0.012)), M4(0, 0.5, -0.69), BLACK);
  B.add('m', P(new RoundedBoxGeometry(0.22, 0.07, 0.02, 2, 0.008)), M4(0, 0.66, 0.24, -0.5, 0, 0), BLACK);
  const mid = []; for (let i = 0; i <= 8; i++) { const t = i / 8; mid.push(foilRing(lerp(0.0, -0.72, t), lerp(0.07, 0.05, t), lerp(0.46, 0.4, t), lerp(0.22, 0.15, t), 22)); }
  B.add('m', P(loftRings(mid.reverse(), { flip: true })), null, GRAPH);
  const strut = []; for (let i = 0; i <= 3; i++) { const t = i / 3; strut.push(foilRing(lerp(-0.71, -0.88, t), lerp(0.05, 0.06, t), 0.38, lerp(0.11, 0.09, t), 22)); }
  B.add('m', P(loftRings(strut.reverse(), { flip: true })), null, GRAPH);
  // anti-ventilation plate
  { const s = new THREE.Shape(); s.moveTo(-0.08, 0.0); s.bezierCurveTo(-0.2, -0.03, -0.21, -0.2, -0.2, -0.38); s.quadraticCurveTo(-0.198, -0.5, -0.1, -0.52);
    s.lineTo(0.1, -0.52); s.quadraticCurveTo(0.198, -0.5, 0.2, -0.38); s.bezierCurveTo(0.21, -0.2, 0.2, -0.03, 0.08, 0.0); s.quadraticCurveTo(0, 0.05, -0.08, 0.0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 1, curveSegments: 8 }); g.rotateX(Math.PI / 2);
    B.add('m', P(g), M4(0, -0.73, 0.04), GRAPH); }
  // torpedo gearcase + skeg + trim tab
  { const pr = []; const L = 0.5; for (let i = 0; i <= 14; i++) { const t = i / 14; const r = 0.078 * Math.pow(Math.sin(Math.min(1, t * 1.6) * Math.PI / 2), 0.55) * (1 - 0.35 * Math.pow(t, 3)); pr.push(new THREE.Vector2(Math.max(0.001, r), t * L)); }
    const g = new THREE.LatheGeometry(pr, 14); g.rotateX(-Math.PI / 2); B.add('m', P(g), M4(0, -0.93, 0.1), GRAPH); }
  { const s = new THREE.Shape(); s.moveTo(-0.05, -0.95); s.lineTo(-0.38, -0.95); s.lineTo(-0.36, -1.18); s.quadraticCurveTo(-0.34, -1.22, -0.3, -1.21); s.lineTo(-0.25, -1.18); s.lineTo(-0.07, -0.99); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 4 }); g.rotateY(-Math.PI / 2);
    B.add('m', P(g), M4(0.006, 0, 0), GRAPH); }
  B.add('m', P(new RoundedBoxGeometry(0.012, 0.03, 0.12, 1, 0.004)), M4(0, -0.76, -0.4), lin(0x8a8e92));
  for (const s of [1, -1]) for (let k = 0; k < 5; k++) B.add('m', P(new THREE.BoxGeometry(0.004, 0.05, 0.01)), M4(s * 0.045, -0.82, 0.02 - k * 0.022), BLACK);
  // swivel bracket / steering arm behind the clamp
  B.add('m', P(new RoundedBoxGeometry(0.16, 0.12, 0.14, 2, 0.02)), M4(0, -0.02, 0.07), BLACK);
  B.add('m', P(new RoundedBoxGeometry(0.12, 0.22, 0.1, 2, 0.02)), M4(0, -0.24, 0.08), BLACK);

  const yaw = new THREE.Group(); yaw.name = 'outboard';
  const body = new THREE.Group(); yaw.add(body);
  const mesh = B.mesh('m', M.sfCowl); body.add(mesh);
  const prop = new THREE.Mesh(propellerGeometry(), M.prop); prop.castShadow = true; prop.name = 'prop';
  prop.position.set(0, -0.93, -0.42); prop.scale.set(mirror ? -1.7 : 1.7, 1.7, 1.7); body.add(prop);
  return { yaw, body, prop };
}

function buildSportfisher(opts) {
  const { T, M } = sharedSportfisher();
  const accentHex = opts.accent ?? 0x1c6fb8;
  const seed = ((opts.seed ?? accentHex) >>> 0) % 100000 + 19;
  const object = new THREE.Group(); object.name = 'sportfisher';
  const B = new Buckets();
  const { ZA, ZT, Z1, DECK, BOW_DECK, STEP, BRACKET, CAP } = SF;
  const ST = lin(0xe8ecef), ALU = lin(0xc5cbd1), BLACK = lin(0x16181b), GREYV = lin(0xd9dde0), GEL = lin(0xf7f8f6), GELG = lin(0xe3e6e6);

  // ---- hull lines: deep V (~24 deg at the transom), lifting strakes, chine flats, flared bow
  const sheerY = u => u < 0.35 ? 1.08 + 0.03 * ((0.35 - u) / 0.35) ** 2 : 1.08 + 0.48 * ((u - 0.35) / 0.65) ** 2.1;
  const keelY = u => u < 0.5 ? -0.56 : -0.56 + (sheerY(1) + 0.56) * ((u - 0.5) / 0.5) ** 2.6;
  const halfS = u => u < 0.5 ? 1.47 - 0.17 * ((0.5 - u) / 0.5) ** 2 : 1.47 * Math.pow(Math.max(0, 1 - ((u - 0.5) / 0.5) ** 2.1), 0.55);
  const H = planingHull({ z0: ZA, z1: Z1, keelY, sheerY, halfS,
    chineK: u => 0.88 - 0.14 * smooth(0.45, 1, u), chineF: u => 0.295 + 0.08 * smooth(0.5, 1, u),
    flatW: u => 0.075 * (1 - smooth(0.55, 0.84, u)), flareE: u => lerp(0.9, 1.7, smooth(0.45, 1, u)), bulge: u => 0.02 * (1 - smooth(0.5, 0.9, u)), convex: 0.012,
    strakes: [{ at: 0.3, depth: 0.02, fade: [0.55, 0.8] }, { at: 0.6, depth: 0.018, fade: [0.5, 0.74] }] });
  const at = z => H.sec(H.uOfZ(z));
  const mainS = H.secs(ZT, Z1, 84, { bias: 0.5 }), brS = H.secs(ZA, ZT, 6, { topY: BRACKET });
  H.skin(mainS, B, 'hull'); H.skin(brS, B, 'hull');
  B.add('hull', H.transom(brS[0]));
  { // main transom face above the bracket deck
    const s = mainS[0]; const pts = s.top.filter(p => p[1] > BRACKET + 0.002); pts.unshift([s.outerX(BRACKET), BRACKET]);
    const outline = pts.concat(mirrorRev(pts)); const sh = new THREE.Shape(); sh.moveTo(outline[0][0], outline[0][1]); for (let i = 1; i < outline.length; i++) sh.lineTo(outline[i][0], outline[i][1]); sh.closePath();
    const g = new THREE.ShapeGeometry(sh, 2); const uv = g.attributes.uv, p = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 0.5, 10 + p.getY(i));
    g.translate(0, 0, ZT); B.add('hull', orient(prep(g), () => V3(0, 0, -1)));
  }
  // bracket / swim platform deck
  B.add('nonskid', stripLoft(brS, s => [[-s.xS, BRACKET], [s.xS, BRACKET]], { uv: (s, p) => [p[0] / 0.25, s.z / 0.25], expect: UP }), null, GEL);
  // rub rail (black vinyl, stainless insert) along the sheer and across the transom
  for (const side of [1, -1]) {
    const rs = H.secs(ZT - 0.015, Z1 - 0.02, 60, { bias: 0.5 });
    B.add('plastic', stripLoft(rs, s => [[s.xS - 0.004, s.yS - 0.06], [s.xS + 0.028, s.yS - 0.05], [s.xS + 0.04, s.yS - 0.015], [s.xS + 0.03, s.yS + 0.022], [s.xS - 0.004, s.yS + 0.03]].map(q => [side * q[0], q[1]]),
      { uv: (s, p, g) => [s.z, g * 4], expect: () => V3(side, 0.1, 0) }), null, lin(0x2a2c2f));
    B.add('chrome', tube(rs.map(s => V3(side * (s.xS + 0.041), s.yS - 0.014, s.z)), 0.008, 64, 5, false, 0), null, ST);
  }
  { const s = mainS[0]; B.add('plastic', new RoundedBoxGeometry(2 * s.xS + 0.06, 0.08, 0.05, 2, 0.02), M4(0, s.yS - 0.015, ZT - 0.012), lin(0x2a2c2f));
    B.add('chrome', new THREE.CylinderGeometry(0.008, 0.008, 2 * s.xS + 0.04, 8).rotateZ(Math.PI / 2), M4(0, s.yS - 0.014, ZT - 0.04), ST); }
  // hull-side model decal + transom name / home port
  for (const side of [1, -1]) {
    const z = 2.3, s = at(z), y = s.yS - 0.3; const p0 = V3(side * s.outerX(y), y, z), p1 = V3(side * s.outerX(y + 0.05), y + 0.05, z); const s2 = at(z + 0.05); const p2 = V3(side * s2.outerX(y), y, z + 0.05);
    const up = p1.clone().sub(p0).normalize(), along = p2.clone().sub(p0).normalize(); const nrm = new THREE.Vector3().crossVectors(along, up).normalize(); if (nrm.x * side < 0) nrm.negate();
    const xAx = new THREE.Vector3().crossVectors(up, nrm).normalize();
    B.add('panel', atlasQuad('sfModel', 0.95, 0.18), new THREE.Matrix4().makeBasis(xAx, up, nrm).setPosition(p0.addScaledVector(nrm, 0.004)));
  }
  B.add('panel', atlasQuad('sfName', 1.5, 0.19), M4(0, 0.86, ZT - 0.004, 0, Math.PI, 0));

  // ---- gunwale caps + inner liner with toe kick (cockpit and raised bow deck)
  const capW = s => Math.min(CAP, s.xS * 0.4);
  const bowDeck = s => Math.max(BOW_DECK, s.yK + 0.14);
  const linerProf = (s, yd) => {
    const xo = s.xS, ys = s.yS, xi = xo - capW(s);
    const xw = Math.max(0.01, Math.min(xi + 0.025, s.outerX(yd + 0.14) - 0.07));
    const xk = Math.max(xw, Math.min(xw + 0.07, s.outerX(yd + 0.04) - 0.035));
    return [[xo + 0.006, ys - 0.05], [xo + 0.01, ys + 0.004], [xo - 0.008, ys + 0.026], [xi + 0.02, ys + 0.028], [xi - 0.004, ys + 0.014], [Math.max(0.006, xi - 0.012), ys - 0.03],
      [xw, Math.min(ys - 0.08, yd + 0.14)], [xw + 0.004, Math.min(ys - 0.1, yd + 0.12)], [xk, Math.min(ys - 0.1, yd + 0.115)], [xk, yd]];
  };
  const linerXk = (s, yd) => linerProf(s, yd)[9][0];
  const cockS = H.secs(ZT, STEP, 60), bowS = H.secs(STEP, Z1 - 0.012, 40, { bias: 0.4 });
  for (const side of [1, -1]) {
    for (const [S, ydf] of [[cockS, () => DECK], [bowS, bowDeck]]) {
      B.add('gel', stripLoft(S, s => linerProf(s, ydf(s)).map(q => [side * q[0], q[1]]), { uv: (s, p, g) => [s.z, g], expect: p => V3(-side * 0.6, 0.6, 0) }), null, GEL);
    }
  }
  // transom bulkhead (inside) + transom cap
  { const s = mainS[0]; const xw = linerProf(s, DECK)[6][0], xi = linerProf(s, DECK)[5][0];
    const g = loftGrid(2, 2, (i, j) => [(j ? 1 : -1) * (i ? xi : linerXk(s, DECK)), i ? s.yS - 0.03 : DECK, ZT + 0.06, 0, 0]);
    B.add('gel', orient(g, () => V3(0, 0, 1)), null, GEL);
    B.add('gel', new RoundedBoxGeometry(2 * s.xS + 0.01, 0.06, 0.12, 2, 0.025), M4(0, s.yS, ZT + 0.03), GEL); }
  // non-skid decks: cockpit (with the in-deck fish box opening) and raised bow casting deck
  const FB = { x: 0.30, z0: -3.35, z1: -2.45, depth: 0.30 };
  const deckStrip = (S, xa, xb, y) => stripLoft(S, s => [[xa(s), y(s)], [xb(s), y(s)]], { uv: (s, p) => [p[0] / 0.25, s.z / 0.25], expect: UP });
  const full = s => linerXk(s, DECK);
  B.add('nonskid', deckStrip(H.secs(ZT + 0.06, FB.z0, 10), s => -full(s), s => full(s), () => DECK), null, GEL);
  B.add('nonskid', deckStrip(H.secs(FB.z0, FB.z1, 6), s => -full(s), () => -FB.x, () => DECK), null, GEL);
  B.add('nonskid', deckStrip(H.secs(FB.z0, FB.z1, 6), () => FB.x, s => full(s), () => DECK), null, GEL);
  B.add('nonskid', deckStrip(H.secs(FB.z1, STEP, 40), s => -full(s), s => full(s), () => DECK), null, GEL);
  B.add('nonskid', deckStrip(bowS, s => -linerXk(s, bowDeck(s)), s => linerXk(s, bowDeck(s)), bowDeck), null, GEL);
  { const s = at(STEP); const x = linerXk(s, BOW_DECK); B.add('gel', orient(loftGrid(2, 2, (i, j) => [(j ? 1 : -1) * x, i ? BOW_DECK : DECK, STEP, 0, 0]), () => V3(0, 0, -1)), null, GEL); }
  // fish box: insulated well under the deck, lid propped open toward the bow
  { const { x, z0, z1, depth } = FB; const yb = DECK - depth, zc = (z0 + z1) / 2;
    const walls = [[[-x, z0], [x, z0], V3(0, 0, 1)], [[x, z1], [-x, z1], V3(0, 0, -1)], [[-x, z1], [-x, z0], V3(1, 0, 0)], [[x, z0], [x, z1], V3(-1, 0, 0)]];
    for (const [a, b, n] of walls) B.add('gel', orient(loftGrid(2, 2, (i, j) => { const p = j ? b : a; return [p[0], i ? DECK : yb, p[1], 0, 0]; }), () => n), null, lin(0xdfe8ec));
    B.add('gel', orient(loftGrid(2, 2, (i, j) => [j ? x : -x, yb, i ? z1 : z0, 0, 0]), UP), null, lin(0xd3dde2));
    B.add('chrome', new THREE.CylinderGeometry(0.02, 0.02, 0.004, 12), M4(0, yb + 0.002, z0 + 0.05), lin(0x9aa0a6));
    const lid = new THREE.Matrix4().compose(V3(0, DECK + 0.01, z1), new THREE.Quaternion().setFromEuler(new THREE.Euler(1.75, 0, 0)), V3(1, 1, 1));
    B.add('gel', new RoundedBoxGeometry(2 * x + 0.04, 0.035, z1 - z0 + 0.04, 2, 0.012), lid.clone().multiply(M4(0, 0.018, -(z1 - z0) / 2 - 0.02)), GEL);
    B.add('nonskid', new THREE.PlaneGeometry(2 * x - 0.04, z1 - z0 - 0.04).rotateX(-Math.PI / 2), lid.clone().multiply(M4(0, 0.0365, -(z1 - z0) / 2 - 0.02)), GEL);
    B.add('plastic', new RoundedBoxGeometry(2 * x - 0.06, 0.01, z1 - z0 - 0.06, 1, 0.004), lid.clone().multiply(M4(0, -0.001, -(z1 - z0) / 2 - 0.02)), lin(0x8d9296));
    B.add('gel', new RoundedBoxGeometry(2 * x - 0.1, 0.008, z1 - z0 - 0.1, 1, 0.004), lid.clone().multiply(M4(0, -0.006, -(z1 - z0) / 2 - 0.02)), GEL);
    for (const sx of [-1, 1]) B.add('chrome', new RoundedBoxGeometry(0.06, 0.012, 0.04, 1, 0.004), M4(sx * 0.18, DECK + 0.004, z1 + 0.01), ST);
    const crate = new THREE.Object3D(); crate.name = 'crate'; crate.position.set(0, yb + 0.012, zc); object.add(crate); object.userData._crate = crate; }

  // ---- centre console: moulded body, angled helm panel, tinted windshield with stainless grab rail
  const CZA = -0.39, CZF = 0.92, CW = 0.52, CTOP = 1.42;
  { const sh = new THREE.Shape(); const pts = [[CZA, DECK], [CZA, 1.0], [CZA - 0.11, 1.11], [CZA + 0.09, CTOP], [0.62, CTOP], [CZF, 1.18], [CZF, DECK]];
    sh.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: CW * 2 - 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2, curveSegments: 4 });
    g.translate(0, 0, -(CW * 2 - 0.03) / 2); g.rotateY(-Math.PI / 2);
    B.add('gel', g, null, GEL);
    // footrest step + stainless rail, toe kick shadow line
    B.add('gel', new RoundedBoxGeometry(CW * 2 - 0.06, 0.04, 0.14, 2, 0.015), M4(0, 0.705, CZA - 0.07), GEL);
    B.add('chrome', new THREE.CylinderGeometry(0.012, 0.012, CW * 2 - 0.1, 10).rotateZ(Math.PI / 2), M4(0, 0.735, CZA - 0.13), ST);
    B.add('plastic', new RoundedBoxGeometry(CW * 2 - 0.04, 0.05, 0.02, 1, 0.005), M4(0, DECK + 0.03, CZA - 0.008), lin(0x2a2c2f));
  }
  // helm panel frame: basis on the inclined panel (X across, Y up the panel, Z out of it)
  const pA = V3(0, 1.11, CZA - 0.11), pB = V3(0, CTOP, CZA + 0.09); const pUp = pB.clone().sub(pA).normalize(); const pN = V3(0, -pUp.z, pUp.y).multiplyScalar(-1); if (pN.z > 0) pN.negate();
  const onPanel = (x, t, off = 0.014) => new THREE.Matrix4().makeBasis(V3(-1, 0, 0), pUp, pN).setPosition(pA.clone().lerp(pB, t).add(V3(x, 0, 0)).addScaledVector(pN, off));
  B.add('plastic', new RoundedBoxGeometry(0.46, 0.3, 0.03, 2, 0.012), onPanel(0.16, 0.5, 0.02), BLACK);
  B.add('panel', atlasQuad('mfd', 0.42, 0.262), onPanel(0.16, 0.5, 0.036));
  B.add('plastic', new RoundedBoxGeometry(0.2, 0.125, 0.025, 2, 0.01), onPanel(-0.26, 0.72, 0.018), BLACK);
  B.add('panel', atlasQuad('engine', 0.18, 0.112), onPanel(-0.26, 0.72, 0.032));
  B.add('panel', atlasDisc('small', 0.034, 4), onPanel(-0.44, 0.3, 0.018)); B.add('chrome', new THREE.TorusGeometry(0.037, 0.005, 6, 24), onPanel(-0.44, 0.3, 0.018), ST);
  B.add('panel', atlasDisc('small', 0.034, 5), onPanel(-0.08, 0.3, 0.018)); B.add('chrome', new THREE.TorusGeometry(0.037, 0.005, 6, 24), onPanel(-0.08, 0.3, 0.018), ST);
  B.add('panel', atlasQuad('switches', 0.26, 0.13), M4(0.24, 0.93, CZA - 0.006, 0, Math.PI, 0));
  // compass binnacle on the console top
  { const c = V3(-0.25, CTOP + 0.012, CZA + 0.2); B.add('plastic', new THREE.CylinderGeometry(0.075, 0.085, 0.05, 24), M4(c.x, c.y + 0.025, c.z), BLACK);
    B.add('panel', atlasDisc('compass', 0.06, null, 24), M4(c.x, c.y + 0.052, c.z, -Math.PI / 2, 0, 0));
    B.add('glass', new THREE.SphereGeometry(0.068, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M4(c.x, c.y + 0.05, c.z), lin(0xffffff)); }
  // throttle binnacle on the starboard side of the console
  { const x = -CW - 0.045, y = 1.18, z = CZA + 0.16; B.add('plastic', new RoundedBoxGeometry(0.09, 0.15, 0.2, 2, 0.02), M4(x, y, z), BLACK);
    for (const dx of [-0.02, 0.02]) { const lv = new THREE.CylinderGeometry(0.007, 0.009, 0.2, 10); lv.translate(0, 0.1, 0); B.add('chrome', lv, M4(x + dx, y + 0.06, z, -0.6, 0, 0), ST);
      B.add('plastic', new THREE.SphereGeometry(0.02, 12, 8), M4(x + dx, y + 0.06 + 0.2 * Math.cos(0.6), z - 0.2 * Math.sin(0.6)), BLACK); } }
  // windshield wrapping the console top
  { const n = 5, a = CW - 0.02, b = 0.88, zc = CZA + 0.11, h0 = 0.4, rake = 0.5, N = 36;
    const se = (phi) => { const s = Math.sin(phi), c = Math.cos(phi); return [a * Math.sign(s) * Math.pow(Math.abs(s), 2 / n), zc + b * Math.pow(Math.abs(c), 2 / n)]; };
    const base = [], topP = [];
    for (let i = 0; i <= N; i++) { const phi = -Math.PI / 2 + Math.PI * i / N; const [x, z] = se(phi); const [x1, z1] = se(phi + 0.01), [x0, z0] = se(phi - 0.01);
      const tx = x1 - x0, tz = z1 - z0, nl = Math.hypot(tx, tz) || 1, nx = tz / nl, nz = -tx / nl; const y = CTOP + 0.01, h = h0 * (1 - 0.25 * Math.abs(Math.sin(phi)) ** 3);
      base.push(V3(x, y, Math.min(z, 0.6))); topP.push(V3(x - nx * h * Math.sin(rake) * 0.6, y + h * Math.cos(rake * 0.6), Math.min(z, 0.6) - nz * h * Math.sin(rake))); }
    B.add('glass', loftGrid(N + 1, 2, (i, j) => { const p = j ? topP[i] : base[i]; return [p.x, p.y, p.z, i / N, j]; }), null, lin(0x8a9aa0));
    const rail = [base[0].clone().add(V3(0, 0, -0.04)), ...topP.map(p => p.clone().add(V3(0, 0.02, 0))), base[N].clone().add(V3(0, 0, -0.04))];
    B.add('chrome', tube(rail, 0.014, 56, 6, false, 0), null, ST);
    B.add('plastic', boxSweep(base.map(p => p.clone()), base.map(() => V3(0, 1, 0)), base.map((p, i) => { const q = base[Math.min(N, i + 1)].clone().sub(base[Math.max(0, i - 1)]).normalize(); return V3(q.z, 0, -q.x); }), 0.02, 0.03, BLACK, 1));
    // side grab rails on the console
    for (const s of [1, -1]) B.add('chrome', tube([V3(s * (CW + 0.008), 1.25, CZA + 0.05), V3(s * (CW + 0.05), 1.27, CZA + 0.1), V3(s * (CW + 0.05), 1.27, 0.55), V3(s * (CW + 0.008), 1.25, 0.6)], 0.013, 24, 8, false, 0), null, ST);
  }
  // console front seat (cooler under), backrest against the console
  { const z0 = CZF + 0.02, z1 = CZF + 0.46; B.add('gel', new RoundedBoxGeometry(0.92, 0.28, z1 - z0, 2, 0.03), M4(0, DECK + 0.14, (z0 + z1) / 2), GELG);
    for (const sx of [-1, 1]) B.add('plastic', new RoundedBoxGeometry(0.04, 0.05, 0.03, 1, 0.008), M4(sx * 0.3, DECK + 0.24, z1 + 0.012), BLACK);
    B.add('leather', cushion(0.9, 0.07, z1 - z0, { pleats: 4, r: 0.025 }), M4(0, DECK + 0.28 + 0.035, (z0 + z1) / 2), GREYV);
    B.add('leather', cushion(0.86, 0.3, 0.07, { pleats: 4, r: 0.025, face: 'front' }), M4(0, DECK + 0.5, CZF + 0.05, -0.05, 0, 0), GREYV);
    for (const sx of [-1, 1]) B.add('accent', new THREE.CylinderGeometry(0.005, 0.005, 0.86, 6).rotateZ(Math.PI / 2), M4(0, DECK + 0.345, z1 - 0.008 + sx * 0), WHITE); }

  // ---- leaning post: moulded base with tackle drawers, bolster seats, stainless frame + rocket launcher
  const LZA = -1.30, LZF = -0.90;
  { B.add('gel', new RoundedBoxGeometry(1.24, 0.58, LZF - LZA, 2, 0.03), M4(0, DECK + 0.29, (LZA + LZF) / 2), GEL);
    for (let k = 0; k < 3; k++) { const y = DECK + 0.14 + k * 0.14; B.add('gel', new RoundedBoxGeometry(0.5, 0.11, 0.02, 2, 0.008), M4(0.25, y, LZA - 0.008), GELG);
      B.add('chrome', tube([V3(0.17, y, LZA - 0.02), V3(0.18, y, LZA - 0.045), V3(0.32, y, LZA - 0.045), V3(0.33, y, LZA - 0.02)], 0.006, 12, 6, false, 0), null, ST); }
    B.add('gel', new RoundedBoxGeometry(0.46, 0.38, 0.02, 2, 0.008), M4(-0.3, DECK + 0.28, LZA - 0.008), GELG);
    B.add('plastic', new THREE.CircleGeometry(0.06, 20), M4(-0.3, DECK + 0.3, LZA - 0.02, 0, Math.PI, 0), lin(0x2a3a44));
    for (const x of [-0.26, 0.3]) {
      B.add('leather', cushion(0.54, 0.085, 0.38, { pleats: 3, r: 0.03 }), M4(x, 1.0 + 0.04, (LZA + LZF) / 2 + 0.05), GREYV);
      B.add('leather', cushion(0.5, 0.3, 0.08, { pleats: 3, r: 0.03, face: 'front' }), M4(x, 1.3, -1.22, -0.12, 0, 0), GREYV);
      B.add('accent', new THREE.CylinderGeometry(0.005, 0.005, 0.5, 6).rotateZ(Math.PI / 2), M4(x, 1.077, LZF + 0.04), WHITE);
    }
    // stainless frame around the backrests + rocket launcher on top
    const fr = [V3(-0.6, 1.0, -1.27), V3(-0.6, 1.4, -1.28), V3(-0.55, 1.5, -1.29), V3(0.55, 1.5, -1.29), V3(0.6, 1.4, -1.28), V3(0.6, 1.0, -1.27)];
    B.add('chrome', tube(fr, 0.016, 32, 6, false, 0), null, ST);
    for (const x of [-0.6, 0.6]) B.add('chrome', tube([V3(x, 1.05, -1.27), V3(x * 1.02, 1.12, -1.0), V3(x * 1.02, 1.12, -0.92)], 0.014, 16, 8, false, 0), null, ST);
  }

  // ---- T-top: four splayed legs, hardtop with accent edge band, rocket launcher, nav light, radar, antennas, outriggers
  const TT = { y: 2.46, x: 1.0, z0: -1.38, z1: 1.26, rail: -1.46 };
  const legs = [];
  for (const sx of [-1, 1]) for (const [zb, zt] of [[CZA + 0.1, -0.42], [CZF - 0.12, 0.98]]) {
    const base = V3(sx * 0.6, DECK, zb); const pts = [base, V3(sx * 0.6, 1.0, zb), V3(sx * 0.62, 1.7, lerp(zb, zt, 0.4)), V3(sx * 0.76, 2.25, lerp(zb, zt, 0.85)), V3(sx * 0.8, TT.y, zt)];
    B.add('chrome', tube(pts, 0.026, 20, 8, false, 0), null, ALU); legs.push(pts);
    B.add('chrome', new THREE.CylinderGeometry(0.05, 0.06, 0.03, 16), M4(base.x, DECK + 0.015, base.z), ALU);
  }
  for (const sx of [-1, 1]) {
    B.add('chrome', tube([V3(sx * 0.61, 1.62, CZA + 0.25), V3(sx * 0.61, 1.62, CZF - 0.2)], 0.018, 8, 8, false, 0), null, ALU);
    B.add('chrome', tube([V3(sx * 0.8, TT.y - 0.01, TT.rail), V3(sx * 0.8, TT.y - 0.01, 0.98)], 0.022, 8, 8, false, 0), null, ALU);
  }
  for (const z of [TT.rail, -0.42, 0.98]) B.add('chrome', tube([V3(-0.8, TT.y - 0.01, z), V3(0.8, TT.y - 0.01, z)], 0.022, 8, 8, false, 0), null, ALU);
  { const g = new RoundedBoxGeometry(TT.x * 2, 0.085, TT.z1 - TT.z0, 3, 0.04); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { const x = p.getX(i) / TT.x, z = (p.getZ(i)) / ((TT.z1 - TT.z0) / 2); p.setY(i, p.getY(i) + 0.05 * Math.max(0, 1 - x * x) * Math.max(0, 1 - z * z)); }
    g.computeVertexNormals(); B.add('gel', g, M4(0, TT.y + 0.045, (TT.z0 + TT.z1) / 2), GEL);
    const ring = (o) => rrRing(V3(0, 0, (TT.z0 + TT.z1) / 2), V3(1, 0, 0), V3(0, 0, 1), TT.x * 2 + 0.012, TT.z1 - TT.z0 + 0.012, 0.045, 3).map(q => q.add(V3(0, o, 0)));
    B.add('accent', orient(loftRings([ring(TT.y + 0.02), ring(TT.y + 0.055)], { flip: false }), p => V3(p.x, 0, p.z - (TT.z0 + TT.z1) / 2)), null, WHITE);
    B.add('plastic', new RoundedBoxGeometry(0.42, 0.12, 0.3, 2, 0.02), M4(0, TT.y - 0.06, 0.1), BLACK);
    B.add('panel', atlasQuad('engine', 0.3, 0.06), M4(0, TT.y - 0.065, -0.051, 0, Math.PI, 0));
    for (const x of [-0.6, 0.6]) B.add('panel', atlasSolid(new THREE.CircleGeometry(0.035, 16), 'white'), M4(x, TT.y + 0.0, TT.z0 + 0.12, Math.PI / 2, 0, 0)); }
  const rodHolder = (m) => { const t = new THREE.CylinderGeometry(0.024, 0.02, 0.24, 10, 1, true); t.translate(0, -0.12, 0); B.add('chrome', t, m, ST); B.add('chrome', new THREE.TorusGeometry(0.025, 0.005, 4, 12).rotateX(Math.PI / 2), m, ST); };
  const rod = (m, L = 2.1, reelCol = lin(0xb8913a)) => {
    const blank = new THREE.CylinderGeometry(0.003, 0.009, L, 6); blank.translate(0, L / 2 - 0.05, 0); B.add('plastic', blank, m, lin(0x1c1f22));
    const grip = new THREE.CylinderGeometry(0.013, 0.013, 0.32, 8); grip.translate(0, 0.02, 0); B.add('plastic', grip, m, BLACK);
    const reel = new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10).rotateZ(Math.PI / 2); B.add('chrome', reel, m.clone().multiply(M4(0, 0.25, 0.05)), reelCol);
    B.add('chrome', new THREE.BoxGeometry(0.02, 0.05, 0.05), m.clone().multiply(M4(0, 0.25, 0.022)), lin(0x9aa0a6));
    for (const f of [0.4, 0.62, 0.82]) B.add('chrome', new THREE.TorusGeometry(0.009 * (1.2 - f), 0.0015, 3, 6), m.clone().multiply(M4(0, L * f, 0.012, 0, Math.PI / 2, 0)), lin(0x9aa0a6));
  };
  for (let k = 0; k < 6; k++) { const x = -0.75 + k * 0.3; const m = M4(x * 0.95, TT.y + 0.03, TT.rail - 0.02, -0.5, 0, (x / 0.75) * -0.12); rodHolder(m); if (k % 2 === 0 || k === 5) rod(m.clone().multiply(M4(0, -0.18, 0)), 2.0, k % 4 ? lin(0xc8ccd0) : lin(0xb8913a)); }
  // leaning-post rocket launcher (4 holders, two rods)
  for (let k = 0; k < 4; k++) { const x = -0.45 + k * 0.3; rodHolder(M4(x, 1.52, -1.3, -0.3, 0, 0)); }
  // all-round white light on a mast, radar dome, VHF whips, outriggers
  { const y0 = TT.y + 0.09; B.add('chrome', new THREE.CylinderGeometry(0.015, 0.02, 0.42, 10), M4(0, y0 + 0.21, TT.z0 + 0.28), ST);
    B.add('panel', atlasSolid(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 14), 'white'), M4(0, y0 + 0.45, TT.z0 + 0.28));
    B.add('plastic', new THREE.CylinderGeometry(0.032, 0.032, 0.012, 14), M4(0, y0 + 0.486, TT.z0 + 0.28), BLACK);
    B.add('gel', new THREE.CylinderGeometry(0.29, 0.3, 0.13, 32), M4(0, y0 + 0.07, 0.55), GEL);
    B.add('gel', new THREE.SphereGeometry(1, 32, 8, 0, Math.PI * 2, 0, Math.PI / 2), M4(0, y0 + 0.135, 0.55, 0, 0, 0, 0.29, 0.06, 0.29), GEL);
    B.add('plastic', new THREE.CylinderGeometry(0.22, 0.24, 0.02, 24), M4(0, y0, 0.55), BLACK);
    for (const sx of [-1, 1]) { const b = V3(sx * 0.82, y0, 1.1); B.add('chrome', new THREE.CylinderGeometry(0.02, 0.025, 0.08, 10), M4(b.x, b.y + 0.04, b.z), ST);
      const w = new THREE.CylinderGeometry(0.005, 0.014, 2.4, 8); w.translate(0, 1.2, 0); B.add('plastic', w, M4(b.x, b.y + 0.08, b.z, -0.25, 0, sx * -0.05), lin(0xf2f2ee)); }
    for (const sx of [-1, 1]) { const b = V3(sx * (TT.x - 0.06), y0, 0.05); B.add('chrome', new RoundedBoxGeometry(0.1, 0.1, 0.16, 2, 0.02), M4(b.x, b.y + 0.04, b.z), ST);
      const d = V3(sx * 0.38, 0.88, -0.28).normalize(); const L = 4.2; const pole = new THREE.CylinderGeometry(0.008, 0.02, L, 8); pole.translate(0, L / 2, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d); B.add('chrome', pole, new THREE.Matrix4().compose(b.clone().add(V3(0, 0.08, 0)), q, V3(1, 1, 1)), ALU);
      const sp = b.clone().add(V3(0, 0.08, 0)).addScaledVector(d, 1.5); B.add('chrome', tube([sp, sp.clone().add(V3(0, -0.1, 0.45))], 0.008, 4, 6, false, 0), null, ALU); } }
  // Swiss flag on a short staff at the aft starboard corner of the hardtop
  const flagBase = V3(-0.86, TT.y + 0.09, TT.z0 + 0.1);
  B.add('chrome', new THREE.CylinderGeometry(0.008, 0.01, 0.6, 8), M4(flagBase.x, flagBase.y + 0.3, flagBase.z), ST);
  const flag = makeFlag(M, 0.32); flag.mesh.position.set(flagBase.x, flagBase.y + 0.58, flagBase.z); flag.mesh.rotation.y = Math.PI / 2; object.add(flag.mesh);

  // ---- bow: stainless pulpit rail, bow seating, anchor locker, nav light, anchor on the bow roller
  { const pts = []; const rs = H.secs(0.7, Z1 - 0.25, 14);
    for (const s of rs) pts.push(V3(s.xS - 0.07, s.yS + 0.4, s.z)); const tip = at(Z1 - 0.1); const head = V3(0, tip.yS + 0.42, Z1 - 0.12);
    const port = pts.map(p => p.clone()), stbd = pts.slice().reverse().map(p => V3(-p.x, p.y, p.z));
    const railPts = [V3(port[0].x, port[0].y - 0.36, port[0].z - 0.2), ...port, head, ...stbd, V3(-port[0].x, port[0].y - 0.36, port[0].z - 0.2)];
    B.add('chrome', tube(railPts, 0.016, 96, 6, false, 0), null, ST);
    for (let k = 1; k < rs.length; k += 3) for (const sx of [1, -1]) { const s = rs[k]; B.add('chrome', tube([V3(sx * (s.xS - 0.07), s.yS + 0.03, s.z), V3(sx * (s.xS - 0.07), s.yS + 0.4, s.z)], 0.012, 2, 8, false, 0), null, ST);
      B.add('chrome', new THREE.CylinderGeometry(0.03, 0.035, 0.02, 12), M4(sx * (s.xS - 0.07), s.yS + 0.035, s.z), ST); } }
  { // U-lounge: side seat boxes + cushions + bolsters, forward-facing centre seat
    const zA = 2.72, zB = 3.62; const bs = H.secs(zA, zB, 8);
    for (const side of [1, -1]) {
      const prof = s => { const xo = linerXk(s, bowDeck(s)) - 0.005, xi = Math.max(0.36, xo - 0.36); return [[xi, BOW_DECK], [xi, 0.97], [xo, 0.97]].map(q => [side * q[0], q[1]]); };
      B.add('gel', stripLoft(bs, prof, { expect: p => V3(-side, 0.5, 0) }), null, GELG);
      B.add('leather', stripLoft(bs, s => { const xo = linerXk(s, bowDeck(s)) - 0.01, xi = Math.max(0.37, xo - 0.35);
        return [[xi, 0.97], [xi - 0.005, 1.0], [xi + 0.02, 1.035], [lerp(xi, xo, 0.5), 1.045], [xo - 0.02, 1.035], [xo, 1.0], [xo, 0.97]].map(q => [side * q[0], q[1]]); }, { uv: (s, p, g) => [s.z * 2, g * 2], expect: UP }), null, GREYV);
      B.add('leather', stripLoft(bs, s => { const x = linerProf(s, bowDeck(s))[6][0] - 0.005; return [[x, 1.08], [x - 0.05, 1.1], [x - 0.06, 1.2], [x - 0.05, 1.3], [x, 1.32]].map(q => [side * q[0], q[1]]); }, { uv: (s, p, g) => [s.z * 2, g * 2], expect: () => V3(-side, 0, 0) }), null, GREYV);
    }
    B.add('gel', new RoundedBoxGeometry(0.66, 0.31, 0.42, 2, 0.03), M4(0, BOW_DECK + 0.155, 2.92), GELG);
    B.add('leather', cushion(0.66, 0.07, 0.42, { pleats: 3, r: 0.025 }), M4(0, BOW_DECK + 0.31 + 0.035, 2.92), GREYV);
    B.add('accent', new THREE.CylinderGeometry(0.005, 0.005, 0.62, 6).rotateZ(Math.PI / 2), M4(0, BOW_DECK + 0.375, 3.13), WHITE);
  }
  { const z = 4.05, s = at(z), y = bowDeck(s); B.add('gel', new RoundedBoxGeometry(0.5, 0.02, 0.42, 2, 0.008), M4(0, y + 0.01, z), GELG);
    B.add('chrome', new THREE.TorusGeometry(0.025, 0.005, 6, 14).rotateX(Math.PI / 2), M4(0, y + 0.022, z - 0.15), ST); }
  { const tip = at(Z1 - 0.06); const y = tip.yS + 0.03;
    B.add('chrome', new RoundedBoxGeometry(0.14, 0.02, 0.5, 2, 0.008), M4(0, y, Z1 - 0.02), ST);
    B.add('plastic', new THREE.CylinderGeometry(0.035, 0.035, 0.08, 14).rotateZ(Math.PI / 2), M4(0, y - 0.01, Z1 + 0.2), BLACK);
    B.add('chrome', new RoundedBoxGeometry(0.06, 0.05, 0.08, 1, 0.01), M4(0, y + 0.04, Z1 - 0.28), ST);
    for (const [sx, key] of [[1, 'red'], [-1, 'green']]) B.add('panel', atlasQuad(key, 0.05, 0.035), M4(sx * 0.031, y + 0.045, Z1 - 0.27, 0, sx * Math.PI / 2, 0)); }
  const anchorB = new Buckets();
  { // stainless delta anchor seated in the bow roller: shank along the platform, fluke hanging ahead of the stem
    const tip = at(Z1 - 0.06); const y = tip.yS + 0.03;
    const sh = new THREE.Shape(); sh.moveTo(0, 0.015); sh.lineTo(-0.025, 0.4); sh.quadraticCurveTo(0, 0.43, 0.025, 0.4); sh.closePath();
    const shank = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 4 });
    shank.translate(0, 0, -0.006); shank.rotateX(-Math.PI / 2);   // shape +y -> -z (aft), extrusion -> +y
    anchorB.add('a', shank, M4(0, y + 0.022, Z1 + 0.2, -0.08, 0, 0), ST);
    const fs2 = new THREE.Shape(); fs2.moveTo(-0.15, 0); fs2.quadraticCurveTo(0, 0.05, 0.15, 0); fs2.quadraticCurveTo(0.08, -0.12, 0, -0.27); fs2.quadraticCurveTo(-0.08, -0.12, -0.15, 0);
    const fluke = new THREE.ExtrudeGeometry(fs2, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 1, curveSegments: 6 });
    anchorB.add('a', fluke, M4(0, y + 0.01, Z1 + 0.25, 0.42, 0, 0), ST);
    anchorB.add('a', new RoundedBoxGeometry(0.03, 0.12, 0.02, 1, 0.006), M4(0, y - 0.03, Z1 + 0.245, 0.42, 0, 0), ST);
    anchorB.add('a', new THREE.TorusGeometry(0.022, 0.006, 6, 12), M4(0, y + 0.03, Z1 - 0.2, 0, Math.PI / 2, 0), ST); }
  const anchorStowed = anchorB.mesh('a', M.chrome); anchorStowed.name = 'anchor-stowed'; object.add(anchorStowed);
  const anchorRope = anchorRopeMesh(M, V3(0, at(Z1 - 0.06).yS + 0.02, Z1 + 0.22), V3(0, -4.5, Z1 + 5.2), 0.009); object.add(anchorRope);

  // ---- aft cockpit: transom bench + bolster, livewell hatch, coaming bolsters, flush rod holders, cleats, fisher's cooler
  { const z0 = ZT + 0.07, z1 = ZT + 0.48, s = at((z0 + z1) / 2); const w = Math.min(1.9, 2 * (linerXk(s, DECK) - 0.06));
    B.add('gel', new RoundedBoxGeometry(w, 0.3, 0.06, 2, 0.02), M4(0, DECK + 0.15, z1 - 0.04), GELG);
    for (const sx of [-1, 1]) B.add('chrome', tube([V3(sx * w * 0.4, DECK + 0.3, z0 + 0.05), V3(sx * w * 0.4, DECK + 0.3, z1 - 0.06)], 0.012, 4, 6, false, 0), null, ST);
    B.add('leather', cushion(w, 0.07, z1 - z0, { pleats: 6, r: 0.025 }), M4(0, DECK + 0.325, (z0 + z1) / 2), GREYV);
    B.add('accent', new THREE.CylinderGeometry(0.005, 0.005, w - 0.04, 6).rotateZ(Math.PI / 2), M4(0, DECK + 0.355, z1 - 0.008), WHITE);
    B.add('leather', cushion(w, 0.26, 0.07, { pleats: 6, r: 0.025, face: 'front' }), M4(0, DECK + 0.56, ZT + 0.1, -0.08, 0, 0), GREYV);
    const s0 = mainS[0]; B.add('gel', new RoundedBoxGeometry(0.56, 0.035, 0.2, 2, 0.012), M4(0, s0.yS + 0.045, ZT + 0.05), GELG);
    B.add('panel', atlasSolid(new THREE.CircleGeometry(0.05, 16), 'dashDark'), M4(0, s0.yS + 0.064, ZT + 0.05, -Math.PI / 2, 0, 0));
    for (const sx of [-1, 1]) B.add('chrome', new RoundedBoxGeometry(0.05, 0.012, 0.03, 1, 0.004), M4(sx * 0.18, s0.yS + 0.064, ZT + 0.14), ST); }
  for (const side of [1, -1]) {
    B.add('leather', stripLoft(H.secs(ZT + 0.1, -1.5, 30), s => { const p = linerProf(s, DECK); const x = p[5][0] + 0.018 * 0; const y0 = s.yS - 0.27, y1 = s.yS - 0.05;
      return [[x + 0.01, y0], [x - 0.03, y0 + 0.02], [x - 0.045, (y0 + y1) / 2], [x - 0.03, y1 - 0.01], [x + 0.005, y1]].map(q => [side * q[0], q[1]]); }, { uv: (s, p, g) => [s.z * 2, g * 3], expect: () => V3(-side, 0, 0) }), null, GREYV);
    for (const z of [-4.0, -3.25, -2.5]) { const s = at(z); const x = side * (s.xS - capW(s) / 2), y = s.yS + 0.029;
      B.add('chrome', new THREE.TorusGeometry(0.03, 0.007, 4, 12).rotateX(Math.PI / 2), M4(x, y, z), ST);
      B.add('plastic', new THREE.CircleGeometry(0.026, 16).rotateX(-Math.PI / 2), M4(x, y + 0.001, z), BLACK);
      if (z === -4.0) { rod(M4(x, y, z, -0.35, 0, -side * 0.3).multiply(M4(0, -0.18, 0)), 2.1, lin(0xb8913a)); } }
    const cl = hornCleat(0.2); for (const z of [-4.22, -0.3, 3.4]) { const s = at(z); B.add('chrome', cl, M4(side * (s.xS - capW(s) / 2), s.yS + 0.028, z), ST); }
  }
  { // fisher's cooler seat
    const c = V3(0.55, DECK, -2.75); B.add('gel', new RoundedBoxGeometry(0.42, 0.32, 0.66, 3, 0.04), M4(c.x, c.y + 0.16, c.z), GEL);
    B.add('plastic', new RoundedBoxGeometry(0.425, 0.012, 0.665, 1, 0.004), M4(c.x, c.y + 0.255, c.z), lin(0x9aa2a8));
    for (const dz of [-0.2, 0.2]) B.add('plastic', new RoundedBoxGeometry(0.03, 0.06, 0.05, 1, 0.01), M4(c.x + 0.21, c.y + 0.24, c.z + dz), BLACK);
    for (const dz of [-1, 1]) B.add('rope', tube([V3(c.x - 0.12, c.y + 0.2, c.z + dz * 0.335), V3(c.x, c.y + 0.16, c.z + dz * 0.36), V3(c.x + 0.12, c.y + 0.2, c.z + dz * 0.335)], 0.008, 12, 6, false, 0.05));
    B.add('leather', cushion(0.4, 0.035, 0.6, { pleats: 0, r: 0.015, segX: 6 }), M4(c.x, c.y + 0.3375, c.z), GREYV); }

  // ---- twin outboards on the bracket, clamp brackets and trim rams
  const motors = [];
  for (const sx of [1, -1]) {
    const mo = buildBigOutboard(M, sx < 0); mo.yaw.position.set(sx * 0.37, 0.44, ZA - 0.16); object.add(mo.yaw); motors.push(mo);
    for (const dx of [-0.1, 0.1]) B.add('plastic', new RoundedBoxGeometry(0.03, 0.42, 0.14, 1, 0.01), M4(sx * 0.37 + dx, 0.24, ZA - 0.06), lin(0x1d1f22));
    B.add('chrome', new THREE.CylinderGeometry(0.025, 0.025, 0.24, 12).rotateZ(Math.PI / 2), M4(sx * 0.37, 0.4, ZA - 0.09), lin(0xb0b6bc));
    for (const dx of [-0.07, 0.07]) B.add('chrome', new THREE.CylinderGeometry(0.018, 0.018, 0.22, 10), M4(sx * 0.37 + dx, 0.12, ZA - 0.1, 0.25, 0, 0), ST);
    B.add('plastic', tube([V3(sx * 0.6, BRACKET + 0.01, ZA + 0.3), V3(sx * 0.5, BRACKET + 0.05, ZA + 0.05), V3(sx * 0.42, 0.62, ZA - 0.05)], 0.012, 16, 6, false, 0), null, BLACK);
  }
  // swim ladder (starboard) and stern cleats on the bracket
  { const x = -1.0; for (const dx of [-0.13, 0.13]) B.add('chrome', tube([V3(x + dx, BRACKET + 0.005, ZA + 0.22), V3(x + dx, BRACKET + 0.07, ZA + 0.08), V3(x + dx, BRACKET + 0.02, ZA - 0.05), V3(x + dx, 0.1, ZA - 0.07), V3(x + dx, -0.35, ZA - 0.07)], 0.012, 18, 6, false, 0), null, ST);
    for (const y of [0.22, -0.02, -0.26]) B.add('chrome', new RoundedBoxGeometry(0.28, 0.015, 0.06, 1, 0.005), M4(x, y, ZA - 0.075), ST); }

  // ---- materials, meshes
  const accent = new THREE.Color(accentHex);
  const hullMat = makeZonedHull('sportfisher-hull', { map: T.gelNoise, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06 },
    { accent: accentHex, bottom: 0x1a2330, wl: 0.03, bootW: 0.08, stripe: [0.11, 0.155], paintK: [1.02, 0], bottomRough: 0.7 });
  const accentMat = new THREE.MeshPhysicalMaterial({ name: 'trim', color: accentHex, vertexColors: true, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  for (const [k, mat] of [['hull', hullMat], ['gel', M.gel], ['nonskid', M.nonskid], ['chrome', M.chrome], ['leather', M.leather], ['plastic', M.plastic], ['panel', M.panel], ['glass', M.glassTint], ['accent', accentMat], ['rope', M.rope]]) {
    const mesh = B.mesh(k, mat); if (mesh) object.add(mesh);
  }
  // helm: modern five-spoke stainless wheel with a black foam rim on a tilt column
  const WHUB = V3(-0.26, 1.51, -0.63), WTILT = 0.52;
  const wheel = buildWheel(M, { R: 0.19, rimR: 0.017, spokes: 'five', dish: 0.04, rim: 'plastic', rimCol: lin(0x141516) });
  const wheelPivot = new THREE.Group(); wheelPivot.name = 'helm'; wheelPivot.position.copy(WHUB); wheelPivot.rotation.x = WTILT; wheelPivot.add(wheel.spin); object.add(wheelPivot);
  { const ax = V3(0, -Math.sin(WTILT), Math.cos(WTILT)); const a = WHUB.clone().addScaledVector(ax, 0.06), b = WHUB.clone().addScaledVector(ax, 0.32);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, a.distanceTo(b), 16), M.plastic); col.geometry = prep(col.geometry, null, lin(0x141516));
    col.position.copy(a.clone().lerp(b, 0.5)); col.quaternion.setFromUnitVectors(V3(0, 1, 0), ax); col.name = 'helm-column';
    wheelPivot.parent.add(col); }
  const waterMask = new THREE.Mesh(mergeGeometries([H.mask(mainS, 0.035), H.mask(brS, 0.03)], false), M.mask); waterMask.name = 'waterMask'; object.add(waterMask);
  finishMeshes(object, waterMask);

  const crate = object.userData._crate; delete object.userData._crate;
  const netRest = new THREE.Object3D(); netRest.name = 'netRest'; netRest.position.set(-1.0, DECK + 0.025, -1.45); netRest.quaternion.setFromEuler(new THREE.Euler(0, Math.PI, 0)); object.add(netRest);
  const seats = {
    driver: V3(-0.26, 1.0825 + HIP, -1.03), fisher: V3(0.55, DECK + 0.355 + HIP, -2.75),
    passengers: [V3(0, DECK + 0.35 + HIP, CZF + 0.235), V3(0, BOW_DECK + 0.38 + HIP, 2.9), V3(-0.55, DECK + 0.36 + HIP, ZT + 0.285)],
  };
  let throttle = 0, steer = 0, propSpeed = 0, propAngle = 0;
  return {
    object, length: Z1 - ZA, beam: 2 * 1.47 + 0.08,
    seats, seatInfo: { canFaceAft: { driver: false, fisher: true, passengers: [false, false, false] } },
    helm: { kind: 'wheel', right: wheel.right, left: wheel.left }, tillerGrip: wheel.right,
    crate, netRest, waterMask,
    physics: { mass: 2900, thrust: 7200, halfLength: 4.8, beam: 3.0, draft: 0.56 },
    setThrottle(t) { throttle = clamp(t || 0, -1, 1); },
    setSteer(s) { steer = clamp(s || 0, -1, 1); wheel.spin.rotation.z = steer * 1.75; for (const mo of motors) mo.yaw.rotation.y = steer * 0.5; },
    setAnchor(d) { const on = !!d; anchorStowed.visible = !on; anchorRope.visible = on; },
    setPaint(hex) { const z = hullMat.userData.zones; if (hex == null) { z.uPaintAmt.value = 0; return; } z.uPaint.value.set(hex); z.uPaintAmt.value = 1; },
    setAccent(hex) { if (hex == null) return; accent.set(hex); hullMat.userData.zones.uAccent.value.set(hex); accentMat.color.set(hex); },
    update(dt = 0.016, time = performance.now() / 1000) {
      const target = throttle * 26 * Math.PI * 2;
      propSpeed += (target - propSpeed) * Math.min(1, dt * 2.5); propAngle += propSpeed * dt;
      const a = Math.abs(throttle), vib = (0.2 + a) * 0.0009;
      motors.forEach((mo, i) => { mo.prop.rotation.z = i ? -propAngle : propAngle; mo.body.position.set(Math.sin(time * 91 + i) * vib * 0.5, Math.sin(time * 127 + i * 2) * vib, 0); mo.body.rotation.set(0, 0, Math.sin(time * 67 + i) * vib * 1.2); });
      flag.update(time, a);
    },
  };
}

// ----------------------------------------------------------------------------
// public API
// ----------------------------------------------------------------------------
export const BOAT_TYPES = ['weidling', 'runabout', 'sportfisher'];

/** Build the shared textures/materials of every boat type up front (e.g. behind the loading screen), so the first
 *  switch to a new type costs only geometry (~50-150 ms). Safe to call more than once. */
export function preloadBoatAssets() { shared(); sharedRunabout(); sharedSportfisher(); }

/**
 * createBoat({ type = 'weidling' | 'runabout' | 'sportfisher', accent, paint, seed })
 * -> { object, type, length, beam,
 *      seats: { driver, fisher, passengers: [Vector3…] },  (hip positions, boat-local)
 *      seatInfo: { canFaceAft: { driver, fisher, passengers: [] } },
 *      helm: { kind: 'tiller' | 'wheel', right: Object3D, left: Object3D | null },  (hand targets, follow steering)
 *      tillerGrip (= helm.right), crate, netRest, waterMask,
 *      physics: { mass, thrust, halfLength, beam, draft },
 *      setThrottle(-1..1), setSteer(-1..1), setAnchor(bool), setPaint(hex | null), setAccent(hex), update(dt, time) }
 * Origin: hull centre on the design waterline, bow +Z. No scale is baked in.
 */
export function createBoat(opts = {}) {
  const type = BOAT_TYPES.includes(opts.type) ? opts.type : 'weidling';
  const build = type === 'runabout' ? buildRunabout : type === 'sportfisher' ? buildSportfisher : buildWeidling;
  const boat = build(opts);
  boat.type = type; boat.object.userData.boatType = type;
  if (opts.paint != null) boat.setPaint(opts.paint);
  return boat;
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
