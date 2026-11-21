import type * as THREE from 'three';
import type { Sfx } from '@/core/audio/Sfx';
import type { CameraRig } from '@/core/camera/CameraRig';
import type { InputManager } from '@/core/input/InputManager';
import { QUALITY_PROFILES } from '@/core/renderer/quality';
import type { Renderer } from '@/core/renderer/Renderer';
import { BlockInteraction, type InteractionRules } from '@/gameplay/interaction/BlockInteraction';
import { TntManager } from '@/gameplay/interaction/TntManager';
import { createRaycastHit, raycastVoxels } from '@/gameplay/interaction/voxelRaycast';
import { sanitizeInventory, selectedStack, starterInventory } from '@/gameplay/inventory/inventory';
import { GAME_MODES } from '@/gameplay/modes/gameMode';
import { PlayerController } from '@/gameplay/movement/PlayerController';
import { Player, PLAYER_EYE_HEIGHT, PLAYER_HEIGHT } from '@/gameplay/player/Player';
import { PlayerAvatar } from '@/rendering/avatar/PlayerAvatar';
import { ChunkMeshScheduler } from '@/rendering/chunks/ChunkMeshScheduler';
import { ChunkRenderer } from '@/rendering/chunks/ChunkRenderer';
import type { ChunkMaterials } from '@/rendering/chunks/chunkMaterial';
import type { Environment } from '@/rendering/environment/Environment';
import { BlockHighlight } from '@/rendering/highlight/BlockHighlight';
import { DebrisParticles } from '@/rendering/particles/DebrisParticles';
import { PrimedTntRenderer } from '@/rendering/particles/PrimedTntRenderer';
import type { TileAtlas } from '@/rendering/textures/TileAtlas';
import { inventoryStore } from '@/state/inventoryStore';
import { sessionStore } from '@/state/sessionStore';
import { settingsStore } from '@/state/settingsStore';
import { damp, lerp } from '@/utils/math';
import { BlockId, getBlockDef, IS_SOLID } from '@/world/blocks/blocks';
import { ChunkManager } from '@/world/chunks/ChunkManager';
import { CHUNK_SIZE, SEA_LEVEL } from '@/world/constants';
import { ChunkGeneratorPool } from '@/world/generation/ChunkGeneratorPool';
import type { WorldConfig } from '@/world/generation/config';
import { TerrainGenerator, type SpawnPoint } from '@/world/generation/TerrainGenerator';
import { FaceMesher } from '@/world/meshing/FaceMesher';
import type { PlayerRecord, WorldEdits } from '@/world/persistence/types';
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
  sfx: Sfx;
}

/** Saved state to restore when a session starts. Omitted fields mean "new world". */
export interface SessionInit {
  edits?: WorldEdits;
  player?: PlayerRecord | null;
  /** Non-interactive fly-over used behind the main menu. */
  attract?: boolean;
}

const THIRD_PERSON_DISTANCE = 4.5;
/** Chunk radius that must be meshed before a world is considered loaded. */
const READY_RADIUS = 3;
const isSolid = (id: number): boolean => IS_SOLID[id] === 1;

