import * as THREE from 'three';

export const DEFAULT_SKY_COLOR = 0x8ec5ff;

/** Creates the root scene. Matrices of static objects are updated manually. */
export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(DEFAULT_SKY_COLOR);
  scene.fog = new THREE.Fog(DEFAULT_SKY_COLOR, 50, 110);
  return scene;
}
