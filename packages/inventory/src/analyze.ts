import { stat } from "node:fs/promises";
import {
  scanWorkspace,
  analyzeDependencyGraph,
  analyzePackageIntelligence,
  createRunner,
  readSourceFiles,
  type DependencyGraph,
  type PackageIntelligenceReport,
} from "@package-workbench/core";
import { classifyPackage } from "./classify";
import {
  scanDebt,
  determineActivity,
  estimateCoverage,
  scoreDebt,
} from "./debt";
import type {
  DebtFinding,
  PackageInventoryReport,
  RepositoryInventory,
  TechnicalDebtReport,
} from "./types";

/**
 * The inventory + debt orchestrator. Scans the workspace, reuses the dependency
 * graph (dead/orphan packages, dependents), package intelligence (dead exports,
 * duplicate utilities), and health scores, and adds per-package source-marker
 * scanning, activity detection, coverage estimation, and debt scoring.
 */

export interface AnalyzeInventoryOptions {
  /** Run health checks for per-package scores (a debt-scoring input). Default true. */
  health?: boolean;
  now?: () => string;
}

export interface InventoryResult {
  inventory: RepositoryInventory;
  debt: TechnicalDebtReport;
}

const DAY_MS = 86_400_000;

export async function analyzeInventory(
  cwd: string,
  opts: AnalyzeInventoryOptions = {},
): Promise<InventoryResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const at = now();
  const nowMs = Date.parse(at) || Date.now();

  const { packages } = await scanWorkspace(cwd);
  const graph = packages.length
    ? await analyzeDependencyGraph(packages, { workspaceRoot: cwd, now })
    : undefined;
  let intel: PackageIntelligenceReport | undefined;
  try {
    intel = await analyzePackageIntelligence(packages, { size: false, now });
  } catch {
    intel = undefined;
  }

  const healthById = new Map<string, number>();
  if (opts.health !== false) {
    try {
      const runner = createRunner({ cwd, discoverPlugins: true });
      const { workspace } = await runner.inspect();
      const prev = process.env.PW_NO_RUNTIME;
      process.env.PW_NO_RUNTIME = "1";
      for (const pkg of packages) {
        const report = await runner.checkPackage(pkg, workspace);
        healthById.set(pkg.id, report.score);
      }
      if (prev === undefined) delete process.env.PW_NO_RUNTIME;
      else process.env.PW_NO_RUNTIME = prev;
    } catch {
      /* health is optional */
    }
  }

  const reports: PackageInventoryReport[] = [];
  for (const pkg of packages) {
    const source = await readSourceFiles(pkg);
    const tests = source.filter((f) => f.isTest);
    const src = source.filter((f) => !f.isTest);

    const lastModifiedMs = await latestMtime(source.map((f) => f.abs));
    const ageDays = lastModifiedMs
      ? Math.max(0, Math.round((nowMs - lastModifiedMs) / DAY_MS))
      : undefined;

    const node = graph?.nodes.find((n) => n.id === pkg.id);
    const dependentCount = node?.metrics.transitiveDependents ?? 0;

    const findings: DebtFinding[] = scanDebt(
      source.map((f) => ({ rel: f.rel, content: f.content, isTest: f.isTest })),
    );
    addGraphFindings(findings, graph, pkg.id);
    addIntelFindings(findings, intel, pkg.id);

    const classification = classifyPackage(pkg);
    const status = determineActivity({
      isDeprecated: classification.class === "deprecated",
      dependentCount,
      ageDays,
      private: pkg.private,
    });
    const coverage = estimateCoverage(tests.length, src.length, 0);
    const healthScore = healthById.get(pkg.id);
    const debtScore = scoreDebt({ coverage, status, findings, healthScore });
    const sizeBytes =
      intel?.sizes.find((s) => s.packageId === pkg.id)?.totalBytes ??
      source.reduce((s, f) => s + f.content.length, 0);

    reports.push({
      id: pkg.id,
      name: pkg.name,
      path: pkg.root,
      classification,
      status,
      lastModified: lastModifiedMs
        ? new Date(lastModifiedMs).toISOString()
        : undefined,
      ageDays,
      sizeBytes,
      dependencyCount: Object.keys(pkg.dependencies).length,
      dependentCount,
      testCount: tests.length,
      coverage,
      healthScore,
      debtScore,
      findings,
    });
  }

  return {
    inventory: buildInventory(reports, graph, at),
    debt: buildDebt(reports, at),
  };
}

