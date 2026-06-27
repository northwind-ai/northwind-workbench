import type { FixPatch } from "./types";

/**
 * A small, dependency-free line diff for fix previews — "Old ↓ New". It finds the
 * common prefix/suffix and shows the differing middle as removed (`-`) / added
 * (`+`) lines, which reads cleanly for the small package.json edits the fixers
 * produce. Pure.
 */

export interface DiffLine {
  kind: "context" | "remove" | "add";
  text: string;
}

export function diffLines(before: string | null, after: string): DiffLine[] {
  const a = before === null ? [] : before.split("\n");
  const b = after.split("\n");

  // Common prefix.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  // Common suffix (not overlapping the prefix).
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out: DiffLine[] = [];
  const ctx = 2;
  for (let i = Math.max(0, start - ctx); i < start; i++)
    out.push({ kind: "context", text: a[i]! });
  for (let i = start; i < endA; i++) out.push({ kind: "remove", text: a[i]! });
  for (let i = start; i < endB; i++) out.push({ kind: "add", text: b[i]! });
  for (let i = endA; i < Math.min(a.length, endA + ctx); i++)
    out.push({ kind: "context", text: a[i]! });
  return out;
}

/** Render a patch as a unified-style diff string. */
export function renderPatchDiff(patch: FixPatch): string {
  const rel = patch.path;
  const header =
    patch.before === null ? `+++ ${rel} (new file)` : `--- ${rel}\n+++ ${rel}`;
  const body = diffLines(patch.before, patch.after)
    .map((l) =>
      l.kind === "add"
        ? `+ ${l.text}`
        : l.kind === "remove"
          ? `- ${l.text}`
          : `  ${l.text}`,
    )
    .join("\n");
  return `${header}\n${body}`;
}
