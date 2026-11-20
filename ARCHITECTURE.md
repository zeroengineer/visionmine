# Architecture

VISIONMINE is a **modular monolith**: one browser application, one bundle, with game systems separated into modules that have explicit responsibilities and a fixed dependency direction. There is no server.

## Module map

```
src/
  core/        Engine plumbing: game loop, renderer, camera, input, shared GPU resources
  world/       Voxel data and rules: blocks, chunks, generation, meshing, persistence
  gameplay/    Player, movement, collision, block interaction, inventory, game modes
  rendering/   Everything that turns world/gameplay state into Three.js objects
  ui/          DOM interface: screens, menus, HUD
  state/       Zustand stores shared between gameplay and UI
  utils/       Small pure helpers (math, RNG, hashing)
  main.ts      Composition root
```

## Dependency rules

```
ui ──► state ◄── gameplay ──► world
                 rendering ──► world (read-only)
core ◄── gameplay, rendering
```

- `world/` never imports Three.js or the DOM. It is plain data and pure functions, so it runs unchanged in Web Workers and in Node for unit tests.
- `rendering/` reads world data and owns every GPU object. Nothing outside `rendering/` and `core/` creates meshes, materials or textures.
- `ui/` never touches the scene. It reads and writes Zustand stores and calls a narrow set of game commands.
- `gameplay/` mutates the world only through the `World` facade (`getBlock` / `setBlock`).

## Performance principles

- **No mesh per voxel.** Chunks are drawn with `InstancedMesh`; one instance per _visible block face_.
- **World data is separate from render data.** A chunk is a `Uint8Array`; its mesh is derived and disposable.
- **Bounded work per frame.** Generation runs in workers; meshing is time-budgeted.
- **Explicit disposal.** Every geometry, material and texture has an owner that disposes it.

Each section below is filled in as the corresponding phase lands.

## Voxel data and chunk pipeline

```
ChunkManager ──request──► ChunkGeneratorPool ──► Web Workers (TerrainGenerator)
     ▲                                                   │ Uint8Array (transferred)
     │ focus position                                    ▼
WorldSession                                    World.addChunk ──► event: chunkDirty
                                                                        │
                              ChunkMeshScheduler ◄──────────────────────┘
                                   │  FaceMesher (ChunkMesher interface)
                                   ▼
                              ChunkRenderer ──► InstancedMesh (opaque) + InstancedMesh (water)
```

- **Chunk** — a `Uint8Array` of 16 × 128 × 16 block ids (`x + z*16 + y*256`). No rendering state.
- **World** — map of loaded chunks plus the player's edits (`chunkKey → index → blockId`). Edits live outside chunks so they survive unloading and are the only data that is saved.
- **TerrainGenerator** — pure function of `(config, x, z)`. Height comes from layered simplex noise (continents, erosion, ridges, hills, detail); temperature and moisture choose the biome surface. Trees come from a jittered grid hashed from the seed and are evaluated with a two-block margin, so a canopy crossing a chunk border is produced identically by both chunks.
- **ChunkManager** — keeps chunks loaded within `renderDistance + 2`, requests them nearest-first only when a worker is free, and unloads beyond `renderDistance + 4`.
- **ChunkMeshScheduler** — remeshes player edits immediately; streams new chunks under a 4 ms/frame budget and only when all eight neighbours exist, so border faces and ambient occlusion are exact.
- **FaceMesher** — emits one quad per block face that touches a non-opaque block, with per-corner ambient occlusion. Output is a flat `FaceBatch` (`x, y, z, face, tile, ao×4, width, height`).
- **ChunkRenderer** — writes each batch into an `InstancedMesh` whose base geometry is a single unit quad. The instance matrix encodes position, orientation and size; instanced attributes carry the atlas tile and ambient occlusion. Draw calls are at most two per visible chunk.

### Introducing greedy meshing

`ChunkMesher` is the only seam involved. A greedy mesher implements the same interface and emits fewer faces with `width`/`height` greater than one; the instance matrix already scales the quad and the shader already tiles the texture by the quad size (`vFaceUv = uv * size`). Nothing in `World`, `ChunkManager` or `ChunkRenderer` changes.
