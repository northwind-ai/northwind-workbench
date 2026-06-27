import { useState } from "react";
import type {
  FailureExplanation,
  FixSuggestion,
  RootCauseHypothesis,
} from "@package-workbench/core";

/**
 * The AI Assistant panel: renders a senior-engineer explanation of a failure —
 * what broke → root cause → cited evidence → prioritized fixes → confidence —
 * with copy-fix, open-related-files, and a raw-logs disclosure.
 *
 * Pure + presentational. It renders {@link FailureExplanation} values produced
 * by the core engine (offline heuristics by default); it does no analysis
 * itself, so it stays framework-light and trivially testable.
 */

export interface AiAssistantPanelProps {
  /** Explanations to show (usually the failures for one package). */
  explanations: FailureExplanation[];
  /** Trigger analysis when none has been computed yet. */
  onExplain?: () => void;
  busy?: boolean;
  /** Open a file in the user's editor (wired by the host app). */
  onOpenFile?: (file: string) => void;
  /** Copy text to the clipboard (defaults to navigator.clipboard). */
  onCopy?: (text: string) => void;
}

export function AiAssistantPanel({
  explanations,
  onExplain,
  busy,
  onOpenFile,
  onCopy,
}: AiAssistantPanelProps) {
  if (explanations.length === 0) {
    return (
      <div className="pw-ai pw-ai--empty">
        <p className="pw-muted">No failures analyzed yet.</p>
        {onExplain && (
          <button className="pw-btn" disabled={busy} onClick={onExplain}>
            {busy ? "Analyzing…" : "Analyze failures"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="pw-ai">
      {onExplain && (
        <div className="pw-ai__toolbar">
          <button
            className="pw-btn pw-btn--ghost"
            disabled={busy}
            onClick={onExplain}
          >
            {busy ? "Analyzing…" : "Re-analyze"}
          </button>
        </div>
      )}
      {explanations.map((e) => (
        <ExplanationCard
          key={e.input.id}
          explanation={e}
          onOpenFile={onOpenFile}
          onCopy={onCopy}
        />
      ))}
    </div>
  );
}

/** Map 0..1 confidence onto an honest band + colour. */
function confidenceBand(confidence: number): { label: string; color: string } {
  if (confidence >= 0.85) return { label: "High", color: "#1f9d55" };
  if (confidence >= 0.6) return { label: "Likely", color: "#d97706" };
  if (confidence >= 0.4) return { label: "Plausible", color: "#9ca3af" };
  return { label: "Low", color: "#9ca3af" };
}

function ExplanationCard({
  explanation,
  onOpenFile,
  onCopy,
}: {
  explanation: FailureExplanation;
  onOpenFile?: (f: string) => void;
  onCopy?: (t: string) => void;
}) {
  const h = explanation.primary;
  const [showRaw, setShowRaw] = useState(false);
  const [showAlts, setShowAlts] = useState(false);
  const pct = Math.round(explanation.confidence * 100);
  const band = confidenceBand(explanation.confidence);

  if (!h) {
    return (
      <div className="pw-ai__card">
        <div className="pw-ai__failure">{explanation.input.title}</div>
        <p className="pw-muted">No analysis could be produced.</p>
      </div>
    );
  }

  const rawLogs = explanation.input.context.evidence ?? [];

  return (
    <div className="pw-ai__card">
      {/* Failure ↓ */}
      <div className="pw-ai__failure">
        <span className="pw-ai__kicker">Failure</span>
        {explanation.input.title}
      </div>

      {/* ↓ Root cause */}
      <section className="pw-ai__section">
        <span className="pw-ai__kicker">Root cause</span>
        <p className="pw-ai__cause">{h.cause}</p>
        {h.rationale && <p className="pw-ai__why">{h.rationale}</p>}
      </section>

      {/* ↓ Evidence (always cited) */}
      {h.evidence.length > 0 && (
        <section className="pw-ai__section">
          <span className="pw-ai__kicker">Evidence</span>
          <ul className="pw-ai__evidence">
            {h.evidence.map((ev, i) => (
              <li key={i}>
                <code className="pw-ai__src">{ev.source}</code> {ev.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ↓ Fixes */}
      {h.fixes.length > 0 && (
        <section className="pw-ai__section">
          <span className="pw-ai__kicker">Suggested fixes</span>
          <ul className="pw-ai__fixes">
            {h.fixes.map((f, i) => (
              <FixRow key={i} fix={f} onOpenFile={onOpenFile} onCopy={onCopy} />
            ))}
          </ul>
        </section>
      )}

      {/* Prior resolution from history */}
      {explanation.priorResolution && (
        <div className="pw-ai__prior" role="note">
          💡 {explanation.priorResolution.message}
        </div>
      )}

      {/* ↓ Confidence */}
      <div className="pw-ai__confidence">
        <span className="pw-ai__kicker">Confidence</span>
        <div className="pw-ai__meter" aria-label={`Confidence ${pct}%`}>
          <span
            className="pw-ai__meterfill"
            style={{ width: `${pct}%`, background: band.color }}
          />
        </div>
        <strong style={{ color: band.color }}>
          {pct}% · {band.label}
        </strong>
        <span className="pw-ai__provider pw-muted">
          via {explanation.provider}
        </span>
      </div>

      {/* Disclosures: alternatives + raw logs */}
      <div className="pw-ai__disclosures">
        {explanation.hypotheses.length > 1 && (
          <button
            className="pw-ai__toggle"
            onClick={() => setShowAlts((s) => !s)}
          >
            {showAlts ? "▾" : "▸"} {explanation.hypotheses.length - 1} other
            possibilit{explanation.hypotheses.length - 1 === 1 ? "y" : "ies"}
          </button>
        )}
        {rawLogs.length > 0 && (
          <button
            className="pw-ai__toggle"
            onClick={() => setShowRaw((s) => !s)}
          >
            {showRaw ? "▾" : "▸"} Show raw logs
          </button>
        )}
      </div>
      {showAlts && (
        <Alternatives hypotheses={explanation.hypotheses.slice(1)} />
      )}
      {showRaw && <pre className="pw-log">{rawLogs.join("\n\n")}</pre>}
    </div>
  );
}

function FixRow({
  fix,
  onOpenFile,
  onCopy,
}: {
  fix: FixSuggestion;
  onOpenFile?: (f: string) => void;
  onCopy?: (t: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = (text: string): void => {
    if (onCopy) onCopy(text);
    else void navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <li className={`pw-ai__fix pw-ai__fix--${fix.kind}`}>
      <span className={`pw-ai__fixkind pw-ai__fixkind--${fix.kind}`}>
        {fix.kind === "fast" ? "Fast fix" : "Structural"}
      </span>
      <div className="pw-ai__fixbody">
        <div className="pw-ai__fixtitle">{fix.title}</div>
        {fix.command && (
          <div className="pw-ai__cmd">
            <code>{fix.command}</code>
            <button className="pw-ai__copy" onClick={() => copy(fix.command!)}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
        {fix.detail && (
          <p className="pw-muted pw-ai__fixdetail">{fix.detail}</p>
        )}
        {fix.files && fix.files.length > 0 && (
          <div className="pw-ai__files">
            {fix.files.map((file) => (
              <button
                key={file}
                className="pw-ai__file"
                onClick={() => onOpenFile?.(file)}
                disabled={!onOpenFile}
              >
                {file}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function Alternatives({ hypotheses }: { hypotheses: RootCauseHypothesis[] }) {
  return (
    <ul className="pw-ai__alts">
      {hypotheses.map((h, i) => (
        <li key={i}>
          <span className="pw-muted">{Math.round(h.confidence * 100)}%</span>{" "}
          {h.cause}
        </li>
      ))}
    </ul>
  );
}
