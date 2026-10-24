// Gameplay data per species: sizes, fight, habitat and lure preferences.
// weight (kg) = a * length(m)^3

export const SPECIES = {
  brownTrout: {
    name: 'Brown Trout', local: 'Bachforelle', latin: 'Salmo trutta fario',
    len: [0.24, 0.78], a: 11.5, power: 1.0, speed: 3.4, jumpy: 0.45, abundance: 1.0, value: 12,
    depth: [0.3, 0.7], habitat: { rock: 1.0, seam: 0.8, pool: 0.5, rapids: 0.5, slack: 0.2 },
    lures: { spinner: 1.0, minnow: 0.95, spoon: 0.6, float: 0.55 },
  },
  rainbowTrout: {
    name: 'Rainbow Trout', local: 'Regenbogenforelle', latin: 'Oncorhynchus mykiss',
    len: [0.25, 0.7], a: 11.8, power: 1.05, speed: 3.6, jumpy: 0.95, abundance: 0.75, value: 10,
    depth: [0.2, 0.6], habitat: { rock: 0.6, seam: 1.0, pool: 0.4, rapids: 0.8, slack: 0.2 },
    lures: { spinner: 0.95, minnow: 0.75, spoon: 0.75, float: 0.6 },
  },
  grayling: {
    name: 'Grayling', local: 'Äsche', latin: 'Thymallus thymallus',
    len: [0.24, 0.55], a: 9.5, power: 0.75, speed: 3.0, jumpy: 0.2, abundance: 0.85, value: 14,
    depth: [0.4, 0.85], habitat: { rock: 0.4, seam: 1.0, pool: 0.5, rapids: 0.6, slack: 0.1 },
    lures: { float: 1.0, spinner: 0.45, spoon: 0.2, minnow: 0.2 },
  },
  arcticChar: {
    name: 'Arctic Char', local: 'Seesaibling', latin: 'Salvelinus umbla',
    len: [0.25, 0.62], a: 10.5, power: 0.95, speed: 3.2, jumpy: 0.15, abundance: 0.45, value: 20,
    depth: [0.65, 0.95], habitat: { rock: 0.3, seam: 0.3, pool: 1.0, rapids: 0.05, slack: 0.4 },
    lures: { spoon: 1.0, minnow: 0.6, spinner: 0.5, float: 0.35 },
  },
  pike: {
    name: 'Northern Pike', local: 'Hecht', latin: 'Esox lucius',
    len: [0.5, 1.25], a: 6.2, power: 1.35, speed: 4.2, jumpy: 0.3, abundance: 0.45, value: 14,
    depth: [0.35, 0.8], habitat: { rock: 0.3, seam: 0.1, pool: 0.6, rapids: 0.0, slack: 1.0 },
    lures: { minnow: 1.0, spoon: 0.9, spinner: 0.7, float: 0.2 },
  },
  perch: {
    name: 'European Perch', local: 'Egli', latin: 'Perca fluviatilis',
    len: [0.14, 0.42], a: 14, power: 0.55, speed: 2.4, jumpy: 0.05, abundance: 0.8, value: 8,
    depth: [0.5, 0.9], habitat: { rock: 0.6, seam: 0.2, pool: 0.8, rapids: 0.0, slack: 1.0 },
    lures: { spinner: 0.85, spoon: 0.75, float: 0.8, minnow: 0.45 },
  },
  huchen: {
    name: 'Huchen', local: 'Huchen', latin: 'Hucho hucho',
    len: [0.65, 1.4], a: 8.4, power: 1.8, speed: 4.6, jumpy: 0.25, abundance: 0.09, value: 40,
    depth: [0.6, 0.95], habitat: { rock: 0.7, seam: 0.5, pool: 1.0, rapids: 0.6, slack: 0.2 },
    lures: { minnow: 1.0, spoon: 0.75, spinner: 0.5, float: 0.15 },
  },
  whitefish: {
    name: 'Whitefish', local: 'Felchen', latin: 'Coregonus sp.',
    len: [0.25, 0.55], a: 8.8, power: 0.7, speed: 3.0, jumpy: 0.1, abundance: 0.6, value: 12,
    depth: [0.5, 0.9], habitat: { rock: 0.2, seam: 0.6, pool: 1.0, rapids: 0.2, slack: 0.4 },
    lures: { float: 1.0, spinner: 0.25, spoon: 0.25, minnow: 0.1 },
  },
  barbel: {
    name: 'Barbel', local: 'Barbe', latin: 'Barbus barbus',
    len: [0.35, 0.85], a: 9.2, power: 1.35, speed: 3.0, jumpy: 0.0, abundance: 0.6, value: 13,
    depth: [0.85, 1.0], habitat: { rock: 0.6, seam: 0.7, pool: 0.5, rapids: 0.9, slack: 0.1 },
    lures: { float: 0.95, spinner: 0.15, spoon: 0.15, minnow: 0.1 },
  },
  chub: {
    name: 'Chub', local: 'Alet', latin: 'Squalius cephalus',
    len: [0.22, 0.62], a: 11, power: 0.85, speed: 3.0, jumpy: 0.05, abundance: 0.9, value: 7,
    depth: [0.15, 0.6], habitat: { rock: 0.5, seam: 0.6, pool: 0.5, rapids: 0.3, slack: 0.7 },
    lures: { float: 0.85, spinner: 0.65, minnow: 0.5, spoon: 0.3 },
  },
};

