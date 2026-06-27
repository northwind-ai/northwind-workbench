import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { logger, logDir } from "./logging";
import {
  buildNotifications,
  compareRuns,
  createJsonRunStore,
  createMockRun,
  createFailureAssistant,
  defaultHistoryDir,
  fromRun,
  snapshotRun,
  analyzePullRequest,
  loadMergePolicy,
  detectWorkspaceStack,
  type DependencyGraph,
  type EngineHostStatus,
  type EngineProgress,
  type FailureExplanation,
  type HistoricalRun,
  applyFix,
  undoLast,
  defaultBackupDir,
  type PackageIntelligenceReport,
  type PrReview,
  type RefactorPlan,
  type FixPlan,
  type FixCandidate,
  type FixResult,
  type WorkspaceStack,
  type PackageHealthReport,
  type RunDelta,
  type RunStore,
  type RuntimeCompatibilityReport,
  type ScenarioRunResult,
  type WorkbenchRun,
} from "@package-workbench/core";
import {
  gatherKnowledge,
  createChatEngine,
  createSession,
  type ChatAnswer,
  type ChatSession,
  type WorkbenchKnowledge,
} from "@package-workbench/chat-engine";
import { getEngine, peekEngine, stopEngine } from "./engine-host";
import { mainDir } from "./paths";
import {
  Channels,
  type EngineStatusDto,
  type ScenarioMetaDto,
} from "../shared/ipc";

/**
 * Main process = privileged broker. It owns filesystem dialogs, history, and the
 * IPC bridge — but all heavy analysis runs in an isolated engine worker
 * (`utilityProcess`), reached via the {@link getEngine} host. The renderer is
 * fully sandboxed; the main process never blocks on a scan and survives a worker
 * crash (the host restarts it).
 */

// Currently loaded workspace. `null` => serve mock data (no worker spawned).
let currentCwd: string | null = null;
let cache: WorkbenchRun = createMockRun();
// The main window — used as the parent for native dialogs so they reliably
// surface (a parent-less dialog can open behind the window on Windows).
let mainWindow: BrowserWindow | null = null;
// AI Codebase Chat: knowledge is gathered lazily on first question and cached;
// the session carries conversational focus for follow-ups. Both reset on scan.
let chatKnowledge: WorkbenchKnowledge | null = null;
let chatSession: ChatSession = createSession();

/** Best-effort live metrics for the engine worker (utility process). */
function workerMetrics(): { memoryMb?: number; cpuPercent?: number } {
  try {
    const util = app.getAppMetrics().filter((m) => m.type === "Utility");
    if (util.length === 0) return {};
    const memoryMb = Math.round(
      util.reduce((sum, m) => sum + (m.memory?.workingSetSize ?? 0), 0) / 1024,
    );
    const cpuPercent = Math.round(
      util.reduce((sum, m) => sum + (m.cpu?.percentCPUUsage ?? 0), 0),
    );
    return { memoryMb, cpuPercent };
  } catch {
    return {};
  }
}

/** Forward engine progress + worker status to every renderer window. */
function broadcastProgress(p: EngineProgress): void {
  for (const win of BrowserWindow.getAllWindows())
    win.webContents.send(Channels.engineProgress, p);
}
function broadcastStatus(s: EngineHostStatus): void {
  const dto: EngineStatusDto = { ...s, ...workerMetrics() };
  for (const win of BrowserWindow.getAllWindows())
    win.webContents.send(Channels.engineStatus, dto);
}

/** The engine host, created on first heavy task; status/crash forwarded to the UI. */
function engine() {
  return getEngine({
    onStatus: broadcastStatus,
    onCrash: (info) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(Channels.engineStatus, {
          state: "crashed",
          inFlight: 0,
          queued: 0,
          restarts: info.restarts,
          lastError: info.reason,
        } satisfies EngineHostStatus);
      }
    },
  });
}

const storeFor = (cwd: string): RunStore =>
  createJsonRunStore(defaultHistoryDir(cwd));

