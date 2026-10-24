// Alpenfisch — procedural lures: Mepps-style spinner, spoon, trout wobbler, worm & float rig.
// Real-world sizes (metres). Every lure: origin at the line tie point, body trails along -Z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const LURE_TYPES = ['spinner', 'spoon', 'minnow', 'float'];
export const LURE_INFO = {
  spinner: { name: 'Spinner', desc: 'French-blade spinner with a brass body and a red-dressed treble. The spinning blade throws flash and vibration that trout and perch strike at. Works best on a steady retrieve.' },
  spoon: { name: 'Spoon', desc: 'Red-and-white casting spoon. It casts far and flutters from side to side, flashing like a wounded baitfish. Good for pike and lake trout in deep, fast water.' },
  minnow: { name: 'Wobbler', desc: '7 cm hard-bait minnow in a trout pattern with a holographic finish. The clear lip makes it dive and wobble. Twitch it past rocks for big brown trout.' },
  float: { name: 'Worm & Float', desc: 'Balsa float with a live worm, a hook and a split shot. The bait drifts with the current while you watch the float tip. Slow, quiet and deadly for any fish.' },
};

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(cv, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------
function merge(geos, withColor = false) {
  const nonIdx = geos.some((g) => !g.index);
  const keep = ['position', 'normal', 'uv'].concat(withColor ? ['color'] : []);
  const list = geos.map((g0) => {
    const g = nonIdx && g0.index ? g0.toNonIndexed() : g0;
    for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (withColor && !g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    g.morphAttributes = {};
    return g;
  });
  return mergeGeometries(list, false);
}

// tube with parallel-transport frames; rad: number | (t 0..1) => r
function tubeWrite(geo, P, rad, radial) {
  const n = P.length, pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
  const rf = typeof rad === 'function' ? rad : () => rad;
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), tmp = new THREE.Vector3();
  for (let j = 0; j < n; j++) {
    const a = P[Math.max(0, j - 1)], b = P[Math.min(n - 1, j + 1)];
    T.subVectors(b, a);
    if (T.lengthSq() < 1e-18) T.set(0, 0, 1); else T.normalize();
    if (j === 0) { N.set(0, 1, 0); if (Math.abs(N.dot(T)) > 0.9) N.set(1, 0, 0); }
    N.addScaledVector(T, -N.dot(T)).normalize();
    B.crossVectors(T, N);
    const r = rf(j / (n - 1));
    for (let i = 0; i <= radial; i++) {
      const th = i / radial * TAU, c = Math.cos(th), s = Math.sin(th), k = (j * (radial + 1) + i) * 3;
      tmp.set(N.x * c + B.x * s, N.y * c + B.y * s, N.z * c + B.z * s);
      pos[k] = P[j].x + tmp.x * r; pos[k + 1] = P[j].y + tmp.y * r; pos[k + 2] = P[j].z + tmp.z * r;
      nor[k] = tmp.x; nor[k + 1] = tmp.y; nor[k + 2] = tmp.z;
    }
  }
  geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
}
function tube(pts, rad, radial = 6, samples = 0) {
  let P = pts;
  if (samples) P = new THREE.CatmullRomCurve3(pts, false, 'centripetal').getPoints(samples);
  const n = P.length, W = radial + 1;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * W * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * W * 3), 3));
  const uv = new Float32Array(n * W * 2), idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < W; i++) { uv[(j * W + i) * 2] = i / radial; uv[(j * W + i) * 2 + 1] = j / (n - 1); }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < radial; i++) { const a = j * W + i; idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1); }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  tubeWrite(geo, P, rad, radial);
  return geo;
}
// lathe around +Z: prof [[r, z], ...]
function latheZ(prof, segs) {
  if (prof[0][1] > prof[prof.length - 1][1]) prof = prof.slice().reverse(); // ascending for outward faces
  const g = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), segs);
  g.rotateX(Math.PI / 2); // lathe axis Y -> Z (z' = y)
  return g;
}
// generic grid -> indexed geometry with computed normals
function gridGeo(NU, NV, pos, uv, flip = false) {
  const W = NU + 1, P = new Float32Array(W * (NV + 1) * 3), U = new Float32Array(W * (NV + 1) * 2), idx = [];
  const v = new THREE.Vector3();
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    pos(i, j, v); const k = j * W + i;
    P[k * 3] = v.x; P[k * 3 + 1] = v.y; P[k * 3 + 2] = v.z;
    const t = uv(i, j); U[k * 2] = t[0]; U[k * 2 + 1] = t[1];
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * W + i, b = a + 1, c = a + W + 1, d = a + W;
    if (flip) idx.push(a, d, b, b, d, c); else idx.push(a, b, d, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// treble hook: eye ring at the origin (top), shank along -Z, three bends
function trebleGeo(len, gap, wire) {
  const geos = [];
  const eyeR = wire * 3.0;
  const eye = new THREE.TorusGeometry(eyeR, wire * 0.85, 6, 14);
  eye.rotateY(Math.PI / 2); eye.translate(0, 0, -eyeR);
  geos.push(eye);
  geos.push(tube([V(0, 0, -eyeR * 1.9), V(0, 0, -0.74 * len)], wire * 1.25, 6));
  for (let k = 0; k < 3; k++) {
    const pts = [V(0, 0, -0.66 * len), V(0.02 * gap, 0, -0.86 * len), V(0.2 * gap, 0, -0.98 * len), V(0.5 * gap, 0, -1.02 * len),
      V(0.8 * gap, 0, -0.97 * len), V(0.97 * gap, 0, -0.83 * len), V(1.0 * gap, 0, -0.66 * len), V(0.95 * gap, 0, -0.5 * len), V(0.86 * gap, 0, -0.38 * len)];
    const prong = tube(pts, (t) => wire * (t < 0.72 ? 1 : lerp(1, 0.12, (t - 0.72) / 0.28)), 6, 22);
    const barb = tube([V(0.925 * gap, 0, -0.47 * len), V(0.86 * gap, 0, -0.53 * len), V(0.80 * gap, 0, -0.57 * len)], (t) => wire * lerp(0.7, 0.1, t), 5);
    for (const g of [prong, barb]) { g.rotateZ(k * TAU / 3); geos.push(g); }
  }
  return merge(geos);
}
function singleHookGeo(len, gap, wire) {
  const geos = [];
  const eyeR = wire * 2.6;
  const eye = new THREE.TorusGeometry(eyeR, wire * 0.85, 6, 14);
  eye.rotateY(Math.PI / 2); eye.translate(0, 0, -eyeR);
  geos.push(eye);
  const pts = [V(0, 0, -eyeR * 1.8), V(0, 0, -0.75 * len), V(0.03 * gap, 0, -0.9 * len), V(0.25 * gap, 0, -1.0 * len), V(0.6 * gap, 0, -1.0 * len),
    V(0.92 * gap, 0, -0.88 * len), V(1.0 * gap, 0, -0.7 * len), V(0.98 * gap, 0, -0.55 * len), V(0.92 * gap, 0, -0.45 * len)];
  geos.push(tube(pts, (t) => wire * (t < 0.8 ? 1 : lerp(1, 0.12, (t - 0.8) / 0.2)), 6, 30));
  geos.push(tube([V(0.97 * gap, 0, -0.53 * len), V(0.9 * gap, 0, -0.58 * len), V(0.85 * gap, 0, -0.61 * len)], (t) => wire * lerp(0.7, 0.1, t), 5));
  return merge(geos);
}
// split ring: ~1.7 turns of flat-ish wire in the XY plane around +Z
function splitRingGeo(R, wire) {
  const pts = [];
  for (let k = 0; k <= 48; k++) { const a = k / 48 * 1.75 * TAU; pts.push(V(R * Math.cos(a), R * Math.sin(a), (a / TAU - 0.85) * wire * 2.3)); }
  return tube(pts, wire, 5);
}

// ---------------------------------------------------------------------------
// shared materials / textures (lazy)
// ---------------------------------------------------------------------------
let M = null;
function mats() {
  if (M) return M;
  const R = rng(77);
  // hammered bump for blades
  const hc = canvas(128, 128), h = hc.getContext('2d');
  h.fillStyle = '#808080'; h.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 160; i++) {
    const x = R() * 128, y = R() * 128, r = 3 + R() * 6;
    const g = h.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(40,40,40,0.55)'); g.addColorStop(1, 'rgba(128,128,128,0)');
    h.fillStyle = g; h.beginPath(); h.arc(x, y, r, 0, TAU); h.fill();
  }
  const hammer = tex(hc, false, true);
  // dressed tail (hair strands with alpha)
  const tc = canvas(256, 64), t = tc.getContext('2d');
  for (let i = 0; i < 230; i++) {
    const x = R() * 256, w = 0.8 + R() * 1.6, bend = (R() - 0.5) * 8, len = 40 + R() * 24;
    const pick = R();
    t.strokeStyle = pick < 0.7 ? `hsl(${352 + R() * 10},${80 + R() * 15}%,${36 + R() * 18}%)` : pick < 0.85 ? '#f4efe6' : '#2a1410';
    t.lineWidth = w; t.beginPath(); t.moveTo(x, 0); t.quadraticCurveTo(x + bend * 0.5, len * 0.5, x + bend, len); t.stroke();
  }
  const hair = tex(tc);
  M = {
    hook: new THREE.MeshStandardMaterial({ color: 0x34343a, metalness: 1, roughness: 0.28 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xd9dcdf, metalness: 1, roughness: 0.18 }),
    blade: new THREE.MeshPhysicalMaterial({ color: 0xeef0f2, metalness: 1, roughness: 0.1, bumpMap: hammer, bumpScale: 1.5, side: THREE.DoubleSide }),
    brass: new THREE.MeshPhysicalMaterial({ color: 0xd2a447, metalness: 1, roughness: 0.18, clearcoat: 0.5 }),
    redBead: new THREE.MeshPhysicalMaterial({ color: 0xc8101c, roughness: 0.15, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 }),
    hair: new THREE.MeshStandardMaterial({ map: hair, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 }),
    blur: new THREE.MeshBasicMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    lead: new THREE.MeshStandardMaterial({ color: 0x6a6e74, metalness: 0.6, roughness: 0.45 }),
    leader: new THREE.MeshStandardMaterial({ color: 0xbfc8c4, metalness: 0, roughness: 0.3, transparent: true, opacity: 0.6 }),
  };
  return M;
}

// ---------------------------------------------------------------------------
// SPINNER  (~6 cm with the dressed treble)
// ---------------------------------------------------------------------------
function bladeGeo(a, b, dome, z0) {
  return gridGeo(28, 9, (i, j, out) => {
    const phi = i / 28 * TAU, rho = j / 9;
    const x = b * rho * Math.sin(phi), z = z0 - a + a * rho * Math.cos(phi);
    out.set(x, dome * (1 - rho * rho), z);
  }, (i, j) => { const phi = i / 28 * TAU, rho = j / 9; return [0.5 + 0.5 * rho * Math.sin(phi), 0.5 + 0.5 * rho * Math.cos(phi)]; });
}

function buildSpinner() {
  const m = mats();
  const object = new THREE.Group(); object.name = 'Lure_spinner';
  const steel = [];
  const eye = new THREE.TorusGeometry(0.0017, 0.00034, 6, 16); eye.rotateY(Math.PI / 2); eye.translate(0, 0, -0.0017); steel.push(eye);
  const tw = []; for (let k = 0; k <= 36; k++) { const a = k / 36 * 3 * TAU; tw.push(V(0.00068 * Math.cos(a), 0.00068 * Math.sin(a), -0.0034 - k / 36 * 0.0024)); }
  steel.push(tube(tw, 0.00026, 5));
  steel.push(tube([V(0, 0, -0.0033), V(0, 0, -0.0360)], 0.00036, 6));
  const rl = new THREE.TorusGeometry(0.0013, 0.00034, 6, 14); rl.rotateY(Math.PI / 2); rl.translate(0, 0, -0.0372); steel.push(rl);
  object.add(new THREE.Mesh(merge(steel), m.steel));
  // beads + weighted body
  const bead = new THREE.SphereGeometry(0.0019, 14, 10); bead.translate(0, 0, -0.0108);
  object.add(new THREE.Mesh(bead, m.redBead));
  const body = latheZ([[0.0004, -0.0124], [0.0013, -0.0127], [0.0023, -0.0137], [0.0030, -0.0170], [0.0034, -0.0210], [0.0031, -0.0262], [0.0022, -0.0300], [0.0012, -0.0314], [0.0004, -0.0316]], 20);
  const b2 = new THREE.SphereGeometry(0.0014, 12, 8); b2.translate(0, 0, -0.0334);
  object.add(new THREE.Mesh(merge([body, b2]), m.brass));
  // spinning blade assembly
  const spin = new THREE.Group(); object.add(spin);
  spin.add(new THREE.Mesh(tube([V(0, -0.0002, -0.0061), V(0, 0.0011, -0.0062), V(0, 0.0015, -0.0075), V(0, 0.0011, -0.0089), V(0, -0.0002, -0.0090)], 0.00038, 5, 12), m.steel));
  const pivot = new THREE.Group(); pivot.position.set(0, 0.0015, -0.0072); spin.add(pivot);
  const blade = new THREE.Mesh(bladeGeo(0.0122, 0.0079, 0.0013, -0.0008), m.blade);
  pivot.add(blade);
  // motion-blur hint: faint cone swept by the blade at speed
  const blurG = latheZ([[0.0016, -0.0075], [0.0060, -0.0160], [0.0098, -0.0250], [0.0108, -0.0300]], 28);
  const blur = new THREE.Mesh(blurG, m.blur.clone()); blur.renderOrder = 2; object.add(blur);
  // treble + red tail
  const treble = new THREE.Group(); treble.position.set(0, 0, -0.0384); treble.rotation.z = Math.PI / 2; object.add(treble);
  treble.add(new THREE.Mesh(trebleGeo(0.0165, 0.0056, 0.00048), m.hook));
  const hairs = [];
  for (let k = 0; k < 3; k++) {
    const c = latheZ([[0.0011 + k * 0.0002, -0.0016], [0.0030 + k * 0.0012, -0.0090], [0.0042 + k * 0.0016, -0.0185 - k * 0.0012]], 14);
    c.rotateZ(k * 0.7);
    hairs.push(c);
  }
  treble.add(new THREE.Mesh(merge(hairs), m.hair));
  let speed = 0, sp = 0, ang = 0, t = 0;
  return {
    object, bait: null,
    setMotion(s) { speed = Math.max(0, +s || 0); },
    update(dt) {
      t += dt; sp += (speed - sp) * (1 - Math.exp(-6 * dt));
      const k = smooth(clamp(sp / 0.6, 0, 1));
      ang += TAU * Math.min(sp * 16, 11) * dt;
      spin.rotation.z = -ang;
      pivot.rotation.x = 0.1 + 0.48 * k;
      blur.material.opacity = 0.16 * smooth(clamp((sp - 0.25) / 0.5, 0, 1));
      blur.visible = blur.material.opacity > 0.005;
      treble.rotation.x = 0.06 * Math.sin(t * 9) * k;
    },
  };
}

// ---------------------------------------------------------------------------
// SPOON  (4.8 cm blade + split rings + treble)
// ---------------------------------------------------------------------------
let SPOON_TEX = null;
function spoonTex() {
  if (SPOON_TEX) return SPOON_TEX;
  const W = 512, H = 256, cc = canvas(W, H), pc = canvas(W, H), c = cc.getContext('2d'), p = pc.getContext('2d');
  // top (painted): left half; underside (nickel): right half
  c.fillStyle = '#f3efe6'; c.fillRect(0, 0, 256, H);
  c.save(); c.beginPath(); c.rect(0, 0, 256, H); c.clip();
  for (let k = -3; k < 6; k += 2) {
    c.save(); c.translate(128, 128); c.rotate(-0.5); c.translate(-128, -128);
    const y = 40 + k * 46;
    c.fillStyle = '#1a1a1a'; c.fillRect(-200, y - 2, 700, 50);
    c.fillStyle = '#c8141d'; c.fillRect(-200, y, 700, 46);
    c.restore();
  }
  c.restore();
  const g = c.createLinearGradient(256, 0, 512, 0);
  g.addColorStop(0, '#b9bdc2'); g.addColorStop(0.5, '#eceef0'); g.addColorStop(1, '#b9bdc2');
  c.fillStyle = g; c.fillRect(256, 0, 256, H);
  for (const x0 of [128, 384]) for (const y of [12, 244]) { c.fillStyle = '#111'; c.beginPath(); c.ellipse(x0, y, 9, 5, 0, 0, TAU); c.fill(); }
  p.fillStyle = 'rgb(0,80,15)'; p.fillRect(0, 0, 256, H);
  p.fillStyle = 'rgb(0,18,255)'; p.fillRect(256, 0, 256, H);
  SPOON_TEX = { map: tex(cc), props: tex(pc, false) };
  return SPOON_TEX;
}
function buildSpoon() {
  const m = mats(), T = spoonTex();
  const mat = new THREE.MeshPhysicalMaterial({ map: T.map, roughnessMap: T.props, metalnessMap: T.props, roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.05 });
  const object = new THREE.Group(); object.name = 'Lure_spoon';
  const wob = new THREE.Group(); object.add(wob);
  const LEN = 0.048, Wd = 0.0118, Z0 = -0.0046, TH = 0.0011, CUP = 0.0034, BOW = 0.0030;
  const sec = (t) => {
    const w = Wd * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, 1.45))), 0.62);
    return { w, z: Z0 - t * LEN, y: BOW * Math.sin(Math.PI * t) };
  };
  const NV = 30, NU = 16;
  const half = (top) => gridGeo(NU, NV, (i, j, out) => {
    const t = j / NV, S = sec(t), psi = (top ? 0 : Math.PI) + i / NU * Math.PI, c = Math.cos(psi), s = Math.sin(psi);
    const x = S.w * c, yt = S.y + CUP * (1 - c * c);
    out.set(x, yt - TH * (1 - s) / 2, S.z);
  }, (i, j) => { const psi = (top ? 0 : Math.PI) + i / NU * Math.PI, c = Math.cos(psi); return [top ? 0.25 - 0.24 * c : 0.75 + 0.24 * c, 1 - j / NV * 0.94 - 0.03]; }, true);
  wob.add(new THREE.Mesh(merge([half(true), half(false)]), mat));
  // split rings + treble
  const r1 = splitRingGeo(0.0027, 0.00042); r1.rotateY(Math.PI / 2); r1.translate(0, 0.0003, -0.0027);
  const r2 = splitRingGeo(0.0027, 0.00042); r2.rotateY(Math.PI / 2); r2.translate(0, 0.0004, -0.0505);
  wob.add(new THREE.Mesh(merge([r1, r2]), m.steel));
  const treble = new THREE.Group(); treble.position.set(0, 0.0004, -0.0530); treble.rotation.z = Math.PI / 2; wob.add(treble);
  treble.add(new THREE.Mesh(trebleGeo(0.0175, 0.0062, 0.0005), m.hook));
  let speed = 0, sp = 0, ph = 0, t = 0;
  return {
    object, bait: null,
    setMotion(s) { speed = Math.max(0, +s || 0); },
    update(dt) {
      t += dt; sp += (speed - sp) * (1 - Math.exp(-5 * dt));
      const k = smooth(clamp(sp / 0.9, 0, 1));
      ph += TAU * (1.2 + 4.5 * Math.min(sp, 1.5)) * dt;
      wob.rotation.y = 0.38 * k * Math.sin(ph);
      wob.rotation.z = 0.55 * k * Math.sin(ph - 1.1);
      treble.rotation.x = 0.25 * k * Math.sin(ph * 2 + 0.6);
    },
  };
}

