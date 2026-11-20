import * as THREE from 'three';
import { SEA_LEVEL } from '@/world/constants';
import { Lighting } from '../lighting/Lighting';
import { createSkyState, DayNightCycle, type SkyState } from './DayNightCycle';
import { Sky } from './Sky';
import { Weather } from './Weather';

const UNDERWATER_FOG = new THREE.Color(0x0f3f6e);
const STORM_TINT = new THREE.Color(0x56606c);
/** Altitude above which precipitation falls as snow. */
const SNOW_ALTITUDE = SEA_LEVEL + 38;

export interface EnvironmentOptions {
  weatherParticles: number;
}

/**
 * Everything atmospheric: world clock, sky dome, sun/moon lighting, fog and
 * weather. One instance lives for the whole application; worlds set its time.
 */
export class Environment {
  readonly cycle = new DayNightCycle();
  readonly lighting: Lighting;
  readonly weather: Weather;
  readonly state: SkyState = createSkyState();
  private readonly sky: Sky;
  private readonly fog: THREE.Fog;
  private readonly fogColor = new THREE.Color();
  private viewDistance = 96;

  constructor(
    private readonly scene: THREE.Scene,
    options: EnvironmentOptions,
  ) {
    this.fog = new THREE.Fog(0xa6d2ff, 50, 96);
    scene.fog = this.fog;
    scene.background = this.fogColor;
    this.sky = new Sky(scene);
    this.lighting = new Lighting(scene);
    this.weather = new Weather(scene, options.weatherParticles);
  }

  /** Distance in blocks at which terrain is fully fogged out. */
  setViewDistance(blocks: number): void {
    this.viewDistance = blocks;
  }

  /**
   * @param focus point the light and shadows are centred on (the player)
   * @param camera world-space camera position
   */
  update(
    dt: number,
    elapsed: number,
    focus: { x: number; y: number; z: number },
    camera: THREE.Vector3,
    underwater: boolean,
  ): void {
    this.cycle.update(dt);
    const state = this.cycle.sample(this.state);

    this.weather.update(dt, elapsed, camera, camera.y > SNOW_ALTITUDE);
    const storm = this.weather.intensity;
    const dim = 1 - storm * 0.45;
    if (storm > 0.01) {
      // Overcast: pull the sky toward grey, scaled by how bright it currently is.
      const grey = storm * 0.6;
      state.zenith.lerp(STORM_TINT, grey).multiplyScalar(dim);
      state.horizon.lerp(STORM_TINT, grey).multiplyScalar(dim);
    }

    this.sky.update(state, dim);
    this.lighting.update(state, focus, dim);

    if (underwater) {
      this.fogColor.copy(UNDERWATER_FOG).multiplyScalar(0.25 + 0.75 * state.daylight);
      this.fog.near = 0.5;
      this.fog.far = 26;
    } else {
      this.fogColor.copy(state.horizon);
      const far = this.viewDistance * (1 - storm * 0.3);
      this.fog.near = far * 0.5;
      this.fog.far = far;
    }
    this.fog.color.copy(this.fogColor);
  }

  dispose(): void {
    this.weather.dispose();
    this.lighting.dispose();
    this.sky.dispose();
    this.scene.fog = null;
    this.scene.background = null;
  }
}
