/**
 * Example `workbench.config.ts` — drop in your workspace root.
 *
 * Holds CI gating (`ci`), the PR merge policy (`policy`), and package-intelligence
 * thresholds (`intel`). Every field is optional and merged over sensible defaults,
 * so you only specify what you want to change.
 */
import type {
  CiPolicy,
  IntelConfig,
  MergePolicy,
} from "@package-workbench/core";

const config: {
  ci?: CiPolicy;
  policy?: MergePolicy;
  intel?: IntelConfig;
} = {
  // `package-workbench ci` gate.
  ci: {
    maxScoreDrop: 5,
    failOnCritical: true,
    failOnNewCycle: true,
  },

  // `package-workbench pr` merge policy (see workbench.policy.example.ts for the
  // full set; it can also live in its own workbench.policy.ts file).
  policy: {
    maxScoreDrop: 10,
    blockOnNewCycle: true,
    blockAtRisk: "critical",
  },

  // `package-workbench api` / `size` thresholds.
  intel: {
    api: {
      flagUnusedExports: true,
    },
    size: {
      maxPackageDistKb: 500,
      maxSingleFileKb: 200,
      gzip: true,
    },
  },
};

export default config;
