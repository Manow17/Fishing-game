// "Open Ocean" map: an island with a harbour, beaches, cliffs, a lighthouse and a fringing reef,
// a shelf that breaks into deep blue water, and a Gerstner-wave sea the boats ride on.
// buildOceanWorld() installs the map's ENV implementation and returns the world object the game uses.
import { ENV, setEnv } from '../env.js';
import { OceanWaves } from './oceanWaves.js';
import { bakeOcean, makeSampler, createOceanTerrain, createOceanTerrainMaterial, sandTexture, paveTexture, bakeGrass, NEAR, FAR } from './oceanTerrain.js';
import { createOceanWater } from './oceanWater.js';
import { createOceanSky } from './oceanSky.js';
import { waterUniforms } from './oceanShading.js';
import { PLACES, basinSDF } from './islandShape.js';
import { grassTexture, rockTexture, noiseTexture } from '../../util/textures.js';
import { Simplex2, smoothstep, clamp } from '../../util/noise.js';

// Yield so the loading bar can paint; the timeout keeps loading going in background tabs.
const frame = () => new Promise(r => { requestAnimationFrame(() => r()); setTimeout(r, 60); });
const OPTIONAL = async (name, fn, fallback) => { try { return await fn(); } catch (e) { console.warn(`[ocean] ${name} unavailable:`, e); return fallback; } };

export const OCEAN_SPECIES = ['greatWhite', 'hammerhead', 'mako', 'blueMarlin', 'swordfish', 'bluefinTuna', 'yellowfinTuna', 'mahiMahi', 'giantGrouper', 'barracuda'];

export async function buildOceanWorld(scene, renderer, progress = () => {}) {
  const T0 = performance.now();
  let waited = 0;   // time spent yielding to the loading screen (not work)
  const step = async (p, msg) => { progress(p, msg); const t = performance.now(); await frame(); waited += performance.now() - t; };
  const time = { value: 0 };
  const world = { time };

  await step(0.03, 'Charting the island…');
  const bake = await bakeOcean(progress, 0.03, 0.32);
  const S = makeSampler(bake);
  world.sampler = S;

  // ---- environment contract (installed early so placement code can use it)
  const waves = new OceanWaves();
  world.waves = waves;
  installEnv(S, waves);

  await step(0.34, 'Painting the sky…');
  const noise = noiseTexture();
  const sky = createOceanSky(scene, renderer, noise, time);
  world.sky = sky;

  await step(0.4, 'Laying the sea bed…');
  const waterU = waterUniforms(time, noise, sky.sunDir);
  const shared = { grass: grassTexture(), rock: rockTexture(), sand: sandTexture(), pave: paveTexture(), noise };
  const terrainMat = createOceanTerrainMaterial(shared, waterU);
  world.terrain = createOceanTerrain(scene, bake, terrainMat);
  world.terrain.material = terrainMat;
  world.shared = shared;

  await step(0.5, 'Filling the ocean…');
  const water = createOceanWater(scene, time, waves, { tNear: bake.tNear, tFar: bake.tFar, near: NEAR, far: FAR });
  water.setSun(sky.sunDir, sky.sunColor, sky.sunIntensity);
  water.setEnv(sky.cubeTexture);
  water.uniforms.uAmbient.value.copy(sky.hemi.color).multiplyScalar(sky.hemi.intensity * 0.9);
  world.water = water;

  // ---- layout (harbour, docks, shop spots, colliders)
  const D = PLACES.dock;
  const layout = {
    docks: [{ x: D.x, y: PLACES.quayY - 0.2, z: D.z, yaw: D.yaw }],
    shops: [{ x: D.x - 7, z: D.z - 13, yaw: Math.PI / 2 }],
    colliders: [],
    homeMark: { x: D.x - 4, z: D.z, label: 'Harbour' },
    lighthouse: { ...PLACES.lighthouse },
    buoys: [],
    exclusions: [],
  };
  world.layout = layout;
  world.forest = { trees: [] };
  const obstacles = [];
  for (const s of PLACES.stacks) obstacles.push({ x: s.x, z: s.z, r: s.r * 0.95 });

  const updaters = [];
  world.updaters = updaters;

  await step(0.6, 'Building the harbour…');
  await OPTIONAL('harbour', async () => {
    const { createHarbour } = await import('./harbour.js');
    const h = await createHarbour(scene, { S, waves, time, sky, layout, obstacles, shared, waterU, trees: world.forest.trees });
    updaters.push(h);
  });

  await step(0.72, 'Growing pines and palms…');
  await OPTIONAL('flora', async () => {
    const { createFlora } = await import('./oceanFlora.js');
    const f = createFlora(scene, { S, bake, time, sky, layout, obstacles, shared, waterU });
    world.forest = { trees: f.trees };
    updaters.push(f);
  });
  await OPTIONAL('grass', async () => {
    const { createGrass } = await import('../vegetation.js');
    const g = createGrass(scene, bakeGrass(bake), time, { color: sky.sunColor, dir: sky.sunDir });
    world.grass = g;
    updaters.push({ update(dt, t, cam, focus) {
      const p = focus || cam.position;
      g.mesh.visible = S.shoreDist(p.x, p.z) < 120 && cam.position.y < 160;
      if (g.mesh.visible) g.update(p);
    } });
  });

  await step(0.84, 'Calling the gulls…');
  await OPTIONAL('scenery', async () => {
    const { createScenery } = await import('./oceanScenery.js');
    updaters.push(createScenery(scene, { S, waves, time, sky, layout }));
  });

  ENV.obstacles = obstacles;
  await OPTIONAL('map', async () => {
    const { createMapPainter } = await import('./oceanMap.js');
    ENV.drawMap = createMapPainter(bake, layout);
  });
  await step(0.95, 'Catching reflections…');

  world.update = (dt, camera, focus) => {
    time.value += dt;
    ENV.time = time.value;
    water.follow(camera, time.value);
    water.update(dt);
    const storm = smoothstep(1.4, 3.8, ENV.waveScale);
    if (sky.setStorm) sky.setStorm(storm);
    water.uniforms.uSunI.value = sky.sun.intensity;
    sky.follow(focus || camera.position);
    for (const u of updaters) u.update && u.update(dt, time.value, camera, focus);
  };
  world.updateReflections = (pos, force) => sky.updateReflections(pos, water.meshes, force);
  world.buildMs = performance.now() - T0;
  world.buildWorkMs = world.buildMs - waited - bake.waited;
  console.log(`[ocean] world built in ${world.buildMs.toFixed(0)} ms (${world.buildWorkMs.toFixed(0)} ms of work), terrain ${world.terrain.triangles} tris`);
  return world;
}

