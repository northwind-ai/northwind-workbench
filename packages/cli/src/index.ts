#!/usr/bin/env node
import { resolve } from "node:path";
import {
  createMockRun,
  createRunner,
  RUNTIME_TARGET_LABEL,
  RUNTIME_TARGETS,
  compareRuns,
  createJsonRunStore,
  defaultHistoryDir,
  evaluateCiPolicy,
  loadCiPolicy,
  renderReport,
  snapshotRun,
  summarize,
  createFailureAssistant,
  defaultMemoryPath,
  createFailureMemory,
  fromRun,
  renderExplanationText,
  renderExplanationMarkdown,
  detectWorkspaceStack,
  explainStack,
  analyzePackageIntelligence,
  loadIntelConfig,
  renderApiMarkdown,
  renderSizeMarkdown,
  analyzePullRequest,
  loadMergePolicy,
  renderPrReview,
  renderPrMarkdown,
  githubAnnotations,
  githubJobSummary,
  githubStatus,
  analyzeRefactor,
  generateAlternativePlans,
  renderRefactorText,
  renderRefactorMarkdown,
  PLAN_VARIANTS,
  detectFixes,
  buildFixPlan,
  applyFixPlan,
  undoLast,
  defaultBackupDir,
  renderFixText,
  renderFixMarkdown,
  type DependencyGraph,
  type FailureExplanation,
  type PrReview,
  type HistoricalRun,
  type RunDelta,
  type CiResult,
  type PackageInfo,
  type ReportFormat,
  type RunnerEvent,
  type RuntimeCompatibilityReport,
  type RuntimeStatus,
  type ScenarioRunResult,
  type WorkbenchRun,
} from "@package-workbench/core";
import {
  gatherKnowledge,
  createChatEngine,
  renderAnswerText,
  renderAnswerMarkdown,
} from "@package-workbench/chat-engine";
import {
  analyzeDiff,
  renderDiffText,
  renderDiffMarkdown,
  type DiffSpec,
} from "@package-workbench/git-intelligence";
import {
  simulate,
  mutationsFromRefactor,
  exportArchitectureDiff,
  exportSimulationMarkdown,
  exportSimulationJson,
  type GraphMutation,
} from "@package-workbench/graph-sim";
import {
  analyzePerformance,
  renderPerfText,
  renderPerfMarkdown,
} from "@package-workbench/perf-intelligence";
import {
  analyzeInventory,
  renderInventoryText,
  renderInventoryMarkdown,
  renderInventoryHtml,
} from "@package-workbench/inventory";
import { readFile, writeFile } from "node:fs/promises";

interface Flags {
  pretty: boolean;
  quiet: boolean;
  mock: boolean;
  noExecute: boolean;
  package?: string;
  format: ReportFormat;
  out?: string;
  save: boolean;
  scenarios: boolean;
  graph: boolean;
  input?: string;
  base?: string;
  changed?: string;
  github: boolean;
  alternatives: boolean;
  apply: boolean;
  review: boolean;
  undo: boolean;
  staged: boolean;
  profile: boolean;
}

function parseFlags(argv: string[]): { positionals: string[]; flags: Flags } {
  const positionals: string[] = [];
  const flags: Flags = {
    pretty: false,
    quiet: false,
    mock: false,
    noExecute: false,
    format: "markdown",
    save: true,
    scenarios: false,
    graph: false,
    github: false,
    alternatives: false,
    apply: false,
    review: false,
    undo: false,
    staged: false,
    profile: false,
  };
  const val = (a: string, i: number, prefix: string): string | undefined =>
    a.startsWith(prefix + "=") ? a.slice(prefix.length + 1) : argv[i + 1];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--pretty") flags.pretty = true;
    else if (a === "--quiet" || a === "-q") flags.quiet = true;
    else if (a === "--mock") flags.mock = true;
    else if (a === "--no-execute" || a === "--static") flags.noExecute = true;
    else if (a === "--no-save") flags.save = false;
    else if (a === "--scenarios") flags.scenarios = true;
    else if (a === "--graph") flags.graph = true;
    else if (a === "--package" || a === "-p") flags.package = argv[++i];
    else if (a.startsWith("--package="))
      flags.package = a.slice("--package=".length);
    else if (a === "--format" || a.startsWith("--format="))
      flags.format = normalizeFormat(val(a, i, "--format"));
    else if (a === "--out" || a.startsWith("--out="))
      flags.out = val(a, i, "--out");
    else if (a === "--input" || a.startsWith("--input="))
      flags.input = val(a, i, "--input");
    else if (a === "--base" || a.startsWith("--base="))
      flags.base = val(a, i, "--base");
    else if (a === "--changed" || a.startsWith("--changed="))
      flags.changed = val(a, i, "--changed");
    else if (a === "--github") flags.github = true;
    else if (a === "--alternatives") flags.alternatives = true;
    else if (a === "--apply") flags.apply = true;
    else if (a === "--review") flags.review = true;
    else if (a === "--undo") flags.undo = true;
    else if (a === "--staged" || a === "--cached") flags.staged = true;
    else if (a === "--profile") flags.profile = true;
    else if (!a.startsWith("-")) positionals.push(a);
  }
  return { positionals, flags };
}

function normalizeFormat(v: string | undefined): ReportFormat {
  if (v === "md" || v === "markdown") return "markdown";
  if (v === "html") return "html";
  if (v === "json") return "json";
  return "markdown";
}

