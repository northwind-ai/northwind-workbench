import type {
  BoundaryRule,
  BoundaryViolation,
  DependencyEdge,
  DependencyNode,
} from "@package-workbench/plugin-sdk";

/**
 * The boundary rule engine. Each rule matches a set of source packages (`from`)
 * and either denies (`cannotDependOn`) or restricts (`canOnlyDependOn`) their
 * targets. Matchers support exact names, `*` globs, and `tag:` selectors.
 */

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** Does `node` match a single matcher pattern? */
function matches(node: DependencyNode, pattern: string): boolean {
  if (pattern.startsWith("tag:")) return node.tags.includes(pattern.slice(4));
  if (pattern.includes("*"))
    return (
      globToRegExp(pattern).test(node.id) ||
      globToRegExp(pattern).test(node.name)
    );
  return node.id === pattern || node.name === pattern;
}

const anyMatch = (node: DependencyNode, patterns: string[]): boolean =>
  patterns.some((p) => matches(node, p));

/** Evaluate boundary rules against the graph's edges. */
export function evaluateBoundaries(
  nodes: DependencyNode[],
  edges: DependencyEdge[],
  rules: BoundaryRule[],
): BoundaryViolation[] {
  if (rules.length === 0) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const violations: BoundaryViolation[] = [];

  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;

    for (const rule of rules) {
      if (!matches(from, rule.from)) continue;

      const deniedByList =
        rule.cannotDependOn && anyMatch(to, rule.cannotDependOn);
      const outsideAllow =
        rule.canOnlyDependOn && !anyMatch(to, rule.canOnlyDependOn);
      if (!deniedByList && !outsideAllow) continue;

      violations.push({
        from: edge.from,
        to: edge.to,
        rule:
          rule.description ??
          (deniedByList
            ? `${rule.from} cannot depend on ${edge.to}`
            : `${rule.from} may only depend on [${rule.canOnlyDependOn!.join(", ")}]`),
        severity: rule.severity ?? "high",
        relationships: edge.relationships,
      });
    }
  }
  return violations;
}

/**
 * Layering inversions: an edge where a lower architectural layer depends on a
 * higher one (e.g. a library depending on an app). Surfaced separately so the
 * health score can penalise broken layering even without explicit rules.
 */
export function layeringInversions(
  nodes: DependencyNode[],
  edges: DependencyEdge[],
): DependencyEdge[] {
  const layer = new Map(nodes.map((n) => [n.id, n.layer]));
  return edges.filter(
    (e) => e.from !== e.to && (layer.get(e.from) ?? 0) < (layer.get(e.to) ?? 0),
  );
}
