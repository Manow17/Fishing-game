// Ocean map terrain: bakes the analytic island (islandShape.js) into fast height grids, derives the
// data the water needs (depth, wave attenuation, distance to shore, reef) as float textures, and
// builds the island / shallow sea-bed mesh with a splat + underwater shader.
import * as THREE from 'three';
import { sampleIsland, PLACES, basinSDF } from './islandShape.js';
import { smoothstep, mulberry32, tileFbm } from '../../util/noise.js';
import { makeCanvas, paintPixels, toTexture, wrapDraw } from '../../util/textures.js';
import { UNDERWATER_PARS } from './oceanShading.js';

export const NEAR = { x0: -1302, z0: -1302, step: 3, n: 869 };    // island + shallows, 3 m
export const FAR = { x0: -7212, z0: -7212, step: 30, n: 482 };    // shelf, drop-off, deep sea, 30 m (every 10th near sample coincides)
export const DEEP = -950;

const yieldRaw = () => new Promise(r => { requestAnimationFrame(() => r()); setTimeout(r, 40); });
const half = (v) => THREE.DataUtils.fromHalfFloat(THREE.DataUtils.toHalfFloat(v));

// ---------------------------------------------------------------- bake
export async function bakeOcean(progress = () => {}, p0 = 0, p1 = 0.3) {
  const t0 = performance.now();
  let waited = 0;
  const yieldFrame = async () => { const t = performance.now(); await yieldRaw(); waited += performance.now() - t; };
  const N = NEAR.n, F = FAR.n;
  const H = new Float32Array(N * N);
  const splat = new Uint8Array(N * N * 4);     // pave, reef, sand, cliff
  const o = {};
  for (let j = 0; j < N; j++) {
    const z = NEAR.z0 + j * NEAR.step;
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      sampleIsland(NEAR.x0 + i * NEAR.step, z, o);
      H[k] = o.h;
      splat[k * 4] = o.pave * 255; splat[k * 4 + 1] = o.reef * 255; splat[k * 4 + 2] = o.sand * 255; splat[k * 4 + 3] = o.cliff * 255;
    }
    if ((j & 127) === 127) { progress(p0 + (p1 - p0) * 0.75 * j / N, 'Raising the island…'); await yieldFrame(); }
  }
  // far grid: copy samples that coincide with the near grid (every 8th near sample)
  const FH = new Float32Array(F * F);
  const ratio = FAR.step / NEAR.step, off = (NEAR.x0 - FAR.x0) / FAR.step;
  for (let j = 0; j < F; j++) {
    const z = FAR.z0 + j * FAR.step;
    for (let i = 0; i < F; i++) {
      const ni = (i - off) * ratio, nj = (j - off) * ratio;
      if (ni >= 0 && nj >= 0 && ni < N && nj < N) FH[j * F + i] = H[nj * N + ni];
      else FH[j * F + i] = sampleIsland(FAR.x0 + i * FAR.step, z, o).h;
    }
  }
  progress(p0 + (p1 - p0) * 0.85, 'Sounding the depths…'); await yieldFrame();

  // signed distance to the shoreline (m, + at sea), two-pass chamfer on the near grid
  const shore = chamferSigned(H, N, NEAR.step);

  // wave attenuation: shoaling in the shallows, shelter inside the harbour
  const attOf = (h, x, z) => {
    const depth = Math.max(0, -h);
    let a = 0.2 + 0.8 * smoothstep(0, 9, depth);
    const bx = x - (PLACES.basin.x0 + PLACES.basin.x1) / 2, bz = z - (PLACES.basin.z0 + PLACES.basin.z1) / 2;
    if (bx * bx + bz * bz < 300 * 300) a *= 0.07 + 0.93 * smoothstep(-8, 60, basinSDF(x, z));
    return a;
  };
  let att = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) att[j * N + i] = attOf(H[j * N + i], NEAR.x0 + i * NEAR.step, NEAR.z0 + j * NEAR.step);
  att = blur(blur(att, N), N);
  const FA = new Float32Array(F * F);
  for (let j = 0; j < F; j++) for (let i = 0; i < F; i++) FA[j * F + i] = attOf(FH[j * F + i], FAR.x0 + i * FAR.step, FAR.z0 + j * FAR.step);
  for (let k = 0; k < att.length; k++) att[k] = half(att[k]);   // CPU uses exactly what the GPU samples
  for (let k = 0; k < FA.length; k++) FA[k] = half(FA[k]);

  // GPU textures (texel i is centred on grid sample i)
  const nearData = new Uint16Array(N * N * 4), farData = new Uint16Array(F * F * 4);
  const TH = THREE.DataUtils.toHalfFloat;
  for (let k = 0; k < N * N; k++) {
    nearData[k * 4] = TH(Math.max(-500, Math.min(800, H[k])));
    nearData[k * 4 + 1] = TH(att[k]);
    nearData[k * 4 + 2] = TH(shore[k]);
    nearData[k * 4 + 3] = TH(splat[k * 4 + 1] / 255);
  }
  for (let k = 0; k < F * F; k++) {
    farData[k * 4] = TH(FH[k]); farData[k * 4 + 1] = TH(FA[k]); farData[k * 4 + 2] = TH(400); farData[k * 4 + 3] = 0;
  }
  const mkTex = (data, n) => {
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  const rect = (G) => new THREE.Vector4(G.x0 - G.step / 2, G.z0 - G.step / 2, 1 / (G.n * G.step), 1 / (G.n * G.step));

  const bakeMs = performance.now() - t0 - waited;
  console.log(`[ocean] bake ${bakeMs.toFixed(0)} ms of work`);
  return {
    H, splat, shore, att, FH, FA, bakeMs, waited,
    tNear: mkTex(nearData, N), tFar: mkTex(farData, F),
    nearRect: rect(NEAR), farRect: rect(FAR),
  };
}

