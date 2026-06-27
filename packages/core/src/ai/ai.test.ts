import { describe, expect, it } from "vitest";
import type {
  DependencyGraph,
  HealthCheckResult,
} from "@package-workbench/plugin-sdk";
import { classifyFailure } from "./classify";
import { fromCrashLog, fromGraph, fromHealthCheck } from "./normalize";
import { generateHypotheses } from "./heuristics";
import { HeuristicProvider, LLMProvider } from "./provider";
import { createFailureAssistant } from "./assistant";
import { createFailureMemory, signatureOf } from "./memory";
import { renderExplanationText } from "./render";
import type { FailureAnalysisInput, LLMClient } from "./types";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Fixtures cover the five canonical failure shapes the assistant must nail
 * offline: missing dependency, circular dependency, broken exports, missing
 * env var, and a runtime exception. Everything here runs without a network and
 * with no LLM — the heuristic engine is the contract.
 */

// ---- fixture builders --------------------------------------------------------

function check(
  partial: Partial<HealthCheckResult> & Pick<HealthCheckResult, "checkId">,
): HealthCheckResult {
  return {
    label: partial.label ?? partial.checkId,
    status: partial.status ?? "fail",
    severity: partial.severity ?? "high",
    summary: partial.summary ?? "",
    details: partial.details,
    evidence: partial.evidence,
    checkId: partial.checkId,
  };
}

const ctx = {
  packageId: "@northwind/lineage",
  packageName: "@northwind/lineage",
  packageManager: "pnpm" as const,
};

const FIXTURES = {
  missingDep: () =>
    fromHealthCheck(
      check({
        checkId: "runtime_import_check",
        summary: "MISSING_DEPENDENCY: import failed",
        details:
          "A dependency is not installed/resolvable. Missing module: zod",
        evidence: [
          "Error: Cannot find package 'zod' imported from /repo/packages/lineage/dist/index.js",
        ],
      }),
      ctx,
    )!,
  brokenExport: () =>
    fromHealthCheck(
      check({
        checkId: "exports_map_check",
        summary: "Invalid exports/entry configuration (1 issue(s))",
        details:
          "These break module resolution for consumers regardless of a successful build.",
        evidence: [".: Declared target does not exist: ./dist/index.js"],
      }),
      ctx,
    )!,
  envMissing: () =>
    fromCrashLog(
      "Error: environment variable DATABASE_URL is not set\n  at config (/repo/src/config.ts:12:9)",
      ctx,
    ),
  runtimeException: () =>
    fromHealthCheck(
      check({
        checkId: "runtime_import_check",
        summary: "RUNTIME_EXCEPTION: Cannot read properties of undefined",
        details:
          "The module threw while its top-level code ran. Offending file: /repo/packages/lineage/dist/index.js",
        evidence: [
          "TypeError: Cannot read properties of undefined (reading 'x')\n  at Object.<anonymous> (/repo/packages/lineage/dist/index.js:3:14)",
        ],
      }),
      ctx,
    )!,
  cycle: (): FailureAnalysisInput => {
    const graph = {
      cycles: [
        {
          cycle: ["@northwind/a", "@northwind/b"],
          kind: "indirect",
          severity: "high",
          affected: ["@northwind/a", "@northwind/b"],
        },
      ],
      violations: [],
    } as unknown as DependencyGraph;
    return fromGraph(graph, ctx)[0]!;
  },
};

// ---- classification ----------------------------------------------------------

describe("classifyFailure", () => {
  it("classifies a missing dependency from the extracted module signal", () => {
    expect(classifyFailure(FIXTURES.missingDep())).toEqual({
      category: "dependency",
      kind: "missing_dependency",
    });
  });
  it("classifies a broken exports map", () => {
    expect(classifyFailure(FIXTURES.brokenExport())).toEqual({
      category: "module",
      kind: "broken_exports",
    });
  });
  it("classifies a missing env var from a crash log", () => {
    expect(classifyFailure(FIXTURES.envMissing())).toEqual({
      category: "infra",
      kind: "env_missing",
    });
  });
  it("classifies a runtime exception", () => {
    expect(classifyFailure(FIXTURES.runtimeException())).toEqual({
      category: "runtime",
      kind: "runtime_exception",
    });
  });
  it("classifies a circular dependency from the graph", () => {
    expect(classifyFailure(FIXTURES.cycle())).toEqual({
      category: "architecture",
      kind: "circular_dependency",
    });
  });
});

// ---- hypotheses + evidence ---------------------------------------------------

