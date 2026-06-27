/**
 * Repository Inventory & Technical Debt Auditor — a comprehensive inventory of
 * the repo plus a conservative technical-debt audit. Pure types only.
 *
 * It reuses existing intelligence (dependency graph for dead/orphan packages +
 * dependents, package intelligence for dead exports + duplicate utilities, health
 * scores) and adds source-marker scanning, activity detection, coverage
 * estimation, and per-package debt scoring. Conservative by design: dead-code and
 * debt classifications avoid false positives.
 */

export type PackageClass =
  | "app"
  | "library"
  | "infra"
  | "cli"
  | "plugin"
  | "config"
  | "shared"
  | "experimental"
  | "deprecated"
  | "unknown";

export type ActivityStatus =
  | "active"
  | "stale"
  | "dormant"
  | "dead"
  | "deprecated";

export type CoverageLevel = "high" | "medium" | "low" | "none";

export type DebtKind =
  | "todo"
  | "fixme"
  | "hack"
  | "xxx"
  | "not_implemented"
  | "stub"
  | "placeholder"
  | "mock_leakage"
  | "dead_export"
  | "duplicate_utility"
  | "dead_package";

export interface DebtFinding {
  kind: DebtKind;
  /** Workspace-relative file (when file-level). */
  file?: string;
  line?: number;
  detail: string;
  /** Higher = more urgent. */
  severity: "low" | "medium" | "high";
}

export interface PackageClassification {
  class: PackageClass;
  /** 0..1 confidence. */
  confidence: number;
  evidence: string[];
}

/** One package's full inventory entry. */
export interface PackageInventoryReport {
  id: string;
  name: string;
  path: string;
  classification: PackageClassification;
  status: ActivityStatus;
  /** ISO timestamp of the most recently modified source file, when known. */
  lastModified?: string;
  /** Days since last modification, when known. */
  ageDays?: number;
  sizeBytes: number;
  dependencyCount: number;
  dependentCount: number;
  testCount: number;
  coverage: CoverageLevel;
  healthScore?: number;
  /** 0..100 technical-debt score (higher = worse). */
  debtScore: number;
  findings: DebtFinding[];
}

/** A lightweight roll-up item (for the summary list). */
export interface InventoryItem {
  id: string;
  name: string;
  class: PackageClass;
  status: ActivityStatus;
  debtScore: number;
}

export interface RepositoryInventory {
  totals: {
    packages: number;
    apps: number;
    libraries: number;
    experimental: number;
    orphaned: number;
    dead: number;
    deprecated: number;
    highDebt: number;
  };
  items: InventoryItem[];
  packages: PackageInventoryReport[];
  generatedAt: string;
}

/** The debt report — ranked worst-first. */
export interface TechnicalDebtReport {
  /** Packages ranked by debt score, worst first. */
  ranking: Array<{
    id: string;
    name: string;
    debtScore: number;
    topFindings: DebtFinding[];
  }>;
  /** Total findings by kind. */
  byKind: Partial<Record<DebtKind, number>>;
  /** Suspected dead packages (conservative). */
  deadPackages: string[];
  /** Incomplete-feature findings (high priority). */
  incomplete: Array<{ packageId: string; finding: DebtFinding }>;
  generatedAt: string;
}
