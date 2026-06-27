import type { Bottleneck, PerformanceReport } from "./types";

/**
 * Render a performance report as text / Markdown. Pure formatting.
 */

const ms = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;
const kb = (b: number): string => `${Math.round(b / 1024)} KB`;
const CATEGORY_LABEL: Record<Bottleneck["category"], string> = {
  build: "Build",
  runtime: "Runtime",
  memory: "Memory",
  dependency: "Dependency",
  ci: "CI",
};

export function renderPerfText(report: PerformanceReport): string {
  const L: string[] = [];
  const build = report.bottlenecks.find((b) => b.category === "build");
  if (build) {
    L.push(
      "Performance Report:",
      `Build Bottleneck:`,
      `  ${build.subject}`,
      "",
      `Contribution:`,
      `  ${build.value}  (${build.detail})`,
      "",
    );
  }

  L.push("Bottlenecks:");
  for (const b of report.bottlenecks)
    L.push(
      `  [${CATEGORY_LABEL[b.category]}] ${b.subject} — ${b.metric}: ${b.value}  (${b.detail})`,
    );
  L.push("");

  if (report.regressions.length) {
    L.push("Regressions:");
    for (const r of report.regressions.slice(0, 8))
      L.push(`  ✗ [${r.severity}] ${r.detail}`);
    L.push("");
  }

  const t = report.snapshot.totals;
  L.push(
    `Totals: ${kb(t.bundleBytes)} bundle · ${ms(t.checkMs)} checks · ${ms(t.scenarioMs)} scenarios${t.buildMs ? ` · ${ms(t.buildMs)} build` : ""}`,
  );
  return L.join("\n");
}

export function renderPerfMarkdown(report: PerformanceReport): string {
  const L: string[] = ["# Performance Report", ""];

  L.push(
    "## Bottlenecks",
    "",
    "| Category | Subject | Metric | Value | Detail |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const b of report.bottlenecks)
    L.push(
      `| ${CATEGORY_LABEL[b.category]} | ${b.subject} | ${b.metric} | ${b.value} | ${b.detail} |`,
    );
  L.push("");

  if (report.regressions.length) {
    L.push("## Regressions", "");
    for (const r of report.regressions)
      L.push(`- **[${r.severity}]** ${r.detail} (${r.before} → ${r.after})`);
    L.push("");
  }

  L.push(
    "## Build hotspots",
    "",
    "| Package | Build cost | Bundle | Checks |",
    "| --- | ---: | ---: | ---: |",
  );
  for (const p of [...report.snapshot.packages]
    .sort((a, b) => b.build.contribution - a.build.contribution)
    .slice(0, 10)) {
    const buildVal =
      p.build.measured && p.build.durationMs != null
        ? ms(p.build.durationMs)
        : `${Math.round(p.build.contribution * 100)}%`;
    L.push(
      `| ${p.name} | ${buildVal} | ${kb(p.bundleBytes)} | ${ms(p.checkMs)} |`,
    );
  }
  L.push("");

  if (report.snapshot.dependencyCosts.length) {
    L.push("## Heaviest dependencies", "");
    for (const d of report.snapshot.dependencyCosts)
      L.push(`- **${d.dependency}** _(${d.kind})_ — ${d.detail}`);
    L.push("");
  }

  L.push("## Most expensive checks", "");
  for (const c of report.snapshot.checkCosts.slice(0, 8))
    L.push(
      `- \`${c.checkId}\` — ${ms(c.totalMs)} total (${c.count} run(s), avg ${ms(c.avgMs)})`,
    );
  return L.join("\n").trimEnd();
}
