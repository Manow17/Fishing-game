// Procedural, seamless canvas textures used by the environment.
import * as THREE from 'three';
import { tileFbm, mulberry32 } from './noise.js';

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function toTexture(canvas, { srgb = true, repeat = true, aniso = 16 } = {}) { // three clamps to the GPU max
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// Fill a canvas pixel-by-pixel with fn(u, v) -> [r,g,b] (0..255) or [r,g,b,a]
export function paintPixels(canvas, fn) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x / w, y / h, x, y);
      const i = (y * w + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c.length > 3 ? c[3] : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return ctx;
}

// Draw something with wrap-around so the texture stays seamless.
export function wrapDraw(ctx, size, x, y, r, draw) {
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    const px = x + ox * size, py = y + oy * size;
    if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
    draw(px, py);
  }
}

// Turn a height function into a tangent-space normal map canvas.
export function heightToNormal(size, heightFn, strength = 2) {
  const hts = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) hts[y * size + x] = heightFn(x / size, y / size);
  const c = makeCanvas(size);
  const at = (x, y) => hts[((y + size) % size) * size + ((x + size) % size)];
  paintPixels(c, (u, v, x, y) => {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    return [(-dx / l * 0.5 + 0.5) * 255, (-dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
  });
  return c;
}

const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

export function grassTexture(size = 512) {
  const n1 = tileFbm(3, 8, 5), n2 = tileFbm(9, 32, 3), n3 = tileFbm(17, 64, 2);
  const c = makeCanvas(size);
  const ctx = paintPixels(c, (u, v) => {
    const a = n1(u, v), b = n2(u, v), s = n3(u, v);
    let col = mix3([38, 74, 26], [96, 132, 46], a);
    col = mix3(col, [128, 138, 66], Math.max(0, b - 0.55) * 1.6);
    const k = 0.75 + s * 0.45;
    return [col[0] * k, col[1] * k, col[2] * k];
  });
  // blades / strokes
  const rnd = mulberry32(42);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * size, y = rnd() * size, len = 3 + rnd() * 7, ang = -Math.PI / 2 + (rnd() - 0.5) * 1.2;
    const g = 90 + rnd() * 100;
    ctx.strokeStyle = `rgba(${g * 0.55 | 0},${g | 0},${g * 0.3 | 0},${0.25 + rnd() * 0.35})`;
    ctx.lineWidth = 0.6 + rnd() * 0.8;
    wrapDraw(ctx, size, x, y, len, (px, py) => {
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len); ctx.stroke();
    });
  }
  // tiny alpine flowers
  const flowerCols = ['#ffffff', '#ffe14d', '#f7f2c0', '#c56be8', '#4f7bff', '#ff6a4d'];
  for (let i = 0; i < 260; i++) {
    const x = rnd() * size, y = rnd() * size, r = 0.8 + rnd() * 1.3;
    ctx.fillStyle = flowerCols[(rnd() * flowerCols.length) | 0];
    wrapDraw(ctx, size, x, y, r, (px, py) => { ctx.beginPath(); ctx.arc(px, py, r, 0, 6.283); ctx.fill(); });
  }
  return toTexture(c);
}

export function rockTexture(size = 512) {
  const n1 = tileFbm(5, 4, 6), n2 = tileFbm(31, 16, 4), n3 = tileFbm(77, 8, 3);
  const c = makeCanvas(size);
  paintPixels(c, (u, v) => {
    const a = n1(u, v), b = n2(u, v), m = n3(u, v);
    const strata = 0.5 + 0.5 * Math.sin((v * 6 + a * 3) * Math.PI * 2);
    let col = mix3([96, 92, 88], [158, 152, 142], a * 0.7 + strata * 0.3);
    const crack = Math.pow(1 - Math.abs(b - 0.5) * 2, 40);
    col = mix3(col, [70, 66, 62], crack * 0.35);
    const lichen = Math.max(0, m - 0.6) * 2.5;
    col = mix3(col, [128, 132, 82], lichen * 0.6);
    const k = 0.85 + b * 0.3;
    return [col[0] * k, col[1] * k, col[2] * k];
  });
  return toTexture(c);
}

