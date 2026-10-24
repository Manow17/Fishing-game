// Alpenfisch ambience: a fully synthesized, spatial soundscape for the alpine valley.
// No audio files: everything is oscillators, noise buffers, filters and envelopes, placed in the
// world with panners (HRTF for point sources), plus a generated convolution reverb and a valley echo.
//
//   const amb = new Ambience(ctx, destination);   // destination = the master gain
//   amb.update(dt, s);                             // every frame
//
// s (all optional): rapids 0..1, throttle -1..1, speed m/s, nearVillage 0..1,
//   camera (THREE camera, drives the AudioListener), onLand bool, waterDist m (0 on the water),
//   layout (world.layout: exact church / cow / chalet positions; approximated when absent).
//
// Layers
//   water   : river bed (deep body, wash, hiss, babble shimmer, rapids roar, bow wash), bubbling
//             gurgles, whitewater splashes, lapping against the hull or the shore
//   wind    : gusty breeze, low buffeting on the water, hiss through the spruce in gusts
//   birds   : a small population of singing individuals (chaffinch, blackbird, great tit, chiffchaff,
//             wren, robin) with bouts, rests and counter-singing; rare cuckoo, woodpecker, buzzard
//   insects : crickets and grasshoppers in the meadows, bees buzzing past (on land)
//   village : cowbells on the pasture, church bells, a dog or rooster, a rare far-away alphorn
// Foley for the on-land feature: footstep(surface), coins(), purchase(), shopBell().
import { centerX, halfWidth, waterY, rapids as rapidsAt } from '../world/river.js';
import { SPAWN_Z, VILLAGE_SIDE, bankX } from '../world/layout.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const chance = (p) => Math.random() < p;
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;
const sstep = (x) => x * x * (3 - 2 * x);
const expIv = (rate, lo, hi) => clamp(-Math.log(1 - Math.random()) / Math.max(1e-4, rate), lo, hi);

// Distance cues, computed per voice (panners only do direction).
const REF = 10;                                                // `power` = peak level at 10 m
const att = (d) => Math.pow(REF / Math.max(REF, d), 0.85);
const airCut = (d) => clamp(18000 / (1 + d / 90), 900, 18000); // distant sounds get duller
const wetFor = (d) => 0.1 + 0.55 * d / (d + 120);             // ... and more reverberant

// Overall ambience gain, and bed levels: calm water ~-27 dBFS RMS after the 0.8 master, rapids ~-22,
// meadows away from the water ~-34 (birds, insects and cowbells come on top).
const OUT_GAIN = 1.35;
const K = {
  deep: 0.12, body: 0.24, mid: 0.11, hiss: 0.065, shim: 0.1,
  rLow: 0.085, rMid: 0.2, rHi: 0.13, wash: 0.14,
  wLow: 0.05, wMid: 0.24, wHi: 0.04,
};

// Birdsong species: power (peak at 10 m), pause between songs (s), chance a neighbour answers.
const SONG = {
  chaffinch: { power: 0.1, gap: [6, 13], reply: 0.4 },
  blackbird: { power: 0.11, gap: [3.5, 8], reply: 0.35 },
  greattit: { power: 0.085, gap: [4, 9], reply: 0.45 },
  chiffchaff: { power: 0.08, gap: [5, 11], reply: 0.3 },
  wren: { power: 0.09, gap: [8, 16], reply: 0.4 },
  robin: { power: 0.08, gap: [3, 7], reply: 0.3 },
};

// Modal bells: [frequency ratio, amplitude, T60 seconds]; amplitudes normalized to sum 1.
const norm = (P) => { const s = P.reduce((a, p) => a + p[1], 0); return P.map(([r, a, d]) => [r, a / s, d]); };
const CAST = norm([[1, 1, 1.6], [1.59, 0.5, 1.1], [2.31, 0.62, 0.9], [2.98, 0.35, 0.6], [3.96, 0.28, 0.45], [5.13, 0.18, 0.3]]);
const SHEET = norm([[1, 0.8, 0.7], [1.47, 1, 0.55], [2.13, 0.75, 0.45], [2.76, 0.6, 0.35], [3.52, 0.45, 0.25]]);
const CHURCH = norm([[0.5, 0.42, 9], [0.5016, 0.25, 9], [1, 0.5, 6], [1.19, 0.45, 4.5], [1.5, 0.2, 3.5],
  [2, 0.75, 3.2], [2.003, 0.3, 3.2], [2.5, 0.25, 2], [3, 0.2, 1.6]]);

// Ornstein-Uhlenbeck random walk: slow, natural wandering around a mean.
class Drift {
  constructor(mean, sd, tau, lo = -Infinity, hi = Infinity) {
    Object.assign(this, { mean, sd, tau, lo, hi });
    this.v = clamp(mean + gauss() * sd * 0.5, lo, hi);
  }
  step(dt) {
    const a = Math.min(1, dt / this.tau);
    this.v = clamp(this.v + (this.mean - this.v) * a + this.sd * Math.sqrt(2 * a) * gauss(), this.lo, this.hi);
    return this.v;
  }
}

// --- envelope helpers (all click-free) ---
function env(p, t, dur, amp, a = 0.005, r = 0.02, sus = 0.85) {
  a = Math.min(a, dur * 0.4); r = Math.min(r, dur * 0.5);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(amp, t + a);
  p.linearRampToValueAtTime(amp * sus, t + dur - r);
  p.linearRampToValueAtTime(0, t + dur);
}
function glide(p, t, dur, f0, f1) {
  p.setValueAtTime(f0, t);
  p.exponentialRampToValueAtTime(f1, t + dur);
}
// percussive: smooth attack from wherever the level is, then exponential decay (tau seconds)
function strike(p, t, amp, tau, a = 0.002) {
  p.setTargetAtTime(amp, t, a / 3);
  p.setTargetAtTime(0, t + a, tau);
}

// --- generated buffers ---
function noiseBuffer(ctx, kind, seconds = 4) {
  const sr = ctx.sampleRate, len = Math.floor(sr * seconds), F = Math.floor(sr * 0.05);
  const buf = ctx.createBuffer(2, len, sr);
  const tmp = new Float32Array(len + F);
  for (let ch = 0; ch < 2; ch++) {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0, mean = 0;
    for (let i = 0; i < len + F; i++) {
      const w = Math.random() * 2 - 1;
      let v;
      if (kind === 'pink') { // Paul Kellet's refined pink filter
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
      } else if (kind === 'brown') { br = (br + 0.02 * w) / 1.02; v = br; }
      else v = w;
      tmp[i] = v; mean += v;
    }
    mean /= len + F;
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = tmp[i] - mean;
    // crossfade the overhang into the start so the loop is seamless
    for (let i = 0; i < F; i++) { const k = i / F; d[i] = (tmp[i] - mean) * k + (tmp[len + i] - mean) * (1 - k); }
    let ss = 0;
    for (let i = 0; i < len; i++) ss += d[i] * d[i];
    const s = 0.25 / Math.sqrt(ss / len);
    for (let i = 0; i < len; i++) d[i] *= s;
  }
  return buf;
}

// Outdoor space: sparse early reflections (trees, banks) and a dark, diffuse valley tail.
function reverbIR(ctx, seconds = 2.8, rt = 2.3) {
  const sr = ctx.sampleRate, len = Math.floor(sr * seconds), pre = Math.floor(sr * 0.018);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const a = Math.exp(-TAU * (600 + 8500 * Math.exp(-t * 1.8)) / sr);
      lp = a * lp + (1 - a) * (Math.random() * 2 - 1);
      d[i] = lp * Math.exp(-6.9 * t / rt) * Math.min(1, t / 0.03);
    }
    for (let k = 0; k < 7; k++) {
      const at = pre + Math.floor(sr * rand(0.012, 0.16)), amp = rand(0.15, 0.45) * (chance(0.5) ? 1 : -1);
      for (let j = 0; j < 64 && at + j < len; j++) d[at + j] += amp * Math.exp(-j / 12) * (Math.random() * 2 - 1);
    }
    let ss = 0;
    for (let i = 0; i < len; i++) ss += d[i] * d[i];
    const s = 1 / Math.sqrt(ss);
    for (let i = 0; i < len; i++) d[i] *= s;
  }
  return buf;
}

function mkWave(ctx, amps) {
  const re = new Float32Array(amps.length + 1), im = new Float32Array(amps.length + 1);
  amps.forEach((a, i) => { im[i + 1] = a; });
  return ctx.createPeriodicWave(re, im);
}

