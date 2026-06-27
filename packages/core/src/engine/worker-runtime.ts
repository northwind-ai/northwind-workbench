import { createTaskHandler, type TaskHandler } from "./task-handler";
import type {
  EnginePayload,
  EngineTaskType,
  WorkerInbound,
  WorkerOutbound,
} from "./protocol";

/**
 * The engine worker's message loop. Given a minimal message `port` (Electron's
 * `parentPort`, a `MessagePort`, or a test double), it runs requests through the
 * {@link TaskHandler}, streams progress, and supports per-task cancellation,
 * heartbeat pings, and shutdown. Electron-free, so it runs in tests too.
 */
export interface WorkerPort {
  postMessage(msg: WorkerOutbound): void;
  onMessage(cb: (msg: WorkerInbound) => void): void;
}

export function attachEngineWorker(
  port: WorkerPort,
  handler: TaskHandler = createTaskHandler(),
): void {
  const controllers = new Map<string, AbortController>();

  port.onMessage((msg) => {
    switch (msg.kind) {
      case "ping":
        port.postMessage({ kind: "pong", nonce: msg.nonce });
        return;
      case "shutdown":
        for (const c of controllers.values()) c.abort();
        return;
      case "cancel":
        controllers.get(msg.id)?.abort();
        return;
      case "request":
        void runTask(msg.id, msg.type, msg.payload);
        return;
    }
  });

  async function runTask(
    id: string,
    type: EngineTaskType,
    payload: unknown,
  ): Promise<void> {
    const controller = new AbortController();
    controllers.set(id, controller);
    try {
      const result = await handler(
        type,
        payload as EnginePayload<EngineTaskType>,
        {
          signal: controller.signal,
          onProgress: (p) => port.postMessage({ kind: "progress", id, ...p }),
        },
      );
      port.postMessage({ kind: "response", id, result });
    } catch (err) {
      const e = err as Error;
      const cancelled =
        controller.signal.aborted || e?.name === "CancelledError";
      port.postMessage({
        kind: "error",
        id,
        errorType: cancelled ? "CANCELLED" : "TASK_ERROR",
        message: e?.message ?? String(err),
        stack: e?.stack,
      });
    } finally {
      controllers.delete(id);
    }
  }

  // Signal readiness last, after the listener is wired.
  port.postMessage({ kind: "ready" });
}
