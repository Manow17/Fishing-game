// DOM heads-up display in the "field notebook & enamel signage" style:
// brass/enamel instruments (compass tape, speed dial, line-tension scale), a topographic minimap,
// paper notifications, and the catch card / journal / help overlays.
import { SPECIES, SPECIES_IDS } from './species.js';
import { LURE_INFO } from '../models/lures.js';
import { DRAG_KG } from './fishing.js';
import { centerX, centerSlope, halfWidth, riverRocks, rapids } from '../world/river.js';
import * as RIVER from '../world/river.js'; // TRIBUTARIES / ISLANDS (read defensively; may be filled later)

const $ = (id) => document.getElementById(id);
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const DIAL_MAX = 50;          // km/h at the end of the speed dial
const TAU = Math.PI * 2;
const hex = (c) => '#' + ((+c || 0) >>> 0).toString(16).padStart(6, '0').slice(-6);
const fmtNum = (v) => (isFinite(v) ? Math.round(v).toLocaleString('de-CH') : '∞');
const pad2 = (n) => String(n).padStart(2, '0');

export class Hud {
  constructor() {
    this.el = $('hud');
    // compass tape: 3 repetitions of 24 marks (15° apart, 45 px each) so it can scroll seamlessly
    const strip = this.strip = $('compass-strip');
    let html = '';
    for (let r = 0; r < 3; r++) for (let i = 0; i < 24; i++) {
      const deg = i * 15;
      if (deg % 45 === 0) html += `<span class="major${deg === 0 ? ' north' : ''}">${COMPASS[deg / 45]}</span>`;
      else html += `<span>${deg % 30 === 0 ? deg : ''}</span>`;
    }
    strip.innerHTML = html;
    this.lureBar = $('lure-bar');
    this.notifyEl = $('notify');
    this.chatLog = $('chat-log');
    this.modeEl = $('mode-chip');
    this.promptEl = $('prompt');
    this.wallet = $('wallet');
    this.boatPanel = $('boat-panel');
    this.needle = document.querySelector('#boat-panel .dial-needle');
    this.knob = document.querySelector('#boat-panel .bp-knob');
    this.fishPanel = $('fish-panel');
    this.scaleEl = document.querySelector('#fish-panel .scale-ticks');
    this._c = {};                 // last values written to the DOM (avoid needless writes every frame)
    this._tg = new WeakMap();     // cached tributary outlines
    this._buildDial();
    const photo = document.querySelector('.lic-photo .fig');
    if (photo) photo.innerHTML = fishSketch('brownTrout').svg;
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  // ------------------------------------------------------------------ minimap: north-up topographic chart, 200 m radius
  minimap(me, others, marks = []) {
    const cv = this._mm || (this._mm = $('minimap'));
    if (!cv) return;
    const ctx = this._mmx || (this._mmx = cv.getContext('2d'));
    // keep the backing store matched to the on-screen size (checked about once a second)
    if (!(this._mmSizeT > 0)) {
      this._mmSizeT = 10;
      const css = cv.clientWidth;
      if (css > 0) {
        const want = Math.round(css * Math.min(2, Math.max(1, devicePixelRatio || 1)));
        if (want !== cv.width) { cv.width = cv.height = want; }
        this._mmU = want / 160;
      }
    }
    this._mmSizeT--;
    const W = cv.width, R = W / 2, S = W / 400, u = this._mmU || W / 160;
    const tx = (x) => R + (x - me.x) * S, ty = (z) => R + (z - me.z) * S;
    const reach = R / S + 14;

    // chart paper with world-anchored contour lines
    ctx.fillStyle = '#ece3c6';
    ctx.fillRect(0, 0, W, W);
    const pat = this._mmPattern(ctx);
    if (pat) {
      const sc = 0.8 * u / 1.5, T = this._mmTile * sc;
      const ox = (((-me.x * S) % T) + T) % T, oy = (((-me.z * S) % T) + T) % T;
      pat.setTransform(new DOMMatrix([sc, 0, 0, sc, ox, oy]));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, W);
    }

    // main river, sampled on a world-aligned grid so the outline doesn't shimmer
    const bodies = [];
    const zs = [], xl = [], xr = [], cs = [], hws = [], zw = [];
    const STEP = 6;
    for (let z = Math.floor((me.z - reach) / STEP) * STEP; z <= me.z + reach + STEP; z += STEP) {
      const s = centerSlope(z), k = Math.sqrt(1 + s * s), hw = halfWidth(z) * k, c = centerX(z);
      zw.push(z); zs.push(ty(z)); xl.push(tx(c - hw)); xr.push(tx(c + hw)); cs.push(c); hws.push(hw);
    }
    const river = new Path2D();
    river.moveTo(xl[0], zs[0]);
    for (let i = 1; i < zs.length; i++) river.lineTo(xl[i], zs[i]);
    for (let i = zs.length - 1; i >= 0; i--) river.lineTo(xr[i], zs[i]);
    river.closePath();
    bodies.push(river);

    // side waters and ponds
    const tribs = RIVER.TRIBUTARIES || [];
    for (let ti = 0; ti < tribs.length; ti++) {
      const t = tribs[ti];
      const g = this._trib(t);
      if (!g || g.maxX < me.x - reach || g.minX > me.x + reach || g.maxZ < me.z - reach || g.minZ > me.z + reach) continue;
      if (g.n >= 2) {
        const p = new Path2D(), L = g.L, Rr = g.R;
        p.moveTo(tx(L[0]), ty(L[1]));
        for (let i = 2; i < L.length; i += 2) p.lineTo(tx(L[i]), ty(L[i + 1]));
        for (let i = Rr.length - 2; i >= 0; i -= 2) p.lineTo(tx(Rr[i]), ty(Rr[i + 1]));
        p.closePath();
        bodies.push(p);
        for (const e of g.ends) { const q = new Path2D(); q.arc(tx(e.x), ty(e.z), Math.max(1, e.r * S), 0, TAU); bodies.push(q); }
      }
      if (t.pond) { const q = new Path2D(); q.arc(tx(t.pond.x), ty(t.pond.z), Math.max(1.5, t.pond.r * S), 0, TAU); bodies.push(q); }
    }
    // outline pass then fill pass: shorelines merge where waters join
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#3b88b0';
    ctx.lineWidth = 2.4 * u;
    for (const b of bodies) ctx.stroke(b);
    ctx.fillStyle = '#a9d4e2';
    for (const b of bodies) ctx.fill(b);
    // deeper channel tint down the middle of the main river
    const deep = new Path2D();
    deep.moveTo(tx(cs[0] - hws[0] * 0.45), zs[0]);
    for (let i = 1; i < zs.length; i++) deep.lineTo(tx(cs[i] - hws[i] * 0.45), zs[i]);
    for (let i = zs.length - 1; i >= 0; i--) deep.lineTo(tx(cs[i] + hws[i] * 0.45), zs[i]);
    deep.closePath();
    ctx.fillStyle = 'rgba(70, 145, 186, 0.2)';
    ctx.fill(deep);

    // rapids: broken white water lines across the river
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.2 * u;
    ctx.setLineDash([2.5 * u, 2.5 * u]);
    ctx.beginPath();
    for (let i = 0; i < zw.length; i++) {
      if (zw[i] % 12 !== 0 || rapids(zw[i]) < 0.35) continue;
      ctx.moveTo(tx(cs[i] - hws[i] * 0.8), zs[i]);
      ctx.lineTo(tx(cs[i] + hws[i] * 0.8), zs[i]);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // current chevrons (the river flows north → south)
    ctx.strokeStyle = 'rgba(40, 112, 150, 0.55)';
    ctx.lineWidth = 1.3 * u;
    ctx.beginPath();
    for (let i = 0; i < zw.length; i++) {
      if (zw[i] % 54 !== 0) continue;
      const s = centerSlope(zw[i]), n = Math.hypot(s, 1), dx = s / n, dz = 1 / n, a = 3.2 * u;
      const x = tx(cs[i]), y = zs[i];
      ctx.moveTo(x - dz * a - dx * a, y + dx * a - dz * a);
      ctx.lineTo(x, y);
      ctx.lineTo(x + dz * a - dx * a, y - dx * a - dz * a);
    }
    ctx.stroke();

    // islands
    const isl = RIVER.ISLANDS || [];
    for (let i = 0; i < isl.length; i++) {
      const is = isl[i];
      if (Math.abs(is.x - me.x) > reach + is.r || Math.abs(is.z - me.z) > reach + is.r) continue;
      const x = tx(is.x), y = ty(is.z), r = Math.max(1.5, is.r * S);
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = '#dfe1b8'; ctx.fill();
      ctx.lineWidth = 1.4 * u; ctx.strokeStyle = '#3b88b0'; ctx.stroke();
      if (r > 5 * u) {
        ctx.fillStyle = 'rgba(52, 104, 66, 0.55)';
        ctx.beginPath();
        for (let k = 0; k < 4; k++) { const a = k * 1.9 + i, d = r * 0.42; ctx.moveTo(x + Math.cos(a) * d + 1.6 * u, y + Math.sin(a) * d); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.6 * u, 0, TAU); }
        ctx.fill();
      }
    }

    // boulders
    ctx.fillStyle = 'rgba(72, 66, 54, 0.78)';
    ctx.beginPath();
    for (const r of riverRocks) {
      if (Math.abs(r.z - me.z) > reach || Math.abs(r.x - me.x) > reach) continue;
      const x = tx(r.x), y = ty(r.z), rr = Math.max(1.1 * u, r.r * S);
      ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, TAU);
    }
    ctx.fill();

