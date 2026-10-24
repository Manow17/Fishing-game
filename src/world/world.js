// Builds the whole environment step by step (with progress callbacks).
import * as THREE from 'three';
import { createTerrain, bakeHeightTexture, heightAt } from './terrain.js';
import { createWater } from './water.js';
import { createSky } from './sky.js';
import { createForest, createRocks, createGrass } from './vegetation.js';
import { computeLayout } from './layout.js';
import { flowAt } from './river.js';
import { createAmbientLife } from './life.js';
import { createWaterfall } from './waterfall.js';

// Yield so the loading bar can paint; the timeout keeps loading going in background tabs.
const frame = () => new Promise(r => { requestAnimationFrame(() => r()); setTimeout(r, 60); });

export async function buildWorld(scene, renderer, progress = () => {}) {
  const time = { value: 0 };
  const world = { time, updaters: [] };

  progress(0.05, 'Carving the valley…'); await frame();
  const terrain = createTerrain(scene, time);
  world.terrain = terrain;

  progress(0.3, 'Painting the sky…'); await frame();
  const sky = createSky(scene, renderer, terrain.shared.noise, time);
  world.sky = sky;

  progress(0.4, 'Filling the river…'); await frame();
  const water = createWater(scene, time);
  water.setSun(sky.sunDir, sky.sunColor);
  water.setEnv(sky.cubeTexture);
  world.water = water;

  progress(0.5, 'Placing the village…'); await frame();
  const layout = computeLayout();
  world.layout = layout;

  progress(0.55, 'Growing the forests…'); await frame();
  world.forest = createForest(scene, time, layout.exclusions);
  world.rocks = createRocks(scene, terrain.shared.rock, time);

  progress(0.7, 'Sowing alpine meadows…'); await frame();
  const bake = bakeHeightTexture();
  world.grass = createGrass(scene, bake, time, { color: sky.sunColor, dir: sky.sunDir });

  progress(0.8, 'Building chalets…'); await frame();
  try {
    const village = await import('../models/village.js');
    world.village = placeVillage(scene, village, layout);
  } catch (e) {
    console.warn('Village models unavailable:', e);
    world.village = { update() {} };
  }

  world.life = createAmbientLife(scene, time);
  world.waterfall = createWaterfall(scene, terrain.shared.noise, time);

  progress(0.92, 'Catching reflections…'); await frame();

  world.update = (dt, camera, focus) => {
    time.value += dt;
    world.forest.refresh(camera.position);
    world.grass.update(focus || camera.position);
    sky.follow(focus || camera.position);
    water.update(dt, (x, z) => flowAt(x, z, _f));
    world.village.update(dt, time.value);
    world.life.update(dt, camera.position);
    world.waterfall.update(dt);
  };
  world.updateReflections = (pos, force) => sky.updateReflections(pos, water.meshes, force);
  return world;
}
const _f = {};

function placeVillage(scene, V, L) {
  const animated = [];
  const put = (obj, p, yaw = 0, sink = 0) => {
    obj.position.set(p.x, (p.y ?? heightAt(p.x, p.z)) - sink, p.z);
    obj.rotation.y = yaw;
    scene.add(obj);
    return obj;
  };
  const lowest = (p, r) => {
    let m = Infinity;
    for (let a = 0; a < 6.28; a += 0.8) m = Math.min(m, heightAt(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r));
    return Math.min(m, heightAt(p.x, p.z));
  };
  const safe = (fn) => { try { return fn(); } catch (e) { console.warn(e); return null; } };

  for (const d of L.docks) safe(() => put(V.createDock(14), d, d.yaw));
  for (const fl of L.flags) if (V.createFlagPole) safe(() => { const f = V.createFlagPole('swiss'); put(f.object, fl); animated.push(f); });
  if (L.church) safe(() => put(V.createChurch(), { ...L.church, y: lowest(L.church, 7) + 0.2 }, L.church.yaw));
  for (const c of L.chalets) safe(() => put(V.createChalet(c.seed), { ...c, y: lowest(c, 6) + 0.25 }, c.yaw));
  for (const b of L.barns) safe(() => put(V.createBarn(b.seed), { ...b, y: lowest(b, 4) + 0.2 }, b.yaw));
  for (const c of L.cows) safe(() => { const cow = V.createCow(c.seed); put(cow.object, c, c.yaw); animated.push(cow); });
  for (const f of L.fences) safe(() => put(V.createFence(f.len), f, f.yaw));
  for (const b of L.bales) safe(() => V.createHayBale && put(V.createHayBale(b.seed), b, b.seed));
  for (const b of L.benches) safe(() => V.createBench && put(V.createBench(), b, b.yaw));
  return {
    update(dt, t) { for (const a of animated) a.update(dt, t); },
  };
}
