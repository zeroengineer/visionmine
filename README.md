# VISIONMINE

A voxel sandbox game that runs entirely in the browser. Create a procedurally generated world, explore it, break and place blocks, build structures and save your worlds locally.

Built with TypeScript, Vite and Three.js. No backend, no account, no downloads.

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

| Action                   | Input                         |
| ------------------------ | ----------------------------- |
| Move                     | `W` `A` `S` `D`               |
| Look                     | Mouse                         |
| Jump / swim up / fly up  | `Space`                       |
| Sprint                   | `Shift`                       |
| Fly down                 | `C` or `Ctrl`                 |
| Toggle flying (creative) | `F`                           |
| Break block              | Left click (hold in survival) |
| Place block / ignite TNT | Right click                   |
| Pick targeted block      | Middle click                  |
| Select hotbar slot       | `1`–`9` or mouse wheel        |
| Inventory                | `E`                           |
| Third-person camera      | `V`                           |
| Debug overlay            | `F3`                          |
| Pause / release mouse    | `Esc`                         |

## Features

The feature list is updated as each development phase lands.

- Project scaffold, tooling and documentation (Phase 1)

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — module map, data flow and performance decisions
- [DEVELOPMENT.md](DEVELOPMENT.md) — setup, scripts, workflow and testing

## Tech stack

TypeScript · Vite · Three.js · Zustand · simplex-noise · IndexedDB · Vitest · Playwright · ESLint · Prettier
