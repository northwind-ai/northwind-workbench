import { contextBridge, ipcRenderer } from 'electron';
import { Channels, type WorkbenchApi } from '../shared/ipc';
import type { RunnerEvent } from '@package-workbench/core';

/**
 * The ONLY code with access to both Node/Electron and the page. Exposes a
 * narrow, typed API and nothing else — no ipcRenderer, no require, no fs.
 */
const api: WorkbenchApi = {
  getInitialRun: () => ipcRenderer.invoke(Channels.getInitialRun),
  openWorkspace: () => ipcRenderer.invoke(Channels.openWorkspace),
  scan: (path) => ipcRenderer.invoke(Channels.scan, path),
  runAll: () => ipcRenderer.invoke(Channels.runAll),
  runPackage: (packageId) => ipcRenderer.invoke(Channels.runPackage, packageId),
  onProgress: (listener) => {
    const handler = (_event: unknown, payload: RunnerEvent) => listener(payload);
    ipcRenderer.on(Channels.progress, handler);
    return () => ipcRenderer.removeListener(Channels.progress, handler);
  },
};

contextBridge.exposeInMainWorld('workbench', api);