function printHelp(): void {
  console.log(`package-workbench — verify that packages actually work

Usage:
  package-workbench scan <path>          Run health checks across a workspace
  package-workbench runtime <path>       Show the runtime compatibility matrix
  package-workbench scenarios <path>     Run plugin smoke-test scenarios
  package-workbench graph <path>         Dependency graph + violation report
  package-workbench detect <path>        Detect the workspace adapter stack
  package-workbench plugins <path>       List discovered plugins + adapters
  package-workbench report <path>        Export a health report (md/html/json)
  package-workbench ci <path>            Headless CI gate (non-zero on regression)
  package-workbench explain <path>       AI failure analysis (root cause + fixes)
  package-workbench pr <path>            PR review vs baseline (blast radius + risk)
  package-workbench api <path>           Export inventory + unused/dead API surface
  package-workbench size <path>          Bundle size + dependency weight report
  package-workbench refactor <path>      AI architecture refactor suggestions
  package-workbench fix <path>           Preview safe auto-fixes (diffs)
  package-workbench fix <path> --apply   Apply safe auto-fixes (atomic + rollback)
  package-workbench chat "<question>"    Ask a question about the repo (AI chat)
  package-workbench diff [base...head]   Diff intelligence: blast radius + risk
  package-workbench graph-sim <path>     Simulate architecture changes (impact)
  package-workbench perf <path>          Performance bottlenecks + regressions
  package-workbench inventory <path>     Repo inventory + technical-debt audit

Options:
  --pretty            Human-readable output (default is JSON)
  --package, -p NAME  Limit to a single package
  --no-execute        Runtime: static analysis only (no child imports)
  --scenarios         Also run plugin scenarios (report/ci)
  --format FMT        report: md | html | json  (ci: json for machine output)
  --out FILE          report: write to a file instead of stdout
  --no-save           ci: do not persist this run as the new baseline
  --input FILE        explain: analyze a raw crash log instead of scanning
  --base REF          pr: base ref to diff against (default origin/main)
  --changed FILE      pr: read changed files from a file (one path per line)
  --github            pr: emit GitHub annotations + job summary
  --alternatives      refactor: emit Balanced/Minimal-risk/Max-impact plans
  --apply             fix: apply safe fixes (atomically, with backups)
  --review            fix: also apply review-required fixes
  --undo              fix: roll back the last applied fix group
  --quiet, -q         Suppress progress logging on stderr
  --mock              scan: print the built-in mock run (no FS access)
  -h, --help          Show this help
`);
}

const ICON: Record<string, string> = {
  pass: "✓",
  warn: "!",
  fail: "✗",
  skip: "·",
  unknown: "?",
};
const STATUS_WORD: Record<RuntimeStatus, string> = {
  pass: "PASS",
  fail: "FAIL",
  warn: "WARN",
  unknown: "—",
};

// ---- scan -------------------------------------------------------------------

function printScanPretty(run: WorkbenchRun): void {
  const w = run.workspace;
  console.log(
    `Workspace: ${w.name ?? w.root}  [${w.packageManager}${w.isMonorepo ? ", monorepo" : ""}]`,
  );
  console.log(
    `Packages: ${w.packageCount}  ·  avg score ${run.summary.averageScore}/100`,
  );
  for (const warning of w.warnings) console.log(`  ! ${warning}`);

  for (const r of run.reports) {
    console.log(
      `\n${ICON[r.status] ?? "?"} ${r.package.name}@${r.package.version}  ${r.score}/100  (${r.confidence} confidence, ${r.package.packageType}/${r.package.runtime})`,
    );
    for (const c of r.checks) {
      const mark = ICON[c.status] ?? "?";
      console.log(`   ${mark} ${c.checkId.padEnd(26)} ${c.summary}`);
    }
  }
  console.log(
    `\n${run.summary.passed} passed · ${run.summary.warned} warned · ${run.summary.failed} failed`,
  );
}

function scanJson(run: WorkbenchRun) {
  return {
    workspace: run.workspace,
    summary: run.summary,
    packages: run.reports.map((r) => ({
      name: r.package.name,
      version: r.package.version,
      packageType: r.package.packageType,
      runtime: r.package.runtime,
      score: r.score,
      confidence: r.confidence,
      status: r.status,
      checks: r.checks.map((c) => ({
        id: c.checkId,
        status: c.status,
        severity: c.severity,
        summary: c.summary,
      })),
    })),
  };
}

// ---- runtime ----------------------------------------------------------------

function printRuntimePretty(
  pkg: PackageInfo,
  rt: RuntimeCompatibilityReport,
): void {
  console.log(
    `\n${pkg.name}  (${rt.detection.primary}, ${Math.round(rt.detection.confidence * 100)}% confidence)`,
  );
  console.log("  " + "-".repeat(50));
  for (const target of RUNTIME_TARGETS) {
    const cell = rt.targets.find((t) => t.target === target);
    const status = cell?.status ?? "unknown";
    const label = RUNTIME_TARGET_LABEL[target].padEnd(18);
    const intent = cell?.intended ? "" : " (not targeted)";
    console.log(
      `  ${label} ${STATUS_WORD[status].padEnd(5)} ${cell?.reason ?? ""}${intent}`,
    );
  }
  if (rt.nodeBuiltinsUsed.length)
    console.log(`  Node built-ins used: ${rt.nodeBuiltinsUsed.join(", ")}`);
}