export function gravelTexture(size = 512) {
  const n1 = tileFbm(12, 8, 4);
  const c = makeCanvas(size);
  const ctx = paintPixels(c, (u, v) => {
    const a = n1(u, v);
    const g = 110 + a * 60;
    return [g * 1.02, g * 0.97, g * 0.88];
  });
  const rnd = mulberry32(99);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * size, y = rnd() * size;
    const r = 2 + Math.pow(rnd(), 2) * 9;
    const rr = r * (0.6 + rnd() * 0.4), ang = rnd() * Math.PI;
    const tone = rnd();
    const base = tone < 0.15 ? [200, 196, 186] : tone < 0.5 ? [150, 146, 138] : tone < 0.8 ? [118, 112, 104] : [170, 150, 120];
    const k = 0.75 + rnd() * 0.35;
    wrapDraw(ctx, size, x, y, r, (px, py) => {
      const grd = ctx.createRadialGradient(px - r * 0.3, py - r * 0.3, r * 0.1, px, py, r);
      grd.addColorStop(0, `rgb(${base[0] * k * 1.15 | 0},${base[1] * k * 1.15 | 0},${base[2] * k * 1.15 | 0})`);
      grd.addColorStop(1, `rgb(${base[0] * k * 0.6 | 0},${base[1] * k * 0.6 | 0},${base[2] * k * 0.6 | 0})`);
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.ellipse(px, py, r, rr, ang, 0, 6.283); ctx.fill();
    });
  }
  return toTexture(c);
}

// RGBA channels hold independent smooth noise at different frequencies (linear data).
export function noiseTexture(size = 256) {
  const a = tileFbm(1, 4, 5), b = tileFbm(2, 8, 4), cN = tileFbm(3, 16, 3), d = tileFbm(4, 2, 4);
  const c = makeCanvas(size);
  paintPixels(c, (u, v) => [a(u, v) * 255, b(u, v) * 255, cN(u, v) * 255, d(u, v) * 255]);
  return toTexture(c, { srgb: false });
}

// Water surface normal map: layered wavelets with directional stretch.
export function waterNormalTexture(size = 512, seed = 5) {
  const n1 = tileFbm(seed, 4, 5), n2 = tileFbm(seed + 50, 16, 3);
  return toTexture(heightToNormal(size, (u, v) => {
    const a = n1(u, v), b = n2(u, v);
    return a * 1.0 + b * 0.4 + 0.03 * Math.sin((v * 8 + a * 6) * Math.PI * 2);
  }, 6), { srgb: false });
}

// Foam: bubbly cells in R, streaky in G.
export function foamTexture(size = 512) {
  const n1 = tileFbm(61, 8, 5), n2 = tileFbm(62, 32, 3);
  const c = makeCanvas(size);
  const ctx = paintPixels(c, (u, v) => {
    const a = n1(u, v), b = n2(u, v);
    const cells = Math.pow(Math.max(0, a * 1.3 - 0.35), 1.2) * 255;
    const streak = Math.pow(n1(u * 0.25 % 1, v), 2) * 255;
    return [Math.min(255, cells + b * 60), streak, b * 255, 255];
  });
  const rnd = mulberry32(5);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * size, y = rnd() * size, r = 1 + rnd() * 4;
    ctx.strokeStyle = `rgba(90,0,0,${0.3 + rnd() * 0.4})`;
    ctx.lineWidth = 0.8;
    wrapDraw(ctx, size, x, y, r, (px, py) => { ctx.beginPath(); ctx.arc(px, py, r, 0, 6.283); ctx.stroke(); });
  }
  return toTexture(c, { srgb: false });
}

// Soft round sprite (for particles)
export function softSprite(size = 64, inner = 0.0) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * inner * 0.5, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c, { repeat: false });
}
