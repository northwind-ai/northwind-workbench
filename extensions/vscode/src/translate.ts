import type {
  DependencyGraph,
  FixCandidate,
  FixPlan,
  HealthCheckResult,
  PackageHealthReport,
  PackageIntelligenceReport,
  WorkbenchRun,
} from "@package-workbench/core";

/**
 * The pure translation layer between Package Workbench core results and the
 * editor. It contains ALL the extension's logic that doesn't touch the `vscode`
 * API — diagnostic mapping, package/file resolution, hover cards, quick-fix
 * filtering — so it is fully unit-testable offline. The `vscode` providers are
 * thin adapters over these functions.
 *
 * It reuses core's analysis verbatim (type-only imports here); it never re-derives
 * health, graph, or fix logic.
 */

export type DiagSeverity = "error" | "warning" | "info";

export interface TextRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/** A vscode-agnostic diagnostic the providers turn into a `vscode.Diagnostic`. */
export interface DiagnosticDescriptor {
  file: string;
  range: TextRange;
  severity: DiagSeverity;
  message: string;
  code: string;
  source: "Package Workbench";
}

export interface HoverCard {
  name: string;
  health: number;
  status: string;
  runtime: string;
  warnings: string[];
}

// ---- path + package resolution ----------------------------------------------

function norm(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** The package whose root most specifically contains `file`. */
export function packageForFile(
  run: WorkbenchRun,
  file: string,
): PackageHealthReport | null {
  const target = norm(file);
  let best: PackageHealthReport | null = null;
  let bestLen = -1;
  for (const r of run.reports) {
    const root = norm(r.package.root);
    if (
      (target === root || target.startsWith(root + "/")) &&
      root.length > bestLen
    ) {
      best = r;
      bestLen = root.length;
    }
  }
  return best;
}

/** Resolve an import specifier (e.g. `@repo/core/sub`) to a workspace package. */
export function packageForSpecifier(
  run: WorkbenchRun,
  specifier: string,
): PackageHealthReport | null {
  for (const r of run.reports) {
    const name = r.package.name;
    if (specifier === name || specifier.startsWith(name + "/")) return r;
  }
  return null;
}

/** Extract the module specifier from a source line (import/require/dynamic import). */
export function extractImportSpecifier(lineText: string): string | null {
  const m =
    lineText.match(/from\s*['"]([^'"]+)['"]/) ??
    lineText.match(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/) ??
    lineText.match(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/) ??
    lineText.match(/import\s+['"]([^'"]+)['"]/);
  return m?.[1] ?? null;
}

// ---- text range location -----------------------------------------------------

/** Find the range of the first `"key"` occurrence in JSON text. */
export function findKeyRange(text: string, key: string): TextRange | null {
  const needle = `"${key}"`;
  const idx = text.indexOf(needle);
  if (idx < 0) return null;
  return rangeAt(text, idx, needle.length);
}

/** Find the range of the first line containing `substr`. */
export function findLineRange(text: string, substr: string): TextRange | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const col = lines[i]!.indexOf(substr);
    if (col >= 0)
      return {
        startLine: i,
        startCol: col,
        endLine: i,
        endCol: col + substr.length,
      };
  }
  return null;
}

function rangeAt(text: string, index: number, length: number): TextRange {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  const startCol = index - lineStart;
  return {
    startLine: line,
    startCol,
    endLine: line,
    endCol: startCol + length,
  };
}

const FALLBACK_RANGE: TextRange = {
  startLine: 0,
  startCol: 0,
  endLine: 0,
  endCol: 1,
};

// ---- severity ----------------------------------------------------------------

export function severityForCheck(
  check: Pick<HealthCheckResult, "status" | "severity">,
): DiagSeverity {
  if (check.status === "fail")
    return check.severity === "critical" ? "error" : "warning";
  if (check.status === "warn") return "warning";
  return "info";
}

const CHECK_KEY: Record<string, string> = {
  missing_peer_dependencies: "peerDependencies",
  dependency_version_shape: "dependencies",
  exports_map_check: "exports",
  main_module_exists: "main",
  module_resolution_check: "main",
  types_entry_exists: "types",
  required_scripts_present: "scripts",
  package_name_present: "name",
};

// ---- diagnostics: package.json -----------------------------------------------

/**
 * Diagnostics for a package.json: failing/warning checks, cycles, and boundary
 * violations that involve this package — each located at the most relevant key.
 */
