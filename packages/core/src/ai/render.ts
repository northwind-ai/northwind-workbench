import type { FailureExplanation, RootCauseHypothesis } from "./types";

/**
 * Presentation helpers for explanations. Pure string formatting only — the CLI
 * prints these and the report exporter embeds them. Kept here (not in the UI) so
 * the same wording is shared by every surface.
 */

/** Render confidence as an honest percentage. */
export function confidencePercent(confidence: number): number {
  return Math.round(confidence * 100);
}

/** A compact one-liner: `Missing dependency: zod → pnpm add zod (94%)`. */
export function explanationHeadline(explanation: FailureExplanation): string {
  const h = explanation.primary;
  const fix = h?.fixes[0];
  const tail = fix?.command ? ` → ${fix.command}` : "";
  return `${explanation.input.title}${tail} (${confidencePercent(explanation.confidence)}%)`;
}

/** Render the desired UX block as plain text (terminal-friendly). */
export function renderExplanationText(explanation: FailureExplanation): string {
  const L: string[] = [];
  const h = explanation.primary;
  L.push(`Failure:`, `  ${explanation.input.title}`, "");
  if (!h) {
    L.push("No analysis could be produced.");
    return L.join("\n");
  }
  L.push("AI Assistant:");
  L.push("Root Cause:", `  ${h.cause}`, "");
  if (h.rationale) L.push("Why it happened:", `  ${h.rationale}`, "");
  if (h.evidence.length) {
    L.push("Evidence:");
    for (const e of h.evidence) L.push(`  • [${e.source}] ${e.text}`);
    L.push("");
  }
  const fix = h.fixes[0];
  if (fix) {
    L.push("Suggested Fix:", `  ${fix.command ?? fix.detail ?? fix.title}`);
    const structural = h.fixes.find(
      (f) => f.kind === "structural" && f !== fix,
    );
    if (structural)
      L.push(
        `  Structural: ${structural.command ?? structural.detail ?? structural.title}`,
      );
    L.push("");
  }
  if (explanation.priorResolution)
    L.push(`Prior fix:`, `  ${explanation.priorResolution.message}`, "");
  L.push("Confidence:", `  ${confidencePercent(explanation.confidence)}%`);
  return L.join("\n");
}

/** Render an explanation as a Markdown section (for reports / PR comments). */
export function renderExplanationMarkdown(
  explanation: FailureExplanation,
): string {
  const L: string[] = [];
  const h = explanation.primary;
  L.push(`### ${explanation.input.title}`, "");
  if (!h) {
    L.push("_No analysis could be produced._");
    return L.join("\n");
  }
  L.push(
    `**Root cause** (${confidencePercent(explanation.confidence)}% confidence): ${h.cause}`,
    "",
  );
  if (h.rationale) L.push(`**Why it happened:** ${h.rationale}`, "");
  if (h.evidence.length) {
    L.push("**Evidence:**");
    for (const e of h.evidence) L.push(`- \`${e.source}\` — ${e.text}`);
    L.push("");
  }
  if (h.fixes.length) {
    L.push("**Suggested fixes:**");
    for (const f of h.fixes)
      L.push(
        `- _${f.kind}_ — ${f.command ? `\`${f.command}\`` : (f.detail ?? f.title)}`,
      );
    L.push("");
  }
  if (h.validation.length) {
    L.push("**Validate:**");
    for (const v of h.validation)
      L.push(`- ${v.description}${v.command ? ` — \`${v.command}\`` : ""}`);
    L.push("");
  }
  if (explanation.priorResolution)
    L.push(`> 💡 ${explanation.priorResolution.message}`, "");
  return L.join("\n").trimEnd();
}

/** Alternate-hypothesis summary, e.g. for a "other possibilities" disclosure. */
export function alternativesText(hypotheses: RootCauseHypothesis[]): string[] {
  return hypotheses
    .slice(1)
    .map((h) => `${h.cause} (${confidencePercent(h.confidence)}%)`);
}
