import { describe, expect, it } from "vitest";
import {
  EngineHost,
  type EngineHostOptions,
  type RequestOptions,
} from "./manager";
import { createInProcessTransport, type InProcessTransport } from "./transport";
import {
  CancelledError,
  type TaskContext,
  type TaskHandler,
} from "./task-handler";

/**
 * Tests run the real host + worker runtime over the in-process transport, with a
 * controllable fake task handler — so crashes, timeouts, cancellation, restart,
 * and partial recovery are exercised deterministically (no Electron needed).
 */

/** A fake handler whose behaviour is driven by `payload.mode`. */
const fakeHandler = (async (
  _type: string,
  payload: unknown,
  ctx: TaskContext,
) => {
  const p = payload as { mode?: string };
  switch (p.mode) {
    case "progress-then-ok":
      ctx.onProgress({ progress: 50, phase: "health_checks", message: "half" });
      return { ok: true };
    case "hang":
      return new Promise(() => {}); // never settles → timeout
    case "progress-then-hang":
      ctx.onProgress({ progress: 42, phase: "dependency_graph" });
      return new Promise(() => {});
    case "cancellable":
      ctx.onProgress({ progress: 30, phase: "runtime_checks" });
      return new Promise((_resolve, reject) => {
        const t = setInterval(() => {
          if (ctx.signal.aborted) {
            clearInterval(t);
            reject(new CancelledError("aborted"));
          }
        }, 2);
      });
    case "throw":
      throw new Error("boom");
    default:
      return { echoed: p };
  }
}) as unknown as TaskHandler;

function makeHost(over: Partial<EngineHostOptions> = {}): {
  host: EngineHost;
  transports: InProcessTransport[];
} {
  const transports: InProcessTransport[] = [];
  const host = new EngineHost({
    transportFactory: () => {
      const t = createInProcessTransport(fakeHandler);
      transports.push(t);
      return t;
    },
    heartbeatIntervalMs: 0, // off by default; enabled explicitly in the heartbeat test
    ...over,
  });
  host.start();
  return { host, transports };
}

const req = (
  host: EngineHost,
  payload: unknown,
  opts?: RequestOptions,
): Promise<unknown> =>
  (
    host.request as unknown as (
      t: string,
      p: unknown,
      o?: RequestOptions,
    ) => Promise<unknown>
  )("RUN_GRAPH", payload, opts);

async function waitFor(fn: () => boolean, timeout = 1500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("waitFor timed out");
}

describe("EngineHost — happy path", () => {
  it("resolves a task and streams progress", async () => {
    const { host } = makeHost();
    const progress: number[] = [];
    const result = await req(
      host,
      { mode: "progress-then-ok" },
      { onProgress: (p) => progress.push(p.progress) },
    );
    expect(result).toEqual({ ok: true });
    expect(progress).toContain(50);
    host.stop();
  });

  it("echoes payloads for distinct tasks", async () => {
    const { host } = makeHost();
    expect(await req(host, { mode: "x", n: 1 })).toEqual({
      echoed: { mode: "x", n: 1 },
    });
    host.stop();
  });
});

describe("EngineHost — errors & timeouts", () => {
  it("rejects with TASK_ERROR when the handler throws", async () => {
    const { host } = makeHost();
    await expect(req(host, { mode: "throw" })).rejects.toMatchObject({
      errorType: "TASK_ERROR",
      message: "boom",
    });
    host.stop();
  });

  it("rejects with TIMEOUT when a task hangs", async () => {
    const { host } = makeHost();
    await expect(
      req(host, { mode: "hang" }, { timeoutMs: 60 }),
    ).rejects.toMatchObject({ errorType: "TIMEOUT" });
    host.stop();
  });
});

describe("EngineHost — cancellation", () => {
  it("cancels an in-flight task via AbortSignal", async () => {
    const { host } = makeHost();
    const ac = new AbortController();
    const promise = req(host, { mode: "cancellable" }, { signal: ac.signal });
    await waitFor(() => host.getStatus().inFlight === 1);
    ac.abort();
    await expect(promise).rejects.toMatchObject({ errorType: "CANCELLED" });
    host.stop();
  });

  it("rejects immediately if the signal is already aborted", async () => {
    const { host } = makeHost();
    await expect(
      req(host, { mode: "progress-then-ok" }, { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ errorType: "CANCELLED" });
    host.stop();
  });
});

describe("EngineHost — queue (concurrency 1)", () => {
  it("runs one task at a time and queues the rest", async () => {
    const { host } = makeHost({ concurrency: 1 });
    const ac = new AbortController();
    const first = req(host, { mode: "cancellable" }, { signal: ac.signal });
    const second = req(host, { mode: "progress-then-ok" });
    await waitFor(
      () => host.getStatus().inFlight === 1 && host.getStatus().queued === 1,
    );
    ac.abort();
    await expect(first).rejects.toMatchObject({ errorType: "CANCELLED" });
    expect(await second).toEqual({ ok: true }); // dequeued after the first settled
    host.stop();
  });
});

describe("EngineHost — crash recovery", () => {
  it("rejects in-flight tasks with PROCESS_CRASH and preserves last progress", async () => {
    const { host, transports } = makeHost();
    let last = -1;
    const promise = req(
      host,
      { mode: "progress-then-hang" },
      { onProgress: (p) => (last = p.progress) },
    );
    await waitFor(() => last === 42);
    transports[0]!.simulateCrash("segfault");
    await expect(promise).rejects.toMatchObject({
      errorType: "PROCESS_CRASH",
      lastProgress: { progress: 42 },
    });
    host.stop();
  });

  it("auto-restarts the worker so the next task succeeds", async () => {
    const { host, transports } = makeHost();
    const first = req(host, { mode: "hang" });
    await waitFor(() => host.getStatus().inFlight === 1);
    transports[0]!.simulateCrash();
    await expect(first).rejects.toMatchObject({ errorType: "PROCESS_CRASH" });

    await waitFor(() => host.getStatus().state === "ready");
    expect(host.getStatus().restarts).toBe(1);
    expect(await req(host, { mode: "progress-then-ok" })).toEqual({ ok: true });
    expect(transports.length).toBe(2); // a fresh transport was spawned
    host.stop();
  });

  it("stops restarting past maxRestarts", async () => {
    const { host, transports } = makeHost({ maxRestarts: 1 });
    transports[0]!.simulateCrash();
    await waitFor(() => host.getStatus().state === "ready"); // restart #1
    transports[1]!.simulateCrash();
    await waitFor(() => host.getStatus().state === "crashed"); // no more restarts
    expect(host.getStatus().restarts).toBe(1);
    host.stop();
  });
});

describe("EngineHost — heartbeat", () => {
  it("detects a silent (deaf) worker and recovers", async () => {
    const { host, transports } = makeHost({
      heartbeatIntervalMs: 20,
      heartbeatTimeoutMs: 60,
    });
    await waitFor(() => host.getStatus().state === "ready");
    transports[0]!.goDeaf(); // stops responding to pings without exiting
    await waitFor(() => host.getStatus().restarts === 1, 2000);
    expect(host.getStatus().lastError).toMatch(/heartbeat/);
    host.stop();
  });
});
