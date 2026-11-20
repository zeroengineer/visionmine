import type * as THREE from 'three';
import type { CameraRig } from '@/core/camera/CameraRig';
import type { InputManager } from '@/core/input/InputManager';
import type { Renderer } from '@/core/renderer/Renderer';
import { ChunkMeshScheduler } from '@/rendering/chunks/ChunkMeshScheduler';
import { ChunkRenderer } from '@/rendering/chunks/ChunkRenderer';
import type { ChunkMaterials } from '@/rendering/chunks/chunkMaterial';
import type { TileAtlas } from '@/rendering/textures/TileAtlas';
import { settingsStore } from '@/state/settingsStore';
import { ChunkManager } from '@/world/chunks/ChunkManager';
import { CHUNK_SIZE } from '@/world/constants';
import { ChunkGeneratorPool } from '@/world/generation/ChunkGeneratorPool';
import type { WorldConfig } from '@/world/generation/config';
import { TerrainGenerator, type SpawnPoint } from '@/world/generation/TerrainGenerator';
import { FaceMesher } from '@/world/meshing/FaceMesher';
import { World } from '@/world/World';

/** Long-lived engine objects shared by every world session. */
export interface EngineContext {
  scene: THREE.Scene;
  cameraRig: CameraRig;
  input: InputManager;
  renderer: Renderer;
  atlas: TileAtlas;
  chunkMaterials: ChunkMaterials;
}

/**
 * Everything that exists only while a particular world is loaded: voxel data,
 * chunk streaming, meshes and (later) the player. Disposing a session releases
 * all of its GPU and worker resources, so worlds can be swapped at runtime.
 */
export class WorldSession {
  readonly world = new World();
  readonly generator: TerrainGenerator;
  readonly spawn: SpawnPoint;
  readonly chunkRenderer: ChunkRenderer;
  readonly chunkManager: ChunkManager;
  readonly meshScheduler: ChunkMeshScheduler;
  private readonly pool: ChunkGeneratorPool;
  private readonly unsubscribers: Array<() => void> = [];
  /** Position that chunk streaming is centred on. */
  private readonly focus = { x: 0, z: 0 };
  private disposed = false;

  constructor(
    protected readonly engine: EngineContext,
    readonly config: WorldConfig,
  ) {
    const settings = settingsStore.getState();
    this.generator = new TerrainGenerator(config);
    this.spawn = this.generator.findSpawn();
    this.focus.x = this.spawn.x;
    this.focus.z = this.spawn.z;

    this.chunkRenderer = new ChunkRenderer(engine.scene, engine.chunkMaterials);
    this.meshScheduler = new ChunkMeshScheduler(this.world, this.chunkRenderer, new FaceMesher());
    this.pool = new ChunkGeneratorPool(config, (cx, cz, blocks) => {
      if (!this.disposed) this.chunkManager.acceptChunk(cx, cz, blocks);
    });
    this.chunkManager = new ChunkManager(this.world, this.pool, settings.renderDistance);
    this.applyViewDistance(settings.renderDistance);

    this.unsubscribers.push(
      settingsStore.subscribe(
        (s) => s.renderDistance,
        (distance) => {
          this.chunkManager.setRenderDistance(distance);
          this.applyViewDistance(distance);
        },
      ),
    );
  }

  fixedUpdate(_step: number): void {
    // Player simulation is stepped here.
  }

  update(_dt: number, elapsed: number): void {
    // Glide over the terrain so chunks stream in and out.
    const camera = this.engine.cameraRig.camera;
    this.focus.x = this.spawn.x + elapsed * 7;
    this.focus.z = this.spawn.z + Math.sin(elapsed * 0.1) * 24;
    camera.position.set(this.focus.x, this.spawn.y + 30, this.focus.z);
    camera.lookAt(this.focus.x + 30, this.spawn.y + 8, this.focus.z + Math.cos(elapsed * 0.1) * 6);

    this.streamChunks();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.pool.dispose();
    this.meshScheduler.dispose();
    this.chunkRenderer.dispose();
    this.world.events.clear();
  }

  protected setFocus(x: number, z: number): void {
    this.focus.x = x;
    this.focus.z = z;
  }

  protected streamChunks(): void {
    const manager = this.chunkManager;
    manager.update(this.focus.x, this.focus.z);
    this.meshScheduler.update(manager.centerChunkX, manager.centerChunkZ, manager.distance + 0.5);
  }

  private applyViewDistance(renderDistance: number): void {
    const far = renderDistance * CHUNK_SIZE;
    const fog = this.engine.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.near = far * 0.55;
      fog.far = far - 4;
    }
    this.engine.cameraRig.setFar(far * 2 + 300);
  }
}
