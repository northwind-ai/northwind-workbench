# Performance Intelligence

Find the repository's performance bottlenecks — build, runtime, memory,
dependencies, and CI — and detect regressions over time.

```
Performance Report:
Build Bottleneck:
  @repo/chart-intelligence

Contribution:
  41.2s  (38% of total build cost)
```

## What it reuses

It does **not** re-measure what's already captured — it reads existing metrics and
adds the missing pieces:

| Metric                         | Source                                        |
| ------------------------------ | --------------------------------------------- |
| check durations                | `HealthCheckResult.durationMs`                |
| scenario latency + heap deltas | `ScenarioResult.durationMs` / `memoryBytes`   |
| runtime import latency         | `RuntimeCompatibilityReport` executions       |
| bundle size                    | package intelligence sizes                    |
| dependency weight / duplicates | package intelligence                          |
| **build time**                 | **optional live profiler** (`perf --profile`) |

Lives in `packages/perf-intelligence`.

## Build profiling & attribution

Without `--profile`, each package gets a **deterministic estimated build cost**
(bundle size + dependency count + check/scenario time), so a "build hotspot"
ranking exists offline. With `--profile`, the engine **runs each package's build**
with the correct per-toolchain, filtered invocation (Nx / Turborepo / pnpm / npm /
yarn / bun) and records the real duration + cache hit — accurate attribution.

```
deriveBuildCommand(pnpm)  → pnpm --filter <pkg> run build
deriveBuildCommand(turbo) → npx turbo run build --filter <pkg>
deriveBuildCommand(nx)    → npx nx build <pkg>
```

## Memory analysis

From scenario heap deltas: peak, average, **spike** detection (>100 MB or 5× the
average), and **leak suspicion** (memory grows monotonically across ≥ 3 scenarios).

## Dependency cost

The heaviest dependencies — known-large deps, unused runtime deps, and
**duplicate-version families** (ranked above single heavy deps) — top 10.

## Regression detection

Each run is persisted (`.package-workbench/perf`). The next run compares against the
baseline and reports regressions above per-metric thresholds:

```
Regression: @repo/chart bundle +48% (major)
```

Build (+20%), bundle (+15%), memory (+25%), scenario (+20%), and total check time
(+25%) are tracked; severity scales with the percentage.

## Bottleneck ranking

One headline bottleneck per category — **build / runtime / memory / dependency /
CI** — the "where do I look first" list. CI = the most expensive health check overall.

## CLI

```bash
package-workbench perf .              # estimated build cost + all bottlenecks
package-workbench perf . --profile    # run builds for accurate timing
package-workbench perf . --pretty     # the headline report
package-workbench perf . --format json
package-workbench perf . --no-save    # don't update the baseline
```

`perf` exits non-zero on a **critical** regression.

### Example (real output, demo workspace)

```
Performance Report:
Build Bottleneck:
  @demo/app
Contribution:
  52% of total  (52% of total build cost)

Bottlenecks:
  [Build] @demo/app — estimated build cost: 52% of total
  [CI] runtime_import_check — total check time: 148ms (3 run(s), avg 49ms)
```

## Optimization opportunities (what the report points at)

- The top build-contribution package — cache it, split it, or trim its deps.
- Duplicate-version dependency families — dedupe to shrink install + bundle.
- The most expensive check — parallelize or scope it (pair with Diff Intelligence's
  targeted scan plan).
- Packages with memory spikes / leak suspicion — profile their scenarios.

## Desktop

The engine emits everything a **Performance** tab needs (Overview / Build / Runtime /
Memory / Dependencies / Trends): per-package metrics, ranked bottlenecks, regressions
vs the stored baseline, and the snapshot history for trend charts.

## Requirements & limitations

- **Low overhead by default** — no builds are run unless `--profile` is passed;
  everything else is reused metrics.
- **Deterministic** where inputs are (estimates, dependency cost, regression math);
  live build/scenario timings are wall-clock and vary.
- Runtime/memory metrics require the runtime/scenario engines to have run; otherwise
  those categories are empty (build/bundle/CI still populate).
- Estimated build cost is a _relative_ proxy — use `--profile` for real seconds.

```

```
