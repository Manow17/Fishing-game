// Splashes, droplets, ripple rings and boat spray.
import * as THREE from 'three';
import { waterY, flowAt } from '../world/river.js';

const _f = {};

const dropVert = `
  attribute float aLife;
  uniform float uScale;
  varying float vLife;
  void main(){
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = (0.06 + (1.0 - aLife) * 0.04) * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const dropFrag = `
  varying float vLife;
  void main(){
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.3, 1.0, d)) * vLife;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(0.92, 0.97, 1.0), a * 0.9);
  }`;

const ringVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const ringFrag = `
  uniform float uLife; varying vec2 vUv;
  void main(){
    float r = length(vUv - 0.5) * 2.0;
    float ring = (1.0 - smoothstep(0.0, 0.08, abs(r - 0.82))) + 0.5 * (1.0 - smoothstep(0.0, 0.06, abs(r - 0.55)));
    float a = ring * uLife * 0.6;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(0.95, 1.0, 1.0), a);
  }`;

export class Effects {
  constructor(scene, water) {
    this.scene = scene;
    this.water = water;
    const N = 900;
    this.N = N;
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    this.mat = new THREE.ShaderMaterial({ uniforms: { uScale: { value: innerHeight / 2 } }, vertexShader: dropVert, fragmentShader: dropFrag, transparent: true, depthWrite: false });
    this.drops = new THREE.Points(g, this.mat);
    this.drops.frustumCulled = false;
    scene.add(this.drops);
    this.next = 0;
    this.rings = [];
    this.ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.sprayAcc = 0;
    this.wakeAcc = 0;
  }

  _emit(x, y, z, vx, vy, vz) {
    const i = this.next; this.next = (this.next + 1) % this.N;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = 1;
  }

  splash(p, size = 0.4) {
    const n = Math.round(20 + size * 60);
    const wy = waterY(p.z);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * size * 0.4;
      const up = 1.2 + Math.random() * 2.8 * (0.5 + size);
      this._emit(p.x + Math.cos(a) * r, wy + 0.02, p.z + Math.sin(a) * r, Math.cos(a) * (0.4 + Math.random()) * (0.6 + size), up, Math.sin(a) * (0.4 + Math.random()) * (0.6 + size));
    }
    this.ring(p, size * 3 + 0.6);
    this.water?.addWake(p.x, p.z, 0.5 + size * 1.2, 0.9);
  }

  ring(p, maxR = 1.2) {
    const mat = new THREE.ShaderMaterial({ uniforms: { uLife: { value: 1 } }, vertexShader: ringVert, fragmentShader: ringFrag, transparent: true, depthWrite: false });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.set(p.x, waterY(p.z) + 0.03, p.z);
    m.renderOrder = 3;
    this.scene.add(m);
    this.rings.push({ m, t: 0, maxR, dur: 1.4 + maxR * 0.3 });
  }

  // continuous effects from the boat
  boat(dt, phys) {
    const sp = Math.hypot(phys.vx, phys.vz);
    const fx = Math.sin(phys.h), fz = Math.cos(phys.h);
    flowAt(phys.x, phys.z, _f);
    const rel = Math.hypot(phys.vx - _f.x, phys.vz - _f.z);
    this.wakeAcc += dt;
    if (this.wakeAcc > 0.12 && (Math.abs(phys.throttle) > 0.05 || rel > 1.2)) {
      this.wakeAcc = 0;
      const sx = phys.x - fx * 3.6, sz = phys.z - fz * 3.6;
      this.water.addWake(sx, sz, 0.6 + Math.abs(phys.throttle) * 0.8, 0.5 + Math.abs(phys.throttle) * 0.6);
      if (rel > 2) {
        const bx = phys.x + fx * 3.2, bz = phys.z + fz * 3.2;
        this.water.addWake(bx - fz * 0.6, bz + fx * 0.6, 0.5, 0.35);
        this.water.addWake(bx + fz * 0.6, bz - fx * 0.6, 0.5, 0.35);
      }
    }
    // bow spray at speed
    if (rel > 3) {
      this.sprayAcc += dt * rel * 6;
      while (this.sprayAcc > 1) {
        this.sprayAcc -= 1;
        const side = Math.random() < 0.5 ? -1 : 1;
        const bx = phys.x + fx * 2.6, bz = phys.z + fz * 2.6;
        const wy = waterY(bz);
        this._emit(bx + side * fz * 0.5, wy + 0.1, bz - side * fx * 0.5, side * fz * 1.5 + phys.vx * 0.6, 1 + Math.random() * 1.5, -side * fx * 1.5 + phys.vz * 0.6);
      }
    }
    // propeller wash
    if (Math.abs(phys.throttle) > 0.1 && Math.random() < dt * 30 * Math.abs(phys.throttle)) {
      const sx = phys.x - fx * 3.9, sz = phys.z - fz * 3.9;
      this._emit(sx, waterY(sz) + 0.05, sz, -fx * 2 * phys.throttle + (Math.random() - 0.5), 0.6 + Math.random(), -fz * 2 * phys.throttle + (Math.random() - 0.5));
    }
  }

  update(dt) {
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3;
      this.vel[k + 1] -= 9.81 * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.life[i] -= dt * 1.1;
      if (this.pos[k + 1] < waterY(this.pos[k + 2]) - 0.05) this.life[i] = 0;
    }
    this.drops.geometry.attributes.position.needsUpdate = true;
    this.drops.geometry.attributes.aLife.needsUpdate = true;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.dur;
      const s = 0.2 + Math.sqrt(k) * r.maxR * 2;
      r.m.scale.set(s, 1, s);
      flowAt(r.m.position.x, r.m.position.z, _f);
      r.m.position.x += _f.x * dt; r.m.position.z += _f.z * dt;
      r.m.material.uniforms.uLife.value = 1 - k;
      if (k >= 1) { this.scene.remove(r.m); r.m.material.dispose(); this.rings.splice(i, 1); }
    }
  }
}
