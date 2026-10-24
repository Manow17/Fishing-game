// Open-ocean water surface.
//  - Geometry: one camera-centred polar grid (rings grow geometrically, so cells stay roughly square
//    from 0.3 m under the camera to 30 km at the horizon, plus a skirt to 300 km). The grid only
//    translates (snapped), it never rotates; waves too short for the local cell size are faded out,
//    so nothing swims or aliases.
//  - Vertex: Gerstner displacement (oceanWaves.js), attenuated by the baked shoaling/shelter field.
//  - Fragment: exact per-pixel normals from the analytic Jacobian (+ normal-only ripples + normal maps,
//    anti-aliased by the pixel footprint, the lost slope variance widens the sun highlight), Fresnel
//    reflection of the scene cube map, deep-water body + crest subsurface scattering, whitecaps from
//    horizontal compression, surf / swash / reef foam, wakes. Premultiplied alpha over the sea bed.
import * as THREE from 'three';
import { WAVES_GLSL, WIND } from './oceanWaves.js';
import { waterNormalTexture, foamTexture } from '../../util/textures.js';
import { WATER } from './oceanShading.js';
import { ENV } from '../env.js';

const NANG = 320;
const RING_K = (2 * Math.PI) / NANG;  // arc length / radius
const MIN_SP = 0.3;
const WAKES = 32;

