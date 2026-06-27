import { contextBridge, ipcRenderer } from "electron";
import { Channels, type WorkbenchApi } from "../shared/ipc";
import type { EngineProgress } from "@package-workbench/core";
import type { EngineStatusDto } from "../shared/ipc";

/**
 * The ONLY code with access to both Node/Electron and the page. Exposes a
 * narrow, typed API and nothing else — no ipcRenderer, no require, no fs.
 */
const api: WorkbenchApi = {
  getInitialRun: () => ipcRenderer.invoke(Channels.getInitialRun),
  openWorkspace: () => ipcRenderer.invoke(Channels.openWorkspace),
  openExample: () => ipcRenderer.invoke(Channels.openExample),
  exportReport: () => ipcRenderer.invoke(Channels.exportReport),
  scan: (path) => ipcRenderer.invoke(Channels.scan, path),
  runAll: () => ipcRenderer.invoke(Channels.runAll),
  runPackage: (packageId) => ipcRenderer.invoke(Channels.runPackage, packageId),
  analyzeRuntime: (packageId) =>
    ipcRenderer.invoke(Channels.analyzeRuntime, packageId),
  listScenarios: (packageId) =>
    ipcRenderer.invoke(Channels.listScenarios, packageId),
  runScenarios: (packageId) =>
    ipcRenderer.invoke(Channels.runScenarios, packageId),
  runScenario: (packageId, scenarioId) =>
    ipcRenderer.invoke(Channels.runScenario, packageId, scenarioId),
  analyzeGraph: () => ipcRenderer.invoke(Channels.analyzeGraph),
  explainRun: () => ipcRenderer.invoke(Channels.explainRun),
  reviewPr: () => ipcRenderer.invoke(Channels.reviewPr),
  detectStack: () => ipcRenderer.invoke(Channels.detectStack),
  analyzeIntel: () => ipcRenderer.invoke(Channels.analyzeIntel),
  analyzeRefactor: (alternatives) =>
    ipcRenderer.invoke(Channels.analyzeRefactor, alternatives),
  findFixes: () => ipcRenderer.invoke(Channels.findFixes),
  applyFix: (candidate, allowReview) =>
    ipcRenderer.invoke(Channels.applyFix, candidate, allowReview),
  undoFix: () => ipcRenderer.invoke(Channels.undoFix),
  chat: (question) => ipcRenderer.invoke(Channels.chat, question),
  openLogsFolder: () => ipcRenderer.invoke(Channels.openLogsFolder),
  logError: (scope, message) =>
    ipcRenderer.invoke(Channels.logError, scope, message),
  listRuns: () => ipcRenderer.invoke(Channels.historyList),
  compareRuns: (previousId, currentId) =>
    ipcRenderer.invoke(Channels.historyCompare, previousId, currentId),
  cancel: () => ipcRenderer.invoke(Channels.cancel),
  engineStatus: () => ipcRenderer.invoke(Channels.engineStatus),
  onEngineProgress: (listener) => {
    const handler = (_event: unknown, payload: EngineProgress) =>
      listener(payload);
    ipcRenderer.on(Channels.engineProgress, handler);
    return () => ipcRenderer.removeListener(Channels.engineProgress, handler);
  },
  onEngineStatus: (listener) => {
    const handler = (_event: unknown, payload: EngineStatusDto) =>
      listener(payload);
    ipcRenderer.on(Channels.engineStatus, handler);
    return () => ipcRenderer.removeListener(Channels.engineStatus, handler);
  },
};

contextBridge.exposeInMainWorld("workbench", api);