export class Ambience {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.dest = destination;
    this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    this.auto = true;      // automatic events (birds, village, water details); test pages may switch off
    this.beds = true;      // continuous river / wind beds
    this.live = [];        // voices waiting to be disconnected: { end, nodes }
    this.L = { x: 0, y: 2, z: 0, fx: 0, fz: -1 };
    this.hasWorld = false; // true once a camera gives us world coordinates
    this.layout = null;
    this.c = { land: 0, wd: 0, r: 0, spd: 0, nv: 0, bank: 30, river: 1, shore: 0, forest: 0.6, birdAct: 0.6, insects: 0 };
    this.noise = { white: noiseBuffer(ctx, 'white'), pink: noiseBuffer(ctx, 'pink'), brown: noiseBuffer(ctx, 'brown') };
    this.waves = {
      flute: mkWave(ctx, [1, 0.1, 0.035]),
      horn: mkWave(ctx, [1, 0.62, 0.45, 0.32, 0.22, 0.15, 0.1, 0.065, 0.04, 0.025]),
      raptor: mkWave(ctx, [1, 0.5, 0.32, 0.2, 0.12, 0.07]),
      buzz: mkWave(ctx, Array.from({ length: 24 }, (_, i) => (i < 6 ? 1.2 : 1) / (i + 1))),
      voice: mkWave(ctx, [1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.22, 0.16, 0.1, 0.07, 0.05]),
    };
    this._buildBus();
    this._buildBeds();
    this.dr = {
      flow: new Drift(1, 0.12, 9, 0.7, 1.3), body: new Drift(1, 0.15, 6, 0.6, 1.4), bodyF: new Drift(1, 0.12, 12, 0.7, 1.35),
      mid: new Drift(1, 0.2, 4, 0.5, 1.5), hiss: new Drift(1, 0.2, 3, 0.5, 1.5),
      shim: new Drift(1, 0.35, 1.2, 0.2, 1.8), shimF: new Drift(1, 0.18, 0.8, 0.7, 1.5),
      surge: new Drift(1, 0.25, 1.5, 0.5, 1.6), surge2: new Drift(1, 0.3, 0.7, 0.4, 1.7),
      wind: new Drift(0.35, 0.1, 25, 0.15, 0.6), windF: new Drift(1, 0.15, 5, 0.7, 1.4),
    };
    this.gust = { v: 0, phase: 0, t: rand(4, 12), k: 0, amp: 0, rise: 2, hold: 1, fall: 4 };
    this.birds = [];
    this.birdT = 0.5;
    this.chorus = new Drift(1, 0.18, 70, 0.55, 1.35);
    this.ev = { cuckoo: rand(30, 75), raptor: rand(45, 110), woodpecker: rand(20, 55), church: rand(35, 90), dog: rand(25, 70), alphorn: rand(110, 200), bee: rand(6, 20) };
    this.wt = { gurgle: 0.5, splash: 1, lap: 1, shore: 2 };
    this.lastHi = -100;    // last "highlight" (cuckoo, buzzard, church, alphorn) so they never pile up
    this.herd = null;
    this.crickets = null;
    this.rapidsZ = null;
    this._paramT = 0; this._gcT = 0; this._geoT = 0;
  }

  // ---------------------------------------------------------------- graph
  _buildBus() {
    const ctx = this.ctx, now = ctx.currentTime;
    const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    // (no DynamicsCompressor: Chrome's adds ~4 dB of automatic makeup gain; levels are set by design)
    this.out = gain(0);
    this.out.gain.setValueAtTime(0, now);
    this.out.gain.linearRampToValueAtTime(OUT_GAIN, now + 3);
    this.out.connect(this.dest);

    // shared reverb
    this.verbIn = gain(1);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 200; hp.Q.value = 0.6;
    const conv = ctx.createConvolver(); conv.normalize = false; conv.buffer = reverbIR(ctx);
    const ret = gain(0.55);
    this.verbIn.connect(hp); hp.connect(conv); conv.connect(ret); ret.connect(this.out);

    // valley echo: two distant walls, the nearer one with a little feedback
    this.echoIn = gain(1);
    const echoRet = gain(0.6);
    const tap = (time, cut, panV, fb) => {
      const d = ctx.createDelay(3); d.delayTime.value = time;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cut;
      const p = ctx.createStereoPanner(); p.pan.value = panV;
      this.echoIn.connect(d); d.connect(lp); lp.connect(p); p.connect(echoRet);
      if (fb) { const f = gain(fb); lp.connect(f); f.connect(d); }
    };
    tap(0.83, 1700, -0.55, 0.28);
    tap(1.57, 1200, 0.6, 0);
    echoRet.connect(this.out);
    const e2v = gain(0.5); echoRet.connect(e2v); e2v.connect(this.verbIn);

    this.bus = {};
    for (const k of ['water', 'wind', 'birds', 'insects', 'village', 'fx']) { this.bus[k] = gain(k === 'insects' ? 0 : 1); this.bus[k].connect(this.out); }
  }

  _buildBeds() {
    const ctx = this.ctx;
    const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const src = (buf, rate) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
      s.start(ctx.currentTime, Math.random() * (buf.duration - 0.1)); return s;
    };
    const brown = src(this.noise.brown, rand(0.9, 1.1)), pinkA = src(this.noise.pink, rand(0.94, 1.06));
    const pinkB = src(this.noise.pink, rand(0.8, 0.88)), white = src(this.noise.white, 1);

    // the river bed: surround while afloat, panned toward the water when on land
    this.riverIn = gain(1);
    this.riverLP = ctx.createBiquadFilter(); this.riverLP.type = 'lowpass'; this.riverLP.frequency.value = 14000; this.riverLP.Q.value = 0.5;
    this.riverSur = gain(1); this.riverShore = gain(0);
    this.shorePan = this._panner(false);
    this.riverIn.connect(this.riverLP);
    this.riverLP.connect(this.riverSur); this.riverSur.connect(this.bus.water);
    this.riverLP.connect(this.riverShore); this.riverShore.connect(this.shorePan); this.shorePan.connect(this.bus.water);
    const rv = gain(0.1); this.riverLP.connect(rv); rv.connect(this.verbIn);
    const wv = gain(0.08); this.bus.wind.connect(wv); wv.connect(this.verbIn);

    const layer = (s, type, f, q, dest = this.riverIn) => {
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = gain(0); s.connect(fl); fl.connect(g); g.connect(dest); return { f: fl, g };
    };
    this.layers = {
      deep: layer(brown, 'lowpass', 170, 0.6),       // the deep body of a big glacial river
      body: layer(pinkA, 'bandpass', 480, 0.8),      // main rushing
      mid: layer(pinkA, 'bandpass', 1150, 0.9),      // wash
      hiss: layer(white, 'bandpass', 3600, 0.55),    // surface hiss
      shim: layer(pinkA, 'bandpass', 2600, 3.2),     // narrow, wandering babble
      rLow: layer(brown, 'lowpass', 420, 0.7),       // rapids roar
      rMid: layer(white, 'bandpass', 1000, 0.6),
      rHi: layer(white, 'bandpass', 2900, 0.8),
      wash: layer(pinkB, 'bandpass', 900, 0.6, this.bus.water),   // bow wash under way
      wLow: layer(pinkB, 'lowpass', 260, 0.7, this.bus.wind),     // breeze buffeting
      wMid: layer(pinkB, 'bandpass', 600, 0.9, this.bus.wind),    // breeze
      wHi: layer(white, 'bandpass', 4200, 0.6, this.bus.wind),    // gusts hissing through spruce
    };
  }

  _panner(hrtf) {
    const p = this.ctx.createPanner();
    p.panningModel = hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'linear'; p.refDistance = 1; p.maxDistance = 10000; p.rolloffFactor = 0; // we do distance ourselves
    return p;
  }

  _setPos(p, q) {
    if (p.positionX) { p.positionX.value = q.x; p.positionY.value = q.y; p.positionZ.value = q.z; }
    else p.setPosition(q.x, q.y, q.z);
  }

  // A one-shot spatial voice: input(env) -> air lowpass -> panner -> dry -> bus, plus reverb / echo sends.
  _voice(pos, o = {}) {
    const ctx = this.ctx;
    const d = Math.max(0.5, Math.hypot(pos.x - this.L.x, pos.y - this.L.y, pos.z - this.L.z));
    const input = ctx.createGain(); input.gain.value = o.gain ?? 0;
    const air = ctx.createBiquadFilter(); air.type = 'lowpass'; air.Q.value = 0.5; air.frequency.value = airCut(d);
    const pan = this._panner(o.hrtf !== false); this._setPos(pan, pos);
    const lvl = (o.power ?? 0.05) * att(d);
    const wet = o.wet ?? wetFor(d);
    const dry = ctx.createGain(); dry.gain.value = lvl * (1 - 0.45 * wet);
    input.connect(air); air.connect(pan); pan.connect(dry); dry.connect(o.bus || this.bus.fx);
    const nodes = [input, air, pan, dry];
    if (wet > 0) { const s = ctx.createGain(); s.gain.value = lvl * wet; air.connect(s); s.connect(this.verbIn); nodes.push(s); }
    if (o.echo) { const e = ctx.createGain(); e.gain.value = lvl * o.echo; air.connect(e); e.connect(this.echoIn); nodes.push(e); }
    return { input, env: input.gain, air, pan, dry, d, nodes, srcs: [] };
  }

  // Non-spatial voice straight into the destination (foley).
  _fxv() { const g = this.ctx.createGain(); g.connect(this.dest); return { input: g, env: g.gain, nodes: [g], srcs: [] }; }

  _osc(v, type, f, t, dest = v.input) {
    const o = this.ctx.createOscillator();
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.value = f;
    if (dest) o.connect(dest);
    o.start(t);
    v.nodes.push(o); v.srcs.push(o);
    return o;
  }
  _noise(v, kind, t, dest = v.input) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise[kind]; s.loop = true;
    if (dest) s.connect(dest);
    s.start(t, Math.random() * 3.5);
    v.nodes.push(s); v.srcs.push(s);
    return s;
  }
  _filter(v, type, f, q) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; v.nodes.push(b); return b; }
  _gain(v, val) { const g = this.ctx.createGain(); g.gain.value = val; v.nodes.push(g); return g; }
  // one oscillator that stops on its own (bell partials, coin clinks)
  _ping(v, f, t, stop, dest) {
    const o = this.ctx.createOscillator(); o.frequency.value = f; o.connect(dest); o.start(t); o.stop(stop);
    v.nodes.push(o); return o;
  }

  _retire(v, end) {
    for (const s of v.srcs) { try { s.stop(end); } catch (e) { /* already scheduled */ } }
    this.live.push({ end: end + 0.2, nodes: v.nodes });
  }

  _sweep(now) {
    let w = 0;
    for (const e of this.live) {
      if (e.end < now) { for (const n of e.nodes) { try { n.disconnect(); } catch (er) { /* fine */ } } }
      else this.live[w++] = e;
    }
    this.live.length = w;
  }

  // ---------------------------------------------------------------- per frame
  update(dt, s = {}) {
    const ctx = this.ctx;
    if (!this.offline && ctx.state !== 'running') return;
    dt = clamp(dt || 0, 0, 0.25);
    const now = ctx.currentTime;
    this._listener(s.camera);
    this._context(dt, s);
    if ((this._paramT -= dt) <= 0) { this._paramT = 0.1; this._mix(now); }
    if ((this._gcT -= dt) <= 0) { this._gcT = 0.25; this._sweep(now); }
    if (!this.auto) return;
    this._waterLife(dt, now);
    this._birdLife(dt, now);
    this._rare(dt, now);
    this._insectLife(dt, now);
    this._herdLife(dt, now);
  }

  setVolume(v) { this.out.gain.setTargetAtTime(v * OUT_GAIN, this.ctx.currentTime, 0.3); } // 0..1

  _listener(cam) {
    if (!cam || !cam.matrixWorld) return;
    const e = cam.matrixWorld.elements;
    const x = e[12], y = e[13], z = e[14];
    let fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
    const fl = Math.hypot(fx, fy, fz) || 1, ul = Math.hypot(ux, uy, uz) || 1;
    fx /= fl; fy /= fl; fz /= fl; ux /= ul; uy /= ul; uz /= ul;
    const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
      L.upX.value = ux; L.upY.value = uy; L.upZ.value = uz;
    } else {
      L.setPosition(x, y, z); L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
    Object.assign(this.L, { x, y, z, fx, fz });
    this.hasWorld = true;
  }

  _context(dt, s) {
    const c = this.c, L = this.L;
    const k = (tau) => 1 - Math.exp(-dt / tau);
    c.land += ((s.onLand ? 1 : 0) - c.land) * k(1.2);
    c.wd += (Math.max(0, s.waterDist || 0) - c.wd) * k(0.6);
    c.r += ((s.rapids || 0) - c.r) * k(0.6);
    c.spd += (Math.abs(s.speed || 0) - c.spd) * k(0.5);
    c.nv += ((s.nearVillage || 0) - c.nv) * k(1);
    if (s.layout && s.layout !== this.layout) this.layout = s.layout;

    if (this.hasWorld) {
      const lat = L.x - centerX(L.z);
      c.bank = Math.max(0, halfWidth(L.z) - Math.abs(lat));
      if ((this._geoT -= dt) <= 0) { // where are the nearest rapids?
        this._geoT = 1;
        let best = 0, bz = null;
        for (let dz = -300; dz <= 300; dz += 15) { const r = rapidsAt(L.z + dz); if (r > best) { best = r; bz = L.z + dz; } }
        this.rapidsZ = best > 0.05 ? bz : null;
      }
    } else c.bank = 30;

    c.river = 0.05 + 0.95 / (1 + Math.pow(c.wd * c.land / 20, 1.3));
    c.shore = c.land * Math.exp(-c.wd / 9);
    const nearBank = Math.exp(-c.bank / 22);
    c.forest = c.land + (1 - c.land) * (0.35 + 0.65 * nearBank);
    c.birdAct = (c.land + (1 - c.land) * (0.35 + 0.55 * nearBank)) * (1 - 0.35 * c.r);

    // gusts: rise, hold, die away, rest
    const G = this.gust;
    if (G.phase === 0) {
      G.v = 0;
      if ((G.t -= dt) <= 0) Object.assign(G, { phase: 1, k: 0, amp: rand(0.3, 1), rise: rand(1.5, 4), hold: rand(0.5, 3), fall: rand(3, 8) });
    } else {
      G.k += dt;
      let e;
      if (G.k < G.rise) e = sstep(G.k / G.rise);
      else if (G.k < G.rise + G.hold) e = 1;
      else if (G.k < G.rise + G.hold + G.fall) e = 1 - sstep((G.k - G.rise - G.hold) / G.fall);
      else { e = 0; G.phase = 0; G.t = rand(5, 25); }
      G.v = G.amp * e;
    }
    c.insects = c.land * (1 - 0.6 * c.r) * (1 - 0.5 * G.v);
  }

  // continuous beds, 10x per second
  _mix(now) {
    const c = this.c, D = this.dr, Ly = this.layers;
    for (const k in D) D[k].step(0.1);
    const T = (p, v, tau = 0.35) => p.setTargetAtTime(v, now, tau);
    const on = this.beds ? 1 : 0, R = c.river * on, r = c.r, onW = 1 - c.land;
    const flow = D.flow.v;
    T(Ly.deep.g.gain, K.deep * R * flow * (0.85 + 0.25 * r));
    T(Ly.body.g.gain, K.body * R * flow * D.body.v * (1 + 0.3 * r));
    T(Ly.body.f.frequency, 480 * D.bodyF.v * (1 + 0.25 * r), 0.8);
    T(Ly.mid.g.gain, K.mid * R * D.mid.v * (0.7 + 0.3 * onW + 0.5 * r));
    T(Ly.hiss.g.gain, K.hiss * Math.pow(R, 1.4) * D.hiss.v * (1 + 0.9 * r));
    const babble = onW * (0.6 + 0.4 * Math.exp(-c.bank / 15)) + c.shore; // trickles near banks and shores
    T(Ly.shim.g.gain, K.shim * R * babble * D.shim.v * (1 + r), 0.12);
    T(Ly.shim.f.frequency, 2600 * D.shimF.v, 0.12);
    const rr = Math.pow(r, 1.4) * R;
    T(Ly.rLow.g.gain, K.rLow * rr * D.surge.v, 0.25);
    T(Ly.rMid.g.gain, K.rMid * rr * D.surge2.v, 0.2);
    T(Ly.rHi.g.gain, K.rHi * rr * (0.5 + 0.5 * D.surge2.v) * D.surge.v, 0.2);
    T(Ly.wash.g.gain, K.wash * on * onW * Math.pow(Math.min(1, c.spd / 7), 1.5), 0.3);
    // away from the water: quieter (river), duller, and coming from the water's direction
    T(this.riverLP.frequency, clamp(14000 / (1 + c.wd * c.land / 18), 700, 14000), 0.5);
    T(this.riverSur.gain, onW, 0.5);
    T(this.riverShore.gain, c.land, 0.5);
    if (c.land > 0.01) this._setPos(this.shorePan, this._waterEdge());

    const g = this.gust.v, base = D.wind.v, app = Math.min(0.6, c.spd / 14); // apparent wind under way
    T(Ly.wLow.g.gain, K.wLow * on * ((base + 0.6 * g) * (0.5 + 0.6 * onW) + app), 0.4);
    T(Ly.wMid.g.gain, K.wMid * on * (base + 0.7 * g + 0.6 * app), 0.4);
    T(Ly.wMid.f.frequency, (380 + 700 * g) * D.windF.v, 0.6);
    T(Ly.wHi.g.gain, K.wHi * on * c.forest * Math.pow(g, 1.5), 0.5);
    T(Ly.wHi.f.frequency, 3200 + 2400 * g, 0.6);
    T(this.bus.insects.gain, c.insects, 0.8);
  }

  // ---------------------------------------------------------------- places
  _ground() { return this.c.land > 0.5 ? this.L.y - 1.7 : (this.hasWorld ? waterY(this.L.z) : this.L.y - 2); }

  _forestPoint(minD, maxD, hMin = 3, hMax = 16) {
    const L = this.L, gy = this._ground();
    for (let i = 0; i < 8; i++) {
      let x, z;
      if (this.hasWorld && this.c.land < 0.5) { // afloat: in the trees along either bank
        z = L.z + rand(-maxD, maxD);
        x = centerX(z) + (chance(0.5) ? -1 : 1) * (halfWidth(z) + rand(2, 50));
      } else {
        const a = rand(0, TAU), d = rand(minD, maxD);
        x = L.x + Math.cos(a) * d; z = L.z + Math.sin(a) * d;
        if (this.hasWorld && Math.abs(x - centerX(z)) < halfWidth(z) + 3) continue; // not over the river
      }
      const d = Math.hypot(x - L.x, z - L.z);
      if (d < minD || d > maxD) continue;
      return { x, y: gy + rand(hMin, hMax) + d * 0.05, z };
    }
    const a = rand(0, TAU), d = rand(minD, maxD);
    return { x: L.x + Math.cos(a) * d, y: gy + rand(hMin, hMax), z: L.z + Math.sin(a) * d };
  }

  _skyPoint(minD, maxD, hMin, hMax, a = rand(0, TAU)) {
    const L = this.L, d = rand(minD, maxD);
    return { x: L.x + Math.cos(a) * d, y: L.y + rand(hMin, hMax), z: L.z + Math.sin(a) * d };
  }

  _waterEdge() {
    const L = this.L;
    if (this.hasWorld) {
      const cx = centerX(L.z), hw = halfWidth(L.z), side = L.x >= cx ? 1 : -1;
      return { x: cx + side * hw, y: waterY(L.z), z: L.z, toward: -side };
    }
    return { x: L.x + Math.max(2, this.c.wd), y: L.y - 2, z: L.z, toward: 1 }; // village bank is west, water east
  }

  _waterPoint(minD, maxD) {
    const L = this.L;
    if (this.c.land > 0.5) {
      const e = this._waterEdge();
      return { x: e.x + e.toward * rand(1, 12), y: e.y, z: e.z + rand(-18, 18) };
    }
    const a = rand(0, TAU), d = rand(minD, maxD), z = L.z + Math.sin(a) * d;
    let x = L.x + Math.cos(a) * d;
    if (this.hasWorld) { const cx = centerX(z), hw = halfWidth(z) - 2; x = clamp(x, cx - hw, cx + hw); }
    return { x, y: this.hasWorld ? waterY(z) : L.y - 2.5, z };
  }

  _hullPoint() {
    const L = this.L, a = Math.atan2(L.fz, L.fx) + rand(-2, 2), d = rand(2, 5);
    return { x: L.x + Math.cos(a) * d, y: this.hasWorld ? waterY(L.z) : L.y - 2.5, z: L.z + Math.sin(a) * d };
  }

  _rapidsPoint() {
    if (this.hasWorld && this.rapidsZ !== null) {
      const z = this.rapidsZ + rand(-35, 35);
      return { x: centerX(z) + rand(-0.7, 0.7) * halfWidth(z), y: waterY(z), z };
    }
    return this._waterPoint(10, 50);
  }

  _villageC() {
    if (this.hasWorld) return { x: bankX(SPAWN_Z, VILLAGE_SIDE, 90), y: waterY(SPAWN_Z) + 10, z: SPAWN_Z };
    const L = this.L, d = 60 + (1 - this.c.nv) * 340;
    return { x: L.x - d, y: L.y + 5, z: L.z };
  }

  _churchPos() {
    const ch = this.layout && this.layout.church;
    if (ch) return { x: ch.x, y: (ch.y || 0) + 14, z: ch.z };
    if (this.hasWorld) { const z = SPAWN_Z - 100; return { x: bankX(z, VILLAGE_SIDE, 130), y: waterY(z) + 26, z }; }
    const v = this._villageC();
    return { x: v.x - 40, y: v.y + 15, z: v.z - 60 };
  }

  _villageSpot() {
    const vc = this._villageC(), ch = this.layout && this.layout.chalets;
    if (ch && ch.length) {
      const near = ch.filter((p) => Math.hypot(p.x - vc.x, p.z - vc.z) < 450);
      if (near.length) { const p = pick(near); return { x: p.x + rand(-8, 8), y: (p.y || vc.y) + 1, z: p.z + rand(-8, 8) }; }
    }
    return { x: vc.x + rand(-70, 70), y: vc.y, z: vc.z + rand(-120, 120) };
  }

  _dist(p) { return Math.hypot(p.x - this.L.x, p.y - this.L.y, p.z - this.L.z); }

  // ---------------------------------------------------------------- water details
  _waterLife(dt, now) {
    const c = this.c, W = this.wt, onW = 1 - c.land, R = c.river;
    const busy = this.live.length > 40;
    const gRate = R * (onW * (0.6 + 1.6 * c.r) + 0.9 * c.shore);
    if ((W.gurgle -= dt) <= 0) {
      W.gurgle = expIv(gRate, 0.12, 20);
      if (gRate > 0.05 && !busy) this._gurgle(this._waterPoint(4, 35), 0.05 * (0.7 + 0.4 * c.r));
    }
    const sRate = 2.4 * Math.pow(c.r, 1.5) * R;
    if ((W.splash -= dt) <= 0) {
      W.splash = expIv(sRate, 0.1, 20);
      if (sRate > 0.08 && !busy) this._splash(this._rapidsPoint(), 0.14);
    }
    const lRate = onW * (0.45 + 0.35 * Math.min(1, c.spd / 5) + 0.5 * c.r);
    if ((W.lap -= dt) <= 0) {
      W.lap = rand(0.7, 2.6) / Math.max(0.3, lRate);
      if (onW > 0.3 && !busy) this._lap(this._hullPoint(), 0.1 * onW, irand(1, 3));
    }
    if ((W.shore -= dt) <= 0) {
      W.shore = rand(1.2, 4);
      if (c.shore > 0.03 && !busy) this._lap(this._waterPoint(1, 10), 0.1, irand(2, 4), true);
    }
  }

  // bubbles: sine blips with rising pitch, the classic sound of babbling water
  _gurgle(pos, power) {
    const v = this._voice(pos, { power, hrtf: false, bus: this.bus.water, wet: 0.12 });
    let t = this.ctx.currentTime + 0.03;
    const o = this._osc(v, 'sine', 600, t), f = o.frequency, g = v.env;
    const n = irand(2, 8), size = rand(0.7, 1.4);
    for (let i = 0; i < n; i++) {
      const f0 = rand(260, 1100) / size, d = rand(0.02, 0.06) * size;
      glide(f, t, d, f0, f0 * rand(1.5, 2.4));
      g.setValueAtTime(0, t); g.linearRampToValueAtTime(rand(0.4, 1), t + 0.003); g.setTargetAtTime(0, t + 0.003, d * 0.35);
      t += d + rand(0.01, 0.16);
    }
    this._retire(v, t + 0.1);
  }

  _splash(pos, power) {
    const v = this._voice(pos, { power, hrtf: false, bus: this.bus.water, wet: 0.2 });
    const t = this.ctx.currentTime + 0.03;
    const f0 = rand(900, 2600), bp = this._filter(v, 'bandpass', f0, rand(0.6, 1.1)), mk = this._gain(v, 6);
    bp.connect(mk); mk.connect(v.input);
    this._noise(v, 'white', t, bp);
    const at = rand(0.02, 0.08), tau = rand(0.1, 0.3);
    strike(v.env, t, 1, tau, at);
    bp.frequency.setTargetAtTime(f0 * 0.6, t + at, tau * 2);
    this._retire(v, t + at + tau * 6);
  }

  // water slapping the hull (or the shore): resonant low "bloop" with an occasional little splash
  _lap(pos, power, n = 1, shore = false) {
    const v = this._voice(pos, { power, bus: this.bus.water, wet: 0.08 });
    const t0 = this.ctx.currentTime + 0.03;
    const lp = this._filter(v, 'lowpass', 800, shore ? 1.2 : 3); lp.connect(v.input);
    const src = this._noise(v, 'pink', t0, lp);
    let splash = null;
    if (shore || chance(0.45)) {
      const bp = this._filter(v, 'bandpass', rand(1800, 3200), 1.2), sg = this._gain(v, 0);
      src.connect(bp); bp.connect(sg); sg.connect(v.input); splash = sg.gain;
    }
    let t = t0;
    for (let i = 0; i < n; i++) {
      const a = rand(0.6, 1), at = rand(0.03, 0.07), tau = rand(0.06, 0.13);
      lp.frequency.setValueAtTime(shore ? rand(1300, 1900) : rand(600, 900), t);
      lp.frequency.exponentialRampToValueAtTime(shore ? rand(450, 650) : rand(200, 300), t + at + tau * 3);
      strike(v.env, t, a, tau, at);
      if (splash) strike(splash, t + at * 0.7, (shore ? 0.5 : 0.25) * a, 0.035, 0.005);
      t += rand(0.35, 0.8);
    }
    this._retire(v, t + 0.4);
  }

  // ---------------------------------------------------------------- birds
  _birdLife(dt, now) {
    const c = this.c, L = this.L;
    this.chorus.step(dt);
    const target = Math.round(clamp(1 + 6 * c.birdAct * this.chorus.v, 1, 8));
    if ((this.birdT -= dt) <= 0) {
      this.birdT = rand(1.5, 5);
      if (this.birds.length < target) this.birds.push(this._newBird(this._pickSpecies()));
    }
    let singing = 0;
    for (const b of this.birds) if (b.until > now) singing++;
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      if (b.until > now) continue;
      if ((b.timer -= dt) > 0) continue;
      if (Math.hypot(b.pos.x - L.x, b.pos.z - L.z) > 240 || (this.birds.length > target && chance(0.5))) { this.birds.splice(i, 1); continue; }
      if (singing >= 3 || this.live.length > 32) { b.timer = rand(0.8, 2.5); continue; }
      const end = this._sing(b, now + 0.03);
      singing++;
      b.until = end;
      const sp = SONG[b.sp];
      let gap = rand(sp.gap[0], sp.gap[1]) / this.chorus.v;
      b.bout -= (end - now) + gap;
      if (b.bout <= 0) { gap += rand(20, 75); b.bout = rand(40, 150); } // a rest between bouts
      b.timer = gap;
      if (chance(sp.reply)) { // a neighbour of the same species answers
        const r = this.birds.find((o) => o !== b && o.sp === b.sp && o.until < now);
        if (r) r.timer = Math.min(r.timer, (end - now) + rand(0.4, 1.8));
      }
    }
  }

  _pickSpecies() {
    const nv = this.c.nv, land = this.c.land;
    const count = {};
    for (const b of this.birds) count[b.sp] = (count[b.sp] || 0) + 1;
    const lone = this.birds.filter((b) => count[b.sp] === 1);
    if (lone.length && chance(0.35)) return pick(lone).sp; // pairs make counter-singing (but no flocks)
    const W = [['chaffinch', 1.1 - 0.4 * nv], ['blackbird', 0.6 + 0.8 * nv], ['greattit', 0.75],
      ['chiffchaff', 0.6 - 0.2 * nv], ['wren', (0.45 - 0.2 * nv) * (land > 0.5 ? 1 : 1.4)], ['robin', 0.5]];
    for (const w of W) if (count[w[0]] >= 2) w[1] *= 0.15; // a third of the same kind is rare
    let s = 0;
    for (const w of W) s += w[1];
    let x = Math.random() * s;
    for (const w of W) { if ((x -= w[1]) <= 0) return w[0]; }
    return 'chaffinch';
  }

  _newBird(sp, pos) {
    const pm = rand(0.94, 1.06);
    const b = { sp, pm, pos: pos || this._forestPoint(15, this.c.land > 0.5 ? 85 : 95), timer: rand(0.5, 6), bout: rand(40, 150), until: 0 };
    if (sp === 'chaffinch') Object.assign(b, { top: rand(5600, 6400), k2: rand(0.66, 0.74), k3: rand(0.5, 0.56) });
    else if (sp === 'blackbird') Object.assign(b, this._blackbirdMotifs(pm));
    else if (sp === 'greattit') {
      const tri = chance(0.3), hi = rand(5000, 6600);
      Object.assign(b, { hi, lo: hi * rand(0.56, 0.68), tri, per: (tri ? 0.36 : 0.28) * rand(1, 1.12) });
    } else if (sp === 'chiffchaff') {
      const base = rand(4000, 4600);
      b.levels = chance(0.5) ? [base, base * rand(1.15, 1.25)] : [base * 0.9, base, base * rand(1.15, 1.25)];
      b.per = rand(0.3, 0.42);
    }
    return b;
  }

  _sing(b, t) {
    const v = this._voice(b.pos, { power: SONG[b.sp].power * rand(0.8, 1.1), bus: this.bus.birds });
    const end = this['_song_' + b.sp](v, t, b);
    this._retire(v, end + 0.05);
    return end;
  }

  // Chaffinch: a bright descending run of "chip"s, a lower rattle, and the "chi-chu-weeoo" flourish.
  _song_chaffinch(v, t, b) {
    const f = this._osc(v, 'sine', 5000, t).frequency, g = v.env, top = b.top * rand(0.98, 1.02);
    let n = irand(6, 9), step = rand(0.1, 0.12);
    for (let i = 0; i < n; i++) {
      const ff = top * (1 - i * 0.02);
      glide(f, t, 0.05, ff * 1.06, ff * 0.78); env(g, t, 0.05, 0.5 + 0.5 * i / n, 0.004, 0.012);
      t += step; step *= 0.975;
    }
    const mid = top * b.k2;
    n = irand(4, 7);
    for (let i = 0; i < n; i++) { glide(f, t, 0.042, mid * 1.15, mid * 0.82); env(g, t, 0.042, 1, 0.003, 0.012); t += 0.075; }
    const low = top * b.k3;
    n = irand(2, 3);
    for (let i = 0; i < n; i++) { glide(f, t, 0.065, low * 1.2, low * 0.88); env(g, t, 0.065, 0.95, 0.004, 0.015); t += 0.1; }
    t += 0.03;
    glide(f, t, 0.05, low, top * 0.75); env(g, t, 0.05, 0.85, 0.004, 0.012);
    t += 0.07;
    f.setValueAtTime(top * 0.93, t); f.exponentialRampToValueAtTime(top * 1.02, t + 0.04); f.exponentialRampToValueAtTime(low * 0.8, t + 0.24);
    env(g, t, 0.24, 1, 0.006, 0.06, 0.9);
    return t + 0.26;
  }

  _blackbirdMotifs(pm) {
    const base = rand(1700, 2300) * pm, motifs = [];
    for (let m = 0; m < 4; m++) {
      const n = irand(3, 6), notes = [];
      let ff = base * rand(0.85, 1.15);
      for (let i = 0; i < n; i++) {
        ff = clamp(ff * pick([0.8, 0.84, 0.89, 1, 1.12, 1.19, 1.26, 1.33]), 1250, 3300);
        const f1 = ff * pick([1, 0.92, 1.08, 0.85, 1.15, 1]);
        notes.push({ f0: ff, f1, dur: rand(0.07, 0.24), gap: rand(0.02, 0.08), a: rand(0.6, 1) });
        ff = f1;
      }
      motifs.push(notes);
    }
    return { base, motifs };
  }

  // Blackbird: mellow fluty motifs (each bird has its own repertoire), often a squeaky twitter at the end.
  _song_blackbird(v, t, b) {
    const f = this._osc(v, this.waves.flute, 2000, t).frequency, g = v.env;
    const lfo = this._osc(v, 'sine', rand(16, 24), t, null), lg = this._gain(v, 0);
    lfo.connect(lg); lg.connect(f);
    if (chance(0.3)) { const fi = b.base * rand(0.75, 0.85); glide(f, t, 0.12, fi, fi * 0.95); env(g, t, 0.12, 0.45, 0.02, 0.04); t += 0.2; }
    const motifs = [pick(b.motifs)];
    if (chance(0.5)) motifs.push(pick(b.motifs));
    for (const m of motifs) {
      for (const nt of m) {
        const k = rand(0.985, 1.015);
        glide(f, t, nt.dur, nt.f0 * k, nt.f1 * k);
        lg.gain.setValueAtTime(nt.dur > 0.13 ? nt.f0 * 0.012 : 0, t);
        env(g, t, nt.dur, nt.a, 0.012, 0.03, 0.8);
        t += nt.dur + nt.gap;
      }
      t += rand(0.05, 0.15);
    }
    if (chance(0.65)) {
      const n = irand(3, 8), tw = rand(4200, 6500);
      lg.gain.setValueAtTime(0, t);
      for (let i = 0; i < n; i++) {
        const ff = tw * rand(0.85, 1.2), d = rand(0.025, 0.05);
        glide(f, t, d, ff, ff * rand(0.7, 1.3)); env(g, t, d, rand(0.18, 0.35), 0.003, 0.01);
        t += d + rand(0.015, 0.04);
      }
    }
    return t + 0.05;
  }

  // Great tit: "tea-cher tea-cher tea-cher".
  _song_greattit(v, t, b) {
    const f = this._osc(v, 'sine', b.hi, t).frequency, g = v.env;
    const reps = irand(3, 7);
    for (let i = 0; i < reps; i++) {
      glide(f, t, 0.075, b.hi * 1.03, b.hi * 0.94); env(g, t, 0.075, 0.85, 0.004, 0.015);
      glide(f, t + 0.1, 0.11, b.lo * 1.06, b.lo * 0.95); env(g, t + 0.1, 0.11, 1, 0.006, 0.025);
      if (b.tri) { glide(f, t + 0.235, 0.06, b.lo * 1.25, b.lo * 1.15); env(g, t + 0.235, 0.06, 0.6, 0.004, 0.015); }
      t += b.per * rand(0.97, 1.03);
    }
    return t;
  }

  // Chiffchaff ("Zilpzalp"): irregular steps between two or three pitches.
  _song_chiffchaff(v, t, b) {
    const f = this._osc(v, 'sine', 5000, t).frequency, g = v.env;
    const n = irand(6, 14);
    let last = -1;
    for (let i = 0; i < n; i++) {
      let k = irand(0, b.levels.length - 1);
      if (k === last && chance(0.7)) k = (k + 1) % b.levels.length;
      last = k;
      const ff = b.levels[k] * rand(0.98, 1.02);
      glide(f, t, 0.075, ff * 1.12, ff * 0.86); env(g, t, 0.075, rand(0.75, 1), 0.005, 0.02);
      t += b.per * rand(0.88, 1.15);
    }
    return t;
  }

  // Wren: loud, rapid sections of repeated syllables with one fast trill.
  _song_wren(v, t, b) {
    const f = this._osc(v, 'sine', 5000, t).frequency, g = v.env;
    const lfo = this._osc(v, 'sine', 48, t, null), lg = this._gain(v, 0);
    lfo.connect(lg); lg.connect(f);
    const secs = irand(5, 8), trillAt = irand(2, secs - 2);
    for (let s = 0; s < secs; s++) {
      const base = rand(3300, 7200) * b.pm;
      if (s === trillAt) {
        const d = rand(0.35, 0.6);
        lfo.frequency.setValueAtTime(rand(38, 55), t);
        lg.gain.setValueAtTime(base * 0.13, t); lg.gain.setValueAtTime(0, t + d);
        f.setValueAtTime(base, t); f.linearRampToValueAtTime(base * 0.92, t + d);
        env(g, t, d, 1, 0.01, 0.02, 0.95);
        t += d + 0.04;
        continue;
      }
      const type = irand(0, 2), n = irand(3, 9), sd = rand(0.022, 0.04), gap = rand(0.016, 0.034), a = rand(0.75, 1);
      for (let k = 0; k < n; k++) {
        if (type === 0) glide(f, t, sd, base * 1.25, base * 0.8);
        else if (type === 1) glide(f, t, sd, base * 0.8, base * 1.2);
        else { f.setValueAtTime(base * 0.85, t); f.linearRampToValueAtTime(base * 1.2, t + sd * 0.5); f.linearRampToValueAtTime(base * 0.9, t + sd); }
        env(g, t, sd, a, 0.003, 0.008, 0.9);
        t += sd + gap;
      }
      t += rand(0.02, 0.07);
    }
    return t;
  }

  // Robin: wistful, varied — sweet slides, liquid trills, thin high notes, soft then stronger.
  _song_robin(v, t, b) {
    const f = this._osc(v, 'sine', 4000, t).frequency, g = v.env;
    const segs = irand(4, 7);
    let a = rand(0.35, 0.55);
    for (let s = 0; s < segs; s++) {
      const kind = irand(0, 2);
      if (kind === 0) {
        const d = rand(0.1, 0.26), f0 = rand(2600, 7500) * b.pm, f1 = clamp(f0 * rand(0.6, 1.6), 2200, 8500);
        glide(f, t, d, f0, f1); env(g, t, d, a, 0.015, 0.04, 0.85);
        t += d + rand(0.03, 0.09);
      } else if (kind === 1) {
        const n = irand(5, 12), d = rand(0.02, 0.032), fa = rand(3500, 6500) * b.pm, fb = fa * rand(1.12, 1.35);
        for (let k = 0; k < n; k++) { const ff = k % 2 ? fb : fa; glide(f, t, d, ff, ff * 0.93); env(g, t, d, a, 0.003, 0.008); t += d + 0.008; }
        t += rand(0.03, 0.08);
      } else {
        const n = irand(2, 4);
        for (let k = 0; k < n; k++) {
          const ff = rand(5000, 8000) * b.pm, d = rand(0.05, 0.1);
          glide(f, t, d, ff, ff * rand(0.95, 1.05)); env(g, t, d, a * 0.7, 0.008, 0.02);
          t += d + rand(0.03, 0.07);
        }
      }
      a = clamp(a + rand(-0.15, 0.3), 0.3, 1);
    }
    return t;
  }

  // Cuckoo: "cu-ckoo", hollow and far away, echoing off the valley.
  _cuckoo(now) {
    const v = this._voice(this._forestPoint(130, 320, 4, 25), { power: 0.3, bus: this.bus.birds, echo: 0.18 });
    let t = now + 0.05;
    const f = this._osc(v, this.waves.flute, 700, t).frequency, g = v.env;
    const f1 = rand(640, 720), f2 = f1 * rand(0.79, 0.85), per = rand(0.85, 1.05), reps = irand(4, 10);
    for (let i = 0; i < reps; i++) {
      f.setValueAtTime(f1 * 1.02, t); f.linearRampToValueAtTime(f1 * 0.99, t + 0.16);
      env(g, t, 0.16, 0.9, 0.025, 0.05, 0.85);
      f.setValueAtTime(f2 * 1.01, t + 0.3); f.linearRampToValueAtTime(f2 * 0.97, t + 0.56);
      env(g, t + 0.3, 0.26, 1, 0.03, 0.09, 0.8);
      t += per * rand(0.97, 1.04);
    }
    this._retire(v, t + 0.2);
  }

  // Great spotted woodpecker drumming on a hollow spruce.
  _woodpecker(now) {
    const v = this._voice(this._forestPoint(35, 120, 4, 14), { power: 0.3, bus: this.bus.birds, echo: 0.12 });
    let t = now + 0.05;
    this._osc(v, 'triangle', rand(650, 950), t); // the hollow trunk
    const bp = this._filter(v, 'bandpass', rand(1500, 2100), 1.2), ng = this._gain(v, 2.5);
    bp.connect(ng); ng.connect(v.input);
    this._noise(v, 'white', t, bp);
    const drums = chance(0.6) ? 1 : irand(2, 3);
    v.env.setValueAtTime(0, t);
    for (let d = 0; d < drums; d++) {
      const hits = irand(11, 18);
      let iv = rand(0.045, 0.058);
      for (let k = 0; k < hits; k++) {
        const a = (k < 2 ? 0.7 : 1) * (k > hits - 4 ? 0.6 + 0.1 * (hits - k) : 1) * rand(0.9, 1);
        v.env.setValueAtTime(a, t); v.env.setTargetAtTime(0, t + 0.0005, 0.006);
        t += iv; iv *= 1.012;
      }
      t += rand(3, 7);
    }
    this._retire(v, t);
  }

  // Common buzzard high over the valley: a mewing, descending "peee-yaa".
  _raptor(now) {
    const v = this._voice(this._skyPoint(110, 260, 60, 150), { power: 0.32, bus: this.bus.birds, echo: 0.2 });
    let t = now + 0.05;
    const tone = this._filter(v, 'lowpass', 4200, 0.7); tone.connect(v.input);
    const f = this._osc(v, this.waves.raptor, 1600, t, tone).frequency;
    const lfo = this._osc(v, 'sine', rand(7, 10), t, null), lg = this._gain(v, 22);
    lfo.connect(lg); lg.connect(f);
    const pm = rand(0.9, 1.1), calls = irand(1, 3);
    for (let i = 0; i < calls; i++) {
      const k = pm * rand(0.97, 1.03), d = rand(0.85, 1.2);
      f.setValueAtTime(1500 * k, t); f.exponentialRampToValueAtTime(2350 * k, t + 0.12);
      f.exponentialRampToValueAtTime(2100 * k, t + 0.35); f.exponentialRampToValueAtTime(1250 * k, t + d);
      env(v.env, t, d, 1, 0.07, 0.3, 0.75);
      t += d + rand(2, 4.5);
    }
    this._retire(v, t);
  }

  // ---------------------------------------------------------------- insects
  _initInsects() {
    const ctx = this.ctx, now = ctx.currentTime;
    const mk = (input) => {
      const g = ctx.createGain(); g.gain.value = 0;
      const p = this._panner(false), dry = ctx.createGain(); dry.gain.value = 0;
      input.connect(g); g.connect(p); p.connect(dry); dry.connect(this.bus.insects);
      return { g, p, dry };
    };
    this.crickets = [];
    for (let i = 0; i < 3; i++) { // field crickets: pure ~4.5 kHz syllables in chirps
      const o = ctx.createOscillator(), F = rand(4300, 5000);
      o.frequency.value = F; o.start();
      this.crickets.push(Object.assign(mk(o), { o, F, syl: irand(3, 4), sd: rand(0.017, 0.024), sg: rand(0.012, 0.017),
        period: rand(0.36, 0.52), power: rand(0.007, 0.012), next: 0, boutEnd: 0, rest: now + rand(0, 5), placed: false }));
    }
    // grasshopper: a band of high noise, pulsed ~110 Hz, in crescendo phrases
    const src = ctx.createBufferSource(); src.buffer = this.noise.white; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rand(6500, 8500); bp.Q.value = 1.4;
    const am = ctx.createGain(); am.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = rand(90, 130);
    const lg = ctx.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg); lg.connect(am.gain);
    src.connect(bp); bp.connect(am); src.start(); lfo.start();
    this.hopper = Object.assign(mk(am), { power: 0.05, next: 0, boutEnd: 0, rest: now + rand(2, 8), placed: false });
  }

  _placeInsect(ins, minD, maxD) {
    const L = this.L, a = rand(0, TAU), d = rand(minD, maxD);
    const pos = { x: L.x + Math.cos(a) * d, y: L.y - 1.5, z: L.z + Math.sin(a) * d };
    this._setPos(ins.p, pos);
    ins.dry.gain.setTargetAtTime(ins.power * att(this._dist(pos)), this.ctx.currentTime, 0.05);
  }

  _insectLife(dt, now) {
    const c = this.c;
    if (c.insects < 0.03) return;
    if (!this.crickets) this._initInsects();
    for (const cr of this.crickets) {
      if (now < cr.rest) continue;
      if (!cr.placed) { this._placeInsect(cr, 3, 22); cr.placed = true; cr.next = Math.max(cr.next, now + 0.05); cr.boutEnd = now + rand(6, 30); }
      if (cr.next < now) cr.next = now + 0.02;
      while (cr.next < now + 0.3) {
        this._chirp(cr, cr.next);
        cr.next += cr.period * rand(0.93, 1.07);
        if (cr.next > cr.boutEnd) { cr.rest = cr.next + rand(2, 12); cr.next = cr.rest; cr.placed = false; break; }
      }
    }
    const gh = this.hopper;
    if (now >= gh.rest) {
      if (!gh.placed) { this._placeInsect(gh, 4, 18); gh.placed = true; gh.next = Math.max(gh.next, now + 0.05); gh.boutEnd = now + rand(15, 45); }
      if (gh.next < now + 0.3) {
        gh.next = this._hopperPhrase(gh, Math.max(gh.next, now + 0.02)) + rand(2.5, 8);
        if (gh.next > gh.boutEnd) { gh.rest = gh.next + rand(5, 20); gh.placed = false; }
      }
    }
  }

  _chirp(cr, t) {
    const g = cr.g.gain, f = cr.o.frequency, a = rand(0.8, 1);
    for (let k = 0; k < cr.syl; k++) {
      const ts = t + k * (cr.sd + cr.sg);
      f.setValueAtTime(cr.F * 1.012, ts); f.linearRampToValueAtTime(cr.F * 0.988, ts + cr.sd);
      g.setValueAtTime(0, ts); g.linearRampToValueAtTime(a, ts + 0.003);
      g.linearRampToValueAtTime(a * 0.75, ts + cr.sd - 0.004); g.linearRampToValueAtTime(0, ts + cr.sd);
    }
  }

  _hopperPhrase(gh, t) {
    const n = irand(6, 14), sd = rand(0.06, 0.09), gap = rand(0.04, 0.07), g = gh.g.gain;
    for (let k = 0; k < n; k++) {
      const a = 0.35 + 0.65 * (k + 1) / n, ts = t + k * (sd + gap);
      g.setValueAtTime(0, ts); g.linearRampToValueAtTime(a, ts + 0.01);
      g.linearRampToValueAtTime(a, ts + sd - 0.01); g.linearRampToValueAtTime(0, ts + sd);
    }
    return t + n * (sd + gap);
  }

  // A bee (or bumblebee) flying past the listener, with Doppler and wobble.
  _bee(now) {
    const L = this.L, t0 = now + 0.05, T = rand(2.2, 4.2);
    const ang = rand(0, TAU), dx = Math.cos(ang), dz = Math.sin(ang), px = -dz, pz = dx;
    const side = chance(0.5) ? 1 : -1, gy = L.y - 0.9;
    const P0 = { x: L.x + dx * 7 + px * rand(-2, 2), y: gy + rand(-0.3, 0.6), z: L.z + dz * 7 + pz * rand(-2, 2) };
    const C = { x: L.x + px * rand(0.6, 1.6) * side, y: L.y - rand(0.2, 0.8), z: L.z + pz * rand(0.6, 1.6) * side };
    const P1 = { x: L.x - dx * 7 + px * rand(-3, 3), y: gy + rand(-0.3, 1), z: L.z - dz * 7 + pz * rand(-3, 3) };
    const v = this._voice(C, { power: 1, bus: this.bus.insects, wet: 0.04 });
    v.dry.gain.value = 1;
    const bumble = chance(0.35), F = bumble ? rand(115, 160) : rand(185, 245);
    const lp = this._filter(v, 'lowpass', bumble ? 1300 : 2200, 0.8); lp.connect(v.input);
    const o = this._osc(v, this.waves.buzz, F, t0, lp);
    const j = this._osc(v, 'sine', rand(5, 9), t0, null), jg = this._gain(v, F * 0.025);
    j.connect(jg); jg.connect(o.frequency);
    const N = 14, p = v.pan, hasP = !!p.positionX;
    let prevD = null;
    o.frequency.setValueAtTime(F, t0);
    for (let i = 0; i <= N; i++) {
      const u = i / N, t = t0 + u * T, a = (1 - u) * (1 - u), b2 = 2 * (1 - u) * u, c2 = u * u, wob = 0.25 * Math.sin(u * 17 + ang);
      const q = { x: a * P0.x + b2 * C.x + c2 * P1.x + wob * px, y: a * P0.y + b2 * C.y + c2 * P1.y + 0.15 * Math.sin(u * 11), z: a * P0.z + b2 * C.z + c2 * P1.z + wob * pz };
      const d = Math.hypot(q.x - L.x, q.y - L.y, q.z - L.z);
      const amp = 0.03 * Math.min(1, 0.9 / Math.max(0.4, d)) * Math.min(1, u / 0.15, (1 - u) / 0.15);
      if (hasP) {
        if (i === 0) { p.positionX.setValueAtTime(q.x, t); p.positionY.setValueAtTime(q.y, t); p.positionZ.setValueAtTime(q.z, t); }
        else { p.positionX.linearRampToValueAtTime(q.x, t); p.positionY.linearRampToValueAtTime(q.y, t); p.positionZ.linearRampToValueAtTime(q.z, t); }
      }
      if (i === 0) v.env.setValueAtTime(0, t); else v.env.linearRampToValueAtTime(amp, t);
      if (prevD !== null) o.frequency.linearRampToValueAtTime(F * (1 + clamp((prevD - d) / (T / N), -8, 8) / 343), t);
      prevD = d;
    }
    this._retire(v, t0 + T + 0.1);
  }

  // ---------------------------------------------------------------- village
  _initHerd() {
    const L = this.L, cows = this.layout && this.layout.cows;
    let pts = [];
    if (cows && cows.length) pts = cows.slice(0, 8).map((p) => ({ x: p.x, y: (p.y || 0) + 1, z: p.z }));
    else if (this.hasWorld) {
      for (let i = 0; i < 7; i++) {
        const z = SPAWN_Z + 40 + Math.random() * 120, e = 30 + Math.random() * 70;
        pts.push({ x: bankX(z, VILLAGE_SIDE, e), y: waterY(z) + 3 + e * 0.06, z });
      }
    } else for (let i = 0; i < 6; i++) pts.push({ x: L.x - rand(60, 160), y: L.y, z: L.z + rand(-60, 60) });
    this.herd = pts.map((pos) => {
      const sheet = chance(0.3), f = sheet ? rand(230, 420) : rand(560, 1150);
      const parts = (sheet ? SHEET : CAST).map(([r, a, d]) => [r * (1 + (Math.random() - 0.5) * 0.03), a, d * rand(0.85, 1.15)]);
      return { pos: { ...pos }, home: { ...pos }, next: rand(0.5, 10), bell: { f, parts, clank: clamp(f * rand(3.2, 5), 1800, 5200), power: sheet ? 0.3 : 0.25 } };
    });
    this.herdLayout = !!(cows && cows.length);
    this.herdWorld = this.hasWorld;
  }

  _herdLife(dt, now) {
    const c = this.c;
    if (!this.herd || (!this.herdWorld && this.hasWorld) || (!this.herdLayout && this.layout && this.layout.cows && this.layout.cows.length)) this._initHerd();
    if (c.nv < 0.02) return;
    for (const cow of this.herd) {
      if ((cow.next -= dt) > 0) continue;
      cow.next = rand(2.5, 14) / (0.35 + 0.65 * c.nv);
      if (this.live.length < 36) this._cowbell(cow, now);
    }
  }

  // one strike of a modal bell: decaying inharmonic partials plus a short clapper transient
  _bellStrike(v, t, f, parts, s, clank = 0) {
    let end = t;
    for (const [r, a, T60] of parts) {
      const g = this._gain(v, 0); g.connect(v.input);
      this._ping(v, f * r * (1 + (Math.random() - 0.5) * 0.004), t, t + T60 + 0.05, g);
      strike(g.gain, t, a * s, T60 / 6.9, 0.0015);
      end = Math.max(end, t + T60 + 0.05);
    }
    if (clank) {
      const bp = this._filter(v, 'bandpass', clank, 1.6), g = this._gain(v, 0);
      bp.connect(g); g.connect(v.input);
      const n = this.ctx.createBufferSource(); n.buffer = this.noise.white; n.connect(bp); n.start(t, Math.random() * 3.5); n.stop(t + 0.06);
      v.nodes.push(n);
      strike(g.gain, t, 1.5 * s, 0.006, 0.001);
    }
    return end;
  }

  // Swiss cowbells: grazing clusters, or a steady clank when a cow walks.
  _cowbell(cow, now) {
    const h = cow.home;
    cow.pos.x = clamp(cow.pos.x + rand(-1.5, 1.5), h.x - 12, h.x + 12);
    cow.pos.z = clamp(cow.pos.z + rand(-1.5, 1.5), h.z - 12, h.z + 12);
    if (this._dist(cow.pos) > 900) return;
    const v = this._voice(cow.pos, { power: cow.bell.power * (0.6 + 0.4 * this.c.nv), bus: this.bus.village, gain: 1 });
    const B = cow.bell, parts = v.d > 160 ? B.parts.slice(0, 4) : B.parts;
    let t = now + 0.03, end = t;
    const ring = (tt, s, cl = B.clank) => { end = Math.max(end, this._bellStrike(v, tt, B.f, parts, s, cl)); };
    if (chance(0.13)) {
      const steps = irand(4, 8), per = rand(0.45, 0.65);
      for (let i = 0; i < steps; i++) {
        ring(t, rand(0.5, 1));
        if (chance(0.3)) ring(t + rand(0.05, 0.09), rand(0.15, 0.35), 0);
        t += per * rand(0.9, 1.1);
      }
    } else {
      const n = irand(1, 4);
      for (let i = 0; i < n; i++) { ring(t, rand(0.3, 1)); t += rand(0.12, 0.5); }
    }
    this._retire(v, end);
  }

  _churchStrike(v, t, f, s) {
    const end = this._bellStrike(v, t, f, CHURCH, s);
    const bp = this._filter(v, 'bandpass', f * rand(5, 7), 1.5), g = this._gain(v, 0);
    bp.connect(g); g.connect(v.input);
    const n = this.ctx.createBufferSource(); n.buffer = this.noise.white; n.connect(bp); n.start(t, Math.random() * 3.5); n.stop(t + 0.08);
    v.nodes.push(n);
    strike(g.gain, t, 0.6 * s, 0.01, 0.001);
    return end;
  }

  // Church bells from the village: a ding-dong quarter chime or a slow count of hour strokes.
  _church(now) {
    const pos = this._churchPos();
    if (this._dist(pos) > 1500) return;
    const v = this._voice(pos, { power: 0.55, bus: this.bus.village, echo: 0.3, gain: 1 });
    const hi = rand(0.98, 1.02) * 330, lo = hi * 0.8, hour = hi * 0.6;
    let t = now + 0.05, end = t;
    if (chance(0.55)) {
      const pairs = irand(1, 4);
      for (let i = 0; i < pairs; i++) {
        end = Math.max(end, this._churchStrike(v, t, hi, rand(0.75, 0.85))); t += 1.35;
        end = Math.max(end, this._churchStrike(v, t, lo, rand(0.75, 0.85))); t += 1.6;
      }
    } else {
      const n = irand(3, 9);
      for (let i = 0; i < n; i++) { end = Math.max(end, this._churchStrike(v, t, hour, rand(0.9, 1))); t += 2.3; }
    }
    this._retire(v, end);
  }

  _dog(now) {
    const pos = this._villageSpot();
    if (this._dist(pos) > 700) return;
    const v = this._voice(pos, { power: 0.3, bus: this.bus.village, echo: 0.18 });
    let t = now + 0.05;
    const big = chance(0.5), F = big ? rand(260, 340) : rand(380, 480);
    const form = this._filter(v, 'bandpass', big ? 850 : 1250, 1.1); form.connect(v.input);
    const f = this._osc(v, this.waves.voice, F, t, form).frequency;
    const nb = this._filter(v, 'bandpass', 1600, 0.8), ng = this._gain(v, 0.35);
    nb.connect(ng); ng.connect(v.input);
    this._noise(v, 'white', t, nb);
    const sets = chance(0.6) ? 1 : 2;
    for (let s = 0; s < sets; s++) {
      const n = irand(2, 4);
      for (let i = 0; i < n; i++) {
        const d = rand(0.12, 0.2);
        f.setValueAtTime(F * 0.9, t); f.linearRampToValueAtTime(F * 1.3, t + 0.03); f.exponentialRampToValueAtTime(F * 0.75, t + d);
        env(v.env, t, d, rand(0.75, 1), 0.008, d * 0.6, 0.7);
        t += d + rand(0.22, 0.5);
      }
      t += rand(1.5, 3.5);
    }
    this._retire(v, t);
  }

  _rooster(now) {
    const pos = this._villageSpot();
    if (this._dist(pos) > 700) return;
    const v = this._voice(pos, { power: 0.22, bus: this.bus.village, echo: 0.15 });
    let t = now + 0.05;
    const form = this._filter(v, 'bandpass', 1500, 0.9); form.connect(v.input);
    const F = rand(480, 560), f = this._osc(v, this.waves.voice, F, t, form).frequency;
    const vib = this._osc(v, 'sine', 7, t, null), vg = this._gain(v, 0);
    vib.connect(vg); vg.connect(f);
    for (const [d, a, b] of [[0.12, 1.0, 1.12], [0.11, 1.2, 1.28], [0.16, 1.42, 1.5]]) {
      glide(f, t, d, F * a, F * b); env(v.env, t, d, 0.8, 0.01, 0.03, 0.85);
      t += d + 0.035;
    }
    const d = rand(0.75, 1.0);
    f.setValueAtTime(F * 1.5, t); f.linearRampToValueAtTime(F * 1.62, t + 0.12);
    f.linearRampToValueAtTime(F * 1.52, t + d * 0.6); f.exponentialRampToValueAtTime(F * 1.05, t + d);
    vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(F * 0.03, t + 0.3);
    env(v.env, t, d, 1, 0.02, d * 0.35, 0.85);
    this._retire(v, t + d + 0.1);
  }

  _alphornPhrase() {
    const P = [ // [harmonic, seconds]; the 11th is the alphorn's characteristic "fa"
      [[6, 0.5], [8, 0.5], [9, 0.4], [10, 1.4], [9, 0.45], [8, 0.45], [6, 1.9]],
      [[8, 0.45], [10, 0.45], [12, 1.2], [11, 0.4], [10, 0.4], [9, 0.4], [8, 1.9]],
      [[5, 0.6], [6, 0.5], [8, 1.0], [10, 0.5], [9, 0.5], [8, 0.5], [6, 0.6], [8, 2.0]],
      [[12, 0.9], [10, 0.45], [11, 0.45], [12, 0.5], [10, 0.5], [8, 1.7]],
      [[6, 0.4], [8, 0.4], [10, 0.4], [12, 1.5], [10, 0.5], [8, 2.0]],
      [[8, 1.2], [9, 0.4], [10, 0.4], [8, 0.4], [6, 1.6]],
    ];
    const k = rand(0.9, 1.15);
    return pick(P).map(([h, d]) => [h, d * k * rand(0.92, 1.08)]);
  }

  // A far-away alphorn up on an alp: natural harmonics, lip slurs, swelling tone, valley echo.
  _alphorn(now) {
    const pos = this._skyPoint(380, 650, 90, 220, (chance(0.5) ? 0 : Math.PI) + rand(-0.8, 0.8));
    const v = this._voice(pos, { power: 0.65, bus: this.bus.village, echo: 0.55, wet: 0.62 });
    const F = rand(86, 95);
    let t = now + 0.1;
    const tone = this._filter(v, 'lowpass', F * 10, 0.9); tone.connect(v.input);
    const f = this._osc(v, this.waves.horn, F * 6, t, tone).frequency;
    const vib = this._osc(v, 'sine', rand(4.5, 5.5), t, null), vg = this._gain(v, 0);
    vib.connect(vg); vg.connect(f);
    const g = v.env;
    g.setValueAtTime(0, t);
    const phrases = irand(2, 3);
    for (let p = 0; p < phrases; p++) {
      const mel = this._alphornPhrase();
      let prev = 0;
      for (let i = 0; i < mel.length; i++) {
        const [h, d] = mel[i], fr = F * h, pk = i === mel.length - 1 ? 1 : rand(0.75, 0.95);
        if (!prev) { f.setValueAtTime(fr * 0.96, t); f.exponentialRampToValueAtTime(fr, t + 0.09); }
        else { f.setValueAtTime(prev, t); f.exponentialRampToValueAtTime(fr, t + 0.06); g.setTargetAtTime(pk * 0.55, t - 0.05, 0.015); }
        g.setTargetAtTime(pk, t, prev ? 0.035 : 0.07);
        tone.frequency.setTargetAtTime(fr * (2.2 + 2.6 * pk), t, 0.05);
        if (d > 0.7) {
          g.setTargetAtTime(pk * 0.82, t + 0.25, d * 0.5);
          tone.frequency.setTargetAtTime(fr * 2.2, t + 0.25, d * 0.5);
          vg.gain.setTargetAtTime(fr * 0.0045, t + 0.3, 0.25);
        }
        vg.gain.setTargetAtTime(0, t + d - 0.08, 0.03);
        prev = fr; t += d;
      }
      g.setTargetAtTime(0, t - 0.2, 0.25);
      t += rand(1.8, 2.8);
    }
    this._retire(v, t + 0.5);
  }

  // ---------------------------------------------------------------- rare events
  _rare(dt, now) {
    const c = this.c, E = this.ev;
    for (const k in E) E[k] -= dt;
    const hiOK = now - this.lastHi > 14;
    if (E.cuckoo <= 0) {
      if (hiOK && c.birdAct > 0.3) { this._cuckoo(now); this.lastHi = now + 5; E.cuckoo = rand(80, 220); } else E.cuckoo = rand(6, 15);
    }
    if (E.raptor <= 0) {
      if (hiOK) { this._raptor(now); this.lastHi = now; E.raptor = rand(90, 240); } else E.raptor = rand(5, 12);
    }
    if (E.woodpecker <= 0) {
      if (c.birdAct > 0.45 && this.live.length < 36) this._woodpecker(now);
      E.woodpecker = rand(40, 130);
    }
    if (E.church <= 0) {
      if (c.nv > 0.12 && hiOK) { this._church(now); this.lastHi = now + 10; E.church = rand(110, 260); } else E.church = rand(10, 25);
    }
    if (E.dog <= 0) {
      if (c.nv > 0.2) { if (chance(0.7)) this._dog(now); else this._rooster(now); }
      E.dog = rand(60, 180);
    }
    if (E.alphorn <= 0) {
      if (hiOK && chance(0.45 + 0.5 * c.nv)) { this._alphorn(now); this.lastHi = now + 18; E.alphorn = rand(300, 600); } else E.alphorn = rand(40, 120);
    }
    if (E.bee <= 0) {
      if (c.land > 0.6 && c.insects > 0.3) this._bee(now);
      E.bee = rand(15, 45);
    }
  }

  // Fire any layer on demand (debug pages, scripted moments).
  trigger(kind) {
    const now = this.ctx.currentTime;
    if (SONG[kind]) { this._sing(this._newBird(kind, this._forestPoint(18, 45)), now + 0.03); return; }
    switch (kind) {
      case 'cuckoo': this._cuckoo(now); break;
      case 'woodpecker': this._woodpecker(now); break;
      case 'raptor': this._raptor(now); break;
      case 'church': this._church(now); break;
      case 'dog': this._dog(now); break;
      case 'rooster': this._rooster(now); break;
      case 'alphorn': this._alphorn(now); break;
      case 'bee': this._bee(now); break;
      case 'cowbell': if (!this.herd) this._initHerd(); this._cowbell(pick(this.herd), now); break;
      case 'gurgle': this._gurgle(this._waterPoint(4, 20), 0.05); break;
      case 'splash': this._splash(this._rapidsPoint(), 0.14); break;
      case 'lap': this._lap(this._hullPoint(), 0.1, 2); break;
      case 'shoreLap': this._lap(this._waterPoint(1, 10), 0.1, 3, true); break;
      case 'gust': Object.assign(this.gust, { phase: 1, k: 0, amp: 1, rise: 2, hold: 2, fall: 5 }); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- foley (non-spatial, to the master)
  footstep(surface = 'grass') {
    const v = this._fxv(), t = this.ctx.currentTime + 0.005, k = rand(0.88, 1.12), lv = rand(0.8, 1.1);
    v.env.value = surface === 'gravel' ? 0.36 : 0.5; // steps repeat ~2x a second: keep them under the ambience
    const thud = (amp, cut) => { // the muffled weight of the step
      const lp = this._filter(v, 'lowpass', cut, 0.7), g = this._gain(v, 0);
      lp.connect(g); g.connect(v.input); this._noise(v, 'brown', t, lp);
      strike(g.gain, t, amp * lv, 0.028, 0.005);
    };
    if (surface === 'wood') { // hollow dock planks: knock, cavity ring, heel tick, softer toe
      const g1 = this._gain(v, 0); g1.connect(v.input);
      const o = this._osc(v, 'triangle', 175 * k, t, g1);
      o.frequency.setValueAtTime(175 * k, t); o.frequency.exponentialRampToValueAtTime(120 * k, t + 0.1);
      const toe = t + rand(0.06, 0.09);
      strike(g1.gain, t, 0.085 * lv, 0.028);
      strike(g1.gain, toe, 0.035 * lv, 0.022);
      const bp = this._filter(v, 'bandpass', rand(380, 520) * k, 6), g2 = this._gain(v, 0);
      bp.connect(g2); g2.connect(v.input); this._noise(v, 'white', t, bp);
      strike(g2.gain, t, 2.2 * lv, 0.035, 0.0015);
      strike(g2.gain, toe, 0.9 * lv, 0.03, 0.0015);
      const hb = this._filter(v, 'bandpass', 2600 * k, 1.5), g3 = this._gain(v, 0);
      hb.connect(g3); g3.connect(v.input); this._noise(v, 'white', t, hb);
      strike(g3.gain, t, 0.18 * lv, 0.006, 0.0008);
    } else if (surface === 'gravel') { // many tiny grains crunching
      const hp = this._filter(v, 'highpass', 1200, 0.7), bp = this._filter(v, 'bandpass', rand(3200, 4400) * k, 0.7), g = this._gain(v, 0);
      hp.connect(bp); bp.connect(g); g.connect(v.input); this._noise(v, 'white', t, hp);
      const times = Array.from({ length: irand(9, 15) }, () => rand(0, 0.14)).sort((a, b) => a - b);
      for (const ti of times) strike(g.gain, t + ti, rand(0.18, 0.45) * lv, rand(0.003, 0.008), 0.0008);
      thud(0.16, 260);
    } else { // grass: a soft swish of blades, heel then toe
      const bp = this._filter(v, 'bandpass', rand(2600, 3800) * k, 0.9), g = this._gain(v, 0);
      bp.connect(g); g.connect(v.input); this._noise(v, 'white', t, bp);
      strike(g.gain, t, 0.28 * lv, 0.025, 0.012);
      strike(g.gain, t + rand(0.045, 0.07), 0.18 * lv, 0.035, 0.015);
      thud(0.2, 200);
    }
    this._retire(v, t + 0.35);
  }

  coins() {
    const v = this._fxv(), t0 = this.ctx.currentTime + 0.01;
    let t = t0;
    const n = irand(7, 10);
    for (let i = 0; i < n; i++) { // coins tumbling onto the counter
      const f = rand(2500, 4600), a = 0.03 * rand(0.55, 1) * (1 - 0.4 * i / n);
      for (const [r, amp, tau] of [[1, 1, 0.16], [2.41, 0.5, 0.08], [3.93, 0.28, 0.05], [5.47, 0.14, 0.03]]) {
        if (f * r > Math.min(18000, this.ctx.sampleRate * 0.45)) continue;
        const g = this._gain(v, 0); g.connect(v.input);
        this._ping(v, f * r, t, t + tau * 7, g);
        strike(g.gain, t, a * amp, tau, 0.001);
      }
      t += i < 2 ? rand(0.06, 0.1) : rand(0.03, 0.075);
    }
    // "ka-ching": drawer click and a bright register bell
    const tc = t + 0.05;
    const bp = this._filter(v, 'bandpass', 1500, 2), cg = this._gain(v, 0);
    bp.connect(cg); cg.connect(v.input); this._noise(v, 'white', tc, bp);
    strike(cg.gain, tc, 0.25, 0.01, 0.001);
    for (const [f, a] of [[2093, 0.032], [2637, 0.026]]) {
      for (const [r, ra, tau] of [[1, 1, 0.35], [2, 0.22, 0.15], [2.76, 0.1, 0.08]]) {
        const g = this._gain(v, 0); g.connect(v.input);
        this._ping(v, f * r, tc + 0.03, tc + 0.03 + tau * 7, g);
        strike(g.gain, tc + 0.03, a * ra, tau, 0.002);
      }
    }
    this._retire(v, tc + 2.6);
  }

  purchase() {
    const v = this._fxv(), t0 = this.ctx.currentTime + 0.01;
    { // soft "bloop" lift-off
      const g = this._gain(v, 0); g.connect(v.input);
      const o = this._ping(v, 260, t0, t0 + 0.4, g);
      o.frequency.setValueAtTime(260, t0); o.frequency.exponentialRampToValueAtTime(520, t0 + 0.09);
      strike(g.gain, t0, 0.03, 0.05, 0.004);
    }
    [784, 1047, 1319, 1568].forEach((f, i) => { // G5 C6 E6 G6, the last one held
      const t = t0 + i * 0.075, last = i === 3, a = last ? 0.045 : 0.035, tau = last ? 0.32 : 0.06;
      for (const [r, ra] of [[1, 1], [2, 0.28], [3, 0.08]]) {
        const g = this._gain(v, 0); g.connect(v.input);
        const tt = tau * (r === 1 ? 1 : 0.6);
        this._ping(v, f * r, t, t + tt * 7 + 0.05, g);
        strike(g.gain, t, a * ra, tt, 0.004);
      }
    });
    const tc = t0 + 0.225;
    for (const f of [523.25, 659.25, 783.99]) { // warm chord under the last note
      const lp = this._filter(v, 'lowpass', 2500, 0.7), g = this._gain(v, 0);
      lp.connect(g); g.connect(v.input);
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.connect(lp); o.start(tc); o.stop(tc + 2);
      v.nodes.push(o);
      g.gain.setTargetAtTime(0.012, tc, 0.02); g.gain.setTargetAtTime(0, tc + 0.12, 0.25);
    }
    for (let i = 0; i < 7; i++) { // sparkles
      const t = tc + 0.03 + rand(0, 0.5), g = this._gain(v, 0); g.connect(v.input);
      this._ping(v, rand(2800, 5200), t, t + 0.4, g);
      strike(g.gain, t, 0.009, 0.045, 0.002);
    }
    this._retire(v, tc + 2.2);
  }

  // A little spring-mounted shop bell: a few ringing strikes as the door swings.
  shopBell() {
    const v = this._fxv(), t0 = this.ctx.currentTime + 0.01, f0 = 2150 * rand(0.98, 1.02), base = 0.022;
    const hits = [[0, 1], [rand(0.08, 0.1), 0.62], [rand(0.17, 0.2), 0.42], [rand(0.26, 0.3), 0.26]];
    if (chance(0.5)) hits.push([rand(0.36, 0.4), 0.15]);
    for (const [r, a, tau] of [[1, 1, 0.55], [1.0035, 0.55, 0.65], [2.32, 0.42, 0.28], [4.25, 0.22, 0.13], [6.63, 0.1, 0.07]]) {
      const g = this._gain(v, 0); g.connect(v.input);
      this._ping(v, f0 * r, t0, t0 + 3.5, g);
      let lvl = 0, last = 0;
      for (const [dt, s] of hits) { // ringing adds up: residual + new strike
        lvl = lvl * Math.exp(-(dt - last) / tau) + base * a * s;
        last = dt;
        strike(g.gain, t0 + dt, lvl, tau, 0.0015);
      }
    }
    const bp = this._filter(v, 'bandpass', 5000, 2), cg = this._gain(v, 0);
    bp.connect(cg); cg.connect(v.input); this._noise(v, 'white', t0, bp);
    for (const [dt, s] of hits) strike(cg.gain, t0 + dt, 0.06 * s, 0.004, 0.0008);
    this._retire(v, t0 + 3.5);
  }
}
