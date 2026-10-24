// Alpine valley terrain: analytic height function, near + far meshes and a splat shader.
import * as THREE from 'three';
import { Simplex2, smoothstep } from '../util/noise.js';
import { riverCoords, waterY, depthAt, WATER_SLOPE, gorge, ISLANDS, sideWater } from './river.js';
import { grassTexture, rockTexture, gravelTexture, noiseTexture } from '../util/textures.js';

const nHills = new Simplex2(11);
const nMount = new Simplex2(23);
const nDetail = new Simplex2(37);

export const NEAR = { x0: -1150, x1: 1150, z0: -3050, z1: 3050, step: 4 };
const _c = {}, _sw = {};

// Land rising away from a bank `e` metres beyond it. G = gorge {g, h} turns the bank into a cliff.
function landProfile(x, z, e, wy, G, mountains) {
  let y = wy + 0.3;
  const bank = 0.06 * Math.min(e, 10) + 2.0 * smoothstep(8, 20, e);
  if (G.g > 0.01) {
    const crag = 0.8 + 0.4 * nDetail.fbm(x * 0.04, z * 0.04 + e * 0.02, 3);
    const wall = G.h * smoothstep(0.5, 9, e) * crag + G.h * 0.25 * smoothstep(9, 60, e);
    y += bank * (1 - G.g) + wall * G.g;
  } else y += bank;
  y += 0.022 * Math.pow(Math.max(0, e - 18), 1.3);
  const hillMask = smoothstep(25, 160, e);
  if (hillMask > 0) y += hillMask * (24 * nHills.fbm(x * 0.0035, z * 0.0035, 4) + 6 * nHills.noise(x * 0.012, z * 0.012));
  y += smoothstep(10, 30, e) * 0.7 * nDetail.fbm(x * 0.045, z * 0.045, 3);
  if (mountains && e > 200) {
    const m = smoothstep(200, 2300, e);
    const r = nMount.ridged(x * 0.00038 + 3.1, z * 0.00038 - 1.7, 7);
    y += Math.pow(m, 1.5) * 2900 * (0.3 + 0.7 * r);
    y += m * 220 * nMount.fbm(x * 0.0016, z * 0.0016, 5);
  }
  return y;
}

// Terrain height (the river bed where there is water).
export function heightAt(x, z) {
  const c = riverCoords(x, z, _c);
  const wy = waterY(z);
  const ad = Math.abs(c.d);
  const hw = c.hw;
  let y;
  if (ad < hw) {
    const bedNoise = 0.35 * nDetail.noise(x * 0.08, z * 0.08);
    y = wy + 0.3 - depthAt(x, z) + bedNoise * (1 - Math.abs(c.n) * 0.5);
    // lake islands: a grassy crown with a shelving underwater slope
    for (const I of ISLANDS) {
      const d = Math.hypot(x - I.x, z - I.z);
      if (d > I.r + 70) continue;
      const k = d / I.r;
      const ih = k < 1
        ? wy + 0.3 + I.h * (1 - k * k) * (0.85 + 0.3 * nHills.noise(x * 0.05, z * 0.05)) + 0.25 * nDetail.noise(x * 0.1, z * 0.1)
        : wy + 0.3 - (d - I.r) * 0.32;
      if (ih > y) y = ih;
    }
  } else {
    y = landProfile(x, z, ad - hw, wy, gorge(z), true);
  }
  // calm side rivers carve their own little valleys
  sideWater(x, z, _sw);
  if (_sw.sd < 650) {
    let ty;
    if (_sw.sd < 0) ty = wy + 0.3 - _sw.D * Math.pow(Math.min(1, -_sw.sd / 7), 0.8) + 0.2 * nDetail.noise(x * 0.08, z * 0.08);
    else {
      ty = landProfile(x, z, _sw.sd, wy, { g: 0, h: 0 }, false) - 0.3;
      // fade the valley back into the surrounding land well before the grid edge (no cliff at the cutoff)
      const w = smoothstep(220, 600, _sw.sd);
      ty = ty * (1 - w) + y * w;
    }
    if (ty < y) y = ty;
  }
  return y;
}

// Metres of water above the ground at a point (0 on land). Works for river, lake and side waters.
export function waterDepth(x, z) {
  return Math.max(0, waterY(z) - heightAt(x, z));
}

