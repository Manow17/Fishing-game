// Where things go: spawn, dock, village buildings, pastures.
import { mulberry32 } from '../util/noise.js';
import { centerX, centerSlope, halfWidth, waterY } from './river.js';
import { heightAt, normalAt } from './terrain.js';
import * as THREE from 'three';

export const SPAWN_Z = -170;
export const VILLAGE_SIDE = -1; // west bank
export const LAKE_VILLAGE = { z: 1790, side: 1 }; // second village on the lake's east shore

// World x of a point `e` meters beyond the bank on `side` (-1 west / +1 east) at z.
export function bankX(z, side, e) {
  const s = centerSlope(z);
  return centerX(z) + side * (halfWidth(z) + e) * Math.sqrt(1 + s * s);
}

export function computeLayout() {
  const rnd = mulberry32(4242);
  const n = new THREE.Vector3();
  const out = { chalets: [], barns: [], church: null, cows: [], fences: [], dock: null, docks: [], shops: [], flag: null, flags: [], benches: [], bales: [], exclusions: [] };
  const taken = [];
  const free = (x, z, r) => taken.every(t => (t.x - x) ** 2 + (t.z - z) ** 2 > (t.r + r) ** 2);
  const take = (x, z, r) => { taken.push({ x, z, r }); out.exclusions.push({ x, z, r: r + 4 }); };
  const faceRiver = (x, z) => {
    const cx = centerX(z);
    return Math.atan2(cx - x, 0.0001) ; // +Z of model faces toward river (x direction)
  };

  // Docks (spawn village + lake village). Shore end sits on the bank, deck runs out over water.
  // Each gets a flag pole, a bench and a Fischerei stall beside it.
  const addDock = (z, side) => {
    const x = bankX(z, side, 1.5);
    const y = waterY(z) + 0.6;
    const yaw = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    const d = { x, y, z, yaw };
    out.docks.push(d);
    out.flags.push({ x: bankX(z + 9, side, 6), z: z + 9 });
    take(x, z, 10);
    out.benches.push({ x: bankX(z - 7, side, 9), z: z - 7, yaw });
    const sz = z - 10;
    out.shops.push({ x: bankX(sz, side, 7), z: sz, yaw, side });
    take(bankX(sz, side, 7), sz, 5);
    return d;
  };
  out.dock = addDock(SPAWN_Z, VILLAGE_SIDE);
  out.flag = out.flags[0];
  addDock(LAKE_VILLAGE.z, LAKE_VILLAGE.side);

  // Church + village chalets on the meadows above the dock.
  const tryPlace = (list, count, zMin, zMax, side, eMin, eMax, r, flat = 0.9) => {
    let tries = 0;
    while (list.length < count && tries++ < 4000) {
      const z = zMin + rnd() * (zMax - zMin);
      const sd = side || (rnd() < 0.5 ? -1 : 1);
      const e = eMin + rnd() * (eMax - eMin);
      const x = bankX(z, sd, e);
      if (!free(x, z, r)) continue;
      normalAt(x, z, n);
      if (n.y < flat) continue;
      const y = heightAt(x, z);
      if (y - waterY(z) < 2.5) continue;
      take(x, z, r);
      const yaw = faceRiver(x, z) + (rnd() - 0.5) * 0.5;
      list.push({ x, y, z, yaw, seed: (rnd() * 1000) | 0 });
    }
  };
  const ch = [];
  tryPlace(ch, 1, SPAWN_Z - 140, SPAWN_Z - 60, VILLAGE_SIDE, 90, 170, 16, 0.93);
  out.church = ch[0] || null;
  tryPlace(out.chalets, 9, SPAWN_Z - 260, SPAWN_Z + 220, VILLAGE_SIDE, 28, 230, 13);
  // lakeside village on the east shore
  const lakeHouses = [];
  tryPlace(lakeHouses, 8, LAKE_VILLAGE.z - 200, LAKE_VILLAGE.z + 220, LAKE_VILLAGE.side, 22, 180, 13);
  out.chalets.push(...lakeHouses);
  // farmsteads scattered up and down the whole valley
  tryPlace(out.chalets, 9 + 8 + 24, -2300, 2700, 0, 40, 420, 13);
  tryPlace(out.barns, 14, -2300, 2700, 0, 80, 460, 9, 0.86);

  // Pasture with cows and a fence near the village.
  {
    const z0 = SPAWN_Z + 40, side = VILLAGE_SIDE;
    for (let i = 0; i < 11; i++) {
      const z = z0 + rnd() * 120;
      const e = 30 + rnd() * 70;
      const x = bankX(z, side, e);
      if (!free(x, z, 2.5)) continue;
      out.cows.push({ x, y: heightAt(x, z), z, yaw: rnd() * Math.PI * 2, seed: i });
    }
    // fence line along the pasture's river side
    for (let z = z0 - 6; z < z0 + 130; z += 6) {
      const x = bankX(z, side, 24);
      const x2 = bankX(z + 6, side, 24);
      out.fences.push({ x, y: heightAt(x, z), z, yaw: Math.atan2(x2 - x, 6), len: Math.hypot(x2 - x, 6) });
    }
    for (let i = 0; i < 6; i++) {
      const z = SPAWN_Z + 200 + rnd() * 160, e = 30 + rnd() * 90;
      const x = bankX(z, side, e);
      out.bales.push({ x, y: heightAt(x, z), z, seed: i });
    }
  }
  // a second little herd by the lake village
  for (let i = 0; i < 7; i++) {
    const z = LAKE_VILLAGE.z + 120 + rnd() * 140;
    const x = bankX(z, LAKE_VILLAGE.side, 40 + rnd() * 70);
    if (!free(x, z, 2.5)) continue;
    normalAt(x, z, n);
    if (n.y < 0.85) continue;
    out.cows.push({ x, y: heightAt(x, z), z, yaw: rnd() * Math.PI * 2, seed: 20 + i });
  }
  return out;
}
