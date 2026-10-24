// Alpenfisch — angler. Stylised-realistic figure built from smooth primitives and lofts,
// skinned rigidly (with soft weights at the waist and neck) to a small skeleton so the whole
// body is at most 8 draw calls (+ the name tag). Arms are posed with two-bone IK, the torso
// twists and the head turns toward the look direction; the legs blend seated -> standing and
// walk. The outfit (skin, hair, beard, hat, glasses, clothes, boots) is customisable, see
// ANGLER_OPTIONS, and can be swapped live with setOutfit().
//
// Local frame: origin = hip-joint centre, faces +Z, up +Y.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const band = (v, a, b, f) => smooth(a - f, a + f, v) * (1 - smooth(b - f, b + f, v));
const _c = new THREE.Color();
const lin = (hex) => { _c.set(hex); return [_c.r, _c.g, _c.b]; };
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const AO = (k) => [k, k, k];
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------------------------------------------------------------------------
// textures (greyscale ones are shared and cached; the plaid is per shirt colour)
// ---------------------------------------------------------------------------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function ctex(cv, srgb = true) { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; }
function greyTex(S, fn, srgb = true) {
  const cv = canvas(S, S), ctx = cv.getContext('2d'), im = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const k = 255 * clamp(fn(x, y), 0, 1); const i = (y * S + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = k; im.data[i + 3] = 255; }
  ctx.putImageData(im, 0, 0); return ctex(cv, srgb);
}
const TEX = {};
function weaveTexture() {
  if (TEX.weave) return TEX.weave;
  const r = rng(77);
  TEX.weave = greyTex(256, (x, y) => 0.86 * (((x >> 1) + (y >> 1)) % 2 ? 1 : 0.93) + 0.1 * r() + 0.04); TEX.weave.repeat.set(2, 2); return TEX.weave;
}
function fibreTexture() {
  if (TEX.fibre) return TEX.fibre;
  const r = rng(91), col = new Float32Array(128).map(() => r());
  TEX.fibre = greyTex(128, (x) => 0.6 + 0.4 * col[x] * (0.8 + 0.2 * r())); TEX.fibre.repeat.set(3, 1); return TEX.fibre;
}
// ribbed knit for the beanie: 8 ribs per tile with V-shaped stitches
function knitTexture() {
  if (TEX.knit) return TEX.knit;
  const r = rng(13);
  TEX.knit = greyTex(64, (x, y) => { const c = x % 8, rib = Math.sin(Math.PI * (c + 0.5) / 8); const st = ((y + Math.abs(c - 3.5)) % 6) / 6; return 0.5 + 0.42 * Math.pow(rib, 0.7) * (0.72 + 0.28 * Math.sin(Math.PI * st)) + (r() - 0.5) * 0.06; });
  return TEX.knit;
}
// basket-weave straw
function strawTexture() {
  if (TEX.straw) return TEX.straw;
  const r = rng(29);
  TEX.straw = greyTex(128, (x, y) => {
    const bx = x >> 4, by = y >> 4, alongX = (bx + by) % 2 === 0; const a = alongX ? y : x, b = alongX ? x : y;
    const strand = Math.sin(Math.PI * ((a % 4) + 0.5) / 4), edge = Math.min(a % 16, 15 - (a % 16)) < 1 ? 0.75 : 1;
    return (0.62 + 0.3 * strand + 0.08 * Math.sin(b * 0.7 + (a >> 2) * 2.1)) * edge + (r() - 0.5) * 0.08;
  });
  return TEX.straw;
}
// soft fabric creases as a tileable normal map (shared by all cloth materials)
function foldNormalTexture() {
  if (TEX.folds) return TEX.folds;
  const S = 128, T = Math.PI * 2, h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    // mostly horizontal creases (across sleeves, legs and torso) with a gentle wander
    h[y * S + x] = 0.55 * Math.sin(T * 3 * v + 1.1 * Math.sin(T * u)) + 0.3 * Math.sin(T * (5 * v + u) + 0.8 * Math.sin(T * 2 * u)) + 0.15 * Math.sin(T * (9 * v - u) + 1.5 * Math.sin(T * (u + v)));
  }
  const cv = canvas(S, S), ctx = cv.getContext('2d'), im = ctx.createImageData(S, S); const at = (x, y) => h[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const nx = -(at(x + 1, y) - at(x - 1, y)) * 4, ny = -(at(x, y + 1) - at(x, y - 1)) * 4, l = Math.hypot(nx, ny, 1); const i = (y * S + x) * 4;
    im.data[i] = 255 * (nx / l * 0.5 + 0.5); im.data[i + 1] = 255 * (ny / l * 0.5 + 0.5); im.data[i + 2] = 255 * (1 / l * 0.5 + 0.5); im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0); TEX.folds = ctex(cv, false); return TEX.folds;
}

// flannel plaid in the shirt colour
function plaidTexture(hex) {
  const S = 128, cv = canvas(S, S), ctx = cv.getContext('2d');
  const base = new THREE.Color(hex); const dark = base.clone().multiplyScalar(0.55); const light = base.clone().lerp(new THREE.Color(0xf2ece0), 0.35);
  ctx.fillStyle = '#' + base.getHexString(); ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = 0.55; ctx.fillStyle = '#' + dark.getHexString();
  ctx.fillRect(0, 40, S, 34); ctx.fillRect(40, 0, 34, S);
  ctx.globalAlpha = 0.5; ctx.fillStyle = '#' + light.getHexString();
  ctx.fillRect(0, 100, S, 5); ctx.fillRect(100, 0, 5, S);
  ctx.globalAlpha = 0.35; ctx.fillStyle = '#111';
  ctx.fillRect(0, 55, S, 3); ctx.fillRect(55, 0, 3, S);
  ctx.globalAlpha = 1;
  const im = ctx.getImageData(0, 0, S, S); const r = rng(5);
  for (let i = 0; i < S * S; i++) { const k = 0.88 + 0.12 * (((i % S) + ((i / S) | 0)) % 2) + (r() - 0.5) * 0.08; im.data[i * 4] *= k; im.data[i * 4 + 1] *= k; im.data[i * 4 + 2] *= k; }
  ctx.putImageData(im, 0, 0); return ctex(cv);
}

function nameTexture(text) {
  const cv = canvas(512, 128), ctx = cv.getContext('2d');
  ctx.font = 'bold 54px Arial, Helvetica, sans-serif';
  const w = Math.min(492, ctx.measureText(text).width + 56);
  ctx.fillStyle = 'rgba(16,28,32,0.62)';
  const x0 = 256 - w / 2, r = 30; ctx.beginPath(); ctx.moveTo(x0 + r, 22); ctx.arcTo(x0 + w, 22, x0 + w, 106, r); ctx.arcTo(x0 + w, 106, x0, 106, r); ctx.arcTo(x0, 106, x0, 22, r); ctx.arcTo(x0, 22, x0 + w, 22, r); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 66, 470);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------------------
// geometry helpers (bind-pose, angler-local coordinates)
// ---------------------------------------------------------------------------
// Normalise: indexed, position/normal/uv/color + skinIndex/skinWeight
function part(geo, { m = null, color = [1, 1, 1], bone = 0, weights = null, uv = null } = {}) {
  const g = geo.clone(); geo.dispose();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  g.morphAttributes = {}; g.clearGroups();
  if (!g.index) { const ix = []; for (let i = 0; i < g.attributes.position.count; i++) ix.push(i); g.setIndex(ix); }
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (uv) { const a = g.attributes.uv; for (let i = 0; i < n; i++) a.setXY(i, a.getX(i) * uv[0], a.getY(i) * uv[1]); }
  if (m) {
    g.applyMatrix4(m);
    if (m.determinant() < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
  }
  const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const p = g.attributes.position;
  for (let i = 0; i < n; i++) {
    const c = typeof color === 'function' ? color(p.getX(i), p.getY(i), p.getZ(i)) : color;
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    if (weights) { const w = weights(p.getX(i), p.getY(i), p.getZ(i)); si[i * 4] = w[0]; si[i * 4 + 1] = w[2]; sw[i * 4] = w[1]; sw[i * 4 + 1] = w[3]; }
    else { si[i * 4] = bone; sw[i * 4] = 1; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return g;
}

const M4 = (px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(V3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V3(sx, sy, sz));

// Tapered capsule from a to b (radii ra, rb).
function segment(a, b, ra, rb, radial = 14, rings = 6) {
  const L = a.distanceTo(b); const prof = [];
  for (let i = 0; i <= rings; i++) { const t = -Math.PI / 2 + (i / rings) * Math.PI / 2; prof.push(new THREE.Vector2(Math.cos(t) * ra, Math.sin(t) * ra)); }
  for (let i = 1; i <= 3; i++) { const t = i / 4; prof.push(new THREE.Vector2(lerp(ra, rb, t), L * t)); }
  for (let i = 0; i <= rings; i++) { const t = (i / rings) * Math.PI / 2; prof.push(new THREE.Vector2(Math.cos(t) * rb, L + Math.sin(t) * rb)); }
  const g = new THREE.LatheGeometry(prof, radial);
  const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a, q, V3(1, 1, 1)));
  return g;
}
// Re-map a segment's V to the distance along a->b (times k), so a texture (folds, weave) wraps the
// limb without concentric rings on the rounded end caps; U stays around the limb (x uScale).
function axisUV(g, a, b, k = 1, uScale = 1) {
  const d = b.clone().sub(a), L2 = d.lengthSq(), p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, uv.getX(i) * uScale, ((p.getX(i) - a.x) * d.x + (p.getY(i) - a.y) * d.y + (p.getZ(i) - a.z) * d.z) / L2 * k);
  return g;
}
const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg);

