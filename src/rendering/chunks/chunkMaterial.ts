import * as THREE from 'three';
import { ATLAS_TILES_PER_ROW } from '@/world/blocks/tiles';

export interface ChunkMaterials {
  opaque: THREE.MeshLambertMaterial;
  translucent: THREE.MeshLambertMaterial;
  /** Shared animation clock for the water shader, in seconds. */
  time: { value: number };
  dispose(): void;
}

const VERTEX_PARS = /* glsl */ `
attribute vec3 aFace; // tile index, quad width, quad height
attribute vec4 aAo;   // corner brightness in UV order 00, 10, 01, 11
varying vec2 vTile;
varying vec2 vFaceUv;
varying vec2 vQuadUv;
varying vec4 vAoCorners;
`;

const VERTEX_MAIN = /* glsl */ `
vTile = vec2(mod(aFace.x, ${ATLAS_TILES_PER_ROW}.0), floor(aFace.x / ${ATLAS_TILES_PER_ROW}.0));
vFaceUv = uv * aFace.yz;
vQuadUv = uv;
vAoCorners = aAo;
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec2 vTile;
varying vec2 vFaceUv;
varying vec2 vQuadUv;
varying vec4 vAoCorners;
uniform float uTime;
`;

function fragmentMap(scroll: boolean): string {
  return /* glsl */ `
vec2 tileUv = ${scroll ? 'fract(vFaceUv + vec2(uTime * 0.045, uTime * 0.03))' : 'fract(vFaceUv)'};
tileUv = clamp(tileUv, 0.002, 0.998);
vec2 atlasUv = vec2(
  (vTile.x + tileUv.x) / ${ATLAS_TILES_PER_ROW}.0,
  1.0 - (vTile.y + 1.0 - tileUv.y) / ${ATLAS_TILES_PER_ROW}.0
);
vec4 sampledDiffuseColor = texture2D(map, atlasUv);
diffuseColor *= sampledDiffuseColor;
float aoBottom = mix(vAoCorners.x, vAoCorners.y, vQuadUv.x);
float aoTop = mix(vAoCorners.z, vAoCorners.w, vQuadUv.x);
diffuseColor.rgb *= mix(aoBottom, aoTop, vQuadUv.y);
`;
}

function patch(
  material: THREE.MeshLambertMaterial,
  time: { value: number },
  scroll: boolean,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n${VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', fragmentMap(scroll));
  };
  material.customProgramCacheKey = () => `visionmine-chunk-${scroll ? 'water' : 'solid'}`;
}

/**
 * Materials for instanced chunk faces. They extend MeshLambertMaterial so built-in
 * lighting, fog and shadows keep working; the patch swaps the texture lookup for a
 * per-instance atlas tile and multiplies in baked ambient occlusion.
 */
export function createChunkMaterials(atlas: THREE.Texture): ChunkMaterials {
  const time = { value: 0 };

  const opaque = new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.5 });
  patch(opaque, time, false);

  const translucent = new THREE.MeshLambertMaterial({
    map: atlas,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  patch(translucent, time, true);

  return {
    opaque,
    translucent,
    time,
    dispose() {
      opaque.dispose();
      translucent.dispose();
    },
  };
}