// ---- fast lookups into the baked near-terrain grid (valid after createTerrain)
let GRID = null; // { w, h, H: Float32Array, N: Float32Array(normals xyz) }
export function sampleHeight(x, z) {
  if (!GRID) return heightAt(x, z);
  const fx = (x - NEAR.x0) / NEAR.step, fz = (z - NEAR.z0) / NEAR.step;
  if (fx < 0 || fz < 0 || fx >= GRID.w - 1 || fz >= GRID.h - 1) return heightAt(x, z);
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * GRID.w + i, H = GRID.H;
  return (H[k] * (1 - tx) + H[k + 1] * tx) * (1 - tz) + (H[k + GRID.w] * (1 - tx) + H[k + GRID.w + 1] * tx) * tz;
}
export function sampleNormal(x, z, out = new THREE.Vector3()) {
  if (!GRID) return normalAt(x, z, out);
  const i = Math.round((x - NEAR.x0) / NEAR.step), j = Math.round((z - NEAR.z0) / NEAR.step);
  if (i < 0 || j < 0 || i >= GRID.w || j >= GRID.h) return normalAt(x, z, out);
  const k = (j * GRID.w + i) * 3;
  return out.set(GRID.N[k], GRID.N[k + 1], GRID.N[k + 2]);
}

// Water depth from the baked grid (matches the rendered terrain; cheap enough for physics).
export function sampleDepth(x, z) {
  return Math.max(0, waterY(z) - sampleHeight(x, z));
}

// Surface normal estimate (for placement / slope checks).
export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 1.0;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return out.set(-hx, 2 * e, -hz).normalize();
}

