import * as THREE from 'three';

export interface RendererOptions {
  antialias: boolean;
  maxPixelRatio: number;
}

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

/** Thin wrapper over WebGLRenderer: sizing, resolution scaling and stats. */
export class Renderer {
  readonly webgl: THREE.WebGLRenderer;
  private maxPixelRatio: number;
  /** Additional multiplier applied by adaptive quality (0.5..1). */
  private resolutionScale = 1;
  private readonly resizeListeners = new Set<(width: number, height: number) => void>();

  constructor(
    readonly canvas: HTMLCanvasElement,
    options: RendererOptions,
  ) {
    this.webgl = new THREE.WebGLRenderer({
      canvas,
      antialias: options.antialias,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.maxPixelRatio = options.maxPixelRatio;
    this.webgl.toneMapping = THREE.NoToneMapping;
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    this.webgl.shadowMap.enabled = false;
    this.webgl.info.autoReset = true;
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  get width(): number {
    return window.innerWidth;
  }

  get height(): number {
    return window.innerHeight;
  }

  get pixelRatio(): number {
    return this.webgl.getPixelRatio();
  }

  onResize(listener: (width: number, height: number) => void): () => void {
    this.resizeListeners.add(listener);
    listener(this.width, this.height);
    return () => this.resizeListeners.delete(listener);
  }

  setMaxPixelRatio(value: number): void {
    if (value === this.maxPixelRatio) return;
    this.maxPixelRatio = value;
    this.applyPixelRatio();
  }

  setResolutionScale(scale: number): void {
    if (Math.abs(scale - this.resolutionScale) < 0.001) return;
    this.resolutionScale = scale;
    this.applyPixelRatio();
  }

  getResolutionScale(): number {
    return this.resolutionScale;
  }

  setShadowsEnabled(enabled: boolean): void {
    if (this.webgl.shadowMap.enabled === enabled) return;
    this.webgl.shadowMap.enabled = enabled;
    this.webgl.shadowMap.needsUpdate = true;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.webgl.render(scene, camera);
  }

  stats(): RenderStats {
    const info = this.webgl.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.resizeListeners.clear();
    this.webgl.dispose();
  }

  private applyPixelRatio(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio) * this.resolutionScale;
    this.webgl.setPixelRatio(Math.max(0.5, ratio));
    this.webgl.setSize(this.width, this.height, false);
  }

  private readonly resize = (): void => {
    this.applyPixelRatio();
    for (const listener of this.resizeListeners) listener(this.width, this.height);
  };
}
