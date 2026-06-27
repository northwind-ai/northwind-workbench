import { useState } from "react";
import type {
  FixCandidate,
  FixPlan,
  FixSafetyLevel,
  FixResult,
} from "@package-workbench/core";

/**
 * The Fixes panel: Issue → Fix → Diff → Apply, grouped by safety. Safe fixes get
 * an Apply button; review-required show the diff and require explicit opt-in;
 * dangerous are suggest-only (no Apply). A session can be undone.
 *
 * Pure + presentational — apply/undo are delegated to the host via callbacks; the
 * engine does the atomic write + backup.
 */

export interface FixesPanelProps {
  plan: FixPlan | null;
  /** Per-candidate apply results (keyed by candidate id). */
  results?: Record<string, FixResult>;
  onAnalyze?: () => void;
  onApply?: (candidate: FixCandidate) => void;
  onUndo?: () => void;
  busyId?: string | null;
  busy?: boolean;
}

const SAFETY: Record<FixSafetyLevel, { label: string; color: string }> = {
  safe: { label: "Safe", color: "#1f9d55" },
  review_required: { label: "Review", color: "#d97706" },
  dangerous: { label: "Suggest-only", color: "#dc2626" },
};

export function FixesPanel({
  plan,
  results,
  onAnalyze,
  onApply,
  onUndo,
  busyId,
  busy,
}: FixesPanelProps) {
  if (!plan) {
    return (
      <div className="pw-fx pw-fx--empty">
        <h2>Auto Fix</h2>
        <p className="pw-muted">
          Scan for safe, automatically-applicable fixes (missing deps,
          package.json fields, …).
        </p>
        {onAnalyze && (
          <button className="pw-btn" disabled={busy} onClick={onAnalyze}>
            {busy ? "Scanning…" : "Find fixes"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="pw-fx">
      <header className="pw-fx__head">
        <div>
          <h2>Auto Fix</h2>
          <p className="pw-muted">
            {plan.summary.safe} safe · {plan.summary.reviewRequired} review ·{" "}
            {plan.summary.dangerous} suggest-only
          </p>
        </div>
        <div className="pw-fx__actions">
          {onAnalyze && (
            <button
              className="pw-btn pw-btn--ghost"
              disabled={busy}
              onClick={onAnalyze}
            >
              {busy ? "Scanning…" : "Re-scan"}
            </button>
          )}
          {onUndo && (
            <button
              className="pw-btn pw-btn--ghost"
              disabled={busy}
              onClick={onUndo}
            >
              Undo last fix
            </button>
          )}
        </div>
      </header>

      {plan.candidates.length === 0 ? (
        <p className="pw-muted">No fixable issues detected. ✅</p>
      ) : (
        plan.candidates.map((c) => (
          <FixCard
            key={c.id}
            candidate={c}
            result={results?.[c.id]}
            onApply={onApply}
            busy={busyId === c.id}
          />
        ))
      )}
    </div>
  );
}

function FixCard({
  candidate: c,
  result,
  onApply,
  busy,
}: {
  candidate: FixCandidate;
  result?: FixResult;
  onApply?: (c: FixCandidate) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const meta = SAFETY[c.safety];
  const applied = result?.applied === true;
  const canApply = c.safety !== "dangerous" && c.patches.length > 0 && !applied;

  return (
    <section className={`pw-fx__card${applied ? " is-applied" : ""}`}>
      <div className="pw-fx__row">
        <span className="pw-fx__safety" style={{ background: meta.color }}>
          {meta.label}
        </span>
        <div className="pw-fx__body">
          <div className="pw-fx__title">{c.title}</div>
          <div className="pw-fx__problem pw-muted">{c.problem}</div>
          <div className="pw-fx__desc">{c.description}</div>
        </div>
        <div className="pw-fx__cta">
          {applied ? (
            <span className="pw-fx__done">✓ Applied</span>
          ) : canApply ? (
            <button
              className="pw-btn"
              disabled={busy}
              onClick={() => onApply?.(c)}
              title={
                c.safety === "review_required"
                  ? "Review the diff, then apply"
                  : undefined
              }
            >
              {busy ? "Applying…" : "Apply Fix"}
            </button>
          ) : (
            <span className="pw-muted">suggest-only</span>
          )}
        </div>
      </div>

      {result && !result.applied && result.reason && (
        <div className="pw-fx__error">⚠ {result.reason}</div>
      )}

      {c.patches.length > 0 && (
        <>
          <button className="pw-fx__toggle" onClick={() => setOpen((o) => !o)}>
            {open ? "▾" : "▸"} {open ? "Hide" : "Show"} diff ({c.patches.length}{" "}
            file{c.patches.length > 1 ? "s" : ""})
          </button>
          {open &&
            c.patches.map((p, i) => (
              <Diff key={i} before={p.before} after={p.after} path={p.path} />
            ))}
        </>
      )}
    </section>
  );
}

/** Render a before/after line diff for one patch. */
function Diff({
  before,
  after,
  path,
}: {
  before: string | null;
  after: string;
  path: string;
}) {
  const lines = computeDiff(before, after);
  return (
    <div className="pw-fx__diff">
      <div className="pw-fx__diffpath">{path}</div>
      <pre>
        {lines.map((l, i) => (
          <div key={i} className={`pw-fx__dl is-${l.kind}`}>
            {l.kind === "add" ? "+ " : l.kind === "remove" ? "- " : "  "}
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

interface DL {
  kind: "context" | "add" | "remove";
  text: string;
}
/** Local copy of the engine's prefix/suffix line diff (keeps the UI dep-free). */
function computeDiff(before: string | null, after: string): DL[] {
  const a = before === null ? [] : before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: DL[] = [];
  const ctx = 2;
  for (let i = Math.max(0, start - ctx); i < start; i++)
    out.push({ kind: "context", text: a[i]! });
  for (let i = start; i < endA; i++) out.push({ kind: "remove", text: a[i]! });
  for (let i = start; i < endB; i++) out.push({ kind: "add", text: b[i]! });
  for (let i = endA; i < Math.min(a.length, endA + ctx); i++)
    out.push({ kind: "context", text: a[i]! });
  return out;
}
