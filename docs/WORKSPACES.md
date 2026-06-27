# Workspace Adapters

Package Workbench works across the JS/TS monorepo ecosystem — and on plain
single-package repos — through a small set of **workspace adapters**. Detection is
purely declarative (lock files, config files, the `workspaces` field, the
`packageManager` field), so it is fast, offline, install-free, and **never crashes
on a malformed workspace file**.

```
$ package-workbench detect .

Detected:  Turborepo + pnpm · pnpm · task pipeline, workspace package list, package manager
Primary:   turbo  (95% confidence)
Package manager: pnpm

Adapters:
  ✓ turbo  95%  turbo.json (3 task(s): build, test, lint)
  ✓ pnpm   95%  found pnpm-workspace.yaml; found pnpm-lock.yaml; packageManager: pnpm@9.1.0

Capabilities:
  • task-pipeline     turbo
  • package-list      pnpm
  • package-manager   pnpm

Notes:
  ! No project-graph source (e.g. Nx) — the dependency graph is inferred from source imports.
```

## The adapter contract

```ts
interface WorkspaceAdapter {
  // exported from core as `WorkspaceFlavorAdapter`
  id: AdapterId;
  title: string;
  precedence: number; // higher wins as the "primary"
  capabilities: WorkspaceCapability[];
  detect(cwd): Promise<WorkspaceDetectionResult>;
  explainDetection(result): string;
  scan(cwd): Promise<WorkspaceScanResult>;
}
```

| Type                       | Purpose                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `WorkspaceDetectionResult` | `{ adapter, detected, confidence, evidence[], capabilities[], packageManager? }`                  |
| `WorkspaceScanResult`      | `{ workspace, packages[] }` — the common model the engine consumes                                |
| `WorkspaceCapability`      | `package-list` · `project-graph` · `task-pipeline` · `package-manager` · `dependency-constraints` |
| `WorkspaceStack`           | the resolved stack: primary + all detected + combined capabilities + notes                        |

Every adapter's `scan()` delegates to the hardened `scanWorkspace`, so package
discovery has a **single source of truth** that already tolerates malformed
packages (a bad `package.json` becomes a per-package warning, never a crash).

## Adapters

| Adapter            | Detects                                                           | Provides                                                           |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| **nx**             | `nx.json`, `nx` dependency                                        | project graph, task pipeline, dependency constraints, package list |
| **turbo**          | `turbo.json` (`tasks`/`pipeline`), `turbo` dependency             | task pipeline                                                      |
| **pnpm**           | `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `packageManager: pnpm@…` | package list, package manager                                      |
| **yarn**           | `yarn.lock`, `workspaces`, `packageManager: yarn@…`               | package list, package manager                                      |
| **bun**            | `bun.lockb`, `bun.lock`, `workspaces`, `packageManager: bun@…`    | package list, package manager                                      |
| **npm**            | `package-lock.json`, `workspaces`, `packageManager: npm@…`        | package list, package manager                                      |
| **single-package** | a root `package.json` with no workspace config                    | package list (one package)                                         |

Lockfiles recognised: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`,
`bun.lockb`, `bun.lock`. The `workspaces` field is read as both an array and the
`{ packages: [...] }` object form.

## Precedence & combination

Repos routinely match several adapters (pnpm + Nx, pnpm + Turborepo). The registry
sorts detected adapters by **precedence** to pick a primary, then **combines** their
capabilities — each capability is attributed to the adapter(s) that provide it.

```
nx (90) > turbo (80) > pnpm (70) > yarn (60) > bun (55) > npm (50) > single-package (10)
```

- **pnpm + Nx** → primary **nx**. Nx provides the project graph; pnpm provides the
  workspace package list. Both show in the stack.
- **pnpm + Turborepo** → primary **turbo**. Turbo owns the task pipeline; pnpm owns
  the package list.
- **single package + a lockfile** → primary **single-package** (it's the only thing
  that lists "packages"), with the lockfile's package manager still reported. The
  registry sets `isSinglePackage` only when no _workspace_ package-lister matched.

`detectWorkspaceStack()` returns the full picture; `scanWithAdapters()` scans using
the resolved primary.

## Single-package mode

When there's a root `package.json` and **no** workspace config (`workspaces`,
`pnpm-workspace.yaml`, `nx.json`, `turbo.json`), the repo is analyzed as one
package. The stack reports `isSinglePackage: true` and a clear note; all generic
health checks still run.

## CLI

```bash
package-workbench detect .            # human-readable adapter stack
package-workbench detect . --format json   # machine-readable WorkspaceStack
```

## Desktop

The toolbar banner shows the detected stack as chips ("Detected: Turborepo · pnpm")
with the primary highlighted and a confidence percentage. Expanding it reveals the
capability map and advisory notes (unsupported features + suggested fixes).

## Robustness guarantees

- **Cross-platform:** paths are normalised; tests run against temp-dir fixtures.
- **Deterministic:** detection reads files only — same repo, same result.
- **No network, no install:** never executes a package manager.
- **Never crashes:** every file read is failure-tolerant; malformed `turbo.json` /
  `package.json` / `pnpm-workspace.yaml` degrade to lower-confidence signals.

## Remaining adapter gaps

- **Rush / Lerna / Lage** are not yet recognised as distinct adapters (a Rush repo
  is detected via its underlying package manager).
- **Nx project graph** is detected as a capability but the engine still infers the
  dependency graph from source imports rather than consuming Nx's own graph; wiring
  the native graph is future work.
- **Turborepo task pipeline** is parsed (task names, `globalDependencies`) but not
  yet used to model build ordering in checks.
- **pnpm catalogs** and **Yarn PnP** resolution modes are not specially handled.
- Glob expansion supports the common `dir/*` form; deep globs (`packages/**`) fall
  back to the conventional `apps|packages|libs/*` layout.
