# AI Refactor Architect

Package Workbench detects architectural problems; the Refactor Architect **proposes
fixes for them** — and proves they help. It answers:

- Which package should be split?
- Which packages should merge?
- Where is coupling too high?
- Which dependencies should move?
- What refactor reduces complexity the most?

```
Problem:
  core has fan-in 38, fan-out 19, and 3 cycles

AI Refactor Architect:
Suggested refactor:
  Split core into core-types, core-runtime, core-services

Expected impact:
  - reduce cycles by 100% (3)
  - reduce fan-out by 45% (9)
  - improve health score +12
```

## The key idea: grounded impact

Most "AI architecture advice" hand-waves its benefits. This engine doesn't. For
every suggestion it **projects an "after" graph** (applies the refactor to the
node/edge set) and **re-runs the real graph engine on it** — the same cycle
detection, boundary evaluation, coupling smells, and 0–100 health score used
everywhere else. The impact numbers are the _difference_ between the recomputed
after-graph and the current one. If a refactor wouldn't actually help, the
recomputation shows it, and the suggestion is dropped.

```
 current graph ──▶ detect problems ──▶ pick strategy ──▶ project "after" graph
                                                                │
                          impact = recompute(after) − baseline ◀┘
```

## Architectural smell detection

Conservative thresholds (high on purpose — flag _clear_ problems, not every
imperfect package):

| Smell                     | Signal                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------- |
| **God package**           | fan-in ≥ 8 AND fan-out ≥ 8 (often + cycles)                                        |
| **Overcoupled**           | degree (in + out) ≥ 16                                                             |
| **Leaky abstraction**     | many widely-consumed types from a package that also has runtime deps (needs intel) |
| **Layer violation**       | a forbidden dependency (boundary rule)                                             |
| **Utility blob**          | a `util/common/shared/helpers` package with high fan-in, ~0 fan-out                |
| **Feature fragmentation** | ≥ 4 tiny sibling packages under one domain prefix                                  |
| **Dependency cycle**      | any circular dependency                                                            |

Every problem carries quantified `metrics` and cited graph `evidence`.

## Refactor strategies

| Strategy                | Applied to                             | Projection (how impact is computed)                                                                    |
| ----------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `split_package`         | god / overcoupled / utility blob       | replace with types-leaf + runtime + services; consumers re-point at the types leaf (breaks back-edges) |
| `isolate_runtime_layer` | split where the package mixes runtimes | same projection, runtime-aware framing                                                                 |
| `extract_shared_types`  | cycles, leaky abstraction              | new types leaf both sides depend on; remove the back-edge                                              |
| `move_dependency`       | layer violation                        | remove the forbidden edge                                                                              |
| `introduce_boundary`    | cycles (alternative)                   | remove the closing back-edge                                                                           |
| `merge_packages`        | feature fragmentation                  | collapse siblings into one node; internal edges vanish                                                 |
| `create_adapter_layer`  | layer violation (alternative)          | insert an allowed intermediary                                                                         |
| `delete_dead_package`   | orphan / dead package                  | remove the node + its edges                                                                            |

## Impact estimation (explainable)

Every field traces to a recomputed value, surfaced in `impact.rationale`:

- **healthScoreDelta** — `health(after) − health(before)`, both from `computeGraphHealth`.
- **cycleReduction / %** — `cycles(before) − cycles(after)` from `detectCycles`.
- **fanOutReduction / %** — the focal package's fan-out vs the heaviest split piece.
- **dependencyReduction** — net internal-edge change.
- **complexityReduction** — normalised blend of the above.
- **buildImprovement** — qualitative (e.g. "incremental builds no longer blocked by 3 cycle(s)").

## Explanation & risk

Each suggestion explains **why** (the problem), **how it helps** (the recomputed
rationale), **tradeoffs** (honest — e.g. "3 packages instead of 1"), and cites graph
evidence. A `RefactorRisk` (level · effort · affected packages) gates conservatism:
the ranking score is `impact ÷ risk`, and the Minimal-risk plan excludes high-risk
splits entirely.

## Before/after visualization

Each suggestion ships a `RefactorVisualization`: the affected sub-graph **before** and
**after**, with `changedEdges` (added / removed) and `changedNodes`
(added / removed / split / merged). The desktop renders these as side-by-side
mini-diagrams; added edges are green, removed edges red-dashed, new nodes highlighted.

## Generate Alternative Plans

The same suggestion pool yields three genuinely different plans:

- **Balanced** — every positive-impact suggestion, ranked by score.
- **Minimal-risk** — only low/medium-risk refactors (no large splits).
- **Max-impact** — ranked by raw impact (health + cycles), risk ignored.

## CLI

```bash
package-workbench refactor .                 # markdown plan
package-workbench refactor . --pretty        # the Problem → Refactor → Impact block
package-workbench refactor . --format json   # machine-readable RefactorPlan
package-workbench refactor . --alternatives  # all three variants
```

`refactor` exits non-zero when there is at least one recommended refactor (so it can
flag architectural debt in CI).

### Example (real output, intentionally-broken example workspace)

```
Problem:
  Cycle: @broken/cycle-b → @broken/cycle-a → @broken/cycle-b

AI Refactor Architect:
Suggested refactor:
  Break cycle by extracting @broken/cycle-b-types
  - @broken/cycle-b-types

Expected impact:
  - reduce cycles by 100% (1)
  - improve health score +25

Risk: medium (medium effort, ~2 package(s) affected)
```

## Desktop

The **Refactor** tab shows the top problems, ranked suggestions (impact, risk,
steps, tradeoffs, cited evidence), and the before/after diagram per suggestion, with
a **Generate Alternative Plans** button and a Balanced / Minimal-risk / Max-impact
switch.

## Architecture diagrams

**Split (god package):**

```
        before                              after
   c0…c9 ─┐                          c0…c9 ─┐
          ▼                                 ▼
   d1 ──▶ CORE ──▶ d0…d9            d1 ─▶ core-types (leaf)
          ▲  │                      core-services ─▶ core-runtime ─▶ core-types
   d0 ────┘  └──(cycle)             core-runtime ─▶ d0…d9
   2 cycles, health 70              0 cycles, health 82  (+12)
```

**Extract shared types (cycle):**

```
   A ⇄ B   (cycle)        ──▶      A ─▶ B-types ◀─ B     (no cycle)
```

## Limitations

- **Projections are structural models**, not edits — they predict the graph shape
  after a refactor (which is what drives cycles/health), not the line-level diff. The
  steps tell a human how to realise it.
- **Split distribution is heuristic** (types-leaf / runtime / services); real splits
  may apportion edges differently, so fan-out figures are an estimate of the dominant
  effect, not an exact post-split count.
- **Leaky-abstraction** detection requires the package-intelligence pass (export
  usage); without it, that smell is skipped.
- **One suggestion per focal package** by design (avoid over-refactoring) — deeper
  multi-step refactors are presented as separate, independently-justified steps.
- It **never applies anything** — every output is a proposal. (Safe auto-fixes are the
  separate Auto Fix engine's job.)

```

```
