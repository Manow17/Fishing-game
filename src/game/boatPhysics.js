// 2.5D boat dynamics: thrust, hull drag vs. current, anchor, shores and rocks — plus real buoyancy:
// the hull samples the actual wave surface (ENV.surface) at bow, stern and both sides and rides it with
// spring-damped heave, pitch and roll, so big waves lift, tilt and drop the boat.
import { ENV } from '../world/env.js';

const _f = {};

export class BoatPhysics {
  constructor(x, z, heading = 0) {
    this.x = x; this.z = z; this.h = heading;
    this.vx = 0; this.vz = 0; this.w = 0;
    this.throttle = 0; this.steer = 0;
    this.anchored = false; this.anchorX = 0; this.anchorZ = 0; this.rope = 9;
    this.setHull({ mass: 480, thrust: 2100, halfLength: 3.6, beam: 1.64, draft: 0.2 }, 1);
    this.y = ENV.waterLevel(x, z); this.vy = 0;
    this.pitch = 0; this.roll = 0; this.vPitch = 0; this.vRoll = 0;
    this.speedOverGround = 0; this.flowSpeed = 0;
    this.bump = 0; // collision impulse for sound/shake
    this.slam = 0; // wave impact (camera shake / spray)
    this.t = 0;
    this.obstacles = ENV.obstacles.slice(); // circles {x, z, r}: rocks + dock pilings
    this.thrustMult = 1;
  }

  // hull from the boat model's physics block, scaled by the size slider
  setHull(p, size = 1) {
    this.size = size;
    this.halfLen = p.halfLength * size;
    this.beam = p.beam * size;
    this.mass = p.mass * size * size * size;
    this.inertia = this.mass * (2 * this.halfLen) ** 2 / 10;
    this.baseThrust = p.thrust * size * size;
    // drag scales with wetted area
    this.dragF = 38 * size * size;
    this.dragS = 520 * size * size;
    this.rotDrag = 2400 * size ** 4;
    this.rotDrag2 = 5200 * size ** 4;
  }
  get maxThrust() { return this.baseThrust * this.thrustMult; }
  set maxThrust(v) { this.thrustMult = v / Math.max(1, this.baseThrust); }

  setAnchor(on) {
    this.anchored = on;
    if (on) {
      const fx = Math.sin(this.h), fz = Math.cos(this.h);
      this.anchorX = this.x + fx * (this.halfLen + 2);
      this.anchorZ = this.z + fz * (this.halfLen + 2);
    }
  }

