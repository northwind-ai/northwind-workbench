# Package Workbench for VS Code

Bring Package Workbench insights into the editor — diagnostics, package-health
hovers, safe auto-fixes, and a dependency overview — so you rarely need to switch
to the desktop app.

```
Open package.json
        ↓
⚠ Missing peer dependency: react-dom
⚠ Circular dependency involving @repo/core
```

## Features

- **Diagnostics** in the Problems panel — missing/peer dependencies, broken
  imports, boundary violations, circular dependencies, stale exports — mapped to
  `error` / `warning` / `info`.
- **Hovers** — hover an internal package import (`@repo/core`) to see its health
  score, runtime, and warnings.
- **Quick fixes** — the Auto Fix engine's safe fixes appear as code actions
  ("Apply safe fix: Add dependency to package.json"). Dangerous fixes are never
  offered for auto-apply; applied fixes are atomic and undoable.
- **Sidebar** — Overview, Failures, Dependency Graph, and Fixes views.
- **Commands** — Analyze Workspace / Analyze Current Package / Explain Failure /
  Apply Safe Fix / Open Desktop App.

## Architecture

```
 VS Code Extension (extensions/vscode)
        ↕  (in-process, type-safe)
 @package-workbench/core  ← all analysis lives here
        ↕
 Repo analysis results (health · graph · intel · fixes · refactor)
```

The extension **reuses core verbatim** — it never re-implements health, graph, or
fix logic. `src/analysis.ts` orchestrates core's existing engines and caches the
result; `src/translate.ts` is a pure, fully-unit-tested layer that maps core
results to editor descriptors; the `*.ts` providers are thin `vscode` adapters
over `translate`.

| File             | Role                                                            |
| ---------------- | --------------------------------------------------------------- |
| `analysis.ts`    | Runs + caches core analysis; debounced background refresh       |
| `translate.ts`   | **Pure** mapping (diagnostics, hovers, fixes) — the tested core |
| `diagnostics.ts` | Publishes findings to the Problems panel                        |
| `hover.ts`       | Package-health hover cards                                      |
| `codeActions.ts` | Auto-fix quick fixes                                            |
| `views.ts`       | Overview / Failures / Graph / Fixes sidebar                     |
| `commands.ts`    | Explain failure, apply fix, desktop bridge                      |
| `extension.ts`   | Activation + wiring                                             |

## Performance

- **Background analysis** — runs off activation; never blocks the editor.
- **Debounce** — saves trigger a debounced refresh (`packageWorkbench.debounceMs`,
  default 800 ms).
- **Caching** — one cached `WorkspaceAnalysis`; concurrent requests share a single
  in-flight run.
- **Lazy + cheap** — the heavy runtime-import execution is skipped in the editor
  (`PW_NO_RUNTIME`); diagnostics are read from disk only for the files that have
  findings.

## Settings

| Setting                             | Default | Description                                |
| ----------------------------------- | ------- | ------------------------------------------ |
| `packageWorkbench.autoAnalyze`      | `true`  | Re-analyze on save                         |
| `packageWorkbench.debounceMs`       | `800`   | Debounce window after edits                |
| `packageWorkbench.applyReviewFixes` | `false` | Allow applying review-required quick fixes |
| `packageWorkbench.desktopAppPath`   | `""`    | Path to the desktop executable             |

## Development

This extension lives inside the Package Workbench monorepo and depends on
`@package-workbench/core` (resolved via `tsconfig` `paths`, bundled by esbuild).

```bash
# From extensions/vscode
pnpm add -D @types/vscode @vscode/test-electron   # real VS Code types (optional)
pnpm typecheck                                    # tsc -p tsconfig.json --noEmit
pnpm build                                        # esbuild bundle → dist/extension.js
pnpm package                                      # vsce package → .vsix

# Run in the Extension Development Host
code --extensionDevelopmentPath=.
```

To make it a first-class workspace member, add `extensions/*` to the root
`pnpm-workspace.yaml` and `pnpm install`. The bundled `src/vendor/vscode.d.ts` is a
minimal offline shim of the VS Code API; installing `@types/vscode` supersedes it.

The pure `translate` layer is unit-tested with the repo's Vitest
(`src/test/translate.test.ts`); the editor providers are thin enough to validate
in the Extension Development Host.

## Limitations

- The editor skips the sandboxed runtime-import execution for speed, so
  "missing dependency" diagnostics come from static signals; run the CLI/desktop
  for the full runtime matrix.
- Quick fixes cover the Auto Fix engine's safe set (package.json + stale exports);
  structural refactors are surfaced by the desktop's Refactor Architect, never
  auto-applied.
- Source-file diagnostics are limited to the precise locations core flags
  (e.g. stale re-exports), not a full lint of every import.
