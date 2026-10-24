// A side stream tumbling down the northern gorge wall: streaky falling-water sheet + mist + plunge foam.
import * as THREE from 'three';
import { centerSlope, waterY } from './river.js';
import { heightAt } from './terrain.js';
import { bankX } from './layout.js';
import { softPointsMaterial } from './life.js';

const vert = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWP;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWP = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const frag = /* glsl */`
  uniform sampler2D tNoise;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWP;
  #include <fog_pars_fragment>
  void main() {
    // u across the fall, v down it (0 top .. 1 bottom); streaks rush downward and speed up as they fall
    float v = vUv.y;
    float speed = 0.55 + v * 0.9;
    float a = texture2D(tNoise, vec2(vUv.x * 2.3, v * 0.9 - uTime * speed * 0.35)).r;
    float b = texture2D(tNoise, vec2(vUv.x * 5.1 + 0.3, v * 1.7 - uTime * speed * 0.6)).g;
    float streak = smoothstep(0.35, 0.75, a * 0.65 + b * 0.55);
    float edge = smoothstep(0.0, 0.18, vUv.x) * (1.0 - smoothstep(0.82, 1.0, vUv.x));
    float alpha = (0.35 + 0.6 * streak) * edge * (1.0 - smoothstep(0.9, 1.0, v) * 0.5);
    vec3 col = mix(vec3(0.62, 0.78, 0.8), vec3(0.97, 0.99, 1.0), streak);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    #include <fog_fragment>
  }`;

export function createWaterfall(scene, noiseTex, time, z = -2440, side = 1) {
  // follow the cliff profile from the wall top down to the river, 0.6 m proud of the rock
  const W = 7, rows = 26;
  const pos = [], uv = [], idx = [];
  const s = centerSlope(z);
  const out = side / Math.sqrt(1 + s * s); // outward (away from river) x-ish direction
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const e = 14 * (1 - t) - 0.5;
    for (let c = 0; c <= 1; c++) {
      const zz = z + (c - 0.5) * W * (1 + t * 0.35);
      const x = bankX(zz, side, e);
      const y = Math.max(heightAt(x, zz), waterY(zz) - 0.1);
      pos.push(x - out * 0.6, y + 0.05, zz);
      uv.push(c, t);
    }
  }
  for (let r = 0; r < rows; r++) { const a = r * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tNoise: { value: null }, uTime: { value: 0 } }]),
    vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
  mat.uniforms.tNoise.value = noiseTex;
  mat.uniforms.uTime = time;
  const fall = new THREE.Mesh(g, mat);
  fall.renderOrder = 3;
  scene.add(fall);

  // mist billowing at the plunge
  const base = new THREE.Vector3(bankX(z, side, 1), waterY(z), z);
  const N = 220;
  const mp = new Float32Array(N * 3), life = new Float32Array(N);
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const mist = new THREE.Points(mg, softPointsMaterial(5, 0xffffff, 0.12));
  mist.frustumCulled = false;
  scene.add(mist);
  const spawn = (i) => {
    mp[i * 3] = base.x + (Math.random() - 0.5) * 6 - out * Math.random() * 6;
    mp[i * 3 + 1] = base.y + Math.random() * 1.5;
    mp[i * 3 + 2] = base.z + (Math.random() - 0.5) * 9;
    life[i] = Math.random() * 3;
  };
  for (let i = 0; i < N; i++) spawn(i);
  return {
    base,
    update(dt) {
      for (let i = 0; i < N; i++) {
        life[i] += dt;
        mp[i * 3 + 1] += dt * 0.8;
        mp[i * 3] -= out * dt * 0.6;
        if (life[i] > 3) spawn(i);
      }
      mg.attributes.position.needsUpdate = true;
    },
  };
}
