// Alpenfisch — seated angler. Stylised-realistic figure built from smooth
// primitives and lofts, skinned rigidly (with soft weights at the waist) to a small
// skeleton so the whole body is only a handful of draw calls. Arms are posed with
// two-bone IK, the torso twists and the head turns toward the look direction.
//
// Local frame: origin = seated hip-joint centre, faces +Z, up +Y.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const _c = new THREE.Color();
const lin = (hex) => { _c.set(hex); return [_c.r, _c.g, _c.b]; };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------------------------------------------------------------------------
// textures
// ---------------------------------------------------------------------------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function ctex(cv, srgb = true) { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; }

let WEAVE = null, FIBRE = null;
function weaveTexture() {
  if (WEAVE) return WEAVE;
  const S = 256, cv = canvas(S, S), ctx = cv.getContext('2d'), im = ctx.createImageData(S, S); const r = rng(77);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const w = ((x >> 1) + (y >> 1)) % 2 ? 1 : 0.93;
    const k = 255 * clamp(0.86 * w + 0.1 * r() + 0.04, 0, 1); const i = (y * S + x) * 4;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = k; im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0); WEAVE = ctex(cv); WEAVE.repeat.set(2, 2); return WEAVE;
}
function fibreTexture() {
  if (FIBRE) return FIBRE;
  const S = 128, cv = canvas(S, S), ctx = cv.getContext('2d'), im = ctx.createImageData(S, S); const r = rng(91);
  const col = new Float32Array(S).map(() => r());
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const k = 255 * clamp(0.6 + 0.4 * col[x] * (0.8 + 0.2 * r()), 0, 1); const i = (y * S + x) * 4;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = k; im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0); FIBRE = ctex(cv); FIBRE.repeat.set(3, 1); return FIBRE;
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
  let g = geo.index ? geo.clone() : geo.clone();
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

// Loft of elliptical rings (y, rx, rz, zOffset[, xOffset]); optional angular gap (front opening) in radians.
function ellipseLoft(rings, n = 28, { capBottom = false, capTop = false, gap = 0, uScale = 1, vScale = 1 } = {}) {
  const pos = [], uv = [], idx = [];
  const cols = gap ? n + 1 : n + 1;
  for (let i = 0; i < rings.length; i++) {
    const [y, rx, rz, zo, xo = 0] = rings[i];
    for (let j = 0; j < cols; j++) {
      const a = gap ? lerp(gap, Math.PI * 2 - gap, j / n) : (j / n) * Math.PI * 2;
      pos.push(xo + Math.sin(a) * rx, y, zo + Math.cos(a) * rz);
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
  if (!gap) { const nn = g.attributes.normal; for (let i = 0; i < rings.length; i++) { const a = i * cols, b = i * cols + n; const v = V3(nn.getX(a) + nn.getX(b), nn.getY(a) + nn.getY(b), nn.getZ(a) + nn.getZ(b)).normalize(); nn.setXYZ(a, v.x, v.y, v.z); nn.setXYZ(b, v.x, v.y, v.z); } }
  const parts = [g];
  const cap = (ring, up) => {
    const [y, rx, rz, zo, xo = 0] = ring; const c = new THREE.CircleGeometry(1, n); c.scale(rx, rz, 1);
    c.rotateX(up ? -Math.PI / 2 : Math.PI / 2); c.translate(xo, y, zo); return c;
  };
  if (capBottom) parts.push(cap(rings[0], false));
  if (capTop) parts.push(cap(rings[rings.length - 1], true));
  return parts.length > 1 ? mergeGeometries(parts.map(p => { const q = p.index ? p : p; q.deleteAttribute && null; return q; }), false) : g;
}

// keep only triangles whose centroid passes the test (used for hair / beard shells)
function filterTris(geo, test) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone(); const p = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
  const P = [], N = [], U = [];
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    if (!test(cx, cy, cz)) continue;
    for (let k = 0; k < 3; k++) { P.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k)); N.push(nrm.getX(i + k), nrm.getY(i + k), nrm.getZ(i + k)); U.push(uv.getX(i + k), uv.getY(i + k)); }
  }
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); o.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); o.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  return o;
}

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
    }
    p.setXYZ(i, x * 0.088 * inflate + HEAD_C.x, y * 0.112 * inflate + HEAD_C.y, z * 0.1 * inflate + HEAD_C.z);
  }
  g.computeVertexNormals(); return g;
}

