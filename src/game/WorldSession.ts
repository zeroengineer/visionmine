import type * as THREE from 'three';
import type { CameraRig } from '@/core/camera/CameraRig';
import type { InputManager } from '@/core/input/InputManager';
import { QUALITY_PROFILES } from '@/core/renderer/quality';
import type { Renderer } from '@/core/renderer/Renderer';
import { BlockInteraction, type InteractionRules } from '@/gameplay/interaction/BlockInteraction';
import { selectedStack, starterInventory } from '@/gameplay/inventory/inventory';
import { GAME_MODES } from '@/gameplay/modes/gameMode';
import { PlayerController } from '@/gameplay/movement/PlayerController';
import { Player, PLAYER_EYE_HEIGHT } from '@/gameplay/player/Player';
import { ChunkMeshScheduler } from '@/rendering/chunks/ChunkMeshScheduler';
import { ChunkRenderer } from '@/rendering/chunks/ChunkRenderer';
import type { Environment } from '@/rendering/environment/Environment';
import { BlockHighlight } from '@/rendering/highlight/BlockHighlight';
import { DebrisParticles } from '@/rendering/particles/DebrisParticles';
import type { ChunkMaterials } from '@/rendering/chunks/chunkMaterial';
import type { TileAtlas } from '@/rendering/textures/TileAtlas';
import { inventoryStore } from '@/state/inventoryStore';
import { sessionStore } from '@/state/sessionStore';
import { settingsStore } from '@/state/settingsStore';
import { damp, lerp } from '@/utils/math';
import { ChunkManager } from '@/world/chunks/ChunkManager';
import { getBlockDef } from '@/world/blocks/blocks';
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
  environment: Environment;
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
  readonly interaction: BlockInteraction;
  readonly particles: DebrisParticles;
  private readonly highlight: BlockHighlight;
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

    this.highlight = new BlockHighlight(engine.scene);
    this.particles = new DebrisParticles(
      engine.scene,
      512 * QUALITY_PROFILES[settings.quality].particleScale,
    );
    this.interaction = new BlockInteraction(
      this.world,
      this.player,
      engine.input,
      this.createInteractionRules(),
    );

    inventoryStore.getState().load(starterInventory(sessionStore.getState().mode));
    this.applyGameMode();

    this.unsubscribers.push(
      this.interaction.events.on('broken', ({ x, y, z, block }) => {
        this.particles.burst(x + 0.5, y + 0.5, z + 0.5, getBlockDef(block).color, 14);
      }),
      engine.input.events.on('keydown', ({ code }) => {
        if (!engine.input.isLocked) return;
        if (code === 'KeyF') this.controller.toggleFlying();
        const digit = /^Digit([1-9])$/.exec(code);
        if (digit) inventoryStore.getState().select(Number(digit[1]) - 1);
      }),
      engine.input.events.on('wheel', ({ direction }) => {
        if (engine.input.isLocked) inventoryStore.getState().cycle(direction);
      }),
      sessionStore.subscribe(
        (s) => s.mode,
        () => this.applyGameMode(),
      ),
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
    if (this.playerReady) this.interaction.update(dt);
    this.highlight.update(this.interaction.target, this.interaction.breakProgress);
    this.particles.update(dt, this.world);
    if (this.player.headInWater !== sessionStore.getState().underwater) {
      sessionStore.getState().setUnderwater(this.player.headInWater);
    }

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
    this.interaction.dispose();
    this.highlight.dispose();
    this.particles.dispose();
    sessionStore.getState().setUnderwater(false);
    this.pool.dispose();
    this.meshScheduler.dispose();
    this.chunkRenderer.dispose();
    this.world.events.clear();
  }

  protected createInteractionRules(): InteractionRules {
    const inventory = inventoryStore;
    const rules = () => GAME_MODES[sessionStore.getState().mode];
    return {
      instantBreak: () => rules().infiniteBlocks,
      selectedBlock: () => selectedStack(inventory.getState())?.block ?? 0,
      onPlaced: () => {
        if (!rules().infiniteBlocks) inventory.getState().consumeSelected(1);
      },
      onBroken: (block) => {
        if (!rules().infiniteBlocks && getBlockDef(block).placeable)
          inventory.getState().add(block, 1);
      },
      onPicked: (block) => {
        if (rules().infiniteBlocks) inventory.getState().pick(block);
      },
      onUse: () => false,
    };
  }

  private applyGameMode(): void {
    const rules = GAME_MODES[sessionStore.getState().mode];
    this.controller.allowFlying = rules.canFly;
    if (!rules.canFly) this.controller.setFlying(false);
    this.interaction.reach = rules.reach;
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
    this.engine.environment.setViewDistance(far - 4);
    this.engine.cameraRig.setFar(far * 2 + 300);
  }
}
