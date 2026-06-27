import type {
  DependencyEdge,
  DependencyNode,
  DependencyRelationship,
  PackageInfo,
} from "@package-workbench/plugin-sdk";
import { scanPackageImports } from "../runtime/source-scan";
import { InternalIndex, loadTsconfigAliases } from "./imports";

/**
 * Builds the raw dependency graph: one node per workspace package, and edges
 * from both declared package.json dependencies and *actual* source imports.
 * Metrics/cycles/analysis are layered on later (see `analyze`). Scales linearly
 * in packages × bounded-files-per-package; source scans run concurrently.
 */

export interface BuiltGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  /** Distinct external (non-workspace) packages referenced anywhere. */
  externalDependencyCount: number;
}

const DECLARED_FIELDS: Array<[string, DependencyRelationship]> = [
  ["dependencies", "dependency"],
  ["devDependencies", "devDependency"],
  ["peerDependencies", "peerDependency"],
  ["optionalDependencies", "optionalDependency"],
];

/** Infer an architectural layer rank from package type (higher = closer to app). */
function layerOf(pkg: PackageInfo): number {
  switch (pkg.packageType) {
    case "app":
      return 3;
    case "tool":
      return 2;
    case "library":
      return 1;
    default:
      return 1;
  }
}

interface EdgeAccumulator {
  relationships: Set<DependencyRelationship>;
  evidence: Set<string>;
}

export async function buildDependencyGraph(
  packages: PackageInfo[],
  workspaceRoot: string,
): Promise<BuiltGraph> {
  const aliases = await loadTsconfigAliases(workspaceRoot);
  const index = new InternalIndex(packages, aliases);
  const externalNames = new Set<string>();

  // from → to → accumulator
  const edges = new Map<string, Map<string, EdgeAccumulator>>();
  const ensure = (from: string, to: string): EdgeAccumulator => {
    let row = edges.get(from);
    if (!row) edges.set(from, (row = new Map()));
    let acc = row.get(to);
    if (!acc)
      row.set(to, (acc = { relationships: new Set(), evidence: new Set() }));
    return acc;
  };

  // ---- declared dependencies -------------------------------------------------
  for (const pkg of packages) {
    for (const [field, rel] of DECLARED_FIELDS) {
      const deps =
        (pkg.manifest[field] as Record<string, string> | undefined) ?? {};
      for (const [name, range] of Object.entries(deps)) {
        const resolved = index.resolve(name);
        if (resolved.kind === "internal") {
          // A package depending on itself by name is a real misconfiguration —
          // keep the self-edge so cycle detection can flag it.
          const acc = ensure(pkg.id, resolved.id);
          acc.relationships.add(rel);
          acc.evidence.add(`${name}@${range}`);
        } else if (resolved.kind === "external") {
          externalNames.add(resolved.name);
        }
      }
    }
  }

  // ---- source imports (concurrent) ------------------------------------------
  await Promise.all(
    packages.map(async (pkg) => {
      const { refs } = await scanPackageImports(pkg);
      for (const ref of refs) {
        const resolved = index.resolve(ref.specifier);
        if (resolved.kind === "internal") {
          if (resolved.id === pkg.id) continue;
          const acc = ensure(pkg.id, resolved.id);
          acc.relationships.add("import");
          if (acc.evidence.size < 6)
            acc.evidence.add(`${ref.specifier} (${ref.file})`);
        } else if (resolved.kind === "external") {
          externalNames.add(resolved.name);
        }
      }
    }),
  );

  // ---- materialise -----------------------------------------------------------
  const edgeList: DependencyEdge[] = [];
  for (const [from, row] of edges) {
    for (const [to, acc] of row) {
      const relationships = [...acc.relationships];
      edgeList.push({
        from,
        to,
        relationships,
        evidence: [...acc.evidence],
        undeclared: relationships.length === 1 && relationships[0] === "import",
      });
    }
  }

  const nodes: DependencyNode[] = packages.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    version: pkg.version,
    root: pkg.root,
    packageType: pkg.packageType,
    runtime: pkg.runtime,
    layer: layerOf(pkg),
    tags: inferTags(pkg),
    isOrphan: false,
    metrics: {
      fanIn: 0,
      fanOut: 0,
      degree: 0,
      centrality: 0,
      depth: 0,
      transitiveDependents: 0,
      transitiveDependencies: 0,
    },
  }));

  return {
    nodes,
    edges: edgeList,
    externalDependencyCount: externalNames.size,
  };
}

/** Lightweight tags used by boundary rules: package type + path-segment hints. */
function inferTags(pkg: PackageInfo): string[] {
  const tags = new Set<string>([pkg.packageType, pkg.runtime]);
  const norm = pkg.root.split("\\").join("/");
  for (const seg of [
    "apps",
    "libs",
    "packages",
    "ui",
    "core",
    "shared",
    "domain",
    "feature",
  ]) {
    if (new RegExp(`/${seg}(/|$)`).test(norm)) tags.add(seg);
  }
  return [...tags];
}
