// Fully synthesized soundscape: motor, reel, splashes; nature ambience lives in ambience.js.
import { Ambience } from './ambience.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this._clickAcc = 0;
    this._slipAcc = 0;
    this.amb = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    // shared noise buffer
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.6 + b * 3; }
    this.noise = buf;

    // nature: river, wind, birds, insects, village (spatial, see ambience.js)
    this.amb = new Ambience(ctx, this.master);

    // outboard motor
    const mo = ctx.createOscillator(); mo.type = 'sawtooth'; mo.frequency.value = 45;
    const mo2 = ctx.createOscillator(); mo2.type = 'square'; mo2.frequency.value = 90.5;
    const mf = ctx.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 500; mf.Q.value = 2;
    const mg = ctx.createGain(); mg.gain.value = 0;
    const m2g = ctx.createGain(); m2g.gain.value = 0.3;
    mo.connect(mf); mo2.connect(m2g); m2g.connect(mf); mf.connect(mg); mg.connect(this.master);
    mo.start(); mo2.start();
    this.motor = { mo, mo2, mf, mg };
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _burst({ dur = 0.2, freq = 1000, q = 1, type = 'bandpass', gain = 0.3, sweep = 0, delay = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 1;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 2); src.stop(t + dur + 0.05);
  }

  _tone(freq, dur, gain = 0.1, type = 'sine', delay = 0, slide = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // per-frame ambience. s: { rapids, throttle, speed, nearVillage, camera, onLand, waterDist, layout? }
  ambience(dt, s = {}) {
    if (!this.ctx) return;
    const { throttle = 0 } = s;
    const t = this.ctx.currentTime;
    const a = Math.abs(throttle);
    this.motor.mg.gain.setTargetAtTime(a > 0.01 ? 0.05 + a * 0.12 : 0.025, t, 0.15);
    this.motor.mo.frequency.setTargetAtTime(38 + a * 70, t, 0.2);
    this.motor.mo2.frequency.setTargetAtTime(76.5 + a * 141, t, 0.2);
    this.motor.mf.frequency.setTargetAtTime(380 + a * 900, t, 0.2);
    // river, wind, birds, insects, village
    this.amb.update(dt, s);
  }

  // on-land foley (synthesized, see ambience.js)
  footstep(surface = 'grass') { if (this.amb) this.amb.footstep(surface); } // 'grass' | 'wood' | 'gravel'
  coins() { if (this.amb) this.amb.coins(); }
  purchase() { if (this.amb) this.amb.purchase(); }
  shopBell() { if (this.amb) this.amb.shopBell(); }

  reel(crank, slip, strain) {
    if (!this.ctx) return;
    const dt = 1 / 60;
    if (slip > 0.05) {
      this._slipAcc += dt * Math.min(70, 18 + slip * 25);
      while (this._slipAcc > 1) { this._slipAcc -= 1; this._burst({ dur: 0.025, freq: 4200, q: 6, gain: 0.12 + strain * 0.08 }); }
    } else if (crank > 0.1) {
      this._clickAcc += dt * crank * 7;
      while (this._clickAcc > 1) { this._clickAcc -= 1; this._burst({ dur: 0.03, freq: 2400, q: 3, gain: 0.035 }); }
    }
  }
  charge() {}
  bail() { this._burst({ dur: 0.05, freq: 3200, q: 4, gain: 0.08 }); this._tone(1800, 0.04, 0.03, 'triangle'); }
  whoosh(p) { this._burst({ dur: 0.35, freq: 600, q: 0.8, gain: 0.08 + p * 0.1, sweep: 4 }); }
  lineOut(speed) {
    if (!this.ctx || speed < 2) return;
    this._clickAcc += speed * 0.02;
    if (this._clickAcc > 1) { this._clickAcc = 0; this._burst({ dur: 0.02, freq: 5000, q: 8, gain: 0.02 }); }
  }
  splash(size = 0.3) {
    this._burst({ dur: 0.25 + size * 0.4, freq: 900 + size * 300, q: 0.7, gain: 0.12 + size * 0.25, sweep: 0.4 });
    this._burst({ dur: 0.12, freq: 2600, q: 1.5, gain: 0.05 + size * 0.08, delay: 0.03 });
  }
  bite(float) { this._burst({ dur: 0.05, freq: float ? 1500 : 2200, q: 5, gain: 0.08 }); }
  hookSet() { this._burst({ dur: 0.18, freq: 400, q: 0.6, gain: 0.2, sweep: 3 }); }
  snap() { this._burst({ dur: 0.08, freq: 3000, q: 2, gain: 0.25 }); this._tone(140, 0.25, 0.08, 'triangle', 0, 0.5); }
  snag() { this._tone(220, 0.15, 0.05, 'triangle'); }
  bump(v) { this._burst({ dur: 0.25, freq: 180, q: 1, gain: Math.min(0.35, v * 0.12), type: 'lowpass' }); }
  anchor(down) { this._burst({ dur: down ? 0.6 : 0.4, freq: down ? 500 : 800, q: 0.5, gain: 0.15, sweep: down ? 0.3 : 1.5 }); }
  jingle() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => { this._tone(f, 0.5, 0.06, 'sine', i * 0.09); this._tone(f * 2, 0.25, 0.015, 'sine', i * 0.09); });
  }
  ui() { this._tone(880, 0.06, 0.03, 'sine'); }
}
