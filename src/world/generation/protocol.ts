import type { WorldConfig } from './config';

export type GeneratorRequest =
  { type: 'init'; config: WorldConfig } | { type: 'generate'; cx: number; cz: number };

export interface GeneratorResponse {
  type: 'chunk';
  cx: number;
  cz: number;
  blocks: ArrayBuffer;
}
