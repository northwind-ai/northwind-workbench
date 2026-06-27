import {
  createRunner,
  summarize,
  analyzePackageIntelligence,
  analyzeRefactor,
  detectFixes,
  buildFixPlan,
  snapshotRun,
  compareRuns,
  createJsonRunStore,
  defaultHistoryDir,
  type WorkbenchRun,
} from "@package-workbench/core";
import type { WorkbenchKnowledge } from "./types";

/**
 * Assemble {@link WorkbenchKnowledge} from a workspace by running Package
 * Workbench's existing engines — the chat's single "load everything" entry point
 * for the CLI/desktop. This is orchestration only; all analysis lives in core.
 */

export interface GatherOptions {
  /** Execute the sandboxed runtime-import checks (slower). Default false. */
  runtime?: boolean;
  now?: () => string;
}

export async function gatherKnowledge(
  cwd: string,
  opts: GatherOptions = {},
): Promise<WorkbenchKnowledge> {
  const now = opts.now ?? (() => new Date().toISOString());
  const runner = createRunner({ cwd, discoverPlugins: true });
  const { workspace, packages } = await runner.inspect();

  const prevNoRuntime = process.env.PW_NO_RUNTIME;
  if (!opts.runtime) process.env.PW_NO_RUNTIME = "1";
  const reports = [];
  for (const pkg of packages)
    reports.push(await runner.checkPackage(pkg, workspace));
  if (prevNoRuntime === undefined) delete process.env.PW_NO_RUNTIME;
  else process.env.PW_NO_RUNTIME = prevNoRuntime;

  const at = now();
  const graph = packages.length
    ? await runner.analyzeGraph(packages)
    : undefined;
  const run: WorkbenchRun = {
    id: `chat-${at}`,
    workspace,
    reports,
    summary: summarize(reports),
    startedAt: at,
    finishedAt: at,
    graph,
  };

  let intel;
  try {
    intel = await analyzePackageIntelligence(packages, { size: false, now });
  } catch {
    intel = undefined;
  }
  const refactor = graph
    ? analyzeRefactor({ graph, intel: intel?.usage, now })
    : undefined;
  const fixPlan = buildFixPlan(await detectFixes({ run, intel }), now);

  // History + regression delta (best-effort; never fatal).
  let history;
  let delta = null;
  try {
    const store = createJsonRunStore(defaultHistoryDir(cwd));
    history = await store.all();
    const baseline = history[0];
    if (baseline) {
      const snapshot = await snapshotRun(run, {
        workspacePath: cwd,
        runId: run.id,
        timestamp: at,
      });
      delta = compareRuns(baseline, snapshot);
    }
  } catch {
    history = undefined;
  }

  return { run, graph, intel, refactor, history, delta, fixPlan };
}
