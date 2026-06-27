import type { InventoryResult } from "./analyze";

/**
 * Render the inventory + debt as text / Markdown / HTML. Pure formatting.
 */

export function renderInventoryText(result: InventoryResult): string {
  const t = result.inventory.totals;
  const L: string[] = [];
  L.push("Repository Inventory:");
  L.push(`  Packages: ${t.packages}`);
  L.push(`  Apps: ${t.apps}`);
  L.push(`  Libraries: ${t.libraries}`);
  L.push(`  Experimental: ${t.experimental}`);
  L.push(`  Orphaned: ${t.orphaned}`);
  L.push(`  Dead: ${t.dead}`);
  L.push(`  Deprecated: ${t.deprecated}`);
  L.push(`  High-Risk (debt ≥ 60): ${t.highDebt}`);
  L.push("");
  L.push("Top technical debt:");
  for (const r of result.debt.ranking.slice(0, 10))
    L.push(
      `  ${String(r.debtScore).padStart(3)}  ${r.name}  (${r.topFindings.map((f) => f.kind).join(", ") || "—"})`,
    );
  if (result.debt.incomplete.length) {
    L.push("", "Incomplete features:");
    for (const i of result.debt.incomplete.slice(0, 8))
      L.push(
        `  ! ${i.packageId}: ${i.finding.file}:${i.finding.line ?? "?"} — ${i.finding.detail}`,
      );
  }
  return L.join("\n");
}

export function renderInventoryMarkdown(result: InventoryResult): string {
  const t = result.inventory.totals;
  const L: string[] = ["# Repository Inventory", ""];
  L.push("| Metric | Count |", "| --- | ---: |");
  L.push(
    `| Packages | ${t.packages} |`,
    `| Apps | ${t.apps} |`,
    `| Libraries | ${t.libraries} |`,
    `| Experimental | ${t.experimental} |`,
    `| Orphaned | ${t.orphaned} |`,
    `| Dead | ${t.dead} |`,
    `| Deprecated | ${t.deprecated} |`,
    `| High-risk (debt ≥ 60) | ${t.highDebt} |`,
  );
  L.push("");

  L.push(
    "## Technical debt ranking",
    "",
    "| Package | Debt | Status | Coverage | Findings |",
    "| --- | ---: | --- | --- | --- |",
  );
  const byId = new Map(result.inventory.packages.map((p) => [p.id, p]));
  for (const r of result.debt.ranking.slice(0, 20)) {
    const p = byId.get(r.id)!;
    L.push(
      `| ${r.name} | ${r.debtScore} | ${p.status} | ${p.coverage} | ${r.topFindings.map((f) => f.kind).join(", ") || "—"} |`,
    );
  }
  L.push("");

  if (result.debt.deadPackages.length) {
    L.push(
      "## Suspected dead packages",
      "",
      "_Conservative: private, no dependents, no recent activity._",
      "",
    );
    for (const id of result.debt.deadPackages) L.push(`- ${id}`);
    L.push("");
  }

  if (result.debt.incomplete.length) {
    L.push("## Incomplete features", "");
    for (const i of result.debt.incomplete)
      L.push(
        `- \`${i.packageId}\` ${i.finding.file}:${i.finding.line ?? "?"} — ${i.finding.detail}`,
      );
    L.push("");
  }

  const kinds = Object.entries(result.debt.byKind).sort((a, b) => b[1] - a[1]);
  if (kinds.length) {
    L.push("## Debt markers", "");
    for (const [kind, count] of kinds)
      L.push(`- ${kind.replace(/_/g, " ")}: ${count}`);
  }
  return L.join("\n").trimEnd();
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!,
  );
}

export function renderInventoryHtml(result: InventoryResult): string {
  const body = escapeHtml(renderInventoryMarkdown(result));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Repository Inventory</title>
<style>body{font:14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#111827}pre{white-space:pre-wrap}</style>
</head><body><h1>Repository Inventory</h1><pre>${body}</pre></body></html>`;
}
