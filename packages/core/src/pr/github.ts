import type { PrReview } from "./types";

/**
 * GitHub Actions integration helpers — pure string/serialization only (no
 * `@actions/*` dependency, no network). The CLI prints these; a workflow wires
 * them to the GitHub API or to the Actions runner via stdout commands.
 *
 *  - {@link githubAnnotations}    → `::error`/`::warning` workflow commands.
 *  - {@link githubJobSummary}     → Markdown for `$GITHUB_STEP_SUMMARY`.
 *  - {@link githubCheckConclusion}→ `success` / `neutral` / `failure` for a check run.
 */

export type CheckConclusion = "success" | "neutral" | "failure";

/** Map a merge recommendation to a GitHub check-run conclusion. */
export function githubCheckConclusion(review: PrReview): CheckConclusion {
  switch (review.decision.recommendation) {
    case "block":
      return "failure";
    case "warn":
      return "neutral";
    default:
      return "success";
  }
}

/** A status-check title + summary line for the PR. */
export function githubStatus(review: PrReview): {
  conclusion: CheckConclusion;
  title: string;
  summary: string;
} {
  const conclusion = githubCheckConclusion(review);
  return {
    conclusion,
    title: `Workbench: ${review.head.score}/100 (${review.scoreDelta >= 0 ? "+" : ""}${review.scoreDelta}) · risk ${review.risk.level}`,
    summary: review.decision.reasons.join("; "),
  };
}

function escapeData(s: string): string {
  // Escape per GitHub workflow-command rules.
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * Render `::error`/`::warning::` workflow commands, one per regression, file-
 * annotated when the package root is known. Printing these to stdout in a GitHub
 * Action surfaces them as inline PR annotations.
 */
export function githubAnnotations(
  review: PrReview,
  packageRoots: Record<string, string> = {},
): string[] {
  const lines: string[] = [];
  for (const r of review.delta.regressions) {
    const level = r.severity === "critical" ? "error" : "warning";
    const root = r.packageId ? packageRoots[r.packageId] : undefined;
    const file = root ? `file=${root}/package.json,` : "";
    lines.push(
      `::${level} ${file}title=Package Workbench::${escapeData(r.detail)}`,
    );
  }
  if (review.decision.recommendation === "block") {
    lines.push(
      `::error title=Package Workbench::Merge blocked — ${escapeData(review.decision.reasons.join("; "))}`,
    );
  }
  return lines;
}

/** Markdown suitable for `$GITHUB_STEP_SUMMARY`. Reuses the PR comment body. */
export function githubJobSummary(review: PrReview, body: string): string {
  const emoji =
    review.decision.recommendation === "block"
      ? "⛔"
      : review.decision.recommendation === "warn"
        ? "⚠️"
        : "✅";
  return `${emoji} **${review.decision.recommendation.toUpperCase()}** — risk ${review.risk.level}\n\n${body}`;
}