function polarGrid() {
  const radii = [];
  let r = 0.3;
  while (r < 30000) { radii.push(r); r += Math.max(MIN_SP, r * RING_K); }
  radii.push(30000, 300000);
  const nr = radii.length;
  const pos = new Float32Array((1 + nr * NANG) * 3);
  let k = 3;
  for (const rr of radii) for (let a = 0; a < NANG; a++) {
    const t = (a / NANG) * Math.PI * 2;
    pos[k++] = Math.cos(t) * rr; pos[k++] = 0; pos[k++] = Math.sin(t) * rr;
  }
  const idx = new Uint32Array((NANG + (nr - 1) * NANG * 2) * 3);
  let q = 0;
  for (let a = 0; a < NANG; a++) { idx[q++] = 0; idx[q++] = 1 + ((a + 1) % NANG); idx[q++] = 1 + a; }
  for (let i = 0; i < nr - 1; i++) for (let a = 0; a < NANG; a++) {
    const a1 = (a + 1) % NANG;
    const A = 1 + i * NANG + a, B = 1 + i * NANG + a1, C = 1 + (i + 1) * NANG + a, D = 1 + (i + 1) * NANG + a1;
    idx[q++] = A; idx[q++] = B; idx[q++] = C;
    idx[q++] = B; idx[q++] = D; idx[q++] = C;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return { geometry: g, rings: nr };
}

const SEA_GLSL = /* glsl */`
  uniform sampler2D tNear, tFar;
  uniform vec4 uNear, uFar;   // x0, z0, 1/step, n
  // same lookup and fallbacks as the CPU sampler (oceanTerrain.js makeSampler)
  vec4 seaData(vec2 p) {
    vec4 r = vec4(-950.0, 1.0, 400.0, 0.0);
    vec2 fn = (p - uNear.xy) * uNear.z;
    vec2 ff = (p - uFar.xy) * uFar.z;
    if (fn.x >= 0.0 && fn.y >= 0.0 && fn.x <= uNear.w - 1.0 && fn.y <= uNear.w - 1.0) r = textureLod(tNear, (fn + 0.5) / uNear.w, 0.0);
    else if (ff.x >= 0.0 && ff.y >= 0.0 && ff.x <= uFar.w - 1.0 && ff.y <= uFar.w - 1.0) r = textureLod(tFar, (ff + 0.5) / uFar.w, 0.0);
    return r;
  }
`;

const vert = /* glsl */`
  ${WAVES_GLSL}
  ${SEA_GLSL}
  uniform float uMinSp, uSpK;
  varying vec3 vWPos;
  varying vec2 vLocal;
  #include <fog_pars_vertex>
  void main() {
    vec2 local = position.xz;
    vec2 p0 = local + uOrigin;
    float att = clamp(seaData(p0).y, 0.0, 1.0);
    float sp = max(uMinSp, length(local) * uSpK);
    vec3 d = vec3(0.0);
    for (int i = 0; i < NW; i++) {
      vec4 A = uWA[i];
      vec4 B = uWB[i];
      float fade = smoothstep(3.0, 6.0, B.z / sp);
      if (fade <= 0.0) continue;
      float f = dot(A.xy, local) * A.z + B.x;
      d.xz += A.xy * (B.y * cos(f) * fade);
      d.y += A.w * sin(f) * fade;
    }
    d *= att;
    vec3 wp = vec3(p0.x + d.x, d.y, p0.y + d.z);
    vWPos = wp;
    vLocal = local;
    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const frag = /* glsl */`
  ${WAVES_GLSL}
  ${SEA_GLSL}
  uniform float uTime, uScale, uWhitecap, uAmp, uSunI;
  uniform sampler2D tNormal, tNormal2, tFoam;
  uniform samplerCube tEnv;
  uniform vec3 uSunDir, uSunColor, uSigma, uInscatter, uScatter, uAmbient;
  uniform vec2 uWind;
  uniform vec3 uWakePos[${WAKES}];
  uniform float uWakeAmt[${WAKES}];
  varying vec3 vWPos;
  varying vec2 vLocal;
  #include <fog_pars_fragment>

  void main() {
    // MSAA may evaluate edge samples outside the triangle: keep every varying in a sane range
    vec2 local = clamp(vLocal, vec2(-4.0e5), vec2(4.0e5));
    vec3 wpos = clamp(vWPos, vec3(-4.0e5, -60.0, -4.0e5), vec3(4.0e5, 60.0, 4.0e5));
    vec2 p0 = local + uOrigin;
    vec4 sea = seaData(p0);
    float ground = clamp(sea.x, -1000.0, 1000.0);
    float att = clamp(sea.y, 0.0, 1.0);
    float shoreD = clamp(sea.z, -300.0, 400.0);
    float reef = clamp(sea.w, 0.0, 1.0);
    float depth = max(0.0, -ground);

    // pixel footprint in metres -> which waves can be resolved here
    float fp = max(length(dFdx(local)), length(dFdy(local)));
    fp = clamp(fp, 1e-3, 1.0e4);

    float axx = 0.0, axz = 0.0, azz = 0.0, sx = 0.0, sz = 0.0, var = 0.0, crest = 0.0;
    for (int i = 0; i < NW; i++) {
      vec4 A = uWA[i];
      vec4 B = uWB[i];
      float fade = smoothstep(1.5, 4.0, B.z / fp);
      var += (1.0 - fade) * B.w * B.w * 0.5;
      if (fade <= 0.0) continue;
      float f = dot(A.xy, local) * A.z + B.x;
      float s = sin(f), c = cos(f);
      float ak = A.w * A.z * fade;
      sx += A.x * ak * c; sz += A.y * ak * c;
      float qk = B.y * A.z * s * fade;
      axx += qk * A.x * A.x; axz += qk * A.x * A.y; azz += qk * A.y * A.y;
      crest += A.w * s * fade;
    }
    for (int i = 0; i < ND; i++) {
      vec4 A = uDA[i];
      float ak = A.w * A.z;
      float fade = smoothstep(1.5, 4.0, 6.2831853 / (A.z * fp));
      var += (1.0 - fade) * ak * ak * 0.5;
      if (fade <= 0.0) continue;
      float c = cos(dot(A.xy, local) * A.z + uDP[i]);
      sx += A.x * ak * c * fade; sz += A.y * ak * c * fade;
    }
    sx *= att; sz *= att; axx *= att; axz *= att; azz *= att; crest *= att;
    vec3 Tx = vec3(1.0 - axx, sx, -axz);
    vec3 Tz = vec3(-axz, sz, 1.0 - azz);
    vec3 N = normalize(cross(Tz, Tx));
    float J = (1.0 - axx) * (1.0 - azz) - axz * axz;

    vec3 toCam = cameraPosition - wpos;
    float dist = length(toCam);
    vec3 V = toCam / max(dist, 1e-3);

    // capillary ripples from two drifting normal maps, near the camera only
    float near = 1.0 - smoothstep(25.0, 220.0, dist);
    float micro = (0.13 + 0.09 * min(uScale, 2.0)) * att;
    vec2 wnd = uWind;
    vec3 nA = texture2D(tNormal, p0 * 0.17 + wnd * uTime * 0.045).xyz * 2.0 - 1.0;
    vec3 nB = texture2D(tNormal2, p0 * 0.43 + vec2(-wnd.y, wnd.x) * uTime * 0.04 + wnd * uTime * 0.07).xyz * 2.0 - 1.0;
    vec2 mr = (nA.xy * 0.5 + nB.xy * 0.5) * micro;
    // tiny capillary facets close by: these make the sun glitter sparkle
    float vnear = 1.0 - smoothstep(6.0, 45.0, dist);
    vec3 nC = texture2D(tNormal2, p0 * 1.37 - wnd * uTime * 0.11).xyz * 2.0 - 1.0;
    mr += nC.xy * 0.11 * vnear * (0.6 + 0.4 * min(uScale, 1.5));
    N = normalize(N + vec3(mr.x, 0.0, mr.y) * near);
    var += dot(mr, mr) * 0.5 * (1.0 - near);
    float sig2 = clamp(var + 0.0008, 0.0006, 0.25);

    vec3 L = normalize(uSunDir);
    float NdV = clamp(dot(N, V), 0.0, 1.0);
    float sunUp = clamp(L.y, 0.0, 1.0);

    // reflection (scene cube map), blurred by the unresolved roughness; below-horizon rays see water
    // a ray reflected below the horizon hits the back of another wave, which mostly mirrors the low sky
    vec3 R = reflect(-V, N);
    float below = smoothstep(0.0, -0.25, R.y);
    R.y = abs(R.y) * 0.6 + 0.01;
    R = normalize(R);
    float lod = clamp(log2(1.0 + sig2 * 260.0), 0.0, 5.0);
    vec3 refl = min(textureLod(tEnv, R, lod).rgb, vec3(6.0));
    vec3 bodyLit = uInscatter * (0.35 + 0.9 * sunUp);
    refl *= 1.0 - 0.35 * below;
    float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    F = min(F, 0.92 - 0.25 * clamp(sig2 * 12.0, 0.0, 1.0));

    // water body: deep inscatter + light through thin crests (stronger looking toward the sun)
    float crestN = clamp(crest / max(uAmp * att, 0.15), -1.0, 1.5);
    float toward = pow(clamp(dot(-V, vec3(L.x, 0.0, L.z)) * 0.5 + 0.5, 0.0, 1.0), 2.5);
    float cr = max(crestN, 0.0);
    float sss = cr * cr * (0.25 + 1.2 * toward) * (0.4 + 0.6 * pow(1.0 - NdV, 2.0));
    sss += pow(clamp(dot(V, -L + N * 0.55), 0.0, 1.0), 4.0) * 0.35 * cr;
    sss *= 1.0 - smoothstep(150.0, 900.0, dist);
    vec3 body = bodyLit + uScatter * uSunColor * sss * 0.16 * (0.6 + 0.4 * sunUp);
    // shallow water: the sea bed (with its own absorption) shows through; deep water is opaque
    float o = smoothstep(13.0, 30.0, depth);

    // sun highlight: Beckmann lobe widened by the sub-pixel slope variance
    vec3 Hh = normalize(L + V);
    float NdH = clamp(dot(N, Hh), 1e-3, 1.0);
    float m2 = clamp(2.0 * sig2, 0.0012, 0.5);
    float c2 = NdH * NdH;
    float D = exp(-(1.0 - c2) / (c2 * m2)) / (3.14159 * m2 * c2 * c2);
    float Fs = 0.02 + 0.98 * pow(1.0 - clamp(dot(Hh, V), 0.0, 1.0), 5.0);
    float spec = min(D * Fs / (4.0 * max(NdV, 0.08)), 60.0) * step(0.0, dot(N, L)) * uSunI;

    // ---- foam
    float wcol = wpos.y - ground;                         // instantaneous water column
    vec2 fuv = p0 * 0.065;
    float f1 = texture2D(tFoam, fuv + N.xz * 0.04 + wnd * uTime * 0.012).r;
    float f2 = texture2D(tFoam, fuv * 2.3 + vec2(0.31, 0.17) - wnd * uTime * 0.02).r;
    float ftex = f1 * 0.65 + f2 * 0.55;
    float caps = smoothstep(uWhitecap + 0.1, uWhitecap - 0.2, J) * smoothstep(-0.3, 0.35, crestN);
    caps *= smoothstep(0.4, 1.8, uScale);
    // waves break in patches along a crest, not as one long white sheet
    float patchy = smoothstep(0.3, 0.72, texture2D(tFoam, p0 * 0.012 + wnd * uTime * 0.01).b + 0.08 * uScale);
    caps *= 0.15 + 0.85 * patchy;
    float streaks = smoothstep(1.8, 4.0, uScale) * smoothstep(0.55, 0.85, texture2D(tFoam, vec2(dot(p0, wnd) * 0.006, dot(p0, vec2(-wnd.y, wnd.x)) * 0.05)).g) * 0.6;
    // shelter (harbour): the baked attenuation divided by what shoaling alone would give
    float shelter = clamp(att / (0.2 + 0.8 * smoothstep(0.0, 9.0, depth)), 0.0, 1.0);
    float exposed = smoothstep(0.25, 0.7, shelter);
    float swash = (1.0 - smoothstep(0.0, 0.25 + 0.2 * uScale, wcol)) * (0.35 + 0.65 * exposed);
    float surfW = 30.0 + 22.0 * uScale;
    float zone = (1.0 - smoothstep(surfW * 0.4, surfW, shoreD)) * smoothstep(-2.0, 1.0, shoreD) * smoothstep(0.05, 0.4, uScale + 0.1);
    // breaking bands only where the bottom shelves gently (beaches, the lagoon), broken into sets
    float gentle = 1.0 - smoothstep(0.08, 0.22, depth / max(shoreD, 1.0));
    float sets = smoothstep(0.25, 0.65, texture2D(tFoam, p0 * 0.0035 + vec2(uTime * 0.004, 0.0)).g + 0.15);
    zone *= gentle * (0.35 + 0.65 * sets);
    float band = fract(shoreD / 15.0 + uTime * 0.105 + f1 * 0.35 + texture2D(tFoam, p0 * 0.006).b * 0.6);
    float surf = zone * exposed * (smoothstep(0.0, 0.05, band) * (1.0 - smoothstep(0.05, 0.42, band)) * 1.2 + 0.25 * (1.0 - smoothstep(0.0, 8.0, shoreD)));
    float rocks = (1.0 - smoothstep(1.0, 6.0 + 3.0 * uScale, shoreD)) * smoothstep(1.0, 5.0, depth) * (0.45 + 0.55 * f2) * 0.9 * exposed;
    float reefBreak = reef * (1.0 - smoothstep(0.6, 2.4, depth)) * (0.55 + 0.45 * sin(uTime * 0.7 + p0.x * 0.03 + p0.y * 0.02)) * (0.4 + 0.3 * uScale);
    float wake = 0.0;
    for (int i = 0; i < ${WAKES}; i++) {
      float a = uWakeAmt[i];
      if (a <= 0.0) continue;
      vec3 wk = uWakePos[i];
      float d = length(wpos.xz - wk.xz);
      wake += a * (1.0 - smoothstep(wk.y * 0.1, wk.y, d));
    }
    wake = clamp(wake, 0.0, 1.6);
    // wakes are churned, bubbly foam (never solid discs) over water whitened by air bubbles
    float wakeFoam = wake * smoothstep(0.3, 0.85, f1 * 0.85 + f2 * 0.55 + wake * 0.12 - 0.12);
    body += vec3(0.02, 0.07, 0.07) * min(wake, 1.0) * (0.4 + 0.6 * sunUp);
    float foamAmt = caps * 1.3 + streaks + swash * 1.2 + surf + rocks + reefBreak + wakeFoam * 1.3;
    float foam = smoothstep(0.22, 0.75, foamAmt * (0.35 + 0.95 * ftex));
    foam = clamp(foam + smoothstep(1.3, 2.2, foamAmt) * 0.4 * ftex, 0.0, 1.0);
    foam *= 1.0 - smoothstep(600.0, 2500.0, dist) * 0.7;
    vec3 foamCol = vec3(0.92, 0.95, 0.96) * (uSunColor * uSunI * (0.35 + 0.55 * max(dot(N, L), 0.0)) * sunUp + uAmbient);

    // ---- compose (premultiplied)
    vec3 col = F * refl + (1.0 - F) * o * body + spec * uSunColor;
    float alpha = F + (1.0 - F) * o;
    col = mix(col, foamCol, foam);
    alpha = mix(alpha, 1.0, foam);
    float edge = smoothstep(0.0, 0.1, wcol + foam * 0.05);  // fade out where the water column ends
    col *= edge; alpha *= edge;

    // aerial perspective toward the horizon: blend into the sky right above it, in the view direction
    #ifdef USE_FOG
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      vec3 hz = textureLod(tEnv, normalize(vec3(-V.x, 0.02, -V.z)), 4.0).rgb;
      vec3 fc = mix(fogColor, hz, 0.75);
      col = mix(col, fc * alpha, clamp(fogF, 0.0, 1.0));
    #endif
    col = clamp(col, vec3(0.0), vec3(60.0));
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

export function createOceanWater(scene, sharedTime, waves, bake) {
  const { geometry } = polarGrid();
  const wakePos = Array.from({ length: WAKES }, () => new THREE.Vector3(0, 1, -1e6));
  const wakeAmt = new Float32Array(WAKES);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uWA: { value: null }, uWB: { value: null }, uDA: { value: null }, uDP: { value: null },
    uOrigin: { value: new THREE.Vector2() },
    tNear: { value: null }, tFar: { value: null },
    uNear: { value: new THREE.Vector4() }, uFar: { value: new THREE.Vector4() },
    uMinSp: { value: MIN_SP }, uSpK: { value: RING_K },
    uTime: { value: 0 }, uScale: { value: 1 }, uWhitecap: { value: 0.58 }, uAmp: { value: 1 }, uSunI: { value: 3.4 },
    tNormal: { value: null }, tNormal2: { value: null }, tFoam: { value: null }, tEnv: { value: null },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
    uSigma: { value: WATER.sigma }, uInscatter: { value: WATER.inscatter },
    uScatter: { value: new THREE.Color(0.05, 0.42, 0.36) },
    uAmbient: { value: new THREE.Color(0.55, 0.65, 0.8) },
    uWind: { value: new THREE.Vector2(WIND[0], WIND[1]) },
    uWakePos: { value: null }, uWakeAmt: { value: null },
  }]);
  // shared / typed-array values are assigned after merge (merge would clone them)
  uniforms.uTime = sharedTime;
  uniforms.uWA.value = waves.uWA; uniforms.uWB.value = waves.uWB; uniforms.uDA.value = waves.uDA; uniforms.uDP.value = waves.uDP;
  uniforms.tNear.value = bake.tNear; uniforms.tFar.value = bake.tFar;
  uniforms.uNear.value.set(bake.near.x0, bake.near.z0, 1 / bake.near.step, bake.near.n);
  uniforms.uFar.value.set(bake.far.x0, bake.far.z0, 1 / bake.far.step, bake.far.n);
  uniforms.tNormal.value = waterNormalTexture(512, 5);
  uniforms.tNormal2.value = waterNormalTexture(256, 19);
  uniforms.tFoam.value = foamTexture();
  uniforms.uWakePos.value = wakePos; uniforms.uWakeAmt.value = wakeAmt;
  uniforms.uSigma.value = WATER.sigma; uniforms.uInscatter.value = WATER.inscatter;

  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: vert, fragmentShader: frag,
    transparent: true, premultipliedAlpha: true, fog: true, depthWrite: true,
  });
  material.extensions = material.extensions || {};
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  mesh.name = 'ocean';
  scene.add(mesh);

  const SNAP = 0.6;
  let wakeIdx = 0;
  const _f = {};
  return {
    material, meshes: [mesh], uniforms,
    setSun(dir, color, intensity) {
      uniforms.uSunDir.value.copy(dir); uniforms.uSunColor.value.copy(color);
      if (intensity) uniforms.uSunI.value = intensity;
    },
    setEnv(cube) { uniforms.tEnv.value = cube; },
    // per frame, before rendering: grid origin under the camera, wave phases, sea state
    follow(camera, t) {
      const ox = Math.round(camera.position.x / SNAP) * SNAP, oz = Math.round(camera.position.z / SNAP) * SNAP;
      uniforms.uOrigin.value.set(ox, oz);
      const s = ENV.waveScale;
      waves.setScale(s);
      waves.updatePhases(t, ox, oz);
      uniforms.uScale.value = s;
      uniforms.uAmp.value = Math.max(0.05, waves.hs * s * 0.5);
      uniforms.uWhitecap.value = 0.5 + 0.08 * s;
    },
    // foam stamp for boat wakes and splashes (radius in metres)
    addWake(x, z, radius, amount) {
      if (!(isFinite(x) && isFinite(z))) return;
      wakePos[wakeIdx].set(x, Math.max(0.2, radius || 1), z);
      wakeAmt[wakeIdx] = Math.max(0, Math.min(2, amount || 0));
      wakeIdx = (wakeIdx + 1) % WAKES;
    },
    update(dt) {
      for (let i = 0; i < WAKES; i++) {
        if (wakeAmt[i] <= 0) continue;
        wakeAmt[i] = Math.max(0, wakeAmt[i] - dt * 0.3);
        wakePos[i].y += dt * 1.1;
        ENV.flowAt(wakePos[i].x, wakePos[i].z, _f);
        wakePos[i].x += _f.x * dt; wakePos[i].z += _f.z * dt;
      }
    },
  };
}
