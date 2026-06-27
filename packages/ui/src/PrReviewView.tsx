import type {
  PrReview,
  MergeRecommendation,
  RiskLevel,
} from "@package-workbench/core";

/**
 * The Desktop PR Review tab: changed packages, dependency-aware blast radius,
 * new failures, risk factors, and the merge recommendation — the same picture
 * the CI comment shows, explorable in the app.
 *
 * Pure + presentational: it renders a {@link PrReview} the engine computed.
 */

export interface PrReviewViewProps {
  review: PrReview | null;
  onAnalyze?: () => void;
  busy?: boolean;
}

const REC_COLOR: Record<MergeRecommendation, string> = {
  approve: "#1f9d55",
  warn: "#d97706",
  block: "#dc2626",
};
const REC_LABEL: Record<MergeRecommendation, string> = {
  approve: "Approve",
  warn: "Review recommended",
  block: "Block merge",
};
const RISK_COLOR: Record<RiskLevel, string> = {
  low: "#1f9d55",
  medium: "#d97706",
  high: "#ea580c",
  critical: "#dc2626",
};

export function PrReviewView({ review, onAnalyze, busy }: PrReviewViewProps) {
  if (!review) {
    return (
      <div className="pw-pr pw-pr--empty">
        <h2>PR Review</h2>
        <p className="pw-muted">
          Compare the current workspace against the stored baseline to preview
          the merge gate.
        </p>
        {onAnalyze && (
          <button className="pw-btn" disabled={busy} onClick={onAnalyze}>
            {busy ? "Analyzing…" : "Analyze PR"}
          </button>
        )}
      </div>
    );
  }

  const { decision, risk, blastRadius, delta, scoreDelta } = review;
  const recColor = REC_COLOR[decision.recommendation];

  return (
    <div className="pw-pr">
      <header className="pw-pr__head">
        <div>
          <h2>PR Review</h2>
          <p className="pw-muted">
            {review.base.ref ?? "base"} → {review.head.ref ?? "head"}
          </p>
        </div>
        <div className="pw-pr__verdict" style={{ borderColor: recColor }}>
          <span className="pw-pr__rec" style={{ color: recColor }}>
            {REC_LABEL[decision.recommendation]}
          </span>
          <span className="pw-pr__score">
            Score {review.base.score} → {review.head.score}{" "}
            <b style={{ color: scoreDelta >= 0 ? "#1f9d55" : "#dc2626" }}>
              ({scoreDelta >= 0 ? "+" : ""}
              {scoreDelta})
            </b>
          </span>
          <span
            className="pw-pr__risk"
            style={{ background: RISK_COLOR[risk.level] }}
          >
            {risk.level} risk · {risk.score}/100
          </span>
        </div>
        {onAnalyze && (
          <button
            className="pw-btn pw-btn--ghost"
            disabled={busy}
            onClick={onAnalyze}
          >
            {busy ? "Analyzing…" : "Re-analyze"}
          </button>
        )}
      </header>

      <div className="pw-pr__grid">
        {/* Blast radius */}
        <section className="pw-pr__card">
          <h3>Blast radius</h3>
          <div className="pw-pr__metrics">
            <Metric value={String(blastRadius.edited.length)} label="edited" />
            <Metric
              value={String(blastRadius.impacted.length)}
              label="impacted"
            />
            <Metric
              value={`${Math.round(blastRadius.coverage * 100)}%`}
              label="of workspace"
            />
          </div>
          {blastRadius.byPackage.length > 0 && (
            <ul className="pw-pr__radius">
              {blastRadius.byPackage.slice(0, 6).map((b) => (
                <li key={b.id}>
                  <code>{b.id}</code> → {b.impacted.length} package(s)
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Risk factors */}
        <section className="pw-pr__card">
          <h3>Risk factors</h3>
          {risk.factors.length === 0 ? (
            <p className="pw-muted">No risk factors.</p>
          ) : (
            <ul className="pw-pr__factors">
              {risk.factors.map((f, i) => (
                <li key={i}>
                  <span className="pw-pr__pts">+{Math.round(f.points)}</span>{" "}
                  <strong>{f.label}</strong> — {f.detail}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* New issues */}
      <section className="pw-pr__card">
        <h3>New issues ({delta.regressions.length})</h3>
        {delta.regressions.length === 0 ? (
          <p className="pw-muted">No new issues. ✅</p>
        ) : (
          <ul className="pw-pr__issues">
            {delta.regressions.map((r, i) => (
              <li key={i} className={`pw-pr__issue is-${r.severity}`}>
                <span className="pw-pr__sev">{r.severity}</span>
                {r.detail}
              </li>
            ))}
          </ul>
        )}
        {delta.improvements.length > 0 && (
          <ul className="pw-pr__improvements">
            {delta.improvements.map((imp, i) => (
              <li key={i}>✓ {imp.detail}</li>
            ))}
          </ul>
        )}
      </section>

      {/* Changed packages */}
      {review.changed.length > 0 && (
        <section className="pw-pr__card">
          <h3>Impacted packages</h3>
          <table className="pw-pr__table">
            <thead>
              <tr>
                <th>Package</th>
                <th>Reason</th>
                <th>Dependents</th>
                <th>Centrality</th>
              </tr>
            </thead>
            <tbody>
              {review.changed.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>
                    <span
                      className={`pw-pr__reason pw-pr__reason--${c.reason}`}
                    >
                      {c.reason}
                    </span>
                  </td>
                  <td className="pw-pr__num">{c.dependents}</td>
                  <td className="pw-pr__num">{c.centrality.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Recommendation */}
      <section
        className="pw-pr__card pw-pr__recommend"
        style={{ borderColor: recColor }}
      >
        <h3 style={{ color: recColor }}>
          {REC_LABEL[decision.recommendation]}
        </h3>
        <ul>
          {decision.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </section>
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
