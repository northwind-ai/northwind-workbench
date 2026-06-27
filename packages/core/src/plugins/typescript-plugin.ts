import { join } from "node:path";
import {
  defineScenario,
  defineValidator,
  defineWorkbenchPlugin,
  pass,
  skip,
  warn,
  type PackageInfo,
} from "@package-workbench/plugin-sdk";
import { executeImport } from "../runtime/sandbox";
import { resolvePrimaryEntry } from "../runtime/resolve";

/**
 * Starter plugin #1: the generic TypeScript package plugin. Applies to any
 * package that ships or builds TypeScript, and demonstrates the full plugin
 * surface — `supports()`, a validator, and an executable scenario — using only
 * the public SDK + core's runtime engine. A private plugin would look identical.
 */

function isTypeScriptPackage(pkg: PackageInfo): boolean {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return (
    "typescript" in deps ||
    typeof pkg.manifest.types === "string" ||
    typeof pkg.manifest.typings === "string" ||
    Object.keys(pkg.scripts).some((s) => /^(build|typecheck|tsc)$/.test(s))
  );
}

/** Validator: a TS package should have a tsconfig, ideally in strict mode. */
const tsconfigStrict = defineValidator({
  id: "typescript:tsconfig-strict",
  label: "tsconfig present and strict",
  description: "A discoverable tsconfig.json with strict mode enabled.",
  severity: "low",
  weight: 1,
  async run({ package: pkg, host }) {
    const candidates = ["tsconfig.json", "tsconfig.build.json"];
    let found: string | null = null;
    for (const c of candidates) {
      if (await host.fileExists(join(pkg.root, c))) {
        found = c;
        break;
      }
    }
    if (!found)
      return warn("low", "No tsconfig.json found in the package root");
    const cfg = await host.readJson<{
      compilerOptions?: { strict?: boolean; extends?: string };
      extends?: string;
    }>(join(pkg.root, found));
    const strict = cfg?.compilerOptions?.strict === true;
    if (strict) return pass(`${found} enables strict mode`);
    // `extends` may turn strict on in a base config we didn't follow — soften to info.
    if (cfg?.extends || cfg?.compilerOptions?.extends)
      return skip(`${found} extends a base config (strict not verified here)`);
    return warn("low", `${found} does not enable "strict"`, {
      details: "Strict mode catches the largest class of type bugs.",
    });
  },
});

/** Scenario: the package actually loads in Node and exposes exports. */
const loadsScenario = defineScenario({
  id: "typescript:module-loads",
  title: "Module loads and exposes exports",
  description:
    "Imports the built entry in a child Node process and checks it has exports.",
  timeoutMs: 15_000,
  assertions: [
    {
      path: "ok",
      operator: "equals",
      expected: true,
      message: "Package entry should import without throwing",
    },
    {
      path: "exportCount",
      operator: "greater_than",
      expected: 0,
      message: "Package should expose at least one export",
    },
  ],
  async run(ctx) {
    const system = ctx.package.manifest.type === "module" ? "esm" : "cjs";
    const entry = await resolvePrimaryEntry(ctx.package, system);
    if (!entry) {
      ctx.log(`No ${system} entry resolved — package may need a build first`);
      return { ok: false, exportCount: 0, system };
    }
    ctx.log(`Importing ${entry} as ${system}`);
    const result = await executeImport(ctx.package, system, {
      entry,
      timeoutMs: ctx.signal ? 12_000 : undefined,
    });
    if (!result.ok) ctx.log(`${result.failureClass}: ${result.message}`);
    return {
      ok: result.ok,
      exportCount: result.exportedKeys?.length ?? 0,
      exports: result.exportedKeys,
      system,
    };
  },
});

export const typescriptPlugin = defineWorkbenchPlugin({
  id: "@package-workbench/plugin-typescript",
  name: "TypeScript package plugin",
  version: "0.1.0",
  supports: isTypeScriptPackage,
  validators: [tsconfigStrict],
  scenarios: [loadsScenario],
});
