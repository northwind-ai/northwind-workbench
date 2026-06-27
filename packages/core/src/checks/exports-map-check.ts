import {
  defineCheck,
  fail,
  pass,
  skip,
  warn,
} from "@package-workbench/plugin-sdk";
import { CheckId } from "../check-ids";
import { validateExports } from "../runtime/exports";

/**
 * Validates the structure of the `exports` map (and main/module/types
 * consistency): no mixed key styles, no escaping targets, types declared. These
 * are the misconfigurations that compile fine but break consumers at import time.
 */
export const exportsMapCheck = defineCheck({
  id: CheckId.exportsMap,
  label: "exports map is valid",
  description:
    'The package.json "exports" map is structurally valid and consistent with main/module/types.',
  severity: "high",
  weight: 2,

  async run({ package: pkg }) {
    const { hasExportsField, issues, valid } = await validateExports(pkg);

    const high = issues.filter((i) => i.severity === "high");
    const lower = issues.filter((i) => i.severity !== "high");

    if (!valid) {
      return fail(
        "high",
        `Invalid exports/entry configuration (${high.length} issue(s))`,
        {
          details:
            "These break module resolution for consumers regardless of a successful build.",
          evidence: high.map((i) =>
            i.at ? `${i.at}: ${i.message}` : i.message,
          ),
        },
      );
    }
    if (lower.length > 0) {
      return warn(
        "low",
        `exports configuration has ${lower.length} minor issue(s)`,
        {
          evidence: lower.map((i) =>
            i.at ? `${i.at}: ${i.message}` : i.message,
          ),
        },
      );
    }
    if (!hasExportsField)
      return skip('No "exports" map declared (using main/module)');
    return pass("exports map is structurally valid");
  },
});
