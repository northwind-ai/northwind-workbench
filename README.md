<div align="center">

# 📦 Package Workbench

### Validate packages beyond compilation.

Package Workbench verifies whether packages in a JS/TS workspace **actually work** —
not just that they typecheck or build. Runtime imports, dependency boundaries, smoke-test
scenarios, and regression tracking, in a CLI and a desktop app.

[Quickstart](docs/quickstart.md) · [Architecture](docs/ARCHITECTURE.md) · [Plugins](docs/PLUGINS.md) · [CI](docs/HISTORY.md) · [Contributing](CONTRIBUTING.md)

</div>

---

## Why

A package can typecheck, build, and export symbols — and still fail at runtime due to a
bad ESM/CJS config, an invalid `exports` map, a missing dependency, or a browser-only
import. Package Workbench catches these, scores workspace health deterministically, maps
how packages depend on each other, runs domain-specific smoke tests, and fails CI when
things regress.

## Features

| | |
| --- | --- |
| 🩺 **Package health** | Deterministic checks across the whole workspace (npm / pnpm / Nx). |
| ⚙️ **Runtime compatibility** | Sandboxed imports prove a package loads in Node CJS/ESM, the browser, and Electron. |
| 🕸️ **Dependency intelligence** | Import-level graph with cycle detection, boundary rules, and architectural smells. |
| 🧪 **Scenario testing** | Plugin-contributed smoke tests that prove packages do real work. |
| 📉 **CI regression detection** | Historical runs + deltas; fail the build when health drops. |
| 🧩 **Plugin system** | Add custom validators, scenarios, and workspace adapters. |

## Install

```bash
# CLI (run in any JS/TS repo)
npm install -D package-workbench    # or pnpm add -D / yarn add -D

# Desktop app — download an installer from the Releases page (Win/macOS/Linux)
```

See [docs/installation.md](docs/installation.md).

## Quickstart

```bash
package-workbench scan .                 # health check the workspace
package-workbench runtime . --pretty     # runtime compatibility matrix
package-workbench graph . --pretty       # dependency graph + violations
package-workbench scenarios .            # run plugin smoke tests
package-workbench ci .                    # CI gate (non-zero on regression)
package-workbench report . --format html --out report.html
```

Full walkthrough: [docs/quickstart.md](docs/quickstart.md).

## Monorepo layout

```
packages/
  plugin-sdk     stable, dependency-free contracts (types + pure helpers)
  core           the headless engine: scan, runtime, scenarios, graph, history
  cli            the command-line runner
  ui             presentational React components (no Node, no Electron)
  nx-adapter     reference plugin (Nx discovery + classification)
apps/
  desktop        Electron app (main = engine host, renderer = sandboxed UI)
examples/        sample workspaces used by demos + tests
docs/            documentation
```

## Develop

```bash
pnpm install
pnpm test            # vitest
pnpm typecheck       # all packages
pnpm dev             # run the desktop app
pnpm build           # build all packages
pnpm package         # build desktop installers (electron-builder)
```

## Documentation

- [Installation](docs/installation.md) · [Quickstart](docs/quickstart.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Runtime engine](docs/RUNTIME.md) · [Scenarios](docs/SCENARIOS.md) · [Dependency graph](docs/GRAPH.md)
- [Plugin development](docs/PLUGINS.md)
- [History, reports & CI](docs/HISTORY.md) · [GitHub Actions example](docs/github-actions-example.yml)

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and our
[Code of Conduct](CODE_OF_CONDUCT.md). Found a security issue? See [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE) © Package Workbench contributors
