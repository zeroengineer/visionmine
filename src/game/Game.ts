import type * as THREE from 'three';
import { Sfx } from '@/core/audio/Sfx';
import { CameraRig } from '@/core/camera/CameraRig';
import { GameLoop } from '@/core/engine/GameLoop';
import { InputManager } from '@/core/input/InputManager';
import { AdaptiveResolution } from '@/core/renderer/AdaptiveResolution';
import { QUALITY_PROFILES } from '@/core/renderer/quality';
import { Renderer } from '@/core/renderer/Renderer';
import { createScene } from '@/core/scene/createScene';
import type { GameMode } from '@/gameplay/modes/gameMode';
import { createChunkMaterials, type ChunkMaterials } from '@/rendering/chunks/chunkMaterial';
import { Environment } from '@/rendering/environment/Environment';
import { TileAtlas } from '@/rendering/textures/TileAtlas';
import { inventoryStore } from '@/state/inventoryStore';
import { sessionStore } from '@/state/sessionStore';
import { settingsStore } from '@/state/settingsStore';
import { uiStore } from '@/state/uiStore';
import type { DebugInfo, GameCommands, NewWorldOptions } from '@/ui/GameCommands';
import type { WorldConfig } from '@/world/generation/config';
import { openRepository } from '@/world/persistence/openRepository';
import type {
  PlayerRecord,
  WorldEdits,
  WorldRecord,
  WorldSummary,
} from '@/world/persistence/types';
import { SaveManager } from './SaveManager';
import { WorldService } from './WorldService';
import { WorldSession, type EngineContext } from './WorldSession';

/** Terrain shown behind the main menu. */
const MENU_WORLD: WorldConfig = { seed: 'visionmine-title', terrain: 'standard', treeDensity: 1 };
/** Compass names by yaw sector; yaw 0 looks toward -Z (north) and increases turning left. */
const FACING = [
  'North',
  'North-West',
  'West',
  'South-West',
  'South',
  'South-East',
  'East',
  'North-East',
];
/** Ignore an Escape key press that arrives right after the browser released the mouse. */
const PAUSE_DEBOUNCE_MS = 350;

/**
 * Composition root for the running game: owns the long-lived engine objects,
 * drives the active world session from the main loop, and implements the
 * commands the UI is allowed to issue.
 */
export class Game implements GameCommands {
  readonly renderer: Renderer;
  readonly scene: THREE.Scene;
  readonly cameraRig: CameraRig;
  readonly input: InputManager;
  readonly environment: Environment;
  readonly atlas: TileAtlas;
  readonly chunkMaterials: ChunkMaterials;
  readonly sfx = new Sfx();
  private readonly engine: EngineContext;
  private session: WorldSession | null = null;
  private saveManager: SaveManager | null = null;
  private service: WorldService | null = null;
  private readonly loop: GameLoop;
  private readonly unsubscribers: Array<() => void> = [];
  /** A world is loading and the loading screen is waiting for terrain. */
  private loading = false;
  /** Set when the game itself releases the mouse, so it is not treated as a pause. */
  private expectingUnlock = false;
  /** Guards against overlapping world transitions. */
  private busy = false;
  private readonly adaptive: AdaptiveResolution;
  private frameMs = 16.7;
  private pausedAt = 0;