/** Synthetic history for the first-launch mock (no workspace opened yet). */
function demoHistory(): HistoricalRun[] {
  const at = (n: number): string =>
    `2024-05-${String(10 + n).padStart(2, "0")}T12:00:00.000Z`;
  const mk = (
    n: number,
    score: number,
    failed: number,
    pkgFail: string[] = [],
  ): HistoricalRun => ({
    id: `run-${n}`,
    metadata: {
      runId: `run-${n}`,
      timestamp: at(n),
      gitBranch: "main",
      gitCommit: `${n}abc1234`,
      workspacePath: "/workspace",
    },
    overallScore: score,
    summary: {
      totalPackages: 4,
      passed: 4 - failed,
      warned: 0,
      failed,
      averageScore: score,
    },
    packages: [
      {
        id: "@acme/core",
        name: "@acme/core",
        score: pkgFail.includes("@acme/core") ? 40 : 100,
        status: pkgFail.includes("@acme/core") ? "fail" : "pass",
        failedCheckIds: pkgFail.includes("@acme/core")
          ? ["runtime_import_check"]
          : [],
        scenarioPassRate: 1,
      },
      {
        id: "@acme/ui",
        name: "@acme/ui",
        score: 90,
        status: "warn",
        failedCheckIds: [],
        scenarioPassRate: 1,
      },
    ],
    graph: {
      score: n >= 3 ? 73 : 96,
      grade: n >= 3 ? "C" : "A",
      cycleCount: n >= 3 ? 1 : 0,
      violationCount: n >= 3 ? 1 : 0,
      smellCount: 1,
    },
    scenarios: {
      total: 5,
      passed: n >= 3 ? 4 : 5,
      failed: n >= 3 ? 1 : 0,
      passRate: n >= 3 ? 0.8 : 1,
    },
  });
  return [mk(1, 92, 0), mk(2, 90, 0), mk(3, 84, 1, ["@acme/core"])];
}

/** Persist a run to history and fire OS notifications for severe regressions. */
async function recordHistory(cwd: string, run: WorkbenchRun): Promise<void> {
  try {
    const store = storeFor(cwd);
    const now = new Date().toISOString();
    const snapshot = await snapshotRun(run, {
      workspacePath: cwd,
      runId: `run-${now.replace(/[:.]/g, "-")}`,
      timestamp: now,
    });
    const baseline = await store.latest(snapshot.metadata.gitBranch);
    const delta = baseline ? compareRuns(baseline, snapshot) : null;
    await store.save(snapshot);

    if (Notification.isSupported()) {
      for (const note of buildNotifications(snapshot, delta)) {
        if (note.level !== "info")
          new Notification({
            title: `Package Workbench — ${note.title}`,
            body: note.body,
          }).show();
      }
    }
  } catch {
    // History is best-effort — never let it break a scan.
  }
}

/** Run a full scan in the worker, stream progress, persist history. */
async function scan(cwd: string): Promise<WorkbenchRun> {
  cache = await engine().request(
    "RUN_SCAN",
    { cwd, includeGraph: true },
    { onProgress: broadcastProgress },
  );
  currentCwd = cwd;
  chatKnowledge = null; // stale — a new scan invalidates chat knowledge
  chatSession = createSession();
  await recordHistory(cwd, cache);
  return cache;
}

/** Patch the cached report for one package (so getInitialRun stays current). */
function patchReport(
  packageId: string,
  patch: Partial<PackageHealthReport>,
): void {
  cache = {
    ...cache,
    reports: cache.reports.map((r) =>
      r.package.id === packageId ? { ...r, ...patch } : r,
    ),
  };
}

