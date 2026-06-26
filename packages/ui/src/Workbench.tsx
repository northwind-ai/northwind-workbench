import { useEffect, useState } from 'react';
import type { WorkbenchRun } from '@package-workbench/core';
import { PackageList } from './PackageList';
import { PackageDetails } from './PackageDetails';

export interface WorkbenchProps {
  run: WorkbenchRun | null;
  onOpenWorkspace?: () => void;
  onRunAll?: () => void;
  onRunPackage?: (packageId: string) => void;
  /** Global busy (scanning / running all). */
  busy?: boolean;
  /** Per-package busy (running one). */
  busyPackageId?: string | null;
  title?: string;
}

/**
 * Top-level layout: toolbar + workspace banner + sidebar + details. Owns only
 * selection state; all data + actions are passed in. Host-agnostic — the same
 * component mounts in Electron and (future) web.
 */
export function Workbench({
  run,
  onOpenWorkspace,
  onRunAll,
  onRunPackage,
  busy,
  busyPackageId,
  title = 'Package Workbench',
}: WorkbenchProps) {
  const reports = run?.reports ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(reports[0]?.package.id ?? null);

  useEffect(() => {
    if (reports.length === 0) setSelectedId(null);
    else if (!reports.some((r) => r.package.id === selectedId)) setSelectedId(reports[0]!.package.id);
  }, [reports, selectedId]);

  const selected = reports.find((r) => r.package.id === selectedId) ?? null;
  const summary = run?.summary;
  const ws = run?.workspace;

  return (
    <div className="pw-shell">
      <header className="pw-toolbar">
        <strong>{title}</strong>
        <div className="pw-toolbar__actions">
          <button className="pw-btn pw-btn--ghost" disabled={busy} onClick={() => onOpenWorkspace?.()}>
            Open Workspace…
          </button>
          <button className="pw-btn" disabled={busy || !run} onClick={() => onRunAll?.()}>
            {busy ? 'Working…' : 'Run all checks'}
          </button>
        </div>
      </header>

      {ws && (
        <div className="pw-banner">
          <span className="pw-banner__name">{ws.name ?? ws.root}</span>
          <span className="pw-tag">{ws.packageManager}</span>
          {ws.isMonorepo && <span className="pw-tag">monorepo</span>}
          {ws.tooling.nx && <span className="pw-tag">nx</span>}
          {ws.tooling.turbo && <span className="pw-tag">turbo</span>}
          {ws.tooling.pnpmWorkspace && <span className="pw-tag">pnpm-workspace</span>}
          {summary && (
            <span className="pw-banner__summary">
              <b style={{ color: '#1f9d55' }}>{summary.passed} pass</b> ·{' '}
              <b style={{ color: '#d97706' }}>{summary.warned} warn</b> ·{' '}
              <b style={{ color: '#dc2626' }}>{summary.failed} fail</b> · avg {summary.averageScore}/100
            </span>
          )}
        </div>
      )}

      <div className="pw-app">
        <aside className="pw-sidebar">
          <PackageList reports={reports} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>
        <main className="pw-main">
          <PackageDetails
            report={selected}
            onRun={onRunPackage}
            busy={Boolean(selected && busyPackageId === selected.package.id)}
          />
        </main>
      </div>
    </div>
  );
}