function blur(a, n) {
  const out = new Float32Array(a.length);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      s += a[jj * n + ii]; c++;
    }
    out[j * n + i] = s / c;
  }
  return out;
}

// Signed distance (m) to the h = 0 contour: positive over water, negative on land.
function chamferSigned(H, n, step) {
  const INF = 1e9, d1 = step, d2 = step * Math.SQRT2;
  const run = (isSrc) => {
    const d = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) d[k] = isSrc(k) ? 0 : INF;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i; let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + d1);
      if (j > 0) { v = Math.min(v, d[k - n] + d1); if (i > 0) v = Math.min(v, d[k - n - 1] + d2); if (i < n - 1) v = Math.min(v, d[k - n + 1] + d2); }
      d[k] = v;
    }
    for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i; let v = d[k];
      if (i < n - 1) v = Math.min(v, d[k + 1] + d1);
      if (j < n - 1) { v = Math.min(v, d[k + n] + d1); if (i < n - 1) v = Math.min(v, d[k + n + 1] + d2); if (i > 0) v = Math.min(v, d[k + n - 1] + d2); }
      d[k] = v;
    }
    return d;
  };
  const toLand = run((k) => H[k] > 0), toSea = run((k) => H[k] <= 0);
  const out = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) out[k] = Math.max(-300, Math.min(300, H[k] > 0 ? -toSea[k] + step * 0.5 : toLand[k] - step * 0.5));
  return out;
}

// ---------------------------------------------------------------- fast lookups (installed into ENV)
export function makeSampler(B) {
  const N = NEAR.n, F = FAR.n;
  function bil(arr, G, n, x, z, fallback) {
    let fx = (x - G.x0) / G.step, fz = (z - G.z0) / G.step;
    if (!(fx >= 0 && fz >= 0 && fx <= n - 1 && fz <= n - 1)) return fallback;
    let i = fx | 0, j = fz | 0;
    if (i >= n - 1) i = n - 2;
    if (j >= n - 1) j = n - 2;
    const tx = fx - i, tz = fz - j, k = j * n + i;
    return (arr[k] * (1 - tx) + arr[k + 1] * tx) * (1 - tz) + (arr[k + n] * (1 - tx) + arr[k + n + 1] * tx) * tz;
  }
  const S = {
    groundY(x, z) {
      const v = bil(B.H, NEAR, N, x, z, NaN);
      if (v === v) return v;
      return bil(B.FH, FAR, F, x, z, DEEP);
    },
    // GPU-identical linear filtering (texel centres on grid samples, clamp to edge)
    att(x, z) {
      const v = bil(B.att, NEAR, N, x, z, NaN);
      if (v === v) return v;
      return bil(B.FA, FAR, F, x, z, 1);
    },
    shoreDist(x, z) { return bil(B.shore, NEAR, N, x, z, 300); },
    reef(x, z) {
      const fx = Math.round((x - NEAR.x0) / NEAR.step), fz = Math.round((z - NEAR.z0) / NEAR.step);
      if (fx < 0 || fz < 0 || fx >= N || fz >= N) {
        const sm = Math.hypot(x - PLACES.seamount.x, z - PLACES.seamount.z);
        return 1 - smoothstep(80, 260, sm);
      }
      return B.splat[(fz * N + fx) * 4 + 1] / 255;
    },
    // bottom slope (rise / run) over ~2 far cells: drop-offs and walls
    slope(x, z) {
      const e = 30;
      const gx = S.groundY(x + e, z) - S.groundY(x - e, z), gz = S.groundY(x, z + e) - S.groundY(x, z - e);
      return Math.hypot(gx, gz) / (2 * e);
    },
  };
  return S;
}

