import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  bindingsEqual,
  defaultBindings,
  sanitizeBindings,
  type Bindings,
} from '@/core/input/actions';
import {
  classifyDevice,
  probeDevice,
  QUALITY_PROFILES,
  type QualityTier,
} from '@/core/renderer/quality';

export interface Settings {
  quality: QualityTier;
  renderDistance: number;
  shadows: boolean;
  /** Automatically lower resolution when the frame rate drops. */
  adaptiveQuality: boolean;
  fov: number;
  /** Mouse sensitivity multiplier (1 = default). */
  sensitivity: number;
  invertY: boolean;
  /** Climb one-block ledges without pressing jump. */
  autoJump: boolean;
  /** Sprint key toggles sprinting instead of being held. */
  sprintToggle: boolean;
  weather: boolean;
  /** Length of a full day/night cycle in minutes. */
  dayLengthMinutes: number;
  volume: number;
  showDebug: boolean;
  /** Keys and mouse buttons bound to each action. */
  bindings: Bindings;
}

export interface SettingsState extends Settings {
  set(patch: Partial<Settings>): void;
  applyQualityPreset(tier: QualityTier): void;
  reset(): void;
}

const STORAGE_KEY = 'visionmine.settings.v1';

export const SETTING_LIMITS = {
  renderDistance: { min: 2, max: 12 },
  fov: { min: 50, max: 110 },
  sensitivity: { min: 0.2, max: 3 },
  dayLengthMinutes: { min: 2, max: 60 },
} as const;

function defaults(): Settings {
  const tier = typeof document === 'undefined' ? 'medium' : classifyDevice(probeDevice());
  const profile = QUALITY_PROFILES[tier];
  return {
    quality: tier,
    renderDistance: profile.renderDistance,
    shadows: profile.shadowMapSize > 0,
    adaptiveQuality: true,
    fov: 75,
    sensitivity: 1,
    invertY: false,
    autoJump: false,
    sprintToggle: false,
    weather: true,
    dayLengthMinutes: 12,
    volume: 0.6,
    showDebug: false,
    bindings: defaultBindings(),
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/** Merges stored values over defaults, discarding anything malformed. */
export function sanitizeSettings(raw: unknown, base: Settings): Settings {
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  const L = SETTING_LIMITS;
  return {
    quality:
      r.quality === 'low' || r.quality === 'medium' || r.quality === 'high'
        ? r.quality
        : base.quality,
    renderDistance: Math.round(
      clampNumber(
        r.renderDistance,
        L.renderDistance.min,
        L.renderDistance.max,
        base.renderDistance,
      ),
    ),
    shadows: bool(r.shadows, base.shadows),
    adaptiveQuality: bool(r.adaptiveQuality, base.adaptiveQuality),
    fov: clampNumber(r.fov, L.fov.min, L.fov.max, base.fov),
    sensitivity: clampNumber(r.sensitivity, L.sensitivity.min, L.sensitivity.max, base.sensitivity),
    invertY: bool(r.invertY, base.invertY),
    autoJump: bool(r.autoJump, base.autoJump),
    sprintToggle: bool(r.sprintToggle, base.sprintToggle),
    weather: bool(r.weather, base.weather),
    dayLengthMinutes: clampNumber(
      r.dayLengthMinutes,
      L.dayLengthMinutes.min,
      L.dayLengthMinutes.max,
      base.dayLengthMinutes,
    ),
    volume: clampNumber(r.volume, 0, 1, base.volume),
    showDebug: bool(r.showDebug, base.showDebug),
    bindings: keepIfEqual(r.bindings, base.bindings),
  };
}

/** Sanitises stored bindings, keeping the current object when nothing changed so subscribers stay quiet. */
function keepIfEqual(raw: unknown, current: Bindings): Bindings {
  if (raw === undefined || raw === current) return current;
  const next = sanitizeBindings(raw);
  return bindingsEqual(next, current) ? current : next;
}

function load(): Settings {
  const base = defaults();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? sanitizeSettings(JSON.parse(stored), base) : base;
  } catch {
    return base;
  }
}

function persist(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private mode, quota); settings stay in memory.
  }
}

function pick(state: SettingsState): Settings {
  const { set: _set, applyQualityPreset: _apply, reset: _reset, ...settings } = state;
  return settings;
}

export const settingsStore = createStore<SettingsState>()(
  subscribeWithSelector((set, get) => ({
    ...load(),
    set(patch) {
      set(sanitizeSettings({ ...pick(get()), ...patch }, pick(get())));
      persist(pick(get()));
    },
    applyQualityPreset(tier) {
      const profile = QUALITY_PROFILES[tier];
      get().set({
        quality: tier,
        renderDistance: profile.renderDistance,
        shadows: profile.shadowMapSize > 0,
      });
    },
    reset() {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      set(defaults());
    },
  })),
);
