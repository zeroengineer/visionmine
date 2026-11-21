# Architecture

VISIONMINE is a **modular monolith**: one browser application, one bundle, with game systems separated into modules that have explicit responsibilities and a fixed dependency direction. There is no server.

## Module map

```
src/
  core/        Engine plumbing with no game rules
    engine/      GameLoop (fixed-step simulation + interpolated rendering)
    renderer/    WebGL renderer wrapper, quality tiers, adaptive resolution
    camera/      Camera rig (first and third person)
    input/       Keyboard, mouse and pointer-lock state; action map and bindings
    audio/       Synthesised sound effects
    scene/ resources/
  world/       Voxel data and rules — no Three.js, no DOM
    blocks/      Block registry, block shapes and atlas tile ids
    lighting/    Flood-fill light from torches
    chunks/      Chunk storage, coordinates, ChunkManager (streaming)
    generation/  TerrainGenerator, world config, worker and worker pool
    meshing/     ChunkMesher interface and the culled-face mesher
    persistence/ Repository interface, IndexedDB and in-memory backends, codecs
    World.ts     getBlock / setBlock facade, edits, change events
  gameplay/    Player and rules
    player/ movement/ collision/ interaction/ building/ inventory/ modes/
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

- **Chunk** — a `Uint8Array` of 16 × 128 × 16 block ids (`x + z*16 + y*256`), plus an optional parallel `meta` array holding one state byte per block (orientation, open/closed, level). `meta` is allocated the first time a chunk stores a non-zero state, so ordinary terrain costs nothing extra. No rendering state.
- **World** — map of loaded chunks plus the player's edits (`chunkKey → index → cell`, a cell being `state << 8 | blockId`). `setBlock(x, y, z, id, meta = 0)` changes both together and `getMeta` reads the state. Edits live outside chunks so they survive unloading and are the only data that is saved.
- **TerrainGenerator** — pure function of `(config, x, z)`. Height comes from layered simplex noise (continents, erosion, ridges, hills, detail); temperature and moisture choose the biome surface. Trees come from a jittered grid hashed from the seed and are evaluated with a two-block margin, so a canopy crossing a chunk border is produced identically by both chunks.
- **ChunkManager** — keeps chunks loaded within `renderDistance + 2`, requests them nearest-first only when a worker is free, and unloads beyond `renderDistance + 4`.
- **ChunkMeshScheduler** — remeshes player edits immediately; streams new chunks under a 4 ms/frame budget and only when all eight neighbours exist, so border faces and ambient occlusion are exact.
- **FaceMesher** — emits one quad per block face that touches a non-opaque block, with per-corner ambient occlusion. Output is a flat `FaceBatch` (`x, y, z, face, tile, ao×4, width, height`).
- **ChunkRenderer** — writes each batch into an `InstancedMesh` whose base geometry is a single unit quad. The instance matrix encodes position, orientation and size; instanced attributes carry the atlas tile and ambient occlusion. Draw calls are at most two per visible chunk.

### Block shapes

A block that is not a full cube declares a `shape` (`slab`, `stairs`, `door`, `ladder`, `pane`, `post`, `cross`). `world/blocks/shapes.ts` turns a shape and the block's state byte into a list of boxes in block-local coordinates, and those same boxes are used everywhere:

- **Meshing** — `FaceMesher` emits one quad per box face, sized and offset through the existing `width`/`height` and position fields, so the renderer needed no change for boxes. Plants (`cross`) are two diagonal quads drawn from both sides, which are faces 6–9 of `FACE_BASIS`.
- **Collision** — `aabb.ts` resolves a move against the boxes a body overlaps, pushing out to the face of the box that was hit rather than to the cell boundary. Full cubes keep a fast path. Walking up a slab or a stair is the ordinary 0.6-block step-up.
- **Targeting** — `voxelRaycast.ts` walks cells as before and, for a shaped block, intersects the ray with its boxes; the hit carries the exact point, which placement uses (which half a slab fills).

State bits are shared across shapes: the low two bits are a direction (north, east, south, west), bit 2 is "upper half" for slabs and "open" for doors. A door is two blocks (`Door` and `DoorUpper`) that are placed, toggled and removed together; `gameplay/interaction/attachments.ts` enforces that, and removes plants and torches whose support goes, by listening to `World`'s `blockChanged` event — so it holds for clicks, explosions, region tools and undo alike.

### Block light

`world/lighting/BlockLight.ts` flood-fills light from emitting blocks: a torch starts at level 14 and loses one level per block through anything not opaque. Because light reaches at most 15 blocks, a chunk and its eight neighbours hold every emitter that can affect it. Each `Chunk` keeps the set of its emitter positions (maintained by `World`), and the mesher skips the whole computation when the nine chunks hold none — the usual case. Otherwise each face takes the level of the cell it looks into, passed to the shader as a fourth component of the per-face attribute and added as a warm emissive term, so it shows regardless of the sun. Placing or removing a light, or changing an opaque block near one, marks all nine chunks for remeshing.

### Generator versions

`WorldConfig.generator` records which generator version a world was created with, and a world keeps it for life, so explored terrain never changes when the generator gains features. Version 2 added flowers and tall grass (scaled by the vegetation setting); worlds saved before versions existed have none and are treated as version 1. "New Terrain" regenerates everything and so moves the world to the current version.

### Introducing greedy meshing

`ChunkMesher` is the only seam involved. A greedy mesher implements the same interface and emits fewer faces with `width`/`height` greater than one; the instance matrix already scales the quad and the shader already tiles the texture by the quad size (`vFaceUv = uv * size`). Nothing in `World`, `ChunkManager` or `ChunkRenderer` changes.

## Input and actions

Gameplay code never names a key. `core/input/actions.ts` defines the actions (move, jump, break block, open inventory, …), their default bindings and the pure functions that validate, assign and swap bindings; a binding code is a `KeyboardEvent.code` or `Mouse0`–`Mouse2`. `InputManager` holds the current bindings and exposes `isActionDown(action)` for held state and an `action` event for presses. The bindings live in `settingsStore` (validated on load like every other stored value) and `Game` forwards changes to the input manager.

Three inputs are deliberately not actions: mouse look, the hotbar digits, and Escape, which the browser itself uses to release the mouse. The Controls tab in Settings, the main-menu controls list and the loading tips all render from the same bindings.

## Player, collision and interaction

- **Collision** (`gameplay/collision/aabb.ts`) — the player is an axis-aligned box moved one axis at a time (Y, X, Z) and snapped to block boundaries on contact. Moves longer than 0.45 blocks are sub-stepped, so tunnelling is impossible at any speed. No physics engine is used: against a voxel grid this is exact, deterministic and far smaller than a WASM dependency.
- **Movement abilities** (`gameplay/movement/PlayerController.ts`) — sneaking cancels any horizontal move that would leave the body's footprint without ground within 0.6 blocks below; `moveWithStepUp` retries a wall-blocked move from a raised position and keeps it only if the body ends up standing higher and further along (0.6 blocks normally, a full block with auto-jump), while `Player.viewOffsetY` lets the camera ease up after the body has moved. Double jump and dash are switched on per game mode through `GameModeRules`. Presses of jump and dash are read from a queue in `InputManager` (`consumePress`) as well as from held state, so a tap shorter than one simulation step is not lost.
- **Targeting** (`gameplay/interaction/voxelRaycast.ts`) — an Amanatides–Woo DDA walks the grid from the eye along the view direction and returns the hit block and face normal. Cost depends only on reach, never on mesh size.
- **BlockInteraction** — break, place and pick. Mode- and inventory-specific decisions are injected as `InteractionRules`, so the module does not depend on stores. Placement is refused when the new block would overlap the player's body.
- **Builder tools** (`gameplay/building/`) — `regionOps.ts` holds pure region functions over `World` (fill, replace, clear, copy, rotate, paste) capped at 32,768 blocks and refusing regions that touch unloaded chunks. `EditHistory` listens to `World`'s `blockChanged` event and groups changes between two `commit()` calls; `WorldSession` commits after every break, placement and explosion (and once per frame as a catch-all) and `BuildTools` commits around each region operation, so one click, one explosion or one tool use is one undo step even when several happen within a single frame. `BuildTools` combines the two with the two-corner selection and the clipboard, and is switched off by game mode. `rendering/highlight/SelectionBox` draws the selection; `ui/menus/BuildMenu` drives it through `GameCommands.buildAction`.
- **TNT** — `TntManager` counts down fuses and calls `explode`, a pure function over `World` that removes a ragged sphere and reports other TNT for chain reactions.

## State and UI

Zustand vanilla stores (`settingsStore`, `uiStore`, `sessionStore`, `inventoryStore`) hold state that both gameplay and UI need. UI views are plain DOM built once at startup; each subscribes to the store slices it shows and updates only those nodes. The only timer-driven UI is the debug overlay (4 Hz, only while visible). Nothing in the UI runs per frame.

The inventory is an immutable value (`gameplay/inventory/inventory.ts`) manipulated by pure functions; the store just holds the current value.

## Persistence

`WorldRepository` abstracts storage. `IndexedDbRepository` uses three object stores:

| Store     | Key                | Contents                                                                                     |
| --------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `worlds`  | `id`               | name, seed and terrain config, game mode, time of day, dates                                 |
| `chunks`  | `worldId:chunkKey` | that chunk's edits packed as `Uint32Array` (`index<<16 \| state<<8 \| id`), with `format: 2` |
| `players` | `worldId`          | position, view angles, flight state, inventory                                               |

Only edits are stored; terrain is always regenerated from the seed. Save version 2 added the state byte: chunk rows written by version 1 have no `format` field and the older `index<<8 | id` layout, and are decoded as such, then rewritten in the current layout the next time their chunk is saved. A world record from a newer save version than the running build is refused rather than guessed at. `SaveManager` autosaves every 10 seconds and when the tab is hidden, writes only chunks whose edits changed, runs one save at a time and re-queues edits if a write fails.

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
