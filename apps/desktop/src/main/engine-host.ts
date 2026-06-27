import { join } from "node:path";
import {
  EngineHost,
  type EngineHostStatus,
  type EngineProgress,
} from "@package-workbench/core";
import { createUtilityTransport } from "./engine-transport";
import { logger } from "./logging";
import { mainDir } from "./paths";

/**
 * Lazily-created singleton {@link EngineHost} wired to the utility-process
 * transport. The host owns one worker, restarts it on crash, and never lets a
 * worker failure reach the main process. Created on first heavy task (the
 * first-launch demo never spawns a worker).
 */

let host: EngineHost | null = null;

export interface EngineHooks {
  onStatus?(s: EngineHostStatus): void;
  onCrash?(info: { reason: string; restarts: number }): void;
}

export function getEngine(hooks: EngineHooks = {}): EngineHost {
  if (host) return host;
  host = new EngineHost({
    transportFactory: () =>
      createUtilityTransport(join(mainDir, "worker.js")),
    concurrency: 1,
    defaultTimeoutMs: 10 * 60 * 1000, // 10 min ceiling for a full scan
    heartbeatIntervalMs: 5000,
    heartbeatTimeoutMs: 20000,
    maxRestarts: 5,
  });
  host.onCrash((info) => {
    logger.error(
      `Engine worker crashed: ${info.reason} (restart #${info.restarts})`,
    );
    hooks.onCrash?.(info);
  });
  host.onStatus((s) => hooks.onStatus?.(s));
  host.start();
  return host;
}

/** The current host without creating one (for metrics polling). */
export function peekEngine(): EngineHost | null {
  return host;
}

/** Stop the worker on app exit (no-op if it was never started). */
export function stopEngine(): void {
  host?.stop();
  host = null;
}

export type { EngineHostStatus, EngineProgress };
