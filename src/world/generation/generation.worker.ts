import type { GeneratorRequest, GeneratorResponse } from './protocol';
import { TerrainGenerator } from './TerrainGenerator';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<GeneratorRequest>) => void) | null;
  postMessage(message: GeneratorResponse, transfer: Transferable[]): void;
};

let generator: TerrainGenerator | null = null;

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'init') {
    generator = new TerrainGenerator(message.config);
    return;
  }
  if (!generator) return;
  const blocks = generator.generateChunk(message.cx, message.cz);
  const buffer = blocks.buffer as ArrayBuffer;
  scope.postMessage({ type: 'chunk', cx: message.cx, cz: message.cz, blocks: buffer }, [buffer]);
};
