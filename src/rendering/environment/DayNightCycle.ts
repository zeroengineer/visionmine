import * as THREE from 'three';
import { clamp, mod, smoothstep } from '@/utils/math';

export interface SkyState {
  /** Unit vector pointing at the sun. */
  sunDirection: THREE.Vector3;
  moonDirection: THREE.Vector3;
  /** 0 at night, 1 in full daylight. */
  daylight: number;
  /** Peaks at sunrise and sunset. */
  twilight: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  sunColor: THREE.Color;
  /** Direction the dominant light comes from (sun by day, moon by night). */
  lightDirection: THREE.Vector3;
  lightColor: THREE.Color;
  lightIntensity: number;
  ambientSky: THREE.Color;
  ambientGround: THREE.Color;
  ambientIntensity: number;
  starOpacity: number;
}

const DAY_ZENITH = new THREE.Color(0x2f7fe0);
const DAY_HORIZON = new THREE.Color(0xa6d2ff);
const NIGHT_ZENITH = new THREE.Color(0x03050c);
const NIGHT_HORIZON = new THREE.Color(0x0d1626);
const DUSK_HORIZON = new THREE.Color(0xff9457);
const DUSK_ZENITH = new THREE.Color(0x4a4a8a);
const SUN_NOON = new THREE.Color(0xfff4dc);
const SUN_LOW = new THREE.Color(0xff9d52);
const MOON_LIGHT = new THREE.Color(0x8fa8ff);
const AMBIENT_DAY_SKY = new THREE.Color(0xcfe6ff);
const AMBIENT_NIGHT_SKY = new THREE.Color(0x27365e);
const AMBIENT_DAY_GROUND = new THREE.Color(0x6b5a45);
const AMBIENT_NIGHT_GROUND = new THREE.Color(0x10121c);
/** Tilt of the sun's path away from straight overhead. */
const SUN_TILT = 0.38;

export function createSkyState(): SkyState {
  return {
    sunDirection: new THREE.Vector3(0, 1, 0),
    moonDirection: new THREE.Vector3(0, -1, 0),
    daylight: 1,
    twilight: 0,
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    sunColor: new THREE.Color(),
    lightDirection: new THREE.Vector3(0, 1, 0),
    lightColor: new THREE.Color(),
    lightIntensity: 1,
    ambientSky: new THREE.Color(),
    ambientGround: new THREE.Color(),
    ambientIntensity: 1,
    starOpacity: 0,
  };
}

/**
 * World clock. `time` runs 0..1 over one day: 0 = midnight, 0.25 = sunrise,
 * 0.5 = noon, 0.75 = sunset. `sample` derives all sky and light parameters.
 */
export class DayNightCycle {
  time = 0.32;
  dayLengthSeconds = 720;
  paused = false;

  update(dt: number): void {
    if (this.paused || this.dayLengthSeconds <= 0) return;
    this.time = mod(this.time + dt / this.dayLengthSeconds, 1);
  }

  setTime(time: number): void {
    this.time = Number.isFinite(time) ? mod(time, 1) : 0.32;
  }

  sample(out: SkyState): SkyState {
    const angle = (this.time - 0.25) * Math.PI * 2;
    out.sunDirection.set(Math.cos(angle), Math.sin(angle), SUN_TILT).normalize();
    out.moonDirection.copy(out.sunDirection).negate();

    const elevation = out.sunDirection.y;
    const daylight = smoothstep(-0.14, 0.2, elevation);
    const twilight = Math.exp(-((elevation / 0.2) ** 2)) * 0.85;
    out.daylight = daylight;
    out.twilight = twilight;

    out.zenith
      .copy(NIGHT_ZENITH)
      .lerp(DAY_ZENITH, daylight)
      .lerp(DUSK_ZENITH, twilight * 0.35);
    out.horizon
      .copy(NIGHT_HORIZON)
      .lerp(DAY_HORIZON, daylight)
      .lerp(DUSK_HORIZON, twilight * 0.6);
    out.sunColor.copy(SUN_LOW).lerp(SUN_NOON, smoothstep(0.05, 0.45, elevation));

    const sunStrength = smoothstep(-0.04, 0.22, elevation);
    if (sunStrength > 0.02) {
      out.lightDirection.copy(out.sunDirection);
      out.lightColor.copy(out.sunColor);
      out.lightIntensity = 2.1 * sunStrength;
    } else {
      out.lightDirection.copy(out.moonDirection);
      out.lightColor.copy(MOON_LIGHT);
      out.lightIntensity = 0.32 * smoothstep(0.02, 0.3, -elevation);
    }
    // Keep the light from skimming the horizon, which stretches shadows to infinity.
    if (out.lightDirection.y < 0.12) {
      out.lightDirection.y = 0.12;
      out.lightDirection.normalize();
    }

    out.ambientSky.copy(AMBIENT_NIGHT_SKY).lerp(AMBIENT_DAY_SKY, daylight);
    out.ambientGround.copy(AMBIENT_NIGHT_GROUND).lerp(AMBIENT_DAY_GROUND, daylight);
    out.ambientIntensity = 0.42 + 0.78 * daylight;
    out.starOpacity = clamp(1 - daylight * 1.6, 0, 1);
    return out;
  }

  /** Clock text such as "14:30". */
  formatTime(): string {
    const minutes = Math.floor(this.time * 24 * 60);
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }
}
