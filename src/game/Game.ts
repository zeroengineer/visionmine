import type * as THREE from 'three';
import { CameraRig } from '@/core/camera/CameraRig';
import { GameLoop } from '@/core/engine/GameLoop';
import { InputManager } from '@/core/input/InputManager';
import { QUALITY_PROFILES } from '@/core/renderer/quality';
import { Renderer } from '@/core/renderer/Renderer';
import { createScene } from '@/core/scene/createScene';
import { createChunkMaterials, type ChunkMaterials } from '@/rendering/chunks/chunkMaterial';
import { Environment } from '@/rendering/environment/Environment';
import { TileAtlas } from '@/rendering/textures/TileAtlas';
import { inventoryStore } from '@/state/inventoryStore';
import { sessionStore } from '@/state/sessionStore';
import { settingsStore } from '@/state/settingsStore';
import { uiStore } from '@/state/uiStore';
import { DEFAULT_WORLD_CONFIG } from '@/world/generation/config';
import { openRepository } from '@/world/persistence/openRepository';
import type { PlayerRecord, WorldEdits, WorldRecord } from '@/world/persistence/types';
import { SaveManager } from './SaveManager';
import { WorldService } from './WorldService';
import { WorldSession, type EngineContext } from './WorldSession';

/**
 * Composition root for the running game: owns the long-lived engine objects
 * and drives the active world session from the main loop.
 */
