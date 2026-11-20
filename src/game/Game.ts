import type * as THREE from 'three';
import { CameraRig } from '@/core/camera/CameraRig';
import { GameLoop } from '@/core/engine/GameLoop';
import { InputManager } from '@/core/input/InputManager';
import { QUALITY_PROFILES } from '@/core/renderer/quality';
import { Renderer } from '@/core/renderer/Renderer';
import { createScene } from '@/core/scene/createScene';
import { ChunkRenderer } from '@/rendering/chunks/ChunkRenderer';
import { createChunkMaterials, type ChunkMaterials } from '@/rendering/chunks/chunkMaterial';
import { Lighting } from '@/rendering/lighting/Lighting';
import { TileAtlas } from '@/rendering/textures/TileAtlas';
import { settingsStore } from '@/state/settingsStore';
import { FaceMesher } from '@/world/meshing/FaceMesher';
import type { ChunkMesher } from '@/world/meshing/types';
import { World } from '@/world/World';
import { buildShowcaseWorld, SHOWCASE_GROUND } from './showcaseWorld';

/**
 * Composition root for the running game: owns the engine objects and drives
 * every system from the main loop.
 */
export class Game {
  readonly renderer: Renderer;
  readonly scene: THREE.Scene;
  readonly cameraRig: CameraRig;
  readonly input: InputManager;
  readonly lighting: Lighting;
  readonly atlas: TileAtlas;
  readonly chunkMaterials: ChunkMaterials;
  readonly chunkRenderer: ChunkRenderer;
  readonly world: World;
  private readonly mesher: ChunkMesher = new FaceMesher();
  private readonly dirtyChunks = new Set<number>();
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
    this.cameraRig.camera.position.set(0, 70, 0);
    this.input = new InputManager(canvas);
    this.lighting = new Lighting(this.scene);
    this.atlas = new TileAtlas();
    this.chunkMaterials = createChunkMaterials(this.atlas.texture);
    this.chunkRenderer = new ChunkRenderer(this.scene, this.chunkMaterials);

    this.world = new World();
    this.world.events.on('chunkDirty', ({ key }) => this.dirtyChunks.add(key));
    buildShowcaseWorld(this.world);

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
      fixedUpdate: (step) => this.fixedUpdate(step),
      update: (dt, elapsed) => this.update(dt, elapsed),
      render: (alpha) => this.render(alpha),
    });
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.dispose();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.chunkRenderer.dispose();
    this.chunkMaterials.dispose();
    this.atlas.dispose();
    this.lighting.dispose();
    this.input.dispose();
    this.renderer.dispose();
  }

  private fixedUpdate(_step: number): void {
    // Simulation systems are stepped here.
  }

  private update(_dt: number, elapsed: number): void {
    this.chunkMaterials.time.value = elapsed;
    this.remeshDirtyChunks();

    // Slow orbit around the showcase area.
    const angle = elapsed * 0.15;
    const camera = this.cameraRig.camera;
    camera.position.set(Math.cos(angle) * 30, SHOWCASE_GROUND + 16, Math.sin(angle) * 30);
    camera.lookAt(0, SHOWCASE_GROUND + 2, 0);
  }

  private remeshDirtyChunks(): void {
    if (this.dirtyChunks.size === 0) return;
    const lookup = (cx: number, cz: number) => this.world.getChunk(cx, cz);
    for (const key of this.dirtyChunks) {
      const chunk = this.world.getChunkByKey(key);
      if (chunk)
        this.chunkRenderer.update(key, chunk.cx, chunk.cz, this.mesher.mesh(chunk, lookup));
    }
    this.dirtyChunks.clear();
  }

  private render(_alpha: number): void {
    this.renderer.render(this.scene, this.cameraRig.camera);
  }
}
