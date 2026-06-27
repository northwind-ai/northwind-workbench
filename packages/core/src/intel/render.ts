import type {
  PackageIntelligenceReport,
  ExportUsageReport,
  SizeReport,
} from "./types";

/**
 * Markdown renderers for the `api` and `size` CLI commands. Pure formatting.
 * Wording stays conservative: deletion is suggested only for `definitely-dead`
 * exports (private package, no usage), everything else is "review / public API".
 */

const KB = 1024;
function kb(bytes: number): string {
  return `${Math.round(bytes / KB)} KB`;
}

export function renderApiMarkdown(report: PackageIntelligenceReport): string {
  const L: string[] = ["# API Surface Report", ""];
  for (const u of report.usage) {
    if (u.exports.length === 0) continue;
    L.push(
      `## ${u.packageName}${u.private ? " _(private)_" : " _(public)_"}`,
      "",
    );
    L.push(usageSummaryLine(u), "");
    const flagged = u.exports.filter((e) => e.usageClass !== "used");
    if (flagged.length === 0) {
      L.push("_All exports are used internally._", "");
      continue;
    }
    L.push(
      "| Export | Kind | Class | Confidence | Note |",
      "| --- | --- | --- | ---: | --- |",
    );
    for (const e of flagged.slice(0, 40)) {
      L.push(
        `| \`${e.symbol.name}\` | ${e.symbol.kind} | ${e.usageClass} | ${Math.round(e.confidence * 100)}% | ${e.note} |`,
      );
    }
    if (u.staleReExports.length) {
      L.push("", `**Stale re-exports:** ${u.staleReExports.length}`);
      for (const s of u.staleReExports.slice(0, 10))
        L.push(`- \`${s.file}\` ← ${s.from}`);
    }
    L.push("");
  }
  return L.join("\n").trimEnd();
}

export function usageSummaryLine(u: ExportUsageReport): string {
  const s = u.summary;
  return `${u.exports.length} export(s) · ${s.used} used · ${s["public-api-unknown"]} public-api-unknown · ${s["likely-dead"]} likely-dead · ${s["definitely-dead"]} definitely-dead`;
}

export function renderSizeMarkdown(report: PackageIntelligenceReport): string {
  const L: string[] = ["# Size Report", ""];
  const measured = report.sizes.filter((s) => s.measured);
  if (measured.length === 0)
    L.push(
      "_No packages with build output were found. Build first, then re-measure._",
      "",
    );

  for (const s of [...measured].sort((a, b) => b.totalBytes - a.totalBytes)) {
    L.push(`## ${s.packageName}`, "");
    L.push(
      `- **Output:** \`${s.outputDir}\` · ${kb(s.totalBytes)}${s.gzipBytes ? ` (${kb(s.gzipBytes)} gzip)` : ""} across ${s.fileCount} file(s)`,
    );
    if (s.delta)
      L.push(
        `- **Δ vs baseline:** ${s.delta.deltaBytes >= 0 ? "+" : ""}${kb(s.delta.deltaBytes)}`,
      );
    if (s.heavyClientDeps.length)
      L.push(`- **Heavy client deps:** ${s.heavyClientDeps.join(", ")}`);
    if (s.largestFiles.length) {
      L.push("- **Largest files:**");
      for (const f of s.largestFiles)
        L.push(
          `  - \`${f.file}\` — ${kb(f.bytes)}${f.gzipBytes ? ` (${kb(f.gzipBytes)} gzip)` : ""}`,
        );
    }
    L.push("");
  }

  if (report.duplicateVersions.length) {
    L.push("## Duplicate dependency versions", "");
    for (const d of report.duplicateVersions.slice(0, 20))
      L.push(
        `- **${d.dependency}** — ${d.versions.join(", ")} (in ${d.packages.length} package(s))`,
      );
    L.push("");
  }
  return L.join("\n").trimEnd();
}

/** A compact size summary for one package (status bar / tab label). */
export function sizeHeadline(s: SizeReport): string {
  return s.measured
    ? `${kb(s.totalBytes)}${s.gzipBytes ? ` (${kb(s.gzipBytes)} gz)` : ""}`
    : "not built";
}
