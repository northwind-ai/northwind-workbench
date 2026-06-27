import { reasonHeuristic } from "./reason";
import type {
  ChatAnswer,
  ChatProvider,
  LLMClient,
  RetrievedContext,
  WorkbenchKnowledge,
} from "./types";

/**
 * Chat providers. The heuristic provider is required and fully offline; the LLM
 * provider is optional, provider-agnostic, and strictly additive — it may only
 * rewrite the human-facing prose of an answer the heuristic engine already
 * produced, never its evidence, confidence, or actions, and it degrades to the
 * heuristic answer on any error.
 */

export class HeuristicChatProvider implements ChatProvider {
  readonly id = "heuristic";
  readonly kind = "heuristic" as const;

  isAvailable(): boolean {
    return true;
  }

  async answer(
    context: RetrievedContext,
    knowledge: WorkbenchKnowledge,
  ): Promise<ChatAnswer> {
    return reasonHeuristic(context, knowledge);
  }
}

/** Build the LLM prompt. Exposed for transparency/testing. */
export function buildChatPrompt(answer: ChatAnswer): string {
  return [
    "You are a senior engineer answering a question about a repository. A deterministic engine has already produced a grounded answer with cited evidence.",
    "Rewrite ONLY the answer prose to be clearer and more natural. Do NOT add facts, do NOT change the evidence, confidence, or suggested actions, and do NOT reference anything not in the evidence.",
    "",
    `QUESTION: ${answer.question}`,
    `DRAFT ANSWER: ${answer.answer}`,
    "EVIDENCE:",
    ...answer.evidence.map((e) => `  - [${e.source}] ${e.text}`),
    "",
    'Respond with JSON: { "answer": string }',
  ].join("\n");
}

export interface LLMChatProviderOptions {
  parse?: (raw: string) => { answer?: string } | null;
}

export class LLMChatProvider implements ChatProvider {
  readonly kind = "llm" as const;
  private readonly heuristic = new HeuristicChatProvider();
  private readonly parse: NonNullable<LLMChatProviderOptions["parse"]>;

  constructor(
    readonly client: LLMClient,
    options: LLMChatProviderOptions = {},
  ) {
    this.parse = options.parse ?? defaultParse;
  }

  get id(): string {
    return `llm:${this.client.id}`;
  }

  isAvailable(): boolean {
    return Boolean(this.client);
  }

  async answer(
    context: RetrievedContext,
    knowledge: WorkbenchKnowledge,
  ): Promise<ChatAnswer> {
    const baseline = await this.heuristic.answer(context, knowledge);
    try {
      const raw = await this.client.complete(buildChatPrompt(baseline));
      const refined = this.parse(raw);
      const prose = refined?.answer?.trim();
      if (!prose) return { ...baseline, provider: this.id };
      return { ...baseline, answer: prose, provider: this.id };
    } catch {
      return { ...baseline, provider: this.id };
    }
  }
}

function defaultParse(raw: string): { answer?: string } | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end < 0) return null;
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    return { answer: typeof obj.answer === "string" ? obj.answer : undefined };
  } catch {
    return null;
  }
}