  constructor(canvas: HTMLCanvasElement) {
    const settings = settingsStore.getState();
    const profile = QUALITY_PROFILES[settings.quality];

    this.renderer = new Renderer(canvas, {
      antialias: profile.antialias,
      maxPixelRatio: profile.maxPixelRatio,
    });
    this.adaptive = new AdaptiveResolution(this.renderer);
    this.scene = createScene();
    this.cameraRig = new CameraRig(settings.fov);
    this.input = new InputManager(canvas);
    this.environment = new Environment(this.scene, {
      weatherParticles: 1500 * profile.particleScale,
    });
    this.atlas = new TileAtlas();
    this.chunkMaterials = createChunkMaterials(this.atlas.texture);
    this.engine = {
      scene: this.scene,
      cameraRig: this.cameraRig,
      input: this.input,
      renderer: this.renderer,
      atlas: this.atlas,
      chunkMaterials: this.chunkMaterials,
      environment: this.environment,
      sfx: this.sfx,
    };
    this.applySettings();

    this.unsubscribers.push(
      this.input.events.on('mousedown', () => {
        if (uiStore.getState().screen === 'playing' && !this.input.isLocked)
          this.input.requestLock();
      }),
      this.input.events.on('keydown', ({ code }) => this.onKeyDown(code)),
      this.input.events.on('lockchange', ({ locked }) => this.onLockChange(locked)),
      this.renderer.onResize((width, height) => this.cameraRig.setAspect(width, height)),
      settingsStore.subscribe(
        (s) => s.fov,
        (fov) => this.cameraRig.setFov(fov),
      ),
      settingsStore.subscribe(
        (s) =>
          `${s.quality}|${s.shadows}|${s.weather}|${s.dayLengthMinutes}|${s.volume}|${s.adaptiveQuality}`,
        () => this.applySettings(),
      ),
    );

    this.loop = new GameLoop({
      fixedUpdate: (step) => {
        // Apply the pause state first: the simulation step runs before `update`,
        // so a pause requested since the last frame must already hold here.
        this.syncFrozen();
        this.session?.fixedUpdate(step);
      },
      update: (dt, elapsed) => this.update(dt, elapsed),
      render: (alpha) => {
        this.session?.prepareRender(alpha);
        this.renderer.render(this.scene, this.cameraRig.camera);
      },
    });
  }

  // --- Lifecycle --------------------------------------------------------------

  start(): void {
    this.loop.start();
  }

  /** Opens storage and shows the main menu. */
  async boot(): Promise<void> {
    this.service = new WorldService(await openRepository());
    this.startMenuSession();
    uiStore.getState().setScreen('menu');
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
    this.sfx.dispose();
    this.renderer.dispose();
  }

  get activeSession(): WorldSession | null {
    return this.session;
  }

  // --- GameCommands -------------------------------------------------------------

  get storagePersistent(): boolean {
    return this.service?.persistent ?? false;
  }

  listWorlds(): Promise<WorldSummary[]> {
    return this.worlds.list();
  }

  async createWorld(options: NewWorldOptions): Promise<void> {
    await this.transition(async () => {
      const record = await this.worlds.create(options);
      await this.startWorld(record);
    }, 'The world could not be created.');
  }

  async playWorld(id: string): Promise<void> {
    await this.transition(async () => {
      const record = await this.worlds.repository.getWorld(id);
      if (!record) {
        uiStore.getState().notify('That world could not be read. It may be corrupted.', 'error');
        return;
      }
      await this.startWorld(record);
    }, 'The world could not be loaded.');
  }

  async renameWorld(id: string, name: string): Promise<void> {
    const updated = await this.worlds.rename(id, name);
    if (updated && sessionStore.getState().worldId === id) {
      sessionStore.getState().setWorld({
        id,
        name: updated.name,
        seed: updated.config.seed,
        mode: sessionStore.getState().mode,
      });
    }
  }

  async deleteWorld(id: string): Promise<void> {
    await this.worlds.delete(id);
  }

  resume(): void {
    const ui = uiStore.getState();
    if (ui.screen !== 'paused') return;
    ui.setScreen('playing');
    this.input.requestLock();
  }

  closeInventory(): void {
    if (uiStore.getState().screen !== 'inventory') return;
    inventoryStore.getState().dropCursor();
    uiStore.getState().setScreen('playing');
    this.input.requestLock();
  }

  async saveNow(): Promise<void> {
    await this.saveManager?.save();
  }

  async resetWorld(): Promise<void> {
    const id = this.saveManager?.worldRecord.id;
    if (!id) return;
    await this.transition(async () => {
      await this.leaveWorld();
      const record = await this.worlds.reset(id);
      if (record) await this.startWorld(record);
      else await this.showMenu();
    }, 'The world could not be reset.');
  }