async function runRuntime(cwd: string, flags: Flags): Promise<number> {
  const runner = createRunner({ cwd, discoverPlugins: true });
  const { packages } = await runner.inspect();
  const targets = flags.package
    ? packages.filter((p) => p.id === flags.package || p.name === flags.package)
    : packages;
  if (targets.length === 0) {
    console.error(
      flags.package
        ? `No package matching "${flags.package}"`
        : "No packages found",
    );
    return 2;
  }

  const reports: Array<{
    package: string;
    runtime: RuntimeCompatibilityReport;
  }> = [];
  let anyFail = false;
  for (const pkg of targets) {
    if (!flags.quiet) process.stderr.write(`· analyzing ${pkg.name}\n`);
    const rt = await runner.analyzeRuntime(pkg, { execute: !flags.noExecute });
    reports.push({ package: pkg.name, runtime: rt });
    if (Object.values(rt.matrix).includes("fail")) anyFail = true;
    if (flags.pretty) printRuntimePretty(pkg, rt);
  }
  if (!flags.pretty)
    process.stdout.write(JSON.stringify(reports, null, 2) + "\n");
  return anyFail ? 1 : 0;
}

// ---- scenarios --------------------------------------------------------------

function printScenariosPretty(
  pkgName: string,
  result: ScenarioRunResult,
): void {
  console.log(
    `\n${pkgName} — ${result.passed}/${result.total} passed (${Math.round(result.passRate * 100)}%)`,
  );
  for (const r of result.results) {
    console.log(
      `  ${ICON[r.status] ?? "?"} ${r.title} (${r.durationMs}ms)${r.category ? ` [${r.category}]` : ""}`,
    );
    for (const a of r.assertions.filter((x) => !x.ok))
      console.log(`      ${a.message}`);
    if (r.error && r.category !== "assertion")
      console.log(`      ${r.error.type}: ${r.error.message}`);
    for (const line of r.logs) console.log(`      › ${line}`);
  }
}

async function runScenarios(cwd: string, flags: Flags): Promise<number> {
  process.env.PW_RUN_SCENARIOS = "1";
  const runner = createRunner({ cwd, discoverPlugins: true });
  const { workspace, packages } = await runner.inspect();
  const targets = flags.package
    ? packages.filter((p) => p.id === flags.package || p.name === flags.package)
    : packages;

  const out: Array<{ package: string; result: ScenarioRunResult }> = [];
  let anyFail = false;
  for (const pkg of targets) {
    const scenarios = runner.scenariosFor(pkg);
    if (scenarios.length === 0) continue;
    if (!flags.quiet)
      process.stderr.write(
        `· running ${scenarios.length} scenario(s) for ${pkg.name}\n`,
      );
    const result = await runner.runScenarios(pkg, workspace);
    out.push({ package: pkg.name, result });
    if (result.failed > 0) anyFail = true;
    if (flags.pretty) printScenariosPretty(pkg.name, result);
  }
  if (out.length === 0 && !flags.quiet)
    process.stderr.write(
      "No scenarios contributed by any plugin for these packages.\n",
    );
  if (!flags.pretty) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  return anyFail ? 1 : 0;
}

// ---- graph ------------------------------------------------------------------

function printGraphPretty(graph: DependencyGraph): void {
  const { stats, health } = graph;
  console.log(
    `Dependency graph — ${stats.packageCount} packages, ${stats.edgeCount} edges, ${stats.externalDependencyCount} external deps`,
  );
  console.log(
    `Graph health: ${health.score}/100 (${health.grade})  ·  ${stats.isAcyclic ? "acyclic" : `${graph.cycles.length} cycle(s)`}  ·  max depth ${stats.maxDepth}`,
  );
  for (const f of health.factors)
    console.log(`   -${f.penalty}  ${f.label}: ${f.detail}`);

  const ranked = [...graph.nodes]
    .sort((a, b) => b.metrics.fanIn - a.metrics.fanIn)
    .slice(0, 8);
  console.log(`\nTop packages by fan-in:`);
  for (const n of ranked)
    console.log(
      `   ${String(n.metrics.fanIn).padStart(3)} in / ${String(n.metrics.fanOut).padStart(3)} out  ${n.name}`,
    );

  if (graph.cycles.length) {
    console.log(`\nCycles:`);
    for (const c of graph.cycles)
      console.log(
        `   [${c.severity}] ${c.kind}: ${c.cycle.join(" → ")}${c.cycle.length > 1 ? " → " + c.cycle[0] : " (self)"}`,
      );
  }
  if (graph.violations.length) {
    console.log(`\nBoundary violations:`);
    for (const v of graph.violations)
      console.log(`   [${v.severity}] ${v.from} → ${v.to}  (${v.rule})`);
  }
  if (graph.smells.length) {
    console.log(`\nArchitectural smells:`);
    for (const s of graph.smells)
      console.log(`   [${s.severity}] ${s.kind}: ${s.packageId} — ${s.detail}`);
  }
}

async function runGraph(cwd: string, flags: Flags): Promise<number> {
  const runner = createRunner({ cwd, discoverPlugins: true });
  const { packages } = await runner.inspect();
  if (!flags.quiet)
    process.stderr.write(
      `· building graph for ${packages.length} package(s)\n`,
    );
  const graph = await runner.analyzeGraph(packages);

  if (flags.pretty) printGraphPretty(graph);
  else process.stdout.write(JSON.stringify(graph, null, 2) + "\n");

  // Non-zero when the graph is structurally unhealthy (cycles or violations).
  return graph.cycles.length > 0 || graph.violations.length > 0 ? 1 : 0;
}

