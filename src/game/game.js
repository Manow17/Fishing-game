// Orchestrates player, boat, fishing, fish, camera, HUD, audio and multiplayer.
import * as THREE from 'three';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { Effects } from './effects.js';
import { BoatPhysics } from './boatPhysics.js';
import { FishingRig } from './fishing.js';
import { FishManager } from './fishAI.js';
import { SPECIES, pointsFor } from './species.js';
import { RemotePlayer, colorFor } from './remote.js';
import { Network } from '../net/network.js';
import { createBoat, createLandingNet } from '../models/boat.js';
import { createAngler } from '../models/angler.js';
import { createFish } from '../models/fish.js';
import { LURE_TYPES } from '../models/lures.js';
import { centerX, waterY, flowAt, rapids, PLAY_Z } from '../world/river.js';
import { SPAWN_Z, VILLAGE_SIDE, bankX } from '../world/layout.js';
import { Land, BRAID } from './land.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _f = {};
const $ = (id) => document.getElementById(id);

export class Game {
  constructor({ renderer, scene, camera, world, post }) {
    Object.assign(this, { renderer, scene, camera, world, post });
    this.mode = 'menu';           // menu | drive | fish | walk
    this.camTP = false;           // third person while fishing
    this.camYaw = 0; this.camPitch = 0.25; this.camDist = 10;
    this.aimRel = 0; this.aimPitch = -0.05;
    this.remotes = new Map();
    this.netTimer = 0;
    this.time = 0;
    this.crateFish = [];
    this.pendingCatch = null;
  }

  async init() {
    this.input = new Input(this.renderer.domElement);
    this.audio = new Audio();
    this.hud = new Hud();
    this.effects = new Effects(this.scene, this.world.water);

    // spawn beside the end of the village dock
    const dockEndX = bankX(SPAWN_Z, VILLAGE_SIDE, 1.5) - VILLAGE_SIDE * 16;
    this.phys = new BoatPhysics(dockEndX, SPAWN_Z, Math.PI);
    this.phys.setAnchor(true);
    // dock pilings are obstacles for the boat
    for (const d of this.world.layout.docks) for (let i = 0; i <= 7; i++) {
      this.phys.obstacles.push({ x: d.x + Math.sin(d.yaw) * i * 2, z: d.z + Math.cos(d.yaw) * i * 2, r: 1.1 });
    }

    this.name = localStorage.getItem('af-name') || '';
    this.color = Number(localStorage.getItem('af-color')) || [0xe8452c, 0x2f7de1, 0xf2c14e, 0x7ad66b, 0xb06ae8][(Math.random() * 5) | 0];
    localStorage.setItem('af-color', this.color);

    this.boat = createBoat({ accent: this.color });
    this.scene.add(this.boat.object);
    this.angler = createAngler({ vest: 0x5b6b3a, shirt: 0x8a2f2a, hat: 0xc9b98f, name: this.name || 'You' });
    this.angler.setName?.(''); // others see your tag; you don't need it over your own head
    this.boat.object.add(this.angler.object);
    if (!this.boat.waterMask) this._addWaterMask(this.boat);
    this.net = createLandingNet();
    this.boat.object.add(this.net.object);
    this._restNet();

    this.fishMgr = new FishManager(this.scene);
    this.rig = new FishingRig(this.scene, this.audio, {
      notify: (m, b) => this.hud.notify(m, b),
      onCatch: (f) => this._onCatch(f),
      onLost: (f) => this.fishMgr.release(f),
      spawnSplash: (p, s) => this.effects.splash(p, s),
      fishManager: this.fishMgr,
      onNetStart: () => { this.netting = 0; },
    });
    this.fishMgr.rig = this.rig;
    this.rig.setVisible(false);
    this.hud.setLures(LURE_TYPES, this.rig.lureType);

    this.journal = JSON.parse(localStorage.getItem('af-journal') || 'null') || { points: 0, total: 0, species: {} };

    // land, shop, wallet, upgrades; restore the crate from the last session
    this.land = new Land(this);
    this.cheatSpeed = 1;
    for (const c of this.land.crate.slice(-6)) this._addCrateModel(c);
    this.applyUpgrades();

    // trophy view for the catch card
    this.trophy = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(30, 1, 0.01, 50), fish: null, t: 0 };
    const ts = this.trophy.scene;
    ts.environment = this.scene.environment;
    ts.environmentIntensity = 0.55;
    const key = new THREE.DirectionalLight(0xfff2de, 2.2); key.position.set(1.5, 3, 2.5); ts.add(key);
    const rim = new THREE.DirectionalLight(0xbfe6ff, 1.3); rim.position.set(-2, 1.5, -3); ts.add(rim);
    ts.add(new THREE.HemisphereLight(0xcfe6ff, 0x3a3226, 0.35));

