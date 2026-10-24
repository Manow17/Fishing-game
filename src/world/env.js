// The active map's physical environment. Game systems (boat, fishing, fish AI, effects, land,
// audio, HUD) only talk to the world through ENV, so any map that fills it in just works.
// A world builder installs its implementation with setEnv({...}) before the game starts.
//
// Contract (all distances in metres, +Y up, x/z horizontal):
//   id, name                 'river' | 'ocean' …, display name
//   time                     seconds; the world advances it each frame (same clock as the water shader)
//   waveScale                lobby setting 0..4 (1 = default). waveHeight() and the water shader must honour it
//   waterLevel(x, z)         calm water surface height (no waves)
//   waveHeight(x, z, t)      vertical wave displacement at time t, ALREADY multiplied by waveScale;
//                            must match what the water shader draws so boats and floats sit on the waves
//   surface(x, z)            waterLevel + waveHeight at ENV.time (provided below)
//   flowAt(x, z, out)        water current {x, z, speed} in m/s (0 where there's no current)
//   groundY(x, z)            terrain / sea-bed height (fast; called many times per frame)
//   depth(x, z)              max(0, waterLevel - groundY)
//   habitat(x, z, depth)     object of 0..1 scores whose keys match the habitat prefs of this map's species
//   rapids(x, z)             0..1 white-water strength (audio, foam)
//   bounds                   {x0, x1, z0, z1} playable rectangle for boats
//   obstacles                [{x, z, r}] circles boats collide with (rocks, pilings…)
//   spawn                    {x, z, h} boat start position and heading (h: yaw, forward = (sin h, cos h))
//   species                  ids of the species that live on this map (see game/species.js)
//   tackle                   {lineBreakKg, dragMaxKg} default line strength and drag range here
//   drawMap(ctx, toPx, S, view)  optional minimap painter (water/land shapes); river map uses the built-in one
export const ENV = {
  id: 'river',
  name: 'Aare Valley',
  time: 0,
  waveScale: 1,
  waterLevel: () => 0,
  waveHeight: () => 0,
  surface(x, z) { return this.waterLevel(x, z) + this.waveHeight(x, z, this.time); },
  flowAt: (x, z, out = {}) => { out.x = 0; out.z = 0; out.speed = 0; return out; },
  groundY: () => -10,
  depth(x, z) { return Math.max(0, this.waterLevel(x, z) - this.groundY(x, z)); },
  habitat: () => ({}),
  rapids: () => 0,
  bounds: { x0: -1e4, x1: 1e4, z0: -1e4, z1: 1e4 },
  obstacles: [],
  spawn: { x: 0, z: 0, h: 0 },
  species: [],
  tackle: { lineBreakKg: 7.2, dragMaxKg: 5.9 },
  drawMap: null,
};

export function setEnv(impl) { Object.assign(ENV, impl); }

// Wave-height listeners (the water shader uniform, remote clients) are notified on change.
const waveListeners = new Set();
export function onWaveScale(fn) { waveListeners.add(fn); fn(ENV.waveScale); }
export function setWaveScale(v) {
  ENV.waveScale = Math.max(0, Math.min(4, +v || 0));
  for (const fn of waveListeners) fn(ENV.waveScale);
}

// Which map to build: ?map=ocean in the URL (multiplayer joiners follow the host's map).
export const MAPS = [
  { id: 'river', name: 'Aare Valley', desc: 'Glacial river, gorge, side waters and a lake' },
  { id: 'ocean', name: 'Open Ocean', desc: 'Island harbour, reefs and deep blue water — sharks and giants' },
];
export function currentMapId() {
  const m = new URLSearchParams(location.search).get('map');
  return MAPS.some(x => x.id === m) ? m : 'river';
}
