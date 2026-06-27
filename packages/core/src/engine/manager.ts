import {
  EngineError,
  type EnginePayload,
  type EngineProgress,
  type EngineResult,
  type EngineTaskType,
  type WorkerOutbound,
} from "./protocol";
import type { EngineTransport, TransportFactory } from "./transport";

/**
 * The host-side process manager. Owns one engine worker (via an injected
 * transport), dispatches tasks with a concurrency cap + queue, streams progress,
 * enforces per-task timeouts, supports cancellation, monitors health with a
 * heartbeat, and restarts the worker on crash — rejecting in-flight tasks with a
 * structured {@link EngineError} (including the last progress, for partial
 * recovery) so the app never wedges.
 */

export type EngineHostState = "starting" | "ready" | "crashed" | "stopped";

export interface EngineHostStatus {
  state: EngineHostState;
  inFlight: number;
  queued: number;
  restarts: number;
  lastError?: string;
}

export interface RequestOptions {
  onProgress?: (p: EngineProgress) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface EngineHostOptions {
  transportFactory: TransportFactory;
  concurrency?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  defaultTimeoutMs?: number;
  maxRestarts?: number;
}

interface Pending {
  id: string;
  type: EngineTaskType;
  payload: unknown;
  resolve: (value: unknown) => void;
  reject: (err: EngineError) => void;
  onProgress?: (p: EngineProgress) => void;
  lastProgress?: EngineProgress;
  timer?: ReturnType<typeof setTimeout>;
  timeoutMs: number;
  detachSignal?: () => void;
}

export class EngineHost {
  private transport: EngineTransport | null = null;
  private state: EngineHostState = "stopped";
  private readonly queue: Pending[] = [];
  private readonly inFlight = new Map<string, Pending>();
  private seq = 0;
  private restarts = 0;
  private lastError?: string;
  private lastPongAt = 0;
  private heartbeat?: ReturnType<typeof setInterval>;
  private nonce = 0;
  private readonly statusListeners = new Set<(s: EngineHostStatus) => void>();
  private readonly crashListeners = new Set<
    (info: { reason: string; restarts: number }) => void
  >();

  private readonly concurrency: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly maxRestarts: number;

  constructor(private readonly opts: EngineHostOptions) {
    this.concurrency = Math.max(1, opts.concurrency ?? 1);
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 4000;
    this.heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? 10000;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 120000;
    this.maxRestarts = opts.maxRestarts ?? 5;
  }

  /** Spawn (or respawn) the worker. */
  start(): void {
    if (this.state === "ready" || this.state === "starting") return;
    this.spawn();
  }

  private spawn(): void {
    this.state = "starting";
    this.lastPongAt = Date.now();
    const transport = this.opts.transportFactory();
    this.transport = transport;
    transport.onMessage((msg) => this.onMessage(msg));
    transport.onExit((info) =>
      this.handleCrash(info.reason || `exit ${info.code}`),
    );
    this.startHeartbeat();
    this.emitStatus();
  }

  // ---- public API -----------------------------------------------------------

  request<T extends EngineTaskType>(
    type: T,
    payload: EnginePayload<T>,
    opts: RequestOptions = {},
  ): Promise<EngineResult<T>> {
    if (this.state === "stopped") this.spawn();

    return new Promise<EngineResult<T>>((resolve, reject) => {
      const id = `t${++this.seq}`;
      const pending: Pending = {
        id,
        type,
        payload,
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress: opts.onProgress,
        timeoutMs: opts.timeoutMs ?? this.defaultTimeoutMs,
      };

      if (opts.signal) {
        if (opts.signal.aborted) {
          reject(new EngineError("CANCELLED", "Cancelled before dispatch"));
          return;
        }
        const onAbort = (): void => this.cancel(id);
        opts.signal.addEventListener("abort", onAbort);
        pending.detachSignal = () =>
          opts.signal?.removeEventListener("abort", onAbort);
      }

      this.queue.push(pending);
      this.pump();
    });
  }

  /** Cancel a specific task (queued or in-flight). */
  cancel(id: string): void {
    const queuedIdx = this.queue.findIndex((p) => p.id === id);
    if (queuedIdx >= 0) {
      const [p] = this.queue.splice(queuedIdx, 1);
      this.settleReject(
        p!,
        new EngineError("CANCELLED", "Cancelled", p!.lastProgress),
      );
      return;
    }
    const p = this.inFlight.get(id);
    if (p) {
      this.transport?.postMessage({ kind: "cancel", id });
      this.settleReject(
        p,
        new EngineError("CANCELLED", "Cancelled", p.lastProgress),
      );
    }
  }

  /** Cancel everything (queued + in-flight). */
  cancelAll(): void {
    for (const p of [...this.queue]) this.cancel(p.id);
    for (const id of [...this.inFlight.keys()]) this.cancel(id);
  }

