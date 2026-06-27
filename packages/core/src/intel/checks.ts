import type {
  CheckContext,
  HealthCheck,
  HealthCheckOutcome,
} from "@package-workbench/plugin-sdk";
import { defineCheck, pass, skip, warn } from "@package-workbench/plugin-sdk";
import { CheckId } from "../check-ids";
import { scanWorkspace } from "../scanner";
import { analyzePackageIntelligence } from "./analyze";
import { loadIntelConfig, type ResolvedIntelConfig } from "./config";
import type { PackageIntelligenceReport } from "./types";

/**
 * The five package-intelligence health checks. By design they NEVER fail hard —
 * they emit warnings (or pass/skip), because deletion/size advice is heuristic
 * and false certainty is worse than a missed warning. Thresholds come from
 * `workbench.config.ts`.
 *
 * They are opt-in (not part of the default `builtinChecks`) because they read the
 * whole workspace; a single memoized analysis is shared across every package's
 * check in a run so the cost stays O(n), not O(n²).
 */

interface CacheEntry {
  at: number;
  report: Promise<PackageIntelligenceReport>;
  config: Promise<ResolvedIntelConfig>;
}
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 4000; // fresh enough for a single run; re-derives after edits

function workspaceIntel(root: string): CacheEntry {
  const existing = CACHE.get(root);
  const stamp = nowMs();
  if (existing && stamp - existing.at < TTL_MS) return existing;
  const entry: CacheEntry = {
    at: stamp,
    report: scanWorkspace(root).then((s) =>
      analyzePackageIntelligence(s.packages, { gzip: false }),
    ),
    config: loadIntelConfig(root),
  };
  CACHE.set(root, entry);
  return entry;
}

// `Date.now` is fine here (runtime cache freshness, not analysis output).
function nowMs(): number {
  return Date.now();
}

const KB = 1024;

export const unusedExportCheck: HealthCheck = defineCheck({
  id: CheckId.unusedExport,
  label: "Exports are used",
  description:
    "Flags exported symbols with no internal consumers. Conservative: public packages are never marked deletable.",
  severity: "low",
  weight: 0,
  async run(ctx: CheckContext): Promise<HealthCheckOutcome> {
    const { report, config } = workspaceIntel(ctx.workspace.root);
    const cfg = await config;
    if (!cfg.api.flagUnusedExports)
      return skip("Unused-export flagging disabled in config");
    const usage = (await report).usage.find(
      (u) => u.packageId === ctx.package.id,
    );
    if (!usage || usage.exports.length === 0)
      return skip("No exports to analyze");

    const dead = usage.exports.filter(
      (e) => e.usageClass === "definitely-dead",
    );
    const likely = usage.exports.filter((e) => e.usageClass === "likely-dead");
    const publicUnknown = usage.exports.filter(
      (e) => e.usageClass === "public-api-unknown",
    );

    if (dead.length === 0 && likely.length === 0) {
      return publicUnknown.length
        ? warn(
            "info",
            `${publicUnknown.length} export(s) unused internally — public API, not flagged for deletion`,
            {
              evidence: publicUnknown
                .slice(0, 8)
                .map((e) => `${e.symbol.name} — ${e.note}`),
            },
          )
        : pass("All exports are used internally (or are public API)");
    }

    const evidence = [
      ...dead.map(
        (e) =>
          `definitely dead: ${e.symbol.name} (${e.symbol.file}) — safe to remove`,
      ),
      ...likely.map(
        (e) => `likely dead: ${e.symbol.name} (${e.symbol.file}) — review`,
      ),
    ].slice(0, 12);
    return warn(
      "low",
      `${dead.length} definitely-dead, ${likely.length} likely-dead export(s)`,
      {
        details: usage.private
          ? "Private package — unused exports can usually be removed."
          : "Some unused exports; public API exports are excluded from deletion advice.",
        evidence,
      },
    );
  },
});

