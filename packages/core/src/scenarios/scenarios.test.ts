import { describe, expect, it } from "vitest";
import {
  assemblePackageInfo,
  defineScenario,
  type PluginContext,
  type ScenarioRunnerContext,
  type WorkspaceInfo,
} from "@package-workbench/plugin-sdk";
import { deepEqual, evaluateAssertion, getPath } from "./assertions";
import { runScenario, runScenarios } from "./runner";

const workspace: WorkspaceInfo = {
  root: "/ws",
  packageManager: "pnpm",
  isMonorepo: false,
  packageCount: 1,
  tooling: {
    packageJson: true,
    pnpmWorkspace: false,
    nx: false,
    turbo: false,
    tsconfigBase: false,
  },
  warnings: [],
};
const host = {} as PluginContext;
const base = {
  package: assemblePackageInfo({
    root: "/p",
    packageJsonPath: "/p/package.json",
    manifest: { name: "p", version: "1.0.0" },
  }),
  workspace,
  host,
};
const fakeCtx = {} as ScenarioRunnerContext;

describe("getPath", () => {
  it("reads nested dot/bracket paths", () => {
    const v = { data: { items: [{ id: 7 }] } };
    expect(getPath(v, "data.items.0.id")).toBe(7);
    expect(getPath(v, "data.items[0].id")).toBe(7);
    expect(getPath(v, "data.missing")).toBeUndefined();
  });
});

describe("deepEqual", () => {
  it("compares structurally", () => {
    expect(deepEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
  });
});

describe("evaluateAssertion", () => {
  const cases: Array<
    [string, unknown, Parameters<typeof evaluateAssertion>[0], boolean]
  > = [
    [
      "equals pass",
      { n: 5 },
      { path: "n", operator: "equals", expected: 5 },
      true,
    ],
    [
      "equals fail",
      { n: 5 },
      { path: "n", operator: "equals", expected: 6 },
      false,
    ],
    ["exists pass", { n: 0 }, { path: "n", operator: "exists" }, true],
    ["exists fail", {}, { path: "n", operator: "exists" }, false],
    [
      "type_is array",
      { xs: [] },
      { path: "xs", operator: "type_is", expected: "array" },
      true,
    ],
    [
      "array_length",
      { xs: [1, 2] },
      { path: "xs", operator: "array_length", expected: 2 },
      true,
    ],
    [
      "greater_than pass",
      { n: 3 },
      { path: "n", operator: "greater_than", expected: 0 },
      true,
    ],
    [
      "greater_than fail",
      { n: 0 },
      { path: "n", operator: "greater_than", expected: 0 },
      false,
    ],
    [
      "less_than",
      { n: -1 },
      { path: "n", operator: "less_than", expected: 0 },
      true,
    ],
    [
      "contains string",
      "hello world",
      { operator: "contains", expected: "world" },
      true,
    ],
    ["contains array", [1, 2, 3], { operator: "contains", expected: 2 }, true],
    ["contains key", { a: 1 }, { operator: "contains", expected: "a" }, true],
  ];
  for (const [name, value, assertion, ok] of cases) {
    it(name, () => {
      expect(evaluateAssertion(assertion, value, fakeCtx).ok).toBe(ok);
    });
  }

  it("supports custom_function with a string failure message", () => {
    const r = evaluateAssertion(
      { operator: "custom_function", fn: () => "not allowed" },
      {},
      fakeCtx,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("not allowed");
  });

  it("produces a helpful greater_than failure message", () => {
    const r = evaluateAssertion(
      { path: "opportunityCount", operator: "greater_than", expected: 0 },
      { opportunityCount: 0 },
      fakeCtx,
    );
    expect(r.message).toMatch(/opportunityCount.*>.*0.*actual: 0/);
  });
});

describe("runScenario", () => {
  it("passes when run() output satisfies the assertions", async () => {
    const scenario = defineScenario({
      id: "s1",
      title: "returns a positive count",
      assertions: [{ path: "count", operator: "greater_than", expected: 0 }],
      run: () => ({ count: 3 }),
    });
    const r = await runScenario(scenario, base);
    expect(r.status).toBe("pass");
  });

  it("fails with category=assertion when an assertion fails", async () => {
    const scenario = defineScenario({
      id: "s2",
      title: "count should be positive",
      assertions: [{ path: "count", operator: "greater_than", expected: 0 }],
      run: () => ({ count: 0 }),
    });
    const r = await runScenario(scenario, base);
    expect(r.status).toBe("fail");
    expect(r.category).toBe("assertion");
  });

  it("fails with category=runtime when run() throws", async () => {
    const scenario = defineScenario({
      id: "s3",
      title: "throws",
      run: () => {
        throw new Error("boom");
      },
    });
    const r = await runScenario(scenario, base);
    expect(r.status).toBe("fail");
    expect(r.category).toBe("runtime");
    expect(r.error?.message).toBe("boom");
  });

  it("fails with category=timeout when run() exceeds the timeout", async () => {
    const scenario = defineScenario({
      id: "s4",
      title: "hangs",
      timeoutMs: 50,
      run: (ctx) =>
        new Promise((resolve) => {
          const t = setTimeout(resolve, 10_000);
          ctx.signal.addEventListener("abort", () => clearTimeout(t));
        }),
    });
    const r = await runScenario(scenario, base);
    expect(r.status).toBe("fail");
    expect(r.category).toBe("timeout");
  });

  it("captures logs emitted via ctx.log", async () => {
    const scenario = defineScenario({
      id: "s5",
      title: "logs",
      run: (ctx) => {
        ctx.log("hello from scenario");
        return {};
      },
    });
    const r = await runScenario(scenario, base);
    expect(r.logs).toContain("hello from scenario");
  });

  it("skips a scenario when the run is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const scenario = defineScenario({
      id: "s6",
      title: "never runs",
      run: () => ({}),
    });
    const r = await runScenario(scenario, base, { signal: controller.signal });
    expect(r.status).toBe("skip");
    expect(r.category).toBe("cancelled");
  });
});

describe("runScenarios", () => {
  const ok = (id: string) => defineScenario({ id, title: id, run: () => ({}) });
  const bad = (id: string) =>
    defineScenario({
      id,
      title: id,
      assertions: [{ operator: "exists", path: "nope" }],
      run: () => ({}),
    });

  it("aggregates pass rate and counts", async () => {
    const result = await runScenarios([ok("a"), bad("b"), ok("c")], base);
    expect(result.total).toBe(3);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.passRate).toBeCloseTo(2 / 3);
  });

  it("runs in parallel when concurrency > 1", async () => {
    const result = await runScenarios(
      [ok("a"), ok("b"), ok("c"), ok("d")],
      base,
      { concurrency: 4 },
    );
    expect(result.passed).toBe(4);
  });
});
