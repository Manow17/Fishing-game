// Orchestrates player, boat, fishing, fish, camera, HUD, audio and multiplayer.
// Everything about the water/land comes from the active map through ENV (see world/env.js).
import * as THREE from 'three';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { Effects } from './effects.js';
import { BoatPhysics } from './boatPhysics.js';
import { FishingRig } from './fishing.js';
import { FishManager } from './fishAI.js';
import { SPECIES, pointsFor } from './species.js';
import { RemotePlayer } from './remote.js';
import { Network } from '../net/network.js';
import { createLandingNet } from '../models/boat.js';
import { createFish } from '../models/fish.js';
import { LURE_TYPES } from '../models/lures.js';
import { ENV, setWaveScale, MAPS } from '../world/env.js';
import { Land, BRAID } from './land.js';
import { loadLook, saveLook } from './look.js';
import { buildBoat, disposeBoat, buildAngler, placeAngler, seatWorld } from './rigging.js';
import { Workshop } from './workshop.js';
import { Settings, QUALITY, loadGfx, waveName } from './settings.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _f = {};
const $ = (id) => document.getElementById(id);
const wrapPi = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

export class Game {
  constructor({ renderer, scene, camera, world, post }) {
    Object.assign(this, { renderer, scene, camera, world, post });
    this.mode = 'menu';           // menu | drive | fish | walk
    this.camTP = false;           // third person while fishing
    this.camYaw = 0; this.camPitch = 0.25; this.camDist = 10;
    this.aimRel = 0; this.aimPitch = -0.05;
    this.remotes = new Map();
    this.netTimer = 0;
    this.netTick = 0;
    this.time = 0;
    this.crateFish = [];
    this.pendingCatch = null;
    this.ride = null;             // { id, seat } while riding along in another player's boat
    this.bodyYaw = 0;
  }