// ---- shared: a full run (checks + graph + optional scenarios) ---------------

async function fullRun(cwd: string, flags: Flags): Promise<WorkbenchRun> {
  const runner = createRunner({ cwd, discoverPlugins: true });
  const { workspace, packages } = await runner.inspect();
  const reports = [];
  for (const pkg of packages) {
    if (!flags.quiet) process.stderr.write(`· checking ${pkg.id}\n`);
    let report = await runner.checkPackage(pkg, workspace);
    if (flags.scenarios && runner.scenariosFor(pkg).length > 0) {
      report = {
        ...report,
        scenarios: await runner.runScenarios(pkg, workspace),
      };
    }
    reports.push(report);
  }
  if (!flags.quiet) process.stderr.write(`· building dependency graph\n`);
  const graph = await runner.analyzeGraph(packages);
  const now = new Date().toISOString();
  return {
    id: `run-${now}`,
    workspace,
    reports,
    summary: summarize(reports),
    startedAt: now,
    finishedAt: now,
    graph,
  };
}

const runIdFor = (ts: string): string => `run-${ts.replace(/[:.]/g, "-")}`;

// ---- report -----------------------------------------------------------------

async function runReport(cwd: string, flags: Flags): Promise<number> {
  const run = await fullRun(cwd, flags);
  const store = createJsonRunStore(defaultHistoryDir(cwd));
  const snapshot = await snapshotRun(run, {
    workspacePath: cwd,
    runId: runIdFor(run.finishedAt),
    timestamp: run.finishedAt,
  });
  const baseline = await store.latest(snapshot.metadata.gitBranch);
  const delta = baseline ? compareRuns(baseline, snapshot) : null;

  const output = renderReport({ run, delta }, flags.format);
  if (flags.out) {
    await writeFile(flags.out, output, "utf8");
    if (!flags.quiet)
      process.stderr.write(`· wrote ${flags.format} report to ${flags.out}\n`);
  } else {
    process.stdout.write(output + "\n");
  }
  return 0;
}

// ---- ci ---------------------------------------------------------------------

function printCi(
  snapshot: HistoricalRun,
  delta: RunDelta | null,
  result: CiResult,
): void {
  const md = snapshot.metadata;
  const where = [md.gitBranch, md.gitCommit?.slice(0, 7)]
    .filter(Boolean)
    .join("@");
  console.log(
    `Package Workbench CI · ${md.workspacePath}${where ? ` (${where})` : ""}`,
  );
  console.log(
    `Health ${snapshot.overallScore}/100${delta ? `  (Δ ${delta.scoreDelta >= 0 ? "+" : ""}${delta.scoreDelta} vs baseline)` : "  (no baseline)"}`,
  );
  if (snapshot.graph)
    console.log(
      `Graph ${snapshot.graph.score}/100 (${snapshot.graph.grade}) · ${snapshot.graph.cycleCount} cycle(s) · ${snapshot.graph.violationCount} violation(s)`,
    );

  if (delta && delta.regressions.length) {
    const c = delta.regressions.filter((r) => r.severity === "critical").length;
    const m = delta.regressions.filter((r) => r.severity === "major").length;
    const n = delta.regressions.filter((r) => r.severity === "minor").length;
    console.log(`Regressions: ${c} critical, ${m} major, ${n} minor`);
    for (const r of delta.regressions.slice(0, 10))
      console.log(`  ✗ [${r.severity}] ${r.detail}`);
  }

  console.log(`Policy: ${result.passed ? "PASS" : "FAIL"}`);
  for (const v of result.violations) console.log(`  ✗ ${v.rule}: ${v.detail}`);
}

async function runCi(cwd: string, flags: Flags): Promise<number> {
  const run = await fullRun(cwd, flags);
  const store = createJsonRunStore(defaultHistoryDir(cwd));
  const snapshot = await snapshotRun(run, {
    workspacePath: cwd,
    runId: runIdFor(run.finishedAt),
    timestamp: run.finishedAt,
  });
  const baseline = await store.latest(snapshot.metadata.gitBranch);
  const delta = baseline ? compareRuns(baseline, snapshot) : null;
  const policy = await loadCiPolicy(cwd);
  const result = evaluateCiPolicy(snapshot, delta, policy);

  if (flags.format === "json")
    process.stdout.write(
      JSON.stringify(
        {
          result,
          delta,
          snapshot: {
            id: snapshot.id,
            overallScore: snapshot.overallScore,
            metadata: snapshot.metadata,
          },
        },
        null,
        2,
      ) + "\n",
    );
  else printCi(snapshot, delta, result);

  if (flags.save) {
    await store.save(snapshot);
    if (!flags.quiet)
      process.stderr.write(`· saved run ${snapshot.id} to history\n`);
  }
  return result.passed ? 0 : 1;
}

// ---- fix (Auto Fix engine) --------------------------------------------------

