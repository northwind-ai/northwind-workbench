import { useState } from "react";
import type {
  DependencyNode,
  DependencyWeightReport,
  ExportUsageReport,
  FailureExplanation,
  HealthCheckSeverity,
  HistoricalRun,
  PackageHealthReport,
  PackageManager,
  SizeReport,
} from "@package-workbench/core";
import { HealthScore } from "./HealthScore";
import { ConfidenceBadge, StatusBadge, Tag } from "./badges";
import { FailureLog } from "./FailureLog";
import { FailureExplain } from "./FailureExplain";
import { AiAssistantPanel } from "./AiAssistantPanel";
import { ApiSurfacePanel } from "./ApiSurfacePanel";
import { RuntimeMatrix } from "./RuntimeMatrix";
import { ScenarioRunner, type ScenarioMeta } from "./ScenarioRunner";

const SEVERITY_COLOR: Record<HealthCheckSeverity, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#d97706",
  low: "#65a30d",
  info: "#9ca3af",
};

type Tab =
  | "overview"
  | "health"
  | "runtime"
  | "scenarios"
  | "assistant"
  | "api";

export interface PackageDetailsProps {
  report: PackageHealthReport | null;
  onRun?: (packageId: string) => void;
  busy?: boolean;
  packageManager?: PackageManager;
  /** This package's node in the dependency graph, for fan-in/out. */
  graphNode?: DependencyNode | null;
  /** Run history, for the per-package score trend. */
  history?: HistoricalRun[];
  /** Runtime panel. */
  onAnalyzeRuntime?: (packageId: string) => void;
  runtimeBusy?: boolean;
  /** Scenario panel. */
  availableScenarios?: ScenarioMeta[];
  onRunScenarios?: (packageId: string) => void;
  onRunScenario?: (packageId: string, scenarioId: string) => void;
  scenariosBusy?: boolean;
  runningScenarioId?: string | null;
  /** AI Assistant panel: failure explanations for this package. */
  explanations?: FailureExplanation[];
  onExplain?: (packageId: string) => void;
  explainBusy?: boolean;
  onOpenFile?: (file: string) => void;
  /** API Surface tab: export usage, size, and dependency-weight for this package. */
  apiUsage?: ExportUsageReport | null;
  apiSize?: SizeReport | null;
  apiDependencyWeight?: DependencyWeightReport | null;
  onAnalyzeApi?: (packageId: string) => void;
  apiBusy?: boolean;
}

