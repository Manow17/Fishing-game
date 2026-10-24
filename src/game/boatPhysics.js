// 2.5D boat dynamics on a flowing river: thrust, hull drag vs. current, anchor, banks and rocks.
import { flowAt, riverCoords, waterY, riverRocks, PLAY_Z, rapids } from '../world/river.js';
import { sampleDepth } from '../world/terrain.js';

const _f = {}, _c = {};

export class BoatPhysics {
  constructor(x, z, heading = 0) {
    this.x = x; this.z = z; this.h = heading;
    this.vx = 0; this.vz = 0; this.w = 0;
    this.throttle = 0; this.steer = 0;
    this.anchored = false; this.anchorX = 0; this.anchorZ = 0; this.rope = 9;
    this.mass = 480; this.inertia = 2600;
    this.maxThrust = 2100;
    this.halfLen = 3.6;
    this.y = waterY(z); this.pitch = 0; this.roll = 0;
    this.speedOverGround = 0; this.flowSpeed = 0;
    this.bump = 0; // collision impulse for sound/shake
    this.t = 0;
    this.obstacles = riverRocks.slice(); // circles {x, z, r}: river boulders + dock pilings
  }

  setAnchor(on) {
    this.anchored = on;
    if (on) {
      const fx = Math.sin(this.h), fz = Math.cos(this.h);
      this.anchorX = this.x + fx * (this.halfLen + 2);
      this.anchorZ = this.z + fz * (this.halfLen + 2);
    }
  }

