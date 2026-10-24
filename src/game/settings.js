// "Einstellungen": lobby settings (owner only: wave size, map) + graphics quality.
import { ENV, MAPS, setWaveScale } from '../world/env.js';

const $ = (id) => document.getElementById(id);
export const QUALITY = [
  { id: 'perf', name: 'Performance', scale: 0.75 },
  { id: 'balanced', name: 'Balanced', scale: 1 },
  { id: 'sharp', name: 'Sharp', scale: 1.3 },
  { id: 'ultra', name: 'Ultra', scale: 1.6 },
];
const WAVE_NAMES = [[0, 'Mirror calm'], [0.6, 'Gentle'], [1.2, 'Normal'], [2, 'Choppy'], [3, 'Stormy'], [4.01, 'Huge']];
export const waveName = (v) => (WAVE_NAMES.find(([t]) => v < t + 0.3) || WAVE_NAMES[WAVE_NAMES.length - 1])[1];

export function loadGfx() {
  try { return { quality: 'sharp', sharpen: true, ...JSON.parse(localStorage.getItem('af-gfx') || '{}') }; }
  catch (_) { return { quality: 'sharp', sharpen: true }; }
}

export class Settings {
  constructor(game) {
    this.game = game;
    this.el = $('settings');
    $('set-close').onclick = () => this.close();
  }
  get open() { return !this.el.classList.contains('hidden'); }
  get isOwner() { const n = this.game.network; return !n.active || n.isHost; }

  show() {
    this.el.classList.remove('hidden');
    this.game.input.exitLock();
    this.render();
  }
  close() {
    this.el.classList.add('hidden');
    if (this.game.mode !== 'menu') this.game.input.requestLock();
  }

  render() {
    const g = this.game, gfx = g.gfx, owner = this.isOwner;
    const maps = MAPS.map(m => `<button class="set-map ${m.id === ENV.id ? 'on' : ''}" data-map="${m.id}" ${owner ? '' : 'disabled'}><b>${m.name}</b><span>${m.desc}</span></button>`).join('');
    const q = QUALITY.map(o => `<button class="ws-chip ${o.id === gfx.quality ? 'on' : ''}" data-q="${o.id}">${o.name}</button>`).join('');
    $('set-body').innerHTML = `
      <section class="set-sec">
        <h3>Lobby <span>${owner ? (g.network.active ? 'you own this lobby' : 'solo') : 'set by the lobby owner'}</span></h3>
        <div class="ws-row"><span class="ws-lbl">Waves <em id="set-wave-v">${waveName(ENV.waveScale)} · ×${ENV.waveScale.toFixed(1)}</em></span>
          <input type="range" id="set-wave" min="0" max="4" step="0.1" value="${ENV.waveScale}" ${owner ? '' : 'disabled'}></div>
        <div class="ws-row"><span class="ws-lbl">Water</span><div class="set-maps">${maps}</div></div>
        ${owner ? '' : '<div class="ws-note">Only the lobby owner can change the waves and the map.</div>'}
      </section>
      <section class="set-sec">
        <h3>Graphics <span>sharpness vs. speed</span></h3>
        <div class="ws-row"><span class="ws-lbl">Render quality</span><div class="ws-chips">${q}</div></div>
        <div class="ws-row"><span class="ws-lbl">Sharpen</span><div class="ws-chips">
          <button class="ws-chip ${gfx.sharpen ? 'on' : ''}" data-sh="1">On</button><button class="ws-chip ${gfx.sharpen ? '' : 'on'}" data-sh="0">Off</button></div></div>
      </section>`;
    const wave = $('set-wave');
    wave.oninput = () => {
      setWaveScale(+wave.value);
      $('set-wave-v').textContent = `${waveName(ENV.waveScale)} · ×${ENV.waveScale.toFixed(1)}`;
      g.broadcastSettings();
    };
    this.el.querySelectorAll('[data-map]').forEach(b => b.onclick = () => { if (b.dataset.map !== ENV.id) g.switchMap(b.dataset.map); });
    this.el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { gfx.quality = b.dataset.q; g.applyGfx(); this.render(); });
    this.el.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => { gfx.sharpen = b.dataset.sh === '1'; g.applyGfx(); this.render(); });
  }
}