  step(dt) {
    // at least 120 Hz, and never more than 0.4 m per substep so very fast boats can't tunnel through banks
    const sub = Math.min(160, Math.max(1, Math.ceil(dt / (1 / 120)), Math.ceil(this.speedOverGround * dt / 0.4)));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) this._step(h);
    this.t += dt;
    this._buoyancy(dt);
  }

  // Ride the waves: sample the surface around the hull and spring toward it.
  _buoyancy(dt) {
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    const L = this.halfLen * 0.8, B = this.beam * 0.45;
    const S = (dx, dz) => ENV.surface(this.x + dx, this.z + dz);
    const bow = S(fx * L, fz * L), stern = S(-fx * L, -fz * L);
    const port = S(-fz * B, fx * B), stbd = S(fz * B, -fx * B);
    const mid = S(0, 0);
    flowAt(this);
    const fwdSpeed = (this.vx - _f.x) * fx + (this.vz - _f.z) * fz;
    const squat = Math.max(0, Math.min(1, fwdSpeed / 7)) * Math.max(0, this.throttle);
    // heave: stiff spring to the mean surface, damped; a light hull pops back up quicker
    const targetY = (bow + stern + port + stbd + mid * 2) / 6 + squat * 0.06;
    const k = 38, c = 9;
    const ay = k * (targetY - this.y) - c * this.vy;
    this.vy += ay * dt;
    this.y += this.vy * dt;
    // pitch / roll from the surface slope, with inertia so the boat rocks and overshoots a little
    const tPitch = Math.atan2(stern - bow, 2 * L) - squat * 0.08;
    const tRoll = Math.atan2(stbd - port, 2 * B) * 0.75 - this.w * 0.12 * Math.min(1, Math.abs(fwdSpeed) / 3);
    const kp = 26, cp = 6.5;
    this.vPitch += (kp * (tPitch - this.pitch) - cp * this.vPitch) * dt;
    this.vRoll += (kp * 0.8 * (tRoll - this.roll) - cp * 0.8 * this.vRoll) * dt;
    this.pitch += this.vPitch * dt;
    this.roll += this.vRoll * dt;
    this.pitch = Math.max(-0.6, Math.min(0.6, this.pitch));
    this.roll = Math.max(-0.5, Math.min(0.5, this.roll));
    // slamming into a wave face at speed
    const face = Math.max(0, (bow - stern) / (2 * L)) * Math.max(0, fwdSpeed);
    this.slam = Math.max(this.slam * Math.exp(-dt * 4), face > 0.6 ? face * 0.5 : 0);
    // big waves shove the boat down their slopes (surface gradient in world space)
    if (ENV.waveScale > 1.05 && !this.moored) {
      const gx = (S(1.5, 0) - S(-1.5, 0)) / 3, gz = (S(0, 1.5) - S(0, -1.5)) / 3;
      const push = 4.5 * dt;
      this.vx -= gx * push;
      this.vz -= gz * push;
    }
  }

  _step(dt) {
    if (this.moored) { this.vx = this.vz = 0; this.w = 0; this.speedOverGround = 0; return; }
    flowAt(this);
    this.flowSpeed = _f.speed;
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    const rx = fz, rz = -fx;
    const rvx = this.vx - _f.x, rvz = this.vz - _f.z;
    const vf = rvx * fx + rvz * fz;
    const vs = rvx * rx + rvz * rz;
    let Fx = 0, Fz = 0, tq = 0;
    // thrust at the stern, angled by steering
    const steerAng = this.steer * 0.55; // +steer = starboard turn (pushes stern to port)
    const thrust = this.throttle * this.maxThrust * (this.throttle < 0 ? 0.45 : 1);
    const tdx = Math.sin(this.h + steerAng), tdz = Math.cos(this.h + steerAng);
    Fx += tdx * thrust; Fz += tdz * thrust;
    const lat = thrust * Math.sin(steerAng);
    tq += -lat * this.halfLen;
    // rudder/skeg effect even when coasting
    tq += -vf * this.steer * 220 * this.size ** 3 * (Math.abs(this.throttle) < 0.05 ? 1 : 0.3);
    // hull drag (low forward, high lateral)
    const Df = this.dragF * vf * Math.abs(vf) + 60 * this.size * vf;
    const Ds = this.dragS * vs * Math.abs(vs) + 300 * this.size * vs;
    Fx -= fx * Df + rx * Ds; Fz -= fz * Df + rz * Ds;
    tq -= this.rotDrag * this.w + this.rotDrag2 * this.w * Math.abs(this.w);
    // anchor rope at the bow
    if (this.anchored) {
      const bx = this.x + fx * this.halfLen, bz = this.z + fz * this.halfLen;
      const dx = this.anchorX - bx, dz = this.anchorZ - bz;
      const d = Math.hypot(dx, dz);
      if (d > this.rope) {
        const pvx = this.vx + this.w * fz * this.halfLen, pvz = this.vz - this.w * fx * this.halfLen;
        const ux = dx / d, uz = dz / d;
        const vRel = pvx * ux + pvz * uz;
        const F = Math.max(0, (2600 * (d - this.rope) - 900 * vRel) * this.mass / 480);
        Fx += ux * F; Fz += uz * F;
        const rbx = fx * this.halfLen, rbz = fz * this.halfLen;
        tq += (rbz * ux * F - rbx * uz * F);
      }
    }
    this.vx += (Fx / this.mass) * dt;
    this.vz += (Fz / this.mass) * dt;
    this.w += (tq / this.inertia) * dt;
    // huge (cheat) thrust would otherwise spin the hull like a top
    const wMax = 1.5;
    if (this.w > wMax) this.w = wMax; else if (this.w < -wMax) this.w = -wMax;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.h += this.w * dt;
    this._collide();
    this.speedOverGround = Math.hypot(this.vx, this.vz);
  }

  _collide() {
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    const minDepth = 0.35 + 0.1 * this.size;
    // bow, middle and stern against shores and shallows: push toward deeper water
    for (const s of [-this.halfLen + 0.5, 0, this.halfLen - 0.5]) {
      const px = this.x + fx * s, pz = this.z + fz * s;
      const dep = ENV.depth(px, pz);
      if (dep < minDepth) {
        let nx = ENV.depth(px + 1.5, pz) - ENV.depth(px - 1.5, pz);
        let nz = ENV.depth(px, pz + 1.5) - ENV.depth(px, pz - 1.5);
        let gl = Math.hypot(nx, nz);
        if (gl < 1e-4) {
          // fully on dry land (depth is flat zero): head downhill, which leads back to the water
          nx = ENV.groundY(px - 1.5, pz) - ENV.groundY(px + 1.5, pz);
          nz = ENV.groundY(px, pz - 1.5) - ENV.groundY(px, pz + 1.5);
          gl = Math.hypot(nx, nz);
        }
        if (gl < 1e-4) { nx = -fx; nz = -fz; } else { nx /= gl; nz /= gl; }
        const pen = (minDepth - dep) * 2.5 + 0.05 + (dep <= 0 ? 0.3 : 0);
        this.x += nx * pen * 0.5; this.z += nz * pen * 0.5;
        const vn = this.vx * nx + this.vz * nz;
        if (vn < 0) { this.vx -= nx * vn * 1.4; this.vz -= nz * vn * 1.4; this.bump = Math.max(this.bump, -vn); }
        this.w *= 0.96;
      }
    }
    const reach = this.halfLen + 6;
    for (const r of this.obstacles) {
      if (Math.abs(r.z - this.z) > reach + r.r || Math.abs(r.x - this.x) > reach + r.r) continue;
      for (const s of [-this.halfLen + 0.6, 0, this.halfLen - 0.6]) {
        const px = this.x + fx * s, pz = this.z + fz * s;
        const dx = px - r.x, dz = pz - r.z;
        const d = Math.hypot(dx, dz);
        const R = r.r + this.beam * 0.52;
        if (d < R && d > 1e-4) {
          const nx = dx / d, nz = dz / d;
          this.x += nx * (R - d); this.z += nz * (R - d);
          const vn = this.vx * nx + this.vz * nz;
          if (vn < 0) { this.vx -= nx * vn * 1.5; this.vz -= nz * vn * 1.5; this.bump = Math.max(this.bump, -vn); }
          this.w += (s / this.halfLen) * (nx * fz - nz * fx) * 0.02;
        }
      }
    }
    // map edges: a firm wall, so even a very fast boat stops at the edge
    const B = ENV.bounds;
    if (this.z < B.z0) { this.z = B.z0; this.vz = Math.max(this.vz, 0); }
    if (this.z > B.z1) { this.z = B.z1; this.vz = Math.min(this.vz, 0); }
    if (this.x < B.x0) { this.x = B.x0; this.vx = Math.max(this.vx, 0); }
    if (this.x > B.x1) { this.x = B.x1; this.vx = Math.min(this.vx, 0); }
  }

  serialize() { return [this.x, this.y, this.z, this.h, this.pitch, this.roll]; }
}

function flowAt(b) { return ENV.flowAt(b.x, b.z, _f); }