  step(dt) {
    const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) this._step(h);
    this.t += dt;
    // vertical motion: ride the surface, waves give pitch/roll
    const wy = waterY(this.z);
    const rp = rapids(this.z);
    const t = this.t;
    const amp = 0.04 + rp * 0.18;
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    const wave = (x, z) => amp * (Math.sin(z * 0.9 + x * 0.3 - t * 2.1) + Math.sin(z * 0.37 - x * 0.55 + t * 1.3) * 0.8 + rp * Math.sin(z * 1.6 + Math.sin(x * 0.7) * 1.5) * 1.5);
    const bow = wave(this.x + fx * 3, this.z + fz * 3), stern = wave(this.x - fx * 3, this.z - fz * 3);
    const port = wave(this.x - fz * 0.8, this.z + fx * 0.8), stbd = wave(this.x + fz * 0.8, this.z - fx * 0.8);
    const fwdSpeed = (this.vx - _f.x) * fx + (this.vz - _f.z) * fz;
    const squat = Math.max(0, Math.min(1, fwdSpeed / 7)) * this.throttle;
    const targetPitch = Math.atan2(stern - bow, 6) - squat * 0.07;
    const targetRoll = Math.atan2(stbd - port, 1.6) * 0.6 - this.w * 0.12 * Math.min(1, Math.abs(fwdSpeed) / 3);
    const k = Math.min(1, dt * 4);
    this.pitch += (targetPitch - this.pitch) * k;
    this.roll += (targetRoll - this.roll) * k;
    this.y += ((wy + (bow + stern + port + stbd) * 0.25 + squat * 0.05) - this.y) * Math.min(1, dt * 6);
  }

  _step(dt) {
    if (this.moored) { this.vx = this.vy = 0; this.vz = 0; this.w = 0; this.speedOverGround = 0; return; }
    flowAt(this.x, this.z, _f);
    this.flowSpeed = _f.speed;
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    const rx = fz, rz = -fx; // starboard
    const rvx = this.vx - _f.x, rvz = this.vz - _f.z;
    const vf = rvx * fx + rvz * fz;
    const vs = rvx * rx + rvz * rz;
    let Fx = 0, Fz = 0, tq = 0;
    // outboard thrust at the stern, angled by steering
    const steerAng = this.steer * 0.55; // +steer = starboard turn (pushes stern to port)
    const thrust = this.throttle * this.maxThrust * (this.throttle < 0 ? 0.45 : 1);
    const tdx = Math.sin(this.h + steerAng), tdz = Math.cos(this.h + steerAng);
    Fx += tdx * thrust; Fz += tdz * thrust;
    const lat = thrust * Math.sin(steerAng);
    tq += -lat * this.halfLen; // stern lever: pushes stern sideways
    // rudder/skeg effect even when coasting
    tq += -vf * this.steer * 220 * (Math.abs(this.throttle) < 0.05 ? 1 : 0.3);
    // hull drag (long narrow hull: low forward, high lateral)
    const Df = 38 * vf * Math.abs(vf) + 60 * vf;
    const Ds = 520 * vs * Math.abs(vs) + 300 * vs;
    Fx -= fx * Df + rx * Ds; Fz -= fz * Df + rz * Ds;
    // rotational damping (hull sweeping through water)
    tq -= 2400 * this.w + 5200 * this.w * Math.abs(this.w);
    // anchor rope at the bow
    if (this.anchored) {
      const bx = this.x + fx * this.halfLen, bz = this.z + fz * this.halfLen;
      const dx = this.anchorX - bx, dz = this.anchorZ - bz;
      const d = Math.hypot(dx, dz);
      if (d > this.rope) {
        const pvx = this.vx + this.w * fz * this.halfLen, pvz = this.vz - this.w * fx * this.halfLen;
        const ux = dx / d, uz = dz / d;
        const vRel = pvx * ux + pvz * uz;
        const F = Math.max(0, 2600 * (d - this.rope) - 900 * vRel);
        Fx += ux * F; Fz += uz * F;
        // torque = r x F (2D cross, y-up, heading-based frame)
        const rbx = fx * this.halfLen, rbz = fz * this.halfLen;
        tq += (rbz * ux * F - rbx * uz * F);
      }
    }
    this.vx += (Fx / this.mass) * dt;
    this.vz += (Fz / this.mass) * dt;
    this.w += (tq / this.inertia) * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.h += this.w * dt;
    this._collide(dt);
    this.speedOverGround = Math.hypot(this.vx, this.vz);
  }

  _collide() {
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    // sample bow, middle and stern against banks/shallows
    for (const s of [-this.halfLen + 0.5, 0, this.halfLen - 0.5]) {
      const px = this.x + fx * s, pz = this.z + fz * s;
      const dep = sampleDepth(px, pz);
      if (dep < 0.45) {
        // push toward deeper water (works for banks, lake shores, islands and side rivers)
        let nx = sampleDepth(px + 1.5, pz) - sampleDepth(px - 1.5, pz);
        let nz = sampleDepth(px, pz + 1.5) - sampleDepth(px, pz - 1.5);
        const gl = Math.hypot(nx, nz);
        if (gl < 1e-4) { riverCoords(px, pz, _c); nx = -Math.sign(_c.d) * _c.tz; nz = Math.sign(_c.d) * _c.tx; }
        else { nx /= gl; nz /= gl; }
        const pen = (0.45 - dep) * 2.5 + 0.05;
        this.x += nx * pen * 0.5; this.z += nz * pen * 0.5;
        const vn = this.vx * nx + this.vz * nz;
        if (vn < 0) { this.vx -= nx * vn * 1.4; this.vz -= nz * vn * 1.4; this.bump = Math.max(this.bump, -vn); }
        this.w *= 0.96;
      }
    }
    for (const r of this.obstacles) {
      if (Math.abs(r.z - this.z) > 10) continue;
      for (const s of [-this.halfLen + 0.6, 0, this.halfLen - 0.6]) {
        const px = this.x + fx * s, pz = this.z + fz * s;
        const dx = px - r.x, dz = pz - r.z;
        const d = Math.hypot(dx, dz);
        const R = r.r + 0.85;
        if (d < R && d > 1e-4) {
          const nx = dx / d, nz = dz / d;
          this.x += nx * (R - d); this.z += nz * (R - d);
          const vn = this.vx * nx + this.vz * nz;
          if (vn < 0) { this.vx -= nx * vn * 1.5; this.vz -= nz * vn * 1.5; this.bump = Math.max(this.bump, -vn); }
          // spin off the rock
          this.w += (s / this.halfLen) * (nx * fz - nz * fx) * 0.02;
        }
      }
    }
    if (this.z < PLAY_Z[0]) { this.vz = Math.max(this.vz, 0) + (PLAY_Z[0] - this.z) * 0.05; }
    if (this.z > PLAY_Z[1]) { this.vz = Math.min(this.vz, 0) - (this.z - PLAY_Z[1]) * 0.05; }
  }

  serialize() { return [this.x, this.y, this.z, this.h, this.pitch, this.roll]; }
}