async function runFix(cwd: string, flags: Flags): Promise<number> {
  const backupDir = defaultBackupDir(cwd);

  if (flags.undo) {
    const undone = await undoLast(backupDir);
    console.log(
      undone ? `Rolled back fix group ${undone}` : "Nothing to undo.",
    );
    return 0;
  }

  const run = await fullRun(cwd, flags);
  let intel;
  try {
    intel = await analyzePackageIntelligence(
      run.reports.map((r) => r.package),
      { size: false },
    );
  } catch {
    intel = undefined;
  }
  const candidates = await detectFixes({ run, intel });
  const plan = buildFixPlan(candidates);

  if (!flags.apply) {
    // Preview mode (default): show the plan + diffs, change nothing.
    if (flags.format === "json")
      process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    else if (flags.format === "markdown" && !flags.pretty) {
      const md = renderFixMarkdown(plan);
      if (flags.out) await writeFile(flags.out, md, "utf8");
      else process.stdout.write(md + "\n");
    } else console.log(renderFixText(plan, { showDiff: true }));
    return plan.summary.safe > 0 ? 1 : 0;
  }

  // Apply mode: write the eligible fixes through the atomic engine.
  const now = new Date().toISOString();
  const result = await applyFixPlan(plan, {
    workspaceRoot: cwd,
    level: flags.review ? "safe+review" : "safe",
    sessionId: `fix-${now.replace(/[:.]/g, "-")}`,
    now: () => now,
  });
  console.log(
    `Applied ${result.appliedCount} fix(es) (session ${result.sessionId}).`,
  );
  for (const r of result.results) {
    const mark = r.applied ? "✓" : "·";
    console.log(
      `  ${mark} ${r.candidateId}${r.applied ? "" : ` — ${r.reason}`}`,
    );
  }
  if (result.appliedCount > 0)
    console.log(`Undo with:  package-workbench fix ${cwd} --undo`);
  return 0;
}

// ---- inventory (Repository Inventory + Technical Debt) ----------------------

