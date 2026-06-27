import { classifyFailure } from "./classify";
import { generateHypotheses } from "./heuristics";
import type {
  AnalyzeOptions,
  FailureAnalysisInput,
  FailureExplanation,
  HeuristicAssistantProvider,
  LLMAssistantProvider,
  LLMClient,
  RootCauseHypothesis,
} from "./types";

/**
 * Provider implementations. Two shapes, one interface:
 *
 *  - {@link HeuristicProvider} — the required, offline, deterministic engine.
 *  - {@link LLMProvider} — an optional wrapper around any {@link LLMClient}. It
 *    asks the model to *refine* the heuristic explanation (never to replace the
 *    cited evidence), and falls back to pure heuristics on any error or when the
 *    client is unavailable. No vendor lock-in; bring your own client.
 */

function rank(
  hypotheses: RootCauseHypothesis[],
  max?: number,
): RootCauseHypothesis[] {
  const sorted = [...hypotheses].sort((a, b) => b.confidence - a.confidence);
  return typeof max === "number" ? sorted.slice(0, Math.max(1, max)) : sorted;
}

function assemble(
  input: FailureAnalysisInput,
  hypotheses: RootCauseHypothesis[],
  providerId: string,
  now: () => string,
): FailureExplanation {
  const ranked = rank(hypotheses);
  const primary = ranked[0] ?? null;
  return {
    input,
    category: primary?.category ?? classifyFailure(input).category,
    hypotheses: ranked,
    primary,
    confidence: primary?.confidence ?? 0,
    provider: providerId,
    priorResolution: null,
    generatedAt: now(),
  };
}

/** The deterministic, always-available heuristic provider. */
export class HeuristicProvider implements HeuristicAssistantProvider {
  readonly id = "heuristic";
  readonly kind = "heuristic" as const;

  isAvailable(): boolean {
    return true;
  }

  async analyze(
    input: FailureAnalysisInput,
    opts: AnalyzeOptions = {},
  ): Promise<FailureExplanation> {
    const now = opts.now ?? (() => new Date().toISOString());
    const hypotheses = rank(generateHypotheses(input), opts.maxHypotheses);
    return assemble(input, hypotheses, this.id, now);
  }
}

/** Build the prompt an LLM provider sends. Exposed for testing + transparency. */
export function buildRefinementPrompt(
  input: FailureAnalysisInput,
  baseline: FailureExplanation,
): string {
  const h = baseline.primary;
  return [
    "You are a senior engineer triaging a package failure. A deterministic engine has already classified it and cited evidence.",
    "Refine the explanation: improve the wording of the root cause and rationale, and tighten the fixes.",
    "STRICT RULES: do not invent file names, package names, or commands not present in the evidence. Do not raise confidence. If the evidence is thin, say so.",
    "",
    `FAILURE: ${input.title}`,
    `CATEGORY/KIND: ${baseline.category} / ${h?.kind ?? "unknown"}`,
    `HEURISTIC CAUSE: ${h?.cause ?? "(none)"}`,
    `EVIDENCE:`,
    ...(h?.evidence ?? []).map((e) => `  - [${e.source}] ${e.text}`),
    "",
    'Respond as JSON: { "cause": string, "rationale": string }',
  ].join("\n");
}

export interface LLMProviderOptions {
  /** Parse the model's response into refined prose. Defaults to JSON parsing. */
  parse?: (raw: string) => { cause?: string; rationale?: string } | null;
}

/**
 * An optional LLM provider. It is strictly *additive*: it starts from the
 * heuristic explanation (so evidence + confidence + fixes are never fabricated)
 * and only rewrites the human-facing `cause`/`rationale`. Any failure degrades
 * silently to the heuristic baseline — the assistant is never worse than offline.
 */
export class LLMProvider implements LLMAssistantProvider {
  readonly kind = "llm" as const;
  private readonly heuristic = new HeuristicProvider();
  private readonly parse: NonNullable<LLMProviderOptions["parse"]>;

  constructor(
    readonly client: LLMClient,
    options: LLMProviderOptions = {},
  ) {
    this.parse = options.parse ?? defaultParse;
  }

  get id(): string {
    return `llm:${this.client.id}`;
  }

  isAvailable(): boolean {
    // The client decides; a thin client can gate on an env var / API key.
    return Boolean(this.client);
  }

  async analyze(
    input: FailureAnalysisInput,
    opts: AnalyzeOptions = {},
  ): Promise<FailureExplanation> {
    const baseline = await this.heuristic.analyze(input, opts);
    if (!baseline.primary) return { ...baseline, provider: this.id };
    try {
      const raw = await this.client.complete(
        buildRefinementPrompt(input, baseline),
      );
      const refined = this.parse(raw);
      if (!refined) return { ...baseline, provider: this.id };
      const primary: RootCauseHypothesis = {
        ...baseline.primary,
        cause: refined.cause?.trim() || baseline.primary.cause,
        rationale: refined.rationale?.trim() || baseline.primary.rationale,
      };
      const hypotheses = [primary, ...baseline.hypotheses.slice(1)];
      return { ...baseline, provider: this.id, primary, hypotheses };
    } catch {
      // Degrade to heuristics — the contract is "never worse than offline".
      return { ...baseline, provider: this.id };
    }
  }
}

function defaultParse(
  raw: string,
): { cause?: string; rationale?: string } | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end < 0) return null;
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    return {
      cause: typeof obj.cause === "string" ? obj.cause : undefined,
      rationale: typeof obj.rationale === "string" ? obj.rationale : undefined,
    };
  } catch {
    return null;
  }
}