// Loft of elliptical rings (y, rx, rz, zOffset[, xOffset]). Angle 0 = +Z (front).
// gap: open front (radians each side); arc: [a0, a1] explicit angular range.
// sq < 1 gives a squarer (superellipse) section.
function ellipseLoft(rings, n = 28, { capBottom = false, capTop = false, gap = 0, arc = null, uScale = 1, vScale = 1, sq = 1 } = {}) {
  const pos = [], uv = [], idx = [];
  const a0 = arc ? arc[0] : gap, a1 = arc ? arc[1] : Math.PI * 2 - gap, open = !!(gap || arc), cols = n + 1;
  const sp = (v) => sq === 1 ? v : Math.sign(v) * Math.pow(Math.abs(v), sq);
  for (let i = 0; i < rings.length; i++) {
    const [y, rx, rz, zo, xo = 0] = rings[i];
    for (let j = 0; j < cols; j++) {
      const a = lerp(a0, a1, j / n);
      pos.push(xo + sp(Math.sin(a)) * rx, y, zo + sp(Math.cos(a)) * rz);
      uv.push((j / n) * uScale, y * vScale);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < n; j++) {
    const a = i * cols + j, b = (i + 1) * cols + j; idx.push(a, b + 1, b, a, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  // weld normals across the u seam
  if (!open) { const nn = g.attributes.normal; for (let i = 0; i < rings.length; i++) { const a = i * cols, b = i * cols + n; const v = V3(nn.getX(a) + nn.getX(b), nn.getY(a) + nn.getY(b), nn.getZ(a) + nn.getZ(b)).normalize(); nn.setXYZ(a, v.x, v.y, v.z); nn.setXYZ(b, v.x, v.y, v.z); } }
  const parts = [g];
  const cap = (ring, up) => {
    const [y, rx, rz, zo, xo = 0] = ring; const c = new THREE.CircleGeometry(1, n); c.scale(rx, rz, 1);
    c.rotateX(up ? -Math.PI / 2 : Math.PI / 2); c.translate(xo, y, zo); return c;
  };
  if (capBottom) parts.push(cap(rings[0], false));
  if (capTop) parts.push(cap(rings[rings.length - 1], true));
  return parts.length > 1 ? mergeGeometries(parts, false) : g;
}
// interpolated ring at height y, and a point on a loft surface (with its outward yaw)
function ringAt(rings, y) {
  for (let i = 0; i < rings.length - 1; i++) { const a = rings[i], b = rings[i + 1]; if (y <= b[0]) { const t = clamp((y - a[0]) / (b[0] - a[0]), 0, 1); return a.map((v, k) => lerp(v, b[k] ?? 0, t)); } }
  return rings[rings.length - 1];
}
function onLoft(rings, ang, y, out = 0.008) {
  const [, rx, rz, zo, xo = 0] = ringAt(rings, y); const x = xo + Math.sin(ang) * rx, z = zo + Math.cos(ang) * rz;
  const n = V3(Math.sin(ang) / rx, 0, Math.cos(ang) / rz).normalize();
  return { p: V3(x, y, z).addScaledVector(n, out), ry: Math.atan2(n.x, n.z) };
}
const grow = (rings, d) => rings.map(([y, rx, rz, zo, xo = 0]) => [y, rx + d, rz + d, zo, xo]);

// Two-bone IK in a common space. Returns elbow position and hinge axis.
function solveTwoBone(S, T, L1, L2, pole) {
  const d0 = T.clone().sub(S); let d = d0.length();
  const dir = d > 1e-6 ? d0.multiplyScalar(1 / d) : V3(0, -1, 0);
  d = clamp(d, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-4);
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d); const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  let perp = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-8) perp = V3(0, 0, -1).addScaledVector(dir, -dir.z);
  perp.normalize();
  const E = S.clone().addScaledVector(dir, a).addScaledVector(perp, h);
  const W = S.clone().addScaledVector(dir, d);
  const hinge = new THREE.Vector3().crossVectors(dir, perp).normalize();
  return { E, W, hinge };
}
const _m = new THREE.Matrix4();
function basisQuat(X, down, out) { // bone -Y along `down`, bone +X = X (orthonormalised)
  const Y = down.clone().negate().normalize(); const Xo = X.clone().addScaledVector(Y, -X.dot(Y)).normalize(); const Z = new THREE.Vector3().crossVectors(Xo, Y);
  _m.makeBasis(Xo, Y, Z); return out.setFromRotationMatrix(_m);
}

// ---------------------------------------------------------------------------
// skeleton layout (bind pose, angler-local)
// ---------------------------------------------------------------------------
const B_ROOT = 0, B_SPINE = 1, B_LOWER = 2, B_CHEST = 3, B_UPPER = 4, B_NECK = 5, B_NECKS = 6, B_HEAD = 7, B_HEADS = 8,
  B_UARM_L = 9, B_FARM_L = 10, B_UARM_R = 11, B_FARM_R = 12, B_THIGH_L = 13, B_SHIN_L = 14, B_THIGH_R = 15, B_SHIN_R = 16;
export const STAND_HIP_HEIGHT = 0.95; // hip origin above the ground when standing
const SPINE_P = V3(0, 0.06, -0.02), CHEST_P = V3(0, 0.28, -0.02), NECK_P = V3(0, 0.5, -0.03), HEAD_P = V3(0, 0.585, -0.02);
const SHOULDER = 0.172, SHOULDER_Y = 0.432, SHOULDER_Z = -0.03;
const L_UPPER = 0.29, L_FORE = 0.335; // forearm length measured to the grip centre in the fist
const HEAD_C = V3(0, 0.664, 0.0); // skull centre (absolute)
const EYE_P = V3(0, 0.681, 0.088);
const FOOT = { x: 0.13, y: -0.37, z: 0.42 };
const THIGH = 0.44, SHIN = 0.43;

// deformed sphere skull (absolute coordinates), inflate > 1 for hair / beard shells
function headGeometry(inflate = 1, ws = 30, hs = 22) {
  const g = new THREE.SphereGeometry(1, ws, hs); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < 0) { const t = -y; x *= 1 - 0.22 * Math.pow(t, 1.5); if (z > 0) z *= 1 - 0.06 * t; }
    if (y < -0.55 && z > 0.2) z += 0.08 * (-y - 0.55) * z;                        // chin
    if (z < 0) { z *= 1.06; y += 0.04 * (-z) * Math.max(0, y + 0.3); }            // occiput
    if (z > 0.55) z -= (z - 0.55) * 0.18;                                          // flatter face
    for (const s of [-1, 1]) {                                                     // eye sockets
      const d = Math.hypot(x - s * 0.36, y - 0.1); if (z > 0.4 && d < 0.24) z -= 0.07 * Math.pow(1 - d / 0.24, 2);
      const c = Math.hypot(x - s * 0.55, y + 0.12); if (z > 0.3 && c < 0.3) { z += 0.025 * (1 - c / 0.3); x += s * 0.02 * (1 - c / 0.3); } // cheekbones
      const b = Math.hypot(x - s * 0.36, y - 0.33); if (z > 0.5 && b < 0.22) z += 0.018 * (1 - b / 0.22);  // brow ridge
    }
    if (z > 0.5 && y < -0.35 && y > -0.75) z += 0.012 * (1 - Math.abs(x) / 0.6) * smooth(0.6, 0, Math.abs(x)); // mouth / chin roundness
    p.setXYZ(i, x * 0.088 * inflate + HEAD_C.x, y * 0.112 * inflate + HEAD_C.y, z * 0.1 * inflate + HEAD_C.z);
  }
  g.computeVertexNormals(); return g;
}

// Hair-like shell over the skull: where mask=1 it sits `thick` above the skin, where mask=0 it
// dives under the skin, so the edge blends in without a stair-stepped border. `thick` may be a
// function of the head-relative position (for volume on top or a fuller chin).
const HEAD_SEG = [36, 26]; // skull and every shell share one tessellation, so shells never cross the skin unevenly
function maskedShell(maskFn, thick, ws = HEAD_SEG[0], hs = HEAD_SEG[1]) {
  const g = headGeometry(1, ws, hs); const p = g.attributes.position; const m = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const rx = p.getX(i) - HEAD_C.x, ry = p.getY(i) - HEAD_C.y, rz = p.getZ(i) - HEAD_C.z;
    const k = m[i] = clamp(maskFn(rx, ry, rz), 0, 1); const th = typeof thick === 'function' ? thick(rx, ry, rz) : thick;
    const s = 0.96 + (0.04 + th) * k; // dives 4% under the skin where k=0: a steep, clean crossing
    p.setXYZ(i, HEAD_C.x + rx * s, HEAD_C.y + ry * s, HEAD_C.z + rz * s);
  }
  g.computeVertexNormals();
  const ix = g.index.array, keep = [];
  for (let i = 0; i < ix.length; i += 3) if (m[ix[i]] > 0.02 || m[ix[i + 1]] > 0.02 || m[ix[i + 2]] > 0.02) keep.push(ix[i], ix[i + 1], ix[i + 2]);
  g.setIndex(keep); return g;
}
// beard coverage (head-relative coordinates)
function beardMask(x, y, z) {
  const ax = Math.abs(x);
  const jaw = 1 - smooth(-0.062, -0.034, y);
  const side = smooth(0.046, 0.068, ax) * (1 - smooth(-0.012, 0.014, y));
  const tache = (1 - smooth(0.026, 0.034, ax)) * band(y, -0.053, -0.041, 0.003) * smooth(0.04, 0.06, z);
  const mouth = (1 - smooth(0.02, 0.028, ax)) * band(y, -0.07, -0.051, 0.003) * smooth(0.03, 0.05, z);
  return Math.max(Math.max(jaw, side) * (1 - mouth), tache) * smooth(-0.055, -0.03, z);
}
// hair coverage: back and sides (to under a hat), optionally the crown with a hairline
function hairMask(x, y, z, crown) {
  const sides = Math.max(1 - smooth(-0.02, 0.015, z), smooth(0.062, 0.074, Math.abs(x)) * (1 - smooth(0.025, 0.045, z)));
  if (!crown) return band(y, -0.058, 0.075, 0.008) * sides;
  const hl = lerp(0.03, 0.064, smooth(0.01, 0.07, z)) + 0.006 * smooth(0.012, 0.04, Math.abs(x)) * smooth(0.05, 0.08, z); // receding temples
  return Math.max(smooth(-0.066, -0.05, y) * sides, smooth(hl - 0.006, hl + 0.006, y));
}

