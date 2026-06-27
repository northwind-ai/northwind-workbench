import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  EngineHostStatus,
  EnginePhase,
  FailureExplanation,
  HistoricalRun,
  PackageHealthReport,
  PackageIntelligenceReport,
  PrReview,
  RefactorPlan,
  FixPlan,
  FixCandidate,
  FixResult,
  WorkbenchRun,
  WorkspaceStack,
} from "@package-workbench/core";
import type { ChatMessage } from "@package-workbench/ui";

// Inlined here so the renderer never imports chat-engine at runtime (it depends
// on core's Node-only engines). The chat itself runs in the main process.
const CHAT_PROMPTS = [
  "Most risky packages?",
  "What should I refactor first?",
  "Why did the score drop?",
  "Which package is causing CI instability?",
  "What changed since last week?",
  "Which package is the largest?",
];
import {
  CommandPalette,
  Onboarding,
  ScanProgress,
  Workbench,
  resolveTheme,
  type Command,
  type ScanStep,
} from "@package-workbench/ui";
import { useStore } from "./store";

type ScenarioMeta = Array<{ id: string; title: string }>;

/** Map an engine phase to the 4-step onboarding scan indicator. */
const PHASE_STEP: Record<EnginePhase, number> = {
  workspace_scan: 1,
  package_discovery: 2,
  health_checks: 3,
  runtime_checks: 3,
  scenarios: 3,
  dependency_graph: 4,
  report_generation: 4,
};

/**
 * Top-level renderer. Owns run/scan state locally; durable preferences (theme,
 * recent repos, last package) live in the Zustand store. Renders onboarding until
 * a workspace is loaded, then the full Workbench, with a global command palette.
 */
