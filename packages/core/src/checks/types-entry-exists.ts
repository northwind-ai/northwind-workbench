import { join } from "node:path";
import { defineCheck, fail, pass, skip } from "@package-workbench/plugin-sdk";
import { CheckId } from "../check-ids";

export const typesEntryExists = defineCheck({
  id: CheckId.typesEntryExists,
  label: "Type declarations exist",
  description:
    'The declared "types"/"typings" entry resolves to a real .d.ts file.',
  severity: "medium",
  weight: 1,

  async run({ package: pkg, host }) {
    const rel = pkg.manifest.types ?? pkg.manifest.typings;
    if (typeof rel !== "string")
      return skip('No "types"/"typings" field declared');

    if (await host.fileExists(join(pkg.root, rel)))
      return pass(`Types resolve: ${rel}`);
    return fail("medium", `Declared types file missing: ${rel}`, {
      details: "Consumers using TypeScript will get no types for this package.",
    });
  },
});
