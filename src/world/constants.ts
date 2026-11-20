/** Horizontal size of a chunk in blocks (must be a power of two). */
export const CHUNK_SIZE = 16;
export const CHUNK_SHIFT = 4;
export const CHUNK_MASK = CHUNK_SIZE - 1;
/** Vertical size of the world in blocks. */
export const CHUNK_HEIGHT = 128;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_AREA * CHUNK_HEIGHT;
/** Water fills every air block at or below this level. */
export const SEA_LEVEL = 48;
