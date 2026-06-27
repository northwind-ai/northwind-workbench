import type { DiffReport, DiffRiskLevel } from "./types";

/**
 * Render a diff-intelligence report as text / Markdown. Pure formatting.
 */

const RISK_BADGE: Record<DiffRiskLevel, string> = {
  low: "🟢 Low",
  medium: "🟡 Medium",
  high: "🟠 High",
  critical: "🔴 Critical",
};

export function renderDiffText(report: DiffReport): string {
  const L: string[] = [];
  L.push(`Changed files (${report.changedFiles.length}):`);
  for (const f of report.changedFiles.slice(0, 20))
    L.push(`  ${statusMark(f.status)} ${f.path}`);
  if (report.changedFiles.length > 20)
    L.push(`  … ${report.changedFiles.length - 20} more`);
  L.push("");

  const edited = report.changedPackages.filter((c) => c.reason === "edited");
  const impacted = report.changedPackages.filter(
    (c) => c.reason === "dependency",
  );
  L.push(`Changed packages (${edited.length}):`);
  for (const c of edited)
    L.push(
      `  • ${c.name}  (${c.changedFiles.length} file(s), ${c.dependents} dependents)`,
    );
  L.push("");
  L.push(`Impacted packages (${impacted.length}):`);
  for (const c of impacted.slice(0, 20)) L.push(`  ↳ ${c.name}`);
  L.push("");

  L.push(`Risk: ${RISK_BADGE[report.risk.level]} (${report.risk.score}/100)`);
  L.push(`Reason: ${report.risk.reason}`);
  L.push("");

  if (report.predictedRegressions.length) {
    L.push("Predicted regressions:");
    for (const r of report.predictedRegressions)
      L.push(`  - [${r.likelihood}] ${r.kind.replace(/_/g, " ")}: ${r.detail}`);
    L.push("");
  }

  L.push(
    `Suggested scan: ${report.scanPlan.length} package(s) — skipping ${Math.round(report.scanSavings * 100)}% of the workspace.`,
  );
  return L.join("\n");
}

export function renderDiffMarkdown(report: DiffReport): string {
  const L: string[] = ["# Diff Intelligence", ""];
  L.push(
    `**Risk: ${RISK_BADGE[report.risk.level]}** (${report.risk.score}/100) — ${report.risk.reason}`,
    "",
  );

  L.push("## Changed files", "");
  for (const f of report.changedFiles)
    L.push(`- \`${statusMark(f.status)}\` ${f.path}`);
  L.push("");

  L.push("## Blast radius", "");
  L.push(
    `- **${report.blastRadius.edited.length}** edited → **${report.blastRadius.impacted.length}** impacted (${Math.round(report.blastRadius.coverage * 100)}% of workspace)`,
  );
  if (report.changedPackages.length) {
    L.push(
      "",
      "| Package | Reason | Dependents | Centrality |",
      "| --- | --- | ---: | ---: |",
    );
    for (const c of report.changedPackages.slice(0, 20))
      L.push(
        `| ${c.name} | ${c.reason} | ${c.dependents} | ${c.centrality.toFixed(2)} |`,
      );
  }
  L.push("");

  if (report.predictedRegressions.length) {
    L.push("## Predicted regressions", "");
    for (const r of report.predictedRegressions)
      L.push(
        `- **[${r.likelihood}]** ${r.kind.replace(/_/g, " ")} — ${r.detail}`,
      );
    L.push("");
  }

  L.push("## Suggested scan", "");
  L.push(
    `Run only ${report.scanPlan.length} package(s) — **${Math.round(report.scanSavings * 100)}%** of the workspace skipped.`,
    "",
  );
  for (const item of report.scanPlan)
    L.push(
      `- \`${item.packageId}\`: ${item.checks.join(", ")} — _${item.reason}_`,
    );
  return L.join("\n").trimEnd();
}

function statusMark(status: string): string {
  return status === "added"
    ? "A"
    : status === "deleted"
      ? "D"
      : status === "renamed"
        ? "R"
        : "M";
}
