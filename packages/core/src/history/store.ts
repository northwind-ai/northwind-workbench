import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { HistoricalRun, RunMetadata } from "@package-workbench/plugin-sdk";

/**
 * Persistence for historical runs. The interface is storage-agnostic so it can
 * evolve (SQLite, remote) without touching callers; the default implementation
 * is a directory of JSON files — one per run — under
 * `<workspace>/.package-workbench/history`. No cloud backend required.
 */
export interface RunStore {
  save(run: HistoricalRun): Promise<void>;
  /** Metadata for every stored run, newest first. */
  list(): Promise<RunMetadata[]>;
  get(id: string): Promise<HistoricalRun | null>;
  /** Every stored run, newest first (for trends/comparison). */
  all(): Promise<HistoricalRun[]>;
  /** The most recent run, optionally filtered to a git branch. */
  latest(branch?: string): Promise<HistoricalRun | null>;
  /** Keep only the newest `max` runs. */
  prune(max: number): Promise<void>;
}

/** Default location for a workspace's run history. */
export function defaultHistoryDir(workspacePath: string): string {
  return join(workspacePath, ".package-workbench", "history");
}

const safe = (id: string): string => id.replace(/[^a-zA-Z0-9._-]/g, "_");

export function createJsonRunStore(baseDir: string): RunStore {
  async function readRun(file: string): Promise<HistoricalRun | null> {
    try {
      return JSON.parse(
        await readFile(join(baseDir, file), "utf8"),
      ) as HistoricalRun;
    } catch {
      return null;
    }
  }

  async function allRuns(): Promise<HistoricalRun[]> {
    let files: string[];
    try {
      files = (await readdir(baseDir)).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    const runs = (await Promise.all(files.map(readRun))).filter(
      (r): r is HistoricalRun => r !== null,
    );
    return runs.sort((a, b) =>
      b.metadata.timestamp.localeCompare(a.metadata.timestamp),
    );
  }

  return {
    async save(run) {
      await mkdir(baseDir, { recursive: true });
      await writeFile(
        join(baseDir, `${safe(run.id)}.json`),
        JSON.stringify(run, null, 2),
        "utf8",
      );
    },
    async list() {
      return (await allRuns()).map((r) => r.metadata);
    },
    async get(id) {
      return readRun(`${safe(id)}.json`);
    },
    all: allRuns,
    async latest(branch) {
      const runs = await allRuns();
      const filtered = branch
        ? runs.filter((r) => r.metadata.gitBranch === branch)
        : runs;
      return filtered[0] ?? null;
    },
    async prune(max) {
      const runs = await allRuns();
      for (const old of runs.slice(max)) {
        await rm(join(baseDir, `${safe(old.id)}.json`), { force: true }).catch(
          () => {},
        );
      }
    },
  };
}