// ---------------------------------------------------------------------------
// customisation options
// ---------------------------------------------------------------------------
const sw = (value, label) => ({ value, label });
/** Data description for a customisation UI. Colours are 0xRRGGBB numbers (CSS '#rrggbb' strings are accepted too). */
export const ANGLER_OPTIONS = [
  { id: 'skin', label: 'Skin tone', group: 'Face', type: 'color', default: 0xe6b393, seeded: true, swatches: [
    sw(0xf6dcc8, 'Porcelain'), sw(0xefc4a4, 'Fair'), sw(0xe6b393, 'Light'), sw(0xd9a47c, 'Light tan'), sw(0xc58b66, 'Tan'),
    sw(0xa9714b, 'Olive brown'), sw(0x8d5a3b, 'Brown'), sw(0x6e4430, 'Dark brown'), sw(0x523224, 'Deep'), sw(0x3c241a, 'Very deep')] },
  { id: 'hairStyle', label: 'Hair', group: 'Face', type: 'choice', default: 'short', choices: [
    sw('short', 'Short'), sw('long', 'Long'), sw('ponytail', 'Ponytail'), sw('bald', 'Bald')] },
  { id: 'hair', label: 'Hair colour', group: 'Face', type: 'color', default: 0x3b2a1d, seeded: true, swatches: [
    sw(0x1c1714, 'Black'), sw(0x3b2a1d, 'Dark brown'), sw(0x5a3e28, 'Brown'), sw(0x7d5634, 'Chestnut'), sw(0x9c7b52, 'Dark blond'),
    sw(0xc9a66b, 'Blond'), sw(0x9a4a26, 'Ginger'), sw(0x8a7d70, 'Grey'), sw(0xd2cdc4, 'White')] },
  { id: 'beard', label: 'Beard', group: 'Face', type: 'choice', default: 'none', seeded: true, choices: [
    sw('none', 'Clean-shaven'), sw('stubble', 'Stubble'), sw('short', 'Short beard'), sw('full', 'Full beard')] },
  { id: 'glasses', label: 'Glasses', group: 'Face', type: 'choice', default: 'sun', choices: [
    sw('sun', 'Sunglasses'), sw('round', 'Round glasses'), sw('none', 'None')] },
  { id: 'hatStyle', label: 'Hat', group: 'Headwear', type: 'choice', default: 'bucket', choices: [
    sw('bucket', 'Bucket hat'), sw('cap', 'Cap'), sw('beanie', 'Beanie'), sw('straw', 'Straw hat'), sw('none', 'No hat')] },
  { id: 'hat', label: 'Hat colour', group: 'Headwear', type: 'color', default: 0xc9b98f, disabledWhen: { hatStyle: ['none'] }, swatches: [
    sw(0xc9b98f, 'Sand'), sw(0xe2d3a6, 'Straw'), sw(0x5b6b3a, 'Olive'), sw(0x3d4a5c, 'Slate'), sw(0x2f4f7a, 'Navy'),
    sw(0x8a2f2a, 'Red'), sw(0xd9772b, 'Blaze orange'), sw(0x6b4a2e, 'Brown'), sw(0x3b3b3b, 'Charcoal'), sw(0xe8e2d4, 'Cream')] },
  { id: 'vestStyle', label: 'Outerwear', group: 'Clothing', type: 'choice', default: 'vest', choices: [
    sw('vest', 'Fishing vest'), sw('jacket', 'Jacket'), sw('none', 'Shirt only')] },
  { id: 'vest', label: 'Vest / jacket colour', group: 'Clothing', type: 'color', default: 0x5b6b3a, disabledWhen: { vestStyle: ['none'] }, swatches: [
    sw(0x5b6b3a, 'Olive'), sw(0x3f4a2e, 'Moss'), sw(0x8a7a55, 'Khaki'), sw(0x7a5b3a, 'Tan'), sw(0x6b4a2e, 'Brown'),
    sw(0x3d4a5c, 'Slate blue'), sw(0x2b3a52, 'Navy'), sw(0xa3542a, 'Rust'), sw(0xd9772b, 'Blaze orange'), sw(0x2b2f33, 'Black')] },
  { id: 'shirt', label: 'Shirt (flannel)', group: 'Clothing', type: 'color', default: 0x8a2f2a, swatches: [
    sw(0x8a2f2a, 'Red'), sw(0x6b2d3e, 'Burgundy'), sw(0x2f5f8a, 'Blue'), sw(0x2f4f7a, 'Navy'), sw(0x3f5a35, 'Forest'),
    sw(0xb8862e, 'Mustard'), sw(0x5d6b73, 'Slate'), sw(0x8c7a64, 'Oatmeal'), sw(0x2a2e33, 'Charcoal')] },
  { id: 'pants', label: 'Trousers', group: 'Clothing', type: 'color', default: 0x3d4038, swatches: [
    sw(0x3d4038, 'Charcoal'), sw(0x55603f, 'Olive'), sw(0x6f6a5c, 'Stone'), sw(0x7d6f52, 'Khaki'), sw(0x4b3a2a, 'Brown'),
    sw(0x2d3a4f, 'Dark denim'), sw(0x4a5d78, 'Denim'), sw(0x1f2124, 'Black')] },
  { id: 'boots', label: 'Boots', group: 'Clothing', type: 'color', default: 0x283326, swatches: [
    sw(0x283326, 'Wader green'), sw(0x1c1d1f, 'Black'), sw(0x5a3a24, 'Leather'), sw(0x8a6a44, 'Tan'), sw(0x3d4a5c, 'Navy'),
    sw(0x8a2f2a, 'Red'), sw(0xc9a227, 'Yellow')] },
];
const COLOR_KEYS = ANGLER_OPTIONS.filter(o => o.type === 'color').map(o => o.id);
const CHOICES = Object.fromEntries(ANGLER_OPTIONS.filter(o => o.type === 'choice').map(o => [o.id, o.choices.map(c => c.value)]));
const SEED_SKIN = [0xe6b393, 0xd9a47c, 0xc58b66, 0xefc4a4], SEED_HAIR = [0x3b2a1d, 0x5a3e28, 0x221c18, 0x8a7d70, 0x9c7b52];
const EYE_COLOURS = [0x4a6b8a, 0x5b3a22, 0x55704a, 0x7a5a2e, 0x3a2a1c];

function toHex(v, fb) {
  if (typeof v === 'number' && Number.isFinite(v)) return clamp(Math.round(v), 0, 0xffffff);
  if (typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v.trim())) return parseInt(v.trim().replace('#', ''), 16);
  if (v && v.isColor) return v.getHex();
  return fb;
}
/** Validate / complete an outfit (e.g. one received from another player). Unknown or invalid values fall back to `base`. */
export function normalizeOutfit(opts = {}, base = {}) {
  const out = {};
  for (const o of ANGLER_OPTIONS) {
    const fb = base[o.id] !== undefined ? base[o.id] : o.default;
    out[o.id] = o.type === 'color' ? toHex(opts?.[o.id], toHex(fb, o.default)) : (CHOICES[o.id].includes(opts?.[o.id]) ? opts[o.id] : (CHOICES[o.id].includes(fb) ? fb : o.default));
  }
  return out;
}
// seed-derived defaults (the look anglers had before customisation existed)
function seedDefaults(seed, R) {
  return {
    skin: SEED_SKIN[seed % 4], hair: SEED_HAIR[(seed >>> 3) % 5],
    beard: ((seed >>> 7) & 1) === 0 ? (R() < 0.5 ? 'full' : 'short') : 'none',
  };
}

// ---------------------------------------------------------------------------
// outfit geometry: everything in bind pose, grouped by material
// ---------------------------------------------------------------------------
const waist = (x, y) => { if (y < 0.1) { const w = smooth(-0.03, 0.1, y); return [B_ROOT, 1 - w, B_LOWER, w]; } const w = smooth(0.1, 0.27, y); return [B_LOWER, 1 - w, B_UPPER, w]; };
const H = (x, y, z) => HEAD_C.clone().add(V3(x, y, z));
const sph = (r, seg = 10) => new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2));
const SHIRT_RINGS = [[-0.04, 0.176, 0.124, 0.0], [-0.012, 0.184, 0.13, 0.004], [0.03, 0.175, 0.121, 0.01], [0.11, 0.157, 0.108, 0.02],
  [0.19, 0.16, 0.11, 0.022], [0.27, 0.17, 0.115, 0.016], [0.35, 0.18, 0.116, 0.006], [0.41, 0.19, 0.107, -0.008], [0.45, 0.188, 0.094, -0.018],
  [0.482, 0.15, 0.078, -0.024], [0.505, 0.085, 0.064, -0.028], [0.52, 0.06, 0.056, -0.028]];
const VEST_RINGS = [[0.0, 0.19, 0.136, 0.01], [0.08, 0.177, 0.126, 0.018], [0.16, 0.174, 0.125, 0.024], [0.24, 0.181, 0.129, 0.022],
  [0.32, 0.195, 0.132, 0.012], [0.395, 0.205, 0.126, 0.0], [0.445, 0.2, 0.11, -0.014], [0.49, 0.162, 0.094, -0.022]];