function buildGrid(x0, x1, z0, z1, nx, nz, heightFn) {
  const verts = (nx + 1) * (nz + 1);
  const pos = new Float32Array(verts * 3);
  let k = 0;
  for (let j = 0; j <= nz; j++) {
    const z = z0 + (z1 - z0) * j / nz;
    for (let i = 0; i <= nx; i++) {
      const x = x0 + (x1 - x0) * i / nx;
      pos[k++] = x; pos[k++] = heightFn(x, z); pos[k++] = z;
    }
  }
  const idx = new Uint32Array(nx * nz * 6);
  k = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      // alternate diagonal for nicer shading
      if ((i + j) & 1) { idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
      else { idx[k++] = a; idx[k++] = c; idx[k++] = d; idx[k++] = a; idx[k++] = d; idx[k++] = b; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function createTerrainMaterial(shared) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  const uniforms = {
    tGrass: { value: shared.grass },
    tRock: { value: shared.rock },
    tGravel: { value: shared.gravel },
    tNoise: { value: shared.noise },
    uTime: shared.time,
    uWaterSlope: { value: WATER_SLOPE },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNormal;
        uniform sampler2D tGrass, tRock, tGravel, tNoise;
        uniform float uTime, uWaterSlope;
        float causticAt(vec2 p, float t) {
          float c1 = texture2D(tNoise, p * 0.11 + vec2(t * 0.021, t * 0.013)).r;
          float c2 = texture2D(tNoise, p * 0.13 + vec2(-t * 0.017, t * 0.024) + 0.37).r;
          float r = 1.0 - abs(c1 - c2) * 6.0;
          return pow(clamp(r, 0.0, 1.0), 6.0);
        }`)
      .replace('#include <map_fragment>', `
        vec3 wp = vWPos;
        vec3 wn = normalize(vWNormal);
        // steeper of the smoothed normal and the true triangle face: big far-terrain triangles
        // would otherwise blend meadow colour down cliff faces as streaks
        vec3 fc = cross(dFdx(vWPos), dFdy(vWPos));
        vec3 fN = dot(fc, fc) > 1e-10 ? normalize(fc) : wn; // never normalize a zero vector (NaN)
        float slope = 1.0 - min(wn.y, abs(fN.y));
        float hAW = wp.y + uWaterSlope * wp.z;
        float camDist = length(cameraPosition - wp);
        // triplanar macro noise: top-down sampling would smear into vertical streaks on cliffs
        vec3 nTri = abs(fN.y) < wn.y ? fN : wn; // projection follows the true face on steep triangles
        vec3 bw = pow(abs(nTri), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        #define TRI(s) (texture2D(tNoise, wp.zy * (s)) * bw.x + texture2D(tNoise, wp.xz * (s)) * bw.y + texture2D(tNoise, wp.xy * (s)) * bw.z)
        vec4 nz = TRI(0.0021);
        vec4 nzb = TRI(0.019);
        #undef TRI
        // grass, sampled at two scales to hide tiling
        vec3 g1 = texture2D(tGrass, wp.xz * 0.21).rgb;
        vec3 g2 = texture2D(tGrass, wp.xz * 0.037 + 0.3).rgb;
        vec3 grass = mix(g1, g2, smoothstep(30.0, 140.0, camDist) * 0.7 + 0.15);
        grass *= mix(vec3(0.62, 0.8, 0.5), vec3(1.12, 1.04, 0.72), smoothstep(0.25, 0.75, nz.r));
        grass = mix(grass, grass * vec3(1.12, 0.95, 0.55), smoothstep(0.5, 0.78, nzb.g) * 0.65);
        grass = mix(grass, grass * vec3(0.55, 0.72, 0.5), smoothstep(0.55, 0.85, nzb.b) * 0.6);
        grass *= 0.86;
        // forests darken mid slopes far away (real trees cover near ones)
        float forest = smoothstep(0.48, 0.6, nz.a + nz.b * 0.25) * smoothstep(60.0, 120.0, hAW) * (1.0 - smoothstep(950.0, 1150.0, wp.y));
        grass = mix(grass, vec3(0.09, 0.16, 0.07) * (0.8 + nzb.r * 0.4), forest * 0.9);
        // alpine pastures above the tree line turn tawny
        grass = mix(grass, vec3(0.42, 0.42, 0.2) * (0.8 + nzb.b * 0.4), smoothstep(1000.0, 1350.0, wp.y) * 0.8);
        // triplanar rock
        float rs = 0.07;
        vec3 rock = texture2D(tRock, wp.zy * rs).rgb * bw.x + texture2D(tRock, wp.xz * rs).rgb * bw.y + texture2D(tRock, wp.xy * rs).rgb * bw.z;
        vec3 rockFar = texture2D(tRock, wp.zy * 0.009).rgb * bw.x + texture2D(tRock, wp.xz * 0.009).rgb * bw.y + texture2D(tRock, wp.xy * 0.009).rgb * bw.z;
        rock = mix(rock, rockFar, smoothstep(80.0, 400.0, camDist)) * mix(0.8, 1.12, nzb.r);
        rock *= mix(vec3(0.78, 0.74, 0.7), vec3(1.05, 1.02, 0.98), nz.g);
        float ledge = smoothstep(0.55, 0.75, texture2D(tNoise, wp.xz * 0.006 + wp.y * 0.004).b) * (1.0 - smoothstep(0.32, 0.46, slope));
        vec3 gravel = texture2D(tGravel, wp.xz * 0.42).rgb;
        vec3 snow = vec3(0.93, 0.96, 1.02) * (0.88 + 0.12 * nzb.g);
        float wRock = max(smoothstep(0.28, 0.42, slope + (nzb.g - 0.5) * 0.16), smoothstep(0.5, 0.62, slope)); // steep faces are always rock (top-down grass would streak)
        float snowLine = 1250.0 + (nz.r - 0.5) * 520.0;
        float wSnow = smoothstep(snowLine, snowLine + 140.0, wp.y) * (1.0 - smoothstep(0.5, 0.75, slope));
        float wGravel = 1.0 - smoothstep(0.75, 1.5, hAW + (nzb.r - 0.5) * 0.9);
        vec3 col = grass;
        col = mix(col, gravel, wGravel);
        col = mix(col, rock, wRock * (1.0 - wGravel * 0.6) * (1.0 - ledge * 0.85));
        col = mix(col, snow, wSnow);
        float wet = 1.0 - smoothstep(-0.05, 0.4, hAW);
        col *= mix(1.0, 0.58, wet);
        float tRough = mix(mix(0.95, 0.82, wRock), 0.6, wSnow);
        tRough = mix(tRough, 0.35, wet);
        if (hAW < 0.0) {
          float dep = -hAW;
          col *= exp(-dep * vec3(0.32, 0.10, 0.09)) * vec3(0.85, 1.0, 0.98);
          float ca = causticAt(wp.xz, uTime) + 0.6 * causticAt(wp.xz * 1.7 + 3.0, uTime * 1.3);
          col += ca * 0.22 * exp(-dep * 0.25) * vec3(0.8, 1.0, 0.95);
        }
        diffuseColor.rgb *= col;
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', `
        // procedural bump: triplanar noise gradients give rock faces relief
        {
          vec3 bwB = bw;
          float k = mix(0.35, 1.6, wRock) * (1.0 - wSnow * 0.6);
          vec3 g = vec3(0.0);
          for (int o = 0; o < 2; o++) {
            float f = o == 0 ? 0.035 : 0.17;
            float amp = o == 0 ? 1.0 : 0.45;
            float e = o == 0 ? 0.8 : 0.2;
            #define BH(p) (texture2D(tNoise, (p).zy * f).r * bwB.x + texture2D(tNoise, (p).xz * f).g * bwB.y + texture2D(tNoise, (p).xy * f).b * bwB.z)
            float h0 = BH(wp);
            g += amp * vec3(BH(wp + vec3(e, 0.0, 0.0)) - h0, BH(wp + vec3(0.0, e, 0.0)) - h0, BH(wp + vec3(0.0, 0.0, e)) - h0) / e;
            #undef BH
          }
          g *= k * (1.0 - smoothstep(60.0, 900.0, camDist)) + k * 0.4;
          vec3 wnB = normalize(wn - (g - dot(g, wn) * wn) * 2.2);
          normal = normalize((viewMatrix * vec4(wnB, 0.0)).xyz);
        }
      `);
  };
  mat.customProgramCacheKey = () => 'terrain-v1';
  return mat;
}

export function createTerrain(scene, sharedTime) {
  const shared = {
    grass: grassTexture(),
    rock: rockTexture(),
    gravel: gravelTexture(),
    noise: noiseTexture(),
    time: sharedTime,
  };
  const mat = createTerrainMaterial(shared);

  // One height grid for the whole near region, normals from central differences (seamless chunks).
  const w = Math.round((NEAR.x1 - NEAR.x0) / NEAR.step) + 1;
  const h = Math.round((NEAR.z1 - NEAR.z0) / NEAR.step) + 1;
  const H = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const z = NEAR.z0 + j * NEAR.step;
    for (let i = 0; i < w; i++) H[j * w + i] = heightAt(NEAR.x0 + i * NEAR.step, z);
  }
  const N = new Float32Array(w * h * 3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const hl = H[j * w + Math.max(0, i - 1)], hr = H[j * w + Math.min(w - 1, i + 1)];
    const hd = H[Math.max(0, j - 1) * w + i], hu = H[Math.min(h - 1, j + 1) * w + i];
    const nx = hl - hr, ny = 2 * NEAR.step, nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    const k = (j * w + i) * 3;
    N[k] = nx / l; N[k + 1] = ny / l; N[k + 2] = nz / l;
  }
  GRID = { w, h, H, N };

  // Chunks along z so the camera only draws what's in view.
  const chunks = [];
  const rowsPer = 96;
  for (let j0 = 0; j0 < h - 1; j0 += rowsPer) {
    const j1 = Math.min(h - 1, j0 + rowsPer);
    const rows = j1 - j0 + 1;
    const pos = new Float32Array(rows * w * 3), nor = new Float32Array(rows * w * 3);
    let k = 0;
    for (let j = j0; j <= j1; j++) {
      const z = NEAR.z0 + j * NEAR.step;
      for (let i = 0; i < w; i++, k += 3) {
        const g = j * w + i;
        pos[k] = NEAR.x0 + i * NEAR.step; pos[k + 1] = H[g]; pos[k + 2] = z;
        nor[k] = N[g * 3]; nor[k + 1] = N[g * 3 + 1]; nor[k + 2] = N[g * 3 + 2];
      }
    }
    const idx = new Uint32Array((rows - 1) * (w - 1) * 6);
    k = 0;
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < w - 1; i++) {
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      if ((i + j + j0) & 1) { idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
      else { idx[k++] = a; idx[k++] = c; idx[k++] = d; idx[k++] = a; idx[k++] = d; idx[k++] = b; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrainNear';
    scene.add(mesh);
    chunks.push(mesh);
  }

  // Far terrain: coarse, pushed under the near patch so the two never fight.
  const F = 11000;
  const farGeo = buildGrid(-F, F, -F, F, 320, 320, (x, z) => {
    const inside = x > NEAR.x0 + 30 && x < NEAR.x1 - 30 && z > NEAR.z0 + 30 && z < NEAR.z1 - 30;
    return heightAt(x, z) - (inside ? 80 : 0);
  });
  const far = new THREE.Mesh(farGeo, mat);
  far.name = 'terrainFar';
  scene.add(far);

  return { near: chunks[0], chunks, far, material: mat, shared };
}

// Bake height + grass density for the near region into a half-float RG texture (for grass shader).
// Reuses the near terrain grid so no heights are recomputed.
export function bakeHeightTexture() {
  const { w, h, H } = GRID;
  const res = NEAR.step;
  const data = new Uint16Array(w * h * 2);
  const tmp = {};
  for (let j = 0; j < h; j++) {
    const z = NEAR.z0 + j * res;
    for (let i = 0; i < w; i++) {
      const x = NEAR.x0 + i * res;
      const y = H[j * w + i];
      const hAW = y - waterY(z);
      riverCoords(x, z, tmp);
      const e = Math.abs(tmp.d) - tmp.hw;
      const sx = H[j * w + Math.min(w - 1, i + 1)] - y, sz = H[Math.min(h - 1, j + 1) * w + i] - y;
      const slope = Math.hypot(sx, sz) / res;
      let dens = smoothstep(1.3, 2.6, hAW) * (1 - smoothstep(0.55, 0.9, slope)) * (1 - smoothstep(900, 1100, y));
      if (e < 6 && e > -1 && hAW < 2.5) dens = 0;
      const k = (j * w + i) * 2;
      data[k] = THREE.DataUtils.toHalfFloat(y);
      data[k + 1] = THREE.DataUtils.toHalfFloat(dens);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { tex, origin: new THREE.Vector2(NEAR.x0, NEAR.z0), size: new THREE.Vector2(NEAR.x1 - NEAR.x0, NEAR.z1 - NEAR.z0) };
}
