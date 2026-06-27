# Runtime validation engine

> A package can typecheck, build, and export symbols — and still fail to **load**.
> The runtime engine verifies that it actually imports and runs.

## What it catches

Bad ESM/CJS config, invalid `exports` maps, missing dependencies, browser-only or
Node-only imports in the wrong place, dynamic-import failures, and exceptions thrown
at import time.

## The compatibility matrix

Every package is graded against five runtime targets:

| Target              | What it means                |
| ------------------- | ---------------------------- |
| `node_cjs`          | `require()` in CommonJS Node |
| `node_esm`          | `import` in ESM Node         |
| `browser`           | bundled for the browser      |
| `electron_main`     | Electron main process (Node) |
| `electron_renderer` | Electron renderer (Chromium) |

Each cell is `pass` / `fail` / `warn` / `unknown`:

```
Node CJS           PASS
Node ESM           FAIL   ESM_CJS_MISMATCH: module is not defined in ES module scope
Browser            WARN   Uses polyfillable Node built-ins (path)
Electron Main      PASS
Electron Renderer  WARN
```

`unknown` is used for targets a package was never meant to support (a server-only
library is `unknown`, not `fail`, for the browser). Only **intended** targets count
against the health score.

## How a verdict is reached

1. **Detection** (`detectRuntime`) — infers the intended runtime(s) from dependencies,
   the `browser`/`bin` fields, `exports` conditions, scripts, and Node built-ins found
   in source, with a 0..1 confidence.
2. **Static analysis** — `validateExports` resolves every declared entry to a real file
   and validates the `exports` map; `analyzeBrowserCompat` scans source for Node
   built-ins.
3. **Execution** (`executeImport`) — for Node targets, the package's entry is imported
   in a **fresh child Node process** via a generated harness (`require()` for CJS,
   dynamic `import()` for ESM). No `eval`, no `vm`. The child is sandboxed by process
   boundary + timeout.

Browser / Electron-renderer verdicts are derived statically (we can't spawn a browser);
`electron_main` mirrors the Node result.

## Failure classes

Import failures are classified into stable categories (`ImportFailureClass`):

| Class                       | Typical cause                                          |
| --------------------------- | ------------------------------------------------------ |
| `IMPORT_RESOLUTION_FAILURE` | the entry file can't be resolved/loaded                |
| `MISSING_DEPENDENCY`        | a bare specifier isn't installed (`missingModule` set) |
| `ESM_CJS_MISMATCH`          | `require()` of ESM, `module`/`require` in an ES module |
| `SYNTAX_FAILURE`            | the entry (or a transitive file) failed to parse       |
| `RUNTIME_EXCEPTION`         | threw while top-level code ran (or timed out)          |
| `EXPORT_RESOLUTION_FAILURE` | the `exports` map blocked the requested path           |

## Health checks

The engine surfaces as four checks (plus the scenario check):

- `module_resolution_check` — declared entries resolve (static, always safe)
- `exports_map_check` — the `exports` map is structurally valid
- `browser_compatibility_check` — no browser-breaking Node built-ins
- `runtime_import_check` — the entry actually imports (executes the package)

`runtime_import_check` executes code. Set `PW_NO_RUNTIME=1` to disable it (e.g. in a
sandbox that forbids spawning); packages with no resolvable entry self-skip.

## CLI

```bash
package-workbench runtime <path>            # JSON matrix for every package
package-workbench runtime <path> --pretty   # human-readable table
package-workbench runtime <path> -p @scope/pkg
package-workbench runtime <path> --no-execute  # static analysis only (no child imports)
```

## API

```ts
import { buildRuntimeReport } from "@package-workbench/core";

const report = await buildRuntimeReport(pkg, {
  execute: true,
  timeoutMs: 10_000,
});
report.matrix; // { node_cjs: 'pass', node_esm: 'fail', ... }
report.detection; // { primary, intended, confidence, signals }
report.targets; // per-target reasons + execution details
report.nodeBuiltinsUsed;
report.resolution; // ModuleResolutionReport[]
```

## Scaling

Static checks never execute code and are cheap. Execution is bounded by a per-import
timeout and self-skips un-built packages, so a large monorepo degrades gracefully. For
the fastest possible scan, run with `--no-execute` (or `PW_NO_RUNTIME=1`) and rely on the
static resolution/exports/browser checks.