/**
 * Everything that exists only while a particular world is loaded: voxel data,
 * chunk streaming, meshes, the player and gameplay systems. Disposing a session
 * releases all of its GPU and worker resources, so worlds can be swapped at runtime.
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
  readonly tnt: TntManager;
  readonly attract: boolean;
  /** Freezes player simulation and interaction (pause menu). */
  paused = false;
  thirdPerson = false;

  private readonly pool: ChunkGeneratorPool;
  private readonly highlight: BlockHighlight;
  private readonly primedTnt: PrimedTntRenderer;
  private readonly avatar: PlayerAvatar;
  private readonly cameraHit = createRaycastHit();
  private readonly unsubscribers: Array<() => void> = [];
  /** Position that chunk streaming is centred on. */
  private readonly focus = { x: 0, z: 0 };
  /** False until the terrain under the player has streamed in. */
  private playerReady = false;
  private readonly restoredPlayer: boolean;
  private fovKick = 0;
  private shake = 0;
  private attractHeight = SEA_LEVEL + 40;
  private elapsed = 0;
  private disposed = false;

  constructor(
    private readonly engine: EngineContext,
    readonly config: WorldConfig,
    init: SessionInit = {},
  ) {
    const settings = settingsStore.getState();
    const { scene, input } = engine;
    this.attract = init.attract === true;
    this.generator = new TerrainGenerator(config);
    this.spawn = this.generator.findSpawn();

    if (init.edits) this.world.loadEdits(init.edits);
    const saved = this.attract ? null : (init.player ?? null);
    this.restoredPlayer = saved !== null;
    this.focus.x = saved?.x ?? this.spawn.x;
    this.focus.z = saved?.z ?? this.spawn.z;

    this.chunkRenderer = new ChunkRenderer(scene, engine.chunkMaterials);
    this.meshScheduler = new ChunkMeshScheduler(this.world, this.chunkRenderer, new FaceMesher());
    this.pool = new ChunkGeneratorPool(config, (cx, cz, blocks) => {
      if (!this.disposed) this.chunkManager.acceptChunk(cx, cz, blocks);
    });
    this.chunkManager = new ChunkManager(this.world, this.pool, settings.renderDistance);
    this.applyViewDistance(settings.renderDistance);

    if (saved) {
      this.player.teleport(saved.x, saved.y, saved.z);
      this.player.yaw = saved.yaw;
      this.player.pitch = saved.pitch;
    } else {
      this.player.teleport(this.spawn.x, this.spawn.y, this.spawn.z);
    }
    this.controller = new PlayerController(this.player, this.world, input);
    this.controller.sensitivity = settings.sensitivity;
    this.controller.invertY = settings.invertY;

    this.highlight = new BlockHighlight(scene);
    this.particles = new DebrisParticles(
      scene,
      640 * QUALITY_PROFILES[settings.quality].particleScale,
    );
    this.primedTnt = new PrimedTntRenderer(scene);
    this.avatar = new PlayerAvatar(scene);
    this.tnt = new TntManager(this.world);
    this.interaction = new BlockInteraction(
      this.world,
      this.player,
      input,
      this.createInteractionRules(),
    );

    this.unsubscribers.push(
      settingsStore.subscribe(
        (s) => s.renderDistance,
        (distance) => {
          this.chunkManager.setRenderDistance(distance);
          this.applyViewDistance(distance);
        },
      ),
    );
    if (this.attract) return;

    inventoryStore
      .getState()
      .load(
        saved?.inventory
          ? sanitizeInventory(saved.inventory)
          : starterInventory(sessionStore.getState().mode),
      );
    this.applyGameMode();
    if (saved?.flying) this.controller.setFlying(true);

    this.unsubscribers.push(
      this.interaction.events.on('broken', ({ x, y, z, block }) => {
        this.particles.burst(x + 0.5, y + 0.5, z + 0.5, getBlockDef(block).color, 14);
        engine.sfx.play('break');
      }),
      this.interaction.events.on('placed', () => engine.sfx.play('place')),
      this.tnt.events.on('primed', () => engine.sfx.play('fuse')),
      this.tnt.events.on('exploded', (event) =>
        this.onExplosion(event.x, event.y, event.z, event.radius, event.result.removed),
      ),
      input.events.on('action', ({ action }) => {
        if (!input.isLocked || this.paused) return;
        if (action === 'toggleFly') this.controller.toggleFlying();
        else if (action === 'thirdPerson') this.toggleThirdPerson();
      }),
      input.events.on('keydown', ({ code }) => {
        if (!input.isLocked || this.paused) return;
        const digit = /^Digit([1-9])$/.exec(code);
        if (digit) inventoryStore.getState().select(Number(digit[1]) - 1);
      }),
      input.events.on('wheel', ({ direction }) => {
        if (input.isLocked && !this.paused) inventoryStore.getState().cycle(direction);
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
    );
  }

  get usesWorkers(): boolean {
    return this.pool.usingWorkers;
  }

  get isPlayerReady(): boolean {
    return this.playerReady;
  }

  /** 0..1 — how much of the area around the player is generated and meshed. */
  loadProgress(): number {
    const manager = this.chunkManager;
    if (Number.isNaN(manager.centerChunkX)) return 0;
    const radius = Math.min(manager.distance, READY_RADIUS);
    const { ready, total } = this.meshScheduler.progress(
      manager.centerChunkX,
      manager.centerChunkZ,
      radius,
    );
    return total === 0 ? 0 : ready / total;
  }

  toggleThirdPerson(): void {
    this.thirdPerson = !this.thirdPerson;
    this.avatar.setVisible(this.thirdPerson);
  }

  fixedUpdate(step: number): void {
    if (this.attract || this.paused) return;
    if (!this.playerReady) {
      // Wait for the player's column to stream in. New players are dropped onto the
      // surface; restored players keep their position unless terrain now overlaps them.
      if (!this.world.isLoadedAt(this.player.position.x, this.player.position.z)) return;
      if (this.restoredPlayer) {
        this.controller.freeFromBlocks();
        this.playerReady = true;
      } else {
        this.playerReady = this.controller.placeOnGround();
      }
      return;
    }
    this.controller.step(step);
    this.tnt.update(step);
  }

  update(dt: number, elapsed: number): void {
    this.elapsed = elapsed;
    if (this.attract) {
      this.updateAttract(dt, elapsed);
      this.streamChunks();
      return;
    }

    const { player } = this;
    this.controller.look();
    this.focus.x = player.position.x;
    this.focus.z = player.position.z;
    this.streamChunks();

    if (this.playerReady && !this.paused) this.interaction.update(dt);
    this.highlight.update(this.interaction.target, this.interaction.breakProgress);
    this.particles.update(dt, this.world);
    this.primedTnt.update(this.tnt.active, elapsed);
    this.shake = Math.max(0, this.shake - dt * 1.6);

    if (player.headInWater !== sessionStore.getState().underwater) {
      sessionStore.getState().setUnderwater(player.headInWater);
    }

    const kickTarget = player.sprinting ? (player.flying ? 10 : 7) : 0;
    this.fovKick = lerp(this.fovKick, kickTarget, damp(8, dt));
    this.engine.cameraRig.setFovOffset(this.fovKick);

    if (this.thirdPerson) {
      const speed = Math.hypot(player.velocity.x, player.velocity.z);
      this.avatar.update(
        dt,
        player.position.x,
        player.position.y,
        player.position.z,
        player.yaw,
        player.pitch,
        this.paused ? 0 : speed,
      );
    }
  }

  /** Positions the camera for this frame; `alpha` blends the last two simulation steps. */
  prepareRender(alpha: number): void {
    if (this.attract) return;
    const { position, previous, yaw, pitch } = this.player;
    const rig = this.engine.cameraRig;
    const x = lerp(previous.x, position.x, alpha);
    const y = lerp(previous.y, position.y, alpha) + PLAYER_EYE_HEIGHT;
    const z = lerp(previous.z, position.z, alpha);

    if (this.thirdPerson) {
      // Pull the camera in when terrain is between it and the player.
      const cosPitch = Math.cos(pitch);
      const blocked = raycastVoxels(
        this.world,
        x,
        y,
        z,
        Math.sin(yaw) * cosPitch,
        -Math.sin(pitch),
        Math.cos(yaw) * cosPitch,
        THIRD_PERSON_DISTANCE + 0.3,
        this.cameraHit,
        isSolid,
      );
      const distance = blocked
        ? Math.max(0.3, this.cameraHit.distance - 0.3)
        : THIRD_PERSON_DISTANCE;
      rig.setThirdPerson(x, y, z, yaw, pitch, distance);
    } else {
      rig.setFirstPerson(x, y, z, yaw, pitch);
    }

    if (this.shake > 0) {
      const amount = this.shake * 0.18;
      const t = this.elapsed * 60;
      rig.camera.position.x += Math.sin(t * 1.3) * amount;
      rig.camera.position.y += Math.sin(t * 1.7 + 1) * amount;
      rig.camera.position.z += Math.sin(t * 1.1 + 2) * amount;
    }
  }

  /** Snapshot of the player for saving. */
  capturePlayer(worldId: string): PlayerRecord {
    const { position, yaw, pitch, flying } = this.player;
    return {
      worldId,
      x: position.x,
      y: position.y,
      z: position.z,
      yaw,
      pitch,
      flying,
      inventory: inventoryStore.getState().snapshot(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.engine.cameraRig.setFovOffset(0);
    this.interaction.dispose();
    this.tnt.dispose();
    this.highlight.dispose();
    this.particles.dispose();
    this.primedTnt.dispose();
    this.avatar.dispose();
    this.pool.dispose();
    this.meshScheduler.dispose();
    this.chunkRenderer.dispose();
    this.world.events.clear();
    if (!this.attract) sessionStore.getState().setUnderwater(false);
  }

  private createInteractionRules(): InteractionRules {
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
      onUse: (hit) => {
        if (hit.block !== BlockId.Tnt) return false;
        this.tnt.ignite(hit.x, hit.y, hit.z);
        return true;
      },
    };
  }

  private applyGameMode(): void {
    const rules = GAME_MODES[sessionStore.getState().mode];
    this.controller.allowFlying = rules.canFly;
    if (!rules.canFly) this.controller.setFlying(false);
    this.interaction.reach = rules.reach;
  }

  private onExplosion(
    x: number,
    y: number,
    z: number,
    radius: number,
    removed: ReadonlyArray<{ x: number; y: number; z: number; block: number }>,
  ): void {
    const cx = x + 0.5;
    const cy = y + 0.5;
    const cz = z + 0.5;
    this.particles.burst(cx, cy, cz, 0xffc45a, 36, 0.6, 10);
    this.particles.burst(cx, cy, cz, 0x4a4a4a, 30, 1.2, 6);
    // Sample the destroyed blocks so the debris matches what was blown up.
    const stride = Math.max(1, Math.floor(removed.length / 48));
    for (let i = 0; i < removed.length; i += stride) {
      const b = removed[i]!;
      this.particles.burst(b.x + 0.5, b.y + 0.5, b.z + 0.5, getBlockDef(b.block).color, 3, 0.4, 7);
    }
    this.engine.sfx.play('explosion');

    const { position, velocity } = this.player;
    const dx = position.x - cx;
    const dy = position.y + PLAYER_HEIGHT / 2 - cy;
    const dz = position.z - cz;
    const distance = Math.hypot(dx, dy, dz);
    const reach = radius * 2.2;
    if (distance < reach) {
      const falloff = 1 - distance / reach;
      this.shake = Math.max(this.shake, falloff);
      const push = (falloff * 15) / Math.max(distance, 0.5);
      velocity.x += dx * push;
      velocity.y += Math.max(dy, 0.4) * push;
      velocity.z += dz * push;
    }
  }

  /** Slow circular fly-over of the terrain around the spawn point. */
  private updateAttract(dt: number, elapsed: number): void {
    const angle = elapsed * 0.045;
    const radius = 70;
    const x = this.spawn.x + Math.cos(angle) * radius;
    const z = this.spawn.z + Math.sin(angle) * radius;
    this.focus.x = x;
    this.focus.z = z;

    // Stay above the terrain ahead as well as below.
    const ahead = angle + 0.25;
    const ground = Math.max(
      SEA_LEVEL,
      this.generator.getHeight(Math.floor(x), Math.floor(z)),
      this.generator.getHeight(
        Math.floor(this.spawn.x + Math.cos(ahead) * radius),
        Math.floor(this.spawn.z + Math.sin(ahead) * radius),
      ),
    );
    this.attractHeight = lerp(this.attractHeight, ground + 20, damp(0.8, dt));

    const camera = this.engine.cameraRig.camera;
    camera.position.set(x, this.attractHeight, z);
    camera.lookAt(
      this.spawn.x + Math.cos(angle + 0.9) * radius * 0.8,
      this.attractHeight - 14,
      this.spawn.z + Math.sin(angle + 0.9) * radius * 0.8,
    );
  }

  private streamChunks(): void {
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
