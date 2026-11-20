# VISIONMINE — progress snapshot

All thirteen phases are complete as of 2026-11-20. This file records what was built, what was verified and what is still open.

## Where things are

- Project: `/Users/devang/visionmine`
- Repository: https://github.com/zeroengineer/visionmine
- `main` contains Phases 1–13, each merged from its own branch with `--no-ff`
- All branches are pushed to GitHub

## Done

| Phase | Branch                       | Commit subject                                                                  |
| ----- | ---------------------------- | ------------------------------------------------------------------------------- |
| 1     | `main`                       | `chore: initialize visionmine project`                                          |
| 2     | `feature/engine-foundation`  | `feat(engine): add Three.js engine and rendering foundation`                    |
| 3     | `feature/voxel-engine`       | `feat(voxel): add block registry, chunk storage and instanced face rendering`   |
| 4     | `feature/terrain-generation` | `feat(terrain): add seeded procedural terrain generation`                       |
| 5     | `feature/chunk-rendering`    | `feat(chunks): add chunk streaming with worker generation and budgeted meshing` |
| 6     | `feature/player-controller`  | `feat(player): add first-person controller with voxel collision`                |
| 7     | `feature/block-interaction`  | `feat(interaction): add block targeting, breaking and placing`                  |
| 8     | `feature/inventory`          | `feat(inventory): add hotbar, inventory screen and block quantities`            |
| 9     | `feature/environment`        | `feat(environment): add day-night cycle, sky, shadows, weather and particles`   |
| 10    | `feature/world-persistence`  | `feat(persistence): save and load worlds with IndexedDB`                        |
| 11    | `feature/gameplay-ui-polish` | `feat(ui): add menus, pause, settings and extra gameplay`                       |
| 12    | `feature/integration`        | `feat(integration): add adaptive resolution, debug hook and documentation pass` |
| 13    | `test/final-validation`      | unit suite, browser suite, two fixes and recorded results                       |

What was built, in short: Vite + TypeScript + Three.js project; chunked voxel world (16×128×16) rendered as instanced faces; seeded simplex-noise terrain with four presets, biomes, water and trees; worker-pool chunk generation with streaming and unloading; first-person controller with custom AABB collision, sprint, swim and flight; DDA raycast block breaking/placing/picking; hotbar and expandable inventory with creative and survival rules; day/night sky, sun/moon light, shadows, fog, rain/snow, debris particles, synthesised sounds; IndexedDB saves (edits, player, inventory, seed, mode, time) with create/rename/delete/reset/regenerate and corrupt-save handling; main menu, create-world, world list, loading, pause, settings and HUD; third-person camera; TNT with chain reactions. README, ARCHITECTURE and DEVELOPMENT are written.

Deviations from the brief, already agreed in the plan: no Rapier (custom voxel collision), no React, TypeScript pinned to 6.0.x (typescript-eslint does not accept 7 yet), `tsc` and ESLint were run during feature phases while all tests were deferred to Phase 13.

## Verified (Phase 13)

Full details, tables and measurements are in `DEVELOPMENT.md` under "Testing".

- `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- `npm run build`: succeeds.
- `npm test` (Vitest): 107 of 107 pass.
- `npx playwright test`: 120 pass, 3 skipped, 0 fail — Chromium 41/41, Firefox 40/40 (performance spec skipped), WebKit 39/39 (performance spec and mouse look skipped; Playwright's WebKit does not grant pointer lock).
- The game was opened in a real browser for the first time in this phase. Rendering, pointer lock, workers, UI and IndexedDB saves worked; screenshots of every screen, day and night, shadows, rain, water and third person were reviewed by eye.
- Real GPU (Apple M4, High preset, 1920 × 1080): 60 fps with a 16.8 ms 99th-percentile frame, including while chunks stream in.
- Chunk, geometry and texture counts plateau while travelling and return to the starting footprint after leaving and re-entering a world.

## Defects found and fixed in Phase 13

- One simulated frame ran after pausing (`Game.syncFrozen`).
- The view could jerk on the first mouse movement after capture in Firefox (`InputManager`).

## Still open

- Not tested: Safari itself, Windows and Linux browsers, mobile and touch input.
- Known limitations are listed in `DEVELOPMENT.md` (chunk unload hysteresis, the F3 "queued" figure, slow-motion below ~12 fps).
- Greedy meshing is designed for (see `ARCHITECTURE.md`) but not implemented.

## Useful commands

```bash
npm run dev          # play it at http://localhost:5173
npm test             # unit tests
npx playwright test  # browser tests (needs `npx playwright install` once)
npm run build && npm run preview   # production build at http://localhost:4173
git log --oneline --graph --all    # full history
```
