import type {
  DependencyGraph,
  HealthCheckResult,
  PackageManager,
  Regression,
  RuntimeCompatibilityReport,
  ScenarioResult,
  ScenarioRunResult,
} from "@package-workbench/plugin-sdk";
import type { PackageHealthReport, WorkbenchRun } from "../types";
import type {
  FailureAnalysisInput,
  FailureSignals,
  FailureSource,
} from "./types";

/**
 * The intake layer: every failure-producing subsystem (health checks, scenarios,
 * the runtime engine, the dependency graph, CI deltas, raw crash logs) is folded
 * into a uniform {@link FailureAnalysisInput} here, with structured signals
 * extracted so the heuristic engine never has to re-parse free text.
 *
 * Pure + deterministic. The only non-obvious responsibility is `signatureId`,
 * which must be stable across runs (no timestamps, no absolute paths) so the
 * same failure dedups and matches history.
 */

interface BaseCtx {
  packageId?: string;
  packageName?: string;
  packageManager?: PackageManager;
  workspaceRoot?: string;
}

/** Build a stable id from a source + a content signature (slug-ish). */
function signatureId(
  source: FailureSource,
  parts: Array<string | undefined>,
): string {
  const slug = parts
    .filter((p): p is string => Boolean(p))
    .join(":")
    .toLowerCase()
    .replace(/[^a-z0-9:._/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return `${source}:${slug || "unknown"}`;
}

const RUNTIME_CLASSES = new Set([
  "MISSING_DEPENDENCY",
  "ESM_CJS_MISMATCH",
  "EXPORT_RESOLUTION_FAILURE",
  "IMPORT_RESOLUTION_FAILURE",
  "SYNTAX_FAILURE",
  "RUNTIME_EXCEPTION",
]);

/** Pull structured clues out of a check's summary/details/evidence text. */
function extractCheckSignals(result: HealthCheckResult): FailureSignals {
  const text = [
    result.summary,
    result.details ?? "",
    ...(result.evidence ?? []),
  ].join("\n");
  const signals: FailureSignals = {};

  const cls = (text.match(/\b([A-Z][A-Z_]{3,})\b/) ?? [])[1];
  if (cls && RUNTIME_CLASSES.has(cls)) signals.failureClass = cls;

  const missing =
    (text.match(/Missing module:\s*([^\s'"]+)/) ?? [])[1] ??
    (text.match(/Cannot find (?:package|module) ['"]([^'"]+)['"]/) ?? [])[1];
  if (missing) signals.missingModule = stripVersion(missing);

  const offending = (text.match(/Offending file:\s*(\S+)/) ?? [])[1];
  if (offending) signals.offendingFile = offending;

  if (result.checkId === "missing_peer_dependencies") {
    const peers = (result.evidence ?? []).map((e) => e.trim()).filter(Boolean);
    if (peers.length) signals.unresolvedPeers = peers;
  }

  if (result.checkId === "browser_compatibility_check") {
    const builtins = (text.match(/built-ins?:?\s*([a-z0-9_,:\s/]+)/i) ?? [])[1];
    if (builtins) {
      signals.nodeBuiltins = builtins
        .split(",")
        .map((b) => b.trim())
        .filter(Boolean);
    }
  }

  if (
    result.checkId === "module_resolution_check" ||
    result.checkId === "main_module_exists" ||
    result.checkId === "entrypoint_exists"
  ) {
    const entries = (result.evidence ?? [])
      .map((e) => e.split("—")[0]!.trim())
      .filter(Boolean);
    if (entries.length) signals.unresolvedEntries = entries;
  }

  return signals;
}

function stripVersion(spec: string): string {
  // `react@^18` → `react`, but keep scope: `@scope/x@1` → `@scope/x`.
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

/** Normalize a single failing/warning health check. Returns null for pass/skip. */
export function fromHealthCheck(
  result: HealthCheckResult,
  ctx: BaseCtx = {},
): FailureAnalysisInput | null {
  if (result.status !== "fail" && result.status !== "warn") return null;
  const signals = extractCheckSignals(result);
  const subject =
    signals.missingModule ??
    signals.unresolvedPeers?.[0] ??
    signals.unresolvedEntries?.[0] ??
    result.checkId;
  return {
    id: signatureId("package_health", [ctx.packageId, result.checkId, subject]),
    source: "package_health",
    title: titleFor(result, signals),
    detail: result.details ?? result.summary,
    context: {
      ...ctx,
      checkId: result.checkId,
      severity: result.severity,
      evidence: result.evidence,
      signals,
    },
  };
}

function titleFor(result: HealthCheckResult, signals: FailureSignals): string {
  if (signals.missingModule)
    return `Missing dependency: ${signals.missingModule}`;
  if (signals.unresolvedPeers?.length)
    return `Missing peer dependency: ${signals.unresolvedPeers[0]}`;
  return result.summary;
}

/** Normalize every failing check in a package report. */
export function fromPackageReport(
  report: PackageHealthReport,
): FailureAnalysisInput[] {
  const ctx: BaseCtx = {
    packageId: report.package.id,
    packageName: report.package.name,
    packageManager: undefined,
    workspaceRoot: undefined,
  };
  const out: FailureAnalysisInput[] = [];
  for (const c of report.checks) {
    const input = fromHealthCheck(c, ctx);
    if (input) out.push(input);
  }
  if (report.runtime) out.push(...fromRuntimeReport(report.runtime, ctx));
  if (report.scenarios) out.push(...fromScenarioRun(report.scenarios, ctx));
  return out;
}

/** Normalize a runtime compatibility report's failing import executions. */
export function fromRuntimeReport(
  rt: RuntimeCompatibilityReport,
  ctx: BaseCtx = {},
): FailureAnalysisInput[] {
  const out: FailureAnalysisInput[] = [];
  for (const target of rt.targets) {
    const exec = target.execution;
    if (!exec || exec.ok) continue;
    const signals: FailureSignals = {
      failureClass: exec.failureClass,
      missingModule: exec.missingModule
        ? stripVersion(exec.missingModule)
        : undefined,
      errorType: exec.errorType,
      offendingFile: exec.offendingFile,
      durationMs: exec.timedOut ? exec.durationMs : undefined,
    };
    out.push({
      id: signatureId("runtime", [
        ctx.packageId,
        target.target,
        exec.failureClass ?? exec.errorType,
        signals.missingModule,
      ]),
      source: "runtime",
      title: signals.missingModule
        ? `Missing dependency: ${signals.missingModule}`
        : `${exec.failureClass ?? "Runtime failure"} on ${target.target}`,
      detail: exec.message ?? target.reason,
      context: {
        ...ctx,
        evidence: compact([exec.stack, exec.offendingFile]),
        signals,
      },
    });
  }
  return out;
}

/** Normalize failing scenarios from a scenario run. */
export function fromScenarioRun(
  run: ScenarioRunResult,
  ctx: BaseCtx = {},
): FailureAnalysisInput[] {
  return run.results
    .filter((r) => r.status === "fail")
    .map((r) => fromScenario(r, ctx));
}

function fromScenario(
  result: ScenarioResult,
  ctx: BaseCtx,
): FailureAnalysisInput {
  const signals: FailureSignals = {
    errorType: result.error?.type,
    durationMs: result.category === "timeout" ? result.durationMs : undefined,
    memoryBytes: result.memoryBytes,
  };
  const failedAssertions = result.assertions
    .filter((a) => !a.ok)
    .map((a) => a.message);
  return {
    id: signatureId("scenario", [ctx.packageId, result.id, result.category]),
    source: "scenario",
    title: `Scenario failed: ${result.title}`,
    detail:
      result.error?.message ??
      failedAssertions[0] ??
      `Scenario "${result.title}" failed (${result.category ?? "failure"})`,
    context: {
      ...ctx,
      evidence: compact([
        result.error?.stack,
        ...failedAssertions,
        ...result.logs,
      ]),
      signals,
    },
  };
}

/** Normalize cycles + boundary violations from a dependency graph. */
export function fromGraph(
  graph: DependencyGraph,
  ctx: BaseCtx = {},
): FailureAnalysisInput[] {
  const out: FailureAnalysisInput[] = [];
  for (const cycle of graph.cycles) {
    const path = cycle.cycle;
    out.push({
      id: signatureId("graph", ["cycle", ...path]),
      source: "graph",
      title: `Circular dependency: ${path.join(" → ")}${path.length > 1 ? " → " + path[0] : ""}`,
      detail: `A ${cycle.kind} ${cycle.severity}-severity dependency cycle involving ${cycle.affected.length} package(s).`,
      context: {
        ...ctx,
        packageId: path[0],
        evidence: [path.join(" → ")],
        signals: { cyclePath: path },
      },
    });
  }
  for (const v of graph.violations) {
    out.push({
      id: signatureId("graph", ["violation", v.from, v.to]),
      source: "graph",
      title: `Boundary violation: ${v.from} → ${v.to}`,
      detail: `${v.from} depends on ${v.to}, which the rule "${v.rule}" forbids.`,
      context: {
        ...ctx,
        packageId: v.from,
        evidence: [`${v.from} → ${v.to} (${v.rule})`],
        signals: { boundary: { from: v.from, to: v.to, rule: v.rule } },
      },
    });
  }
  return out;
}

/** Normalize a CI/PR regression entry. */
export function fromRegression(
  reg: Regression,
  ctx: BaseCtx = {},
): FailureAnalysisInput {
  const isCycle = reg.kind === "new_cycle";
  const checkId = reg.kind.startsWith("check:")
    ? reg.kind.slice("check:".length)
    : undefined;
  return {
    id: signatureId("ci_regression", [reg.packageId, reg.kind]),
    source: "ci_regression",
    title: reg.detail,
    detail: `Regression introduced (${reg.severity}).`,
    context: {
      ...ctx,
      packageId: reg.packageId ?? ctx.packageId,
      checkId,
      evidence: [reg.detail],
      signals: isCycle ? { cyclePath: [] } : {},
    },
  };
}

/**
 * Normalize a raw crash log / stderr blob. The least structured source — we
 * scan for the few highly-diagnostic patterns and otherwise hand the engine the
 * raw text to pattern-match.
 */
export function fromCrashLog(
  log: string,
  ctx: BaseCtx = {},
): FailureAnalysisInput {
  const signals: FailureSignals = {};

  const missing = (log.match(
    /Cannot find (?:package|module) ['"]([^'"]+)['"]/,
  ) ??
    log.match(/MODULE_NOT_FOUND.*?['"]([^'"]+)['"]/) ??
    [])[1];
  if (missing) signals.missingModule = stripVersion(missing);

  const env = (log.match(
    /(?:environment variable|env var|process\.env\.)\s*['"]?([A-Z][A-Z0-9_]{2,})['"]?\s*(?:is\s+(?:not\s+set|required|missing|undefined))/i,
  ) ?? [])[1];
  if (env) signals.envVar = env;

  const errType = (log.match(/^([A-Z][A-Za-z]*(?:Error|Exception))\b/m) ??
    [])[1];
  if (errType) signals.errorType = errType;

  if (
    /ERR_REQUIRE_ESM|Cannot use import statement|require\(\) of ES Module/i.test(
      log,
    )
  )
    signals.failureClass = "ESM_CJS_MISMATCH";

  const firstLine =
    log
      .split("\n")
      .find((l) => l.trim().length > 0)
      ?.trim() ?? "Crash";
  return {
    id: signatureId("crash_log", [
      ctx.packageId,
      signals.missingModule ?? signals.envVar ?? errType ?? firstLine,
    ]),
    source: "crash_log",
    title: signals.missingModule
      ? `Missing dependency: ${signals.missingModule}`
      : signals.envVar
        ? `Environment variable missing: ${signals.envVar}`
        : firstLine.slice(0, 100),
    detail: firstLine,
    context: { ...ctx, evidence: log.split("\n").slice(0, 40), signals },
  };
}

/** Normalize every failure across a whole run (checks + runtime + scenarios + graph). */
export function fromRun(run: WorkbenchRun): FailureAnalysisInput[] {
  const out: FailureAnalysisInput[] = [];
  for (const report of run.reports) {
    out.push(
      ...fromPackageReport(report).map((i) => ({
        ...i,
        context: {
          ...i.context,
          workspaceRoot: run.workspace.root,
          packageManager: run.workspace.packageManager,
        },
      })),
    );
  }
  if (run.graph)
    out.push(
      ...fromGraph(run.graph, {
        workspaceRoot: run.workspace.root,
        packageManager: run.workspace.packageManager,
      }),
    );
  return dedupe(out);
}

/** Dedupe inputs by their stable id (first wins). */
export function dedupe(inputs: FailureAnalysisInput[]): FailureAnalysisInput[] {
  const seen = new Map<string, FailureAnalysisInput>();
  for (const i of inputs) if (!seen.has(i.id)) seen.set(i.id, i);
  return [...seen.values()];
}

function compact(items: Array<string | undefined>): string[] {
  return items.filter((i): i is string => Boolean(i));
}