export function diagnosticsForPackageJson(
  report: PackageHealthReport,
  graph: DependencyGraph | undefined,
  text: string,
  file: string,
): DiagnosticDescriptor[] {
  const out: DiagnosticDescriptor[] = [];
  const locate = (key: string): TextRange =>
    findKeyRange(text, key) ?? findKeyRange(text, "name") ?? FALLBACK_RANGE;

  for (const c of report.checks) {
    if (c.status !== "fail" && c.status !== "warn") continue;
    const key = CHECK_KEY[c.checkId] ?? "name";
    out.push({
      file,
      range: locate(key),
      severity: severityForCheck(c),
      message: messageForCheck(c),
      code: c.checkId,
      source: "Package Workbench",
    });
  }

  if (graph) {
    const id = report.package.id;
    for (const cycle of graph.cycles) {
      if (!cycle.cycle.includes(id) && !cycle.affected.includes(id)) continue;
      const others = cycle.cycle.filter((p) => p !== id);
      out.push({
        file,
        range: locate("name"),
        severity: "warning",
        message: `Circular dependency involving ${others.join(", ") || id}`,
        code: "circular_dependency",
        source: "Package Workbench",
      });
    }
    for (const v of graph.violations) {
      if (v.from !== id) continue;
      out.push({
        file,
        range:
          findKeyRange(text, v.to.split("/").pop() ?? v.to) ??
          locate("dependencies"),
        severity: "warning",
        message: `Boundary violation: depends on ${v.to} (rule: ${v.rule})`,
        code: "boundary_violation",
        source: "Package Workbench",
      });
    }
  }

  return out;
}

/** Diagnostics for a source file: stale re-exports (from package intelligence). */
export function diagnosticsForSource(
  file: string,
  intel: PackageIntelligenceReport | undefined,
  packageId: string | undefined,
  relFile: string,
  text: string,
): DiagnosticDescriptor[] {
  if (!intel || !packageId) return [];
  const usage = intel.usage.find((u) => u.packageId === packageId);
  if (!usage) return [];
  const out: DiagnosticDescriptor[] = [];
  for (const stale of usage.staleReExports) {
    if (norm(stale.file) !== norm(relFile)) continue;
    out.push({
      file,
      range: findLineRange(text, stale.from) ?? FALLBACK_RANGE,
      severity: "info",
      message: `Stale re-export — nothing imports the symbols forwarded from "${stale.from}"`,
      code: "stale_reexport",
      source: "Package Workbench",
    });
  }
  return out;
}

function messageForCheck(c: HealthCheckResult): string {
  if (c.checkId === "missing_peer_dependencies") {
    const peers = (c.evidence ?? []).join(", ");
    return `Missing peer dependency: ${peers || c.summary}`;
  }
  if (c.checkId === "runtime_import_check") {
    const m = [c.summary, c.details ?? ""]
      .join(" ")
      .match(/Missing module:\s*([^\s'"]+)/);
    if (m) return `Missing dependency: ${m[1]}`;
  }
  return c.summary;
}

// ---- hover -------------------------------------------------------------------

export function hoverCardForPackage(
  report: PackageHealthReport,
  graph: DependencyGraph | undefined,
): HoverCard {
  const warnings: string[] = [];
  const cycles =
    graph?.cycles.filter(
      (c) =>
        c.cycle.includes(report.package.id) ||
        c.affected.includes(report.package.id),
    ).length ?? 0;
  if (cycles > 0) warnings.push(`${cycles} cycle${cycles > 1 ? "s" : ""}`);
  for (const c of report.checks) {
    if (c.status === "fail" || c.status === "warn")
      warnings.push(messageForCheck(c));
  }
  return {
    name: report.package.name,
    health: report.score,
    status: report.status,
    runtime: report.package.runtime,
    warnings: warnings.slice(0, 6),
  };
}

/** Render a hover card as Markdown. */
export function renderHoverMarkdown(card: HoverCard): string {
  const L: string[] = [];
  L.push(`**Package:** \`${card.name}\``);
  L.push(`**Health:** ${card.health}/100 (${card.status})`);
  L.push(`**Runtime:** ${card.runtime}`);
  if (card.warnings.length) {
    L.push("", "**Warnings:**");
    for (const w of card.warnings) L.push(`- ${w}`);
  } else {
    L.push("", "_No warnings._");
  }
  return L.join("\n");
}

// ---- quick fixes -------------------------------------------------------------

/** Fix candidates whose patches touch `file` (for code actions). */
export function fixesForFile(plan: FixPlan, file: string): FixCandidate[] {
  const target = norm(file);
  return plan.candidates.filter(
    (c) =>
      c.safety !== "dangerous" &&
      c.patches.some((p) => norm(p.path) === target),
  );
}

/** Fix candidates for a whole package (by id). */
export function fixesForPackage(
  plan: FixPlan,
  packageId: string,
): FixCandidate[] {
  return plan.candidates.filter(
    (c) => c.packageId === packageId && c.safety !== "dangerous",
  );
}
