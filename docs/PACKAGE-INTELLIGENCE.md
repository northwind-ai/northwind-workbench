# Package Intelligence — API Surface & Size

Answers the questions that creep up on every growing monorepo:

- **Which exports are unused?** (and which are _safe_ to delete)
- **Which packages are getting too large?**
- **Which dependencies inflate bundle/runtime size?**
- **Which public APIs appear stale?**

The design rule throughout is **conservative certainty**: telling someone an export
is "safe to delete" when it's part of a published package's public API is dangerous,
so every verdict is hedged by what we can actually prove.

## Export inventory

For each package we build an inventory of every export found in source —
`named`, `default`, `re-export` (`export { x } from`), `star-re-export`
(`export *`), and `type`-only — plus the subpaths declared in the package.json
`exports` map. Scanning is regex-based (dependency-free, fast on big repos); it can
miss exotic syntax, and the classifier accounts for that by never over-claiming.

## Usage classification

Each export is classified against the workspace import index, **weakest claim first**:

| Class                | Meaning                                                         | Deletion advice                                     |
| -------------------- | --------------------------------------------------------------- | --------------------------------------------------- |
| `used`               | imported somewhere internally                                   | keep                                                |
| `public-api-unknown` | unused internally, but the package is **public**                | **never delete** — external consumers are invisible |
| `likely-dead`        | private, unused, but reached via `export *` / types (ambiguous) | review                                              |
| `definitely-dead`    | private, unused, unambiguous                                    | **safe to remove**                                  |

> An export is only ever `definitely-dead` when its package is **private** AND nothing
> in the workspace imports it AND the path to it is unambiguous. Public packages, star
> re-exports, default exports, and type-only exports are all hedged downward.

Namespace imports (`import * as ns`) and `export *` consumers mark the whole surface
as ambiguously used — we can't prove a specific symbol is dead, so we don't claim it.

**Stale re-exports** are barrel-file forwards (`export { x } from './y'`) of symbols
nothing imports — indirection without value.

## Bundle size

For packages with build output (no bundler is run — we measure on-disk `dist`/`build`/
`lib`/`out`):

- total + gzipped size, file count
- the largest files
- size delta vs a historical baseline (when supplied)
- for browser/universal packages, a heuristic list of **heavy client deps**

If there's no build output, the report is `measured: false` (never an error) —
"works without building if dist already exists".

## Dependency weight

Per package: **unused** runtime deps (declared but never imported), **test-only
runtime** deps (imported only from tests but declared as `dependencies`), and
**heavy** known-large client deps. Across the workspace: **duplicate versions** — the
same dependency pinned to multiple ranges (inflates installs, risks runtime
mismatches). Unused/test-only verdicts carry a note that the dep may be used
indirectly (a bin, types, a peer) and a sub-certain confidence.

## Health checks (opt-in)

Five checks are available — and **never fail hard** (warnings only), because the
advice is heuristic:

`unused_export_check` · `stale_reexport_check` · `bundle_size_check` ·
`dependency_weight_check` · `duplicate_version_check`

They are _not_ in the default `builtinChecks` (they read the whole workspace); a
single memoized analysis is shared across a run so cost stays O(n). Enable them by
adding `intelligenceChecks` to a runner's plugins, or just use the CLI commands.

## Configuration

`workbench.config.ts`:

```ts
export default {
  api: {
    flagUnusedExports: true,
  },
  size: {
    maxPackageDistKb: 500, // warn when dist exceeds this
    maxSingleFileKb: 200, // warn when any one file exceeds this
    gzip: true,
  },
};
```

Also accepted under `package.json#packageWorkbench.intel`.

## CLI

```bash
# API surface — export inventory + usage classification
package-workbench api .                      # markdown
package-workbench api . --format json
package-workbench api . --package @nw/lib    # one package

# Size — bundle size + dependency weight + duplicate versions
package-workbench size .                      # markdown
package-workbench size . --format json --out size.json
```

`api` exits non-zero when there is **definitely-dead** code (a safe signal only);
`size` exits non-zero when a measured package exceeds its dist budget.

### Example API surface report

```
## @northwind/lineage (private)

5 export(s) · 3 used · 0 public-api-unknown · 1 likely-dead · 1 definitely-dead

| Export        | Kind  | Class            | Confidence | Note                                   |
| ------------- | ----- | ---------------- | ---------: | -------------------------------------- |
| `parseLegacy` | named | definitely-dead  |        85% | Private package, no internal usage…    |
| `Adapter`     | type  | likely-dead      |        55% | Types make tracking imperfect — review |

Stale re-exports: 1
- `src/index.ts` ← ./legacy
```

### Example size report

```
## @northwind/chart

- Output: `dist` · 612 KB (148 KB gzip) across 7 file(s)
- Δ vs baseline: +44 KB
- Heavy client deps: chart.js, d3
- Largest files:
  - `dist/index.js` — 410 KB (96 KB gzip)

## Duplicate dependency versions
- react — ^17.0.2, ^18.2.0 (in 4 package(s))
```

## Desktop

The **API Surface** tab (per package) shows a Size section (output size, largest
files, dependency-weight warnings, historical delta) and the export table (usage
count, status, confidence, conservative risk label). Trigger analysis from the tab.

## Limitations

- **Regex scanning** can miss dynamic/computed exports and unusual syntax; the
  classifier compensates by never claiming false certainty.
- **Usage is workspace-internal only.** External consumers of a published package are
  invisible — which is exactly why public exports are never flagged for deletion.
- **Size is on-disk dist**, not a true bundler analysis (no tree-shaking simulation);
  `heavyClientDeps` is a curated heuristic list.
- **Unused-dependency** detection can't see indirect use (bin scripts, type-only,
  peers) with certainty — hence the hedged confidence and notes.
- Duplicate-version detection compares **declared ranges**, not the resolved lockfile
  tree.
