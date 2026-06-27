import { attachEngineWorker, type WorkerPort } from "./worker-runtime";
import type { TaskHandler } from "./task-handler";
import type { WorkerInbound, WorkerOutbound } from "./protocol";

/**
 * The transport abstraction between the host and a worker. The real Electron
 * transport (in the desktop app) wraps a `utilityProcess`; the in-process
 * transport here runs the worker in the same process — used for unit tests and
 * as a safe fallback, and able to simulate crashes.
 */
export interface EngineTransport {
  postMessage(msg: WorkerInbound): void;
  onMessage(cb: (msg: WorkerOutbound) => void): void;
  onExit(cb: (info: { code: number | null; reason: string }) => void): void;
  kill(): void;
}

export type TransportFactory = () => EngineTransport;

export interface InProcessTransport extends EngineTransport {
  /** Simulate the worker dying — fires onExit and stops delivering messages. */
  simulateCrash(reason?: string): void;
  /** Go silent without exiting — lets the heartbeat detect the hang. */
  goDeaf(): void;
}

/**
 * Build an in-process transport backed by a real worker runtime. Optionally
 * inject a custom {@link TaskHandler} (tests use a controllable fake).
 */
export function createInProcessTransport(
  handler?: TaskHandler,
): InProcessTransport {
  let alive = true;
  let deaf = false;
  const toHost: Array<(msg: WorkerOutbound) => void> = [];
  const onExitCbs: Array<
    (info: { code: number | null; reason: string }) => void
  > = [];
  let workerOnMessage: ((msg: WorkerInbound) => void) | null = null;

  // The port handed to the worker runtime.
  const workerPort: WorkerPort = {
    postMessage(msg) {
      if (!alive || deaf) return;
      queueMicrotask(() => toHost.forEach((cb) => cb(msg)));
    },
    onMessage(cb) {
      workerOnMessage = cb;
    },
  };

  attachEngineWorker(workerPort, handler);

  return {
    postMessage(msg) {
      if (!alive || deaf) return;
      queueMicrotask(() => workerOnMessage?.(msg));
    },
    onMessage(cb) {
      toHost.push(cb);
    },
    onExit(cb) {
      onExitCbs.push(cb);
    },
    kill() {
      alive = false;
    },
    simulateCrash(reason = "simulated crash") {
      if (!alive) return;
      alive = false;
      queueMicrotask(() => onExitCbs.forEach((cb) => cb({ code: 1, reason })));
    },
    goDeaf() {
      deaf = true;
    },
  };
}
