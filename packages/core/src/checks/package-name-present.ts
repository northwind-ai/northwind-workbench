import { defineCheck, fail, pass } from "@package-workbench/plugin-sdk";
import { CheckId } from "../check-ids";

export const packageNamePresent = defineCheck({
  id: CheckId.packageNamePresent,
  label: "Package has a name",
  description: 'The manifest declares a non-empty "name" field.',
  severity: "high",
  weight: 1,

  async run({ package: pkg }) {
    const name = pkg.manifest.name;
    if (typeof name === "string" && name.trim().length > 0)
      return pass(`Named "${name}"`);
    return fail("high", 'Missing "name" field', {
      details:
        "A package without a name cannot be published or reliably resolved.",
    });
  },
});