// Hair-like shell over the skull: where mask=1 it sits `thick` above the skin, where mask=0 it
// dives under the skin, so the edge blends in without a stair-stepped border.
function maskedShell(maskFn, thick, ws = 36, hs = 26) {
  const g = headGeometry(1, ws, hs); const p = g.attributes.position; const m = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const rx = p.getX(i) - HEAD_C.x, ry = p.getY(i) - HEAD_C.y, rz = p.getZ(i) - HEAD_C.z;
    const k = m[i] = clamp(maskFn(rx, ry, rz), 0, 1); const s = 0.975 + (0.025 + thick) * k;
    p.setXYZ(i, HEAD_C.x + rx * s, HEAD_C.y + ry * s, HEAD_C.z + rz * s);
  }
  g.computeVertexNormals();
  const ix = g.index.array, keep = [];
  for (let i = 0; i < ix.length; i += 3) if (m[ix[i]] > 0.02 || m[ix[i + 1]] > 0.02 || m[ix[i + 2]] > 0.02) keep.push(ix[i], ix[i + 1], ix[i + 2]);
  g.setIndex(keep); return g;
}
const band = (v, a, b, f) => smooth(a - f, a + f, v) * (1 - smooth(b - f, b + f, v));

/**
 * Seated angler. opts: { shirt, vest, hat, skin, pants, name, seed }
 */
