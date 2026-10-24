// The fishing rig: rod pose, casting, lure & line physics, bites, the fight and landing.
import * as THREE from 'three';
import { createRod } from '../models/rod.js';
import { createLure, LURE_TYPES } from '../models/lures.js';
import { ENV } from '../world/env.js';

// everything about the water comes from the active map (river, ocean, …)
const surfAt = (x, z) => ENV.surface(x, z);          // includes waves
const heightAt = (x, z) => ENV.groundY(x, z);
const flowAt = (x, z, out) => ENV.flowAt(x, z, out);
import { SPECIES } from './species.js';

const G = 9.81;
const UP = new THREE.Vector3(0, 1, 0);
const _f = {};
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

const LURE_PHYS = {
  spinner: { sink: 0.55, lift: 0.4, vis: 1.25, mass: 0.008 },
  spoon: { sink: 0.85, lift: 0.5, vis: 1.15, mass: 0.012 },
  minnow: { sink: -0.18, lift: -0.55, vis: 1.0, mass: 0.009, dive: 1.4 },
  float: { sink: 0, lift: 0, vis: 0.75, mass: 0.015 },
};

// drag setting 1..10 -> kg, scaled to the map's tackle (light river spinning gear vs. big-game ocean gear)
export const DRAG_KG = (d) => (0.06 + (d - 1) / 9 * 0.94) * ENV.tackle.dragMaxKg;
export const LINE_BREAK_KG = 7.2;
const MAX_LINE_DEFAULT = 180;
const maxLine = () => ENV.tackle.spoolM ?? MAX_LINE_DEFAULT;

// Rod placement shared by local + remote players.
// Returns the rod object's world position/quaternion for a hand position and aim.
export function solveRodPose(rod, head, yaw, pitch, raise, sideYaw, outPos, outQuat) {
  const fwd = _v.set(Math.sin(yaw), 0, Math.cos(yaw));
  const right = _v2.set(-Math.cos(yaw), 0, Math.sin(yaw));
  const hand = outPos.copy(head).addScaledVector(fwd, 0.5).addScaledVector(right, 0.23).addScaledVector(UP, -0.27);
  const ry = yaw + sideYaw;
  const el = THREE.MathUtils.clamp(pitch * 0.45 + raise, -0.3, 1.9);
  const dir = _v3.set(Math.sin(ry) * Math.cos(el), Math.sin(el), Math.cos(ry) * Math.cos(el)).normalize();
  const x = new THREE.Vector3().crossVectors(UP, dir);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(dir, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, dir);
  outQuat.setFromRotationMatrix(m);
  const grip = rod.gripRight.position.clone().applyQuaternion(outQuat);
  outPos.sub(grip);
  return outPos;
}

class Rope {
  constructor(n) {
    this.n = n;
    this.p = Array.from({ length: n }, () => new THREE.Vector3());
    this.o = Array.from({ length: n }, () => new THREE.Vector3());
  }
  reset(a, b) {
    for (let i = 0; i < this.n; i++) { this.p[i].lerpVectors(a, b, i / (this.n - 1)); this.o[i].copy(this.p[i]); }
  }
  step(dt, a, b, length) {
    const n = this.n;
    const D = a.distanceTo(b);
    if (length <= D * 1.004) {
      // taut: a straight line with a whisper of sag (the solver can't converge on a tight line)
      const sag = Math.min(0.15, D * 0.004);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        this.p[i].lerpVectors(a, b, t);
        this.p[i].y -= Math.sin(t * Math.PI) * sag;
        this.o[i].copy(this.p[i]);
      }
      return;
    }
    const seg = length / (n - 1);
    for (let i = 1; i < n - 1; i++) {
      const p = this.p[i], o = this.o[i];
      const vx = (p.x - o.x), vy = (p.y - o.y), vz = (p.z - o.z);
      o.copy(p);
      const surf = surfAt(p.x, p.z);
      if (p.y < surf) {
        flowAt(p.x, p.z, _f);
        // water drag pulls line toward the current, slight sink
        p.x += vx * 0.8 + (_f.x * dt - vx) * 0.25;
        p.z += vz * 0.8 + (_f.z * dt - vz) * 0.25;
        p.y += vy * 0.7 - 0.25 * dt * dt * 20;
      } else {
        p.x += vx * 0.985; p.z += vz * 0.985;
        p.y += vy * 0.985 - G * dt * dt;
      }
    }
    this.p[0].copy(a); this.p[n - 1].copy(b);
    for (let it = 0; it < 16; it++) {
      for (let i = 0; i < n - 1; i++) {
        const p1 = this.p[i], p2 = this.p[i + 1];
        const dx = p2.x - p1.x, dy = p2.y - p1.y, dz = p2.z - p1.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        if (d <= seg) continue; // rope only resists stretching
        const diff = (d - seg) / d;
        const w1 = i === 0 ? 0 : 0.5, w2 = i + 1 === n - 1 ? 0 : 0.5;
        const s = w1 + w2 || 1;
        p1.x += dx * diff * (w1 / s); p1.y += dy * diff * (w1 / s); p1.z += dz * diff * (w1 / s);
        p2.x -= dx * diff * (w2 / s); p2.y -= dy * diff * (w2 / s); p2.z -= dz * diff * (w2 / s);
      }
      for (let i = 1; i < n - 1; i++) {
        const p = this.p[i];
        const bed = heightAt(p.x, p.z) + 0.03;
        if (p.y < bed) p.y = bed;
      }
    }
  }
}