    this.network = new Network({
      onJoin: (id, info) => this._addRemote(id, info),
      onLeave: (id) => this._removeRemote(id),
      onState: (id, s) => { if (!this.remotes.has(id)) this._addRemote(id, { name: 'Angler' }); this.remotes.get(id).setState(s); },
      onEvent: (id, ev) => this._onNetEvent(id, ev),
      onStatus: (t) => this.hud.notify(t, true),
    });

    this._bindUI();
    this._bindCheat();
    this._syncBoat(0);
  }

  // ------------------------------------------------------------------ hidden cheat (bottom-right corner)
  // Type 67 + Enter: infinite money and a boat-speed slider. Type it again to switch off.
  _bindCheat() {
    let root = $('cheat');
    if (!root) {
      root = document.createElement('div');
      root.id = 'cheat';
      root.innerHTML = '<input id="cheat-input" maxlength="8" autocomplete="off" spellcheck="false"><div id="cheat-panel" class="hidden"><label>Boat speed <span id="cheat-speed-val">×1.0</span><input type="range" id="cheat-speed" min="0.5" max="8" step="0.1" value="1"></label></div>';
      Object.assign(root.style, { position: 'fixed', right: '4px', bottom: '4px', zIndex: 60, pointerEvents: 'auto' });
      document.body.appendChild(root);
      Object.assign($('cheat-input').style, { width: '28px', height: '14px', opacity: 0.06, fontSize: '10px', background: 'transparent', border: '1px solid rgba(255,255,255,0.3)', color: '#fff' });
    }
    const inp = $('cheat-input'), panel = $('cheat-panel'), slider = $('cheat-speed'), val = $('cheat-speed-val');
    const apply = (on, speed) => {
      this.land.infinite = on;
      this.cheatSpeed = on ? speed : 1;
      panel.classList.toggle('hidden', !on);
      slider.value = speed;
      val.textContent = `×${(+speed).toFixed(1)}`;
      this.applyUpgrades();
      if (this.land.shopOpen) this.land.render();
      localStorage.setItem('af-cheat', JSON.stringify({ on, speed }));
    };
    const saved = JSON.parse(localStorage.getItem('af-cheat') || 'null');
    if (saved?.on) apply(true, saved.speed || 1);
    inp.addEventListener('focus', () => { this.input.enabled = false; this.input.exitLock(); });
    inp.addEventListener('blur', () => { this.input.enabled = true; });
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { inp.value = ''; inp.blur(); return; }
      if (e.key !== 'Enter') return;
      const code = inp.value.trim();
      inp.value = '';
      if (code === '67') {
        const on = !this.land.infinite;
        apply(on, on ? +slider.value || 1 : 1);
        this.audio.purchase?.();
        this.hud.notify(on ? 'Cheats on: infinite francs and a speed dial for your boat' : 'Cheats off', true);
      } else {
        inp.animate?.([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 180 });
      }
      inp.blur();
    });
    slider.addEventListener('input', () => {
      val.textContent = `×${(+slider.value).toFixed(1)}`;
      this.cheatSpeed = +slider.value;
      this.applyUpgrades();
      localStorage.setItem('af-cheat', JSON.stringify({ on: true, speed: +slider.value }));
    });
    // let the slider be dragged without the game grabbing keys
    slider.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  // ------------------------------------------------------------------ UI / menu
  _bindUI() {
    const name = $('inp-name');
    name.value = this.name;
    const start = () => {
      this.name = (name.value.trim() || 'Angler').slice(0, 16);
      localStorage.setItem('af-name', this.name);
    };
    $('btn-solo').onclick = () => { start(); this._startPlay(); };
    $('btn-host').onclick = async () => {
      start();
      $('menu-status').textContent = 'Opening a lobby…';
      try {
        const code = await this.network.host({ name: this.name, color: this.color });
        this.hud.setLobby(code);
        this._startPlay();
        this.hud.notify(`Lobby open — share code ${code} with friends`, true);
      } catch (e) {
        $('menu-status').textContent = 'Could not open a lobby: ' + (e.message || e.type || e);
      }
    };
    $('btn-join').onclick = async () => {
      start();
      const code = $('inp-code').value.trim().toUpperCase();
      if (code.length < 4) { $('menu-status').textContent = 'Enter the lobby code from your friend'; return; }
      $('menu-status').textContent = 'Joining…';
      try {
        await this.network.join(code, { name: this.name, color: this.color });
        this.hud.setLobby(code);
        // spread out boats a little
        this.phys.x += (Math.random() - 0.5) * 20; this.phys.z += 15 + Math.random() * 30;
        this.phys.setAnchor(true);
        this._startPlay();
      } catch (e) {
        $('menu-status').textContent = 'Join failed: ' + (e.message || e.type || e);
      }
    };
    const chat = $('chat-input');
    chat.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = chat.value.trim();
        if (t) { this.hud.chat(this.name, this.color, t); this.network.sendEvent({ type: 'chat', text: t, name: this.name }); }
        this._closeChat();
      } else if (e.key === 'Escape') this._closeChat();
    });
    addEventListener('keydown', (e) => {
      if (this.hud.catchOpen) {
        if (e.code === 'KeyK') this._resolveCatch(true);
        if (e.code === 'KeyR') this._resolveCatch(false);
      }
    });
    this.input.onLockChange = (locked) => {
      if (!locked && this.mode !== 'menu' && !this.hud.overlayOpen && !this.chatOpen) this.hud.notify('Click to resume', false);
    };
  }

  showMenu() {
    $('menu').classList.remove('hidden');
    this.hud.show(false);
  }

  _startPlay() {
    $('menu').classList.add('hidden');
    this.hud.show(true);
    this.audio.init();
    this.audio.resume();
    this.mode = 'drive';
    this.input.wantLock = true;
    this.input.requestLock();
    this.camYaw = this.phys.h;
    this._refreshPlayers();
    if (!localStorage.getItem('af-helped')) { this.hud.toggleHelp(true); localStorage.setItem('af-helped', '1'); }
    this.hud.notify('W/S throttle · A/D steer · Q anchor · F to fish', true);
  }

  _openChat() {
    this.chatOpen = true;
    this.input.enabled = false;
    this.input.exitLock();
    const c = $('chat-input');
    c.classList.remove('hidden');
    c.value = '';
    setTimeout(() => c.focus(), 0);
  }
  _closeChat() {
    this.chatOpen = false;
    const c = $('chat-input');
    c.blur();
    c.classList.add('hidden');
    this.input.enabled = true;
    this.input.requestLock();
  }

  // ------------------------------------------------------------------ multiplayer
  _addRemote(id, info) {
    if (id === this.network.myId) return;
    if (this.remotes.has(id)) { const r = this.remotes.get(id); r.info = info; r.angler.setName?.(info.name); this._refreshPlayers(); return; }
    this.remotes.set(id, new RemotePlayer(this.scene, id, info, this));
    this.hud.notify(`${info.name || 'An angler'} joined the river`, false);
    this._refreshPlayers();
  }
  _removeRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.dispose();
    this.remotes.delete(id);
    this.hud.notify(`${r.info.name || 'An angler'} left`, false);
    this._refreshPlayers();
  }
  _refreshPlayers() {
    const list = [{ name: this.name || 'You', color: this.color, me: true }];
    for (const r of this.remotes.values()) list.push({ name: r.info.name || 'Angler', color: r.color });
    this.hud.setPlayers(this.network.active ? list : []);
  }
  _onNetEvent(id, ev) {
    const r = this.remotes.get(id);
    const name = ev.name || r?.info.name || 'Angler';
    if (ev.type === 'chat') this.hud.chat(name, r?.color ?? 0xffffff, ev.text);
    if (ev.type === 'catch') {
      const sp = SPECIES[ev.species];
      this.hud.notify(`🎣 ${name} landed a ${ev.weight.toFixed(2)} kg ${sp?.name || ev.species}!`, true);
    }
  }

  // ------------------------------------------------------------------ catching
  _onCatch(f) {
    const pts = pointsFor(f.species, f.len);
    const rec = this.journal.species[f.species];
    const first = !rec;
    const record = first || f.weight > rec.best;
    this.pendingCatch = { fish: f, points: pts, record, first };
    f.state = 'caught';
    f.hooked = false;
    f.inCrate = true; // parked (not simulated) until kept or released
    f.model.object.visible = false;
    // trophy model
    const tr = this.trophy;
    if (tr.fish) { tr.scene.remove(tr.fish.object); tr.fish.dispose(); }
    tr.fish = createFish(f.species, f.len, f.seed || 0);
    tr.scene.add(tr.fish.object);
    tr.t = 0;
    tr.len = f.len;
    this.input.exitLock();
    this.audio.jingle();
    this.hud.showCatch({ species: f.species, len: f.len, weight: f.weight, points: pts, record, first },
      () => this._resolveCatch(true), () => this._resolveCatch(false));
    this.network.sendEvent({ type: 'catch', species: f.species, weight: f.weight, len: f.len, name: this.name });
  }

  _resolveCatch(keep) {
    const c = this.pendingCatch;
    if (!c) return;
    this.pendingCatch = null;
    this.hud.hideCatch();
    const f = c.fish;
    const pts = keep ? c.points : Math.round(c.points * 1.2);
    const j = this.journal;
    j.points += pts; j.total += 1;
    const r = j.species[f.species] || (j.species[f.species] = { count: 0, best: 0, bestLen: 0 });
    r.count++;
    if (f.weight > r.best) { r.best = f.weight; r.bestLen = f.len; }
    localStorage.setItem('af-journal', JSON.stringify(j));
    f.hooked = false;
    if (keep) {
      // lay it in the boat's crate; it can be sold at the Fischerei
      const i = this.fishMgr.fish.indexOf(f);
      if (i >= 0) this.fishMgr.fish.splice(i, 1);
      f.inCrate = true;
      this.land.addCatch(f);
      this._addCrateModel(f, f.model);
      this.hud.notify(`Kept · +${pts} pts · sell it at the Fischerei by the dock`, false);
    } else {
      f.inCrate = false;
      f.model.object.visible = true;
      f.pos.copy(this.rig.tipPos); f.pos.y = waterY(f.pos.z) - 0.3;
      const side = _v.set(Math.cos(this.phys.h), 0, -Math.sin(this.phys.h));
      f.pos.addScaledVector(side, 1.2);
      f.fleeDir = side.clone();
      this.fishMgr.release(f);
      this.effects.splash(f.pos, 0.25);
      this.hud.notify(`Released · +${pts} pts (catch & release bonus)`, false);
    }
    this.input.requestLock();
  }

  // Depth-only footprint at the waterline so the river surface doesn't show inside the hull.
  _addWaterMask(boat) {
    const L = boat.length || 7.5, B = boat.beam || 1.6;
    const shape = new THREE.Shape();
    const N = 24, pts = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N; // 0 stern .. 1 bow
      const w = t < 0.35 ? THREE.MathUtils.lerp(0.62, 1, Math.sin(t / 0.35 * Math.PI / 2)) : Math.pow(Math.max(0, 1 - (t - 0.35) / 0.65), 0.75);
      pts.push([(B / 2 - 0.07) * w, (t - 0.5) * (L - 0.25)]);
    }
    shape.moveTo(-pts[0][0], pts[0][1]);
    for (const [x, z] of pts) shape.lineTo(x, z);
    for (let i = pts.length - 1; i >= 0; i--) shape.lineTo(-pts[i][0], pts[i][1]);
    const geo = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, side: THREE.DoubleSide });
    const mask = new THREE.Mesh(geo, mat);
    mask.position.y = 0.06;
    mask.renderOrder = 1; // after opaque geometry, before the water (2)
    boat.object.add(mask);
    return mask;
  }

  // a kept fish lying in the boat's crate (visual only; the inventory lives in land.crate)
  _addCrateModel(c, model = null) {
    const m = model || createFish(c.species, c.len, c.seed || 0);
    const o = m.object;
    if (o.parent) o.parent.remove(o);
    const holder = new THREE.Group(); // scale big fish down to fit, without touching the model's own scale
    holder.add(o);
    this.boat.crate.add(holder);
    o.visible = true;
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    const k = this.crateFish.length;
    holder.position.set(((k % 3) - 1) * 0.12, 0.04 + Math.floor(k / 3) * 0.05, 0);
    holder.rotation.set(0, (k % 2 ? 0.15 : -0.15), Math.PI / 2);
    holder.scale.setScalar(Math.min(1, 0.6 / c.len));
    m.setSwim(0, 0); m.setStruggle(0.05);
    this.crateFish.push({ model: m, holder });
    if (this.crateFish.length > 6) {
      const old = this.crateFish.shift();
      this.boat.crate.remove(old.holder);
      old.model.dispose();
    }
  }

  clearCrateModels() {
    for (const c of this.crateFish) { this.boat.crate.remove(c.holder); c.model.dispose(); }
    this.crateFish = [];
  }

  applyUpgrades() {
    const L = this.land;
    this.boat.setPaint(L.paint);
    // drag grows with speed squared, so thrust scales with the square of the wanted speed factor
    this.phys.maxThrust = 2100 * L.thrustMult * (this.cheatSpeed || 1) ** 2;
    this.rig.lineBreakKg = L.braid ? BRAID.breakKg : 7.2;
  }

  // ------------------------------------------------------------------ going ashore / boarding
  _goAshore(spot) {
    const P = this.phys;
    P.throttle = 0; P.steer = 0;
    P.moored = true;
    if (!P.anchored) { P.setAnchor(true); this.boat.setAnchor(true); }
    const face = Math.atan2(spot.x - P.x, spot.z - P.z);
    this.land.enter(spot, face);
    this.mode = 'walk';
    this.rig.setVisible(false);
    this.hud.notify('Ashore: WASD to walk, Shift to run. The Fischerei by the dock buys fish.', true);
  }

  _board() {
    const P = this.phys;
    P.moored = false;
    this.mode = 'drive';
    const a = this.angler;
    this.scene.remove(a.object);
    this.boat.object.add(a.object);
    a.setStance('sit');
    a.setWalk(0, 0);
    this.camYaw = this.land.camYaw;
    this.audio.footstep?.('wood');
    this.hud.notify('Back aboard', false);
  }

  _restNet() {
    const n = this.net.object;
    n.position.copy(this.boat.netRest.position);
    n.quaternion.copy(this.boat.netRest.quaternion);
  }

  // ------------------------------------------------------------------ main update
  update(dt) {
    this.time += dt;
    const inp = this.input;
    const playing = this.mode !== 'menu';
    const blocked = this.hud.overlayOpen || this.chatOpen;
    const walking = this.mode === 'walk';

    if (playing && !blocked) this._handleKeys();
    if (playing && !this.chatOpen && inp.hit('KeyJ')) this.hud.toggleJournal(this.journal);
    if (playing && !this.chatOpen && inp.hit('KeyH')) this.hud.toggleHelp();
    if (playing && !blocked && (inp.hit('Enter') || inp.hit('KeyT'))) this._openChat();

    // ---- boat control
    const P = this.phys;
    if (inp.hit('Escape') && this.land.shopOpen) this.land.closeShop();
    if (this.mode === 'drive' && !blocked) {
      const tRate = 0.9 * dt;
      if (inp.down('KeyW')) P.throttle = Math.min(1, P.throttle + tRate);
      if (inp.down('KeyS')) P.throttle = Math.max(-0.5, P.throttle - tRate);
      if (inp.hit('KeyX')) P.throttle = 0;
      const st = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0);
      P.steer += (st - P.steer) * Math.min(1, dt * 4);
      if (P.throttle !== 0 && P.anchored) { P.setAnchor(false); this.boat.setAnchor(false); this.hud.notify('Anchor raised', false); }
    } else {
      P.throttle *= Math.max(0, 1 - dt * 3);
      P.steer *= Math.max(0, 1 - dt * 3);
    }
    P.step(dt);
    if (P.bump > 0.8) { this.audio.bump(P.bump); this.camShake = Math.min(1, P.bump * 0.2); }
    P.bump = 0;
    // boats bump into each other
    for (const r of this.remotes.values()) {
      const dx = P.x - r.pos.x, dz = P.z - r.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 3.4 && d > 0.01) { P.x += dx / d * (3.4 - d) * 0.5; P.z += dz / d * (3.4 - d) * 0.5; }
    }
    this._syncBoat(dt);

    // ---- look / aim
    const look = playing && inp.locked && !blocked;
    if (look && !walking) {
      const sens = 0.0022;
      if (this.mode === 'fish' && !this.camTP) {
        this.aimRel -= inp.mouse.dx * sens;
        this.aimPitch = THREE.MathUtils.clamp(this.aimPitch - inp.mouse.dy * sens, -1.1, 0.9);
      } else if (this.mode === 'fish') {
        this.aimRel -= inp.mouse.dx * sens;
        this.aimPitch = THREE.MathUtils.clamp(this.aimPitch - inp.mouse.dy * sens, -0.9, 0.6);
      } else {
        this.camYaw -= inp.mouse.dx * sens;
        this.camPitch = THREE.MathUtils.clamp(this.camPitch + inp.mouse.dy * sens, -0.05, 1.2);
        this._camIdle = 0;
      }
    }
    const aimYaw = P.h + this.aimRel;

    // ---- angler pose (on land the walker poses it)
    if (walking) this.land.update(dt, inp, look);
    else this._poseAngler(dt, aimYaw);

    // ---- fishing rig
    const fishingActive = this.mode === 'fish' && !blocked && inp.locked;
    const m = inp.mouse;
    const head = this.angler.head.getWorldPosition(new THREE.Vector3());
    const netPos = _v2.copy(this.boat.seats.fisher).applyMatrix4(this.boat.object.matrixWorld);
    netPos.y = waterY(netPos.z);
    if (this.mode === 'fish') {
      this.rig.update(dt, {
        head, yaw: aimYaw, pitch: this.aimPitch, active: fishingActive, netPos,
        boatVel: _v.set(P.vx, 0, P.vz),
        input: {
          castHeld: fishingActive && m.left, castDown: fishingActive && m.leftDown, castUp: m.leftUp,
          reel: fishingActive && m.left && this.rig.state !== 'charging' && this.rig.state !== 'idle',
          fastReel: inp.down('ShiftLeft'),
          strike: fishingActive && m.rightDown, strikeHeld: fishingActive && m.right,
          feather: fishingActive && inp.hit('Space'),
          sideL: fishingActive && inp.down('KeyA'), sideR: fishingActive && inp.down('KeyD'),
          net: fishingActive && inp.hit('KeyE'),
          wheel: fishingActive ? m.wheel : 0,
        },
      });
      this.angler.setHandTargets(this.rig.rod.gripRight.getWorldPosition(new THREE.Vector3()), this.rig.rod.gripLeft.getWorldPosition(new THREE.Vector3()));
      // landing net animation
      if (this.rig.state === 'landing' && this.rig.fish) {
        const n = this.net.object;
        this.boat.object.remove(n); this.scene.add(n);
        n.position.copy(head).add(_v.set(0, -0.6, 0));
        n.lookAt(this.rig.fish.pos.clone().add(_v.set(0, -0.15, 0)));
        n.updateMatrixWorld(true);
      } else if (this.net.object.parent === this.scene) {
        this.scene.remove(this.net.object); this.boat.object.add(this.net.object); this._restNet();
      }
    } else if (!walking) {
      this.angler.setHandTargets(this.boat.tillerGrip.getWorldPosition(new THREE.Vector3()), null);
    }
    this.angler.update(dt);
    this.land.updateShop(dt);
    this._interactions(blocked);

    // ---- fish + world
    const focus = walking ? this.land.pos : new THREE.Vector3(P.x, P.y, P.z);
    this.fishMgr.update(dt, { pos: _v.set(P.x, P.y, P.z).clone(), throttle: P.throttle }, this.camera.position);
    for (const c of this.crateFish) c.model.update(dt);
    this.effects.boat(dt, P);
    this.effects.update(dt);

    // ---- camera
    if (walking) this.land.camera(this.camera, dt);
    else this._updateCamera(dt, head, aimYaw);
    this.world.update(dt, this.camera, focus);
    this.world.updateReflections(this.camera.position);

    // ---- remote players
    for (const r of this.remotes.values()) r.update(dt);

    // ---- audio + HUD
    flowAt(P.x, P.z, _f);
    const vx = bankX(SPAWN_Z, VILLAGE_SIDE, 60);
    const lp = this.camera.position;
    const villageD = Math.hypot(lp.x - vx, lp.z - SPAWN_Z);
    this._wdT = (this._wdT || 0) - dt;
    if (this._wdT <= 0) { this._wdT = 0.5; this._wd = walking ? this._waterDist(this.land.pos) : 0; }
    this.audio.ambience(dt, { rapids: rapids(lp.z), throttle: P.throttle, nearVillage: Math.max(0, 1 - villageD / 400), speed: P.speedOverGround, camera: this.camera, onLand: walking, waterDist: this._wd || 0, layout: this.world.layout });
    if (playing) {
      this._hudFrame(aimYaw);
      this._mmT = (this._mmT || 0) - dt;
      if (this._mmT <= 0) {
        this._mmT = 0.1;
        const others = [...this.remotes.values()].map(r => ({ x: r.pos.x, z: r.pos.z, h: r.h, color: r.color }));
        const me = walking ? { x: this.land.pos.x, z: this.land.pos.z, h: this.land.yaw } : { x: P.x, z: P.z, h: P.h };
        const marks = [{ x: bankX(SPAWN_Z, VILLAGE_SIDE, 70), z: SPAWN_Z, label: '⌂', color: '#fff' },
          ...this.land.shops.map(sh => ({ x: sh.frontWorld.x, z: sh.frontWorld.z, label: '$', color: '#f2c14e' }))];
        if (walking) marks.push({ x: P.x, z: P.z, label: '⛵', color: '#fff' });
        this.hud.minimap(me, others, marks);
      }
    }

    // ---- network
    this.netTimer -= dt;
    if (this.network.active && this.netTimer <= 0) { this.netTimer = 0.1; this._sendState(aimYaw); }

    inp.endFrame();
  }

  // context prompts + E to act: go ashore, board, open the shop
  _interactions(blocked) {
    this._prompt = '';
    if (blocked || this.mode === 'menu') return;
    const P = this.phys;
    const inp = this.input;
    if (this.mode === 'drive') {
      this._landT = (this._landT || 0) - 1;
      if (this._landT <= 0) { this._landT = 6; this._landing = P.speedOverGround < 2.5 ? this.land.findLanding(P) : null; }
      if (this._landing) {
        this._prompt = 'E: Go ashore';
        if (inp.hit('KeyE')) { const spot = this.land.findLanding(P); if (spot) this._goAshore(spot); }
      }
    } else if (this.mode === 'walk') {
      const L = this.land;
      const dBoat = Math.hypot(L.pos.x - P.x, L.pos.z - P.z);
      if (L.nearShop()) {
        this._prompt = 'E: Open the Fischerei';
        if (inp.hit('KeyE')) L.openShop();
      } else if (dBoat < 3.8) {
        this._prompt = 'E: Board the boat';
        if (inp.hit('KeyE')) this._board();
      }
    }
  }

  // metres from a point on land to the river's edge (coarse march toward the centreline)
  _waterDist(p) {
    const dir = Math.sign(centerX(p.z) - p.x) || 1;
    for (let d = 0; d < 400; d += 4) {
      const x = p.x + dir * d;
      if (this.land.groundY(x, p.z) < waterY(p.z)) return d;
    }
    return 400;
  }

  _handleKeys() {
    const inp = this.input;
    if (this.mode === 'walk') return; // on land only E (handled in _interactions) and menus apply
    if (inp.hit('KeyF')) {
      if (this.mode === 'drive') {
        this.mode = 'fish';
        this.aimRel = this.camYaw - this.phys.h;
        this.aimPitch = -0.08;
        this.rig.setVisible(true);
        this.hud.notify('Fishing — hold LMB to cast. F to drive again', false);
      } else if (this.rig.state === 'idle') {
        this.mode = 'drive';
        this.rig.setVisible(false);
        this.camYaw = this.phys.h + this.aimRel;
        this.angler.setFirstPerson?.(false);
      } else this.hud.notify('Reel in first', false);
    }
    if (inp.hit('KeyQ')) {
      const on = !this.phys.anchored;
      this.phys.setAnchor(on);
      if (on) this.phys.throttle = 0;
      this.boat.setAnchor(on);
      this.audio.anchor(on);
      this.hud.notify(on ? 'Anchor dropped' : 'Anchor raised', false);
    }
    if (inp.hit('KeyC')) this.camTP = !this.camTP;
    if (this.mode === 'fish') {
      LURE_TYPES.forEach((t, i) => {
        if (inp.hit('Digit' + (i + 1))) {
          if (this.rig.selectLure(t)) { this.hud.setLures(LURE_TYPES, t); this.audio.ui(); }
          else if (t !== this.rig.lureType) this.hud.notify('Reel in to change lures', false);
        }
      });
    }
  }

  _syncBoat(dt) {
    const P = this.phys;
    const o = this.boat.object;
    o.position.set(P.x, P.y, P.z);
    o.rotation.set(P.pitch, P.h, P.roll, 'YXZ');
    o.updateMatrixWorld(true);
    this.boat.setThrottle(P.throttle);
    this.boat.setSteer(P.steer);
    this.boat.setAnchor(P.anchored);
    this.boat.update(dt, this.time);
  }

  _poseAngler(dt, aimYaw) {
    const a = this.angler;
    if (this.mode === 'fish') {
      a.object.position.copy(this.boat.seats.fisher);
      // sit facing bow or stern, twist the torso for the rest
      let rel = this.aimRel % (Math.PI * 2);
      if (rel > Math.PI) rel -= Math.PI * 2;
      if (rel < -Math.PI) rel += Math.PI * 2;
      const facing = Math.abs(rel) > Math.PI * 0.62 ? Math.PI : 0;
      this._bodyYaw = this._bodyYaw ?? facing;
      this._bodyYaw += (facing - this._bodyYaw) * Math.min(1, dt * 4);
      a.object.rotation.set(0, this._bodyYaw, 0);
      let tw = rel - this._bodyYaw;
      while (tw > Math.PI) tw -= Math.PI * 2;
      while (tw < -Math.PI) tw += Math.PI * 2;
      a.setLook(tw, this.aimPitch);
      a.setFirstPerson?.(!this.camTP);
    } else {
      a.object.position.copy(this.boat.seats.driver);
      a.object.rotation.set(0, 0, 0);
      this._bodyYaw = 0;
      let rel = this.camYaw - this.phys.h;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      a.setLook(THREE.MathUtils.clamp(rel * 0.4, -0.8, 0.8), 0);
      a.setFirstPerson?.(false);
    }
    this.boat.object.updateMatrixWorld(true);
  }

  _updateCamera(dt, head, aimYaw) {
    const cam = this.camera;
    const P = this.phys;
    if (this.mode === 'menu') {
      const t = this.time * 0.035;
      const cx = P.x, cz = P.z;
      cam.position.set(cx + Math.sin(t) * 46, P.y + 11 + Math.sin(t * 1.7) * 3, cz + Math.cos(t) * 46);
      cam.lookAt(cx, P.y + 2, cz + 10);
      cam.fov = 55; cam.updateProjectionMatrix();
      return;
    }
    const shake = this.camShake || 0;
    this.camShake = Math.max(0, shake - dt * 2);
    if (this.mode === 'fish' && !this.camTP) {
      cam.position.copy(head);
      cam.rotation.set(this.aimPitch, aimYaw + Math.PI, P.roll * 0.4, 'YXZ');
      if (cam.fov !== 62) { cam.fov = 62; cam.updateProjectionMatrix(); }
    } else if (this.mode === 'fish') {
      const fwd = _v.set(Math.sin(aimYaw), 0, Math.cos(aimYaw));
      const right = _v2.set(-Math.cos(aimYaw), 0, Math.sin(aimYaw));
      const want = head.clone().addScaledVector(fwd, -3.2).addScaledVector(right, 0.9);
      want.y += 1.1 - this.aimPitch * 1.5;
      cam.position.lerp(want, Math.min(1, dt * 8));
      const tgt = head.clone().addScaledVector(fwd, 6);
      tgt.y += this.aimPitch * 6;
      if (this.rig.fish) tgt.lerp(this.rig.fish.pos, 0.5);
      cam.lookAt(tgt);
      if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
    } else {
      // chase camera, eases behind the boat while under way
      this._camIdle = (this._camIdle || 0) + dt;
      if (this._camIdle > 2.5 && Math.abs(P.throttle) > 0.15) {
        let d = P.h - this.camYaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.camYaw += d * Math.min(1, dt * 0.8);
      }
      const dist = this.camDist;
      const want = _v.set(P.x - Math.sin(this.camYaw) * Math.cos(this.camPitch) * dist, P.y + 1.4 + Math.sin(this.camPitch) * dist, P.z - Math.cos(this.camYaw) * Math.cos(this.camPitch) * dist);
      const minY = waterY(want.z) + 0.6;
      if (want.y < minY) want.y = minY;
      cam.position.lerp(want, Math.min(1, dt * 10));
      cam.lookAt(P.x, P.y + 1.3, P.z);
      if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
    }
    if (shake > 0) { cam.position.x += (Math.random() - 0.5) * shake * 0.1; cam.position.y += (Math.random() - 0.5) * shake * 0.1; }
  }

  _hudFrame(aimYaw) {
    const P = this.phys;
    const R = this.rig;
    let prompt = '', pulse = false;
    if (this.mode === 'fish') {
      if (R.bite) { prompt = R.bite.float ? 'The float is down — STRIKE! (right mouse)' : 'STRIKE! (right mouse)'; pulse = true; }
      else if (R.snagged) prompt = 'Snagged — jerk with right mouse, or reel to break off';
      else if (R.state === 'fight' && R.canNet) { prompt = 'Press E to net it'; pulse = true; }
      else if (R.state === 'fight' && R.tension > R.lineBreakKg * 9.81 * 0.85) { prompt = 'Line strained — ease off!'; pulse = true; }
      else if (R.state === 'idle') prompt = this.input.locked ? 'Hold left mouse to cast' : '';
      else if (R.state === 'flight') prompt = 'Space to stop the line';
    }
    if (!prompt && this._prompt) prompt = this._prompt;
    if (!this.input.locked && !this.hud.overlayOpen && !this.chatOpen) prompt = 'Click to play';
    const lureDepth = R.fish ? Math.max(0, waterY(R.fish.pos.z) - R.fish.pos.y)
      : R.state === 'water' ? Math.max(0, waterY(R.lurePos.z) - (R.lureType === 'float' ? R.baitPos.y : R.lurePos.y)) : 0;
    const yaw = this.mode === 'fish' ? aimYaw : this.mode === 'walk' ? this.land.camYaw : this.camYaw;
    this.hud.frame({
      yaw,
      modeLabel: this.mode === 'walk' ? 'On foot' : this.mode === 'fish' ? `Fishing · ${P.anchored ? 'anchored' : 'drifting'}` : (P.moored ? 'Moored' : P.anchored ? 'At anchor' : 'Under way'),
      walking: this.mode === 'walk', moored: !!P.moored, money: this.land.money, crate: this.land.crate.length, breakKg: R.lineBreakKg,
      prompt, promptPulse: pulse,
      speed: P.speedOverGround, throttle: P.throttle, anchored: P.anchored, current: P.flowSpeed,
      fishing: this.mode === 'fish',
      tension: R.tension, drag: R.drag, lineOut: R.lineOut, lureDepth,
      stamina: R.fish ? R.fish.stamina : null,
      charging: R.state === 'charging', power: R.power,
    });
  }

  _sendState(aimYaw) {
    const P = this.phys;
    const r = (x) => +x.toFixed(3);
    let f = null;
    const hf = this.rig.fish;
    if (hf) {
      const o = hf.model.object;
      f = { sp: hf.species, l: r(hf.len), p: [r(o.position.x), r(o.position.y), r(o.position.z)], y: r(hf.yaw), pi: r(hf.pitch), ro: r(hf.roll) };
    }
    this.network.sendState({
      b: P.serialize().map(r), th: r(P.throttle), sr: r(P.steer), an: P.anchored ? 1 : 0,
      m: this.mode === 'fish' ? 'fish' : this.mode === 'walk' ? 'walk' : 'drive', ay: r(aimYaw), ap: r(this.aimPitch),
      r: this.rig.netState(), f, pt: this.land.paint ?? -1,
      w: this.mode === 'walk' ? [r(this.land.pos.x), r(this.land.pos.y), r(this.land.pos.z), r(this.land.yaw), r(this.land.phase % 6.2832), r(this.land.walkAmt)] : null,
    });
  }

  renderOverlay() {
    if (!this.pendingCatch || !this.trophy.fish) return;
    const tr = this.trophy;
    const r = this.renderer;
    const w = innerWidth, h = innerHeight;
    const vw = Math.round(w * 0.6), vh = h;
    tr.t += 1 / 60;
    // side-on hero shot, gently turning
    tr.fish.object.rotation.set(Math.sin(tr.t * 0.9) * 0.06, Math.PI / 2 + Math.sin(tr.t * 0.5) * 0.55, Math.sin(tr.t * 1.3) * 0.06);
    tr.fish.setSwim(0.15, Math.sin(tr.t) * 0.3);
    tr.fish.setStruggle(0.15);
    tr.fish.update(1 / 60);
    tr.camera.aspect = vw / vh;
    tr.camera.updateProjectionMatrix();
    const halfTan = Math.tan(THREE.MathUtils.degToRad(tr.camera.fov / 2));
    const dist = Math.max(tr.len / (0.72 * 2 * halfTan * tr.camera.aspect), tr.len * 0.35 / (2 * halfTan) * 2.4);
    tr.camera.position.set(0, tr.len * 0.08, dist);
    tr.camera.lookAt(0, 0, 0);
    r.autoClear = false;
    r.setScissorTest(true);
    r.setScissor(0, 0, vw, vh);
    r.setViewport(0, 0, vw, vh);
    r.clearDepth();
    r.render(tr.scene, tr.camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.autoClear = true;
  }
}