    // 100 m range ring
    ctx.strokeStyle = 'rgba(34, 48, 42, 0.3)';
    ctx.lineWidth = 1 * u;
    ctx.setLineDash([3 * u, 4 * u]);
    ctx.beginPath(); ctx.arc(R, R, 100 * S, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `700 ${9.5 * u}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const lx = R + 100 * S * 0.74 + 2 * u, ly = R + 100 * S * 0.67;
    ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(236, 227, 198, 0.9)'; ctx.strokeText('100 m', lx, ly);
    ctx.fillStyle = 'rgba(34, 48, 42, 0.7)'; ctx.fillText('100 m', lx, ly);

    // landmarks: ink badges; off-chart ones are pinned to the rim so you can steer for them
    ctx.textAlign = 'center';
    for (const m of marks) {
      let x = tx(m.x), y = ty(m.z);
      const dx = x - R, dy = y - R, d = Math.hypot(dx, dy), lim = R - 11 * u, out = d > lim;
      if (out) { x = R + dx / d * lim; y = R + dy / d * lim; }
      const rr = (out ? 6.5 : 8) * u;
      ctx.globalAlpha = out ? 0.8 : 1;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU);
      ctx.fillStyle = '#22302a'; ctx.fill();
      ctx.lineWidth = 1.5 * u; ctx.strokeStyle = '#f3ead5'; ctx.stroke();
      ctx.fillStyle = m.color || '#fbf6ea';
      ctx.font = `700 ${(out ? 9 : 11) * u}px "Barlow Condensed", "Segoe UI Symbol", sans-serif`;
      ctx.fillText(m.label, x, y + 0.6 * u);
      ctx.globalAlpha = 1;
    }

    const arrow = (x, z, h, fill, stroke, size) => {
      ctx.save(); ctx.translate(tx(x), ty(z)); ctx.rotate(-h + Math.PI);
      ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * 0.68, size * 0.8); ctx.lineTo(0, size * 0.38); ctx.lineTo(-size * 0.68, size * 0.8); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 1.4 * u; ctx.strokeStyle = stroke; ctx.stroke();
      ctx.restore();
    };
    for (const o of others) arrow(o.x, o.z, o.h, hex(o.color), '#22302a', 6.5 * u);
    arrow(me.x, me.z, me.h, '#cf3a2c', '#fbf6ea', 8.5 * u);
  }

  _mmPattern(ctx) {
    if (this._pat !== undefined) return this._pat;
    const src = window.__afPaper && window.__afPaper.map;
    this._pat = src ? ctx.createPattern(src, 'repeat') : null;
    this._mmTile = src ? src.width : 384;
    return this._pat;
  }

  // Tributary outline in world space (left/right banks from per-point half widths), cached per object.
  _trib(t) {
    if (!t) return null;
    const pts = Array.isArray(t.points) ? t.points : [];
    const n = pts.length;
    let g = this._tg.get(t);
    if (g && g.n === n && g.p0 === pts[0] && g.pond === t.pond) return g;
    if (n < 2 && !t.pond) return null;
    const L = [], R = [], ends = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const grow = (x, z, r) => { minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r); minZ = Math.min(minZ, z - r); maxZ = Math.max(maxZ, z + r); };
    const hwA = t.halfWidth;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const hw = Array.isArray(hwA) ? (+hwA[Math.min(i, hwA.length - 1)] || 4) : (+hwA || 4);
      L.push(pts[i].x - dz * hw, pts[i].z + dx * hw);
      R.push(pts[i].x + dz * hw, pts[i].z - dx * hw);
      grow(pts[i].x, pts[i].z, hw);
      if (i === 0 || i === n - 1) ends.push({ x: pts[i].x, z: pts[i].z, r: hw });
    }
    if (t.pond) grow(t.pond.x, t.pond.z, t.pond.r || 0);
    g = { n, p0: pts[0], pond: t.pond, L, R, ends, minX, maxX, minZ, maxZ };
    this._tg.set(t, g);
    return g;
  }

  // ------------------------------------------------------------------ small widgets
  setLures(types, active) {
    this.lureBar.innerHTML = types.map((t, i) => `<div class="l ${t === active ? 'on' : ''}"><b>${i + 1}</b>${LURE_ICON[t] || ''}<span>${escapeHtml(LURE_INFO[t]?.name || t)}</span></div>`).join('');
  }

  notify(msg, big = false) {
    for (const n of this.notifyEl.children) if (n.textContent === msg && n.style.opacity !== '0') return; // no duplicates on screen
    const d = document.createElement('div');
    d.className = 'n' + (big ? ' big' : '');
    d.textContent = msg;
    this.notifyEl.appendChild(d);
    while (this.notifyEl.children.length > 4) this.notifyEl.firstChild.remove();
    setTimeout(() => { d.style.transition = 'opacity .6s'; d.style.opacity = 0; setTimeout(() => d.remove(), 600); }, big ? 4200 : 2600);
  }

  chat(name, color, text) {
    const d = document.createElement('div');
    d.className = 'm';
    d.style.setProperty('--pc', hex(color));
    const b = document.createElement('b');
    b.textContent = name;
    d.appendChild(b);
    d.appendChild(document.createTextNode(text));
    this.chatLog.appendChild(d);
    while (this.chatLog.children.length > 7) this.chatLog.firstChild.remove();
    setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 1000); }, 14000);
  }

  setPlayers(list) {
    $('players').innerHTML = list.map(p => `<div class="p"><span class="dot" style="--pc:${hex(p.color)}"></span><span class="nm">${escapeHtml(p.name)}</span>${p.me ? '<em>you</em>' : ''}</div>`).join('');
  }

  setLobby(code) {
    const b = $('lobby-badge');
    b.classList.toggle('hidden', !code);
    if (code) b.innerHTML = `Lobby <b>${escapeHtml(code)}</b>`;
  }

  // ------------------------------------------------------------------ per-frame instruments
  frame(s) {
    const c = this._c;
    // compass: heading in radians (0 = +Z = south in our world → we call -Z north)
    const deg = ((180 - s.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const off = (deg + 360) * 3 + 22.5;
    if (!(Math.abs(off - c.off) < 0.05)) { c.off = off; this.strip.style.transform = `translate3d(${(-off).toFixed(1)}px,0,0)`; }
    setText(this.modeEl, s.modeLabel || '');
    const prompt = s.prompt || '';
    setText(this.promptEl, prompt);
    this.promptEl.classList.toggle('pulse', !!s.promptPulse && !!prompt);
    this.el.classList.toggle('is-fishing', !!s.fishing);
    this.el.classList.toggle('is-walking', !!s.walking);

    // boat instrument
    this.boatPanel.classList.toggle('hidden', !!s.walking);
    if (!s.walking) {
      const kmh = Math.max(0, (s.speed || 0) * 3.6);
      setText($('bp-speed'), kmh.toFixed(1));
      const a = -135 + Math.min(1, kmh / DIAL_MAX) * 270;
      if (!(Math.abs(a - c.needle) < 0.2) && this.needle) { c.needle = a; this.needle.style.transform = `rotate(${a.toFixed(1)}deg)`; }
      const th = Math.max(-1, Math.min(1, s.throttle || 0));
      if (th !== c.th) {
        c.th = th;
        const fill = $('bp-throttle-fill');
        let pos;
        if (th >= 0) { fill.style.left = '33.3%'; fill.style.width = `${th * 66.7}%`; pos = 33.3 + th * 66.7; }
        else { fill.style.left = `${33.3 + th * 33.3}%`; fill.style.width = `${-th * 33.3}%`; pos = 33.3 + th * 33.3; }
        fill.classList.toggle('rev', th < 0);
        if (this.knob) this.knob.style.left = `${pos}%`;
      }
      const anchor = s.moored ? 'moored' : s.anchored ? 'down' : 'up';
      if (anchor !== c.anchor) {
        c.anchor = anchor;
        const el = $('bp-anchor');
        el.dataset.state = anchor;
        el.textContent = anchor === 'moored' ? 'Moored' : anchor === 'down' ? 'Anchored' : 'Anchor up';
      }
      setText($('bp-current'), `${(s.current || 0).toFixed(1)} m/s`);
    }

    // purse
    if (!Object.is(s.money, c.money) || s.crate !== c.crate) {
      c.money = s.money; c.crate = s.crate;
      const inf = !isFinite(s.money);
      this.wallet.innerHTML = `<span class="cur">CHF</span><b${inf ? ' class="inf"' : ''}>${inf ? '∞' : fmtNum(s.money || 0)}</b><span class="crate">${s.crate || 0} fish in crate</span>`;
    }

    // fishing instruments
    this.fishPanel.classList.toggle('hidden', !s.fishing);
    if (s.fishing) {
      const breakKg = s.breakKg || 7.2;
      if (breakKg !== c.brk) { c.brk = breakKg; this._buildScale(breakKg); }
      const t = Math.max(0, Math.min(1, (s.tension || 0) / (breakKg * 9.81)));
      const bar = $('fp-tension');
      const w = (t * 100).toFixed(1);
      if (w !== c.tw) { c.tw = w; bar.style.width = `${w}%`; }
      const lvl = t > 0.85 ? 'bad' : t > 0.6 ? 'warn' : '';
      if (lvl !== c.lvl) { c.lvl = lvl; bar.className = lvl; }
      const dkg = DRAG_KG(s.drag);
      const dm = (Math.min(1, dkg / breakKg) * 100).toFixed(1);
      if (dm !== c.dm) { c.dm = dm; $('fp-drag-mark').style.left = `${dm}%`; if (this.scaleDM) this.scaleDM.style.left = `${dm}%`; }
      setText($('fp-tension-val'), `${((s.tension || 0) / 9.81).toFixed(1)} kg`);
      setText($('fp-line'), `${(s.lineOut || 0).toFixed(1)} m`);
      setText($('fp-drag'), `${s.drag} · ${dkg.toFixed(1)} kg`);
      setText($('fp-depth'), `${(s.lureDepth || 0).toFixed(1)} m`);
      const hasFish = s.stamina != null;
      $('fp-fish-wrap').classList.toggle('hidden', !hasFish);
      if (hasFish) {
        const sw = (Math.max(0, Math.min(1, s.stamina)) * 100).toFixed(1);
        if (sw !== c.sw) { c.sw = sw; $('fp-stamina').style.width = `${sw}%`; }
      }
    }
    const cm = $('cast-meter');
    cm.classList.toggle('hidden', !s.charging);
    if (s.charging) {
      const p = (Math.min(1, s.power / 1.05) * 100).toFixed(1);
      if (p !== c.cast) { c.cast = p; $('cast-fill').style.width = `${p}%`; }
    }
    $('crosshair').classList.toggle('hidden', !s.fishing || s.walking);
    this.lureBar.classList.toggle('hidden', !s.fishing);
  }

  _buildDial() {
    const g = document.querySelector('#boat-panel .dial-ticks');
    if (!g) return;
    const P = (a, r) => [50 + r * Math.sin(a * Math.PI / 180), 50 - r * Math.cos(a * Math.PI / 180)];
    const f = (n) => n.toFixed(2);
    let h = '';
    for (let v = 0; v <= DIAL_MAX + 1e-6; v += 2.5) {
      const a = -135 + v / DIAL_MAX * 270, maj = v % 10 === 0, mid = v % 5 === 0;
      const [x1, y1] = P(a, maj ? 35 : mid ? 38 : 40), [x2, y2] = P(a, 44);
      h += `<line${maj ? ' class="maj"' : ''} x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
      if (maj) { const [tx, ty] = P(a, 27); h += `<text x="${f(tx)}" y="${f(ty + 3.2)}" text-anchor="middle">${v}</text>`; }
    }
    g.innerHTML = h;
    const red = document.querySelector('#boat-panel .dial-red');
    if (red) {
      const [ax, ay] = P(-135 + 40 / DIAL_MAX * 270, 41.5), [bx, by] = P(135, 41.5);
      red.setAttribute('d', `M${f(ax)} ${f(ay)} A41.5 41.5 0 0 1 ${f(bx)} ${f(by)}`);
    }
  }

  _buildScale(brk) {
    if (!this.scaleEl) return;
    const every = brk > 12 ? 4 : brk > 6 ? 2 : 1;
    let h = '';
    for (let k = 0; k <= Math.floor(brk + 1e-6); k++) {
      const x = (k / brk * 100).toFixed(2), maj = k % every === 0;
      h += `<i${maj ? ' class="maj"' : ''} style="left:${x}%"></i>`;
      if (maj && brk - k > every * 0.75) h += `<span style="left:${x}%${k === 0 ? ';transform:none' : ''}">${k}</span>`;
    }
    h += `<i class="maj" style="left:calc(100% - 1.5px)"></i><span class="brk" style="left:100%">${+brk.toFixed(1)} kg</span><b class="dm"></b>`;
    this.scaleEl.innerHTML = h;
    this.scaleDM = this.scaleEl.querySelector('.dm');
    this._c.dm = null;
  }

  // ------------------------------------------------------------------ catch card (right side; the trophy fish renders into the left 60 %)
  showCatch(c, onKeep, onRelease) {
    const sp = SPECIES[c.species] || { name: String(c.species), local: '', latin: '' };
    const card = $('catch-card');
    $('cc-title').textContent = sp.name;
    $('cc-sub').innerHTML = `${sp.local ? `<span class="loc">${escapeHtml(sp.local)}</span>` : ''}${sp.latin ? `<i>${escapeHtml(sp.latin)}</i>` : ''}`;
    const cm = c.len * 100;
    $('cc-len').textContent = `${cm.toFixed(0)} cm`;
    $('cc-weight').textContent = c.weight >= 1 ? `${c.weight.toFixed(2)} kg` : `${Math.round(c.weight * 1000)} g`;
    $('cc-points').textContent = `+${c.points}`;
    const rec = $('cc-record');
    rec.textContent = c.record ? (c.first ? 'New species!' : 'Personal best!') : '';
    rec.classList.toggle('stamped', !!c.record);
    const face = card.querySelector('.cc-stamp-face');
    if (face) face.style.setProperty('--stamp', STAMP_INK[c.species] || '#b8452f');
    const d = new Date();
    const date = card.querySelector('.cc-date');
    if (date) date.textContent = `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
    card.classList.remove('hidden');
    this._ruler(c.species, cm);
    $('btn-keep').onclick = onKeep;
    $('btn-release').onclick = onRelease;
  }
  hideCatch() { $('catch-card').classList.add('hidden'); }
  get catchOpen() { return !$('catch-card').classList.contains('hidden'); }

  // measuring board: the specimen laid nose-to-stop with a red mark at its length
  _ruler(id, cm) {
    const r = document.querySelector('#catch-card .cc-ruler');
    if (!r) return;
    const max = cm <= 40 ? Math.ceil((cm + 6) / 5) * 5 : Math.ceil((cm + 8) / 10) * 10;
    r.style.setProperty('--max', max);
    r.style.setProperty('--len', cm.toFixed(1));
    const sk = fishSketch(id, 'ruler');
    r.querySelector('.cc-ruler-fish').innerHTML = sk.svg;
    const stepL = max > 80 ? 20 : 10;
    let h = '';
    for (let k = stepL; k < max; k += stepL) h += `<span style="left:${(k / max * 100).toFixed(2)}%">${k}</span>`;
    h += `<span class="unit" style="left:4px">cm</span>`;
    r.querySelector('.cc-ruler-marks').innerHTML = h;
    const span = (r.clientWidth || 320) * cm / max;
    r.style.setProperty('--fish-h', `${Math.round(Math.max(16, Math.min(58, span * sk.aspect)))}px`);
  }

  // ------------------------------------------------------------------ journal + help overlays
  toggleJournal(journal, force) {
    const el = $('journal');
    const open = force ?? el.classList.contains('hidden');
    el.classList.toggle('hidden', !open);
    if (!open) return false;
    const caught = SPECIES_IDS.filter(id => journal.species[id]).length;
    $('j-score').innerHTML = `<b>${fmtNum(journal.points)}</b> points · <b>${journal.total}</b> fish · <b>${caught}/${SPECIES_IDS.length}</b> species`;
    $('j-grid').innerHTML = SPECIES_IDS.map(id => {
      const sp = SPECIES[id];
      const r = journal.species[id];
      if (!r) return `<div class="sp locked"><div class="fig">${fishSketch(id, 'locked').svg}</div><div class="nm">???</div><div class="lt">${escapeHtml(sp.local)}</div><div class="st">not caught yet</div></div>`;
      return `<div class="sp"><span class="chk" title="Caught">✓</span><div class="fig">${fishSketch(id).svg}</div><div class="nm">${escapeHtml(sp.name)}</div><div class="lt">${escapeHtml(sp.latin)}</div>
        <div class="st">Caught <b>${r.count}</b> · best <b>${r.best.toFixed(2)} kg</b> (${Math.round(r.bestLen * 100)} cm)</div></div>`;
    }).join('');
    return true;
  }
  toggleHelp(force) {
    const el = $('help');
    const open = force ?? el.classList.contains('hidden');
    el.classList.toggle('hidden', !open);
    return open;
  }
  get overlayOpen() { return !document.getElementById('shop').classList.contains('hidden') || !$('journal').classList.contains('hidden') || !$('help').classList.contains('hidden') || this.catchOpen; }
}

function setText(el, v) {
  if (el && el._v !== v) { el._v = v; el.textContent = v; }
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ------------------------------------------------------------------ naturalist fish sketches (inline SVG, cached)
const STAMP_INK = {
  brownTrout: '#b8452f', rainbowTrout: '#b8435a', grayling: '#2f6a8f', arcticChar: '#c0582c', pike: '#2f6a4f',
  perch: '#5c7a2a', huchen: '#574b8c', whitefish: '#2b6f86', barbel: '#8a6526', chub: '#6b5a3a',
};
const FISH_FORM = {
  brownTrout:   { d: 24, tint: '#b8904f', dor: [38, 51, 9], ad: 1, tail: [16, 12, 3], marks: 'spots' },
  rainbowTrout: { d: 23, tint: '#c99a90', dor: [38, 50, 9], ad: 1, tail: [16, 12, 3], marks: 'band' },
  grayling:     { d: 21, tint: '#9aa5ae', dor: [25, 58, 15], ad: 1, tail: [16, 14, 7], marks: 'dots', rays: 1 },
  arcticChar:   { d: 23, tint: '#cf8a5c', dor: [38, 50, 9], ad: 1, tail: [16, 12, 4], marks: 'pale', belly: '#e0763a' },
  pike:         { d: 15, tint: '#8ea35c', dor: [66, 78, 10], tail: [16, 12, 4], snout: 1, marks: 'bars' },
  perch:        { d: 30, tint: '#b6b552', dor: [24, 45, 13], dor2: [49, 63, 9], tail: [15, 12, 3], marks: 'stripes', rays: 1, belly: '#e08a4a' },
  huchen:       { d: 17, tint: '#bb8b70', dor: [40, 51, 8], ad: 1, tail: [16, 11, 3], marks: 'cross' },
  whitefish:    { d: 22, tint: '#aabdc5', dor: [34, 45, 11], ad: 1, tail: [17, 14, 8] },
  barbel:       { d: 19, tint: '#ad9868', dor: [34, 45, 13], tail: [16, 13, 6], barbels: 1 },
  chub:         { d: 24, tint: '#a8aa80', dor: [42, 52, 9], tail: [15, 12, 4], marks: 'scales' },
};
const _sketchCache = new Map();

// mode: undefined (journal/licence), 'ruler' (stretched exactly nose→tail), 'locked' (dashed pencil outline)
function fishSketch(id, mode) {
  const key = id + '|' + (mode || '');
  if (_sketchCache.has(key)) return _sketchCache.get(key);
  const F = FISH_FORM[id] || FISH_FORM.chub;
  const h = F.d / 2, PED = 84, pr = 0.3;
  const sm = (t) => t * t * (3 - 2 * t);
  const prof = (u) => (u < 0.42 ? Math.sqrt(Math.max(0, 1 - (1 - u / 0.42) ** 2)) : 1 - (1 - pr) * sm((u - 0.42) / 0.58));
  const top = (x) => { const u = Math.max(0, Math.min(1, x / PED)); return -h * prof(u) * (F.snout ? 0.62 + 0.38 * Math.min(1, u / 0.4) : 1); };
  const bot = (x) => h * prof(Math.max(0, Math.min(1, x / PED))) * 1.04;
  const f = (n) => Math.round(n * 10) / 10;
  let rs = 0; for (const ch of id) rs = (rs * 31 + ch.charCodeAt(0)) | 0;
  const rnd = () => { rs = (rs * 1103515245 + 12345) | 0; return ((rs >>> 8) & 0xffff) / 0xffff; };

  // body outline
  let body = `M0 ${f(top(0))}`;
  for (let x = 2; x <= PED; x += 2) body += `L${x} ${f(top(x))}`;
  const [T, S, Fk] = F.tail, p = -top(PED);
  let tail = `M${PED} ${f(-p)}Q${f(PED + T * 0.4)} ${f(-p - (S - p) * 0.25)} ${PED + T} ${-S}Q${f(PED + T - Fk * 0.5)} ${f(-S * 0.35)} ${PED + T - Fk} 0Q${f(PED + T - Fk * 0.5)} ${f(S * 0.35)} ${PED + T} ${S}Q${f(PED + T * 0.4)} ${f(p + (S - p) * 0.25)} ${PED} ${f(p)}Z`;
  let belly = '';
  for (let x = PED; x >= 0; x -= 2) belly += `L${x} ${f(bot(x))}`;
  body += belly + 'Z';
  // fins
  const fin = ([a, b, ht]) => `M${a} ${f(top(a) + 0.5)}C${a + 1} ${f(top(a) - ht * 1.05)} ${f(a + (b - a) * 0.55)} ${f(top(a) - ht)} ${b} ${f(top(b) - ht * 0.28)}L${b} ${f(top(b) + 0.5)}Z`;
  let fins = fin(F.dor);
  if (F.dor2) fins += fin(F.dor2);
  if (F.ad) fins += `M73 ${f(top(73) + 0.4)}Q76 ${f(top(76) - 3.4)} 79.5 ${f(top(79.5) + 0.4)}Z`;
  fins += `M45 ${f(bot(45) - 0.5)}l7 ${f(h * 0.42)}l-1 ${f(-h * 0.42)}Z`;               // pelvic
  fins += `M65 ${f(bot(65) - 0.5)}l8 ${f(h * 0.4)}l0 ${f(-h * 0.36)}Z`;                  // anal
  const pect = `M20 ${f(h * 0.3)}q7 1.5 11 ${f(h * 0.45)}q-7 0 -11 ${f(-h * 0.45)}Z`;
  let rays = '';
  if (F.rays) {
    for (const D of [F.dor, F.dor2].filter(Boolean)) {
      const [a, b, ht] = D, n = Math.round((b - a) / 2.6);
      for (let i = 1; i < n; i++) { const x = a + (b - a) * i / n; rays += `M${f(x)} ${f(top(x))}L${f(x + 1)} ${f(top(x) - ht * (0.95 - 0.55 * i / n))}`; }
    }
  }
  const gill = `M19 ${f(top(19) * 0.82)}Q25 0 19 ${f(bot(19) * 0.86)}`;
  const lat = `M22 ${f(-h * 0.08)}Q52 ${f(h * 0.06)} ${PED} 0`;
  const eyeY = f(-h * 0.22);

  // markings
  let marks = '';
  if (mode !== 'locked') {
    const inBody = (x, k) => { const y0 = top(x) * k, y1 = bot(x) * k; return y0 + (y1 - y0) * rnd(); };
    if (F.marks === 'spots' || F.marks === 'dots' || F.marks === 'pale') {
      const n = F.marks === 'dots' ? 8 : 15, x0 = F.marks === 'dots' ? 22 : 24, x1 = F.marks === 'dots' ? 50 : 80;
      for (let i = 0; i < n; i++) { const x = x0 + rnd() * (x1 - x0), y = inBody(x, F.marks === 'pale' ? 0.7 : 0.62); marks += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.8 + rnd() * 0.8)}"${F.marks === 'pale' ? ' class="pale"' : ''}/>`; }
    } else if (F.marks === 'cross') {
      for (let i = 0; i < 12; i++) { const x = 24 + rnd() * 54, y = inBody(x, 0.55); marks += `<path class="x" d="M${f(x - 1)} ${f(y - 1)}l2 2m0 -2l-2 2"/>`; }
    } else if (F.marks === 'stripes') {
      for (let i = 0; i < 6; i++) { const x = 28 + i * 9; marks += `<path class="bar" d="M${x} ${f(top(x) * 0.9)}Q${x + 2} 0 ${x - 1} ${f(bot(x) * 0.55)}"/>`; }
    } else if (F.marks === 'bars') {
      for (let i = 0; i < 16; i++) { const x = 22 + rnd() * 58, y = inBody(x, 0.6); marks += `<ellipse class="pale" cx="${f(x)}" cy="${f(y)}" rx="1.8" ry="0.9"/>`; }
    } else if (F.marks === 'band') {
      marks += `<path class="band" d="M18 ${f(-h * 0.05)}Q50 ${f(h * 0.1)} ${PED} 0"/>`;
      for (let i = 0; i < 14; i++) { const x = 30 + rnd() * 52, y = inBody(x, 0.55); marks += `<circle cx="${f(x)}" cy="${f(Math.min(y, -h * 0.1))}" r="0.7"/>`; }
    } else if (F.marks === 'scales') {
      for (let r = -1; r <= 1; r++) for (let x = 26; x < 78; x += 6) { const y = r * h * 0.38 + (x % 12 ? 1.2 : -1.2); marks += `<path class="sc" d="M${x} ${f(y)}q2.4 2.6 4.8 0"/>`; }
    }
  }
  const barbels = F.barbels ? `<path class="ln" d="M2.5 ${f(h * 0.28)}q-1.5 3 0 5.5M5 ${f(h * 0.34)}q0 3 2 5"/>` : '';
  let bellyWash = '';
  if (F.belly && mode !== 'locked') {
    let d = `M6 ${f(bot(6) * 0.25)}Q40 ${f(h * 0.25)} 80 ${f(bot(80) * 0.35)}`;
    for (let x = 80; x >= 6; x -= 2) d += `L${x} ${f(bot(x))}`;
    bellyWash = `<path d="${d}Z" fill="${F.belly}" fill-opacity=".38" stroke="none"/>`;
  }

  const minY = Math.min(top(F.dor[0]) - F.dor[2] * 1.05, F.dor2 ? top(F.dor2[0]) - F.dor2[2] : 0, -S) - 1.2;
  const maxY = Math.max(bot(45) + h * 0.45, bot(65) + h * 0.42, S, h * 1.05 + 1) + 1.2;
  const vb = mode === 'ruler' ? `0 ${f(minY)} ${PED + T} ${f(maxY - minY)}` : `-1.5 ${f(minY)} ${PED + T + 3} ${f(maxY - minY)}`;
  const locked = mode === 'locked';
  const wash = locked ? 'none' : F.tint;
  const svg = `<svg class="fish-sketch" viewBox="${vb}"${mode === 'ruler' ? ' preserveAspectRatio="none"' : ''} aria-hidden="true">
<g fill="${wash}" fill-opacity="${locked ? 0 : 0.5}" stroke="currentColor" stroke-width="${locked ? 0.9 : 1.1}" stroke-linejoin="round" stroke-linecap="round"${locked ? ' stroke-dasharray="2.2 1.8"' : ''}>
<path d="${tail}"/><path d="${fins}"/><path d="${body}"/>${bellyWash}<path d="${pect}" fill-opacity="${locked ? 0 : 0.35}"/>
${locked ? '' : `<path d="${gill}" fill="none"/><path d="${lat}" fill="none" stroke-dasharray="1.4 1.8" stroke-width="0.7"/><path d="${rays}" fill="none" stroke-width="0.6"/>`}
<circle cx="8.6" cy="${eyeY}" r="${locked ? 1.6 : 2}" fill="${locked ? 'none' : '#fbf6ea'}" fill-opacity="1"/>${locked ? '' : `<circle cx="9" cy="${eyeY}" r="1" fill="currentColor" stroke="none" fill-opacity="1"/><path d="M0.6 ${f(h * 0.12)}L4.6 ${f(h * 0.2)}" fill="none" stroke-width="0.8"/>`}
</g>${marks ? `<g class="fs-marks" fill="currentColor" stroke="none">${marks}</g>` : ''}${barbels ? `<g fill="none" stroke="currentColor" stroke-width="0.7">${barbels}</g>` : ''}
</svg>`;
  const out = { svg, aspect: (maxY - minY) / (PED + T) };
  _sketchCache.set(key, out);
  return out;
}