// ---- Open Ocean (big game). Habitat keys: reef, open, deep, surface, dropoff, shallows.
// depthM = absolute swimming depth (m); minDepth = won't come into shallower water; sense = lure-notice multiplier.
const OCEAN = {
  greatWhite: {
    name: 'Great White Shark', local: 'Weisser Hai', latin: 'Carcharodon carcharias',
    len: [2.5, 5.5], a: 8.4, power: 2.2, speed: 6, jumpy: 0.05, abundance: 0.15, value: 34, sense: 2.4,
    depth: [0.2, 0.6], depthM: [1, 16], minDepth: 10, habitat: { open: 0.6, dropoff: 0.8, deep: 0.4, surface: 0.3 },
    lures: { float: 1.0, minnow: 0.4, spoon: 0.2, spinner: 0.1 },
  },
  hammerhead: {
    name: 'Great Hammerhead', local: 'Hammerhai', latin: 'Sphyrna mokarran',
    len: [2.0, 5.0], a: 4.2, power: 2.0, speed: 5.5, jumpy: 0.02, abundance: 0.4, value: 26, sense: 2.4,
    depth: [0.3, 0.7], depthM: [2, 18], minDepth: 6, habitat: { shallows: 0.5, reef: 0.5, dropoff: 0.6 },
    lures: { float: 0.9, minnow: 0.4, spoon: 0.3, spinner: 0.2 },
  },
  mako: {
    name: 'Shortfin Mako', local: 'Makohai', latin: 'Isurus oxyrinchus',
    len: [1.8, 3.8], a: 10, power: 2.4, speed: 8, jumpy: 0.65, abundance: 0.35, value: 30, sense: 2.0,
    depth: [0.2, 0.5], depthM: [1, 14], minDepth: 10, habitat: { open: 1, surface: 0.4, deep: 0.4 },
    lures: { minnow: 0.9, float: 0.8, spoon: 0.6, spinner: 0.4 },
  },
  blueMarlin: {
    name: 'Blue Marlin', local: 'Blauer Marlin', latin: 'Makaira nigricans',
    len: [2.0, 4.3], a: 6.8, power: 2.6, speed: 8.5, jumpy: 0.95, abundance: 0.3, value: 38, sense: 1.9,
    depth: [0.1, 0.4], depthM: [0.5, 9], minDepth: 15, habitat: { open: 1, surface: 0.6, deep: 0.5, dropoff: 0.4 },
    lures: { minnow: 1.0, spoon: 0.5, float: 0.4, spinner: 0.2 },
  },
  swordfish: {
    name: 'Swordfish', local: 'Schwertfisch', latin: 'Xiphias gladius',
    len: [1.8, 4.0], a: 8.5, power: 2.4, speed: 7.5, jumpy: 0.3, abundance: 0.25, value: 32, sense: 1.6,
    depth: [0.5, 0.9], depthM: [8, 28], minDepth: 25, habitat: { deep: 1, dropoff: 0.6 },
    lures: { float: 1.0, spoon: 0.5, minnow: 0.4, spinner: 0.1 },
  },
  bluefinTuna: {
    name: 'Atlantic Bluefin Tuna', local: 'Roter Thun', latin: 'Thunnus thynnus',
    len: [1.2, 3.0], a: 21, power: 2.8, speed: 9, jumpy: 0.05, abundance: 0.4, value: 30, sense: 1.6,
    depth: [0.2, 0.6], depthM: [2, 20], minDepth: 12, habitat: { open: 0.9, deep: 0.6, dropoff: 0.5 },
    lures: { minnow: 0.9, spoon: 0.9, float: 0.5, spinner: 0.3 },
  },
  yellowfinTuna: {
    name: 'Yellowfin Tuna', local: 'Gelbflossenthun', latin: 'Thunnus albacares',
    len: [0.8, 2.2], a: 17, power: 2.5, speed: 8.5, jumpy: 0.05, abundance: 0.8, value: 20, sense: 1.5,
    depth: [0.1, 0.5], depthM: [1, 14], minDepth: 8, habitat: { open: 1, surface: 0.7 },
    lures: { spoon: 1.0, minnow: 0.9, spinner: 0.5, float: 0.5 },
  },
  mahiMahi: {
    name: 'Mahi-mahi', local: 'Goldmakrele', latin: 'Coryphaena hippurus',
    len: [0.6, 1.6], a: 6.8, power: 1.6, speed: 7, jumpy: 0.8, abundance: 1.0, value: 16, sense: 1.4,
    depth: [0.05, 0.3], depthM: [0.3, 5], minDepth: 5, habitat: { surface: 1, open: 0.8 },
    lures: { spinner: 0.9, minnow: 0.9, spoon: 0.8, float: 0.6 },
  },
  giantGrouper: {
    name: 'Goliath Grouper', local: 'Riesenzackenbarsch', latin: 'Epinephelus itajara',
    len: [1.0, 2.5], a: 30, power: 1.7, speed: 3.5, jumpy: 0, abundance: 0.6, value: 22, sense: 1.3,
    depth: [0.8, 1.0], minDepth: 4, habitat: { reef: 1, dropoff: 0.5, shallows: 0.3 },
    lures: { float: 1.0, spoon: 0.7, minnow: 0.5, spinner: 0.2 },
  },
  barracuda: {
    name: 'Great Barracuda', local: 'Barrakuda', latin: 'Sphyraena barracuda',
    len: [0.6, 1.8], a: 5.6, power: 1.4, speed: 7, jumpy: 0.2, abundance: 0.9, value: 12, sense: 1.4,
    depth: [0.1, 0.5], depthM: [0.5, 6], minDepth: 2, habitat: { reef: 0.8, shallows: 0.8, surface: 0.4 },
    lures: { spinner: 1.0, minnow: 0.9, spoon: 0.8, float: 0.3 },
  },
};
Object.assign(SPECIES, OCEAN);
export const RIVER_SPECIES = ['brownTrout', 'rainbowTrout', 'grayling', 'arcticChar', 'pike', 'perch', 'huchen', 'whitefish', 'barbel', 'chub'];
export const OCEAN_SPECIES = Object.keys(OCEAN);

export const SPECIES_IDS = Object.keys(SPECIES);

export function weightOf(id, len) { return SPECIES[id].a * len * len * len; }
// weight as it counts for points and price: river fish unchanged, ocean giants soft-capped
export function tradeWeight(kg) { return kg <= 25 ? kg : 25 + 2.5 * Math.sqrt(kg - 25); }

export function pointsFor(id, len) {
  const s = SPECIES[id];
  const t = (len - s.len[0]) / (s.len[1] - s.len[0]);
  return Math.round(s.value * (1 + tradeWeight(weightOf(id, len))) * (1 + t * t * 2));
}

// Biased random length: most fish are average, trophies are rare.
export function rollLength(id, rnd) {
  const s = SPECIES[id];
  const u = Math.pow(rnd(), 1.8);
  return s.len[0] + (s.len[1] - s.len[0]) * u;
}