/** Right-hand details panel: score header + Overview / Health / Runtime / Scenarios tabs. */
export function PackageDetails(props: PackageDetailsProps) {
  const { report, onRun, busy } = props;
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  if (!report) {
    return (
      <div className="pw-empty">Select a package to see its health report.</div>
    );
  }

  const { package: pkg } = report;
  const depCount =
    Object.keys(pkg.dependencies).length +
    Object.keys(pkg.devDependencies).length +
    Object.keys(pkg.peerDependencies).length;

  return (
    <section className="pw-details">
      <header className="pw-details__head">
        <HealthScore score={report.score} status={report.status} />
        <div className="pw-details__title">
          <h1>{pkg.name}</h1>
          <p className="pw-muted">
            v{pkg.version} · {pkg.root}
          </p>
          <div className="pw-tags">
            <ConfidenceBadge confidence={report.confidence} />
            <Tag>{pkg.packageType}</Tag>
            <Tag>{pkg.runtime}</Tag>
            {pkg.private && <Tag>private</Tag>}
          </div>
        </div>
        <button
          className="pw-btn"
          disabled={busy || !onRun}
          onClick={() => onRun?.(pkg.id)}
        >
          {busy ? "Running…" : "Run checks"}
        </button>
      </header>

      <nav className="pw-tabs" role="tablist">
        {(
          [
            "overview",
            "health",
            "runtime",
            "scenarios",
            "assistant",
            "api",
          ] as const
        ).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`pw-tab${tab === t ? " is-active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "overview"
              ? "Overview"
              : t === "health"
                ? "Health"
                : t === "runtime"
                  ? `Runtime${report.runtime ? ` · ${runtimeSummary(report)}` : ""}`
                  : t === "scenarios"
                    ? `Scenarios${report.scenarios ? ` · ${report.scenarios.passed}/${report.scenarios.total}` : ""}`
                    : t === "assistant"
                      ? `AI Assistant${props.explanations?.length ? ` · ${props.explanations.length}` : ""}`
                      : "API Surface"}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="pw-overview">
          <div className="pw-metrics">
            <Metric label="Health" value={`${report.score}/100`} />
            <Metric label="Confidence" value={report.confidence} />
            <Metric
              label="Runtime"
              value={report.runtime ? runtimeSummary(report) : "not analyzed"}
            />
            <Metric
              label="Scenarios"
              value={
                report.scenarios
                  ? `${Math.round(report.scenarios.passRate * 100)}%`
                  : "—"
              }
            />
            <Metric label="Dependencies" value={String(depCount)} />
            <Metric
              label="Fan-in"
              value={
                props.graphNode ? String(props.graphNode.metrics.fanIn) : "—"
              }
            />
            <Metric
              label="Fan-out"
              value={
                props.graphNode ? String(props.graphNode.metrics.fanOut) : "—"
              }
            />
            <Metric
              label="Failing checks"
              value={String(
                report.checks.filter((c) => c.status === "fail").length,
              )}
            />
          </div>
          <PackageTrend history={props.history} packageId={pkg.id} />
        </div>
      )}

      {tab === "health" && (
        <>
          {pkg.warnings.length > 0 && (
            <div className="pw-warnings" role="alert">
              <strong>Scan warnings</strong>
              <ul>
                {pkg.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <ul className="pw-checks">
            {report.checks.map((c) => {
              const expandable = Boolean(
                c.evidence?.length ||
                c.details ||
                c.status === "fail" ||
                c.status === "warn",
              );
              const isOpen = open === c.checkId;
              const explainable = c.status === "fail" || c.status === "warn";
              return (
                <li key={c.checkId} className={`pw-check is-${c.status}`}>
                  <button
                    className="pw-check__row"
                    onClick={() =>
                      expandable && setOpen(isOpen ? null : c.checkId)
                    }
                    aria-expanded={isOpen}
                  >
                    <StatusBadge status={c.status} />
                    <span className="pw-check__title">{c.label}</span>
                    <span className="pw-check__summary">{c.summary}</span>
                    <span
                      className="pw-check__sev"
                      style={{ color: SEVERITY_COLOR[c.severity] }}
                    >
                      {c.severity}
                    </span>
                    {typeof c.durationMs === "number" && (
                      <span className="pw-check__time">{c.durationMs}ms</span>
                    )}
                    {expandable && (
                      <span className="pw-check__chev">
                        {isOpen ? "▾" : "▸"}
                      </span>
                    )}
                  </button>
                  {isOpen && (
                    <div className="pw-check__body">
                      {explainable ? (
                        <FailureExplain
                          result={c}
                          packageManager={props.packageManager}
                        />
                      ) : (
                        <>
                          {c.details && <p className="pw-muted">{c.details}</p>}
                          <FailureLog result={c} />
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === "runtime" && (
        <RuntimeMatrix
          report={report.runtime ?? null}
          onAnalyze={() => props.onAnalyzeRuntime?.(pkg.id)}
          busy={props.runtimeBusy}
        />
      )}

      {tab === "scenarios" && (
        <ScenarioRunner
          run={report.scenarios ?? null}
          available={props.availableScenarios}
          onRunAll={() => props.onRunScenarios?.(pkg.id)}
          onRunOne={(id) => props.onRunScenario?.(pkg.id, id)}
          busy={props.scenariosBusy}
          runningId={props.runningScenarioId}
        />
      )}

      {tab === "assistant" && (
        <AiAssistantPanel
          explanations={props.explanations ?? []}
          onExplain={
            props.onExplain ? () => props.onExplain?.(pkg.id) : undefined
          }
          busy={props.explainBusy}
          onOpenFile={props.onOpenFile}
        />
      )}

      {tab === "api" && (
        <ApiSurfacePanel
          usage={props.apiUsage ?? null}
          size={props.apiSize ?? null}
          dependencyWeight={props.apiDependencyWeight ?? null}
          onAnalyze={
            props.onAnalyzeApi ? () => props.onAnalyzeApi?.(pkg.id) : undefined
          }
          busy={props.apiBusy}
        />
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="pw-metric">
      <span className="pw-metric__value">{value}</span>
      <span className="pw-metric__label">{label}</span>
    </div>
  );
}

/** A per-package score sparkline across run history. */
function PackageTrend({
  history,
  packageId,
}: {
  history?: HistoricalRun[];
  packageId: string;
}) {
  if (!history || history.length < 2) return null;
  const chrono = [...history].sort((a, b) =>
    a.metadata.timestamp.localeCompare(b.metadata.timestamp),
  );
  const scores = chrono
    .map((run) => run.packages.find((p) => p.id === packageId)?.score)
    .filter((s): s is number => typeof s === "number");
  if (scores.length < 2) return null;
  const w = 280;
  const h = 48;
  const step = w / (scores.length - 1);
  const pts = scores
    .map((s, i) => `${i * step},${h - (s / 100) * h}`)
    .join(" ");
  return (
    <div className="pw-overview__trend">
      <span className="pw-muted">Score trend</span>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        preserveAspectRatio="none"
      >
        <polyline points={pts} fill="none" stroke="#2563eb" strokeWidth={2} />
      </svg>
    </div>
  );
}

/** Short worst-wins summary of the runtime matrix for the tab label. */
function runtimeSummary(report: PackageHealthReport): string {
  const statuses = Object.values(report.runtime!.matrix);
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn")) return "warn";
  if (statuses.some((s) => s === "pass")) return "pass";
  return "—";
}
