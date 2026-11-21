# Development

## Prerequisites

- Node.js 20.19+ (22 LTS recommended) and npm 10+
- A WebGL 2 capable browser (Chrome, Edge, Firefox or Safari, current versions)

## Setup

```bash
npm install
npm run dev
```

## Scripts

| Script                            | Purpose                                                             |
| --------------------------------- | ------------------------------------------------------------------- |
| `npm run dev`                     | Vite dev server with hot reload on port 5173                        |
| `npm run build`                   | Type-check, then build to `dist/`                                   |
| `npm run preview`                 | Serve the production build on port 4173                             |
| `npm run typecheck`               | `tsc --noEmit`                                                      |
| `npm run lint`                    | ESLint over the repository                                          |
| `npm run format` / `format:check` | Prettier write / verify                                             |
| `npm test`                        | Vitest unit tests (`tests/unit`)                                    |
| `npm run test:e2e`                | Playwright browser tests (`tests/e2e`) against the production build |

Playwright needs its browsers once: `npx playwright install`.

Useful variations:

```bash
npx playwright test --project=chromium        # one browser
npx playwright test blocks                    # one spec file
npx playwright test --project=chromium performance   # resource measurements → test-results/performance.json
```

The browser tests run against the production build served by `vite preview` on port 4173. Playwright starts it (building first) if nothing is listening there; if a preview server is already running it is reused, so rebuild after changing game code.

## Toolchain notes

- TypeScript is pinned to 6.0.x because `typescript-eslint` 8 does not yet accept TypeScript 7.
- Imports use the `@/` alias for `src/`.
- Workers are ES modules, created with `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`.
- Rapier is intentionally not a dependency: player physics is a custom voxel AABB resolver (see ARCHITECTURE.md).

## Git workflow

- `main` always holds completed features.
- One branch per feature (`feature/<name>`), branched from an up-to-date `main`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
- Feature branches are merged into `main` with `--no-ff`. No force-pushing.
- `node_modules`, `dist`, test output and environment files are ignored.

## Debugging aids

- **F3** shows frame time, position, chunk counts, draw calls, triangles and GPU resource counts.
- In development builds, or on any build opened with `?e2e` in the URL, `window.__visionmine` exposes a small inspection API (`player()`, `getBlock()`, `target()`, `look()`, `teleport()`, `inventory()`, `stats()`, `save()`, `setTime()`, `setWeather()`, `virtualLock()`); see `src/game/debugHook.ts`. Browser tests use it to assert on world state.

## Adding things

- **An action** — add an entry to `ACTION_SPECS` in `src/core/input/actions.ts` (label, category, default codes that no other action uses) and react to it with `input.isActionDown(id)` or the `action` event. It appears in Settings → Controls automatically and is rebindable.
- **A block** — add an id and definition in `src/world/blocks/blocks.ts`, tiles in `tiles.ts`, and a painter per tile in `src/rendering/textures/TileAtlas.ts`. Placeable blocks appear in the creative palette automatically, with an icon drawn from the block's shape. For a block that is not a full cube, give it a `shape`; a new shape needs its boxes in `src/world/blocks/shapes.ts` and, if its state should depend on how it is placed, a case in `placementMeta` (`src/gameplay/interaction/placement.ts`). Set `light` for a block that glows.
- **A generator feature** — raise `GENERATOR_VERSION` in `src/world/generation/config.ts` and guard the new code in `TerrainGenerator` with `this.version >= N`, so existing worlds are not altered.
- **A terrain preset** — add an entry to `TERRAIN_PRESETS` in `src/world/generation/config.ts`; the Create World screen lists it automatically.
- **A setting** — add the field, default and sanitiser in `src/state/settingsStore.ts`, a control in `src/ui/menus/SettingsScreen.ts`, and subscribe where it takes effect.
- **A different mesher** — implement `ChunkMesher` (`src/world/meshing/types.ts`) and pass it to `ChunkMeshScheduler` in `WorldSession`.

## Code conventions

- `world/` must stay free of Three.js and DOM imports.
- Anything that allocates GPU resources must expose `dispose()`.
- Avoid allocations inside per-frame code paths; reuse vectors and typed arrays.
- UI updates are driven by store subscriptions with selectors, not by the render loop.
- Data read from storage is untrusted: validate it before use.

## Testing

Feature phases ran static checks only (`npm run typecheck`, `npm run lint`). Unit tests, browser tests and gameplay QA were written and executed in the final validation phase.

### What is covered