// ---------------------------------------------------------------- textures
export function sandTexture(size = 512) {
  const n1 = tileFbm(71, 8, 5), n2 = tileFbm(72, 64, 2);
  const c = makeCanvas(size);
  const ctx = paintPixels(c, (u, v) => {
    const a = n1(u, v), b = n2(u, v);
    const k = 0.86 + a * 0.22 + (b - 0.5) * 0.16;
    return [236 * k, 218 * k, 178 * k];
  });
  const rnd = mulberry32(73);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * size, y = rnd() * size, r = 0.4 + rnd() * 1.1, t = rnd();
    ctx.fillStyle = t < 0.5 ? `rgba(120,100,80,${0.15 + rnd() * 0.3})` : t < 0.85 ? `rgba(255,250,235,${0.3 + rnd() * 0.4})` : `rgba(190,120,90,${0.2 + rnd() * 0.3})`;
    wrapDraw(ctx, size, x, y, r, (px, py) => { ctx.beginPath(); ctx.arc(px, py, r, 0, 6.283); ctx.fill(); });
  }
  return toTexture(c);
}

// Irregular limestone flagstones (quay, mole top)
export function paveTexture(size = 512) {
  const G = 7, rnd = mulberry32(81);
  const pts = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) pts.push([(i + 0.15 + rnd() * 0.7) / G, (j + 0.15 + rnd() * 0.7) / G, 0.8 + rnd() * 0.35, rnd()]);
  const n1 = tileFbm(82, 16, 4);
  const c = makeCanvas(size);
  paintPixels(c, (u, v) => {
    // jittered-grid Voronoi: only the 3x3 neighbouring cells can hold the two nearest points
    let d1 = 9, d2 = 9, best = pts[0];
    const ci = Math.floor(u * G), cj = Math.floor(v * G);
    for (let oj = -1; oj <= 1; oj++) for (let oi = -1; oi <= 1; oi++) {
      const ii = ci + oi, jj = cj + oj;
      const wi = (ii + G) % G, wj = (jj + G) % G;
      const p = pts[wj * G + wi];
      const px = p[0] + (ii - wi) / G, py = p[1] + (jj - wj) / G;
      const dx = u - px, dy = v - py, d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
    }
    const edge = Math.sqrt(d2) - Math.sqrt(d1);
    const grout = smoothstep(0.004, 0.012, edge);
    const n = n1(u, v);
    const k = best[2] * (0.85 + n * 0.3);
    const warm = best[3];
    const base = [205 + warm * 25, 198 + warm * 12, 182 - warm * 10];
    const g = [110, 104, 92];
    return [g[0] + (base[0] * k - g[0]) * grout, g[1] + (base[1] * k - g[1]) * grout, g[2] + (base[2] * k - g[2]) * grout];
  });
  return toTexture(c);
}

