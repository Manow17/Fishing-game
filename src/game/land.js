// On-land play: walking around the village, the Fischerei stall, the wallet and boat upgrades.
import * as THREE from 'three';
import { sampleHeight as heightAt } from '../world/terrain.js';
import { waterY } from '../world/river.js';
import { SPAWN_Z, VILLAGE_SIDE, bankX } from '../world/layout.js';
import { createShop } from '../models/shop.js';
import { STAND_HIP_HEIGHT } from '../models/angler.js';
import { SPECIES } from './species.js';

export const MOTORS = [
  { name: 'Stock 15 hp', mult: 1.0, price: 0, paint: null, paintName: 'Varnished larch' },
  { name: 'Tuned 15 hp', mult: 1.25, price: 150, paint: 0x2f6b46, paintName: 'Alpine green' },
  { name: '25 hp Aare Sprinter', mult: 1.55, price: 450, paint: 0xb3202a, paintName: 'Swiss red' },
  { name: '40 hp Gletscher', mult: 1.9, price: 1100, paint: 0x2b5d9e, paintName: 'Glacier blue' },
  { name: '60 hp Edelweiss', mult: 2.35, price: 2600, paint: 0x1d2433, paintName: 'Midnight blue' },
];
export const BRAID = { name: 'Braided line', price: 300, breakKg: 10.5 };

