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
attribute vec4 aFace; // tile index, quad width, quad height, block light 0..1
attribute vec4 aAo;   // corner brightness in UV order 00, 10, 01, 11
varying vec2 vTile;
varying vec2 vFaceUv;
varying vec2 vQuadUv;
varying vec4 vAoCorners;
varying float vBlockLight;
`;

const VERTEX_MAIN = /* glsl */ `
vTile = vec2(mod(aFace.x, ${ATLAS_TILES_PER_ROW}.0), floor(aFace.x / ${ATLAS_TILES_PER_ROW}.0));
vFaceUv = uv * aFace.yz;
vQuadUv = uv;
vAoCorners = aAo;
vBlockLight = aFace.w;
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec2 vTile;
varying vec2 vFaceUv;
varying vec2 vQuadUv;
varying vec4 vAoCorners;
varying float vBlockLight;
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
// Torchlight: a warm glow that does not depend on the sun, so it shows at night.
totalEmissiveRadiance += diffuseColor.rgb * vBlockLight * vBlockLight * vec3(1.0, 0.82, 0.58) * 0.9;
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
  material.customProgramCacheKey = () => `visionmine-chunk-v2-${scroll ? 'water' : 'solid'}`;
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
