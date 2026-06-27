import { join } from "node:path";
import {
  defineCheck,
  fail,
  pass,
  warn,
  type PackageManifest,
} from "@package-workbench/plugin-sdk";
import { CheckId } from "../check-ids";

function collectStrings(node: unknown, out: string[]): void {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object")
    for (const v of Object.values(node)) collectStrings(v, out);
}

const INDEX_FALLBACKS = [
  "index.js",
  "index.mjs",
  "index.cjs",
  "src/index.ts",
  "index.ts",
];

/** Declared entry points, ignoring glob targets we can't statically resolve. */
function declaredEntries(m: PackageManifest): string[] {
  const out: string[] = [];
  for (const f of [m.main, m.module, m.types, m.typings])
    if (typeof f === "string") out.push(f);
  collectStrings(m.exports, out);
  if (typeof m.bin === "string") out.push(m.bin);
  else if (m.bin && typeof m.bin === "object")
    out.push(...Object.values(m.bin));
  return [...new Set(out)].filter((t) => !t.includes("*"));
}

export const entrypointExists = defineCheck({
  id: CheckId.entrypointExists,
  label: "Has a resolvable entry point",
  description:
    "At least one declared entry point (or an index fallback) exists on disk.",
  severity: "high",
  weight: 2,

  async run({ package: pkg, host }) {
    const declared = declaredEntries(pkg.manifest);

    if (declared.length === 0) {
      for (const fallback of INDEX_FALLBACKS) {
        if (await host.fileExists(join(pkg.root, fallback)))
          return pass(`Resolved via ${fallback}`);
      }
      return warn("high", "No entry point declared and no index file found", {
        details: 'Add a "main"/"module"/"exports" field or an index file.',
      });
    }

    const present: string[] = [];
    const missing: string[] = [];
    for (const entry of declared) {
      if (await host.fileExists(join(pkg.root, entry))) present.push(entry);
      else missing.push(entry);
    }

    if (present.length > 0)
      return pass(
        `${present.length}/${declared.length} declared entry point(s) resolve`,
      );
    return fail("high", "No declared entry point resolves on disk", {
      details:
        "Every declared entry points at a file that does not exist (build not run?).",
      evidence: missing,
    });
  },
});