async function runInventory(cwd: string, flags: Flags): Promise<number> {
  if (!flags.quiet) process.stderr.write("· building repository inventory\n");
  const result = await analyzeInventory(cwd);

  if (flags.format === "json") {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else if (flags.format === "html") {
    const html = renderInventoryHtml(result);
    if (flags.out) await writeFile(flags.out, html, "utf8");
    else process.stdout.write(html + "\n");
  } else if (flags.pretty) {
    console.log(renderInventoryText(result));
  } else {
    const md = renderInventoryMarkdown(result);
    if (flags.out) await writeFile(flags.out, md, "utf8");
    else process.stdout.write(md + "\n");
  }
  // Non-zero when any package is high-risk (debt ≥ 60).
  return result.inventory.totals.highDebt > 0 ? 1 : 0;
}

// ---- perf (Performance Intelligence) ----------------------------------------

async function runPerf(cwd: string, flags: Flags): Promise<number> {
  if (!flags.quiet)
    process.stderr.write(
      `· profiling performance${flags.profile ? " (running builds)" : ""}\n`,
    );
  const report = await analyzePerformance(cwd, {
    profile: flags.profile,
    save: flags.save,
  });

  if (flags.format === "json")
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else if (flags.pretty) console.log(renderPerfText(report));
  else {
    const md = renderPerfMarkdown(report);
    if (flags.out) await writeFile(flags.out, md, "utf8");
    else process.stdout.write(md + "\n");
  }
  // Non-zero when a critical regression is present.
  return report.regressions.some((r) => r.severity === "critical") ? 1 : 0;
}

// ---- graph-sim (Interactive Graph Editor simulation) ------------------------

async function runGraphSim(cwd: string, flags: Flags): Promise<number> {
  const runner = createRunner({ cwd, discoverPlugins: true });
  const { packages } = await runner.inspect();
  const graph = await runner.analyzeGraph(packages);

  let mutations: GraphMutation[];
  if (flags.input) {
    mutations = JSON.parse(
      await readFile(flags.input, "utf8"),
    ) as GraphMutation[];
  } else {
    // No mutation file: preview the top refactor suggestion.
    const plan = analyzeRefactor({ graph });
    mutations = plan.suggestions[0]
      ? mutationsFromRefactor(plan.suggestions[0])
      : [];
    if (mutations.length === 0 && !flags.quiet)
      process.stderr.write(
        "· no mutations supplied and no refactor to preview — pass --input <mutations.json>\n",
      );
  }

  const result = simulate(graph, mutations);

  if (flags.format === "json")
    process.stdout.write(exportSimulationJson(result) + "\n");
  else {
    const md = `${exportArchitectureDiff(result)}\n\n${exportSimulationMarkdown(result)}`;
    if (flags.out) await writeFile(flags.out, md, "utf8");
    else console.log(md);
  }
  return 0;
}

// ---- diff (Git Diff Intelligence) -------------------------------------------

function parseDiffSpec(
  rangeArg: string | undefined,
  staged: boolean,
): DiffSpec {
  if (staged) return { mode: "staged" };
  if (rangeArg && rangeArg.includes("..")) {
    const sep = rangeArg.includes("...") ? "..." : "..";
    const [base, head] = rangeArg.split(sep);
    return { mode: "range", base: base || "HEAD", head: head || undefined };
  }
  return { mode: "working" };
}

async function runDiff(
  cwd: string,
  flags: Flags,
  rangeArg: string | undefined,
): Promise<number> {
  const spec = parseDiffSpec(rangeArg, flags.staged);
  if (!flags.quiet)
    process.stderr.write(
      `· analyzing ${spec.mode === "range" ? `${spec.base}...${spec.head ?? "HEAD"}` : spec.mode} diff\n`,
    );
  const report = await analyzeDiff(cwd, spec);

  if (flags.format === "json")
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else if (flags.format === "markdown" && !flags.pretty) {
    const md = renderDiffMarkdown(report);
    if (flags.out) await writeFile(flags.out, md, "utf8");
    else process.stdout.write(md + "\n");
  } else console.log(renderDiffText(report));

  // Non-zero on a high/critical change so CI can require a closer look.
  return report.risk.level === "high" || report.risk.level === "critical"
    ? 1
    : 0;
}

// ---- chat (AI Codebase Chat) ------------------------------------------------

async function runChat(
  cwd: string,
  flags: Flags,
  question: string,
): Promise<number> {
  if (!question.trim()) {
    console.error(
      'Ask a question, e.g. package-workbench chat "What is the riskiest package?"',
    );
    return 2;
  }
  if (!flags.quiet)
    process.stderr.write("· gathering workspace intelligence\n");
  const knowledge = await gatherKnowledge(cwd);
  const engine = createChatEngine(knowledge);
  const { answer } = await engine.ask(question);

  if (flags.format === "json")
    process.stdout.write(JSON.stringify(answer, null, 2) + "\n");
  else if (flags.format === "markdown" && !flags.pretty)
    process.stdout.write(renderAnswerMarkdown(answer) + "\n");
  else console.log(renderAnswerText(answer));
  return 0;
}

// ---- refactor (AI Refactor Architect) ---------------------------------------

async function runRefactor(cwd: string, flags: Flags): Promise<number> {
  const runner = createRunner({ cwd, discoverPlugins: true });
  const { packages } = await runner.inspect();
  const graph = await runner.analyzeGraph(packages);
  // Export-usage enables leaky-abstraction detection (best-effort; never fatal).
  let intel;
  try {
    intel = (await analyzePackageIntelligence(packages, { size: false })).usage;
  } catch {
    intel = undefined;
  }

  if (flags.alternatives) {
    const plans = generateAlternativePlans({ graph, intel });
    if (flags.format === "json") {
      process.stdout.write(JSON.stringify(plans, null, 2) + "\n");
    } else {
      const md = plans
        .map(
          (p) =>
            `# ${PLAN_VARIANTS[p.variant] ?? `Plan ${p.variant}`}\n\n${renderRefactorMarkdown(p)}`,
        )
        .join("\n\n---\n\n");
      if (flags.out) await writeFile(flags.out, md, "utf8");
      else process.stdout.write(md + "\n");
    }
    return 0;
  }

  const plan = analyzeRefactor({ graph, intel });
  if (flags.format === "json") {
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
  } else if (flags.pretty) {
    console.log(renderRefactorText(plan));
  } else {
    const md = renderRefactorMarkdown(plan);
    if (flags.out) await writeFile(flags.out, md, "utf8");
    else process.stdout.write(md + "\n");
  }
  // Non-zero when there is at least one recommended refactor.
  return plan.suggestions.length > 0 ? 1 : 0;
}

// ---- api / size (package intelligence) --------------------------------------

async function runApi(cwd: string, flags: Flags): Promise<number> {
  const runner = createRunner({ cwd, discoverPlugins: true });
  const { packages } = await runner.inspect();
  const targets = flags.package
    ? packages.filter((p) => p.id === flags.package || p.name === flags.package)
    : packages;
  const report = await analyzePackageIntelligence(targets, { size: false });

  if (flags.format === "json") {
    process.stdout.write(
      JSON.stringify(
        { inventories: report.inventories, usage: report.usage },
        null,
        2,
      ) + "\n",
    );
  } else {
    const md = renderApiMarkdown(report);
    if (flags.out) await writeFile(flags.out, md, "utf8");
    else process.stdout.write(md + "\n");
  }
  // Non-zero when there is *definitely-dead* code to clean up (safe signal only).
  return report.usage.some((u) => u.summary["definitely-dead"] > 0) ? 1 : 0;
}

async function runSize(cwd: string, flags: Flags): Promise<number> {
  const runner = createRunner({ cwd, discoverPlugins: true });
  const { packages } = await runner.inspect();
  const targets = flags.package
    ? packages.filter((p) => p.id === flags.package || p.name === flags.package)
    : packages;
  const cfg = await loadIntelConfig(cwd);
  const report = await analyzePackageIntelligence(targets, {
    gzip: cfg.size.gzip,
  });

  if (flags.format === "json") {
    process.stdout.write(
      JSON.stringify(
        { sizes: report.sizes, duplicateVersions: report.duplicateVersions },
        null,
        2,
      ) + "\n",
    );
  } else {
    const md = renderSizeMarkdown(report);
    if (flags.out) await writeFile(flags.out, md, "utf8");
    else process.stdout.write(md + "\n");
  }
  // Non-zero when a measured package exceeds its dist budget.
  const overBudget = report.sizes.some(
    (s) => s.measured && s.totalBytes / 1024 > cfg.size.maxPackageDistKb,
  );
  return overBudget ? 1 : 0;
}

// ---- detect (workspace adapter stack) ---------------------------------------

async function runDetect(cwd: string, flags: Flags): Promise<number> {
  const stack = await detectWorkspaceStack(cwd);

  if (!flags.pretty && flags.format === "json") {
    process.stdout.write(JSON.stringify(stack, null, 2) + "\n");
    return 0;
  }

  console.log(`Workspace: ${cwd}`);
  console.log(`Detected:  ${explainStack(stack)}`);
  console.log(
    `Primary:   ${stack.primary}  (${Math.round(stack.confidence * 100)}% confidence)${stack.isSinglePackage ? "  · single-package mode" : ""}`,
  );
  console.log(`Package manager: ${stack.packageManager}`);

  console.log(`\nAdapters:`);
  for (const d of stack.detected) {
    console.log(
      `  ✓ ${d.adapter.padEnd(15)} ${Math.round(d.confidence * 100)}%  ${d.evidence.join("; ")}`,
    );
  }

  console.log(`\nCapabilities:`);
  for (const [cap, providers] of Object.entries(stack.capabilities)) {
    console.log(`  • ${cap.padEnd(22)} ${(providers ?? []).join(", ")}`);
  }

  if (stack.notes.length) {
    console.log(`\nNotes:`);
    for (const n of stack.notes) console.log(`  ! ${n}`);
  }
  return 0;
}

// ---- pr (pull-request analysis) ---------------------------------------------

/** Workspace-relative changed files, from `--changed <file>` or `git diff`. */
async function changedFilesFor(cwd: string, flags: Flags): Promise<string[]> {
  if (flags.changed) {
    const raw = await readFile(flags.changed, "utf8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }
  // Best-effort `git diff` against the base; empty on any failure (CI-safe).
  const base = flags.base ?? process.env.GITHUB_BASE_REF ?? "origin/main";
  try {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function printPrPretty(review: PrReview): void {
  console.log(renderPrMarkdown(review));
}

async function runPr(cwd: string, flags: Flags): Promise<number> {
  const run = await fullRun(cwd, flags);
  const store = createJsonRunStore(defaultHistoryDir(cwd));
  const headSnapshot = await snapshotRun(run, {
    workspacePath: cwd,
    runId: runIdFor(run.finishedAt),
    timestamp: run.finishedAt,
  });

  // Base = the latest stored run for the base branch (or any latest run).
  const baseBranch = flags.base ?? process.env.GITHUB_BASE_REF;
  const base = (await store.latest(baseBranch)) ?? (await store.latest());
  if (!base) {
    if (!flags.quiet)
      process.stderr.write(
        "· no baseline in history — run `package-workbench ci` on the base branch first\n",
      );
    // Without a baseline we cannot diff; report the absolute state and pass.
    process.stdout.write(
      JSON.stringify(
        { baselineMissing: true, score: headSnapshot.overallScore },
        null,
        2,
      ) + "\n",
    );
    return 0;
  }

  const changedFiles = await changedFilesFor(cwd, flags);
  const policy = await loadMergePolicy(cwd);
  const review = analyzePullRequest({
    base,
    head: run,
    changedFiles,
    policy,
    baseRef: base.metadata.gitBranch,
    headRef: headSnapshot.metadata.gitBranch,
  });

  if (flags.format === "json")
    process.stdout.write(renderPrReview(review, "json") + "\n");
  else if (flags.format === "html") {
    const html = renderPrReview(review, "html");
    if (flags.out) await writeFile(flags.out, html, "utf8");
    else process.stdout.write(html + "\n");
  } else {
    const md = renderPrReview(review, "markdown");
    if (flags.out) await writeFile(flags.out, md, "utf8");
    else printPrPretty(review);
  }

  // GitHub Actions integration: emit annotations + a job summary.
  if (flags.github) {
    const roots = Object.fromEntries(
      run.reports.map((r) => [r.package.id, r.package.root]),
    );
    for (const line of githubAnnotations(review, roots))
      process.stdout.write(line + "\n");
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile)
      await writeFile(
        summaryFile,
        githubJobSummary(review, renderPrMarkdown(review)),
        "utf8",
      ).catch(() => {});
    const status = githubStatus(review);
    if (!flags.quiet)
      process.stderr.write(
        `· status: ${status.conclusion} — ${status.title}\n`,
      );
  }

  // Exit non-zero only when the policy says to block the merge.
  return review.decision.recommendation === "block" ? 1 : 0;
}

// ---- explain (AI failure analysis) ------------------------------------------

function printExplainPretty(explanations: FailureExplanation[]): void {
  if (explanations.length === 0) {
    console.log("No failures to explain — everything checks out. ✓");
    return;
  }
  console.log(`AI failure analysis — ${explanations.length} failure(s)\n`);
  console.log("=".repeat(52));
  for (const e of explanations) {
    console.log("\n" + renderExplanationText(e));
    console.log("\n" + "=".repeat(52));
  }
}

async function runExplain(cwd: string, flags: Flags): Promise<number> {
  // Memory lives with the workspace so prior fixes resurface across runs.
  const memory = createFailureMemory(defaultMemoryPath(cwd));
  const assistant = createFailureAssistant({ memory });

  let explanations: FailureExplanation[];

  if (flags.input) {
    // Explain a raw crash log / stderr blob.
    const { fromCrashLog } = await import("@package-workbench/core");
    const log = await readFile(flags.input, "utf8");
    explanations = [
      await assistant.analyze(fromCrashLog(log, { workspaceRoot: cwd })),
    ];
  } else {
    const run = flags.mock ? createMockRun() : await fullRun(cwd, flags);
    explanations = await assistant.analyzeMany(fromRun(run));
  }

  if (flags.pretty) {
    printExplainPretty(explanations);
  } else if (flags.format === "json") {
    process.stdout.write(JSON.stringify(explanations, null, 2) + "\n");
  } else {
    const md = [
      "# AI Failure Analysis",
      "",
      ...explanations.map((e) => renderExplanationMarkdown(e) + "\n"),
    ].join("\n");
    if (flags.out) await writeFile(flags.out, md, "utf8");
    else process.stdout.write(md + "\n");
  }

  // Exit non-zero only when there are high-confidence, actionable failures.
  return explanations.some((e) => e.confidence >= 0.6) ? 1 : 0;
}

// ---- plugins ----------------------------------------------------------------

async function runPlugins(cwd: string, flags: Flags): Promise<number> {
  const runner = createRunner({ cwd, discoverPlugins: true });
  const { workspace } = await runner.inspect();
  const plugins = runner.host.plugins.map((p) => ({
    id: p.id ?? p.name,
    name: p.name,
    version: p.version ?? null,
    checks: (p.checks?.length ?? 0) + (p.validators?.length ?? 0),
    scenarios: p.scenarios?.length ?? 0,
    adapters: (p.adapters ?? []).map((a) => a.id),
  }));
  const adapters = runner.host.adapters.map((a) => a.id);
  const loadWarnings = workspace.warnings.filter((w) =>
    w.startsWith("Plugin "),
  );

  if (flags.pretty) {
    console.log(`Plugins (${plugins.length}):`);
    for (const p of plugins) {
      const bits = [
        p.checks ? `${p.checks} check(s)` : "",
        p.scenarios ? `${p.scenarios} scenario(s)` : "",
        p.adapters.length ? `adapter: ${p.adapters.join(", ")}` : "",
      ].filter(Boolean);
      console.log(
        `  ✓ ${p.name}${p.version ? `@${p.version}` : ""}  ${bits.join(" · ")}`,
      );
    }
    console.log(`Adapters: ${adapters.join(", ") || "(none)"}`);
    if (loadWarnings.length) {
      console.log("Load errors:");
      for (const w of loadWarnings) console.log(`  ! ${w}`);
    }
  } else {
    process.stdout.write(
      JSON.stringify({ plugins, adapters, loadWarnings }, null, 2) + "\n",
    );
  }
  return 0;
}

// ---- main -------------------------------------------------------------------

async function runScan(cwd: string, flags: Flags): Promise<number> {
  let run: WorkbenchRun;
  if (flags.mock) {
    run = createMockRun();
  } else {
    const runner = createRunner({ cwd, discoverPlugins: true });
    if (!flags.quiet) {
      runner.on((e: RunnerEvent) => {
        if (e.type === "workspace:detected")
          process.stderr.write(
            `· ${e.workspace.packageCount} package(s) in ${e.workspace.packageManager} workspace\n`,
          );
        else if (e.type === "package:start")
          process.stderr.write(`· checking ${e.packageId}\n`);
      });
    }
    run = await runner.run();
  }
  if (flags.pretty) printScanPretty(run);
  else process.stdout.write(JSON.stringify(scanJson(run), null, 2) + "\n");
  return run.summary.failed > 0 ? 1 : 0;
}

const COMMANDS = new Set([
  "scan",
  "detect",
  "runtime",
  "scenarios",
  "graph",
  "plugins",
  "report",
  "ci",
  "explain",
  "pr",
  "api",
  "size",
  "refactor",
  "fix",
  "chat",
  "diff",
  "graph-sim",
  "perf",
  "inventory",
]);

async function main(): Promise<void> {
  // Drop a standalone `--` separator (npm/pnpm `start -- <args>` injects one).
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  const [command, ...rest] = argv;
  if (!command || !COMMANDS.has(command)) {
    console.error(`Unknown command: ${command ?? ""}\n`);
    printHelp();
    process.exit(2);
  }

  const { positionals, flags } = parseFlags(rest);

  // `chat` and `diff` operate on the current repo, not a path argument.
  if (command === "chat") {
    process.exit(await runChat(process.cwd(), flags, positionals.join(" ")));
  }
  if (command === "diff") {
    process.exit(await runDiff(process.cwd(), flags, positionals[0]));
  }

  const cwd = resolve(positionals[0] ?? process.cwd());

  let code = 0;
  if (command === "scan") code = await runScan(cwd, flags);
  else if (command === "detect") code = await runDetect(cwd, flags);
  else if (command === "runtime") code = await runRuntime(cwd, flags);
  else if (command === "scenarios") code = await runScenarios(cwd, flags);
  else if (command === "graph") code = await runGraph(cwd, flags);
  else if (command === "plugins") code = await runPlugins(cwd, flags);
  else if (command === "report") code = await runReport(cwd, flags);
  else if (command === "ci") code = await runCi(cwd, flags);
  else if (command === "explain") code = await runExplain(cwd, flags);
  else if (command === "pr") code = await runPr(cwd, flags);
  else if (command === "api") code = await runApi(cwd, flags);
  else if (command === "size") code = await runSize(cwd, flags);
  else if (command === "refactor") code = await runRefactor(cwd, flags);
  else if (command === "fix") code = await runFix(cwd, flags);
  else if (command === "graph-sim") code = await runGraphSim(cwd, flags);
  else if (command === "perf") code = await runPerf(cwd, flags);
  else if (command === "inventory") code = await runInventory(cwd, flags);
  process.exit(code);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
