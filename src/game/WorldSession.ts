import type * as THREE from 'three';
import type { CameraRig } from '@/core/camera/CameraRig';
import type { InputManager } from '@/core/input/InputManager';
import type { Renderer } from '@/core/renderer/Renderer';
import { PlayerController } from '@/gameplay/movement/PlayerController';
import { Player, PLAYER_EYE_HEIGHT } from '@/gameplay/player/Player';
import { ChunkMeshScheduler } from '@/rendering/chunks/ChunkMeshScheduler';
import { ChunkRenderer } from '@/rendering/chunks/ChunkRenderer';
import type { ChunkMaterials } from '@/rendering/chunks/chunkMaterial';
import type { TileAtlas } from '@/rendering/textures/TileAtlas';
import { settingsStore } from '@/state/settingsStore';
import { damp, lerp } from '@/utils/math';
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
  readonly player = new Player();
  readonly controller: PlayerController;
  private readonly pool: ChunkGeneratorPool;
  /** False until the terrain under the player has streamed in. */
  private playerReady = false;
  private fovKick = 0;
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

    this.player.teleport(this.spawn.x, this.spawn.y, this.spawn.z);
    this.controller = new PlayerController(this.player, this.world, engine.input);
    this.controller.sensitivity = settings.sensitivity;
    this.controller.invertY = settings.invertY;

    this.unsubscribers.push(
      engine.input.events.on('mousedown', () => {
        if (!engine.input.isLocked) engine.input.requestLock();
      }),
      engine.input.events.on('keydown', ({ code }) => {
        if (code === 'KeyF' && engine.input.isLocked) this.controller.toggleFlying();
      }),
      settingsStore.subscribe(
        (s) => s.sensitivity,
        (value) => (this.controller.sensitivity = value),
      ),
      settingsStore.subscribe(
        (s) => s.invertY,
        (value) => (this.controller.invertY = value),
      ),
      settingsStore.subscribe(
        (s) => s.renderDistance,
        (distance) => {
          this.chunkManager.setRenderDistance(distance);
          this.applyViewDistance(distance);
        },
      ),
    );
  }

  get isPlayerReady(): boolean {
    return this.playerReady;
  }

  fixedUpdate(step: number): void {
    if (!this.playerReady) {
      // Wait for the spawn column, then drop the player onto the surface.
      this.playerReady = this.controller.placeOnGround();
      return;
    }
    this.controller.step(step);
  }

  update(dt: number, _elapsed: number): void {
    this.controller.look();
    this.setFocus(this.player.position.x, this.player.position.z);
    this.streamChunks();

    const kickTarget = this.player.sprinting ? (this.player.flying ? 10 : 7) : 0;
    this.fovKick = lerp(this.fovKick, kickTarget, damp(8, dt));
    this.engine.cameraRig.setFovOffset(this.fovKick);
  }

  /** Positions the camera for this frame; `alpha` blends the last two simulation steps. */
  prepareRender(alpha: number): void {
    const { position, previous, yaw, pitch } = this.player;
    this.engine.cameraRig.setFirstPerson(
      lerp(previous.x, position.x, alpha),
      lerp(previous.y, position.y, alpha) + PLAYER_EYE_HEIGHT,
      lerp(previous.z, position.z, alpha),
      yaw,
      pitch,
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.engine.cameraRig.setFovOffset(0);
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
