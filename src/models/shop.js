// "Fischerei" market stall by the dock: counter, striped awning, sign, fish on ice, chalkboard, shopkeeper.
// Origin at ground level, centre of the platform; the counter faces +Z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createFish } from './fish.js';
import { createAngler } from './angler.js';

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function woodTex() {
  return canvasTex(512, 512, (g, w, h) => {
    for (let y = 0; y < h; y += 64) {
      const base = 120 + Math.random() * 30;
      g.fillStyle = `rgb(${base * 0.62 | 0},${base * 0.44 | 0},${base * 0.28 | 0})`;
      g.fillRect(0, y, w, 64);
      for (let i = 0; i < 40; i++) {
        g.strokeStyle = `rgba(40,24,12,${0.08 + Math.random() * 0.15})`;
        g.lineWidth = 1 + Math.random() * 2;
        const yy = y + Math.random() * 64;
        g.beginPath(); g.moveTo(0, yy);
        for (let x = 0; x <= w; x += 32) g.lineTo(x, yy + Math.sin(x * 0.02 + i) * 3);
        g.stroke();
      }
      g.fillStyle = 'rgba(25,14,6,0.7)';
      g.fillRect(0, y + 62, w, 2);
    }
  });
}

function awningTex() {
  return canvasTex(512, 256, (g, w, h) => {
    const n = 10;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? '#f4efe3' : '#c8202b';
      g.fillRect((i / n) * w, 0, w / n + 1, h);
    }
    // soft canvas weave + weathering
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
}

// scalloped valance with alpha
function valanceTex() {
  return canvasTex(512, 64, (g, w, h) => {
    const n = 10;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? '#f4efe3' : '#c8202b';
      const x0 = (i / n) * w, x1 = ((i + 1) / n) * w;
      g.beginPath();
      g.moveTo(x0, 0); g.lineTo(x1, 0); g.lineTo(x1, h * 0.45);
      g.quadraticCurveTo((x0 + x1) / 2, h * 1.05, x0, h * 0.45);
      g.closePath(); g.fill();
    }
  });
}

function signTex() {
  return canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#2d3b2e'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d9c38a'; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#f3e7c4';
    g.font = 'bold 108px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('FISCHEREI', w / 2 + 40, h * 0.44);
    g.font = 'italic 40px Georgia, serif'; g.fillStyle = '#d9c38a';
    g.fillText('Frischfisch · Angelbedarf · Bootsmotoren', w / 2 + 40, h * 0.8);
    // fish emblem
    g.save(); g.translate(120, h * 0.5); g.fillStyle = '#d9c38a';
    g.beginPath(); g.ellipse(0, 0, 62, 26, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(-50, 0); g.lineTo(-95, -30); g.lineTo(-95, 30); g.closePath(); g.fill();
    g.fillStyle = '#2d3b2e'; g.beginPath(); g.arc(34, -6, 6, 0, Math.PI * 2); g.fill();
    g.restore();
  });
}

function chalkTex() {
  return canvasTex(512, 640, (g, w, h) => {
    g.fillStyle = '#1f2522'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 2); }
    g.fillStyle = '#efe9da'; g.textAlign = 'center';
    g.font = 'bold 64px "Segoe Print", "Comic Sans MS", cursive'; g.fillText('Heute', w / 2, 90);
    g.font = '40px "Segoe Print", "Comic Sans MS", cursive';
    const rows = [['Forelle', '24.-'], ['Äsche', '28.-'], ['Saibling', '36.-'], ['Egli', '42.-'], ['Hecht', '19.-']];
    rows.forEach(([a, b], i) => { g.textAlign = 'left'; g.fillText(a, 40, 180 + i * 70); g.textAlign = 'right'; g.fillText(b, w - 40, 180 + i * 70); });
    g.font = '30px "Segoe Print", "Comic Sans MS", cursive'; g.textAlign = 'center'; g.fillStyle = '#f2c14e';
    g.fillText('pro kg · Motoren-Tuning!', w / 2, h - 50);
  });
}

function iceTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#dfeef2'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 4 + Math.random() * 12;
      const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(1, 'rgba(170,205,215,0.6)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  });
}

