import * as THREE from 'three';
import { CHUNK_SIZE } from '@/world/constants';
import {
  FACE_BASIS,
  FACE_ORIGIN,
  FACE_STRIDE,
  type ChunkMeshData,
  type FaceBatch,
} from '@/world/meshing/types';
import type { ChunkMaterials } from './chunkMaterial';

// Each instance matrix places the shared unit quad (XY plane, facing +Z, UV origin
// bottom-left) onto one face: columns are `u * width`, `v * height`, `normal`, and
// the quad centre. See FACE_BASIS for the orientation of each face.

const MIN_CAPACITY = 64;

interface Layer {
  mesh: THREE.InstancedMesh;
  capacity: number;
  faceAttr: THREE.InstancedBufferAttribute;
  aoAttr: THREE.InstancedBufferAttribute;
}

interface ChunkEntry {
  opaque: Layer | null;
  translucent: Layer | null;
}

export interface ChunkRenderStats {
  chunks: number;
  faces: number;
}

/**
 * Owns the GPU representation of chunks. Every chunk is at most two
 * `InstancedMesh` objects (opaque + water) whose instances are block faces, so
 * draw calls scale with visible chunks, never with blocks.
 */
export class ChunkRenderer {
  readonly root = new THREE.Group();
  private readonly entries = new Map<number, ChunkEntry>();
  private faceTotal = 0;

  constructor(
    scene: THREE.Scene,
    private readonly materials: ChunkMaterials,
  ) {
    this.root.name = 'chunks';
    this.root.matrixAutoUpdate = false;
    scene.add(this.root);
  }

  /** Creates or refreshes the meshes of one chunk from freshly meshed face data. */
  update(key: number, cx: number, cz: number, data: ChunkMeshData): void {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { opaque: null, translucent: null };
      this.entries.set(key, entry);
    }
    entry.opaque = this.updateLayer(entry.opaque, data.opaque, cx, cz, data, false);
    entry.translucent = this.updateLayer(entry.translucent, data.translucent, cx, cz, data, true);
  }

  remove(key: number): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.disposeLayer(entry.opaque);
    this.disposeLayer(entry.translucent);
    this.entries.delete(key);
  }

  has(key: number): boolean {
    return this.entries.has(key);
  }

  stats(): ChunkRenderStats {
    return { chunks: this.entries.size, faces: this.faceTotal };
  }

  clear(): void {
    for (const key of [...this.entries.keys()]) this.remove(key);
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
  }

  private updateLayer(
    layer: Layer | null,
    batch: FaceBatch,
    cx: number,
    cz: number,
    data: ChunkMeshData,
    translucent: boolean,
  ): Layer | null {
    if (batch.count === 0) {
      this.disposeLayer(layer);
      return null;
    }
    // Reallocate when the batch does not fit, or when the buffer is far too large.
    if (layer && (batch.count > layer.capacity || batch.count < layer.capacity / 4)) {
      this.disposeLayer(layer);
      layer = null;
    }
    if (!layer) layer = this.createLayer(batch.count, cx, cz, translucent);

    this.faceTotal += batch.count - layer.mesh.count;
    this.writeInstances(layer, batch);

    // Tight culling bounds: instance bounds are otherwise recomputed per instance.
    const height = Math.max(1, data.maxY - data.minY);
    const sphere = layer.mesh.boundingSphere ?? new THREE.Sphere();
    sphere.center.set(CHUNK_SIZE / 2, data.minY + height / 2, CHUNK_SIZE / 2);
    sphere.radius = Math.hypot(CHUNK_SIZE / 2, height / 2, CHUNK_SIZE / 2) + 1;
    layer.mesh.boundingSphere = sphere;
    return layer;
  }

  private createLayer(count: number, cx: number, cz: number, translucent: boolean): Layer {
    const capacity = Math.max(MIN_CAPACITY, Math.ceil((count * 1.25) / 64) * 64);
    // Each chunk layer owns its geometry: instanced attributes live on the geometry,
    // and sharing vertex buffers across disposable geometries is unsafe in WebGL state.
    const geometry = new THREE.PlaneGeometry(1, 1);
    const faceAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    const aoAttr = new THREE.InstancedBufferAttribute(new Uint8Array(capacity * 4), 4, true);
    faceAttr.setUsage(THREE.DynamicDrawUsage);
    aoAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aFace', faceAttr);
    geometry.setAttribute('aAo', aoAttr);

    const material = translucent ? this.materials.translucent : this.materials.opaque;
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    // Shadow cost is controlled by the light; with no shadow-casting light these are free.
    mesh.castShadow = !translucent;
    mesh.receiveShadow = true;
    // Water draws after opaque terrain.
    mesh.renderOrder = translucent ? 1 : 0;
    this.root.add(mesh);
    return { mesh, capacity, faceAttr, aoAttr };
  }

  private writeInstances(layer: Layer, batch: FaceBatch): void {
    const src = batch.data;
    const matrices = layer.mesh.instanceMatrix.array as Float32Array;
    const faces = layer.faceAttr.array as Float32Array;
    const ao = layer.aoAttr.array as Uint8Array;

    for (let i = 0; i < batch.count; i++) {
      const s = i * FACE_STRIDE;
      const face = src[s + 3]!;
      const basis = FACE_BASIS[face]!;
      const origin = FACE_ORIGIN[face]!;
      const w = src[s + 9]!;
      const h = src[s + 10]!;
      const u = basis.u;
      const v = basis.v;
      const n = basis.n;

      const m = i * 16;
      matrices[m] = u[0] * w;
      matrices[m + 1] = u[1] * w;
      matrices[m + 2] = u[2] * w;
      matrices[m + 3] = 0;
      matrices[m + 4] = v[0] * h;
      matrices[m + 5] = v[1] * h;
      matrices[m + 6] = v[2] * h;
      matrices[m + 7] = 0;
      matrices[m + 8] = n[0];
      matrices[m + 9] = n[1];
      matrices[m + 10] = n[2];
      matrices[m + 11] = 0;
      matrices[m + 12] = src[s]! + origin[0]! + (u[0] * w + v[0] * h) * 0.5;
      matrices[m + 13] = src[s + 1]! + origin[1]! + (u[1] * w + v[1] * h) * 0.5;
      matrices[m + 14] = src[s + 2]! + origin[2]! + (u[2] * w + v[2] * h) * 0.5;
      matrices[m + 15] = 1;

      const f = i * 3;
      faces[f] = src[s + 4]!;
      faces[f + 1] = w;
      faces[f + 2] = h;

      const a = i * 4;
      ao[a] = src[s + 5]! * 255;
      ao[a + 1] = src[s + 6]! * 255;
      ao[a + 2] = src[s + 7]! * 255;
      ao[a + 3] = src[s + 8]! * 255;
    }

    layer.mesh.count = batch.count;
    layer.mesh.instanceMatrix.needsUpdate = true;
    layer.faceAttr.needsUpdate = true;
    layer.aoAttr.needsUpdate = true;
  }

  private disposeLayer(layer: Layer | null): void {
    if (!layer) return;
    this.faceTotal -= layer.mesh.count;
    this.root.remove(layer.mesh);
    layer.mesh.geometry.dispose();
    layer.mesh.dispose();
  }
}
