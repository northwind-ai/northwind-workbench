import type {
  DependencyWeightReport,
  ExportUsageReport,
  SizeReport,
  UsageClass,
} from "@package-workbench/core";

/**
 * The "API Surface" tab: a package's exports with usage count, consumers,
 * confidence and a conservative risk label, plus a Size section (output size,
 * largest files, dependency-weight warnings, historical delta).
 *
 * Pure + presentational. Deletion language is deliberately cautious — only
 * `definitely-dead` (private + unused) is labelled "safe to remove".
 */

export interface ApiSurfacePanelProps {
  usage?: ExportUsageReport | null;
  size?: SizeReport | null;
  dependencyWeight?: DependencyWeightReport | null;
  onAnalyze?: () => void;
  busy?: boolean;
}

const CLASS_LABEL: Record<
  UsageClass,
  { label: string; color: string; risk: string }
> = {
  used: { label: "Used", color: "#1f9d55", risk: "safe" },
  "unused-internally": {
    label: "Unused internally",
    color: "#d97706",
    risk: "review",
  },
  "public-api-unknown": {
    label: "Public API (unknown)",
    color: "#6366f1",
    risk: "keep",
  },
  "likely-dead": { label: "Likely dead", color: "#ea580c", risk: "review" },
  "definitely-dead": {
    label: "Definitely dead",
    color: "#dc2626",
    risk: "safe to remove",
  },
};

const KB = 1024;
const kb = (b: number) => `${Math.round(b / KB)} KB`;

export function ApiSurfacePanel({
  usage,
  size,
  dependencyWeight,
  onAnalyze,
  busy,
}: ApiSurfacePanelProps) {
  if (!usage && !size) {
    return (
      <div className="pw-api pw-api--empty">
        <p className="pw-muted">
          Analyze the package's export surface, size, and dependency weight.
        </p>
        {onAnalyze && (
          <button className="pw-btn" disabled={busy} onClick={onAnalyze}>
            {busy ? "Analyzing…" : "Analyze API & size"}
          </button>
        )}
      </div>
    );
  }

  const flagged = usage?.exports.filter((e) => e.usageClass !== "used") ?? [];

  return (
    <div className="pw-api">
      {onAnalyze && (
        <div className="pw-api__toolbar">
          <button
            className="pw-btn pw-btn--ghost"
            disabled={busy}
            onClick={onAnalyze}
          >
            {busy ? "Analyzing…" : "Re-analyze"}
          </button>
        </div>
      )}

      {/* Size section */}
      {size && (
        <section className="pw-api__card">
          <h3>Size</h3>
          {!size.measured ? (
            <p className="pw-muted">
              {size.note ?? "No build output to measure."}
            </p>
          ) : (
            <>
              <div className="pw-metrics">
                <Metric
                  value={kb(size.totalBytes)}
                  label={`output (${size.outputDir})`}
                />
                {size.gzipBytes != null && (
                  <Metric value={kb(size.gzipBytes)} label="gzip" />
                )}
                <Metric value={String(size.fileCount)} label="files" />
                {size.delta && (
                  <Metric
                    value={`${size.delta.deltaBytes >= 0 ? "+" : ""}${kb(size.delta.deltaBytes)}`}
                    label="vs baseline"
                  />
                )}
              </div>
              {size.largestFiles.length > 0 && (
                <ul className="pw-api__files">
                  {size.largestFiles.map((f) => (
                    <li key={f.file}>
                      <code>{f.file}</code>{" "}
                      <span className="pw-muted">
                        {kb(f.bytes)}
                        {f.gzipBytes != null ? ` · ${kb(f.gzipBytes)} gz` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {size.heavyClientDeps.length > 0 && (
                <p className="pw-api__heavy">
                  Heavy client deps: {size.heavyClientDeps.join(", ")}
                </p>
              )}
            </>
          )}
        </section>
      )}

      {/* Dependency weight */}
      {dependencyWeight && dependencyWeight.issues.length > 0 && (
        <section className="pw-api__card">
          <h3>Dependency weight</h3>
          <ul className="pw-api__issues">
            {dependencyWeight.issues.map((i, idx) => (
              <li key={idx}>
                <span
                  className={`pw-api__issuekind pw-api__issuekind--${i.kind}`}
                >
                  {i.kind}
                </span>{" "}
                <code>{i.dependency}</code> — {i.detail}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Export surface */}
      {usage && (
        <section className="pw-api__card">
          <h3>
            Exports{" "}
            <span className="pw-muted">
              ({usage.summary.used} used · {usage.summary["public-api-unknown"]}{" "}
              public · {usage.summary["likely-dead"]} likely-dead ·{" "}
              {usage.summary["definitely-dead"]} dead)
            </span>
          </h3>
          {flagged.length === 0 ? (
            <p className="pw-muted">
              All exports are used internally (or are public API).
            </p>
          ) : (
            <table className="pw-api__table">
              <thead>
                <tr>
                  <th>Export</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Uses</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {flagged.map((e) => {
                  const meta = CLASS_LABEL[e.usageClass];
                  return (
                    <tr
                      key={`${e.symbol.name}:${e.symbol.file}`}
                      title={e.note}
                    >
                      <td>
                        <code>{e.symbol.name}</code>
                      </td>
                      <td className="pw-muted">{e.symbol.kind}</td>
                      <td>
                        <span
                          className="pw-api__class"
                          style={{ background: meta.color }}
                        >
                          {meta.label}
                        </span>
                      </td>
                      <td className="pw-api__num">{e.internalUses}</td>
                      <td className="pw-api__num">
                        {Math.round(e.confidence * 100)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {usage.staleReExports.length > 0 && (
            <p className="pw-api__stale">
              ⚠️ {usage.staleReExports.length} stale re-export(s) forwarding
              unused symbols.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="pw-metric">
      <span className="pw-metric__value">{value}</span>
      <span className="pw-metric__label">{label}</span>
    </div>
  );
}
