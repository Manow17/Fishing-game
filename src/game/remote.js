// Other players: their boat, angler, rod, line, lure and any fish they're fighting.
// Boats and anglers are built from the player's look and rebuilt when it changes. Anglers live in
// world space and sit on a seat of their own boat — or of someone else's when they ride along.
import * as THREE from 'three';
import { createRod } from '../models/rod.js';
import { createLure } from '../models/lures.js';
import { createFish } from '../models/fish.js';
import { STAND_HIP_HEIGHT } from '../models/angler.js';
import { solveRodPose } from './fishing.js';
import { ENV } from '../world/env.js';
import { sanitizeLook } from './look.js';
import { buildBoat, disposeBoat, buildAngler, placeAngler } from './rigging.js';

const PALETTE = [0xe8452c, 0x2f7de1, 0xf2c14e, 0x7ad66b, 0xb06ae8, 0xff8a3d, 0x3fd0c0];
export const colorFor = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

const _p = new THREE.Vector3(), _v = new THREE.Vector3();

export class RemotePlayer {
  constructor(scene, id, info, game) {
    this.scene = scene;
    this.game = game;
    this.id = id;
    this.info = info || {};
    this.color = this.info.color ?? colorFor(id);
    this.look = sanitizeLook(this.info.look, this.color);
    this._buildBoat();
    this._buildAngler();
    this.rod = createRod({ accent: this.color });
    scene.add(this.rod.object);
    this.lures = {};
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xd7e36a, transparent: true, opacity: 0.85 }));
    this.line.frustumCulled = false;
    scene.add(this.line);
    this.path = [];
    this.s = null;        // latest state
    this.pos = new THREE.Vector3();
    this.h = 0; this.pitch = 0; this.roll = 0;
    this.vel = new THREE.Vector3();
    this.lp = new THREE.Vector3();
    this.fish = null; this.fishKey = '';
    this.fp = new THREE.Vector3();
  }

  _buildBoat() {
    if (this.boat) disposeBoat(this.boat, this.scene);
    this.boat = buildBoat(this.look.boat, this.look.boat.accent ?? this.color);
    this.scene.add(this.boat.object);
    if (!this.boat.waterMask) this.game?._addWaterMask(this.boat);
    this._boatKey = `${this.look.boat.type}|${this.look.boat.size}`;
  }

  _buildAngler() {
    if (this.angler) this.scene.remove(this.angler.object);
    this.angler = buildAngler(this.look.angler, this.info.name);
    this.scene.add(this.angler.object);
    this.angler.setName?.(this.info.name || 'Angler');
  }

  // a new look from the network: cheap updates in place, rebuild when type/size changed
  applyLook(look) {
    if (!look) return;
    const prev = this.look;
    look = this.look = sanitizeLook(look, this.color);
    if (`${look.boat.type}|${look.boat.size}` !== this._boatKey) this._buildBoat();
    else { this.boat.setPaint?.(look.boat.paint ?? null); this.boat.setAccent?.(look.boat.accent); }
    if (JSON.stringify(prev.angler) !== JSON.stringify(look.angler)) {
      if (this.angler.setOutfit) this.angler.setOutfit({ ...look.angler, name: this.info.name });
      else this._buildAngler();
    }
  }

  setInfo(info) {
    this.info = info;
    this.angler.setName?.(info.name || 'Angler');
    if (info.look && JSON.stringify(info.look) !== JSON.stringify(this.look)) this.applyLook(info.look);
  }

  setState(s) {
    const first = !this.s;
    if (this.s) this.vel.set(s.b[0] - this.s.b[0], 0, s.b[2] - this.s.b[2]).multiplyScalar(10);
    this.s = s;
    if (first) {
      this.pos.set(s.b[0], s.b[1], s.b[2]);
      this.h = s.b[3];
      this.lp.set(...s.r.lp);
    }
    if (s.lk && s.lk !== this._lk) { this._lk = s.lk; try { this.applyLook(JSON.parse(s.lk)); } catch (_) { /* ignore */ } }
  }

  _lure(type) {
    if (!this.lures[type]) {
      const l = createLure(type);
      this.scene.add(l.object);
      if (l.bait) this.scene.add(l.bait);
      this.lures[type] = l;
    }
    for (const t in this.lures) {
      this.lures[t].object.visible = t === type;
      if (this.lures[t].bait) this.lures[t].bait.visible = false;
    }
    return this.lures[type];
  }

  update(dt) {
    const s = this.s;
    if (!s) return;
    const k = Math.min(1, dt * 8);
    this.pos.lerp(_v.set(s.b[0], s.b[1], s.b[2]), k);
    let dh = s.b[3] - this.h;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.h += dh * k;
    this.pitch += (s.b[4] - this.pitch) * k;
    this.roll += (s.b[5] - this.roll) * k;
    const bo = this.boat.object;
    bo.position.copy(this.pos);
    bo.rotation.set(this.pitch, this.h, this.roll, 'YXZ');
    this.boat.setThrottle(s.th);
    this.boat.setSteer(s.sr);
    this.boat.setAnchor(!!s.an);
    this.boat.update(dt, performance.now() / 1000);
    bo.updateMatrixWorld(true);

    const a = this.angler, ao = a.object;
    // on foot: the angler walks around on land
    if (s.m === 'walk' && s.w) {
      if (!this._wp) { this._wp = new THREE.Vector3(s.w[0], s.w[1], s.w[2]); this._wy = s.w[3]; }
      this._wp.lerp(_v.set(s.w[0], s.w[1], s.w[2]), Math.min(1, dt * 10));
      let dy = s.w[3] - this._wy;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this._wy += dy * Math.min(1, dt * 10);
      ao.position.set(this._wp.x, this._wp.y + STAND_HIP_HEIGHT, this._wp.z);
      ao.rotation.set(0, this._wy, 0);
      ao.updateMatrixWorld(true);
      a.setStance('stand');
      a.setWalk(s.w[4], s.w[5]);
      a.setLook(0, 0);
      const sw = Math.sin(s.w[4]) * 0.2 * s.w[5];
      a.setHandTargets(new THREE.Vector3(-0.21, -0.14, 0.08 - sw).applyMatrix4(ao.matrixWorld), new THREE.Vector3(0.21, -0.14, 0.08 + sw).applyMatrix4(ao.matrixWorld));
      this.rod.object.visible = false;
      this.line.visible = false;
      for (const t in this.lures) this.lures[t].object.visible = false;
      a.update(dt);
      this._updateFish(dt, s);
      return;
    }
    this._wp = null;
    a.setStance('sit'); a.setWalk(0, 0);

    // which boat and seat: own boat, or a passenger seat on someone else's
    let platform = this.boat, seat;
    if (s.ride) {
      const host = this.game?.boatOf(s.ride[0]);
      if (host) { platform = host; seat = host.passengerSeats[s.ride[1] % host.passengerSeats.length]; }
    }
    if (!seat) seat = s.m === 'fish' ? this.boat.seats.fisher : this.boat.seats.driver;
    const platformH = platform.object.rotation.y;
    const bodyYaw = s.by || 0;
    placeAngler(a, platform, seat, bodyYaw);
    let rel = s.ay - platformH - bodyYaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    a.setLook(s.m === 'fish' ? rel : THREE.MathUtils.clamp(rel * 0.4, -0.8, 0.8), s.m === 'fish' ? s.ap : 0);

    const fishing = s.m === 'fish';
    this.rod.object.visible = fishing;
    this.line.visible = fishing && s.r.st !== 'idle';
    if (fishing) {
      a.update(0); // refresh the head bone before placing the rod
      const head = a.head.getWorldPosition(_p);
      solveRodPose(this.rod, head, s.ay, s.ap, s.r.rs, s.r.sy, this.rod.object.position, this.rod.object.quaternion);
      this.rod.object.updateMatrixWorld(true);
      const tip = this.rod.tip.getWorldPosition(new THREE.Vector3());
      this.lp.lerp(_v.set(...s.r.lp), Math.min(1, dt * 10));
      const target = s.f ? this.fp : this.lp;
      this.rod.setBend(s.r.bd, target);
      this.rod.setReel({ crank: s.r.cr, bailOpen: !!s.r.bl, drag: 0.5 });
      this.rod.update(dt);
      a.setHandTargets(this.rod.gripRight.getWorldPosition(new THREE.Vector3()), this.rod.gripLeft.getWorldPosition(new THREE.Vector3()));
      const lure = this._lure(s.r.lt);
      lure.object.visible = !s.f;
      lure.object.position.copy(this.lp);
      if (s.r.lt === 'float' && s.r.st === 'water') lure.object.position.y = ENV.surface(this.lp.x, this.lp.z) - 0.03 - s.r.fd;
      else lure.object.lookAt(tip);
      lure.setMotion(s.r.cr);
      lure.update(dt);
      // line: guides + sagging free span
      this.rod.getLinePath(this.path);
      const arr = this.line.geometry.attributes.position.array;
      let n = 0;
      for (const p of this.path) { arr[n++] = p.x; arr[n++] = p.y; arr[n++] = p.z; }
      const end = s.f ? this.fp : lure.object.position;
      const segs = 24;
      const d = tip.distanceTo(end);
      const sag = s.r.st === 'fight' ? d * 0.01 : d * 0.05;
      for (let i = 1; i <= segs && n < arr.length - 3; i++) {
        const t = i / segs;
        _v.lerpVectors(tip, end, t);
        _v.y -= Math.sin(t * Math.PI) * sag;
        arr[n++] = _v.x; arr[n++] = _v.y; arr[n++] = _v.z;
      }
      this.line.geometry.setDrawRange(0, n / 3);
      this.line.geometry.attributes.position.needsUpdate = true;
    } else {
      const helm = platform === this.boat && !s.ride ? this.boat.helm : null;
      a.setHandTargets(helm?.right ? helm.right.getWorldPosition(new THREE.Vector3()) : null, helm?.left ? helm.left.getWorldPosition(new THREE.Vector3()) : null);
      for (const t in this.lures) this.lures[t].object.visible = false;
    }
    a.update(dt);
    this._updateFish(dt, s);
  }

  _updateFish(dt, s) {
    // hooked fish
    const key = s.f ? `${s.f.sp}:${s.f.l}` : '';
    if (key !== this.fishKey) {
      if (this.fish) { this.scene.remove(this.fish.object); this.fish.dispose(); this.fish = null; }
      this.fishKey = key;
      if (s.f) {
        this.fish = createFish(s.f.sp, s.f.l, 7);
        this.scene.add(this.fish.object);
        this.fp.set(...s.f.p);
      }
    }
    if (this.fish && s.f) {
      this.fp.lerp(_v.set(...s.f.p), Math.min(1, dt * 10));
      this.fish.object.position.copy(this.fp);
      this.fish.object.rotation.set(s.f.pi, s.f.y, s.f.ro, 'YXZ');
      this.fish.setSwim(0.8, 0);
      this.fish.setStruggle(0.7);
      this.fish.update(dt);
    }
  }

  dispose() {
    disposeBoat(this.boat, this.scene);
    this.scene.remove(this.rod.object, this.line, this.angler.object);
    for (const t in this.lures) { this.scene.remove(this.lures[t].object); if (this.lures[t].bait) this.scene.remove(this.lures[t].bait); }
    if (this.fish) { this.scene.remove(this.fish.object); this.fish.dispose(); }
  }
}