// What the Fischerei pays for a fish (CHF)
export function fishPrice(f) {
  const s = SPECIES[f.species];
  return Math.max(2, Math.round(s.value * 1.6 * (0.6 + f.weight)));
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _g = new THREE.Vector3();
const _camT = new THREE.Vector3(), _camW = new THREE.Vector3();

export class Land {
  constructor(game) {
    this.game = game;
    const L = game.world.layout;
    // docks: {x, y, z, yaw} shore end, deck top y, extends along local +Z
    this.docks = L.docks;
    this.dock = L.docks[0];
    // collision circles: buildings, cows, shop bodies
    this.colliders = [];
    for (const c of L.chalets) this.colliders.push({ x: c.x, z: c.z, r: 6.2 });
    for (const b of L.barns) this.colliders.push({ x: b.x, z: b.z, r: 4.2 });
    if (L.church) this.colliders.push({ x: L.church.x, z: L.church.z, r: 8.5 });
    for (const c of L.cows) this.colliders.push({ x: c.x, z: c.z, r: 1.2 });
    // a Fischerei stall on the gravel bank next to each dock, facing the water
    this.shops = L.shops.map((spot) => {
      const shop = createShop();
      const { x: sx, z: sz } = spot;
      const sy = Math.min(heightAt(sx, sz), heightAt(sx + 1.5, sz + 1.5), heightAt(sx - 1.5, sz - 1.5));
      shop.object.position.set(sx, sy, sz);
      shop.object.rotation.y = spot.yaw;
      game.scene.add(shop.object);
      shop.object.updateMatrixWorld(true);
      shop.frontWorld = shop.front.clone().applyMatrix4(shop.object.matrixWorld);
      const back = new THREE.Vector3(0, 0, -0.3).applyMatrix4(shop.object.matrixWorld);
      this.colliders.push({ x: back.x, z: back.z, r: 1.6 });
      return shop;
    });
    this.shop = this.shops[0];
    this.shopFront = this.shop.frontWorld;
    this.trees = game.world.forest.trees;

    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.vel = new THREE.Vector3();
    this.phase = 0;
    this.walkAmt = 0;
    this.camYaw = 0; this.camPitch = 0.3;
    this.stepAcc = 0;

    const saved = JSON.parse(localStorage.getItem('af-wallet') || 'null') || {};
    this._money = saved.money || 0;
    this.infinite = false; // set by the hidden cheat
    this.motor = saved.motor || 0;
    this.braid = !!saved.braid;
    this.crate = JSON.parse(localStorage.getItem('af-crate') || '[]');
    this._bindShopUI();
  }

  get money() { return this.infinite ? Infinity : this._money; }
  set money(v) { if (!this.infinite) this._money = v; }

  save() {
    localStorage.setItem('af-wallet', JSON.stringify({ money: this._money, motor: this.motor, braid: this.braid }));
    localStorage.setItem('af-crate', JSON.stringify(this.crate));
  }

  get paint() { return MOTORS[this.motor].paint; }
  get thrustMult() { return MOTORS[this.motor].mult; }

  // ------------------------------------------------------------------ ground / walkability
  // the dock under (x, z), or null
  dockAt(x, z) {
    for (const d of this.docks) {
      const dx = x - d.x, dz = z - d.z;
      if (dx * dx + dz * dz > 400) continue;
      const s = Math.sin(d.yaw), c = Math.cos(d.yaw);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (lz > -1.1 && lz < 14 && Math.abs(lx) < 1.2) return d;
    }
    return null;
  }
  onDock(x, z) { return !!this.dockAt(x, z); }
  groundY(x, z) {
    const d = this.dockAt(x, z);
    if (d) return d.y;
    for (const shop of this.shops) {
      const so = shop.object;
      if (Math.abs(x - so.position.x) > 4 || Math.abs(z - so.position.z) > 4) continue;
      const lp = _g.set(x, 0, z).sub(so.position).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -so.rotation.y);
      if (Math.abs(lp.x) < 1.8 && Math.abs(lp.z) < 1.3) return Math.max(heightAt(x, z), so.position.y + 0.16);
    }
    return heightAt(x, z);
  }
  walkable(x, z) {
    if (this.onDock(x, z)) return true;
    return heightAt(x, z) > waterY(z) - 0.25;
  }
  surface(x, z) {
    if (this.onDock(x, z)) return 'wood';
    return heightAt(x, z) - waterY(z) < 1.6 ? 'gravel' : 'grass';
  }

  // Landing spot next to the boat (dock deck or dry bank), or null.
  findLanding(phys) {
    const fx = Math.sin(phys.h), fz = Math.cos(phys.h);
    const rx = Math.cos(phys.h), rz = -Math.sin(phys.h);
    let best = null, bestD = 1e9;
    for (const side of [-1, 1]) for (const off of [-2.2, -1, 0, 1, 2.2]) for (const reach of [1.3, 2.0, 2.8]) {
      const x = phys.x + rx * side * reach + fx * off, z = phys.z + rz * side * reach + fz * off;
      if (!this.walkable(x, z)) continue;
      if (!this.onDock(x, z) && heightAt(x, z) < waterY(z) - 0.05) continue;
      const d = reach + Math.abs(off) * 0.3;
      if (d < bestD) { bestD = d; best = new THREE.Vector3(x, this.groundY(x, z), z); }
    }
    return best;
  }

  enter(spot, faceYaw) {
    this.pos.copy(spot);
    this.yaw = faceYaw;
    this.camYaw = faceYaw;
    this.camPitch = 0.28;
    this.vel.set(0, 0, 0);
  }

  // ------------------------------------------------------------------ walking
  update(dt, input, look) {
    const g = this.game;
    if (look) {
      this.camYaw -= input.mouse.dx * 0.0022;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + input.mouse.dy * 0.0022, -0.35, 1.1);
    }
    let mx = 0, mz = 0;
    if (look || input.locked) {
      if (input.down('KeyW')) mz += 1;
      if (input.down('KeyS')) mz -= 1;
      if (input.down('KeyA')) mx += 1;
      if (input.down('KeyD')) mx -= 1;
    }
    const run = input.down('ShiftLeft') || input.down('ShiftRight');
    const speed = run ? 4.2 : 1.7;
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const want = _v.set(fx * mz + fz * mx, 0, fz * mz - fx * mx);
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(speed);
    this.vel.lerp(want, Math.min(1, dt * 10));
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    if (this.walkable(nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
    else if (this.walkable(nx, this.pos.z)) this.pos.x = nx;
    else if (this.walkable(this.pos.x, nz)) this.pos.z = nz;
    this._collide();
    const gy = this.groundY(this.pos.x, this.pos.z);
    this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 14);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.2) {
      let d = Math.atan2(this.vel.x, this.vel.z) - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 10);
    }
    // gait: ~1.9 strides/s walking, faster when running
    this.walkAmt += (Math.min(1, sp / 1.7) - this.walkAmt) * Math.min(1, dt * 8);
    const prev = this.phase;
    this.phase += dt * (sp < 0.1 ? 0 : 2.2 * Math.PI * (run ? 1.55 : 0.95));
    // footstep on each half-cycle
    if (sp > 0.3 && Math.floor(prev / Math.PI) !== Math.floor(this.phase / Math.PI)) g.audio.footstep?.(this.surface(this.pos.x, this.pos.z));
    this._poseAngler(dt);
  }

  _collide() {
    const p = this.pos;
    for (const c of this.colliders) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < c.r * c.r && d2 > 1e-6) { const d = Math.sqrt(d2); p.x = c.x + dx / d * c.r; p.z = c.z + dz / d * c.r; }
    }
    for (const t of this.trees) {
      const dx = p.x - t.x, dz = p.z - t.z;
      if (dx > 1 || dx < -1 || dz > 1 || dz < -1) continue;
      const d2 = dx * dx + dz * dz, r = 0.45;
      if (d2 < r * r && d2 > 1e-6) { const d = Math.sqrt(d2); p.x = t.x + dx / d * r; p.z = t.z + dz / d * r; }
    }
  }

  _poseAngler(dt) {
    const a = this.game.angler;
    const o = a.object;
    if (o.parent !== this.game.scene) this.game.scene.add(o);
    o.position.set(this.pos.x, this.pos.y + STAND_HIP_HEIGHT + Math.abs(Math.sin(this.phase)) * 0.03 * this.walkAmt, this.pos.z);
    o.rotation.set(0, this.yaw, 0);
    o.updateMatrixWorld(true);
    a.setStance('stand');
    a.setWalk(this.phase, this.walkAmt);
    a.setFirstPerson?.(false);
    let rel = this.camYaw - this.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    a.setLook(THREE.MathUtils.clamp(rel, -1.2, 1.2) * (1 - this.walkAmt * 0.7), -this.camPitch * 0.4);
    // arms swing opposite to the legs
    const sw = Math.sin(this.phase) * 0.2 * this.walkAmt;
    const r = _v.set(-0.21, -0.14, 0.08 - sw).applyMatrix4(o.matrixWorld);
    const l = _v2.set(0.21, -0.14, 0.08 + sw).applyMatrix4(o.matrixWorld);
    a.setHandTargets(r, l);
  }

  camera(cam, dt) {
    const target = _camT.set(this.pos.x, this.pos.y + 1.55, this.pos.z);
    const dist = 4.2;
    const want = _camW.set(
      target.x - Math.sin(this.camYaw) * Math.cos(this.camPitch) * dist,
      target.y + Math.sin(this.camPitch) * dist,
      target.z - Math.cos(this.camYaw) * Math.cos(this.camPitch) * dist);
    const gy = Math.max(this.groundY(want.x, want.z), waterY(want.z)) + 0.35;
    if (want.y < gy) want.y = gy;
    cam.position.lerp(want, Math.min(1, dt * 12));
    cam.lookAt(target);
    if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
  }

  nearShop() { return this.shops.some(s => Math.hypot(this.pos.x - s.frontWorld.x, this.pos.z - s.frontWorld.z) < 2.6); }

  // ------------------------------------------------------------------ economy + shop UI
  addCatch(f) {
    this.crate.push({ species: f.species, len: +f.len.toFixed(3), weight: +f.weight.toFixed(3), seed: f.seed || 0 });
    this.save();
  }

  _bindShopUI() {
    const $ = (id) => document.getElementById(id);
    $('shop-close').onclick = () => this.closeShop();
    $('shop-sell').onclick = () => this.sellAll();
    this.el = $('shop');
  }

  get shopOpen() { return !this.el.classList.contains('hidden'); }

  openShop() {
    this.el.classList.remove('hidden');
    this.game.input.exitLock();
    this.game.audio.shopBell?.();
    this.render();
  }
  closeShop() {
    this.el.classList.add('hidden');
    this.game.input.requestLock();
  }

  sellAll() {
    if (!this.crate.length) return;
    const total = this.crate.reduce((s, f) => s + fishPrice(f), 0);
    this.money += total;
    const n = this.crate.length;
    this.crate = [];
    this.game.clearCrateModels();
    this.save();
    this.game.audio.coins?.();
    this.game.hud.notify(`Sold ${n} fish for CHF ${total}`, true);
    this.render();
  }

  buyMotor(i) {
    const m = MOTORS[i];
    if (i <= this.motor || (i !== this.motor + 1 && !this.infinite) || this.money < m.price) return;
    this.money -= m.price;
    this.motor = i;
    this.save();
    this.game.applyUpgrades();
    this.game.audio.purchase?.();
    this.game.hud.notify(`${m.name} fitted — boat painted ${m.paintName}!`, true);
    this.render();
  }

  buyBraid() {
    if (this.braid || this.money < BRAID.price) return;
    this.money -= BRAID.price;
    this.braid = true;
    this.save();
    this.game.applyUpgrades();
    this.game.audio.purchase?.();
    this.game.hud.notify('Braided line spooled on — breaks at 10.5 kg now', true);
    this.render();
  }

  render() {
    const $ = (id) => document.getElementById(id);
    $('shop-money').textContent = this.infinite ? 'CHF ∞' : `CHF ${this.money.toLocaleString('de-CH')}`;
    const list = $('shop-catch');
    if (!this.crate.length) list.innerHTML = '<div class="sh-empty">Your crate is empty. Keep a fish (K) after landing it to sell it here.</div>';
    else {
      list.innerHTML = this.crate.map(f => {
        const s = SPECIES[f.species];
        return `<div class="sh-fish"><span>${s.name}</span><span class="dim">${Math.round(f.len * 100)} cm · ${f.weight >= 1 ? f.weight.toFixed(2) + ' kg' : Math.round(f.weight * 1000) + ' g'}</span><b>CHF ${fishPrice(f)}</b></div>`;
      }).join('');
    }
    const total = this.crate.reduce((s, f) => s + fishPrice(f), 0);
    $('shop-sell').textContent = this.crate.length ? `Sell all · CHF ${total}` : 'Nothing to sell';
    $('shop-sell').disabled = !this.crate.length;
    const ups = $('shop-upgrades');
    const rows = MOTORS.map((m, i) => {
      const owned = i <= this.motor;
      const next = i === this.motor + 1;
      const sw = m.paint == null ? 'linear-gradient(135deg,#c89a62,#8a5a2b)' : '#' + m.paint.toString(16).padStart(6, '0');
      const btn = owned ? `<button disabled>${i === this.motor ? 'Fitted' : 'Owned'}</button>`
        : (next || this.infinite) ? `<button class="primary" data-motor="${i}" ${this.money < m.price ? 'disabled' : ''}>Buy · CHF ${m.price}</button>`
          : `<button disabled>Locked</button>`;
      return `<div class="sh-up ${owned ? 'owned' : ''}"><span class="sw" style="background:${sw}"></span>
        <div class="sh-txt"><b>${m.name}</b><span class="dim">${Math.round((m.mult - 1) * 100) > 0 ? '+' + Math.round((m.mult - 1) * 100) + '% thrust · ' : ''}${m.paintName} hull</span></div>${btn}</div>`;
    });
    rows.push(`<div class="sh-up ${this.braid ? 'owned' : ''}"><span class="sw" style="background:linear-gradient(135deg,#d7e36a,#7a8a2a)"></span>
      <div class="sh-txt"><b>${BRAID.name}</b><span class="dim">Breaking strain 7.2 → ${BRAID.breakKg} kg</span></div>
      ${this.braid ? '<button disabled>Owned</button>' : `<button class="primary" data-braid="1" ${this.money < BRAID.price ? 'disabled' : ''}>Buy · CHF ${BRAID.price}</button>`}</div>`);
    ups.innerHTML = rows.join('');
    ups.querySelectorAll('[data-motor]').forEach(b => b.onclick = () => this.buyMotor(+b.dataset.motor));
    ups.querySelectorAll('[data-braid]').forEach(b => b.onclick = () => this.buyBraid());
  }

  updateShop(dt) {
    // only animate shopkeepers that are reasonably close
    const c = this.game.camera.position;
    for (const s of this.shops) if (Math.abs(s.object.position.z - c.z) < 250) s.update(dt);
  }
}
