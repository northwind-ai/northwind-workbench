# Historical runs, reports & CI

> Is the repo healthier than last week? What regressed? Can CI fail on regressions?

Workbench persists a compact snapshot of every run, diffs runs deterministically, and
gates CI on regressions — all local, no cloud backend.

## Run persistence

Each run is distilled into a small `HistoricalRun` snapshot (scores, statuses,
failed-check ids, graph + scenario summaries, git branch/commit) and stored as one JSON
file per run under `<workspace>/.package-workbench/history/`. The `RunStore` interface is
storage-agnostic, so JSON can be swapped for SQLite later without touching callers.

```ts
import {
  createJsonRunStore,
  defaultHistoryDir,
  snapshotRun,
} from "@package-workbench/core";

const store = createJsonRunStore(defaultHistoryDir(cwd));
await store.save(
  await snapshotRun(run, { workspacePath: cwd, runId, timestamp }),
);
const baseline = await store.latest("main"); // newest run on a branch
```

Git provenance is read directly from `.git` (no child process) so it works in restricted
CI.

## Delta engine

`compareRuns(previous, current)` is deterministic — same inputs, same output. It detects:

- score moves (overall + per package),
- new / resolved check failures,
- new cycles and boundary violations (from the graph snapshot),
- scenario regressions.

```
Score 89 → 72 (-17) · 1 critical, 2 major regression(s)
  ✗ [critical] @x/cli: runtime import now fails
  ✗ [major] 1 new circular dependency(ies)
  ✗ [major] 2 new scenario failure(s)
```

### Regression classification

| Severity     | Triggers                                                                    |
| ------------ | --------------------------------------------------------------------------- |
| **critical** | unusable package — import / build / resolution / valid-manifest failure     |
| **major**    | scenario failures, new cycles, new boundary violations, exports/peer breaks |
| **minor**    | warnings, small score drops                                                 |

## Report export

`renderReport({ run, delta }, format)` produces **JSON**, **Markdown**, or **HTML**
(self-contained — good for CI artifacts) with sections: Executive Summary, Package Health,
Failures, Dependency Graph Summary, Scenario Results, and a Regression Summary when a
baseline exists.

```bash
package-workbench report <path> --format md   --out report.md
package-workbench report <path> --format html --out report.html
package-workbench report <path> --format json
```

## CI mode

```bash
package-workbench ci <path> [--scenarios] [--no-save] [--format json]
```

`ci` scans, builds the graph, snapshots the run, compares against the stored baseline for
the current branch, evaluates a policy, prints a concise summary, **exits non-zero on a
violation**, and (unless `--no-save`) records the run as the next baseline.

Policy (defaults shown) — configure via `ci` in `workbench.config.*` or
`packageWorkbench.ci` in package.json:

```ts
export default {
  ci: {
    maxScoreDrop: 5, // fail if health drops > 5 points
    minScore: undefined, // fail if absolute score below this
    failOnCritical: true, // fail if any package is unusable
    failOnNewCycle: true, // fail on a newly-introduced cycle
    failOnNewViolation: true, // fail on a new boundary violation
    failOnScenarioRegression: true,
  },
};
```

Example output:

```
Package Workbench CI · /repo (main@1a2b3c4)
Health 84/100  (Δ -6 vs baseline)
Graph 73/100 (C) · 1 cycle(s) · 1 violation(s)
Regressions: 1 critical, 1 major, 0 minor
  ✗ [critical] @x/cli: runtime import now fails
  ✗ [major] 1 new circular dependency(ies)
Policy: FAIL
  ✗ maxScoreDrop: Health score dropped 6 (limit 5)
```

## GitHub Actions

A ready-to-copy workflow lives at [`docs/github-actions-example.yml`](./github-actions-example.yml):
checkout → install → `ci` gate → upload HTML report → comment the Markdown summary on the
PR, with per-branch history cached so each run compares against the last.

## Notifications

`buildNotifications(run, delta)` raises `info` / `warning` / `critical` notifications for
critical failures, severe regressions, and score collapse (≥15 points). The desktop app
surfaces non-info ones as OS notifications after each scan.

## Desktop

The **History** mode (toolbar toggle) shows the run list (with per-run score deltas), a
score **trend** sparkline, a **branch filter**, and a two-run **compare** panel listing
regressions + improvements. First launch shows demo history until you open a workspace.

## Determinism

Snapshots store only stable, comparable facts (no timestamps inside the diff inputs), and
`compareRuns` / `evaluateCiPolicy` are pure — so the same two runs always produce the same
delta and the same CI verdict.
