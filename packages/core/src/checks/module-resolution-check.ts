import { defineCheck, fail, pass, skip } from "@package-workbench/plugin-sdk";
import { CheckId } from "../check-ids";
import { validateExports } from "../runtime/exports";

/**
 * Static module-resolution check: every declared entry (`main`/`module`/`types`
 * and `exports` targets) must resolve to a real file on disk. No execution —
 * this is the cheap, always-safe first line of runtime validation.
 */
export const moduleResolutionCheck = defineCheck({
  id: CheckId.moduleResolution,
  label: "Declared modules resolve",
  description:
    "Every entry point declared in package.json points at a file that exists.",
  severity: "high",
  weight: 2,

  async run({ package: pkg }) {
    const { resolution } = await validateExports(pkg);
    if (resolution.length === 0)
      return skip("No entry points declared to resolve");

    const unresolved = resolution.filter((r) => !r.resolved);
    if (unresolved.length === 0) {
      return pass(
        `${resolution.length}/${resolution.length} declared target(s) resolve`,
      );
    }
    return fail(
      "high",
      `${unresolved.length}/${resolution.length} declared target(s) do not resolve`,
      {
        details:
          "A declared entry points at a missing file — the package was likely not built, or a path is wrong.",
        evidence: unresolved.map(
          (r) => `${r.specifier} — ${r.error ?? "missing"}`,
        ),
      },
    );
  },
});
