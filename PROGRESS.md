# VISIONMINE — progress snapshot

Paused on 2026-11-20, part-way through Phase 13 (final testing). This file records what is done, what has actually been verified, and what is still open.

## Where things are

- Project: `/Users/devang/VISIONMAX/visionmine`
- Current branch: `test/final-validation` (branched from `main` after Phase 12)
- `main` contains Phases 1–12, each merged from its own feature branch with `--no-ff`
- **Nothing is on GitHub yet.** `gh` was installed (`brew install gh`, v2.103.3) but is not logged in, so the repository has not been created and every commit and branch is local only.

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

What was built, in short: Vite + TypeScript + Three.js project; chunked voxel world (16×128×16) rendered as instanced faces; seeded simplex-noise terrain with four presets, biomes, water and trees; worker-pool chunk generation with streaming and unloading; first-person controller with custom AABB collision, sprint, swim and flight; DDA raycast block breaking/placing/picking; hotbar and expandable inventory with creative and survival rules; day/night sky, sun/moon light, shadows, fog, rain/snow, debris particles, synthesised sounds; IndexedDB saves (edits, player, inventory, seed, mode, time) with create/rename/delete/reset/regenerate and corrupt-save handling; main menu, create-world, world list, loading, pause, settings and HUD; third-person camera; TNT with chain reactions. README, ARCHITECTURE and DEVELOPMENT are written.

Deviations from the brief, already agreed in the plan: no Rapier (custom voxel collision), no React, TypeScript pinned to 6.0.x (typescript-eslint does not accept 7 yet), `tsc` and ESLint were run during feature phases while all tests were deferred to Phase 13.

## Verified so far (Phase 13)

- `npm run typecheck` and `npm run lint`: clean at every phase commit.
- `npm run build`: succeeds. Output: 654.65 kB JS (173.31 kB gzip), 14.03 kB CSS, 8.24 kB worker.
- `npm test` (Vitest): **107 of 107 tests pass** across 8 files — coordinates, terrain determinism and chunk borders, world edits and dirty propagation, face meshing, collision, raycasting, block interaction, player movement, explosions, inventory, settings, persistence (memory and IndexedDB via fake-indexeddb, including corrupt data) and chunk streaming.
  - The first run had 3 failures. All three were wrong expectations in the tests, not game defects; the tests were corrected.
- Playwright's Chromium is installed.

## Not verified yet

**The game has never been opened in a browser.** Everything visual and interactive is so far only type-checked and unit-tested at the logic level. Specifically untested:

- Whether the scene renders at all: the custom chunk shader patch, texture atlas orientation, face winding, sky dome, shadows, water transparency, weather
- Pointer lock, mouse look and the menu → loading → playing → paused flow
- Web Worker terrain generation in a real browser (unit tests use the main-thread fallback)
- The UI screens: layout, clicks, forms, inventory drag behaviour
- Save, reload and restore through real IndexedDB
- Frame rate, draw calls and memory behaviour while travelling
- Firefox and WebKit

Expect real bugs to surface here.

## Pending, in order

1. Open the production build in Chromium via Playwright, take screenshots, and fix whatever is broken in rendering and flow.
2. Write Playwright tests in `tests/e2e/` (menu → create world → play; move and jump; break and place; hotbar and inventory; pause and settings; save → reload → restored; rename and delete world) using the `window.__visionmine` hook (`?e2e` URL flag).
3. Measure performance and memory: FPS, draw calls, triangles, and GPU geometry/texture counts before and after chunk unloads and after leaving a world.
4. Run the e2e suite on Firefox and WebKit (`npx playwright install firefox webkit` needed first).
5. Fix defects found, on `fix/*` branches or this branch, then re-run unit tests, e2e tests and the production build.
6. Record the actual results in `DEVELOPMENT.md`.
7. Merge `test/final-validation` into `main`.
8. GitHub: after `gh auth login` is done by you, run `gh repo create visionmine --private --source=. --remote=origin --push`, then push all feature branches (`git push origin --all`). No force-pushing.

## Needed from you

- Run `gh auth login` in a terminal (GitHub.com → HTTPS → browser login). Until then nothing can be pushed.

## Useful commands

```bash
cd /Users/devang/VISIONMAX/visionmine
npm run dev          # play it at http://localhost:5173
npm test             # unit tests
npm run build && npm run preview   # production build at http://localhost:4173
git log --oneline --graph --all    # full local history
```
