import { useState } from 'react';
import type { HealthCheckSeverity, PackageHealthReport } from '@package-workbench/core';
import { HealthScore } from './HealthScore';
import { ConfidenceBadge, StatusBadge, Tag } from './badges';
import { FailureLog } from './FailureLog';

const SEVERITY_COLOR: Record<HealthCheckSeverity, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#d97706',
  low: '#65a30d',
  info: '#9ca3af',
};

export interface PackageDetailsProps {
  report: PackageHealthReport | null;
  onRun?: (packageId: string) => void;
  busy?: boolean;
}

/** Right-hand details panel: score header, warnings, per-check rows + logs. */
export function PackageDetails({ report, onRun, busy }: PackageDetailsProps) {
  const [open, setOpen] = useState<string | null>(null);

  if (!report) {
    return <div className="pw-empty">Select a package to see its health report.</div>;
  }

  const { package: pkg } = report;

  return (
    <section className="pw-details">
      <header className="pw-details__head">
        <HealthScore score={report.score} status={report.status} />
        <div className="pw-details__title">
          <h1>{pkg.name}</h1>
          <p className="pw-muted">
            v{pkg.version} · {pkg.root}
          </p>
          <div className="pw-tags">
            <ConfidenceBadge confidence={report.confidence} />
            <Tag>{pkg.packageType}</Tag>
            <Tag>{pkg.runtime}</Tag>
            {pkg.private && <Tag>private</Tag>}
          </div>
        </div>
        <button className="pw-btn" disabled={busy || !onRun} onClick={() => onRun?.(pkg.id)}>
          {busy ? 'Running…' : 'Run checks'}
        </button>
      </header>

      {pkg.warnings.length > 0 && (
        <div className="pw-warnings" role="alert">
          <strong>Scan warnings</strong>
          <ul>
            {pkg.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <ul className="pw-checks">
        {report.checks.map((c) => {
          const expandable = Boolean(c.evidence?.length || c.details);
          const isOpen = open === c.checkId;
          return (
            <li key={c.checkId} className={`pw-check is-${c.status}`}>
              <button
                className="pw-check__row"
                onClick={() => expandable && setOpen(isOpen ? null : c.checkId)}
                aria-expanded={isOpen}
              >
                <StatusBadge status={c.status} />
                <span className="pw-check__title">{c.label}</span>
                <span className="pw-check__summary">{c.summary}</span>
                <span className="pw-check__sev" style={{ color: SEVERITY_COLOR[c.severity] }}>
                  {c.severity}
                </span>
                {typeof c.durationMs === 'number' && <span className="pw-check__time">{c.durationMs}ms</span>}
                {expandable && <span className="pw-check__chev">{isOpen ? '▾' : '▸'}</span>}
              </button>
              {isOpen && (
                <div className="pw-check__body">
                  {c.details && <p className="pw-muted">{c.details}</p>}
                  <FailureLog result={c} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
