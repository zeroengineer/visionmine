# VISIONMINE — progress snapshot

Phases 1–13 (the original build and its validation) were completed on 2026-11-20. Phases 14–20, completed on 2026-11-21, added rebindable controls, movement abilities, builder tools, shaped blocks with light, world simulation and survival systems. This file records what was built, what was verified and what is still open.

## Where things are

- Project: `/Users/devang/visionmine`
- Repository: https://github.com/zeroengineer/visionmine
- `main` contains every phase listed under Done, each merged from its own branch with `--no-ff`
- `main` is pushed to GitHub after every merge; a feature branch is deleted once it is merged

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
| 14    | `feature/controls`           | `feat(controls): add action map and rebindable controls`                        |
| 15    | `feature/movement-abilities` | `feat(movement): add sneak, step-up, double jump, dash and fly speed`           |
| 16    | `feature/builder-tools`      | `feat(building): add selection tools, copy/paste, undo/redo and screenshots`    |
| 17a   | `feature/block-state`        | `feat(world): add per-block state and save format 2`                            |
| 17b   | `feature/new-blocks`         | `feat(blocks): shapes, slabs, stairs, doors, ladders, panes, torches, plants`   |
| 18    | `feature/world-simulation`   | `feat(simulation): add falling sand and gravel and flowing water`               |
| 19    | `feature/survival`           | `feat(survival): items, tools, ores, vitals, crafting`                          |
| 20    | `test/phase-20-validation`   | final results and measurements recorded                                         |

What was built, in short: Vite + TypeScript + Three.js project; chunked voxel world (16×128×16) rendered as instanced faces; seeded simplex-noise terrain with four presets, biomes, water and trees; worker-pool chunk generation with streaming and unloading; first-person controller with custom AABB collision, sprint, swim and flight; DDA raycast block breaking/placing/picking; hotbar and expandable inventory with creative and survival rules; day/night sky, sun/moon light, shadows, fog, rain/snow, debris particles, synthesised sounds; IndexedDB saves (edits, player, inventory, seed, mode, time) with create/rename/delete/reset/regenerate and corrupt-save handling; main menu, create-world, world list, loading, pause, settings and HUD; third-person camera; TNT with chain reactions. README, ARCHITECTURE and DEVELOPMENT are written.

Deviations from the brief, already agreed in the plan: no Rapier (custom voxel collision), no React, TypeScript pinned to 6.0.x (typescript-eslint does not accept 7 yet), `tsc` and ESLint were run during feature phases while all tests were deferred to Phase 13.

## Verified (2026-11-21, after Phase 19)

Full details, tables and measurements are in `DEVELOPMENT.md` under "Testing".

- `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- `npm run build`: succeeds.
- `npm test` (Vitest): 292 of 292 pass.
- `npx playwright test`: 252 pass, 3 skipped, 0 fail — Chromium 85/85, Firefox 84/84 (performance spec skipped), WebKit 83/83 (performance spec and mouse look skipped; Playwright's WebKit does not grant pointer lock).
- Screenshots of each new feature were reviewed by eye as it was built: the Controls tab, build menu and selection box, slabs, stairs, doors, ladders, panes, torches by day and night, meadows, flowing water and fallen sand, the survival HUD and the crafting table.
- Real GPU (Apple M4, High preset, 1920 × 1080): 60 fps with a 16.8 ms 99th-percentile frame, including while chunks stream in — the same as the Phase 13 baseline, with about 7% more faces from plants.
- Chunk, geometry and texture counts plateau while travelling and return to the starting footprint after leaving and re-entering a world.

## Defects found and fixed by testing

- One simulated frame ran after pausing (Phase 13).
- The view could jerk on the first mouse movement after capture in Firefox (Phase 13).
- A key tapped between two simulation steps was missed (Phase 15).
- A mouse press on the game view could be lost when WebKit reported the page root as its target (Phase 16).
- Undo steps merged when two edits fell in one slow frame (Phase 16).
- The last step of a fall was not counted, costing one point of fall damage too few (Phase 19).

## Roadmap (Phases 14–20)

| Phase | Scope                                                                                         | Status |
| ----- | --------------------------------------------------------------------------------------------- | ------ |
| 14    | Action map; rebindable controls in Settings → Controls                                        | done   |
| 15    | Movement abilities: sneak, step-up, double jump, air dash, fly speed, sprint toggle           | done   |
| 16    | Builder tools: undo/redo, selection fill/replace/copy/paste, quick swap, screenshot, hide HUD | done   |
| 17a   | Per-block state byte; save format 2 with migration of version-1 saves                         | done   |
| 17b   | Block shapes; slabs, stairs, doors, ladders, panes, plants, torches and block light           | done   |
| 18    | World simulation: falling sand and gravel, flowing water                                      | done   |
| 19    | Survival: items, health, hunger, tools, ores, crafting                                        | done   |
| 20    | Full cross-browser validation and performance comparison                                      | done   |

From Phase 14 on, unit and browser tests are written in the same phase as the feature.

## Still open

- Not tested: Safari itself, Windows and Linux browsers, mobile and touch input.
- Not judged by a person: how the new movement, tools and survival balance feel in play. Everything was verified by tests and screenshots, not by someone at the keyboard.
- Known limitations are listed in `DEVELOPMENT.md`. The larger ones: no hostile creatures, no furnace, slabs do not combine, panes do not join their neighbours, torches stand on floors only, and water has no infinite-source rule.
- Greedy meshing is designed for (see `ARCHITECTURE.md`) but not implemented.

## Useful commands

```bash
npm run dev          # play it at http://localhost:5173
npm test             # unit tests
npx playwright test  # browser tests (needs `npx playwright install` once)
npm run build && npm run preview   # production build at http://localhost:4173
git log --oneline --graph --all    # full history
```
