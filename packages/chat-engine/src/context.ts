import type { DependencyGraph } from "@package-workbench/plugin-sdk";
import type { PackageHealthReport } from "@package-workbench/core";
import type {
  FocusedPackage,
  Intent,
  RetrievedContext,
  WorkbenchKnowledge,
} from "./types";

/**
 * Context retrieval: select the *relevant slice* of knowledge for a question —
 * never the whole repo. This keeps heuristic reasoning focused and (for an LLM)
 * the prompt small. Pure + deterministic.
 *
 * Resolution order for the question's subject: explicit entities → session focus
 * → a sensible default for the intent (e.g. the worst package for a failure
 * query). The chosen focus + its graph neighbourhood + relevant regressions are
 * compressed into a {@link RetrievedContext}.
 */

export function retrieveContext(
  intent: Intent,
  knowledge: WorkbenchKnowledge,
  sessionFocus: string[] = [],
): RetrievedContext {
  const notes: string[] = [];
  const reports = knowledge.run.reports;

  let focusIds = intent.entities;
  if (focusIds.length === 0 && sessionFocus.length > 0) {
    focusIds = sessionFocus.filter((id) =>
      reports.some((r) => r.package.id === id),
    );
    if (focusIds.length)
      notes.push(`Using prior focus: ${focusIds.join(", ")}`);
  }
  if (focusIds.length === 0) {
    focusIds = defaultFocus(intent, knowledge);
    if (focusIds.length)
      notes.push("No package named — using the most relevant package(s).");
  }

  const focus = focusIds
    .map((id) => reports.find((r) => r.package.id === id))
    .filter((r): r is PackageHealthReport => Boolean(r))
    .map((r) => toFocused(r, knowledge.graph));

  const related =
    intent.type === "dependency" || intent.type === "architecture"
      ? relatedPackages(focusIds, knowledge.graph)
      : [];
  const cycles = (knowledge.graph?.cycles ?? [])
    .filter(
      (c) => focusIds.length === 0 || c.cycle.some((p) => focusIds.includes(p)),
    )
    .map((c) => c.cycle);

  const allReg = knowledge.delta?.regressions ?? [];
  const regressions =
    focusIds.length > 0
      ? allReg.filter((r) => !r.packageId || focusIds.includes(r.packageId))
      : allReg;

  if (!knowledge.graph)
    notes.push(
      "Dependency graph not available — architecture answers are limited.",
    );
  if (!knowledge.delta)
    notes.push("No baseline delta — regression answers are limited.");

  return { intent, focus, related, regressions, cycles, notes };
}

function toFocused(
  report: PackageHealthReport,
  graph: DependencyGraph | undefined,
): FocusedPackage {
  const issues = report.checks
    .filter((c) => c.status === "fail" || c.status === "warn")
    .map((c) => c.summary);
  const cycleCount =
    graph?.cycles.filter(
      (c) =>
        c.cycle.includes(report.package.id) ||
        c.affected.includes(report.package.id),
    ).length ?? 0;
  if (cycleCount > 0) issues.unshift(`${cycleCount} circular dependency(ies)`);
  return {
    id: report.package.id,
    name: report.package.name,
    score: report.score,
    status: report.status,
    runtime: report.package.runtime,
    issues,
    scenarioFailures: report.scenarios?.failed ?? 0,
  };
}

function relatedPackages(
  focusIds: string[],
  graph: DependencyGraph | undefined,
): RetrievedContext["related"] {
  if (!graph || focusIds.length === 0) return [];
  const out: RetrievedContext["related"] = [];
  const focus = new Set(focusIds);
  for (const e of graph.edges) {
    if (e.from === e.to) continue;
    if (focus.has(e.to))
      out.push({ id: e.from, relation: "dependent", via: e.to });
    if (focus.has(e.from))
      out.push({ id: e.to, relation: "dependency", via: e.from });
  }
  // Dedupe by id+relation.
  const seen = new Set<string>();
  return out.filter((r) => {
    const key = `${r.id}:${r.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A sensible default subject when the question names no package. */
function defaultFocus(intent: Intent, knowledge: WorkbenchKnowledge): string[] {
  const reports = knowledge.run.reports;
  if (reports.length === 0) return [];
  switch (intent.type) {
    case "failure":
    case "health": {
      // The worst-scoring package.
      const worst = [...reports].sort((a, b) => a.score - b.score)[0]!;
      return worst.score < 100 ? [worst.package.id] : [];
    }
    case "refactor":
    case "architecture": {
      const top = knowledge.refactor?.suggestions[0];
      return top ? top.targetPackages.slice(0, 1) : [];
    }
    default:
      return [];
  }
}