  async init() {
    this.input = new Input(this.renderer.domElement);
    this.audio = new Audio();
    this.hud = new Hud();
    this.effects = new Effects(this.scene, this.world.water);

    this.name = localStorage.getItem('af-name') || '';
    this.color = Number(localStorage.getItem('af-color')) || [0xe8452c, 0x2f7de1, 0xf2c14e, 0x7ad66b, 0xb06ae8][(Math.random() * 5) | 0];
    localStorage.setItem('af-color', this.color);
    this.look = loadLook(this.color);
    this.gfx = loadGfx();

    // spawn beside the map's harbour dock
    const sp = ENV.spawn;
    this.phys = new BoatPhysics(sp.x, sp.z, sp.h);
    this.phys.setAnchor(true);
    for (const d of this.world.layout.docks) for (let i = 0; i <= 7; i++) {
      this.phys.obstacles.push({ x: d.x + Math.sin(d.yaw) * i * 2, z: d.z + Math.cos(d.yaw) * i * 2, r: 1.1 });
    }

    this.net = createLandingNet();
    this._makeBoat();
    this.angler = buildAngler(this.look.angler, this.name || 'You');
    this.angler.setName?.(''); // others see your tag; you don't need it over your own head
    this.scene.add(this.angler.object);

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
    this.trophy = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(30, 1, 0.01, 200), fish: null, t: 0 };
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
      onStatus: (t) => { this.hud.notify(t, true); const ms = $('menu-status'); if (ms && this.mode === 'menu') ms.textContent = t; },
    });

    this.workshop = new Workshop(this);
    this.settings = new Settings(this);
    this._bindUI();
    this._bindCheat();
    this.applyGfx();
    this._syncBoat(0);
  }

  // ------------------------------------------------------------------ boat & look
  _makeBoat() {
    const old = this.boat;
    this.boat = buildBoat(this.look.boat, this.color);
    this.scene.add(this.boat.object);
    if (!this.boat.waterMask) this._addWaterMask(this.boat);
    this.boat.object.add(this.net.object);
    this._restNet();
    this.phys.setHull(this.boat.phys, this.boat.size);
    if (old) {
      // carry the kept fish over to the new crate
      for (const c of this.crateFish) { old.crate.remove(c.holder); this.boat.crate.add(c.holder); }
      disposeBoat(old, this.scene);
    }
    this._boatKey = `${this.look.boat.type}|${this.look.boat.size}`;
  }

  // the boat object of any player id (me or a remote)
  boatOf(id) {
    if (id === this.network.myId) return this.boat;
    return this.remotes.get(id)?.boat || null;
  }

  // apply the (workshop-edited) look to my boat and angler, and tell everyone
  applyLook() {
    saveLook(this.look);
    if (`${this.look.boat.type}|${this.look.boat.size}` !== this._boatKey) this._makeBoat();
    else { this.boat.setPaint?.(this.look.boat.paint ?? null); this.boat.setAccent?.(this.look.boat.accent); }
    const key = JSON.stringify(this.look.angler);
    if (key !== this._anglerKey) {
      this._anglerKey = key;
      if (this.angler.setOutfit) this.angler.setOutfit({ ...this.look.angler });
      else {
        this.scene.remove(this.angler.object);
        this.angler = buildAngler(this.look.angler, this.name);
        this.angler.setName?.('');
        this.scene.add(this.angler.object);
      }
    }
    this.applyUpgrades();
    this.network.updateInfo(this._myInfo());
    this._lookDirty = true;
  }

  _myInfo() {
    return { name: this.name, color: this.color, look: this.look, map: ENV.id, waves: ENV.waveScale };
  }

  applyUpgrades() {
    const L = this.land;
    this.boat.setPaint?.(this.look.boat.paint ?? null);
    // drag grows with speed squared, so thrust scales with the square of the wanted speed factor
    this.phys.thrustMult = L.thrustMult * (this.cheatSpeed || 1) ** 2;
    this.rig.lineBreakKg = ENV.tackle.lineBreakKg * (L.braid ? BRAID.breakKg / 7.2 : 1);
  }

  applyGfx() {
    const q = QUALITY.find(o => o.id === this.gfx.quality) || QUALITY[2];
    const pr = Math.max(0.5, Math.min(3, Math.min(window.devicePixelRatio || 1, 2) * q.scale));
    this.post.setPixelRatio?.(pr);
    this.post.setSharpen?.(this.gfx.sharpen);
    localStorage.setItem('af-gfx', JSON.stringify(this.gfx));
  }

  // ------------------------------------------------------------------ lobby: waves + map
  broadcastSettings() {
    if (this.network.active && this.network.isHost) {
      this.network.sendEvent({ type: 'settings', waveScale: ENV.waveScale });
      this.network.updateInfo(this._myInfo());
    }
  }

  // Maps are built at page load: switching reloads; a lobby owner brings the whole lobby along.
  switchMap(id) {
    if (!MAPS.some(m => m.id === id)) return;
    const n = this.network;
    if (n.active && !n.isHost) { this.hud.notify('Only the lobby owner can change the map', false); return; }
    const q = new URLSearchParams({ map: id });
    if (this.name) q.set('name', this.name);
    if (n.active && n.isHost) {
      n.sendEvent({ type: 'map', map: id, code: n.code });
      q.set('host', n.code);
      q.set('waves', ENV.waveScale);
    }
    setTimeout(() => { location.search = q.toString(); }, n.active ? 400 : 0);
  }

  // URL actions after a map switch: re-open the same lobby, or rejoin it
  async autoStart() {
    const q = new URLSearchParams(location.search);
    if (q.get('name')) { this.name = q.get('name'); $('inp-name').value = this.name; }
    if (q.get('waves')) setWaveScale(+q.get('waves'));
    if (q.get('host')) {
      $('menu-status').textContent = 'Re-opening your lobby…';
      try {
        const code = await this.network.host(this._myInfo(), q.get('host'));
        this.hud.setLobby(code);
        this._startPlay();
      } catch (e) { $('menu-status').textContent = 'Could not re-open the lobby: ' + (e.message || e.type || e); }
    } else if (q.get('join')) {
      $('inp-code').value = q.get('join');
      this._join(q.get('join'), 12);
    }
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
        const code = await this.network.host(this._myInfo());
        this.hud.setLobby(code);
        this._startPlay();
        this.hud.notify(`Lobby open — share code ${code} with friends`, true);
      } catch (e) {
        $('menu-status').textContent = 'Could not open a lobby: ' + (e.message || e.type || e);
      }
    };
    $('btn-join').onclick = () => {
      start();
      const code = $('inp-code').value.trim().toUpperCase();
      if (code.length < 4) { $('menu-status').textContent = 'Enter the lobby code from your friend'; return; }
      this._join(code, 0);
    };
    // map choice, workshop and settings from the menu
    document.querySelectorAll('[data-menu-map]').forEach(b => {
      b.classList.toggle('on', b.dataset.menuMap === ENV.id);
      b.onclick = () => { start(); if (b.dataset.menuMap !== ENV.id) this.switchMap(b.dataset.menuMap); };
    });
    $('btn-workshop')?.addEventListener('click', () => { start(); this.workshop.show(); });
    $('btn-settings')?.addEventListener('click', () => this.settings.show());
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
      if (e.code === 'Escape') {
        if (this.workshop.open) this.workshop.close();
        if (this.settings.open) this.settings.close();
      }
    });
    this.input.onLockChange = (locked) => {
      if (!locked && this.mode !== 'menu' && !this._overlay() && !this.chatOpen) this.hud.notify('Click to resume', false);
    };
  }

  async _join(code, retries) {
    $('menu-status').textContent = 'Joining…';
    try {
      await this.network.join(code, this._myInfo(), retries);
      this.hud.setLobby(code);
      // spread out boats a little
      this.phys.x += (Math.random() - 0.5) * 20; this.phys.z += 15 + Math.random() * 30;
      this.phys.setAnchor(true);
      this._startPlay();
    } catch (e) {
      $('menu-status').textContent = 'Join failed: ' + (e.message || e.type || e);
    }
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
    this.hud.notify('W/S throttle · A/D steer · Q anchor · F to fish · U workshop · O settings', true);
  }

  _overlay() { return this.hud.overlayOpen || this.workshop.open || this.settings.open; }

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
    // the lobby owner's map/waves rule: follow them
    if (info?.isHost && !this.network.isHost) {
      if (info.map && info.map !== ENV.id) {
        const q = new URLSearchParams({ map: info.map, join: this.network.code, name: this.name });
        this.hud.notify('Travelling to the lobby\'s map…', true);
        this.network.leave();
        setTimeout(() => { location.search = q.toString(); }, 300);
        return;
      }
      if (info.waves != null) setWaveScale(info.waves);
    }
    if (this.remotes.has(id)) { this.remotes.get(id).setInfo(info); this._refreshPlayers(); return; }
    this.remotes.set(id, new RemotePlayer(this.scene, id, info, this));
    this.hud.notify(`${info.name || 'An angler'} joined`, false);
    this._refreshPlayers();
  }
  _removeRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    if (this.ride?.id === id) this._leaveRide('Your skipper left — back in your own boat');
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
    if (ev.type === 'info' && r) r.setInfo(ev.info);
    if (ev.type === 'settings' && r?.info.isHost) {
      setWaveScale(ev.waveScale);
      this.hud.notify(`Lobby waves: ${waveName(ev.waveScale)}`, false);
      if (this.settings.open) this.settings.render();
    }
    if (ev.type === 'map' && r?.info.isHost) {
      const q = new URLSearchParams({ map: ev.map, join: ev.code, name: this.name });
      this.hud.notify('The lobby owner is moving everyone to a new map…', true);
      setTimeout(() => { location.search = q.toString(); }, 600);
    }
  }

  // ------------------------------------------------------------------ riding along
  _rideCandidate() {
    const P = this.phys;
    let best = null, bestD = Infinity;
    for (const r of this.remotes.values()) {
      if (!r.s || r.s.ride || r.s.m === 'walk') continue;
      const d = Math.hypot(r.pos.x - P.x, r.pos.z - P.z);
      const reach = (r.boat.length || 7.5) * r.boat.size * 0.5 + P.halfLen + 3;
      if (d < reach && d < bestD) { best = r; bestD = d; }
    }
    return best;
  }

  _startRide(r) {
    // first free passenger seat
    const used = new Set();
    for (const o of this.remotes.values()) if (o !== r && o.s?.ride?.[0] === r.id) used.add(o.s.ride[1]);
    const seats = r.boat.passengerSeats.length;
    let seat = -1;
    for (let i = 0; i < seats; i++) if (!used.has(i)) { seat = i; break; }
    if (seat < 0) { this.hud.notify(`${r.info.name}'s boat is full`, false); return; }
    this.ride = { id: r.id, seat };
    const P = this.phys;
    P.throttle = 0; P.steer = 0; P.moored = true;
    if (!P.anchored) { P.setAnchor(true); this.boat.setAnchor(true); }
    this.aimRel = 0;
    this.hud.notify(`Aboard ${r.info.name || 'their'}'s boat — F to fish, G to go back to yours`, true);
    this.audio.footstep?.('wood');
  }

  _leaveRide(msg = 'Back in your own boat') {
    if (!this.ride) return;
    if (this.rig.state !== 'idle') this.rig._toIdle?.();
    this.ride = null;
    this.phys.moored = false;
    if (this.mode === 'fish') { this.mode = 'drive'; this.rig.setVisible(false); }
    this.hud.notify(msg, false);
  }

  // the boat I'm standing in (mine, or my skipper's)
  _platform() {
    if (this.ride) { const b = this.boatOf(this.ride.id); if (b) return b; }
    return this.boat;
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
      f.pos.copy(this.rig.tipPos); f.pos.y = ENV.waterLevel(f.pos.x, f.pos.z) - 0.3;
      const h = this._platform().object.rotation.y;
      const side = _v.set(Math.cos(h), 0, -Math.sin(h));
      f.pos.addScaledVector(side, 1.2);
      f.fleeDir = side.clone();
      this.fishMgr.release(f);
      this.effects.splash(f.pos, 0.25);
      this.hud.notify(`Released · +${pts} pts (catch & release bonus)`, false);
    }
    this.input.requestLock();
  }

  // Depth-only footprint at the waterline so the water surface doesn't show inside the hull.
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
      old.holder.parent?.remove(old.holder);
      old.model.dispose();
    }
  }

  clearCrateModels() {
    for (const c of this.crateFish) { c.holder.parent?.remove(c.holder); c.model.dispose(); }
    this.crateFish = [];
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
    this.angler.setStance('sit');
    this.angler.setWalk(0, 0);
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
    const blocked = this._overlay() || this.chatOpen;
    const walking = this.mode === 'walk';

    if (playing && !blocked) this._handleKeys();
    if (playing && !this.chatOpen && inp.hit('KeyJ')) this.hud.toggleJournal(this.journal);
    if (playing && !this.chatOpen && inp.hit('KeyH')) this.hud.toggleHelp();
    if (playing && !blocked && (inp.hit('Enter') || inp.hit('KeyT'))) this._openChat();
    if (inp.hit('Escape') && this.land.shopOpen) this.land.closeShop();

    // ---- boat control (not while riding in someone else's boat)
    const P = this.phys;
    if (this.mode === 'drive' && !this.ride && !blocked) {
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
    if (P.slam > 0.4 && !this.ride) this.camShake = Math.max(this.camShake || 0, Math.min(0.6, P.slam * 0.4));
    P.bump = 0;
    // boats bump into each other
    for (const r of this.remotes.values()) {
      const dx = P.x - r.pos.x, dz = P.z - r.pos.z;
      const d = Math.hypot(dx, dz);
      const R = (P.beam + r.boat.beam * r.boat.size) * 0.9 + 1.4;
      if (d < R && d > 0.01) { P.x += dx / d * (R - d) * 0.5; P.z += dz / d * (R - d) * 0.5; }
    }
    if (this.ride && !this.boatOf(this.ride.id)) this._leaveRide();
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
    const platform = this._platform();
    platform.object.updateMatrixWorld(true);
    const platformH = platform.object.rotation.y;
    const aimYaw = platformH + this.aimRel;

    // ---- angler pose (on land the walker poses it)
    if (walking) this.land.update(dt, inp, look);
    else this._poseAngler(dt, aimYaw, platform);

    // ---- fishing rig
    const fishingActive = this.mode === 'fish' && !blocked && inp.locked;
    const m = inp.mouse;
    const head = this.angler.head.getWorldPosition(new THREE.Vector3());
    const seatLocal = this.ride ? platform.passengerSeats[this.ride.seat % platform.passengerSeats.length] : platform.seats.fisher;
    const netPos = seatWorld(platform, seatLocal, _v2);
    netPos.y = ENV.waterLevel(netPos.x, netPos.z);
    if (this.mode === 'fish') {
      const rv = this.ride ? this.remotes.get(this.ride.id)?.vel : null;
      this.rig.update(dt, {
        head, yaw: aimYaw, pitch: this.aimPitch, active: fishingActive, netPos,
        boatVel: rv ? _v.copy(rv) : _v.set(P.vx, 0, P.vz),
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
        if (n.parent !== this.scene) { n.parent?.remove(n); this.scene.add(n); }
        n.position.copy(head).add(_v.set(0, -0.6, 0));
        n.lookAt(this.rig.fish.pos.clone().add(_v.set(0, -0.15, 0)));
        n.updateMatrixWorld(true);
      } else if (this.net.object.parent === this.scene) {
        this.scene.remove(this.net.object); this.boat.object.add(this.net.object); this._restNet();
      }
    } else if (!walking) {
      const helm = this.ride ? null : this.boat.helm;
      this.angler.setHandTargets(helm?.right ? helm.right.getWorldPosition(new THREE.Vector3()) : null, helm?.left ? helm.left.getWorldPosition(new THREE.Vector3()) : null);
    }
    this.angler.update(dt);
    this.land.updateShop(dt);
    this._interactions(blocked);

    // ---- fish + world
    const here = walking ? this.land.pos : platform.object.position;
    const focus = here;
    this.fishMgr.update(dt, { pos: here.clone(), throttle: this.ride ? (this.remotes.get(this.ride.id)?.s?.th || 0) : P.throttle }, this.camera.position);
    for (const c of this.crateFish) c.model.update(dt);
    this.effects.boat(dt, P);
    this.effects.update(dt);

    // ---- camera
    if (walking) this.land.camera(this.camera, dt);
    else this._updateCamera(dt, head, aimYaw, platform);
    this.world.update(dt, this.camera, focus);
    this.world.updateReflections(this.camera.position);

    // ---- remote players
    for (const r of this.remotes.values()) r.update(dt);

    // ---- audio + HUD
    const lp = this.camera.position;
    const home = this.world.layout.homeMark || this.world.layout.docks[0];
    const villageD = home ? Math.hypot(lp.x - home.x, lp.z - home.z) : 1e9;
    this._wdT = (this._wdT || 0) - dt;
    if (this._wdT <= 0) { this._wdT = 0.5; this._wd = walking ? this._waterDist(this.land.pos) : 0; }
    this.audio.ambience(dt, { rapids: ENV.rapids(lp.x, lp.z), throttle: P.throttle, nearVillage: Math.max(0, 1 - villageD / 400), speed: P.speedOverGround, camera: this.camera, onLand: walking, waterDist: this._wd || 0, layout: this.world.layout });
    if (playing) {
      this._hudFrame(aimYaw);
      this._mmT = (this._mmT || 0) - dt;
      if (this._mmT <= 0) {
        this._mmT = 0.1;
        const others = [...this.remotes.values()].map(r => ({ x: r.pos.x, z: r.pos.z, h: r.h, color: r.color }));
        const me = walking ? { x: this.land.pos.x, z: this.land.pos.z, h: this.land.yaw } : { x: platform.object.position.x, z: platform.object.position.z, h: platformH };
        const marks = [];
        if (home) marks.push({ x: home.x, z: home.z, label: home.label || '⌂', color: '#fff' });
        for (const sh of this.land.shops) marks.push({ x: sh.frontWorld.x, z: sh.frontWorld.z, label: '$', color: '#f2c14e' });
        if (walking || this.ride) marks.push({ x: P.x, z: P.z, label: '⛵', color: '#fff' });
        this.hud.minimap(me, others, marks);
      }
    }

    // ---- network
    this.netTimer -= dt;
    if (this.network.active && this.netTimer <= 0) { this.netTimer = 0.1; this._sendState(aimYaw); }

    inp.endFrame();
  }

  // context prompts + E to act: go ashore, ride along, board, open the shop
  _interactions(blocked) {
    this._prompt = '';
    if (blocked || this.mode === 'menu') return;
    const P = this.phys;
    const inp = this.input;
    if (this.ride) {
      this._prompt = this.mode === 'fish' ? '' : 'Riding along · F to fish · G back to your boat';
      if (inp.hit('KeyG')) this._leaveRide();
      return;
    }
    if (this.mode === 'drive') {
      this._landT = (this._landT || 0) - 1;
      if (this._landT <= 0) {
        this._landT = 6;
        this._rider = P.speedOverGround < 2.5 ? this._rideCandidate() : null;
        this._landing = !this._rider && P.speedOverGround < 2.5 ? this.land.findLanding(P) : null;
      }
      if (this._rider) {
        this._prompt = `E: Hop aboard ${this._rider.info.name || 'their'}'s boat`;
        if (inp.hit('KeyE')) this._startRide(this._rider);
      } else if (this._landing) {
        this._prompt = 'E: Go ashore';
        if (inp.hit('KeyE')) { const spot = this.land.findLanding(P); if (spot) this._goAshore(spot); }
      }
    } else if (this.mode === 'walk') {
      const L = this.land;
      const dBoat = Math.hypot(L.pos.x - P.x, L.pos.z - P.z);
      if (L.nearShop()) {
        this._prompt = 'E: Open the Fischerei';
        if (inp.hit('KeyE')) L.openShop();
      } else if (dBoat < 2.5 + P.halfLen * 0.5) {
        this._prompt = 'E: Board the boat';
        if (inp.hit('KeyE')) this._board();
      }
    }
  }

  // metres from a point on land to the water's edge (coarse search in 8 directions)
  _waterDist(p) {
    let best = 400;
    for (let a = 0; a < 8; a++) {
      const dx = Math.cos(a * Math.PI / 4), dz = Math.sin(a * Math.PI / 4);
      for (let d = 0; d < best; d += 4) {
        const x = p.x + dx * d, z = p.z + dz * d;
        if (this.land.groundY(x, z) < ENV.waterLevel(x, z)) { best = d; break; }
      }
    }
    return best;
  }

  _handleKeys() {
    const inp = this.input;
    if (inp.hit('KeyU')) { this.workshop.show(); return; }
    if (inp.hit('KeyO')) { this.settings.show(); return; }
    if (this.mode === 'walk') return; // on land only E (handled in _interactions) and menus apply
    if (inp.hit('KeyF')) {
      if (this.mode === 'drive') {
        this.mode = 'fish';
        this.aimRel = this.ride ? 0 : this.camYaw - this.phys.h;
        this.aimPitch = -0.08;
        this.rig.setVisible(true);
        this.hud.notify('Fishing — hold LMB to cast. F to stop', false);
      } else if (this.rig.state === 'idle') {
        this.mode = 'drive';
        this.rig.setVisible(false);
        this.camYaw = this._platform().object.rotation.y + this.aimRel;
        this.angler.setFirstPerson?.(false);
      } else this.hud.notify('Reel in first', false);
    }
    if (inp.hit('KeyQ') && !this.ride) {
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

  _poseAngler(dt, aimYaw, platform) {
    const a = this.angler;
    let seat;
    if (this.ride) seat = platform.passengerSeats[this.ride.seat % platform.passengerSeats.length];
    else seat = this.mode === 'fish' ? platform.seats.fisher : platform.seats.driver;
    a.setStance('sit');
    if (this.mode === 'fish') {
      // sit facing bow or stern, twist the torso for the rest
      const rel = wrapPi(this.aimRel);
      // seats with a backrest can't turn round: twist further instead
      const aft = platform.seatInfo?.canFaceAft;
      const canAft = !aft ? true : this.ride ? aft.passengers?.[this.ride.seat % platform.passengerSeats.length] !== false : aft.fisher !== false;
      const facing = canAft && Math.abs(rel) > Math.PI * 0.62 ? Math.PI : 0;
      this.bodyYaw += wrapPi(facing - this.bodyYaw) * Math.min(1, dt * 4);
      placeAngler(a, platform, seat, this.bodyYaw);
      a.setLook(wrapPi(rel - this.bodyYaw), this.aimPitch);
      a.setFirstPerson?.(!this.camTP);
    } else {
      this.bodyYaw = 0;
      placeAngler(a, platform, seat, 0);
      const rel = wrapPi(this.camYaw - platform.object.rotation.y);
      a.setLook(THREE.MathUtils.clamp(rel * 0.4, -0.8, 0.8), 0);
      a.setFirstPerson?.(false);
    }
  }

  _updateCamera(dt, head, aimYaw, platform) {
    const cam = this.camera;
    const P = this.phys;
    const bp = platform.object.position;
    if (this.mode === 'menu') {
      const t = this.time * 0.035;
      cam.position.set(P.x + Math.sin(t) * 46, P.y + 11 + Math.sin(t * 1.7) * 3, P.z + Math.cos(t) * 46);
      cam.lookAt(P.x, P.y + 2, P.z + 10);
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
      const h = platform.object.rotation.y;
      this._camIdle = (this._camIdle || 0) + dt;
      if (this._camIdle > 2.5 && (Math.abs(P.throttle) > 0.15 || this.ride)) this.camYaw += wrapPi(h - this.camYaw) * Math.min(1, dt * 0.8);
      const dist = this.camDist * Math.max(1, (platform.size || 1) * 0.9 + (platform.length || 7.5) / 30);
      const want = _v.set(bp.x - Math.sin(this.camYaw) * Math.cos(this.camPitch) * dist, bp.y + 1.4 + Math.sin(this.camPitch) * dist, bp.z - Math.cos(this.camYaw) * Math.cos(this.camPitch) * dist);
      const minY = ENV.surface(want.x, want.z) + 0.8;
      if (want.y < minY) want.y = minY;
      cam.position.lerp(want, Math.min(1, dt * 10));
      cam.lookAt(bp.x, bp.y + 1.3, bp.z);
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
      else if (R.state === 'fight' && R.canNet) { prompt = R.fish?.weight > 80 ? 'Press E to gaff it' : 'Press E to net it'; pulse = true; }
      else if (R.state === 'fight' && R.tension > R.lineBreakKg * 9.81 * 0.85) { prompt = 'Line strained — ease off!'; pulse = true; }
      else if (R.state === 'idle') prompt = this.input.locked ? 'Hold left mouse to cast' : '';
      else if (R.state === 'flight') prompt = 'Space to stop the line';
    }
    if (!prompt && this._prompt) prompt = this._prompt;
    if (!this.input.locked && !this._overlay() && !this.chatOpen) prompt = 'Click to play';
    const lureDepth = R.fish ? Math.max(0, ENV.waterLevel(R.fish.pos.x, R.fish.pos.z) - R.fish.pos.y)
      : R.state === 'water' ? Math.max(0, ENV.waterLevel(R.lurePos.x, R.lurePos.z) - (R.lureType === 'float' ? R.baitPos.y : R.lurePos.y)) : 0;
    const yaw = this.mode === 'fish' ? aimYaw : this.mode === 'walk' ? this.land.camYaw : this.camYaw;
    const skipper = this.ride ? (this.remotes.get(this.ride.id)?.info.name || 'a friend') : null;
    const speedSrc = this.ride ? this.remotes.get(this.ride.id)?.vel : null;
    this.hud.frame({
      yaw,
      modeLabel: this.mode === 'walk' ? 'On foot' : skipper ? `Aboard with ${skipper}` : this.mode === 'fish' ? `Fishing · ${P.anchored ? 'anchored' : 'drifting'}` : (P.moored ? 'Moored' : P.anchored ? 'At anchor' : 'Under way'),
      walking: this.mode === 'walk', moored: !!P.moored, money: this.land.money, crate: this.land.crate.length, breakKg: R.lineBreakKg,
      prompt, promptPulse: pulse,
      speed: speedSrc ? speedSrc.length() : P.speedOverGround, throttle: P.throttle, anchored: P.anchored, current: P.flowSpeed,
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
    // the full look rides along every couple of seconds (and right after a change)
    this.netTick++;
    const lk = (this._lookDirty || this.netTick % 20 === 0) ? JSON.stringify(this.look) : undefined;
    this._lookDirty = false;
    this.network.sendState({
      b: P.serialize().map(r), th: r(P.throttle), sr: r(P.steer), an: P.anchored ? 1 : 0,
      m: this.mode === 'fish' ? 'fish' : this.mode === 'walk' ? 'walk' : 'drive', ay: r(aimYaw), ap: r(this.aimPitch), by: r(this.bodyYaw),
      r: this.rig.netState(), f, lk,
      ride: this.ride ? [this.ride.id, this.ride.seat] : null,
      w: this.mode === 'walk' ? [r(this.land.pos.x), r(this.land.pos.y), r(this.land.pos.z), r(this.land.yaw), r(this.land.phase % 6.2832), r(this.land.walkAmt)] : null,
    });
  }

  renderOverlay(dt = 1 / 60) {
    this.workshop?.draw(this.renderer, dt);
    if (!this.pendingCatch || !this.trophy.fish) return;
    const tr = this.trophy;
    const r = this.renderer;
    const w = innerWidth, h = innerHeight;
    const vw = Math.round(w * 0.6), vh = h;
    tr.t += dt;
    // side-on hero shot, gently turning
    tr.fish.object.rotation.set(Math.sin(tr.t * 0.9) * 0.06, Math.PI / 2 + Math.sin(tr.t * 0.5) * 0.55, Math.sin(tr.t * 1.3) * 0.06);
    tr.fish.setSwim(0.15, Math.sin(tr.t) * 0.3);
    tr.fish.setStruggle(0.15);
    tr.fish.update(dt);
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
