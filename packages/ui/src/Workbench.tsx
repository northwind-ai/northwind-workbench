import { useEffect, useMemo, useState } from "react";
import type {
  DependencyGraph,
  FailureExplanation,
  HistoricalRun,
  FixPlan,
  FixCandidate,
  FixResult,
  PackageIntelligenceReport,
  PrReview,
  RefactorPlan,
  RunDelta,
  WorkbenchRun,
  WorkspaceStack,
} from "@package-workbench/core";
import { PackageList } from "./PackageList";
import { PackageDetails } from "./PackageDetails";
import { DependencyGraphView } from "./DependencyGraphView";
import { HistoricalRunsView } from "./HistoricalRunsView";
import { PrReviewView } from "./PrReviewView";
import { RefactorPanel } from "./RefactorPanel";
import { FixesPanel } from "./FixesPanel";
import { ChatPanel, type ChatMessage } from "./ChatPanel";
import { WorkspaceStackBadge } from "./WorkspaceStackBadge";
import { FilterBar } from "./FilterBar";
import { ThemeToggle } from "./ThemeToggle";
import { SkeletonList, SkeletonDetails } from "./Skeleton";
import { applyFilters, emptyFilter, type PackageFilter } from "./filter";
import type { ThemePreference } from "./theme";
import type { ScenarioMeta } from "./ScenarioRunner";

export interface WorkbenchProps {
  run: WorkbenchRun | null;
  onOpenWorkspace?: () => void;
  onRunAll?: () => void;
  onRunPackage?: (packageId: string) => void;
  /** Global busy (scanning / running all). */
  busy?: boolean;
  /** Per-package busy (running one). */
  busyPackageId?: string | null;
  title?: string;
  /** Runtime panel wiring. */
  onAnalyzeRuntime?: (packageId: string) => void;
  runtimeBusyPackageId?: string | null;
  /** Scenario panel wiring. */
  availableScenarios?: ScenarioMeta[];
  onRunScenarios?: (packageId: string) => void;
  onRunScenario?: (packageId: string, scenarioId: string) => void;
  scenariosBusyPackageId?: string | null;
  runningScenarioId?: string | null;
  /** Controlled selection (optional). When omitted, selection is internal. */
  selectedId?: string | null;
  onSelectPackage?: (packageId: string) => void;
  /** Dependency graph view. */
  graph?: DependencyGraph | null;
  onAnalyzeGraph?: () => void;
  graphBusy?: boolean;
  /** AI Assistant panel wiring (failure explanations, keyed by package). */
  explanations?: FailureExplanation[];
  onExplain?: () => void;
  explainBusy?: boolean;
  onOpenFile?: (file: string) => void;
  /** Historical runs view. */
  history?: HistoricalRun[];
  onCompareRuns?: (
    previousId: string,
    currentId: string,
  ) => Promise<RunDelta | null>;
  historyBusy?: boolean;
  /** PR Review tab. */
  prReview?: PrReview | null;
  onAnalyzePr?: () => void;
  prBusy?: boolean;
  /** Detected workspace adapter stack (shown in the banner). */
  workspaceStack?: WorkspaceStack | null;
  /** Package intelligence (exports/usage/size/deps) for the API Surface tab. */
  intel?: PackageIntelligenceReport | null;
  onAnalyzeApi?: () => void;
  apiBusy?: boolean;
  /** Refactor Architect tab. */
  refactorPlans?: RefactorPlan[];
  refactorVariant?: number;
  onSelectRefactorVariant?: (variant: number) => void;
  onAnalyzeRefactor?: () => void;
  onGenerateAlternatives?: () => void;
  refactorBusy?: boolean;
  /** Auto Fix tab. */
  fixPlan?: FixPlan | null;
  fixResults?: Record<string, FixResult>;
  onAnalyzeFixes?: () => void;
  onApplyFix?: (candidate: FixCandidate) => void;
  onUndoFix?: () => void;
  fixBusyId?: string | null;
  fixBusy?: boolean;
  /** AI Codebase Chat tab. */
  chatMessages?: ChatMessage[];
  chatPrompts?: string[];
  onAskChat?: (question: string) => void;
  onChatPackageClick?: (packageId: string) => void;
  chatBusy?: boolean;
  /** Theme. */
  themePreference?: ThemePreference;
  onCycleTheme?: () => void;
  /** Show skeletons while the first scan is in flight. */
  loading?: boolean;
  /** Controlled view mode (e.g. driven by the command palette). */
  mode?:
    | "packages"
    | "graph"
    | "history"
    | "pr"
    | "refactor"
    | "fixes"
    | "chat";
  onModeChange?: (
    mode:
      | "packages"
      | "graph"
      | "history"
      | "pr"
      | "refactor"
      | "fixes"
      | "chat",
  ) => void;
}