  getStatus(): EngineHostStatus {
    return {
      state: this.state,
      inFlight: this.inFlight.size,
      queued: this.queue.length,
      restarts: this.restarts,
      lastError: this.lastError,
    };
  }

  onStatus(cb: (s: EngineHostStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }
  onCrash(
    cb: (info: { reason: string; restarts: number }) => void,
  ): () => void {
    this.crashListeners.add(cb);
    return () => this.crashListeners.delete(cb);
  }

  /** Graceful shutdown — rejects any outstanding work. */
  stop(): void {
    this.state = "stopped";
    this.stopHeartbeat();
    this.transport?.postMessage({ kind: "shutdown" });
    for (const p of [...this.inFlight.values(), ...this.queue]) {
      this.settleReject(
        p,
        new EngineError("WORKER_UNAVAILABLE", "Engine stopped", p.lastProgress),
      );
    }
    this.queue.length = 0;
    this.transport?.kill();
    this.transport = null;
    this.emitStatus();
  }

  // ---- internals ------------------------------------------------------------

  private pump(): void {
    while (
      this.state === "ready" &&
      this.inFlight.size < this.concurrency &&
      this.queue.length > 0
    ) {
      const p = this.queue.shift()!;
      this.inFlight.set(p.id, p);
      this.transport!.postMessage({
        kind: "request",
        id: p.id,
        type: p.type,
        payload: p.payload,
      });
      p.timer = setTimeout(() => {
        this.transport?.postMessage({ kind: "cancel", id: p.id });
        this.settleReject(
          p,
          new EngineError(
            "TIMEOUT",
            `Task ${p.type} exceeded ${p.timeoutMs}ms`,
            p.lastProgress,
          ),
        );
      }, p.timeoutMs);
      this.emitStatus();
    }
  }

  private onMessage(msg: WorkerOutbound): void {
    switch (msg.kind) {
      case "ready":
        this.state = "ready";
        this.lastPongAt = Date.now();
        this.emitStatus();
        this.pump();
        return;
      case "pong":
        this.lastPongAt = Date.now();
        return;
      case "progress": {
        const p = this.inFlight.get(msg.id);
        if (p) {
          const { kind, ...progress } = msg;
          p.lastProgress = progress;
          p.onProgress?.(progress);
        }
        return;
      }
      case "response": {
        const p = this.inFlight.get(msg.id);
        if (p) this.settle(p, () => p.resolve(msg.result));
        return;
      }
      case "error": {
        const p = this.inFlight.get(msg.id);
        if (p)
          this.settle(p, () =>
            p.reject(
              new EngineError(msg.errorType, msg.message, p.lastProgress),
            ),
          );
        return;
      }
    }
  }

  private settle(p: Pending, action: () => void): void {
    if (p.timer) clearTimeout(p.timer);
    p.detachSignal?.();
    this.inFlight.delete(p.id);
    action();
    this.emitStatus();
    this.pump();
  }

  private settleReject(p: Pending, err: EngineError): void {
    this.settle(p, () => p.reject(err));
  }

  private handleCrash(reason: string): void {
    if (this.state === "stopped" || this.state === "crashed") return;
    this.state = "crashed";
    this.lastError = reason;
    this.stopHeartbeat();
    this.transport?.kill();
    this.transport = null;

    // Reject everything outstanding; tasks are NOT auto-retried (avoid duplicate
    // side effects) — the caller decides whether to retry.
    for (const p of [...this.inFlight.values(), ...this.queue]) {
      this.settleRejectNoPump(
        p,
        new EngineError(
          "PROCESS_CRASH",
          `Engine worker crashed: ${reason}`,
          p.lastProgress,
        ),
      );
    }
    this.inFlight.clear();
    this.queue.length = 0;

    for (const cb of this.crashListeners)
      cb({ reason, restarts: this.restarts });
    this.emitStatus();

    // Auto-restart so the next request has a healthy worker.
    if (this.restarts < this.maxRestarts) {
      this.restarts++;
      this.spawn();
    }
  }

  private settleRejectNoPump(p: Pending, err: EngineError): void {
    if (p.timer) clearTimeout(p.timer);
    p.detachSignal?.();
    p.reject(err);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (this.heartbeatIntervalMs <= 0) return;
    this.heartbeat = setInterval(() => {
      if (this.state !== "ready") return;
      if (Date.now() - this.lastPongAt > this.heartbeatTimeoutMs) {
        this.handleCrash("heartbeat timeout");
        return;
      }
      this.transport?.postMessage({ kind: "ping", nonce: ++this.nonce });
    }, this.heartbeatIntervalMs);
    // Don't keep the event loop alive for the heartbeat alone.
    (this.heartbeat as { unref?: () => void }).unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private emitStatus(): void {
    const s = this.getStatus();
    for (const cb of this.statusListeners) cb(s);
  }
}