// tiny tackle-box drawings for the lure bar
const LURE_ICON = {
  spinner: '<svg viewBox="0 0 30 15" aria-hidden="true"><path d="M1 7.5h6" stroke="#6b6b62" stroke-width="1.2"/><ellipse cx="11" cy="5.6" rx="4.6" ry="2.6" transform="rotate(-24 11 5.6)" fill="#ecd28f" stroke="#75551d" stroke-width=".8"/><rect x="9" y="6.6" width="10" height="3" rx="1.5" fill="#c39a48"/><path d="M19 8.1h3.4" stroke="#6b6b62" stroke-width="1.1"/><path d="M20.4 6.9l2.2-2.2.4 2.6z" fill="#cf3a2c"/><path d="M22.4 8.1c2.8 0 3.8-2.4 3.8-4M22.4 8.1c2.8 0 3.8 2.4 3.8 4" fill="none" stroke="#3c4440" stroke-width="1.1" stroke-linecap="round"/></svg>',
  spoon: '<svg viewBox="0 0 30 15" aria-hidden="true"><path d="M1 7.5h3.6" stroke="#6b6b62" stroke-width="1.2"/><circle cx="5.8" cy="7.5" r="1.3" fill="none" stroke="#6b6b62"/><path d="M7.4 7.5C9 2.6 21 2.2 24 7.5 21 12.8 9 12.4 7.4 7.5Z" fill="#cf3a2c"/><path d="M11.4 4.3c3-.8 6-.7 8 .2v6c-2 .9-5 1-8 .2Z" fill="#fbf6ea"/><path d="M24 7.5c2.6 0 3.6-2 3.6-3.6M24 7.5c2.6 0 3.6 2 3.6 3.6" fill="none" stroke="#3c4440" stroke-width="1.1" stroke-linecap="round"/></svg>',
  minnow: '<svg viewBox="0 0 30 15" aria-hidden="true"><path d="M3.4 9.2 1 11.2" stroke="#9fc9d2" stroke-width="2.4" stroke-linecap="round"/><path d="M3 7.5C6 3 17 3.2 23 6.2l4.5-2.4-.5 3.8.5 3.6L23 9c-6 3-17 3-20-1.5Z" fill="#76884a"/><path d="M4.2 8.4C8 11 17 11 23 8.6" fill="none" stroke="#efe8cc" stroke-width="2"/><circle cx="7.2" cy="6.6" r="1.25" fill="#22302a"/></svg>',
  float: '<svg viewBox="0 0 30 15" aria-hidden="true"><path d="M2 12.5q6-2 11 0t11 0 6 0" fill="none" stroke="#6fbfcd" stroke-width="1.1"/><path d="M15 .4v3" stroke="#22302a" stroke-width="1.2"/><path d="M15 3c4 2 4 4.4 0 4.8-4-.4-4-2.8 0-4.8Z" fill="#cf3a2c"/><path d="M15 7.8c3 .4 2.6 3.4 0 5-2.6-1.6-3-4.6 0-5Z" fill="#fbf6ea" stroke="#9c9a88" stroke-width=".6"/></svg>',
};