/**
 * Top-level layout: toolbar + workspace banner + sidebar + details. Owns only
 * selection state; all data + actions are passed in. Host-agnostic — the same
 * component mounts in Electron and (future) web.
 */
export function Workbench({
  run,
  onOpenWorkspace,
  onRunAll,
  onRunPackage,
  busy,
  busyPackageId,
  title = "Package Workbench",
  onAnalyzeRuntime,
  runtimeBusyPackageId,
  availableScenarios,
  onRunScenarios,
  onRunScenario,
  scenariosBusyPackageId,
  runningScenarioId,
  selectedId: controlledId,
  onSelectPackage,
  graph,
  onAnalyzeGraph,
  graphBusy,
  explanations,
  onExplain,
  explainBusy,
  onOpenFile,
  history,
  onCompareRuns,
  historyBusy,
  prReview,
  onAnalyzePr,
  prBusy,
  workspaceStack,
  intel,
  onAnalyzeApi,
  apiBusy,
  refactorPlans,
  refactorVariant,
  onSelectRefactorVariant,
  onAnalyzeRefactor,
  onGenerateAlternatives,
  refactorBusy,
  fixPlan,
  fixResults,
  onAnalyzeFixes,
  onApplyFix,
  onUndoFix,
  fixBusyId,
  fixBusy,
  chatMessages,
  chatPrompts,
  onAskChat,
  onChatPackageClick,
  chatBusy,
  themePreference,
  onCycleTheme,
  loading,
  mode: controlledMode,
  onModeChange,
}: WorkbenchProps) {
  const [internalMode, setInternalMode] = useState<
    "packages" | "graph" | "history" | "pr" | "refactor" | "fixes" | "chat"
  >("packages");
  const mode = controlledMode ?? internalMode;
  const setMode = (
    m: "packages" | "graph" | "history" | "pr" | "refactor" | "fixes" | "chat",
  ) => {
    onModeChange?.(m);
    if (controlledMode === undefined) setInternalMode(m);
  };
  const [filter, setFilter] = useState<PackageFilter>(emptyFilter);
  const reports = run?.reports ?? [];
  const filteredReports = useMemo(
    () => applyFilters(reports, filter),
    [reports, filter],
  );
  const controlled = controlledId !== undefined;
  const [internalId, setInternalId] = useState<string | null>(
    reports[0]?.package.id ?? null,
  );
  const selectedId = controlled ? controlledId : internalId;

  const setSelectedId = (id: string) => {
    onSelectPackage?.(id);
    if (!controlled) setInternalId(id);
  };

  useEffect(() => {
    if (controlled) return; // parent owns selection
    if (reports.length === 0) setInternalId(null);
    else if (!reports.some((r) => r.package.id === internalId))
      setInternalId(reports[0]!.package.id);
  }, [reports, internalId, controlled]);

  const selected = reports.find((r) => r.package.id === selectedId) ?? null;
  const summary = run?.summary;
  const ws = run?.workspace;

  return (
    <div className="pw-shell">
      <header className="pw-toolbar">
        <strong>{title}</strong>
        <div className="pw-segment" role="tablist">
          <button
            className={`pw-segment__btn${mode === "packages" ? " is-active" : ""}`}
            onClick={() => setMode("packages")}
          >
            Packages
          </button>
          <button
            className={`pw-segment__btn${mode === "graph" ? " is-active" : ""}`}
            onClick={() => setMode("graph")}
          >
            Dependency Graph
          </button>
          <button
            className={`pw-segment__btn${mode === "history" ? " is-active" : ""}`}
            onClick={() => setMode("history")}
          >
            History
          </button>
          <button
            className={`pw-segment__btn${mode === "pr" ? " is-active" : ""}`}
            onClick={() => setMode("pr")}
          >
            PR Review
          </button>
          <button
            className={`pw-segment__btn${mode === "refactor" ? " is-active" : ""}`}
            onClick={() => setMode("refactor")}
          >
            Refactor
          </button>
          <button
            className={`pw-segment__btn${mode === "fixes" ? " is-active" : ""}`}
            onClick={() => setMode("fixes")}
          >
            Fixes
          </button>
          <button
            className={`pw-segment__btn${mode === "chat" ? " is-active" : ""}`}
            onClick={() => setMode("chat")}
          >
            Chat
          </button>
        </div>
        <div className="pw-toolbar__actions">
          {themePreference && onCycleTheme && (
            <ThemeToggle preference={themePreference} onCycle={onCycleTheme} />
          )}
          <button
            className="pw-btn pw-btn--ghost"
            disabled={busy}
            onClick={() => onOpenWorkspace?.()}
          >
            Open Workspace…
          </button>
          <button
            className="pw-btn"
            disabled={busy || !run}
            onClick={() => onRunAll?.()}
          >
            {busy ? "Working…" : "Run all checks"}
          </button>
        </div>
      </header>

      {ws && (
        <div className="pw-banner">
          <span className="pw-banner__name">{ws.name ?? ws.root}</span>
          <span className="pw-tag">{ws.packageManager}</span>
          {ws.isMonorepo && <span className="pw-tag">monorepo</span>}
          {ws.tooling.nx && <span className="pw-tag">nx</span>}
          {ws.tooling.turbo && <span className="pw-tag">turbo</span>}
          {ws.tooling.pnpmWorkspace && (
            <span className="pw-tag">pnpm-workspace</span>
          )}
          {summary && (
            <span className="pw-banner__summary">
              <b style={{ color: "#1f9d55" }}>{summary.passed} pass</b> ·{" "}
              <b style={{ color: "#d97706" }}>{summary.warned} warn</b> ·{" "}
              <b style={{ color: "#dc2626" }}>{summary.failed} fail</b> · avg{" "}
              {summary.averageScore}/100
            </span>
          )}
          {workspaceStack && <WorkspaceStackBadge stack={workspaceStack} />}
        </div>
      )}

      {mode === "graph" ? (
        <div className="pw-app pw-app--full">
          <DependencyGraphView
            graph={graph ?? null}
            onAnalyze={onAnalyzeGraph}
            busy={graphBusy}
          />
        </div>
      ) : mode === "history" ? (
        <div className="pw-app pw-app--full">
          <HistoricalRunsView
            runs={history ?? []}
            onCompare={onCompareRuns}
            busy={historyBusy}
          />
        </div>
      ) : mode === "pr" ? (
        <div className="pw-app pw-app--full">
          <PrReviewView
            review={prReview ?? null}
            onAnalyze={onAnalyzePr}
            busy={prBusy}
          />
        </div>
      ) : mode === "refactor" ? (
        <div className="pw-app pw-app--full pw-app--scroll">
          <RefactorPanel
            plans={refactorPlans ?? []}
            activeVariant={refactorVariant ?? 0}
            onSelectVariant={onSelectRefactorVariant}
            onAnalyze={onAnalyzeRefactor}
            onGenerateAlternatives={onGenerateAlternatives}
            busy={refactorBusy}
          />
        </div>
      ) : mode === "fixes" ? (
        <div className="pw-app pw-app--full pw-app--scroll">
          <FixesPanel
            plan={fixPlan ?? null}
            results={fixResults}
            onAnalyze={onAnalyzeFixes}
            onApply={onApplyFix}
            onUndo={onUndoFix}
            busyId={fixBusyId}
            busy={fixBusy}
          />
        </div>
      ) : mode === "chat" ? (
        <div className="pw-app pw-app--full">
          <ChatPanel
            messages={chatMessages ?? []}
            prompts={chatPrompts ?? []}
            onAsk={(q) => onAskChat?.(q)}
            onPackageClick={onChatPackageClick}
            busy={chatBusy}
          />
        </div>
      ) : (
        <div className="pw-app">
          <aside className="pw-sidebar">
            <FilterBar
              filter={filter}
              onChange={setFilter}
              total={reports.length}
              shown={filteredReports.length}
            />
            {loading && reports.length === 0 ? (
              <SkeletonList />
            ) : (
              <PackageList
                reports={filteredReports}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}
          </aside>
          <main className="pw-main">
            {loading && !selected ? (
              <SkeletonDetails />
            ) : (
              <PackageDetails
                report={selected}
                onRun={onRunPackage}
                busy={Boolean(
                  selected && busyPackageId === selected.package.id,
                )}
                packageManager={ws?.packageManager}
                graphNode={
                  graph?.nodes.find((n) => n.id === selectedId) ?? null
                }
                history={history}
                onAnalyzeRuntime={onAnalyzeRuntime}
                runtimeBusy={Boolean(
                  selected && runtimeBusyPackageId === selected.package.id,
                )}
                availableScenarios={availableScenarios}
                onRunScenarios={onRunScenarios}
                onRunScenario={onRunScenario}
                scenariosBusy={Boolean(
                  selected && scenariosBusyPackageId === selected.package.id,
                )}
                runningScenarioId={runningScenarioId}
                explanations={explanations?.filter(
                  (e) => e.input.context.packageId === selectedId,
                )}
                onExplain={onExplain ? () => onExplain() : undefined}
                explainBusy={explainBusy}
                onOpenFile={onOpenFile}
                apiUsage={
                  intel?.usage.find((u) => u.packageId === selectedId) ?? null
                }
                apiSize={
                  intel?.sizes.find((s) => s.packageId === selectedId) ?? null
                }
                apiDependencyWeight={
                  intel?.dependencyWeight.find(
                    (d) => d.packageId === selectedId,
                  ) ?? null
                }
                onAnalyzeApi={onAnalyzeApi ? () => onAnalyzeApi() : undefined}
                apiBusy={apiBusy}
              />
            )}
          </main>
        </div>
      )}
    </div>
  );
}
