import { isValidBlockId } from '../blocks/blocks';
import { CHUNK_VOLUME } from '../constants';
import { sanitizeWorldConfig } from '../generation/config';
import { SAVE_VERSION, type PlayerRecord, type WorldRecord } from './types';

/**
 * Packs chunk edits into a typed array: each entry is `blockIndex << 8 | blockId`.
 * Compact, and structured-clone friendly for IndexedDB.
 */
export function encodeEdits(edits: ReadonlyMap<number, number>): Uint32Array {
  const data = new Uint32Array(edits.size);
  let i = 0;
  for (const [index, id] of edits) data[i++] = (index << 8) | (id & 0xff);
  return data;
}

/** Unpacks edits, silently dropping entries that are out of range or unknown. */
export function decodeEdits(data: unknown): Map<number, number> {
  const edits = new Map<number, number>();
  const values: ArrayLike<unknown> | null =
    data instanceof Uint32Array || Array.isArray(data) ? (data as ArrayLike<unknown>) : null;
  if (!values) return edits;
  for (let i = 0; i < values.length; i++) {
    const packed = values[i];
    if (typeof packed !== 'number' || !Number.isInteger(packed) || packed < 0) continue;
    const index = packed >>> 8;
    const id = packed & 0xff;
    if (index >= CHUNK_VOLUME || !isValidBlockId(id)) continue;
    edits.set(index, id);
  }
  return edits;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Returns a clean world record, or null when the stored value is unusable. */
export function parseWorldRecord(raw: unknown): WorldRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0) return null;
  if (typeof r.config !== 'object' || r.config === null) return null;
  const config = r.config as Record<string, unknown>;
  if (typeof config.seed !== 'string' || config.seed.length === 0) return null;
  if (finite(r.version) && r.version > SAVE_VERSION) return null;

  const now = Date.now();
  return {
    id: r.id,
    name: normalizeWorldName(r.name),
    config: sanitizeWorldConfig(config),
    mode: r.mode === 'survival' ? 'survival' : 'creative',
    createdAt: finite(r.createdAt) ? r.createdAt : now,
    lastPlayedAt: finite(r.lastPlayedAt) ? r.lastPlayedAt : now,
    timeOfDay: finite(r.timeOfDay) ? Math.min(1, Math.max(0, r.timeOfDay)) : 0.32,
    version: SAVE_VERSION,
  };
}

/** Returns a clean player record, or null when position data is unusable. */
export function parsePlayerRecord(raw: unknown, worldId: string): PlayerRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!finite(r.x) || !finite(r.y) || !finite(r.z)) return null;
  // Positions far outside the supported coordinate range indicate corruption.
  if (Math.abs(r.x) > 500_000 || Math.abs(r.z) > 500_000 || r.y < -64 || r.y > 512) return null;
  return {
    worldId,
    x: r.x,
    y: r.y,
    z: r.z,
    yaw: finite(r.yaw) ? r.yaw : 0,
    pitch: finite(r.pitch) ? Math.min(1.56, Math.max(-1.56, r.pitch)) : 0,
    flying: r.flying === true,
    inventory: r.inventory ?? null,
  };
}

export const MAX_WORLD_NAME_LENGTH = 32;

/** Trims and bounds a world name, falling back to a default for empty input. */
export function normalizeWorldName(name: unknown): string {
  const text = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  return text.length > 0 ? text.slice(0, MAX_WORLD_NAME_LENGTH) : 'Untitled World';
}