- **Unit tests** (`tests/unit`, Vitest, Node) — coordinates, terrain determinism and chunk borders, world edits and dirty propagation, face meshing, collision, raycasting, block interaction, player movement, explosions, inventory, settings, persistence (in-memory and IndexedDB through `fake-indexeddb`, including corrupt data) and chunk streaming.
- **Browser tests** (`tests/e2e`, Playwright, production build) — drive the real UI with clicks and keys and assert on world state through `window.__visionmine`:

| Spec                     | Covers                                                                                                                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flow.spec.ts`           | Boot to menu, rendered backdrop, create world → loading → playing, seed determinism, cancelling the form, no console errors                                                                                                                   |
| `movement.spec.ts`       | Walking and stopping, jumping, gravity, flight, wall collision, mouse look                                                                                                                                                                    |
| `blocks.spec.ts`         | Break, place, every hotbar block, placement refused inside the player, pick block, TNT, survival consumption and timed mining                                                                                                                 |
| `inventory.spec.ts`      | Number keys and wheel, opening and closing, creative palette, moving, swapping and splitting stacks, backpack expansion, survival view                                                                                                        |
| `pause-settings.spec.ts` | Pause freezes simulation and clock, resume, Save Now, mode switch, Save & Quit and Continue, settings applied and persisted, defaults, F3                                                                                                     |
| `persistence.spec.ts`    | Edits, player, view, flight and inventory restored after reload; save on leaving; survival state; Reset World; New Terrain; a version-1 save still loads                                                                                      |
| `controls.spec.ts`       | Default key list, rebinding takes effect in play and survives reload, swapping on conflict, mouse ↔ key exchange, cancel, remove, reserved keys, reset                                                                                        |
| `abilities.spec.ts`      | Sneaking on a ledge, double jump, dash, flying speed, auto-jump switched on in Settings, none of the creative abilities in survival                                                                                                           |
| `builder.spec.ts`        | Selecting a region; fill, replace, clear, copy, rotate, paste; undo and redo by menu and by key; quick swap; hide interface; screenshot download; none of it in survival                                                                      |
| `new-blocks.spec.ts`     | Slabs (both halves, walking onto one), stairs facing, doors (two blocks, open/close, passable, removed whole, undo), ladder placement and climbing, torchlight measured on screen, support rule, palette, plants only in new-generator worlds |
| `simulation.spec.ts`     | Sand falling from mid-air and when undermined; water spreading to level 7 and no further, draining when plugged, and surviving a reload                                                                                                       |
| `worlds.spec.ts`         | Empty list, ordering, play, rename (and cancel), delete with confirmation, damaged save listed and deletable                                                                                                                                  |
| `performance.spec.ts`    | Chunk, geometry and texture counts while travelling 576 blocks, on returning, and after leaving and re-entering the world (Chromium only)                                                                                                     |

Tests use real pointer lock where the browser grants it to automation (Chromium, Firefox) and the debug hook's `virtualLock()` otherwise (WebKit).

### Results (2026-11-20, macOS, Apple M4)

| Check                                   | Result                                                     |
| --------------------------------------- | ---------------------------------------------------------- |
| `npm run typecheck`, `npm run lint`     | clean                                                      |
| `npm run format:check`                  | clean                                                      |
| `npm test`                              | 107 / 107 passed                                           |
| `npm run build`                         | succeeds — 655 kB JS (173 kB gzip), 14 kB CSS, 8 kB worker |
| Playwright, Chromium 1255 (SwiftShader) | 41 / 41 passed                                             |
| Playwright, Firefox 1572                | 40 / 40 passed, 1 skipped (performance spec)               |
| Playwright, WebKit 2388                 | 39 / 39 passed, 2 skipped (performance spec, mouse look)   |

The WebKit mouse-look test is skipped because Playwright's WebKit does not grant pointer lock; the same code path passes in Chromium and Firefox.

### Defects found by browser testing and fixed

- **One simulated frame ran after pausing.** The fixed-step simulation runs before the per-frame update that applied the paused flag, so a falling player moved a little further after Escape. The pause state is now applied before each simulation step (`Game.syncFrozen`).
- **View could jerk when the mouse was captured.** Firefox reports a stale movement delta on the first mouse event after pointer lock is granted. `InputManager` now discards the first movement sample after each capture.
- **Quick key taps could be missed** (found in Phase 15). Presses were only polled once per simulation step, so a key pressed and released between two steps did nothing. `InputManager` now queues presses until the simulation consumes them.
- **A mouse press on the game view could be lost** (found in Phase 16, about 1 in 25 first clicks on WebKit). WebKit sometimes reports the page root, not the canvas, as the target of a press on the game view, and the game listened on the canvas only. Mouse input is now accepted on the canvas or on the bare page behind the interface.

Everything else — the chunk shader, atlas orientation, face winding, sky, shadows, water, weather, worker generation, pointer lock flow, UI screens and IndexedDB saves — worked on first contact with a browser. The first browser-test run also had failures that were wrong expectations in the tests themselves; those were corrected in the tests.

### Performance and memory

Frame rate on the real GPU (headless Chromium with ANGLE/Metal on an Apple M4, 1920 × 1080, automatically selected High preset: render distance 8, 2048 px shadow map):

| Situation                            | Average | 99th percentile frame | Draw calls | Triangles |
| ------------------------------------ | ------- | --------------------- | ---------- | --------- |
| Standing, 225 chunks meshed          | 60 fps  | 16.8 ms               | 255        | 219 k     |
| Sprint-flying while chunks stream in | 60 fps  | 16.8 ms               | 253        | 168 k     |
| Settled after the flight, 304 meshed | 60 fps  | 16.8 ms               | 174        | 107 k     |

60 fps is the display refresh cap, so these show headroom rather than a maximum. Loading a new world to the first playable frame took about 1.5 s. Under SwiftShader (software rendering, as used by the Chromium test project) the game runs at 11–15 fps at 1280 × 720; that figure says nothing about real hardware and is why the tests poll for outcomes instead of assuming timings.

Resource counts from `performance.spec.ts` (render distance 3, identical in three consecutive runs):

| Point                     | Chunks loaded | Chunks meshed | Faces  | GPU geometries | Textures |
| ------------------------- | ------------- | ------------- | ------ | -------------- | -------- |
| Spawn                     | 81            | 37            | 25,270 | 22             | 1        |
| Travelled 96 … 576 blocks | 99            | 57            | ~23 k  | 25–34          | 1        |
| Back at spawn             | 81            | 37            | 25,270 | 21             | 1        |
| Left and re-entered world | 81            | 37            | 25,270 | 21             | 1        |

Counts plateau while travelling and return exactly to the starting footprint, so chunk unloading and `WorldSession.dispose()` release what they allocate. The JS heap moved between 13 and 38 MB across the run with no upward trend after garbage collection.

### After Phase 17 (block shapes, light and plants)

Re-measured on 2026-11-21 with the same real-GPU set-up as above (Apple M4, High preset, 1920 × 1080). Plants add about 7% more faces to the same view, and block light adds one value per face and a flood fill only around chunks that hold a torch.

| Situation                            | Average | 99th percentile frame | Draw calls | Triangles | Faces (Phase 13 → now) |
| ------------------------------------ | ------- | --------------------- | ---------- | --------- | ---------------------- |
| Standing, 225 chunks meshed          | 60 fps  | 16.8 ms               | 255        | 234 k     | 131,045 → 139,789      |
| Sprint-flying while chunks stream in | 60 fps  | 16.8 ms               | 254        | 177 k     | 156,093 → 166,629      |
| Settled after the flight, 304 meshed | 60 fps  | 16.8 ms               | 174        | 109 k     | 131,884 → 141,016      |

Still at the display's refresh cap in all three. `performance.spec.ts` continues to pass with the same chunk window and the same return to the starting footprint.

### Known limitations

- Chunks stay loaded and meshed until they are `renderDistance + 4` chunks away (hysteresis against thrashing), so more chunks are meshed after travelling than at spawn — 57 instead of 37 at render distance 3. They are still frustum-culled. Lowering the render distance therefore frees memory only for chunks beyond the new distance + 4.
- The "queued" figure in the F3 overlay counts every loaded chunk that has no mesh, including the outer ring that is loaded only to give its neighbours correct borders. It does not fall to zero when streaming is finished.
- When frames take longer than about 83 ms the simulation runs slower than real time (at most five 1/60 s steps per frame) instead of trying to catch up.
- Shaped blocks get a flat shade instead of per-corner ambient occlusion, and their side textures are cropped from the tile's lower-left corner rather than re-centred.
- A slab cannot be combined with a second slab into a full block, stairs have no upside-down form, and glass panes do not join their neighbours automatically; a pane runs along one axis chosen when it is placed.
- Torches stand on the floor only. Light is per face with no smoothing, and it does not light the player model, particles or weather.
- An open door that swings into the space the player occupies is not blocked from doing so.
- Sand falls a block at a time with no falling animation, and a block that lands on the player does not push them out of the way.
- Water has no infinite-source rule (two sources do not create a third), does not push the player, and the step between two water levels shows as a small ledge.
- Simulation only starts from a change: sand generated over a cave stays up until something next to it changes, and a stream cut off by leaving the area resumes only when disturbed.
- Firefox and WebKit were tested through Playwright's builds on macOS only. Safari, mobile browsers and touch input were not tested; the game requires a keyboard and mouse.
