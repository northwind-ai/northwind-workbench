import type { MessagePortMain } from "electron";
import {
  attachEngineWorker,
  type WorkerInbound,
  type WorkerOutbound,
} from "@package-workbench/core";

/**
 * The isolated engine worker — runs as an Electron `utilityProcess`, completely
 * outside the renderer and the main process. All heavy work (scanning, AST
 * parsing, dependency graphs, sandboxed runtime imports, scenarios, report
 * generation) happens here, so the UI never freezes and a crash is contained to
 * this process (the host restarts it).
 */

// In a utilityProcess, `process.parentPort` is the channel back to main.
const parentPort = (process as unknown as { parentPort: MessagePortMain })
  .parentPort;

attachEngineWorker({
  postMessage: (msg: WorkerOutbound) => parentPort.postMessage(msg),
  onMessage: (cb) => {
    parentPort.on("message", (e: { data: WorkerInbound }) => cb(e.data));
    parentPort.start();
  },
});
