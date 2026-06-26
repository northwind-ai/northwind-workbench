import type { PackageHealthReport, RunnerEvent, WorkbenchRun } from '@package-workbench/core';

/** Channel names — the single source of truth shared by main + preload. */
export const Channels = {
  getInitialRun: 'workbench:getInitialRun',
  openWorkspace: 'workbench:openWorkspace',
  scan: 'workbench:scan',
  runAll: 'workbench:runAll',
  runPackage: 'workbench:runPackage',
  progress: 'workbench:progress',
} as const;

/**
 * The typed bridge exposed to the renderer as `window.workbench`. The renderer
 * speaks ONLY this surface — never Node, never ipcRenderer, never the filesystem.
 * All FS access happens in the main process.
 */
export interface WorkbenchApi {
  /** The run shown on first launch (built-in mock data). */
  getInitialRun(): Promise<WorkbenchRun>;
  /** Show a folder picker, scan the chosen workspace. Null if cancelled. */
  openWorkspace(): Promise<WorkbenchRun | null>;
  /** Scan an explicit path. */
  scan(path: string): Promise<WorkbenchRun>;
  /** Re-run the currently loaded workspace (mock if none opened yet). */
  runAll(): Promise<WorkbenchRun>;
  /** Re-run checks for a single package; returns the updated report. */
  runPackage(packageId: string): Promise<PackageHealthReport | null>;
  /** Subscribe to runner progress events. Returns an unsubscribe fn. */
  onProgress(listener: (event: RunnerEvent) => void): () => void;
}