export class Game {
  readonly renderer: Renderer;
  readonly scene: THREE.Scene;
  readonly cameraRig: CameraRig;
  readonly input: InputManager;
  readonly environment: Environment;
  readonly atlas: TileAtlas;
  readonly chunkMaterials: ChunkMaterials;
  private session: WorldSession | null = null;
  private saveManager: SaveManager | null = null;
  private service: WorldService | null = null;
  private readonly loop: GameLoop;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement) {
    const settings = settingsStore.getState();
    const profile = QUALITY_PROFILES[settings.quality];

    this.renderer = new Renderer(canvas, {
      antialias: profile.antialias,
      maxPixelRatio: profile.maxPixelRatio,
    });
    this.scene = createScene();
    this.cameraRig = new CameraRig(settings.fov);
    this.input = new InputManager(canvas);
    this.environment = new Environment(this.scene, {
      weatherParticles: 1500 * profile.particleScale,
    });
    this.applyGraphicsSettings();
    this.atlas = new TileAtlas();
    this.chunkMaterials = createChunkMaterials(this.atlas.texture);

    this.unsubscribers.push(
      this.input.events.on('mousedown', () => {
        if (uiStore.getState().screen === 'playing' && !this.input.isLocked)
          this.input.requestLock();
      }),
      this.input.events.on('keydown', ({ code }) => this.onKeyDown(code)),
      this.renderer.onResize((width, height) => this.cameraRig.setAspect(width, height)),
      settingsStore.subscribe(
        (s) => s.fov,
        (fov) => this.cameraRig.setFov(fov),
      ),
      settingsStore.subscribe(
        (s) => s.quality,
        (quality) => this.renderer.setMaxPixelRatio(QUALITY_PROFILES[quality].maxPixelRatio),
      ),
      settingsStore.subscribe(
        (s) => `${s.quality}|${s.shadows}|${s.weather}|${s.dayLengthMinutes}`,
        () => this.applyGraphicsSettings(),
      ),
    );

    this.loop = new GameLoop({
      fixedUpdate: (step) => this.session?.fixedUpdate(step),
      update: (dt, elapsed) => this.update(dt, elapsed),
      render: (alpha) => {
        this.session?.prepareRender(alpha);
        this.renderer.render(this.scene, this.cameraRig.camera);
      },
    });
  }

  /** World management API; available after `boot()` resolves. */
  get worlds(): WorldService {
    if (!this.service) throw new Error('Game.boot() has not completed.');
    return this.service;
  }

  /** Opens storage and enters the most recently played world, creating one if none exist. */
  async boot(): Promise<void> {
    this.service = new WorldService(await openRepository());
    const summaries = await this.service.list().catch(() => []);
    const latest = summaries.find((summary) => !summary.corrupt);
    const record =
      latest && !latest.corrupt
        ? latest.record
        : await this.service.create({
            name: 'My World',
            seed: DEFAULT_WORLD_CONFIG.seed,
            terrain: DEFAULT_WORLD_CONFIG.terrain,
            treeDensity: DEFAULT_WORLD_CONFIG.treeDensity,
            mode: 'creative',
          });
    await this.enterWorld(record);
  }

  get engine(): EngineContext {
    return {
      scene: this.scene,
      cameraRig: this.cameraRig,
      input: this.input,
      renderer: this.renderer,
      atlas: this.atlas,
      chunkMaterials: this.chunkMaterials,
      environment: this.environment,
    };
  }

  get activeSession(): WorldSession | null {
    return this.session;
  }

  /** Loads a saved world and makes it the active session. */
  async enterWorld(record: WorldRecord): Promise<WorldSession> {
    await this.leaveWorld();
    const repository = this.worlds.repository;

    // A world must still open if its edits or player data cannot be read.
    let edits: WorldEdits = new Map();
    let player: PlayerRecord | null = null;
    try {
      [edits, player] = await Promise.all([
        repository.loadEdits(record.id),
        repository.loadPlayer(record.id),
      ]);
    } catch (error) {
      console.error('VISIONMINE: saved data could not be read; starting from the seed.', error);
    }

    sessionStore.getState().setWorld({
      id: record.id,
      name: record.name,
      seed: record.config.seed,
      mode: record.mode,
    });
    this.environment.cycle.setTime(record.timeOfDay);
    this.environment.weather.set('clear', true);

    const session = new WorldSession(this.engine, record.config, { edits, player });
    this.session = session;
    this.saveManager = new SaveManager(repository, record, session, this.environment);
    return session;
  }

  /** Saves and unloads the active world, if any. */
  async leaveWorld(): Promise<void> {
    const saveManager = this.saveManager;
    if (saveManager) {
      await saveManager.save();
      saveManager.dispose();
    }
    this.saveManager = null;
    this.session?.dispose();
    this.session = null;
    sessionStore.getState().setWorld(null);
  }

  openInventory(): void {
    if (uiStore.getState().screen !== 'playing') return;
    uiStore.getState().setScreen('inventory');
    this.input.exitLock();
  }

  closeInventory(): void {
    if (uiStore.getState().screen !== 'inventory') return;
    inventoryStore.getState().dropCursor();
    uiStore.getState().setScreen('playing');
    this.input.requestLock();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.dispose();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.saveManager?.dispose();
    this.saveManager = null;
    this.session?.dispose();
    this.session = null;
    this.chunkMaterials.dispose();
    this.atlas.dispose();
    this.environment.dispose();
    this.input.dispose();
    this.renderer.dispose();
  }

  private applyGraphicsSettings(): void {
    const settings = settingsStore.getState();
    const profile = QUALITY_PROFILES[settings.quality];
    this.environment.lighting.setShadowMapSize(
      settings.shadows ? profile.shadowMapSize || 1024 : 0,
    );
    this.environment.weather.enabled = settings.weather;
    this.environment.cycle.dayLengthSeconds = settings.dayLengthMinutes * 60;
  }

  private onKeyDown(code: string): void {
    const screen = uiStore.getState().screen;
    if (code === 'KeyE') {
      if (screen === 'playing') this.openInventory();
      else if (screen === 'inventory') this.closeInventory();
    } else if (code === 'Escape' && screen === 'inventory') {
      this.closeInventory();
    }
  }

  private update(dt: number, elapsed: number): void {
    this.chunkMaterials.time.value = elapsed;
    this.session?.update(dt, elapsed);
    this.saveManager?.update(dt);

    const camera = this.cameraRig.camera;
    const focus = this.session?.player.position ?? camera.position;
    this.environment.update(
      dt,
      elapsed,
      focus,
      camera.position,
      sessionStore.getState().underwater,
    );
  }
}
