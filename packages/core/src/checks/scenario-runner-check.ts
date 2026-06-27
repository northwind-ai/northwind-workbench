import { defineCheck, fail, pass, skip } from "@package-workbench/plugin-sdk";
import { CheckId } from "../check-ids";
import { runScenarios } from "../scenarios/runner";

/**
 * Runs the scenarios contributed by plugins that support this package, and folds
 * the pass rate into health. Scenario failures are weighted heavily — a package
 * whose smoke tests fail is broken in practice, even if it builds.
 *
 * Because scenarios execute code, they run only when explicitly requested
 * (`PW_RUN_SCENARIOS=1`, set by the `scenarios` CLI command and the desktop
 * Scenario Runner). A plain health scan reports how many are available instead.
 */
export const scenarioRunnerCheck = defineCheck({
  id: CheckId.scenarioRunner,
  label: "Scenarios pass",
  description:
    "Executes plugin-contributed smoke-test scenarios and reports the pass rate.",
  severity: "high",
  weight: 3,

  async run({ package: pkg, workspace, host, scenarios }) {
    const list = scenarios ?? [];
    if (list.length === 0)
      return skip("No scenarios contributed for this package");
    if (!process.env.PW_RUN_SCENARIOS) {
      return skip(
        `${list.length} scenario(s) available — run \`package-workbench scenarios\` to execute`,
      );
    }

    const run = await runScenarios(list, { package: pkg, workspace, host });
    const pct = Math.round(run.passRate * 100);
    const summary = `${run.passed}/${run.total} scenarios passed (${pct}%)${run.skipped ? `, ${run.skipped} skipped` : ""}`;

    if (run.failed === 0) {
      return pass(summary, {
        evidence: run.results.map((r) => `✓ ${r.title} (${r.durationMs}ms)`),
      });
    }

    const evidence = run.results
      .filter((r) => r.status === "fail")
      .flatMap((r) => [
        `✗ ${r.title} [${r.category ?? "fail"}]`,
        ...r.assertions.filter((a) => !a.ok).map((a) => `    ${a.message}`),
        ...(r.error && r.category !== "assertion"
          ? [`    ${r.error.type}: ${r.error.message}`]
          : []),
      ]);

    // Heavy weighting: a majority-failing scenario set is critical.
    const severity = run.passRate < 0.5 ? "critical" : "high";
    return fail(severity, summary, {
      details:
        "Scenario failures mean the package does not behave correctly at runtime, not just that it failed to build.",
      evidence,
    });
  },
});
