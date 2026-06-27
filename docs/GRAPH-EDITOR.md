# Interactive Graph Editor (Simulation)

The dependency graph is read-only. The Graph Editor lets you **simulate**
architectural changes — remove edges, split/merge packages, add boundaries — and see
the predicted impact, **without touching the repo**.

```
Before                 After (remove core → ui, split core)
Cycles: 5              Cycles: 2
Score:  72             Score:  84
```

## The key idea: recomputed, not estimated

Every "after" number comes from re-running the **real graph engine** on the mutated
graph — the same cycle detection, boundary evaluation, coupling smells, and health
score used everywhere else. The simulation engine reuses the Refactor Architect's
projection helpers (`projectSplit` / `projectMerge` / `projectRemoveEdge` /
`recompute`); it adds no new graph logic. Lives in `packages/graph-sim`.

```
 base graph + mutations ──▶ apply to a working copy ──▶ recompute(after)
                                                              │
                            impact = after − recompute(before)┘
```

The input graph is **never mutated** (verified by test); the engine is deterministic.

## Mutations

| Mutation                   | Effect                                                    |
| -------------------------- | --------------------------------------------------------- |
| `add_edge` / `remove_edge` | add/remove a dependency                                   |
| `move_node`                | reposition (layout only; recorded for persistence)        |
| `split_node`               | split a package into `-types` / `-runtime` / `-services`  |
| `merge_nodes`              | merge several packages into one (internal edges collapse) |
| `add_boundary`             | add a boundary rule (recomputes violations)               |

## Impact prediction

`SimulationResult` carries before/after `GraphMetrics` and a recomputed `impact`:

```
{ cycleReduction, scoreDelta, violationReduction, nodeDelta, edgeDelta }
```

plus `changedEdges` / `changedNodes` (added/removed) for the before/after
visualization, and `positions` from any `move_node` mutations.

## AI integration — "Preview refactor"

`mutationsFromRefactor(suggestion)` turns a Refactor Architect suggestion into graph
mutations, so clicking **Preview refactor** applies the AI's suggested change to the
editor and shows the recomputed impact:

```
AI suggests: Split core → core-types + core-runtime + core-services
            ↓  mutationsFromRefactor →  [{ split_node: core }]
Graph updates; Cycles 5 → 2, Score 72 → 84
```

## Export

A simulation exports three ways:

- **JSON** — the full `SimulationResult` (`exportSimulationJson`).
- **Markdown refactor plan** — the mutations as steps + recomputed impact
  (`exportSimulationMarkdown`).
- **Architecture diff report** — a before/after metrics table + changed edges
  (`exportArchitectureDiff`).

## CLI

```bash
# Preview the top refactor suggestion as a simulation
package-workbench graph-sim .

# Simulate explicit mutations from a file
package-workbench graph-sim . --input mutations.json
package-workbench graph-sim . --input mutations.json --format json
```

`mutations.json` is a `GraphMutation[]`, e.g.:

```json
[
  { "type": "remove_edge", "from": "@repo/core", "to": "@repo/ui" },
  {
    "type": "split_node",
    "id": "@repo/core",
    "parts": {
      "types": "@repo/core-types",
      "runtime": "@repo/core-runtime",
      "services": "@repo/core-services"
    }
  }
]
```

### Example (real output)

```
| Metric     | Before | After |
| ---------- | -----: | ----: |
| Health     | 71 (C) | 96 (A) |
| Cycles     |      1 |     0 |
| Edges      |      2 |     1 |

## Changes
1. Remove dependency @broken/cycle-a → @broken/cycle-b

## Predicted impact
- Cycles 1 → 0 (−1)
- Health 71 → 96 (+25)
```

## Desktop

The engine drives a **Graph Editor** tab (View / Edit / Simulate / Compare modes) with
zoom, pan, node drag, edge selection, and the mutation controls (remove edge, split
node, merge nodes, reset, save simulation), showing the current graph vs the simulated
graph with changed edges highlighted. The existing dependency-graph view + the
Refactor Architect's before/after diagrams render `SimulationResult` directly.

## Performance

- **O(graph) per simulation** — one projection pass + one recompute; fast enough for
  interactive editing.
- **Deterministic**, with no repo I/O — pure in-memory graph math.
- For very large graphs, mutations compose (apply many, recompute once), so a session
  of edits costs a single recomputation when previewed.

## Limitations

- The split projection models the _dominant_ structural effect (types-leaf / runtime /
  services); a real split may apportion edges differently, so fan-out figures are an
  estimate of the main effect, not an exact post-split count.
- Simulations are structural (graph shape) — they predict cycles/health/coupling, not
  line-level diffs.
- Layout positions from `move_node` are cosmetic; they don't affect metrics.

```

```
