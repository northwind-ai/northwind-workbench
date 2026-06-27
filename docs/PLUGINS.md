# Writing a plugin

Plugins let a private repo (e.g. Northwind.ai) add custom validators, scenarios, and
workspace adapters **without modifying core**. A plugin depends only on
`@package-workbench/plugin-sdk`.

## The plugin shape

```ts
import { defineWorkbenchPlugin } from "@package-workbench/plugin-sdk";

export default defineWorkbenchPlugin({
  id: "@northwind/workbench-plugin",
  name: "Northwind plugin",
  version: "1.0.0",
  // Gate this plugin's validators + scenarios to the packages it understands.
  supports: (pkg) => pkg.name.startsWith("@northwind/"),
  validators: [
    /* … */
  ],
  scenarios: [
    /* … */
  ],
  adapters: [
    /* … */
  ],
});
```

`supports(pkg)` decides which packages get this plugin's `validators` and `scenarios`
(omit it to apply everywhere). A throwing `supports()` simply opts the plugin out — it
never crashes a run.

> `WorkbenchPlugin` (via `defineWorkbenchPlugin`) is the recommended shape: a required
> `id`/`version`/`supports`. The looser `Plugin` (via `definePlugin`) keeps every field
> optional for quick built-ins. `checks` and `validators` are the same concept — both are
> merged.

## A custom validator

```ts
import {
  defineValidator,
  pass,
  fail,
  skip,
} from "@package-workbench/plugin-sdk";

export const hasLicense = defineValidator({
  id: "northwind:has-license",
  label: "Internal packages declare a license",
  description: "Private packages must set a license field.",
  severity: "medium",
  weight: 1,
  async run({ package: pkg }) {
    if (!pkg.private) return skip("External package");
    return pkg.manifest.license
      ? pass(`license: ${pkg.manifest.license}`)
      : fail("medium", 'Missing "license" field');
  },
});
```

A validator's `run({ package, workspace, host, scenarios })` returns an outcome built with
the `pass` / `warn` / `fail` / `skip` / `unknown` helpers. Use the injected
`host` (`host.exec`, `host.readJson`, `host.fileExists`, `host.readDir`) rather than
importing `node:fs`/`node:child_process` directly — this keeps plugins portable and lets
the host sandbox them later.

## A scenario

See [SCENARIOS.md](./SCENARIOS.md). In short:

```ts
import { defineScenario } from "@package-workbench/plugin-sdk";

export const loads = defineScenario({
  id: "northwind:loads",
  title: "Package loads and exposes an API",
  assertions: [{ path: "exportCount", operator: "greater_than", expected: 0 }],
  run: (ctx) => ({ exportCount: /* … */ 3 }),
});
```

## A custom workspace adapter

Implement `detect()` (cheap predicate) and `listPackages()`. See
[`packages/nx-adapter`](../packages/nx-adapter/src/index.ts) for a complete reference that
both discovers Nx projects and validates their app/lib classification.

## Loading plugins

Plugins are discovered from the workspace root, in this order:

1. `workbench.config.{ts,mts,js,mjs,cjs}` or `package-workbench.plugins.{ts,js,mjs}`
2. a `packageWorkbench.plugins` array in `package.json`

```ts
// workbench.config.ts
export default {
  plugins: [
    "@workbench/plugin-nx", // an installed npm package
    "./plugins/custom-plugin.ts", // a local path
  ],
};
```

A failed plugin load (missing file, bad export) becomes a recorded error and a workspace
warning — **it never crashes Workbench**. Programmatically:

```ts
import { createRunner, loadWorkspacePlugins } from "@package-workbench/core";

// Auto-discovery:
const runner = createRunner({ cwd: process.cwd(), discoverPlugins: true });

// Or load explicitly and inject:
const { plugins, errors } = await loadWorkspacePlugins(process.cwd());
const runner2 = createRunner({ cwd: process.cwd(), plugins });
```

The built-in starter plugins (`typescriptPlugin`, and the Nx plugin in `nx-adapter`) are
the working examples to copy.

### Trust model (v1)

Plugins and scenarios run **in-process** with full trust — a buggy plugin can slow or
crash a scan. This is fine for your own repos and keeps the API trivial. The SDK already
routes all fs/exec through `PluginContext`, so the upgrade path is to load third-party
plugins inside an isolated `utilityProcess`/`worker_thread` with a capability-limited
context.
