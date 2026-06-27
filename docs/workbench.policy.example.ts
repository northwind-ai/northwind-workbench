/**
 * Example merge policy for Package Workbench's `pr` command.
 *
 * Drop this in your workspace root as `workbench.policy.ts`. The default export
 * (or a `.policy` field) is merged over the built-in DEFAULT_MERGE_POLICY, so you
 * only need to specify what you want to change.
 *
 * Two tiers:
 *   - block: hard-fails the status check (blocks merge)
 *   - warn:  surfaces in the comment but does not gate
 */
import type { MergePolicy } from "@package-workbench/core";

const policy: MergePolicy = {
  // Health
  maxScoreDrop: 10, // block if overall health drops > 10 points
  blockOnCriticalFailure: true, // block if any package becomes unusable

  // Architecture
  blockOnNewCycle: true, // block on a newly introduced dependency cycle
  blockOnNewViolation: false, // warn-only for new boundary violations

  // Behaviour
  blockOnScenarioRegression: true, // block if smoke-test pass rate drops

  // Aggregate risk gate: block when computed risk reaches this level.
  // 'critical' is strict-but-safe; tighten to 'high' for regulated repos.
  blockAtRisk: "critical",

  // Everything else that regresses → a warning in the PR comment.
  warnOnRegression: true,
};

export default policy;
