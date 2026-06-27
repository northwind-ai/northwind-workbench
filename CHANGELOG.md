# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Runtime validation engine** — sandboxed import execution (no `eval`), a 5-target
  compatibility matrix (Node CJS/ESM, browser, Electron main/renderer), runtime detection
  with confidence, export-map validation, and static browser-compatibility analysis.
  Checks: `module_resolution_check`, `exports_map_check`, `browser_compatibility_check`,
  `runtime_import_check`.
- **Plugin system & scenario runner** — `WorkbenchPlugin` (validators + scenarios +
  adapters with `supports()`), config-driven plugin discovery, an assertion engine, and a
  scenario runner (timeouts, cancellation, parallelism). Check: `scenario_runner_check`.
  Starter plugins: generic TypeScript plugin, Nx plugin.
- **Dependency intelligence** — import-level dependency graph (npm/pnpm/Nx), Tarjan cycle
  detection, a boundary-rule engine, architectural-smell detection, per-node metrics, and
  a graph health score. CLI `graph`; desktop Dependency Graph view.
- **Historical runs, reports & CI** — JSON run store, deterministic delta + regression
  classification, JSON/Markdown/HTML report export, a `ci` policy gate (non-zero on
  regression), and a notification engine. CLI `ci` + `report`; desktop History tab.
- **Polished desktop UX** — first-run onboarding, Zustand global state, a fuzzy command
  palette (Ctrl/Cmd+K), package search + filtering, a richer package dashboard, friendly
  error surfaces with suggested fixes, skeleton loaders, keyboard shortcuts, and
  light/dark/system theming.
- **Release readiness** — electron-builder packaging (Win/macOS/Linux), crash recovery
  (renderer + main), `electron-log` logging with "Open Logs Folder", OSS repository files,
  documentation, example workspaces, and CI/release GitHub Actions.
- **Engine isolation** — all heavy analysis runs in an isolated Electron `utilityProcess`
  via a transport-agnostic process manager (`EngineHost`): typed IPC protocol, granular
  progress, cancellation, per-task timeouts, heartbeat health-checks, and automatic restart
  on crash with partial-progress recovery. Hardened runtime sandbox (memory cap, restricted
  env, abort-kill). UI gains live progress, a Cancel button, and a worker status/memory
  indicator. See [docs/ENGINE.md](docs/ENGINE.md).

## [0.0.1] — scaffold

- Initial monorepo scaffold: scanner, static health checks, CLI, plugin SDK, UI, and the
  Electron shell wired end-to-end with demo data.
