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

## Toolchain notes

- TypeScript is pinned to 6.0.x because `typescript-eslint` 8 does not yet accept TypeScript 7.
- Imports use the `@/` alias for `src/`.
- Workers are ES modules, created with `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`.

## Git workflow

- `main` always holds completed features.
- One branch per feature (`feature/<name>`), branched from an up-to-date `main`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
- Feature branches are merged into `main` with `--no-ff`. No force-pushing.
- `node_modules`, `dist`, test output and environment files are ignored.

## Testing policy

Feature phases run static checks only (`npm run typecheck`, `npm run lint`). Unit tests, browser tests and gameplay QA are written and executed in the final validation phase, and results are recorded in this file.

## Code conventions

- `world/` must stay free of Three.js and DOM imports.
- Anything that allocates GPU resources must expose `dispose()`.
- Avoid allocations inside per-frame code paths; reuse vectors and typed arrays.
- UI updates are driven by store subscriptions with selectors, not by the render loop.
