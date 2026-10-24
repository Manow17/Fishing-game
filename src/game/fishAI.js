// Fish population around the player: spawning by habitat, holding in the current,
// noticing lures, following, striking — and rendering every fish (incl. the hooked one).
import * as THREE from 'three';
import { createFish } from '../models/fish.js';
import { SPECIES, weightOf, rollLength } from './species.js';
import { ENV } from '../world/env.js';

const waterY = (x, z) => ENV.waterLevel(x, z);
const heightAt = (x, z) => ENV.groundY(x, z);
const depthAt = (x, z) => ENV.depth(x, z);
const flowAt = (x, z, out) => ENV.flowAt(x, z, out);

// how deep a species swims here: absolute metres (ocean species) or a fraction of the local depth
function swimDepth(sp, dep, rnd) {
  if (sp.depthM) return Math.min(dep - 0.4, sp.depthM[0] + rnd() * (sp.depthM[1] - sp.depthM[0]));
  return THREE.MathUtils.clamp(dep * (sp.depth[0] + rnd() * (sp.depth[1] - sp.depth[0])), 0.3, dep - 0.2);
}

const _f = {};
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const TARGET = 48, RADIUS = 110, DESPAWN = 150;

function lureQuality(type, speed) {
  const band = (lo, hi) => speed < lo ? speed / lo : speed > hi ? Math.max(0.15, 1 - (speed - hi) * 0.8) : 1;
  switch (type) {
    case 'spinner': return speed < 0.15 ? 0.15 : band(0.35, 1.6);
    case 'spoon': return speed < 0.1 ? 0.3 : band(0.3, 1.4);
    case 'minnow': return speed < 0.1 ? 0.35 : band(0.3, 1.9);
    case 'float': return speed < 0.3 ? 1 : 0.35;
  }
  return 0.5;
}

let _id = 1;

export class FishManager {
  constructor(scene) {
    this.scene = scene;
    this.fish = [];
    this.rnd = Math.random;
    this.rig = null;
    this.spawnTimer = 0;
  }