const JACKET_RINGS = [[-0.095, 0.192, 0.14, 0.004], [-0.06, 0.196, 0.143, 0.006], [0.0, 0.192, 0.139, 0.012], [0.08, 0.18, 0.13, 0.02], [0.16, 0.178, 0.13, 0.026],
  [0.24, 0.184, 0.133, 0.024], [0.32, 0.197, 0.135, 0.014], [0.395, 0.207, 0.129, 0.0], [0.445, 0.201, 0.113, -0.013], [0.485, 0.168, 0.097, -0.021], [0.505, 0.11, 0.086, -0.025]];

const COLLAR_PT = new THREE.Shape([new THREE.Vector2(-0.016, 0.0), new THREE.Vector2(0.018, 0.0), new THREE.Vector2(0.006, -0.044)]);
const FOOT_RINGS = [[-0.142, 0.012, 0.014, 0.0], [-0.135, 0.034, 0.033, 0.0], [-0.122, 0.046, 0.04, 0.0], [-0.095, 0.05, 0.0425, 0.0], [-0.04, 0.051, 0.0425, 0.0],
  [0.02, 0.052, 0.04, -0.0025], [0.07, 0.05, 0.033, -0.0095], [0.105, 0.046, 0.026, -0.0165], [0.128, 0.038, 0.02, -0.0225], [0.139, 0.024, 0.0145, -0.028], [0.143, 0.008, 0.008, -0.033]];
const SOLE_SHAPE = (() => { // plan outline (x, forward) following the foot rings, a little proud of the upper
  const side = FOOT_RINGS.slice(1, -1).map(([z, w]) => [w + 0.003, z]); const sh = new THREE.Shape();
  sh.moveTo(0, -0.146); for (const [x, z] of side) sh.lineTo(x, z); sh.lineTo(0, 0.147); for (const [x, z] of side.slice().reverse()) sh.lineTo(-x, z); sh.closePath(); return sh;
})();

// pocket with a flap on a loft surface
function pocket(list, rings, ang, y, w, h, bone, flapCol = AO(0.72), bodyCol = AO(0.93)) {
  const { p, ry } = onLoft(rings, ang, y, 0.009);
  list.push(part(new RoundedBoxGeometry(w, h, 0.02, 1, 0.006), { m: M4(p.x, p.y, p.z, 0, ry, 0), color: bodyCol, bone }));
  const f = onLoft(rings, ang, y + h / 2 - 0.012, 0.02);
  list.push(part(new RoundedBoxGeometry(w + 0.008, 0.03, 0.008, 1, 0.003), { m: M4(f.p.x, f.p.y, f.p.z, -0.1, f.ry, 0), color: flapCol, bone }));
}

