import type { ChatAnswer } from "./types";

/**
 * Render a chat answer in the product's "Answer · Evidence · Suggested Actions ·
 * Confidence" shape. Pure string formatting; the CLI prints text, the UI uses
 * Markdown.
 */

const CONFIDENCE_LABEL = {
  low: "Low",
  medium: "Medium",
  high: "High",
} as const;

export function renderAnswerText(answer: ChatAnswer): string {
  const L: string[] = [];
  L.push("Answer:", `  ${answer.answer}`, "");
  if (answer.evidence.length) {
    L.push("Evidence:");
    for (const e of answer.evidence) L.push(`  - [${e.source}] ${e.text}`);
    L.push("");
  }
  if (answer.suggestedActions.length) {
    L.push("Suggested Actions:");
    answer.suggestedActions.forEach((a, i) =>
      L.push(`  ${i + 1}. ${a.title}${a.command ? `  →  ${a.command}` : ""}`),
    );
    L.push("");
  }
  L.push(`Confidence: ${CONFIDENCE_LABEL[answer.confidence]}`);
  return L.join("\n");
}

export function renderAnswerMarkdown(answer: ChatAnswer): string {
  const L: string[] = [];
  L.push(answer.answer, "");
  if (answer.evidence.length) {
    L.push("**Evidence**");
    for (const e of answer.evidence) L.push(`- \`${e.source}\` ${e.text}`);
    L.push("");
  }
  if (answer.suggestedActions.length) {
    L.push("**Suggested actions**");
    answer.suggestedActions.forEach((a, i) =>
      L.push(`${i + 1}. ${a.title}${a.command ? ` — \`${a.command}\`` : ""}`),
    );
    L.push("");
  }
  L.push(`_Confidence: ${CONFIDENCE_LABEL[answer.confidence]}_`);
  return L.join("\n");
}
