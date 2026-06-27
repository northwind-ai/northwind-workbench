import { useMemo, useState } from "react";
import type { HistoricalRun, RunDelta } from "@package-workbench/core";

export interface HistoricalRunsViewProps {
  runs: HistoricalRun[];
  /** Compute a delta between two stored runs (previous, current). */
  onCompare?: (
    previousId: string,
    currentId: string,
  ) => Promise<RunDelta | null>;
  busy?: boolean;
}

const scoreColor = (s: number): string =>
  s >= 80 ? "#1f9d55" : s >= 60 ? "#d97706" : "#dc2626";

/**
 * Historical Runs: a per-branch run list with a score trend, per-run deltas, and
 * a two-run comparison showing regressions + improvements. All history/diff data
 * comes from core over IPC — this only renders it.
 */
export function HistoricalRunsView({
  runs,
  onCompare,
  busy,
}: HistoricalRunsViewProps) {
  const branches = useMemo(
    () =>
      [
        ...new Set(runs.map((r) => r.metadata.gitBranch).filter(Boolean)),
      ] as string[],
    [runs],
  );
  const [branch, setBranch] = useState<string>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [delta, setDelta] = useState<RunDelta | null>(null);

  // Newest first for the list; oldest→newest for the trend.
  const filtered = useMemo(
    () =>
      runs
        .filter((r) => branch === "all" || r.metadata.gitBranch === branch)
        .sort((a, b) =>
          b.metadata.timestamp.localeCompare(a.metadata.timestamp),
        ),
    [runs, branch],
  );
  const chrono = useMemo(() => [...filtered].reverse(), [filtered]);

  if (runs.length === 0) {
    return (
      <div className="pw-rt-empty">
        <p className="pw-muted">
          No runs recorded yet. Run a scan (or <code>package-workbench ci</code>
          ) to start building history.
        </p>
      </div>
    );
  }

  const toggle = async (id: string): Promise<void> => {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id].slice(-2);
    setSelected(next);
    if (next.length === 2 && onCompare) {
      // Older as previous, newer as current.
      const [a, b] = next.map((rid) => runs.find((r) => r.id === rid)!);
      const [prev, curr] =
        a!.metadata.timestamp <= b!.metadata.timestamp ? [a!, b!] : [b!, a!];
      setDelta(await onCompare(prev.id, curr.id));
    } else {
      setDelta(null);
    }
  };

  return (
    <section className="pw-hist">
      <header className="pw-hist__head">
        <strong>Historical Runs</strong>
        <span className="pw-muted"> · {filtered.length} run(s)</span>
        {branches.length > 0 && (
          <select
            className="pw-hist__branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="all">all branches</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        )}
      </header>

      <Trend runs={chrono} />

      <div className="pw-hist__list">
        {filtered.map((r, i) => {
          const prev = filtered[i + 1];
          const d = prev ? r.overallScore - prev.overallScore : 0;
          return (
            <button
              key={r.id}
              className={`pw-hist__row${selected.includes(r.id) ? " is-selected" : ""}`}
              onClick={() => toggle(r.id)}
            >
              <span
                className="pw-hist__score"
                style={{ background: scoreColor(r.overallScore) }}
              >
                {r.overallScore}
              </span>
              <span className="pw-hist__meta">
                <strong>
                  {new Date(r.metadata.timestamp).toLocaleString()}
                </strong>
                <small>
                  {r.metadata.gitBranch ?? "no branch"}
                  {r.metadata.gitCommit
                    ? ` · ${r.metadata.gitCommit.slice(0, 7)}`
                    : ""}{" "}
                  · {r.summary.failed} failed
                </small>
              </span>
              {prev && (
                <span
                  className="pw-hist__delta"
                  style={{
                    color: d < 0 ? "#dc2626" : d > 0 ? "#1f9d55" : "#9ca3af",
                  }}
                >
                  {d >= 0 ? "+" : ""}
                  {d}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="pw-hist__compare">
        {selected.length < 2 ? (
          <p className="pw-muted">
            Select two runs to compare {busy ? "· loading…" : ""}
          </p>
        ) : delta ? (
          <ComparePanel delta={delta} />
        ) : (
          <p className="pw-muted">Comparing…</p>
        )}
      </div>
    </section>
  );
}

function Trend({ runs }: { runs: HistoricalRun[] }) {
  if (runs.length < 2) return null;
  const w = 600;
  const h = 70;
  const max = 100;
  const step = w / (runs.length - 1);
  const pts = runs
    .map((r, i) => `${i * step},${h - (r.overallScore / max) * h}`)
    .join(" ");
  return (
    <div className="pw-hist__trend">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        width="100%"
        height={h}
      >
        <polyline points={pts} fill="none" stroke="#2563eb" strokeWidth={2} />
        {runs.map((r, i) => (
          <circle
            key={r.id}
            cx={i * step}
            cy={h - (r.overallScore / max) * h}
            r={3}
            fill={scoreColor(r.overallScore)}
          />
        ))}
      </svg>
    </div>
  );
}

function ComparePanel({ delta }: { delta: RunDelta }) {
  return (
    <div className="pw-hist__delta-panel">
      <h3>{delta.summary}</h3>
      {delta.regressions.length > 0 && (
        <>
          <h4>Regressions</h4>
          <ul>
            {delta.regressions.map((r, i) => (
              <li
                key={i}
                className={`pw-vrow is-${r.severity === "critical" ? "high" : r.severity === "major" ? "medium" : "low"}`}
              >
                <span className="pw-vsev">{r.severity}</span> {r.detail}
              </li>
            ))}
          </ul>
        </>
      )}
      {delta.improvements.length > 0 && (
        <>
          <h4>Improvements</h4>
          <ul>
            {delta.improvements.map((im, i) => (
              <li key={i} className="pw-vrow is-low">
                ✓ {im.detail}
              </li>
            ))}
          </ul>
        </>
      )}
      {delta.regressions.length === 0 && delta.improvements.length === 0 && (
        <p className="pw-muted">No package-level changes.</p>
      )}
    </div>
  );
}
