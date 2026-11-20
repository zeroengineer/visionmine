import type * as THREE from 'three';
import { CameraRig } from '@/core/camera/CameraRig';
import { GameLoop } from '@/core/engine/GameLoop';
import { InputManager } from '@/core/input/InputManager';
import { QUALITY_PROFILES } from '@/core/renderer/quality';
import { Renderer } from '@/core/renderer/Renderer';
import { createScene } from '@/core/scene/createScene';
import { Lighting } from '@/rendering/lighting/Lighting';
import { settingsStore } from '@/state/settingsStore';

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
    this.lighting.dispose();
    this.input.dispose();
    this.renderer.dispose();
  }

  private fixedUpdate(_step: number): void {
    // Simulation systems are stepped here.
  }

  private update(_dt: number, _elapsed: number): void {
    // Per-frame systems are updated here.
  }

  private render(_alpha: number): void {
    this.renderer.render(this.scene, this.cameraRig.camera);
  }
}
