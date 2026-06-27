import { renderPatchDiff } from "./diff";
import type { FixCandidate, FixPlan, FixSafetyLevel } from "./types";

/**
 * Rendering for the `fix` CLI: a safety-grouped plan with per-fix diffs. Pure
 * string formatting. The wording makes the safety contract obvious — only `safe`
 * fixes apply without `--apply` confirmation of review items.
 */

const SAFETY_ICON: Record<FixSafetyLevel, string> = {
  safe: "✅ safe",
  review_required: "⚠️ review",
  dangerous: "⛔ suggest-only",
};

export function renderFixText(
  plan: FixPlan,
  opts: { showDiff?: boolean } = {},
): string {
  const L: string[] = [];
  L.push(
    `Auto Fix — ${plan.summary.safe} safe · ${plan.summary.reviewRequired} review · ${plan.summary.dangerous} suggest-only`,
    "",
  );
  if (plan.candidates.length === 0) {
    L.push("No fixable issues detected. ✓");
    return L.join("\n");
  }
  for (const c of plan.candidates) {
    L.push(`${SAFETY_ICON[c.safety]}  ${c.title}`);
    L.push(`   Issue: ${c.problem}`);
    L.push(`   Fix:   ${c.description}`);
    for (const e of c.evidence) L.push(`   · ${e}`);
    if (opts.showDiff)
      for (const p of c.patches) L.push(indent(renderPatchDiff(p)));
    L.push("");
  }
  L.push("Apply safe fixes with:  package-workbench fix --apply <path>");
  return L.join("\n");
}

export function renderFixMarkdown(plan: FixPlan): string {
  const L: string[] = [
    "# Auto Fix Plan",
    "",
    `_${plan.summary.safe} safe · ${plan.summary.reviewRequired} review-required · ${plan.summary.dangerous} suggest-only_`,
    "",
  ];
  for (const group of ["safe", "review_required", "dangerous"] as const) {
    const items = plan.candidates.filter((c) => c.safety === group);
    if (items.length === 0) continue;
    L.push(`## ${SAFETY_ICON[group]}`, "");
    for (const c of items) L.push(...renderCandidateMd(c));
  }
  return L.join("\n").trimEnd();
}

function renderCandidateMd(c: FixCandidate): string[] {
  const L: string[] = [
    `### ${c.title}`,
    "",
    `- **Issue:** ${c.problem}`,
    `- **Fix:** ${c.description}`,
  ];
  for (const e of c.evidence) L.push(`- _${e}_`);
  L.push("");
  for (const p of c.patches) {
    L.push("```diff", renderPatchDiff(p), "```", "");
  }
  return L;
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => `     ${l}`)
    .join("\n");
}