  async regenerateWorld(seed: string): Promise<void> {
    const id = this.saveManager?.worldRecord.id;
    if (!id) return;
    await this.transition(async () => {
      await this.leaveWorld();
      const record = await this.worlds.regenerate(id, seed);
      if (record) await this.startWorld(record);
      else await this.showMenu();
    }, 'The world could not be regenerated.');
  }

  async quitToMenu(): Promise<void> {
    await this.transition(() => this.showMenu(), 'Something went wrong while leaving the world.');
  }

  setMode(mode: GameMode): void {
    sessionStore.getState().setMode(mode);
  }

  playClick(): void {
    this.sfx.play('click');
  }

  debugInfo(): DebugInfo | null {
    const session = this.session;
    if (!session || session.attract) return null;
    const { position, yaw, flying } = session.player;
    const stats = this.renderer.stats();
    const chunkStats = session.chunkRenderer.stats();
    const sector = ((Math.round(yaw / (Math.PI / 4)) % 8) + 8) % 8;
    return {
      fps: 1000 / this.frameMs,
      frameMs: this.frameMs,
      position: { x: position.x, y: position.y, z: position.z },
      facing: FACING[sector]!,
      chunk: { x: session.chunkManager.centerChunkX, z: session.chunkManager.centerChunkZ },
      loadedChunks: session.world.chunkCount,
      meshedChunks: chunkStats.chunks,
      pendingMeshes: session.meshScheduler.pendingCount,
      faces: chunkStats.faces,
      drawCalls: stats.drawCalls,
      triangles: stats.triangles,
      geometries: stats.geometries,
      textures: stats.textures,
      pixelRatio: this.renderer.pixelRatio,
      timeOfDay: this.environment.cycle.formatTime(),
      weather: this.environment.weather.kind,
      seed: session.config.seed,
      flying,
      workers: session.usesWorkers,
    };
  }

  // --- World transitions --------------------------------------------------------

  private get worlds(): WorldService {
    if (!this.service) throw new Error('Game.boot() has not completed.');
    return this.service;
  }

