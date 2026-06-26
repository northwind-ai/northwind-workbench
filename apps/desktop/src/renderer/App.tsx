import { useCallback, useEffect, useState } from 'react';
import type { RunnerEvent, WorkbenchRun } from '@package-workbench/core';
import { Workbench } from '@package-workbench/ui';

/**
 * Thin renderer: loads a run over the IPC bridge, subscribes to progress events
 * for live feedback, and hands everything to the presentational <Workbench/>.
 * No validation logic and no filesystem access live here — all behind the bridge.
 */
export function App() {
  const [run, setRun] = useState<WorkbenchRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState('Loading…');

  useEffect(() => {
    void window.workbench.getInitialRun().then((r) => {
      setRun(r);
      setStatus(`${r.workspace.name ?? 'workspace'} · ${r.summary.totalPackages} package(s)`);
    });

    return window.workbench.onProgress((e: RunnerEvent) => {
      if (e.type === 'workspace:detected') setStatus(`Detected ${e.workspace.packageCount} package(s)…`);
      else if (e.type === 'package:start') setStatus(`Checking ${e.packageId}…`);
      else if (e.type === 'run:done') setStatus(`Done · avg ${e.run.summary.averageScore}/100`);
    });
  }, []);

  const withBusy = useCallback(async (fn: () => Promise<WorkbenchRun | null>) => {
    setBusy(true);
    try {
      const next = await fn();
      if (next) setRun(next);
    } finally {
      setBusy(false);
    }
  }, []);

  const onOpenWorkspace = useCallback(() => withBusy(() => window.workbench.openWorkspace()), [withBusy]);
  const onRunAll = useCallback(() => withBusy(() => window.workbench.runAll()), [withBusy]);

  const onRunPackage = useCallback(async (packageId: string) => {
    setBusyId(packageId);
    try {
      const updated = await window.workbench.runPackage(packageId);
      if (updated) {
        setRun((prev) =>
          prev ? { ...prev, reports: prev.reports.map((r) => (r.package.id === packageId ? updated : r)) } : prev,
        );
      }
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div className="pw-root">
      <Workbench
        run={run}
        onOpenWorkspace={onOpenWorkspace}
        onRunAll={onRunAll}
        onRunPackage={onRunPackage}
        busy={busy}
        busyPackageId={busyId}
      />
      <footer className="pw-statusbar">{status}</footer>
    </div>
  );
}
