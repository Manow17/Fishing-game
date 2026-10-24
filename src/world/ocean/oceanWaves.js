// Ocean wave model shared by the CPU (boats, floats) and the GPU (water shader).
//
// A sum of Gerstner (trochoidal) waves. Each wave i moves a surface point that rests at x0 to
//   P(x0) = x0 + att(x0) * sum_i  QA_i * D_i * cos f_i
//   y(x0) =      att(x0) * sum_i   A_i *       sin f_i,     f_i = k_i (D_i . x0) - w_i t + phi_i
// att is a baked 0..1 field (shoaling near the coast, harbour shelter) sampled identically on both sides.
// Because points also move horizontally, the CPU height at a world (x, z) first solves P(x0) = (x, z)
// with a few Newton steps (fixed-point is too slow to converge for steep storm seas).
//
// The GPU never sees huge phase arguments: the CPU computes every wave's phase at the water grid's
// origin in double precision (mod 2 pi) each frame, and the shader only adds k * (D . local).
// No three.js import here so the module can be unit-tested in node.
import { mulberry32, smoothstep } from '../../util/noise.js';

const G = 9.81;
const TAU = Math.PI * 2;
export const NW = 24;          // displacement waves (vertex shader + CPU)
export const ND = 12;          // normal-only detail waves (fragment shader)
export const WIND_ANGLE = 0.45; // waves travel toward (cos, sin) in (x, z): from the WSW to the ENE
export const WIND = [Math.cos(WIND_ANGLE), Math.sin(WIND_ANGLE)];

// summed horizontal steepness budget: crests sharpen with the sea state but the surface never folds
export let CHOP_K = 1.2, CHOP_MAX = 1.5;
export function setChop(k, m) { CHOP_K = k; CHOP_MAX = m; }
const gauss = (rnd) => (rnd() + rnd() + rnd() + rnd() - 2) * 0.866;

export class OceanWaves {
  constructor(seed = 1337) {
    const rnd = mulberry32(seed);
    const mk = (n) => ({ dx: new Float64Array(n), dz: new Float64Array(n), k: new Float64Array(n), a: new Float64Array(n), w: new Float64Array(n), p: new Float64Array(n), l: new Float64Array(n) });
    this.g = mk(NW);
    this.d = mk(ND);
    // swell + wind sea: wavelengths log-spaced 175 m .. 2.6 m, steepness rising toward the short waves
    for (let i = 0; i < NW; i++) {
      const u = i / (NW - 1);
      const lambda = 175 * Math.pow(2.6 / 175, u) * (0.93 + rnd() * 0.14);
      const k = TAU / lambda;
      // swell is long and gentle, the wind sea (20-60 m) carries the visible slope, chop a bit less
      const steep = 0.006 + 0.036 * smoothstep(0.1, 0.5, u);
      const spread = 0.3 + 0.55 * Math.sqrt(u);      // long swell is fairly aligned, the wind sea short-crested
      const ang = WIND_ANGLE + gauss(rnd) * spread + (i % 2 ? 0.22 : -0.22) * (1 - u);
      this._set(this.g, i, ang, k, steep / k, rnd() * TAU);
    }
    // capillary-ish ripples, normals only
    for (let i = 0; i < ND; i++) {
      const u = i / (ND - 1);
      const lambda = 2.1 * Math.pow(0.33 / 2.1, u) * (0.9 + rnd() * 0.2);
      const k = TAU / lambda;
      const ang = WIND_ANGLE + (i / ND - 0.5) * 3.4 + (rnd() - 0.5) * 0.5;   // fanned out: no beat stripes
      this._set(this.d, i, ang, k, 0.026 / k, rnd() * TAU);
    }
    // normalise so scale 1 gives a significant wave height of ~1.5 m (moderate sea, ~6 deg rms slope)
    let s2 = 0;
    for (let i = 0; i < NW; i++) s2 += this.g.a[i] * this.g.a[i];
    const hs = 4 * Math.sqrt(s2 / 2);
    const norm = 1.5 / hs;
    let sk = 0;
    for (let i = 0; i < NW; i++) { this.g.a[i] *= norm; sk += this.g.k[i] * this.g.a[i]; }
    this.hs = hs * norm;
    this.sumKA = sk;            // total steepness at scale 1
    this.ampSum = this.g.a.reduce((s, v) => s + v, 0);

    // effective (scaled) amplitudes
    this.A = new Float64Array(NW);
    this.QA = new Float64Array(NW);
    this.AD = new Float64Array(ND);
    this.scale = -1;
    this.setScale(1);

    // GPU uniform payloads (flat arrays; three accepts them for vec4[] / float[])
    this.uWA = new Float32Array(NW * 4);   // dir.x, dir.z, k, A
    this.uWB = new Float32Array(NW * 4);   // phase at origin, Q*A, lambda, k*A
    this.uDA = new Float32Array(ND * 4);   // dir.x, dir.z, k, A
    this.uDP = new Float32Array(ND);       // phase at origin
    this._packStatic();
  }

  _set(o, i, ang, k, a, p) {
    o.dx[i] = Math.cos(ang); o.dz[i] = Math.sin(ang);
    o.k[i] = k; o.a[i] = a; o.w[i] = Math.sqrt(G * k); o.p[i] = p; o.l[i] = TAU / k;
  }

