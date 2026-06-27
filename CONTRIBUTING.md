# Contributing to Package Workbench

Thanks for your interest in contributing! This guide gets you productive quickly.

## Prerequisites

- **Node.js** ≥ 18.18
- **pnpm** 9 (`corepack enable` then `corepack prepare pnpm@9 --activate`)

## Setup

```bash
git clone https://github.com/<org>/package-workbench
cd package-workbench
pnpm install
pnpm test         # everything should pass
pnpm typecheck
```

## Project layout & boundaries

| Package | May depend on | Must NOT contain |
| --- | --- | --- |
| `plugin-sdk` | nothing | runtime deps, Node, UI |
| `core` | `plugin-sdk`, Node | UI, Electron |
| `cli` | `core` | UI, Electron |
| `ui` | `plugin-sdk` (values) + `core` (**types only**), React | Node, Electron |
| `desktop` | `core`, `ui`, Electron | validation logic |

These boundaries are load-bearing — the renderer imports only **types** from `core` so
its Node code never enters the browser bundle. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Workflow

1. Create a branch from `main`.
2. Make your change with tests (`*.test.ts` next to the code; we use Vitest).
3. Run `pnpm test`, `pnpm typecheck`, and `pnpm lint`.
4. Open a PR using the template. Keep PRs focused.

### Commit & PR conventions

- Conventional-ish commit subjects (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
- Describe the *why*, not just the *what*.
- New behaviour needs tests. Bug fixes should include a regression test.

## Adding things

- **A health check** → `packages/core/src/checks/`, register in `checks/index.ts`, add a
  stable id in `check-ids.ts`, and a test in `checks/checks.test.ts`.
- **A plugin** (validators/scenarios/adapters) → see [docs/PLUGINS.md](docs/PLUGINS.md);
  depend only on `@package-workbench/plugin-sdk`.
- **A scenario** → see [docs/SCENARIOS.md](docs/SCENARIOS.md).
- **A UI component** → keep it presentational in `packages/ui`; put pure logic in a
  testable module (e.g. `filter.ts`) and unit-test it.

## Tests

- Pure logic → fast Node tests.
- Engine features (runtime/scenarios/graph) → fixtures under `packages/core/test/fixtures`.
- Determinism matters: avoid `Date.now()`/randomness in asserted output; inject clocks.

## Releasing

Maintainers cut releases via tags; see the [Launch checklist](docs/launch-checklist.md) and
the release workflow in `.github/workflows/`.

By contributing you agree your work is licensed under Apache-2.0.
