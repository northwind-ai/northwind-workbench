import { defineCheck, fail, pass } from "@package-workbench/plugin-sdk";
import { CheckId } from "../check-ids";

export const packageJsonValid = defineCheck({
  id: CheckId.packageJsonValid,
  label: "package.json is valid",
  description: "The package.json file exists and contains parseable JSON.",
  severity: "critical",
  weight: 3,

  async run({ package: pkg }) {
    if (pkg.manifestValid) return pass("package.json parsed successfully");
    return fail("critical", "package.json is missing or invalid", {
      details:
        "The manifest could not be parsed; downstream checks may be unreliable.",
      evidence: pkg.warnings.length ? pkg.warnings : ["Unknown parse error"],
    });
  },
});
