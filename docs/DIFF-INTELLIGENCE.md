# Git Diff Intelligence

Analyzing a whole monorepo on every change is expensive. Diff Intelligence analyzes
**only what changed** and computes its dependency blast radius — answering "what
changed, which packages are impacted, how risky is it, and what needs rescanning?"

```
Changed files:
  M packages/core/src/index.ts
  M packages/auth/session.ts

Impacted packages: core, auth, ui, api, chart

Risk: 🟠 High (50/100)
Reason: @repo/core has 31 dependents
```

## Architecture

```
 git diff ──▶ changed files ──▶ map to packages ──▶ blast radius (graph)
                                       │                    │
                                       ▼                    ▼
                              risk scoring  ◀───────  predicted regressions
                                       │
                                       ▼
                               targeted scan plan
```

It **reuses** the dependency-graph engine and the PR blast-radius engine
(`analyzeImpact`) — no new graph logic. The new parts are the git layer, risk
scoring, regression prediction, and the scan planner. Lives in
`packages/git-intelligence`.

## Git integration

Discovers changed files for three comparison modes:

| Mode                                 | git                                                           |
| ------------------------------------ | ------------------------------------------------------------- |
| working tree vs HEAD                 | `git diff --name-status HEAD` (+ untracked from `git status`) |
| staged                               | `git diff --name-status --cached`                             |
| range (branch↔branch, commit↔commit) | `git diff --name-status base...head`                          |

The **parser** (`parseNameStatus`) is pure and tested for add / modify / delete /
**rename** (old→new paths) / copy, and normalizes paths cross-platform. The runner
degrades gracefully outside a git repo (returns empty, never throws).

## Changed-package detection + blast radius

Changed files are attributed to packages (longest-root-prefix wins), then the
dependency graph is walked **backwards** to find every transitively-impacted
package:

```
core changed → auth depends on core → api depends on auth
Blast radius: core → auth → api  (edited: 1, impacted: N, coverage: X%)
```

Deleted package.json files are reported as deleted packages.

## Risk scoring

A 0–100 score + level (`low`/`medium`/`high`/`critical`) from five itemised signals:

1. **File types changed** — entry/exports/manifest weigh high; tests/docs low.
2. **Centrality** of the edited packages.
3. **Transitive dependents** — "core has 31 dependents" (the usual headline reason).
4. **Blast-radius coverage** — fraction of the workspace impacted.
5. **Historical instability** — edited packages that have been failing recently.

A README change → **Low**; a high-centrality core change with many dependents →
**Critical**.

## Regression prediction

From the _kinds_ of files that changed:

| Change                    | Predicted regressions                            |
| ------------------------- | ------------------------------------------------ |
| `index.ts` / `exports.ts` | import breakage (high), stale re-export (medium) |
| `*.d.ts`                  | type breakage                                    |
| `package.json`            | dependency / peer / version issues               |
| deleted / renamed source  | import breakage (high)                           |
| runtime source            | runtime failure (low)                            |

## Smart scan planner

Instead of scanning everything, it emits a targeted plan: **edited** packages get the
full set (`package_health`, `runtime`, `scenarios`); **impacted** packages get the
lighter consumer-facing set (`package_health`, `scenarios`). `scanSavings` reports the
fraction of the workspace that can be skipped — the performance win on large monorepos.

## CLI

```bash
package-workbench diff                       # working tree vs HEAD
package-workbench diff --staged              # staged changes
package-workbench diff main...feature        # branch vs branch
package-workbench diff v1.0.0...HEAD --pretty # commit range
package-workbench diff --format json
```

`diff` exits non-zero on a **high/critical** change, so CI can gate or escalate.

### Example report

```
Changed packages (1):
  • @repo/core  (2 file(s), 31 dependents)

Impacted packages (5):
  ↳ @repo/auth ↳ @repo/ui ↳ @repo/api ↳ @repo/chart ↳ @repo/app

Risk: 🟠 High (50/100)
Reason: @repo/core has 31 dependents

Predicted regressions:
  - [high] import breakage: Entry/exports file changed — importers may break.
  - [medium] stale re-export: A barrel/exports change can leave stale re-exports.

Suggested scan: 6 package(s) — skipping 78% of the workspace.
```

## Desktop & VS Code

The engine (`analyzeDiff`) is exported from `@package-workbench/git-intelligence` and
ready to drive a **Diff Intelligence** desktop tab (changed files, blast-radius graph,
risk, predicted regressions, suggested scans, compare commits/branches/working-tree)
and diff-aware VS Code warnings ("this package changed and impacts 18 downstream
packages") — both consume the same `DiffReport`.

## Performance

- **Change-sized, not repo-sized.** Only changed files are diffed; the graph is built
  once and walked, and the scan plan skips unaffected packages (`scanSavings`).
- **No-network git plumbing** with a 32 MB buffer cap; the parser is O(files).
- **Deterministic + cross-platform** (forward-slash normalization, rename handling).

## Limitations

- Blast radius is computed from the _declared + imported_ dependency graph; dynamic
  `require`/plugin wiring not visible to the graph is not followed.
- Working-tree mode includes untracked files via `git status`; submodules are out of
  scope.
- Risk weights are heuristic and configurable in code; calibrate to your repo.

```

```