// ---------------------------------------------------------------- ENV
const nBait = new Simplex2(909);
const _fo = {};

function installEnv(S, waves) {
  const C = PLACES.center, R = 640;
  const B = PLACES.basin, bcx = (B.x0 + B.x1) / 2, bcz = (B.z0 + B.z1) / 2;
  const attFn = S.att;
  setEnv({
    id: 'ocean',
    name: 'Open Ocean',
    time: 0,
    waterLevel: () => 0,
    waveHeight(x, z, t) {
      waves.setScale(ENV.waveScale);
      return waves.height(x, z, t, attFn);
    },
    // Gentle drift to the ENE plus a slow tidal stream that flows around the island (potential flow
    // past a cylinder), calmed in the shallows and inside the harbour. Never above 0.4 m/s.
    flowAt(x, z, out = {}) {
      const t = ENV.time || 0;
      const tide = 0.12 * Math.cos(t * (2 * Math.PI / 1500));
      let ux = 0.055 * 0.9 + tide, uz = -0.055 * 0.43;
      const dx = x - C.x, dz = z - C.z, r2 = dx * dx + dz * dz;
      if (r2 > R * R * 0.25) {
        const k = (R * R) / r2, inv = 1 / Math.sqrt(r2), nx = dx * inv, nz = dz * inv;
        const en = ux * nx + uz * nz;
        ux = ux + k * (ux - 2 * en * nx);
        uz = uz + k * (uz - 2 * en * nz);
      } else { ux = 0; uz = 0; }
      const depth = Math.max(0, -S.groundY(x, z));
      let damp = smoothstep(0.3, 6, depth);
      const hb = (x - bcx) ** 2 + (z - bcz) ** 2;
      if (hb < 250 * 250) damp *= smoothstep(-5, 50, basinSDF(x, z));
      ux *= damp; uz *= damp;
      let sp = Math.hypot(ux, uz);
      if (sp > 0.4) { ux *= 0.4 / sp; uz *= 0.4 / sp; sp = 0.4; }
      out.x = ux; out.z = uz; out.speed = sp;
      return out;
    },
    groundY: S.groundY,
    depth(x, z) { return Math.max(0, -S.groundY(x, z)); },
    habitat(x, z, depth) {
      const d = depth ?? Math.max(0, -S.groundY(x, z));
      const reef = S.reef(x, z);
      const slope = d > 15 ? S.slope(x, z) : 0;
      const sd = S.shoreDist(x, z);
      const bait = 0.5 + 0.5 * nBait.fbm(x * 0.0011, z * 0.0011, 2);
      return {
        reef: clamp(reef * 1.15, 0, 1) * (1 - smoothstep(40, 90, d)),
        shallows: (1 - smoothstep(3, 12, d)) * smoothstep(0.4, 1.5, d),
        open: smoothstep(30, 90, d) * smoothstep(120, 300, sd),
        deep: smoothstep(80, 300, d),
        surface: smoothstep(15, 45, d) * smoothstep(0.35, 0.75, bait),
        dropoff: smoothstep(0.1, 0.4, slope) * smoothstep(25, 60, d) * (1 - smoothstep(450, 750, d)),
      };
    },
    rapids: () => 0,
    bounds: { x0: -4000, x1: 4000, z0: -4000, z1: 4000 },
    obstacles: [],
    spawn: { x: PLACES.dock.x + 8, z: PLACES.dock.z + 4.3, h: Math.PI / 2 },
    species: OCEAN_SPECIES.slice(),
    tackle: { lineBreakKg: 90, dragMaxKg: 40, spoolM: 600 },
    drawMap: null,
  });
  ENV.flowAt(0, 0, _fo);
}
