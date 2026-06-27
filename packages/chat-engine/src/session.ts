import type { ChatAnswer, ChatSession, ChatTurn } from "./types";

/**
 * Scoped conversational memory. The session carries `focusEntities` — the
 * packages most recently discussed — so a follow-up question without an explicit
 * subject ("what depends on it?") reuses the prior focus. Pure + deterministic.
 */

export function createSession(): ChatSession {
  return { turns: [], focusEntities: [] };
}

/** Record a turn and update the focus to the packages the answer referenced. */
export function recordTurn(
  session: ChatSession,
  question: string,
  answer: ChatAnswer,
): ChatSession {
  const turn: ChatTurn = { question, answer };
  const focusEntities =
    answer.references.length > 0
      ? dedupe(answer.references)
      : session.focusEntities;
  return { turns: [...session.turns, turn], focusEntities };
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}
