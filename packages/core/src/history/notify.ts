import type {
  HistoricalRun,
  RunDelta,
  WorkbenchNotification,
} from "@package-workbench/plugin-sdk";
import { hasCriticalFailure } from "./delta";
import { tally } from "./delta";

/**
 * Turns a run + its delta into user-facing notifications for severe regressions,
 * critical failures, and score collapse. Pure — the desktop decides whether to
 * surface them as OS notifications.
 */

const SCORE_COLLAPSE = 15;

export function buildNotifications(
  current: HistoricalRun,
  delta: RunDelta | null,
): WorkbenchNotification[] {
  const out: WorkbenchNotification[] = [];

  if (hasCriticalFailure(current)) {
    const pkgs = current.packages
      .filter((p) => p.failedCheckIds.length && p.status === "fail")
      .map((p) => p.name);
    out.push({
      level: "critical",
      title: "Critical failure",
      body: `${pkgs.length} package(s) have a critical failure: ${pkgs.slice(0, 3).join(", ")}${pkgs.length > 3 ? "…" : ""}`,
    });
  }

  if (delta) {
    if (delta.scoreDelta <= -SCORE_COLLAPSE) {
      out.push({
        level: "critical",
        title: "Score collapse",
        body: `Health dropped ${-delta.scoreDelta} points (${current.overallScore - delta.scoreDelta} → ${current.overallScore})`,
      });
    }
    const counts = tally(delta.regressions);
    if (counts.critical > 0) {
      out.push({
        level: "critical",
        title: "Severe regression",
        body: `${counts.critical} critical regression(s) introduced`,
      });
    } else if (counts.major > 0) {
      out.push({
        level: "warning",
        title: "Regression",
        body: `${counts.major} major regression(s) introduced`,
      });
    }
    if (delta.scoreDelta >= SCORE_COLLAPSE) {
      out.push({
        level: "info",
        title: "Big improvement",
        body: `Health rose ${delta.scoreDelta} points`,
      });
    }
  }

  return out;
}