// ---------------------------------------------------------------- terrain mesh + material
export function createOceanTerrainMaterial(shared, waterU) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  const uniforms = {
    tGrass: { value: shared.grass }, tRock: { value: shared.rock }, tSand: { value: shared.sand },
    tPave: { value: shared.pave }, tNoise: { value: shared.noise },
    ...waterU,
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSplat;\nvarying vec4 vSplat;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vSplat = aSplat;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vSplat;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        uniform sampler2D tGrass, tRock, tSand, tPave, tNoise;
        ${UNDERWATER_PARS}`)
      .replace('#include <map_fragment>', `
        vec3 wp = vWPos;
        vec3 wn = normalize(vWNormal);
        vec3 fc = cross(dFdx(vWPos), dFdy(vWPos));
        vec3 fN = dot(fc, fc) > 1e-10 ? normalize(fc) : wn;
        float slope = 1.0 - min(wn.y, abs(fN.y));
        float camDist = length(cameraPosition - wp);
        vec4 sp = clamp(vSplat, 0.0, 1.0);          // pave, reef, sand, cliff
        vec3 nTri = abs(fN.y) < wn.y ? fN : wn;
        vec3 bw = pow(abs(nTri), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        #define TRI(t, s) (texture2D(t, wp.zy * (s)) * bw.x + texture2D(t, wp.xz * (s)) * bw.y + texture2D(t, wp.xy * (s)) * bw.z)
        vec4 nz = TRI(tNoise, 0.0023);
        vec4 nzb = TRI(tNoise, 0.021);
        float h = wp.y;
        // sun-dried Mediterranean meadow, maquis patches, red earth
        vec3 g1 = texture2D(tGrass, wp.xz * 0.19).rgb;
        vec3 g2 = texture2D(tGrass, wp.xz * 0.031 + 0.3).rgb;
        vec3 grass = mix(g1, g2, smoothstep(30.0, 160.0, camDist) * 0.7 + 0.15);
        float gl = dot(grass, vec3(0.3, 0.59, 0.11));
        grass = mix(grass, vec3(gl) * vec3(1.32, 1.14, 0.6), 0.5);
        grass *= mix(vec3(0.72, 0.84, 0.5), vec3(1.18, 1.02, 0.68), smoothstep(0.3, 0.75, nz.r));
        float scrub = smoothstep(0.47, 0.6, nz.g + nzb.r * 0.25) * smoothstep(3.0, 9.0, h);
        grass = mix(grass, vec3(0.075, 0.105, 0.045) * (0.75 + nzb.g * 0.6), scrub * 0.8);
        float soil = smoothstep(0.62, 0.8, nz.b + nzb.a * 0.15);
        grass = mix(grass, vec3(0.45, 0.3, 0.18) * (0.85 + nzb.r * 0.3), soil * 0.3);
        // pale limestone
        vec3 rock = TRI(tRock, 0.06).rgb;
        vec3 rockFar = TRI(tRock, 0.0085).rgb;
        rock = mix(rock, rockFar, smoothstep(60.0, 420.0, camDist));
        rock *= vec3(1.12, 1.03, 0.88) * mix(0.72, 1.12, nzb.r) * mix(0.85, 1.08, nz.b);
        // limestone bedding planes and dark water-stain streaks down the cliff faces
        float strata = 0.5 + 0.5 * sin(wp.y * 0.85 + nz.r * 7.0 + nzb.g * 2.5);
        rock *= mix(0.8, 1.06, smoothstep(0.15, 0.85, strata));
        float stain = texture2D(tNoise, vec2(dot(wp.xz, vec2(0.71, 0.71)) * 0.045, wp.y * 0.0035)).g;
        rock *= mix(1.0, 0.68, smoothstep(0.56, 0.78, stain) * smoothstep(0.35, 0.6, slope));
        rock = mix(rock, rock * vec3(1.15, 0.92, 0.72), smoothstep(0.6, 0.8, nz.a) * 0.5);   // ochre patches
        // sand
        vec3 sand = texture2D(tSand, wp.xz * 0.23).rgb;
        sand = mix(sand, texture2D(tSand, wp.xz * 0.041).rgb, smoothstep(20.0, 140.0, camDist) * 0.6) * mix(0.88, 1.08, nzb.g);
        vec3 pave = texture2D(tPave, wp.xz * 0.3).rgb * mix(0.86, 1.06, nzb.r) * mix(0.92, 1.04, nz.g);
        #undef TRI
        float wSand = sp.z * (1.0 - smoothstep(2.4, 4.6, h + (nzb.r - 0.5) * 2.2));
        wSand = max(wSand, (1.0 - smoothstep(-0.3, 0.5, h)) * (1.0 - sp.w * 0.7));
        float wRock = max(smoothstep(0.34, 0.5, slope + (nzb.g - 0.5) * 0.2), sp.w * smoothstep(0.1, 0.28, slope + (nzb.b - 0.5) * 0.15));
        wRock = max(wRock, smoothstep(0.6, 0.7, slope));
        vec3 col = grass;
        col = mix(col, sand, wSand);
        col = mix(col, rock, wRock * (1.0 - sp.x));
        col = mix(col, pave, sp.x * (1.0 - smoothstep(0.6, 0.8, slope)));
        if (h < 0.0) {
          float dep = -h;
          vec4 nc = texture2D(tNoise, wp.xz * 0.045);
          // seagrass meadows on the sand
          float sg = smoothstep(0.56, 0.66, nz.b + nzb.a * 0.18) * smoothstep(2.0, 4.0, dep) * (1.0 - smoothstep(15.0, 22.0, dep)) * (1.0 - sp.y) * (1.0 - sp.x);
          col = mix(col, vec3(0.06, 0.12, 0.045) * (0.7 + nzb.r * 0.6), sg * (1.0 - wRock));
          // coral: patchy pinks, oranges, purples and olive greens on a rocky base
          vec3 cA = mix(vec3(0.82, 0.32, 0.4), vec3(0.95, 0.6, 0.22), smoothstep(0.35, 0.65, nc.r));
          vec3 cB = mix(vec3(0.42, 0.28, 0.66), vec3(0.5, 0.66, 0.36), smoothstep(0.35, 0.65, nc.g));
          float fineC = mix(texture2D(tNoise, wp.xz * 0.6).a, 0.5, smoothstep(15.0, 70.0, camDist));   // no speckle far away
          vec3 coral = mix(cA, cB, smoothstep(0.42, 0.58, nc.b)) * (0.55 + 0.7 * fineC);
          coral = mix(coral, vec3(dot(coral, vec3(0.33))) * vec3(0.95, 0.8, 0.75), smoothstep(30.0, 140.0, camDist) * 0.5);
          float cm = sp.y * smoothstep(0.25, 0.5, nc.a + sp.y * 0.3);
          col = mix(col, mix(rock * vec3(0.8, 0.78, 0.7), coral, 0.85), cm);
          col = mix(col, col * vec3(0.7, 0.68, 0.6), sp.y * (1.0 - cm) * 0.6);
          col += vec3(0.9, 1.0, 0.92) * causticsWorld(wp, wn) * 0.32;
        }
        float wet = (1.0 - smoothstep(0.05, 0.85, h + (nzb.r - 0.5) * 0.35)) * step(-0.2, h);
        col *= mix(1.0, 0.6, wet * (1.0 - sp.x * 0.5));
        diffuseColor.rgb *= col;
        float tRough = mix(mix(0.93, 0.84, wRock), 0.45, wet);
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', `
        {
          // rock relief from triplanar noise gradients; sand ripples on the beach and sea bed
          float k = mix(0.25, 1.5, wRock) * (1.0 - sp.x * 0.7);
          vec3 g = vec3(0.0);
          for (int o = 0; o < 2; o++) {
            float f = o == 0 ? 0.04 : 0.19;
            float amp = o == 0 ? 1.0 : 0.45;
            float e = o == 0 ? 0.7 : 0.18;
            #define BH(p) (texture2D(tNoise, (p).zy * f).r * bw.x + texture2D(tNoise, (p).xz * f).g * bw.y + texture2D(tNoise, (p).xy * f).b * bw.z)
            float h0 = BH(wp);
            g += amp * vec3(BH(wp + vec3(e, 0.0, 0.0)) - h0, BH(wp + vec3(0.0, e, 0.0)) - h0, BH(wp + vec3(0.0, 0.0, e)) - h0) / e;
            #undef BH
          }
          g *= k * (1.0 - smoothstep(60.0, 900.0, camDist)) + k * 0.35;
          vec3 wnB = normalize(wn - (g - dot(g, wn) * wn) * 2.0);
          // ripples (wave-formed, along the swell crests) where there is sand
          float rip = wSand * (1.0 - wRock) * (1.0 - smoothstep(25.0, 90.0, camDist)) * (1.0 - smoothstep(18.0, 30.0, -h));
          if (rip > 0.001) {
            vec2 rd = normalize(vec2(0.9, -0.43) + (texture2D(tNoise, wp.xz * 0.01).rg - 0.5) * 0.8);
            float ph = dot(wp.xz, rd) * 3.3 + texture2D(tNoise, wp.xz * 0.03).b * 9.0;
            vec2 rg = rd * cos(ph) * 0.09 * rip;
            wnB = normalize(wnB - vec3(rg.x, 0.0, rg.y));
          }
          normal = normalize((viewMatrix * vec4(wnB, 0.0)).xyz);
        }
      `)
      .replace('#include <fog_fragment>', `gl_FragColor.rgb = underwater(gl_FragColor.rgb, vWPos);
        #include <fog_fragment>`);
  };
  mat.customProgramCacheKey = () => 'ocean-terrain-v1';
  return mat;
}

