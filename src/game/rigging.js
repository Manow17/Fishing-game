// Building boats/anglers from a look, and seating anglers in world space.
// Anglers are NOT children of the boat: the boat can be scaled by the size slider, people can't.
import * as THREE from 'three';
import { createBoat } from '../models/boat.js';
import { createAngler } from '../models/angler.js';
import { clampSize } from './look.js';

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

const DEFAULT_PHYS = { mass: 480, thrust: 2100, halfLength: 3.6, beam: 1.64, draft: 0.2 };

export function buildBoat(boatLook, seed) {
  const b = createBoat({ type: boatLook.type || 'weidling', accent: boatLook.accent, seed });
  b.setPaint?.(boatLook.paint ?? null);
  b.size = clampSize(boatLook.size);
  b.object.scale.setScalar(b.size);
  b.type = boatLook.type || 'weidling';
  // seats for guests: the model's own passenger seats, or spots fore and aft of the fishing seat
  const f = b.seats.fisher;
  b.passengerSeats = b.seats.passengers?.length ? b.seats.passengers
    : [f.clone().add(new THREE.Vector3(0, 0, 1.6)), f.clone().add(new THREE.Vector3(0, 0, -1.4))];
  b.helm = b.helm || { kind: 'tiller', right: b.tillerGrip, left: null };
  b.phys = { ...DEFAULT_PHYS, ...(b.physics || {}) };
  return b;
}

export function disposeBoat(b, scene) {
  scene.remove(b.object);
  b.object.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); } });
}

export function buildAngler(outfit, name) {
  const a = createAngler({ ...outfit, name: name || 'Angler' });
  return a;
}

// world position of a boat-local seat (respects the boat's scale)
export function seatWorld(boat, seatLocal, out = new THREE.Vector3()) {
  return out.copy(seatLocal).applyMatrix4(boat.object.matrixWorld);
}

// put an angler on a seat, facing the boat's bow turned by `yaw`
export function placeAngler(angler, boat, seatLocal, yaw = 0) {
  const o = angler.object;
  seatWorld(boat, seatLocal, o.position);
  o.quaternion.copy(boat.object.quaternion).multiply(_q.setFromAxisAngle(UP, yaw));
  o.updateMatrixWorld(true);
}