export const staleReexportCheck: HealthCheck = defineCheck({
  id: CheckId.staleReexport,
  label: "No stale re-exports",
  description:
    "Flags re-export (barrel) chains that forward symbols nothing imports.",
  severity: "low",
  weight: 0,
  async run(ctx: CheckContext): Promise<HealthCheckOutcome> {
    const { report } = workspaceIntel(ctx.workspace.root);
    const usage = (await report).usage.find(
      (u) => u.packageId === ctx.package.id,
    );
    if (!usage) return skip("No exports to analyze");
    if (usage.staleReExports.length === 0) return pass("No stale re-exports");
    return warn("low", `${usage.staleReExports.length} stale re-export(s)`, {
      details:
        "Barrel files forwarding symbols with no internal consumers add indirection without value.",
      evidence: usage.staleReExports
        .slice(0, 10)
        .map((s) => `${s.file} ← ${s.from}: ${s.note}`),
    });
  },
});

export const bundleSizeCheck: HealthCheck = defineCheck({
  id: CheckId.bundleSize,
  label: "Bundle size within budget",
  description:
    "Measures the built output and warns when it exceeds the configured budget.",
  severity: "low",
  weight: 0,
  async run(ctx: CheckContext): Promise<HealthCheckOutcome> {
    const { report, config } = workspaceIntel(ctx.workspace.root);
    const cfg = await config;
    const size = (await report).sizes.find(
      (s) => s.packageId === ctx.package.id,
    );
    if (!size || !size.measured)
      return skip("No build output to measure (build the package first)");

    const totalKb = Math.round(size.totalBytes / KB);
    const overTotal = totalKb > cfg.size.maxPackageDistKb;
    const bigFiles = size.largestFiles.filter(
      (f) => f.bytes / KB > cfg.size.maxSingleFileKb,
    );

    if (!overTotal && bigFiles.length === 0) {
      return pass(
        `${totalKb} KB across ${size.fileCount} file(s)${size.gzipBytes ? ` (${Math.round(size.gzipBytes / KB)} KB gzip)` : ""}`,
      );
    }
    const evidence: string[] = [];
    if (overTotal)
      evidence.push(
        `total ${totalKb} KB > budget ${cfg.size.maxPackageDistKb} KB`,
      );
    for (const f of bigFiles)
      evidence.push(
        `${f.file}: ${Math.round(f.bytes / KB)} KB > ${cfg.size.maxSingleFileKb} KB`,
      );
    return warn("low", `Bundle over budget (${totalKb} KB)`, {
      details: "Configurable via size.maxPackageDistKb / size.maxSingleFileKb.",
      evidence,
    });
  },
});

export const dependencyWeightCheck: HealthCheck = defineCheck({
  id: CheckId.dependencyWeight,
  label: "Dependencies are lean",
  description:
    "Flags unused runtime deps, test-only runtime deps, and known-heavy client deps.",
  severity: "low",
  weight: 0,
  async run(ctx: CheckContext): Promise<HealthCheckOutcome> {
    const { report } = workspaceIntel(ctx.workspace.root);
    const weight = (await report).dependencyWeight.find(
      (d) => d.packageId === ctx.package.id,
    );
    if (!weight || weight.issues.length === 0)
      return pass("No dependency-weight issues");
    return warn("low", `${weight.issues.length} dependency-weight issue(s)`, {
      evidence: weight.issues
        .slice(0, 12)
        .map((i) => `[${i.kind}] ${i.dependency}: ${i.detail}`),
    });
  },
});

export const duplicateVersionCheck: HealthCheck = defineCheck({
  id: CheckId.duplicateVersion,
  label: "No duplicate dependency versions",
  description:
    "Flags dependencies pinned to multiple versions across the workspace.",
  severity: "low",
  weight: 0,
  async run(ctx: CheckContext): Promise<HealthCheckOutcome> {
    const { report } = workspaceIntel(ctx.workspace.root);
    const dups = (await report).duplicateVersions.filter((d) =>
      d.packages.includes(ctx.package.name),
    );
    if (dups.length === 0) return pass("No duplicate dependency versions");
    return warn("low", `${dups.length} dependency(ies) at multiple versions`, {
      details:
        "Multiple versions inflate install size and can cause subtle runtime mismatches.",
      evidence: dups
        .slice(0, 10)
        .map((d) => `${d.dependency}: ${d.versions.join(", ")}`),
    });
  },
});

/** All five intelligence checks (opt-in; not in the default builtinChecks). */
export const intelligenceChecks: HealthCheck[] = [
  unusedExportCheck,
  staleReexportCheck,
  bundleSizeCheck,
  dependencyWeightCheck,
  duplicateVersionCheck,
];