export function createAngler(opts = {}) {
  let nameText = opts.name ?? 'Angler';
  const seed = (opts.seed ?? hashStr(nameText)) >>> 0;
  const R = rng(seed);
  const skinHex = opts.skin ?? [0xe6b393, 0xd9a47c, 0xc58b66, 0xefc4a4][seed % 4];
  const shirtHex = opts.shirt ?? 0x8a2f2a, vestHex = opts.vest ?? 0x5b6b3a, hatHex = opts.hat ?? 0xc9b98f;
  const pantsHex = opts.pants ?? 0x3d4038, bootHex = 0x283326;
  const hairHex = [0x3b2a1d, 0x5a3e28, 0x221c18, 0x8a7d70, 0x9c7b52][(seed >>> 3) % 5];
  const beard = ((seed >>> 7) & 1) === 0;

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

  const G = { skin: [], shirt: [], vest: [], pants: [], boots: [], hat: [], hair: [], glasses: [] };
  const SK = lin(skinHex), HAIR = [1, 1, 1];
  const waist = (x, y) => { if (y < 0.1) { const w = smooth(-0.03, 0.1, y); return [B_ROOT, 1 - w, B_LOWER, w]; } const w = smooth(0.1, 0.27, y); return [B_LOWER, 1 - w, B_UPPER, w]; };

  // ---- torso (shirt)
  const torso = ellipseLoft([
    [-0.098, 0.13, 0.085, -0.01], [-0.085, 0.165, 0.118, 0.0], [-0.04, 0.18, 0.128, 0.0], [0.03, 0.17, 0.118, 0.01],
    [0.11, 0.157, 0.108, 0.02], [0.19, 0.16, 0.11, 0.022], [0.27, 0.17, 0.115, 0.016], [0.35, 0.18, 0.116, 0.006],
    [0.41, 0.19, 0.107, -0.008], [0.45, 0.188, 0.094, -0.018], [0.482, 0.15, 0.078, -0.024], [0.505, 0.085, 0.064, -0.028], [0.52, 0.06, 0.056, -0.028],
  ], 30, { capBottom: true, capTop: true, uScale: 6, vScale: 6 });
  G.shirt.push(part(torso, { weights: waist }));
  const collar = new THREE.TorusGeometry(0.068, 0.015, 6, 22); collar.rotateX(Math.PI / 2); collar.scale(1, 1, 0.88);
  G.shirt.push(part(collar, { m: M4(0, 0.508, -0.026, 0.12, 0, 0), color: [0.85, 0.85, 0.85], bone: B_UPPER }));

  // ---- vest (open front) with pockets, fly patch, zipper edges
  const vestRings = [[0.0, 0.19, 0.136, 0.01], [0.08, 0.177, 0.126, 0.018], [0.16, 0.174, 0.125, 0.024], [0.24, 0.181, 0.129, 0.022],
    [0.32, 0.195, 0.132, 0.012], [0.395, 0.205, 0.126, 0.0], [0.445, 0.2, 0.11, -0.014], [0.49, 0.162, 0.094, -0.022]];
  const GAP = 0.3;
  const vest = ellipseLoft(vestRings, 30, { gap: GAP, uScale: 4, vScale: 4 });
  G.vest.push(part(vest, { weights: waist, color: (x, y, z) => { const a = Math.abs(Math.atan2(x, z - 0.01)); return a < GAP + 0.08 ? [0.55, 0.55, 0.55] : [1, 1, 1]; } }));
  const ringAt = (y) => { for (let i = 0; i < vestRings.length - 1; i++) { const a = vestRings[i], b = vestRings[i + 1]; if (y <= b[0]) { const t = (y - a[0]) / (b[0] - a[0]); return a.map((v, k) => lerp(v, b[k], t)); } } return vestRings[vestRings.length - 1]; };
  const onVest = (ang, y, out = 0.008) => { const [, rx, rz, zo] = ringAt(y); const x = Math.sin(ang) * rx, z = zo + Math.cos(ang) * rz; const n = V3(Math.sin(ang) / rx, 0, Math.cos(ang) / rz).normalize(); return { p: V3(x, y, z).addScaledVector(n, out), ry: Math.atan2(n.x, n.z) }; };
  for (const s of [-1, 1]) {
    for (const [ang, y, w, h] of [[0.62, 0.325, 0.085, 0.09], [0.66, 0.11, 0.1, 0.1]]) {
      const { p, ry } = onVest(s * ang, y, 0.009);
      const yb = y > 0.2 ? B_UPPER : B_LOWER;
      G.vest.push(part(new RoundedBoxGeometry(w, h, 0.02, 1, 0.006), { m: M4(p.x, p.y, p.z, 0, ry, 0), color: [0.93, 0.93, 0.93], bone: yb }));
      const f = onVest(s * ang, y + h / 2 - 0.012, 0.02);
      G.vest.push(part(new RoundedBoxGeometry(w + 0.008, 0.03, 0.008, 1, 0.003), { m: M4(f.p.x, f.p.y, f.p.z, -0.1, f.ry, 0), color: [0.72, 0.72, 0.72], bone: yb }));
    }
  }
  { const { p, ry } = onVest(-0.95, 0.4, 0.01); G.vest.push(part(new RoundedBoxGeometry(0.055, 0.045, 0.014, 1, 0.006), { m: M4(p.x, p.y, p.z, 0, ry, 0), color: [2.2, 2.1, 1.85], bone: B_UPPER })); }
  { const r = onVest(0.95, 0.43, 0.012); G.vest.push(part(new THREE.TorusGeometry(0.012, 0.0028, 5, 12), { m: M4(r.p.x, r.p.y, r.p.z, 0, r.ry, 0), color: [0.35, 0.35, 0.35], bone: B_UPPER })); }

  // ---- neck & head (skin)
  G.skin.push(part(segment(V3(0, 0.47, -0.03), V3(0, 0.62, -0.016), 0.06, 0.055, 14, 3), { color: SK, bone: B_NECKS }));
  const headCol = (x, y, z) => { const ry = y - HEAD_C.y; const cheek = Math.max(0, 1 - Math.hypot(Math.abs(x) - 0.05, ry + 0.02) / 0.04) * (z > 0.05 ? 1 : 0); return [SK[0] * (1 + 0.08 * cheek), SK[1] * (1 - 0.06 * cheek), SK[2] * (1 - 0.05 * cheek)]; };
  G.skin.push(part(headGeometry(1, 28, 20), { color: headCol, bone: B_HEADS }));
  const H = (x, y, z) => HEAD_C.clone().add(V3(x, y, z));
  const sph = (r, seg = 10) => new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2));
  { // nose: tapered wedge (narrow bridge, fuller tip) + soft tip
    const n = new THREE.SphereGeometry(1, 14, 12); const q = n.attributes.position;
    for (let k = 0; k < q.count; k++) { const x = q.getX(k), y = q.getY(k), z = q.getZ(k); const t = (1 - y) / 2; q.setXYZ(k, x * 0.0155 * lerp(0.5, 1.05, t), y * 0.027, z * 0.019 * lerp(0.55, 1.0, t) + 0.006 * t); }
    n.computeVertexNormals();
    let p0 = H(0, -0.012, 0.088); G.skin.push(part(n, { m: M4(p0.x, p0.y, p0.z, -0.22, 0, 0), color: SK, bone: B_HEADS }));
    p0 = H(0, -0.034, 0.103); G.skin.push(part(sph(0.0118, 10), { m: M4(p0.x, p0.y, p0.z, 0, 0, 0, 1.15, 0.9, 1), color: [SK[0], SK[1] * 0.97, SK[2] * 0.96], bone: B_HEADS }));
  }
  { const lip = new THREE.CapsuleGeometry(0.0052, 0.028, 3, 8); lip.rotateZ(Math.PI / 2); const p = H(0, -0.06, 0.086);
    G.skin.push(part(lip, { m: M4(p.x, p.y, p.z, 0, 0, 0, 1, 0.8, 0.8), color: [SK[0] * 0.86, SK[1] * 0.68, SK[2] * 0.66], bone: B_HEADS })); }
  for (const s of [-1, 1]) { // ears
    const p = H(s * 0.087, -0.004, -0.006);
    G.skin.push(part(sph(1, 10), { m: M4(p.x, p.y, p.z, 0, s * 0.35, s * 0.08, 0.011, 0.03, 0.02), color: [SK[0] * 0.95, SK[1] * 0.86, SK[2] * 0.84], bone: B_HEADS }));
  }
  // hair shell (back & sides under the hat), eyebrows, optional beard
  const hairShell = maskedShell((x, y, z) => band(y, -0.058, 0.075, 0.008) * Math.max(1 - smooth(-0.02, 0.015, z), smooth(0.062, 0.074, Math.abs(x)) * (1 - smooth(0.025, 0.045, z))), 0.012);
  G.hair.push(part(hairShell, { color: HAIR, bone: B_HEADS }));
  for (const s of [-1, 1]) { const p = H(s * 0.034, 0.039, 0.093); G.hair.push(part(new RoundedBoxGeometry(0.033, 0.0065, 0.009, 1, 0.003), { m: M4(p.x, p.y, p.z, 0, s * 0.22, -s * 0.12), color: [0.7, 0.7, 0.7], bone: B_HEADS })); }
  if (beard) {
    const full = R() < 0.5 ? 0.02 : 0.011;
    const bs = maskedShell((x, y, z) => {
      const ax = Math.abs(x);
      const jaw = 1 - smooth(-0.056, -0.04, y);
      const side = smooth(0.052, 0.064, ax) * (1 - smooth(-0.006, 0.01, y));
      const tache = (1 - smooth(0.026, 0.034, ax)) * band(y, -0.053, -0.041, 0.003) * smooth(0.04, 0.06, z);
      const mouth = (1 - smooth(0.02, 0.028, ax)) * band(y, -0.07, -0.051, 0.003) * smooth(0.03, 0.05, z);
      return Math.max(Math.max(jaw, side) * (1 - mouth), tache) * smooth(-0.055, -0.03, z);
    }, full);
    G.hair.push(part(bs, { color: HAIR, bone: B_HEADS }));
  }
  // sunglasses
  for (const s of [-1, 1]) {
    const p = H(s * 0.034, 0.016, 0.1);
    const ls = new THREE.Shape(); const w = 0.025, h = 0.017, r = 0.011;
    ls.moveTo(-w + r, h); ls.lineTo(w - r, h); ls.quadraticCurveTo(w, h, w, h - r); ls.lineTo(w, -h + r * 0.6); ls.quadraticCurveTo(w, -h, w - r * 1.2, -h);
    ls.lineTo(-w + r * 1.2, -h); ls.quadraticCurveTo(-w, -h, -w, -h + r * 0.6); ls.lineTo(-w, h - r); ls.quadraticCurveTo(-w, h, -w + r, h);
    const lens = new THREE.ExtrudeGeometry(ls, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 5 });
    G.glasses.push(part(lens, { m: M4(p.x, p.y, p.z, 0.04, s * 0.2, 0), bone: B_HEADS }));
    const t0 = H(s * 0.06, 0.022, 0.09), t1 = H(s * 0.089, 0.018, -0.005);
    G.glasses.push(part(segment(t0, t1, 0.0028, 0.0025, 5, 1), { bone: B_HEADS }));
  }
  { const p = H(0, 0.026, 0.104); G.glasses.push(part(new THREE.BoxGeometry(0.02, 0.005, 0.004), { m: M4(p.x, p.y, p.z), bone: B_HEADS })); }
  // bucket hat (lathe) with darker band
  {
    const prof = [[0.001, 0.112], [0.05, 0.11], [0.074, 0.104], [0.087, 0.09], [0.093, 0.065], [0.097, 0.04], [0.099, 0.03], [0.1, 0.012],
      [0.12, 0.004], [0.145, -0.009], [0.166, -0.022], [0.17, -0.028], [0.163, -0.026], [0.145, -0.015], [0.12, -0.004], [0.103, 0.005]].map(p => new THREE.Vector2(p[0], p[1]));
    const hat = new THREE.LatheGeometry(prof, 30); const p = H(0, 0.058, -0.008);
    G.hat.push(part(hat, { m: M4(p.x, p.y, p.z, -0.08, 0, 0, 0.94, 1, 1), color: (x, y) => { const ry = y - p.y; return (ry > 0.012 && ry < 0.031) ? [0.45, 0.42, 0.38] : [1, 1, 1]; }, bone: B_HEADS }));
  }

  // ---- arms (shirt sleeves, skin hands), bind pose hanging straight down
  for (const s of [1, -1]) {
    const ua = s > 0 ? B_UARM_L : B_UARM_R, fa = s > 0 ? B_FARM_L : B_FARM_R;
    const S0 = V3(s * SHOULDER, SHOULDER_Y, SHOULDER_Z), E0 = S0.clone().add(V3(0, -L_UPPER, 0));
    G.shirt.push(part(segment(S0.clone(), E0, 0.054, 0.045, 14, 4), { bone: ua, uv: [2.2, 2] }));
    G.shirt.push(part(segment(E0, E0.clone().add(V3(0, -0.225, 0)), 0.046, 0.039, 14, 4), { bone: fa, uv: [1.8, 1.6] }));
    G.shirt.push(part(new THREE.CylinderGeometry(0.042, 0.042, 0.03, 14), { m: M4(E0.x, E0.y - 0.222, E0.z), color: [0.8, 0.8, 0.8], bone: fa }));
    G.skin.push(part(segment(E0.clone().add(V3(0, -0.23, 0)), E0.clone().add(V3(0, -0.29, 0)), 0.03, 0.031, 10, 2), { color: SK, bone: fa }));
    // fist: grip axis along local Z through (0, -L_FORE, 0)
    const C = E0.clone().add(V3(0, -L_FORE, 0));
    G.skin.push(part(new RoundedBoxGeometry(0.056, 0.085, 0.09, 2, 0.022), { m: M4(C.x + s * 0.004, C.y + 0.004, C.z), color: SK, bone: fa }));
    for (let k = 0; k < 4; k++) { const z = -0.033 + k * 0.022; const f = new THREE.CapsuleGeometry(0.0115, 0.03, 2, 8); G.skin.push(part(f, { m: M4(C.x - s * 0.026, C.y - 0.012, C.z + z, 0, 0, s * 0.35), color: [SK[0] * 0.97, SK[1] * 0.93, SK[2] * 0.92], bone: fa })); }
    const th = segment(C.clone().add(V3(-s * 0.02, 0.03, 0.045)), C.clone().add(V3(-s * 0.03, -0.005, 0.052)), 0.012, 0.011, 8, 2);
    G.skin.push(part(th, { color: SK, bone: fa }));
  }

  // ---- legs (static, posed by IK onto the floor), rubber boots
  for (const s of [1, -1]) {
    const { Hj, K, An } = legJoints[s];
    const tb = s > 0 ? B_THIGH_L : B_THIGH_R, sb = s > 0 ? B_SHIN_L : B_SHIN_R;
    G.pants.push(part(segment(Hj, K, 0.086, 0.064, 16, 4), { bone: tb }));
    G.pants.push(part(segment(K, An, 0.06, 0.045, 14, 3), { bone: sb }));
    const top = K.clone().lerp(An, 0.42);
    G.boots.push(part(segment(top, An, 0.066, 0.058, 16, 3), { bone: sb }));
    G.boots.push(part(new THREE.TorusGeometry(0.066, 0.008, 6, 18), { m: new THREE.Matrix4().compose(top, new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), An.clone().sub(K).normalize()), V3(1, 1, 1)), color: [0.7, 0.7, 0.7], bone: sb }));
    G.boots.push(part(new RoundedBoxGeometry(0.105, 0.085, 0.27, 2, 0.036), { m: M4(An.x, An.y - 0.036, An.z + 0.07, 0, s * 0.06, 0), bone: sb }));
    G.boots.push(part(new RoundedBoxGeometry(0.11, 0.02, 0.275, 1, 0.008), { m: M4(An.x, An.y - 0.072, An.z + 0.07, 0, s * 0.06, 0), color: [0.35, 0.3, 0.26], bone: sb }));
  }

  // ---- materials + skinned meshes
  const weave = weaveTexture();
  const mats = {
    skin: new THREE.MeshStandardMaterial({ name: 'skin', vertexColors: true, roughness: 0.58 }),
    shirt: new THREE.MeshStandardMaterial({ name: 'shirt', map: plaidTexture(shirtHex), vertexColors: true, roughness: 0.88 }),
    vest: new THREE.MeshStandardMaterial({ name: 'vest', color: vestHex, map: weave, vertexColors: true, roughness: 0.92, side: THREE.DoubleSide }),
    pants: new THREE.MeshStandardMaterial({ name: 'pants', color: pantsHex, map: weave, vertexColors: true, roughness: 0.9 }),
    boots: new THREE.MeshStandardMaterial({ name: 'boots', color: bootHex, vertexColors: true, roughness: 0.38 }),
    hat: new THREE.MeshStandardMaterial({ name: 'hat', color: hatHex, map: weave, vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
    hair: new THREE.MeshStandardMaterial({ name: 'hair', color: hairHex, map: fibreTexture(), vertexColors: true, roughness: 0.97 }),
    glasses: new THREE.MeshStandardMaterial({ name: 'glasses', color: 0x0d0f12, vertexColors: true, roughness: 0.06, metalness: 0.7 }),
  };
  object.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const meshes = [];
  for (const k of Object.keys(G)) {
    if (!G[k].length) continue;
    const geo = mergeGeometries(G[k], false); geo.computeBoundingSphere();
    const mesh = new THREE.SkinnedMesh(geo, mats[k]); mesh.name = 'angler-' + k;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    object.add(mesh); mesh.bind(skeleton); meshes.push(mesh);
  }

  // ---- anchors, name tag
  const head = new THREE.Object3D(); head.name = 'eyes'; head.position.copy(EYE_P).sub(HEAD_P); bones[B_HEAD].add(head);
  const tagMat = new THREE.SpriteMaterial({ map: nameTexture(nameText), transparent: true, depthWrite: false });
  const tag = new THREE.Sprite(tagMat); tag.scale.set(0.6, 0.15, 1); tag.renderOrder = 10; tag.name = 'nameTag'; object.add(tag);

  // ---- state
  const look = { yaw: 0, pitch: 0 }; let fp = false; let time = R() * 10;
  const gait = { stand: 0, standT: 0, phase: 0, amount: 0 };
  const legQ = { t: new THREE.Quaternion(), s: new THREE.Quaternion(), tmp: new THREE.Quaternion(), ax: V3(1, 0, 0) };
  const targets = { L: null, R: null };
  const rest = { L: V3(0.14, 0.1, 0.34), R: V3(-0.14, 0.1, 0.34) };
  const tmpT = V3(), invChest = new THREE.Matrix4(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), hp = V3();
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
      const dT = K.clone().sub(Hj).normalize(), dS = An.clone().sub(K).normalize();
      const tT = V3(0, -Math.cos(swing), Math.sin(swing));
      const tS = V3(0, -Math.cos(swing - bend), Math.sin(swing - bend));
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
