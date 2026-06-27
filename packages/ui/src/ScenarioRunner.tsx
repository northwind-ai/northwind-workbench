import { useState } from "react";
import type {
  ScenarioResult,
  ScenarioRunResult,
} from "@package-workbench/core";

export interface ScenarioMeta {
  id: string;
  title: string;
}

export interface ScenarioRunnerProps {
  /** The latest run for this package, if scenarios have been executed. */
  run: ScenarioRunResult | null;
  /** Scenarios available to run (from plugins), for pre-run listing + run-one. */
  available?: ScenarioMeta[];
  onRunAll?: () => void;
  onRunOne?: (scenarioId: string) => void;
  busy?: boolean;
  runningId?: string | null;
}

const ICON: Record<ScenarioResult["status"], string> = {
  pass: "✓",
  fail: "✗",
  skip: "·",
};

/**
 * The Scenario Runner tab. Lists scenarios, runs all or one, and shows
 * durations, pass rate, captured logs, and assertion failures.
 */
export function ScenarioRunner({
  run,
  available = [],
  onRunAll,
  onRunOne,
  busy,
  runningId,
}: ScenarioRunnerProps) {
  const [open, setOpen] = useState<string | null>(null);

  const resultById = new Map((run?.results ?? []).map((r) => [r.id, r]));
  // Union of executed results + statically-available scenarios.
  const rows: ScenarioMeta[] = available.length
    ? available
    : (run?.results ?? []).map((r) => ({ id: r.id, title: r.title }));

  if (rows.length === 0) {
    return (
      <div className="pw-rt-empty">
        <p className="pw-muted">
          No plugin contributes scenarios for this package.
        </p>
      </div>
    );
  }

  const pct = run ? Math.round(run.passRate * 100) : null;

  return (
    <section className="pw-scn">
      <header className="pw-scn__head">
        <div className="pw-scn__title">
          <strong>Scenarios</strong>
          {run && (
            <span className="pw-muted">
              {" "}
              · {run.passed}/{run.total} passed
              {run.skipped ? `, ${run.skipped} skipped` : ""} · {run.durationMs}
              ms
            </span>
          )}
        </div>
        <button className="pw-btn" disabled={busy} onClick={() => onRunAll?.()}>
          {busy && !runningId ? "Running…" : "Run all"}
        </button>
      </header>

      {pct !== null && (
        <div className="pw-scn__bar" title={`${pct}% pass rate`}>
          <div
            className="pw-scn__barfill"
            style={{
              width: `${pct}%`,
              background:
                pct === 100 ? "#1f9d55" : pct >= 50 ? "#d97706" : "#dc2626",
            }}
          />
        </div>
      )}

      <ul className="pw-scn__list">
        {rows.map((meta) => {
          const result = resultById.get(meta.id) ?? null;
          const status = result?.status ?? "pending";
          const isRunning = runningId === meta.id;
          const expandable = Boolean(
            result &&
            (result.logs.length || result.assertions.length || result.error),
          );
          const isOpen = open === meta.id;
          return (
            <li key={meta.id} className={`pw-scn__row is-${status}`}>
              <div className="pw-scn__rowmain">
                <button
                  className="pw-scn__rowbtn"
                  onClick={() => expandable && setOpen(isOpen ? null : meta.id)}
                  aria-expanded={isOpen}
                >
                  <span className="pw-scn__mark">
                    {isRunning
                      ? "⟳"
                      : (ICON[status as ScenarioResult["status"]] ?? "○")}
                  </span>
                  <span className="pw-scn__name">{meta.title}</span>
                  {result?.category && (
                    <span className="pw-scn__cat">{result.category}</span>
                  )}
                  {result && (
                    <span className="pw-check__time">
                      {result.durationMs}ms
                    </span>
                  )}
                </button>
                <button
                  className="pw-btn pw-btn--ghost pw-btn--sm"
                  disabled={busy}
                  onClick={() => onRunOne?.(meta.id)}
                >
                  Run
                </button>
              </div>
              {isOpen && result && (
                <div className="pw-scn__detail">
                  {result.assertions
                    .filter((a) => !a.ok)
                    .map((a, i) => (
                      <p key={i} className="pw-scn__assert">
                        ✗ {a.message}
                      </p>
                    ))}
                  {result.error && result.category !== "assertion" && (
                    <p className="pw-scn__assert">
                      {result.error.type}: {result.error.message}
                    </p>
                  )}
                  {result.logs.length > 0 && (
                    <pre className="pw-log">{result.logs.join("\n")}</pre>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
