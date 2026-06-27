import type { RunDelta } from "@package-workbench/plugin-sdk";
import type { WorkbenchRun } from "../types";

/**
 * Human-readable report generation in JSON / Markdown / HTML. Sections:
 * Executive Summary, Package Health, Failures, Dependency Graph Summary,
 * Scenario Results, and (when a baseline exists) Regression Summary.
 */

export type ReportFormat = "json" | "markdown" | "html";

export interface ReportInput {
  run: WorkbenchRun;
  delta?: RunDelta | null;
  title?: string;
  generatedAt?: string;
}

interface StructuredReport {
  title: string;
  generatedAt: string;
  executive: {
    workspace: string;
    packages: number;
    averageScore: number;
    passed: number;
    warned: number;
    failed: number;
    graphGrade?: string;
  };
  packages: Array<{ name: string; score: number; status: string }>;
  failures: Array<{ package: string; check: string; summary: string }>;
  graph?: {
    score: number;
    grade: string;
    cycles: number;
    violations: number;
    smells: number;
  } | null;
  scenarios?: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
  } | null;
  regression?: {
    summary: string;
    scoreDelta: number;
    regressions: RunDelta["regressions"];
    improvements: RunDelta["improvements"];
  } | null;
}

function structured(input: ReportInput): StructuredReport {
  const { run } = input;
  const failures = run.reports.flatMap((r) =>
    r.checks
      .filter((c) => c.status === "fail")
      .map((c) => ({
        package: r.package.name,
        check: c.checkId,
        summary: c.summary,
      })),
  );
  const scenarioRuns = run.reports
    .map((r) => r.scenarios)
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  const scenarios = scenarioRuns.length
    ? scenarioRuns.reduce(
        (acc, s) => ({
          total: acc.total + s.total,
          passed: acc.passed + s.passed,
          failed: acc.failed + s.failed,
          passRate: 0,
        }),
        { total: 0, passed: 0, failed: 0, passRate: 0 },
      )
    : null;
  if (scenarios)
    scenarios.passRate = scenarios.total
      ? scenarios.passed / scenarios.total
      : 1;

  return {
    title: input.title ?? "Package Workbench Report",
    generatedAt: input.generatedAt ?? run.finishedAt,
    executive: {
      workspace: run.workspace.name ?? run.workspace.root,
      packages: run.summary.totalPackages,
      averageScore: run.summary.averageScore,
      passed: run.summary.passed,
      warned: run.summary.warned,
      failed: run.summary.failed,
      graphGrade: run.graph?.health.grade,
    },
    packages: run.reports.map((r) => ({
      name: r.package.name,
      score: r.score,
      status: r.status,
    })),
    failures,
    graph: run.graph
      ? {
          score: run.graph.health.score,
          grade: run.graph.health.grade,
          cycles: run.graph.cycles.length,
          violations: run.graph.violations.length,
          smells: run.graph.smells.length,
        }
      : null,
    scenarios,
    regression: input.delta
      ? {
          summary: input.delta.summary,
          scoreDelta: input.delta.scoreDelta,
          regressions: input.delta.regressions,
          improvements: input.delta.improvements,
        }
      : null,
  };
}

const ICON: Record<string, string> = { pass: "✅", warn: "⚠️", fail: "❌" };

function markdown(r: StructuredReport): string {
  const L: string[] = [];
  L.push(`# ${r.title}`, "", `_Generated ${r.generatedAt}_`, "");
  L.push("## Executive Summary", "");
  L.push(`- **Workspace:** ${r.executive.workspace}`);
  L.push(`- **Packages:** ${r.executive.packages}`);
  L.push(`- **Average health:** ${r.executive.averageScore}/100`);
  L.push(
    `- **Status:** ${r.executive.passed} passed · ${r.executive.warned} warned · ${r.executive.failed} failed`,
  );
  if (r.executive.graphGrade)
    L.push(`- **Graph grade:** ${r.executive.graphGrade}`);
  L.push("");

  L.push(
    "## Package Health",
    "",
    "| Package | Score | Status |",
    "| --- | ---: | :---: |",
  );
  for (const p of [...r.packages].sort((a, b) => a.score - b.score))
    L.push(`| ${p.name} | ${p.score} | ${ICON[p.status] ?? p.status} |`);
  L.push("");

  L.push("## Failures", "");
  if (r.failures.length === 0) L.push("_None._");
  else
    for (const f of r.failures)
      L.push(`- **${f.package}** — \`${f.check}\`: ${f.summary}`);
  L.push("");

  L.push("## Dependency Graph Summary", "");
  if (!r.graph) L.push("_Not analyzed._");
  else
    L.push(
      `- Health: **${r.graph.score}/100 (${r.graph.grade})**`,
      `- Cycles: ${r.graph.cycles}`,
      `- Boundary violations: ${r.graph.violations}`,
      `- Smells: ${r.graph.smells}`,
    );
  L.push("");

  L.push("## Scenario Results", "");
  if (!r.scenarios) L.push("_No scenarios run._");
  else
    L.push(
      `- ${r.scenarios.passed}/${r.scenarios.total} passed (${Math.round(r.scenarios.passRate * 100)}%)`,
    );
  L.push("");

  if (r.regression) {
    L.push("## Regression Summary", "", r.regression.summary, "");
    if (r.regression.regressions.length) {
      L.push("### Regressions");
      for (const reg of r.regression.regressions)
        L.push(`- **[${reg.severity}]** ${reg.detail}`);
      L.push("");
    }
    if (r.regression.improvements.length) {
      L.push("### Improvements");
      for (const imp of r.regression.improvements) L.push(`- ${imp.detail}`);
      L.push("");
    }
  }
  return L.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!,
  );
}

function html(r: StructuredReport): string {
  // Render the markdown body as <pre> inside a minimal styled document — fully
  // self-contained (no external assets), suitable for CI artifact upload.
  const body = escapeHtml(markdown(r));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(r.title)}</title>
<style>
  body { font: 14px/1.6 -apple-system, Segoe UI, Roboto, sans-serif; max-width: 860px; margin: 40px auto; padding: 0 20px; color: #111827; }
  pre { white-space: pre-wrap; }
  .badge { display:inline-block; padding:2px 10px; border-radius:999px; color:#fff; font-weight:700; }
</style></head>
<body>
<h1>${escapeHtml(r.title)}</h1>
<p>Average health <span class="badge" style="background:${r.executive.averageScore >= 80 ? "#1f9d55" : r.executive.averageScore >= 60 ? "#d97706" : "#dc2626"}">${r.executive.averageScore}/100</span></p>
<pre>${body}</pre>
</body></html>`;
}

/** Render a report in the requested format. */
export function renderReport(input: ReportInput, format: ReportFormat): string {
  const report = structured(input);
  if (format === "json") return JSON.stringify(report, null, 2);
  if (format === "html") return html(report);
  return markdown(report);
}
