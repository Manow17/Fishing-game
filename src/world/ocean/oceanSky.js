// Warm, bright island sky built on the shared createSky() (sun light + shadows, hemisphere light,
// reflection cube camera): the physical Sky model washes out over open sea at the game's exposure, so
// the ocean draws its own analytic dome (deep azure zenith, warm sun glow, hazy horizon), uses it for
// image-based lighting, and swaps the cloud deck for cumulus that thin out toward the horizon.
import * as THREE from 'three';
import { createSky } from '../sky.js';

export const SUN = { elevation: 36, azimuth: 24 };   // azimuth: degrees from +z (south) toward +x (east)

const DOME_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
    gl_Position.z = gl_Position.w * 0.99999;    // always at the far end of the depth range
  }
`;
const DOME_FRAG = /* glsl */`
  uniform vec3 uSunDir, uZenith, uHorizon, uSunColor, uBelow;
  varying vec3 vDir;
  void main() {
    vec3 V = normalize(vDir);
    float e = V.y;
    float cs = clamp(dot(V, uSunDir), -1.0, 1.0);
    float sunSide = cs * 0.5 + 0.5;
    // Rayleigh-ish gradient: saturated overhead, pale and slightly warmer toward the horizon
    float t = pow(clamp(e, 0.0, 1.0), 0.42);
    vec3 col = mix(uHorizon * (0.92 + 0.16 * sunSide), uZenith, t);
    // a thin bright haze band right above the horizon, warmer on the sun's side
    float band = pow(1.0 - clamp(abs(e), 0.0, 1.0), 14.0);
    col += mix(vec3(0.22, 0.24, 0.26), uSunColor * 0.42, sunSide * sunSide) * band;
    // Mie glow around the sun
    float c = max(cs, 0.0);
    col += uSunColor * (0.10 * pow(c, 4.0) + 0.34 * pow(c, 22.0) + 1.1 * pow(c, 260.0));
    // sun disk (bloom turns it into a glare)
    col += uSunColor * smoothstep(0.99965, 0.99985, cs) * 38.0;
    // below the horizon (only seen in reflections / under the ocean's far edge)
    col = mix(col, uBelow, smoothstep(0.0, -0.12, e));
    gl_FragColor = vec4(clamp(col, vec3(0.0), vec3(60.0)), 1.0);
  }
`;

const CLOUD_VERT = /* glsl */`
  varying vec3 vWPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const CLOUD_FRAG = /* glsl */`
  uniform sampler2D tNoise;
  uniform float uTime, uStorm;
  uniform vec3 uSunDir, uSunColor, uShade;
  varying vec3 vWPos;
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * texture2D(tNoise, p).r; p *= 2.03; a *= 0.5; }
    return s;
  }
  void main() {
    vec2 p = vWPos.xz * 0.00005 + vec2(uTime * 0.0011, -uTime * 0.0005) * (1.0 + 2.0 * uStorm);
    float n = fbm(p);
    float n2 = fbm(p * 2.1 + 4.0);
    float d = n * 0.8 + n2 * 0.35;
    float cov = smoothstep(0.52 - 0.2 * uStorm, 0.7 - 0.12 * uStorm, d);
    float thick = smoothstep(0.52 - 0.25 * uStorm, 0.95 - 0.3 * uStorm, d);
    vec3 V = normalize(vWPos - cameraPosition);
    float elev = smoothstep(0.03 - 0.02 * uStorm, 0.22 - 0.1 * uStorm, V.y);    // thin out toward the horizon
    elev *= 1.0 - smoothstep(9000.0, 15500.0, length(vWPos.xz - cameraPosition.xz));  // never show the layer's edge
    vec3 col = mix(uSunColor * (1.25 - 0.55 * uStorm), uShade * (1.0 - 0.45 * uStorm), thick * (0.8 + 0.2 * uStorm));
    col += uSunColor * pow(max(dot(V, uSunDir), 0.0), 8.0) * (1.0 - thick) * 1.2;   // silver lining
    gl_FragColor = vec4(col, cov * elev * 0.95);
  }
`;

