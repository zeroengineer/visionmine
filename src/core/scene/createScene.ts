import * as THREE from 'three';

/** Creates the root scene. Background and fog are owned by the Environment. */
export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.matrixWorldAutoUpdate = true;
  return scene;
}
