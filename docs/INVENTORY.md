# Repository Inventory & Technical Debt Auditor

A comprehensive inventory of the repository plus a **conservative** technical-debt
audit — what exists, what's active/stale/dead, and where the debt concentrates.

```
Repository Inventory:
  Packages: 147
  Apps: 8
  Libraries: 112
  Experimental: 19
  Orphaned: 6
  Dead: 3
  Deprecated: 4
  High-Risk (debt ≥ 60): 14
```

## What it reuses

Dependency graph (dead/orphan packages, dependents), package intelligence (dead
exports, duplicate utilities), and health scores — plus new source-marker scanning,
activity detection, coverage estimation, and debt scoring. Lives in
`packages/inventory`.

## Classification (with confidence)

Each package is classified — `app`, `library`, `infra`, `cli`, `plugin`, `config`,
`shared`, `experimental`, `deprecated`, `unknown` — from manifest shape (bin,
exports, scripts, private), name/path patterns, and keywords, with a 0–1 confidence.

## Activity detection (conservative)

Status from dependents (graph), last-modified (file mtime), deprecation, and privacy:

| Status         | Definition                                           |
| -------------- | ---------------------------------------------------- |
| **active**     | changed in ≤ 30 days, or ≥ 3 dependents              |
| **stale**      | older, lightly used                                  |
| **dormant**    | no dependents, no recent activity                    |
| **deprecated** | marked deprecated                                    |
| **dead**       | **private** AND no dependents AND ≥ 1 year untouched |

> "Dead" is deliberately strict: a public package, a recently-touched one, or one
> with any dependent is **never** dead — avoiding false positives.

## Technical-debt detection

- **Markers** — `TODO` / `FIXME` / `HACK` / `XXX`, scanned **only in comments** (a
  `todo` string literal isn't flagged).
- **Incomplete features** (high priority) — `throw new Error("Not implemented")`,
  stubs, placeholders.
- **Mock/demo leakage** — `mockData` / `fakeData` / `hardcoded` / `__mocks__` in
  **non-test** code (test files are exempt).
- **Dead exports** — `definitely-dead` exports from package intelligence.
- **Duplicate utilities / dead packages** — from the dependency-graph smells.

## Coverage estimation

`high` / `medium` / `low` / `none` from the test-file-to-source ratio + scenario
count.

## Debt scoring (0–100, higher = worse)

Deterministic, from: missing tests, staleness/death, TODO density + incomplete
features (capped), and runtime health. A dead, untested package that throws "not
implemented" scores high; a healthy, well-tested, active one scores 0.

## Reports

`analyzeInventory` returns both a `RepositoryInventory` (totals + per-package reports)
and a `TechnicalDebtReport` (debt ranking, findings by kind, suspected dead packages,
incomplete features). Rendered as **text / Markdown / HTML / JSON**.

## CLI

```bash
package-workbench inventory .                 # markdown inventory + debt ranking
package-workbench inventory . --pretty        # the summary block
package-workbench inventory . --format json
package-workbench inventory . --format html --out inventory.html
```

`inventory` exits non-zero when any package is high-risk (debt ≥ 60).

### Example report

```
Repository Inventory:
  Packages: 3 · Apps: 1 · Libraries: 1

Top technical debt:
   28  @demo/app   (dead_export)
   25  @demo/core  (—)
   25  @demo/ui    (—)

Incomplete features:
  ! @demo/api: src/handlers.ts:42 — throws "not implemented"
```

## Desktop

The engine drives an **Inventory** tab (Summary / Packages / Technical Debt / Dead
Code / Incomplete Features) with filters (stale, dead, high-debt, low-tests,
experimental) — all from `RepositoryInventory` + `TechnicalDebtReport`.

## Recommended cleanup strategy

1. **Confirm + delete dead packages** (the conservative list) — start with the safest.
2. **Finish or remove incomplete features** — `not_implemented` is the highest-signal
   debt.
3. **Raise coverage** on `none`/`low` high-debt packages.
4. **Remove dead exports** (pair with the Auto Fix engine's stale-reexport fix).
5. **Dedupe duplicate utilities** and triage long-lived `FIXME`/`HACK` markers.

## Requirements & limitations

- **Conservative dead-code classification** — strict criteria, test files exempt from
  leakage, markers only in comments → few false positives.
- **Deterministic scoring** (given the source); activity uses file mtime, so a
  `git clone` that rewrites timestamps will read as "recent" until the next edit.
- Coverage is an **estimate** from file ratios, not instrumented line coverage.
- Large-repo friendly: source scanning is capped per file/count (reuses the
  intelligence scanner's limits).

```

```
