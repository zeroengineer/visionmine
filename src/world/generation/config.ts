export type TerrainType = 'standard' | 'mountains' | 'islands' | 'flatlands';

export interface WorldConfig {
  /** Any text; hashed to the numeric generator seed. */
  seed: string;
  terrain: TerrainType;
  /** Multiplier for tree frequency: 0 = none, 1 = normal, 2 = dense. */
  treeDensity: number;
}

export interface TerrainPreset {
  label: string;
  description: string;
  /** Added to continental noise: higher = more land, lower = more ocean. */
  landBias: number;
  /** Amplitude of rolling hills in blocks. */
  hillAmplitude: number;
  /** Maximum extra height of mountain ridges in blocks. */
  mountainAmplitude: number;
  /** Erosion value where mountains start; lower = more mountainous. */
  mountainThreshold: number;
  /** Scale of continents: larger = bigger land masses. */
  continentScale: number;
}

export const TERRAIN_PRESETS: Record<TerrainType, TerrainPreset> = {
  standard: {
    label: 'Standard',
    description: 'Plains, forests, hills, lakes and the occasional mountain range.',
    landBias: 0.14,
    hillAmplitude: 7,
    mountainAmplitude: 46,
    mountainThreshold: 0.12,
    continentScale: 520,
  },
  mountains: {
    label: 'Highlands',
    description: 'Towering ridges and deep valleys with little flat ground.',
    landBias: 0.32,
    hillAmplitude: 11,
    mountainAmplitude: 62,
    mountainThreshold: -0.25,
    continentScale: 620,
  },
  islands: {
    label: 'Archipelago',
    description: 'Scattered islands and sandy shores across a wide ocean.',
    landBias: -0.2,
    hillAmplitude: 6,
    mountainAmplitude: 26,
    mountainThreshold: 0.2,
    continentScale: 260,
  },
  flatlands: {
    label: 'Flatlands',
    description: 'Gentle open plains — ideal for building.',
    landBias: 0.55,
    hillAmplitude: 1.6,
    mountainAmplitude: 0,
    mountainThreshold: 2,
    continentScale: 700,
  },
};

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  seed: 'visionmine',
  terrain: 'standard',
  treeDensity: 1,
};

export function isTerrainType(value: unknown): value is TerrainType {
  return typeof value === 'string' && value in TERRAIN_PRESETS;
}

/** Returns a valid config, replacing malformed fields with defaults. */
export function sanitizeWorldConfig(raw: unknown): WorldConfig {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const density =
    typeof r.treeDensity === 'number' && Number.isFinite(r.treeDensity) ? r.treeDensity : 1;
  return {
    seed:
      typeof r.seed === 'string' && r.seed.length > 0
        ? r.seed.slice(0, 64)
        : DEFAULT_WORLD_CONFIG.seed,
    terrain: isTerrainType(r.terrain) ? r.terrain : 'standard',
    treeDensity: Math.min(2, Math.max(0, density)),
  };
}
