import { IndexedDbRepository } from './IndexedDbRepository';
import { MemoryRepository } from './MemoryRepository';
import type { WorldRepository } from './types';

/**
 * Opens persistent storage, falling back to an in-memory repository when
 * IndexedDB is missing, blocked or broken (private browsing, strict policies).
 */
export async function openRepository(): Promise<WorldRepository> {
  if (typeof indexedDB === 'undefined') return new MemoryRepository();
  try {
    return await IndexedDbRepository.open();
  } catch (error) {
    console.warn('VISIONMINE: IndexedDB is unavailable; worlds will not be saved.', error);
    return new MemoryRepository();
  }
}