function buildBody(G, o, legJoints) {
  const SK = lin(o.skin);
  // ---- pelvis (trousers), shirt torso, belt
  const pelvis = ellipseLoft([[-0.098, 0.13, 0.085, -0.01], [-0.085, 0.165, 0.118, 0.0], [-0.04, 0.18, 0.128, 0.0], [-0.02, 0.178, 0.126, 0.002]], 30, { capBottom: true, uScale: 4, vScale: 4 });
  G.pants.push(part(pelvis, { weights: waist, color: (x, y) => AO(0.74 + 0.26 * smooth(-0.1, -0.06, y)) }));
  const torso = ellipseLoft(SHIRT_RINGS, 30, { capTop: true, uScale: 6, vScale: 6 });
  G.shirt.push(part(torso, { weights: waist, color: (x, y, z) => {
    const a = Math.atan2(x, z - 0.01);
    const pit = smooth(0.3, 0.4, y) * (1 - smooth(0.45, 0.49, y)) * smooth(0.12, 0.18, Math.abs(x)); // armpits
    const gather = band(y, -0.04, 0.04, 0.02) * (0.5 + 0.5 * Math.cos(a * 9));                      // bunched above the belt
    return AO(1 - 0.3 * pit - 0.14 * gather - 0.12 * (1 - smooth(-0.04, -0.005, y)));
  } }));
  G.shirt.push(part((() => { const t = new THREE.TorusGeometry(0.068, 0.015, 6, 22); t.rotateX(Math.PI / 2); t.scale(1, 1, 0.88); return t; })(), { m: M4(0, 0.508, -0.026, 0.12, 0, 0), color: AO(0.85), bone: B_UPPER }));
  if (o.vestStyle !== 'jacket') {
    for (const s of [-1, 1]) G.shirt.push(part(new THREE.ExtrudeGeometry(COLLAR_PT, { depth: 0.004, bevelEnabled: false }), { m: M4(s * 0.026, 0.5, 0.044, -0.75, s * 0.32, s * 0.45, s, 1, 1), color: AO(0.9), bone: B_UPPER })); // collar points
    G.shirt.push(part(ellipseLoft(grow(SHIRT_RINGS.slice(0, 9), 0.003), 2, { arc: [-0.075, 0.075], uScale: 0.2, vScale: 6 }), { weights: waist, color: AO(0.93) })); // placket
    for (const y of [0.05, 0.14, 0.23, 0.32, 0.41]) { const { p, ry } = onLoft(SHIRT_RINGS, 0, y, 0.006); G.skin.push(part(sph(0.0058, 6), { m: M4(p.x, p.y, p.z, 0, ry, 0, 1, 1, 0.45), color: lin(0xb8ad98), weights: waist })); }
    // belt + buckle
    G.skin.push(part(ellipseLoft([[-0.047, 0.174, 0.123, 0.0], [-0.047, 0.185, 0.133, 0.001], [-0.017, 0.186, 0.134, 0.003], [-0.017, 0.177, 0.126, 0.003]], 30), { weights: waist, color: lin(0x3b2a1e) }));
    const b = onLoft([[-0.047, 0.185, 0.133, 0.001], [-0.017, 0.186, 0.134, 0.003]], 0, -0.032, 0.003);
    G.gloss.push(part(new RoundedBoxGeometry(0.04, 0.034, 0.006, 1, 0.004), { m: M4(b.p.x, b.p.y, b.p.z), color: lin(0x9a7d45), bone: B_ROOT }));
  }
  if (o.vestStyle === 'none') { // shirt chest pockets
    const flapBtn = [];
    for (const s of [-1, 1]) {
      pocket(G.shirt, SHIRT_RINGS, s * 0.55, 0.325, 0.072, 0.078, B_UPPER, AO(0.9), AO(0.97));
      const f = onLoft(SHIRT_RINGS, s * 0.55, 0.348, 0.024); flapBtn.push(part(sph(0.0048, 6), { m: M4(f.p.x, f.p.y, f.p.z, 0, f.ry, 0, 1, 1, 0.5), color: lin(0xb8ad98), bone: B_UPPER }));
    }
    G.skin.push(...flapBtn);
  }

  // ---- outerwear
  if (o.vestStyle === 'vest') {
    const GAP = 0.3;
    G.vest.push(part(ellipseLoft(VEST_RINGS, 30, { gap: GAP, uScale: 4, vScale: 4 }), { weights: waist, color: (x, y, z) => {
      const a = Math.abs(Math.atan2(x, z - 0.01)); const edge = a < GAP + 0.08 ? 0.55 : 1;
      return AO(edge * (1 - 0.18 * (1 - smooth(0.0, 0.03, y)) - 0.15 * smooth(0.44, 0.49, y) * smooth(0.12, 0.17, Math.abs(x))));
    } }));
    for (const s of [-1, 1]) for (const [ang, y, w, h] of [[0.62, 0.325, 0.085, 0.09], [0.66, 0.11, 0.1, 0.1]]) pocket(G.vest, VEST_RINGS, s * ang, y, w, h, y > 0.2 ? B_UPPER : B_LOWER);
    { const { p, ry } = onLoft(VEST_RINGS, -0.95, 0.4, 0.01); G.vest.push(part(new RoundedBoxGeometry(0.055, 0.045, 0.014, 1, 0.006), { m: M4(p.x, p.y, p.z, 0, ry, 0), color: [2.2, 2.1, 1.85], bone: B_UPPER })); } // fly patch
    { const r = onLoft(VEST_RINGS, 0.95, 0.43, 0.012); G.gloss.push(part(new THREE.TorusGeometry(0.012, 0.0028, 5, 12), { m: M4(r.p.x, r.p.y, r.p.z, 0, r.ry, 0), color: lin(0x8c8c88), bone: B_UPPER })); } // D-ring
  } else if (o.vestStyle === 'jacket') {
    G.vest.push(part(ellipseLoft(JACKET_RINGS, 30, { uScale: 4, vScale: 4 }), { weights: waist, color: (x, y) =>
      AO(1 - 0.22 * (1 - smooth(-0.085, -0.07, y)) - 0.15 * smooth(0.43, 0.49, y) * smooth(0.13, 0.18, Math.abs(x)) - 0.1 * band(y, -0.03, 0.03, 0.02)) }));
    G.vest.push(part(ellipseLoft([[0.46, 0.101, 0.092, -0.016], [0.5, 0.094, 0.086, -0.021], [0.535, 0.088, 0.08, -0.025], [0.54, 0.083, 0.075, -0.025]], 26, { gap: 0.34, uScale: 3, vScale: 4 }),
      { bone: B_UPPER, color: (x, y) => AO(0.9 - 0.12 * smooth(0.53, 0.54, y)) })); // stand-up collar
    G.gloss.push(part(ellipseLoft(grow(JACKET_RINGS.slice(0, 10), 0.0025), 2, { arc: [-0.03, 0.03] }), { weights: waist, color: lin(0x2b2b2b) })); // zip
    { const z = onLoft(JACKET_RINGS, 0, 0.47, 0.006); G.gloss.push(part(new RoundedBoxGeometry(0.012, 0.026, 0.004, 1, 0.0015), { m: M4(z.p.x, z.p.y - 0.012, z.p.z, -0.25, 0, 0), color: lin(0x50504c), bone: B_UPPER })); }
    for (const s of [-1, 1]) pocket(G.vest, JACKET_RINGS, s * 0.72, 0.03, 0.11, 0.1, B_LOWER, AO(0.8), AO(0.96));
    pocket(G.vest, JACKET_RINGS, 0.55, 0.32, 0.075, 0.07, B_UPPER, AO(0.8), AO(0.96));
  }

  // ---- arms (sleeves, skin hands), bind pose hanging straight down
  const sleeveAO = (S0, E0, s) => (x, y, z) => {
    const pit = smooth(S0.y - 0.08, S0.y - 0.01, y) * smooth(0.0, -0.035, s * (x - S0.x));
    const crease = (1 - smooth(0.0, 0.05, Math.abs(y - E0.y))) * smooth(0.0, 0.03, z - E0.z);
    return AO(1 - 0.28 * pit - 0.22 * crease);
  };
  const KN = [SK[0] * 1.03, SK[1] * 0.88, SK[2] * 0.86]; // knuckle / fingertip flush
  for (const s of [1, -1]) {
    const ua = s > 0 ? B_UARM_L : B_UARM_R, fa = s > 0 ? B_FARM_L : B_FARM_R;
    const S0 = V3(s * SHOULDER, SHOULDER_Y, SHOULDER_Z), E0 = S0.clone().add(V3(0, -L_UPPER, 0));
    const tgt = o.vestStyle === 'jacket' ? G.vest : G.shirt, j = o.vestStyle === 'jacket' ? 0.006 : 0;
    tgt.push(part(axisUV(segment(S0.clone(), E0, 0.054 + j, 0.045 + j, 14, 3), S0, E0, 2, 2.2), { bone: ua, color: sleeveAO(S0, E0, s) }));
    { const W0 = E0.clone().add(V3(0, -0.215 - j, 0)); tgt.push(part(axisUV(segment(E0, W0, 0.046 + j, 0.039 + j, 14, 3), E0, W0, 1.6, 1.8), { bone: fa, color: sleeveAO(S0, E0, s) })); }
    tgt.push(part(new THREE.CylinderGeometry(0.042 + j, 0.042 + j, 0.03, 14, 1, true), { m: M4(E0.x, E0.y - 0.222, E0.z), color: AO(j ? 0.7 : 0.8), bone: fa }));
    // wrist + fist: grip axis along local Z through (0, -L_FORE, 0)
    G.skin.push(part(segment(E0.clone().add(V3(0, -0.225, 0)), E0.clone().add(V3(0, -0.292, 0)), 0.029, 0.03, 10, 2), { color: SK, bone: fa }));
    const C = E0.clone().add(V3(0, -L_FORE, 0));
    const palm = new RoundedBoxGeometry(0.054, 0.084, 0.088, 2, 0.023); const pp = palm.attributes.position;
    for (let k = 0; k < pp.count; k++) { const x = pp.getX(k), y = pp.getY(k), z = pp.getZ(k); pp.setXYZ(k, x * (1 - 0.18 * smooth(0.0, 0.04, y)) + 0.004 * smooth(0.02, 0.04, y), y, z * (1 - 0.1 * smooth(0.01, 0.042, y))); } // narrower toward the wrist
    G.skin.push(part(palm, { m: M4(C.x + s * 0.004, C.y + 0.004, C.z, 0, 0, 0, s, 1, 1), color: (x, y) => mix(SK, KN, 0.7 * smooth(C.y - 0.018, C.y - 0.036, y)), bone: fa }));
    // fingers curled round the grip: pinky (k=0) .. index (k=3)
    const fl = [0.022, 0.028, 0.031, 0.029], fr = [0.0098, 0.011, 0.0116, 0.0113];
    for (let k = 0; k < 4; k++) {
      const z = -0.033 + k * 0.022, cy = C.y - 0.012 - (fl[k] - 0.03) * 0.4;
      G.skin.push(part(new THREE.CapsuleGeometry(fr[k], fl[k], 2, 8), { m: M4(C.x - s * 0.026, cy, C.z + z, 0, 0, s * 0.35), color: (x, y) => mix(mul(SK, 0.97), KN, 0.6 * smooth(cy - 0.004, cy - 0.022, y)), bone: fa }));
    }
    G.skin.push(part(segment(C.clone().add(V3(-s * 0.02, 0.03, 0.045)), C.clone().add(V3(-s * 0.03, -0.005, 0.053)), 0.0125, 0.0108, 8, 2), { color: SK, bone: fa })); // thumb
  }

  // ---- legs (bind pose = seated), boots
  for (const s of [1, -1]) {
    const { Hj, K, An } = legJoints[s];
    const tb = s > 0 ? B_THIGH_L : B_THIGH_R, sb = s > 0 ? B_SHIN_L : B_SHIN_R;
    const bis = Hj.clone().sub(K).normalize().add(An.clone().sub(K).normalize()).normalize(); // inside of the knee bend
    const legAO = (x, y, z) => {
      const d = V3(x, y, z).sub(K); const pit = (1 - smooth(0.02, 0.1, d.length())) * smooth(-0.01, 0.03, d.dot(bis));
      const crotch = (1 - smooth(0.02, 0.07, Math.abs(x))) * (1 - smooth(0.0, 0.12, V3(x, y, z).distanceTo(Hj)));
      return AO(1 - 0.3 * pit - 0.25 * crotch);
    };
    G.pants.push(part(axisUV(segment(Hj, K, 0.086, 0.064, 14, 4), Hj, K, 1.6, 2), { bone: tb, color: legAO }));
    G.pants.push(part(axisUV(segment(K, An, 0.06, 0.045, 14, 3), K, An, 1.6, 2), { bone: sb, color: legAO }));
    const top = K.clone().lerp(An, 0.42), dir = An.clone().sub(K).normalize(), L = top.distanceTo(An);
    G.boots.push(part(segment(top, An, 0.066, 0.057, 16, 3), { bone: sb, color: (x, y, z) => { const t = V3(x, y, z).sub(top).dot(dir) / L; return AO(1 - 0.12 * smooth(0.6, 0.95, t) + 0.06 * smooth(0.15, 0.0, t)); } }));
    G.boots.push(part(new THREE.TorusGeometry(0.066, 0.008, 5, 16), { m: new THREE.Matrix4().compose(top, new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), dir), V3(1, 1, 1)), color: AO(0.62), bone: sb }));
    // foot: squarish loft heel -> toe (flat underside, toe cap sloping down); rings: [along, halfW, halfH, centreY]
    const fm = M4(An.x, An.y - 0.036, An.z + 0.07, 0, s * 0.06, 0);
    const foot = ellipseLoft(FOOT_RINGS.map(([z, w, h, yc]) => [z, w, h, -yc]), 16, { capBottom: true, capTop: true, sq: 0.7 }); foot.rotateX(Math.PI / 2);
    G.boots.push(part(foot, { m: fm, bone: sb, color: (x, y, z) => AO(1 - 0.16 * smooth(-0.045, -0.07, y - An.y) - 0.1 * band(z - An.z, -0.02, 0.03, 0.02) * smooth(-0.02, 0.0, y - An.y)) }));
    // sole (dark rubber, independent of the boot colour) with a raised arch in front of the heel;
    // its underside stays at An.y - 0.082, which STAND_HIP_HEIGHT relies on
    const sole = new THREE.ExtrudeGeometry(SOLE_SHAPE, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 4 });
    sole.rotateX(Math.PI / 2); const sp = sole.attributes.position;
    for (let k = 0; k < sp.count; k++) if (sp.getY(k) < -0.012) sp.setY(k, sp.getY(k) + 0.007 * band(sp.getZ(k), -0.065, -0.015, 0.012));
    sole.computeVertexNormals();
    G.skin.push(part(sole, { m: M4(An.x, An.y - 0.065, An.z + 0.07, 0, s * 0.06, 0), color: (x, y) => mul(lin(0x2b2724), 1 - 0.3 * smooth(-0.075, -0.082, y - An.y)), bone: sb }));
  }
}

