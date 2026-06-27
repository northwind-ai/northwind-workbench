import type { GraphMutation, SimulationResult } from "./types";

/**
 * Export a simulation as JSON, a Markdown refactor plan, or an architecture diff
 * report. Pure string formatting.
 */

export function exportSimulationJson(result: SimulationResult): string {
  return JSON.stringify(result, null, 2);
}

function describeMutation(m: GraphMutation): string {
  switch (m.type) {
    case "add_edge":
      return `Add dependency ${m.from} → ${m.to}`;
    case "remove_edge":
      return `Remove dependency ${m.from} → ${m.to}`;
    case "move_node":
      return `Reposition ${m.id}`;
    case "split_node":
      return `Split ${m.id} into ${m.parts.types}, ${m.parts.runtime}, ${m.parts.services}`;
    case "merge_nodes":
      return `Merge ${m.ids.join(", ")} into ${m.into}`;
    case "add_boundary":
      return `Add boundary: ${m.from} cannot depend on ${m.cannotDependOn.join(", ")}`;
  }
}

function impactBullets(result: SimulationResult): string[] {
  const i = result.impact;
  const out: string[] = [];
  if (i.cycleReduction !== 0)
    out.push(
      `Cycles ${result.before.cycleCount} → ${result.after.cycleCount} (${i.cycleReduction > 0 ? "−" : "+"}${Math.abs(i.cycleReduction)})`,
    );
  if (i.scoreDelta !== 0)
    out.push(
      `Health ${result.before.healthScore} → ${result.after.healthScore} (${i.scoreDelta >= 0 ? "+" : ""}${i.scoreDelta})`,
    );
  if (i.violationReduction !== 0)
    out.push(
      `Violations ${result.before.violationCount} → ${result.after.violationCount}`,
    );
  if (i.nodeDelta !== 0)
    out.push(`Packages ${result.before.nodeCount} → ${result.after.nodeCount}`);
  if (out.length === 0) out.push("No structural change");
  return out;
}

/** A human refactor plan derived from the simulated mutations + recomputed impact. */
export function exportSimulationMarkdown(result: SimulationResult): string {
  const L: string[] = ["# Simulated Refactor Plan", ""];
  L.push("## Changes", "");
  result.mutations.forEach((m, i) =>
    L.push(`${i + 1}. ${describeMutation(m)}`),
  );
  L.push("");
  L.push("## Predicted impact", "");
  for (const b of impactBullets(result)) L.push(`- ${b}`);
  return L.join("\n").trimEnd();
}

/** A focused before/after architecture-diff report. */
export function exportArchitectureDiff(result: SimulationResult): string {
  const L: string[] = ["# Architecture Diff", ""];
  L.push("| Metric | Before | After |", "| --- | ---: | ---: |");
  L.push(
    `| Health | ${result.before.healthScore} (${result.before.grade}) | ${result.after.healthScore} (${result.after.grade}) |`,
  );
  L.push(
    `| Cycles | ${result.before.cycleCount} | ${result.after.cycleCount} |`,
  );
  L.push(
    `| Violations | ${result.before.violationCount} | ${result.after.violationCount} |`,
  );
  L.push(
    `| Packages | ${result.before.nodeCount} | ${result.after.nodeCount} |`,
  );
  L.push(`| Edges | ${result.before.edgeCount} | ${result.after.edgeCount} |`);
  L.push("");
  if (result.changedEdges.length) {
    L.push("## Changed edges", "");
    for (const e of result.changedEdges)
      L.push(`- ${e.change === "added" ? "+" : "−"} ${e.from} → ${e.to}`);
  }
  return L.join("\n").trimEnd();
}
