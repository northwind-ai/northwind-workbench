import type { RefactorPlan, RefactorSuggestion } from "./types";

/**
 * Renderers for the Refactor Architect. The text form matches the product's
 * "Problem → Suggested refactor → Expected impact" presentation; the markdown
 * form is the full plan for the CLI / reports. Pure string formatting.
 */

function impactBullets(s: RefactorSuggestion): string[] {
  const i = s.impact;
  const out: string[] = [];
  if (i.cycleReduction > 0)
    out.push(
      `reduce cycles by ${Math.round(i.cycleReductionPct * 100)}% (${i.cycleReduction})`,
    );
  if (i.fanOutReduction > 0)
    out.push(
      `reduce fan-out by ${Math.round(i.fanOutReductionPct * 100)}% (${i.fanOutReduction})`,
    );
  if (i.healthScoreDelta !== 0)
    out.push(
      `improve health score ${i.healthScoreDelta >= 0 ? "+" : ""}${i.healthScoreDelta}`,
    );
  if (i.dependencyReduction > 0)
    out.push(`remove ${i.dependencyReduction} internal dependency edge(s)`);
  return out.length ? out : ["marginal structural improvement"];
}

/** The headline product experience: top problem + suggested refactor + impact. */
export function renderRefactorText(plan: RefactorPlan): string {
  const top = plan.suggestions[0];
  if (!top) {
    return [
      "No conservative refactor improves the architecture right now.",
      "",
      plan.summary,
    ].join("\n");
  }
  const L: string[] = [];
  L.push("Problem:");
  L.push(`  ${top.problem.evidence[0] ?? top.problem.detail}`, "");
  L.push("AI Refactor Architect:");
  L.push("Suggested refactor:", `  ${top.title}`);
  if (top.newPackages.length)
    for (const p of top.newPackages) L.push(`  - ${p}`);
  L.push("");
  L.push("Expected impact:");
  for (const b of impactBullets(top)) L.push(`  - ${b}`);
  L.push("");
  L.push(
    `Risk: ${top.risk.level} (${top.risk.effort} effort, ~${top.risk.affectedPackages} package(s) affected)`,
  );
  return L.join("\n");
}

export function renderRefactorMarkdown(plan: RefactorPlan): string {
  const L: string[] = ["# AI Refactor Architect", "", `_${plan.summary}_`, ""];

  L.push("## Architectural problems", "");
  if (plan.problems.length === 0) L.push("_None detected._", "");
  for (const p of plan.problems.slice(0, 12)) {
    L.push(`- **[${p.severity}] ${p.kind.replace(/_/g, " ")}** — ${p.detail}`);
    for (const e of p.evidence) L.push(`  - _${e}_`);
  }
  L.push("");

  L.push("## Ranked refactor suggestions", "");
  if (plan.suggestions.length === 0) {
    L.push("_No conservative refactor improves the graph._", "");
    return L.join("\n").trimEnd();
  }
  plan.suggestions.forEach((s, idx) => {
    L.push(`### ${idx + 1}. ${s.title}`, "");
    L.push(
      `- **Strategy:** ${s.strategy.replace(/_/g, " ")} · **Score:** ${s.score} · **Risk:** ${s.risk.level} (${s.risk.effort})`,
      "",
    );
    L.push("**Expected impact:**");
    for (const b of impactBullets(s)) L.push(`- ${b}`);
    L.push("");
    L.push("**Why it helps:**", `- ${s.explanation.howItHelps}`, "");
    L.push("**Steps:**");
    s.steps.forEach((step, i) => L.push(`${i + 1}. ${step}`));
    L.push("");
    L.push("**Tradeoffs:**");
    for (const t of s.explanation.tradeoffs) L.push(`- ${t}`);
    L.push("");
    L.push("**Evidence:**");
    for (const e of s.explanation.evidence) L.push(`- ${e}`);
    L.push("");
    L.push(
      `**Before → After:** health ${s.visualization.before.healthScore} → ${s.visualization.after.healthScore} · cycles ${s.visualization.before.cycleCount} → ${s.visualization.after.cycleCount}`,
      "",
    );
  });
  return L.join("\n").trimEnd();
}
