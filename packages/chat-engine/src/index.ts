/**
 * @package-workbench/chat-engine — AI Codebase Chat.
 *
 * Natural-language Q&A over a repository, grounded in Package Workbench
 * intelligence (health, dependency graph, package intelligence, refactor
 * suggestions, history). Offline heuristic reasoning is required and
 * deterministic; an optional, provider-agnostic LLM may only refine prose.
 *
 * Pipeline: intent detection → context retrieval (compression) → reasoning →
 * response generation (answer + evidence + confidence + suggested actions). It
 * performs no analysis of its own — it reuses what the engines produced.
 */
export * from "./types";
export { detectIntent, detectTimeframe, extractEntities } from "./intent";
export { retrieveContext } from "./context";
export { reasonHeuristic } from "./reason";
export {
  HeuristicChatProvider,
  LLMChatProvider,
  buildChatPrompt,
  type LLMChatProviderOptions,
} from "./provider";
export { createSession, recordTurn } from "./session";
export {
  createChatEngine,
  suggestedPrompts,
  type ChatEngine,
  type ChatEngineOptions,
} from "./engine";
export { gatherKnowledge, type GatherOptions } from "./gather";
export { renderAnswerText, renderAnswerMarkdown } from "./render";
