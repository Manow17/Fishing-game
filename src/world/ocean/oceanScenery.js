// Things around the island: hazy silhouettes of distant islands on the horizon, and seagulls —
// flocks wheeling over the harbour and the cliffs, a few that shadow the player's boat, and some
// bobbing on the water.
import * as THREE from 'three';
import { Simplex2, mulberry32, smoothstep } from '../../util/noise.js';
import { ENV } from '../env.js';

const DISTANT = [
  { x: 9800, z: -7600, R: 2300, H: 420, seed: 1 },
  { x: 15500, z: 2600, R: 1900, H: 140, seed: 2, sx: 1.6 },
  { x: -11500, z: 8200, R: 1700, H: 260, seed: 3 },
  { x: -8600, z: -10200, R: 1100, H: 330, seed: 4 },
  { x: 3500, z: 14500, R: 2600, H: 95, seed: 5, sx: 2.2 },
  { x: -15500, z: -1200, R: 1400, H: 190, seed: 6 },
];

function distantIsland(D) {
  const nz = new Simplex2(D.seed * 13 + 1);
  const RINGS = 16, SEG = 72;
  const pos = [], colr = [], idx = [];
  pos.push(0, D.H, 0); colr.push(0.42, 0.44, 0.38);
  for (let r = 1; r <= RINGS; r++) {
    for (let s = 0; s < SEG; s++) {
      const a = s / SEG * Math.PI * 2;
      const edge = D.R * (1 + 0.28 * nz.noise(Math.cos(a) * 1.3, Math.sin(a) * 1.3) + 0.1 * nz.noise(Math.cos(a) * 4, Math.sin(a) * 4));
      const t = r / RINGS, rr = edge * t;
      let x = Math.cos(a) * rr * (D.sx || 1), z = Math.sin(a) * rr;
      const ridge = 0.65 + 0.35 * Math.abs(nz.noise(x * 0.0009, z * 0.0009));
      let y = D.H * Math.pow(Math.max(0, 1 - t * t), 1.35) * ridge * (1 + 0.15 * nz.noise(x * 0.003, z * 0.003));
      if (r === RINGS) y = -12;
      pos.push(x, y, z);
      const rock = smoothstep(0.55, 0.9, y / D.H);
      const k = 0.85 + 0.2 * nz.noise(x * 0.004, z * 0.004);
      colr.push((0.3 + 0.2 * rock) * k, (0.36 + 0.12 * rock) * k, (0.24 + 0.2 * rock) * k);
    }
  }
  for (let s = 0; s < SEG; s++) idx.push(0, 1 + ((s + 1) % SEG), 1 + s);
  for (let r = 0; r < RINGS - 1; r++) for (let s = 0; s < SEG; s++) {
    const a = 1 + r * SEG + s, b = 1 + r * SEG + ((s + 1) % SEG), c = a + SEG, d = b + SEG;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- gulls
// One small mesh per bird (≈ 30 vertices, wings bent on the CPU: shoulder + elbow joints).
function gullGeometry() {
  const P = [], C = [], idx = [];
  const W = [0.95, 0.95, 0.94], G = [0.62, 0.65, 0.69], K = [0.08, 0.08, 0.09], Y = [0.95, 0.75, 0.2];
  const v = (x, y, z, c) => { P.push(x, y, z); C.push(...c); return P.length / 3 - 1; };
  // body (diamond section) nose +z, tail -z
  const n = v(0, 0, 0.33, W), t = v(0, 0.01, -0.28, W), tl = v(-0.07, 0.01, -0.3, W), tr = v(0.07, 0.01, -0.3, W);
  const top = v(0, 0.065, 0.02, W), bot = v(0, -0.06, 0.02, W), l = v(-0.065, 0, 0.02, W), r = v(0.065, 0, 0.02, W);
  const beak = v(0, -0.005, 0.42, Y);
  idx.push(n, top, l, n, r, top, n, l, bot, n, bot, r, t, l, top, t, top, r, t, bot, l, t, r, bot, n, beak, top, tl, t, tr);
  // wings: shoulder (x=0.05), elbow (0.36), tip (0.7); leading edge forward, trailing edge back
  const wing = (s) => {
    const a = v(s * 0.05, 0.02, 0.1, G), b = v(s * 0.05, 0.02, -0.12, G);
    const c = v(s * 0.36, 0.03, 0.08, G), d = v(s * 0.36, 0.03, -0.14, G);
    const e = v(s * 0.58, 0.03, 0.0, G), f = v(s * 0.55, 0.03, -0.13, K);
    const g = v(s * 0.72, 0.03, -0.1, K);
    if (s > 0) idx.push(a, c, b, b, c, d, c, e, d, d, e, f, e, g, f);
    else idx.push(a, b, c, b, d, c, c, d, e, d, f, e, e, f, g);
    return [a, b, c, d, e, f, g];
  };
  const L = wing(-1), R = wing(1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo, wings: [L, R] };
}

export function createScenery(scene, ctx) {
  const { time, layout } = ctx;
  const rnd = mulberry32(31337);
  // ---- distant islands
  const isMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, envMapIntensity: 0.6 });
  for (const D of DISTANT) {
    const m = new THREE.Mesh(distantIsland(D), isMat);
    m.position.set(D.x, 0, D.z);
    m.rotation.y = D.seed * 1.7;
    m.name = 'distantIsland';
    scene.add(m);
  }

  // ---- gulls
  const gmat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
  const birds = [];
  const harbour = { x: 705, z: 45 }, cliffs = { x: -200, z: -520 }, lh = layout.lighthouse || { x: -936, z: 168 };
  const mk = (mode, center, extra = {}) => {
    const { geo, wings } = gullGeometry();
    const base = geo.attributes.position.array.slice();
    const m = new THREE.Mesh(geo, gmat);
    m.castShadow = true;
    m.scale.setScalar(0.95 + rnd() * 0.3);
    m.frustumCulled = false;
    scene.add(m);
    birds.push({
      m, geo, wings, base, mode, c: { ...center }, home: { ...center },
      r: 18 + rnd() * 60, h: 10 + rnd() * 28, w: (0.18 + rnd() * 0.18) * (rnd() < 0.5 ? 1 : -1), ph: rnd() * 6.28,
      flapT: rnd() * 5, flapping: 0, fp: rnd() * 6.28, bob: rnd() * 6.28, ...extra,
    });
  };
  for (let i = 0; i < 9; i++) mk('circle', harbour);
  for (let i = 0; i < 4; i++) mk('circle', cliffs, { r: 40 + rnd() * 80, h: 40 + rnd() * 50 });
  for (let i = 0; i < 3; i++) mk('circle', lh, { r: 25 + rnd() * 40, h: 35 + rnd() * 30 });
  for (let i = 0; i < 5; i++) mk('follow', harbour, { r: 14 + rnd() * 26, h: 7 + rnd() * 14 });
  const floatSpots = [[700, 30], [712, 70], [690, 55], [800, 40], [820, 10], [760, 150], [640, 160]];
  for (const [x, z] of floatSpots) mk('float', { x: x + (rnd() - 0.5) * 10, z: z + (rnd() - 0.5) * 10 });

  const tmp = new THREE.Vector3();
  const bend = (b, flap, fold) => {
    // rotate wing points about the shoulder (angle a1) and the outer part about the elbow (a2)
    const p = b.geo.attributes.position.array, base = b.base;
    const a1 = flap, a2 = flap * 0.7;
    for (let s = 0; s < 2; s++) {
      const sg = s === 0 ? -1 : 1, ids = b.wings[s];
      const c1 = Math.cos(a1), s1 = Math.sin(a1), c2 = Math.cos(a1 + a2), s2 = Math.sin(a1 + a2);
      // elbow position after the shoulder rotation
      const ex = 0.05 + (0.36 - 0.05) * c1, ey = 0.02 + (0.36 - 0.05) * s1;
      for (let k = 0; k < ids.length; k++) {
        const i = ids[k] * 3;
        let lx = Math.abs(base[i]), y = base[i + 1], z = base[i + 2];
        let nx, ny;
        if (lx <= 0.37) { nx = 0.05 + (lx - 0.05) * c1; ny = 0.02 + (lx - 0.05) * s1; }
        else { nx = ex + (lx - 0.36) * c2; ny = ey + (lx - 0.36) * s2; }
        // folded (floating): wings tucked along the body
        nx = nx * (1 - fold) + (0.06 + (lx - 0.05) * 0.08) * fold;
        ny = ny * (1 - fold) + (0.05) * fold;
        const zz = z * (1 - fold) + (z - (lx - 0.05) * 0.55) * fold;
        p[i] = sg * nx; p[i + 1] = ny + (y - 0.02) * 0; p[i + 2] = zz;
      }
    }
    b.geo.attributes.position.needsUpdate = true;
  };

  let focus = new THREE.Vector3();
  return {
    update(dt, t, cam, f) {
      if (f) focus.copy(f); else focus.copy(cam.position);
      for (const b of birds) {
        if (b.mode === 'float') {
          const y = ENV.surface(b.c.x, b.c.z);
          b.m.position.set(b.c.x, y + 0.05, b.c.z);
          b.m.rotation.set(Math.sin(t * 1.3 + b.bob) * 0.08, b.ph + Math.sin(t * 0.1 + b.bob) * 0.5, Math.sin(t * 1.7 + b.bob) * 0.1);
          // drift slowly with the current
          const fl = ENV.flowAt(b.c.x, b.c.z, tmp);
          b.c.x += fl.x * dt * 0.5; b.c.z += fl.z * dt * 0.5;
          if (Math.hypot(b.c.x - b.home.x, b.c.z - b.home.z) > 40) { b.c.x = b.home.x; b.c.z = b.home.z; }
          if (!b.folded) { bend(b, 0, 1); b.folded = true; }
          continue;
        }
        if (b.mode === 'follow') {
          // gulls trail a boat: drift toward the player's position, lazily
          const k = Math.min(1, dt * 0.08);
          b.c.x += (focus.x - b.c.x) * k; b.c.z += (focus.z - b.c.z) * k;
        }
        const a = t * b.w + b.ph;
        const R = b.r * (1 + 0.15 * Math.sin(t * 0.13 + b.ph));
        const x = b.c.x + Math.cos(a) * R, z = b.c.z + Math.sin(a) * R;
        const ground = Math.max(0, ENV.groundY(x, z));
        const y = ground + b.h + Math.sin(t * 0.37 + b.ph * 2) * 4;
        b.m.position.set(x, y, z);
        const dir = Math.sign(b.w);
        // heading along the circle (local +z is the beak), banked into the turn
        b.m.rotation.set(0, dir > 0 ? -a : Math.PI - a, -dir * 0.32, 'YXZ');
        // glide most of the time, flap in short bursts
        b.flapT -= dt;
        if (b.flapT <= 0) { b.flapping = b.flapping > 0 ? 0 : 1.2 + rnd() * 1.5; b.flapT = b.flapping > 0 ? b.flapping : 3 + rnd() * 7; }
        b.fp += dt * 9;
        const flap = b.flapping > 0 ? Math.sin(b.fp) * 0.55 + 0.1 : 0.12 + Math.sin(t * 0.8 + b.ph) * 0.05;
        bend(b, flap, 0);
      }
    },
  };
}