  _pickSpecies(x, z) {
    const dep = depthAt(x, z);
    const vals = ENV.habitat(x, z, dep);
    const ids = ENV.species.filter(id => SPECIES[id]);
    let total = 0;
    const w = ids.map(id => {
      const s = SPECIES[id];
      let sc = 0.12;
      for (const k in s.habitat) sc += s.habitat[k] * (vals[k] || 0);
      if (s.minDepth && dep < s.minDepth) sc *= 0.05; // giants stay in deep enough water
      sc = sc * s.abundance;
      total += sc;
      return sc;
    });
    let r = this.rnd() * total;
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return ids[i]; }
    return ids[0];
  }

  _spawn(center, near = false) {
    for (let tries = 0; tries < 30; tries++) {
      // biased toward the player so there is always something to fish for
      const r = Math.pow(this.rnd(), 1.3) * RADIUS, a = this.rnd() * Math.PI * 2;
      const x = center.x + Math.cos(a) * r;
      const z = THREE.MathUtils.clamp(center.z + Math.sin(a) * r, ENV.bounds.z0 + 20, ENV.bounds.z1 - 20);
      const dep = depthAt(x, z);
      if (dep < 0.5) continue;
      const dx = x - center.x, dz = z - center.z;
      if (!near && dx * dx + dz * dz < 14 * 14) continue;
      const id = this._pickSpecies(x, z);
      const sp = SPECIES[id];
      const len = rollLength(id, this.rnd);
      const y = waterY(x, z) - swimDepth(sp, dep, this.rnd);
      const seed = ((this.rnd() * 300) | 0) * 3 + (this.rnd() < 0.5 ? 0 : 1); // only the 2 preloaded colour variants
      const model = createFish(id, len, seed);
      model.object.visible = true;
      this.scene.add(model.object);
      const f = {
        id: _id++, species: id, len, seed, weight: weightOf(id, len), model,
        pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), home: new THREE.Vector3(x, y, z),
        yaw: 0, pitch: 0, roll: 0, state: 'hold', timer: 2 + this.rnd() * 6, cooldown: 0, interest: 0,
        aggr: 0.4 + this.rnd() * 0.6, hooked: false, mouthPos: new THREE.Vector3(x, y, z), fvel: new THREE.Vector3(),
        turn: 0,
      };
      flowAt(x, z, _f);
      f.yaw = Math.atan2(-_f.x, -_f.z);
      this.fish.push(f);
      return f;
    }
    return null;
  }

  remove(f) {
    const i = this.fish.indexOf(f);
    if (i >= 0) this.fish.splice(i, 1);
    this.scene.remove(f.model.object);
    f.model.dispose();
  }

  // Lure splash: close fish may spook, a bit further may come to look
  onSplash(pos, size) {
    for (const f of this.fish) {
      if (f.hooked) continue;
      const d = f.pos.distanceTo(pos);
      if (d < 1.3 && this.rnd() < 0.5) this._spook(f, pos);
      else if (d < 4 && this.rnd() < 0.25 && f.cooldown <= 0) { f.state = 'interested'; f.timer = 3; }
    }
  }

  onMissed(f) {
    f.state = 'hold';
    f.cooldown = 8 + this.rnd() * 14;
    f.timer = 1;
    f.biting = false;
  }

  _spook(f, from) {
    f.state = 'flee';
    f.timer = 1.5 + this.rnd() * 1.5;
    f.cooldown = 10 + this.rnd() * 10;
    _v.copy(f.pos).sub(from); _v.y = 0;
    if (_v.lengthSq() < 1e-4) _v.set(1, 0, 0);
    f.fleeDir = _v.normalize().clone();
  }

  release(f) {
    // swim off strongly and despawn later
    f.hooked = false;
    f.state = 'released';
    f.timer = 4;
    f.cooldown = 999;
    f.pos.y = Math.min(f.pos.y, waterY(f.pos.x, f.pos.z) - 0.3);
    if (!f.model.object.parent) this.scene.add(f.model.object);
  }

  update(dt, boat, camPos) {
    const center = boat.pos;
    // maintain population
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.25;
      if (this.fish.length < TARGET) this._spawn(center, this.fish.length < TARGET * 0.5);
    }
    const lure = this.rig ? this.rig.lureInfo() : { active: false };
    for (let i = this.fish.length - 1; i >= 0; i--) {
      const f = this.fish[i];
      if (f.hooked) { this._renderHooked(f, dt); continue; }
      if (f.inCrate) continue;
      const dx = f.pos.x - center.x, dz = f.pos.z - center.z;
      if (dx * dx + dz * dz > DESPAWN * DESPAWN || (f.state === 'released' && f.timer <= 0)) { this.remove(f); continue; }
      this._think(f, dt, lure, boat);
      this._move(f, dt);
      this._render(f, dt, camPos);
    }
  }

  _think(f, dt, lure, boat) {
    const sp = SPECIES[f.species];
    f.timer -= dt;
    f.cooldown -= dt;
    // the motor spooks fish close by
    const bd = Math.hypot(f.pos.x - boat.pos.x, f.pos.z - boat.pos.z);
    if (bd < 7 && Math.abs(boat.throttle) > 0.35 && f.state !== 'flee' && f.state !== 'released') this._spook(f, boat.pos);

    if (f.state === 'hold' || f.state === 'cruise') {
      if (lure.active && f.cooldown <= 0) {
        const d = f.pos.distanceTo(lure.pos);
        const aff = sp.lures[lure.type] ?? 0.3;
        const R = 11.5 * lure.vis * (0.6 + aff * 0.6) * (sp.sense || 1);
        if (d < R) {
          const q = lureQuality(lure.type, lure.speed);
          const p = aff * (0.25 + q * 0.75) * f.aggr * 2.3 * dt * (lure.type === 'float' ? 0.9 : 1);
          if (this.rnd() < p) { f.state = 'interested'; f.timer = 3 + this.rnd() * 4; }
        }
      }
      if (f.state === 'hold' && f.timer <= 0) {
        // relocate to a nearby spot
        f.state = 'cruise';
        f.timer = 3 + this.rnd() * 5;
        const z = f.home.z + (this.rnd() - 0.5) * 16;
        const x = f.home.x + (this.rnd() - 0.5) * 16;
        const dep = depthAt(x, z);
        if (dep > 0.5) {
          const y = waterY(x, z) - swimDepth(sp, dep, this.rnd);
          f.home.set(x, y, z);
        }
      } else if (f.state === 'cruise' && f.timer <= 0) {
        f.state = 'hold'; f.timer = 4 + this.rnd() * 10;
      }
    } else if (f.state === 'interested') {
      if (!lure.active) { f.state = 'hold'; f.timer = 2; return; }
      const d = f.pos.distanceTo(lure.pos);
      if (d < 0.45 + f.len * 0.3) {
        const aff = sp.lures[lure.type] ?? 0.3;
        const q = lureQuality(lure.type, lure.speed);
        const chance = Math.min(0.95, aff * q * (0.4 + 0.5 * f.aggr) * 1.35);
        f.decide = (f.decide || 0) - dt;
        if (f.decide <= 0) {
          f.decide = 0.4 + this.rnd() * 0.4;
          if (this.rnd() < chance) {
            if (this.rig && this.rig.onBite(f)) { f.state = 'biting'; f.timer = 2.2; }
          } else if (this.rnd() < 0.35) {
            // follows, then turns away at the boat
            f.state = 'hold'; f.cooldown = 6 + this.rnd() * 8; f.timer = 2;
          }
        }
      }
      if (f.timer <= 0) { f.state = 'hold'; f.cooldown = 5 + this.rnd() * 10; f.timer = 3; }
    } else if (f.state === 'biting') {
      if (f.timer <= 0 && !f.hooked) { f.state = 'hold'; f.cooldown = 8; }
    } else if (f.state === 'flee' || f.state === 'released') {
      if (f.state === 'flee' && f.timer <= 0) {
        f.state = 'cruise'; f.timer = 3;
        f.home.set(f.pos.x + (f.fleeDir?.x || 0) * 10, f.home.y, f.pos.z + (f.fleeDir?.z || 0) * 10);
        const dep = depthAt(f.home.x, f.home.z);
        if (dep < 0.5) f.home.copy(f.pos);
      }
    }
  }

  _move(f, dt) {
    const sp = SPECIES[f.species];
    flowAt(f.pos.x, f.pos.z, _f);
    const desired = _v.set(0, 0, 0);
    let maxSp = 0.6;
    const lure = this.rig?.lureInfo();
    if (f.state === 'hold') {
      // station-keeping: slowly drift back to home, sway
      desired.copy(f.home).sub(f.pos).multiplyScalar(0.6);
      desired.x += Math.sin(performance.now() * 0.0007 + f.id) * 0.1;
      maxSp = 0.5;
    } else if (f.state === 'cruise') {
      desired.copy(f.home).sub(f.pos);
      maxSp = 0.9;
    } else if ((f.state === 'interested' || f.state === 'biting') && lure) {
      // pursuit: aim slightly behind the lure and match its velocity
      const lv = lure.vel || _v2.set(0, 0, 0);
      desired.copy(lure.pos).sub(f.pos);
      const d = desired.length();
      const trail = Math.min(d, 0.25 + f.len * 0.2);
      if (d > 1e-3) desired.multiplyScalar((d - trail * (f.state === 'biting' ? 0 : 1)) / d * 2.2);
      desired.add(lv);
      maxSp = f.state === 'biting' ? sp.speed : sp.speed * 0.75;
    } else if (f.state === 'flee' || f.state === 'released') {
      desired.copy(f.fleeDir || _v2.set(_f.x, 0, _f.z).normalize()).multiplyScalar(10);
      if (f.state === 'released') { desired.y = -1.5; }
      maxSp = sp.speed;
    }
    // desired ground velocity, capped, fish fight the current (so ground velocity = water + own)
    const dl = desired.length();
    if (dl > maxSp) desired.multiplyScalar(maxSp / dl);
    f.vel.lerp(desired, Math.min(1, dt * 2.5));
    f.pos.addScaledVector(f.vel, dt);
    // stay in the water column
    const surf = waterY(f.pos.x, f.pos.z);
    const bed = heightAt(f.pos.x, f.pos.z);
    if (bed > surf - 0.35) {
      // too shallow — push back
      f.pos.addScaledVector(f.vel, -dt * 1.5);
      f.home.copy(f.pos);
    }
    f.pos.y = THREE.MathUtils.clamp(f.pos.y, bed + 0.12, surf - 0.15);
    // swimming effort relative to water
    const rx = f.vel.x - _f.x, rz = f.vel.z - _f.z;
    f.effort = Math.hypot(rx, rz);
    // face into the effort direction (upstream when holding)
    const targetYaw = Math.atan2(rx, rz);
    let dy = targetYaw - f.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const turn = THREE.MathUtils.clamp(dy, -1, 1);
    f.yaw += dy * Math.min(1, dt * (f.state === 'flee' ? 6 : 2.2));
    f.turn += (turn - f.turn) * Math.min(1, dt * 4);
    f.pitch += (THREE.MathUtils.clamp(-f.vel.y * 0.6, -0.5, 0.5) - f.pitch) * Math.min(1, dt * 3);
  }

  _render(f, dt, camPos) {
    const o = f.model.object;
    const d2 = f.pos.distanceToSquared(camPos);
    o.visible = d2 < 70 * 70;
    if (!o.visible) return;
    o.position.copy(f.pos);
    o.rotation.set(f.pitch, f.yaw, 0, 'YXZ');
    const sp = SPECIES[f.species];
    f.model.setSwim(THREE.MathUtils.clamp(f.effort / sp.speed, 0, 1), f.turn);
    f.model.setStruggle(0);
    f.model.update(dt);
    // mouth position for any later use
    f.model.mouth.getWorldPosition(f.mouthPos);
  }

  // Hooked fish: the rig owns physics (f.pos = mouth). Orient body to trail behind the mouth.
  _renderHooked(f, dt) {
    const o = f.model.object;
    o.visible = true;
    let dir = _v.copy(f.fvel);
    if (f.jumping) dir.set(f.fvel.x, f.fvel.y * 0.8, f.fvel.z);
    if (dir.lengthSq() < 0.04) {
      // resting / being dragged: face toward the line pull
      dir.copy(this.rig.tipPos).sub(f.pos);
    }
    dir.normalize();
    const yaw = Math.atan2(dir.x, dir.z);
    const pitch = -Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    let dy = yaw - f.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    f.yaw += dy * Math.min(1, dt * 5);
    f.pitch += (pitch - f.pitch) * Math.min(1, dt * 5);
    // exhausted fish roll onto their side
    const targetRoll = f.stamina < 0.22 ? 1.2 : Math.sin(performance.now() * 0.012) * 0.25 * (f.phase === 'rest' ? 1 : 0.3);
    f.roll += (targetRoll - f.roll) * Math.min(1, dt * 3);
    o.rotation.set(f.pitch, f.yaw, f.roll, 'YXZ');
    // place so the mouth sits exactly on f.pos
    o.position.copy(f.pos);
    o.updateMatrixWorld(true);
    f.model.mouth.getWorldPosition(_v2);
    o.position.add(_v.copy(f.pos).sub(_v2));
    const sp = SPECIES[f.species];
    f.model.setSwim(THREE.MathUtils.clamp((f.fightSpeed || 0) / sp.speed + 0.3, 0, 1), dy * 0.5);
    f.model.setStruggle(f.state === 'hooked' ? (0.35 + 0.65 * (f.stamina ?? 1)) : 0);
    f.model.update(dt);
  }
}