async function latestMtime(absFiles: string[]): Promise<number | null> {
  let max = 0;
  for (const f of absFiles) {
    try {
      const s = await stat(f);
      if (s.mtimeMs > max) max = s.mtimeMs;
    } catch {
      /* skip */
    }
  }
  return max || null;
}

function addGraphFindings(
  findings: DebtFinding[],
  graph: DependencyGraph | undefined,
  id: string,
): void {
  for (const smell of graph?.smells ?? []) {
    if (smell.packageId !== id) continue;
    if (smell.kind === "dead_package" || smell.kind === "orphan")
      findings.push({
        kind: "dead_package",
        detail: smell.detail,
        severity: "high",
      });
    else if (smell.kind === "duplicate_utility")
      findings.push({
        kind: "duplicate_utility",
        detail: smell.detail,
        severity: "medium",
      });
  }
}

function addIntelFindings(
  findings: DebtFinding[],
  intel: PackageIntelligenceReport | undefined,
  id: string,
): void {
  const usage = intel?.usage.find((u) => u.packageId === id);
  const dead =
    usage?.exports.filter((e) => e.usageClass === "definitely-dead") ?? [];
  for (const e of dead.slice(0, 20))
    findings.push({
      kind: "dead_export",
      file: e.symbol.file,
      detail: `unused export "${e.symbol.name}"`,
      severity: "low",
    });
}

function buildInventory(
  reports: PackageInventoryReport[],
  graph: DependencyGraph | undefined,
  at: string,
): RepositoryInventory {
  const orphaned =
    graph?.nodes.filter((n) => n.isOrphan).length ??
    reports.filter((r) => r.dependentCount === 0 && r.dependencyCount === 0)
      .length;
  return {
    totals: {
      packages: reports.length,
      apps: reports.filter((r) => r.classification.class === "app").length,
      libraries: reports.filter((r) => r.classification.class === "library")
        .length,
      experimental: reports.filter(
        (r) => r.classification.class === "experimental",
      ).length,
      orphaned,
      dead: reports.filter((r) => r.status === "dead").length,
      deprecated: reports.filter((r) => r.status === "deprecated").length,
      highDebt: reports.filter((r) => r.debtScore >= 60).length,
    },
    items: reports.map((r) => ({
      id: r.id,
      name: r.name,
      class: r.classification.class,
      status: r.status,
      debtScore: r.debtScore,
    })),
    packages: reports,
    generatedAt: at,
  };
}

function buildDebt(
  reports: PackageInventoryReport[],
  at: string,
): TechnicalDebtReport {
  const byKind: TechnicalDebtReport["byKind"] = {};
  const incomplete: TechnicalDebtReport["incomplete"] = [];
  for (const r of reports) {
    for (const f of r.findings) {
      byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
      if (f.kind === "not_implemented")
        incomplete.push({ packageId: r.id, finding: f });
    }
  }
  const ranking = [...reports]
    .sort((a, b) => b.debtScore - a.debtScore)
    .filter((r) => r.debtScore > 0)
    .map((r) => ({
      id: r.id,
      name: r.name,
      debtScore: r.debtScore,
      topFindings: [...r.findings]
        .sort((a, b) => sev(b.severity) - sev(a.severity))
        .slice(0, 5),
    }));
  return {
    ranking,
    byKind,
    deadPackages: reports.filter((r) => r.status === "dead").map((r) => r.id),
    incomplete,
    generatedAt: at,
  };
}

const sev = (s: DebtFinding["severity"]): number =>
  s === "high" ? 2 : s === "medium" ? 1 : 0;