  /** Runs a world transition exclusively and reports failures to the player. */
  private async transition(action: () => Promise<void>, failureMessage: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await action();
    } catch (error) {
      console.error(`VISIONMINE: ${failureMessage}`, error);
      uiStore.getState().notify(failureMessage, 'error');
      this.loading = false;
      await this.showMenu().catch(() => undefined);
    } finally {
      this.busy = false;
    }
  }

  private async startWorld(record: WorldRecord): Promise<void> {
    const ui = uiStore.getState();
    ui.setLoadProgress(0);
    ui.setScreen('loading');
    this.releaseMouse();
    await this.enterWorld(record);
    this.loading = true;
  }

  /** Loads a saved world and makes it the active session. */
  private async enterWorld(record: WorldRecord): Promise<void> {
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
      uiStore.getState().notify('Some saved data could not be read and was skipped.', 'error');
    }

    sessionStore.getState().setWorld({
      id: record.id,
      name: record.name,
      seed: record.config.seed,
      mode: record.mode,
    });
    this.environment.cycle.setTime(record.timeOfDay);
    this.environment.cycle.paused = false;
    this.environment.weather.set('clear', true);

    const session = new WorldSession(this.engine, record.config, { edits, player });
    this.session = session;
    this.saveManager = new SaveManager(repository, record, session, this.environment);
  }

  /** Saves and unloads the active session (world or menu backdrop), if any. */
  private async leaveWorld(): Promise<void> {
    this.loading = false;
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

  private async showMenu(): Promise<void> {
    this.releaseMouse();
    await this.leaveWorld();
    this.startMenuSession();
    uiStore.getState().setScreen('menu');
  }

  private startMenuSession(): void {
    this.environment.cycle.setTime(0.36);
    this.environment.cycle.paused = false;
    this.environment.weather.set('clear', true);
    this.session = new WorldSession(this.engine, MENU_WORLD, { attract: true });
  }

  // --- Input and per-frame --------------------------------------------------------

  private releaseMouse(): void {
    if (!this.input.isLocked) return;
    this.expectingUnlock = true;
    this.input.exitLock();
  }

  private openInventory(): void {
    if (uiStore.getState().screen !== 'playing') return;
    uiStore.getState().setScreen('inventory');
    this.releaseMouse();
  }

  private pause(): void {
    if (uiStore.getState().screen !== 'playing') return;
    uiStore.getState().setScreen('paused');
    this.pausedAt = performance.now();
    this.releaseMouse();
    void this.saveManager?.save();
  }

  private onLockChange(locked: boolean): void {
    uiStore.getState().setPointerLocked(locked);
    if (locked) {
      this.expectingUnlock = false;
      return;
    }
    const expected = this.expectingUnlock;
    this.expectingUnlock = false;
    // The browser released the mouse (Escape, alt-tab): treat it as a pause request.
    if (!expected && uiStore.getState().screen === 'playing') this.pause();
  }

  private onKeyDown(code: string): void {
    const ui = uiStore.getState();
    switch (code) {
      case 'KeyE':
        if (ui.screen === 'playing' && this.input.isLocked) this.openInventory();
        else if (ui.screen === 'inventory') this.closeInventory();
        break;
      case 'Escape':
        if (ui.screen === 'inventory') this.closeInventory();
        else if (ui.screen === 'playing') this.pause();
        else if (ui.screen === 'paused') {
          if (performance.now() - this.pausedAt > PAUSE_DEBOUNCE_MS) this.resume();
        } else if (ui.screen === 'settings' || ui.screen === 'create' || ui.screen === 'worlds')
          ui.back();
        break;
      case 'F3':
        settingsStore.getState().set({ showDebug: !settingsStore.getState().showDebug });
        break;
    }
  }

  private applySettings(): void {
    const settings = settingsStore.getState();
    const profile = QUALITY_PROFILES[settings.quality];
    this.renderer.setMaxPixelRatio(profile.maxPixelRatio);
    this.environment.lighting.setShadowMapSize(
      settings.shadows ? profile.shadowMapSize || 1024 : 0,
    );
    this.environment.weather.enabled = settings.weather;
    this.environment.cycle.dayLengthSeconds = settings.dayLengthMinutes * 60;
    this.sfx.volume = settings.volume;
    this.adaptive.enabled = settings.adaptiveQuality;
    this.adaptive.reset();
  }

  private update(dt: number, elapsed: number): void {
    this.frameMs += (dt * 1000 - this.frameMs) * 0.1;
    this.chunkMaterials.time.value = elapsed;

    const session = this.session;
    const screen = uiStore.getState().screen;
    if (session) {
      const frozen = this.syncFrozen();
      session.update(dt, elapsed);
      if (!frozen) this.saveManager?.update(dt);
      if (this.loading) this.updateLoading(session);
      // Measure only steady gameplay; loading and menus have unrepresentative frame times.
      if (screen === 'playing' && !session.attract) this.adaptive.update(dt);
    }

    const camera = this.cameraRig.camera;
    const focus = session && !session.attract ? session.player.position : camera.position;
    this.environment.update(
      dt,
      elapsed,
      focus,
      camera.position,
      sessionStore.getState().underwater,
    );
  }

  /** Freezes or unfreezes the simulation and world clock to match the current screen. */
  private syncFrozen(): boolean {
    const session = this.session;
    if (!session) return false;
    const screen = uiStore.getState().screen;
    const frozen = !session.attract && (screen === 'paused' || screen === 'settings');
    session.paused = frozen;
    this.environment.cycle.paused = frozen;
    return frozen;
  }

  private updateLoading(session: WorldSession): void {
    const ui = uiStore.getState();
    const progress = session.loadProgress();
    if (Math.abs(progress - ui.loadProgress) >= 0.01) ui.setLoadProgress(progress);
    if (progress < 1 || !session.isPlayerReady) return;
    this.loading = false;
    ui.setLoadProgress(1);
    ui.setScreen('playing');
    this.adaptive.reset();
    if (!this.storagePersistent) {
      ui.notify('Browser storage is unavailable — this world will not be saved.', 'error');
    }
  }
}
