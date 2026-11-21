# VISIONMINE

A voxel sandbox game that runs entirely in the browser. Create a procedurally generated world, explore it, break and place blocks, build structures and save your worlds locally.

Built with TypeScript, Vite and Three.js. No backend, no account, no downloads, no image or audio assets — textures and sounds are generated at runtime.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build:

```bash
npm run build
npm run preview    # http://localhost:4173
```

Requires Node.js 20.19+ (22 recommended) and a browser with WebGL 2.

## Controls

These are the defaults. Every action except looking, the hotbar digits and `Esc` can be rebound in **Settings → Controls**, with up to two keys or mouse buttons each.

| Action                   | Input                         |
| ------------------------ | ----------------------------- |
| Move                     | `W` `A` `S` `D`               |
| Look                     | Mouse                         |
| Jump / swim up / fly up  | `Space`                       |
| Sprint                   | `Shift`                       |
| Sneak / fly down         | `C` or `Ctrl`                 |
| Dash (creative)          | `R`                           |
| Double jump (creative)   | `Space` again in mid-air      |
| Flying speed             | `Shift` + mouse wheel         |
| Toggle flying (creative) | `F` or double-tap `Space`     |
| Break block              | Left click (hold in survival) |
| Place block / light TNT  | Right click                   |
| Pick targeted block      | Middle click (creative)       |
| Select hotbar slot       | `1`–`9` or mouse wheel        |
| Previous hotbar slot     | `Q`                           |
| Mark selection corner    | `X` (creative)                |
| Build tools              | `B` (creative)                |
| Undo / redo              | `Z` / `Y` (creative)          |
| Inventory                | `E`                           |
| Third-person camera      | `V`                           |
| Debug overlay            | `F3`                          |
| Hide interface           | `F1`                          |
| Screenshot               | `F2`                          |
| Pause / release mouse    | `Esc`                         |

## Features

**World**

- Infinite procedural terrain from layered simplex noise: plains, hills, mountain ridges, valleys, beaches, oceans, deserts and snowy peaks
- Four terrain presets (Standard, Highlands, Archipelago, Flatlands), adjustable vegetation (trees, flowers and grass) and text seeds — the same seed always produces the same world
- Chunked world (16 × 128 × 16) streamed around the player; terrain is generated in Web Workers
- 30 block types: terrain, wood and stone, glass, water, TNT, slabs and stairs in four materials, doors, ladders, glass panes, torches, flowers and tall grass

**Play**

- First-person controller with gravity, jumping, sprinting, swimming and voxel-accurate collision
- Sneaking that will not walk off ledges, optional auto-jump and toggle-sprint, and in Creative mode a double jump, a dash and adjustable flying speed
- Break, place and pick blocks with a highlighted target block
- Creative mode (unlimited blocks, instant breaking, flight) and Survival mode (mine to collect, timed breaking)
- Hotbar and expandable inventory with stack splitting and a creative block palette
- Creative builder tools: mark two corners to select a region, then fill, replace, clear, copy, rotate and paste it; undo and redo for every edit, including explosions
- Sand and gravel fall when nothing holds them up; water flows downhill, spreads up to seven blocks from its source and drains when the source is removed
- Slabs and stairs you walk up without jumping, doors that open with a click, ladders to climb, and torches that light the night
- TNT with fuses, chain reactions, knockback and camera shake
- Third-person camera with terrain-aware distance

**Atmosphere**

- Day/night cycle with a moving sun and moon, stars, dynamic light colour and shadows
- Distance fog matched to the sky, underwater fog and tint, animated water
- Rain and snow, debris particles, synthesised sound effects

**Saving**

- Worlds are stored in IndexedDB: block edits, player position and view, inventory, game mode, time of day, seed and settings
- Create, rename, delete, reset and regenerate worlds; autosave every 10 seconds and when the tab is hidden
- Damaged saves are listed and can be deleted instead of breaking the game; if browser storage is unavailable the game still runs and says so

**Performance**

- Chunks render as instanced faces: at most two draw calls per visible chunk, hidden faces are never sent to the GPU
- Meshing is time-budgeted per frame; distant chunks are unloaded and their GPU buffers disposed
- Automatic quality tier from the GPU, plus adaptive resolution that follows the frame rate

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — module map, data flow and performance decisions
- [DEVELOPMENT.md](DEVELOPMENT.md) — setup, scripts, workflow and testing

## Tech stack

TypeScript · Vite · Three.js · Zustand · simplex-noise · IndexedDB · Vitest · Playwright · ESLint · Prettier