function registerIpc(): void {
  ipcMain.handle(Channels.getInitialRun, async () => cache);

  ipcMain.handle(Channels.openWorkspace, async () => {
    logger.info("openWorkspace: opening folder picker");
    const parent = mainWindow ?? BrowserWindow.getFocusedWindow();
    const options = {
      title: "Open workspace",
      properties: ["openDirectory" as const],
    };
    // Pass the parent window so the dialog is owned by the app and reliably
    // surfaces on Windows (a parent-less dialog can open behind the window).
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    logger.info(
      `openWorkspace: dialog ${result.canceled ? "canceled" : `selected ${result.filePaths[0]}`}`,
    );
    if (result.canceled || result.filePaths.length === 0) return null;
    return scan(result.filePaths[0]!);
  });

  ipcMain.handle(Channels.openExample, async (): Promise<WorkbenchRun> => {
    // Try a bundled example workspace; fall back to the deterministic demo run.
    const candidates = [
      join(process.resourcesPath ?? "", "examples", "pnpm-workspace"),
      join(app.getAppPath(), "..", "..", "examples", "pnpm-workspace"),
      join(app.getAppPath(), "examples", "pnpm-workspace"),
    ];
    const example = candidates.find(
      (p) => p && existsSync(join(p, "package.json")),
    );
    if (example) return scan(example);
    currentCwd = null;
    cache = createMockRun();
    return cache;
  });

  ipcMain.handle(Channels.exportReport, async (): Promise<string | null> => {
    const result = await dialog.showSaveDialog({
      title: "Export report",
      defaultPath: "workbench-report.md",
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "HTML", extensions: ["html"] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    const format = result.filePath.endsWith(".html") ? "html" : "markdown";
    const { content } = await engine().request("RUN_REPORT", {
      run: cache,
      format,
    });
    await writeFile(result.filePath, content, "utf8");
    return result.filePath;
  });

  ipcMain.handle(Channels.scan, async (_e: IpcMainInvokeEvent, path: string) =>
    scan(path),
  );

  ipcMain.handle(Channels.runAll, async () =>
    currentCwd ? scan(currentCwd) : (cache = createMockRun()),
  );

  ipcMain.handle(Channels.cancel, async () => peekEngine()?.cancelAll());

  ipcMain.handle(Channels.engineStatus, async (): Promise<EngineStatusDto> => {
    const s = peekEngine()?.getStatus() ?? {
      state: "stopped" as const,
      inFlight: 0,
      queued: 0,
      restarts: 0,
    };
    return { ...s, ...workerMetrics() };
  });

  // While a task is in flight, push live worker metrics to the UI.
  const metricsTimer = setInterval(() => {
    const h = peekEngine();
    if (h && h.getStatus().inFlight > 0) broadcastStatus(h.getStatus());
  }, 2000);
  (metricsTimer as { unref?: () => void }).unref?.();

  ipcMain.handle(
    Channels.runPackage,
    async (
      _e: IpcMainInvokeEvent,
      packageId: string,
    ): Promise<PackageHealthReport | null> => {
      if (!currentCwd)
        return cache.reports.find((r) => r.package.id === packageId) ?? null;
      const report = await engine().request(
        "RUN_PACKAGE",
        { cwd: currentCwd, packageId },
        { onProgress: broadcastProgress },
      );
      if (report)
        cache = {
          ...cache,
          reports: cache.reports.map((r) =>
            r.package.id === packageId ? report : r,
          ),
        };
      return report;
    },
  );

  ipcMain.handle(
    Channels.analyzeRuntime,
    async (
      _e: IpcMainInvokeEvent,
      packageId: string,
    ): Promise<RuntimeCompatibilityReport | null> => {
      if (!currentCwd)
        return (
          cache.reports.find((r) => r.package.id === packageId)?.runtime ?? null
        );
      const runtime = await engine().request(
        "RUN_RUNTIME",
        { cwd: currentCwd, packageId },
        { onProgress: broadcastProgress },
      );
      if (runtime) patchReport(packageId, { runtime });
      return runtime;
    },
  );

  ipcMain.handle(
    Channels.listScenarios,
    async (
      _e: IpcMainInvokeEvent,
      packageId: string,
    ): Promise<ScenarioMetaDto[]> => {
      const existing = cache.reports.find(
        (r) => r.package.id === packageId,
      )?.scenarios;
      // Scenario metadata is cheap; in mock mode we derive it from the cached run.
      return existing
        ? existing.results.map((r) => ({ id: r.id, title: r.title }))
        : [];
    },
  );

  const runScenariosFor = async (
    packageId: string,
    only?: string,
  ): Promise<ScenarioRunResult | null> => {
    if (!currentCwd)
      return (
        cache.reports.find((r) => r.package.id === packageId)?.scenarios ?? null
      );
    const result = await engine().request(
      "RUN_SCENARIOS",
      { cwd: currentCwd, packageId, only: only ? [only] : undefined },
      { onProgress: broadcastProgress },
    );
    if (result) patchReport(packageId, { scenarios: result });
    return result;
  };

  ipcMain.handle(
    Channels.runScenarios,
    async (_e: IpcMainInvokeEvent, packageId: string) =>
      runScenariosFor(packageId),
  );
  ipcMain.handle(
    Channels.runScenario,
    async (_e: IpcMainInvokeEvent, packageId: string, scenarioId: string) =>
      runScenariosFor(packageId, scenarioId),
  );

  ipcMain.handle(Channels.openLogsFolder, async () => {
    const dir = logDir();
    if (dir) await shell.openPath(dir);
  });

  ipcMain.handle(
    Channels.logError,
    async (_e: IpcMainInvokeEvent, scope: string, message: string) => {
      logger.error(`[${scope}] ${message}`);
    },
  );

  ipcMain.handle(Channels.historyList, async (): Promise<HistoricalRun[]> => {
    if (!currentCwd) return demoHistory();
    return storeFor(currentCwd).all();
  });

  ipcMain.handle(
    Channels.historyCompare,
    async (
      _e: IpcMainInvokeEvent,
      prevId: string,
      currId: string,
    ): Promise<RunDelta | null> => {
      const runs = currentCwd
        ? await storeFor(currentCwd).all()
        : demoHistory();
      const prev = runs.find((r) => r.id === prevId);
      const curr = runs.find((r) => r.id === currId);
      return prev && curr ? compareRuns(prev, curr) : null;
    },
  );

  ipcMain.handle(
    Channels.analyzeGraph,
    async (): Promise<DependencyGraph | null> => {
      if (!currentCwd) return cache.graph ?? null; // mock mode: demo graph on the run
      const graph = await engine().request(
        "RUN_GRAPH",
        { cwd: currentCwd },
        { onProgress: broadcastProgress },
      );
      cache = { ...cache, graph };
      return graph;
    },
  );

  ipcMain.handle(
    Channels.explainRun,
    async (): Promise<FailureExplanation[]> => {
      // Mock/demo mode (no workspace): analyze in-process with offline heuristics
      // and no persistent memory. Real workspaces go through the worker so the
      // failure-memory file is read/written off the UI thread.
      if (!currentCwd)
        return createFailureAssistant().analyzeMany(fromRun(cache));
      return engine().request(
        "EXPLAIN_RUN",
        { run: cache, cwd: currentCwd },
        { onProgress: broadcastProgress },
      );
    },
  );

  ipcMain.handle(Channels.reviewPr, async (): Promise<PrReview | null> => {
    // Compare the current run against the most recent stored baseline. Changed
    // files are unknown in the desktop (no PR context) so the blast radius is
    // graph-derived from any regressed packages; CI supplies the precise diff.
    const runs = currentCwd ? await storeFor(currentCwd).all() : demoHistory();
    const base = runs[0];
    if (!base) return null;
    const policy = currentCwd ? await loadMergePolicy(currentCwd) : undefined;
    const changedFiles = cache.reports
      .filter((r) => r.status !== "pass")
      .map(
        (r) =>
          `${relative(cache.workspace.root, r.package.root).replace(/\\/g, "/")}/package.json`,
      );
    return analyzePullRequest({ base, head: cache, changedFiles, policy });
  });

  ipcMain.handle(
    Channels.detectStack,
    async (): Promise<WorkspaceStack | null> => {
      const root = currentCwd ?? cache.workspace.root;
      if (!root || root === "/workspace") return null; // mock mode has no real FS
      return detectWorkspaceStack(root);
    },
  );

  ipcMain.handle(
    Channels.analyzeIntel,
    async (): Promise<PackageIntelligenceReport | null> => {
      if (!currentCwd) return null; // mock mode: no real source to scan
      return engine().request(
        "ANALYZE_INTEL",
        { cwd: currentCwd },
        { onProgress: broadcastProgress },
      );
    },
  );

  ipcMain.handle(
    Channels.analyzeRefactor,
    async (
      _e: IpcMainInvokeEvent,
      alternatives: boolean,
    ): Promise<RefactorPlan[]> => {
      if (!currentCwd) {
        // Mock mode: analyze the cached run's graph in-process (no worker).
        if (!cache.graph) return [];
        const { analyzeRefactor, generateAlternativePlans } =
          await import("@package-workbench/core");
        return alternatives
          ? generateAlternativePlans({ graph: cache.graph })
          : [analyzeRefactor({ graph: cache.graph })];
      }
      return engine().request(
        "ANALYZE_REFACTOR",
        { cwd: currentCwd, alternatives },
        { onProgress: broadcastProgress },
      );
    },
  );

  ipcMain.handle(Channels.findFixes, async (): Promise<FixPlan | null> => {
    if (!currentCwd) return null; // mock mode: no real files to fix
    return engine().request(
      "FIND_FIXES",
      { cwd: currentCwd },
      { onProgress: broadcastProgress },
    );
  });

  ipcMain.handle(
    Channels.applyFix,
    async (
      _e: IpcMainInvokeEvent,
      candidate: FixCandidate,
      allowReview: boolean,
    ): Promise<FixResult> => {
      if (!currentCwd) {
        return {
          candidateId: candidate.id,
          applied: false,
          files: [],
          reason: "no workspace open",
        };
      }
      // Applied in the main process: file writes are quick + atomic, and the
      // engine guarantees backups for rollback.
      const now = new Date().toISOString();
      return applyFix(candidate, {
        backupDir: defaultBackupDir(currentCwd),
        backupId: `fix-${now.replace(/[:.]/g, "-")}-${candidate.id.replace(/[^a-zA-Z0-9]/g, "_")}`,
        allowReview,
        now: () => now,
      });
    },
  );

  ipcMain.handle(Channels.undoFix, async (): Promise<string | null> => {
    if (!currentCwd) return null;
    return undoLast(defaultBackupDir(currentCwd));
  });

  ipcMain.handle(
    Channels.chat,
    async (
      _e: IpcMainInvokeEvent,
      question: string,
    ): Promise<ChatAnswer | null> => {
      if (!currentCwd) return null; // mock mode: no real repo to reason about
      // Gather once; reuse for follow-ups (conversational memory).
      if (!chatKnowledge) chatKnowledge = await gatherKnowledge(currentCwd);
      const engine = createChatEngine(chatKnowledge);
      const { answer, session } = await engine.ask(question, chatSession);
      chatSession = session;
      return answer;
    },
  );
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    title: "Package Workbench",
    backgroundColor: "#f7f8fa",
    webPreferences: {
      preload: join(mainDir, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Recover from a renderer crash instead of leaving a blank window.
  win.webContents.on("render-process-gone", (_e, details) => {
    logger.error(
      `Renderer process gone: ${details.reason} (exit ${details.exitCode})`,
    );
    if (details.reason !== "clean-exit" && !win.isDestroyed()) {
      win.reload();
    }
  });
  win.webContents.on("unresponsive", () =>
    logger.warn("Renderer became unresponsive"),
  );

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(join(mainDir, "../renderer/index.html"));
  }
}

/** Last-resort handlers so the main process never dies silently. */
function installCrashHandlers(): void {
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception in main:", err);
    dialog.showErrorBox(
      "Package Workbench — unexpected error",
      `${err.message}\n\nThe error has been logged. You can keep working or restart the app.`,
    );
  });
  process.on("unhandledRejection", (reason) =>
    logger.error("Unhandled rejection in main:", reason),
  );
  app.on("child-process-gone", (_e, details) =>
    logger.error(`Child process gone: ${details.type} — ${details.reason}`),
  );
}

app.whenReady().then(() => {
  installCrashHandlers();
  logger.info(
    `Package Workbench ${app.getVersion()} starting (logs: ${logDir()})`,
  );
  try {
    registerIpc();
    createWindow();
  } catch (err) {
    logger.error("Failed during startup:", err);
    dialog.showErrorBox("Package Workbench failed to start", String(err));
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => stopEngine());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