function buildHead(G, o, eyeHex) {
  const SK = lin(o.skin), HL = lin(o.hair);
  const hatTop = o.hatStyle === 'bucket' || o.hatStyle === 'beanie' || o.hatStyle === 'straw'; // crown hidden under the hat
  const tint = (c, k) => [SK[0] * c[0] * k, SK[1] * c[1] * k, SK[2] * c[2] * k];
  // ---- neck & skull
  G.skin.push(part(segment(V3(0, 0.47, -0.03), V3(0, 0.62, -0.016), 0.06, 0.055, 14, 3), { bone: B_NECKS, color: (x, y, z) => mul(SK, 1 - 0.16 * smooth(0.54, 0.6, y) * smooth(0.0, 0.04, z)) }));
  const headCol = (x, y, z) => {
    const rx = x - HEAD_C.x, ry = y - HEAD_C.y, rz = z - HEAD_C.z, ax = Math.abs(rx), front = smooth(0.02, 0.06, rz);
    const cheek = Math.max(0, 1 - Math.hypot(ax - 0.05, ry + 0.02) / 0.04) * front;
    const socket = Math.max(0, 1 - Math.hypot(ax - 0.032, ry - 0.009) / 0.024) * front;
    const jawShade = smooth(-0.07, -0.105, ry) * (1 - smooth(0.0, 0.05, rz)); // under the jaw
    let c = [SK[0] * (1 + 0.09 * cheek), SK[1] * (1 - 0.06 * cheek), SK[2] * (1 - 0.05 * cheek)];
    c = mul(c, 1 - 0.13 * socket - 0.15 * jawShade);
    if (o.beard !== 'none') { const b = beardMask(rx, ry, rz); c = mix(c, mul(HL, 0.8), o.beard === 'stubble' ? 0.42 * b : 0.8 * smooth(0.05, 0.55, b)); } // stubble / shadow under a beard
    if (o.hairStyle !== 'bald') c = mix(c, mul(HL, 0.8), 0.5 * hairMask(rx, ry, rz, !hatTop));
    return c;
  };
  G.skin.push(part(headGeometry(1, ...HEAD_SEG), { color: headCol, bone: B_HEADS }));
  // nose: tapered wedge (narrow bridge, fuller tip), soft tip with nostrils, alae
  {
    const n = new THREE.SphereGeometry(1, 12, 10); const q = n.attributes.position;
    for (let k = 0; k < q.count; k++) { const x = q.getX(k), y = q.getY(k), z = q.getZ(k); const t = (1 - y) / 2; q.setXYZ(k, x * 0.0155 * lerp(0.5, 1.05, t), y * 0.027, z * 0.019 * lerp(0.55, 1.0, t) + 0.006 * t); }
    n.computeVertexNormals();
    let p0 = H(0, -0.012, 0.088); G.skin.push(part(n, { m: M4(p0.x, p0.y, p0.z, -0.22, 0, 0), color: SK, bone: B_HEADS }));
    const tip = H(0, -0.034, 0.103);
    G.skin.push(part(sph(0.0118, 12), { m: M4(tip.x, tip.y, tip.z, 0, 0, 0, 1.15, 0.9, 1), bone: B_HEADS,
      color: (x, y, z) => mul(tint([1.02, 0.95, 0.94], 1), 1 - 0.55 * smooth(-0.005, -0.0095, y - tip.y) * smooth(0.002, 0.005, Math.abs(x - tip.x)) * smooth(0.01, 0.0, z - tip.z)) }));
    for (const s of [-1, 1]) { p0 = H(s * 0.0106, -0.0362, 0.0938); G.skin.push(part(sph(0.006, 8), { m: M4(p0.x, p0.y, p0.z, 0, s * 0.4, 0, 0.85, 0.8, 1), color: tint([1.01, 0.95, 0.94], 0.98), bone: B_HEADS })); }
  }
  // lips: thin upper, fuller lower (ellipsoids taper into the corners)
  {
    const lip = tint([0.86, 0.66, 0.64], 1); let p = H(0, -0.0562, 0.0874);
    G.skin.push(part(sph(1, 12), { m: M4(p.x, p.y, p.z, -0.3, 0, 0, 0.0158, 0.0036, 0.0056), color: (x, y) => mul(lip, 0.95 - 0.25 * smooth(p.y, p.y - 0.003, y)), bone: B_HEADS }));
    p = H(0, -0.0648, 0.0858);
    G.skin.push(part(sph(1, 12), { m: M4(p.x, p.y, p.z, 0.3, 0, 0, 0.0128, 0.0047, 0.0062), color: (x, y) => mul(lip, 1 - 0.2 * smooth(p.y, p.y + 0.004, y)), bone: B_HEADS }));
  }
  // eyes (hidden behind sunglasses, so skipped there): sclera, iris with pupil, upper and lower lids
  if (o.glasses !== 'sun') {
    const IR = lin(eyeHex), SC = lin(0xe6e0d6), lid = tint([0.97, 0.88, 0.86], 0.92), lash = [0.025, 0.02, 0.018];
    const front = (g) => { g.rotateX(Math.PI / 2); return g; }; // sphere pole -> +Z
    for (const s of [-1, 1]) {
      const c = H(s * 0.0315, 0.011, 0.0745), R0 = 0.0122;
      G.skin.push(part(front(new THREE.SphereGeometry(R0, 12, 6, 0, Math.PI * 2, 0, 1.75)), { m: M4(c.x, c.y, c.z), bone: B_HEADS,
        color: (x, y, z) => mul(SC, 0.84 - 0.2 * smooth(c.y - 0.002, c.y + 0.008, y) - 0.4 * smooth(0.9, 0.35, (z - c.z) / R0)) })); // shaded toward the rim
      const ip = V3(c.x, c.y, c.z + R0 - 0.0012), IRR = 0.0062;
      G.skin.push(part(front(new THREE.SphereGeometry(1, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2)), { m: M4(ip.x, ip.y, ip.z, 0, 0, 0, IRR, IRR, 0.0019), bone: B_HEADS, color: (x, y) => {
        const d = Math.hypot(x - ip.x, y - ip.y) / IRR; return d < 0.45 ? [0.006, 0.006, 0.006] : mul(IR, d > 0.86 ? 0.45 : 0.7 + 0.5 * (d - 0.45)); } }));
      for (const [up, tilt, half, r] of [[1, 0.2, 0.95, 0.0131], [-1, -0.45, 0.7, 0.0127]]) { // lids; open ~ +-24deg about the eye axis
        const g = new THREE.SphereGeometry(r, 12, up > 0 ? 4 : 2, 0, Math.PI * 2, up > 0 ? 0 : Math.PI - half, half);
        const pole = V3(0, up * Math.cos(tilt), up * Math.sin(tilt)); // cap pole after the tilt
        G.skin.push(part(g, { m: M4(c.x, c.y, c.z, tilt, 0, s * 0.06 * up), bone: B_HEADS, color: (x, y, z) => {
          const d = V3(x - c.x, y - c.y, z - c.z).normalize().dot(pole); return mix(lid, lash, (up > 0 ? 0.85 : 0.35) * smooth(Math.cos(half - 0.25), Math.cos(half), d)); } }));
      }
    }
  }
  // ears: flattened, cupped spheres (covered by long hair)
  if (o.hairStyle !== 'long') for (const s of [-1, 1]) {
    const e = new THREE.SphereGeometry(1, 10, 8); const q = e.attributes.position;
    for (let k = 0; k < q.count; k++) { const x = q.getX(k), y = q.getY(k), z = q.getZ(k); if (x > 0) q.setX(k, x - 0.75 * Math.max(0, 1 - (y * y) / 0.5 - ((z + 0.05) ** 2) / 0.4) * x); }
    e.computeVertexNormals(); const p = H(s * 0.087, -0.004, -0.006);
    G.skin.push(part(e, { m: M4(p.x, p.y, p.z, 0, s * 0.35, s * 0.08, s * 0.011, 0.028, 0.018), color: tint([0.97, 0.86, 0.84], 1), bone: B_HEADS }));
  }

  // ---- hair
  const neckW = (y0, y1) => (x, y) => { const w = 0.6 * smooth(y0, y1, y); return [B_HEADS, 1 - w, B_NECKS, w]; };
  if (o.hairStyle !== 'bald') {
    const crown = !hatTop;
    const thick = o.hairStyle === 'ponytail' ? (x, y) => 0.012 + 0.01 * smooth(0.03, 0.1, y)
      : o.hairStyle === 'long' ? (x, y) => 0.014 + 0.035 * smooth(0.0, 0.1, y)
      : (x, y, z) => 0.012 + (crown ? (o.hatStyle === 'cap' ? 0.012 : 0.05) * smooth(0.03, 0.1, y) * (0.7 + 0.3 * smooth(-0.05, 0.06, z)) : 0);
    G.hair.push(part(maskedShell((x, y, z) => hairMask(x, y, z, crown), thick), { color: (x, y) => AO(1 - 0.15 * smooth(HEAD_C.y - 0.02, HEAD_C.y - 0.06, y)), bone: B_HEADS }));
  }
  if (o.hairStyle === 'long') { // curtain hanging to the collar, open over the face, with a turned-in lip
    const rings = [[0.012, 0.085, 0.098, -0.006], [-0.03, 0.095, 0.108, -0.01], [-0.08, 0.098, 0.106, -0.018], [-0.125, 0.095, 0.098, -0.026], [-0.152, 0.088, 0.088, -0.032],
      [-0.149, 0.079, 0.079, -0.032], [-0.11, 0.08, 0.086, -0.024]].map(([y, rx, rz, zo]) => [y + HEAD_C.y, rx, rz, zo + HEAD_C.z]);
    G.hair.push(part(ellipseLoft(rings, 26, { gap: 1.0, uScale: 3, vScale: 7 }), { weights: neckW(HEAD_C.y - 0.04, HEAD_C.y - 0.15), color: (x, y) => AO(1 - 0.25 * smooth(HEAD_C.y - 0.1, HEAD_C.y - 0.15, y)) }));
  }
  if (o.hairStyle === 'ponytail') {
    const a = H(0, -0.004, -0.1), m = H(0, -0.05, -0.124), b = H(0, -0.15, -0.118);
    G.hair.push(part(segment(a, m, 0.018, 0.024, 10, 3), { bone: B_HEADS, uv: [2, 3] }));
    G.hair.push(part(segment(m, b, 0.024, 0.007, 10, 3), { weights: neckW(HEAD_C.y - 0.06, HEAD_C.y - 0.14), uv: [2, 3], color: (x, y) => AO(1 - 0.2 * smooth(m.y, b.y, y)) }));
    const t = a.clone().lerp(m, 0.35);
    G.hair.push(part(new THREE.TorusGeometry(0.019, 0.0045, 5, 12), { m: new THREE.Matrix4().compose(t, new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), m.clone().sub(a).normalize()), V3(1, 1, 1)), color: AO(0.25), bone: B_HEADS }));
  }
  for (const s of [-1, 1]) { const p = H(s * 0.034, 0.036, 0.0935); G.hair.push(part(new RoundedBoxGeometry(0.033, 0.0065, 0.009, 1, 0.003), { m: M4(p.x, p.y, p.z, 0, s * 0.22, -s * 0.12), color: AO(0.7), bone: B_HEADS })); } // eyebrows
  if (o.beard === 'short' || o.beard === 'full') {
    const th = o.beard === 'full' ? (x, y, z) => 0.022 + 0.13 * smooth(-0.045, -0.11, y) * smooth(-0.03, 0.03, z) + 0.03 * smooth(-0.02, -0.06, y) : 0.011;
    G.hair.push(part(maskedShell(beardMask, th), { color: AO(0.92), bone: B_HEADS }));
  }

  // ---- glasses
  const frame = lin(0x0d0f12);
  if (o.glasses === 'sun') {
    for (const s of [-1, 1]) {
      const p = H(s * 0.034, 0.016, 0.1);
      const ls = new THREE.Shape(); const w = 0.025, h = 0.017, r = 0.011;
      ls.moveTo(-w + r, h); ls.lineTo(w - r, h); ls.quadraticCurveTo(w, h, w, h - r); ls.lineTo(w, -h + r * 0.6); ls.quadraticCurveTo(w, -h, w - r * 1.2, -h);
      ls.lineTo(-w + r * 1.2, -h); ls.quadraticCurveTo(-w, -h, -w, -h + r * 0.6); ls.lineTo(-w, h - r); ls.quadraticCurveTo(-w, h, -w + r, h);
      const lens = new THREE.ExtrudeGeometry(ls, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 5 });
      G.gloss.push(part(lens, { m: M4(p.x, p.y, p.z, 0.04, s * 0.2, 0), color: frame, bone: B_HEADS }));
      G.gloss.push(part(segment(H(s * 0.06, 0.022, 0.09), H(s * 0.089, 0.018, -0.005), 0.0028, 0.0025, 5, 1), { color: frame, bone: B_HEADS }));
    }
    const p = H(0, 0.026, 0.104); G.gloss.push(part(new THREE.BoxGeometry(0.02, 0.005, 0.004), { m: M4(p.x, p.y, p.z), color: frame, bone: B_HEADS }));
  } else if (o.glasses === 'round') {
    const wire = lin(0x6e5a36);
    for (const s of [-1, 1]) {
      const p = H(s * 0.031, 0.011, 0.0985);
      G.gloss.push(part(new THREE.TorusGeometry(0.0158, 0.0013, 4, 20), { m: M4(p.x, p.y, p.z, 0, s * 0.12, 0), color: wire, bone: B_HEADS }));
      G.gloss.push(part(segment(H(s * 0.0465, 0.014, 0.096), H(s * 0.089, 0.018, -0.005), 0.0012, 0.0012, 4, 1), { color: wire, bone: B_HEADS }));
    }
    const p = H(0, 0.014, 0.1); const br = new THREE.TorusGeometry(0.0072, 0.0012, 4, 8, Math.PI);
    G.gloss.push(part(br, { m: M4(p.x, p.y, p.z), color: wire, bone: B_HEADS }));
  }

  // ---- hats (all lathes around the skull axis, squeezed to the head's width)
  const hatM = (y, z, tilt, sx = 0.94, sz = 1) => { const p = H(0, y, z); return { p, m: M4(p.x, p.y, p.z, tilt, 0, 0, sx, 1, sz) }; };
  if (o.hatStyle === 'bucket') {
    const { p, m } = hatM(0.058, -0.008, -0.08);
    G.hat.push(part(lathe([[0.001, 0.112], [0.05, 0.11], [0.074, 0.104], [0.087, 0.09], [0.093, 0.065], [0.097, 0.04], [0.099, 0.03], [0.1, 0.012],
      [0.12, 0.004], [0.145, -0.009], [0.166, -0.022], [0.17, -0.028], [0.163, -0.026], [0.145, -0.015], [0.12, -0.004], [0.103, 0.005]], 30),
      { m, color: (x, y) => { const ry = y - p.y; return (ry > 0.012 && ry < 0.031) ? [0.45, 0.42, 0.38] : AO(1); }, bone: B_HEADS }));
  } else if (o.hatStyle === 'straw') {
    const { p, m } = hatM(0.054, -0.008, -0.08);
    G.hat.push(part(lathe([[0.001, 0.09], [0.03, 0.097], [0.06, 0.1], [0.08, 0.094], [0.09, 0.075], [0.094, 0.05], [0.097, 0.03], [0.1, 0.012],
      [0.12, 0.006], [0.15, 0.0], [0.18, -0.006], [0.205, -0.013], [0.22, -0.02], [0.226, -0.024], [0.219, -0.023], [0.2, -0.016], [0.17, -0.008], [0.14, -0.001], [0.105, 0.006]], 32),
      { m, uv: [10, 3], color: (x, y) => { const ry = y - p.y; return (ry > 0.011 && ry < 0.032) ? [0.32, 0.22, 0.16] : AO(1); }, bone: B_HEADS }));
  } else if (o.hatStyle === 'cap') {
    const { p, m } = hatM(0.042, -0.012, -0.2, 0.94, 1.06);
    G.hat.push(part(lathe([[0.001, 0.08], [0.03, 0.078], [0.058, 0.068], [0.08, 0.05], [0.094, 0.028], [0.1, 0.006], [0.1, -0.012]], 30), { m, bone: B_HEADS,
      color: (x, y, z) => AO(1 - 0.3 * smooth(0.12, 0.0, Math.abs(Math.sin(3 * Math.atan2((x - p.x) / 0.94, (z - p.z) / 1.06)))) * smooth(-0.01, 0.03, y - p.y)) }));
    G.hat.push(part(sph(0.0075, 8), { m: m.clone().multiply(M4(0, 0.079, 0, 0, 0, 0, 1, 0.45, 1)), color: AO(0.85), bone: B_HEADS }));
    const vs = new THREE.Shape(), N = 12, F = 1.25;
    for (let i = 0; i <= N; i++) { const f = lerp(-F, F, i / N); const x = Math.sin(f) * 0.1, y = Math.cos(f) * 0.1; i ? vs.lineTo(x, y) : vs.moveTo(x, y); }
    for (let i = N - 1; i >= 1; i--) { const f = lerp(-F, F, i / N); const ext = 0.078 * Math.pow(1 - (f / F) ** 2, 0.55); vs.lineTo(Math.sin(f) * (0.1 + ext * 0.25), Math.cos(f) * 0.1 + ext); }
    vs.closePath();
    const visor = new THREE.ExtrudeGeometry(vs, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1, curveSegments: 1 });
    visor.rotateX(Math.PI / 2); const vp = visor.attributes.position;
    for (let k = 0; k < vp.count; k++) { const x = vp.getX(k), z = vp.getZ(k); vp.setY(k, vp.getY(k) - 2.2 * x * x - 0.35 * Math.max(0, z - 0.085)); }
    visor.computeVertexNormals();
    G.hat.push(part(visor, { m: m.clone().multiply(M4(0, -0.007, 0)), color: AO(0.9), bone: B_HEADS }));
  } else if (o.hatStyle === 'beanie') { // knit shell hugging the skull, edge on a tilted plane, rolled cuff, slouch on top
    const edge = (y, z) => y - (0.009 + 0.46 * z);
    const g = maskedShell((x, y, z) => smooth(-0.004, 0.004, edge(y, z)), (x, y, z) => 0.085 + 0.045 * band(edge(y, z), 0.0, 0.028, 0.006) + 0.09 * smooth(0.07, 0.115, y));
    G.hat.push(part(g, { uv: [28, 5], bone: B_HEADS, color: (x, y, z) => AO(1 - 0.14 * band(edge(y - HEAD_C.y, z - HEAD_C.z), 0.0, 0.028, 0.004)) }));
  }
}

