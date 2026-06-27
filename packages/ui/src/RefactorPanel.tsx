import type {
  ProjectedGraph,
  RefactorPlan,
  RefactorSuggestion,
  RefactorVisualization,
} from "@package-workbench/core";

/**
 * The Refactor tab: top architectural problems, ranked refactor suggestions with
 * grounded impact + risks, and a before/after architecture visualization that
 * highlights the changed edges. "Generate Alternative Plans" swaps between the
 * Balanced / Minimal-risk / Max-impact variants.
 *
 * Pure + presentational — it renders the {@link RefactorPlan}s the engine
 * computed (impact numbers come from real graph recomputation, not the UI).
 */

export interface RefactorPanelProps {
  plans: RefactorPlan[];
  activeVariant: number;
  onSelectVariant?: (variant: number) => void;
  onAnalyze?: () => void;
  onGenerateAlternatives?: () => void;
  busy?: boolean;
}

const VARIANT_LABEL = ["Balanced", "Minimal-risk", "Max-impact"];
const RISK_COLOR: Record<string, string> = {
  low: "#1f9d55",
  medium: "#d97706",
  high: "#dc2626",
};

export function RefactorPanel({
  plans,
  activeVariant,
  onSelectVariant,
  onAnalyze,
  onGenerateAlternatives,
  busy,
}: RefactorPanelProps) {
  if (plans.length === 0) {
    return (
      <div className="pw-rf pw-rf--empty">
        <h2>Refactor Architect</h2>
        <p className="pw-muted">
          Analyze the dependency graph for architectural problems and grounded
          refactor suggestions.
        </p>
        {onAnalyze && (
          <button className="pw-btn" disabled={busy} onClick={onAnalyze}>
            {busy ? "Analyzing…" : "Analyze architecture"}
          </button>
        )}
      </div>
    );
  }

  const plan = plans.find((p) => p.variant === activeVariant) ?? plans[0]!;

  return (
    <div className="pw-rf">
      <header className="pw-rf__head">
        <div>
          <h2>Refactor Architect</h2>
          <p className="pw-muted">{plan.summary}</p>
        </div>
        <div className="pw-rf__actions">
          {plans.length > 1 && (
            <div className="pw-segment" role="tablist">
              {plans.map((p) => (
                <button
                  key={p.variant}
                  className={`pw-segment__btn${p.variant === activeVariant ? " is-active" : ""}`}
                  onClick={() => onSelectVariant?.(p.variant)}
                >
                  {VARIANT_LABEL[p.variant] ?? `Plan ${p.variant}`}
                </button>
              ))}
            </div>
          )}
          {onGenerateAlternatives && (
            <button
              className="pw-btn pw-btn--ghost"
              disabled={busy}
              onClick={onGenerateAlternatives}
            >
              {busy ? "Working…" : "Generate Alternative Plans"}
            </button>
          )}
        </div>
      </header>

      {/* Problems */}
      <section className="pw-rf__card">
        <h3>Top architectural problems ({plan.problems.length})</h3>
        {plan.problems.length === 0 ? (
          <p className="pw-muted">
            No clear architectural problems detected. ✅
          </p>
        ) : (
          <ul className="pw-rf__problems">
            {plan.problems.slice(0, 8).map((p, i) => (
              <li key={i}>
                <span className={`pw-rf__sev is-${p.severity}`}>
                  {p.severity}
                </span>
                <strong>{p.kind.replace(/_/g, " ")}</strong> — {p.detail}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Suggestions */}
      {plan.suggestions.length === 0 ? (
        <section className="pw-rf__card">
          <p className="pw-muted">
            No conservative refactor improves the graph right now.
          </p>
        </section>
      ) : (
        plan.suggestions.map((s) => (
          <SuggestionCard key={s.id} suggestion={s} />
        ))
      )}
    </div>
  );
}

function impactBullets(s: RefactorSuggestion): string[] {
  const i = s.impact;
  const out: string[] = [];
  if (i.cycleReduction > 0)
    out.push(
      `reduce cycles by ${Math.round(i.cycleReductionPct * 100)}% (${i.cycleReduction})`,
    );
  if (i.fanOutReduction > 0)
    out.push(
      `reduce fan-out by ${Math.round(i.fanOutReductionPct * 100)}% (${i.fanOutReduction})`,
    );
  if (i.healthScoreDelta !== 0)
    out.push(
      `improve health score ${i.healthScoreDelta >= 0 ? "+" : ""}${i.healthScoreDelta}`,
    );
  return out.length ? out : ["marginal structural improvement"];
}

function SuggestionCard({ suggestion: s }: { suggestion: RefactorSuggestion }) {
  return (
    <section className="pw-rf__card pw-rf__suggestion">
      <div className="pw-rf__shead">
        <h3>{s.title}</h3>
        <span
          className="pw-rf__risk"
          style={{ background: RISK_COLOR[s.risk.level] }}
        >
          {s.risk.level} risk
        </span>
        <span className="pw-rf__score">score {s.score}</span>
      </div>
      <p className="pw-muted pw-rf__strategy">
        {s.strategy.replace(/_/g, " ")}
      </p>

      <div className="pw-rf__impact">
        <strong>Expected impact</strong>
        <ul>
          {impactBullets(s).map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>

      <BeforeAfter viz={s.visualization} />

      <details className="pw-rf__details">
        <summary>Steps, tradeoffs & evidence</summary>
        <div className="pw-rf__why">
          <p>
            <strong>Why it helps:</strong> {s.explanation.howItHelps}
          </p>
        </div>
        <strong>Steps</strong>
        <ol>
          {s.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        <strong>Tradeoffs</strong>
        <ul>
          {s.explanation.tradeoffs.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
        <strong>Evidence</strong>
        <ul className="pw-rf__evidence">
          {s.explanation.evidence.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** Before/after architecture mini-diagram, highlighting changed edges. */
function BeforeAfter({ viz }: { viz: RefactorVisualization }) {
  const changed = new Set(
    viz.changedEdges
      .filter((e) => e.change === "added")
      .map((e) => `${e.from} ${e.to}`),
  );
  const removed = new Set(
    viz.changedEdges
      .filter((e) => e.change === "removed")
      .map((e) => `${e.from} ${e.to}`),
  );
  return (
    <div className="pw-rf__beforeafter">
      <MiniGraph
        title={`Before · health ${viz.before.healthScore} · ${viz.before.cycleCount} cycle(s)`}
        graph={viz.before}
        removedEdges={removed}
      />
      <div className="pw-rf__arrow">→</div>
      <MiniGraph
        title={`After · health ${viz.after.healthScore} · ${viz.after.cycleCount} cycle(s)`}
        graph={viz.after}
        addedEdges={changed}
      />
    </div>
  );
}

function MiniGraph({
  title,
  graph,
  addedEdges,
  removedEdges,
}: {
  title: string;
  graph: ProjectedGraph;
  addedEdges?: Set<string>;
  removedEdges?: Set<string>;
}) {
  const W = 260;
  const H = 150;
  // Layered layout: x by layer, y spread per layer.
  const byLayer = new Map<number, string[]>();
  for (const n of graph.nodes) {
    const layer = n.layer;
    (byLayer.get(layer) ?? byLayer.set(layer, []).get(layer)!).push(n.id);
  }
  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  const pos = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, li) => {
    const members = byLayer.get(layer)!;
    members.forEach((id, mi) => {
      const x =
        layers.length > 1 ? 30 + (li / (layers.length - 1)) * (W - 60) : W / 2;
      const y = 24 + ((mi + 1) / (members.length + 1)) * (H - 36);
      pos.set(id, { x, y });
    });
  });

  return (
    <figure className="pw-rf__mini">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img">
        {graph.edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const key = `${e.from} ${e.to}`;
          const stroke = addedEdges?.has(key) ? "#1f9d55" : "#9ca3af";
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={stroke}
              strokeWidth={addedEdges?.has(key) ? 2 : 1}
            />
          );
        })}
        {/* removed edges shown faint/dashed on the before graph */}
        {removedEdges &&
          [...removedEdges].map((key, i) => {
            const [from, to] = key.split(" ");
            const a = pos.get(from!);
            const b = pos.get(to!);
            if (!a || !b) return null;
            return (
              <line
                key={`r${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#dc2626"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            );
          })}
        {graph.nodes.map((n) => {
          const p = pos.get(n.id)!;
          return (
            <g key={n.id}>
              <circle
                cx={p.x}
                cy={p.y}
                r={6}
                fill={n.isNew ? "#1f9d55" : "#2563eb"}
              />
              <text
                x={p.x}
                y={p.y - 9}
                textAnchor="middle"
                fontSize={8}
                fill="currentColor"
              >
                {shortName(n.id)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function shortName(id: string): string {
  const base = id.split("/").pop() ?? id;
  return base.length > 14 ? base.slice(0, 13) + "…" : base;
}
