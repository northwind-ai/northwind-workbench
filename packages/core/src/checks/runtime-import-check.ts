import { defineCheck, fail, pass, skip } from "@package-workbench/plugin-sdk";
import { CheckId } from "../check-ids";
import { executeImport } from "../runtime/sandbox";
import { resolvePrimaryEntry } from "../runtime/resolve";

/**
 * The real runtime test: import the package's primary entry in a fresh child
 * Node process and report whether it loads. This catches the failures that
 * typecheck + build can't — bad ESM/CJS config, missing deps, invalid exports,
 * and exceptions thrown at import time.
 *
 * Set `PW_NO_RUNTIME=1` to skip execution (e.g. CI sandboxes that forbid
 * spawning). Packages with no resolvable entry self-skip rather than fail, so an
 * un-built library doesn't masquerade as broken.
 */

const FAILURE_HINT: Record<string, string> = {
  IMPORT_RESOLUTION_FAILURE: "The entry file could not be resolved or loaded.",
  MISSING_DEPENDENCY:
    "A dependency is not installed/resolvable. Run install, or check the dependency is declared.",
  ESM_CJS_MISMATCH:
    'Module system mismatch — check "type", file extensions, and the import/require exports conditions.',
  RUNTIME_EXCEPTION: "The module threw while its top-level code ran.",
  SYNTAX_FAILURE: "The entry (or something it loads) failed to parse.",
  EXPORT_RESOLUTION_FAILURE:
    "The exports map did not permit loading the requested path.",
};

export const runtimeImportCheck = defineCheck({
  id: CheckId.runtimeImport,
  label: "Module can be imported",
  description:
    "Actually imports the package entry in a child Node process to confirm it loads.",
  severity: "high",
  weight: 2,

  async run({ package: pkg, signal }) {
    if (process.env.PW_NO_RUNTIME)
      return skip("Runtime import execution disabled (PW_NO_RUNTIME)");

    const system = pkg.manifest.type === "module" ? "esm" : "cjs";
    const entry = await resolvePrimaryEntry(pkg, system);
    if (!entry)
      return skip(
        `No ${system.toUpperCase()} entry resolves — build the package, then re-check`,
      );

    const result = await executeImport(pkg, system, {
      entry,
      signal: signal as AbortSignal | undefined,
    });
    if (result.ok) {
      return pass(
        `Imported as ${system.toUpperCase()} — ${result.exportedKeys?.length ?? 0} export(s) in ${result.durationMs}ms`,
        {
          evidence: result.exportedKeys?.length
            ? [`exports: ${result.exportedKeys.slice(0, 12).join(", ")}`]
            : undefined,
        },
      );
    }

    const cls = result.failureClass ?? "RUNTIME_EXCEPTION";
    const detailParts = [FAILURE_HINT[cls] ?? ""];
    if (result.missingModule)
      detailParts.push(`Missing module: ${result.missingModule}`);
    if (result.offendingFile)
      detailParts.push(`Offending file: ${result.offendingFile}`);

    return fail("high", `${cls}: ${result.message ?? "import failed"}`, {
      details: detailParts.filter(Boolean).join(" "),
      evidence: result.stack
        ? [result.stack]
        : result.offendingFile
          ? [result.offendingFile]
          : undefined,
    });
  },
});
