# PR Integration & Merge Policies

Catch package regressions **before merge**. Package Workbench compares a PR branch
against its base, computes a dependency-aware blast radius, scores risk, applies a
configurable merge policy, and posts an automated review comment + status check.

```
📦 Package Workbench Report

Score: 92 → 78 (-14) · Risk: 🔴 Critical (82/100) · ⛔ Block merge

### New Issues
- [critical] @northwind/chart: runtime import now fails
- [major] 1 new circular dependency
- [major] @northwind/api: missing peer dependency

### Recommendation
⛔ Block merge
- A package has a critical (unusable) failure
- 1 new dependency cycle(s)
```

## How it works

```
 base snapshot ─┐
                ├─▶ compareRuns (delta) ─┐
 PR (head) run ─┘                        │
        │                                ▼
        ├─▶ changed files ─▶ blast radius ─▶ risk ─▶ merge policy ─▶ comment + status
        └─▶ graph
```

The analyzer **does not scan** — it consumes runs the engine already produced
(`scan`/`ci`), so it is deterministic and fast enough for every PR. It reuses the
existing delta engine for regression detection and adds three things on top:

| Concern      | Module               | What it adds                                                                                                                        |
| ------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Blast radius | `pr/blast-radius.ts` | Attributes changed files to packages, then walks the graph **backwards** to find every transitively-impacted package.               |
| Risk         | `pr/risk.ts`         | A 0–100 score from five itemised factors (regressions, graph changes, scenario regressions, score drop, blast radius × centrality). |
| Policy       | `pr/policy.ts`       | A two-tier gate (block / warn) loaded from `workbench.policy.ts`.                                                                   |

### Blast radius

> "core changed → 23 dependent packages impacted."

Editing a file changes its package; the _impact_ is that package **plus everything
that transitively depends on it**. `coverage` is the fraction of the workspace
affected — a high-centrality edit lights up most of the repo, a leaf edit barely
ripples. This is what makes a one-line change to `@northwind/core` "high risk" and
the same-sized change to a leaf app "low risk".

### Risk levels

`low` < `medium` < `high` < `critical`, from the summed factor score (0–100). Every
factor is surfaced in the report, so the level is always explainable.

## Merge policy

Create `workbench.policy.ts` in your workspace root (see
[`workbench.policy.example.ts`](./workbench.policy.example.ts)):

```ts
import type { MergePolicy } from "@package-workbench/core";

const policy: MergePolicy = {
  maxScoreDrop: 10, // block on a >10pt health drop
  blockOnCriticalFailure: true,
  blockOnNewCycle: true,
  blockOnNewViolation: false, // warn-only
  blockOnScenarioRegression: true,
  blockAtRisk: "critical", // block when aggregate risk hits this level
  warnOnRegression: true, // everything else → a warning, not a gate
};
export default policy;
```

It is merged over `DEFAULT_MERGE_POLICY`, so you only specify overrides. The policy
can also live in `workbench.config.ts` (`.policy`) or
`package.json#packageWorkbench.policy`.

**Decision tiers:**

- **block** — critical failure, new cycle, scenario regression, major score drop, or
  risk ≥ `blockAtRisk`. Fails the status check.
- **warn** — any other regression. Surfaces in the comment; does not gate.
- **approve** — no regressions or violations.

## CLI

```bash
# Markdown PR comment (compares against the latest stored baseline)
package-workbench pr . --base origin/main

# Explicit changed-files list (CI-friendly; no git invocation)
package-workbench pr . --changed changed.txt --format markdown --out pr.md

# JSON for tooling, or self-contained HTML artifact
package-workbench pr . --format json
package-workbench pr . --format html --out pr.html

# GitHub Actions: emit ::error/::warning annotations + a job summary
package-workbench pr . --github
```

`pr` exits non-zero only when the policy says **block**, so it doubles as a merge gate.
Changed files come from `--changed <file>` (one path per line) or, failing that, from
`git diff --name-only <base>...HEAD` (best-effort; empty if git is unavailable).

## CI setup (GitHub Actions)

Copy [`github-actions-pr.yml`](./github-actions-pr.yml) to
`.github/workflows/workbench-pr.yml`. The job:

1. Runs `ci` on the **base** commit to establish/refresh the baseline snapshot.
2. Runs `pr --github` on the **head** to produce the comment, annotations, and status.
3. Posts the markdown as a sticky PR comment.

`pr` writes `::error`/`::warning` workflow commands (inline annotations) and a
`$GITHUB_STEP_SUMMARY`. A **block** decision maps to a failing check
(`githubCheckConclusion` → `failure`); **warn** → `neutral`; **approve** → `success`.

## Desktop

The **PR Review** tab shows the same picture, explorable: the score delta, risk
factors, blast radius, new issues, the impacted-packages table (with centrality and
dependent counts), and the merge recommendation. It compares the current run against
the most recent stored baseline. Open it from the toolbar or the command palette
("Open PR Review").

## Determinism & performance

- **Deterministic:** same base + head + changed files → same review (clock injectable).
- **No scanning:** consumes existing runs; the analysis itself is pure graph + delta
  math, so it adds milliseconds, not minutes.
- **Never crashes on malformed input:** missing graph → empty blast radius; missing
  baseline → reported, not thrown.

## Roadmap — GitHub App

The CLI integration is stateless and works today. A future **GitHub App** would add:

- **Check-run API** instead of stdout annotations (richer inline UI, re-run button).
- **Baseline service** — store base-branch snapshots centrally so CI doesn't recompute
  them per PR (the current workflow checks out the base SHA).
- **Required-status integration** — register the Workbench check as a required gate via
  branch protection automatically.
- **Trend deltas across PRs** — track risk/score over a branch's life, not just vs base.
- **Suggested-change commits** — turn a fast fix (e.g. `pnpm add zod --filter …`) into a
  one-click commit, reusing the AI assistant's fix suggestions.

```

```