describe("generateHypotheses", () => {
  it("produces a high-confidence, evidence-cited fix for a missing dependency", () => {
    const [h] = generateHypotheses(FIXTURES.missingDep());
    expect(h!.kind).toBe("missing_dependency");
    expect(h!.cause).toContain("zod");
    expect(h!.confidence).toBeGreaterThan(0.9);
    expect(h!.evidence.length).toBeGreaterThan(0); // never an uncited claim
    expect(h!.fixes.find((f) => f.kind === "fast")?.command).toBe(
      "pnpm add zod --filter @northwind/lineage",
    );
    expect(h!.fixes.some((f) => f.kind === "structural")).toBe(true);
  });

  it("never invents confidence for an unknown failure", () => {
    const input = fromCrashLog("something inexplicable happened", ctx);
    const [h] = generateHypotheses(input);
    expect(h!.confidence).toBeLessThan(0.5);
    expect(h!.kind).toBe("unknown");
  });

  it("suggests breaking the back-edge for a cycle", () => {
    const [h] = generateHypotheses(FIXTURES.cycle());
    expect(h!.kind).toBe("circular_dependency");
    expect(h!.fixes.some((f) => f.kind === "structural")).toBe(true);
    expect(h!.evidence[0]!.text).toContain("@northwind/a");
  });

  it("recommends building the package for a missing artifact", () => {
    const [h] = generateHypotheses(FIXTURES.brokenExport());
    expect(h!.category).toBe("module");
    expect(h!.fixes.length).toBeGreaterThan(0);
  });

  it("suggests setting the variable for a missing env var", () => {
    const [h] = generateHypotheses(FIXTURES.envMissing());
    expect(h!.kind).toBe("env_missing");
    expect(h!.cause).toContain("DATABASE_URL");
    expect(h!.fixes[0]!.priority).toBeGreaterThan(0);
  });

  it("sorts fixes by priority and hypotheses by confidence", () => {
    const hs = generateHypotheses(FIXTURES.missingDep());
    for (let i = 1; i < hs.length; i++)
      expect(hs[i - 1]!.confidence).toBeGreaterThanOrEqual(hs[i]!.confidence);
    const fixes = hs[0]!.fixes;
    for (let i = 1; i < fixes.length; i++)
      expect(fixes[i - 1]!.priority).toBeGreaterThanOrEqual(fixes[i]!.priority);
  });
});

// ---- provider ----------------------------------------------------------------

describe("HeuristicProvider", () => {
  it("is always available and deterministic", async () => {
    const p = new HeuristicProvider();
    expect(p.isAvailable()).toBe(true);
    const now = () => "2026-06-27T00:00:00.000Z";
    const a = await p.analyze(FIXTURES.missingDep(), { now });
    const b = await p.analyze(FIXTURES.missingDep(), { now });
    expect(a).toEqual(b);
    expect(a.confidence).toBe(a.primary!.confidence);
  });
});

describe("LLMProvider", () => {
  it("refines prose but degrades to heuristics on error", async () => {
    const failing: LLMClient = {
      id: "test",
      complete: async () => {
        throw new Error("offline");
      },
    };
    const p = new LLMProvider(failing);
    const out = await p.analyze(FIXTURES.missingDep(), { now: () => "T" });
    expect(out.provider).toBe("llm:test");
    expect(out.primary!.cause).toContain("zod"); // heuristic baseline preserved
  });

  it("rewrites cause/rationale when the client returns JSON", async () => {
    const client: LLMClient = {
      id: "mock",
      complete: async () =>
        '{"cause":"Refined cause","rationale":"Refined why"}',
    };
    const out = await new LLMProvider(client).analyze(FIXTURES.missingDep(), {
      now: () => "T",
    });
    expect(out.primary!.cause).toBe("Refined cause");
    expect(out.primary!.confidence).toBeGreaterThan(0.9); // confidence untouched by the model
  });
});

// ---- historical learning -----------------------------------------------------

describe("FailureMemory", () => {
  it("matches a recurring failure by stable signature", async () => {
    const a = FIXTURES.missingDep();
    const b = FIXTURES.missingDep();
    expect(signatureOf(a)).toBe(signatureOf(b)); // independent of run/time

    const dir = await mkdtemp(join(tmpdir(), "pw-mem-"));
    const memory = createFailureMemory(join(dir, "mem.json"));
    await memory.record(
      a,
      { command: "pnpm add zod --filter @northwind/lineage" },
      () => "2026-06-01T00:00:00.000Z",
    );
    const prior = await memory.recall(b);
    expect(prior?.message).toContain("fixed previously");
    expect(prior?.command).toContain("pnpm add zod");

    const persisted = JSON.parse(await readFile(join(dir, "mem.json"), "utf8"));
    expect(Object.keys(persisted.records)).toHaveLength(1);
  });

  it("surfaces prior resolutions through the assistant", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pw-mem-"));
    const memory = createFailureMemory(join(dir, "mem.json"));
    const assistant = createFailureAssistant({ memory, now: () => "T" });
    await assistant.recordResolution(
      FIXTURES.missingDep(),
      { command: "pnpm add zod" },
      () => "T0",
    );
    const out = await assistant.analyze(FIXTURES.missingDep());
    expect(out.priorResolution).not.toBeNull();
    expect(out.priorResolution!.occurrences).toBe(1);
  });
});

// ---- rendering ---------------------------------------------------------------

describe("renderExplanationText", () => {
  it("renders the senior-engineer block with confidence", async () => {
    const out = await new HeuristicProvider().analyze(FIXTURES.missingDep(), {
      now: () => "T",
    });
    const text = renderExplanationText(out);
    expect(text).toContain("Root Cause:");
    expect(text).toContain("Suggested Fix:");
    expect(text).toContain("Confidence:");
    expect(text).toContain("94%");
  });
});
