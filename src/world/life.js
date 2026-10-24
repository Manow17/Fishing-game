// Ambient life: circling birds, rapids mist, drifting pollen.
import * as THREE from 'three';
import { mulberry32 } from '../util/noise.js';
import { riverRocks, waterY, rapids, flowAt } from './river.js';

// Round, soft, distance-attenuated points (no texture needed).
export function softPointsMaterial(size, color, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: { uSize: { value: size }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uScale: { value: window.innerHeight / 2 } },
    vertexShader: `uniform float uSize, uScale; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = uSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = 1.0 - smoothstep(0.0, 1.0, d); a *= a; gl_FragColor = vec4(uColor, a * uOpacity); }`,
    transparent: true, depthWrite: false,
  });
}

function birdGeometry() {
  // body + two wings; wing verts flagged by x distance for flapping in the update
  const g = new THREE.BufferGeometry();
  const v = [
    0, 0, 0.35, -0.06, 0, -0.25, 0.06, 0, -0.25,           // body
    0, 0, 0.12, -1.0, 0.05, -0.12, -0.05, 0, -0.18,       // left wing
    0, 0, 0.12, 0.05, 0, -0.18, 1.0, 0.05, -0.12,         // right wing
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export function createAmbientLife(scene, time) {
  const rnd = mulberry32(9);
  const birds = [];
  const bmat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, side: THREE.DoubleSide, fog: true });
  for (let i = 0; i < 9; i++) {
    const g = birdGeometry();
    const m = new THREE.Mesh(g, bmat);
    m.scale.setScalar(0.9 + rnd() * 0.6);
    scene.add(m);
    birds.push({ m, g, base: g.attributes.position.array.slice(), r: 60 + rnd() * 120, h: 70 + rnd() * 90, sp: 0.08 + rnd() * 0.08, ph: rnd() * 6.28, fl: rnd() * 6.28, cx: 0, cz: 0 });
  }

  // Mist over rapids rocks
  const mistRocks = riverRocks.filter(r => rapids(r.z) > 0.4);
  const N = 700;
  const mpos = new Float32Array(N * 3);
  const mlife = new Float32Array(N);
  const mgeo = new THREE.BufferGeometry();
  mgeo.setAttribute('position', new THREE.BufferAttribute(mpos, 3));
  const mmat = softPointsMaterial(3.2, 0xffffff, 0.14);
  const mist = new THREE.Points(mgeo, mmat);
  mist.frustumCulled = false;
  scene.add(mist);
  const spawnMist = (i) => {
    const r = mistRocks[(rnd() * mistRocks.length) | 0];
    if (!r) return;
    mpos[i * 3] = r.x + (rnd() - 0.5) * r.r * 2;
    mpos[i * 3 + 1] = waterY(r.z) + 0.2 + rnd() * 0.4;
    mpos[i * 3 + 2] = r.z + rnd() * r.r * 2;
    mlife[i] = rnd() * 4;
  };
  for (let i = 0; i < N; i++) spawnMist(i);

  // Pollen / fluff motes catching the sun near the camera
  const P = 260;
  const ppos = new Float32Array(P * 3);
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
  const pmat = softPointsMaterial(0.06, 0xfff6d8, 0.85);
  const pollen = new THREE.Points(pgeo, pmat);
  pollen.frustumCulled = false;
  scene.add(pollen);
  for (let i = 0; i < P * 3; i++) ppos[i] = (rnd() - 0.5) * 40;

  const f = {};
  return {
    update(dt, cam) {
      const t = time.value;
      for (const b of birds) {
        b.cx += (cam.x - b.cx) * Math.min(1, dt * 0.05);
        b.cz += (cam.z - b.cz) * Math.min(1, dt * 0.05);
        const a = t * b.sp + b.ph;
        b.m.position.set(b.cx + Math.cos(a) * b.r, waterY(b.cz) + b.h + Math.sin(a * 2.3) * 6, b.cz + Math.sin(a) * b.r);
        b.m.rotation.set(0, -a, 0.35);
        const flap = Math.sin(t * 7 + b.fl) * (Math.sin(t * 0.7 + b.fl) > 0.2 ? 0.5 : 0.05);
        const p = b.g.attributes.position.array;
        p[13] = b.base[13] + flap; p[25] = b.base[25] + flap; // wing tips y
        b.g.attributes.position.needsUpdate = true;
      }
      for (let i = 0; i < N; i++) {
        mlife[i] += dt;
        flowAt(mpos[i * 3], mpos[i * 3 + 2], f);
        mpos[i * 3] += f.x * dt * 0.6;
        mpos[i * 3 + 2] += f.z * dt * 0.6;
        mpos[i * 3 + 1] += dt * 0.25;
        if (mlife[i] > 4) spawnMist(i);
      }
      mgeo.attributes.position.needsUpdate = true;
      for (let i = 0; i < P; i++) {
        const k = i * 3;
        ppos[k] += Math.sin(t * 0.3 + i) * dt * 0.3 + dt * 0.4;
        ppos[k + 1] += Math.sin(t * 0.5 + i * 1.7) * dt * 0.15;
        ppos[k + 2] += Math.cos(t * 0.4 + i * 0.3) * dt * 0.3;
        for (let a = 0; a < 3; a++) {
          const c = a === 0 ? cam.x : a === 1 ? cam.y : cam.z;
          const d = ppos[k + a] - c;
          if (d > 20) ppos[k + a] -= 40; else if (d < -20) ppos[k + a] += 40;
        }
      }
      pgeo.attributes.position.needsUpdate = true;
    },
  };
}