  // Choppiness keeps the summed horizontal compression below 1 so crests sharpen but never loop.
  setScale(s) {
    s = Math.max(0, Math.min(4, +s || 0));
    if (s === this.scale) return;
    this.scale = s;
    const chop = Math.min(CHOP_MAX, CHOP_K / Math.max(1e-6, s * this.sumKA));
    for (let i = 0; i < NW; i++) { this.A[i] = this.g.a[i] * s; this.QA[i] = this.A[i] * chop; }
    const ds = 0.3 + 0.7 * Math.min(1, s) + 0.18 * Math.max(0, s - 1); // ripples never fully vanish
    for (let i = 0; i < ND; i++) this.AD[i] = this.d.a[i] * ds;
    this.chop = chop;
    if (this.uWA) this._packStatic();
  }

  _packStatic() {
    const g = this.g, d = this.d;
    for (let i = 0; i < NW; i++) {
      this.uWA.set([g.dx[i], g.dz[i], g.k[i], this.A[i]], i * 4);
      this.uWB[i * 4 + 1] = this.QA[i];
      this.uWB[i * 4 + 2] = g.l[i];
      this.uWB[i * 4 + 3] = g.k[i] * this.A[i];
    }
    for (let i = 0; i < ND; i++) this.uDA.set([d.dx[i], d.dz[i], d.k[i], this.AD[i]], i * 4);
  }

  // Per frame: phases at the water grid origin (ox, oz), computed in double precision.
  updatePhases(t, ox, oz) {
    const g = this.g, d = this.d;
    for (let i = 0; i < NW; i++) {
      const f = g.k[i] * (g.dx[i] * ox + g.dz[i] * oz) - g.w[i] * t + g.p[i];
      this.uWB[i * 4] = f - Math.floor(f / TAU) * TAU;
    }
    for (let i = 0; i < ND; i++) {
      const f = d.k[i] * (d.dx[i] * ox + d.dz[i] * oz) - d.w[i] * t + d.p[i];
      this.uDP[i] = f - Math.floor(f / TAU) * TAU;
    }
  }

  // Forward Gerstner map at rest position (x0, z0); fills out {x, z, y, jxx, jxz, jzx, jzz}
  // (unattenuated sums; caller multiplies by att).
  _sums(x0, z0, t, o) {
    const g = this.g, A = this.A, QA = this.QA;
    let sx = 0, sz = 0, sy = 0, axx = 0, axz = 0, azz = 0;
    for (let i = 0; i < NW; i++) {
      if (A[i] === 0) continue;
      const dx = g.dx[i], dz = g.dz[i], k = g.k[i];
      const f = k * (dx * x0 + dz * z0) - g.w[i] * t + g.p[i];
      const s = Math.sin(f), c = Math.cos(f);
      const q = QA[i] * c;
      sx += dx * q; sz += dz * q; sy += A[i] * s;
      const qk = QA[i] * k * s;
      axx += qk * dx * dx; axz += qk * dx * dz; azz += qk * dz * dz;
    }
    o.x = sx; o.z = sz; o.y = sy; o.axx = axx; o.axz = axz; o.azz = azz;
    return o;
  }

  // Height of the displaced surface above the calm level at world (x, z), time t.
  // attFn(x0, z0) -> 0..1 (same baked field the shader samples).
  height(x, z, t, attFn) {
    if (this.scale === 0) return 0;
    const o = _o;
    let x0 = x, z0 = z, att = 1;
    for (let it = 0; it < 5; it++) {
      att = attFn ? attFn(x0, z0) : 1;
      this._sums(x0, z0, t, o);
      const ex = x0 + att * o.x - x, ez = z0 + att * o.z - z;
      if (ex * ex + ez * ez < 1e-6) break;
      // Jacobian of P (att treated as locally constant)
      const jxx = 1 - att * o.axx, jxz = -att * o.axz, jzz = 1 - att * o.azz;
      const det = jxx * jzz - jxz * jxz;
      if (det > 0.05) { x0 -= (jzz * ex - jxz * ez) / det; z0 -= (jxx * ez - jxz * ex) / det; }
      else { x0 -= ex; z0 -= ez; }       // degenerate (should not happen): plain fixed-point step
    }
    att = attFn ? attFn(x0, z0) : 1;
    return att * this._sums(x0, z0, t, o).y;
  }

  // Forward map for tests / effects: where does the rest point (x0, z0) go?
  displaced(x0, z0, t, attFn, out = {}) {
    const att = attFn ? attFn(x0, z0) : 1;
    this._sums(x0, z0, t, _o);
    out.x = x0 + att * _o.x; out.z = z0 + att * _o.z; out.y = att * _o.y;
    return out;
  }
}
const _o = {};

// ---------------------------------------------------------------- GLSL
// Shared by vertex and fragment stages. Phases arrive per wave relative to uOrigin.
export const WAVES_GLSL = /* glsl */`
  #define NW ${NW}
  #define ND ${ND}
  uniform vec4 uWA[NW];   // dir.xz, k, A
  uniform vec4 uWB[NW];   // phase at origin, Q*A, lambda, k*A
  uniform vec4 uDA[ND];   // dir.xz, k, A
  uniform float uDP[ND];  // phase at origin
  uniform vec2 uOrigin;
`;
