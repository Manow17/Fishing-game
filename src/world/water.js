// River water surface: a ribbon mesh following the river with a custom flowing-water shader.
import * as THREE from 'three';
import { centerX, centerSlope, halfWidth, waterY, flowMax, rapids, riverRocks, PLAY_Z, TRIBUTARIES, sideWater, riverCoords } from './river.js';
import { waterDepth } from './terrain.js';
import { waterNormalTexture, foamTexture, makeCanvas, toTexture } from '../util/textures.js';

const FOAM_Z0 = -3100, FOAM_Z1 = 3100;

// Bake foam/wake mask in river (u,v) space: u = lateral -1..1, v = z.
function bakeFoamMap() {
  const W = 256, H = 4096;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const toPx = (n, z) => [((n + 1.15) / 2.3) * W, ((z - FOAM_Z0) / (FOAM_Z1 - FOAM_Z0)) * H];
  const pxPerM = H / (FOAM_Z1 - FOAM_Z0);
  ctx.globalCompositeOperation = 'lighter';
  for (const r of riverRocks) {
    const hw = halfWidth(r.z);
    const [px, py] = toPx(r.n, r.z);
    const rx = (r.r / hw) / 2.3 * W;
    // ring of foam around the rock + downstream wake tail
    const ry = r.r * pxPerM;
    for (let k = 0; k < 14; k++) {
      const t = k / 13;
      const len = (6 + r.r * 9) * pxPerM;
      const cy = py + t * len;
      const sx = rx * (1.4 + t * 2.2), sy = ry * (1.2 + t * 1.5) + 2;
      const g = ctx.createRadialGradient(px, cy, 0, px, cy, Math.max(sx, sy));
      const a = (1 - t) * 0.5 + 0.1;
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(px, cy);
      ctx.scale(sx / Math.max(sx, sy), sy / Math.max(sx, sy));
      ctx.translate(-px, -cy);
      ctx.beginPath(); ctx.arc(px, cy, Math.max(sx, sy), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  const t = toTexture(c, { srgb: false, repeat: false });
  t.flipY = false; // canvas row 0 = upstream end
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function buildRiverGeometry(z0, z1, step, cols) {
  const rows = Math.round((z1 - z0) / step) + 1;
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const aData = new Float32Array(rows * cols * 4); // depth, flow speed, rapids, lateral n
  let p = 0, q = 0, a = 0;
  for (let j = 0; j < rows; j++) {
    const z = z0 + j * step;
    const cx = centerX(z), s = centerSlope(z);
    const inv = 1 / Math.sqrt(1 + s * s);
    const hw = halfWidth(z) + 8;
    const wy = waterY(z);
    const fm = flowMax(z), rp = rapids(z);
    for (let i = 0; i < cols; i++) {
      const u = (i / (cols - 1)) * 2 - 1;           // -1..1 across (beyond banks a bit)
      const uu = Math.sign(u) * Math.pow(Math.abs(u), 0.8);
      const d = uu * hw;
      // offset perpendicular to the centreline
      const x = cx + d * inv;
      const zz = z - d * s * inv;
      pos[p++] = x; pos[p++] = wy; pos[p++] = zz;
      const n = d / (hw - 8);
      uv[q++] = d; uv[q++] = z;
      aData[a++] = waterDepth(x, zz);
      aData[a++] = fm * Math.pow(Math.max(0, 1 - Math.min(1, n * n)), 0.45);
      aData[a++] = rp;
      aData[a++] = n;
    }
  }
  const idx = [];
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const A = j * cols + i, B = A + 1, C = A + cols, D = C + 1;
    idx.push(A, C, B, B, C, D);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aData', new THREE.BufferAttribute(aData, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Water patches for the calm side rivers and their ponds: a grid over each one's area,
// keeping only cells near its water and outside the main river's ribbon.
function buildSideWaterGeometry(tr) {
  const cell = 3;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of tr.points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  const pad = 30;
  x0 = Math.min(x0, tr.pond.x - tr.pond.r) - pad; x1 = Math.max(x1, tr.pond.x + tr.pond.r) + pad;
  z0 = Math.min(z0, tr.pond.z - tr.pond.r) - pad; z1 = Math.max(z1, tr.pond.z + tr.pond.r) + pad;
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  const sw = {}, rc = {};
  const near = new Uint8Array(nx * nz);
  const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), aData = new Float32Array(nx * nz * 4);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * cell, z = z0 + j * cell, k = j * nx + i;
    sideWater(x, z, sw);
    riverCoords(x, z, rc);
    near[k] = sw.sd < 4 && Math.abs(rc.d) > rc.hw + 7.5 ? 1 : 0;
    pos[k * 3] = x; pos[k * 3 + 1] = waterY(z); pos[k * 3 + 2] = z;
    uv[k * 2] = x; uv[k * 2 + 1] = z;
    aData[k * 4] = near[k] ? waterDepth(x, z) : 0; aData[k * 4 + 1] = 0; aData[k * 4 + 2] = 0; aData[k * 4 + 3] = 5;
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const A = j * nx + i, B = A + 1, C = A + nx, D = C + 1;
    if (near[A] || near[B] || near[C] || near[D]) idx.push(A, C, B, B, C, D);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aData', new THREE.BufferAttribute(aData, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const vert = /* glsl */`
  attribute vec4 aData;
  varying vec2 vUv;
  varying vec3 vWPos;
  varying vec4 vData;
  varying float vWave;
  uniform float uTime;
  uniform float uWaveScale;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vData = aData;
    vec3 p = position;
    float speed = aData.y;
    float rp = aData.z;
    // waves: ripples, lobby-controlled swell, standing waves in rapids (CPU twin: riverWave() in river.js)
    float S = uWaveScale, S2 = max(S - 1.0, 0.0);
    float w = (sin(p.z * 0.9 + p.x * 0.3 - uTime * 2.1) * 0.03 + sin(p.z * 0.37 - p.x * 0.55 + uTime * 1.3) * 0.04) * S;
    w += S2 * (sin(p.z * 0.11 + p.x * 0.05 - uTime * 0.9) * 0.28 + sin(p.z * 0.071 - p.x * 0.13 + uTime * 0.7) * 0.22 + sin(p.x * 0.09 + p.z * 0.03 - uTime * 1.1) * 0.12);
    w += rp * (sin(p.z * 1.6 + sin(p.x * 0.7) * 1.5) * 0.18 + sin(p.x * 2.1 + p.z * 0.8 + uTime * 3.0) * 0.08) * (1.0 - smoothstep(0.3, 1.0, abs(aData.w))) * min(1.5, 0.4 + S * 0.6);
    float shore = 1.0 - smoothstep(0.05, 0.5, aData.x);
    w *= 1.0 - shore;
    p.y += w;
    vWave = w;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWPos = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const frag = /* glsl */`
  uniform float uTime;
  uniform float uWaveScale;
  uniform sampler2D tNormal, tNormal2, tFoam, tFoamMap;
  uniform samplerCube tEnv;
  uniform vec3 uSunDir, uSunColor, uDeep, uShallow, uScatter;
  uniform vec2 uFoamRange;
  uniform vec3 uWakePos[24];
  uniform float uWakeAmt[24];
  varying vec2 vUv;
  varying vec3 vWPos;
  varying vec4 vData;
  varying float vWave;
  #include <fog_pars_fragment>

  vec3 flowNormal(sampler2D tex, vec2 uv, float speed, float scale) {
    // two-phase flow along +z (river v) to avoid infinite stretching
    float cycle = 2.0;
    float t0 = fract(uTime / cycle);
    float t1 = fract(uTime / cycle + 0.5);
    float w = abs(t0 - 0.5) * 2.0;
    vec2 off0 = vec2(0.0, -speed * t0 * cycle);
    vec2 off1 = vec2(0.0, -speed * t1 * cycle);
    vec3 n0 = texture2D(tex, (uv + off0) * scale).xyz * 2.0 - 1.0;
    vec3 n1 = texture2D(tex, (uv + off1) * scale + 0.5).xyz * 2.0 - 1.0;
    return mix(n0, n1, w);
  }

  void main() {
    // MSAA can evaluate edge pixels outside the triangle and extrapolate varyings wildly:
    // clamp everything so exp()/mix() can never produce inf - inf = NaN (shows up as black bloom boxes)
    float depth = clamp(vData.x, 0.0, 30.0);
    float speed = clamp(vData.y, 0.0, 8.0);
    float rp = clamp(vData.z, 0.0, 1.0);
    // river-space coordinates: lateral meters x, along-stream meters z
    vec2 ruv = vUv;
    float drift = speed + 0.14;   // a breeze keeps even still water alive
    vec3 nA = flowNormal(tNormal, ruv, drift, 0.085);
    vec3 nB = flowNormal(tNormal2, ruv * vec2(1.0, 0.6), drift * 1.15, 0.23);
    vec3 nC = flowNormal(tNormal, ruv.yx, 0.11, 0.6);
    float chop = (0.38 + speed * 0.14 + rp * 0.8) * (0.25 + 0.75 * min(uWaveScale, 1.0)) + max(uWaveScale - 1.0, 0.0) * 0.35;
    vec3 n = normalize(vec3((nA.xy * 0.8 + nB.xy * 0.6 + nC.xy * 0.3) * chop, 1.0));
    vec3 N = normalize(vec3(n.x, n.z, n.y));

    vec3 V = normalize(cameraPosition - vWPos);
    float dist = length(cameraPosition - vWPos);
    // soften normals with distance to avoid aliasing
    N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(80.0, 600.0, dist) * 0.75));
    float NdV = clamp(dot(N, V), 0.0, 1.0);
    float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 refl = textureCube(tEnv, R).rgb;

    // body colour: glacial turquoise, deeper = darker emerald
    float df = clamp(1.0 - exp(-depth * 0.55), 0.0, 1.0);
    vec3 body = mix(uShallow, uDeep, df);
    float sunUp = max(uSunDir.y, 0.0);
    body *= 0.35 + 0.75 * sunUp;
    // subsurface glow on wave crests facing the sun
    float sss = pow(max(dot(V, -uSunDir), 0.0), 3.0) * 0.5 + clamp(vWave, 0.0, 0.5) * 2.0;
    body += uScatter * sss * 0.25;

    vec3 col = mix(body, refl, fres);
    // sun glints
    vec3 H = normalize(uSunDir + V);
    float spec = pow(max(dot(N, H), 0.0), 900.0) * 18.0 + pow(max(dot(N, H), 0.0), 120.0) * 0.4;
    col += uSunColor * spec;

    // foam: shoreline, rapids, rocks, speed streaks, boat wakes
    float fz = (vWPos.z - uFoamRange.x) / (uFoamRange.y - uFoamRange.x);
    float rockFoam = texture2D(tFoamMap, vec2((clamp(vData.w, -1.2, 1.2) + 1.15) / 2.3, fz)).r;
    vec2 fuv = ruv * 0.11 + n.xy * 0.03;
    float fa = texture2D(tFoam, fuv + vec2(0.0, -uTime * speed * 0.11)).r;
    float fb = texture2D(tFoam, fuv * 1.9 + vec2(0.31, -uTime * speed * 0.2)).r;
    float streak = texture2D(tFoam, vec2(ruv.x * 0.06, ruv.y * 0.012 - uTime * speed * 0.012)).g;
    float shore = 1.0 - smoothstep(0.0, 0.55, depth);
    float wake = 0.0;
    for (int i = 0; i < 24; i++) {
      vec3 wpz = uWakePos[i];
      float d = length(vWPos.xz - wpz.xz);
      wake += uWakeAmt[i] * (1.0 - smoothstep(wpz.y * 0.2, wpz.y, d));
    }
    float foamMask = shore * 0.9 + rp * smoothstep(0.35, 0.8, streak + fa * 0.5) * 0.9 + rockFoam * (0.7 + fb * 0.8) + wake;
    foamMask += smoothstep(0.75, 1.0, streak) * 0.25 * min(speed / 3.0, 1.0);
    float foam = smoothstep(0.25, 0.75, foamMask * (fa * 0.7 + fb * 0.6));
    foam = clamp(foam + smoothstep(1.2, 2.0, foamMask) * 0.5, 0.0, 1.0);
    vec3 foamCol = vec3(0.92, 0.96, 0.97) * (0.55 + 0.6 * sunUp);
    col = mix(col, foamCol, foam);

    float alpha = mix(0.5, 0.97, smoothstep(0.0, 3.0, depth));
    alpha = max(alpha, fres * 0.9);
    alpha = max(alpha, foam);
    alpha *= smoothstep(0.0, 0.08, depth + foam * 0.1);
    alpha = mix(alpha, 1.0, smoothstep(150.0, 900.0, dist));

    gl_FragColor = vec4(col, alpha);
    #include <fog_fragment>
  }
`;

export function createWater(scene, sharedTime) {
  const normal = waterNormalTexture(512, 5);
  const normal2 = waterNormalTexture(256, 19);
  const foam = foamTexture();
  const foamMap = bakeFoamMap();
  const wakePos = Array.from({ length: 24 }, () => new THREE.Vector3(0, 1, -99999));
  const wakeAmt = new Array(24).fill(0);

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uWaveScale: { value: 1 },
    tNormal: { value: null }, tNormal2: { value: null }, tFoam: { value: null }, tFoamMap: { value: null },
    tEnv: { value: null },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
    uDeep: { value: new THREE.Color(0x07505e) },
    uShallow: { value: new THREE.Color(0x2fb4c0) },
    uScatter: { value: new THREE.Color(0x48e0c4) },
    uFoamRange: { value: new THREE.Vector2(FOAM_Z0, FOAM_Z1) },
    uWakePos: { value: wakePos },
    uWakeAmt: { value: wakeAmt },
  }]);
  uniforms.uTime = sharedTime;
  uniforms.tNormal.value = normal;
  uniforms.tNormal2.value = normal2;
  uniforms.tFoam.value = foam;
  uniforms.tFoamMap.value = foamMap;
  uniforms.uWakePos.value = wakePos;
  uniforms.uWakeAmt.value = wakeAmt;

  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: vert, fragmentShader: frag,
    transparent: true, fog: true, depthWrite: true,
  });

  // Fine mesh along the playable stretch, coarser beyond.
  const meshes = [];
  const parts = [
    [PLAY_Z[0] - 200, PLAY_Z[1] + 200, 2.0, 72],
    [-9000, PLAY_Z[0] - 200, 12, 24],
    [PLAY_Z[1] + 200, 9000, 12, 24],
  ];
  for (const [a, b, s, c] of parts) {
    const m = new THREE.Mesh(buildRiverGeometry(a, b, s, c), mat);
    m.renderOrder = 2;
    m.frustumCulled = true;
    scene.add(m);
    meshes.push(m);
  }
  for (const tr of TRIBUTARIES) {
    const m = new THREE.Mesh(buildSideWaterGeometry(tr), mat);
    m.renderOrder = 2;
    m.name = 'sideWater';
    scene.add(m);
    meshes.push(m);
  }

  let wakeIdx = 0;
  return {
    material: mat,
    meshes,
    setWaveScale(v) { uniforms.uWaveScale.value = v; },
    setSun(dir, color) { uniforms.uSunDir.value.copy(dir); uniforms.uSunColor.value.copy(color); },
    setEnv(cube) { uniforms.tEnv.value = cube; },
    // drop a foam "stamp" (boat wakes, splashes). radius in meters.
    addWake(x, z, radius, amount) {
      wakePos[wakeIdx].set(x, radius, z);
      wakeAmt[wakeIdx] = amount;
      wakeIdx = (wakeIdx + 1) % wakePos.length;
    },
    update(dt, flowAtFn) {
      for (let i = 0; i < wakePos.length; i++) {
        if (wakeAmt[i] <= 0) continue;
        wakeAmt[i] = Math.max(0, wakeAmt[i] - dt * 0.35);
        wakePos[i].y += dt * 1.2;     // spread
        const f = flowAtFn(wakePos[i].x, wakePos[i].z);
        wakePos[i].x += f.x * dt; wakePos[i].z += f.z * dt;
      }
    },
  };
}
