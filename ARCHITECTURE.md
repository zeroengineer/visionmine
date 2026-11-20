# Architecture

VISIONMINE is a **modular monolith**: one browser application, one bundle, with game systems separated into modules that have explicit responsibilities and a fixed dependency direction. There is no server.

## Module map

```
src/
  core/        Engine plumbing with no game rules
    engine/      GameLoop (fixed-step simulation + interpolated rendering)
    renderer/    WebGL renderer wrapper, quality tiers, adaptive resolution
    camera/      Camera rig (first and third person)
    input/       Keyboard, mouse and pointer-lock state
    audio/       Synthesised sound effects
    scene/ resources/
  world/       Voxel data and rules — no Three.js, no DOM
    blocks/      Block registry and atlas tile ids
    chunks/      Chunk storage, coordinates, ChunkManager (streaming)
    generation/  TerrainGenerator, world config, worker and worker pool
    meshing/     ChunkMesher interface and the culled-face mesher
    persistence/ Repository interface, IndexedDB and in-memory backends, codecs
    World.ts     getBlock / setBlock facade, edits, change events
  gameplay/    Player and rules
    player/ movement/ collision/ interaction/ inventory/ modes/
  rendering/   Turns world and gameplay state into Three.js objects
    chunks/      ChunkRenderer (InstancedMesh), materials, mesh scheduler
    environment/ Day/night cycle, sky dome, fog, weather
    lighting/ particles/ highlight/ avatar/ textures/
  state/       Zustand vanilla stores shared by gameplay and UI
  ui/          DOM interface: screens, menus, HUD, inventory, components
  game/        Composition root: Game, WorldSession, SaveManager, WorldService
  utils/       Pure helpers (math, RNG, emitter)
  main.ts
```

## Dependency rules

```
ui ──► state ◄── game ──► gameplay ──► world
 │                 │
 └─ GameCommands ◄─┘      rendering ──► world (read-only)
                          core ◄── game, gameplay, rendering
```

- `world/` never imports Three.js or the DOM. It is plain data and pure functions, so it runs unchanged in Web Workers and in Node for unit tests.
- `rendering/` reads world data and owns every GPU object. Nothing outside `rendering/` and `core/` creates meshes, materials or textures.
- `ui/` never touches the scene, the world or storage. It reads Zustand stores and calls the `GameCommands` interface, which `Game` implements.
- `gameplay/` mutates the world only through the `World` facade.
- `game/` is the only layer that knows about everything; it wires modules together and owns lifecycles.

## Runtime structure

`Game` owns the long-lived engine objects (renderer, scene, camera, input, environment, texture atlas, chunk materials). A `WorldSession` owns everything tied to one loaded world (voxel data, worker pool, chunk meshes, player, interaction, particles). Switching worlds disposes the session and creates a new one, which is also how the main-menu backdrop works: it is a session in non-interactive "attract" mode.

Each frame:

1. `fixedUpdate(1/60 s)` zero or more times — player physics and TNT fuses.
2. `update(dt)` — look input, chunk streaming and meshing, interaction raycast, particles, environment, autosave timer.
3. `render(alpha)` — camera placed by interpolating the last two physics states, then one `renderer.render`.

Screen flow is a small state machine in `uiStore.screen`:

```
boot → menu ⇄ create / worlds / settings
          └→ loading → playing ⇄ inventory
                          ⇅
                        paused ⇄ settings
```

Losing pointer lock while `playing` (Escape, alt-tab) moves to `paused`; the simulation and the world clock freeze while paused.

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

## Player, collision and interaction

- **Collision** (`gameplay/collision/aabb.ts`) — the player is an axis-aligned box moved one axis at a time (Y, X, Z) and snapped to block boundaries on contact. Moves longer than 0.45 blocks are sub-stepped, so tunnelling is impossible at any speed. No physics engine is used: against a voxel grid this is exact, deterministic and far smaller than a WASM dependency.
- **Targeting** (`gameplay/interaction/voxelRaycast.ts`) — an Amanatides–Woo DDA walks the grid from the eye along the view direction and returns the hit block and face normal. Cost depends only on reach, never on mesh size.
- **BlockInteraction** — break, place and pick. Mode- and inventory-specific decisions are injected as `InteractionRules`, so the module does not depend on stores. Placement is refused when the new block would overlap the player's body.
- **TNT** — `TntManager` counts down fuses and calls `explode`, a pure function over `World` that removes a ragged sphere and reports other TNT for chain reactions.

## State and UI

Zustand vanilla stores (`settingsStore`, `uiStore`, `sessionStore`, `inventoryStore`) hold state that both gameplay and UI need. UI views are plain DOM built once at startup; each subscribes to the store slices it shows and updates only those nodes. The only timer-driven UI is the debug overlay (4 Hz, only while visible). Nothing in the UI runs per frame.

The inventory is an immutable value (`gameplay/inventory/inventory.ts`) manipulated by pure functions; the store just holds the current value.

## Persistence

`WorldRepository` abstracts storage. `IndexedDbRepository` uses three object stores:

| Store     | Key                | Contents                                                      |
| --------- | ------------------ | ------------------------------------------------------------- |
| `worlds`  | `id`               | name, seed and terrain config, game mode, time of day, dates  |
| `chunks`  | `worldId:chunkKey` | that chunk's edits packed as `Uint32Array` (`index<<8 \| id`) |
| `players` | `worldId`          | position, view angles, flight state, inventory                |

Only edits are stored; terrain is always regenerated from the seed. `SaveManager` autosaves every 10 seconds and when the tab is hidden, writes only chunks whose edits changed, runs one save at a time and re-queues edits if a write fails.

Everything read from storage passes through validators (`codec.ts`, `sanitizeInventory`, `sanitizeSettings`). A world record that cannot be parsed appears in the world list as damaged with a delete action; unreadable edits or player data fall back to the generated world. If IndexedDB cannot be opened, `MemoryRepository` takes over and the UI states that worlds will not persist.

## Performance decisions

| Decision                                                                | Reason                                                                                                                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Instanced faces instead of instanced cubes                              | Only visible faces reach the GPU — roughly a quarter of the triangles of cube instancing — while keeping one draw call per chunk layer |
| Manual bounding spheres per chunk mesh                                  | `InstancedMesh` would otherwise iterate every instance to compute bounds; frustum culling stays O(chunks)                              |
| Generation in a worker pool, no queue                                   | Requests are issued nearest-first only when a worker is idle, so priorities never go stale                                             |
| Meshing budget of 4 ms per frame                                        | Streaming never causes long frames; edits bypass the budget so building feels instant                                                  |
| Procedural 128 × 128 atlas, nearest filtering                           | One texture and one material for all terrain; no asset downloads                                                                       |
| One shadow map that follows the player                                  | Cost is fixed regardless of world size; resolution depends on the quality tier and can be turned off                                   |
| GPU-animated weather, instanced debris                                  | One draw call each, no per-particle objects                                                                                            |
| Quality tier from the GPU string, adaptive resolution from measured FPS | Sensible defaults on integrated GPUs and automatic recovery when a scene is too heavy                                                  |
| Explicit `dispose()` on every GPU owner                                 | Unloading chunks or leaving a world returns geometry, texture and worker memory                                                        |
