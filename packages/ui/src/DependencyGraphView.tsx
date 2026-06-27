import { useMemo, useRef, useState } from "react";
import {
  computeGraphLayout,
  type DependencyGraph,
  type DependencyNode,
} from "@package-workbench/plugin-sdk";

export interface DependencyGraphViewProps {
  graph: DependencyGraph | null;
  onAnalyze?: () => void;
  busy?: boolean;
}

type SubView = "graph" | "table" | "violations";

const NODE_W = 150;
const NODE_H = 38;

/**
 * Workspace-level dependency intelligence: a layered graph view (pan/zoom),
 * a metrics table, and a violations/cycles/smells view. All graph *logic*
 * (layout, metrics, analysis) comes from core — this only renders it.
 */
export function DependencyGraphView({
  graph,
  onAnalyze,
  busy,
}: DependencyGraphViewProps) {
  const [view, setView] = useState<SubView>("graph");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  if (!graph) {
    return (
      <div className="pw-rt-empty">
        <p className="pw-muted">
          Build the dependency graph to see package relationships, cycles,
          boundary violations, and architectural smells.
        </p>
        <button
          className="pw-btn"
          disabled={busy}
          onClick={() => onAnalyze?.()}
        >
          {busy ? "Analyzing…" : "Analyze dependency graph"}
        </button>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = (id: string): boolean => !q || id.toLowerCase().includes(q);

  return (
    <section className="pw-graph">
      <header className="pw-graph__head">
        <div className="pw-graph__score">
          <span className={`pw-graph__grade pw-grade-${graph.health.grade}`}>
            {graph.health.grade}
          </span>
          <div>
            <strong>{graph.health.score}/100</strong>
            <span className="pw-muted">
              {" "}
              · {graph.stats.packageCount} pkgs · {graph.stats.edgeCount} edges
              ·{" "}
              {graph.stats.isAcyclic
                ? "acyclic"
                : `${graph.cycles.length} cycles`}
            </span>
          </div>
        </div>
        <div className="pw-graph__tabs">
          {(["graph", "table", "violations"] as const).map((v) => (
            <button
              key={v}
              className={`pw-tab${view === v ? " is-active" : ""}`}
              onClick={() => setView(v)}
            >
              {v === "violations"
                ? `Violations (${graph.cycles.length + graph.violations.length + graph.smells.length})`
                : v[0]!.toUpperCase() + v.slice(1)}
            </button>
          ))}
          <button
            className="pw-btn pw-btn--ghost pw-btn--sm"
            disabled={busy}
            onClick={() => onAnalyze?.()}
          >
            {busy ? "Analyzing…" : "Re-analyze"}
          </button>
        </div>
      </header>

      {view !== "violations" && (
        <input
          className="pw-graph__search"
          placeholder="Search packages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {view === "graph" && (
        <GraphCanvas
          graph={graph}
          selected={selected}
          onSelect={setSelected}
          matches={matches}
        />
      )}
      {view === "table" && <GraphTable graph={graph} matches={matches} />}
      {view === "violations" && <ViolationsView graph={graph} />}
    </section>
  );
}

// ---- graph canvas (SVG, pan + zoom) ----------------------------------------

function GraphCanvas({
  graph,
  selected,
  onSelect,
  matches,
}: {
  graph: DependencyGraph;
  selected: string | null;
  onSelect: (id: string | null) => void;
  matches: (id: string) => boolean;
}) {
  const layout = useMemo(() => computeGraphLayout(graph), [graph]);
  const pos = useMemo(
    () => new Map(layout.nodes.map((n) => [n.id, n])),
    [layout],
  );
  const nodeById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph],
  );
  const cycleNodes = useMemo(
    () => new Set(graph.cycles.flatMap((c) => c.affected)),
    [graph],
  );
  const violationEdges = useMemo(
    () => new Set(graph.violations.map((v) => `${v.from}->${v.to}`)),
    [graph],
  );

  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  const neighbors = useMemo(() => {
    if (!selected) return null;
    const set = new Set<string>([selected]);
    for (const e of graph.edges) {
      if (e.from === selected) set.add(e.to);
      if (e.to === selected) set.add(e.from);
    }
    return set;
  }, [selected, graph]);

  const onWheel = (e: React.WheelEvent) =>
    setScale((s) => Math.min(2.5, Math.max(0.3, s - e.deltaY * 0.001)));
  const onDown = (e: React.MouseEvent) =>
    (drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y });
  const onMove = (e: React.MouseEvent) => {
    if (drag.current)
      setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
  };
  const onUp = () => (drag.current = null);

  const color = (n: DependencyNode): string => {
    if (cycleNodes.has(n.id)) return "#dc2626";
    if (n.isOrphan) return "#9ca3af";
    if (n.metrics.fanIn >= 5) return "#7c3aed";
    return ["#0ea5e9", "#2563eb", "#1d4ed8", "#1e40af"][Math.min(3, n.layer)]!;
  };

  return (
    <div
      className="pw-graph__canvas"
      onWheel={onWheel}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={onUp}
    >
      <svg width="100%" height="100%">
        <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>
          {graph.edges.map((e, i) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const dim =
              neighbors && !(neighbors.has(e.from) && neighbors.has(e.to));
            const bad =
              violationEdges.has(`${e.from}->${e.to}`) ||
              (cycleNodes.has(e.from) && cycleNodes.has(e.to));
            return (
              <line
                key={i}
                x1={a.x + NODE_W / 2}
                y1={a.y + NODE_H / 2}
                x2={b.x + NODE_W / 2}
                y2={b.y + NODE_H / 2}
                stroke={bad ? "#dc2626" : "#cbd5e1"}
                strokeWidth={bad ? 2 : 1}
                strokeDasharray={e.undeclared ? "4 3" : undefined}
                opacity={dim ? 0.12 : bad ? 0.9 : 0.5}
                markerEnd="url(#pw-arrow)"
              />
            );
          })}
          {layout.nodes.map((ln) => {
            const n = nodeById.get(ln.id)!;
            const dim = (neighbors && !neighbors.has(n.id)) || !matches(n.id);
            return (
              <g
                key={n.id}
                transform={`translate(${ln.x},${ln.y})`}
                onClick={() => onSelect(selected === n.id ? null : n.id)}
                style={{ cursor: "pointer", opacity: dim ? 0.25 : 1 }}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={7}
                  fill="#fff"
                  stroke={color(n)}
                  strokeWidth={selected === n.id ? 3 : 1.5}
                />
                <circle cx={12} cy={NODE_H / 2} r={4} fill={color(n)} />
                <text
                  x={24}
                  y={NODE_H / 2 + 4}
                  fontSize={11}
                  fontWeight={600}
                  fill="#111827"
                >
                  {n.name.length > 18 ? n.name.slice(0, 17) + "…" : n.name}
                </text>
              </g>
            );
          })}
          <defs>
            <marker
              id="pw-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L7,3 L0,6 Z" fill="#94a3b8" />
            </marker>
          </defs>
        </g>
      </svg>

      {selected && nodeById.get(selected) && (
        <NodeInfo node={nodeById.get(selected)!} />
      )}
      <div className="pw-graph__hint pw-muted">
        scroll to zoom · drag to pan · click a node
      </div>
    </div>
  );
}

