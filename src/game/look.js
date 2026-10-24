// The player's look: angler outfit + boat (type, size, paint, accent). Saved per browser and
// shared with other players so everyone sees your boat and character.
import * as A from '../models/angler.js';

export const BOAT_TYPES = [
  { id: 'weidling', name: 'Weidling', desc: 'Traditional Swiss wooden river boat with a tiller outboard' },
  { id: 'runabout', name: 'Mahogany runabout', desc: 'Classic varnished Swiss lake boat with a wheel and inboard' },
  { id: 'sportfisher', name: 'Sport-fisher', desc: 'Centre-console ocean boat with twin outboards and a T-top' },
];
export const PAINTS = [
  { hex: null, name: 'Natural finish' }, { hex: 0xf2efe6, name: 'Gelcoat white' }, { hex: 0x2f6b46, name: 'Alpine green' },
  { hex: 0xb3202a, name: 'Swiss red' }, { hex: 0x2b5d9e, name: 'Glacier blue' }, { hex: 0x1d2433, name: 'Midnight' },
  { hex: 0xe0b23a, name: 'Edelweiss gold' }, { hex: 0x6fbfcd, name: 'Lake turquoise' }, { hex: 0x5c3a7a, name: 'Heather' },
  { hex: 0x2a2a2a, name: 'Carbon' }, { hex: 0xd8642a, name: 'Sunset orange' }, { hex: 0x9aa58a, name: 'Sage' },
];
export const ACCENTS = [0xcf3a2c, 0xf2c14e, 0x2f7de1, 0x3fd0c0, 0x7ad66b, 0xb06ae8, 0xffffff, 0x111111, 0xff8a3d, 0xe85aa0];
export const SIZE_RANGE = [0.7, 1.6];

// Fallback outfit options if the angler model doesn't describe its own
const FALLBACK_OPTIONS = [
  { id: 'skin', label: 'Skin', type: 'color', swatches: [0xf1c9a8, 0xe6b393, 0xd9a47c, 0xc58b66, 0x9a6648, 0x6e4630] },
  { id: 'shirt', label: 'Shirt', type: 'color', swatches: [0x8a2f2a, 0x2f4f7a, 0x3d5a35, 0xd9c9a3, 0x2a2a2a, 0xb85c1e] },
  { id: 'vest', label: 'Vest', type: 'color', swatches: [0x5b6b3a, 0x6b4a2e, 0x2f3d4f, 0x8a8a7a, 0xc9a24a, 0x2a2a2a] },
  { id: 'hat', label: 'Hat', type: 'color', swatches: [0xc9b98f, 0x3b3b3b, 0xcf3a2c, 0x2f6b46, 0xe8e2d0, 0x2b5d9e] },
  { id: 'pants', label: 'Trousers', type: 'color', swatches: [0x3d4038, 0x2b3240, 0x5a4a35, 0x6b6b5e, 0x1e1e1e] },
];
export const ANGLER_OPTIONS = A.ANGLER_OPTIONS || FALLBACK_OPTIONS;

function defaultAngler() {
  const o = { vest: 0x5b6b3a, shirt: 0x8a2f2a, hat: 0xc9b98f };
  for (const opt of ANGLER_OPTIONS) if (o[opt.id] === undefined && opt.default !== undefined) o[opt.id] = opt.default;
  return o;
}

export function defaultLook(color) {
  return { angler: defaultAngler(), boat: { type: 'weidling', size: 1, paint: null, accent: color } };
}

export function loadLook(color) {
  const d = defaultLook(color);
  try {
    const s = JSON.parse(localStorage.getItem('af-look') || 'null');
    if (s) return sanitizeLook({ angler: { ...d.angler, ...s.angler }, boat: { ...d.boat, ...s.boat } }, color);
  } catch (_) { /* corrupt save: use defaults */ }
  return d;
}
export function saveLook(look) { localStorage.setItem('af-look', JSON.stringify(look)); }

export function clampSize(v) { return Math.min(SIZE_RANGE[1], Math.max(SIZE_RANGE[0], +v || 1)); }

// a look from the network (or an old save): unknown types, sizes and colours fall back to defaults
const colour = (v, fb) => (Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : fb);
export function sanitizeLook(look, color) {
  const d = defaultLook(color), b = look?.boat || {};
  return {
    angler: A.normalizeOutfit ? A.normalizeOutfit(look?.angler || {}, d.angler) : { ...d.angler, ...look?.angler },
    boat: {
      type: BOAT_TYPES.some(t => t.id === b.type) ? b.type : 'weidling',
      size: clampSize(b.size),
      paint: b.paint == null ? null : colour(b.paint, null),
      accent: colour(b.accent, d.boat.accent ?? 0xcf3a2c),
    },
  };
}
