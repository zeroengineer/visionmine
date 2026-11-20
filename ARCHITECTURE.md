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
