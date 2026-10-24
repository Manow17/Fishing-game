// Other players: their boat, angler, rod, line, lure and any fish they're fighting.
import * as THREE from 'three';
import { createBoat } from '../models/boat.js';
import { createAngler } from '../models/angler.js';
import { createRod } from '../models/rod.js';
import { createLure } from '../models/lures.js';
import { createFish } from '../models/fish.js';
import { solveRodPose } from './fishing.js';
import { waterY } from '../world/river.js';
import { STAND_HIP_HEIGHT } from '../models/angler.js';

const PALETTE = [0xe8452c, 0x2f7de1, 0xf2c14e, 0x7ad66b, 0xb06ae8, 0xff8a3d, 0x3fd0c0];
export const colorFor = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _v = new THREE.Vector3();

export class RemotePlayer {
  constructor(scene, id, info, game) {
    this.scene = scene;
    this.id = id;
    this.info = info || {};
    this.color = this.info.color ?? colorFor(id);
    this.boat = createBoat({ accent: this.color });
    scene.add(this.boat.object);
    if (!this.boat.waterMask) game?._addWaterMask(this.boat);
    this.angler = createAngler({ vest: this.color, name: this.info.name || 'Angler' });
    this.boat.object.add(this.angler.object);
    this.angler.setName?.(this.info.name || 'Angler');
    this.rod = createRod({ accent: this.color });
    scene.add(this.rod.object);
    this.lures = {};
    this.lureType = null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xd7e36a, transparent: true, opacity: 0.85 }));
    this.line.frustumCulled = false;
    scene.add(this.line);
    this.path = [];
    this.s = null;        // latest state
    this.pos = new THREE.Vector3();
    this.h = 0; this.pitch = 0; this.roll = 0;
    this.lp = new THREE.Vector3();
    this.fish = null; this.fishKey = '';
    this.fp = new THREE.Vector3();
  }

  setState(s) {
    const first = !this.s;
    this.s = s;
    if (first) {
      this.pos.set(s.b[0], s.b[1], s.b[2]);
      this.h = s.b[3];
      this.lp.set(...s.r.lp);
    }
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

    // hull paint from their motor upgrade
    if (s.pt !== this._pt) { this._pt = s.pt; this.boat.setPaint?.(s.pt == null || s.pt < 0 ? null : s.pt); }

    // on foot: the angler leaves the boat and walks
    const ao = this.angler.object;
    if (s.m === 'walk' && s.w) {
      if (ao.parent !== this.scene) { this.scene.add(ao); this._wp = new THREE.Vector3(s.w[0], s.w[1], s.w[2]); this._wy = s.w[3]; }
      this._wp.lerp(_v.set(s.w[0], s.w[1], s.w[2]), Math.min(1, dt * 10));
      let dy = s.w[3] - this._wy;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this._wy += dy * Math.min(1, dt * 10);
      ao.position.set(this._wp.x, this._wp.y + STAND_HIP_HEIGHT, this._wp.z);
      ao.rotation.set(0, this._wy, 0);
      ao.updateMatrixWorld(true);
      this.angler.setStance('stand');
      this.angler.setWalk(s.w[4], s.w[5]);
      this.angler.setLook(0, 0);
      const sw = Math.sin(s.w[4]) * 0.2 * s.w[5];
      this.angler.setHandTargets(new THREE.Vector3(-0.21, -0.14, 0.08 - sw).applyMatrix4(ao.matrixWorld), new THREE.Vector3(0.21, -0.14, 0.08 + sw).applyMatrix4(ao.matrixWorld));
      this.rod.object.visible = false;
      this.line.visible = false;
      for (const t in this.lures) this.lures[t].object.visible = false;
      this.angler.update(dt);
      bo.updateMatrixWorld(true);
      this._updateFish(dt, s);
      return;
    }
    if (ao.parent !== bo) { bo.add(ao); this.angler.setStance('sit'); this.angler.setWalk(0, 0); }

    // seat + look
    const seat = s.m === 'fish' ? this.boat.seats.fisher : this.boat.seats.driver;
    ao.position.copy(seat);
    ao.rotation.set(0, 0, 0);
    const relYaw = s.ay - this.h;
    this.angler.setLook(relYaw, s.ap);
    bo.updateMatrixWorld(true);

    const fishing = s.m === 'fish';
    this.rod.object.visible = fishing;
    this.line.visible = fishing && s.r.st !== 'idle';
    if (fishing) {
      const head = this.angler.head.getWorldPosition(_p);
      solveRodPose(this.rod, head, s.ay, s.ap, s.r.rs, s.r.sy, this.rod.object.position, this.rod.object.quaternion);
      this.rod.object.updateMatrixWorld(true);
      const tip = this.rod.tip.getWorldPosition(new THREE.Vector3());
      this.lp.lerp(_v.set(...s.r.lp), Math.min(1, dt * 10));
      const target = s.f ? this.fp : this.lp;
      this.rod.setBend(s.r.bd, target);
      this.rod.setReel({ crank: s.r.cr, bailOpen: !!s.r.bl, drag: 0.5 });
      this.rod.update(dt);
      const gl = this.rod.gripLeft.getWorldPosition(new THREE.Vector3());
      const gr = this.rod.gripRight.getWorldPosition(new THREE.Vector3());
      this.angler.setHandTargets(gr, gl);
      // lure
      const lure = this._lure(s.r.lt);
      lure.object.visible = !s.f;
      lure.object.position.copy(this.lp);
      if (s.r.lt === 'float' && s.r.st === 'water') lure.object.position.y = waterY(this.lp.z) - 0.03 - s.r.fd;
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
      this.angler.setHandTargets(this.boat.tillerGrip.getWorldPosition(new THREE.Vector3()), null);
      for (const t in this.lures) this.lures[t].object.visible = false;
    }
    this.angler.update(dt);
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
    this.scene.remove(this.boat.object, this.rod.object, this.line);
    if (this.angler.object.parent === this.scene) this.scene.remove(this.angler.object);
    for (const t in this.lures) { this.scene.remove(this.lures[t].object); if (this.lures[t].bait) this.scene.remove(this.lures[t].bait); }
    if (this.fish) { this.scene.remove(this.fish.object); this.fish.dispose(); }
  }
}