export class FishingRig {
  constructor(scene, audio, hooks) {
    this.scene = scene;
    this.audio = audio;
    this.hooks = hooks; // { notify(msg, big), onCatch(fish), onLost(reason), spawnSplash(pos, size), fishManager }
    this.rod = createRod({ accent: 0xb3262b });
    scene.add(this.rod.object);
    this.lures = {};
    for (const t of LURE_TYPES) {
      const l = createLure(t);
      l.object.visible = false;
      scene.add(l.object);
      if (l.bait) { l.bait.visible = false; scene.add(l.bait); }
      this.lures[t] = l;
    }
    this.lureType = 'spinner';
    this.lures.spinner.object.visible = true;

    // line geometry: reel/guide path + free line + float leader
    this.maxPts = 96;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.maxPts * 3), 3));
    this.lineGeo = lg;
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xd7e36a, transparent: true, opacity: 0.9 }));
    this.line.frustumCulled = false;
    scene.add(this.line);
    this.leaderGeo = new THREE.BufferGeometry();
    this.leaderGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.leader = new THREE.Line(this.leaderGeo, new THREE.LineBasicMaterial({ color: 0xdfe8e0, transparent: true, opacity: 0.6 }));
    this.leader.frustumCulled = false;
    scene.add(this.leader);
    this.rope = new Rope(34);
    this.pathPts = [];

    this.state = 'idle';
    this.lineBreakKg = ENV.tackle.lineBreakKg; // braided line upgrade raises this
    this.lurePos = new THREE.Vector3();
    this.lureVel = new THREE.Vector3();
    this.baitPos = new THREE.Vector3();
    this.lineOut = 0.5;
    this.tension = 0;          // newtons
    this.drag = 5;             // 1..10
    this.crank = 0;            // rev/s
    this.bail = false;
    this.power = 0;
    this.raise = 0.55;         // rod elevation offset
    this.raiseTarget = 0.55;
    this.sideYaw = 0;
    this.castT = 0;
    this.bite = null;
    this.fish = null;          // hooked fish agent
    this.slip = 0;             // line slipping speed m/s
    this.slackTime = 0;
    this.overTime = 0;
    this.speedThroughWater = 0;
    this.inWater = false;
    this.snagged = false;
    this.lureSince = 0;
    this.tipPos = new THREE.Vector3();
    this.rodPos = new THREE.Vector3();
    this.rodQuat = new THREE.Quaternion();
    this.bendAmount = 0;
    this.twitch = 0;
    this.floatDip = 0;
    this.lastSplash = null;
    this.visible = true;
    this.landing = null;
  }

  setVisible(v) {
    this.visible = v;
    this.rod.object.visible = v;
    this.line.visible = v;
    this.leader.visible = v && this.lureType === 'float' && this.state !== 'idle';
    for (const t of LURE_TYPES) {
      this.lures[t].object.visible = v && t === this.lureType;
      if (this.lures[t].bait) this.lures[t].bait.visible = v && t === this.lureType && this.state !== 'idle';
    }
  }

  get lure() { return this.lures[this.lureType]; }

  selectLure(type) {
    if (this.state !== 'idle' || type === this.lureType) return false;
    this.lureType = type;
    this.setVisible(this.visible);
    return true;
  }

  // Info consumed by fish AI.
  lureInfo() {
    const active = this.inWater && !this.fish && !this.snagged && this.state === 'water';
    return {
      active,
      type: this.lureType,
      pos: this.lureType === 'float' ? this.baitPos : this.lurePos,
      vel: this.lureVel,
      speed: this.speedThroughWater,
      reeling: this.crank > 0.1,
      since: this.lureSince,
      vis: LURE_PHYS[this.lureType].vis,
    };
  }

  // Called by FishManager when a fish takes the lure.
  onBite(fish) {
    if (this.state !== 'water' || this.bite || this.fish) return false;
    const float = this.lureType === 'float';
    this.bite = { fish, t: 0, window: float ? 1.7 : 0.75, struck: false, float };
    this.twitch = float ? 0.15 : 0.9;
    this.audio?.bite(float);
    this.hooks.notify(float ? 'The float dips…' : 'Strike!', false);
    return true;
  }

  // ------------------------------------------------------------------ update
  update(dt, ctx) {
    // ctx: { head, yaw, pitch, input: { castHeld, castDown, castUp, reel, strike, strikeHeld, feather, sideL, sideR, net, fastReel, wheel }, boatVel, active, netPos }
    const inp = ctx.input;
    if (inp.wheel) this.drag = THREE.MathUtils.clamp(this.drag - inp.wheel, 1, 10);
    const dragN = DRAG_KG(this.drag) * G;
    const breakN = this.lineBreakKg * G;

    // ---- rod raise / side pressure targets
    let raiseT = 0.42;
    if (this.state === 'fight') raiseT = inp.strikeHeld ? 1.05 : 0.5;
    if (this.state === 'water' && inp.strikeHeld) raiseT = 0.9;
    let sideT = 0;
    if (this.state === 'fight') sideT = (inp.sideR ? -0.85 : 0) + (inp.sideL ? 0.85 : 0);
    this.sideYaw += (sideT - this.sideYaw) * Math.min(1, dt * 3);

    // ---- casting animation drives raise directly
    if (this.state === 'charging') {
      this.power = Math.min(1.05, this.power + dt / 1.15);
      raiseT = 0.55 + this.power * 0.5;
      this.audio?.charge(this.power);
      if (inp.castUp || !inp.castHeld) this._beginCast(ctx);
    } else if (this.state === 'casting') {
      this.castT += dt;
      const wind = 0.16, fwd = 0.14;
      if (this.castT < wind) raiseT = THREE.MathUtils.lerp(1.0, 1.85, this.castT / wind);
      else raiseT = THREE.MathUtils.lerp(1.85, 0.12, Math.min(1, (this.castT - wind) / fwd));
      this.raise = raiseT; // no smoothing during the stroke
      if (this.castT >= wind + fwd * 0.55 && !this.released) this._release(ctx);
      if (this.castT > wind + fwd + 0.05) this.state = 'flight';
    }
    if (this.state !== 'casting') this.raise += (raiseT - this.raise) * Math.min(1, dt * (this.state === 'fight' ? 3 : 6));

    // ---- place the rod in the angler's hands
    solveRodPose(this.rod, ctx.head, ctx.yaw, ctx.pitch, this.raise, this.sideYaw, this.rodPos, this.rodQuat);
    this.rod.object.position.copy(this.rodPos);
    this.rod.object.quaternion.copy(this.rodQuat);
    this.rod.object.updateMatrixWorld(true);
    this.rod.tip.getWorldPosition(this.tipPos);
    const tip = this.tipPos;

    // ---- crank input
    let crankT = 0;
    if (inp.reel && (this.state === 'water' || this.state === 'fight' || this.state === 'land' || this.state === 'flight')) crankT = inp.fastReel ? 2.4 : 1.5;
    this.crank += (crankT - this.crank) * Math.min(1, dt * 8);
    if (this.crank > 0.2 && this.bail) { this.bail = false; this.audio?.bail(); if (this.state === 'flight') this._landStop(); }
    const retrieve = Math.max(0, this.crank) * 0.82; // m/s of line

    // ---- per-state physics
    this.slip = 0;
    if (this.state === 'idle' || this.state === 'charging') {
      this.lineOut = 0.45;
      this._dangle(dt, tip);
      this.inWater = false;
      if (inp.castDown && ctx.active) { this.state = 'charging'; this.power = 0; }
    } else if (this.state === 'casting') {
      if (this.released) this._flight(dt, tip, inp, 0);
      else this._dangle(dt, tip);
    } else if (this.state === 'flight') {
      this._flight(dt, tip, inp, retrieve);
    } else if (this.state === 'water' || this.state === 'land') {
      this._retrieve(dt, tip, retrieve, inp, dragN, breakN);
    } else if (this.state === 'fight') {
      this._fight(dt, tip, retrieve, inp, dragN, breakN, ctx);
    } else if (this.state === 'landing') {
      this._landingAnim(dt, ctx);
    }

    // ---- bite window
    if (this.bite) this._updateBite(dt, inp);

    // ---- rod bend + reel visuals
    let bendT = 0;
    if (this.state === 'fight') bendT = Math.min(1.3, this.tension / (breakN * 0.55));
    else if (this.state === 'water') bendT = Math.min(0.35, this.tension / 25);
    if (this.state === 'casting') bendT = this.castT < 0.16 ? 0.25 : 0.55;
    this.twitch = Math.max(0, this.twitch - dt * 3);
    this.bendAmount += (bendT + this.twitch * 0.35 * Math.sin(performance.now() * 0.06) - this.bendAmount) * Math.min(1, dt * 10);
    const bendTarget = this.fish ? this.fish.mouthPos : (this.state === 'idle' || this.state === 'charging' ? _v.copy(tip).add(new THREE.Vector3(0, -1, 0)) : this.lurePos);
    this.rod.setBend(Math.max(0, this.bendAmount), bendTarget);
    this.rod.setReel({ crank: this.slip > 0.05 ? -this.slip * 1.2 : this.crank, bailOpen: this.bail, drag: (this.drag - 1) / 9 });
    this.rod.setSpoolLine(1 - Math.min(1, this.lineOut / maxLine()) * 0.6);
    this.rod.update(dt);
    this.rod.tip.getWorldPosition(this.tipPos);

    this.audio?.reel(this.crank, this.slip, this.tension / breakN);
    this._updateLureObjects(dt);
    this._drawLine(dt);
  }

  // ------------------------------------------------------------------ states
  _dangle(dt, tip) {
    // pendulum below the tip
    const p = this.lurePos;
    if (p.distanceToSquared(tip) > 4) p.copy(tip).y -= 0.45;
    this.lureVel.y -= G * dt;
    this.lureVel.multiplyScalar(Math.pow(0.1, dt));
    p.addScaledVector(this.lureVel, dt);
    const d = p.distanceTo(tip);
    if (d > this.lineOut) {
      const prev = _v3.copy(p);
      p.sub(tip).multiplyScalar(this.lineOut / d).add(tip);
      this.lureVel.addScaledVector(prev.sub(p), -1 / Math.max(dt, 1e-3) * 0.5);
    }
    this.baitPos.copy(p);
  }

  _beginCast() {
    this.state = 'casting';
    this.castT = 0;
    this.released = false;
    this.bail = true;
    this.audio?.bail();
  }

  _release(ctx) {
    this.released = true;
    let p = Math.min(this.power, 1);
    const over = Math.max(0, this.power - 0.92);
    const speed = 7 + p * 25;
    const err = over * 2.5 + (1 - Math.min(1, p / 0.8)) * 0.03;
    const yaw = ctx.yaw + (Math.random() - 0.5) * err;
    const el = THREE.MathUtils.clamp(0.42 + ctx.pitch * 0.6 + (Math.random() - 0.5) * err, 0.05, 1.1);
    this.lurePos.copy(this.tipPos);
    this.lureVel.set(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el)).multiplyScalar(speed);
    if (ctx.boatVel) this.lureVel.add(ctx.boatVel);
    this.lineOut = 0.6;
    this.feathered = false;
    this.rope.reset(this.tipPos, this.lurePos);
    this.audio?.whoosh(p);
    if (over > 0.02) this.hooks.notify('Over-powered cast — accuracy suffers', false);
  }

  _landStop() {
    // closing the bail mid-air stops the line: lure drops
    this.feathered = true;
  }

  _flight(dt, tip, inp, retrieve) {
    if (inp.feather) this.feathered = true;
    if (this.feathered && retrieve > 0) {
      // line stopped: reeling lifts a dangling lure back to the rod
      this.lineOut = Math.max(0.45, this.lineOut - retrieve * dt);
      if (this.lineOut < 1.0) { this._toIdle(); return; }
    }
    const v = this.lureVel;
    const sp = v.length();
    const dragK = this.feathered ? 2.2 : 0.035;
    v.addScaledVector(v, -dragK * sp * dt * (this.feathered ? 0.5 : 1));
    v.y -= G * dt;
    this.lurePos.addScaledVector(v, dt);
    const d = this.lurePos.distanceTo(tip);
    if (!this.feathered) this.lineOut = Math.min(maxLine(), Math.max(this.lineOut, d));
    else if (d > this.lineOut) {
      this.lurePos.sub(tip).multiplyScalar(this.lineOut / d).add(tip);
      // remove the outward velocity component (taut line)
      const rdir = _v2.copy(this.lurePos).sub(tip).normalize();
      const out = v.dot(rdir);
      if (out > 0) v.addScaledVector(rdir, -out);
    }
    this.audio?.lineOut(this.feathered ? 0 : sp);
    const x = this.lurePos.x, z = this.lurePos.z;
    const surf = surfAt(x, z);
    const ground = heightAt(x, z);
    if (this.lurePos.y <= Math.max(surf, ground)) {
      if (ground < surf - 0.05) {
        this.lurePos.y = surf - 0.02;
        this.state = 'water';
        this.inWater = true;
        this.lureSince = 0;
        this.lureVel.set(v.x * 0.1, -0.3, v.z * 0.1);
        this.hooks.spawnSplash?.(this.lurePos, 0.35);
        this.audio?.splash(0.25);
        this.lastSplash = this.lurePos.clone();
        this.hooks.fishManager?.onSplash(this.lurePos, 0.3);
        if (this.lureType === 'float') {
          this.baitPos.copy(this.lurePos);
        }
      } else {
        this.lurePos.y = ground + 0.03;
        this.state = 'land';
        this.inWater = false;
        this.lureVel.set(0, 0, 0);
        this.hooks.notify('Landed on the bank — reel it back', false);
      }
      this.bail = false;
      this.lineOut = Math.max(this.lureVel.length() > 0 ? this.lineOut : this.lineOut, this.lurePos.distanceTo(tip));
    }
  }

  _retrieve(dt, tip, retrieve, inp, dragN, breakN) {
    const phys = LURE_PHYS[this.lureType];
    const p = this.lurePos, v = this.lureVel;
    this.lureSince += dt;
    if (!this.snagged) this.lineOut = Math.max(0.3, this.lineOut - retrieve * dt);
    const old = _v3.copy(p);
    const surf = surfAt(p.x, p.z);
    const bed = heightAt(p.x, p.z);
    if (this.state === 'land') {
      // drag across the ground toward the tip
      const d = p.distanceTo(tip);
      if (d > this.lineOut) {
        const dir = _v.copy(tip).sub(p); dir.y = 0; dir.normalize();
        p.addScaledVector(dir, Math.min(d - this.lineOut, retrieve * dt + 0.001));
      }
      p.y = heightAt(p.x, p.z) + 0.03;
      if (p.y < surf - 0.05) { this.state = 'water'; this.inWater = true; this.lureSince = 0; }
      this.tension = d > this.lineOut ? 6 : 0;
      if (this.lineOut < 1.2) this._toIdle();
      return;
    }
    flowAt(p.x, p.z, _f);
    const depth = surf - p.y;
    const fScale = this.lureType === 'float' ? 1 : Math.max(0.55, 1 - depth * 0.08);
    if (this.snagged) {
      v.set(0, 0, 0);
    } else if (this.lureType === 'float') {
      // bobber rides the surface with the current
      v.x += (_f.x - v.x) * Math.min(1, dt * 1.5);
      v.z += (_f.z - v.z) * Math.min(1, dt * 1.5);
      v.y = 0;
      p.addScaledVector(v, dt);
      p.y = surf;
    } else {
      const k = Math.min(1, dt * 2.2);
      v.x += (_f.x * fScale - v.x) * k;
      v.z += (_f.z * fScale - v.z) * k;
      const swt = this.speedThroughWater;
      let vyT = -phys.sink + phys.lift * swt; // retrieving lifts spinners and spoons
      if (this.lureType === 'minnow') {
        const target = Math.min(phys.dive, swt * 1.1);
        vyT = (depth < target ? -0.5 : 0.1) * Math.min(1, swt) + (swt < 0.15 ? 0.18 : 0);
      }
      v.y += (vyT - v.y) * Math.min(1, dt * 3);
      p.addScaledVector(v, dt);
    }
    // the line constrains the lure: reeling drags it toward the tip
    const d = p.distanceTo(tip);
    let taut = false;
    if (d > this.lineOut) {
      taut = true;
      const target = _v.copy(p).sub(tip).multiplyScalar(this.lineOut / d).add(tip);
      if (this.lureType === 'float') target.y = surf;
      p.copy(target);
    }
    // keep inside water column
    const surfNow = surfAt(p.x, p.z);
    const bedNow = heightAt(p.x, p.z);
    if (this.lureType !== 'float') {
      if (p.y > surfNow - 0.04) { p.y = surfNow - 0.04; v.y = Math.min(v.y, 0); }
      if (p.y < bedNow + 0.06) {
        p.y = bedNow + 0.06; v.y = Math.max(0, v.y);
        // bottom contact while moving can snag
        const hb = ENV.habitat(p.x, p.z, ENV.depth(p.x, p.z));
        const rocky = hb.rock ?? hb.reef ?? 0;
        if (!this.snagged && this.lureSince > 2 && this.lineOut > 4 && this.speedThroughWater > 0.15 && Math.random() < dt * (0.04 + rocky * 0.2)) {
          this.snagged = true;
          this.snagPull = 0;
          this.hooks.notify('Snagged on the bottom! Jerk the rod (right mouse) to free it', true);
          this.audio?.snag();
        }
      }
    }
    // actual velocity -> speed through water (drives blades/wobble and fish interest)
    const vel = _v2.copy(p).sub(old).divideScalar(Math.max(dt, 1e-4));
    if (!this.snagged) v.copy(vel);
    this.speedThroughWater = Math.hypot(vel.x - _f.x * fScale, vel.y, vel.z - _f.z * fScale);
    if (this.lureType === 'float') {
      this.speedThroughWater = Math.hypot(vel.x - _f.x, vel.z - _f.z);
      const local = Math.max(0.2, surfNow - bedNow);
      const bd = Math.min(1.5, local - 0.2);
      this.baitPos.set(p.x + _f.x * 0.08, surfNow - bd, p.z + _f.z * 0.08);
    }
    // tension from drag in the current / snag pull
    if (this.snagged) {
      const stretch = Math.max(0, tip.distanceTo(p) - this.lineOut);
      this.lineOut -= retrieve * dt;
      this.tension = Math.min(breakN * 1.2, stretch * 60 + Math.max(0, tip.distanceTo(p) - this.lineOut) * 60);
      if (this.tension > dragN) { this.slip = 0.3; this.lineOut = tip.distanceTo(p) - dragN / 60; this.tension = dragN; }
      if (this.tension > breakN) { this._breakLine('The line snapped on the snag. Tied on a fresh lure.'); return; }
      // keep cranking against the snag long enough and you pull for a break
      this.snagPull = retrieve > 0.1 ? this.snagPull + dt : Math.max(0, this.snagPull - dt);
      if (this.snagPull > 3) { this._breakLine('You pulled for a break and tied on a fresh lure.'); return; }
      if (tip.distanceTo(p) < 3.5) { this.snagged = false; this.hooks.notify('Unhooked it from the snag by hand', false); }
      if (inp.strike) {
        if (Math.random() < 0.4) { this.snagged = false; this.hooks.notify('Freed!', false); }
        else this.twitch = 1;
      }
    } else {
      // a sharp rod jerk twitches the lure forward
      if (inp.strike && this.lureType !== 'float') {
        const toTip = _v.copy(tip).sub(p).normalize();
        this.lureVel.addScaledVector(toTip, 1.6);
        this.lineOut = Math.max(0.3, this.lineOut - 0.35);
        this.twitch = 0.6;
      }
      const drag = 0.4 + this.speedThroughWater * this.speedThroughWater * (this.lureType === 'spoon' ? 3 : 2);
      this.tension += ((taut ? drag : 0) - this.tension) * Math.min(1, dt * 6);
    }
    if (this.lineOut < 1.3 && !this.bite) this._toIdle();
  }

  _toIdle() {
    this.state = 'idle';
    this.inWater = false;
    this.snagged = false;
    this.bite = null;
    this.lineOut = 0.45;
    this.tension = 0;
    this.leader.visible = false;
    if (this.lure.bait) this.lure.bait.visible = false;
  }

  _breakLine(msg) {
    this.hooks.notify(msg, true);
    this.audio?.snap();
    if (this.fish) { this.hooks.onLost(this.fish, 'break'); this.fish = null; }
    this._toIdle();
    this.lurePos.copy(this.tipPos);
  }

  _updateBite(dt, inp) {
    const b = this.bite;
    b.t += dt;
    if (b.float) this.floatDip = 0.25 + 0.15 * Math.sin(b.t * 18);
    if (inp.strike && !b.struck) {
      b.struck = true;
      const timing = b.t / b.window;
      const chance = b.float ? (timing < 0.12 ? 0.35 : 0.93) : 0.9;
      if (Math.random() < chance) return this._hook(b.fish, 0.75 + Math.random() * 0.25);
      this._miss(b.fish, b.float ? 'Struck too early — missed!' : 'Missed the strike!');
      return;
    }
    if (b.t > b.window) {
      // self-hooking on aggressive takes while reeling
      const auto = !b.float && this.crank > 0.5 ? 0.45 : b.float ? 0.12 : 0.15;
      if (Math.random() < auto) return this._hook(b.fish, 0.55 + Math.random() * 0.2);
      this._miss(b.fish, b.float ? 'The fish dropped the bait…' : 'It let go!');
    }
  }

  _miss(fish, msg) {
    this.bite = null;
    this.floatDip = 0;
    this.hooks.notify(msg, false);
    this.hooks.fishManager?.onMissed(fish);
  }

  _hook(fish, hold) {
    this.bite = null;
    this.floatDip = 0;
    this.fish = fish;
    this.hold = hold;
    this.state = 'fight';
    this.slackTime = 0;
    this.overTime = 0;
    this.fightT = 0;
    fish.hooked = true;
    fish.state = 'hooked';
    fish.stamina = 1;
    fish.phase = 'run';
    fish.phaseT = 0.6 + Math.random();
    fish.runDir = new THREE.Vector3();
    this._pickRun(fish);
    fish.fvel = fish.fvel || new THREE.Vector3();
    fish.fvel.set(0, 0, 0);
    this.twitch = 1;
    this.audio?.hookSet();
    this.hooks.notify(`Fish on! ${this._sizeHint(fish)}`, true);
  }

  _sizeHint(f) {
    const s = SPECIES[f.species];
    const t = (f.len - s.len[0]) / (s.len[1] - s.len[0]);
    if (f.weight > 5) return 'It feels HUGE!';
    if (t > 0.7) return 'Heavy one!';
    if (t < 0.25) return 'Feels small.';
    return '';
  }

  _pickRun(fish) {
    const s = SPECIES[fish.species];
    const away = _v.copy(fish.pos).sub(this.tipPos); away.y = 0; away.normalize();
    flowAt(fish.pos.x, fish.pos.z, _f);
    const down = _v2.set(_f.x, 0, _f.z).normalize();
    const side = new THREE.Vector3(-away.z, 0, away.x).multiplyScalar(Math.random() < 0.5 ? -1 : 1);
    const r = Math.random();
    fish.runDir.set(0, 0, 0);
    if (r < 0.45) fish.runDir.addScaledVector(away, 1).addScaledVector(side, 0.4);
    else if (r < 0.75) fish.runDir.addScaledVector(down, 1).addScaledVector(away, 0.4);
    else if (r < 0.92) fish.runDir.addScaledVector(side, 1).addScaledVector(away, 0.2);
    else fish.runDir.addScaledVector(away, -0.7).addScaledVector(side, 0.7); // toward the boat → slack!
    fish.runDir.normalize();
    fish.dive = Math.random() < 0.5 ? 0.85 : 0.35;
    fish.jumpReady = Math.random() < s.jumpy * 0.5;
  }

  _fight(dt, tip, retrieve, inp, dragN, breakN, ctx) {
    const fish = this.fish;
    const s = SPECIES[fish.species];
    const m = fish.weight + 0.3;
    // giants (sharks, billfish, big tuna) out-pull the drag, sulk instead of resting and tire slowly
    const heft = Math.max(1, Math.sqrt(fish.weight / 40));
    this.fightT += dt;
    fish.phaseT -= dt;
    if (fish.phaseT <= 0 && !fish.jumping) {
      if (fish.phase === 'run') { fish.phase = 'rest'; fish.phaseT = 0.8 + Math.random() * 2.2 * (1.2 - fish.stamina); }
      else { fish.phase = 'run'; fish.phaseT = (1.5 + Math.random() * 3.5) * (0.4 + fish.stamina * 0.8) * Math.sqrt(heft); this._pickRun(fish); }
    }
    const surf = surfAt(fish.pos.x, fish.pos.z);
    const bed = heightAt(fish.pos.x, fish.pos.z);
    const Fmax = Math.min(G * 1.6 * Math.pow(fish.weight, 0.75) * Math.sqrt(s.power), dragN * (1.25 + 0.15 * (heft - 1)) + 8) * (0.25 + 0.75 * fish.stamina) + 2;
    const sub = 4, h = dt / sub;
    let T = 0;
    for (let i = 0; i < sub; i++) {
      const F = _v.set(0, 0, 0);
      flowAt(fish.pos.x, fish.pos.z, _f);
      if (fish.jumping) {
        fish.fvel.y -= G * h;
        fish.pos.addScaledVector(fish.fvel, h);
        if (fish.pos.y < surfAt(fish.pos.x, fish.pos.z) - 0.1 && fish.fvel.y < 0) {
          fish.jumping = false;
          this.hooks.spawnSplash?.(fish.pos, 0.5 + fish.len);
          this.audio?.splash(0.5 + fish.weight * 0.1);
          fish.fvel.multiplyScalar(0.3);
        }
      } else {
        if (fish.phase === 'run') {
          F.addScaledVector(fish.runDir, Fmax);
          // dive/surface
          const localDepth = Math.max(0.3, surf - bed);
          const ty = surf - localDepth * fish.dive;
          F.y += THREE.MathUtils.clamp((ty - fish.pos.y) * 6, -1, 1) * Fmax * 0.4;
          if (fish.jumpReady && fish.pos.y > surf - 1.2 && fish.stamina > 0.25 && Math.random() < h * 0.6) {
            fish.jumping = true; fish.jumpReady = false;
            fish.fvel.set(fish.fvel.x * 0.6, 3.2 + Math.random() * 1.6, fish.fvel.z * 0.6);
            this.hooks.spawnSplash?.(fish.pos, 0.6 + fish.len);
            this.audio?.splash(0.6);
            this.hooks.notify(`${s.name} jumps!`, false);
            if (this.tension < 3 && Math.random() < 0.35 * (1.1 - this.hold)) { this._lose('It threw the hook on the jump!'); return; }
          }
        } else {
          // resting: hold against the current, head shakes
          F.set(-_f.x, 0, -_f.z).multiplyScalar(m * 0.9);
          if (heft > 1) F.addScaledVector(fish.runDir, Fmax * 0.45 * (1 - 1 / heft) * fish.stamina);
          F.x += Math.sin(this.fightT * 9) * Fmax * 0.12;
          if (fish.stamina < 0.2) F.y += (surf - 0.25 - fish.pos.y) * 20; // exhausted fish come up
        }
        // water drag relative to current
        const rvx = fish.fvel.x - _f.x, rvy = fish.fvel.y, rvz = fish.fvel.z - _f.z;
        const rs = Math.hypot(rvx, rvy, rvz);
        const c = 1.3 * Math.pow(fish.weight, 0.66);
        F.x -= c * rvx * rs + rvx * 2; F.y -= c * rvy * rs + rvy * 2; F.z -= c * rvz * rs + rvz * 2;
        // line force
        const mouth = fish.pos;
        const D = mouth.distanceTo(tip);
        const Keff = 1 / (1 / 75 + this.lineOut / 420);
        T = Math.max(0, D - this.lineOut) * Keff;
        if (T > 0) {
          const dir = _v2.copy(tip).sub(mouth).normalize();
          F.addScaledVector(dir, T);
        }
        fish.fvel.addScaledVector(F, h / m);
        fish.pos.addScaledVector(fish.fvel, h);
        const sN = surfAt(fish.pos.x, fish.pos.z), bN = heightAt(fish.pos.x, fish.pos.z);
        if (fish.pos.y > sN - 0.08) { fish.pos.y = sN - 0.08; fish.fvel.y = Math.min(0, fish.fvel.y); }
        if (fish.pos.y < bN + 0.15) { fish.pos.y = bN + 0.15; fish.fvel.y = Math.max(0, fish.fvel.y); }
        // rocks
        for (const r of ENV.obstacles) {
          const dx = fish.pos.x - r.x, dz = fish.pos.z - r.z;
          const dd = Math.hypot(dx, dz);
          if (dd < r.r) { fish.pos.x = r.x + dx / dd * r.r; fish.pos.z = r.z + dz / dd * r.r; }
        }
      }
      // reel + drag
      const KeffR = 1 / (1 / 75 + this.lineOut / 420);
      const Dn = fish.pos.distanceTo(tip);
      if (T < dragN * 0.97) this.lineOut = Math.max(0.5, this.lineOut - retrieve * h);
      T = Math.max(0, Dn - this.lineOut) * KeffR;
      if (T > dragN) {
        const newL = Dn - dragN / KeffR;
        this.slip = Math.max(this.slip, (newL - this.lineOut) / h);
        this.lineOut = newL;
        T = dragN;
      }
    }
    this.tension = T;
    // stamina drain: tension work + side pressure bonus
    const fdir = _v.set(fish.fvel.x, 0, fish.fvel.z);
    const fs = fdir.length();
    const pull = _v2.copy(tip).sub(fish.pos); pull.y = 0; pull.normalize();
    // rod swung sideways pulls the fish off-balance
    const rodSide = Math.abs(this.sideYaw);
    let side = 1 + rodSide * 0.9;
    if (fs > 0.3) side += Math.max(0, -fdir.normalize().dot(pull)) * 0.4 * rodSide;
    const drain = (T * 0.006 * side + (fish.phase === 'run' ? Fmax * 0.003 : 0)) / (Math.pow(fish.weight, 0.62) * s.power + 0.15) * 1.25 / Math.pow(heft, 0.6);
    fish.stamina = THREE.MathUtils.clamp(fish.stamina - drain * dt + (T < 2 ? 0.025 * dt : 0), 0, 1);
    // slack line -> hook can come loose
    if (T < 1.0) this.slackTime += dt; else this.slackTime = Math.max(0, this.slackTime - dt * 2);
    if (this.slackTime > 2.2 && Math.random() < dt * 0.35 * (1.1 - this.hold)) { this._lose('Slack line — the hook pulled free!'); return; }
    if (T > breakN) { this._breakLine(`SNAP! The ${s.name.toLowerCase()} broke the line.`); return; }
    if (T > breakN * 0.9) this.overTime += dt; else this.overTime = 0;
    if (this.overTime > 1.2) { this._breakLine('The line gave way under strain!'); return; }
    if (this.lineOut >= maxLine()) { this._breakLine('Spooled! The fish took all your line.'); return; }

    fish.mouthPos.copy(fish.pos);
    fish.fightSpeed = fs;
    // landing check
    const nd = _v.copy(fish.pos).sub(ctx.netPos); nd.y = 0;
    this.canNet = nd.length() < 4.2 && fish.pos.y > surf - 1.3;
    if (this.canNet && inp.net) {
      if (fish.stamina < 0.3 || Math.random() < 0.25 / (heft * heft)) this._startLanding(ctx);
      else {
        this.hooks.notify('Too lively — tire it out first!', false);
        fish.phase = 'run'; fish.phaseT = 1.5; this._pickRun(fish);
        fish.stamina = Math.min(1, fish.stamina + 0.05);
      }
    }
  }

  _lose(msg) {
    this.hooks.notify(msg, true);
    if (this.fish) {
      this.lurePos.copy(this.fish.pos);
      this.lurePos.y = Math.min(this.lurePos.y, surfAt(this.lurePos.x, this.lurePos.z) - 0.1);
      this.lureVel.set(0, 0, 0);
      this.hooks.onLost(this.fish, 'unhooked');
      this.fish = null;
    }
    this.state = 'water';
    this.inWater = true;
    this.tension = 0;
  }

  _startLanding(ctx) {
    this.state = 'landing';
    this.landing = { t: 0, from: this.fish.pos.clone() };
    this.canNet = false;
    this.audio?.splash(0.4);
    this.hooks.onNetStart?.(this.fish);
  }

  _landingAnim(dt, ctx) {
    const L = this.landing;
    L.t += dt;
    const fish = this.fish;
    if (!fish) { this._toIdle(); return; }
    const k = Math.min(1, L.t / 1.1);
    const to = _v.copy(ctx.netPos); to.y += 0.6;
    fish.pos.lerpVectors(L.from, to, k * k * (3 - 2 * k));
    fish.pos.y += Math.sin(k * Math.PI) * 0.5;
    fish.mouthPos.copy(fish.pos);
    this.lineOut = Math.max(0.6, fish.pos.distanceTo(this.tipPos));
    this.tension = 2;
    if (L.t > 1.2) {
      const f = this.fish;
      this.fish = null;
      this._toIdle();
      this.hooks.onCatch(f);
    }
  }

  // ------------------------------------------------------------------ visuals
  _updateLureObjects(dt) {
    const L = this.lure;
    const o = L.object;
    o.visible = this.visible && !(this.fish && this.state !== 'idle' && false);
    if (this.fish) {
      // lure rides in the fish's mouth
      o.position.copy(this.fish.mouthPos);
      o.lookAt(this.tipPos);
    } else if (this.lureType === 'float') {
      o.position.copy(this.lurePos);
      if (this.state === 'water') {
        const t = performance.now() * 0.001;
        o.position.y = surfAt(this.lurePos.x, this.lurePos.z) - 0.03 - this.floatDip + Math.sin(t * 3 + this.lurePos.x) * 0.012;
        o.rotation.set(Math.sin(t * 2.1) * 0.08, 0, Math.cos(t * 1.7) * 0.08 + this.floatDip * 0.6);
      } else {
        o.rotation.set(0, 0, 0);
      }
    } else {
      o.position.copy(this.lurePos);
      const dir = _v.copy(this.lureVel);
      if (this.state === 'water' && dir.lengthSq() > 0.0004) o.lookAt(_v2.copy(this.lurePos).sub(dir));
      else o.lookAt(this.tipPos);
    }
    L.setMotion(this.state === 'flight' ? 0.4 : this.fish ? 2.5 : this.speedThroughWater);
    L.update(dt);
    if (L.bait) {
      const show = this.visible && this.lureType === 'float' && (this.state === 'water' || this.state === 'fight' || this.state === 'landing');
      L.bait.visible = show && !this.fish;
      if (show) {
        L.bait.position.copy(this.baitPos);
        L.bait.rotation.set(0, performance.now() * 0.0005, 0);
      }
      this.leader.visible = show && !this.fish;
      if (this.leader.visible) {
        const a = this.leaderGeo.attributes.position.array;
        a[0] = o.position.x; a[1] = o.position.y; a[2] = o.position.z;
        a[3] = this.baitPos.x; a[4] = this.baitPos.y; a[5] = this.baitPos.z;
        this.leaderGeo.attributes.position.needsUpdate = true;
      }
    }
  }

  _drawLine(dt) {
    if (!this.visible) return;
    const path = this.pathPts;
    this.rod.getLinePath(path);
    const end = this.fish ? this.fish.mouthPos : (this.lureType === 'float' ? this.lure.object.position : this.lurePos);
    const D = end.distanceTo(this.tipPos);
    const ropeLen = Math.max(D, this.lineOut);
    if (this._lastState !== this.state && (this.state === 'flight' || this.state === 'idle')) this.rope.reset(this.tipPos, end);
    this.rope.step(dt, this.tipPos, end, ropeLen);
    this._lastState = this.state;
    const arr = this.lineGeo.attributes.position.array;
    let k = 0;
    for (const p of path) { if (k / 3 >= this.maxPts - 1) break; arr[k++] = p.x; arr[k++] = p.y; arr[k++] = p.z; }
    for (let i = 1; i < this.rope.n; i++) {
      if (k / 3 >= this.maxPts) break;
      const p = this.rope.p[i];
      arr[k++] = p.x; arr[k++] = p.y; arr[k++] = p.z;
    }
    this.lineGeo.setDrawRange(0, k / 3);
    this.lineGeo.attributes.position.needsUpdate = true;
  }

  // Snapshot for the network.
  netState() {
    return {
      st: this.state,
      lt: this.lureType,
      lp: [+this.lurePos.x.toFixed(2), +this.lurePos.y.toFixed(2), +this.lurePos.z.toFixed(2)],
      rs: +this.raise.toFixed(3),
      sy: +this.sideYaw.toFixed(3),
      bd: +this.bendAmount.toFixed(3),
      cr: +this.crank.toFixed(2),
      bl: this.bail ? 1 : 0,
      fd: +this.floatDip.toFixed(2),
    };
  }
}