function NodeInfo({ node }: { node: DependencyNode }) {
  return (
    <aside className="pw-graph__info">
      <strong>{node.name}</strong>
      <p className="pw-muted">
        {node.packageType} · layer {node.layer}
      </p>
      <ul>
        <li>fan-in: {node.metrics.fanIn}</li>
        <li>fan-out: {node.metrics.fanOut}</li>
        <li>centrality: {node.metrics.centrality}</li>
        <li>depth: {node.metrics.depth}</li>
        <li>transitive deps: {node.metrics.transitiveDependencies}</li>
        <li>transitive dependents: {node.metrics.transitiveDependents}</li>
      </ul>
    </aside>
  );
}

// ---- table view -------------------------------------------------------------

function GraphTable({
  graph,
  matches,
}: {
  graph: DependencyGraph;
  matches: (id: string) => boolean;
}) {
  const rows = [...graph.nodes]
    .filter((n) => matches(n.id))
    .sort((a, b) => b.metrics.degree - a.metrics.degree);
  return (
    <div className="pw-graph__table">
      <table>
        <thead>
          <tr>
            <th>Package</th>
            <th>Type</th>
            <th>Fan-in</th>
            <th>Fan-out</th>
            <th>Degree</th>
            <th>Depth</th>
            <th>Centrality</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => (
            <tr key={n.id}>
              <td>{n.name}</td>
              <td className="pw-muted">{n.packageType}</td>
              <td>{n.metrics.fanIn}</td>
              <td>{n.metrics.fanOut}</td>
              <td>{n.metrics.degree}</td>
              <td>{n.metrics.depth}</td>
              <td>{n.metrics.centrality}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- violations view --------------------------------------------------------

function ViolationsView({ graph }: { graph: DependencyGraph }) {
  const empty =
    graph.cycles.length === 0 &&
    graph.violations.length === 0 &&
    graph.smells.length === 0;
  if (empty)
    return (
      <div className="pw-rt-empty">
        <p className="pw-muted">
          No cycles, boundary violations, or smells detected. 🎉
        </p>
      </div>
    );
  return (
    <div className="pw-graph__violations">
      <div className="pw-warnings">
        <strong>Score penalties</strong>
        <ul>
          {graph.health.factors.map((f, i) => (
            <li key={i}>
              −{f.penalty} {f.label}: {f.detail}
            </li>
          ))}
        </ul>
      </div>
      {graph.cycles.length > 0 && (
        <Section title={`Circular dependencies (${graph.cycles.length})`}>
          {graph.cycles.map((c, i) => (
            <li key={i} className={`pw-vrow is-${c.severity}`}>
              <span className="pw-vsev">{c.severity}</span> {c.kind}:{" "}
              {c.cycle.join(" → ")}
              {c.cycle.length > 1 ? ` → ${c.cycle[0]}` : ""}
            </li>
          ))}
        </Section>
      )}
      {graph.violations.length > 0 && (
        <Section title={`Boundary violations (${graph.violations.length})`}>
          {graph.violations.map((v, i) => (
            <li key={i} className={`pw-vrow is-${v.severity}`}>
              <span className="pw-vsev">{v.severity}</span> {v.from} → {v.to} ·{" "}
              {v.rule}
            </li>
          ))}
        </Section>
      )}
      {graph.smells.length > 0 && (
        <Section title={`Architectural smells (${graph.smells.length})`}>
          {graph.smells.map((s, i) => (
            <li key={i} className={`pw-vrow is-${s.severity}`}>
              <span className="pw-vsev">{s.kind.replace(/_/g, " ")}</span>{" "}
              {s.packageId} — {s.detail}
            </li>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pw-vsection">
      <h3>{title}</h3>
      <ul>{children}</ul>
    </div>
  );
}