export function createOceanSky(scene, renderer, noiseTex, sharedTime) {
  const sky = createSky(scene, renderer, noiseTex, sharedTime);
  sky.sky.visible = false;
  const phi = THREE.MathUtils.degToRad(90 - SUN.elevation), theta = THREE.MathUtils.degToRad(SUN.azimuth);
  sky.sunDir.setFromSphericalCoords(1, phi, theta);       // shared by reference with clouds / shadows
  sky.sky.material.uniforms.sunPosition.value.copy(sky.sunDir);
  sky.sunColor.setRGB(1.0, 0.93, 0.8);
  sky.sun.color.copy(sky.sunColor);
  sky.sun.intensity = 3.5;
  sky.sun.position.copy(sky.sunDir).multiplyScalar(400);
  sky.hemi.color.setHex(0xbcd6ff);
  sky.hemi.groundColor.setHex(0x37596a);   // light bouncing off the sea
  sky.hemi.intensity = 0.6;

  const domeUniforms = {
    uSunDir: { value: sky.sunDir },
    uZenith: { value: new THREE.Color(0.045, 0.16, 0.52) },
    uHorizon: { value: new THREE.Color(0.5, 0.68, 0.92) },
    uSunColor: { value: new THREE.Color(1.0, 0.86, 0.66) },
    uBelow: { value: new THREE.Color(0.05, 0.12, 0.2) },
  };
  const domeMat = new THREE.ShaderMaterial({
    uniforms: domeUniforms, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const domeGeo = new THREE.SphereGeometry(10000, 64, 32);
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.name = 'oceanSkyDome';
  dome.onBeforeRender = (r, s, cam) => { dome.position.copy(cam.position); dome.updateMatrixWorld(); };
  scene.add(dome);

  // fair-weather cumulus: the valley's cloud deck seen edge-on over open sea turns the whole
  // horizon grey, so the ocean uses its own layer that thins out toward the horizon
  if (sky.clouds) {
    const old = sky.clouds.material;
    sky.clouds.material = new THREE.ShaderMaterial({
      uniforms: { tNoise: { value: noiseTex }, uTime: sharedTime, uStorm: { value: 0 }, uSunDir: { value: sky.sunDir }, uSunColor: { value: new THREE.Color(1.0, 0.97, 0.92) }, uShade: { value: new THREE.Color(0.5, 0.58, 0.72) } },
      vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    old.dispose();
  }

  // image-based lighting from the dome
  const skyScene = new THREE.Scene();
  skyScene.add(new THREE.Mesh(domeGeo, domeMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const old = scene.environment;
  const envRT = pmrem.fromScene(skyScene, 0, 0.1, 20000);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.85;
  if (old && old !== envRT.texture) old.dispose();
  pmrem.dispose();

  // horizon haze colour for the scene fog: render the dome just above the horizon and average it
  const haze = horizonColor(renderer, skyScene) || domeUniforms.uHorizon.value.clone();
  scene.fog = new THREE.FogExp2(haze, 0.00007);

  // the weather follows the sea state: more, darker cloud, a dimmer sun and spray haze in a storm
  const base = { sun: sky.sun.intensity, fog: scene.fog.density, hemi: sky.hemi.intensity };
  let lastStorm = -1;
  sky.setStorm = (s) => {
    s = Math.max(0, Math.min(1, s));
    if (Math.abs(s - lastStorm) < 0.002) return;
    lastStorm = s;
    if (sky.clouds && sky.clouds.material.uniforms.uStorm) sky.clouds.material.uniforms.uStorm.value = s;
    sky.sun.intensity = base.sun * (1 - 0.35 * s);
    sky.hemi.intensity = base.hemi * (1 - 0.15 * s);
    scene.fog.density = base.fog * (1 + 1.8 * s);
    domeUniforms.uZenith.value.setRGB(0.045 + 0.1 * s, 0.16 + 0.06 * s, 0.52 - 0.18 * s);
  };
  sky.dome = dome;
  sky.domeUniforms = domeUniforms;
  sky.sunIntensity = sky.sun.intensity;
  sky.haze = haze;
  return sky;
}

function horizonColor(renderer, skyScene) {
  try {
    const S = 16;
    const rt = new THREE.WebGLRenderTarget(S, S, { type: THREE.FloatType });
    const cam = new THREE.PerspectiveCamera(90, 1, 0.1, 30000);
    const buf = new Float32Array(S * S * 4);
    const acc = new THREE.Color(0, 0, 0);
    let n = 0;
    const prevRT = renderer.getRenderTarget();
    for (let a = 0; a < 6; a++) {
      const t = (a / 6) * Math.PI * 2;
      cam.position.set(0, 0, 0);
      cam.lookAt(Math.sin(t), 0, Math.cos(t));
      cam.updateMatrixWorld();
      renderer.setRenderTarget(rt);
      renderer.render(skyScene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf);
      // rows just above the middle (a few degrees above the horizon); row 0 is the bottom
      for (const row of [S / 2, S / 2 + 1]) for (let x = 2; x < S - 2; x++) {
        const k = (row * S + x) * 4;
        if (!(isFinite(buf[k]) && isFinite(buf[k + 1]) && isFinite(buf[k + 2]))) continue;
        acc.r += buf[k]; acc.g += buf[k + 1]; acc.b += buf[k + 2]; n++;
      }
    }
    renderer.setRenderTarget(prevRT);
    rt.dispose();
    if (!n) return null;
    acc.multiplyScalar(1 / n);
    if (acc.r + acc.g + acc.b <= 0.01) return null;
    return acc;
  } catch (e) {
    console.warn('[ocean] horizon colour readback failed', e);
    return null;
  }
}
