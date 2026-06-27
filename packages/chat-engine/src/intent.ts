import type { Intent, QueryType, Timeframe, WorkbenchKnowledge } from "./types";

/**
 * Intent detection: classify a natural-language question into a {@link QueryType}
 * and extract the package entities + timeframe it refers to. Deterministic
 * keyword/pattern matching — same question, same intent.
 */

interface Rule {
  type: QueryType;
  re: RegExp;
}

// Ordered — first match wins. More specific intents come first.
const RULES: Rule[] = [
  {
    type: "regression",
    re: /\b(chang(?:e|ed|es)|since\s+last|last\s+week|drop|dropped|regress|worse|degrad|instability|unstable|flaky|broke\s+ci|ci\b)/i,
  },
  {
    type: "refactor",
    re: /\b(refactor|split|merge|restructure|decouple|extract|reorganiz)/i,
  },
  {
    type: "dependency",
    re: /\b(depend|depends?\s+on|dependents?|importers?|consumers?|who\s+uses|what\s+uses|reverse\s+depend|imported\s+by)/i,
  },
  {
    type: "failure",
    re: /\b(why\b.*\b(unhealthy|failing|fails?|broken|red|bad)|what'?s\s+wrong|root\s+cause|what\s+broke)/i,
  },
  {
    type: "performance",
    re: /\b(size|largest|biggest|heavi|slow|performance|bundle|too\s+large)/i,
  },
  {
    type: "architecture",
    re: /\b(coupl|cycle|circular|architecture|boundary|god\s+package|central|risk|riskiest|most\s+connected)/i,
  },
  {
    type: "health",
    re: /\b(health|score|how\s+healthy|status|unhealthy|grade)/i,
  },
];

export function detectTimeframe(q: string): Timeframe {
  if (/\bsince\s+last|last\s+week|since\b/i.test(q)) return "since_last";
  if (/\blast\s+run\b/i.test(q)) return "last_run";
  if (/\brecent|lately|these\s+days/i.test(q)) return "recent";
  return "all";
}

/** Extract package ids referenced by the question (exact + short-name match). */
export function extractEntities(
  question: string,
  knowledge: WorkbenchKnowledge,
): string[] {
  const q = ` ${question.toLowerCase()} `;
  const matched = new Set<string>();
  for (const report of knowledge.run.reports) {
    const id = report.package.id;
    const name = report.package.name.toLowerCase();
    const short = (name.split("/").pop() ?? name).toLowerCase();
    if (q.includes(name) || wordPresent(q, short)) matched.add(id);
  }
  return [...matched];
}

function wordPresent(haystackPadded: string, word: string): boolean {
  if (word.length < 3) return false; // avoid spurious 2-letter matches
  return new RegExp(`[^a-z0-9]${escapeRe(word)}[^a-z0-9]`).test(haystackPadded);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectIntent(
  question: string,
  knowledge: WorkbenchKnowledge,
): Intent {
  const normalized = question.trim();
  const type = RULES.find((r) => r.re.test(normalized))?.type ?? "general";
  return {
    type,
    entities: extractEntities(normalized, knowledge),
    timeframe: detectTimeframe(normalized),
    question: normalized,
  };
}
