import { utilityProcess, type UtilityProcess } from "electron";
import type {
  EngineTransport,
  WorkerInbound,
  WorkerOutbound,
} from "@package-workbench/core";

/**
 * The real {@link EngineTransport}: forks the engine worker as an Electron
 * `utilityProcess` and bridges the host's typed messages to it. A crashed worker
 * fires `exit`, which the {@link EngineHost} turns into a restart.
 */
export function createUtilityTransport(workerPath: string): EngineTransport {
  let child: UtilityProcess | null = utilityProcess.fork(workerPath, [], {
    serviceName: "package-workbench-engine",
    stdio: "ignore",
  });

  return {
    postMessage(msg: WorkerInbound) {
      child?.postMessage(msg);
    },
    onMessage(cb) {
      child?.on("message", (data: WorkerOutbound) => cb(data));
    },
    onExit(cb) {
      child?.on("exit", (code: number) =>
        cb({ code, reason: `worker exited (code ${code})` }),
      );
    },
    kill() {
      child?.kill();
      child = null;
    },
  };
}
