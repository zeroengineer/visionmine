/** FNV-1a style string hash → unsigned 32-bit integer. */
export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Final avalanche so similar strings give unrelated seeds.
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Small, fast seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless hash of integer coordinates → float in [0, 1). */
export function hash3(seed: number, x: number, y: number, z = 0): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const SEED_WORDS = [
  'amber',
  'birch',
  'cobalt',
  'delta',
  'ember',
  'fjord',
  'granite',
  'harbor',
  'indigo',
  'juniper',
  'karst',
  'lagoon',
  'meadow',
  'north',
  'onyx',
  'pine',
  'quartz',
  'ridge',
  'summit',
  'tundra',
  'umber',
  'valley',
  'willow',
  'zenith',
];

/** Human-friendly random seed such as "granite-willow-4821". */
export function randomSeed(random: () => number = Math.random): string {
  const word = (): string => SEED_WORDS[Math.floor(random() * SEED_WORDS.length)]!;
  return `${word()}-${word()}-${Math.floor(1000 + random() * 9000)}`;
}
