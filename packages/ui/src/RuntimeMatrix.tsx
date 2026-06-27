import { useState } from "react";
import {
  RUNTIME_TARGET_LABEL,
  RUNTIME_TARGETS,
  type RuntimeCompatibilityReport,
} from "@package-workbench/plugin-sdk";
import { RuntimeStatusBadge } from "./badges";

export interface RuntimeMatrixProps {
  report: RuntimeCompatibilityReport | null;
  onAnalyze?: () => void;
  busy?: boolean;
}

/**
 * The Runtime Compatibility panel. Renders the 5-target matrix with status
 * indicators, the detection summary, and expandable per-target failure reasons.
 * Falls back to an "Analyze" call-to-action when no report has been computed yet.
 */
export function RuntimeMatrix({ report, onAnalyze, busy }: RuntimeMatrixProps) {
  const [open, setOpen] = useState<string | null>(null);

  if (!report) {
    return (
      <div className="pw-rt-empty">
        <p className="pw-muted">
          Runtime analysis imports the package in a sandboxed Node process to
          verify it actually loads.
        </p>
        <button
          className="pw-btn"
          disabled={busy}
          onClick={() => onAnalyze?.()}
        >
          {busy ? "Analyzing…" : "Analyze runtime compatibility"}
        </button>
      </div>
    );
  }

  const byTarget = new Map(report.targets.map((t) => [t.target, t]));

  return (
    <section className="pw-rt">
      <header className="pw-rt__head">
        <div>
          <strong>Runtime Matrix</strong>
          <span className="pw-muted">
            {" "}
            · detected {report.detection.primary} (
            {Math.round(report.detection.confidence * 100)}% confidence)
          </span>
        </div>
        <button
          className="pw-btn pw-btn--ghost"
          disabled={busy}
          onClick={() => onAnalyze?.()}
        >
          {busy ? "Analyzing…" : "Re-analyze"}
        </button>
      </header>

      <ul className="pw-rt__list">
        {RUNTIME_TARGETS.map((target) => {
          const cell = byTarget.get(target);
          const status = cell?.status ?? "unknown";
          const expandable = Boolean(cell?.reason || cell?.evidence?.length);
          const isOpen = open === target;
          return (
            <li key={target} className={`pw-rt__row is-${status}`}>
              <button
                className="pw-rt__rowbtn"
                onClick={() => expandable && setOpen(isOpen ? null : target)}
                aria-expanded={isOpen}
              >
                <span className="pw-rt__name">
                  {RUNTIME_TARGET_LABEL[target]}
                </span>
                {!cell?.intended && (
                  <span className="pw-rt__intent">not targeted</span>
                )}
                <RuntimeStatusBadge status={status} />
                {expandable && (
                  <span className="pw-check__chev">{isOpen ? "▾" : "▸"}</span>
                )}
              </button>
              {isOpen && cell && (
                <div className="pw-rt__detail">
                  <p>{cell.reason}</p>
                  {cell.execution?.missingModule && (
                    <p className="pw-muted">
                      Missing module: {cell.execution.missingModule}
                    </p>
                  )}
                  {cell.execution?.offendingFile && (
                    <p className="pw-muted">
                      Offending file: {cell.execution.offendingFile}
                    </p>
                  )}
                  {cell.evidence?.length ? (
                    <pre className="pw-log">{cell.evidence.join("\n\n")}</pre>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {report.nodeBuiltinsUsed.length > 0 && (
        <div className="pw-rt__builtins">
          <strong>Node built-ins used:</strong>{" "}
          {report.nodeBuiltinsUsed.join(", ")}
        </div>
      )}

      {report.resolution.some((r) => !r.resolved) && (
        <div className="pw-warnings">
          <strong>Unresolved targets</strong>
          <ul>
            {report.resolution
              .filter((r) => !r.resolved)
              .map((r, i) => (
                <li key={i}>
                  {r.specifier} — {r.error}
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
