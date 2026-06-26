# Architecture

## Guiding principle

> Whether a package *works* can only be answered by **running** things.

So the system is built around a privileged headless engine (`core`) that the CLI and the
Electron main process both drive. The Electron renderer is sandboxed and only renders JSON
it receives over IPC.

```
                    ┌──────────────────────────┐
   CLI (node) ────► │  @package-workbench/core   │ ◄──── Electron main (node)
                    │  createRunner()           │            │ IPC (contextBridge)
   plugins ───────► │  detect → validate        │            ▼
                    └────────────┬──────────────┘     Electron renderer (sandboxed)
                                 │ types only                @pw/ui (React)
                     @package-workbench/plugin-sdk
                          (interfaces, zero deps)
```

## Packages and the boundaries between them

| Package      | May depend on                | Must NOT contain            |
| ------------ | ---------------------------- | --------------------------- |
| `plugin-sdk` | nothing                      | runtime deps, Node, UI      |
| `core`       | `plugin-sdk`, Node           | UI, Electron                |
| `cli`        | `core`                       | UI, Electron                |
| `nx-adapter` | `plugin-sdk` (peer)          | `core` internals, UI        |
| `ui`         | `core` (**types only**), React | Node, Electron            |
| `desktop`    | `core`, `ui`, Electron       | validation logic            |

The renderer/UI importing **only types** from `core` is load-bearing: `import type` is
erased at build, so `core`'s Node code (`child_process`, `fs`) never enters the renderer
bundle. The CSP in `index.html` and `contextIsolation`/`sandbox` enforce the rest.

## The runner (the shared spine)

`createRunner({ cwd, plugins })` returns `{ detect, validatePackage, validateAll, on, host }`.
Both the CLI and Electron call this exact function — they differ only in how they render its
event stream and reports. This is what makes "CLI and Electron share the same runner" literal
rather than aspirational.

Events: `detect:start → adapter:selected → detect:done → (package:start → validator:start →
validator:done… → package:done)*`.

## Validation model

Each `Validator` returns `{ status: pass|warn|fail|skip, score: 0..1, summary, evidence[] }`.
The aggregate health score is the weight-weighted mean of non-skipped results, mapped to
0..100. Built-ins, cheap → expensive:

| Validator       | Needs install? | What it proves |
| --------------- | -------------- | -------------- |
| `exports-valid` | no             | every declared entry resolves to a real file |
| `can-import`    | no             | primary entry parses as a loadable module (`node --check`) |
| `peer-deps`     | no             | required peers are resolvable (warn if not) |
| `coverage`      | no             | a test script / coverage output exists |
| `smoke`         | yes (opt-in)   | `workbench.scenario.mjs` imports + exercises the package |
| `builds`        | yes (opt-in)   | the package's `build` script exits 0 |

`smoke` and `builds` self-`skip` unless the package opts in, so the default scan is safe and
fast and gives signal even before `pnpm install`.

## Plugin system

A `Plugin` contributes `adapters` (workspace detection) and/or `validators` (health checks),
registered into `PluginHost`. Adapters are probed in registration order (specific before
generic); validators are keyed by id so a later plugin can override a built-in.

**v1 trust model — called out explicitly:** plugins run **in-process** with full trust. A
buggy plugin can crash a scan. This is fine for running against your own repos and keeps the
API trivial. Upgrade path:

1. Move `createRunner` into an Electron `utilityProcess` / `worker_thread` so scans never
   block the main thread and a crash is contained.
2. Load third-party plugins in that isolated process with a capability-limited
   `PluginContext` (the SDK already routes all fs/exec through the context for exactly this).

## Dev-time module strategy ("internal source" packages)

Internal `@package-workbench/*` packages point their `exports` at TypeScript **source**, not
`dist`. Every consumer is a bundler (electron-vite, vite) or esbuild-based (`tsup`), so there
is no build step required to run the app in dev. Publishing to npm uses each package's
`publishConfig` (which repoints to `dist`) plus its `tsup` build script.

## Known limits (today)

- Workspace glob expansion handles a single trailing `/*` only (covers the common case).
- pnpm YAML is parsed with a small hand-rolled reader (no nested keys). Swap in `yaml` if
  needed — it's isolated to `detectors/pnpm.ts`.
- The runner validates packages sequentially (child-process heavy work). Bounded concurrency
  is a planned improvement.
- Turborepo detection is not implemented yet (it's a future adapter, same shape as `nx-adapter`).