export function App() {
  const { theme, recentRepos, lastPackageId, paletteOpen, mode } = useStore();
  const {
    cycleTheme,
    addRecent,
    setLastPackage,
    setMode,
    togglePalette,
    closePalette,
  } = useStore();

  const [run, setRun] = useState<WorkbenchRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [runtimeBusyId, setRuntimeBusyId] = useState<string | null>(null);
  const [scenariosBusyId, setScenariosBusyId] = useState<string | null>(null);
  const [runningScenarioId, setRunningScenarioId] = useState<string | null>(
    null,
  );
  const [graphBusy, setGraphBusy] = useState(false);
  const [explanations, setExplanations] = useState<FailureExplanation[]>([]);
  const [explainBusy, setExplainBusy] = useState(false);
  const [prReview, setPrReview] = useState<PrReview | null>(null);
  const [prBusy, setPrBusy] = useState(false);
  const [workspaceStack, setWorkspaceStack] = useState<WorkspaceStack | null>(
    null,
  );
  const [intel, setIntel] = useState<PackageIntelligenceReport | null>(null);
  const [apiBusy, setApiBusy] = useState(false);
  const [refactorPlans, setRefactorPlans] = useState<RefactorPlan[]>([]);
  const [refactorVariant, setRefactorVariant] = useState(0);
  const [refactorBusy, setRefactorBusy] = useState(false);
  const [fixPlan, setFixPlan] = useState<FixPlan | null>(null);
  const [fixResults, setFixResults] = useState<Record<string, FixResult>>({});
  const [fixBusyId, setFixBusyId] = useState<string | null>(null);
  const [fixBusy, setFixBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(lastPackageId);
  const [scenarioMeta, setScenarioMeta] = useState<
    Record<string, ScenarioMeta>
  >({});
  const [history, setHistory] = useState<HistoricalRun[]>([]);
  const [scanPhase, setScanPhase] = useState(0);
  const [progress, setProgress] = useState(0);
  const [phaseLabel, setPhaseLabel] = useState("");
  const [worker, setWorker] = useState<EngineHostStatus["state"]>("ready");
  const [workerMem, setWorkerMem] = useState<number | null>(null);
  const [status, setStatus] = useState("");

  // ---- theme ----------------------------------------------------------------
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(theme, mq.matches);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  // ---- engine progress + worker status --------------------------------------
  useEffect(() => {
    const offP = window.workbench.onEngineProgress((p) => {
      setProgress(Math.round(p.progress));
      setPhaseLabel(p.message ? `${p.phase}: ${p.message}` : p.phase);
      setScanPhase((cur) => Math.max(cur, PHASE_STEP[p.phase]));
      if (p.total)
        setStatus(
          `${p.phase.replace(/_/g, " ")} · ${p.completed ?? 0}/${p.total}`,
        );
    });
    const offS = window.workbench.onEngineStatus((s) => {
      setWorker(s.state);
      if (typeof s.memoryMb === "number") setWorkerMem(s.memoryMb);
      if (s.state === "crashed")
        setStatus(
          `⚠ Engine worker crashed (${s.lastError ?? "unknown"}) — restarted`,
        );
    });
    return () => {
      offP();
      offS();
    };
  }, []);

  const onCancel = useCallback(() => void window.workbench.cancel(), []);

  const refreshHistory = useCallback(
    () => void window.workbench.listRuns().then(setHistory),
    [],
  );

  useEffect(() => {
    if (selectedId && !scenarioMeta[selectedId]) {
      void window.workbench
        .listScenarios(selectedId)
        .then((metas) =>
          setScenarioMeta((prev) => ({ ...prev, [selectedId]: metas })),
        );
    }
  }, [selectedId, scenarioMeta]);

  // ---- load helpers ---------------------------------------------------------
  const loadRun = useCallback(
    (next: WorkbenchRun) => {
      setRun(next);
      setExplanations([]); // stale: belongs to the previous run
      setPrReview(null);
      setIntel(null);
      setRefactorPlans([]);
      setRefactorVariant(0);
      setFixPlan(null);
      setFixResults({});
      setChatMessages([]);
      void window.workbench
        .detectStack()
        .then(setWorkspaceStack)
        .catch(() => setWorkspaceStack(null));
      setSelectedId((cur) =>
        cur && next.reports.some((r) => r.package.id === cur)
          ? cur
          : (next.reports[0]?.package.id ?? null),
      );
      if (next.workspace.root && next.workspace.root !== "/workspace")
        addRecent({
          path: next.workspace.root,
          name: next.workspace.name ?? next.workspace.root,
        });
      refreshHistory();
    },
    [addRecent, refreshHistory],
  );

  const withScan = useCallback(
    async (fn: () => Promise<WorkbenchRun | null>) => {
      setBusy(true);
      setScanPhase(1);
      setProgress(0);
      try {
        const next = await fn();
        if (next) loadRun(next);
      } catch (err) {
        // Cancelled / crashed engine task — surface, don't white-screen.
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(
          /cancel/i.test(msg) ? "Scan cancelled" : `Scan failed: ${msg}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [loadRun],
  );

  const openRepository = useCallback(
    () => withScan(() => window.workbench.openWorkspace()),
    [withScan],
  );
  const tryExample = useCallback(
    () => withScan(() => window.workbench.openExample()),
    [withScan],
  );
  const openRecent = useCallback(
    (path: string) => withScan(() => window.workbench.scan(path)),
    [withScan],
  );
  const onRunAll = useCallback(
    () => withScan(() => window.workbench.runAll()),
    [withScan],
  );

  const onSelectPackage = useCallback(
    (id: string) => {
      setSelectedId(id);
      setLastPackage(id);
    },
    [setLastPackage],
  );

  const replaceReport = useCallback((report: PackageHealthReport) => {
    setRun((prev) =>
      prev
        ? {
            ...prev,
            reports: prev.reports.map((r) =>
              r.package.id === report.package.id ? report : r,
            ),
          }
        : prev,
    );
  }, []);
  const patchReport = useCallback(
    (id: string, patch: Partial<PackageHealthReport>) => {
      setRun((prev) =>
        prev
          ? {
              ...prev,
              reports: prev.reports.map((r) =>
                r.package.id === id ? { ...r, ...patch } : r,
              ),
            }
          : prev,
      );
    },
    [],
  );

  const onRunPackage = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        const updated = await window.workbench.runPackage(id);
        if (updated) replaceReport(updated);
      } finally {
        setBusyId(null);
      }
    },
    [replaceReport],
  );

  const onAnalyzeRuntime = useCallback(
    async (id: string) => {
      setRuntimeBusyId(id);
      try {
        const runtime = await window.workbench.analyzeRuntime(id);
        if (runtime) patchReport(id, { runtime });
      } finally {
        setRuntimeBusyId(null);
      }
    },
    [patchReport],
  );

  const onRunScenarios = useCallback(
    async (id: string) => {
      setScenariosBusyId(id);
      try {
        const scenarios = await window.workbench.runScenarios(id);
        if (scenarios) patchReport(id, { scenarios });
      } finally {
        setScenariosBusyId(null);
      }
    },
    [patchReport],
  );

  const onRunScenario = useCallback(
    async (id: string, scenarioId: string) => {
      setRunningScenarioId(scenarioId);
      setScenariosBusyId(id);
      try {
        const scenarios = await window.workbench.runScenario(id, scenarioId);
        if (scenarios) patchReport(id, { scenarios });
      } finally {
        setRunningScenarioId(null);
        setScenariosBusyId(null);
      }
    },
    [patchReport],
  );

  const onAnalyzeGraph = useCallback(async () => {
    setGraphBusy(true);
    try {
      const graph = await window.workbench.analyzeGraph();
      if (graph) setRun((prev) => (prev ? { ...prev, graph } : prev));
    } finally {
      setGraphBusy(false);
    }
  }, []);

  const onExplain = useCallback(async () => {
    setExplainBusy(true);
    try {
      setExplanations(await window.workbench.explainRun());
    } catch (err) {
      setStatus(
        `AI analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setExplainBusy(false);
    }
  }, []);

  const onAnalyzePr = useCallback(async () => {
    setPrBusy(true);
    try {
      setPrReview(await window.workbench.reviewPr());
    } catch (err) {
      setStatus(
        `PR analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setPrBusy(false);
    }
  }, []);

  const onAnalyzeApi = useCallback(async () => {
    setApiBusy(true);
    try {
      setIntel(await window.workbench.analyzeIntel());
    } catch (err) {
      setStatus(
        `API analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setApiBusy(false);
    }
  }, []);

  const runRefactor = useCallback(async (alternatives: boolean) => {
    setRefactorBusy(true);
    try {
      const plans = await window.workbench.analyzeRefactor(alternatives);
      setRefactorPlans(plans);
      setRefactorVariant(0);
    } catch (err) {
      setStatus(
        `Refactor analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setRefactorBusy(false);
    }
  }, []);
  const onAnalyzeRefactor = useCallback(
    () => runRefactor(false),
    [runRefactor],
  );
  const onGenerateAlternatives = useCallback(
    () => runRefactor(true),
    [runRefactor],
  );

  const onAnalyzeFixes = useCallback(async () => {
    setFixBusy(true);
    try {
      setFixPlan(await window.workbench.findFixes());
      setFixResults({});
    } catch (err) {
      setStatus(
        `Fix scan failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setFixBusy(false);
    }
  }, []);

  const onApplyFix = useCallback(async (candidate: FixCandidate) => {
    setFixBusyId(candidate.id);
    try {
      const result = await window.workbench.applyFix(
        candidate,
        candidate.safety === "review_required",
      );
      setFixResults((prev) => ({ ...prev, [candidate.id]: result }));
      if (!result.applied && result.reason)
        setStatus(`Fix not applied: ${result.reason}`);
    } finally {
      setFixBusyId(null);
    }
  }, []);

  const onUndoFix = useCallback(async () => {
    const undone = await window.workbench.undoFix();
    setStatus(undone ? `Rolled back fix ${undone}` : "Nothing to undo");
    if (undone) void onAnalyzeFixes();
  }, [onAnalyzeFixes]);

  const onAskChat = useCallback(async (question: string) => {
    setChatMessages((prev) => [...prev, { role: "user", text: question }]);
    setChatBusy(true);
    try {
      const answer = await window.workbench.chat(question);
      setChatMessages((prev) => [
        ...prev,
        answer
          ? { role: "assistant", text: answer.answer, answer }
          : {
              role: "assistant",
              text: "Open a workspace first — I have no repository to reason about yet.",
            },
      ]);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Sorry, that failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  }, []);
  const onChatPackageClick = useCallback(
    (id: string) => {
      setMode("packages");
      onSelectPackage(id);
    },
    [setMode, onSelectPackage],
  );

  const onCompareRuns = useCallback(
    (a: string, b: string) => window.workbench.compareRuns(a, b),
    [],
  );
  const exportReport = useCallback(
    () =>
      void window.workbench
        .exportReport()
        .then((p) => p && setStatus(`Report saved to ${p}`)),
    [],
  );

  // ---- command palette ------------------------------------------------------
  const commands: Command[] = useMemo(() => {
    const base: Command[] = [
      {
        id: "open",
        title: "Open Repository…",
        group: "Actions",
        shortcut: "Ctrl+O",
        run: openRepository,
      },
      {
        id: "rescan",
        title: "Rescan Workspace",
        group: "Actions",
        shortcut: "Ctrl+R",
        disabled: !run,
        run: onRunAll,
      },
      {
        id: "runall",
        title: "Run All Checks",
        group: "Actions",
        disabled: !run,
        run: onRunAll,
      },
      {
        id: "runscn",
        title: "Run Scenarios (selected package)",
        group: "Actions",
        disabled: !selectedId,
        run: () => selectedId && onRunScenarios(selectedId),
      },
      {
        id: "explain",
        title: "Analyze Failures (AI)",
        group: "Actions",
        keywords: ["ai", "root cause", "assistant"],
        disabled: !run,
        run: onExplain,
      },
      {
        id: "export",
        title: "Export Report",
        group: "Actions",
        disabled: !run,
        run: exportReport,
      },
      {
        id: "graph",
        title: "Open Dependency Graph",
        group: "Navigation",
        keywords: ["deps"],
        run: () => setMode("graph"),
      },
      {
        id: "history",
        title: "Open Historical Runs",
        group: "Navigation",
        keywords: ["trend", "regression"],
        run: () => setMode("history"),
      },
      {
        id: "refactor",
        title: "Open Refactor Architect",
        group: "Navigation",
        keywords: ["architecture", "split", "merge", "smell"],
        disabled: !run,
        run: () => {
          setMode("refactor");
          if (refactorPlans.length === 0) void onAnalyzeRefactor();
        },
      },
      {
        id: "fixes",
        title: "Open Auto Fix",
        group: "Navigation",
        keywords: ["fix", "repair", "apply"],
        disabled: !run,
        run: () => {
          setMode("fixes");
          if (!fixPlan) void onAnalyzeFixes();
        },
      },
      {
        id: "pr",
        title: "Open PR Review",
        group: "Navigation",
        keywords: ["merge", "risk", "blast radius"],
        disabled: !run,
        run: () => {
          setMode("pr");
          void onAnalyzePr();
        },
      },
      {
        id: "packages",
        title: "View Packages",
        group: "Navigation",
        run: () => setMode("packages"),
      },
      { id: "theme", title: "Toggle Theme", group: "View", run: cycleTheme },
    ];
    const pkgs: Command[] = (run?.reports ?? []).map((r) => ({
      id: `pkg:${r.package.id}`,
      title: r.package.name,
      subtitle: `${r.score}/100`,
      group: "Packages" as const,
      run: () => {
        setMode("packages");
        onSelectPackage(r.package.id);
      },
    }));
    return [...base, ...pkgs];
  }, [
    run,
    selectedId,
    openRepository,
    onRunAll,
    onRunScenarios,
    onExplain,
    onAnalyzePr,
    onAnalyzeRefactor,
    refactorPlans,
    onAnalyzeFixes,
    fixPlan,
    exportReport,
    setMode,
    cycleTheme,
    onSelectPackage,
  ]);

  // ---- global keyboard ------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePalette();
      } else if (mod && e.key.toLowerCase() === "r" && run) {
        e.preventDefault();
        onRunAll();
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openRepository();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette, onRunAll, openRepository, run]);

  // ---- render ---------------------------------------------------------------
  const scanSteps: ScanStep[] = [
    "Detect workspace",
    "Detect package manager",
    "Discover packages",
    "Run health checks",
  ].map((label, i) => ({
    label,
    status:
      scanPhase > i + 1 ? "done" : scanPhase === i + 1 ? "active" : "pending",
  }));

  const palette = (
    <CommandPalette
      open={paletteOpen}
      commands={commands}
      onClose={closePalette}
    />
  );

  if (!run) {
    return (
      <div className="pw-root">
        {busy ? (
          <ScanProgress
            steps={scanSteps}
            progress={progress}
            phase={phaseLabel}
            onCancel={onCancel}
          />
        ) : (
          <Onboarding
            onOpenRepository={openRepository}
            onTryExample={tryExample}
            recentRepos={recentRepos}
            onOpenRecent={openRecent}
          />
        )}
        {palette}
      </div>
    );
  }

  return (
    <div className="pw-root">
      <Workbench
        run={run}
        onOpenWorkspace={openRepository}
        onRunAll={onRunAll}
        onRunPackage={onRunPackage}
        busy={busy}
        busyPackageId={busyId}
        loading={busy}
        selectedId={selectedId}
        onSelectPackage={onSelectPackage}
        mode={mode}
        onModeChange={setMode}
        themePreference={theme}
        onCycleTheme={cycleTheme}
        onAnalyzeRuntime={onAnalyzeRuntime}
        runtimeBusyPackageId={runtimeBusyId}
        availableScenarios={selectedId ? scenarioMeta[selectedId] : undefined}
        onRunScenarios={onRunScenarios}
        onRunScenario={onRunScenario}
        scenariosBusyPackageId={scenariosBusyId}
        runningScenarioId={runningScenarioId}
        graph={run.graph ?? null}
        onAnalyzeGraph={onAnalyzeGraph}
        graphBusy={graphBusy}
        explanations={explanations}
        onExplain={onExplain}
        explainBusy={explainBusy}
        history={history}
        onCompareRuns={onCompareRuns}
        prReview={prReview}
        onAnalyzePr={onAnalyzePr}
        prBusy={prBusy}
        workspaceStack={workspaceStack}
        intel={intel}
        onAnalyzeApi={onAnalyzeApi}
        apiBusy={apiBusy}
        refactorPlans={refactorPlans}
        refactorVariant={refactorVariant}
        onSelectRefactorVariant={setRefactorVariant}
        onAnalyzeRefactor={onAnalyzeRefactor}
        onGenerateAlternatives={onGenerateAlternatives}
        refactorBusy={refactorBusy}
        fixPlan={fixPlan}
        fixResults={fixResults}
        onAnalyzeFixes={onAnalyzeFixes}
        onApplyFix={onApplyFix}
        onUndoFix={onUndoFix}
        fixBusyId={fixBusyId}
        fixBusy={fixBusy}
        chatMessages={chatMessages}
        chatPrompts={CHAT_PROMPTS}
        onAskChat={onAskChat}
        onChatPackageClick={onChatPackageClick}
        chatBusy={chatBusy}
      />
      <footer className="pw-statusbar">
        <span
          className={`pw-worker pw-worker--${worker}`}
          title={`Engine worker: ${worker}${workerMem ? ` · ${workerMem} MB` : ""}`}
        />
        <span>
          {status ||
            `${run.workspace.name ?? "workspace"} · ${run.summary.totalPackages} package(s)`}
        </span>
        {busy && workerMem ? (
          <span className="pw-muted">· worker {workerMem} MB</span>
        ) : null}
        {busy && (
          <span className="pw-statusbar__progress">
            · {progress}% {phaseLabel}
            <button className="pw-statusbar__cancel" onClick={onCancel}>
              Cancel
            </button>
          </span>
        )}
        <span className="pw-statusbar__hint">⌘K for commands</span>
      </footer>
      {palette}
    </div>
  );
}
