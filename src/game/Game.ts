import type * as THREE from 'three';
import { CameraRig } from '@/core/camera/CameraRig';
import { GameLoop } from '@/core/engine/GameLoop';
import { InputManager } from '@/core/input/InputManager';
import { QUALITY_PROFILES } from '@/core/renderer/quality';
import { Renderer } from '@/core/renderer/Renderer';
import { createScene } from '@/core/scene/createScene';
import { createChunkMaterials, type ChunkMaterials } from '@/rendering/chunks/chunkMaterial';
import { Lighting } from '@/rendering/lighting/Lighting';
import { TileAtlas } from '@/rendering/textures/TileAtlas';
import { settingsStore } from '@/state/settingsStore';
import { DEFAULT_WORLD_CONFIG, type WorldConfig } from '@/world/generation/config';
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
  readonly lighting: Lighting;
  readonly atlas: TileAtlas;
  readonly chunkMaterials: ChunkMaterials;
  private session: WorldSession | null = null;
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
    this.lighting = new Lighting(this.scene);
    this.atlas = new TileAtlas();
    this.chunkMaterials = createChunkMaterials(this.atlas.texture);

    this.unsubscribers.push(
      this.renderer.onResize((width, height) => this.cameraRig.setAspect(width, height)),
      settingsStore.subscribe(
        (s) => s.fov,
        (fov) => this.cameraRig.setFov(fov),
      ),
      settingsStore.subscribe(
        (s) => s.quality,
        (quality) => this.renderer.setMaxPixelRatio(QUALITY_PROFILES[quality].maxPixelRatio),
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

    this.loadWorld(DEFAULT_WORLD_CONFIG);
  }

  get engine(): EngineContext {
    return {
      scene: this.scene,
      cameraRig: this.cameraRig,
      input: this.input,
      renderer: this.renderer,
      atlas: this.atlas,
      chunkMaterials: this.chunkMaterials,
    };
  }

  get activeSession(): WorldSession | null {
    return this.session;
  }

  /** Replaces the current world with a newly generated one. */
  loadWorld(config: WorldConfig): WorldSession {
    this.session?.dispose();
    this.session = new WorldSession(this.engine, config);
    return this.session;
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.dispose();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.session?.dispose();
    this.session = null;
    this.chunkMaterials.dispose();
    this.atlas.dispose();
    this.lighting.dispose();
    this.input.dispose();
    this.renderer.dispose();
  }

  private update(dt: number, elapsed: number): void {
    this.chunkMaterials.time.value = elapsed;
    this.session?.update(dt, elapsed);
  }
}
