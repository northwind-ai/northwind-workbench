import { detectIntent } from "./intent";
import { retrieveContext } from "./context";
import { HeuristicChatProvider } from "./provider";
import { createSession, recordTurn } from "./session";
import type {
  ChatAnswer,
  ChatProvider,
  ChatSession,
  WorkbenchKnowledge,
} from "./types";

/**
 * The chat orchestrator: question → intent → context retrieval → reasoning →
 * answer, with conversational memory threaded through. It performs NO analysis
 * itself — it reasons over the {@link WorkbenchKnowledge} the engines produced.
 */

export interface ChatEngineOptions {
  /** Reasoning backend. Defaults to the offline heuristic provider. */
  provider?: ChatProvider;
}

export interface ChatEngine {
  readonly provider: ChatProvider;
  /** Ask a question; returns the answer + the updated session (for follow-ups). */
  ask(
    question: string,
    session?: ChatSession,
  ): Promise<{ answer: ChatAnswer; session: ChatSession }>;
}

export function createChatEngine(
  knowledge: WorkbenchKnowledge,
  options: ChatEngineOptions = {},
): ChatEngine {
  const provider = options.provider ?? new HeuristicChatProvider();

  return {
    provider,
    async ask(question, session = createSession()) {
      const intent = detectIntent(question, knowledge);
      const context = retrieveContext(intent, knowledge, session.focusEntities);
      const answer = await provider.answer(context, knowledge);
      return { answer, session: recordTurn(session, question, answer) };
    },
  };
}

/** Suggested starter prompts for the UI. */
export function suggestedPrompts(): string[] {
  return [
    "Most risky packages?",
    "What should I refactor first?",
    "Why did the score drop?",
    "Which package is causing CI instability?",
    "What changed since last week?",
    "Which package is the largest?",
  ];
}
