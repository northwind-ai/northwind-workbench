# Writing a plugin

Plugins let a private repo (e.g. Northwind.ai) add custom validators and workspace adapters
**without modifying core**. A plugin depends only on `@package-workbench/plugin-sdk`.

## A custom validator

```ts
import { defineValidator, pass, fail, skip } from '@package-workbench/plugin-sdk';

export const hasLicense = defineValidator({
  id: 'northwind:has-license',
  title: 'Internal packages declare a license',
  weight: 1,
  async validate(pkg, ctx) {
    if (!pkg.private) return skip(this.id, 'External package');
    return pkg.manifest.license
      ? pass(this.id, `license: ${pkg.manifest.license}`)
      : fail(this.id, 'Missing "license" field');
  },
});
```

Validators receive a `PluginContext` — use `ctx.exec`, `ctx.readJson`, `ctx.fileExists`,
`ctx.readDir` rather than importing `node:fs`/`node:child_process` directly. This keeps
plugins portable and lets the host sandbox them later.

## A custom workspace adapter

Implement `detect()` (cheap predicate) and `listPackages()`. See
[`packages/nx-adapter`](../packages/nx-adapter/src/index.ts) for a complete reference.

## Bundling into a plugin and loading it

```ts
import { definePlugin } from '@package-workbench/plugin-sdk';
import { hasLicense } from './has-license';

export default definePlugin({
  name: '@northwind/workbench-plugin',
  validators: [hasLicense],
});
```

```ts
import { createRunner } from '@package-workbench/core';
import northwind from '@northwind/workbench-plugin';

const runner = createRunner({ cwd: process.cwd(), plugins: [northwind] });
const reports = await runner.validateAll();
```

> Roadmap: auto-discovery via a `package-workbench.config.ts` at the workspace root and a
> `"packageWorkbench": { "plugins": [...] }` field in `package.json`, so the desktop app can
> load plugins without code changes.
