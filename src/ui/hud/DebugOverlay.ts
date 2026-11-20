import { settingsStore } from '@/state/settingsStore';
import { h, type View } from '../components/dom';
import type { GameCommands } from '../GameCommands';

const REFRESH_MS = 250;

/** F3 overlay: position, chunk and renderer statistics, refreshed four times a second. */
export function createDebugOverlay(commands: GameCommands): View {
  const el = h('pre', { class: 'debug', attrs: { 'aria-hidden': 'true', 'data-testid': 'debug' } });
  let timer = 0;

  const render = (): void => {
    const info = commands.debugInfo();
    if (!info) {
      el.textContent = '';
      return;
    }
    const { x, y, z } = info.position;
    el.textContent = [
      `${info.fps.toFixed(0)} fps  ${info.frameMs.toFixed(1)} ms  ×${info.pixelRatio.toFixed(2)}`,
      `XYZ ${x.toFixed(1)} / ${y.toFixed(1)} / ${z.toFixed(1)}`,
      `Chunk ${info.chunk.x}, ${info.chunk.z}  Facing ${info.facing}${info.flying ? '  Flying' : ''}`,
      `Chunks ${info.meshedChunks} drawn / ${info.loadedChunks} loaded  (${info.pendingMeshes} queued)`,
      `Faces ${info.faces.toLocaleString()}  Draw calls ${info.drawCalls}  Tris ${info.triangles.toLocaleString()}`,
      `GPU geometries ${info.geometries}  textures ${info.textures}`,
      `Time ${info.timeOfDay}  Weather ${info.weather}`,
      `Seed ${info.seed}  Terrain ${info.workers ? 'workers' : 'main thread'}`,
    ].join('\n');
  };

  const apply = (visible: boolean): void => {
    el.hidden = !visible;
    window.clearInterval(timer);
    if (visible) {
      render();
      timer = window.setInterval(render, REFRESH_MS);
    }
  };
  const unsubscribe = settingsStore.subscribe((s) => s.showDebug, apply, { fireImmediately: true });

  return {
    el,
    dispose() {
      window.clearInterval(timer);
      unsubscribe();
      el.remove();
    },
  };
}
