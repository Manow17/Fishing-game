// Minimap painter for the ocean map (ENV.drawMap). Land stays transparent so the HUD's chart paper
// shows through; the sea is tinted by depth with isobaths (2, 5, 10, 20, 50, 100, 200, 500 m), reefs are
// stippled and the coastline inked. Two images are baked once from the height grids: the island area
// at 3 m per pixel and the surrounding sea at 30 m per pixel; drawMap() maps them with the affine
// transform implied by the HUD's toPx(), so any pan / zoom / rotation works.
import { NEAR, FAR } from './oceanTerrain.js';

const ISO = [2, 5, 10, 20, 50, 100, 200, 500];
const SEA = [ // [depth, r, g, b]
  [0, 196, 232, 228], [3, 176, 222, 226], [10, 150, 206, 224], [25, 128, 186, 216],
  [60, 108, 166, 206], [200, 86, 144, 192], [600, 70, 124, 178],
];
function seaColor(d) {
  for (let i = 1; i < SEA.length; i++) {
    if (d <= SEA[i][0]) {
      const a = SEA[i - 1], b = SEA[i], t = (d - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  const l = SEA[SEA.length - 1];
  return [l[1], l[2], l[3]];
}

function bakeChart(H, n, reefAt, pave) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  const img = g.createImageData(n, n), px = img.data;
  const band = (h) => { const d = -h; let k = 0; while (k < ISO.length && d > ISO[k]) k++; return k; };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, h = H[k], o = k * 4;
    const land = h > 0;
    const nb = [i > 0 ? H[k - 1] : h, i < n - 1 ? H[k + 1] : h, j > 0 ? H[k - n] : h, j < n - 1 ? H[k + n] : h];
    if (land) {
      const coast = nb.some(v => v <= 0);
      if (coast) { px[o] = 52; px[o + 1] = 110; px[o + 2] = 150; px[o + 3] = 255; }
      else if (pave && pave(k) > 0.5) { px[o] = 214; px[o + 1] = 206; px[o + 2] = 186; px[o + 3] = 200; }
      else px[o + 3] = 0;
      continue;
    }
    let [r, gg, b] = seaColor(-h);
    // isobath: darker hairline where the depth band changes
    const bk = band(h);
    if (nb.some(v => v < 0 && band(v) !== bk)) { r *= 0.86; gg *= 0.9; b *= 0.94; }
    // reef stipple
    const rf = reefAt ? reefAt(k) : 0;
    if (rf > 0.35 && ((i * 7 + j * 13) % 5 === 0 || (i * 3 + j * 5) % 7 === 0)) { r = r * 0.45 + 232 * 0.55; gg = gg * 0.6 + 150 * 0.4; b = b * 0.6 + 140 * 0.4; }
    px[o] = r; px[o + 1] = gg; px[o + 2] = b; px[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function createMapPainter(bake, layout) {
  let near = null, far = null;
  const build = () => {
    far = bakeChart(bake.FH, FAR.n, null, null);
    near = bakeChart(bake.H, NEAR.n, (k) => bake.splat[k * 4 + 1] / 255, (k) => bake.splat[k * 4] / 255);
  };
  // draw image whose pixel (0,0) centre is grid sample (x0, z0), one pixel per `step` metres
  const place = (ctx, img, G, toPx) => {
    const x0 = G.x0 - G.step / 2, z0 = G.z0 - G.step / 2, ext = G.n * G.step;
    const p00 = toPx(x0, z0), p10 = toPx(x0 + ext, z0), p01 = toPx(x0, z0 + ext);
    const n = img.width;
    ctx.save();
    ctx.transform((p10[0] - p00[0]) / n, (p10[1] - p00[1]) / n, (p01[0] - p00[0]) / n, (p01[1] - p00[1]) / n, p00[0], p00[1]);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  };
  return function drawMap(ctx, toPx, S, view = {}) {
    if (!near) build();
    // deep sea everywhere first (beyond the far grid too)
    ctx.save();
    ctx.fillStyle = 'rgb(70,124,178)';
    const W = view.W || ctx.canvas.width;
    const inFar = (x, z) => x > FAR.x0 && z > FAR.z0 && x < FAR.x0 + FAR.n * FAR.step && z < FAR.z0 + FAR.n * FAR.step;
    if (view.x !== undefined && !inFar(view.x, view.z)) ctx.fillRect(0, 0, W, W);
    ctx.restore();
    place(ctx, far, FAR, toPx);
    place(ctx, near, NEAR, toPx);
    // a few chart symbols: lighthouse and buoys
    const u = view.u || 1;
    const dot = (x, z, r, fill, stroke) => {
      const [px, py] = toPx(x, z);
      ctx.beginPath(); ctx.arc(px, py, r * u, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      if (stroke) { ctx.lineWidth = 1 * u; ctx.strokeStyle = stroke; ctx.stroke(); }
    };
    if (layout.lighthouse) {
      const [px, py] = toPx(layout.lighthouse.x, layout.lighthouse.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = '#f2c14e'; ctx.strokeStyle = '#5a3b12'; ctx.lineWidth = 1 * u;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2, r = (i % 2 ? 2.2 : 5) * u; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    for (const b of layout.buoys || []) dot(b.x, b.z, 2.2, b.kind === 'red' ? '#d0342c' : b.kind === 'green' ? '#2f9a55' : '#e6b81e', '#222');
  };
}
