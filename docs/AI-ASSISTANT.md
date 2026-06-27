# AI Failure Analysis Assistant

Package Workbench already detects failures. The AI Assistant **explains** them like a
senior engineer: it classifies a failure, generates ranked root-cause hypotheses,
cites the concrete evidence behind each one, proposes prioritized fixes, and reports
an **honest** confidence — derived from the strength of the evidence, never invented.

```
Failure:
  Missing dependency: zod

AI Assistant:
Root Cause:
  @northwind/lineage imports zod but does not declare it as a dependency.

Why it happened:
  This commonly occurs after moving validation logic across package boundaries.

Suggested Fix:
  pnpm add zod --filter @northwind/lineage

Confidence:
  94%
```

## Design principles

- **Offline-first.** The heuristic engine is required and fully deterministic — no
  network, no model, same input → same output. LLM providers are optional and
  strictly _additive_.
- **No fake confidence.** A hypothesis built from a hard signal (an extracted module
  name, a cycle path) scores high; one built only from a check id or loose text scores
  low and says so.
- **Always cited.** Every hypothesis attaches the evidence it reasoned from. The
  assistant never makes an uncited claim.
- **No provider lock-in.** Everything speaks one interface
  (`FailureAssistantProvider`). Bring your own LLM client; the engine degrades to
  heuristics if it's unavailable or errors.

## Pipeline

```
 any source ──▶ normalize ──▶ classify ──▶ generate hypotheses ──▶ enrich w/ memory
 (checks,        (extract      (category/    (cause + evidence +     (prior fix for
  scenarios,      structured    kind)         confidence + fixes +    this signature)
  runtime,        signals)                    validation steps)
  graph, CI,
  crash logs)
```

| Stage       | Module             | Responsibility                                                                         |
| ----------- | ------------------ | -------------------------------------------------------------------------------------- |
| Normalize   | `ai/normalize.ts`  | Fold every source into `FailureAnalysisInput`, extracting structured `FailureSignals`. |
| Classify    | `ai/classify.ts`   | Map onto a `(category, kind)` using signals → check id → text.                         |
| Reason      | `ai/heuristics.ts` | The deterministic root-cause engine: ranked `RootCauseHypothesis[]`.                   |
| Providers   | `ai/provider.ts`   | `HeuristicProvider` (required) + `LLMProvider` (optional, additive).                   |
| Memory      | `ai/memory.ts`     | Local failure memory: surface the fix that worked last time.                           |
| Orchestrate | `ai/assistant.ts`  | `createFailureAssistant()` — the façade the CLI + desktop use.                         |
| Render      | `ai/render.ts`     | Shared text / Markdown formatting.                                                     |

## Failure taxonomy

| Category       | Kinds                                                       |
| -------------- | ----------------------------------------------------------- |
| `dependency`   | `missing_dependency`, `peer_mismatch`, `version_conflict`   |
| `module`       | `esm_cjs_mismatch`, `broken_exports`, `import_failure`      |
| `architecture` | `circular_dependency`, `boundary_violation`, `overcoupling` |
| `runtime`      | `runtime_exception`, `timeout`, `memory_spike`              |
| `build`        | `missing_build_artifact`, `ts_compile_failure`              |
| `infra`        | `env_missing`, `config_invalid`                             |

## Input sources

Health checks, scenario failures, runtime import executions, dependency-graph
violations (cycles + boundaries), CI/PR regressions, and raw crash logs. Each has a
dedicated normalizer (`fromHealthCheck`, `fromScenarioRun`, `fromRuntimeReport`,
`fromGraph`, `fromRegression`, `fromCrashLog`), and `fromRun(run)` folds a whole run.

## CLI

```bash
# Explain every failure in a workspace (terminal block, the example above)
package-workbench explain . --pretty

# Machine-readable
package-workbench explain . --format json
package-workbench explain . --format markdown --out analysis.md

# Explain the built-in demo run — fully offline, no workspace needed
package-workbench explain --mock --pretty

# Analyze a raw crash log / CI stderr blob
package-workbench explain . --input ./crash.log --pretty
```

`explain` exits non-zero when it finds high-confidence (≥60%) actionable failures, so
it can gate a pipeline.

## Desktop

The **AI Assistant** tab in the package details panel shows, per failure:
Failure → Root cause → Evidence → Fixes (fast + structural, each copy-pasteable) →
Confidence meter, plus **open related files**, **show raw logs**, and a prior-fix note
when local memory has one. Trigger it from the tab or the command palette
("Analyze Failures (AI)"). Analysis runs in the engine worker so the failure-memory
file is read/written off the UI thread.

## Historical learning

Resolutions are stored locally in `<workspace>/.package-workbench/failure-memory.json`,
keyed by a **stable signature** (category/kind/subject — never a timestamp). When the
same failure recurs, the assistant surfaces the fix that worked:

> 💡 This was fixed previously by running `pnpm add zod --filter @northwind/lineage`.

Record a resolution programmatically:

```ts
const assistant = createFailureAssistant({ memory: workspacePath });
await assistant.recordResolution(input, {
  command: "pnpm add zod --filter @northwind/lineage",
});
```

## Plugging in an LLM (optional)

Implement the tiny vendor-neutral `LLMClient` and wrap it. The model only refines the
human-facing `cause`/`rationale`; evidence, confidence, and fixes stay heuristic.

```ts
import { LLMProvider, createFailureAssistant } from "@package-workbench/core";

const client = {
  id: "claude",
  async complete(prompt: string) {
    // call your model of choice; return raw text
    return await callModel(prompt);
  },
};

const assistant = createFailureAssistant({
  provider: new LLMProvider(client),
  memory: cwd,
});
```

If the client throws or is unavailable, the result is exactly the offline heuristic
explanation — **never worse than offline**.

## Limitations

- Heuristics reason from the signals the scanners surface; a failure with no
  diagnostic evidence falls back to a clearly-labelled low-confidence summary.
- Crash-log parsing covers the common, highly-diagnostic patterns (missing module,
  unset env var, ESM/CJS) and otherwise hands the raw text to the classifier.
- Confidence is calibrated to coarse, honest bands — it is a triage aid, not a proof.
- LLM refinement only rewrites prose; it cannot introduce new evidence or raise
  confidence by design (anti-hallucination).

```

```