// one material per group; returns the textures it created that belong to it alone
function makeMaterials(o) {
  const plaid = plaidTexture(o.shirt), folds = foldNormalTexture(), weave = weaveTexture();
  const hatMap = o.hatStyle === 'beanie' ? knitTexture() : o.hatStyle === 'straw' ? strawTexture() : weave;
  const cloth = (extra) => new THREE.MeshStandardMaterial({ vertexColors: true, normalMap: folds, normalScale: new THREE.Vector2(0.35, 0.35), ...extra });
  const mats = {
    skin: new THREE.MeshStandardMaterial({ name: 'skin', vertexColors: true, roughness: 0.58 }),
    shirt: cloth({ name: 'shirt', map: plaid, roughness: 0.88 }),
    vest: cloth({ name: 'vest', color: o.vest, map: weave, roughness: o.vestStyle === 'jacket' ? 0.78 : 0.92, side: THREE.DoubleSide, normalScale: new THREE.Vector2(0.3, 0.3) }),
    pants: cloth({ name: 'pants', color: o.pants, map: weave, roughness: 0.9, normalScale: new THREE.Vector2(0.2, 0.2) }),
    boots: new THREE.MeshStandardMaterial({ name: 'boots', color: o.boots, vertexColors: true, roughness: 0.38 }),
    hat: new THREE.MeshStandardMaterial({ name: 'hat', color: o.hat, map: hatMap, vertexColors: true, roughness: o.hatStyle === 'straw' ? 0.85 : 0.95, side: THREE.DoubleSide }),
    hair: new THREE.MeshStandardMaterial({ name: 'hair', color: o.hair, map: fibreTexture(), vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
    gloss: new THREE.MeshStandardMaterial({ name: 'gloss', vertexColors: true, roughness: 0.08, metalness: 0.7 }),
  };
  return { mats, textures: [plaid] };
}

/**
 * Angler figure. opts: outfit keys from ANGLER_OPTIONS (skin, hair, hairStyle, beard, hatStyle, hat,
 * glasses, shirt, vest, vestStyle, pants, boots) plus name and seed. Anything left out keeps the
 * classic look; skin, hair colour and beard default from the seed (hash of the name).
 */
export function createAngler(opts = {}) {
  let nameText = opts.name ?? 'Angler';
  const seed = (opts.seed ?? hashStr(nameText)) >>> 0;
  const R = rng(seed);
  let outfit = normalizeOutfit(opts, seedDefaults(seed, R));
  const eyeHex = EYE_COLOURS[(seed >>> 11) % EYE_COLOURS.length];

  const object = new THREE.Group(); object.name = 'angler';
  // ---- skeleton
  const bones = [];
  const mk = (parent, p) => { const b = new THREE.Bone(); b.position.copy(p); b.rotation.order = 'YXZ'; if (parent != null) bones[parent].add(b); bones.push(b); return b; };
  mk(null, V3());
  mk(B_ROOT, SPINE_P);
  mk(B_SPINE, V3());
  mk(B_SPINE, CHEST_P.clone().sub(SPINE_P));
  mk(B_CHEST, V3());
  mk(B_CHEST, NECK_P.clone().sub(CHEST_P));
  mk(B_NECK, V3());
  mk(B_NECK, HEAD_P.clone().sub(NECK_P));
  mk(B_HEAD, V3());
  mk(B_CHEST, V3(SHOULDER, SHOULDER_Y, SHOULDER_Z).sub(CHEST_P));
  mk(B_UARM_L, V3(0, -L_UPPER, 0));
  mk(B_CHEST, V3(-SHOULDER, SHOULDER_Y, SHOULDER_Z).sub(CHEST_P));
  mk(B_UARM_R, V3(0, -L_UPPER, 0));
  // legs: bind pose is the seated pose; standing/walking rotates these bones
  const legJoints = {};
  for (const s of [1, -1]) {
    const Hj = V3(s * 0.095, 0, 0.02), A = V3(s * FOOT.x, FOOT.y, FOOT.z);
    const { E: K, W: An } = solveTwoBone(Hj, A, THIGH, SHIN, V3(0, 1, 0.35));
    legJoints[s] = { Hj, K, An };
    mk(B_ROOT, Hj);
    mk(s > 0 ? B_THIGH_L : B_THIGH_R, K.clone().sub(Hj));
  }
  object.add(bones[0]);
  object.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones); // inverses from the bind pose, object at the origin
  const BIND = new THREE.Matrix4();           // so every mesh binds with identity, now or after a rebuild

  // ---- meshes (rebuilt by setOutfit)
  let meshes = [], ownTextures = [];
  function disposeMeshes() {
    for (const m of meshes) { object.remove(m); m.geometry.dispose(); m.material.dispose(); }
    for (const t of ownTextures) t.dispose();
    meshes = []; ownTextures = [];
  }
  function build() {
    disposeMeshes();
    const G = { skin: [], shirt: [], vest: [], pants: [], boots: [], hat: [], hair: [], gloss: [] };
    buildBody(G, outfit, legJoints);
    buildHead(G, outfit, eyeHex);
    const { mats, textures } = makeMaterials(outfit); ownTextures = textures;
    for (const k of Object.keys(G)) {
      if (!G[k].length) { mats[k].dispose(); continue; }
      const geo = mergeGeometries(G[k], false); for (const g of G[k]) g.dispose(); geo.computeBoundingSphere();
      const mesh = new THREE.SkinnedMesh(geo, mats[k]); mesh.name = 'angler-' + k;
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      object.add(mesh); mesh.bind(skeleton, BIND); meshes.push(mesh);
    }
  }
  build();

  // ---- anchors, name tag
  const head = new THREE.Object3D(); head.name = 'eyes'; head.position.copy(EYE_P).sub(HEAD_P); bones[B_HEAD].add(head);
  const tagMat = new THREE.SpriteMaterial({ map: nameTexture(nameText), transparent: true, depthWrite: false });
  const tag = new THREE.Sprite(tagMat); tag.scale.set(0.6, 0.15, 1); tag.renderOrder = 10; tag.name = 'nameTag'; object.add(tag);

  // ---- state
  const look = { yaw: 0, pitch: 0 }; let fp = false; let time = R() * 10;
  const gait = { stand: 0, standT: 0, phase: 0, amount: 0 };
  const legQ = { t: new THREE.Quaternion(), s: new THREE.Quaternion(), tmp: new THREE.Quaternion() };
  const targets = { L: null, R: null };
  const rest = { L: V3(0.14, 0.1, 0.34), R: V3(-0.14, 0.1, 0.34) };
  const tmpT = V3(), invChest = new THREE.Matrix4(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), hp = V3();
  const dT = V3(), dS = V3(), tT = V3(), tS = V3();
  const shells = [B_LOWER, B_UPPER, B_NECKS, B_HEADS];

  function pose() {
    const ty = clamp(look.yaw * 0.62, -1.22, 1.22), hy = clamp(look.yaw - ty, -1.45, 1.45);
    const pitch = clamp(look.pitch, -1.2, 1.0);
    const br = Math.sin(time * 1.55);
    bones[B_SPINE].rotation.set(-pitch * 0.05 + 0.03 + br * 0.006, ty * 0.35, Math.sin(time * 0.6) * 0.012);
    bones[B_CHEST].rotation.set(-pitch * 0.12 + 0.02, ty * 0.65, Math.sin(time * 0.45 + 1) * 0.008);
    bones[B_NECK].rotation.set(-pitch * 0.3 - 0.05, hy * 0.35, 0);
    bones[B_HEAD].rotation.set(-pitch * 0.55 + 0.03, hy * 0.65, Math.sin(time * 0.33) * 0.015);
    if (!fp) bones[B_UPPER].scale.set(1 + br * 0.006, 1, 1 + br * 0.014);
    poseLegs();
  }
  // Blend seated bind pose -> standing, with a walk cycle (phase in radians, amount 0..1).
  function poseLegs() {
    const k = gait.stand;
    for (const s of [1, -1]) {
      const { Hj, K, An } = legJoints[s];
      const thigh = bones[s > 0 ? B_THIGH_L : B_THIGH_R], shin = bones[s > 0 ? B_SHIN_L : B_SHIN_R];
      if (k <= 0.001) { thigh.quaternion.identity(); shin.quaternion.identity(); continue; }
      const ph = gait.phase + (s > 0 ? 0 : Math.PI);
      const swing = Math.sin(ph) * 0.42 * gait.amount;                    // thigh forward/back
      const bend = Math.max(0, Math.cos(ph)) * 0.75 * gait.amount + 0.04; // knee flexes during the swing phase
      dT.copy(K).sub(Hj).normalize(); dS.copy(An).sub(K).normalize();
      tT.set(0, -Math.cos(swing), Math.sin(swing));
      tS.set(0, -Math.cos(swing - bend), Math.sin(swing - bend));
      legQ.t.setFromUnitVectors(dT, tT);
      legQ.s.setFromUnitVectors(dS, tS);
      thigh.quaternion.identity().slerp(legQ.t, k);
      // shin is a child of the thigh: local = thigh^-1 * world
      legQ.tmp.identity().slerp(legQ.s, k);
      shin.quaternion.copy(thigh.quaternion).invert().multiply(legQ.tmp);
    }
  }
  function solveArm(side) {
    const s = side === 'L' ? 1 : -1;
    const ua = bones[s > 0 ? B_UARM_L : B_UARM_R], fa = bones[s > 0 ? B_FARM_L : B_FARM_R];
    if (targets[side]) tmpT.copy(targets[side]); else object.localToWorld(tmpT.copy(rest[side]));
    invChest.copy(bones[B_CHEST].matrixWorld).invert();
    tmpT.applyMatrix4(invChest);
    const S = ua.position;
    const pole = V3(s * 0.55, -1, -0.45);
    const { E, W, hinge } = solveTwoBone(S, tmpT, L_UPPER, L_FORE, pole);
    basisQuat(hinge, E.clone().sub(S), q1); ua.quaternion.copy(q1);
    basisQuat(hinge, W.clone().sub(E), q2); fa.quaternion.copy(q1.invert().multiply(q2));
  }

  const api = {
    object, head,
    setLook(yaw = 0, pitch = 0) { look.yaw = yaw || 0; look.pitch = pitch || 0; },
    setHandTargets(rightWorld, leftWorld) { targets.R = rightWorld ? (targets.R || V3()).copy(rightWorld) : null; targets.L = leftWorld ? (targets.L || V3()).copy(leftWorld) : null; },
    // 'sit' (default) or 'stand'; walk(phase, amount) drives the gait while standing
    setStance(stance) { gait.standT = stance === 'stand' ? 1 : 0; },
    setWalk(phase, amount) { gait.phase = phase; gait.amount = clamp(amount, 0, 1); },
    get standing() { return gait.stand > 0.5; },
    setFirstPerson(on) {
      fp = !!on; for (const b of shells) bones[b].scale.setScalar(fp ? 1e-4 : 1);
      tag.visible = !fp && !!nameText;
    },
    setName(text) { nameText = text ? String(text) : ''; tagMat.map?.dispose(); tagMat.map = nameText ? nameTexture(nameText) : null; tagMat.needsUpdate = true; tag.visible = !fp && !!nameText; },
    /** Apply outfit changes live (partial objects merge into the current outfit). Rebuilds the meshes; object, head and the pose are kept. */
    setOutfit(next = {}) {
      const merged = { ...outfit }; for (const [k, v] of Object.entries(next || {})) if (v !== undefined && v !== null) merged[k] = v;
      const o = normalizeOutfit(merged, outfit);
      if (next && typeof next.name === 'string') api.setName(next.name);
      if (ANGLER_OPTIONS.every(d => o[d.id] === outfit[d.id]) && meshes.length) return api;
      outfit = o; build(); return api;
    },
    /** The current, fully resolved outfit (safe to serialise and send to other players). */
    getOutfit() { return { ...outfit }; },
    /** Free GPU resources (meshes, materials, name tag). The object should be removed from the scene first. */
    dispose() { disposeMeshes(); tagMat.map?.dispose(); tagMat.dispose(); skeleton.dispose(); },
    update(dt = 0.016) {
      time += dt;
      gait.stand += clamp(gait.standT - gait.stand, -dt * 4, dt * 4);
      pose();
      object.updateMatrixWorld(true);
      solveArm('R'); solveArm('L');
      bones[B_HEAD].getWorldPosition(hp); object.worldToLocal(hp); tag.position.set(hp.x, hp.y + 0.32, hp.z);
    },
  };
  api.update(0);
  return api;
}
