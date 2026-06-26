# Package Workbench

A desktop app for verifying that JavaScript/TypeScript packages **actually work** — not just compile.

Point it at a repo and it detects every package, then runs a battery of health checks
(entry points resolve, module loads, peer deps present, builds succeed, runtime smoke
scenario passes, tests exist) and shows you a per-package health score with drill-down
failure logs.

> Status: **bootstrap**. The engine, CLI, plugin SDK, UI, and Electron shell are wired
> end-to-end and ship with demo data. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Why

`tsc` passing tells you the types line up. It does **not** tell you the published `exports`
point at real files, that the built module actually loads, that a required peer dependency
is installed, or that importing the thing and calling it doesn't throw. Package Workbench
runs those checks for real.

## Repository layout

```
package-workbench/
├── apps/desktop/        Electron shell (electron-vite + React). A thin client.
├── packages/
│   ├── core/            Headless validation engine. No UI, no Electron.
│   ├── cli/             `pw` — the engine on the command line.
│   ├── plugin-sdk/      Stable, dependency-free interfaces for plugins.
│   ├── nx-adapter/      Reference plugin: Nx workspace detection.
│   └── ui/              Presentational React components.
├── examples/            good-lib (healthy) + broken-lib (fails on purpose).
└── docs/
```

## Quick start

```bash
pnpm install

# Desktop app (loads demo data on first launch)
pnpm dev

# CLI against the example packages
pnpm cli -- --demo                 # built-in demo reports
pnpm cli -- examples/good-lib      # scan a real package
pnpm cli -- examples --json        # machine-readable
```

## License

Apache-2.0.
