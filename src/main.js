import * as THREE from 'three';
import { createRenderer, createComposer } from './render.js';
import { Game } from './game/game.js';
import { preloadFish } from './models/fish.js';
import { ENV, currentMapId } from './world/env.js';

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.12, 30000);
const post = createComposer(renderer, scene, camera);

const loadFill = document.getElementById('load-fill');
const loadText = document.getElementById('load-text');
const progress = (p, msg) => { loadFill.style.width = `${Math.round(p * 100)}%`; loadText.textContent = msg; };

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
});

// Each map is its own world builder; only the chosen one is downloaded and built.
async function buildMap(id) {
  if (id === 'ocean') {
    const { buildOceanWorld } = await import('./world/ocean/oceanWorld.js');
    return buildOceanWorld(scene, renderer, progress);
  }
  const { buildWorld } = await import('./world/world.js');
  return buildWorld(scene, renderer, progress);
}

(async () => {
  const world = await buildMap(currentMapId());
  // build this map's species (geometry + 2 colour variants) now, so fish never hitch in-game
  const ids = ENV.species;
  for (let i = 0; i < ids.length; i++) {
    progress(0.93 + 0.05 * i / ids.length, ENV.id === 'ocean' ? 'Stocking the deep…' : 'Stocking the river…');
    await new Promise(r => setTimeout(r, 0));
    preloadFish([ids[i]], 2);
  }
  progress(0.98, 'Rigging the boat…');
  await new Promise(r => setTimeout(r, 0));
  // shared boat textures for every type, so switching boats in the Werkstatt never hitches
  const { preloadBoatAssets } = await import('./models/boat.js');
  preloadBoatAssets?.();
  const game = new Game({ renderer, scene, camera, world, post });
  await game.init();
  game.update(1 / 60);
  world.updateReflections(camera.position, true);
  progress(1, 'Ready');
  const loading = document.getElementById('loading');
  loading.style.opacity = 0;
  setTimeout(() => loading.remove(), 700);
  game.showMenu();
  game.autoStart();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    game.update(dt);
    post.render(dt);
    game.renderOverlay(dt);
  });
  window.__game = game;
})().catch(err => {
  console.error(err);
  loadText.textContent = 'Failed to load: ' + err.message;
});
