export interface RecentRepo {
  path: string;
  name: string;
}

export interface OnboardingProps {
  onOpenRepository: () => void;
  onTryExample: () => void;
  recentRepos?: RecentRepo[];
  onOpenRecent?: (path: string) => void;
}

const FEATURES = [
  {
    icon: "🩺",
    title: "Package health",
    body: "Deterministic checks across your whole workspace.",
  },
  {
    icon: "⚙️",
    title: "Runtime compatibility",
    body: "Does it actually import in Node, the browser, Electron?",
  },
  {
    icon: "🕸️",
    title: "Dependency analysis",
    body: "Cycles, boundaries, and architectural smells.",
  },
  {
    icon: "🧪",
    title: "Scenario testing",
    body: "Plugin smoke tests that prove packages do real work.",
  },
  {
    icon: "📉",
    title: "CI regression detection",
    body: "Fail the build when health regresses.",
  },
];

/**
 * First-run welcome screen. Communicates what Workbench does and offers the two
 * entry points (open a repo / try the example), plus recent repositories.
 */
export function Onboarding({
  onOpenRepository,
  onTryExample,
  recentRepos = [],
  onOpenRecent,
}: OnboardingProps) {
  return (
    <div className="pw-onboard">
      <div className="pw-onboard__hero">
        <div className="pw-onboard__logo">📦</div>
        <h1>Package Workbench</h1>
        <p className="pw-onboard__tagline">
          Validate whether packages actually <strong>work</strong> — not just
          compile.
        </p>

        <div className="pw-onboard__actions">
          <button className="pw-btn pw-btn--lg" onClick={onOpenRepository}>
            Open Repository…
          </button>
          <button
            className="pw-btn pw-btn--ghost pw-btn--lg"
            onClick={onTryExample}
          >
            Try Example Repo
          </button>
        </div>

        {recentRepos.length > 0 && (
          <div className="pw-onboard__recent">
            <span className="pw-muted">Recent</span>
            {recentRepos.slice(0, 5).map((r) => (
              <button
                key={r.path}
                className="pw-onboard__recentitem"
                onClick={() => onOpenRecent?.(r.path)}
                title={r.path}
              >
                {r.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pw-onboard__features">
        {FEATURES.map((f) => (
          <div key={f.title} className="pw-onboard__feature">
            <span className="pw-onboard__featureicon">{f.icon}</span>
            <div>
              <strong>{f.title}</strong>
              <p className="pw-muted">{f.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface ScanStep {
  label: string;
  status: "pending" | "active" | "done";
  detail?: string;
}

/** Progress view shown during workspace detection + the initial scan. */
export function ScanProgress({
  steps,
  repoName,
  progress,
  phase,
  onCancel,
}: {
  steps: ScanStep[];
  repoName?: string;
  progress?: number;
  phase?: string;
  onCancel?: () => void;
}) {
  return (
    <div className="pw-scanprogress">
      <h2>Scanning {repoName ?? "workspace"}…</h2>
      {typeof progress === "number" && (
        <div className="pw-scanprogress__bar">
          <div
            className="pw-scanprogress__fill"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
      {phase && <p className="pw-muted pw-scanprogress__phase">{phase}</p>}
      <ul className="pw-scanprogress__steps">
        {steps.map((s, i) => (
          <li key={i} className={`pw-scanstep is-${s.status}`}>
            <span className="pw-scanstep__mark">
              {s.status === "done" ? "✓" : s.status === "active" ? "⟳" : "○"}
            </span>
            <span className="pw-scanstep__label">{s.label}</span>
            {s.detail && <span className="pw-muted">{s.detail}</span>}
          </li>
        ))}
      </ul>
      {onCancel && (
        <button className="pw-btn pw-btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}
