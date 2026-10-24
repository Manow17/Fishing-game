import * as THREE from 'three';
import { createRenderer, createComposer } from './render.js';
import { buildWorld } from './world/world.js';
import { Game } from './game/game.js';
import { preloadFish, FISH_SPECIES } from './models/fish.js';

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

(async () => {
  const world = await buildWorld(scene, renderer, progress);
  // build every species' geometry + 2 colour variants now, so fish never hitch in-game
  for (let i = 0; i < FISH_SPECIES.length; i++) {
    progress(0.93 + 0.05 * i / FISH_SPECIES.length, 'Stocking the river…');
    await new Promise(r => setTimeout(r, 0));
    preloadFish([FISH_SPECIES[i]], 2);
  }
  progress(0.98, 'Rigging the boat…');
  const game = new Game({ renderer, scene, camera, world, post });
  await game.init();
  game.update(1 / 60);
  world.updateReflections(camera.position, true);
  progress(1, 'Ready');
  const loading = document.getElementById('loading');
  loading.style.opacity = 0;
  setTimeout(() => loading.remove(), 700);
  game.showMenu();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    game.update(dt);
    post.render(dt);
    game.renderOverlay();
  });
  window.__game = game;
})().catch(err => {
  console.error(err);
  loadText.textContent = 'Failed to load: ' + err.message;
});