export function createShop() {
  const root = new THREE.Group();
  root.name = 'Fischerei';
  const wood = woodTex(); wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
  const mWood = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.85 });
  const mDark = new THREE.MeshStandardMaterial({ map: wood, color: 0x8a7a6a, roughness: 0.9 });
  const mAwn = new THREE.MeshStandardMaterial({ map: awningTex(), roughness: 0.95, side: THREE.DoubleSide });
  const mVal = new THREE.MeshStandardMaterial({ map: valanceTex(), roughness: 0.95, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false });
  const mSign = new THREE.MeshStandardMaterial({ map: signTex(), roughness: 0.6 });
  const mChalk = new THREE.MeshStandardMaterial({ map: chalkTex(), roughness: 0.9 });
  const mIce = new THREE.MeshPhysicalMaterial({ map: iceTex(), roughness: 0.15, clearcoat: 1, transmission: 0, color: 0xeaf6f8 });
  const mMetal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.35 });
  const mBrass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3 });
  const mGlass = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffc46b, emissiveIntensity: 1.6, roughness: 0.2 });

  const W = 3.4, D = 2.4;
  const parts = { wood: [], dark: [] };
  const box = (list, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    // world-scaled UVs so the planks don't stretch
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, d) * 0.6, uv.getY(i) * h * 0.6);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
    list.push(g);
  };
  // platform on short piers (sinks into slopes)
  box(parts.dark, W + 0.2, 0.9, D + 0.2, 0, -0.33, 0);
  for (let x = -W / 2 + 0.1; x < W / 2; x += 0.2) box(parts.wood, 0.18, 0.04, D + 0.2, x, 0.14, 0);
  // posts
  for (const [x, z, h] of [[-W / 2, -D / 2, 2.75], [W / 2, -D / 2, 2.75], [-W / 2, D / 2 - 0.1, 2.35], [W / 2, D / 2 - 0.1, 2.35]]) box(parts.dark, 0.12, h, 0.12, x, h / 2 + 0.12, z);
  // back wall planks + shelves with jars
  for (let x = -W / 2 + 0.1; x < W / 2; x += 0.22) box(parts.wood, 0.2, 2.4, 0.04, x, 1.32, -D / 2 + 0.02);
  for (const y of [1.3, 1.75]) box(parts.dark, W - 0.2, 0.04, 0.3, 0, y, -D / 2 + 0.18);
  // side walls (half height)
  for (const s of [-1, 1]) for (let z = -D / 2 + 0.1; z < D / 2 - 0.1; z += 0.22) box(parts.wood, 0.04, 1.1, 0.2, s * (W / 2 - 0.02), 0.7, z);
  // counter
  box(parts.dark, W - 0.2, 0.06, 0.75, 0, 1.06, D / 2 - 0.45);
  for (let x = -W / 2 + 0.2; x < W / 2 - 0.1; x += 0.2) box(parts.wood, 0.19, 0.95, 0.03, x, 0.6, D / 2 - 0.1);
  // crates
  box(parts.wood, 0.55, 0.32, 0.4, W / 2 + 0.45, 0.16, D / 2 - 0.3, 0, 0.2, 0);
  box(parts.wood, 0.5, 0.3, 0.38, W / 2 + 0.42, 0.47, D / 2 - 0.3, 0, -0.1, 0);
  // sign rail
  box(parts.dark, W + 0.3, 0.1, 0.08, 0, 2.48, D / 2 + 0.35);
  const meshes = [];
  for (const [k, m] of [['wood', mWood], ['dark', mDark]]) {
    const geo = mergeGeometries(parts[k]);
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    root.add(mesh); meshes.push(mesh);
  }
  // barrel
  {
    const prof = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push(new THREE.Vector2(0.27 + Math.sin(t * Math.PI) * 0.05, t * 0.8)); }
    const barrel = new THREE.Mesh(new THREE.LatheGeometry(prof, 20), mDark);
    barrel.position.set(-W / 2 - 0.45, 0.12, D / 2 - 0.4); barrel.castShadow = true; root.add(barrel);
    for (const y of [0.18, 0.62]) { const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.012, 6, 24), mMetal); hoop.rotation.x = Math.PI / 2; hoop.position.set(barrel.position.x, 0.12 + y, barrel.position.z); root.add(hoop); }
  }
  // awning: sloped canvas + scalloped valance
  {
    const aw = new THREE.PlaneGeometry(W + 0.5, 1, 1, 1);
    const yBack = 2.85, yFront = 2.3, zBack = -D / 2 - 0.05, zFront = D / 2 + 0.75;
    const len = Math.hypot(zFront - zBack, yBack - yFront);
    aw.scale(1, len, 1);
    const awn = new THREE.Mesh(aw, mAwn);
    awn.position.set(0, (yBack + yFront) / 2, (zBack + zFront) / 2);
    awn.rotation.x = -Math.PI / 2 + Math.atan2(yBack - yFront, zFront - zBack);
    awn.castShadow = true; awn.receiveShadow = true;
    root.add(awn);
    const val = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.5, 0.28), mVal);
    val.position.set(0, yFront - 0.14, zFront); val.castShadow = true;
    root.add(val);
    for (const s of [-1, 1]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, Math.hypot(0.75, 0.9), 6), mMetal);
      rod.position.set(s * (W / 2 + 0.2), 2.0, D / 2 + 0.35); rod.rotation.x = -0.7; root.add(rod);
    }
  }
  // sign board hanging under the awning edge
  {
    const sign = new THREE.Mesh(new RoundedBoxGeometry(2.4, 0.6, 0.06, 2, 0.02), [mDark, mDark, mDark, mDark, mSign, mDark]);
    sign.position.set(0, 2.85, D / 2 + 0.42);
    sign.rotation.x = -0.05;
    sign.castShadow = true;
    root.add(sign);
  }
  // ice tray with fish
  {
    const tray = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.12, 0.55, 2, 0.03), mMetal);
    tray.position.set(-0.55, 1.15, D / 2 - 0.42); root.add(tray);
    const ice = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.06, 0.48), mIce);
    ice.position.set(-0.55, 1.2, D / 2 - 0.42); ice.receiveShadow = true; root.add(ice);
    [['brownTrout', 0.42, -1.05], ['arcticChar', 0.36, -0.6], ['whitefish', 0.38, -0.15]].forEach(([sp, len, x], i) => {
      const f = createFish(sp, len, i * 3);
      f.setSwim(0, 0); f.update(0.016);
      const holder = new THREE.Group();
      holder.add(f.object);
      holder.position.set(x, 1.27, D / 2 - 0.42);
      holder.rotation.set(0, Math.PI / 2 + 0.2 * (i - 1), Math.PI / 2);
      root.add(holder);
    });
  }
  // brass scale on the counter
  {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.08, 20), mBrass); base.position.set(0.8, 1.13, D / 2 - 0.4); root.add(base);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.25, 8), mBrass); post.position.set(0.8, 1.29, D / 2 - 0.4); root.add(post);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 24), mBrass); dial.rotation.x = Math.PI / 2; dial.position.set(0.8, 1.48, D / 2 - 0.4); root.add(dial);
    const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.03, 24), mMetal); pan.position.set(0.8, 1.6, D / 2 - 0.4); root.add(pan);
  }
  // lantern
  {
    const lamp = new THREE.Group();
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.2, 6, 1, true), mMetal);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 8), mGlass);
    lamp.add(cage, glass);
    lamp.position.set(W / 2 - 0.3, 2.3, D / 2 - 0.1);
    root.add(lamp);
  }
  // A-frame chalkboard in front
  {
    const board = new THREE.Group();
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.8, 0.03), [mDark, mDark, mDark, mDark, s > 0 ? mChalk : mDark, s > 0 ? mDark : mChalk]);
      p.position.set(0, 0.42, s * 0.12); p.rotation.x = s * 0.17; p.castShadow = true;
      board.add(p);
    }
    board.position.set(1.4, 0.14, D / 2 + 1.3); board.rotation.y = -0.4;
    root.add(board);
  }
  // shopkeeper standing behind the counter
  const keeper = createAngler({ shirt: 0x2f4f7a, vest: 0x6b4a2e, hat: 0x3b3b3b, name: '', seed: 4242 });
  keeper.setName('');
  keeper.setStance('stand');
  keeper.object.position.set(0, 0.16 + 0.95, -0.1);
  root.add(keeper.object);
  let t = 0;
  return {
    object: root,
    keeper,
    radius: 2.4,
    // the spot customers stand on (local), in front of the counter
    front: new THREE.Vector3(0, 0.14, D / 2 + 0.9),
    update(dt) {
      t += dt;
      keeper.setLook(Math.sin(t * 0.4) * 0.5, Math.sin(t * 0.27) * 0.12 - 0.1);
      keeper.update(dt);
    },
  };
}
