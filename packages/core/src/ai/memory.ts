import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  FailureAnalysisInput,
  FailureCategory,
  FailureKind,
  FixSuggestion,
  PriorResolution,
} from "./types";
import { classifyFailure } from "./classify";

/**
 * Historical learning: a tiny local memory of failures that were resolved, keyed
 * by a *stable signature* (the failure's category/kind/subject, never a
 * timestamp). When the same failure recurs, the assistant surfaces the fix that
 * worked last time — "This was fixed previously by adding zod."
 *
 * Storage is a single JSON file under `<workspace>/.package-workbench/` so it
 * commits/syncs with the repo if the team wants shared institutional memory. No
 * cloud, no telemetry — fully local and offline.
 */

export interface ResolvedFailureRecord {
  signature: string;
  category: FailureCategory;
  kind: FailureKind;
  title: string;
  /** The fix that resolved it (command and/or human detail). */
  resolution: { command?: string; detail?: string };
  packageId?: string;
  /** ISO timestamp of the most recent resolution. */
  resolvedAt: string;
  /** How many times this signature has been seen/resolved. */
  occurrences: number;
}

export interface FailureMemory {
  /** Record (or update) a successful resolution for a failure. */
  record(
    input: FailureAnalysisInput,
    fix: { command?: string; detail?: string },
    now?: () => string,
  ): Promise<ResolvedFailureRecord>;
  /** Look up a prior resolution for a failure, if one exists. */
  recall(input: FailureAnalysisInput): Promise<PriorResolution | null>;
  /** All stored records, newest first. */
  all(): Promise<ResolvedFailureRecord[]>;
}

/**
 * Stable signature for a failure — independent of run, path, and time. Two
 * occurrences of "missing dependency zod in @northwind/lineage" map to the same
 * signature so history matches across runs.
 */
export function signatureOf(input: FailureAnalysisInput): string {
  const { category, kind } = classifyFailure(input);
  const s = input.context.signals ?? {};
  const subject =
    s.missingModule ??
    s.envVar ??
    s.boundary?.to ??
    (s.cyclePath && s.cyclePath.length
      ? [...s.cyclePath].sort().join(">")
      : undefined) ??
    s.unresolvedPeers?.[0]?.split("@")[0] ??
    input.context.checkId ??
    "";
  return [category, kind, input.context.packageId ?? "", subject]
    .join("|")
    .toLowerCase();
}

/** Default location for the failure memory file. */
export function defaultMemoryPath(workspacePath: string): string {
  return join(workspacePath, ".package-workbench", "failure-memory.json");
}

/** A JSON-file-backed {@link FailureMemory}. Never throws on read. */
export function createFailureMemory(filePath: string): FailureMemory {
  async function load(): Promise<Record<string, ResolvedFailureRecord>> {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as {
        records?: Record<string, ResolvedFailureRecord>;
      };
      return parsed.records ?? {};
    } catch {
      return {};
    }
  }

  async function persist(
    records: Record<string, ResolvedFailureRecord>,
  ): Promise<void> {
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({ version: 1, records }, null, 2),
      "utf8",
    );
  }

  return {
    async record(input, fix, now = () => new Date().toISOString()) {
      const records = await load();
      const signature = signatureOf(input);
      const { category, kind } = classifyFailure(input);
      const existing = records[signature];
      const record: ResolvedFailureRecord = {
        signature,
        category,
        kind,
        title: input.title,
        resolution: { command: fix.command, detail: fix.detail },
        packageId: input.context.packageId,
        resolvedAt: now(),
        occurrences: (existing?.occurrences ?? 0) + 1,
      };
      records[signature] = record;
      await persist(records);
      return record;
    },

    async recall(input) {
      const records = await load();
      const record = records[signatureOf(input)];
      if (!record) return null;
      return {
        message: priorMessage(record),
        command: record.resolution.command,
        detail: record.resolution.detail,
        resolvedAt: record.resolvedAt,
        occurrences: record.occurrences,
      };
    },

    async all() {
      const records = await load();
      return Object.values(records).sort((a, b) =>
        b.resolvedAt.localeCompare(a.resolvedAt),
      );
    },
  };
}

/** Convenience: derive a "fixed previously by …" line from the top fix. */
export function fixToResolution(fix: FixSuggestion): {
  command?: string;
  detail?: string;
} {
  return {
    command: fix.command,
    detail: fix.command ? undefined : (fix.detail ?? fix.title),
  };
}

function priorMessage(record: ResolvedFailureRecord): string {
  const how = record.resolution.command
    ? `running \`${record.resolution.command}\``
    : record.resolution.detail
      ? record.resolution.detail
      : "a prior fix";
  const times =
    record.occurrences > 1 ? ` (seen ${record.occurrences}× before)` : "";
  return `This was fixed previously by ${how}${times}.`;
}