export function createOceanTerrain(scene, B, material) {
  const N = NEAR.n, H = B.H, step = NEAR.step;
  // normals from central differences over the whole grid (seamless chunks)
  const nor = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const hl = H[j * N + Math.max(0, i - 1)], hr = H[j * N + Math.min(N - 1, i + 1)];
    const hd = H[Math.max(0, j - 1) * N + i], hu = H[Math.min(N - 1, j + 1) * N + i];
    const nx = hl - hr, ny = 2 * step, nz = hd - hu, l = Math.hypot(nx, ny, nz);
    const k = (j * N + i) * 3;
    nor[k] = nx / l; nor[k + 1] = ny / l; nor[k + 2] = nz / l;
  }
  const C = 64, chunks = [];
  let tris = 0;
  for (let j0 = 0; j0 < N - 1; j0 += C) for (let i0 = 0; i0 < N - 1; i0 += C) {
    const j1 = Math.min(N - 1, j0 + C), i1 = Math.min(N - 1, i0 + C);
    let maxH = -1e9;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) maxH = Math.max(maxH, H[j * N + i]);
    if (maxH < -34) continue;             // deep water is opaque: no sea bed needed
    const w = i1 - i0 + 1, h = j1 - j0 + 1;
    const pos = new Float32Array(w * h * 3), nrm = new Float32Array(w * h * 3), spl = new Uint8Array(w * h * 4);
    let k = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++, k++) {
      const g = j * N + i;
      pos[k * 3] = NEAR.x0 + i * step; pos[k * 3 + 1] = H[g]; pos[k * 3 + 2] = NEAR.z0 + j * step;
      nrm[k * 3] = nor[g * 3]; nrm[k * 3 + 1] = nor[g * 3 + 1]; nrm[k * 3 + 2] = nor[g * 3 + 2];
      spl[k * 4] = B.splat[g * 4]; spl[k * 4 + 1] = B.splat[g * 4 + 1]; spl[k * 4 + 2] = B.splat[g * 4 + 2]; spl[k * 4 + 3] = B.splat[g * 4 + 3];
    }
    const idx = [];
    for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
      const g = (j0 + j) * N + (i0 + i);
      // skip quads entirely below -36 m
      if (Math.max(H[g], H[g + 1], H[g + N], H[g + N + 1]) < -36) continue;
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      // split along the diagonal that follows the terrain better
      if (Math.abs(H[g] - H[g + N + 1]) < Math.abs(H[g + 1] - H[g + N])) idx.push(a, c, d, a, d, b);
      else idx.push(a, c, b, b, c, d);
    }
    if (!idx.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('aSplat', new THREE.BufferAttribute(spl, 4, true));
    geo.setIndex(idx);
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.name = 'oceanTerrain';
    scene.add(mesh);
    chunks.push(mesh);
    tris += idx.length / 3;
  }
  return { chunks, triangles: tris };
}

// Grass field bake for createGrass(): height + density (RG half float) over the near grid.
export function bakeGrass(B) {
  const N = NEAR.n, H = B.H;
  const data = new Uint16Array(N * N * 2);
  const TH = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, y = H[k];
    const sx = H[j * N + Math.min(N - 1, i + 1)] - y, sz = H[Math.min(N - 1, j + 1) * N + i] - y;
    const slope = Math.hypot(sx, sz) / NEAR.step;
    const pave = B.splat[k * 4] / 255, sand = B.splat[k * 4 + 2] / 255, cliff = B.splat[k * 4 + 3] / 255;
    let dens = smoothstep(2.2, 4.0, y) * (1 - smoothstep(0.42, 0.75, slope)) * (1 - pave) * (1 - sand * 0.9) * (1 - cliff * 0.5);
    dens *= 0.75;
    data[k * 2] = TH(y); data[k * 2 + 1] = TH(dens);
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { tex, origin: new THREE.Vector2(NEAR.x0 - NEAR.step / 2, NEAR.z0 - NEAR.step / 2), size: new THREE.Vector2(N * NEAR.step, N * NEAR.step) };
}
