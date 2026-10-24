// "Werkstatt": free customisation of your angler and boat, with a live 3D turntable preview.
import * as THREE from 'three';
import { BOAT_TYPES, PAINTS, ACCENTS, ANGLER_OPTIONS, SIZE_RANGE, saveLook } from './look.js';
import { buildBoat, buildAngler, placeAngler } from './rigging.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');
const _t = new THREE.Vector3();

export class Workshop {
  constructor(game) {
    this.game = game;
    this.el = $('workshop');
    this.tab = 'angler';
    // preview stage
    const s = this.scene = new THREE.Scene();
    // soft studio backdrop: misty lake light
    const bg = document.createElement('canvas'); bg.width = 4; bg.height = 256;
    const bx = bg.getContext('2d'), grd = bx.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#9fc3d3'); grd.addColorStop(0.55, '#dfe9e6'); grd.addColorStop(1, '#5d8f97');
    bx.fillStyle = grd; bx.fillRect(0, 0, 4, 256);
    s.background = new THREE.CanvasTexture(bg);
    s.background.colorSpace = THREE.SRGBColorSpace;
    s.environment = game.scene.environment;
    s.environmentIntensity = 0.7;
    const key = new THREE.DirectionalLight(0xfff2de, 2.4); key.position.set(4, 6, 5); s.add(key);
    const rim = new THREE.DirectionalLight(0xbfe6ff, 1.4); rim.position.set(-5, 3, -4); s.add(rim);
    s.add(new THREE.HemisphereLight(0xdfeaff, 0x3a3226, 0.5));
    const water = new THREE.Mesh(new THREE.CircleGeometry(9, 64).rotateX(-Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: 0x2c9aa8, roughness: 0.15, transmission: 0, transparent: true, opacity: 0.55, clearcoat: 1 }));
    water.renderOrder = 2;
    s.add(water);
    this.pivot = new THREE.Group();
    s.add(this.pivot);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
    this.t = 0;
    $('ws-close').onclick = () => this.close();
    this.el.querySelectorAll('[data-ws-tab]').forEach(b => b.onclick = () => { this.tab = b.dataset.wsTab; this.render(); });
  }

  get open() { return !this.el.classList.contains('hidden'); }

  show() {
    this.el.classList.remove('hidden');
    document.body.classList.add('ws-open');
    this.game.input.exitLock();
    this.game.audio.ui?.();
    this._rebuildPreview();
    this.render();
  }

  close() {
    this.el.classList.add('hidden');
    document.body.classList.remove('ws-open');
    this.game.applyLook();
    if (this.game.mode !== 'menu') this.game.input.requestLock();
  }

  // ---------------------------------------------------------------- controls
  render() {
    const look = this.game.look;
    this.el.querySelectorAll('[data-ws-tab]').forEach(b => b.classList.toggle('on', b.dataset.wsTab === this.tab));
    const body = $('ws-body');
    if (this.tab === 'angler') {
      let group = null;
      body.innerHTML = ANGLER_OPTIONS.map((opt) => {
        const cur = look.angler[opt.id] ?? opt.default;
        const off = opt.disabledWhen && Object.entries(opt.disabledWhen).some(([k, vals]) => vals.includes(look.angler[k]));
        const head = opt.group && opt.group !== group ? `<div class="ws-group">${(group = opt.group)}</div>` : '';
        if (opt.type === 'color') {
          const sw = (opt.swatches || opt.presets || []).map(c => {
            const v = typeof c === 'object' ? c.value : c;
            const name = typeof c === 'object' ? c.label : hex(c);
            return `<button class="ws-sw ${v === cur ? 'on' : ''}" style="--c:${hex(v)}" data-opt="${opt.id}" data-val="${v}" title="${name}"></button>`;
          }).join('');
          return `${head}<div class="ws-row ${off ? 'off' : ''}"><span class="ws-lbl">${opt.label}</span><div class="ws-swatches">${sw}<label class="ws-custom" title="Any colour"><input type="color" data-opt="${opt.id}" value="${hex(cur ?? 0x888888)}"></label></div></div>`;
        }
        const ch = (opt.choices || []).map(c => {
          const v = typeof c === 'object' ? c.id ?? c.value : c;
          const l = typeof c === 'object' ? c.label ?? v : c;
          return `<button class="ws-chip ${v === cur ? 'on' : ''}" data-opt="${opt.id}" data-choice="${v}">${l}</button>`;
        }).join('');
        return `${head}<div class="ws-row"><span class="ws-lbl">${opt.label}</span><div class="ws-chips">${ch}</div></div>`;
      }).join('');
    } else {
      const b = look.boat;
      const types = BOAT_TYPES.map(t => `<button class="ws-type ${t.id === b.type ? 'on' : ''}" data-type="${t.id}"><b>${t.name}</b><span>${t.desc}</span></button>`).join('');
      const paints = PAINTS.map(p => `<button class="ws-sw ${p.hex === b.paint ? 'on' : ''} ${p.hex == null ? 'natural' : ''}" style="--c:${p.hex == null ? '#b07a45' : hex(p.hex)}" data-paint="${p.hex ?? 'null'}" title="${p.name}"></button>`).join('');
      const accents = ACCENTS.map(c => `<button class="ws-sw ${c === b.accent ? 'on' : ''}" style="--c:${hex(c)}" data-accent="${c}"></button>`).join('');
      body.innerHTML = `
        <div class="ws-row"><span class="ws-lbl">Type</span><div class="ws-types">${types}</div></div>
        <div class="ws-row"><span class="ws-lbl">Size <em id="ws-size-v">×${(+b.size).toFixed(2)}</em></span>
          <input type="range" id="ws-size" min="${SIZE_RANGE[0]}" max="${SIZE_RANGE[1]}" step="0.05" value="${b.size}"></div>
        <div class="ws-row"><span class="ws-lbl">Hull paint</span><div class="ws-swatches">${paints}<label class="ws-custom" title="Any colour"><input type="color" id="ws-paint-c" value="${hex(b.paint ?? 0xb07a45)}"></label></div></div>
        <div class="ws-row"><span class="ws-lbl">Stripe</span><div class="ws-swatches">${accents}<label class="ws-custom" title="Any colour"><input type="color" id="ws-accent-c" value="${hex(b.accent ?? 0xcf3a2c)}"></label></div></div>
        <div class="ws-note">Bigger boats are heavier and seat their crew further apart; motor upgrades from the Fischerei still apply.</div>`;
    }
    this._wire();
  }

  _wire() {
    const look = this.game.look;
    const body = $('ws-body');
    body.querySelectorAll('[data-opt][data-val]').forEach(el => el.onclick = () => this._set('angler', el.dataset.opt, +el.dataset.val));
    body.querySelectorAll('input[type=color][data-opt]').forEach(el => el.oninput = () => this._set('angler', el.dataset.opt, parseInt(el.value.slice(1), 16), false));
    body.querySelectorAll('[data-choice]').forEach(el => el.onclick = () => {
      const raw = el.dataset.choice;
      const v = raw === 'true' ? true : raw === 'false' ? false : raw;
      this._set('angler', el.dataset.opt, v);
    });
    body.querySelectorAll('[data-type]').forEach(el => el.onclick = () => this._set('boat', 'type', el.dataset.type));
    body.querySelectorAll('[data-paint]').forEach(el => el.onclick = () => this._set('boat', 'paint', el.dataset.paint === 'null' ? null : +el.dataset.paint));
    body.querySelectorAll('[data-accent]').forEach(el => el.onclick = () => this._set('boat', 'accent', +el.dataset.accent));
    const pc = $('ws-paint-c'); if (pc) pc.oninput = () => this._set('boat', 'paint', parseInt(pc.value.slice(1), 16), false);
    const ac = $('ws-accent-c'); if (ac) ac.oninput = () => this._set('boat', 'accent', parseInt(ac.value.slice(1), 16), false);
    const sz = $('ws-size');
    if (sz) sz.oninput = () => {
      look.boat.size = +sz.value;
      $('ws-size-v').textContent = `×${(+sz.value).toFixed(2)}`;
      if (this.boat) this.boat.object.scale.setScalar(look.boat.size);
      this._frame();
      saveLook(look);
    };
  }

  _set(part, key, value, rerender = true) {
    this.game.look[part][key] = value;
    saveLook(this.game.look);
    clearTimeout(this._rb);
    this._rb = setTimeout(() => this._rebuildPreview(part), 60);
    if (rerender) this.render();
  }

  // ---------------------------------------------------------------- preview stage
  _rebuildPreview(part) {
    const look = this.game.look;
    if (!part || part === 'boat' || !this.boat) {
      if (this.boat) { this.pivot.remove(this.boat.object); }
      this.boat = buildBoat(look.boat, 7);
      this.boat.object.position.set(0, 0, 0);
      this.pivot.add(this.boat.object);
    }
    if (part === 'angler' && this.angler?.setOutfit) this.angler.setOutfit({ ...look.angler });
    else if (!part || part === 'angler' || !this.angler) {
      if (this.angler) { this.scene.remove(this.angler.object); this.angler.dispose?.(); }
      this.angler = buildAngler(look.angler, '');
      this.angler.setName?.('');
      // world space, like in game: placeAngler already includes the turntable rotation
      this.scene.add(this.angler.object);
    }
    this._frame();
  }

  _frame() {
    const b = this.boat;
    if (!b) return;
    const L = (b.phys?.halfLength * 2 || b.length || 7.5) * (this.game.look.boat.size || 1);
    this.camDist = L * 1.4 + 3;
    // aim at the middle of everything (T-tops and rod racks included)
    b.object.updateMatrixWorld(true);
    this.boatMidY = Math.max(0.6, new THREE.Box3().setFromObject(b.object).getCenter(_t).y - this.pivot.position.y);
  }

  // called every frame by the game while open; draws into the left part of the screen
  draw(renderer, dt) {
    if (!this.open || !this.boat) return;
    this.t += dt;
    this.pivot.rotation.y = this.t * 0.25;
    this.boat.update?.(dt, this.t);
    this.boat.object.updateMatrixWorld(true);
    placeAngler(this.angler, this.boat, this.boat.seats.driver, 0);
    this.angler.setLook(Math.sin(this.t * 0.6) * 0.5, 0.05);
    const hr = this.boat.helm?.right;
    this.angler.setHandTargets(hr ? hr.getWorldPosition(new THREE.Vector3()) : null, this.boat.helm?.left ? this.boat.helm.left.getWorldPosition(new THREE.Vector3()) : null);
    this.angler.update(dt);
    const w = innerWidth, h = innerHeight;
    const panel = this.el.querySelector('.ws-panel');
    const right = panel ? panel.getBoundingClientRect().left : w * 0.55;
    const vw = Math.max(200, Math.round(right - 8)), vh = h;
    if (w < 760) return; // narrow screens: controls only
    const cam = this.camera;
    cam.aspect = vw / vh; cam.updateProjectionMatrix();
    // angler tab: close-up on the character; boat tab: the whole hull
    const close = this.tab === 'angler';
    const want = close ? _t.copy(this.angler.object.position).setY(this.angler.object.position.y + 0.2) : _t.set(0, this.boatMidY ?? 0.6, 0);
    const k = this._camK === undefined ? 1 : 1 - Math.exp(-dt * 5);
    this._camK = 1;
    this.camTarget = (this.camTarget || want.clone()).lerp(want, k);
    this.camD = THREE.MathUtils.lerp(this.camD ?? this.camDist, close ? 4.6 : (this.camDist || 10), k);
    const d = this.camD;
    cam.position.set(this.camTarget.x + d * 0.72, this.camTarget.y + d * 0.36, this.camTarget.z + d * 0.72);
    cam.lookAt(this.camTarget);
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    const pr = renderer.getPixelRatio();
    renderer.setScissor(0, 0, vw, vh);
    renderer.setViewport(0, 0, vw, vh);
    renderer.clearDepth();
    renderer.render(this.scene, cam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.autoClear = true;
    void pr;
  }
}