// ---------------------------------------------------------------------------
// MINNOW / WOBBLER  (7 cm, trout pattern, holo flanks, 3D eyes, clear lip, 2 trebles)
// ---------------------------------------------------------------------------
let MINNOW_TEX = null;
function minnowTex() {
  if (MINNOW_TEX) return MINNOW_TEX;
  const W = 512, H = 256, R = rng(31);
  const cc = canvas(W, H), pc = canvas(W, H), c = cc.getContext('2d'), p = pc.getContext('2d');
  // canvas x = nose -> tail, y = around (0 = back, 128 = belly, 256 = back)
  const g = c.createLinearGradient(0, 0, 0, H);
  const stops = [[0, '#33471f'], [0.09, '#3f5a28'], [0.2, '#8d9a6a'], [0.26, '#c9ccc4'], [0.36, '#e9e6e4'], [0.5, '#f6f3ee'],
    [0.64, '#e9e6e4'], [0.74, '#c9ccc4'], [0.8, '#8d9a6a'], [0.91, '#3f5a28'], [1, '#33471f']];
  for (const [o, col] of stops) g.addColorStop(o, col);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // pink lateral band (rainbow trout)
  for (const yc of [66, 190]) {
    const b = c.createLinearGradient(0, yc - 13, 0, yc + 13);
    b.addColorStop(0, 'rgba(220,110,130,0)'); b.addColorStop(0.5, 'rgba(222,96,122,0.75)'); b.addColorStop(1, 'rgba(220,110,130,0)');
    c.fillStyle = b; c.fillRect(70, yc - 13, W - 70, 26);
  }
  // scale foil pattern
  c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 1;
  for (let y = 30; y < 230; y += 7) for (let x = 80 + (y % 14 ? 0 : 4); x < 470; x += 8) {
    if (Math.abs(y - 128) < 26) continue;
    c.beginPath(); c.arc(x, y, 4.5, -1.2, 1.2); c.stroke();
  }
  // dark spots on back + upper flanks, a few red spots with pale halo
  for (let i = 0; i < 260; i++) {
    const x = 60 + R() * 430, side = R() < 0.5 ? 0 : 1, yb = R() * 52;
    const y = side ? 256 - yb : yb, r = 1.4 + R() * 2.4;
    c.fillStyle = 'rgba(20,24,12,0.85)'; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    if (x > 200 && yb < 30) { c.beginPath(); c.arc(x, side ? y + 256 : y - 256, r, 0, TAU); c.fill(); }
  }
  for (let i = 0; i < 26; i++) {
    const x = 110 + R() * 300, y = R() < 0.5 ? 50 + R() * 26 : 180 + R() * 26;
    c.fillStyle = 'rgba(245,235,220,0.8)'; c.beginPath(); c.arc(x, y, 3.6, 0, TAU); c.fill();
    c.fillStyle = '#b8222b'; c.beginPath(); c.arc(x, y, 2.2, 0, TAU); c.fill();
  }
  // head: darker top, gill plate line + red gill
  const hg = c.createLinearGradient(0, 0, 90, 0); hg.addColorStop(0, 'rgba(30,40,20,0.55)'); hg.addColorStop(1, 'rgba(30,40,20,0)');
  c.fillStyle = hg; c.fillRect(0, 0, 90, H);
  for (const yc of [64, 192]) {
    c.strokeStyle = 'rgba(60,40,40,0.6)'; c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(66, yc - 50); c.quadraticCurveTo(122, yc + 4, 70, yc + 50); c.stroke();
    c.strokeStyle = 'rgba(205,45,60,0.55)'; c.lineWidth = 4;
    c.beginPath(); c.moveTo(72, yc - 30); c.quadraticCurveTo(112, yc + 4, 76, yc + 36); c.stroke();
  }
  // tail fin rays
  c.strokeStyle = 'rgba(40,50,30,0.5)'; c.lineWidth = 1;
  for (let y = 0; y < H; y += 6) { c.beginPath(); c.moveTo(452, y); c.lineTo(512, y + (y - 128) * 0.05); c.stroke(); }
  // props: R = iridescence, G = roughness, B = metalness (foil flanks)
  const pg = p.createLinearGradient(0, 0, 0, H);
  const ps = [[0, 'rgb(20,90,30)'], [0.17, 'rgb(40,80,40)'], [0.26, 'rgb(255,45,230)'], [0.4, 'rgb(255,40,200)'], [0.5, 'rgb(120,70,60)'],
    [0.6, 'rgb(255,40,200)'], [0.74, 'rgb(255,45,230)'], [0.83, 'rgb(40,80,40)'], [1, 'rgb(20,90,30)']];
  for (const [o, col] of ps) pg.addColorStop(o, col);
  p.fillStyle = pg; p.fillRect(0, 0, W, H);
  // eye texture
  const ec = canvas(128, 128), e = ec.getContext('2d');
  const ig = e.createRadialGradient(64, 64, 4, 64, 64, 64);
  ig.addColorStop(0, '#000'); ig.addColorStop(0.36, '#050505'); ig.addColorStop(0.4, '#d9a21a'); ig.addColorStop(0.75, '#f3cf4c'); ig.addColorStop(0.93, '#9a6b10'); ig.addColorStop(1, '#2a1d06');
  e.fillStyle = ig; e.fillRect(0, 0, 128, 128);
  e.fillStyle = 'rgba(255,255,255,0.9)'; e.beginPath(); e.ellipse(50, 46, 8, 6, -0.5, 0, TAU); e.fill();
  MINNOW_TEX = { map: tex(cc), props: tex(pc, false), eye: tex(ec) };
  return MINNOW_TEX;
}
function buildMinnow() {
  const m = mats(), T = minnowTex();
  const object = new THREE.Group(); object.name = 'Lure_minnow';
  const wob = new THREE.Group(); object.add(wob);
  const body = new THREE.Group(); wob.add(body);
  // keyframed body profile (body coords: nose at z=0, tail at z=-0.070)
  const K = [[0, 0, 0, 0.0010], [0.03, 0.0040, 0.0033, 0.0008], [0.08, 0.0062, 0.0048, 0.0005], [0.18, 0.0080, 0.0058, 0.0003], [0.32, 0.0086, 0.0060, 0],
    [0.5, 0.0080, 0.0054, 0], [0.7, 0.0060, 0.0038, 0.0002], [0.84, 0.0036, 0.0020, 0.0005], [0.9, 0.0042, 0.0012, 0.0006], [0.97, 0.0060, 0.0008, 0.0006], [1, 0.0062, 0.0002, 0.0006]];
  const prof = (t) => {
    if (t < 0.03) { const cN = Math.sqrt(Math.max(0, 1 - Math.pow(1 - t / 0.03, 2))); return { b: 0.0040 * cN, a: 0.0033 * cN, c: lerp(0.0010, 0.0008, t / 0.03) }; }
    let i = 1; while (i < K.length - 2 && K[i + 1][0] < t) i++;
    const [t0, b0, a0, c0] = K[i], [t1, b1, a1, c1] = K[i + 1], u = smooth(clamp((t - t0) / (t1 - t0), 0, 1));
    return { b: lerp(b0, b1, u), a: lerp(a0, a1, u), c: lerp(c0, c1, u) };
  };
  const BL = 0.070;
  const bodyGeo = gridGeo(36, 40, (i, j, out) => {
    const t = Math.pow(j / 40, 1.15), P = prof(t), th = i / 36 * TAU;
    const s = Math.sin(th), c = Math.cos(th);
    const sx = Math.sign(s) * Math.pow(Math.abs(s), 0.9), sy = Math.sign(c) * Math.pow(Math.abs(c), 0.9);
    out.set(P.a * sx, P.c + P.b * sy, -t * BL);
  }, (i, j) => [Math.pow(j / 40, 1.15), 1 - i / 36]);
  const mat = new THREE.MeshPhysicalMaterial({
    map: T.map, roughnessMap: T.props, metalnessMap: T.props, roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.03,
    iridescence: 1, iridescenceMap: T.props, iridescenceIOR: 1.8, iridescenceThicknessRange: [220, 680],
  });
  body.add(new THREE.Mesh(bodyGeo, mat));
  // 3D eyes
  const eyeMat = new THREE.MeshPhysicalMaterial({ map: T.eye, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02 });
  for (const sx of [1, -1]) {
    const dome = new THREE.SphereGeometry(0.0029, 18, 10, 0, TAU, 0, Math.PI * 0.42);
    const uv = dome.attributes.uv, pos = dome.attributes.position;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, 0.5 + pos.getX(k) / 0.0058, 0.5 + pos.getZ(k) / 0.0058);
    dome.rotateZ(-sx * Math.PI / 2);
    const e = new THREE.Mesh(dome, eyeMat);
    e.position.set(sx * 0.0045, 0.0014, -0.0088);
    e.scale.set(0.55, 1, 1);
    body.add(e);
  }
  // clear diving lip
  const lipShape = new THREE.Shape();
  const lw = 0.0056, ll = 0.0145;
  lipShape.moveTo(-lw * 0.7, 0); lipShape.lineTo(lw * 0.7, 0);
  lipShape.quadraticCurveTo(lw, ll * 0.55, lw * 0.85, ll * 0.9); lipShape.quadraticCurveTo(0, ll * 1.08, -lw * 0.85, ll * 0.9);
  lipShape.quadraticCurveTo(-lw, ll * 0.55, -lw * 0.7, 0);
  const lipGeo = new THREE.ExtrudeGeometry(lipShape, { depth: 0.0007, bevelEnabled: true, bevelThickness: 0.0002, bevelSize: 0.0002, bevelSegments: 2, curveSegments: 10 });
  const lipMat = new THREE.MeshPhysicalMaterial({ color: 0xeaf6f6, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.38, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false });
  const lip = new THREE.Mesh(lipGeo, lipMat);
  lip.renderOrder = 3;
  // shape Y -> forward-down direction, depth -> thickness
  const LIP_A = 0.62;
  lip.position.set(0, -0.0042, -0.0072);
  // orient: shape +Y should map to (0, -sin A, cos A)
  lip.quaternion.setFromUnitVectors(V(0, 1, 0), V(0, -Math.sin(LIP_A), Math.cos(LIP_A)));
  body.add(lip);
  const lipDir = V(0, -Math.sin(LIP_A), Math.cos(LIP_A));
  const eyePos = V(0, -0.0042, -0.0072).addScaledVector(lipDir, ll * 0.72).add(V(0, 0.0008, 0));
  // line tie (on the lip) + belly / tail hangers
  const steel = [];
  const tie = new THREE.TorusGeometry(0.0012, 0.00032, 6, 14); tie.rotateY(Math.PI / 2); tie.translate(eyePos.x, eyePos.y + 0.0006, eyePos.z); steel.push(tie);
  const hb = new THREE.TorusGeometry(0.0011, 0.0003, 6, 12); hb.rotateY(Math.PI / 2); hb.translate(0, -0.0091, -0.025); steel.push(hb);
  const ht = new THREE.TorusGeometry(0.0011, 0.0003, 6, 12); ht.rotateY(Math.PI / 2); ht.translate(0, -0.0040, -0.0585); steel.push(ht);
  const s1 = splitRingGeo(0.0024, 0.00036); s1.rotateY(Math.PI / 2); s1.translate(0, -0.0112, -0.025); steel.push(s1);
  const s2 = splitRingGeo(0.0024, 0.00036); s2.rotateY(Math.PI / 2); s2.translate(0, -0.0061, -0.0585); steel.push(s2);
  body.add(new THREE.Mesh(merge(steel), m.steel));
  const hooks = [];
  for (const [y, z] of [[-0.0134, -0.025], [-0.0083, -0.0585]]) {
    const h = new THREE.Group(); h.position.set(0, y, z); body.add(h);
    const tm = new THREE.Mesh(trebleGeo(0.0140, 0.0050, 0.00042), m.hook);
    tm.rotation.z = Math.PI / 2; h.add(tm);
    hooks.push(h);
  }
  // put the tie eye at the origin
  body.position.set(-eyePos.x, -eyePos.y - 0.0006, -eyePos.z);
  let speed = 0, sp = 0, ph = 0, t = 0;
  return {
    object, bait: null,
    setMotion(s) { speed = Math.max(0, +s || 0); },
    update(dt) {
      t += dt; sp += (speed - sp) * (1 - Math.exp(-5 * dt));
      const k = smooth(clamp(sp / 0.7, 0, 1));
      ph += TAU * (1.5 + 7.5 * Math.min(sp, 1.3)) * dt;
      wob.rotation.y = 0.20 * k * Math.sin(ph);
      wob.rotation.z = 0.42 * k * Math.sin(ph + 1.3);
      for (let i = 0; i < hooks.length; i++) {
        hooks[i].rotation.x = -Math.PI / 2 + 1.05 * k + 0.08 * Math.sin(ph * 1.5 + i);
        hooks[i].rotation.z = 0.25 * k * Math.sin(ph + 2 + i);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// FLOAT (balsa, ~12 cm) + BAIT (leader, split shot, hook, live worm)
// ---------------------------------------------------------------------------
function colored(geo, col) {
  const c = new THREE.Color(col), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
// lathe around +Y between y0..y1 of a radius function
function latheY(rf, y0, y1, n, segs, col) {
  const pts = [];
  for (let k = 0; k <= n; k++) { const y = lerp(y0, y1, k / n); pts.push(new THREE.Vector2(rf(y), y)); }
  return colored(new THREE.LatheGeometry(pts, segs), col);
}
function buildFloat() {
  const m = mats();
  const object = new THREE.Group(); object.name = 'Lure_float';
  const bodyR = (y) => {
    const t = clamp((y - 0.021) / 0.052, 0, 1); // 0 bottom tip .. 1 top shoulder
    return 0.0013 + 0.0094 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.8);
  };
  const geos = [];
  geos.push(latheY(() => 0.0011, 0.0024, 0.0215, 1, 10, 0x1d1d1f));                // keel stem
  geos.push(latheY(bodyR, 0.0210, 0.0475, 14, 28, 0xf2eee6));                       // white lower body
  geos.push(latheY((y) => bodyR(y) + 0.00005, 0.0475, 0.0490, 1, 28, 0x111111));   // black ring
  geos.push(latheY(bodyR, 0.0490, 0.0732, 14, 28, 0xd3191f));                       // red upper body
  geos.push(latheY((y) => lerp(0.0019, 0.0014, (y - 0.0730) / 0.047), 0.0730, 0.0745, 1, 16, 0x111111));
  geos.push(latheY((y) => lerp(0.0019, 0.0014, (y - 0.0730) / 0.047), 0.0745, 0.1080, 3, 16, 0xf4d21c)); // yellow antenna
  geos.push(latheY((y) => lerp(0.0019, 0.0014, (y - 0.0730) / 0.047), 0.1080, 0.1190, 3, 16, 0xff3a12)); // fluo tip
  const cap = new THREE.SphereGeometry(lerp(0.0019, 0.0014, 0.046 / 0.047), 16, 6, 0, TAU, 0, Math.PI / 2); cap.translate(0, 0.1190, 0); geos.push(colored(cap, 0xff3a12));
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08 });
  object.add(new THREE.Mesh(merge(geos, true), mat));
  const eye = new THREE.TorusGeometry(0.0012, 0.00028, 6, 14); eye.translate(0, 0.0012, 0);
  object.add(new THREE.Mesh(eye, m.steel));

  // ---- bait rig: origin = leader top; split shot, hook eye 6 cm below, worm
  const bait = new THREE.Group(); bait.name = 'Bait_worm';
  bait.add(new THREE.Mesh(tube([V(0, 0, 0), V(0, -0.058, 0)], 0.00016, 4), m.leader));
  const shot = new THREE.SphereGeometry(0.0022, 14, 10); shot.scale(1, 0.92, 1); shot.translate(0, -0.016, 0);
  bait.add(new THREE.Mesh(shot, m.lead));
  const hook = new THREE.Mesh(singleHookGeo(0.020, 0.0068, 0.00048), m.hook);
  hook.rotation.x = -Math.PI / 2; // shank along -Y
  hook.position.set(0, -0.0585, 0);
  bait.add(hook);
  // live worm (deformed tube, rebuilt each frame)
  // threaded up the shank (hides it), point pokes out, tail + head end dangle and wriggle
  const ctrl = [V(-0.0072, -0.0745, 0.0015), V(-0.0060, -0.0655, 0.0012), V(-0.0024, -0.0602, 0.0006), V(0.0000, -0.0640, 0.0), V(0.0000, -0.0720, 0.0),
    V(0.0006, -0.0785, 0.0), V(0.0034, -0.0815, 0.0), V(0.0060, -0.0780, 0.0), V(0.0066, -0.0728, 0.0005), V(0.0086, -0.0790, 0.0012),
    V(0.0096, -0.0900, 0.0004), V(0.0074, -0.1010, -0.0010), V(0.0092, -0.1110, -0.0004), V(0.0070, -0.1195, 0.0008)];
  const WIG = [0.6, 0.35, 0.1, 0, 0, 0, 0, 0, 0.04, 0.25, 0.5, 0.75, 0.9, 1.0];
  const base = ctrl.map((p) => p.clone());
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  const NW = 64, RAD = 8;
  const wormR = (t) => {
    const ends = Math.min(1, t / 0.08, (1 - t) / 0.06);
    const clit = 1 + 0.22 * Math.exp(-Math.pow((t - 0.3) / 0.05, 2));
    return 0.0021 * (0.45 + 0.55 * Math.sqrt(Math.max(0, ends))) * clit * (1 + 0.06 * Math.cos(t * 300));
  };
  let pts = curve.getPoints(NW);
  const wormGeo = tube(pts, wormR, RAD);
  { const n = wormGeo.attributes.position.count, col = new Float32Array(n * 3);
    for (let j = 0; j <= NW; j++) for (let i = 0; i <= RAD; i++) {
      const t = j / NW, k = (j * (RAD + 1) + i) * 3, cl = Math.exp(-Math.pow((t - 0.3) / 0.05, 2)), ring = 0.9 + 0.1 * Math.cos(t * 300);
      const top = 0.85 + 0.15 * Math.cos(i / RAD * TAU);
      const c = new THREE.Color().setRGB(lerp(0.74, 0.86, cl) * ring * top, lerp(0.37, 0.52, cl) * ring * top, lerp(0.38, 0.47, cl) * ring * top, THREE.SRGBColorSpace);
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
    wormGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const wormMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25, sheen: 0.4, sheenColor: 0xffb0a8 });
  const worm = new THREE.Mesh(wormGeo, wormMat);
  worm.frustumCulled = false;
  bait.add(worm);

  let speed = 0, sp = 0, t = 0;
  return {
    object, bait,
    setMotion(s) { speed = Math.max(0, +s || 0); },
    update(dt) {
      t += dt; sp += (speed - sp) * (1 - Math.exp(-3 * dt));
      // float: tiny tilt when dragged by current
      object.children[0].rotation.z = 0.04 * smooth(clamp(sp, 0, 1)) * Math.sin(t * 2.1);
      // worm wriggle: free ends whip, hooked middle stays put
      const n = ctrl.length;
      for (let i = 0; i < n; i++) {
        const w = WIG[i];
        const a = t * (3.1 + (i < 5 ? 0.4 : -0.3)) + i * 0.9;
        ctrl[i].set(base[i].x + w * 0.0042 * Math.sin(a), base[i].y + w * 0.0016 * Math.sin(a * 0.7 + 1), base[i].z + w * 0.0042 * Math.cos(a * 1.3) - w * 0.008 * sp);
      }
      pts = curve.getPoints(NW);
      tubeWrite(wormGeo, pts, wormR, RAD);
    },
  };
}

// ---------------------------------------------------------------------------
export function createLure(type) {
  switch (type) {
    case 'spinner': return buildSpinner();
    case 'spoon': return buildSpoon();
    case 'minnow': return buildMinnow();
    case 'float': return buildFloat();
    default: throw new Error(`Unknown lure type: ${type}`);
  }
}
