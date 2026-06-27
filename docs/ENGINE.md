# Engine isolation

Heavy analysis (scanning, AST/import parsing, dependency graphs, sandboxed runtime
imports, scenarios, report generation) runs in an **isolated worker process**, never in
the renderer or the Electron main process. The UI stays responsive, the main process never
blocks, and a worker crash (or a malicious package) is contained and auto-recovered.

## Architecture

```
┌──────────────┐  IPC (contextBridge)   ┌──────────────────┐   typed protocol    ┌───────────────────────┐
│   Renderer   │ ───────────────────►   │  Electron Main   │ ──────────────────► │  utilityProcess        │
│  (sandboxed) │  scan / cancel /       │   (broker)       │  request / cancel / │  ── Engine Worker ──   │
│   React UI   │ ◄───────────────────   │  EngineHost      │  ping / shutdown    │  attachEngineWorker()  │
│  progress ▲  │  progress / status     │  (process mgr)   │ ◄────────────────── │  TaskHandler           │
└──────────────┘  result / crash        └──────────────────┘  progress/response/ │      │                 │
                                                               error/pong/ready   │      ▼                 │
                                                                                  │  core runner →         │
                                                                                  │  child node (sandbox)  │
                                                                                  └───────────────────────┘
```

- **Renderer** — speaks only the narrow `window.workbench` bridge. Shows live progress, a
  worker-status dot, memory, and a Cancel button. Never touches Node.
- **Main** — a thin broker. Owns dialogs, history persistence, and the `EngineHost`; routes
  requests to the worker and forwards progress/status back. After the refactor the main
  bundle dropped from ~134 KB to ~48 KB (the engine moved out).
- **EngineHost** (`@package-workbench/core`) — transport-agnostic process manager:
  concurrency-capped queue, per-task timeouts, cancellation, a heartbeat, and **automatic
  restart on crash**. In-flight tasks reject with a structured `EngineError` that carries
  the last progress (partial recovery).
- **Worker** — an Electron `utilityProcess` running the engine. Built as its own bundle
  (`out/main/worker.js`).

## The protocol

Strongly typed messages (`packages/core/src/engine/protocol.ts`):

```ts
// request   { id, type: 'RUN_SCAN', payload }
// progress  { id, progress: 52, phase: 'dependency_graph', completed, total }
// response  { id, result }
// error     { id, errorType: 'PROCESS_CRASH' | 'TIMEOUT' | 'CANCELLED' | 'TASK_ERROR', message }
```

Tasks: `RUN_SCAN`, `RUN_PACKAGE`, `RUN_RUNTIME`, `RUN_SCENARIOS`, `RUN_GRAPH`, `RUN_REPORT`.

## Runtime sandbox

Runtime import checks already run in a **separate child Node process**; the worker adds:

- **Memory cap** — `--max-old-space-size` (default 1 GB) bounds memory bombs.
- **Timeout** — the child is killed if it exceeds the limit (infinite-loop protection).
- **Cancellation** — an `AbortSignal` kills the child immediately.
- **Restricted env** (opt-in) — strips inherited environment to a minimal safe set.
- **Captured stdout/stderr** — never inherited into the app.

> Trust note: importing a package runs its top-level code by design. The child-process +
> timeout + memory cap + worker isolation contain the blast radius; only audit repos you
> trust (see [SECURITY.md](../SECURITY.md)). `PW_NO_RUNTIME=1` disables execution entirely.

## Crash recovery

If the worker dies (segfault, OOM, hang detected by the heartbeat):

1. In-flight tasks reject with `PROCESS_CRASH` + their last progress.
2. The crash is logged (electron-log) and surfaced to the UI ("worker crashed — restarted").
3. The host respawns a fresh worker (up to `maxRestarts`) so the next task just works.
4. The main process and renderer never crash.

## Progress phases

`workspace_scan → package_discovery → health_checks → runtime_checks → dependency_graph →
scenarios → report_generation`, each with a 0–100 percentage and item counts.

## Benchmarks

Synthetic monorepos (chained `packages/*`), static engine (`PW_NO_RUNTIME=1`), via
`pnpm --filter @package-workbench/cli exec tsx scripts/benchmark.ts` — Node 22, win32/x64:

| Packages | Scan (ms) | Graph (ms) | Total (ms) | Heap Δ (MB) | RSS (MB) |
| -------: | --------: | ---------: | ---------: | ----------: | -------: |
|       10 |        17 |          6 |         23 |           0 |       80 |
|      100 |        94 |         36 |        130 |           0 |       82 |
|      500 |       438 |        156 |        594 |           9 |       94 |

Roughly **linear** in package count with a small, flat memory footprint. Crucially, this
cost is now paid **in the worker** — the UI and main process stay at 0% during a scan.
Runtime import execution is bounded separately by the per-import timeout + memory cap and
is parallelisable across packages in a future revision.

## Testing

The host + worker runtime + task handler are unit-tested over an **in-process transport**
with a controllable fake handler (`packages/core/src/engine/engine.test.ts`), covering:
happy path + progress, `TASK_ERROR`, `TIMEOUT`, cancellation (signal + already-aborted),
queue ordering, crash → `PROCESS_CRASH` + partial-progress recovery, auto-restart,
`maxRestarts`, and heartbeat-detected hangs — all without spawning Electron.
