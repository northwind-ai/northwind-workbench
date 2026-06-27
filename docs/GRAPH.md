# Dependency intelligence

> Workbench understands not just individual packages, but how they relate.

Graph generation + all analysis live in `@package-workbench/core`
(`analyzeDependencyGraph`). The CLI and desktop render the result; no graph logic
lives in the UI (layout is a pure SDK helper so the renderer can position nodes
without importing Node).

## What it produces

`DependencyGraph` = nodes + edges + analysis:

- **Nodes** — one per workspace package, with metrics: `fanIn`, `fanOut`, `degree`,
  `centrality` (normalised), `depth` (longest chain), and transitive
  dependent/dependency counts.
- **Edges** — directed, carrying every relationship between two packages
  (`dependency` / `devDependency` / `peerDependency` / `optionalDependency` /
  `import`). An edge discovered only from source (never declared) is flagged
  `undeclared`.
- **cycles** — `CircularDependencyReport[]` (self / direct / indirect).
- **violations** — `BoundaryViolation[]` from configured rules.
- **smells** — `ArchitecturalSmell[]`.
- **health** — a 0..100 `GraphHealthReport` with a grade and penalty breakdown.

## Import-level discovery

Declared `package.json` deps are not enough — Workbench scans source (TS/TSX/JS/JSX/
mjs/cjs) for `import` / `require` / dynamic `import()` / `export … from`, and resolves
each specifier to an internal package by name, subpath, or **tsconfig path alias**
(`compilerOptions.paths`). Works across npm, pnpm, and Nx layouts; Turborepo is the same
shape. Test/scenario/config files are excluded from the shipped surface.

## Cycle detection

Tarjan's SCC algorithm (iterative, O(V+E)) finds every strongly-connected component;
each non-trivial SCC (or self-loop) is a cycle. Severity rises with cycle size and the
centrality of the packages involved:

```
[high] direct: @acme/core → @acme/auth → @acme/core
[critical] indirect: a → b → c → d → e → a   (large + central)
```

## Boundary rules

Configure in `workbench.config.*` (or `packageWorkbench.boundaries` in package.json):

```ts
export default {
  boundaries: [
    { from: "core", cannotDependOn: ["ui", "app"] },
    { from: "tag:domain", cannotDependOn: ["tag:presentation"] },
    { from: "shared", canOnlyDependOn: ["shared", "types"] },
  ],
};
```

Matchers are exact names, `*` globs, or `tag:` selectors (tags are inferred from package
type + path segments). Layering inversions (a low layer depending on a higher one) are
also penalised automatically.

## Smells & score

Detected: `god_package` (high fan-in), `high_coupling`, `dependency_explosion` (high
fan-out), `orphan`, `dead_package`, `duplicate_utility`. Thresholds scale with graph
size. The health score starts at 100 and subtracts capped penalties for cycles,
violations, coupling, orphans, and broken layering.

## CLI

```bash
package-workbench graph <path>            # full graph JSON + analysis
package-workbench graph <path> --pretty   # score, top fan-in, cycles, violations, smells
```

Exits non-zero when cycles or boundary violations exist (handy in CI).

## Desktop

The **Dependency Graph** mode (toolbar toggle) offers three views: an interactive
layered **Graph** (pan/zoom, click to focus a package's neighbourhood), a sortable
metrics **Table**, and a **Violations** view (cycles + rule breaks + smells). Search
filters nodes across views.

## Performance

- Source scanning is bounded per package (≤300 files, ≤512 KB each) and runs concurrently.
- Cycle detection is linear (Tarjan). Layout is a single cycle-safe DFS.
- Per-node transitive counts use BFS — O(V·(V+E)). Fine for hundreds of packages; for
  very large graphs (thousands) this is the part to swap for an SCC-condensation DP.
- The graph is built on demand (CLI `graph`, desktop "Analyze"), never in the default scan.
