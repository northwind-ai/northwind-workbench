# Quickstart

This walks through the core workflows in ~5 minutes. Run the commands in any JS/TS repo
(or in one of the bundled [`examples/`](../examples)).

## 1. Health scan

```bash
package-workbench scan . --pretty
```

You get a per-package health score (0–100), a confidence level, and the individual checks
(entry points resolve, exports map valid, module imports, peers installed, …).

```
✓ @acme/core@1.0.0  100/100  (high confidence, library/universal)
   ✓ package_json_valid          package.json parsed successfully
   ✓ runtime_import_check        Imported as ESM — 2 export(s) in 41ms
✗ @acme/client@1.0.0  35/100   (high confidence, library/universal)
   ✗ runtime_import_check        MISSING_DEPENDENCY: Cannot find package 'zod'
```

JSON output (drop `--pretty`) is suitable for piping into other tools.

## 2. Runtime compatibility

```bash
package-workbench runtime . --pretty
```

Shows the 5-target matrix (Node CJS/ESM, browser, Electron main/renderer) — proving the
package actually loads, not just compiles. See [RUNTIME.md](./RUNTIME.md).

## 3. Dependency graph

```bash
package-workbench graph . --pretty
```

Builds the import-level dependency graph and reports cycles, boundary violations,
architectural smells, and a graph health grade. Configure boundary rules in
`workbench.config.ts`. See [GRAPH.md](./GRAPH.md).

## 4. Scenarios

```bash
package-workbench scenarios . --pretty
```

Runs plugin-contributed smoke tests (e.g. "import the package and assert it returns
opportunities"). Authoring guide: [SCENARIOS.md](./SCENARIOS.md).

## 5. CI gate

```bash
package-workbench ci .
```

Scans, compares against the last run on this branch, and **exits non-zero** if a policy is
violated (score drop, critical failure, new cycle, scenario regression). Wire it into
GitHub Actions with [docs/github-actions-example.yml](./github-actions-example.yml). Full
guide: [HISTORY.md](./HISTORY.md).

## 6. Export a report

```bash
package-workbench report . --format html --out report.html
package-workbench report . --format markdown
```

## Configuration

Create `workbench.config.ts` (or a `packageWorkbench` field in `package.json`) at the
workspace root:

```ts
export default {
  plugins: ["@your-org/workbench-plugin", "./plugins/local.ts"],
  boundaries: [
    { from: "core", cannotDependOn: ["ui", "app"] },
    { from: "tag:domain", cannotDependOn: ["tag:presentation"] },
  ],
  ci: { maxScoreDrop: 5, failOnNewCycle: true },
};
```

## Desktop app

`pnpm dev` (from source) or launch the installed app. First run shows onboarding — **Open
Repository** or **Try Example Repo**. Press **⌘/Ctrl + K** for the command palette.
