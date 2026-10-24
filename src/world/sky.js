// Sky, sun, lighting, fog, clouds and environment maps.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const cloudVert = /* glsl */`
  varying vec3 vWPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const cloudFrag = /* glsl */`
  uniform sampler2D tNoise;
  uniform float uTime;
  uniform vec3 uSunDir, uSunColor, uShade;
  varying vec3 vWPos;
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * texture2D(tNoise, p).r; p *= 2.03; a *= 0.5; }
    return s;
  }
  void main() {
    vec2 p = vWPos.xz * 0.000045 + vec2(uTime * 0.0012, uTime * 0.0004);
    float n = fbm(p);
    float n2 = fbm(p * 1.7 + 4.0);
    float cov = smoothstep(0.42, 0.72, n * 0.75 + n2 * 0.4);
    float r = length(vWPos.xz - cameraPosition.xz);
    float fade = 1.0 - smoothstep(9000.0, 15000.0, r);
    float thick = smoothstep(0.42, 0.95, n * 0.75 + n2 * 0.4);
    vec3 col = mix(uSunColor * 1.05, uShade, thick * 0.7);
    vec3 V = normalize(vWPos - cameraPosition);
    col += uSunColor * pow(max(dot(V, uSunDir), 0.0), 6.0) * (1.0 - thick) * 0.8;
    gl_FragColor = vec4(col, cov * fade * 0.92);
  }
`;

export function createSky(scene, renderer, noiseTex, sharedTime) {
  const sky = new Sky();
  sky.scale.setScalar(40000);
  const su = sky.material.uniforms;
  su.turbidity.value = 2.2;
  su.rayleigh.value = 2.0;
  su.mieCoefficient.value = 0.003;
  su.mieDirectionalG.value = 0.82;
  scene.add(sky);

  const sunDir = new THREE.Vector3();
  const elevation = 26, azimuth = 205;
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  sunDir.setFromSphericalCoords(1, phi, theta);
  su.sunPosition.value.copy(sunDir);

  const sunColor = new THREE.Color(1.0, 0.93, 0.8);
  const sun = new THREE.DirectionalLight(sunColor, 3.4);
  sun.position.copy(sunDir).multiplyScalar(400);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const S = 70;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 1200 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x4d5a30, 0.55);
  scene.add(hemi);

  scene.fog = new THREE.FogExp2(0x9dbad8, 0.00009);

  // Cloud layer
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: {
      tNoise: { value: noiseTex }, uTime: sharedTime,
      uSunDir: { value: sunDir }, uSunColor: { value: new THREE.Color(1.0, 0.97, 0.92) }, uShade: { value: new THREE.Color(0.62, 0.68, 0.78) },
    },
    vertexShader: cloudVert, fragmentShader: cloudFrag,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(36000, 36000, 1, 1), cloudMat);
  clouds.rotation.x = -Math.PI / 2;
  clouds.position.y = 3400;
  clouds.renderOrder = -1;
  scene.add(clouds);

  // Image-based lighting from the sky only.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  const skyClone = new Sky();
  skyClone.scale.setScalar(1000);
  for (const k in su) skyClone.material.uniforms[k].value = su[k].value;
  skyScene.add(skyClone);
  const envRT = pmrem.fromScene(skyScene, 0, 0.1, 2000);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.75;

  // Cube map of the real surroundings (mountains, forests) for water reflections.
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cubeCam = new THREE.CubeCamera(2, 30000, cubeRT);
  scene.add(cubeCam);
  let lastCubePos = new THREE.Vector3(1e9, 0, 0);

  return {
    sky, sun, hemi, sunDir, sunColor, clouds,
    cubeTexture: cubeRT.texture,
    // Re-capture reflections when the viewer moved far enough. Water must be hidden by caller.
    updateReflections(pos, hide, force = false) {
      if (!force && pos.distanceToSquared(lastCubePos) < 180 * 180) return false;
      lastCubePos.copy(pos);
      cubeCam.position.set(pos.x, pos.y + 2, pos.z);
      for (const o of hide) o.visible = false;
      cubeCam.update(renderer, scene);
      for (const o of hide) o.visible = true;
      return true;
    },
    // Keep the shadow frustum centred on the player, snapped to texels.
    follow(target) {
      const texel = (2 * S) / sun.shadow.mapSize.x;
      const tx = Math.round(target.x / texel) * texel;
      const tz = Math.round(target.z / texel) * texel;
      sun.target.position.set(tx, target.y, tz);
      sun.position.set(tx, target.y, tz).addScaledVector(sunDir, 500);
    },
  };
}
