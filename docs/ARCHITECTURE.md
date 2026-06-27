# Architecture

## Guiding principle

> Whether a package _works_ can only be answered by **running** things.

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

| Package      | May depend on                                         | Must NOT contain       |
| ------------ | ----------------------------------------------------- | ---------------------- |
| `plugin-sdk` | nothing                                               | runtime deps, Node, UI |
| `core`       | `plugin-sdk`, Node                                    | UI, Electron           |
| `cli`        | `core`                                                | UI, Electron           |
| `nx-adapter` | `plugin-sdk` (peer)                                   | `core` internals, UI   |
| `ui`         | `plugin-sdk` (values), `core` (**types only**), React | Node, Electron         |
| `desktop`    | `core`, `ui`, Electron                                | validation logic       |

The renderer/UI importing **only types** from `core` is load-bearing: `import type` is
erased at build, so `core`'s Node code (`child_process`, `fs`) never enters the renderer
bundle. The CSP in `index.html` and `contextIsolation`/`sandbox` enforce the rest.

## The runner (the shared spine)

`createRunner({ cwd, plugins, discoverPlugins })` returns
`{ host, on, inspect, checkPackage, analyzeRuntime, scenariosFor, runScenarios, run }`.
Both the CLI and Electron call this exact function — they differ only in how they render its
event stream and reports. This is what makes "CLI and Electron share the same runner" literal
rather than aspirational.

Events: `run:start → workspace:detected → (package:start → check:start → check:done… →
package:done)* → run:done`.

## Validation model

Each check returns `{ status: pass|warn|fail|skip|unknown, severity, summary, details?,
evidence[] }`. The score starts at 100 and subtracts severity-weighted penalties
(see `scoring.ts`); skipped/unknown checks erode _confidence_ instead. Built-in checks,
cheap → expensive:

| Check                                                             | Executes code?   | What it proves                                     |
| ----------------------------------------------------------------- | ---------------- | -------------------------------------------------- |
| `package_json_valid`                                              | no               | manifest parses                                    |
| `entrypoint_exists` / `main_module_exists` / `types_entry_exists` | no               | declared entries exist                             |
| `module_resolution_check`                                         | no               | every `main`/`module`/`exports` target resolves    |
| `exports_map_check`                                               | no               | the `exports` map is structurally valid            |
| `missing_peer_dependencies`                                       | no               | required peers are resolvable (warn if not)        |
| `required_scripts_present` / `dependency_version_shape`           | no               | hygiene                                            |
| `browser_compatibility_check`                                     | no               | no browser-breaking Node built-ins                 |
| `runtime_import_check`                                            | **yes**          | the entry actually imports in a child Node process |
| `scenario_runner_check`                                           | **yes** (opt-in) | plugin scenarios pass (`PW_RUN_SCENARIOS`)         |

The static checks are always safe and fast. `runtime_import_check` executes the package
(disable with `PW_NO_RUNTIME=1`); `scenario_runner_check` runs only when `PW_RUN_SCENARIOS`
is set (the `scenarios` command and desktop Scenario Runner set it). See
[RUNTIME.md](./RUNTIME.md) and [SCENARIOS.md](./SCENARIOS.md).

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
